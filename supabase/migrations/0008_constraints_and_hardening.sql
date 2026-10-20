-- ============================================================
-- 0008_constraints_and_hardening.sql
-- تحقق إضافي على مستوى القاعدة (defense-in-depth — لا نعتمد على
-- الواجهة الأمامية وحدها) + حماية من التكرار (spam) + تحصين audit_logs.
-- ============================================================

-- ---------- membership_requests: تحقق أساسي من شكل البيانات ----------
alter table public.membership_requests
  drop constraint if exists membership_requests_email_format_chk,
  drop constraint if exists membership_requests_full_name_len_chk,
  drop constraint if exists membership_requests_phone_len_chk,
  drop constraint if exists membership_requests_message_len_chk;

alter table public.membership_requests
  add constraint membership_requests_email_format_chk
    check (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  add constraint membership_requests_full_name_len_chk
    check (char_length(full_name) between 2 and 150),
  add constraint membership_requests_phone_len_chk
    check (char_length(phone) between 6 and 30),
  add constraint membership_requests_message_len_chk
    check (message is null or char_length(message) <= 2000);

-- حماية من تكرار الطلب لنفس البريد أثناء انتظاره للمراجعة (spam/إرسال متكرر
-- بالخطأ). لا تمنع تقديم طلب جديد بعد رفض/قبول الطلب السابق.
create unique index if not exists idx_membership_requests_unique_pending_email
  on public.membership_requests (lower(email))
  where status = 'pending';

-- ---------- members: نفس التحقق الأساسي عند إدخال الإدارة ----------
alter table public.members
  drop constraint if exists members_full_name_len_chk,
  drop constraint if exists members_email_format_chk;

alter table public.members
  add constraint members_full_name_len_chk
    check (char_length(full_name) between 2 and 150),
  add constraint members_email_format_chk
    check (email is null or email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

-- ---------- announcements: تحقق طول النص ----------
alter table public.announcements
  drop constraint if exists announcements_text_len_chk;

alter table public.announcements
  add constraint announcements_text_len_chk
    check (char_length(text) between 1 and 500);

-- ---------- audit_logs: منع أي تعديل لاحق على السجلات (immutability) ----------
-- لا توجد أصلاً سياسة UPDATE على audit_logs (RLS تمنع كل شيء لم يُسمح به
-- صراحة)، لكن نضيف trigger صريح يرفض أي UPDATE حتى من الجداول التي قد
-- تُمنح لها صلاحيات مستقبلاً بالخطأ — دفاع متعدد الطبقات.
create or replace function public.prevent_audit_log_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'سجلات audit_logs غير قابلة للتعديل';
end;
$$;

drop trigger if exists trg_prevent_audit_log_update on public.audit_logs;
create trigger trg_prevent_audit_log_update
  before update on public.audit_logs
  for each row execute function public.prevent_audit_log_update();
