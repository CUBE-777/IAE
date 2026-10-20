-- ============================================================
-- 0010_member_public_profile.sql
-- الملف العام للعضو: نبذة عامة، مسار دراسي، روابط تواصل، وحقول إضافية قابلة للتوسع.
--
-- أمان وتوافق:
--  * إضافات فقط (add column if not exists): لا يُحذف ولا يُغيَّر أي عمود أو بيانات موجودة.
--  * عمود bio القديم يبقى خاصًا بالإدارة كما قرّرت 0007 (لا يُمنح لـ anon).
--    النبذة العامة عمود جديد منفصل هو public_bio، فلا تنكشف أي ملاحظات داخلية كُتبت سابقًا.
--  * email/phone/age/city تبقى خاصة كما هي.
--  * الموقع يعمل بشكل طبيعي قبل تشغيل هذا الملف وبعده (الواجهة تتراجع تلقائيًا للأعمدة القديمة).
--  * آمن لإعادة التشغيل أكثر من مرة (idempotent).
-- ============================================================

alter table public.members
  add column if not exists public_bio text,
  add column if not exists study_path text,
  add column if not exists socials jsonb not null default '{}'::jsonb,
  add column if not exists extra jsonb not null default '{}'::jsonb;

-- حدود معقولة للطول والشكل (تحصين ضد إدخال ضخم أو بنية غير متوقعة)
alter table public.members
  drop constraint if exists members_public_bio_len_chk,
  drop constraint if exists members_study_path_len_chk,
  drop constraint if exists members_socials_shape_chk,
  drop constraint if exists members_extra_shape_chk;

alter table public.members
  add constraint members_public_bio_len_chk check (public_bio is null or char_length(public_bio) <= 600),
  add constraint members_study_path_len_chk check (study_path is null or char_length(study_path) <= 800),
  add constraint members_socials_shape_chk check (jsonb_typeof(socials) = 'object' and pg_column_size(socials) <= 4000),
  add constraint members_extra_shape_chk check (jsonb_typeof(extra) = 'object' and pg_column_size(extra) <= 6000);

-- السماح للزوار (anon) بقراءة أعمدة الملف العام الجديدة فقط
grant select (public_bio, study_path, socials, extra) on public.members to anon;

-- authenticated (الإدارة) تحتفظ بالمنح الكامل الافتراضي ولا تحتاج شيئًا هنا.
