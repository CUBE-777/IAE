-- ============================================================
-- 02_roles_hardening.sql — Phase 1: صلاحيات الأدوار
-- نفّذه يدويًا في Supabase → SQL Editor بعد مراجعة 01_pre_checks.sql.
-- لا يحذف جداول/أعمدة/سجلات، ولا يغيّر أسماء الدوال أو توقيعاتها أو أنواع إرجاعها.
--
-- الملف مقسّم إلى جزأين مستقلين (كل جزء معاملة BEGIN/COMMIT خاصة به؛ يمكن تنفيذ أحدهما دون الآخر):
--
--   الجزء 1-أ (حرج): دوال الحراسة can_* / is_super_admin / is_developer كانت تُرجع NULL (وليس false) لمن لا دور إداريًا له.
--       الحراسة المكتوبة في الدوال على الصيغة
--           if auth.uid() is null or not public.can_manage_members() then raise exception ... end if;
--       تصبح غير صحيحة حين تكون القيمة NULL (NOT NULL = NULL، و IF NULL لا يدخل الفرع)، فتمرّ الدالة كأن المستدعي مسؤول.
--       يطال ذلك أي مستخدم موثّق بلا صف في profiles (مثل منخرط فُعّل حسابه) وأيضًا أي مسؤول فعّل MFA وجلسته aal1
--       (لأن current_admin_role() تُرجع NULL له بقرار 0024). الإصلاح: coalesce(..., false) داخل الدوال المساعدة نفسها،
--       فتُصلَح كل الدوال المستدعية دفعة واحدة. سلوك RLS لا يتغيّر (NULL و false كلاهما يرفض الصف).
--       قوائم الأدوار هنا منسوخة حرفيًا من آخر تعريف في الـ migrations (0012 / 0019 / 0032) — لا إضافة ولا حذف لأي دور.
--
--   الجزء 1-ب: تفوّق المطوّر (developer) على المسؤول الأعلى (super_admin):
--       • حسابات super_admin لا يُنشئها ولا يعدّلها ولا يعطّلها ولا يحذفها ولا يمنح صلاحيتها أو يسحبها إلا المطوّر
--         (trigger جديد على profiles؛ يُستثنى تعديل المسؤول الأعلى لبيانات حسابه هو دون تغيير الدور/التفعيل).
--       • الجانب «المنخرط» لحساب المطوّر المزدوج (member_accounts) لا يربطه/يفكّه/يعدّله غيره (trigger جديد):
--         كان يستطيع super_admin استدعاء unlink_admin_as_member على المطوّر فيعطّل جانب المنخرط عنده.
--       • حماية حسابات المطوّر الموجودة (trg_protect_developer_profiles من 0012) تبقى كما هي.
--       • is_super_admin() تبقى true للمطوّر وللمسؤول الأعلى معًا (تعتمد عليها عشرات السياسات) — لم تُمَسّ دلالتها.
--
-- الوظائف التي قد تتأثر:
--   - 1-أ: لا أثر على أي مستخدم مشروع. ما يتغيّر أن من لا دور إداريًا له (أو مسؤول MFA بجلسة aal1) لم يعد يمرّ من حراسة الدوال.
--   - 1-ب: صفحة «المستخدمون الإداريون»: مسؤول أعلى (غير مطوّر) لن ينجح في تعديل/تعطيل/إنشاء حساب super_admin
--          (ستظهر رسالة الخطأ من القاعدة). المطوّر يعمل كما كان. تعديل المسؤول الأعلى لاسمه/صورته هو يبقى مسموحًا.
--          صفحة «ربط الحسابات الإدارية بالمنخرطين»: ربط/فكّ حساب مطوّر يحتاج مطوّرًا.
--   - Edge Function admin-create-user تعمل بـ service_role (auth.uid() = null) فلا يعترضها الـ trigger؛ انظر التقرير
--     الجانبي 00_security_audit.md (الإصلاح المطلوب هناك في TypeScript، ليس هنا).
--
-- التراجع: 08_rollback.sql → القسم «Phase 1».
-- ⚠️ شرط مسبق: وجود مطوّر نشط واحد على الأقل (يفحصه الجزء 1-ب ويتوقف إن لم يوجد)، وإلا لن يستطيع أحد من الواجهة إدارة super_admin.
-- ============================================================


-- ============================================================
-- الجزء 1-أ — حراسة الدوال: NULL → false
-- ============================================================
begin;

do $$
begin
  if to_regprocedure('public.current_admin_role()') is null
     or to_regprocedure('public.can_manage_projects()') is null
     or to_regprocedure('public.can_read_internal_files()') is null then
    raise exception 'نفّذ migrations حتى 0032 أولًا (دوال الأدوار غير مكتملة)';
  end if;
end $$;

create or replace function public.is_super_admin()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(public.current_admin_role()::text in ('super_admin', 'developer'), false);
$$;

create or replace function public.is_developer()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(public.current_admin_role()::text = 'developer', false);
$$;

create or replace function public.can_manage_members()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(public.current_admin_role()::text in (
    'super_admin', 'developer', 'members_manager',
    'secretary_general', 'deputy_secretary_general', 'deputy_super_admin'
  ), false);
$$;

create or replace function public.can_manage_content()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(public.current_admin_role()::text in (
    'super_admin', 'developer', 'editor',
    'secretary_general', 'deputy_secretary_general', 'deputy_super_admin'
  ), false);
$$;

create or replace function public.can_manage_budget()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(public.current_admin_role()::text in (
    'super_admin', 'developer', 'treasurer',
    'deputy_treasurer', 'deputy_super_admin'
  ), false);
$$;

create or replace function public.can_handle_membership()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(public.current_admin_role()::text in (
    'super_admin', 'developer', 'members_manager', 'treasurer',
    'secretary_general', 'deputy_secretary_general',
    'deputy_treasurer', 'deputy_super_admin'
  ), false);
$$;

create or replace function public.can_access_internal_files()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(public.current_admin_role()::text in (
    'developer', 'super_admin', 'editor', 'members_manager',
    'secretary_general', 'deputy_secretary_general', 'deputy_super_admin'
  ), false);
$$;

create or replace function public.can_delete_internal_files()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(public.current_admin_role()::text in (
    'developer', 'super_admin', 'deputy_super_admin', 'secretary_general'
  ), false);
$$;

create or replace function public.can_manage_projects()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(public.current_admin_role()::text in (
    'super_admin', 'developer', 'editor',
    'secretary_general', 'deputy_secretary_general', 'deputy_super_admin',
    'consultant'
  ), false);
$$;

create or replace function public.can_read_internal_files()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(public.current_admin_role()::text in (
    'developer', 'super_admin', 'editor', 'members_manager',
    'secretary_general', 'deputy_secretary_general', 'deputy_super_admin',
    'consultant'
  ), false);
$$;

-- create or replace يحتفظ بصلاحيات EXECUTE الحالية (لا revoke/grant هنا عمدًا):
-- can_manage_content / can_manage_members / is_super_admin يبقى EXECUTE فيها لـ anon لأن سياسات RLS بلا «to» تُقيَّم لدور anon.

notify pgrst, 'reload schema';

commit;


-- ============================================================
-- الجزء 1-ب — تفوّق المطوّر على المسؤول الأعلى
-- ============================================================
begin;

do $$
begin
  if not exists (select 1 from public.profiles where role::text = 'developer' and is_active) then
    raise exception 'لا يوجد مطوّر نشط في profiles. عيّن مطوّرًا أولًا (انظر ذيل 0012) وإلا لن يستطيع أحد إدارة حسابات super_admin من الواجهة.';
  end if;
  if to_regprocedure('public.protect_developer_profiles()') is null then
    raise exception 'نفّذ 0012 أولًا (trigger حماية المطوّر غير موجود)';
  end if;
end $$;

-- ---------- profiles: حسابات super_admin للمطوّر وحده ----------
-- بلا جلسة مستخدم (SQL Editor / service_role) يُسمح، كما في protect_developer_profiles.
create or replace function public.protect_super_admin_profiles()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  v_role := coalesce(public.current_admin_role()::text, '');
  if v_role = 'developer' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    if new.role::text = 'super_admin' then
      raise exception 'فقط المطوّر يستطيع إنشاء حساب مسؤول أعلى';
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if old.role::text = 'super_admin' or new.role::text = 'super_admin' then
      -- استثناء ضيّق: المسؤول الأعلى يعدّل بيانات حسابه هو (الاسم/الصورة...) بشرط ألا يمسّ الدور أو التفعيل أو المعرّف
      if old.id = auth.uid() and new.id = old.id
         and new.role = old.role and new.is_active = old.is_active then
        return new;
      end if;
      raise exception 'فقط المطوّر يستطيع تعديل حسابات المسؤول الأعلى أو منح/سحب صلاحيته';
    end if;
    return new;
  else
    if old.role::text = 'super_admin' then
      raise exception 'فقط المطوّر يستطيع حذف حسابات المسؤول الأعلى';
    end if;
    return old;
  end if;
end;
$$;

revoke execute on function public.protect_super_admin_profiles() from public, anon, authenticated;

drop trigger if exists trg_protect_super_admin_profiles on public.profiles;
create trigger trg_protect_super_admin_profiles
  before insert or update or delete on public.profiles
  for each row execute function public.protect_super_admin_profiles();

-- ---------- member_accounts: جانب «المنخرط» لحساب المطوّر المزدوج ----------
-- المسموح: المطوّر نفسه، أو أي جلسة بلا auth.uid() (service_role: التفعيل/الاستعادة)، أو صاحب الحساب نفسه.
create or replace function public.protect_developer_member_accounts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_target uuid;
begin
  if v_uid is null then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  v_target := case tg_op when 'DELETE' then old.user_id else new.user_id end;
  if v_target = v_uid then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if exists (select 1 from public.profiles p where p.id = v_target and p.role::text = 'developer')
     and coalesce(public.current_admin_role()::text, '') <> 'developer' then
    raise exception 'developer_account_protected';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

revoke execute on function public.protect_developer_member_accounts() from public, anon, authenticated;

do $$
begin
  if to_regclass('public.member_accounts') is not null then
    drop trigger if exists trg_member_accounts_protect_developer on public.member_accounts;
    create trigger trg_member_accounts_protect_developer
      before insert or update or delete on public.member_accounts
      for each row execute function public.protect_developer_member_accounts();
  end if;
end $$;

commit;
