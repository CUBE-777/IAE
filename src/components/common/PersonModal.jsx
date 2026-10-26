import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  GraduationCap, Instagram, Facebook, Linkedin, Youtube, Twitter, Github, Globe, Music2, X,
} from 'lucide-react';
import { getPersonDetails } from '../../utils/personDetails';

// أيقونة لكل منصة؛ منصة جديدة بلا أيقونة تأخذ أيقونة الموقع العامة تلقائيًا.
const SOCIAL_ICONS = {
  instagram: Instagram, facebook: Facebook, linkedin: Linkedin, tiktok: Music2,
  youtube: Youtube, x: Twitter, github: Github, website: Globe,
};

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * نافذة الملف العام للعضو: نبذة، مسار دراسي، معلومات إضافية، وروابط التواصل.
 * تُرسم عبر portal في body حتى لا يؤثر عليها transform بطاقة العضو.
 * إتاحة: role=dialog، Escape، النقر خارجها، حبس التركيز، وإعادته لزر الفتح.
 */
export default function PersonModal({ person, fallbackBadge, onClose }) {
  const { t } = useTranslation();
  const boxRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  onCloseRef.current = onClose;
  const details = getPersonDetails(person);
  const name = person.name || t('person.defaultName');
  const university = (person.university || '').trim();
  const badge = person.role || fallbackBadge;

  useEffect(() => {
    const box = boxRef.current;
    const previouslyFocused = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    box.querySelector('.person-modal-close')?.focus({ preventScroll: true });

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = Array.from(box.querySelectorAll(FOCUSABLE));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus({ preventScroll: true });
    };
  }, []);

  const facts = [
    [t('person.promo'), person.promo],
    [t('person.track'), person.track],
    [t('person.profession'), person.profession],
  ].filter(([, v]) => v != null && String(v).trim() !== '');

  return createPortal(
    <div className="person-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="person-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={boxRef}>
        <button type="button" className="person-modal-close" aria-label={t('person.close')} onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>

        <header className="person-modal-head">
          <img
            className="person-modal-photo"
            src={person.image || '/logo.jpg'}
            alt={t('a11y.personPhotoAlt', { name })}
            onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = '/logo.jpg'; }}
          />
          <div className="person-modal-title">
            <h3 id={titleId}>{name}</h3>
            <div className="person-modal-tags">
              {badge && <span className={`member-badge${person.isBoard ? ' member-badge-board' : ''}`}>{badge}</span>}
              {university && (
                <span className="member-university member-university-under">
                  <GraduationCap size={12} aria-hidden="true" />
                  {university}
                </span>
              )}
            </div>
          </div>
        </header>

        {details.bio && (
          <section className="person-modal-section">
            <h4>{t('person.about')}</h4>
            <p>{details.bio}</p>
          </section>
        )}

        {(details.studyPath || facts.length > 0) && (
          <section className="person-modal-section">
            <h4>{t('person.studyPath')}</h4>
            {facts.length > 0 && (
              <ul className="person-modal-facts">
                {facts.map(([label, value]) => (
                  <li key={label}><span>{label}</span><strong>{value}</strong></li>
                ))}
              </ul>
            )}
            {details.studyPath && <p>{details.studyPath}</p>}
          </section>
        )}

        {details.extra.length > 0 && (
          <section className="person-modal-section">
            <h4>{t('person.additionalInfo')}</h4>
            <ul className="person-modal-facts">
              {details.extra.map((it, i) => (
                <li key={`${it.label}-${i}`}><span>{it.label}</span><strong>{it.value}</strong></li>
              ))}
            </ul>
          </section>
        )}

        {details.socials.length > 0 && (
          <section className="person-modal-section">
            <h4>{t('person.links')}</h4>
            <div className="person-modal-links">
              {details.socials.map((s) => {
                const Icon = SOCIAL_ICONS[s.key] || Globe;
                return (
                  <a key={s.key} href={s.href} target="_blank" rel="noopener noreferrer nofollow" className="person-social-link">
                    <Icon size={16} aria-hidden="true" />
                    <span>{s.key === 'website' ? t('person.website') : s.label}</span>
                  </a>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>,
    document.body
  );
}
