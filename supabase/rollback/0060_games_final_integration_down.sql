-- ============================================================
-- 0060_games_final_integration_down.sql — الرجوع عن 0060 (حراسة التحدي القديم ذي المحاولات + منع مفاتيح الحلول)
--
-- يعيد حارسَي 0055 كما كانا حرفيًا (الحماية فقط لتحدٍّ له current_version_id) ويُسقط مشغّل/دالة content_has_answer.
-- لا يمسّ جداول ولا بيانات ولا سياسات ولا 0050–0059.
-- ⚠️ بعد الرجوع يعود الخلل: تعديل حيّ لمحتوى/حلّ تحدٍّ قديم له محاولات جارية عبر المحرر القديم.
-- آمن لإعادة التشغيل.
-- ============================================================
begin;

drop trigger if exists trg_game_challenges_content_guard on public.game_challenges;
drop function if exists public.game_challenges_content_guard();

create or replace function public.game_challenges_version_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('iae.games_publish', true), '') = '1' then
    return new;
  end if;
  if new.current_version_id is distinct from old.current_version_id then
    raise exception 'version_pointer_locked';
  end if;
  if old.current_version_id is not null
     and (new.title, new.description, new.difficulty, new.points_reward, new.time_limit_seconds, new.max_attempts, new.content)
         is distinct from
         (old.title, old.description, old.difficulty, old.points_reward, old.time_limit_seconds, old.max_attempts, old.content) then
    raise exception 'challenge_versioned';
  end if;
  return new;
end;
$$;

create or replace function public.game_challenge_solutions_version_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- إدراج/تعديل: يُستثنى النشر فقط (الإسقاط الحيّ). الحذف لا يُستثنى أبدًا.
  if tg_op <> 'DELETE' and coalesce(current_setting('iae.games_publish', true), '') = '1' then
    return new;
  end if;
  if exists (select 1 from public.game_challenges c
              where c.id = case when tg_op = 'DELETE' then old.challenge_id else new.challenge_id end
                and c.current_version_id is not null) then
    raise exception 'challenge_versioned';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.game_challenges_version_guard()          from public, anon, authenticated;
revoke all on function public.game_challenge_solutions_version_guard() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
