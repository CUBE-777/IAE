import { lazy, Suspense } from 'react';
import { createBrowserRouter, Outlet } from 'react-router-dom';
import Home from '../../pages/public/Home';
import ProtectedRoute from '../../components/admin/ProtectedRoute';
import RouteError from '../../components/common/RouteError';
import { ROLES_MEMBERS, ROLES_REQUESTS, ROLES_CONTENT, ROLES_INTERNAL_FILES, ROLES_BUDGET, ROLES_SUPER } from '../../constants/roles';
import PageLoader from '../../components/common/PageLoader';

// Code splitting: الصفحة الرئيسية تبقى في الحزمة الأولى (أسرع ظهور)، وباقي الصفحات — خصوصًا
// لوحة الإدارة — تُحمَّل عند الطلب فقط، فلا يحمّل الزائر العادي كود الإدارة وقاموسها.
const Members = lazy(() => import('../../pages/public/Members'));
const Board = lazy(() => import('../../pages/public/Board'));
const Activity = lazy(() => import('../../pages/public/Activity'));
const PublicAnnouncements = lazy(() => import('../../pages/public/Announcements'));
const AnnouncementDetail = lazy(() => import('../../pages/public/AnnouncementDetail'));
const Projects = lazy(() => import('../../pages/public/Projects'));
const ProjectDetail = lazy(() => import('../../pages/public/ProjectDetail'));
const ThankYou = lazy(() => import('../../pages/public/ThankYou'));
const MembershipFormPage = lazy(() => import('../../pages/public/MembershipFormPage'));
const NotFound = lazy(() => import('../../pages/public/NotFound'));
const Login = lazy(() => import('../../pages/admin/Login'));
const Dashboard = lazy(() => import('../../pages/admin/Dashboard'));
const Requests = lazy(() => import('../../pages/admin/Requests'));
const AdminMembers = lazy(() => import('../../pages/admin/Members'));
const AdminBoard = lazy(() => import('../../pages/admin/Board'));
const Activities = lazy(() => import('../../pages/admin/Activities'));
const AdminProjects = lazy(() => import('../../pages/admin/Projects'));
const InternalFiles = lazy(() => import('../../pages/admin/InternalFiles'));
const Gallery = lazy(() => import('../../pages/admin/Gallery'));
const AdminAnnouncements = lazy(() => import('../../pages/admin/Announcements'));
const Content = lazy(() => import('../../pages/admin/Content'));
const AdminUsers = lazy(() => import('../../pages/admin/AdminUsers'));
const Audit = lazy(() => import('../../pages/admin/Audit'));
const Settings = lazy(() => import('../../pages/admin/Settings'));
const Budget = lazy(() => import('../../pages/admin/Budget'));
const Security = lazy(() => import('../../pages/admin/Security'));
const Privacy = lazy(() => import('../../pages/public/Privacy'));

/**
 * src/app/router/index.jsx
 * راوتر الموقع العام (Phase 5، مكتمل) + راوتر لوحة الإدارة (Phase 6–7، مكتمل).
 * كل مسار /admin/* محمي بـ ProtectedRoute (يطابق سلوك Auth.requireAuth(roles)
 * الأصلي).
 * ملاحظة: activity.html?id=slug أصبحت /activity/:slug (مسار نظيف بدل query
 * string) — سلوك مطابق وظيفيًا، وأفضل لـ SEO والمشاركة.
 */
function protectedAdmin(roles, element) {
  return <ProtectedRoute roles={roles}>{element}</ProtectedRoute>;
}

// Suspense واحد يغلّف كل الصفحات المحمّلة عند الطلب. فشل تحميل جزء (بعد نشر جديد) يلتقطه RouteError.
function RootLayout() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Outlet />
    </Suspense>
  );
}

export const router = createBrowserRouter([
  // مسار بلا مسار فعلي يغلّف الكل ليلتقط RouteError أي خطأ عرض (الخطأ في مسار فرعي يظهر هنا)
  {
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/members', element: <Members /> },
      { path: '/board', element: <Board /> },
      { path: '/activity/:slug', element: <Activity /> },
      { path: '/announcements', element: <PublicAnnouncements /> },
      { path: '/announcement/:slug', element: <AnnouncementDetail /> },
      // مرادف لنفس الصفحة (يتبع الصيغة الجمعية أيضًا) — بدون إعادة توجيه حتى يعمل أي رابط مشارَك
      { path: '/announcements/:slug', element: <AnnouncementDetail /> },
      { path: '/projects', element: <Projects /> },
      { path: '/projects/:slug', element: <ProjectDetail /> },
      { path: '/thank-you', element: <ThankYou /> },
      { path: '/privacy', element: <Privacy /> },
      // رابط شخصي لنموذج الانخراط (رمز غير قابل للتخمين) — صفحة غير مفهرسة
      { path: '/membership-form/:token', element: <MembershipFormPage /> },

      { path: '/admin/login', element: <Login /> },
      { path: '/admin/dashboard', element: protectedAdmin([], <Dashboard />) },
      { path: '/admin/members', element: protectedAdmin(ROLES_MEMBERS, <AdminMembers />) },
      { path: '/admin/requests', element: protectedAdmin(ROLES_REQUESTS, <Requests />) },
      { path: '/admin/board', element: protectedAdmin(ROLES_CONTENT, <AdminBoard />) },
      { path: '/admin/activities', element: protectedAdmin(ROLES_CONTENT, <Activities />) },
      { path: '/admin/projects', element: protectedAdmin(ROLES_CONTENT, <AdminProjects />) },
      { path: '/admin/gallery', element: protectedAdmin(ROLES_CONTENT, <Gallery />) },
      { path: '/admin/announcements', element: protectedAdmin(ROLES_CONTENT, <AdminAnnouncements />) },
      { path: '/admin/content', element: protectedAdmin(ROLES_CONTENT, <Content />) },
      { path: '/admin/internal-files', element: protectedAdmin(ROLES_INTERNAL_FILES, <InternalFiles />) },
      { path: '/admin/budget', element: protectedAdmin(ROLES_BUDGET, <Budget />) },
      { path: '/admin/admins', element: protectedAdmin(ROLES_SUPER, <AdminUsers />) },
      { path: '/admin/audit', element: protectedAdmin(ROLES_SUPER, <Audit />) },
      { path: '/admin/security', element: protectedAdmin([], <Security />) },
      { path: '/admin/settings', element: protectedAdmin(ROLES_SUPER, <Settings />) },

      // Phase 28 — Fallback 404: أي مسار غير معرّف أعلاه (عام أو إداري) يعرض صفحة
      // 404 احترافية بدل شاشة بيضاء فارغة أو خطأ React Router.
      { path: '*', element: <NotFound /> },
    ],
  },
]);

