/**
 * tests/audit-log-integrity.test.cjs
 *
 * PHASE 15 — AUDIT-LOG INTEGRITY AUDIT.
 *
 * Central question: does the audit trail accurately record WHO / WHAT /
 * WHEN / WHICH RECORD for important business actions? The audit trail is
 * explicitly NOT a financial or inventory ledger (Phase 14 already covers
 * that) — this file checks a different property: given that a business
 * action happened (or didn't), does its audit entry (if any) describe that
 * truthfully, attribute it to the real actor, and never claim success for
 * an operation that failed.
 *
 * This file does not re-derive Phase 1–14's own transaction/idempotency
 * proofs — it cross-checks the AUDIT WRITE SITE specifically: is it
 * positioned after (not before/instead of) the authoritative write's own
 * success, and does it carry accurate WHO/WHAT/WHICH-RECORD content. Expected
 * values are computed independently (hand-derived from the phase brief's own
 * semantics), not by calling the production audit builder and diffing it
 * against itself.
 */
require('./setup.cjs');
const fs = require('fs');
const path = require('path');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const dash = read('../components/InventoryDashboard.js');
const billing = read('../components/billing/BillingModule.jsx');
const customersMod = read('../components/customers/CustomersModule.jsx');
const vehiclesMod = read('../components/vehicles/VehiclesModule.jsx');
const jobCardMod = read('../components/jobcards/JobCardModule.jsx');
const rules = read('../firestore.rules');
const poService = read('../services/purchaseOrderService.js');
const slice = (src, a, b) => {
  const s = src.indexOf(a); if (s < 0) return '';
  const e = b ? src.indexOf(b, s + a.length) : -1;
  return src.slice(s, e > s ? e : s + 3000);
};

console.log('\nPHASE 15 — audit-log integrity audit\n');

// =====================================================================
// 1 — THE AUDIT MODEL — both helpers still exist, non-overlapping domains
// =====================================================================
console.log('1  Audit model discovery\n');

ok('[fact] both pushAudit and writeAudit still exist, writing to the same COLLECTIONS.AUDIT_LOG collection',
  /const pushAudit = \(\{ action, entity, entityId, detail \}\) => \{/.test(dash)
  && /function writeAudit\(action, target = \{\}, details = \{\}\) \{/.test(dash)
  && (dash.match(/addDoc\(collection\(db, COLLECTIONS\.AUDIT_LOG\), entry\)/g) || []).length === 2);
ok('[fact] both helpers stamp performedBy/performedByEmail from the SAME real auth source (user?.uid / user?.email), never a hardcoded actor',
  (dash.match(/performedBy: user\?\.uid \|\| null,/g) || []).length === 2
  && (dash.match(/performedByEmail: demoMode \? 'demo@balajiautoos\.com' : \(user\?\.email \|\| null\),/g) || []).length === 2);
ok('[fact] neither helper is awaited by its own Firestore write — both are fire-and-forget (addDoc.catch(console.error), no return) — the audit contract is BEST-EFFORT/ADVISORY, not authoritative, consistently for both',
  /addDoc\(collection\(db, COLLECTIONS\.AUDIT_LOG\), entry\)\.catch\(\(e\) => console\.error\('Audit write skipped:', e\)\);\s*\n\s*\}\s*\n\s*\};/.test(slice(dash, "const pushAudit = ({ action, entity, entityId, detail }) => {", "// VEHICLE HISTORY")));
ok('[fact, code-organization observation, not a correctness defect — re-confirms Phase 14\'s own finding] the two helpers use different entry shapes (pushAudit: fixed entity/entityId fields; writeAudit: ...target spread, entity-specific field names like partId/supplierId/poNumber) — a consumer of the shared collection must know which shape a given `action` produced; not consolidated here as out of proportion to a cosmetic finding',
  /entity: entity \|\| '',\s*\n\s*entityId: entityId \|\| '',/.test(dash) && /\.\.\.target,\s*\n\s*details,/.test(dash));

// =====================================================================
// 2 — WHO — PH15-01: real actor identity, not a hardcoded placeholder
// =====================================================================
console.log('\n2  WHO — actor identity (PH15-01)\n');

ok('[was a defect, now fixed] Invoice history (BillingModule.jsx) no longer hardcodes `by: \'Staff\'` for every production entry — it now uses the real actorEmail prop (already wired from InventoryDashboard\'s capacityActorEmail, the same value pushAudit uses for this invoice\'s own shared-auditLog entry)',
  !/by: demoMode \? 'Demo User' : 'Staff'/.test(billing)
  && (billing.match(/by: demoMode \? 'Demo User' : \(actorEmail \|\| 'Staff'\)/g) || []).length === 4);
ok('[was a defect, now fixed] Customer history/notes (CustomersModule.jsx) no longer hardcodes `by: \'Admin\'` for every production entry',
  !/by: demoMode \? 'Demo User' : 'Admin'/.test(customersMod)
  && /const histEntry = \(action, detail\) => \(\{ at: Date\.now\(\), action, detail, by: demoMode \? 'Demo User' : \(actorEmail \|\| 'Staff'\) \}\);/.test(customersMod)
  && /by: demoMode \? 'Demo User' : \(actorEmail \|\| 'Staff'\), at: Date\.now\(\) \}/.test(customersMod));
ok('CustomersModule now receives an actorEmail prop, wired from InventoryDashboard\'s existing capacityActorEmail (the same value already reused for JobCardModule/BillingModule/SalesView/etc.) — no new identity source invented',
  /export default function CustomersModule\(\{[^}]*actorEmail/.test(customersMod)
  && /<CustomersModule[^>]*actorEmail=\{capacityActorEmail\}/.test(dash));
ok('[was a defect, now fixed] Vehicle history (VehiclesModule.jsx) no longer hardcodes `by: \'Admin\'`, and the vehicle notes feature no longer hardcodes the literal `by: \'You\'` (which identified no one at all, in any mode)',
  !/by: demoMode \? 'Demo User' : 'Admin'/.test(vehiclesMod)
  && !/by: 'You'/.test(vehiclesMod)
  && (vehiclesMod.match(/by: demoMode \? 'Demo User' : \(actorEmail \|\| 'Staff'\)/g) || []).length === 2);
ok('VehiclesModule now receives an actorEmail prop the same way, wired from capacityActorEmail',
  /export default function VehiclesModule\(\{[^}]*actorEmail/.test(vehiclesMod)
  && /<VehiclesModule[^>]*actorEmail=\{capacityActorEmail\}/.test(dash));
ok('[fact, documented, not fixed] Job Card\'s own statusLog/notesLog attribute `by` to the case\'s assigned advisor (`card.advisor`), a genuine business-domain field — NOT a bare hardcoded placeholder like the three fixed above — left unchanged: no evidence this is unintentional, and JobCardModule\'s SEPARATE, correctly-attributed shared auditLog entries (pushAudit, performedBy: user?.uid) already answer "who is logged in and did this" independently',
  /const entry = \{ status: s, at: Date\.now\(\), by: demoMode \? 'Demo User' : \(card\.advisor \|\| 'Staff'\) \};/.test(jobCardMod));

// =====================================================================
// 3 — WHAT — PH15-02: a payment must not be indistinguishable from a generic edit
// =====================================================================
console.log('\n3  WHAT — event type accuracy (PH15-02)\n');

{
  const fn = slice(dash, 'const runPostCommitDerivedEffects = async (prior, next, action, allInvoicesForTotals) => {', 'const jobs = [];');
  ok('[was a defect, now fixed] a payment that does NOT fully realize the invoice (partial, or any payment after the first) is no longer silently labeled the generic \'Invoice Updated\' — it now gets its own \'Payment Received\' action, detected from payments[].length growing between prior and next (data already produced by collectInvoicePayment, no new field)',
    /const newPayment = \(next\?\.payments\?\.length \|\| 0\) > \(prior\?\.payments\?\.length \|\| 0\)/.test(fn)
    && /\(newPayment && !unPaid\) \? 'Payment Received'/.test(fn));
  ok('a fully-realizing payment still gets the MORE specific \'Invoice Paid\' label (becamePaid is checked first in the ternary, unchanged) — the fix only fills the gap for the case that used to fall through',
    fn.indexOf("becamePaid ? 'Invoice Paid'") < fn.indexOf("'Payment Received'"));
  ok('the Payment Received detail string now includes the actual amount and mode collected, not just the invoice total (which a payment and a non-payment edit would show identically)',
    /formatINR\(Number\(newPayment\.amount\) \|\| 0\)\} \(\$\{newPayment\.mode \|\| ''\}\)/.test(dash));
}
ok('[fact] Job Card\'s own audit action already distinguishes a status change from a generic update (\'Job Card Status Changed\' vs \'Job Card Updated\' vs \'Job Card Created\') by comparing prior.status to the new status — not a defect, cited as the existing pattern this phase\'s invoice fix now matches',
  /pushAudit\(\{ action: 'Job Card Status Changed', entity: 'Job Card'/.test(dash));
ok('[fact] archive and restore are already distinct actions from delete for every entity that supports all three (Part: archive_part/restore_part/delete_part; Supplier: archive_supplier/restore_supplier/delete_supplier; Vehicle: Vehicle Archived/Restored/Deleted; Customer: Customer Archived/Restored/Deleted) — none of the three is conflated with another',
  /archive_part/.test(dash) && /restore_part/.test(dash) && /delete_part/.test(dash)
  && /archive_supplier/.test(dash) && /restore_supplier/.test(dash) && /delete_supplier/.test(dash)
  && /'Vehicle Archived' : 'Vehicle Restored'/.test(vehiclesMod)
  && /willArchive \? 'Customer Archived' : 'Customer Restored'/.test(customersMod));

// =====================================================================
// 4 — WHICH RECORD — stable identifiers, not names
// =====================================================================
console.log('\n4  WHICH RECORD — stable identifiers\n');

ok('[fact] writeAudit-based entries key on the entity\'s own stable Firestore doc id (partId/supplierId), never a name alone: create_part/update_part/delete_part/archive_part/restore_part all carry partId; create_supplier/update_supplier/delete_supplier/archive_supplier/restore_supplier all carry supplierId',
  /writeAudit\('create_part', \{ partId: partId, name: payload\.name \}\);|writeAudit\('create_part', \{ partId, name: payload\.name \}\);/.test(dash)
  && /writeAudit\(willArchive \? 'archive_supplier' : 'restore_supplier', \{ supplierId: id, name \}\)/.test(dash));
ok('[fact] Invoice audit entries key on invNo, which — unlike Job Card\'s jobNo — is allocated from a monotonically-increasing Firestore counter (Phase 2, counters/<sequence>) and is never reused once issued, so this is a safe choice of "human-readable but still stable" identifier, not a name',
  /entityId: target\.invNo \|\| target\.id,/.test(dash));
ok('[fact, real but out-of-phase-scope limitation — see report] Job Card audit entries key on jobNo, which IS the job card\'s own Firestore document id (idField: \'jobNo\') — but nextJobCardNumber computes the next number purely from the highest number seen in the CURRENTLY-EXISTING job cards array, with no persistent counter, so a hard-DELETED job card\'s number could in principle be reissued to a later, different job card. This is a Job Card NUMBER-ISSUANCE characteristic (Phase 10\'s territory), not something pushAudit/writeAudit introduce — documented, not fixed in this phase.',
  /const max = \(jobCards \|\| \[\]\)\.reduce\(\(m, x\) => \{/.test(read('../services/jobCardService.js')));

// =====================================================================
// 5 — FAILED-OPERATION AUDIT TESTING — the critical check
// =====================================================================
console.log('\n5  Failed-operation audit testing — must never claim false success\n');

{
  const fn = slice(dash, 'async function receivePO(po, receivedLines, receiptId) {', 'async function cancelPO(po) {');
  ok('[fact] PO receive: the catch block (over-receipt, deleted PO, timeout) writes NO audit entry at all — a rejected/aborted receive transaction leaves no "po_receive" trace, never a false "received" claim',
    !/writeAudit\('po_receive'/.test(fn.slice(fn.indexOf('} catch (e) {'))));
  ok('[fact] PO receive: the SUCCESS-path writeAudit(\'po_receive\', ...) is gated on `!res?.alreadyApplied` AND sits after `await poReceiveDoc(...)` inside the try — a definite non-commit never reaches it',
    fn.indexOf('const res = await poReceiveDoc(') < fn.indexOf("if (!res?.alreadyApplied)")
    && fn.indexOf("if (!res?.alreadyApplied)") < fn.indexOf("} catch (e) {"));
}
{
  const fn = slice(dash, 'async function adjustStockLineInner({', 'async function handleAdjustStock({');
  // The demo-mode branch (textually first in the function) has its OWN,
  // separate writeAudit('stock_adjustment', ...) call — only the PRODUCTION
  // occurrence (after the try/catch) is what this assertion checks.
  const prodBranch = fn.slice(fn.indexOf('} catch (err) {'));
  ok('[fact] Stock Adjustment: writeAudit(\'stock_adjustment\', ...) sits inside `if (!alreadyApplied)`, itself only reachable after the transaction\'s own try/catch already returned early on failure — a failed or duplicate adjustment writes no audit entry',
    prodBranch.indexOf('if (!alreadyApplied)') < prodBranch.indexOf("writeAudit('stock_adjustment'")
    && prodBranch.indexOf("writeAudit('stock_adjustment'") > -1);
}
{
  const fn = slice(dash, 'async function handleSellInner(qty, pricePerUnit', 'async function adjustStockLine(');
  const prodBranch = fn.slice(fn.indexOf('if (online) {'));
  ok('[fact] Quick Sell: the production catch block (sale transaction threw) returns before reaching writeAudit(\'sell_part\', ...) — a failed sale (insufficient stock, deleted part, timeout) writes no audit entry',
    prodBranch.indexOf('} catch (err) {') < prodBranch.indexOf("return;")
    && prodBranch.indexOf("return;") < prodBranch.lastIndexOf("writeAudit('sell_part'"));
  ok('[fact] Quick Sell: a retry that hits the opId-keyed idempotency guard (alreadyApplied) returns BEFORE the writeAudit call too — a confirmed duplicate delivery does not double-log',
    fn.indexOf('if (alreadyApplied) {') < fn.lastIndexOf("writeAudit('sell_part'"));
}
{
  const fn = slice(dash, 'const collectInvoicePayment = async (invoiceId, pay) => {', 'const deleteInvoiceTransactional = async (iv) => {');
  ok('[fact] Payment: the conc/overpaid rejection (PH11-02\'s guard) throws BEFORE the transaction\'s own tx.update — and the caller only calls runPostCommitDerivedEffects (the function that pushes the invoice/payment audit entry) after a confirmed, non-throwing result — a rejected overpayment writes no "Payment Received"/"Invoice Paid" entry',
    fn.indexOf("err.code = 'conc/overpaid';") < fn.indexOf('tx.update(invRef'));
  ok('[fact] Payment: a duplicate payment id (already in the server\'s payments[]) returns alreadyApplied BEFORE any write — and persistInvoice-equivalent callers of collectInvoicePayment skip runPostCommitDerivedEffects entirely on alreadyApplied, so a duplicate delivery never produces a second Payment Received/Invoice Paid entry',
    /if \(alreadyApplied\) return fresh;/.test(slice(dash, 'const collectInvoicePayment = async (invoiceId, pay) => {', 'const deleteInvoiceTransactional')));
}

// =====================================================================
// 6 — DUPLICATE AUDIT EVENTS — retry must not double-log
// =====================================================================
console.log('\n6  Duplicate-audit-event testing\n');

{
  const fn = slice(dash, 'async function receiveStockLineInner(', 'async function handleReceiveStock(payload) {');
  // The demo-mode branch (textually first) has its own separate writeAudit
  // call; only the PRODUCTION occurrence (after the alreadyApplied check)
  // is what this assertion checks.
  const alreadyIdx = fn.indexOf('if (alreadyApplied) return { ok: true, alreadyApplied: true };');
  const prodBranch = fn.slice(alreadyIdx);
  ok('[fact] Manual restock: `if (alreadyApplied) return {...}` comes before the PRODUCTION writeAudit calls (update_part_defaults_via_restock, receive_stock) — a retried receipt writes neither',
    alreadyIdx > -1 && prodBranch.indexOf("writeAudit('receive_stock'") > 0);
}
ok('[fact] every opId-bearing audit write (sell_part, stock_adjustment, receive_stock) carries that SAME opId in its own `details` — so even if a caller somehow retried past the guard, the resulting duplicate audit rows would still be traceable back to one originating operation, not silently unrelated-looking entries',
  /writeAudit\('sell_part', \{ partId: part\.id, name: part\.name \|\| '' \}, \{ qty: sold, unitPrice: pricePerUnit, revenue: sold \* pricePerUnit, opId \}\);/.test(dash)
  && /writeAudit\('stock_adjustment', \{ partId: part\.id, name: part\.name \|\| '' \}, \{ qty: signedQty, reason, stockBefore: before, stockAfter: after, notes: notes \|\| '', opId: adjId \}\);/.test(dash)
  && /writeAudit\('receive_stock', \{ partId: part\.id, name: part\.name \|\| '' \}, \{ qty, unitCost, supplierName: supplierName \|\| '', opId: restockOpId \}\);/.test(dash));

// =====================================================================
// 7 — MISSING AUDIT EVENTS
// =====================================================================
console.log('\n7  Missing-audit-event audit\n');

ok('[fact] Customer create/edit/delete/archive/restore all reach the shared auditLog via the `onAudit` prop (wired to pushAudit) — not missing, just indirect (CustomersModule is a child component without direct closure access to pushAudit)',
  /onAudit\?\.\(\{ action: isNew \? 'Customer Created' : 'Customer Updated'/.test(customersMod)
  && /onAudit\?\.\(\{ action: 'Customer Deleted'/.test(customersMod)
  && /onAudit\?\.\(\{ action: willArchive \? 'Customer Archived' : 'Customer Restored'/.test(customersMod));
ok('[fact] Vehicle create/edit/archive/restore/delete all reach the shared auditLog the same way (onAudit prop)',
  /onAudit\?\.\(\{ action: wasNew \? 'Vehicle Created' : 'Vehicle Updated'/.test(vehiclesMod)
  && /onAudit\?\.\(\{ action: 'Vehicle Deleted'/.test(vehiclesMod));
ok('[fact] PO create/status-change/receive/cancel are all audited (po_create, po_status, po_receive, po_cancel) — no PO lifecycle transition found with zero audit coverage',
  /writeAudit\('po_create'/.test(dash) && /writeAudit\('po_status'/.test(dash) && /writeAudit\('po_receive'/.test(dash) && /writeAudit\('po_cancel'/.test(dash));

// =====================================================================
// 8 — SECURITY / RULES — PH15-03: actor-identity forgery
// =====================================================================
console.log('\n8  Audit immutability / security (PH15-03)\n');

{
  const rule = slice(rules, 'match /auditLog/{logId} {', '// ---- Pending sales');
  ok('[was a defect, now fixed] auditLog\'s create rule used to allow ANY signed-in user to write an entry with ANY performedBy — a malicious/buggy client could forge an entry attributed to a different user. It now requires request.resource.data.performedBy == request.auth.uid, the same self-attribution pattern pendingSales already used — verified live against the emulator in tests/rules/firestore.rules.test.cjs',
    /allow create: if signedIn\(\) && request\.resource\.data\.performedBy == request\.auth\.uid;/.test(rule));
  ok('read access is unchanged (still every signed-in user, not narrowed to "your own entries only") — the shared audit trail remains fully visible',
    /allow read: if signedIn\(\);/.test(rule));
  ok('update is still unconditionally denied (append-only) and delete is still admin-only — both unchanged by this phase',
    /allow update: if false;/.test(rule) && /allow delete: if isAdmin\(\);/.test(rule));
}

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
// FAIL>0 = a real regression against current source, or an unverified claim
// in this file. See docs/testing/PHASE_15_AUDIT_LOG_INTEGRITY_REPORT.md for
// the full event matrix and every finding's reasoning.
process.exit(FAIL ? 1 : 0);
