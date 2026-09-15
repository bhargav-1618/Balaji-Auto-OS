/**
 * tests/addpart-formvalid-consistency.test.cjs
 *
 * BUG-LIVE-P0-01 regression guard — "Add Part cannot be saved."
 *
 * PartModal (components/InventoryDashboard.js) used to compute two INDEPENDENT
 * validity lists: `partHealth` (the "Part completeness / Ready to save" meter —
 * name/sku/category/vehicle/sellingPrice/purchasePrice/image) and `formValid` (the
 * actual gate on the Save button — name/categories/stock/sellingPrice, and for
 * admins also purchasePrice/minSellingPrice/price-ordering). Neither list was a
 * superset of the other, so a form could read "100% · Ready to save" while
 * `formValid` was still false (missing floor price, or a price-ordering
 * violation) — Save stayed disabled with no visible explanation, since the
 * per-field error messages only populate inside handleSubmit, which a disabled
 * button never lets fire.
 *
 * The fix: both now derive from ONE shared `partChecks` list, so 100%
 * completeness structurally implies formValid === true.
 */
const fs = require('fs');
const path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };

const src = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');

console.log('\nAdd Part — completeness meter and Save gate share one validity contract\n');

// ── 1. Source shape: formValid must be DERIVED from the same list the meter uses,
//    not an independently re-typed set of conditions. ─────────────────────────
ok('one shared checks list (partChecks) feeds both the meter and the Save gate',
  /const partChecks = useMemo\(/.test(src));
ok('partHealth is computed from partChecks (not its own separate check array)',
  /const partHealth = useMemo\(\(\) => \{\s*const done = partChecks\.filter/.test(src));
ok('formValid is derived from partChecks (partMissing), not a separately re-typed condition chain',
  /const formValid = partMissing\.length === 0;/.test(src));
ok('the old independently-duplicated formValid IIFE is gone',
  !/const formValid = \(\(\) => \{[\s\S]{0,50}if \(!form\.name\.trim\(\)\) return false;/.test(src));

// ── 2. The previously-missing required checks now exist in partChecks, so 100%
//    completeness can no longer be reached while they're unmet. ───────────────
ok('partChecks includes the admin floor price requirement (previously only in formValid)',
  /label: 'Min sell \(floor\) price', required: isAdmin, ok: !isAdmin \|\| msp > 0/.test(src));
ok('partChecks includes the admin price-ordering requirement (previously only in formValid)',
  /label: 'Price consistency.*ok: !isAdmin \|\| \(sp >= pp && msp >= pp && msp <= sp\)/.test(src));

// ── 3. Behavioural mirror — recompute the exact new formula for representative
//    form states and assert the old contradiction is structurally impossible. ──
function partChecks(form, isEdit, isAdmin) {
  const pp = parseFloat(form.purchasePrice) || 0;
  const sp = parseFloat(form.sellingPrice) || 0;
  const msp = parseFloat(form.minSellingPrice) || 0;
  const asList = (v) => Array.isArray(v) ? v : (v ? [v] : []);
  return [
    { label: 'Name', required: true, ok: String(form.name || '').trim().length >= 3 && /[a-zA-Z]{3,}/.test(String(form.name || '').trim()) },
    { label: 'Category', required: true, ok: asList(form.categories).length > 0 },
    { label: 'Current stock', required: !isEdit, ok: isEdit || String(form.stock).trim() !== '' },
    { label: 'Selling price', required: true, ok: sp > 0 },
    { label: 'Cost price', required: isAdmin, ok: !isAdmin || pp > 0 },
    { label: 'Min sell (floor) price', required: isAdmin, ok: !isAdmin || msp > 0 },
    { label: 'Price consistency', required: isAdmin, ok: !isAdmin || (sp >= pp && msp >= pp && msp <= sp) },
    { label: 'SKU', required: false, ok: String(form.sku || '').trim().length >= 3 },
    { label: 'Vehicle', required: false, ok: asList(form.compatibleCars).length > 0 },
    { label: 'Image', required: false, ok: !!form.imageString },
  ];
}
function evalForm(form, isEdit, isAdmin) {
  const checks = partChecks(form, isEdit, isAdmin);
  const pct = Math.round((checks.filter((c) => c.ok).length / checks.length) * 100);
  const formValid = checks.filter((c) => c.required).every((c) => c.ok);
  return { pct, formValid };
}

// This EXACT form used to reproduce the live bug: every field the OLD meter
// checked is filled in (name/sku/category/vehicle/sellingPrice/purchasePrice/
// image), but the floor price (minSellingPrice) — which the meter never
// checked — is left blank. Old meter: 100% "Ready to save". Old formValid: false.
const reproForm = {
  name: 'Brake Pad Set', sku: 'BP-001', categories: ['Brakes'], compatibleCars: ['Maruti Swift'],
  sellingPrice: '500', purchasePrice: '300', minSellingPrice: '', imageString: 'data:image/png;base64,x',
};
const repro = evalForm(reproForm, false, true);
ok('the exact old-bug form state no longer claims 100% completeness',
  repro.pct < 100, `pct=${repro.pct}`);
ok('...and Save stays correctly blocked for that same state',
  repro.formValid === false);
ok('completeness % and Save-eligibility never disagree for the repro state (both say "not ready")',
  (repro.pct === 100) === repro.formValid);

// A price-ordering violation (floor > MRP) — filled in, but invalid — must also
// be visible in the completeness score now, not just silently blocking Save.
const orderViolationForm = { ...reproForm, minSellingPrice: '600' }; // floor > MRP(500)
const orderViolation = evalForm(orderViolationForm, false, true);
ok('a price-ordering violation is also reflected in completeness (not 100%)',
  orderViolation.pct < 100);
ok('...and still correctly blocks Save',
  orderViolation.formValid === false);

// A genuinely complete, valid part: 100% and Save enabled must agree.
const validForm = { ...reproForm, minSellingPrice: '350' }; // 300 <= 350 <= 500
const valid = evalForm(validForm, false, true);
ok('a fully valid part reaches 100% completeness', valid.pct === 100, `pct=${valid.pct}`);
ok('...and Save is enabled', valid.formValid === true);

// Non-admin staff never see the pricing-ordering fields as required (existing
// role-specific validation must be preserved exactly).
const staffForm = { name: 'Brake Pad Set', sku: '', categories: ['Brakes'], compatibleCars: [], sellingPrice: '500', purchasePrice: '', minSellingPrice: '', imageString: '' };
const staffResult = evalForm(staffForm, false, false);
ok('non-admin staff: Save is enabled without cost/floor price (role-specific validation preserved)',
  staffResult.formValid === true);

// Editing an existing part never requires re-entering "Current stock".
const editForm = { ...validForm };
const editResult = evalForm(editForm, true, true);
ok('editing an existing part does not require the Current stock field',
  editResult.formValid === true);

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
