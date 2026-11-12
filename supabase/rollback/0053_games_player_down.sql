-- 0053_games_player_down.sql — الرجوع عن 0053 (لا يمسّ أي بيانات). آمن لإعادة التشغيل.
begin;
drop function if exists public.get_my_challenge_status();
drop function if exists public.get_game_leaderboard(integer, integer);
drop function if exists public.game_public_name(text);
notify pgrst, 'reload schema';
commit;
