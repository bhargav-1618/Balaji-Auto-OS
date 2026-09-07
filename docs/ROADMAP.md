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
- ~~**Validation bypass / mutation-boundary integrity audit.**~~ **DONE —
  PHASE 18, shipped and verified.** For every important business rule: is it
  enforced where the data is *written*, or only by the UI it happens to be
  typed into? Established the architecture (client-only, single-shop trust,
  Firestore rules are the *security* boundary — append-only ledgers, actor
  attribution, privilege/delete authorization, monotonic numbering — never
  business field validation; money/stock/numbering re-checked in
  transactions; derived state as un-forgeable pure functions; format /
  uniqueness / relationship in the component every path funnels through).
  50 rules inventoried, all classified. One MEDIUM defect found and fixed:
  - **PH18-01.** The inline "+ New Customer" reachable mid-invoice
    (`BillingModule.saveNewCustomer`) validated phone/GST *format* but not
    *uniqueness* — so a walk-in could be saved with a mobile or GST that
    already belongs to another customer, splitting their history and
    outstanding balance. The full Customers wizard and the Vehicles-module
    quick-create both block this. **Same bug class as PH10-03** (the inline
    Add-Vehicle shortcut, one file over). Fixed with an 11-line in-component
    guard mirroring the adjacent `saveNewVehicle`/`dupOwner` check and
    reusing the wizard's own `phoneKey` normalizer — no new function, file,
    or abstraction. Reproduced live before, verified blocked after.
  Non-defects surfaced and documented (all INFO/LOW): `billingService.invoiceStatus`
  reads an overpaid invoice as "Paid" (reachable only past 3 write-path
  guards); client-scan uniqueness is not race-proof; received-PO label-flip
  to cancelled (Phase 17); `+91`-paste quirk in one phone field.
  Gates: `npm test` 140/140 (+1 new `tests/validation-bypass-integrity.test.cjs`,
  58 assertions — independent clamp/status oracles + real InvoiceModal
  drive), `npm run test:rules` 138/138 (unchanged), lint 0, build ✓. No
  `firestore.rules` change. Production code: +12/−1 lines in 1 file (≈7 comment).
- ~~**Authorization matrix / access-control integrity audit.**~~ **DONE —
  PHASE 19, no production code change.** For every privileged action: is it
  enforced at the DATA layer, or only by a hidden/disabled UI control? Built
  the full Owner / Admin / Staff / Unauthenticated matrix (24 actions) and
  verified all three layers — UI (`role`/`isAdmin`/`canManage`/`canDelete`),
  mutation (`_rev`/txn guards), and `firestore.rules` (the authoritative
  boundary). Findings:
  - **Role model.** OWNER ≡ ADMIN at runtime (the hardcoded owner is a
    lock-out safety net, not a tier); no ownership-transfer mechanism; STAFF
    is read-only in the UI for customers/invoices/job-cards/billing/suppliers
    and can view stock + record sales; per-staff `costPrices`/`exports` work,
    `deletes` grants only the soft archive/restore UI. Demo = synthetic guest,
    never writes Firestore.
  - **Every destructive/privileged op is authoritative at Firestore, not the
    UI:** hard deletes (`delete: if isAdmin()`), role management (`appSettings
    create,update: if isAdmin()` — incl. the `staff` sub-object), ledger
    immutability (`update: if false`, overrides admin), recovery data
    (`isAdmin()`), auditLog actor (`performedBy == request.auth.uid`), counter
    monotonicity, edit-lease identity, per-user `pendingSales`,
    deny-by-default. **148 live emulator assertions** (+10 for Phase 19).
  - **No CRITICAL/HIGH, no direct-Firestore bypass, no role-escalation path,
    no IDOR issue, no alternate-workflow bypass.** 3 LOW / 4 INFO documented:
    `perms.deletes` can't do a *hard* delete (Firestore admin-only — correct);
    inline supplier quick-create is non-admin-reachable (non-destructive);
    dead `demoGuard()`; `salesRollups` update is `signedIn` (derived
    aggregate); single-shop shared data is intentional.
  - **Rules deployment gap (pre-existing, unchanged):** the base ruleset IS
    live on `balaji-auto-os-7` (confirmed — unauth Firestore read → 403), but
    `firestore.rules` last changed at `7b5520c` (Phase 15 auditLog check) and
    the last recorded deploy is `6bfb88d` (before it). **OWNER must run
    `firebase deploy --only firestore:rules`** to publish the auditLog
    actor-forgery protection. No Firebase credentials in this environment.
  Gates: `npm test` 141/141 (+1 new
  `tests/authorization-matrix-integrity.test.cjs`, 76 static assertions),
  `npm run test:rules` 148/148 (+10), lint 0, build ✓. No `firestore.rules`
  change. Production code: 0 lines.
- ~~**Firestore security-rule bypass / field-level integrity audit.**~~ **DONE —
  PHASE 20, one MEDIUM defect fixed.** Direct emulator testing of forged/malicious
  writes: "even when an authenticated client IS allowed into a collection, can it
  forge a protected field?" Classified every field FIRESTORE-PROTECTED /
  APPLICATION-ENFORCED / DERIVED / INTENTIONALLY-CLIENT-WRITABLE. The genuine
  security invariants all hold: actor identity, role/permission data
  (`appSettings` admin-only, no writable `role` field), ledger immutability
  (`update: if false` overrides admin), monotonic invoice numbering, recovery
  data, `editLocks` ownership+session, `pendingSales` creator-scope,
  unauthenticated deny (live-confirmed 403). Ordinary business fields
  (`invoice.status/paid`, `part.stock`) are correctly DERIVED / client-writable —
  a forged write violates no invariant and triggers no ledger/stock side-effect.
  One MEDIUM defect:
  - **PH20-01.** `firestore.rules` pinned `auditLog.performedBy` (the uid — PH15)
    but NOT `performedByEmail` (the string the Audit Log UI actually *displays*)
    or `createdAt`. A signed-in staffer could POST an audit entry showing another
    user (e.g. the owner) performing any action at any time — real history could
    not be erased, but a forged entry could be *inserted*. Confirmed in the
    emulator (5 forgery vectors). Fixed with 2 rule clauses
    (`performedByEmail == request.auth.token.email`, `createdAt == request.time`)
    reusing the PH15 self-attribution pattern, plus a one-writer correction
    (`capacityService.writeCapacityAudit` wrote `performedBy: null`; now carries
    `auth.currentUser` uid+email). No new function/file/abstraction.
  Gates: `npm test` 141/141, `npm run test:rules` **261/261** (new
  `tests/rules/security-bypass.rules.test.cjs`, 111 emulator assertions + runner;
  `firestore.rules.test.cjs` 150), lint 0, build ✓. Production: `firestore.rules`
  +2 clauses; `capacityService.js` +7 net; `package.json` 1 line.
  - **Rules deployment (owner action required):** `firestore.rules` now carries
    BOTH the Phase 15 and Phase 20 auditLog hardening. The base ruleset is live
    (403 on unauth reads — verified) but the live `auditLog` `create` rule is the
    pre-Phase-15 form. **OWNER must run `npx firebase deploy --only
    firestore:rules --project balaji-auto-os-7`.** No Firebase credentials in
    this environment; the client already writes the correct actor values.
- ~~**Malformed-input / data-corruption audit.**~~ **DONE — PHASE 21, one HIGH
  defect fixed.** "When malformed / extreme / hostile-looking data reaches the app,
  does it stay stable and keep its data intact through persistence → read → search →
  calculations → PDF → analytics?" HTML/script-like input is SAFE (zero
  `dangerouslySetInnerHTML`/`innerHTML`/`eval`; CSP; React escapes every string
  child). Unicode/emoji/RTL/zero-width/10 000-char all round-trip (input `.slice()`
  caps + Firestore UTF-8). Search is pure substring/token, no user-compiled `RegExp`.
  The Workshop PDF was **rendered in-process from fully-malformed data** (400-char
  Japanese + `<script>` + emoji in every field, `rate: Infinity`, `totals` all `NaN`)
  — 2-page PDF, no throw. One HIGH defect:
  - **PH21-01.** `<input type="number">` keeps a pasted **309-digit** string (it
    still parses to a *finite* double), but `parseInt`/`parseFloat` overflow it to
    `Infinity`, and the write-boundary clamps
    (`nonNegInt = Math.max(0, parseInt(v,10) || 0)` etc., plus inline copies in
    `RestockModal`/`BulkReceiveModal`/`CheckoutModal`/demo part-save/`SupplierPOBuilder`)
    passed that `Infinity` through. Via **Receive Stock** (no upper bound) →
    `stock: increment(Infinity)` → part `stock` permanently `Infinity`/`NaN`,
    unrecoverable from the UI (Edit Part's stock is read-only). Emulator-verified:
    `increment(NaN)` then `increment(5)` stays `NaN`. A pasted `1e308` (finite,
    retained) overflowed the Inventory Valuation report's category + grand totals to
    `₹∞`/`NaN` and broke its CSV/PDF export (reproduced end-to-end). The money/ledger
    engine (`billingService.toNum`, already `Number.isFinite`-guarded) was unaffected.
    Fixed by finite-guarding + `MAX_SAFE_INTEGER`-clamping the three shared coercers
    (`nonNegInt`/`nonNegNum`/`sanitizeStock`) and `lib/format.num`, then routing the
    5 drifted inline copies back through them. No new file/function/abstraction —
    net −5 divergent parse expressions.
  Gates: `npm test` **142/142** (+1 new `tests/malformed-input-integrity.test.cjs`,
  227 assertions incl. an in-process malformed-PDF render), `npm run test:rules`
  **261/261** (no rules change), lint 0, build ✓. Production: ~+14 lines (mostly
  comments) across 4 files.
- ~~**Phase 21 deep adversarial validation.**~~ **DONE — one MEDIUM + one LOW fixed;
  two residuals documented.** Second-level pass to *disprove* the Phase 21 verdict.
  The **input** conclusions all held (forms / paste / CSV / search / PDF / numeric —
  re-confirmed, now live). **"Everything else is SAFE" did NOT** — the original test
  meant to exercise a wrong-type structural field but the line was
  `'not-an-array' ? [] : []` (a no-op).
  - **PH21-D1 (MEDIUM):** a forged/corrupt Firestore doc with a wrong-type nested
    ARRAY field (`invoice.lines`, `customer.vehicles`, `jobCard.parts`/`labour`,
    `part.suppliers`, `po.items` as a truthy non-array) crashes the app app-wide —
    `x || []` is not a type guard, and there is one app-level ErrorBoundary so
    "Reload" re-fetches the bad doc and re-crashes. Reachable by a `signedIn` client
    (Phase 20: rules type-check nothing) or a bad migration. Fixed with
    **`lib/format.asArray`** — the same normalise-at-the-edge guard VehiclesModule
    already applied locally (`normalizeVehicle`), lifted to the shared layer and
    routed through every shared calculator + both money-path copies + every
    always-mounted / list-level consumer + each module's own `useSearchIndex`.
    `asArray(x)` ≡ `x || []` for every real value. Live-verified: all 8 tabs + the
    command palette survive the forged data.
  - **PH21-D1b (LOW):** `computeWorkshopScore` returned `{score: NaN}` → dashboard
    "NaN/100" on a forged sales row `qty:"abc"` (`??` doesn't coerce a string, then
    `+` concatenates). Fixed — `qtyOf` coerces.
  - **Documented, not fixed:** PH21-D2 (wrong-type nested **scalar** rendered as a
    React child → "Objects are not valid as a React child" → app crash; complete fix
    = Firestore-rules `is list`/`is string` assertions, Phase 20's layer);
    PH21-D3 (INFO — a forged 22-digit `invNo` garbles the DRF-draft numbering
    fallback; Phase 2 `counters` is the real GST-serial allocator).
  Gates: `npm test` **142/142** (`malformed-input-integrity.test.cjs` §10 added, 238
  assertions), `npm run test:rules` **261/261** (no rules change), lint 0, build ✓.
  Production: 1 shared `asArray` (1 line) + ~40 `(x || []).method` → `asArray(x).method`
  swaps + 2 `qtyOf` coercions; no new abstraction / schema layer / rules change.
  5 brittle source-regex tests loosened to accept `asArray(x)` alongside `x || []`.
  Commit `33e3dd8`. Report: `docs/testing/PHASE_21_DEEP_VALIDATION_REPORT.md`.
- ~~**PDF / export integrity audit.**~~ **DONE — PHASE 22, two MEDIUM + two LOW
  fixed.** "For every export, does the generated output match the authoritative
  Firestore / application data — record-for-record and value-for-value?" Central
  check: the three-way comparison for invoices —
  `authoritative record ↔ independent hand-calculation (never read off the PDF) ↔ the
  generated output's real bytes`. Verified automated **and** live in demo mode against
  real rendered PDFs (INV-0171 existing paid invoice; INV-0297 QA draft): grand / GST /
  discount / round-off / paid / balance / status / identity all agree. Invoice XLSX
  cardinality live: 296 filtered = 296 exported, 0 missing / 0 duplicate. QR payload =
  summary only, `t = round(grand)`, identity exact. `/verify` renders the URL params
  verbatim (no DB lookup — intentional). Wrong-record isolation confirmed (A's PDF
  carries zero of B's data; a gone customer → the invoice's own denormalised fields,
  never another record). Four defects:
  - **PH22-01 (MEDIUM).** `billingService.invoiceTotals` — the third money-path copy,
    behind the **Vehicle Report "Revenue"** export (`lib/vehicleStats.revenueOf`) —
    was a simplified model: it ignored the invoice-level discount, `gstMode`
    (exempt / IGST) and the per-line-GST-absent → `gstPct` fallback. So a discounted
    or GST-exempt invoice's contribution to exported vehicle revenue was overstated,
    and `invoiceStatus` / `isRealized` could disagree with the Billing screen's
    `deriveStatus` on those invoices. Body rewritten to mirror `totalsOf`'s full
    model (the docstring's "exactly one definition of the total" is now true);
    `financial-integrity.test.cjs` runs its independent oracle against all three
    copies.
  - **PH22-02 (MEDIUM).** The invoice-PDF generators (`drawInvoiceDocument`,
    `lib/workshopInvoicePdf.js`) still used `iv.lines || []` / `iv.payments || []` /
    `jc.statusLog || []` — the **PH21-D1 wrong-type-array class**, in the one path
    PH21-D1's sweep did not reach; a forged non-array field crashed PDF generation
    (the on-screen list already survives). `asArray` guards added.
  - **PH22-03 (LOW).** Status-vocabulary split — `invoiceStatus` / `invStatus`
    returned `"Pending"` while `deriveStatus` (Billing screen + its exports), the
    status filter, the PDF badge palette, `analyticsService` and `constants/ui.js`
    all said `"Unpaid"` → the **same** unpaid invoice printed as "Pending" in the
    Reports→Billing export and "Unpaid" in the Billing export. Fixed:
    `INVOICE_STATUS.PENDING: 'Unpaid'` (key kept) + `invStatus`'s last branch.
  - **PH22-04 (LOW, found live).** The customer-copy invoice PDF and the Purchase
    Order PDF cut line/item descriptions at `.slice(0, 52)` with **no ellipsis**,
    while the workshop copy of the same invoice wraps the full text. Consolidated the
    three "truncate to a width with an ellipsis" copies in the PDF layer
    (`pdfTheme.fitText` private, `workshopInvoicePdf.truncW` private, the bare
    `.slice`) into one exported `pdfTheme.truncW`; customer-copy + PO now use it.
    Live-verified: a 166-char description now renders width-fitted, ending in `…`.
  Gates: `npm test` **143/143** (+1 new `tests/pdf-export-integrity.test.cjs`, 125
  assertions — independent invoice oracle + in-process PDF render + `(…) Tj` text
  extraction), `npm run test:rules` **2/2** (150 + 111, no rules change), lint 0,
  build ✓. Production: **+84 / −53** across 7 files (`lib/workshopInvoicePdf.js` net
  −16 — private helper deleted); mostly comments. No new file / abstraction / schema /
  rules change. Report: `docs/testing/PHASE_22_PDF_EXPORT_INTEGRITY_REPORT.md`.
- ~~**Analytics / source-of-truth reconciliation audit.**~~ **DONE — PHASE 23, one
  MEDIUM fixed.** "Does `authoritative invoice → realization gate → sales ledger →
  salesRollups → dashboard / Reports / Sales analytics` produce mathematically correct
  Revenue / Cost / Gross Profit / Margin?" Built an independent hand-oracle (never calls a
  production analytics helper) and reconciled a truth table
  (Rev 3500 / Cost 2000 / Profit 1500 / Margin 42.857%) at every layer:
  oracle ↔ `ledgerDelta` ↔ reconstructed rollup increments ↔ `Σ totalsOf().afterDisc/profit`
  ↔ the shipped `totProfit = totRev − totCost`. Established the metric definitions from
  source (analytics "Revenue" = realized invoice subtotal, post-discount, **ex-GST**;
  driven by invoice *realization*, not cash collected). Margin guards, date boundaries
  (`computeRange` closed on both ends, no overlap/gap, zero-padded `YYYY-MM`), zero/empty
  (no NaN), negative-profit (never clamped), returns/reversal (exact inverse, idempotent),
  multi-line (repeated part aggregates, independent labour lines don't merge), and demo
  `salesRollups ↔ ledger ↔ paid-invoice subtotal` reconciliation all verified. The
  previously-fixed `cost = 0` regression (BUG-LIVE-005) stays closed. One defect:
  - **PH23-01 (MEDIUM).** An **invoice-level discount** (flat ₹ or %) was folded into the
    invoice total (`totalsOf`/`invTotals` → `grandTotal`/`profitAmount`, and every Billing
    report) but **not** into the sales ledger / `salesRollups` / dashboard analytics /
    Monthly-Profit-Trend, which read per-line revenue. Every discounted paid invoice
    **overstated analytics Revenue and Profit by the whole discount** (Cost unchanged →
    Margin overstated), and the operational dashboard disagreed with the Billing screen on
    the same invoice's profit. Root cause: the E2E-workflow fix that made `invTotals` apply
    the discount (so `isRealized` stopped skipping the realization engine for discounted
    invoices) fixed the *gate* but not the *amounts*. Fixed by allocating the discount
    across the ledger's revenue lines with the **same `afterDisc/sub` ratio** `totalsOf` /
    `invTotals` already use for GST (Phase 11 §) — applied once in the shared line builder
    (`invoiceRevenueLines`, plus the exported twin `billingService.revenueLines`), so the
    ledger, rollups, dashboard, Sales/Services modules and the trend all reconcile to the
    invoice's own post-discount total. Live-verified in demo mode: a ₹300-discounted
    ₹1,500-of-lines invoice realised ₹1,200 revenue / ₹1,200 profit (was ₹1,500 / ₹1,500).
  Gates: `npm test` **144/144** (+1 new `tests/analytics-integrity.test.cjs`, 70
  assertions — independent ledger oracle), `npm run test:rules` **2/2** (150 + 111, no
  rules change), lint 0, build ✓. Production: **+28 / −0** across 2 files (~15 comment).
  No new file / function / abstraction / schema / rules change.
  Report: `docs/testing/PHASE_23_ANALYTICS_INTEGRITY_REPORT.md`.
- ~~**Phase 23 deep adversarial re-audit.**~~ **DONE — CONDITIONAL PASS; one MEDIUM
  fixed.** Independent second pass to *disprove* the Phase 23 PASS. PH23-01 (invoice
  discount) re-confirmed — the `afterDisc/sub` allocation is rounding-exact (7
  adversarial cases, worst drift `8.5e-14`). Revenue / Gross Profit / Margin
  reconciliation confirmed; **6/6 mutation-test corruptions of the truth table were
  detected** (the suite is not vacuous). But the Phase 23 test proved cost through
  `billingService.ledgerDelta` — which **is not wired into production** — so the
  shipped path was never checked. One defect:
  - **PH23-D1 (MEDIUM).** `InventoryDashboard.planInvoiceRealization` /
    `recordInvoiceSalesDelta` (the real ledger builders) computed COGS as
    `dQty × inventory.find(partId).purchasePrice` — **today's catalogue cost** — not
    the invoice line's `l.purchasePrice` snapshot that `totalsOf` / `iv.profitAmount`
    / `billingService.revenueLines` all use. An invoice drafted before a part-cost
    change (a price edit, or a PO received with "update default price") and paid
    after it recorded a different profit/margin in the sales ledger / `salesRollups`
    / dashboard than on its own invoice; editing a paid invoice priced the delta at
    today's cost. Same class as PH23-01: correct source, an intermediate
    re-calculation missing an input, a plausible-looking dashboard. Root cause:
    `invoiceRevenueLines` carried `qty`/`revenue` per line but not `cost`, so the
    diff loops re-sourced it from the live `part` object they were already fetching.
    Fixed — `invoiceRevenueLines` now accumulates `e.cost` from `l.purchasePrice`
    (catalogue = fallback for a legacy line only), and both diff loops compute
    `dCost = a.cost − b.cost` — **symmetric with the existing
    `dRev = a.revenue − b.revenue` one line above**. All four money paths now agree.
    Live-verified in demo mode: draft INV-0299 (snapshot ₹1000), two PO receipts
    raised the catalogue to ₹1200, then paid → ledger `cost 1000 / profit 398`
    (== `iv.profitAmount`), not `1200 / 198`.
  Also: the app has **4 distinct "Revenue"-family definitions** (analytics ex-GST
  realized / Billing GST-inclusive incl-unpaid / Vehicle GST-inclusive realized /
  Customer cash-collected) — all inventoried and classified INTENTIONAL; the Billing
  "Revenue (Month)" card is *invoiced turnover*, not revenue (label note, no code
  change). Gates: `npm test` **144/144** (`analytics-integrity.test.cjs` 105
  assertions, +35 — §12 reproduces the *shipped* ledger, §13 rounding, §14 mutation
  self-test), `npm run test:rules` **2/2**, lint 0, build ✓. Production: **+24 / −0**
  in 1 file (~18 comment). No new file / function / abstraction / schema / rules
  change. Report: `docs/testing/PHASE_23_DEEP_REAUDIT_REPORT.md`.
- ~~**Phase 23 deep re-audit, round 2.**~~ **DONE — CONDITIONAL PASS; one MEDIUM
  fixed.** Third pass. Traced the paths production actually runs (not the tested-but-
  unused `billingService` twins), enumerated every rollup writer and every
  `.balance`/`.paid`/outstanding aggregation site (6), re-ran mutation testing
  (**16/16** corruptions caught). PH23-01 (invoice discount, rounding-exact,
  `8.5e-14`) and PH23-D1 (COGS = line snapshot) both re-confirmed; also noted PH23-D1
  silently removed a reversal-drift bug (a fully-reversed sale used to leave permanent
  rollup drift if the catalogue moved between realization and reversal). One new
  defect:
  - **PH23-D2 (MEDIUM).** The Billing "**Outstanding**" and "**Pending Payments**"
    KPIs (red danger figures) and the per-customer **Outstanding** / **Total Spent**
    totals summed `invTotals(iv).balance` / `.paid` over **every invoice except
    Cancelled**. A Draft (work-in-progress, never billed) and an Estimate (a quote)
    each have `balance === grand`, so each read as its full amount *owed*; a Refunded
    / Returned sale still counted as revenue and its returned payment as "spent". A
    ₹9,440 draft made the dashboard claim the shop was owed ₹9,440 nobody had been
    billed. Same class as PH23-01/D1: source correct (`invTotals`), an intermediate
    predicate too loose, a plausible red UI. The app's own list filter,
    `computeWorkshopProgress` and `isRealized` all already used the right predicate
    (`['Unpaid','Partially Paid']`); six aggregators did not. Fixed by adding
    **`billingService.isOutstanding`** — the symmetric counterpart of the existing
    `isRealized` (`isRealized` = money is here; `isOutstanding` = money is owed;
    everything else contributes nothing) — and routing `syncCustomerTotals`,
    `BillingModule.stats` (the whole money loop now skips Draft/Estimate and counts
    only `['Paid','Unpaid','Partially Paid']`), `bulkReminder` (WhatsApp) and
    `computeAlerts` through it. Live-verified: a ₹9,440 draft now moves NO money KPI —
    only the "Drafts / Estimates" count. Gates: `npm test` **144/144**
    (`analytics-integrity.test.cjs` 125 assertions — §16 reproduces the shipped
    `syncCustomerTotals` + `stats` loop verbatim + independent oracle + 10 new
    mutations), `npm run test:rules` **2/2**, lint 0, build ✓. Production: **+55 / −12**
    across 4 files (~30 comment; 1 new fn). No new file / abstraction / schema / rules
    change. Report: `docs/testing/PHASE_23_DEEP_2_REAUDIT_REPORT.md`.
- ~~**Phase 23 deep re-audit, round 3.**~~ **DONE — CONDITIONAL PASS; one MEDIUM
  fixed.** Fourth pass, aimed at the KPI families that had *not* had Revenue/Cost/
  Profit/Margin/Outstanding-level scrutiny: Customer, Vehicle, Workshop, Parts
  profitability, Inventory valuation, Capital / dead-stock, GST, counts, average
  invoice, trend. Each traced to its authoritative source, independently recomputed,
  and mutation-tested (**19/19** cumulative corruptions caught). PH23-01, PH23-D1,
  PH23-D2 all re-confirmed. Parts profitability (`ledgerByPart` over the frozen `sales`
  rows), inventory valuation (a potential figure, correctly labelled), vehicle
  analytics (`isRealized`-gated GST-inclusive turnover, intentional), customer/workshop/
  GST/collection/count/trend KPIs — all **MATCH**. One new defect:
  - **PH23-D3 (MEDIUM).** `part.salesCount` — a stored lifetime "units sold" counter —
    was maintained only by **Quick Sell**; the **invoice realization** (the primary
    billing flow) moved `stock` but not `salesCount`. So a part that only ever sells on
    invoices stayed at `salesCount === 0`, and the **Dead Stock** list, the **Total
    Dead Capital** KPI ("Locked in never-sold items") and the **Fast Mover** badge —
    which all classify on `salesCount` — reported invoice-sold bestsellers as
    never-sold dead capital. In the demo a clutch plate with 15 units / ₹39,508 of real
    ledger sales topped the Dead Stock list; "Dead Capital" ₹1,06,206 → ₹19,638 after
    the fix. Same class as PH23-01/D1/D2: source correct, a sibling write incomplete, a
    plausible number, the wrong business meaning. `computeInsights` "slow-moving stock"
    already read the `sales` ledger — the classification was the one place that didn't.
    Fixed by moving `salesCount` with `stock` in the three realization stock writes
    (`increment(-delta)`, symmetric and idempotent), reconciling the demo seed to the
    derived ledger, and bumping `DEMO_SCHEMA`. Live-verified in demo mode (seed
    reconciliation and the runtime path). Gates: `npm test` **144/144**
    (`analytics-integrity.test.cjs` 141 assertions — §17 reproduces the shipped writes
    + `isFastMover` + full demo reconciliation + 3 new mutations), `npm run test:rules`
    **2/2**, lint 0, build ✓. Production: **+24 / −4** across 2 files (~18 comment; 0
    new fn / file / abstraction / schema / rules change). Report:
    `docs/testing/PHASE_23_DEEP_3_REAUDIT_REPORT.md`.
- ~~**Phase 23 — authenticated production read-only spot-check.**~~ **ATTEMPTED 2×,
  BLOCKED — Phase 23 CLOSED at CONDITIONAL PASS.** The final step was to reconcile the
  four fixes (PH23-01/D1/D2/D3) against real production data. It could not run: the
  Claude execution environment's network-egress policy prevents loading the production
  app in any usable browser (Claude-in-Chrome never paired with the Code session;
  the sandboxed Browser pane blocks the app's ~1.5 MB main bundle with
  `net::ERR_FAILED` while `curl` gets 200 — confirmed 3 ways — so nothing past
  `/login` renders), and entering credentials is prohibited. **0 production records
  read, 0 modified, no mutation, no fabricated numbers.** A full BATCH 1–6 read-only
  checklist was handed to the user to run in their own authenticated browser (uses the
  existing `window.__txnCounts()` read-only debug hook + in-app navigation only); if
  they return that evidence the classification can be lifted to PASS without another
  audit pass. **DEEP-4 is not recommended** — the defect-class surface is exhausted
  and a code pass cannot substitute for a production reconciliation. No further
  analytics code changes without a new concrete defect. Report §"AUTHENTICATED
  PRODUCTION READ-ONLY SPOT-CHECK".
- ~~**Phase 24 — empty-state / cardinality / UI resilience.**~~ **DONE — PASS; 2 LOW
  fixed.** Swept every module, chart, table, KPI and dependency lookup at
  **0 / 1 / 2 / many** records + every transition + the shrink-while-viewing case.
  Prior phases (16 pagination, 21 malformed input, 23 analytics) had already hardened
  the surface — this pass confirmed it end-to-end (independent pagination oracle;
  deep finiteness scan of every analytics return at 0/1/2 — no `NaN`/`Infinity`/
  `undefined` reached any KPI; every chart path guarded by `Math.max(1,…)` / `total>0?`
  / `||1` / a `length<2` guard; `SearchSelect` dependency-empty verified with the
  walk-in / inline-create escape hatches). Two cosmetic pluralisation slips found and
  fixed:
  - **PH24-01 (LOW)** — `VehiclesModule` mobile card rendered "**1 visits**".
  - **PH24-02 (LOW)** — `CustomersModule` mobile card rendered "**1 bills**" (one
    token after a correctly-branched "1 vehicle").
  Both fixed by reusing the app's own `count === 1 ? singular : plural` idiom inside
  the existing `t(key, fallback)` i18n wrapper — **net 0 production lines**, 0 new
  functions/files/abstractions. NEW `tests/empty-state-integrity.test.cjs` (147
  assertions, independent oracles, 12 guard tripwires). Live-verified in demo mode
  (Dashboard/Analytics/Billing/Customers/Vehicles at scale + 2 filter→zero drills +
  the "1 visit" fix on page 4/14). Gates: `npm test` **145/145**, `npm run test:rules`
  **2/2**, lint 0, build ✓. No `firestore.rules` change. Follow-up: `RSpark`/`RDonut`/
  `RBars` dead-duplicate chart components **deleted** (`refactor(dashboard): remove
  dead chart components …`). INFO (not fixed): a `{n} parts`/`{n} items` label cluster
  in Suppliers doesn't singularise at 1.
  Report: `docs/testing/PHASE_24_EMPTY_STATE_INTEGRITY_REPORT.md`.
- ~~**Phase 25 — large-data / scalability / client-heavy behaviour.**~~ **DONE —
  DISCOVERY RESULT: PASS; 0 defects, 0 production code change.** Two-stage phase; Stage
  1 (measurement) only. Measured the shipped derived functions and the live demo at
  **100 / 500 / 1,000 / 5,000 / 10,000** records. Findings: every live listener is
  `limit()`-bounded (`repositories/firestoreRepository.js` — parts 2,000 / customers
  1,000 / invoices+jobCards 3,000 / sales 2,000 / …); pagination + search + filter are
  **client-side over that resident window** (not a server cursor — documented, not a
  bug); analytics Revenue/Cost/Profit/Margin come from the unbounded `salesRollups`
  aggregate so they stay complete. At 10,000 (demo, which loads everything) the worst
  cost is **one ~470–550 ms main-thread task** on load / a heavy tab-switch; production
  stays ~150–350 ms behind the `limit()`. **Every count / total / filter / top-N is
  correct against an independent oracle at every size, in Node and live** — no silent
  truncation, no missing/duplicate rows, no `NaN`, no console error, DOM bounded to the
  page size. The client-heavy characteristics (below) are deliberate, already
  roadmapped, and were recorded as INFO — not misclassified. NEW
  `tests/large-data-integrity.test.cjs` (118 assertions — fixtures at 5 sizes, shipped
  functions vs a hand oracle, page-completeness, architecture guards). `npm test`
  **146/146**. Report: `docs/testing/PHASE_25_LARGE_DATA_INTEGRITY_REPORT.md`.
- ~~**Phase 26 — offline / reconnect / offline-edit integrity.**~~ **DONE — one MEDIUM
  found + fixed.** Two-stage. Followed one user through ONLINE → OFFLINE → read → edit
  → RECONNECT. Established (SDK source + emulator `disableNetwork`/`enableNetwork`
  repro + source trace): persistence is `persistentLocalCache`; plain writes
  (`setDoc`/`updateDoc`/`addDoc`/`deleteDoc`) **queue in IndexedDB and replay**, their
  promise pending until server ack; `runTransaction` **cannot run offline** — the
  SDK is explicit ("Unlike transactions, write batches are persisted offline") and its
  `tx.get` rejects `UNAVAILABLE … client is offline`. Every financial/authoritative
  write is a transaction → **fails fast offline, keeps its opId, idempotent on retry**
  (marker-in-transaction) → no false success, no duplicate, no silent overwrite. Quick
  Sell has a bespoke durable `pendingSales/{opId}` intent + reconcile (Phase 8B). One
  gap:
  - **PH26-01 (MEDIUM).** The inline stock-stepper restock (`commitStock`, the `[+]`
    button) kept its **optimistic value** on an offline transaction failure and showed
    **no error** — its shared `catch` took the `offlineish` "an IndexedDB-queued write
    will replay" branch, but that path is a `runTransaction`, which is **not** persisted
    offline. So an offline restock silently reverted on the reconnect snapshot, or was
    lost with no trace if the tab closed first. Fixed: the catch now always rolls the
    optimistic value back and shows an accurate message ("You're offline — this restock
    wasn't saved…"), exactly as `adjustStockLine` / `receivePO` already do for the same
    failure class. **+19 / −7**, 1 file, 0 new fn/abstraction (reuses `isTxTimeout` /
    `timeoutMessage`). NEW `tests/offline-reconnect-integrity.test.cjs` (43 assertions —
    SDK-contract facts, the full offline-state matrix, an idempotent-replay model, and
    a before/after model of the `commitStock` catch). Gates: `npm test` **147/147**,
    `npm run test:rules` **2/2**, lint 0, build ✓. No `firestore.rules` change; 0
    production Firestore writes.
  Report: `docs/testing/PHASE_26_OFFLINE_RECONNECT_INTEGRITY_REPORT.md`.

- ~~**Phase 27 — browser compatibility / viewport / modal integrity.**~~ **DONE — one
  HIGH found + fixed.** Two-stage. Exercised the shell, modals, tables, charts and
  navigation across viewport widths, with phone-width full-screen forms as the
  priority target. **Browsers actually run: Chromium/Chrome 148 desktop (responsive
  resize 375–1920) + Chrome mobile device emulation (Android UA, touch, 375×667 /
  375×812).** NOT run: real Android Chrome, real iOS Safari, desktop Firefox, desktop
  Edge (Edge is engine-equivalent to the Chrome that was run; the others assessed from
  source only). Shell, tables (`overflow-x:auto` wrappers), charts (SVG `viewBox` +
  `ResizeObserver`), nav / z-index ladder, keyboard/focus trap: **PASS**. One defect:
  - **PH27-01 (HIGH).** The mobile (< 768 px) full-screen forms in
    `InventoryDashboard` — shared `MobileFormPage` (Receive / Adjust / Supplier) plus
    the `asPage` branches of `CheckoutModal` (Sell) and `PartModal` (Add/Edit Part) —
    rendered content in a `min-h-screen` block **in normal document flow**, assuming
    "the BODY scrolls natively". It doesn't: the shell pins
    `body { position:fixed; overflow:hidden; height:100dvh }` and these branches
    `return` before `<main id="app-scroll">`, so **nothing scrolls**. Any form taller
    than the viewport (short phone, keyboard open, long validation text, a banner) had
    its lower half — including required fields — clipped below the fold with no way to
    reach it. Confirmed live: **New Part on a 375×667 phone can't be created** — the
    required *Categories* field is unreachable so "Add Part" stays disabled. Fixed:
    all three wrappers now use the app's own established full-screen-form pattern
    (`h-[100dvh] flex flex-col overflow-hidden` + `flex-1 min-h-0 overflow-y-auto` body
    + `flex-shrink-0` header), identical to the Customers / Vehicles / Billing editors.
    **+42 / −17**, 1 file, 0 new component/abstraction (`MobileFormPage` fixed once,
    3 consumers inherit). NEW `tests/browser-viewport-integrity.test.cjs` (36
    assertions — a pure before/after scroll model, the shipped source patterns,
    cross-module parity, the render-path/breakpoint split, and no-regression on the
    app-shell-fixed invariants). Gates: `npm test` **148/148**, `npm run test:rules`
    **2/2**, lint 0, build ✓. No `firestore.rules` change; 0 production writes.
  Report: `docs/testing/PHASE_27_BROWSER_VIEWPORT_INTEGRITY_REPORT.md`.

- ~~**Phase 28 — double-navigation / stale-route / rapid-selection integrity.**~~ **DONE —
  three found + fixed (2 MEDIUM, 1 LOW).** Two-stage. Hunts "correct action → rapid
  nav/selection → an older async op resolves later → stale result overwrites current
  state". Architecture is mostly immune: list data is long-lived InventoryDashboard-
  level `onSnapshot`; selected record is a pure `useMemo(list.find(selId))` with NO
  per-selection fetch (rapid A→B→C→D → last click wins, verified live); search is
  `useDeferredValue` not a debounce; per-record listeners are `docId`-keyed with
  cleanup; modules unmount on tab switch. Rapid module switching, Back/Forward, and
  record selection all verified sound (live + model), 0 leaked timers/listeners over
  5×6 module cycles. Three defects:
  - **PH28-01 (MEDIUM).** `hooks/useEditLease.js` `acquire()` is async; a resolved-
    too-late acquire still installed `heldRef` + a renewing heartbeat → a record
    edit-locked with nobody editing it (false "🔒 …is editing"). It also let
    `CustomersModule.openCustomerEditor` and `JobCardModule.loadCard` (which commit the
    displayed record AFTER `await acquire`) open the WRONG record on out-of-order
    resolution. Fixed: a `wantRef` tracks the docId the consumer currently wants; a
    late acquire whose target changed hands the lease back and returns
    `{superseded:true}`; the two consumers `return` on `superseded`.
  - **PH28-02 (LOW).** The Part/Supplier/Checkout/Restock/Stock-Adjust modals render
    OUTSIDE the `activeTab === …` conditionals. Browser Back while one was open swapped
    the module behind it and moved the URL. Fixed: `onPop` keeps Back inert (snaps the
    hash back) while `blockingModalRef` is set.
  - **PH28-03 (MEDIUM).** The hashchange handler (`onPop`, Back/Forward) called
    `setActiveTabRaw` directly, bypassing the unsaved-changes confirm that a sidebar
    click (`setActiveTab`) enforces via `moduleDirtyRef`/`settingsDirtyRef`. Back out
    of a dirty editor discarded the edits with no prompt. Fixed: `onPop` runs the
    identical two `window.confirm`s and snaps the hash back on cancel.
  **+59 / −4 production (net +55), 4 files, 0 new component/dependency** — every guard
  reuses an existing pattern (`releaseLease`, the demo-blocked `replaceState` revert,
  `setActiveTab`'s confirms). NEW `tests/navigation-race-integrity.test.cjs` (36
  assertions — pure acquire/release + onPop + out-of-order models, before/after, plus
  shipped patterns and no-regression). PH28-04 (Next.js `Cancel rendering route`
  rejection noise on rapid Back/Forward — dev-overlay only, navigation always correct)
  documented as INFO, NOT fixed. Gates: `npm test` **149/149**, `npm run test:rules`
  **2/2**, lint 0, build ✓. No `firestore.rules` change; 0 production writes.
  Report: `docs/testing/PHASE_28_NAVIGATION_RACE_INTEGRITY_REPORT.md`.

## Scale — before large datasets

*(Phase 25 measured the current behaviour of these items — all still accurate; see the
report for the numbers.)*

- **Move part images out of Firestore.** Production part photos are stored as base64
  `imageString` inside each `parts` document, so every inventory read pulls the full
  image payload. Upload to Firebase Storage, store the download URL, migrate existing
  docs, keep `imageString` only as a legacy fallback.
- **Table virtualization.** Inventory/sales lists paginate (25/page) but do not
  virtualize; revisit past ~10k rows with `react-window` or TanStack Virtual.
- **Composite indexes.** `firestore.indexes.json` is empty and correct today (all live
  queries are single-field). When a compound `where + orderBy` is introduced, add the
  index Firestore's error links and `firebase deploy --only firestore:indexes`.
- **Server-side search.** In-memory ranking is sub-millisecond at current scale (Phase
  25: ~6–12 ms over a 10,000-row array); a hosted index (Algolia / Typesense), or at
  least wiring the repo's already-built `searchByPrefix` + a true-count indicator into
  the master-entity lists, becomes necessary as `customers` / `parts` grow past their
  live window (1,000 / 2,000) toward the stated 100k / 10k target — beyond the window
  the older records are currently unlisted, uncounted and unsearchable from the list.
- **`stats` / vehicle-analytics recompute per listener echo.** O(resident window):
  ~15 ms at the production `limit()`, ~470 ms at a demo-unbounded 10,000 (Phase 25).
  A `useMemo` narrowing or a web-worker offload is the lever if the window `limit()`s
  are ever raised.
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
