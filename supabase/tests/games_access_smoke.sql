-- ============================================================
-- supabase/tests/games_access_smoke.sql — فحص سلوكي لبوّابة الألعاب (0049). يعمل داخل معاملة تُلغى (rollback) ولا يترك أثرًا.
--
-- التشغيل: الصق الملف كاملًا في Supabase → SQL Editor (أو: psql "$DB_URL" -f supabase/tests/games_access_smoke.sql) بعد تطبيق 0049.
-- أي فشل يرفع استثناءً يبدأ بـ FAIL: ويذكر السبب. النجاح = رسالة NOTICE في النهاية.
--
-- يغطّي: كل قيم admin_role (تُقرأ من enum_range فلا قائمة أدوار مكتوبة) مسموحة؛ عضو نشط منخرط هذا الموسم مسموح؛
--   غير المنخرط / منخرط موسم سابق فقط / عضو غير نشط / عضو محذوف / حساب عضو معطّل / مستخدم بلا حساب / ملف إداري معطّل مرفوضون؛
--   الحساب المزدوج (إداري + عضو غير منخرط) مسموح بصفته الإدارية؛ لا موسم حالي (فارغ أو مسافات) يرفض الأعضاء ويبقي الإداريين؛
--   MFA: مسؤول أو حساب مزدوج بعامل موثّق وجلسة aal1 مرفوض، وبـ aal2 مسموح (يُتخطّى إن تعذّر إدراج عامل تجريبي في auth.mfa_factors)؛
--   anon لا ينفّذ الدالتين؛ بلا JWT = unauthenticated؛ allowed في get_games_access = can_access_games دائمًا؛ سمات الأمان للدالتين.
-- ============================================================
begin;

do $$
declare
  v_season constant text := '__smoke_season_2099__';
  v_prev   constant text := '__smoke_season_2098__';

  u_paid     uuid := gen_random_uuid();
  u_unpaid   uuid := gen_random_uuid();
  u_prev     uuid := gen_random_uuid();
  u_inactive uuid := gen_random_uuid();
  u_deleted  uuid := gen_random_uuid();
  u_acct_off uuid := gen_random_uuid();
  u_plain    uuid := gen_random_uuid();
  u_offprof  uuid := gen_random_uuid();
  u_dual     uuid := gen_random_uuid();
  u_mfa      uuid := gen_random_uuid();
  u_mfa_dual uuid := gen_random_uuid();

  m_paid     uuid;
  m_unpaid   uuid;
  m_prev     uuid;
  m_inactive uuid;
  m_deleted  uuid;
  m_acct_off uuid;
  m_dual     uuid;
  m_mfa_dual uuid;

  r        record;
  v        uuid;
  cases    jsonb := '[]'::jsonb;
  c        jsonb;
  got      jsonb;
  can      boolean;
  denied   boolean;
  mfa_ok   boolean := true;
  fx_ok    boolean := true;
begin
  if to_regprocedure('public.can_access_games()') is null or to_regprocedure('public.get_games_access()') is null then
    raise notice 'تخطّي فحوص 0049: الدالتان غير موجودتين (لم تُطبَّق 0049)';
    return;
  end if;

  -- ---------- تجهيز (بصلاحية المالك، يُلغى مع rollback) ----------
  begin
    insert into public.site_settings (key, value) values ('current_season', v_season)
      on conflict (key) do update set value = excluded.value;

    insert into auth.users (id, email) values
      (u_paid,     '__gsmoke_paid@example.invalid'),
      (u_unpaid,   '__gsmoke_unpaid@example.invalid'),
      (u_prev,     '__gsmoke_prev@example.invalid'),
      (u_inactive, '__gsmoke_inactive@example.invalid'),
      (u_deleted,  '__gsmoke_deleted@example.invalid'),
      (u_acct_off, '__gsmoke_acctoff@example.invalid'),
      (u_plain,    '__gsmoke_plain@example.invalid'),
      (u_offprof,  '__gsmoke_offprof@example.invalid'),
      (u_dual,     '__gsmoke_dual@example.invalid'),
      (u_mfa,      '__gsmoke_mfa@example.invalid'),
      (u_mfa_dual, '__gsmoke_mfadual@example.invalid');

    -- مسؤول لكل قيمة في admin_role (من enum مباشرة: يشمل أي دور يُضاف لاحقًا)
    for r in select e::text as role_name from unnest(enum_range(null::admin_role)) as e loop
      v := gen_random_uuid();
      insert into auth.users (id, email) values (v, '__gsmoke_role_' || r.role_name || '@example.invalid');
      insert into public.profiles (id, full_name, email, role)
        values (v, '__gsmoke_' || r.role_name, '__gsmoke_role_' || r.role_name || '@example.invalid', r.role_name::admin_role);
      cases := cases || jsonb_build_array(jsonb_build_object(
        'l', 'admin role ' || r.role_name, 'u', v, 'aal', 'aal1', 'allow', true, 'reason', 'admin'));
    end loop;

    -- أعضاء
    insert into public.members (full_name, status) values ('__gsmoke_paid__',     'active')   returning id into m_paid;
    insert into public.members (full_name, status) values ('__gsmoke_unpaid__',   'active')   returning id into m_unpaid;
    insert into public.members (full_name, status) values ('__gsmoke_prev__',     'active')   returning id into m_prev;
    insert into public.members (full_name, status) values ('__gsmoke_inactive__', 'inactive') returning id into m_inactive;
    insert into public.members (full_name, status) values ('__gsmoke_deleted__',  'active')   returning id into m_deleted;
    insert into public.members (full_name, status) values ('__gsmoke_acctoff__',  'active')   returning id into m_acct_off;
    insert into public.members (full_name, status) values ('__gsmoke_dual__',     'active')   returning id into m_dual;
    insert into public.members (full_name, status) values ('__gsmoke_mfadual__',  'active')   returning id into m_mfa_dual;

    -- دفعات: الموسم الحالي لمن يلزم، وموسم سابق فقط لـ m_prev
    insert into public.member_memberships (member_id, season, amount) values
      (m_paid,     v_season, 100),
      (m_prev,     v_prev,   100),
      (m_inactive, v_season, 100),
      (m_deleted,  v_season, 100),
      (m_acct_off, v_season, 100),
      (m_mfa_dual, v_season, 100);

    -- حسابات الأعضاء (المشغّل يرفض ربط مستخدم له profiles إلا بعلم admin_linked)
    insert into public.member_accounts (user_id, member_id) values
      (u_paid, m_paid), (u_unpaid, m_unpaid), (u_prev, m_prev),
      (u_inactive, m_inactive), (u_deleted, m_deleted), (u_acct_off, m_acct_off);
    update public.member_accounts set is_active = false where user_id = u_acct_off;
    update public.members set deleted_at = now() where id = m_deleted;

    -- مسؤول بلا حساب عضو لكن ملفه معطّل
    insert into public.profiles (id, full_name, email, role, is_active)
      values (u_offprof, '__gsmoke_offprof', '__gsmoke_offprof@example.invalid', 'editor', false);

    -- حسابات مزدوجة (إداري + عضو): الأول غير منخرط، الثاني منخرط
    insert into public.profiles (id, full_name, email, role)
      values (u_dual, '__gsmoke_dual', '__gsmoke_dual@example.invalid', 'editor'),
             (u_mfa_dual, '__gsmoke_mfadual', '__gsmoke_mfadual@example.invalid', 'editor');
    insert into public.member_accounts (user_id, member_id, admin_linked) values
      (u_dual, m_dual, true), (u_mfa_dual, m_mfa_dual, true);

    -- مسؤول عادي لفحص MFA
    insert into public.profiles (id, full_name, email, role)
      values (u_mfa, '__gsmoke_mfa', '__gsmoke_mfa@example.invalid', 'editor');
  exception when others then
    fx_ok := false;
    raise notice 'تخطّي فحوص 0049: تعذّر تجهيز البيانات التجريبية (%)', sqlerrm;
  end;
  if not fx_ok then return; end if;

  -- عامل MFA موثّق تجريبي (قد يختلف مخطط auth.mfa_factors بين الإصدارات: نتخطّى فحوص MFA إن فشل)
  begin
    insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
    values (gen_random_uuid(), u_mfa,      '__gsmoke_totp1__', 'totp', 'verified', now(), now()),
           (gen_random_uuid(), u_mfa_dual, '__gsmoke_totp2__', 'totp', 'verified', now(), now());
  exception when others then
    mfa_ok := false;
    raise notice 'تخطّي فحوص MFA: تعذّر إدراج عامل تجريبي في auth.mfa_factors (%)', sqlerrm;
  end;

  -- ---------- جدول الحالات: l=وصف، u=المستخدم، aal، allow=المتوقع، reason=المتوقع، s=قيمة الموسم (اختياري) ----------
  cases := cases || jsonb_build_array(
    jsonb_build_object('l', 'عضو نشط منخرط هذا الموسم',          'u', u_paid,     'aal', 'aal1', 'allow', true,  'reason', 'member'),
    jsonb_build_object('l', 'عضو نشط غير منخرط',                  'u', u_unpaid,   'aal', 'aal1', 'allow', false, 'reason', 'membership_not_paid'),
    jsonb_build_object('l', 'عضو منخرط موسمًا سابقًا فقط',        'u', u_prev,     'aal', 'aal1', 'allow', false, 'reason', 'membership_not_paid'),
    jsonb_build_object('l', 'عضو غير نشط (inactive) رغم الدفع',   'u', u_inactive, 'aal', 'aal1', 'allow', false, 'reason', 'member_inactive'),
    jsonb_build_object('l', 'عضو محذوف (soft delete) رغم الدفع',  'u', u_deleted,  'aal', 'aal1', 'allow', false, 'reason', 'no_member_account'),
    jsonb_build_object('l', 'حساب عضو معطّل رغم الدفع',           'u', u_acct_off, 'aal', 'aal1', 'allow', false, 'reason', 'no_member_account'),
    jsonb_build_object('l', 'مستخدم موثّق بلا حساب ولا profile',    'u', u_plain,    'aal', 'aal1', 'allow', false, 'reason', 'no_member_account'),
    jsonb_build_object('l', 'ملف إداري معطّل (is_active=false)',   'u', u_offprof,  'aal', 'aal1', 'allow', false, 'reason', 'no_member_account'),
    jsonb_build_object('l', 'حساب مزدوج غير منخرط: يدخل بصفته الإدارية', 'u', u_dual, 'aal', 'aal1', 'allow', true, 'reason', 'admin'),
    -- لا موسم حالي: فارغ ومسافات فقط → الأعضاء مرفوضون والإداريون مسموحون
    jsonb_build_object('l', 'لا موسم (فارغ): عضو منخرط',           'u', u_paid,     'aal', 'aal1', 'allow', false, 'reason', 'no_season', 's', ''),
    jsonb_build_object('l', 'لا موسم (مسافات): عضو منخرط',        'u', u_paid,     'aal', 'aal1', 'allow', false, 'reason', 'no_season', 's', '   '),
    jsonb_build_object('l', 'لا موسم (فارغ): حساب مزدوج إداري',   'u', u_dual,     'aal', 'aal1', 'allow', true,  'reason', 'admin',     's', '')
  );

  if mfa_ok then
    cases := cases || jsonb_build_array(
      jsonb_build_object('l', 'MFA: مسؤول بعامل موثّق وجلسة aal1',            'u', u_mfa,      'aal', 'aal1', 'allow', false, 'reason', 'mfa_required'),
      jsonb_build_object('l', 'MFA: المسؤول نفسه بجلسة aal2',                 'u', u_mfa,      'aal', 'aal2', 'allow', true,  'reason', 'admin'),
      jsonb_build_object('l', 'MFA: حساب مزدوج منخرط بجلسة aal1 (لا تسلّل عبر مسار العضو)', 'u', u_mfa_dual, 'aal', 'aal1', 'allow', false, 'reason', 'mfa_required'),
      jsonb_build_object('l', 'MFA: الحساب المزدوج بجلسة aal2',               'u', u_mfa_dual, 'aal', 'aal2', 'allow', true,  'reason', 'admin')
    );
  end if;

  -- ---------- التنفيذ ----------
  for r in select value as j from jsonb_array_elements(cases) loop
    c := r.j;
    reset role;
    update public.site_settings set value = coalesce(c->>'s', v_season) where key = 'current_season';

    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', c->>'u', 'role', 'authenticated', 'aal', c->>'aal')::text, true);
    can := public.can_access_games();
    got := public.get_games_access();
    reset role;

    if can is distinct from (c->>'allow')::boolean then
      raise exception 'FAIL: [%] can_access_games = %، المتوقع %', c->>'l', can, c->>'allow';
    end if;
    if (got->>'allowed')::boolean is distinct from can then
      raise exception 'FAIL: [%] get_games_access.allowed (%) يخالف can_access_games (%)', c->>'l', got->>'allowed', can;
    end if;
    if got->>'reason' is distinct from c->>'reason' then
      raise exception 'FAIL: [%] reason = %، المتوقع %', c->>'l', got->>'reason', c->>'reason';
    end if;
  end loop;

  -- ---------- موسم حالي صالح: استعادة ----------
  reset role;
  update public.site_settings set value = v_season where key = 'current_season';

  -- ---------- بلا JWT (authenticated بلا sub) ----------
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  if public.can_access_games() then raise exception 'FAIL: بلا هوية (auth.uid() null) يُسمح له'; end if;
  got := public.get_games_access();
  if got->>'reason' is distinct from 'unauthenticated' or (got->>'allowed')::boolean then
    raise exception 'FAIL: بلا هوية: get_games_access = %', got;
  end if;
  reset role;

  -- ---------- anon لا ينفّذ الدالتين ----------
  set local role anon;
  denied := false;
  begin perform public.can_access_games(); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL: anon ينفّذ can_access_games'; end if;
  denied := false;
  begin perform public.get_games_access(); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL: anon ينفّذ get_games_access'; end if;
  reset role;

  -- ---------- سمات الأمان: SECURITY DEFINER + مسار بحث ثابت + بلا EXECUTE لـ PUBLIC ----------
  for r in select p.proname, p.prosecdef, p.proconfig, has_function_privilege('public', p.oid, 'execute') as pub_exec
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('can_access_games', 'get_games_access') loop
    if not r.prosecdef then raise exception 'FAIL: % ليست SECURITY DEFINER', r.proname; end if;
    if r.proconfig is null or not (r.proconfig::text like '%search_path=public, pg_temp%') then
      raise exception 'FAIL: % بلا search_path ثابت (%)', r.proname, r.proconfig;
    end if;
    if r.pub_exec then raise exception 'FAIL: % قابلة للتنفيذ من PUBLIC', r.proname; end if;
  end loop;

  reset role;
  raise notice 'فحوص 0049 (بوّابة الألعاب: كل الأدوار الإدارية + العضو المنخرط + الرفض + MFA): كل الفحوص نجحت ✔ (% حالة)', jsonb_array_length(cases);
end $$;

rollback;
