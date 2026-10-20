-- ============================================================
-- 0009_announcements_board_audit.sql
-- migration إضافية فقط (لا تعدّل أي migration سابقة ولا تحذف أي بيانات).
--
--  1) توسيع جدول announcements الموجود (بدل إنشاء جدول موازٍ) ليدعم لوحة
--     الإعلانات: عنوان، مقتطف، محتوى كامل، صورة، نوع، تثبيت، slug، ترجمات.
--     الأعمدة القديمة (text, link, start_at, end_at, is_active) تبقى كما هي
--     وتستمر في تشغيل الشريط العلوي، ومعناها الآن:
--        is_active  = منشور (is_published)
--        start_at   = تاريخ/وقت النشر (published_at) — null يعني "منذ الإنشاء"
--        end_at     = تاريخ الانتهاء (expires_at)    — null يعني "بلا انتهاء"
--  2) audit_logs: إلغاء الإدخال المباشر من العميل وإحلال دالة
--     log_admin_action() تشتق user_id من auth.uid() وتقيّد الإجراءات بالصلاحية.
--  3) reorder_board_members(): ترتيب ذري (عملية واحدة) بدل تحديثين منفصلين.
--  4) منع تغيير profiles.email من واجهة API (البريد مصدره Supabase Auth).
-- ============================================================

-- ------------------------------------------------------------
-- 1) announcements
-- ------------------------------------------------------------
alter table public.announcements
  add column if not exists title        text,
  add column if not exists excerpt      text,
  add column if not exists content      text,
  add column if not exists image_url    text,
  add column if not exists type         text    not null default 'general',
  add column if not exists is_pinned    boolean not null default false,
  add column if not exists slug         text,
  -- ترجمات اختيارية: {"fr": {"title": "...", "excerpt": "...", "content": "..."}, "en": {...}}
  -- الحقول الأساسية (title/excerpt/content) هي اللغة الأصلية (العربية) وتُستخدم
  -- كـ fallback عند غياب ترجمة اللغة المختارة، تمامًا كبقية محتوى الموقع.
  add column if not exists translations jsonb   not null default '{}'::jsonb,
  add column if not exists created_by   uuid references public.profiles(id) on delete set null;

-- ملء البيانات القديمة بدون فقدان أي شيء
update public.announcements set title = left(text, 200) where title is null;
update public.announcements
  set slug = 'a-' || substr(replace(id::text, '-', ''), 1, 12)
  where slug is null;

alter table public.announcements
  drop constraint if exists announcements_type_chk,
  drop constraint if exists announcements_title_len_chk,
  drop constraint if exists announcements_excerpt_len_chk,
  drop constraint if exists announcements_content_len_chk,
  drop constraint if exists announcements_translations_chk,
  drop constraint if exists announcements_dates_chk;

alter table public.announcements
  add constraint announcements_type_chk
    check (type in ('general', 'important', 'event', 'membership', 'notice')),
  add constraint announcements_title_len_chk
    check (title is null or char_length(title) between 1 and 200),
  add constraint announcements_excerpt_len_chk
    check (excerpt is null or char_length(excerpt) <= 400),
  add constraint announcements_content_len_chk
    check (content is null or char_length(content) <= 20000),
  add constraint announcements_translations_chk
    check (jsonb_typeof(translations) = 'object'),
  add constraint announcements_dates_chk
    check (start_at is null or end_at is null or end_at >= start_at);

create unique index if not exists idx_announcements_slug
  on public.announcements (slug) where slug is not null;

create index if not exists idx_announcements_public_order
  on public.announcements (is_active, is_pinned desc, start_at desc nulls last, created_at desc);

-- slug + created_by تُضبط من الخادم دائمًا (لا يمكن للعميل تزويرها)
create or replace function public.announcements_before_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    if new.slug is null or btrim(new.slug) = '' then
      new.slug := 'a-' || substr(replace(new.id::text, '-', ''), 1, 12);
    end if;
  else
    new.created_by := old.created_by;
    new.slug := old.slug; -- الرابط ثابت بعد الإنشاء حتى لا تنكسر الروابط المشاركة
  end if;
  return new;
end;
$$;

drop trigger if exists trg_announcements_before_write on public.announcements;
create trigger trg_announcements_before_write
  before insert or update on public.announcements
  for each row execute function public.announcements_before_write();

-- RLS: السياسات الموجودة في 0003 كافية ولا تُعدَّل:
--   * القراءة العامة: is_active = true وضمن نافذة start_at/end_at فقط.
--   * INSERT/UPDATE/DELETE: can_manage_content() (super_admin + editor) فقط.
--   * anon لا يملك أي سياسة كتابة.

-- ------------------------------------------------------------
-- 2) audit_logs — لا كتابة مباشرة من العميل
-- ------------------------------------------------------------
drop policy if exists "audit_logs_admin_insert" on public.audit_logs;
revoke insert, update on public.audit_logs from anon, authenticated;

create or replace function public.log_admin_action(
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid  default null,
  p_description text  default null,
  p_metadata    jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_ok  boolean;
begin
  if v_uid is null or not public.is_admin() then
    raise exception 'غير مصرح لك بهذه العملية';
  end if;

  -- شكل اسم الإجراء
  if p_action is null or p_action !~ '^ADMIN_[A-Z_]{3,60}$' then
    raise exception 'اسم إجراء غير صالح';
  end if;

  -- إجراءات تُسجَّل حصرًا داخل دوالها الخاصة (approve/reject/reorder) — لا تُزوَّر من العميل
  if p_action in ('ADMIN_APPROVED_REQUEST', 'ADMIN_REJECTED_REQUEST', 'ADMIN_REORDERED_BOARD') then
    raise exception 'هذا الإجراء يُسجَّل تلقائيًا من الخادم';
  end if;

  -- ربط نوع الكيان بالصلاحية التي تسمح فعليًا بتعديله: لا يستطيع محرر مثلاً
  -- تسجيل عملية على جدول المستخدمين الإداريين.
  v_ok := case p_entity_type
    when 'members'             then public.can_manage_members()
    when 'membership_requests' then public.can_manage_members()
    when 'activities'          then public.can_manage_content()
    when 'gallery'             then public.can_manage_content()
    when 'announcements'       then public.can_manage_content()
    when 'site_content'        then public.can_manage_content()
    when 'board_members'       then (public.can_manage_content() or public.can_manage_members())
    when 'site_settings'       then public.is_super_admin()
    when 'profiles'            then public.is_super_admin()
    else false
  end;
  if not coalesce(v_ok, false) then
    raise exception 'غير مصرح لك بتسجيل هذه العملية';
  end if;

  if p_description is not null and char_length(p_description) > 500 then
    p_description := left(p_description, 500);
  end if;
  if p_metadata is not null and pg_column_size(p_metadata) > 4000 then
    raise exception 'metadata كبيرة جدًا';
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, metadata)
  values (v_uid, p_action, p_entity_type, p_entity_id, p_description, p_metadata);
end;
$$;

revoke execute on function public.log_admin_action(text, text, uuid, text, jsonb) from public, anon;
grant  execute on function public.log_admin_action(text, text, uuid, text, jsonb) to authenticated;

-- ------------------------------------------------------------
-- 3) ترتيب أعضاء المكتب — عملية ذرّية واحدة
-- ------------------------------------------------------------
create or replace function public.reorder_board_members(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_n   integer;
begin
  if v_uid is null or not (public.can_manage_content() or public.can_manage_members()) then
    raise exception 'غير مصرح لك بهذه العملية';
  end if;

  v_n := coalesce(cardinality(p_ids), 0);
  if v_n = 0 then
    raise exception 'قائمة الترتيب فارغة';
  end if;
  if (select count(distinct x) from unnest(p_ids) as x) <> v_n then
    raise exception 'قائمة الترتيب تحتوي معرّفات مكررة';
  end if;
  if (select count(*) from public.board_members where id = any(p_ids)) <> v_n then
    raise exception 'أحد أعضاء المكتب غير موجود';
  end if;

  update public.board_members b
     set sort_order = o.ord - 1
    from unnest(p_ids) with ordinality as o(id, ord)
   where b.id = o.id;

  insert into public.audit_logs (user_id, action, entity_type, description)
  values (v_uid, 'ADMIN_REORDERED_BOARD', 'board_members', 'إعادة ترتيب أعضاء المكتب');
end;
$$;

revoke execute on function public.reorder_board_members(uuid[]) from public, anon;
grant  execute on function public.reorder_board_members(uuid[]) to authenticated;

-- ------------------------------------------------------------
-- 4) profiles.email لا يتغيّر من واجهة API
-- البريد الفعلي لتسجيل الدخول في auth.users؛ تعديل النسخة في profiles فقط يُنتج
-- بيانات غير متزامنة. التغيير المشروع يتم من Supabase Auth (أو عبر service_role).
-- ------------------------------------------------------------
create or replace function public.prevent_profile_email_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.email is distinct from old.email and auth.uid() is not null then
    raise exception 'لا يمكن تغيير البريد الإلكتروني من هذه الواجهة؛ بريد الدخول مصدره Supabase Auth';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_profile_email_change on public.profiles;
create trigger trg_prevent_profile_email_change
  before update of email on public.profiles
  for each row execute function public.prevent_profile_email_change();
