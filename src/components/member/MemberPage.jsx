import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageHero from '../layout/PageHero';
import { useAuth } from '../../app/providers/AuthProvider';
import { useNoindex } from '../../hooks/useNoindex';

/** هيكل صفحات العضو: عنوان + شريط تنقل (يكبر في المراحل اللاحقة: QR، حضور، إعلانات…) + محتوى. */
export default function MemberPage({ titleKey, descriptionKey, pageTitleKey, children }) {
  const { t } = useTranslation();
  const { logout } = useAuth();
  useNoindex();
  useEffect(() => {
    document.title = `${t(pageTitleKey)} — ${t('brand.name')}`;
  }, [t, pageTitleKey]);

  return (
    <>
      <PageHero crumbs={[{ label: t('member.crumb') }]} title={t(titleKey)} description={t(descriptionKey)} />
      <nav className="member-nav" aria-label={t('member.nav.label')}>
        <NavLink to="/member" end>{t('member.nav.home')}</NavLink>
        <NavLink to="/member/card">{t('member.nav.card')}</NavLink>
        <button type="button" onClick={() => logout()}>{t('member.nav.logout')}</button>
      </nav>
      <section className="mf-section">
        <div className="container">{children}</div>
      </section>
    </>
  );
}
