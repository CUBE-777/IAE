-- ============================================================
-- 0032_consultant_role.sql — دور «مستشار» (consultant)
-- يتطلب: 0003 و0016 و0017 و0019 و0024 و0025. آمن لإعادة التشغيل (idempotent). شغّله في SQL Editor دفعة واحدة.
--
-- الصلاحيات الممنوحة للمستشار:
--   * إدارة المشاريع كاملة (إضافة، تعديل، نشر/إلغاء نشر، حذف منطقي) + رفع صور المشاريع فقط (مجلد projects/).
--   * قراءة فقط: الأنشطة والمعرض والإعلانات وأعضاء المكتب (عبر is_admin() كما هو) ومحتوى الموقع.
--   * الملفات الداخلية: اطلاع وتنزيل فقط (بلا رفع ولا حذف).
--   * لا شيء: بيانات الأعضاء الشخصية، طلبات الانخراط، الميزانية، الحسابات الإدارية، الإعدادات، سجل العمليات.
--
-- مبدأ التصميم: إضافة صرفة. لا تُعدَّل دوال can_manage_content/can_manage_members/can_access_internal_files/
-- is_super_admin ولا is_admin، فلا يتغيّر سلوك أي دور موجود. كل سياسة أُعيد إنشاؤها هنا تحتفظ بشروطها
-- الأصلية حرفيًا وتُضاف إليها حالة المستشار فقط.
-- المقارنات بالنص (::text) فلا اعتماد على قيمة enum الجديدة داخل نفس المعاملة (أسلوب 0012 و0019).
-- ============================================================

alter type admin_role add value if not exists 'consultant';

-- ---------- دوال الصلاحيات الجديدة ----------

-- إدارة المشاريع: كل من يدير المحتوى (نفس أدوار can_manage_content في 0019) + المستشار
create or replace function public.can_manage_projects()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.current_admin_role()::text in (
    'super_admin', 'developer', 'editor',
    'secretary_general', 'deputy_secretary_general', 'deputy_super_admin',
    'consultant'
  );
$$;

-- قراءة الملفات الداخلية وتنزيلها: أدوار can_access_internal_files في 0019 + المستشار (قراءة فقط)
create or replace function public.can_read_internal_files()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.current_admin_role()::text in (
    'developer', 'super_admin', 'editor', 'members_manager',
    'secretary_general', 'deputy_secretary_general', 'deputy_super_admin',
    'consultant'
  );
$$;

revoke execute on function public.can_manage_projects() from public, anon;
revoke execute on function public.can_read_internal_files() from public, anon;
grant  execute on function public.can_manage_projects() to authenticated;
grant  execute on function public.can_read_internal_files() to authenticated;

-- ---------- (1) المشاريع: الإنشاء والتعديل ----------
drop policy if exists "projects_insert_editors" on public.projects;
create policy "projects_insert_editors"
  on public.projects for insert
  to authenticated
  with check (public.can_manage_projects());

drop policy if exists "projects_update_editors" on public.projects;
create policy "projects_update_editors"
  on public.projects for update
  to authenticated
  using (public.can_manage_projects())
  with check (public.can_manage_projects());

-- ---------- (2) صور المشاريع: bucket association-media ----------
-- الشرط الأصلي (0025) محفوظ كما هو؛ يُضاف فقط: من يدير المشاريع يكتب داخل مجلد projects/ حصرًا.
drop policy if exists "association_media_admin_insert" on storage.objects;
create policy "association_media_admin_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'association-media'
    and (
      public.can_manage_content() or public.can_manage_members()
      or (public.can_manage_projects() and (storage.foldername(name))[1] = 'projects')
    )
  );

drop policy if exists "association_media_admin_update" on storage.objects;
create policy "association_media_admin_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'association-media'
    and (
      public.can_manage_content() or public.can_manage_members()
      or (public.can_manage_projects() and (storage.foldername(name))[1] = 'projects')
    )
  )
  with check (
    bucket_id = 'association-media'
    and (
      public.can_manage_content() or public.can_manage_members()
      or (public.can_manage_projects() and (storage.foldername(name))[1] = 'projects')
    )
  );

drop policy if exists "association_media_admin_delete" on storage.objects;
create policy "association_media_admin_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'association-media'
    and (
      public.can_manage_content() or public.can_manage_members()
      or (public.can_manage_projects() and (storage.foldername(name))[1] = 'projects')
    )
  );

-- ---------- (3) الملفات الداخلية: قراءة وتنزيل فقط (الرفع والحذف يبقيان كما هما) ----------
drop policy if exists "internal_files_select" on public.internal_files;
create policy "internal_files_select"
  on public.internal_files for select
  to authenticated
  using (public.can_read_internal_files() and deleted_at is null);

drop policy if exists "internal_files_objects_select" on storage.objects;
create policy "internal_files_objects_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'internal-files' and public.can_read_internal_files());

create or replace function public.request_internal_file_download(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_path  text;
  v_title text;
begin
  if auth.uid() is null or not public.can_read_internal_files() then
    raise exception 'غير مصرح لك بهذه العملية';
  end if;

  select storage_path, title into v_path, v_title
  from public.internal_files
  where id = p_id and deleted_at is null;

  if v_path is null then
    raise exception 'الملف غير موجود';
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
  values (auth.uid(), 'ADMIN_INTERNAL_FILE_DOWNLOADED', 'internal_files', p_id,
          left(format('Téléchargement du fichier interne : %s', v_title), 500));

  return v_path;
end;
$$;

revoke execute on function public.request_internal_file_download(uuid) from public, anon;
grant  execute on function public.request_internal_file_download(uuid) to authenticated;

-- ---------- (4) سجل العمليات: لا يقرؤه المستشار ----------
-- السياسة الأصلية (0003) تسمح لأي مسؤول نشط بالقراءة عبر الـ API (الواجهة فقط تخفيها عن غير المسؤول الأعلى).
-- نُبقي السلوك كما هو لكل الأدوار الحالية ونستثني المستشار.
drop policy if exists "audit_logs_admin_read" on public.audit_logs;
create policy "audit_logs_admin_read"
  on public.audit_logs for select
  using (public.is_admin() and coalesce(public.current_admin_role()::text, '') <> 'consultant');

notify pgrst, 'reload schema';
