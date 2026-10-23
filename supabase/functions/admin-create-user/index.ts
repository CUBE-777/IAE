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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'مطلوب تسجيل الدخول' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // عميل بصلاحية المستدعي: للتحقق من هويته فقط
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
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
      return json({ error: createErr?.message || 'تعذر إنشاء المستخدم' }, 400);
    }

    const { error: insertErr } = await adminClient.from('profiles').insert({
      id: created.user.id,
      full_name,
      email,
      role,
      is_active: true,
    });
    if (insertErr) {
      // تراجع: لا يبقى حساب Auth بلا profile
      await adminClient.auth.admin.deleteUser(created.user.id);
      return json({ error: insertErr.message }, 400);
    }

    return json({ id: created.user.id, message: 'تم إنشاء المسؤول.' });
  } catch (err) {
    console.error('admin-create-user error:', err);
    return json({ error: 'خطأ داخلي في الخادم' }, 500);
  }
});
