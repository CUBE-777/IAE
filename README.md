# جمعية خريجي ثانوية المرابطين ببيوكرة — الموقع الرسمي

تطبيق ويب من صفحة واحدة (SPA) مبني بـ **React + Vite**، يضم الموقع العام للجمعية
ولوحة إدارة كاملة، مع قاعدة بيانات ومصادقة عبر **Supabase**.

اللغة الأساسية للمحتوى هي **العربية (RTL)**، مع دعم الفرنسية والإنجليزية.

---

## التقنيات المستخدمة

| المجال | التقنية |
| --- | --- |
| الواجهة | React 18 |
| أداة البناء | Vite 5 |
| التوجيه | React Router 6 |
| قاعدة البيانات والمصادقة | Supabase (`@supabase/supabase-js`) |
| تعدد اللغات | i18next + react-i18next |
| الأيقونات | lucide-react |
| تنظيف HTML (حماية XSS) | DOMPurify |
| الاستضافة | Netlify (مع Netlify Forms لنموذج التواصل) |

---

## التشغيل محليًا

```bash
npm install
cp .env.example .env    # ثم املأ القيم من لوحة Supabase
npm run dev             # خادم التطوير
```

## البناء للإنتاج

```bash
npm run build     # الناتج في dist/
npm run preview   # معاينة نسخة الإنتاج محليًا
```

> لا يوجد حاليًا سكربت `lint` أو `test` معرّف في `package.json`.

---

## متغيرات البيئة

تُعرَّف في ملف `.env` (غير مرفوع إلى Git). راجع `.env.example`:

| المتغير | الوصف |
| --- | --- |
| `VITE_SUPABASE_URL` | رابط مشروع Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | المفتاح العام (anon/publishable) |

⚠️ لا تضع `service_role` أو أي مفتاح سري في الواجهة إطلاقًا. العمليات التي
تتطلب صلاحيات عليا (مثل إنشاء مستخدمي الإدارة) تتم داخل **Supabase Edge
Functions** على الخادم.

---

## بنية المشروع

```text
src/
├── app/
│   ├── router/          # تعريف كل المسارات + حماية مسارات الإدارة + 404
│   └── providers/       # AuthProvider (جلسة المستخدم والصلاحيات)
├── components/
│   ├── layout/          # Header / Footer / PageHero / LanguageSwitcher ...
│   ├── admin/           # مكونات لوحة الإدارة المشتركة
│   └── common/          # مكونات عامة (Lightbox ...)
├── features/            # نماذج التواصل والانخراط
├── pages/
│   ├── public/          # Home / PeoplePage / Activity / ThankYou / NotFound
│   └── admin/           # Dashboard / Members / Requests / Activities ...
├── services/supabase/   # كل الاستعلامات مفصولة عن الواجهة
├── styles/              # tokens.css (مصدر الحقيقة) + أنماط الصفحات
├── i18n/                # الإعداد + ملفات الترجمة ar / fr / en
├── constants/           # محتوى احتياطي عند تعذر الاتصال بقاعدة البيانات
└── utils/               # التنظيف (sanitize) والإشعارات
```

### نظام التصميم

`src/styles/tokens.css` هو **المصدر الوحيد للحقيقة** للألوان والظلال والحواف
والتباعد والخطوط. لا تكتب قيمة لونية (hex أو rgba) مباشرة داخل ملفات CSS
الأخرى — أضف توكن هنا واستخدمه عبر `var(--token-name)`.

---

## لوحة الإدارة

متاحة على `/admin` وتضم: لوحة المؤشرات، الأعضاء، المكتب المسير، طلبات
الانخراط، الأنشطة، معرض الصور، الإعلانات، محتوى الموقع، الإعدادات، مستخدمي
الإدارة، وسجل التدقيق (Audit Logs).

الحماية تتم على مستويين:

1. **الواجهة** — عبر `ProtectedRoute` والتحقق من الدور.
2. **الخادم** — عبر **Row Level Security** في Supabase (هي خط الدفاع الحقيقي).

---

## تعدد اللغات

- العربية هي اللغة الافتراضية، والاتجاه يتحول تلقائيًا (RTL / LTR).
- اختيار اللغة يُحفظ في `localStorage` ويبقى بعد إعادة تحميل الصفحة.
- ملفات الترجمة في `src/i18n/locales/`. **يجب أن تبقى بنية المفاتيح متطابقة
  تمامًا في الملفات الثلاثة** عند إضافة أي نص جديد.

---

## الأمان

- تنظيف كل محتوى HTML قادم من قاعدة البيانات عبر DOMPurify قبل العرض.
- التحقق من الروابط عبر `safeUrl` لمنع `javascript:` وما شابه.
- لا توجد مفاتيح سرية في الواجهة.
- الاعتماد على RLS في Supabase وليس على فحوص الواجهة وحدها.

---

## النشر

يُنشر على Netlify (`netlify.toml`). كون المشروع SPA، كل المسارات تُعاد توجيهها
إلى `index.html` ليتولى React Router عرض الصفحة الصحيحة.

النموذج المخفي في `index.html` ضروري لعمل **Netlify Forms** ويجب عدم حذفه.

---

## أرشيف

مجلد `_legacy_archive/` يحتوي على نسخة المشروع الثابتة القديمة (HTML/CSS/JS)
قبل الترحيل إلى React، محفوظة للرجوع إليها فقط. **لا يُستخدم منه أي ملف في
التطبيق الحالي.**

> **ملاحظة تنظيمية:** `src/` هو التطبيق الفعّال الوحيد. نُسخ ملفات legacy التي كانت
> مكرّرة في جذر المشروع (`admin/*.html`, `js/`, `css/`, `members.html`…) أُزيلت بعد
> التحقق (`cmp`) من أن لها نسخًا مطابقة بايت-ببايت داخل `_legacy_archive/`. وكذلك
> نُسخ الصور المكرّرة في `uploads/` و`content/uploads/`؛ مصدر الحقيقة للملفات
> الثابتة هو `public/`. ملف الجذر `public-home.css` القديم (غير مطابق لأي نسخة)
> نُقل إلى `_legacy_archive/root-static-pages/public-home.root-snapshot.css`.

---

## تحديثات الصيانة الأخيرة (UI/UX + الإعلانات + الأمان)

- **لوحة الإعلانات**: قسم في الصفحة الرئيسية بعد Hero، وصفحتا `/announcements` و`/announcement/:slug`، وإدارة كاملة من لوحة الإدارة (`/admin/announcements`). تعتمد على جدول `announcements` الموجود بعد توسيعه في `supabase/migrations/0009_announcements_board_audit.sql`.
- **الأمان** (نفس migration 0009): `audit_logs` لا يقبل إدخالاً مباشراً من المتصفح — التسجيل عبر `log_admin_action()`؛ ترتيب المكتب عبر `reorder_board_members()` ذرّياً؛ منع تعديل `profiles.email` من الـ API.
- **ملفات البيئة**: `.gitignore` و`.env.example` (انسخه إلى `.env`).
- **التطبيق**: شغّل `0009_announcements_board_audit.sql` على قاعدة Supabase *قبل* نشر الواجهة الجديدة (الواجهة تستدعي الدالتين الجديدتين).
- أنماط التحسينات في `src/styles/enhancements.css` و`src/styles/admin-enhancements.css` (تُستورد آخراً في `main.jsx`).
