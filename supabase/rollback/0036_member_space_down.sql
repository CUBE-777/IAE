-- ============================================================
-- 0036_member_space_down.sql — الرجوع عن 0036 (يحذف الكائنات الجديدة فقط)
-- ⚠️ يمحو روابط التفعيل وطلبات تعديل البطاقة. لا يحذف حسابات Auth ولا member_accounts ولا الصور المرفوعة.
-- آمن لإعادة التشغيل.
-- ============================================================
begin;

drop policy if exists "member_card_photo_insert" on storage.objects;
drop policy if exists "member_card_photo_manager_select" on storage.objects;
drop function if exists public.member_card_photo_upload_allowed(text);

drop function if exists public.reject_member_card_request(uuid, text);
drop function if exists public.approve_member_card_request(uuid, text);
drop function if exists public.cancel_my_member_card_request();
drop function if exists public.submit_member_card_request(jsonb, text);
drop function if exists public.update_my_member_private(jsonb);
drop function if exists public.get_my_member();
drop function if exists public.finalize_member_activation(text, uuid);
drop function if exists public.prepare_member_activation(text);
drop function if exists public.get_member_activation_link(text);
drop function if exists public.issue_member_activation_link(uuid);

drop table if exists public.member_card_requests cascade;
drop table if exists public.member_activation_links cascade;

notify pgrst, 'reload schema';
commit;
