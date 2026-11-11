-- ============================================================
-- 0050_games_core.sql — نواة وحدة الألعاب (IAE Games) — المرحلة 2: قاعدة البيانات والمنطق المركزي
--
-- الهدف: محرك عام للألعاب والتحديات والمحاولات والنتائج والنقاط والإنجازات والمستويات، بلا أي لعبة محددة.
--   إضافة لعبة/تحدٍّ جديد = صفوف بيانات فقط (games.kind نص حرّ بصيغة محدّدة، وgame_challenges.content jsonb).
--
-- الجداول (كلها RLS مفعّل):
--   game_categories · games · game_challenges · game_challenge_solutions (الحلول، مغلقة عن اللاعبين)
--   game_attempts · game_results · game_points · game_achievements · game_user_achievements · game_levels
--
-- الأمان (الأصل: الرفض):
--   * لا يملك أي مستخدم INSERT/UPDATE/DELETE على attempts/results/points/user_achievements: القراءة فقط لصفوفه هو.
--     الكتابة حصرًا عبر دوال SECURITY DEFINER التي تتحقق من can_access_games() ومن هوية اللاعب (auth.uid()).
--   * الواجهة لا ترسل نقاطًا ولا نتيجة: ترسل «إجابة» فقط، والخادم يحسب الصحة والنقاط والمدة من الحل المحفوظ.
--   * الحلول في جدول منفصل لا يقرؤه إلا من يملك can_manage_games()، فلا تتسرّب مع قائمة التحديات.
--   * النقاط عن تحدٍّ تُمنح مرة واحدة لكل (لاعب، تحدٍّ) بقيد فهرس فريد؛ والإنجاز مرة واحدة لكل (لاعب، إنجاز).
--   * game_results وgame_points لا يُعدَّلان بعد الإدراج (مشغّل حماية)؛ التصحيح بصفّ تسوية جديد (admin_adjustment).
--   * can_manage_games() = can_access_games() (MFA + كلمة المرور المؤقتة) و can_manage_content(). لا أدوار مكتوبة هنا.
--
-- الدوال: can_manage_games() · start_game_attempt() · submit_game_attempt() · get_my_game_summary() · admin_adjust_game_points()
--   + مساعدات داخلية بلا منح لأي دور (game_level_for_points / game_user_total / game_verify_answer / game_grant_achievements).
--
-- لا يمسّ: 0049 ولا أي جدول/دالة/سياسة قائمة. يتطلب: 0049 و0019 و0004 (set_updated_at) و0002 (audit_logs).
-- آمن لإعادة التشغيل (create if not exists / create or replace / drop policy if exists).
-- الرجوع: supabase/rollback/0050_games_core_down.sql (⚠️ يحذف بيانات الألعاب).
-- ⚠️ تجربة جافة أولًا: استبدل `commit;` الأخيرة بـ `rollback;` ثم شغّل الملف، وإن نجح أعدها `commit;`.
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public.can_access_games()') is null then
    raise exception 'شغّل 0049_games_access.sql أولاً';
  end if;
  if to_regprocedure('public.can_manage_content()') is null or to_regprocedure('public.is_admin()') is null then
    raise exception 'شغّل 0019_new_roles_and_file_delete_fix.sql أولاً';
  end if;
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'شغّل 0004_functions_and_triggers.sql أولاً';
  end if;
  if to_regclass('public.audit_logs') is null then
    raise exception 'جدول audit_logs غير موجود';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) can_manage_games(): من يدير كتالوج الألعاب (إدارة المحتوى + شروط الوصول كاملة)
-- ---------------------------------------------------------------------
create or replace function public.can_manage_games()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.can_access_games() and coalesce(public.can_manage_content(), false);
$$;

revoke all on function public.can_manage_games() from public, anon, authenticated;
grant execute on function public.can_manage_games() to authenticated;

-- ---------------------------------------------------------------------
-- 2) الكتالوج: التصنيفات، الألعاب، التحديات، الحلول، المستويات، الإنجازات
--    النصوص متعددة اللغات jsonb: {"ar": "...", "fr": "...", "en": "..."} (مفتاح واحد على الأقل).
-- ---------------------------------------------------------------------
create table if not exists public.game_categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 64),
  name        jsonb not null check (jsonb_typeof(name) = 'object' and name <> '{}'::jsonb),
  description jsonb check (description is null or jsonb_typeof(description) = 'object'),
  icon        text check (icon is null or char_length(icon) <= 64),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.games (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.game_categories(id) on delete restrict,
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 64),
  -- نوع اللعبة يحدّد مكوّن الواجهة لاحقًا (puzzle, coding, quiz, ...). نص حرّ بصيغة آمنة: نوع جديد بلا Migration.
  kind        text not null check (kind ~ '^[a-z][a-z0-9_]{1,31}$'),
  title       jsonb not null check (jsonb_typeof(title) = 'object' and title <> '{}'::jsonb),
  description jsonb check (description is null or jsonb_typeof(description) = 'object'),
  status      text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  sort_order  integer not null default 0,
  config      jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_games_category on public.games (category_id, sort_order);
create index if not exists idx_games_status   on public.games (status, sort_order);

create table if not exists public.game_challenges (
  id                 uuid primary key default gen_random_uuid(),
  game_id            uuid not null references public.games(id) on delete cascade,
  slug               text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 64),
  title              jsonb not null check (jsonb_typeof(title) = 'object' and title <> '{}'::jsonb),
  description        jsonb check (description is null or jsonb_typeof(description) = 'object'),
  difficulty         smallint not null default 1 check (difficulty between 1 and 5),
  points_reward      integer not null default 10 check (points_reward between 0 and 10000),
  time_limit_seconds integer check (time_limit_seconds is null or time_limit_seconds between 5 and 86400),
  max_attempts       integer check (max_attempts is null or max_attempts between 1 and 1000),
  -- الجزء العلني من التحدي (لوحة Sudoku، نص السؤال، …). لا تضع الحل هنا أبدًا: الحل في game_challenge_solutions.
  content            jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  status             text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  starts_at          timestamptz,
  ends_at            timestamptz,
  sort_order         integer not null default 0,
  created_by         uuid default auth.uid() references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (game_id, slug),
  check (starts_at is null or ends_at is null or ends_at > starts_at)
);
create index if not exists idx_game_challenges_game       on public.game_challenges (game_id, status, sort_order);
create index if not exists idx_game_challenges_difficulty on public.game_challenges (difficulty);

-- الحل التحقّقي للتحدي (مغلق عن اللاعبين). verify_mode:
--   exact    : مساواة jsonb بين الإجابة والحل (Sudoku، اختيار من متعدد، …).
--   external : محجوز لتحقّق خارجي لاحق (مثل ألعاب البرمجة عبر Edge Function)؛ submit_game_attempt يرفضه الآن (fail closed).
create table if not exists public.game_challenge_solutions (
  challenge_id uuid primary key references public.game_challenges(id) on delete cascade,
  verify_mode  text not null default 'exact' check (verify_mode in ('exact', 'external')),
  solution     jsonb not null,
  updated_at   timestamptz not null default now()
);

create table if not exists public.game_levels (
  level      integer primary key check (level >= 1),
  min_points integer not null unique check (min_points >= 0),
  title      jsonb not null check (jsonb_typeof(title) = 'object' and title <> '{}'::jsonb),
  icon       text check (icon is null or char_length(icon) <= 64)
);

-- criteria: {"type": "points_total" | "challenges_solved", "threshold": N [, "game_id": uuid]}.
-- نوع غير معروف لا يُمنح أبدًا (تُضاف الأنواع في game_grant_achievements دون تغيير الجدول).
create table if not exists public.game_achievements (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  title        jsonb not null check (jsonb_typeof(title) = 'object' and title <> '{}'::jsonb),
  description  jsonb check (description is null or jsonb_typeof(description) = 'object'),
  icon         text check (icon is null or char_length(icon) <= 64),
  points_bonus integer not null default 0 check (points_bonus between 0 and 10000),
  criteria     jsonb not null check (jsonb_typeof(criteria) = 'object' and jsonb_typeof(criteria -> 'type') = 'string'),
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3) بيانات اللاعبين (قراءة فقط من الواجهة؛ الكتابة عبر RPC)
--    اللاعب = auth.users.id (يشمل الإداري بلا عضوية). لا ربط بـ members حتى لا يُستبعد الإداريون.
-- ---------------------------------------------------------------------
create table if not exists public.game_attempts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  challenge_id uuid not null references public.game_challenges(id) on delete cascade,
  status       text not null default 'in_progress' check (status in ('in_progress', 'submitted', 'expired')),
  started_at   timestamptz not null default now(),
  expires_at   timestamptz,
  finished_at  timestamptz,
  answer       jsonb,
  check ((status = 'in_progress') = (finished_at is null)),
  unique (id, user_id, challenge_id)
);
-- محاولة جارية واحدة لكل (لاعب، تحدٍّ)
create unique index if not exists uq_game_attempts_one_open
  on public.game_attempts (user_id, challenge_id) where status = 'in_progress';
create index if not exists idx_game_attempts_user_challenge on public.game_attempts (user_id, challenge_id, started_at desc);
create index if not exists idx_game_attempts_challenge      on public.game_attempts (challenge_id);

-- user_id/challenge_id مكرّران عمدًا (فهرسة وRLS)، ويضمن المفتاح الأجنبي المركّب اتساقهما مع المحاولة.
create table if not exists public.game_results (
  id           uuid primary key default gen_random_uuid(),
  attempt_id   uuid not null unique,
  user_id      uuid not null,
  challenge_id uuid not null,
  is_correct   boolean not null,
  score        integer not null check (score between 0 and 100),
  duration_ms  bigint not null check (duration_ms >= 0),
  created_at   timestamptz not null default now(),
  foreign key (attempt_id, user_id, challenge_id)
    references public.game_attempts (id, user_id, challenge_id) on delete cascade
);
create index if not exists idx_game_results_user      on public.game_results (user_id, created_at desc);
create index if not exists idx_game_results_challenge on public.game_results (challenge_id, is_correct);

-- سجل النقاط (دفتر حسابات): المجموع = sum(delta). لا عمود «مجموع» مخزَّن فلا تكرار ولا انحراف.
create table if not exists public.game_points (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  delta          integer not null check (delta <> 0 and delta between -100000 and 100000),
  reason         text not null check (reason in ('challenge_solved', 'achievement', 'admin_adjustment')),
  challenge_id   uuid references public.game_challenges(id) on delete restrict,
  result_id      uuid references public.game_results(id) on delete set null,
  achievement_id uuid references public.game_achievements(id) on delete restrict,
  note           text check (note is null or char_length(note) <= 500),
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  check (reason <> 'challenge_solved' or (challenge_id is not null and delta > 0)),
  check (reason <> 'achievement' or (achievement_id is not null and delta > 0)),
  check (reason <> 'admin_adjustment' or (note is not null and btrim(note) <> ''))
);
create index if not exists idx_game_points_user on public.game_points (user_id, created_at desc);
-- منع الازدواج: نقاط التحدي والإنجاز تُمنح مرة واحدة فقط
create unique index if not exists uq_game_points_challenge
  on public.game_points (user_id, challenge_id) where reason = 'challenge_solved';
create unique index if not exists uq_game_points_achievement
  on public.game_points (user_id, achievement_id) where reason = 'achievement';

create table if not exists public.game_user_achievements (
  user_id        uuid not null references auth.users(id) on delete cascade,
  achievement_id uuid not null references public.game_achievements(id) on delete restrict,
  unlocked_at    timestamptz not null default now(),
  primary key (user_id, achievement_id)
);
create index if not exists idx_game_user_achievements_ach on public.game_user_achievements (achievement_id);

-- ---------------------------------------------------------------------
-- 4) مشغّلات: updated_at + حماية عدم التعديل (تعمل حتى على مالك الجدول)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['game_categories', 'games', 'game_challenges', 'game_challenge_solutions', 'game_achievements']
  loop
    execute format('drop trigger if exists trg_set_updated_at on public.%I;
                    create trigger trg_set_updated_at before update on public.%I
                    for each row execute function public.set_updated_at();', t, t);
  end loop;
end $$;

create or replace function public.game_results_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'game_results_immutable';
end;
$$;

-- game_points: يُسمح فقط بتصفير result_id (مفتاح أجنبي on delete set null)؛ أي عمود آخر ممنوع،
-- ولا يجوز تغيير result_id إلى نتيجة أخرى.
create or replace function public.game_points_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (new.id, new.user_id, new.delta, new.reason, new.challenge_id, new.achievement_id, new.note, new.created_by, new.created_at)
     is distinct from
     (old.id, old.user_id, old.delta, old.reason, old.challenge_id, old.achievement_id, old.note, old.created_by, old.created_at)
     or (new.result_id is distinct from old.result_id and new.result_id is not null) then
    raise exception 'game_points_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.game_results_immutable() from public, anon, authenticated;
revoke all on function public.game_points_immutable()  from public, anon, authenticated;

drop trigger if exists trg_game_results_immutable on public.game_results;
create trigger trg_game_results_immutable before update on public.game_results
  for each row execute function public.game_results_immutable();

drop trigger if exists trg_game_points_immutable on public.game_points;
create trigger trg_game_points_immutable before update on public.game_points
  for each row execute function public.game_points_immutable();

-- ---------------------------------------------------------------------
-- 5) الصلاحيات وRLS
-- ---------------------------------------------------------------------
alter table public.game_categories          enable row level security;
alter table public.games                    enable row level security;
alter table public.game_challenges          enable row level security;
alter table public.game_challenge_solutions enable row level security;
alter table public.game_levels              enable row level security;
alter table public.game_achievements        enable row level security;
alter table public.game_attempts            enable row level security;
alter table public.game_results             enable row level security;
alter table public.game_points              enable row level security;
alter table public.game_user_achievements   enable row level security;

revoke all on table public.game_categories, public.games, public.game_challenges, public.game_challenge_solutions,
                    public.game_levels, public.game_achievements, public.game_attempts, public.game_results,
                    public.game_points, public.game_user_achievements
  from public, anon, authenticated;

-- الكتالوج: قراءة للمصادقين (تُقيّدها السياسات) وكتابة تحكمها can_manage_games() في السياسات.
grant select, insert, update, delete on public.game_categories, public.games, public.game_challenges,
                                        public.game_challenge_solutions, public.game_levels, public.game_achievements
  to authenticated;
-- بيانات اللاعبين: قراءة فقط. لا INSERT/UPDATE/DELETE لأي دور عميل.
grant select on public.game_attempts, public.game_results, public.game_points, public.game_user_achievements
  to authenticated;

-- ---- الكتالوج: اللاعب يرى المنشور فقط؛ المدير يرى الكل ويكتب ----
drop policy if exists game_categories_select on public.game_categories;
create policy game_categories_select on public.game_categories for select to authenticated
  using ((select public.can_access_games()) and (is_active or (select public.can_manage_games())));
drop policy if exists game_categories_manage on public.game_categories;
create policy game_categories_manage on public.game_categories for all to authenticated
  using ((select public.can_manage_games())) with check ((select public.can_manage_games()));

drop policy if exists games_select on public.games;
create policy games_select on public.games for select to authenticated
  using (
    (select public.can_access_games())
    and (
      (select public.can_manage_games())
      or (status = 'published'
          and exists (select 1 from public.game_categories gc where gc.id = games.category_id and gc.is_active))
    )
  );
drop policy if exists games_manage on public.games;
create policy games_manage on public.games for all to authenticated
  using ((select public.can_manage_games())) with check ((select public.can_manage_games()));

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
drop policy if exists game_challenges_manage on public.game_challenges;
create policy game_challenges_manage on public.game_challenges for all to authenticated
  using ((select public.can_manage_games())) with check ((select public.can_manage_games()));

-- الحلول: المدير فقط (لا سياسة لأي لاعب)
drop policy if exists game_challenge_solutions_manage on public.game_challenge_solutions;
create policy game_challenge_solutions_manage on public.game_challenge_solutions for all to authenticated
  using ((select public.can_manage_games())) with check ((select public.can_manage_games()));

drop policy if exists game_levels_select on public.game_levels;
create policy game_levels_select on public.game_levels for select to authenticated
  using ((select public.can_access_games()));
drop policy if exists game_levels_manage on public.game_levels;
create policy game_levels_manage on public.game_levels for all to authenticated
  using ((select public.can_manage_games())) with check ((select public.can_manage_games()));

drop policy if exists game_achievements_select on public.game_achievements;
create policy game_achievements_select on public.game_achievements for select to authenticated
  using ((select public.can_access_games()) and (is_active or (select public.can_manage_games())));
drop policy if exists game_achievements_manage on public.game_achievements;
create policy game_achievements_manage on public.game_achievements for all to authenticated
  using ((select public.can_manage_games())) with check ((select public.can_manage_games()));

-- ---- بيانات اللاعبين: صفوفي أنا فقط (بشرط الوصول)، والمدير يقرأ الكل. لا سياسات كتابة إطلاقًا. ----
drop policy if exists game_attempts_select_own on public.game_attempts;
create policy game_attempts_select_own on public.game_attempts for select to authenticated
  using (user_id = (select auth.uid()) and (select public.can_access_games()));
drop policy if exists game_attempts_select_manager on public.game_attempts;
create policy game_attempts_select_manager on public.game_attempts for select to authenticated
  using ((select public.can_manage_games()));

drop policy if exists game_results_select_own on public.game_results;
create policy game_results_select_own on public.game_results for select to authenticated
  using (user_id = (select auth.uid()) and (select public.can_access_games()));
drop policy if exists game_results_select_manager on public.game_results;
create policy game_results_select_manager on public.game_results for select to authenticated
  using ((select public.can_manage_games()));

drop policy if exists game_points_select_own on public.game_points;
create policy game_points_select_own on public.game_points for select to authenticated
  using (user_id = (select auth.uid()) and (select public.can_access_games()));
drop policy if exists game_points_select_manager on public.game_points;
create policy game_points_select_manager on public.game_points for select to authenticated
  using ((select public.can_manage_games()));

drop policy if exists game_user_achievements_select_own on public.game_user_achievements;
create policy game_user_achievements_select_own on public.game_user_achievements for select to authenticated
  using (user_id = (select auth.uid()) and (select public.can_access_games()));
drop policy if exists game_user_achievements_select_manager on public.game_user_achievements;
create policy game_user_achievements_select_manager on public.game_user_achievements for select to authenticated
  using ((select public.can_manage_games()));

-- ---------------------------------------------------------------------
-- 6) مساعدات داخلية (بلا منح لأي دور؛ تستدعيها دوال SECURITY DEFINER فقط)
-- ---------------------------------------------------------------------
create or replace function public.game_user_total(p_user_id uuid)
returns integer
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(sum(delta), 0)::integer from public.game_points where user_id = p_user_id;
$$;

-- {level, title, min_points} لأعلى مستوى بلغه المجموع (أو null إن لم تُعرَّف مستويات)
create or replace function public.game_level_for_points(p_points integer)
returns jsonb
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select (select jsonb_build_object('level', l.level, 'title', l.title, 'min_points', l.min_points)
            from public.game_levels l
           where l.min_points <= greatest(coalesce(p_points, 0), 0)
           order by l.min_points desc
           limit 1);
$$;

-- المستوى التالي (أقل مستوى فوق المجموع) أو null
create or replace function public.game_next_level_for_points(p_points integer)
returns jsonb
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select (select jsonb_build_object('level', l.level, 'title', l.title, 'min_points', l.min_points)
            from public.game_levels l
           where l.min_points > greatest(coalesce(p_points, 0), 0)
           order by l.min_points asc
           limit 1);
$$;

-- التحقق من الإجابة على الخادم. أي وضع غير مدعوم = خطأ (لا نجاح ضمني).
create or replace function public.game_verify_answer(p_mode text, p_solution jsonb, p_answer jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if p_mode = 'exact' then
    return p_solution = p_answer;
  end if;
  raise exception 'verification_unavailable';
end;
$$;

-- يمنح الإنجازات المستحقّة (مع مكافآت النقاط) ويعيد مصفوفة المفتوح حديثًا. يكرّر حتى لا يتبقى جديد (المكافأة قد تفتح غيرها).
create or replace function public.game_grant_achievements(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a           record;
  v_threshold integer;
  v_metric    integer;
  v_game      uuid;
  v_new       jsonb := '[]'::jsonb;
  v_found     boolean := true;
begin
  while v_found loop
    v_found := false;
    for a in
      select ach.id, ach.code, ach.title, ach.points_bonus, ach.criteria
        from public.game_achievements ach
       where ach.is_active
         and not exists (select 1 from public.game_user_achievements ua
                          where ua.user_id = p_user_id and ua.achievement_id = ach.id)
       order by ach.sort_order, ach.created_at, ach.id
    loop
      v_threshold := case when a.criteria ->> 'threshold' ~ '^[0-9]{1,9}$' then (a.criteria ->> 'threshold')::integer end;
      continue when v_threshold is null;

      v_metric := null;
      if a.criteria ->> 'type' = 'points_total' then
        v_metric := public.game_user_total(p_user_id);
      elsif a.criteria ->> 'type' = 'challenges_solved' then
        v_game := case when a.criteria ->> 'game_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                       then (a.criteria ->> 'game_id')::uuid end;
        continue when (a.criteria ? 'game_id') and v_game is null;
        select count(distinct r.challenge_id)::integer into v_metric
          from public.game_results r
          join public.game_challenges c on c.id = r.challenge_id
         where r.user_id = p_user_id and r.is_correct and (v_game is null or c.game_id = v_game);
      end if;
      continue when v_metric is null or v_metric < v_threshold;

      insert into public.game_user_achievements (user_id, achievement_id)
      values (p_user_id, a.id)
      on conflict do nothing;
      continue when not found;

      if a.points_bonus > 0 then
        insert into public.game_points (user_id, delta, reason, achievement_id)
        values (p_user_id, a.points_bonus, 'achievement', a.id)
        on conflict do nothing;
      end if;
      v_new := v_new || jsonb_build_object('id', a.id, 'code', a.code, 'title', a.title, 'points_bonus', a.points_bonus);
      v_found := true;
    end loop;
  end loop;
  return v_new;
end;
$$;

revoke all on function public.game_user_total(uuid)                    from public, anon, authenticated;
revoke all on function public.game_level_for_points(integer)           from public, anon, authenticated;
revoke all on function public.game_next_level_for_points(integer)      from public, anon, authenticated;
revoke all on function public.game_verify_answer(text, jsonb, jsonb)   from public, anon, authenticated;
revoke all on function public.game_grant_achievements(uuid)            from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7) RPC: بدء محاولة (idempotent: تُستأنف المحاولة الجارية غير المنتهية)
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

-- ---------------------------------------------------------------------
-- 8) RPC: تسليم الإجابة. الخادم وحده يقرّر الصحة والنقاط والمدة. لا تُعاد الإجابة الصحيحة أبدًا.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 9) RPC: ملخّص اللاعب (نقاط، مستوى، المستوى التالي، إحصاءات)
-- ---------------------------------------------------------------------
create or replace function public.get_my_game_summary()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_total integer;
begin
  if v_uid is null or not public.can_access_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;
  v_total := public.game_user_total(v_uid);
  return jsonb_build_object(
    'total_points', v_total,
    'level', public.game_level_for_points(v_total),
    'next_level', public.game_next_level_for_points(v_total),
    'solved_challenges', (select count(distinct r.challenge_id) from public.game_results r where r.user_id = v_uid and r.is_correct),
    'attempts_count', (select count(*) from public.game_attempts t where t.user_id = v_uid and t.status = 'submitted'),
    'achievements_count', (select count(*) from public.game_user_achievements ua where ua.user_id = v_uid)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 10) RPC إدارية: تسوية نقاط يدوية (منح/خصم) بسبب إلزامي وسجلّ تدقيق
-- ---------------------------------------------------------------------
create or replace function public.admin_adjust_game_points(p_user_id uuid, p_delta integer, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id    uuid;
  v_total integer;
begin
  if auth.uid() is null or not public.can_manage_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;
  if p_delta is null or p_delta = 0 or p_delta not between -100000 and 100000 then
    raise exception 'invalid_delta';
  end if;
  if p_note is null or btrim(p_note) = '' or char_length(p_note) > 500 then
    raise exception 'note_required';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'user_not_found';
  end if;

  insert into public.game_points (user_id, delta, reason, note, created_by)
  values (p_user_id, p_delta, 'admin_adjustment', btrim(p_note), auth.uid())
  returning id into v_id;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, metadata)
  values (auth.uid(), 'game_points_adjusted', 'game_points', v_id, 'تسوية نقاط ألعاب',
          jsonb_build_object('target_user', p_user_id, 'delta', p_delta));

  -- الإنجازات أولًا (مكافآتها نقاط)، ثم المجموع النهائي
  perform public.game_grant_achievements(p_user_id);
  v_total := public.game_user_total(p_user_id);
  return jsonb_build_object('id', v_id, 'total_points', v_total);
end;
$$;

revoke all on function public.start_game_attempt(uuid)                     from public, anon, authenticated;
revoke all on function public.submit_game_attempt(uuid, jsonb)             from public, anon, authenticated;
revoke all on function public.get_my_game_summary()                        from public, anon, authenticated;
revoke all on function public.admin_adjust_game_points(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.start_game_attempt(uuid)                      to authenticated;
grant execute on function public.submit_game_attempt(uuid, jsonb)              to authenticated;
grant execute on function public.get_my_game_summary()                         to authenticated;
grant execute on function public.admin_adjust_game_points(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------
-- 11) بيانات أولية: مستويات التقدّم (قابلة للتعديل لاحقًا). المستوى 1 عند 0 نقطة دائمًا.
-- ---------------------------------------------------------------------
insert into public.game_levels (level, min_points, title) values
  (1,    0, '{"ar":"مبتدئ","fr":"Débutant","en":"Beginner"}'),
  (2,  100, '{"ar":"متعلّم","fr":"Apprenti","en":"Learner"}'),
  (3,  300, '{"ar":"متقدّم","fr":"Avancé","en":"Advanced"}'),
  (4,  700, '{"ar":"خبير","fr":"Expert","en":"Expert"}'),
  (5, 1500, '{"ar":"محترف","fr":"Maître","en":"Master"}')
on conflict (level) do nothing;

notify pgrst, 'reload schema';

commit;
