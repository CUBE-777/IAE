-- ============================================================
-- 0021_security_phase1.sql — المرحلة 1: تحصين الأمان
-- يتطلب: 0001 إلى 0020. آمن لإعادة التشغيل (idempotent). شغّله دفعة واحدة في SQL Editor
-- *قبل* نشر الواجهة الجديدة (الواجهة تعمل أيضًا قبله، لكن الحماية لا تُفعَّل إلا به).
--
--  (1) membership_requests: كان الإدراج العام `with check (true)` بلا قيد على الأعمدة،
--      فيستطيع أي زائر إرسال status='approved' أو reviewed_by أو rejection_reason مباشرة عبر API.
--      الإصلاح: منح INSERT على أعمدة النموذج فقط + سياسة تفرض الحالة الأولية + حد لمعدل الإدراج.
--  (2) members: كانت كل الأدوار الإدارية (محرر، أمين مال...) تقرأ البريد والهاتف لكل الأعضاء.
--      الإصلاح: القراءة الكاملة لأدوار إدارة الأعضاء فقط. باقي الأدوار تحصل على
--      عدّاد الأعضاء عبر دالة آمنة، وأمين المال يعمل عبر دوال SECURITY DEFINER الموجودة أصلاً.
-- ============================================================

-- ---------- (1) membership_requests ----------

-- 1.1 صلاحيات الأعمدة: الزائر يملأ حقول النموذج فقط؛ الباقي (status, reviewed_*, form_status ...)
--     يبقى على قيمه الافتراضية ولا يمكن للعميل تحديده.
revoke insert on public.membership_requests from anon, authenticated;
grant insert (full_name, email, phone, promotion, track, profession, city, message)
  on public.membership_requests to anon, authenticated;

-- 1.2 السياسة: حتى لو أُعيد منح INSERT كاملاً لاحقًا بالخطأ، تبقى الحالة الأولية مفروضة.
drop policy if exists "membership_requests_public_insert" on public.membership_requests;
create policy "membership_requests_public_insert"
  on public.membership_requests for insert
  to anon, authenticated
  with check (
    status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and rejection_reason is null
  );

-- 1.3 حد معدل الإدراج (حماية أساسية من الإغراق بلا خدمة خارجية):
--     أكثر من 30 طلبًا خلال 10 دقائق → رفض. قيد البريد المعلّق الفريد (0008) يبقى كما هو.
--     للتعديل: غيّر الرقمين أدناه. لحماية أقوى أضف Cloudflare Turnstile لاحقًا.
create or replace function public.membership_requests_throttle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (select count(*) from public.membership_requests
       where created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'rate_limited' using errcode = 'P0001',
      hint = 'عدد كبير من الطلبات خلال وقت قصير، حاول لاحقًا.';
  end if;
  return new;
end;
$$;

revoke execute on function public.membership_requests_throttle() from public, anon, authenticated;

drop trigger if exists trg_membership_requests_throttle on public.membership_requests;
create trigger trg_membership_requests_throttle
  before insert on public.membership_requests
  for each row execute function public.membership_requests_throttle();

-- ---------- (2) members: حصر قراءة البيانات الشخصية ----------

-- 2.1 عدّاد الأعضاء للوحة المؤشرات (لا يكشف أي بيانات شخصية)
create or replace function public.admin_active_members_count()
returns integer
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select case
    when public.is_admin() then (select count(*)::int from public.members where deleted_at is null)
    else null
  end;
$$;

revoke execute on function public.admin_active_members_count() from public, anon;
grant  execute on function public.admin_active_members_count() to authenticated;

-- 2.2 القراءة الكاملة لمن يدير الأعضاء فقط (نفس أدوار can_manage_members في 0019).
--     ملاحظة: القراءة العامة للأعضاء النشطين تمرّ عبر دور anon (0007) — والواجهة تستعمل الآن
--     عميلًا مجهول الجلسة للصفحات العامة، فلا يتأثر عرض الموقع لمن سجّل دخوله كمسؤول.
drop policy if exists "members_admin_read_all" on public.members;
create policy "members_admin_read_all"
  on public.members for select
  to authenticated
  using (public.can_manage_members());

notify pgrst, 'reload schema';
