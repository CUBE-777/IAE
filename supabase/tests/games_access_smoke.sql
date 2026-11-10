-- ============================================================
-- supabase/tests/games_access_smoke.sql — فحص سلوكي لبوّابة الألعاب (0049). يعمل داخل معاملة تُلغى (rollback) ولا يترك أثرًا.
--
-- التشغيل: الصق الملف كاملًا في Supabase → SQL Editor (أو: psql "$DB_URL" -f supabase/tests/games_access_smoke.sql) بعد تطبيق 0049.
-- ⚠️ شغّله على بيئة تجريبية/محلية لا على الإنتاج (رغم أنه يُلغى بالكامل، فهو يكتب مؤقتًا في auth.users وsite_settings).
-- أي فشل يرفع استثناءً يبدأ بـ FAIL: ويذكر السبب (ويشمل: الدالتان غير موجودتين، أو تعذّر تجهيز البيانات التجريبية).
-- النجاح = رسالة NOTICE في النهاية.
--
-- يغطّي:
--   * إداري عادي: كل قيمة في admin_role (تُقرأ من enum_range فلا قائمة أدوار مكتوبة) مسموحة.
--   * إداري MFA غير مكتمل (عامل موثّق + aal1) مرفوض، وبـ aal2 مسموح.
--   * إداري بكلمة مرور مؤقتة (must_change_password = true) مرفوض، وبعد تغيير كلمة المرور فعليًا
--     (تحديث auth.users.encrypted_password فيُسقط مشغّل 0027 العلم) مسموح. والحساب المزدوج بكلمة مؤقتة مرفوض (لا تسلّل عبر العضو).
--   * عضو نشط منخرط هذا الموسم مسموح؛ غير منخرط / منخرط موسمًا سابقًا فقط / غير نشط / محذوف / حساب عضو معطّل مرفوضون.
--   * لا موسم حالي (صف غير موجود / فارغ / مسافات): الأعضاء مرفوضون والإداريون مسموحون.
--   * مستخدم موثّق عادي (بلا حساب عضو ولا profile) وملف إداري معطّل: مرفوضان.
--   * غير مسجّل الدخول: بلا هوية = unauthenticated، وanon لا ينفّذ الدالتين.
--   * allowed في get_games_access = can_access_games دائمًا؛ وسمات الأمان للدالتين.
-- ============================================================
begin;

do $$
declare
  v_season constant text := '__smk_2099__';
  v_prev   constant text := '__smk_2098__';

  u_paid     uuid := gen_random_uuid();
  u_unpaid   uuid := gen_random_uuid();
  u_prev     uuid := gen_random_uuid();
  u_inactive uuid := gen_random_uuid();
  u_deleted  uuid := gen_random_uuid();
  u_acct_off uuid := gen_random_uuid();
  u_plain    uuid := gen_random_uuid();
  u_offprof  uuid := gen_random_uuid();
  u_dual     uuid := gen_random_uuid();
  u_dual_mc  uuid := gen_random_uuid();
  u_mc       uuid := gen_random_uuid();
  u_pw       uuid := gen_random_uuid();
  u_mfa      uuid := gen_random_uuid();
  u_mfa_dual uuid := gen_random_uuid();
  u_mfa_mem  uuid := gen_random_uuid();

  m_paid     uuid;
  m_unpaid   uuid;
  m_prev     uuid;
  m_inactive uuid;
  m_deleted  uuid;
  m_acct_off uuid;
  m_dual     uuid;
  m_dual_mc  uuid;
  m_mfa_dual uuid;
  m_mfa_mem  uuid;

  r        record;
  v        uuid;
  cases    jsonb := '[]'::jsonb;
  c        jsonb;
  got      jsonb;
  can      boolean;
  denied   boolean;
  mfa_ok   boolean := true;
begin
  if to_regprocedure('public.can_access_games()') is null or to_regprocedure('public.get_games_access()') is null then
    raise exception 'FAIL: الدالتان can_access_games / get_games_access غير موجودتين — طبّق 0049_games_access.sql أولًا';
  end if;

  -- ---------- تجهيز (بصلاحية المالك، يُلغى مع rollback) ----------
  -- أي خطأ هنا فشل صريح (لا تخطٍّ صامت): تخطّي التجهيز يُظهر «نجاحًا» زائفًا دون أي فحص.
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
      (u_dual_mc,  '__gsmoke_dualmc@example.invalid'),
      (u_mc,       '__gsmoke_mc@example.invalid'),
      (u_pw,       '__gsmoke_pw@example.invalid'),
      (u_mfa,      '__gsmoke_mfa@example.invalid'),
      (u_mfa_dual, '__gsmoke_mfadual@example.invalid'),
      (u_mfa_mem,  '__gsmoke_mfamem@example.invalid');

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
    insert into public.members (full_name, status) values ('__gsmoke_dualmc__',   'active')   returning id into m_dual_mc;
    insert into public.members (full_name, status) values ('__gsmoke_mfadual__',  'active')   returning id into m_mfa_dual;
    insert into public.members (full_name, status) values ('__gsmoke_mfamem__',   'active')   returning id into m_mfa_mem;

    -- دفعات: الموسم الحالي لمن يلزم، وموسم سابق فقط لـ m_prev (m_unpaid وm_dual بلا دفعات)
    insert into public.member_memberships (member_id, season, amount) values
      (m_paid,     v_season, 100),
      (m_prev,     v_prev,   100),
      (m_inactive, v_season, 100),
      (m_deleted,  v_season, 100),
      (m_acct_off, v_season, 100),
      (m_dual_mc,  v_season, 100),
      (m_mfa_dual, v_season, 100),
      (m_mfa_mem,  v_season, 100);

    -- حسابات الأعضاء (المشغّل يرفض ربط مستخدم له profiles إلا بعلم admin_linked).
    -- must_change_password = false صراحةً: قاعدة الكلمة المؤقتة المطلوبة هنا للإداريين فقط، فلا نفترض سلوكًا للأعضاء.
    insert into public.member_accounts (user_id, member_id, must_change_password) values
      (u_paid, m_paid, false), (u_unpaid, m_unpaid, false), (u_prev, m_prev, false),
      (u_inactive, m_inactive, false), (u_deleted, m_deleted, false), (u_acct_off, m_acct_off, false),
      (u_mfa_mem, m_mfa_mem, false);
    update public.member_accounts set is_active = false where user_id = u_acct_off;
    update public.members set deleted_at = now() where id = m_deleted;

    -- مسؤول بلا حساب عضو لكن ملفه معطّل
    insert into public.profiles (id, full_name, email, role, is_active)
      values (u_offprof, '__gsmoke_offprof', '__gsmoke_offprof@example.invalid', 'editor', false);

    -- مسؤولون عاديون بلا حساب عضو: لفحص MFA وكلمة المرور المؤقتة وتغييرها
    insert into public.profiles (id, full_name, email, role, must_change_password) values
      (u_mfa, '__gsmoke_mfa', '__gsmoke_mfa@example.invalid', 'editor', false),
      (u_mc,  '__gsmoke_mc',  '__gsmoke_mc@example.invalid',  'editor', true),
      (u_pw,  '__gsmoke_pw',  '__gsmoke_pw@example.invalid',  'editor', true);

    -- حسابات مزدوجة (إداري + عضو)
    insert into public.profiles (id, full_name, email, role, must_change_password) values
      (u_dual,     '__gsmoke_dual',    '__gsmoke_dual@example.invalid',    'editor', false),
      (u_dual_mc,  '__gsmoke_dualmc',  '__gsmoke_dualmc@example.invalid',  'editor', true),
      (u_mfa_dual, '__gsmoke_mfadual', '__gsmoke_mfadual@example.invalid', 'editor', false);
    insert into public.member_accounts (user_id, member_id, admin_linked, must_change_password) values
      (u_dual, m_dual, true, false), (u_dual_mc, m_dual_mc, true, false), (u_mfa_dual, m_mfa_dual, true, false);
  exception when others then
    raise exception 'FAIL: تعذّر تجهيز البيانات التجريبية (%)', sqlerrm;
  end;

  -- عامل MFA موثّق تجريبي (قد يختلف مخطط auth.mfa_factors بين الإصدارات).
  -- إن فشل الإدراج تُتخطّى حالات MFA مع تحذير ظاهر في النتيجة النهائية (لا نجاح صامت).
  begin
    insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
    values (gen_random_uuid(), u_mfa,      '__gsmoke_totp1__', 'totp', 'verified', now(), now()),
           (gen_random_uuid(), u_mfa_dual, '__gsmoke_totp2__', 'totp', 'verified', now(), now()),
           (gen_random_uuid(), u_mfa_mem,  '__gsmoke_totp3__', 'totp', 'verified', now(), now());
  exception when others then
    mfa_ok := false;
    raise warning 'تخطّي فحوص MFA: تعذّر إدراج عامل تجريبي في auth.mfa_factors (%)', sqlerrm;
  end;

  -- ---------- جدول الحالات ----------
  -- l=وصف، u=المستخدم، aal، allow=المتوقع، reason=المتوقع،
  -- s=قيمة الموسم (اختياري)، nr=true لحذف صف current_season كليًا، pw='change' لتغيير كلمة المرور فعليًا قبل الفحص.
  cases := cases || jsonb_build_array(
    -- إداري عادي (غير الأدوار أعلاه): حساب مزدوج غير منخرط يدخل بصفته الإدارية
    jsonb_build_object('l', 'حساب مزدوج غير منخرط: يدخل بصفته الإدارية', 'u', u_dual, 'aal', 'aal1', 'allow', true, 'reason', 'admin'),

    -- كلمة مرور مؤقتة
    jsonb_build_object('l', 'إداري بكلمة مرور مؤقتة: مرفوض',                    'u', u_mc,      'aal', 'aal1', 'allow', false, 'reason', 'password_change_required'),
    jsonb_build_object('l', 'حساب مزدوج منخرط بكلمة مؤقتة: لا تسلّل عبر العضو', 'u', u_dual_mc, 'aal', 'aal1', 'allow', false, 'reason', 'password_change_required'),
    jsonb_build_object('l', 'إداري سيغيّر كلمة المرور: قبل التغيير مرفوض',       'u', u_pw,      'aal', 'aal1', 'allow', false, 'reason', 'password_change_required'),
    jsonb_build_object('l', 'الإداري نفسه بعد تغيير كلمة المرور: مسموح',         'u', u_pw,      'aal', 'aal1', 'allow', true,  'reason', 'admin', 'pw', 'change'),

    -- أعضاء
    jsonb_build_object('l', 'عضو نشط منخرط هذا الموسم',          'u', u_paid,     'aal', 'aal1', 'allow', true,  'reason', 'member'),
    jsonb_build_object('l', 'عضو نشط غير منخرط (غير دافع)',      'u', u_unpaid,   'aal', 'aal1', 'allow', false, 'reason', 'membership_not_paid'),
    jsonb_build_object('l', 'عضو منخرط موسمًا سابقًا فقط',       'u', u_prev,     'aal', 'aal1', 'allow', false, 'reason', 'membership_not_paid'),
    jsonb_build_object('l', 'عضو غير نشط (inactive) رغم الدفع',  'u', u_inactive, 'aal', 'aal1', 'allow', false, 'reason', 'member_inactive'),
    jsonb_build_object('l', 'عضو محذوف (soft delete) رغم الدفع', 'u', u_deleted,  'aal', 'aal1', 'allow', false, 'reason', 'no_member_account'),
    jsonb_build_object('l', 'حساب عضو معطّل رغم الدفع',          'u', u_acct_off, 'aal', 'aal1', 'allow', false, 'reason', 'no_member_account'),

    -- مستخدمون بلا صلاحية
    jsonb_build_object('l', 'مستخدم موثّق عادي بلا حساب ولا profile', 'u', u_plain,   'aal', 'aal1', 'allow', false, 'reason', 'no_member_account'),
    jsonb_build_object('l', 'ملف إداري معطّل (is_active=false)',      'u', u_offprof, 'aal', 'aal1', 'allow', false, 'reason', 'no_member_account'),

    -- لا موسم حالي: صف غير موجود، فارغ، مسافات فقط → الأعضاء مرفوضون والإداريون مسموحون
    jsonb_build_object('l', 'لا موسم (الصف غير موجود): عضو منخرط',  'u', u_paid, 'aal', 'aal1', 'allow', false, 'reason', 'no_season', 'nr', true),
    jsonb_build_object('l', 'لا موسم (الصف غير موجود): إداري',      'u', u_dual, 'aal', 'aal1', 'allow', true,  'reason', 'admin',     'nr', true),
    jsonb_build_object('l', 'لا موسم (فارغ): عضو منخرط',            'u', u_paid, 'aal', 'aal1', 'allow', false, 'reason', 'no_season', 's', ''),
    jsonb_build_object('l', 'لا موسم (مسافات): عضو منخرط',          'u', u_paid, 'aal', 'aal1', 'allow', false, 'reason', 'no_season', 's', '   '),
    jsonb_build_object('l', 'لا موسم (فارغ): حساب مزدوج إداري',     'u', u_dual, 'aal', 'aal1', 'allow', true,  'reason', 'admin',     's', '')
  );

  if mfa_ok then
    cases := cases || jsonb_build_array(
      jsonb_build_object('l', 'MFA: إداري بعامل موثّق وجلسة aal1',                          'u', u_mfa,      'aal', 'aal1', 'allow', false, 'reason', 'mfa_required'),
      jsonb_build_object('l', 'MFA: الإداري نفسه بجلسة aal2',                               'u', u_mfa,      'aal', 'aal2', 'allow', true,  'reason', 'admin'),
      jsonb_build_object('l', 'MFA: عضو منخرط بعامل موثّق وجلسة aal1',                      'u', u_mfa_mem,  'aal', 'aal1', 'allow', false, 'reason', 'mfa_required'),
      jsonb_build_object('l', 'MFA: العضو نفسه بجلسة aal2',                                 'u', u_mfa_mem,  'aal', 'aal2', 'allow', true,  'reason', 'member'),
      jsonb_build_object('l', 'MFA: حساب مزدوج منخرط بجلسة aal1 (لا تسلّل عبر مسار العضو)', 'u', u_mfa_dual, 'aal', 'aal1', 'allow', false, 'reason', 'mfa_required'),
      jsonb_build_object('l', 'MFA: الحساب المزدوج بجلسة aal2',                             'u', u_mfa_dual, 'aal', 'aal2', 'allow', true,  'reason', 'admin')
    );
  end if;

  -- ---------- التنفيذ ----------
  for r in select value as j from jsonb_array_elements(cases) loop
    c := r.j;
    reset role;
    perform set_config('request.jwt.claims', '', true);   -- بلا هوية متبقية من الحالة السابقة أثناء أعمال المالك

    if coalesce((c->>'nr')::boolean, false) then
      delete from public.site_settings where key = 'current_season';
    else
      insert into public.site_settings (key, value) values ('current_season', coalesce(c->>'s', v_season))
        on conflict (key) do update set value = excluded.value;
    end if;

    -- تغيير كلمة المرور فعليًا (hash جديد في auth.users) فيُسقط مشغّل 0027 العلم من الخادم
    if c->>'pw' = 'change' then
      update auth.users set encrypted_password = '$2a$10$__gsmoke_new_hash__' where id = (c->>'u')::uuid;
      if exists (select 1 from public.profiles where id = (c->>'u')::uuid and must_change_password) then
        raise exception 'FAIL: [%] علم must_change_password لم يُسقَط بعد تغيير كلمة المرور', c->>'l';
      end if;
    end if;

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
    if c->>'reason' = 'member' and got->>'season' is distinct from coalesce(c->>'s', v_season) then
      raise exception 'FAIL: [%] season في الاستجابة = %، المتوقع %', c->>'l', got->>'season', coalesce(c->>'s', v_season);
    end if;
  end loop;

  -- ---------- موسم حالي صالح: استعادة ----------
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into public.site_settings (key, value) values ('current_season', v_season)
    on conflict (key) do update set value = excluded.value;

  -- ---------- غير مسجّل الدخول: بلا هوية (authenticated بلا sub) ----------
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  if public.can_access_games() then raise exception 'FAIL: بلا هوية (auth.uid() null) يُسمح له'; end if;
  got := public.get_games_access();
  if got->>'reason' is distinct from 'unauthenticated' or (got->>'allowed')::boolean then
    raise exception 'FAIL: بلا هوية: get_games_access = %', got;
  end if;
  reset role;

  -- ---------- غير مسجّل الدخول: anon لا ينفّذ الدالتين ----------
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
  if mfa_ok then
    raise notice 'فحوص 0049 (بوّابة الألعاب: الأدوار الإدارية + كلمة المرور المؤقتة + العضو المنخرط + الرفض + MFA + غير المسجّل): كل الفحوص نجحت ✔ (% حالة)', jsonb_array_length(cases);
  else
    raise warning 'فحوص 0049: نجحت % حالة لكن فحوص MFA لم تُنفَّذ (تعذّر تجهيز عامل MFA) — النتيجة غير كاملة', jsonb_array_length(cases);
  end if;
end $$;

rollback;
