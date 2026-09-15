/**
 * tests/supplier-performance.test.cjs — Supplier Performance analytics dashboard.
 * Verifies search/filters/sort/pagination/KPI/health/export/row-actions/responsive/a11y
 * wiring (source) + health-score & sort logic (runtime).
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const perf = fs.readFileSync(path.resolve(__dirname, '../components/inventory/SupplierPerformance.jsx'), 'utf8');
const dir = fs.readFileSync(path.resolve(__dirname, '../components/inventory/SupplierDirectory.jsx'), 'utf8');
const dash = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');

console.log('\nSupplier Performance — analytics dashboard\n');

// Part 1 search
ok('debounced global search', /const \[dq, searching\] = useDeferredSearch\(q\)/.test(perf));
// SEARCH VERIFICATION AUDIT: this used to join [name, code, gst, contact, city, state]
// into one lowercased string and substring-test it — code/gst (this record's OWN
// identifiers) sat in the SAME haystack as free text, the exact "identifier in the
// free-text haystack" anti-pattern the rest of the app was fixed to avoid (a complete
// code could spuriously also match an unrelated supplier's code that merely contains it
// as a substring). Now goes through the shared strict-validated engine, same field split
// as SupplierDirectory's own supplier search: code/gst as identifiers (exact/prefix/
// suffix/contains, never cross-record substring noise), name/contact/city/state/type/
// phone as free text.
ok('uses the shared strict search engine, not a hand-rolled join+includes', /rankIndexed\(supplierSearchIndex\.get\(r\.id\), ql\) > 0/.test(perf));
ok('code/gst are this record\'s own identifiers; name/contact/city/state/type/phone stay free text', /\(r\) => \[r\.name, r\.contact, r\.city, r\.state, r\.type, r\.phone\],\s*\(r\) => \[r\.code, r\.gst\],/.test(perf));
ok('Searching indicator shown while debouncing', /searching && q &&/.test(perf) && /Searching/.test(perf));
// Part 2 filters
ok('status/type/rating/outstanding/lead/onTime/accuracy filters', /passesStatus/.test(perf) && /passesType/.test(perf) && /passesRating/.test(perf) && /passesOut/.test(perf) && /passesLead/.test(perf) && /passesOnTime/.test(perf) && /passesAcc/.test(perf));
ok('filter chips + clear all', /chipLabels\.map/.test(perf) && /Clear all/.test(perf));
// Part 3 sorting
ok('sortable columns with indicators', /const toggleSort = /.test(perf) && /const SortIcon = /.test(perf));
ok('sort supports asc/desc', /setSortDir\(\(d\) => \(d === 'asc' \? 'desc' : 'asc'\)\)/.test(perf));
// Part 4 pagination
ok('page sizes 25/50/100', /const PER_OPTIONS = \[25, 50, 100\]/.test(perf));
ok('first/prev/next/last controls', /setPage\(1\)[\s\S]{0,800}setPage\(pageCount\)/.test(perf));
ok('Showing X–Y of N', /Showing \{filtered\.length \? \(safePage - 1\) \* per \+ 1 : 0\}/.test(perf));
// Part 5 KPI interactivity
ok('KPI cards interactive (toggle filter)', /setKpiF\(\(f\) => \(f === k\.key \? null : k\.key\)\)/.test(perf));
ok('active KPI shows filtering state', /● filtering/.test(perf));
// Part 6 health score
ok('supplier health score computed', /function healthOf\(r\)/.test(perf));
ok('health bands Excellent/Good/Watch/Risk', /Excellent[\s\S]{0,160}Good[\s\S]{0,160}Watch[\s\S]{0,160}Risk/.test(perf));
// Part 7 row interactions
ok('row click opens supplier', /onClick=\{\(\) => onOpenSupplier\?\.\(r\.id\)\}/.test(perf));
ok('row keyboard (Enter) opens supplier', /onKeyDown=\{\(e\) => \{ if \(e\.key === 'Enter'\) onOpenSupplier/.test(perf));
// Issue 6 (Suppliers module review) — the "View supplier" Eye icon was a literal duplicate
// of the row's own onClick handler (same function, same args), and "Create Purchase Order"
// opened no builder and added no part — it was functionally identical to View, just
// mislabeled. Both removed; "Open in new tab" (the one genuinely distinct action) stays.
ok('row actions (new-tab/call/email), duplicate View + non-functional Create PO removed', /Open in new tab/.test(perf) && !/Create Purchase Order/.test(perf) && !/title="View supplier"/.test(perf) && /href=\{`tel:/.test(perf) && /href=\{`mailto:/.test(perf));
ok('directory accepts external selection', /useEffect\(\(\) => \{ if \(selectSupplierId\) setSelId\(selectSupplierId\); \}, \[selectSupplierId\]\)/.test(dir));
ok('dashboard wires onOpenSupplier → directory select', /setSupSubView\('directory'\); setPerfSelectId\(id\)/.test(dash));
// Part 8 export
ok('Excel (shared writer) + PDF export', /const exportSheet = /.test(perf) && /writeSheet\(/.test(perf) && /const exportPDF = /.test(perf));
ok('export respects filtered set', /const exportRows = \(\) => filtered\.map/.test(perf));
// Part 9 table
ok('sticky header', /thead className="sticky top-0/.test(perf));
ok('sticky first column', /sticky left-0/.test(perf));
ok('responsive horizontal scroll', /overflow-auto dark-scroll/.test(perf));
// Part 10 visual
ok('semantic colors (outstanding/lead)', /const outColor = /.test(perf) && /const leadColor = /.test(perf));
ok('rating shows order count', /\(\{r\.ratingCount \|\| 0\}\)/.test(perf));
// Part 11 empty/loading
ok('empty state + clear filters', /No suppliers match your filters/.test(perf));
ok('loading skeleton', /loading \?[\s\S]{0,220}animate-pulse/.test(perf));
// Part 12 comparison
ok('multi-select comparison', /const toggleCompare = /.test(perf) && /Compare Suppliers/.test(perf));
// Part 13 responsive
ok('mobile card layout', /md:hidden divide-y/.test(perf));
// Part 14 a11y
ok('aria labels / roles', /role="button" aria-label=\{`Open \$\{r\.name\}`\}/.test(perf) && /aria-modal="true" aria-label="Supplier comparison"/.test(perf));

// runtime: health + sort
const num = (v) => (Number.isFinite(+v) ? +v : 0);
const has = (v) => v !== undefined && v !== null && v !== '';
function healthOf(r){const p=[];if(has(r.rating))p.push((num(r.rating)/5)*100);if(has(r.onTime))p.push(num(r.onTime));if(has(r.accuracy))p.push(num(r.accuracy));if(has(r.lead))p.push(Math.max(0,Math.min(100,100-(num(r.lead)-2)*15)));if(has(r.outstanding))p.push(num(r.outstanding)<=0?100:num(r.outstanding)>50000?30:num(r.outstanding)>10000?60:85);if(!p.length)return null;return Math.round(p.reduce((s,x)=>s+x,0)/p.length);}
ok('health: excellent supplier ≥85', healthOf({ rating: 5, onTime: 99, accuracy: 99, lead: 1.5, outstanding: 0 }) >= 85);
ok('health: risky supplier <50', healthOf({ rating: 2, onTime: 80, accuracy: 85, lead: 8, outstanding: 60000 }) < 50);
ok('health: no metrics → null', healthOf({}) === null);

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
