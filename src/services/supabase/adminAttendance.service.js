import { supabase } from './client';

/** نشر بطاقة الحضور لنشاط (idempotent). rotate = إعادة إصدار كل الرموز (تسرّب مثلًا). 0041 */
export async function publishAttendanceCard(activityId, rotate = false) {
  const { data, error } = await supabase.rpc('publish_attendance_card', { p_activity_id: activityId, p_rotate: !!rotate });
  if (error) throw error;
  return data;
}

export async function closeAttendanceCard(activityId) {
  const { error } = await supabase.rpc('close_attendance_card', { p_activity_id: activityId });
  if (error) throw error;
}

/** تسجيل حضور بمسح رمز: { result: 'recorded'|'already'|'invalid', member?, activity?, checked_in_at? } */
export async function recordAttendance(token) {
  const { data, error } = await supabase.rpc('record_attendance', { p_token: String(token || '') });
  if (error) throw error;
  return data || { result: 'invalid' };
}

export async function recordAttendanceManual(activityId, memberId) {
  const { data, error } = await supabase.rpc('record_attendance_manual', { p_activity_id: activityId, p_member_id: memberId });
  if (error) throw error;
  return data || { result: 'invalid' };
}

export async function undoAttendance(activityId, memberId) {
  const { error } = await supabase.rpc('undo_attendance', { p_activity_id: activityId, p_member_id: memberId });
  if (error) throw error;
}

/** { published_at, closed_at, open, members: [{ member_id, full_name, photo_url, promotion, attended_at, method }] } أو null */
export async function getAttendanceRoster(activityId) {
  const { data, error } = await supabase.rpc('get_attendance_roster', { p_activity_id: activityId });
  if (error) throw error;
  return data || null;
}

/** [{ activity_id, open, attended }] لكل نشاط نُشرت بطاقته */
export async function getAttendanceCardsOverview() {
  const { data, error } = await supabase.rpc('get_attendance_cards_overview');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}
