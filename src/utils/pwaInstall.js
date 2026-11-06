/**
 * تثبيت لوحة الإدارة كتطبيق (PWA).
 * يلتقط حدث beforeinstallprompt مبكرًا (يُطلق مرة واحدة فقط وقد يسبق تركيب أي مكوّن) ويحفظه لزر التثبيت.
 */
let deferredPrompt = null;
let installed = false;
const listeners = new Set();

const notify = () => listeners.forEach((fn) => fn());

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return Boolean(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);
}

export function isIos() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // iPadOS 13+ يعرّف نفسه كـ Macintosh مع شاشة لمس
  return /iphone|ipad|ipod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

if (typeof window !== 'undefined') {
  installed = isStandalone();
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferredPrompt = null;
    notify();
  });
}

export function getInstallState() {
  return { canPrompt: Boolean(deferredPrompt), installed, ios: isIos() };
}

export function subscribeInstall(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** يعرض نافذة التثبيت الأصلية؛ يُرجع 'accepted' | 'dismissed' | 'unavailable'. */
export async function promptInstall() {
  if (!deferredPrompt) return 'unavailable';
  const ev = deferredPrompt;
  deferredPrompt = null; // لا يصلح الحدث لأكثر من استدعاء
  notify();
  await ev.prompt();
  const choice = await ev.userChoice;
  return choice?.outcome || 'dismissed';
}
