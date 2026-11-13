import { GAMES_LANG_FALLBACK } from '../constants/gamesCore.js';

/**
 * اختيار نص متعدد اللغات {ar,fr,en} — المنطق الوحيد لكل عرض بيانات التحدي (العنوان، الوصف، السؤال، الخيارات، التلميحات).
 * الترتيب: لغة اللاعب ← اللغة الافتراضية للإصدار (version.default_language) ← ترتيب الاحتياط. سلسلة فارغة إن لم يوجد شيء.
 * دالة نقية (بلا شبكة ولا React) كي تُستعمل في الصفحات والمكوّنات وتُختبر منفردة.
 */
export function pickLocalized(value, lang, defaultLang) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  for (const l of [lang, defaultLang, ...GAMES_LANG_FALLBACK]) {
    const v = l ? value[l] : null;
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}
