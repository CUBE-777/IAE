-- 0051_activity_invitations.sql
-- دعوات شخصية لأنشطة النادي: إعدادات لكل نشاط + دعوة لكل ضيف برابط /invite/<token>.
-- كل الوصول عبر دوال security definer (نفس نمط 0041): لا سياسات للجداول، والصفحة العامة تستدعي دالتين فقط.

create table if not exists public.activity_invitation_settings (
  activity_id    uuid primary key references public.activities(id) on delete cascade,
  starts_at      timestamptz not null,
  headline_1     text not null check (char_length(headline_1) between 1 and 60),
  headline_2     text not null check (char_length(headline_2) between 1 and 60),
  intro_text     text not null check (char_length(intro_text) between 1 and 200),
  subtitle_text  text not null check (char_length(subtitle_text) between 1 and 200),
  venue_text     text check (venue_text is null or char_length(venue_text) <= 200),
  thanks_text    text not null check (char_length(thanks_text) between 1 and 200),
  allow_download boolean not null default true,
  updated_by     uuid,
  updated_at     timestamptz not null default now()
);

create table if not exists public.activity_invitations (
  id             uuid primary key default gen_random_uuid(),
  activity_id    uuid not null references public.activities(id) on delete cascade,
  token          text not null unique
                   default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  guest_name     text not null check (char_length(btrim(guest_name)) between 1 and 120),
  guest_title    text check (guest_title is null or char_length(guest_title) <= 120),
  gender         text not null default 'm' check (gender in ('m', 'f')),
  rsvp           text check (rsvp in ('yes', 'no')),
  rsvp_at        timestamptz,
  opened_at      timestamptz,
  last_opened_at timestamptz,
  open_count     integer not null default 0,
  revoked_at     timestamptz,
  created_by     uuid,
  created_at     timestamptz not null default now()
);
create index if not exists activity_invitations_activity_idx on public.activity_invitations (activity_id, created_at);

alter table public.activity_invitation_settings enable row level security;
alter table public.activity_invitations enable row level security;
revoke all on table public.activity_invitation_settings from anon, authenticated;
revoke all on table public.activity_invitations from anon, authenticated;

-- ---------------------------------------------------------------- الإدارة
create or replace function public.get_activity_invitations(p_activity_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_set jsonb; v_list jsonb;
begin
  if auth.uid() is null or not public.can_manage_content() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;
  select jsonb_build_object(
           'starts_local', to_char(s.starts_at at time zone 'Africa/Casablanca', 'YYYY-MM-DD"T"HH24:MI'),
           'headline_1', s.headline_1, 'headline_2', s.headline_2, 'intro_text', s.intro_text,
           'subtitle_text', s.subtitle_text, 'venue_text', coalesce(s.venue_text, ''),
           'thanks_text', s.thanks_text, 'allow_download', s.allow_download)
    into v_set from public.activity_invitation_settings s where s.activity_id = p_activity_id;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'token', i.token, 'guest_name', i.guest_name, 'guest_title', i.guest_title,
           'gender', i.gender, 'rsvp', i.rsvp, 'open_count', i.open_count,
           'opened_at', i.opened_at, 'revoked_at', i.revoked_at) order by i.created_at), '[]'::jsonb)
    into v_list from public.activity_invitations i where i.activity_id = p_activity_id;
  return jsonb_build_object('settings', v_set, 'invitations', v_list);
end $$;

create or replace function public.save_invitation_settings(p_activity_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_local text := nullif(btrim(p->>'starts_local'), ''); v_start timestamptz;
begin
  if auth.uid() is null or not public.can_manage_content() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;
  if not exists (select 1 from public.activities a where a.id = p_activity_id and a.deleted_at is null) then
    raise exception 'النشاط غير موجود';
  end if;
  if v_local is null then raise exception 'حدّد تاريخ ووقت الحفل'; end if;
  v_start := v_local::timestamp at time zone 'Africa/Casablanca';

  insert into public.activity_invitation_settings as s
    (activity_id, starts_at, headline_1, headline_2, intro_text, subtitle_text, venue_text, thanks_text, allow_download, updated_by)
  values (p_activity_id, v_start,
    left(coalesce(nullif(btrim(p->>'headline_1'), ''), 'CÉRÉMONIE'), 60),
    left(coalesce(nullif(btrim(p->>'headline_2'), ''), 'D’ACCUEIL'), 60),
    left(coalesce(nullif(btrim(p->>'intro_text'), ''), 'Vous êtes cordialement invité{e} à la'), 200),
    left(coalesce(nullif(btrim(p->>'subtitle_text'), ''), 'du club Intelligence Artificielle Embarquée'), 200),
    nullif(left(btrim(coalesce(p->>'venue_text', '')), 200), ''),
    left(coalesce(nullif(btrim(p->>'thanks_text'), ''), 'Votre présence est un honneur pour nous'), 200),
    coalesce((p->>'allow_download')::boolean, true), auth.uid())
  on conflict (activity_id) do update set
    starts_at = excluded.starts_at, headline_1 = excluded.headline_1, headline_2 = excluded.headline_2,
    intro_text = excluded.intro_text, subtitle_text = excluded.subtitle_text, venue_text = excluded.venue_text,
    thanks_text = excluded.thanks_text, allow_download = excluded.allow_download,
    updated_by = auth.uid(), updated_at = now();

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
  values (auth.uid(), 'ADMIN_SAVED_INVITATION_SETTINGS', 'activities', p_activity_id, 'حفظ إعدادات دعوات نشاط');
end $$;

create or replace function public.add_invitations(p_activity_id uuid, p_guests jsonb)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  if auth.uid() is null or not public.can_manage_content() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;
  if jsonb_typeof(p_guests) <> 'array' or jsonb_array_length(p_guests) not between 1 and 200 then
    raise exception 'قائمة الضيوف غير صالحة (من 1 إلى 200 في المرة الواحدة)';
  end if;
  if not exists (select 1 from public.activity_invitation_settings where activity_id = p_activity_id) then
    raise exception 'احفظ إعدادات الدعوة أولًا';
  end if;
  if (select count(*) from public.activity_invitations where activity_id = p_activity_id) + jsonb_array_length(p_guests) > 500 then
    raise exception 'الحد الأقصى 500 دعوة للنشاط';
  end if;
  insert into public.activity_invitations (activity_id, guest_name, guest_title, gender, created_by)
  select p_activity_id, left(btrim(g->>'name'), 120),
         nullif(left(btrim(coalesce(g->>'title', '')), 120), ''),
         case when g->>'gender' = 'f' then 'f' else 'm' end, auth.uid()
    from jsonb_array_elements(p_guests) g
   where nullif(btrim(coalesce(g->>'name', '')), '') is not null;
  get diagnostics v_n = row_count;
  insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
  values (auth.uid(), 'ADMIN_CREATED_INVITATIONS', 'activities', p_activity_id, 'إضافة ' || v_n || ' دعوة');
  return v_n;
end $$;

create or replace function public.update_invitation(p_id uuid, p_name text, p_title text, p_gender text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.can_manage_content() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;
  update public.activity_invitations
     set guest_name = left(btrim(p_name), 120),
         guest_title = nullif(left(btrim(coalesce(p_title, '')), 120), ''),
         gender = case when p_gender = 'f' then 'f' else 'm' end
   where id = p_id;
end $$;

create or replace function public.set_invitation_revoked(p_id uuid, p_revoked boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_act uuid;
begin
  if auth.uid() is null or not public.can_manage_content() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;
  update public.activity_invitations
     set revoked_at = case when p_revoked then now() else null end
   where id = p_id returning activity_id into v_act;
  insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
  values (auth.uid(), 'ADMIN_REVOKED_INVITATION', 'activities', v_act,
          case when p_revoked then 'إلغاء دعوة' else 'إعادة تفعيل دعوة' end);
end $$;

create or replace function public.delete_invitation(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_act uuid;
begin
  if auth.uid() is null or not public.can_manage_content() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;
  delete from public.activity_invitations where id = p_id returning activity_id into v_act;
  insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
  values (auth.uid(), 'ADMIN_DELETED_INVITATION', 'activities', v_act, 'حذف دعوة');
end $$;

-- ---------------------------------------------------------------- الصفحة العامة (anon)
create or replace function public.get_invitation(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  update public.activity_invitations i
     set open_count = i.open_count + 1, opened_at = coalesce(i.opened_at, now()), last_opened_at = now()
    from public.activities a
   where i.token = p_token and i.revoked_at is null and a.id = i.activity_id and a.deleted_at is null
  returning i.guest_name, i.guest_title, i.gender, i.rsvp, i.activity_id into r;
  if not found then return null; end if;
  return (select jsonb_build_object(
            'guest_name', r.guest_name, 'guest_title', r.guest_title, 'gender', r.gender, 'rsvp', r.rsvp,
            'starts_at', s.starts_at, 'headline_1', s.headline_1, 'headline_2', s.headline_2,
            'intro_text', s.intro_text, 'subtitle_text', s.subtitle_text, 'venue_text', coalesce(s.venue_text, ''),
            'thanks_text', s.thanks_text, 'allow_download', s.allow_download)
            from public.activity_invitation_settings s where s.activity_id = r.activity_id);
end $$;

create or replace function public.respond_invitation(p_token text, p_rsvp text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_rsvp not in ('yes', 'no') then return false; end if;
  update public.activity_invitations set rsvp = p_rsvp, rsvp_at = now()
   where token = p_token and revoked_at is null;
  return found;
end $$;

-- ---------------------------------------------------------------- الصلاحيات
revoke all on function public.get_activity_invitations(uuid), public.save_invitation_settings(uuid, jsonb),
  public.add_invitations(uuid, jsonb), public.update_invitation(uuid, text, text, text),
  public.set_invitation_revoked(uuid, boolean), public.delete_invitation(uuid) from public, anon;
grant execute on function public.get_activity_invitations(uuid), public.save_invitation_settings(uuid, jsonb),
  public.add_invitations(uuid, jsonb), public.update_invitation(uuid, text, text, text),
  public.set_invitation_revoked(uuid, boolean), public.delete_invitation(uuid) to authenticated;

revoke all on function public.get_invitation(text), public.respond_invitation(text, text) from public;
grant execute on function public.get_invitation(text), public.respond_invitation(text, text) to anon, authenticated;
