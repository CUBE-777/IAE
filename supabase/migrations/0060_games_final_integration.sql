-- ============================================================
-- 0060_games_final_integration.sql — المراجعة النهائية لوحدة IAE Games — المرحلة 6.6: سدّ ثغرتين في حراسة Versioning (0055)
--
-- يبني على 0050 و0052 و0055 و0057 (مطبّقة ولا تُعدَّل). تعريفات دوال وحراسات فقط: لا جداول، ولا أعمدة، ولا سياسات RLS، ولا منح، ولا بيانات.
--
-- المشكلة 1 — تحدٍّ «قديم» بلا إصدارات (current_version_id is null) وله محاولات يمكن تعديل محتواه وحلّه الحيّين في مكانهما:
--   حراسات 0055 (game_challenges_version_guard وgame_challenge_solutions_version_guard) تمنع التعديل الحيّ فقط حين يوجد current_version_id.
--   فالمحرر القديم (admin_save_game_challenge، أو تحديث مباشر من مدير) يستطيع تغيير content/الحلّ/النقاط لتحدٍّ قديم أثناء وجود محاولات جارية
--   لا تحمل challenge_version_id (null)، فتُعرض وتُصحَّح بالمحتوى والحلّ الجديدين: يتغيّر ما رآه اللاعب أو يُصحَّح خلافه، وتُعاد كتابة معنى النتائج التاريخية.
--   الإصلاح: لا تعديل حيّ لحقول المحتوى/الحلّ في تحدٍّ له أي محاولة (حتى بلا إصدارات). التعديل يتم بالمحرر (مسودّة ← نشر)؛ والنشر الأول
--   لتحدٍّ قديم له محاولات يُنشئ أصلًا «الإصدار 0» المؤرشف ويربط محاولاته به (admin_publish_game_challenge_version، 0055)، فتبقى كل محاولة على محتواها.
--   تحدٍّ بلا محاولات (مسودّة/جديد) يبقى قابلًا للتعديل الحيّ كما كان. النشر نفسه مستثنى عبر iae.games_publish كما في 0055.
--   رمز الخطأ: challenge_has_attempts (جديد؛ تحدٍّ ذو إصدارات يبقى challenge_versioned كما كان).
--
-- المشكلة 2 — منع مفاتيح الحلول (answer/solution/correct*/expected*) في content العلني كان في واجهة الإدارة فقط (CONTENT_FORBIDDEN_KEY):
--   المحرر القديم يرسل content بلا أي فحص خادمي فيصل لـ game_challenges ثم للاعبين عبر الكتالوج. الإصدارات (المحرر الجديد) محمية أصلًا بقائمة
--   بيضاء في game_builder_validate. الإصلاح: مشغّل على game_challenges يرفض content فيه مفتاح ممنوع (نفس نمط game_builder_has_forbidden_key)
--   عند الإدراج أو عند تغيير content فقط، فلا يمسّ صفوفًا قائمة لم يتغيّر محتواها. يُستثنى إسقاط النشر (محتواه مُتحقَّق منه بالقائمة البيضاء). رمز: content_has_answer.
--
-- لا يغيّر: submit_game_attempt / start_game_attempt / دوال القراءة (0059) / صلاحيات الإدارة. الواجهة تتعامل مع الرمزين الجديد/القائم عبر الترجمات.
-- يتطلب: 0050 و0055 و0057. آمن لإعادة التشغيل. الرجوع: supabase/rollback/0060_games_final_integration_down.sql
-- ⚠️ تجربة جافة أولًا: استبدل `commit;` الأخيرة بـ `rollback;` ثم شغّل الملف، وإن نجح أعدها `commit;`.
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public.game_challenges_version_guard()') is null
     or to_regprocedure('public.game_challenge_solutions_version_guard()') is null then
    raise exception 'شغّل 0055_games_learning_paths.sql أولاً';
  end if;
  if to_regprocedure('public.game_builder_has_forbidden_key(jsonb)') is null then
    raise exception 'شغّل 0057_games_challenge_builder.sql أولاً';
  end if;
  if to_regclass('public.game_attempts') is null then
    raise exception 'شغّل 0050_games_core.sql أولاً';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) حراسة حقول الإسقاط على التحدي الحيّ: تشمل الآن التحدي القديم الذي له محاولات (0055 §5.3 + شرط المحاولات)
--    مؤشّر الإصدار الجاري لا يتغيّر إلا بالنشر (كما كان). الحقول: title, description, difficulty, points_reward, time_limit_seconds, max_attempts, content.
--    slug/status/الجدولة/الترتيب/المرحلة تبقى حرّة (لا تؤثر على محتوى محاولة بدأت).
-- ---------------------------------------------------------------------
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
  if (new.title, new.description, new.difficulty, new.points_reward, new.time_limit_seconds, new.max_attempts, new.content)
     is distinct from
     (old.title, old.description, old.difficulty, old.points_reward, old.time_limit_seconds, old.max_attempts, old.content) then
    if old.current_version_id is not null then
      raise exception 'challenge_versioned';
    end if;
    if exists (select 1 from public.game_attempts a where a.challenge_id = old.id) then
      raise exception 'challenge_has_attempts';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 2) حراسة الحلّ الحيّ القديم: لا إدراج/تعديل/حذف إلا لتحدٍّ بلا إصدار وبلا محاولات (0055 §5.4 + شرط المحاولات). النشر وحده مستثنى (ماعدا الحذف).
--    حذف تحدٍّ بلا محاولات (تتالي الحذف) يبقى ممكنًا. أثناء التتالي لا يبقى صفّ التحدي فلا يلزم فحصه.
-- ---------------------------------------------------------------------
create or replace function public.game_challenge_solutions_version_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_chal uuid := case when tg_op = 'DELETE' then old.challenge_id else new.challenge_id end;
begin
  -- إدراج/تعديل: يُستثنى النشر فقط (الإسقاط الحيّ). الحذف لا يُستثنى أبدًا.
  if tg_op <> 'DELETE' and coalesce(current_setting('iae.games_publish', true), '') = '1' then
    return new;
  end if;
  if exists (select 1 from public.game_challenges c where c.id = v_chal and c.current_version_id is not null) then
    raise exception 'challenge_versioned';
  end if;
  if exists (select 1 from public.game_attempts a where a.challenge_id = v_chal) then
    raise exception 'challenge_has_attempts';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) منع مفاتيح الحلول في content العلني على الخادم (لا اعتماد على فحص الواجهة وحده)
-- ---------------------------------------------------------------------
create or replace function public.game_challenges_content_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('iae.games_publish', true), '') = '1' then
    return new;   -- إسقاط إصدار منشور: محتواه مُتحقَّق منه أصلًا بالقائمة البيضاء (game_builder_validate)
  end if;
  if (tg_op = 'INSERT' or new.content is distinct from old.content)
     and public.game_builder_has_forbidden_key(new.content) then
    raise exception 'content_has_answer';
  end if;
  return new;
end;
$$;

revoke all on function public.game_challenges_version_guard()          from public, anon, authenticated;
revoke all on function public.game_challenge_solutions_version_guard() from public, anon, authenticated;
revoke all on function public.game_challenges_content_guard()          from public, anon, authenticated;

drop trigger if exists trg_game_challenges_content_guard on public.game_challenges;
create trigger trg_game_challenges_content_guard before insert or update of content on public.game_challenges
  for each row execute function public.game_challenges_content_guard();

notify pgrst, 'reload schema';

commit;
