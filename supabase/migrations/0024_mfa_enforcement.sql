-- ============================================================
-- 0024_mfa_enforcement.sql — فرض المصادقة الثنائية (TOTP) على من فعّلها فقط
-- يتطلب: 0006 و0019. آمن لإعادة التشغيل (idempotent).
--
-- الفكرة: كل صلاحيات الإدارة في RLS تمرّ عبر دالتين فقط: current_admin_role() و is_admin()
-- (وكل دوال can_* تعتمد على الأولى). لذا نضيف شرطًا واحدًا فيهما:
--     "لا يملك المستخدم عاملًا موثّقًا (verified) للـ MFA، أو جلسته الحالية بمستوى aal2"
--
-- النتيجة:
--  * مسؤول لم يفعّل MFA: لا يتغيّر عليه أي شيء (لا قفل ولا انقطاع).
--  * مسؤول فعّل MFA: رمز الدخول بكلمة المرور وحدها (aal1) لا يمنحه أي صلاحية إدارية في القاعدة، حتى لو
--    استدعى API مباشرة متجاوزًا الواجهة. لا بد من إدخال رمز التطبيق (aal2).
--  * قراءة صفّه الشخصي في profiles تبقى ممكنة بـ aal1 (سياسة id = auth.uid()) لتعرض الواجهة شاشة الرمز.
--  * دالة الـ Edge Function (service_role) لا تتأثر.
--
-- ⚠️ تأكد في لوحة Supabase من تفعيل TOTP: Authentication → Sign In / Providers → Multi-Factor (Enroll + Verify).
-- ⚠️ الاسترداد إن ضاع هاتف مسؤول: Authentication → Users → المستخدم → Remove factor (انظر docs/SECURITY_MFA.md).
-- ============================================================

create or replace function public.mfa_satisfied()
returns boolean
language sql
security definer
stable
set search_path = public, auth, pg_temp
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors
        where user_id = auth.uid() and status = 'verified'
      );
$$;

-- تُستدعى من دالتين SECURITY DEFINER فقط، فلا حاجة لمنحها لأي دور عميل.
revoke execute on function public.mfa_satisfied() from public, anon, authenticated;

create or replace function public.current_admin_role()
returns admin_role
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select role from public.profiles
  where id = auth.uid() and is_active = true
    and public.mfa_satisfied()
  limit 1;
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true
      and public.mfa_satisfied()
  );
$$;

notify pgrst, 'reload schema';
