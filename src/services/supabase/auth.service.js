/**
 * src/services/supabase/auth.service.js
 * منفذ حرفي للمنطق الأساسي في js/auth.js الأصلي (login/logout/session/profile/log).
 * منطق "requireAuth" (التحويل + فحص الأدوار) انتقل إلى مكوّن React
 * `ProtectedRoute` بدل دالة إجرائية، لأن React Router يتولى التوجيه.
 */
import { supabase } from './client';

export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function logout() {
  await supabase.auth.signOut();
}

/* ---------- المصادقة الثنائية (TOTP) — اختيارية؛ يفرضها الخادم لمن فعّلها (migration 0024) ---------- */

/** { currentLevel, nextLevel } — nextLevel='aal2' مع currentLevel='aal1' يعني: يلزم إدخال رمز التطبيق. */
export async function getAssuranceLevel() {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  return data;
}

/** العوامل الموثّقة (verified) فقط للمستخدم الحالي. */
export async function listVerifiedTotpFactors() {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return data?.totp || []; // المصفوفة totp تضم الموثّقة فقط في supabase-js
}

/** يبدأ تسجيل عامل جديد: يُرجع { id, qr (data:image/svg+xml), secret }. لا يصبح فعّالًا قبل verify. */
export async function enrollTotp() {
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `iae-${Date.now()}` });
  if (error) throw error;
  return { id: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/** يتحقق من رمز من 6 أرقام (تسجيل جديد أو إتمام تسجيل الدخول) ويرفع الجلسة إلى aal2. */
export async function verifyTotp(factorId, code) {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: String(code || '').trim() });
  if (error) throw error;
}

/** يلغي عاملًا (يتطلب جلسة aal2 إن كان موثّقًا). */
export async function unenrollTotp(factorId) {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}

/**
 * يغيّر كلمة مرور المستخدم الحالي ويُسقط علم must_change_password (يضعه admin-create-user للحسابات الجديدة).
 * ملاحظة: user_metadata قابل للتعديل من صاحب الحساب، فهذا العلم تنبيه لتجربة الاستخدام وليس حدًّا أمنيًا.
 */
export async function changeOwnPassword(password) {
  const { error } = await supabase.auth.updateUser({ password, data: { must_change_password: false } });
  if (error) throw error;
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * يُرجع صف profiles الخاص بالمستخدم الحالي (role/full_name/is_active...).
 *  - null  : لا يوجد صف profile لهذا المستخدم فعلاً (PGRST116) → حساب غير مُفعَّل كإداري.
 *  - يرمي خطأ : فشل مؤقت (شبكة/خادم). لا يجوز اعتباره "حساب غير نشط" وتسجيل الخروج بسببه.
 */
export async function getProfile() {
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * يسجّل عملية إدارية عبر الدالة log_admin_action (SECURITY DEFINER) — لا إدخال
 * مباشر في audit_logs من المتصفح. الخادم يشتق user_id من auth.uid() ويتحقق من
 * أن الإجراء/الكيان يطابقان صلاحية المستخدم، فلا يمكن تزوير هوية الفاعل أو نوع
 * العملية (انظر supabase/migrations/0009_announcements_board_audit.sql).
 * فشل التسجيل لا يُسقط العملية الأساسية لكنه يُسجَّل في console.
 */
export async function logAction(action, entityType, entityId, description, metadata) {
  const session = await getSession();
  if (!session) return;
  const { error } = await supabase.rpc('log_admin_action', {
    p_action: action,
    p_entity_type: entityType,
    p_entity_id: entityId || null,
    p_description: description || null,
    p_metadata: metadata || null,
  });
  if (error) {
    console.error('تعذر تسجيل العملية في سجل التدقيق (audit_logs):', error);
  }
}

export const ROLE_LABELS = {
  developer: 'مطوّر',
  super_admin: 'مسؤول أعلى',
  editor: 'محرر',
  members_manager: 'مسؤول الأعضاء',
  treasurer: 'أمين المال',
  secretary_general: 'الكاتب العام',
  deputy_secretary_general: 'نائب الكاتب العام',
  deputy_treasurer: 'نائب أمين المال',
  deputy_super_admin: 'نائب المسؤول الأعلى',
};
