-- ============================================================
-- 01_pre_checks.sql — فحوصات ما قبل الإصلاح (للقراءة فقط؛ لا تغيّر شيئًا)
-- شغّل كل قسم في Supabase → SQL Editor وراجع النتائج قبل تنفيذ 02–06. احفظ مخرجات 1.1 و5.4 (للتراجع الدقيق).
-- الاستعلامات لا تُظهر رموزًا ولا بريدًا ولا هواتف: معرّفات وأعداد ومسارات ملفات فقط.
-- ============================================================

-- ############ Phase 1: الأدوار ############

-- 1.0 هل يوجد مطوّر نشط؟ (شرط تنفيذ 02 الجزء 1-ب) — يجب أن يكون العدد ≥ 1
select count(*) as active_developers from public.profiles where role::text = 'developer' and is_active;

-- 1.1 عدد الحسابات لكل دور
select role::text as role, is_active, count(*) from public.profiles group by 1, 2 order by 1, 2;

-- 1.2 تعريفات دوال الحراسة الحالية: ابحث عن «coalesce» — غيابها يعني أنها تُرجع NULL لغير المسؤول (ثغرة 1-أ)
select p.proname,
       pg_get_function_result(p.oid) as returns,
       position('coalesce' in lower(pg_get_functiondef(p.oid))) > 0 as already_null_safe
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('is_super_admin','is_developer','is_admin','can_manage_members','can_manage_content','can_manage_budget',
                     'can_handle_membership','can_access_internal_files','can_delete_internal_files','can_manage_projects',
                     'can_read_internal_files','can_manage_member_system','can_link_admin_member','can_manage_games')
 order by 1;

-- 1.3 سياسات وtriggers جدول profiles وحسابات المنخرطين
select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'profiles' order by cmd, policyname;
select event_object_table as tbl, trigger_name, event_manipulation as ev, action_timing as timing
  from information_schema.triggers
 where trigger_schema = 'public' and event_object_table in ('profiles', 'member_accounts')
 order by 1, 2, 3;

-- 1.4 حسابات super_admin الحالية (من يمكنه اليوم تعديل بعضهم بعضًا) — معرّفات فقط
select id, is_active, created_at from public.profiles where role::text = 'super_admin' order by created_at;

-- 1.5 حسابات مزدوجة (إداري + منخرط) لمطوّرين/مسؤولين عليا
select p.role::text as role, count(*) as dual_accounts
  from public.member_accounts a join public.profiles p on p.id = a.user_id
 group by 1 order by 1;


-- ############ Phase 2: صور الأعضاء ############

-- 2.1 الـ buckets وسياساتها
select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id;
select policyname, cmd, roles, qual from pg_policies where schemaname = 'storage' and tablename = 'objects' order by policyname;

-- 2.2 عدد ملفات association-media حسب المجلد
select split_part(name, '/', 1) as folder, count(*) from storage.objects where bucket_id = 'association-media' group by 1 order by 2 desc;

-- 2.3 أعضاء لهم صورة لكنهم غير ظاهرين للعامة (الصورة ما زالت متاحة عبر رابطها العام) — معرّف/حالة/مسار فقط
select m.id, m.status::text as status, m.show_in_directory, m.deleted_at is not null as soft_deleted,
       regexp_replace(m.photo_url, '^.*/object/public/association-media/', '') as storage_path
  from public.members m
 where m.photo_url is not null
   and (m.show_in_directory is not true or m.status <> 'active' or m.deleted_at is not null)
 order by m.deleted_at nulls first, m.id;

-- 2.4 ملخص 2.3
select count(*) filter (where show_in_directory is not true) as hidden_by_choice,
       count(*) filter (where deleted_at is not null)         as soft_deleted,
       count(*) filter (where status <> 'active')             as not_active
  from public.members where photo_url is not null;

-- 2.5 ملفات members/ في التخزين غير المرتبطة بعضو ظاهر ولا بعضو مكتب نشط (هي المرشّحة للمعالجة اليدوية؛ لا تُحذف تلقائيًا)
select o.name, o.created_at
  from storage.objects o
 where o.bucket_id = 'association-media' and o.name like 'members/%'
   and not exists (select 1 from public.members m
                    where m.photo_url is not null and m.status = 'active' and m.deleted_at is null and m.show_in_directory is true
                      and right(m.photo_url, char_length(o.name) + 1) = '/' || o.name)
   and not exists (select 1 from public.board_members b
                    where b.photo_url is not null and b.is_active is true
                      and right(b.photo_url, char_length(o.name) + 1) = '/' || o.name)
 order by o.created_at;


-- ############ Phase 3: دوال SECURITY DEFINER ############

-- 3.1 دوال SECURITY DEFINER التي ينفّذها anon فعليًا (EXECUTE مباشر أو عبر PUBLIC)
select p.oid::regprocedure::text as function, p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'execute')          as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
 order by 1;

-- 3.2 دوال SECURITY DEFINER بلا search_path ثابت — المتوقع: صفر صفوف
select p.oid::regprocedure::text as function
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
   and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');

-- 3.3 دوال trigger القابلة للتنفيذ من أدوار العميل
select p.oid::regprocedure::text as function,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
   and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
 order by 1;

-- 3.4 دوال تنفّذها authenticated (وليس anon): هي ما يجب أن تحميه حراسة داخلية صحيحة (1-أ)
select count(*) as authenticated_only_functions
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
   and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute');


-- ############ Phase 4: الرموز (أعداد فقط) ############
select 'membership_forms' as tbl, count(*) as total, count(*) filter (where submitted_at is not null) as used,
       count(*) filter (where submitted_at is null and expires_at < now()) as expired_unused from public.membership_forms
union all select 'board_profile_links', count(*), count(*) filter (where status = 'approved'),
       count(*) filter (where status <> 'approved' and expires_at < now()) from public.board_profile_links
union all select 'member_activation_links', count(*), count(*) filter (where used_at is not null),
       count(*) filter (where used_at is null and expires_at < now()) from public.member_activation_links
union all select 'activity_invitations', count(*), count(*) filter (where revoked_at is not null), 0 from public.activity_invitations
union all select 'member_card_tokens', count(*), 0, 0 from public.member_card_tokens;


-- ############ Phase 5: RLS وStorage ############

-- 5.1 جداول public بلا RLS — المتوقع: صفر صفوف
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity order by 1;

-- 5.2 سياسة حذف audit_logs الحالية
select policyname, cmd, roles, qual from pg_policies where schemaname = 'public' and tablename = 'audit_logs' order by cmd;

-- 5.3 جداول عليها TRUNCATE/REFERENCES/TRIGGER لأدوار العميل
select grantee, privilege_type, count(*) as tables
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon','authenticated') and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER')
 group by 1, 2 order by 1, 2;

-- 5.4 لقطة كاملة لمنح الجداول الحالية (احفظها: تُستعمل للتراجع الدقيق عن 6.2)
select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type) as privileges
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon','authenticated')
 group by 1, 2 order by 2, 1;

-- 5.5 جداول يقرؤها anon (مع RLS يحدّد الصفوف): راجع أنها المحتوى العام فقط
select table_name, string_agg(privilege_type, ',') as anon_privileges
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'anon' and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
 group by 1 order by 1;
