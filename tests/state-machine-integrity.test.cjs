/**
 * tests/state-machine-integrity.test.cjs
 *
 * PHASE 17 — STATE-MACHINE / LIFECYCLE INTEGRITY.
 *
 * Central requirement: a transition forbidden by business semantics must not
 * be performable merely by bypassing a UI restriction — the mutation layer
 * (service / transaction) must enforce it too.
 *
 * The app's real state machines (derived from source, not invented):
 *
 *  Invoice — status is DERIVED from payments + grandTotal + isEstimate
 *    (deriveStatus / invStatus): Draft/Estimate → Pending → Partially Paid
 *    → Paid, plus the three EXPLICIT terminal overrides Cancelled / Refunded
 *    / Returned which, once set, stick verbatim regardless of payments.
 *    You cannot FORCE "Paid" or "Draft" — the derived value wins.
 *
 *  Purchase Order — status field: draft → pending → approved → sent →
 *    partial → received, plus cancelled. `received` and `cancelled` are
 *    terminal. `applyPoReceive` computes the next status from received
 *    quantities and rejects over-receipt; PHASE 17 adds: a cancelled PO
 *    can never be received against.
 *
 *  Job Card — ordered JOB_CARD_STATUSES workflow (UI-guarded stage ordering,
 *    admin-overridable by design); reservation is a pure function of
 *    status ∈ {Cancelled,Closed,Delivered} (→ 0) and parts[], diff-based
 *    and idempotent — order-independent, so a stage skip cannot corrupt it.
 *
 * Expected transition results come from independent hand-built matrices,
 * never from calling the production state helper and comparing it to itself.
 */
require('./setup.cjs');
const fs = require('fs');
const path = require('path');
const { applyPoReceive } = require('../lib/poReceive.js');
const { cardReservedQtys, reserveDelta } = require('../services/inventoryService.js');
const { invStatus } = require('../components/InventoryDashboard.js');
const { deriveStatus } = require('../components/billing/BillingModule.jsx');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const dash = read('../components/InventoryDashboard.js');
const billing = read('../components/billing/BillingModule.jsx');
const poSvc = read('../services/purchaseOrderService.js');
const poLib = read('../lib/poReceive.js');
const capSvc = read('../services/capacityService.js');
const constants = read('../constants/index.js') + read('../constants/capacity.js') + read('../constants/ui.js');

console.log('\nPHASE 17 — state-machine / lifecycle integrity\n');

// =====================================================================
// 1 — STATE DISCOVERY — the discovered vocabulary matches the constants
// =====================================================================
console.log('1  State discovery\n');

ok('[fact] Invoice terminal-override states are exactly Cancelled / Refunded / Returned',
  /INVOICE_STATUS = Object\.freeze\(\{[\s\S]*?CANCELLED: 'Cancelled'[\s\S]*?REFUNDED: 'Refunded'[\s\S]*?RETURNED: 'Returned'/.test(constants)
  && /NON_REALIZING_STATUSES = Object\.freeze\(\[[\s\S]*?CANCELLED[\s\S]*?REFUNDED[\s\S]*?RETURNED/.test(constants));
ok('[fact] PO terminal states are exactly received / cancelled',
  /TERMINAL_PO_STATUSES = Object\.freeze\(\['received', 'cancelled'\]\)/.test(constants));
ok('[fact] Job Card terminal states are exactly Delivered / Closed / Cancelled',
  /TERMINAL_JOB_CARD_STATUSES = Object\.freeze\(\['Delivered', 'Closed', 'Cancelled'\]\)/.test(constants));
ok('[fact] Job Card workflow is an ORDERED list whose index order is the enforced sequence',
  /JOB_CARD_STATUSES = Object\.freeze\(\[[\s\S]*?'Received',[\s\S]*?'Closed', 'Cancelled'/.test(constants));

// =====================================================================
// 2 — INVOICE STATE MACHINE — derived status cannot be forged
// =====================================================================
console.log('\n2  Invoice — derived status, terminal overrides stick\n');

// Independent status oracle (hand-derived from the discovered semantics,
// NOT a copy of deriveStatus/invStatus).
function oracleStatus(iv) {
  if (['Cancelled', 'Refunded', 'Returned'].includes(iv.status)) return iv.status;
  if (iv.isEstimate) return 'Estimate';
  const grand = Number(iv.grandTotal) || (iv.lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  const paid = (iv.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  if (grand > 0 && paid > grand + 0.5) return 'partial-overpaid';
  if (grand > 0 && paid >= grand - 0.5) return 'paid';
  if (paid > 0) return 'partial';
  return iv.status === 'Draft' ? 'draft' : 'unpaid';
}

{
  // Forge attempt: an unpaid invoice with status hand-set to "Paid".
  const forged = { status: 'Paid', grandTotal: 1000, payments: [], lines: [{ qty: 1, rate: 1000 }] };
  ok('Paid → forging: an unpaid invoice with status:"Paid" still derives as NOT paid (both engines ignore the forged field)',
    invStatus(forged) !== 'Paid' && deriveStatus(forged) !== 'Paid'
    && ['unpaid', 'draft'].includes(oracleStatus(forged)));

  // Forge attempt: a paid invoice with status hand-set to "Draft".
  const forgedDraft = { status: 'Draft', grandTotal: 1000, payments: [{ id: 'p1', amount: 1000 }], lines: [{ qty: 1, rate: 1000 }] };
  ok('Draft → forging: a fully-paid invoice with status:"Draft" still derives as "Paid" (the payment data wins)',
    invStatus(forgedDraft) === 'Paid' && deriveStatus(forgedDraft) === 'Paid'
    && oracleStatus(forgedDraft) === 'paid');

  // Terminal override sticks regardless of payments.
  const returned = { status: 'Returned', grandTotal: 1000, payments: [{ id: 'p1', amount: 1000 }], lines: [{ qty: 1, rate: 1000 }] };
  ok('Returned terminal state: a fully-paid returned invoice reports "Returned", not "Paid" — the override is verbatim',
    invStatus(returned) === 'Returned' && deriveStatus(returned) === 'Returned'
    && oracleStatus(returned) === 'Returned');

  const cancelled = { status: 'Cancelled', grandTotal: 1000, payments: [{ id: 'p1', amount: 500 }], lines: [{ qty: 1, rate: 1000 }] };
  ok('Cancelled terminal state: sticks verbatim even with a partial payment on record',
    invStatus(cancelled) === 'Cancelled' && deriveStatus(cancelled) === 'Cancelled');
}

ok('[fact] changeStatus (the Cancel/Refund/Return action) only ever sets a terminal-override status, never an active one',
  (billing.match(/changeStatus\(iv, '(Refunded|Returned|Cancelled)'/g) || []).length >= 3
  && !/changeStatus\(iv, '(Paid|Draft|Unpaid|Pending|Partially Paid)'/.test(billing));
ok('[fact] editing a Cancelled/Refunded/Returned invoice keeps that status (deriveStatus/invStatus return it verbatim before any recompute) — no "revive by editing"',
  /if \(inv\.status === 'Cancelled' \|\| inv\.status === 'Refunded' \|\| inv\.status === 'Returned'\) return inv\.status;/.test(billing)
  && /if \(iv\.status === 'Cancelled' \|\| iv\.status === 'Refunded' \|\| iv\.status === 'Returned'\) return iv\.status;/.test(dash));

// =====================================================================
// 3 — INVOICE MUTATION BOUNDARY — deleted docs cannot be resurrected
// =====================================================================
console.log('\n3  Invoice — deleted → edit / pay is blocked at the transaction\n');

ok('[fact] editInvoiceTransactional throws conc/deleted (via revState/conflictError) when the doc no longer exists — a stale editor cannot resurrect a deleted invoice',
  /const state = revState\(snap\.exists\(\) \? snap\.data\(\) : null, expectedRev\);\s*\n\s*const err = conflictError\(state, 'This invoice'\);\s*\n\s*if \(err\) throw err;/.test(dash));
ok('[fact] collectInvoicePayment throws conc/deleted when the invoice snap does not exist — no payment onto a deleted invoice',
  /if \(!snap\.exists\(\)\) \{\s*\n\s*const err = new Error\('This invoice was deleted by another user\. Reload before collecting payment\.'\);\s*\n\s*err\.code = 'conc\/deleted';/.test(dash));

// =====================================================================
// 4 — PO STATE MACHINE — cancelled is terminal (PH17-01 fix)
// =====================================================================
console.log('\n4  Purchase Order — cancelled → receive is blocked (PH17-01)\n');

const item10 = [{ partId: 'p1', qty: 10, receivedQty: 0, name: 'Widget' }];

// Independent PO transition matrix — what applyPoReceive must do for each
// starting status, hand-derived, not by calling it.
const poReceiveMatrix = [
  { from: 'draft', delta: 4, expectStatus: 'partial', expectBlocked: false },
  { from: 'approved', delta: 4, expectStatus: 'partial', expectBlocked: false },
  { from: 'sent', delta: 10, expectStatus: 'received', expectBlocked: false },
  { from: 'partial', delta: 4, expectStatus: 'partial', expectBlocked: false },
  { from: 'cancelled', delta: 4, expectStatus: 'cancelled', expectBlocked: true },
];
poReceiveMatrix.forEach(({ from, delta, expectStatus, expectBlocked }) => {
  const r = applyPoReceive(item10, [{ partId: 'p1', receiveQty: delta }], from);
  ok(`applyPoReceive: from "${from}" receiving ${delta} -> ${expectBlocked ? 'BLOCKED, nothing applied' : `status "${expectStatus}"`}`,
    expectBlocked
      ? (r.blocked === 'cancelled' && r.status === 'cancelled' && r.items[0].receivedQty === 0)
      : (r.status === expectStatus && !r.blocked && !r.over));
});

// over-receipt still rejected (unchanged), and a fully-received PO's any
// positive delta is caught by over-receipt (no separate "received" guard needed).
{
  const over = applyPoReceive(item10, [{ partId: 'p1', receiveQty: 11 }], 'sent');
  ok('applyPoReceive: over-receipt (11 of 10) still rejected, nothing applied',
    over.over && over.over.ordered === 10 && over.items[0].receivedQty === 0);
  const full = [{ partId: 'p1', qty: 10, receivedQty: 10, name: 'Widget' }];
  const again = applyPoReceive(full, [{ partId: 'p1', receiveQty: 1 }], 'received');
  ok('applyPoReceive: receiving against a fully-received PO -> over-receipt rejection (every line already at ordered qty)',
    again.over && again.items[0].receivedQty === 10);
}

ok('[fact] poReceiveDoc surfaces the cancelled block as a definite non-commit (throws po/cancelled) INSIDE its transaction, on the re-read server status',
  /if \(blocked === 'cancelled'\) \{[\s\S]{0,200}e\.code = 'po\/cancelled';\s*\n\s*throw e;/.test(poSvc)
  && /applyPoReceive\(server\.items \|\| \[\], receivedLines, server\.status\)/.test(poSvc));
ok('[fact] receivePO (the caller) has a client-side cancelled guard too (covers demo mode + a pre-cancel snapshot) and treats po/cancelled as a definite non-commit',
  /if \(po\.status === 'cancelled'\) \{ toast\.error\([\s\S]{0,80}clearOpId\(`receive:\$\{po\.id\}`\); return; \}/.test(dash)
  && /e\?\.code === 'po\/over-receipt' \|\| e\?\.code === 'po\/deleted' \|\| e\?\.code === 'po\/cancelled'/.test(dash));
ok('[fact] cancelPO blocks cancelling a PO with any received quantity (received → cancel guard)',
  /if \(po\.status === 'received' \|\| receivedAny\) \{ toast\.error\('A PO with received quantity can.t be cancelled\.'\); return; \}/.test(dash));

// =====================================================================
// 5 — JOB CARD — reservation is order-independent and idempotent
// =====================================================================
console.log('\n5  Job Card — reservation state (stage-skip / re-complete safe)\n');

{
  const parts = [{ partId: 'a', qty: 2 }, { partId: 'b', qty: 3 }];
  const active = { status: 'Repair Started', parts };
  const closed = { status: 'Closed', parts };
  const cancelled = { status: 'Cancelled', parts };
  const delivered = { status: 'Delivered', parts };

  ok('cardReservedQtys: an active card reserves its parts; Closed / Cancelled / Delivered reserve NOTHING (a terminal card holds no stock)',
    JSON.stringify(cardReservedQtys(active)) === JSON.stringify({ a: 2, b: 3 })
    && Object.keys(cardReservedQtys(closed)).length === 0
    && Object.keys(cardReservedQtys(cancelled)).length === 0
    && Object.keys(cardReservedQtys(delivered)).length === 0);

  // Stage-skip: Received straight to Closed (admin override) still releases
  // the full reservation in one step — the delta is a pure function of the
  // two states, not of the path between them.
  ok('stage skip Received → Closed releases the full reservation exactly once (order-independent delta)',
    JSON.stringify(reserveDelta({ status: 'Received', parts }, closed)) === JSON.stringify({ a: -2, b: -3 }));

  // Re-completing: closing an already-closed card is a zero delta — no
  // double release (the Phase 4b/8B idempotency contract, re-verified).
  ok('re-close (Closed → Closed): reserveDelta is empty — no repeated reservation release',
    Object.keys(reserveDelta(closed, closed)).length === 0);

  // Reopen a cancelled card: reservation correctly RE-applies (the job is
  // back on) — a distinct, intentional transition, not an accidental overwrite.
  ok('reopen Cancelled → Repair Started re-reserves the parts (deliberate regression, the confirmed UI transition)',
    JSON.stringify(reserveDelta(cancelled, active)) === JSON.stringify({ a: 2, b: 3 }));
}

ok('[fact] Job Card workflow stage-skip is UI-only (staff blocked, admin override by design), enforced against JOB_CARD_STATUSES index order — a soft operational guardrail, not a data invariant',
  /if \(!isAdmin && !jumpAllowed && nxt !== cur \+ 1\) \{ toast\.error\([\s\S]{0,140}workflow can.t be skipped[\s\S]{0,20}return; \}/.test(read('../components/jobcards/JobCardModule.jsx')));
ok('[fact] persistJobCard applies the reservation delta from a PINNED baseline AFTER the guarded write confirms — a retry recomputes the same delta, never double-reserves (Phase 4b/5b/8B)',
  /await applyReserveDelta\(reserveDelta\(reserveBaseline, card\), reserveOpId\);/.test(dash));

// =====================================================================
// 6 — TERMINAL-STATE DELETION ELIGIBILITY
// =====================================================================
console.log('\n6  Terminal states gate deletion / archival\n');

ok('[fact] capacityService.checkEligibility blocks archiving a job card whose status is NOT terminal',
  /if \(!TERMINAL_JOB_CARD_STATUSES\.includes\(record\.status\)\) \{\s*\n\s*return \{ eligible: false/.test(capSvc));
ok('[fact] capacityService blocks archiving an invoice that is not in a terminal (settled) status',
  /if \(!TERMINAL_INVOICE_STATUSES\.includes\(status\)\) \{\s*\n\s*return \{ eligible: false/.test(capSvc));
ok('[fact] capacityService blocks archiving a PO that is not terminal (received / cancelled)',
  /if \(!TERMINAL_PO_STATUSES\.includes\(record\.status\)\) \{\s*\n\s*return \{ eligible: false/.test(capSvc));
ok('[fact] a terminal job card still linked to a still-open invoice is STILL protected (referential integrity, Phase 9/10, unregressed)',
  /if \(ctx\.activeInvoiceJobNos && ctx\.activeInvoiceJobNos\.has\(record\.jobNo\)\) \{\s*\n\s*return \{ eligible: false, reason: 'Linked to a still-open invoice' \};/.test(capSvc));

// =====================================================================
// 7 — REVERSAL SIDE-EFFECT SYMMETRY (Paid ↔ non-realizing)
// =====================================================================
console.log('\n7  Realization ↔ reversal is one diff-based engine (Phase 8B/11, unregressed)\n');

ok('[fact] moving an invoice Paid → Cancelled/Refunded/Returned reverses stock+sales+rollup through the SAME planInvoiceRealization diff — no separate reversal path to double-apply or omit (PH11-01 guard: onRestoreStock is gone)',
  /DIFF-BASED, therefore IDEMPOTENT: always diffs prior->next on REALIZED/.test(dash)
  && !/onRestoreStock\?\.\(|onRestoreStock\}/.test(billing));
ok('[fact] isRealized checks status against exactly the non-realizing set — a Cancelled/Refunded/Returned invoice is never treated as realized',
  /\['Cancelled', 'Refunded', 'Returned'\]/.test(billing) || /NON_REALIZING_STATUSES/.test(dash));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
