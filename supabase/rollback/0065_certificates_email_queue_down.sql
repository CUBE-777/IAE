-- ============================================================
-- 0065_certificates_email_queue_down.sql — الرجوع عن 0065 (يحذف دوال الطابور فقط؛ لا يحذف أي بيانات ولا جداول)
-- يُرفض إن وُجدت مهام نشطة (queued/sending): أوقف العامل أولًا ثم ألغِها أو انتظر اكتمالها.
-- بعد الرجوع: الجدولان certificate_email_queue / certificate_email_logs وسجلاتهما تبقى كما هي. آمن لإعادة التشغيل.
-- ============================================================
begin;

do $$
begin
  if to_regclass('public.certificate_email_queue') is not null
     and exists (select 1 from public.certificate_email_queue where status in ('queued', 'sending')) then
    raise exception 'رُفض الرجوع: توجد مهام بريد نشطة (queued/sending). أوقف العامل وأنهِها أولًا';
  end if;
end $$;

drop function if exists public.certificate_email_release_stale(integer);
drop function if exists public.certificate_email_complete(uuid, boolean, text);
drop function if exists public.certificate_email_recheck(uuid);
drop function if exists public.certificate_email_claim_next(text);
drop function if exists public.certificate_retry_email(uuid);
drop function if exists public.certificate_enqueue_campaign_emails(uuid);
drop function if exists public.certificate_enqueue_email(uuid);

notify pgrst, 'reload schema';
commit;
