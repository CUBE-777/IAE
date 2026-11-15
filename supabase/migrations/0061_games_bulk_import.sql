-- ============================================================
-- 0061_games_bulk_import.sql — Bulk Challenge Import (استيراد تحديات دفعة واحدة كمسودّات)
--
-- يبني على 0050 و0055–0057 و0060. لا يعدّل أي migration سابقة، ولا يغيّر Versioning ولا Learning Paths ولا الصلاحيات.
--   1) عمود game_challenges.import_key (اختياري) + فهرس فريد جزئي: هو الآلية الموثوقة لمنع التكرار عند إعادة رفع الملف نفسه.
--      المفتاح = «معرّف الاستيراد:المعرّف الخارجي» (import_id من الملف + external_id للتحدي). لا اعتماد على العنوان.
--   2) RPC واحدة admin_import_game_challenges(p_import_id, p_items, p_dry_run):
--      - SECURITY DEFINER + can_manage_games() (super_admin/developer) داخل الخادم؛ لا Service Role في الواجهة، ولا كتابة مباشرة في الجداول المحمية.
--      - لا تثق بتحقق الواجهة: تعيد فحص كل عنصر (المرحلة، التطابق مع اللعبة، الـ slug، الحدود، النصوص، و game_builder_validate بالوضع الصارم = شروط النشر).
--      - تمريرتان: (أ) فحص كل العناصر دون كتابة؛ إن وُجد أي خطأ تعود بالأخطاء ولا تكتب شيئًا. (ب) كتابة كل الجديد في المعاملة نفسها:
--        أي خطأ غير متوقع يُلغي الاستدعاء كله (ذرّي). العنصر المستورد سابقًا يُتجاوز ويُذكر في النتيجة (لا استبدال ولا تعديل).
--      - الإنشاء عبر admin_save_game_challenge_draft (0057) نفسها: تحدٍّ بحالة draft + الإصدار الأول draft + الحلّ في جدول الحلول المغلق؛
--        والإسناد للمرحلة عبر admin_set_game_challenge_stage (0056). لا نشر أبدًا ولا تعديل لتحدٍّ قائم.
--      - قفل استشاري على import_id يمنع تزامن إعادتين لنفس الاستيراد.
--      - الحد: 100 عنصر للاستدعاء الواحد (الواجهة تقسّم الملفات الأكبر إلى دفعات كل منها ذرّية؛ والإعادة آمنة بفضل import_key).
-- يتطلب: 0050 و0055–0057 و0060. آمن لإعادة التشغيل.
-- الرجوع: supabase/rollback/0061_games_bulk_import_down.sql
-- ⚠️ تجربة جافة أولًا: استبدل `commit;` الأخيرة بـ `rollback;` ثم شغّل الملف، وإن نجح أعدها `commit;`.
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public.admin_save_game_challenge_draft(uuid, uuid, jsonb)') is null
     or to_regprocedure('public.game_builder_validate(text, jsonb, jsonb, jsonb, boolean)') is null
     or to_regprocedure('public.game_builder_text_ok(jsonb, text, integer, boolean)') is null then
    raise exception 'شغّل 0057_games_challenge_builder.sql أولاً';
  end if;
  if to_regprocedure('public.admin_set_game_challenge_stage(uuid, uuid, boolean)') is null then
    raise exception 'شغّل 0056_games_learning_paths_admin.sql أولاً';
  end if;
  if to_regprocedure('public.game_challenges_content_guard()') is null then
    raise exception 'شغّل 0060_games_final_integration.sql أولاً';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) مفتاح الاستيراد (منع التكرار)
-- ---------------------------------------------------------------------
alter table public.game_challenges add column if not exists import_key text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'game_challenges_import_key_len'
                  and conrelid = 'public.game_challenges'::regclass) then
    alter table public.game_challenges
      add constraint game_challenges_import_key_len check (import_key is null or char_length(import_key) between 3 and 140);
  end if;
end $$;

create unique index if not exists uq_game_challenges_import_key on public.game_challenges (import_key) where import_key is not null;

-- ---------------------------------------------------------------------
-- 2) RPC الاستيراد
--    كل عنصر: { external_id, stage_id, game_id? (للتحقق من التطابق), slug, is_required?, default_language, allow_language_fallback?,
--               title, description?, difficulty, points_reward, time_limit_seconds?, max_attempts?, content, solution, feedback?, change_note? }
--    الإرجاع: { ok, dry_run, total, created_count, skipped_count, error_count, items:[{index, external_id, status, field?, code?, challenge_id?, version_id?, stage_id?}] }
--    status: new | duplicate | error | created | skipped
-- ---------------------------------------------------------------------
create or replace function public.admin_import_game_challenges(p_import_id text, p_items jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_max constant integer := 100;
  n         integer;
  i         integer;
  it        jsonb;
  v_field   text;
  v_code    text;
  v_ext     text;
  v_key     text;
  v_stage   uuid;
  v_game    uuid;
  v_sstatus text;
  v_slug    text;
  v_lang    text;
  v_num     integer;
  v_feed    jsonb;
  v_desc    jsonb;
  v_exist   uuid;
  v_req     boolean;
  v_seen_ext  text[] := '{}';
  v_seen_slug text[] := '{}';
  v_rows    jsonb[] := '{}';
  v_errs    integer := 0;
  v_new     integer := 0;
  v_dup     integer := 0;
  v_res     jsonb;
  v_cid     uuid;
  v_vid     uuid;
  v_out     jsonb[] := '{}';
  v_row     jsonb;
begin
  -- الصلاحية على الخادم دائمًا (لا يُعتمد على الواجهة)
  if auth.uid() is null or not public.can_manage_games() then
    raise exception 'games_access_denied';
  end if;
  if p_import_id is null or p_import_id !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$' then
    raise exception 'invalid_import_id';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'invalid_data';
  end if;
  n := jsonb_array_length(p_items);
  if n > c_max then
    raise exception 'import_too_large';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('games_import:' || p_import_id, 0));

  -- ===== التمريرة (أ): فحص كل عنصر بلا كتابة =====
  for i in 0 .. n - 1 loop
    it := p_items -> i;
    v_field := null; v_code := null; v_ext := null; v_exist := null; v_stage := null; v_game := null;
    begin
      v_field := 'item';
      if jsonb_typeof(it) is distinct from 'object' then raise exception 'invalid_data'; end if;

      v_field := 'external_id';
      v_ext := it ->> 'external_id';
      if jsonb_typeof(it -> 'external_id') is distinct from 'string' or v_ext !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$' then
        raise exception 'invalid_external_id';
      end if;
      if v_ext = any (v_seen_ext) then raise exception 'duplicate_external_id'; end if;
      v_seen_ext := v_seen_ext || v_ext;

      v_key := p_import_id || ':' || v_ext;
      select c.id into v_exist from public.game_challenges c where c.import_key = v_key;
      if v_exist is not null then
        -- مستورد سابقًا: يُتجاوز كما هو (لا استبدال ولا تعديل) ولا يُفحص محتواه ثانيةً
        v_dup := v_dup + 1;
        v_rows := v_rows || jsonb_build_object('index', i, 'external_id', v_ext, 'status', 'duplicate', 'challenge_id', v_exist);
        continue;
      end if;

      v_field := 'stage_id';
      begin
        v_stage := (it ->> 'stage_id')::uuid;
      exception when others then
        raise exception 'stage_not_found';
      end;
      select s.game_id, s.status into v_game, v_sstatus from public.game_stages s where s.id = v_stage;
      if v_game is null then raise exception 'stage_not_found'; end if;
      if v_sstatus = 'archived' then raise exception 'stage_archived'; end if;
      if it ? 'game_id' and (it ->> 'game_id') is distinct from v_game::text then raise exception 'stage_game_mismatch'; end if;

      v_field := 'slug';
      v_slug := it ->> 'slug';
      if jsonb_typeof(it -> 'slug') is distinct from 'string' or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) > 64 then
        raise exception 'invalid_data';
      end if;
      if (v_game::text || '/' || v_slug) = any (v_seen_slug) then raise exception 'slug_taken'; end if;
      v_seen_slug := v_seen_slug || (v_game::text || '/' || v_slug);
      if exists (select 1 from public.game_challenges c where c.game_id = v_game and c.slug = v_slug) then
        raise exception 'slug_taken';
      end if;

      v_field := 'is_required';
      if it ? 'is_required' and jsonb_typeof(it -> 'is_required') is distinct from 'boolean' then raise exception 'invalid_data'; end if;

      v_field := 'default_language';
      v_lang := it ->> 'default_language';
      if jsonb_typeof(it -> 'default_language') is distinct from 'string' or v_lang not in ('ar', 'fr', 'en') then
        raise exception 'invalid_language';
      end if;
      if it ? 'allow_language_fallback' and jsonb_typeof(it -> 'allow_language_fallback') is distinct from 'boolean' then raise exception 'invalid_data'; end if;

      v_field := 'title';
      if not public.game_builder_text_ok(it -> 'title', v_lang, 200, true) then raise exception 'translation_required'; end if;

      v_field := 'description';
      v_desc := nullif(it -> 'description', 'null'::jsonb);
      if v_desc is not null and not public.game_builder_text_ok(v_desc, v_lang, 2000, false) then raise exception 'invalid_data'; end if;

      v_field := 'difficulty';
      if jsonb_typeof(it -> 'difficulty') is distinct from 'number' then raise exception 'invalid_data'; end if;
      v_num := (it ->> 'difficulty')::integer;
      if v_num < 1 or v_num > 5 then raise exception 'invalid_data'; end if;

      v_field := 'points_reward';
      if jsonb_typeof(it -> 'points_reward') is distinct from 'number' then raise exception 'invalid_data'; end if;
      v_num := (it ->> 'points_reward')::integer;
      if v_num < 0 or v_num > 10000 then raise exception 'invalid_data'; end if;

      v_field := 'time_limit_seconds';
      if nullif(it -> 'time_limit_seconds', 'null'::jsonb) is not null then
        if jsonb_typeof(it -> 'time_limit_seconds') is distinct from 'number' then raise exception 'invalid_data'; end if;
        v_num := (it ->> 'time_limit_seconds')::integer;
        if v_num < 5 or v_num > 86400 then raise exception 'invalid_data'; end if;
      end if;

      v_field := 'max_attempts';
      if nullif(it -> 'max_attempts', 'null'::jsonb) is not null then
        if jsonb_typeof(it -> 'max_attempts') is distinct from 'number' then raise exception 'invalid_data'; end if;
        v_num := (it ->> 'max_attempts')::integer;
        if v_num < 1 or v_num > 1000 then raise exception 'invalid_data'; end if;
      end if;

      v_field := 'solution';
      if jsonb_typeof(it -> 'solution') is distinct from 'object' or (it -> 'solution') = '{}'::jsonb then
        raise exception 'solution_required';
      end if;

      v_field := 'content';
      if jsonb_typeof(it -> 'content') is distinct from 'object' then raise exception 'invalid_content'; end if;
      if public.game_builder_has_forbidden_key(it -> 'content') then raise exception 'content_has_answer'; end if;

      v_field := 'feedback';
      v_feed := nullif(it -> 'feedback', 'null'::jsonb);
      if v_feed = '{}'::jsonb then v_feed := null; end if;

      v_field := 'content';
      -- نفس شروط النشر (الوضع الصارم) كي لا يُستورد ما لا يصلح للنشر لاحقًا
      perform public.game_builder_validate(v_lang, it -> 'content', it -> 'solution', v_feed, true);

      v_new := v_new + 1;
      v_rows := v_rows || jsonb_build_object('index', i, 'external_id', v_ext, 'status', 'new', 'stage_id', v_stage);
    exception when others then
      -- لا نُسرّب نصوص أخطاء داخلية: رمز قصير معروف أو invalid_data
      if sqlstate = 'P0001' and sqlerrm ~ '^[a-z][a-z0-9_]{2,63}$' then
        v_code := sqlerrm;
      else
        v_code := 'invalid_data';
      end if;
      v_errs := v_errs + 1;
      v_rows := v_rows || jsonb_strip_nulls(jsonb_build_object('index', i, 'external_id', v_ext, 'status', 'error', 'field', v_field, 'code', v_code));
    end;
  end loop;

  if p_dry_run or v_errs > 0 then
    return jsonb_build_object('ok', v_errs = 0, 'dry_run', p_dry_run, 'total', n, 'created_count', 0, 'skipped_count', v_dup,
                              'error_count', v_errs, 'items', to_jsonb(v_rows));
  end if;

  -- ===== التمريرة (ب): الكتابة (ذرّية مع الاستدعاء كله) =====
  for i in 0 .. n - 1 loop
    it := p_items -> i;
    v_row := v_rows[i + 1];
    if v_row ->> 'status' = 'duplicate' then
      v_out := v_out || (v_row || jsonb_build_object('status', 'skipped'));
      continue;
    end if;
    v_stage := (it ->> 'stage_id')::uuid;
    select s.game_id into v_game from public.game_stages s where s.id = v_stage;
    v_req := coalesce((it ->> 'is_required')::boolean, true);
    v_feed := nullif(it -> 'feedback', 'null'::jsonb);
    if v_feed = '{}'::jsonb then v_feed := null; end if;

    -- مسودّة جديدة فقط (p_challenge_id = null و p_version_id = null): تحدٍّ draft + الإصدار الأول draft + الحلّ المغلق
    v_res := public.admin_save_game_challenge_draft(null, null, jsonb_build_object(
      'game_id', v_game,
      'slug', it ->> 'slug',
      'default_language', it ->> 'default_language',
      'allow_language_fallback', coalesce((it ->> 'allow_language_fallback')::boolean, true),
      'title', it -> 'title',
      'description', nullif(it -> 'description', 'null'::jsonb),
      'difficulty', (it ->> 'difficulty')::integer,
      'points_reward', (it ->> 'points_reward')::integer,
      'time_limit_seconds', nullif(it -> 'time_limit_seconds', 'null'::jsonb),
      'max_attempts', nullif(it -> 'max_attempts', 'null'::jsonb),
      'content', it -> 'content',
      'solution', it -> 'solution',
      'feedback', v_feed,
      'change_note', left(coalesce(nullif(it ->> 'change_note', ''), 'bulk-import:' || p_import_id), 500)
    ));
    v_cid := nullif(v_res ->> 'challenge_id', '')::uuid;
    v_vid := nullif(v_res ->> 'version_id', '')::uuid;
    if v_cid is null then raise exception 'invalid_data'; end if;

    perform public.admin_set_game_challenge_stage(v_cid, v_stage, v_req);
    update public.game_challenges set import_key = p_import_id || ':' || (it ->> 'external_id') where id = v_cid;

    v_out := v_out || jsonb_build_object('index', i, 'external_id', it ->> 'external_id', 'status', 'created',
                                         'challenge_id', v_cid, 'version_id', v_vid, 'stage_id', v_stage);
  end loop;

  return jsonb_build_object('ok', true, 'dry_run', false, 'total', n, 'created_count', v_new, 'skipped_count', v_dup,
                            'error_count', 0, 'items', to_jsonb(v_out));
end;
$$;

revoke all on function public.admin_import_game_challenges(text, jsonb, boolean) from public, anon;
grant execute on function public.admin_import_game_challenges(text, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
