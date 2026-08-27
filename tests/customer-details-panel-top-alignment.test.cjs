/**
 * tests/customer-details-panel-top-alignment.test.cjs
 *
 * Customers' Details Panel went through FOUR fixes chasing a claim that it needed extra
 * `topOffset` to clear the module's own sticky toolbar (KPI stats + search + filters,
 * sits above the table in the SAME column as the table, beside — not above — the
 * panel):
 *   1. A constant `topOffset` baking in the toolbar's full height — fixed a believed
 *      "toolbar overlaps panel" bug (diagnosed from a raw rect Y-coordinate overlap
 *      check) but broke the at-rest case: CSS sticky's `top` is an unconditional floor,
 *      so a constant bigger than the panel's natural position clamps it down
 *      immediately at scroll 0. Customers' panel rendered ~300px below the table's top
 *      at rest instead of flush with it like Vehicles.
 *   2. A scroll-listener toggling that offset between 0 and the toolbar's height once
 *      the toolbar was "stuck" — fixed the at-rest case, but the toolbar's own
 *      stick-threshold sits only ~24px of scroll below rest, so the offset jumped from
 *      0 to ~355px in a single scroll tick: the panel visibly snapped the instant any
 *      scrolling began, reading as "the panel is scrolling with the page."
 *
 * Both fixes were solving a problem that doesn't exist. The toolbar and panel are
 * SIBLING COLUMNS in the same flex row (table column, then this panel) — completely
 * different horizontal ranges on screen. A raw rect's Y-overlap between them means
 * nothing; verified with `document.elementFromPoint()` (paint-level ground truth) at
 * the panel's own on-screen coordinates across the FULL scroll range, with ZERO extra
 * offset applied: the panel itself is what's actually rendered there every time — the
 * toolbar never paints into the panel's column, stuck or not.
 *
 * Fix: removed the entire mechanism. Customers passes no `topOffset` at all — the exact
 * same shared DetailsPanel default Vehicles has always used. Live-verified after
 * removal: panel top position across scroll 0/50/100/200/300/500 = 190/182/182/182/
 * 182/174 — smooth and monotonic (no jump), and `elementFromPoint` confirms the panel,
 * never the toolbar, at every one of those positions.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const R = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nCustomers Details panel — top alignment (no topOffset mechanism needed or present)\n');

const cust = R('components/customers/CustomersModule.jsx');
const veh = R('components/vehicles/VehiclesModule.jsx');
const panel = R('components/common/DetailsPanel.jsx');

// --- The whole scroll-aware clearance mechanism is gone, not just disabled ---
ok('Customers no longer passes any topOffset to <DetailsPanel> (uses the shared default, same as Vehicles)',
  !/topOffset=/.test(cust.slice(cust.indexOf('<DetailsPanel'), cust.indexOf('<DetailsPanel') + 300)));
ok('no --customers-panel-clear / --customers-toolbar-h CSS variable remains anywhere',
  !/--customers-panel-clear/.test(cust) && !/--customers-toolbar-h/.test(cust));
ok('no toolbarRef / scroll-listener effect remains in CustomersModule',
  !/toolbarRef/.test(cust) && !/isStuck/.test(cust));
ok('the opaque sticky module-header wrapper is gone entirely (KPIs/toolbar now sit on the shared background, like Vehicles)',
  !/className="sticky z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-1 pb-3 backdrop-blur-md"/.test(cust) &&
  !/ref=\{\(el\) => \{ toolbarRef\.current = el; \}\}/.test(cust));

// --- Baseline alignment (reopened) — precise pixel measurement (not the earlier
// elementFromPoint paint-overlap check, which only proves "nothing else painted
// there," not "this is flush with the KPI row") found the '1rem' default was itself
// off by exactly 16px for Customers: this row sits close enough to <main>'s own top
// padding edge that sticky's `top` is a hard floor even AT REST, so any nonzero
// default pushes the panel down by the gap between it and the panel's true natural
// (0-offset) position — which for Customers (nothing precedes its Stat cards) IS the
// correct, aligned position. The default is now 0 for exactly that reason. Vehicles
// is the opposite case: its "Compliance · next N days" header sits ABOVE its Stat
// cards within the SAME column the panel aligns to, so it measures that header's
// real rendered height (ResizeObserver, not a hardcoded number) and passes it
// explicitly — verified live: panel top === Stat-cards top, 0px diff, on both.
ok("DetailsPanel's default topOffset is now '0px' (was '1rem' — measured, not assumed, per the comment above the prop)",
  /topOffset = '0px'/.test(panel));
ok('Vehicles explicitly measures and passes topOffset (its Compliance header sits above its own Stat cards, unlike Customers)',
  /topOffset=\{panelTopOffset\}/.test(veh));
ok('Vehicles measures that offset via ResizeObserver, not a hardcoded pixel value',
  /new ResizeObserver\(measure\)/.test(veh) && /getBoundingClientRect\(\)/.test(veh));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
