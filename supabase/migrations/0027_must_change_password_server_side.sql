-- ============================================================
-- 0027_must_change_password_server_side.sql
-- نقل علم «يجب تغيير كلمة المرور المؤقتة» من user_metadata (يستطيع صاحب الحساب تعديله بنفسه
-- عبر supabase.auth.updateUser فيتخطى الشاشة الإلزامية) إلى عمود في profiles لا يستطيع المسؤول
-- العادي تعديله (سياسة profiles_update_super_admin_only)، ويُسقَط تلقائيًا من الخادم
-- فقط عند تغيّر كلمة المرور فعلًا (trigger على auth.users).
--
-- يتطلب: 0002 و0003. آمن لإعادة التشغيل (idempotent).
-- ترتيب النشر: نفّذ هذا الملف *قبل* نشر الواجهة ودالة admin-create-user الجديدتين.
-- ============================================================

alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

-- ترحيل الحسابات الحالية التي ما زال علمها القديم في user_metadata
update public.profiles p
set must_change_password = true
from auth.users u
where u.id = p.id
  and coalesce(u.raw_user_meta_data ->> 'must_change_password', '') = 'true'
  and p.must_change_password = false;

-- يُسقط العلم حين يتغيّر hash كلمة المرور فقط (لا يكفي استدعاء دالة أو تعديل بيانات وصفية).
create or replace function public.clear_must_change_password_on_password_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    update public.profiles
       set must_change_password = false
     where id = new.id
       and must_change_password = true;
  end if;
  return new;
end;
$$;

revoke execute on function public.clear_must_change_password_on_password_change() from public, anon, authenticated;

drop trigger if exists trg_clear_must_change_password on auth.users;
create trigger trg_clear_must_change_password
  after update of encrypted_password on auth.users
  for each row execute function public.clear_must_change_password_on_password_change();
