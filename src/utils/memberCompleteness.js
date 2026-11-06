/**
 * src/utils/memberCompleteness.js
 * اكتمال البطاقة العامة للعضو (دالة نقية للعرض فقط، لا تُرسل شيئًا للخادم).
 * تقرأ الحقول التي يعيدها get_my_member وتُرجع { items: [{ key, done }], percent, missing: [key] }.
 */
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const filled = (v) => typeof v === 'string' && v.trim() !== '';

export function memberCompleteness(member) {
  const m = member || {};
  const hasSocial = isObj(m.socials) && Object.values(m.socials).some(filled);
  const tr = isObj(m.translations) ? m.translations : {};
  const hasTranslation = ['fr', 'en'].some((code) => isObj(tr[code]) && Object.values(tr[code]).some(filled));
  const items = [
    { key: 'photo', done: filled(m.photo_url) },
    { key: 'publicBio', done: filled(m.public_bio) },
    { key: 'studyPath', done: filled(m.study_path) },
    { key: 'profession', done: filled(m.profession) },
    { key: 'socials', done: hasSocial },
    { key: 'translations', done: hasTranslation },
  ];
  const doneCount = items.filter((i) => i.done).length;
  return {
    items,
    percent: Math.round((doneCount / items.length) * 100),
    missing: items.filter((i) => !i.done).map((i) => i.key),
  };
}
