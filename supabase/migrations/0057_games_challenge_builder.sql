-- ============================================================
-- 0057_games_challenge_builder.sql — Challenge Builder (IAE Games) — المرحلة 6.3
--
-- يبني على 0055 و0056 (مطبّقتان ولا تُعدَّلان). يحوي جزأين في معاملة واحدة:
--
-- (أ) إصلاح خلل من 6.2: محاولة بدأت صحيحة كانت تُرفض عند التسليم ثم تبقى in_progress إن تغيّرت الإدارة بعد بدئها
--     (سحب منح الفتح، تغيّر stage_unlock_mode، نقل التحدي لمرحلة أخرى، أرشفة المرحلة، أو سحب نشر التحدي/اللعبة).
--     السبب: submit_game_attempt (0056) تعيد فحص game_stage_is_unlocked وحالة النشر «الحالية» وقت التسليم.
--       * start_game_attempt: يُضاف فحص سلسلة المرحلة (stage_not_available) وفتحها (stage_locked) عند بدء محاولة «جديدة» فقط
--         (بعد فرع الاستئناف، وقبل عدّ المحاولات والإدراج). باقي الدالة حرفيًا كما في 0050.
--       * submit_game_attempt: يُزال فحص فتح المرحلة وشرط نشر التحدي/اللعبة الحاليّين. يبقى: ملكية المحاولة، in_progress، المهلة،
--         صلاحية إصدارها المثبَّت (published أو archived فقط، وله حلّ exact)، وعدم تكرار النتيجة/النقاط (قيود فريدة)، وتحقّق الخادم من الإجابة.
--     المحاولة تستمر على challenge_version_id المثبَّت عند بدئها (يُملأ بمشغّل 0055 عند الإدراج ولا يتغيّر). لا تغيير على المحاولات الجديدة:
--     تبقى مغلقة في مرحلة مغلقة (فحص start_game_attempt + مشغّل game_attempts_bind).
--     نقل تحدٍّ بين مراحل أثناء محاولات جارية: لا يمسّ المحاولات (admin_set_game_challenge_stage بنية فقط) وتُسلَّم على إصدارها؛
--     النتائج محفوظة لا تتغيّر، وإكمال المراحل يُشتقّ دائمًا من الانتماء الحالي للتحدي (نتائج التحدي تتبعه).
--
-- (ب) الخلفية الخادمية لمحرر التحديات (بلا جداول جديدة؛ النظام الموحّد = الإصدارات الموجودة في 0055):
--     * عمود feedback على game_challenge_version_solutions: شرح الإجابة محفوظ مع الحلّ (مغلق عن اللاعبين) لا في content العلني.
--     * game_builder_validate(): تحقق حسب النوع (multiple_choice · fill_blanks · drag_reorder · find_error · match_pairs ·
--       predict_output · code_completion): بنية المحتوى، وجود الحلّ ومطابقته للمحتوى، منع الفارغ والمكرّر، اللغة الافتراضية،
--       منع أي مفتاح غير مسموح في content (فلا يتسرّب حلّ)، ومنع ترتيب محتوى يطابق الحلّ.
--     * admin_save_game_challenge_draft(): إنشاء/تحديث مسودّة إصدار (وحلّها وشرحها) ذرّيًا، وإنشاء هيكل التحدي (draft) إن لزم.
--       مسودّة واحدة مفتوحة لكل تحدٍّ. تحقق خفيف للمسودّة (سلامة/حجم/مفاتيح)، والكامل عند النشر.
--     * مشغّل على game_challenge_versions: عند draft → published لمحتوى المحرر (answer_type = 'builder') يُطبَّق التحقق الكامل.
--       النشر نفسه عبر admin_publish_game_challenge_version() (0055) دون تعديلها؛ يفشل ذرّيًا إن لم يصحّ المحتوى.
--
-- عقد الإجابة (ما سيُرسله اللاعب في 6.5 وما يُخزَّن حلًّا؛ المطابقة exact):
--   multiple_choice {"choice": id} · predict_output {"choice": id} · fill_blanks {"blanks": {blankId: optionId}}
--   drag_reorder {"order": [id,…]} · find_error {"line": n[, "fix": id]} · match_pairs {"pairs": {leftId: rightId}}
--   code_completion {"slots": {slotId: optionId}}
--
-- لا تنفيذ لأي كود ولا Sandbox: كل الإجابات اختيارات/عناصر محددة مسبقًا. لا يمسّ 0050–0056 ولا واجهة اللاعب.
-- يتطلب: 0056 (فحوص المراحل) و0055 (الإصدارات). آمن لإعادة التشغيل. الرجوع: supabase/rollback/0057_games_challenge_builder_down.sql
-- ⚠️ تجربة جافة أولًا: استبدل `commit;` الأخيرة بـ `rollback;` ثم شغّل الملف، وإن نجح أعدها `commit;`.
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public.game_stage_is_unlocked(uuid,uuid)') is null
     or to_regprocedure('public.game_stage_chain_published(uuid)') is null then
    raise exception 'شغّل 0056_games_learning_paths_admin.sql أولاً';
  end if;
  if to_regclass('public.game_challenge_versions') is null
     or to_regclass('public.game_challenge_version_solutions') is null
     or to_regprocedure('public.admin_publish_game_challenge_version(uuid)') is null then
    raise exception 'شغّل 0055_games_learning_paths.sql أولاً';
  end if;
  if to_regprocedure('public.can_manage_games()') is null or to_regprocedure('public.game_admin_audit()') is null then
    raise exception 'شغّل 0050 و0052 أولاً';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- (أ) إصلاح المحاولات الجارية. ACL لا تتغيّر مع create or replace (منحتان في 0050: authenticated فقط).
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

  -- 6.3: المحاولة التي بدأت صحيحة (تحقّق منها start_game_attempt وقت البدء) تُسلَّم على إصدارها المثبَّت مهما تغيّر بعد ذلك.
  --       لا يُعاد هنا فحص: فتح المرحلة (stage_locked)، ولا نشر التحدي/اللعبة/المرحلة الآن، ولا أنه الإصدار الجاري.
  --       الباقي كما هو: ملكية المحاولة، حالتها (in_progress)، المهلة، صلاحية إصدارها وحلّه، ومنع تكرار النتيجة/النقاط.
  select ch.* into c from public.game_challenges ch where ch.id = a.challenge_id;
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
     where v.id = a.challenge_version_id
       and v.status in ('published', 'archived');   -- الإصدار المثبَّت قد يكون أُرشف بنشر إصدار أحدث: يبقى صالحًا لمحاولته؛ المسودّة لا
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

-- ---------------------------------------------------------------------
-- (ب) 1) شرح الإجابة (feedback) مع الحلّ: جدول مغلق عن اللاعبين، فلا يتسرّب قبل التسليم.
--     مفاتيح ar/fr/en فقط كبقية نصوص الإصدارات. الصفوف القائمة: null.
-- ---------------------------------------------------------------------
alter table public.game_challenge_version_solutions add column if not exists feedback jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'game_version_solutions_feedback_check'
                  and conrelid = 'public.game_challenge_version_solutions'::regclass) then
    alter table public.game_challenge_version_solutions add constraint game_version_solutions_feedback_check
      check (feedback is null or (jsonb_typeof(feedback) = 'object' and (feedback - 'ar' - 'fr' - 'en') = '{}'::jsonb));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- (ب) 2) مساعدات التحقق (داخلية، بلا EXECUTE لأي دور عميل). كلها immutable ولا تلمس جدولًا.
--     ملاحظة: في plpgsql لا يُعتمد على short-circuit للمنطق؛ تُستعمل is distinct from وتفرعات if صريحة كي لا يمرّ NULL كأنه صحيح.
-- ---------------------------------------------------------------------

-- نص متعدد اللغات: كائن مفاتيحه ⊆ {ar,fr,en}، قيمه نصوص غير فارغة بطول ≤ p_max؛ وعند p_require_default يلزم نص اللغة الافتراضية (أساس fallback).
create or replace function public.game_builder_text_ok(p jsonb, p_lang text, p_max integer, p_require_default boolean)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  l text;
begin
  if jsonb_typeof(p) is distinct from 'object' then
    return false;
  end if;
  if (p - 'ar' - 'fr' - 'en') <> '{}'::jsonb then
    return false;
  end if;
  foreach l in array array['ar', 'fr', 'en'] loop
    if p ? l then
      if jsonb_typeof(p -> l) is distinct from 'string' or btrim(p ->> l) = '' or char_length(p ->> l) > p_max then
        return false;
      end if;
    end if;
  end loop;
  if p_require_default and not (p ? p_lang) then
    return false;
  end if;
  return true;
end;
$$;

-- نص حرفي لا يتغيّر بالترجمة (كود/ناتج): نص غير فارغ بطول ≤ p_max
create or replace function public.game_builder_literal_ok(p jsonb, p_max integer)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_typeof(p) = 'string' and btrim(p #>> '{}') <> '' and char_length(p #>> '{}') <= p_max, false);
$$;

-- مفاتيح كائن مرتّبة (مصفوفة فارغة لغير الكائن)
create or replace function public.game_builder_keys(p jsonb)
returns text[]
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v text[];
begin
  if jsonb_typeof(p) is distinct from 'object' then
    return '{}'::text[];
  end if;
  select coalesce(array_agg(k order by k), '{}'::text[]) into v from jsonb_object_keys(p) as k;
  return v;
end;
$$;

-- تساوي مجموعتين مع احتساب التكرار (نفس العدد ونفس العناصر)
create or replace function public.game_builder_same_set(a text[], b text[])
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(cardinality(a), 0) = coalesce(cardinality(b), 0)
     and coalesce((select array_agg(x order by x) from unnest(coalesce(a, '{}'::text[])) x), '{}'::text[])
       = coalesce((select array_agg(x order by x) from unnest(coalesce(b, '{}'::text[])) x), '{}'::text[]);
$$;

-- حلّ بكائن مفاتيحه تساوي p_keys تمامًا
create or replace function public.game_builder_solution_ok(p_solution jsonb, p_keys text[])
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_typeof(p_solution) = 'object' and public.game_builder_keys(p_solution) = p_keys, false);
$$;

-- علامات الفراغ {{id}} في نص (بترتيب الورود)
create or replace function public.game_builder_markers(p_text text)
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(t.x[1] order by t.ord), '{}'::text[])
    from regexp_matches(coalesce(p_text, ''), '\{\{([A-Za-z0-9_-]{1,32})\}\}', 'g') with ordinality as t(x, ord);
$$;

-- مفتاح ممنوع في أي مستوى (إجابة/حل). نفس نمط واجهة الإدارة؛ والمحرر يضيف قائمة بيضاء صارمة للمفاتيح فوق ذلك.
create or replace function public.game_builder_has_forbidden_key(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  k text;
  v jsonb;
begin
  if jsonb_typeof(p) = 'object' then
    for k, v in select e.key, e.value from jsonb_each(p) e loop
      if k ~* '^(solutions?|answers?|correct(_?\w*)?|expected(_?\w*)?)$' or public.game_builder_has_forbidden_key(v) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p) = 'array' then
    for v in select e.value from jsonb_array_elements(p) e loop
      if public.game_builder_has_forbidden_key(v) then
        return true;
      end if;
    end loop;
  end if;
  return false;
end;
$$;

-- قائمة اختيارات/عناصر: [{id, text{ar,fr,en}}] أو (p_literal) [{id, value}]. تُرجع المعرّفات بترتيبها وترفض:
-- عددًا خارج [min,max]، مفاتيح زائدة، معرّفًا غير صالح/مكرّرًا، نصًا فارغًا، تكرارًا (نص اللغة الافتراضية، بلا حساسية لحالة الأحرف للنصوص؛ والحرفيّ بعد قصّ الفراغات).
create or replace function public.game_builder_check_options(p_opts jsonb, p_lang text, p_min integer, p_max integer, p_literal boolean)
returns text[]
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  e      jsonb;
  v_ids  text[] := '{}';
  v_seen text[] := '{}';
  v_id   text;
  v_disp text;
begin
  if jsonb_typeof(p_opts) is distinct from 'array' then
    raise exception 'invalid_content';
  end if;
  if jsonb_array_length(p_opts) < p_min or jsonb_array_length(p_opts) > p_max then
    raise exception 'invalid_options_count';
  end if;
  for e in select x.value from jsonb_array_elements(p_opts) x loop
    if jsonb_typeof(e) is distinct from 'object'
       or public.game_builder_keys(e) is distinct from (case when p_literal then array['id', 'value'] else array['id', 'text'] end) then
      raise exception 'invalid_content';
    end if;
    if jsonb_typeof(e -> 'id') is distinct from 'string' then
      raise exception 'invalid_item_id';
    end if;
    v_id := e ->> 'id';
    if v_id !~ '^[A-Za-z0-9_-]{1,32}$' or v_id = any (v_ids) then
      raise exception 'invalid_item_id';
    end if;
    if p_literal then
      if not public.game_builder_literal_ok(e -> 'value', 300) then
        raise exception 'empty_item';
      end if;
      v_disp := btrim(e ->> 'value');
    else
      if not public.game_builder_text_ok(e -> 'text', p_lang, 300, true) then
        raise exception 'empty_item';
      end if;
      v_disp := lower(btrim(e -> 'text' ->> p_lang));
    end if;
    if v_disp = any (v_seen) then
      raise exception 'duplicate_item';
    end if;
    v_ids  := v_ids || v_id;
    v_seen := v_seen || v_disp;
  end loop;
  return v_ids;
end;
$$;

-- ---------------------------------------------------------------------
-- (ب) 3) المدقّق الرئيسي. p_strict = false: تحقق سلامة للمسودّة (نوع/حجم/مفاتيح/أشكال)، true: التحقق الكامل (عند النشر).
--     رموز الأخطاء (نص الاستثناء): invalid_language · invalid_content · invalid_challenge_type · content_has_answer · invalid_solution ·
--     invalid_feedback · invalid_options_count · invalid_item_id · empty_item · duplicate_item · invalid_markers · order_not_shuffled
-- ---------------------------------------------------------------------
create or replace function public.game_builder_validate(p_lang text, p_content jsonb, p_solution jsonb, p_feedback jsonb, p_strict boolean)
returns void
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  c_types   constant text[] := array['multiple_choice', 'fill_blanks', 'drag_reorder', 'find_error', 'match_pairs', 'predict_output', 'code_completion'];
  c_langs   constant text[] := array['text', 'python', 'javascript', 'typescript', 'java', 'c', 'cpp', 'csharp', 'php', 'sql', 'html', 'css', 'bash', 'json'];
  c_all     constant text[] := array['answer_type', 'challenge_type', 'schema_version', 'prompt', 'instructions', 'hints', 'code', 'code_lang',
                                      'options', 'items', 'left', 'right', 'blanks', 'slots', 'template', 'lines', 'fix_options'];
  c_base    constant text[] := array['answer_type', 'challenge_type', 'schema_version', 'prompt', 'instructions', 'hints'];
  v_type    text;
  v_allowed text[];
  k         text;
  h         jsonb;
  b         jsonb;
  v_ids     text[];
  v_ids2    text[];
  v_opt     text[];
  v_all_ids text[] := '{}';
  v_vals    text[] := '{}';
  v_order   text[];
  v_all_str boolean;
  v_map     jsonb;
  v_id      text;
  v_n       integer;
  v_line    integer;
  v_nonblank integer := 0;
  v_same    boolean;
  l         text;
  i         integer;
begin
  if p_lang is null or p_lang <> all (array['ar', 'fr', 'en']) then
    raise exception 'invalid_language';
  end if;
  if jsonb_typeof(p_content) is distinct from 'object' or octet_length(p_content::text) > 30000 then
    raise exception 'invalid_content';
  end if;
  if jsonb_typeof(p_content -> 'challenge_type') is distinct from 'string' or (p_content ->> 'challenge_type') <> all (c_types) then
    raise exception 'invalid_challenge_type';
  end if;
  v_type := p_content ->> 'challenge_type';
  if p_content ->> 'answer_type' is distinct from 'builder' or p_content -> 'schema_version' is distinct from '1'::jsonb then
    raise exception 'invalid_content';
  end if;
  -- قائمة بيضاء للمفاتيح: لا مفتاح مجهول (فلا is_correct ولا غيره) + حارس المفاتيح الممنوعة
  if (p_content - c_all) <> '{}'::jsonb then
    raise exception 'invalid_content';
  end if;
  if public.game_builder_has_forbidden_key(p_content) then
    raise exception 'content_has_answer';
  end if;
  if p_solution is not null and (jsonb_typeof(p_solution) is distinct from 'object' or octet_length(p_solution::text) > 20000) then
    raise exception 'invalid_solution';
  end if;
  if p_feedback is not null and not public.game_builder_text_ok(p_feedback, p_lang, 2000, p_strict) then
    raise exception 'invalid_feedback';
  end if;

  -- سلامة الأشكال (المسودّة والنشر): الحاويات مصفوفات صغيرة، النصوص بأشكالها، الكود نصّ بطول محدود
  foreach k in array array['hints', 'options', 'items', 'left', 'right', 'blanks', 'slots', 'lines', 'fix_options'] loop
    if p_content ? k and (jsonb_typeof(p_content -> k) is distinct from 'array' or jsonb_array_length(p_content -> k) > 60) then
      raise exception 'invalid_content';
    end if;
  end loop;
  foreach k in array array['prompt', 'instructions', 'template'] loop
    if p_content ? k and not public.game_builder_text_ok(p_content -> k, p_lang, 3000, false) then
      raise exception 'invalid_content';
    end if;
  end loop;
  if p_content ? 'code' and not public.game_builder_literal_ok(p_content -> 'code', 4000) then
    raise exception 'invalid_content';
  end if;
  if p_content ? 'code_lang' and (jsonb_typeof(p_content -> 'code_lang') is distinct from 'string' or (p_content ->> 'code_lang') <> all (c_langs)) then
    raise exception 'invalid_content';
  end if;

  if not p_strict then
    return;
  end if;

  -- ===== التحقق الكامل (النشر) =====
  if not public.game_builder_text_ok(p_content -> 'prompt', p_lang, 2000, true) then
    raise exception 'invalid_content';
  end if;
  if p_content ? 'instructions' and not public.game_builder_text_ok(p_content -> 'instructions', p_lang, 1000, true) then
    raise exception 'invalid_content';
  end if;
  if p_content ? 'hints' then
    if jsonb_array_length(p_content -> 'hints') > 5 then
      raise exception 'invalid_content';
    end if;
    for h in select x.value from jsonb_array_elements(p_content -> 'hints') x loop
      if not public.game_builder_text_ok(h, p_lang, 500, true) then
        raise exception 'invalid_content';
      end if;
    end loop;
  end if;

  if v_type = 'multiple_choice' then
    if (p_content - (c_base || array['options'])) <> '{}'::jsonb then raise exception 'invalid_content'; end if;
    v_ids := public.game_builder_check_options(p_content -> 'options', p_lang, 2, 8, false);
    if not public.game_builder_solution_ok(p_solution, array['choice'])
       or jsonb_typeof(p_solution -> 'choice') is distinct from 'string'
       or not ((p_solution ->> 'choice') = any (v_ids)) then
      raise exception 'invalid_solution';
    end if;

  elsif v_type = 'predict_output' then
    if (p_content - (c_base || array['code', 'code_lang', 'options'])) <> '{}'::jsonb then raise exception 'invalid_content'; end if;
    if not public.game_builder_literal_ok(p_content -> 'code', 4000) then raise exception 'invalid_content'; end if;
    v_ids := public.game_builder_check_options(p_content -> 'options', p_lang, 2, 8, true);
    if not public.game_builder_solution_ok(p_solution, array['choice'])
       or jsonb_typeof(p_solution -> 'choice') is distinct from 'string'
       or not ((p_solution ->> 'choice') = any (v_ids)) then
      raise exception 'invalid_solution';
    end if;

  elsif v_type = 'fill_blanks' then
    if (p_content - (c_base || array['template', 'blanks'])) <> '{}'::jsonb then raise exception 'invalid_content'; end if;
    if not public.game_builder_text_ok(p_content -> 'template', p_lang, 3000, true) then raise exception 'invalid_content'; end if;
    if jsonb_typeof(p_content -> 'blanks') is distinct from 'array'
       or jsonb_array_length(p_content -> 'blanks') < 1 or jsonb_array_length(p_content -> 'blanks') > 10 then
      raise exception 'invalid_options_count';
    end if;
    if not public.game_builder_solution_ok(p_solution, array['blanks']) or jsonb_typeof(p_solution -> 'blanks') is distinct from 'object' then
      raise exception 'invalid_solution';
    end if;
    v_map := p_solution -> 'blanks';
    for b in select x.value from jsonb_array_elements(p_content -> 'blanks') x loop
      if jsonb_typeof(b) is distinct from 'object' or public.game_builder_keys(b) is distinct from array['id', 'options'] then
        raise exception 'invalid_content';
      end if;
      if jsonb_typeof(b -> 'id') is distinct from 'string' then raise exception 'invalid_item_id'; end if;
      v_id := b ->> 'id';
      if v_id !~ '^[A-Za-z0-9_-]{1,32}$' or v_id = any (v_all_ids) then raise exception 'invalid_item_id'; end if;
      v_opt := public.game_builder_check_options(b -> 'options', p_lang, 2, 8, false);
      if jsonb_typeof(v_map -> v_id) is distinct from 'string' or not ((v_map ->> v_id) = any (v_opt)) then
        raise exception 'invalid_solution';
      end if;
      v_all_ids := v_all_ids || v_id;
    end loop;
    if not public.game_builder_same_set(public.game_builder_keys(v_map), v_all_ids) then
      raise exception 'invalid_solution';
    end if;
    -- كل فراغ يظهر مرة واحدة بالضبط في نص كل لغة موجودة (الافتراضية إلزامية)
    foreach l in array array['ar', 'fr', 'en'] loop
      if (p_content -> 'template') ? l and not public.game_builder_same_set(public.game_builder_markers(p_content -> 'template' ->> l), v_all_ids) then
        raise exception 'invalid_markers';
      end if;
    end loop;

  elsif v_type = 'code_completion' then
    if (p_content - (c_base || array['code', 'code_lang', 'slots'])) <> '{}'::jsonb then raise exception 'invalid_content'; end if;
    if not public.game_builder_literal_ok(p_content -> 'code', 4000) then raise exception 'invalid_content'; end if;
    if jsonb_typeof(p_content -> 'slots') is distinct from 'array'
       or jsonb_array_length(p_content -> 'slots') < 1 or jsonb_array_length(p_content -> 'slots') > 10 then
      raise exception 'invalid_options_count';
    end if;
    if not public.game_builder_solution_ok(p_solution, array['slots']) or jsonb_typeof(p_solution -> 'slots') is distinct from 'object' then
      raise exception 'invalid_solution';
    end if;
    v_map := p_solution -> 'slots';
    for b in select x.value from jsonb_array_elements(p_content -> 'slots') x loop
      if jsonb_typeof(b) is distinct from 'object' or public.game_builder_keys(b) is distinct from array['id', 'options'] then
        raise exception 'invalid_content';
      end if;
      if jsonb_typeof(b -> 'id') is distinct from 'string' then raise exception 'invalid_item_id'; end if;
      v_id := b ->> 'id';
      if v_id !~ '^[A-Za-z0-9_-]{1,32}$' or v_id = any (v_all_ids) then raise exception 'invalid_item_id'; end if;
      v_opt := public.game_builder_check_options(b -> 'options', p_lang, 2, 8, true);
      if jsonb_typeof(v_map -> v_id) is distinct from 'string' or not ((v_map ->> v_id) = any (v_opt)) then
        raise exception 'invalid_solution';
      end if;
      v_all_ids := v_all_ids || v_id;
    end loop;
    if not public.game_builder_same_set(public.game_builder_keys(v_map), v_all_ids) then
      raise exception 'invalid_solution';
    end if;
    if not public.game_builder_same_set(public.game_builder_markers(p_content ->> 'code'), v_all_ids) then
      raise exception 'invalid_markers';
    end if;

  elsif v_type = 'drag_reorder' then
    if (p_content - (c_base || array['items'])) <> '{}'::jsonb then raise exception 'invalid_content'; end if;
    v_ids := public.game_builder_check_options(p_content -> 'items', p_lang, 2, 10, false);
    if not public.game_builder_solution_ok(p_solution, array['order']) or jsonb_typeof(p_solution -> 'order') is distinct from 'array' then
      raise exception 'invalid_solution';
    end if;
    select coalesce(array_agg(t.el #>> '{}' order by t.ord), '{}'::text[]), coalesce(bool_and(jsonb_typeof(t.el) = 'string'), false)
      into v_order, v_all_str
      from jsonb_array_elements(p_solution -> 'order') with ordinality as t(el, ord);
    if not v_all_str or not public.game_builder_same_set(v_order, v_ids) then
      raise exception 'invalid_solution';
    end if;
    -- ترتيب العناصر في المحتوى العلني لا يطابق الحلّ (وإلا تسرّب الحلّ بترتيب الإرسال)
    if v_order = v_ids then
      raise exception 'order_not_shuffled';
    end if;

  elsif v_type = 'match_pairs' then
    if (p_content - (c_base || array['left', 'right'])) <> '{}'::jsonb then raise exception 'invalid_content'; end if;
    v_ids  := public.game_builder_check_options(p_content -> 'left', p_lang, 2, 8, false);
    v_ids2 := public.game_builder_check_options(p_content -> 'right', p_lang, 2, 8, false);
    if cardinality(v_ids) <> cardinality(v_ids2) then
      raise exception 'invalid_options_count';
    end if;
    if not public.game_builder_solution_ok(p_solution, array['pairs']) or jsonb_typeof(p_solution -> 'pairs') is distinct from 'object' then
      raise exception 'invalid_solution';
    end if;
    v_map := p_solution -> 'pairs';
    if not public.game_builder_same_set(public.game_builder_keys(v_map), v_ids) then
      raise exception 'invalid_solution';
    end if;
    v_same := true;
    for i in 1 .. cardinality(v_ids) loop
      if jsonb_typeof(v_map -> v_ids[i]) is distinct from 'string' or not ((v_map ->> v_ids[i]) = any (v_ids2)) then
        raise exception 'invalid_solution';
      end if;
      v_vals := v_vals || (v_map ->> v_ids[i]);
      if (v_map ->> v_ids[i]) <> v_ids2[i] then
        v_same := false;
      end if;
    end loop;
    if not public.game_builder_same_set(v_vals, v_ids2) then     -- تقابل واحد لواحد
      raise exception 'invalid_solution';
    end if;
    if v_same then                                               -- العمود الأيمن بنفس ترتيب أزواج الأيسر يكشف الحلّ
      raise exception 'order_not_shuffled';
    end if;

  elsif v_type = 'find_error' then
    if (p_content - (c_base || array['code_lang', 'lines', 'fix_options'])) <> '{}'::jsonb then raise exception 'invalid_content'; end if;
    if jsonb_typeof(p_content -> 'lines') is distinct from 'array'
       or jsonb_array_length(p_content -> 'lines') < 2 or jsonb_array_length(p_content -> 'lines') > 60 then
      raise exception 'invalid_options_count';
    end if;
    v_n := jsonb_array_length(p_content -> 'lines');
    for h in select x.value from jsonb_array_elements(p_content -> 'lines') x loop
      if jsonb_typeof(h) is distinct from 'string' or char_length(h #>> '{}') > 300 then
        raise exception 'invalid_content';
      end if;
      if btrim(h #>> '{}') <> '' then
        v_nonblank := v_nonblank + 1;
      end if;
    end loop;
    if v_nonblank < 2 then
      raise exception 'invalid_content';
    end if;
    if p_content ? 'fix_options' and jsonb_array_length(p_content -> 'fix_options') > 0 then
      v_ids := public.game_builder_check_options(p_content -> 'fix_options', p_lang, 2, 6, true);
      if not public.game_builder_solution_ok(p_solution, array['fix', 'line'])
         or jsonb_typeof(p_solution -> 'fix') is distinct from 'string'
         or not ((p_solution ->> 'fix') = any (v_ids)) then
        raise exception 'invalid_solution';
      end if;
    elsif not public.game_builder_solution_ok(p_solution, array['line']) then
      raise exception 'invalid_solution';
    end if;
    if jsonb_typeof(p_solution -> 'line') is distinct from 'number' or (p_solution ->> 'line') !~ '^[0-9]{1,3}$' then
      raise exception 'invalid_solution';
    end if;
    v_line := (p_solution ->> 'line')::integer;
    if v_line < 1 or v_line > v_n or btrim(p_content -> 'lines' ->> (v_line - 1)) = '' then
      raise exception 'invalid_solution';
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- (ب) 4) مشغّل النشر: draft → published لمحتوى المحرر (answer_type = 'builder') يُطبَّق عليه التحقق الكامل مع حلّه وشرحه.
--     محتوى الإصدارات القديمة (بلا هذا الوسم) لا يُمسّ. الاستثناء يُلغي معاملة النشر كلها (admin_publish_game_challenge_version ذرّية).
-- ---------------------------------------------------------------------
create or replace function public.game_challenge_versions_validate_publish()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sol jsonb;
  v_fb  jsonb;
begin
  if old.status = 'draft' and new.status = 'published' and new.content ->> 'answer_type' = 'builder' then
    select vs.solution, vs.feedback into v_sol, v_fb
      from public.game_challenge_version_solutions vs where vs.version_id = new.id;
    perform public.game_builder_validate(new.default_language, new.content, v_sol, v_fb, true);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_game_challenge_versions_validate_publish on public.game_challenge_versions;
create trigger trg_game_challenge_versions_validate_publish before update of status on public.game_challenge_versions
  for each row execute function public.game_challenge_versions_validate_publish();

-- ---------------------------------------------------------------------
-- (ب) 5) RPC: حفظ مسودّة إصدار (وحلّها وشرحها) ذرّيًا.
--     p_challenge_id = null → ينشئ هيكل تحدٍّ (draft) أولًا (يلزم game_id وslug) في المعاملة نفسها.
--     p_version_id = null → تُحدَّث المسودّة المفتوحة للتحدي إن وُجدت وإلا تُنشأ مسودّة جديدة (رقمها يُعيَّن بمشغّل 0055). مسودّة واحدة مفتوحة.
--     p_data: default_language, allow_language_fallback, title, description, difficulty, points_reward, time_limit_seconds, max_attempts,
--             content, solution, feedback, change_note [, game_id, slug عند الإنشاء].
--     الإصدار المنشور/المؤرشف لا يُمسّ أبدًا (مشغّل 0055)، فتعديل تحدٍّ منشور = مسودّة جديدة ثم نشرها عبر admin_publish_game_challenge_version.
--     الحلّ والشرح يُحفظان معًا ولا يُعادان للعميل.
-- ---------------------------------------------------------------------
create or replace function public.admin_save_game_challenge_draft(p_challenge_id uuid, p_version_id uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d          jsonb := coalesce(p_data, '{}'::jsonb);
  v_chal     uuid := p_challenge_id;
  v_created  boolean := false;
  v          public.game_challenge_versions%rowtype;
  v_lang     text;
  v_fallback boolean;
  v_title    jsonb;
  v_desc     jsonb;
  v_content  jsonb;
  v_solution jsonb;
  v_feedback jsonb;
  v_diff     smallint;
  v_points   integer;
  v_limit    integer;
  v_max      integer;
  v_note     text;
begin
  if auth.uid() is null or not public.can_manage_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;
  if jsonb_typeof(d) is distinct from 'object' then
    raise exception 'invalid_data';
  end if;

  v_lang := coalesce(d ->> 'default_language', 'ar');
  if v_lang <> all (array['ar', 'fr', 'en']) then
    raise exception 'invalid_language';
  end if;
  v_fallback := case when d ? 'allow_language_fallback' then (d ->> 'allow_language_fallback')::boolean else true end;
  v_title := d -> 'title';
  if not public.game_builder_text_ok(v_title, v_lang, 200, true) then
    raise exception 'translation_required';
  end if;
  v_desc := nullif(d -> 'description', 'null'::jsonb);
  if v_desc is not null and not public.game_builder_text_ok(v_desc, v_lang, 2000, false) then
    raise exception 'invalid_data';
  end if;
  v_content := d -> 'content';
  v_solution := nullif(d -> 'solution', 'null'::jsonb);
  v_feedback := nullif(d -> 'feedback', 'null'::jsonb);
  if v_feedback = '{}'::jsonb then
    v_feedback := null;
  end if;
  v_diff   := coalesce((d ->> 'difficulty')::smallint, 1);
  v_points := coalesce((d ->> 'points_reward')::integer, 10);
  v_limit  := (d ->> 'time_limit_seconds')::integer;
  v_max    := (d ->> 'max_attempts')::integer;
  v_note   := nullif(btrim(coalesce(d ->> 'change_note', '')), '');

  -- سلامة المسودّة (التحقق الكامل عند النشر)
  perform public.game_builder_validate(v_lang, v_content, v_solution, v_feedback, false);

  if v_chal is null then
    if jsonb_typeof(d -> 'game_id') is distinct from 'string' or jsonb_typeof(d -> 'slug') is distinct from 'string'
       or (d ->> 'slug') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(d ->> 'slug') > 64 then
      raise exception 'invalid_data';
    end if;
    insert into public.game_challenges (game_id, slug, title, description, difficulty, points_reward, time_limit_seconds, max_attempts,
                                        content, status, sort_order)
    values ((d ->> 'game_id')::uuid, d ->> 'slug', v_title, v_desc, v_diff, v_points, v_limit, v_max, '{}'::jsonb, 'draft',
            coalesce((select max(c.sort_order) + 1 from public.game_challenges c where c.game_id = (d ->> 'game_id')::uuid), 1))
    returning id into v_chal;
    v_created := true;
  else
    perform 1 from public.game_challenges where id = v_chal for update;
    if not found then
      raise exception 'challenge_not_found';
    end if;
  end if;

  if p_version_id is not null then
    select * into v from public.game_challenge_versions where id = p_version_id and challenge_id = v_chal for update;
    if not found then
      raise exception 'version_not_found';
    end if;
    if v.status <> 'draft' then
      raise exception 'version_not_draft';
    end if;
  else
    select * into v from public.game_challenge_versions
     where challenge_id = v_chal and status = 'draft' order by version_no desc limit 1 for update;
  end if;

  if v.id is null then
    insert into public.game_challenge_versions (challenge_id, version_no, status, default_language, allow_language_fallback, title, description,
                                                difficulty, points_reward, time_limit_seconds, max_attempts, content, change_note)
    values (v_chal, 0, 'draft', v_lang, v_fallback, v_title, v_desc, v_diff, v_points, v_limit, v_max, v_content, v_note)
    returning * into v;
  else
    update public.game_challenge_versions set
      default_language = v_lang, allow_language_fallback = v_fallback, title = v_title, description = v_desc, difficulty = v_diff,
      points_reward = v_points, time_limit_seconds = v_limit, max_attempts = v_max, content = v_content, change_note = v_note
     where id = v.id
     returning * into v;
  end if;

  if v_solution is not null then
    insert into public.game_challenge_version_solutions (version_id, verify_mode, solution, feedback)
    values (v.id, 'exact', v_solution, v_feedback)
    on conflict (version_id) do update set verify_mode = 'exact', solution = excluded.solution, feedback = excluded.feedback;
  end if;

  return jsonb_build_object('challenge_id', v_chal, 'version_id', v.id, 'version_no', v.version_no, 'created_challenge', v_created);
exception
  when unique_violation then raise exception 'slug_taken';
  when foreign_key_violation then raise exception 'game_not_found';
  when check_violation or invalid_text_representation or numeric_value_out_of_range or not_null_violation
       or invalid_parameter_value then
    raise exception 'invalid_data';
end;
$$;

revoke all on function public.game_builder_text_ok(jsonb, text, integer, boolean)                       from public, anon, authenticated;
revoke all on function public.game_builder_literal_ok(jsonb, integer)                                   from public, anon, authenticated;
revoke all on function public.game_builder_keys(jsonb)                                                  from public, anon, authenticated;
revoke all on function public.game_builder_same_set(text[], text[])                                     from public, anon, authenticated;
revoke all on function public.game_builder_solution_ok(jsonb, text[])                                   from public, anon, authenticated;
revoke all on function public.game_builder_markers(text)                                                from public, anon, authenticated;
revoke all on function public.game_builder_has_forbidden_key(jsonb)                                     from public, anon, authenticated;
revoke all on function public.game_builder_check_options(jsonb, text, integer, integer, boolean)        from public, anon, authenticated;
revoke all on function public.game_builder_validate(text, jsonb, jsonb, jsonb, boolean)                 from public, anon, authenticated;
revoke all on function public.game_challenge_versions_validate_publish()                                from public, anon, authenticated;
revoke all on function public.admin_save_game_challenge_draft(uuid, uuid, jsonb)                        from public, anon, authenticated;
grant execute on function public.admin_save_game_challenge_draft(uuid, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
