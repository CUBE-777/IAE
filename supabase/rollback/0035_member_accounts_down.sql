-- ============================================================
-- 0035_member_accounts_down.sql — الرجوع عن 0035 (يحذف الكائنات الجديدة فقط)
--
-- يحذف: جدول member_accounts (مع سياساته ومشغّلاته) ودوال can_manage_member_system و current_member_id و member_accounts_guard.
-- لا يمسّ: profiles, members, auth.users، ولا أي دالة أو سياسة سابقة.
--
-- ⚠️ حذف الجدول يمحو روابط حسابات الأعضاء (user_id ← member_id). مستخدمو Supabase Auth الذين أُنشئوا لهم لا يُحذفون:
--    احذفهم من لوحة Authentication → Users إن لم تعد تريدهم (لا صلاحية لهم على شيء بدون هذا الجدول).
-- آمن لإعادة التشغيل.
-- ============================================================

begin;

drop table if exists public.member_accounts cascade;

drop function if exists public.member_accounts_guard();
drop function if exists public.current_member_id();
drop function if exists public.can_manage_member_system();

notify pgrst, 'reload schema';

commit;
