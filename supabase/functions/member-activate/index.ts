// supabase/functions/member-activate/index.ts
//
// تفعيل حساب عضو في «فضاء المنخرطين» برابط التفعيل الشخصي (migration 0036).
// دالة عامة (بلا جلسة): الهوية تُثبت بحيازة الرمز السرّي الذي أصدره المسؤول، وليس بـ JWT، ولذلك
// verify_jwt = false في supabase/config.toml (كما في admin-create-user).
//
// الخطوات (كلها بـ service_role داخل هذه الدالة فقط):
//   1) prepare_member_activation(token)  ← يتحقق من الرمز (صالح/غير مستعمل/غير منتهٍ) ويعيد بريد العضو من سجلات الإدارة.
//      البريد لا يأتي من العميل أبدًا، فلا يستطيع أحد تفعيل حساب ببريد غير المسجّل للعضو.
//   2) auth.admin.createUser(email, password)  ← كلمة المرور يختارها العضو بنفسه.
//   3) finalize_member_activation(token, user_id) ← يربط المستخدم بالعضو ويُبطل الرمز. عند أي فشل يُحذف المستخدم (تراجع).
//
// النشر:  supabase functions deploy member-activate
// ملاحظة: يجب تعطيل التسجيل الذاتي في Supabase (Authentication → Sign In / Providers → Allow new users to sign up = off)
//         كي لا يُنشئ الغرباء حسابات؛ createUser من الإدارة لا يتأثر بذلك الإعداد.

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

// حدّ بسيط (best-effort) لكل نسخة تشغيل: 8 محاولات لكل عنوان خلال 10 دقائق. الحماية الحقيقية هي عشوائية
// الرمز (256 بت) وأنه يُستعمل مرة واحدة.
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
  if (recentCalls.size > 5000) recentCalls.clear(); // لا نسمح بنمو غير محدود للذاكرة
  return false;
}

const INVALID_LINK = 'رابط التفعيل غير صالح أو منتهي أو مستعمل. اطلب رابطًا جديدًا من الإدارة.';

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok');

  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const ip = (req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
    if (rateLimited(ip)) return json({ error: 'محاولات كثيرة، حاول لاحقًا' }, 429);

    const body = await req.json().catch(() => ({}));
    const token = String(body.token || '').trim();
    const password = String(body.password || '');

    // الرمز = uuid + uuid بلا شرطات = 64 خانة سداسية (انظر issue_member_activation_link)
    if (!/^[0-9a-f]{64}$/.test(token)) return json({ error: INVALID_LINK }, 400);
    if (password.length < 8 || password.length > 72) {
      return json({ error: 'كلمة المرور يجب أن تكون بين 8 و72 حرفًا' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1) التحقق من الرمز وجلب البريد المسجّل للعضو
    const { data: prep, error: prepErr } = await adminClient.rpc('prepare_member_activation', { p_token: token });
    if (prepErr || !prep?.email) {
      if (prepErr && !String(prepErr.message || '').includes('activation_link_invalid')) {
        console.error('member-activate: prepare failed:', prepErr);
        return json({ error: 'خطأ داخلي في الخادم' }, 500);
      }
      return json({ error: INVALID_LINK }, 400);
    }

    // 2) إنشاء حساب Auth بكلمة المرور التي اختارها العضو
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email: prep.email,
      password,
      email_confirm: true,
    });
    if (createErr || !created?.user) {
      console.error('member-activate: createUser failed:', createErr);
      const msg = String(createErr?.message || '').toLowerCase();
      if (createErr?.status === 422 && msg.includes('password')) {
        return json({ error: 'كلمة المرور غير مقبولة (اختر كلمة أقوى)' }, 400);
      }
      if (createErr?.status === 422 || msg.includes('already') || msg.includes('registered')) {
        return json({ error: 'هذا البريد مسجّل مسبقًا. تواصل مع الإدارة.' }, 409);
      }
      if (msg.includes('password')) return json({ error: 'كلمة المرور غير مقبولة (اختر كلمة أقوى)' }, 400);
      return json({ error: 'تعذر إنشاء الحساب' }, 400);
    }

    // 3) الربط وإبطال الرمز؛ عند الفشل نتراجع فلا يبقى مستخدم Auth بلا عضو
    const { error: finErr } = await adminClient.rpc('finalize_member_activation', {
      p_token: token,
      p_user_id: created.user.id,
    });
    if (finErr) {
      console.error('member-activate: finalize failed:', finErr);
      await adminClient.auth.admin.deleteUser(created.user.id);
      if (String(finErr.message || '').includes('activation_link_invalid')) return json({ error: INVALID_LINK }, 400);
      return json({ error: 'تعذر إكمال التفعيل' }, 400);
    }

    return json({ ok: true, email: prep.email });
  } catch (err) {
    console.error('member-activate error:', err);
    return json({ error: 'خطأ داخلي في الخادم' }, 500);
  }
}

Deno.serve(async (req: Request) => {
  const res = await handle(req);
  for (const [k, v] of Object.entries(corsFor(req))) res.headers.set(k, v);
  return res;
});
