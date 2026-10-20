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
export async function createAdminProfile({ email, full_name, role, password }) {
  const { data, error } = await supabase.functions.invoke('admin-create-user', { body: { email, full_name, role, password } });
  if (error) {
    // الاستجابة غير الناجحة تحمل سبب الرفض بالعربية في جسمها؛ نعرضه بدل الرسالة العامة
    let userMessage = '';
    try {
      const body = await error.context?.json?.();
      userMessage = body?.error || '';
    } catch {
      /* لا شيء */
    }
    const e = new Error(userMessage || error.message);
    e.userMessage = userMessage;
    throw e;
  }
  if (data?.error) {
    const e = new Error(data.error);
    e.userMessage = data.error;
    throw e;
  }
  await logAction('ADMIN_CREATED_ADMIN', 'profiles', data?.id || null, `إنشاء مسؤول جديد: ${full_name} (${email}) — الدور: ${ROLE_LABELS[role] || role}`);
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
