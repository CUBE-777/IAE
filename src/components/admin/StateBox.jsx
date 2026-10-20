import { useTranslation } from 'react-i18next';

/**
 * حالة موحّدة لقوائم الإدارة: loading | error (مع إعادة محاولة) | empty.
 * الفرق بين "لا سجلات" و"تعذر التحميل" يبقى واضحًا دائمًا.
 */
export default function StateBox({ state, emptyText, errorText, onRetry }) {
  const { t } = useTranslation();
  if (state === 'loading') return <div className="admin-state-box" role="status">{t('admin.common.loading')}</div>;
  if (state === 'error') {
    return (
      <div className="admin-state-box admin-state-error" role="alert">
        <span>{errorText || t('admin.common.loadError')}</span>
        {onRetry && (
          <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={onRetry}>
            {t('admin.common.retry')}
          </button>
        )}
      </div>
    );
  }
  if (state === 'empty') return <div className="admin-state-box">{emptyText}</div>;
  return null;
}
