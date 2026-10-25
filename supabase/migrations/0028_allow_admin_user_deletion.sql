-- ============================================================
-- 0028_allow_admin_user_deletion.sql
-- إصلاح: «Failed to delete user: Database error deleting user» عند حذف مستخدم من
-- Supabase → Authentication → Users.
--
-- السبب: حذف auth.users يحذف صف profiles بالتتابع (cascade)، وكل الجداول التي تشير إلى profiles
-- إما بلا ON DELETE (membership_requests.reviewed_by)، أو بـ ON DELETE SET NULL لكن عليها triggers
-- تحمي السجل من أي تعديل فترفض تصفير المرجع:
--   1) membership_requests.reviewed_by  → لا إجراء عند الحذف، فيُحجب الحذف.
--   2) audit_logs.user_id               → trigger يمنع أي UPDATE (0008).
--   3) budget_transactions.created_by / voided_by → budget_tx_guard يمنع التعديل (0012).
--   4) announcements.created_by         → announcements_before_write يعيد القيمة القديمة (0009).
--
-- الحل يحافظ على الحماية: يُسمح بتصفير المرجع (→ NULL) فقط حين لا توجد جلسة مستخدم
-- (auth.uid() is null: حذف من لوحة Supabase / SQL Editor / service_role)، وبشرط ألا يتغيّر أي عمود آخر.
-- مسؤول مسجَّل الدخول من الواجهة لا يستطيع إخفاء كاتب سجل أو معاملة.
--
-- يتطلب: 0002 و0008 و0009 و0012. آمن لإعادة التشغيل (idempotent).
-- ============================================================

-- 1) membership_requests.reviewed_by → ON DELETE SET NULL
do $$
declare
  v_con text;
begin
  select c.conname into v_con
  from pg_constraint c
  where c.conrelid = 'public.membership_requests'::regclass
    and c.confrelid = 'public.profiles'::regclass
    and c.contype = 'f'
    and c.conkey = array[(
      select a.attnum from pg_attribute a
      where a.attrelid = 'public.membership_requests'::regclass and a.attname = 'reviewed_by'
    )];
  if v_con is not null then
    execute format('alter table public.membership_requests drop constraint %I', v_con);
  end if;
  alter table public.membership_requests
    add constraint membership_requests_reviewed_by_fkey
    foreign key (reviewed_by) references public.profiles(id) on delete set null;
end $$;

-- 2) audit_logs: يبقى غير قابل للتعديل، عدا تصفير user_id عند حذف صاحب الحساب
create or replace function public.prevent_audit_log_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null
     and old.user_id is not null
     and new.user_id is null
     and (to_jsonb(new) - 'user_id') = (to_jsonb(old) - 'user_id') then
    return new;
  end if;
  raise exception 'سجلات audit_logs غير قابلة للتعديل';
end;
$$;

-- 3) budget_transactions: السماح بتصفير created_by/voided_by فقط (بلا جلسة مستخدم)
create or replace function public.budget_tx_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null
     and ((old.created_by is not null and new.created_by is null)
          or (old.voided_by is not null and new.voided_by is null))
     and (to_jsonb(new) - 'created_by' - 'voided_by' - 'updated_at')
         = (to_jsonb(old) - 'created_by' - 'voided_by' - 'updated_at') then
    return new;
  end if;

  if old.status = 'voided' then
    raise exception 'لا يمكن تعديل معاملة ملغاة';
  end if;
  if new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'لا يمكن تغيير بيانات الإنشاء';
  end if;
  if new.status = 'voided' then
    new.voided_at := now();
    new.voided_by := auth.uid();
  end if;
  return new;
end;
$$;

-- نفس الحالة لا تُسجَّل في audit_logs كأنها «تعديل معاملة» (ضجيج بلا معنى)
create or replace function public.budget_tx_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_action text;
  v_desc   text;
  v_meta   jsonb;
begin
  if tg_op = 'UPDATE'
     and auth.uid() is null
     and (to_jsonb(new) - 'created_by' - 'voided_by' - 'updated_at')
         = (to_jsonb(old) - 'created_by' - 'voided_by' - 'updated_at') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_action := 'ADMIN_BUDGET_CREATED';
    v_desc   := format('تسجيل %s بمبلغ %s', case new.kind when 'income' then 'إيراد' else 'مصروف' end, new.amount);
    v_meta   := jsonb_build_object('kind', new.kind, 'amount', new.amount, 'tx_date', new.tx_date);
  elsif new.status = 'voided' and old.status <> 'voided' then
    v_action := 'ADMIN_BUDGET_VOIDED';
    v_desc   := format('إلغاء معاملة بمبلغ %s', new.amount);
    v_meta   := jsonb_build_object('amount', new.amount, 'reason', new.void_reason);
  else
    v_action := 'ADMIN_BUDGET_UPDATED';
    v_desc   := format('تعديل معاملة مالية (%s)', new.amount);
    v_meta   := jsonb_build_object(
      'old', jsonb_build_object('kind', old.kind, 'amount', old.amount, 'tx_date', old.tx_date, 'category_id', old.category_id, 'counterparty', old.counterparty, 'description', old.description),
      'new', jsonb_build_object('kind', new.kind, 'amount', new.amount, 'tx_date', new.tx_date, 'category_id', new.category_id, 'counterparty', new.counterparty, 'description', new.description)
    );
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, metadata)
  values (auth.uid(), v_action, 'budget_transactions', new.id, v_desc, v_meta);
  return new;
end;
$$;

-- 4) announcements: created_by يُفرض من الخادم، ويُسمح بتصفيره عند حذف صاحبه فقط
create or replace function public.announcements_before_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    if new.slug is null or btrim(new.slug) = '' then
      new.slug := 'a-' || substr(replace(new.id::text, '-', ''), 1, 12);
    end if;
  else
    if not (auth.uid() is null and old.created_by is not null and new.created_by is null) then
      new.created_by := old.created_by;
    end if;
    new.slug := old.slug; -- الرابط ثابت بعد الإنشاء حتى لا تنكسر الروابط المشاركة
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
