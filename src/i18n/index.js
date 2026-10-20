/**
 * src/i18n/index.js
 * بنية تعدد اللغات (AR/FR/EN). العربية (ar.json) هي اللغة الأصلية للمحتوى.
 * الفرنسية (fr.json) والإنجليزية (en.json) ترجمة فعلية (وليست placeholder)
 * أُضيفت لاحقًا بنفس بنية المفاتيح تمامًا؛ أي نص جديد يُضاف مستقبلاً في
 * ar.json يجب أن يُضاف بنفس المسار في الملفين الآخرين.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import ar from './locales/ar.json';
import en from './locales/en.json';
import fr from './locales/fr.json';

export const SUPPORTED_LANGUAGES = [
  { code: 'ar', dir: 'rtl', label: 'العربية', translated: true },
  { code: 'fr', dir: 'ltr', label: 'Français', translated: true },
  { code: 'en', dir: 'ltr', label: 'English', translated: true },
];

const LANG_STORAGE_KEY = 'morabitine:lang';

/** يقرأ اللغة المحفوظة من آخر زيارة، مع العربية كلغة افتراضية. */
function getInitialLanguage() {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved && SUPPORTED_LANGUAGES.some((l) => l.code === saved)) return saved;
  } catch {
    // localStorage قد يكون معطّلاً (وضع التصفح الخاص مثلاً) — نتجاهل بهدوء
  }
  return 'ar';
}

/** يحفظ اختيار اللغة ليبقى بعد إعادة تحميل الصفحة. */
export function persistLanguage(langCode) {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, langCode);
  } catch {
    // تجاهل: عدم القدرة على الحفظ لا يجب أن يكسر تبديل اللغة
  }
}

const initialLanguage = getInitialLanguage();

i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: ar },
    fr: { translation: fr },
    en: { translation: en },
  },
  lng: initialLanguage,
  fallbackLng: 'ar',
  interpolation: { escapeValue: false }, // React يهرّب النصوص تلقائيًا أصلاً
});

export function applyDocumentDirection(langCode) {
  const lang = SUPPORTED_LANGUAGES.find((l) => l.code === langCode) || SUPPORTED_LANGUAGES[0];
  document.documentElement.lang = lang.code;
  document.documentElement.dir = lang.dir;
}

// تطبيق الاتجاه الصحيح فور الإقلاع، وليس فقط عند تبديل اللغة يدويًا — وإلا
// فإن إعادة تحميل الصفحة بلغة فرنسية/إنجليزية محفوظة ستبقى بالاتجاه RTL.
applyDocumentDirection(initialLanguage);

export default i18n;
