/**
 * src/constants/membershipLevels.js
 * المستويات الدراسية في نموذج الانخراط. القيمة المحفوظة في قاعدة البيانات هي دائمًا النص العربي (LEVELS.ar)
 * ليبقى التخزين موحّدًا مهما كانت لغة من ملأ النموذج، وتُعرض بلغة الزائر عبر translateLevel.
 * يجب أن تطابق i18n/locales/*.json → membershipForm.levels (يفرض ذلك tests/people-i18n.test.js).
 */
export const LEVELS = {
  "ar": [
    "الإجازة — السنة الأولى",
    "الإجازة — السنة الثانية",
    "الإجازة — السنة الثالثة",
    "الماستر — السنة الأولى",
    "الماستر — السنة الثانية",
    "مهندس",
    "دكتوراه",
    "أخرى"
  ],
  "fr": [
    "Licence — 1re année",
    "Licence — 2e année",
    "Licence — 3e année",
    "Master — 1re année",
    "Master — 2e année",
    "Ingénieur",
    "Doctorat",
    "Autre"
  ],
  "en": [
    "Bachelor — 1st year",
    "Bachelor — 2nd year",
    "Bachelor — 3rd year",
    "Master — 1st year",
    "Master — 2nd year",
    "Engineering",
    "PhD",
    "Other"
  ]
};
