-- ============================================================
-- 0023_privacy_consent.sql — إقرار الموافقة على سياسة الخصوصية في طلبات الانخراط
-- يتطلب: 0021. آمن لإعادة التشغيل (idempotent). تغيير إضافي فقط: لا يمسّ أي بيانات أو سياسات قائمة.
--
-- ⚠️ شغّله على Supabase *قبل* نشر الواجهة الجديدة: الواجهة الجديدة ترسل العمود privacy_consent
--    وسيرفضها PostgREST إن لم يكن العمود موجودًا.
--
-- التصميم:
--  * privacy_consent     : تضعه الواجهة (true عند تأشير الخانة). لا يُفرض في القاعدة عمدًا (NOT NULL default false)
--                          حتى لا تفشل طلبات من نسخة قديمة مخزّنة في متصفح زائر أثناء النشر.
--  * privacy_consent_at  : لا يضعه العميل أبدًا؛ يختمه trigger بوقت الخادم عند الموافقة (دليل زمني غير قابل للتزوير).
-- ============================================================

alter table public.membership_requests
  add column if not exists privacy_consent    boolean     not null default false,
  add column if not exists privacy_consent_at timestamptz;

-- الزائر يستطيع إرسال privacy_consent فقط (privacy_consent_at غير ممنوح عمدًا). المنح تراكمي فلا يتأثر ما في 0021.
grant insert (privacy_consent) on public.membership_requests to anon, authenticated;

create or replace function public.membership_requests_stamp_consent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.privacy_consent_at := case when coalesce(new.privacy_consent, false) then now() else null end;
  return new;
end;
$$;

revoke execute on function public.membership_requests_stamp_consent() from public, anon, authenticated;

drop trigger if exists trg_membership_requests_stamp_consent on public.membership_requests;
create trigger trg_membership_requests_stamp_consent
  before insert on public.membership_requests
  for each row execute function public.membership_requests_stamp_consent();

notify pgrst, 'reload schema';
