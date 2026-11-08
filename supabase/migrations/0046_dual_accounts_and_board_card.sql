-- ============================================================
-- 0046_dual_accounts_and_board_card.sql — حساب واحد بصفتين (إداري + منخرط) وربطه ببطاقة المكتب
--
-- الفكرة: أعضاء المكتب يدخلون ببريد وكلمة سر واحدة (مستخدم Auth واحد) إلى لوحة الإدارة وفضاء المنخرطين.
-- المستخدم يحمل صفتين مستقلتين: صف في profiles (إداري) وصف في member_accounts (منخرط)، ويُربط بسجل members
-- ثم ببطاقة المكتب board_members.member_id، فيتعرّف على بطاقته ويطلب تعديلها (تُراجَع عبر board_profile_links).
--
-- ⚠️ أمن (أهم ما في هذا الملف): مسار «استعادة الدخول» (0037) يغيّر كلمة مرور المستخدم المرتبط بالعضو بمجرد فتح الرابط.
--    بعد دمج الحسابين كان سيسمح لمن يملك can_manage_member_system (مثل members_manager) بإصدار رابط استعادة لعضو مكتب
--    ثم فتحه وتغيير كلمة مرور **مسؤول أعلى** والدخول بها (تجاوز ترقية الصلاحيات). لذلك:
--      • issue_member_activation_link / prepare_member_activation / finalize_member_activation ترفض أي حساب له profiles.
--      • الدمج لا يتم إلا عبر link_admin_as_member (super_admin / developer فقط) أو admin-create-user.
--      • مشغّل الحماية يبقى يرفض أي ربط مباشر لمستخدم إداري إلا بالعلم admin_linked = true (طبقة دفاع ثانية).
--
-- ما يضيفه:
--   1) member_accounts.admin_linked (علم: هذا الحساب مزدوج عن قصد). مشغّل الحماية + current_member_id() يحترمانه.
--   2) can_link_admin_member() — من يملك الدمج: super_admin, developer, secretary_general.
--   3) link_admin_as_member / unlink_admin_as_member / get_admin_member_link_overview — للمسؤول.
--   4) find_member_only_user / mark_member_account_dual — لـ Edge Function admin-create-user (service_role فقط).
--   5) إغلاق ثغرة الاستعادة (ثلاث دوال من 0037 بنفس التواقيع).
--   6) بطاقة المكتب للعضو: get_my_board_card / submit_my_board_card / cancel_my_board_card_request
--      (تعيد استعمال board_profile_links + _bp_clean، فالمراجعة والاعتماد القائمان لا يتغيران).
--   7) فهرس فريد على board_members.member_id (بطاقة واحدة لكل عضو) + سياسة قراءة صور بطاقات المكتب لمسؤولي المحتوى.
--
-- لا يمسّ: profiles وسياساته، admin_role، is_admin، can_manage_*، members (إلا إدراج/تحديث بريد عبر link_admin_as_member)،
-- ولا أي سياسة قائمة. يتطلب: 0031 و0035 و0036 و0037 و0033.   آمن لإعادة التشغيل (idempotent).
-- ⚠️ تجربة جافة أولًا: استبدل `commit;` الأخيرة بـ `rollback;` ثم شغّله، وإن نجح أعدها `commit;`.
-- ⚠️ الرجوع: supabase/rollback/0046_dual_accounts_and_board_card_down.sql
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.member_accounts') is null then
    raise exception 'شغّل 0035_member_accounts.sql أولاً';
  end if;
  if to_regprocedure('public.prepare_member_activation(text)') is null
     or not exists (select 1 from pg_proc where proname = 'issue_member_activation_link'
                    and prosrc like '%استعادة: الحساب موجود%') then
    raise exception 'شغّل 0036 و0037 أولاً';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'profiles' and column_name = 'must_change_password') then
    raise exception 'شغّل 0027_must_change_password_server_side.sql أولاً';
  end if;
  if to_regclass('public.board_profile_links') is null then
    raise exception 'شغّل 0031_board_profile_links.sql أولاً';
  end if;
  if to_regprocedure('public._bp_clean(jsonb)') is null then
    raise exception 'شغّل 0031_board_profile_links.sql أولاً';
  end if;
  if to_regprocedure('public.can_manage_content()') is null then
    raise exception 'شغّل 0019_new_roles_and_file_delete_fix.sql أولاً';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) علم الحساب المزدوج
-- ---------------------------------------------------------------------
alter table public.member_accounts
  add column if not exists admin_linked boolean not null default false;

-- ---------------------------------------------------------------------
-- 2) مشغّل الحماية: الربط المباشر لمستخدم إداري مرفوض إلا بالعلم admin_linked (يضعه link_admin_as_member فقط)
-- ---------------------------------------------------------------------
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
    if new.admin_linked and not exists (select 1 from public.profiles p where p.id = new.user_id) then
      raise exception 'member_account_dual_requires_admin';
    end if;
    return new;
  end if;

  -- INSERT
  if exists (select 1 from public.profiles p where p.id = new.user_id) and not new.admin_linked then
    raise exception 'member_account_forbidden_for_admin_user';
  end if;
  if new.admin_linked and not exists (select 1 from public.profiles p where p.id = new.user_id) then
    raise exception 'member_account_dual_requires_admin';
  end if;
  if not exists (select 1 from public.members m where m.id = new.member_id and m.deleted_at is null) then
    raise exception 'member_account_member_not_found';
  end if;
  return new;
end;
$$;

revoke all on function public.member_accounts_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) current_member_id(): الحساب المزدوج المقصود (admin_linked) يحمل هوية العضو؛ أي حساب إداري آخر لا يحملها
-- ---------------------------------------------------------------------
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
     and (ma.admin_linked or not exists (select 1 from public.profiles p where p.id = ma.user_id))
     -- حساب مزدوج بكلمة مرور مؤقتة (أنشأه مسؤول): لا هوية عضو حتى يختار صاحبه كلمة مروره (يسقط العلم تلقائيًا، 0027)
     and not (ma.admin_linked and exists (select 1 from public.profiles p
                                           where p.id = ma.user_id and p.must_change_password))
     and exists (select 1 from public.members m where m.id = ma.member_id and m.deleted_at is null)
   limit 1;
$$;

revoke all on function public.current_member_id() from public, anon, authenticated;
grant execute on function public.current_member_id() to authenticated;

-- ---------------------------------------------------------------------
-- 4) من يملك دمج الحسابات: المسؤول الأعلى والمطوّر فقط (أضيق من can_manage_member_system؛ يطابق صفحة المستخدمين الإداريين)
-- ---------------------------------------------------------------------
create or replace function public.can_link_admin_member()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    public.current_admin_role()::text in ('super_admin', 'developer'),
    false
  );
$$;

revoke all on function public.can_link_admin_member() from public, anon, authenticated;
grant execute on function public.can_link_admin_member() to authenticated;

-- ---------------------------------------------------------------------
-- 5) فهرس فريد: بطاقة مكتب واحدة لكل سجل عضو (يُتخطّى بتنبيه إن وُجدت تكرارات قديمة؛ والدالة أدناه تتحقق أيضًا)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.board_members where member_id is not null group by member_id having count(*) > 1) then
    raise notice 'تخطّي الفهرس الفريد uq_board_members_member_id: يوجد عضو مرتبط بأكثر من بطاقة مكتب. أصلحها يدويًا ثم أعد تشغيل الملف';
  else
    create unique index if not exists uq_board_members_member_id
      on public.board_members (member_id) where member_id is not null;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6) ربط حساب إداري بعضو المكتب (يُنشئ سجل العضو إن لم يوجد، ويصل البطاقة بالسجل، ويفتح فضاء المنخرطين)
-- ---------------------------------------------------------------------
create or replace function public.link_admin_as_member(
  p_user_id uuid,
  p_board_member_id uuid default null,
  p_member_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_prof     public.profiles%rowtype;
  v_email    text;
  v_b        public.board_members%rowtype;
  v_m        public.members%rowtype;
  v_member   uuid;
  v_matches  uuid[];
  v_created  boolean := false;
  v_acc      public.member_accounts%rowtype;
begin
  if auth.uid() is null or not public.can_link_admin_member() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;

  select * into v_prof from public.profiles where id = p_user_id;
  if not found or not v_prof.is_active then
    raise exception 'الحساب الإداري غير موجود أو غير نشط';
  end if;

  -- بريد الدخول الفعلي هو بريد auth.users (لا يعدّله أحد من الـ API)
  select lower(btrim(u.email)) into v_email from auth.users u where u.id = p_user_id;
  if v_email is null or v_email = '' then
    raise exception 'لا بريد لهذا الحساب';
  end if;

  if p_board_member_id is not null then
    select * into v_b from public.board_members where id = p_board_member_id for update;
    if not found then raise exception 'عضو المكتب غير موجود'; end if;
  end if;

  -- 1) تحديد سجل العضو: المحدَّد صراحةً، ثم المرتبط ببطاقة المكتب، ثم المطابق بالبريد (إن كان وحيدًا)
  if p_member_id is not null then
    v_member := p_member_id;
  elsif v_b.id is not null and v_b.member_id is not null then
    v_member := v_b.member_id;
  else
    select array_agg(m.id) into v_matches
      from public.members m
     where m.deleted_at is null and lower(btrim(coalesce(m.email, ''))) = v_email;
    if coalesce(array_length(v_matches, 1), 0) > 1 then
      raise exception 'يوجد أكثر من سجل عضو بهذا البريد؛ حدّد السجل الصحيح يدويًا';
    end if;
    v_member := v_matches[1];
  end if;

  -- 2) لا سجل؟ ننشئه من بطاقة المكتب أو من الملف الإداري، دون ظهور في دليل الأعضاء العام
  if v_member is null then
    insert into public.members (full_name, email, photo_url, university, promotion, track, status, show_in_directory)
    values (coalesce(v_b.full_name, v_prof.full_name), v_email, v_b.photo_url, v_b.university,
            v_b.promotion, v_b.track, 'active', false)
    returning id into v_member;
    v_created := true;
  end if;

  select * into v_m from public.members where id = v_member and deleted_at is null;
  if not found then raise exception 'سجل العضو غير موجود'; end if;
  if v_m.status <> 'active' then raise exception 'سجل العضو غير نشط'; end if;

  -- 3) حماية من ربط شخص بسجل غيره: بريد السجل يجب أن يطابق بريد الدخول
  if v_m.email is null or btrim(v_m.email) = '' then
    update public.members set email = v_email where id = v_m.id;
  elsif lower(btrim(v_m.email)) <> v_email then
    raise exception 'بريد سجل العضو لا يطابق بريد الحساب الإداري؛ صحّح البريد أولًا ثم أعد الربط';
  end if;

  -- 4) حساب المنخرط (idempotent: إعادة الربط تعيد التفعيل فقط)
  select * into v_acc from public.member_accounts where user_id = p_user_id;
  if found then
    if v_acc.member_id <> v_member then
      raise exception 'هذا الحساب مرتبط بعضو آخر في فضاء المنخرطين';
    end if;
    update public.member_accounts set is_active = true, admin_linked = true where user_id = p_user_id;
  else
    if exists (select 1 from public.member_accounts where member_id = v_member) then
      raise exception 'لهذا العضو حساب منخرط آخر؛ عطّله أو احذفه أولًا';
    end if;
    insert into public.member_accounts (user_id, member_id, must_change_password, admin_linked)
    values (p_user_id, v_member, false, true);
  end if;

  -- 5) بطاقة المكتب
  if v_b.id is not null then
    if v_b.member_id is not null and v_b.member_id <> v_member then
      raise exception 'بطاقة المكتب مرتبطة بسجل عضو آخر';
    end if;
    if exists (select 1 from public.board_members where member_id = v_member and id <> v_b.id) then
      raise exception 'هذا العضو مرتبط ببطاقة مكتب أخرى';
    end if;
    update public.board_members set member_id = v_member where id = v_b.id and member_id is distinct from v_member;
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, metadata)
  values (auth.uid(), 'ADMIN_LINKED_ADMIN_AS_MEMBER', 'members', v_member,
          'ربط الحساب الإداري ' || v_prof.full_name || ' بفضاء المنخرطين' ||
            case when v_b.id is not null then ' وببطاقة المكتب' else '' end,
          jsonb_build_object('user_id', p_user_id, 'board_member_id', v_b.id, 'member_created', v_created));

  return jsonb_build_object('member_id', v_member, 'board_member_id', v_b.id, 'member_created', v_created);
end;
$$;

revoke all on function public.link_admin_as_member(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.link_admin_as_member(uuid, uuid, uuid) to authenticated;

-- فصل الصفة المزدوجة: يعطّل جانب المنخرط فقط (لا يحذف شيئًا ولا يمسّ الصفة الإدارية)
create or replace function public.unlink_admin_as_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_acc  public.member_accounts%rowtype;
begin
  if auth.uid() is null or not public.can_link_admin_member() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;

  select * into v_acc from public.member_accounts where user_id = p_user_id and admin_linked for update;
  if not found then raise exception 'لا يوجد حساب منخرط مرتبط بهذا الحساب الإداري'; end if;

  update public.member_accounts set is_active = false where user_id = p_user_id;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, metadata)
  values (auth.uid(), 'ADMIN_UNLINKED_ADMIN_AS_MEMBER', 'members', v_acc.member_id,
          'تعطيل جانب المنخرط للحساب الإداري', jsonb_build_object('user_id', p_user_id));
end;
$$;

revoke all on function public.unlink_admin_as_member(uuid) from public, anon, authenticated;
grant execute on function public.unlink_admin_as_member(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7) لوحة الربط للمسؤول: كل حساب إداري، حالة ربطه، واقتراح بطاقة المكتب (بالبريد ثم بالاسم)
-- ---------------------------------------------------------------------
create or replace function public.get_admin_member_link_overview()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, auth, pg_temp
as $$
declare
  v jsonb;
begin
  if auth.uid() is null or not public.can_link_admin_member() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;

  select coalesce(jsonb_agg(x.j order by x.name), '[]'::jsonb) into v
  from (
    select p.full_name as name,
           jsonb_build_object(
             'user_id', p.id,
             'full_name', p.full_name,
             'email', lower(p.email),
             'role', p.role,
             'is_active', p.is_active,
             'account', case when ma.user_id is null then null
                             else jsonb_build_object('member_id', ma.member_id, 'is_active', ma.is_active,
                                                     'admin_linked', ma.admin_linked) end,
             'member_name', m.full_name,
             'board', case when b.id is null then null
                           else jsonb_build_object('id', b.id, 'full_name', b.full_name, 'position', b.position) end,
             'suggest_board', case when b.id is not null then null else (
                select jsonb_build_object('id', sb.id, 'full_name', sb.full_name, 'position', sb.position)
                  from public.board_members sb
                  left join public.members sm on sm.id = sb.member_id
                 where sb.is_active
                   and (sb.member_id is null or lower(btrim(coalesce(sm.email, ''))) = lower(btrim(p.email)))
                   and (lower(btrim(sb.full_name)) = lower(btrim(p.full_name))
                        or lower(btrim(coalesce(sm.email, ''))) = lower(btrim(p.email)))
                 order by sb.sort_order
                 limit 1) end
           ) as j
      from public.profiles p
      left join public.member_accounts ma on ma.user_id = p.id
      left join public.members m on m.id = ma.member_id
      left join lateral (
        select bb.id, bb.full_name, bb.position
          from public.board_members bb
         where bb.member_id is not null and bb.member_id = ma.member_id
         limit 1
      ) b on true
  ) x;

  return v;
end;
$$;

revoke all on function public.get_admin_member_link_overview() from public, anon, authenticated;
grant execute on function public.get_admin_member_link_overview() to authenticated;

-- ---------------------------------------------------------------------
-- 8) دوال Edge Function admin-create-user (service_role فقط)
-- ---------------------------------------------------------------------

-- مستخدم موجود كمنخرط فقط (حساب نشط وبلا profiles) ببريد معيّن؛ يعيد null إن لم يوجد
create or replace function public.find_member_only_user(p_email text)
returns jsonb
language sql
security definer
stable
set search_path = public, auth, pg_temp
as $$
  select jsonb_build_object('user_id', u.id, 'member_name', m.full_name)
    from auth.users u
    join public.member_accounts ma on ma.user_id = u.id and ma.is_active
    join public.members m on m.id = ma.member_id and m.deleted_at is null
   where lower(u.email) = lower(btrim(coalesce(p_email, '')))
     and not exists (select 1 from public.profiles p where p.id = u.id)
   limit 1;
$$;

-- بعد إضافة profiles لمنخرط قائم: نعلّم حسابه مزدوجًا عن قصد (يتحقق المشغّل من وجود profiles)
create or replace function public.mark_member_account_dual(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mid uuid;
begin
  update public.member_accounts set admin_linked = true
   where user_id = p_user_id and is_active
  returning member_id into v_mid;
  if v_mid is null then return false; end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, metadata)
  values ((select p.id from public.profiles p where p.id = p_user_id),
          'ADMIN_GRANTED_ADMIN_TO_MEMBER', 'members', v_mid,
          'منح صفة إدارية لحساب منخرط قائم (حساب مزدوج)', jsonb_build_object('user_id', p_user_id));
  return true;
end;
$$;

revoke all on function public.find_member_only_user(text)     from public, anon, authenticated;
revoke all on function public.mark_member_account_dual(uuid)  from public, anon, authenticated;
grant execute on function public.find_member_only_user(text)     to service_role;
grant execute on function public.mark_member_account_dual(uuid)  to service_role;

-- ---------------------------------------------------------------------
-- 9) إغلاق ثغرة الاستعادة: لا استعادة بكلمة مرور لحساب له profiles (نسخ من 0037 + فحص profiles)
-- ---------------------------------------------------------------------
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
    if exists (select 1 from public.profiles p where p.id = v_acc.user_id) then
      raise exception 'هذا الحساب مرتبط بحساب إداري؛ لا تُستعاد كلمة مروره برابط الأعضاء. يغيّرها صاحبه من صفحة الأمان أو يتولى ذلك مسؤول أعلى';
    end if;
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
    -- ⚠️ حساب إداري (أو مزدوج): ممنوع تغيير كلمة مروره بهذا الرابط حتى لو أُصدر قبل الدمج
    if exists (select 1 from public.profiles p where p.id = v_acc.user_id) then
      raise exception 'activation_link_invalid';
    end if;
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
    -- استعادة: لا ربط جديد، ويجب أن يكون المستخدم هو صاحب الحساب نفسه، وألا يكون حسابًا إداريًا
    if v_acc.user_id <> p_user_id or not v_acc.is_active then raise exception 'activation_link_invalid'; end if;
    if exists (select 1 from public.profiles p where p.id = v_acc.user_id) then
      raise exception 'activation_link_invalid';
    end if;
    update public.member_accounts set must_change_password = false where user_id = v_acc.user_id;
    update public.member_activation_links set used_at = now() where id = v_l.id;
    insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
    values (null, 'MEMBER_RESET_PASSWORD_VIA_LINK', 'members', v_l.member_id, 'استعادة الدخول لحساب فضاء المنخرطين (تغيير كلمة المرور)');
    return;
  end if;

  -- مشغّل الحماية يرفض مستخدمًا له profiles (دون admin_linked) أو عضوًا محذوفًا
  insert into public.member_accounts (user_id, member_id, must_change_password)
  values (p_user_id, v_l.member_id, false);   -- اختار كلمة مروره بنفسه أثناء التفعيل

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

-- ---------------------------------------------------------------------
-- 10) بطاقة المكتب للعضو (تعيد استعمال board_profile_links: المراجعة والاعتماد كما هما)
-- ---------------------------------------------------------------------

-- 10.أ) بطاقتي: البيانات الحالية + حالة آخر طلب (null إن لم تكن للعضو بطاقة مكتب نشطة)
create or replace function public.get_my_board_card()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_id    uuid := public.current_member_id();
  v_b     public.board_members%rowtype;
  v_l     public.board_profile_links%rowtype;
  v_has_l boolean;
begin
  if auth.uid() is null or v_id is null then return null; end if;

  select * into v_b from public.board_members where member_id = v_id and is_active limit 1;
  if not found then return null; end if;

  select * into v_l from public.board_profile_links where board_member_id = v_b.id;
  v_has_l := found;

  return jsonb_build_object(
    'board_member_id', v_b.id,
    'full_name', v_b.full_name,
    'position', v_b.position,
    'photo_url', v_b.photo_url,
    'current', jsonb_build_object(
      'university',  v_b.university,
      'promotion',   v_b.promotion,
      'track',       v_b.track,
      'bio',         v_b.bio,
      'public_bio',  v_b.public_bio,
      'study_path',  v_b.study_path,
      'socials',     coalesce(v_b.socials, '{}'::jsonb),
      'extra',       coalesce(v_b.extra, '{}'::jsonb),
      'translations', coalesce(v_b.translations, '{}'::jsonb)
    ),
    'request', case when not v_has_l then null else jsonb_build_object(
      'status', v_l.status,
      'review_note', v_l.review_note,
      'submitted_at', v_l.submitted_at,
      'has_draft_photo', v_l.photo_path is not null,
      'draft', case when v_l.data <> '{}'::jsonb then v_l.data else null end
    ) end
  );
end;
$$;

-- 10.ب) إرسال طلب تعديل البطاقة (لا يُنشر شيء قبل اعتماد مسؤول المحتوى). الاسم والصفة والترتيب خارج القائمة البيضاء.
create or replace function public.submit_my_board_card(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id    uuid := public.current_member_id();
  v_b     public.board_members%rowtype;
  v_l     public.board_profile_links%rowtype;
  v_clean jsonb;
  v_photo text;
begin
  if auth.uid() is null or v_id is null then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'بيانات غير صالحة';
  end if;

  select * into v_b from public.board_members where member_id = v_id and is_active limit 1 for update;
  if not found then raise exception 'لا توجد بطاقة مكتب مرتبطة بحسابك'; end if;

  v_clean := public._bp_clean(p_data);

  v_photo := nullif(btrim(coalesce(p_data ->> 'photo_path', '')), '');
  if v_photo is not null then
    -- صورة مرفوعة في مجلد العضو نفسه فقط (سياسة member_card_photo_insert من 0036)
    if v_photo !~ ('^member-' || v_id::text || '/photo-[0-9a-f]{8,32}\.(webp|jpg|png)$')
       or not exists (select 1 from storage.objects where bucket_id = 'membership-docs' and name = v_photo) then
      raise exception 'الصورة غير صالحة';
    end if;
  end if;

  select * into v_l from public.board_profile_links where board_member_id = v_b.id for update;
  if not found then
    -- لا رابط عام سابق: نُنشئ صفًا برمز عشوائي لا يعرفه أحد (لا يُستعمل إلا كمفتاح فريد)
    insert into public.board_profile_links (board_member_id, token_hash, expires_at, status, data, photo_path, submitted_at)
    values (v_b.id,
            encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'utf8')), 'hex'),
            now() + interval '14 days', 'submitted', v_clean, v_photo, now());
  else
    update public.board_profile_links
       set data = v_clean,
           photo_path = coalesce(v_photo, case when v_l.status = 'approved' then null else v_l.photo_path end),
           status = 'submitted', submitted_at = now(), review_note = null,
           reviewed_by = null, reviewed_at = null
     where id = v_l.id;
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
  values ((select p.id from public.profiles p where p.id = auth.uid()),
          'MEMBER_SUBMITTED_BOARD_CARD', 'board_members', v_b.id,
          'طلب تعديل بطاقة المكتب من العضو ' || v_b.full_name);

  return jsonb_build_object('ok', true);
end;
$$;

-- 10.ج) سحب الطلب قبل مراجعته
create or replace function public.cancel_my_board_card_request()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := public.current_member_id();
  v_b  public.board_members%rowtype;
  n    integer;
begin
  if auth.uid() is null or v_id is null then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;
  select * into v_b from public.board_members where member_id = v_id and is_active limit 1;
  if not found then raise exception 'لا توجد بطاقة مكتب مرتبطة بحسابك'; end if;

  update public.board_profile_links
     set status = 'sent', data = '{}'::jsonb, photo_path = null, review_note = null, submitted_at = null
   where board_member_id = v_b.id and status = 'submitted';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'لا يوجد طلب قيد المراجعة'; end if;
end;
$$;

revoke all on function public.get_my_board_card()              from public, anon, authenticated;
revoke all on function public.submit_my_board_card(jsonb)      from public, anon, authenticated;
revoke all on function public.cancel_my_board_card_request()   from public, anon, authenticated;
grant execute on function public.get_my_board_card()           to authenticated;
grant execute on function public.submit_my_board_card(jsonb)   to authenticated;
grant execute on function public.cancel_my_board_card_request() to authenticated;

-- ---------------------------------------------------------------------
-- 11) تخزين: مسؤول المحتوى يرى صور بطاقات المكتب المقترحة فقط (مجلد عضو مرتبط ببطاقة مكتب، نمط photo-* فقط)
-- ---------------------------------------------------------------------
create or replace function public.board_member_photo_readable(p_name text)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select p_name ~ '^member-[0-9a-f-]{36}/photo-[0-9a-f]{8,32}\.(webp|jpg|png)$'
     and exists (
       select 1 from public.board_members b
        where b.member_id is not null
          and 'member-' || b.member_id::text = split_part(p_name, '/', 1)
     );
$$;

revoke all on function public.board_member_photo_readable(text) from public, anon, authenticated;
grant execute on function public.board_member_photo_readable(text) to authenticated;

drop policy if exists "member_board_photo_content_select" on storage.objects;
create policy "member_board_photo_content_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'membership-docs'
         and public.can_manage_content()
         and public.board_member_photo_readable(name));

notify pgrst, 'reload schema';

commit;
