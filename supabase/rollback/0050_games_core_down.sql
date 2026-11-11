-- ============================================================
-- 0050_games_core_down.sql — الرجوع عن 0050 (نواة الألعاب)
--
-- ⚠️ يحذف جداول الألعاب كلها وبياناتها (ألعاب، تحديات، محاولات، نتائج، نقاط، إنجازات، مستويات) ودوالها.
-- لا يمسّ 0049 (can_access_games / get_games_access) ولا أي جدول أو دالة قائمة قبل 0050.
-- بلا CASCADE عمدًا: إن وُجد معتمِد غير متوقّع (ملفات 0051+) يفشل الحذف باسمه؛ ارجع عنه أولًا.
-- آمن لإعادة التشغيل.
-- ============================================================
begin;

-- الجداول: الأبناء أولًا (المشغّلات والسياسات تُحذف معها)
drop table if exists public.game_user_achievements;
drop table if exists public.game_points;
drop table if exists public.game_results;
drop table if exists public.game_attempts;
drop table if exists public.game_challenge_solutions;
drop table if exists public.game_challenges;
drop table if exists public.games;
drop table if exists public.game_categories;
drop table if exists public.game_achievements;
drop table if exists public.game_levels;

-- الدوال: عكس ترتيب الاعتماد
drop function if exists public.admin_adjust_game_points(uuid, integer, text);
drop function if exists public.get_my_game_summary();
drop function if exists public.submit_game_attempt(uuid, jsonb);
drop function if exists public.start_game_attempt(uuid);
drop function if exists public.game_grant_achievements(uuid);
drop function if exists public.game_verify_answer(text, jsonb, jsonb);
drop function if exists public.game_next_level_for_points(integer);
drop function if exists public.game_level_for_points(integer);
drop function if exists public.game_user_total(uuid);
drop function if exists public.game_points_immutable();
drop function if exists public.game_results_immutable();
drop function if exists public.can_manage_games();

notify pgrst, 'reload schema';
commit;
