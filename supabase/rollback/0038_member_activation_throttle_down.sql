-- ============================================================
-- 0038_member_activation_throttle_down.sql — الرجوع عن 0038 (يحذف الدالة والجدول الجديدين فقط)
-- ⚠️ بعد الرجوع تبقى member-activate الجديدة تعمل: عند فشل استدعاء الدالة تعود إلى الحدّ المحلي في الذاكرة.
-- آمن لإعادة التشغيل.
-- ============================================================
begin;

drop function if exists public.member_activation_throttle_hit(text);
drop table if exists public.member_activation_throttle;

notify pgrst, 'reload schema';
commit;
