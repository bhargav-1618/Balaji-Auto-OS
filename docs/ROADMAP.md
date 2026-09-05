# Roadmap — Balaji Auto OS

Forward-looking work beyond 1.0.0. None of this blocks single-location use of the
current release.

- For what 1.0.0 deliberately does **not** cover (browser-only verification ceiling,
  single-location concurrency assumptions), see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).
- For the per-environment deployment steps (publish `firestore.rules`, strong owner
  password), see [deployment/DEPLOYMENT.md](deployment/DEPLOYMENT.md) § 1.

---

## Concurrency — before multi-terminal use

- ~~**Server-side invoice counter.**~~ **DONE — CONCURRENCY PHASE 2, shipped and
  production-verified.** `INV-` allocation runs inside a Firestore `runTransaction` on
  `counters/invoices` (`EST-` on `counters/estimates`) — `lib/docCounter.js` →
  `store.allocateNumber` → `persistInvoice` — at save time. The editor no longer
  previews a number ("number assigned on save"). Verified with 1, 2 and 3 concurrent
  clients against live Firestore: distinct, sequential serials, zero duplicates. New-
  invoice creation now requires connectivity (as editing an invoice and collecting a
  payment already did) — no offline local-sequence fallback, because a duplicate serial
  is worse than needing a connection. Drafts (`DRF-`) stay client-side by design.
  Rules (`firestore.rules`, published to `balaji-auto-os-7`): `counters/{sequence}` is
  read/advance for any signed-in user, never-decreasing (`next >= resource.data.next`),
  no client delete. A one-off reset (e.g. after test invoices) is a Console delete of
  the `counters/invoices` doc — it re-seeds from `max(existing) + 1` on the next save.
- ~~**Cross-workflow data integrity.**~~ **DONE — CONCURRENCY PHASE 3b, shipped and
  verified with two independent emulator clients + on production.** The Phase 3 audit
  found three cross-workflow races; all are closed:
  - concurrent payment collection double-ran invoice realization → the cascade now
    diffs the payment transaction's own server pre-image, not stale React state
    (`collectInvoicePayment` / `deleteInvoice`), so realization runs exactly once;
  - concurrent PO receive did last-writer-wins on `receivedQty` and never capped
    over-receipt → `poReceiveDoc` is now a `runTransaction` that adds deltas to the
    server value (4 + 3 → 7) and rejects over-receipt server-side
    (`lib/poReceive.js` `applyPoReceive`);
  - concurrent secondary customer writes (note / vehicle / totals) overwrote the whole
    document → `store.syncAll` now writes only the changed fields, replaying id-keyed
    arrays onto server truth inside a transaction (`repo.applySecondaryMerge`,
    `lib/concurrency.js` `replayIdArray`).
  Raw stock quantities were already atomic (`increment()` everywhere; quick-sell
  re-reads in a transaction). Residual low-severity item: a customer's `history[]` /
  same `documents[]` entry is still last-writer-wins on that one field under a race.
- ~~**Duplicate-action / idempotency.**~~ **DONE — CONCURRENCY PHASE 4b, shipped and
  verified (emulator + production).** The Phase 4 audit found eight workflows where one
  user intent could become two business effects (double-click past the in-flight ref,
  retry after an ambiguous response, lost server ack, Firestore transaction-callback
  replay). All eight are closed by giving each retryable write a **stable operation
  id** that its transaction reads before any write:
  - collect payment → `payments[].id` (PaymentModal ref); duplicate = no-op, no `_rev`
    bump, no realization re-run;
  - PO receive → `purchaseOrders.appliedReceiptIds` (bounded list, `lib/opId.js`
    `APPLIED_RECEIPTS_CAP`);
  - quick-sell / stock-out → `sales/{opId}`; the whole sale (stock −, `salesCount` +,
    ledger row, monthly `salesRollups`) is now **one** transaction, not a txn plus
    fire-and-forget `addDoc`s;
  - manual stock adjustment → `stockAdjustments/{opId}` (one transaction, was
    `Promise.allSettled`);
  - ad-hoc restock → `restocks/{opId}` (same);
  - create PO / create supplier → client-generated stable doc id via
    `setDoc(..., {merge:true})` (was `addDoc` auto-id);
  - new job-card reservation → the reserve delta is applied only **after** the card
    write is confirmed, from a pinned per-`jobNo` baseline, so a retry neither
    double-reserves nor drops the reservation.
  Error messages on these paths changed from "Nothing was changed" to uncertainty-aware
  wording ("…it may already be recorded — press … again, a repeat is safe").
- ~~**Refresh / reload during a workflow.**~~ **DONE — CONCURRENCY PHASE 5b, shipped
  and verified (emulator + production).** The Phase 5 audit found that the Phase 4b
  operation ids were `useRef`s the browser destroyed on refresh, so *commit → lost
  ack → reload → retry* still duplicated payment / quick-sell / PO-receive / stock
  moves, and a walk-in invoice could be created twice. Fixed:
  - operation identity moved to **`sessionStorage`** (`lib/durableOpId` +
    `hooks/useDurableOpId`), keyed by workflow + record, so it survives a tab
    refresh and a retry recovers the same id → the existing backend markers make it
    a no-op. Cleared on a confirmed result; kept on an ambiguous one, with a
    "check the record before retrying" banner on the modal;
  - the **invoice new-form draft** uses one static key that survives a refresh and
    carries the invoice's client id (Restore/Discard banner); `persistInvoice`
    reuses an already-allocated number on a retry (no second number); a
    near-identical recent **walk-in** invoice prompts for confirmation (PH5-07);
  - the **job-card reservation** gained a durable `jc-reserve:<jobNo>` op id plus a
    per-part `appliedReserveIds` transaction marker, so `reserved` increments
    exactly once across a reload + retry;
  - `commitStock` (inline stepper) writes its ledger row to a deterministic id.
  Residual: `sessionStorage` does not survive the tab being *closed* (vs refreshed);
  an advisory `auditLog` line can still duplicate. Documented in KNOWN_LIMITATIONS.md.
  Shipped in commit `fix(reliability): make business operations refresh-safe`
  (`85e4cd3`); production build `YV9LAPH1sS-he7PKrrv0h`. Gates: `npm test` 127/127,
  `npm run test:rules` 94/94, lint 0, build ✓. No `firestore.rules` change.
- ~~**Network interruption (not just refresh).**~~ **DONE — CONCURRENCY PHASE 6
  (discovery) + PHASE 6b (hardening), shipped.** Discovery found the Phase 4b/5b
  durable-opId architecture was already connectivity-cause-agnostic (a network
  drop and a refresh recover through the exact same path) and found no
  CRITICAL/HIGH defect — only 3 UX gaps, all closed:
  - every `runTransaction` call site (13 total) is now bounded by
    `lib/txTimeout.js`'s `withTimeout(...)` — 12s for business mutations, 6s
    for the edit-lease coordination step — WITHOUT cancelling the underlying
    transaction (Firestore has no cancel API, and a client-side "give up"
    can't undo a commit that already reached the server); a timeout is
    classified ambiguous by the pre-existing `isDefiniteNoCommit` check, so
    the durable operation id is kept, never cleared, and every affected catch
    block now shows the accurate "connection is taking longer than
    expected... check before retrying" copy instead of a false failure claim;
  - a non-blocking `warnIfOffline(thing)` heads-up (reusing the existing
    amber `notify.warning`) fires before a transaction-backed mutation is
    attempted while `navigator.onLine` is false — deliberately a warning, not
    a block, since `navigator.onLine` is a browser hint, not proof Firestore
    is reachable;
  - the `parts`/inventory `onSnapshot` listener now gates its state update on
    `!hasPendingWrites`, matching `jobCards`/`customers`/`invoices` (it was
    the only one that didn't) — closing the window where a second tab/device
    could see a stock decrement before the invoice that caused it was
    visible anywhere;
  - found in the same audit and fixed alongside: the customer/invoice/job-card
    guarded-edit save paths showed **no toast at all** on a non-concurrency
    failure (a stale code comment claimed one fired elsewhere; it never did).
  Gates: `npm test` 128/128, `npm run test:rules` 98/98 (+4 new PH6b emulator
  assertions proving the timeout-then-retry equivalence against the real
  server), lint 0, build ✓. No `firestore.rules` change.
- ~~**Browser / tab / lifecycle integrity.**~~ **DONE — CONCURRENCY PHASE 7
  (discovery) + PHASE 7b (hardening), shipped and production-verified.**
  Discovery found that tab duplication, the edit-lease rules, and in-app tab
  navigation each had a lifecycle gap the Phase 1b–6b architecture didn't
  cover; all three are closed:
  - **Tab-duplication-safe operation identity (PH7-01, was CRITICAL).**
    Duplicating a browser tab clones `sessionStorage` (per the HTML Living
    Standard) — including the Phase 5b durable operation id — so a duplicated
    tab could inherit the original tab's id and have a genuinely different
    business action (e.g. a second, different-amount payment) silently
    swallowed as "already applied," with a false-success UI. `window.name` is
    the one relevant browser-context property the spec does NOT clone into a
    duplicated/new tab, while it DOES survive a same-tab reload — so
    `lib/durableOpId.js` now tags every stored id with a page-instance id
    derived from `window.name`; an id whose tag doesn't match the current
    page instance is never reused for a new intent. A same-tab refresh/retry
    is completely unaffected (verified: id X stays X); a duplicated tab's new
    action now correctly mints a new id (Y ≠ X); backend idempotency
    (Phase 4b/5b/6b) is unchanged — this closes the client-side gap that let
    a collision reach it in the first place, not a weakening of it.
  - **Session-aware edit-lease rules (PH7-27, was MEDIUM).** `editLocks`'
    Firestore rules previously authorized any write from the *same uid* onto
    an ACTIVE lease, without checking `sessionId` — a raw client bypassing
    `lib/editLease.js`'s own (already session-aware) transaction could
    overwrite or delete its own other tab's active lease. The rules now
    require the incoming write's `sessionId` to match the lease's current
    `sessionId` too, for any write against a still-ACTIVE lease; only an
    already-EXPIRED lease may be taken over without matching. Firestore's
    `delete` carries no payload for rules to check identity against, so an
    active lease is now released via a session-scoped **update** (a
    backdated `expiresAt`) instead of a delete; `delete` itself is now
    restricted to already-expired documents, for anyone. Proven with 10
    emulator scenarios covering same-uid/different-session and
    different-uid/different-session cases (`tests/rules/firestore.rules.test.cjs`,
    "STEP 27 — PHASE 7b FIX").
  - **Unsaved-edit tab-switch guard, generalized (PH7-02, was MEDIUM).**
    Settings already warned before an in-app tab switch discarded unsaved
    config; Customer, Part, Supplier, Job Card, and Invoice editors did not.
    All five now report their own dirty state to the dashboard via a shared
    `onDirtyChange` prop / `moduleDirtyRef`, reusing each editor's existing
    dirty computation (Part/Supplier's `dirty`/`supDirty`, a new equivalent
    for Customer/Invoice, JobCardModule's existing ref-based tracker routed
    through one `setDirty` wrapper) — no new dirty-detection logic was
    invented per editor. The guard never fires with no real change, never
    fires after a successful save, and never gets stuck after a
    cancel/discard (every editor resets the flag on its own unmount).
  Gates: `npm test` 129/129, `npm run test:rules` 125/125 (+ new PH7-27
  session-identity scenarios), lint 0, build ✓. One `firestore.rules` change
  (`editLocks` only — session-scoped update/delete semantics; every other
  collection unchanged). See KNOWN_LIMITATIONS.md for the residual
  browser-coverage caveat (Chromium-family verified live; Firefox/Safari
  expected identical per spec but not independently confirmed this session).
- ~~**Transaction boundary / partial-failure integrity.**~~ **DONE —
  CONCURRENCY PHASE 8 (discovery) + PHASE 8b (hardening), shipped and
  production-verified.** Discovery found the invoice realization cascade —
  the highest-value workflow in the app — committed its stock/sales-ledger/
  rollup effects as separate, un-awaited writes relative to the invoice/
  payment document itself; a new invoice could even realize those effects
  *before* the invoice document existed. All confirmed defects are closed:
  - **PH8-01/PH8-01b/PH8-01c (invoice create/edit/payment/delete, was
    CRITICAL/CRITICAL/HIGH).** A shared pure planner (`planInvoiceRealization`,
    still diff-based and idempotent exactly as before) now has its writes
    applied (`applyRealizationPlanInTx`) INSIDE the same Firestore transaction
    as the invoice document write itself, for all four entry points
    (`createInvoiceTransactional`, `editInvoiceTransactional`,
    `collectInvoicePayment`, `deleteInvoiceTransactional`). The Phase 1a
    `_rev` guard and Phase 3b/4b idempotency markers are unchanged; Phase 2's
    number-allocation transaction stays a separate, necessary prior step (a
    documented skipped-number gap on failure between allocation and the
    invoice transaction is unchanged and is not a new financial-consistency
    defect, since the invoice/stock/ledger transaction itself is now
    all-or-nothing). Customer totals and vehicle history stay outside the
    transaction (derived data — folding them in would add cross-document lock
    contention for no correctness benefit) but are now genuinely awaited with
    an honest, distinct failure message, and vehicle history is now idempotent
    (guards against double-counting on a retry).
  - **PH8-02 (Job Card multi-part reservation, was MEDIUM).**
    `applyReserveDelta` reads every affected part first, then writes every
    part inside ONE transaction — was N independent per-part transactions
    (`Promise.allSettled`), which could leave a card with 2-of-3 parts
    reserved if the 3rd failed.
  - **PH8-03 (bulk operations over 500 writes, was MEDIUM).** Firestore has no
    atomicity primitive across more than 500 writes in one call, so this
    wasn't "fixed" by forcing a giant transaction — `commitBatch` now throws a
    `BatchPartialFailureError` carrying `completedCount`/`totalCount`/
    `remainingOperations` on a mid-run failure, so the capacity-cleanup wizard
    reports an accurate "X of Y processed, run again to finish" instead of the
    previous always-wrong "no records were deleted/archived." Every
    underlying write is idempotent, so a resumed cleanup always converges.
  - **PH8-05 (offline Quick Sell, was MEDIUM).** A Firestore transaction
    cannot run at all while genuinely offline; the previous fallback was 3
    independent fire-and-forget writes. Now persists exactly ONE durable
    `pendingSales/{opId}` document (atomic by definition, rules-scoped to its
    own creator) and reconciles it through the *exact same* atomic
    `runQuickSaleTx` once connectivity returns.
  - **Global fire-and-forget audit.** The quick-restock ledger row (an
    authoritative business write) is now atomic with its stock change. The
    supplier-edit cascade to linked parts and reorder-request writes were
    reviewed and classified as derived/advisory respectively — correctly left
    as independent, best-effort writes, not elevated; the supplier-edit
    primary write is now awaited and its cascade failures are counted and
    reported instead of silently absorbed.
  - **PH8-06 (`store.syncAll` multi-document diff, was MEDIUM).** Classified
    and documented as an intentional INDEPENDENT BATCH, not one transaction
    spanning every diffed document (unrelated documents — e.g. a bulk archive
    across many different customers — should not be forced into one
    transaction for no correctness benefit); every write in it is naturally
    idempotent, so a partial failure is always safely resumable.
  Gates: `npm test` 130/130, `npm run test:rules` 133/133 (+8 new `pendingSales`
  rules scenarios), lint 0, build ✓. One `firestore.rules` addition
  (`pendingSales` — new collection, scoped to its own creator; every other
  collection unchanged).
- ~~**Orphan-record / broken-relationship integrity.**~~ **DONE — PHASE 9,
  shipped and production-verified.** A dedicated audit of every "parent
  deleted, child still references it" relationship in the app (Customer,
  Part, Supplier, Vehicle vs. Job Cards/Invoices/Purchase Orders). Almost
  every relationship was already correct BY DESIGN: Job Cards, Invoices, and
  Purchase Orders store a denormalized snapshot (name/phone/reg no./price/
  supplier name, etc.) alongside their id reference, never a live-only
  pointer, so deleting the parent leaves the historical child fully readable,
  editable, and financially unchanged — confirmed for Customer→Job Card,
  Customer→Invoice, Supplier→Purchase Order, and Vehicle→Job Card, with no
  resurrection risk (`syncCustomerTotals`/`touchVehicleHistory` only ever
  `.map()` the existing customers array; neither Job Cards nor Invoices ever
  call `setCustomers`). Two genuine defects were found and fixed:
  - **PH9-01 (Part deleted → invoice realization, HIGH).**
    `applyRealizationPlanInTx` called `tx.update()` on a part's stock document
    unconditionally for every entry in a realization plan's `stockDeltas`. A
    part can be permanently hard-deleted from the catalog at any time (no
    dependency check) while a historical invoice still references it —
    intentional, "past sales and analytics history are kept." Firestore's
    `tx.update()` throws "No document to update" against a missing doc,
    which aborted the WHOLE invoice transaction: a paid invoice referencing a
    since-deleted part could never be edited, paid, or deleted again. Fixed
    with a new `resolveExistingPartIds(tx, stockDeltas)` — reads every
    targeted part doc (Firestore's own read-before-write rule, so the read
    runs before the invoice's own write in all four transactions:
    create/edit/payment/delete) and `applyRealizationPlanInTx` now skips a
    delta whose part id isn't in that set. Every other invoice field, the
    sales-ledger row, and the salesRollups delta are unaffected.
  - **PH9-02 (Part deleted → PO receiving, HIGH).** The exact same defect
    shape in `poReceiveDoc` — receiving a line whose part had been deleted
    threw and aborted receiving of every OTHER line on the same PO too. Same
    fix shape: resolve which received lines' parts still exist via reads
    before the PO's own write; a line whose part is gone still advances the
    PO's own `receivedQty` and keeps its restock-ledger entry (historical
    record, same policy as sales/audit history), it just has no catalog
    stock document left to increment.
  Gates: `npm test` 131/131 (+1 new dedicated
  `tests/orphan-record-integrity.test.cjs`), `npm run test:rules` 133/133
  (unchanged — no rules change), lint 0, build ✓. No `firestore.rules`
  change.
- ~~**Referential-integrity audit.**~~ **DONE — PHASE 10, shipped and
  production-verified.** Independent of deletion (Phase 9's question), does
  every relationship get created/edited/looked-up against the entity the
  user actually intended? Three defects found, all the same shape — a
  relationship resolved by a mutable/reusable/ambiguous field instead of a
  stable id, with the id-based path already established elsewhere in the
  same file but not used here:
  - **PH10-01 (HIGH).** `jobNo` is both the Job Card document id and the
    only field an Invoice uses to find "its" job card (a string match, not
    a doc-id reference). Deleting the highest-numbered job card let
    `nextJobCardNumber` hand that number to a brand-new, unrelated job
    card — an old invoice's "View Job Card" would then silently resolve to
    it. Fixed by folding `invoices` into the same max-scan everywhere a new
    number is generated or a manual one is validated, so a number is never
    reissued while any invoice still carries it.
  - **PH10-02 (HIGH).** Linking an existing Job Card onto a job-card-first
    invoice (`linkJobCard`) resolved the owning customer by phone-then-name,
    never trying the job card's own `customerId` first — a shared name or a
    changed phone number could silently attach the invoice to the wrong
    customer. Fixed to try `customerId` first, matching `custVehicles`'s and
    JobCardModule's own `matchedCust` precedence elsewhere in the codebase.
  - **PH10-03 (MEDIUM).** Two "quick add a vehicle" shortcuts (mid-invoice,
    mid-job-card) had no equivalent of the Vehicles module's own global
    registration-number uniqueness check (`dupReg`), risking a second
    ownership record for a vehicle already on file under a different
    customer. Both now check every customer's vehicles first.
  Every other relationship boundary tested (customer/vehicle selection
  atomicity, duplicate part/line prevention, Supplier/Part id-based
  grouping, Job-Card double-billing, walk-in near-duplicate detection) was
  already correct by construction. Gates: `npm test` 132/132 (+1 new
  dedicated `tests/referential-integrity.test.cjs`), `npm run test:rules`
  133/133 (unchanged), lint 0, build ✓. No `firestore.rules` change.
- ~~**Financial integrity / money consistency audit.**~~ **DONE — PHASE 11,
  shipped and verified.** Is `grandTotal` mathematically correct, `paid` truly
  traced from payment records, `balance = grandTotal - paid`, and `status`
  correctly derived — checked with a freshly-written independent oracle
  against BOTH of the app's money-calculation paths (`totalsOf`/`deriveStatus`
  in BillingModule, `invTotals`/`invStatus` in InventoryDashboard) across
  zero/decimal/rounding-boundary/large-value/discount/GST scenarios. Two
  CRITICAL defects found and fixed, both minimal (one a deletion, one a
  reused guard pattern):
  - **PH11-01.** Refund/Return on a Paid invoice restored inventory TWICE:
    once correctly inside the atomic `editInvoiceTransactional` realization
    diff (Phase 8B), and once more via a leftover, non-transactional
    `onRestoreStock` callback that unconditionally re-added the same
    quantities — or, on a never-realized invoice, invented stock that was
    never deducted. Fixed by deleting the redundant callback entirely — the
    atomic transaction was already the correct, sufficient reversal.
  - **PH11-02.** `invStatus` (the function `collectInvoicePayment` actually
    persists as the invoice's `status` field) was missing the overpayment
    guard `deriveStatus` already had (BUG-LIVE-002) — an overpaid invoice
    could be authoritatively stored and reported as a clean "Paid". Worse,
    `collectInvoicePayment` never re-validated a payment against its own
    fresh read, so a concurrent "edit total down" + "pay against the old
    balance" race could commit `paid > grandTotal`. Both closed: `invStatus`
    gained the same one-line guard as `deriveStatus`, and the payment
    transaction now rejects (`conc/overpaid`, before any write) whenever the
    incoming payment would overpay its OWN freshly-read total.
  Gates: `npm test` 133/133 (+1 new dedicated `tests/financial-integrity.test.cjs`,
  147 assertions), `npm run test:rules` 133/133 (unchanged), lint 0, build ✓.
  No `firestore.rules` change.
- ~~**Inventory accounting integrity audit.**~~ **DONE — PHASE 12, shipped
  and verified.** Can every Part's current Firestore `stock` be
  mathematically explained by its complete movement history (opening + IN −
  OUT)? Confirmed `reserved` (Job Card claims) and `stock` (physical
  quantity) are genuinely separate fields — reservation never touches
  `stock`. One HIGH-severity defect found and fixed with a one-line deletion:
  - **PH12-01.** `handleSaveInner`'s shared Part create/edit payload included
    a bare `stock` field. Editing a part's unrelated fields (name, category,
    price...) therefore merge-wrote whatever stock value the Edit Part form
    loaded WHEN IT OPENED back onto the document — and since Quick Sell,
    Restock, Stock Adjustment, PO receiving, and invoice realization are all
    atomic stock-only transactions that never bump a Part's `_rev`, the
    Phase 1a guarded-edit conflict check had no way to detect that stock had
    moved underneath the open editor. A real, already-ledgered sale's effect
    on `stock` could be silently reverted with zero `stockAdjustments`/
    `restocks`/`sales` record explaining the jump. Fixed by removing the one
    regressed line — the object's own adjacent comment already documented
    "stock & salesCount are not in `payload`" as the intended invariant;
    `salesCount` correctly honored it, `stock` had drifted back in. The
    CREATE branch needed no change (it already sets `stock` explicitly,
    independently — that IS a new part's legitimate opening value).
  Every other movement source (PO receive, manual restock, quick-restock
  stepper, Stock Adjustment, Quick Sell, invoice realization, return/
  reversal, Job Card reservation) was confirmed to already write a complete,
  atomic, attributable ledger entry — no duplicate-movement or
  missing-movement gap was found. Gates: `npm test` 134/134 (+1 new
  dedicated `tests/inventory-accounting-integrity.test.cjs`, 36 assertions),
  `npm run test:rules` 133/133 (unchanged), lint 0, build ✓. No
  `firestore.rules` change. Production code: +21/−2 lines (19 comment, 2
  logic — see the report's own code-growth review).
- ~~**Authoritative-field stale-snapshot audit.**~~ **DONE — PHASE 13,
  shipped and verified.** For every field writable by more than one
  workflow across Customer/Vehicle/Job Card/Invoice/Supplier/Part: does a
  stale whole-document editor's blind merge ever overwrite a newer
  authoritative value some other workflow wrote in the meantime? Confirmed
  Customer's engine-derived fields and `vehicles[]`, Invoice's
  `payments`/`paid`/`balance`/`status`, Part's `stock`/`salesCount`/
  `reserved`, and Job Card's fields are all already correctly protected
  (exclusion from the wizard payload, `_rev` participation on both writers,
  or `replayIdArray` reconciliation). One MEDIUM defect found and fixed:
  - **PH13-01.** The Supplier edit wizard's payload carries
    `name`/`phoneNumbers`/`primaryPhone`/`phones`/`phone` as loaded when it
    opened. `persistSupplierEdit` — a quick fix for the same fields,
    reachable from inside the Part modal — wrote them via a plain
    `updateDoc` that never bumped `_rev`, so the wizard's own `_rev` guard
    had no way to detect the quick edit and would silently revert it on
    save. Fixed by adding `_rev: increment(1)` to that `updateDoc` call —
    reusing Phase 1a's existing revision protocol (the same shape
    `collectInvoicePayment` already uses to protect Invoice's payment
    fields), not a new synchronization mechanism.
  Gates: `npm test` 135/135 (+1 new dedicated
  `tests/authoritative-field-integrity.test.cjs`, 10 assertions), `npm run
  test:rules` 133/133 (unchanged), lint 0, build ✓. No `firestore.rules`
  change. Production code: +14/−0 lines (13 comment, 1 logic).
- ~~**Ledger / business-event integrity audit.**~~ **DONE — PHASE 14,
  shipped and verified.** Does every business action create exactly the
  ledger/event records it's supposed to — no more, no fewer, correct
  content? Derived the real cardinality rule from source rather than
  assuming it: an invoice's sales-ledger rows key Part lines by `partId`
  (repeats of the same part merge into one row) and every other line by its
  own line id (never merges, even with identical text) — verified this
  against `invoiceRevenueLines` directly. Confirmed every authoritative
  money/stock ledger write (invoice realization, payment, Quick Sell, PO
  receive, Stock Adjustment, manual restock, Job Card reservation) already
  commits atomically with its state change and is correctly keyed for
  idempotency (opId-keyed docs, `_rev`-guarded invoice realization,
  `appliedReceiptIds`/`appliedReserveIds` marker arrays, or diff-based
  reversal — no separate "reversal" code path to duplicate or omit). No
  CRITICAL/HIGH/MEDIUM defect found. One INFO-level dead-code hazard
  removed as hardening:
  - `recordInvoiceSalesDelta` (the pre-Phase-8B invoice ledger writer, now
    reached only from the demo-only `runInvoiceRealizationDemo`) still
    carried its own internal production-mode branches from before that
    split: a dead `else addDoc(collection(db, COLLECTIONS.SALES), record)`
    and a dead, unreachable `salesRollups` `setDoc` block. Neither had ever
    executed — but either would become a live SECOND, non-transactional,
    non-idempotent writer for the same invoice event
    createInvoiceTransactional/editInvoiceTransactional already commit
    atomically, if a future refactor ever called this function outside
    demo mode. Removed as preventative hardening, not as a fix for a live
    defect (it never wrote incorrect data).
  Gates: `npm test` 136/136 (+1 new dedicated
  `tests/ledger-integrity.test.cjs`, 48 assertions), `npm run test:rules`
  133/133 (unchanged), lint 0, build ✓. No `firestore.rules` change.
  Production code: +24/−23 lines (net +1; the real substance is ~15 lines
  of dead Firestore-write code deleted, offset by explanatory comments).
- ~~**Audit-log integrity audit.**~~ **DONE — PHASE 15, shipped and
  verified.** Does the audit trail accurately record WHO/WHAT/WHEN/WHICH
  RECORD for important business actions? Confirmed both `pushAudit`/
  `writeAudit` always correctly captured the real actor and never fire
  before their authoritative write's confirmed success (no audit entry
  anywhere claims a failed operation succeeded). Three defects found and
  fixed:
  - **PH15-01 (HIGH).** Customer/Vehicle/Invoice's own embedded
    history/notes (shown directly in each record's detail view, separate
    from the shared `auditLog`) hardcoded a static actor placeholder
    (`'Admin'`, `'You'`, `'Staff'`) for every production entry, regardless
    of who was actually signed in — while the shared `auditLog`'s own
    entry for the same action was always correctly attributed. Fixed by
    reusing `capacityActorEmail`/`actorEmail`, a value already computed
    and already passed into 6+ other components for this exact purpose,
    at all 8 hardcoded call sites.
  - **PH15-02 (MEDIUM).** A payment that didn't fully realize an invoice
    (partial, or any after the first) was audited as the generic "Invoice
    Updated" — the exact "payment recorded as generic invoice edit"
    failure mode. Fixed with a `payments[].length` diff (data
    `collectInvoicePayment` already produces) driving a new "Payment
    Received" action + amount/mode-specific detail.
  - **PH15-03 (MEDIUM).** `auditLog`'s Firestore `create` rule allowed any
    signed-in user to write an entry with a forged `performedBy` —
    impersonating a different user. Fixed by requiring
    `performedBy == request.auth.uid`, reusing `pendingSales`' existing
    self-attribution pattern.
  Gates: `npm test` 137/137 (+1 new dedicated
  `tests/audit-log-integrity.test.cjs`, 33 assertions), `npm run
  test:rules` 138/138 (133 previous + 5 new), lint 0, build ✓.
  Production code: +39/−13 lines across 4 components; `firestore.rules`
  +10/−1 (requires a manual publish to the live project — pushing to
  `main` alone does not change live rule enforcement).
- ~~**Search / filter / sort / pagination consistency audit.**~~ **DONE —
  PHASE 16, shipped and verified.** Do records stay correctly represented
  when the dataset changes (edit / delete / archive / restore / a
  concurrent client's write) while search/filter/sort/pagination state is
  active? Search, filter, sort and combined-filter behaviour were already
  sound — every result set is a pure `useMemo` derivation of the single
  listener-fed source array (`lib/useSearch.js`'s shared engine), keyed by
  stable document ids, self-healing on any live data change (verified with
  the real `searchAndRank` against the mandatory ABC→XYZ→ABC concurrent-
  rename scenario). One MEDIUM defect found and fixed:
  - **PH16-01.** The pagination page *index* was left stale when a list
    shrank via a live change **without** a filter change (a delete, an
    archive/restore, a status change moving a record out of the current
    filter tab, or a concurrent client's write). The row `.slice()` then
    sliced past the end and rendered an empty page while the shared
    `<Pagination>` showed `"3 / 2"` and `"41–25 of 25"`, or the custom
    pagers (Suppliers ×2, Alerts) hid entirely — leaving no visible
    control back to the remaining records. Authoritative data was never
    wrong; only the paginated view of it. Fixed by consolidating the clamp
    into the shared `<Pagination>` component (one effect + a clamped
    display) plus three one-line `if (page > pageCount) setPage(pageCount)`
    effects for the custom pagers — reusing the exact pattern the main
    Parts list already used. Customers row-ordinal column: `page` →
    `safePage` (cosmetic). `LedgerPage` left unchanged (append-only data;
    its `setPage(1)` effect covers every real shrink vector).
  Gates: `npm test` 138/138 (+1 new dedicated
  `tests/search-filter-pagination-integrity.test.cjs`, 48 assertions —
  independent oracle + the real `<Pagination>` rendered + the real search
  engine), `npm run test:rules` 138/138 (unchanged), lint 0, build ✓.
  Production code: +30/−7 lines across 4 files (≈19 comment).
- ~~**State-machine / lifecycle integrity audit.**~~ **DONE — PHASE 17,
  shipped and verified.** Can a transition forbidden by business
  semantics be performed by bypassing a UI restriction? Derived the real
  state machines from source: Invoice status is a pure computation over
  payments/grandTotal/isEstimate (can't be forged), with three explicit
  terminal overrides (Cancelled/Refunded/Returned) that stick verbatim and
  drive the single diff-based realization/reversal engine (Phase 8B/11);
  deleted invoices can't be resurrected (Phase 1a); Job Card stage
  ordering is a deliberate soft UI guardrail with order-independent,
  idempotent reservation math underneath; terminal states gate archival
  (`capacityService`, Phase 9/10 unregressed). One HIGH defect found and
  fixed:
  - **PH17-01.** A **cancelled** purchase order (a terminal state) could
    be **received against** through a concurrent-cancel race — Client A
    opens the Receive form on a `sent` PO, Client B cancels it, Client A
    submits. The receive path had no cancelled-status check at any layer;
    the transaction would un-cancel the PO, increment part stock, and
    write a `restocks` ledger row for an order the business had called
    off. Fixed in `applyPoReceive` (the one pure decision function every
    receive path goes through) → `blocked:'cancelled'`, `poReceiveDoc`
    throws `po/cancelled` inside its transaction on the re-read server
    status, and `receivePO` adds a client guard for the demo path.
    Reused the existing `over`/error-code pattern — no new function,
    file, or abstraction.
  Two narrow, label-only PO races (`poAdvanceDoc` blind write, `cancelPO`
  client-snapshot guard) documented, not fixed (no stock/money side
  effect). No `firestore.rules` change (business-state integrity lives in
  the transaction layer by design; the append-only ledger rules are
  already the security boundary).
  Gates: `npm test` 139/139 (+1 new dedicated
  `tests/state-machine-integrity.test.cjs`, 34 assertions — independent
  status/transition oracles + the real applyPoReceive/reserveDelta),
  `npm run test:rules` 138/138 (unchanged), lint 0, build ✓.
  Production code: +31/−5 lines across 3 files (≈17 comment).

## Scale — before large datasets

- **Move part images out of Firestore.** Production part photos are stored as base64
  `imageString` inside each `parts` document, so every inventory read pulls the full
  image payload. Upload to Firebase Storage, store the download URL, migrate existing
  docs, keep `imageString` only as a legacy fallback.
- **Table virtualization.** Inventory/sales lists paginate (25/page) but do not
  virtualize; revisit past ~10k rows with `react-window` or TanStack Virtual.
- **Composite indexes.** `firestore.indexes.json` is empty and correct today (all live
  queries are single-field). When a compound `where + orderBy` is introduced, add the
  index Firestore's error links and `firebase deploy --only firestore:indexes`.
- **Server-side search.** In-memory ranking is sub-millisecond at current scale; a
  hosted index (Algolia / Typesense) becomes necessary around ~100k customers.
- **Multi-branch stock.**

## Code health

- **Split `components/InventoryDashboard.js`.** It is the ~8,600-line composition root
  (live subscriptions, tab model, deep-link router, most reads/writes). Add unit tests
  for the pure logic still inline, then extract domain hooks (`useInventory`,
  `useSuppliers`, `useSales`) and per-tab route chunks. Tests must come first.
- **Finish the persistence-adapter migration.** `services/persistenceStore.js` is
  partially adopted; the rest of the shell still calls Firestore directly.
- **Accessibility polish.** A document-level focus trap (`lib/focusTrap.js`) and
  `prefers-reduced-motion` are in place. Remaining: `aria-label` on every icon-only
  button, and verifying tab order, visible focus, and 200% zoom in a real browser.
- **Reduce the demo-photo bundle.** `lib/partPhotos.js` inlines ~201 KB of base64 demo
  photos; move to a cacheable static asset.
- **Types.** TypeScript, or at least JSDoc typedefs on the `services/` boundary.
- **E2E + automated accessibility suite.** The current suite is Node/jsdom (logic and
  wiring only); add browser-level end-to-end and a11y checks.

## Product & compliance

- Credit / debit notes (invoice cancellation works today).
- E-invoicing & IRN (mandatory only above ₹5 crore turnover).
- Backdated-invoice locking after a GST return is filed.
- Granular roles (Manager / Reception / Mechanic) beyond admin / staff / guest.
- Bulk row actions, skeleton loaders, column resize.
- Optional explicit "Remember me" toggle (Firebase LOCAL persistence already keeps
  sessions across refresh/tabs).

---

## Resolved since the 1.0.0 gate

These were open items on the pre-1.0 checklist and are now done:

- Modal focus containment — one document-level trap (`lib/focusTrap.js`) covering every
  overlay; `Modal.js` carries `role="dialog"` / `aria-modal`.
- Duplicate-phone detection on customers (`CustomersModule.jsx` blocks the save and
  offers the existing record).
- Next.js patched to `14.2.35` (off the advisory in `14.2.3`).
