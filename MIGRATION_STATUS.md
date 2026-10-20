# تقرير الترحيل النهائي — Phase 3 إلى 7 (كاملة)

تاريخ: 2026-09-12
**كل صفحات الموقع العام ولوحة الإدارة مُهاجَرة الآن.** المتبقي فقط هو الاختبار الفعلي (Phase 9–11)، الذي لم يُنجز داخل بيئة التنفيذ لعدم وجود اتصال بالإنترنت (راجع القسم 5).

---

## 1. الموقع العام (Phase 5) — مكتمل

| صفحة أصلية | الملف الجديد |
|---|---|
| `index.html` | `src/pages/public/Home.jsx` (+ Header/Footer/AnnouncementBar/Lightbox/LanguageSwitcher، `features/membership`, `features/contact`) |
| `members.html` + `board.html` | `src/pages/public/PeoplePage.jsx` (مكوّن عام واحد بدل تكرار الملفين، كانا متطابقين أصلاً) |
| `activity.html` | `src/pages/public/Activity.jsx` (+ `constants/defaultActivities.js`) |
| `thank-you.html` | `src/pages/public/ThankYou.jsx` |

## 2. لوحة الإدارة (Phase 6–7) — مكتملة، 13 صفحة

| صفحة أصلية | الملف الجديد | ملاحظات |
|---|---|---|
| `admin/login.html` | `pages/admin/Login.jsx` | تصميم قريب من الأصل عمدًا (شاشة وظيفية بسيطة) |
| `admin/dashboard.html` | `pages/admin/Dashboard.jsx` | مُعاد تصميمه بالكامل |
| `admin/requests.html` | `pages/admin/Requests.jsx` | القبول/الرفض عبر نفس RPC الأصلية بدون `p_reviewer_id` |
| `admin/members.html` | `pages/admin/Members.jsx` + `MemberFormModal.jsx` | بحث + فلترة + صفحات + رفع صور + CSV |
| `admin/board.html` | `pages/admin/Board.jsx` + `BoardFormModal.jsx` | إعادة ترتيب ↑↓ |
| `admin/activities.html` | `pages/admin/Activities.jsx` + `ActivityFormModal.jsx` | نشر/أرشفة بنفس شروط التحقق الأصلية |
| `admin/gallery.html` | `pages/admin/Gallery.jsx` + `GalleryEditModal.jsx` | رفع متعدد + ربط بنشاط |
| `admin/announcements.html` | `pages/admin/Announcements.jsx` + `AnnouncementFormModal.jsx` | **حافظتُ على إصلاح `end_at` (23:59:59) الموثّق في الأصل** |
| `admin/content.html` | `pages/admin/Content.jsx` | تعديل نصوص الصفحة الرئيسية/الفوتر |
| `admin/settings.html` | `pages/admin/Settings.jsx` | إعدادات عامة/تواصل اجتماعي/خريطة |
| `admin/admins.html` | `pages/admin/AdminUsers.jsx` + `AdminUserFormModal.jsx` | **حافظتُ على إصلاحين أمنيين موثّقين في الأصل** (انظر القسم 3) |
| `admin/audit.html` | `pages/admin/Audit.jsx` | فلترة بالقسم + صفحات |
| Sidebar (`js/admin-layout.js`) | `layouts/AdminLayout.jsx` + `constants/adminNav.js` | **مُعاد تصميمه بالكامل** — Dark SaaS، قابل للطي، متجاوب |
| `js/auth.js` | `app/providers/AuthProvider.jsx` + `services/supabase/auth.service.js` + `components/admin/ProtectedRoute.jsx` | React Context بدل استدعاء إجرائي بكل صفحة |

## 3. إصلاحات حساسة من المشروع الأصلي — حُوفظ عليها حرفيًا

هذه ليست تغييراتي، بل إصلاحات كانت موثّقة بالفعل في تعليقات الكود الأصلي (`admin/admins.html`, `admin/announcements.html`)، وتأكدتُ من نقلها دون فقدانها:

1. **تسجيل العمليات الحساسة**: تعديل صلاحيات مسؤول (`ADMIN_UPDATED_ADMIN`) الآن يُسجَّل في `audit_logs` (لم يكن مسجَّلاً في نسخة أقدم).
2. **"إزالة الصلاحية" = تعطيل، لا حذف**: `deactivateAdminProfile` يستخدم `is_active = false` وليس `DELETE`، ليطابق النص المعروض للمستخدم ("يمكن إعادة تفعيله لاحقًا") فعليًا.
3. **تاريخ نهاية الإعلان**: يُحفظ `end_at` بصيغة `YYYY-MM-DDT23:59:59` (نهاية اليوم)، وليس منتصف الليل، حتى لا تُخفي سياسة RLS الإعلان قبل أوانه.

## 4. ملخص كل ما تغيّر عن المشروع الأصلي

- **تعدد اللغات (i18n)**: بنية AR/FR/EN جاهزة وفعّالة (`react-i18next`)، لكن FR/EN لا يزالان placeholder بنفس النص العربي (قرارك: "أبقِ البنية جاهزة، أضف الترجمة لاحقًا").
- **المسارات**: `activity.html?id=slug` → `/activity/:slug` (مسار نظيف).
- **نموذج التواصل عبر Netlify Forms**: نموذج HTML ثابت مخفي في `index.html` الجذر لأجل اكتشاف Netlify وقت البناء (**يحتاج تأكيدًا فعليًا بعد أول نشر — هذه أكبر نقطة مخاطرة في كامل الترحيل**).
- **تصميم لوحة الإدارة**: Dark-first SaaS Control Center جديد بالكامل (tokens في `[data-theme='admin-dark']`)، بينما الموقع العام يطابق الأصل بصريًا 100% (CSS منسوخ حرفيًا، لا إعادة كتابة).

## 5. ⚠️ الأهم: لم يُشغَّل `npm install` / `npm run build` فعليًا في أي وقت خلال هذا الترحيل

بيئة التنفيذ **بدون اتصال بالإنترنت بالكامل** (فشل `npm install` بخطأ 403 على registry.npmjs.org منذ أول محاولة). هذا يعني:
- لم يُختبر نجاح البناء (`vite build`) ولا مرة واحدة.
- لم يُفتح الموقع في متصفح حقيقي، ولا نُقر أي زر أو رابط فعليًا.
- كل الكود روجع يدويًا (imports، أسماء الدوال، توقيعات RPC) لكن هذا لا يغني عن **Phase 9 (Testing)** و**Phase 10 (Regression Testing)** المطلوبتين في خطتك الأصلية، واللتين لم تُنفَّذا فعليًا بعد.

**الخطوات التالية الإلزامية قبل أي نشر إنتاجي:**
```bash
npm install
npm run build
npm run dev
```
ثم اختبر يدويًا (حسب القسم 27 من طلبك الأصلي): الموقع العام، تسجيل الدخول، كل صفحات الإدارة الـ13، النماذج (الانخراط + التواصل)، الأدوار الثلاثة (`super_admin`/`editor`/`members_manager`)، RTL، الاستجابة على الجوال. أرسل لي أي خطأ يظهر وسأُصلحه فورًا.

## 6. ملفات لم تُرحَّل (تبقى كما هي، لا علاقة لها بـ React)
- `_legacy_archive/` (كانت معزولة مسبقًا أصلاً).
- `AUDIT_REPORT.md`, `supabase/` (migrations + Edge Function) — تُستخدم كما هي مع المشروع الجديد بدون أي تعديل.
