-- ============================================================
-- 0007_member_privacy.sql
-- CRITICAL: سياسة members_public_read_active في 0003 كانت تسمح لأي زائر
-- (anon) بقراءة الصف كاملاً عبر select('*')، بما في ذلك email و phone و age
-- و city — بيانات شخصية لا يحتاجها الموقع العام لعرض بطاقة العضو.
--
-- RLS تتحكم في الصفوف (أيّ الأعضاء تظهر) وليس في الأعمدة (أيّ الحقول تظهر).
-- لذلك نضيف طبقة تحكّم على مستوى الأعمدة (column-level privileges) خاصة
-- بدور anon فقط، بحيث يبقى الوصول الإداري (authenticated + is_admin())
-- كاملاً كما هو دون أي تغيير.
-- ============================================================

-- 1) تقييد سياسة القراءة العامة على anon فقط (كانت متاحة تقنيًا أيضًا لأي
--    "authenticated" غير مسجّل كعضو إدارة، رغم أن لا وجود لمستخدمين من هذا
--    النوع حاليًا — تحصين إضافي دون أي أثر وظيفي).
drop policy if exists "members_public_read_active" on public.members;
create policy "members_public_read_active"
  on public.members for select
  to anon
  using (status = 'active' and deleted_at is null);

-- ملاحظة: authenticated (كل المستخدمين المسجّلين هم مسؤولو الإدارة في هذا
-- المشروع) يبقى وصولهم الكامل عبر "members_admin_read_all" (is_admin())
-- دون أي تغيير.

-- 2) سحب صلاحية القراءة الافتراضية لكل الأعمدة من anon، ثم منحها فقط على
--    الأعمدة "العامة" غير الحساسة. أي محاولة select() تتضمن email/phone/age/
--    city من طرف anon سترفضها قاعدة البيانات مباشرة (42501) بغض النظر عمّا
--    يرسله الواجهة الأمامية.
revoke select on public.members from anon;

grant select (
  id,
  full_name,
  photo_url,
  promotion,
  track,
  university,
  profession,
  status,
  created_at,
  updated_at,
  deleted_at
) on public.members to anon;

-- الأعمدة الحساسة المتبقية بدون منح لـ anon: email, phone, age, city, bio.
-- (bio قد تحتوي معلومات شخصية حرة كتبها العضو؛ تُبقى للإدارة فقط حاليًا،
-- يمكن منحها لاحقًا إذا رغبت الجمعية في عرضها للعموم.)

-- authenticated (الإدارة) تحتفظ بالمنح الافتراضي الكامل لكل الأعمدة كما
-- أعدّه Supabase عند إنشاء الجدول؛ لا حاجة لأي REVOKE/GRANT هنا.
