/**
 * tests/customers-vehicles-wide-toolbar.test.cjs
 *
 * "Toolbar row ends too early, leaving unused space before the Details panel."
 *
 * Rejected approaches (kept documented so neither is silently reintroduced):
 *   1. Bumping individual dropdown widths (fixed, then 2xl:-gated) — rejected: doesn't
 *      generalize, needed viewport-specific hacks, and the user explicitly said "the
 *      issue is NOT the width of the dropdowns."
 *   2. Per-control flex-grow (flex-1 + min-w/max-w on each filter) — rejected: still
 *      "individual controls declaring their own growth," not the parent container.
 *
 * Final approach: a PARENT-DRIVEN split. The outer row is `flex`, with the filter
 * cluster wrapped in one `flex-1` div (claims 100% of the row's leftover width —
 * decided by the parent flex row, not by any individual filter) and the action-button
 * cluster as a sibling `flex-shrink-0` div (takes only the width its buttons need).
 * Inside the filter cluster, a CSS Grid — `gridTemplateColumns:
 * 'repeat(auto-fit, minmax(Xrem, 1fr))'` — lets the GRID algorithm size and fill the
 * tracks, not per-item flex-grow declarations. Net result, live-measured at 1920px:
 * the whole row (filters + actions) now terminates EXACTLY flush with the table column
 * (row.right === actionGroup.right, 0px gap), with only the normal 16px inter-column
 * gap before the Details panel — same as the gap below the row and the table itself.
 * Vehicles' 4 equal filter tracks came out ~191px each; Customers' 2 came out ~379px
 * each (Customers has only 2 filters, so the grid — correctly — gives each more room).
 * No breakpoints, no per-control width class of any kind remains.
 *
 * Mobile QA fix (phone widths): the filter cluster originally also carried `min-w-0`,
 * which let the flex item shrink narrower than its own grid's minmax(Xrem,...) tracks
 * actually need. At phone widths that meant the grid overflowed its shrunk box and
 * rendered ON TOP of the action-button cluster instead of the outer `flex-wrap` pushing
 * that cluster to its own line. Dropping `min-w-0` fixes the phone-width overlap without
 * touching the 1920px flush-alignment behavior above — min-w-0 only ever mattered when
 * space was constrained, which 1920px never was.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const R = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nCustomers/Vehicles toolbar — parent-driven grid fill (no per-control widths, no breakpoints)\n');

const veh = R('components/vehicles/VehiclesModule.jsx');
const cust = R('components/customers/CustomersModule.jsx');

// --- Vehicles: filter cluster is a flex-1 grid container, 4 filters as plain grid items ---
ok('Vehicles filter cluster is flex-1 (parent flex row decides its width, not the filters)',
  /<div className="flex-1 grid gap-2" style=\{\{ gridTemplateColumns: 'repeat\(auto-fit, minmax\(9rem, 1fr\)\)' \}\}>/.test(veh));
// Widened from 200: placeholder/labels now route through lib/i18n.js's
// t('key', 'English fallback') calls, which are longer than the plain string
// literals this distance was originally tuned for — same structural check either way.
ok('Vehicles Make/Fuel MiniSelects are plain grid items (no width wrapper div, no fixed inputCls override)',
  /<MiniSelect value=\{makeF\}[\s\S]{0,350}inputCls=\{inputCls\} \/>/.test(veh) && /<MiniSelect value=\{fuelF\}[\s\S]{0,350}inputCls=\{inputCls\} \/>/.test(veh));
ok('Vehicles action group (Excel/PDF/Add Vehicle) is a sibling flex-shrink-0 cluster, not part of the grid',
  /<\/div>\s*\n\s*\{\/\* Export \+ Add Vehicle grouped[\s\S]{0,700}<div className="flex gap-2 flex-shrink-0">/.test(veh));

// --- Customers: same structure, 2 filters ---
ok('Customers filter cluster is flex-1 (parent flex row decides its width, not the filters)',
  /<div className="flex-1 grid gap-2\.5" style=\{\{ gridTemplateColumns: 'repeat\(auto-fit, minmax\(13rem, 1fr\)\)' \}\}>/.test(cust));
// Widened from 200 for the same t()-call-length reason as the Vehicles assertion above.
ok('Customers Type MiniSelect is a plain grid item',
  /<MiniSelect value=\{typeF\}[\s\S]{0,350}inputCls=\{inputCls\} \/>/.test(cust));
ok('Customers action group (Excel/PDF/New Customer) is a sibling flex-shrink-0 cluster, not part of the grid',
  /<\/div>\s*\n\s*\{\/\* Grouped so flex-wrap moves Export[\s\S]{0,500}<div className="flex gap-2 flex-shrink-0">/.test(cust));

// --- No leftover per-control width classes or breakpoint hacks from either rejected attempt ---
ok('no 2xl:-gated filter widths remain in either toolbar (first rejected attempt)',
  !/2xl:w-\d/.test(veh) && !/2xl:!w-\d/.test(veh) && !/2xl:w-\d/.test(cust) && !/2xl:!w-\d/.test(cust));
ok('no per-control flex-1/min-w/max-w width classes remain on individual filters (second rejected attempt — superseded by the grid)',
  !/inputCls\} flex-1 min-w-\[9rem\] max-w-\[15rem\]`/.test(veh) && !/inputCls\} flex-1 min-w-\[10rem\] max-w-\[15rem\]`/.test(veh) &&
  !/inputCls\} flex-1 min-w-\[9rem\] max-w-\[15rem\]`/.test(cust));
ok('no fixed sm:w-* / !w-* filter widths remain anywhere on the Row-2 filters',
  !/inputCls\} sm:w-\d/.test(veh) && !/inputCls\} sm:w-\d/.test(cust) &&
  !/inputCls\} !w-\d/.test(veh) && !/inputCls\} !w-\d/.test(cust));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
