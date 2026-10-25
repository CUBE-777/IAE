import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('0024: current_admin_role و is_admin يشترطان mfa_satisfied، والدالة مغلقة على أدوار العميل', () => {
  const sql = read('supabase/migrations/0024_mfa_enforcement.sql');
  const roleFn = sql.match(/function public\.current_admin_role\(\)[\s\S]*?\$\$;/)?.[0] || '';
  const adminFn = sql.match(/function public\.is_admin\(\)[\s\S]*?\$\$;/)?.[0] || '';
  assert.match(roleFn, /public\.mfa_satisfied\(\)/);
  assert.match(adminFn, /public\.mfa_satisfied\(\)/);
  assert.match(sql, /revoke execute on function public\.mfa_satisfied\(\) from public, anon, authenticated/);
  // من لم يفعّل MFA لا يُقفل: الشرط يمرّ إن لم يوجد عامل موثّق
  assert.match(sql, /not exists \(\s*select 1 from auth\.mfa_factors/);
});

test('0023: الموافقة على الخصوصية يختمها الخادم ولا يضعها العميل', () => {
  const sql = read('supabase/migrations/0023_privacy_consent.sql');
  assert.match(sql, /grant insert \(privacy_consent\) on public\.membership_requests to anon, authenticated/);
  assert.doesNotMatch(sql, /grant insert \([^)]*privacy_consent_at/);
  assert.match(sql, /new\.privacy_consent_at := case when coalesce\(new\.privacy_consent, false\) then now\(\)/);
});

test('Edge Function: لا CORS بنجمة', () => {
  const ts = read('supabase/functions/admin-create-user/index.ts');
  assert.doesNotMatch(ts, /Access-Control-Allow-Origin['"]?:\s*['"]\*['"]/);
  assert.match(ts, /ALLOWED_ORIGINS/);
});

test('الواجهة: مسارات الخصوصية وأمان الحساب، وشاشة الرمز، وإرسال الموافقة', () => {
  const router = read('src/app/router/index.jsx');
  assert.match(router, /path: '\/privacy'/);
  assert.match(router, /path: '\/admin\/security', element: protectedAdmin\(\[\]/);
  assert.match(read('src/components/admin/ProtectedRoute.jsx'), /mfaRequired/);
  assert.match(read('src/pages/admin/Login.jsx'), /needsMfa/);
  assert.match(read('src/features/membership/MembershipForm.jsx'), /privacy_consent: true/);
});
