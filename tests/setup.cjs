/**
 * tests/setup.cjs — require hook + jsdom environment.
 *
 * Transforms the REAL shipped .js/.jsx source with Babel and executes it. Nothing
 * is re-implemented. Stubs only the leaf modules that need observing (toast) or
 * that are irrelevant to logic (icons, qr/pdf).
 */
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');
const Module = require('module');
const { JSDOM } = require('jsdom');

// ---- fake Firebase env vars --------------------------------------------------
// Capacity-management review: lib/firebase.js throws SYNCHRONOUSLY at import time
// if these are missing (by design — fail fast in the real app rather than surface
// a cryptic auth error 25 lines later). That's correct for the shipped app, but it
// means any test that requires a component now transitively pulling in
// services/persistenceStore.js -> repositories/firestoreRepository.js ->
// lib/firebase.js (e.g. BillingModule.jsx now importing CapacityBanner) would crash
// at require-time even though the test itself never calls a real Firestore function.
// initializeApp/getFirestore don't validate credentials until a network call is
// actually made, so placeholder values are safe here — no test in this suite talks
// to a real Firestore project.
Object.assign(process.env, {
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'test-api-key',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'test.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'test-project',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'test.appspot.com',
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '000000000000',
  NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:000000000000:web:0000000000000000000000',
});

// ---- jsdom global environment ---------------------------------------------
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.Event = dom.window.Event;
global.KeyboardEvent = dom.window.KeyboardEvent;
global.MouseEvent = dom.window.MouseEvent;
global.getComputedStyle = dom.window.getComputedStyle;
global.MutationObserver = dom.window.MutationObserver;
global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.scrollTo = () => {};
if (!dom.window.Element.prototype.scrollIntoView) {
  dom.window.Element.prototype.scrollIntoView = function () {};
}
// jsdom has no layout: give elements a plausible box so getBoundingClientRect-based
// positioning code runs instead of dividing by zero. This does NOT prove layout.
//
// Issue 1 (Add Vehicle popup architecture review) — every modal panel now provides
// a ModalBoundaryContext (see components/common/DropdownPanel.jsx) that clamps a
// dropdown's available room to its own panel's rect instead of the full window. A
// SINGLE shared box for every element (the original behaviour below) made a modal
// panel measure exactly as small as the field anchored inside it, collapsing every
// dropdown's room to the floor — a jsdom-mock artifact, not a real browser outcome
// (a real modal panel is close to viewport-sized, not field-sized). Elements
// carrying `data-modal-panel` (every modal's own root — see Modal.js and the
// hand-rolled shells in VehiclesModule/CustomersModule/InventoryDashboard/
// BillingModule) get a large, near-viewport box; everything else (fields, anchors)
// keeps the original small plausible box unchanged.
dom.window.Element.prototype.getBoundingClientRect = function () {
  if (this.hasAttribute && this.hasAttribute('data-modal-panel')) {
    return { top: 0, bottom: 900, left: 0, right: 1400, width: 1400, height: 900, x: 0, y: 0, toJSON() {} };
  }
  return { top: 200, bottom: 240, left: 40, right: 640, width: 600, height: 40, x: 40, y: 200, toJSON() {} };
};
Object.defineProperty(dom.window, 'innerHeight', { value: 900, writable: true });
Object.defineProperty(dom.window, 'innerWidth', { value: 1400, writable: true });

// ---- toast spy --------------------------------------------------------------
const toasts = [];
const toastFn = (msg) => { toasts.push({ level: 'plain', msg: String(msg) }); };
toastFn.error = (msg) => { toasts.push({ level: 'error', msg: String(msg) }); };
toastFn.success = (msg) => { toasts.push({ level: 'success', msg: String(msg) }); };
toastFn.custom = (msg) => { toasts.push({ level: 'custom', msg: String(msg) }); };
toastFn.dismiss = () => {};
toastFn.loading = (msg) => { toasts.push({ level: 'loading', msg: String(msg) }); return 1; };

// ---- confirmDialog spy (auto-answers) --------------------------------------
const confirmCalls = [];
let confirmAnswer = true;

// ---- require hook -----------------------------------------------------------
const STUBS = {
  'react-hot-toast': { __esModule: true, default: toastFn, Toaster: () => null, toast: toastFn },
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (STUBS[request]) return 'STUB:' + request;
  return origResolve.call(this, request, ...rest);
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (STUBS[request]) return STUBS[request];
  return origLoad.call(this, request, ...rest);
};

const EXTRA_EXPORTS = {
  // InvoiceModal is a private function in BillingModule; expose it for testing
  // WITHOUT editing the shipped file. (totalsOf, BillingModule's own money-
  // calculation function, needs no entry here — the shipped file already ends
  // with its own `export { totalsOf };`.)
  [path.resolve(__dirname, '../components/billing/BillingModule.jsx')]:
    '\nexport { InvoiceModal, deriveStatus, nextInvNo, emptyInvoice };\n',
  // CustomerWizard is a private function in CustomersModule; expose it for testing
  // WITHOUT editing the shipped file.
  [path.resolve(__dirname, '../components/customers/CustomersModule.jsx')]:
    '\nexport { CustomerWizard, emptyCustomer };\n',
  // Sidebar is a private function in InventoryDashboard; expose it so the brand →
  // home navigation can be asserted behaviourally WITHOUT editing the shipped file.
  // invTotals/invStatus (Phase 11) are the SECOND, independent money-calculation
  // path (the transaction engine's own gate for stock/sales/rollup realization) —
  // exposed so they can be checked against the same independent oracle as
  // BillingModule's totalsOf/deriveStatus, to prove the two never disagree.
  [path.resolve(__dirname, '../components/InventoryDashboard.js')]:
    '\nexport { Sidebar, invTotals, invStatus };\n',
};

const origJs = require.extensions['.js'];

function compile(module_, filename) {
  // Only ever transform OUR source. Transforming node_modules breaks Babel's own
  // presets (they get re-wrapped as CJS objects and stop being callable).
  if (filename.includes('node_modules')) return origJs(module_, filename);
  let code = fs.readFileSync(filename, 'utf8');
  if (EXTRA_EXPORTS[filename]) code += EXTRA_EXPORTS[filename];
  const out = babel.transformSync(code, {
    filename,
    babelrc: false,
    configFile: false,
    presets: [
      ['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }],
      ['@babel/preset-react', { runtime: 'automatic' }],
    ],
    sourceMaps: 'inline',
  });
  return module_._compile(out.code, filename);
}
require.extensions['.js'] = compile;
require.extensions['.jsx'] = compile;

module.exports = {
  dom,
  toasts,
  clear: () => { toasts.length = 0; },
};
