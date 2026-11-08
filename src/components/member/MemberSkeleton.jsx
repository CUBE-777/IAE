import { useTranslation } from 'react-i18next';
import '../../styles/member-shell.css';

/** هيكل تحميل لفضاء المنخرط (بدل جملة «جارٍ التحميل»): يحاكي بطاقة الترحيب وبطاقتين. */
export default function MemberSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="ms-wrap">
      <div className="ms ms-skel" role="status" aria-busy="true" aria-label={t('member.loading')}>
        <aside className="ms-side"><div className="sk sk-line" /><div className="sk sk-line" /><div className="sk sk-line" /></aside>
        <div className="ms-main">
          <div className="sk sk-title" />
          <div className="sk sk-hero" />
          <div className="sk sk-card" />
          <div className="sk sk-card" />
        </div>
      </div>
    </div>
  );
}
