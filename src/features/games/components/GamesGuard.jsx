import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../app/providers/AuthProvider';
import ForcePasswordChange from '../../../components/admin/ForcePasswordChange';
import MemberAuthShell from '../../../components/member/MemberAuthShell';
import MemberSkeleton from '../../../components/member/MemberSkeleton';
import { useGamesAccess } from '../hooks/useGamesAccess';
import GamesAccessDenied from './GamesAccessDenied';

/**
 * حارس وحدة الألعاب. القرار من RPC get_games_access() (0049) وحدها: لا قائمة أدوار ولا منطق عضوية في الواجهة.
 * - لا جلسة → دخول المنخرطين. كلمة مرور مؤقتة → شاشة التغيير الإلزامي (كما في MemberLayout/ProtectedRoute).
 * - MFA مفعّلة ولم تُستوفَ → لا نستدعي الخادم؛ رسالة مع رابط شاشة الرمز.
 * - allowed=false أو ردّ غير مفهوم → رفض (fail closed). فشل الشبكة → «إعادة المحاولة» لا رفض خاطئ.
 * الواجهة ليست حدًّا أمنيًا؛ الحدّ الفعلي هو RLS/RPC عبر can_access_games() في المراحل التالية.
 */
export default function GamesGuard({ children }) {
  const { t } = useTranslation();
  const { status, session, profile, mfaRequired, logout } = useAuth();
  const location = useLocation();
  const userId = session?.user?.id || null;
  const mustChangePassword = profile?.must_change_password === true;
  const authed = status === 'authenticated';
  const skipRpc = !authed || mustChangePassword || mfaRequired;
  const { phase, access, reload } = useGamesAccess(userId, { enabled: !skipRpc });

  if (status === 'anonymous') return <Navigate to="/member/login" state={{ from: location }} replace />;
  if (status === 'loading') return <MemberSkeleton />;
  if (mustChangePassword) return <ForcePasswordChange />;
  if (mfaRequired) return <GamesAccessDenied reason="mfa_required" onLogout={() => logout()} />;
  if (phase === 'idle' || phase === 'loading') return <MemberSkeleton />;

  if (phase === 'error') {
    return (
      <MemberAuthShell title={t('games.access.errorTitle')} description={t('games.access.errorText')}>
        <button type="button" className="btn btn-gold ma-submit" onClick={reload}>{t('games.access.retry')}</button>
      </MemberAuthShell>
    );
  }

  if (access?.allowed !== true) return <GamesAccessDenied reason={access?.reason} onLogout={() => logout()} />;
  return children;
}
