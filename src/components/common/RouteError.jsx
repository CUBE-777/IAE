import { useEffect } from 'react';
import { useRouteError } from 'react-router-dom';
import ErrorScreen from './ErrorScreen';

/**
 * errorElement للراوتر: يلتقط أخطاء العرض وأخطاء تحميل الأجزاء (chunks) بعد نشر نسخة جديدة.
 * عند فشل تحميل جزء ديناميكي لأن الملف القديم حُذف من الخادم نعيد التحميل تلقائيًا مرة واحدة فقط.
 */
const CHUNK_RE = /dynamically imported module|Loading chunk|Importing a module script failed|error loading dynamically/i;
const RELOAD_KEY = 'iae:chunk-reload';

export default function RouteError() {
  const error = useRouteError();

  useEffect(() => {
    console.error('خطأ في عرض الصفحة:', error);
    const msg = String((error && (error.message || error)) || '');
    if (!CHUNK_RE.test(msg)) return;
    try {
      if (sessionStorage.getItem(RELOAD_KEY)) return;
      sessionStorage.setItem(RELOAD_KEY, '1');
      window.location.reload();
    } catch (e) {
      /* التخزين غير متاح: تبقى شاشة الخطأ مع زر إعادة التحميل */
    }
  }, [error]);

  return <ErrorScreen />;
}
