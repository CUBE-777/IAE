/**
 * src/services/supabase/announcements.service.js
 * قراءة عامة للإعلانات. لا تصفية زمنية على العميل: سياسة RLS
 * "announcements_public_read_active" هي المرجع (is_active + نافذة start_at/end_at)،
 * فلا يمكن لأي استعلام عام أن يرى مسودة أو إعلانًا منتهيًا.
 */
import { supabase } from './client';

export const ANNOUNCEMENT_TYPES = ['general', 'important', 'event', 'membership', 'notice'];
export const ANNOUNCEMENTS_PAGE_SIZE = 9;

const LIST_COLUMNS =
  'id, slug, text, title, excerpt, image_url, type, is_pinned, link, start_at, end_at, created_at, translations';
const DETAIL_COLUMNS = `${LIST_COLUMNS}, content`;

function applyOrder(query) {
  return query
    .order('is_pinned', { ascending: false })
    .order('start_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
}

/** قائمة الإعلانات المنشورة. تُرجع { rows, hasMore } مع ترقيم بالإزاحة. */
export async function fetchPublishedAnnouncements({ limit = ANNOUNCEMENTS_PAGE_SIZE, offset = 0, type = '' } = {}) {
  let query = supabase.from('announcements').select(LIST_COLUMNS).eq('is_active', true);
  if (type) query = query.eq('type', type);
  query = applyOrder(query).range(offset, offset + limit); // نطلب عنصرًا إضافيًا لمعرفة وجود المزيد
  const { data, error } = await query;
  if (error) throw error;
  const rows = data || [];
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
}

export async function fetchAnnouncementBySlug(slug) {
  const { data, error } = await supabase
    .from('announcements')
    .select(DETAIL_COLUMNS)
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  return data || null; // null = غير موجود / غير منشور / منتهي (RLS)
}
