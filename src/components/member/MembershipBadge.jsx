import { AlertTriangle, Check, HelpCircle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { membershipState } from '../../utils/memberCardToken';
import '../../styles/member-card.css';

const ICONS = { active: Check, lapsed: AlertTriangle, none: X, unset: HelpCircle };

/**
 * شارة انخراط العضو للموسم الحالي: أيقونة + نص + لون (لا نعتمد على اللون وحده).
 * status: undefined = جارٍ التحميل | null/كائن get_my_membership_status. failed: تعذّر التحميل.
 */
export default function MembershipBadge({ status, failed = false, onRetry }) {
  const { t } = useTranslation();
  if (status === undefined && !failed) return <p className="mf-hint member-id-status-loading">{t('member.id.badge.loading')}</p>;
  if (status === undefined && failed) {
    return (
      <p className="mf-hint" role="alert">
        {t('member.id.badge.error')}{' '}
        {onRetry && <button type="button" className="member-link-btn" onClick={onRetry}>{t('member.home.retry')}</button>}
      </p>
    );
  }
  const state = membershipState(status);
  const Icon = ICONS[state];
  const season = status?.season;
  return (
    <p className={`member-membership member-membership-${state}`}>
      <Icon size={18} aria-hidden="true" focusable="false" />
      <span>{t(`member.id.badge.${state}`, { season })}</span>
    </p>
  );
}
