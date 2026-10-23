import { supabase } from './client';

export const AUDIT_PAGE_SIZE = 20;

export const AUDIT_ENTITY_OPTIONS = [
  ['', 'كل الأقسام'],
  ['members', 'الأعضاء'],
  ['membership_requests', 'طلبات الانخراط'],
  ['activities', 'الأنشطة'],
  ['projects', 'المشاريع'],
  ['internal_files', 'الملفات الداخلية'],
  ['gallery', 'المعرض'],
  ['board_members', 'أعضاء المكتب'],
  ['announcements', 'الإعلانات'],
  ['site_content', 'محتوى الموقع'],
  ['site_settings', 'الإعدادات'],
  ['profiles', 'المستخدمون الإداريون'],
  ['budget_transactions', 'الميزانية'],
  ['budget_categories', 'فئات الميزانية'],
];

export async function fetchAuditLogs({ page, entity }) {
  let query = supabase.from('audit_logs').select('*, profiles(full_name)', { count: 'exact' });
  if (entity) query = query.eq('entity_type', entity);
  const from = (page - 1) * AUDIT_PAGE_SIZE;
  query = query.order('created_at', { ascending: false }).range(from, from + AUDIT_PAGE_SIZE - 1);
  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: data || [], total: count || 0 };
}
