/**
 * src/utils/i18nContent.js
 * أدوات عرض المحتوى المتعدد اللغات القادم من قاعدة البيانات.
 * المعمارية متسقة مع بقية المشروع: الحقول الأساسية بالعربية (اللغة الأصلية)،
 * والترجمات الاختيارية في عمود jsonb باسم translations، مع fallback منطقي للعربية.
 */
const LOCALES = { ar: 'ar-MA', fr: 'fr-FR', en: 'en-GB' };

export function localeFor(lang) {
  return LOCALES[lang] || LOCALES.ar;
}

export function formatDate(value, lang, opts) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(localeFor(lang), opts || { year: 'numeric', month: 'long', day: 'numeric' });
}

/** يرجع الإعلان بحقول title/excerpt/content باللغة المطلوبة (مع fallback لكل حقل على حدة). */
export function localizeAnnouncement(row, lang) {
  if (!row) return row;
  const tr = (lang && lang !== 'ar' && row.translations && row.translations[lang]) || {};
  const pick = (key) => (tr[key] && String(tr[key]).trim()) || row[key] || '';
  return {
    ...row,
    title: pick('title') || row.text || '',
    excerpt: pick('excerpt'),
    content: pick('content'),
  };
}

/** تاريخ العرض: تاريخ النشر إن وُجد وإلا تاريخ الإنشاء. */
export function announcementDate(row) {
  return row.start_at || row.created_at;
}

/**
 * قيمة نصية واحدة بلغة الزائر (إعدادات الموقع/محتوى الصفحة الرئيسية):
 * ترجمة اللغة إن وُجدت وإلا النص العربي الأصلي.
 */
export function localizeValue(base, translations, lang, key = 'value') {
  if (!lang || lang === 'ar') return base;
  const tr = translations && translations[lang];
  const v = tr && typeof tr[key] === 'string' ? tr[key].trim() : '';
  return v || base;
}

/**
 * يعرض سجلًا بلغة الزائر: لكل حقل تُستعمل ترجمة اللغة إن وُجدت وإلا النص العربي الأصلي.
 * fields: أسماء الحقول، أو أزواج [حقل السجل، مفتاح الترجمة] عند اختلاف الاسمين.
 * لا يُغيّر السجل الأصلي. العربية تُعاد كما هي.
 */
export function localizeRow(row, lang, fields) {
  if (!row || !lang || lang === 'ar') return row;
  const tr = row.translations && row.translations[lang];
  if (!tr || typeof tr !== 'object') return row;
  const out = { ...row };
  fields.forEach((f) => {
    const [rowKey, trKey] = Array.isArray(f) ? f : [f, f];
    const v = typeof tr[trKey] === 'string' ? tr[trKey].trim() : '';
    if (v) out[rowKey] = v;
  });
  return out;
}

/** المشاريع الفرعية للنشاط: ترجمة العنوان والوصف لكل عنصر بحسب فهرسه. */
function localizeSubActivities(subs, tr) {
  if (!Array.isArray(subs) || !tr || !Array.isArray(tr.sub_activities)) return subs;
  const clean = (v) => (typeof v === 'string' ? v.trim() : '');
  return subs.map((sub, i) => {
    const t = tr.sub_activities[i] || {};
    return { ...sub, title: clean(t.title) || sub.title, desc: clean(t.desc) || sub.desc };
  });
}

const ACTIVITY_FIELDS = ['title', 'description', 'category', 'target_audience', 'location'];

/** نشاط بصيغة جدول القاعدة (بطاقات الصفحة الرئيسية). */
export function localizeActivity(row, lang) {
  const out = localizeRow(row, lang, ACTIVITY_FIELDS);
  if (!out || out === row || !row.sub_activities) return out;
  return { ...out, sub_activities: localizeSubActivities(row.sub_activities, row.translations[lang]) };
}

/** نشاط بصيغة صفحة التفاصيل (activityDetail.service): target ← target_audience، content ← description. */
export function localizeActivityDetail(item, lang) {
  if (!item || !item.translations) return item;
  const out = localizeRow(item, lang, ['title', 'location', 'category', ['target', 'target_audience'], ['content', 'description']]);
  if (out === item || !item.sub_activities) return out;
  return { ...out, sub_activities: localizeSubActivities(item.sub_activities, item.translations[lang]) };
}

export function localizeGalleryItem(row, lang) {
  return localizeRow(row, lang, ['title', 'description']);
}
