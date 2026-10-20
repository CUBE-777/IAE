import { useCallback, useEffect, useRef, useState } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * منطق القائمة الجوّالة المشترك بين Header و InteriorHeader:
 * Escape يغلق، قفل تمرير الصفحة خلف القائمة، وإغلاق تلقائي عند التكبير لسطح المكتب.
 *
 * إدارة التركيز (Accessibility): عند الفتح ينتقل التركيز إلى أول عنصر داخل
 * القائمة، وTab/Shift+Tab يدوران داخلها فقط (لا يتسرب التركيز إلى ما خلفها)،
 * وعند الإغلاق (بأي طريقة) يعود التركيز إلى زر القائمة. استعمل
 * `toggleRef` على زر القائمة و`navRef` على عنصر <nav>.
 * لا شيء هنا يعتمد على اتجاه الصفحة، فلا تأثير على RTL.
 */
export function useMobileNav(breakpoint = 860) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef(null);
  const navRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  useEffect(() => {
    if (!open) return undefined;
    const toggleBtn = toggleRef.current;
    const nav = navRef.current;

    const getItems = () =>
      nav ? Array.from(nav.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null) : [];

    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const items = getItems();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = nav && nav.contains(active);
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    const onResize = () => {
      if (window.innerWidth > breakpoint) setOpen(false);
    };

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // نقل التركيز إلى القائمة (أول عنصر قابل للتركيز = زر الإغلاق)
    getItems()[0]?.focus({ preventScroll: true });
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      // إعادة التركيز إلى زر القائمة (لا أثر إن كان مخفيًا في سطح المكتب)
      toggleBtn?.focus({ preventScroll: true });
    };
  }, [open, breakpoint]);

  return { open, close, toggle, toggleRef, navRef };
}
