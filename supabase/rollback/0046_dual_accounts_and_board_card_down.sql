-- ============================================================
-- 0046_dual_accounts_and_board_card_down.sql — الرجوع عن 0046
--
-- يحذف: دوال الدمج وبطاقة المكتب والسياسة الجديدة والفهرس الفريد، ويُعيد 0035/0037 كما كانت:
--   مشغّل الحماية و current_member_id() بنسختيهما الأصليتين، ودوال الاستعادة الثلاث بنسخة 0037.
-- ⚠️ إعادة دوال الاستعادة لنسخة 0037 تعيد فتح ثغرة تغيير كلمة مرور حساب إداري عبر رابط الأعضاء.
--    لا ترجع عن هذا الملف قبل فصل أي حساب مزدوج (admin_linked) وحذف أعمدته.
-- ⚠️ الحسابات المزدوجة ستفقد جانب المنخرط (current_member_id تعيد null لمن له profiles)، ولا يُحذف أي مستخدم.
-- آمن لإعادة التشغيل.
-- ============================================================

begin;

drop policy if exists "member_board_photo_content_select" on storage.objects;
drop function if exists public.board_member_photo_readable(text);

drop function if exists public.cancel_my_board_card_request();
drop function if exists public.submit_my_board_card(jsonb);
drop function if exists public.get_my_board_card();

drop function if exists public.mark_member_account_dual(uuid);
drop function if exists public.find_member_only_user(text);
drop function if exists public.get_admin_member_link_overview();
drop function if exists public.unlink_admin_as_member(uuid);
drop function if exists public.link_admin_as_member(uuid, uuid, uuid);
drop function if exists public.can_link_admin_member();

drop index if exists public.uq_board_members_member_id;

-- 0035: current_member_id و مشغّل الحماية بنسختيهما الأصليتين
create or replace function public.current_member_id()
returns uuid
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select ma.member_id
    from public.member_accounts ma
   where ma.user_id = auth.uid()
     and ma.is_active
     and not exists (select 1 from public.profiles p where p.id = ma.user_id)
     and exists (select 1 from public.members m where m.id = ma.member_id and m.deleted_at is null)
   limit 1;
$$;

create or replace function public.member_accounts_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id or new.member_id is distinct from old.member_id then
      raise exception 'member_account_link_immutable';
    end if;
    return new;
  end if;

  -- INSERT
  if exists (select 1 from public.profiles p where p.id = new.user_id) then
    raise exception 'member_account_forbidden_for_admin_user';
  end if;
  if not exists (select 1 from public.members m where m.id = new.member_id and m.deleted_at is null) then
    raise exception 'member_account_member_not_found';
  end if;
  return new;
end;
$$;

revoke all on function public.current_member_id() from public, anon, authenticated;
grant execute on function public.current_member_id() to authenticated;
revoke all on function public.member_accounts_guard() from public, anon, authenticated;

alter table public.member_accounts drop column if exists admin_linked;

-- 0037: دوال الاستعادة الثلاث بنسختها الأصلية (انظر التحذير أعلاه)
create or replace function public.issue_member_activation_link(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_m       public.members%rowtype;
  v_acc     public.member_accounts%rowtype;
  v_token   text;
  v_hash    text;
  v_expires timestamptz := now() + interval '7 days';
begin
  if auth.uid() is null or not public.can_manage_member_system() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;

  select * into v_m from public.members where id = p_member_id and deleted_at is null;
  if not found then raise exception 'العضو غير موجود'; end if;
  if v_m.status <> 'active' then raise exception 'العضو غير نشط'; end if;

  select * into v_acc from public.member_accounts where member_id = p_member_id;
  if found then
    -- استعادة: الحساب موجود، تُغيَّر كلمة المرور فقط عند فتح الرابط
    if not v_acc.is_active then raise exception 'حساب هذا العضو معطّل'; end if;
  else
    if v_m.email is null or btrim(v_m.email) = '' then
      raise exception 'لا يوجد بريد إلكتروني لهذا العضو؛ أضفه أولًا لأنه سيكون اسم الدخول';
    end if;
    if exists (select 1 from auth.users u where lower(u.email) = lower(btrim(v_m.email))) then
      raise exception 'هذا البريد مسجّل مسبقًا كحساب آخر؛ غيّر بريد العضو أو احذف الحساب القديم';
    end if;
  end if;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_hash  := encode(sha256(convert_to(v_token, 'utf8')), 'hex');

  insert into public.member_activation_links (member_id, token_hash, expires_at, created_by)
  values (p_member_id, v_hash, v_expires, auth.uid())
  on conflict (member_id) do update
     set token_hash = excluded.token_hash, expires_at = excluded.expires_at,
         used_at = null, created_by = excluded.created_by, created_at = now();

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, metadata)
  values (auth.uid(), 'ADMIN_ISSUED_MEMBER_ACTIVATION_LINK', 'members', p_member_id,
          case when v_acc.user_id is null
               then 'إصدار رابط تفعيل حساب فضاء المنخرطين للعضو ' || v_m.full_name
               else 'إعادة إصدار رابط استعادة الدخول للعضو ' || v_m.full_name end,
          jsonb_build_object('expires_at', v_expires, 'reissue', v_acc.user_id is not null));

  return jsonb_build_object('token', v_token, 'expires_at', v_expires, 'existing', v_acc.user_id is not null);
end;
$$;

create or replace function public.prepare_member_activation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_l   public.member_activation_links%rowtype;
  v_m   public.members%rowtype;
  v_acc public.member_accounts%rowtype;
  v_email text;
begin
  select * into v_l from public.member_activation_links
   where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex');
  if not found or v_l.used_at is not null or v_l.expires_at < now() then
    raise exception 'activation_link_invalid';
  end if;
  select * into v_m from public.members where id = v_l.member_id and deleted_at is null and status = 'active';
  if not found then raise exception 'activation_link_invalid'; end if;

  select * into v_acc from public.member_accounts where member_id = v_m.id;
  if found then
    if not v_acc.is_active then raise exception 'activation_link_invalid'; end if;
    select lower(u.email) into v_email from auth.users u where u.id = v_acc.user_id;
    if v_email is null then raise exception 'activation_link_invalid'; end if;
    return jsonb_build_object('member_id', v_m.id, 'email', v_email, 'existing_user_id', v_acc.user_id);
  end if;

  if v_m.email is null or btrim(v_m.email) = '' then raise exception 'activation_link_invalid'; end if;
  return jsonb_build_object('member_id', v_m.id, 'email', lower(btrim(v_m.email)), 'existing_user_id', null);
end;
$$;

create or replace function public.finalize_member_activation(p_token text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_l   public.member_activation_links%rowtype;
  v_acc public.member_accounts%rowtype;
begin
  select * into v_l from public.member_activation_links
   where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex')
   for update;
  if not found or v_l.used_at is not null or v_l.expires_at < now() then
    raise exception 'activation_link_invalid';
  end if;

  select * into v_acc from public.member_accounts where member_id = v_l.member_id;
  if found then
    if v_acc.user_id <> p_user_id or not v_acc.is_active then raise exception 'activation_link_invalid'; end if;
    update public.member_accounts set must_change_password = false where user_id = v_acc.user_id;
    update public.member_activation_links set used_at = now() where id = v_l.id;
    insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
    values (null, 'MEMBER_RESET_PASSWORD_VIA_LINK', 'members', v_l.member_id, 'استعادة الدخول لحساب فضاء المنخرطين (تغيير كلمة المرور)');
    return;
  end if;

  insert into public.member_accounts (user_id, member_id, must_change_password)
  values (p_user_id, v_l.member_id, false);

  update public.member_activation_links set used_at = now() where id = v_l.id;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
  values (null, 'MEMBER_ACTIVATED_ACCOUNT', 'members', v_l.member_id, 'تفعيل حساب فضاء المنخرطين');
end;
$$;

revoke all on function public.issue_member_activation_link(uuid)        from public, anon, authenticated;
revoke all on function public.prepare_member_activation(text)           from public, anon, authenticated;
revoke all on function public.finalize_member_activation(text, uuid)    from public, anon, authenticated;
grant execute on function public.issue_member_activation_link(uuid)     to authenticated;
grant execute on function public.prepare_member_activation(text)        to service_role;
grant execute on function public.finalize_member_activation(text, uuid) to service_role;

notify pgrst, 'reload schema';

commit;
