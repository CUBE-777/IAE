-- =====================================================================
-- 0014_membership_flow.sql
-- مسار الانخراط: طلب ← إرسال رابط النموذج ← نموذج مفصّل ← الانخراط السنوي (إيراد + عضو)
--
-- شروط مسبقة: 0001 … 0012 منفَّذة (خصوصاً 0012: أدوار treasurer/developer وجداول الميزانية).
-- الملف آمن لإعادة التنفيذ (idempotent). لا يحذف ولا يعدّل بيانات موجودة.
-- لا يحتاج إلى أي إضافة (extension): الرمز يُولَّد بـ gen_random_uuid والتجزئة بـ sha256 المدمجة.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) فحص الشروط المسبقة (رسالة واضحة بدل فشل غامض)
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.budget_transactions') is null or to_regclass('public.budget_categories') is null then
    raise exception 'نفّذ أولاً 0012_budget_and_developer_role.sql (جداول الميزانية غير موجودة)';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'members' and column_name = 'public_bio') then
    raise exception 'نفّذ أولاً 0010_member_public_profile.sql (أعمدة الملف العام للأعضاء غير موجودة)';
  end if;
  if to_regclass('public.audit_logs') is null then
    raise exception 'نفّذ أولاً 0009_announcements_board_audit.sql (جدول audit_logs غير موجود)';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) دالة الصلاحية: من يستطيع معالجة الانخراط (يشمل أمين المال)
-- ---------------------------------------------------------------------
create or replace function public.can_handle_membership()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.current_admin_role()::text in ('super_admin', 'developer', 'members_manager', 'treasurer');
$$;

-- ---------------------------------------------------------------------
-- 2) حالة النموذج على الطلب (لا نمسّ enum request_status)
-- ---------------------------------------------------------------------
alter table public.membership_requests
  add column if not exists form_status text not null default 'none';

alter table public.membership_requests
  drop constraint if exists membership_requests_form_status_chk;
alter table public.membership_requests
  add constraint membership_requests_form_status_chk check (form_status in ('none', 'sent', 'received'));

-- أمين المال يقرأ الطلبات (سياسات القراءة الحالية تبقى كما هي؛ السياسات تُجمع بـ OR)
drop policy if exists "membership_requests_handler_read" on public.membership_requests;
create policy "membership_requests_handler_read"
  on public.membership_requests for select
  to authenticated
  using (public.can_handle_membership());

-- ---------------------------------------------------------------------
-- 3) نماذج الانخراط (خاصة: لا وصول عام، الكتابة عبر الدوال فقط)
-- ---------------------------------------------------------------------
create table if not exists public.membership_forms (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null unique references public.membership_requests(id) on delete cascade,
  token_hash   text not null unique,                       -- sha256 للرمز؛ الرمز نفسه لا يُخزَّن أبداً
  expires_at   timestamptz not null,
  sent_by      uuid references public.profiles(id) on delete set null,
  sent_at      timestamptz not null default now(),
  submitted_at timestamptz,
  data         jsonb not null default '{}'::jsonb,
  constraint membership_forms_data_chk check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 20000)
);

alter table public.membership_forms enable row level security;

drop policy if exists "membership_forms_handler_read" on public.membership_forms;
create policy "membership_forms_handler_read"
  on public.membership_forms for select
  to authenticated
  using (public.can_handle_membership());

revoke all on public.membership_forms from anon, authenticated;
grant select on public.membership_forms to authenticated;

-- ---------------------------------------------------------------------
-- 4) بيانات العضو الخاصة (تاريخ الميلاد، الطوارئ…) — للإدارة فقط
-- ---------------------------------------------------------------------
create table if not exists public.member_private (
  member_id          uuid primary key references public.members(id) on delete cascade,
  birth_date         date,
  level              text,
  skills             text,
  interests          text,
  emergency_name     text,
  emergency_phone    text,
  emergency_relation text,
  rules_accepted_at  timestamptz,
  form_data          jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint member_private_form_chk check (jsonb_typeof(form_data) = 'object' and pg_column_size(form_data) <= 20000)
);

alter table public.member_private enable row level security;

drop policy if exists "member_private_manager_read" on public.member_private;
create policy "member_private_manager_read"
  on public.member_private for select
  to authenticated
  using (public.can_manage_members());

drop policy if exists "member_private_manager_update" on public.member_private;
create policy "member_private_manager_update"
  on public.member_private for update
  to authenticated
  using (public.can_manage_members())
  with check (public.can_manage_members());

revoke all on public.member_private from anon, authenticated;
grant select, update on public.member_private to authenticated;

-- ---------------------------------------------------------------------
-- 5) عضويات المواسم (واحدة لكل عضو في كل موسم)
-- ---------------------------------------------------------------------
create table if not exists public.member_memberships (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references public.members(id) on delete cascade,
  season         text not null check (char_length(btrim(season)) between 4 and 20),
  amount         numeric(12,2) not null check (amount > 0),
  paid_at        date not null default current_date,
  transaction_id uuid references public.budget_transactions(id) on delete set null,
  created_by     uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  constraint member_memberships_unique_season unique (member_id, season)
);

alter table public.member_memberships enable row level security;

drop policy if exists "member_memberships_handler_read" on public.member_memberships;
create policy "member_memberships_handler_read"
  on public.member_memberships for select
  to authenticated
  using (public.can_handle_membership());

revoke all on public.member_memberships from anon, authenticated;
grant select on public.member_memberships to authenticated;

-- ---------------------------------------------------------------------
-- 6) إعدادات: مبلغ الانخراط والموسم الحالي (يُضبطان من صفحة الإعدادات)
-- ---------------------------------------------------------------------
insert into public.site_settings (key, value)
values ('membership_fee', ''), ('current_season', '')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 7) الدوال
-- ---------------------------------------------------------------------

-- 7.1 إصدار رابط النموذج (للمسؤول). يُعيد الرمز مرة واحدة فقط؛ إعادة الإصدار تُبطل الرابط السابق.
create or replace function public.issue_membership_form(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req     public.membership_requests%rowtype;
  v_token   text;
  v_expires timestamptz := now() + interval '7 days';
begin
  if auth.uid() is null or not public.can_manage_members() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;

  select * into v_req from public.membership_requests where id = p_request_id for update;
  if not found then
    raise exception 'الطلب غير موجود';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'تمت معالجة هذا الطلب مسبقاً';
  end if;
  if v_req.form_status = 'received' then
    raise exception 'تم استلام النموذج مسبقاً';
  end if;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  insert into public.membership_forms (request_id, token_hash, expires_at, sent_by)
  values (p_request_id, encode(sha256(convert_to(v_token, 'utf8')), 'hex'), v_expires, auth.uid())
  on conflict (request_id) do update
    set token_hash = excluded.token_hash,
        expires_at = excluded.expires_at,
        sent_by    = excluded.sent_by,
        sent_at    = now()
    where public.membership_forms.submitted_at is null;

  update public.membership_requests set form_status = 'sent' where id = p_request_id;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, metadata)
  values (auth.uid(), 'ADMIN_SENT_MEMBERSHIP_FORM', 'membership_requests', p_request_id,
          'إصدار رابط نموذج الانخراط', jsonb_build_object('expires_at', v_expires));

  return jsonb_build_object('token', v_token, 'expires_at', v_expires);
end;
$$;

-- 7.2 قراءة حالة النموذج بواسطة الرمز (للزائر)
create or replace function public.get_membership_form(p_token text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_form public.membership_forms%rowtype;
  v_req  public.membership_requests%rowtype;
  v_fee  text;
  v_season text;
begin
  select * into v_form
  from public.membership_forms
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex');

  if not found then
    return jsonb_build_object('state', 'invalid');
  end if;

  select * into v_req from public.membership_requests where id = v_form.request_id;

  if v_form.submitted_at is not null then
    return jsonb_build_object('state', 'submitted');
  end if;
  if v_req.status <> 'pending' then
    return jsonb_build_object('state', 'closed');
  end if;
  if v_form.expires_at < now() then
    return jsonb_build_object('state', 'expired');
  end if;

  select value into v_fee from public.site_settings where key = 'membership_fee';
  select value into v_season from public.site_settings where key = 'current_season';

  return jsonb_build_object(
    'state', 'ok',
    'expires_at', v_form.expires_at,
    'fee', nullif(btrim(coalesce(v_fee, '')), ''),
    'season', nullif(btrim(coalesce(v_season, '')), ''),
    'prefill', jsonb_build_object(
      'full_name', v_req.full_name,
      'email', v_req.email,
      'phone', v_req.phone,
      'promotion', v_req.promotion,
      'track', v_req.track,
      'profession', v_req.profession,
      'city', v_req.city
    )
  );
end;
$$;

-- 7.3 إرسال النموذج (للزائر): تحقق + تنظيف + تخزين، مرة واحدة فقط
create or replace function public.submit_membership_form(p_token text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_form  public.membership_forms%rowtype;
  v_req   public.membership_requests%rowtype;
  v_clean jsonb;
  v_birth date;
  v_github text;
  v_linkedin text;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'بيانات غير صالحة';
  end if;

  select * into v_form
  from public.membership_forms
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex')
  for update;

  if not found then raise exception 'الرابط غير صالح'; end if;
  if v_form.submitted_at is not null then raise exception 'تم إرسال هذا النموذج مسبقاً'; end if;
  if v_form.expires_at < now() then raise exception 'انتهت صلاحية الرابط'; end if;

  select * into v_req from public.membership_requests where id = v_form.request_id for update;
  if v_req.status <> 'pending' then raise exception 'هذا الطلب مغلق'; end if;

  -- الموافقة على النظام الداخلي إلزامية
  if coalesce(p_data->>'rules_accepted', '') <> 'true' then
    raise exception 'يجب الموافقة على النظام الداخلي';
  end if;

  -- تاريخ الميلاد
  begin
    v_birth := (p_data->>'birth_date')::date;
  exception when others then
    raise exception 'تاريخ الميلاد غير صالح';
  end;
  if v_birth is null or v_birth < date '1940-01-01' or v_birth > (current_date - interval '10 years')::date then
    raise exception 'تاريخ الميلاد غير صالح';
  end if;

  -- روابط اختيارية: يجب أن تبدأ بـ http(s)
  v_github := nullif(left(btrim(coalesce(p_data->>'github', '')), 200), '');
  v_linkedin := nullif(left(btrim(coalesce(p_data->>'linkedin', '')), 200), '');
  if v_github is not null and v_github !~* '^https?://' then v_github := 'https://' || v_github; end if;
  if v_linkedin is not null and v_linkedin !~* '^https?://' then v_linkedin := 'https://' || v_linkedin; end if;

  v_clean := jsonb_strip_nulls(jsonb_build_object(
    'full_name',          nullif(left(btrim(coalesce(p_data->>'full_name', '')), 120), ''),
    'birth_date',         to_char(v_birth, 'YYYY-MM-DD'),
    'phone',              nullif(left(btrim(coalesce(p_data->>'phone', '')), 30), ''),
    'email',              nullif(left(btrim(coalesce(p_data->>'email', '')), 150), ''),
    'city',               nullif(left(btrim(coalesce(p_data->>'city', '')), 80), ''),
    'university',         nullif(left(btrim(coalesce(p_data->>'university', '')), 150), ''),
    'track',              nullif(left(btrim(coalesce(p_data->>'track', '')), 150), ''),
    'level',              nullif(left(btrim(coalesce(p_data->>'level', '')), 80), ''),
    'promotion',          nullif(left(btrim(coalesce(p_data->>'promotion', '')), 40), ''),
    'profession',         nullif(left(btrim(coalesce(p_data->>'profession', '')), 120), ''),
    'skills',             nullif(left(btrim(coalesce(p_data->>'skills', '')), 600), ''),
    'interests',          nullif(left(btrim(coalesce(p_data->>'interests', '')), 600), ''),
    'github',             v_github,
    'linkedin',           v_linkedin,
    'bio',                nullif(left(btrim(coalesce(p_data->>'bio', '')), 600), ''),
    'emergency_name',     nullif(left(btrim(coalesce(p_data->>'emergency_name', '')), 120), ''),
    'emergency_phone',    nullif(left(btrim(coalesce(p_data->>'emergency_phone', '')), 30), ''),
    'emergency_relation', nullif(left(btrim(coalesce(p_data->>'emergency_relation', '')), 60), ''),
    'rules_accepted',     true
  ));

  -- الحقول الإلزامية
  if (v_clean->>'full_name') is null or char_length(v_clean->>'full_name') < 2
     or (v_clean->>'phone') is null or char_length(v_clean->>'phone') < 6
     or (v_clean->>'city') is null
     or (v_clean->>'university') is null
     or (v_clean->>'track') is null
     or (v_clean->>'level') is null
     or (v_clean->>'emergency_name') is null
     or (v_clean->>'emergency_phone') is null
     or (v_clean->>'emergency_relation') is null then
    raise exception 'يرجى ملء جميع الحقول الإلزامية';
  end if;

  update public.membership_forms
     set data = v_clean, submitted_at = now()
   where id = v_form.id;

  update public.membership_requests
     set form_status = 'received'
   where id = v_form.request_id;

  return jsonb_build_object('state', 'ok');
end;
$$;

-- 7.4 الانخراط السنوي: إنشاء/تجديد العضوية + تسجيل الإيراد في الميزانية (معاملة واحدة)
--     * p_request_id: طلب جديد استُلم نموذجه ← ينشئ العضو ويقبل الطلب
--     * p_member_id : عضو موجود ← تجديد للموسم الحالي
create or replace function public.record_annual_membership(
  p_request_id uuid default null,
  p_member_id  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fee_text  text;
  v_amount    numeric(12,2);
  v_season    text;
  v_category  uuid;
  v_req       public.membership_requests%rowtype;
  v_form      public.membership_forms%rowtype;
  v_data      jsonb;
  v_member_id uuid;
  v_name      text;
  v_tx_id     uuid;
  v_items     jsonb := '[]'::jsonb;
  v_items_fr  jsonb := '[]'::jsonb;
  v_items_en  jsonb := '[]'::jsonb;
  v_socials   jsonb := '{}'::jsonb;
begin
  if auth.uid() is null or not public.can_handle_membership() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;
  if (p_request_id is null) = (p_member_id is null) then
    raise exception 'حدّد طلباً أو عضواً (واحداً فقط)';
  end if;

  -- المبلغ والموسم من الإعدادات
  select value into v_fee_text from public.site_settings where key = 'membership_fee';
  begin
    v_amount := nullif(btrim(coalesce(v_fee_text, '')), '')::numeric(12,2);
  exception when others then
    v_amount := null;
  end;
  if v_amount is null or v_amount <= 0 then
    raise exception 'لم يُضبط مبلغ الانخراط السنوي في الإعدادات';
  end if;

  select nullif(btrim(value), '') into v_season from public.site_settings where key = 'current_season';
  if v_season is null then
    raise exception 'لم يُضبط الموسم الجامعي الحالي في الإعدادات';
  end if;

  -- فئة الميزانية «انخراطات»
  select id into v_category from public.budget_categories where name = 'انخراطات' limit 1;
  if v_category is null then
    insert into public.budget_categories (name, kind) values ('انخراطات', 'income') returning id into v_category;
  end if;

  if p_request_id is not null then
    -- ===== طلب جديد =====
    select * into v_req from public.membership_requests where id = p_request_id for update;
    if not found then raise exception 'الطلب غير موجود'; end if;
    if v_req.status <> 'pending' then raise exception 'تمت معالجة هذا الطلب مسبقاً'; end if;

    select * into v_form from public.membership_forms where request_id = p_request_id for update;
    if not found or v_form.submitted_at is null then
      raise exception 'لم يُستلم نموذج الانخراط بعد';
    end if;
    v_data := v_form.data;

    if coalesce(v_data->>'skills', '') <> '' then
      v_items    := v_items    || jsonb_build_array(jsonb_build_object('label', 'المهارات',   'value', v_data->>'skills'));
      v_items_fr := v_items_fr || jsonb_build_array(jsonb_build_object('label', 'Compétences', 'value', v_data->>'skills'));
      v_items_en := v_items_en || jsonb_build_array(jsonb_build_object('label', 'Skills',      'value', v_data->>'skills'));
    end if;
    if coalesce(v_data->>'interests', '') <> '' then
      v_items    := v_items    || jsonb_build_array(jsonb_build_object('label', 'الاهتمامات',    'value', v_data->>'interests'));
      v_items_fr := v_items_fr || jsonb_build_array(jsonb_build_object('label', 'Centres d''intérêt', 'value', v_data->>'interests'));
      v_items_en := v_items_en || jsonb_build_array(jsonb_build_object('label', 'Interests',     'value', v_data->>'interests'));
    end if;
    if coalesce(v_data->>'level', '') <> '' then
      v_items    := v_items    || jsonb_build_array(jsonb_build_object('label', 'المستوى الدراسي', 'value', v_data->>'level'));
      v_items_fr := v_items_fr || jsonb_build_array(jsonb_build_object('label', 'Niveau d''études', 'value', v_data->>'level'));
      v_items_en := v_items_en || jsonb_build_array(jsonb_build_object('label', 'Study level',     'value', v_data->>'level'));
    end if;

    v_socials := jsonb_strip_nulls(jsonb_build_object(
      'github', nullif(v_data->>'github', ''),
      'linkedin', nullif(v_data->>'linkedin', '')
    ));

    insert into public.members (
      full_name, email, phone, promotion, track, university, profession, city,
      public_bio, socials, extra, status
    ) values (
      coalesce(v_data->>'full_name', v_req.full_name),
      coalesce(v_data->>'email', v_req.email),
      coalesce(v_data->>'phone', v_req.phone),
      coalesce(v_data->>'promotion', v_req.promotion),
      coalesce(v_data->>'track', v_req.track),
      v_data->>'university',
      coalesce(v_data->>'profession', v_req.profession),
      coalesce(v_data->>'city', v_req.city),
      v_data->>'bio',
      v_socials,
      jsonb_build_object('items', v_items),
      'active'
    )
    returning id, full_name into v_member_id, v_name;

    -- ترجمات التسميات (FR/EN) إن كان عمود translations موجوداً (migration 0011)
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'members' and column_name = 'translations') then
      execute 'update public.members set translations = $1 where id = $2'
        using jsonb_build_object(
          'fr', jsonb_build_object('extra', v_items_fr),
          'en', jsonb_build_object('extra', v_items_en)
        ), v_member_id;
    end if;

    insert into public.member_private (
      member_id, birth_date, level, skills, interests,
      emergency_name, emergency_phone, emergency_relation, rules_accepted_at, form_data
    ) values (
      v_member_id, (v_data->>'birth_date')::date, v_data->>'level', v_data->>'skills', v_data->>'interests',
      v_data->>'emergency_name', v_data->>'emergency_phone', v_data->>'emergency_relation', now(), v_data
    );

    update public.membership_requests
       set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
     where id = p_request_id;
  else
    -- ===== تجديد عضو موجود =====
    select id, full_name into v_member_id, v_name
    from public.members
    where id = p_member_id and deleted_at is null;
    if not found then raise exception 'العضو غير موجود'; end if;
  end if;

  -- منع التكرار في نفس الموسم (قبل إنشاء الإيراد)
  if exists (select 1 from public.member_memberships where member_id = v_member_id and season = v_season) then
    raise exception 'تم تسجيل انخراط هذا العضو في هذا الموسم مسبقاً';
  end if;

  insert into public.budget_transactions (tx_date, kind, amount, category_id, counterparty, description)
  values (current_date, 'income', v_amount, v_category, left(v_name, 120),
          left('انخراط سنوي — موسم ' || v_season, 300))
  returning id into v_tx_id;

  insert into public.member_memberships (member_id, season, amount, transaction_id)
  values (v_member_id, v_season, v_amount, v_tx_id);

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, metadata)
  values (auth.uid(), 'ADMIN_RECORDED_MEMBERSHIP', 'members', v_member_id,
          'تسجيل انخراط سنوي',
          jsonb_build_object('season', v_season, 'amount', v_amount, 'transaction_id', v_tx_id, 'request_id', p_request_id));

  return jsonb_build_object('member_id', v_member_id, 'transaction_id', v_tx_id, 'season', v_season, 'amount', v_amount);
end;
$$;

-- 7.5 أعضاء لم يجدّدوا في الموسم الحالي (حقول محدودة فقط، لأمين المال أيضاً)
create or replace function public.list_members_for_renewal()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_season text;
begin
  if auth.uid() is null or not public.can_handle_membership() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;
  select nullif(btrim(value), '') into v_season from public.site_settings where key = 'current_season';

  return coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'full_name', m.full_name, 'phone', m.phone, 'email', m.email)
                     order by m.full_name)
    from public.members m
    where m.deleted_at is null
      and m.status = 'active'
      and (v_season is null or not exists (
        select 1 from public.member_memberships mm where mm.member_id = m.id and mm.season = v_season))
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- 8) صلاحيات التنفيذ
-- ---------------------------------------------------------------------
revoke all on function public.issue_membership_form(uuid) from public, anon;
revoke all on function public.record_annual_membership(uuid, uuid) from public, anon;
revoke all on function public.list_members_for_renewal() from public, anon;
revoke all on function public.can_handle_membership() from public, anon;
grant execute on function public.issue_membership_form(uuid) to authenticated;
grant execute on function public.record_annual_membership(uuid, uuid) to authenticated;
grant execute on function public.list_members_for_renewal() to authenticated;
grant execute on function public.can_handle_membership() to authenticated;

revoke all on function public.get_membership_form(text) from public;
revoke all on function public.submit_membership_form(text, jsonb) from public;
grant execute on function public.get_membership_form(text) to anon, authenticated;
grant execute on function public.submit_membership_form(text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
