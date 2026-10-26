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
