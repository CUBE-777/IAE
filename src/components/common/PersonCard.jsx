import { useTranslation } from 'react-i18next';
import { GraduationCap } from 'lucide-react';
import { getPersonDetails } from '../../utils/personDetails';
import { DEFAULT_LIST_CONFIG, applyModalConfig, cardClassNames } from '../../utils/peopleCardConfig';

/**
 * بطاقة شخص واحدة لعضو النادي وعضو المكتب (نفس البنية والمقاسات في الصفحتين):
 * الصورة ← الجامعة (كبسولة بنفسجية تحتها) | الاسم ← الصفة ← المعلومات ← زر الملف.
 * عضو المكتب يتميّز بلون الشارة فقط (member-badge-board) وبرمز التمييز على الحافة.
 * النصوص الثابتة (labels) مترجمة؛ بيانات الأشخاص تُعرض كما هي من قاعدة البيانات.
 *
 * `config` (اختياري) = إعدادات القائمة { card, modal } من لوحة الإدارة (utils/peopleCardConfig).
 * بدونها يظهر الشكل الافتراضي المعتاد.
 */
export default function PersonCard({ person, fallbackBadge, onOpen, config }) {
  const { t } = useTranslation();
  const cfg = (config && config.card) || DEFAULT_LIST_CONFIG.card;
  const modalCfg = (config && config.modal) || DEFAULT_LIST_CONFIG.modal;
  const name = person.name || t('person.defaultName');
  const university = cfg.showUniversity ? (person.university || '').trim() : '';
  const isBoard = !!person.isBoard;
  const boardStyle = isBoard && cfg.highlightBoard;
  const badge = person.role || fallbackBadge;
  const hasDetails = cfg.showProfileButton && !!onOpen && applyModalConfig(getPersonDetails(person), modalCfg).hasAny;
  const facts = [
    [t('person.age'), person.age],
    cfg.showPromo && [t('person.promo'), person.promo],
    cfg.showTrack && [t('person.track'), person.track],
    cfg.showProfession && [t('person.profession'), person.profession],
  ].filter((f) => f && f[1] != null && String(f[1]).trim() !== '');

  const universityPill = university && (
    <span className="member-university member-university-under" title={t('person.fullUniversity', { name: university })}>
      <GraduationCap size={12} aria-hidden="true" />
      <span className="sr-only">{t('person.university')}: </span>
      {university}
    </span>
  );

  const classes = ['member-card', boardStyle ? 'member-card-board' : '', ...cardClassNames(cfg)].filter(Boolean).join(' ');

  return (
    <article className={classes}>
      <div className="member-card-main">
        {cfg.showPhoto && (
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
            {universityPill}
          </div>
        )}
        <div className="member-body">
          <h3>{name}</h3>
          {(cfg.showBadge || isBoard) && (
            <div className="member-badge-row">
              {isBoard && <span className="sr-only">{t('person.boardPosition')}: </span>}
              {cfg.showBadge && <span className={`member-badge${boardStyle ? ' member-badge-board' : ''}`}>{badge}</span>}
            </div>
          )}
          {/* بلا صورة: تنتقل كبسولة الجامعة إلى جسم البطاقة بدل أن تختفي */}
          {!cfg.showPhoto && universityPill}
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
