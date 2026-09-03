/**
 * tests/addpart-polish.test.cjs
 *
 * Add Part: sequential barcodes, pricing alignment, audit demo message. Behavioural for
 * the barcode logic; source guards for the layout.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');

console.log('\nAdd Part polish — sequential barcode, pricing grid, audit message\n');

// ── sequential barcode logic (mirror of the Gen handler) ───────────────────
const nextBarcode = (inventory) => { const max = inventory.reduce((m, p) => { const mt = /^SBBMC(\d+)$/.exec(p.barcode || ''); return mt ? Math.max(m, parseInt(mt[1], 10)) : m; }, 0); return `SBBMC${String(max + 1).padStart(5, '0')}`; };
ok('first barcode is SBBMC00001', nextBarcode([]) === 'SBBMC00001');
ok('increments from the max existing', nextBarcode([{ barcode: 'SBBMC00007' }, { barcode: 'SBBMC00003' }]) === 'SBBMC00008');
ok('ignores non-matching barcodes', nextBarcode([{ barcode: 'ABC123' }, { barcode: 'SBBMC00002' }]) === 'SBBMC00003');
ok('zero-pads to 5 digits', /^SBBMC\d{5}$/.test(nextBarcode([])));
ok('sequential, not timestamp-based (source no longer uses Date.now slice for barcode)',
  !/barcode: `SBBMC\$\{Date\.now\(\)/.test(src));
ok('source generates the next sequential barcode from inventory',
  /SBBMC\$\{String\(max \+ 1\)\.padStart\(5, '0'\)\}/.test(src));

// ── pricing alignment ──────────────────────────────────────────────────────
ok('pricing grid top-aligns cells (items-start)',
  /grid-cols-4'.*: 'grid-cols-2'\} gap-2 items-start/.test(src));
ok('pricing labels reserve height so inputs share a baseline',
  (src.match(/fieldLabel\} min-h-\[28px\] flex items-end/g) || []).length >= 4);
ok('profit/floor summary uses a centered 3-col grid with divider',
  /grid-cols-\[1fr_auto_1fr\] items-center/.test(src));

// ── audit export demo message ──────────────────────────────────────────────
ok('audit export shows a clear demo message instead of a Firestore error',
  /async function exportAuditLogs\(\) \{\s*if \(demoMode\)/.test(src));



// ── ADDENDUM: freeze-completion items ──────────────────────────────────────
(function freezeCompletion() {
  const s = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');
  ok('Top Selling is a true 3-column grid (Product | Qty | Revenue)',
    (s.match(/grid-cols-\[1fr_auto_auto\]/g) || []).length >= 2);
  ok('Top Selling has a column header row', /Product<\/span>[\s\S]{0,120}Qty<\/span>[\s\S]{0,120}Revenue<\/span>/.test(s));
  ok('Supplier immediate-create handler exists (createSupplierNow)', /function createSupplierNow\(name\)/.test(s));
  // H-9: the container now sources the collection name from COLLECTIONS.SUPPLIERS
  // (constants/index.js) instead of the raw literal — same value, single source of truth.
  // Phase 4b (PH4-06) — the quick-create now writes to a deterministic doc id
  // derived from the name (setDoc merge), so a fire-and-forget retry can't create
  // a second supplier before the live subscription surfaces the first.
  ok('createSupplierNow persists via setDoc to a deterministic suppliers doc id',
    /const quickId = `sup_qc_[\s\S]{0,200}setDoc\(doc\(db, COLLECTIONS\.SUPPLIERS, quickId\)/.test(s));
  ok('createSupplierNow is demo-guarded', /function createSupplierNow[\s\S]{0,200}if \(demoMode\) return/.test(s));
  ok('SupplierPicker.createNew calls onCreateSupplier (immediate availability)',
    /if \(onCreateSupplier\) onCreateSupplier\(name\)/.test(s));
  ok('purchase price keeps step=0.01 (decimals + spinner both work)', /step="0\.01"[\s\S]{0,60}inputMode="decimal"/.test(s));
  ok('purchase price has inputMode=decimal (mobile keypad UX)', /inputMode="decimal"/.test(s));
})();
console.log(`\n  (addendum included above)\n`);

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
