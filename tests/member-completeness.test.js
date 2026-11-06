import test from 'node:test';
import assert from 'node:assert/strict';
import { memberCompleteness } from '../src/utils/memberCompleteness.js';

test('بطاقة فارغة أو بلا بيانات: 0% وكل البنود ناقصة', () => {
  for (const m of [null, undefined, {}, { socials: null, translations: [] }]) {
    const r = memberCompleteness(m);
    assert.equal(r.percent, 0);
    assert.equal(r.missing.length, 6);
  }
});

test('بطاقة مكتملة: 100% ولا نقص', () => {
  const r = memberCompleteness({
    photo_url: 'https://x/y.jpg', public_bio: 'نبذة', study_path: 'مسار', profession: 'مهندس',
    socials: { github: 'https://github.com/a' }, translations: { fr: { public_bio: 'Bio' } },
  });
  assert.equal(r.percent, 100);
  assert.deepEqual(r.missing, []);
});

test('المسافات لا تُحتسب، والترجمة الإنجليزية وحدها تكفي، وروابط فارغة لا تُحتسب', () => {
  const r = memberCompleteness({
    photo_url: '   ', public_bio: ' ', profession: 'مهندس',
    socials: { github: '  ', x: '' }, translations: { name_latin: 'Ali', en: { track: 'AI' } },
  });
  assert.deepEqual(r.missing, ['photo', 'publicBio', 'studyPath', 'socials']);
  assert.equal(r.percent, 33);
});

import fs from 'node:fs';
const card = fs.readFileSync(new URL('../src/pages/member/MemberCard.jsx', import.meta.url), 'utf8');
const home = fs.readFileSync(new URL('../src/pages/member/MemberHome.jsx', import.meta.url), 'utf8');

test('MemberCard: تحذير التعديلات غير المرسلة (beforeunload + useBlocker) ومعاينة حية وعدّادات', () => {
  assert.match(card, /addEventListener\('beforeunload'/);
  assert.match(card, /useBlocker\(/);
  assert.match(card, /URL\.revokeObjectURL/); // لا تسريب لروابط معاينة الصورة
  assert.match(card, /<PersonCard/);
  assert.ok((card.match(/<Counter /g) || []).length >= 3);
});

test('MemberHome: تبويبات بأدوار ARIA، ومؤشر اكتمال، ولا كتابة مباشرة في members', () => {
  assert.match(home, /role="tablist"/);
  assert.match(home, /role="progressbar"/);
  assert.match(home, /memberCompleteness\(member\)/);
  assert.doesNotMatch(home, /\.from\('members'\)/);
});
