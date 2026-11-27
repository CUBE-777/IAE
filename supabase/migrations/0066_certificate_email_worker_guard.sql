-- ============================================================
-- 0066_certificate_email_worker_guard.sql — شهادات: حارس هوية عامل البريد (قبل تفعيل Edge Function)
--
-- المشكلة في 0065:
--   * certificate_email_recheck(uuid) تتحقق من status='sending' وحالة الشهادة فقط، دون التحقق أن المهمة محجوزة (claimed_by)
--     لهذا العامل بالذات. أي استدعاء service_role يستطيع «فحص» أو «إكمال» مهمة حجزها عامل آخر.
--   * certificate_email_complete(uuid, boolean, text) كذلك: لا تربط الإكمال بهوية الحاجز، فيمكن لعامل متأخر/مكرّر
--     (بعد أن حرّرت release_stale مهمته ثم حجزها عامل جديد) أن يُكمل مهمة ليست له فيُسجَّل «sent» أو «retry» خطأً.
--
-- ما تفعله هذه الـ migration (دوال فقط؛ لا جداول ولا بيانات):
--   1) certificate_email_recheck(p_queue_id uuid, p_worker text) → boolean
--        true فقط إن: المهمة sending + claimed_by = p_worker + الشهادة valid + للشهادة بريد. أي شيء آخر → false (fail-closed).
--   2) certificate_email_complete(p_queue_id uuid, p_worker text, p_success boolean, p_error_code text)
--        نفس سلوك 0065 تمامًا + يرفض (42501 certificate_email_worker_mismatch) إن لم يطابق claimed_by هوية العامل.
--   3) حذف التوقيعين القديمين غير المحروسين (recheck(uuid) و complete(uuid, boolean, text)) كي لا يبقى مسار بلا تحقق.
--      ⚠️ لذلك لا تُشغّل العامل القديم/أي عميل يستدعي التوقيع القديم بعد تطبيق هذه الـ migration.
--   4) EXECUTE: service_role فقط للدالتين الجديدتين؛ وفحص نهائي يُسقط الـ migration إن كان أي من دوال العامل الأربع
--      (claim_next / recheck / complete / release_stale) قابلًا للتنفيذ لـ anon أو authenticated أو PUBLIC.
--
-- لا يغيّر: RLS، Auth، 0063–0065، certificate_email_claim_next، certificate_email_release_stale، دوال الإدارة (enqueue/retry).
-- حدّ لا يمكن إزالته (موثّق في 0065): إلغاء الشهادة بعد recheck وقبل وصول الطلب لمزوّد البريد قد لا يمنع الرسالة؛
--   البريد يحمل رابط تحقق لا PDF، والرابط يعرض «ملغاة» بعد الإلغاء.
-- يتطلب: 0063 و0064 و0065. آمن لإعادة التشغيل. الرجوع: supabase/rollback/0066_certificate_email_worker_guard_down.sql
-- ⚠️ تجربة جافة أولًا: استبدل `commit;` الأخيرة بـ `rollback;`. لا تُطبَّق تلقائيًا؛ طبّقها يدويًا ثم انشر Edge Function.
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public.certificate_email_claim_next(text)') is null
     or to_regprocedure('public.certificate_email_complete(uuid,boolean,text)') is null
     and to_regprocedure('public.certificate_email_complete(uuid,text,boolean,text)') is null then
    raise exception 'شغّل 0063 و0064 و0065 أولاً';
  end if;
  if to_regrole('service_role') is null then
    raise exception 'الدور service_role غير موجود (بيئة Supabase مطلوبة)';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) فحص أخير قبل طلب HTTP: يربط الفحص بهوية العامل الحاجز
-- ---------------------------------------------------------------------
create or replace function public.certificate_email_recheck(p_queue_id uuid, p_worker text)
returns boolean
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if p_queue_id is null or p_worker is null or p_worker !~ '^[a-z0-9_:-]{1,60}$' then
    return false;
  end if;
  return exists (
    select 1 from public.certificate_email_queue q
      join public.certificates c on c.id = q.certificate_id
     where q.id = p_queue_id
       and q.status = 'sending'
       and q.claimed_by = p_worker
       and c.status = 'valid'
       and c.recipient_email is not null);
end;
$$;

-- ---------------------------------------------------------------------
-- 2) إكمال المهمة: الحاجز وحده يُكملها (بقية المنطق مطابق لـ 0065)
-- ---------------------------------------------------------------------
create or replace function public.certificate_email_complete(p_queue_id uuid, p_worker text, p_success boolean, p_error_code text default null)
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
  if p_worker is null or p_worker !~ '^[a-z0-9_:-]{1,60}$' then
    raise exception 'certificate_email_bad_worker' using errcode = '22023';
  end if;
  if v_code !~ '^[a-z0-9_]{1,40}$' then v_code := 'invalid_error_code'; end if;
  select certificate_id into v_cert from public.certificate_email_queue where id = p_queue_id;
  if not found then raise exception 'certificate_email_not_found' using errcode = 'P0002'; end if;
  select * into v_c from public.certificates where id = v_cert for share;        -- الشهادة أولًا (نفس ترتيب الأقفال)
  select * into v_q from public.certificate_email_queue where id = p_queue_id for update;
  if v_q.status <> 'sending' then raise exception 'certificate_email_not_sending' using errcode = '22023'; end if;
  if v_q.claimed_by is distinct from p_worker then
    raise exception 'certificate_email_worker_mismatch' using errcode = '42501';   -- ليست مهمتك
  end if;

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

-- ---------------------------------------------------------------------
-- 3) إزالة المسارين القديمين بلا تحقق هوية
-- ---------------------------------------------------------------------
drop function if exists public.certificate_email_recheck(uuid);
drop function if exists public.certificate_email_complete(uuid, boolean, text);

-- ---------------------------------------------------------------------
-- 4) المنح: service_role فقط
-- ---------------------------------------------------------------------
revoke all on function public.certificate_email_recheck(uuid, text)                      from public, anon, authenticated;
revoke all on function public.certificate_email_complete(uuid, text, boolean, text)      from public, anon, authenticated;
revoke all on function public.certificate_email_claim_next(text)                         from public, anon, authenticated;
revoke all on function public.certificate_email_release_stale(integer)                   from public, anon, authenticated;

grant execute on function public.certificate_email_recheck(uuid, text)                   to service_role;
grant execute on function public.certificate_email_complete(uuid, text, boolean, text)   to service_role;
grant execute on function public.certificate_email_claim_next(text)                      to service_role;
grant execute on function public.certificate_email_release_stale(integer)                to service_role;

-- فحص نهائي: لا EXECUTE لأي دور عميل (has_function_privilege يشمل PUBLIC لأن anon/authenticated يرثانه)
do $$
declare
  v_sig text;
  v_role text;
begin
  foreach v_sig in array array[
    'public.certificate_email_claim_next(text)',
    'public.certificate_email_recheck(uuid,text)',
    'public.certificate_email_complete(uuid,text,boolean,text)',
    'public.certificate_email_release_stale(integer)'] loop
    if to_regprocedure(v_sig) is null then
      raise exception 'دالة العامل غير موجودة: %', v_sig;
    end if;
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_function_privilege(v_role, v_sig, 'EXECUTE') then
        raise exception 'EXECUTE مفتوح لـ % على % — أُلغيت الـ migration', v_role, v_sig;
      end if;
    end loop;
    if not has_function_privilege('service_role', v_sig, 'EXECUTE') then
      raise exception 'service_role بلا EXECUTE على %', v_sig;
    end if;
  end loop;
  if to_regprocedure('public.certificate_email_recheck(uuid)') is not null
     or to_regprocedure('public.certificate_email_complete(uuid,boolean,text)') is not null then
    raise exception 'بقي توقيع قديم غير محروس';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
