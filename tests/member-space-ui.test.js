import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as R from '../src/constants/roles.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stripSql = (sql) => sql.replace(/--.*$/gm, '');
const sql36 = stripSql(read('supabase/migrations/0036_member_space_activation_and_card_requests.sql'));
const sql37 = stripSql(read('supabase/migrations/0037_member_reactivation.sql'));
const sql39 = stripSql(read('supabase/migrations/0039_member_access_requests.sql'));
const sql40 = stripSql(read('supabase/migrations/0040_member_card_tokens.sql'));
const sql41 = stripSql(read('supabase/migrations/0041_activity_attendance.sql'));
const sql42 = stripSql(read('supabase/migrations/0042_member_card_permanent_token.sql'));
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
  'src/pages/member/MemberHelp.jsx', 'src/pages/member/MemberAnnouncements.jsx',
  'src/pages/member/MemberIdCard.jsx', 'src/components/member/MembershipBadge.jsx', 'src/components/member/MemberAttendanceCards.jsx', 'src/pages/public/VerifyCard.jsx',
];

test('الأدوار: ROLES_MEMBER_SYSTEM يطابق can_manage_member_system في 0035 (الأربعة بلا نواب)', () => {
  const body = sql35.match(/function public\.can_manage_member_system\(\)[\s\S]*?in \(([^)]*)\)/)[1];
  const sqlRoles = [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual([...R.ROLES_MEMBER_SYSTEM].sort(), sqlRoles);
  assert.ok(!R.ROLES_MEMBER_SYSTEM.some((r) => r.startsWith('deputy')));
  for (const r of R.ROLES_MEMBER_SYSTEM) assert.ok(R.ALL_ROLES.includes(r));
});

test('الخدمة: كل RPC وبارامتراتها موجودة في migrations الأعضاء (0036/0039/0040/0041/0042) بالأسماء نفسها', () => {
  const calls = [...service.matchAll(/rpc\('([a-z_]+)'(?:, \{([^}]*)\})?/g)];
  assert.ok(calls.length >= 11);
  for (const [, name, args] of calls) {
    const m = (sql36 + sql39 + sql40 + sql41 + sql42).match(new RegExp(`function public\\.${name}\\(([^)]*)\\)`));
    assert.ok(m, `الدالة ${name} غير معرّفة في 0036/0039`);
    const declared = [...m[1].matchAll(/\b(p_[a-z_]+)\b/g)].map((x) => x[1]);
    const used = args ? [...args.matchAll(/\b(p_[a-z_]+)\b/g)].map((x) => x[1]) : [];
    for (const u of used) assert.ok(declared.includes(u), `${name}: المعامل ${u} غير موجود`);
  }
});

test('الراوتر: مسارات /member/* مسجّلة وتُحمَّل عند الطلب، والعضو الفرعي خلف MemberLayout', () => {
  for (const p of ["'/member/login'", "'/member/activate/:token'", "path: '/member'", "path: 'card'", "path: 'id'", "path: 'security'", "path: 'announcements'", "'/member/help'"]) assert.ok(router.includes(p), p);
  assert.match(router, /path: '\/member',\s*element: <MemberLayout \/>/);
  assert.doesNotMatch(router, /^import .*pages\/member\//m);
  assert.match(read('public/robots.txt'), /Disallow: \/member\//);
});

test('الواجهة: كل مفتاح ترجمة member.* و boardProfile.* مستعمل موجود في ar/fr/en', () => {
  const missing = [];
  for (const f of MEMBER_FILES) {
    const src = read(f);
    const keys = new Set([...src.matchAll(/['"`]((?:member|boardProfile|verify)\.[A-Za-z_.]+)['"`]/g)].map((m) => m[1]));
    // مفاتيح ديناميكية: member.home.request.${status} و member.activate.state.${key} و boardProfile.tr.${code}
    for (const k of ['pending', 'approved', 'rejected', 'cancelled']) keys.add(`member.home.request.${k}`);
    for (const k of ['pending', 'approved', 'rejected', 'cancelled']) keys.add(`member.history.status.${k}`);
    for (const k of ['invalid', 'used', 'expired']) { keys.add(`member.activate.state.${k}.title`); keys.add(`member.activate.state.${k}.text`); }
    for (const k of ['university', 'promotion', 'track', 'profession', 'email']) keys.add(`member.home.fields.${k}`);
    // بطاقة العضوية: member.id.badge.${state} و verify.state.${state}.title/text
    for (const k of ['active', 'lapsed', 'none', 'unset']) keys.add(`member.id.badge.${k}`);
    for (const k of ['active', 'inactive', 'unknown', 'invalid', 'problem']) { keys.add(`verify.state.${k}.title`); keys.add(`verify.state.${k}.text`); }
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

test('الإعلانات: تبويب في الفضاء بنقطة «جديد»، وتستعمل الجلب العام نفسه (RLS) دون جداول جديدة', () => {
  assert.match(read('src/components/member/MemberPage.jsx'), /to="\/member\/announcements"/);
  assert.match(read('src/components/member/MemberPage.jsx'), /useNewAnnouncement\(\)/);
  const page = read('src/pages/member/MemberAnnouncements.jsx');
  assert.match(page, /fetchPublishedAnnouncements/);
  assert.match(page, /AnnouncementCard/);
  const svc = read('src/services/supabase/announcements.service.js');
  const fn = svc.slice(svc.indexOf('export async function fetchLatestAnnouncementStamp'), svc.indexOf('export async function fetchAnnouncementBySlug'));
  assert.match(fn, /\.select\('start_at, created_at'\)/);
  assert.doesNotMatch(fn, /\.(insert|update|delete|upsert)\(/);
});

test('طلب المساعدة: الصفحة العامة تستدعي RPC دون إظهار رابط، ورسالة النجاح لا تعتمد على وجود البريد', () => {
  const page = read('src/pages/member/MemberHelp.jsx');
  assert.match(page, /requestAccessHelp\(email\)/);
  assert.doesNotMatch(page, /token|activate\//);               // لا رابط يظهر لمقدّم الطلب
  assert.match(page, /setDone\(true\)/);
  assert.match(read('src/pages/member/MemberLogin.jsx'), /to="\/member\/help"/);
  assert.match(service, /rpc\('request_member_access_help', \{ p_email:/);
});

test('طلب المساعدة: لوحة الإدارة خلف can_manage_member_system، وإصدار الرابط يُعلِّم الطلب معالَجًا', () => {
  assert.match(membersPage, /canMemberSystem && \(\s*<button className="admin-quick-action" onClick=\{\(\) => setAccessOpen\(true\)\}/);
  const modal = read('src/pages/admin/MemberAccessRequestsModal.jsx');
  assert.match(modal, /onIssued=/);
  assert.match(modal, /resolveAccessRequest\(request\.id, 'handled'\)/);
  assert.match(modal, /resolveAccessRequest\(request\.id, 'dismissed'\)/);
  assert.match(read('src/pages/admin/MemberActivationModal.jsx'), /onIssued\?\.\(res\)/);
});

/* ---------- بطاقة العضوية الرقمية (0040): المسارات والتنقل والترجمة والتخزين والخصوصية ---------- */

test('البطاقة: مسار /member/id داخل MemberLayout و/verify/:token عام خارجه، كلاهما lazy، والتبويب في التنقل', () => {
  assert.match(router, /const MemberIdCard = lazy\(\(\) => import\('\.\.\/\.\.\/pages\/member\/MemberIdCard'\)\)/);
  assert.match(router, /const VerifyCard = lazy\(\(\) => import\('\.\.\/\.\.\/pages\/public\/VerifyCard'\)\)/);
  assert.match(router, /path: '\/member',\s*element: <MemberLayout \/>,\s*children: \[[\s\S]*?\{ path: 'id', element: <MemberIdCard \/> \}/);
  assert.match(router, /\{ path: '\/verify\/:token', element: <VerifyCard \/> \}/);
  // /verify ليس ضمن أبناء /member (لا يمرّ بحارس الجلسة)
  const memberBlock = router.slice(router.indexOf("path: '/member',"), router.indexOf("// /admin (بلا لاحقة)"));
  assert.doesNotMatch(memberBlock, /verify/);
  assert.match(read('src/components/member/MemberPage.jsx'), /<NavLink to="\/member\/id">[\s\S]*?\{t\('member\.nav\.id'\)\}[\s\S]*?<\/NavLink>/);
});

test('البطاقة: مفاتيح member.id.* و member.nav.id و verify.* موجودة في اللغات الثلاث (بنصوص غير فارغة)', () => {
  const must = [
    'member.nav.id', 'member.id.title', 'member.id.description', 'member.id.pageTitle', 'member.id.qrLabel', 'member.id.refresh',
    'member.id.fullscreen', 'member.id.close', 'member.id.expiresIn', 'member.id.status.ready', 'member.id.problem.rateLimited',
    'member.id.problem.network', 'member.id.problem.forbidden', 'member.id.badge.active', 'member.id.badge.lapsed',
    'member.id.badge.none', 'member.id.badge.unset', 'verify.pageTitle', 'verify.title', 'verify.scanAnother', 'verify.scanHelp',
    'verify.state.active.title', 'verify.state.inactive.title', 'verify.state.invalid.title', 'verify.state.invalid.text',
  ];
  for (const l of ['ar', 'fr', 'en']) for (const k of must) {
    const v = get(locales[l], k);
    assert.ok(typeof v === 'string' && v.trim().length > 0, `${l}:${k}`);
  }
  // نصّ المنتهي/المجهول واحد (لا تفريق): لا مفتاح expired ولا unknownToken
  assert.equal(get(locales.ar, 'verify.state.expired'), undefined);
  assert.equal(get(locales.ar, 'verify.state.notFound'), undefined);
  // التجديد المذكور للمستخدم يطابق الحقيقة (90ث/دقيقتان)
  assert.match(get(locales.ar, 'member.id.badge.active'), /\{\{season\}\}/);
});

test('البطاقة: الرمز لا يُخزَّن في أي storage ولا رابط ولا console (hook والصفحتان والخدمات)', () => {
  for (const f of [
    'src/hooks/useMemberCardToken.js', 'src/pages/member/MemberIdCard.jsx', 'src/pages/public/VerifyCard.jsx',
    'src/utils/memberCardToken.js', 'src/components/member/MembershipBadge.jsx', 'src/hooks/useMyMembershipStatus.js',
    'src/components/member/QrImage.jsx', 'src/components/member/MemberAttendanceCards.jsx', 'src/pages/admin/AttendanceScanner.jsx', 'src/utils/attendanceCode.js',
  ]) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // بلا تعليقات (تذكر الكلمات المحظورة للتوضيح)
    assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|document\.cookie/, f);
    assert.doesNotMatch(src, /console\./, f);
    assert.doesNotMatch(src, /history\.(pushState|replaceState)|setSearchParams|navigate\(/, f);
  }
  const svc = service.slice(service.indexOf('بطاقة العضوية الرقمية (0040)')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(svc, /console\.|localStorage|sessionStorage/);
});

test('البطاقة: hook الرمز الثابت — جلب مرة واحدة بلا مؤقتات ولا تجديد تلقائي، وإعادة إنشاء بطلب العضو فقط', () => {
  const hook = read('src/hooks/useMemberCardToken.js');
  assert.match(hook, /issueMemberCardToken/);
  assert.match(hook, /regenerateMemberCardToken/);
  assert.match(hook, /classifyIssueError\(err\)/);
  assert.match(hook, /if \(inflightRef\.current\) return false;/);   // لا طلبان متوازيان
  assert.match(hook, /aliveRef\.current = false/);
  assert.doesNotMatch(hook.replace(/\/\*[\s\S]*?\*\//g, ''), /setTimeout|setInterval|visibilitychange|CARD_REFRESH_MS/); // لا تجديد تلقائي
});

test('البطاقة: MemberIdCard — SVG داخلي بلا canvas/خارجي، ألوان ثابتة، aria، reduced-motion، أهداف لمس 44px', () => {
  const page = read('src/pages/member/MemberIdCard.jsx');
  const qrImg = read('src/components/member/QrImage.jsx');
  assert.doesNotMatch(page + qrImg, /<canvas|new Image\(|qrserver|chart\.googleapis|api\.qrcode/i);
  assert.match(qrImg, /<svg[^>]*role="img"[^>]*aria-label=\{label\}/);
  assert.match(qrImg, /const QR_DARK = '#[0-9a-f]{6}'/i);
  assert.match(qrImg, /const QR_LIGHT = '#ffffff'/i);
  assert.match(page, /import QrImage from '..\/..\/components\/member\/QrImage'/);
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /scrollBehavior\(\)/);
  assert.match(page, /role="dialog"\s+aria-modal="true"/);
  assert.match(page, /e\.key === 'Escape'/);
  const css = read('src/styles/member-card.css');
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.member-id-btn \{[^}]*min-height: 44px/);
  assert.match(css, /\.member-qr \{[^}]*background: #fff/);
  assert.doesNotMatch(css.slice(css.indexOf('.member-qr {'), css.indexOf('.member-qr-empty')), /var\(--/); // القناع الداكن لا يقلب ألوان الرمز
  // لا حركة في العدّ التنازلي: لا animation/transition عليه ولا شريط متحرك
  assert.doesNotMatch(css.slice(css.indexOf('.member-id-countdown'), css.indexOf('.member-id-live')), /transition|animation/);
});

test('البطاقة: VerifyCard لا يعرض غير الحقول المسموحة ولا الرمز، ويوحّد المنتهي والمجهول', () => {
  const page = read('src/pages/public/VerifyCard.jsx');
  const used = new Set([...page.matchAll(/\b(?:person|result)\??\.([a-z_]+)/g)].map((m) => m[1]));
  const allowed = new Set(['full_name', 'photo_url', 'university', 'promotion', 'track', 'membership', 'valid']);
  assert.deepEqual([...used].filter((k) => !allowed.has(k)), []);
  assert.doesNotMatch(page, /\b(phone|email|city|profession|member_id)\b/);
  // الرمز يُمرَّر للخدمة فقط ولا يُعرض (لا {token} في JSX ولا في نص)
  assert.match(page, /verifyMemberCard\(token\)/);
  assert.doesNotMatch(page, /\{token\}|\$\{token\}|\{t\([^)]*token/);
  assert.match(page, /useNoindex\(\)/);
  assert.doesNotMatch(page, /InteriorLayout/); // يكتب canonical وog:url بمسار فيه الرمز
  // لون + أيقونة + نص
  assert.match(page, /const ICONS = \{ active: Check, inactive: AlertTriangle, unknown: AlertTriangle, invalid: X, problem: HelpCircle \}/);
  assert.match(page, /verify\.state\.\$\{state\}\.title/);
  // «مسح رمز آخر» يوضّح أن الماسح كاميرا الهاتف ولا يفتح كاميرا الموقع
  assert.match(page, /verify\.scanAnother/);
  assert.match(page, /verify\.scanHelp/);
  assert.doesNotMatch(page, /getUserMedia|BarcodeDetector|mediaDevices/);
  assert.match(get(locales.ar, 'verify.scanHelp'), /كاميرا هاتفك العادية/);
  // شكل واحد للأحمر: العنوان والنص مفتاحان ثابتان للحالة invalid
  assert.equal(get(locales.ar, 'verify.state.invalid.title'), 'رمز غير صالح أو منتهٍ');
});

test('البطاقة: الخدمات تستدعي الدوال الثلاث بأسمائها، وشارة الانخراط في MemberHome', () => {
  assert.match(service, /rpc\('issue_member_card_token'\)/);
  assert.match(service, /rpc\('verify_member_card', \{ p_token: String\(token \|\| ''\) \}\)/);
  assert.match(service, /rpc\('get_my_membership_status'\)/);
  const home = read('src/pages/member/MemberHome.jsx');
  assert.match(home, /import MembershipBadge from '..\/..\/components\/member\/MembershipBadge'/);
  assert.match(home, /<MembershipBadge status=\{membership\.status\}/);
});

test('البطاقة: netlify يضع noindex وno-referrer وno-store لـ /verify/*، وrobots يمنعه، وcamera=(self) للماسح داخل الموقع', () => {
  const toml = read('netlify.toml');
  const block = toml.match(/\[\[headers\]\]\s*for = "\/verify\/\*"[\s\S]*?(?=\n\[\[headers\]\]|\n# |$)/)[0];
  assert.match(block, /X-Robots-Tag = "noindex, nofollow"/);
  assert.match(block, /Referrer-Policy = "no-referrer"/);
  assert.match(block, /Cache-Control = "no-store"/);
  assert.match(toml, /Permissions-Policy = "geolocation=\(\), microphone=\(\), camera=\(self\), payment=\(\)"/); // 0041: ماسح الحضور داخل الموقع
  assert.doesNotMatch(block, /Permissions-Policy/);
  assert.match(read('public/robots.txt'), /^Disallow: \/verify\/$/m);
  assert.match(read('public/robots.txt'), /^Disallow: \/member\/$/m);
});

/* ---------- حضور الأنشطة (0041) ---------- */

test('الحضور: الخدمات تطابق دوال 0041، وزر البطاقة في الأنشطة للمخوَّلين فقط (ليس للقراءة فقط)', () => {
  const adm = read('src/services/supabase/adminAttendance.service.js') + service;
  for (const m of adm.matchAll(/rpc\('([a-z_]+)'(?:, \{([^}]*)\})?/g)) {
    if (!/attendance/.test(m[1])) continue;
    const def = sql41.match(new RegExp(`function public\\.${m[1]}\\(([^)]*)\\)`));
    assert.ok(def, `rpc ${m[1]} غير معرّفة في 0041`);
    const wanted = (m[2] || '').split(',').map((x) => x.split(':')[0].trim()).filter(Boolean);
    const have = def[1].split(',').map((x) => x.trim().split(/\s+/)[0]).filter(Boolean);
    assert.deepEqual(wanted.sort(), have.sort(), m[1]);
  }
  const act = read('src/pages/admin/Activities.jsx');
  assert.match(act, /\{readOnly \? '—' : \(<>[\s\S]*?setAttendanceTarget\(a\)/);
  assert.match(act, /if \(!readOnly\) loadAttendance\(\)/);
});

test('الحضور: الماسح داخل الموقع — BarcodeDetector محلي، لا رفع صور ولا تخزين، إيقاف الكاميرا، وقائمة يدوية احتياطية', () => {
  const sc = read('src/pages/admin/AttendanceScanner.jsx');
  assert.match(sc, /new window\.BarcodeDetector\(\{ formats: \['qr_code'\] \}\)/);
  assert.match(sc, /getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/);
  assert.match(sc, /clearInterval\(timerRef\.current\)/);
  assert.match(sc, /visibilitychange/);
  assert.doesNotMatch(sc, /fetch\(|XMLHttpRequest|toDataURL|toBlob|drawImage|supabase/);
  const modal = read('src/pages/admin/ActivityAttendanceModal.jsx');
  assert.match(modal, /scannerSupported\(\)/);
  assert.match(modal, /recordAttendanceManual/);
  assert.match(modal, /tr\('مسجّل مسبقًا'\)|مسجّل مسبقًا/);
  assert.match(modal, /window\.confirm\(tr\('ستتغيّر رموز/);
});

test('الحضور: بطاقة العضو — نص مبهم، لا رابط، تظهر في /member/id، وتفاتيح i18n موجودة بالثلاث لغات', () => {
  assert.match(read('src/pages/member/MemberIdCard.jsx'), /<MemberAttendanceCards member=\{member\} \/>/);
  const comp = read('src/components/member/MemberAttendanceCards.jsx');
  assert.match(comp, /attendanceCodeText\(c\.token\)/);
  assert.doesNotMatch(comp, /verifyUrl|window\.location/);
  for (const l of ['ar', 'fr', 'en']) for (const k of ['title', 'hint', 'error', 'attended', 'qrLabel']) {
    const v = get(locales[l], `member.id.attendance.${k}`);
    assert.ok(typeof v === 'string' && v.trim(), `${l}:${k}`);
  }
});
