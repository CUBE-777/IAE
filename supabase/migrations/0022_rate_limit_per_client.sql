-- ============================================================
-- 0022_rate_limit_per_client.sql — إصلاح حد المعدل في 0021
-- يتطلب: 0021. آمن لإعادة التشغيل (idempotent). شغّله في SQL Editor.
--
-- المشكلة في 0021: الحد كان عامًا (30 طلبًا / 10 دقائق لكل الزوار)، فمن يرسل 30 طلبًا
-- وهميًا يمنع كل الزوار الحقيقيين من الانخراط. هنا يصبح الحد:
--   (أ) لكل عميل (بصمة IP مجزّأة) : 5 طلبات / 10 دقائق
--   (ب) لكل بريد إلكتروني         : 3 طلبات / ساعة
--   (ج) سقف عام احتياطي مرتفع     : 300 طلب / 10 دقائق (ضد الإغراق الموزّع فقط)
-- رسالة الخطأ 'rate_limited' كما هي، فتعرضها الواجهة (forms.rateLimited) بلا تغيير.
--
-- تنبيهات:
--  * عنوان العميل يُقرأ من ترويسة cf-connecting-ip ثم x-forwarded-for (أول عنصر). إن لم يتوفر
--    يُتخطّى الحد (أ) ويبقى (ب) و(ج). الحماية "أفضل جهد" وليست بديلًا عن Turnstile.
--  * نخزّن بصمة md5 مملّحة فقط (لا عنوان IP خام) وتُحذف السجلات بعد 24 ساعة.
--  * المحاولات الفاشلة (مثلًا بريد معلّق مكرر) يتراجع إدراجها كله فلا تُحتسب.
-- ============================================================

-- جدول داخلي: لا سياسات ولا صلاحيات لأي دور عميل، يكتب فيه الـ trigger (SECURITY DEFINER) فقط.
create table if not exists public.membership_request_throttle (
  id          bigint generated always as identity primary key,
  client_hash text        not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_membership_request_throttle_client
  on public.membership_request_throttle (client_hash, created_at desc);
create index if not exists idx_membership_request_throttle_created
  on public.membership_request_throttle (created_at);

alter table public.membership_request_throttle enable row level security;
revoke all on table public.membership_request_throttle from public, anon, authenticated;

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
  v_cnt     integer;
begin
  -- ترويسات الطلب كما يمرّرها PostgREST (قد لا تتوفر عند الإدراج المباشر من SQL Editor)
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
    v_hash := md5('iae-throttle-v1:' || v_ip);
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

  -- (ج) سقف عام احتياطي (مرتفع عمدًا كي لا يستطيع مهاجم واحد حجب الجميع بسهولة)
  select count(*) into v_cnt
    from public.membership_requests
   where created_at > now() - interval '10 minutes';
  if v_cnt >= 300 then
    raise exception 'rate_limited' using errcode = 'P0001',
      hint = 'ضغط مرتفع على النموذج، حاول لاحقًا.';
  end if;

  -- تنظيف دوري (حوالي 5% من الإدراجات) للسجلات الأقدم من يوم
  if random() < 0.05 then
    delete from public.membership_request_throttle where created_at < now() - interval '1 day';
  end if;

  return new;
end;
$$;

revoke execute on function public.membership_requests_throttle() from public, anon, authenticated;

-- الـ trigger نفسه موجود من 0021 ويستدعي الدالة بالاسم، لكن نعيد إنشاءه لضمان وجوده.
drop trigger if exists trg_membership_requests_throttle on public.membership_requests;
create trigger trg_membership_requests_throttle
  before insert on public.membership_requests
  for each row execute function public.membership_requests_throttle();

notify pgrst, 'reload schema';
