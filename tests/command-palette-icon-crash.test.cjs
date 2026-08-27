/**
 * tests/command-palette-icon-crash.test.cjs
 *
 * Root cause of a full app crash ("Element type is invalid... got: undefined")
 * surfaced by live testing during the global search framework review: found while
 * verifying the Ctrl+K command palette after fixing its useMemo dependency array
 * (search-framework-consistency.test.cjs) — typing a customer name that actually
 * matched a real record crashed the whole app.
 *
 * CommandPalette's `results` array (InventoryDashboard.js) can contain items with
 * `type: 'customer' | 'invoice' | 'jobcard'` (added when customer/invoice/job-card
 * search was layered onto the palette), but its icon lookup map only ever had
 * entries for `part`/`supplier`/`category`/`vehicle`. `icon[r.type]` resolved to
 * `undefined` for the other three types, and `<Ic size={15} .../>` — rendering
 * `undefined` as a component — is exactly what React's "Element type is invalid"
 * error describes. Pre-existing bug, not introduced by this pass; live-verified fix.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const dash = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');

console.log('\nCommandPalette — icon map covers every result type (no undefined-component crash)\n');

const start = dash.indexOf('function CommandPalette');
const block = dash.slice(start, start + 10000);

ok('icon map has an entry for every result type the useMemo can produce (part/supplier/category/vehicle/customer/invoice/jobcard)',
  /const icon = \{ part: Package, supplier: Users, category: Filter, vehicle: Car, customer: User, invoice: Receipt, jobcard: ClipboardList \};/.test(block));
ok('rendering falls back to a safe icon instead of crashing if a future result type is ever added without a matching entry',
  /const Ic = icon\[r\.type\] \|\| Search;/.test(block));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
