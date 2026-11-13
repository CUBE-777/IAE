-- ============================================================
-- 0055_games_learning_paths_down.sql — الرجوع عن 0055 (Learning Paths: أساس قاعدة البيانات)
--
-- يعيد سياسة game_challenges_select وsubmit_game_attempt إلى تعريف 0050، وadmin_delete_game_challenge وadmin_delete_game إلى تعريف 0052،
-- ويحذف المشغّلات والدوال والأعمدة والجداول المضافة. لا تبقى أي دالة أو مشغّل من 0055.
-- ⚠️ يحذف نهائيًا: المسارات/الفئات/المراحل، كل إصدارات التحديات وحلولها (ومنها لقطات «إصدار 0»)، المنح اليدوية،
--    وربط المحاولات بالإصدارات (game_attempts.challenge_version_id) وارتباط التحديات بالمراحل.
--    لا يمسّ المحاولات ولا النتائج ولا النقاط ولا audit_logs. محتوى/حلّ التحدي الحيّ يبقى كما أسقطه آخر نشر.
-- آمن لإعادة التشغيل.
-- ============================================================
begin;

-- الدوال القائمة إلى تعريفها الأصلي (لا تعتمد على أي كائن من 0055)
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
  s          public.game_challenge_solutions%rowtype;
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

  select * into s from public.game_challenge_solutions where challenge_id = a.challenge_id;
  if not found or s.verify_mode <> 'exact' then
    raise exception 'verification_unavailable';
  end if;
  v_correct := public.game_verify_answer(s.verify_mode, s.solution, p_answer);

  update public.game_attempts set status = 'submitted', finished_at = now(), answer = p_answer where id = a.id;

  insert into public.game_results (attempt_id, user_id, challenge_id, is_correct, score, duration_ms)
  values (a.id, v_uid, a.challenge_id, v_correct, case when v_correct then 100 else 0 end,
          (extract(epoch from (now() - a.started_at)) * 1000)::bigint)
  returning id into v_result;

  -- النقاط: صحيحة + أول حلّ لهذا التحدي فقط (الفهرس الفريد يضمن عدم التكرار حتى مع التزامن)
  if v_correct and c.points_reward > 0 then
    insert into public.game_points (user_id, delta, reason, challenge_id, result_id)
    values (v_uid, c.points_reward, 'challenge_solved', a.challenge_id, v_result)
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

create or replace function public.admin_delete_game_challenge(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.can_manage_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.game_challenges where id = p_id) then
    raise exception 'challenge_not_found';
  end if;
  if exists (select 1 from public.game_attempts where challenge_id = p_id)
     or exists (select 1 from public.game_points where challenge_id = p_id) then
    update public.game_challenges set status = 'archived' where id = p_id;
    return jsonb_build_object('result', 'archived');
  end if;
  delete from public.game_challenges where id = p_id;
  return jsonb_build_object('result', 'deleted');
end;
$$;

create or replace function public.admin_delete_game(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.can_manage_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.games where id = p_id) then
    raise exception 'game_not_found';
  end if;
  if exists (select 1
               from public.game_challenges c
              where c.game_id = p_id
                and (exists (select 1 from public.game_attempts a where a.challenge_id = c.id)
                     or exists (select 1 from public.game_points pt where pt.challenge_id = c.id))) then
    update public.game_challenges set status = 'archived' where game_id = p_id and status <> 'archived';
    update public.games set status = 'archived' where id = p_id;
    return jsonb_build_object('result', 'archived');
  end if;
  delete from public.games where id = p_id;
  return jsonb_build_object('result', 'deleted');
end;
$$;

-- السياسة (تشير إلى game_challenges.stage_id) (تشير إلى game_challenges.stage_id)
drop policy if exists game_challenges_select on public.game_challenges;
create policy game_challenges_select on public.game_challenges for select to authenticated
  using (
    (select public.can_access_games())
    and (
      (select public.can_manage_games())
      or (status = 'published'
          and (starts_at is null or starts_at <= now())
          and (ends_at is null or ends_at > now())
          and exists (select 1
                        from public.games g
                        join public.game_categories gc on gc.id = g.category_id
                       where g.id = game_challenges.game_id and g.status = 'published' and gc.is_active))
    )
  );

drop trigger if exists trg_game_attempts_bind_insert on public.game_attempts;
drop trigger if exists trg_game_attempts_bind_update on public.game_attempts;
drop trigger if exists trg_game_challenges_version_guard on public.game_challenges;
drop trigger if exists trg_game_challenge_solutions_version_guard on public.game_challenge_solutions;
drop trigger if exists trg_game_stages_mode_guard on public.game_stages;
drop trigger if exists trg_game_track_categories_mode_guard on public.game_track_categories;
drop trigger if exists trg_game_challenge_versions_guard on public.game_challenge_versions;
drop trigger if exists trg_game_challenge_version_solutions_guard on public.game_challenge_version_solutions;
drop trigger if exists trg_game_stage_grants_validate on public.game_stage_grants;
drop trigger if exists trg_game_stage_grants_audit on public.game_stage_grants;

drop index if exists public.idx_game_attempts_version;
drop index if exists public.idx_game_challenges_stage;

alter table public.game_attempts   drop constraint if exists fk_game_attempts_version;
alter table public.game_attempts   drop column if exists challenge_version_id;
alter table public.game_challenges drop constraint if exists fk_game_challenges_current_version;
alter table public.game_challenges drop constraint if exists fk_game_challenges_stage;
alter table public.game_challenges drop column if exists current_version_id;
alter table public.game_challenges drop column if exists is_required;
alter table public.game_challenges drop column if exists stage_id;

drop table if exists public.game_stage_grants;
drop table if exists public.game_challenge_version_solutions;
drop table if exists public.game_challenge_versions;
drop table if exists public.game_stages;
drop table if exists public.game_track_categories;
drop table if exists public.game_tracks;

drop function if exists public.admin_publish_game_challenge_version(uuid);
drop function if exists public.game_attempts_bind();
drop function if exists public.game_challenge_solutions_version_guard();
drop function if exists public.game_challenges_version_guard();
drop function if exists public.game_challenge_version_solutions_guard();
drop function if exists public.game_challenge_versions_guard();
drop function if exists public.game_stage_grants_audit();
drop function if exists public.game_stage_grants_validate();
drop function if exists public.game_stage_mode_guard();

notify pgrst, 'reload schema';
commit;
