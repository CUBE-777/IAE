-- ============================================================
-- 0042_member_card_permanent_token.sql — رمز بطاقة العضوية الثابت (لا يتجدد حتى يغيّره العضو)
--
-- لماذا: كان الرمز (0040) يُلغى بعد 120 ثانية ويجدَّد تلقائيًا. المطلوب الآن: رمز ثابت يمكن عرضه وحفظه وطباعته، ولا يتغيّر
--   إلا بطلب صريح من العضو («رمز جديد») إن شكّ بتسرّبه.
-- كيف: الرمز مشتق (HMAC-شبيه كما في attendance_token_for/0041) من سرّ الخادم + معرّف العضو + epoch للعضو:
--   نفس (عضو، epoch) ⇒ نفس الرمز دائمًا، فلا يلزم تخزين الرمز الخام. تغيير الرمز = epoch+1 وحذف الرموز القديمة.
--   يُخزَّن sha256 فقط في member_card_tokens بانتهاء 'infinity' فتعمل verify_member_card (0040) دون أي تعديل.
-- ما يتغيّر:
--   1) member_card_secret / member_card_epoch — جدولان مغلقان.
--   2) issue_member_card_token()      — تُعاد كتابتها: تُرجع الرمز الثابت {token, expires_at: null, permanent: true} (idempotent، بلا حدّ إصدار).
--   3) regenerate_member_card_token() — جديدة: تُلغي الرمز الحالي وتُصدر رمزًا جديدًا ثابتًا. حدّ 5/ساعة لكل عضو (rate_limited).
-- الأمان: الرمز الثابت يعني أن من صوّر الرمز يستطيع عرض اسم العضو وصورته وحالة انخراطه ما دام العضو لم يغيّره؛ لا هاتف ولا بريد
--   في verify. يتطلب: 0040.   آمن لإعادة التشغيل.   الرجوع: supabase/rollback/0042_member_card_permanent_token_down.sql
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public.issue_member_card_token()') is null then
    raise exception 'شغّل 0040_member_card_tokens.sql أولاً';
  end if;
end $$;

create table if not exists public.member_card_secret (
  id     integer primary key default 1 check (id = 1),
  secret text not null default encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text, 'utf8')), 'hex')
);
insert into public.member_card_secret (id) values (1) on conflict (id) do nothing;

create table if not exists public.member_card_epoch (
  member_id  uuid primary key references public.members(id) on delete cascade,
  epoch      integer not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.member_card_secret enable row level security;
alter table public.member_card_epoch  enable row level security;
revoke all on table public.member_card_secret, public.member_card_epoch from public, anon, authenticated;

-- مساعد داخلي: رمز (عضو، epoch) — لا يُمنح لأحد
create or replace function public.member_card_token_for(p_member uuid, p_epoch integer)
returns text
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select rtrim(translate(encode(substring(
           sha256(convert_to((select secret from public.member_card_secret where id = 1)
                  || ':card:' || p_member::text || ':' || p_epoch::text, 'utf8'))
           from 1 for 16), 'base64'), '+/', '-_'), '=');
$$;

-- الرمز الثابت للعضو النشط (idempotent): يُنشئ epoch عند أول مرة ويسجّل بصمة الرمز بلا انتهاء
create or replace function public.issue_member_card_token()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id    uuid;
  v_epoch integer;
  v_token text;
  v_hash  text;
begin
  if auth.uid() is null then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;
  v_id := public.current_member_id();
  if v_id is null or not exists (select 1 from public.members m where m.id = v_id and m.status = 'active' and m.deleted_at is null) then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('member-card-issue:' || v_id::text, 0));

  insert into public.member_card_epoch (member_id) values (v_id) on conflict (member_id) do nothing;
  select epoch into v_epoch from public.member_card_epoch where member_id = v_id;

  v_token := public.member_card_token_for(v_id, v_epoch);
  v_hash  := encode(sha256(convert_to(v_token, 'utf8')), 'hex');

  -- أبقِ الرمز الحالي فقط: يحذف الرموز المؤقتة القديمة (0040) وأي رمز epoch سابق
  delete from public.member_card_tokens where member_id = v_id and token_hash <> v_hash;
  insert into public.member_card_tokens (token_hash, member_id, expires_at)
  values (v_hash, v_id, 'infinity'::timestamptz)
  on conflict (token_hash) do update set expires_at = 'infinity'::timestamptz;

  return jsonb_build_object('token', v_token, 'expires_at', null, 'permanent', true);
end;
$$;

-- رمز جديد بطلب العضو: الرمز القديم يتوقف فورًا
create or replace function public.regenerate_member_card_token()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id    uuid;
  v_salt  text;
  v_hash  text;
  v_cnt   integer;
  v_epoch integer;
  v_token text;
  v_th    text;
begin
  if auth.uid() is null then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;
  v_id := public.current_member_id();
  if v_id is null or not exists (select 1 from public.members m where m.id = v_id and m.status = 'active' and m.deleted_at is null) then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('member-card-issue:' || v_id::text, 0));

  select salt into v_salt from public.membership_throttle_secret where id = 1;
  v_hash := encode(sha256(convert_to(coalesce(v_salt, '') || ':member-card-regen:' || v_id::text, 'utf8')), 'hex');
  select count(*) into v_cnt
    from public.member_activation_throttle
   where client_hash = v_hash and created_at > now() - interval '1 hour';
  if v_cnt >= 5 then
    raise exception 'rate_limited';
  end if;
  insert into public.member_activation_throttle (client_hash) values (v_hash);

  insert into public.member_card_epoch (member_id, epoch) values (v_id, 2)
  on conflict (member_id) do update set epoch = public.member_card_epoch.epoch + 1, updated_at = now()
  returning epoch into v_epoch;

  v_token := public.member_card_token_for(v_id, v_epoch);
  v_th    := encode(sha256(convert_to(v_token, 'utf8')), 'hex');

  delete from public.member_card_tokens where member_id = v_id;
  insert into public.member_card_tokens (token_hash, member_id, expires_at)
  values (v_th, v_id, 'infinity'::timestamptz);

  return jsonb_build_object('token', v_token, 'expires_at', null, 'permanent', true);
end;
$$;

revoke all on function public.member_card_token_for(uuid, integer)  from public, anon, authenticated;
revoke all on function public.issue_member_card_token()             from public, anon, authenticated;
revoke all on function public.regenerate_member_card_token()        from public, anon, authenticated;
grant execute on function public.issue_member_card_token()          to authenticated;
grant execute on function public.regenerate_member_card_token()     to authenticated;

notify pgrst, 'reload schema';

commit;
