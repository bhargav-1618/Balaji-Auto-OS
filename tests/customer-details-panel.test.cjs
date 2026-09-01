/**
 * tests/customer-details-panel.test.cjs
 *
 * Customer Details panel — width balance + independent scroll review.
 *
 * Root cause of "the table becomes overly compressed / wastes available screen width
 * when the panel opens" (diagnosed when the page shell still capped ALL content at
 * `max-w-7xl` — since superseded by the universal-width-architecture migration, see
 * split-layout-width-budget.test.cjs, but this panel-width bug and its fix are
 * independent of that and still apply): the panel claimed a FLAT `xl:w-[360px]`
 * regardless of viewport. Against the shell's cap at the time, that fixed 360px was
 * the exact same bite out of the exact same ~1216px budget on a 1366px laptop and a 4K
 * monitor — the table column was squeezed to ~856px either way, and a wider monitor
 * just showed more empty MARGIN outside the capped content, not a wider table.
 *
 * Root cause of a genuine "clipped content" bug in the panel's own scroll area: the
 * panel stuck at a flat `xl:top-4` (16px), with no awareness that the global app
 * header is ALSO sticky and occupies real space above that — while scrolled, the panel
 * would try to settle just 16px from the viewport top, which is UNDER where the app
 * header already sits, rather than below it. Its `max-height` cap (`100vh - 2rem`) had
 * the same blind spot, so the panel's own internal scroll region was sized to the full
 * viewport height rather than the height actually available below the header.
 *
 * Fix (original, Customers-only): table gets a real minimum width (xl:min-w-[640px]);
 * the panel's width is clamp(320px, 28%, 420px); sticky top / max-height account for
 * --demo-banner-h + --app-header-h.
 *
 * UPDATE — the clamp-based width later caused ITS OWN imbalance: pairing an unbounded
 * `flex-1` table with a fixed-width panel meant a later page-shell widening (for wide
 * monitors) gave 100% of the extra room to the table alone, leaving the panel pinned at
 * its old ceiling regardless of how much space was available (table 1152px vs panel
 * stuck at 420px at 1920px — a ~2.7:1 ratio). Fixed by giving BOTH columns a flex-grow
 * ratio instead: table `xl:flex-[2_1_0%]`, panel `xl:flex-[1_1_0%]` (with min/max
 * bounds), so extra width is now shared ~2:1 instead of 100:0 — see
 * components/common/DetailsPanel.jsx's "FIFTH bug" comment.
 *
 * DETAILS PANEL FRAMEWORK CONSOLIDATION: Vehicles' side panel turned out to be an
 * independent, stale COPY of Customers' panel — a flat 370px width, a plain `xl:top-4`
 * offset with the exact same "tucks under the header" bug this file was written to
 * fix, and no independent scroll container at all. Rather than fix Vehicles' copy a
 * second time and risk a third drift later, the width/sticky/max-height/scroll
 * mechanics this file guards were extracted into components/common/DetailsPanel.jsx —
 * the ONE shared "docked side panel beside a table" framework — and BOTH Customers and
 * Vehicles now render through it. So the mechanics are asserted against the shared
 * component; this file additionally checks that Customers actually uses it (rather
 * than a reimplementation) and that its own module-specific pieces (table min-width,
 * tab sections, scroll-position cache) are untouched.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/customers/CustomersModule.jsx'), 'utf8');
const panel = fs.readFileSync(path.resolve(__dirname, '../components/common/DetailsPanel.jsx'), 'utf8');

console.log('\nCustomers — Details panel width balance + independent scroll\n');

const start = src.indexOf('xl:flex xl:gap-4 xl:items-start');
// widened from 24000: the Phase 1b edit-lease Lock icon + disabled state on the
// two row Edit buttons sit between this anchor and the panel's bodyRef.
const block = src.slice(start, start + 27000);

// --- Width balance (Task: table compression) ---
ok('table column has a real minimum width (was xl:min-w-0 — no floor at all)',
  /xl:flex-\[2_1_0%\] xl:min-w-\[640px\]/.test(block));
ok('Customers renders its detail panel through the shared <DetailsPanel> component (not a reimplementation)',
  /<DetailsPanel/.test(block));
ok('Customers does not override widthCls — inherits the shared responsive default',
  !/<DetailsPanel[\s\S]{0,200}widthCls=/.test(block));

// --- Shared framework mechanics (components/common/DetailsPanel.jsx) ---
ok('shared panel width grows proportionally with the row (flex ratio), not a flat fixed pixel value',
  /xl:flex-\[1_1_0%\]/.test(panel));
ok('the flex ratio has a sensible floor (panel never unreadably narrow) and ceiling (never dominates the row)',
  /xl:min-w-\[320px\] xl:max-w-\[480px\]/.test(panel));
ok('shared panel\'s width declaration itself carries a grow-factor (flex-[1_1_0%]), not a flex-shrink-0-pinned fixed value, so it can genuinely share extra row width with the table instead of being excluded from it',
  /widthCls = "xl:flex-\[1_1_0%\] xl:min-w-\[320px\] xl:max-w-\[480px\] xl:self-stretch/.test(panel));
// top/max-h formulas now route their extra offset through a per-instance CSS custom
// property (--panel-extra-offset, defaulting to 1rem — unchanged for any caller
// without a competing sticky toolbar) instead of a hardcoded 1rem/2rem, so a caller
// like Customers (which has its OWN sticky KPI/search/filter toolbar between the app
// header and this panel) can clear that too — see topOffset in
// tests/customer-details-panel-toolbar-overlap.test.cjs for the bug this fixes.
ok('shared panel sticky offset is the per-caller gap only — <main> is the scrollport and already starts below the header, so re-adding header height would double-offset the panel',
  /top: 'var\(--panel-extra-offset, 1rem\)'/.test(panel));
ok('shared panel max-height is reduced by that same header height + extra offset, so its own scroll region matches what is actually visible below the header AND any per-caller toolbar',
  /xl:max-h-\[calc\(100vh_-_var\(--demo-banner-h,0px\)_-_var\(--app-header-h,68px\)_-_var\(--panel-extra-offset,1rem\)_-_1rem\)\]/.test(panel));
ok('the shared panel body still has its own independent scroll container (min-h-0 + xl:overflow-y-auto), separate from the page/table scroll',
  /flex-1 xl:overflow-y-auto dark-scroll xl:-mr-2 xl:pr-2 min-h-0/.test(panel));
ok('shared panel stays sticky (position) — only the offset formula changed, not the mechanism',
  /xl:sticky rounded-2xl p-4 flex flex-col/.test(panel));

// --- Customers still wires its own scroll-position cache through the shared body ---
ok('Customers passes its own bodyRef/onBodyScroll into the shared panel (scroll-position cache preserved, not dropped by the extraction)',
  /bodyRef=\{drawerScrollRef\}/.test(block) && /onBodyScroll=\{\(e\) => \{ V\.drawerScrollY = e\.currentTarget\.scrollTop; \}\}/.test(block));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
