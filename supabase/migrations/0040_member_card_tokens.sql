-- ============================================================
-- 0040_member_card_tokens.sql — «بطاقة العضوية الرقمية» برمز QR متجدد (المرحلة أ: الإصدار والتحقق فقط)
--
-- لماذا: يريد العضو أن يُثبت انتماءه وحالة انخراطه لموسم النادي الحالي بمسح رمز من هاتفه، دون صورة بطاقة ثابتة
--   تُنسخ ولا بيانات شخصية داخل الرمز. الرمز مؤشّر عشوائي قصير العمر؛ كل ما يُعرض للماسح يُقرأ من القاعدة لحظة المسح.
-- ما يضيفه (إضافة فقط، لا يمسّ أي جدول أو دالة قائمة):
--   1) member_card_tokens        — جدول مغلق: sha256 الرمز فقط (الخام لا يُخزَّن أبدًا) + العضو + الانتهاء.
--   2) issue_member_card_token() — للعضو النشط المصادق: يُصدر رمزًا صالحًا 120 ثانية ويُعيده مرة واحدة {token, expires_at}.
--   3) verify_member_card(token) — عامة (anon): {"valid": false} دائمًا للمجهول/المنتهي/غير النشط/الشكل الخاطئ، وإلا الحقول
--        العامة المسموحة فقط + حالة الانخراط للموسم الحالي.
--   4) get_my_membership_status()— للعضو المصادق: {season, active, paid_at, has_previous} (member_memberships مغلق على العضو بـ RLS).
--        has_previous = له عضوية في موسم سابق (ليفرّق الواجهة بين «الانخراط غير مجدَّد» و«غير منخرط»؛ لا تُعرض في verify).
-- الأمان:
--   * الرمز 128 بت عشوائية. لا يُستعمل gen_random_bytes عمدًا: pgcrypto في Supabase يعيش في مخطط extensions، ومسار البحث
--     الثابت (public, pg_temp) للدوال SECURITY DEFINER لا يراه فتفشل الدالة وقت التشغيل. نسير على سابقة 0014
--     (رمز النموذج): gen_random_uuid() (مدمجة في PostgreSQL، مولّد آمن تشفيريًا) → sha256 → أول 16 بايت → base64url بلا «=».
--   * أقصى 3 رموز فعّالة لكل عضو (الأقدم يُحذف). حدّ الإصدار 30/ساعة لكل عضو (rate_limited)، يُعدّ في
--     member_activation_throttle ببصمة sha256 بالملح السرّي (لا يُعدّ من جدول الرموز لأن حذف الأقدم يُصغّر العدّ).
--   * حدّ التحقق 30 محاولة/10 دقائق لكل عميل (بصمة IP بالملح وبادئة ':member-verify:'، كما في 0039) ويُعدّ قبل فحص
--     الرمز، فلا فرق في الاستجابة بين المنتهي وغير المعروف. الرمز الخام لا يُسجَّل في أي مكان.
--   * verify لا تُرجع هاتفًا ولا بريدًا ولا مدينة ولا معرّف العضو.
-- الحدود: الرمز ليس أحادي الاستعمال (يصلح لأكثر من مسح خلال 120 ثانية)؛ حدّ التحقق لكل IP فقد تتشارك شبكة واحدة (جامعة) الحصة.
-- ⚠️ تذكير: الإصدار 30/ساعة والواجهة تجدّد كل 90 ثانية (≈ 40/ساعة لصفحة مفتوحة باستمرار) — الواجهة تتعامل مع rate_limited.
-- يتطلب: 0014 و0026 و0035 و0036 و0038 و0039.   آمن لإعادة التشغيل.
-- ⚠️ تجربة جافة أولًا: استبدل `commit;` الأخيرة بـ `rollback;`. الرجوع: supabase/rollback/0040_member_card_tokens_down.sql
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public.current_member_id()') is null then
    raise exception 'شغّل 0035_member_accounts.sql أولاً';
  end if;
  if to_regprocedure('public.get_my_member()') is null then
    raise exception 'شغّل 0036_member_space_activation_and_card_requests.sql أولاً';
  end if;
  if to_regclass('public.membership_throttle_secret') is null then
    raise exception 'شغّل 0026_throttle_salted_hash.sql أولاً';
  end if;
  if to_regclass('public.member_memberships') is null or to_regclass('public.site_settings') is null then
    raise exception 'شغّل 0014_membership_flow.sql أولاً';
  end if;
  if to_regclass('public.member_activation_throttle') is null then
    raise exception 'شغّل 0038_member_activation_throttle.sql أولاً';
  end if;
  if to_regclass('public.member_access_requests') is null then
    raise exception 'شغّل 0039_member_access_requests.sql أولاً';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) الجدول (مغلق: RLS مفعّل، بلا سياسات، وكل الصلاحيات مسحوبة؛ الوصول عبر الدوال فقط)
-- ---------------------------------------------------------------------
create table if not exists public.member_card_tokens (
  token_hash text primary key,                                         -- sha256 (hex) للرمز؛ الخام لا يُخزَّن
  member_id  uuid not null references public.members(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists idx_member_card_tokens_member
  on public.member_card_tokens (member_id, created_at);

alter table public.member_card_tokens enable row level security;
revoke all on table public.member_card_tokens from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2) إصدار رمز (العضو النشط المصادق فقط)
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 3) التحقق (عام): شكل ناتج واحد للفشل، وحقول مسموحة فقط عند النجاح
-- ---------------------------------------------------------------------
create or replace function public.verify_member_card(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_headers json;
  v_ip      text;
  v_salt    text;
  v_hash    text;
  v_cnt     integer;
  v_m       public.members%rowtype;
  v_season  text;
  v_active  boolean;
begin
  -- حدّ لكل عميل (30 / 10 دقائق) قبل أي فحص للرمز، فلا يتأثر بصحته
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
    v_hash := encode(sha256(convert_to(coalesce(v_salt, '') || ':member-verify:' || v_ip, 'utf8')), 'hex');
    perform pg_advisory_xact_lock(hashtextextended(v_hash, 0));
    select count(*) into v_cnt
      from public.member_activation_throttle
     where client_hash = v_hash and created_at > now() - interval '10 minutes';
    if v_cnt >= 30 then
      raise exception 'rate_limited';
    end if;
    insert into public.member_activation_throttle (client_hash) values (v_hash);
    if random() < 0.05 then
      delete from public.member_activation_throttle where created_at < now() - interval '1 day';
    end if;
  end if;

  -- الشكل غير الصالح والمجهول والمنتهي والعضو غير النشط: نفس الاستجابة تمامًا
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' then
    return jsonb_build_object('valid', false);
  end if;

  select m.* into v_m
    from public.member_card_tokens t
    join public.members m on m.id = t.member_id
   where t.token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex')
     and t.expires_at > now()
     and m.status = 'active'
     and m.deleted_at is null;
  if not found then
    return jsonb_build_object('valid', false);
  end if;

  select nullif(btrim(value), '') into v_season from public.site_settings where key = 'current_season';
  if v_season is not null then
    v_active := exists (select 1 from public.member_memberships mm where mm.member_id = v_m.id and mm.season = v_season);
  end if;

  -- الحقول المسموحة فقط: لا هاتف ولا بريد ولا مدينة ولا معرّف عضو
  return jsonb_build_object(
    'valid', true,
    'full_name', v_m.full_name,
    'photo_url', v_m.photo_url,
    'university', v_m.university,
    'promotion', v_m.promotion,
    'track', v_m.track,
    'membership', jsonb_build_object('season', v_season, 'active', v_active)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 4) حالة انخراطي للموسم الحالي (العضو المصادق فقط)
-- ---------------------------------------------------------------------
create or replace function public.get_my_membership_status()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_id      uuid := public.current_member_id();
  v_season  text;
  v_paid_at date;
  v_active  boolean;
  v_prev    boolean;
begin
  if auth.uid() is null or v_id is null then return null; end if;

  select nullif(btrim(value), '') into v_season from public.site_settings where key = 'current_season';
  if v_season is null then
    return jsonb_build_object('season', null, 'active', null, 'paid_at', null, 'has_previous', false);
  end if;

  select mm.paid_at into v_paid_at
    from public.member_memberships mm
   where mm.member_id = v_id and mm.season = v_season;
  v_active := found;
  v_prev := exists (select 1 from public.member_memberships mm where mm.member_id = v_id and mm.season <> v_season);

  return jsonb_build_object('season', v_season, 'active', v_active, 'paid_at', v_paid_at, 'has_previous', v_prev);
end;
$$;

-- ---------------------------------------------------------------------
-- 5) الصلاحيات
-- ---------------------------------------------------------------------
revoke all on function public.issue_member_card_token()    from public, anon, authenticated;
revoke all on function public.verify_member_card(text)     from public, anon, authenticated;
revoke all on function public.get_my_membership_status()   from public, anon, authenticated;
grant execute on function public.verify_member_card(text)    to anon, authenticated;
grant execute on function public.issue_member_card_token()   to authenticated;
grant execute on function public.get_my_membership_status()  to authenticated;

notify pgrst, 'reload schema';

commit;
