import { lazy, Suspense, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AdminLayout from '../../../../layouts/AdminLayout';
import AdminPageHeader from '../../../../components/admin/AdminPageHeader';
import StateBox from '../../../../components/admin/StateBox';
import { useAuth } from '../../../../app/providers/AuthProvider';
import { useCanManageGames } from '../hooks/useCanManageGames';
import { GAMES_ADMIN_TABS } from '../constants/gamesAdmin';
import '../../../../styles/games-admin.css';

const TAB_COMPONENTS = {
  games: lazy(() => import('./GamesTab')),
  categories: lazy(() => import('./CategoriesTab')),
  challenges: lazy(() => import('./ChallengesTab')),
  achievements: lazy(() => import('./AchievementsTab')),
  levels: lazy(() => import('./LevelsTab')),
  players: lazy(() => import('./PlayersTab')),
};

/**
 * لوحة إدارة الألعاب (المرحلة 3). المسار محمي بالدور في الراوتر (super_admin/developer)، والقرار الفعلي من الخادم:
 * can_manage_games() هنا للعرض فقط، وكل قراءة/كتابة تُرفض في RLS/RPC لغير المخوَّل حتى لو عُدِّلت الواجهة.
 */
export default function GamesAdmin() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const { phase, allowed, reload } = useCanManageGames(profile?.id);
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab = GAMES_ADMIN_TABS.includes(requested) ? requested : GAMES_ADMIN_TABS[0];
  const Tab = TAB_COMPONENTS[tab];

  useEffect(() => {
    document.title = `${t('games.admin.pageTitle')} — ${t('brand.name')}`;
  }, [t]);

  const onKey = (e) => {
    const i = GAMES_ADMIN_TABS.indexOf(tab);
    const dir = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!dir) return;
    const rtl = document.documentElement.dir === 'rtl';
    const next = GAMES_ADMIN_TABS[(i + (rtl ? -dir : dir) + GAMES_ADMIN_TABS.length) % GAMES_ADMIN_TABS.length];
    e.preventDefault();
    setParams({ tab: next }, { replace: true });
    requestAnimationFrame(() => document.getElementById(`ga-tab-${next}`)?.focus());
  };

  return (
    <AdminLayout>
      <AdminPageHeader title={t('games.admin.title')} subtitle={t('games.admin.subtitle')} />
      {phase === 'loading' && <StateBox state="loading" />}
      {phase === 'error' && <StateBox state="error" errorText={t('games.admin.loadError')} onRetry={reload} />}
      {phase === 'ready' && !allowed && (
        <div className="admin-state-box admin-state-error" role="alert">{t('games.admin.denied')}</div>
      )}
      {phase === 'ready' && allowed && (
        <>
          <div className="admin-tabs ga-tabs" role="tablist" aria-label={t('games.admin.title')} onKeyDown={onKey}>
            {GAMES_ADMIN_TABS.map((k) => (
              <button key={k} id={`ga-tab-${k}`} type="button" role="tab" aria-selected={tab === k} aria-controls="ga-panel" tabIndex={tab === k ? 0 : -1}
                className={`admin-tab-btn${tab === k ? ' active' : ''}`} onClick={() => setParams({ tab: k }, { replace: true })}>
                {t(`games.admin.tabs.${k}`)}
              </button>
            ))}
          </div>
          <div id="ga-panel" role="tabpanel" aria-labelledby={`ga-tab-${tab}`}>
            <Suspense fallback={<StateBox state="loading" />}>
              <Tab key={tab} />
            </Suspense>
          </div>
        </>
      )}
    </AdminLayout>
  );
}
