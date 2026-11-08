import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/** 0047 — ملخص حالة رابط التفعيل للإدارة + ترقيم سجل العمليات المختصر. فحوص نصّية (لا قاعدة بيانات). */
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const sql = read('supabase/migrations/0047_member_activation_overview.sql').replace(/--.*$/gm, '');

test('0047: الدالة SECURITY DEFINER بمسار ثابت ومقصورة على مديري نظام الأعضاء', () => {
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = public, pg_temp/);
  assert.match(sql, /can_manage_member_system\(\)/);
  assert.match(sql, /revoke all on function public\.member_activation_overview\(\) from public, anon/);
  assert.doesNotMatch(sql, /token_hash/, 'لا يُكشف الرمز ولا مجزّؤه');
});

test('0047: ملف الرجوع موجود', () => {
  assert.match(read('supabase/rollback/0047_member_activation_overview_down.sql'), /drop function if exists public\.member_activation_overview/);
});

test('سجل العمليات يستعمل نافذة الترقيم المختصرة', () => {
  const src = read('src/pages/admin/Audit.jsx');
  assert.match(src, /pageWindow\(page, totalPages\)/);
  assert.doesNotMatch(src, /Array\.from\(\{ length: totalPages/);
});
