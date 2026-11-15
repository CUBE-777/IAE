# تقرير المراجعة الأمنية — IAE

**النطاق:** `supabase/migrations/0001–0060`، الـ Edge Functions، واستدعاءات Supabase في `src`.
**المنهج:** قراءة الكود، ثم **تشغيل كل الـ migrations على Postgres 16 محلي** (مع مخطط auth/storage مُحاكى) واختبار السلوك فعليًا بأدوار `anon` و`authenticated`. لم يُلمس أي إنتاج.
**قيد صريح:** لم أرَ قاعدة البيانات الحية، فالفحوص التي تعرض «الوضع الحالي» (أعداد، ملفات، منح) في `01_pre_checks.sql` يجب تشغيلها عندكم. ما ورد هنا مثبت من الكود ومن التجربة المحلية.

## الخلاصة

| # | المشكلة | الخطورة | الحالة | الإصلاح |
|---|---|---|---|---|
| 1 | دوال الحراسة تُرجع `NULL` فتتجاوز دوالُّ الإدارة الحراسةَ | **حرجة** | مثبتة بتجربة | `02` الجزء 1-أ |
| 2 | `super_admin` يدير/يعطّل/يحذف/ينشئ حسابات `super_admin` | عالية | مثبتة | `02` الجزء 1-ب + `09` (Edge Function) |
| 3 | `super_admin` يعطّل الجانب «المنخرط» لحساب مطوّر | متوسطة | مثبتة | `02` الجزء 1-ب |
| 4 | سرد ملفات `members/` لأي زائر (صور غير الظاهرين/المحذوفين) | متوسطة | مثبتة | `03` (جزئي) + `09` |
| 5 | `super_admin` يحذف سجلات التدقيق | متوسطة | مثبتة | `06` §6.1 |
| 6 | دوال trigger بلا سحب EXECUTE، وصلاحيات TRUNCATE/REFERENCES/TRIGGER | منخفضة | مثبتة (تنظيف) | `04`، `06` §6.2 |
| 7 | رموز الدعوات: نص خام بلا انتهاء | منخفضة | مثبتة، بقرار تصميم | توصية (`09`) |

## 1. تجاوز الحراسة بسبب NULL — حرجة

**السبب.** `can_manage_members()` وأخواتها (0019، 0021، 0032) و`is_super_admin()` (0012) مكتوبة `select current_admin_role()::text in (...)`. لمن لا صفّ له في `profiles` تُرجع `current_admin_role()` القيمة NULL فتصير النتيجة **NULL لا false**. أما الحراسة داخل الدوال فهي على الصيغة:

```sql
if auth.uid() is null or not public.can_manage_members() then raise exception ... end if;
```

مع NULL: `false OR NOT NULL` = NULL، و`IF NULL` لا يدخل الفرع، فلا يُرفع أي خطأ.

**من يتأثر.** أي مستخدم موثّق ليس له دور إداري — أي **منخرط فُعّل حسابه** (فضاء المنخرطين، 0035)، وكذلك أي مسؤول فعّل MFA وجلسته aal1 (لأن `current_admin_role()` تُرجع NULL له بقرار 0024، فتبطل حماية MFA في الدوال).

**الدليل.** بعد تشغيل كل migrations، استدعيت 90 دالة قابلة للتنفيذ من `authenticated` كمستخدم بلا دور. تجاوزت الحراسة (وصلت إلى منطقها، أو نجحت) دوال منها: `issue_membership_form`، `approve_membership_request`، `reject_membership_request`، `record_annual_membership`، `cancel_member_membership`، `issue_board_profile_link`، `approve_board_profile`، `return_board_profile`، `reorder_board_members`، `request_membership_document`، `request_internal_file_download`، `add_invitations`، `save_invitation_settings`، `update_invitation`، `delete_invitation`، `set_invitation_revoked`، `publish_attendance_card`، `close_attendance_card`، `record_attendance_manual`، `list_members_for_renewal`، و`get_activity_invitations` (تُرجع رموز الدعوات). بعضها توقّف لاحقًا لسبب عرضي (مفتاح أجنبي، «غير موجود») لا لحراسة. دوال الألعاب سليمة لأنها تستعمل `coalesce(..., false)`.

**لماذا لم تُكتشف.** `rls_smoke.sql` يفحص `if public.can_manage_members() then raise ...`، و`IF NULL` يمرّ، فاختبار «لا يعتبر المستخدم مسؤولًا» ينجح خطأً.

**الإصلاح.** `coalesce(..., false)` داخل الدوال المساعدة العشر نفسها (جذر المشكلة، يُصلح كل الدوال المستدعية). **سلوك RLS لا يتغيّر** (NULL وfalse كلاهما يرفض الصف). تحقّقت من مصفوفة 10 أدوار × 10 دوال: النتائج متطابقة قبل وبعد لكل دور مشروع.

> التأثير الفعلي في الإنتاج يتوقف على وجود حسابات منخرطين مفعّلة وقت الفحص. بعد التنفيذ شغّل `07` (المجموعة A تفحص 60 دالة).

## 2. تفوّق المطوّر — عالية

- `is_super_admin()` تُرجع true للمطوّر وللمسؤول الأعلى معًا (مقصود، وتعتمد عليها السياسات)، فسياسات `profiles` تتيح لـ `super_admin` INSERT/UPDATE/DELETE لأي صف. الـ trigger `trg_protect_developer_profiles` (0012) يحمي صفوف المطوّر ويمنع منح الدور، **لكنه لا يحمي `super_admin`**.
- **الإصلاح:** trigger جديد `trg_protect_super_admin_profiles`: غير المطوّر لا ينشئ/يعدّل/يعطّل/يحذف حسابًا دوره `super_admin` ولا يمنح الدور أو يسحبه. استثناء ضيّق: تعديل المسؤول الأعلى لبيانات حسابه هو دون تغيير الدور أو التفعيل.
- **لم يُغيَّر:** `is_super_admin()`، حماية المطوّر القائمة، وبقية الأدوار (اختبار B5).
- `unlink_admin_as_member` / `link_admin_as_member` (0046) تسمح لـ `super_admin` بتعطيل جانب المنخرط لحساب مطوّر مزدوج؛ يعالجها trigger على `member_accounts` (المطوّر نفسه وصاحب الحساب وservice_role مسموح لهم).
- **لا يغطيها SQL:** Edge Function `admin-create-user` تعمل بـ `service_role` (`auth.uid()` = null فتتجاوز الـ triggers). تمنع منح `developer` لغير المطوّر (سطر 164) لكن **لا تمنع منح `super_admin`**. التعديل في `09_app_changes_required.md`.

## 3. دوال SECURITY DEFINER

- كل دوال SECURITY DEFINER تثبّت `search_path`. ✔ (يفحصه `07` E2)
- دوال `anon` المطلوبة وظيفيًا (إبقاؤها): `get_member_activation_link`، `get_invitation`، `respond_invitation`، `get_board_profile_link`، `get_membership_form`، `submit_membership_form`، `submit_board_profile`، `verify_member_card`، `request_member_access_help`، `board_photo_upload_allowed`، `membership_upload_allowed`. تعمل كلها برمز عشوائي طويل أو ببيانات محدودة، ولا ثغرة مثبتة فيها بذاتها.
- مساعدات يجب أن يبقى EXECUTE فيها لـ `anon`: `current_admin_role`، `is_admin`، `is_super_admin`، `can_manage_content`، `can_manage_members` (سياسات بلا `to` تُقيَّم لـ anon؛ سحبها يكسر القراءة العامة).
- ملاحظات معلوماتية (لا تغيير): دوال الزائر لا تضع حدّ معدّل إلا `verify_member_card`/التفعيل/`request_member_access_help` (رموز الباقي ≈244 بتًا فلا جدوى من التخمين). حدّ المعدّل يعتمد على ترويسة `cf-connecting-ip` ثم `x-forwarded-for`.
- **التنظيف (`04`):** سحب EXECUTE من دوال trigger القديمة (`budget_*`، `prevent_*`، `protect_developer_profiles`، `announcements_before_write`). النمط نفسه مستعمل في 0050–0060، واختبار الانحدار F يؤكد عمل التدفقات.

## 4. الرموز

| الرمز | التوليد | التخزين | الصلاحية | مرة واحدة | الحدّ |
|---|---|---|---|---|---|
| نموذج الانخراط | 2×`gen_random_uuid` | sha256 | 7 أيام، إعادة الإصدار تُبطل | نعم | — |
| تفعيل الحساب | 2×uuid | sha256 | 7 أيام | نعم | 8/10د لكل IP |
| رابط عضو المكتب | 2×uuid | sha256 | 14 يومًا | حتى الاعتماد | — |
| الدعوات | 2×uuid | **نص خام** | **بلا انتهاء**، إلغاء يدوي | لا | — |
| بطاقة QR | سرّ خادم + epoch (128 بت) | sha256 | دائم + «رمز جديد» | لا (مقصود) | 30/10د لكل IP |

**لا إصلاح SQL آمنًا هنا** (`05` تأكيدات فقط): تجزئة رموز الدعوات تكسر «نسخ الرابط»، وفرض انتهاء يُبطل روابط الضيوف الحالية بلا خطة. **توصية:** قرار إداري بمدة صلاحية الدعوة بعد الحفل مع فترة سماح، ثم تعديل `get_invitation`/`respond_invitation` (في `09`).

## 5. RLS وStorage

- كل جداول `public` عليها RLS (`07` E4). الجداول المغلقة بلا منح ولا سياسات = رفض كامل، والوصول بدوال DEFINER. ✔
- أعمدة `members` الحساسة غير ممنوحة لـ `anon` ✔ (E8). `membership-docs` و`budget-receipts` و`internal-files` بلا قراءة لـ anon ✔.
- منح الجداول الواسع الافتراضي **لم يُعتبر ثغرة** لأن RLS يحكم كل جدول؛ سُحبت فقط TRUNCATE/REFERENCES/TRIGGER (لا تمرّ عبر RLS). سحب DML من anon خيار معطّل في `06` §6.4.
- **audit_logs:** حذف للمطوّر فقط. الواجهة لا تحذف السجل. قراءة السجل لكل المسؤولين **بقيت** لأن لوحة المعلومات تعرضه (التقييد قرار لاحق).

## 6. صور الأعضاء — ما يعالجه SQL وما لا يعالجه

**المثبت:** صور الأعضاء في `association-media/members/` بروابط عامة تُحفظ في `members.photo_url`. الواجهة لا تحذف الملف عند حذف العضو منطقيًا أو إلغاء `show_in_directory` (لا استدعاء `deleteImageByUrl` هناك)، فتبقى الملفات. وسياسة SELECT العامة تسمح بسردها.

**يعالجه `03`:** منع **سرد/اكتشاف** ملفات `members/` لغير الظاهرين (يبقى لأعضاء الدليل وأعضاء المكتب النشطين). المجلدات الأخرى (أنشطة، إعلانات، معرض، مشاريع، مكتب) كما هي. الطاقم يرى كل شيء كي لا ينكسر الحذف.

**لا يعالجه SQL (بصراحة):** رابط `/object/public/...` لا يمرّ عبر RLS؛ من يملك رابط صورة بعينها يبقى يفتحها. الحماية الكاملة تتطلب خطة تطبيق (`09`): bucket خاص + signed URLs، أو حذف ملف العضو عند حذفه/انسحابه. لم أحذف ولم أنقل شيئًا. `verify_member_card` تُرجع `photo_url` لحامل رمز صالح بغضّ النظر عن `show_in_directory` (سلوك مقصود للبطاقة) — قرار خصوصية لكم.

## ما لم أستطع تأكيده
- الوضع الفعلي في قاعدتكم الحية (مجموعات 1.x–5.x في `01`).
- إعدادات Supabase خارج SQL: تعطيل التسجيل الذاتي، سياسة كلمات المرور، حدود المعدّل في Auth، قيود MIME/الحجم على الـ buckets الفعلية.
- لم أراجع `netlify.toml` ولا ترويسات CSP بعمق (خارج النطاق المطلوب).
