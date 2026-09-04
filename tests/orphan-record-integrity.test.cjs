/**
 * tests/orphan-record-integrity.test.cjs
 *
 * PHASE 9 — ORPHAN-RECORD / BROKEN-RELATIONSHIP INTEGRITY.
 *
 * Central question for every "parent deleted, child still references it"
 * relationship in the app: does the child stay readable, editable, and
 * financially/inventory-correct — with NO crash and NO resurrection of the
 * deleted parent?
 *
 * Method: the same source-pattern audit convention established in Phase
 * 5/6/7/8 (this Node/CJS harness never mounts the real React components; it
 * proves claims by matching exact source text) plus pure-JS re-implementations
 * of the two confirmed defects' exact write sequences, run against a mocked
 * Firestore transaction that throws on tx.update() against a missing document
 * — exactly like real Firestore does — to demonstrate the before/after
 * behavior.
 *
 * `ok()` = proven-safe relationship (ALLOWED INTENTIONALLY, or a confirmed
 * defect now FIXED). `defect()` = a confirmed broken relationship not yet
 * fixed.
 */
const fs = require('fs');
const path = require('path');

let PASS = 0, FAIL = 0, DEFECTS = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const defect = (name, isFixed, detail = '') => {
  if (isFixed) { PASS++; console.log(`  ✓ [was a defect, now fixed] ${name}`); }
  else { DEFECTS++; console.log(`  ⚠ [DEFECT — broken relationship] ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const dash = read('../components/InventoryDashboard.js');
const billing = read('../components/billing/BillingModule.jsx');
const jobcards = read('../components/jobcards/JobCardModule.jsx');
const vehicles = read('../components/vehicles/VehiclesModule.jsx');
const customersMod = read('../components/customers/CustomersModule.jsx');
const poService = read('../services/purchaseOrderService.js');
const pdfLib = read('../lib/workshopInvoicePdf.js');

const slice = (src, a, b) => {
  const s = src.indexOf(a); if (s < 0) return '';
  const e = b ? src.indexOf(b, s + a.length) : -1;
  return src.slice(s, e > s ? e : s + 6000);
};

console.log('\nPHASE 9 — orphan-record / broken-relationship integrity\n');

// =====================================================================
// 1 — PART DELETED -> INVOICE REALIZATION (PH9-01) — FIXED
// =====================================================================
console.log('1  Part deleted -> invoice realization no longer aborts (PH9-01)\n');

ok('PH9-01 FIXED [fact]: resolveExistingPartIds resolves part existence via tx.get, called before any write, in every invoice transaction',
  /const resolveExistingPartIds = async \(tx, stockDeltas\) => \{/.test(dash)
  && /const snaps = await Promise\.all\(ids\.map\(\(id\) => tx\.get\(doc\(db, COLLECTIONS\.PARTS, id\)\)\)\);/.test(dash)
  && /return new Set\(ids\.filter\(\(_, i\) => snaps\[i\]\.exists\(\)\)\);/.test(dash));

ok('PH9-01 FIXED [fact]: applyRealizationPlanInTx skips a stock delta whose part id is not in existingPartIds instead of calling tx.update on a missing doc',
  /const applyRealizationPlanInTx = \(tx, plan, existingPartIds\) => \{\s*\n\s*Object\.entries\(plan\.stockDeltas\)\.forEach\(\(\[partId, delta\]\) => \{\s*\n\s*if \(!existingPartIds\.has\(partId\)\) return;/.test(dash));

const createInvTx = slice(dash, 'const createInvoiceTransactional = async (target) => {', 'const editInvoiceTransactional');
const editInvTx = slice(dash, 'const editInvoiceTransactional = async (target, expectedRev) => {', 'const persistInvoice = async (iv) => {');
const payTxn = slice(dash, 'const collectInvoicePayment = async (invoiceId, pay) => {', 'const deleteInvoiceTransactional = async (iv) => {');
const delTx = slice(dash, 'const deleteInvoiceTransactional = async (iv) => {', 'const deleteInvoice = async (iv) => {');

ok('PH9-01 FIXED: createInvoiceTransactional resolves existingPartIds BEFORE tx.set(invRef, ...) — reads still precede every write in this transaction',
  /const existingPartIds = await resolveExistingPartIds\(tx, plan\.stockDeltas\);[\s\S]{0,200}tx\.set\(invRef,/.test(createInvTx)
  && /applyRealizationPlanInTx\(tx, plan, existingPartIds\);/.test(createInvTx));

ok('PH9-01 FIXED: editInvoiceTransactional resolves existingPartIds BEFORE tx.set(invRef, ..., { merge: true })',
  /const existingPartIds = await resolveExistingPartIds\(tx, plan\.stockDeltas\);[\s\S]{0,200}tx\.set\(invRef,[\s\S]{0,100}\{ merge: true \}\);/.test(editInvTx)
  && /applyRealizationPlanInTx\(tx, plan, existingPartIds\);/.test(editInvTx));

ok('PH9-01 FIXED: collectInvoicePayment resolves existingPartIds BEFORE tx.update(invRef, ...) — a first payment that realizes a since-deleted part\'s line no longer aborts the whole payment',
  /const existingPartIds = await resolveExistingPartIds\(tx, plan\.stockDeltas\);[\s\S]{0,100}tx\.update\(invRef, \{/.test(payTxn)
  && /applyRealizationPlanInTx\(tx, plan, existingPartIds\);/.test(payTxn));

ok('PH9-01 FIXED: deleteInvoiceTransactional resolves existingPartIds BEFORE tx.delete(invRef) — deleting a paid invoice whose part was later hard-deleted no longer aborts',
  /const existingPartIds = await resolveExistingPartIds\(tx, plan\.stockDeltas\);[\s\S]{0,100}tx\.delete\(invRef\);/.test(delTx)
  && /applyRealizationPlanInTx\(tx, plan, existingPartIds\);/.test(delTx));

// Pure-model proof: mirrors real Firestore's actual behavior (tx.update on a
// missing document throws "No document to update", aborting the WHOLE
// transaction — every other queued write in that same callback is discarded
// too), and proves the NEW existingPartIds-gated write no longer throws.
function mockFirestoreUpdate(existingDocIds, docId) {
  if (!existingDocIds.has(docId)) {
    const e = new Error(`No document to update: ${docId}`);
    e.code = 'not-found';
    throw e;
  }
  return { ok: true };
}
function oldApplyRealizationPlanInTx_UNGATED(existingDocIds, stockDeltas) {
  // The pre-PH9-01 shape: unconditional tx.update per stockDelta entry.
  const written = [];
  Object.keys(stockDeltas).forEach((partId) => {
    mockFirestoreUpdate(existingDocIds, partId);
    written.push(partId);
  });
  return written;
}
function newApplyRealizationPlanInTx_GATED(existingDocIds, stockDeltas) {
  const written = [];
  Object.keys(stockDeltas).forEach((partId) => {
    if (!existingDocIds.has(partId)) return; // PH9-01 fix
    mockFirestoreUpdate(existingDocIds, partId);
    written.push(partId);
  });
  return written;
}
{
  const existingParts = new Set(['part-A']); // part-B was hard-deleted
  const stockDeltas = { 'part-A': -2, 'part-B': -1 };

  let threwOld = false;
  try { oldApplyRealizationPlanInTx_UNGATED(existingParts, stockDeltas); } catch { threwOld = true; }
  ok('MANDATORY MATRIX (PH9-01) — BEFORE the fix: an unconditional tx.update against a hard-deleted part throws and would abort the ENTIRE invoice transaction (money + the OTHER, still-existing part\'s stock)',
    threwOld);

  let threwNew = false; let written = null;
  try { written = newApplyRealizationPlanInTx_GATED(existingParts, stockDeltas); } catch { threwNew = true; }
  ok('MANDATORY MATRIX (PH9-01) — AFTER the fix: the same plan commits — the still-existing part\'s stock delta is written, the deleted part\'s delta is silently skipped, nothing throws',
    !threwNew && written.length === 1 && written[0] === 'part-A');
}

// =====================================================================
// 2 — PART DELETED -> PO RECEIVING (PH9-02) — FIXED
// =====================================================================
console.log('\n2  Part deleted -> PO receiving no longer aborts (PH9-02)\n');

const poReceiveFn = slice(poService, 'export function poReceiveDoc(po, receivedLines, userEmail, receiptId) {', 'export function poCancelDoc');

ok('PH9-02 FIXED [fact]: poReceiveDoc reads every received line\'s part doc (tx.get) BEFORE issuing the PO update — a read, not a blind tx.update',
  /const activeLines = \(receivedLines \|\| \[\]\)\.filter\(\(line\) => line\.partId && n\(line\.receiveQty\) > 0\);/.test(poReceiveFn)
  && /const partSnaps = await Promise\.all\(activeLines\.map\(\(line\) => tx\.get\(doc\(db, 'parts', line\.partId\)\)\)\);/.test(poReceiveFn)
  && /const existingPartIds = new Set\(activeLines\.filter\(\(_, i\) => partSnaps\[i\]\.exists\(\)\)\.map\(\(line\) => line\.partId\)\);/.test(poReceiveFn)
  && /tx\.update\(poRef, poUpdate\);/.test(poReceiveFn));

ok('PH9-02 FIXED [fact]: the part-existence reads happen BEFORE tx.update(poRef, ...) — the first write in this transaction — satisfying Firestore\'s read-before-write rule',
  poReceiveFn.indexOf('const partSnaps = await Promise.all') < poReceiveFn.indexOf('tx.update(poRef, poUpdate);')
  && poReceiveFn.indexOf('const partSnaps = await Promise.all') > poReceiveFn.indexOf('const { items: nextItems, status, fullyReceived, over }'));

ok('PH9-02 FIXED [fact]: a line whose part is gone still gets its restock-ledger entry (historical record preserved, same policy as sales/audit history) — only the catalog stock tx.update is skipped',
  /activeLines\.forEach\(\(line\) => \{\s*\n\s*if \(existingPartIds\.has\(line\.partId\)\) \{/.test(poReceiveFn)
  && /tx\.set\(doc\(collection\(db, 'restocks'\)\), \{/.test(poReceiveFn));

// Pure-model proof, mirroring poReceiveDoc's actual per-line loop.
function mockPoReceiveLines(existingPartIds, lines) {
  const restocked = [];
  const stockUpdated = [];
  lines.forEach((line) => {
    if (existingPartIds.has(line.partId)) {
      mockFirestoreUpdate(existingPartIds, line.partId); // would throw pre-fix if ungated
      stockUpdated.push(line.partId);
    }
    restocked.push(line.partId); // restock ledger always recorded
  });
  return { restocked, stockUpdated };
}
function mockPoReceiveLines_UNGATED(existingPartIds, lines) {
  const restocked = [];
  const stockUpdated = [];
  lines.forEach((line) => {
    mockFirestoreUpdate(existingPartIds, line.partId); // pre-fix: unconditional
    stockUpdated.push(line.partId);
    restocked.push(line.partId);
  });
  return { restocked, stockUpdated };
}
{
  const existingParts = new Set(['brake-pad']); // 'air-filter' was hard-deleted from the catalog
  const lines = [{ partId: 'brake-pad', receiveQty: 4 }, { partId: 'air-filter', receiveQty: 2 }];

  let threwOld = false;
  try { mockPoReceiveLines_UNGATED(existingParts, lines); } catch { threwOld = true; }
  ok('MANDATORY MATRIX (PH9-02) — BEFORE the fix: receiving a 2-line PO where one line\'s part was hard-deleted throws and aborts BOTH lines — the still-valid brake-pad line never receives either',
    threwOld);

  let threwNew = false; let result = null;
  try { result = mockPoReceiveLines(existingParts, lines); } catch { threwNew = true; }
  ok('MANDATORY MATRIX (PH9-02) — AFTER the fix: the brake-pad line\'s stock is incremented, BOTH lines get a restock-ledger entry (historical), and nothing throws',
    !threwNew && result.stockUpdated.length === 1 && result.stockUpdated[0] === 'brake-pad' && result.restocked.length === 2);
}

// =====================================================================
// 3 — CUSTOMER DELETED -> JOB CARD / INVOICE — ALLOWED INTENTIONALLY
// =====================================================================
console.log('\n3  Customer deleted -> Job Card / Invoice stay valid (ALLOWED INTENTIONALLY)\n');

ok('[fact] Job Cards store a customerId reference PLUS a denormalized name/phone/vehicle snapshot, not a live-only pointer — "View Customer" only renders when a live match is actually found',
  /const matchedCust = customers\.find\(\(c\) => \(card\.customerId && c\.id === card\.customerId\) \|\| \(c\.name && c\.name === card\.customer\)\);/.test(jobcards)
  && /\{matchedCust && onOpenCustomer && <button onClick=\{\(\) => onOpenCustomer\(matchedCust\)\}/.test(jobcards));

ok('[fact] BillingModule\'s custVehicles (vehicle picker for an invoice) returns an empty array — not a crash — when no customer is found for the invoice\'s customerId/phone/name',
  /const c = customers\.find\(\(x\) => \(inv\.customerId && x\.id === inv\.customerId\)\)/.test(billing)
  && /return c \? \(c\.vehicles \|\| \[\]\) : \[\];/.test(billing));

ok('[fact] the workshop-copy invoice PDF resolves customer/vehicle live (for extra detail) but every field falls back to the invoice\'s OWN denormalized copy (iv.customer/iv.regNo/iv.phone/...) when the customer record is gone',
  /const cust = customers\.find\(\(c\) => c\.id === iv\.customerId\) \|\| null;/.test(billing)
  && /const veh = cust \? \(cust\.vehicles \|\| \[\]\)\.find\(\(v\) => v\.id === iv\.vehicleId\) : null;/.test(billing)
  && /const custName = cust\?\.name \|\| iv\.customer;/.test(pdfLib)
  && /\['Customer Name', cust\?\.name \|\| iv\.customer\]/.test(pdfLib)
  && /\['Phone', cust\?\.phone \|\| iv\.phone\]/.test(pdfLib));

ok('[fact] the workshop-copy PDF explicitly labels a missing customer/vehicle profile ("...details above are from the invoice record") rather than silently omitting or crashing',
  /if \(!cust\) \{ doc\.setFontSize\(7\.5\); doc\.setTextColor\(150, 150, 150\); doc\.text\('Customer profile not on file — details above are from the invoice record\.', M, ctx\.y\); /.test(pdfLib));

ok('[fact] the workshop-copy PDF\'s Job Card card guards against a deleted/unmatched job card with an early return BEFORE any unguarded jc.xxx access, showing "details not on file" instead of crashing',
  /function renderJobCardCard\(doc, ctx, \{ iv, jc \}\) \{[\s\S]{0,50}if \(!iv\.jobNo \|\| !jc\) \{/.test(pdfLib));

ok('[fact] Customer deletion (CustomersModule.bulkDelete) is a hard, unconditional filter — no dependent-record check — consistent with Job Cards/Invoices being designed to survive it via their own denormalized snapshots',
  /const bulkDelete = async \(\) => \{[\s\S]{0,600}await setCustomers\(\(prev\) => prev\.filter\(\(x\) => !selectedIds\.has\(x\.id\)\)\);/.test(customersMod));

// =====================================================================
// 4 — NO RESURRECTION: editing/saving a dependent never recreates a
//     deleted Customer, Part, Supplier, or Vehicle (PHASE 9E)
// =====================================================================
console.log('\n4  No resurrection of a deleted parent on dependent save (PHASE 9E)\n');

ok('[fact] JobCardModule never calls setCustomers(...) — saving/editing a job card cannot create or upsert a customer document as a side effect',
  !/setCustomers\(/.test(jobcards));

ok('[fact] BillingModule never calls setCustomers(...) — saving/editing/paying/deleting an invoice cannot create or upsert a customer document as a side effect',
  !/\bsetCustomers\(/.test(billing));

ok('[fact] syncCustomerTotals only ever .map()s the EXISTING customers array — a customerId with no matching entry falls through every branch unchanged; it can never ADD an entry, so a full recompute over invoices cannot resurrect a deleted customer',
  /const syncCustomerTotals = \(custId, allInvoices\) => \{[\s\S]{0,50}if \(!custId\) return Promise\.resolve\(\);[\s\S]{0,700}return setCustomers\(\(prev\) => prev\.map\(\(c\) => \(c\.id === custId \? \{ \.\.\.c, totalSpent: paid, outstanding \} : c\)\)\);/.test(dash));

ok('[fact] touchVehicleHistory only ever .map()s the EXISTING customers array (same non-adding shape as syncCustomerTotals) — a deleted customer\'s id matches no entry and the map is a no-op for it',
  /const touchVehicleHistory = \(iv\) => \{[\s\S]{0,900}return setCustomers\(\(prev\) => prev\.map\(\(c\) => \{[\s\S]{0,400}if \(iv\.customerId && c\.id !== iv\.customerId\) return c;/.test(dash));

ok('[fact] applyReserveDelta (Job Card part reservation) already reads every part doc first and SKIPS (does not throw, does not recreate) any part id whose doc does not exist — the pre-existing, correct precedent this phase\'s two fixes now match',
  /const decisions = snaps\.map\(\(snap\) => \{\s*\n\s*if \(!snap\.exists\(\)\) return \{ skip: true \};/.test(dash));

// =====================================================================
// 5 — SUPPLIER DELETED -> PURCHASE ORDER — ALLOWED INTENTIONALLY
// =====================================================================
console.log('\n5  Supplier deleted -> Purchase Order stays valid (ALLOWED INTENTIONALLY)\n');

ok('[fact] Purchase Orders store supplierId + a denormalized supplierName snapshot at creation (buildPO) — PO rendering/receiving never needs a live supplier lookup to resolve who the order was placed with',
  /supplierId: supplierId \|\| null,\s*\n\s*supplierName: supplierName \|\| '—',/.test(poService));

ok('[fact] supplier deletion actively unlinks referencing PARTS (so no part keeps a dangling supplierId) but never touches Purchase Orders — an explicit, deliberate scope boundary, not an oversight',
  /Unlink from every part first so no dangling supplierId remains\./.test(dash)
  && /await deleteDoc\(doc\(db, COLLECTIONS\.SUPPLIERS, id\)\);/.test(dash)
  && !/deleteDoc\(doc\(db, COLLECTIONS\.SUPPLIERS, id\)\)[\s\S]{0,50}purchaseOrders/.test(dash));

ok('[fact] restock-ledger rows written on PO receipt always carry po.supplierId/po.supplierName as their own denormalized snapshot, not a live join at report time',
  /supplier: po\.supplierName, supplierId: po\.supplierId \|\| null, supplierName: po\.supplierName,/.test(poService));

// =====================================================================
// 6 — VEHICLE REMOVED -> JOB CARD — ALLOWED INTENTIONALLY
// =====================================================================
console.log('\n6  Vehicle removed -> Job Card stays valid (ALLOWED INTENTIONALLY)\n');

ok('[fact] vehicles are an embedded array field on the Customer document, not a separate collection — deleteVehicle only ever filters that one customer\'s vehicles array',
  /const deleteVehicle = async \(v\) => \{[\s\S]{0,300}await setCustomers\(\(prev\) => prev\.map\(\(c\) => \(c\.id === v\.ownerId \? \{ \.\.\.c, vehicles: \(c\.vehicles \|\| \[\]\)\.filter\(\(x\) => x\.id !== v\.id\) \} : c\)\)\);/.test(vehicles));

ok('[fact] a Job Card\'s vehicle fields (regNo/make/model/vehicle/vin/engineNo/fuel) are plain strings copied at creation/customer-pick time, never a live per-keystroke re-read of the customer\'s vehicles array',
  /const v = \(c\.vehicles \|\| \[\]\)\[0\] \|\| \{\};[\s\S]{0,50}set\(\{ customer: c\.name \|\| '', phone: c\.phone \|\| '', altPhone: c\.altPhone \|\| '', address: c\.address \|\| '', vehicle: v\.vehicle \|\|/.test(jobcards));

ok('[fact] Job Card\'s part-availability lookup (availableOf) safely returns 0 for a partId with no matching inventory doc — never crashes, never treats a missing part as unlimited stock',
  /const availableOf = \(partId\) => \{ const p = inventory\.find\(\(x\) => x\.id === partId\); return p \? Math\.max\(0, \(p\.stock \|\| 0\) - \(p\.reserved \|\| 0\)\) : 0; \};/.test(jobcards));

ok('[fact] a Job Card\'s parts line items store their own name/qty/rate snapshot (added at pick-time) and render from THAT snapshot, not a live inventory.find(...).name — a since-deleted part\'s line still displays correctly',
  /set\(\{ parts: \[\.\.\.\(card\.parts \|\| \[\]\), \{ partId: p\.id, name: p\.name, qty: 1, rate: Number\(p\.defaultSellingPrice \|\| p\.sellingPrice \|\| 0\) \}\] \}\);/.test(jobcards)
  && /<span className="flex-1 text-sm text-white\/85 min-w-0 truncate">\{p\.name\}<\/span>/.test(jobcards));

console.log(`\n  ${PASS} passed, ${FAIL} failed, ${DEFECTS} DEFECT(S) found\n`);
// PH9-01 and PH9-02 are verified FIXED above; every other tested relationship
// is verified ALLOWED INTENTIONALLY (denormalized snapshot + safe fallback,
// or a deliberate, documented scope boundary). FAIL>0 = a real regression
// against current source; DEFECTS>0 = a confirmed broken relationship not
// yet closed (none expected at this point).
process.exit((FAIL || DEFECTS) ? 1 : 0);
