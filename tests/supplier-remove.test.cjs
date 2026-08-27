/**
 * tests/supplier-remove.test.cjs
 *
 * Regression guard for the "Remove Supplier" defect in the Add Part form.
 *
 * PartModal rendered its supplier rows as `form.suppliers.map((row, idx) => <SupplierPicker
 * key={idx} .../>)`. SupplierPicker owns a lot of local state (confirmDelete, editing,
 * draft, open, query, expanded...) that belongs to the CARD, not the DATA. Because
 * `row.id` is empty for a brand-new (unsaved) supplier and `onChange`/`choose`/`createNew`
 * all build fresh row objects rather than spreading the old one, there was no stable
 * identity to key on except position. Removing any row except the LAST one shifts every
 * following row up one slot while keeping the same idx-derived key — React reuses the
 * <SupplierPicker> component INSTANCE in place, so the picker that used to belong to the
 * next supplier inherits the removed row's leftover UI state (most visibly: a delete
 * confirmation card stuck open on the wrong supplier, or an editor showing stale data).
 *
 * PartModal is not exported (too large/stateful to mount standalone in jsdom), so this is
 * a source assertion — same technique used by dropdowns.test.cjs / addpart-polish.test.cjs
 * — verifying the actual shipped wiring: a stable per-row key that survives row objects
 * being replaced wholesale, kept in lockstep by add/remove.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');

console.log('\nAdd Part — "Remove Supplier" stable-identity regression guard\n');

// Isolate the PartModal function body so assertions can't accidentally match some
// unrelated `key={idx}` elsewhere in this 12k-line file.
const start = src.indexOf('function PartModal(');
ok('PartModal function found', start !== -1);
// Grab a generous slice — PartModal is large; the render's supplier list is well within it.
const modalSrc = src.slice(start, start + 60000);

ok('the SupplierPicker list is no longer keyed by array index',
  !/<SupplierPicker\s*\n\s*key=\{idx\}/.test(modalSrc));

ok('a stable per-row key ref is declared',
  /supplierKeysRef\s*=\s*useRef/.test(modalSrc));

ok('the SupplierPicker list is keyed off the stable ref, not idx',
  modalSrc.includes('key={supplierKeysRef.current[idx]'));

ok('addSupplierRow grows the key ref in lockstep with the row array',
  /function addSupplierRow\(\) \{\s*supplierKeysRef\.current = \[\.\.\.supplierKeysRef\.current, nextSupplierKey\(\)\]/.test(modalSrc));

ok('removeSupplierRow shrinks the key ref in lockstep with the row array',
  /function removeSupplierRow\(idx\) \{[\s\S]{0,400}supplierKeysRef\.current = supplierKeysRef\.current\.filter\(\(_, i\) => i !== idx\)/.test(modalSrc));

ok('removeSupplierRow re-keys the collapsed placeholder row (fresh instance, no stale state)',
  /supplierKeysRef\.current = \[nextSupplierKey\(\)\]/.test(modalSrc));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
