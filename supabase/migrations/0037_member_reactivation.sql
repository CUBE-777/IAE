-- ============================================================
-- 0037_member_reactivation.sql — إعادة إصدار رابط التفعيل لعضو له حساب (استعادة الدخول)
--
-- المشكلة: issue_member_activation_link (0036) ترفض عضوًا له حساب، فلا طريق لاستعادة حساب نسي صاحبه كلمة مروره.
-- الحل: يُسمح للمسؤول (can_manage_member_system) بإعادة إصدار الرابط لعضو له حساب نشط؛ وعند فتح الرابط
--   لا يُنشأ مستخدم جديد: تبقى هوية مستخدم Auth وربطه بالعضو كما هي، وتُغيَّر كلمة مروره فقط (من member-activate).
--
-- ما يغيّره (create or replace لأربع دوال من 0036 بنفس التواقيع، فتبقى صلاحياتها؛ ونعيد ضبطها صراحةً):
--   * issue_member_activation_link   : يتجاوز فحصي «حساب مفعّل» و«البريد مسجّل» إذا كان الحساب للعضو نفسه، ويرفض الحساب المعطّل.
--   * get_member_activation_link     : يضيف الحقل existing (true = استعادة، false = تفعيل جديد).
--   * prepare_member_activation      : يعيد existing_user_id عند وجود حساب (والبريد من auth.users، وهو بريد الدخول الفعلي).
--   * finalize_member_activation     : عند وجود حساب يتحقق أن p_user_id هو صاحبه، ولا يُدرج صفًا جديدًا، ويسجّل العملية.
-- لا يُنشئ جداول ولا يعدّل أي سياسة. يتطلب: 0035 و0036.   آمن لإعادة التشغيل.
-- ⚠️ تجربة جافة أولًا: استبدل `commit;` الأخيرة بـ `rollback;`. الرجوع: supabase/rollback/0037_member_reactivation_down.sql
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public.issue_member_activation_link(uuid)') is null then
    raise exception 'شغّل 0036_member_space_activation_and_card_requests.sql أولاً';
  end if;
end $$;

-- 1) الإصدار
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

-- 2) التحقق من الرابط (للزائر)
create or replace function public.get_member_activation_link(p_token text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_l public.member_activation_links%rowtype;
  v_m public.members%rowtype;
  v_local  text;
  v_domain text;
  v_email  text;
begin
  select * into v_l from public.member_activation_links
   where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex');
  if not found then return jsonb_build_object('valid', false, 'reason', 'invalid'); end if;
  if v_l.used_at is not null then return jsonb_build_object('valid', false, 'reason', 'used'); end if;
  if v_l.expires_at < now() then return jsonb_build_object('valid', false, 'reason', 'expired'); end if;

  select * into v_m from public.members where id = v_l.member_id and deleted_at is null;
  if not found then return jsonb_build_object('valid', false, 'reason', 'invalid'); end if;

  v_email  := coalesce(v_m.email, '');
  v_local  := split_part(v_email, '@', 1);
  v_domain := split_part(v_email, '@', 2);
  return jsonb_build_object(
    'valid', true,
    'full_name', v_m.full_name,
    'email_hint', left(v_local, 1) || repeat('*', greatest(char_length(v_local) - 1, 2)) || '@' || v_domain,
    'existing', exists (select 1 from public.member_accounts where member_id = v_m.id),
    'expires_at', v_l.expires_at
  );
end;
$$;

-- 3) تجهيز التفعيل (service_role)
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

-- 4) إنهاء التفعيل (service_role)
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
    -- استعادة: لا ربط جديد، ويجب أن يكون المستخدم هو صاحب الحساب نفسه
    if v_acc.user_id <> p_user_id or not v_acc.is_active then raise exception 'activation_link_invalid'; end if;
    update public.member_accounts set must_change_password = false where user_id = v_acc.user_id;
    update public.member_activation_links set used_at = now() where id = v_l.id;
    insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
    values (null, 'MEMBER_RESET_PASSWORD_VIA_LINK', 'members', v_l.member_id, 'استعادة الدخول لحساب فضاء المنخرطين (تغيير كلمة المرور)');
    return;
  end if;

  -- مشغّل الحماية في 0035 يرفض مستخدمًا له profiles أو عضوًا محذوفًا
  insert into public.member_accounts (user_id, member_id, must_change_password)
  values (p_user_id, v_l.member_id, false);   -- اختار كلمة مروره بنفسه أثناء التفعيل

  update public.member_activation_links set used_at = now() where id = v_l.id;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
  values (null, 'MEMBER_ACTIVATED_ACCOUNT', 'members', v_l.member_id, 'تفعيل حساب فضاء المنخرطين');
end;
$$;

-- 5) الصلاحيات (نفس 0036 تمامًا)
revoke all on function public.issue_member_activation_link(uuid)        from public, anon, authenticated;
revoke all on function public.get_member_activation_link(text)          from public, anon, authenticated;
revoke all on function public.prepare_member_activation(text)           from public, anon, authenticated;
revoke all on function public.finalize_member_activation(text, uuid)    from public, anon, authenticated;
grant execute on function public.issue_member_activation_link(uuid)     to authenticated;
grant execute on function public.get_member_activation_link(text)       to anon, authenticated;
grant execute on function public.prepare_member_activation(text)        to service_role;
grant execute on function public.finalize_member_activation(text, uuid) to service_role;

notify pgrst, 'reload schema';

commit;
