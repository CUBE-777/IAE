import test from 'node:test';
import assert from 'node:assert/strict';
import { latestStamp, isNewer, readSeen, markSeen, SEEN_KEY } from '../src/utils/announcementSeen.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

test('latestStamp: start_at أولًا وإلا created_at، ويأخذ الأقصى', () => {
  const rows = [
    { start_at: null, created_at: '2026-01-01T00:00:00Z' },
    { start_at: '2026-03-01T00:00:00Z', created_at: '2026-01-02T00:00:00Z' },
    { start_at: null, created_at: '2026-02-01T00:00:00Z' },
  ];
  assert.equal(latestStamp(rows), new Date('2026-03-01T00:00:00Z').getTime());
});

test('latestStamp: قيم غير صالحة → null', () => {
  assert.equal(latestStamp([]), null);
  assert.equal(latestStamp(null), null);
  assert.equal(latestStamp([{ start_at: 'x', created_at: 'y' }, null]), null);
});

test('isNewer: تقارن رقمين فقط', () => {
  assert.equal(isNewer(2, 1), true);
  assert.equal(isNewer(1, 1), false);
  assert.equal(isNewer(2, null), false);
  assert.equal(isNewer(undefined, 1), false);
});

test('readSeen/markSeen: تخزين سليم، وتجاهل التعطّل والقيم السيئة', () => {
  const s = mem();
  assert.equal(readSeen(s), null);
  markSeen(123, s);
  assert.equal(readSeen(s), 123);
  s.setItem(SEEN_KEY, 'abc');
  assert.equal(readSeen(s), null);
  markSeen('x', s); markSeen(NaN, s);
  assert.equal(readSeen(s), null);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(readSeen(broken), null);
  assert.doesNotThrow(() => markSeen(5, broken));
});
