import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import '../../styles/not-found.css';
import '../../styles/projects.css';
import InteriorLayout from '../../layouts/InteriorLayout';
import PageHero from '../../components/layout/PageHero';
import { fetchProjectBySlug } from '../../services/supabase/projects.service';
import { localizeRow } from '../../utils/i18nContent';
import { safeUrl } from '../../utils/sanitize';
import { httpsUrlOrEmpty } from '../../utils/projects';
import { useDocumentMeta } from '../../hooks/useDocumentMeta';

const PROJECT_FIELDS = ['title', 'summary', 'description'];

export default function ProjectDetail() {
  const { t, i18n } = useTranslation();
  const { slug } = useParams();
  const lang = String(i18n.resolvedLanguage || i18n.language || 'ar').slice(0, 2);
  // status : loading | ok | notfound | error
  const [state, setState] = useState({ status: 'loading', item: null });

  const load = useCallback(() => {
    let alive = true;
    setState({ status: 'loading', item: null });
    fetchProjectBySlug(slug)
      .then((data) => alive && setState(data ? { status: 'ok', item: data } : { status: 'notfound', item: null }))
      .catch((err) => {
        console.error('Impossible de charger le projet :', err);
        if (alive) setState({ status: 'error', item: null });
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  useEffect(() => load(), [load]);

  const item = useMemo(() => localizeRow(state.item, lang, PROJECT_FIELDS), [state.item, lang]);

  useDocumentMeta(
    item ? `${item.title} — ${t('brand.name')}` : state.status === 'notfound' ? `${t('projects.notFoundTitle')} — ${t('brand.name')}` : undefined,
    item ? item.summary || (item.description || '').slice(0, 160) : undefined
  );

  if (state.status === 'notfound' || state.status === 'error') {
    const notFound = state.status === 'notfound';
    return (
      <InteriorLayout>
        <PageHero
          crumbs={[{ label: t('projects.crumb'), href: '/projects' }]}
          title={notFound ? t('projects.notFoundTitle') : t('common.loadError')}
          description=""
        />
        <section className="not-found-section">
          <div className="container not-found-content">
            {notFound && <p className="not-found-code">404</p>}
            {notFound && <p className="not-found-text">{t('projects.notFoundText')}</p>}
            <div className="not-found-actions">
              {!notFound && <button type="button" className="btn btn-gold" onClick={load}>{t('common.retry')}</button>}
              <Link to="/projects" className={`btn ${notFound ? 'btn-gold' : 'btn-ghost'}`}>{t('projects.back')}</Link>
            </div>
          </div>
        </section>
      </InteriorLayout>
    );
  }

  const loading = state.status === 'loading' || !item;
  const image = item ? safeUrl(item.image_url) : '';
  const github = item ? httpsUrlOrEmpty(item.github_url) : '';
  const demo = item ? httpsUrlOrEmpty(item.demo_url) : '';
  const tags = item && Array.isArray(item.technologies) ? item.technologies : [];
  const statusLabel = item?.status === 'completed' ? t('projects.statusCompleted') : t('projects.statusInProgress');

  return (
    <InteriorLayout>
      <PageHero
        crumbs={[{ label: t('projects.crumb'), href: '/projects' }, { label: loading ? t('projects.loadingTitle') : item.title }]}
        title={loading ? t('projects.loadingTitle') : item.title}
        description={loading ? '' : item.summary || ''}
      />
      <section className="project-detail">
        <div className="container">
          {loading ? (
            <div className="gallery-empty" role="status">{t('projects.loading')}</div>
          ) : (
            <div className="project-detail-layout">
              <div className="project-panel">
                {image && (
                  <div className="project-detail-cover">
                    <img src={image} alt={t('projects.coverAlt', { title: item.title })} />
                  </div>
                )}
                <h2>{t('projects.aboutTitle')}</h2>
                {/* Texte brut : affiché tel quel (pas de HTML), les retours à la ligne sont conservés par le CSS */}
                <div className="project-description">{item.description || item.summary || ''}</div>
              </div>

              <aside className="project-panel">
                <span className={`project-status is-${item.status}`}>{statusLabel}</span>
                {tags.length > 0 && (
                  <>
                    <h3 style={{ marginBlockStart: 16 }}>{t('projects.technologies')}</h3>
                    <ul className="project-tags">
                      {tags.map((tag) => <li className="project-tag" key={tag}>{tag}</li>)}
                    </ul>
                  </>
                )}
                {(github || demo) && (
                  <div className="project-links">
                    {github && (
                      <a className="project-link" href={github} target="_blank" rel="noopener noreferrer" aria-label={`${t('projects.github')} — ${t('projects.externalLink')}`}>
                        {t('projects.github')}
                      </a>
                    )}
                    {demo && (
                      <a className="project-link" href={demo} target="_blank" rel="noopener noreferrer" aria-label={`${t('projects.demo')} — ${t('projects.externalLink')}`}>
                        {t('projects.demo')}
                      </a>
                    )}
                  </div>
                )}
                <div className="project-links">
                  <Link to="/projects" className="project-link">{t('projects.back')}</Link>
                </div>
              </aside>
            </div>
          )}
        </div>
      </section>
    </InteriorLayout>
  );
}
