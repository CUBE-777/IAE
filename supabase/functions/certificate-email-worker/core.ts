// supabase/functions/certificate-email-worker/core.ts
//
// نواة عامل بريد الشهادات: منطق خالص بحقن الاعتماديات (rpc / إرسال البريد / ساعة / سجل) كي يُختبر في Node بلا Deno ولا شبكة.
// index.ts يربطها بـ Supabase (service_role) وResend الحقيقيين.
//
// الأمان:
//   * الحمولة التي تعيدها certificate_email_claim_next (بريد، اسم، رمز) تبقى داخل هذه الدالة: لا تُسجَّل ولا تُعاد في الاستجابة.
//   * السجل يستقبل أسماء أحداث ورموز أخطاء وأعدادًا فقط (log(event, { code | count })).
//   * هوية العامل (workerId) عشوائية لكل تشغيل وتُمرَّر لـ claim/recheck/complete؛ الخادم (0066) يرفض الإكمال من غير الحاجز.
//   * لا إرسال إلا بعد recheck ناجح مباشرة قبل طلب HTTP. فشل recheck → لا إرسال، ثم complete(false) (تُلغى المهمة إن كانت الشهادة ملغاة).
//   * نجاح Resend ثم فشل complete: لا إعادة إرسال تلقائية؛ تبقى المهمة sending وتُحرَّر لاحقًا إلى failed(stale_sending) (تفاديًا للتكرار).

import { buildCertificateEmail, buildVerifyUrl, pickLang } from './template.ts';

export const WORKER_ID_RE = /^[a-z0-9_:-]{1,60}$/;
export const STALE_MINUTES = 15;
export const DEFAULT_MAX_JOBS = 10;
export const HARD_MAX_JOBS = 25;
export const DEFAULT_TIME_BUDGET_MS = 50_000;
export const SEND_TIMEOUT_MS = 10_000;
export const MIN_SEND_INTERVAL_MS = 600; // Resend: حدّ افتراضي ~2 طلب/ثانية

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER_RE = /^IAE-\d{4}-\d{6,}$/;
const TYPE_RE = /^[a-z_]{3,30}$/;
const EMAIL_RE = /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[^@\s<>"',;]+$/;

export interface RpcResult { data: unknown; error: { code?: string } | null }
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
export interface MailPayload { to: string; subject: string; html: string; text: string }
export type SendResult = { ok: true } | { ok: false; code: string };
export type SendMail = (mail: MailPayload) => Promise<SendResult>;
export type Log = (event: string, fields?: Record<string, string | number>) => void;

export interface Summary {
  claimed: number; sent: number; retried: number; failed: number; cancelled: number; skipped: number;
  released: number; errors: number;
  stopped: 'empty' | 'max_jobs' | 'time_budget' | 'rate_limited' | 'claim_error';
}

export interface Deps {
  rpc: Rpc;
  sendMail: SendMail;
  siteOrigin: string;          // origin مُتحقَّق منه (https)
  workerId: string;
  maxJobs?: number;
  timeBudgetMs?: number;
  sendTimeoutMs?: number;
  minSendIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: Log;
}

export const clampMaxJobs = (v: unknown): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : DEFAULT_MAX_JOBS;
  return Math.min(Math.max(n, 1), HARD_MAX_JOBS);
};

export function newWorkerId(): string {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return `cew:${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/** مقارنة سرّين بزمن ثابت (عبر SHA-256 للطرفين). */
export async function secretsMatch(provided: string, expected: string): Promise<boolean> {
  if (!provided || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(provided)), crypto.subtle.digest('SHA-256', enc.encode(expected))]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

interface Job {
  queueId: string; to: string; name: string; number: string; type: string; language: string; title: string; token: string;
}

function parseJob(raw: unknown): Job | null {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!r) return null;
  const s = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : '');
  const queueId = s(r.queue_id, 36);
  const to = s(r.to_email, 254).trim();
  const number = s(r.certificate_number, 40);
  const token = s(r.token, 43);
  if (!UUID_RE.test(queueId) || !EMAIL_RE.test(to) || !NUMBER_RE.test(number) || token.length !== 43) return null;
  const type = s(r.certificate_type, 30);
  return { queueId, to, name: s(r.recipient_name, 200).replace(/[\r\n]+/g, ' ').trim(), number, type: TYPE_RE.test(type) ? type : '', language: pickLang(r.language), title: s(r.campaign_title, 300).replace(/[\r\n]+/g, ' ').trim(), token };
}

const safeQueueId = (raw: unknown): string | null => {
  const q = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).queue_id : null;
  return typeof q === 'string' && UUID_RE.test(q) ? q : null;
};

const errCode = (e: { code?: string } | null | undefined) => (e && typeof e.code === 'string' && /^[A-Za-z0-9_]{1,12}$/.test(e.code) ? e.code : 'unknown');

/** يعالج حتى maxJobs مهمة بالتتابع ضمن ميزانية زمنية؛ لا يرمي أبدًا (الأخطاء تُحصى وتُسجَّل برموز فقط). */
export async function runWorker(d: Deps): Promise<Summary> {
  const now = d.now ?? Date.now;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log: Log = d.log ?? (() => {});
  const maxJobs = clampMaxJobs(d.maxJobs);
  const budget = d.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const sendTimeout = d.sendTimeoutMs ?? SEND_TIMEOUT_MS;
  const minInterval = d.minSendIntervalMs ?? MIN_SEND_INTERVAL_MS;
  const reserve = sendTimeout + 3_000; // لا نبدأ مهمة جديدة إن لم يتّسع الوقت لإرسال + إكمال
  const start = now();
  const s: Summary = { claimed: 0, sent: 0, retried: 0, failed: 0, cancelled: 0, skipped: 0, released: 0, errors: 0, stopped: 'max_jobs' };

  try {
    const rel = await d.rpc('certificate_email_release_stale', { p_older_than_minutes: STALE_MINUTES });
    if (rel.error) log('release_stale_failed', { code: errCode(rel.error) });
    else if (typeof rel.data === 'number') s.released = rel.data;
  } catch { log('release_stale_failed', { code: 'exception' }); }

  const complete = async (queueId: string, success: boolean, code: string | null): Promise<string | null> => {
    try {
      const res = await d.rpc('certificate_email_complete', { p_queue_id: queueId, p_worker: d.workerId, p_success: success, p_error_code: code });
      if (res.error) { s.errors++; log('complete_failed', { code: errCode(res.error) }); return null; }
      return typeof res.data === 'string' ? res.data : null;
    } catch { s.errors++; log('complete_failed', { code: 'exception' }); return null; }
  };
  const tally = (outcome: string | null) => {
    if (outcome === 'sent') s.sent++;
    else if (outcome === 'queued') s.retried++;
    else if (outcome === 'failed') s.failed++;
    else if (outcome === 'cancelled') s.cancelled++;
  };

  let lastSendAt = 0;
  for (let i = 0; i < maxJobs; i++) {
    if (now() - start > budget - reserve) { s.stopped = 'time_budget'; break; }

    let claim: RpcResult;
    try { claim = await d.rpc('certificate_email_claim_next', { p_worker: d.workerId }); } catch { claim = { data: null, error: { code: 'exception' } }; }
    if (claim.error) { s.errors++; s.stopped = 'claim_error'; log('claim_failed', { code: errCode(claim.error) }); break; }
    if (claim.data === null || claim.data === undefined) { s.stopped = 'empty'; break; }
    s.claimed++;

    const job = parseJob(claim.data);
    if (!job) {
      const qid = safeQueueId(claim.data);
      if (qid) tally(await complete(qid, false, 'invalid_job'));
      s.skipped++;
      log('job_invalid');
      continue;
    }

    let abort = false;
    try {
      const verifyUrl = buildVerifyUrl(d.siteOrigin, job.token);
      if (!verifyUrl) { tally(await complete(job.queueId, false, 'invalid_token')); s.skipped++; log('job_invalid'); continue; }

      // وتيرة الإرسال (قبل recheck ليبقى الفحص أقرب ما يكون لطلب HTTP)
      const wait = lastSendAt + minInterval - now();
      if (lastSendAt > 0 && wait > 0) await sleep(wait);

      const ok = await d.rpc('certificate_email_recheck', { p_queue_id: job.queueId, p_worker: d.workerId });
      if (ok.error || ok.data !== true) {
        // ملغاة (أو لم تعد مهمتنا): لا نرسل. complete(false) تُلغي المهمة إن كانت الشهادة ملغاة، وإلا تجدول إعادة محاولة.
        tally(await complete(job.queueId, false, ok.error ? 'recheck_error' : 'recheck_denied'));
        s.skipped++;
        log('recheck_denied');
        continue;
      }

      const mail = buildCertificateEmail({ language: job.language, recipientName: job.name, certificateNumber: job.number, certificateType: job.type, campaignTitle: job.title, verifyUrl });
      let res: SendResult;
      try { res = await d.sendMail({ to: job.to, subject: mail.subject, html: mail.html, text: mail.text }); } catch { res = { ok: false, code: 'send_exception' }; }
      lastSendAt = now();

      const outcome = await complete(job.queueId, res.ok, res.ok ? null : res.code);
      tally(outcome);
      log(res.ok ? 'job_sent' : 'job_send_failed', res.ok ? {} : { code: res.code });
      if (!res.ok && res.code === 'resend_rate_limited') { s.stopped = 'rate_limited'; abort = true; }
    } catch {
      // خطأ غير متوقع بعد الحجز: نحرّر المهمة بإعادة محاولة بدل تركها عالقة
      s.errors++;
      tally(await complete(job.queueId, false, 'worker_error'));
      log('job_exception');
    }
    if (abort) break;
  }
  return s;
}

/** مُرسِل Resend: JSON فقط بلا مرفقات. يُرجع رمزًا ثابتًا عند الفشل (لا نص الاستجابة ولا المفتاح ولا العنوان). */
export function makeResendSender(fetchImpl: typeof fetch, apiKey: string, from: string, timeoutMs = SEND_TIMEOUT_MS): SendMail {
  return async (mail) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text }),
        signal: ctl.signal,
      });
      if (res.ok) return { ok: true };
      if (res.status === 429) return { ok: false, code: 'resend_rate_limited' };
      return { ok: false, code: `resend_http_${res.status}` };
    } catch (e) {
      return { ok: false, code: e instanceof Error && e.name === 'AbortError' ? 'resend_timeout' : 'resend_network' };
    } finally {
      clearTimeout(timer);
    }
  };
}
