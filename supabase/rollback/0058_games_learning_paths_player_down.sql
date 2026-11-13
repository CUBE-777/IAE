-- ============================================================
-- 0058_games_learning_paths_player_down.sql — الرجوع عن 0058 (تجربة اللاعب لمسارات التعلم + إصلاح استئناف المحاولات)
--
-- يعيد start_game_attempt إلى تعريف 0057 حرفيًا
-- (⚠️ فيعود الخلل: التحقق من نشر التحدي/اللعبة/التصنيف قبل الاستئناف، فلا تُستأنف محاولة جارية بعد سحب نشر محتواها).
-- ويُسقط دوال القراءة التي أضافتها 0058 (RPC اللاعب والمساعدات الداخلية). لا يمسّ جداول ولا بيانات ولا 0050–0057.
-- آمن لإعادة التشغيل.
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

  -- 6.3: فتح المرحلة يُتحقَّق منه هنا، عند بدء محاولة «جديدة» فقط (بعد فرع الاستئناف أعلاه عمدًا).
  --      المحاولة التي بدأت صحيحة تُستأنف وتُسلَّم لاحقًا دون إعادة فحص الفتح (انظر submit_game_attempt)،
  --      فلا يعلقها سحبُ منحٍ أو تغيّر وضع الفئة أو نقل التحدي أو أرشفة المرحلة بعد بدئها.
  --      المشغّل game_attempts_bind (0056) يبقى خطّ دفاع ثانيًا على الإدراج نفسه.
  if c.stage_id is not null then
    if not public.game_stage_chain_published(c.stage_id) then
      raise exception 'stage_not_available';
    end if;
    if not public.game_stage_is_unlocked(c.stage_id, v_uid) then
      raise exception 'stage_locked';
    end if;
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

revoke all on function public.start_game_attempt(uuid) from public, anon, authenticated;
grant execute on function public.start_game_attempt(uuid) to authenticated;

drop function if exists public.get_my_learning_stage(uuid);
drop function if exists public.get_my_learning_track(uuid);
drop function if exists public.get_my_learning_tracks(uuid);
drop function if exists public.game_stage_lock_reason(uuid, uuid);
drop function if exists public.game_stage_progress(uuid, uuid);
drop function if exists public.game_learning_stage_visible(uuid);

notify pgrst, 'reload schema';

commit;
