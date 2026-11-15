-- ============================================================
-- 08_rollback.sql — خطوات التراجع (كل مرحلة مستقلة؛ نفّذ القسم المطلوب فقط)
-- تذكير: ROLLBACK لا يلغي معاملة نُفّذ COMMIT لها. هذا الملف يعيد الحالة السابقة بتنفيذ عكسي صريح.
-- ⚠️ أي تراجع عن Phase 1-أ يعيد ثغرة تجاوز الحراسة (NULL) — لا تفعله إلا مؤقتًا لتشخيص مشكلة وظيفية، ثم أعد 02.
-- لا يوجد في أي مرحلة حذف بيانات، لذلك التراجع لا يفقد شيئًا.
-- ============================================================


-- ============================================================
-- Phase 1-ب: إزالة حماية super_admin وحماية الجانب «المنخرط» للمطوّر
-- ============================================================
-- begin;
-- drop trigger if exists trg_protect_super_admin_profiles on public.profiles;
-- drop function if exists public.protect_super_admin_profiles();
-- drop trigger if exists trg_member_accounts_protect_developer on public.member_accounts;
-- drop function if exists public.protect_developer_member_accounts();
-- commit;


-- ============================================================
-- Phase 1-أ: إعادة الدوال المساعدة إلى تعريفاتها الأصلية (تُرجع NULL لغير المسؤول)  ← يعيد الثغرة
-- القوائم مطابقة لـ 0012 / 0019 / 0032.
-- ============================================================
-- begin;
-- create or replace function public.is_super_admin() returns boolean language sql security definer stable set search_path = public, pg_temp
--   as $$ select public.current_admin_role()::text in ('super_admin','developer'); $$;
-- create or replace function public.is_developer() returns boolean language sql security definer stable set search_path = public, pg_temp
--   as $$ select public.current_admin_role()::text = 'developer'; $$;
-- create or replace function public.can_manage_members() returns boolean language sql security definer stable set search_path = public, pg_temp
--   as $$ select public.current_admin_role()::text in ('super_admin','developer','members_manager','secretary_general','deputy_secretary_general','deputy_super_admin'); $$;
-- create or replace function public.can_manage_content() returns boolean language sql security definer stable set search_path = public, pg_temp
--   as $$ select public.current_admin_role()::text in ('super_admin','developer','editor','secretary_general','deputy_secretary_general','deputy_super_admin'); $$;
-- create or replace function public.can_manage_budget() returns boolean language sql security definer stable set search_path = public, pg_temp
--   as $$ select public.current_admin_role()::text in ('super_admin','developer','treasurer','deputy_treasurer','deputy_super_admin'); $$;
-- create or replace function public.can_handle_membership() returns boolean language sql security definer stable set search_path = public, pg_temp
--   as $$ select public.current_admin_role()::text in ('super_admin','developer','members_manager','treasurer','secretary_general','deputy_secretary_general','deputy_treasurer','deputy_super_admin'); $$;
-- create or replace function public.can_access_internal_files() returns boolean language sql security definer stable set search_path = public, pg_temp
--   as $$ select public.current_admin_role()::text in ('developer','super_admin','editor','members_manager','secretary_general','deputy_secretary_general','deputy_super_admin'); $$;
-- create or replace function public.can_delete_internal_files() returns boolean language sql security definer stable set search_path = public, pg_temp
--   as $$ select public.current_admin_role()::text in ('developer','super_admin','deputy_super_admin','secretary_general'); $$;
-- create or replace function public.can_manage_projects() returns boolean language sql security definer stable set search_path = public, pg_temp
--   as $$ select public.current_admin_role()::text in ('super_admin','developer','editor','secretary_general','deputy_secretary_general','deputy_super_admin','consultant'); $$;
-- create or replace function public.can_read_internal_files() returns boolean language sql security definer stable set search_path = public, pg_temp
--   as $$ select public.current_admin_role()::text in ('developer','super_admin','editor','members_manager','secretary_general','deputy_secretary_general','deputy_super_admin','consultant'); $$;
-- commit;


-- ============================================================
-- Phase 2: إعادة سياسة القراءة العامة الأصلية لـ association-media
-- ============================================================
-- begin;
-- drop policy if exists "association_media_public_read" on storage.objects;
-- create policy "association_media_public_read"
--   on storage.objects for select
--   using (bucket_id = 'association-media');
-- drop policy if exists "association_media_staff_read" on storage.objects;
-- drop function if exists public.association_media_object_public(text);
-- commit;


-- ============================================================
-- Phase 3: إعادة EXECUTE الافتراضي لدوال الـ trigger (الحالة قبل 04)
-- ============================================================
-- begin;
-- do $$
-- declare f text;
-- begin
--   foreach f in array array['public.budget_category_audit()','public.budget_tx_audit()','public.budget_tx_guard()',
--     'public.prevent_audit_log_update()','public.prevent_profile_email_change()','public.protect_developer_profiles()',
--     'public.announcements_before_write()'] loop
--     if to_regprocedure(f) is not null then execute format('grant execute on function %s to public', f); end if;
--   end loop;
-- end $$;
-- commit;


-- ============================================================
-- Phase 4: لا شيء للتراجع عنه (05 لا يغيّر شيئًا)
-- ============================================================


-- ============================================================
-- Phase 5: audit_logs + صلاحيات الجداول
-- (تحويل buckets الداخلية إلى خاصة لا يُعاد: لم تكن عامة أصلًا بحسب 0005، والعودة إلى عام غير مرغوبة)
-- ============================================================
-- begin;
-- drop policy if exists "audit_logs_developer_delete" on public.audit_logs;
-- create policy "audit_logs_super_admin_delete"
--   on public.audit_logs for delete
--   using (public.is_super_admin());
-- do $$
-- declare t record;
-- begin
--   for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
--             where n.nspname = 'public' and c.relkind in ('r','p') loop
--     -- الحالة الافتراضية في Supabase قبل 06 (للجداول التي لم تسحبها migrations سابقة صراحةً)
--     execute format('grant truncate, references, trigger on table public.%I to anon, authenticated', t.relname);
--   end loop;
-- end $$;
-- commit;
-- ملاحظة: الحلقة الأخيرة تمنح TRUNCATE/REFERENCES/TRIGGER حتى للجداول التي كانت migrations قد سحبتها كاملة (revoke all)،
-- فإن أردت الدقة الكاملة فاحفظ نتيجة الاستعلام 5.4 في 01_pre_checks.sql قبل التنفيذ واستعدها منها.
