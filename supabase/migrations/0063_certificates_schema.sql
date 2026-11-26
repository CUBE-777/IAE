-- ============================================================
-- 0063_certificates_schema.sql — نظام الشهادات، المرحلة 1 (أ): المخطط والصلاحيات والحماية
--
-- ما يضيفه (إضافة فقط؛ لا يعدّل أي جدول أو دالة أو سياسة قائمة، ولا يمسّ audit_logs ولا security-hardening):
--   جداول:   certificate_templates, certificate_campaigns, certificates, certificate_recipients,
--            certificate_email_queue, certificate_email_logs, certificate_token_secret (مغلق), certificate_number_counters (مغلق)
--   صلاحيات: can_admin_certificates()   = developer, super_admin
--            can_manage_certificates()  = developer, super_admin, secretary_general
--            can_review_certificate_recipients() = السابقة + members_manager (عبر RPC مراجعة محدودة فقط، لا وصول مباشر للجداول)
--   مساعدات داخلية (بلا منح لأي دور): certificate_hmac, certificate_random_bytes, certificate_audit
--   مشغّلات حماية: لا حذف للحملات/الشهادات/السجلات، snapshots ثابتة، الإلغاء لا رجعة فيه، تضييق اسم الشهادة العام فقط.
-- الأمان:
--   * الكتابة كلها عبر دوال SECURITY DEFINER (0064/0065). لا INSERT/UPDATE/DELETE مباشر لأي دور عميل.
--   * القراءة المباشرة (SELECT) محصورة بـ can_manage_certificates() عبر RLS، وعمود token_hash محجوب بمنح الأعمدة.
--   * certificate_token_secret و certificate_number_counters: RLS مفعّل، كل الصلاحيات مسحوبة، بلا سياسات.
--   * HMAC-SHA256 عبر pgcrypto (المخطط يُكتشف تلقائيًا: extensions عادةً في Supabase)؛ لا بناء تشفير مخصّص.
--   * member_id → members ON DELETE SET NULL: حذف العضو لا يحذف الشهادة ولا ينقل ملكيتها (تبقى snapshots والتحقق العام).
-- يتطلب: 0001 (pgcrypto) و0002 و0004 (set_updated_at) و0012/0019 (developer وأدوار) و0024 (current_admin_role) و0035/0046 (current_member_id) و0041 (activity_attendance).
-- ⚠️ تجربة جافة أولًا: استبدل `commit;` الأخيرة بـ `rollback;`. الرجوع: supabase/rollback/0063_certificates_schema_down.sql
-- ============================================================

begin;

-- ---------------------------------------------------------------------
-- 0) فحوص مسبقة
-- ---------------------------------------------------------------------
do $$
declare
  v_ext text;
  r text;
begin
  if to_regprocedure('public.current_admin_role()') is null then
    raise exception 'شغّل 0024_mfa_enforcement.sql أولاً (current_admin_role)';
  end if;
  if to_regprocedure('public.current_member_id()') is null then
    raise exception 'شغّل 0035/0046 أولاً (current_member_id)';
  end if;
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'شغّل 0004_functions_and_triggers.sql أولاً (set_updated_at)';
  end if;
  if to_regclass('public.audit_logs') is null or to_regclass('public.members') is null
     or to_regclass('public.activities') is null or to_regclass('public.profiles') is null
     or to_regclass('public.activity_attendance') is null then
    raise exception 'الجداول الأساسية (audit_logs/members/activities/profiles/activity_attendance) غير موجودة — شغّل 0041 أولاً';
  end if;
  foreach r in array array['developer', 'secretary_general'] loop
    if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                   where t.typname = 'admin_role' and e.enumlabel = r) then
      raise exception 'قيمة admin_role % غير موجودة — شغّل 0012 و0019 أولاً', r;
    end if;
  end loop;
  select n.nspname into v_ext from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pgcrypto';
  if v_ext is null then
    raise exception 'امتداد pgcrypto غير مثبّت: لا يُسمح ببديل تشفيري مخصّص. ثبّته (create extension pgcrypto) ثم أعد التنفيذ';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) مساعدات pgcrypto داخلية (المخطط مكتشَف ومؤهَّل بالكامل؛ بلا منح لأي دور)
-- ---------------------------------------------------------------------
do $$
declare
  v_ext text;
begin
  select n.nspname into v_ext from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pgcrypto';

  execute format($f$
    create or replace function public.certificate_hmac(p_key bytea, p_msg bytea)
    returns bytea
    language sql
    immutable
    security definer
    set search_path = public, pg_temp
    as $b$ select %I.hmac(p_msg, p_key, 'sha256') $b$
  $f$, v_ext);

  execute format($f$
    create or replace function public.certificate_random_bytes(p_n integer)
    returns bytea
    language sql
    volatile
    security definer
    set search_path = public, pg_temp
    as $b$ select %I.gen_random_bytes(p_n) $b$
  $f$, v_ext);
end $$;

revoke all on function public.certificate_hmac(bytea, bytea) from public, anon, authenticated;
revoke all on function public.certificate_random_bytes(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2) دوال الصلاحيات (مبنية على current_admin_role() فيُفرض MFA تلقائيًا؛ لا تعديل على أي دالة can_* قائمة)
-- ---------------------------------------------------------------------
create or replace function public.can_admin_certificates()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(public.current_admin_role()::text in ('developer', 'super_admin'), false);
$$;

create or replace function public.can_manage_certificates()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(public.current_admin_role()::text in ('developer', 'super_admin', 'secretary_general'), false);
$$;

create or replace function public.can_review_certificate_recipients()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(public.current_admin_role()::text in ('developer', 'super_admin', 'secretary_general', 'members_manager'), false);
$$;

revoke all on function public.can_admin_certificates()              from public, anon, authenticated;
revoke all on function public.can_manage_certificates()             from public, anon, authenticated;
revoke all on function public.can_review_certificate_recipients()   from public, anon, authenticated;
grant execute on function public.can_admin_certificates()            to authenticated;
grant execute on function public.can_manage_certificates()           to authenticated;
grant execute on function public.can_review_certificate_recipients() to authenticated;

-- ---------------------------------------------------------------------
-- 3) الجداول
-- ---------------------------------------------------------------------
create table if not exists public.certificate_templates (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code ~ '^[a-z0-9_]{3,40}$'),
  name       text not null check (char_length(btrim(name)) between 2 and 80),
  style      text not null check (style in ('academic', 'modern', 'premium', 'technology')),
  design     jsonb not null default '{}'::jsonb check (jsonb_typeof(design) = 'object' and pg_column_size(design) <= 20000),
  is_system  boolean not null default false,
  is_active  boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.certificate_campaigns (
  id                      uuid primary key default gen_random_uuid(),
  title                   text not null check (char_length(btrim(title)) between 3 and 200),
  certificate_type        text not null check (certificate_type in ('participation', 'organization', 'volunteering', 'training')),
  -- registration_based مسموح في القيد (للتوسّع لاحقًا) لكن المشغّل يرفضه حتى وجود مصدر تسجيل حقيقي.
  eligibility_source      text not null check (eligibility_source in ('attendance_based', 'registration_based', 'manual_selection')),
  activity_id             uuid references public.activities(id) on delete set null,
  activity_title_snapshot text check (activity_title_snapshot is null or char_length(activity_title_snapshot) <= 300),
  activity_date_snapshot  date,
  template_id             uuid not null references public.certificate_templates(id) on delete restrict,
  language                text not null default 'fr' check (language in ('fr', 'ar', 'en')),
  public_name_mode        text not null default 'masked' check (public_name_mode in ('none', 'masked', 'full')),
  settings                jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 20000),
  status                  text not null default 'draft' check (status in ('draft', 'issued', 'archived')),
  issued_at               timestamptz,
  archived_at             timestamptz,
  created_by              uuid references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists idx_certificate_campaigns_status on public.certificate_campaigns (status, created_at desc);
create index if not exists idx_certificate_campaigns_activity on public.certificate_campaigns (activity_id) where activity_id is not null;

create table if not exists public.certificates (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references public.certificate_campaigns(id) on delete restrict,
  certificate_number text not null unique check (certificate_number ~ '^IAE-[0-9]{4}-[0-9]{6,}$'),
  token_hash         text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),   -- sha256 للرمز المشتق؛ الخام لا يُخزَّن
  token_epoch        integer not null default 1 check (token_epoch >= 1),
  member_id          uuid references public.members(id) on delete set null,      -- حذف العضو: يُصفَّر ولا تُنقل الملكية
  recipient_kind     text not null check (recipient_kind in ('member', 'external')),
  recipient_name     text not null check (char_length(btrim(recipient_name)) between 2 and 200),   -- snapshot
  recipient_email    text check (recipient_email is null or (char_length(recipient_email) <= 254 and recipient_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),   -- snapshot
  status             text not null default 'valid' check (status in ('valid', 'revoked')),
  public_name_mode   text not null check (public_name_mode in ('none', 'masked', 'full')),
  issued_at          timestamptz not null default now(),
  issued_by          uuid references public.profiles(id) on delete set null,
  revoked_at         timestamptz,
  revoked_by         uuid references public.profiles(id) on delete set null,
  revoke_reason      text check (revoke_reason is null or char_length(revoke_reason) <= 300),
  created_at         timestamptz not null default now(),
  constraint certificates_revoked_chk check ((status = 'revoked') = (revoked_at is not null)),
  constraint certificates_external_no_member_chk check (recipient_kind <> 'external' or member_id is null)
);
create index if not exists idx_certificates_campaign on public.certificates (campaign_id);
create index if not exists idx_certificates_member on public.certificates (member_id) where member_id is not null;

create table if not exists public.certificate_recipients (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references public.certificate_campaigns(id) on delete restrict,
  member_id          uuid references public.members(id) on delete set null,
  kind               text not null check (kind in ('member', 'external')),
  display_name       text not null check (char_length(btrim(display_name)) between 2 and 200),   -- snapshot
  email              text check (email is null or (char_length(email) <= 254 and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),   -- snapshot
  eligibility_source text not null check (eligibility_source in ('attendance_based', 'manual_selection')),
  attended_at        timestamptz,                                                                -- snapshot الحضور
  status             text not null default 'pending' check (status in ('pending', 'issued')),
  certificate_id     uuid unique references public.certificates(id) on delete restrict,
  added_by           uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint certificate_recipients_issued_chk check ((status = 'issued') = (certificate_id is not null)),
  constraint certificate_recipients_external_no_member_chk check (kind <> 'external' or member_id is null)
);
create index if not exists idx_certificate_recipients_campaign on public.certificate_recipients (campaign_id, status);
-- منع التكرار: عضو واحد لكل حملة؛ والخارجي بالبريد (إن وُجد) أو بالاسم
create unique index if not exists uq_certificate_recipient_member
  on public.certificate_recipients (campaign_id, member_id) where member_id is not null;
create unique index if not exists uq_certificate_recipient_external_email
  on public.certificate_recipients (campaign_id, lower(email)) where kind = 'external' and email is not null;
create unique index if not exists uq_certificate_recipient_external_name
  on public.certificate_recipients (campaign_id, lower(btrim(display_name))) where kind = 'external' and email is null;

create table if not exists public.certificate_email_queue (
  id              uuid primary key default gen_random_uuid(),
  certificate_id  uuid not null references public.certificates(id) on delete restrict,
  status          text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  attempts        integer not null default 0 check (attempts >= 0),
  max_attempts    integer not null default 5 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  claimed_at      timestamptz,
  claimed_by      text check (claimed_by is null or claimed_by ~ '^[a-z0-9_:-]{1,60}$'),
  sent_at         timestamptz,
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,40}$'),   -- رمز فقط، بلا نص حرّ ولا PII
  enqueued_by     uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- مهمة نشطة واحدة لكل شهادة (يمنع التداخل والتكرار)
create unique index if not exists uq_certificate_email_active
  on public.certificate_email_queue (certificate_id) where status in ('queued', 'sending');
create index if not exists idx_certificate_email_claim
  on public.certificate_email_queue (next_attempt_at) where status = 'queued';
create index if not exists idx_certificate_email_cert on public.certificate_email_queue (certificate_id);

create table if not exists public.certificate_email_logs (
  id             uuid primary key default gen_random_uuid(),
  queue_id       uuid references public.certificate_email_queue(id) on delete restrict,
  certificate_id uuid not null references public.certificates(id) on delete restrict,
  event          text not null check (event in ('enqueued', 'claimed', 'sent', 'failed', 'retry_scheduled', 'retried',
                                                'cancelled_revoked', 'revoked_during_send', 'stale_released')),
  attempt        integer,
  error_code     text check (error_code is null or error_code ~ '^[a-z0-9_]{1,40}$'),
  actor          uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists idx_certificate_email_logs_cert on public.certificate_email_logs (certificate_id, created_at desc);

create table if not exists public.certificate_token_secret (
  id         integer primary key default 1 check (id = 1),
  secret     bytea not null check (octet_length(secret) = 32),
  generation integer not null default 1,
  rotated_at timestamptz,
  rotated_by uuid,
  created_at timestamptz not null default now()
);
insert into public.certificate_token_secret (id, secret) values (1, public.certificate_random_bytes(32)) on conflict (id) do nothing;

create table if not exists public.certificate_number_counters (
  year       integer primary key check (year between 2000 and 9999),
  last_value bigint not null default 0 check (last_value >= 0)
);

-- updated_at
do $$
declare t text;
begin
  foreach t in array array['certificate_templates', 'certificate_campaigns', 'certificate_recipients', 'certificate_email_queue'] loop
    execute format('drop trigger if exists trg_set_updated_at on public.%I;
                    create trigger trg_set_updated_at before update on public.%I
                    for each row execute function public.set_updated_at();', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4) مساعد التدقيق الداخلي: يستعمل audit_logs القائم كما هو، ويرفض مفاتيح PII/أسرار في metadata
-- ---------------------------------------------------------------------
create or replace function public.certificate_audit(p_action text, p_entity_type text, p_entity_id uuid, p_description text, p_metadata jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  p_metadata := coalesce(p_metadata, '{}'::jsonb);
  if jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'certificate_audit_bad_metadata' using errcode = '22023';
  end if;
  if p_metadata ?| array['email', 'recipient_email', 'name', 'recipient_name', 'display_name', 'token', 'secret',
                         'member_id', 'reason', 'revoke_reason', 'phone'] then
    raise exception 'certificate_audit_pii_forbidden' using errcode = '22023';
  end if;
  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, metadata)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, p_description, p_metadata);
end;
$$;
revoke all on function public.certificate_audit(text, text, uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5) مشغّلات الحماية (دفاع في العمق؛ الكتابة الشرعية عبر RPC فقط)
-- ---------------------------------------------------------------------
-- 5.أ) الحملات
create or replace function public.certificate_campaigns_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'certificate_campaign_delete_forbidden' using errcode = '42501';
  end if;
  if new.eligibility_source = 'registration_based' then
    raise exception 'certificate_registration_based_disabled' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'certificate_campaign_must_start_draft' using errcode = '22023';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.id is distinct from old.id then
    raise exception 'certificate_campaign_id_immutable' using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and not ((old.status = 'draft' and new.status in ('issued', 'archived')) or (old.status = 'issued' and new.status = 'archived')) then
    raise exception 'certificate_campaign_invalid_transition' using errcode = '22023';
  end if;
  if old.status <> 'draft' then
    if (new.title, new.certificate_type, new.eligibility_source, new.template_id, new.language, new.public_name_mode,
        new.settings, new.activity_title_snapshot, new.activity_date_snapshot)
       is distinct from
       (old.title, old.certificate_type, old.eligibility_source, old.template_id, old.language, old.public_name_mode,
        old.settings, old.activity_title_snapshot, old.activity_date_snapshot)
       or (new.activity_id is distinct from old.activity_id and new.activity_id is not null) then
      raise exception 'certificate_campaign_locked_after_draft' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.certificate_campaigns_guard() from public, anon, authenticated;
drop trigger if exists trg_certificate_campaigns_guard on public.certificate_campaigns;
create trigger trg_certificate_campaigns_guard before insert or update or delete on public.certificate_campaigns
  for each row execute function public.certificate_campaigns_guard();

-- 5.ب) الشهادات
create or replace function public.certificates_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_rank constant jsonb := '{"none":0,"masked":1,"full":2}';
begin
  if tg_op = 'DELETE' then
    raise exception 'certificate_delete_forbidden' using errcode = '42501';
  end if;

  if (new.id, new.campaign_id, new.certificate_number, new.recipient_kind, new.recipient_name,
      new.recipient_email, new.issued_at, new.created_at)
     is distinct from
     (old.id, old.campaign_id, old.certificate_number, old.recipient_kind, old.recipient_name,
      old.recipient_email, old.issued_at, old.created_at) then
    raise exception 'certificate_snapshot_immutable' using errcode = '42501';
  end if;
  -- member_id: التصفير فقط (حذف العضو)؛ لا إسناد ولا نقل
  if new.member_id is distinct from old.member_id and new.member_id is not null then
    raise exception 'certificate_owner_immutable' using errcode = '42501';
  end if;
  if (new.issued_by is distinct from old.issued_by and new.issued_by is not null)
     or (new.revoked_by is distinct from old.revoked_by and new.revoked_by is not null and old.status = 'revoked') then
    raise exception 'certificate_actor_immutable' using errcode = '42501';
  end if;
  -- الإلغاء لا رجعة فيه
  if old.status = 'revoked' and (new.status <> 'revoked' or new.revoked_at is distinct from old.revoked_at
                                 or new.revoke_reason is distinct from old.revoke_reason) then
    raise exception 'certificate_revoked_is_final' using errcode = '22023';
  end if;
  -- ظهور الاسم: تضييق فقط
  if (v_rank ->> new.public_name_mode)::int > (v_rank ->> old.public_name_mode)::int then
    raise exception 'certificate_name_mode_widening_forbidden' using errcode = '22023';
  end if;
  -- الرمز: لا يتغيّر إلا من دوال الدوران/إعادة الإصدار الداخلية
  if (new.token_hash is distinct from old.token_hash or new.token_epoch is distinct from old.token_epoch)
     and coalesce(current_setting('iae.certificate_internal', true), '') <> '1' then
    raise exception 'certificate_token_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.certificates_guard() from public, anon, authenticated;
drop trigger if exists trg_certificates_guard on public.certificates;
create trigger trg_certificates_guard before update or delete on public.certificates
  for each row execute function public.certificates_guard();

-- 5.ج) المستفيدون
create or replace function public.certificate_recipients_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'pending' then
      raise exception 'certificate_recipient_issued_immutable' using errcode = '42501';
    end if;
    return old;
  end if;
  if (new.id, new.campaign_id, new.kind, new.display_name, new.email, new.eligibility_source, new.attended_at, new.created_at)
     is distinct from
     (old.id, old.campaign_id, old.kind, old.display_name, old.email, old.eligibility_source, old.attended_at, old.created_at) then
    raise exception 'certificate_recipient_snapshot_immutable' using errcode = '42501';
  end if;
  if new.member_id is distinct from old.member_id and new.member_id is not null then
    raise exception 'certificate_recipient_owner_immutable' using errcode = '42501';
  end if;
  if old.status = 'issued' and (new.status <> 'issued' or new.certificate_id is distinct from old.certificate_id) then
    raise exception 'certificate_recipient_issued_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.certificate_recipients_guard() from public, anon, authenticated;
drop trigger if exists trg_certificate_recipients_guard on public.certificate_recipients;
create trigger trg_certificate_recipients_guard before update or delete on public.certificate_recipients
  for each row execute function public.certificate_recipients_guard();

-- 5.د) الطابور (انتقالات مسموحة فقط) والسجلات (إلحاق فقط)
create or replace function public.certificate_email_queue_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'certificate_email_queue_delete_forbidden' using errcode = '42501';
  end if;
  if new.certificate_id is distinct from old.certificate_id then
    raise exception 'certificate_email_queue_certificate_immutable' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'queued'  and new.status in ('sending', 'cancelled'))
    or (old.status = 'sending' and new.status in ('sent', 'queued', 'failed', 'cancelled'))
    or (old.status = 'failed'  and new.status = 'queued')) then
    raise exception 'certificate_email_queue_invalid_transition' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.certificate_email_queue_guard() from public, anon, authenticated;
drop trigger if exists trg_certificate_email_queue_guard on public.certificate_email_queue;
create trigger trg_certificate_email_queue_guard before update or delete on public.certificate_email_queue
  for each row execute function public.certificate_email_queue_guard();

create or replace function public.certificate_email_logs_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'certificate_email_logs_append_only' using errcode = '42501';
end;
$$;
revoke all on function public.certificate_email_logs_guard() from public, anon, authenticated;
drop trigger if exists trg_certificate_email_logs_guard on public.certificate_email_logs;
create trigger trg_certificate_email_logs_guard before update or delete on public.certificate_email_logs
  for each row execute function public.certificate_email_logs_guard();

-- ---------------------------------------------------------------------
-- 6) RLS والمنح
--    * الكل مغلق افتراضيًا. SELECT لـ can_manage_certificates() فقط. لا كتابة مباشرة لأي دور عميل.
--    * الجدولان السرّيان بلا سياسات ولا منح.
-- ---------------------------------------------------------------------
alter table public.certificate_templates      enable row level security;
alter table public.certificate_campaigns      enable row level security;
alter table public.certificates               enable row level security;
alter table public.certificate_recipients     enable row level security;
alter table public.certificate_email_queue    enable row level security;
alter table public.certificate_email_logs     enable row level security;
alter table public.certificate_token_secret   enable row level security;
alter table public.certificate_number_counters enable row level security;

revoke all on table public.certificate_templates, public.certificate_campaigns, public.certificates,
                    public.certificate_recipients, public.certificate_email_queue, public.certificate_email_logs,
                    public.certificate_token_secret, public.certificate_number_counters
  from public, anon, authenticated;

grant select on public.certificate_templates   to authenticated;
grant select on public.certificate_campaigns   to authenticated;
grant select on public.certificate_recipients  to authenticated;
grant select on public.certificate_email_queue to authenticated;
grant select on public.certificate_email_logs  to authenticated;
-- شهادات: كل الأعمدة عدا token_hash
grant select (id, campaign_id, certificate_number, token_epoch, member_id, recipient_kind, recipient_name, recipient_email,
              status, public_name_mode, issued_at, issued_by, revoked_at, revoked_by, revoke_reason, created_at)
  on public.certificates to authenticated;

drop policy if exists certificate_templates_select_manage on public.certificate_templates;
create policy certificate_templates_select_manage on public.certificate_templates
  for select to authenticated using (public.can_manage_certificates());
drop policy if exists certificate_campaigns_select_manage on public.certificate_campaigns;
create policy certificate_campaigns_select_manage on public.certificate_campaigns
  for select to authenticated using (public.can_manage_certificates());
drop policy if exists certificates_select_manage on public.certificates;
create policy certificates_select_manage on public.certificates
  for select to authenticated using (public.can_manage_certificates());
drop policy if exists certificate_recipients_select_manage on public.certificate_recipients;
create policy certificate_recipients_select_manage on public.certificate_recipients
  for select to authenticated using (public.can_manage_certificates());
drop policy if exists certificate_email_queue_select_manage on public.certificate_email_queue;
create policy certificate_email_queue_select_manage on public.certificate_email_queue
  for select to authenticated using (public.can_manage_certificates());
drop policy if exists certificate_email_logs_select_manage on public.certificate_email_logs;
create policy certificate_email_logs_select_manage on public.certificate_email_logs
  for select to authenticated using (public.can_manage_certificates());

-- ---------------------------------------------------------------------
-- 7) القوالب الأربعة الافتراضية (A4 أفقي 297×210، هوية IAE)
-- ---------------------------------------------------------------------
insert into public.certificate_templates (code, name, style, design, is_system)
select s.code, s.name, s.code,
       jsonb_build_object(
         'page',   jsonb_build_object('format', 'A4', 'orientation', 'landscape', 'width_mm', 297, 'height_mm', 210),
         'colors', jsonb_build_object('navy', '#142B4A', 'gold', '#C5A45B', 'white', '#FFFFFF', 'dark', '#202A36', 'silver', '#E8EDF3'),
         'fonts',  jsonb_build_object('latin', 'Inter', 'arabic', jsonb_build_array('Amiri', 'Tajawal'))
       ),
       true
  from (values ('academic', 'Academic'), ('modern', 'Modern'), ('premium', 'Premium'), ('technology', 'Technology')) as s(code, name)
on conflict (code) do nothing;

notify pgrst, 'reload schema';
commit;
