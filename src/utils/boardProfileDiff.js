/**
 * src/utils/boardProfileDiff.js
 * مقارنة نقية بين الملف الحالي لعضو المكتب والمقترح الذي أرسله بنفسه، لعرض ما تغيّر فقط في نافذة المراجعة.
 * لا تعتمد على React ولا على الترجمة: تُرجع مفاتيح عربية (تُمرَّر إلى tr() في الواجهة) وقيمًا نصية.
 */
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

const SIMPLE = [
  ['university', 'الجامعة/الإطار'],
  ['promotion', 'سنة التخرج (الدفعة)'],
  ['track', 'التخصص (الشعبة)'],
  ['bio', 'نبذة مختصرة (تظهر على بطاقة المكتب)'],
  ['public_bio', 'النبذة العامة'],
  ['study_path', 'المسار الدراسي'],
];
const TR_KEYS = [
  ['track', 'التخصص (الشعبة)'],
  ['bio', 'النبذة المختصرة (بطاقة المكتب)'],
  ['public_bio', 'النبذة العامة'],
  ['study_path', 'المسار الدراسي'],
];
const LANG_LABEL = { fr: 'FR', en: 'EN' };

const socialsText = (s) =>
  isObj(s)
    ? Object.entries(s)
        .filter(([, v]) => str(v))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')
    : '';

const itemsText = (extra) =>
  isObj(extra) && Array.isArray(extra.items)
    ? extra.items.map((it) => `${str(it?.label)}: ${str(it?.value)}`).join('\n')
    : '';

const trExtraText = (tr, lang) => {
  const arr = isObj(tr) && isObj(tr[lang]) && Array.isArray(tr[lang].extra) ? tr[lang].extra : [];
  return arr
    .map((it) => `${str(it?.label)}: ${str(it?.value)}`)
    .filter((l) => l !== ':')
    .join('\n');
};

/**
 * current = صف board_members (أو كائن بنفس الأعمدة)، proposed = data المحفوظة في board_profile_links.
 * يُرجع [{ key, label, lang?, before, after }] للحقول التي تغيّرت فعلًا (نص فارغ = غير مكتوب).
 */
export function diffBoardProfile(current, proposed) {
  const cur = isObj(current) ? current : {};
  const next = isObj(proposed) ? proposed : {};
  const rows = [];
  const push = (key, label, before, after, lang) => {
    if (before !== after) rows.push({ key, label, lang, before, after });
  };

  SIMPLE.forEach(([k, label]) => push(k, label, str(cur[k]), str(next[k])));
  push('socials', 'حسابات التواصل', socialsText(cur.socials), socialsText(next.socials));
  push('extra', 'معلومات إضافية', itemsText(cur.extra), itemsText(next.extra));

  const curTr = isObj(cur.translations) ? cur.translations : {};
  const nextTr = isObj(next.translations) ? next.translations : {};
  push('name_latin', 'الاسم بالحروف اللاتينية', str(curTr.name_latin), str(nextTr.name_latin));
  Object.keys(LANG_LABEL).forEach((lang) => {
    const c = isObj(curTr[lang]) ? curTr[lang] : {};
    const n = isObj(nextTr[lang]) ? nextTr[lang] : {};
    TR_KEYS.forEach(([k, label]) => push(`${lang}.${k}`, label, str(c[k]), str(n[k]), LANG_LABEL[lang]));
    push(`${lang}.extra`, 'ترجمة المعلومات الإضافية', trExtraText(curTr, lang), trExtraText(nextTr, lang), LANG_LABEL[lang]);
  });
  return rows;
}
