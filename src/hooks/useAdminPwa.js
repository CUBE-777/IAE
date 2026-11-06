import { useEffect, useSyncExternalStore } from 'react';
import { getInstallState, subscribeInstall } from '../utils/pwaInstall';

const ADMIN_MANIFEST = '/admin.webmanifest';
const ADMIN_TITLE = 'IAE Admin';

/**
 * في مسارات /admin/* فقط: يبدّل manifest الصفحة إلى admin.webmanifest (تطبيق مستقل: scope=/admin/، البداية /admin/login)
 * ويسجّل الـ service worker الخاص بالإدارة. عند مغادرة الإدارة يعود manifest الموقع العام كما كان.
 * (الصفحة واحدة SPA، فالتبديل يتم من المتصفح؛ Chrome وSafari يقرآن الرابط الحالي عند التثبيت.)
 */
export function useAdminPwa(isAdminPath) {
  useEffect(() => {
    if (!isAdminPath) return undefined;
    const link = document.getElementById('app-manifest');
    const titleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    const prevHref = link?.getAttribute('href');
    const prevTitle = titleMeta?.getAttribute('content');
    link?.setAttribute('href', ADMIN_MANIFEST);
    titleMeta?.setAttribute('content', ADMIN_TITLE);

    // الـ service worker في الإنتاج فقط (Service-Worker-Allowed يأتي من رؤوس Netlify)
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/admin-sw.js', { scope: '/admin/' }).catch(() => {});
    }

    return () => {
      if (prevHref) link?.setAttribute('href', prevHref);
      if (prevTitle) titleMeta?.setAttribute('content', prevTitle);
    };
  }, [isAdminPath]);
}

/** حالة التثبيت لزر «ثبّت التطبيق». */
export function useInstallState() {
  return useSyncExternalStore(subscribeInstall, cachedState, cachedState);
}

// useSyncExternalStore يتطلب لقطة ثابتة المرجع ما لم تتغيّر القيم
let last = getInstallState();
function cachedState() {
  const next = getInstallState();
  if (next.canPrompt !== last.canPrompt || next.installed !== last.installed || next.ios !== last.ios) last = next;
  return last;
}
