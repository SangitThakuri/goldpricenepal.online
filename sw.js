/* ================================================================
   sw.js — Gold Price Nepal Service Worker  v2
   Responsibilities:
     1. PWA: cache-first shell, network-first for live data
     2. Offline fallback to cached pages
     3. OneSignal push (uncomment ONE line below to enable after
        adding your App ID to the OneSignal init script in index.html)
   ================================================================ */

// ── OneSignal push support (requires App ID configured in index.html) ──────
// importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
// ────────────────────────────────────────────────────────────────────────────

const CACHE      = 'gnp-v4';
const PRECACHE   = [
  './',
  './index.html',
  './history.html',
  './css/style.css?v=2.0.2',
  './js/main.js',
  './js/history.js',
  './manifest.json',
  './favicon.svg',
  './favicon-32x32.png',
  './apple-touch-icon.png',
  './icon-512.png'
];

// Patterns that should always come from the network (live data / CDN)
const NETWORK_FIRST = [
  /\/data\//,
  /cdn\.jsdelivr\.net/,
  /cdn\.onesignal\.com/,
  /frankfurter\.app/,
  /open\.er-api\.com/
];

const isNetworkFirst = url =>
  NETWORK_FIRST.some(p => p.test(url.href));

/* ── Install ── */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

/* ── Activate: purge old cache versions ── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ── Fetch ── */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  if (isNetworkFirst(url)) {
    // Network-first: always fresh, cache as fallback
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first: static shell assets
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});

/* ── Push (fires when OneSignal or FCM delivers a push) ── */
self.addEventListener('push', e => {
  if (!e.data) return;
  let payload;
  try { payload = e.data.json(); } catch (_) { payload = { title: 'Gold Price Nepal', body: e.data.text() }; }
  e.waitUntil(
    self.registration.showNotification(payload.title || 'Gold Price Nepal', {
      body:  payload.body  || 'Gold prices have been updated.',
      icon:  payload.icon  || '/apple-touch-icon.png',
      badge: '/favicon-32x32.png',
      tag:   'gnp-update',
      renotify: true,
      data: { url: payload.url || '/' }
    })
  );
});

/* ── Notification click: focus or open the app ── */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes('goldpricenepal.online'));
      return existing ? existing.focus() : clients.openWindow(target);
    })
  );
});
