import test from 'node:test';
import assert from 'node:assert/strict';
import { olderRequests, HISTORY_LIMIT } from '../src/utils/memberRequests.js';

test('olderRequests: يستبعد آخر طلب ويحفظ الترتيب', () => {
  const list = [{ id: 'c' }, { id: 'b' }, { id: 'a' }];
  assert.deepEqual(olderRequests(list, 'c').map((r) => r.id), ['b', 'a']);
});

test('olderRequests: بلا آخر طلب يُعيد الكل، وقيم غير صالحة تُعيد مصفوفة فارغة', () => {
  assert.equal(olderRequests([{ id: 'a' }], undefined).length, 1);
  assert.deepEqual(olderRequests(null, 'a'), []);
  assert.deepEqual(olderRequests([null, {}, { id: 'x' }], 'y').map((r) => r.id), ['x']);
});

test('HISTORY_LIMIT: آخر طلب + 5 سابقة', () => {
  assert.equal(HISTORY_LIMIT, 6);
});
