import { useTranslation } from 'react-i18next';

export default function Footer({ brandName, copyright }) {
  const { t } = useTranslation();

  return (
    <footer>
      <div className="container">
        <div className="brand">
          <img src="/logo.jpg" alt={t('a11y.logoAlt')} style={{ width: 38, height: 38, borderRadius: 8 }} />
          <div className="brand-text" style={{ color: 'var(--white)' }}>
            {brandName || t('brand.name')}
          </div>
        </div>
        <div className="foot-links">
          <a href="#about">{t('nav.about')}</a>
          <a href="#activities">{t('nav.activities')}</a>
          <a href="#members">{t('nav.members')}</a>
          <a href="#join">{t('nav.join')}</a>
          <a href="#contact">{t('nav.contact')}</a>
        </div>
        <div className="copyright">{copyright || t('footer.copyright')}</div>
      </div>
    </footer>
  );
}
