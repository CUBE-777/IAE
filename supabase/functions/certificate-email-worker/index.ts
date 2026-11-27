// supabase/functions/certificate-email-worker/index.ts
//
// عامل إرسال بريد الشهادات (طابور certificate_email_queue، migrations 0065 + 0066).
// يعالج عددًا محدودًا من المهام في كل استدعاء ثم يعود بملخّص أعداد فقط (بلا بريد/اسم/رمز).
//
// الأمان:
//   - طلب POST فقط، ويلزمه الترويسة  x-worker-secret  تطابق CERTIFICATE_EMAIL_WORKER_SECRET (مقارنة بزمن ثابت). سرّ ناقص/قصير → 503.
//   - SUPABASE_SERVICE_ROLE_KEY على الخادم فقط. دوال العامل في القاعدة مقصورة على service_role (0065/0066) وتتحقق من هوية الحاجز.
//   - لا CORS: الاستدعاء من Cron/خادم، لا من المتصفح.
//   - لا يُسجَّل أي رمز أو بريد أو اسم أو رقم شهادة.
//
// الإعداد (Secrets) — لا تضعها في GitHub ولا في الواجهة:
//   supabase secrets set RESEND_API_KEY=re_xxx MAIL_FROM="IAE <noreply@your-domain.org>" SITE_URL=https://fsa-iae.netlify.app \
//     CERTIFICATE_EMAIL_WORKER_SECRET=$(openssl rand -hex 32)
//   (SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY يحقنهما Supabase تلقائيًا في Edge Functions.)
// النشر:  supabase functions deploy certificate-email-worker --no-verify-jwt
//   (--no-verify-jwt لأن الحماية بالسرّ المستقل؛ لا يُشغَّل تلقائيًا: يلزم Cron خارجي يستدعيه — راجع docs/CERTIFICATE_EMAIL_WORKER.md)

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { makeResendSender, newWorkerId, runWorker, secretsMatch, type Log, type Rpc } from './core.ts';
import { normalizeSiteUrl } from './template.ts';

const MIN_SECRET_LENGTH = 32;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

// سجل بأسماء أحداث ورموز وأعداد فقط
const log: Log = (event, fields) => console.log(JSON.stringify({ event, ...(fields || {}) }));

async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const secret = Deno.env.get('CERTIFICATE_EMAIL_WORKER_SECRET') || '';
  if (secret.length < MIN_SECRET_LENGTH) return json({ error: 'not_configured' }, 503);
  if (!(await secretsMatch(req.headers.get('x-worker-secret') || '', secret))) return json({ error: 'unauthorized' }, 401);

  const url = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const apiKey = Deno.env.get('RESEND_API_KEY') || '';
  const from = Deno.env.get('MAIL_FROM') || '';
  const siteOrigin = normalizeSiteUrl(Deno.env.get('SITE_URL'));
  // نتحقق من كل الإعداد قبل حجز أي مهمة (لا نحجز ثم نفشل)
  if (!url || !serviceKey || !apiKey || !from || !siteOrigin) return json({ error: 'not_configured' }, 503);

  const body = await req.json().catch(() => ({}));
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const rpc: Rpc = async (fn, args) => {
    const { data, error } = await admin.rpc(fn, args);
    return { data, error: error ? { code: error.code } : null };
  };

  const summary = await runWorker({
    rpc,
    sendMail: makeResendSender(fetch, apiKey, from),
    siteOrigin,
    workerId: newWorkerId(),
    maxJobs: typeof body?.max_jobs === 'number' ? body.max_jobs : undefined,
    log,
  });
  log('run_done', { claimed: summary.claimed, sent: summary.sent, retried: summary.retried, failed: summary.failed, cancelled: summary.cancelled });
  return json({ ok: true, ...summary });
}

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch {
    log('worker_error');
    return json({ error: 'internal_error' }, 500);
  }
});
