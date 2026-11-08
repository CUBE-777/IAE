import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stripSql = (sql) => sql.replace(/--.*$/gm, '');
const raw = read('supabase/migrations/0040_member_card_tokens.sql');
const sql = stripSql(raw);
const down = stripSql(read('supabase/rollback/0040_member_card_tokens_down.sql'));

const fnBody = (name) => {
  const start = sql.indexOf(`function public.${name}`);
  assert.ok(start > -1, `الدالة ${name} غير معرّفة`);
  const next = sql.indexOf('create or replace function', start + 10);
  const end = next > -1 ? next : sql.indexOf('-- 5)', start) > -1 ? sql.indexOf('revoke all on function', start) : sql.length;
  return sql.slice(start, end);
};
const issue = fnBody('issue_member_card_token');
const verify = fnBody('verify_member_card');
const status = fnBody('get_my_membership_status');

test('0040: جدول member_card_tokens مغلق (RLS مفعّل، كل الصلاحيات مسحوبة، بلا سياسات ولا منح)', () => {
  assert.match(sql, /create table if not exists public\.member_card_tokens \(\s*token_hash text primary key,/);
  assert.match(sql, /member_id\s+uuid not null references public\.members\(id\) on delete cascade/);
  assert.match(sql, /created_at timestamptz not null default now\(\)/);
  assert.match(sql, /expires_at timestamptz not null/);
  assert.match(sql, /create index if not exists idx_member_card_tokens_member\s+on public\.member_card_tokens \(member_id, created_at\)/);
  assert.match(sql, /alter table public\.member_card_tokens enable row level security/);
  assert.match(sql, /revoke all on table public\.member_card_tokens from public, anon, authenticated/);
  assert.doesNotMatch(sql, /create policy[^;]*member_card_tokens/i);
  assert.doesNotMatch(sql, /grant (select|insert|update|delete|all)[^;]*on (table )?public\.member_card_tokens/i);
});

test('0040: الدوال الثلاث SECURITY DEFINER بمسار بحث ثابت', () => {
  for (const [name, body] of [['issue_member_card_token', issue], ['verify_member_card', verify], ['get_my_membership_status', status]]) {
    assert.match(body, /security definer\s+(stable\s+)?set search_path = public, pg_temp/, name);
  }
  assert.equal((sql.match(/create or replace function/g) || []).length, 3);
});

test('0040: المنح: verify لـ anon وauthenticated، وissue وstatus لـ authenticated فقط، بعد revoke all', () => {
  assert.match(sql, /revoke all on function public\.issue_member_card_token\(\)\s+from public, anon, authenticated/);
  assert.match(sql, /revoke all on function public\.verify_member_card\(text\)\s+from public, anon, authenticated/);
  assert.match(sql, /revoke all on function public\.get_my_membership_status\(\)\s+from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.verify_member_card\(text\)\s+to anon, authenticated/);
  assert.match(sql, /grant execute on function public\.issue_member_card_token\(\)\s+to authenticated;/);
  assert.match(sql, /grant execute on function public\.get_my_membership_status\(\)\s+to authenticated;/);
  assert.doesNotMatch(sql, /grant execute on function public\.(issue_member_card_token|get_my_membership_status)[^;]*anon/);
});

test('0040: الإصدار يشترط عضوًا نشطًا غير محذوف، ويخزّن sha256 فقط (hex) ولا يخزّن الرمز الخام', () => {
  assert.match(issue, /auth\.uid\(\) is null/);
  assert.match(issue, /v_id := public\.current_member_id\(\)/);
  assert.match(issue, /v_id is null/);
  assert.match(issue, /m\.status = 'active' and m\.deleted_at is null/);
  const insert = issue.slice(issue.indexOf('insert into public.member_card_tokens'));
  assert.match(insert, /values \(encode\(sha256\(convert_to\(v_token, 'utf8'\)\), 'hex'\), v_id, v_expires\)/);
  assert.doesNotMatch(insert.slice(0, insert.indexOf(';')), /values \(v_token/);
  assert.match(issue, /return jsonb_build_object\('token', v_token, 'expires_at', v_expires\)/);
});

test('0040: الرمز 128 بت عشوائية بصيغة base64url بلا «=» (بلا gen_random_bytes لأن pgcrypto خارج مسار البحث)', () => {
  assert.match(issue, /gen_random_uuid\(\)::text \|\| gen_random_uuid\(\)::text \|\| gen_random_uuid\(\)::text/);
  assert.match(issue, /from 1 for 16/);
  assert.match(issue, /translate\([\s\S]*'base64'\)[\s\S]*'\+\/', '-_'\)/);
  assert.match(issue, /rtrim\(/);
  assert.doesNotMatch(sql, /gen_random_bytes\(/);
  assert.match(raw, /--[^\n]*gen_random_bytes/); // سبب الاستغناء موثّق في الرأس
});

test('0040: مدة الصلاحية 120 ثانية، وحدّ الإصدار 30/ساعة، وأقصى 3 رموز فعّالة، وقفل استشاري لكل عضو', () => {
  assert.match(issue, /v_expires timestamptz := now\(\) \+ interval '120 seconds'/);
  assert.match(issue, /pg_advisory_xact_lock\(hashtextextended\('member-card-issue:' \|\| v_id::text, 0\)\)/);
  assert.match(issue, /':member-card-issue:'/);
  assert.match(issue, /created_at > now\(\) - interval '1 hour'/);
  assert.match(issue, /v_cnt >= 30[\s\S]*?raise exception 'rate_limited'/);
  assert.match(issue, /limit 3\)/);
  assert.match(issue, /delete from public\.member_card_tokens\s+where member_id = v_id\s+and token_hash not in/);
  assert.match(issue, /random\(\) < 0\.05[\s\S]*?delete from public\.member_card_tokens where expires_at < now\(\)/);
  // الحدّ يُعدّ في جدول 0038 لا في جدول الرموز (الأخير يُحذف منه الأقدم فيصغّر العدّ)
  assert.doesNotMatch(issue.slice(0, issue.indexOf('v_cnt >= 30')), /from public\.member_card_tokens\s+where/);
});

test('0040: verify تُرجع دائمًا {"valid": false} للمجهول/المنتهي/غير النشط/الشكل الخاطئ بالشكل نفسه', () => {
  const falses = verify.match(/return jsonb_build_object\('valid', false\)/g) || [];
  assert.equal(falses.length, 2); // شكل غير صالح + لا صف
  assert.match(verify, /p_token is null or p_token !~ '\^\[A-Za-z0-9_-\]\{22\}\$'/);
  assert.match(verify, /t\.expires_at > now\(\)/);
  assert.match(verify, /m\.status = 'active'/);
  assert.match(verify, /m\.deleted_at is null/);
  assert.match(verify, /t\.token_hash = encode\(sha256\(convert_to\(p_token, 'utf8'\)\), 'hex'\)/);
  // لا رسائل خطأ تفرّق بين المنتهي والمجهول: الاستثناء الوحيد rate_limited
  assert.deepEqual([...verify.matchAll(/raise exception '([^']+)'/g)].map((m) => m[1]), ['rate_limited']);
});

test('0040: ناتج verify الناجح لا يحوي phone/email/city/id ولا غير الحقول المسموحة', () => {
  const okReturn = verify.slice(verify.lastIndexOf("return jsonb_build_object(\n    'valid', true"));
  const keys = [...okReturn.slice(0, okReturn.indexOf("jsonb_build_object('season'")).matchAll(/'([a-z_]+)',\s/g)].map((m) => m[1]);
  assert.deepEqual(keys, ['valid', 'full_name', 'photo_url', 'university', 'promotion', 'track', 'membership']);
  assert.match(okReturn, /jsonb_build_object\('season', v_season, 'active', v_active\)/);
  assert.doesNotMatch(okReturn, /\b(phone|email|city|profession|status)\b|v_m\.id\b|member_id/);
  assert.match(verify, /nullif\(btrim\(value\), ''\) into v_season from public\.site_settings where key = 'current_season'/);
  assert.match(verify, /mm\.member_id = v_m\.id and mm\.season = v_season/);
  assert.match(verify, /if v_season is not null then/); // الموسم الفارغ: active يبقى null
});

test('0040: حدّ التحقق 30 محاولة/10 دقائق لكل عميل ببصمة sha256 بالملح وبادئة :member-verify: وبلا تسجيل للرمز الخام', () => {
  assert.match(verify, /cf-connecting-ip/);
  assert.match(verify, /x-forwarded-for/);
  assert.match(verify, /sha256\(convert_to\(coalesce\(v_salt, ''\) \|\| ':member-verify:' \|\| v_ip, 'utf8'\)\)/);
  assert.match(verify, /public\.membership_throttle_secret where id = 1/);
  assert.match(verify, /public\.member_activation_throttle/);
  assert.match(verify, /interval '10 minutes'/);
  assert.match(verify, /v_cnt >= 30[\s\S]*?raise exception 'rate_limited'/);
  assert.match(verify, /pg_advisory_xact_lock/);
  // العدّ قبل فحص الرمز (لا يتأثر بصحته)
  assert.ok(verify.indexOf('v_cnt >= 30') < verify.indexOf('p_token !~'));
  // لا تسجيل: لا raise notice/log، ولا يُكتب الرمز الخام في أي جدول
  assert.doesNotMatch(sql, /raise (notice|log|warning|info)/i);
  assert.doesNotMatch(verify, /insert into public\.member_activation_throttle \(client_hash\) values \(p_token/);
  assert.doesNotMatch(verify, /insert into public\.(?!member_activation_throttle)/);
});

test('0040: get_my_membership_status للعضو فقط وتعيد season/active/paid_at/has_previous', () => {
  assert.match(status, /v_id\s+uuid := public\.current_member_id\(\)/);
  assert.match(status, /auth\.uid\(\) is null or v_id is null then return null/);
  assert.match(status, /jsonb_build_object\('season', v_season, 'active', v_active, 'paid_at', v_paid_at, 'has_previous', v_prev\)/);
  assert.match(status, /mm\.season <> v_season/);
});

test('0040: يشترط 0014 و0026 و0035 و0036 و0038 و0039 ولا يغيّر جدولًا أو دالة قائمة', () => {
  for (const r of [
    /to_regprocedure\('public\.current_member_id\(\)'\)/,
    /to_regprocedure\('public\.get_my_member\(\)'\)/,
    /to_regclass\('public\.membership_throttle_secret'\)/,
    /to_regclass\('public\.member_memberships'\)/,
    /to_regclass\('public\.member_activation_throttle'\)/,
    /to_regclass\('public\.member_access_requests'\)/,
  ]) assert.match(sql, r);
  assert.match(sql, /^\s*begin;/m);
  assert.match(sql, /commit;\s*$/);
  assert.match(sql, /notify pgrst, 'reload schema'/);
  assert.doesNotMatch(sql, /alter table public\.(?!member_card_tokens)/);
  assert.doesNotMatch(sql, /create or replace function public\.(get_my_member|current_member_id|member_activation_throttle_hit|request_member_access_help)\(/);
  assert.doesNotMatch(sql, /(create|drop) policy/i);
  assert.doesNotMatch(sql, /drop (table|function)/i);
  assert.match(raw, /لماذا/);
  assert.match(raw, /الأمان/);
  assert.match(raw, /تجربة جافة/);
  assert.match(raw, /الرجوع/);
});

test('0040: ملف الرجوع يحذف الجديد فقط ولا يمسّ جدول 0038 ولا غيره', () => {
  assert.match(down, /drop function if exists public\.get_my_membership_status\(\)/);
  assert.match(down, /drop function if exists public\.verify_member_card\(text\)/);
  assert.match(down, /drop function if exists public\.issue_member_card_token\(\)/);
  assert.match(down, /drop table if exists public\.member_card_tokens/);
  assert.match(down, /begin;[\s\S]*commit;/);
  assert.match(down, /notify pgrst, 'reload schema'/);
  const drops = [...down.matchAll(/drop (?:function|table) if exists public\.([a-z_]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(drops, ['get_my_membership_status', 'issue_member_card_token', 'member_card_tokens', 'verify_member_card']);
});
