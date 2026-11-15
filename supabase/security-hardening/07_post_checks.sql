-- ============================================================
-- 07_post_checks.sql — Phase 6: اختبارات التحقق النهائي
-- للتشغيل في Supabase → SQL Editor بعد 02–06 (يصلح أيضًا قبلها لإظهار الثغرات: ستفشل الفحوص المقابلة بـ FAIL).
-- كل شيء داخل معاملة تُلغى (rollback) في النهاية: يُنشئ مستخدمين/أعضاء/ملفات تجريبية داخلها فقط ولا يترك أثرًا.
-- النجاح = ظهور رسالة NOTICE «PASS» لكل مجموعة. أي فشل يرفع استثناءً يبدأ بـ FAIL: ويذكر السبب (وتتوقف المعاملة).
-- يتخطّى بهدوء (NOTICE SKIP) ما لا يملك المستخدم الحالي صلاحية تجهيزه (مثل الكتابة في storage.objects).
-- المجموعات: A) حراسة الدوال (NULL)  B) تفوّق المطوّر  C) صور الأعضاء  D) audit_logs  E) صلاحيات EXECUTE والجداول
--             F) انحدار وظيفي (التدفقات الأساسية ما زالت تعمل).
-- ============================================================
begin;

-- ---------- تجهيز (بصلاحية المالك؛ auth.uid() = null فلا تعترض الـ triggers) ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', '__t_dev@example.invalid'),
  ('00000000-0000-0000-0000-00000000005a', '__t_sa1@example.invalid'),
  ('00000000-0000-0000-0000-00000000005b', '__t_sa2@example.invalid'),
  ('00000000-0000-0000-0000-0000000000e0', '__t_editor@example.invalid'),
  ('00000000-0000-0000-0000-0000000000e7', '__t_treasurer@example.invalid'),
  ('00000000-0000-0000-0000-0000000000a1', '__t_mm@example.invalid'),
  ('00000000-0000-0000-0000-0000000000c0', '__t_consultant@example.invalid'),
  ('00000000-0000-0000-0000-0000000000b0', '__t_plain@example.invalid');

insert into public.profiles (id, full_name, email, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'T Dev',        '__t_dev@example.invalid',        'developer'),
  ('00000000-0000-0000-0000-00000000005a', 'T SuperAdmin1','__t_sa1@example.invalid',        'super_admin'),
  ('00000000-0000-0000-0000-00000000005b', 'T SuperAdmin2','__t_sa2@example.invalid',        'super_admin'),
  ('00000000-0000-0000-0000-0000000000e0', 'T Editor',     '__t_editor@example.invalid',     'editor'),
  ('00000000-0000-0000-0000-0000000000e7', 'T Treasurer',  '__t_treasurer@example.invalid',  'treasurer'),
  ('00000000-0000-0000-0000-0000000000a1', 'T MembersMgr', '__t_mm@example.invalid',         'members_manager'),
  ('00000000-0000-0000-0000-0000000000c0', 'T Consultant', '__t_consultant@example.invalid', 'consultant');
-- (b0 = مستخدم موثّق بلا profiles: يمثّل منخرطًا فُعّل حسابه)


-- ============================================================
-- A) حراسة الدوال: مستخدم بلا دور إداري لا يمرّ من أي دالة إدارية
-- ============================================================
do $$
declare
  r        record;
  v_args   text;
  t        text;
  i        int;
  v_msg    text;
  v_leaks  text[] := '{}';
  v_checked int := 0;
  -- دوال خدمة ذاتية مشروعة لمنخرط/مستخدم موثّق (يُسمح أن تنجح أو تفشل لأسباب أخرى غير «غير مصرّح»)
  v_self   text[] := array[
    'current_member_id','get_my_member','get_my_membership_status','get_my_board_card','submit_my_board_card',
    'cancel_my_board_card_request','cancel_my_member_card_request','submit_member_card_request','update_my_member_private',
    'get_my_attendance_cards','record_attendance','issue_member_card_token','regenerate_member_card_token',
    'member_card_photo_upload_allowed','board_member_photo_readable','get_games_access','get_my_game_summary',
    'admin_active_members_count'   -- ترجع null لغير المسؤول (case when is_admin) — سليمة
  ];
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000b0', 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- A1: الدوال المساعدة تُرجع false صريحة (وليس NULL)
  if public.is_admin()                     is distinct from false then raise exception 'FAIL A1: is_admin لغير مسؤول ليست false'; end if;
  if public.is_super_admin()               is distinct from false then raise exception 'FAIL A1: is_super_admin ليست false (NULL؟)'; end if;
  if public.is_developer()                 is distinct from false then raise exception 'FAIL A1: is_developer ليست false (NULL؟)'; end if;
  if public.can_manage_members()           is distinct from false then raise exception 'FAIL A1: can_manage_members ليست false (NULL؟)'; end if;
  if public.can_manage_content()           is distinct from false then raise exception 'FAIL A1: can_manage_content ليست false (NULL؟)'; end if;
  if public.can_manage_budget()            is distinct from false then raise exception 'FAIL A1: can_manage_budget ليست false (NULL؟)'; end if;
  if public.can_handle_membership()        is distinct from false then raise exception 'FAIL A1: can_handle_membership ليست false (NULL؟)'; end if;
  if public.can_access_internal_files()    is distinct from false then raise exception 'FAIL A1: can_access_internal_files ليست false (NULL؟)'; end if;
  if public.can_delete_internal_files()    is distinct from false then raise exception 'FAIL A1: can_delete_internal_files ليست false (NULL؟)'; end if;
  if public.can_manage_projects()          is distinct from false then raise exception 'FAIL A1: can_manage_projects ليست false (NULL؟)'; end if;
  if public.can_read_internal_files()      is distinct from false then raise exception 'FAIL A1: can_read_internal_files ليست false (NULL؟)'; end if;
  if public.can_manage_member_system()     is distinct from false then raise exception 'FAIL A1: can_manage_member_system ليست false'; end if;
  if public.can_link_admin_member()        is distinct from false then raise exception 'FAIL A1: can_link_admin_member ليست false'; end if;

  -- A2: لكل دالة قابلة للتنفيذ من authenticated وليست من anon (أي ليست عامة عمدًا) وليست trigger وليست دالة صلاحية مساعدة:
  --     استدعاؤها بوسائط وهمية كمستخدم بلا دور يجب أن يرفض بخطأ «غير مصرّح/denied». أي تنفيذ ناجح أو رفض لسبب آخر
  --     (مثل «الطلب غير موجود») يعني أن الحراسة تجاوزتها → تسريب.
  for r in
    select p.oid, p.proname, p.pronargs, p.proargtypes::oid[] as ats
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
       and has_function_privilege('authenticated', p.oid, 'execute')
       and not has_function_privilege('anon', p.oid, 'execute')
       and p.proname not like 'can\_%' and p.proname not like 'is\_%'
       and p.proname <> all (v_self)
     order by p.proname
  loop
    v_args := '';
    for i in 1 .. r.pronargs loop
      t := format_type(r.ats[i - 1], null);
      v_args := v_args || case when i > 1 then ',' else '' end ||
        case t when 'uuid' then quote_literal(gen_random_uuid()::text) || '::uuid'
               when 'text' then '''x'''
               when 'jsonb' then '''{}''::jsonb'
               when 'integer' then '1' when 'bigint' then '1' when 'smallint' then '1'
               when 'boolean' then 'false'
               when 'uuid[]' then '''{}''::uuid[]'
               when 'text[]' then '''{}''::text[]'
               when 'timestamp with time zone' then 'now()'
               when 'date' then 'current_date'
               when 'numeric' then '1'
               else 'null' end;
    end loop;
    v_checked := v_checked + 1;
    begin
      execute format('select public.%I(%s)', r.proname, v_args);
      v_leaks := v_leaks || (r.proname || ' (نجحت)');
    exception when others then
      get stacked diagnostics v_msg = message_text;
      if v_msg !~* 'مصر|غير مسموح|games_access_denied|not authorized|permission denied|forbidden|_denied|_protected' then
        v_leaks := v_leaks || (r.proname || ' (' || left(v_msg, 60) || ')');
      end if;
    end;
  end loop;

  reset role;
  if array_length(v_leaks, 1) > 0 then
    raise exception 'FAIL A2: % دالة تجاوزت الحراسة لمستخدم بلا دور إداري: %', array_length(v_leaks, 1), array_to_string(v_leaks, ' | ');
  end if;
  raise notice 'PASS A: حراسة الدوال سليمة (% دالة فُحصت)', v_checked;
end $$;


-- ============================================================
-- B) تفوّق المطوّر: super_admin لا يمسّ حسابات super_admin ولا developer
-- ============================================================
do $$
declare
  n int;
  ok boolean;
begin
  -- B1: super_admin (sa1)
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000005a', 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- يستطيع إدارة الأدوار الأخرى كما كان
  update public.profiles set full_name = 'T Editor X' where id = '00000000-0000-0000-0000-0000000000e0';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL B1: super_admin لم يستطع تعديل حساب editor (انحدار)'; end if;
  update public.profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000c0';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL B1: super_admin لم يستطع تعطيل حساب consultant (انحدار)'; end if;
  update public.profiles set is_active = true where id = '00000000-0000-0000-0000-0000000000c0';
  insert into public.profiles (id, full_name, email, role)
    values ('00000000-0000-0000-0000-0000000000b0', 'T New Editor', '__t_plain@example.invalid', 'editor');
  delete from public.profiles where id = '00000000-0000-0000-0000-0000000000b0';

  -- يعدّل بيانات حسابه هو (دون الدور/التفعيل)
  update public.profiles set full_name = 'T SuperAdmin1 renamed' where id = '00000000-0000-0000-0000-00000000005a';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL B1: super_admin لم يستطع تعديل اسمه هو'; end if;

  -- لا يمسّ مسؤولًا أعلى آخر
  ok := false;
  begin update public.profiles set is_active = false where id = '00000000-0000-0000-0000-00000000005b';
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL B2: super_admin عطّل super_admin آخر'; end if;

  ok := false;
  begin update public.profiles set role = 'editor' where id = '00000000-0000-0000-0000-00000000005b';
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL B2: super_admin سحب صلاحية super_admin آخر'; end if;

  ok := false;
  begin delete from public.profiles where id = '00000000-0000-0000-0000-00000000005b';
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL B2: super_admin حذف super_admin آخر'; end if;

  ok := false;
  begin update public.profiles set role = 'editor' where id = '00000000-0000-0000-0000-00000000005a';
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL B2: super_admin غيّر دور نفسه'; end if;

  ok := false;
  begin update public.profiles set is_active = false where id = '00000000-0000-0000-0000-00000000005a';
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL B2: super_admin عطّل نفسه'; end if;

  ok := false;
  begin update public.profiles set role = 'super_admin' where id = '00000000-0000-0000-0000-0000000000e0';
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL B2: super_admin رقّى مستخدمًا إلى super_admin'; end if;

  ok := false;
  begin insert into public.profiles (id, full_name, email, role)
        values ('00000000-0000-0000-0000-0000000000b0', 'T x', '__t_plain@example.invalid', 'super_admin');
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL B2: super_admin أنشأ حساب super_admin'; end if;

  -- لا يمسّ المطوّر
  ok := false;
  begin update public.profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000d1';
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL B3: super_admin عطّل مطوّرًا'; end if;

  ok := false;
  begin update public.profiles set role = 'editor' where id = '00000000-0000-0000-0000-0000000000d1';
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL B3: super_admin سحب صلاحية مطوّر'; end if;

  ok := false;
  begin delete from public.profiles where id = '00000000-0000-0000-0000-0000000000d1';
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL B3: super_admin حذف مطوّرًا'; end if;

  -- B4: المطوّر يملك كل شيء
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000d1', 'role', 'authenticated')::text, true);
  set local role authenticated;

  update public.profiles set role = 'editor' where id = '00000000-0000-0000-0000-00000000005b';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL B4: المطوّر لم يستطع سحب صلاحية super_admin'; end if;
  update public.profiles set role = 'super_admin' where id = '00000000-0000-0000-0000-00000000005b';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL B4: المطوّر لم يستطع منح صلاحية super_admin'; end if;
  update public.profiles set is_active = false where id = '00000000-0000-0000-0000-00000000005b';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL B4: المطوّر لم يستطع تعطيل super_admin'; end if;

  -- B5: الأدوار الأخرى لا تدير profiles إطلاقًا (لم يتغيّر)
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000e0', 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.profiles set full_name = 'hack' where id = '00000000-0000-0000-0000-0000000000e7';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL B5: editor عدّل profiles'; end if;

  reset role;
  raise notice 'PASS B: تفوّق المطوّر محفوظ، وsuper_admin لا يمسّ super_admin/developer، وبقية الأدوار كما كانت';
end $$;

-- B6: الجانب «المنخرط» لحساب المطوّر المزدوج
do $$
declare
  v_member uuid;
  ok boolean;
begin
  if to_regclass('public.member_accounts') is null or to_regprocedure('public.unlink_admin_as_member(uuid)') is null then
    raise notice 'SKIP B6: نظام الحسابات المزدوجة غير موجود';
    return;
  end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into public.members (full_name, email, status) values ('T DevMember', '__t_dev@example.invalid', 'active') returning id into v_member;
  insert into public.member_accounts (user_id, member_id, admin_linked) values ('00000000-0000-0000-0000-0000000000d1', v_member, true);

  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000005a', 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.unlink_admin_as_member('00000000-0000-0000-0000-0000000000d1');
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL B6: super_admin عطّل جانب المنخرط لحساب مطوّر'; end if;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000d1', 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.unlink_admin_as_member('00000000-0000-0000-0000-0000000000d1');   -- المطوّر نفسه ينجح
  reset role;
  raise notice 'PASS B6: جانب المنخرط لحساب المطوّر محمي من super_admin';
end $$;


-- ============================================================
-- C) صور الأعضاء في association-media: لا سرد لصور غير الظاهرين
-- ============================================================
do $$
declare
  n int;
  base text := 'https://x.supabase.co/storage/v1/object/public/association-media/';
begin
  perform set_config('request.jwt.claims', '', true);
  begin
    insert into storage.buckets (id, name, public) values ('association-media', 'association-media', true) on conflict (id) do nothing;
    insert into public.members (full_name, status, show_in_directory, photo_url) values
      ('T Visible', 'active', true,  base || 'members/t-visible.jpg'),
      ('T Hidden',  'active', false, base || 'members/t-hidden.jpg'),
      ('T Deleted', 'active', true,  base || 'members/t-deleted.jpg');
    update public.members set deleted_at = now() where full_name = 'T Deleted';
    insert into storage.objects (bucket_id, name) values
      ('association-media', 'members/t-visible.jpg'),
      ('association-media', 'members/t-hidden.jpg'),
      ('association-media', 'members/t-deleted.jpg'),
      ('association-media', 'members/t-orphan.jpg'),
      ('association-media', 'gallery/t-gallery.jpg'),
      ('association-media', 'board/t-board.jpg'),
      ('association-media', 'projects/t-project.jpg');
  exception when insufficient_privilege then
    raise notice 'SKIP C: لا صلاحية لتجهيز storage.objects بهذا المستخدم';
    return;
  end;

  set local role anon;
  select count(*) into n from storage.objects where bucket_id = 'association-media' and name in ('members/t-hidden.jpg','members/t-deleted.jpg','members/t-orphan.jpg');
  if n <> 0 then raise exception 'FAIL C1: anon يسرد % صورة عضو غير ظاهر/محذوف/يتيم', n; end if;
  select count(*) into n from storage.objects where bucket_id = 'association-media' and name in ('members/t-visible.jpg','gallery/t-gallery.jpg','board/t-board.jpg','projects/t-project.jpg');
  if n <> 4 then raise exception 'FAIL C2: anon لا يرى كل الملفات العامة المقصودة (% من 4)', n; end if;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000e0', 'role', 'authenticated')::text, true);
  set local role authenticated;   -- editor (يدير المحتوى)
  select count(*) into n from storage.objects where bucket_id = 'association-media' and name like '%t-%';
  if n <> 7 then raise exception 'FAIL C3: editor لا يرى كل الملفات (% من 7) — سيتعطل الحذف/الاستبدال', n; end if;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000e7', 'role', 'authenticated')::text, true);
  set local role authenticated;   -- treasurer: لا يرفع صورًا، ولا يرى غير المنشور
  select count(*) into n from storage.objects where bucket_id = 'association-media' and name in ('members/t-hidden.jpg','members/t-deleted.jpg','members/t-orphan.jpg');
  if n <> 0 then raise exception 'FAIL C4: treasurer يسرد صور أعضاء غير ظاهرين'; end if;

  reset role;
  raise notice 'PASS C: سرد association-media مقيّد بالأعضاء الظاهرين، والمحتوى العام والطاقم كما كانوا';
end $$;


-- ============================================================
-- D) audit_logs: الحذف للمطوّر وحده
-- ============================================================
do $$
declare
  n int;
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into public.audit_logs (user_id, action, entity_type, description) values
    (null, 'ADMIN_T_TEST_1', 'members', 't1'), (null, 'ADMIN_T_TEST_2', 'members', 't2');

  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000005a', 'role', 'authenticated')::text, true);
  set local role authenticated;   -- super_admin
  delete from public.audit_logs where action = 'ADMIN_T_TEST_1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL D1: super_admin حذف سجل تدقيق'; end if;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000d1', 'role', 'authenticated')::text, true);
  set local role authenticated;   -- developer
  delete from public.audit_logs where action = 'ADMIN_T_TEST_1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL D2: المطوّر لم يستطع حذف سجل تدقيق'; end if;

  -- القراءة للمسؤولين كما كانت (لوحة المعلومات تعرض آخر العمليات لكل دور)
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000e7', 'role', 'authenticated')::text, true);
  set local role authenticated;   -- treasurer
  select count(*) into n from public.audit_logs where action = 'ADMIN_T_TEST_2';
  if n <> 1 then raise exception 'FAIL D3: treasurer لم يعد يقرأ audit_logs (انحدار)'; end if;
  select count(*) into n from public.audit_logs;   -- مستشار لا يقرأ (0032)
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000c0', 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.audit_logs;
  if n <> 0 then raise exception 'FAIL D4: consultant يقرأ audit_logs'; end if;

  reset role;
  raise notice 'PASS D: حذف audit_logs للمطوّر وحده، والقراءة كما كانت';
end $$;


-- ============================================================
-- E) صلاحيات EXECUTE والجداول والـ buckets
-- ============================================================
do $$
declare
  r      record;
  n      int;
  v_allow text[] := array[
    'get_member_activation_link','get_invitation','respond_invitation','get_board_profile_link','get_membership_form',
    'submit_membership_form','submit_board_profile','verify_member_card','request_member_access_help',
    'board_photo_upload_allowed','membership_upload_allowed',
    'current_admin_role','is_admin','is_super_admin','can_manage_content','can_manage_members',
    'association_media_object_public'
  ];
begin
  reset role;
  -- E1: دوال SECURITY DEFINER التي ينفّذها anon = القائمة المعتمدة فقط
  for r in
    select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute') and p.proname <> all (v_allow)
  loop
    raise exception 'FAIL E1: % قابلة للتنفيذ من anon وليست في القائمة المعتمدة', r.sig;
  end loop;

  -- E2: كل دوال SECURITY DEFINER تثبّت search_path
  for r in
    select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    raise exception 'FAIL E2: % بلا search_path ثابت', r.sig;
  end loop;

  -- E3: دوال الـ trigger ليست قابلة للتنفيذ من أدوار العميل (المشغّلات القديمة بلا revoke عولجت في 04)
  for r in
    select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prorettype = 'trigger'::regtype and p.proname not in ('set_updated_at')
       and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
  loop
    raise exception 'FAIL E3: دالة trigger % قابلة للتنفيذ من anon/authenticated', r.sig;
  end loop;

  -- E4: كل جداول public عليها RLS
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity;
  if n > 0 then raise exception 'FAIL E4: % جدول في public بلا RLS', n; end if;

  -- E5: لا TRUNCATE/REFERENCES/TRIGGER لأدوار العميل
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon','authenticated') and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER');
  if n > 0 then raise exception 'FAIL E5: % منحة TRUNCATE/REFERENCES/TRIGGER لأدوار العميل', n; end if;

  -- E6: buckets الداخلية خاصة، وassociation-media عام (مقصود)
  if exists (select 1 from storage.buckets where id in ('membership-docs','budget-receipts','internal-files') and public) then
    raise exception 'FAIL E6: bucket داخلي عام';
  end if;

  -- E7: الجداول المغلقة لا يقرؤها anon (لا نقرأ شيئًا: فحص صلاحيات فقط)
  for r in select unnest(array['member_card_tokens','member_card_secret','member_activation_links','membership_throttle_secret',
                               'activity_invitations','membership_forms','board_profile_links','member_private']) as t
  loop
    if to_regclass('public.' || r.t) is not null and has_table_privilege('anon', 'public.' || r.t, 'select') then
      raise exception 'FAIL E7: anon يملك SELECT على %', r.t;
    end if;
  end loop;

  -- E8: anon لا يقرأ أعمدة الأعضاء الحساسة
  if has_column_privilege('anon', 'public.members', 'email', 'select')
     or has_column_privilege('anon', 'public.members', 'phone', 'select')
     or has_column_privilege('anon', 'public.members', 'city', 'select') then
    raise exception 'FAIL E8: anon يملك SELECT على أعمدة members الحساسة';
  end if;

  raise notice 'PASS E: صلاحيات الدوال والجداول والـ buckets سليمة';
end $$;


-- ============================================================
-- F) انحدار وظيفي: التدفقات الأساسية ما زالت تعمل بعد التعديلات
-- ============================================================
do $$
declare
  v_cat uuid;
  v_form jsonb;
  n int;
  v_req uuid;
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into public.budget_categories (name, kind) values ('T cat', 'both') returning id into v_cat;
  insert into public.membership_requests (full_name, email, phone) values ('T Req', '__t_req@example.invalid', '0600000000') returning id into v_req;

  -- F1: الزائر يرسل طلب انخراط (منح أعمدة) ويتحقق من بطاقة/دعوة غير صالحة دون خطأ
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  insert into public.membership_requests (full_name, email, phone) values ('T Anon', '__t_anon@example.invalid', '0600000001');
  if (public.verify_member_card('x') ->> 'valid') <> 'false' then raise exception 'FAIL F1: verify_member_card'; end if;
  if public.get_invitation('x') is not null then raise exception 'FAIL F1: get_invitation'; end if;
  if (public.get_membership_form('x') ->> 'state') <> 'invalid' then raise exception 'FAIL F1: get_membership_form'; end if;
  if (public.get_board_profile_link('x') ->> 'state') <> 'invalid' then raise exception 'FAIL F1: get_board_profile_link'; end if;
  if (public.get_member_activation_link('x') ->> 'valid') <> 'false' then raise exception 'FAIL F1: get_member_activation_link'; end if;
  perform count(*) from public.members;            -- أعمدة عامة فقط
  perform id, full_name, photo_url from public.members limit 1;

  -- F2: أمين المال يسجّل معاملة (triggers التدقيق/الحارس بعد سحب EXECUTE منها)
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000e7', 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.budget_transactions (tx_date, kind, amount, category_id, created_by)
    values (current_date, 'income', 10, v_cat, '00000000-0000-0000-0000-0000000000e7');
  update public.budget_transactions set description = 'x' where category_id = v_cat;
  select count(*) into n from public.budget_transactions where category_id = v_cat;
  if n <> 1 then raise exception 'FAIL F2: أمين المال لا يرى معاملته'; end if;

  -- F3: المحرر ينشر إعلانًا (trigger announcements_before_write)
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000e0', 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.announcements (text, title) values ('t', 't');
  select count(*) into n from public.announcements where title = 't';
  if n <> 1 then raise exception 'FAIL F3: المحرر لا يرى إعلانه'; end if;

  -- F4: مسؤول الأعضاء يقرأ/يعدّل الأعضاء ويرى الطلبات ويصدر رابط النموذج
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.members where full_name like 'T %';
  if n < 1 then raise exception 'FAIL F4: members_manager لا يقرأ الأعضاء'; end if;
  select count(*) into n from public.membership_requests where id = v_req;
  if n <> 1 then raise exception 'FAIL F4: members_manager لا يرى الطلبات'; end if;
  v_form := public.issue_membership_form(v_req);
  if v_form ->> 'token' is null then raise exception 'FAIL F4: issue_membership_form'; end if;

  -- F5: مسؤول أعلى ومطوّر يقرآن profiles ويُصدران رابط نموذج؛ مستشار يقرأ المشاريع فقط عبر is_admin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000005a', 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.profiles;
  if n < 7 then raise exception 'FAIL F5: super_admin لا يقرأ كل profiles (% )', n; end if;
  if public.is_super_admin() is not true then raise exception 'FAIL F5: is_super_admin للمسؤول الأعلى'; end if;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000d1', 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.is_super_admin() is not true or public.is_developer() is not true then raise exception 'FAIL F5: المطوّر'; end if;
  if not (public.can_manage_budget() and public.can_manage_content() and public.can_manage_members()
          and public.can_handle_membership() and public.can_access_internal_files()
          and public.can_delete_internal_files() and public.can_manage_projects() and public.can_read_internal_files()) then
    raise exception 'FAIL F5: المطوّر فقد صلاحية (انحدار)';
  end if;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000c0', 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not (public.can_manage_projects() and public.can_read_internal_files()) or public.can_manage_content() or public.can_manage_members()
     or public.can_manage_budget() or public.is_super_admin() or public.can_access_internal_files() then
    raise exception 'FAIL F5: صلاحيات المستشار تغيّرت';
  end if;

  reset role;
  raise notice 'PASS F: التدفقات الأساسية تعمل';
end $$;

rollback;   -- لا أثر دائم
