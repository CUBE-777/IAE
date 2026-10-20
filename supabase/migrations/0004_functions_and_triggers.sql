-- ============================================================
-- 0004_functions_and_triggers.sql
-- ============================================================

-- ---------- تحديث updated_at تلقائيًا ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles','members','membership_requests','activities',
    'gallery','board_members','announcements','site_content'
  ]
  loop
    execute format(
      'drop trigger if exists trg_set_updated_at on public.%I;
       create trigger trg_set_updated_at
       before update on public.%I
       for each row execute function public.set_updated_at();',
      t, t
    );
  end loop;
end $$;

-- ============================================================
-- approve_membership_request(request_id, reviewer_id)
-- يحوّل الطلب إلى عضو تلقائيًا بدون إعادة إدخال يدوي، ويُسجّل audit log
-- ============================================================
create or replace function public.approve_membership_request(
  p_request_id uuid,
  p_reviewer_id uuid
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_request public.membership_requests%rowtype;
  v_member_id uuid;
begin
  if not public.can_manage_members() then
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
        reviewed_by = p_reviewer_id,
        reviewed_at = now()
    where id = p_request_id;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, metadata)
  values (
    p_reviewer_id, 'ADMIN_APPROVED_REQUEST', 'membership_requests', p_request_id,
    'تمت الموافقة على طلب الانخراط وتحويله إلى عضو',
    jsonb_build_object('member_id', v_member_id)
  );

  return v_member_id;
end;
$$;

-- ============================================================
-- reject_membership_request(request_id, reviewer_id, reason)
-- ============================================================
create or replace function public.reject_membership_request(
  p_request_id uuid,
  p_reviewer_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
as $$
begin
  if not public.can_manage_members() then
    raise exception 'غير مصرح لك بهذه العملية';
  end if;

  update public.membership_requests
    set status = 'rejected',
        rejection_reason = p_reason,
        reviewed_by = p_reviewer_id,
        reviewed_at = now()
    where id = p_request_id and status = 'pending';

  if not found then
    raise exception 'الطلب غير موجود أو تمت معالجته مسبقًا';
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, metadata)
  values (
    p_reviewer_id, 'ADMIN_REJECTED_REQUEST', 'membership_requests', p_request_id,
    'تم رفض طلب الانخراط',
    jsonb_build_object('reason', p_reason)
  );
end;
$$;
