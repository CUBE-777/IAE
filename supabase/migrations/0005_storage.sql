-- ============================================================
-- 0005_storage.sql
-- Bucket واحد "association-media" بمجلدات منطقية:
-- members/ activities/ gallery/ board/ site/
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'association-media',
  'association-media',
  true,                              -- public read (الصور تُعرض في الموقع العام)
  5242880,                           -- 5MB حد أقصى لكل ملف
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- قراءة عامة لكل الملفات في هذا الـ bucket
create policy "association_media_public_read"
  on storage.objects for select
  using (bucket_id = 'association-media');

-- الرفع/التعديل/الحذف: للمستخدمين الإداريين النشطين فقط
create policy "association_media_admin_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'association-media' and public.is_admin());

create policy "association_media_admin_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'association-media' and public.is_admin());

create policy "association_media_admin_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'association-media' and public.is_admin());
