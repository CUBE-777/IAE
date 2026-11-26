# نظام الشهادات — قاعدة البيانات (المرحلة 1)

> الحالة: **ملفات أُنشئت واختبارات static فقط.** لم يُنفَّذ أي SQL على Supabase، ولم تُشغَّل `certificates_smoke.sql` (لا PostgreSQL في بيئة الإنشاء).
> الملفات: `supabase/migrations/0063…0065`، `supabase/rollback/0063…0065_*_down.sql`، `supabase/tests/certificates_smoke.sql`، `tests/certificates-sql.test.js`.
> آخر migration قبل المرحلة: `0062_games_maintenance_mode.sql`؛ بعدها: `0065_certificates_email_queue.sql`.

## 1. الجداول

| الجدول | الدور | وصول العميل |
|---|---|---|
| `certificate_templates` | 4 قوالب نظامية (academic/modern/premium/technology) + مخصّصة | SELECT لـ `can_manage_certificates()` |
| `certificate_campaigns` | الحملة (draft → issued → archived) | SELECT لـ manage |
| `certificates` | الشهادة + snapshots الاسم/البريد + `token_hash` | SELECT لـ manage، **بلا عمود `token_hash`** |
| `certificate_recipients` | المستفيدون + snapshots + مصدر الأهلية | SELECT لـ manage |
| `certificate_email_queue` | طابور البريد (مستقل عن حالة الشهادة) | SELECT لـ manage |
| `certificate_email_logs` | سجل أحداث البريد (إلحاق فقط، رموز بلا PII) | SELECT لـ manage |
| `certificate_token_secret` | سرّ HMAC (32 بايت) | **لا شيء لأي دور** |
| `certificate_number_counters` | عدّاد الأرقام لكل سنة | **لا شيء لأي دور** |

كل الكتابة عبر دوال `SECURITY DEFINER` فقط؛ لا INSERT/UPDATE/DELETE مباشر. Supabase يمنح الصلاحيات تلقائيًا للجداول الجديدة، لذا تُسحب صراحةً في 0063 قبل أي منح.

## 2. الصلاحيات (التسلسل `developer > super_admin` محفوظ)

| الدالة | الأدوار |
|---|---|
| `can_admin_certificates()` | developer, super_admin |
| `can_manage_certificates()` | developer, super_admin, secretary_general |
| `can_review_certificate_recipients()` | الأدوار السابقة + members_manager |
| تدوير السرّ | **developer فقط** (فحص `current_admin_role() = 'developer'` داخل الدالة) |

مبنية على `current_admin_role()` فيُفرض MFA كباقي النظام. لا أدوار جديدة، ولا تعديل على أي `can_*` قائمة.

**members_manager**: لا SELECT فعّال على أي جدول (RLS تُرجع صفرًا)، ويستعمل فقط `certificate_review_campaigns()` و`certificate_review_recipients(campaign_id)`. لا تُعيدان email ولا member_id ولا token ولا الطابور (تعيدان `has_email` منطقيًا فقط). الحملات المؤرشفة مخفية عنه.

## 3. الرمز (Token) — HMAC-SHA256

```
token      = Base64URL( HMAC-SHA256( secret, 'iae-cert:v1:' || certificate_id || ':' || token_epoch ) )   -- 43 حرفًا
token_hash = hex( sha256( token ) )                                                                         -- هو المخزَّن
```
- `HMAC` و`gen_random_bytes` من `pgcrypto`؛ مخطط الامتداد **يُكتشف** في 0063 ويُبنى به غلاف مؤهَّل (`certificate_hmac`, `certificate_random_bytes`). إن غاب `pgcrypto` يفشل الـ migration برسالة صريحة (لا بديل مخصّص).
- الرمز الخام لا يُخزَّن ولا يُسجَّل. يُشتقّ عند الطلب لمن له حق (`get_certificate_render_data`, `get_my_certificates`) أو لعامل البريد.
- **التحقق** يعتمد على `token_hash` فقط؛ السرّ لازم فقط لإعادة اشتقاق الرمز للعرض/QR/البريد.
- **أثر التدوير** (`certificate_rotate_token_secret`): في معاملة واحدة تحت `FOR UPDATE` على صف السرّ يُولَّد سرّ جديد وتُعاد اشتقاق `token_hash` لكل الشهادات (صالحة وملغاة). النتيجة: **كل QR/رابط طُبع أو أُرسل قبل التدوير يتوقف (not_found)**؛ الشهادات نفسها تبقى صالحة وتحصل على رمز جديد عبر RPC. يُنصح بالتدوير فقط عند اشتباه بتسرّب السرّ، وبعده يُعاد توليد/إرسال الـ QR.
- **إعادة إصدار شهادة واحدة**: `certificate_reissue_token` (admin) يزيد `token_epoch` فيُبطل رمزها القديم وحده.
- **النسخ الاحتياطي**: السرّ وجدول الشهادات في نفس قاعدة البيانات، فالاستعادة من نسخة واحدة متسقة. لا تستعد جدول السرّ وحده من نسخة أقدم، ولا تصدّره خارج النسخ المحمية. فقدان السرّ لا يكسر التحقق (hash فقط) لكنه يمنع إعادة اشتقاق الرموز.
- الحارس `certificates_guard` يمنع تعديل `token_hash/token_epoch` إلا داخل دالتي التدوير/إعادة الإصدار (عبر `set_config('iae.certificate_internal', …, true)` محلي للمعاملة).
- ملاحظة: `service_role` في Supabase يملك EXECUTE افتراضيًا على الدوال الجديدة (سلوك المنصة)؛ هو دور خادم موثوق لا يُستعمل في الواجهة.

## 4. الملكية وحذف العضو

- `certificates.member_id` و`certificate_recipients.member_id` → `members(id) ON DELETE SET NULL`. الشهادة والـsnapshots والسجل تبقى.
- لا نقل ملكية: الحارس يسمح بتصفير `member_id` فقط، ولا يسمح بإسناده.
- `get_my_certificates()` تستدعي `current_member_id()`؛ إن كانت null (لا حساب/حساب معطّل/عضو محذوف) ترفع `42501` (fail-closed). المطابقة `c.member_id is not null and c.member_id = v_me`، فـ null لا يطابق أحدًا.
- `get_certificate_render_data(id)`: المالك الحالي أو manage فقط؛ «غير موجودة» و«ليست لك» يعطيان الخطأ نفسه؛ الملغاة لا تُولَّد.
- الشهادة تبقى قابلة للتحقق العام بعد حذف العضو وفق `public_name_mode`.

## 5. التحقق العام `verify_certificate(token)` (anon + authenticated)

`valid | revoked | not_found`. غير الصالح الشكل أو غير الموجود → `not_found` بنفس الشكل. لا email/member_id/issued_by/سبب الإلغاء.
- `valid`: الرقم، النوع، اللغة، عنوان الحملة/النشاط، تاريخ الإصدار، و`holder_name` حسب الوضع (`full` / `masked` مثل `A**** A*****` / `none` = null). الافتراضي `masked`.
- `revoked`: الرقم والنوع والتواريخ فقط، **بلا اسم إطلاقًا**.
- بعد الإصدار: `certificate_set_public_name_mode` يقبل **التضييق فقط** (`full→masked→none`) ويرفض التوسيع؛ والمشغّل يمنعه حتى بالتعديل المباشر.
- لا throttle إضافي: الرمز 256 بت فلا يُخمَّن؛ يمكن إضافة rate-limit لاحقًا على طبقة الـ Edge/Netlify إن لزم.

## 6. دورة حياة الحملة

`draft` (قابلة للتحرير) → `issued` (إضافة مستفيدين وإصدار إضافي مسموح) → `archived` (لا مستفيدين ولا إصدار جديد؛ الإلغاء وإعادة البريد لشهادة صالحة مسموحان؛ التحقق يستمر). لا حذف للحملات (مشغّل). بعد `draft` تُقفل: العنوان، النوع، القالب، اللغة، الخصوصية، الإعدادات، snapshots النشاط. الانتقالات المسموحة فقط: draft→issued، draft→archived، issued→archived.

مصادر الأهلية: `attendance_based` (من `activity_attendance` مع snapshot وقت الإضافة) و`manual_selection` (عضو أو خارجي). **`registration_based` معطّل بمشغّل** حتى يوجد مصدر تسجيل حقيقي؛ لا يُستعمل `activity_invitations`/RSVP.

## 7. الترقيم `IAE-YYYY-NNNNNN`

السنة بتوقيت `Africa/Casablanca`. عدّاد في جدول (`INSERT … ON CONFLICT DO UPDATE last_value+1`) داخل **نفس معاملة** إنشاء الشهادة، وليس `sequence`.
- التزامن: صف العدّاد مقفول حتى نهاية المعاملة، فالإصدارات المتزامنة تتسلسل ولا يتكرر رقم (يضمنه أيضًا `UNIQUE`).
- الثغرات: معاملة ملغاة تُلغي زيادة العدّاد، والحذف محظور بمشغّل، فلا ثغرات **في التشغيل العادي**. هذا مثبت منطقيًا ويُفحص في smoke (أرقام متتالية)، لكنه **لا يُضمن** ضد تدخل يدوي بصلاحية superuser (تعطيل المشغّلات أو حذف مباشر). لا يُدَّعى gap-free أبعد من ذلك.
- ثمن التصميم: إصدار جماعي كبير يحتجز صف العدّاد طوال معاملته (مقبول بحجم النادي).

## 8. الإلغاء وطابور البريد (السباق)

- ترتيب الأقفال الموحّد في كل المسارات: **الشهادة ثم صف الطابور** (revoke/enqueue/retry/claim/complete) → لا deadlock.
- `revoke`: يقفل الشهادة `FOR UPDATE`، يضع `revoked`، يُلغي المهام `queued`، ويوثّق `revoked_during_send` للمهام `sending`.
- `enqueue/retry`: يرفضان الملغاة بعد قفلها. `claim`: `FOR SHARE SKIP LOCKED` على الشهادة ثم `FOR UPDATE SKIP LOCKED` على الطابور، ويُلغي مهمة شهادة ملغاة.
- مهمة نشطة واحدة لكل شهادة (فهرس فريد جزئي).
- **حدّ لا يُمكن إزالته**: إن أُلغيت الشهادة بعد `claim` وطلب HTTP قد وصل المزوّد، **قد يصل البريد**. نُقلّص النافذة بـ `certificate_email_recheck` قبل الإرسال مباشرة، ونوثّق (`revoked_during_send`)، ولا نضمن المنع. البريد يحمل رابطًا لا PDF، فالرابط يعرض «ملغاة» بعد الإلغاء.
- `complete(false)` يعيد الجدولة بتراجع تربيعي (`attempts²` دقيقة) حتى `max_attempts` ثم `failed`. المهمة العالقة `sending` تُحرَّر إلى `failed (stale_sending)` بلا إعادة تلقائية لتفادي التكرار؛ الإعادة يدوية.
- أخطاء الإرسال رموز `[a-z0-9_]{1,40}` فقط. لا مفاتيح مزوّد في الملفات؛ العامل (Edge Function، المرحلة 2) سيستعمل `service_role` على الخادم وحده.

## 9. Audit

عبر `audit_logs` القائم (لا تعديل على بنيته ولا مشغّل immutability): `certificate_campaign_created/updated/issued/archived`, `certificate_batch_issued`, `certificate_recipients_added/removed`, `certificate_revoked`, `certificate_privacy_changed`, `certificate_secret_rotated`, `certificate_token_reissued`, `certificate_template_saved`, `certificate_email_enqueued/retried/sent/failed`, `certificate_emails_enqueued`. المساعد `certificate_audit` يرفض مفاتيح metadata الحساسة (`email, name, token, secret, member_id, reason…`) ويُسجّل أعدادًا ومعرّفات فقط. ملاحظة: `revoke_reason` يُخزَّن في `certificates` (يراه manage فقط) ولا يُنسخ إلى audit.

## 10. RPCs (ملخّص)

إدارة: `certificate_create_campaign`, `certificate_update_campaign`, `certificate_add_attendance_recipients`, `certificate_add_member_recipient`, `certificate_add_external_recipient`, `certificate_remove_recipient`, `certificate_issue_campaign`, `certificate_revoke`, `certificate_archive_campaign`, `certificate_set_public_name_mode`, `certificate_enqueue_email`, `certificate_enqueue_campaign_emails`, `certificate_retry_email` (manage) — `certificate_save_template`, `certificate_reissue_token` (admin) — `certificate_rotate_token_secret` (developer).
مراجعة: `certificate_review_campaigns`, `certificate_review_recipients`. عضو/مدير: `get_my_certificates`, `get_certificate_render_data`. عام: `verify_certificate`. عامل (service_role): `certificate_email_claim_next/recheck/complete/release_stale`.

## 11. اختبار التزامن اليدوي (جلستان psql على بيئة تجريبية)

1. **ترقيم**: بحملتين فيهما مستفيدون معلّقون، شغّل `select certificate_issue_campaign('<A>')` في الجلسة 1 داخل `begin;` دون commit، ثم الثانية للحملة B → يجب أن تنتظر الثانية حتى commit/rollback الأولى؛ بعد الانتهاء تأكد من عدم تكرار الأرقام وتتابعها.
2. **إلغاء/claim**: الجلسة 1: `begin; select certificate_revoke('<cert>');` (دون commit). الجلسة 2: `select certificate_email_claim_next('t');` → يتخطّى المهمة (SKIP LOCKED) ولا يُرسل. بعد commit الأولى: claim يعيد null والمهمة `cancelled`.
3. **إلغاء أثناء sending**: claim ثم revoke → `email_was_sending = true` وحدث `revoked_during_send`؛ `certificate_email_recheck` ترجع false.
4. **تدوير/إصدار**: الجلسة 1 `certificate_issue_campaign` (دون commit)؛ الجلسة 2 `certificate_rotate_token_secret()` → تنتظر الإصدار (قفل السرّ).
