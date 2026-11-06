import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stripSql = (sql) => sql.replace(/--.*$/gm, '');
const sql = stripSql(read('supabase/migrations/0038_member_activation_throttle.sql'));
const down = stripSql(read('supabase/rollback/0038_member_activation_throttle_down.sql'));
const edge = read('supabase/functions/member-activate/index.ts');

test('0038: جدول الأحداث مغلق على أدوار العميل (RLS + سحب كل الصلاحيات، بلا سياسات ولا منح)', () => {
  assert.match(sql, /alter table public\.member_activation_throttle enable row level security/);
  assert.match(sql, /revoke all on table public\.member_activation_throttle from public, anon, authenticated/);
  assert.doesNotMatch(sql, /create policy/i);
  assert.doesNotMatch(sql, /grant [^;]*on (table )?public\.member_activation_throttle(?![_a-z])/i);
});

test('0038: الدالة SECURITY DEFINER بمسار بحث ثابت، ومتاحة لـ service_role فقط', () => {
  assert.match(sql, /function public\.member_activation_throttle_hit\(p_key text\)[\s\S]*?security definer[\s\S]*?set search_path = public, pg_temp/);
  assert.match(sql, /revoke all on function public\.member_activation_throttle_hit\(text\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.member_activation_throttle_hit\(text\) to service_role/);
  assert.doesNotMatch(sql, /grant execute on function public\.member_activation_throttle_hit[^;]*(anon|authenticated)/);
});

test('0038: لا يُخزَّن العنوان خامًا (sha256 بالملح السرّي)، والحدّ 8 / 10 دقائق، وقفل استشاري للتزامن', () => {
  assert.match(sql, /membership_throttle_secret/);
  assert.match(sql, /sha256\(convert_to\(/);
  const ins = sql.match(/insert into public\.member_activation_throttle[^;]*;/)[0];
  assert.match(ins, /\(client_hash\) values \(v_hash\)/);
  assert.doesNotMatch(ins, /p_key/);
  assert.match(sql, /v_cnt >= 8/);
  assert.match(sql, /interval '10 minutes'/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(v_hash, 0\)\)/);
  assert.match(sql, /delete from public\.member_activation_throttle where created_at < now\(\) - interval '1 day'/);
});

test('0038: يشترط 0026 و0036 ولا يعدّل جداول أو دوال قائمة', () => {
  assert.match(sql, /to_regclass\('public\.membership_throttle_secret'\)/);
  assert.match(sql, /to_regprocedure\('public\.prepare_member_activation\(text\)'\)/);
  assert.doesNotMatch(sql, /alter table public\.(?!member_activation_throttle)/);
  assert.doesNotMatch(sql, /create or replace function public\.(?!member_activation_throttle_hit)/);
});

test('0038: ملف الرجوع يحذف الدالة والجدول الجديدين فقط', () => {
  assert.match(down, /drop function if exists public\.member_activation_throttle_hit\(text\)/);
  assert.match(down, /drop table if exists public\.member_activation_throttle/);
  assert.doesNotMatch(down, /drop table if exists public\.(?!member_activation_throttle)/);
});

test('member-activate: الحدّ الأساسي من القاعدة، والمحلي احتياطي فقط ولا يُفشل التفعيل عند عطل القاعدة', () => {
  assert.match(edge, /rpc\('member_activation_throttle_hit', \{ p_key: key \}\)/);
  assert.match(edge, /limited === true \|\| \(limited === null && rateLimited\(ip\)\)/);
  assert.match(edge, /if \(error\) \{[\s\S]{0,160}return null;/); // خطأ القاعدة → احتياطي لا رفض
  assert.match(edge, /ip === 'unknown' \? null/);                  // عنوان مجهول لا يشارك دلوًا في القاعدة
  // الاستدعاء قبل أي عمل على الرمز أو كلمة المرور
  assert.ok(edge.indexOf('dbRateLimited(adminClient, ip)') < edge.indexOf("rpc('prepare_member_activation'"));
  assert.equal((edge.match(/createClient\(/g) || []).length, 1);   // عميل واحد فقط
});
