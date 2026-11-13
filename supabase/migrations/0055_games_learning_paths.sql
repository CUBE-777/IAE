-- ============================================================
-- 0055_games_learning_paths.sql — Learning Paths (IAE Games) — المرحلة 6.1: أساس قاعدة البيانات
--
-- الهرم: Game → Track → Category → Stage → Challenge → Challenge Version
--   game_tracks · game_track_categories · game_stages · game_challenge_versions
--   game_challenge_version_solutions (حلّ كل إصدار، مغلق عن اللاعبين) · game_stage_grants (فتح/اعتماد يدوي)
--   + أعمدة على game_challenges: stage_id · is_required · current_version_id
--   + عمود على game_attempts: challenge_version_id
--   (game_track_categories غير game_categories: تلك تصنيفات الألعاب نفسها وتبقى كما هي.)
--
-- أهم القرارات (التفاصيل في تقرير المرحلة):
--   * الاتساق بمفاتيح أجنبية مركّبة (game_id مكرّر عمدًا على كل مستوى، كنمط 0050): لا يمكن ربط مرحلة بفئة/مسار/لعبة أخرى،
--     ولا تحدٍّ بمرحلة من لعبة أخرى، ولا محاولة بإصدار تحدٍّ آخر. حذف مرحلة/فئة/مسار فيه تحديات مرفوض (NO ACTION).
--   * الفتح: game_track_categories.stage_unlock_mode ∈ sequential | free | manual (الترتيب يخصّ مراحل الفئة الواحدة).
--     الإكمال: game_stages.completion_mode ∈ all_required | min_success_rate | min_points | manual + completion_threshold واحد.
--     التحديات الإلزامية: game_challenges.is_required. المراحل لا تخزّن «تقدّمًا»: يُشتقّ لاحقًا (6.2) من game_results/game_points،
--     ولا يحتاج غير game_stage_grants للحالتين اليدويتين (kind = unlock | complete).
--   * الإصدارات (Content Versioning): كل إصدار يحمل عنوانه/وصفه (ar/fr/en) ولغته الافتراضية وسياسة fallback ومحتواه وإعداداته؛
--     وحلّه في game_challenge_version_solutions. الإصدار المنشور أو المؤرشف لا يتغيّر أبدًا (مشغّل حماية).
--     لا يُحذف إصدار منشور/مؤرشف ولا حلّه (مشغّلات DELETE تشمل CASCADE)، فيتعذّر حذف تحدٍّ له إصدارات كهذه؛ المسودّة غير المستعملة تُحذف.
--     النشر عبر admin_publish_game_challenge_version() حصرًا: تؤرشف المنشور السابق، وتُسقط الإصدار على game_challenges
--     وgame_challenge_solutions (الإسقاط الحيّ للواجهة وstart_game_attempt). المحاولات الجارية تكمل على إصدارها ولا تُنهى بالنشر.
--   * الربط التاريخي: game_attempts.challenge_version_id يُملأ بمشغّل عند الإدراج (= الإصدار الجاري) ولا يتغيّر بعدها.
--     النتيجة تصل لإصدارها عبر attempt_id (فلا عمود مكرّر في game_results).
--     submit_game_attempt تُعاد تعريفها هنا: تصحّح بحلّ إصدار المحاولة (game_challenge_version_solutions) وتحتسب نقاط ذلك الإصدار،
--     وللمحاولة بلا إصدار (قديمة) تستعمل game_challenge_solutions كما كانت. باقي منطقها حرفيًا كما في 0050.
--   * التحديات القديمة: بلا إصدار (current_version_id = null) وتعمل كما هي. عند أول نشر إصدار لتحدٍّ له محاولات تُؤخذ لقطة «إصدار 0»
--     مؤرشفة من حالته القديمة وتُربط بها محاولاته (ومنها الجارية، فتُصحَّح بحلّها القديم لا بحلّ الإصدار الجديد).
--   * المنح اليدوي: unlock لفئة manual فقط، complete لمرحلة manual فقط، وتحقّق من سلسلة لعبة/مسار/فئة/مرحلة؛ ولا يُغيَّر وضع بقي له منح.
--   * مشغّل game_attempts: يرفض تحدٍّ في مرحلة/فئة/مسار غير منشور. الفتح التسلسلي/اليدوي غير مُنفَّذ بعد (6.2):
--     التحدي في فئة غير free يُرفض بـ stage_lock_not_enforced (fail closed) حتى تُنفَّذ دوال الاشتقاق.
--
-- يعيد تعريف (create or replace) ثلاث دوال قائمة فقط: submit_game_attempt وadmin_delete_game_challenge وadmin_delete_game؛
--   الأخيرتان تؤرشفان بدل الحذف إن وُجد إصدار منشور/مؤرشف. لا يمسّ start_game_attempt ولا أي migration سابقة. لا بيانات أولية.
-- يتطلب: 0050 و0052. آمن لإعادة التشغيل. الرجوع: supabase/rollback/0055_games_learning_paths_down.sql (⚠️ يحذف الهيكل والإصدارات).
-- ⚠️ تجربة جافة أولًا: استبدل `commit;` الأخيرة بـ `rollback;` ثم شغّل الملف، وإن نجح أعدها `commit;`.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.game_challenge_solutions') is null or to_regclass('public.game_attempts') is null then
    raise exception 'شغّل 0050_games_core.sql أولاً';
  end if;
  if to_regprocedure('public.game_admin_audit()') is null or to_regprocedure('public.game_challenges_guard()') is null
     or to_regprocedure('public.can_manage_games()') is null then
    raise exception 'شغّل 0052_games_admin.sql أولاً';
  end if;
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'شغّل 0004_functions_and_triggers.sql أولاً';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) الهيكل: المسارات ← الفئات ← المراحل (النصوص jsonb متعدد اللغات كبقية الوحدة)
-- ---------------------------------------------------------------------
create table if not exists public.game_tracks (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games(id) on delete cascade,
  slug        text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 64),
  title       jsonb not null check (jsonb_typeof(title) = 'object' and title <> '{}'::jsonb),
  description jsonb check (description is null or jsonb_typeof(description) = 'object'),
  status      text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (game_id, slug),
  unique (game_id, id)
);

create table if not exists public.game_track_categories (
  id                uuid primary key default gen_random_uuid(),
  game_id           uuid not null,
  track_id          uuid not null,
  slug              text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 64),
  title             jsonb not null check (jsonb_typeof(title) = 'object' and title <> '{}'::jsonb),
  description       jsonb check (description is null or jsonb_typeof(description) = 'object'),
  status            text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  sort_order        integer not null default 0,
  -- سياسة فتح مراحل هذه الفئة (الترتيب بـ sort_order): sequential = السابقة مكتملة · free = الكل مفتوح · manual = بمنح إداري
  stage_unlock_mode text not null default 'sequential' check (stage_unlock_mode in ('sequential', 'free', 'manual')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (track_id, slug),
  unique (game_id, id),
  foreign key (game_id, track_id) references public.game_tracks (game_id, id) on delete cascade
);

create table if not exists public.game_stages (
  id                   uuid primary key default gen_random_uuid(),
  game_id              uuid not null,
  category_id          uuid not null,
  slug                 text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 64),
  title                jsonb not null check (jsonb_typeof(title) = 'object' and title <> '{}'::jsonb),
  description          jsonb check (description is null or jsonb_typeof(description) = 'object'),
  status               text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  sort_order           integer not null default 0,
  -- شرط الإكمال: all_required (كل التحديات الإلزامية) · min_success_rate (threshold = % نجاح 1..100)
  --               · min_points (threshold = نقاط دنيا) · manual (اعتماد إداري عبر game_stage_grants)
  completion_mode      text not null default 'all_required'
                         check (completion_mode in ('all_required', 'min_success_rate', 'min_points', 'manual')),
  completion_threshold integer,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (category_id, slug),
  unique (game_id, id),
  foreign key (game_id, category_id) references public.game_track_categories (game_id, id) on delete cascade,
  check (
    (completion_mode in ('all_required', 'manual') and completion_threshold is null)
    or (completion_mode = 'min_success_rate' and completion_threshold is not null and completion_threshold between 1 and 100)
    or (completion_mode = 'min_points' and completion_threshold is not null and completion_threshold between 1 and 1000000)
  )
);

-- ---------------------------------------------------------------------
-- 2) إصدارات التحدي وحلولها
--    title/description: مفاتيح ar/fr/en فقط. default_language يجب أن يوجد في title (fallback: المطلوبة ← الافتراضية
--    إن كان allow_language_fallback، وإلا لا يُعرض بغير لغاته). نصوص content الداخلية تبقى inline {ar,fr,en} كالعقد الحالي.
-- ---------------------------------------------------------------------
create table if not exists public.game_challenge_versions (
  id                     uuid primary key default gen_random_uuid(),
  challenge_id           uuid not null references public.game_challenges(id) on delete cascade,
  version_no             integer not null check (version_no >= 0),   -- يُرقَّم بمشغّل؛ 0 = لقطة التحدي القديم
  status                 text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  default_language       text not null default 'ar' check (default_language in ('ar', 'fr', 'en')),
  allow_language_fallback boolean not null default true,
  title                  jsonb not null check (jsonb_typeof(title) = 'object' and title <> '{}'::jsonb
                                               and (title - 'ar' - 'fr' - 'en') = '{}'::jsonb),
  description            jsonb check (description is null or (jsonb_typeof(description) = 'object'
                                                              and (description - 'ar' - 'fr' - 'en') = '{}'::jsonb)),
  difficulty             smallint not null default 1 check (difficulty between 1 and 5),
  points_reward          integer not null default 10 check (points_reward between 0 and 10000),
  time_limit_seconds     integer check (time_limit_seconds is null or time_limit_seconds between 5 and 86400),
  max_attempts           integer check (max_attempts is null or max_attempts between 1 and 1000),
  content                jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  change_note            text check (change_note is null or char_length(change_note) <= 500),
  created_by             uuid default auth.uid() references auth.users(id) on delete set null,
  created_at             timestamptz not null default now(),
  published_at           timestamptz,
  updated_at             timestamptz not null default now(),
  unique (challenge_id, version_no),
  unique (challenge_id, id),
  check (title ? default_language)
);
-- إصدار منشور واحد على الأكثر لكل تحدٍّ
create unique index if not exists uq_game_challenge_one_published_version
  on public.game_challenge_versions (challenge_id) where status = 'published';

create table if not exists public.game_challenge_version_solutions (
  version_id  uuid primary key references public.game_challenge_versions(id) on delete cascade,
  verify_mode text not null default 'exact' check (verify_mode in ('exact', 'external')),
  solution    jsonb not null check (octet_length(solution::text) <= 20000),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3) المنح اليدوي: فتح مرحلة (unlock، لفئات stage_unlock_mode = 'manual' فقط) أو اعتماد إكمالها (complete، لمراحل completion_mode = 'manual' فقط)
-- ---------------------------------------------------------------------
create table if not exists public.game_stage_grants (
  id         uuid primary key default gen_random_uuid(),
  stage_id   uuid not null references public.game_stages(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('unlock', 'complete')),
  note       text check (note is null or char_length(note) <= 500),
  granted_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (stage_id, user_id, kind)
);
create index if not exists idx_game_stage_grants_user on public.game_stage_grants (user_id);

-- ---------------------------------------------------------------------
-- 4) ربط الجداول القائمة (أعمدة اختيارية؛ الصفوف الحالية لا تتغيّر)
-- ---------------------------------------------------------------------
alter table public.game_challenges
  add column if not exists stage_id           uuid,
  add column if not exists is_required        boolean not null default true,
  add column if not exists current_version_id uuid;
alter table public.game_attempts
  add column if not exists challenge_version_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_game_challenges_stage' and conrelid = 'public.game_challenges'::regclass) then
    alter table public.game_challenges add constraint fk_game_challenges_stage
      foreign key (game_id, stage_id) references public.game_stages (game_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_game_challenges_current_version' and conrelid = 'public.game_challenges'::regclass) then
    alter table public.game_challenges add constraint fk_game_challenges_current_version
      foreign key (id, current_version_id) references public.game_challenge_versions (challenge_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_game_attempts_version' and conrelid = 'public.game_attempts'::regclass) then
    alter table public.game_attempts add constraint fk_game_attempts_version
      foreign key (challenge_id, challenge_version_id) references public.game_challenge_versions (challenge_id, id);
  end if;
end $$;

create index if not exists idx_game_challenges_stage on public.game_challenges (stage_id, sort_order) where stage_id is not null;
create index if not exists idx_game_attempts_version on public.game_attempts (challenge_version_id) where challenge_version_id is not null;

-- ---------------------------------------------------------------------
-- 5) مشغّلات: updated_at + حماية الإصدارات + إسقاط الإصدار + ربط المحاولات + المنح
--    iae.games_publish = متغيّر معاملة محلي تضبطه admin_publish_game_challenge_version وحدها (العميل لا يستطيع ضبطه).
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['game_tracks', 'game_track_categories', 'game_stages', 'game_challenge_versions', 'game_challenge_version_solutions']
  loop
    execute format('drop trigger if exists trg_set_updated_at on public.%I;
                    create trigger trg_set_updated_at before update on public.%I
                    for each row execute function public.set_updated_at();', t, t);
  end loop;
end $$;

-- 5.1) الإصدار: ترقيم تلقائي، الحالة تتغيّر بالنشر فقط (draft→published→archived)، وغير المسودّة لا يُعدَّل محتواه ولا يُحذف
create or replace function public.game_challenge_versions_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_pub boolean := coalesce(current_setting('iae.games_publish', true), '') = '1';
begin
  if tg_op = 'DELETE' then
    -- لا يتجاوزها DELETE مباشر ولا CASCADE (حذف تحدٍّ/لعبة يمرّ من هنا): المسودّة غير المستعملة فقط
    if old.status <> 'draft' then
      raise exception 'version_locked';
    end if;
    if exists (select 1 from public.game_attempts a where a.challenge_version_id = old.id) then
      raise exception 'version_in_use';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' and not v_pub then
      raise exception 'version_status_locked';
    end if;
    if not v_pub then
      perform 1 from public.game_challenges where id = new.challenge_id for update;  -- يسلسل الترقيم
      new.version_no := coalesce((select max(v.version_no) from public.game_challenge_versions v where v.challenge_id = new.challenge_id), 0) + 1;
      new.published_at := null;
    end if;
    return new;
  end if;

  if new.challenge_id is distinct from old.challenge_id or new.version_no is distinct from old.version_no then
    raise exception 'version_locked';
  end if;
  if new.status is distinct from old.status then
    if not v_pub then
      raise exception 'version_status_locked';
    end if;
    if not ((old.status = 'draft' and new.status = 'published') or (old.status = 'published' and new.status = 'archived')) then
      raise exception 'invalid_version_transition';
    end if;
  end if;
  if old.status <> 'draft'
     and (to_jsonb(new) - 'status' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
    raise exception 'version_locked';
  end if;
  return new;
end;
$$;

-- 5.2) حلّ الإصدار: لا يُعدَّل ولا يُحذف إلا لمسودّة (الاستثناء الوحيد: إدراج لقطة النشر)
create or replace function public.game_challenge_version_solutions_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if tg_op <> 'DELETE' and coalesce(current_setting('iae.games_publish', true), '') = '1' then
    return new;   -- لقطة النشر فقط (إدراج حلّ الإصدار 0)؛ الحذف لا يُستثنى أبدًا
  end if;
  if tg_op = 'UPDATE' and new.version_id is distinct from old.version_id then
    raise exception 'version_locked';
  end if;
  select v.status into v_status from public.game_challenge_versions v
   where v.id = case when tg_op = 'DELETE' then old.version_id else new.version_id end;
  if found and v_status <> 'draft' then
    raise exception 'version_locked';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- 5.3) التحدي ذو الإصدار: حقول الإسقاط (العنوان/الوصف/الصعوبة/النقاط/المهلة/المحاولات/المحتوى) ومؤشّر الإصدار الجاري
--      لا تتغيّر إلا بالنشر؛ وإلا انفصل التحدي الحيّ عن إصداره. (slug/status/الجدولة/الترتيب/المرحلة تبقى حرّة.)
create or replace function public.game_challenges_version_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('iae.games_publish', true), '') = '1' then
    return new;
  end if;
  if new.current_version_id is distinct from old.current_version_id then
    raise exception 'version_pointer_locked';
  end if;
  if old.current_version_id is not null
     and (new.title, new.description, new.difficulty, new.points_reward, new.time_limit_seconds, new.max_attempts, new.content)
         is distinct from
         (old.title, old.description, old.difficulty, old.points_reward, old.time_limit_seconds, old.max_attempts, old.content) then
    raise exception 'challenge_versioned';
  end if;
  return new;
end;
$$;

-- 5.4) الحلّ الحيّ القديم: لتحدٍّ ذي إصدار يُكتب بالنشر فقط ولا يُحذف أبدًا (admin_save_game_challenge لا ينسفه). حذف تحدٍّ بلا إصدار منشور/مؤرشف (فيُحذف حلّه بالتتالي) يبقى ممكنًا
create or replace function public.game_challenge_solutions_version_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- إدراج/تعديل: يُستثنى النشر فقط (الإسقاط الحيّ). الحذف لا يُستثنى أبدًا.
  if tg_op <> 'DELETE' and coalesce(current_setting('iae.games_publish', true), '') = '1' then
    return new;
  end if;
  if exists (select 1 from public.game_challenges c
              where c.id = case when tg_op = 'DELETE' then old.challenge_id else new.challenge_id end
                and c.current_version_id is not null) then
    raise exception 'challenge_versioned';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- 5.5) المحاولات: عند البدء يُثبَّت الإصدار الجاري (null للتحدي القديم) ولا يتغيّر؛ ويُرفض تحدٍّ في مرحلة غير منشورة.
--      SECURITY DEFINER كي لا يتأثر بـ RLS. الفتح التسلسلي/اليدوي: fail closed حتى 6.2.
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

-- 5.6) المنح: unlock لفئة manual فقط، وcomplete لمرحلة manual فقط، مع تحقق من السلسلة + تدقيق (من، لمن، أي مرحلة)
create or replace function public.game_stage_grants_validate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_unlock   text;
  v_complete text;
begin
  -- سلسلة متّسقة: مرحلة ← فئة ← مسار ← لعبة بالمعرّف نفسه (تكرّر المفاتيح المركّبة، وهنا فحص صريح)
  select tc.stage_unlock_mode, s.completion_mode into v_unlock, v_complete
    from public.game_stages s
    join public.game_track_categories tc on tc.id = s.category_id and tc.game_id = s.game_id
    join public.game_tracks t on t.id = tc.track_id and t.game_id = tc.game_id
    join public.games g on g.id = t.game_id
   where s.id = new.stage_id;
  if not found then
    raise exception 'stage_chain_invalid';
  end if;
  if new.kind = 'unlock' and v_unlock <> 'manual' then
    raise exception 'stage_unlock_not_manual';
  end if;
  if new.kind = 'complete' and v_complete <> 'manual' then
    raise exception 'stage_not_manual';
  end if;
  return new;
end;
$$;

-- لا يُخرَج وضع manual (فتحًا أو إكمالًا) ولا تُنقل مرحلة بين فئات وبقي لها منح؛ تُحذف المنح أولًا
create or replace function public.game_stage_mode_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'game_stages' then
    if (new.completion_mode is distinct from old.completion_mode and new.completion_mode <> 'manual'
        and exists (select 1 from public.game_stage_grants gr where gr.stage_id = old.id and gr.kind = 'complete'))
       or (new.category_id is distinct from old.category_id
           and exists (select 1 from public.game_stage_grants gr where gr.stage_id = old.id)) then
      raise exception 'stage_has_grants';
    end if;
  elsif new.stage_unlock_mode is distinct from old.stage_unlock_mode and new.stage_unlock_mode <> 'manual'
        and exists (select 1 from public.game_stage_grants gr join public.game_stages s on s.id = gr.stage_id
                     where s.category_id = old.id and gr.kind = 'unlock') then
    raise exception 'stage_has_grants';
  end if;
  return new;
end;
$$;

create or replace function public.game_stage_grants_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  j jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, metadata)
  values (auth.uid(), case when tg_op = 'INSERT' then 'game_stage_grant_created' else 'game_stage_grant_deleted' end,
          'game_stage_grants', (j ->> 'id')::uuid, 'إدارة الألعاب',
          jsonb_build_object('stage_id', j ->> 'stage_id', 'target_user', j ->> 'user_id', 'kind', j ->> 'kind'));
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.game_challenge_versions_guard()          from public, anon, authenticated;
revoke all on function public.game_challenge_version_solutions_guard() from public, anon, authenticated;
revoke all on function public.game_challenges_version_guard()          from public, anon, authenticated;
revoke all on function public.game_challenge_solutions_version_guard() from public, anon, authenticated;
revoke all on function public.game_attempts_bind()                     from public, anon, authenticated;
revoke all on function public.game_stage_grants_validate()             from public, anon, authenticated;
revoke all on function public.game_stage_mode_guard()                  from public, anon, authenticated;
revoke all on function public.game_stage_grants_audit()                from public, anon, authenticated;

drop trigger if exists trg_game_challenge_versions_guard on public.game_challenge_versions;
create trigger trg_game_challenge_versions_guard before insert or update or delete on public.game_challenge_versions
  for each row execute function public.game_challenge_versions_guard();

drop trigger if exists trg_game_challenge_version_solutions_guard on public.game_challenge_version_solutions;
create trigger trg_game_challenge_version_solutions_guard before insert or update or delete on public.game_challenge_version_solutions
  for each row execute function public.game_challenge_version_solutions_guard();

drop trigger if exists trg_game_challenges_version_guard on public.game_challenges;
create trigger trg_game_challenges_version_guard before update on public.game_challenges
  for each row execute function public.game_challenges_version_guard();

drop trigger if exists trg_game_challenge_solutions_version_guard on public.game_challenge_solutions;
create trigger trg_game_challenge_solutions_version_guard before insert or update or delete on public.game_challenge_solutions
  for each row execute function public.game_challenge_solutions_version_guard();

drop trigger if exists trg_game_attempts_bind_insert on public.game_attempts;
create trigger trg_game_attempts_bind_insert before insert on public.game_attempts
  for each row execute function public.game_attempts_bind();
drop trigger if exists trg_game_attempts_bind_update on public.game_attempts;
create trigger trg_game_attempts_bind_update before update of challenge_version_id on public.game_attempts
  for each row execute function public.game_attempts_bind();

drop trigger if exists trg_game_stage_grants_validate on public.game_stage_grants;
create trigger trg_game_stage_grants_validate before insert or update of stage_id, user_id, kind on public.game_stage_grants
  for each row execute function public.game_stage_grants_validate();
drop trigger if exists trg_game_stages_mode_guard on public.game_stages;
create trigger trg_game_stages_mode_guard before update of completion_mode, category_id on public.game_stages
  for each row execute function public.game_stage_mode_guard();
drop trigger if exists trg_game_track_categories_mode_guard on public.game_track_categories;
create trigger trg_game_track_categories_mode_guard before update of stage_unlock_mode on public.game_track_categories
  for each row execute function public.game_stage_mode_guard();
drop trigger if exists trg_game_stage_grants_audit on public.game_stage_grants;
create trigger trg_game_stage_grants_audit after insert or delete on public.game_stage_grants
  for each row execute function public.game_stage_grants_audit();

-- تدقيق إداري موحّد (دالة 0052: لا تسجّل محتوى ولا حلولًا)
do $$
declare t text;
begin
  foreach t in array array['game_tracks', 'game_track_categories', 'game_stages', 'game_challenge_versions']
  loop
    execute format('drop trigger if exists trg_game_admin_audit on public.%I;
                    create trigger trg_game_admin_audit after insert or update or delete on public.%I
                    for each row execute function public.game_admin_audit();', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6) RPC: نشر إصدار (ذرّي). الوحيدة التي تغيّر حالة الإصدار وتُسقطه على التحدي الحيّ.
--    1) تتحقق: عنوان اللغة الافتراضية + حلّ exact.  2) لتحدٍّ قديم له محاولات: لقطة «إصدار 0» مؤرشفة وربط محاولاته بها.
--    3) لا تمسّ المحاولات الجارية ولا تُنهيها: تكمل على إصدارها (submit_game_attempt تصحّح بحلّ إصدار المحاولة).
--    4) تؤرشف المنشور السابق وتنشر الجديد وتُسقطه على game_challenges وgame_challenge_solutions.
-- ---------------------------------------------------------------------
create or replace function public.admin_publish_game_challenge_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v         public.game_challenge_versions%rowtype;
  c         public.game_challenges%rowtype;
  s         public.game_challenge_version_solutions%rowtype;
  b         uuid;
  v_lang    text;
  v_title   jsonb;
  v_desc    jsonb;
begin
  if auth.uid() is null or not public.can_manage_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;

  select * into v from public.game_challenge_versions where id = p_version_id for update;
  if not found then
    raise exception 'version_not_found';
  end if;
  if v.status <> 'draft' then
    raise exception 'version_not_draft';
  end if;
  select * into c from public.game_challenges where id = v.challenge_id for update;

  if jsonb_typeof(v.title -> v.default_language) is distinct from 'string' or btrim(v.title ->> v.default_language) = '' then
    raise exception 'translation_required';
  end if;
  select * into s from public.game_challenge_version_solutions where version_id = v.id;
  if not found or s.verify_mode <> 'exact' then
    raise exception 'solution_required';
  end if;

  perform set_config('iae.games_publish', '1', true);

  if c.current_version_id is null and exists (select 1 from public.game_attempts a where a.challenge_id = c.id) then
    select jsonb_object_agg(k, c.title -> k) into v_title
      from unnest(array['ar', 'fr', 'en']) k where jsonb_typeof(c.title -> k) = 'string';
    select jsonb_object_agg(k, c.description -> k) into v_desc
      from unnest(array['ar', 'fr', 'en']) k where jsonb_typeof(c.description -> k) = 'string';
    if v_title is null then
      raise exception 'legacy_title_unsupported';
    end if;
    select k into v_lang from unnest(array['ar', 'fr', 'en']) k where v_title ? k limit 1;

    insert into public.game_challenge_versions (challenge_id, version_no, status, default_language, title, description,
                                                difficulty, points_reward, time_limit_seconds, max_attempts, content,
                                                change_note, created_by)
    values (c.id, 0, 'archived', v_lang, v_title, v_desc, c.difficulty, c.points_reward, c.time_limit_seconds,
            c.max_attempts, c.content, 'legacy baseline', null)
    returning id into b;

    insert into public.game_challenge_version_solutions (version_id, verify_mode, solution)
    select b, gs.verify_mode, gs.solution from public.game_challenge_solutions gs where gs.challenge_id = c.id;

    update public.game_attempts set challenge_version_id = b
     where challenge_id = c.id and challenge_version_id is null;
  end if;

  update public.game_challenge_versions set status = 'archived' where challenge_id = c.id and status = 'published';
  update public.game_challenge_versions set status = 'published', published_at = now() where id = v.id;

  update public.game_challenges set
    current_version_id = v.id, title = v.title, description = v.description, difficulty = v.difficulty,
    points_reward = v.points_reward, time_limit_seconds = v.time_limit_seconds, max_attempts = v.max_attempts,
    content = v.content
   where id = c.id;

  insert into public.game_challenge_solutions (challenge_id, verify_mode, solution)
  values (c.id, s.verify_mode, s.solution)
  on conflict (challenge_id) do update set verify_mode = excluded.verify_mode, solution = excluded.solution;

  perform set_config('iae.games_publish', '', true);
  return jsonb_build_object('version_id', v.id, 'challenge_id', c.id, 'version_no', v.version_no);
end;
$$;

revoke all on function public.admin_publish_game_challenge_version(uuid) from public, anon, authenticated;
grant execute on function public.admin_publish_game_challenge_version(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6.1) إعادة تعريف دوال قائمة (create or replace: الصلاحيات الممنوحة في 0050/0052 تبقى كما هي)
--   submit_game_attempt: 0050 حرفيًا عدا اختيار الحلّ والنقاط من إصدار المحاولة (انظر التعليق داخلها).
--   admin_delete_game_challenge / admin_delete_game: 0052 حرفيًا عدا أن وجود إصدار منشور/مؤرشف يعني أرشفة بدل حذف.
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
     or exists (select 1 from public.game_points where challenge_id = p_id)
     or exists (select 1 from public.game_challenge_versions v where v.challenge_id = p_id and v.status <> 'draft') then
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
                     or exists (select 1 from public.game_points pt where pt.challenge_id = c.id)
                     or exists (select 1 from public.game_challenge_versions v where v.challenge_id = c.id and v.status <> 'draft'))) then
    update public.game_challenges set status = 'archived' where game_id = p_id and status <> 'archived';
    update public.games set status = 'archived' where id = p_id;
    return jsonb_build_object('result', 'archived');
  end if;
  -- لا بيانات تاريخية: تُحذف التحديات أولًا (مسوّداتها وحلولها بالتتالي) ثم اللعبة، فتُحذف مراحلها وفئاتها ومساراتها
  -- بلا تحديات. ترتيب صريح بدل الاعتماد على ترتيب تتالي المفاتيح الأجنبية (stage_id بـ NO ACTION يبقى يحمي حذف المرحلة المباشر).
  delete from public.game_challenges where game_id = p_id;
  delete from public.games where id = p_id;
  return jsonb_build_object('result', 'deleted');
end;
$$;

-- ---------------------------------------------------------------------
-- 7) الصلاحيات وRLS (الأصل: الرفض؛ anon لا يملك شيئًا)
--    اللاعب: المنشور فقط بسلسلة كاملة (لعبة منشورة ← مسار ← فئة ← مرحلة). RLS المتداخل يطبّق سياسة الأب تلقائيًا.
--    الحلول: لا سياسة للاعب. الكتابة على الهيكل والإصدارات: can_manage_games() (super_admin/developer).
-- ---------------------------------------------------------------------
alter table public.game_tracks                    enable row level security;
alter table public.game_track_categories          enable row level security;
alter table public.game_stages                    enable row level security;
alter table public.game_challenge_versions        enable row level security;
alter table public.game_challenge_version_solutions enable row level security;
alter table public.game_stage_grants              enable row level security;

revoke all on table public.game_tracks, public.game_track_categories, public.game_stages, public.game_challenge_versions,
                    public.game_challenge_version_solutions, public.game_stage_grants
  from public, anon, authenticated;
grant select, insert, update, delete on public.game_tracks, public.game_track_categories, public.game_stages,
                                        public.game_challenge_versions, public.game_challenge_version_solutions
  to authenticated;
grant select, insert, delete on public.game_stage_grants to authenticated;

drop policy if exists game_tracks_select on public.game_tracks;
create policy game_tracks_select on public.game_tracks for select to authenticated
  using (
    (select public.can_access_games())
    and (
      (select public.can_manage_games())
      or (status = 'published'
          and exists (select 1 from public.games g join public.game_categories gc on gc.id = g.category_id
                       where g.id = game_tracks.game_id and g.status = 'published' and gc.is_active))
    )
  );
drop policy if exists game_tracks_manage on public.game_tracks;
create policy game_tracks_manage on public.game_tracks for all to authenticated
  using ((select public.can_manage_games())) with check ((select public.can_manage_games()));

drop policy if exists game_track_categories_select on public.game_track_categories;
create policy game_track_categories_select on public.game_track_categories for select to authenticated
  using (
    (select public.can_access_games())
    and (
      (select public.can_manage_games())
      or (status = 'published'
          and exists (select 1 from public.game_tracks t where t.id = game_track_categories.track_id))
    )
  );
drop policy if exists game_track_categories_manage on public.game_track_categories;
create policy game_track_categories_manage on public.game_track_categories for all to authenticated
  using ((select public.can_manage_games())) with check ((select public.can_manage_games()));

drop policy if exists game_stages_select on public.game_stages;
create policy game_stages_select on public.game_stages for select to authenticated
  using (
    (select public.can_access_games())
    and (
      (select public.can_manage_games())
      or (status = 'published'
          and exists (select 1 from public.game_track_categories tc where tc.id = game_stages.category_id))
    )
  );
drop policy if exists game_stages_manage on public.game_stages;
create policy game_stages_manage on public.game_stages for all to authenticated
  using ((select public.can_manage_games())) with check ((select public.can_manage_games()));

-- الإصدار: اللاعب يرى الإصدار الجاري المنشور لتحدٍّ يراه (سياسة game_challenges تُطبَّق في الاستعلام الفرعي)
drop policy if exists game_challenge_versions_select on public.game_challenge_versions;
create policy game_challenge_versions_select on public.game_challenge_versions for select to authenticated
  using (
    (select public.can_access_games())
    and (
      (select public.can_manage_games())
      or (status = 'published'
          and exists (select 1 from public.game_challenges c
                       where c.id = game_challenge_versions.challenge_id and c.current_version_id = game_challenge_versions.id))
    )
  );
drop policy if exists game_challenge_versions_manage on public.game_challenge_versions;
create policy game_challenge_versions_manage on public.game_challenge_versions for all to authenticated
  using ((select public.can_manage_games())) with check ((select public.can_manage_games()));

drop policy if exists game_challenge_version_solutions_manage on public.game_challenge_version_solutions;
create policy game_challenge_version_solutions_manage on public.game_challenge_version_solutions for all to authenticated
  using ((select public.can_manage_games())) with check ((select public.can_manage_games()));

drop policy if exists game_stage_grants_select_own on public.game_stage_grants;
create policy game_stage_grants_select_own on public.game_stage_grants for select to authenticated
  using (user_id = (select auth.uid()) and (select public.can_access_games()));
drop policy if exists game_stage_grants_manage on public.game_stage_grants;
create policy game_stage_grants_manage on public.game_stage_grants for all to authenticated
  using ((select public.can_manage_games()))
  with check ((select public.can_manage_games()) and granted_by = (select auth.uid()));

-- التحدي داخل مرحلة لا يظهر للاعب ما لم تكن المرحلة (وفئتها ومسارها) منشورة. باقي الشروط كما في 0050 حرفيًا.
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
                       where g.id = game_challenges.game_id and g.status = 'published' and gc.is_active)
          and (stage_id is null
               or exists (select 1 from public.game_stages s where s.id = game_challenges.stage_id)))
    )
  );

notify pgrst, 'reload schema';

commit;
