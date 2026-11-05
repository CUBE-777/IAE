# ميزة (المرحلة 3 من نظام الأعضاء): «فضاء المنخرطين» — حسابات الأعضاء بالتفعيل الشخصي وطلبات تعديل البطاقة — القاعدة والخادم فقط

لا تغيير في الواجهة ولا في الموقع الحالي. إضافة صرفة لا تعدّل أي جدول أو دالة أو سياسة موجودة.
- `member_activation_links`: رابط تفعيل شخصي لكل عضو (رمز مُجزَّأ، 7 أيام، يُستعمل مرة واحدة). يُصدره مسؤولو نظام الأعضاء الأربعة فقط.
- `member_card_requests`: طلبات تعديل البطاقة العامة (صورة، نبذة، مسار دراسي، روابط، معلومات إضافية، ترجمات، المهنة، الظهور في الدليل).
  لا يُنشر شيء قبل اعتماد الإدارة (`approve_member_card_request`) أو رفضه (`reject_member_card_request`) مع ملاحظة.
- Edge Function جديدة `member-activate`: تنشئ حساب Auth ببريد العضو المسجّل عند الإدارة (لا بريد من العميل) وبكلمة مرور يختارها بنفسه، ثم تربطه عبر `finalize_member_activation`، وتتراجع عند أي فشل.
- دوال العضو: `get_my_member` / `update_my_member_private` (الهاتف والمدينة والمهنة فورًا + سحب الظهور في الدليل فورًا) / `submit_member_card_request` / `cancel_my_member_card_request`.
  العضو لا يكتب في `members` مباشرة أبدًا؛ `bio` (الخاص بالإدارة) والاسم والبريد خارج ما يستطيع تغييره.
- تخزين: يرفع العضو صورته المقترحة إلى `member-<id>/` في bucket الخاص `membership-docs` (سقف 10 ملفات)، وللإدارة وحدها قراءتها.
ملفات جديدة: `supabase/migrations/0036_member_space_activation_and_card_requests.sql` و`supabase/rollback/0036_member_space_down.sql` و`supabase/functions/member-activate/index.ts` و`tests/member-space-sql.test.js`.
ملفات معدَّلة (إلحاق فقط): `supabase/config.toml` و`CHANGES.md`.
ترتيب النشر: (1) تجربة جافة: استبدل `commit;` الأخيرة بـ `rollback;` في 0036 وشغّله في SQL Editor، (2) أعدها `commit;` ونفّذه فعليًا،
(3) `supabase functions deploy member-activate`، (4) في لوحة Supabase: Authentication → Sign In / Providers → عطّل «Allow new users to sign up»،
(5) شغّل `supabase/tests/rls_smoke.sql` وتأكد أن فحوصه السابقة لا تزال تنجح. لا حاجة لنشر الواجهة في هذه المرحلة.
الرجوع: `supabase/rollback/0036_member_space_down.sql`.
المتبقي (مراحل لاحقة): واجهة `/member/*` وصفحة `/member/activate/:token` وأزرار الإدارة، ثم بطاقة QR والحضور والأنشطة الخاصة بالأعضاء، ثم الإعلانات والملفات الداخلية للأعضاء.

---

# ميزة (المرحلة 2 من نظام الأعضاء): أساس حسابات الأعضاء — قاعدة البيانات فقط

لا تغيير في الواجهة ولا في الموقع الحالي ولا في أي Edge Function. إضافة صرفة في قاعدة البيانات:
- جدول جديد `member_accounts` (ربط 1:1 بين مستخدم Supabase Auth وسجل العضو، خاص: لا كتابة من أي عميل).
- دالة `can_manage_member_system()` — الأدوار الأربعة فقط: super_admin وdeveloper وsecretary_general وmembers_manager (لا نواب).
- دالة `current_member_id()` — هوية العضو الحالي (null لغير الأعضاء ولمن له صف في `profiles`).
- مشغّل حماية على الجدول الجديد فقط: يرفض ربط حساب عضو بمستخدم له `profiles` (فصل الحساب الإداري عن حساب العضو)،
  ويرفض عضوًا محذوفًا، ويجعل الربط غير قابل للتغيير.
- لا يُعدَّل: `profiles` وسياساته، `admin_role`، `is_admin` و`current_admin_role` و`mfa_satisfied` و`can_manage_members`، `members`، `auth.users`.
ملفات جديدة: `supabase/migrations/0035_member_accounts.sql` و`supabase/rollback/0035_member_accounts_down.sql` و`tests/member-accounts-sql.test.js`.
ملفات معدَّلة (إلحاق فقط): `supabase/tests/rls_smoke.sql` (قسم فحوص 0035) و`supabase/README.md` و`CHANGES.md`.
ترتيب النشر: (1) تجربة جافة: استبدل `commit;` الأخيرة بـ `rollback;` في 0035 وشغّله في SQL Editor، (2) أعدها `commit;` ونفّذه فعليًا،
(3) شغّل `supabase/tests/rls_smoke.sql` كاملًا وتأكد من ظهور «فحوص 0035 ... كل الفحوص نجحت ✔»، (4) لا حاجة لنشر الواجهة.
الرجوع: `supabase/rollback/0035_member_accounts_down.sql`.

---

# تعديل: استمارة الانخراط المرسلة عبر الواتساب (`/membership-form/:token`)

- حقل جديد **رقم مسار / أبوجي** (إلزامي، حروف وأرقام فقط) وحقل **لماذا تريد الانضمام إلينا؟** (إلزامي، حتى 1000 حرف).
- «الدفعة / السنة» أصبحت **سنة التخرج** (العمود `promotion` نفسه، تغيير في العنوان فقط).
- **بطاقة الطالب** بدل البطاقة الوطنية، بصورتين: الوجه (`id_card_path`) والظهر (`id_card_back_path`)، كلتاهما إلزامية.
- **قسما المعلومات الشخصية والدراسية إلزاميان بالكامل** (الاسم بالعربية وباللاتينية، البريد، سنة التخرج، رقم مسار/أبوجي، وغيرها) **ما عدا الصورة الشخصية فهي اختيارية** (لا نشر للصورة دون رفعها).
- تُعرض الحقول الجديدة للإدارة في «الطلبات» و«تفاصيل العضو» مع زرّي عرض الوجه والظهر. نص رسالة الواتساب مُحدَّث بالعربية والفرنسية والإنجليزية.
- ملفات جديدة: `supabase/migrations/0034_membership_form_apogee_student_card.sql` و`tests/membership-form-apogee-student-card.test.js`.
- ترتيب النشر: (1) نفّذ 0034 في SQL Editor، (2) ثم انشر الواجهة.

---

# ميزة: دور «مستشار» (consultant)

الصلاحيات: إدارة المشاريع كاملة (إضافة، تعديل، نشر، حذف منطقي، ورفع صور المشاريع فقط) + اطلاع للقراءة فقط على لوحة القيادة والأنشطة
والمعرض والإعلانات وأعضاء المكتب ومحتوى الموقع + اطلاع وتنزيل للملفات الداخلية (بلا رفع ولا حذف).
لا يصل إلى: الأعضاء، طلبات الانخراط، الميزانية، المستخدمين الإداريين، سجل العمليات، الإعدادات.

إضافة صرفة: لا تُعدَّل دوال can_manage_content / can_manage_members / can_access_internal_files / is_admin / is_super_admin،
ولا يتغيّر سلوك أي دور موجود. ملفات جديدة: `supabase/migrations/0032_consultant_role.sql` (دالتان جديدتان can_manage_projects وcan_read_internal_files
وإعادة إنشاء سياسات المشاريع وصور المشاريع والملفات الداخلية وقراءة سجل العمليات بشروطها الأصلية + حالة المستشار).
ملفات معدَّلة: `constants/roles.js` و`adminNav.js` و`router/index.jsx` (مجموعات جديدة ROLES_PROJECTS / ROLES_CONTENT_VIEW / ROLES_INTERNAL_FILES_VIEW)،
`auth.service.js` (ROLE_LABELS)، `admin-create-user/index.ts` (ALLOWED_ROLES)، `AdminUserFormModal.jsx`، ملفات الترجمة وadminDict،
وإخفاء أزرار الإضافة/التعديل/الحذف للمستشار في: Activities وBoard وGallery وAnnouncements وContent وInternalFiles وDashboard.
اختبارات: `tests/roles.test.js` (يتحقق من تطابق الواجهة مع 0032 ومن أن المستشار خارج المجموعات الحساسة).
ترتيب النشر: (1) شغّل 0032 في SQL Editor، (2) أعد نشر الدالة: `supabase functions deploy admin-create-user`، (3) انشر الواجهة،
(4) أنشئ حساب المستشار من «المستخدمون الإداريون» واطلب منه تفعيل المصادقة الثنائية، (5) شغّل rls_smoke.sql.

---

# إصلاح: أزرار قائمة لوحة الإدارة لا تُضغط على الهاتف

السبب: لوحة الإدارة تُحمَّل عند الطلب (lazy)، فكان ملف admin.css يُحقن في الصفحة بعد ملف admin-enhancements.css
ويتغلّب عليه عند تساوي الخصوصية: z-index القائمة الجانبية يصير 40 بدل 70، فتعلوها طبقة الخلفية المعتمة (60)
وتبتلع كل النقرات وتبدو القائمة باهتة.

الإصلاح: استيراد admin.css في src/main.jsx قبل ملفات التحسينات (كل محددات admin.css تخص الإدارة فقط، فلا أثر على الموقع العام).
اختبار جديد: tests/css-order.test.js. انسخ الملفين فوق المشروع ثم انشر.

---

# ميزة: أعضاء المكتب يملؤون ملفاتهم بأنفسهم (رابط شخصي + مراجعة)

ملفات جديدة: `supabase/migrations/0031_board_profile_links.sql`، `src/pages/public/BoardProfileFormPage.jsx`،
`src/pages/admin/BoardProfileLinkModal.jsx`، `src/pages/admin/BoardProfileReviewModal.jsx`،
`src/services/supabase/boardProfile.service.js`، `src/utils/boardProfileDiff.js`، `tests/board-profile-links.test.js`.
ملفات معدَّلة (إضافات فقط): `Board.jsx` (أزرار الرابط والمراجعة)، `router/index.jsx` (مسار `/board-profile/:token`)،
ملفات الترجمة الثلاثة (مفتاح `boardProfile`)، `adminDict.data.js`، `robots.txt`، `rls_smoke.sql`، `tests/css-coverage.test.js`.
ترتيب النشر: (1) شغّل 0031 في SQL Editor، (2) انسخ الملفات فوق المشروع وانشر، (3) شغّل rls_smoke.sql للتأكد.
