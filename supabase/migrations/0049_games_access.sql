-- ============================================================
-- 0049_games_access.sql — بوّابة الوصول إلى وحدة الألعاب (IAE Games) — المرحلة 1: دالتان فقط
--
-- السياسة المعتمدة:
--   1) عضو: members.status = 'active' + صف في member_memberships للموسم الحالي (site_settings.current_season).
--      وجود الصف وحده يكفي (هو تعريف «منخرط هذا الموسم» في كل النظام: 0014/0040)؛ لا فحص إضافي لمعاملة الميزانية.
--   2) كل الأدوار الإدارية القائمة: is_admin() = أي صف نشط في profiles أيًّا كان دوره. لا قائمة أدوار مكتوبة هنا:
--      فيشمل الأدوار العشرة الحالية وأي قيمة تُضاف لاحقًا إلى admin_role دون تعديل هذا الملف.
--   3) أي حساب موثّق آخر (بلا حساب عضو، أو عضو غير نشط/غير منخرط هذا الموسم، أو لا موسم حالي): مرفوض. الرفض هو الأصل (fail closed).
--
-- المصادقة الثنائية (MFA): تبقى مفروضة كما هي. mfa_satisfied() (0024) = «لا عامل موثّق، أو الجلسة aal2».
--   تُفحص أولًا وعلى كل المسارات، فمن فعّل MFA ودخل بـ aal1 يُرفض حتى لو كان مسؤولًا أو عضوًا منخرطًا
--   (لا تسلّل عبر مسار العضو لحساب مزدوج). من لم يفعّلها لا يتغيّر عليه شيء.
--
-- ما يضيفه (إضافة فقط، بلا جداول ولا سياسات ولا أعمدة ولا بيانات):
--   1) can_access_games()  — boolean. المرجع الوحيد للتفويض: تستعملها لاحقًا سياسات RLS ودوال RPC الخاصة بالألعاب (0050+).
--      في السياسات اكتب (select public.can_access_games()) ليُحسب مرة واحدة للاستعلام لا لكل صف.
--   2) get_games_access()  — jsonb للواجهة فقط (رسالة الرفض المناسبة): {allowed, reason[, season]}.
--      allowed يأتي دائمًا من can_access_games() نفسها فلا يختلف الاثنان. الواجهة لا تُعدّ حدًّا أمنيًا؛ الحدّ هو RLS/RPC.
--      reason: admin | member | unauthenticated | mfa_required | no_member_account | no_season | member_inactive | membership_not_paid
--
-- ما لا يمسّه: profiles، member_accounts، members، member_memberships، site_settings وسياساتها،
--   is_admin / current_admin_role / mfa_satisfied / current_member_id / can_* القائمة، admin_role، أي Edge Function أو واجهة.
--
-- يتطلب: 0014 (member_memberships, site_settings) و0024 (is_admin, mfa_satisfied) و0046 (current_member_id بنسخة الحساب المزدوج).
-- آمن لإعادة التشغيل (create or replace). الرجوع: supabase/rollback/0049_games_access_down.sql
-- ⚠️ تجربة جافة أولًا: استبدل `commit;` الأخيرة بـ `rollback;` ثم شغّل الملف، وإن نجح أعدها `commit;`.
-- ⚠️ بعد التطبيق شغّل supabase/tests/games_access_smoke.sql (يُلغى بالكامل بـ rollback ولا يترك أثرًا).
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public.is_admin()') is null or to_regprocedure('public.mfa_satisfied()') is null then
    raise exception 'شغّل 0024_mfa_enforcement.sql أولاً';
  end if;
  if to_regprocedure('public.current_member_id()') is null
     or not exists (select 1 from pg_proc p
                     where p.oid = to_regprocedure('public.current_member_id()')::oid
                       and p.prosrc like '%admin_linked%') then
    raise exception 'شغّل 0046_dual_accounts_and_board_card.sql أولاً (current_member_id بنسخة 0046)';
  end if;
  if to_regclass('public.members') is null
     or to_regclass('public.member_memberships') is null
     or to_regclass('public.site_settings') is null then
    raise exception 'شغّل 0014_membership_flow.sql أولاً';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) can_access_games(): قرار التفويض الوحيد
-- ---------------------------------------------------------------------
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

  -- MFA أولًا وعلى كل المسارات: لا يتجاوزها مسار العضو ولا الدور الإداري
  if not public.mfa_satisfied() then return false; end if;

  -- أي دور إداري نشط (بلا قائمة أدوار): يطابق is_admin() التي تعتمد عليها كل سياسات الإدارة
  if public.is_admin() then return true; end if;

  -- عضو: حساب عضو نشط (current_member_id تستبعد العضو المحذوف والحساب المعطّل وفصل الحسابين)
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

-- ---------------------------------------------------------------------
-- 2) get_games_access(): حالة الوصول وسببها للواجهة (لا تمنح شيئًا؛ القرار الفعلي في can_access_games)
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
  v_status member_status;
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

  -- مرفوض: نحدّد السبب لعرض رسالة مناسبة فقط
  if not public.mfa_satisfied() then
    return jsonb_build_object('allowed', false, 'reason', 'mfa_required');
  end if;

  v_id := public.current_member_id();
  if v_id is null then
    return jsonb_build_object('allowed', false, 'reason', 'no_member_account');
  end if;

  if v_season is null then
    return jsonb_build_object('allowed', false, 'reason', 'no_season');
  end if;

  select m.status into v_status from public.members m where m.id = v_id and m.deleted_at is null;
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'no_member_account');
  end if;
  if v_status <> 'active' then
    return jsonb_build_object('allowed', false, 'reason', 'member_inactive');
  end if;

  return jsonb_build_object('allowed', false, 'reason', 'membership_not_paid', 'season', v_season);
end;
$$;

-- ---------------------------------------------------------------------
-- 3) الصلاحيات: authenticated فقط (anon وpublic ممنوعان). سياسات RLS تحتاج EXECUTE للدور المستدعي.
-- ---------------------------------------------------------------------
revoke all on function public.can_access_games() from public, anon, authenticated;
revoke all on function public.get_games_access() from public, anon, authenticated;
grant execute on function public.can_access_games() to authenticated;
grant execute on function public.get_games_access() to authenticated;

notify pgrst, 'reload schema';

commit;
