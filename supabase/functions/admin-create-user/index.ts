// supabase/functions/admin-create-user/index.ts
//
// ينشئ مسؤولًا جديدًا (حساب Auth + صف profiles) في عملية خادم واحدة.
// يستدعيها super_admin أو developer فقط من واجهة /admin/admins.
//
// تغييرات هذه النسخة:
//  - إنشاء الحساب بكلمة المرور القادمة من النموذج (createUser) لتطابق نص الواجهة:
//    "سلّمه البريد وكلمة المرور ليدخل من صفحة تسجيل الدخول".
//  - قبول الأدوار treasurer و developer وأدوار المكتب الجديدة (الكاتب العام ونوّابه).
//  - دور developer لا يستطيع منحه إلا developer (الـ service_role يتجاوز triggers القاعدة).
//
//  - علم «تغيير كلمة المرور المؤقتة» يُحفظ في profiles.must_change_password (migration 0027) لا في
//    user_metadata (الذي يستطيع صاحب الحساب تعديله)، ويُسقطه trigger في القاعدة عند تغيّر كلمة المرور.
//  - رسائل الخطأ الداخلية لا تُعاد للعميل، وحدّ بسيط لعدد عمليات الإنشاء لكل مستدعٍ.
//
// service_role يبقى داخل بيئة الـ Edge Function فقط.
// النشر:  supabase functions deploy admin-create-user

import { createClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED_ROLES = [
  'super_admin',
  'editor',
  'members_manager',
  'treasurer',
  'developer',
  // أدوار المكتب (migration 0019)
  'secretary_general',
  'deputy_secretary_general',
  'deputy_treasurer',
  'deputy_super_admin',
];
const CALLER_ROLES = ['super_admin', 'developer'];

// CORS: لا نردّ بـ '*'. نسمح بنطاق الموقع ونسخ المعاينة على Netlify والتطوير المحلي، ويمكن إضافة نطاقات
// (نطاق مخصص مثلًا) عبر السر ALLOWED_ORIGINS (قائمة مفصولة بفواصل):
//   supabase secrets set ALLOWED_ORIGINS="https://my-domain.org,https://www.my-domain.org"
// ملاحظة: الدالة تتحقق من الجلسة والدور على أي حال؛ هذا تضييق إضافي لا بديل عن التحقق.
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

/** مستوى الضمان (aal1/aal2) من حمولة JWT. يُستدعى فقط بعد أن تحقّق auth.getUser من صحة الرمز. */
function jwtAal(token: string): string {
  try {
    const part = token.split('.')[1] || '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    return typeof payload.aal === 'string' ? payload.aal : 'aal1';
  } catch {
    return 'aal1';
  }
}

// حدّ بسيط (best-effort) لكل نسخة تشغيل: 10 عمليات إنشاء لكل مستدعٍ خلال 10 دقائق.
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 10;
const recentCalls = new Map<string, number[]>();

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const hits = (recentCalls.get(userId) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) {
    recentCalls.set(userId, hits);
    return true;
  }
  hits.push(now);
  recentCalls.set(userId, hits);
  return false;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok');

  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'مطلوب تسجيل الدخول' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // عميل بصلاحية المستدعي: للتحقق من هويته فقط
    // ملاحظة: بوابة Supabase (verify_jwt) تعطّلت لهذه الدالة في supabase/config.toml لأنها
    // ترفض رموز المستخدمين الموقّعة بمفاتيح JWT غير المتماثلة الجديدة (401 قبل وصول الطلب للدالة).
    // التحقق الفعلي من الهوية يتم هنا عبر auth.getUser(token) ثم فحص الدور في profiles.
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'مطلوب تسجيل الدخول' }, 401);
    const callerClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userErr } = await callerClient.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: 'جلسة غير صالحة' }, 401);

    // عميل service_role: للتحقق من دور المستدعي وللإنشاء. لا يُستخدم إلا هنا.
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerProfile, error: profileErr } = await adminClient
      .from('profiles')
      .select('role, is_active')
      .eq('id', userData.user.id)
      .single();

    if (profileErr || !callerProfile || !callerProfile.is_active || !CALLER_ROLES.includes(callerProfile.role)) {
      return json({ error: 'غير مصرح لك بإنشاء مستخدمين إداريين' }, 403);
    }

    // المصادقة الثنائية: هذه الدالة تعمل بـ service_role فلا تمرّ عبر RLS (migration 0024)، لذا نطبّق
    // القاعدة نفسها هنا: من فعّل عاملًا موثّقًا يجب أن تكون جلسته aal2، وإلا كفت كلمة المرور وحدها
    // لإنشاء مسؤول جديد. من لم يفعّل MFA لا يتغيّر عليه شيء. الرمز تحقّق منه getUser أعلاه فقراءة claim آمنة.
    if (jwtAal(token) !== 'aal2') {
      const { data: factorData, error: factorErr } = await adminClient.auth.admin.mfa.listFactors({
        userId: userData.user.id,
      });
      if (factorErr) {
        console.error('admin-create-user: listFactors failed:', factorErr);
        return json({ error: 'تعذر التحقق من المصادقة الثنائية، حاول لاحقًا' }, 500);
      }
      const hasVerifiedFactor = (factorData?.factors || []).some((f: { status?: string }) => f.status === 'verified');
      if (hasVerifiedFactor) {
        return json({ error: 'أدخل رمز المصادقة الثنائية (سجّل الخروج ثم الدخول وأكمل الرمز) ثم أعد المحاولة' }, 403);
      }
    }

    if (rateLimited(userData.user.id)) {
      return json({ error: 'محاولات كثيرة، حاول لاحقًا' }, 429);
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    const full_name = String(body.full_name || '').trim();
    const role = String(body.role || '').trim();
    const password = String(body.password || '');

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'بريد إلكتروني غير صالح' }, 400);
    if (full_name.length < 2 || full_name.length > 150) return json({ error: 'الاسم الكامل مطلوب' }, 400);
    if (!ALLOWED_ROLES.includes(role)) return json({ error: 'دور غير صالح' }, 400);
    if (password.length < 8 || password.length > 72) {
      return json({ error: 'كلمة المرور يجب أن تكون بين 8 و72 حرفًا' }, 400);
    }

    // منح دور المطوّر حصرًا للمطوّر
    if (role === 'developer' && callerProfile.role !== 'developer') {
      return json({ error: 'لا يستطيع منح دور المطوّر إلا مطوّر' }, 403);
    }

    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr || !created?.user) {
      console.error('admin-create-user: createUser failed:', createErr);
      const msg = String(createErr?.message || '').toLowerCase();
      if (createErr?.status === 422 || msg.includes('already') || msg.includes('registered')) {
        return json({ error: 'هذا البريد الإلكتروني مسجّل مسبقًا' }, 409);
      }
      if (msg.includes('password')) {
        return json({ error: 'كلمة المرور غير مقبولة (اختر كلمة أقوى)' }, 400);
      }
      return json({ error: 'تعذر إنشاء المستخدم' }, 400);
    }

    const { error: insertErr } = await adminClient.from('profiles').insert({
      id: created.user.id,
      full_name,
      email,
      role,
      is_active: true,
      // الحساب الجديد يُلزَم بتغيير كلمة المرور المؤقتة عند أول دخول (ForcePasswordChange في الواجهة)
      must_change_password: true,
    });
    if (insertErr) {
      // تراجع: لا يبقى حساب Auth بلا profile
      console.error('admin-create-user: profile insert failed:', insertErr);
      await adminClient.auth.admin.deleteUser(created.user.id);
      return json({ error: 'تعذر إنشاء ملف المسؤول' }, 400);
    }

    return json({ id: created.user.id, message: 'تم إنشاء المسؤول.' });
  } catch (err) {
    console.error('admin-create-user error:', err);
    return json({ error: 'خطأ داخلي في الخادم' }, 500);
  }
}

Deno.serve(async (req: Request) => {
  const res = await handle(req);
  for (const [k, v] of Object.entries(corsFor(req))) res.headers.set(k, v);
  return res;
});
