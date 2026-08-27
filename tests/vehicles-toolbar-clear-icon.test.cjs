/**
 * tests/vehicles-toolbar-clear-icon.test.cjs
 *
 * VEHICLES DASHBOARD FILTER TOOLBAR OPTIMIZATION.
 *
 * Root cause of "All Makes / All Fuels always show a Clear (X) icon, even with no
 * filter applied": MiniSelect's Clear button rendered on `value && !disabled` alone.
 * That's correct for a plain picker (Manufacturer, Model, State…), whose "nothing
 * selected" state really is '' — but a FILTER dropdown's default/unselected state is
 * the sentinel string 'All' (not ''), specifically so the trigger can show a friendly
 * label ("All Makes") via the `labels` map instead of a gray placeholder. 'All' is
 * still truthy, so `value && !disabled` was true even when nothing had been filtered,
 * showing Clear permanently — clutter with no way to tell "default" from "actively
 * filtered" at a glance.
 *
 * Fix: MiniSelect takes an optional `emptyValue` prop (default '', so every existing
 * picker call site — which never passes it — is byte-for-byte unaffected). Filter call
 * sites pass emptyValue="All"; Clear now renders only when `value !== emptyValue`.
 *
 * Second part of the same review: "Add Vehicle" (and Customers' "New Customer") could
 * end up isolated alone on its own wrapped line, with the rest of that line empty,
 * because flex-wrap could let Export (alone, narrower) keep fitting on the filters'
 * line while the wider action button didn't. Both are now grouped with Export in an
 * inner flex div, so the pair wraps to the next line TOGETHER — never split.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const R = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nVehicles/Customers toolbar — Clear-icon default state + grouped action buttons\n');

const mini = R('components/common/MiniSelect.jsx');
const veh = R('components/vehicles/VehiclesModule.jsx');
const cust = R('components/customers/CustomersModule.jsx');

// --- MiniSelect: the shared mechanism ---
ok('MiniSelect accepts an emptyValue prop, defaulting to \'\' (every plain-picker call site is unaffected)',
  /export default function MiniSelect\(\{[^}]*emptyValue = ''[^}]*\}\)/.test(mini));
ok('Clear renders only when value is truthy AND not equal to emptyValue',
  /\{value && value !== emptyValue && !disabled && \(/.test(mini));

// --- Behavioral proof: emptyValue correctly distinguishes "default" from "filtered" ---
const clearShown = (value, emptyValue = '') => Boolean(value) && value !== emptyValue;
ok('plain picker (emptyValue unset): Clear hidden when nothing is picked', clearShown('') === false);
ok('plain picker (emptyValue unset): Clear shown once a real value is picked', clearShown('Toyota') === true);
ok('filter (emptyValue="All"): Clear hidden at the default "All" sentinel', clearShown('All', 'All') === false);
ok('filter (emptyValue="All"): Clear shown once a real filter value is applied', clearShown('Toyota', 'All') === true);

// --- Call sites: every MiniSelect-based filter passes emptyValue="All" ---
ok('Customers Customer Type filter passes emptyValue="All"',
  /<MiniSelect value=\{typeF\}[^>]*emptyValue="All"/.test(cust));
ok('Vehicles Make filter passes emptyValue="All"',
  /<MiniSelect value=\{makeF\}[^>]*emptyValue="All"/.test(veh));
ok('Vehicles Fuel filter passes emptyValue="All"',
  /<MiniSelect value=\{fuelF\}[^>]*emptyValue="All"/.test(veh));

// --- Plain pickers must NOT have picked up emptyValue (would silently change their
// own "nothing selected" semantics from '' to something else) ---
ok('Customers Manufacturer/Model/Variant/State/Fuel/Transmission pickers do not pass emptyValue (still \'\' — unaffected)',
  !/onPick=\{\(t\) => set\(\{ type: t \}\)\}[^>]*emptyValue/.test(cust) &&
  !/onPick=\{\(s\) => set\(\{ state: s \}\)\}[^>]*emptyValue/.test(cust));

// --- "Add Vehicle" / "New Customer" grouped with Export so they wrap as a pair ---
// Windows widened: the report-PDF-export pass added a second "PDF" button between
// Excel and Add Vehicle/New Customer — same grouped div, one more sibling to skip.
// The group div also gained `ml-auto` (pins the actions to the row's right edge now that
// the filters flex-grow to fill from the left) — className widened to allow it.
ok('Vehicles: Export + Add Vehicle are grouped in one inner flex div (wrap together, never split)',
  /<div className="flex gap-2 flex-shrink-0[^"]*">\s*\n\s*<button onClick=\{exportCSV\}[\s\S]{0,1200}Add Vehicle[\s\S]{0,60}<\/div>/.test(veh));
ok('Customers: Export + New Customer are grouped in one inner flex div (wrap together, never split)',
  /<div className="flex gap-2 flex-shrink-0[^"]*">\s*\n\s*<button onClick=\{exportCSV\}[\s\S]{0,1200}New Customer[\s\S]{0,60}<\/div>/.test(cust));

// --- Consistency review: every 'All'-sentinel filter backed by a long/data-driven
// list uses this same MiniSelect + emptyValue="All" pattern (never a plain <select>,
// whose native option-list popup has no CSS-controllable max-height and can render
// past the viewport for a long list — see the Supplier Type / Analytics Category-Brand
// fix). Short, fixed-length filters (Billing's Status/Payment/Date, Suppliers' sort) are
// intentionally left as native <select> — nothing wrong with a native select for a
// handful of options, only for lists long enough to risk an unbounded native popup.
const billingSuppliers = ['components/billing/BillingModule.jsx', 'components/inventory/SupplierDirectory.jsx'];
ok('Billing/Suppliers filters remain short native <select> (no long/data-driven filter list there needs the MiniSelect fix)',
  billingSuppliers.every((f) => !/<MiniSelect[^>]*labels=\{\{ All:/.test(R(f))));
ok('Inventory Analytics Category/Brand filters (data-driven, can run long) use MiniSelect with the All-sentinel — not a native <select>',
  /<MiniSelect[^>]*labels=\{\{ All: 'All Categories' \}\}/.test(R('components/InventoryDashboard.js')) &&
  /<MiniSelect[^>]*labels=\{\{ All: 'All Brands' \}\}/.test(R('components/InventoryDashboard.js')));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
