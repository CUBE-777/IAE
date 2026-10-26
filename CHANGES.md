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
