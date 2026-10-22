import { supabase } from './client';
import { logAction } from './auth.service';
import { isMissingColumn } from './profileColumns';

export const SETTINGS_GROUPS = [
  {
    title: 'عام',
    keys: [
      ['association_name', 'اسم النادي'],
      ['email', 'البريد الإلكتروني'],
      ['phone', 'الهاتف'],
      ['address', 'العنوان'],
    ],
  },
  {
    title: 'التواصل الاجتماعي',
    keys: [
      ['whatsapp', 'واتساب (بدون +)'],
      ['facebook', 'رابط فيسبوك'],
      ['instagram', 'رابط إنستغرام'],
      ['youtube', 'رابط يوتيوب'],
    ],
  },
  { title: 'الخريطة', keys: [['google_maps_url', 'رابط خرائط Google']] },
  {
    title: 'الانخراط',
    keys: [
      ['membership_fee', 'مبلغ الانخراط السنوي (درهم)'],
      ['current_season', 'الموسم الجامعي الحالي (مثال: 2026/2027)'],
    ],
  },
];

// مفاتيح الإعدادات النصية القابلة للترجمة (البريد والهاتف والروابط لا تُترجم)
export const TRANSLATABLE_SETTINGS = ['association_name', 'address'];

export async function fetchSiteSettingsAdmin() {
  const { data, error } = await supabase.from('site_settings').select('*');
  if (error) throw error;
  return data || [];
}

// يُرجع { degraded } = true إن حُفظت النصوص العربية فقط لأن عمود translations (0015) غير موجود بعد.
export async function saveSiteSettings(rows) {
  let degraded = false;
  let { error } = await supabase.from('site_settings').upsert(rows, { onConflict: 'key' });
  if (error && isMissingColumn(error) && rows.some((r) => 'translations' in r)) {
    degraded = true;
    ({ error } = await supabase
      .from('site_settings')
      .upsert(rows.map(({ translations, ...rest }) => rest), { onConflict: 'key' }));
  }
  if (error) throw error;
  await logAction('ADMIN_UPDATED_SETTINGS', 'site_settings', null, 'تحديث الإعدادات العامة');
  return { degraded };
}
