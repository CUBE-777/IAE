import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * نافذة منبثقة موحّدة لكل صفحات الإدارة (نفس الواجهة: children + onClose):
 * role=dialog + aria-modal، ربط العنوان (أول h3) بـ aria-labelledby، زر إغلاق ظاهر،
 * Escape والنقر خارج النافذة، حبس التركيز (Tab) وإعادته لعنصر الفتح، قفل تمرير
 * الصفحة، وتمرير داخلي عند طول المحتوى (CSS: max-height + overflow).
 */
export default function Modal({ children, onClose, wide = false }) {
  const { t } = useTranslation();
  const boxRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  onCloseRef.current = onClose;

  useEffect(() => {
    const box = boxRef.current;
    const previouslyFocused = document.activeElement;
    const heading = box.querySelector('h3');
    if (heading) {
      if (!heading.id) heading.id = titleId;
      box.setAttribute('aria-labelledby', heading.id);
    }

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // تركيز أول حقل قابل للإدخال، وإلا النافذة نفسها
    const first = box.querySelector('input:not([type="hidden"]), textarea, select') || box;
    first.focus({ preventScroll: true });

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = Array.from(box.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus({ preventScroll: true });
    };
  }, [titleId]);

  return (
    <div
      className="admin-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`admin-modal-box${wide ? ' admin-modal-wide' : ''}`}
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <button type="button" className="admin-modal-close" aria-label={t('admin.modal.close')} onClick={onClose}>
          ×
        </button>
        {children}
      </div>
    </div>
  );
}
