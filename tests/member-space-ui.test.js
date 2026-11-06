import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as R from '../src/constants/roles.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stripSql = (sql) => sql.replace(/--.*$/gm, '');
const sql36 = stripSql(read('supabase/migrations/0036_member_space_activation_and_card_requests.sql'));
const sql37 = stripSql(read('supabase/migrations/0037_member_reactivation.sql'));
const sql35 = read('supabase/migrations/0035_member_accounts.sql');
const edge = read('supabase/functions/member-activate/index.ts');
const service = read('src/services/supabase/memberSpace.service.js');
const router = read('src/app/router/index.jsx');
const membersPage = read('src/pages/admin/Members.jsx');
const locales = Object.fromEntries(['ar', 'fr', 'en'].map((l) => [l, JSON.parse(read(`src/i18n/locales/${l}.json`))]));
const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);

const MEMBER_FILES = [
  'src/layouts/MemberLayout.jsx', 'src/components/member/MemberPage.jsx',
  'src/pages/member/MemberLogin.jsx', 'src/pages/member/MemberActivate.jsx',
  'src/pages/member/MemberHome.jsx', 'src/pages/member/MemberCard.jsx', 'src/pages/member/MemberSecurity.jsx',
];

test('الأدوار: ROLES_MEMBER_SYSTEM يطابق can_manage_member_system في 0035 (الأربعة بلا نواب)', () => {
  const body = sql35.match(/function public\.can_manage_member_system\(\)[\s\S]*?in \(([^)]*)\)/)[1];
  const sqlRoles = [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual([...R.ROLES_MEMBER_SYSTEM].sort(), sqlRoles);
  assert.ok(!R.ROLES_MEMBER_SYSTEM.some((r) => r.startsWith('deputy')));
  for (const r of R.ROLES_MEMBER_SYSTEM) assert.ok(R.ALL_ROLES.includes(r));
});

test('الخدمة: كل RPC وبارامتراتها موجودة في 0036 بالأسماء نفسها', () => {
  const calls = [...service.matchAll(/rpc\('([a-z_]+)'(?:, \{([^}]*)\})?/g)];
  assert.ok(calls.length >= 8);
  for (const [, name, args] of calls) {
    const m = sql36.match(new RegExp(`function public\\.${name}\\(([^)]*)\\)`));
    assert.ok(m, `الدالة ${name} غير معرّفة في 0036`);
    const declared = [...m[1].matchAll(/\b(p_[a-z_]+)\b/g)].map((x) => x[1]);
    const used = args ? [...args.matchAll(/\b(p_[a-z_]+)\b/g)].map((x) => x[1]) : [];
    for (const u of used) assert.ok(declared.includes(u), `${name}: المعامل ${u} غير موجود`);
  }
});

test('الراوتر: مسارات /member/* مسجّلة وتُحمَّل عند الطلب، والعضو الفرعي خلف MemberLayout', () => {
  for (const p of ["'/member/login'", "'/member/activate/:token'", "path: '/member'", "path: 'card'", "path: 'security'"]) assert.ok(router.includes(p), p);
  assert.match(router, /path: '\/member',\s*element: <MemberLayout \/>/);
  assert.doesNotMatch(router, /^import .*pages\/member\//m);
  assert.match(read('public/robots.txt'), /Disallow: \/member\//);
});

test('الواجهة: كل مفتاح ترجمة member.* و boardProfile.* مستعمل موجود في ar/fr/en', () => {
  const missing = [];
  for (const f of MEMBER_FILES) {
    const src = read(f);
    const keys = new Set([...src.matchAll(/['"`]((?:member|boardProfile)\.[A-Za-z_.]+)['"`]/g)].map((m) => m[1]));
    // مفاتيح ديناميكية: member.home.request.${status} و member.activate.state.${key} و boardProfile.tr.${code}
    for (const k of ['pending', 'approved', 'rejected', 'cancelled']) keys.add(`member.home.request.${k}`);
    for (const k of ['pending', 'approved', 'rejected', 'cancelled']) keys.add(`member.history.status.${k}`);
    for (const k of ['invalid', 'used', 'expired']) { keys.add(`member.activate.state.${k}.title`); keys.add(`member.activate.state.${k}.text`); }
    for (const k of ['university', 'promotion', 'track', 'profession', 'email']) keys.add(`member.home.fields.${k}`);
    for (const l of ['ar', 'fr', 'en']) for (const k of keys) {
      if (k.endsWith('.')) continue;
      if (typeof get(locales[l], k) !== 'string') missing.push(`${l}:${k}`);
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});

test('الواجهة: لا يدخل المسؤول صفحة العضو ولا يُسجَّل خروجه، ولا نكتب في members مباشرة', () => {
  const layout = read('src/layouts/MemberLayout.jsx');
  assert.match(layout, /notMember/);
  assert.doesNotMatch(layout, /logout\(\)\.catch|useEffect\([^)]*logout/);
  for (const f of MEMBER_FILES.concat(['src/services/supabase/memberSpace.service.js'])) {
    assert.doesNotMatch(read(f), /\.from\('members'\)\s*\.(update|insert|delete|upsert)/, f);
  }
});

test('الصورة المقترحة: اسم الملف يطابق نمط سياسة 0036 (member-<id>/photo-<hex 8..32>.ext)', () => {
  assert.match(service, /`member-\$\{memberId\}\/photo-\$\{hex\}\.\$\{ext\}`/);
  assert.match(service, /new Uint8Array\(8\)/); // 16 خانة سداسية ضمن 8..32
  assert.match(sql36, /\^member-\[0-9a-f-\]\{36\}\/photo-\[0-9a-f\]\{8,32\}\\\.\(webp\|jpg\|png\)\$/);
});

test('MemberCard: لا يرسل bio ولا ترجمة المهنة، ويُبقي صورة الطلب المعلّق', () => {
  const card = read('src/pages/member/MemberCard.jsx');
  assert.doesNotMatch(card, /\bbio:\s*values/);
  assert.match(card, /MEMBER_TR_FIELDS\.filter\(\(f\) => f\.key !== 'profession'\)/);
  assert.match(card, /pending\?\.photo_path \|\| null/);
});

test('الإدارة: أزرار نظام الأعضاء تظهر للأدوار الأربعة فقط', () => {
  assert.match(membersPage, /ROLES_MEMBER_SYSTEM\.includes\(profile\?\.role\)/);
  assert.match(membersPage, /canMemberSystem && m\.status === 'active'/);
  assert.match(membersPage, /canMemberSystem && \(\s*<button[\s\S]{0,80}?setRequestsOpen/);
});

test('0037: الإصدار والتفعيل لعضو له حساب — لا مستخدم جديد، ولا يُحذف المستخدم القائم', () => {
  for (const n of ['issue_member_activation_link', 'get_member_activation_link', 'prepare_member_activation', 'finalize_member_activation']) {
    assert.match(sql37, new RegExp(`create or replace function public\\.${n}\\(`), n);
  }
  assert.match(sql37, /grant execute on function public\.prepare_member_activation\(text\)\s+to service_role/);
  assert.match(sql37, /grant execute on function public\.finalize_member_activation\(text, uuid\)\s+to service_role/);
  assert.doesNotMatch(sql37, /grant execute on function public\.(prepare|finalize)_member_activation[^;]*(anon|authenticated)/);
  assert.match(sql37, /v_acc\.user_id <> p_user_id/); // لا يُنهى التفعيل إلا لصاحب الحساب
  assert.match(sql37, /not v_acc\.is_active/);        // الحساب المعطّل لا يُستعاد
  assert.doesNotMatch(sql37, /insert into public\.member_accounts[\s\S]{0,200}on conflict/);
  assert.match(sql37, /MEMBER_RESET_PASSWORD_VIA_LINK/); // مسجّل في audit_logs
  // الإصدار لا يكشف شيئًا للزائر ولا يعيد البريد كاملًا
  const getFn = sql37.slice(sql37.indexOf('function public.get_member_activation_link'), sql37.indexOf('function public.prepare_member_activation'));
  assert.match(getFn, /email_hint/);
  assert.doesNotMatch(getFn, /'email',/);
});

test('member-activate: مسار الاستعادة يغيّر كلمة المرور فقط ولا يحذف المستخدم القائم', () => {
  assert.match(edge, /existing_user_id/);
  assert.match(edge, /auth\.admin\.updateUserById\(existingUserId, \{ password \}\)/);
  assert.equal((edge.match(/deleteUser\(/g) || []).length, 1);
  assert.match(edge, /deleteUser\(created\.user\.id\)/); // التراجع للمستخدم المُنشأ هنا فقط
  assert.doesNotMatch(edge, /body\.email/);
  const resetPart = edge.slice(edge.indexOf('if (existingUserId)'), edge.indexOf('const { data: created'));
  assert.doesNotMatch(resetPart, /deleteUser/);
});

test('الأمان: تغيير كلمة المرور يعيد التحقق من الحالية قبل updateUser، ويحدّ الجلسات الأخرى فقط', () => {
  const fn = service.slice(service.indexOf('export async function changeMyPassword'), service.indexOf('export async function signOutOtherSessions'));
  assert.ok(fn.indexOf('signInWithPassword') > -1 && fn.indexOf('signInWithPassword') < fn.indexOf('updateUser'), 'إعادة التحقق قبل التغيير');
  assert.match(fn, /WRONG_CURRENT/);
  assert.match(fn, /SAME/);
  assert.match(service, /signOut\(\{ scope: 'others' \}\)/);   // لا نُنهي الجلسة الحالية
  assert.doesNotMatch(service, /scope: 'global'/);
  const page = read('src/pages/member/MemberSecurity.jsx');
  assert.match(page, /changeMyPassword\(current, next/);
  assert.doesNotMatch(page, /enrollTotp|listVerifiedTotpFactors/); // MFA للأعضاء غير مفروض في الخادم، فلا نعرضه
});

test('الأمان: الصفحة في شريط التنقل وفي الراوتر خلف MemberLayout، والمشاركة مع التفعيل عبر util واحد', () => {
  assert.match(read('src/components/member/MemberPage.jsx'), /to="\/member\/security"/);
  assert.match(read('src/pages/member/MemberActivate.jsx'), /from '..\/..\/utils\/passwordStrength'/);
  assert.doesNotMatch(read('src/pages/member/MemberActivate.jsx'), /function passwordStrength/);
});

test('MemberLayout: حساب إداري يرى رابط لوحة الإدارة مع زر الخروج ولا يُسجَّل خروجه', () => {
  const layout = read('src/layouts/MemberLayout.jsx');
  assert.match(layout, /profile\?\.is_active[\s\S]{0,120}\/admin\/dashboard/);
  assert.match(layout, /notMember/);
});

test('السجل: يُقرأ من الجدول بسياسة صاحبه (بلا migration) ويقتصر على أعمدة العرض ولا يقرأ data', () => {
  const fn = service.slice(service.indexOf('export async function listMyCardRequests'), service.indexOf('export async function submitCardRequest'));
  assert.match(fn, /\.from\('member_card_requests'\)/);
  assert.match(fn, /\.eq\('member_id', memberId\)/);
  assert.match(fn, /\.select\('id, status, review_note, created_at, reviewed_at'\)/);
  assert.doesNotMatch(fn, /\.(insert|update|delete|upsert)\(/);
  // الاعتماد على سياسة 0036: صاحب الطلب يقرأ طلباته فقط عبر SELECT
  assert.match(sql36, /grant select on public\.member_card_requests to authenticated/);
  assert.match(sql36, /member_card_requests_own_read[\s\S]*?using \(member_id = public\.current_member_id\(\)\)/);
  const home = read('src/pages/member/MemberHome.jsx');
  assert.match(home, /olderRequests\(history, req\?\.id\)/); // آخر طلب لا يتكرر في السجل
});
