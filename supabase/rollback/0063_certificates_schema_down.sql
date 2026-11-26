-- ============================================================
-- 0063_certificates_schema_down.sql — الرجوع عن 0063 (يحذف الكائنات الجديدة فقط؛ لا يمسّ جداول النظام ولا audit_logs)
-- يُرفض بلا حذف أي شيء إن وُجدت بيانات: حملات، شهادات، مستفيدون، طابور/سجلات بريد، عدّادات أرقام، أو قوالب غير النظامية.
-- (القوالب الأربعة الافتراضية وصفّ السرّ الابتدائي يُحذفان لأنهما بذرة الـ migration نفسها.) نفّذ 0065 ثم 0064 down أولًا. آمن لإعادة التشغيل.
-- ⚠️ سجلات audit_logs التي كتبتها هذه الميزة لا تُحذف (غير قابلة للتعديل بحسب 0008).
-- ============================================================
begin;

do $$
begin
  if to_regprocedure('public.verify_certificate(text)') is not null or to_regprocedure('public.certificate_email_claim_next(text)') is not null then
    raise exception 'رُفض الرجوع: نفّذ 0065 ثم 0064 down أولًا';
  end if;
  if to_regclass('public.certificates') is not null and (
        exists (select 1 from public.certificates)
     or exists (select 1 from public.certificate_campaigns)
     or exists (select 1 from public.certificate_recipients)
     or exists (select 1 from public.certificate_email_queue)
     or exists (select 1 from public.certificate_email_logs)
     or exists (select 1 from public.certificate_number_counters)
     or exists (select 1 from public.certificate_templates where not is_system)) then
    raise exception 'رُفض الرجوع: توجد بيانات شهادات. لا يحذف هذا الملف أي بيانات؛ عالج الأمر يدويًا';
  end if;
end $$;

drop table if exists public.certificate_email_logs;
drop table if exists public.certificate_email_queue;
drop table if exists public.certificate_recipients;
drop table if exists public.certificates;
drop table if exists public.certificate_campaigns;
drop table if exists public.certificate_templates;
drop table if exists public.certificate_number_counters;
drop table if exists public.certificate_token_secret;

drop function if exists public.certificate_email_logs_guard();
drop function if exists public.certificate_email_queue_guard();
drop function if exists public.certificate_recipients_guard();
drop function if exists public.certificates_guard();
drop function if exists public.certificate_campaigns_guard();
drop function if exists public.certificate_audit(text, text, uuid, text, jsonb);
drop function if exists public.can_review_certificate_recipients();
drop function if exists public.can_manage_certificates();
drop function if exists public.can_admin_certificates();
drop function if exists public.certificate_random_bytes(integer);
drop function if exists public.certificate_hmac(bytea, bytea);

notify pgrst, 'reload schema';
commit;
