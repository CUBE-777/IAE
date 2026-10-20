-- ============================================================
-- 0011_board_profile_and_translations.sql
-- 1) الملف العام لأعضاء المكتب (نفس أعمدة 0010 الخاصة بالأعضاء):
--    نبذة عامة، مسار دراسي، روابط تواصل، حقول إضافية قابلة للتوسع.
-- 2) عمود translations (jsonb) للأعضاء وأعضاء المكتب لترجمة المحتوى (FR/EN)
--    بنفس معمارية الإعلانات: الحقول الأساسية بالعربية، والترجمات اختيارية.
--    الشكل: {"name_latin": "...", "fr": {"position": "...", "public_bio": "...", ...}, "en": {...}}
--
-- أمان وتوافق:
--  * إضافات فقط (add column if not exists): لا يُحذف ولا يُغيَّر أي عمود أو بيانات.
--  * عمود bio في members يبقى خاصًا بالإدارة (لا يُمنح لـ anon) كما قرّرت 0007.
--    وعمود bio في board_members يبقى كما هو (نبذة مختصرة تظهر على بطاقة المكتب).
--  * email/phone/age/city تبقى خاصة كما هي.
--  * الموقع يعمل قبل تشغيل هذا الملف وبعده (الواجهة تتراجع تلقائيًا للأعمدة القديمة).
--  * آمن لإعادة التشغيل أكثر من مرة (idempotent).
-- ============================================================

-- ---------- board_members: الملف العام + الترجمات ----------
alter table public.board_members
  add column if not exists public_bio    text,
  add column if not exists study_path    text,
  add column if not exists socials       jsonb not null default '{}'::jsonb,
  add column if not exists extra         jsonb not null default '{}'::jsonb,
  add column if not exists translations  jsonb not null default '{}'::jsonb;

alter table public.board_members
  drop constraint if exists board_members_public_bio_len_chk,
  drop constraint if exists board_members_study_path_len_chk,
  drop constraint if exists board_members_socials_shape_chk,
  drop constraint if exists board_members_extra_shape_chk,
  drop constraint if exists board_members_translations_shape_chk;

alter table public.board_members
  add constraint board_members_public_bio_len_chk check (public_bio is null or char_length(public_bio) <= 600),
  add constraint board_members_study_path_len_chk check (study_path is null or char_length(study_path) <= 800),
  add constraint board_members_socials_shape_chk check (jsonb_typeof(socials) = 'object' and pg_column_size(socials) <= 4000),
  add constraint board_members_extra_shape_chk check (jsonb_typeof(extra) = 'object' and pg_column_size(extra) <= 6000),
  add constraint board_members_translations_shape_chk check (jsonb_typeof(translations) = 'object' and pg_column_size(translations) <= 16000);

-- ---------- members: الترجمات فقط (الملف العام موجود من 0010) ----------
alter table public.members
  add column if not exists translations jsonb not null default '{}'::jsonb;

alter table public.members
  drop constraint if exists members_translations_shape_chk;

alter table public.members
  add constraint members_translations_shape_chk check (jsonb_typeof(translations) = 'object' and pg_column_size(translations) <= 16000);

-- ---------- صلاحيات القراءة العامة (anon) على الأعمدة الجديدة فقط ----------
grant select (translations) on public.members to anon;
grant select (public_bio, study_path, socials, extra, translations) on public.board_members to anon;

-- authenticated (الإدارة) تحتفظ بالمنح الكامل الافتراضي ولا تحتاج شيئًا هنا.

-- تحديث كاش PostgREST ليتعرّف على الأعمدة الجديدة فورًا
notify pgrst, 'reload schema';
