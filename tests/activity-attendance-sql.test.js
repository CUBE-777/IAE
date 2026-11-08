import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stripSql = (s) => s.replace(/--.*$/gm, '');
const raw = read('supabase/migrations/0041_activity_attendance.sql');
const sql = stripSql(raw);
const down = stripSql(read('supabase/rollback/0041_activity_attendance_down.sql'));

const fn = (name) => {
  const i = sql.indexOf(`function public.${name}(`);
  assert.ok(i > -1, `الدالة ${name} غير معرّفة`);
  const j = sql.indexOf('create or replace function', i + 10);
  return sql.slice(i, j > -1 ? j : sql.indexOf('revoke all on function', i));
};
const FUNCS = ['attendance_token_for', 'publish_attendance_card', 'close_attendance_card', 'get_my_attendance_cards', 'record_attendance',
  'record_attendance_manual', 'undo_attendance', 'get_attendance_roster', 'get_attendance_cards_overview'];
const TABLES = ['attendance_secret', 'activity_attendance_cards', 'activity_attendance_tokens', 'activity_attendance'];

test('0041: الجداول الأربعة مغلقة (RLS مفعّل، كل الصلاحيات مسحوبة، بلا سياسات ولا منح)', () => {
  for (const t of TABLES) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${t} \\(`), t);
    assert.match(sql, new RegExp(`alter table public\\.${t}\\s+enable row level security`), t);
  }
  assert.match(sql, /revoke all on table[\s\S]*?from public, anon, authenticated/);
  assert.doesNotMatch(sql, /create policy/i);
  assert.doesNotMatch(sql, /grant (select|insert|update|delete|all)[^;]*on (table )?public\./i);
});

test('0041: كل الدوال SECURITY DEFINER بمسار بحث ثابت، والمنح للمصادقين فقط (والمساعد الداخلي بلا منح)', () => {
  for (const f of FUNCS) assert.match(fn(f), /security definer[\s\S]{0,40}set search_path = public, pg_temp/, f);
  assert.equal((sql.match(/create or replace function/g) || []).length, FUNCS.length);
  for (const f of FUNCS) assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\)\\s+from public, anon, authenticated`), f);
  for (const f of FUNCS.filter((x) => x !== 'attendance_token_for')) assert.match(sql, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\)\\s+to authenticated;`), f);
  assert.doesNotMatch(sql, /grant execute on function public\.attendance_token_for/);
  assert.doesNotMatch(sql, /grant execute[^;]*\banon\b/);
});

test('0041: النشر والإغلاق والتسجيل والتراجع تشترط can_manage_content()، والقوائم is_admin()', () => {
  for (const f of ['publish_attendance_card', 'close_attendance_card', 'record_attendance', 'record_attendance_manual', 'undo_attendance']) {
    assert.match(fn(f), /auth\.uid\(\) is null or not public\.can_manage_content\(\)/, f);
  }
  for (const f of ['get_attendance_roster', 'get_attendance_cards_overview']) assert.match(fn(f), /auth\.uid\(\) is null or not public\.is_admin\(\)/, f);
  assert.match(fn('get_my_attendance_cards'), /public\.current_member_id\(\)/);
  assert.match(fn('get_my_attendance_cards'), /m\.status = 'active' and m\.deleted_at is null/);
});

test('0041: الرمز 128 بت ثابت لـ (نشاط، عضو، epoch) ومشتق بسرّ الخادم، ويُخزَّن sha256 فقط', () => {
  const t = fn('attendance_token_for');
  assert.match(t, /sha256\(convert_to\(\(select secret from public\.attendance_secret where id = 1\)/);
  assert.match(t, /p_activity::text \|\| ':' \|\| p_member::text \|\| ':' \|\| p_epoch::text/);
  assert.match(t, /from 1 for 16/);
  assert.match(t, /translate\([\s\S]*'\+\/', '-_'\)/);
  assert.match(t, /rtrim\(/);
  assert.doesNotMatch(sql, /gen_random_bytes\(/);
  assert.match(sql, /token_hash\s+text primary key/);
  assert.match(sql, /encode\(sha256\(convert_to\(public\.attendance_token_for\(/);
  assert.doesNotMatch(sql, /insert into public\.activity_attendance_tokens[^;]*values \(public\.attendance_token_for/);
});

test('0041: صلاحية البطاقة من النشر حتى الإغلاق أو 48 ساعة، وإعادة الإصدار ترفع epoch وتحذف الرموز القديمة', () => {
  assert.equal((sql.match(/interval '48 hours'/g) || []).length >= 5, true);
  assert.match(sql, /closed_at is null and [a-z.]*published_at > now\(\) - interval '48 hours'/);
  const p = fn('publish_attendance_card');
  assert.match(p, /delete from public\.activity_attendance_tokens where activity_id = p_activity_id/);
  assert.match(p, /epoch = epoch \+ 1/);
  assert.match(p, /for update/);
  assert.match(p, /on conflict do nothing/);
});

test('0041: التسجيل — حضور واحد لكل عضو، «مسجّل مسبقًا»، استجابة واحدة للمجهول، حدّ 600/10 دقائق لكل مسؤول', () => {
  assert.match(sql, /primary key \(activity_id, member_id\)/);
  assert.match(sql, /method\s+text not null default 'scan' check \(method in \('scan', 'manual'\)\)/);
  const r = fn('record_attendance');
  assert.match(r, /p_token !~ '\^\[A-Za-z0-9_-\]\{22\}\$'/);
  assert.equal((r.match(/jsonb_build_object\('result', 'invalid'\)/g) || []).length, 2);
  assert.match(r, /on conflict do nothing/);
  assert.match(r, /case when v_new then 'recorded' else 'already' end/);
  assert.match(r, /c\.closed_at is null/);
  assert.match(r, /m\.status = 'active' and m\.deleted_at is null/);
  assert.match(r, /':attendance-scan:' \|\| auth\.uid\(\)::text/);
  assert.match(r, /interval '10 minutes'[\s\S]*?v_cnt >= 600[\s\S]*?raise exception 'rate_limited'/);
  assert.deepEqual([...r.matchAll(/raise exception '([^']+)'/g)].map((m) => m[1]).sort(), ['rate_limited', 'غير مصرّح لك بهذه العملية']);
});

test('0041: المسؤول يرى للعضو الممسوح الحقول الضرورية فقط (لا هاتف ولا بريد ولا مدينة)', () => {
  const r = fn('record_attendance');
  const member = r.slice(r.indexOf("'member', jsonb_build_object("));
  assert.deepEqual([...member.slice(0, member.indexOf('from public.members m')).matchAll(/'([a-z_]+)', m\./g)].map((m) => m[1]), ['id', 'full_name', 'photo_url', 'university', 'promotion']);
  assert.doesNotMatch(r, /\b(phone|email|city)\b/);
  assert.doesNotMatch(fn('get_attendance_roster'), /\b(phone|email|city)\b/);
});

test('0041: العمليات الحساسة تُسجَّل في audit_logs (نشر/إغلاق/تراجع) بلا تسجيل لكل مسحة ولا للرمز الخام', () => {
  for (const a of ['ADMIN_PUBLISHED_ATTENDANCE_CARD', 'ADMIN_CLOSED_ATTENDANCE_CARD', 'ADMIN_UNDID_ATTENDANCE']) assert.match(sql, new RegExp(a));
  assert.doesNotMatch(fn('record_attendance'), /audit_logs/);
  assert.doesNotMatch(sql, /raise (notice|log|warning|info)/i);
});

test('0041: يشترط 0019 و0035 و0038، ولا يغيّر جدولًا أو دالة قائمة، وبه رأس توثيق وbegin/commit', () => {
  for (const r of [/to_regprocedure\('public\.can_manage_content\(\)'\)/, /to_regprocedure\('public\.current_member_id\(\)'\)/,
    /to_regclass\('public\.member_activation_throttle'\)/, /to_regclass\('public\.membership_throttle_secret'\)/]) assert.match(sql, r);
  assert.match(sql, /^\s*begin;/m);
  assert.match(sql, /commit;\s*$/);
  assert.match(sql, /notify pgrst, 'reload schema'/);
  assert.doesNotMatch(sql, /alter table public\.(?!attendance_secret|activity_attendance)/);
  assert.doesNotMatch(sql, /drop (table|function)|create policy|drop policy/i);
  for (const w of ['لماذا', 'الأمان', 'تجربة جافة', 'الرجوع', 'الحدود']) assert.match(raw, new RegExp(w));
});

test('0041: ملف الرجوع يحذف الجديد فقط', () => {
  const drops = [...down.matchAll(/drop (?:function|table) if exists public\.([a-z_]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(drops, [...FUNCS, ...TABLES].sort());
  assert.match(down, /begin;[\s\S]*commit;/);
  assert.match(down, /notify pgrst, 'reload schema'/);
});
