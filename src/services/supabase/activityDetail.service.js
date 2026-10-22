import { supabase } from './client';

export async function fetchActivityBySlug(slug) {
  const BASE = 'slug, title, description, category, target_audience, date, time, location, cover_image_url, sub_activities';
  const query = (cols) => supabase
    .from('activities')
    .select(cols)
    .eq('slug', slug)
    .eq('status', 'published')
    .is('deleted_at', null)
    .maybeSingle();
  // الترجمات (migration 0015) اختيارية: إن لم يوجد العمود بعد نرجع للأعمدة الأساسية
  let res = await query(`${BASE}, translations`);
  if (res.error) res = await query(BASE);
  const { data, error } = res;
  if (error) throw error;
  if (!data) return null;
  return {
    title: data.title,
    date: data.date || null, // يُنسَّق في الواجهة بحسب اللغة الحالية
    location: data.location,
    category: data.category,
    target: data.target_audience,
    image: data.cover_image_url,
    content: data.description,
    sub_activities: Array.isArray(data.sub_activities) ? data.sub_activities : [],
    translations: data.translations || null,
  };
}
