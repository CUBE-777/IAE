import { useTranslation } from 'react-i18next';
import { GraduationCap } from 'lucide-react';
import { getPersonDetails } from '../../utils/personDetails';

/**
 * بطاقة شخص واحدة لعضو النادي وعضو المكتب (نفس البنية والمقاسات في الصفحتين):
 * الصورة ← الجامعة (كبسولة بنفسجية تحتها) | الاسم ← الصفة ← المعلومات ← زر الملف.
 * عضو المكتب يتميّز بلون الشارة فقط (member-badge-board) وبرمز التمييز على الحافة.
 * النصوص الثابتة (labels) مترجمة؛ بيانات الأشخاص تُعرض كما هي من قاعدة البيانات.
 */
export default function PersonCard({ person, fallbackBadge, onOpen }) {
  const { t } = useTranslation();
  const name = person.name || t('person.defaultName');
  const university = (person.university || '').trim();
  const isBoard = !!person.isBoard;
  const badge = person.role || fallbackBadge;
  const hasDetails = !!onOpen && getPersonDetails(person).hasAny;
  const facts = [
    [t('person.age'), person.age],
    [t('person.promo'), person.promo],
    [t('person.track'), person.track],
    [t('person.profession'), person.profession],
  ].filter(([, value]) => value != null && String(value).trim() !== '');

  return (
    <article className={`member-card${isBoard ? ' member-card-board' : ''}`}>
      <div className="member-card-main">
        <div className="member-photo-column">
          <img
            className="member-photo"
            src={person.image || '/logo.jpg'}
            alt={t('a11y.personPhotoAlt', { name })}
            loading="lazy"
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = '/logo.jpg';
            }}
          />
          {university && (
            <span className="member-university member-university-under" title={t('person.fullUniversity', { name: university })}>
              <GraduationCap size={12} aria-hidden="true" />
              <span className="sr-only">{t('person.university')}: </span>
              {university}
            </span>
          )}
        </div>
        <div className="member-body">
          <h3>{name}</h3>
          <div className="member-badge-row">
            {isBoard && <span className="sr-only">{t('person.boardPosition')}: </span>}
            <span className={`member-badge${isBoard ? ' member-badge-board' : ''}`}>{badge}</span>
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
