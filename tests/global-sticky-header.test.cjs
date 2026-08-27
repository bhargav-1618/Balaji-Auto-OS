/**
 * tests/global-sticky-header.test.cjs
 *
 * Root cause of the "sticky header regressed, intermittently, after navigating between
 * modules" report: the account bar (avatar / signed-in-as / logout) and the page-title
 * <header> below it were TWO INDEPENDENTLY positioned elements — the account bar was
 * `relative` (never sticky at all: "user info, logout" scrolled away immediately), and
 * only the page-title <header> was `sticky`, offset just by the demo banner's height via
 * `--demo-banner-h`. Separately, `--app-header-h` (consumed by CustomersModule's own
 * sticky KPI/toolbar bar, so IT sticks just below the app header) only ever measured the
 * page-title <header>'s own height — never the account bar sitting above it. That's a
 * chain of independently-measured heights across two unrelated elements: exactly the kind
 * of thing an unrelated change (new header text, a wrapped line, the demo banner
 * toggling) can silently throw off, reading as an intermittent, module-dependent
 * regression rather than a deterministic CSS bug.
 *
 * Fix: the account bar and header now live inside ONE sticky wrapper. There is exactly
 * one sticky element, one ref measuring the combined visible height into
 * `--app-header-h`, and one offset (the demo banner). They can no longer drift apart.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');

console.log('\nGlobal sticky header — account bar + page-title header consolidation\n');

// Isolate the header region between the grid-overlay comment and <main>.
const start = src.indexOf("Fix 1: subtle grid overlay");
const end = src.indexOf('<main id={APP_SCROLL_ID}');
const block = src.slice(start, end);

ok('header region found', start !== -1 && end !== -1 && end > start);

ok('there is exactly ONE fixed wrapper around both the account bar and the header (not two independent positioned elements)',
  (block.match(/z-30 backdrop-blur-md/g) || []).length === 1);

ok('the combined wrapper is an in-flow, non-shrinking row of the non-scrolling shell (so it cannot scroll away at all)',
  /className="flex-none z-30 backdrop-blur-md"/.test(block));

ok('the account bar is no longer independently `relative z-40` (it is plain flow content inside the sticky wrapper now)',
  !/className="relative z-40 px-4 sm:px-6 py-2\.5/.test(block));

ok('the page-title <header> is no longer independently `sticky` (it is plain flow content inside the sticky wrapper now)',
  !/<header[\s\S]{0,20}className="sticky/.test(block));

ok('--app-header-h is measured on the OUTER combined wrapper (account bar + header together), not just the inner <header>',
  /ref=\{\(el\) => \{ if \(el\) document\.documentElement\.style\.setProperty\('--app-header-h', `\$\{el\.offsetHeight\}px`\); \}\}\s*\n\s*className="flex-none /.test(block));

ok('the wrapper needs no top-offset chain at all — it sits above the scroll container in flow',
  !/style=\{\{ top: demoMode \? 'var\(--demo-banner-h, 37px\)' : 0 \}\}/.test(block));

ok('the account bar still renders its avatar / signed-in-as / logout content unchanged',
  /Signed in as/.test(block) && /LogOut size=\{13\}/.test(block) && /Logout/.test(block));

ok('the shop-title + tab-subtitle status block was removed from the header (per user request)',
  !/\{getShopName\(\)\}/.test(block) && !/'Auto Parts & Service' :/.test(block));

// UNIVERSAL PAGE HEADER STANDARDIZATION: this used to be a second, separate, global
// sticky bar that existed purely to inject a lone "Add Part"/"Add Supplier" button
// (justify-end, no title) — a competing header mechanism alongside the per-view
// PageHeader instead of being part of one. It's gone entirely now; the Inventory Parts
// view and the Suppliers view each own their own <PageHeader action={...}> button in
// their normal content flow (see tests/action-menu-unification.test.cjs-adjacent
// PageHeader migration tests), so the combined sticky wrapper now only ever contains
// the account bar — a single, constant height across every tab instead of two.
ok('the old contextual Add Part/Add Supplier <header> bar is gone entirely (folded into each view\'s own PageHeader action)',
  !/invSubView === 'parts'\) \|\| activeTab === 'suppliers'\) && \(/.test(block) && !/<header\s*\n\s*className="px-4 sm:px-6 py-4"/.test(block));

// Downstream consumer: CustomersModule's own sticky sub-header must keep reading the
// SAME two variables — this fix only changes WHERE/HOW they're measured, not their names.
const custSrc = fs.readFileSync(path.resolve(__dirname, '../components/customers/CustomersModule.jsx'), 'utf8');
ok('CustomersModule has NO opaque sticky module-header wrapper (KPIs/toolbar sit on the shared background, like Vehicles)',
  !/style=\{\{ top: 0, background: 'rgba\(10,10,10,0\.75\)' \}\}/.test(custSrc)
  && !/Sticky module header: KPI cards \+ toolbar stay fixed/.test(custSrc));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
