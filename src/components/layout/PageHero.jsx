import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function PageHero({ crumbs, title, description }) {
  const { t } = useTranslation();
  return (
    <section className="page-hero">
      <div className="container">
        <div className="breadcrumbs">
          <Link to="/">{t('nav.home')}</Link>
          {crumbs.map((crumb) => (
            <span key={crumb.label} style={{ display: 'contents' }}>
              <span>‹</span>
              {crumb.href ? (
                <a href={crumb.href}>{crumb.label}</a>
              ) : (
                <span style={{ color: 'var(--gold)' }}>{crumb.label}</span>
              )}
            </span>
          ))}
        </div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </section>
  );
}
