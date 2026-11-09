// supabase/functions/member-activate-email/index.ts
//
// خطوة «تأكيد/تصحيح البريد» قبل تفعيل حساب المنخرط (migration 0048). دالة عامة (verify_jwt = false) كـ member-activate:
// الهوية = حيازة رمز التفعيل الذي أصدرته الإدارة. لا SMTP ولا رسالة تحقق.
//
//   1) throttle مستقل (مفتاح email:<ip>) في القاعدة، مع حدّ محلي احتياطي.
//   2) set_member_activation_email(token, email) ← يتحقق من الرمز (لا يستهلكه) ومن الصيغة ومن عدم استعمال البريد مع حساب آخر،
//      ثم يحدّث members.email ويعلّم الرابط «بريد مؤكَّد». لا يُنشأ هنا أي مستخدم Auth؛ member-activate ينشئه بهذا البريد.
//   تبقى member-activate لا تقرأ أي بريد من العميل، وترفض التفعيل الجديد قبل هذه الخطوة.
//
// النشر:  supabase functions deploy member-activate-email --no-verify-jwt

import { createClient } from 'jsr:@supabase/supabase-js@2';

const DEFAULT_ORIGINS = ['https://fsa-iae.netlify.app', 'http://localhost:5173', 'http://localhost:4173'];
const PREVIEW_ORIGIN_RE = /^https:\/\/[a-z0-9-]+--fsa-iae\.netlify\.app$/;

function corsFor(req: Request): Record<string, string> {
  const extra = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get('Origin') || '';
  const ok = origin !== '' && ([...DEFAULT_ORIGINS, ...extra].includes(origin) || PREVIEW_ORIGIN_RE.test(origin));
  return {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
    ...(ok ? { 'Access-Control-Allow-Origin': origin } : {}),
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 8;
const recentCalls = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const hits = (recentCalls.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) {
    recentCalls.set(key, hits);
    return true;
  }
  hits.push(now);
  recentCalls.set(key, hits);
  if (recentCalls.size > 5000) recentCalls.clear();
  return false;
}

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

async function dbRateLimited(client: RpcClient, key: string): Promise<boolean | null> {
  try {
    const { data, error } = await client.rpc('member_activation_throttle_hit', { p_key: key });
    if (error) {
      console.error('member-activate-email: throttle rpc failed:', error);
      return null;
    }
    return data === true;
  } catch (err) {
    console.error('member-activate-email: throttle rpc error:', err);
    return null;
  }
}

const INVALID_LINK = 'رابط التفعيل غير صالح أو منتهي أو مستعمل. اطلب رابطًا جديدًا من الإدارة.';
const EMAIL_INVALID = 'صيغة البريد الإلكتروني غير صالحة';
const EMAIL_TAKEN = 'هذا البريد الإلكتروني مستخدم مع حساب آخر. اكتب بريدًا آخر.';
const EMAIL_ATTEMPTS = 'تجاوزت عدد المحاولات المسموح بها لهذا الرابط. اطلب رابطًا جديدًا من الإدارة.';

// نفس شرط القاعدة (أضيق من members_email_format_chk)؛ القاعدة هي المرجع النهائي
export function normalizeEmail(raw: unknown): string | null {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v.length > 150 || v.split('@')[0].length > 64 || v.includes('..')) return null;
  return /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(v) ? v : null;
}

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok');

  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const ip = (req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
    const key = `email:${ip}`; // دلو مستقل عن دلو كلمة المرور في member-activate
    const limited = ip === 'unknown' ? null : await dbRateLimited(adminClient, key);
    if (limited === true || (limited === null && rateLimited(key))) return json({ error: 'محاولات كثيرة، حاول لاحقًا' }, 429);

    const body = await req.json().catch(() => ({}));
    const token = String(body.token || '').trim();
    if (!/^[0-9a-f]{64}$/.test(token)) return json({ error: INVALID_LINK }, 400);

    const email = normalizeEmail(body.email);
    if (!email) return json({ error: EMAIL_INVALID, code: 'invalid_format' }, 400);

    const { data, error } = await adminClient.rpc('set_member_activation_email', { p_token: token, p_email: email });
    if (error) {
      if (String(error.message || '').includes('activation_link_invalid')) return json({ error: INVALID_LINK }, 400);
      console.error('member-activate-email: rpc failed:', error);
      return json({ error: 'خطأ داخلي في الخادم' }, 500);
    }

    if (data?.ok === true) return json({ ok: true, email: data.email });
    if (data?.reason === 'email_taken') return json({ error: EMAIL_TAKEN, code: 'email_taken' }, 409);
    if (data?.reason === 'attempts_exceeded') return json({ error: EMAIL_ATTEMPTS, code: 'attempts_exceeded' }, 429);
    return json({ error: EMAIL_INVALID, code: 'invalid_format' }, 400);
  } catch (err) {
    console.error('member-activate-email error:', err);
    return json({ error: 'خطأ داخلي في الخادم' }, 500);
  }
}

Deno.serve(async (req: Request) => {
  const res = await handle(req);
  for (const [k, v] of Object.entries(corsFor(req))) res.headers.set(k, v);
  return res;
});
