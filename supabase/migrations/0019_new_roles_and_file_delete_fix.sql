-- ============================================================
-- 0019_new_roles_and_file_delete_fix.sql
--  (1) أدوار جديدة: الكاتب العام، نائب الكاتب العام، نائب أمين المال، نائب المسؤول الأعلى.
--  (2) إصلاح حذف الملفات الداخلية (حذف منطقي عبر دالة SECURITY DEFINER).
-- آمن لإعادة التشغيل (idempotent). شغّله في SQL Editor دفعة واحدة.
--
-- ملاحظة تصميم: المقارنات تتم بالنص (::text) فلا اعتماد على قيم enum الجديدة داخل نفس
-- المعاملة (نفس أسلوب 0012).
-- لم نغيّر is_super_admin(): نائب المسؤول الأعلى لا يدير الحسابات الإدارية ولا الإعدادات
-- العامة ولا سجل العمليات، وهذا يمنع أي تصعيد للصلاحيات.
-- ============================================================

-- ---------- (1) قيم الأدوار ----------
alter type admin_role add value if not exists 'secretary_general';
alter type admin_role add value if not exists 'deputy_secretary_general';
alter type admin_role add value if not exists 'deputy_treasurer';
alter type admin_role add value if not exists 'deputy_super_admin';

-- ---------- دوال الصلاحيات (تحافظ على المنح الحالية لأن الإنشاء بـ OR REPLACE) ----------

-- إدارة الأعضاء
create or replace function public.can_manage_members()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.current_admin_role()::text in (
    'super_admin', 'developer', 'members_manager',
    'secretary_general', 'deputy_secretary_general', 'deputy_super_admin'
  );
$$;

-- إدارة المحتوى (أنشطة، معرض، إعلانات، مشاريع، أعضاء المكتب، محتوى الموقع)
create or replace function public.can_manage_content()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.current_admin_role()::text in (
    'super_admin', 'developer', 'editor',
    'secretary_general', 'deputy_secretary_general', 'deputy_super_admin'
  );
$$;

-- الميزانية
create or replace function public.can_manage_budget()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.current_admin_role()::text in (
    'super_admin', 'developer', 'treasurer',
    'deputy_treasurer', 'deputy_super_admin'
  );
$$;

-- معالجة الانخراط (طلبات، تسجيل الاشتراك السنوي)
create or replace function public.can_handle_membership()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.current_admin_role()::text in (
    'super_admin', 'developer', 'members_manager', 'treasurer',
    'secretary_general', 'deputy_secretary_general',
    'deputy_treasurer', 'deputy_super_admin'
  );
$$;

-- الملفات الداخلية: الاطلاع والرفع
create or replace function public.can_access_internal_files()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.current_admin_role()::text in (
    'developer', 'super_admin', 'editor', 'members_manager',
    'secretary_general', 'deputy_secretary_general', 'deputy_super_admin'
  );
$$;

-- الملفات الداخلية: الحذف (منطقي ومسجَّل في سجل العمليات)
create or replace function public.can_delete_internal_files()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.current_admin_role()::text in (
    'developer', 'super_admin', 'deputy_super_admin', 'secretary_general'
  );
$$;

-- ---------- (2) حذف الملفات الداخلية ----------
-- سبب الفشل السابق: UPDATE مباشر من العميل يمرّ بسياسات RLS (ومنها سياسة SELECT التي تُخفي
-- الصفوف المحذوفة)، فيُرفض حتى للمطوّر. الدالة أدناه تتحقق من الدور بنفسها وتنفّذ الحذف
-- المنطقي؛ والـ trigger يسجّل العملية في audit_logs كما قبل.
create or replace function public.soft_delete_internal_file(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := coalesce(public.current_admin_role()::text, '');
begin
  if auth.uid() is null
     or v_role not in ('developer', 'super_admin', 'deputy_super_admin', 'secretary_general') then
    raise exception 'غير مصرح لك بحذف الملفات الداخلية';
  end if;

  update public.internal_files
     set deleted_at = now()
   where id = p_id and deleted_at is null;

  if not found then
    raise exception 'الملف غير موجود أو محذوف مسبقاً';
  end if;
end;
$$;

revoke execute on function public.soft_delete_internal_file(uuid) from public, anon;
grant  execute on function public.soft_delete_internal_file(uuid) to authenticated;

notify pgrst, 'reload schema';
