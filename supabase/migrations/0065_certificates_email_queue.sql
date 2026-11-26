-- ============================================================
-- 0065_certificates_email_queue.sql — نظام الشهادات، المرحلة 1 (ج): طابور البريد
--
-- ما يضيفه (دوال فقط؛ الجدولان certificate_email_queue / certificate_email_logs أُنشئا في 0063):
--   إدارة (can_manage_certificates): certificate_enqueue_email, certificate_enqueue_campaign_emails, certificate_retry_email
--   عامل الإرسال (service_role فقط — Edge Function لاحقًا؛ لا يُمنح لأي دور عميل):
--      certificate_email_claim_next, certificate_email_recheck, certificate_email_complete, certificate_email_release_stale
-- الأمان وسباق الإلغاء/الإرسال:
--   * الطابور مستقل عن حالة الشهادة. enqueue/retry/claim ترفض الشهادة الملغاة.
--   * ترتيب الأقفال الموحّد في كل المسارات (الإلغاء، enqueue، retry، claim): صف الشهادة أولًا ثم صف الطابور → لا deadlock.
--   * claim يستعمل FOR SHARE SKIP LOCKED على الشهادة وFOR UPDATE SKIP LOCKED على الطابور؛ وإن وُجدت شهادة ملغاة تُلغى مهمتها.
--   * مهمة واحدة نشطة (queued/sending) لكل شهادة (فهرس فريد جزئي).
--   * ⚠️ حدّ لا يمكن إزالته: إن أُلغيت الشهادة بعد claim وقبل/أثناء طلب HTTP لمزوّد البريد، قد يصل البريد.
--     الدوال تقلّص النافذة (certificate_email_recheck قبل الإرسال مباشرة) وتوثّق الحالة (event revoked_during_send)، ولا تضمن المنع.
--     البريد يحمل رابط تحقق/عرض لا PDF؛ فالرابط يعرض «ملغاة» بعد الإلغاء.
--   * أخطاء الإرسال تُسجَّل كرموز [a-z0-9_] فقط (لا نص حرّ ولا PII). لا عناوين بريد في السجلات أو audit.
--   * المهمة العالقة في sending تُحرَّر إلى failed (stale_sending) دون إعادة تلقائية، تفاديًا لتكرار الإرسال.
-- يتطلب: 0063 و0064. آمن لإعادة التشغيل. الرجوع: supabase/rollback/0065_certificates_email_queue_down.sql
-- ⚠️ تجربة جافة أولًا: استبدل `commit;` الأخيرة بـ `rollback;`.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.certificate_email_queue') is null or to_regprocedure('public.certificate_revoke(uuid,text)') is null then
    raise exception 'شغّل 0063 و0064 أولاً';
  end if;
  if to_regrole('service_role') is null then
    raise exception 'الدور service_role غير موجود (بيئة Supabase مطلوبة)';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) إدارة الطابور
-- ---------------------------------------------------------------------
create or replace function public.certificate_enqueue_email(p_certificate_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c public.certificates%rowtype;
  v_q uuid;
begin
  if auth.uid() is null or not public.can_manage_certificates() then
    raise exception 'غير مصرّح لك بهذه العملية' using errcode = '42501';
  end if;
  select * into v_c from public.certificates where id = p_certificate_id for update;   -- قفل الشهادة أولًا
  if not found then raise exception 'certificate_not_found' using errcode = 'P0002'; end if;
  if v_c.status <> 'valid' then raise exception 'certificate_revoked' using errcode = '22023'; end if;
  if v_c.recipient_email is null then raise exception 'certificate_no_email' using errcode = '22023'; end if;
  if exists (select 1 from public.certificate_email_queue q where q.certificate_id = v_c.id and q.status in ('queued', 'sending')) then
    raise exception 'certificate_email_already_queued' using errcode = '23505';
  end if;
  insert into public.certificate_email_queue (certificate_id, enqueued_by) values (v_c.id, auth.uid()) returning id into v_q;
  insert into public.certificate_email_logs (queue_id, certificate_id, event, attempt, actor) values (v_q, v_c.id, 'enqueued', 0, auth.uid());
  perform public.certificate_audit('certificate_email_enqueued', 'certificate', v_c.id, 'جدولة إرسال شهادة بالبريد',
    jsonb_build_object('queue_id', v_q));
  return v_q;
end;
$$;

-- إرسال أول مرة لكل الشهادات الصالحة ذات البريد (بلا مهمة نشطة ولا إرسال ناجح سابق). الحملة المؤرشفة مسموحة.
create or replace function public.certificate_enqueue_campaign_emails(p_campaign_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_n  integer := 0;
  v_c  public.certificates%rowtype;
begin
  if auth.uid() is null or not public.can_manage_certificates() then
    raise exception 'غير مصرّح لك بهذه العملية' using errcode = '42501';
  end if;
  if not exists (select 1 from public.certificate_campaigns where id = p_campaign_id) then
    raise exception 'certificate_campaign_not_found' using errcode = 'P0002';
  end if;
  for v_id in select c.id from public.certificates c
               where c.campaign_id = p_campaign_id and c.status = 'valid' and c.recipient_email is not null
               order by c.issued_at, c.id loop
    select * into v_c from public.certificates where id = v_id for update;       -- قفل الشهادة ثم إعادة الفحص
    if v_c.status <> 'valid' then continue; end if;
    if exists (select 1 from public.certificate_email_queue q where q.certificate_id = v_id and (q.status in ('queued', 'sending') or q.status = 'sent')) then
      continue;
    end if;
    insert into public.certificate_email_queue (certificate_id, enqueued_by) values (v_id, auth.uid());
    insert into public.certificate_email_logs (queue_id, certificate_id, event, attempt, actor)
      select q.id, v_id, 'enqueued', 0, auth.uid() from public.certificate_email_queue q
       where q.certificate_id = v_id and q.status = 'queued';
    v_n := v_n + 1;
  end loop;
  perform public.certificate_audit('certificate_emails_enqueued', 'certificate_campaign', p_campaign_id, 'جدولة إرسال شهادات حملة بالبريد',
    jsonb_build_object('count', v_n));
  return v_n;
end;
$$;

create or replace function public.certificate_retry_email(p_queue_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cert uuid;
  v_c    public.certificates%rowtype;
  v_q    public.certificate_email_queue%rowtype;
begin
  if auth.uid() is null or not public.can_manage_certificates() then
    raise exception 'غير مصرّح لك بهذه العملية' using errcode = '42501';
  end if;
  select certificate_id into v_cert from public.certificate_email_queue where id = p_queue_id;
  if not found then raise exception 'certificate_email_not_found' using errcode = 'P0002'; end if;
  select * into v_c from public.certificates where id = v_cert for update;       -- الشهادة أولًا
  select * into v_q from public.certificate_email_queue where id = p_queue_id for update;
  if v_q.status <> 'failed' then raise exception 'certificate_email_not_failed' using errcode = '22023'; end if;
  if v_c.status <> 'valid' then raise exception 'certificate_revoked' using errcode = '22023'; end if;
  if v_c.recipient_email is null then raise exception 'certificate_no_email' using errcode = '22023'; end if;
  update public.certificate_email_queue
     set status = 'queued', attempts = 0, next_attempt_at = now(), claimed_at = null, claimed_by = null, last_error_code = null
   where id = v_q.id;
  insert into public.certificate_email_logs (queue_id, certificate_id, event, attempt, actor) values (v_q.id, v_c.id, 'retried', 0, auth.uid());
  perform public.certificate_audit('certificate_email_retried', 'certificate', v_c.id, 'إعادة محاولة إرسال شهادة', jsonb_build_object('queue_id', v_q.id));
end;
$$;

-- ---------------------------------------------------------------------
-- 2) عامل الإرسال (service_role فقط)
-- ---------------------------------------------------------------------
-- يعيد مهمة واحدة (jsonb) أو null. الحمولة تحوي البريد والرمز: للعامل الخادمي فقط، لا تُسجَّل ولا تُعاد لأي client.
create or replace function public.certificate_email_claim_next(p_worker text default 'worker')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cand record;
  v_c    public.certificates%rowtype;
  v_q    public.certificate_email_queue%rowtype;
  v_k    public.certificate_campaigns%rowtype;
begin
  if p_worker is null or p_worker !~ '^[a-z0-9_:-]{1,60}$' then
    raise exception 'certificate_email_bad_worker' using errcode = '22023';
  end if;
  for v_cand in
    select q.id, q.certificate_id from public.certificate_email_queue q
     where q.status = 'queued' and q.next_attempt_at <= now()
     order by q.next_attempt_at, q.id limit 10
  loop
    -- الشهادة أولًا (مشاركة): إن كان الإلغاء ممسكًا بها نتخطّاها هذه الدورة
    select * into v_c from public.certificates where id = v_cand.certificate_id for share skip locked;
    if not found then continue; end if;
    select * into v_q from public.certificate_email_queue where id = v_cand.id for update skip locked;
    if not found or v_q.status <> 'queued' then continue; end if;

    if v_c.status <> 'valid' or v_c.recipient_email is null then
      update public.certificate_email_queue
         set status = 'cancelled', last_error_code = case when v_c.status <> 'valid' then 'certificate_revoked' else 'no_email' end
       where id = v_q.id;
      insert into public.certificate_email_logs (queue_id, certificate_id, event, attempt)
        values (v_q.id, v_c.id, case when v_c.status <> 'valid' then 'cancelled_revoked' else 'failed' end, v_q.attempts);
      continue;
    end if;

    update public.certificate_email_queue
       set status = 'sending', attempts = attempts + 1, claimed_at = now(), claimed_by = p_worker, last_error_code = null
     where id = v_q.id;
    insert into public.certificate_email_logs (queue_id, certificate_id, event, attempt) values (v_q.id, v_c.id, 'claimed', v_q.attempts + 1);

    select * into v_k from public.certificate_campaigns where id = v_c.campaign_id;
    return jsonb_build_object(
      'queue_id', v_q.id, 'certificate_id', v_c.id, 'attempt', v_q.attempts + 1,
      'to_email', v_c.recipient_email, 'recipient_name', v_c.recipient_name,
      'certificate_number', v_c.certificate_number, 'certificate_type', v_k.certificate_type,
      'language', v_k.language, 'campaign_title', v_k.title,
      'token', public.certificate_token_for(v_c.id, v_c.token_epoch));
  end loop;
  return null;
end;
$$;

-- فحص أخير قبل طلب HTTP مباشرة: false = لا ترسل (الشهادة ملغاة أو المهمة لم تعد sending)
create or replace function public.certificate_email_recheck(p_queue_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  return exists (
    select 1 from public.certificate_email_queue q
      join public.certificates c on c.id = q.certificate_id
     where q.id = p_queue_id and q.status = 'sending' and c.status = 'valid');
end;
$$;

create or replace function public.certificate_email_complete(p_queue_id uuid, p_success boolean, p_error_code text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cert uuid;
  v_c    public.certificates%rowtype;
  v_q    public.certificate_email_queue%rowtype;
  v_code text := coalesce(p_error_code, 'unknown_error');
  v_new  text;
begin
  if v_code !~ '^[a-z0-9_]{1,40}$' then v_code := 'invalid_error_code'; end if;
  select certificate_id into v_cert from public.certificate_email_queue where id = p_queue_id;
  if not found then raise exception 'certificate_email_not_found' using errcode = 'P0002'; end if;
  select * into v_c from public.certificates where id = v_cert for share;        -- الشهادة أولًا
  select * into v_q from public.certificate_email_queue where id = p_queue_id for update;
  if v_q.status <> 'sending' then raise exception 'certificate_email_not_sending' using errcode = '22023'; end if;

  if coalesce(p_success, false) then
    update public.certificate_email_queue set status = 'sent', sent_at = now(), last_error_code = null where id = v_q.id;
    insert into public.certificate_email_logs (queue_id, certificate_id, event, attempt) values (v_q.id, v_c.id, 'sent', v_q.attempts);
    v_new := 'sent';
  elsif v_c.status <> 'valid' then
    update public.certificate_email_queue set status = 'cancelled', last_error_code = 'certificate_revoked' where id = v_q.id;
    insert into public.certificate_email_logs (queue_id, certificate_id, event, attempt, error_code)
      values (v_q.id, v_c.id, 'cancelled_revoked', v_q.attempts, v_code);
    v_new := 'cancelled';
  elsif v_q.attempts >= v_q.max_attempts then
    update public.certificate_email_queue set status = 'failed', last_error_code = v_code where id = v_q.id;
    insert into public.certificate_email_logs (queue_id, certificate_id, event, attempt, error_code) values (v_q.id, v_c.id, 'failed', v_q.attempts, v_code);
    v_new := 'failed';
  else
    update public.certificate_email_queue
       set status = 'queued', last_error_code = v_code, claimed_at = null, claimed_by = null,
           next_attempt_at = now() + make_interval(mins => v_q.attempts * v_q.attempts)
     where id = v_q.id;
    insert into public.certificate_email_logs (queue_id, certificate_id, event, attempt, error_code) values (v_q.id, v_c.id, 'retry_scheduled', v_q.attempts, v_code);
    v_new := 'queued';
  end if;

  -- أُلغيت أثناء الإرسال: يُوثَّق إن لم يكن موثّقًا
  if v_c.status <> 'valid' and v_new = 'sent'
     and not exists (select 1 from public.certificate_email_logs l where l.queue_id = v_q.id and l.event = 'revoked_during_send') then
    insert into public.certificate_email_logs (queue_id, certificate_id, event, attempt) values (v_q.id, v_c.id, 'revoked_during_send', v_q.attempts);
  end if;

  if v_new in ('sent', 'failed') then
    perform public.certificate_audit(case when v_new = 'sent' then 'certificate_email_sent' else 'certificate_email_failed' end,
      'certificate', v_c.id, case when v_new = 'sent' then 'إرسال شهادة بالبريد' else 'فشل إرسال شهادة بالبريد' end,
      jsonb_build_object('queue_id', v_q.id, 'attempt', v_q.attempts));
  end if;
  return v_new;
end;
$$;

create or replace function public.certificate_email_release_stale(p_older_than_minutes integer default 15)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer := 0;
  v_r record;
begin
  for v_r in
    select q.id, q.certificate_id from public.certificate_email_queue q
     where q.status = 'sending' and q.claimed_at < now() - make_interval(mins => greatest(coalesce(p_older_than_minutes, 15), 1))
     order by q.claimed_at limit 100
  loop
    perform 1 from public.certificates where id = v_r.certificate_id for share;   -- نفس ترتيب الأقفال
    update public.certificate_email_queue set status = 'failed', last_error_code = 'stale_sending'
     where id = v_r.id and status = 'sending';
    if found then
      insert into public.certificate_email_logs (queue_id, certificate_id, event, error_code)
        values (v_r.id, v_r.certificate_id, 'stale_released', 'stale_sending');
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) المنح
-- ---------------------------------------------------------------------
revoke all on function public.certificate_enqueue_email(uuid)               from public, anon, authenticated;
revoke all on function public.certificate_enqueue_campaign_emails(uuid)     from public, anon, authenticated;
revoke all on function public.certificate_retry_email(uuid)                 from public, anon, authenticated;
revoke all on function public.certificate_email_claim_next(text)            from public, anon, authenticated;
revoke all on function public.certificate_email_recheck(uuid)               from public, anon, authenticated;
revoke all on function public.certificate_email_complete(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.certificate_email_release_stale(integer)      from public, anon, authenticated;

grant execute on function public.certificate_enqueue_email(uuid)            to authenticated;
grant execute on function public.certificate_enqueue_campaign_emails(uuid)  to authenticated;
grant execute on function public.certificate_retry_email(uuid)              to authenticated;
grant execute on function public.certificate_email_claim_next(text)         to service_role;
grant execute on function public.certificate_email_recheck(uuid)            to service_role;
grant execute on function public.certificate_email_complete(uuid, boolean, text) to service_role;
grant execute on function public.certificate_email_release_stale(integer)   to service_role;

notify pgrst, 'reload schema';
commit;
