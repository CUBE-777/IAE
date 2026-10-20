import { Link } from 'react-router-dom';
import { Pin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { announcementDate, formatDate, localizeAnnouncement } from '../../utils/i18nContent';
import { safeUrl } from '../../utils/sanitize';

/**
 * بطاقة إعلان واحدة (Badge → عنوان → تاريخ → مقتطف → CTA).
 * تُستعمل في لوحة الصفحة الرئيسية وصفحة جميع الإعلانات ومعاينة الإدارة.
 * `preview` يعطّل الرابط (للمعاينة قبل النشر).
 */
export default function AnnouncementCard({ announcement, variant = 'list', preview = false }) {
  const { t, i18n } = useTranslation();
  const a = localizeAnnouncement(announcement, i18n.language);
  const date = formatDate(announcementDate(a), i18n.language);
  const img = safeUrl(a.image_url);
  const type = a.type || 'general';
  const href = `/announcement/${encodeURIComponent(a.slug || '')}`;
  const excerpt = a.excerpt || (a.content ? a.content.slice(0, 160) : '');

  const body = (
    <>
      {img && variant === 'list' && (
        <div className="ann-card-media">
          <img src={img} alt="" loading="lazy" />
        </div>
      )}
      <div className="ann-card-body">
        <div className="ann-card-badges">
          <span className={`ann-badge ann-badge-${type}`}>{t(`announcements.types.${type}`)}</span>
          {a.is_pinned && (
            <span className="ann-pinned">
              <Pin size={13} aria-hidden="true" /> {t('announcements.pinned')}
            </span>
          )}
        </div>
        <h3 className="ann-card-title">{a.title}</h3>
        {date && <time className="ann-card-date" dateTime={String(announcementDate(a))}>{date}</time>}
        {excerpt && <p className="ann-card-excerpt">{excerpt}</p>}
        <span className="ann-card-cta">{t('announcements.readMore')} <span aria-hidden="true" className="ann-arrow">←</span></span>
      </div>
    </>
  );

  if (preview) return <article className={`ann-card ann-card-${variant}`}>{body}</article>;

  return (
    <article className={`ann-card ann-card-${variant}`}>
      <Link to={href} className="ann-card-link" aria-label={`${a.title} — ${t('announcements.readMore')}`}>
        {body}
      </Link>
    </article>
  );
}
