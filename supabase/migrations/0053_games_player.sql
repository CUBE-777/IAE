-- ============================================================
-- 0053_games_player.sql — واجهة اللاعبين (IAE Games) — المرحلة 4: دالتا قراءة فقط
--
-- لماذا؟ (0049/0050/0052 مطبّقة ولا تُعدَّل)
--   1) لوحة الصدارة: RLS على game_points تحصر القراءة بصفوف اللاعب نفسه، فلا يمكن ترتيب اللاعبين من الواجهة.
--      get_game_leaderboard() دالة SECURITY DEFINER تُرجع الترتيب فقط: المرتبة والمستوى والنقاط واسمًا مختصرًا
--      («أحمد ب.»). لا بريد ولا معرّف مستخدم ولا اسم كامل. تتطلب can_access_games()، وصفّ اللاعب نفسه يُعلَّم is_me.
--   2) حالة التحديات للاعب: get_my_challenge_status() تجمّع في الخادم ما استُهلك من المحاولات (بنفس عدّ start_game_attempt)
--      وهل حُلّ التحدي وأفضل نتيجة وأي محاولة جارية صالحة؛ فتُظهر الواجهة «محاولات متبقية/استئناف/محلول» دون قوائم ضخمة.
--
-- كلتاهما قراءة فقط ولا تكشفان حلًّا ولا إجابة، ولا تمسّان أي جدول. الأصل: الرفض (can_access_games()).
-- آمن لإعادة التشغيل. الرجوع: supabase/rollback/0053_games_player_down.sql
-- ⚠️ تجربة جافة أولًا: استبدل `commit;` الأخيرة بـ `rollback;` ثم شغّل الملف، وإن نجح أعدها `commit;`.
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public.can_access_games()') is null
     or to_regprocedure('public.game_user_total(uuid)') is null
     or to_regprocedure('public.game_level_for_points(integer)') is null then
    raise exception 'شغّل 0049 و0050 أولاً';
  end if;
end $$;

-- اسم عام مختصر: الكلمة الأولى + أول حرف من الكلمة الأخيرة. null إن لم يوجد اسم.
create or replace function public.game_public_name(p_name text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when n is null or n = '' then null
    when array_length(w, 1) = 1 then left(w[1], 24)
    else left(w[1], 24) || ' ' || upper(left(w[array_length(w, 1)], 1)) || '.'
  end
  from (select nullif(btrim(coalesce(p_name, '')), '') as n) s,
       lateral (select regexp_split_to_array(coalesce(s.n, ''), '\s+') as w) x;
$$;
revoke all on function public.game_public_name(text) from public, anon, authenticated;

create or replace function public.get_game_leaderboard(p_limit integer default 20, p_offset integer default 0)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_off   integer := greatest(coalesce(p_offset, 0), 0);
  v_out   jsonb;
begin
  if v_uid is null or not public.can_access_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;

  with totals as (
    select gp.user_id, sum(gp.delta)::integer as total
      from public.game_points gp
     group by gp.user_id
    having sum(gp.delta) > 0
  ),
  ranked as (
    select t.user_id, t.total,
           rank() over (order by t.total desc) as rnk,
           public.game_public_name(coalesce(p.full_name, m.full_name)) as name
      from totals t
      left join public.profiles p on p.id = t.user_id
      left join public.member_accounts ma on ma.user_id = t.user_id
      left join public.members m on m.id = ma.member_id
  ),
  page as (
    select * from ranked order by rnk, name nulls last, user_id limit v_limit offset v_off
  )
  select jsonb_build_object(
           'total', (select count(*) from ranked),
           'rows', coalesce((select jsonb_agg(jsonb_build_object(
                       'rank', pg.rnk, 'display_name', pg.name, 'total_points', pg.total,
                       'level', (public.game_level_for_points(pg.total) ->> 'level')::integer,
                       'is_me', pg.user_id = v_uid) order by pg.rnk, pg.name nulls last, pg.user_id) from page pg), '[]'::jsonb),
           'me', (select jsonb_build_object('rank', r.rnk, 'display_name', r.name, 'total_points', r.total,
                                            'level', (public.game_level_for_points(r.total) ->> 'level')::integer)
                    from ranked r where r.user_id = v_uid))
    into v_out;

  return v_out;
end;
$$;

create or replace function public.get_my_challenge_status()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.can_access_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x))
      from (
        select a.challenge_id,
               count(*)::integer as attempts_used,
               coalesce(bool_or(r.is_correct), false) as solved,
               coalesce(max(r.score), 0) as best_score,
               max(a.started_at) as last_attempt_at,
               (array_agg(a.id order by a.started_at desc)
                  filter (where a.status = 'in_progress' and (a.expires_at is null or a.expires_at > now())))[1] as open_attempt_id,
               (array_agg(a.expires_at order by a.started_at desc)
                  filter (where a.status = 'in_progress' and (a.expires_at is null or a.expires_at > now())))[1] as open_expires_at
          from public.game_attempts a
          left join public.game_results r on r.attempt_id = a.id
         where a.user_id = v_uid
         group by a.challenge_id
      ) x), '[]'::jsonb);
end;
$$;

revoke all on function public.get_game_leaderboard(integer, integer) from public, anon, authenticated;
revoke all on function public.get_my_challenge_status()              from public, anon, authenticated;
grant execute on function public.get_game_leaderboard(integer, integer) to authenticated;
grant execute on function public.get_my_challenge_status()              to authenticated;

notify pgrst, 'reload schema';

commit;
