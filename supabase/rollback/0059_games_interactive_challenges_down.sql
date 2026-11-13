-- ============================================================
-- 0059_games_interactive_challenges_down.sql — الرجوع عن 0059 (قراءة محتوى المحاولة من إصدارها المثبَّت)
--
-- يُسقط دوال القراءة التي أضافتها 0059 فقط. لا يمسّ جداول ولا بيانات ولا سياسات ولا 0050–0058.
-- ⚠️ بعد الرجوع: واجهة اللاعب (6.5) تعتمد على هاتين الدالتين لاستئناف المحاولات وعرض الإصدار المثبَّت؛
--    إن بقيت الواجهة الجديدة منشورة فستفشل قراءة التحدي وتظهر رسالة خطأ. ارجع إلى واجهة 6.4 قبل تنفيذ هذا الملف.
-- آمن لإعادة التشغيل.
-- ============================================================
begin;

drop function if exists public.get_my_open_attempt_challenge(uuid);
drop function if exists public.get_my_attempt_challenge(uuid);
drop function if exists public.game_attempt_play_payload(uuid, uuid);

notify pgrst, 'reload schema';

commit;
