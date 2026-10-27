import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhoneDigits, prepareRequestQuery, matchesRequestSearch } from '../src/utils/requestSearch.js';

const rows = [
  { full_name: 'أحمد بنعلي', email: 'Ahmed.Benali@Example.com', phone: '06 12 34 56 78' },
  { full_name: 'Sara El Idrissi', email: 'sara@mail.ma', phone: '+212 661-987654' },
  { full_name: 'إبراهيم', email: null, phone: null },
];
const find = (q) => rows.filter((r) => matchesRequestSearch(r, prepareRequestQuery(q))).map((r) => r.full_name);

test('بحث الطلبات: الاسم عربيًا بلا اعتبار للهمزة ولاتينيًا', () => {
  assert.deepEqual(find('احمد'), ['أحمد بنعلي']);
  assert.deepEqual(find('ابراهيم'), ['إبراهيم']);
  assert.deepEqual(find('idrissi'), ['Sara El Idrissi']);
});

test('بحث الطلبات: البريد بلا حساسية للحالة ويطابق جزءًا منه', () => {
  assert.deepEqual(find('ahmed.benali@example'), ['أحمد بنعلي']);
  assert.deepEqual(find('mail.ma'), ['Sara El Idrissi']);
});

test('بحث الطلبات: الهاتف بأي صيغة (0 أو +212 أو فراغات أو أرقام هندية)', () => {
  assert.equal(normalizePhoneDigits('+212 661-987654'), '0661987654');
  assert.equal(normalizePhoneDigits('00212661987654'), '0661987654');
  assert.deepEqual(find('0612345678'), ['أحمد بنعلي']);
  assert.deepEqual(find('+212612345678'), ['أحمد بنعلي']);
  assert.deepEqual(find('061234'), ['أحمد بنعلي']);
  assert.deepEqual(find('٠٦٦١'), ['Sara El Idrissi']);
  assert.deepEqual(find('661987654'), ['Sara El Idrissi']);
});

test('بحث الطلبات: استعلام فارغ يعرض الكل، وقيم null لا تكسر البحث', () => {
  assert.equal(find('').length, 3);
  assert.equal(find('   ').length, 3);
  assert.deepEqual(find('zzz'), []);
});

import { sortByFormStatus } from '../src/utils/requestSearch.js';

test('ترتيب الطلبات حسب حالة النموذج: يجمع الحالات الثلاث ويحفظ الترتيب الأصلي داخل كل حالة', () => {
  const list = [
    { id: 1, form_status: 'received' }, { id: 2, form_status: 'none' }, { id: 3, form_status: 'sent' },
    { id: 4, form_status: null }, { id: 5, form_status: 'sent' }, { id: 6, form_status: 'received' },
  ];
  assert.deepEqual(sortByFormStatus(list, 'newFirst').map((r) => r.id), [2, 4, 3, 5, 1, 6]);
  assert.deepEqual(sortByFormStatus(list, 'receivedFirst').map((r) => r.id), [1, 6, 3, 5, 2, 4]);
  assert.deepEqual(sortByFormStatus(list, 'sentFirst').map((r) => r.id), [3, 5, 2, 4, 1, 6]);
  assert.equal(sortByFormStatus(list, ''), list);
});
