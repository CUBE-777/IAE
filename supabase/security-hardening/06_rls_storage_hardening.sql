-- ============================================================
-- 06_rls_storage_hardening.sql — Phase 5: RLS وStorage وصلاحيات الجداول
-- نفّذه يدويًا بعد 02 (يعتمد على is_developer() الجديدة). لا يعطّل RLS ولا يحوّل أي bucket إلى Private/Public.
--
-- نتيجة المراجعة (من كل migrations، ثم بتشغيلها محليًا):
--   * RLS مفعّل على كل جداول public (لا جدول بلا RLS). الجداول المغلقة (رموز، أسرار، throttle، دعوات، حضور) بلا سياسات
--     وبلا GRANT لأدوار العميل = رفض كامل، والوصول عبر دوال SECURITY DEFINER فقط. سليم.
--   * أعمدة members الحساسة (email/phone/age/city/bio) غير ممنوحة لـ anon، والصفوف مقيّدة بـ show_in_directory (0007/0030). سليم.
--   * buckets الخاصة (membership-docs, budget-receipts, internal-files): بلا أي سياسة SELECT لـ anon، والقراءة بأدوار محددة. سليم.
--   * منح الجداول الواسع الافتراضي في Supabase (ALL لـ anon/authenticated) غير ثغرة بحد ذاته لأن RLS يحكم كل جدول — لم يُسحب.
--
-- ما يعالجه هذا الملف:
--   6.1 audit_logs: سياسة audit_logs_super_admin_delete (0003) تتيح لـ super_admin حذف سجلات التدقيق عبر الـ API، فيمحو أي
--       مسؤول أثر عملياته. الواجهة لا تحذف السجل إطلاقًا (فُحص src). يصبح الحذف للمطوّر وحده (مرجع الصلاحيات العليا)،
--       ويبقى UPDATE ممنوعًا (trigger 0008 + سحب الصلاحية 0009) والقراءة والإدراج كما هما.
--   6.2 سحب صلاحيات TRUNCATE وREFERENCES وTRIGGER من anon وauthenticated على كل جداول public. لا تمرّ عبر RLS ولا يستعملها
--       PostgREST/الواجهة؛ سحبها دفاع إضافي بلا أثر وظيفي (select/insert/update/delete لا تُمَسّ).
--   6.3 تأكيد أن buckets الداخلية خاصة (تصحيح إن وُجد أحدها عامًا بالخطأ). لا يمسّ association-media (عام عمدًا).
--
-- ما لا يُنفَّذ هنا (قرار/خارج SQL): انظر الكتلة الاختيارية 6.4 المعطّلة أدناه، وتقرير 00 لبقية التوصيات.
--
-- الوظائف التي قد تتأثر: حذف سجل التدقيق من غير المطوّر (غير مستعمل في الواجهة). غير ذلك لا شيء.
-- التراجع: 08_rollback.sql → «Phase 5».
-- ============================================================
begin;

do $$
begin
  if to_regprocedure('public.is_developer()') is null then
    raise exception 'نفّذ 0012 ثم 02_roles_hardening.sql أولًا (is_developer غير موجودة)';
  end if;
end $$;

-- ---------- 6.1 audit_logs ----------
drop policy if exists "audit_logs_super_admin_delete" on public.audit_logs;
drop policy if exists "audit_logs_developer_delete" on public.audit_logs;
create policy "audit_logs_developer_delete"
  on public.audit_logs for delete
  using (public.is_developer());

-- ---------- 6.2 صلاحيات لا تمرّ عبر RLS ----------
do $$
declare
  t record;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('revoke truncate, references, trigger on table public.%I from anon, authenticated', t.relname);
  end loop;
end $$;

-- ---------- 6.3 buckets الداخلية خاصة ----------
update storage.buckets
   set public = false
 where id in ('membership-docs', 'budget-receipts', 'internal-files')
   and public is distinct from false;

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- 6.4 (اختياري — معطّل افتراضيًا): سحب الكتابة المباشرة من anon على الجداول
-- لم يثبت أنه ثغرة (RLS يمنع كتابة anon على كل جدول)، لكن anon لا يحتاج DML إلا على membership_requests (INSERT بأعمدة محددة).
-- إن أردت هذا الدفاع الإضافي، أزل التعليق ونفّذه في معاملة مستقلة وشغّل 07_post_checks.sql بعده.
-- تنبيه: لا تستثنِ membership_requests وإلا يتعطّل نموذج طلب الانخراط العام (سحب INSERT على الجدول يلغي منح الأعمدة).
--
-- begin;
-- do $$
-- declare t record;
-- begin
--   for t in
--     select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
--      where n.nspname = 'public' and c.relkind in ('r','p') and c.relname <> 'membership_requests'
--   loop
--     execute format('revoke insert, update, delete on table public.%I from anon', t.relname);
--   end loop;
-- end $$;
-- commit;
