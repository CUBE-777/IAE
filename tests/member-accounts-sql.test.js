import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stripSql = (sql) => sql.replace(/--.*$/gm, '');

const raw = read('supabase/migrations/0035_member_accounts.sql');
const sql = stripSql(raw);
const down = stripSql(read('supabase/rollback/0035_member_accounts_down.sql'));
const smoke = read('supabase/tests/rls_smoke.sql');

test('0035: الجدول خاص — RLS مفعّلة، سحب كل الصلاحيات فورًا، وSELECT فقط للمستخدم الموثّق', () => {
  assert.match(sql, /create table if not exists public\.member_accounts/);
  assert.match(sql, /alter table public\.member_accounts enable row level security/);
  assert.match(sql, /revoke all on public\.member_accounts from public, anon, authenticated/);
  assert.match(sql, /grant select on public\.member_accounts to authenticated/);
  // لا أي منح كتابة ولا أي منح لـ anon
  assert.doesNotMatch(sql, /grant [^;]*\b(insert|update|delete|truncate|all)\b[^;]*on public\.member_accounts/i);
  assert.doesNotMatch(sql, /grant [^;]*on public\.member_accounts to[^;]*anon/);
});

test('0035: الربط 1:1 — user_id مفتاح أساسي إلى auth.users، وmember_id فريد إلى members', () => {
  assert.match(sql, /user_id\s+uuid primary key references auth\.users\(id\) on delete cascade/);
  assert.match(sql, /member_id\s+uuid not null unique references public\.members\(id\) on delete cascade/);
  assert.match(sql, /must_change_password\s+boolean not null default true/);
});

test('0035: سياسات القراءة فقط — صفّه أو الأدوار الأربعة، ولا سياسة كتابة', () => {
  assert.match(sql, /create policy "member_accounts_own_read" on public\.member_accounts\s+for select to authenticated\s+using \(user_id = auth\.uid\(\)\)/);
  assert.match(sql, /create policy "member_accounts_manager_read" on public\.member_accounts\s+for select to authenticated\s+using \(public\.can_manage_member_system\(\)\)/);
  assert.doesNotMatch(sql, /create policy[^;]*for (insert|update|delete|all)/i);
});

test('0035: can_manage_member_system = الأدوار الأربعة فقط، ولا يدخل النواب ولا غيرهم', () => {
  const body = sql.slice(sql.indexOf('function public.can_manage_member_system('));
  const list = body.slice(0, body.indexOf('$$;', 20));
  assert.match(list, /'super_admin', 'developer', 'secretary_general', 'members_manager'/);
  for (const r of ['deputy_super_admin', 'deputy_secretary_general', 'treasurer', 'deputy_treasurer', 'editor', 'consultant']) {
    assert.doesNotMatch(list, new RegExp(`'${r}'`), r);
  }
  assert.match(list, /public\.current_admin_role\(\)/); // يفرض MFA تلقائيًا
});

test('0035: current_member_id تفحص الحساب النشط وغياب profiles وعدم حذف العضو', () => {
  const body = sql.slice(sql.indexOf('function public.current_member_id('));
  const fn = body.slice(0, body.indexOf('$$;', 20));
  assert.match(fn, /ma\.user_id = auth\.uid\(\)/);
  assert.match(fn, /ma\.is_active/);
  assert.match(fn, /not exists \(select 1 from public\.profiles p where p\.id = ma\.user_id\)/);
  assert.match(fn, /m\.deleted_at is null/);
});

test('0035: كل دالة SECURITY DEFINER تثبّت search_path وتسحب EXECUTE من public وanon', () => {
  const fns = sql.split(/create or replace function /).slice(1);
  assert.equal(fns.length, 3);
  for (const f of fns) {
    const head = f.slice(0, 300);
    assert.match(head, /security definer/, head.split('(')[0]);
    assert.match(head, /set search_path = public, pg_temp/, head.split('(')[0]);
  }
  for (const fn of ['can_manage_member_system()', 'current_member_id()', 'member_accounts_guard()']) {
    const esc = fn.replace(/[()]/g, '\\$&');
    assert.match(sql, new RegExp(`revoke all on function public\\.${esc} from public, anon, authenticated`), fn);
  }
  assert.match(sql, /grant execute on function public\.can_manage_member_system\(\) to authenticated/);
  assert.match(sql, /grant execute on function public\.current_member_id\(\) to authenticated/);
  assert.doesNotMatch(sql, /grant execute on function[^;]*\bto\b[^;]*\banon\b/);
  assert.doesNotMatch(sql, /grant execute on function public\.member_accounts_guard/);
});

test('0035: مشغّل الحماية يرفض مستخدمًا له profiles وعضوًا محذوفًا ويثبّت الربط', () => {
  const body = sql.slice(sql.indexOf('function public.member_accounts_guard('));
  const fn = body.slice(0, body.indexOf('$$;', 20));
  assert.match(fn, /member_account_forbidden_for_admin_user/);
  assert.match(fn, /select 1 from public\.profiles p where p\.id = new\.user_id/);
  assert.match(fn, /member_account_member_not_found/);
  assert.match(fn, /member_account_link_immutable/);
  assert.match(sql, /create trigger trg_member_accounts_guard\s+before insert or update on public\.member_accounts/);
  // المشغّلات على الجدول الجديد فقط
  assert.doesNotMatch(sql, /create trigger[^;]*on (public\.(profiles|members|audit_logs)|auth\.users)/);
});

test('0035: إضافة فقط — لا يمسّ profiles ولا admin_role ولا دوال الصلاحيات القائمة ولا auth.users', () => {
  assert.doesNotMatch(sql, /alter table public\.(profiles|members|member_private|member_memberships|board_members)/);
  assert.doesNotMatch(sql, /alter type|add value/i);
  assert.doesNotMatch(sql, /create or replace function public\.(is_admin|current_admin_role|mfa_satisfied|is_super_admin|can_manage_members|can_manage_content|can_manage_budget|can_handle_membership)\b/);
  assert.doesNotMatch(sql, /(create|drop|alter) policy[^;]*on public\.(profiles|members|audit_logs|member_private|member_memberships)\b/i);
  assert.doesNotMatch(sql, /(insert into|update|delete from) public\.(profiles|members|audit_logs)\b/i);
  assert.doesNotMatch(sql, /auth\.users\s*\n?\s*(for each|set|add)/i);
});

test('0035: داخل معاملة واحدة ويطلب إعادة تحميل المخطط، وفيه فحص المتطلبات المسبقة', () => {
  assert.match(sql, /^\s*begin;/m);
  assert.match(sql, /\bcommit;\s*$/);
  assert.match(sql, /notify pgrst, 'reload schema'/);
  assert.match(sql, /شغّل 0019_new_roles_and_file_delete_fix\.sql أولاً/);
});

test('0035: ملف الرجوع يحذف الكائنات الجديدة فقط ولا يمسّ شيئًا قائمًا', () => {
  assert.match(down, /drop table if exists public\.member_accounts cascade/);
  assert.match(down, /drop function if exists public\.member_accounts_guard\(\)/);
  assert.match(down, /drop function if exists public\.current_member_id\(\)/);
  assert.match(down, /drop function if exists public\.can_manage_member_system\(\)/);
  const dropped = [...down.matchAll(/drop (?:table|function) if exists public\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(dropped.sort(), ['can_manage_member_system', 'current_member_id', 'member_accounts', 'member_accounts_guard']);
});

test('rls_smoke: فحوص 0035 مُلحقة (الأدوار الأربعة، فصل الحسابين، صفّ العضو فقط، منع الكتابة)', () => {
  assert.match(smoke, /فحوص migration 0035/);
  assert.match(smoke, /member_account_forbidden_for_admin_user/);
  assert.match(smoke, /member_account_link_immutable/);
  assert.match(smoke, /member_account_member_not_found/);
  assert.match(smoke, /'super_admin', 'developer', 'secretary_general', 'members_manager'/);
  assert.match(smoke, /anon يقرأ member_accounts/);
  assert.match(smoke, /العضو يرى حساب عضو آخر/);
  // الفحوص الأصلية ما زالت موجودة
  assert.match(smoke, /RLS smoke: كل الفحوص نجحت/);
});
