import { useEffect } from 'react';

/** يضيف <meta name="robots" content="noindex, nofollow"> للصفحة الحالية ويزيله عند المغادرة (صفحات الأعضاء الخاصة). */
export function useNoindex() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
}
