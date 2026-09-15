# Phase 14 — Ledger / Business-Event Integrity Audit

## 1. Executive summary

Central invariant tested: **one business action → exactly the expected
ledger/event records → exactly once.** The critical nuance, established in
§3 below from the real code rather than assumed: "exactly one" is defined
**per ledger type**, not per business action. One invoice with 3 distinct
parts legitimately produces 3 sales rows; the same part billed on 2 lines
legitimately produces 1 (aggregated); 2 identical-looking labour lines
legitimately produce 2 (never merged). Getting this cardinality rule wrong
in either direction — merging what should stay separate, or splitting what
should merge — would itself look like a duplicate or a missing event to a
naive count-only check, so this phase derived every expected count from the
actual keying/idempotency logic in the shipped code, not from assumption.

**Result: no CRITICAL or HIGH ledger-integrity defect found.** Every
authoritative money/stock-affecting action already commits its ledger
effect(s) atomically with its state change, keyed for idempotency, matching
this program's Phase 4b/8B/9/11/12/13 hardening. One INFO-level hazard was
found and removed: a demo-only function retained two **dead** production
Firestore-write branches (unreachable today, but a live duplicate-ledger
risk if ever mistakenly reactivated) — removed as hardening, not as a fix
for an active defect. One LOW/documented audit-timing nuance and one
code-organization observation (two audit helpers) are recorded, not fixed,
per this phase's own instruction not to manufacture guarantees advisory
audit logging was never designed to give.

## 2. Ledger/event inventory (Phase 14A)

| Collection / field | Classification | Writers |
|---|---|---|
| `sales` | FINANCIAL + INVENTORY | Invoice realization (`applyRealizationPlanInTx`, N rows/invoice), Quick Sell (`runQuickSaleTx`, 1 row, doc id = opId) |
| `salesRollups/{month}` | DERIVED / ROLLUP | Both of the above, via `increment()` — never overwritten, safe under concurrent writers |
| `restocks` | INVENTORY | PO receive (`poReceiveDoc`, N rows/receipt, 1 per line), Quick Restock stepper (`commitStock`, 1 row, doc id = `qr_{partId}_{targetStock}`), manual Receive Stock form (`receiveStockLineInner`, 1 row, doc id = opId) |
| `stockAdjustments` | INVENTORY | Stock Adjustment (`adjustStockLineInner`, 1 row, doc id = opId) |
| `purchaseOrders` (embedded `items[]`, `appliedReceiptIds[]`) | OPERATIONAL | PO create/advance/receive/cancel — its own idempotency marker array, not a separate ledger collection |
| `invoices.payments[]` (embedded array) | FINANCIAL | `collectInvoicePayment` — array-append, idempotent per payment id |
| `invoices.history[]` (embedded) | AUDIT-ish | The invoice edit wizard, client-appended before a `_rev`-guarded save (re-verified safe in Phase 13) |
| `jobCards.statusLog[]` / `history[]` (embedded) | OPERATIONAL | The job card wizard only — single writer (Phase 13 confirmed no second writer exists) |
| `customers.vehicles[].history[]` (embedded) | OPERATIONAL | `touchVehicleHistory` — own dedicated idempotency guard (`lastInvoiceNo` match) |
| `customers.totalSpent` / `outstanding` | DERIVED / ROLLUP | `syncCustomerTotals` — full recompute over current invoices, not an incremental ledger |
| `parts.reserved` | OPERATIONAL / DERIVED counter | `applyReserveDelta` — diff against a pinned per-job-card baseline; **no discrete historical ledger exists** (see §11) |
| `auditLog` | AUDIT (advisory / fire-and-forget, not authoritative) | Two helpers: `pushAudit` (invoices, job-card status, vehicles, capacity-cleanup) and `writeAudit` (parts, suppliers, customers, sell/restock/adjustment, permissions) — non-overlapping domains |
| `pendingSales/{opId}` | OPERATIONAL staging (transient) | Offline Quick Sell only; reconciled through the SAME `runQuickSaleTx`, then deleted — not itself a ledger |
| `counters/{sequence}` | OPERATIONAL | Invoice/estimate number allocation (Phase 2) |
| `reorderRequests` | OPERATIONAL (advisory) | `logReorderRequest` — `addDoc`, no durable opId; guarded only by a local-state "already active" check (see §17) |
| `editLocks`, `recoveryMeta`/`recoveryVault`, `appSettings` | OPERATIONAL / ADMIN | Concurrency leases, backup/restore tooling, settings — not business ledgers, out of this audit's scope |

## 3. Business-event matrix (Phase 14B) — derived from actual code, not assumed

| Business action | Expected ledger effect | Cardinality rule (verified against source) |
|---|---|---|
| Invoice realization | 1 sales row per **revenue-line key** with a nonzero delta + matching stock delta(s) + 1 salesRollups delta | Part lines key by `partId` (repeats of the SAME part **merge** into 1 row); every other line (labour/service/misc) keys by its own line id (**never merges**, even with identical text) — `invoiceRevenueLines` |
| Payment | 1 array element appended to `invoices.payments[]` | Keyed by payment id; a duplicate id is a no-op, never a second element — `collectInvoicePayment` |
| Quick Sell | 1 sales row + 1 stock decrement + 1 rollup delta | All three in ONE transaction, doc id = opId — `runQuickSaleTx` |
| PO Receive | 1 restock row + 1 stock increment **per accepted line** | Keyed by the receipt's own `receiptId` at the PO level (not per-row) — a retried receipt applies zero rows, not a partial set — `poReceiveDoc` |
| Stock Adjustment | 1 adjustment row + 1 stock delta | Doc id = opId — `adjustStockLineInner` |
| Restock (manual) | 1 restock row + 1 stock increment | Doc id = opId (form) or deterministic `qr_{partId}_{targetStock}` (stepper) |
| Return/Reversal | The exact inverse of whatever was originally realized | Not a separate code path — `planInvoiceRealization` is diff-based (prior→next in either direction), so realize and reverse are the same function |
| Job Card reserve/release | `parts.reserved` delta only — no discrete ledger row | Diffed against a pinned per-card baseline (`reserveDelta`), opId-guarded per part |

## 4–13. Per-workflow results (Phase 14C–14L)

Full source-level proof for every row above is in
`tests/ledger-integrity.test.cjs` (48 assertions); this section summarizes
the reasoning per workflow — see the test file for exact source citations.

**Invoice → ledger (14C).** `applyRealizationPlanInTx` writes every stock
delta, sales row, and rollup delta for one invoice inside one function,
called once per commit. Idempotency is enforced **one level up** — on the
invoice document itself, before the realization plan ever computes — not
per ledger row: `createInvoiceTransactional` returns early if the invoice
doc already exists (a retried create writes nothing further);
`editInvoiceTransactional` throws on a stale `_rev` before calling
`planInvoiceRealization` (a retried/duplicate edit never doubles the plan).
This means invoice-driven sales rows correctly have **no** deterministic
doc id of their own (unlike Quick Sell) — they don't need one, because
their idempotency boundary is the invoice, not the row. Verified this is a
deliberate, sound design, not a gap.

**Payment → ledger (14D).** `collectInvoicePayment`'s own duplicate-id
check runs before any write; a genuinely new payment is appended to the
server's freshly-re-read `payments[]` (never a client-held stale copy), so
two concurrent cashiers' payments both survive as two distinct records.
`paid`/`balance`/`status` are recomputed from the reconciled array by the
same `invTotals`/`invStatus` this test imports directly — cross-checked
live: two sequential payments (2000, then 3000 on a 5000 invoice) sum to
5000 paid / 0 balance / "Paid", never overwriting.

**Quick Sell → ledger (14E).** One transaction, three writes (sale row,
stock decrement, rollup delta), doc id = opId — a duplicate delivery finds
the sale row already exists and writes nothing. The offline path
(`pendingSales`) reconciles through this exact same function, never a
weaker path.

**PO Receiving → ledger (14F).** `receiptId` is checked against the PO's
own `appliedReceiptIds` before the per-line loop runs at all — a retried
receipt of a 3-line PO writes zero restock rows, not a partial 3. Each
accepted line's restock row and stock increment are written inside the
same `forEach` iteration — never one without the other. Over-receipt
aborts the whole transaction before any write.

**Stock Adjustment → ledger (14G).** One row, one delta, opId-keyed,
content sourced from the transaction's own fresh read (`stockBefore`/
`stockAfter`), immune to a stale client snapshot.

**Restock → ledger (14H).** Three genuinely distinct entry points (PO
receive, Quick Restock stepper, manual Receive Stock form), each
independently idempotent with its own doc-id scheme — none overlapping.

**Job Card ledgers (14I).** Reservation/release has **no discrete
historical ledger** — `reserved` is a running total on the Part, diffed
against a pinned baseline, opId-guarded per part inside one all-or-nothing
transaction across every part on the card. This is a documented
architectural choice (Phase 4b/PH4-07, Phase 8B/PH8-02): the job card's own
`parts[]` array is the source of truth for what it currently reserves,
re-confirmed here, not a missing-event defect.

**Reversal (14J).** Not a separate code path: `planInvoiceRealization`'s
diff-based design means the "reversal" is the same function run with
`next`/`prior` reversed — there is no second implementation to duplicate or
omit, and no way for the compensating effect to disagree with the original
in sign or magnitude. Re-verified PH11-01's regression guard: the
double-restoration bug this program already fixed (a Refund/Return calling
both `onRestoreStock` and the realization engine's own reversal) has not
resurfaced — no live call site of `onRestoreStock` remains.

**Audit events (14K).** `writeAudit`/`pushAudit` fire **after** their
authoritative transaction commits (post-commit, fire-and-forget) — verified
directly for Quick Sell's production path. One documented, not fixed,
timing nuance: an **offline** Quick Sell writes its audit entry immediately
alongside the `pendingSales` queue write, before the sale is actually
applied by the later reconciliation effect; if reconciliation discards the
pending sale as a definite non-commit, the audit log still shows a
`sell_part` event for a sale that never happened. This is consistent with
this codebase's audit design everywhere else (advisory, never gated or
reversed on a later failure) — recorded as a known limitation, not treated
as a ledger-integrity defect, per this phase's explicit instruction against
manufacturing a guarantee audit logging doesn't provide.

## 14. Source → ledger completeness (14L) / 15. Ledger → source validity (14M)

Every restock/stockAdjustment/sale write carries an explicit `partId` and a
source-identifying field (`poNumber`, `reference`, or `"Quick restock"`) —
no ledger row was found with no traceable origin. The one known
source-exists-but-incomplete-effect case is PH9-02 (already found and
accepted in Phase 9): a PO line whose Part was hard-deleted from the
catalog since the order was placed still gets its restock ledger row
(historical receiving record preserved) but no stock write, since there is
no catalog document left to increment. Not a new gap.

## 16. Duplicate-event audit (14P)

Exact write-site counts (see test §10): `sales` has exactly 2 live
production writers (invoice realization, Quick Sell); `salesRollups`
exactly 2 (same two); `restocks` exactly 3 (PO receive, stepper, manual
form) — each for a genuinely distinct, non-overlapping business action;
`stockAdjustments` exactly 1. No collection has an unexplained THIRD writer
that would indicate a duplicate-ledger-writer defect.

**One dead-code hazard found and removed** (not an active defect — see §21).

## 17. Missing-event audit (14Q)

- The Quick Restock stepper's `delta <= 0` branch writes stock with no
  ledger row — already investigated and documented (this program's own
  earlier finding, re-confirmed here): `commitTyped()`'s own guard routes
  any decrease through Sell instead, so this branch is unreachable in
  practice, not a silently-swallowed real restock. **Classification:
  SAFE/INTENTIONAL.**
- `reorderRequests` has no durable opId — only a local-state "an active
  request already exists for this part" check, which has a narrow
  double-click TOCTOU gap. This collection is OPERATIONAL/advisory (not
  financial, not inventory-authoritative — it doesn't move stock or money,
  only flags a part for supplier follow-up), and the existing UI already
  surfaces "already active" and lets staff clear a stray duplicate.
  **Classification: LOW/INFO, not fixed** — building durable-opId
  infrastructure for a non-authoritative reminder flag is disproportionate,
  per this phase's own code-size discipline and "do not make speculative
  fixes" instruction.

## 18. Ledger content verification (Phase 14N)

Independently confirmed (oracle, not the production function): an invoice
with Part P123 qty 4 and Part P124 qty 3 on separate lines produces two
ledger keys with exactly those quantities — no cross-contamination between
parts is possible under the `part:{partId}` keying rule, since each part's
aggregation bucket is keyed by its own id.

## 19. Cross-ledger verification (Phase 14O)

A fully-collected invoice's `grandTotal`, `invTotals().paid`, and
`invTotals().balance` agree exactly (2000 / 2000 / 0 in the test case).
`syncCustomerTotals` is a full recompute over the customer's own current
invoices, not an incremental ledger append, so by construction it cannot
drift from what those invoices say — recomputing twice yields the same
answer.

## 20. Failure / partial-write analysis (Phase 14S)

Every authoritative money/stock ledger write verified in this phase sits
**inside** the same Firestore transaction as its state change (invoice
realization, Quick Sell, PO receive, Stock Adjustment, manual restock,
Job Card reservation) — none is a "state changes, ledger write happens
separately/best-effort" split. `writeAudit`/`pushAudit` are the one
deliberately non-transactional, post-commit, best-effort category in this
app (documented, not disguised as atomic) — consistent throughout, not a
new finding.

## 21. Confirmed defects

**None at CRITICAL, HIGH, or MEDIUM severity.**

**INFO — dead duplicate-ledger-writer hazard (not an active defect).**
`recordInvoiceSalesDelta` (the pre-Phase-8B invoice ledger writer, now kept
only for demo mode via `runInvoiceRealizationDemo`) retained its own
internal `demoMode`-branching from before that split: an `else
addDoc(collection(db, COLLECTIONS.SALES), record)` and, further down, an
unconditional `Object.entries(monthAgg).forEach(...)` block writing
directly to `salesRollups` — both **unreachable today** because this
function's only caller is itself only ever invoked with `demoMode` true.
Neither branch has ever executed in production. Left in place, either
branch would become a live hazard the moment any future refactor called
this function outside demo mode: a **second, non-transactional,
non-idempotent** write to `sales`/`salesRollups` for the same invoice event
`createInvoiceTransactional`/`editInvoiceTransactional` already commit
atomically — precisely the "1 invoice → 2 sales rows" failure mode this
whole phase exists to catch, just not yet triggered. Removed as
preventative hardening per this phase's own explicit instruction to
inspect for and address "dead callbacks, old legacy paths" before commit,
not reported as a live production defect because it never wrote incorrect
data.

## 22. Root cause

`recordInvoiceSalesDelta` predates Phase 8B's transaction-engine split
(which moved ALL production invoice realization into
`createInvoiceTransactional`/`editInvoiceTransactional`). When that split
happened, its only caller (`runInvoiceRealizationDemo`) was scoped to demo
mode only, but the function's own internal `if (demoMode) {...} else
{...}` branches — written when it still served both modes — were never
pruned.

## 23. Fixes

Removed the two dead production-write branches from
`recordInvoiceSalesDelta` (`components/InventoryDashboard.js`): the `else
addDoc(...)` sales-row write, and the post-return `Object.entries(...)`
`salesRollups` write block. The demo-mode behavior (push to
`pendingDemoSales`/`setSales`) is unchanged — verified by the full
regression suite (§24) and directly in `tests/ledger-integrity.test.cjs`
§10. `monthAgg`'s accumulation loop is left as-is (now computing a value
nothing reads) rather than restructuring the shared per-line loop that also
builds each ledger `record` — touching that loop for a purely cosmetic
gain was judged disproportionate to the risk, and is noted here rather than
silently left unexplained.

## 24. Automated tests

`tests/ledger-integrity.test.cjs` (new, 48 assertions): an independent
cardinality oracle for invoice→ledger keying (re-implemented from the
phase brief's own first principles, not by calling the production
function), cross-checked against the real `invoiceRevenueLines` via source
pattern (this function is a closure inside the default-exported component,
like several functions earlier phases in this program also could not
export without moving their declaration site — verified instead by the
same source-pattern technique `tests/inventory-accounting-integrity.test.cjs`
and `tests/referential-integrity.test.cjs` already established); direct
calls into the real, already-exported `invTotals`/`invStatus` for
payment-ledger cross-checks; source-pattern proofs of every write-site's
idempotency ordering (op-marker check before any write) for invoice
realization, Quick Sell, PO receive, Stock Adjustment, and manual restock;
an exact write-site-count audit per collection; and the dead-code removal's
own regression proof.

- `npm test`: full suite passed (see §26 for the exact count run against
  this commit).
- `npm run test:rules`: passed, unchanged — no rules touched.

## 25. Firebase rules

No `firestore.rules` change — this phase touched only application code
(one dead-code removal) and tests/docs.

## 26. Production validation

No supplier, part, invoice, PO, or job card record was created, edited,
saved, or moved against real data to perform this audit — every finding
above was established by direct source-code tracing (call-graph analysis
confirming `recordInvoiceSalesDelta`'s single, demo-only caller) and the
pure-model/source-pattern tests in §24, consistent with this phase's own
explicit prohibition on manufacturing duplicate ledger records in real
production to test for duplicate-ledger failure.

**Deployment record:**
- **Commit:** `3b35f7e` (`fix(integrity): harden ledger event integrity`),
  pushed to `main`, deployed by Vercel.
- **Build verification:** `window.__NEXT_DATA__.buildId` read
  `WZKw23TFpvholBJ5v8sLj`, distinct from the prior known build id
  (`FUKT0xtznzhM3JqbeaFfZ`), confirming the new commit is live.
- **Console check:** no application JS errors — only the same benign
  browser/network noise observed consistently since Phase 10.
- **Sales ledger render check:** navigated to Sales — existing historical
  sales rows (invoice-linked and Quick-Sell rows alike) render correctly
  with correct amounts/quantities, confirming the production read/display
  path is unaffected by the demo-only dead-code removal (as expected,
  since the removed code never executed in production).
- No supplier, part, invoice, PO, or job card record was created, edited,
  saved, or moved against real data during this check.

## 27. QA cleanup

None required — no QA/test data was created this phase.

## 28. Code-growth review

```
production lines added:      24   (components/InventoryDashboard.js)
production lines removed:    23   (components/InventoryDashboard.js)
net production change:       +1
```

Of the 24 added lines, 19 are new explanatory comments (matching this
codebase's established documentation style); the remaining 5 are two
already-existing statements (the demo `txn(...)` call and the
`pendingDemoSales`/`setSales` push) simply un-indented after their
enclosing `if (demoMode) { ... }` wrapper was removed — no new logic.
Of the 23 removed lines, the real deletions are: 1 line (the dead `else
addDoc(...)` sales-row write) and 14 lines (the dead, unreachable
`Object.entries(monthAgg).forEach(...)` block writing directly to
`salesRollups`) — 15 lines of genuinely dead, hazardous Firestore-write
code eliminated; the remainder are the `if (demoMode) {`/`return;`/closing
`}` structural lines that wrapped them (removed because the code they
guarded is now unconditional, since the function is demo-only in practice)
and 3 superseded comment lines replaced by the new explanation.

- **Significant new logic:** none. This phase found no confirmed
  correctness defect requiring new production logic — the one change made
  is a deletion.
- **Existing mechanisms reused:** none needed — the fix is a pure removal,
  and every other workflow's ledger-integrity guarantee (opId-keyed docs,
  `_rev`-guarded invoice realization, `appliedReceiptIds`/`appliedReserveIds`
  arrays, diff-based reversal) was verified already correct and required no
  extension.
- **Unnecessary code removed:** 15 lines of dead, hazardous production
  Firestore-write code (see §21–23).

Test/documentation growth (phase-mandated, not production):
`tests/ledger-integrity.test.cjs` (new, ~300 lines) and this report (new).
One line added to `tests/setup.cjs`'s `EXTRA_EXPORTS` comment block was
attempted (to export `invoiceRevenueLines` for direct testing) and then
**reverted** on discovering the function is a closure inside the
default-exported component, not module-scope like `invTotals`/`invStatus`
— exporting it would have required moving its declaration site, which this
phase's own "do not add wrappers merely for testing" instruction rules
out; the test instead verifies it by source pattern. Cited here as evidence
the reuse-first / no-unnecessary-abstraction discipline was actually
applied during the work, not just claimed (the same kind of self-caught
correction Phase 11's report recorded for a redundant test export).

## 29. Remaining limitations

- The offline-Quick-Sell audit-log timing nuance (§4–13, "Audit events") is
  a documented, accepted limitation of this codebase's uniformly
  advisory/fire-and-forget audit design — not fixed, per this phase's
  instruction against faking a guarantee audit logging doesn't provide.
- Two independently-evolved audit helper functions (`pushAudit`,
  `writeAudit`) exist with different call signatures but non-overlapping
  domains — a code-organization observation, not a double-audit-entry
  defect. Consolidating two long-established, widely-called helpers was
  judged out of proportion to a cosmetic finding and left alone.
- `reorderRequests` has a narrow double-click TOCTOU gap with no durable
  opId (§17) — accepted as LOW/INFO given its non-authoritative,
  non-financial, non-inventory nature and the existing "already active"
  UI guard.
- Job Card reservation has no discrete historical ledger (§11) —
  documented as an intentional architectural choice already made in
  Phase 4b/8B, not re-litigated here.

## 30. Final PASS/FAIL assessment

**PASS.** No CRITICAL, HIGH, or MEDIUM ledger-integrity defect was found
across every business action examined. Every authoritative money/stock
ledger write already commits atomically with its state change, correctly
keyed for idempotency, with cardinality matching the codebase's own
first-principles keying rules (verified, not assumed). One INFO-level dead
duplicate-write hazard was found and removed as hardening. All gates green.
