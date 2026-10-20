import { createBrowserRouter } from 'react-router-dom';
import Home from '../../pages/public/Home';
import Members from '../../pages/public/Members';
import Board from '../../pages/public/Board';
import Activity from '../../pages/public/Activity';
import PublicAnnouncements from '../../pages/public/Announcements';
import AnnouncementDetail from '../../pages/public/AnnouncementDetail';
import ThankYou from '../../pages/public/ThankYou';
import NotFound from '../../pages/public/NotFound';
import Login from '../../pages/admin/Login';
import Dashboard from '../../pages/admin/Dashboard';
import Requests from '../../pages/admin/Requests';
import AdminMembers from '../../pages/admin/Members';
import AdminBoard from '../../pages/admin/Board';
import Activities from '../../pages/admin/Activities';
import Gallery from '../../pages/admin/Gallery';
import AdminAnnouncements from '../../pages/admin/Announcements';
import Content from '../../pages/admin/Content';
import AdminUsers from '../../pages/admin/AdminUsers';
import Audit from '../../pages/admin/Audit';
import Settings from '../../pages/admin/Settings';
import Budget from '../../pages/admin/Budget';
import ProtectedRoute from '../../components/admin/ProtectedRoute';

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

export const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/members', element: <Members /> },
  { path: '/board', element: <Board /> },
  { path: '/activity/:slug', element: <Activity /> },
  { path: '/announcements', element: <PublicAnnouncements /> },
  { path: '/announcement/:slug', element: <AnnouncementDetail /> },
  // مرادف لنفس الصفحة (يتبع الصيغة الجمعية أيضًا) — بدون إعادة توجيه حتى يعمل أي رابط مشارَك
  { path: '/announcements/:slug', element: <AnnouncementDetail /> },
  { path: '/thank-you', element: <ThankYou /> },

  { path: '/admin/login', element: <Login /> },
  { path: '/admin/dashboard', element: protectedAdmin([], <Dashboard />) },
  { path: '/admin/members', element: protectedAdmin(['developer', 'super_admin', 'members_manager'], <AdminMembers />) },
  { path: '/admin/requests', element: protectedAdmin(['developer', 'super_admin', 'members_manager'], <Requests />) },
  { path: '/admin/board', element: protectedAdmin(['developer', 'super_admin', 'editor'], <AdminBoard />) },
  { path: '/admin/activities', element: protectedAdmin(['developer', 'super_admin', 'editor'], <Activities />) },
  { path: '/admin/gallery', element: protectedAdmin(['developer', 'super_admin', 'editor'], <Gallery />) },
  { path: '/admin/announcements', element: protectedAdmin(['developer', 'super_admin', 'editor'], <AdminAnnouncements />) },
  { path: '/admin/content', element: protectedAdmin(['developer', 'super_admin', 'editor'], <Content />) },
  { path: '/admin/budget', element: protectedAdmin(['developer', 'super_admin', 'treasurer'], <Budget />) },
  { path: '/admin/admins', element: protectedAdmin(['developer', 'super_admin'], <AdminUsers />) },
  { path: '/admin/audit', element: protectedAdmin(['developer', 'super_admin'], <Audit />) },
  { path: '/admin/settings', element: protectedAdmin(['developer', 'super_admin'], <Settings />) },

  // Phase 28 — Fallback 404: أي مسار غير معرّف أعلاه (عام أو إداري) يعرض صفحة
  // 404 احترافية بدل شاشة بيضاء فارغة أو خطأ React Router.
  { path: '*', element: <NotFound /> },
]);

