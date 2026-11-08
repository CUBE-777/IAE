import { supabase } from './client';
import { logAction, ROLE_LABELS } from './auth.service';

export { ROLE_LABELS };

export async function fetchAdminProfiles() {
  const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function updateAdminProfile(existing, payload) {
  // البريد الإلكتروني مصدره Supabase Auth؛ تعديل نسخة profiles وحدها يُنتج بيانات
  // غير متزامنة (وقاعدة البيانات ترفض ذلك أصلاً — migration 0009). لذلك لا يُرسل هنا.
  const safePayload = { ...payload };
  delete safePayload.email;
  const { error } = await supabase.from('profiles').update(safePayload).eq('id', existing.id);
  if (error) throw error;
  // إصلاح موثّق في الأصل: هذه الصفحة لم تكن تسجّل أي عملية في audit_logs رغم أنها
  // الأكثر حساسية أمنيًا (منح/سحب صلاحيات الدخول والأدوار). أُبقي التسجيل هنا.
  await logAction(
    'ADMIN_UPDATED_ADMIN', 'profiles', existing.id,
    `تعديل صلاحيات المسؤول ${safePayload.full_name} (${existing.email}) — الدور: ${ROLE_LABELS[safePayload.role] || safePayload.role}`
  );
}

/** ينشئ المسؤول بالكامل على الخادم عبر Edge Function (تستخدم service_role هناك فقط، وليس في المتصفح). */
export async function createAdminProfile({ email, full_name, role, password, link_existing_member = false }) {
  // تأكد من وجود جلسة صالحة وأرسل access token صراحةً إلى Edge Function.
  // لا نرسل service_role من المتصفح؛ هذا رمز المستخدم الحالي فقط.
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (sessionError || !accessToken) {
    const e = new Error('انتهت جلسة الدخول أو لا توجد جلسة صالحة. سجّل الدخول مجددًا ثم أعد المحاولة.');
    e.userMessage = e.message;
    throw e;
  }

  const { data, error } = await supabase.functions.invoke('admin-create-user', {
    // link_existing_member: تأكيد صريح لمنح صفة إدارية لمنخرط قائم (0046)؛ لا يُرسل إلا عند الحاجة
    body: { email, full_name, role, password, ...(link_existing_member ? { link_existing_member: true } : {}) },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (error) {
    // الاستجابة غير الناجحة تحمل سبب الرفض بالعربية في جسمها؛ نعرضه بدل الرسالة العامة
    let userMessage = '';
    let code = '';
    let memberName = '';
    try {
      const body = await error.context?.json?.();
      userMessage = body?.error || '';
      code = body?.code || '';
      memberName = body?.member_name || '';
    } catch {
      /* لا شيء */
    }
    const e = new Error(userMessage || error.message);
    e.userMessage = userMessage;
    e.code = code;               // member_account_exists: البريد لمنخرط قائم ويحتاج تأكيدًا
    e.memberName = memberName;
    throw e;
  }
  if (data?.error) {
    const e = new Error(data.error);
    e.userMessage = data.error;
    throw e;
  }
  await logAction(
    'ADMIN_CREATED_ADMIN', 'profiles', data?.id || null,
    data?.linked_existing_member
      ? `منح صفة إدارية لمنخرط قائم: ${full_name} (${email}) — الدور: ${ROLE_LABELS[role] || role}`
      : `إنشاء مسؤول جديد: ${full_name} (${email}) — الدور: ${ROLE_LABELS[role] || role}`
  );
  return data;
}

/**
 * إزالة صلاحية الوصول = تعطيل (is_active = false)، وليس حذف الصف.
 * إصلاح موثّق في الأصل: كانت هذه العملية تحذف الصف نهائيًا رغم أن نص التأكيد في
 * الواجهة يَعِد بأن الحساب "لن يُحذف" ويمكن إعادة تفعيله — الحذف الفعلي كان
 * يخالف هذا الوعد ويمنع أي رجوع. أُبقي السلوك المصحَّح (تعطيل فقط) هنا.
 */
export async function deactivateAdminProfile(profile) {
  const { error } = await supabase.from('profiles').update({ is_active: false }).eq('id', profile.id);
  if (error) throw error;
  await logAction('ADMIN_DEACTIVATED_ADMIN', 'profiles', profile.id, `إزالة صلاحية الوصول عن المسؤول ${profile.full_name} (${profile.email})`);
}
