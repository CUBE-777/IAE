-- 0054_games_server_clock_down.sql — الرجوع عن 0054 (لا يمسّ أي بيانات). آمن لإعادة التشغيل.
-- الواجهة تتراجع تلقائيًا إلى تقدير الانحراف من started_at عند غياب الدالة.
begin;
drop function if exists public.get_game_server_time();
notify pgrst, 'reload schema';
commit;
