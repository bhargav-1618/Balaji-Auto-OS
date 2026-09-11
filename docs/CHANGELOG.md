# Changelog — Balaji Auto OS

All notable changes to this project. Format loosely follows Keep a Changelog.
This is the first public release; entries below summarise the stabilisation work that
produced it, grouped by area rather than by date.

## [1.0.0] — Final release-closure & production verification

- **CI is fully green, including the Firestore-rules emulator suite.**
  `.github/workflows/ci.yml` runs `npm ci → lint → build → npm test → npm run
  test:rules` on every push; the rules step needed a JDK 21 runtime (a
  `firebase-tools@15.24.0` requirement) — fixed after the actual CI failure log was
  read directly from the job.
- **`firestore.rules` (including PH21-D2's array-shape guards) is deployed to the
  reference project (`balaji-auto-os-7`) and independently verified against it** — a
  forged `auditLog` write (mismatched actor identity, client-supplied timestamp) is
  denied, a valid write (own identity, server timestamp) is allowed, and a non-list
  `parts.suppliers` value is denied, all confirmed via the Firebase Console Rules
  Playground against the live project.
- **PH29 (tab-duplication operation-id collision safety) verified by the project owner
  on a real Chrome browser** using the native "Duplicate Tab" gesture against
  authenticated production — the `startPiCollisionWatch()` guard behaved as designed.
- A full authenticated production create→verify→reset→restore→verify lifecycle and a
  separate live smoke pass (invoice/payment, Quick Sell, stock adjustment, PO receive,
  customer/part/supplier/job-card CRUD) were executed directly against
  `balaji-auto-os-7`, closing the Phase 23 production-reconciliation gap noted below.
- `exportFullBackup()` was missing `purchaseOrders` from its collection list (a full
  backup silently omitted every PO); fixed, with a test asserting it stays in sync with
  the "Reset All Data" collection list.
- `Reset All Data` now clears `purchaseOrders` (it was missing from
  `RECOVERY_COLLECTIONS`); an empty shop no longer fabricates a dashboard score.

## [1.0.0] — Post-release reliability & integrity program

After the initial 1.0.0 tag, a sustained audit-and-fix program (29 numbered phases;
per-phase detail in `docs/testing/PHASE_*` and `docs/ROADMAP.md`) hardened the areas an
in-memory single-client test cannot reach. No change to the public data model; no
migration. Remaining boundaries are in `docs/KNOWN_LIMITATIONS.md`. By area:

### Concurrency (multi-terminal)
- **Single-active-editor edit lease** (`editLocks`, `(uid, sessionId)`-keyed,
  server-enforced expiry) so two terminals don't silently overwrite each other's edits.
- **Invoice / estimate numbering** allocated by a Firestore transaction on
  `counters/<sequence>` at save time — distinct, monotonic serials under concurrent
  billing (a gap can occur only if a save fails after allocation; a duplicate never can).
- **Optimistic-concurrency (`_rev`) guards** on every entity save; a stale cross-tab
  write is rejected, not merged blindly (field-level rebase for customers, review
  dialog elsewhere).
- **Cross-workflow races closed** — concurrent payment collection no longer double-runs
  invoice realization; concurrent PO receive sums server-side with an over-receipt
  reject; concurrent secondary customer writes persist only the changed fields.
- Verified with 2–3 independent clients against the Firestore emulator and production.

### Idempotency & recovery
- Every retryable money/stock write carries a **durable operation id** its transaction
  reads *before* writing — one intent delivered any number of times (double-click,
  retry after an ambiguous response, lost ack, callback replay) produces exactly one
  business effect; a genuinely separate action still goes through.
- The operation id lives in `sessionStorage`, so a **browser refresh mid-workflow** is
  recoverable; a network drop lands in the same recovery path; every `runTransaction`
  is bounded by a client-side timeout that never cancels (ambiguous failure keeps the
  id and shows a "check the record before retrying" notice).
- **Tab-lifecycle safety** — a duplicated tab reusing an inherited operation id for a
  genuinely new action is detected via a page-instance tag plus a `BroadcastChannel`
  cross-check (`docs/testing/PHASE_29_PH29-01_VALIDATION.md` records the status and the
  open residual).

### Financial & ledger integrity
- Realization is diff-based and idempotent; refund/return no longer double-restores
  stock; a concurrent edit + payment can no longer commit an overpaid, mislabelled
  invoice (in-transaction overpay re-check).
- Invoice create / edit / payment / delete are **single atomic transactions** with
  their stock, sales-ledger and monthly-rollup effects; the ledgers stay append-only.
- Job-card reservation is atomic across every part on the card; >500-write bulk
  operations report an honest, resumable partial-failure count.

### Inventory integrity
- Editing a Part's unrelated fields no longer reverts its stock to a stale value;
  editing a Supplier no longer reverts a name/phone fix made from the Part modal;
  deleting a Part no longer breaks an invoice or PO that still references it;
  a cancelled Purchase Order can no longer be received against.

### Authorization & Firestore rules
- Hardened `firestore.rules` — `appSettings` (the role list) is admin-only
  (privilege-escalation fix); hard delete on parts / suppliers / categories / vehicles
  and the ledgers is admin-only at the data layer; ledgers immutable; counters
  monotonic; actor identity pinned on `auditLog` / `pendingSales` / `editLocks`.
- Full Owner / Admin / Staff / Unauthenticated matrix verified against the emulator
  (278 assertions) and by unauthenticated production probes. Deployed and verified on
  the reference project `balaji-auto-os-7` (`docs/KNOWN_LIMITATIONS.md` §🔴); rules
  deployment remains a required per-environment step for any *new* Firebase project.

### Analytics
- Revenue / Cost / Gross Profit / Margin reconcile to the authoritative invoices —
  invoice-level discount allocated to the ledger, COGS from the invoice line snapshot
  (not live catalogue), Outstanding/Pending KPIs exclude drafts/estimates/reversed,
  `part.salesCount` moves with stock on invoice realization.

### Input, export & PDF
- Malformed / extreme / hostile input stays contained — no `dangerouslySetInnerHTML`
  in app code, finite-guarded numeric coercers, wrong-type array/scalar guards at the
  shared edge.
- Every Excel export reconciles to its source record; the invoice PDF, QR payload and
  `/verify` page agree with the invoice; description truncation is consistent with an
  ellipsis.

### Offline / reconnect
- Transaction failures fail fast and keep their operation id; queued (non-transactional)
  writes replay on reconnect; Quick Sell persists one durable pending-sale intent while
  offline and reconciles it through the same atomic path once online; the inline
  stock-stepper restock rolls back and reports accurately on an offline failure.

### Browser / mobile / navigation / multi-tab
- Mobile (`< 768px`) full-screen forms own a scroll region (were clipped below the fold
  on short viewports — a required field could be unreachable).
- Double-navigation / stale-route / rapid-selection races closed (phantom edit-lock on
  an out-of-order lease resolve; Back/Forward bypassing the unsaved-changes prompt;
  a modal surviving Back with a desynced URL).
- Cross-tab settings / prefs / language propagate via the `storage` event; business
  data syncs via Firestore `onSnapshot`, not `storage`; per-tab navigation is isolated.
- Empty-state / cardinality sweep (0/1/2/many) — no `NaN` / `Infinity` / `undefined`
  reaches any KPI or chart; large-data pass (100 → 10,000 rows) stays correct and
  bounded.

### Verification ceiling (unchanged)
- Automated coverage is Node/jsdom. Real-browser rendering, print/PDF pixels,
  Lighthouse, and real-device iOS Safari / Firefox / Android Chrome remain a manual
  release-QA step (`docs/KNOWN_LIMITATIONS.md`). Browsers actually exercised in the
  browser-integrity phase: Chromium/Chrome 148 desktop + Chrome mobile device-emulation.

## [1.0.0] — Production Release

### Fixed — data integrity (money path)
- **₹71.35 Cr revenue bug.** VehiclesModule computed per-vehicle revenue with a filter
  whose fallback clause never referenced the invoice being tested, so every vehicle with
  a job card summed the ENTIRE workshop's revenue. Rewritten in `lib/vehicleStats.js`
  reusing the billing engine's own `isRealized` gate. Every vehicle KPI corrected and
  tested against known data.
- **TDZ crash on invoice save.** `const payments` was read by the overpayment guard
  before its declaration — a ReferenceError on every save, meaning the guard had never
  run. Reordered; overpayment now rejected before save.
- **Overpayment.** Balance was floored by `Math.max(0, …)`, hiding excess and flipping
  the header to "Mark as Paid". Now rejected while typing, on blur, and before save.
- **Excel column-shift.** The GST export wrote 10 values under 9 headers, so CGST/SGST
  and totals were shifted one column. `lib/exportSheet.js` now throws on any row/header
  length mismatch.

### Fixed — exports
- All six exports were CSV renamed to look like Excel: dates rendered `########`, money
  arrived as text that would not `SUM`. Now real `.xlsx` via one shared writer with true
  date cells (`dd-mmm-yyyy`) and sized columns.

### Fixed — interaction & runtime
- **Global scroll freeze.** `ConfirmDialog` ran its own `body` scroll lock that raced
  `Modal.js`'s reference-counted lock, stranding `<body>` unscrollable after the common
  Mark-as-Paid → confirm → close flow. Now a single counted lock; a test fails the build
  if any component writes `document.body.style` directly.
- **Dropdown mouse selection.** Rows called `scrollIntoView` on hover, moving the row
  between mousedown and mouseup so `click` never fired ("Enter works, mouse doesn't").
  Fixed in `SearchSelect` and the parts list.
- **Customer dropdown opened on focus.** Now opens on click/typing only.
- Settings dirty-state, dropdown clipping (portalled), and status-badge consistency.

### Fixed — performance
- **Vehicle search: 36,442 ms → 0.22 ms per keystroke.** A nested filter-in-filter
  rescanned all invoices per vehicle. Indexed once per data change.
- **Customer search: 59 ms (undebounced) → 0.19 ms.** Same class of fix.
- All in-memory search moved to React 18 `useDeferredValue` — instant typing, no
  artificial debounce lag. Zero debounces remain for in-memory filtering.
- A per-keystroke performance budget (5 ms) is enforced by the test suite.

### Changed — Vehicle dashboard
- 11 equal-weight KPI cards regrouped into Compliance (always visible) / Summary /
  Business (collapsible, remembered). Revenue renders compact (`₹71.35 Cr`) with the
  exact figure on hover. No card added or removed.

### Changed — Login ("Ignition")
- Login presentation rebuilt as a premium automotive boot sequence: needle sweep →
  aurora bloom → wordmark → glass card → staggered fields → sheen → system-online.
- Pure CSS animation (no Framer Motion / GSAP). Login route: **8.59 KB**.
- Session-gated: full sequence once per session, 250 ms transition thereafter; respects
  `prefers-reduced-motion`. Synchronous re-entry guard prevents double-submission.
- 100% of authentication logic preserved (Firebase auth, remember-me, persistence,
  password reset, demo login, success/outro flow).

### Consistency & accessibility
- One status-badge system + colour map; one dropdown primitive; global focus trap and
  focus-visible ring; `aria-label`s on icon-only controls.

### Housekeeping
- User-visible `APP_VERSION` set to `1.0.0`.
