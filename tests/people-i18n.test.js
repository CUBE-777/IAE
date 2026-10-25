import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { localizePerson, translateLevel } from '../src/utils/personTranslations.js';
import { LEVELS } from '../src/constants/membershipLevels.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => fs.readFileSync(`${ROOT}/${f}`, 'utf8');
const locale = (lg) => JSON.parse(read(`src/i18n/locales/${lg}.json`));

const member = {
  name: 'محمد العلوي',
  role: null,
  track: 'ذكاء اصطناعي',
  extra: { items: [{ label: 'المستوى الدراسي', value: 'الإجازة — السنة الأولى' }] },
  tr: {
    name_latin: 'Mohamed El Alaoui',
    fr: { track: 'Intelligence artificielle', extra: [{ label: "Niveau d'études", value: 'الإجازة — السنة الأولى' }] },
    en: { extra: [{ label: 'Study level', value: 'الإجازة — السنة الأولى' }] },
  },
};

test('localizePerson: الاسم اللاتيني في FR/EN والعربي في AR', () => {
  assert.equal(localizePerson(member, 'ar').name, 'محمد العلوي');
  assert.equal(localizePerson(member, 'fr').name, 'Mohamed El Alaoui');
  assert.equal(localizePerson(member, 'en').name, 'Mohamed El Alaoui');
});

test('localizePerson: البحث يجد الشخص بالاسمين (altName)', () => {
  assert.equal(localizePerson(member, 'ar').altName, 'Mohamed El Alaoui');
  assert.equal(localizePerson(member, 'fr').altName, 'محمد العلوي');
});

test('localizePerson: رجوع للعربية عند غياب الترجمة، وبلا ترجمات لا ينكسر شيء', () => {
  assert.equal(localizePerson(member, 'en').track, 'ذكاء اصطناعي');
  assert.equal(localizePerson(member, 'fr').track, 'Intelligence artificielle');
  const bare = { name: 'سلمى', role: 'عضو', extra: null };
  assert.equal(localizePerson(bare, 'fr').name, 'سلمى');
  assert.equal(localizePerson(bare, 'fr').role, 'عضو');
  assert.equal(localizePerson(null, 'fr'), null);
});

test('localizePerson: منصب المكتب بلغة الزائر (roleTr)', () => {
  const board = { name: 'أمين', role: 'الرئيس', roleTr: { fr: 'Président', en: 'President' } };
  assert.equal(localizePerson(board, 'ar').role, 'الرئيس');
  assert.equal(localizePerson(board, 'fr').role, 'Président');
  assert.equal(localizePerson(board, 'en').role, 'President');
  assert.equal(localizePerson({ ...board, roleTr: { fr: '' } }, 'fr').role, 'الرئيس');
});

test('المستوى الدراسي: قيمة موحّدة تُعرض بلغة الزائر مهما كانت لغة إدخالها', () => {
  assert.equal(localizePerson(member, 'fr').extra.items[0].value, 'Licence — 1re année');
  assert.equal(localizePerson(member, 'en').extra.items[0].value, 'Bachelor — 1st year');
  assert.equal(localizePerson(member, 'ar').extra.items[0].value, 'الإجازة — السنة الأولى');
  // سجلات قديمة حُفظت بالفرنسية
  assert.equal(translateLevel('Master — 1re année', 'ar'), 'الماستر — السنة الأولى');
  assert.equal(translateLevel('Master — 1re année', 'en'), 'Master — 1st year');
  // قيمة غير معروفة تبقى كما هي
  assert.equal(translateLevel('مستوى آخر', 'fr'), 'مستوى آخر');
});

test('LEVELS مطابقة لملفات الترجمة (membershipForm.levels)', () => {
  for (const lg of ['ar', 'fr', 'en']) {
    assert.deepEqual(LEVELS[lg], locale(lg).membershipForm.levels, `LEVELS.${lg} تختلف عن ${lg}.json`);
  }
});

test('peopleDirectory: يطلب عمود translations (مع احتياط) ويمرّره للبطاقة', () => {
  const src = read('src/services/supabase/peopleDirectory.service.js');
  assert.match(src, /translations/);
  assert.match(src, /tr: row\.translations/);
  assert.match(src, /roleTr/);
  // الاحتياط: إن لم تُشغَّل migration 0011 تعمل الصفحة بالأعمدة الأساسية
  assert.match(src, /queryBoard\(BOARD_BASE\)/);
  assert.match(src, /queryMembers\(BASE_COLS\)/);
});

test('PeoplePage: تعرض الأشخاص عبر localizePerson بمفتاح ثابت', () => {
  const src = read('src/pages/public/PeoplePage.jsx');
  assert.match(src, /localizePerson\(p, lang\)/);
  assert.doesNotMatch(src, /key=\{`\$\{person\.name\}-\$\{i\}`\}/);
});

test('PersonModal: تسمية «موقع شخصي» مترجمة وليست عربية ثابتة', () => {
  assert.match(read('src/components/common/PersonModal.jsx'), /t\('person\.website'\)/);
  for (const lg of ['ar', 'fr', 'en']) assert.ok(locale(lg).person.website, `person.website ناقص في ${lg}`);
});

test('رسالة الواتساب: كل اللغات فيها الاسم والرابط والتاريخ الفعلي بلا مدة ثابتة', () => {
  for (const lg of ['ar', 'fr', 'en']) {
    const r = locale(lg).admin.requests;
    for (const ph of ['{{name}}', '{{link}}', '{{date}}']) assert.ok(r.waMessage.includes(ph), `${ph} ناقص في ${lg}`);
    assert.ok(!r.waMessage.includes('{{days}}'), `${lg}: لا مدة ثابتة`);
    assert.ok(r.copyMessage && r.msgEditHint, `${lg}: مفاتيح النسخ/التعديل ناقصة`);
  }
});

test('الرابط يحمل لغة الرسالة، والنص قابل للتعديل قبل الإرسال', () => {
  const src = read('src/pages/admin/Requests.jsx');
  assert.match(src, /\?lang=\$\{lng\}/);
  assert.match(src, /waFinalText\(linkInfo, msgLang\)/);
  assert.doesNotMatch(src, /days: 7/);
  assert.doesNotMatch(src, /id="waPreview"[^>]*readOnly/);
});

test('صفحة النموذج: تفتح بلغة الرسالة (?lang) وقيم المستوى موحّدة', () => {
  const src = read('src/pages/public/MembershipFormPage.jsx');
  assert.match(src, /searchParams\.get\('lang'\)/);
  assert.match(src, /applyDocumentDirection/);
  assert.match(src, /value=\{LEVELS\.ar\[i\] \|\| label\}/);
});
