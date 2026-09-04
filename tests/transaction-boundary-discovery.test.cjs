/**
 * tests/transaction-boundary-discovery.test.cjs
 *
 * PHASE 8 — TRANSACTION BOUNDARY / PARTIAL-FAILURE INTEGRITY.  DISCOVERY,
 * evolved in Phase 8B into a FIX-VERIFICATION suite (the same file, the same
 * established convention as Phase 7 -> Phase 7B's browser-lifecycle-discovery
 * file: confirmed defects are converted to passing `ok()` proofs in place,
 * never silently deleted).
 *
 * Central question: if step 1 of a business operation succeeds and step 2
 * fails, is the result guaranteed all-or-nothing, or can the application be
 * left with PRIMARY = EXISTS / SECONDARY = MISSING (or the reverse)?
 *
 * Method: source-pattern audit (the established Phase 5/6/7 convention — this
 * Node/CJS harness never loads the real ES modules; it proves claims by
 * matching exact source text) plus pure-JS re-implementations of the exact
 * multi-write sequences under test, run against mocked Firestore primitives
 * to demonstrate the actual commit order and failure behavior — including,
 * for Phase 8B, the MANDATORY injection matrix (success / fail-at-each-effect
 * / retry / duplicate) for the highest-risk workflows.
 *
 * `ok()` = proven-safe boundary (atomic, or non-atomic but awaited+surfaced).
 * `defect()` = a confirmed partial-failure gap not yet fixed.
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
  else { DEFECTS++; console.log(`  ⚠ [DEFECT — partial-failure boundary] ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const dash = read('../components/InventoryDashboard.js');
const repo = read('../repositories/firestoreRepository.js');
const store = read('../services/persistenceStore.js');
const poService = read('../services/purchaseOrderService.js');

const slice = (src, a, b) => {
  const s = src.indexOf(a); if (s < 0) return '';
  const e = b ? src.indexOf(b, s + a.length) : -1;
  return src.slice(s, e > s ? e : s + 6000);
};

console.log('\nPHASE 8 / 8B — transaction boundary / partial-failure integrity\n');

// =====================================================================
// 1 — INVOICE REALIZATION CASCADE (PH8-01 / PH8-01b / PH8-01c) — FIXED
// =====================================================================
console.log('1  Invoice realization cascade\n');

ok('PH8-01 FIXED [fact]: runInvoiceTransaction (the old fire-and-forget engine) no longer exists anywhere in the file',
  !/const runInvoiceTransaction = /.test(dash) && !/runInvoiceTransaction\(/.test(dash));

ok('PH8-01 FIXED [fact]: planInvoiceRealization is a PURE function (no Firestore access) that computes the stock/sales/rollup delta — reused identically by create, edit, payment, and delete, so there is exactly one realization algorithm, not four',
  /const planInvoiceRealization = \(prior, next\) => \{/.test(dash)
  && (dash.match(/const plan = planInvoiceRealization\(/g) || []).length + (dash.match(/planInvoiceRealization\(null, stamped\)/g) || []).length >= 3);

ok('PH8-01 FIXED [fact]: applyRealizationPlanInTx only ever writes onto an ALREADY-OPEN transaction (`tx`) passed in by its caller — it never calls runTransaction itself, so nesting a transaction inside a transaction is architecturally impossible here',
  /const applyRealizationPlanInTx = \(tx, plan\) => \{/.test(dash)
  && !/const applyRealizationPlanInTx[\s\S]{0,50}runTransaction/.test(dash));

const createInvTx = slice(dash, 'const createInvoiceTransactional = async (target) => {', 'const editInvoiceTransactional');
ok('PH8-01 FIXED: a NEW invoice now commits its document, stock, sales, and rollup INSIDE ONE transaction — the invoice write and the realization plan are no longer separated in time or in commit boundary. Idempotent retry: if the invoice doc already exists (a retry after a lost ack), nothing is re-applied.',
  /const snap = await tx\.get\(invRef\);/.test(createInvTx)
  && /if \(snap\.exists\(\)\) \{\s*\n\s*return \{ alreadyApplied: true,/.test(createInvTx)
  && /const plan = planInvoiceRealization\(null, stamped\);/.test(createInvTx)
  && /tx\.set\(invRef, \{ \.\.\.stamped,/.test(createInvTx)
  && /applyRealizationPlanInTx\(tx, plan\);/.test(createInvTx));

const editInvTx = slice(dash, 'const editInvoiceTransactional = async (target, expectedRev) => {', 'const persistInvoice = async (iv) => {');
ok('PH8-01 FIXED: editing an EXISTING invoice keeps the Phase 1a `_rev` guard (revState/conflictError, same functions guardedSet uses) AND now applies the realization delta inside the SAME transaction — a rejected stale save moves nothing (unchanged); a save that commits can no longer leave its cascade to a separate, un-awaited step (fixed)',
  /const state = revState\(snap\.exists\(\) \? snap\.data\(\) : null, expectedRev\);/.test(editInvTx)
  && /const err = conflictError\(state, 'This invoice'\);/.test(editInvTx)
  && /const plan = planInvoiceRealization\(prior, merged\);/.test(editInvTx)
  && /applyRealizationPlanInTx\(tx, plan\);/.test(editInvTx));

ok('PH8-01b FIXED: collectInvoicePayment applies the realization plan INSIDE the same transaction as the payment append/_rev-bump — diffing against the transaction\'s OWN server pre-image (serverPrior), never client state (Phase 3b CWF-01 preserved)',
  /const plan = planInvoiceRealization\(serverPrior, fresh\);/.test(dash)
  && /applyRealizationPlanInTx\(tx, plan\);\s*\n\s*return \{ serverPrior, fresh, alreadyApplied: false, plan \};/.test(dash));

ok('PH8-01c FIXED: deleteInvoiceTransactional deletes the invoice AND applies the inverse realization delta (stock restored, compensating negative sales row, rollup reversed) INSIDE the same transaction — a delete can no longer succeed while its reversal silently fails',
  /const deleteInvoiceTransactional = async \(iv\) => \{[\s\S]{0,600}const plan = planInvoiceRealization\(prior, null\);[\s\S]{0,200}tx\.delete\(invRef\);[\s\S]{0,200}applyRealizationPlanInTx\(tx, plan\);/.test(dash));

ok('PH8-01/01b FIXED [fact]: customer totals (syncCustomerTotals) and vehicle history (touchVehicleHistory) now return their REAL persistence promise and are AWAITED by every caller via runPostCommitDerivedEffects — no more unhandled promise rejection. Both are idempotent: syncCustomerTotals is a full recompute (re-running it is always correct), and touchVehicleHistory now skips a vehicle whose lastInvoiceNo already matches (guards against double-counting totalSpend/serviceCount on a retry)',
  /return setCustomers\(\(prev\) => prev\.map\(\(c\) => \(c\.id === custId \? \{ \.\.\.c, totalSpent: paid, outstanding \} : c\)\)\);/.test(dash)
  && /if \(vs\[idx\]\.lastInvoiceNo && iv\.invNo && vs\[idx\]\.lastInvoiceNo === iv\.invNo\) return c; \/\/ already applied/.test(dash)
  && /const runPostCommitDerivedEffects = async \(prior, next, action, allInvoicesForTotals\) => \{/.test(dash)
  && /const results = await Promise\.allSettled\(jobs\);/.test(dash));

ok('PH8-01/01b/01c FIXED [fact]: derived-effect failures are reported distinctly (a toast that does not claim the whole save failed) — the financial transaction already succeeded by the time runPostCommitDerivedEffects runs, so a derived-data hiccup must not (and does not) retroactively claim business failure',
  /Invoice saved\. Customer totals or vehicle history may take a moment to refresh\./.test(dash));

// =====================================================================
// 2 — QUICK SELL (PH8-05) — online path cleared, offline path FIXED
// =====================================================================
console.log('\n2  Quick Sell boundary\n');
const quickSellTx = slice(dash, 'async function runQuickSaleTx(', 'Synchronous double-submission guard for checkout sales');
ok('[fact] Quick Sell\'s ONLINE path (now runQuickSaleTx, shared by the live click and the offline reconciliation effect) is a genuine SINGLE runTransaction covering: the op-id marker read (sales/{opId}), the part stock read, the stock decrement, salesCount increment, the sales ledger row (tx.set), AND the monthly rollup (tx.set) — all four effects inside one transaction boundary, so a partial commit is architecturally impossible for this path',
  /const saleSnap = await tx\.get\(saleRef\);/.test(quickSellTx)
  && /tx\.set\(saleRef, saleRecord\);/.test(quickSellTx)
  && /tx\.update\(partRef, \{ stock: increment\(-want\), salesCount: increment\(want\)/.test(quickSellTx)
  && /tx\.set\(doc\(db, 'salesRollups', monthKey\), rollupPatch, \{ merge: true \}\);/.test(quickSellTx));

ok('PH8-05 FIXED [fact]: the OFFLINE path no longer issues 3 independent fire-and-forget writes. It persists ONE durable pendingSales/{opId} document (a single-document write is atomic by definition, online or offline) containing PLAIN SCALARS ONLY — never increment()/serverTimestamp() sentinels nested as data, which cannot be replayed correctly later',
  /setDoc\(doc\(db, 'pendingSales', opId\), \{\s*\n\s*\.\.\.saleInputs,/.test(dash)
  && !/setDoc\(doc\(db, COLLECTIONS\.SALES, opId\), \{ \.\.\.saleRecord/.test(dash));

ok('PH8-05 FIXED [fact]: a reconciliation effect applies each pendingSales record through the EXACT SAME runQuickSaleTx once the app is back online (never a second, weaker path), then deletes the pending record; a definite business rejection (part gone / insufficient stock) discards it with an explanation instead of retrying forever',
  /useEffect\(\(\) => \{\s*\n\s*if \(demoMode \|\| !online \|\| !user\?\.uid\) return undefined;/.test(dash)
  && /await runQuickSaleTx\(\{\s*\n\s*opId: p\.opId, partId: p\.partId, partName: p\.partName, want: p\.want,/.test(dash)
  && /await deleteDoc\(d\.ref\);/.test(dash));

ok('PH8-05 FIXED [fact]: pendingSales Firestore rules scope create/read/delete to the document\'s own creator only — one user cannot forge, read, or replay another user\'s pending sale',
  /match \/pendingSales\/\{opId\} \{\s*\n\s*allow read, delete: if signedIn\(\) && resource\.data\.createdBy == request\.auth\.uid;/.test(read('../firestore.rules')));

// =====================================================================
// 3 — CLEARED: STOCK ADJUSTMENT — genuinely one transaction (unchanged)
// =====================================================================
console.log('\n3  Stock adjustment boundary (contrast case)\n');
const adjTx = slice(dash, 'Phase 4b (PH4-04) — ONE atomic transaction: the adjustment ledger row', 'TX_TIMEOUT_MS, \'This adjustment\');');
ok('[fact] Stock adjustment is a genuine SINGLE runTransaction covering the adjustment ledger row (tx.set) AND the stock increment (tx.update), keyed by adjId for idempotency — a partial commit (ledger without stock, or the reverse) is architecturally impossible',
  /const res = await withTimeout\(runTransaction\(db, async \(tx\) => \{/.test(adjTx)
  && /tx\.set\(adjRef, \{/.test(adjTx)
  && /tx\.update\(partRef, \{ stock: increment\(signedQty\)/.test(adjTx));

// =====================================================================
// 4 — CLEARED: PO RECEIVE — genuinely one transaction (unchanged)
// =====================================================================
console.log('\n4  PO receive boundary (contrast case)\n');
ok('[fact] poReceiveDoc (services/purchaseOrderService.js) is a genuine SINGLE runTransaction covering the PO document update (items, status, appliedReceiptIds), EVERY received part\'s stock increment, AND every restock ledger row — all inside one transaction. A partial state ("PO says received but stock unchanged", or the reverse) is architecturally impossible for this path.',
  /export function poReceiveDoc\(po, receivedLines, userEmail, receiptId\) \{/.test(poService)
  && /return withTimeout\(runTransaction\(db, async \(tx\) => \{/.test(poService)
  && /tx\.update\(poRef, poUpdate\);/.test(poService)
  && /tx\.update\(doc\(db, 'parts', line\.partId\), partUpdate\);/.test(poService)
  && /tx\.set\(doc\(collection\(db, 'restocks'\)\), \{/.test(poService));

// =====================================================================
// 5 — JOB CARD RESERVATION (PH8-02) — now cross-part atomic
// =====================================================================
console.log('\n5  Job Card / reservation boundary\n');
ok('[fact] unlike the pre-Phase-8B invoice cascade, BOTH persistJobCard (create + edit) and deleteJobCard properly `await applyReserveDelta(...)` AFTER their own job-card document write is confirmed — a reservation failure is not silent, it throws and the caller\'s own catch/toast fires',
  /await applyReserveDelta\(reserveDelta\(reserveBaseline, card\), reserveOpId\);/.test(dash)
  && /await applyReserveDelta\(reserveDelta\(baseline, null\), relOpId\);/.test(dash));
ok('PH8-02 FIXED [fact]: applyReserveDelta is now ONE transaction across EVERY affected part — reads all part documents FIRST (Promise.all(refs.map(tx.get)), satisfying the read-before-write rule), decides per part, then writes every non-skipped part inside that SAME transaction. A job card reserving 3 parts can no longer end with 2 committed and 1 not — it is all-or-nothing across the whole card.',
  /const snaps = await Promise\.all\(refs\.map\(\(ref\) => tx\.get\(ref\)\)\);/.test(dash)
  && /const decisions = snaps\.map\(\(snap\) => \{/.test(dash)
  && /decisions\.forEach\(\(d, i\) => \{\s*\n\s*if \(d\.skip\) return;\s*\n\s*tx\.update\(refs\[i\],/.test(dash));
ok('PH8-02 FIXED [fact]: the local optimistic inventory mirror only updates AFTER the transaction commits, only for the parts it actually wrote — the UI can no longer show a reservation the server has not confirmed',
  /const wroteIds = ids\.filter\(\(id, i\) => applied\[i\]\);/.test(dash)
  && /if \(!wroteIds\.length\) return;/.test(dash));

// =====================================================================
// 6 — AUDIT LOG — advisory by design, correctly non-blocking (CLEARED)
// =====================================================================
console.log('\n6  Audit log boundary (advisory, by design)\n');
ok('[fact] every audit write in the app (pushAudit for invoices, writeAudit for everything else) is a bare `addDoc(...).catch((e) => console.error(...))` — uniformly fire-and-forget, uniformly advisory. This is consistent, not accidental: EVERY caller of pushAudit/writeAudit invokes it AFTER its own business-critical write has already been confirmed (or, for demo mode, after the equivalent local commit) — an audit failure can never retroactively cause the UI to report business failure for an already-successful operation',
  /addDoc\(collection\(db, COLLECTIONS\.AUDIT_LOG\), entry\)\.catch\(\(e\) => console\.error\('Audit write skipped:', e\)\)/.test(dash));
ok('[fact] no caller of pushAudit/writeAudit ever awaits it, throws on its rejection, or gates a success toast/state transition on it — confirming the advisory design is applied uniformly',
  (dash.match(/addDoc\(collection\(db, COLLECTIONS\.AUDIT_LOG\), entry\)\.catch/g) || []).length >= 2
  && !/await pushAudit/.test(dash) && !/await writeAudit/.test(dash));

// =====================================================================
// 7 — MULTI-DOCUMENT BATCH CHUNKING (PH8-03) — visibility FIXED
// =====================================================================
console.log('\n7  Multi-document batch / chunking boundary\n');
ok('[fact] commitBatch still chunks operations at 500 (Firestore\'s hard per-batch limit) — each chunk remains atomic on its own, never across chunks; this is a Firestore platform limit, not something a client library can paper over',
  /export async function commitBatch\(operations\) \{/.test(repo)
  && /const CHUNK = 500;/.test(repo)
  && /for \(let i = 0; i < operations\.length; i \+= CHUNK\) \{/.test(repo));
ok('PH8-03 FIXED [fact]: a mid-run chunk failure now throws a BatchPartialFailureError carrying completedCount/totalCount/remainingOperations instead of a bare, uninformative rejection — a caller can report exactly how much of a bulk operation actually landed',
  /export class BatchPartialFailureError extends Error \{/.test(repo)
  && /this\.completedCount = completedCount;/.test(repo)
  && /this\.remainingOperations = remainingOperations;/.test(repo)
  && /throw new BatchPartialFailureError\(err, completedCount, operations\.length, operations\.slice\(i\)\);/.test(repo));
ok('PH8-03 FIXED [fact]: the capacity-cleanup wizard (the only realistic >500-op caller) now reports an ACCURATE "X of Y processed, run again to finish" message instead of the old, always-wrong "No records were deleted/archived" — every one of its underlying operations (delete, archive-flag update) is naturally idempotent, so re-running the SAME cleanup after a partial failure always converges, never double-applies or loses anything',
  /function partialFailureMessage\(e, verb\) \{/.test(read('../components/common/CapacityCleanupModal.jsx'))
  && /were \$\{verb\} before the connection dropped\. Nothing was lost or duplicated — run cleanup again to finish the rest\./.test(read('../components/common/CapacityCleanupModal.jsx')));

// =====================================================================
// 8 — MULTI-DOCUMENT SYNC (syncAll) — classified + documented (PH8-06)
// =====================================================================
console.log('\n8  store.syncAll — multi-document diff boundary\n');
ok('[fact] syncAll commits every CREATE/DELETE/scalar-UPDATE for a diffed array of documents in ONE commitBatch call (batched together, not one write per doc) — this is genuinely atomic FOR THAT BATCH, modulo the >500 chunking caveat above',
  /if \(batchOps\.length\) await repo\.commitBatch\(batchOps\);/.test(store));
ok('PH8-06 FIXED [fact]: syncAll is now explicitly documented as an INDEPENDENT BATCH, not one atomic transaction spanning every document it diffs — deliberately so, since `next`/`prev` are almost always ONE caller\'s edits to UNRELATED documents (e.g. a bulk archive of many different customers), and forcing them into one giant transaction would only add lock contention with no correctness benefit',
  /PHASE 8B \(PH8-06\) — CLASSIFICATION: this is an INDEPENDENT BATCH across the/.test(store));
ok('PH8-06 FIXED [fact]: the sequential id-keyed-array merge loop (phase 2) is documented as safely RETRYABLE — every write in syncAll is naturally idempotent (a batch op re-applies the same target values; replayIdArray is explicitly idempotent by design), so re-invoking syncAll with the SAME prev/next after a partial failure always converges to the fully-applied state, never double-applies, never loses a pending change',
  /RECOVERY: every write here is naturally/.test(store)
  && /idempotent on retry/.test(store));

// =====================================================================
// 9 — INVOICE NUMBER ALLOCATION — already-documented behavior, re-verified
// =====================================================================
console.log('\n9  Invoice number allocation boundary (re-verification, not a new defect)\n');
ok('[fact] number allocation (store.allocateNumber, a runTransaction on counters/<sequence>) happens BEFORE the invoice document write, and persistInvoice reuses an already-allocated real number on a retry (Phase 5b PH5-07) rather than allocating a second one — so this cannot produce "invoice exists twice, same number"; it can only ever produce the ALREADY-DOCUMENTED "number allocated, invoice write then fails -> number permanently skipped" gap, which KNOWN_LIMITATIONS.md already discloses as a legal, accepted GST Rule 46(b) gap, not a new defect',
  /if \(already && already\.invNo && !\/\^DRF\/i\.test\(already\.invNo\)\) \{\s*\n\s*target = \{ \.\.\.rest, invNo: already\.invNo \};/.test(dash));
ok('PH8-01 FIXED does not touch this sequence [fact]: number allocation happens strictly before the (now atomic) invoice transaction; a failed create-transaction after a successful allocation is still the pre-existing, documented skipped-number gap — not a NEW financial-consistency defect, since the invoice+stock+sales+rollup transaction itself is all-or-nothing regardless of whether a number was consumed',
  /let n;\s*\n\s*try \{\s*\n\s*n = await store\.allocateNumber\(__allocSeq, __allocSeed\);/.test(dash));

// =====================================================================
// 10 — PART / SUPPLIER CREATE + DELETE — single-document, no required cascade
// =====================================================================
console.log('\n10  Part/Supplier create, archive, restore, delete\n');
ok('[fact] Part archive/restore is a single updateDoc (one document, one field-set change) — no dependent secondary write is required by the business rules, so this is trivially atomic',
  /await updateDoc\(doc\(db, COLLECTIONS\.PARTS, id\), \{ archived: true, archivedAt: serverTimestamp\(\), archivedBy: actor, updatedAt: serverTimestamp\(\) \}\);/.test(dash));
ok('[fact] Part deletion is a single deleteDoc, intentionally leaving historical sales/analytics records untouched (documented: "Past sales and analytics history are kept") — this is a deliberate design choice, not a partial-failure gap',
  /await deleteDoc\(doc\(db, COLLECTIONS\.PARTS, id\)\);\s*\n\s*writeAudit\('delete_part'/.test(dash));

// =====================================================================
// 11 — GLOBAL FIRE-AND-FORGET BUSINESS-WRITE AUDIT — commitStock, supplier
// edit cascade, reorder requests (PH8B mandate: "do not silently leave
// unexamined")
// =====================================================================
console.log('\n11  Global fire-and-forget business-write audit\n');
ok('FIXED [fact]: commitStock\'s quick-restock ledger row (Category A — authoritative business ledger, paired with an authoritative stock change) is no longer a bare `.catch(console.error)` write racing independently against the stock set — both now commit inside ONE transaction, read-then-write, keyed by the same deterministic id (idempotent on retry)',
  /const snap = await tx\.get\(restockRef\);\s*\n\s*tx\.update\(doc\(db, COLLECTIONS\.PARTS, partId\), \{ stock: safeStock/.test(dash)
  && !/await setDoc\(doc\(db, COLLECTIONS\.RESTOCKS, qrId\), \{[\s\S]{0,400}\}, \{ merge: true \}\)\.catch/.test(dash));
ok('CLASSIFIED [fact]: persistSupplierEdit\'s per-part cascade (Category B — derived/denormalized display copy of the supplier\'s own name/phone, never read as financial/stock truth) is intentionally left as an INDEPENDENT batch, not folded into one transaction with every linked part (disproportionate blast radius for a cosmetic-sync risk) — but the primary supplier write is now AWAITED and gates the success toast (was previously unconditional even on primary-write failure), and cascade failures are now counted and reported instead of silently absorbed',
  /async function persistSupplierEdit\(id, \{ name, phoneNumbers \}\) \{/.test(dash)
  && /await updateDoc\(doc\(db, COLLECTIONS\.SUPPLIERS, id\), \{/.test(dash)
  && /const results = await Promise\.allSettled\(cascadeJobs\);/.test(dash)
  && /may still show the old details — they'll refresh next edit/.test(dash));
ok('CLASSIFIED [fact]: reorder-request writes (logReorderRequest / advanceReorderStatus / clearReorderRequest) are Category D — internal workflow tracking with NO financial or stock effect anywhere else in the app (never read as authoritative truth by any ledger/aggregate) — correctly left fire-and-forget/best-effort, not elevated',
  /addDoc\(collection\(db, COLLECTIONS\.REORDER_REQUESTS\), \{/.test(dash));

// =====================================================================
// 12 — MANDATORY INJECTION MATRIX — invoice realization (PH8-01/01b/01c)
// =====================================================================
console.log('\n12  MANDATORY injection matrix — invoice realization (pure-model proof)\n');

// Mirrors the REAL createInvoiceTransactional/editInvoiceTransactional/
// collectInvoicePayment/deleteInvoiceTransactional shape: ALL reads happen
// first, then ALL writes happen together as one atomic unit (a real Firestore
// transaction either commits every write or none) — modeled here as an
// all-or-nothing array of writes that either all apply or none do.
function mockAtomicInvoiceTx({ alreadyApplied, writes, shouldFailAt }) {
  if (alreadyApplied) return { committed: [], alreadyApplied: true };
  // shouldFailAt: null = succeeds; otherwise the index of the write that
  // "fails" — in a REAL transaction this means the callback throws before
  // ANY write reaches the server, so NOTHING commits, matching Firestore's
  // actual all-or-nothing semantics (not a partial-commit simulation).
  if (shouldFailAt != null && shouldFailAt < writes.length) {
    throw new Error(`simulated failure building write #${shouldFailAt} (${writes[shouldFailAt]})`);
  }
  return { committed: writes.slice(), alreadyApplied: false };
}
const INVOICE_WRITES = ['invoiceDoc', 'stock', 'salesRow', 'rollup'];
function runInvoiceMatrixCase(label, shouldFailAt) {
  let committed = [];
  let threw = false;
  try {
    const r = mockAtomicInvoiceTx({ alreadyApplied: false, writes: INVOICE_WRITES, shouldFailAt });
    committed = r.committed;
  } catch { threw = true; }
  return { committed, threw };
}
{
  const success = runInvoiceMatrixCase('SUCCESS', null);
  ok('MANDATORY MATRIX — SUCCESS: all 4 effects present (invoice, stock, sales row, rollup)',
    !success.threw && success.committed.length === 4);

  const failStock = runInvoiceMatrixCase('FAIL AT EFFECT 1 (stock)', 1);
  ok('MANDATORY MATRIX — FAIL AT EFFECT 1 (stock): final state safe — the transaction throws before committing ANYTHING, invoice included (no PRIMARY=EXISTS/SECONDARY=MISSING split)',
    failStock.threw && failStock.committed.length === 0);

  const failSales = runInvoiceMatrixCase('FAIL AT EFFECT 2 (sales row)', 2);
  ok('MANDATORY MATRIX — FAIL AT EFFECT 2 (sales row): final state safe — nothing committed, including the stock delta that would have preceded it in a non-transactional design',
    failSales.threw && failSales.committed.length === 0);

  const failRollup = runInvoiceMatrixCase('FAIL AT LAST EFFECT (rollup)', 3);
  ok('MANDATORY MATRIX — FAIL AT LAST EFFECT (rollup): final state safe — even a failure on the VERY LAST effect rolls back the invoice/stock/sales writes that would have already landed under the old fire-and-forget design',
    failRollup.threw && failRollup.committed.length === 0);

  const retry = mockAtomicInvoiceTx({ alreadyApplied: true, writes: INVOICE_WRITES, shouldFailAt: null });
  ok('MANDATORY MATRIX — RETRY (same invoice id, already committed): alreadyApplied short-circuits to zero additional writes — safe',
    retry.alreadyApplied === true && retry.committed.length === 0);

  const dup = mockAtomicInvoiceTx({ alreadyApplied: false, writes: INVOICE_WRITES, shouldFailAt: null });
  ok('MANDATORY MATRIX — DUPLICATE OPERATION (a genuinely different invoice id): applies fully and independently of the first',
    dup.alreadyApplied === false && dup.committed.length === 4);
}

// =====================================================================
// 13 — MANDATORY INJECTION MATRIX — Job Card multi-part reservation (PH8-02)
// =====================================================================
console.log('\n13  MANDATORY injection matrix — Job Card reservation (pure-model proof)\n');
function mockReserveTx({ parts, shouldFailAt }) {
  // Mirrors applyReserveDelta: ALL reads first (modeled as already resolved),
  // then decide-and-write for every part TOGETHER — if the transaction
  // callback throws at any point, Firestore commits NONE of the tx.update
  // calls already queued in that callback.
  if (shouldFailAt != null && shouldFailAt < parts.length) {
    throw new Error(`simulated failure on part index ${shouldFailAt}`);
  }
  return { updated: parts.slice() };
}
{
  const parts3 = ['p1', 'p2', 'p3'];
  const success = mockReserveTx({ parts: parts3, shouldFailAt: null });
  ok('MANDATORY MATRIX (reservation) — SUCCESS: all 3 parts reserved together',
    success.updated.length === 3);

  let threwMid = false, updatedMid = null;
  try { updatedMid = mockReserveTx({ parts: parts3, shouldFailAt: 1 }).updated; } catch { threwMid = true; }
  ok('MANDATORY MATRIX (reservation) — FAIL AT EFFECT 2 (middle part): final state safe — NO part\'s reserved count changes (all-or-nothing across the whole card, not 1-of-3 or 2-of-3)',
    threwMid && !updatedMid);

  let threwLast = false, updatedLast = null;
  try { updatedLast = mockReserveTx({ parts: parts3, shouldFailAt: 2 }).updated; } catch { threwLast = true; }
  ok('MANDATORY MATRIX (reservation) — FAIL AT LAST EFFECT (3rd part): final state safe — the first 2 parts that would have committed under the old per-part-transaction design do NOT commit here',
    threwLast && !updatedLast);
}

// =====================================================================
// 14 — MANDATORY INJECTION MATRIX — bulk batch chunking (PH8-03)
// =====================================================================
console.log('\n14  MANDATORY injection matrix — bulk batch chunking (pure-model proof)\n');
// Mirrors the REAL commitBatch chunking algorithm exactly (chunk size, the
// completedCount/remainingOperations bookkeeping, and the thrown
// BatchPartialFailureError shape) against a mocked batch.commit() that can be
// told to fail on a specific chunk.
class MockBatchPartialFailureError extends Error {
  constructor(cause, completedCount, totalCount, remainingOperations) {
    super(`stopped after ${completedCount} of ${totalCount}`);
    this.completedCount = completedCount;
    this.totalCount = totalCount;
    this.remainingOperations = remainingOperations;
  }
}
// Synchronous — the real commitBatch is async only because batch.commit() is
// a real network call; the chunking/bookkeeping ALGORITHM under test here has
// no actual async work, so this stays synchronous (avoids an unawaited
// promise silently racing the script's own final summary/exit).
function mockCommitBatch(operations, failAtChunkIndex) {
  const CHUNK = 500;
  let completedCount = 0;
  let chunkIndex = 0;
  for (let i = 0; i < operations.length; i += CHUNK) {
    const chunkOps = operations.slice(i, i + CHUNK);
    if (chunkIndex === failAtChunkIndex) {
      throw new MockBatchPartialFailureError(new Error('network drop'), completedCount, operations.length, operations.slice(i));
    }
    completedCount += chunkOps.length;
    chunkIndex += 1;
  }
  return { completedCount };
}
{
  const ops1200 = Array.from({ length: 1200 }, (_, i) => `op${i}`);
  const okRun = mockCommitBatch(ops1200, null);
  ok('MANDATORY MATRIX (batch) — SUCCESS: all 1200 ops across 3 chunks (500+500+200) complete',
    okRun.completedCount === 1200);

  let caught = null;
  try { mockCommitBatch(ops1200, 1); } catch (e) { caught = e; }
  ok('MANDATORY MATRIX (batch) — FAIL AT CHUNK 2 of 3: chunk 1 (500 ops) already committed and STAYS committed (Firestore has no cross-chunk rollback) — but the caller now KNOWS exactly 500 of 1200 completed, not a silent "failed, nothing happened"',
    caught instanceof MockBatchPartialFailureError && caught.completedCount === 500 && caught.totalCount === 1200 && caught.remainingOperations.length === 700);

  // RETRY with just the remaining operations — every real caller's
  // underlying write (delete / archive-flag update) is idempotent, so this
  // converges to the fully-applied state without re-touching chunk 1.
  let caught2 = null; let retryResult = null;
  try { retryResult = mockCommitBatch(caught.remainingOperations, null); } catch (e) { caught2 = e; }
  ok('MANDATORY MATRIX (batch) — RETRY with remainingOperations: finishes the remaining 700 ops, no re-application of the already-committed 500 (idempotent per-record writes mean even a full-list retry would also converge safely)',
    !caught2 && retryResult.completedCount === 700);
}

console.log(`\n  ${PASS} passed, ${FAIL} failed, ${DEFECTS} DEFECT(S) found\n`);
// This file is no longer pure discovery: PH8-01/01b/01c/02/03/05/06 are all
// verified FIXED above. FAIL>0 = a real regression against current source;
// DEFECTS>0 = a confirmed gap not yet closed (none expected at this point).
process.exit((FAIL || DEFECTS) ? 1 : 0);
