import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { useInstallState } from '../../hooks/useAdminPwa';
import { promptInstall } from '../../utils/pwaInstall';

/**
 * زر تثبيت لوحة الإدارة كتطبيق. يظهر فقط عند الإمكان:
 *  - أندرويد/كروم/إيدج: يفتح نافذة التثبيت الأصلية.
 *  - iOS (سفاري): لا يوجد API، فنعرض إرشاد «إضافة إلى الشاشة الرئيسية».
 *  - يختفي إن كان التطبيق مثبّتًا/يعمل أصلًا بوضع standalone.
 */
export default function InstallAppButton({ className = '' }) {
  const { t } = useTranslation();
  const { canPrompt, installed, ios } = useInstallState();
  const [showHint, setShowHint] = useState(false);

  if (installed || (!canPrompt && !ios)) return null;

  const onClick = () => {
    if (canPrompt) promptInstall();
    else setShowHint((v) => !v);
  };

  return (
    <div className={`admin-install ${className}`.trim()}>
      <button type="button" className="admin-install-btn" onClick={onClick} aria-expanded={canPrompt ? undefined : showHint}>
        <Download size={14} aria-hidden="true" />
        <span>{t('admin.layout.installApp')}</span>
      </button>
      {!canPrompt && showHint && <p className="admin-install-hint">{t('admin.layout.installIosHint')}</p>}
    </div>
  );
}
