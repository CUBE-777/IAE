-- ============================================================
-- 0006_security_hardening.sql
-- إصلاحات أمنية حرجة (CRITICAL/HIGH):
--
-- 1) approve_membership_request / reject_membership_request كانتا تثقان بمعرّف
--    "p_reviewer_id" القادم من العميل بدل اشتقاقه من الجلسة (auth.uid()).
--    أي مستخدم مصرح له بتنفيذ الدالة كان يستطيع تمرير أي UUID آخر فيُسجَّل
--    في membership_requests.reviewed_by و audit_logs.user_id باسم شخص آخر
--    (انتحال/تزوير سجل تدقيق). نُصلح ذلك باستخدام auth.uid() داخل الدالة.
--
-- 2) كل دالة SECURITY DEFINER يجب أن تثبّت search_path صراحة لمنع هجمات
--    "search_path hijacking" (تعريف كائن باسم مطابق في schema آخر قابل للكتابة).
-- ============================================================

-- ---------- إعادة تثبيت search_path على دوال الأدوار الحالية ----------
create or replace function public.current_admin_role()
returns admin_role
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select role from public.profiles
  where id = auth.uid() and is_active = true
  limit 1;
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.current_admin_role() = 'super_admin';
$$;

create or replace function public.can_manage_members()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.current_admin_role() in ('super_admin', 'members_manager');
$$;

create or replace function public.can_manage_content()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.current_admin_role() in ('super_admin', 'editor');
$$;

-- ---------- إعادة إنشاء approve_membership_request بدون معامل reviewer_id ----------
drop function if exists public.approve_membership_request(uuid, uuid);

create or replace function public.approve_membership_request(
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.membership_requests%rowtype;
  v_member_id uuid;
  v_reviewer_id uuid := auth.uid();
begin
  if v_reviewer_id is null or not public.can_manage_members() then
    raise exception 'غير مصرح لك بهذه العملية';
  end if;

  select * into v_request from public.membership_requests where id = p_request_id;
  if not found then
    raise exception 'طلب الانخراط غير موجود';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'تم معالجة هذا الطلب مسبقًا';
  end if;

  insert into public.members (
    full_name, email, phone, promotion, track, profession, city, status
  ) values (
    v_request.full_name, v_request.email, v_request.phone,
    v_request.promotion, v_request.track, v_request.profession,
    v_request.city, 'active'
  )
  returning id into v_member_id;

  update public.membership_requests
    set status = 'approved',
        reviewed_by = v_reviewer_id,
        reviewed_at = now()
    where id = p_request_id;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, metadata)
  values (
    v_reviewer_id, 'ADMIN_APPROVED_REQUEST', 'membership_requests', p_request_id,
    'تمت الموافقة على طلب الانخراط وتحويله إلى عضو',
    jsonb_build_object('member_id', v_member_id)
  );

  return v_member_id;
end;
$$;

-- ---------- إعادة إنشاء reject_membership_request بدون معامل reviewer_id ----------
drop function if exists public.reject_membership_request(uuid, uuid, text);

create or replace function public.reject_membership_request(
  p_request_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reviewer_id uuid := auth.uid();
begin
  if v_reviewer_id is null or not public.can_manage_members() then
    raise exception 'غير مصرح لك بهذه العملية';
  end if;

  update public.membership_requests
    set status = 'rejected',
        rejection_reason = p_reason,
        reviewed_by = v_reviewer_id,
        reviewed_at = now()
    where id = p_request_id and status = 'pending';

  if not found then
    raise exception 'الطلب غير موجود أو تمت معالجته مسبقًا';
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, metadata)
  values (
    v_reviewer_id, 'ADMIN_REJECTED_REQUEST', 'membership_requests', p_request_id,
    'تم رفض طلب الانخراط',
    jsonb_build_object('reason', p_reason)
  );
end;
$$;

-- ---------- تقييد صلاحية التنفيذ (EXECUTE) على الدوال الحساسة ----------
-- فقط المستخدمون المسجّلون (authenticated) يحاولون استدعاء هذه الدوال؛ الفحص
-- الفعلي للصلاحية يتم داخل الدالة عبر can_manage_members()/auth.uid(), لكن
-- منع anon من التنفيذ أصلاً يقلّل سطح الهجوم.
revoke execute on function public.approve_membership_request(uuid) from public, anon;
revoke execute on function public.reject_membership_request(uuid, text) from public, anon;
grant execute on function public.approve_membership_request(uuid) to authenticated;
grant execute on function public.reject_membership_request(uuid, text) to authenticated;
