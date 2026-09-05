# Known Limitations — Balaji Auto OS v1.0.0

Honest disclosure of what is NOT covered by this release. None of these is a hidden
defect; each is a documented boundary.

## 🔴 Deployment security — required per environment (not code)

1. **The Firestore security rules must be published to the target Firebase project.**
   `firestore.rules` in the repo is the hardened, correct ruleset, but rules only take
   effect once deployed (`firebase deploy --only firestore:rules`). Until then the
   project runs whatever rules are live there — often permissive defaults under which
   any signed-in user can delete records. The UI role checks (`isAdmin` / `canManage`)
   are client guards, NOT a security boundary.
2. **The owner account must have a strong password.** The bootstrap owner
   (`BOOTSTRAP_ADMINS` in `context/AuthContext.js`) always has full access; a weak
   password on it is a full-data-takeover risk.

These are configuration, cannot be fixed in the codebase, and must be verified for every
deployment. *(The reference deployment — Firebase project `balaji-auto-os-7` — had the
repo ruleset published as of Phase 14. **Phase 15's `auditLog` create-rule change
(PH15-03, commit `7b5520c`) still needs a manual `firebase deploy --only
firestore:rules` / Console publish** — CI does not deploy rules; see the Phase 15
entry below and `docs/testing/PHASE_15_AUDIT_LOG_INTEGRITY_REPORT.md` §14. Until then
the live `auditLog` rule still allows a signed-in client to write an entry with a
forged `performedBy`.)*

**Phase 19 confirmed** the base ruleset IS live and enforcing on `balaji-auto-os-7` — an
unauthenticated Firestore REST read of `customers` returns `403 PERMISSION_DENIED`, so
`read: if signedIn()`, `delete: if isAdmin()`, `appSettings … if isAdmin()`,
`update: if false` on the ledgers, and the deny-by-default fallback are all published
(they predate Phase 15). Only the `firestore.rules` delta since the last recorded deploy
(`6bfb88d`) — i.e. the PH15-03 `auditLog` `performedBy == request.auth.uid` line at
`7b5520c` — is unpublished. The client already writes `performedBy = user.uid`, so the
deploy needs no code change:
```bash
npx firebase login
npx firebase deploy --only firestore:rules --project balaji-auto-os-7
```

## 🟢 Concurrency (multi-terminal safe for the covered workflows)

- **Cross-workflow data integrity IS concurrency-safe** (CONCURRENCY PHASE 3b —
  shipped, verified with two independent clients against the real emulator + on
  production). Three races found in the Phase 3 audit are closed:
  - *Concurrent payment collection* no longer double-runs invoice realization. The
    stock/ledger/audit cascade diffs against the payment **transaction's own server
    pre-image** (`collectInvoicePayment` / `deleteInvoice` in
    `components/InventoryDashboard.js`), not stale React state — so two cashiers both
    closing a balance at once still deduct stock and post revenue exactly once, on
    whichever payment actually crossed unpaid → Paid. Both payments are still kept.
  - *Concurrent purchase-order receive* (`services/purchaseOrderService.js` +
    `lib/poReceive.js`) runs inside a `runTransaction` that re-reads the PO and adds
    each delta to the **server's** current `receivedQty` — 4 + 3 lands as 7, not
    last-writer-wins 3. Over-receipt past the ordered quantity is now rejected
    server-side as a whole (no partial stock move); the client-side cap was never
    authoritative across terminals.
  - *Concurrent secondary customer writes* (add note, add vehicle, star default,
    totals write-back) persist **only the changed fields**, and id-keyed arrays
    (`vehicles`, `noteEntries`) are replayed onto the server's current array inside a
    transaction (`store.syncAll` → `repo.applySecondaryMerge`,
    `lib/concurrency.js` `replayIdArray`). A note added from the detail panel while
    the wizard is open is no longer dropped by the wizard's save, and vice versa.
  - Residual, low severity: two workflows that concurrently append to a customer's
    `history[]` or replace the same `documents[]` entry are still last-writer-wins on
    that one field (the real audit trail is the `auditLog` collection); two clients
    editing the **same** vehicle sub-object at once is element-level last-writer-wins.
- **Invoice numbering IS concurrency-safe** (CONCURRENCY PHASE 2 — shipped, rules
  published, production-verified with 1/2/3 concurrent clients). The `INV-`/`EST-`
  serial is allocated at save time by a Firestore transaction on `counters/invoices` /
  `counters/estimates` (`lib/docCounter.js`) — two terminals billing in the same moment
  get distinct, sequential numbers. A new invoice no longer previews a number; the
  editor says *"number assigned on save"*. Drafts (`DRF-`) stay client-side (a
  throwaway handle, never a GST serial, and a unique doc id means a clash loses no
  data). Behaviour notes:
  - Creating a new invoice now **requires connectivity** (same as editing an invoice or
    collecting a payment, which were already transactional). On failure the editor stays
    open with nothing lost.
  - If a save fails *after* the number is allocated, that number is **skipped** (a gap)
    — legal under GST Rule 46(b), and far preferable to a duplicate.
  - The counter only moves forward. To reset it (e.g. after test invoices), delete the
    `counters/invoices` document in the Firebase Console — it re-seeds from
    `max(existing) + 1` on the next save. Clients cannot lower it (`allow delete: if
    false`, `next >= resource.data.next`).
- **Raw stock quantities** were already race-safe (atomic `increment()` on every
  path — quick-sell also re-reads inside a transaction and refuses to go negative).
  Negative / over-received stock is deliberately recorded as the truth, not clamped.
- **Duplicate business actions ARE idempotent** (CONCURRENCY PHASE 4b — shipped,
  emulator + production verified). Every retryable money/stock write now carries a
  stable **operation id** that its Firestore transaction reads *before* any write, so
  one logical intent delivered any number of times (double-click, retry after an
  ambiguous response, lost server ack, transaction-callback replay) produces exactly
  **one** business effect, while a genuinely separate second action (new id) still
  goes through. Covered: collect payment (`payments[].id`), PO receive
  (`purchaseOrders.appliedReceiptIds`), quick-sell / stock-out (`sales/{opId}` — the
  whole sale is now one transaction: stock + ledger row + monthly rollup), manual
  stock adjustment (`stockAdjustments/{opId}`), ad-hoc restock (`restocks/{opId}`),
  create PO / create supplier (client-stable doc id via `setDoc(..., {merge:true})`),
  new job-card stock reservation. `lib/opId.js` documents the contract.
- **Refresh / reload during a workflow is now recoverable** (CONCURRENCY PHASE 5b —
  shipped, emulator + production verified). The Phase 4b operation id now lives in
  **`sessionStorage`** (`lib/durableOpId`, `hooks/useDurableOpId`), keyed by
  workflow + record, so it **survives a browser refresh of the tab**. The sequence
  *transaction commits server-side → the ack is lost to a refresh → the user
  reloads and retries* now recovers the same id and the existing backend markers
  make it a no-op — one business effect, not two. Covered: payment
  (`payment:<invoiceId>`), PO receive (`receive:<poId>`), quick sell
  (`sell:<partId>`), stock adjust (`adjust:<partId>`), ad-hoc restock
  (`restock:<partId>`), bulk adjust/receive (per-part), create PO / supplier / part
  (`create-po` / `create-supplier` / `create-part`), and the job-card reservation
  (`jc-reserve:<jobNo>` + a per-part `appliedReserveIds` marker so `reserved`
  increments exactly once across a reload). The id is cleared on a *confirmed*
  result (success, or a business rejection that definitely did not commit); an
  *ambiguous* failure keeps it, and the affected modal shows a "check the record
  before retrying" notice. The **invoice new-form draft** now uses one static
  localStorage key (`maruti_invoice_draft_v2_*`) that survives a refresh and
  carries the invoice's client id, with a Restore/Discard banner like every other
  create form; `persistInvoice` reuses an already-allocated number on a retry, and
  a near-identical recent walk-in invoice prompts for confirmation.
  Residual, low severity:
  - The operation id lives in `sessionStorage`, so it does not survive the tab
    being **closed** (as opposed to refreshed), a different browser, or private
    mode with storage blocked. In those cases a retry is a new intent; if the
    first attempt committed the record still shows it (no silent corruption).
  - Invoice numbering (PHASE 2): a save that fails **after** the `counters/`
    transaction allocated a number *and* whose invoice document is never written
    (e.g. browser data cleared before the queued write replays) still skips that
    number — a gap, legal under GST Rule 46(b). A retry that recovers the draft
    reuses the same number.
  - A duplicate delivery may still write a second **audit-log** line for the same
    action (the `auditLog` collection is append-only and advisory); the business
    records themselves are single-effect. The `commitStock` inline-stepper
    "quick restock" ledger row is now a deterministic-id `setDoc` (one row per
    target level); its advisory audit line can still duplicate.
- **Network interruption (not just refresh) is now bounded and consistently
  surfaced** (CONCURRENCY PHASE 6b — shipped, emulator-verified).
  Discovery (Phase 6) found the durable-opId architecture above was already
  connectivity-cause-agnostic — a lost response from a network drop and one
  from a refresh land in the exact same recovery path — and found no
  CRITICAL/HIGH gap, only three UX ones, now closed:
  - **Bounded transaction wait.** Every `runTransaction` call in the app (13
    sites: guarded entity edits, id-array merge, payment, PO receive, quick
    sell, stock adjust, restock, invoice delete, invoice numbering, job-card
    reservation, edit-lease acquire/renew/release) is wrapped in
    `lib/txTimeout.js`'s `withTimeout(promise, ms, label)`. This does **not**
    cancel the transaction — Firestore has no such API, and a client-side
    "cancel" could never undo a commit that already reached the server — it
    only bounds how long the UI waits (12s for business mutations, 6s for the
    UX-only edit lease). On a "black hole" network with no explicit socket
    error, the modal now surfaces "connection is taking longer than
    expected... check before retrying" instead of an unbounded spinner, and
    the durable operation id is **kept**, not cleared, exactly like any other
    ambiguous failure — a subsequent retry (immediate or after a reload) is
    always safe.
  - **Non-blocking offline heads-up.** `warnIfOffline(thing)` shows a soft,
    dismissable warning (reusing the existing amber `notify.warning`) before
    a transaction-backed mutation is attempted while `navigator.onLine` is
    false. It never blocks the attempt or disables anything — `navigator.
    onLine` is a browser hint, not proof Firestore is reachable (a captive
    portal reports "online" while nothing real is reachable), so a hard block
    would create false negatives. The existing Sidebar connectivity chip
    (fed by the same `online` flag) is unchanged and reused, not replaced.
  - **Cross-collection UI consistency during an outage.** The `parts`/
    inventory `onSnapshot` listener now gates its state update on
    `!hasPendingWrites`, matching the `jobCards`/`customers`/`invoices`
    listeners (previously the odd one out) — so a second tab/device can no
    longer show a stock decrement from a not-yet-visible invoice during an
    active outage. Per-device optimistic updates (the immediate `setInventory`
    call every mutation handler already makes) are untouched.
  - Also fixed in the same pass: the customer/invoice/job-card **guarded-edit**
    save paths used to show **no toast at all** on a non-concurrency (ambiguous
    or timed-out) failure — the code's own comment claimed a toast already
    fired elsewhere; it never did. All four (customer/invoice/job-card/part)
    now show accurate, retry-safe copy.
  Residual: `navigator.onLine` remains a best-effort signal only (by design);
  a genuinely reachable-looking connection that is actually a dead captive
  portal still surfaces as a timeout on the first attempted write, not as an
  upfront warning. Queued (non-transactional) writes — every entity *create*,
  the invoice document itself, archive/restore, the audit log — intentionally
  received **no** timeout: they are designed to sit in the IndexedDB queue and
  send whenever connectivity returns, so bounding their wait would misreport
  "still queued, will send" as "failed."

- **Browser / tab lifecycle integrity is now hardened** (CONCURRENCY PHASE 7b —
  shipped, emulator + automated + production verified). Phase 7's discovery pass
  found three gaps in how tab duplication, edit leases, and in-app navigation
  interact with the durable-operation-id and single-editor architecture above; all
  three are closed:
  - **Tab duplication can no longer cause a genuinely new action to be silently
    swallowed as a duplicate.** Chrome/Edge/Firefox's "Duplicate tab" (and "reopen
    closed tab") clones `sessionStorage` into the new browsing context per the HTML
    Living Standard — including the Phase 5b durable operation id — but never
    clones `window.name`, which resets to empty in any new top-level browsing
    context. `lib/durableOpId.js` now tags every stored operation id with a
    page-instance id derived from `window.name`; an id copied in by tab
    duplication carries the *original* tab's page-instance tag, so a duplicated
    tab reusing that id for a genuinely different action is detected and a fresh
    id is minted instead. A same-tab refresh (where `window.name` persists) still
    correctly reuses the same id, so the Phase 5b/6b refresh-safety guarantee is
    fully preserved — this is strictly additive, not a replacement.
  - **The edit-lease Firestore rules now enforce session identity, not just uid.**
    Previously `editLocks`' rules let any write from the *same signed-in user*
    overwrite or delete an ACTIVE lease purely on uid match, even one held by that
    same user's other, still-open tab — a raw client bypassing
    `lib/editLease.js`'s own (already session-aware) transaction could exploit
    this. The rules now require the lease's `sessionId` to match too for any write
    against a still-active lease; only an already-**expired** lease may be taken
    over without matching the previous session. Firestore's `delete` operation
    carries no payload for rules to check an identity against, so releasing an
    active lease is now done via a session-scoped **update** (backdating
    `expiresAt` into the past) rather than a delete; `delete` itself is now
    restricted to already-expired documents only, for anyone.
  - **Switching app tabs while editing no longer silently discards unsaved
    changes**, for every entity editor (previously only Settings had this
    protection). Customer, Part, Supplier, Job Card, and Invoice editors now all
    report their own dirty state to the dashboard via an `onDirtyChange` prop; an
    in-app tab switch away from a dirty editor prompts to confirm before
    discarding, exactly like Settings already did. The prompt only fires on an
    actual real, unsaved change (never merely "an editor is open") and never
    outlives the editor that raised it — every wired editor resets the flag on its
    own unmount, whether that unmount was triggered by a successful save or a
    cancel/discard.
  Residual, low severity / by design:
  - A literal "duplicate this exact tab" browser action could not be triggered
    through this session's own automation tooling; the fix is verified by (a) a
    pure-model simulation of the exact `window.name` + `sessionStorage` algorithm
    against the documented HTML Living Standard clone semantics, and (b) live
    production verification of both halves independently (a value written to
    `window.name` survives a same-tab reload; a genuinely new browser tab starts
    with an empty `window.name`). It has not been re-verified against every
    browser engine — Chromium-family behavior is what was checked live; Firefox
    and Safari are expected (per spec) to behave identically but were not
    independently confirmed this session.
  - The edit-lease rules fix only affects `editLocks`, a UX-only coordination
    collection — no change to any business-data collection's rules.
  - The dirty-state guard covers in-app tab switches (the gap this phase closes).
    A hard refresh/close while an editor is dirty is unchanged and already
    covered separately by each editor's own `beforeunload` handler.

- **Business-critical writes are now transactionally atomic with their required
  effects, not fire-and-forget** (CONCURRENCY PHASE 8b — shipped, automated +
  emulator + production verified). Phase 8's discovery pass found that invoice
  realization (the single highest-value workflow in the app) committed its
  stock, sales-ledger, and monthly-rollup effects as separate, un-awaited
  writes — an invoice could show **Paid** (or be deleted) while those effects
  silently never landed, and a brand-new invoice could even realize stock/sales
  *before* the invoice document itself existed. All confirmed defects are
  closed:
  - **Invoice create/edit/payment/delete are now single atomic transactions**
    (`createInvoiceTransactional` / `editInvoiceTransactional` /
    `collectInvoicePayment` / `deleteInvoiceTransactional` in
    `components/InventoryDashboard.js`). A shared pure planner
    (`planInvoiceRealization`) computes the stock/sales/rollup delta between
    the invoice's old and new state exactly as before (still diff-based, still
    idempotent — saving the same paid invoice twice is still a zero-effect
    no-op), but the write now happens *inside* the same transaction as the
    invoice document itself via `applyRealizationPlanInTx`. The Phase 1a `_rev`
    guard and Phase 3b/4b idempotency markers are unchanged. A new invoice's
    number allocation (Phase 2, its own necessary separate transaction on
    `counters/<sequence>`) still runs first; a failure between allocation and
    the (now atomic) invoice transaction still costs the pre-existing,
    documented skipped-number gap under GST Rule 46(b) — that gap is
    unchanged and is not a financial-consistency defect, since the invoice
    transaction itself can no longer partially apply.
  - **Customer totals and vehicle history remain intentionally outside the
    invoice transaction** (they are derived, non-authoritative data, and
    folding a full customer-totals recompute into every invoice's transaction
    would add cross-document lock contention for no correctness benefit) —
    but they are now genuinely **awaited** by every caller instead of an
    unhandled promise rejection, and vehicle history is now idempotent (a
    retry of the same invoice's "became Paid" transition is a no-op instead of
    double-counting `totalSpend`/`serviceCount`). A failure here is reported
    with an honest, distinct toast ("Invoice saved. Customer totals or vehicle
    history may take a moment to refresh.") — it never claims the whole save
    failed, and it always self-heals on the customer's next invoice.
  - **A multi-part Job Card reservation is now atomic across every part on the
    card**, not one independent transaction per part. `applyReserveDelta`
    reads every affected part first, then writes every part inside a single
    transaction — a card reserving 3 parts can no longer end with 2 committed
    and 1 not.
  - **Bulk operations spanning more than 500 writes** (the capacity-cleanup
    wizard) now report exactly how many records completed before a mid-run
    failure (`BatchPartialFailureError.completedCount`/`totalCount`) instead of
    an always-inaccurate "no records were deleted/archived." Firestore has no
    primitive for atomicity across more than 500 writes in one call — this was
    not "fixed" by forcing a giant transaction (impossible), but by making a
    partial result honestly visible and safely resumable: every underlying
    write (delete, archive-flag update) is idempotent, so re-running the same
    cleanup after a partial failure always converges without double-applying
    or losing anything.
  - **Offline Quick Sell no longer uses a weaker write model than online Quick
    Sell.** A Firestore transaction cannot run at all while genuinely offline
    (it requires a live round trip), so the previous offline path fell back to
    3 independent fire-and-forget writes. It now persists exactly ONE durable
    `pendingSales/{opId}` document (a single-document write is atomic by
    definition, online or offline, and is scoped by rules to its own creator)
    and a reconciliation effect applies it through the *exact same* atomic
    transaction as a live online sale once connectivity returns, then deletes
    the pending record.
  - **The quick-restock ledger row** (the inline stock-table stepper) now
    commits atomically with its stock change, closing the one authoritative
    business-ledger write the Phase 8 audit found was still a bare
    `.catch(console.error)` outside the invoice cascade.
  Residual, by design (not defects):
  - `store.syncAll`'s multi-document diff (used for bulk customer/job-card/etc.
    edits) remains an **independent batch**, not one transaction spanning every
    document — documented explicitly as such. Unrelated documents (e.g. a bulk
    archive touching many different customers) are not forced into one
    transaction purely for the sake of atomicity; every write in it is
    naturally idempotent, so a partial failure is always safely resumable by
    re-invoking the same diff.
  - The supplier-edit cascade to linked parts (`persistSupplierEdit`) remains
    an independent, best-effort sync — it is **derived, denormalized display
    data** (a copy of the supplier's own name/phone, never read as financial or
    stock truth), not folded into one transaction with every linked part. The
    primary supplier write is now awaited and gates the success toast; a
    partial cascade failure is now counted and reported instead of silently
    absorbed.
  - Reorder-request writes remain fire-and-forget by design — internal
    workflow tracking with no financial or stock effect read anywhere else in
    the app.
  - The audit log remains uniformly advisory/fire-and-forget across the whole
    app, unchanged — every audit write happens after its business effect has
    already been confirmed, so an audit failure can never retroactively cause
    a false business-failure claim.

- **Deleting a Part no longer breaks an invoice or Purchase Order that still
  references it** (PHASE 9 — orphan-record audit, shipped and
  production-verified; see `docs/testing/PHASE_9_ORPHAN_RECORD_REPORT.md`).
  Parts can be permanently hard-deleted at any time with no dependency check
  ("past sales and analytics history are kept" by design) — but the invoice
  realization transaction and PO-receive transaction both used to call
  `tx.update()` unconditionally on the part's stock document for every line
  that touched it. Firestore throws "No document to update" against a
  missing doc, which aborted the WHOLE transaction: a paid invoice
  referencing a since-deleted part could never be edited, paid, or deleted
  again, and receiving a multi-line PO where just one line's part had been
  deleted blocked receiving of every OTHER line on that same PO too. Both are
  fixed the same way — `resolveExistingPartIds` (invoice side) and an
  equivalent inline read (`poReceiveDoc`) resolve, via reads that run before
  any write in the same transaction, which of the touched parts still exist;
  a delta for a part that's gone is silently skipped (there is no stock
  document left to adjust) while every other effect — the invoice's own
  financial fields, the sales-ledger row, the salesRollups delta, the PO's
  own `receivedQty`, and the restock-ledger entry — commits exactly as
  before. No resurrection risk: every relationship audited (Customer→Job
  Card/Invoice, Supplier→Purchase Order, Vehicle→Job Card) already stores a
  denormalized snapshot rather than a live-only pointer, and the two
  customer-derived-data writers (`syncCustomerTotals`, `touchVehicleHistory`)
  only ever `.map()` the existing customers array, so they can never create
  an entry for a deleted id.
  Residual, by design (not defects):
  - `BillingModule`'s pre-flight stock-availability check silently skips
    validation for a billed line whose `partId` no longer resolves in
    `inventory` (`if (!part) return;`) — pre-existing, low-severity, and now
    the *correct* counterpart to the transaction-side fix: there is no
    catalog stock left to check a quantity against, so no availability error
    is meaningful for that line.

- **Job Card numbers and job-card-first invoicing no longer risk pointing at
  the wrong entity** (PHASE 10 — referential-integrity audit, shipped and
  production-verified; see `docs/testing/PHASE_10_REFERENTIAL_INTEGRITY_REPORT.md`).
  `jobNo` is both the Job Card's own document id and the only field an
  Invoice uses to find its source job card (a string match, not a doc-id
  reference) — deleting the highest-numbered job card used to free that
  number for reuse by an unrelated new one, silently redirecting an old
  invoice's "View Job Card" link. Fixed by folding `invoices` into every
  number-generation and manual-entry-validation call so a number already
  referenced by any invoice is never reissued. Separately, linking an
  existing Job Card onto a job-card-first invoice now tries the job card's
  own `customerId` before falling back to phone/name matching — a shared
  name or a since-changed phone number could otherwise silently attach the
  invoice to the wrong customer. Two vehicle "quick add" shortcuts
  (mid-invoice, mid-job-card) now also check every customer's vehicles for a
  registration-number collision first, matching the uniqueness check the
  main Vehicles wizard already enforced.
  Residual, by design (not defects):
  - Job Cards store vehicle details as plain strings (`regNo`/`make`/`model`),
    never a vehicle id — there is no vehicle *relationship* to validate for
    Job Cards, only free-text fields a staff member can mistype (a
    data-entry question, not a referential-integrity one).
  - A customer-first invoice that separately opens an already-billed job
    card's invoice (`existingInv`/`onOpenInvoice`) never re-resolves an
    owner at all, so it carries none of PH10-02's risk.

- **Refund/Return no longer double-restores stock, and a concurrent
  invoice-edit + payment race can no longer commit an overpaid, mislabeled
  invoice** (PHASE 11 — financial integrity audit, shipped and verified; see
  `docs/testing/PHASE_11_FINANCIAL_INTEGRITY_REPORT.md`). `changeStatus`'s
  Refund/Return path called a second, non-transactional `onRestoreStock`
  callback that unconditionally re-added an invoice's line quantities to
  stock — redundant (and double-counting) whenever the atomic
  `editInvoiceTransactional` realization diff had already correctly reversed
  a Paid invoice, and outright wrong (inventing stock) when returning an
  invoice that was never realized in the first place. Removed entirely — the
  atomic transaction was already the correct, sufficient reversal. Separately,
  `invStatus` (the function that determines the `status` field
  `collectInvoicePayment` actually persists) was missing the overpayment
  guard `deriveStatus` already had, and the payment transaction never
  re-validated a payment against its own fresh read — so a client editing an
  invoice's total down while another client pays against the old (higher)
  balance could interleave into a genuinely overpaid, "Paid"-mislabeled
  Firestore document. Both closed: `invStatus` gained the same guard as
  `deriveStatus`, and the payment transaction now rejects
  (`conc/overpaid`, before any write) whenever the incoming payment would
  overpay the invoice's own freshly-read total.
  Residual, by design (not a defect):
  - `deriveStatus`'s "nothing paid yet" label is `"Unpaid"`; `invStatus`'s
    equivalent branch is `"Pending"` — a display-string-only difference
    (every underlying money value is identical on both paths). A Sales/
    Billing/GST report export can show "Pending" for an invoice Billing's
    own screen calls "Unpaid". Documented, LOW severity, left unchanged — a
    wording choice, not a money-correctness defect.

- **Editing a Part's unrelated fields can no longer silently revert its
  stock to a stale value** (PHASE 12 — inventory accounting integrity audit,
  shipped and verified; see `docs/testing/PHASE_12_INVENTORY_ACCOUNTING_REPORT.md`).
  The shared Part create/edit payload included a bare `stock` field, so
  saving an Edit Part change (name, category, price...) merge-wrote whatever
  stock value the form loaded when the editor was OPENED back onto the
  document — silently undoing any real Quick Sell/Restock/Adjustment/PO
  receipt/invoice realization that landed while the editor stayed open,
  since none of those atomic stock-only transactions bump a Part's `_rev`
  (the Phase 1a guarded-edit conflict check therefore never saw a conflict).
  Fixed by removing the one regressed line from the shared payload — the
  object's own adjacent comment already documented "stock & salesCount are
  not in `payload`" as the intended invariant; `salesCount` correctly
  honored it the whole time, only `stock` had drifted back in. The CREATE
  path is unaffected (it already sets `stock` explicitly and independently
  — a new part's legitimate opening value).
  Residual, by design (not a defect):
  - Quick Sell/invoice realization intentionally allow negative stock (a
    sale already happened; clamping would invent inventory on reversal).
    Stock Adjustment's "reduce" direction intentionally clamps at 0 (a
    physical-count correction can't remove more than is on record). Both
    are internally consistent with their own real-world purpose — this is
    not a contradiction to resolve.

- **Editing a Supplier's other details can no longer silently revert a
  name/phone correction made from the Part modal** (PHASE 13 —
  authoritative-field stale-snapshot audit, shipped and verified; see
  `docs/testing/PHASE_13_AUTHORITATIVE_FIELD_INTEGRITY_REPORT.md`).
  `persistSupplierEdit` (a quick name/phone fix reachable from inside the
  Part modal) wrote those fields via a plain `updateDoc` that never bumped
  `_rev`, so the full Supplier edit wizard's own `_rev` guard had no way to
  detect that quick edit — a wizard left open across it would silently
  overwrite the correction with its own stale snapshot on save. Fixed by
  adding `_rev: increment(1)` to that `updateDoc` call, the same protection
  `collectInvoicePayment` already uses for Invoice's payment fields. A
  systematic sweep of every other multi-writer authoritative field in the
  app (Customer's derived totals/notes/documents and `vehicles[]`,
  Invoice's payments/paid/balance/status, Part's stock/salesCount/reserved,
  Job Card's fields) found each one already correctly protected — no
  further fix required.

- **A dead, latent duplicate-ledger-write hazard was removed** (PHASE 14 —
  ledger / business-event integrity audit, shipped and verified; see
  `docs/testing/PHASE_14_LEDGER_INTEGRITY_REPORT.md`). No active defect was
  found: every authoritative money/stock ledger write (invoice realization,
  payment, Quick Sell, PO receive, Stock Adjustment, manual restock, Job
  Card reservation) already commits atomically with its state change and
  is correctly keyed for idempotency. `recordInvoiceSalesDelta` — the
  pre-Phase-8B invoice ledger writer, reached today only from the
  demo-only `runInvoiceRealizationDemo` — still carried unreachable
  production-mode branches from before that split (a dead `addDoc` to
  `sales`, a dead `setDoc` to `salesRollups`). Neither had ever executed,
  but either would have become a live second, non-transactional,
  non-idempotent writer for the same invoice event
  createInvoiceTransactional/editInvoiceTransactional already commit
  atomically, had a future refactor ever called this function outside demo
  mode. Removed as preventative hardening. Documented, not fixed: an
  offline Quick Sell's audit-log entry can predate its sale actually
  committing (advisory-only, consistent with this app's audit design
  everywhere else); `reorderRequests` has a narrow double-click gap with no
  durable opId (non-authoritative, non-financial, LOW/INFO).

- **Customer/Vehicle/Invoice history entries no longer misattribute every
  production action to a hardcoded placeholder actor** (PHASE 15 —
  audit-log integrity audit, shipped and verified; see
  `docs/testing/PHASE_15_AUDIT_LOG_INTEGRITY_REPORT.md`). The shared,
  authoritative `auditLog` (via `pushAudit`/`writeAudit`) always correctly
  recorded the real signed-in user. A separate, user-visible mechanism —
  each record's own embedded `history[]`/`noteEntries[]`/`notesLog[]`,
  shown in its own detail view — did not: it hardcoded `'Admin'`, `'You'`,
  or `'Staff'` for every production entry regardless of who actually
  performed the action, at 8 call sites across
  `CustomersModule.jsx`/`VehiclesModule.jsx`/`BillingModule.jsx`. Fixed by
  reusing `capacityActorEmail`/`actorEmail` — already computed and already
  passed into 6+ other components for this exact purpose — at all 8 sites.
  Also fixed: a partial/non-final payment was audited as the generic
  "Invoice Updated" instead of its own "Payment Received" action; and
  `auditLog`'s Firestore `create` rule did not enforce that a written
  entry's `performedBy` actually matched the writer's own uid, so a
  malicious or buggy client could in principle forge an entry attributed
  to a different user (tightened to require self-attribution, mirroring
  `pendingSales`' existing rule — **this rules change still needs a
  manual `firebase deploy --only firestore:rules` / Console publish to
  take effect in production**, the same as this program's earlier
  concurrency-phase rules changes). Documented, not changed: Job Card's
  own `statusLog`/`notesLog` attribute `by` to the case's assigned advisor
  rather than the logged-in user — a genuine business-domain field, not a
  bare placeholder, left alone absent evidence it's unintentional; Job
  Card's `jobNo`-as-document-id could in principle be reissued to a
  different card after a hard delete (a numbering characteristic, not an
  audit-helper defect — fixing it is Phase-10-scale work, out of this
  phase's scope).

- **A paginated list can no longer strand you on an empty page when its
  data shrinks live** (PHASE 16 — search/filter/sort/pagination
  consistency audit, shipped and verified; see
  `docs/testing/PHASE_16_SEARCH_FILTER_PAGINATION_REPORT.md`). Search,
  filter, sort and combined-filter behaviour were already correct — every
  list is a pure derivation of the single listener-fed source array, keyed
  by document id, self-healing on any live create/edit/delete/concurrent
  change. One defect (PH16-01, MEDIUM): the pagination *page index* was not
  clamped when a list shrank without a filter change (a delete, an
  archive/restore, a status change moving a record off the current filter
  tab, or a concurrent client's write), so the row slice went out of range
  and showed an empty page while the pager read `"3 / 2"` — or the custom
  pagers hid entirely. Fixed in the shared `<Pagination>` component (one
  clamp effect, covers Purchase Orders / Archive / Reports / Stock
  timeline) plus one-line effects for the Suppliers and Alerts custom
  pagers. `LedgerPage`'s pager still uses `page === pages` boundary guards
  and a raw-`page` slice — **left unchanged, not a live bug**: its data
  (Sales / Services / Stock In / Stock Out) is append-only and its
  `setPage(1)` effect fires on every real shrink vector (date range, type,
  sort, per-page, custom dates), so a shrink without a filter change is
  unreachable there. View-state persistence differs by module (in-memory
  cache for Customers/Vehicles/Suppliers, reset-on-mount for
  Billing/POs/Archive/Alerts) — deliberate and internally consistent, not
  unified.

- **A cancelled purchase order can no longer be received against**
  (PHASE 17 — state-machine / lifecycle integrity audit, shipped and
  verified; see `docs/testing/PHASE_17_STATE_MACHINE_INTEGRITY_REPORT.md`).
  The invoice state machine (derived status that can't be forged + three
  explicit terminal overrides that stick + one diff-based
  realization/reversal engine + `conc/deleted` guards against
  resurrection) and the Job Card lifecycle (soft UI stage ordering,
  order-independent idempotent reservation math) are sound. One HIGH
  defect (PH17-01): a **cancelled** PO — a terminal state — could be
  received against through a concurrent-cancel race (Client A opens the
  Receive form on a `sent` PO, Client B cancels it, Client A submits),
  because the receive path had no cancelled-status check at any layer —
  the transaction would un-cancel the PO, add phantom stock, and write a
  `restocks` ledger row for an order that was called off. Fixed at the
  mutation boundary (`applyPoReceive` → `blocked:'cancelled'`,
  `poReceiveDoc` throws `po/cancelled` on the re-read status, plus a
  client guard for the demo path). **Documented, not fixed** (narrow
  races, no stock/money side effect — only a misleading PO status label):
  `poAdvanceDoc` is a blind `updateDoc` so a concurrent cancel could be
  reverted by an advance-workflow click; `cancelPO`'s
  received-quantity guard reads the client snapshot, not a fresh server
  read, so a concurrent receive-then-cancel could label a PO `cancelled`
  while it holds received stock (the stock and the `restocks` row remain
  correct and immutable). PO `received → delete` (admin-only) does not
  reverse the stock-in — intentional (the goods arrived; the ledger row
  is the permanent record). Business-state transitions are enforced in
  the transaction layer, not Firestore rules — deliberate.

- **Authorization is enforced at the Firestore-rules layer, not just the UI**
  (PHASE 19 — audited, no code change; see
  `docs/testing/PHASE_19_AUTHORIZATION_MATRIX_REPORT.md`). Full Owner / Admin /
  Staff / Unauthenticated matrix (24 privileged actions) verified across UI,
  mutation, and `firestore.rules`. Every destructive/privileged op (hard delete,
  role management incl. the `staff` perms sub-object, ledger immutability,
  recovery data, auditLog actor, counter monotonicity, edit-lease identity,
  per-user pending sales, deny-by-default) is authoritative at Firestore —
  **148 live emulator assertions**. No CRITICAL/HIGH, no direct-Firestore
  bypass, no role-escalation path, no IDOR issue, no alternate-workflow bypass.
  Accepted findings, all LOW/INFO — the security boundary is correct in every
  case: (1) a Staff member's `perms.deletes` toggle grants only the *soft*
  archive/restore UI — a **hard** delete still hits `delete: if isAdmin()` and
  fails (the correct outcome; honouring the toggle would mean weakening the
  rule); (2) the inline supplier quick-create on a Part is reachable by any
  authenticated user while the Suppliers *module* is admin-only (non-destructive;
  `suppliers create: if signedIn()` intentionally allows it); (3) dead
  `demoGuard()` function (the real demo write-protection is elsewhere and
  thorough); (4) `salesRollups` update is `signedIn` not `false` — it is a
  derived running aggregate, recomputable from the immutable `sales` ledger;
  (5) STAFF is read-only in the UI for customers/invoices/job-cards/billing/
  suppliers (the safe direction — UI stricter than rules); (6) OWNER ≡ ADMIN at
  runtime with no ownership-transfer mechanism (by design); (7) single-shop
  shared data — every authenticated user reads/writes all shop records — is
  intentional, not a hole.

- **Validation is enforced where the data is written, with two accepted
  exceptions** (PHASE 18 — audited, one MEDIUM defect fixed; see
  `docs/testing/PHASE_18_VALIDATION_BYPASS_INTEGRITY_REPORT.md`). Business
  rules (phone/GST/SKU/reg uniqueness, price/qty non-negativity, invoice
  overpayment, PO cancelled-receive, forged invoice status) are enforced at
  the layer this client-only architecture allows — pure clamps/derived
  functions run by both demo and production, transactions for money/stock/
  numbering, Firestore rules for the security subset — and every creation
  path was checked for consistency. PH18-01 (MEDIUM, fixed): the inline
  "+ New Customer" on an invoice skipped the phone/GST uniqueness the
  Customers wizard enforces, so a walk-in could be saved as a duplicate
  customer record (same bug class as PH10-03). **Documented, not fixed:**
  (1) `billingService.invoiceStatus` reads an *overpaid* invoice as "Paid"
  because `balance` floors to 0 — reachable only if the three write-path
  overpayment guards are all bypassed, and realizing an overpaid sale is
  arguably correct anyway; (2) customer-phone and vehicle-registration
  uniqueness are client-list scans, not transactional — a sub-second
  two-terminal race creating the *same* new record on both can still slip a
  duplicate through (single-shop, the duplicate is visible and deletable,
  no money/stock/ledger invariant is touched; contrast invoice numbering
  and PO receive, which *are* closed at the transaction layer).

## 🟡 Performance (fine at current scale)

- The main dashboard is one large component; a keystroke re-renders it. This is made
  INTERRUPTIBLE via `useDeferredValue` (typing never blocks) but is not cheap. Splitting
  the container is a post-1.0 refactor.
- No table virtualisation. Pagination (25/page) keeps this a non-issue today; revisit
  past ~10,000 rows with a raised page size.

## Verification ceiling — browser-only, unverified here

All automated verification runs in Node/jsdom. The following require a real browser and
have NOT been measured:

- Actual rendering and pixel layout across desktop/tablet/mobile/large-monitor.
- Live Firestore round-trips and offline recovery.
- Print / PDF visual output.
- Lighthouse metrics: FCP, LCP, TBT, CLS, and category scores.
- The "feel" of the login boot sequence timing.

The code is built to pass these (transform/opacity-only animation, reserved image
dimensions, labelled controls, tiny bundle), but confirming them is a runtime task.

## UI consistency (partial)

The design-system foundation exists (`constants/ui.js`, shared `Badge`, one dropdown
primitive). A full cross-module spacing/typography sweep was intentionally deferred
because it requires visual verification on rendered pages, not blind code edits.
