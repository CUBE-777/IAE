-- ============================================================
-- 0036_member_space_activation_and_card_requests.sql — «فضاء المنخرطين» (المرحلة 3: القاعدة)
--
-- ما يضيفه (إضافة فقط؛ لا يُعدَّل أي جدول أو دالة أو سياسة موجودة):
--   1) member_activation_links  : رابط تفعيل شخصي لكل عضو (رمز مُجزَّأ، صالح 7 أيام، يُستعمل مرة واحدة).
--   2) member_card_requests     : طلبات تعديل «بطاقة العضو» العامة. لا يُنشر شيء قبل موافقة الإدارة.
--   3) دوال المسؤول  : issue_member_activation_link / approve_member_card_request / reject_member_card_request
--   4) دوال الزائر   : get_member_activation_link (للتحقق من الرابط فقط).
--   5) دوال Edge Function فقط (service_role): prepare_member_activation / finalize_member_activation.
--   6) دوال العضو    : get_my_member / update_my_member_private / submit_member_card_request / cancel_my_member_card_request.
--   7) تخزين: يرفع العضو صورة مقترحة إلى المجلد الخاص member-<id>/ في bucket الخاص membership-docs.
--
-- قرارات التصميم:
--   * العضو لا يكتب في members أبدًا مباشرة: كل شيء عبر دوال SECURITY DEFINER بقائمة بيضاء من الحقول.
--   * الحقول الخاصة (الهاتف/المدينة/المهنة) يعدّلها العضو فورًا؛ حقول البطاقة العامة تمر بمراجعة الإدارة.
--   * إيقاف الظهور في دليل الأعضاء (show_in_directory = false) فوري لأنه سحب موافقة؛ أما التفعيل فيمر بالمراجعة.
--   * عمود members.bio خاص بالإدارة (0007) فلا يمكن للعضو تغييره ولا يُنسخ من الطلب.
--   * اسم العضو (full_name) والبريد لا يغيّرهما العضو.
--
-- يتطلب: 0007 و0011 و0020 و0024 و0030 و0031 (دوال _bp_*) و0035.   آمن لإعادة التشغيل (idempotent).
-- ⚠️ تجربة جافة أولًا: استبدل `commit;` الأخيرة بـ `rollback;` ثم شغّله، وإن نجح أعدها `commit;`.
-- ⚠️ الرجوع: supabase/rollback/0036_member_space_down.sql
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.member_accounts') is null then
    raise exception 'شغّل 0035_member_accounts.sql أولاً';
  end if;
  if to_regprocedure('public._bp_clean(jsonb)') is null then
    raise exception 'شغّل 0031_board_profile_links.sql أولاً';
  end if;
  if not exists (select 1 from storage.buckets where id = 'membership-docs') then
    raise exception 'شغّل 0020_membership_documents.sql أولاً';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'members' and column_name = 'show_in_directory') then
    raise exception 'شغّل 0030_directory_consent_and_latin_name.sql أولاً';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) جدول روابط التفعيل (خاص تمامًا: لا وصول مباشر لأي عميل)
-- ---------------------------------------------------------------------
create table if not exists public.member_activation_links (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null unique references public.members(id) on delete cascade,
  token_hash text not null unique,                 -- sha256 للرمز؛ الرمز نفسه لا يُخزَّن أبدًا
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.member_activation_links enable row level security;
revoke all on public.member_activation_links from public, anon, authenticated;
-- لا سياسات: الوصول عبر الدوال فقط.

-- ---------------------------------------------------------------------
-- 2) جدول طلبات تعديل البطاقة
-- ---------------------------------------------------------------------
create table if not exists public.member_card_requests (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  data        jsonb not null default '{}'::jsonb,   -- المقترح بعد التنظيف
  photo_path  text,                                  -- مسار الصورة المقترحة في membership-docs (خاص)
  review_note text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  constraint member_card_requests_data_chk check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 30000),
  constraint member_card_requests_note_chk check (review_note is null or char_length(review_note) <= 500)
);

-- طلب واحد قيد الانتظار لكل عضو
create unique index if not exists idx_member_card_requests_one_pending
  on public.member_card_requests (member_id) where status = 'pending';
create index if not exists idx_member_card_requests_status
  on public.member_card_requests (status, created_at desc);

alter table public.member_card_requests enable row level security;
revoke all on public.member_card_requests from public, anon, authenticated;
grant select on public.member_card_requests to authenticated;

drop policy if exists "member_card_requests_own_read" on public.member_card_requests;
create policy "member_card_requests_own_read" on public.member_card_requests
  for select to authenticated
  using (member_id = public.current_member_id());

drop policy if exists "member_card_requests_manager_read" on public.member_card_requests;
create policy "member_card_requests_manager_read" on public.member_card_requests
  for select to authenticated
  using (public.can_manage_member_system());

drop trigger if exists trg_set_updated_at on public.member_card_requests;
create trigger trg_set_updated_at
  before update on public.member_card_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 3) إصدار رابط التفعيل (للمسؤول)
-- ---------------------------------------------------------------------
create or replace function public.issue_member_activation_link(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_m       public.members%rowtype;
  v_token   text;
  v_hash    text;
  v_expires timestamptz := now() + interval '7 days';
begin
  if auth.uid() is null or not public.can_manage_member_system() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;

  select * into v_m from public.members where id = p_member_id and deleted_at is null;
  if not found then raise exception 'العضو غير موجود'; end if;
  if v_m.status <> 'active' then raise exception 'العضو غير نشط'; end if;
  if v_m.email is null or btrim(v_m.email) = '' then
    raise exception 'لا يوجد بريد إلكتروني لهذا العضو؛ أضفه أولًا لأنه سيكون اسم الدخول';
  end if;
  if exists (select 1 from public.member_accounts where member_id = p_member_id) then
    raise exception 'لهذا العضو حساب مفعّل بالفعل';
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = lower(btrim(v_m.email))) then
    raise exception 'هذا البريد مسجّل مسبقًا كحساب آخر؛ غيّر بريد العضو أو احذف الحساب القديم';
  end if;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_hash  := encode(sha256(convert_to(v_token, 'utf8')), 'hex');

  insert into public.member_activation_links (member_id, token_hash, expires_at, created_by)
  values (p_member_id, v_hash, v_expires, auth.uid())
  on conflict (member_id) do update
     set token_hash = excluded.token_hash, expires_at = excluded.expires_at,
         used_at = null, created_by = excluded.created_by, created_at = now();

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, metadata)
  values (auth.uid(), 'ADMIN_ISSUED_MEMBER_ACTIVATION_LINK', 'members', p_member_id,
          'إصدار رابط تفعيل حساب فضاء المنخرطين للعضو ' || v_m.full_name,
          jsonb_build_object('expires_at', v_expires));

  return jsonb_build_object('token', v_token, 'expires_at', v_expires);
end;
$$;

-- ---------------------------------------------------------------------
-- 4) التحقق من الرابط (للزائر حامل الرمز): اسم العضو وبريد مُقنَّع فقط
-- ---------------------------------------------------------------------
create or replace function public.get_member_activation_link(p_token text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_l public.member_activation_links%rowtype;
  v_m public.members%rowtype;
  v_local  text;
  v_domain text;
begin
  select * into v_l from public.member_activation_links
   where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex');
  if not found then return jsonb_build_object('valid', false, 'reason', 'invalid'); end if;
  if v_l.used_at is not null then return jsonb_build_object('valid', false, 'reason', 'used'); end if;
  if v_l.expires_at < now() then return jsonb_build_object('valid', false, 'reason', 'expired'); end if;

  select * into v_m from public.members where id = v_l.member_id and deleted_at is null;
  if not found then return jsonb_build_object('valid', false, 'reason', 'invalid'); end if;

  v_local  := split_part(v_m.email, '@', 1);
  v_domain := split_part(v_m.email, '@', 2);
  return jsonb_build_object(
    'valid', true,
    'full_name', v_m.full_name,
    'email_hint', left(v_local, 1) || repeat('*', greatest(char_length(v_local) - 1, 2)) || '@' || v_domain,
    'expires_at', v_l.expires_at
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 5) دوال الـ Edge Function (service_role فقط)
-- ---------------------------------------------------------------------
create or replace function public.prepare_member_activation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_l public.member_activation_links%rowtype;
  v_m public.members%rowtype;
begin
  select * into v_l from public.member_activation_links
   where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex');
  if not found or v_l.used_at is not null or v_l.expires_at < now() then
    raise exception 'activation_link_invalid';
  end if;
  select * into v_m from public.members where id = v_l.member_id and deleted_at is null and status = 'active';
  if not found then raise exception 'activation_link_invalid'; end if;
  if v_m.email is null or btrim(v_m.email) = '' then raise exception 'activation_link_invalid'; end if;
  if exists (select 1 from public.member_accounts where member_id = v_m.id) then
    raise exception 'activation_link_invalid';
  end if;
  return jsonb_build_object('member_id', v_m.id, 'email', lower(btrim(v_m.email)));
end;
$$;

create or replace function public.finalize_member_activation(p_token text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_l public.member_activation_links%rowtype;
begin
  select * into v_l from public.member_activation_links
   where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex')
   for update;
  if not found or v_l.used_at is not null or v_l.expires_at < now() then
    raise exception 'activation_link_invalid';
  end if;

  -- مشغّل الحماية في 0035 يرفض مستخدمًا له profiles أو عضوًا محذوفًا
  insert into public.member_accounts (user_id, member_id, must_change_password)
  values (p_user_id, v_l.member_id, false);   -- اختار كلمة مروره بنفسه أثناء التفعيل

  update public.member_activation_links set used_at = now() where id = v_l.id;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
  values (null, 'MEMBER_ACTIVATED_ACCOUNT', 'members', v_l.member_id, 'تفعيل حساب فضاء المنخرطين');
end;
$$;

-- ---------------------------------------------------------------------
-- 6) دوال العضو
-- ---------------------------------------------------------------------

-- 6.أ) ملفي: كل ما يخص العضو الحالي (بما فيه الحقول الخاصة به) + حالة طلب التعديل
create or replace function public.get_my_member()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_id  uuid := public.current_member_id();
  v_m   public.members%rowtype;
  v_req public.member_card_requests%rowtype;
begin
  if auth.uid() is null or v_id is null then return null; end if;
  select * into v_m from public.members where id = v_id;
  if not found then return null; end if;

  select * into v_req from public.member_card_requests
   where member_id = v_id order by created_at desc limit 1;

  return jsonb_build_object(
    'id', v_m.id,
    'full_name', v_m.full_name,
    'email', v_m.email,
    'photo_url', v_m.photo_url,
    'promotion', v_m.promotion,
    'track', v_m.track,
    'university', v_m.university,
    'profession', v_m.profession,
    'city', v_m.city,
    'phone', v_m.phone,
    'status', v_m.status,
    'public_bio', v_m.public_bio,
    'study_path', v_m.study_path,
    'socials', v_m.socials,
    'extra', v_m.extra,
    'translations', v_m.translations,
    'show_in_directory', v_m.show_in_directory,
    'latest_request', case when v_req.id is null then null else jsonb_build_object(
      'id', v_req.id, 'status', v_req.status, 'data', v_req.data,
      'photo_path', v_req.photo_path, 'review_note', v_req.review_note,
      'created_at', v_req.created_at, 'reviewed_at', v_req.reviewed_at) end
  );
end;
$$;

-- 6.ب) الحقول الخاصة: تُعدَّل فورًا (لا تظهر للزوار). + إيقاف الظهور في الدليل فورًا.
create or replace function public.update_my_member_private(p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id    uuid := public.current_member_id();
  v_phone text;
  v_city  text;
  v_prof  text;
begin
  if auth.uid() is null or v_id is null then raise exception 'غير مصرّح لك بهذه العملية'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'بيانات غير صالحة'; end if;

  if p_data ? 'phone' then
    v_phone := public._bp_text(p_data -> 'phone', 20);
    if v_phone is not null and v_phone !~ '^\+?[0-9 ()-]{6,20}$' then
      raise exception 'رقم الهاتف غير صالح';
    end if;
    update public.members set phone = coalesce(v_phone, phone) where id = v_id;  -- الهاتف إلزامي في سجلات الانخراط: لا نمسحه
  end if;
  if p_data ? 'city' then
    v_city := public._bp_text(p_data -> 'city', 100);
    update public.members set city = v_city where id = v_id;
  end if;
  if p_data ? 'profession' then
    v_prof := public._bp_text(p_data -> 'profession', 150);
    update public.members set profession = v_prof where id = v_id;
  end if;
  -- سحب الموافقة على الظهور العلني فوري؛ التفعيل لا يتم إلا عبر طلب تعديل تعتمده الإدارة
  if p_data ? 'hide_from_directory' and p_data ->> 'hide_from_directory' = 'true' then
    update public.members set show_in_directory = false where id = v_id;
  end if;
end;
$$;

-- 6.ج) إرسال طلب تعديل البطاقة (يستبدل أي طلب قيد الانتظار)
create or replace function public.submit_member_card_request(p_data jsonb, p_photo_path text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id     uuid := public.current_member_id();
  v_clean  jsonb;
  v_lang   text;
  v_tr     jsonb;
  v_lobj   jsonb;
  v_prof   text;
  v_req_id uuid;
begin
  if auth.uid() is null or v_id is null then raise exception 'غير مصرّح لك بهذه العملية'; end if;

  if (select count(*) from public.member_card_requests
       where member_id = v_id and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'rate_limited';
  end if;

  v_clean := public._bp_clean(p_data);
  -- members.bio خاصة بالإدارة (0007): تُحذف من المقترح ومن ترجماته
  v_clean := v_clean - 'bio';
  v_tr := coalesce(v_clean -> 'translations', '{}'::jsonb);
  foreach v_lang in array array['fr', 'en'] loop
    if jsonb_typeof(v_tr -> v_lang) = 'object' then
      v_lobj := (v_tr -> v_lang) - 'bio';
      v_tr := case when v_lobj = '{}'::jsonb then v_tr - v_lang else v_tr || jsonb_build_object(v_lang, v_lobj) end;
    end if;
  end loop;
  v_clean := v_clean || jsonb_build_object('translations', v_tr);

  -- المهنة تظهر على البطاقة (0007) فتمر بالمراجعة أيضًا
  if p_data ? 'profession' then
    v_prof := public._bp_text(p_data -> 'profession', 150);
    if v_prof is not null then v_clean := v_clean || jsonb_build_object('profession', v_prof); end if;
  end if;
  -- رغبة العضو في الظهور في دليل الأعضاء: تُطبَّق عند الموافقة فقط
  if p_data ? 'show_in_directory' and jsonb_typeof(p_data -> 'show_in_directory') = 'boolean' then
    v_clean := v_clean || jsonb_build_object('show_in_directory', p_data -> 'show_in_directory');
  end if;

  if p_photo_path is not null then
    if p_photo_path !~ ('^member-' || v_id::text || '/photo-[0-9a-f]{8,32}\.(webp|jpg|png)$') then
      raise exception 'مسار الصورة غير صالح';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'membership-docs' and name = p_photo_path) then
      raise exception 'الصورة غير مرفوعة';
    end if;
  end if;

  select id into v_req_id from public.member_card_requests where member_id = v_id and status = 'pending' for update;
  if found then
    update public.member_card_requests
       set data = v_clean, photo_path = p_photo_path, review_note = null
     where id = v_req_id;
  else
    insert into public.member_card_requests (member_id, data, photo_path)
    values (v_id, v_clean, p_photo_path)
    returning id into v_req_id;
  end if;
  return v_req_id;
end;
$$;

create or replace function public.cancel_my_member_card_request()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := public.current_member_id();
begin
  if auth.uid() is null or v_id is null then raise exception 'غير مصرّح لك بهذه العملية'; end if;
  update public.member_card_requests set status = 'cancelled'
   where member_id = v_id and status = 'pending';
end;
$$;

-- ---------------------------------------------------------------------
-- 7) مراجعة الإدارة
-- ---------------------------------------------------------------------
create or replace function public.approve_member_card_request(p_request_id uuid, p_photo_url text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r     public.member_card_requests%rowtype;
  v_m     public.members%rowtype;
  v_d     jsonb;
  v_tr    jsonb;
  v_new   jsonb;
  v_lang  text;
  v_lobj  jsonb;
  v_extra jsonb;
begin
  if auth.uid() is null or not public.can_manage_member_system() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;

  select * into v_r from public.member_card_requests where id = p_request_id for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if v_r.status <> 'pending' then raise exception 'لا يوجد طلب قيد المراجعة'; end if;

  select * into v_m from public.members where id = v_r.member_id and deleted_at is null for update;
  if not found then raise exception 'العضو غير موجود'; end if;

  if p_photo_url is not null and p_photo_url !~ '^https://[^[:space:]]{8,500}$' then
    raise exception 'رابط الصورة غير صالح';
  end if;

  v_d := v_r.data;

  v_tr  := coalesce(v_m.translations, '{}'::jsonb) - 'name_latin';
  v_new := coalesce(v_d -> 'translations', '{}'::jsonb);
  if v_new ? 'name_latin' then
    v_tr := v_tr || jsonb_build_object('name_latin', v_new -> 'name_latin');
  elsif coalesce(v_m.translations, '{}'::jsonb) ? 'name_latin' then
    v_tr := v_tr || jsonb_build_object('name_latin', v_m.translations -> 'name_latin');  -- لا نمحو ما وضعته الإدارة
  end if;
  foreach v_lang in array array['fr', 'en'] loop
    v_lobj := (coalesce(v_tr -> v_lang, '{}'::jsonb) - 'track' - 'public_bio' - 'study_path' - 'extra')
              || coalesce(v_new -> v_lang, '{}'::jsonb);
    if v_lobj = '{}'::jsonb then v_tr := v_tr - v_lang;
    else v_tr := v_tr || jsonb_build_object(v_lang, v_lobj);
    end if;
  end loop;

  v_extra := coalesce(v_m.extra, '{}'::jsonb) - 'items';
  if jsonb_typeof(v_d #> '{extra,items}') = 'array' and jsonb_array_length(v_d #> '{extra,items}') > 0 then
    v_extra := v_extra || jsonb_build_object('items', v_d #> '{extra,items}');
  end if;

  -- bio (خاصة) وfull_name وemail وphone وcity لا تُلمس هنا إطلاقًا
  update public.members
     set university = v_d ->> 'university',
         promotion  = v_d ->> 'promotion',
         track      = v_d ->> 'track',
         profession = case when v_d ? 'profession' then v_d ->> 'profession' else profession end,
         public_bio = v_d ->> 'public_bio',
         study_path = v_d ->> 'study_path',
         socials    = coalesce(v_d -> 'socials', '{}'::jsonb),
         extra      = v_extra,
         translations = v_tr,
         photo_url  = coalesce(p_photo_url, photo_url),
         show_in_directory = case when v_d ? 'show_in_directory'
                                  then (v_d ->> 'show_in_directory')::boolean else show_in_directory end
   where id = v_m.id;

  update public.member_card_requests
     set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), review_note = null
   where id = v_r.id;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
  values (auth.uid(), 'ADMIN_APPROVED_MEMBER_CARD_REQUEST', 'members', v_m.id,
          'اعتماد طلب تعديل بطاقة العضو ' || v_m.full_name);
end;
$$;

create or replace function public.reject_member_card_request(p_request_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r public.member_card_requests%rowtype;
begin
  if auth.uid() is null or not public.can_manage_member_system() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;
  select * into v_r from public.member_card_requests where id = p_request_id for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if v_r.status <> 'pending' then raise exception 'لا يوجد طلب قيد المراجعة'; end if;

  update public.member_card_requests
     set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
         review_note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
   where id = v_r.id;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
  values (auth.uid(), 'ADMIN_REJECTED_MEMBER_CARD_REQUEST', 'members', v_r.member_id, 'رفض طلب تعديل بطاقة عضو');
end;
$$;

-- ---------------------------------------------------------------------
-- 8) الصلاحيات على الدوال (الافتراضي في Postgres: تنفيذ للجميع، فنسحبه ثم نمنح بدقة)
-- ---------------------------------------------------------------------
revoke all on function public.issue_member_activation_link(uuid)               from public, anon, authenticated;
revoke all on function public.get_member_activation_link(text)                 from public, anon, authenticated;
revoke all on function public.prepare_member_activation(text)                  from public, anon, authenticated;
revoke all on function public.finalize_member_activation(text, uuid)           from public, anon, authenticated;
revoke all on function public.get_my_member()                                  from public, anon, authenticated;
revoke all on function public.update_my_member_private(jsonb)                  from public, anon, authenticated;
revoke all on function public.submit_member_card_request(jsonb, text)          from public, anon, authenticated;
revoke all on function public.cancel_my_member_card_request()                  from public, anon, authenticated;
revoke all on function public.approve_member_card_request(uuid, text)          from public, anon, authenticated;
revoke all on function public.reject_member_card_request(uuid, text)           from public, anon, authenticated;

grant execute on function public.get_member_activation_link(text)              to anon, authenticated;
grant execute on function public.issue_member_activation_link(uuid)            to authenticated;
grant execute on function public.get_my_member()                               to authenticated;
grant execute on function public.update_my_member_private(jsonb)               to authenticated;
grant execute on function public.submit_member_card_request(jsonb, text)       to authenticated;
grant execute on function public.cancel_my_member_card_request()               to authenticated;
grant execute on function public.approve_member_card_request(uuid, text)       to authenticated;
grant execute on function public.reject_member_card_request(uuid, text)        to authenticated;
grant execute on function public.prepare_member_activation(text)               to service_role;
grant execute on function public.finalize_member_activation(text, uuid)        to service_role;

-- ---------------------------------------------------------------------
-- 9) التخزين: صورة البطاقة المقترحة (bucket خاص membership-docs، مجلد member-<id>/)
-- ---------------------------------------------------------------------
create or replace function public.member_card_photo_upload_allowed(p_name text)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.current_member_id() is not null
     and p_name ~ '^member-[0-9a-f-]{36}/photo-[0-9a-f]{8,32}\.(webp|jpg|png)$'
     and split_part(p_name, '/', 1) = 'member-' || public.current_member_id()::text
     -- سقف 10 ملفات لكل عضو حتى لا يُغرَق التخزين (لا يملك العضو حذف ما رفعه)
     and (select count(*) from storage.objects o
           where o.bucket_id = 'membership-docs'
             and o.name like 'member-' || public.current_member_id()::text || '/%') < 10;
$$;

revoke all on function public.member_card_photo_upload_allowed(text) from public, anon, authenticated;
grant execute on function public.member_card_photo_upload_allowed(text) to authenticated;

drop policy if exists "member_card_photo_insert" on storage.objects;
create policy "member_card_photo_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'membership-docs' and public.member_card_photo_upload_allowed(name));

drop policy if exists "member_card_photo_manager_select" on storage.objects;
create policy "member_card_photo_manager_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'membership-docs' and name like 'member-%' and public.can_manage_member_system());

notify pgrst, 'reload schema';

commit;
