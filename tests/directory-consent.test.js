import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => fs.readFileSync(`${ROOT}/${f}`, 'utf8');
const locale = (lg) => JSON.parse(read(`src/i18n/locales/${lg}.json`));
const stripSql = (sql) => sql.replace(/--.*$/gm, '');
const sql = stripSql(read('supabase/migrations/0030_directory_consent_and_latin_name.sql'));

test('0030: العمود true للموجودين ثم الافتراضي false للجدد', () => {
  assert.match(sql, /add column if not exists show_in_directory boolean not null default true/);
  assert.match(sql, /alter column show_in_directory set default false/);
});

test('0030: الزائر لا يقرأ إلا الأعضاء الموافقين، والعمود ممنوح له', () => {
  assert.match(sql, /using \(status = 'active' and deleted_at is null and show_in_directory = true\)/);
  assert.match(sql, /grant select \(show_in_directory\) on public\.members to anon/);
  assert.match(sql, /to anon\s+using/);
});

test('0030: submit_membership_form — الموافقتان اختياريتان ولا تُفترضان، ونشر الصورة مشروط بالأولى', () => {
  assert.match(sql, /v_consent_dir\s*:=\s*coalesce\(p_data->>'consent_directory', ''\) = 'true'/);
  assert.match(sql, /v_consent_photo\s*:=\s*v_consent_dir and coalesce\(p_data->>'consent_photo', ''\) = 'true'/);
  assert.match(sql, /'name_latin',\s+v_name_latin/);
  assert.match(sql, /coalesce\(v_name_ar, v_name_latin\)/);
});

test('0030: الدوال تحتفظ بالأمان (security definer + search_path) ولا تمنح صلاحيات جديدة', () => {
  const defs = sql.match(/create or replace function[\s\S]*?\$\$;/g) || [];
  assert.equal(defs.length, 2);
  for (const d of defs) {
    assert.match(d, /security definer/);
    assert.match(d, /set search_path = public, pg_temp/);
  }
  assert.doesNotMatch(sql, /grant execute/i);
});

test('0030: القبول يضع الموافقة ويحفظ الاسم اللاتيني ولا يظهر العضو دون موافقة صريحة', () => {
  assert.match(sql, /status, show_in_directory/);
  assert.match(sql, /coalesce\(v_data->>'consent_directory', ''\) = 'true'/);
  assert.match(sql, /'name_latin', btrim\(v_data->>'name_latin'\)/);
});

test('rls_smoke: يفحص إخفاء غير الموافقين عن الزائر', () => {
  const smoke = read('supabase/tests/rls_smoke.sql');
  assert.match(smoke, /__smoke_hidden__/);
  assert.match(smoke, /FAIL: anon يرى عضوًا لم يوافق/);
});

test('نموذج الانخراط: اسمان (واحد على الأقل) وموافقتان غير مفعّلتين افتراضيًا', () => {
  const src = read('src/pages/public/MembershipFormPage.jsx');
  assert.match(src, /consent_directory: false, consent_photo: false/);
  assert.match(src, /errors\.nameRequired/);
  assert.match(src, /full_name: nameAr \|\| nameLatin/);
  assert.match(src, /consent_photo: values\.consent_directory === true && values\.consent_photo === true/);
  assert.match(src, /disabled=\{submitting \|\| !values\.consent_directory\}/);
});

test('مفاتيح النموذج الجديدة موجودة بالثلاث لغات', () => {
  const keys = ['nameHint', 'consentDirectory', 'consentPhoto', 'consentNote'];
  for (const lg of ['ar', 'fr', 'en']) {
    const m = locale(lg).membershipForm;
    for (const k of keys) assert.ok(m[k] && m[k].length > 10, `${lg}: ${k}`);
    assert.ok(m.fields.nameArabic && m.fields.nameLatin, `${lg}: fields`);
    assert.ok(m.groups.visibility, `${lg}: groups.visibility`);
    assert.ok(m.errors.nameRequired, `${lg}: errors.nameRequired`);
    assert.ok(locale(lg).admin.requests.photoPublishFailed, `${lg}: photoPublishFailed`);
  }
});

test('نشر الصورة عند القبول: فقط بموافقة صريحة، وفشله لا يُفشل القبول', () => {
  const src = read('src/pages/admin/Requests.jsx');
  assert.match(src, /d\.consent_directory === true && d\.consent_photo === true/);
  const call = src.indexOf('recordAnnualMembership(isRenewal');
  const publish = src.indexOf('publishMemberPhotoFromForm(res.member_id');
  assert.ok(call > 0 && publish > call, 'النشر يجب أن يأتي بعد تسجيل الانخراط');
  assert.match(src, /photoPublishFailed/);
  const svc = read('src/services/supabase/membershipFlow.service.js');
  assert.match(svc, /update\(\{ photo_url: publicUrl \}\)/);
});

test('الإدارة: خيار الظهور يُحفظ فقط إن كان العمود موجودًا، ويعمل الحفظ بدونه', () => {
  const modal = read('src/pages/admin/MemberFormModal.jsx');
  assert.match(modal, /!isEdit \|\| 'show_in_directory' in member/);
  const svc = read('src/services/supabase/adminMembers.service.js');
  assert.match(svc, /delete copy\[DIRECTORY_COL\]/);
  assert.match(svc, /degraded = hasProfileCols\(payload\)/);
});
