/**
 * tests/scroll-perf.test.cjs
 *
 * Locks in the scroll-handler optimizations (Issue 3). These are the code-identifiable
 * wins; whether the app *feels* 60fps must be confirmed in a real browser.
 *
 *  - ScrollToTop must rAF-throttle and only setState when the 400px threshold flips,
 *    not call setState on every scroll event.
 *  - Per-tab scroll memory must listen on the content container (onAppScroll), not the
 *    window (which no longer scrolls), and must record into a ref (no re-render).
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const dash = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');

console.log('\nScroll-handler performance\n');

// ScrollToTop
const st = dash.slice(dash.indexOf('function ScrollToTop'), dash.indexOf('function ScrollToTop') + 900);
ok('ScrollToTop rAF-throttles scroll events', /requestAnimationFrame\(evaluate\)/.test(st) && /if \(!ticking\)/.test(st));
ok('ScrollToTop only setState when the threshold boolean flips', /if \(next !== shown\) \{ shown = next; setShow\(next\); \}/.test(st));
ok('ScrollToTop listens on the content container, not window', /onAppScroll\(onScroll\)/.test(st) && !/window\.addEventListener\('scroll'/.test(st));

// Per-tab scroll memory
ok('per-tab scroll memory listens via onAppScroll (window no longer scrolls)',
  /const off = onAppScroll\(\(\) => \{ scrollMem\.current\[activeTab\] = appScrollY\(\); \}\);/.test(dash));
ok('per-tab scroll memory records into a ref (no setState on scroll)',
  /scrollMem\.current\[activeTab\] = appScrollY\(\)/.test(dash) && !/setScrollMem/.test(dash));
ok('no stale window scroll listener remains for scroll memory',
  !/window\.addEventListener\('scroll', onScroll, \{ passive: true \}\)/.test(dash));

// UNIVERSAL ISSUE U3 (overflow-menu unification): the Actions menu used to hand-roll its
// own capture-phase scroll listener that CLOSED the menu on any scroll. It's now the
// shared ActionMenu (components/common/ActionMenu.jsx), which composes DropdownPanel —
// DropdownPanel's own capture-phase scroll listener REPOSITIONS the menu instead of
// closing it (see components/common/DropdownPanel.jsx's useAnchoredPosition), matching
// every other dropdown in the app. That's a deliberate, documented UX improvement (a
// menu that survives an incidental scroll instead of vanishing), not a regression — so
// the old hand-rolled close-on-scroll listener is correctly gone from this file, and the
// scroll-handling responsibility for this menu now lives in DropdownPanel's own test
// coverage rather than here.
ok('Actions menu no longer hand-rolls its own scroll-close listener (delegated to ActionMenu/DropdownPanel)',
  !/if \(!actionsOpen\) return;/.test(dash));
ok('Actions menu is wired through the shared ActionMenu component',
  /<ActionMenu anchorRef=\{actionsAnchorRef\} open onClose=\{\(\) => setActionsOpen\(false\)\}/.test(dash));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
