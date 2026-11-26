-- ============================================================
-- 0064_certificates_admin_functions.sql — نظام الشهادات، المرحلة 1 (ب): الدوال (RPC)
--
-- ما يضيفه (دوال فقط؛ لا جداول ولا تعديل على شيء قائم):
--   مساعدات داخلية (بلا منح): certificate_token_for, certificate_token_hash, certificate_next_number, certificate_mask_name
--   إدارة (can_manage_certificates): certificate_create_campaign, certificate_update_campaign, certificate_add_attendance_recipients,
--      certificate_add_member_recipient, certificate_add_external_recipient, certificate_remove_recipient,
--      certificate_issue_campaign, certificate_revoke, certificate_archive_campaign, certificate_set_public_name_mode
--   إدارة عليا (can_admin_certificates): certificate_save_template, certificate_reissue_token
--   المطوّر وحده: certificate_rotate_token_secret
--   مراجعة (can_review_certificate_recipients): certificate_review_campaigns, certificate_review_recipients
--   العضو/المدير: get_my_certificates, get_certificate_render_data
--   عام (anon + authenticated): verify_certificate
-- الأمان:
--   * كلها SECURITY DEFINER بمسار بحث ثابت؛ الصلاحية تُفحص داخل الدالة؛ المساعدات الداخلية بلا منح.
--   * الرمز = Base64URL(HMAC-SHA256(secret, 'iae-cert:v1:' ‖ certificate_id ‖ ':' ‖ token_epoch)) — 256 بت؛ يُخزَّن sha256 له فقط.
--   * ترتيب الأقفال الثابت: الشهادة ثم صف الطابور؛ الحملة قبل الشهادات؛ السرّ (FOR SHARE عند الإصدار / FOR UPDATE عند التدوير).
--   * الأرقام: عدّاد ذرّي في جدول (لا sequence) داخل نفس معاملة الإصدار، فلا ثغرات لمعاملة ملغاة؛ الحذف محظور بمشغّل. (انظر docs/CERTIFICATES_DB.md)
-- يتطلب: 0063. آمن لإعادة التشغيل. الرجوع: supabase/rollback/0064_certificates_admin_functions_down.sql
-- ⚠️ تجربة جافة أولًا: استبدل `commit;` الأخيرة بـ `rollback;`.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.certificates') is null or to_regclass('public.certificate_token_secret') is null
     or to_regprocedure('public.can_manage_certificates()') is null or to_regprocedure('public.certificate_audit(text,text,uuid,text,jsonb)') is null then
    raise exception 'شغّل 0063_certificates_schema.sql أولاً';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) المساعدات الداخلية
-- ---------------------------------------------------------------------
create or replace function public.certificate_token_for(p_certificate_id uuid, p_epoch integer)
returns text
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select rtrim(translate(replace(encode(
           public.certificate_hmac(s.secret, convert_to('iae-cert:v1:' || p_certificate_id::text || ':' || p_epoch::text, 'utf8')),
           'base64'), E'\n', ''), '+/', '-_'), '=')
    from public.certificate_token_secret s
   where s.id = 1;
$$;

create or replace function public.certificate_token_hash(p_token text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select encode(sha256(convert_to(p_token, 'utf8')), 'hex');
$$;

create or replace function public.certificate_next_number()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer := extract(year from (now() at time zone 'Africa/Casablanca'))::integer;
  v_n    bigint;
begin
  insert into public.certificate_number_counters as c (year, last_value) values (v_year, 1)
  on conflict (year) do update set last_value = c.last_value + 1
  returning c.last_value into v_n;
  return 'IAE-' || v_year::text || '-' || lpad(v_n::text, 6, '0');
end;
$$;

create or replace function public.certificate_mask_name(p_name text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(string_agg(left(w, 1) || repeat('*', least(greatest(char_length(w) - 1, 1), 5)), ' '), '')
    from regexp_split_to_table(btrim(coalesce(p_name, '')), '\s+') as w
   where w <> '';
$$;

revoke all on function public.certificate_token_for(uuid, integer)  from public, anon, authenticated;
revoke all on function public.certificate_token_hash(text)           from public, anon, authenticated;
revoke all on function public.certificate_next_number()              from public, anon, authenticated;
revoke all on function public.certificate_mask_name(text)            from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2) القوالب (إدارة عليا)
-- ---------------------------------------------------------------------
create or replace function public.certificate_save_template(p_id uuid, p_name text, p_style text, p_design jsonb, p_is_active boolean default true)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_sys boolean;
begin
  if auth.uid() is null or not public.can_admin_certificates() then
    raise exception 'غير مصرّح لك بهذه العملية' using errcode = '42501';
  end if;
  if p_id is null then
    insert into public.certificate_templates (code, name, style, design, is_active, created_by)
    values ('custom_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10), btrim(p_name), p_style,
            coalesce(p_design, '{}'::jsonb), coalesce(p_is_active, true), auth.uid())
    returning id into v_id;
  else
    select is_system into v_sys from public.certificate_templates where id = p_id for update;
    if not found then raise exception 'certificate_template_not_found' using errcode = 'P0002'; end if;
    update public.certificate_templates
       set name = case when v_sys then name else btrim(coalesce(p_name, name)) end,
           style = case when v_sys then style else coalesce(p_style, style) end,
           design = coalesce(p_design, design),
           is_active = coalesce(p_is_active, is_active)
     where id = p_id;
    v_id := p_id;
  end if;
  perform public.certificate_audit('certificate_template_saved', 'certificate_template', v_id, 'حفظ قالب شهادة', '{}'::jsonb);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) الحملات
-- ---------------------------------------------------------------------
create or replace function public.certificate_create_campaign(
  p_title text, p_type text, p_eligibility text, p_activity_id uuid, p_template_id uuid,
  p_language text default 'fr', p_public_name_mode text default 'masked', p_settings jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id    uuid;
  v_title text;
  v_date  date;
begin
  if auth.uid() is null or not public.can_manage_certificates() then
    raise exception 'غير مصرّح لك بهذه العملية' using errcode = '42501';
  end if;
  if p_eligibility = 'registration_based' then
    raise exception 'certificate_registration_based_disabled' using errcode = '22023';
  end if;
  if not exists (select 1 from public.certificate_templates t where t.id = p_template_id and t.is_active) then
    raise exception 'certificate_template_not_found' using errcode = 'P0002';
  end if;
  if p_activity_id is not null then
    select a.title, a.date into v_title, v_date from public.activities a where a.id = p_activity_id and a.deleted_at is null;
    if not found then raise exception 'certificate_activity_not_found' using errcode = 'P0002'; end if;
  elsif p_eligibility = 'attendance_based' then
    raise exception 'certificate_activity_required' using errcode = '22023';
  end if;

  insert into public.certificate_campaigns (title, certificate_type, eligibility_source, activity_id, activity_title_snapshot,
                                            activity_date_snapshot, template_id, language, public_name_mode, settings, created_by)
  values (btrim(p_title), p_type, p_eligibility, p_activity_id, left(v_title, 300), v_date, p_template_id,
          coalesce(p_language, 'fr'), coalesce(p_public_name_mode, 'masked'), coalesce(p_settings, '{}'::jsonb), auth.uid())
  returning id into v_id;

  perform public.certificate_audit('certificate_campaign_created', 'certificate_campaign', v_id, 'إنشاء حملة شهادات',
    jsonb_build_object('type', p_type, 'eligibility', p_eligibility, 'language', coalesce(p_language, 'fr')));
  return v_id;
end;
$$;

create or replace function public.certificate_update_campaign(
  p_id uuid, p_title text default null, p_template_id uuid default null, p_language text default null,
  p_public_name_mode text default null, p_settings jsonb default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c public.certificate_campaigns%rowtype;
begin
  if auth.uid() is null or not public.can_manage_certificates() then
    raise exception 'غير مصرّح لك بهذه العملية' using errcode = '42501';
  end if;
  select * into v_c from public.certificate_campaigns where id = p_id for update;
  if not found then raise exception 'certificate_campaign_not_found' using errcode = 'P0002'; end if;
  if v_c.status <> 'draft' then raise exception 'certificate_campaign_locked_after_draft' using errcode = '22023'; end if;
  if p_template_id is not null and not exists (select 1 from public.certificate_templates t where t.id = p_template_id and t.is_active) then
    raise exception 'certificate_template_not_found' using errcode = 'P0002';
  end if;
  update public.certificate_campaigns
     set title = coalesce(btrim(p_title), title),
         template_id = coalesce(p_template_id, template_id),
         language = coalesce(p_language, language),
         public_name_mode = coalesce(p_public_name_mode, public_name_mode),
         settings = coalesce(p_settings, settings)
   where id = p_id;
  perform public.certificate_audit('certificate_campaign_updated', 'certificate_campaign', p_id, 'تعديل حملة شهادات', '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- 4) المستفيدون (snapshots وقت الإضافة)
-- ---------------------------------------------------------------------
create or replace function public.certificate_add_attendance_recipients(p_campaign_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c public.certificate_campaigns%rowtype;
  v_n integer;
begin
  if auth.uid() is null or not public.can_manage_certificates() then
    raise exception 'غير مصرّح لك بهذه العملية' using errcode = '42501';
  end if;
  select * into v_c from public.certificate_campaigns where id = p_campaign_id for update;
  if not found then raise exception 'certificate_campaign_not_found' using errcode = 'P0002'; end if;
  if v_c.status = 'archived' then raise exception 'certificate_campaign_archived' using errcode = '22023'; end if;
  if v_c.eligibility_source <> 'attendance_based' then raise exception 'certificate_wrong_eligibility' using errcode = '22023'; end if;
  if v_c.activity_id is null then raise exception 'certificate_activity_required' using errcode = '22023'; end if;

  insert into public.certificate_recipients (campaign_id, member_id, kind, display_name, email, eligibility_source, attended_at, added_by)
  select v_c.id, m.id, 'member', btrim(m.full_name),
         case when m.email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and char_length(m.email) <= 254 then btrim(m.email) end,
         'attendance_based', a.checked_in_at, auth.uid()
    from public.activity_attendance a
    join public.members m on m.id = a.member_id
   where a.activity_id = v_c.activity_id and m.deleted_at is null and char_length(btrim(m.full_name)) >= 2
  on conflict do nothing;
  get diagnostics v_n = row_count;

  perform public.certificate_audit('certificate_recipients_added', 'certificate_campaign', v_c.id, 'إضافة مستفيدين من الحضور',
    jsonb_build_object('count', v_n, 'source', 'attendance_based'));
  return v_n;
end;
$$;

create or replace function public.certificate_add_member_recipient(p_campaign_id uuid, p_member_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c public.certificate_campaigns%rowtype;
  v_m record;
  v_id uuid;
begin
  if auth.uid() is null or not public.can_manage_certificates() then
    raise exception 'غير مصرّح لك بهذه العملية' using errcode = '42501';
  end if;
  select * into v_c from public.certificate_campaigns where id = p_campaign_id for update;
  if not found then raise exception 'certificate_campaign_not_found' using errcode = 'P0002'; end if;
  if v_c.status = 'archived' then raise exception 'certificate_campaign_archived' using errcode = '22023'; end if;
  if v_c.eligibility_source <> 'manual_selection' then raise exception 'certificate_wrong_eligibility' using errcode = '22023'; end if;
  select m.id, btrim(m.full_name) as name,
         case when m.email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and char_length(m.email) <= 254 then btrim(m.email) end as email
    into v_m from public.members m where m.id = p_member_id and m.deleted_at is null;
  if not found then raise exception 'certificate_member_not_found' using errcode = 'P0002'; end if;
  begin
    insert into public.certificate_recipients (campaign_id, member_id, kind, display_name, email, eligibility_source, added_by)
    values (v_c.id, v_m.id, 'member', v_m.name, v_m.email, 'manual_selection', auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'certificate_recipient_duplicate' using errcode = '23505';
  end;
  perform public.certificate_audit('certificate_recipients_added', 'certificate_campaign', v_c.id, 'إضافة مستفيد',
    jsonb_build_object('count', 1, 'source', 'manual_selection', 'kind', 'member'));
  return v_id;
end;
$$;

create or replace function public.certificate_add_external_recipient(p_campaign_id uuid, p_name text, p_email text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c public.certificate_campaigns%rowtype;
  v_id uuid;
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
begin
  if auth.uid() is null or not public.can_manage_certificates() then
    raise exception 'غير مصرّح لك بهذه العملية' using errcode = '42501';
  end if;
  select * into v_c from public.certificate_campaigns where id = p_campaign_id for update;
  if not found then raise exception 'certificate_campaign_not_found' using errcode = 'P0002'; end if;
  if v_c.status = 'archived' then raise exception 'certificate_campaign_archived' using errcode = '22023'; end if;
  if v_c.eligibility_source <> 'manual_selection' then raise exception 'certificate_wrong_eligibility' using errcode = '22023'; end if;
  begin
    insert into public.certificate_recipients (campaign_id, member_id, kind, display_name, email, eligibility_source, added_by)
    values (v_c.id, null, 'external', btrim(p_name), v_email, 'manual_selection', auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'certificate_recipient_duplicate' using errcode = '23505';
  end;
  perform public.certificate_audit('certificate_recipients_added', 'certificate_campaign', v_c.id, 'إضافة مستفيد',
    jsonb_build_object('count', 1, 'source', 'manual_selection', 'kind', 'external'));
  return v_id;
end;
$$;

create or replace function public.certificate_remove_recipient(p_recipient_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r public.certificate_recipients%rowtype;
begin
  if auth.uid() is null or not public.can_manage_certificates() then
    raise exception 'غير مصرّح لك بهذه العملية' using errcode = '42501';
  end if;
  select * into v_r from public.certificate_recipients where id = p_recipient_id for update;
  if not found then raise exception 'certificate_recipient_not_found' using errcode = 'P0002'; end if;
  if v_r.status <> 'pending' then raise exception 'certificate_recipient_issued_immutable' using errcode = '22023'; end if;
  delete from public.certificate_recipients where id = p_recipient_id;
  perform public.certificate_audit('certificate_recipient_removed', 'certificate_campaign', v_r.campaign_id, 'حذف مستفيد غير مُصدَر', '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- 5) الإصدار (draft→issued أول مرة؛ في issued يُصدر المستفيدين المعلّقين الإضافيين)
-- ---------------------------------------------------------------------
create or replace function public.certificate_issue_campaign(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c       public.certificate_campaigns%rowtype;
  v_first   boolean;
  v_r       record;
  v_id      uuid;
  v_tok     text;
  v_issued  integer := 0;
  v_skipped integer := 0;
begin
  if auth.uid() is null or not public.can_manage_certificates() then
    raise exception 'غير مصرّح لك بهذه العملية' using errcode = '42501';
  end if;
  -- يمنع تدوير السرّ في منتصف الإصدار (التدوير يأخذ FOR UPDATE)
  perform 1 from public.certificate_token_secret where id = 1 for share;
  select * into v_c from public.certificate_campaigns where id = p_campaign_id for update;
  if not found then raise exception 'certificate_campaign_not_found' using errcode = 'P0002'; end if;
  if v_c.status = 'archived' then raise exception 'certificate_campaign_archived' using errcode = '22023'; end if;
  if v_c.eligibility_source = 'registration_based' then raise exception 'certificate_registration_based_disabled' using errcode = '22023'; end if;
  v_first := v_c.status = 'draft';

  for v_r in
    select r.* from public.certificate_recipients r
     where r.campaign_id = v_c.id and r.status = 'pending'
     order by r.created_at, r.id
       for update
  loop
    -- عضو محذوف (soft/hard) لا تُصدر له شهادة جديدة؛ يبقى معلّقًا
    if v_r.kind = 'member' and not exists (select 1 from public.members m where m.id = v_r.member_id and m.deleted_at is null) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_id  := gen_random_uuid();
    v_tok := public.certificate_token_for(v_id, 1);
    if v_tok is null then raise exception 'certificate_secret_missing' using errcode = 'XX000'; end if;
    insert into public.certificates (id, campaign_id, certificate_number, token_hash, token_epoch, member_id, recipient_kind,
                                     recipient_name, recipient_email, public_name_mode, issued_by)
    values (v_id, v_c.id, public.certificate_next_number(), public.certificate_token_hash(v_tok), 1,
            case when v_r.kind = 'member' then v_r.member_id end, v_r.kind, v_r.display_name, v_r.email, v_c.public_name_mode, auth.uid());
    update public.certificate_recipients set status = 'issued', certificate_id = v_id where id = v_r.id;
    v_issued := v_issued + 1;
  end loop;

  if v_issued = 0 and v_first then
    raise exception 'certificate_no_recipients' using errcode = '22023';   -- يُرجع تغيير الحالة (لم يتغيّر شيء بعد)
  end if;
  if v_first then
    update public.certificate_campaigns set status = 'issued', issued_at = now() where id = v_c.id;
  end if;
  if v_issued > 0 then
    perform public.certificate_audit(case when v_first then 'certificate_campaign_issued' else 'certificate_batch_issued' end,
      'certificate_campaign', v_c.id, case when v_first then 'إصدار حملة شهادات' else 'إصدار شهادات إضافية' end,
      jsonb_build_object('issued', v_issued, 'skipped', v_skipped));
  end if;
  return jsonb_build_object('issued', v_issued, 'skipped', v_skipped, 'status', 'issued');
end;
$$;

-- ---------------------------------------------------------------------
-- 6) الإلغاء والأرشفة وخصوصية الاسم
-- ---------------------------------------------------------------------
create or replace function public.certificate_revoke(p_certificate_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c       public.certificates%rowtype;
  v_sending boolean;
begin
  if auth.uid() is null or not public.can_manage_certificates() then
    raise exception 'غير مصرّح لك بهذه العملية' using errcode = '42501';
  end if;
  -- القفل الأول دائمًا على الشهادة (ثم الطابور) — نفس ترتيب enqueue/retry/claim فلا deadlock
  select * into v_c from public.certificates where id = p_certificate_id for update;
  if not found then raise exception 'certificate_not_found' using errcode = 'P0002'; end if;
  if v_c.status = 'revoked' then
    return jsonb_build_object('status', 'revoked', 'already_revoked', true);
  end if;

  update public.certificates
     set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(),
         revoke_reason = nullif(left(btrim(coalesce(p_reason, '')), 300), '')
   where id = v_c.id;

  -- المهام في الانتظار تُلغى فورًا
  with c as (
    update public.certificate_email_queue
       set status = 'cancelled', last_error_code = 'certificate_revoked'
     where certificate_id = v_c.id and status = 'queued'
    returning id, attempts
  )
  insert into public.certificate_email_logs (queue_id, certificate_id, event, attempt, actor)
  select id, v_c.id, 'cancelled_revoked', attempts, auth.uid() from c;

  -- المهمة قيد الإرسال (طلب HTTP قد يكون وصل المزوّد): لا يمكن إيقافها؛ تُوثَّق فقط
  insert into public.certificate_email_logs (queue_id, certificate_id, event, attempt, actor)
  select q.id, v_c.id, 'revoked_during_send', q.attempts, auth.uid()
    from public.certificate_email_queue q where q.certificate_id = v_c.id and q.status = 'sending';
  v_sending := found;

  perform public.certificate_audit('certificate_revoked', 'certificate', v_c.id, 'إلغاء شهادة',
    jsonb_build_object('campaign_id', v_c.campaign_id, 'email_was_sending', v_sending));
  return jsonb_build_object('status', 'revoked', 'already_revoked', false, 'email_was_sending', v_sending);
end;
$$;

create or replace function public.certificate_archive_campaign(p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c public.certificate_campaigns%rowtype;
begin
  if auth.uid() is null or not public.can_manage_certificates() then
    raise exception 'غير مصرّح لك بهذه العملية' using errcode = '42501';
  end if;
  select * into v_c from public.certificate_campaigns where id = p_campaign_id for update;
  if not found then raise exception 'certificate_campaign_not_found' using errcode = 'P0002'; end if;
  if v_c.status = 'archived' then return; end if;
  update public.certificate_campaigns set status = 'archived', archived_at = now() where id = v_c.id;
  perform public.certificate_audit('certificate_campaign_archived', 'certificate_campaign', v_c.id, 'أرشفة حملة شهادات', '{}'::jsonb);
end;
$$;

create or replace function public.certificate_set_public_name_mode(p_certificate_id uuid, p_mode text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c public.certificates%rowtype;
  v_rank constant jsonb := '{"none":0,"masked":1,"full":2}';
begin
  if auth.uid() is null or not public.can_manage_certificates() then
    raise exception 'غير مصرّح لك بهذه العملية' using errcode = '42501';
  end if;
  if p_mode is null or not (v_rank ? p_mode) then raise exception 'certificate_invalid_name_mode' using errcode = '22023'; end if;
  select * into v_c from public.certificates where id = p_certificate_id for update;
  if not found then raise exception 'certificate_not_found' using errcode = 'P0002'; end if;
  if v_c.status = 'revoked' then raise exception 'certificate_revoked_is_final' using errcode = '22023'; end if;
  if (v_rank ->> p_mode)::int > (v_rank ->> v_c.public_name_mode)::int then
    raise exception 'certificate_name_mode_widening_forbidden' using errcode = '22023';
  end if;
  if p_mode = v_c.public_name_mode then return; end if;
  update public.certificates set public_name_mode = p_mode where id = v_c.id;
  perform public.certificate_audit('certificate_privacy_changed', 'certificate', v_c.id, 'تقليل ظهور اسم الشهادة العام',
    jsonb_build_object('from', v_c.public_name_mode, 'to', p_mode));
end;
$$;

-- ---------------------------------------------------------------------
-- 7) الرمز: إعادة إصدار (شهادة واحدة) وتدوير السرّ (المطوّر وحده)
-- ---------------------------------------------------------------------
create or replace function public.certificate_reissue_token(p_certificate_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c public.certificates%rowtype;
  v_epoch integer;
begin
  if auth.uid() is null or not public.can_admin_certificates() then
    raise exception 'غير مصرّح لك بهذه العملية' using errcode = '42501';
  end if;
  perform 1 from public.certificate_token_secret where id = 1 for share;
  select * into v_c from public.certificates where id = p_certificate_id for update;
  if not found then raise exception 'certificate_not_found' using errcode = 'P0002'; end if;
  if v_c.status = 'revoked' then raise exception 'certificate_revoked_is_final' using errcode = '22023'; end if;
  v_epoch := v_c.token_epoch + 1;
  perform set_config('iae.certificate_internal', '1', true);
  update public.certificates
     set token_epoch = v_epoch, token_hash = public.certificate_token_hash(public.certificate_token_for(v_c.id, v_epoch))
   where id = v_c.id;
  perform set_config('iae.certificate_internal', '0', true);
  perform public.certificate_audit('certificate_token_reissued', 'certificate', v_c.id, 'إعادة إصدار رمز التحقق', jsonb_build_object('epoch', v_epoch));
end;
$$;

create or replace function public.certificate_rotate_token_secret()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gen integer;
  v_n   integer;
begin
  -- المطوّر وحده (وليس super_admin)
  if auth.uid() is null or public.current_admin_role()::text is distinct from 'developer' then
    raise exception 'غير مصرّح لك بهذه العملية' using errcode = '42501';
  end if;
  select generation into v_gen from public.certificate_token_secret where id = 1 for update;
  perform set_config('iae.certificate_internal', '1', true);
  update public.certificate_token_secret
     set secret = public.certificate_random_bytes(32), generation = generation + 1, rotated_at = now(), rotated_by = auth.uid()
   where id = 1;
  -- إعادة اشتقاق hash كل الشهادات (الصالحة والملغاة) بالسرّ الجديد في نفس المعاملة: التحقق يبقى متسقًا
  update public.certificates c
     set token_hash = public.certificate_token_hash(public.certificate_token_for(c.id, c.token_epoch));
  get diagnostics v_n = row_count;
  perform set_config('iae.certificate_internal', '0', true);
  perform public.certificate_audit('certificate_secret_rotated', 'certificate_token_secret', null, 'تدوير سرّ رموز الشهادات',
    jsonb_build_object('generation', v_gen + 1, 'rehashed', v_n));
  return jsonb_build_object('generation', v_gen + 1, 'rehashed', v_n);
end;
$$;

-- ---------------------------------------------------------------------
-- 8) المراجعة (members_manager وغيره): أقل بيانات ممكنة، بلا email/member_id/token/queue
-- ---------------------------------------------------------------------
create or replace function public.certificate_review_campaigns()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_all boolean;
begin
  if auth.uid() is null or not public.can_review_certificate_recipients() then
    raise exception 'غير مصرّح لك بهذه العملية' using errcode = '42501';
  end if;
  v_all := public.can_manage_certificates();   -- المراجع العادي لا يرى الحملات المؤرشفة
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'title', c.title, 'certificate_type', c.certificate_type, 'eligibility_source', c.eligibility_source,
             'language', c.language, 'status', c.status,
             'recipients_count', (select count(*) from public.certificate_recipients r where r.campaign_id = c.id),
             'issued_count', (select count(*) from public.certificate_recipients r where r.campaign_id = c.id and r.status = 'issued'))
           order by c.created_at desc)
      from public.certificate_campaigns c
     where v_all or c.status <> 'archived'
  ), '[]'::jsonb);
end;
$$;

create or replace function public.certificate_review_recipients(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_c public.certificate_campaigns%rowtype;
begin
  if auth.uid() is null or not public.can_review_certificate_recipients() then
    raise exception 'غير مصرّح لك بهذه العملية' using errcode = '42501';
  end if;
  select * into v_c from public.certificate_campaigns where id = p_campaign_id;
  -- النطاق: غير موجودة أو مؤرشفة لغير مدراء الشهادات → نفس الخطأ (لا كشف)
  if not found or (v_c.status = 'archived' and not public.can_manage_certificates()) then
    raise exception 'certificate_campaign_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'campaign', jsonb_build_object('id', v_c.id, 'title', v_c.title, 'certificate_type', v_c.certificate_type,
                                   'eligibility_source', v_c.eligibility_source, 'language', v_c.language, 'status', v_c.status),
    'recipients_count', (select count(*) from public.certificate_recipients r where r.campaign_id = v_c.id),
    'recipients', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'display_name', r.display_name, 'kind', r.kind, 'eligibility_source', r.eligibility_source,
               'status', r.status, 'certificate_status', c.status, 'certificate_number', c.certificate_number,
               'has_email', r.email is not null)
             order by r.display_name, r.id)
        from public.certificate_recipients r
        left join public.certificates c on c.id = r.certificate_id
       where r.campaign_id = v_c.id
    ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------
-- 9) العضو: شهاداتي. fail-closed: بلا هوية عضو حالية → خطأ، و member_id null لا يطابق أحدًا أبدًا
-- ---------------------------------------------------------------------
create or replace function public.get_my_certificates()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_me uuid;
begin
  v_me := public.current_member_id();
  if auth.uid() is null or v_me is null then
    raise exception 'certificate_member_required' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'certificate_number', c.certificate_number, 'certificate_type', k.certificate_type,
             'campaign_title', k.title, 'language', k.language, 'issued_at', c.issued_at, 'status', c.status,
             'public_name_mode', c.public_name_mode,
             'token', case when c.status = 'valid' then public.certificate_token_for(c.id, c.token_epoch) end)
           order by c.issued_at desc, c.id)
      from public.certificates c
      join public.certificate_campaigns k on k.id = c.campaign_id
     where c.member_id is not null and c.member_id = v_me
  ), '[]'::jsonb);
end;
$$;

-- بيانات توليد PDF (client-side): المالك الحالي أو مدير الشهادات. الملغاة لا تُولَّد. بلا email ولا member_id.
create or replace function public.get_certificate_render_data(p_certificate_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_me  uuid;
  v_c   public.certificates%rowtype;
  v_k   public.certificate_campaigns%rowtype;
  v_t   public.certificate_templates%rowtype;
  v_tok text;
begin
  if auth.uid() is null then raise exception 'certificate_not_found' using errcode = '42501'; end if;
  v_me := public.current_member_id();
  select * into v_c from public.certificates where id = p_certificate_id;
  -- غير موجودة أو ليست لك: نفس الخطأ (لا كشف وجود)
  if not found or not (public.can_manage_certificates() or (v_me is not null and v_c.member_id is not null and v_c.member_id = v_me)) then
    raise exception 'certificate_not_found' using errcode = '42501';
  end if;
  if v_c.status <> 'valid' then raise exception 'certificate_revoked' using errcode = '22023'; end if;
  select * into v_k from public.certificate_campaigns where id = v_c.campaign_id;
  select * into v_t from public.certificate_templates where id = v_k.template_id;
  v_tok := public.certificate_token_for(v_c.id, v_c.token_epoch);
  return jsonb_build_object(
    'certificate_id', v_c.id, 'certificate_number', v_c.certificate_number, 'certificate_type', v_k.certificate_type,
    'language', v_k.language, 'recipient_name', v_c.recipient_name, 'campaign_title', v_k.title,
    'activity_title', v_k.activity_title_snapshot, 'activity_date', v_k.activity_date_snapshot, 'issued_at', v_c.issued_at,
    'template_style', v_t.style, 'template_design', v_t.design, 'campaign_settings', v_k.settings,
    'public_name_mode', v_c.public_name_mode, 'token', v_tok, 'verification_path', '/verify-certificate/' || v_tok);
end;
$$;

-- ---------------------------------------------------------------------
-- 10) التحقق العام (anon): valid | revoked | not_found — بلا email/member_id/بيانات حساب. الاستجابة لغير الموجود موحّدة.
-- ---------------------------------------------------------------------
create or replace function public.verify_certificate(p_token text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_c public.certificates%rowtype;
  v_k public.certificate_campaigns%rowtype;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into v_c from public.certificates where token_hash = public.certificate_token_hash(p_token);
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into v_k from public.certificate_campaigns where id = v_c.campaign_id;
  if v_c.status = 'revoked' then
    -- الملغاة: لا اسم إطلاقًا
    return jsonb_build_object('status', 'revoked', 'certificate_number', v_c.certificate_number,
                              'certificate_type', v_k.certificate_type, 'issued_at', v_c.issued_at, 'revoked_at', v_c.revoked_at);
  end if;
  return jsonb_build_object(
    'status', 'valid', 'certificate_number', v_c.certificate_number, 'certificate_type', v_k.certificate_type,
    'language', v_k.language, 'campaign_title', v_k.title, 'activity_title', v_k.activity_title_snapshot,
    'activity_date', v_k.activity_date_snapshot, 'issued_at', v_c.issued_at,
    'holder_name', case v_c.public_name_mode
                     when 'full'   then v_c.recipient_name
                     when 'masked' then public.certificate_mask_name(v_c.recipient_name)
                     else null end);
end;
$$;

-- ---------------------------------------------------------------------
-- 11) المنح (المنح الصريحة فقط؛ لا شيء لـ anon عدا verify_certificate)
-- ---------------------------------------------------------------------
revoke all on function public.certificate_save_template(uuid, text, text, jsonb, boolean)                               from public, anon, authenticated;
revoke all on function public.certificate_create_campaign(text, text, text, uuid, uuid, text, text, jsonb)              from public, anon, authenticated;
revoke all on function public.certificate_update_campaign(uuid, text, uuid, text, text, jsonb)                          from public, anon, authenticated;
revoke all on function public.certificate_add_attendance_recipients(uuid)                                               from public, anon, authenticated;
revoke all on function public.certificate_add_member_recipient(uuid, uuid)                                              from public, anon, authenticated;
revoke all on function public.certificate_add_external_recipient(uuid, text, text)                                      from public, anon, authenticated;
revoke all on function public.certificate_remove_recipient(uuid)                                                        from public, anon, authenticated;
revoke all on function public.certificate_issue_campaign(uuid)                                                          from public, anon, authenticated;
revoke all on function public.certificate_revoke(uuid, text)                                                            from public, anon, authenticated;
revoke all on function public.certificate_archive_campaign(uuid)                                                        from public, anon, authenticated;
revoke all on function public.certificate_set_public_name_mode(uuid, text)                                              from public, anon, authenticated;
revoke all on function public.certificate_reissue_token(uuid)                                                           from public, anon, authenticated;
revoke all on function public.certificate_rotate_token_secret()                                                         from public, anon, authenticated;
revoke all on function public.certificate_review_campaigns()                                                            from public, anon, authenticated;
revoke all on function public.certificate_review_recipients(uuid)                                                       from public, anon, authenticated;
revoke all on function public.get_my_certificates()                                                                     from public, anon, authenticated;
revoke all on function public.get_certificate_render_data(uuid)                                                         from public, anon, authenticated;
revoke all on function public.verify_certificate(text)                                                                  from public, anon, authenticated;

grant execute on function public.certificate_save_template(uuid, text, text, jsonb, boolean)                             to authenticated;
grant execute on function public.certificate_create_campaign(text, text, text, uuid, uuid, text, text, jsonb)            to authenticated;
grant execute on function public.certificate_update_campaign(uuid, text, uuid, text, text, jsonb)                        to authenticated;
grant execute on function public.certificate_add_attendance_recipients(uuid)                                             to authenticated;
grant execute on function public.certificate_add_member_recipient(uuid, uuid)                                            to authenticated;
grant execute on function public.certificate_add_external_recipient(uuid, text, text)                                    to authenticated;
grant execute on function public.certificate_remove_recipient(uuid)                                                      to authenticated;
grant execute on function public.certificate_issue_campaign(uuid)                                                        to authenticated;
grant execute on function public.certificate_revoke(uuid, text)                                                          to authenticated;
grant execute on function public.certificate_archive_campaign(uuid)                                                      to authenticated;
grant execute on function public.certificate_set_public_name_mode(uuid, text)                                            to authenticated;
grant execute on function public.certificate_reissue_token(uuid)                                                         to authenticated;
grant execute on function public.certificate_rotate_token_secret()                                                       to authenticated;
grant execute on function public.certificate_review_campaigns()                                                          to authenticated;
grant execute on function public.certificate_review_recipients(uuid)                                                     to authenticated;
grant execute on function public.get_my_certificates()                                                                   to authenticated;
grant execute on function public.get_certificate_render_data(uuid)                                                       to authenticated;
grant execute on function public.verify_certificate(text)                                                                to anon, authenticated;

notify pgrst, 'reload schema';
commit;
