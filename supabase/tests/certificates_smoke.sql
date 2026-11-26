-- ============================================================
-- supabase/tests/certificates_smoke.sql — فحص سلوكي لنظام الشهادات (0063 → 0066). يعمل داخل معاملة تُلغى (rollback) ولا يترك أثرًا.
--
-- التشغيل: الصق الملف كاملًا في Supabase → SQL Editor (أو: psql "$DB_URL" -f supabase/tests/certificates_smoke.sql) بعد تطبيق 0063 → 0066.
-- ⚠️ شغّله على بيئة تجريبية لا على الإنتاج (رغم الإلغاء الكامل، فهو يكتب مؤقتًا في auth.users/members/audit_logs).
-- أي فشل يرفع استثناءً يبدأ بـ FAIL: ويذكر السبب. النجاح = رسالة NOTICE في النهاية.
-- ملاحظة: السباق الحقيقي بين جلستين (إلغاء/إرسال، ترقيم متزامن) لا يمكن محاكاته في معاملة واحدة؛ هنا يُختبر المنطق المتسلسل
--   لكل سيناريو. راجع «اختبار التزامن اليدوي» في docs/CERTIFICATES_DB.md.
--
-- يغطّي: صلاحيات الأدوار، RLS وعزل members_manager، حماية السرّ، الحملة ودورة حياتها، منع التكرار، الترقيم، الرمز والتحقق العام،
--   خصوصية الاسم (تضييق فقط)، تدوير السرّ (المطوّر وحده) وأثره، حذف العضو وبقاء الشهادة وعدم نقل الملكية، الإلغاء ومنع الإرسال،
--   الطابور (claim/recheck/complete/retry/stale)، الأرشفة، الثبات (immutability)، وعدم تسرّب PII إلى audit_logs.
-- ============================================================
begin;

do $$
declare
  u_dev  uuid := gen_random_uuid();  u_super uuid := gen_random_uuid();  u_sec  uuid := gen_random_uuid();
  u_mm   uuid := gen_random_uuid();  u_edit  uuid := gen_random_uuid();
  u_a    uuid := gen_random_uuid();  u_b     uuid := gen_random_uuid();
  m_a uuid; m_b uuid; m_c uuid; act uuid; tpl uuid;
  camp uuid; camp2 uuid; recx uuid;
  c_a uuid; c_b uuid; c_x uuid;
  n_a text; n_b text; n_x text;
  tok text; tok_old text; tok_new text; got jsonb; got2 jsonb; n int; s text; denied boolean; qid uuid; qid2 uuid;
  c_y uuid;
begin
  if to_regprocedure('public.verify_certificate(text)') is null or to_regprocedure('public.certificate_email_claim_next(text)') is null then
    raise exception 'FAIL: دوال 0063-0066 غير موجودة — طبّقها أولًا';
  end if;

  -- ---------- تجهيز (بصلاحية المالك) ----------
  insert into auth.users (id, email) values
    (u_dev, '__cert_dev@example.invalid'), (u_super, '__cert_super@example.invalid'), (u_sec, '__cert_sec@example.invalid'),
    (u_mm, '__cert_mm@example.invalid'), (u_edit, '__cert_edit@example.invalid'),
    (u_a, '__cert_a@example.invalid'), (u_b, '__cert_b@example.invalid');
  insert into public.profiles (id, full_name, email, role, must_change_password) values
    (u_dev,   '__cert_dev',   '__cert_dev@example.invalid',   'developer',         false),
    (u_super, '__cert_super', '__cert_super@example.invalid', 'super_admin',       false),
    (u_sec,   '__cert_sec',   '__cert_sec@example.invalid',   'secretary_general', false),
    (u_mm,    '__cert_mm',    '__cert_mm@example.invalid',    'members_manager',   false),
    (u_edit,  '__cert_edit',  '__cert_edit@example.invalid',  'editor',            false);
  insert into public.members (full_name, email, status) values ('Ahmed Alaoui', 'ahmed.alaoui@example.invalid', 'active') returning id into m_a;
  insert into public.members (full_name, email, status) values ('Salma Bennani', null, 'active') returning id into m_b;
  insert into public.members (full_name, email, status) values ('Youssef Tazi', 'youssef@example.invalid', 'active') returning id into m_c;
  insert into public.member_accounts (user_id, member_id, must_change_password) values (u_a, m_a, false), (u_b, m_b, false);
  insert into public.activities (title, status) values ('__cert_smoke_activity__', 'published') returning id into act;
  insert into public.activity_attendance (activity_id, member_id) values (act, m_a), (act, m_b);
  select id into tpl from public.certificate_templates where code = 'academic';
  if tpl is null then raise exception 'FAIL: القالب الافتراضي academic غير موجود'; end if;
  select count(*) into n from public.certificate_templates where is_system;
  if n <> 4 then raise exception 'FAIL: عدد القوالب الافتراضية % ≠ 4', n; end if;

  set local role authenticated;

  -- ---------- 1) دوال الصلاحيات ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_dev, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  if not (public.can_admin_certificates() and public.can_manage_certificates() and public.can_review_certificate_recipients()) then raise exception 'FAIL: developer ناقص الصلاحيات'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_super, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  if not (public.can_admin_certificates() and public.can_manage_certificates() and public.can_review_certificate_recipients()) then raise exception 'FAIL: super_admin ناقص الصلاحيات'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sec, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  if public.can_admin_certificates() or not public.can_manage_certificates() or not public.can_review_certificate_recipients() then raise exception 'FAIL: صلاحيات secretary_general خاطئة'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mm, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  if public.can_admin_certificates() or public.can_manage_certificates() or not public.can_review_certificate_recipients() then raise exception 'FAIL: صلاحيات members_manager خاطئة'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_edit, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  if public.can_admin_certificates() or public.can_manage_certificates() or public.can_review_certificate_recipients() then raise exception 'FAIL: editor يملك صلاحية شهادات'; end if;

  -- ---------- 2) السرّ مغلق حتى على المطوّر؛ لا كتابة مباشرة لأي أحد ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_dev, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  denied := false;
  begin perform 1 from public.certificate_token_secret; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL: developer يقرأ certificate_token_secret مباشرة'; end if;
  denied := false;
  begin perform 1 from public.certificate_number_counters; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL: قراءة مباشرة لعدّادات الأرقام'; end if;
  denied := false;
  begin insert into public.certificate_campaigns (title, certificate_type, eligibility_source, template_id) values ('x x x', 'participation', 'manual_selection', tpl);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL: INSERT مباشر على الحملات مسموح'; end if;
  denied := false;
  begin perform token_hash from public.certificates; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL: عمود token_hash مقروء'; end if;
  denied := false;
  begin perform public.certificate_hmac('\x00'::bytea, '\x00'::bytea); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL: certificate_hmac قابلة للاستدعاء من authenticated'; end if;

  -- ---------- 3) الحملة: إنشاء وقيود ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_sec, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  denied := false;
  begin perform public.certificate_create_campaign('Registration based', 'participation', 'registration_based', act, tpl);
  exception when others then denied := sqlerrm like '%certificate_registration_based_disabled%'; end;
  if not denied then raise exception 'FAIL: registration_based غير معطّل'; end if;
  denied := false;
  begin perform public.certificate_create_campaign('Attendance no activity', 'participation', 'attendance_based', null, tpl);
  exception when others then denied := sqlerrm like '%certificate_activity_required%'; end;
  if not denied then raise exception 'FAIL: attendance_based بلا نشاط مقبول'; end if;

  camp := public.certificate_create_campaign('Smoke Participation', 'participation', 'attendance_based', act, tpl);
  n := public.certificate_add_attendance_recipients(camp);
  if n <> 2 then raise exception 'FAIL: مستفيدو الحضور % ≠ 2', n; end if;
  if public.certificate_add_attendance_recipients(camp) <> 0 then raise exception 'FAIL: تكرار المستفيدين من الحضور'; end if;
  denied := false;
  begin perform public.certificate_add_external_recipient(camp, 'Ext Person', 'ext@example.invalid');
  exception when others then denied := sqlerrm like '%certificate_wrong_eligibility%'; end;
  if not denied then raise exception 'FAIL: مستفيد خارجي في حملة حضور'; end if;

  -- حملة يدوية: عضو + خارجي، ومنع التكرار
  camp2 := public.certificate_create_campaign('Smoke Volunteering', 'volunteering', 'manual_selection', null, tpl, 'ar', 'full');
  perform public.certificate_add_member_recipient(camp2, m_c);
  recx := public.certificate_add_external_recipient(camp2, 'Ext Person', 'Ext@Example.invalid');
  denied := false;
  begin perform public.certificate_add_member_recipient(camp2, m_c); exception when others then denied := sqlerrm like '%certificate_recipient_duplicate%'; end;
  if not denied then raise exception 'FAIL: تكرار عضو في الحملة'; end if;
  denied := false;
  begin perform public.certificate_add_external_recipient(camp2, 'Other Name', 'ext@example.invalid'); exception when others then denied := sqlerrm like '%certificate_recipient_duplicate%'; end;
  if not denied then raise exception 'FAIL: تكرار خارجي بنفس البريد (بغض النظر عن حالة الأحرف)'; end if;

  -- ---------- 4) members_manager: مراجعة محدودة فقط ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_mm, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  select count(*) into n from public.certificate_campaigns;
  if n <> 0 then raise exception 'FAIL: members_manager يقرأ الحملات مباشرة (%)', n; end if;
  select count(*) into n from public.certificate_recipients;
  if n <> 0 then raise exception 'FAIL: members_manager يقرأ المستفيدين مباشرة (%)', n; end if;
  select count(*) into n from public.certificate_email_queue;
  if n <> 0 then raise exception 'FAIL: members_manager يقرأ الطابور مباشرة'; end if;
  got := public.certificate_review_recipients(camp);
  s := got::text;
  if jsonb_array_length(got -> 'recipients') <> 2 then raise exception 'FAIL: مراجعة المستفيدين لا تعيد 2'; end if;
  if s ~* '"email"|"member_id"|"token"|@example\.invalid|queue' then raise exception 'FAIL: تسرّب email/member_id/token/queue في المراجعة: %', s; end if;
  if jsonb_array_length(public.certificate_review_campaigns()) < 2 then raise exception 'FAIL: مراجعة الحملات'; end if;
  denied := false;
  begin perform public.certificate_issue_campaign(camp); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL: members_manager يُصدر شهادات'; end if;
  denied := false;
  begin perform public.certificate_revoke(gen_random_uuid(), null); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL: members_manager يُلغي شهادات'; end if;
  denied := false;
  begin perform public.certificate_enqueue_email(gen_random_uuid()); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL: members_manager يجدول بريدًا'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_edit, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  denied := false;
  begin perform public.certificate_review_campaigns(); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL: editor يستدعي المراجعة'; end if;

  -- ---------- 5) الإصدار والترقيم ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_sec, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  got := public.certificate_issue_campaign(camp);
  if (got ->> 'issued')::int <> 2 then raise exception 'FAIL: عدد الشهادات المُصدَرة %', got; end if;
  got := public.certificate_issue_campaign(camp2);
  if (got ->> 'issued')::int <> 2 then raise exception 'FAIL: إصدار الحملة اليدوية %', got; end if;
  if public.certificate_issue_campaign(camp2) ->> 'issued' <> '0' then raise exception 'FAIL: إعادة الإصدار تكرّر الشهادات'; end if;

  select c.id, c.certificate_number into c_a, n_a from public.certificates c where c.campaign_id = camp and c.recipient_name = 'Ahmed Alaoui';
  select c.id, c.certificate_number into c_b, n_b from public.certificates c where c.campaign_id = camp and c.recipient_name = 'Salma Bennani';
  select c.id, c.certificate_number into c_x, n_x from public.certificates c where c.campaign_id = camp2 and c.recipient_kind = 'external';
  if n_a !~ ('^IAE-' || to_char(now() at time zone 'Africa/Casablanca', 'YYYY') || '-[0-9]{6}$') then raise exception 'FAIL: صيغة الرقم %', n_a; end if;
  select count(distinct certificate_number) into n from public.certificates where campaign_id in (camp, camp2);
  if n <> 4 then raise exception 'FAIL: أرقام مكرّرة'; end if;
  -- تسلسل بلا ثغرات (ضمن هذه المعاملة): الأرقام الأربعة متتالية
  select max(substr(certificate_number, 10)::int) - min(substr(certificate_number, 10)::int) into n from public.certificates where campaign_id in (camp, camp2);
  if n <> 3 then raise exception 'FAIL: الأرقام غير متتالية (الفرق %)', n; end if;

  -- ---------- 6) الرمز والتحقق العام ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  got := public.get_certificate_render_data(c_a);
  tok := got ->> 'token';
  if tok !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'FAIL: صيغة الرمز %', tok; end if;
  if got::text ~* 'email|member_id' then raise exception 'FAIL: render data يسرّب email/member_id'; end if;
  got2 := public.get_my_certificates();
  if jsonb_array_length(got2) <> 1 or got2 -> 0 ->> 'id' <> c_a::text then raise exception 'FAIL: شهاداتي لا تعيد شهادة العضو وحدها'; end if;
  -- عضو آخر لا يصل لشهادة غيره
  perform set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  denied := false;
  begin perform public.get_certificate_render_data(c_a); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL: عضو يقرأ بيانات شهادة غيره'; end if;
  -- anon
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  got := public.verify_certificate(tok);
  if got ->> 'status' <> 'valid' then raise exception 'FAIL: التحقق العام لشهادة صالحة: %', got; end if;
  if got ->> 'holder_name' <> 'A**** A*****' then raise exception 'FAIL: الاسم المقنّع %', got ->> 'holder_name'; end if;
  if got::text ~* 'Ahmed|Alaoui|@|member|email' then raise exception 'FAIL: تسرّب في التحقق العام: %', got; end if;
  if public.verify_certificate('short') ->> 'status' <> 'not_found' or public.verify_certificate(repeat('A', 43)) ->> 'status' <> 'not_found'
     or public.verify_certificate(null) ->> 'status' <> 'not_found' then raise exception 'FAIL: رمز غير صالح لا يعيد not_found'; end if;
  denied := false;
  begin perform 1 from public.certificates; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL: anon يقرأ الشهادات'; end if;
  denied := false;
  begin perform public.get_my_certificates(); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL: anon يستدعي get_my_certificates'; end if;
  reset role;

  -- لا رمز خام مخزَّن؛ المخزَّن = sha256 للرمز
  select count(*) into n from public.certificates where token_hash = tok or certificate_number = tok;
  if n <> 0 then raise exception 'FAIL: الرمز الخام مخزَّن'; end if;
  select count(*) into n from public.certificates where id = c_a and token_hash = public.certificate_token_hash(tok);
  if n <> 1 then raise exception 'FAIL: token_hash ≠ sha256(token)'; end if;

  -- ---------- 7) خصوصية الاسم: تضييق فقط ----------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sec, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  -- الحملة اليدوية كانت full: الخارجي يظهر اسمه كاملًا
  perform set_config('request.jwt.claims', json_build_object('sub', u_sec, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  denied := false;
  begin perform public.certificate_set_public_name_mode(c_a, 'full'); exception when others then denied := sqlerrm like '%certificate_name_mode_widening_forbidden%'; end;
  if not denied then raise exception 'FAIL: توسيع ظهور الاسم مسموح'; end if;
  perform public.certificate_set_public_name_mode(c_a, 'none');
  denied := false;
  begin perform public.certificate_set_public_name_mode(c_a, 'masked'); exception when others then denied := sqlerrm like '%certificate_name_mode_widening_forbidden%'; end;
  if not denied then raise exception 'FAIL: العودة من none إلى masked مسموحة'; end if;
  reset role;
  if (public.verify_certificate(tok) ->> 'holder_name') is not null then raise exception 'FAIL: none ما زال يعرض اسمًا'; end if;
  denied := false;
  begin update public.certificates set public_name_mode = 'full' where id = c_a; exception when others then denied := sqlerrm like '%certificate_name_mode_widening_forbidden%'; end;
  if not denied then raise exception 'FAIL: المشغّل لا يمنع توسيع الاسم'; end if;

  -- ---------- 8) تدوير السرّ: المطوّر وحده + أثره ----------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_super, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  denied := false;
  begin perform public.certificate_rotate_token_secret(); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL: super_admin يدوّر السرّ'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sec, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  denied := false;
  begin perform public.certificate_rotate_token_secret(); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL: secretary_general يدوّر السرّ'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_dev, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  tok_old := tok;
  got := public.certificate_rotate_token_secret();
  if (got ->> 'rehashed')::int < 4 or (got ->> 'generation')::int < 2 then raise exception 'FAIL: نتيجة التدوير %', got; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  tok_new := public.get_certificate_render_data(c_a) ->> 'token';
  if tok_new = tok_old then raise exception 'FAIL: الرمز لم يتغيّر بعد التدوير'; end if;
  reset role;
  if public.verify_certificate(tok_old) ->> 'status' <> 'not_found' then raise exception 'FAIL: رمز ما قبل التدوير ما زال يعمل'; end if;
  if public.verify_certificate(tok_new) ->> 'status' <> 'valid' then raise exception 'FAIL: الرمز الجديد لا يتحقق'; end if;
  tok := tok_new;
  -- تعديل الرمز مباشرة ممنوع خارج الدوال الداخلية
  denied := false;
  begin update public.certificates set token_hash = repeat('0', 64) where id = c_a; exception when others then denied := sqlerrm like '%certificate_token_immutable%'; end;
  if not denied then raise exception 'FAIL: تعديل token_hash مباشرة مسموح'; end if;

  -- ---------- 9) الطابور والإلغاء ----------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sec, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  denied := false;
  begin perform public.certificate_enqueue_email(c_b); exception when others then denied := sqlerrm like '%certificate_no_email%'; end;   -- Salma بلا بريد
  if not denied then raise exception 'FAIL: جدولة بريد لشهادة بلا بريد'; end if;
  qid := public.certificate_enqueue_email(c_a);
  denied := false;
  begin perform public.certificate_enqueue_email(c_a); exception when others then denied := sqlerrm like '%certificate_email_already_queued%'; end;
  if not denied then raise exception 'FAIL: مهمتان نشطتان لنفس الشهادة'; end if;
  -- إلغاء: المهمة المنتظرة تُلغى، والجدولة/المحاولة بعد الإلغاء ترفض
  perform public.certificate_revoke(c_a, 'smoke test');
  reset role;
  select status into s from public.certificate_email_queue where id = qid;
  if s <> 'cancelled' then raise exception 'FAIL: مهمة الشهادة الملغاة لم تُلغَ (%)', s; end if;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sec, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  denied := false;
  begin perform public.certificate_enqueue_email(c_a); exception when others then denied := sqlerrm like '%certificate_revoked%'; end;
  if not denied then raise exception 'FAIL: جدولة بريد لشهادة ملغاة'; end if;
  if public.certificate_revoke(c_a, null) ->> 'already_revoked' <> 'true' then raise exception 'FAIL: الإلغاء غير idempotent'; end if;
  denied := false;
  begin perform public.get_certificate_render_data(c_a); exception when others then denied := sqlerrm like '%certificate_revoked%'; end;
  if not denied then raise exception 'FAIL: render لشهادة ملغاة'; end if;   -- لا يُولَّد PDF لملغاة
  reset role;
  if public.verify_certificate(tok) ->> 'status' <> 'revoked' or (public.verify_certificate(tok)::text ~* 'Ahmed|holder_name') then
    raise exception 'FAIL: التحقق لشهادة ملغاة يجب أن يعيد revoked بلا اسم'; end if;
  denied := false;
  begin update public.certificates set status = 'valid', revoked_at = null where id = c_a; exception when others then denied := sqlerrm like '%certificate_revoked_is_final%'; end;
  if not denied then raise exception 'FAIL: يمكن التراجع عن الإلغاء'; end if;

  -- سباق: شهادة c_x (خارجية بالبريد) — claim ثم إلغاء أثناء الإرسال
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sec, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  qid2 := public.certificate_enqueue_email(c_x);
  reset role;
  got := public.certificate_email_claim_next('smoke_worker');
  if got is null or got ->> 'certificate_id' <> c_x::text then raise exception 'FAIL: claim لا يعيد المهمة المنتظرة'; end if;
  if not public.certificate_email_recheck(qid2, got ->> 'token') then raise exception 'FAIL: recheck false لرمز claim الحالي'; end if;
  if public.certificate_email_claim_next('smoke_worker') is not null then raise exception 'FAIL: claim ثانٍ أعاد مهمة (يجب لا شيء)'; end if;

  -- إعادة إصدار الرمز بعد claim يجب أن تمنع العامل من إرسال الرابط القديم.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_super, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform public.certificate_reissue_token(c_x);
  reset role;
  if public.certificate_email_recheck(qid2, got ->> 'token') then raise exception 'FAIL: recheck قبل رمزًا قديماً بعد reissue'; end if;

  -- تدوير السرّ يبطل أيضًا الرمز الذي حمله العامل قبل التدوير.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_dev, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform public.certificate_rotate_token_secret();
  reset role;
  if public.certificate_email_recheck(qid2, got ->> 'token') then raise exception 'FAIL: recheck قبل رمزاً قديماً بعد rotation'; end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sec, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  got2 := public.certificate_revoke(c_x, null);
  if (got2 ->> 'email_was_sending') <> 'true' then raise exception 'FAIL: الإلغاء أثناء الإرسال لم يُوثَّق'; end if;
  reset role;
  if public.certificate_email_recheck(qid2, got ->> 'token') then raise exception 'FAIL: recheck true بعد الإلغاء'; end if;
  select count(*) into n from public.certificate_email_logs where queue_id = qid2 and event = 'revoked_during_send';
  if n < 1 then raise exception 'FAIL: لا حدث revoked_during_send'; end if;
  if public.certificate_email_complete(qid2, false, 'smtp_timeout') <> 'cancelled' then raise exception 'FAIL: فشل بعد الإلغاء لا يُلغى'; end if;

  -- claim يلغي مهمة منتظرة لشهادة صارت ملغاة (محاكاة التسلسل: إلغاء بلا مرور على الطابور)
  -- شهادة جديدة لاختبار الإرسال الناجح والفشل وإعادة المحاولة
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sec, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform public.certificate_add_member_recipient(camp2, m_a);   -- camp2 صارت issued: يُسمح بإضافة وإصدار إضافي
  perform public.certificate_issue_campaign(camp2);
  reset role;
  select id into c_x from public.certificates where campaign_id = camp2 and member_id = m_a;
  if c_x is null then raise exception 'FAIL: الإصدار الإضافي لم ينتج شهادة'; end if;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sec, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  qid := public.certificate_enqueue_email(c_x);
  reset role;
  update public.certificate_email_queue set max_attempts = 1 where id = qid;
  got := public.certificate_email_claim_next('smoke_worker');
  if got ->> 'queue_id' <> qid::text then raise exception 'FAIL: claim لمهمة الفشل'; end if;
  if public.certificate_email_complete(qid, false, 'smtp_timeout') <> 'failed' then raise exception 'FAIL: لم تصل المهمة إلى failed بعد استنفاد المحاولات'; end if;
  if exists (select 1 from public.certificate_email_logs where error_code ~ '[^a-z0-9_]') then raise exception 'FAIL: رمز خطأ غير مطابق للنمط'; end if;
  -- retry ثم إلغاء ثم retry مرفوض
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sec, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform public.certificate_retry_email(qid);
  reset role;
  got := public.certificate_email_claim_next('smoke_worker');
  if public.certificate_email_complete(qid, true, null) <> 'sent' then raise exception 'FAIL: الإرسال الناجح'; end if;
  select status into s from public.certificate_email_queue where id = qid;
  if s <> 'sent' then raise exception 'FAIL: حالة sent (%)', s; end if;
  -- مهمة فاشلة ثم إلغاء الشهادة ثم retry
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sec, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  qid := public.certificate_enqueue_email(c_x);   -- إعادة إرسال صريحة بعد sent مسموحة
  reset role;
  update public.certificate_email_queue set max_attempts = 1 where id = qid;
  got := public.certificate_email_claim_next('smoke_worker');
  perform public.certificate_email_complete(qid, false, 'provider_error');
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sec, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform public.certificate_revoke(c_x, null);
  denied := false;
  begin perform public.certificate_retry_email(qid); exception when others then denied := sqlerrm like '%certificate_revoked%'; end;
  if not denied then raise exception 'FAIL: retry لشهادة ملغاة'; end if;
  reset role;
  -- stale: لا شيء قديم عالق
  n := public.certificate_email_release_stale(15);
  if n <> 0 then raise exception 'FAIL: release_stale حرّر مهمة حديثة'; end if;
  -- عامل لا يستدعيه authenticated
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_dev, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  denied := false;
  begin perform public.certificate_email_claim_next('x'); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL: authenticated يستدعي claim'; end if;
  reset role;

  -- ---------- 10) حذف العضو: الشهادة تبقى، لا نقل ملكية ----------
  select certificate_number into n_b from public.certificates where id = c_b;
  delete from public.members where id = m_b;
  select count(*) into n from public.certificates where id = c_b and member_id is null and recipient_name = 'Salma Bennani';
  if n <> 1 then raise exception 'FAIL: الشهادة لم تبقَ بعد حذف العضو أو لم يُصفَّر member_id'; end if;
  select count(*) into n from public.certificate_recipients where certificate_id = c_b and member_id is null and display_name = 'Salma Bennani';
  if n <> 1 then raise exception 'FAIL: snapshot المستفيد لم يبقَ'; end if;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  denied := false;
  begin perform public.get_my_certificates(); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL: حساب عضو محذوف ما زال يصل لشهاداته (fail-closed)'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  select count(*) into n from jsonb_array_elements(public.get_my_certificates()) e where e ->> 'id' = c_b::text;
  if n <> 0 then raise exception 'FAIL: عضو آخر يسترجع شهادة عضو محذوف'; end if;
  denied := false;
  begin perform public.get_certificate_render_data(c_b); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL: render لشهادة عضو محذوف من عضو آخر'; end if;
  reset role;
  -- ما زالت قابلة للتحقق العام (قناة المدير)
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sec, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  tok := public.get_certificate_render_data(c_b) ->> 'token';
  reset role;
  if public.verify_certificate(tok) ->> 'status' <> 'valid' then raise exception 'FAIL: شهادة عضو محذوف لم تعد قابلة للتحقق'; end if;

  -- ---------- 11) الأرشفة ----------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sec, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform public.certificate_archive_campaign(camp);
  denied := false;
  begin perform public.certificate_add_attendance_recipients(camp); exception when others then denied := sqlerrm like '%certificate_campaign_archived%'; end;
  if not denied then raise exception 'FAIL: حملة مؤرشفة تقبل مستفيدين'; end if;
  denied := false;
  begin perform public.certificate_issue_campaign(camp); exception when others then denied := sqlerrm like '%certificate_campaign_archived%'; end;
  if not denied then raise exception 'FAIL: حملة مؤرشفة تُصدر'; end if;
  perform public.certificate_archive_campaign(camp2);
  denied := false;
  begin perform public.certificate_add_member_recipient(camp2, m_a); exception when others then denied := sqlerrm like '%certificate_campaign_archived%'; end;
  if not denied then raise exception 'FAIL: حملة مؤرشفة تقبل مستفيدًا'; end if;
  -- الإلغاء وإعادة إرسال البريد لشهادة صالحة في حملة مؤرشفة مسموحان
  select id into c_y from public.certificates where campaign_id = camp2 and member_id = m_c;
  if c_y is null then raise exception 'FAIL: شهادة العضو الثالث غير موجودة'; end if;
  qid := public.certificate_enqueue_email(c_y);
  if qid is null then raise exception 'FAIL: جدولة بريد لشهادة صالحة في حملة مؤرشفة'; end if;
  tok := public.get_certificate_render_data(c_y) ->> 'token';
  reset role;
  if public.verify_certificate(tok) ->> 'status' <> 'valid' then raise exception 'FAIL: شهادة في حملة مؤرشفة لم تعد قابلة للتحقق'; end if;
  -- الإلغاء في حملة مؤرشفة مسموح ويُلغي المهمة المنتظرة
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sec, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform public.certificate_revoke(c_y, null);
  reset role;
  if public.verify_certificate(tok) ->> 'status' <> 'revoked' then raise exception 'FAIL: إلغاء شهادة مؤرشفة'; end if;
  select status into s from public.certificate_email_queue where id = qid;
  if s <> 'cancelled' then raise exception 'FAIL: مهمة بريد شهادة مؤرشفة ملغاة لم تُلغَ (%)', s; end if;
end $$;

-- ---------- المرحلة الثانية: الثبات، الأرشفة، audit (بصلاحية المالك) ----------
do $$
declare
  c uuid; n int; denied boolean; s text;
begin
  reset role;
  -- أرشفة وحذف/تعديل ممنوعان
  select id into c from public.certificates order by created_at limit 1;
  denied := false;
  begin delete from public.certificates where id = c; exception when others then denied := sqlerrm like '%certificate_delete_forbidden%'; end;
  if not denied then raise exception 'FAIL: حذف شهادة مسموح'; end if;
  denied := false;
  begin update public.certificates set recipient_name = 'Changed' where id = c; exception when others then denied := sqlerrm like '%certificate_snapshot_immutable%'; end;
  if not denied then raise exception 'FAIL: تعديل snapshot الاسم مسموح'; end if;
  denied := false;
  begin delete from public.certificate_campaigns; exception when others then denied := sqlerrm like '%certificate_campaign_delete_forbidden%'; end;
  if not denied then raise exception 'FAIL: حذف حملة مسموح'; end if;
  denied := false;
  begin update public.certificate_email_logs set attempt = 99; exception when others then denied := sqlerrm like '%certificate_email_logs_append_only%'; end;
  if not denied then raise exception 'FAIL: تعديل سجل البريد مسموح'; end if;
  denied := false;
  begin update public.certificate_campaigns set status = 'draft' where status = 'archived'; exception when others then denied := sqlerrm like '%certificate_campaign_invalid_transition%'; end;
  if not denied then raise exception 'FAIL: رجوع حملة مؤرشفة إلى draft'; end if;
  denied := false;
  begin update public.certificate_campaigns set eligibility_source = 'registration_based'; exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: تحويل حملة إلى registration_based'; end if;

  -- audit: الأحداث موجودة بلا PII
  select count(*) into n from public.audit_logs where action in ('certificate_campaign_created', 'certificate_campaign_issued', 'certificate_revoked',
    'certificate_campaign_archived', 'certificate_privacy_changed', 'certificate_secret_rotated', 'certificate_email_enqueued', 'certificate_email_sent')
    and created_at >= now() - interval '1 hour';
  if n < 8 then raise exception 'FAIL: أحداث audit ناقصة (%)', n; end if;
  select count(*) into n from public.audit_logs
   where action like 'certificate\_%' and created_at >= now() - interval '1 hour'
     and (coalesce(metadata::text, '') ~* '@|ahmed|salma|youssef|alaoui|bennani|tazi|token|secret' or coalesce(description, '') ~* '@|ahmed|salma|alaoui');
  if n <> 0 then raise exception 'FAIL: PII/أسرار في audit_logs (% صف)', n; end if;
  -- audit_logs يبقى غير قابل للتعديل
  denied := false;
  begin update public.audit_logs set description = 'x' where action = 'certificate_revoked'; exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: audit_logs قابل للتعديل'; end if;

  raise notice 'OK: certificates_smoke — كل الفحوص نجحت (سيُلغى كل شيء بـ rollback)';
end $$;

rollback;
