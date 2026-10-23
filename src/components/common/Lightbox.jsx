import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * منفذ 1:1 لسلوك "Lightbox Script" في index.html الأصلي: يستمع لأي نقرة على
 * صورة داخل `#gallery img, .gallery-card img, .gallery-grid img` في كامل
 * المستند، ويفتح معاينة مكبّرة مع تنقل بالأسهم/الكيبورد وإغلاق بـ Escape أو
 * النقر خارج الصورة.
 */
export default function Lightbox() {
  const { t } = useTranslation();
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const imagesRef = useRef([]);
  const modalRef = useRef(null);
  const triggerRef = useRef(null);

  // الإغلاق: ننقل التركيز خارج النافذة *قبل* أن تصبح aria-hidden، وإلا يحجب المتصفح
  // العنصر المُركَّز داخل عنصر مخفي (تحذير "Blocked aria-hidden on an element...").
  const close = useCallback(() => {
    const modal = modalRef.current;
    if (modal && modal.contains(document.activeElement)) {
      const trigger = triggerRef.current;
      if (trigger && trigger.isConnected && typeof trigger.focus === 'function') {
        trigger.focus({ preventScroll: true });
      }
      if (modal.contains(document.activeElement)) document.activeElement.blur();
    }
    setActive(false);
  }, []);

  const showImage = useCallback((i) => {
    const imgs = imagesRef.current;
    if (!imgs.length) return;
    let next = i;
    if (next < 0) next = imgs.length - 1;
    if (next >= imgs.length) next = 0;
    setIndex(next);
  }, []);

  useEffect(() => {
    const onClick = (e) => {
      const img = e.target.closest('#gallery img, .gallery-card img, .gallery-grid img');
      if (!img) return;
      const imgs = Array.from(document.querySelectorAll('#gallery img, .gallery-card img, .gallery-grid img'));
      imagesRef.current = imgs;
      triggerRef.current = img;
      const i = imgs.indexOf(img);
      if (i !== -1) {
        setIndex(i);
        setActive(true);
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    const onKeydown = (e) => {
      if (!active) return;
      if (e.key === 'Escape') close();
      const rtl = document.documentElement.dir === 'rtl';
      if (e.key === 'ArrowRight') showImage(index + (rtl ? -1 : 1));
      if (e.key === 'ArrowLeft') showImage(index + (rtl ? 1 : -1));
    };
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  }, [active, index, showImage, close]);

  const currentImg = imagesRef.current[index];
  const caption = currentImg ? currentImg.alt || currentImg.getAttribute('data-caption') || '' : '';
  // لا نعرض النص الافتراضي لوصف الصورة (بكل اللغات) كتعليق، بل التعليق الحقيقي فقط
  const showCaption = caption && caption !== 'صورة المعرض' && caption !== t('a11y.galleryImageAlt');

  // قفل تمرير الصفحة أثناء المعاينة + إعادة التركيز لزر الإغلاق
  useEffect(() => {
    if (!active) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    modalRef.current?.querySelector('.lightbox-close')?.focus();
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);

  // inert: يمنع الوصول بالتاب/القارئ للنافذة وهي مغلقة (React 18 يتطلب نصًا لا boolean)
  return (
    <div
      className={`lightbox-modal${active ? ' active' : ''}`}
      id="lightboxModal"
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('a11y.lightbox')}
      aria-hidden={!active}
      inert={active ? undefined : ''}
      onClick={(e) => {
        if (e.target === modalRef.current) close();
      }}
    >
      <button type="button" className="lightbox-close" aria-label={t('a11y.close')} onClick={close}>
        &times;
      </button>
      <button type="button" className="lightbox-prev" aria-label={t('a11y.previousImage')} onClick={() => showImage(index - 1)}>
        ❯
      </button>
      <img className="lightbox-content" src={currentImg ? currentImg.src : ''} alt={t('a11y.previewImage')} />
      <div className="lightbox-caption" style={{ display: showCaption ? 'block' : 'none' }}>
        {caption}
      </div>
      <button type="button" className="lightbox-next" aria-label={t('a11y.nextImage')} onClick={() => showImage(index + 1)}>
        ❮
      </button>
    </div>
  );
}
