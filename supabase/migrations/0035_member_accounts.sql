-- ============================================================
-- 0035_member_accounts.sql — أساس حسابات الأعضاء (المرحلة 2: قاعدة البيانات فقط)
--
-- الفكرة: العضو العادي لا يدخل أبدًا إلى profiles ولا إلى admin_role (is_admin() = أي صف نشط في profiles).
-- الربط بين مستخدم Supabase Auth وسجل العضو يتم في جدول مستقل 1:1: member_accounts.
-- وجود صف نشط فيه هو «دور العضو» الوحيد؛ كل ما يخصّ الأعضاء لاحقًا يفحص current_member_id()
-- وليس مجرد auth.uid() is not null (لأن أي مستخدم موثّق يحمل الدور authenticated).
--
-- ما يضيفه (إضافة فقط):
--   1) جدول member_accounts — خاص: لا كتابة من أي عميل (الإنشاء لاحقًا عبر Edge Function بـ service_role).
--   2) can_manage_member_system()  — الأدوار الأربعة فقط: super_admin, developer, secretary_general, members_manager.
--   3) current_member_id()         — member_id لحساب العضو النشط، وإلا null.
--   4) member_accounts_guard()     — مشغّل حماية على الجدول الجديد فقط:
--        • يرفض ربط حساب بمستخدم له صف في profiles (فصل الحساب الإداري عن حساب العضو — قرار ج1).
--        • يرفض ربط عضو محذوف.  • يجعل الربط (user_id, member_id) غير قابل للتغيير.
--
-- ما لا يمسّه: profiles وسياساته، admin_role، is_admin / current_admin_role / mfa_satisfied / is_super_admin،
-- can_manage_members وكل دوال can_* القائمة، members، أي سياسة قائمة، auth.users، ولا أي ملف في الواجهة.
--
-- طبقة دفاع إضافية: حتى لو أُضيف صف profiles لاحقًا لمستخدم له حساب عضو (مثلًا يدويًا)،
-- فإن current_member_id() تعيد null له فيتعطّل جانب العضو ولا يتداخل الحسابان.
--
-- يتطلب: 0002 (profiles, members) و0004 (set_updated_at) و0019 (current_admin_role/الأدوار) و0024 (mfa).
-- آمن لإعادة التشغيل (idempotent). الرجوع: supabase/rollback/0035_member_accounts_down.sql
--
-- ⚠️ تجربة جافة قبل التنفيذ الفعلي: استبدل السطر الأخير `commit;` بـ `rollback;` ثم شغّل الملف.
--    إن لم يظهر أي خطأ فالملف سليم؛ أعد `commit;` ونفّذه.
-- ⚠️ ترتيب النشر: هذا الملف وحده كافٍ؛ لا تغيير في الواجهة ولا في الـ Edge Functions في هذه المرحلة.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.profiles') is null or to_regclass('public.members') is null then
    raise exception 'شغّل 0002_tables.sql أولاً';
  end if;
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'شغّل 0004_functions_and_triggers.sql أولاً';
  end if;
  if to_regprocedure('public.current_admin_role()') is null then
    raise exception 'شغّل 0024_mfa_enforcement.sql أولاً';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'admin_role' and e.enumlabel = 'secretary_general') then
    raise exception 'شغّل 0019_new_roles_and_file_delete_fix.sql أولاً';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) الجدول (خاص: القراءة فقط للمستخدم الموثّق عبر RLS، والكتابة لا تتم إلا بـ service_role / postgres)
-- ---------------------------------------------------------------------
create table if not exists public.member_accounts (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  member_id           uuid not null unique references public.members(id) on delete cascade,
  is_active           boolean not null default true,
  must_change_password boolean not null default true,   -- يُفرض تغيير كلمة المرور المؤقتة عند أول دخول
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.member_accounts enable row level security;

-- Supabase يمنح anon/authenticated كل الصلاحيات تلقائيًا على أي جدول جديد: نسحبها فورًا ثم نمنح الحد الأدنى
revoke all on public.member_accounts from public, anon, authenticated;
grant select on public.member_accounts to authenticated;

-- ---------------------------------------------------------------------
-- 2) الدوال
-- ---------------------------------------------------------------------

-- 2.أ) من يدير نظام الأعضاء الجديد (حسابات، بطاقات، حضور، تقارير): الأدوار الأربعة فقط (قرار 2).
--      مبنية على current_admin_role() فيُفرض MFA تلقائيًا لمن فعّله. لا تعديل على can_manage_members().
create or replace function public.can_manage_member_system()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    public.current_admin_role()::text in ('super_admin', 'developer', 'secretary_general', 'members_manager'),
    false
  );
$$;

revoke all on function public.can_manage_member_system() from public, anon, authenticated;
grant execute on function public.can_manage_member_system() to authenticated;

-- 2.ب) هوية العضو الحالي: member_id لحساب نشط، وإلا null.
--      تعيد null أيضًا إن كان للمستخدم صف في profiles (فصل الحسابين) أو كان العضو محذوفًا (soft delete).
create or replace function public.current_member_id()
returns uuid
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select ma.member_id
    from public.member_accounts ma
   where ma.user_id = auth.uid()
     and ma.is_active
     and not exists (select 1 from public.profiles p where p.id = ma.user_id)
     and exists (select 1 from public.members m where m.id = ma.member_id and m.deleted_at is null)
   limit 1;
$$;

revoke all on function public.current_member_id() from public, anon, authenticated;
grant execute on function public.current_member_id() to authenticated;

-- 2.ج) مشغّل الحماية (على member_accounts فقط). رسائل الأخطاء رموز ثابتة ليتعرّف عليها الخادم لاحقًا.
create or replace function public.member_accounts_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id or new.member_id is distinct from old.member_id then
      raise exception 'member_account_link_immutable';
    end if;
    return new;
  end if;

  -- INSERT
  if exists (select 1 from public.profiles p where p.id = new.user_id) then
    raise exception 'member_account_forbidden_for_admin_user';
  end if;
  if not exists (select 1 from public.members m where m.id = new.member_id and m.deleted_at is null) then
    raise exception 'member_account_member_not_found';
  end if;
  return new;
end;
$$;

revoke all on function public.member_accounts_guard() from public, anon, authenticated;

drop trigger if exists trg_member_accounts_guard on public.member_accounts;
create trigger trg_member_accounts_guard
  before insert or update on public.member_accounts
  for each row execute function public.member_accounts_guard();

drop trigger if exists trg_set_updated_at on public.member_accounts;
create trigger trg_set_updated_at
  before update on public.member_accounts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 3) سياسات القراءة (لا توجد أي سياسة كتابة: الكتابة ممنوعة على كل العملاء)
-- ---------------------------------------------------------------------
drop policy if exists "member_accounts_own_read" on public.member_accounts;
create policy "member_accounts_own_read" on public.member_accounts
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "member_accounts_manager_read" on public.member_accounts;
create policy "member_accounts_manager_read" on public.member_accounts
  for select to authenticated
  using (public.can_manage_member_system());

notify pgrst, 'reload schema';

commit;
