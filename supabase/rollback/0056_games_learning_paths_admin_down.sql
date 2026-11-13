-- ============================================================
-- 0056_games_learning_paths_admin_down.sql — الرجوع عن 0056 (إدارة المسارات + فتح/إكمال المراحل)
--
-- يعيد game_attempts_bind وsubmit_game_attempt إلى تعريف 0055 حرفيًا (فيعود رفض كل تحدٍّ في فئة غير free بـ stage_lock_not_enforced)،
-- ويُسقط الدوال المضافة، ويعيد DELETE على المسارات/الفئات/المراحل لـ authenticated (بحماية سياسات RLS من 0055).
-- لا يحذف جداول ولا بيانات ولا منحًا ولا audit_logs. لا يمسّ 0055 (تبقى مطبّقة). آمن لإعادة التشغيل.
-- ============================================================
begin;

create or replace function public.game_attempts_bind()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stage   uuid;
  v_version uuid;
  v_mode    text;
begin
  if tg_op = 'UPDATE' then
    if new.challenge_version_id is distinct from old.challenge_version_id
       and (old.challenge_version_id is not null or coalesce(current_setting('iae.games_publish', true), '') <> '1') then
      raise exception 'attempt_version_locked';
    end if;
    return new;
  end if;

  select ch.stage_id, ch.current_version_id into v_stage, v_version
    from public.game_challenges ch where ch.id = new.challenge_id for share;   -- يرتّب البدء مع نشر متزامن
  new.challenge_version_id := v_version;

  if v_stage is not null then
    select tc.stage_unlock_mode into v_mode
      from public.game_stages s
      join public.game_track_categories tc on tc.id = s.category_id
      join public.game_tracks t on t.id = tc.track_id
     where s.id = v_stage and s.status = 'published' and tc.status = 'published' and t.status = 'published';
    if not found then
      raise exception 'stage_not_available';
    end if;
    if v_mode <> 'free' then
      raise exception 'stage_lock_not_enforced';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.submit_game_attempt(p_attempt_id uuid, p_answer jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  a          public.game_attempts%rowtype;
  c          public.game_challenges%rowtype;
  v_mode     text;
  v_solution jsonb;
  v_points   integer;
  v_correct  boolean;
  v_result   uuid;
  v_awarded  integer := 0;
  v_ach      jsonb;
  v_total    integer;
begin
  if v_uid is null or not public.can_access_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;
  if p_answer is null or octet_length(p_answer::text) > 20000 then
    raise exception 'invalid_answer';
  end if;

  -- محاولتي أنا فقط (محاولة غيري تظهر كغير موجودة)
  select * into a from public.game_attempts where id = p_attempt_id and user_id = v_uid for update;
  if not found then
    raise exception 'attempt_not_found';
  end if;
  if a.status <> 'in_progress' then
    raise exception 'attempt_already_finished';
  end if;

  select ch.* into c
    from public.game_challenges ch
    join public.games g on g.id = ch.game_id
   where ch.id = a.challenge_id and ch.status = 'published' and g.status = 'published';
  if not found then
    raise exception 'challenge_not_available';
  end if;

  -- انتهت المهلة (سماح 3 ثوانٍ لتأخّر الشبكة): تُغلق دون نتيجة ولا نقاط
  if a.expires_at is not null and now() > a.expires_at + interval '3 seconds' then
    update public.game_attempts set status = 'expired', finished_at = now() where id = a.id;
    return jsonb_build_object('status', 'expired', 'is_correct', false, 'score', 0, 'points_awarded', 0,
                              'total_points', public.game_user_total(v_uid), 'achievements', '[]'::jsonb);
  end if;

  -- الحلّ والنقاط من إصدار المحاولة نفسه (لا من الإصدار الجاري). بلا إصدار (محاولة/تحدٍّ قديم): الحلّ الحيّ القديم كما كان.
  if a.challenge_version_id is not null then
    select vs.verify_mode, vs.solution, v.points_reward into v_mode, v_solution, v_points
      from public.game_challenge_versions v
      left join public.game_challenge_version_solutions vs on vs.version_id = v.id
     where v.id = a.challenge_version_id;
  else
    v_points := c.points_reward;
    select gs.verify_mode, gs.solution into v_mode, v_solution
      from public.game_challenge_solutions gs where gs.challenge_id = a.challenge_id;
  end if;
  if v_mode is distinct from 'exact' then
    raise exception 'verification_unavailable';
  end if;
  v_correct := public.game_verify_answer(v_mode, v_solution, p_answer);

  update public.game_attempts set status = 'submitted', finished_at = now(), answer = p_answer where id = a.id;

  insert into public.game_results (attempt_id, user_id, challenge_id, is_correct, score, duration_ms)
  values (a.id, v_uid, a.challenge_id, v_correct, case when v_correct then 100 else 0 end,
          (extract(epoch from (now() - a.started_at)) * 1000)::bigint)
  returning id into v_result;

  -- النقاط: صحيحة + أول حلّ لهذا التحدي فقط (الفهرس الفريد يضمن عدم التكرار حتى مع التزامن)
  if v_correct and v_points > 0 then
    insert into public.game_points (user_id, delta, reason, challenge_id, result_id)
    values (v_uid, v_points, 'challenge_solved', a.challenge_id, v_result)
    on conflict (user_id, challenge_id) where reason = 'challenge_solved' do nothing
    returning delta into v_awarded;
    v_awarded := coalesce(v_awarded, 0);
  end if;

  v_ach := public.game_grant_achievements(v_uid);
  v_total := public.game_user_total(v_uid);

  return jsonb_build_object(
    'status', 'submitted', 'is_correct', v_correct, 'score', case when v_correct then 100 else 0 end,
    'points_awarded', v_awarded, 'total_points', v_total,
    'level', public.game_level_for_points(v_total), 'achievements', v_ach);
end;
$$;

drop function if exists public.admin_get_game_stage_status(uuid, uuid);
drop function if exists public.admin_list_game_stage_grants(uuid);
drop function if exists public.admin_revoke_game_stage_grant(uuid);
drop function if exists public.admin_grant_game_stage(uuid, uuid, text, text);
drop function if exists public.admin_set_game_challenge_stage(uuid, uuid, boolean);
drop function if exists public.admin_reorder_game_path_items(text, uuid[]);

drop function if exists public.game_stage_is_unlocked(uuid, uuid);
drop function if exists public.game_stage_is_complete(uuid, uuid);
drop function if exists public.game_stage_chain_published(uuid);
drop function if exists public.game_user_is_player(uuid);

grant delete on public.game_tracks, public.game_track_categories, public.game_stages to authenticated;

notify pgrst, 'reload schema';

commit;
