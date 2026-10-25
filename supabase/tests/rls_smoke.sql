-- ============================================================
-- supabase/tests/rls_smoke.sql — فحص دخان لسياسات RLS والصلاحيات (للقراءة فقط، لا يترك أثرًا)
--
-- التشغيل: الصق الملف كاملًا في Supabase → SQL Editor (أو: psql "$DB_URL" -f supabase/tests/rls_smoke.sql).
-- يعمل داخل معاملة تُلغى (rollback) في النهاية، ولا يكتب شيئًا. أي فشل يرفع استثناءً يبدأ بـ FAIL: ويذكر السبب.
-- النجاح = رسالة NOTICE في النهاية. شغّله بعد كل migration أمنية جديدة وقبل كل نشر كبير.
--
-- ما يتحقق منه: الزائر (anon) لا يقرأ بيانات الأعضاء الشخصية، لا يدرج حالة 'approved'، لا يصل لجداول الإدارة
-- والتخزين الخاص ولا ينفّذ دوال الإدارة؛ ومستخدم موثّق بلا صف في profiles ليس مسؤولًا.
-- ============================================================
begin;

do $$
declare
  t      record;
  denied boolean;
  n      bigint;
begin
  -- ---------- (1) الزائر anon ----------
  set local role anon;

  -- (1.أ) عمليات يجب أن تُرفض بخطأ
  for t in
    select * from (values
      ('anon يقرأ members.email',                'select email from public.members limit 1'),
      ('anon يقرأ members.phone',                'select phone from public.members limit 1'),
      ('anon يقرأ members.age',                  'select age from public.members limit 1'),
      ('anon يدرج طلب انخراط بحالة approved',    $q$insert into public.membership_requests (full_name, email, phone, status) values ('x','smoke@example.com','0600000000','approved')$q$),
      ('anon يقرأ جدول throttle',                'select * from public.membership_request_throttle limit 1'),
      ('anon يستدعي approve_membership_request', 'select public.approve_membership_request(gen_random_uuid())'),
      ('anon يستدعي reject_membership_request',  $q$select public.reject_membership_request(gen_random_uuid(), 'x')$q$),
      ('anon يستدعي admin_active_members_count', 'select public.admin_active_members_count()')
    ) as v(label, q)
  loop
    denied := false;
    begin
      execute t.q;
    exception when others then
      denied := true;
    end;
    if not denied then
      raise exception 'FAIL: % (لم تُرفض)', t.label;
    end if;
  end loop;

  -- (1.ب) جداول يجب ألا يرى منها الزائر أي صف (خطأ صلاحية أو صفر صفوف كلاهما مقبول)
  for t in
    select * from (values
      ('public.audit_logs'), ('public.profiles'), ('public.membership_requests'),
      ('public.membership_forms'), ('public.internal_files'), ('public.budget_transactions')
    ) as v(tbl)
  loop
    begin
      execute format('select count(*) from %s', t.tbl) into n;
      if n > 0 then
        raise exception 'FAIL: anon يرى % صفًا من %', n, t.tbl;
      end if;
    exception when insufficient_privilege or undefined_table then
      null; -- مرفوض (أو الجدول غير موجود في هذه النسخة): مقبول
    end;
  end loop;

  begin
    select count(*) into n from storage.objects where bucket_id = 'membership-docs';
    if n > 0 then
      raise exception 'FAIL: anon يرى % ملفًا في membership-docs', n;
    end if;
  exception when insufficient_privilege then
    null;
  end;

  -- (1.ج) mfa_satisfied (0024) مغلقة على anon إن كانت الهجرة مطبّقة
  if to_regprocedure('public.mfa_satisfied()') is not null then
    denied := false;
    begin
      perform public.mfa_satisfied();
    exception when insufficient_privilege then
      denied := true;
    end;
    if not denied then
      raise exception 'FAIL: anon يستطيع تنفيذ public.mfa_satisfied()';
    end if;
  else
    raise notice 'تخطّي فحص mfa_satisfied: migration 0024 غير مطبّقة';
  end if;

  -- (1.د) ما يجب أن يعمل: الأعمدة العامة للأعضاء
  perform full_name, photo_url, promotion, track from public.members limit 1;

  -- ---------- (2) مستخدم موثّق بلا صف في profiles (ليس مسؤولًا) ----------
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-00000000dead","role":"authenticated","aal":"aal1"}', true);

  if public.is_admin() then raise exception 'FAIL: مستخدم بلا profile يُعدّ مسؤولًا'; end if;
  if public.can_manage_members() then raise exception 'FAIL: can_manage_members لمستخدم بلا profile'; end if;
  if public.can_manage_content() then raise exception 'FAIL: can_manage_content لمستخدم بلا profile'; end if;
  if public.can_manage_budget() then raise exception 'FAIL: can_manage_budget لمستخدم بلا profile'; end if;
  if public.is_super_admin() then raise exception 'FAIL: is_super_admin لمستخدم بلا profile'; end if;

  begin
    select count(*) into n from public.members;
    -- يُسمح بقراءة الأعمدة العامة فقط؛ القراءة الكاملة (email) يجب أن تعيد صفرًا لغير مسؤول
    select count(*) into n from public.members where email is not null;
    if n > 0 then raise exception 'FAIL: مستخدم بلا صلاحية يقرأ members.email'; end if;
  exception when insufficient_privilege then
    null;
  end;

  reset role;
  raise notice 'RLS smoke: كل الفحوص نجحت ✔';
end $$;

rollback;
