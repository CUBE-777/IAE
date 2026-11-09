/* Service worker للوحة الإدارة فقط (scope: /admin/).
 * - لا يخزّن أي طلب إلى Supabase أو أي نطاق آخر، ولا أي بيانات للمستخدم (الجلسات والبيانات تبقى مباشرة من الشبكة).
 * - يخزّن فقط ملفات /assets/ (أسماؤها بـ hash فهي غير قابلة للتغيّر) وأيقونات التطبيق وصفحة «لا اتصال».
 * - التنقّل (الصفحات): الشبكة أولًا، وعند انقطاع الاتصال تُعرض صفحة /admin-offline.html. */
const VERSION = 'iae-admin-v2';
const OFFLINE_URL = '/admin-offline.html';
const PRECACHE = [OFFLINE_URL, '/admin-offline.js', '/icon-192.png', '/logo.jpg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('iae-admin-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase وغيره: مباشرة من الشبكة

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(VERSION).then((cache) =>
        cache.match(req).then((hit) => hit || fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        }))
      )
    );
  }
});
