import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STALE_REQUEST_RE, NOT_AUTHORIZED_RE, isStaleRequestError } from '../src/utils/serverErrors.js';
import { SERVER_DICT, translateServerMessage } from '../src/i18n/adminDict.server.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sql = fs
  .readdirSync(path.join(ROOT, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .map((f) => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8'))
  .join('\n');

test('عبارات تصنيف الأخطاء ما زالت موجودة في رسائل SQL', () => {
  for (const phrase of ['تغيّر الطلب أثناء مراجعتك', 'لا يوجد طلب قيد المراجعة']) {
    assert.ok(sql.includes(phrase), `العبارة غير موجودة في migrations: ${phrase}`);
  }
  assert.ok(STALE_REQUEST_RE.test('تغيّر الطلب أثناء مراجعتك. تم تحديث القائمة'));
  assert.ok(isStaleRequestError({ message: 'لا يوجد طلب قيد المراجعة' }));
  assert.ok(NOT_AUTHORIZED_RE.test('غير مصرّح لك بهذه العملية') && NOT_AUTHORIZED_RE.test('غير مصرح لك'));
});

test('قاموس رسائل الخادم: كل مدخل له fr وen، وترجمة الرسالة المعروفة', () => {
  for (const [ar, e] of Object.entries(SERVER_DICT)) {
    assert.ok(e.fr && e.en, `ترجمة ناقصة: ${ar}`);
    assert.ok(!/[\u0600-\u06FF]/.test(e.fr + e.en), `نص عربي داخل الترجمة: ${ar}`);
  }
  assert.equal(translateServerMessage('الطلب غير موجود', 'en'), 'Request not found.');
  assert.equal(translateServerMessage('الطلب غير موجود', 'ar'), 'الطلب غير موجود');
  assert.equal(translateServerMessage('رسالة مجهولة', 'fr'), 'رسالة مجهولة');
});
