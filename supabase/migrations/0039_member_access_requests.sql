-- ============================================================
-- 0039_member_access_requests.sql — «طلب مساعدة في الدخول»: العضو يطلب رابط تفعيل/استعادة من الإدارة بنفسه
--
-- لماذا: المشروع على الخطة المجانية بلا SMTP، فلا استعادة ذاتية بالبريد. كان على العضو أن يتواصل بالإدارة خارج
--   الموقع. الآن يكتب بريده في /member/help فينشئ طلبًا يراه المسؤول (طلبات المساعدة في الدخول) ويرسل الرابط
--   بنقرة واحدة عبر واتساب من الأداة الموجودة (MemberActivationModal).
-- الأمان:
--   * الرابط لا يصل إلى مقدّم الطلب أبدًا: يُصدره المسؤول ويُرسله إلى وسيلة الاتصال المسجّلة للعضو في سجلات النادي.
--     فمن أدخل بريد غيره لا يحصل على شيء ولا يُغيَّر شيء في الحساب.
--   * الدالة العامة لا تكشف هل البريد مسجّل (لا ترجع شيئًا، وتتصرف بصمت إن لم يوجد عضو نشط بهذا البريد).
--   * حدّ لكل عميل (5 / 10 دقائق، بصمة sha256 بالملح السرّي في جدول 0038) وسقف عام (100 / ساعة)، وطلب واحد
--     قيد الانتظار لكل عضو. تجاوز الحدّ يرفع rate_limited (لا يتعلق بوجود البريد فلا يسرّب شيئًا).
--   * الجدول مغلق: القراءة لمديري نظام الأعضاء فقط (can_manage_member_system)، والتغيير عبر الدوال فقط.
-- يتطلب: 0035 و0036 و0038.   آمن لإعادة التشغيل.
-- ⚠️ تجربة جافة أولًا: استبدل `commit;` الأخيرة بـ `rollback;`. الرجوع: supabase/rollback/0039_member_access_requests_down.sql
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public.can_manage_member_system()') is null then
    raise exception 'شغّل 0035_member_accounts.sql أولاً';
  end if;
  if to_regclass('public.member_card_requests') is null then
    raise exception 'شغّل 0036_member_space_activation_and_card_requests.sql أولاً';
  end if;
  if to_regclass('public.member_activation_throttle') is null then
    raise exception 'شغّل 0038_member_activation_throttle.sql أولاً';
  end if;
end $$;

create table if not exists public.member_access_requests (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'handled', 'dismissed')),
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references public.profiles(id) on delete set null
);

create unique index if not exists idx_member_access_requests_one_pending
  on public.member_access_requests (member_id) where status = 'pending';
create index if not exists idx_member_access_requests_status
  on public.member_access_requests (status, created_at desc);

alter table public.member_access_requests enable row level security;
revoke all on table public.member_access_requests from public, anon, authenticated;
grant select on table public.member_access_requests to authenticated;

drop policy if exists "member_access_requests_manager_read" on public.member_access_requests;
create policy "member_access_requests_manager_read" on public.member_access_requests
  for select to authenticated
  using (public.can_manage_member_system());

-- الزائر: لا يُرجع شيئًا مهما كان البريد (لا تعداد للبريد). rate_limited فقط عند تجاوز حدّ العميل أو السقف العام.
create or replace function public.request_member_access_help(p_email text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_headers json;
  v_ip      text;
  v_salt    text;
  v_hash    text;
  v_cnt     integer;
begin
  -- شكل غير صالح: لا شيء (والواجهة تتحقق قبل الإرسال)
  if char_length(v_email) < 5 or char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return;
  end if;

  -- سقف عام: لا يُغرَق مكتب النادي بطلبات
  if (select count(*) from public.member_access_requests where created_at > now() - interval '1 hour') >= 100 then
    raise exception 'rate_limited';
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    v_headers := null;
  end;
  v_ip := coalesce(
    nullif(btrim(v_headers->>'cf-connecting-ip'), ''),
    nullif(btrim(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1)), '')
  );

  if v_ip is not null then
    select salt into v_salt from public.membership_throttle_secret where id = 1;
    v_hash := encode(sha256(convert_to(coalesce(v_salt, '') || ':member-access:' || v_ip, 'utf8')), 'hex');
    perform pg_advisory_xact_lock(hashtextextended(v_hash, 0));
    select count(*) into v_cnt
      from public.member_activation_throttle
     where client_hash = v_hash and created_at > now() - interval '10 minutes';
    if v_cnt >= 5 then
      raise exception 'rate_limited';
    end if;
    insert into public.member_activation_throttle (client_hash) values (v_hash);
  end if;

  insert into public.member_access_requests (member_id)
  select m.id
    from public.members m
   where lower(btrim(m.email)) = v_email
     and m.status = 'active'
     and m.deleted_at is null
  on conflict (member_id) where status = 'pending' do nothing;
end;
$$;

-- المسؤول: إنهاء طلب (handled بعد إصدار الرابط، أو dismissed للتجاهل). idempotent ومسجّل في audit_logs.
create or replace function public.resolve_member_access_request(p_request_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member uuid;
begin
  if auth.uid() is null or not public.can_manage_member_system() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;
  if p_status is null or p_status not in ('handled', 'dismissed') then
    raise exception 'حالة غير صالحة';
  end if;

  update public.member_access_requests
     set status = p_status, handled_at = now(), handled_by = auth.uid()
   where id = p_request_id and status = 'pending'
   returning member_id into v_member;
  if not found then return; end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
  values (
    auth.uid(),
    case p_status when 'handled' then 'ADMIN_HANDLED_MEMBER_ACCESS_REQUEST' else 'ADMIN_DISMISSED_MEMBER_ACCESS_REQUEST' end,
    'members', v_member,
    case p_status when 'handled' then 'معالجة طلب مساعدة في الدخول لعضو' else 'تجاهل طلب مساعدة في الدخول لعضو' end
  );
end;
$$;

revoke all on function public.request_member_access_help(text)             from public, anon, authenticated;
revoke all on function public.resolve_member_access_request(uuid, text)     from public, anon, authenticated;
grant execute on function public.request_member_access_help(text)          to anon, authenticated;
grant execute on function public.resolve_member_access_request(uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
