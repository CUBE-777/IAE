-- ============================================================
-- 0038_member_activation_throttle.sql — حدّ محاولات member-activate في القاعدة بدل ذاكرة الدالة
--
-- المشكلة: الحدّ في supabase/functions/member-activate كان خريطة في ذاكرة النسخة (recentCalls)، فتُصفَّر مع كل
--   cold start وتتوزع على النسخ، أي أن من يغيّر النسخة يتجاوزه. الدالة عامة (verify_jwt = false) وتعمل بـ service_role.
-- الحل: جدول أحداث مغلق + دالة member_activation_throttle_hit(p_key) تُستدعى من الدالة فقط (service_role):
--   * المفتاح (عنوان العميل) لا يُخزَّن خامًا: sha256 بالملح السرّي نفسه في membership_throttle_secret (0026).
--   * الحدّ: 8 محاولات لكل مفتاح خلال 10 دقائق (كما كان في الدالة)؛ تُرجع true = ممنوع، false = مسموح (وتُسجَّل المحاولة).
--   * قفل استشاري لكل مفتاح يمنع تجاوز الحدّ بطلبات متزامنة؛ تنظيف عشوائي للسجلات الأقدم من يوم.
-- لا يمسّ أي جدول أو دالة قائمة. يتطلب: 0026 و0036.   آمن لإعادة التشغيل.
-- ⚠️ بعد التنفيذ أعد نشر member-activate (النسخة الجديدة تستدعي الدالة وتعود للحدّ المحلي إن فشل الاستدعاء).
-- ⚠️ تجربة جافة أولًا: استبدل `commit;` الأخيرة بـ `rollback;`. الرجوع: supabase/rollback/0038_member_activation_throttle_down.sql
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.membership_throttle_secret') is null then
    raise exception 'شغّل 0026_throttle_salted_hash.sql أولاً';
  end if;
  if to_regprocedure('public.prepare_member_activation(text)') is null then
    raise exception 'شغّل 0036_member_space_activation_and_card_requests.sql أولاً';
  end if;
end $$;

create table if not exists public.member_activation_throttle (
  id          bigint generated always as identity primary key,
  client_hash text not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_member_activation_throttle_hash
  on public.member_activation_throttle (client_hash, created_at desc);

alter table public.member_activation_throttle enable row level security;
revoke all on table public.member_activation_throttle from public, anon, authenticated;

create or replace function public.member_activation_throttle_hit(p_key text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_salt text;
  v_hash text;
  v_cnt  integer;
begin
  if p_key is null or btrim(p_key) = '' then
    return false;  -- لا مفتاح: لا نحدّ (الدالة تتجاوز هذا بنفسها عند عنوان مجهول)
  end if;

  select salt into v_salt from public.membership_throttle_secret where id = 1;
  v_hash := encode(sha256(convert_to(coalesce(v_salt, '') || ':member-activate:' || btrim(p_key), 'utf8')), 'hex');

  -- تسلسل الطلبات المتزامنة لنفس المفتاح حتى لا يتجاوز عدّها الحدّ
  perform pg_advisory_xact_lock(hashtextextended(v_hash, 0));

  select count(*) into v_cnt
    from public.member_activation_throttle
   where client_hash = v_hash
     and created_at > now() - interval '10 minutes';
  if v_cnt >= 8 then
    return true;
  end if;

  insert into public.member_activation_throttle (client_hash) values (v_hash);

  if random() < 0.05 then
    delete from public.member_activation_throttle where created_at < now() - interval '1 day';
  end if;
  return false;
end;
$$;

revoke all on function public.member_activation_throttle_hit(text) from public, anon, authenticated;
grant execute on function public.member_activation_throttle_hit(text) to service_role;

notify pgrst, 'reload schema';

commit;
