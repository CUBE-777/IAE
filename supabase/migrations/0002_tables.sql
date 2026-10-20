-- ============================================================
-- 0002_tables.sql
-- الجداول الرئيسية
-- ============================================================

-- ---------- profiles (مستخدمو الإدارة) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role admin_role not null default 'editor',
  avatar_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- members (الأعضاء المنخرطون + المكتب عبر board_members) ----------
create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  photo_url text,
  promotion text,               -- سنة التخرج (promo سابقًا)
  track text,                   -- شعبة الباكالوريا (موجود في البيانات الحالية)
  university text,               -- موجود في البيانات الحالية
  age text,                     -- موجود في البيانات الحالية (نص وليس رقم كما في JSON الأصلي)
  profession text,
  city text,
  email text,
  phone text,
  bio text,
  status member_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_members_status on public.members(status) where deleted_at is null;
create index if not exists idx_members_promotion on public.members(promotion);
create index if not exists idx_members_city on public.members(city);
create index if not exists idx_members_full_name_trgm on public.members using gin (full_name gin_trgm_ops);

-- ---------- membership_requests (طلبات الانخراط) ----------
create table if not exists public.membership_requests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text not null,
  promotion text,
  track text,                   -- تصحيح: كان اسم الحقل "شعبة" في النموذج القديم، أصبح track
  profession text,
  city text,
  message text,
  status request_status not null default 'pending',
  rejection_reason text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_membership_requests_status on public.membership_requests(status);

-- ---------- activities (الأنشطة) ----------
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  slug text unique,              -- يقابل "id" النصي القديم مثل annual-meeting (للحفاظ على روابط ?id=)
  title text not null,
  description text,              -- يقابل "content" (HTML) في JSON القديم
  category text,                 -- موجود في البيانات الحالية
  target_audience text,          -- يقابل "target"
  date date,
  time text,
  location text,
  cover_image_url text,
  sub_activities jsonb not null default '[]'::jsonb, -- المشاريع الفرعية (بدل جدول منفصل، حفاظًا على البساطة)
  status activity_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_activities_status on public.activities(status) where deleted_at is null;
create index if not exists idx_activities_slug on public.activities(slug);

-- ---------- gallery (المعرض) ----------
create table if not exists public.gallery (
  id uuid primary key default gen_random_uuid(),
  title text,
  description text,              -- يقابل "caption" في JSON القديم
  image_url text not null,
  activity_id uuid references public.activities(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_gallery_activity on public.gallery(activity_id);
create index if not exists idx_gallery_sort on public.gallery(sort_order) where deleted_at is null;

-- ---------- board_members (أعضاء المكتب) ----------
create table if not exists public.board_members (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members(id) on delete set null,
  full_name text not null,       -- مكرر عمدًا حتى تعمل الصفحة حتى بدون ربط member_id
  position text not null,        -- الصفة: الرئيس، الكاتب العام...
  photo_url text,
  university text,
  bio text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_board_members_sort on public.board_members(sort_order) where is_active = true;

-- ---------- announcements (الإعلانات) ----------
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  link text,
  start_at timestamptz,
  end_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- site_settings (إعدادات عامة - صف واحد لكل مفتاح) ----------
create table if not exists public.site_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

-- ---------- site_content (محتوى قابل للتعديل، مرن بالمفاتيح) ----------
create table if not exists public.site_content (
  id uuid primary key default gen_random_uuid(),
  section text not null,          -- مثال: 'homepage', 'footer'
  key text not null,              -- مثال: 'hero_title', 'about_text'
  value text,
  updated_at timestamptz not null default now(),
  unique (section, key)
);

-- ---------- audit_logs (سجل العمليات الإدارية) ----------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  description text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_created_at on public.audit_logs(created_at desc);
create index if not exists idx_audit_logs_entity on public.audit_logs(entity_type, entity_id);
