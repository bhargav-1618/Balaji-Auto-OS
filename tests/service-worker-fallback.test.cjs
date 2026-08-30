/**
 * tests/service-worker-fallback.test.cjs
 *
 * BUG-LIVE-001 regression. The old public/sw.js fetch handler, on ANY failed GET
 * with no cached copy, returned caches.match('/') — the app HTML — including for
 * font requests. A phone/browser then tried to decode HTML as a font:
 *   "Failed to decode downloaded font / OTS parsing error / invalid sfntVersion".
 *
 * The service worker is plain browser JS (no bundler); this parses it and executes
 * its fetch handler against fake requests to prove:
 *   - font requests are never intercepted (browser handles them)
 *   - cross-origin requests (Google Fonts on fonts.gstatic.com) are never intercepted
 *   - a failed non-document asset does NOT receive HTML
 *   - a failed navigation CAN still receive the offline HTML shell
 *   - the cache name was bumped so clients pick up the new worker
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};

console.log('\nBUG-LIVE-001 — service worker font / asset fallback\n');

const swSrc = fs.readFileSync(path.resolve(__dirname, '../public/sw.js'), 'utf8');

// --- static guards ---------------------------------------------------------
ok('cache name bumped past v2', /CACHE_NAME = 'balaji-auto-os-v[3-9]/.test(swSrc));
ok('handler branches on font requests',
  swSrc.includes("destination === 'font'") && /woff2\?\|ttf\|otf\|eot/.test(swSrc));
ok('handler branches on cross-origin', swSrc.includes('url.origin !== self.location.origin'));
ok('HTML shell fallback is gated on a navigation/document request',
  (swSrc.includes("req.mode === 'navigate'") || swSrc.includes("destination === 'document'")) &&
  swSrc.includes("if (isDocument) return caches.match('/')"));

// --- behavioural: run the real fetch handler in a fake SW global -----------
const listeners = {};
const cacheStore = new Map(); // key: url string → Response-ish
const HTML_SHELL = { kind: 'html', headers: { 'content-type': 'text/html' } };
cacheStore.set('/', HTML_SHELL);

function makeReq({ url, mode = 'cors', destination = '' }) {
  return { method: 'GET', url, mode, destination };
}
const sandbox = {
  self: {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    location: { origin: 'https://balaji-auto-os.vercel.app' },
    skipWaiting: () => {},
    clients: { claim: () => {} },
  },
  caches: {
    open: async () => ({ put: async () => {}, addAll: async () => {} }),
    keys: async () => [],
    delete: async () => {},
    match: async (req) => {
      const key = typeof req === 'string' ? req : req.url;
      return cacheStore.get(key) || cacheStore.get('/') && key === '/' ? cacheStore.get(key) : (key === '/' ? HTML_SHELL : undefined);
    },
  },
  URL,
  Response: { error: () => ({ kind: 'network-error', type: 'error' }) },
  console,
};
sandbox.self.location = new URL('https://balaji-auto-os.vercel.app/');
sandbox.self.location.origin = 'https://balaji-auto-os.vercel.app';
vm.createContext(sandbox);
vm.runInContext(swSrc, sandbox);

ok('sw.js registered a fetch handler', typeof listeners.fetch === 'function');

// Helper: drive one request through the handler with a forced NETWORK FAILURE,
// capture what respondWith() resolves to.
async function fetchWithNetworkDown(req) {
  let captured;
  sandbox.fetch = async () => { throw new Error('offline'); };
  const event = {
    request: req,
    respondWith: (p) => { captured = p; },
  };
  listeners.fetch(event);
  return captured ? await captured : '__NOT_HANDLED__';
}
// Helper: network UP, returns a normal 200.
async function fetchOnline(req, body = { kind: 'asset', status: 200, type: 'basic' }) {
  let captured;
  sandbox.fetch = async () => ({ ...body, clone: () => body });
  const event = { request: req, respondWith: (p) => { captured = p; } };
  listeners.fetch(event);
  return captured ? await captured : '__NOT_HANDLED__';
}

(async () => {
  // 1. same-origin font, network down, nothing cached → must NOT be HTML
  const fontRes = await fetchWithNetworkDown(makeReq({ url: 'https://balaji-auto-os.vercel.app/_next/static/media/x.woff2', destination: 'font' }));
  ok('same-origin font is not intercepted (browser handles it, never gets HTML)',
    fontRes === '__NOT_HANDLED__',
    `handler returned: ${JSON.stringify(fontRes)}`);

  // 2. cross-origin Google font file (fonts.gstatic.com) → not intercepted
  const gfont = await fetchWithNetworkDown(makeReq({ url: 'https://fonts.gstatic.com/s/cinzel/v1/abc.woff2', destination: 'font' }));
  ok('cross-origin Google font is not intercepted', gfont === '__NOT_HANDLED__');

  // 3. same-origin JS chunk, network down, not cached → network error, NOT HTML
  const jsRes = await fetchWithNetworkDown(makeReq({ url: 'https://balaji-auto-os.vercel.app/_next/static/chunks/main.js', destination: 'script' }));
  ok('a failed uncached script gets a network error, not the HTML shell',
    jsRes && jsRes.kind === 'network-error',
    `handler returned: ${JSON.stringify(jsRes)}`);

  // 4. navigation request, network down, not cached → the offline HTML shell IS served
  const navRes = await fetchWithNetworkDown(makeReq({ url: 'https://balaji-auto-os.vercel.app/billing', mode: 'navigate', destination: 'document' }));
  ok('a failed navigation still falls back to the offline HTML shell',
    navRes && navRes.kind === 'html',
    `handler returned: ${JSON.stringify(navRes)}`);

  // 5. online: same-origin asset passes through untouched
  const online = await fetchOnline(makeReq({ url: 'https://balaji-auto-os.vercel.app/_next/static/chunks/main.js', destination: 'script' }));
  ok('online same-origin asset is served from the network', online && online.status === 200);

  console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
  process.exit(FAIL ? 1 : 0);
})();
