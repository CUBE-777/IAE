import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * index.html يعرّف <link rel="canonical"> ثابتًا للصفحة الرئيسية. بدون تحديثه،
 * كل صفحة داخلية (/members, /board, /activity/...) تعلن لمحركات البحث أن
 * canonical هو الصفحة الرئيسية. هذا الـhook يضبطه على مسار الصفحة الحالية
 * (بنفس origin المعرَّف في index.html — لا نص مكرر) ويعيد القيمة السابقة عند
 * مغادرة الصفحة، فتعود الصفحة الرئيسية لقيمتها الأصلية.
 */
const baseHref = (() => {
  if (typeof document === 'undefined') return '';
  const el = document.querySelector('link[rel="canonical"]');
  try {
    return new URL(el?.getAttribute('href') || window.location.href).origin;
  } catch {
    return window.location.origin;
  }
})();

export function useCanonicalUrl() {
  const { pathname } = useLocation();
  useEffect(() => {
    let el = document.querySelector('link[rel="canonical"]');
    const created = !el;
    const previous = el ? el.getAttribute('href') : null;
    if (!el) {
      el = document.createElement('link');
      el.setAttribute('rel', 'canonical');
      document.head.appendChild(el);
    }
    const url = baseHref + (pathname === '/' ? '/' : pathname.replace(/\/+$/, ''));
    el.setAttribute('href', url);
    const og = document.querySelector('meta[property="og:url"]');
    const prevOg = og ? og.getAttribute('content') : null;
    if (og) og.setAttribute('content', url);
    return () => {
      if (created) el.remove();
      else if (previous != null) el.setAttribute('href', previous);
      if (og && prevOg != null) og.setAttribute('content', prevOg);
    };
  }, [pathname]);
}
