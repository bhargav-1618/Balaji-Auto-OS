/**
 * tests/concurrency-cross-workflow.test.cjs
 *
 * CONCURRENCY PHASE 3b — cross-workflow data-integrity fixes.
 *
 * Phase 3 (discovery) found three ways two DIFFERENT workflows running at once
 * could corrupt business data. This suite pins the fixes:
 *
 *   CWF-01  concurrent payment collection double-ran invoice realization
 *           (double stock deduction + double revenue). Fixed: the realization
 *           cascade diffs against the payment TRANSACTION'S OWN server pre-image,
 *           not stale React state, so the 2nd concurrent payment sees Paid->Paid
 *           (a zero delta) and realization runs exactly once.
 *
 *   CWF-02  concurrent PO receive did last-writer-wins on `items[].receivedQty`
 *           and never capped over-receipt server-side. Fixed: poReceiveDoc runs a
 *           transaction that re-reads the PO and adds each delta to the SERVER's
 *           current receivedQty; over-receipt aborts the whole transaction.
 *
 *   CWF-03  a "secondary" customer write (add note / add vehicle / star default)
 *           persisted the WHOLE customer document, so two of them racing reverted
 *           each other's change to a DIFFERENT field. Fixed: store.syncAll writes
 *           only the changed keys, and id-keyed arrays (vehicles, noteEntries) are
 *           replayed onto the server's current array inside a transaction.
 *
 * jsdom + pure logic + source-pattern. The REAL concurrent-transaction behaviour
 * (two emulator clients) is proven in tests/rules/firestore.rules.test.cjs.
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

const { replayIdArray, isIdKeyedArray } = require('../lib/concurrency.js');
const { applyPoReceive } = require('../services/purchaseOrderService.js');
const { isRealized, stockDelta, ledgerDelta } = require('../services/billingService.js');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const dash = read('../components/InventoryDashboard.js');
const store_src = read('../services/persistenceStore.js');
const repo_src = read('../repositories/firestoreRepository.js');
const conc_src = read('../lib/concurrency.js');
const po_src = read('../services/purchaseOrderService.js');
const cust_src = read('../components/customers/CustomersModule.jsx');

// =====================================================================
// CWF-01 — concurrent payment must realize the invoice exactly once
// =====================================================================
console.log('\nCWF-01 — concurrent payment collection / invoice realization\n');

const payBlock = (() => {
  const s = dash.indexOf('const collectInvoicePayment');
  const e = dash.indexOf('const writeJobCardDraft', s);
  return dash.slice(s, e > s ? e : s + 4000);
})();

ok('the payment write is still a re-reading Firestore transaction',
  // Phase 6b (PH6-03) — the transaction is now wrapped in withTimeout(...) to
  // bound the UI wait; the transaction itself (re-read, then write) is unchanged.
  /await withTimeout\(runTransaction\(db, async \(tx\) => \{/.test(payBlock)
  && /const snap = await tx\.get\(invRef\)/.test(payBlock));
ok('the transaction returns its OWN pre-payment server image',
  /const serverPrior = \{ \.\.\.data, id: invoiceId \};/.test(payBlock)
  && /return \{ serverPrior, fresh, alreadyApplied: false, plan \};/.test(payBlock));
// PHASE 8B (PH8-01b) — runInvoiceTransaction was removed; the realization delta is
// now computed (planInvoiceRealization) and applied (applyRealizationPlanInTx)
// INSIDE this same transaction, still diffing against serverPrior, never
// invoicesRef.current.
ok('the realization cascade diffs serverPrior (NOT invoicesRef.current), now applied INSIDE the same transaction',
  /const plan = planInvoiceRealization\(serverPrior, fresh\);/.test(payBlock)
  && /applyRealizationPlanInTx\(tx, plan\);/.test(payBlock)
  && !/const prior = invoicesRef\.current\.find\(\(x\) => x\.id === invoiceId\)/.test(payBlock));
ok('both payment records still survive the merge (BUG-CONC-01 kept)',
  /const priorPayments = Array\.isArray\(data\.payments\) \? data\.payments : \[\];/.test(payBlock)
  && /const payments = \[\.\.\.priorPayments, pay\];/.test(payBlock));
// Phase 4b (PH4-01) — the same-id idempotency guard, layered on top of BUG-CONC-01.
ok('a duplicate delivery of the SAME pay.id is a no-op (Phase 4b idempotency)',
  /if \(pay && pay\.id && priorPayments\.some\(\(p\) => p && p\.id === pay\.id\)\)/.test(payBlock)
  && /alreadyApplied: true/.test(payBlock));
ok('a payment still bumps _rev (Phase 1a — open editor rejected as stale)',
  /const nextRev = revOf\(data\) \+ 1;/.test(payBlock) && /_rev: nextRev,/.test(payBlock));
ok('overpayment protection is unchanged (BillingModule still guards `overpay`)',
  /const overpay = num\(amount\) > t\.balance \+ 0\.5;/.test(read('../components/billing/BillingModule.jsx')));

// deleteInvoice — same root cause, same fix
// PHASE 8B (PH8-01c) — the transaction now lives in the dedicated
// deleteInvoiceTransactional (called by deleteInvoice right after), and applies
// the reversal delta (planInvoiceRealization + applyRealizationPlanInTx) INSIDE
// that same transaction — a delete can no longer succeed while its stock/ledger
// reversal silently fails. Slice starts at deleteInvoiceTransactional so the
// window covers both it and deleteInvoice itself.
const delBlock = (() => {
  const s = dash.indexOf('const deleteInvoiceTransactional = async (iv) =>');
  const e = dash.indexOf('const writeJobCardDraft', s);
  return dash.slice(s, e > s ? e : s + 2800);
})();
ok('deleteInvoice unwinds against a transactional server pre-image in production',
  // Phase 6b (PH6-03) — withTimeout(...) wraps the transaction; behavior unchanged.
  /withTimeout\(runTransaction\(db, async \(tx\) => \{[\s\S]{0,300}tx\.delete\(invRef\)/.test(delBlock)
  && /const plan = planInvoiceRealization\(prior, null\);/.test(delBlock)
  && /applyRealizationPlanInTx\(tx, plan\);/.test(delBlock)
  && /const prior = demoMode \? \(invoicesRef\.current\.find/.test(delBlock));

// --- pure logic: Paid -> Paid is a zero delta (2nd concurrent payment is a no-op)
const line = { id: 'l1', kind: 'Part', partId: 'p1', desc: 'Pad', qty: 2, rate: 500, disc: 0, gst: 0 };
const unpaid = { invNo: 'INV-1', isEstimate: false, status: 'Invoice', lines: [line], payments: [] };
const paidA = { ...unpaid, status: 'Invoice', payments: [{ id: 'pA', mode: 'Cash', amount: 1000 }] };
const paidAB = { ...unpaid, payments: [{ id: 'pA', mode: 'Cash', amount: 1000 }, { id: 'pB', mode: 'UPI', amount: 1000 }] };

ok('an unpaid invoice paid in full IS realized', isRealized(paidA) === true && isRealized(unpaid) === false);
ok('payment A: unpaid -> Paid deducts the 2 pads exactly once',
  JSON.stringify(stockDelta(unpaid, paidA)) === JSON.stringify({ p1: -2 }));
ok('payment B (serverPrior already Paid): Paid -> Paid is a ZERO stock delta — no double deduction',
  JSON.stringify(stockDelta(paidA, paidAB)) === '{}',
  `got ${JSON.stringify(stockDelta(paidA, paidAB))}`);
ok('payment B: Paid -> Paid is a ZERO ledger delta — no double revenue',
  Object.keys(ledgerDelta(paidA, paidAB)).length === 0,
  `got ${JSON.stringify(ledgerDelta(paidA, paidAB))}`);
ok('contrast — the OLD bug: a STALE unpaid prior vs Paid fresh double-deducts',
  JSON.stringify(stockDelta(unpaid, paidAB)) === JSON.stringify({ p1: -2 }));

// =====================================================================
// CWF-02 — concurrent PO receive
// =====================================================================
console.log('\nCWF-02 — concurrent purchase-order receive\n');

const items10 = [{ partId: 'p1', name: 'Pad', sku: 'PD', qty: 10, receivedQty: 0 }];

ok('applyPoReceive: first receipt 4 -> receivedQty 4, status partial',
  (() => { const r = applyPoReceive(items10, [{ partId: 'p1', receiveQty: 4 }], 'approved'); return r.items[0].receivedQty === 4 && r.status === 'partial' && !r.over; })());
ok('CWF-02: concurrent 4 + 3 both count — 2nd receipt adds to the SERVER value (7, not 3)',
  (() => {
    const afterA = applyPoReceive(items10, [{ partId: 'p1', receiveQty: 4 }], 'approved').items;
    const afterB = applyPoReceive(afterA, [{ partId: 'p1', receiveQty: 3 }], 'partial');
    return afterB.items[0].receivedQty === 7 && !afterB.over;
  })());
ok('CWF-02: 6 + 6 against ordered 10 cannot silently become 12 — the 2nd is rejected whole',
  (() => {
    const afterA = applyPoReceive(items10, [{ partId: 'p1', receiveQty: 6 }], 'approved').items;
    const b = applyPoReceive(afterA, [{ partId: 'p1', receiveQty: 6 }], 'partial');
    return b.over && b.over.ordered === 10 && b.over.already === 6 && JSON.stringify(b.items) === JSON.stringify(afterA);
  })());
ok('applyPoReceive: exact full receipt -> received / fullyReceived',
  (() => { const r = applyPoReceive(items10, [{ partId: 'p1', receiveQty: 10 }], 'approved'); return r.status === 'received' && r.fullyReceived === true; })());
ok('applyPoReceive is a PURE function of (serverItems, lines) — deterministic on repeat (retry-safe)',
  (() => {
    const a = applyPoReceive(items10, [{ partId: 'p1', receiveQty: 4 }], 'approved');
    const b = applyPoReceive(items10, [{ partId: 'p1', receiveQty: 4 }], 'approved');
    return JSON.stringify(a) === JSON.stringify(b);
  })());
ok('a zero / missing receive line is a no-op (normal single-client receive unaffected)',
  (() => { const r = applyPoReceive(items10, [{ partId: 'p1', receiveQty: 0 }], 'approved'); return JSON.stringify(r.items) === JSON.stringify(items10) && r.status === 'approved'; })());

ok('poReceiveDoc now runs a Firestore runTransaction that re-reads the PO',
  // Phase 6b (PH6-03) — withTimeout(...) wraps the transaction; behavior unchanged.
  /export function poReceiveDoc\([\s\S]{0,200}return withTimeout\(runTransaction\(db, async \(tx\) => \{/.test(po_src)
  && /const snap = await tx\.get\(poRef\)/.test(po_src));
ok('poReceiveDoc no longer uses a writeBatch or the caller-supplied po.items',
  !/writeBatch/.test(po_src)
  && !/poReceiveDoc[\s\S]{0,900}const items = po\.items/.test(po_src));
ok('poReceiveDoc derives new receivedQty from the SERVER items (applyPoReceive on server.items)',
  /applyPoReceive\(server\.items \|\| \[\], receivedLines, server\.status\)/.test(po_src));
ok('poReceiveDoc aborts the whole transaction on over-receipt (no partial stock move)',
  /if \(over\) \{[\s\S]{0,400}e\.code = 'po\/over-receipt';[\s\S]{0,40}throw e;/.test(po_src));
ok('stock increment + restock row are written INSIDE the transaction (atomic with the PO update)',
  /tx\.update\(doc\(db, 'parts', line\.partId\), partUpdate\)/.test(po_src)
  && /tx\.set\(doc\(collection\(db, 'restocks'\)\), \{/.test(po_src));
ok('the receivePO caller surfaces the over-receipt / deleted message and keeps the form open',
  /if \(e\?\.code === 'po\/over-receipt' \|\| e\?\.code === 'po\/deleted'\) \{[\s\S]{0,80}toast\.error\(e\.message\); \}/.test(dash)
  && /const serverStatus = res\?\.status \|\| status;/.test(dash));

// =====================================================================
// CWF-03 — concurrent secondary customer writes
// =====================================================================
console.log('\nCWF-03 — concurrent secondary customer writes\n');

ok('replayIdArray: append onto empty', JSON.stringify(replayIdArray([], [{ id: 'n1' }], [])) === JSON.stringify([{ id: 'n1' }]));
ok('CWF-03 test 3: note + note — my note appended, the OTHER client\'s note kept',
  JSON.stringify(replayIdArray([], [{ id: 'nB', t: 'B' }], [{ id: 'nA', t: 'A' }]))
    === JSON.stringify([{ id: 'nA', t: 'A' }, { id: 'nB', t: 'B' }]));
ok('CWF-03 test 2: vehicle + vehicle — both survive',
  JSON.stringify(replayIdArray([{ id: 'v1' }], [{ id: 'v1' }, { id: 'v2' }], [{ id: 'v1' }, { id: 'v3' }]))
    === JSON.stringify([{ id: 'v1' }, { id: 'v3' }, { id: 'v2' }]));
ok('replayIdArray: my remove is honoured, the other client\'s concurrent add is kept',
  JSON.stringify(replayIdArray([{ id: 'v1' }], [], [{ id: 'v1' }, { id: 'v2' }])) === JSON.stringify([{ id: 'v2' }]));
ok('replayIdArray: my edit wins for MY element, untouched elements keep the server version',
  JSON.stringify(replayIdArray([{ id: 'v1', s: 'o' }], [{ id: 'v1', s: 'mine' }], [{ id: 'v1', s: 'o' }, { id: 'v2', s: 'srv' }]))
    === JSON.stringify([{ id: 'v1', s: 'mine' }, { id: 'v2', s: 'srv' }]));
ok('replayIdArray is idempotent (a retried transaction re-running yields the same array)',
  (() => {
    const b = [{ id: 'v1' }]; const a = [{ id: 'v1' }, { id: 'v2' }]; const s = [{ id: 'v1' }, { id: 'v9' }];
    return JSON.stringify(replayIdArray(b, a, s)) === JSON.stringify(replayIdArray(b, a, replayIdArray(b, a, s)));
  })());
ok('isIdKeyedArray: only for non-empty arrays of {id} objects',
  isIdKeyedArray([{ id: 1 }]) === true && isIdKeyedArray([]) === false && isIdKeyedArray([{ x: 1 }]) === false && isIdKeyedArray('x') === false);

ok('store.syncAll writes ONLY changed top-level keys, not the whole document',
  /Object\.keys\(d\)\.forEach\(\(k\) => \{[\s\S]{0,400}if \(JSON\.stringify\(before\[k\]\) === JSON\.stringify\(d\[k\]\)\) return;/.test(store_src)
  && !/data: \{ \.\.\.d, createdAt: d\.createdAt \|\| Date\.now\(\), updatedAt: new Date\(\) \},\s*\n\s*merge: true,\s*\n\s*\}\);\s*\n\s*\}\s*\n\s*\}\);/.test(store_src));
ok('store.syncAll routes id-keyed array changes through the transactional replay',
  /if \(isIdKeyedArray\(before\[k\]\) \|\| isIdKeyedArray\(d\[k\]\)\) \{[\s\S]{0,120}idArrayReplays\.push/.test(store_src)
  && /await repo\.applySecondaryMerge\(collectionName, m\.id, m\.plainFields, m\.idArrayReplays\)/.test(store_src));
ok('store.syncAll uses batch.update (not set-merge) for scalar changes — cannot resurrect a deleted doc',
  /type: 'update',\s*\n\s*collection: collectionName,/.test(store_src));
ok('repo.applySecondaryMerge: re-reads inside a transaction and refuses to write a deleted doc',
  /export async function applySecondaryMerge\([\s\S]{0,600}if \(!snap\.exists\(\)\) \{[\s\S]{0,120}CONC_DELETED/.test(repo_src)
  && /patch\[key\] = replayIdArray\(before, after, server\[key\]\)/.test(repo_src));
ok('repo.applySecondaryMerge never touches _rev (a secondary write must not fail an open wizard)',
  !/\b_rev\b/.test(repo_src.slice(repo_src.indexOf('export async function applySecondaryMerge'), repo_src.indexOf('export async function applySecondaryMerge') + 900)));

ok('CWF-03 test 7: the guarded wizard save id-array-replays `vehicles` too (both directions safe)',
  /const \{ idArrayKeys = \[\], clientBefore = null \} = opts;/.test(repo_src)
  && /clean\[k\] = replayIdArray\(clientBefore \? clientBefore\[k\] : undefined, clean\[k\], server\[k\]\)/.test(repo_src)
  && /idArrayKeys: \['vehicles'\]/.test(dash));
ok('CWF-03 test 7: the wizard payload drops panel-owned arrays + derived figures',
  /const \{ noteEntries, documents, totalSpent, outstanding, visits, \.\.\.wizardFields \} = c;/.test(cust_src)
  && /await onSaveCustomerEdit\(\s*\{ \.\.\.wizardFields, history: hist \}/.test(cust_src));

// =====================================================================
// guardrails — Phase 1a/1b/1c not weakened, no rules/numbering/business drift
// =====================================================================
console.log('\nGuardrails\n');

ok('Phase 1a guarded save still checks _rev via revState/conflictError',
  /const state = revState\(snap\.exists\(\) \? snap\.data\(\) : null, expectedRev\);/.test(repo_src)
  && /const err = conflictError\(state, label\);/.test(repo_src));
ok('Phase 1b edit lease + Phase 1c record-sync are untouched by the persistence layer',
  !/editLease|editLocks|useEditLease|recordSync|useRecordSync/.test(store_src + repo_src + conc_src + po_src));
ok('invoice number allocation (Phase 2) transaction is untouched',
  // Phase 6b (PH6-03) — withTimeout(...) wraps the transaction; behavior unchanged.
  /store\.allocateNumber\(__allocSeq, __allocSeed\)/.test(dash)
  && /return withTimeout\(runTransaction\(db, async \(tx\) => \{/.test(read('../lib/docCounter.js')));
ok('firestore.rules carries NO Phase-3b changes (the writes were already allowed for signed-in users)',
  !/phase ?3|CWF-0|po\/over-receipt/i.test(read('../firestore.rules')));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
