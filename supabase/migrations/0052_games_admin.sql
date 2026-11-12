-- ============================================================
-- 0052_games_admin.sql — لوحة إدارة الألعاب (IAE Games) — المرحلة 3: الحماية والدوال الإدارية
--
-- لماذا هذه الـ Migration؟ (0050 مطبّقة ولا تُعدَّل)
--   1) can_manage_games() في 0050 = can_access_games() و can_manage_content()، فكانت تشمل أدوار المحتوى (editor والكتّاب العامّين…).
--      السياسة المعتمدة: إدارة الألعاب حصرًا لـ super_admin و developer → تُعاد تعريفها بـ is_super_admin() (0012: المسؤول الأعلى + المطوّر).
--      كل سياسات RLS ودالة admin_adjust_game_points تستعملها فتتشدّد تلقائيًا بلا مساس بها.
--   2) الحذف الآمن: مفاتيح 0050 الأجنبية تحذف المحاولات والنتائج بالتتالي (on delete cascade) وتمنع حذف ما له نقاط (restrict).
--      لذا يُسحب DELETE المباشر عن الكتالوج، ويُستبدل بدوال تحذف فعليًا فقط ما لا سجلّ له، وتؤرشف ما له سجلّ (status = 'archived').
--   3) الحلول: الكتابة إليها عبر admin_save_game_challenge فقط (ذرّية مع التحدي)؛ القراءة تبقى للمدير عبر RLS ولا تصل اللاعب أبدًا.
--   4) سلامة البيانات: مشغّل يمنع نقل تحدٍّ ذي سجلّ إلى لعبة أخرى، ومشغّل يتحقق من شروط الإنجازات، ومشغّل يحمي مستوى 0 نقطة.
--   5) التدقيق: مشغّل واحد يسجّل كل تغيير إداري في audit_logs (بلا محتوى الحلول أو الإجابات، ويتجاهل تغييرات الترتيب وحدها).
--
-- الدوال (كلها SECURITY DEFINER وتتحقق من can_manage_games()؛ تُمنح لـ authenticated فقط):
--   admin_save_game_challenge · admin_delete_game_challenge · admin_delete_game · admin_reorder_game_items
--   admin_list_game_players · admin_get_game_player · admin_get_game_player_progress
--
-- لا يمسّ: 0049 ولا 0050 ولا أي جدول/دالة غير ألعاب. يتطلب: 0049 و0050 و0012 (is_super_admin) و0002 (audit_logs).
-- آمن لإعادة التشغيل. الرجوع: supabase/rollback/0052_games_admin_down.sql
-- ⚠️ تجربة جافة أولًا: استبدل `commit;` الأخيرة بـ `rollback;` ثم شغّل الملف، وإن نجح أعدها `commit;`.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.game_challenge_solutions') is null
     or to_regprocedure('public.admin_adjust_game_points(uuid,integer,text)') is null then
    raise exception 'شغّل 0050_games_core.sql أولاً';
  end if;
  if to_regprocedure('public.is_super_admin()') is null then
    raise exception 'شغّل 0012_budget_and_developer_role.sql أولاً';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) can_manage_games(): super_admin و developer فقط (مع شروط الوصول: MFA + كلمة المرور المؤقتة)
-- ---------------------------------------------------------------------
create or replace function public.can_manage_games()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.can_access_games() and coalesce(public.is_super_admin(), false);
$$;

revoke all on function public.can_manage_games() from public, anon, authenticated;
grant execute on function public.can_manage_games() to authenticated;

-- ---------------------------------------------------------------------
-- 2) سحب الحذف المباشر (يُستبدل بدوال آمنة) وسحب الكتابة المباشرة على الحلول
-- ---------------------------------------------------------------------
revoke delete on public.game_categories, public.games, public.game_challenges, public.game_achievements
  from public, anon, authenticated;
revoke insert, update, delete on public.game_challenge_solutions from public, anon, authenticated;
grant select on public.game_challenge_solutions to authenticated;

-- ---------------------------------------------------------------------
-- 3) مشغّلات سلامة البيانات
-- ---------------------------------------------------------------------
-- 3.1) تحدٍّ له محاولات أو نقاط لا يُنقل إلى لعبة أخرى (يحفظ معنى السجلّ التاريخي)
create or replace function public.game_challenges_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.game_id is distinct from old.game_id
     and (exists (select 1 from public.game_attempts where challenge_id = old.id)
          or exists (select 1 from public.game_points where challenge_id = old.id)) then
    raise exception 'history_locked';
  end if;
  return new;
end;
$$;
revoke all on function public.game_challenges_guard() from public, anon, authenticated;
drop trigger if exists trg_game_challenges_guard on public.game_challenges;
create trigger trg_game_challenges_guard before update on public.game_challenges
  for each row execute function public.game_challenges_guard();

-- 3.2) شروط الإنجاز: type ∈ {points_total, challenges_solved} وthreshold عدد صحيح موجب،
--      وgame_id (اختياري) للنوع الثاني ولعبة موجودة
create or replace function public.game_achievements_validate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_type text := new.criteria ->> 'type';
  v_gid  text := new.criteria ->> 'game_id';
begin
  if v_type is null or v_type not in ('points_total', 'challenges_solved') then
    raise exception 'invalid_criteria';
  end if;
  if jsonb_typeof(new.criteria -> 'threshold') is distinct from 'number'
     or (new.criteria ->> 'threshold') !~ '^[1-9][0-9]{0,8}$' then
    raise exception 'invalid_criteria';
  end if;
  if new.criteria ? 'game_id' then
    if v_type <> 'challenges_solved'
       or v_gid is null
       or v_gid !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       or not exists (select 1 from public.games g where g.id = v_gid::uuid) then
      raise exception 'invalid_criteria';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.game_achievements_validate() from public, anon, authenticated;
drop trigger if exists trg_game_achievements_validate on public.game_achievements;
create trigger trg_game_achievements_validate before insert or update of criteria on public.game_achievements
  for each row execute function public.game_achievements_validate();

-- 3.3) مستوى 0 نقطة لا يُحذف ولا يُرفع حدّه (وإلا بقي لاعب بلا مستوى)
create or replace function public.game_levels_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.min_points = 0 and (tg_op = 'DELETE' or new.min_points <> 0) then
    raise exception 'level_zero_required';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.game_levels_guard() from public, anon, authenticated;
drop trigger if exists trg_game_levels_guard on public.game_levels;
create trigger trg_game_levels_guard before update or delete on public.game_levels
  for each row execute function public.game_levels_guard();

-- 3.4) تدقيق إداري موحّد. لا يُسجَّل أي محتوى (حلول/إجابات/نصوص): نوع العملية والمعرّف والحالة فقط.
--      تغييرات الترتيب (sort_order) وحدها لا تُسجَّل كي لا يغرق السجلّ.
create or replace function public.game_admin_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  j        jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_id     uuid;
  v_action text;
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'sort_order' - 'updated_at') = (to_jsonb(old) - 'sort_order' - 'updated_at') then
    return new;
  end if;
  v_id := case when tg_table_name = 'game_levels' then null
               when tg_table_name = 'game_challenge_solutions' then (j ->> 'challenge_id')::uuid
               else (j ->> 'id')::uuid end;
  v_action := 'game_' || case tg_table_name when 'game_challenge_solutions' then 'solution' else tg_table_name end
              || '_' || lower(tg_op);
  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, metadata)
  values (auth.uid(), left(v_action, 60), tg_table_name, v_id, 'إدارة الألعاب',
          jsonb_build_object('op', tg_op, 'ref', coalesce(j ->> 'slug', j ->> 'code', j ->> 'level'), 'status', j ->> 'status'));
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.game_admin_audit() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['game_categories', 'games', 'game_challenges', 'game_challenge_solutions', 'game_achievements', 'game_levels']
  loop
    execute format('drop trigger if exists trg_game_admin_audit on public.%I;
                    create trigger trg_game_admin_audit after insert or update or delete on public.%I
                    for each row execute function public.game_admin_audit();', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4) حفظ تحدٍّ مع حلّه ذرّيًا. p_data مفاتيح: game_id, slug, title, description, difficulty, points_reward,
--    time_limit_seconds, max_attempts, content, status, starts_at, ends_at, sort_order, verify_mode, solution.
--    عند التعديل: ما غاب من المفاتيح يبقى كما هو (ومنه solution = إبقاء الحلّ الحالي). لا يُعاد الحلّ ولا يُسجَّل.
-- ---------------------------------------------------------------------
create or replace function public.admin_save_game_challenge(p_id uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d         jsonb := coalesce(p_data, '{}'::jsonb);
  v_id      uuid := p_id;
  v_mode    text;
  v_status  text;
  v_has_sol boolean;
begin
  if auth.uid() is null or not public.can_manage_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;
  if jsonb_typeof(d) <> 'object' then
    raise exception 'invalid_data';
  end if;
  v_has_sol := d ? 'solution';

  v_mode := coalesce(d ->> 'verify_mode', 'exact');
  if v_mode <> 'exact' then
    raise exception 'unsupported_verify_mode';
  end if;
  if v_has_sol and (jsonb_typeof(d -> 'solution') = 'null' or octet_length((d -> 'solution')::text) > 20000) then
    raise exception 'invalid_data';
  end if;

  if v_id is null then
    insert into public.game_challenges (game_id, slug, title, description, difficulty, points_reward, time_limit_seconds,
                                        max_attempts, content, status, starts_at, ends_at, sort_order)
    values ((d ->> 'game_id')::uuid, d ->> 'slug', d -> 'title', nullif(d -> 'description', 'null'::jsonb),
            coalesce((d ->> 'difficulty')::smallint, 1), coalesce((d ->> 'points_reward')::integer, 10),
            (d ->> 'time_limit_seconds')::integer, (d ->> 'max_attempts')::integer,
            coalesce(d -> 'content', '{}'::jsonb), coalesce(d ->> 'status', 'draft'),
            (d ->> 'starts_at')::timestamptz, (d ->> 'ends_at')::timestamptz, coalesce((d ->> 'sort_order')::integer, 0))
    returning id, status into v_id, v_status;
  else
    perform 1 from public.game_challenges where id = v_id for update;
    if not found then
      raise exception 'challenge_not_found';
    end if;
    update public.game_challenges c set
      game_id            = case when d ? 'game_id' then (d ->> 'game_id')::uuid else c.game_id end,
      slug               = case when d ? 'slug' then d ->> 'slug' else c.slug end,
      title              = case when d ? 'title' then d -> 'title' else c.title end,
      description        = case when d ? 'description' then nullif(d -> 'description', 'null'::jsonb) else c.description end,
      difficulty         = case when d ? 'difficulty' then (d ->> 'difficulty')::smallint else c.difficulty end,
      points_reward      = case when d ? 'points_reward' then (d ->> 'points_reward')::integer else c.points_reward end,
      time_limit_seconds = case when d ? 'time_limit_seconds' then (d ->> 'time_limit_seconds')::integer else c.time_limit_seconds end,
      max_attempts       = case when d ? 'max_attempts' then (d ->> 'max_attempts')::integer else c.max_attempts end,
      content            = case when d ? 'content' then d -> 'content' else c.content end,
      status             = case when d ? 'status' then d ->> 'status' else c.status end,
      starts_at          = case when d ? 'starts_at' then (d ->> 'starts_at')::timestamptz else c.starts_at end,
      ends_at            = case when d ? 'ends_at' then (d ->> 'ends_at')::timestamptz else c.ends_at end,
      sort_order         = case when d ? 'sort_order' then (d ->> 'sort_order')::integer else c.sort_order end
     where c.id = v_id
     returning c.status into v_status;
  end if;

  if v_has_sol then
    insert into public.game_challenge_solutions (challenge_id, verify_mode, solution)
    values (v_id, v_mode, d -> 'solution')
    on conflict (challenge_id) do update set verify_mode = excluded.verify_mode, solution = excluded.solution;
  end if;

  -- النشر يتطلب حلًّا محفوظًا قابلًا للتحقق (وإلا فشل التسليم لاحقًا بـ verification_unavailable)؛ الاستثناء يُلغي الحفظ كله
  if v_status = 'published'
     and not exists (select 1 from public.game_challenge_solutions s where s.challenge_id = v_id and s.verify_mode = 'exact') then
    raise exception 'solution_required';
  end if;

  return jsonb_build_object('id', v_id, 'status', v_status);
exception
  when unique_violation then raise exception 'slug_taken';
  when foreign_key_violation then raise exception 'game_not_found';
  when check_violation or invalid_text_representation or numeric_value_out_of_range
       or invalid_datetime_format or datetime_field_overflow or not_null_violation then
    raise exception 'invalid_data';
end;
$$;

-- ---------------------------------------------------------------------
-- 5) الحذف الآمن: يحذف فعليًا فقط ما لا سجلّ له، وإلا يؤرشف (يبقى السجلّ التاريخي سليمًا)
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 6) إعادة الترتيب: p_ids بالترتيب الجديد (1..n). النوع من قائمة بيضاء.
-- ---------------------------------------------------------------------
create or replace function public.admin_reorder_game_items(p_kind text, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.can_manage_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 500 then
    raise exception 'invalid_data';
  end if;
  if p_kind = 'category' then
    update public.game_categories t set sort_order = o.pos from unnest(p_ids) with ordinality as o(id, pos) where t.id = o.id;
  elsif p_kind = 'game' then
    update public.games t set sort_order = o.pos from unnest(p_ids) with ordinality as o(id, pos) where t.id = o.id;
  elsif p_kind = 'challenge' then
    update public.game_challenges t set sort_order = o.pos from unnest(p_ids) with ordinality as o(id, pos) where t.id = o.id;
  elsif p_kind = 'achievement' then
    update public.game_achievements t set sort_order = o.pos from unnest(p_ids) with ordinality as o(id, pos) where t.id = o.id;
  else
    raise exception 'invalid_kind';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 7) اللاعبون (قراءة فقط). اللاعب = من لديه محاولة أو نقاط أو إنجاز؛ والبحث يتعدّاهم إلى الحسابات الإدارية وحسابات الأعضاء
--    (لتمكين تسوية نقاط لحساب لم يلعب بعد). الاسم والبريد للمدير فقط.
-- ---------------------------------------------------------------------
create or replace function public.admin_list_game_players(p_search text default null, p_limit integer default 25, p_offset integer default 0)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_q     text := nullif(btrim(coalesce(p_search, '')), '');
  v_like  text;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_off   integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_rows  jsonb;
begin
  if auth.uid() is null or not public.can_manage_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;
  v_like := case when v_q is null then null
                 else '%' || replace(replace(replace(lower(left(v_q, 80)), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;

  with active_users as (
    select user_id from public.game_attempts
    union select user_id from public.game_points
    union select user_id from public.game_user_achievements
  ),
  people as (
    select u.id as user_id,
           coalesce(p.full_name, m.full_name, u.email::text) as display_name,
           coalesce(p.email, u.email::text)                  as email,
           case when p.id is not null then 'admin' when ma.user_id is not null then 'member' else 'other' end as kind
      from auth.users u
      left join public.profiles p on p.id = u.id
      left join public.member_accounts ma on ma.user_id = u.id
      left join public.members m on m.id = ma.member_id
     where u.id in (select user_id from active_users)
        or (v_like is not null and (p.id is not null or ma.user_id is not null))
  ),
  filtered as (
    select * from people
     where v_like is null
        or lower(coalesce(display_name, '')) like v_like escape '\'
        or lower(coalesce(email, '')) like v_like escape '\'
  ),
  scored as (
    select f.*, public.game_user_total(f.user_id) as total_points from filtered f
  ),
  page as (
    select * from scored order by total_points desc, display_name limit v_limit offset v_off
  )
  select (select count(*) from scored)::integer,
         coalesce(jsonb_agg(jsonb_build_object(
           'user_id', pg.user_id, 'display_name', pg.display_name, 'email', pg.email, 'kind', pg.kind,
           'total_points', pg.total_points,
           'level', (public.game_level_for_points(pg.total_points) ->> 'level')::integer,
           'attempts_count', (select count(*) from public.game_attempts a where a.user_id = pg.user_id and a.status = 'submitted'),
           'solved_challenges', (select count(distinct r.challenge_id) from public.game_results r where r.user_id = pg.user_id and r.is_correct),
           'achievements_count', (select count(*) from public.game_user_achievements ua where ua.user_id = pg.user_id)
         ) order by pg.total_points desc, pg.display_name), '[]'::jsonb)
    into v_total, v_rows
    from page pg;

  return jsonb_build_object('total', coalesce(v_total, 0), 'rows', coalesce(v_rows, '[]'::jsonb));
end;
$$;

create or replace function public.admin_get_game_player(p_user_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_total integer;
  v_info  jsonb;
begin
  if auth.uid() is null or not public.can_manage_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;
  select jsonb_build_object('user_id', u.id,
                            'display_name', coalesce(p.full_name, m.full_name, u.email::text),
                            'email', coalesce(p.email, u.email::text),
                            'kind', case when p.id is not null then 'admin' when ma.user_id is not null then 'member' else 'other' end)
    into v_info
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.member_accounts ma on ma.user_id = u.id
    left join public.members m on m.id = ma.member_id
   where u.id = p_user_id;
  if v_info is null then
    raise exception 'user_not_found';
  end if;
  v_total := public.game_user_total(p_user_id);
  return v_info || jsonb_build_object(
    'total_points', v_total,
    'level', public.game_level_for_points(v_total),
    'next_level', public.game_next_level_for_points(v_total),
    'solved_challenges', (select count(distinct r.challenge_id) from public.game_results r where r.user_id = p_user_id and r.is_correct),
    'attempts_count', (select count(*) from public.game_attempts t where t.user_id = p_user_id and t.status = 'submitted'),
    'achievements_count', (select count(*) from public.game_user_achievements ua where ua.user_id = p_user_id));
end;
$$;

-- تقدّم اللاعب لكل تحدٍّ حاول فيه (مجمَّع في الخادم: بلا قوائم ضخمة في الواجهة)
create or replace function public.admin_get_game_player_progress(p_user_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.can_manage_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.last_attempt_at desc)
      from (
        select a.challenge_id, c.game_id,
               count(*)::integer as attempts,
               (count(*) filter (where a.status = 'submitted'))::integer as submitted,
               coalesce(bool_or(r.is_correct), false) as solved,
               coalesce(max(r.score), 0) as best_score,
               min(r.duration_ms) filter (where r.is_correct) as best_duration_ms,
               coalesce((select sum(pt.delta) from public.game_points pt
                          where pt.user_id = p_user_id and pt.challenge_id = a.challenge_id and pt.reason = 'challenge_solved'), 0)::integer as points,
               max(a.started_at) as last_attempt_at
          from public.game_attempts a
          join public.game_challenges c on c.id = a.challenge_id
          left join public.game_results r on r.attempt_id = a.id
         where a.user_id = p_user_id
         group by a.challenge_id, c.game_id
      ) x), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_save_game_challenge(uuid, jsonb)            from public, anon, authenticated;
revoke all on function public.admin_delete_game_challenge(uuid)                 from public, anon, authenticated;
revoke all on function public.admin_delete_game(uuid)                           from public, anon, authenticated;
revoke all on function public.admin_reorder_game_items(text, uuid[])            from public, anon, authenticated;
revoke all on function public.admin_list_game_players(text, integer, integer)   from public, anon, authenticated;
revoke all on function public.admin_get_game_player(uuid)                       from public, anon, authenticated;
revoke all on function public.admin_get_game_player_progress(uuid)              from public, anon, authenticated;
grant execute on function public.admin_save_game_challenge(uuid, jsonb)          to authenticated;
grant execute on function public.admin_delete_game_challenge(uuid)               to authenticated;
grant execute on function public.admin_delete_game(uuid)                         to authenticated;
grant execute on function public.admin_reorder_game_items(text, uuid[])          to authenticated;
grant execute on function public.admin_list_game_players(text, integer, integer) to authenticated;
grant execute on function public.admin_get_game_player(uuid)                     to authenticated;
grant execute on function public.admin_get_game_player_progress(uuid)            to authenticated;

notify pgrst, 'reload schema';

commit;
