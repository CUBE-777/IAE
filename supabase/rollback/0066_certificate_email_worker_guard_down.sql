-- ============================================================
-- 0066_certificate_email_worker_guard_down.sql — الرجوع عن 0066 (يعيد توقيعي 0065 غير المحروسين؛ لا يمسّ بيانات ولا جداول)
-- يُرفض إن وُجدت مهام sending: أوقف العامل (Cron) أولًا وانتظر انتهاءها أو حرّرها بـ certificate_email_release_stale.
-- بعد الرجوع: لا تُشغّل Edge Function الجديدة (تستدعي التوقيعين المحروسين). لإزالة دوال البريد كلها طبّق بعده 0065_down.
-- آمن لإعادة التشغيل.
-- ============================================================
begin;

do $$
begin
  if to_regclass('public.certificate_email_queue') is not null
     and exists (select 1 from public.certificate_email_queue where status = 'sending') then
    raise exception 'رُفض الرجوع: توجد مهام sending. أوقف العامل وانتظر انتهاءها أولًا';
  end if;
end $$;

drop function if exists public.certificate_email_complete(uuid, text, boolean, text);
drop function if exists public.certificate_email_recheck(uuid, text);

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
  select * into v_c from public.certificates where id = v_cert for share;
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

revoke all on function public.certificate_email_recheck(uuid)                  from public, anon, authenticated;
revoke all on function public.certificate_email_complete(uuid, boolean, text)  from public, anon, authenticated;
grant execute on function public.certificate_email_recheck(uuid)               to service_role;
grant execute on function public.certificate_email_complete(uuid, boolean, text) to service_role;

notify pgrst, 'reload schema';
commit;
