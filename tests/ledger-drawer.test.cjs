/**
 * tests/ledger-drawer.test.cjs
 *
 * The shared LedgerPage detail drawer (used by Sales & Services, and — since the
 * Issue 7 Stock Operations review — the Inventory Stock tab's movement timeline
 * and the per-part Movement History modal too). Sticky header, scroll reset on
 * open, body-scroll-lock, bottom padding. Source guards — the behaviour lives in
 * JSX/DOM we can't execute headless.
 *
 * Extracted from InventoryDashboard.js into components/common/LedgerPage.jsx as
 * its own `LedgerDetailDrawer` component (Issue 7.7/7.8/7.9 — the Inventory Stock
 * tab needed the same drawer but couldn't reuse it while it lived un-exported
 * inside InventoryDashboard.js). Only the source file and the internal ref names
 * changed (detailBodyRef -> bodyRef); the behaviors below are unchanged.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/common/LedgerPage.jsx'), 'utf8');
// isolate the LedgerDetailDrawer component
const drawerStart = src.indexOf('export function LedgerDetailDrawer');
const drawer = src.slice(drawerStart, drawerStart + 2600);

console.log('\nSales/Services shared detail drawer — sticky header, reset, lock\n');

// Bug 2: reset scroll to top on open
ok('a body ref exists for the detail drawer', /const bodyRef = useRef\(null\)/.test(drawer));
ok('scroll resets to top when a record opens',
  /if \(bodyRef\.current\) bodyRef\.current\.scrollTop = 0/.test(drawer));

// Bug 3: independent scroll + background locked
ok('opening the drawer locks the background page', /if \(!detail\) return undefined;[\s\S]{0,200}lockBody\(\)/.test(drawer));
ok('the lock is released on close', /unlockBody\(t\)/.test(drawer));

// Bug 1: header is fixed (flex-shrink-0), not scrolling; body scrolls separately
ok('panel is a flex column', /max-h-\[88vh\] flex flex-col/.test(drawer));
ok('header is flex-shrink-0 (does not scroll away)', /flex-shrink-0 flex items-center justify-between px-6 py-4/.test(drawer));
ok('only the body scrolls (ref on the overflow container)', /ref=\{bodyRef\} className="flex-1 overflow-y-auto/.test(drawer));
ok('header carries the record number when present (Invoice/Reference)',
  /detail\.detail\?\.Invoice \|\| detail\.detail\?\.Reference/.test(drawer));
// aria-label now routes through lib/i18n.js's t('key', 'English fallback').
ok('close button is in the fixed header with an aria-label', /aria-label=\{t\('common\.close', 'Close'\) \+ ' dialog'\}/.test(drawer));

// Bug 4: bottom padding so the last field isn't clipped
ok('body has extra bottom padding (pb-8)', /overflow-y-auto ledger-detail-scroll px-6 py-4 pb-8/.test(drawer));

// no leftover always-sticky-top header (old approach)
ok('old sticky-top header replaced (no "sticky top-0 flex items-center justify-between px-6 py-4")',
  !/sticky top-0 flex items-center justify-between px-6 py-4/.test(drawer));

// Issue 7.7 — is genuinely reused (not re-implemented) by the two new consumers.
const dash = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');
const stockPage = fs.readFileSync(path.resolve(__dirname, '../components/inventory/InventoryStock.jsx'), 'utf8');
ok('ProductLedgerModal (per-part movement history) reuses LedgerDetailDrawer instead of its own drawer',
  /<LedgerDetailDrawer title="Movement" icon=\{History\} detail=\{detail\} onClose=\{\(\) => setDetail\(null\)\}/.test(dash));
ok('Inventory Stock tab movement timeline reuses LedgerDetailDrawer',
  /<LedgerDetailDrawer title="Movement" icon=\{History\} detail=\{detail\} onClose=\{\(\) => setDetail\(null\)\}/.test(stockPage));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
