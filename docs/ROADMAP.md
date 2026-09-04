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
