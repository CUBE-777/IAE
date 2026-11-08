-- ============================================================
-- 0040_member_card_tokens_down.sql — الرجوع عن 0040 (يحذف الكائنات الجديدة فقط)
-- ⚠️ يمحو رموز البطاقة الحالية (قصيرة العمر أصلًا). لا يمسّ الأعضاء ولا العضويات ولا الحسابات ولا جدول 0038/0039.
-- ⚠️ أحداث الحدّ التي كتبتها الدالتان في member_activation_throttle (بصمات مجزّأة بالملح) تبقى وتُنظَّف وحدها بعد يوم.
-- ⚠️ بعد الرجوع: واجهة /member/id و/verify/:token تفشلان في الاستدعاء حتى تُزال أو يُعاد تنفيذ 0040.
-- آمن لإعادة التشغيل.
-- ============================================================
begin;

drop function if exists public.get_my_membership_status();
drop function if exists public.verify_member_card(text);
drop function if exists public.issue_member_card_token();
drop table if exists public.member_card_tokens;

notify pgrst, 'reload schema';
commit;
