/**
 * tests/concurrency-payment.test.cjs
 *
 * BUG-CONC-01 regression — concurrent payment collection must not lose a payment.
 *
 * Reproduced live against production Firestore with two client contexts:
 *   invoice balance ₹1000, payments []
 *   cashier A collects ₹400  -> writes payments:[₹400]
 *   cashier B collects ₹600 from the SAME stale snapshot (payments []) -> writes payments:[₹600]
 *   final Firestore payments = [₹600] only.  ₹400 vanished; the invoice still showed ₹400 due.
 *
 * Root cause: BillingModule.collectPayment() built `payments: [...iv.payments, pay]`
 * from the modal's opening snapshot and persisted the whole invoice (full array
 * replace, no re-read, no transaction).
 *
 * Fix: in production the payment is posted through `collectInvoicePayment`
 * (components/InventoryDashboard.js) — a Firestore `runTransaction` that RE-READS the
 * invoice and appends the payment to the SERVER's current `payments` array, then
 * recomputes paid / balance / status from server truth. The retry semantics of
 * runTransaction make two racing appends serialise, so BOTH payments survive.
 * Demo mode (one client, no server) keeps the existing in-memory path.
 *
 * This suite pins:
 *   1. the transactional handler exists and is wired to BillingModule,
 *   2. BillingModule routes production payments through it (not the stale full-write),
 *   3. the merge-and-recompute logic the transaction runs yields ₹400 + ₹600 = ₹1000
 *      FULLY PAID even when each cashier started from a stale (empty) snapshot.
 */
require('./setup.cjs');
const fs = require('fs');
const path = require('path');
const { totalsOf, deriveStatus } = require('../components/billing/BillingModule.jsx');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');

console.log('\nBUG-CONC-01 — concurrent payment collection is atomic (no lost payment)\n');

// ── 1. source: the transactional handler ─────────────────────────────────────
const dash = read('../components/InventoryDashboard.js');
const start = dash.indexOf('const collectInvoicePayment');
const end = dash.indexOf('const deleteInvoice', start);
const block = start >= 0 ? dash.slice(start, end > start ? end : start + 2600) : '';

ok('collectInvoicePayment handler exists', start >= 0);
ok('it uses a Firestore runTransaction',
  // Phase 6b (PH6-03) — withTimeout(...) wraps the transaction; behavior unchanged.
  /await withTimeout\(runTransaction\(db, async \(tx\) => \{/.test(block));
ok('it RE-READS the invoice inside the transaction (tx.get)', /const snap = await tx\.get\(invRef\)/.test(block));
ok('it rejects when the invoice was deleted by another user',
  /!snap\.exists\(\)/.test(block) && /conc\/deleted/.test(block));
ok('it appends to the SERVER payments array, not a client snapshot',
  /const priorPayments = Array\.isArray\(data\.payments\) \? data\.payments : \[\];/.test(block)
  && /const payments = \[\.\.\.priorPayments, pay\];/.test(block));
ok('it no-ops when this pay.id is already on the server invoice (Phase 4b idempotency)',
  /priorPayments\.some\(\(p\) => p && p\.id === pay\.id\)/.test(block) && /alreadyApplied: true/.test(block));
ok('it recomputes paid / balance / status from server truth inside the tx',
  /invTotals\(merged\)/.test(block) && /invStatus\(merged\)/.test(block) &&
  /tx\.update\(invRef, \{[\s\S]{0,400}paid: t\.paid[\s\S]{0,400}balance: t\.balance[\s\S]{0,400}status,/.test(block));
// PHASE 8B (PH8-01b) — the realized stock/ledger/rollup cascade is no longer a
// separate call at all (runInvoiceTransaction was removed): planInvoiceRealization
// computes the delta and applyRealizationPlanInTx writes it INSIDE this SAME
// transaction, atomically with the money write itself — strictly stronger than
// "runs after, not a re-persist" (nothing can commit the payment while silently
// failing to commit its stock/ledger effect, or vice versa).
ok('PH8-01b: the realized stock/ledger/rollup cascade is applied INSIDE the SAME atomic transaction as the money write, not a separate re-persist or a separate un-awaited call',
  /const plan = planInvoiceRealization\(serverPrior, fresh\);/.test(block) &&
  /applyRealizationPlanInTx\(tx, plan, existingPartIds\);/.test(block) &&
  !/persistDocsDiff\(COLLECTIONS\.INVOICES/.test(block) &&
  !/runInvoiceTransaction/.test(block));
// Phase 3b (CWF-01) — the cascade must diff against the TRANSACTION'S OWN pre-image,
// never `invoicesRef.current` (stale React state), or two concurrent payments each
// see prior=unpaid / fresh=Paid and both run the full realization.
ok('CWF-01: the realization `prior` is the transaction\'s server pre-image, not client state',
  /const serverPrior = \{ \.\.\.data, id: invoiceId \}/.test(block) &&
  /return \{ serverPrior, fresh, alreadyApplied: false, plan \};/.test(block) &&
  !/const prior = invoicesRef\.current\.find\(\(x\) => x\.id === invoiceId\)/.test(block));

// ── 2. wiring ───────────────────────────────────────────────────────────────
ok('BillingModule is handed onCollectPayment in production only (undefined in demo)',
  /onCollectPayment=\{demoMode \? undefined : collectInvoicePayment\}/.test(dash));

const bill = read('../components/billing/BillingModule.jsx');
ok('BillingModule accepts the onCollectPayment prop',
  /export default function BillingModule\(\{[^}]*onCollectPayment[^}]*\}\)/.test(bill));
ok('collectPayment() routes through onCollectPayment when present (skips the stale full-write path)',
  /if \(onCollectPayment\) \{[\s\S]{0,400}await onCollectPayment\(iv\.id, pay\)/.test(bill));
ok('a conflict (deleted/changed) surfaces a clear reload message, not a false "recorded"',
  /conc\/deleted[\s\S]{0,200}changed or deleted by another user[\s\S]{0,200}Reload/.test(bill));
ok('the pre-existing in-memory path is still there for demo / no-handler',
  /const next = \{ \.\.\.iv, payments: \[\.\.\.\(iv\.payments \|\| \[\]\), pay\] \};/.test(bill));

// ── 3. behaviour: the merge the transaction performs ─────────────────────────
// Cashier A's ₹400 has already committed. Cashier B's transaction RE-READS and sees
// payments:[₹400] (server truth), then appends B's ₹600.
const serverAfterA = {
  invNo: 'INV-CONC', isEstimate: false, status: 'Invoice',
  lines: [{ id: 'l1', kind: 'Part', partId: 'p1', desc: 'Part', qty: 1, rate: 1000, disc: 0, gst: 0 }],
  payments: [{ id: 'pA', mode: 'Cash', amount: 400, date: '2026-09-02' }],
};
const bPay = { id: 'pB', mode: 'UPI', amount: 600, date: '2026-09-02' };
const merged = { ...serverAfterA, payments: [...serverAfterA.payments, bPay] };
const t = totalsOf(merged);

ok('B\'s transaction appends to A\'s payment — both survive', merged.payments.length === 2
  && merged.payments.some((p) => p.amount === 400) && merged.payments.some((p) => p.amount === 600));
ok('recomputed paid = ₹1000 (₹400 + ₹600)', t.paid === 1000, `paid = ${t.paid}`);
ok('recomputed balance = ₹0', t.balance === 0, `balance = ${t.balance}`);
ok('recomputed status = Paid', deriveStatus(merged) === 'Paid', `status = ${deriveStatus(merged)}`);

// contrast: the OLD stale-snapshot behaviour would have lost ₹400
const stale = { ...serverAfterA, payments: [bPay] };   // B started from payments:[]
ok('the OLD path (full array replace from stale snapshot) DID lose ₹400 — regression guard',
  totalsOf(stale).paid === 600 && totalsOf(stale).balance === 400);

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
