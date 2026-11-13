import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as R from '../src/constants/roles.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stripSql = (sql) => sql.replace(/--.*$/gm, '');
const listDir = (p) => fs.readdirSync(new URL(`../${p}`, import.meta.url));

const raw = read('supabase/migrations/0049_games_access.sql');
const sql = stripSql(raw);
const down = stripSql(read('supabase/rollback/0049_games_access_down.sql'));
const smoke = read('supabase/tests/games_access_smoke.sql');

/** جسم الدالة بين $$ و$$ (أول $$ بعد توقيعها). */
const fnBody = (src, name) => {
  const m = src.match(new RegExp(`function public\\.${name}\\(\\)[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`));
  assert.ok(m, `الدالة ${name} غير معرّفة`);
  return m[1];
};
const can = fnBody(sql, 'can_access_games');
const info = fnBody(sql, 'get_games_access');

test('0049: الترقيم — ملف واحد فقط ببادئة 0049، وملف الرجوع موجود', () => {
  assert.deepEqual(listDir('supabase/migrations').filter((f) => f.startsWith('0049_')), ['0049_games_access.sql']);
  assert.ok(listDir('supabase/rollback').includes('0049_games_access_down.sql'));
  assert.ok(listDir('supabase/tests').includes('games_access_smoke.sql'));
});

test('0049: إضافة فقط — دالتان لا غير، بلا جداول ولا سياسات ولا تعديل بيانات أو مخطط', () => {
  const fns = [...sql.matchAll(/create or replace function public\.([a-z_]+)\(/g)].map((m) => m[1]);
  assert.deepEqual(fns.sort(), ['can_access_games', 'get_games_access']);
  assert.doesNotMatch(sql, /\bcreate\s+table\b/i);
  assert.doesNotMatch(sql, /\balter\s+(table|type|function)\b/i);
  assert.doesNotMatch(sql, /\b(create|drop|alter)\s+policy\b/i);
  assert.doesNotMatch(sql, /\bdrop\s+(table|function|trigger|policy|type)\b/i);
  assert.doesNotMatch(sql, /\b(insert\s+into|delete\s+from|truncate)\b/i);
  assert.doesNotMatch(sql, /\bupdate\s+public\./i);
  assert.doesNotMatch(sql, /create or replace function public\.(is_admin|mfa_satisfied|current_admin_role|current_member_id|can_manage_\w+|can_handle_membership|is_super_admin)\b/);
});

test('0049: الشروط المسبقة (0014 و0024 و0046) تُفحص قبل أي تعريف', () => {
  const pre = sql.slice(0, sql.indexOf('create or replace function'));
  assert.match(pre, /to_regprocedure\('public\.is_admin\(\)'\)/);
  assert.match(pre, /to_regprocedure\('public\.mfa_satisfied\(\)'\)/);
  assert.match(pre, /prosrc like '%admin_linked%'/);
  assert.match(pre, /to_regclass\('public\.member_memberships'\)/);
  assert.match(pre, /to_regclass\('public\.site_settings'\)/);
  assert.match(raw, /0024_mfa_enforcement\.sql/);
  assert.match(raw, /0046_dual_accounts_and_board_card\.sql/);
  assert.match(raw, /0014_membership_flow\.sql/);
});

test('0049: الدالتان SECURITY DEFINER STABLE بمسار بحث ثابت', () => {
  assert.equal((sql.match(/security definer\s+stable\s+set search_path = public, pg_temp/g) || []).length, 2);
  assert.match(sql, /function public\.can_access_games\(\)\s+returns boolean/);
  assert.match(sql, /function public\.get_games_access\(\)\s+returns jsonb/);
});

test('0049: المنح — revoke all ثم EXECUTE لـ authenticated فقط، ولا شيء لـ anon/public', () => {
  for (const f of ['can_access_games', 'get_games_access']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\(\\) from public, anon, authenticated;`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${f}\\(\\) to authenticated;`));
  }
  assert.doesNotMatch(sql, /grant [^;]*\bto\b[^;]*\b(anon|public)\b/i);
  assert.ok(sql.indexOf('revoke all on function public.can_access_games') < sql.indexOf('grant execute on function public.can_access_games'));
});

test('0049: can_access_games — الترتيب: هوية ← MFA ← إداري ← عضو، والرفض هو الأصل', () => {
  const order = ['auth.uid() is null', 'public.mfa_satisfied()', 'public.is_admin()', 'public.current_member_id()', "key = 'current_season'", 'member_memberships'];
  let last = -1;
  for (const token of order) {
    const i = can.indexOf(token);
    assert.ok(i > last, `"${token}" غير موجود أو في ترتيب خاطئ`);
    last = i;
  }
  assert.match(can, /if auth\.uid\(\) is null then return false; end if;/);
  assert.match(can, /if not public\.mfa_satisfied\(\) then return false; end if;/);
  // الإداري: القرار نهائي هنا (لا سقوط لمسار العضو)، ويُرفض فقط من عليه تغيير كلمة مرور مؤقتة (profiles.must_change_password، 0027)
  assert.match(can, /if public\.is_admin\(\) then\s+return not exists \(\s+select 1 from public\.profiles p\s+where p\.id = auth\.uid\(\) and p\.must_change_password is true\s+\);\s+end if;/);
  assert.match(can, /if v_id is null then return false; end if;/);
  assert.match(can, /nullif\(btrim\(value\), ''\) into v_season/);
  assert.match(can, /if v_season is null then return false; end if;/);
});

test('0049: شرط العضو = status active + غير محذوف + صف member_memberships للموسم الحالي (وجود الصف يكفي)', () => {
  assert.match(can, /m\.status = 'active'/);
  assert.match(can, /m\.deleted_at is null/);
  assert.match(can, /mm\.season = v_season/);
  assert.match(can, /join public\.member_memberships mm on mm\.member_id = m\.id/);
  // قرار 2: لا فحص إضافي لمعاملة الميزانية ولا لتاريخ الدفع
  assert.doesNotMatch(sql, /budget_transactions|transaction_id|voided|paid_at/);
});

test('0049: لا أدوار مكتوبة — الإداري = is_admin() فقط (يشمل كل الأدوار الحالية والمستقبلية)', () => {
  for (const role of R.ALL_ROLES) assert.doesNotMatch(sql, new RegExp(`'${role}'`), `الدور ${role} مكتوب حرفيًا`);
  assert.doesNotMatch(sql, /current_admin_role|admin_role/);
  // profiles مستعمل لشيء واحد فقط: علم كلمة المرور المؤقتة؛ لا قراءة دور ولا قائمة أدوار منه
  const profileRefs = [...stripSql(sql).matchAll(/\bprofiles\b/g)].length;
  assert.ok(profileRefs >= 1);
  assert.doesNotMatch(can, /\bp\.role\b|\brole\b/);
  assert.doesNotMatch(sql, /\brole\s+in\s*\(/i);
});

test('0049: ضمان «كل الأدوار»: is_admin() في 0024 بلا أي تصفية دور، وprofiles.role إلزامي، ولا تعريف أحدث يغيّرهما', () => {
  const migs = listDir('supabase/migrations').filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  const definers = (fn) => migs.filter((f) => new RegExp(`function public\\.${fn}\\(\\)`).test(stripSql(read(`supabase/migrations/${f}`))));
  assert.equal(definers('is_admin').at(-1), '0024_mfa_enforcement.sql', 'is_admin أُعيد تعريفه بعد 0024: راجع 0049');
  assert.equal(definers('mfa_satisfied').at(-1), '0024_mfa_enforcement.sql', 'mfa_satisfied أُعيد تعريفه بعد 0024: راجع 0049');
  assert.equal(definers('current_member_id').at(-1), '0046_dual_accounts_and_board_card.sql', 'current_member_id أُعيد تعريفه بعد 0046: راجع 0049');

  const isAdmin = fnBody(stripSql(read('supabase/migrations/0024_mfa_enforcement.sql')), 'is_admin');
  assert.match(isAdmin, /from public\.profiles\s+where id = auth\.uid\(\) and is_active = true\s+and public\.mfa_satisfied\(\)/);
  assert.doesNotMatch(isAdmin, /\brole\b/);

  assert.match(stripSql(read('supabase/migrations/0002_tables.sql')), /role admin_role not null default 'editor'/);
});

test('0049: MFA — mfa_satisfied تُفحص على كل المسارات وقبل مسار العضو، ولا تتجاوزها أي دالة', () => {
  assert.ok(can.indexOf('mfa_satisfied') < can.indexOf('current_member_id'));
  assert.doesNotMatch(sql, /aal2|aal1|auth\.jwt\(\)|set_config|request\.jwt/);
  assert.doesNotMatch(sql, /mfa_factors/);
});

test('0049: get_games_access — allowed يأتي من can_access_games، وأسباب الرفض محدّدة ومغلقة', () => {
  assert.match(info, /if public\.can_access_games\(\) then/);
  // مساران للسماح فقط (admin وmember) وكلاهما داخل فرع can_access_games؛ كل ما بعد فحص MFA رفض فقط
  assert.equal((info.match(/'allowed', true/g) || []).length, 2);
  assert.ok(info.indexOf("'allowed', true") > info.indexOf('if public.can_access_games() then'));
  assert.ok(info.lastIndexOf("'allowed', true") < info.indexOf('if not public.mfa_satisfied()'));
  assert.doesNotMatch(info.slice(info.indexOf('if not public.mfa_satisfied()')), /'allowed', true/);
  // لا يُسرّب بيانات أخرى: المفاتيح المسموحة allowed/reason/season فقط
  // المفاتيح = العناصر في المواضع الزوجية من وسائط jsonb_build_object (الفردية قيم)
  const keys = [...info.matchAll(/jsonb_build_object\(([^;]*?)\);/g)]
    .flatMap((m) => m[1].split(',').map((a) => a.trim()).filter((_, i) => i % 2 === 0));
  assert.ok(keys.length >= 10, 'لم تُستخرج مفاتيح الاستجابة');
  for (const k of keys) assert.ok(['\'allowed\'', '\'reason\'', '\'season\''].includes(k), `مفتاح غير متوقع في الاستجابة: ${k}`);
});

test('0049: الرجوع — يحذف الدالتين فقط، بلا CASCADE، بترتيب عكسي، وبلا مساس بشيء آخر', () => {
  const drops = [...down.matchAll(/drop\s+(\w+)\s+if exists\s+([\w.]+\(\))/gi)].map((m) => `${m[1].toLowerCase()} ${m[2]}`);
  assert.deepEqual(drops, ['function public.get_games_access()', 'function public.can_access_games()']);
  assert.doesNotMatch(down, /cascade/i);
  assert.doesNotMatch(down, /\b(drop\s+table|drop\s+policy|alter|delete|truncate|update|insert)\b/i);
  assert.match(down, /^\s*begin;/m);
  assert.match(down, /notify pgrst, 'reload schema';\s*commit;/);
});

test('0049: المعاملة — begin/commit ويُعاد تحميل مخطط PostgREST', () => {
  assert.match(sql, /^\s*begin;/m);
  assert.match(sql, /notify pgrst, 'reload schema';\s*commit;\s*$/);
});

test('0049: الفحص السلوكي — أدوار الإدارة من enum_range (لا قائمة مكتوبة)، ويغطي الرفض وMFA وanon، ويُلغى بـ rollback', () => {
  const s = stripSql(smoke);
  assert.match(s, /enum_range\(null::admin_role\)/);
  // 'editor' وحده يرد حرفيًا: هو الدور الافتراضي في profiles (0002) لمستخدمي التجهيز المزدوجين/المعطّل، لا قائمة سماح
  for (const role of R.ALL_ROLES.filter((x) => x !== 'editor')) assert.doesNotMatch(s, new RegExp(`'${role}'`), `الدور ${role} مكتوب في الفحص السلوكي`);
  assert.doesNotMatch(s, /\brole\s+in\s*\(/i);
  for (const reason of ['member', 'admin', 'membership_not_paid', 'member_inactive', 'no_member_account', 'no_season', 'mfa_required']) {
    assert.match(s, new RegExp(`'reason', '${reason}'`), `لا حالة تغطي ${reason}`);
  }
  assert.match(s, /'aal', 'aal2'/);
  assert.match(s, /set local role anon/);
  assert.match(s, /insufficient_privilege/);
  assert.match(s, /has_function_privilege\('public'/);
  assert.match(s.trim(), /rollback;$/);
  assert.doesNotMatch(s, /\bcommit\b/i);
});
