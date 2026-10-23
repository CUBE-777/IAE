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

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** يُرجع صف profiles الخاص بالمستخدم الحالي (role/full_name/is_active...) أو null. */
export async function getProfile() {
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
  if (error) return null;
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
