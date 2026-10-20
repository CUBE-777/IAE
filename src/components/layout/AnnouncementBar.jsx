import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { safeUrl } from '../../utils/sanitize';
import { localizeAnnouncement } from '../../utils/i18nContent';

export default function AnnouncementBar({ announcement }) {
  const { t, i18n } = useTranslation();
  const [closed, setClosed] = useState(false);
  if (!announcement || closed) return null;

  const a = localizeAnnouncement(announcement, i18n.language);
  // الرابط الخارجي المحدد أولاً؛ وإلا صفحة تفاصيل الإعلان إن كان له محتوى/مقتطف
  const external = safeUrl(a.link);
  const hasDetails = Boolean(a.slug && (a.content || a.excerpt));

  return (
    <div id="announcementBar" className="announcement-bar" role="region" aria-label={t('announcements.sectionLabel')}>
      <span>{a.title || a.text}</span>
      {external ? (
        <a href={external} className="announcement-bar-link">{t('common.detailsLink')}</a>
      ) : (
        hasDetails && (
          <Link to={`/announcement/${encodeURIComponent(a.slug)}`} className="announcement-bar-link">
            {t('common.detailsLink')}
          </Link>
        )
      )}
      <button
        type="button"
        aria-label={t('common.closeAnnouncement')}
        className="announcement-bar-close"
        onClick={() => setClosed(true)}
      >
        ×
      </button>
    </div>
  );
}
