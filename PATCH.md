# دمج نظام الدعوات (المرحلة 1)

انسخ المجلدات فوق مشروعك كما هي (`public/invite` و`src` و`supabase`)، ثم:

## 1) الحزم
```
npm i html2canvas jspdf
```
(تُحمَّلان ديناميكيًا عند تنزيل PDF فقط، فلا تثقلان الصفحات الأخرى. لا تغيير على CSP.)

## 2) قاعدة البيانات
نفّذ `supabase/migrations/0051_activity_invitations.sql` بالطريقة المعتادة عندك (ملف التراجع في `supabase/rollback`).
تعتمد الدوال على `can_manage_content()` و`audit_logs` الموجودتين من 0041.

## 3) `src/pages/admin/Activities.jsx`
```jsx
import ActivityInvitationsModal from './ActivityInvitationsModal';
// مع بقية الحالات:
const [invitesTarget, setInvitesTarget] = useState(null);
// في خلية الإجراءات، بعد زر بطاقة الحضور:
<button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setInvitesTarget(a)}>{tr('الدعوات')}</button>
// قبل </AdminLayout>:
{invitesTarget && <ActivityInvitationsModal activity={invitesTarget} onClose={() => setInvitesTarget(null)} />}
```

## 4) `src/app/router/index.jsx`
مع بقية الـ lazy imports:
```jsx
const Invitation = lazy(() => import('../../pages/public/Invitation'));
```
وأضف عنصرًا ثانيًا في المصفوفة **خارج** `RootLayout` (بعد العنصر الذي ينتهي في السطر ~155، قبل `]);`) كي لا يظهر Navbar/Footer:
```jsx
{
  path: '/invite/:token',
  element: <Suspense fallback={<PageLoader />}><Invitation /></Suspense>,
  errorElement: <RouteError />,
},
```

## 5) منع الفهرسة (اختياري لكنه موصى به)
في `netlify.toml`:
```toml
[[headers]]
  for = "/invite/*"
  [headers.values]
    X-Robots-Tag = "noindex, nofollow"
```
وتأكد أن `netlify/edge-functions/sitemap.js` لا يتضمن `/invite`.

## 6) ملاحظات
- النصوص الإدارية الجديدة بالعربية وتعمل كما هي؛ ترجمتها للفرنسية/الإنجليزية تُضاف لاحقًا إلى `adminDict.data.js` إن أردت.
- الخطوط (Cinzel وCormorant) تُحمَّل من Google Fonts المسموح في CSP؛ ولاستقلالية كاملة يمكن لاحقًا استضافتها ذاتيًا.
- الشعار والختم صارا ملفين في `public/invite/` بدل base64.
- PDF صورة عالية الجودة بمقاس ≈ A5 (148×205.6 مم)، بلا عدّاد ولا حركة.
- يحتاج الزر الجديد صلاحية `can_manage_content()`؛ دور consultant (قراءة فقط) لا يرى أزرار الأنشطة أصلًا.
