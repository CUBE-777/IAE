import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const strip = (sql) => sql.replace(/--.*$/gm, '');
const sql = strip(read('supabase/migrations/0039_member_access_requests.sql'));
const down = strip(read('supabase/rollback/0039_member_access_requests_down.sql'));

test('0039: الجدول مغلق: RLS، قراءة لمديري نظام الأعضاء فقط، وطلب واحد قيد الانتظار لكل عضو', () => {
  assert.match(sql, /alter table public\.member_access_requests enable row level security/);
  assert.match(sql, /revoke all on table public\.member_access_requests from public, anon, authenticated/);
  assert.match(sql, /grant select on table public\.member_access_requests to authenticated/);
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*member_access_requests/i);
  assert.match(sql, /create policy "member_access_requests_manager_read"[\s\S]*?for select to authenticated[\s\S]*?using \(public\.can_manage_member_system\(\)\)/);
  assert.match(sql, /create unique index if not exists idx_member_access_requests_one_pending[\s\S]*?\(member_id\) where status = 'pending'/);
  assert.match(sql, /on conflict \(member_id\) where status = 'pending' do nothing/);
});

test('0039: دالة الزائر لا تكشف وجود البريد (لا قيمة راجعة، وrate_limited لا يتعلق بالبريد) وتحدّ العميل والسقف العام', () => {
  const fn = sql.slice(sql.indexOf('function public.request_member_access_help'), sql.indexOf('function public.resolve_member_access_request'));
  assert.match(fn, /returns void/);
  assert.match(fn, /security definer[\s\S]*?set search_path = public, pg_temp/);
  assert.doesNotMatch(fn, /raise exception '[^']*(غير موجود|not found|لا يوجد)/);
  // الاستثناء الوحيد قبل البحث عن البريد: تجاوز الحدّ
  const beforeLookup = fn.slice(0, fn.indexOf('insert into public.member_access_requests'));
  const raises = [...beforeLookup.matchAll(/raise exception '([^']+)'/g)].map((m) => m[1]);
  assert.ok(raises.length >= 2 && raises.every((r) => r === 'rate_limited'), raises.join(','));
  assert.match(fn, /v_cnt >= 5/);
  assert.match(fn, /interval '10 minutes'/);
  assert.match(fn, />= 100/);
  assert.match(fn, /sha256\(convert_to\(coalesce\(v_salt, ''\) \|\| ':member-access:'/);
  assert.match(fn, /m\.status = 'active'/);
  assert.match(fn, /m\.deleted_at is null/);
});

test('0039: دالة الإدارة تشترط can_manage_member_system وحالتين فقط وتسجّل في audit_logs', () => {
  const fn = sql.slice(sql.indexOf('function public.resolve_member_access_request'));
  assert.match(fn, /auth\.uid\(\) is null or not public\.can_manage_member_system\(\)/);
  assert.match(fn, /p_status not in \('handled', 'dismissed'\)/);
  assert.match(fn, /status = 'pending'/);                         // idempotent
  assert.match(fn, /insert into public\.audit_logs/);
});

test('0039: الصلاحيات: الزائر ينفّذ دالة الطلب فقط، والإدارة دالة الإنهاء فقط', () => {
  assert.match(sql, /revoke all on function public\.request_member_access_help\(text\)\s+from public, anon, authenticated/);
  assert.match(sql, /revoke all on function public\.resolve_member_access_request\(uuid, text\)\s+from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.request_member_access_help\(text\)\s+to anon, authenticated/);
  assert.match(sql, /grant execute on function public\.resolve_member_access_request\(uuid, text\)\s+to authenticated/);
  assert.doesNotMatch(sql, /grant execute on function public\.resolve_member_access_request[^;]*anon/);
});

test('0039: يشترط 0035 و0036 و0038 ولا يغيّر جداول قائمة، وملف الرجوع يحذف الجديد فقط', () => {
  assert.match(sql, /to_regprocedure\('public\.can_manage_member_system\(\)'\)/);
  assert.match(sql, /to_regclass\('public\.member_activation_throttle'\)/);
  assert.doesNotMatch(sql, /alter table public\.(?!member_access_requests)/);
  assert.match(down, /drop function if exists public\.resolve_member_access_request\(uuid, text\)/);
  assert.match(down, /drop function if exists public\.request_member_access_help\(text\)/);
  assert.match(down, /drop table if exists public\.member_access_requests/);
  assert.doesNotMatch(down, /drop table if exists public\.member_activation_throttle/);
});
