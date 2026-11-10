import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import MemberAuthShell from '../../../components/member/MemberAuthShell';
import { GAMES_UNKNOWN_REASON } from '../constants/games';

/** إجراء رئيسي بحسب السبب: MFA → شاشة الرمز، كلمة مرور مؤقتة → اللوحة (تعرض شاشة التغيير)، وإلا الرئيسية. */
const ACTIONS = {
  mfa_required: { to: '/admin/login', key: 'games.denied.actionVerify' },
  password_change_required: { to: '/admin/dashboard', key: 'games.denied.actionPassword' },
};

export default function GamesAccessDenied({ reason, onLogout }) {
  const { t } = useTranslation();
  const key = reason || GAMES_UNKNOWN_REASON;
  const action = ACTIONS[key] || { to: '/', key: 'games.denied.actionHome' };
  return (
    <MemberAuthShell title={t('games.denied.title')} description={t(`games.denied.reasons.${key}`)}>
      <div className="ma-form">
        <Link className="btn btn-gold ma-submit" to={action.to}>{t(action.key)}</Link>
        <button type="button" className="btn btn-ghost ma-submit" onClick={onLogout}>{t('games.denied.logout')}</button>
      </div>
    </MemberAuthShell>
  );
}
