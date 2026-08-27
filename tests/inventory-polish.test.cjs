/**
 * tests/inventory-polish.test.cjs — Inventory parts list UX polish: row density, SKU
 * hierarchy, right-aligned price, hover, KPI compression. Visual/source-level (no logic).
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const dash = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');

// scope to the parts table region
const tbody = dash.indexOf('<tbody>');
const start = dash.indexOf('{pagedInventory.map((part) => (', tbody);
const rowRegion = dash.slice(start, dash.indexOf('</tbody>', start));

console.log('\nInventory — parts list polish\n');

// #1 density
ok('row cells reduced to py-2.5 (was py-3)', /px-4 py-2\.5/.test(rowRegion));
ok('no leftover py-3 <td> cells in the row body', !/<td className="px-4 py-3/.test(rowRegion));

// #2 SKU hierarchy
ok('SKU more visible (white/70, mono)', /text-white\/70 font-mono text-\[13px\] tracking-tight/.test(dash));
ok('product name still primary (bold white)', /font-medium text-white">\{part\.name\}/.test(dash));

// #3 alignment
ok('price column right-aligned with fixed width + tabular', /whitespace-nowrap text-right" style=\{\{ width: 120 \}\}[\s\S]{0,400}tabular-nums/.test(dash));
ok('Selling/Floor header right-aligned (Issue 6.7 — was mislabeled "MRP / Floor" while actually showing sellingPrice)', /\{ label: 'Selling \/ Floor', key: 'sellingPrice', align: 'right' \}/.test(dash));
ok('header respects align', /\$\{align === 'right' \? 'text-right' : 'text-left'\}/.test(dash));

// #4 hover
ok('row hover: background lift + group', /group transition-colors align-middle[\s\S]{0,120}hover:bg-white\/\[0\.05\]/.test(dash));

// #5 KPI compression
ok('KPI cards padding reduced (p-3.5)', /rounded-2xl p-3\.5 backdrop-blur-sm transition/.test(dash));
ok('KPI section margin reduced (mb-4)', /lg:grid-cols-5 gap-3 mb-4/.test(dash));

// #12 regression: interactive elements intact
// Settings QA fix: StockStepper gained canChangeStock/onBlocked so the demo
// "Change Stock" permission can block the quick +/- stepper BEFORE its own
// optimistic value update fires (a block after the fact left the input showing
// a number that never actually applied). Same component, same wiring, two new props.
ok('stock stepper untouched (plus the demo changeStock permission gate)', /<StockStepper part=\{part\} onCommit=\{commitStock\} onSell=\{handleSellClick\} canChangeStock=\{!demoMode \|\| demoAdmin \|\| !!demoPerms\.changeStock\} onBlocked=\{\(\) => protectedDemoToast\(true\)\} \/>/.test(dash));
ok('edit/restock/adjust/history actions intact', /setRestockTarget\(part\)/.test(dash) && /setAdjustTarget\(part\)/.test(dash) && /setLedgerTarget\(part\)/.test(dash) && /setEditPart\(part\)/.test(dash));
ok('selection checkbox intact', /checked=\{selectedIds\.has\(part\.id\)\}/.test(dash));
ok('price value unchanged (formatINR(part.sellingPrice))', /formatINR\(part\.sellingPrice\)/.test(dash));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
