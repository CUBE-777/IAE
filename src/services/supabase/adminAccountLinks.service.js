import { supabase } from './client';

/**
 * ربط الحساب الإداري بفضاء المنخرطين وببطاقة المكتب (supabase/migrations/0046).
 * الدوال تتحقق من الدور (مسؤول أعلى/مطوّر) في الخادم؛ الواجهة تُخفي الأزرار فقط.
 * كلمة المرور واحدة للصفتين (مستخدم Auth واحد)، ولا يُنشأ أي مستخدم جديد هنا.
 */

/**
 * لكل حساب إداري: { user_id, full_name, email, role, is_active, account: { member_id, is_active, admin_linked } | null,
 * member_name, board: { id, full_name, position } | null, suggest_board: {...} | null }.
 * يرمي خطأ إن لم تُطبَّق 0046 (الصفحة تُخفي العمود حينها).
 */
export async function fetchAdminMemberLinkOverview() {
  const { data, error } = await supabase.rpc('get_admin_member_link_overview');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

/** يربط الحساب بسجل عضو (يُنشأ إن لزم) وببطاقة المكتب إن حُدِّدت. يُرجع { member_id, board_member_id, member_created }. */
export async function linkAdminAsMember(userId, boardMemberId = null, memberId = null) {
  const { data, error } = await supabase.rpc('link_admin_as_member', {
    p_user_id: userId,
    p_board_member_id: boardMemberId,
    p_member_id: memberId,
  });
  if (error) throw error;
  return data;
}

/** يعطّل جانب المنخرط فقط؛ الصفة الإدارية لا تتأثر. */
export async function unlinkAdminAsMember(userId) {
  const { error } = await supabase.rpc('unlink_admin_as_member', { p_user_id: userId });
  if (error) throw error;
}
