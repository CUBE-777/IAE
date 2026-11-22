import { Link, NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Gamepad2 } from 'lucide-react';
import InteriorLayout from '../../../layouts/InteriorLayout';
import { useAuth } from '../../../app/providers/AuthProvider';
import { useNoindex } from '../../../hooks/useNoindex';
import GamesGuard from '../components/GamesGuard';
import GamesMaintenance from '../components/GamesMaintenance';
import MemberAuthShell from '../../../components/member/MemberAuthShell';
import MemberSkeleton from '../../../components/member/MemberSkeleton';
import { useGamesSectionStatus } from '../maintenance/useGamesSectionStatus';
import { GAMES_PATHS } from '../constants/games';
import '../../../styles/games.css';
import '../../../styles/games-player.css';
import '../../../styles/games-gamified.css';

/**
 * غلاف وحدة الألعاب: رأس/تذييل الموقع الداخليان (اللغات AR/FR/EN وRTL والداكن/الفاتح) + الحارس + إطار الألعاب.
 * رابط العودة يتبع نوع الحساب: إداري → اللوحة، وإلا فضاء المنخرطين. المراحل اللاحقة تضيف تنقل الألعاب هنا.
 *
 * وضع الصيانة (0062): هذا الغلاف يلفّ كل مسارات /games/* (الرئيسية، g/:slug، c/:challengeId، المسارات، الملف، المتصدرون)،
 * فالفحص هنا يحمي الروابط المباشرة لا الروابط المخفية فقط. أثناء الصيانة تُعرض صفحة الصيانة بدل الصفحة المطلوبة (وبدل حارس الدخول)،
 * ولا تُحمَّل بيانات الألعاب. الحدّ الأمني الفعلي على الخادم: can_access_games() ترفض كل RLS/RPC اللاعب أثناء الصيانة.
 * فشل جلب الحالة (ولا حالة معروفة) ⇒ «إعادة المحاولة» لا فتح الألعاب ولا ادّعاء الصيانة.
 */
export default function GamesLayout() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const isAdmin = profile?.is_active === true;
  const { phase, isMaintenance, retry } = useGamesSectionStatus();
  useNoindex();

  if (phase !== 'ready') {
    return (
      <InteriorLayout>
        {phase === 'error' ? (
          <MemberAuthShell title={t('games.maintenance.statusErrorTitle')} description={t('games.access.errorText')}>
            <button type="button" className="btn btn-gold ma-submit" onClick={retry}>{t('games.access.retry')}</button>
          </MemberAuthShell>
        ) : (
          <MemberSkeleton />
        )}
      </InteriorLayout>
    );
  }

  if (isMaintenance) {
    return (
      <InteriorLayout>
        <GamesMaintenance />
      </InteriorLayout>
    );
  }

  return (
    <InteriorLayout>
      <GamesGuard>
        <div className="games-wrap">
          <div className="games-shell">
            <nav className="games-bar" aria-label={t('games.shell.label')}>
              <span className="games-brand"><Gamepad2 size={20} aria-hidden="true" />{t('games.brand')}</span>
              <div className="games-links">
                <NavLink end to={GAMES_PATHS.home}>{t('games.play.nav.home')}</NavLink>
                <NavLink to={GAMES_PATHS.paths}>{t('games.play.nav.paths')}</NavLink>
                <NavLink to={GAMES_PATHS.profile}>{t('games.play.nav.profile')}</NavLink>
                <NavLink to={GAMES_PATHS.leaderboard}>{t('games.play.nav.leaderboard')}</NavLink>
              </div>
              <Link className="games-back" to={isAdmin ? '/admin/dashboard' : '/member'}>
                {isAdmin ? t('games.shell.backAdmin') : t('games.shell.backMember')}
              </Link>
            </nav>
            <main className="games-main"><Outlet /></main>
          </div>
        </div>
      </GamesGuard>
    </InteriorLayout>
  );
}
