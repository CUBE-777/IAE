import { supabase } from './client';
import { logAction } from './auth.service';
import { CARD_SECTION, CARD_KEY, normalizeConfig, serializeConfig } from '../../utils/peopleCardConfig';

/** يقرأ الإعدادات الحالية (جلسة المسؤول). صف غير موجود = الافتراضي. */
export async function fetchPeopleCardConfigAdmin() {
  const { data, error } = await supabase
    .from('site_content')
    .select('value')
    .eq('section', CARD_SECTION)
    .eq('key', CARD_KEY)
    .maybeSingle();
  if (error) throw error;
  return normalizeConfig(data?.value);
}

/** يحفظ الإعدادات كاملة (members + board) في صف واحد. الكتابة مقيّدة بـ can_manage_content في RLS. */
export async function savePeopleCardConfig(config) {
  const { error } = await supabase
    .from('site_content')
    .upsert([{ section: CARD_SECTION, key: CARD_KEY, value: serializeConfig(config) }], { onConflict: 'section,key' });
  if (error) throw error;
  await logAction('ADMIN_UPDATED_PEOPLE_CARDS', 'site_content', null, 'تحديث شكل بطاقات الأعضاء والمكتب');
}
