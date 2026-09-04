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
