import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * 0046 — حساب واحد بصفتين (إداري + منخرط) وبطاقة المكتب.
 * فحوص نصّية على ملفات SQL / Edge Function (لا قاعدة بيانات هنا)؛ التنفيذ الفعلي يغطيه supabase/tests/rls_smoke.sql.
 */
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stripSql = (sql) => sql.replace(/--.*$/gm, '');

const raw = read('supabase/migrations/0046_dual_accounts_and_board_card.sql');
const sql = stripSql(raw);
const down = stripSql(read('supabase/rollback/0046_dual_accounts_and_board_card_down.sql'));
const smoke = read('supabase/tests/rls_smoke.sql');
const edge = read('supabase/functions/admin-create-user/index.ts');

/** جسم دالة بالاسم (من create or replace function حتى $$; التالية). */
function fnBody(source, name) {
  const start = source.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `الدالة ${name} غير موجودة`);
  const end = source.indexOf('$$;', source.indexOf('as $$', start) + 5);
  return source.slice(start, end);
}

test('0046: كل الدوال SECURITY DEFINER بمسار بحث ثابت', () => {
  const fns = sql.split(/create or replace function /).slice(1);
  assert.ok(fns.length >= 15, `عدد الدوال ${fns.length}`);
  for (const f of fns) {
    const head = f.slice(0, 400);
    assert.match(head, /security definer/, head.split('(')[0]);
    assert.match(head, /set search_path = public(, auth)?, pg_temp/, head.split('(')[0]);
  }
});

test('0046: لا صلاحية لـ anon ولا للجمهور على أي دالة جديدة', () => {
  assert.doesNotMatch(sql, /grant execute on function[^;]*\bto\b[^;]*\banon\b/);
  assert.doesNotMatch(sql, /grant execute on function[^;]*\bto\b[^;]*\bpublic\b/);
  const created = [...sql.matchAll(/create or replace function public\.(\w+)\(([^)]*)\)/g)].map((m) => [m[1], m[2].trim()]);
  for (const [name] of created) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\([^)]*\\)\\s+from public, anon, authenticated`), `revoke لـ ${name}`);
  }
});

test('0046: دوال الـ Edge Function (البحث/التعليم) لـ service_role فقط', () => {
  for (const fn of ['find_member_only_user(text)', 'mark_member_account_dual(uuid)']) {
    const esc = fn.replace(/[()]/g, '\\$&');
    assert.match(sql, new RegExp(`grant execute on function public\\.${esc}\\s+to service_role`), fn);
    assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\.${esc}\\s+to[^;]*authenticated`), fn);
  }
});

test('0046: الدمج مقصور على super_admin/developer (= ROLES_SUPER)', () => {
  const fn = fnBody(sql, 'can_link_admin_member');
  assert.match(fn, /in \('super_admin', 'developer'\)/);
  assert.doesNotMatch(fn, /secretary_general/);
  assert.doesNotMatch(fn, /members_manager/);
  for (const name of ['link_admin_as_member', 'unlink_admin_as_member', 'get_admin_member_link_overview']) {
    assert.match(fnBody(sql, name), /not public\.can_link_admin_member\(\)/, name);
  }
});

test('0046 ⚠️ ثغرة الاستعادة: الدوال الثلاث ترفض أي حساب له profiles', () => {
  const issue = fnBody(sql, 'issue_member_activation_link');
  assert.match(issue, /select 1 from public\.profiles p where p\.id = v_acc\.user_id/);
  assert.match(issue, /حساب إداري/);
  const prepare = fnBody(sql, 'prepare_member_activation');
  assert.match(prepare, /select 1 from public\.profiles p where p\.id = v_acc\.user_id/);
  assert.match(prepare, /activation_link_invalid/);
  const fin = fnBody(sql, 'finalize_member_activation');
  assert.match(fin, /select 1 from public\.profiles p where p\.id = v_acc\.user_id/);
  // الفحص يسبق تغيير أي كلمة مرور/علم: يأتي قبل تحديث member_accounts
  assert.ok(fin.indexOf('from public.profiles p') < fin.indexOf('update public.member_accounts'));
});

test('0046: مشغّل الحماية لا يقبل مستخدمًا إداريًا إلا بالعلم admin_linked، ويشترط وجود profiles للعلم', () => {
  const g = fnBody(sql, 'member_accounts_guard');
  assert.match(g, /member_account_forbidden_for_admin_user/);
  assert.match(g, /and not new\.admin_linked/);
  assert.match(g, /member_account_dual_requires_admin/);
  assert.match(g, /member_account_link_immutable/);
  assert.match(g, /member_account_member_not_found/);
});

test('0046: current_member_id تحترم admin_linked وتمنع الحساب المزدوج بكلمة مؤقتة', () => {
  const f = fnBody(sql, 'current_member_id');
  assert.match(f, /ma\.admin_linked or not exists \(select 1 from public\.profiles p where p\.id = ma\.user_id\)/);
  assert.match(f, /p\.must_change_password/);
  assert.match(f, /m\.deleted_at is null/);
});

test('0046: الدمج يتحقق من تطابق البريد ويمنع الظهور في الدليل العام ويسجّل في audit_logs', () => {
  const f = fnBody(sql, 'link_admin_as_member');
  assert.match(f, /lower\(btrim\(v_m\.email\)\) <> v_email/);
  assert.match(f, /show_in_directory\)[\s\S]*'active', false\)/);
  assert.match(f, /insert into public\.audit_logs/);
  assert.match(f, /بطاقة المكتب مرتبطة بسجل عضو آخر/);
  assert.match(f, /هذا العضو مرتبط ببطاقة مكتب أخرى/);
  assert.match(f, /auth\.users/);
});

test('0046: بطاقة المكتب — العضو لا يكتب في board_members مباشرة ولا يغيّر الاسم/الصفة', () => {
  const submit = fnBody(sql, 'submit_my_board_card');
  assert.match(submit, /public\._bp_clean\(p_data\)/);
  assert.doesNotMatch(submit, /update public\.board_members/);
  assert.doesNotMatch(submit, /insert into public\.board_members/);
  assert.match(submit, /\^member-' \|\| v_id::text/);          // الصورة من مجلد العضو نفسه فقط
  assert.match(submit, /status = 'submitted'|'submitted'/);
  // لا نصّ يمسّ position/full_name/sort_order في الكتابة
  assert.doesNotMatch(submit, /set[^;]*\b(position|full_name|sort_order)\b/);
  const get = fnBody(sql, 'get_my_board_card');
  assert.match(get, /current_member_id\(\)/);
  assert.match(get, /is_active/);
});

test('0046: سياسة التخزين مقيّدة بصور بطاقات المكتب ومسؤولي المحتوى', () => {
  assert.match(sql, /create policy "member_board_photo_content_select" on storage\.objects\s+for select to authenticated/);
  assert.match(sql, /public\.can_manage_content\(\)\s+and public\.board_member_photo_readable\(name\)/);
  assert.match(fnBody(sql, 'board_member_photo_readable'), /b\.member_id is not null/);
});

test('0046: داخل معاملة واحدة، يطلب إعادة تحميل المخطط، وفيه فحص المتطلبات المسبقة', () => {
  assert.match(sql, /^\s*begin;/m);
  assert.match(sql, /\bcommit;\s*$/);
  assert.match(sql, /notify pgrst, 'reload schema'/);
  assert.match(sql, /شغّل 0031_board_profile_links\.sql أولاً/);
  assert.match(sql, /شغّل 0027_must_change_password_server_side\.sql أولاً/);
  assert.match(sql, /create unique index if not exists uq_board_members_member_id/);
});

test('0046: لا يمسّ profiles ولا سياساتها ولا دوال الصلاحيات القائمة', () => {
  assert.doesNotMatch(sql, /alter table public\.(profiles|members|board_members)/);
  assert.doesNotMatch(sql, /create or replace function public\.(is_admin|current_admin_role|mfa_satisfied|is_super_admin|can_manage_members|can_manage_content|can_manage_budget|can_manage_member_system)\b/);
  assert.doesNotMatch(sql, /(create|drop|alter) policy[^;]*on public\./i);
  assert.doesNotMatch(sql, /(insert into|update|delete from) public\.profiles\b/i);
});

test('0046: ملف الرجوع يعيد الأصل ويحذف الجديد فقط', () => {
  for (const n of ['link_admin_as_member', 'unlink_admin_as_member', 'get_admin_member_link_overview', 'can_link_admin_member',
    'get_my_board_card', 'submit_my_board_card', 'cancel_my_board_card_request', 'find_member_only_user', 'mark_member_account_dual',
    'board_member_photo_readable']) {
    assert.match(down, new RegExp(`drop function if exists public\\.${n}\\(`), n);
  }
  assert.match(down, /drop index if exists public\.uq_board_members_member_id/);
  assert.match(down, /alter table public\.member_accounts drop column if exists admin_linked/);
  assert.match(down, /drop policy if exists "member_board_photo_content_select" on storage\.objects/);
  const g = fnBody(down, 'member_accounts_guard');
  assert.match(g, /member_account_forbidden_for_admin_user/);
  assert.doesNotMatch(g, /admin_linked/);
});

test('admin-create-user: منخرط قائم يحتاج تأكيدًا صريحًا ولا تُغيَّر كلمة مروره ولا يُحذف عند الفشل', () => {
  assert.match(edge, /find_member_only_user/);
  assert.match(edge, /body\.link_existing_member !== true/);
  assert.match(edge, /code: 'member_account_exists'/);
  assert.match(edge, /mark_member_account_dual/);
  assert.match(edge, /must_change_password: false/);
  // المستخدم القائم لا يُحذف أبدًا في هذا المسار، ولا تُمرَّر له كلمة مرور جديدة
  const block = edge.slice(edge.indexOf('find_member_only_user'), edge.indexOf('const { data: created'));
  assert.doesNotMatch(block, /deleteUser/);
  assert.doesNotMatch(block, /updateUserById/);
  assert.match(block, /from\('profiles'\)\.delete\(\)\.eq\('id', existing\.user_id\)/);
  // التحقق من الدور (منع منح developer لغير المطوّر) يسبق هذا المسار
  assert.ok(edge.indexOf('لا يستطيع منح دور المطوّر إلا مطوّر') < edge.indexOf('find_member_only_user'));
});

test('rls_smoke: فحوص 0046 مُلحقة (الدمج، بطاقة المكتب، ثغرة الاستعادة، الكلمة المؤقتة)', () => {
  assert.match(smoke, /فحوص migration 0046/);
  assert.match(smoke, /members_manager استطاع دمج حساب إداري/);
  assert.match(smoke, /members_manager أصدر رابط استعادة لحساب إداري/);
  assert.match(smoke, /prepare_member_activation قبلت رابط استعادة لحساب إداري/);
  assert.match(smoke, /finalize_member_activation قبلت رابط استعادة لحساب إداري/);
  assert.match(smoke, /الاسم\/الصفة|خارج القائمة البيضاء/);
  assert.match(smoke, /كلمة مرور مؤقتة يحمل هوية عضو/);
  // فحوص 0035 الأصلية باقية (الربط المباشر لمستخدم إداري ما زال مرفوضًا)
  assert.match(smoke, /member_account_forbidden_for_admin_user/);
  assert.match(smoke, /RLS smoke: كل الفحوص نجحت/);
});
