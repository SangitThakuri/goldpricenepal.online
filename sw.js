/* ================================================================
   sw.js — Gold Price Nepal Service Worker  v5
   ================================================================ */

// importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');

const CACHE    = 'gnp-v6';   // bump to force full reinstall on all devices
const PRECACHE = [
  './',
  './index.html',
  './history.html',
  './css/style.css?v=2.0.2',
  './js/main.js?v=2.2.0',   // versioned — forces fresh fetch on SW update
  './js/history.js',
  './manifest.json',
  './favicon.svg',
  './favicon-32x32.png',
  './apple-touch-icon.png',
  './icon-512.png'
];

// Patterns that should always be fetched from the network first
const NETWORK_FIRST = [
  /\/data\//,
  /cdn\.jsdelivr\.net/,
  /cdn\.onesignal\.com/,
  /frankfurter\.app/,
  /open\.er-api\.com/
];

const isNetworkFirst = url => NETWORK_FIRST.some(p => p.test(url.href));

/* ── Install ── */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

/* ── Activate: purge old caches, claim clients, signal reload ── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ includeUncontrolled: true, type: 'window' }))
      .then(clients => clients.forEach(c => c.postMessage({ type: 'SW_UPDATED', version: CACHE })))
  );
});

/* ── Fetch ── */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  if (isNetworkFirst(url)) {
    // Network-first for live data files.
    // Cache key uses pathname only (strips ?v=timestamp) so the offline
    // fallback works regardless of which cache-buster was in the URL.
    const pathKey = url.origin + url.pathname;

    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(pathKey, clone));
          }
          return res;
        })
        .catch(() =>
          caches.match(pathKey).then(r => r || caches.match(e.request))
        )
    );
    return;
  }

  // Cache-first for static shell assets
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

/* ── Push ── */
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

/* ── Notification click ── */
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
