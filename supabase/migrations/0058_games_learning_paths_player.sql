-- ============================================================
-- 0058_games_learning_paths_player.sql — Learning Paths (IAE Games) — المرحلة 6.4: تجربة اللاعب + إصلاح استئناف المحاولات
--
-- يبني على 0055 و0056 و0057 (مطبّقة ولا تُعدَّل). جزءان في معاملة واحدة:
--
-- (أ) إصلاح start_game_attempt (خلل 6.3): كانت تتحقق من نشر التحدي/اللعبة/التصنيف «قبل» البحث عن المحاولة المفتوحة،
--     فيُمنع اللاعب من استئناف محاولة بدأت صحيحة إن سُحب نشر التحدي أو اللعبة أو التصنيف لاحقًا.
--     الترتيب الجديد:
--       1) صلاحية الألعاب (can_access_games) + تسلسل طلبات اللاعب نفسه على التحدي نفسه (قفل استشاري كما كان).
--       2) إغلاق ما انتهت مهلته من محاولات هذا اللاعب لهذا التحدي (لا استئناف لمحاولة منتهية).
--       3) محاولة in_progress «لهذا المستخدم وهذا التحدي» ⇒ تُستأنف فورًا اعتمادًا على challenge_version_id المثبَّت فيها:
--          لا فحص نشر ولا نافذة زمنية ولا فتح مرحلة ولا مكان التحدي الحالي؛ لا إنشاء محاولة جديدة؛ لا تغيير للإصدار المثبَّت
--          (المشغّل game_attempts_bind لا يعمل إلا عند INSERT، ويمنع تغيير الإصدار عند UPDATE).
--       4) بلا محاولة مفتوحة ⇒ كل الفحوص «الكاملة»: نشر التحدي/اللعبة/التصنيف، starts_at/ends_at، سلسلة المرحلة (إن وُجدت) وفتحها،
--          وجود إصدار صالح (منشور بحلّ exact، أو حلّ حيّ exact لتحدٍّ قديم بلا إصدارات)، max_attempts، السقف العام، ثم الإدراج.
--     submit_game_attempt لا تُمسّ: هي أصلًا (0057) تسلّم على الإصدار المثبَّت وتتحقق من الملكية والحالة والمهلة وصلاحية الإصدار والحلّ
--     ولا تعيد فحص النشر الحالي ولا الفتح الحالي.
--
-- (ب) القراءة الخادمية لتجربة اللاعب (بلا جداول جديدة، ولا نظام تقدّم موازٍ):
--     مساعدات داخلية (بلا EXECUTE لأي دور عميل) تبني على دوال 0056 دون تكرار منطقها:
--       game_learning_stage_visible(stage)          : سلسلة اللعبة ← المسار ← الفئة ← المرحلة منشورة، وتصنيف اللعبة فعّال.
--       game_stage_progress(stage, user)            : أرقام العرض (نسبة/عدّادات/المتبقي). «الإكمال» نفسه من game_stage_is_complete (0056) حصرًا.
--       game_stage_lock_reason(stage, user)         : سبب القفل (يدوي / سابقة غير مكتملة) من القواعد نفسها في game_stage_is_unlocked.
--     RPC للاعب (SECURITY DEFINER، STABLE، تتحقق من can_access_games، EXECUTE لـ authenticated فقط):
--       get_my_learning_tracks(p_game_id)           : مساراتي المنشورة مع ملخص التقدّم.
--       get_my_learning_track(p_track_id)           : شجرة المسار ← الفئات ← المراحل (حالة كل مرحلة وتقدّمها وسبب قفلها).
--       get_my_learning_stage(p_stage_id)           : مرحلة واحدة: الشرط والمتبقي والسابقة/التالية وتحدياتها (بلا محتوى ولا حلول).
--     كلها تعيد المنشور فقط حتى للمدير (لا تعتمد على RLS التي تُظهر للمدير كل شيء)، وكل قيمة (فتح/إكمال/نسبة) تُحسب على الخادم.
--     التحدي القادم (starts_at في المستقبل) يُعاد بلا عنوان ولا وصف (نفس قاعدة RLS: لا يُرى قبل موعده) لكنه يُحتسب في العدّاد.
--     لا يُعاد content ولا أي عمود حلّ ولا feedback.
--
-- لا يعدّل can_access_games/get_games_access ولا 0050–0057. start_game_attempt هي الدالة الوحيدة المعاد تعريفها.
-- يتطلب: 0050 و0055 و0056 و0057. آمن لإعادة التشغيل. الرجوع: supabase/rollback/0058_games_learning_paths_player_down.sql
-- ⚠️ تجربة جافة أولًا: استبدل `commit;` الأخيرة بـ `rollback;` ثم شغّل الملف، وإن نجح أعدها `commit;`.
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public.game_stage_is_unlocked(uuid,uuid)') is null
     or to_regprocedure('public.game_stage_is_complete(uuid,uuid)') is null
     or to_regprocedure('public.game_stage_chain_published(uuid)') is null then
    raise exception 'شغّل 0056_games_learning_paths_admin.sql أولاً';
  end if;
  if to_regprocedure('public.game_builder_validate(text,jsonb,jsonb,jsonb,boolean)') is null then
    raise exception 'شغّل 0057_games_challenge_builder.sql أولاً';
  end if;
  if to_regclass('public.game_challenge_versions') is null or to_regclass('public.game_challenge_version_solutions') is null then
    raise exception 'شغّل 0055_games_learning_paths.sql أولاً';
  end if;
  if to_regprocedure('public.can_access_games()') is null then
    raise exception 'شغّل 0049_games_access.sql أولاً';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- (أ) إصلاح بدء/استئناف المحاولة. ACL تُثبَّت صراحةً أسفل الملف (authenticated فقط كما في 0050).
-- ---------------------------------------------------------------------
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
  v_valid   boolean;
begin
  if v_uid is null or not public.can_access_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;

  -- تسلسل طلبات اللاعب نفسه على التحدي نفسه (يمنع سباق فتح محاولتين أو تجاوز max_attempts)
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_challenge_id::text, 0));

  -- أغلق ما انتهت مهلته (المحاولة المنتهية لا تُستأنف)
  update public.game_attempts
     set status = 'expired', finished_at = expires_at
   where user_id = v_uid and challenge_id = p_challenge_id
     and status = 'in_progress' and expires_at is not null and expires_at <= now();

  -- 6.4: الاستئناف أولًا. محاولتي أنا فقط (user_id = auth.uid())، وتستمر على إصدارها المثبَّت مهما تغيّر نشر المحتوى
  --      أو فتح المرحلة أو مكان التحدي بعد بدئها. لا فحص نشر ولا نافذة زمنية هنا، ولا إنشاء محاولة جديدة، ولا مسّ بالإصدار.
  select * into v_open from public.game_attempts
   where user_id = v_uid and challenge_id = p_challenge_id and status = 'in_progress'
   order by started_at desc
   limit 1;
  if found then
    return jsonb_build_object('attempt_id', v_open.id, 'challenge_id', p_challenge_id, 'status', v_open.status,
                              'started_at', v_open.started_at, 'expires_at', v_open.expires_at, 'resumed', true);
  end if;

  -- محاولة «جديدة»: كل الفحوص الكاملة. FOR SHARE على صفّ التحدي يثبّت الإصدار الجاري الذي يفحصه هذا المسار
  -- حتى يُدرَج (المشغّل game_attempts_bind يقرأ الإصدار الجاري بالقفل نفسه).
  select ch.* into c
    from public.game_challenges ch
    join public.games g on g.id = ch.game_id
    join public.game_categories gc on gc.id = g.category_id
   where ch.id = p_challenge_id
     and ch.status = 'published' and g.status = 'published' and gc.is_active
     for share of ch;
  if not found then
    raise exception 'challenge_not_available';
  end if;
  if (c.starts_at is not null and c.starts_at > now()) or (c.ends_at is not null and c.ends_at <= now()) then
    raise exception 'challenge_not_open';
  end if;

  -- سلسلة المرحلة (مسار/فئة/مرحلة منشورة) وفتحها لهذا اللاعب. المشغّل game_attempts_bind (0056) خطّ دفاع ثانٍ على الإدراج نفسه.
  if c.stage_id is not null then
    if not public.game_stage_chain_published(c.stage_id) then
      raise exception 'stage_not_available';
    end if;
    if not public.game_stage_is_unlocked(c.stage_id, v_uid) then
      raise exception 'stage_locked';
    end if;
  end if;

  -- إصدار صالح: لتحدٍّ ذي إصدارات = الإصدار الجاري منشور وله حلّ exact؛ لتحدٍّ قديم بلا إصدارات = حلّه الحيّ exact.
  if c.current_version_id is not null then
    select exists (
      select 1
        from public.game_challenge_versions v
        join public.game_challenge_version_solutions vs on vs.version_id = v.id
       where v.id = c.current_version_id and v.challenge_id = c.id
         and v.status = 'published' and vs.verify_mode = 'exact'
    ) into v_valid;
  else
    select exists (
      select 1 from public.game_challenge_solutions gs
       where gs.challenge_id = c.id and gs.verify_mode = 'exact'
    ) into v_valid;
  end if;
  if not v_valid then
    raise exception 'challenge_not_available';
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

-- ---------------------------------------------------------------------
-- (ب) 1) مساعدات داخلية (بلا EXECUTE لأي دور عميل)
-- ---------------------------------------------------------------------

-- سلسلة المحتوى كاملة للاعب: لعبة منشورة بتصنيف فعّال ← مسار ← فئة ← مرحلة (كلها منشورة)
create or replace function public.game_learning_stage_visible(p_stage_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.game_stages s
      join public.game_track_categories tc on tc.id = s.category_id and tc.game_id = s.game_id
      join public.game_tracks t on t.id = tc.track_id and t.game_id = tc.game_id
      join public.games g on g.id = t.game_id
      join public.game_categories gc on gc.id = g.category_id
     where s.id = p_stage_id
       and s.status = 'published' and tc.status = 'published' and t.status = 'published'
       and g.status = 'published' and gc.is_active
  );
$$;

-- أرقام العرض. is_complete من game_stage_is_complete (0056) وحدها؛ الباقي عدّادات بنفس تعريفات 0056:
--   «المحلول» = نتيجة صحيحة واحدة على الأقل · «المعتدّ بها» = تحديات المرحلة المنشورة غير المنتهية.
create or replace function public.game_stage_progress(p_stage_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  s          public.game_stages%rowtype;
  v_total    integer := 0;
  v_solved   integer := 0;
  v_req      integer := 0;
  v_req_done integer := 0;
  v_points   bigint  := 0;
  v_complete boolean;
  v_pct      numeric := 0;
  v_thr      integer;
  v_manual   boolean := null;
begin
  if p_stage_id is null or p_user_id is null then
    return null;
  end if;
  select * into s from public.game_stages where id = p_stage_id;
  if not found then
    return null;
  end if;
  v_thr := s.completion_threshold;

  select count(*)::integer,
         (count(*) filter (where x.solved))::integer,
         (count(*) filter (where x.is_required))::integer,
         (count(*) filter (where x.is_required and x.solved))::integer
    into v_total, v_solved, v_req, v_req_done
    from (select c.is_required,
                 exists (select 1 from public.game_results r
                          where r.user_id = p_user_id and r.challenge_id = c.id and r.is_correct) as solved
            from public.game_challenges c
           where c.stage_id = s.id and c.status = 'published'
             and (c.ends_at is null or c.ends_at > now())) x;

  select coalesce(sum(pt.delta), 0) into v_points
    from public.game_points pt
    join public.game_challenges c on c.id = pt.challenge_id
   where pt.user_id = p_user_id and pt.reason = 'challenge_solved' and c.stage_id = s.id;

  if s.completion_mode = 'manual' then
    v_manual := exists (select 1 from public.game_stage_grants gr
                         where gr.stage_id = s.id and gr.user_id = p_user_id and gr.kind = 'complete');
  end if;

  v_complete := public.game_stage_is_complete(s.id, p_user_id);

  if s.completion_mode = 'all_required' then
    v_pct := case when v_req > 0 then v_req_done * 100.0 / v_req else 0 end;
  elsif s.completion_mode = 'min_success_rate' then
    v_pct := case when v_total > 0 and coalesce(v_thr, 0) > 0 then (v_solved * 10000.0) / (v_total * v_thr) else 0 end;
  elsif s.completion_mode = 'min_points' then
    v_pct := case when coalesce(v_thr, 0) > 0 then v_points * 100.0 / v_thr else 0 end;
  else
    v_pct := case when v_total > 0 then v_solved * 100.0 / v_total else 0 end;   -- manual: معلومة فقط، الاعتماد بمنحة
  end if;
  v_pct := case when v_complete then 100 else least(99, greatest(0, floor(v_pct))) end;

  return jsonb_build_object(
    'mode', s.completion_mode,
    'threshold', v_thr,
    'is_complete', v_complete,
    'percent', v_pct::integer,
    'total', v_total,
    'solved', v_solved,
    'required_total', v_req,
    'required_done', v_req_done,
    'remaining_required', greatest(0, v_req - v_req_done),
    'points_earned', v_points,
    'points_missing', case when s.completion_mode = 'min_points' then greatest(0, coalesce(v_thr, 0) - v_points) else null end,
    'success_rate', case when v_total > 0 then floor(v_solved * 100.0 / v_total)::integer else 0 end,
    'needed_solved', case when s.completion_mode = 'min_success_rate' and v_total > 0 and coalesce(v_thr, 0) > 0
                          then greatest(0, ceil(v_thr * v_total / 100.0)::integer - v_solved) else null end,
    'manual_approved', v_manual
  );
end;
$$;

-- سبب القفل: null إن كانت المرحلة مفتوحة. القرار نفسه من game_stage_is_unlocked؛ هنا التفسير فقط (بالقواعد نفسها).
create or replace function public.game_stage_lock_reason(p_stage_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  s      public.game_stages%rowtype;
  v_mode text;
  v_prev record;
begin
  if public.game_stage_is_unlocked(p_stage_id, p_user_id) then
    return null;
  end if;
  select * into s from public.game_stages where id = p_stage_id;
  if not found then
    return jsonb_build_object('code', 'locked');
  end if;
  select tc.stage_unlock_mode into v_mode from public.game_track_categories tc where tc.id = s.category_id;

  if v_mode = 'manual' then
    return jsonb_build_object('code', 'manual_unlock_required');
  elsif v_mode = 'sequential' then
    select p.id, p.title into v_prev
      from public.game_stages p
     where p.category_id = s.category_id and p.status = 'published'
       and (p.sort_order, p.created_at, p.id) < (s.sort_order, s.created_at, s.id)
     order by p.sort_order desc, p.created_at desc, p.id desc
     limit 1;
    if found then
      return jsonb_build_object('code', 'previous_stage_incomplete',
                                'previous_stage_id', v_prev.id, 'previous_stage_title', v_prev.title);
    end if;
  end if;
  return jsonb_build_object('code', 'locked');
end;
$$;

revoke all on function public.game_learning_stage_visible(uuid)         from public, anon, authenticated;
revoke all on function public.game_stage_progress(uuid, uuid)           from public, anon, authenticated;
revoke all on function public.game_stage_lock_reason(uuid, uuid)        from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- (ب) 2) RPC: مساراتي (قائمة)
-- ---------------------------------------------------------------------
create or replace function public.get_my_learning_tracks(p_game_id uuid default null)
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
    select jsonb_agg(
             jsonb_build_object(
               'id', t.id, 'slug', t.slug, 'title', t.title, 'description', t.description, 'sort_order', t.sort_order,
               'game', jsonb_build_object('id', g.id, 'slug', g.slug, 'title', g.title),
               'categories_count', st.categories_count,
               'stages_count', st.stages_count,
               'stages_completed', st.stages_completed,
               'challenges_total', ch.challenges_total,
               'challenges_solved', ch.challenges_solved,
               'progress_percent', case when ch.challenges_total > 0
                                        then floor(ch.challenges_solved * 100.0 / ch.challenges_total)::integer else 0 end)
             order by g.sort_order, g.slug, t.sort_order, t.slug)
      from public.game_tracks t
      join public.games g on g.id = t.game_id
      join public.game_categories gc on gc.id = g.category_id
      cross join lateral (
        select count(distinct tc.id)::integer as categories_count,
               count(s.id)::integer as stages_count,
               (count(s.id) filter (where public.game_stage_is_complete(s.id, v_uid)))::integer as stages_completed
          from public.game_track_categories tc
          left join public.game_stages s on s.category_id = tc.id and s.status = 'published'
         where tc.track_id = t.id and tc.status = 'published'
      ) st
      cross join lateral (
        select count(*)::integer as challenges_total,
               (count(*) filter (where exists (select 1 from public.game_results r
                                                where r.user_id = v_uid and r.challenge_id = c.id and r.is_correct)))::integer as challenges_solved
          from public.game_challenges c
          join public.game_stages s on s.id = c.stage_id
          join public.game_track_categories tc on tc.id = s.category_id
         where tc.track_id = t.id and tc.status = 'published' and s.status = 'published'
           and c.status = 'published' and (c.ends_at is null or c.ends_at > now())
      ) ch
     where t.status = 'published' and g.status = 'published' and gc.is_active
       and (p_game_id is null or t.game_id = p_game_id)
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- (ب) 3) RPC: شجرة مسار واحد (الفئات ← المراحل بحالتها وتقدّمها وسبب قفلها)
-- ---------------------------------------------------------------------
create or replace function public.get_my_learning_track(p_track_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  t      public.game_tracks%rowtype;
  g      public.games%rowtype;
  v_cats jsonb;
begin
  if v_uid is null or not public.can_access_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;

  select t0.* into t
    from public.game_tracks t0
    join public.games g0 on g0.id = t0.game_id
    join public.game_categories gc on gc.id = g0.category_id
   where t0.id = p_track_id and t0.status = 'published' and g0.status = 'published' and gc.is_active;
  if not found then
    raise exception 'path_not_available';
  end if;
  select * into g from public.games where id = t.game_id;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', tc.id, 'slug', tc.slug, 'title', tc.title, 'description', tc.description,
             'sort_order', tc.sort_order, 'stage_unlock_mode', tc.stage_unlock_mode,
             'stages', coalesce((
               select jsonb_agg(
                        jsonb_build_object(
                          'id', s.id, 'slug', s.slug, 'title', s.title, 'description', s.description,
                          'sort_order', s.sort_order,
                          'completion_mode', s.completion_mode, 'completion_threshold', s.completion_threshold,
                          'is_unlocked', z.unlocked,
                          'is_complete', coalesce((z.pr ->> 'is_complete')::boolean, false),
                          'state', case when coalesce((z.pr ->> 'is_complete')::boolean, false) then 'completed'
                                        when z.unlocked then 'unlocked' else 'locked' end,
                          'progress', z.pr,
                          'lock_reason', case when z.unlocked then null else public.game_stage_lock_reason(s.id, v_uid) end)
                        order by s.sort_order, s.created_at, s.id)
                 from public.game_stages s
                 cross join lateral (
                   select public.game_stage_is_unlocked(s.id, v_uid) as unlocked,
                          public.game_stage_progress(s.id, v_uid) as pr
                 ) z
                where s.category_id = tc.id and s.status = 'published'
             ), '[]'::jsonb))
           order by tc.sort_order, tc.slug), '[]'::jsonb)
    into v_cats
    from public.game_track_categories tc
   where tc.track_id = t.id and tc.status = 'published';

  return jsonb_build_object(
    'track', jsonb_build_object('id', t.id, 'slug', t.slug, 'title', t.title, 'description', t.description,
                                'game', jsonb_build_object('id', g.id, 'slug', g.slug, 'title', g.title)),
    'categories', v_cats);
end;
$$;

-- ---------------------------------------------------------------------
-- (ب) 4) RPC: مرحلة واحدة (الشرط، المتبقي، السابقة/التالية، تحدياتها). بلا content ولا حلول.
-- ---------------------------------------------------------------------
create or replace function public.get_my_learning_stage(p_stage_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  s          public.game_stages%rowtype;
  tc         public.game_track_categories%rowtype;
  t          public.game_tracks%rowtype;
  g          public.games%rowtype;
  v_unlocked boolean;
  v_pr       jsonb;
  v_complete boolean;
  v_prev     jsonb;
  v_next     jsonb;
  v_chs      jsonb;
begin
  if v_uid is null or not public.can_access_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;
  if not public.game_learning_stage_visible(p_stage_id) then
    raise exception 'stage_not_available';
  end if;

  select * into s from public.game_stages where id = p_stage_id;
  select * into tc from public.game_track_categories where id = s.category_id;
  select * into t from public.game_tracks where id = tc.track_id;
  select * into g from public.games where id = t.game_id;

  v_unlocked := public.game_stage_is_unlocked(s.id, v_uid);
  v_pr := public.game_stage_progress(s.id, v_uid);
  v_complete := coalesce((v_pr ->> 'is_complete')::boolean, false);

  select jsonb_build_object('id', p.id, 'title', p.title) into v_prev
    from public.game_stages p
   where p.category_id = s.category_id and p.status = 'published'
     and (p.sort_order, p.created_at, p.id) < (s.sort_order, s.created_at, s.id)
   order by p.sort_order desc, p.created_at desc, p.id desc
   limit 1;

  select jsonb_build_object('id', n.id, 'title', n.title,
                            'is_unlocked', public.game_stage_is_unlocked(n.id, v_uid)) into v_next
    from public.game_stages n
   where n.category_id = s.category_id and n.status = 'published'
     and (n.sort_order, n.created_at, n.id) > (s.sort_order, s.created_at, s.id)
   order by n.sort_order asc, n.created_at asc, n.id asc
   limit 1;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', x.id, 'slug', x.slug, 'sort_order', x.sort_order, 'is_required', x.is_required,
             'upcoming', x.upcoming,
             'title', case when x.upcoming then null else x.title end,
             'description', case when x.upcoming then null else x.description end,
             'difficulty', x.difficulty, 'points_reward', x.points_reward,
             'time_limit_seconds', x.time_limit_seconds, 'max_attempts', x.max_attempts,
             'starts_at', x.starts_at, 'ends_at', x.ends_at,
             'solved', x.solved, 'best_score', x.best_score, 'attempts_used', x.attempts_used,
             'attempts_left', case when x.max_attempts is null then null else greatest(0, x.max_attempts - x.attempts_used) end,
             'open_attempt_id', x.open_attempt_id, 'open_expires_at', x.open_expires_at,
             'state', case when x.solved then 'solved'
                           when x.open_attempt_id is not null then 'in_progress'
                           when x.upcoming then 'upcoming'
                           when not v_unlocked then 'locked'
                           when x.max_attempts is not null and x.attempts_used >= x.max_attempts then 'no_attempts'
                           else 'available' end,
             'can_play', (x.open_attempt_id is not null)
                         or (v_unlocked and not x.upcoming
                             and (x.max_attempts is null or x.attempts_used < x.max_attempts)))
           order by x.sort_order, x.slug), '[]'::jsonb)
    into v_chs
    from (
      select c.id, c.slug, c.sort_order, c.is_required, c.title, c.description, c.difficulty, c.points_reward,
             c.time_limit_seconds, c.max_attempts, c.starts_at, c.ends_at,
             (c.starts_at is not null and c.starts_at > now()) as upcoming,
             att.attempts_used, att.solved, att.best_score, att.open_attempt_id, att.open_expires_at
        from public.game_challenges c
        cross join lateral (
          select count(a.id)::integer as attempts_used,
                 coalesce(bool_or(r.is_correct), false) as solved,
                 coalesce(max(r.score), 0) as best_score,
                 (array_agg(a.id order by a.started_at desc)
                    filter (where a.status = 'in_progress' and (a.expires_at is null or a.expires_at > now())))[1] as open_attempt_id,
                 (array_agg(a.expires_at order by a.started_at desc)
                    filter (where a.status = 'in_progress' and (a.expires_at is null or a.expires_at > now())))[1] as open_expires_at
            from public.game_attempts a
            left join public.game_results r on r.attempt_id = a.id
           where a.user_id = v_uid and a.challenge_id = c.id
        ) att
       where c.stage_id = s.id and c.status = 'published'
         and (c.ends_at is null or c.ends_at > now())
    ) x;

  return jsonb_build_object(
    'game',     jsonb_build_object('id', g.id, 'slug', g.slug, 'title', g.title),
    'track',    jsonb_build_object('id', t.id, 'slug', t.slug, 'title', t.title),
    'category', jsonb_build_object('id', tc.id, 'slug', tc.slug, 'title', tc.title, 'stage_unlock_mode', tc.stage_unlock_mode),
    'stage',    jsonb_build_object('id', s.id, 'slug', s.slug, 'title', s.title, 'description', s.description,
                                   'completion_mode', s.completion_mode, 'completion_threshold', s.completion_threshold),
    'is_unlocked', v_unlocked,
    'is_complete', v_complete,
    'state', case when v_complete then 'completed' when v_unlocked then 'unlocked' else 'locked' end,
    'lock_reason', case when v_unlocked then null else public.game_stage_lock_reason(s.id, v_uid) end,
    'progress', v_pr,
    'previous_stage', v_prev,
    'next_stage', v_next,
    'challenges', v_chs);
end;
$$;

revoke all on function public.get_my_learning_tracks(uuid) from public, anon, authenticated;
revoke all on function public.get_my_learning_track(uuid)  from public, anon, authenticated;
revoke all on function public.get_my_learning_stage(uuid)  from public, anon, authenticated;
grant execute on function public.get_my_learning_tracks(uuid) to authenticated;
grant execute on function public.get_my_learning_track(uuid)  to authenticated;
grant execute on function public.get_my_learning_stage(uuid)  to authenticated;

-- فحص ذاتي للصلاحيات: المساعدات بلا EXECUTE لأي دور عميل، وRPC اللاعب لـ authenticated فقط
do $$
declare
  f text;
begin
  foreach f in array array['public.game_learning_stage_visible(uuid)', 'public.game_stage_progress(uuid,uuid)', 'public.game_stage_lock_reason(uuid,uuid)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception 'صلاحية EXECUTE غير مقصودة على %', f;
    end if;
  end loop;
  foreach f in array array['public.get_my_learning_tracks(uuid)', 'public.get_my_learning_track(uuid)', 'public.get_my_learning_stage(uuid)', 'public.start_game_attempt(uuid)'] loop
    if has_function_privilege('anon', f, 'execute') or not has_function_privilege('authenticated', f, 'execute') then
      raise exception 'صلاحية EXECUTE غير صحيحة على %', f;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
