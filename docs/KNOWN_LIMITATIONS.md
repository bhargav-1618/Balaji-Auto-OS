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
deployment. *(The reference deployment — Firebase project `balaji-auto-os-7` — has the
rules published.)*

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
