import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stripSqlComments = (sql) => sql.replace(/--.*$/gm, '');
const stripJsComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

test('0027: العلم عمود في profiles يُسقطه trigger على auth.users عند تغيّر كلمة المرور فقط', () => {
  const code = stripSqlComments(read('supabase/migrations/0027_must_change_password_server_side.sql'));
  assert.match(code, /add column if not exists must_change_password boolean not null default false/);
  assert.match(code, /new\.encrypted_password is distinct from old\.encrypted_password/);
  assert.match(code, /after update of encrypted_password on auth\.users/);
  assert.match(code, /security definer/);
  assert.match(code, /set search_path = public, pg_temp/);
  assert.match(code, /revoke execute on function public\.clear_must_change_password_on_password_change\(\) from public, anon, authenticated/);
  // ترحيل الحسابات القديمة التي علمها في user_metadata
  assert.match(code, /raw_user_meta_data ->> 'must_change_password'/);
});

test('admin-create-user: لا تُعيد رسائل أخطاء Supabase الخام للعميل وفيها حدّ للمعدل', () => {
  const src = stripJsComments(read('supabase/functions/admin-create-user/index.ts'));
  assert.doesNotMatch(src, /json\(\{\s*error:\s*createErr/);
  assert.doesNotMatch(src, /error:\s*insertErr\.message/);
  assert.match(src, /rateLimited\(/);
  assert.match(src, /429/);
});

test('trStrong والإشعارات لا تستخدمان innerHTML', () => {
  assert.doesNotMatch(stripJsComments(read('src/i18n/adminDict.jsx')), /dangerouslySetInnerHTML|innerHTML/);
  assert.doesNotMatch(stripJsComments(read('src/utils/notifications.js')), /innerHTML/);
});

test('الملفات الأساسية للمستودع موجودة', () => {
  for (const f of ['.gitignore', '.env.example', '.github/workflows/ci.yml']) {
    assert.ok(fs.existsSync(new URL(`../${f}`, import.meta.url)), `${f} مفقود`);
  }
});
