import { useTranslation } from 'react-i18next';

export default function InteriorFooter() {
  const { t } = useTranslation();
  return (
    <footer className="interior-footer">
      <div className="container">
        <div className="brand">
          <img src="/logo.jpg" alt={t('a11y.logoAlt')} style={{ width: 38, height: 38, borderRadius: 8 }} />
          <div className="brand-text" style={{ color: 'var(--white)' }}>
            {t('brand.name')}
          </div>
        </div>
        <div className="interior-copyright">{t('footer.copyright')}</div>
      </div>
    </footer>
  );
}
