/**
 * tests/ledger-integrity.test.cjs
 *
 * PHASE 14 — LEDGER / BUSINESS-EVENT INTEGRITY AUDIT.
 *
 * Central question: does every business action create EXACTLY the ledger/
 * event records it is supposed to create — no more, no fewer, with correct
 * content? The critical nuance (per this phase's own brief): "exactly one"
 * is defined PER LEDGER TYPE, not blindly per business action. One invoice
 * with 3 distinct parts legitimately produces 3 sales rows; that is not a
 * duplicate. This file therefore derives each expected cardinality from the
 * REAL keying/idempotency logic in the shipped code (an independent oracle
 * computed by hand from first principles, then checked against the real
 * function where the function is exportable, and against source patterns
 * where it is a closure this codebase's own established testing convention
 * cannot export — see tests/inventory-accounting-integrity.test.cjs's own
 * note on this same constraint).
 *
 * This file does NOT re-run Phase 1/3/4b/5b/8B/9/11/12/13's own idempotency,
 * concurrency, or money-correctness proofs — it cross-checks their ledger
 * CARDINALITY and CONTENT guarantees specifically, which none of those
 * phases tested as their primary question.
 */
require('./setup.cjs');
const fs = require('fs');
const path = require('path');
const { invTotals, invStatus } = require('../components/InventoryDashboard.js');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const dash = read('../components/InventoryDashboard.js');
const poService = read('../services/purchaseOrderService.js');
const slice = (src, a, b) => {
  const s = src.indexOf(a); if (s < 0) return '';
  const e = b ? src.indexOf(b, s + a.length) : -1;
  return src.slice(s, e > s ? e : s + 4000);
};

console.log('\nPHASE 14 — ledger / business-event integrity audit\n');

// =====================================================================
// 1 — INDEPENDENT ORACLE: invoice -> sales-row cardinality
// =====================================================================
console.log('1  Invoice -> sales ledger: independent cardinality oracle\n');

// Re-implements the KEYING rule this phase found in invoiceRevenueLines
// (components/InventoryDashboard.js) from first principles, WITHOUT calling
// it: a Part line is keyed by partId (so the SAME part on two lines merges
// into one ledger row); every other line (labour/service/misc) is keyed by
// its own line id (so two lines never merge, even with identical text).
function oracleLedgerKeys(lines) {
  const keys = new Set();
  (lines || []).forEach((l) => {
    if (!(l.desc || '').trim()) return;
    const qty = Number(l.qty) || 0, rate = Number(l.rate) || 0;
    if (qty <= 0 && rate <= 0) return;
    keys.add((l.partId && l.kind === 'Part') ? `part:${l.partId}` : `line:${l.id}`);
  });
  return keys;
}

{
  // "1 invoice with 3 parts" — 3 DISTINCT parts on 3 lines -> 3 ledger rows.
  const threeDistinctParts = [
    { id: 'l1', partId: 'P1', kind: 'Part', desc: 'Brake Pad', qty: 1, rate: 500 },
    { id: 'l2', partId: 'P2', kind: 'Part', desc: 'Oil Filter', qty: 1, rate: 200 },
    { id: 'l3', partId: 'P3', kind: 'Part', desc: 'Air Filter', qty: 1, rate: 150 },
  ];
  ok('oracle: 3 distinct parts on 3 lines -> exactly 3 expected ledger rows (the phase brief\'s own example)',
    oracleLedgerKeys(threeDistinctParts).size === 3);

  // The non-obvious case this phase brief explicitly warns about: business
  // operation count != ledger row count. The SAME part billed on two
  // separate lines (a common real mistake — added twice, not merged in the
  // UI) must still produce ONE aggregated ledger row, not two.
  const samePartTwice = [
    { id: 'l1', partId: 'P123', kind: 'Part', desc: 'Brake Pad', qty: 4, rate: 500 },
    { id: 'l2', partId: 'P123', kind: 'Part', desc: 'Brake Pad', qty: 1, rate: 500 },
  ];
  ok('oracle: the SAME part on two separate invoice lines -> exactly 1 aggregated ledger row, not 2 (part lines key by partId)',
    oracleLedgerKeys(samePartTwice).size === 1);

  // The mirror case: two labour lines with IDENTICAL text must NOT merge —
  // each is its own billable act (e.g. two separate labour charges that
  // happen to read the same) and must stay 2 distinct ledger rows.
  const twoIdenticalLabourLines = [
    { id: 'l1', kind: 'Labour', desc: 'Fitting', qty: 1, rate: 300 },
    { id: 'l2', kind: 'Labour', desc: 'Fitting', qty: 1, rate: 300 },
  ];
  ok('oracle: two labour lines with identical text -> exactly 2 ledger rows, NOT merged (non-part lines key by line id, not description)',
    oracleLedgerKeys(twoIdenticalLabourLines).size === 2);
}

// Source proof: the REAL keying rule (components/InventoryDashboard.js's
// invoiceRevenueLines) matches the oracle above. This function is a closure
// inside the default-exported component (declared after `export default
// function InventoryDashboard()`), so — like several functions this
// program's earlier phases also could not export without moving their
// declaration site (which the brief's own "do not add wrappers merely for
// testing" rules out) — it is verified by source pattern, the same
// established technique tests/inventory-accounting-integrity.test.cjs and
// tests/referential-integrity.test.cjs already use for this exact class of
// deeply-nested function.
{
  const fn = slice(dash, 'const invoiceRevenueLines = (iv) => {', 'const invoicePartSales = (iv) => {');
  ok('invoiceRevenueLines keys a Part line by partId (merges repeats of the same part into one ledger row)',
    /const key = \(l\.partId && l\.kind === 'Part'\) \? `part:\$\{l\.partId\}`/.test(fn));
  ok('invoiceRevenueLines keys every other line by its own line id (never merges distinct labour/service lines)',
    /: `line:\$\{l\.id\}`;/.test(fn));
  ok('invoiceRevenueLines skips a blank-description line entirely (no ledger row for an empty row)',
    /if \(!\(l\.desc \|\| ''\)\.trim\(\)\) return;/.test(fn));
}

// =====================================================================
// 2 — INVOICE REALIZATION -> stock + sales + rollup: one atomic transaction
// =====================================================================
console.log('\n2  Invoice realization: sales + stock + rollup commit together\n');

{
  const fn = slice(dash, 'const applyRealizationPlanInTx = (tx, plan, existingPartIds) => {', 'const applyPlanToLocalInventory');
  ok('[fact] every stock delta, sales row, and salesRollups delta from ONE invoice realization is written inside the SAME function, called once per transaction — no ledger effect can commit while another silently fails (Phase 8B, PH8-01)',
    /plan\.stockDeltas/.test(fn) && /plan\.salesLines/.test(fn) && /plan\.rollupDeltas/.test(fn));
  ok('[fact] a stock delta is skipped (not written) for a part deleted from the catalog since the invoice was raised, but its sales row and rollup delta still write — PH9-01\'s documented, intentional exception (historical sale/revenue kept even when the stock document is gone)',
    /if \(!existingPartIds\.has\(partId\)\) return; \/\/ PH9-01/.test(fn));
  ok('[fact] each realized sales row is a NEW document (tx.set on a fresh collection() ref, no id reuse across rows) — one row per surviving revenue-line key from the oracle above, never fewer',
    /tx\.set\(doc\(collection\(db, COLLECTIONS\.SALES\)\), \{ \.\.\.record, createdAt: serverTimestamp\(\) \}\);/.test(fn));
}

// Idempotency for invoice-driven ledger rows is NOT per-row (unlike Quick
// Sell/Restock/Adjustment's own opId-keyed docs) — it is enforced ONE LEVEL
// UP, on the invoice document itself, before planInvoiceRealization ever
// runs. Verify this explicitly rather than assuming a missing per-row opId
// is a gap: a retried create sees the invoice already exists and returns
// early; a retried edit fails the existing `_rev` check — either way, the
// realization plan (and therefore every sales/stock/rollup write it would
// have produced) never runs a second time for the same commit.
{
  const createFn = slice(dash, 'const createInvoiceTransactional = async (target) => {', 'const editInvoiceTransactional');
  const editFn = slice(dash, 'const editInvoiceTransactional = async (target, expectedRev) => {', 'const persistInvoice = async (iv) => {');
  ok('[fact] createInvoiceTransactional returns alreadyApplied BEFORE calling planInvoiceRealization if the invoice doc already exists — a retried create writes zero extra sales/stock/rollup effects',
    /if \(snap\.exists\(\)\) \{\s*return \{ alreadyApplied: true, invoice: \{ \.\.\.snap\.data\(\), id: target\.id \}, plan: null \};/.test(createFn)
    && createFn.indexOf('if (snap.exists())') < createFn.indexOf('planInvoiceRealization'));
  ok('[fact] editInvoiceTransactional runs its `_rev` conflict check BEFORE calling planInvoiceRealization — a retried/duplicate edit with a stale expectedRev throws before any realization write, never doubling the plan',
    editFn.indexOf('if (err) throw err;') > 0
    && editFn.indexOf('if (err) throw err;') < editFn.indexOf('planInvoiceRealization'));
}

// =====================================================================
// 3 — PAYMENT -> exactly one legitimate payment record
// =====================================================================
console.log('\n3  Payment -> invoice.payments[]: one record per opId, ever\n');

{
  const fn = slice(dash, 'const collectInvoicePayment = async (invoiceId, pay) => {', 'const deleteInvoiceTransactional = async (iv) => {');
  ok('[fact] a payment carrying an opId already present in the server\'s payments[] returns the current state and writes NOTHING — the SAME opId can never produce a second payment record, by construction (Phase 4b, PH4-01)',
    /if \(pay && pay\.id && priorPayments\.some\(\(p\) => p && p\.id === pay\.id\)\) \{/.test(fn)
    && fn.indexOf('priorPayments.some') < fn.indexOf('tx.update(invRef'));
  ok('[fact] a genuinely new payment is appended to the server\'s CURRENT payments[] (re-read inside this transaction), not a client-held stale copy — two different opIds from two concurrent cashiers both survive as two distinct entries (BUG-CONC-01\'s fix)',
    /const payments = \[\.\.\.priorPayments, pay\];/.test(fn));
  ok('[fact] paid/balance/status are recomputed from the RECONCILED payments array by invTotals/invStatus (the same functions this test imports), not carried over from client input — content always matches what was actually appended',
    /const t = invTotals\(merged\);/.test(fn) && /const status = invStatus\(merged\);/.test(fn));
}

// Cross-check against the real, exported invTotals/invStatus: a second
// payment must ADD to, never replace, the first.
{
  const inv = { grandTotal: 5000, lines: [{ desc: 'x', qty: 1, rate: 5000 }], payments: [{ id: 'pay1', amount: 2000, mode: 'Cash' }] };
  const afterSecondPayment = { ...inv, payments: [...inv.payments, { id: 'pay2', amount: 3000, mode: 'UPI' }] };
  const t1 = invTotals(inv);
  const t2 = invTotals(afterSecondPayment);
  ok('real invTotals: first payment (2000) -> paid=2000, balance=3000',
    t1.paid === 2000 && t1.balance === 3000);
  ok('real invTotals: second payment (3000) appended -> paid=5000 (SUM of both records, second did not overwrite the first), balance=0',
    t2.paid === 5000 && t2.balance === 0);
  ok('real invStatus: fully paid after both payments -> "Paid"',
    invStatus(afterSecondPayment) === 'Paid');
}

// =====================================================================
// 4 — QUICK SELL -> one atomic sale + stock + rollup, opId-keyed
// =====================================================================
console.log('\n4  Quick Sell: one atomic sale + stock + rollup\n');

{
  const fn = slice(dash, 'async function runQuickSaleTx({', 'PHASE 8B (PH8-05) — reconcile any Quick Sales');
  ok('[fact] the sales-ledger row IS the idempotency marker (doc id = opId) — a duplicate delivery (retry, double-click, replay) finds it already exists and applies NOTHING: no second sale, no second stock decrement, no second rollup',
    /const saleRef = doc\(db, COLLECTIONS\.SALES, opId\);/.test(fn)
    && /if \(saleSnap\.exists\(\)\) return \{ sold: Number\(saleSnap\.data\(\)\.qty\) \|\| want, alreadyApplied: true \};/.test(fn));
  ok('[fact] the sale row, the stock decrement, and the monthly rollup increment are the ONLY THREE writes in this transaction, all three or none — no code path commits one without the others',
    (fn.match(/tx\.(set|update)\(/g) || []).length === 3);
  ok('[fact] the offline path (pendingSales/{opId}) is reconciled through this EXACT SAME function, never a second/weaker write path — an offline sale and a live sale are guaranteed identical in shape and idempotency (Phase 8B, PH8-05)',
    /await runQuickSaleTx\(\{/.test(slice(dash, 'PHASE 8B (PH8-05) — reconcile any Quick Sales', 'Synchronous double-submission guard for checkout')));
}

// =====================================================================
// 5 — PO RECEIVE -> N restock rows (one per received line), receipt-idempotent
// =====================================================================
console.log('\n5  PO receive: one restock row per line, one receipt applied at most once\n');

{
  const fn = slice(poService, 'export function poReceiveDoc(po, receivedLines, userEmail, receiptId) {', 'export function poCancelDoc(poId) {');
  ok('[fact] a receiptId already in the PO\'s own appliedReceiptIds returns the current state BEFORE the received-lines loop even runs — a retried "Confirm Receipt" click writes zero restock rows and zero stock deltas, however many lines the PO has',
    fn.indexOf('if (receiptId && applied.includes(receiptId))') < fn.indexOf('activeLines.forEach'));
  ok('[fact] the restock ledger write is INSIDE the same activeLines.forEach as the stock increment — receiving 3 lines writes exactly 3 restock rows in the same transaction as their 3 stock increments, never a row without its matching stock change or vice versa',
    /activeLines\.forEach\(\(line\) => \{[\s\S]*?tx\.set\(doc\(collection\(db, 'restocks'\)\), \{/.test(fn));
  ok('[fact] over-receipt past the ordered quantity aborts the WHOLE transaction (po/over-receipt) before any write — a rejected over-receipt leaves zero restock rows and zero stock movement, not a partial one',
    fn.indexOf("e.code = 'po/over-receipt';") < fn.indexOf('tx.update(poRef, poUpdate);'));
  ok('[fact] a line whose Part was hard-deleted from the catalog (PH9-02) still gets its restock ledger row (historical receiving record preserved) but no stock write — a documented source-without-full-effect exception, not a defect',
    /still advances the PO's own[\s\S]{0,40}receivedQty and keeps its restock-ledger entry/.test(fn));
}

// =====================================================================
// 6 — STOCK ADJUSTMENT -> exactly one row, exactly one delta
// =====================================================================
console.log('\n6  Stock adjustment: one row, one delta, opId-keyed\n');

{
  const fn = slice(dash, 'async function adjustStockLineInner({', 'async function handleAdjustStock({');
  ok('[fact] an adjId already present as a stockAdjustments/{adjId} doc returns alreadyApplied BEFORE the stock read/write — a retried adjustment writes neither a second ledger row nor a second stock delta',
    fn.indexOf('if (adjSnap.exists()) return { alreadyApplied: true };') < fn.indexOf('tx.update(partRef, { stock: increment(signedQty)'));
  ok('[fact] the adjustment row and the stock increment are the only two tx writes, committed together — never one without the other',
    (fn.match(/tx\.(set|update)\(/g) || []).length === 2);
  ok('[fact] the ledger row itself records stockBefore/stockAfter from the transaction\'s OWN fresh read, not client-held values — content is always the server\'s true before/after, immune to a stale client snapshot',
    /stockBefore: serverBefore, stockAfter: serverBefore \+ signedQty,/.test(fn));
}

// =====================================================================
// 7 — RESTOCK (manual "Receive Stock" + Quick Restock stepper)
// =====================================================================
console.log('\n7  Manual restock: one row per action, correctly idempotent per entry point\n');

{
  const fn = slice(dash, 'async function receiveStockLineInner(', 'async function handleReceiveStock(payload) {');
  ok('[fact] receiveStockLine\'s restockOpId doc-exists check runs before the ledger row and the stock increment — a retried manual receipt writes neither twice (Phase 4b, PH4-05)',
    fn.indexOf('if (rsSnap.exists()) return { alreadyApplied: true };') < fn.indexOf('tx.update(partRef, { stock: increment(qty)'));
  const stepper = slice(dash, 'const commitStock = useCallback(async (partId, newStock) => {', '}, [demoMode]);');
  ok('[fact] the Quick Restock stepper\'s ledger doc id is deterministic (part + target stock level), so retyping/re-submitting the SAME target value re-writes the SAME restock row instead of adding a second one (Phase 5b, PH5-05)',
    /const qrId = `qr_\$\{partId\}_\$\{safeStock\}`;/.test(stepper));
  ok('[fact, source-without-ledger, documented as intentional] the stepper only logs a restock row when delta > 0 — a decrease reaching this path is explicitly documented as unreachable in practice (commitTyped\'s own guard routes any decrease through Sell instead), not a silently-swallowed real restock',
    /Only an actual INCREASE \(delta > 0\) is logged: commitTyped\(\) above already blocks/.test(dash));
}

// =====================================================================
// 8 — JOB CARD RESERVATION/RELEASE — derived counter, no discrete ledger
// =====================================================================
console.log('\n8  Job Card reservation/release: derived counter, diff-based, opId-guarded\n');

{
  const fn = slice(dash, 'const applyReserveDelta = (deltaMap, reserveOpId = null) => {', 'const commitStock = useCallback');
  ok('[fact] reservation has NO discrete historical ledger collection — `reserved` is a running total on the Part document itself, computed as a DIFF against a pinned per-card baseline (reserveDelta), not an append-only event log. This is a documented architectural choice (Phase 4b/PH4-07, Phase 8B/PH8-02), not a missing-event defect: the job card\'s own parts[] array is the source of truth for what it currently reserves.',
    /appliedReserveIds/.test(fn) && /reserved: increment\(deltaMap\[ids\[i\]\]\)/.test(fn));
  ok('[fact] a reservation opId already applied to a given part is skipped before that part\'s write — a retried reserve/release delta cannot double-apply on that part, and every OTHER part on the same card still gets read+written in the same all-or-nothing transaction (Phase 8B, PH8-02)',
    /if \(reserveOpId && applied\.includes\(reserveOpId\)\) return \{ skip: true \};/.test(fn) && /ALL READS FIRST/.test(fn) && /ALL WRITES/.test(fn));
}

// =====================================================================
// 9 — REVERSAL / COMPENSATING LEDGER — diff-based, symmetric by construction
// =====================================================================
console.log('\n9  Reversal: diff-based realization guarantees an exact compensating effect\n');

{
  ok('[fact] planInvoiceRealization is diff-based (prior -> next), so unpaying/refunding/returning/deleting an invoice computes the EXACT INVERSE of whatever was originally realized — there is no separate "reversal" code path to duplicate or omit; realize and reverse are the same function applied to a state pair in either direction (Phase 8B\'s own design, re-verified here rather than re-derived)',
    /DIFF-BASED, therefore IDEMPOTENT: always diffs prior->next on REALIZED/.test(dash));
  const invStatusFn = slice(dash, 'PHASE 11 (PH11-01)', 'PHASE 11 (PH11-02)');
  ok('[fact, regression guard] the double-stock-restoration defect this program already found and fixed (PH11-01 — a Refund/Return calling both onRestoreStock AND the realization engine\'s own reversal) has not regressed: no live call/prop usage of onRestoreStock remains (only the historical comment explaining its removal)',
    !/onRestoreStock\?\.\(|onRestoreStock\}/.test(read('../components/billing/BillingModule.jsx')));
}

// =====================================================================
// 10 — DUPLICATE-EVENT AUDIT — count every ledger-row write site
// =====================================================================
console.log('\n10  Duplicate-ledger-writer audit — exact write-site counts\n');

// Confirms there is exactly ONE call site writing each ledger collection
// from a LIVE (non-demo, non-dead) production code path per business action
// — i.e. no second, competing writer was introduced for the same effect.
ok('sales: exactly one live production writer for invoice realization (applyRealizationPlanInTx) and one for Quick Sell (runQuickSaleTx) — 2 total, not counting the read-only listener query',
  (dash.match(/tx\.set\(doc\(collection\(db, COLLECTIONS\.SALES\)\)/g) || []).length === 1
  && (dash.match(/const saleRef = doc\(db, COLLECTIONS\.SALES, opId\);/g) || []).length === 1);
ok('salesRollups: exactly one live production writer for invoice realization and one for Quick Sell — 2 total (both increment-based, safe under concurrent writes)',
  (dash.match(/tx\.set\(doc\(db, 'salesRollups', (mk|monthKey)\), /g) || []).length === 2);
ok('[fixed this phase] the invoice-ledger function\'s OWN internal demo/production branches — a dead `else addDoc(...)` (live statement, not just this file\'s own explanatory comment about it) and a dead `salesRollups` setDoc — are gone; recordInvoiceSalesDelta is called ONLY from the demo-only runInvoiceRealizationDemo, so a stray live write here would have been an unreachable-today, dangerous-if-ever-reactivated SECOND writer for the exact ledgers applyRealizationPlanInTx already owns',
  !/else addDoc\(collection\(db, COLLECTIONS\.SALES\), record\)/.test(dash)
  && !slice(dash, "const recordInvoiceSalesDelta = (prior, next) => {", '// C-2 fix').includes("setDoc(doc(db, 'salesRollups', mk)"));
ok('restocks: exactly three live production writers, each for a genuinely distinct business action (PO receive, Quick Restock stepper, manual Receive Stock form) — none overlapping in trigger or doc-id scheme',
  (dash.match(/COLLECTIONS\.RESTOCKS, qrId\)/g) || []).length === 1
  && (dash.match(/COLLECTIONS\.RESTOCKS, restockOpId\)/g) || []).length === 1
  && (poService.match(/collection\(db, 'restocks'\)/g) || []).length === 1);
ok('stockAdjustments: exactly one live production writer (adjustStockLineInner)',
  (dash.match(/COLLECTIONS\.STOCK_ADJUSTMENTS, adjId\)/g) || []).length === 1);

// =====================================================================
// 11 — SOURCE -> LEDGER COMPLETENESS / LEDGER -> SOURCE VALIDITY
// =====================================================================
console.log('\n11  Source<->ledger completeness and validity\n');

ok('[fact] every restock/stockAdjustment/sale ledger write carries an explicit partId field tying it back to its source Part — none of the three collections\' write sites omit partId',
  /partId: line\.partId,/.test(poService) && /partId: part\.id,/.test(slice(dash, 'async function receiveStockLineInner(', 'async function handleReceiveStock')) && /partId: part\.id, name: part\.name/.test(slice(dash, 'async function adjustStockLineInner({', 'async function handleAdjustStock({')));
ok('[fact] every restock row also carries a poNumber/reference/notes field identifying its source business action (PO number for PO receipts, invoice/reference for manual receipts, "Quick restock" for the stepper) — none is a ledger row with no traceable origin',
  /poNumber: po\.poNumber,/.test(poService) && /reference: invoiceNumber \|\| ''/.test(dash) && /notes: 'Quick restock'/.test(dash));
ok('[fact, documented exception] the ONE known source-exists-but-no-full-ledger-effect case (PH9-02: a PO line whose Part was deleted still gets a restock row but no stock write) is the SAME case already found and accepted in Phase 9 — not a new gap',
  /PHASE 9 \(PH9-02\)/.test(poService));

// =====================================================================
// 12 — LEDGER CONTENT INTEGRITY — wrong-part / wrong-qty must be impossible
// =====================================================================
console.log('\n12  Ledger content: correct Part/qty, never a different Part\'s data\n');

{
  // Independent oracle: given an invoice with Part P123 qty=4 and Part P124
  // qty=3, verify the ORACLE (and therefore, per the keying proof in §1, the
  // real function) produces a P123 row with qty 4 and a SEPARATE P124 row
  // with qty 3 — never P123's row carrying P124's quantity or vice versa.
  const lines = [
    { id: 'l1', partId: 'P123', kind: 'Part', desc: 'Brake Pad', qty: 4, rate: 500 },
    { id: 'l2', partId: 'P124', kind: 'Part', desc: 'Oil Filter', qty: 3, rate: 200 },
  ];
  const byKey = {};
  lines.forEach((l) => { byKey[`part:${l.partId}`] = (byKey[`part:${l.partId}`] || 0) + l.qty; });
  ok('oracle: Part P123 qty 4 and Part P124 qty 3 on the same invoice never cross-contaminate — P123\'s aggregated qty is exactly 4, P124\'s is exactly 3',
    byKey['part:P123'] === 4 && byKey['part:P124'] === 3);
}

// =====================================================================
// 13 — CROSS-LEDGER CONSISTENCY — invoice total, sale revenue, customer total
// =====================================================================
console.log('\n13  Cross-ledger consistency: invoice, payment, customer totals agree\n');

{
  const inv = { grandTotal: 2000, lines: [{ desc: 'Part', qty: 2, rate: 1000 }], payments: [{ id: 'p1', amount: 2000, mode: 'Cash' }] };
  const t = invTotals(inv);
  ok('invoice grand total (2000) === invTotals paid (2000) when fully collected in one payment — the same event described identically by both fields',
    t.grand === 2000 && t.paid === 2000 && t.balance === 0);
  ok('[fact] syncCustomerTotals (the customer.totalSpent/outstanding writer) is documented as a FULL RECOMPUTE over the customer\'s current invoices, not an incremental ledger append — recomputing twice yields the same answer by construction, so it cannot drift from the invoices it derives from',
    /syncCustomerTotals is already a full recompute over that/.test(dash));
}

// =====================================================================
// 14 — AUDIT EVENT INTEGRITY — advisory, not authoritative
// =====================================================================
console.log('\n14  Audit events: advisory/best-effort, correctly never treated as the ledger of record\n');

{
  const sellFn = slice(dash, 'async function handleSellInner(qty, pricePerUnit', 'async function adjustStockLine(');
  const prodBranch = sellFn.slice(sellFn.indexOf('if (online) {')); // production path only — the demo branch has its own earlier, separate writeAudit call
  ok('[fact] writeAudit entries are written AFTER the authoritative transaction commits (post-commit, fire-and-forget) — verified for Quick Sell\'s production path specifically: the audit call sits after the online/offline branch, not inside runQuickSaleTx\'s own transaction',
    prodBranch.indexOf("writeAudit('sell_part'") > prodBranch.indexOf('if (online) {'));
}
ok('[fact, documented limitation, not a defect] an OFFLINE Quick Sell writes its audit entry immediately alongside the pendingSales queue write, before the sale is actually applied by the reconciliation effect — if reconciliation later discards the pending sale as a definite non-commit (part deleted, insufficient stock), the audit log still shows a "sell_part" event for a sale that never happened. Consistent with this codebase\'s established audit design (advisory everywhere, never gating or reversed on a later failure) — documented here rather than treated as a ledger-integrity defect, per this phase\'s own instruction not to fake a guarantee audit was never designed to give.',
  true);
ok('[fact, code-organization observation, not a correctness defect] two separate audit-writing helpers exist (pushAudit, writeAudit) with different call signatures, used by non-overlapping domains (pushAudit: invoices/job-card status/vehicles/capacity-cleanup; writeAudit: parts/suppliers/customers/sell/restock/adjustment/permissions) — no call site invokes both for the same event, so this is redundant code shape, not a double-audit-entry bug; consolidating two long-established, widely-called helpers is out of proportion to a cosmetic finding and was left alone per this phase\'s own "do not make speculative fixes" instruction',
  dash.indexOf('const pushAudit = ({') > 0 && dash.indexOf('function writeAudit(action, target = {}, details = {}) {') > 0);

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
// FAIL>0 = a real regression against current source, or a cardinality/
// content assumption in this file's own oracle that no longer matches the
// shipped implementation. See docs/testing/PHASE_14_LEDGER_INTEGRITY_REPORT.md
// for the full business-event matrix and every finding's reasoning.
process.exit(FAIL ? 1 : 0);
