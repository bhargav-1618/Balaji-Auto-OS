// public/sw.js — Service Worker for offline support.
// NETWORK-FIRST strategy: always try the network so users get the latest
// deployed version immediately; fall back to cache only when offline.
// (The previous cache-first version froze users on old builds after deploys.)
const CACHE_NAME = 'balaji-auto-os-v2';

const STATIC_ASSETS = [
  '/',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS).catch(() => {}))
  );
  // Activate this new worker immediately instead of waiting for old tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET requests; let everything else go straight to the network.
  if (req.method !== 'GET') return;

  // Let the Firebase SDK manage its own data/auth traffic (it uses IndexedDB).
  if (req.url.includes('firestore') || req.url.includes('googleapis') ||
      req.url.includes('firebaseio') || req.url.includes('identitytoolkit')) {
    return;
  }

  // NETWORK-FIRST: try the network, cache a fresh copy, fall back to cache offline.
  event.respondWith(
    fetch(req)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || caches.match('/'))
      )
  );
});
