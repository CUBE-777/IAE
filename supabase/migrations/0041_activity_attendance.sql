-- ============================================================
-- 0041_activity_attendance.sql — بطاقة حضور لكل نشاط + تسجيل الحضور بالمسح من داخل الموقع
--
-- لماذا: حضور الأنشطة (≈60 شخصًا نعرف جلّهم) يُسجَّل بمسح رمز QR يخصّ العضو في ذلك النشاط وحده، فلا يصلح لنشاط آخر.
-- كيف: في قسم الأنشطة يضغط من له صلاحية إدارة المحتوى «نشر بطاقة الحضور»؛ فيرى كل عضو نشط رمزه الثابت لهذا النشاط في
--   /member/id، ويمسحه المنظِّم من صفحة داخل الموقع فتظهر له صورة العضو واسمه ويُسجَّل الحضور. من يمسحه بكاميرا عادية لا يرى
--   سوى نص مبهم (IAE-…)، لا رابطًا ولا صفحة ولا بيانات.
-- ما يضيفه (إضافة فقط؛ لا يمسّ أي جدول أو دالة قائمة، ولا يعدّل 0040):
--   1) attendance_secret            — سرّ الخادم لاشتقاق الرموز (مغلق).
--   2) activity_attendance_cards    — صف لكل نشاط نُشرت بطاقته (epoch لإعادة الإصدار، closed_at للإغلاق).
--   3) activity_attendance_tokens   — sha256 الرمز → (نشاط، عضو). الخام لا يُخزَّن.
--   4) activity_attendance          — الحضور: (نشاط، عضو) فريد، من سجّل، وطريقة التسجيل scan|manual.
--   5) publish_attendance_card / close_attendance_card / get_my_attendance_cards / record_attendance /
--      record_attendance_manual / undo_attendance / get_attendance_roster / get_attendance_cards_overview.
-- الأمان:
--   * الجداول الأربعة مغلقة (RLS مفعّل، كل الصلاحيات مسحوبة، بلا سياسات)؛ الوصول عبر دوال SECURITY DEFINER بمسار بحث ثابت.
--   * الرمز 128 بت = sha256(سرّ ‖ نشاط ‖ عضو ‖ epoch) مقتطعًا، base64url: ثابت لنفس (عضو، نشاط) فيُعاد عرضه ويُطبع،
--     ويتغيّر بإعادة الإصدار (epoch+1) إن تسرّب. لا يصلح لنشاط آخر ولا يفتح أي صفحة عامة.
--   * التسجيل والتراجع والقوائم: can_manage_content() فقط (دور المستشار للقراءة لا يسجّل). صلاحية البطاقة من النشر حتى الإغلاق
--     أو 48 ساعة. حضور واحد لكل عضو في النشاط؛ المسح الثاني يُرجع «مسجّل مسبقًا». حدّ 600 مسحة/10 دقائق لكل مسؤول.
--   * الاستجابة لرمز غير معروف/مغلق/منتهٍ واحدة: {"result": "invalid"}.
-- الحدود: الرمز ثابت طوال النشاط (النسخ ممكن؛ الحماية بصورة العضو أمام المنظِّم + حضور واحد + الإبطال). المسح بكاميرا الموقع
--   يعتمد BarcodeDetector (Chrome/Android)؛ الباقي يستعمل القائمة اليدوية.
-- يتطلب: 0019 و0035 و0038. آمن لإعادة التشغيل.
-- ⚠️ تجربة جافة أولًا: استبدل `commit;` الأخيرة بـ `rollback;`. الرجوع: supabase/rollback/0041_activity_attendance_down.sql
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public.can_manage_content()') is null then
    raise exception 'شغّل 0019_new_roles_and_file_delete_fix.sql أولاً';
  end if;
  if to_regprocedure('public.current_member_id()') is null then
    raise exception 'شغّل 0035_member_accounts.sql أولاً';
  end if;
  if to_regclass('public.member_activation_throttle') is null or to_regclass('public.membership_throttle_secret') is null then
    raise exception 'شغّل 0038_member_activation_throttle.sql أولاً';
  end if;
  if to_regclass('public.activities') is null or to_regclass('public.members') is null or to_regclass('public.audit_logs') is null then
    raise exception 'الجداول الأساسية (activities/members/audit_logs) غير موجودة';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) الجداول (كلها مغلقة)
-- ---------------------------------------------------------------------
create table if not exists public.attendance_secret (
  id     integer primary key default 1 check (id = 1),
  secret text not null default encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text, 'utf8')), 'hex')
);
insert into public.attendance_secret (id) values (1) on conflict (id) do nothing;

create table if not exists public.activity_attendance_cards (
  activity_id  uuid primary key references public.activities(id) on delete cascade,
  epoch        integer not null default 1,
  published_at timestamptz not null default now(),
  published_by uuid,
  closed_at    timestamptz
);

create table if not exists public.activity_attendance_tokens (
  token_hash  text primary key,
  activity_id uuid not null references public.activities(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  epoch       integer not null,
  unique (activity_id, member_id, epoch)
);
create index if not exists idx_activity_attendance_tokens_activity on public.activity_attendance_tokens (activity_id);

create table if not exists public.activity_attendance (
  activity_id   uuid not null references public.activities(id) on delete cascade,
  member_id     uuid not null references public.members(id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  checked_by    uuid,
  method        text not null default 'scan' check (method in ('scan', 'manual')),
  primary key (activity_id, member_id)
);
create index if not exists idx_activity_attendance_member on public.activity_attendance (member_id);

alter table public.attendance_secret          enable row level security;
alter table public.activity_attendance_cards  enable row level security;
alter table public.activity_attendance_tokens enable row level security;
alter table public.activity_attendance        enable row level security;
revoke all on table public.attendance_secret, public.activity_attendance_cards,
                    public.activity_attendance_tokens, public.activity_attendance
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2) مساعد داخلي: رمز (نشاط، عضو، epoch) — لا يُمنح لأحد (تستدعيه دوال الملكية فقط)
-- ---------------------------------------------------------------------
create or replace function public.attendance_token_for(p_activity uuid, p_member uuid, p_epoch integer)
returns text
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select rtrim(translate(encode(substring(
           sha256(convert_to((select secret from public.attendance_secret where id = 1)
                  || ':att:' || p_activity::text || ':' || p_member::text || ':' || p_epoch::text, 'utf8'))
           from 1 for 16), 'base64'), '+/', '-_'), '=');
$$;

-- ---------------------------------------------------------------------
-- 3) نشر البطاقة (إدارة المحتوى): idempotent؛ p_rotate = إعادة إصدار كل الرموز
-- ---------------------------------------------------------------------
create or replace function public.publish_attendance_card(p_activity_id uuid, p_rotate boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_card  public.activity_attendance_cards%rowtype;
  v_open  boolean;
  v_count integer;
begin
  if auth.uid() is null or not public.can_manage_content() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;
  if not exists (select 1 from public.activities a where a.id = p_activity_id and a.deleted_at is null) then
    raise exception 'النشاط غير موجود';
  end if;

  select * into v_card from public.activity_attendance_cards where activity_id = p_activity_id for update;
  if not found then
    insert into public.activity_attendance_cards (activity_id, published_by) values (p_activity_id, auth.uid())
    returning * into v_card;
  else
    v_open := v_card.closed_at is null and v_card.published_at > now() - interval '48 hours';
    if not v_open or coalesce(p_rotate, false) then
      delete from public.activity_attendance_tokens where activity_id = p_activity_id;
      update public.activity_attendance_cards
         set epoch = epoch + 1, published_at = now(), published_by = auth.uid(), closed_at = null
       where activity_id = p_activity_id
       returning * into v_card;
    end if;
  end if;

  insert into public.activity_attendance_tokens (token_hash, activity_id, member_id, epoch)
  select encode(sha256(convert_to(public.attendance_token_for(p_activity_id, m.id, v_card.epoch), 'utf8')), 'hex'),
         p_activity_id, m.id, v_card.epoch
    from public.members m
   where m.status = 'active' and m.deleted_at is null
  on conflict do nothing;
  select count(*) into v_count from public.activity_attendance_tokens where activity_id = p_activity_id;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
  values (auth.uid(), 'ADMIN_PUBLISHED_ATTENDANCE_CARD', 'activities', p_activity_id,
          case when coalesce(p_rotate, false) then 'إعادة إصدار بطاقات الحضور لنشاط' else 'نشر بطاقة الحضور لنشاط' end);

  return jsonb_build_object('published_at', v_card.published_at, 'members', v_count);
end;
$$;

create or replace function public.close_attendance_card(p_activity_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.can_manage_content() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;
  update public.activity_attendance_cards set closed_at = now()
   where activity_id = p_activity_id and closed_at is null;
  if not found then return; end if;
  insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
  values (auth.uid(), 'ADMIN_CLOSED_ATTENDANCE_CARD', 'activities', p_activity_id, 'إغلاق بطاقة الحضور لنشاط');
end;
$$;

-- ---------------------------------------------------------------------
-- 4) بطاقات الحضور المفتوحة للعضو (رموز ثابتة؛ تُنشأ عند الطلب لمن انضمّ بعد النشر)
-- ---------------------------------------------------------------------
create or replace function public.get_my_attendance_cards()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'غير مصرّح لك بهذه العملية'; end if;
  v_id := public.current_member_id();
  if v_id is null or not exists (select 1 from public.members m where m.id = v_id and m.status = 'active' and m.deleted_at is null) then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;

  insert into public.activity_attendance_tokens (token_hash, activity_id, member_id, epoch)
  select encode(sha256(convert_to(public.attendance_token_for(c.activity_id, v_id, c.epoch), 'utf8')), 'hex'),
         c.activity_id, v_id, c.epoch
    from public.activity_attendance_cards c
    join public.activities a on a.id = c.activity_id and a.deleted_at is null
   where c.closed_at is null and c.published_at > now() - interval '48 hours'
  on conflict do nothing;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'activity_id', c.activity_id,
             'title', a.title,
             'date', a.date,
             'token', public.attendance_token_for(c.activity_id, v_id, c.epoch),
             'attended', exists (select 1 from public.activity_attendance x where x.activity_id = c.activity_id and x.member_id = v_id)
           ) order by c.published_at desc)
      from public.activity_attendance_cards c
      join public.activities a on a.id = c.activity_id and a.deleted_at is null
     where c.closed_at is null and c.published_at > now() - interval '48 hours'
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- 5) التسجيل بالمسح (من داخل الموقع) واليدوي والتراجع
-- ---------------------------------------------------------------------
create or replace function public.record_attendance(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_salt   text;
  v_hash   text;
  v_cnt    integer;
  v_act    uuid;
  v_member uuid;
  v_at     timestamptz;
  v_new    boolean := false;
begin
  if auth.uid() is null or not public.can_manage_content() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;

  -- حدّ لكل مسؤول: 600 مسحة/10 دقائق (الذروة الواقعية أقل بكثير)
  select salt into v_salt from public.membership_throttle_secret where id = 1;
  v_hash := encode(sha256(convert_to(coalesce(v_salt, '') || ':attendance-scan:' || auth.uid()::text, 'utf8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_hash, 0));
  select count(*) into v_cnt from public.member_activation_throttle
   where client_hash = v_hash and created_at > now() - interval '10 minutes';
  if v_cnt >= 600 then raise exception 'rate_limited'; end if;
  insert into public.member_activation_throttle (client_hash) values (v_hash);

  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' then
    return jsonb_build_object('result', 'invalid');
  end if;

  select t.activity_id, t.member_id into v_act, v_member
    from public.activity_attendance_tokens t
    join public.activity_attendance_cards c on c.activity_id = t.activity_id and c.epoch = t.epoch
    join public.activities a on a.id = t.activity_id and a.deleted_at is null
    join public.members m on m.id = t.member_id and m.status = 'active' and m.deleted_at is null
   where t.token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex')
     and c.closed_at is null and c.published_at > now() - interval '48 hours';
  if not found then
    return jsonb_build_object('result', 'invalid');
  end if;

  insert into public.activity_attendance (activity_id, member_id, checked_by, method)
  values (v_act, v_member, auth.uid(), 'scan')
  on conflict do nothing
  returning checked_in_at into v_at;
  if found then v_new := true;
  else select x.checked_in_at into v_at from public.activity_attendance x where x.activity_id = v_act and x.member_id = v_member;
  end if;

  return (
    select jsonb_build_object(
      'result', case when v_new then 'recorded' else 'already' end,
      'checked_in_at', v_at,
      'activity', jsonb_build_object('id', v_act, 'title', a.title),
      'member', jsonb_build_object('id', m.id, 'full_name', m.full_name, 'photo_url', m.photo_url,
                                   'university', m.university, 'promotion', m.promotion))
      from public.members m, public.activities a
     where m.id = v_member and a.id = v_act);
end;
$$;

create or replace function public.record_attendance_manual(p_activity_id uuid, p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_at  timestamptz;
  v_new boolean := false;
begin
  if auth.uid() is null or not public.can_manage_content() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;
  if not exists (select 1 from public.activity_attendance_cards c
                  where c.activity_id = p_activity_id and c.closed_at is null and c.published_at > now() - interval '48 hours')
     or not exists (select 1 from public.members m where m.id = p_member_id and m.status = 'active' and m.deleted_at is null) then
    return jsonb_build_object('result', 'invalid');
  end if;
  insert into public.activity_attendance (activity_id, member_id, checked_by, method)
  values (p_activity_id, p_member_id, auth.uid(), 'manual')
  on conflict do nothing
  returning checked_in_at into v_at;
  if found then v_new := true;
  else select x.checked_in_at into v_at from public.activity_attendance x where x.activity_id = p_activity_id and x.member_id = p_member_id;
  end if;
  return jsonb_build_object('result', case when v_new then 'recorded' else 'already' end, 'checked_in_at', v_at);
end;
$$;

create or replace function public.undo_attendance(p_activity_id uuid, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.can_manage_content() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;
  delete from public.activity_attendance where activity_id = p_activity_id and member_id = p_member_id;
  if not found then return; end if;
  insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
  values (auth.uid(), 'ADMIN_UNDID_ATTENDANCE', 'activities', p_activity_id, 'إلغاء تسجيل حضور عضو في نشاط');
end;
$$;

-- ---------------------------------------------------------------------
-- 6) القوائم للمسؤولين
-- ---------------------------------------------------------------------
create or replace function public.get_attendance_roster(p_activity_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_card public.activity_attendance_cards%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;
  select * into v_card from public.activity_attendance_cards where activity_id = p_activity_id;
  if not found then return null; end if;
  return jsonb_build_object(
    'published_at', v_card.published_at,
    'closed_at', v_card.closed_at,
    'open', v_card.closed_at is null and v_card.published_at > now() - interval '48 hours',
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'member_id', m.id, 'full_name', m.full_name, 'photo_url', m.photo_url, 'promotion', m.promotion,
               'attended_at', x.checked_in_at, 'method', x.method) order by m.full_name)
        from public.members m
        left join public.activity_attendance x on x.activity_id = p_activity_id and x.member_id = m.id
       where (m.status = 'active' and m.deleted_at is null) or x.member_id is not null
    ), '[]'::jsonb));
end;
$$;

create or replace function public.get_attendance_cards_overview()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'activity_id', c.activity_id,
             'open', c.closed_at is null and c.published_at > now() - interval '48 hours',
             'attended', (select count(*) from public.activity_attendance x where x.activity_id = c.activity_id)))
      from public.activity_attendance_cards c
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- 7) الصلاحيات
-- ---------------------------------------------------------------------
revoke all on function public.attendance_token_for(uuid, uuid, integer)  from public, anon, authenticated;
revoke all on function public.publish_attendance_card(uuid, boolean)     from public, anon, authenticated;
revoke all on function public.close_attendance_card(uuid)                from public, anon, authenticated;
revoke all on function public.get_my_attendance_cards()                  from public, anon, authenticated;
revoke all on function public.record_attendance(text)                    from public, anon, authenticated;
revoke all on function public.record_attendance_manual(uuid, uuid)       from public, anon, authenticated;
revoke all on function public.undo_attendance(uuid, uuid)                from public, anon, authenticated;
revoke all on function public.get_attendance_roster(uuid)                from public, anon, authenticated;
revoke all on function public.get_attendance_cards_overview()            from public, anon, authenticated;
grant execute on function public.publish_attendance_card(uuid, boolean)  to authenticated;
grant execute on function public.close_attendance_card(uuid)             to authenticated;
grant execute on function public.get_my_attendance_cards()               to authenticated;
grant execute on function public.record_attendance(text)                 to authenticated;
grant execute on function public.record_attendance_manual(uuid, uuid)    to authenticated;
grant execute on function public.undo_attendance(uuid, uuid)             to authenticated;
grant execute on function public.get_attendance_roster(uuid)             to authenticated;
grant execute on function public.get_attendance_cards_overview()         to authenticated;

notify pgrst, 'reload schema';

commit;
