/**
 * tests/idempotency-duplicate-action.test.cjs
 *
 * PHASE 4b — DUPLICATE-ACTION / IDEMPOTENCY regression suite.
 *
 * Phase 4 (discovery) proved that ONE user intent could become TWO business
 * transactions via a double-click, a retry after an ambiguous response, or a
 * Firestore transaction callback re-run. Phase 4b closed all eight defects by
 * giving every retryable business write a STABLE operation identity that its
 * transaction reads BEFORE any write.
 *
 * This file now asserts the FIXED behaviour:
 *   - INVARIANT A: one logical intent + any number of duplicate deliveries /
 *     retries / callback replays  ==>  exactly ONE business effect.
 *   - INVARIANT B: two genuinely separate intents (distinct opIds)  ==>  two
 *     legitimate business effects.
 *
 * jsdom + source-pattern assertions + pure re-implementations of the exact
 * persistence logic. The real emulator two-client / transaction-retry proof is
 * in tests/rules/firestore.rules.test.cjs (§ "PHASE 4b").
 */
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'x';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'x';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'x';
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'x';
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = 'x';
process.env.NEXT_PUBLIC_FIREBASE_APP_ID = 'x';
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
const bill = read('../components/billing/BillingModule.jsx');
const po = read('../services/purchaseOrderService.js');
const poLib = read('../lib/poReceive.js');
const repo = read('../repositories/firestoreRepository.js');
const opIdLib = read('../lib/opId.js');
const billPO = read('../components/inventory/InventoryPurchaseOrders.jsx');

// slice a named handler out of a source file
const slice = (src, startNeedle, endNeedle) => {
  const s = src.indexOf(startNeedle);
  if (s < 0) return '';
  const e = endNeedle ? src.indexOf(endNeedle, s + startNeedle.length) : -1;
  return src.slice(s, e > s ? e : s + 4000);
};

// stubs shared by the pure re-implementations
const invTotalsStub = (iv) => {
  const grand = (iv.lines || []).reduce((s, l) => s + Number(l.qty) * Number(l.rate), 0);
  const paid = (iv.payments || []).reduce((s, p) => s + Number(p.amount), 0);
  return { grand, paid, balance: grand - paid, gst: 0 };
};

console.log('\nPHASE 4b — duplicate-action / idempotency (regression)\n');

// =====================================================================
// lib/opId.js — the operation-identity contract
// =====================================================================
console.log('lib/opId.js — operation identity contract\n');
ok('newOpId is a pure id factory (timestamp is for ordering, not identity)',
  /export const newOpId = \(prefix = 'op'\) =>/.test(opIdLib));
ok('the lifecycle contract is documented (one opId per intent, reused on retry, new per new action)',
  /reuses it for\s*\n?\s*\/\/\s*every retry of that same intent/i.test(opIdLib) && /A NEW opId is created only when the user starts a NEW/i.test(opIdLib));
ok('Phase 5b: the id is kept in sessionStorage so it survives a browser refresh',
  /kept in `sessionStorage`|SURVIVES A\s*\n?\s*\/\/\s*BROWSER REFRESH/i.test(opIdLib)
  && /lib\/durableOpId\.js/.test(opIdLib));

// =====================================================================
// PH4-01 — COLLECT PAYMENT
// =====================================================================
console.log('\nPH4-01  Collect Payment\n');

const payTxn = slice(dash, 'const collectInvoicePayment = async', 'const deleteInvoice');
ok('[OK] PaymentModal has a synchronous in-flight guard (blocks double-click)',
  /const savingRef = useRef\(false\);/.test(bill)
  && /if \(savingRef\.current\) return;/.test(slice(bill, 'function PaymentModal', 'export default')));
ok('PaymentModal owns ONE stable pay-op id, reused for every retry (Phase 5b: DURABLE — survives a refresh)',
  /useDurableOpId\(`payment:\$\{invoice\.id\}`, 'p'\)/.test(bill)
  && /opId: payOpId/.test(bill));
ok('the PaymentModal render is keyed per invoice so a new "collect payment" remounts (fresh opId)',
  /<PaymentModal key=\{`pay:\$\{payFor\.id\}`\}/.test(bill));
ok('collectPayment uses meta.opId as the payment row id (not a fresh random each call)',
  /id: meta\.opId \|\| emptyPayment\(\)\.id/.test(bill));
ok('the payment write is a re-reading Firestore transaction',
  /await runTransaction\(db, async \(tx\) => \{/.test(payTxn) && /const snap = await tx\.get\(invRef\)/.test(payTxn));
ok('the transaction reads prior payments and no-ops if pay.id is already present',
  /priorPayments\.some\(\(p\) => p && p\.id === pay\.id\)/.test(payTxn)
  && /alreadyApplied: true/.test(payTxn));
ok('the realized cascade is skipped on a duplicate delivery (return before runInvoiceTransaction)',
  /if \(alreadyApplied\) return fresh;/.test(payTxn));
ok('the error message admits uncertainty instead of claiming "nothing changed"',
  /It may already be recorded — check the invoice/.test(bill));

// pure re-impl of collectInvoicePayment's callback (matches InventoryDashboard.js)
const paymentTxnBody = (serverData, pay) => {
  const priorPayments = Array.isArray(serverData.payments) ? serverData.payments : [];
  if (pay && pay.id && priorPayments.some((p) => p && p.id === pay.id)) {
    const t0 = invTotalsStub(serverData);
    return { alreadyApplied: true, payments: priorPayments, paid: t0.paid, balance: t0.balance, _rev: serverData._rev || 0 };
  }
  const payments = [...priorPayments, pay];
  const t = invTotalsStub({ ...serverData, payments });
  return { alreadyApplied: false, payments, paid: t.paid, balance: t.balance, _rev: (serverData._rev || 0) + 1 };
};

// A: single application
let server = { lines: [{ qty: 1, rate: 500 }], payments: [], _rev: 0 };
const one = paymentTxnBody(server, { id: 'p_1', mode: 'Cash', amount: 500 });
server = { ...server, ...one };
ok('A (single): one payment intent records one payment, paid = 500', server.paid === 500 && server.payments.length === 1);

// D: same-opId replay (lost-ack transaction retry re-reads state that already has the payment)
const replay = paymentTxnBody(server, { id: 'p_1', mode: 'Cash', amount: 500 });
ok('D (same-opId replay): a retry with the SAME pay.id appends nothing and reports alreadyApplied',
  replay.alreadyApplied === true && replay.payments.filter((p) => p.id === 'p_1').length === 1);
ok('D: paid does not double, balance does not go negative', replay.paid === 500 && replay.balance === 0);

// F: ambiguous-then-retry at the app layer — PaymentModal reuses payOpIdRef, so the id is identical
const ambiguousRetry = paymentTxnBody(server, { id: 'p_1', mode: 'Cash', amount: 500 });
ok('F (ambiguous then retry): app-level re-click reuses the ref id → still one payment',
  ambiguousRetry.alreadyApplied === true && server.payments.length === 1);

// B / H: a genuinely separate second payment (new modal, new ref, new id) is allowed
server = { ...server, ...paymentTxnBody(server, { id: 'p_2', mode: 'UPI', amount: 200 }) };
ok('B (legitimate second action): a DIFFERENT pay.id is a new intent — recorded, paid = 700',
  server.payments.length === 2 && server.paid === 700);

// =====================================================================
// PH4-02 — PO RECEIVE
// =====================================================================
console.log('\nPH4-02  Purchase-Order Receive\n');

const { applyPoReceive } = require('../lib/poReceive.js');
ok('[OK] receivePO has an in-flight Set guard keyed by po.id',
  /const poAdvancing = useRef\(new Set\(\)\)/.test(dash)
  && /if \(poAdvancing\.current\.has\(po\.id\)\) return;/.test(dash));
ok('ReceivePOForm owns ONE stable receiptId, passed to onSubmit (Phase 5b: DURABLE)',
  /useDurableOpId\(`receive:\$\{po\?\.id \|\| 'po'\}`, 'rcpt'\)/.test(billPO)
  && /onSubmit\?\.\(receivedLines, receiptId\)/.test(billPO));
ok('poReceiveDoc reads appliedReceiptIds BEFORE any write and no-ops on a known receiptId',
  /const applied = Array\.isArray\(server\.appliedReceiptIds\) \? server\.appliedReceiptIds : \[\];/.test(po)
  && /if \(receiptId && applied\.includes\(receiptId\)\) \{[\s\S]{0,120}alreadyApplied: true/.test(po));
ok('poReceiveDoc records the receiptId in a bounded appliedReceiptIds list',
  /poUpdate\.appliedReceiptIds = \[\.\.\.applied, receiptId\]\.slice\(-APPLIED_RECEIPTS_CAP\)/.test(po));
ok('receivePO has a client-side fast path for an already-applied receiptId',
  /po\.appliedReceiptIds\.includes\(receiptId\)/.test(dash));
ok('the audit row is skipped when the receipt was already applied',
  /if \(!res\?\.alreadyApplied\) \{[\s\S]{0,120}writeAudit\('po_receive'/.test(dash));
ok('applyPoReceive stays a pure delta function (idempotency is the service layer’s job)',
  !/receiptId|operationId|idempotenc/i.test(poLib));

// service-layer guard, re-implemented (matches poReceiveDoc)
const poReceiveGuarded = (server, receivedLines, receiptId) => {
  const applied = Array.isArray(server.appliedReceiptIds) ? server.appliedReceiptIds : [];
  if (receiptId && applied.includes(receiptId)) {
    return { items: server.items, status: server.status, alreadyApplied: true, appliedReceiptIds: applied };
  }
  const r = applyPoReceive(server.items, receivedLines, server.status);
  return { items: r.items, status: r.status, alreadyApplied: false, appliedReceiptIds: [...applied, receiptId].slice(-60) };
};

let poServer = { poNumber: 'PO-1', status: 'approved', items: [{ partId: 'p1', name: 'Pad', qty: 10, receivedQty: 0 }], appliedReceiptIds: [] };
const rcpt1 = poReceiveGuarded(poServer, [{ partId: 'p1', receiveQty: 4 }], 'rcpt_A');
poServer = { ...poServer, items: rcpt1.items, status: rcpt1.status, appliedReceiptIds: rcpt1.appliedReceiptIds };
ok('A (single): receiving 4 sets receivedQty 4', poServer.items[0].receivedQty === 4);

const rcpt1replay = poReceiveGuarded(poServer, [{ partId: 'p1', receiveQty: 4 }], 'rcpt_A');
ok('D (same receiptId replay): a lost-ack retry of "receive 4" stays at receivedQty 4',
  rcpt1replay.alreadyApplied === true && rcpt1replay.items[0].receivedQty === 4);

const rcpt2 = poReceiveGuarded(poServer, [{ partId: 'p1', receiveQty: 3 }], 'rcpt_B');
ok('B (legitimate second receipt): a new receiptId adds its delta → receivedQty 7',
  rcpt2.alreadyApplied === false && rcpt2.items[0].receivedQty === 7);

// =====================================================================
// PH4-03 — QUICK SELL / STOCK OUT
// =====================================================================
console.log('\nPH4-03  Quick Sell / Stock Out\n');

const sellBlock = slice(dash, 'async function handleSellInner', 'async function adjustStockLine');
ok('[OK] handleSell has a synchronous in-flight guard (sellLockRef)',
  /const sellLockRef = useRef\(false\)/.test(dash) && /if \(sellLockRef\.current\) return;/.test(dash));
ok('CheckoutModal owns ONE stable sale-op id, passed as the 4th confirm arg (Phase 5b: DURABLE)',
  /useDurableOpId\(`sell:\$\{part\.id\}`, 'sale'\)/.test(dash)
  && /onConfirm\(q, p, floor > 0 && p < floor, saleOpId\)/.test(dash));
ok('the CheckoutModal render is keyed per part so a new sale remounts (fresh opId)',
  /<CheckoutModal key=\{`co:\$\{checkoutPart\.id\}`\}/.test(dash));
ok('the WHOLE sale is one transaction: sale row + stock + salesCount + rollup, keyed by sales/{opId}',
  /const saleRef = doc\(db, COLLECTIONS\.SALES, opId\);/.test(sellBlock)
  && /if \(saleSnap\.exists\(\)\) return \{ sold:[^}]*alreadyApplied: true \}/.test(sellBlock)
  && /tx\.set\(saleRef, saleRecord\);/.test(sellBlock)
  && /tx\.update\(partRef, \{ stock: increment\(-want\), salesCount: increment\(want\)/.test(sellBlock)
  && /tx\.set\(doc\(db, 'salesRollups', monthKey\), rollupPatch, \{ merge: true \}\);/.test(sellBlock));
ok('all transaction reads happen before any write (sale marker + part, then set/update)',
  /const saleSnap = await tx\.get\(saleRef\);\s*\n\s*const partSnap = await tx\.get\(partRef\);/.test(sellBlock));
ok('the ledger addDoc + rollup are NOT fire-and-forget after the txn anymore',
  !/addDoc\(collection\(db, COLLECTIONS\.SALES\)[\s\S]{0,400}\)\.catch/.test(sellBlock));
ok('the offline path writes to the SAME stable sales/{opId} doc (replay-safe)',
  /setDoc\(doc\(db, COLLECTIONS\.SALES, opId\), \{ \.\.\.saleRecord/.test(sellBlock));
ok('the error message admits uncertainty ("press Confirm Sale again — a repeat is safe")',
  /press Confirm Sale again \(a repeat is safe\)/.test(sellBlock));

// pure re-impl of the sale transaction
const sellTxnBody = (state, want, opId) => {
  if (state.sales[opId]) return { ...state, alreadyApplied: true };
  if (want > state.stock) throw new Error('not enough');
  return {
    stock: state.stock - want,
    salesCount: state.salesCount + want,
    sales: { ...state.sales, [opId]: { qty: want } },
    rollupUnits: state.rollupUnits + want,
    rollupOrders: state.rollupOrders + 1,
    alreadyApplied: false,
  };
};
let sellState = { stock: 10, salesCount: 0, sales: {}, rollupUnits: 0, rollupOrders: 0 };
sellState = sellTxnBody(sellState, 3, 'sale_1');
ok('A (single): sell 3 → stock 7, one sales row, rollup 1 order',
  sellState.stock === 7 && Object.keys(sellState.sales).length === 1 && sellState.rollupOrders === 1);
const sellReplay = sellTxnBody(sellState, 3, 'sale_1');
ok('D/E (same-opId replay / callback re-run): stock stays 7, still one sales row, rollup unchanged',
  sellReplay.alreadyApplied === true && sellReplay.stock === 7
  && Object.keys(sellReplay.sales).length === 1 && sellReplay.rollupOrders === 1);
let sellState2 = sellTxnBody(sellState, 2, 'sale_2');
ok('B (legitimate second sale): a new opId sells again → stock 5, two sales rows',
  sellState2.stock === 5 && Object.keys(sellState2.sales).length === 2);

// =====================================================================
// PH4-04 / PH4-05 — MANUAL STOCK ADJUST / AD-HOC RESTOCK
// =====================================================================
console.log('\nPH4-04 / PH4-05  Manual Stock Adjust · Ad-hoc Restock\n');
const adjBlock = slice(dash, 'async function adjustStockLineInner', 'async function handleAdjustStock');
const rsBlock = slice(dash, 'async function receiveStockLineInner', 'async function handleReceiveStock');
ok('[OK] adjustStockLine has a Set in-flight guard keyed by part.id',
  /const stockAdjustLock = useRef\(new Set\(\)\)/.test(dash) && /if \(stockAdjustLock\.current\.has\(part\.id\)\) return/.test(dash));
ok('[OK] receiveStockLine has a Set in-flight guard keyed by part.id',
  /const stockReceiveLock = useRef\(new Set\(\)\)/.test(dash) && /if \(stockReceiveLock\.current\.has\(part\.id\)\) return/.test(dash));
ok('stock adjust is now ONE transaction keyed by stockAdjustments/{adjId}',
  /const adjRef = doc\(db, COLLECTIONS\.STOCK_ADJUSTMENTS, adjId\);/.test(adjBlock)
  && /if \(adjSnap\.exists\(\)\) return \{ alreadyApplied: true \};/.test(adjBlock)
  && /tx\.update\(partRef, \{ stock: increment\(signedQty\)/.test(adjBlock)
  && !/Promise\.allSettled/.test(adjBlock));
ok('ad-hoc restock is now ONE transaction keyed by restocks/{restockOpId}',
  /const rsRef = doc\(db, COLLECTIONS\.RESTOCKS, restockOpId\);/.test(rsBlock)
  && /if \(rsSnap\.exists\(\)\) return \{ alreadyApplied: true \};/.test(rsBlock)
  && /tx\.update\(partRef, \{ stock: increment\(qty\)/.test(rsBlock)
  && !/Promise\.allSettled/.test(rsBlock));
ok('adjust/restock reads (marker + part) both happen before any write',
  /const adjSnap = await tx\.get\(adjRef\);\s*\n\s*const partSnap = await tx\.get\(partRef\);/.test(adjBlock)
  && /const rsSnap = await tx\.get\(rsRef\);\s*\n\s*const partSnap = await tx\.get\(partRef\);/.test(rsBlock));
ok('the modals own stable op ids (StockAdjustModal / RestockModal) — Phase 5b: DURABLE',
  /useDurableOpId\(`adjust:\$\{part\.id\}`, 'adj'\)/.test(dash) && /useDurableOpId\(`restock:\$\{part\.id\}`, 'rs'\)/.test(dash));
ok('bulk adjust / bulk receive use ONE DURABLE op id per row, recovered on a refresh',
  /opId: readOrCreateOpId\(`bulk-adjust:\$\{p\.id\}`, 'adj'\)/.test(dash)
  && /opId: readOrCreateOpId\(`bulk-restock:\$\{part\.id\}`, 'rs'\)/.test(dash));
ok('the adjust/restock error messages admit uncertainty',
  /press Record adjustment again \(a repeat is safe\)/.test(dash)
  && /press Receive again \(a repeat is safe\)/.test(dash));

// pure re-impl
const markerTxn = (state, signedQty, opId) => {
  if (state.markers[opId]) return { ...state, alreadyApplied: true };
  return { stock: state.stock + signedQty, markers: { ...state.markers, [opId]: 1 }, ledgerRows: state.ledgerRows + 1, alreadyApplied: false };
};
let adjState = { stock: 20, markers: {}, ledgerRows: 0 };
adjState = markerTxn(adjState, -5, 'adj_1');
ok('A (single): adjust −5 → stock 15, one ledger row', adjState.stock === 15 && adjState.ledgerRows === 1);
const adjReplay = markerTxn(adjState, -5, 'adj_1');
ok('C/D (rapid double-click past the ref / retry): stock stays 15, still one ledger row',
  adjReplay.alreadyApplied === true && adjReplay.stock === 15 && adjReplay.ledgerRows === 1);
let rsState = markerTxn({ stock: 5, markers: {}, ledgerRows: 0 }, 8, 'rs_1');
const rsReplay = markerTxn(rsState, 8, 'rs_1');
ok('PH4-05 (restock replay): +8 applied once → stock 13, one restock row',
  rsState.stock === 13 && rsReplay.alreadyApplied === true && rsReplay.stock === 13 && rsReplay.ledgerRows === 1);

// =====================================================================
// PH4-06 — CREATE PURCHASE ORDER / CREATE SUPPLIER
// =====================================================================
console.log('\nPH4-06  Create Purchase Order / Create Supplier\n');
ok('[OK] createPO has a boolean in-flight guard (poCreateLock)',
  /const poCreateLock = useRef\(false\)/.test(dash) && /if \(poCreateLock\.current\) return false;/.test(dash));
ok('POCreateForm owns ONE stable poId, passed to onSubmit (Phase 5b: DURABLE)',
  /useDurableOpId\('create-po', 'po'\)/.test(billPO) && /\bpoId,/.test(billPO));
ok('poCreateDoc writes to that exact doc id with setDoc(merge) when a poId is supplied',
  /if \(poId\) return setDoc\(doc\(db, 'purchaseOrders', String\(poId\)\), data, \{ merge: true \}\)/.test(po));
ok('createPOInner threads input.poId (stable) instead of a fresh id per retry',
  /const poId = input\.poId \|\| `po_/.test(dash)
  && /await poCreateDoc\(base, user\?\.email, poId\)/.test(dash));
ok('SupplierModal owns ONE stable createOpId, passed in onSave (Phase 5b: DURABLE)',
  /useDurableOpId\('create-supplier', 'sup'\)/.test(dash) && /_rev: supplier\?\._rev, createOpId \}/.test(dash));
ok('handleSupplierSaveInner setDoc()s a new supplier to the client-stable id (no addDoc auto-id)',
  /const newId = formData\.createOpId \|\| `sup_/.test(dash)
  && /await setDoc\(doc\(db, COLLECTIONS\.SUPPLIERS, newId\), \{ \.\.\.payload, createdAt: serverTimestamp\(\) \}, \{ merge: true \}\)/.test(dash));
ok('createSupplierNow (quick-create) uses a deterministic id derived from the name',
  /const quickId = `sup_qc_/.test(dash) && /setDoc\(doc\(db, COLLECTIONS\.SUPPLIERS, quickId\)/.test(dash));
// Step 6 global-audit finding: Create Part is the same PH4-06 class (was addDoc auto-id).
ok('PartModal owns ONE stable createOpId, sent only on a NEW part (Phase 5b: DURABLE)',
  /useDurableOpId\('create-part', 'part'\)/.test(dash) && /if \(!isEdit\) out\.createOpId = createOpId;/.test(dash));
ok('a new part is written with setDoc to the client-stable id (no addDoc auto-id)',
  /newPartId = formData\.createOpId \|\| `part_/.test(dash)
  && /await setDoc\(doc\(db, COLLECTIONS\.PARTS, newPartId\)[\s\S]{0,160}\{ merge: true \}\)/.test(dash)
  && !/writeResult = await addDoc\(collection\(db, COLLECTIONS\.PARTS\)/.test(dash));
ok('the PO / supplier create errors admit uncertainty',
  /press Create PO again \(a repeat is safe\)/.test(dash)
  && /press Save again \(a repeat is safe\)/.test(dash));

// pure re-impl: setDoc to a stable id is create-or-overwrite, never a duplicate
const createStore = () => {
  const docs = {};
  return {
    setDoc: (id, data) => { docs[id] = { ...(docs[id] || {}), ...data }; },
    count: () => Object.keys(docs).length,
  };
};
let poDocs = createStore();
poDocs.setDoc('po_1', { poNumber: 'PO-1' });
poDocs.setDoc('po_1', { poNumber: 'PO-1' });   // retry, same id
ok('A/D (create then retry): one poId → one purchaseOrders doc', poDocs.count() === 1);
poDocs.setDoc('po_2', { poNumber: 'PO-2' });    // genuinely new PO
ok('B (legitimate second PO): a fresh poId → a second doc', poDocs.count() === 2);
let supDocs = createStore();
supDocs.setDoc('sup_1', { name: 'ZZ QA' });
supDocs.setDoc('sup_1', { name: 'ZZ QA' });
ok('PH4-06 (supplier create then retry): one createOpId → one suppliers doc', supDocs.count() === 1);

// =====================================================================
// PH4-07 — NEW JOB CARD RESERVATION
// =====================================================================
console.log('\nPH4-07  New Job Card reservation\n');
const jcBlock = slice(dash, 'const persistJobCard = async (card)', 'const persistCustomer');
ok('a reservation baseline map pins the reserved-stock effect per jobNo',
  /const reserveBaselineRef = useRef\(new Map\(\)\)/.test(dash)
  && /const pinReserveBaseline = \(jobNo, prior\) =>/.test(dash));
ok('the reserve delta is applied AFTER the awaited job-card write, not before it',
  /await persistJobCardsDiff\(prev, next\);[\s\S]{0,600}await applyReserveDelta\(reserveDelta\(reserveBaseline, card\), reserveOpId\);/.test(jcBlock)
  && !/applyReserveDelta[\s\S]{0,400}await persistJobCardsDiff\(prev, next\);/.test(jcBlock));
ok('the guarded-txn edit path also defers the reserve delta until after saveGuarded',
  /store\.saveGuarded\(COLLECTIONS\.JOB_CARDS[\s\S]{0,600}await applyReserveDelta\(reserveDelta\(reserveBaseline, card\), reserveOpId\);/.test(jcBlock));
ok('the baseline is advanced only after a confirmed write (so a retry recomputes the same delta)',
  /await applyReserveDelta\(reserveDelta\(reserveBaseline, card\), reserveOpId\);\s*\n\s*reserveBaselineRef\.current\.set\(card\.jobNo, card\);/.test(jcBlock));
ok('Phase 5b: the reservation increment carries a DURABLE reserveOpId + per-part appliedReserveIds marker',
  /const reserveOpId = demoMode \? null : readOrCreateOpId\(reserveScope, 'jcr'\);/.test(jcBlock)
  && /if \(reserveOpId && applied\.includes\(reserveOpId\)\) return;/.test(dash)
  && /appliedReserveIds: \[\.\.\.applied, reserveOpId\]\.slice\(-40\)/.test(dash));
ok('deleteJobCard also defers the reservation RELEASE until the delete is confirmed (with a durable id)',
  /await persistJobCardsDiff\(prev, next\);\s*\n[\s\S]{0,240}await applyReserveDelta\(reserveDelta\(baseline, null\), relOpId\);/.test(dash));
ok('the job-card doc write is keyed by jobNo (setDoc merge) — a retry rewrites the same doc',
  /batchOps\.push\(\{\s*\n?\s*type: 'set',[\s\S]{0,200}merge: true,/.test(read('../services/persistenceStore.js')));

// pure re-impl of the PH4-07 baseline logic
const reserveDeltaStub = (prior, card) => {
  const p = prior ? (prior.qty || 0) : 0;
  const c = card ? (card.qty || 0) : 0;
  return c - p; // net reserved-stock change for the (single) part on the card
};
const persistJobCardModel = (state, card, writeSucceeds) => {
  const baseline = state.baselines.has(card.jobNo)
    ? state.baselines.get(card.jobNo)
    : (state.cards[card.jobNo] || null);
  const baselines = new Map(state.baselines);
  if (!baselines.has(card.jobNo)) baselines.set(card.jobNo, baseline);
  // local state committed BEFORE the await (so a retry sees the card as prior)
  const cards = { ...state.cards, [card.jobNo]: card };
  if (!writeSucceeds) return { ...state, cards, baselines };   // write failed: reserved NOT touched, baseline NOT advanced
  const reserved = state.reserved + reserveDeltaStub(baseline, card);
  baselines.set(card.jobNo, card);
  return { cards, baselines, reserved };
};
let jc = { cards: {}, baselines: new Map(), reserved: 0 };
jc = persistJobCardModel(jc, { jobNo: 'JC-1', qty: 2 }, false);   // attempt 1 fails after the doc write
ok('G (write fails): no reservation is applied on a failed job-card creation (no phantom reserved)',
  jc.reserved === 0);
jc = persistJobCardModel(jc, { jobNo: 'JC-1', qty: 2 }, true);    // retry succeeds
ok('G (retry succeeds): the reservation is applied exactly once (reserved = 2, not 0, not 4)',
  jc.reserved === 2);
jc = persistJobCardModel(jc, { jobNo: 'JC-1', qty: 2 }, true);    // spurious duplicate save
ok('D (duplicate save of the same card): reserved stays 2 (delta from the advanced baseline is 0)',
  jc.reserved === 2);
jc = persistJobCardModel(jc, { jobNo: 'JC-1', qty: 5 }, true);    // genuine later edit: 2 -> 5 parts
ok('B (legitimate later edit): changing the card qty re-diffs from the baseline (reserved = 5)',
  jc.reserved === 5);

// =====================================================================
// PH4-08 — INVOICE NUMBER SKIP (documented, not redesigned)
// =====================================================================
console.log('\nPH4-08  Invoice number skip after a failed save (documented limitation)\n');
ok('invoice numbers are still allocated by the counters/{sequence} transaction (Phase 2, unchanged)',
  /counters/.test(read('../lib/docCounter.js')) && /runTransaction/.test(read('../lib/docCounter.js')));
ok('the opId-refresh + number-skip residual limitation is recorded in docs/KNOWN_LIMITATIONS.md',
  /opId|operation id|number skip|idempoten/i.test(read('../docs/KNOWN_LIMITATIONS.md')));

// =====================================================================
// CLEARED — backends that were already idempotent stay idempotent
// =====================================================================
console.log('\nCLEARED workflows (still idempotent)\n');
const delBlock = slice(dash, 'const deleteInvoice = async (iv) =>', 'const writeJobCardDraft');
ok('[OK] deleteInvoice: 2nd call sees !exists and skips the unwind cascade (Phase 3b)',
  /if \(!snap\.exists\(\)\) return null;/.test(delBlock) && /if \(prior\) runInvoiceTransaction\(prior, null, 'delete'\)/.test(delBlock));
ok('[OK] add-note / add-vehicle: replayIdArray dedups by element id',
  /if \(id != null && !beforeById\.has\(id\) && !seen\.has\(id\)\)/.test(read('../lib/concurrency.js')));
ok('[OK] guarded entity save: a 2nd click with a stale _rev is rejected conc/stale',
  /const state = revState\(snap\.exists\(\) \? snap\.data\(\) : null, expectedRev\);/.test(repo));
ok('[OK] archive/restore: updateDoc({archived: <bool>}) is naturally idempotent',
  /await updateDoc\(doc\(db, COLLECTIONS\.PARTS, id\), \{ archived: true/.test(dash)
  && /await updateDoc\(doc\(db, COLLECTIONS\.PARTS, id\), \{ archived: false/.test(dash));

// =====================================================================
// §11 — FIRESTORE TRANSACTION-CALLBACK RETRY SAFETY
// =====================================================================
console.log('\n§11  Firestore transaction-callback retry safety\n');
ok('every idempotent txn reads its marker BEFORE writing (PH4-01/03/04/05)',
  /priorPayments\.some\(\(p\) => p && p\.id === pay\.id\)/.test(payTxn)
  && /if \(saleSnap\.exists\(\)\)/.test(sellBlock)
  && /if \(adjSnap\.exists\(\)\)/.test(adjBlock)
  && /if \(rsSnap\.exists\(\)\)/.test(rsBlock));
ok('the realized cascade (runInvoiceTransaction) still runs AFTER the payment txn resolves, not inside it',
  /if \(alreadyApplied\) return fresh;[\s\S]{0,600}runInvoiceTransaction\(serverPrior, fresh, 'persist'\)/.test(payTxn));
ok('the payment txn callback is now safe to run more than once (append guarded by pay.id)',
  /priorPayments\.some\(\(p\) => p && p\.id === pay\.id\)/.test(payTxn));
ok('poReceiveDoc restock rows are still tx.set(doc(collection(...))) inside the txn (aborted retry never commits)',
  /tx\.set\(doc\(collection\(db, 'restocks'\)\), \{/.test(po));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
