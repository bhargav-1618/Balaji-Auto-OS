// public/sw.js — Service Worker for offline support.
// NETWORK-FIRST strategy: always try the network so users get the latest
// deployed version immediately; fall back to cache only when offline.
// (The previous cache-first version froze users on old builds after deploys.)
const CACHE_NAME = 'balaji-auto-os-v3';

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

  let url;
  try { url = new URL(req.url); } catch { return; }

  // Never intercept cross-origin requests (Google Fonts on fonts.gstatic.com,
  // CDNs, analytics) or fonts of any origin. A failed font fetch that falls back
  // to the cached HTML shell gets decoded as a font — "Failed to decode
  // downloaded font / OTS parsing error / invalid sfntVersion". Let the browser
  // handle these directly; the app already has system-font fallbacks.
  const isCrossOrigin = url.origin !== self.location.origin;
  const isFont = req.destination === 'font'
    || /\.(?:woff2?|ttf|otf|eot)(?:$|\?)/i.test(url.pathname);
  if (isCrossOrigin || isFont) return;

  // Only a real navigation (an HTML document request) may fall back to the
  // offline app shell. Scripts, styles, images and data must fail like the
  // network would, never receive HTML.
  const isDocument = req.mode === 'navigate' || req.destination === 'document';

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
        caches.match(req).then((cached) => {
          if (cached) return cached;
          if (isDocument) return caches.match('/');
          // Non-document asset with no cached copy → behave like a network failure.
          return Response.error();
        })
      )
  );
});
