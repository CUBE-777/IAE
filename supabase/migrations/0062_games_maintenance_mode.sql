-- ============================================================
-- 0062_games_maintenance_mode.sql — وضع الصيانة لقسم الألعاب (IAE Games)
--
-- الفكرة: مفتاح واحد مركزي في جدول site_settings الموجود (لا جدول جديد):
--   key = 'games_section_status'  ،  value ∈ { 'enabled' , 'maintenance' }
--
-- الكتابة: سياسات site_settings القائمة (0003) تحصرها في is_super_admin() = super_admin + developer (0012). لا تُمَسّ.
--   يُضاف فقط مشغّل تحقق يرفض أي قيمة غير القيمتين أعلاه لهذا المفتاح (دفاع في العمق).
--
-- الحماية على الخادم (لا تعتمد على إخفاء الروابط):
--   * can_access_games() — بوّابة اللاعب التي تستعملها كل سياسات RLS ودوال RPC اللاعب (0050 → 0059) —
--     صارت: games_section_enabled() AND games_base_access(). أثناء الصيانة تعيد false للجميع ⇒
--     لا قراءة للكتالوج ولا بدء/تسليم محاولات ولا لوحة متصدرين ولا مسارات.
--   * games_base_access() = منطق 0049 حرفيًا (MFA + إداري نشط + عضو منخرط)، بلا أي تغيير في معناه.
--   * can_manage_games() — بوّابة الإدارة — تعتمد على games_base_access() لا على can_access_games()،
--     فيبقى super_admin/developer قادرين على إدارة الألعاب (وإعادة التفعيل) أثناء الصيانة. بلا صيانة: سلوك مطابق لـ 0052.
--   * get_games_access() يعيد reason = 'maintenance' للمؤهَّلين فقط أثناء الصيانة (فيظهر لهم رابط الألعاب وصفحة الصيانة)،
--     ولغير المؤهَّلين الأسباب القديمة كما هي (لا يتسرّب شيء).
--   * get_games_section_status() — نص 'enabled' | 'maintenance' للواجهة (anon + authenticated؛ الحالة عامة أصلًا بقراءة site_settings).
--
-- التزامن: site_settings تُضاف إلى منشور supabase_realtime (إن وُجد) ليلتقط المتصفح التغيير فورًا؛ والواجهة تعيد الجلب
--   بالمؤقّت وعند العودة للتبويب أيضًا، فلا يعتمد التزامن على Realtime وحده.
--
-- الافتراضي (fail-open عمدًا للقراءة): لا صف / قيمة فارغة ⇒ enabled (يحفظ سلوك الإنتاج الحالي). القيمة غير الصالحة تمنعها المشغّلة.
-- لا يحذف ولا يعدّل أي لعبة أو تحدٍّ أو محاولة أو نقاط أو مستخدم. سياسات RLS الموجودة لا تُعاد كتابتها (تتأثر عبر الدالة فقط).
--
-- يتطلب: 0049 (can_access_games, get_games_access) و0052 (can_manage_games) و0012 (is_super_admin) و0014 (site_settings).
-- آمن لإعادة التشغيل. الرجوع: supabase/rollback/0062_games_maintenance_mode_down.sql
-- ⚠️ تجربة جافة أولًا: استبدل `commit;` الأخيرة بـ `rollback;` ثم شغّل الملف، وإن نجح أعدها `commit;`.
-- ⚠️ بعد التطبيق شغّل supabase/tests/games_maintenance_smoke.sql (يُلغى بالكامل بـ rollback).
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.site_settings') is null then
    raise exception 'شغّل 0014_membership_flow.sql أولاً (site_settings)';
  end if;
  if to_regprocedure('public.can_access_games()') is null or to_regprocedure('public.get_games_access()') is null then
    raise exception 'شغّل 0049_games_access.sql أولاً';
  end if;
  if to_regprocedure('public.can_manage_games()') is null or to_regprocedure('public.is_super_admin()') is null then
    raise exception 'شغّل 0052_games_admin.sql أولاً';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) الصف الافتراضي: enabled (لا يغيّر قيمة موجودة عند إعادة التشغيل)
-- ---------------------------------------------------------------------
insert into public.site_settings (key, value)
values ('games_section_status', 'enabled')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2) مشغّل تحقق القيمة (لهذا المفتاح فقط؛ بقية المفاتيح لا تتأثر)
-- ---------------------------------------------------------------------
create or replace function public.site_settings_validate_games_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.key = 'games_section_status' then
    new.value := lower(btrim(coalesce(new.value, '')));
    if new.value not in ('enabled', 'maintenance') then
      raise exception 'invalid_games_section_status' using errcode = '22023';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_site_settings_validate_games_status on public.site_settings;
create trigger trg_site_settings_validate_games_status
  before insert or update on public.site_settings
  for each row execute function public.site_settings_validate_games_status();

-- ---------------------------------------------------------------------
-- 3) games_section_enabled(): المرجع الوحيد لحالة القسم على الخادم
-- ---------------------------------------------------------------------
create or replace function public.games_section_enabled()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select nullif(lower(btrim(value)), '') from public.site_settings where key = 'games_section_status'),
    'enabled'
  ) is distinct from 'maintenance';
$$;

-- داخلية: تستدعيها دوال SECURITY DEFINER فقط (can_access_games / get_games_section_status) فلا منح لأي دور.
revoke all on function public.games_section_enabled() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4) games_base_access(): منطق 0049 حرفيًا (بلا الصيانة). داخلية: تستدعيها دوال SECURITY DEFINER فقط.
-- ---------------------------------------------------------------------
create or replace function public.games_base_access()
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

  -- MFA أولًا وعلى كل المسارات: لا يتجاوزها مسار العضو ولا الدور الإداري
  if not public.mfa_satisfied() then return false; end if;

  -- أي دور إداري نشط (بلا قائمة أدوار). إداري بكلمة مرور مؤقتة مرفوض حتى يغيّرها، دون سقوط إلى مسار العضو.
  if public.is_admin() then
    return not exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and p.must_change_password is true
    );
  end if;

  -- عضو: حساب عضو نشط
  v_id := public.current_member_id();
  if v_id is null then return false; end if;

  -- لا موسم حالي = لا انخراط يُعتدّ به: رفض
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

revoke all on function public.games_base_access() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5) can_access_games(): الآن = القسم مفعّل AND الأهلية الأساسية. (الاسم والتوقيع والمنح كما هي: سياسات RLS ودوال RPC لا تتغيّر)
-- ---------------------------------------------------------------------
create or replace function public.can_access_games()
returns boolean
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if not public.games_section_enabled() then return false; end if;
  return public.games_base_access();
end;
$$;

revoke all on function public.can_access_games() from public, anon, authenticated;
grant execute on function public.can_access_games() to authenticated;

-- ---------------------------------------------------------------------
-- 6) can_manage_games(): تعريف 0052 نفسه لكن فوق الأهلية الأساسية فلا تُقفل الإدارة أثناء الصيانة
-- ---------------------------------------------------------------------
create or replace function public.can_manage_games()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.games_base_access() and coalesce(public.is_super_admin(), false);
$$;

revoke all on function public.can_manage_games() from public, anon, authenticated;
grant execute on function public.can_manage_games() to authenticated;

-- ---------------------------------------------------------------------
-- 7) get_games_access(): نفس 0049 + سبب 'maintenance' للمؤهَّلين فقط
-- ---------------------------------------------------------------------
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

  -- مؤهَّل أساسًا لكن can_access_games رفضت ⇒ السبب الوحيد الممكن: الصيانة
  if public.games_base_access() then
    return jsonb_build_object('allowed', false, 'reason', 'maintenance');
  end if;

  -- مرفوض: نحدّد السبب لعرض رسالة مناسبة فقط
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

revoke all on function public.get_games_access() from public, anon, authenticated;
grant execute on function public.get_games_access() to authenticated;

-- ---------------------------------------------------------------------
-- 8) get_games_section_status(): للواجهة (عام: الحالة ليست سرًّا ولا تكشف بيانات)
-- ---------------------------------------------------------------------
create or replace function public.get_games_section_status()
returns text
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select case when public.games_section_enabled() then 'enabled' else 'maintenance' end;
$$;

revoke all on function public.get_games_section_status() from public, anon, authenticated;
grant execute on function public.get_games_section_status() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 9) Realtime: بثّ تغييرات site_settings (إن وُجد المنشور ولم تكن الجدول فيه). RLS تُطبَّق على البثّ (القراءة عامة).
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'site_settings'
     ) then
    alter publication supabase_realtime add table public.site_settings;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
