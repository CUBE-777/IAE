-- ============================================================
-- 0039_member_access_requests_down.sql — الرجوع عن 0039 (يحذف الكائنات الجديدة فقط)
-- ⚠️ يمحو طلبات المساعدة في الدخول. لا يمسّ الأعضاء ولا الحسابات ولا جدول 0038.
-- ⚠️ بعد الرجوع: واجهة /member/help ولوحة الإدارة ستفشلان في الاستدعاء حتى تُزال أو يُعاد تنفيذ 0039.
-- آمن لإعادة التشغيل.
-- ============================================================
begin;

drop function if exists public.resolve_member_access_request(uuid, text);
drop function if exists public.request_member_access_help(text);
drop table if exists public.member_access_requests;

notify pgrst, 'reload schema';
commit;
