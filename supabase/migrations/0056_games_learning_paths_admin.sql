-- ============================================================
-- 0056_games_learning_paths_admin.sql — Learning Paths (IAE Games) — المرحلة 6.2: الإدارة + فتح المراحل وإكمالها على الخادم
--
-- يبني على 0055 (مطبّقة ولا تُعدَّل). الهرم: Game → Track → Category → Stage → Challenge.
--   * CRUD المسارات/الفئات/المراحل يمرّ عبر RLS (game_*_manage = can_manage_games(): super_admin/developer) + قيود 0055 + مشغّل التدقيق الموجود.
--     هنا: يُسحب DELETE المباشر عن الجداول الثلاثة (الإزالة = أرشفة؛ الحذف كان سيتتالى على المراحل والمنح).
--
-- منطق الفتح والإكمال (مشتقّ بالكامل من game_results / game_points / game_stage_grants؛ لا جدول تقدّم مكرَّر):
--   مساعدات داخلية بلا EXECUTE لأي دور عميل:
--     game_stage_chain_published(stage)        : المرحلة + فئتها + مسارها كلها منشورة.
--     game_stage_is_complete(stage, user)      : الإكمال حسب completion_mode (fail closed: أي نقص بيانات = غير مكتملة).
--     game_stage_is_unlocked(stage, user)      : المسار منشور + قاعدة stage_unlock_mode لفئة المرحلة.
--     game_user_is_player(user)                : حساب إداري أو حساب عضو (لا منح لمستخدم لا يلعب).
--
--   التعريفات (ثابتة وموثّقة):
--     «المحلولة» لمستخدم  = للتحدي نتيجة واحدة على الأقل في game_results بـ is_correct = true.
--     «التحديات المعتدّ بها» = تحديات المرحلة بحالة published وغير منتهية (ends_at null أو في المستقبل). المنتهية تسقط من الحساب
--                              (لا يُحبَس لاعب خلف تحدٍّ لم يعد قابلًا للّعب)؛ ولم يبدأ بعد تبقى معتدًّا بها (fail closed).
--     all_required      : كل التحديات المعتدّ بها وis_required محلولة؛ ولا بدّ من تحدٍّ إلزامي واحد على الأقل (مرحلة بلا إلزامي ≠ مكتملة).
--     min_success_rate  : نسبة النجاح = (عدد التحديات المحلولة ÷ عدد كل التحديات المعتدّ بها في المرحلة، إلزامية أو لا) × 100 ≥ completion_threshold.
--                         وحدة القياس «التحدي» لا «المحاولة»: يُعتدّ بأفضل نتيجة لكل تحدٍّ فلا تنقص النسبة بمحاولة فاشلة سابقة ولا تُنفَخ بتكرار محاولات.
--                         مقارنة بأعداد صحيحة (solved*100 >= threshold*total) بلا تقريب. بلا تحديات = غير مكتملة.
--     min_points        : مجموع game_points (reason = challenge_solved) لتحديات المرحلة ≥ completion_threshold. تسويات الإدارة ومكافآت الإنجازات
--                         لا تُحتسب (غير منسوبة لمرحلة). تُحتسب نقاط تحدٍّ أُرشف لاحقًا (سجلّ تاريخي).
--     manual            : وجود منح kind = 'complete' لهذا (مرحلة، لاعب).
--     sequential        : السابقة = أقرب مرحلة منشورة قبلها في الفئة نفسها بالترتيب (sort_order, created_at, id)؛ لا سابقة = مفتوحة؛ وإلا تُفتح بإكمال السابقة.
--                         مراحل المسودّة/المؤرشفة خارج السلسلة (لا تحبس ما بعدها).
--     free              : كل مرحلة منشورة مفتوحة.
--     manual (unlock)   : لا تُفتح إلا بمنح kind = 'unlock'.
--
-- التنفيذ على الخادم (لا يُتجاوز باستدعاء RPC مباشرة):
--   * game_attempts_bind (مشغّل INSERT على game_attempts، وهو الطريق الوحيد لإنشاء محاولة عبر start_game_attempt) يرفض
--     stage_not_available (سلسلة غير منشورة) وstage_locked (المرحلة مغلقة لهذا اللاعب). كان يرفض كل غير free بـ stage_lock_not_enforced؛ زال ذلك.
--   * submit_game_attempt تعيد التحقق (محاولة بدأت ثم سُحب منحها/أُرشفت مرحلتها/تغيّر وضع فئتها) → stage_locked. باقيها حرفيًا كما في 0055.
--   * التحدي بلا مرحلة (stage_id null): السلوك القديم كما هو.
--
-- RPC إدارية (SECURITY DEFINER، تتحقق من can_manage_games()، EXECUTE لـ authenticated فقط):
--   admin_reorder_game_path_items · admin_set_game_challenge_stage · admin_grant_game_stage · admin_revoke_game_stage_grant
--   admin_list_game_stage_grants · admin_get_game_stage_status
--   تدقيق المنح: مشغّل game_stage_grants_audit (0055) يسجّل الإنشاء/الإلغاء في audit_logs (من، لمن، أي مرحلة، النوع؛ بلا نص الملاحظة).
--
-- لا يعدّل 0055. يعيد تعريف (create or replace) دالتين من 0055 فقط: game_attempts_bind وsubmit_game_attempt.
-- يتطلب: 0055. آمن لإعادة التشغيل. الرجوع: supabase/rollback/0056_games_learning_paths_admin_down.sql
-- ⚠️ تجربة جافة أولًا: استبدل `commit;` الأخيرة بـ `rollback;` ثم شغّل الملف، وإن نجح أعدها `commit;`.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.game_stage_grants') is null or to_regclass('public.game_stages') is null
     or to_regprocedure('public.game_attempts_bind()') is null
     or to_regprocedure('public.admin_publish_game_challenge_version(uuid)') is null then
    raise exception 'شغّل 0055_games_learning_paths.sql أولاً';
  end if;
  if to_regprocedure('public.can_manage_games()') is null or to_regprocedure('public.game_user_total(uuid)') is null then
    raise exception 'شغّل 0050 و0052 أولاً';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) سحب الحذف المباشر عن الهيكل: الإزالة بالأرشفة (الحذف كان سيتتالى على الفئات والمراحل والمنح)
-- ---------------------------------------------------------------------
revoke delete on public.game_tracks, public.game_track_categories, public.game_stages from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2) مساعدات داخلية: الاشتقاق من النتائج والنقاط والمنح (بلا EXECUTE لأي دور عميل)
-- ---------------------------------------------------------------------
create or replace function public.game_user_is_player(p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select p_user_id is not null
     and exists (select 1 from auth.users u where u.id = p_user_id)
     and (exists (select 1 from public.profiles p where p.id = p_user_id)
          or exists (select 1 from public.member_accounts ma where ma.user_id = p_user_id));
$$;

create or replace function public.game_stage_chain_published(p_stage_id uuid)
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
     where s.id = p_stage_id and s.status = 'published' and tc.status = 'published' and t.status = 'published'
  );
$$;

create or replace function public.game_stage_is_complete(p_stage_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  s         public.game_stages%rowtype;
  v_total   integer;
  v_done    integer;
  v_points  bigint;
begin
  if p_stage_id is null or p_user_id is null then
    return false;
  end if;
  select * into s from public.game_stages where id = p_stage_id;
  if not found then
    return false;
  end if;

  if s.completion_mode = 'manual' then
    return exists (select 1 from public.game_stage_grants gr
                    where gr.stage_id = s.id and gr.user_id = p_user_id and gr.kind = 'complete');

  elsif s.completion_mode = 'all_required' then
    select count(*)::integer,
           (count(*) filter (where exists (select 1 from public.game_results r
                                            where r.user_id = p_user_id and r.challenge_id = c.id and r.is_correct)))::integer
      into v_total, v_done
      from public.game_challenges c
     where c.stage_id = s.id and c.status = 'published' and c.is_required
       and (c.ends_at is null or c.ends_at > now());
    return v_total > 0 and v_done = v_total;

  elsif s.completion_mode = 'min_success_rate' then
    if s.completion_threshold is null or s.completion_threshold not between 1 and 100 then
      return false;
    end if;
    select count(*)::integer,
           (count(*) filter (where exists (select 1 from public.game_results r
                                            where r.user_id = p_user_id and r.challenge_id = c.id and r.is_correct)))::integer
      into v_total, v_done
      from public.game_challenges c
     where c.stage_id = s.id and c.status = 'published'
       and (c.ends_at is null or c.ends_at > now());
    return v_total > 0 and (v_done::bigint * 100) >= (s.completion_threshold::bigint * v_total);

  elsif s.completion_mode = 'min_points' then
    if s.completion_threshold is null or s.completion_threshold < 1 then
      return false;
    end if;
    select coalesce(sum(pt.delta), 0) into v_points
      from public.game_points pt
      join public.game_challenges c on c.id = pt.challenge_id
     where pt.user_id = p_user_id and pt.reason = 'challenge_solved' and c.stage_id = s.id;
    return v_points >= s.completion_threshold;
  end if;

  return false;   -- وضع غير متوقّع: fail closed
end;
$$;

create or replace function public.game_stage_is_unlocked(p_stage_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  s      public.game_stages%rowtype;
  v_mode text;
  v_prev uuid;
begin
  if p_stage_id is null or p_user_id is null then
    return false;
  end if;
  if not public.game_stage_chain_published(p_stage_id) then
    return false;
  end if;
  select * into s from public.game_stages where id = p_stage_id;
  if not found then
    return false;
  end if;
  select tc.stage_unlock_mode into v_mode from public.game_track_categories tc where tc.id = s.category_id;

  if v_mode = 'free' then
    return true;

  elsif v_mode = 'manual' then
    return exists (select 1 from public.game_stage_grants gr
                    where gr.stage_id = s.id and gr.user_id = p_user_id and gr.kind = 'unlock');

  elsif v_mode = 'sequential' then
    select p.id into v_prev
      from public.game_stages p
     where p.category_id = s.category_id and p.status = 'published'
       and (p.sort_order, p.created_at, p.id) < (s.sort_order, s.created_at, s.id)
     order by p.sort_order desc, p.created_at desc, p.id desc
     limit 1;
    if v_prev is null then
      return true;                                   -- أول مرحلة منشورة في الفئة
    end if;
    return public.game_stage_is_complete(v_prev, p_user_id);
  end if;

  return false;   -- وضع غير متوقّع أو بيانات ناقصة: fail closed
end;
$$;

revoke all on function public.game_user_is_player(uuid)               from public, anon, authenticated;
revoke all on function public.game_stage_chain_published(uuid)        from public, anon, authenticated;
revoke all on function public.game_stage_is_complete(uuid, uuid)      from public, anon, authenticated;
revoke all on function public.game_stage_is_unlocked(uuid, uuid)      from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) التنفيذ: المشغّل (بدء المحاولة) + التسليم. إعادة تعريف دالتين من 0055 فقط.
--    ACL لا تتغيّر مع create or replace (المشغّل بلا EXECUTE لأحد؛ submit_game_attempt لـ authenticated كما في 0050).
-- ---------------------------------------------------------------------
create or replace function public.game_attempts_bind()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stage   uuid;
  v_version uuid;
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
    if not public.game_stage_chain_published(v_stage) then
      raise exception 'stage_not_available';
    end if;
    if not public.game_stage_is_unlocked(v_stage, new.user_id) then
      raise exception 'stage_locked';      -- تسلسلي لم تُكمل سابقته، أو يدوي بلا منح فتح (fail closed)
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

-- ---------------------------------------------------------------------
-- 4) RPC إدارية. كلها: auth.uid() غير null + can_manage_games() (super_admin/developer) وإلا games_access_denied.
-- ---------------------------------------------------------------------

-- 4.1) إعادة ترتيب الإخوة (مسارات اللعبة الواحدة / فئات المسار الواحد / مراحل الفئة الواحدة). يجب أن تغطّي القائمة كل الإخوة بلا تكرار.
create or replace function public.admin_reorder_game_path_items(p_kind text, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tbl     text;
  v_col     text;
  v_n       integer;
  v_found   integer;
  v_parents integer;
  v_sibs    integer;
begin
  if auth.uid() is null or not public.can_manage_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 500 then
    raise exception 'invalid_data';
  end if;
  v_n := array_length(p_ids, 1);
  if (select count(distinct x) from unnest(p_ids) x) <> v_n or exists (select 1 from unnest(p_ids) y where y is null) then
    raise exception 'invalid_data';
  end if;

  if p_kind = 'track' then
    v_tbl := 'game_tracks'; v_col := 'game_id';
  elsif p_kind = 'category' then
    v_tbl := 'game_track_categories'; v_col := 'track_id';
  elsif p_kind = 'stage' then
    v_tbl := 'game_stages'; v_col := 'category_id';
  else
    raise exception 'invalid_kind';
  end if;

  -- المعرّفات ثوابت من الفرع أعلاه (ليست مدخلات)؛ format(%I) للاحتياط فقط
  execute format('select count(*), count(distinct %2$I) from public.%1$I where id = any($1)', v_tbl, v_col)
     into v_found, v_parents using p_ids;
  if v_found <> v_n or v_parents <> 1 then
    raise exception 'invalid_data';
  end if;
  execute format('select count(*) from public.%1$I where %2$I = (select %2$I from public.%1$I where id = $1)', v_tbl, v_col)
     into v_sibs using p_ids[1];
  if v_sibs <> v_n then
    raise exception 'invalid_data';
  end if;

  execute format('update public.%1$I t set sort_order = o.pos from unnest($1) with ordinality as o(id, pos) where t.id = o.id', v_tbl)
    using p_ids;
end;
$$;

-- 4.2) إسناد تحدٍّ قائم إلى مرحلة (أو فكّه بـ null) وتحديد كونه إلزاميًا. بنية فقط: لا يمسّ محتوى التحدي ولا إصداراته.
--      المرحلة يجب أن تكون من لعبة التحدي نفسها (والمفتاح الأجنبي المركّب يضمن ذلك أيضًا) وغير مؤرشفة.
create or replace function public.admin_set_game_challenge_stage(p_challenge_id uuid, p_stage_id uuid, p_is_required boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.game_challenges%rowtype;
  s public.game_stages%rowtype;
begin
  if auth.uid() is null or not public.can_manage_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;
  select * into c from public.game_challenges where id = p_challenge_id for update;
  if not found then
    raise exception 'challenge_not_found';
  end if;
  if p_stage_id is not null then
    select * into s from public.game_stages where id = p_stage_id;
    if not found then
      raise exception 'stage_not_found';
    end if;
    if s.game_id <> c.game_id then
      raise exception 'stage_game_mismatch';
    end if;
    if s.status = 'archived' then
      raise exception 'stage_archived';
    end if;
  end if;
  update public.game_challenges
     set stage_id = p_stage_id, is_required = coalesce(p_is_required, true)
   where id = p_challenge_id;
  return jsonb_build_object('challenge_id', p_challenge_id, 'stage_id', p_stage_id, 'is_required', coalesce(p_is_required, true));
end;
$$;

-- 4.3) منح فتح (unlock: فئة manual) أو اعتماد إكمال (complete: مرحلة manual). التوافق: المرحلة موجودة وغير مؤرشفة، المستخدم حساب لاعب،
--      وسلسلة لعبة/مسار/فئة/مرحلة ووضع manual يتحقق منها مشغّل game_stage_grants_validate (0055) عند الإدراج. idempotent.
create or replace function public.admin_grant_game_stage(p_stage_id uuid, p_user_id uuid, p_kind text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s      public.game_stages%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id   uuid;
begin
  if auth.uid() is null or not public.can_manage_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('unlock', 'complete') then
    raise exception 'invalid_kind';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'invalid_data';
  end if;
  select * into s from public.game_stages where id = p_stage_id;
  if not found then
    raise exception 'stage_not_found';
  end if;
  if s.status = 'archived' then
    raise exception 'stage_archived';
  end if;
  if not public.game_user_is_player(p_user_id) then
    raise exception 'user_not_found';
  end if;

  insert into public.game_stage_grants (stage_id, user_id, kind, note, granted_by)
  values (p_stage_id, p_user_id, p_kind, v_note, auth.uid())
  on conflict (stage_id, user_id, kind) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('result', 'exists');
  end if;
  return jsonb_build_object('result', 'granted', 'id', v_id);
end;
$$;

-- 4.4) إلغاء منح (التدقيق بمشغّل 0055). إلغاء complete يُسقط الإكمال المشتقّ؛ إلغاء unlock يغلق المرحلة من جديد.
create or replace function public.admin_revoke_game_stage_grant(p_grant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or not public.can_manage_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;
  delete from public.game_stage_grants where id = p_grant_id returning id into v_id;
  if v_id is null then
    raise exception 'grant_not_found';
  end if;
  return jsonb_build_object('result', 'revoked', 'id', v_id);
end;
$$;

-- 4.5) منوح مرحلة مع هوية اللاعب (للمدير فقط؛ الاسم والبريد كما في admin_list_game_players).
create or replace function public.admin_list_game_stage_grants(p_stage_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null or not public.can_manage_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.game_stages where id = p_stage_id) then
    raise exception 'stage_not_found';
  end if;
  with g as (
    select gr.id, gr.user_id, gr.kind, gr.note, gr.created_at,
           coalesce(p.full_name, m.full_name, u.email::text) as display_name,
           coalesce(p.email, u.email::text)                  as email
      from public.game_stage_grants gr
      join auth.users u on u.id = gr.user_id
      left join public.profiles p on p.id = u.id
      left join public.member_accounts ma on ma.user_id = u.id
      left join public.members m on m.id = ma.member_id
     where gr.stage_id = p_stage_id
     order by gr.created_at desc
     limit 500
  )
  select coalesce(jsonb_agg(to_jsonb(g) order by g.created_at desc), '[]'::jsonb) into v_rows from g;
  return v_rows;
end;
$$;

-- 4.6) حالة مرحلة للاعب كما يحسبها الخادم الآن (للمدير: التحقق من المنح والإكمال). لا تكشف حلولًا ولا إجابات.
create or replace function public.admin_get_game_stage_status(p_stage_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  s        public.game_stages%rowtype;
  v_unlock text;
begin
  if auth.uid() is null or not public.can_manage_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;
  select * into s from public.game_stages where id = p_stage_id;
  if not found then
    raise exception 'stage_not_found';
  end if;
  if not public.game_user_is_player(p_user_id) then
    raise exception 'user_not_found';
  end if;
  select tc.stage_unlock_mode into v_unlock from public.game_track_categories tc where tc.id = s.category_id;

  return jsonb_build_object(
    'stage_id', s.id, 'user_id', p_user_id,
    'chain_published', public.game_stage_chain_published(s.id),
    'unlock_mode', v_unlock, 'completion_mode', s.completion_mode, 'completion_threshold', s.completion_threshold,
    'unlocked', public.game_stage_is_unlocked(s.id, p_user_id),
    'complete', public.game_stage_is_complete(s.id, p_user_id),
    'challenges_total', (select count(*) from public.game_challenges c
                          where c.stage_id = s.id and c.status = 'published' and (c.ends_at is null or c.ends_at > now())),
    'challenges_solved', (select count(*) from public.game_challenges c
                           where c.stage_id = s.id and c.status = 'published' and (c.ends_at is null or c.ends_at > now())
                             and exists (select 1 from public.game_results r where r.user_id = p_user_id and r.challenge_id = c.id and r.is_correct)),
    'required_total', (select count(*) from public.game_challenges c
                        where c.stage_id = s.id and c.status = 'published' and c.is_required and (c.ends_at is null or c.ends_at > now())),
    'required_solved', (select count(*) from public.game_challenges c
                         where c.stage_id = s.id and c.status = 'published' and c.is_required and (c.ends_at is null or c.ends_at > now())
                           and exists (select 1 from public.game_results r where r.user_id = p_user_id and r.challenge_id = c.id and r.is_correct)),
    'points_earned', (select coalesce(sum(pt.delta), 0) from public.game_points pt
                       join public.game_challenges c on c.id = pt.challenge_id
                      where pt.user_id = p_user_id and pt.reason = 'challenge_solved' and c.stage_id = s.id),
    'points_available', (select coalesce(sum(c.points_reward), 0) from public.game_challenges c
                          where c.stage_id = s.id and c.status = 'published' and (c.ends_at is null or c.ends_at > now()))
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 5) صلاحيات EXECUTE: الأصل الرفض (anon لا يملك شيئًا)، والـ RPC الإدارية لـ authenticated (والقرار الفعلي داخلها)
-- ---------------------------------------------------------------------
revoke all on function public.admin_reorder_game_path_items(text, uuid[])                from public, anon, authenticated;
revoke all on function public.admin_set_game_challenge_stage(uuid, uuid, boolean)       from public, anon, authenticated;
revoke all on function public.admin_grant_game_stage(uuid, uuid, text, text)            from public, anon, authenticated;
revoke all on function public.admin_revoke_game_stage_grant(uuid)                       from public, anon, authenticated;
revoke all on function public.admin_list_game_stage_grants(uuid)                        from public, anon, authenticated;
revoke all on function public.admin_get_game_stage_status(uuid, uuid)                   from public, anon, authenticated;
grant execute on function public.admin_reorder_game_path_items(text, uuid[])            to authenticated;
grant execute on function public.admin_set_game_challenge_stage(uuid, uuid, boolean)    to authenticated;
grant execute on function public.admin_grant_game_stage(uuid, uuid, text, text)         to authenticated;
grant execute on function public.admin_revoke_game_stage_grant(uuid)                    to authenticated;
grant execute on function public.admin_list_game_stage_grants(uuid)                     to authenticated;
grant execute on function public.admin_get_game_stage_status(uuid, uuid)                to authenticated;

-- فحص ذاتي: أي انحراف في الصلاحيات يُفشل المعاملة كلها (فلا يُطبَّق نصف الملف)
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.game_user_is_player(uuid)', 'public.game_stage_chain_published(uuid)',
    'public.game_stage_is_complete(uuid,uuid)', 'public.game_stage_is_unlocked(uuid,uuid)', 'public.game_attempts_bind()'
  ] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception 'EXECUTE مفتوح على دالة داخلية: %', f;
    end if;
  end loop;
  foreach f in array array[
    'public.admin_reorder_game_path_items(text,uuid[])', 'public.admin_set_game_challenge_stage(uuid,uuid,boolean)',
    'public.admin_grant_game_stage(uuid,uuid,text,text)', 'public.admin_revoke_game_stage_grant(uuid)',
    'public.admin_list_game_stage_grants(uuid)', 'public.admin_get_game_stage_status(uuid,uuid)'
  ] loop
    if has_function_privilege('anon', f, 'execute') or not has_function_privilege('authenticated', f, 'execute') then
      raise exception 'صلاحية EXECUTE غير صحيحة على: %', f;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
