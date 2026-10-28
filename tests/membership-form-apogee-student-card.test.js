import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LEVELS } from '../src/constants/membershipLevels.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => fs.readFileSync(`${ROOT}/${f}`, 'utf8');
const locale = (lg) => JSON.parse(read(`src/i18n/locales/${lg}.json`));
const sql = read('supabase/migrations/0034_membership_form_apogee_student_card.sql').replace(/--.*$/gm, '');
const page = read('src/pages/public/MembershipFormPage.jsx');

test('الفورم: أبوجي/مسار + سبب الانضمام + بطاقة الطالب بوجهين + الصورة، كلها إلزامية', () => {
  assert.match(page, /apogee: ''/);
  assert.match(page, /motivation: ''/);
  assert.match(page, /ensureUploaded\('idb'\)/);
  assert.match(page, /id_card_back_path/);
  assert.doesNotMatch(page, /photoRequired/); // الصورة الشخصية اختيارية
  assert.match(page, /cardFrontRequired/);
  assert.match(page, /cardBackRequired/);
  assert.match(page, /set\('promotion', validateRequired\(v\.promotion\)\)/);
  assert.match(page, /set\('email', validateEmail\(v\.email\)\)/);
});

test('الترجمات: المفاتيح الجديدة بالثلاث لغات والمستويات لم تتغيّر', () => {
  for (const lg of ['ar', 'fr', 'en']) {
    const m = locale(lg).membershipForm;
    for (const k of ['apogee', 'motivation', 'promotion', 'studentCardFront', 'studentCardBack']) assert.ok(m.fields[k], `${lg}: fields.${k}`);
    for (const k of ['apogee', 'promotion', 'motivation']) assert.ok(m.placeholders[k], `${lg}: placeholders.${k}`);
    for (const k of ['studentFrontHint', 'studentBackHint']) assert.ok(m.docs[k], `${lg}: docs.${k}`);
    for (const k of ['apogeeInvalid', 'motivationRequired']) assert.ok(m.errors[k], `${lg}: errors.${k}`);
    const r = locale(lg).admin.requests;
    assert.ok(r.fApogee && r.fMotivation, `${lg}: admin.requests`);
    assert.deepEqual(m.levels, LEVELS[lg]);
  }
  assert.match(locale('ar').membershipForm.fields.promotion, /التخرج/);
});

test('0034: الحقول إلزامية، وظهر البطاقة مسموح، وأبوجي/الدافع محفوظان', () => {
  assert.doesNotMatch(sql, /يرجى رفع الصورة الشخصية/); // الصورة الشخصية اختيارية
  assert.match(sql, /يرجى رفع بطاقة الطالب/);
  assert.match(sql, /v_name_ar is null or v_name_latin is null/);
  assert.match(sql, /\(photo\|id\|idb\)-\[1-3\]/);
  assert.match(sql, /\/idb-\[1-3\]/);
  assert.match(sql, /'apogee',\s+v_apogee/);
  assert.match(sql, /'motivation',/);
  assert.match(sql, /'id_card_back_path',\s+v_idback/);
  assert.match(sql, /id_card_back_path' = p_path/);
});
