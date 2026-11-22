-- ============================================================
-- supabase/tests/games_maintenance_smoke.sql — فحص سلوكي لوضع صيانة الألعاب (0062). يعمل داخل معاملة تُلغى (rollback) ولا يترك أثرًا.
--
-- التشغيل: الصق الملف كاملًا في Supabase → SQL Editor (أو: psql "$DB_URL" -f supabase/tests/games_maintenance_smoke.sql) بعد تطبيق 0049 → 0062.
-- ⚠️ شغّله على بيئة تجريبية/محلية لا على الإنتاج (رغم أنه يُلغى بالكامل، فهو يكتب مؤقتًا في auth.users وsite_settings).
-- أي فشل يرفع استثناءً يبدأ بـ FAIL: ويذكر السبب. النجاح = رسالة NOTICE في النهاية.
--
-- يغطّي:
--   * مفعّل: super_admin وdeveloper وeditor وعضو منخرط يعبرون can_access_games؛ get_games_section_status = enabled (حتى لـ anon).
--   * صيانة: can_access_games = false للجميع؛ get_my_game_summary (RPC لاعب) يُرفض 42501؛ can_manage_games تبقى true لـ super_admin/developer فقط.
--   * get_games_access: المؤهَّل يرى reason=maintenance، وغير المؤهَّل (عضو غير منخرط) يبقى reason الأصلي (لا تسرّب).
--   * الكتابة على site_settings: editor وanon لا يغيّرانها (RLS)، super_admin/developer يغيّرانها، والقيمة غير الصالحة تُرفض (22023).
--   * إعادة التفعيل تعيد الوصول، وعدد الألعاب/المحاولات/النتائج/النقاط لا يتغيّر عبر التبديل.
--   * غياب الصف = enabled (يحفظ سلوك الإنتاج).
-- ============================================================
begin;

do $$
declare
  v_season constant text := '__gm_smk_2099__';
  u_super  uuid := gen_random_uuid();
  u_dev    uuid := gen_random_uuid();
  u_editor uuid := gen_random_uuid();
  u_paid   uuid := gen_random_uuid();
  u_unpaid uuid := gen_random_uuid();
  m_paid   uuid;
  m_unpaid uuid;
  n_before bigint;
  n_after  bigint;
  n_rows   integer;
  got      jsonb;
  s        text;
  denied   boolean;
begin
  if to_regprocedure('public.games_section_enabled()') is null
     or to_regprocedure('public.get_games_section_status()') is null
     or to_regprocedure('public.can_access_games()') is null then
    raise exception 'FAIL: دوال 0062 غير موجودة — طبّق 0062_games_maintenance_mode.sql أولًا';
  end if;

  -- ---------- تجهيز (بصلاحية المالك) ----------
  insert into public.site_settings (key, value) values ('current_season', v_season)
    on conflict (key) do update set value = excluded.value;
  insert into public.site_settings (key, value) values ('games_section_status', 'enabled')
    on conflict (key) do update set value = 'enabled';

  insert into auth.users (id, email) values
    (u_super,  '__gmsmk_super@example.invalid'),
    (u_dev,    '__gmsmk_dev@example.invalid'),
    (u_editor, '__gmsmk_editor@example.invalid'),
    (u_paid,   '__gmsmk_paid@example.invalid'),
    (u_unpaid, '__gmsmk_unpaid@example.invalid');
  insert into public.profiles (id, full_name, email, role, must_change_password) values
    (u_super,  '__gmsmk_super',  '__gmsmk_super@example.invalid',  'super_admin', false),
    (u_dev,    '__gmsmk_dev',    '__gmsmk_dev@example.invalid',    'developer',   false),
    (u_editor, '__gmsmk_editor', '__gmsmk_editor@example.invalid', 'editor',      false);
  insert into public.members (full_name, status) values ('__gmsmk_paid__',   'active') returning id into m_paid;
  insert into public.members (full_name, status) values ('__gmsmk_unpaid__', 'active') returning id into m_unpaid;
  insert into public.member_memberships (member_id, season, amount) values (m_paid, v_season, 100);
  insert into public.member_accounts (user_id, member_id, must_change_password) values
    (u_paid, m_paid, false), (u_unpaid, m_unpaid, false);

  -- بصمة البيانات قبل التبديل
  select (select count(*) from public.games) + (select count(*) from public.game_attempts)
       + (select count(*) from public.game_results) + (select count(*) from public.game_points) into n_before;

  -- ---------- 1) مفعّل ----------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_paid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  if not public.can_access_games() then raise exception 'FAIL: عضو منخرط مرفوض والقسم مفعّل'; end if;
  if public.get_games_section_status() <> 'enabled' then raise exception 'FAIL: الحالة ليست enabled'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_editor, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  if not public.can_access_games() then raise exception 'FAIL: إداري (editor) مرفوض والقسم مفعّل'; end if;
  if public.can_manage_games() then raise exception 'FAIL: editor يملك can_manage_games'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_super, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  if not public.can_manage_games() then raise exception 'FAIL: super_admin بلا can_manage_games والقسم مفعّل'; end if;

  -- ---------- 2) الكتابة على الإعداد ----------
  -- editor: RLS تمنع (لا صفوف متأثرة أو خطأ صلاحية) والقيمة لا تتغير
  perform set_config('request.jwt.claims', json_build_object('sub', u_editor, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  begin
    update public.site_settings set value = 'maintenance' where key = 'games_section_status';
    get diagnostics n_rows = row_count;
    if n_rows <> 0 then raise exception 'FAIL: editor عدّل إعداد الصيانة'; end if;
  exception when insufficient_privilege then null;
  end;
  denied := false;
  begin
    insert into public.site_settings (key, value) values ('games_section_status', 'maintenance')
      on conflict (key) do update set value = excluded.value;
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'FAIL: editor استطاع upsert لإعداد الصيانة'; end if;

  -- anon
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  if public.get_games_section_status() <> 'enabled' then raise exception 'FAIL: anon لا يقرأ الحالة'; end if;
  begin
    update public.site_settings set value = 'maintenance' where key = 'games_section_status';
    get diagnostics n_rows = row_count;
    if n_rows <> 0 then raise exception 'FAIL: anon عدّل إعداد الصيانة'; end if;
  exception when insufficient_privilege then null;
  end;
  reset role;
  select value into s from public.site_settings where key = 'games_section_status';
  if s <> 'enabled' then raise exception 'FAIL: القيمة تغيّرت بيد غير مخوّل (%)', s; end if;

  -- super_admin يفعّل الصيانة
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_super, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  update public.site_settings set value = 'maintenance' where key = 'games_section_status';
  get diagnostics n_rows = row_count;
  if n_rows <> 1 then raise exception 'FAIL: super_admin لم يستطع تفعيل الصيانة'; end if;

  -- قيمة غير صالحة تُرفض (22023)
  denied := false;
  begin
    update public.site_settings set value = 'foo' where key = 'games_section_status';
  exception when sqlstate '22023' then denied := true;
  end;
  if not denied then raise exception 'FAIL: قبلت قيمة غير صالحة'; end if;

  -- ---------- 3) صيانة ----------
  if public.can_access_games() then raise exception 'FAIL: super_admin يعبر can_access_games أثناء الصيانة'; end if;
  if not public.can_manage_games() then raise exception 'FAIL: super_admin فقد can_manage_games أثناء الصيانة'; end if;
  if public.get_games_section_status() <> 'maintenance' then raise exception 'FAIL: الحالة ليست maintenance'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_dev, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  if public.can_access_games() or not public.can_manage_games() then raise exception 'FAIL: developer أثناء الصيانة'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_editor, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  if public.can_access_games() or public.can_manage_games() then raise exception 'FAIL: editor أثناء الصيانة'; end if;
  got := public.get_games_access();
  if got->>'allowed' <> 'false' or got->>'reason' <> 'maintenance' then raise exception 'FAIL: reason للمؤهَّل يجب maintenance: %', got; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_paid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  if public.can_access_games() then raise exception 'FAIL: عضو منخرط يعبر أثناء الصيانة'; end if;
  got := public.get_games_access();
  if got->>'reason' <> 'maintenance' then raise exception 'FAIL: reason لعضو منخرط يجب maintenance: %', got; end if;
  -- RPC لاعب يُرفض على الخادم
  denied := false;
  begin
    perform public.get_my_game_summary();
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'FAIL: get_my_game_summary لم تُرفض أثناء الصيانة'; end if;

  -- غير مؤهَّل: لا تسرّب (يبقى سببه الأصلي)
  perform set_config('request.jwt.claims', json_build_object('sub', u_unpaid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  got := public.get_games_access();
  if got->>'reason' <> 'membership_not_paid' then raise exception 'FAIL: غير المنخرط يجب أن يبقى membership_not_paid: %', got; end if;

  -- ---------- 4) إعادة التفعيل ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_dev, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  update public.site_settings set value = 'enabled' where key = 'games_section_status';
  get diagnostics n_rows = row_count;
  if n_rows <> 1 then raise exception 'FAIL: developer لم يستطع إعادة التفعيل'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_paid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  if not public.can_access_games() then raise exception 'FAIL: الوصول لم يعد بعد إعادة التفعيل'; end if;
  got := public.get_games_access();
  if got->>'allowed' <> 'true' then raise exception 'FAIL: get_games_access بعد إعادة التفعيل: %', got; end if;

  -- ---------- 5) البيانات سليمة ----------
  perform set_config('request.jwt.claims', '', true);
  reset role;
  select (select count(*) from public.games) + (select count(*) from public.game_attempts)
       + (select count(*) from public.game_results) + (select count(*) from public.game_points) into n_after;
  if n_after <> n_before then raise exception 'FAIL: تغيّر عدد سجلات الألعاب (% → %)', n_before, n_after; end if;

  -- ---------- 6) غياب الصف = enabled ----------
  delete from public.site_settings where key = 'games_section_status';
  if not public.games_section_enabled() then raise exception 'FAIL: غياب الصف يجب أن يعني enabled'; end if;

  raise notice 'OK: games_maintenance_smoke — كل الفحوص نجحت';
end $$;

rollback;
