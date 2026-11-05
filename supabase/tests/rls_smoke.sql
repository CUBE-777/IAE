-- ============================================================
-- supabase/tests/rls_smoke.sql — فحص دخان لسياسات RLS والصلاحيات (للقراءة فقط، لا يترك أثرًا)
--
-- التشغيل: الصق الملف كاملًا في Supabase → SQL Editor (أو: psql "$DB_URL" -f supabase/tests/rls_smoke.sql).
-- يعمل داخل معاملة تُلغى (rollback) في النهاية، ولا يكتب شيئًا. أي فشل يرفع استثناءً يبدأ بـ FAIL: ويذكر السبب.
-- النجاح = رسالة NOTICE في النهاية. شغّله بعد كل migration أمنية جديدة وقبل كل نشر كبير.
--
-- ما يتحقق منه: الزائر (anon) لا يقرأ بيانات الأعضاء الشخصية، لا يدرج حالة 'approved'، لا يصل لجداول الإدارة
-- والتخزين الخاص ولا ينفّذ دوال الإدارة؛ ومستخدم موثّق بلا صف في profiles ليس مسؤولًا.
-- ============================================================
begin;

do $$
declare
  t      record;
  denied boolean;
  n      bigint;
  has_dir boolean;
begin
  -- تحضير (قبل التحويل إلى anon): عضوان تجريبيان لفحص موافقة الظهور (migration 0030) — يُلغيان مع الـ rollback
  has_dir := exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'members' and column_name = 'show_in_directory');
  if has_dir then
    insert into public.members (full_name, status, show_in_directory) values ('__smoke_hidden__', 'active', false);
    insert into public.members (full_name, status, show_in_directory) values ('__smoke_visible__', 'active', true);
  end if;

  -- ---------- (1) الزائر anon ----------
  set local role anon;

  -- (1.أ) عمليات يجب أن تُرفض بخطأ
  for t in
    select * from (values
      ('anon يقرأ members.email',                'select email from public.members limit 1'),
      ('anon يقرأ members.phone',                'select phone from public.members limit 1'),
      ('anon يقرأ members.age',                  'select age from public.members limit 1'),
      ('anon يدرج طلب انخراط بحالة approved',    $q$insert into public.membership_requests (full_name, email, phone, status) values ('x','smoke@example.com','0600000000','approved')$q$),
      ('anon يقرأ جدول throttle',                'select * from public.membership_request_throttle limit 1'),
      ('anon يستدعي approve_membership_request', 'select public.approve_membership_request(gen_random_uuid())'),
      ('anon يستدعي reject_membership_request',  $q$select public.reject_membership_request(gen_random_uuid(), 'x')$q$),
      ('anon يستدعي admin_active_members_count', 'select public.admin_active_members_count()'),
      ('anon يقرأ board_profile_links (0031)',     'select token_hash from public.board_profile_links limit 1'),
      ('anon يستدعي issue_board_profile_link',    'select public.issue_board_profile_link(gen_random_uuid())'),
      ('anon يستدعي approve_board_profile',       'select public.approve_board_profile(gen_random_uuid(), null)'),
      ('anon يستدعي return_board_profile',        'select public.return_board_profile(gen_random_uuid(), null)'),
      ('anon يستدعي دالة التنظيف الداخلية',        $q$select public._bp_clean('{}'::jsonb)$q$)
    ) as v(label, q)
  loop
    denied := false;
    begin
      execute t.q;
    exception when others then
      denied := true;
    end;
    if not denied then
      raise exception 'FAIL: % (لم تُرفض)', t.label;
    end if;
  end loop;

  -- (1.ب) جداول يجب ألا يرى منها الزائر أي صف (خطأ صلاحية أو صفر صفوف كلاهما مقبول)
  for t in
    select * from (values
      ('public.audit_logs'), ('public.profiles'), ('public.membership_requests'),
      ('public.membership_forms'), ('public.internal_files'), ('public.budget_transactions')
    ) as v(tbl)
  loop
    begin
      execute format('select count(*) from %s', t.tbl) into n;
      if n > 0 then
        raise exception 'FAIL: anon يرى % صفًا من %', n, t.tbl;
      end if;
    exception when insufficient_privilege or undefined_table then
      null; -- مرفوض (أو الجدول غير موجود في هذه النسخة): مقبول
    end;
  end loop;

  begin
    select count(*) into n from storage.objects where bucket_id = 'membership-docs';
    if n > 0 then
      raise exception 'FAIL: anon يرى % ملفًا في membership-docs', n;
    end if;
  exception when insufficient_privilege then
    null;
  end;

  -- (1.ج) mfa_satisfied (0024) مغلقة على anon إن كانت الهجرة مطبّقة
  if to_regprocedure('public.mfa_satisfied()') is not null then
    denied := false;
    begin
      perform public.mfa_satisfied();
    exception when insufficient_privilege then
      denied := true;
    end;
    if not denied then
      raise exception 'FAIL: anon يستطيع تنفيذ public.mfa_satisfied()';
    end if;
  else
    raise notice 'تخطّي فحص mfa_satisfied: migration 0024 غير مطبّقة';
  end if;

  -- (1.د) ما يجب أن يعمل: الأعمدة العامة للأعضاء
  perform full_name, photo_url, promotion, track from public.members limit 1;

  -- (1.هـ) موافقة الظهور: العضو غير الموافق لا يراه الزائر، والموافق يراه
  if has_dir then
    select count(*) into n from public.members where full_name = '__smoke_hidden__';
    if n > 0 then raise exception 'FAIL: anon يرى عضوًا لم يوافق على الظهور في الصفحة العامة'; end if;
    select count(*) into n from public.members where full_name = '__smoke_visible__';
    if n = 0 then raise exception 'FAIL: anon لا يرى عضوًا وافق على الظهور'; end if;
  else
    raise notice 'تخطّي فحص موافقة الظهور: migration 0030 غير مطبّقة';
  end if;

  -- ---------- (2) مستخدم موثّق بلا صف في profiles (ليس مسؤولًا) ----------
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-00000000dead","role":"authenticated","aal":"aal1"}', true);

  if public.is_admin() then raise exception 'FAIL: مستخدم بلا profile يُعدّ مسؤولًا'; end if;
  if public.can_manage_members() then raise exception 'FAIL: can_manage_members لمستخدم بلا profile'; end if;
  if public.can_manage_content() then raise exception 'FAIL: can_manage_content لمستخدم بلا profile'; end if;
  if public.can_manage_budget() then raise exception 'FAIL: can_manage_budget لمستخدم بلا profile'; end if;
  if public.is_super_admin() then raise exception 'FAIL: is_super_admin لمستخدم بلا profile'; end if;

  begin
    select count(*) into n from public.members;
    -- يُسمح بقراءة الأعمدة العامة فقط؛ القراءة الكاملة (email) يجب أن تعيد صفرًا لغير مسؤول
    select count(*) into n from public.members where email is not null;
    if n > 0 then raise exception 'FAIL: مستخدم بلا صلاحية يقرأ members.email'; end if;
  exception when insufficient_privilege then
    null;
  end;

  reset role;
  raise notice 'RLS smoke: كل الفحوص نجحت ✔';
end $$;

rollback;

-- ============================================================
-- (إلحاق — المرحلة 2) فحوص migration 0035: حسابات الأعضاء
-- معاملة مستقلة وتُلغى في النهاية؛ تُنشئ مستخدمين/أعضاء تجريبيين داخلها فقط. تُتخطّى بهدوء إن لم تُطبَّق 0035.
-- يتحقق من: الزائر لا يصل لشيء، المستخدم الموثّق بلا حساب عضو لا هوية له، العضو يرى صفه فقط ولا يكتب،
-- العضو ليس إداريًا، الحساب لا يُربط بمستخدم له profiles، الربط ثابت، والأدوار الأربعة فقط تدير النظام.
-- ============================================================
begin;

do $$
declare
  fx_ok     boolean := true;
  u1        uuid := gen_random_uuid();   -- حساب عضو 1
  u2        uuid := gen_random_uuid();   -- حساب عضو 2
  u_admin   uuid := gen_random_uuid();   -- مستخدم له profiles (يجب رفض ربطه بحساب عضو)
  u_late    uuid := gen_random_uuid();   -- حساب عضو ثم أُضيف له profiles لاحقًا (طبقة الدفاع الثانية)
  u_del     uuid := gen_random_uuid();   -- لاختبار عضو محذوف
  u_dead    uuid := '00000000-0000-0000-0000-00000000dead';  -- مستخدم موثّق بلا أي حساب
  m1 uuid; m2 uuid; m3 uuid; m4 uuid; m_del uuid;
  role_uids jsonb := '{}'::jsonb;
  r         record;
  v         uuid;
  n         bigint;
  b         boolean;
  denied    boolean;
  expected  boolean;
begin
  if to_regclass('public.member_accounts') is null then
    raise notice 'تخطّي فحوص 0035: member_accounts غير موجودة (لم تُطبَّق 0035)';
    return;
  end if;

  -- ---------- تجهيز (بصلاحية المالك، يُلغى مع rollback) ----------
  begin
    insert into auth.users (id, email) values
      (u1,      '__smoke_u1@example.invalid'),
      (u2,      '__smoke_u2@example.invalid'),
      (u_admin, '__smoke_admin@example.invalid'),
      (u_late,  '__smoke_late@example.invalid'),
      (u_del,   '__smoke_del@example.invalid');

    for r in select e::text as role from unnest(enum_range(null::admin_role)) as e loop
      v := gen_random_uuid();
      insert into auth.users (id, email) values (v, '__smoke_role_' || r.role || '@example.invalid');
      insert into public.profiles (id, full_name, email, role)
        values (v, '__smoke_' || r.role, '__smoke_role_' || r.role || '@example.invalid', r.role::admin_role);
      role_uids := role_uids || jsonb_build_object(r.role, v);
    end loop;

    insert into public.profiles (id, full_name, email, role)
      values (u_admin, '__smoke_admin', '__smoke_admin@example.invalid', 'editor');
  exception when others then
    fx_ok := false;
    raise notice 'تخطّي الفحوص التي تحتاج مستخدمين تجريبيين: تعذّر الإنشاء في auth.users (%)', sqlerrm;
  end;

  if fx_ok then
    insert into public.members (full_name, status) values ('__smoke_m1__', 'active') returning id into m1;
    insert into public.members (full_name, status) values ('__smoke_m2__', 'active') returning id into m2;
    insert into public.members (full_name, status) values ('__smoke_m3__', 'active') returning id into m3;
    insert into public.members (full_name, status) values ('__smoke_m4__', 'active') returning id into m4;
    insert into public.members (full_name, status, deleted_at) values ('__smoke_mdel__', 'active', now()) returning id into m_del;

    insert into public.member_accounts (user_id, member_id) values (u1, m1), (u2, m2), (u_late, m4);
    -- بعد إنشاء حساب العضو يُضاف لنفس المستخدم profiles (حالة يدوية شاذة) — يجب أن يتعطّل جانب العضو
    insert into public.profiles (id, full_name, email, role)
      values (u_late, '__smoke_late', '__smoke_late@example.invalid', 'editor');

    -- ---------- (أ) مشغّل الحماية (بصلاحية المالك) ----------
    begin
      insert into public.member_accounts (user_id, member_id) values (u_admin, m3);
      raise exception 'FAIL: سُمح بربط حساب عضو بمستخدم له profiles';
    exception when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlerrm <> 'member_account_forbidden_for_admin_user' then
        raise exception 'FAIL: سبب رفض غير متوقع لربط مستخدم إداري: %', sqlerrm;
      end if;
    end;

    begin
      insert into public.member_accounts (user_id, member_id) values (u_del, m_del);
      raise exception 'FAIL: سُمح بربط حساب بعضو محذوف';
    exception when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlerrm <> 'member_account_member_not_found' then
        raise exception 'FAIL: سبب رفض غير متوقع لعضو محذوف: %', sqlerrm;
      end if;
    end;

    begin
      update public.member_accounts set member_id = m3 where user_id = u1;
      raise exception 'FAIL: سُمح بتغيير الربط user_id/member_id';
    exception when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlerrm <> 'member_account_link_immutable' then
        raise exception 'FAIL: سبب رفض غير متوقع لتغيير الربط: %', sqlerrm;
      end if;
    end;

    begin
      insert into public.member_accounts (user_id, member_id) values (u_del, m1);
      raise exception 'FAIL: سُمح بعضوين لهما نفس member_id (يجب حساب واحد لكل عضو)';
    exception when unique_violation then
      null;
    end;
  end if;

  -- ---------- (ب) الزائر anon لا يصل لشيء ----------
  set local role anon;
  for r in
    select * from (values
      ('anon يقرأ member_accounts',                'select * from public.member_accounts limit 1'),
      ('anon يدرج في member_accounts',             $q$insert into public.member_accounts (user_id, member_id) values (gen_random_uuid(), gen_random_uuid())$q$),
      ('anon يستدعي current_member_id',            'select public.current_member_id()'),
      ('anon يستدعي can_manage_member_system',     'select public.can_manage_member_system()'),
      ('anon يستدعي مشغّل الحماية مباشرة',         'select public.member_accounts_guard()')
    ) as v(label, q)
  loop
    denied := false;
    begin
      execute r.q;
    exception when others then
      denied := true;
    end;
    if not denied then
      raise exception 'FAIL: % (لم تُرفض)', r.label;
    end if;
  end loop;
  reset role;

  -- ---------- (ج) مستخدم موثّق بلا أي حساب: لا هوية عضو ولا صلاحية ----------
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_dead, 'role', 'authenticated', 'aal', 'aal1')::text, true);

  if public.current_member_id() is not null then
    raise exception 'FAIL: مستخدم بلا حساب عضو له current_member_id';
  end if;
  if public.can_manage_member_system() then
    raise exception 'FAIL: can_manage_member_system لمستخدم بلا profile';
  end if;
  select count(*) into n from public.member_accounts;
  if n > 0 then raise exception 'FAIL: مستخدم بلا صلاحية يقرأ صفوفًا من member_accounts'; end if;
  reset role;

  if fx_ok then
    -- ---------- (د) العضو u1: صفّه فقط، بلا كتابة، وليس إداريًا ----------
    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', u1, 'role', 'authenticated', 'aal', 'aal1')::text, true);

    if public.current_member_id() is distinct from m1 then
      raise exception 'FAIL: current_member_id لا تعيد member_id الصحيح للعضو';
    end if;
    if public.is_admin() then raise exception 'FAIL: حساب العضو يُعدّ مسؤولًا (is_admin)'; end if;
    if public.can_manage_members() then raise exception 'FAIL: حساب العضو يملك can_manage_members'; end if;
    if public.can_manage_member_system() then raise exception 'FAIL: حساب العضو يملك can_manage_member_system'; end if;

    select count(*) into n from public.member_accounts;
    if n <> 1 then raise exception 'FAIL: العضو يرى % صفًّا في member_accounts (المتوقع صفّه فقط)', n; end if;
    select count(*) into n from public.member_accounts where member_id = m1;
    if n <> 1 then raise exception 'FAIL: العضو لا يرى صفّه'; end if;
    select count(*) into n from public.member_accounts where member_id = m2;
    if n <> 0 then raise exception 'FAIL: العضو يرى حساب عضو آخر'; end if;

    select count(*) into n from public.members;
    if n > 0 then raise exception 'FAIL: حساب العضو يقرأ جدول members مباشرة (% صفًّا)', n; end if;

    for r in
      select * from (values
        ('العضو يعدّل member_accounts',  'update public.member_accounts set is_active = false'),
        ('العضو يحذف من member_accounts', 'delete from public.member_accounts'),
        ('العضو يدرج في member_accounts', $q$insert into public.member_accounts (user_id, member_id) values (gen_random_uuid(), gen_random_uuid())$q$)
      ) as v(label, q)
    loop
      denied := false;
      begin
        execute r.q;
      exception when others then
        denied := true;
      end;
      if not denied then raise exception 'FAIL: % (لم تُرفض)', r.label; end if;
    end loop;
    reset role;

    -- ---------- (هـ) العضو u2 يرى صفّه هو لا صف u1 ----------
    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', u2, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    if public.current_member_id() is distinct from m2 then raise exception 'FAIL: هوية العضو الثاني خاطئة'; end if;
    select count(*) into n from public.member_accounts where member_id = m1;
    if n <> 0 then raise exception 'FAIL: العضو الثاني يرى حساب العضو الأول'; end if;
    reset role;

    -- ---------- (و) طبقة الدفاع: من له profiles لا هوية عضو له حتى لو بقي له صف في member_accounts ----------
    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', u_late, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    if public.current_member_id() is not null then
      raise exception 'FAIL: مستخدم له profiles ما زال يحمل هوية عضو (فصل الحسابين مكسور)';
    end if;
    reset role;

    -- ---------- (ز) مصفوفة الأدوار: الأربعة فقط تدير نظام الأعضاء ----------
    for r in select key as role, value #>> '{}' as uid from jsonb_each(role_uids) loop
      expected := r.role in ('super_admin', 'developer', 'secretary_general', 'members_manager');
      set local role authenticated;
      perform set_config('request.jwt.claims',
        json_build_object('sub', r.uid::uuid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
      b := public.can_manage_member_system();
      if b is distinct from expected then
        raise exception 'FAIL: can_manage_member_system للدور % = % (المتوقع %)', r.role, b, expected;
      end if;
      if public.current_member_id() is not null then
        raise exception 'FAIL: الدور الإداري % يحمل هوية عضو', r.role;
      end if;
      reset role;
    end loop;
  end if;

  reset role;
  raise notice 'فحوص 0035 (حسابات الأعضاء): كل الفحوص نجحت ✔';
end $$;

rollback;
