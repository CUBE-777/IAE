-- ============================================================
-- 0041_activity_attendance_down.sql — الرجوع عن 0041 (يحذف الكائنات الجديدة فقط)
-- ⚠️ يمحو بيانات الحضور المسجَّلة وبطاقات الحضور المنشورة. لا يمسّ الأنشطة ولا الأعضاء ولا 0040.
-- ⚠️ بعد الرجوع: زر «بطاقة الحضور» وقسم الحضور في /member/id يفشلان في الاستدعاء حتى تُزال الواجهة أو يُعاد تنفيذ 0041.
-- آمن لإعادة التشغيل.
-- ============================================================
begin;

drop function if exists public.get_attendance_cards_overview();
drop function if exists public.get_attendance_roster(uuid);
drop function if exists public.undo_attendance(uuid, uuid);
drop function if exists public.record_attendance_manual(uuid, uuid);
drop function if exists public.record_attendance(text);
drop function if exists public.get_my_attendance_cards();
drop function if exists public.close_attendance_card(uuid);
drop function if exists public.publish_attendance_card(uuid, boolean);
drop function if exists public.attendance_token_for(uuid, uuid, integer);
drop table if exists public.activity_attendance;
drop table if exists public.activity_attendance_tokens;
drop table if exists public.activity_attendance_cards;
drop table if exists public.attendance_secret;

notify pgrst, 'reload schema';
commit;
