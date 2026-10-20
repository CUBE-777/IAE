/**
 * src/utils/personTranslations.js
 * يعرض بيانات الشخص (عضو أو عضو مكتب) بلغة الزائر، بنفس معمارية الإعلانات:
 * الأصل بالعربية في الأعمدة الأساسية، والترجمات الاختيارية في person.tr (عمود translations):
 *   { name_latin, fr: { position, bio, public_bio, study_path, profession, track, extra: [{label,value}] }, en: {...} }
 * أي حقل ترجمة غير موجود أو فارغ يعود تلقائيًا إلى النص العربي. لا يُغيّر الكائن الأصلي.
 */
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

  const role = isAr ? person.role : clean(person.roleTr && person.roleTr[lang]) || person.role;

  let extra = person.extra;
  if (!isAr && isObj(person.extra) && Array.isArray(person.extra.items)) {
    const trItems = Array.isArray(L.extra) ? L.extra : [];
    extra = {
      ...person.extra,
      items: person.extra.items.map((it, i) => ({
        label: clean(trItems[i] && trItems[i].label) || (it && it.label),
        value: clean(trItems[i] && trItems[i].value) || (it && it.value),
      })),
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
