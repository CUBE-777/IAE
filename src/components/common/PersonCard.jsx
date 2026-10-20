import { useTranslation } from 'react-i18next';
import { GraduationCap } from 'lucide-react';
import { getPersonDetails } from '../../utils/personDetails';

/**
 * بطاقة شخص — variant="member" (دليل الأعضاء) أو "board" (المكتب المسير).
 * الأعضاء: الصورة ← الجامعة (كبسولة بنفسجية تحتها) | الاسم ← الشارة ← المعلومات الثانوية.
 * المكتب: المنصب (هو العنوان البصري) ← الصورة ← الاسم ← الجامعة ← نبذة مختصرة.
 * النصوص الثابتة (labels) مترجمة؛ بيانات الأشخاص تُعرض كما هي من قاعدة البيانات.
 */
export default function PersonCard({ person, fallbackBadge, variant = 'member', featured = false, onOpen }) {
  const { t } = useTranslation();
  const name = person.name || t('person.defaultName');
  const university = (person.university || '').trim();
  const photoProps = {
    src: person.image || '/logo.jpg',
    alt: t('a11y.personPhotoAlt', { name }),
    loading: 'lazy',
    onError: (e) => {
      e.currentTarget.onerror = null;
      e.currentTarget.src = '/logo.jpg';
    },
  };

  if (variant === 'board') {
    const position = person.role || fallbackBadge;
    return (
      <article className={`board-card${featured ? ' board-card-featured' : ''}`}>
        <div className="board-card-position">
          <span className="sr-only">{t('person.boardPosition')}: </span>
          {position}
        </div>
        <div className="board-card-main">
          <img className="board-card-photo" {...photoProps} />
          <h3 className="board-card-name">{name}</h3>
          {university && (
            <span className="member-university board-card-university" title={t('person.fullUniversity', { name: university })}>
              {university}
            </span>
          )}
          {person.bio && <p className="board-card-bio">{person.bio}</p>}
        </div>
      </article>
    );
  }

  const badge = person.role || fallbackBadge;
  const hasDetails = !!onOpen && getPersonDetails(person).hasAny;
  const facts = [
    [t('person.age'), person.age],
    [t('person.promo'), person.promo],
    [t('person.track'), person.track],
    [t('person.profession'), person.profession],
  ].filter(([, value]) => value != null && String(value).trim() !== '');

  return (
    <article className="member-card">
      <div className="member-card-main">
        <div className="member-photo-column">
          <img className="member-photo" {...photoProps} />
          {university && (
            <span className="member-university member-university-under" title={t('person.fullUniversity', { name: university })}>
              <GraduationCap size={12} aria-hidden="true" />
              <span className="sr-only">{t('person.university')}: </span>
              {university}
            </span>
          )}
        </div>
        <div className="member-body">
          <div className="member-name-row">
            <h3>{name}</h3>
            <span className="member-badge">{badge}</span>
          </div>
          {facts.length > 0 && (
            <ul className="member-facts">
              {facts.map(([label, value]) => (
                <li key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </li>
              ))}
            </ul>
          )}
          {hasDetails && (
            <button type="button" className="member-more-btn" onClick={() => onOpen(person)}>
              {t('person.viewProfile')}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
