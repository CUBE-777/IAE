-- ============================================================
-- 0003_rls_policies.sql
-- Row Level Security — تُطبَّق فعليًا على مستوى قاعدة البيانات
-- ============================================================

-- ---------- دالة مساعدة: دور المستخدم الحالي ----------
create or replace function public.current_admin_role()
returns admin_role
language sql
security definer
stable
as $$
  select role from public.profiles
  where id = auth.uid() and is_active = true
  limit 1;
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
security definer
stable
as $$
  select public.current_admin_role() = 'super_admin';
$$;

create or replace function public.can_manage_members()
returns boolean
language sql
security definer
stable
as $$
  select public.current_admin_role() in ('super_admin', 'members_manager');
$$;

create or replace function public.can_manage_content()
returns boolean
language sql
security definer
stable
as $$
  select public.current_admin_role() in ('super_admin', 'editor');
$$;

-- ============================================================
-- profiles
-- ============================================================
alter table public.profiles enable row level security;

create policy "profiles_select_own_or_super_admin"
  on public.profiles for select
  using (id = auth.uid() or public.is_super_admin());

create policy "profiles_insert_super_admin_only"
  on public.profiles for insert
  with check (public.is_super_admin());

create policy "profiles_update_super_admin_only"
  on public.profiles for update
  using (public.is_super_admin());

create policy "profiles_delete_super_admin_only"
  on public.profiles for delete
  using (public.is_super_admin());

-- ============================================================
-- members
-- ============================================================
alter table public.members enable row level security;

create policy "members_public_read_active"
  on public.members for select
  using (status = 'active' and deleted_at is null);

create policy "members_admin_read_all"
  on public.members for select
  using (public.is_admin());

create policy "members_insert_managers"
  on public.members for insert
  with check (public.can_manage_members());

create policy "members_update_managers"
  on public.members for update
  using (public.can_manage_members());

create policy "members_delete_managers"
  on public.members for delete
  using (public.can_manage_members());

-- ============================================================
-- membership_requests (لا قراءة عامة إطلاقًا، بيانات شخصية)
-- ============================================================
alter table public.membership_requests enable row level security;

-- الزائر العام يمكنه فقط الإدخال (تقديم طلب انخراط) وليس القراءة
create policy "membership_requests_public_insert"
  on public.membership_requests for insert
  to anon, authenticated
  with check (true);

create policy "membership_requests_admin_read"
  on public.membership_requests for select
  using (public.can_manage_members());

create policy "membership_requests_admin_update"
  on public.membership_requests for update
  using (public.can_manage_members());

create policy "membership_requests_admin_delete"
  on public.membership_requests for delete
  using (public.is_super_admin());

-- ============================================================
-- activities
-- ============================================================
alter table public.activities enable row level security;

create policy "activities_public_read_published"
  on public.activities for select
  using (status = 'published' and deleted_at is null);

create policy "activities_admin_read_all"
  on public.activities for select
  using (public.is_admin());

create policy "activities_insert_editors"
  on public.activities for insert
  with check (public.can_manage_content());

create policy "activities_update_editors"
  on public.activities for update
  using (public.can_manage_content());

create policy "activities_delete_editors"
  on public.activities for delete
  using (public.can_manage_content());

-- ============================================================
-- gallery
-- ============================================================
alter table public.gallery enable row level security;

create policy "gallery_public_read"
  on public.gallery for select
  using (deleted_at is null);

create policy "gallery_admin_read_all"
  on public.gallery for select
  using (public.is_admin());

create policy "gallery_insert_editors"
  on public.gallery for insert
  with check (public.can_manage_content());

create policy "gallery_update_editors"
  on public.gallery for update
  using (public.can_manage_content());

create policy "gallery_delete_editors"
  on public.gallery for delete
  using (public.can_manage_content());

-- ============================================================
-- board_members
-- ============================================================
alter table public.board_members enable row level security;

create policy "board_members_public_read_active"
  on public.board_members for select
  using (is_active = true);

create policy "board_members_admin_read_all"
  on public.board_members for select
  using (public.is_admin());

create policy "board_members_insert_editors"
  on public.board_members for insert
  with check (public.can_manage_content() or public.can_manage_members());

create policy "board_members_update_editors"
  on public.board_members for update
  using (public.can_manage_content() or public.can_manage_members());

create policy "board_members_delete_editors"
  on public.board_members for delete
  using (public.can_manage_content() or public.can_manage_members());

-- ============================================================
-- announcements
-- ============================================================
alter table public.announcements enable row level security;

create policy "announcements_public_read_active"
  on public.announcements for select
  using (
    is_active = true
    and (start_at is null or start_at <= now())
    and (end_at is null or end_at >= now())
  );

create policy "announcements_admin_read_all"
  on public.announcements for select
  using (public.is_admin());

create policy "announcements_insert_editors"
  on public.announcements for insert
  with check (public.can_manage_content());

create policy "announcements_update_editors"
  on public.announcements for update
  using (public.can_manage_content());

create policy "announcements_delete_editors"
  on public.announcements for delete
  using (public.can_manage_content());

-- ============================================================
-- site_settings
-- ============================================================
alter table public.site_settings enable row level security;

create policy "site_settings_public_read"
  on public.site_settings for select
  using (true);

create policy "site_settings_insert_super_admin"
  on public.site_settings for insert
  with check (public.is_super_admin());

create policy "site_settings_update_super_admin"
  on public.site_settings for update
  using (public.is_super_admin());

create policy "site_settings_delete_super_admin"
  on public.site_settings for delete
  using (public.is_super_admin());

-- ============================================================
-- site_content
-- ============================================================
alter table public.site_content enable row level security;

create policy "site_content_public_read"
  on public.site_content for select
  using (true);

create policy "site_content_insert_editors"
  on public.site_content for insert
  with check (public.can_manage_content());

create policy "site_content_update_editors"
  on public.site_content for update
  using (public.can_manage_content());

create policy "site_content_delete_editors"
  on public.site_content for delete
  using (public.can_manage_content());

-- ============================================================
-- audit_logs (لا كتابة إلا عبر الخادم/الدوال، قراءة للإدارة فقط)
-- ============================================================
alter table public.audit_logs enable row level security;

create policy "audit_logs_admin_read"
  on public.audit_logs for select
  using (public.is_admin());

create policy "audit_logs_admin_insert"
  on public.audit_logs for insert
  with check (public.is_admin());

-- حذف audit_logs: super_admin فقط (يُفضّل عدم السماح إطلاقًا، لكن نتيح ذلك بحذر)
create policy "audit_logs_super_admin_delete"
  on public.audit_logs for delete
  using (public.is_super_admin());
