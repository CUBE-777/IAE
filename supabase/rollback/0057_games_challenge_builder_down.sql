-- ============================================================
-- 0057_games_challenge_builder_down.sql — الرجوع عن 0057 (Challenge Builder + إصلاح المحاولات الجارية)
--
-- يعيد start_game_attempt إلى تعريف 0050 حرفيًا، وsubmit_game_attempt إلى تعريف 0056 حرفيًا
-- (⚠️ فيعود الخلل: رفض تسليم محاولة بدأت صحيحة إن تغيّر فتح مرحلتها، وبقاؤها in_progress).
-- ويُسقط ما أضافته 0057: مشغّل تحقق النشر، RPC المسودّات، دوال التحقق، وعمود feedback مع قيده
-- (⚠️ يحذف نصوص شرح الإجابة المحفوظة في المسودّات/الإصدارات؛ الإصدارات والحلول والمحاولات والنتائج لا تُمسّ).
-- لا يمسّ 0055/0056 ولا بيانات اللاعبين. آمن لإعادة التشغيل.
-- ============================================================
begin;

create or replace function public.start_game_attempt(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  c         public.game_challenges%rowtype;
  v_open    public.game_attempts%rowtype;
  v_new     public.game_attempts%rowtype;
  v_count   integer;
begin
  if v_uid is null or not public.can_access_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;

  select ch.* into c
    from public.game_challenges ch
    join public.games g on g.id = ch.game_id
    join public.game_categories gc on gc.id = g.category_id
   where ch.id = p_challenge_id
     and ch.status = 'published' and g.status = 'published' and gc.is_active;
  if not found then
    raise exception 'challenge_not_available';
  end if;
  if (c.starts_at is not null and c.starts_at > now()) or (c.ends_at is not null and c.ends_at <= now()) then
    raise exception 'challenge_not_open';
  end if;

  -- تسلسل طلبات اللاعب نفسه على التحدي نفسه (يمنع سباق فتح محاولتين أو تجاوز max_attempts)
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_challenge_id::text, 0));

  -- أغلق ما انتهت مهلته
  update public.game_attempts
     set status = 'expired', finished_at = expires_at
   where user_id = v_uid and challenge_id = p_challenge_id
     and status = 'in_progress' and expires_at is not null and expires_at <= now();

  select * into v_open from public.game_attempts
   where user_id = v_uid and challenge_id = p_challenge_id and status = 'in_progress';
  if found then
    return jsonb_build_object('attempt_id', v_open.id, 'challenge_id', p_challenge_id, 'status', v_open.status,
                              'started_at', v_open.started_at, 'expires_at', v_open.expires_at, 'resumed', true);
  end if;

  select count(*) into v_count from public.game_attempts
   where user_id = v_uid and challenge_id = p_challenge_id;
  if c.max_attempts is not null and v_count >= c.max_attempts then
    raise exception 'max_attempts_reached';
  end if;

  -- سقف عام ضد الإغراق: 120 محاولة/ساعة للاعب
  select count(*) into v_count from public.game_attempts
   where user_id = v_uid and started_at > now() - interval '1 hour';
  if v_count >= 120 then
    raise exception 'rate_limited';
  end if;

  insert into public.game_attempts (user_id, challenge_id, expires_at)
  values (v_uid, p_challenge_id,
          case when c.time_limit_seconds is null then null else now() + make_interval(secs => c.time_limit_seconds) end)
  returning * into v_new;

  return jsonb_build_object('attempt_id', v_new.id, 'challenge_id', p_challenge_id, 'status', v_new.status,
                            'started_at', v_new.started_at, 'expires_at', v_new.expires_at, 'resumed', false);
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

  -- تحدٍّ داخل مرحلة: تُعاد المطابقة هنا (سُحب المنح/أُرشفت المرحلة/تغيّر وضع الفئة بعد بدء المحاولة) — fail closed
  if c.stage_id is not null and not public.game_stage_is_unlocked(c.stage_id, v_uid) then
    raise exception 'stage_locked';
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

drop trigger if exists trg_game_challenge_versions_validate_publish on public.game_challenge_versions;
drop function if exists public.game_challenge_versions_validate_publish();
drop function if exists public.admin_save_game_challenge_draft(uuid, uuid, jsonb);
drop function if exists public.game_builder_validate(text, jsonb, jsonb, jsonb, boolean);
drop function if exists public.game_builder_check_options(jsonb, text, integer, integer, boolean);
drop function if exists public.game_builder_has_forbidden_key(jsonb);
drop function if exists public.game_builder_markers(text);
drop function if exists public.game_builder_solution_ok(jsonb, text[]);
drop function if exists public.game_builder_same_set(text[], text[]);
drop function if exists public.game_builder_keys(jsonb);
drop function if exists public.game_builder_literal_ok(jsonb, integer);
drop function if exists public.game_builder_text_ok(jsonb, text, integer, boolean);

alter table public.game_challenge_version_solutions drop constraint if exists game_version_solutions_feedback_check;
alter table public.game_challenge_version_solutions drop column if exists feedback;

notify pgrst, 'reload schema';

commit;
