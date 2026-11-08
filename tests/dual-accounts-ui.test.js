import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ADMIN_DICT } from '../src/i18n/adminDict.data.js';

/**
 * المرحلة 2 من 0046: واجهة الحساب المزدوج وبطاقة المكتب. فحوص نصّية على المصدر (لا متصفح هنا).
 */
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stripSql = (sql) => sql.replace(/--.*$/gm, '');
const sql = stripSql(read('supabase/migrations/0046_dual_accounts_and_board_card.sql'));
const locales = Object.fromEntries(['ar', 'fr', 'en'].map((l) => [l, JSON.parse(read(`src/i18n/locales/${l}.json`))]));
const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);

const boardSvc = read('src/services/supabase/boardCard.service.js');
const linksSvc = read('src/services/supabase/adminAccountLinks.service.js');
const page = read('src/pages/member/MemberBoardCard.jsx');
const layout = read('src/layouts/MemberLayout.jsx');
const memberPage = read('src/components/member/MemberPage.jsx');
const adminLayout = read('src/layouts/AdminLayout.jsx');
const adminUsers = read('src/pages/admin/AdminUsers.jsx');
const linkModal = read('src/pages/admin/AdminMemberLinkModal.jsx');
const formModal = read('src/pages/admin/AdminUserFormModal.jsx');
const router = read('src/app/router/index.jsx');

test('الخدمتان: كل RPC وبارامتراتها معرّفة في 0046 بالأسماء نفسها', () => {
  for (const svc of [boardSvc, linksSvc]) {
    const calls = [...svc.matchAll(/rpc\('([a-z_]+)'(?:, \{([^}]*)\})?/g)];
    assert.ok(calls.length >= 3);
    for (const [, name, args] of calls) {
      const m = sql.match(new RegExp(`function public\\.${name}\\(([^)]*)\\)`));
      assert.ok(m, `الدالة ${name} غير معرّفة في 0046`);
      const declared = [...m[1].matchAll(/\b(p_[a-z_]+)\b/g)].map((x) => x[1]);
      const used = args ? [...args.matchAll(/\b(p_[a-z_]+)\b/g)].map((x) => x[1]) : [];
      for (const u of used) assert.ok(declared.includes(u), `${name}: المعامل ${u} غير موجود`);
    }
  }
});

test('الخدمتان: لا كتابة مباشرة في board_members/members/member_accounts من المتصفح', () => {
  for (const f of [boardSvc, linksSvc, page, linkModal]) {
    assert.doesNotMatch(f, /\.from\('(board_members|members|member_accounts|board_profile_links)'\)\s*\.(update|insert|delete|upsert)/);
  }
});

test('الراوتر: /member/board-card خلف MemberLayout ويُحمَّل عند الطلب', () => {
  assert.match(router, /const MemberBoardCard = lazy\(\(\) => import\('\.\.\/\.\.\/pages\/member\/MemberBoardCard'\)\)/);
  assert.match(router, /path: 'board-card', element: <MemberBoardCard \/>/);
  assert.ok(router.indexOf("path: 'board-card'") > router.indexOf("path: '/member',"));
});

test('MemberLayout: كلمة مرور مؤقتة تُعرض لها شاشة التغيير أولًا ويُعاد التحميل بعدها، ولا تُسجَّل خروج أحد', () => {
  assert.match(layout, /import ForcePasswordChange/);
  assert.match(layout, /profile\?\.must_change_password === true/);
  assert.match(layout, /status === 'authenticated' && mustChangePassword\) return <ForcePasswordChange \/>/);
  assert.match(layout, /\[status, userId, load, mustChangePassword\]/);        // يُعاد التحميل بعد إسقاط العلم
  assert.match(layout, /notMember/);
  assert.doesNotMatch(layout, /logout\(\)\.catch|useEffect\([^)]*logout/);
  // بطاقة المكتب ميزة إضافية: فشلها لا يمنع الفضاء
  assert.match(layout, /getMyBoardCard\(\)\.catch\(\(\) => null\)/);
  assert.match(layout, /hasBoardCard: state\.hasBoardCard/);
});

test('MemberPage: رابط بطاقة المكتب لمن له بطاقة فقط، ورابط لوحة الإدارة لمن له صفة إدارية نشطة', () => {
  assert.match(memberPage, /ctx\?\.hasBoardCard === true/);
  assert.match(memberPage, /profile\?\.is_active === true/);
  assert.equal((memberPage.match(/hasBoardCard && <NavLink to="\/member\/board-card"/g) || []).length, 2); // الجانبي + «المزيد»
  assert.equal((memberPage.match(/isAdmin && <Link[^>]*to="\/admin\/dashboard"/g) || []).length, 2);
});

test('AdminLayout: رابط فضاء المنخرطين يظهر للحساب المزدوج فقط عبر الخطّاف', () => {
  assert.match(adminLayout, /useHasMemberSpace\(profile\?\.id\)/);
  assert.match(adminLayout, /hasMemberSpace && \(\s*<NavLink to="\/member"/);
  const hook = read('src/hooks/useHasMemberSpace.js');
  assert.match(hook, /getMyMember\(\)/);
  assert.match(hook, /\.catch\(\(\) => \{\}\)/);   // فشل صامت: لا خطأ يظهر للمسؤول
});

test('AdminUsers: عمود الربط وأزراره تظهر فقط حين تتوفر 0046، والفصل بتأكيد', () => {
  assert.match(adminUsers, /fetchAdminMemberLinkOverview\(\)/);
  assert.match(adminUsers, /\.catch\(\(err\) => \{[\s\S]*setLinks\(null\)/);
  assert.match(adminUsers, /\{links && <th>/);
  assert.match(adminUsers, /links && p\.is_active && links\[p\.id\]/);
  assert.match(adminUsers, /unlinkTarget && \(\s*<Modal/);
  assert.match(adminUsers, /<AdminMemberLinkModal/);
});

test('AdminMemberLinkModal: يقترح البطاقة ولا يعرض إلا البطاقات النشطة الحرة (أو بطاقة الحساب نفسه)', () => {
  assert.match(linkModal, /row\.suggest_board\?\.id/);
  assert.match(linkModal, /b\.is_active && \(!b\.member_id \|\| b\.id === row\.board\?\.id\)/);
  assert.match(linkModal, /linkAdminAsMember\(row\.user_id, boardId \|\| null, null\)/);
});

test('إنشاء مسؤول: منح صفة إدارية لمنخرط قائم يتطلب تأكيدًا صريحًا قبل إعادة الإرسال', () => {
  assert.match(formModal, /err\.code === 'member_account_exists'/);
  assert.match(formModal, /setConfirmMember\(\{ name:/);
  assert.match(formModal, /handleSubmit\(null, true\)/);
  assert.match(formModal, /link_existing_member: linkExisting/);
  const svc = read('src/services/supabase/adminUsers.service.js');
  assert.match(svc, /\.\.\.\(link_existing_member \? \{ link_existing_member: true \} : \{\}\)/);
  assert.match(svc, /e\.code = code/);
});

test('MemberBoardCard: لا يرسل الاسم/الصفة، ولا يكتب إلا عبر الدوال، والصورة من مجلد العضو', () => {
  assert.match(page, /submitMyBoardCard\(\{/);
  const payload = page.slice(page.indexOf('submitMyBoardCard({'), page.indexOf('});', page.indexOf('submitMyBoardCard({')));
  assert.doesNotMatch(payload, /full_name|position|sort_order/);
  assert.match(page, /BOARD_TR_FIELDS\.filter\(\(f\) => f\.key !== 'position'\)/);
  assert.match(page, /uploadBoardCardPhoto\(member\.id, prepared\)/);
  assert.match(boardSvc, /export const uploadBoardCardPhoto = uploadMemberCardPhoto/);
  assert.match(page, /cancelMyBoardCardRequest\(\)/);
  // الحالة: قيد المراجعة تُقرأ من status = submitted، والإعادة بملاحظة من sent + review_note
  assert.match(page, /req\?\.status === 'submitted'/);
  assert.match(page, /req\?\.status === 'sent' && !!req\.review_note/);
});

test('الترجمة: كل مفتاح member.boardCard.* و member.nav.* و admin.layout.memberSpace موجود في ar/fr/en بنفس البنية', () => {
  const keys = new Set([...page.matchAll(/['"`]((?:member\.boardCard|boardProfile)\.[A-Za-z_.]+)['"`]/g)].map((m) => m[1]));
  for (const k of ['member.nav.boardCard', 'member.nav.admin', 'admin.layout.memberSpace', 'member.home.loadErrorTitle', 'member.home.loadErrorText', 'member.home.retry']) keys.add(k);
  keys.add('boardProfile.tr.fr'); keys.add('boardProfile.tr.en');
  const missing = [];
  for (const l of ['ar', 'fr', 'en']) for (const k of keys) {
    if (k.endsWith('.')) continue;
    if (typeof get(locales[l], k) !== 'string') missing.push(`${l}:${k}`);
  }
  assert.deepEqual(missing, []);
  const shape = (o) => Object.keys(o).sort().join(',');
  assert.equal(shape(locales.ar.member.boardCard), shape(locales.fr.member.boardCard));
  assert.equal(shape(locales.ar.member.boardCard), shape(locales.en.member.boardCard));
  for (const l of ['ar', 'fr', 'en']) {
    const greeting = locales[l].member.boardCard.greeting;
    assert.match(greeting, /\{\{name\}\}/);
    assert.match(greeting, /\{\{position\}\}/);
  }
});

test('قاموس الإدارة: كل نص جديد في صفحات الربط له ترجمة', () => {
  const srcs = [adminUsers, linkModal, formModal].join('\n');
  const missing = [];
  for (const m of srcs.matchAll(/\b(?:tr|trStrong)\(\s*'((?:[^'\\]|\\.)*)'/g)) {
    const k = m[1].replace(/\\'/g, "'");
    if (!(k in ADMIN_DICT)) missing.push(k);
  }
  assert.deepEqual(missing, []);
});
