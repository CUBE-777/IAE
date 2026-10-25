-- ============================================================
-- 0029_projects_slug_and_profiles_check.sql
-- 1) projects.slug: التفرّد على المشاريع غير المحذوفة فقط. كان القيد يشمل المحذوفة ناعمًا، فيبقى رابط
--    المشروع المحذوف محجوزًا ويفشل إنشاء مشروع جديد بالرابط نفسه (خصوصًا من SQL أو واجهة بلا لاحقة زمنية).
-- 2) profiles: سياسة التعديل بلا WITH CHECK، فأضفنا الشرط نفسه على الصف بعد التعديل (طبقة حماية ثانية
--    إلى جانب trigger protect_developer_profiles).
--
-- يتطلب: 0003 و0016. آمن لإعادة التشغيل (idempotent).
-- ⚠️ لا تُعد تشغيل 0016 بعد هذا الملف: هي تعيد إنشاء القيد projects_slug_key الكامل.
-- ============================================================

alter table public.projects drop constraint if exists projects_slug_key;

create unique index if not exists uq_projects_slug_active
  on public.projects (slug)
  where deleted_at is null;

drop policy if exists "profiles_update_super_admin_only" on public.profiles;
create policy "profiles_update_super_admin_only"
  on public.profiles for update
  using (public.is_super_admin())
  with check (public.is_super_admin());

notify pgrst, 'reload schema';
