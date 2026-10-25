import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const router = fs.readFileSync(new URL('../src/app/router/index.jsx', import.meta.url), 'utf8');

test('الراوتر: صفحات لوحة الإدارة لا تُستورد بشكل ثابت (تُحمَّل عند الطلب)', () => {
  const staticAdminImports = router.match(/^import .* from '\.\.\/\.\.\/pages\/admin\/.*';$/gm) || [];
  assert.deepEqual(staticAdminImports, [], 'استيراد ثابت لصفحة إدارة يُدخلها في الحزمة الأولى');
  const lazyAdmin = router.match(/lazy\(\(\) => import\('\.\.\/\.\.\/pages\/admin\//g) || [];
  assert.ok(lazyAdmin.length >= 15, `عدد صفحات الإدارة المحمّلة عند الطلب أقل من المتوقع: ${lazyAdmin.length}`);
});

test('الراوتر: الصفحة الرئيسية تبقى في الحزمة الأولى', () => {
  assert.match(router, /^import Home from '\.\.\/\.\.\/pages\/public\/Home';$/m);
});

test('الراوتر: Suspense وRouteError موجودان على الجذر', () => {
  assert.match(router, /<Suspense fallback=\{<PageLoader \/>\}>/);
  assert.match(router, /errorElement: <RouteError \/>/);
});
