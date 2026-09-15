# Phase 17 — State-Machine / Lifecycle Integrity

## 1. Executive summary

The application has **two kinds** of business state machine, derived from
source (not invented):

1. **Derived-status machines** (Invoice) — the lifecycle backbone
   (Draft → Pending → Partially Paid → Paid) is a *pure computation* over
   `payments` + `grandTotal` + `isEstimate` (`deriveStatus` /
   `invStatus`). It cannot be forged: hand-writing `status: "Paid"` on an
   unpaid invoice has no effect — the derived value wins on every read. On
   top of it sit three **explicit terminal overrides** (Cancelled /
   Refunded / Returned) which, once set, are returned verbatim regardless
   of payments, and which drive the diff-based realization/reversal engine
   (Phase 8B / 11).

2. **Explicit-status machines** (Purchase Order, Job Card) — a `status`
   string with an ordered progression. The Job Card workflow ordering is a
   **soft, UI-level, admin-overridable guardrail** with no data-invariant
   attached (reservation math is order-independent). The PO workflow is
   enforced partly in the UI and partly at the mutation layer.

**Result: one confirmed defect (PH17-01, HIGH), fixed.** A **cancelled**
purchase order — a terminal state — could be **received against** through a
concurrent-cancel race (the receive path had no cancelled-status guard at
any layer), silently un-cancelling the PO, adding phantom stock, and
writing a `restocks` ledger row for an order the business had called off.
Fixed in `applyPoReceive` (the single pure decision function every receive
path goes through) + a transactional throw in `poReceiveDoc` + a
client-side guard in `receivePO` for the demo path. No CRITICAL defect. No
Firebase-rules change (business-state integrity lives in the transaction
layer by design; the security-authoritative append-only ledger rules are
already enforced).

## 2. Entity state inventory (Phase 17A)

| Entity | State source | Initial | Terminal states | Reversible? | Enforcement |
|---|---|---|---|---|---|
| **Invoice** | `status` field, but the backbone is **derived** by `deriveStatus`/`invStatus` from `payments`/`grandTotal`/`isEstimate` | `Draft` (or `Estimate` if `isEstimate`) | `Paid` (soft — editable), `Cancelled`, `Refunded`, `Returned` (explicit overrides) | Yes — an edit that raises `grandTotal` above `paid` de-realizes Paid→Partial (intentional, Phase 11); Cancelled/Refunded/Returned can be moved *between* each other, and `Return` is offered from Refunded | Derived status (can't forge) + transaction (`editInvoiceTransactional` `_rev`/`conc/deleted` guards) + `capacityService` terminal check for archive |
| **Payment** | element in `invoice.payments[]` | n/a (append) | n/a | Removable via the edit modal's `delPayment` (de-realizes) | `collectInvoicePayment` transaction — `pay.id` idempotency, `conc/overpaid`, `conc/deleted` |
| **Purchase Order** | `status` string | `draft` or `pending` | `received`, `cancelled` | `partial ↔ received` moves forward only; PHASE 17: **`cancelled` is now truly terminal for receiving** | UI (button visibility per status) + `poReceiveDoc` transaction (`over-receipt`, `po/deleted`, **`po/cancelled`**) + `cancelPO` (`received`→cancel guard) |
| **Job Card** | `status` string, ordered `JOB_CARD_STATUSES` (13 stages) + `Draft` | `Received` (or `Draft`) | `Delivered`, `Closed`, `Cancelled` | Yes — `setStatus` allows a **confirmed regression** (backward move with a reason); reopening a Cancelled card re-reserves its parts | UI only for stage ordering (staff can't skip, admin can); `_rev`-guarded save; reservation delta is a pure function (see §6) |
| **Part** | `archived` boolean (+ `archivedAt`/`archivedBy`) | active (`archived` absent/false) | none — hard `deleteDoc` is separate | `archive ↔ restore` freely (blind `updateDoc`, both idempotent no-ops if already in that state) | `handleArchivePart`/`handleRestorePart` (`updateDoc`); hard delete is admin-only |
| **Supplier** | `archived` boolean + `status` (`Active`/`Inactive`/`Blocked`) | active | none | `archive ↔ restore`; `status` is a free-form classification, no transition rules | edit form + archive/restore handlers |
| **Vehicle** | `status` (`Active`/`Archived`) — nested in `customer.vehicles[]` | `Active` | none | `archive ↔ restore` | `VehiclesModule` handlers via `setCustomers` (Phase 13 `replayIdArray` merge) |
| **Customer** | `archived` boolean / `status` | active | none | `archive ↔ restore` | edit wizard + archive/restore; delete blocked by referential-integrity + capacity eligibility (Phase 9/10) |
| **Stock / inventory** | `stock` / `reserved` numeric counters (not a status) | 0 | none (a running total) | negative stock intentionally allowed for realized sales (Phase 12) | atomic stock-only transactions (Phase 12/14) |
| **Sales / restocks / stockAdjustments** | append-only ledger rows, no status | n/a | immutable | never | Firestore rules `allow update: if false` |

## 3. State transition matrix (Phase 17B)

### Invoice

| From | To | Trigger | Allowed? | Preconditions | Side effects | Enforcement |
|---|---|---|---|---|---|---|
| Draft | Pending/Unpaid | save with items + total | ✅ | customer, ≥1 priced item | invoice doc + serial allocated | `save()` validation + `persistInvoice` counter txn |
| Estimate | Invoice | Convert to Invoice | ✅ | `isEstimate` | fresh INV serial (or reuse if already numbered — Phase 5b) | `convertEstimate` → `persistInvoice` |
| Pending/Partial | Partial | collect a payment < balance | ✅ | balance > 0 | `payments[]` append, derived status | `collectInvoicePayment` |
| Partial | Paid | collect final payment | ✅ | balance → ≤ 0 | realization: stock out, sales rows, rollup, customer totals | `collectInvoicePayment` → `planInvoiceRealization` |
| Paid | Partial | edit line items to raise total above paid | ✅ **intentional** (Phase 11) | edit modal reachable | de-realization: exact inverse diff | `editInvoiceTransactional` |
| Paid | Refunded | Refund action | ✅ | `st === 'Paid'` (UI) | full reversal via diff engine | `changeStatus` → `editInvoiceTransactional` |
| Paid | Returned | Return / Credit Note | ✅ | `st !== 'Returned'/'Cancelled'` (UI) | full reversal | same |
| Paid | Cancelled | — | ⚠️ UI-blocked ("use Refund"); mutation layer would treat it identically to Refund (safe reversal). Label-preference, not an invariant | — | reversal (correct) | UI only; **classified SAFE** — the money/stock outcome is identical to Refund |
| Any non-terminal | Cancelled | Cancel action | ✅ | `st !== 'Cancelled'/'Paid'` (UI) | if realized: reversal; else none | `changeStatus` |
| Cancelled/Refunded/Returned | (active status) | — | ❌ FORBIDDEN | — | — | `deriveStatus`/`invStatus` return the override verbatim; no UI action sets an active status via `changeStatus`; editing keeps the override |
| Deleted | edit / pay / any | stale editor | ❌ FORBIDDEN | — | — | `editInvoiceTransactional` / `collectInvoicePayment` throw `conc/deleted` (Phase 1a) — **no resurrection** |
| Draft "Paid" (forged) | — | hand-write status | ❌ ineffective | — | — | derived status ignores the field |

### Purchase Order

| From | To | Trigger | Allowed? | Side effects | Enforcement |
|---|---|---|---|---|---|
| draft | pending → approved → sent | advance | ✅ | status only | `poAdvanceDoc` (blind `updateDoc`) + UI |
| sent/partial/approved | partial | receive < ordered | ✅ | stock +, `restocks` row, `receivedQty` +, `appliedReceiptIds` | `poReceiveDoc` txn |
| sent/partial | received | receive to full | ✅ | same, status → received | same |
| received | receive again | retry / double-submit | idempotent no-op (receiptId) or over-receipt rejection | none | `appliedReceiptIds` + over-receipt (Phase 4b/3b) |
| received | cancel | — | ❌ FORBIDDEN | — | `cancelPO` guard (`po.status === 'received' || receivedAny`) — **client-snapshot based, narrow race remains (§26)** |
| **cancelled** | **received/partial** | receive (concurrent cancel) | ❌ FORBIDDEN — **PH17-01, was slipping through, now fixed** | would be: stock +, restock row, PO un-cancelled | **PHASE 17**: `applyPoReceive` returns `blocked:'cancelled'`; `poReceiveDoc` throws `po/cancelled` (on re-read status); `receivePO` client guard |
| cancelled | sent/approved | advance (concurrent cancel) | ❌ forbidden — `poAdvanceDoc` blind write, narrow race, **status-label only, no side effect (§26)** | status only | UI only |
| deleted | receive | stale | ❌ FORBIDDEN | — | `poReceiveDoc` throws `po/deleted` (Phase 9) |

### Job Card

| From | To | Trigger | Allowed? | Side effects | Enforcement |
|---|---|---|---|---|---|
| stage N | stage N+1 | staff advances | ✅ | statusLog entry; reservation unchanged | `setStatus` (UI) |
| stage N | stage N+2… | staff skip | ❌ (staff) / ✅ (admin, by design) | — | `setStatus` UI check `!isAdmin && nxt !== cur+1` — **UI-only, classified SAFE/INTENTIONAL** (soft workflow, no data invariant) |
| any | Cancelled / Repair Paused | any time | ✅ | Cancelled releases reservation | `setStatus` (jump always allowed) |
| any | earlier stage | confirmed regression | ✅ **explicit** | reservation recomputed via diff | `setStatus` → `setStatusConfirm` dialog |
| → Closed/Delivered/Cancelled | (terminal) | | ✅ | reservation → 0 (release, once, idempotent) | `cardReservedQtys` returns `{}` for these |
| Closed → Closed | re-save | double-submit | idempotent | `reserveDelta` = ∅ — no repeated release | pure function + pinned baseline (Phase 4b/5b/8B) |
| Cancelled → Repair Started | reopen | confirmed regression | ✅ **distinct intentional transition** | reservation RE-applied | `reserveDelta(cancelled, active)` = positive |

## 4. Invoice state machine (Phase 17C / 17D)

**SAFE / INTENTIONAL** across the board. Verified with an independent
status oracle (hand-derived, not a copy of the production functions):

- `Paid → Draft` (forged): a fully-paid invoice with `status:"Draft"`
  still derives as `Paid` — the payment data wins.
- `Paid → Paid` (forged from unpaid): an unpaid invoice with
  `status:"Paid"` still derives as unpaid.
- Terminal overrides (`Cancelled`/`Refunded`/`Returned`) are returned
  **verbatim** by both engines regardless of payments — a fully-paid
  Returned invoice reports "Returned", never "Paid".
- `changeStatus` (the Cancel/Refund/Return UI action) only ever sets a
  terminal-override status — never `Paid`/`Draft`/`Partially Paid`.
- Editing a Cancelled/Refunded/Returned invoice keeps that status
  (`deriveStatus`/`invStatus` short-circuit on it before any recompute) —
  **no "revive by editing"**.
- `Deleted → edit / pay`: `editInvoiceTransactional` (via
  `revState`/`conflictError`) and `collectInvoicePayment` both throw
  `conc/deleted` when `!snap.exists()` — a stale editor **cannot
  resurrect a deleted invoice** (Phase 1a, re-verified).
- Payment invariant `paid ≤ grandTotal + slack`: enforced by
  `save()`'s guard, PaymentModal's guard, **and** `collectInvoicePayment`'s
  `conc/overpaid` re-check against its own fresh read (Phase 11 / PH11-02).

## 5. PO state machine (Phase 17E) — PH17-01

**One defect found and fixed.** Detail in §18–20.

Everything else SAFE:
- `applyPoReceive` computes the next status purely from received quantities
  vs. ordered — verified against an independent transition matrix for
  draft/approved/sent/partial.
- Over-receipt (past ordered qty) rejected as a whole, nothing applied
  (Phase 3b) — re-verified.
- Receiving a fully-`received` PO: every line is already at its ordered
  qty, so any positive delta hits the over-receipt rejection — no separate
  guard needed.
- Repeat receive: `appliedReceiptIds` idempotency (Phase 4b) — a retried
  "Confirm Receipt" writes zero extra rows.
- `received → cancel`: blocked by `cancelPO`'s guard
  (`po.status === 'received' || receivedAny`).

## 6. Job Card state machine (Phase 17F)

**SAFE / INTENTIONAL.**

- The stage-ordering rule ("staff can't skip a stage") lives **only in the
  UI** (`setStatus`'s `!isAdmin && nxt !== cur+1` check). This is
  **correct**: it is a soft operational guardrail, not a data invariant.
  Admins skip freely by design. No side effect depends on stage order:
- Reservation is a **pure function** of `status ∈ {Cancelled,Closed,
  Delivered}` (→ 0) and `parts[]`, diffed against a pinned baseline. So:
  - A stage skip (Received → Closed) releases the full reservation
    **exactly once** — the delta is a function of the two states, not the
    path.
  - Re-completing (Closed → Closed) is a **zero delta** — no repeated
    release (Phase 4b/8B idempotency contract, re-verified).
  - Reopening a Cancelled card **re-reserves** its parts — a distinct,
    intentional, UI-confirmed regression, not an accidental overwrite.
- Billing eligibility (`BILLABLE_JOB_CARD_STATUSES.includes(status)`) is a
  **set-membership** check, order-independent — a skipped-to status is
  billable iff it is in the billable set, correct regardless of path.

## 7. Part / inventory lifecycle (Phase 17G)

**SAFE.** Catalog lifecycle (`archived`) is fully separate from physical
inventory state (`stock`/`reserved`), and Phase 12 confirmed
`Part.archived` is never conflated with `stock === 0`.

- `active → archive → restore`: blind `updateDoc({archived})`, idempotent
  (a no-op if already in that state).
- `Deleted → restore`: **impossible** — hard delete is `deleteDoc`; the
  record is gone and the Archive page only lists `inventory.filter(p =>
  p.archived)`, which a deleted part is not in. There is no
  restore-from-deletion path.
- Historical transactions referencing an archived (or hard-deleted) part
  remain valid — Phase 9 (PH9-01/02) established the sales/restock/
  realization engines skip a stock delta for a part whose doc is gone but
  keep the ledger row.

## 8. Customer / Supplier / Vehicle lifecycle (Phase 17H)

**SAFE.** All three use an `archived` flag (Vehicle uses `status`
`Active`/`Archived`) with free `archive ↔ restore`. Supplier `status`
(`Active`/`Inactive`/`Blocked`) is a free-form classification with no
transition rules — nothing to violate. Deleting a customer/supplier with
dependents is blocked by the Phase 9/10 referential-integrity checks and
the `capacityService` eligibility check (re-verified unregressed — §16).

## 9. Terminal states (Phase 17I)

| Terminal state | Edit? | Money can change? | Inventory can change? | Referenceable? | Return to earlier state? | Deletable? |
|---|---|---|---|---|---|---|
| Invoice **Paid** | Yes (intentional — de-realizes if underpaid, Phase 11) | Yes (add/remove payments, edit lines) | Yes (via realization diff) | Yes | Yes → Partial via edit; → Refunded/Returned via action | Admin only; reverses realization on delete |
| Invoice **Cancelled/Refunded/Returned** | Edits persist but status sticks; no realization change (both non-realizing → diff 0) | No | No | Yes | Only between the three overrides | Admin only |
| PO **received** | items frozen (no action buttons); over-receipt blocks further receipt | No | No (already done) | Yes | No | Admin only; **no reversal on delete** (documented — §26) |
| PO **cancelled** | No action buttons; **PHASE 17: cannot be received against** | No | No | Yes | ⚠️ `poAdvanceDoc` blind write could un-cancel (label only — §26) | Admin only |
| Job Card **Closed/Delivered/Cancelled** | Yes (the wizard opens); reservation stays 0 | n/a | Reservation stays released (re-close = ∅ delta) | Yes (billing checks the billable set) | Yes → confirmed regression / reopen | Admin only; capacityService blocks if linked to an open invoice |

"Terminal" here means **"no further automatic progression"**, not
"immutable" — the app intentionally permits corrections to settled records
(a paid invoice getting a forgotten part added, a closed job card getting a
note). The realization engine keeps every side effect consistent through
those corrections.

## 10. Forbidden transitions

| # | Transition | Classification | Enforced where |
|---|---|---|---|
| 1 | Invoice: forge `Paid`/`Draft` by hand-writing `status` | ineffective (SAFE) | derived status |
| 2 | Invoice: Cancelled/Refunded/Returned → active status | FORBIDDEN, enforced | status functions + no UI path |
| 3 | Invoice: Deleted → edit/pay/resurrect | FORBIDDEN, enforced | transaction `conc/deleted` |
| 4 | PO: **cancelled → received** | **BROKEN → FIXED (PH17-01)** | now `applyPoReceive`/`poReceiveDoc`/`receivePO` |
| 5 | PO: received → cancel | FORBIDDEN, mostly enforced (narrow snapshot race — §26) | `cancelPO` guard |
| 6 | PO: cancelled → advance | forbidden, UI-only (label-only impact — §26) | UI |
| 7 | PO: deleted → receive | FORBIDDEN, enforced | `po/deleted` (Phase 9) |
| 8 | PO: over-receipt | FORBIDDEN, enforced | `po/over-receipt` (Phase 3b) |
| 9 | Job Card: staff stage-skip | FORBIDDEN for staff (UI), allowed for admin — SAFE/INTENTIONAL (soft workflow) | UI |
| 10 | Part: Deleted → restore | impossible (SAFE) | record doesn't exist |

## 11. UI vs mutation-boundary enforcement (Phase 17J)

| Transition | UI guard | Mutation-layer guard | Verdict |
|---|---|---|---|
| Invoice terminal-override sticks | menu items conditional | `deriveStatus`/`invStatus` verbatim return | ✅ both |
| Invoice deleted-doc edit/pay | Edit hidden | `conc/deleted` throw in transaction | ✅ mutation layer is authoritative |
| Invoice overpayment | `save()` + PaymentModal guards | `conc/overpaid` in `collectInvoicePayment` txn | ✅ both (Phase 11) |
| PO over-receipt | Receive form caps input | `po/over-receipt` in `poReceiveDoc` txn | ✅ both |
| **PO cancelled → receive** | Receive button hidden for cancelled | **was NONE → now `po/cancelled` in `poReceiveDoc` txn + `applyPoReceive` + client guard** | ✅ fixed (was UI-only) |
| PO received → cancel | Cancel button hidden if `hasReceived` | `cancelPO` re-checks `po.status`/`receivedAny` (client snapshot) | ⚠️ handler guard, not transactional — narrow race (§26) |
| PO cancelled → advance | advance buttons hidden for cancelled | none (`poAdvanceDoc` blind `updateDoc`) | ⚠️ UI-only; label-only impact (§26) |
| Job Card stage-skip (staff) | `setStatus` UI check | none (`persistJobCard` persists any status) | ✅ SAFE — soft workflow, no invariant, admin-overridable by design |

## 12. Side-effect matrix (Phase 17K)

| Transition | Expected side effects | Verified |
|---|---|---|
| Invoice Unpaid → Paid | payment row, paid/balance/status update, stock out, sales rows, salesRollups, customer totals, vehicle history, audit | ✅ Phase 8B/11/14/15 |
| Invoice Paid → Refunded/Returned/Cancelled | exact inverse diff (stock back, sales compensating rows, rollup back), audit | ✅ Phase 11 (PH11-01: single reversal, `onRestoreStock` removed) — re-verified absent |
| PO sent → received | `receivedQty` +, stock +, `restocks` row, `appliedReceiptIds`, audit | ✅ Phase 3b/14 |
| **PO cancelled → received** | **NONE — the transition is now rejected before any write** | ✅ PH17-01 |
| Job Card active → Closed | reservation released (once), statusLog, audit | ✅ diff-based, §6 |
| Job Card Closed → Closed | none (zero delta) | ✅ §6 |

**No invalid transition was found to produce a valid side effect** — with
the one exception (PH17-01) now fixed.

## 13. Duplicate transition results (Phase 17L)

Re-verified against the existing Phase 4/5 idempotency machinery (not
re-run in full):

- pay twice / receive twice / complete twice / archive twice / restore
  twice / realize twice / reverse twice — all covered by opId-keyed
  markers (`pay.id`, `appliedReceiptIds`, `sales/{opId}`,
  `stockAdjustments/{adjId}`, `restocks/{restockOpId}`, `appliedReserveIds`)
  or the diff-based engines (`planInvoiceRealization`, `reserveDelta`)
  which produce a zero delta on a repeated identical state.
- The new PH17-01 guard is itself idempotent: a retried receive against a
  cancelled PO throws `po/cancelled` every time, writing nothing.

## 14. Backward transition results (Phase 17M)

| Backward transition | Classification |
|---|---|
| Invoice Paid → Partial (edit raises total) | **INTENTIONALLY ALLOWED** — Phase 11, engine reverses cleanly |
| Invoice Paid → Refunded/Returned | **REQUIRES EXPLICIT ACTION** (menu, admin) |
| Invoice Cancelled → active | **FORBIDDEN** — status functions block it |
| PO received → ordered | **FORBIDDEN** — no code path decreases `receivedQty`; over-receipt only guards the upper bound, but there is no "un-receive" action |
| PO cancelled → sent/approved | forbidden, UI-only (`poAdvanceDoc` blind write) — **narrow race, label-only (§26)** |
| Job Card Completed → Open / earlier | **REQUIRES EXPLICIT ACTION** — `setStatusConfirm` dialog with a reason; reservation recomputed correctly |
| Job Card Cancelled → reopen | **DISTINCT INTENTIONAL TRANSITION** — re-reserves parts, not an accidental overwrite |
| Part/Customer/Supplier/Vehicle Archived → Active | **INTENTIONALLY ALLOWED** (restore) |

## 15. Delete / state interaction (Phase 17N)

| Record + state | Delete behaviour |
|---|---|
| Draft/Unpaid invoice → delete | allowed (admin); no realization to reverse |
| Paid/Realized invoice → delete | allowed (admin); `deleteInvoiceTransactional` reverses realization (stock, compensating sales row, rollup) atomically — Phase 8B (PH8-01c) |
| PO draft/pending/sent → delete | allowed (admin); no stock effect |
| **PO received → delete** | allowed (admin) — **stock-in is NOT reversed** (documented, not a defect — the goods physically arrived; deleting the PO record doesn't un-arrive them, and the `restocks` ledger row remains as the permanent record). §26. |
| Job Card any → delete | allowed (admin); `deleteJobCard` releases the reservation (diff to null) — Phase 4b/8B |
| Job Card terminal + linked to open invoice → capacity-archive | **blocked** by `capacityService` (§16) |

No **partial** side effects were found — every delete path that has a
reversal runs it inside the same transaction as the `tx.delete()`
(Phase 8B).

## 16. Concurrency cross-check (Phase 17O)

Small focused checks (not a re-run of Phases 1–3):

- **Client A: Invoice → Paid, Client B: Invoice → Delete** — `_rev` +
  `conc/deleted`: whichever transaction commits second sees the other's
  effect. A payment onto a just-deleted invoice throws `conc/deleted`; a
  delete of a just-paid invoice reverses the (now-committed) realization.
  One deterministic winner, no impossible final state (Phase 1a/8B).
- **Client A: PO → Receive, Client B: PO → Cancel** — **this is
  PH17-01.** Before: A's receive slipped through and un-cancelled the PO.
  After: `poReceiveDoc` re-reads `server.status` inside its transaction,
  `applyPoReceive` returns `blocked:'cancelled'`, the transaction throws
  `po/cancelled` — B's cancel is the deterministic winner, A gets a clear
  "reload" message, no stock moves.
- **Client A: Job Card → Complete, Client B: Job Card → Edit** — `_rev`
  guarded save: the second writer is rejected `conc/stale`, reopens the
  card with the "updated elsewhere" banner (Phase 1c). Reservation is
  recomputed from whichever card state actually commits.

## 17. Refresh / timeout cross-check (Phase 17P)

Uses the existing Phase 5/6 machinery:

- A receive against a cancelled PO that times out: `po/cancelled` is a
  definite non-commit → the durable opId is retired (`clearOpId`), so a
  refresh + retry is a fresh intent that re-hits the same block. No
  double-apply.
- Every other transition's refresh/timeout behaviour is unchanged from
  Phases 5b/6b — durable opId in `sessionStorage`, ambiguous outcomes keep
  the id, definite non-commits clear it.
- No transition was found where an uncertain outcome could report success
  while the authoritative transaction failed.

## 18. Confirmed defects

### PH17-01 — a cancelled Purchase Order could be received against (HIGH)

A **cancelled** PO is a terminal state — the business decided not to buy
the order. The receive path (`receivePO` → `poReceiveDoc` →
`applyPoReceive`) had **no cancelled-status check at any layer**. The UI
hides the Receive button for a cancelled PO, so this is only reachable
through a **concurrent-cancel race**: Client A opens the Receive form on a
`sent`/`partial` PO, Client B cancels it, Client A submits the form. The
transaction re-reads the PO (now `cancelled`), `applyPoReceive` computes
`status = anyReceived ? 'partial' : 'received'` regardless, and the
transaction:

- **un-cancels the PO** (status → `partial`/`received`),
- **increments part stock** (`tx.update(parts/{id}, {stock: increment(...)})`),
- **writes a `restocks` ledger row** attributing goods received to the
  supplier for an order that was called off.

The authoritative inventory count and the ledger row would say the
business received goods it had cancelled ordering. Classified **HIGH**
("an inventory business action can create materially incorrect
authoritative ledger history"; not CRITICAL because it requires a
concurrency race, not a normal single-user path).

## 19. Root causes

`applyPoReceive` (Phase 3b) was written to answer *"how much of this
delta can be applied, and what status does that make the PO?"* — it
handled the *upper* bound (over-receipt) but never considered that the PO
might be in a state where **no** receipt is valid. `cancelled` was added
to the PO model later; the receive path was never taught that it is
terminal. The other cancelled-transition gaps (`poAdvanceDoc` blind write,
`cancelPO`'s client-snapshot guard) share the same origin: the PO
forward-workflow writes are simple `updateDoc`s with UI-only guards,
predating the concurrency-hardening phases that made the *receive* path
transactional.

## 20. Fixes

`applyPoReceive` (`lib/poReceive.js`) — the single pure decision function
every receive path goes through — now returns
`{ ..., blocked: 'cancelled' }` and applies nothing when
`currentStatus === 'cancelled'`. `poReceiveDoc`
(`services/purchaseOrderService.js`) checks for it and throws
`po/cancelled` — **inside its transaction, on the freshly re-read
`server.status`**, so the race is closed at the mutation boundary.
`receivePO` (`components/InventoryDashboard.js`) adds a client-side
`po.status === 'cancelled'` guard (covers the demo path, which has no
transaction, and a client still holding a pre-cancel snapshot) and treats
`po/cancelled` as a definite non-commit (retires the durable opId).

Reused the existing `over` / error-code pattern (`po/over-receipt`,
`po/deleted`). **No new function, no new file, no new abstraction.**

**Not fixed (documented — §26):**
- `poAdvanceDoc` blind `updateDoc` — a concurrent cancel could be reverted
  by an advance click. Status-label only, no stock/money side effect,
  narrow race. Making `poAdvanceDoc` transactional (re-read + validate
  predecessor) was judged disproportionate to a label-only LOW issue.
- `cancelPO`'s guard reads the client's `po` snapshot, not a fresh server
  read. A concurrent receive-then-cancel could label a PO `cancelled`
  while it has `receivedQty > 0`. The physical stock and the `restocks`
  ledger row are still correct and immutable — only the PO's own status
  label is misleading. Narrow race, no data corruption.

## 21. Automated tests

`tests/state-machine-integrity.test.cjs` (new, 34 assertions):

- **Independent status oracle** for Invoice (hand-derived, not a copy of
  `deriveStatus`/`invStatus`) — verifies forged `Paid`/`Draft` are
  ignored, terminal overrides stick verbatim.
- **Independent PO transition matrix** — `applyPoReceive` checked for
  draft/approved/sent/partial/**cancelled**, over-receipt, and
  fully-received.
- The real `cardReservedQtys`/`reserveDelta` — stage-skip releases once,
  re-close is ∅, reopen re-reserves.
- Source proofs: `poReceiveDoc` throws `po/cancelled` on the re-read
  status; `receivePO` client guard + catch; `cancelPO` received-guard;
  `deriveStatus`/`invStatus` terminal short-circuit; `editInvoiceTransactional`/
  `collectInvoicePayment` `conc/deleted`; `capacityService` terminal-state
  eligibility (Phase 9/10 unregressed); PH11-01 `onRestoreStock` still
  absent.

Expected results come from hand-built matrices, never from calling the
production state helper and comparing it to itself.

`tests/concurrency-cross-workflow.test.cjs` — one existing assertion's
regex updated to accept the new `po/cancelled` code in `receivePO`'s catch
(the assertion's intent — "the caller surfaces the definite-non-commit
message and keeps the form open" — is unchanged).

## 22. Firebase rules (Phase 17S)

**No change.** `invoices` / `jobCards` / `purchaseOrders` rules are
`allow create, update: if signedIn()` — no business-state validation, by
design. Per 17S's own guidance ("do not move business state-machine rules
into Firestore rules automatically; only add rules if an actual
security/integrity bypass is demonstrated"):

- The "bypass" scenarios found are **stale-UI / concurrency races by
  legitimate authenticated staff**, not an adversarial rules bypass. The
  correct enforcement layer is the transaction (where PH17-01 was fixed),
  matching the app's architecture (the Phase 8B transaction engine is the
  integrity boundary, not rules).
- The **security-authoritative** records — the append-only ledgers
  (`sales`/`restocks`/`stockAdjustments`/`auditLog`) — already have
  `allow update: if false` and admin-only delete. Those are the records a
  rules bypass could actually corrupt, and they are already locked.
- Adding per-entity state machines to rules language would be a large new
  framework, explicitly discouraged.

`npm run test:rules`: **138/138**, unchanged.

## 23. Production validation

No production business record was transitioned to test this — the
concurrent-cancel race is covered by the `applyPoReceive` transition-matrix
tests and the transactional source proof. The live project holds only QA
data (Phase 15 baseline §12), and its 5 QA POs are all "Partially
Received" — none was touched.

**Deployment record:**
- **Commit:** `75c93b2` (`fix(integrity): harden business state
  transitions`), pushed to `main`, deployed by Vercel.
- **Build verification:** `window.__NEXT_DATA__.buildId` read
  `Nsul_A3BJz8Kivvb_lExI`, distinct from the Phase 16 baseline
  (`sbDi7i0D4OimJ08TNmAG3`), confirming the new commit is live.
- **Console check:** zero console messages across Dashboard and Purchase
  Orders (every filter tab, including the empty "Cancelled" state).
- **Render check:** the Purchase Orders module (the one this phase
  touched) renders correctly with the live dataset — 5 "Partially
  Received" QA POs, "Receive stock" shown only for their non-terminal
  status, "Cancelled 0" empty state clean. The cancelled-receive block is
  covered by the transaction-matrix tests since reproducing the race live
  would require a second authenticated client.
- No production record was created, edited, or transitioned.

## 24. QA cleanup

None — no QA data created this phase.

## 25. Code-growth review

```
Production lines added:    31   (3 files)
Production lines removed:   5
Net production change:     +26

  lib/poReceive.js                 +16 / −1  (13 of +16 = the explanatory block)
  services/purchaseOrderService.js  +6 / −1
  components/InventoryDashboard.js   +9 / −3
```

- **New production functions:** none.
- **New production files:** none.
- **New abstractions:** none.
- **Existing mechanisms reused:** the `applyPoReceive` return-shape (`over`
  → added `blocked`), the `po/*` error-code + catch pattern
  (`po/over-receipt`, `po/deleted` → added `po/cancelled`), the
  `clearOpId` definite-non-commit convention (Phase 5b).
- **Unnecessary code removed:** none found — the receive path had no
  duplicate/dead state logic; the guard was simply missing.
- **Significant new logic:** one status comparison
  (`currentStatus === 'cancelled'`) at three layers (pure function,
  transaction, client). Existing code could not safely handle it because
  no layer looked at the PO's terminal status before applying a receipt —
  the only guard was the UI hiding the button.

## 26. Remaining limitations

- **`poAdvanceDoc` is a blind `updateDoc`** — a concurrent cancel could be
  reverted by an advance-workflow click (draft→pending→approved→sent).
  Status-label only, no stock/money side effect. Narrow race. Not fixed
  (making it transactional is disproportionate to a LOW label-only issue).
- **`cancelPO`'s guard reads the client snapshot**, not a fresh server
  read — a concurrent receive-then-cancel could label a PO `cancelled`
  while it has received stock. The physical stock and the `restocks`
  ledger row remain correct and immutable; only the PO status label is
  misleading. Narrow race, no data corruption.
- **PO `received → delete` does not reverse the stock-in** (admin-only
  delete). This is intentional: the goods physically arrived, deleting the
  PO record doesn't un-arrive them, and the `restocks` ledger row is the
  permanent record. Documented, not a defect.
- Job Card stage-ordering is UI-only (staff), admin-overridable by design
  — a soft operational guardrail with no data invariant. Not a defect.
- Business-state transitions are enforced in the transaction layer, not
  Firestore rules — deliberate (§22).

## 27. Final PASS/FAIL assessment

**PASS.** The application's real state machines are sound. Invoice status
is a pure derivation that cannot be forged, with explicit terminal
overrides that stick and drive a single diff-based realization/reversal
engine (Phase 8B/11). Deleted invoices cannot be resurrected (Phase 1a).
Job Card workflow ordering is a deliberate soft UI guardrail with
order-independent, idempotent reservation math underneath. Terminal states
gate archival (`capacityService`, Phase 9/10 unregressed). One HIGH
defect — a cancelled Purchase Order could be received against through a
concurrent-cancel race, adding phantom stock and a ledger row — was found
and fixed at the mutation boundary (the transaction that already re-reads
the PO), reusing the existing rejection pattern with no new abstraction.
Two narrow, label-only PO races are documented. All gates green.
