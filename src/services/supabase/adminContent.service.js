import { supabase } from './client';
import { logAction } from './auth.service';
import { isMissingColumn } from './profileColumns';

export const CONTENT_FIELDS = [
  { section: 'homepage', key: 'hero_title', label: 'عنوان الصفحة الرئيسية (Hero)' },
  { section: 'homepage', key: 'about_title', label: 'عنوان قسم من نحن' },
  { section: 'footer', key: 'copyright', label: 'نص حقوق النشر بالفوتر' },
];

export async function fetchSiteContentAdmin() {
  const { data, error } = await supabase.from('site_content').select('*');
  if (error) throw error;
  return data || [];
}

// يُرجع { degraded } = true إن حُفظت النصوص العربية فقط لأن عمود translations (0013) غير موجود بعد.
export async function saveSiteContent(rows) {
  let degraded = false;
  let { error } = await supabase.from('site_content').upsert(rows, { onConflict: 'section,key' });
  if (error && isMissingColumn(error) && rows.some((r) => 'translations' in r)) {
    degraded = true;
    ({ error } = await supabase
      .from('site_content')
      .upsert(rows.map(({ translations, ...rest }) => rest), { onConflict: 'section,key' }));
  }
  if (error) throw error;
  await logAction('ADMIN_UPDATED_CONTENT', 'site_content', null, 'تحديث محتوى الموقع');
  return { degraded };
}
