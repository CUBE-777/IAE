-- ============================================================
-- 0064_certificates_admin_functions_down.sql — الرجوع عن 0064 (يحذف الدوال فقط؛ لا يحذف أي بيانات ولا جداول)
-- يُرفض إن وُجدت شهادات مُصدَرة (حذف verify_certificate/certificate_revoke يعطّل التحقق العام والإلغاء)، أو إن بقيت دوال 0065.
-- نفّذ 0065_down أولًا. آمن لإعادة التشغيل.
-- ============================================================
begin;

do $$
begin
  if to_regprocedure('public.certificate_email_claim_next(text)') is not null then
    raise exception 'رُفض الرجوع: نفّذ 0065_certificates_email_queue_down.sql أولًا';
  end if;
  if to_regclass('public.certificates') is not null and exists (select 1 from public.certificates) then
    raise exception 'رُفض الرجوع: توجد شهادات مُصدَرة؛ حذف الدوال يعطّل التحقق العام والإلغاء. عالج الأمر يدويًا';
  end if;
end $$;

drop function if exists public.verify_certificate(text);
drop function if exists public.get_certificate_render_data(uuid);
drop function if exists public.get_my_certificates();
drop function if exists public.certificate_review_recipients(uuid);
drop function if exists public.certificate_review_campaigns();
drop function if exists public.certificate_rotate_token_secret();
drop function if exists public.certificate_reissue_token(uuid);
drop function if exists public.certificate_set_public_name_mode(uuid, text);
drop function if exists public.certificate_archive_campaign(uuid);
drop function if exists public.certificate_revoke(uuid, text);
drop function if exists public.certificate_issue_campaign(uuid);
drop function if exists public.certificate_remove_recipient(uuid);
drop function if exists public.certificate_add_external_recipient(uuid, text, text);
drop function if exists public.certificate_add_member_recipient(uuid, uuid);
drop function if exists public.certificate_add_attendance_recipients(uuid);
drop function if exists public.certificate_update_campaign(uuid, text, uuid, text, text, jsonb);
drop function if exists public.certificate_create_campaign(text, text, text, uuid, uuid, text, text, jsonb);
drop function if exists public.certificate_save_template(uuid, text, text, jsonb, boolean);
drop function if exists public.certificate_mask_name(text);
drop function if exists public.certificate_next_number();
drop function if exists public.certificate_token_hash(text);
drop function if exists public.certificate_token_for(uuid, integer);

notify pgrst, 'reload schema';
commit;
