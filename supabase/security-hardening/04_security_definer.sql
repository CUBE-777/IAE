-- ============================================================
-- 04_security_definer.sql — Phase 3: دوال SECURITY DEFINER وصلاحيات EXECUTE
-- نفّذه يدويًا بعد 02. يغيّر صلاحيات EXECUTE فقط (لا يعيد كتابة أي دالة، لا تغيير في الأسماء/التوقيعات/الإرجاع).
--
-- نتيجة الفحص (من الكود ومن تشغيل كل migrations على Postgres محلي):
--   * كل دوال SECURITY DEFINER في public تثبّت search_path = public[, auth], pg_temp  ← سليم، لا تعديل.
--   * الدوال العامة (anon) المطلوبة وظيفيًا، وكلها تتحقق من رمز عشوائي مُجزَّأ أو ترجع بيانات محدودة، ولا تُسحب منها الصلاحية:
--       get_member_activation_link, get_invitation, respond_invitation, get_board_profile_link, get_membership_form,
--       submit_membership_form, submit_board_profile, verify_member_card, request_member_access_help,
--       board_photo_upload_allowed, membership_upload_allowed
--     (الأخيرتان تُستدعيان داخل سياسات storage.objects لدور anon فلا بدّ من EXECUTE لـ anon.)
--   * دوال مساعدة تبقى EXECUTE لـ anon عمدًا لأن سياسات RLS بلا «to» تُقيَّم لدور anon:
--       current_admin_role, is_admin, is_super_admin, can_manage_content, can_manage_members
--     (تُرجع null/false بلا جلسة. سحب EXECUTE منها يكسر قراءة الجداول العامة للزوار.)
--   * الثغرة الفعلية في هذا الباب كانت منطق الحراسة (NULL) وقد عولجت في 02 (الجزء 1-أ).
--
-- ما يفعله هذا الملف (تنظيف سطح الهجوم، بلا أثر وظيفي):
--   دوال Trigger من نوع SECURITY DEFINER لا يُنشئ لها 0006–0028 أي REVOKE فتبقى EXECUTE لـ PUBLIC. الـ trigger لا يحتاج
--   EXECUTE عند التشغيل (يُفحَص عند إنشاء الـ trigger فقط) — وهو النمط نفسه المعتمد أصلًا في 0050–0060 دون أي مشكلة.
--
-- الوظائف التي قد تتأثر: لا شيء. التراجع: 08_rollback.sql → «Phase 3».
-- ============================================================
begin;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.budget_category_audit()',
    'public.budget_tx_audit()',
    'public.budget_tx_guard()',
    'public.prevent_audit_log_update()',
    'public.prevent_profile_email_change()',
    'public.protect_developer_profiles()',
    'public.announcements_before_write()'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', f);
    else
      raise notice 'تخطّي % (غير موجودة)', f;
    end if;
  end loop;
end $$;

-- تنبيه فقط (لا يسحب شيئًا): أي دالة SECURITY DEFINER في public ما زالت تنفَّذ من anon وليست ضمن القائمة المعتمدة أعلاه.
do $$
declare
  r record;
  v_allow text[] := array[
    'get_member_activation_link','get_invitation','respond_invitation','get_board_profile_link','get_membership_form',
    'submit_membership_form','submit_board_profile','verify_member_card','request_member_access_help',
    'board_photo_upload_allowed','membership_upload_allowed',
    'current_admin_role','is_admin','is_super_admin','can_manage_content','can_manage_members',
    'association_media_object_public'
  ];
begin
  for r in
    select p.oid::regprocedure::text as sig, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and has_function_privilege('anon', p.oid, 'execute')
       and p.proname <> all (v_allow)
  loop
    raise notice 'تنبيه: % قابلة للتنفيذ من anon وليست في القائمة المعتمدة — راجعها يدويًا', r.sig;
  end loop;
end $$;

commit;
