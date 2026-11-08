-- رجوع 0042: يعيد الرمز المتجدد القصير (0040). ⚠️ الرموز الثابتة المصدرة تبقى في member_card_tokens بانتهاء 'infinity'؛
-- نحذفها هنا حتى لا يبقى رمز دائم لا يستطيع أي كود قديم إدارته.
begin;

drop function if exists public.regenerate_member_card_token();
drop function if exists public.member_card_token_for(uuid, integer);
delete from public.member_card_tokens where expires_at = 'infinity'::timestamptz;
drop table if exists public.member_card_epoch;
drop table if exists public.member_card_secret;

create or replace function public.issue_member_card_token()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id      uuid;
  v_salt    text;
  v_hash    text;
  v_cnt     integer;
  v_token   text;
  v_expires timestamptz := now() + interval '120 seconds';
begin
  if auth.uid() is null then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;
  v_id := public.current_member_id();
  if v_id is null then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;
  if not exists (select 1 from public.members m where m.id = v_id and m.status = 'active' and m.deleted_at is null) then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;

  -- تسلسل طلبات العضو نفسه: لا سباق على حدّ الإصدار ولا على سقف الرموز الفعّالة
  perform pg_advisory_xact_lock(hashtextextended('member-card-issue:' || v_id::text, 0));

  -- حدّ الإصدار: 30 رمزًا/ساعة لكل عضو (يُعدّ في جدول 0038 ببصمة بالملح؛ لا نعدّ من جدول الرموز لأن الأقدم يُحذف)
  select salt into v_salt from public.membership_throttle_secret where id = 1;
  v_hash := encode(sha256(convert_to(coalesce(v_salt, '') || ':member-card-issue:' || v_id::text, 'utf8')), 'hex');
  select count(*) into v_cnt
    from public.member_activation_throttle
   where client_hash = v_hash and created_at > now() - interval '1 hour';
  if v_cnt >= 30 then
    raise exception 'rate_limited';
  end if;
  insert into public.member_activation_throttle (client_hash) values (v_hash);

  -- رمز 128 بت: sha256 لثلاثة UUID عشوائية (366 بت مصدر) ثم أول 16 بايت، base64url بلا «=»
  v_token := rtrim(translate(encode(substring(
               sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text, 'utf8'))
               from 1 for 16), 'base64'), '+/', '-_'), '=');

  insert into public.member_card_tokens (token_hash, member_id, expires_at)
  values (encode(sha256(convert_to(v_token, 'utf8')), 'hex'), v_id, v_expires);

  -- أبقِ أحدث 3 رموز للعضو فقط (يحذف الأقدم والمنتهي معًا)
  delete from public.member_card_tokens
   where member_id = v_id
     and token_hash not in (
       select t.token_hash from public.member_card_tokens t
        where t.member_id = v_id
        order by t.created_at desc, t.token_hash
        limit 3);

  -- تنظيف احتمالي كما في 0038 (المنتهية عمومًا + أحداث الحدّ الأقدم من يوم)
  if random() < 0.05 then
    delete from public.member_card_tokens where expires_at < now();
    delete from public.member_activation_throttle where created_at < now() - interval '1 day';
  end if;

  return jsonb_build_object('token', v_token, 'expires_at', v_expires);
end;
$$;

revoke all on function public.issue_member_card_token() from public, anon, authenticated;
grant execute on function public.issue_member_card_token() to authenticated;

notify pgrst, 'reload schema';

commit;
