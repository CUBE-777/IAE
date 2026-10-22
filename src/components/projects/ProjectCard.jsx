import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { safeUrl } from '../../utils/sanitize';

const MAX_TAGS = 4;

/** Carte de projet (liste /projects et section d'accueil). `project` est déjà localisé. */
export default function ProjectCard({ project }) {
  const { t } = useTranslation();
  const image = safeUrl(project.image_url);
  const tags = Array.isArray(project.technologies) ? project.technologies : [];
  const statusLabel = project.status === 'completed' ? t('projects.statusCompleted') : t('projects.statusInProgress');
  const href = `/projects/${encodeURIComponent(project.slug)}`;

  return (
    <article className="project-card">
      {image && (
        <div className="project-cover">
          <img src={image} alt={t('projects.coverAlt', { title: project.title })} loading="lazy" />
        </div>
      )}
      <div className="project-body">
        <span className={`project-status is-${project.status}`}>{statusLabel}</span>
        <h3>{project.title}</h3>
        {project.summary && <p>{project.summary}</p>}
        {tags.length > 0 && (
          <ul className="project-tags" aria-label={t('projects.technologies')}>
            {tags.slice(0, MAX_TAGS).map((tag) => (
              <li className="project-tag" key={tag}>{tag}</li>
            ))}
            {tags.length > MAX_TAGS && <li className="project-tag">+{tags.length - MAX_TAGS}</li>}
          </ul>
        )}
        <div className="project-card-actions">
          <Link to={href} className="project-link" aria-label={`${t('projects.viewDetails')}: ${project.title}`}>
            {t('projects.viewDetails')}
          </Link>
        </div>
      </div>
    </article>
  );
}
