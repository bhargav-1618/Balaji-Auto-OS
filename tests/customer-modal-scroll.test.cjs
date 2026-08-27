/**
 * tests/customer-modal-scroll.test.cjs
 *
 * Root cause of "with multiple vehicles, the modal scrolls underneath the fixed header
 * and the first vehicle card becomes partially hidden": the scrollable body pane
 * (`overflow-y-auto`) is a flex ITEM inside a flex row/column. Flex items default to
 * `min-height: auto` — "at least as tall as my content" — REGARDLESS of the parent
 * having its own `min-h-0`. With several vehicle cards stacked up, that let the pane
 * grow to fit ALL of them instead of being capped to the modal's available height; the
 * excess then got clipped by the outer modal's `max-h-[94vh] overflow-hidden` rather
 * than scrolling cleanly inside the pane itself — reading as content moving underneath
 * the fixed header instead of a normal contained scroll.
 *
 * Fix: add `min-h-0` directly on the scrollable pane (not just its ancestor), in both
 * the Customer Wizard's multi-vehicle step and the standalone single-vehicle
 * Add/Edit modal (same structural bug, same fix).
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/customers/CustomersModule.jsx'), 'utf8');

console.log('\nCustomers — modal scroll containment (min-h-0 on the scroll pane)\n');

// CustomerWizard: the step body (Basic Info / Address / Business / Vehicles / Notes).
ok('CustomerWizard scroll pane has min-h-0 (not just min-w-0)',
  /flex-1 min-w-0 min-h-0 overflow-y-auto dark-scroll p-5/.test(src));
ok('the fixed header above it stays flex-shrink-0 (does not itself scroll)',
  /flex items-center justify-between px-5 py-3\.5 flex-shrink-0/.test(src));
ok('the row wrapping [step nav | scroll pane] still has its own min-h-0 (parent chain intact)',
  /flex-1 min-h-0 flex flex-col sm:flex-row/.test(src));

// VehicleModal: same structural pattern, same fix.
ok('VehicleModal scroll pane also has min-h-0',
  /flex-1 min-h-0 overflow-y-auto dark-scroll p-5 grid grid-cols-2 gap-3/.test(src));

// Outer modal caps stay intact — min-h-0 fixes containment, it must not remove the
// overall height cap that keeps the modal itself on-screen.
ok('CustomerWizard modal is a fixed-height flex box capped to the viewport (so header/footer stay pinned, only body scrolls)',
  /h-\[100dvh\] sm:h-auto max-h-\[100dvh\] sm:max-h-\[calc\(100dvh-2rem\)\] flex flex-col rounded-t-2xl/.test(src));
ok('CustomerWizard overlay does NOT scroll (a scrolling overlay + my-auto is what pushed the header off-screen)',
  /flex items-end sm:items-center justify-center p-0 sm:p-4"/.test(src) && !/overflow-y-auto overscroll-contain/.test(src.split('flex items-end sm:items-center')[1].slice(0,200)));
ok('VehicleModal keeps its max-h-[92vh] cap', /max-h-\[92vh\] flex flex-col rounded-t-2xl/.test(src));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
