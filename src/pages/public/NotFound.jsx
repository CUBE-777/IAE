import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import '../../styles/public-home.css';
import '../../styles/interior-page.css';
import '../../styles/not-found.css';
import InteriorHeader from '../../components/layout/InteriorHeader';
import InteriorFooter from '../../components/layout/InteriorFooter';

/**
 * src/pages/public/NotFound.jsx
 * صفحة 404 — تُعرض عبر مسار catch-all (`*`) في الراوتر لأي رابط غير موجود.
 * تتبع نفس لغة تصميم الصفحات الداخلية (Hero + breadcrumbs) بدل شاشة بيضاء فارغة.
 */
export default function NotFound() {
  const { t } = useTranslation();

  // Netlify يردّ بـ200 على أي مسار (SPA fallback) → نمنع فهرسة صفحة 404 (soft-404).
  useEffect(() => {
    let meta = document.querySelector('meta[name="robots"]');
    const created = !meta;
    const previous = meta ? meta.getAttribute('content') : null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'robots');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', 'noindex');
    return () => {
      if (created) meta.remove();
      else if (previous != null) meta.setAttribute('content', previous);
    };
  }, []);

  return (
    <>
      <InteriorHeader />

      <section className="activity-hero not-found-hero">
        <div className="container">
          <div className="breadcrumbs">
            <Link to="/">{t('nav.home')}</Link>
            <span>‹</span>
            <span style={{ color: 'var(--gold)' }}>{t('notFound.crumb')}</span>
          </div>

          <h1>{t('notFound.heroTitle')}</h1>
        </div>
      </section>

      <section className="not-found-section">
        <div className="container not-found-content">
          <p className="not-found-code">404</p>
          <h2>{t('notFound.title')}</h2>
          <p className="not-found-text">{t('notFound.message')}</p>
          <div className="not-found-actions">
            <Link to="/" className="btn btn-gold">
              {t('notFound.backHome')}
            </Link>
            <Link to="/members" className="btn btn-ghost">
              {t('notFound.browseMembers')}
            </Link>
          </div>
        </div>
      </section>

      <InteriorFooter />
    </>
  );
}
