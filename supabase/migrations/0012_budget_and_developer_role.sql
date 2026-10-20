-- ============================================================
-- 0012_budget_and_developer_role.sql
-- دمج تحديثين في ملف واحد:
--   (1) قسم الميزانية: دور أمين المال + جداول المعاملات والفئات + مخزن إيصالات خاص
--       + سجل تدقيق تلقائي من قاعدة البيانات.
--   (2) دور المطوّر (developer): أعلى صلاحية، مع حماية حساباته داخل قاعدة البيانات.
--
-- الصلاحيات:
--  * الميزانية: المطوّر + المسؤول الأعلى (super_admin) + أمين المال (treasurer) فقط.
--    أي دور آخر لا يقرأ ولا يكتب، ولا زوار الموقع.
--  * المطوّر يملك كل ما يملكه المسؤول الأعلى + الأعضاء + المحتوى + الميزانية.
--  * لا يستطيع غير المطوّر إنشاء/تعديل/تعطيل/حذف حساب مطوّر أو الترقية إليه (trigger).
--
-- تصميم مالي:
--  * لا حذف نهائي للمعاملات (لا سياسة DELETE) بل إلغاء (voided) مع سبب إلزامي،
--    والمعاملة الملغاة لا تُعدَّل.
--  * كل إنشاء/تعديل/إلغاء يُسجَّل في audit_logs من داخل قاعدة البيانات
--    مع القيم القديمة والجديدة عند التعديل.
--  * المبالغ numeric(12,2). الإيصالات في bucket خاص وتُقرأ بروابط مؤقتة.
--
-- إضافات/استبدال دوال فقط: لا تُحذف بيانات ولا تُغيَّر جداول قائمة. آمن لإعادة التشغيل.
-- المقارنات بين الأدوار تتم كنص (::text) لتفادي استعمال قيم enum جديدة داخل نفس المعاملة.
-- ============================================================

-- ---------- الدوران الجديدان ----------
alter type admin_role add value if not exists 'treasurer';
alter type admin_role add value if not exists 'developer';

-- ---------- دوال الصلاحيات: المطوّر يشمل كل شيء ----------
create or replace function public.is_developer()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.current_admin_role()::text = 'developer';
$$;

-- is_super_admin تُستعمل في سياسات RLS كثيرة (المستخدمون، الإعدادات، سجل التدقيق...)،
-- فتضمين المطوّر هنا يمنحه كل ما للمسؤول الأعلى دون المساس بأي سياسة.
create or replace function public.is_super_admin()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.current_admin_role()::text in ('super_admin', 'developer');
$$;

create or replace function public.can_manage_members()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.current_admin_role()::text in ('super_admin', 'developer', 'members_manager');
$$;

create or replace function public.can_manage_content()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.current_admin_role()::text in ('super_admin', 'developer', 'editor');
$$;

-- الميزانية: لاستثناء المطوّر منها لاحقًا: احذف 'developer' من هذه القائمة فقط.
create or replace function public.can_manage_budget()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.current_admin_role()::text in ('super_admin', 'developer', 'treasurer');
$$;

revoke execute on function public.is_developer() from public, anon;
grant  execute on function public.is_developer() to authenticated;
revoke execute on function public.can_manage_budget() from public, anon;
grant  execute on function public.can_manage_budget() to authenticated;

-- ---------- الفئات ----------
create table if not exists public.budget_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 2 and 60),
  kind       text not null default 'both' check (kind in ('income', 'expense', 'both')),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_budget_categories_name
  on public.budget_categories (lower(btrim(name)));

-- ---------- المعاملات ----------
create table if not exists public.budget_transactions (
  id           uuid primary key default gen_random_uuid(),
  tx_date      date not null,
  kind         text not null check (kind in ('income', 'expense')),
  amount       numeric(12,2) not null check (amount > 0),
  category_id  uuid references public.budget_categories(id) on delete restrict,
  counterparty text check (counterparty is null or char_length(counterparty) <= 120),
  description  text check (description is null or char_length(description) <= 300),
  receipt_path text check (receipt_path is null or char_length(receipt_path) <= 300),
  status       text not null default 'active' check (status in ('active', 'voided')),
  void_reason  text check (void_reason is null or char_length(void_reason) <= 300),
  voided_at    timestamptz,
  voided_by    uuid references public.profiles(id) on delete set null,
  created_by   uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint budget_void_needs_reason
    check (status = 'active' or (void_reason is not null and char_length(btrim(void_reason)) >= 3))
);
create index if not exists idx_budget_tx_date on public.budget_transactions (tx_date desc);
create index if not exists idx_budget_tx_category on public.budget_transactions (category_id);

drop trigger if exists trg_set_updated_at on public.budget_transactions;
create trigger trg_set_updated_at
  before update on public.budget_transactions
  for each row execute function public.set_updated_at();

-- ---------- حارس التعديل ----------
create or replace function public.budget_tx_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
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

drop trigger if exists trg_budget_tx_guard on public.budget_transactions;
create trigger trg_budget_tx_guard
  before update on public.budget_transactions
  for each row execute function public.budget_tx_guard();

-- ---------- سجل التدقيق التلقائي ----------
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

drop trigger if exists trg_budget_tx_audit on public.budget_transactions;
create trigger trg_budget_tx_audit
  after insert or update on public.budget_transactions
  for each row execute function public.budget_tx_audit();

create or replace function public.budget_category_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, metadata)
  values (
    auth.uid(),
    case tg_op when 'INSERT' then 'ADMIN_BUDGET_CATEGORY_CREATED' else 'ADMIN_BUDGET_CATEGORY_UPDATED' end,
    'budget_categories', new.id,
    format('%s فئة ميزانية: %s', case tg_op when 'INSERT' then 'إضافة' else 'تعديل' end, new.name),
    jsonb_build_object('name', new.name, 'kind', new.kind, 'is_active', new.is_active)
  );
  return new;
end;
$$;

drop trigger if exists trg_budget_category_audit on public.budget_categories;
create trigger trg_budget_category_audit
  after insert or update on public.budget_categories
  for each row execute function public.budget_category_audit();

-- ---------- RLS ----------
alter table public.budget_categories   enable row level security;
alter table public.budget_transactions enable row level security;

revoke all on public.budget_categories   from anon, authenticated;
revoke all on public.budget_transactions from anon, authenticated;
grant select, insert, update on public.budget_categories   to authenticated;
grant select, insert, update on public.budget_transactions to authenticated;

drop policy if exists "budget_categories_select" on public.budget_categories;
drop policy if exists "budget_categories_insert" on public.budget_categories;
drop policy if exists "budget_categories_update" on public.budget_categories;
create policy "budget_categories_select" on public.budget_categories
  for select to authenticated using (public.can_manage_budget());
create policy "budget_categories_insert" on public.budget_categories
  for insert to authenticated with check (public.can_manage_budget());
create policy "budget_categories_update" on public.budget_categories
  for update to authenticated using (public.can_manage_budget()) with check (public.can_manage_budget());

drop policy if exists "budget_tx_select" on public.budget_transactions;
drop policy if exists "budget_tx_insert" on public.budget_transactions;
drop policy if exists "budget_tx_update" on public.budget_transactions;
create policy "budget_tx_select" on public.budget_transactions
  for select to authenticated using (public.can_manage_budget());
create policy "budget_tx_insert" on public.budget_transactions
  for insert to authenticated
  with check (public.can_manage_budget() and created_by = auth.uid() and status = 'active');
create policy "budget_tx_update" on public.budget_transactions
  for update to authenticated using (public.can_manage_budget()) with check (public.can_manage_budget());

-- ---------- مخزن الإيصالات (خاص) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'budget-receipts', 'budget-receipts', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "budget_receipts_select" on storage.objects;
drop policy if exists "budget_receipts_insert" on storage.objects;
create policy "budget_receipts_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'budget-receipts' and public.can_manage_budget());
create policy "budget_receipts_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'budget-receipts' and public.can_manage_budget());
-- لا سياسة update/delete: الإيصال لا يُستبدل ولا يُحذف بعد رفعه.

-- ---------- فئات افتراضية (فقط إن كان الجدول فارغًا) ----------
insert into public.budget_categories (name, kind)
select v.name, v.kind
from (values
  ('اشتراكات الأعضاء', 'income'),
  ('تبرعات', 'income'),
  ('أنشطة وفعاليات', 'expense'),
  ('مطبوعات ولوازم', 'expense'),
  ('خدمات واستضافة', 'expense'),
  ('أخرى', 'both')
) as v(name, kind)
where not exists (select 1 from public.budget_categories);

-- ---------- حماية حسابات المطوّرين ----------
create or replace function public.protect_developer_profiles()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  -- بلا جلسة مستخدم (SQL Editor / service_role / Edge Function): نسمح هنا.
  -- الـ Edge Function تتحقق بنفسها أن المنشئ مطوّر قبل إنشاء حساب مطوّر.
  if auth.uid() is null then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  v_role := public.current_admin_role()::text;

  if tg_op = 'INSERT' then
    if new.role::text = 'developer' and v_role is distinct from 'developer' then
      raise exception 'فقط المطوّر يستطيع إنشاء حساب مطوّر';
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if (old.role::text = 'developer' or new.role::text = 'developer')
       and v_role is distinct from 'developer' then
      raise exception 'فقط المطوّر يستطيع تعديل حسابات المطوّرين';
    end if;
    return new;
  else
    if old.role::text = 'developer' and v_role is distinct from 'developer' then
      raise exception 'فقط المطوّر يستطيع حذف حسابات المطوّرين';
    end if;
    return old;
  end if;
end;
$$;

drop trigger if exists trg_protect_developer_profiles on public.profiles;
create trigger trg_protect_developer_profiles
  before insert or update or delete on public.profiles
  for each row execute function public.protect_developer_profiles();

-- ============================================================
-- تعيين أول مطوّر (نفّذه يدويًا مرة واحدة بعد نجاح ما سبق، بعد تغيير البريد):
--
--   update public.profiles
--      set role = 'developer'
--    where email = 'ضع-بريدك-هنا@example.com';
--
-- (يعمل من SQL Editor لأن الجلسة هناك بلا auth.uid().)
-- ============================================================
