/**
 * tests/services-detail-dialog.test.cjs — Services module UX polish: KPI grid orphan
 * avoidance, list row height/hover, sectioned detail, empty values, financial/hours/status.
 * Shared dialog shell (width/sticky/scrollbar/a11y) inherited from LedgerPage (sales pass).
 *
 * Issue 7.7/7.8/7.9 (Stock Operations review) — the shared shell (StatStrip, LedgerRow,
 * the clickable-row wiring, and dialog a11y) moved from InventoryDashboard.js into
 * components/common/LedgerPage.jsx, reused now by the Inventory Stock tab and the
 * per-part Movement History modal too. Services-specific content (sectioning, empty
 * values, financial/hours/status formatting, the CSV-export detail object) stays in
 * InventoryDashboard.js's ServicesView. Assertions split across both files accordingly.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const dash = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');
const ledger = fs.readFileSync(path.resolve(__dirname, '../components/common/LedgerPage.jsx'), 'utf8');

console.log('\nServices module — UX polish\n');

// #1 KPI cards: no isolated card on partial rows (shared StatStrip)
ok('StatStrip picks column count from card count (orphan-safe)', /const lgCols = n % 4 === 0 \? 4 : n % 3 === 0 \? 3/.test(ledger));
// verify logic: 6 cards -> 3 cols -> no orphan
const cols = (n) => (n % 4 === 0 ? 4 : n % 3 === 0 ? 3 : n % 5 === 0 ? 5 : n <= 4 ? n : (n % 2 === 0 ? Math.min(n, 4) : 3));
ok('6 KPI cards land 3-per-row (no orphan)', cols(6) === 3 && (6 % cols(6)) === 0);
ok('5 KPI cards stay 5-per-row', cols(5) === 5);

// #3 list rows (shared LedgerRow + LedgerPage's clickable-row wiring)
ok('row height reduced (py-2.5)', /group flex items-center gap-3 px-3\.5 py-2\.5 rounded-xl/.test(ledger));
ok('subtle hover elevation added', /hover:shadow-lg hover:shadow-black\/20 hover:-translate-y-px/.test(ledger));
ok('whole row remains clickable', /onClick=\{\(\) => setDetail\(it\)\} className="w-full text-left"/.test(ledger));

// #4 sectioned detail (Services)
ok('services detail has sections', /const svc = useMemo[\s\S]{0,4000}sections = \[/.test(dash));
ok('service sections grouped per spec', /title: 'Basic Information'[\s\S]{0,900}title: 'Workshop'[\s\S]{0,600}title: 'Pricing'[\s\S]{0,400}title: 'Financial'[\s\S]{0,400}title: 'Payment'/.test(dash));

// #5 empty values
ok('Discount empty → None', /s\.discount \? num\(`\$\{s\.discount\}%`\) : muted\('None'\)/.test(dash));
ok('GST empty → Not Applicable', /s\.gst \? num\(`\$\{s\.gst\}%`\) : muted\('Not Applicable'\)/.test(dash));
ok('Payment empty → Pending/Collected', /muted\(collected \? 'Collected' : 'Pending'\)/.test(dash));
ok('Technician empty → Not Assigned', /s\.technician \? txt\(s\.technician\) : muted\('Not Assigned'\)/.test(dash));

// #6 financial display
ok('profit green positive / red negative', /profit > 0 \? '#34d399' : profit < 0 \? '#f87171'/.test(dash));
ok('revenue neutral (num, no color)', /\['Revenue', num\(inr\(s\.revenue\)\)\]/.test(dash));
ok('status is a colored badge', /const statusBadge = <span className="inline-block[\s\S]{0,160}rounded-full/.test(dash));
ok('hours formatted (1 hr / 1.5 hrs)', /const hoursLabel = `\$\{hoursVal\} \$\{hoursVal === 1 \? 'hr' : 'hrs'\}`/.test(dash));

// #7 a11y (shared shell)
ok('dialog role/aria-modal/labelledby present', /role="dialog" aria-modal="true" aria-labelledby="ledger-detail-title"/.test(ledger));
ok('Escape closes + focus restore (shared)', /if \(e\.key === 'Escape'\) onClose\(\);/.test(ledger) && /prevFocusRef\.current\?\.focus\?\.\(\);/.test(ledger));

// #8 regression: flat detail preserved for CSV + no calc change
ok('services flat detail preserved for CSV', /'Service Revenue': inr\(s\.revenue\), Profit: inr\(s\.profit\)/.test(dash));
ok('hours source value unchanged in detail', /Hours: s\.hours \|\| s\.qty \|\| 1/.test(dash));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
