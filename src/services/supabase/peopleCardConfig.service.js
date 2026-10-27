/**
 * src/services/supabase/peopleCardConfig.service.js
 * قراءة إعدادات شكل بطاقات الأعضاء/المكتب للصفحات العامة (دور anon، قراءة site_content عامة).
 * لا يفشل أبدًا: أي خطأ (شبكة، صف غير موجود…) يعيد الإعدادات الافتراضية فتبقى الصفحة تعمل بالشكل الحالي.
 */
import { supabasePublic } from './publicClient';
import { CARD_SECTION, CARD_KEY, normalizeConfig } from '../../utils/peopleCardConfig';

export async function fetchPeopleCardConfig() {
  try {
    const { data, error } = await supabasePublic
      .from('site_content')
      .select('value')
      .eq('section', CARD_SECTION)
      .eq('key', CARD_KEY)
      .maybeSingle();
    if (error) throw error;
    return normalizeConfig(data?.value);
  } catch (err) {
    console.warn('تعذر تحميل إعدادات البطاقات، سيُستخدم الشكل الافتراضي:', err);
    return normalizeConfig(null);
  }
}
