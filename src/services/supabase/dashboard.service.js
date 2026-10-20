import { supabase } from './client';

/**
 * يُرجع قائمة مؤشرات بصيغة { key, value, error }:
 *  - value = رقم (قد يكون 0 فعلاً) عند النجاح
 *  - value = null و error = true عند فشل الاستعلام
 * بهذا تفرّق الواجهة بين "0 سجل" و"تعذر التحميل" بدل عرض 0 كاذب عند الفشل.
 */
function toStat(key, res) {
  if (res.error) {
    console.error(`تعذر تحميل مؤشر ${key}:`, res.error);
    return { key, value: null, error: true };
  }
  return { key, value: res.count ?? 0, error: false };
}

export async function fetchDashboardStats() {
  const [members, pending, activities, gallery, announcements] = await Promise.all([
    supabase.from('members').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    supabase.from('membership_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('activities').select('id', { count: 'exact', head: true }).eq('status', 'published').is('deleted_at', null),
    supabase.from('gallery').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    supabase.from('announcements').select('id', { count: 'exact', head: true }).eq('is_active', true),
  ]);
  return [
    toStat('statMembers', members),
    toStat('statPending', pending),
    toStat('statActivities', activities),
    toStat('statGallery', gallery),
    toStat('statAnnouncements', announcements),
  ];
}

export async function fetchRecentMembershipRequests(limit = 5) {
  const { data, error } = await supabase
    .from('membership_requests')
    .select('id, full_name, email, status, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function fetchRecentAuditLogs(limit = 6) {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, action, description, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}
