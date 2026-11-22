import { supabase } from './client';
import { logAction } from './auth.service';
import { isMissingColumn } from './profileColumns';
import { GAMES_STATUS, GAMES_STATUS_KEY } from '../../features/games/maintenance/gamesStatusCore';

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

/**
 * حالة قسم الألعاب (0062): صف واحد في site_settings (key = games_section_status). الكتابة محصورة في is_super_admin() (super_admin + developer)
 * بسياسات RLS القائمة (0003)، ومشغّل SQL يرفض أي قيمة غير enabled/maintenance. هذه الدالة تكتب هذا الصف فقط
 * (upsert جزئي: لا يلمس بقية الإعدادات ولا عمود translations) ثم تسجّل العملية في سجل التدقيق.
 * RLS قد ترفض بصمت (0 صفوف) فنتحقق من الصفوف المُرجعة بدل افتراض النجاح.
 */
export async function saveGamesSectionStatus(status) {
  if (status !== GAMES_STATUS.ENABLED && status !== GAMES_STATUS.MAINTENANCE) throw new Error('invalid_games_section_status');
  const { data, error } = await supabase
    .from('site_settings')
    .upsert({ key: GAMES_STATUS_KEY, value: status }, { onConflict: 'key' })
    .select('key, value');
  if (error) throw error;
  if (!data?.length || data[0].value !== status) throw new Error('games_section_status_not_saved');
  await logAction(
    'ADMIN_SET_GAMES_STATUS',
    'site_settings',
    null,
    status === GAMES_STATUS.MAINTENANCE ? 'تفعيل وضع الصيانة لقسم الألعاب' : 'إنهاء وضع الصيانة وإعادة تفعيل قسم الألعاب',
  );
  return status;
}
