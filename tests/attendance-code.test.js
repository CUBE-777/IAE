import test from 'node:test';
import assert from 'node:assert/strict';
import { ATTENDANCE_PREFIX, attendanceCodeText, parseAttendanceCode } from '../src/utils/attendanceCode.js';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';

test('رمز الحضور: نص مبهم بالبادئة IAE- لا رابط (الكاميرا العادية لا تفتح شيئًا)', () => {
  assert.equal(ATTENDANCE_PREFIX, 'IAE-');
  const text = attendanceCodeText(TOKEN);
  assert.equal(text, `IAE-${TOKEN}`);
  assert.doesNotMatch(text, /https?:|\/|\./);
});

test('parseAttendanceCode: يقبل رمزًا صحيحًا مع مسافات ويرفض ما عداه', () => {
  assert.equal(parseAttendanceCode(`IAE-${TOKEN}`), TOKEN);
  assert.equal(parseAttendanceCode(`  IAE-${TOKEN}\n`), TOKEN);
  assert.equal(parseAttendanceCode(TOKEN), null);                          // بلا بادئة
  assert.equal(parseAttendanceCode(`iae-${TOKEN}`), null);                 // حساس لحالة الأحرف
  assert.equal(parseAttendanceCode(`IAE-${TOKEN}x`), null);                // أطول
  assert.equal(parseAttendanceCode(`IAE-${TOKEN.slice(1)}`), null);        // أقصر
  assert.equal(parseAttendanceCode(`IAE-${TOKEN.slice(0, 21)}=`), null);   // محرف غير base64url
  assert.equal(parseAttendanceCode('https://fsa-iae.netlify.app/verify/' + TOKEN), null); // رمز التحقق العام ليس رمز حضور
  assert.equal(parseAttendanceCode(''), null);
  assert.equal(parseAttendanceCode(null), null);
  assert.equal(parseAttendanceCode(undefined), null);
});
