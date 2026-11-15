-- ============================================================
-- 03_member_media_privacy.sql — Phase 2: خصوصية صور الأعضاء في bucket «association-media»
-- نفّذه يدويًا بعد 02. لا يحذف ولا ينقل ولا يعدّل أي صورة أو رابط، ولا يحوّل الـ bucket إلى Private.
--
-- الوضع المثبت من الكود:
--   * الصور تُرفع إلى association-media بأسماء <folder>/<Date.now()>-<اسم الملف> وتُخزَّن روابطها العامة في members.photo_url
--     وboard_members.photo_url وغيرها (storage.service.js). الموقع يعرضها بالرابط المباشر /object/public/... .
--   * سياسة SELECT الأصلية association_media_public_read (0005) = «bucket_id = association-media» لكل الأدوار، فتسمح لأي زائر
--     بسرد (list) كل ملفات الـ bucket عبر Storage API ومنها members/ — أي صور الأعضاء الذين show_in_directory = false
--     أو المحذوفين منطقيًا أو غير النشطين، رغم أن صفوفهم مخفية في جدول members.
--   * لا يوجد في الواجهة أي استدعاء list/download/createSignedUrl على هذا الـ bucket (فُحص src كاملًا) فلا يتأثر العرض.
--
-- ما يفعله هذا الملف (SQL ما يستطيع فعله فقط):
--   1) دالة association_media_object_public(name): كل المجلدات غير members/ تبقى عامة كما هي (activities, announcements,
--      gallery, board, projects, site ...). ملفات members/ تُسرد للزوار فقط إن كانت صورة عضو ظاهر في الدليل
--      (active + غير محذوف + show_in_directory) أو صورة عضو مكتب نشط.
--   2) استبدال سياسة القراءة العامة بنسخة تستعمل الدالة، وإضافة سياسة قراءة للطاقم (من يرفع/يحذف الصور) حتى لا ينكسر
--      الحذف/الاستبدال من لوحة الإدارة (DELETE/UPDATE مع RETURNING يتطلبان صلاحية SELECT على الصف).
--
-- ما لا يستطيعه SQL (وهو مذكور بصدق في 00_security_audit.md وREADME.md):
--   * رابط /object/public/... لا يمرّ عبر RLS: من يملك رابط صورة بعينها يبقى يفتحها. هذا الملف يمنع «سرد/اكتشاف» الملفات
--     وليس فتح رابط معروف. الحماية الكاملة تتطلب تعديل الواجهة (bucket خاص + signed URL) — مفصّلة في التقرير ولم تُنفَّذ هنا.
--   * حذف ملفات الأعضاء المحذوفين/المنسحبين لا يتم بـ SQL (حذف صف storage.objects لا يحذف الملف الفعلي). استعمل الاستعلام
--     الموجود في 01_pre_checks.sql (القسم 2.5) لمعرفة القائمة ثم احذفها من لوحة Storage أو عبر خطة الواجهة.
--
-- الوظائف التي قد تتأثر: لا شيء متوقع. الصفحات العامة تستعمل روابط مباشرة. إن ظهر ملف members/ لا يظهر في سرد لوحة Storage
--   بعد التنفيذ فهذا مقصود (صاحبه غير ظاهر في الدليل). المسؤولون (محتوى/أعضاء/مشاريع) يرون كل شيء كما كان.
-- التراجع: 08_rollback.sql → «Phase 2» (يعيد السياسة الأصلية حرفيًا ويحذف الدالة).
-- ============================================================
begin;

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'association-media') then
    raise exception 'bucket association-media غير موجود';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'members' and column_name = 'show_in_directory') then
    raise exception 'نفّذ 0030 أولًا (members.show_in_directory غير موجود)';
  end if;
  if to_regprocedure('public.can_manage_projects()') is null then
    raise exception 'نفّذ 0032 أولًا';
  end if;
end $$;

-- يُستدعى من سياسة التخزين (تُقيَّم بدور المستدعي) لذلك SECURITY DEFINER كي لا يتأثر بسياسات members/board_members،
-- ويُمنح EXECUTE لـ anon و authenticated فقط. لا يُرجع بيانات: boolean فقط.
create or replace function public.association_media_object_public(p_name text)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select case
    when p_name is null then false
    when p_name not like 'members/%' then true
    else exists (
           select 1 from public.members m
            where m.photo_url is not null
              and m.status = 'active'
              and m.deleted_at is null
              and m.show_in_directory is true
              and right(m.photo_url, char_length(p_name) + 1) = '/' || p_name
         )
         or exists (
           select 1 from public.board_members b
            where b.photo_url is not null
              and b.is_active is true
              and right(b.photo_url, char_length(p_name) + 1) = '/' || p_name
         )
  end;
$$;

revoke all on function public.association_media_object_public(text) from public, anon, authenticated;
grant execute on function public.association_media_object_public(text) to anon, authenticated;

-- القراءة/السرد العام (الاسم نفسه كالأصلي)
drop policy if exists "association_media_public_read" on storage.objects;
create policy "association_media_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'association-media' and public.association_media_object_public(name));

-- قراءة الطاقم: نفس أدوار الكتابة في 0025/0032 (محتوى، أعضاء، مشاريع)
drop policy if exists "association_media_staff_read" on storage.objects;
create policy "association_media_staff_read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'association-media'
    and (public.can_manage_content() or public.can_manage_members() or public.can_manage_projects())
  );

notify pgrst, 'reload schema';

commit;
