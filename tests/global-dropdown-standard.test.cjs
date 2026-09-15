/**
 * tests/global-dropdown-standard.test.cjs
 *
 * App-wide dropdown consistency pass (requirement 15/16 of the final Customer Module
 * review). Found via a full-repo audit for the exact "mousedown + ref.contains() on a
 * non-portal ref" anti-pattern already proven (via live click-testing in a prior pass)
 * to silently drop portal-rendered dropdown selections: two more live instances beyond
 * the one already fixed in VehiclesModule's old local MiniSelect —
 *   1. InventoryPurchaseOrders.jsx's `DarkSelect` (actively used by the PO-create
 *      supplier/priority pickers)
 *   2. VehiclesModule.jsx's VehicleWizard "Owner (Customer)" picker
 * Both render their option list through the portalled <DropdownPanel>, so the local
 * `document.addEventListener('mousedown', ...)` checking only the trigger's own ref
 * treats every mousedown on an option as "outside" and closes the panel before the
 * click can register — the panel's own useOutsideClose (DropdownPanel.jsx) already
 * does this correctly (checks both anchor AND portalled panel), making the local
 * handler both redundant and actively wrong. Removed both; DropdownPanel now owns
 * outside-close for these too, matching every other dropdown in the app.
 *
 * A third finding: `VehicleSelect` in JobCardModule.jsx has the identical bug pattern
 * but is dead code (never rendered — CascadeVehicleSelect/MiniSelect replaced it
 * before this file was ever touched) — zero runtime impact, left alone as noted in the
 * report rather than touched speculatively.
 *
 * Also fixes a literal copy-paste duplicate: CONTACT_LABELS was defined twice
 * (identical values) inside two separate component functions in
 * components/InventoryDashboard.js — hoisted to one module-level constant.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const R = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nGlobal dropdown standard — outside-click consistency + dataset dedup\n');

const po = R('components/inventory/InventoryPurchaseOrders.jsx');
const veh = R('components/vehicles/VehiclesModule.jsx');
const dash = R('components/InventoryDashboard.js');

// --- DarkSelect (Purchase Order supplier/priority pickers) ---
ok('DarkSelect no longer has its own mousedown outside-click handler',
  !/const onDoc = \(e\) => \{ if \(ref\.current && !ref\.current\.contains\(e\.target\)\) \{ setOpen\(false\); setQ\(''\); \} \};/.test(po));
ok('DarkSelect still renders its options through the portalled DropdownPanel (outside-close now owned there)',
  /<DropdownPanel anchorRef=\{ref\} open onClose=\{\(\) => \{ setOpen\(false\); setQ\(''\); \}\}/.test(po));

// --- VehicleWizard owner (customer) picker ---
ok('VehicleWizard owner picker no longer has its own mousedown outside-click handler',
  !/const d = \(e\) => \{ if \(custRef\.current && !custRef\.current\.contains\(e\.target\)\) setCustOpen\(false\); \};/.test(veh));
ok('VehicleWizard owner picker still renders through the portalled DropdownPanel',
  /<DropdownPanel anchorRef=\{custRef\} open onClose=\{\(\) => \{ setCustOpen\(false\); setCustQ\(''\); \}\}/.test(veh));

// --- CONTACT_LABELS dedup ---
const contactLabelDefs = (dash.match(/CONTACT_LABELS = \['Primary', 'WhatsApp', 'Landline', 'Owner', 'Accounts', 'Workshop', 'Manager'\]/g) || []).length;
ok('CONTACT_LABELS is now defined exactly once (was duplicated verbatim in two component functions)',
  contactLabelDefs === 1, `found ${contactLabelDefs} definitions`);

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
