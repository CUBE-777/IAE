-- ============================================================
-- 0059_games_interactive_challenges.sql — واجهة التحديات التفاعلية (IAE Games) — المرحلة 6.5: قراءة محتوى المحاولة من إصدارها المثبَّت
--
-- يبني على 0050 و0055 و0057 و0058 (مطبّقة ولا تُعدَّل). قراءة فقط: لا جداول جديدة، ولا تغيير على أي دالة أو سياسة RLS قائمة.
--
-- المشكلة (ما تبقّى بعد 0058):
--   * 0058 أصلحت start_game_attempt: المحاولة الجارية تُستأنف حتى بعد سحب النشر. و submit_game_attempt (0057) تصحّح أصلًا على الإصدار المثبَّت.
--   * لكن واجهة اللاعب كانت «تعرض» المحتوى من game_challenges (= الإصدار الجاري دائمًا) وبشرط status = 'published'. فبعد سحب النشر لا يجد اللاعب
--     التحدي أصلًا، وبعد نشر V2 يرى محتوى V2 ويُصحَّح على V1. ولا يمكنه قراءة V1 مباشرة: سياسة game_challenge_versions_select (0055) تُظهر له
--     الإصدار الجاري المنشور فقط (والمؤرشف مغلق عنه).
--
-- الحل: دالتا قراءة للاعب، تُعيدان المحتوى «العلني» لإصدار المحاولة (game_attempts.challenge_version_id) لا الإصدار الجاري:
--   get_my_attempt_challenge(p_attempt_id)        : حمولة اللعب لمحاولة محدّدة (محاولتي أنا فقط، in_progress ولم تنتهِ مهلتها).
--   get_my_open_attempt_challenge(p_challenge_id) : حمولة محاولتي الجارية على هذا التحدي، أو null إن لم توجد. (لا تكشف شيئًا لمن لا يملك محاولة جارية)
--   game_attempt_play_payload(attempt, user)      : مساعد داخلي مشترك (بلا EXECUTE لأي دور عميل).
--
-- ما تُعيده الحمولة: attempt {id, challenge_id, status, started_at, expires_at}
--                    challenge {id, game_id, stage_id, slug, title, description, difficulty, points_reward, time_limit_seconds, max_attempts, content, starts_at, ends_at, sort_order}
--                    game {id, category_id, slug, kind, title, description, config}
--                    version {default_language, allow_language_fallback}
--   عناوين/وصف/صعوبة/نقاط/مهلة/محتوى = من الإصدار المثبَّت. starts_at/ends_at/sort_order/slug/stage_id = من التحدي (غير مُصدَّرة بالإصدارات).
--   لا تُعاد أبدًا: game_challenge_version_solutions (الحلّ وشرحه feedback) ولا game_challenge_solutions، ولا رقم الإصدار ولا معرّفه ولا حالته ولا ملاحظات التغيير.
--
-- قواعد الأمان (تُفرض على الخادم):
--   * can_access_games() + auth.uid(). محاولة غيري = attempt_not_found (لا تمييز بين «غير موجودة» و«لغيري»).
--   * in_progress فقط (غير ذلك: attempt_already_finished) وغير منتهية المهلة (منتهية: attempt_not_found، كما تعامله start_game_attempt).
--   * الإصدار المثبَّت يجب أن يتبع التحدي نفسه وأن يكون published أو archived (المسودّة لا) وله حلّ exact، وإلا attempt_version_unavailable.
--     لا يُستبدل أبدًا بالإصدار الجاري. (نفس شروط submit_game_attempt فلا نعرض ما لا يمكن تسليمه.)
--   * محاولة قديمة بلا إصدار (challenge_version_id is null، تحدٍّ قديم بلا Versioning): محتوى التحدي الحيّ وحلّه الحيّ exact، كما تسلّمها submit_game_attempt.
--   * لا اشتراط نشر التحدي/اللعبة/التصنيف ولا النافذة الزمنية ولا فتح المرحلة: المحاولة بدأت صحيحة (تحقّق منها start_game_attempt وقت البدء)،
--     وهذا هو سلوك الاستئناف والتسليم في 0057/0058. ولا يتيح هذا لأحد قراءة تحدٍّ غير منشور بلا محاولة جارية خاصة به.
--
-- يتطلب: 0050 و0055 و0057 و0058. آمن لإعادة التشغيل. الرجوع: supabase/rollback/0059_games_interactive_challenges_down.sql
-- ⚠️ تجربة جافة أولًا: استبدل `commit;` الأخيرة بـ `rollback;` ثم شغّل الملف، وإن نجح أعدها `commit;`.
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public.can_access_games()') is null then
    raise exception 'شغّل 0049_games_access.sql أولاً';
  end if;
  if to_regclass('public.game_challenge_versions') is null or to_regclass('public.game_challenge_version_solutions') is null then
    raise exception 'شغّل 0055_games_learning_paths.sql أولاً';
  end if;
  if to_regprocedure('public.game_builder_validate(text,jsonb,jsonb,jsonb,boolean)') is null then
    raise exception 'شغّل 0057_games_challenge_builder.sql أولاً';
  end if;
  if to_regprocedure('public.get_my_learning_stage(uuid)') is null then
    raise exception 'شغّل 0058_games_learning_paths_player.sql أولاً';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) المساعد الداخلي: حمولة اللعب لمحاولة مستخدم بعينه. SECURITY DEFINER لأن RLS تحجب عن اللاعب الإصدارات المؤرشفة وغير المنشورة؛
--    الحماية هنا بالملكية (user_id = p_user_id) وبالحالة والمهلة، لا بحالة نشر المحتوى. لا EXECUTE لأي دور عميل.
-- ---------------------------------------------------------------------
create or replace function public.game_attempt_play_payload(p_attempt_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  a public.game_attempts%rowtype;
  c public.game_challenges%rowtype;
  g public.games%rowtype;
  v public.game_challenge_versions%rowtype;
  v_attempt jsonb;
  v_game    jsonb;
begin
  -- محاولتي أنا فقط: محاولة غيري تظهر كغير موجودة
  select * into a from public.game_attempts where id = p_attempt_id and user_id = p_user_id;
  if not found then
    raise exception 'attempt_not_found';
  end if;
  if a.status <> 'in_progress' then
    raise exception 'attempt_already_finished';
  end if;
  -- المنتهية مهلتها لا تُستأنف (تُغلق عند أول start_game_attempt لاحق)
  if a.expires_at is not null and a.expires_at <= now() then
    raise exception 'attempt_not_found';
  end if;

  select * into c from public.game_challenges where id = a.challenge_id;
  if not found then
    raise exception 'challenge_not_available';
  end if;
  select * into g from public.games where id = c.game_id;
  if not found then
    raise exception 'challenge_not_available';
  end if;

  v_attempt := jsonb_build_object('id', a.id, 'challenge_id', a.challenge_id, 'status', a.status,
                                  'started_at', a.started_at, 'expires_at', a.expires_at);
  v_game := jsonb_build_object('id', g.id, 'category_id', g.category_id, 'slug', g.slug, 'kind', g.kind,
                               'title', g.title, 'description', g.description, 'config', g.config);

  if a.challenge_version_id is not null then
    -- الإصدار المثبَّت وحده، بشروط التسليم نفسها (published|archived + حلّ exact). لا استبدال بالإصدار الجاري أبدًا.
    select * into v from public.game_challenge_versions
     where id = a.challenge_version_id and challenge_id = a.challenge_id and status in ('published', 'archived');
    if not found
       or not exists (select 1 from public.game_challenge_version_solutions vs where vs.version_id = v.id and vs.verify_mode = 'exact') then
      raise exception 'attempt_version_unavailable';
    end if;

    return jsonb_build_object(
      'attempt', v_attempt,
      'challenge', jsonb_build_object(
        'id', c.id, 'game_id', c.game_id, 'stage_id', c.stage_id, 'slug', c.slug,
        'title', v.title, 'description', v.description, 'difficulty', v.difficulty, 'points_reward', v.points_reward,
        'time_limit_seconds', v.time_limit_seconds, 'max_attempts', v.max_attempts, 'content', v.content,
        'starts_at', c.starts_at, 'ends_at', c.ends_at, 'sort_order', c.sort_order),
      'game', v_game,
      'version', jsonb_build_object('default_language', v.default_language, 'allow_language_fallback', v.allow_language_fallback));
  end if;

  -- محاولة قديمة بلا إصدار (تحدٍّ قديم بلا Versioning): المحتوى والحلّ الحيّان، كما تسلّمها submit_game_attempt
  if not exists (select 1 from public.game_challenge_solutions gs where gs.challenge_id = c.id and gs.verify_mode = 'exact') then
    raise exception 'attempt_version_unavailable';
  end if;
  return jsonb_build_object(
    'attempt', v_attempt,
    'challenge', jsonb_build_object(
      'id', c.id, 'game_id', c.game_id, 'stage_id', c.stage_id, 'slug', c.slug,
      'title', c.title, 'description', c.description, 'difficulty', c.difficulty, 'points_reward', c.points_reward,
      'time_limit_seconds', c.time_limit_seconds, 'max_attempts', c.max_attempts, 'content', c.content,
      'starts_at', c.starts_at, 'ends_at', c.ends_at, 'sort_order', c.sort_order),
    'game', v_game,
    'version', jsonb_build_object('default_language', null, 'allow_language_fallback', true));
end;
$$;

-- ---------------------------------------------------------------------
-- 2) RPC اللاعب (قراءة فقط). EXECUTE لـ authenticated فقط، كبقية دوال اللاعب.
-- ---------------------------------------------------------------------
create or replace function public.get_my_attempt_challenge(p_attempt_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.can_access_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;
  if p_attempt_id is null then
    raise exception 'attempt_not_found';
  end if;
  return public.game_attempt_play_payload(p_attempt_id, v_uid);
end;
$$;

create or replace function public.get_my_open_attempt_challenge(p_challenge_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null or not public.can_access_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;
  if p_challenge_id is null then
    return null;
  end if;
  -- محاولتي الجارية الصالحة (نفس تعريف «مفتوحة» في get_my_challenge_status)؛ بلا محاولة ⇒ null ولا يُكشف شيء
  select a.id into v_id
    from public.game_attempts a
   where a.user_id = v_uid and a.challenge_id = p_challenge_id
     and a.status = 'in_progress' and (a.expires_at is null or a.expires_at > now())
   order by a.started_at desc
   limit 1;
  if v_id is null then
    return null;
  end if;
  return public.game_attempt_play_payload(v_id, v_uid);
end;
$$;

revoke all on function public.game_attempt_play_payload(uuid, uuid)  from public, anon, authenticated;
revoke all on function public.get_my_attempt_challenge(uuid)         from public, anon, authenticated;
revoke all on function public.get_my_open_attempt_challenge(uuid)    from public, anon, authenticated;
grant execute on function public.get_my_attempt_challenge(uuid)      to authenticated;
grant execute on function public.get_my_open_attempt_challenge(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
