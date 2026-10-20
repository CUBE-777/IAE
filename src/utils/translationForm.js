/**
 * src/utils/translationForm.js
 * دوال مشتركة لنماذج الإدارة التي تحرّر عمود translations (jsonb):
 *   { fr: { <key>: "..." }, en: { <key>: "..." } }
 * العربية أصل في الأعمدة الأساسية، والترجمات اختيارية.
 */
export const TR_LANGS = [
  { code: 'fr', label: 'الفرنسية (FR)' },
  { code: 'en', label: 'الإنجليزية (EN)' },
];

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** قراءة نص ترجمة (فارغ إن لم يوجد). */
export function getTr(translations, lang, key) {
  return isObj(translations) && isObj(translations[lang]) && typeof translations[lang][key] === 'string'
    ? translations[lang][key]
    : '';
}

/** يُرجع كائن ترجمات جديدًا بعد تعديل حقل واحد (لا يقصّ المسافات أثناء الكتابة). */
export function setTr(translations, lang, key, value) {
  const base = isObj(translations) ? translations : {};
  return { ...base, [lang]: { ...(isObj(base[lang]) ? base[lang] : {}), [key]: value } };
}

/** تنظيف قبل الحفظ: قصّ المسافات وحذف الفارغ مع الإبقاء على القيم غير النصية (مصفوفات...) كما هي. */
export function cleanTr(translations, maxLen = 1000) {
  const out = {};
  if (!isObj(translations)) return out;
  Object.keys(translations).forEach((lang) => {
    if (!isObj(translations[lang])) return;
    const clean = {};
    Object.entries(translations[lang]).forEach(([k, v]) => {
      if (typeof v === 'string') {
        const t = v.trim().slice(0, maxLen);
        if (t) clean[k] = t;
      } else if (Array.isArray(v)) {
        // قوائم عناصر (مثل المشاريع الفرعية): ننظّف نصوص كل عنصر مع الإبقاء على ترتيب العناصر (الفهرس)
        const items = v.map((it) => {
          const o = {};
          if (isObj(it)) {
            Object.entries(it).forEach(([ik, iv]) => {
              const t = typeof iv === 'string' ? iv.trim().slice(0, maxLen) : '';
              if (t) o[ik] = t;
            });
          }
          return o;
        });
        if (items.some((o) => Object.keys(o).length)) clean[k] = items;
      } else if (v != null) {
        clean[k] = v;
      }
    });
    if (Object.keys(clean).length) out[lang] = clean;
  });
  return out;
}

export const hasTr = (translations) => Object.keys(cleanTr(translations)).length > 0;

/** قراءة حقل من عنصر في قائمة ترجمات (مثل sub_activities[i].title). */
export function getTrItem(translations, lang, listKey, index, field) {
  const list = isObj(translations) && isObj(translations[lang]) ? translations[lang][listKey] : null;
  const item = Array.isArray(list) ? list[index] : null;
  return isObj(item) && typeof item[field] === 'string' ? item[field] : '';
}

/** يُرجع كائن ترجمات جديدًا بعد تعديل حقل واحد من عنصر قائمة (الفهرس يطابق ترتيب العنصر الأصلي). */
export function setTrItem(translations, lang, listKey, index, field, value) {
  const base = isObj(translations) ? translations : {};
  const langObj = isObj(base[lang]) ? base[lang] : {};
  const list = Array.isArray(langObj[listKey]) ? [...langObj[listKey]] : [];
  while (list.length <= index) list.push({});
  list[index] = { ...(isObj(list[index]) ? list[index] : {}), [field]: value };
  return { ...base, [lang]: { ...langObj, [listKey]: list } };
}
