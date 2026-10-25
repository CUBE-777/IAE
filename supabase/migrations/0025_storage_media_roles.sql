-- ============================================================
-- 0025_storage_media_roles.sql — تقييد الكتابة على bucket الصور العامة بحسب الدور
-- يتطلب: 0005 و0019. آمن لإعادة التشغيل (idempotent). شغّله في SQL Editor.
--
-- المشكلة: سياسات الرفع والتعديل والحذف على association-media كانت مشروطة بـ is_admin() فقط، فأي
-- مسؤول نشط (حتى نائب أمين المال) يستطيع استبدال أو حذف أي صورة عامة في الموقع.
-- الإصلاح: تقتصر الكتابة على من يرفع صورًا فعليًا من الواجهة:
--   - can_manage_content(): الأنشطة والمعرض والإعلانات والمشاريع وأعضاء المكتب
--   - can_manage_members(): صور الأعضاء
-- القراءة العامة (association_media_public_read) تبقى كما هي: الصور تُعرض للزوار.
-- إيصالات الميزانية وملفات الإدارة الداخلية في buckets أخرى ولا تتأثر.
-- ============================================================

drop policy if exists "association_media_admin_insert" on storage.objects;
create policy "association_media_admin_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'association-media'
    and (public.can_manage_content() or public.can_manage_members())
  );

drop policy if exists "association_media_admin_update" on storage.objects;
create policy "association_media_admin_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'association-media'
    and (public.can_manage_content() or public.can_manage_members())
  )
  with check (
    bucket_id = 'association-media'
    and (public.can_manage_content() or public.can_manage_members())
  );

drop policy if exists "association_media_admin_delete" on storage.objects;
create policy "association_media_admin_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'association-media'
    and (public.can_manage_content() or public.can_manage_members())
  );

notify pgrst, 'reload schema';
