# PHASE_1_HANDOFF — نظام الشهادات (قاعدة البيانات)

آخر تحديث: 2026-11-26. هذا الملف كافٍ لنقل العمل إلى حساب Claude آخر دون إعادة الشرح.

## 0. الحالة بدقة (لا تخلط بينها)

| المستوى | الحالة |
|---|---|
| 1. ملفات أُنشئت | ✅ نعم (القائمة في §2) |
| 2. اختبارات static (Node) | ✅ `tests/certificates-sql.test.js` — راجع §5 للنتيجة الفعلية |
| 3. SQL نُفّذ فعليًا على PostgreSQL/Supabase | ❌ **لا** — لا PostgreSQL في بيئة الإنشاء ولا اتصال بالقاعدة الحية (بحسب التعليمات) |
| 4. `supabase/tests/certificates_smoke.sql` شُغّل | ❌ **لا** — كُتب فقط ولم يُجرَّب؛ قد يحتاج إصلاحات بسيطة عند أول تشغيل |
| 5. اختبار يدوي للتزامن/الواجهة | ❌ لم يُجرَ |

⚠️ لذلك: لا يُعتبر الـ SQL «مختبرًا» قبل المرور بـ §6 (تجربة جافة ثم smoke على بيئة تجريبية).

## 1. القرارات المنفّذة (ملخّص)

- المشروع: React18 + Vite5 + Supabase + Netlify. آخر migration قبل المرحلة `0062`؛ أُضيفت `0063` و`0064` و`0065`. rollback في `supabase/rollback/` بصيغة `NNNN_name_down.sql` (convention المشروع).
- 8 جداول: templates, campaigns, certificates, recipients, email_queue, email_logs, token_secret (مغلق), number_counters (مغلق).
- صلاحيات: `can_admin_certificates` (developer, super_admin) · `can_manage_certificates` (+secretary_general) · `can_review_certificate_recipients` (+members_manager، عبر RPC محدودة فقط) · تدوير السرّ للمطوّر وحده.
- الرمز: HMAC-SHA256 (pgcrypto، المخطط مكتشف) → Base64URL (43 حرفًا)؛ المخزَّن sha256 فقط؛ التدوير يعيد اشتقاق كل الهاشات في معاملة واحدة (يُبطل QR القديم).
- الملكية: `member_id ON DELETE SET NULL` + snapshots؛ `get_my_certificates` fail-closed عبر `current_member_id()`.
- التحقق العام `verify_certificate`: valid/revoked/not_found؛ الاسم none/masked/full (افتراضي masked، تضييق فقط، الملغاة بلا اسم).
- الإلغاء/البريد: قفل الشهادة ثم الطابور، SKIP LOCKED، رفض الملغاة في enqueue/retry/claim، توثيق `revoked_during_send`، **بلا ادعاء منع مطلق** بعد وصول HTTP للمزوّد.
- الترقيم: عدّاد جدول داخل معاملة الإصدار (لا sequence)؛ gap-free «في التشغيل العادي» فقط (انظر docs).
- `registration_based`: مقبول في CHECK لكن **معطّل بمشغّل**. لا استخدام لـ invitations/RSVP.
- Audit: عبر `audit_logs` القائم بلا أي تعديل، بلا PII (المساعد يرفض مفاتيح حساسة).
- لا تخزين PDF، لا مفاتيح بريد في الملفات، لا شيء في الواجهة (`src/`) تغيّر.

## 2. الملفات

أُنشئت (لا ملف قائم عُدّل أو حُذف):
- `supabase/migrations/0063_certificates_schema.sql`
- `supabase/migrations/0064_certificates_admin_functions.sql`
- `supabase/migrations/0065_certificates_email_queue.sql`
- `supabase/rollback/0063_certificates_schema_down.sql`, `0064_certificates_admin_functions_down.sql`, `0065_certificates_email_queue_down.sql`
- `supabase/tests/certificates_smoke.sql`
- `tests/certificates-sql.test.js`
- `docs/CERTIFICATES_DB.md`
- `PHASE_1_HANDOFF.md`

## 3. الكائنات المضافة

- جداول: الثمانية أعلاه. دوال صلاحيات: 3. مساعدات داخلية بلا منح: `certificate_hmac`, `certificate_random_bytes`, `certificate_audit`, `certificate_token_for`, `certificate_token_hash`, `certificate_next_number`, `certificate_mask_name`. مشغّلات حماية: 5 (campaigns, certificates, recipients, email_queue, email_logs) + `set_updated_at` على 4 جداول.
- سياسات RLS: 6 (SELECT فقط، كلها `can_manage_certificates()`). منح أعمدة `certificates` بدون `token_hash`.
- RPCs: القائمة الكاملة في `docs/CERTIFICATES_DB.md` §10.

## 4. قرارات/مخاطر تحتاج انتباهك

1. **لم يُنفَّذ شيء على Postgres**: أخطاء صياغة محتملة. الحل: §6.
2. **PostgREST `select=*` على `certificates` سيفشل** (عمود `token_hash` محجوب بمنح الأعمدة). الواجهة يجب أن تسرد الأعمدة صراحةً (كما تفعل مع `members`).
3. **التدوير يُبطل كل QR/رابط سابق** (موثّق). نفّذه فقط عند اشتباه تسرّب.
4. **`revoke_reason` نص حرّ** يُخزَّن في `certificates` (يراه manage فقط ولا يُنسخ إلى audit). أخبر المستخدمين ألّا يضعوا بيانات شخصية فيه.
5. **عدم ضمان منع البريد بعد الإلغاء** إن وصل الطلب للمزوّد (حدّ بنيوي، موثّق).
6. **الترقيم**: إصدار جماعي يحتجز صف العدّاد أثناء معاملته (مقبول بالحجم الحالي).
7. `service_role` يملك EXECUTE افتراضيًا على الدوال الجديدة (سلوك Supabase)؛ لا يُستعمل في الواجهة أبدًا.
8. migration 0065 تتطلب وجود الدور `service_role` (بيئة Supabase)؛ ستفشل برسالة واضحة محليًا بدونه.
9. حملة `attendance_based` تُنشئ المستفيدين بـ snapshot وقت **الإضافة** لا وقت الإصدار؛ أعد استدعاء `certificate_add_attendance_recipients` قبل الإصدار إن أُضيف حضور لاحقًا (لا يكرّر).
10. لم تُضف `jszip` لـ package.json (المرحلة 2). الموجود: `jspdf`, `html2canvas`.

## 5. نتائج الاختبارات الفعلية

- `node --test tests/certificates-sql.test.js`: **21/21 ناجحة** (static فقط).
- `node --test` الكامل: 422 اختبارًا، 419 ناجحًا، 3 فاشلة. **الثلاثة نفسها تفشل في ZIP الأصلي دون أي تعديل** (قبل: 401 اختبارًا و3 فاشلة): `.gitignore` مفقود من الـZIP (اختبارا «الملفات الأساسية») و`tests/sanitize.test.js` (`dompurify` غير مثبّت). لا علاقة لها بالشهادات.
- لم يمكن تشغيل: `npm run lint` و`npm run build` (لا `node_modules` ولا شبكة)، `certificates_smoke.sql` (يحتاج Postgres/Supabase تجريبية)، اختبارات التزامن (جلستان).

## 6. تعليمات التطبيق على Supabase (بيئة تجريبية أولًا)

1. تأكد أن 0001–0062 مطبّقة، وأن `pgcrypto` مثبّت (`select extname from pg_extension where extname='pgcrypto'`).
2. لكل ملف بالترتيب **0063 → 0064 → 0065**: **تجربة جافة** باستبدال `commit;` الأخيرة بـ `rollback;` في SQL Editor، ثم إن لم تظهر أخطاء أعدها إلى `commit;` ونفّذ.
3. شغّل `supabase/tests/certificates_smoke.sql` كاملًا (بيئة تجريبية). النجاح = `NOTICE: OK: certificates_smoke…`. أي `FAIL:` أرسله لـ Claude لإصلاحه.
4. الإنتاج: كرّر 2 فقط بعد نجاح 3. الرجوع (عند الحاجة، بالعكس): `0065_down` ثم `0064_down` ثم `0063_down` (ترفض تلقائيًا إن وُجدت بيانات).

## 7. ما يُختبر يدويًا بعد التطبيق

- تسجيل الدخول بكل دور (developer, super_admin, secretary_general, members_manager, editor) واستدعاء RPC المناسبة؛ تأكد أن members_manager لا يرى email/token وأن editor مرفوض.
- حملة attendance_based من نشاط فيه حضور فعلي، إصدار، تحقق عبر `verify_certificate` كـ anon (من SQL أو REST `/rpc/verify_certificate`).
- حذف عضو تجريبي له شهادة: تبقى الشهادة ويبقى التحقق.
- تدوير السرّ (developer) ثم التأكد أن رمزًا قديمًا صار `not_found` والجديد `valid`.
- جلستان لسيناريوهات التزامن في `docs/CERTIFICATES_DB.md` §11.

## 8. المتبقي (لا تبدأه قبل اعتماد المرحلة 1)

- Phase 2: واجهة الإدارة (حملات/مستفيدون/مراجعة)، صفحة `/verify-certificate/:token` (تستدعي `verify_certificate`)، عرض «شهاداتي» في حساب العضو، Hybrid Designer، توليد PDF client-side (jsPDF/html2canvas الموجودان) وZIP (`jszip` يُضاف حينها) وQR.
- Phase 3: Edge Function عامل البريد (claim → recheck → إرسال بمزوّد → complete)، قالب البريد برابط آمن لا مرفق، جدولة release_stale.
- i18n لرسائل الأخطاء (الرموز الثابتة مثل `certificate_revoked`, `certificate_recipient_duplicate`…).
