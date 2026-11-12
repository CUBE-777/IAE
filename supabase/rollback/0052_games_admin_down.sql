-- ============================================================
-- 0052_games_admin_down.sql — الرجوع عن 0052 (لوحة إدارة الألعاب)
--
-- يعيد can_manage_games() إلى تعريف 0050 (can_access_games() و can_manage_content()) ويعيد صلاحيات الحذف/الكتابة المباشرة
-- ويحذف المشغّلات والدوال الإدارية المضافة. لا يمسّ أي بيانات ولا سجلات audit_logs التي كُتبت.
-- ⚠️ بعد الرجوع تعود إدارة الألعاب لأدوار المحتوى كلها (editor وغيره). آمن لإعادة التشغيل.
-- ============================================================
begin;

drop trigger if exists trg_game_admin_audit on public.game_categories;
drop trigger if exists trg_game_admin_audit on public.games;
drop trigger if exists trg_game_admin_audit on public.game_challenges;
drop trigger if exists trg_game_admin_audit on public.game_challenge_solutions;
drop trigger if exists trg_game_admin_audit on public.game_achievements;
drop trigger if exists trg_game_admin_audit on public.game_levels;
drop trigger if exists trg_game_challenges_guard on public.game_challenges;
drop trigger if exists trg_game_achievements_validate on public.game_achievements;
drop trigger if exists trg_game_levels_guard on public.game_levels;

drop function if exists public.admin_get_game_player_progress(uuid);
drop function if exists public.admin_get_game_player(uuid);
drop function if exists public.admin_list_game_players(text, integer, integer);
drop function if exists public.admin_reorder_game_items(text, uuid[]);
drop function if exists public.admin_delete_game(uuid);
drop function if exists public.admin_delete_game_challenge(uuid);
drop function if exists public.admin_save_game_challenge(uuid, jsonb);
drop function if exists public.game_admin_audit();
drop function if exists public.game_levels_guard();
drop function if exists public.game_achievements_validate();
drop function if exists public.game_challenges_guard();

grant delete on public.game_categories, public.games, public.game_challenges, public.game_achievements to authenticated;
grant insert, update, delete on public.game_challenge_solutions to authenticated;

create or replace function public.can_manage_games()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.can_access_games() and coalesce(public.can_manage_content(), false);
$$;
revoke all on function public.can_manage_games() from public, anon, authenticated;
grant execute on function public.can_manage_games() to authenticated;

notify pgrst, 'reload schema';
commit;
