/**
 * tests/row-badges.test.cjs — Sales/Services list rows no longer show redundant coarse
 * type badges. Sales shows the real inventory category when meaningful (else none);
 * Services removes the badge (no finer category in the data model).
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const dash = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');

console.log('\nSales/Services — redundant type badge removal\n');

// Sales: real category badge, coarse suppressed
ok('Sales computes a meaningful category badge', /const badgeCat = fineCat && fineCat !== cat && fineCat !== 'Parts' && fineCat !== 'Outside Purchase'/.test(dash));
ok('Sales row renders badge only when meaningful', /\{badgeCat \? <span className="text-\[9px\] font-bold[\s\S]{0,140}\{badgeCat\}<\/span> : null\}/.test(dash));
ok('Sales no longer hardcodes {cat} as the badge', !/>\{cat\}<\/span><\/span>\} sub=\{`\$\{dstr\(s\.createdAt\)\}\$\{s\.invoiceNo/.test(dash));

// logic: real vs coarse
const badge = (s, cat) => { const fine = (s.category || '').trim(); return (fine && fine !== cat && fine !== 'Parts' && fine !== 'Outside Purchase') ? fine : null; };
ok('real category (Engine) shows', badge({ category: 'Engine' }, 'Parts') === 'Engine');
ok('coarse "Parts" suppressed', badge({ category: 'Parts' }, 'Parts') === null);
ok('"Outside Purchase" suppressed', badge({ category: 'Outside Purchase' }, 'Outside Purchase') === null);
ok('missing category → no badge', badge({}, 'Parts') === null);

// Services: badge removed entirely
ok('Services row has no category badge', /row: <LedgerRow left=\{<span className="flex items-center gap-2">\{s\.name\}<\/span>\}/.test(dash));
ok('Services unused catColor helper removed', !/const catColor = \(c\) => \(\{ Labour: '#f472b6', Service: '#a78bfa' \}/.test(dash));

// Regression: category still available in detail dialogs + CSV, revenue untouched
ok('Sales detail still shows Category row', /\['Category', txt\(cat\)\], \['Part', txt\(s\.name\)\]/.test(dash));
ok('Services detail still shows Category row', /\['Category', txt\(cat\)\], \['Service', txt\(s\.name\)\]/.test(dash));
ok('Sales CSV detail unchanged (Category/Revenue/Profit)', /Category: cat, Part: s\.name[\s\S]{0,600}Revenue: inr\(s\.revenue\), Profit: inr\(s\.profit\)/.test(dash));
ok('Services CSV detail unchanged (Category/Revenue/Profit)', /Category: cat, Service: s\.name[\s\S]{0,500}'Service Revenue': inr\(s\.revenue\), Profit: inr\(s\.profit\)/.test(dash));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
