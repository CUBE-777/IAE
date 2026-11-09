/**
 * src/utils/personTranslations.js
 * يعرض بيانات الشخص (عضو أو عضو مكتب) بلغة الزائر، بنفس معمارية الإعلانات:
 * الأصل بالعربية في الأعمدة الأساسية، والترجمات الاختيارية في person.tr (عمود translations):
 *   { name_latin, fr: { position, bio, public_bio, study_path, profession, track, extra: [{label,value}] }, en: {...} }
 * أي حقل ترجمة غير موجود أو فارغ يعود تلقائيًا إلى النص العربي. لا يُغيّر الكائن الأصلي.
 */
import { LEVELS } from '../constants/membershipLevels.js';

const levelsOf = (lg) => LEVELS[lg] || [];

/**
 * المستوى الدراسي يُحفظ في النموذج بقيمته العربية القانونية (وقد توجد سجلات قديمة بالفرنسية/الإنجليزية).
 * هذه الدالة تُرجع صيغة اللغة المطلوبة إن طابقت القيمة أحد المستويات المعروفة، وإلا تُرجع القيمة كما هي.
 */
export function translateLevel(value, lang) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return value;
  const target = levelsOf(lang === 'fr' || lang === 'en' ? lang : 'ar');
  for (const lg of ['ar', 'fr', 'en']) {
    const idx = levelsOf(lg).indexOf(v);
    if (idx >= 0 && target[idx]) return target[idx];
  }
  return value;
}


/**
 * ترجمة احتياطية للصفات الشائعة في المكتب: تُستعمل فقط حين لا يُدخل المسؤول ترجمة يدوية للصفة
 * (translations.fr.position / en.position). الترجمة اليدوية لها الأولوية دائمًا، وأي صفة غير معروفة تبقى كما هي.
 * كل سطر: [الصيغ العربية (مذكر/مؤنث)، الفرنسية (مذكر، مؤنث)، الإنجليزية].
 */
const POSITION_TABLE = [
  [['الرئيس', 'رئيس النادي', 'رئيس المكتب'], ['Président', 'Présidente'], 'President'],
  [['الرئيسة', 'رئيسة النادي', 'رئيسة المكتب'], ['Présidente', 'Présidente'], 'President'],
  [['نائب الرئيس'], ['Vice-président', 'Vice-présidente'], 'Vice President'],
  [['نائبة الرئيس'], ['Vice-présidente', 'Vice-présidente'], 'Vice President'],
  [['الكاتب العام'], ['Secrétaire général', 'Secrétaire générale'], 'General Secretary'],
  [['الكاتبة العامة'], ['Secrétaire générale', 'Secrétaire générale'], 'General Secretary'],
  [['نائب الكاتب العام'], ['Secrétaire général adjoint', 'Secrétaire générale adjointe'], 'Deputy General Secretary'],
  [['نائبة الكاتب العام', 'نائبة الكاتبة العامة'], ['Secrétaire générale adjointe', 'Secrétaire générale adjointe'], 'Deputy General Secretary'],
  [['أمين المال'], ['Trésorier', 'Trésorière'], 'Treasurer'],
  [['أمينة المال'], ['Trésorière', 'Trésorière'], 'Treasurer'],
  [['نائب أمين المال'], ['Trésorier adjoint', 'Trésorière adjointe'], 'Deputy Treasurer'],
  [['نائبة أمين المال', 'نائبة أمينة المال'], ['Trésorière adjointe', 'Trésorière adjointe'], 'Deputy Treasurer'],
  [['المستشار'], ['Conseiller', 'Conseillère'], 'Advisor'],
  [['المستشارة'], ['Conseillère', 'Conseillère'], 'Advisor'],
  [['المقرر'], ['Rapporteur', 'Rapporteure'], 'Rapporteur'],
  [['المقررة'], ['Rapporteure', 'Rapporteure'], 'Rapporteur'],
  [['عضو', 'عضو المكتب', 'عضو مكتب'], ['Membre du bureau', 'Membre du bureau'], 'Board Member'],
  [['عضوة', 'عضوة المكتب', 'عضوة مكتب'], ['Membre du bureau', 'Membre du bureau'], 'Board Member'],
];

// توحيد الكتابة: حذف التشكيل والتطويل، توحيد الألف والياء والتاء المربوطة، وإسقاط «ال» التعريف
const normalizePosition = (v) =>
  String(v || '')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/^ال/, ''))
    .join(' ');

const POSITION_MAP = new Map();
for (const [arForms, fr, en] of POSITION_TABLE) {
  for (const a of arForms) {
    const k = normalizePosition(a);
    if (!POSITION_MAP.has(k)) POSITION_MAP.set(k, { fr: fr[0], en });
  }
}

/** يُرجع ترجمة الصفة للغة المطلوبة إن كانت معروفة، وإلا الصفة الأصلية كما هي. */
export function translatePosition(role, lang) {
  const original = typeof role === 'string' ? role.trim() : role;
  if (!original || (lang !== 'fr' && lang !== 'en')) return original;
  const hit = POSITION_MAP.get(normalizePosition(original));
  return hit ? hit[lang] : original;
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clean = (v) => (typeof v === 'string' ? v.trim() : '');

export function localizePerson(person, lang) {
  if (!person) return person;
  const isAr = !lang || lang === 'ar';
  const tr = isObj(person.tr) ? person.tr : {};
  const L = !isAr && isObj(tr[lang]) ? tr[lang] : {};
  const pick = (original, key) => clean(L[key]) || original;

  const nameLatin = clean(tr.name_latin);
  const name = isAr ? person.name : nameLatin || person.name;
  // الاسم الآخر يُستعمل في البحث فقط (فيجد الزائر الشخص بالعربية واللاتينية معًا)
  const altName = isAr ? nameLatin : nameLatin ? person.name : '';

  const role = isAr ? person.role : clean(person.roleTr && person.roleTr[lang]) || translatePosition(person.role, lang);

  let extra = person.extra;
  if (isObj(person.extra) && Array.isArray(person.extra.items)) {
    const trItems = !isAr && Array.isArray(L.extra) ? L.extra : [];
    extra = {
      ...person.extra,
      items: person.extra.items.map((it, i) => {
        const label = clean(trItems[i] && trItems[i].label) || (it && it.label);
        const value = clean(trItems[i] && trItems[i].value) || (it && it.value);
        // قيمة «المستوى الدراسي» تتبع لغة الزائر دائمًا (مهما كانت لغة إدخالها)
        return { ...(it || {}), label, value: translateLevel(value, lang) };
      }),
    };
  }

  return {
    ...person,
    name,
    altName,
    role,
    track: pick(person.track, 'track'),
    profession: pick(person.profession, 'profession'),
    bio: pick(person.bio, 'bio'),
    publicBio: pick(person.publicBio, 'public_bio'),
    studyPath: pick(person.studyPath, 'study_path'),
    extra,
  };
}
