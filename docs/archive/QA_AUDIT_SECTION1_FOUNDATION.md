# Balaji Auto OS — Section 1: Foundation & Architecture QA Audit

**Date:** 2026-07-27
**Scope:** Full source tree at `balaji-auto-os/` (Next.js 14 Pages Router, React 18, Firebase/Firestore)
**Method:** Direct source inspection with file:line citations, live `npm run build`, a full run of the 88-file test suite, and live multi-viewport browser testing. Six independent investigation passes (one per category cluster below), each read-only — **no fixes were implemented as part of this audit**, per instruction.
**Auditor stance:** Findings are evidence-based. Where the codebase already self-discloses a limitation (`docs/KNOWN_LIMITATIONS.md`), this audit verifies and cross-references it rather than re-discovering it as new.

---

## 1. Executive Summary

Balaji Auto OS is a single-tenant, offline-first garage/ERP application built on Next.js 14 and Firebase. The audit found a codebase with **real engineering discipline in its newer, refactored subsystems** — the backup/restore/reset vault, the purchase-order service, the billing-totals engine, the security-headers config, and the reduced-motion handling are all implemented to a standard well above typical small-team output, and are honestly self-documented in `docs/KNOWN_LIMITATIONS.md`.

Set against that, the audit found **four Critical findings** that a production ERP handling money, stock, and customer data cannot ship with unresolved:

1. Every "Saved" success toast across the four core business objects (invoices, job cards, customers, vehicles) fires **independent of whether the Firestore write actually succeeded** — a rejected write looks identical to a successful one to the user in the moment.
2. The two functions that decrement physical/reserved stock wrap an un-awaited `updateDoc` in a synchronous `try/catch` that **can never catch the error it appears to guard** — inventory truth can silently drift from Firestore with zero signal.
3. 13 of 14 live Firestore subscriptions **swallow permission-denied errors to the console only** — if access is revoked or rules misconfigured mid-session, nearly every screen keeps showing stale cached data as if it were live.
4. `firestore.rules` is correct in content but **explicitly unpublished** (`firestore.rules` line 4: "PROPOSAL ONLY... NOT VERIFIED AGAINST LIVE AUTH") — until published, any signed-in staff user can delete every invoice. This is already self-disclosed in `docs/KNOWN_LIMITATIONS.md:8-11`, which is a mark in the project's favor, but it remains an unresolved go-live blocker.

Beyond these four, the audit surfaced a large, coherent pattern: **`components/InventoryDashboard.js` is a 12,483-line, 185-`useState` monolith** that is the root cause behind a majority of the High/Medium findings in Code Quality, Global State, Global Constants, and Test Coverage — duplicated formatters, duplicated ID-generation logic, low constants adoption (1 of 35 component files actually imports the centralized `COLLECTIONS`/`STORAGE`/`LIMITS` constants), and a test suite that is ~77% source-text pattern-matching rather than real execution specifically *because* the business logic embedded in this file can't be isolated and unit-tested without a full component mount.

**Verdict: FAIL — not production-ready as-is.** The architecture, security-rules content, and newer subsystems are sound; the blocker is a specific, well-scoped set of Critical data-integrity and access-control gaps (Findings C-1 through C-4) that must be remediated before go-live. None of them require a rewrite — see §10 for the remediation order.

---

## 2. Architecture Assessment

- **Stack:** Next.js 14 (Pages Router), React 18, Tailwind CSS, Firebase Auth + Firestore (client SDK only — no `pages/api/`, no server-only secrets anywhere in the app).
- **Data model:** 16 Firestore collections, all correctly enumerated in `firestore.rules` with a default-deny catch-all. Offline-first via `persistentLocalCache` + `persistentMultipleTabManager` (`lib/firebase.js:76-88`) — genuinely enabled, not just claimed.
- **State management:** A single `React.createContext` (`context/AuthContext.js`) holds only auth/role state. All business data (customers, invoices, job cards, stock, suppliers, etc.) lives as local component state inside `InventoryDashboard.js`, passed down to feature modules (`CustomersModule`, `BillingModule`, `VehiclesModule`, `JobCardModule`) as props/callbacks — architecturally sound (no fragile global mutable state) but concentrated in one enormous owner component.
- **Scroll/shell architecture:** The app shell (demo banner, header, sidebar, status bar) is a non-scrolling, viewport-height flex container; the only scrollable element is `<main id="app-scroll">`, centralized via `lib/appScroll.js`. This is a clean, correctly-implemented single-scroller pattern.
- **Module decomposition:** Newer feature areas (`components/inventory/*`, `components/common/*`) are well-decomposed (23–462 lines/file). `InventoryDashboard.js` (12,483 lines), `BillingModule.jsx` (2,198), and `JobCardModule.jsx` (1,572) are the legacy/large layer that was never migrated to the same pattern.
- **PWA/offline:** Service worker (`public/sw.js`) uses a correctly-designed network-first strategy specifically to avoid the classic "stuck on old JS after deploy" pitfall, with versioned cache cleanup on activate.
- **Security boundary:** Firestore rules are the intended security boundary (client-side role checks are explicitly documented as non-authoritative). Rules content is correct and complete; publish status is the gap (Finding C-4).

**Overall architecture verdict:** Sound design decisions throughout (offline persistence, single-scroller shell, rules-as-boundary, append-only ledgers), undermined by one severe organizational debt item (`InventoryDashboard.js`'s size) and a handful of specific, fixable async/error-handling gaps in the core CRUD paths.

---

## 3. Production Readiness Score

| Dimension | Score | Basis |
|---|---|---|
| Architecture & design | 8/10 | Clean shell/scroll model, correct offline persistence, sound rules design, reasonable module boundaries outside the monolith |
| Data integrity & error handling | 3/10 | 2 Critical + 2 High findings directly causing silent data loss/staleness on core business writes |
| Security posture | 4/10 | Rules content correct (would be 9/10) but unpublished — currently equivalent to no database security; permission-denied handling incomplete |
| Code quality & maintainability | 4/10 | One 12,483-line monolith drives cascading duplication (currency formatting ×13, ID generation ×3, status-color ×3, image compression ×3) |
| Configuration & environment | 7/10 | Fail-fast env validation, tuned CSP/security headers, correct rules content; let down by stale onboarding docs and single-tenant hardcoding |
| Dependency health | 6/10 | Lockfile consistent, no duplicate deps, but `xlsx@0.18.5` is npm-abandoned with known advisories; test-harness deps deliberately excluded from `package.json` |
| Build & deployment | 5/10 | Clean, warning-free build; but zero CI/CD, no automated gate before deploy |
| Test coverage | 5/10 | Real, rigorous coverage of billing/GST/stock-delta logic (`services/billingService.js`); ~77% of the 88 test files are source-text pattern matches, not execution; harness deps not installable via plain `npm install` |
| Session & recovery | 5/10 | Correct persistence/idle-timeout design; but "Retry" UI is dead code, and 2 of 6 core forms (Customer, Vehicle) have no draft-autosave/beforeunload protection that the other 4 forms already have |
| Browser compatibility | 7/10 | Verified stable across 4 desktop/mobile viewport configurations in Chromium; real Safari/Firefox engines not testable in this environment (see §Browser Compatibility) |

**Weighted overall: 54/100 — FAIL for unconditional production readiness.** The two lowest-scoring dimensions (data integrity/error handling, security posture) are exactly the dimensions a Critical rating is designed to gate on. Every other dimension is at or above a "workable, needs hardening" bar.

---

## 4. Critical Findings

### C-1. Optimistic "Saved" toasts are decoupled from actual Firestore write success across all core CRUD (Billing, Job Cards, Customers, Vehicles)

- **Category:** Logging & Error Handling
- **Component:** `InventoryDashboard.js` persistence layer (`persistJobCard`, `persistInvoice`, `persistJobCardsDiff`, `persistDocsDiff`, `writeInvoices`) and their callers in `BillingModule.jsx`, `CustomersModule.jsx`, `VehiclesModule.jsx`, `JobCardModule.jsx`
- **Description:** The persistence chain (UI callback → dashboard `persistX()` → `persistXDiff()` → `store.syncAll(...).catch(...)`) breaks the promise chain at the first hop: none of the intermediate functions are `async` or `return` a promise. UI code does `await onPersist?.(...)`, but since `onPersist` resolves to `undefined` synchronously, the `await` is a no-op and the success path (toast, form reset, draft clear) always runs before the real Firestore write has even settled.
- **Root Cause:** `persistJobCardsDiff`/`persistDocsDiff`/`writeInvoices` call `store.syncAll(...).catch(...)` without `return`ing the promise, severing the caller's ability to await the real outcome.
- **Reproduction Steps:** 1) Simulate a Firestore write rejection (e.g. temporarily deny writes via rules, or throttle network to force a permission/quota error). 2) Save a new Job Card via the UI. 3) Observe: `toast.success('Job card ... saved')` fires immediately, the form closes/resets. 4) The real error surfaces seconds later as a second, unrelated toast (`toast.error('Could not save job card...')`) after the user has already moved on.
- **Expected Behavior:** Success confirmation should only appear after the write is confirmed persisted; on rejection, the form should stay open (or the optimistic entry should roll back) with a clear, immediate error.
- **Current Behavior:** Success is shown unconditionally and immediately; failure (if it ever surfaces) arrives late and disconnected from the action that caused it.
- **Severity:** Critical
- **Business Impact:** An invoice, job card, customer, or vehicle record can appear saved (and shows in the list from optimistic local state) while never actually persisting to Firestore. It then silently vanishes on next reload/reconnect when the live listener overwrites local state with server truth — with no record of what happened or why. For a billing/ERP system this is a direct risk of lost revenue records and lost customer data.
- **Technical Impact:** The optimistic-UI pattern is reasonable for perceived performance but is not paired with rollback-on-failure or reconciliation.
- **Affected Files:** `components/InventoryDashboard.js:8031-8038, 8065-8073, 8520-8531, 8610-8623`; `components/jobcards/JobCardModule.jsx:677-689`; `components/billing/BillingModule.jsx:1716-1738, 2193`; `components/customers/CustomersModule.jsx:705-745`; `components/vehicles/VehiclesModule.jsx:706-717`
- **Recommended Fix:** Make `persistDocsDiff`/`persistJobCardsDiff`/`writeInvoices`/`persistJobCard`/`persistInvoice` `async` and `return` the underlying write promise. Callers should `await` it and gate the success toast/form-reset on resolution, with `toast.error` + no reset on rejection. The correct reference pattern already exists in the same file — see Finding H-1.
- **Shared Component or Local Fix:** Shared — the fix is one change (making the four persist* helpers properly async) that resolves the bug for all four modules simultaneously.
- **Regression Risk:** Low. This is additive (awaiting an existing promise, not changing write logic); the main risk is UI code that assumed `onPersist` was synchronous and needs its own `await` added, which is a mechanical, verifiable change.

### C-2. Stock/reserved decrement wrapped in a synchronous try/catch around an un-awaited async call — the catch can never fire

- **Category:** Logging & Error Handling
- **Component:** `applyStockDelta`, `applyReserveDelta` in `InventoryDashboard.js`
- **Description:** Both functions call `updateDoc(...)` inside a synchronous `try { } catch (e) { /* offline: local state still reflects it */ }` without `await`. A synchronous `try/catch` cannot catch a promise's asynchronous rejection — the `catch` block is structurally dead code for this call.
- **Root Cause:** Missing `await` before an async Firestore call inside a sync-style try/catch, combined with an empty catch body.
- **Reproduction Steps:** 1) Mark an invoice "Paid" (triggers `applyStockDelta`) while the write would be rejected (permission-denied or rules misconfiguration). 2) Observe: in-app stock count decrements immediately (optimistic `setInventory` runs unconditionally in the same function). 3) Firestore document is never updated. 4) No console error, no toast, no visible signal of any kind.
- **Expected Behavior:** A rejected stock-decrement write should be surfaced (toast/log) and, ideally, roll back the optimistic local stock count, or at minimum flag the part as "unsynced."
- **Current Behavior:** Total silence; in-app and Firestore stock counts permanently diverge with zero operator visibility.
- **Severity:** Critical
- **Business Impact:** This is the single most business-critical write path in the app (physical inventory truth, tied to invoice payment). Permanent silent desync directly corrupts inventory valuation — a risk the code's own nearby comments (`InventoryDashboard.js:8310-8321`) explicitly warn against when reasoning about a *different* part of the same function.
- **Technical Impact:** Contrast with `handleSell`'s online path (`InventoryDashboard.js:10188-10211`), which correctly `await`s `runTransaction` inside try/catch and aborts the optimistic update on failure — proving the team already knows the correct pattern; it simply wasn't applied here.
- **Affected Files:** `components/InventoryDashboard.js:8341` (`applyStockDelta`), `components/InventoryDashboard.js:8594` (`applyReserveDelta`)
- **Recommended Fix:** Replace the fire-and-forget loop with `await Promise.allSettled(ids.map(id => updateDoc(...)))`, summarize failures with a `toast.error` naming the affected parts, and consider routing through `repositories/firestoreRepository.js`'s already-correct `update()` helper.
- **Shared Component or Local Fix:** Local to these two functions, but should reuse the exact pattern already proven correct in the Local→Firestore migration path (`InventoryDashboard.js:8897-8941`) and in `handleSell`.
- **Regression Risk:** Low-Medium. Awaiting the writes changes timing (UI will briefly show a "syncing" state instead of instant optimistic success) — worth a manual QA pass on the "mark invoice paid" flow specifically, but the underlying data operation is unchanged.

### C-3. Firestore permission-denied errors are silently swallowed to console-only for 13 of 14 live subscriptions

- **Category:** Session Management / Global Event Handling
- **Component:** `InventoryDashboard.js` `onSnapshot` subscriptions
- **Description:** Only the `parts` listener maps errors to a UI-visible state (`connError`, shown as a small sidebar status pill). The other 13 — `jobCards`, `customers`, `invoices`, `sales`, `salesRollups`, `restocks`, `stockAdjustments`, `reorderRequests`, `purchaseOrders`, `recoveryMeta`, `categories`, `vehicles`, `auditLog` — only do `(err) => console.error(...)`, with no toast, banner, or state change of any kind.
- **Root Cause:** The error-handling pattern proven for `parts` (`InventoryDashboard.js:8856-8867`) was never propagated to the other 13 listeners.
- **Reproduction Steps:** 1) Revoke a signed-in user's Firestore access mid-session (role change, rules redeploy, or security incident). 2) Observe: Customers/Job Cards/Billing/Suppliers/Purchase Orders screens keep showing the last-synced cached data (offline persistence makes stale reads indistinguishable from live ones) with zero indication access was cut off.
- **Expected Behavior:** A permission-denied (or other terminal) subscription error should surface to the user — at minimum a banner stating that data may be stale/unsynced.
- **Current Behavior:** Silent, indefinite staleness across nearly every module.
- **Severity:** Critical
- **Business Impact:** Staff could act on stale information (e.g., believe an invoice is unpaid when it was paid on another device, or miss a part going out of stock) with no warning their access — or their data — is out of date. This risk is amplified by Finding C-4: if rules are genuinely unpublished, this failure mode is currently more theoretical than live, but becomes immediately relevant the moment rules are published and any role-scoping is misconfigured.
- **Technical Impact:** No aggregated visibility; each failure is only ever visible in one browser's DevTools console at the moment it occurs.
- **Affected Files:** `components/InventoryDashboard.js:8039-8048, 8082-8096, 8129-8136, 8947-9089` (all 13 listeners); working reference at `:8856-8867`
- **Recommended Fix:** Extract the `parts` listener's error-to-UI-state pattern into a shared handler and apply it to all `onSnapshot` calls; at minimum, surface a single global "sync degraded" banner if any collection's listener errors.
- **Shared Component or Local Fix:** Shared — one error-handling helper applied at all 14 call sites.
- **Regression Risk:** Low. Purely additive error visibility; no change to the success path.

### C-4. `firestore.rules` is correct in content but not published — the database has no live security boundary

- **Category:** Configuration & Environment / Security
- **Component:** `firestore.rules` (Firebase Console deployment status)
- **Description:** The rules file itself is well-designed (default-deny catch-all, correct append-only semantics on ledger collections, correctly restricts `appSettings/roles` writes to admins) and matches all 16 collections the app actually uses. However, the file is explicitly headed "PROPOSAL ONLY... NOT VERIFIED AGAINST LIVE AUTH... DO NOT blind-publish this" and `docs/KNOWN_LIMITATIONS.md:8-11` confirms it has not been pasted into the Firebase console.
- **Root Cause:** Deployment step (`firebase deploy --only firestore:rules`) not yet performed; this is a configuration/operations gap, not a code defect.
- **Reproduction Steps:** 1) Sign in as any non-admin staff account. 2) Attempt to delete any invoice via direct Firestore access (bypassing UI role checks, which are documented as client-side-only guards). 3) Without published rules, the delete succeeds.
- **Expected Behavior:** Only admins (or appropriately scoped roles) should be able to delete invoices/other protected records; the rules file already encodes this correctly.
- **Current Behavior:** No server-side enforcement exists at all — the UI's `isAdmin`/`canManage` checks are the only gate, and they are bypassable by anyone with API access.
- **Severity:** Critical
- **Business Impact:** Total absence of a real security boundary in production. This is the single highest-severity item in the repository — and it is honestly self-disclosed, which should inform remediation priority, not remediation necessity.
- **Technical Impact:** One residual open question flagged inside the rules file itself: `isAdmin()` (`firestore.rules:62-71`) assumes the Settings write path stores admin emails lowercase-normalized — stated as unverified in the file's own comments (`firestore.rules:28-31`).
- **Affected Files:** `firestore.rules` (whole file); `docs/KNOWN_LIMITATIONS.md:8-11`
- **Recommended Fix:** Publish `firestore.rules` via `firebase deploy --only firestore:rules` (or paste into console) before go-live, per `docs/DEPLOYMENT_GUIDE.md:15-20`. Before publishing, verify the lowercase-email assumption against the actual Settings write path. Consider adding a release-time check (`tests/deploy-security.test.cjs`/`tests/security-rules.test.cjs` already exist) that fails a release pipeline if rules are provably unpublished.
- **Shared Component or Local Fix:** N/A — one-time deployment action, not a code change.
- **Regression Risk:** Medium. Publishing rules for the first time is the moment latent client/rules mismatches (like Finding C-3's blast radius) become visible — recommend publishing to a staging Firebase project first and exercising every module's read/write paths as a non-admin and an admin account before publishing to production.

---

## 5. High Priority Findings

### H-1. Known-and-fixed-once bug class not propagated (evidence the team already has the correct pattern)

- **Category:** Logging & Error Handling
- **Description:** The Local→Firestore migration path (`InventoryDashboard.js:8897-8941`) contains an explicit comment documenting this exact defect class shipping once before ("THIS MIGRATION USED TO LIE... the app cheerfully toasted 'Synced 300 records' even if every write failed") and shows the correct fix: `await Promise.allSettled(writes)`, count only `fulfilled` as success. This fix was never propagated to Findings C-1/C-2.
- **Severity:** High
- **Affected Files:** `InventoryDashboard.js:8897-8941` (correct reference implementation)
- **Recommended Fix:** Use this function as the internal template for remediating C-1 and C-2.
- **Regression Risk:** N/A (documentation/reference finding).

### H-2. `handleAdjustStock` shows unconditional success over two unguarded fire-and-forget writes

- **Category:** Logging & Error Handling
- **Description:** Manual stock adjustments write to `parts` and the append-only `stockAdjustments` ledger without awaiting either; `toast.success` fires regardless of outcome.
- **Severity:** High
- **Affected Files:** `InventoryDashboard.js:10285-10319`
- **Business Impact:** A stock-count correction — exactly the audit trail an owner would use to explain a discrepancy — can silently fail to write while the UI confirms success.
- **Recommended Fix:** `Promise.all` both writes, gate toast/close on resolution.
- **Regression Risk:** Low.

### H-3. No timeout/fallback on Firebase Auth resolution — BootSplash can hang indefinitely

- **Category:** Application Initialization
- **Description:** `loading` starts `true` and is only set `false` inside `onAuthStateChanged`; no deadline/timeout fallback exists anywhere. If the callback never fires (blocked network, ad-blocker, DNS, offline-at-boot), the user is stuck on the boot splash forever with no retry path and no way to manually reach `/login`.
- **Severity:** High
- **Affected Files:** `context/AuthContext.js:96-101`; `pages/index.js:15-17,33`
- **Recommended Fix:** Add a `setTimeout` fallback (e.g. 10-15s) that surfaces a retry/manual-login option if `onAuthStateChanged` hasn't resolved.
- **Regression Risk:** Low.

### H-4. `appSettings/roles` listener can fail before auth resolves and never retries

- **Category:** Application Initialization
- **Description:** This listener mounts on `AuthProvider`'s first render (gated only by `demoMode`, resolved synchronously), potentially before `onAuthStateChanged` delivers a user — and Firestore rules require `request.auth != null`. On error it only logs and falls back to `BOOTSTRAP_ADMINS`, with no re-subscribe since its effect's dependency array excludes `user`.
- **Severity:** High (business-logic correctness, not just UX)
- **Affected Files:** `context/AuthContext.js:62-84`
- **Business Impact:** A staff member granted admin via `appSettings/roles` (not hardcoded) can be silently downgraded to 'staff' permissions for the entire session if the first subscribe attempt loses a race, with no recovery short of full reload.
- **Recommended Fix:** Add `user` to the effect's dependency array (or otherwise re-subscribe once auth resolves).
- **Regression Risk:** Low-Medium — changes listener lifecycle timing; verify no double-subscribe.

### H-5. `InventoryDashboard.js` is a 12,483-line, 185-`useState` monolith — the root architectural debt item

- **Category:** Global State Management / Code Quality
- **Description:** 185 `useState`, 88 `useEffect`, 93 `useMemo`, 19 `useCallback` in one component owning nearly all business state. Feature modules are stateless props-consumers (architecturally sound), but the owner component itself is an unreviewable, hard-to-reason-about single point of change for the whole app.
- **Severity:** High (architectural)
- **Affected Files:** `components/InventoryDashboard.js` (whole file)
- **Business Impact:** Every cross-cutting change has blast radius across the whole file; this is the direct root cause of Findings M-3 (currency formatting duplication), M-4 (ID-generation duplication), M-8/M-9 (low constants adoption), and L-Test-4 (test suite is mostly pattern-matching, not execution).
- **Recommended Fix:** No big-bang rewrite recommended; incrementally extract pure business logic (following the `services/billingService.js` precedent, which is already well-tested) out of the component, module by module, starting with the highest-risk logic (job-card numbering, stock math).
- **Regression Risk:** High if attempted as a single large refactor; Low-Medium if done incrementally with the existing test harness as a safety net.

### H-6. Shared `Modal.js` has no Escape-key handling; Add/Edit Part and Add/Edit Supplier don't close on Escape

- **Category:** Global Event Handling
- **Description:** `Modal.js` closes only via backdrop click or an explicit close button. Every other overlay type (dropdowns, `ConfirmDialog`) implements Escape itself; the two core forms built on `Modal.js` do not.
- **Severity:** High (consistency/accessibility), Medium (functional risk — no data loss)
- **Affected Files:** `components/Modal.js` (no Escape handling); `InventoryDashboard.js:3015-3024` (Add/Edit Part), `:3490` (Add/Edit Supplier)
- **Recommended Fix:** Add Escape handling directly to `Modal.js` (the global focus trap already explicitly defers Escape-handling to individual overlays, so this is the correct single point of fix).
- **Shared Component or Local Fix:** Shared — fixing `Modal.js` once fixes both call sites and any future modal built on it.
- **Regression Risk:** Low.

### H-7. Customer and Vehicle forms have no draft-autosave or `beforeunload` protection — inconsistent with 4 other forms in the same app

- **Category:** Application Recovery
- **Description:** Job Card, Invoice, Add/Edit Part, and Add/Edit Supplier all have debounced `localStorage` draft-autosave plus a `beforeunload` guard. Add/Edit Customer and Add/Edit Vehicle have neither (confirmed via full-file grep — zero `beforeunload` listeners, zero draft-write pattern).
- **Severity:** High
- **Affected Files:** `components/customers/CustomersModule.jsx` (missing); `components/vehicles/VehiclesModule.jsx` (missing) — contrast working examples at `components/jobcards/JobCardModule.jsx:530-541`, `components/billing/BillingModule.jsx:513,521,950-955`, `InventoryDashboard.js:2385-2396,3245-3256`
- **Business Impact:** A refresh or accidental navigation mid-way through adding/editing a Customer or Vehicle (multi-field data: name, phone, GST, address, registration/insurance/PUC dates) silently discards everything typed, with zero warning — inconsistent with the rest of the app's own established pattern.
- **Recommended Fix:** Port the existing autosave/`beforeunload` pattern from `JobCardModule.jsx`/`BillingModule.jsx` into `CustomersModule.jsx`/`VehiclesModule.jsx`.
- **Regression Risk:** Low — additive, well-precedented pattern.

### H-8. The "Retry" connection-recovery control is dead code — never wired to any UI element

- **Category:** Application Recovery
- **Description:** `retrySync` (`InventoryDashboard.js:8872`) is defined specifically to let a user manually re-subscribe the `parts` listener after a connection error, complete with a "Reconnecting…" toast — but it is never called anywhere in the file, and the sidebar connection-status indicator it's meant to serve is a plain non-interactive dot with no click handler.
- **Severity:** High
- **Affected Files:** `InventoryDashboard.js:8872` (definition), `:7637-7639` (non-interactive status dot render), `:11016-11022` (status prop)
- **Business Impact:** When "Connection Error" is shown, the user has no way to manually retry short of a full page reload, despite the code being built for exactly that purpose.
- **Recommended Fix:** Wire the sidebar status pill's click (or an adjacent explicit "Retry" button) to call `retrySync`.
- **Regression Risk:** Low.

### H-9. `constants/index.js` (COLLECTIONS/STORAGE/LIMITS) is imported by only 1 of 35 component files

- **Category:** Global Constants
- **Description:** Despite the file's own header explicitly stating it was created to fix "40 distinct storage keys written as raw strings in 107 places," `InventoryDashboard.js` is the only component that imports it — and even there, raw `collection(db, '...')` string literals outnumber `COLLECTIONS.*` references 34-to-4 in the same file. 112 raw `'maruti_...'` string literals exist across `components/**`, ~19 of which reference keys that don't exist in `STORAGE` at all.
- **Severity:** High
- **Affected Files:** `constants/index.js` (definition); `components/InventoryDashboard.js:8042,8090,8846,8949,8973,9062,9075` and 100+ other sites across `components/billing/`, `components/customers/`, `components/inventory/`
- **Business Impact:** The exact class of bug the constants file exists to prevent (a typo'd storage key silently reading back `null`) remains fully reproducible today for the majority of the codebase.
- **Recommended Fix:** Incrementally migrate raw string literals to `COLLECTIONS.*`/`STORAGE.*` references, prioritizing write call sites over read-only ones.
- **Regression Risk:** Low if done as a mechanical find-and-replace verified against the constant's actual value; risk rises only if any raw literal was accidentally divergent from its "intended" constant (worth a diff-review pass, not a blind replace).

### H-10. `constants/ui.js`'s documented status-color consolidation is not actually shipped — 3 independent implementations remain

- **Category:** Global Constants
- **Description:** The file's header explicitly claims four independent status-color implementations were merged into one, but `VehiclesModule.jsx` still has its own local `expiryBadge()` with inline hex colors, and `InventoryDashboard.js` (which never imports `constants/ui.js` at all) has two more independent color-mapping implementations (`StatusBadge` and an inline PO-status object).
- **Severity:** High
- **Affected Files:** `constants/ui.js` (claims consolidation); `components/vehicles/VehiclesModule.jsx:39` (independent impl); `components/InventoryDashboard.js:646,5560` (two more independent impls)
- **Recommended Fix:** Actually complete the consolidation the documentation already claims — migrate the three remaining implementations to `statusColor`/`SEMANTIC`.
- **Regression Risk:** Low-Medium — visual-only change, verify color parity per status value before/after.

### H-11. No CI/CD pipeline — nothing runs automatically before deploy

- **Category:** Build & Deployment Readiness
- **Description:** No `.github/workflows/`, no pre-commit/pre-push hook, no `package.json` "test" script. Build, lint, and the 88-file test suite only run if a human remembers to run them manually.
- **Severity:** High
- **Affected Files:** repo root (absence of `.github/`)
- **Business Impact:** A regression in billing/GST/stock logic — exactly what the existing test suite is built to catch — can ship to production without ever being run.
- **Recommended Fix:** Add a GitHub Actions workflow running `npm ci`, `npm run build`, `npm run lint`, and the test harness on every push/PR to the deploy branch.
- **Regression Risk:** Low — additive tooling, no application code touched.

### H-12. Test-harness dependencies are deliberately excluded from `package.json` — 20 of 88 tests cannot run on a fresh install

- **Category:** Test Coverage
- **Description:** `tests/setup.cjs` requires `jsdom`, `@babel/core`, `@testing-library/react`, etc., none of which are declared in `package.json` `devDependencies` (installed via a separate, documented, `--no-save` command instead). Verified directly: a stock `npm install` leaves these modules absent, and running any `setup.cjs`-based test throws `Cannot find module '@babel/core'`.
- **Severity:** High
- **Affected Files:** `tests/setup.cjs:8-12`; `package.json:31-38` (missing entries); `docs/RUN_TESTS.md:5-8` (documents the workaround)
- **Business Impact:** A new engineer, CI runner, or auditor following only `package.json` (the normal discovery path) will conclude the project has zero working tests.
- **Recommended Fix:** Move harness packages into real `devDependencies` (no production bundle impact — Next.js excludes devDependencies from the build) and add a `"test"` script.
- **Regression Risk:** Low.

### H-13. No Firestore-emulator/integration test of the security rules — the one thing self-documented as "the real security boundary" has the weakest test coverage in the repo

- **Category:** Test Coverage
- **Description:** `tests/security-rules.test.cjs` itself states it only performs "STATIC guarantees over `firestore.rules`" (regex/string checks on the rules text) and explicitly says the rules "must still be tested in the Rules Playground before publishing." No `@firebase/rules-unit-testing`, no emulator usage anywhere in the repo.
- **Severity:** High
- **Affected Files:** `tests/security-rules.test.cjs`, `tests/deploy-security.test.cjs`
- **Recommended Fix:** Introduce `@firebase/rules-unit-testing` + the Firestore emulator for the highest-risk assertions (privilege escalation, append-only ledgers, default-deny) — string-matching cannot catch a syntactically valid but logically wrong rule.
- **Regression Risk:** N/A — additive test infrastructure.

### H-14. `xlsx@0.18.5` is npm-abandoned with known, publicly disclosed advisories, and processes financial export data

- **Category:** Dependency Health
- **Description:** SheetJS stopped publishing new `xlsx` versions to npm after 0.18.5; later fixes (including known prototype-pollution/ReDoS advisories) are only available via SheetJS's own CDN, not npm.
- **Severity:** High
- **Affected Files:** `package.json:35`; usage site `lib/exportSheet.js`
- **Business Impact:** This app exports invoice/inventory data through `xlsx`; a vulnerability in a financial-data export path is a real attack surface if any user-controlled input flows into generated/parsed sheets.
- **Recommended Fix:** Confirm whether the usage is generate-only (lower risk) or also parses untrusted uploaded files (higher risk); migrate off the stale npm package accordingly (SheetJS CDN tarball, or an alternative like `exceljs`).
- **Regression Risk:** Medium if switching libraries (API differences); Low if only re-pinning to a patched SheetJS distribution.

---

## 6. Medium Priority Findings

| # | Finding | Category | Affected Files |
|---|---|---|---|
| M-1 | Theme preference causes a real flash-of-wrong-theme (FOUC) for non-default themes — no inline pre-hydration script sets `data-theme` | Init | `InventoryDashboard.js:7043,7065-7070`; `pages/_document.js` |
| M-2 | Only 4 of ~15 live Firestore listeners support manual reconnect via `syncNonce`; the other 9 have no retry path short of full reload | Init/Global State | `InventoryDashboard.js:8947-9089` |
| M-3 | Currency formatting reimplemented independently in 13+ places with divergent rounding (Billing keeps paise, everything else rounds) | Code Quality | `lib/format.js`, `BillingModule.jsx:24`, `CustomersModule.jsx:27`, `VehiclesModule.jsx:37,62-73`, 9 files under `components/inventory/*`, `InventoryDashboard.js:5373,5847,6583` |
| M-4 | Customer code / job-card number generation independently reimplemented in 3 files sharing one un-namespaced `SBBMC` prefix — structural collision risk | Code Quality | `CustomersModule.jsx:76`, `VehiclesModule.jsx:655-658`, `JobCardModule.jsx:322-324` |
| M-5 | Base64 image-compression pipeline copy-pasted 3× with inconsistent 10MB size guard (Customers module missing it) | Code Quality / Assets | `VehiclesModule.jsx:39-51`, `InventoryDashboard.js:2343-2355`, `CustomersModule.jsx:56-73` |
| M-6 | Base64 photos embedded directly in Firestore documents; only 1 of 16 `<img>` tags uses `loading="lazy"`; no `next/image`; no per-document photo-count cap | Assets | `VehiclesModule.jsx:405,922,971,1039`; `CustomersModule.jsx:363,1092`; `JobCardModule.jsx:1172` |
| M-7 | `limit()` calls and `.slice(0,50)` pagination bypass the `LIMITS` constant, including one outright inconsistency (`auditLog` uses `limit(100)` inline vs. the imported `LIMITS.AUDIT_LIVE=500`) | Global Constants | `InventoryDashboard.js:8961,8997,9009,9062,4794,5094,7751,8407` |
| M-8 | `--app-header-h`/`--demo-banner-h` measured via ref-callback only, no `resize`/`ResizeObserver` backing — a pure window resize with no accompanying state change leaves them stale | Global Event Handling | `InventoryDashboard.js:10996,11051` |
| M-9 | Multi-tab logout sync only works if "Remember me" was checked (local vs. session persistence) — unchecked (the safer default) means a logout in one tab doesn't propagate to sibling tabs | Session Management | `pages/login.js:108` |
| M-10 | Modal viewport re-measurement (120/350/700ms staggered `setTimeout`s for iOS toolbar settling) can shift a modal's layout up to 700ms after paint — narrow mis-click window near the bottom edge | Animation/Recovery | `components/Modal.js:112-141` |
| M-11 | 3 test files use Node's `require(esm)` interop, which the documented minimum Node version (18) does not support | Test Coverage | `tests/customer-search-archive.test.cjs`, `tests/search-accuracy-exact-identifier.test.cjs`, `tests/vehicles-module.test.cjs` |
| M-12 | ~77% of the 88-file test suite is source-text pattern-matching (regex/string checks), not execution — root cause is business logic embedded in the `InventoryDashboard.js` monolith rather than pure, isolatable modules | Test Coverage | whole `tests/` dir vs. `services/billingService.js` (the well-tested counter-example) |
| M-13 | Job-card numbering (`writeJobCardDraft`, inline, different algorithm than the tested `nextDocNumber`) has zero executing-test coverage | Test Coverage | `InventoryDashboard.js:8544-8545` |
| M-14 | `services/inventoryService.js` (category-rename/remap logic) has zero test coverage despite being a pure, easily-testable module | Test Coverage | `services/inventoryService.js:1-37` |
| M-15 | No e2e/visual regression testing (no Playwright/Cypress/screenshot tooling) — deferred entirely to undocumented manual QA | Test Coverage | repo-wide absence |
| M-16 | `SETUP_GUIDE.md` is stale: references a nonexistent `ROLE_MAP` object, and its sample Firestore rules only cover 2 of 16 collections — a less experienced deployer following it literally would leave 13+ collections unprotected while believing the database is secured | Config/Docs | `docs/SETUP_GUIDE.md:112-120,169-183` vs. `context/AuthContext.js:14-25`, `firestore.rules` |
| M-17 | Business identity (shop name, city, WhatsApp message text, PWA identity, QR fallback URL) hardcoded across 7+ files rather than config-driven, despite the product being marketed/onboarded as reusable for other garages | Config | `SupplierPOBuilder.jsx:97`, `BillingModule.jsx:1713,2113`, `manifest.json:2-3`, `login.js:173`, `verify.js:43`, `_document.js:24`, `InventoryDashboard.js:7606`, `constants/index.js:178` |
| M-18 | `headers()`-based CSP/HSTS in `next.config.js` silently no-ops under static-export hosting; deployment target beyond "e.g. Vercel" is undocumented | Build/Deployment | `next.config.js:18-63` |
| M-19 | `firestore.indexes.json` is empty — any query needing a composite index will fail at runtime with a console-only error rather than being pre-provisioned | Config | `firestore.indexes.json` |
| M-20 | Test-file bug (not a product bug): `tests/export.test.cjs` hardcodes a POSIX `/tmp` path, fails on Windows | Test Coverage | `tests/export.test.cjs:141,158` |

---

## 7. Low Priority Findings (condensed)

- **CustomersModule.jsx:207-208** — `addEventListener` effect has no dependency array, re-attaches every render (functionally harmless, unnecessary churn).
- **3 components** (`JobCardModule.jsx:240-242`, `VehiclesModule.jsx:496`, `SupplierDirectory.jsx:102`) hand-roll outside-click detection instead of reusing the shared `useOutsideClose` hook — currently safe (none are portalled) but would reintroduce a known bug class if ever migrated to portal rendering.
- **Unused exports:** `regKey`, `useIsSearching`, `useLatest` (`lib/useSearch.js`), `buildSheet` (`lib/exportSheet.js`), `topmostOverlay` (`lib/focusTrap.js`).
- **`.js`/`.jsx` extension inconsistency** on 3 legacy root components (`InventoryDashboard.js`, `Modal.js`, `ErrorBoundary.js`) vs. `.jsx` everywhere else.
- **Debounce delays inconsistent** (140ms/160ms/350ms inline `setTimeout`s) despite a reusable `useDebounced` hook existing (`lib/useSearch.js:57`).
- **Validation error strings** ("Registration number is required", etc.) duplicated 3-4× across modules instead of a shared messages module.
- **No `engines` field** in `package.json` to enforce the documented Node 18+ requirement.
- **`eslint@8`** is deprecated/EOL (dev-only, no production exposure); several transitive deprecated packages (`glob`, `inflight`, `rimraf`) pulled in by the same chain.
- **No `packageManager` field** pinning the package-manager version.
- **`tests/README.md`** advertises stale counts (46 suites/996 assertions vs. actual 88 files/1,539 assertions).
- **`RUN_TESTS.md`** references `scan-undef.cjs`/`scan-tdz.cjs` at repo root; they actually live under `tools/`.
- **604 kB First Load JS** on the single `/` route (the whole SPA in one bundle) — not a failure, but heavy for first paint on slow connections.
- **`manifest.json`** missing `scope` and `screenshots`; combined "any maskable" icon purpose without a dedicated safe-zone variant.
- **`public/sw.js`**'s `CACHE_NAME` is a hand-maintained literal rather than build-derived — low risk given the network-first strategy, but a footgun for future SW edits.
- **`.env.local`/`.env.local.example`** duplication in docs (cosmetic).

**Positive findings (for balance — not defects):**
- Firestore offline persistence is genuinely and correctly configured (`persistentLocalCache` + `persistentMultipleTabManager`), not just claimed.
- Backup/Restore/Reset/Recovery-Vault subsystem, the Purchase-Order service, and `services/billingService.js` are all `async`/`await`-correct, well-tested, and represent the standard the rest of the app should be brought up to.
- `prefers-reduced-motion` is applied via a robust, universal `!important` CSS override plus a JS-level check before triggering the arrival animation — comprehensive, not a per-animation opt-in gap.
- No orphaned/leaking `addEventListener` calls found anywhere in the codebase.
- Global focus trap and focus restoration correctly implemented app-wide.
- `next.config.js` ships a genuinely tuned CSP/security-headers policy, well above typical starter-template rigor.
- No PII leakage found across 86+ audited `console.error`/`console.log` call sites; verbose debug logging is properly gated behind an opt-in `TXN_DEBUG` flag.
- Clean, warning-free production build (`npm run build` succeeds, all routes static).
- The project is unusually candid about its own test-verification ceiling (`docs/KNOWN_LIMITATIONS.md`, `tests/README.md`) rather than overselling regex-based checks as real unit tests.
- No duplicate/overlapping-purpose dependencies; lockfile present and internally consistent with `package.json`.

---

## 8. Browser Compatibility

Tested live in this environment (Chromium-based browser pane) at four configurations, with console-error checks at each:

| Configuration | Result |
|---|---|
| 1920×1080 desktop | Layout correct; `max-w-7xl` centering math verified correct (not a bug) |
| 1366×768 desktop | Layout correct |
| 1280×720 @ 150% browser zoom | Layout held together; minor cosmetic currency-figure line-wrap, non-blocking |
| 390×844 mobile | Bottom tab bar, demo banner, and account bar all correctly fixed/visible |

Console output was consistent across all four: only the known `Roles sync (using bootstrap admins): FirebaseError: [code=permission-denied]` message (independently corroborated by Finding H-4's root-cause analysis of the `AuthContext.js` roles-listener race) — no other errors at any size.

**Genuine limitation, disclosed rather than papered over:** this environment can only exercise a Chromium engine. **Real Safari (WebKit) and Firefox (Gecko) were not tested** — no automated cross-engine testing infrastructure (e.g. BrowserStack, Playwright multi-browser) exists in this repo. Given the app's iOS-specific `Modal.js` viewport-settling logic (Finding M-10) is explicitly written for Safari's bottom-toolbar behavior, a real-device Safari pass is the highest-value manual QA step before go-live that this audit could not perform.

---

## 9. Regression Risks

Ranked by how much existing, working behavior a fix could disturb if done carelessly:

1. **C-4 (publishing Firestore rules) — Medium-High.** The moment real rules go live, any latent mismatch between what the UI assumes it can read/write and what the rules actually allow becomes immediately visible as a hard failure, not a slow drift. Must be exercised against a staging project across every module, both as admin and as non-admin staff, before production publish.
2. **H-5 (InventoryDashboard.js decomposition) — High if attempted as one large refactor, Low-Medium if incremental.** This file is the single largest blast-radius surface in the app; any extraction should be done module-by-module with the existing test harness run before/after each step.
3. **C-1/C-2 (awaiting previously fire-and-forget writes) — Low-Medium.** Changes perceived latency (UI will show a brief "saving" state instead of instant success) on the most-used flows in the app (save invoice, save job card, save customer, save vehicle, sell a part). Recommend a manual pass on each of these four flows specifically after the fix, on both fast and throttled connections.
4. **H-9/H-10 (constants adoption) — Low if done as verified mechanical replacement.** Risk is isolated to any raw literal that turns out to not actually match its "intended" constant value — a diff-review, not a blind find-and-replace, is the safe path.
5. **Everything else (H-3, H-6 through H-8, H-11 through H-14, all Medium/Low findings) — Low.** These are additive (new error surfaces, new CI, new tests, new draft-autosave) or narrowly scoped (single-function fixes) with minimal interaction with existing working paths.

---

## 10. Technical Debt Summary

The debt in this codebase is concentrated, not diffuse — nearly every Medium/High Code-Quality and Global-Constants finding traces back to one root cause:

**`components/InventoryDashboard.js` at 12,483 lines is the single largest technical-debt item in the repository**, and it is the direct or indirect cause of:
- Currency-formatting duplication (M-3)
- ID-generation duplication and collision risk (M-4)
- Image-compression duplication (M-5)
- Constants/collection-name adoption sitting at ~3% of files (H-9, H-10)
- The test suite's ~77% pattern-matching-not-execution ratio (M-12), since logic trapped inside this component can't be isolated for real unit testing the way `services/billingService.js` already demonstrates it can be
- Job-card numbering having zero real test coverage (M-13)

The good news embedded in this: the fix pattern already exists and is proven in the same codebase. `services/billingService.js`, `services/purchaseOrderService.js`, and `services/inventoryService.js` show the team knows how to extract pure, testable, framework-free logic — it simply hasn't been applied to the oldest and largest part of the app yet. This is evolutionary debt (a legacy layer that predates a since-adopted better pattern), not a design mistake being repeated.

Secondary debt cluster: **documentation drift** (M-16, low findings on `RUN_TESTS.md`/`tests/README.md`) — the docs describe an earlier, simpler version of the auth/roles/rules system and haven't tracked the current, more correct implementation. Low individual severity, but risky in aggregate because the stalest doc (`SETUP_GUIDE.md`) is precisely the one a new/non-technical deployer would follow for the security-critical setup step.

---

## 11. Recommended Remediation Order

1. **C-4** — Publish `firestore.rules` (after verifying the lowercase-email assumption and staging-testing every module as both admin and non-admin). This is the fastest to execute and gates everything else about calling the app "secure."
2. **C-1** — Fix the four `persist*` helpers to properly await and propagate write outcomes. Single, shared, well-scoped change; highest data-integrity payoff for the effort.
3. **C-2** — Fix `applyStockDelta`/`applyReserveDelta` await bug. Small, isolated, highest business-criticality (inventory truth).
4. **C-3** — Extract and apply the `parts` listener's error-to-UI pattern to the other 13 subscriptions.
5. **H-1, H-2** — Apply the same await/Promise.allSettled discipline to `handleAdjustStock` and confirm no other write path was missed (a repo-wide grep for `.catch(console.error)`-only Firestore writes is a cheap follow-up audit).
6. **H-11, H-12** — Stand up CI (build+lint+test on every push) and fix the test-harness/`package.json` split — this makes every subsequent fix in this list independently verifiable going forward, so doing it early compounds value.
7. **H-3, H-4** — Auth boot-timeout fallback and roles-listener retry — both are small, high-leverage reliability fixes.
8. **H-6, H-7, H-8** — Modal Escape handling, Customer/Vehicle draft-autosave, wire up the Retry control — all additive, low-risk, user-facing reliability/consistency fixes.
9. **H-9, H-10** — Constants adoption pass (mechanical, verify-then-replace).
10. **H-13** — Firestore-emulator rules testing (do this before or alongside step 1's staging verification for maximum leverage).
11. **H-14** — Resolve the `xlsx` dependency risk once the parse-vs-generate-only usage is confirmed.
12. **H-5** — Begin incremental extraction of `InventoryDashboard.js`'s business logic into `services/`, module by module, using the existing test harness as the safety net at each step. This is the largest item and should be paced as ongoing work, not a blocking pre-launch task, once items 1-11 are resolved.
13. **Medium/Low findings** — batch into normal sprint work; none are go-live blockers on their own, but M-16 (stale `SETUP_GUIDE.md`) should be prioritized close to step 1 since it directly touches the same security-setup step.

---

## 12. Overall Production Readiness Verdict

# FAIL

**Rationale:** Four Critical findings (C-1 through C-4) create genuine, unmitigated data-integrity and access-control risk in a system that handles money, physical inventory, and customer records. None of them require architectural rework — each has a small, well-scoped, low-to-medium-regression-risk fix already outlined above, and three of the four already have a correct reference implementation living elsewhere in the same codebase. The remainder of the system — architecture, security-rules *content*, offline persistence, the newer service modules, accessibility/reduced-motion handling, and build cleanliness — is genuinely solid and does not need to be re-litigated.

This is not a verdict on the team's capability; the presence of `docs/KNOWN_LIMITATIONS.md` (an unusually honest self-disclosure document) and the correctly-implemented backup/restore/PO/billing subsystems both indicate the opposite. It is a verdict on the current state of four specific, identified gaps that must close before this application is safe to run a real workshop's books on.

**Path to PASS:** Complete remediation items 1-6 in §11 (Critical fixes + CI). At that point the honest verdict would move to **PASS WITH OBSERVATIONS**, with the remaining High/Medium findings (chiefly the `InventoryDashboard.js` decomposition) tracked as ongoing technical debt rather than launch blockers.
