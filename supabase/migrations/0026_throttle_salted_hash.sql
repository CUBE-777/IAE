-- ============================================================
-- 0026_throttle_salted_hash.sql — تجزئة بصمة العميل بملح سرّي بدل md5 بملح ثابت
-- يتطلب: 0022. آمن لإعادة التشغيل (idempotent). شغّله في SQL Editor.
--
-- المشكلة: md5('iae-throttle-v1:' || ip) بملح ثابت ومعروف في الكود يمكن عكسه بتجربة كل عناوين IPv4
-- (نحو 4 مليارات احتمال)، فلا تحمي «بصمة مجزّأة» خصوصية الزائر لو تسرّب الجدول.
-- الإصلاح: ملح عشوائي مولّد داخل القاعدة نفسها (لا يظهر في الكود ولا في أي دور عميل) + sha256.
-- سجلات 0022 القديمة (md5) تُحذف تلقائيًا خلال 24 ساعة ولا تؤثر على الحدود الجديدة إلا بمرور وقت قصير.
-- منطق الحدود (5 / 10 دقائق لكل عميل، 3 / ساعة لكل بريد، 300 / 10 دقائق عام) ورسالة rate_limited كما هي.
-- ============================================================

create table if not exists public.membership_throttle_secret (
  id   smallint primary key default 1 check (id = 1),
  salt text not null default encode(gen_random_bytes(32), 'hex')
);

alter table public.membership_throttle_secret enable row level security;
revoke all on table public.membership_throttle_secret from public, anon, authenticated;

insert into public.membership_throttle_secret (id) values (1) on conflict (id) do nothing;

create or replace function public.membership_requests_throttle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_headers json;
  v_ip      text;
  v_hash    text;
  v_salt    text;
  v_cnt     integer;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    v_headers := null;
  end;

  v_ip := coalesce(
    nullif(btrim(v_headers->>'cf-connecting-ip'), ''),
    nullif(btrim(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1)), '')
  );

  -- (أ) لكل عميل
  if v_ip is not null then
    select salt into v_salt from public.membership_throttle_secret where id = 1;
    v_hash := encode(sha256(convert_to(coalesce(v_salt, '') || ':' || v_ip, 'utf8')), 'hex');
    select count(*) into v_cnt
      from public.membership_request_throttle
     where client_hash = v_hash
       and created_at > now() - interval '10 minutes';
    if v_cnt >= 5 then
      raise exception 'rate_limited' using errcode = 'P0001',
        hint = 'عدد كبير من الطلبات خلال وقت قصير، حاول لاحقًا.';
    end if;
    insert into public.membership_request_throttle (client_hash) values (v_hash);
  end if;

  -- (ب) لكل بريد إلكتروني
  select count(*) into v_cnt
    from public.membership_requests
   where lower(email) = lower(new.email)
     and created_at > now() - interval '1 hour';
  if v_cnt >= 3 then
    raise exception 'rate_limited' using errcode = 'P0001',
      hint = 'عدد كبير من الطلبات لنفس البريد، حاول لاحقًا.';
  end if;

  -- (ج) سقف عام احتياطي
  select count(*) into v_cnt
    from public.membership_requests
   where created_at > now() - interval '10 minutes';
  if v_cnt >= 300 then
    raise exception 'rate_limited' using errcode = 'P0001',
      hint = 'ضغط مرتفع على النموذج، حاول لاحقًا.';
  end if;

  -- تنظيف دوري للسجلات الأقدم من يوم
  if random() < 0.05 then
    delete from public.membership_request_throttle where created_at < now() - interval '1 day';
  end if;

  return new;
end;
$$;

revoke execute on function public.membership_requests_throttle() from public, anon, authenticated;

notify pgrst, 'reload schema';
