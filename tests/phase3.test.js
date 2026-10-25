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
