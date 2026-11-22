import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Wrench } from 'lucide-react';
import { useAuth } from '../../../app/providers/AuthProvider';
import { ROLES_SUPER } from '../../../constants/roles';
import { useGamesSectionStatus } from '../maintenance/useGamesSectionStatus';
import GamesMaintenanceArt from './GamesMaintenanceArt';
import '../../../styles/games.css';
import '../../../styles/games-maintenance.css';

/**
 * صفحة صيانة قسم الألعاب. تُعرض داخل InteriorLayout (رأس/تذييل الموقع الداخليان) فتحافظ على الهوية واللغات AR/FR/EN وRTL/LTR.
 * لا تكشف شيئًا من بيانات الألعاب ولا تتطلب جلسة. عند انتهاء الصيانة يستبدلها GamesLayout تلقائيًا (Realtime/مؤقّت).
 * إداريّو super_admin/developer يرون تنبيهًا ورابطًا إلى إدارة الألعاب (لا تزال تعمل أثناء الصيانة).
 */
export default function GamesMaintenance() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const { refresh } = useGamesSectionStatus();
  const [checking, setChecking] = useState(false);
  const canManage = profile?.is_active === true && ROLES_SUPER.includes(profile?.role);

  useEffect(() => {
    document.title = `${t('games.maintenance.title')} — ${t('brand.name')}`;
  }, [t]);

  const recheck = async () => {
    setChecking(true);
    try {
      await refresh();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="games-wrap games-maint-wrap">
      <div className="games-shell">
        <main className="games-maint" aria-labelledby="games-maint-title">
          <div className="games-maint-art"><GamesMaintenanceArt label={t('games.maintenance.illustration')} /></div>
          <span className="games-maint-badge"><Wrench size={14} aria-hidden="true" />{t('games.maintenance.badge')}</span>
          <h1 id="games-maint-title">{t('games.maintenance.title')}</h1>
          <p className="games-maint-text" role="status">{t('games.maintenance.text')}</p>
          <p className="games-maint-reassure">{t('games.maintenance.reassure')}</p>
          <div className="games-maint-actions">
            <Link className="btn btn-gold" to="/">{t('games.maintenance.actionHome')}</Link>
            <button type="button" className="btn btn-ghost" onClick={recheck} disabled={checking} aria-busy={checking}>
              {checking ? t('games.maintenance.checking') : t('games.maintenance.actionCheck')}
            </button>
          </div>
          {canManage && (
            <aside className="games-maint-admin">
              <p>{t('games.maintenance.adminNote')}</p>
              <Link className="games-back" to="/admin/games">{t('games.maintenance.adminAction')}</Link>
            </aside>
          )}
        </main>
      </div>
    </div>
  );
}
