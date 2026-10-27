import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LIST_CONFIG, normalizeConfig, normalizeListConfig, applyModalConfig, serializeConfig } from '../src/utils/peopleCardConfig.js';

test('بطاقات الأشخاص: غياب الإعدادات أو فسادها يعيد الافتراضي', () => {
  for (const raw of [null, undefined, '', 'not json', '[]', 5, {}]) {
    const c = normalizeConfig(raw);
    assert.deepEqual(c.members, normalizeListConfig(null));
    assert.deepEqual(c.board.card, DEFAULT_LIST_CONFIG.card);
  }
});

test('بطاقات الأشخاص: قيم غير مسموحة تُهمَل وقيم صالحة تُقبل لكل قائمة على حدة', () => {
  const c = normalizeConfig(JSON.stringify({
    members: { card: { columns: 9, layout: 'x', photoShape: 'square', showPromo: false, showTrack: 'no' }, modal: { showBio: false } },
    board: { card: { columns: 4, showUniversity: false } },
  }));
  assert.equal(c.members.card.columns, 3);
  assert.equal(c.members.card.layout, 'side');
  assert.equal(c.members.card.photoShape, 'square');
  assert.equal(c.members.card.showPromo, false);
  assert.equal(c.members.card.showTrack, true);
  assert.equal(c.members.modal.showBio, false);
  assert.equal(c.board.card.columns, 4);
  assert.equal(c.board.card.showUniversity, false);
  assert.equal(c.board.modal.showBio, true); // المكتب مستقل عن الأعضاء
});

test('بطاقات الأشخاص: الحفظ ثم القراءة يحفظ القيم ولا يضيف حقولًا غريبة', () => {
  const c = normalizeConfig({ members: { card: { showPhoto: false, evil: '<script>' } } });
  const back = normalizeConfig(serializeConfig(c));
  assert.deepEqual(back, c);
  assert.ok(!('evil' in back.members.card));
});

test('بطاقات الأشخاص: إخفاء كل محتوى النافذة يلغي hasAny (فيختفي زر الملف)', () => {
  const details = { bio: 'x', studyPath: 'y', socials: [{ key: 'website', href: 'https://a.b' }], extra: [{ label: 'a', value: 'b' }], hasAny: true };
  assert.equal(applyModalConfig(details, undefined).hasAny, true);
  const off = { showBio: false, showStudyPath: false, showSocials: false, showExtra: false };
  assert.equal(applyModalConfig(details, off).hasAny, false);
  assert.equal(applyModalConfig(details, { ...off, showSocials: true }).hasAny, true);
});
