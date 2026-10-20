import { useTranslation } from 'react-i18next';

export default function StatusBadge({ status }) {
  const { t } = useTranslation();
  return <span className={`admin-badge admin-badge-${status}`}>{t(`admin.status.${status}`, { defaultValue: status })}</span>;
}
