-- ============================================================
-- 05_token_security.sql — Phase 4: الرموز (Tokens)
-- هذا الملف لا يغيّر أي بيانات أو دوال أو صلاحيات. السبب أن الفحص لم يُثبت ثغرة في الرموز قابلة للإصلاح بـ SQL دون كسر
-- الروابط الحالية أو سلوك الواجهة (التفاصيل الكاملة في 00_security_audit.md §4). ما يفعله: تأكيدات (assertions) تفشل بصوت
-- عالٍ إن وُجد ما يخالف القواعد التالية في البيانات الفعلية، وتطبع ملخصًا. شغّله للمراجعة فقط؛ لا حاجة لـ COMMIT.
--
-- خلاصة الفحص من الكود:
--   الرمز                    | التوليد                                   | التخزين                 | الصلاحية              | مرة واحدة            | حدّ المحاولات
--   نموذج الانخراط (0014)    | 2×gen_random_uuid (≈244 بت)               | sha256 فقط              | 7 أيام، إعادة الإصدار تُبطل | نعم (submitted_at)  | عشوائية الرمز + حدّ الطلب الأولي (0022/0026)
--   تفعيل حساب العضو (0036/37)| 2×gen_random_uuid (≈244 بت)              | sha256 فقط              | 7 أيام                | نعم (used_at)         | 8/10د لكل IP في القاعدة (0038) + تأكيد البريد 10 محاولات (0048)
--   رابط عضو المكتب (0031)   | 2×gen_random_uuid (≈244 بت)               | sha256 فقط              | 14 يومًا              | حتى الاعتماد (approved) | عشوائية الرمز
--   الدعوات (0051)           | 2×gen_random_uuid (≈244 بت)               | نص خام (يحتاجه المسؤول لنسخ الرابط) | لا انتهاء؛ إلغاء يدوي revoked_at | لا (RSVP قابل للتغيير) | عشوائية الرمز
--   بطاقة العضو QR (0040/42) | مشتق من سرّ الخادم + عضو + epoch (128 بت)  | sha256 فقط              | دائم حتى «رمز جديد» (5/ساعة) | لا (مقصود)          | 30/10د لكل IP عند التحقق
--   ملاحظة: gen_random_uuid() يستعمل مولّدًا آمنًا تشفيريًا (122 بتًا عشوائيًا لكل UUID).
--
-- لماذا لا إصلاح SQL هنا:
--   * الدعوات: الرمز الخام ضروري لوظيفة «نسخ الرابط» (get_activity_invitations تُرجعه للمسؤول)، فالتجزئة تكسر الميزة.
--     إضافة انتهاء صلاحية تتطلب قرارًا (كم بعد موعد الحفل؟) وتعديل get_invitation/respond_invitation؛ وفرضه الآن يُبطل روابط
--     الضيوف الحالية دون خطة انتقالية. مُوصى به في التقرير كقرار إداري، لا يُنفَّذ تلقائيًا.
--   * بطاقة العضو الدائمة: قرار تصميمي موثّق (0042) والعضو يملك زر «رمز جديد».
-- ============================================================
begin;

do $$
declare
  n bigint;
begin
  -- 1) كل token_hash هو sha256 hex (64 خانة). وجود قيمة بغير هذا الشكل يعني رمزًا خامًا أو بيانات شاذة.
  select count(*) into n from public.membership_forms where token_hash !~ '^[0-9a-f]{64}$';
  if n > 0 then raise exception 'FAIL: membership_forms فيها % token_hash بشكل غير متوقع', n; end if;

  select count(*) into n from public.board_profile_links where token_hash !~ '^[0-9a-f]{64}$';
  if n > 0 then raise exception 'FAIL: board_profile_links فيها % token_hash بشكل غير متوقع', n; end if;

  select count(*) into n from public.member_activation_links where token_hash !~ '^[0-9a-f]{64}$';
  if n > 0 then raise exception 'FAIL: member_activation_links فيها % token_hash بشكل غير متوقع', n; end if;

  select count(*) into n from public.member_card_tokens where token_hash !~ '^[0-9a-f]{64}$';
  if n > 0 then raise exception 'FAIL: member_card_tokens فيها % token_hash بشكل غير متوقع', n; end if;

  -- 2) رموز الدعوات بالشكل الذي تتوقعه get_invitation (64 خانة سداسية) وإلا لا تعمل أصلًا
  select count(*) into n from public.activity_invitations where token !~ '^[0-9a-f]{64}$';
  if n > 0 then raise exception 'FAIL: activity_invitations فيها % رمز بشكل لا تقبله get_invitation', n; end if;

  -- 3) الجداول المغلقة لا تُمنح لأدوار العميل
  select count(*) into n
    from information_schema.role_table_grants g
   where g.table_schema = 'public'
     and g.table_name in ('member_card_tokens','member_card_secret','member_card_epoch','member_activation_links',
                          'membership_throttle_secret','membership_request_throttle','member_activation_throttle',
                          'attendance_secret','activity_invitations','activity_invitation_settings')
     and g.grantee in ('anon','authenticated');
  if n > 0 then raise exception 'FAIL: جداول رموز/أسرار عليها صلاحيات لـ anon/authenticated (% منحة)', n; end if;

  raise notice 'token checks: كل الفحوص نجحت ✔';
end $$;

-- ملخص حالة الروابط (أعداد فقط، بلا أي رمز أو بيانات شخصية)
select 'membership_forms' as tbl, count(*) as total,
       count(*) filter (where submitted_at is not null) as used,
       count(*) filter (where submitted_at is null and expires_at < now()) as expired_unused
  from public.membership_forms
union all
select 'board_profile_links', count(*), count(*) filter (where status = 'approved'),
       count(*) filter (where status <> 'approved' and expires_at < now())
  from public.board_profile_links
union all
select 'member_activation_links', count(*), count(*) filter (where used_at is not null),
       count(*) filter (where used_at is null and expires_at < now())
  from public.member_activation_links
union all
select 'activity_invitations', count(*), count(*) filter (where revoked_at is not null), 0
  from public.activity_invitations;

rollback;  -- للقراءة فقط
