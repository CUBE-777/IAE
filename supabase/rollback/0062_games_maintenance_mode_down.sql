-- ============================================================
-- 0062_games_maintenance_mode_down.sql — الرجوع عن وضع الصيانة لقسم الألعاب
--
-- يعيد can_access_games() و get_games_access() إلى تعريف 0049 حرفيًا، و can_manage_games() إلى تعريف 0052 حرفيًا،
-- ثم يُسقط ما أضافته 0062: المشغّل، الدوال الأربع، وصف الإعداد games_section_status.
-- ⚠️ إن كانت الصيانة مفعّلة لحظة الرجوع فستُفتح الألعاب فورًا (لا مفتاح بعده).
-- لا يمسّ أي لعبة أو تحدٍّ أو محاولة أو نقاط أو مستخدم، ولا سياسات RLS.
-- لا يُزيل site_settings من منشور supabase_realtime (قد تكون مضافة قبل 0062 لغرض آخر؛ لا ضرر من بقائها).
-- آمن لإعادة التشغيل.
-- ============================================================
begin;

-- 1) المشغّل أولًا (يعتمد على دالته)
drop trigger if exists trg_site_settings_validate_games_status on public.site_settings;
drop function if exists public.site_settings_validate_games_status();

-- 2) استرجاع تعريف 0049 لبوّابة اللاعب
create or replace function public.can_access_games()
returns boolean
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_id     uuid;
  v_season text;
begin
  if auth.uid() is null then return false; end if;
  if not public.mfa_satisfied() then return false; end if;
  if public.is_admin() then
    return not exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and p.must_change_password is true
    );
  end if;
  v_id := public.current_member_id();
  if v_id is null then return false; end if;
  select nullif(btrim(value), '') into v_season from public.site_settings where key = 'current_season';
  if v_season is null then return false; end if;
  return exists (
    select 1
      from public.members m
      join public.member_memberships mm on mm.member_id = m.id
     where m.id = v_id
       and m.status = 'active'
       and m.deleted_at is null
       and mm.season = v_season
  );
end;
$$;

-- 3) استرجاع تعريف 0052
create or replace function public.can_manage_games()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.can_access_games() and coalesce(public.is_super_admin(), false);
$$;

-- 4) استرجاع تعريف 0049 لـ get_games_access (بلا سبب maintenance)
create or replace function public.get_games_access()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_id     uuid;
  v_season text;
  v_status text;
begin
  if auth.uid() is null then
    return jsonb_build_object('allowed', false, 'reason', 'unauthenticated');
  end if;
  select nullif(btrim(value), '') into v_season from public.site_settings where key = 'current_season';
  if public.can_access_games() then
    if public.is_admin() then
      return jsonb_build_object('allowed', true, 'reason', 'admin');
    end if;
    return jsonb_build_object('allowed', true, 'reason', 'member', 'season', v_season);
  end if;
  if not public.mfa_satisfied() then
    return jsonb_build_object('allowed', false, 'reason', 'mfa_required');
  end if;
  if public.is_admin() then
    return jsonb_build_object('allowed', false, 'reason', 'password_change_required');
  end if;
  v_id := public.current_member_id();
  if v_id is null then
    return jsonb_build_object('allowed', false, 'reason', 'no_member_account');
  end if;
  if v_season is null then
    return jsonb_build_object('allowed', false, 'reason', 'no_season');
  end if;
  select m.status::text into v_status from public.members m where m.id = v_id and m.deleted_at is null;
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'no_member_account');
  end if;
  if v_status is distinct from 'active' then
    return jsonb_build_object('allowed', false, 'reason', 'member_inactive');
  end if;
  return jsonb_build_object('allowed', false, 'reason', 'membership_not_paid', 'season', v_season);
end;
$$;

revoke all on function public.can_access_games() from public, anon, authenticated;
revoke all on function public.can_manage_games() from public, anon, authenticated;
revoke all on function public.get_games_access() from public, anon, authenticated;
grant execute on function public.can_access_games() to authenticated;
grant execute on function public.can_manage_games() to authenticated;
grant execute on function public.get_games_access() to authenticated;

-- 5) إسقاط الدوال الجديدة (بعد أن لم يعد أي شيء يستدعيها)
drop function if exists public.get_games_section_status();
drop function if exists public.games_base_access();
drop function if exists public.games_section_enabled();

-- 6) صف الإعداد
delete from public.site_settings where key = 'games_section_status';

notify pgrst, 'reload schema';
commit;
