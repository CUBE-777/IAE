import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '../../styles/projects.css';
import InteriorLayout from '../../layouts/InteriorLayout';
import PageHero from '../../components/layout/PageHero';
import ProjectCard from '../../components/projects/ProjectCard';
import { fetchPublishedProjects } from '../../services/supabase/projects.service';
import { localizeRow } from '../../utils/i18nContent';
import { normalizeSearchValue } from '../../utils/arabicSearch';

const PROJECT_FIELDS = ['title', 'summary', 'description'];

export default function Projects() {
  const { t, i18n } = useTranslation();
  const lang = String(i18n.resolvedLanguage || i18n.language || 'ar').slice(0, 2);
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [tech, setTech] = useState('');

  const load = useCallback(() => {
    let alive = true;
    setProjects(null);
    setError(false);
    fetchPublishedProjects()
      .then((data) => alive && setProjects(data))
      .catch((err) => {
        console.error('Impossible de charger les projets :', err);
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => load(), [load]);

  useEffect(() => {
    document.title = `${t('projects.pageTitle')} — ${t('brand.name')}`;
  }, [t]);

  const localized = useMemo(() => (projects || []).map((p) => localizeRow(p, lang, PROJECT_FIELDS)), [projects, lang]);

  // Technologies proposées = celles réellement présentes dans les projets publiés
  const technologies = useMemo(() => {
    const set = new Map();
    localized.forEach((p) => (p.technologies || []).forEach((x) => set.has(x.toLowerCase()) || set.set(x.toLowerCase(), x)));
    return [...set.values()].sort((a, b) => a.localeCompare(b));
  }, [localized]);

  const filtered = useMemo(() => {
    const q = normalizeSearchValue(query);
    return localized.filter((p) => {
      if (status !== 'all' && p.status !== status) return false;
      if (tech && !(p.technologies || []).some((x) => x.toLowerCase() === tech.toLowerCase())) return false;
      if (!q) return true;
      const hay = normalizeSearchValue([p.title, p.summary, ...(p.technologies || [])].join(' '));
      return hay.includes(q);
    });
  }, [localized, query, status, tech]);

  const hasData = projects && projects.length > 0;
  const filtersActive = query || status !== 'all' || tech;

  return (
    <InteriorLayout>
      <PageHero
        crumbs={[{ label: t('projects.crumb') }]}
        title={t('projects.pageTitle')}
        description={t('projects.pageDescription')}
      />
      <section className="projects-page">
        <div className="container">
          {hasData && (
            <>
              <div className="projects-toolbar" role="search">
                <label className="sr-only" htmlFor="projectSearch">{t('projects.searchPlaceholder')}</label>
                <input
                  id="projectSearch"
                  className="people-search"
                  type="search"
                  autoComplete="off"
                  placeholder={t('projects.searchPlaceholder')}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <span className="people-count" aria-live="polite">
                  {filtersActive
                    ? t('projects.resultsCount', { count: filtered.length, total: projects.length })
                    : `${projects.length} ${t('projects.countLabel')}`}
                </span>
              </div>

              <div className="projects-filters" role="group" aria-label={t('projects.filterStatus')}>
                <span className="projects-filters-label">{t('projects.filterStatus')}</span>
                {[['all', t('projects.all')], ['in_progress', t('projects.statusInProgress')], ['completed', t('projects.statusCompleted')]].map(([value, label]) => (
                  <button key={value} type="button" className="filter-chip" aria-pressed={status === value} onClick={() => setStatus(value)}>
                    {label}
                  </button>
                ))}
              </div>

              {technologies.length > 0 && (
                <div className="projects-filters" role="group" aria-label={t('projects.filterTech')}>
                  <span className="projects-filters-label">{t('projects.filterTech')}</span>
                  <button type="button" className="filter-chip" aria-pressed={tech === ''} onClick={() => setTech('')}>
                    {t('projects.allTech')}
                  </button>
                  {technologies.map((x) => (
                    <button key={x} type="button" className="filter-chip" dir="ltr" aria-pressed={tech === x} onClick={() => setTech(tech === x ? '' : x)}>
                      {x}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {projects === null && !error && <div className="gallery-empty" role="status">{t('projects.loading')}</div>}
          {error && (
            <div className="gallery-empty" role="alert">
              <p>{t('common.loadError')}</p>
              <button type="button" className="interior-btn people-retry" onClick={load}>{t('common.retry')}</button>
            </div>
          )}
          {projects && projects.length === 0 && <div className="gallery-empty">{t('projects.empty')}</div>}
          {hasData && filtered.length === 0 && <div className="gallery-empty">{t('projects.noResults')}</div>}

          {filtered.length > 0 && (
            <div className="project-grid">
              {filtered.map((p) => <ProjectCard key={p.id} project={p} />)}
            </div>
          )}
        </div>
      </section>
    </InteriorLayout>
  );
}
