import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('admin-create-user: يفرض aal2 على من فعّل MFA (service_role يتجاوز RLS)', () => {
  const src = read('supabase/functions/admin-create-user/index.ts');
  assert.match(src, /function jwtAal\(/);
  assert.match(src, /jwtAal\(token\) !== 'aal2'/);
  assert.match(src, /auth\.admin\.mfa\.listFactors/);
  assert.match(src, /status === 'verified'/);
  // الفحص يسبق إنشاء الحساب
  assert.ok(src.indexOf("jwtAal(token) !== 'aal2'") < src.indexOf('auth.admin.createUser'));
});

test('0025: الكتابة على association-media للمحتوى/الأعضاء فقط وليس لأي مسؤول', () => {
  const sql = read('supabase/migrations/0025_storage_media_roles.sql');
  for (const op of ['insert', 'update', 'delete']) {
    assert.match(sql, new RegExp(`create policy "association_media_admin_${op}"`));
  }
  assert.match(sql, /can_manage_content\(\) or public\.can_manage_members\(\)/);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /is_admin\(\)/);
});

test('ملفات المشروع الأساسية موجودة ولا تُرفع الأسرار', () => {
  assert.ok(fs.existsSync(new URL('../.gitignore', import.meta.url)));
  assert.ok(fs.existsSync(new URL('../.env.example', import.meta.url)));
  assert.ok(fs.existsSync(new URL('../.github/workflows/ci.yml', import.meta.url)));
  assert.match(read('.gitignore'), /^\.env$/m);
  // لا مفاتيح حقيقية في المثال (JWT يبدأ بـ eyJ) ولا service_role
  assert.doesNotMatch(read('.env.example'), /eyJ[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(read('.env.example'), /^[^#\n]*service_role/im);
});

test('0026: بصمة العميل sha256 بملح سرّي مغلق على أدوار العميل، لا md5', () => {
  const sql = read('supabase/migrations/0026_throttle_salted_hash.sql');
  const code = sql.replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /md5\(/);
  assert.match(code, /sha256\(/);
  assert.match(code, /membership_throttle_secret/);
  assert.match(code, /revoke all on table public\.membership_throttle_secret from public, anon, authenticated/);
  assert.match(code, /set search_path = public, pg_temp/);
  assert.match(code, /raise exception 'rate_limited'/);
});

test('كلمة المرور المؤقتة: الدالة تضع العلم في profiles والواجهة تعرض شاشة إلزامية قبل اللوحة', () => {
  const edge = read('supabase/functions/admin-create-user/index.ts');
  assert.match(edge, /must_change_password:\s*true/);
  assert.doesNotMatch(edge.replace(/^\s*\/\/.*$/gm, ''), /user_metadata/, 'العلم لم يعد في user_metadata (قابل للتعديل من صاحب الحساب)');
  const route = read('src/components/admin/ProtectedRoute.jsx');
  assert.match(route, /profile\?\.must_change_password === true/);
  assert.match(route, /<ForcePasswordChange \/>/);
  // الحارس يأتي بعد فحص الجلسة/MFA/الخمول وقبل فحص الدور
  assert.ok(route.indexOf('must_change_password') > route.indexOf('mfaRequired'));
  assert.ok(route.indexOf('must_change_password') < route.indexOf('roles.includes(profile.role)'));
  // تنظيف العلم القديم في user_metadata للحسابات السابقة
  assert.match(read('src/services/supabase/auth.service.js'), /must_change_password: false/);
});
