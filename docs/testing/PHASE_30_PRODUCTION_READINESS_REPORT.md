# Phase 30 — Production Readiness / Release Audit (Stage 1: discovery / validation)

Date: 2026-09-09 · HEAD `11b4f81` · branch `main` (== `origin/main`)
Mode: **discovery only — no production code changed, zero production mutations.**

This is the final release-readiness audit. Prior-phase results were treated as
evidence, not assumption; every externally-checkable claim was re-verified.

---

## RELEASE GATE STATUS: **READY WITH CONDITIONS**

No CRITICAL. No new HIGH *code* defect. The blocking items are **deployment /
configuration** (not code) plus documentation cleanups.

| Sev | Count | IDs |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 1 | PH30-C1 |
| MEDIUM | 1 | PH30-M1 |
| LOW | 5 | PH30-K1, PH30-K2, PH30-K3, PH30-K4, PH30-K5 |
| INFO | 6 | PH30-I1, PH30-I2, PH30-I3, PH30-B1, PH30-F1, PH30-L1 |

---

## A. Git / repository hygiene — PASS

- Working tree clean; `main` == `origin/main` == `11b4f81`. 347 tracked files.
- `.gitignore` is thorough — `.env*` (all variants), `.next/`, `.claude/`, `*.log`,
  `firebase-debug.log*`, `firestore-debug.log*`, `node_modules/`, `.vercel`,
  `/coverage`, `/scratch/` all ignored. `git status --ignored` shows only those.
- **No stray artifacts** — no screenshots, videos, tmp/bak/orig files, test output, or
  personal/system files tracked. The only images are 3 PWA icons in `public/icons/`.
- Largest tracked files are all legitimate source: `InventoryDashboard.js` (1.0 MB /
  16,259 lines), `package-lock.json` (623 KB), `icon-512.png` (306 KB),
  `BillingModule.jsx` (246 KB), `lib/partPhotos.js` (201 KB base64 demo photos —
  tracked as a ROADMAP "Code health" item).
- `firestore.indexes.json` = `{ "indexes": [], "fieldOverrides": [] }` — correct (every
  live query is single-field or client-side; Phase 25).
- **Full-history secret scan — CLEAN.** `.env.local` / `.env*` **never committed**
  (`git log --all -- .env.local` empty). No service-account JSON, no
  `-----BEGIN … PRIVATE KEY-----`, no `ghp_…` / `sk_live_…` / `xox…` in any commit.
  The only key-shaped string in the whole history is a single **Firebase Web client
  `apiKey`** (`AIza…`, one distinct value) in `.github/workflows/ci.yml` — carried
  forward across every commit. → **PH30-I1** (INFO): this is a *public client*
  identifier by Firebase's design (the security boundary is `firestore.rules`, not key
  secrecy), it is referrer-restricted (verified in a prior phase), and the workflow's
  own header comment documents the decision. Not a leak. Best practice would move it to
  GitHub Actions `vars`, but that is cosmetic.
- `docs/CHANGELOG.md` covers only the pre-1.0 stabilization work and is silent on
  Phases 1b–29 — see **PH30-K1**.

## B. Environment / configuration — PASS

Every configuration value, classified:

| Value | Class | Notes |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | safe client | public by design; referrer-restricted |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | safe client | `balaji-auto-os-7.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | safe client | `balaji-auto-os-7` (intentional, `.firebaserc`) |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | safe client | `.firebasestorage.app` |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | safe client | numeric sender id |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | safe client | `1:…:web:…` |
| `NEXT_PUBLIC_SITE_URL` | safe client, optional | QR origin for PDFs; documented fallback chain |
| `NODE_ENV` | build-time | drives the dev-only CSP `'unsafe-eval'` in `next.config.js` |

- **No secret is exposed through a `NEXT_PUBLIC_` variable** — a grep for any
  `NEXT_PUBLIC_` identifier that is not one of the seven above returns nothing.
- `lib/firebase.js` fails fast with an actionable error if any of the six Firebase
  values is missing. **There is no emulator wiring in the client** — `next dev` and the
  Vercel production build both connect to the real `balaji-auto-os-7` project. Demo mode
  is the only "no backend" path and it is a hard client-side branch (see E).
- `next.config.js`: HSTS (2yr, preload), `X-Frame-Options: SAMEORIGIN`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, and a
  tuned **Content-Security-Policy** (`object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`, no `'unsafe-eval'` in production — dev-only for Fast Refresh).
- No `vercel.json` — Vercel uses framework defaults + dashboard-set env vars
  (acceptable; documented in README/DEPLOYMENT).
- `BOOTSTRAP_ADMINS = ['konabhargav2003@gmail.com']` in `context/AuthContext.js` ships
  in the client bundle. → **PH30-B1** (INFO): intentional and documented (the permanent
  "owner can never be locked out" safety net); the email is already public via git
  authorship. Not a finding, recorded for completeness.

## C. Firebase / security release gate — **PH30-C1 (HIGH) + PH30-C2 (condition)**

Three-layer comparison, as required:

### REPOSITORY RULES
`firestore.rules` @ `11b4f81` — 328 lines. Last content change: `d5e784d`
(2026-09-06, "harden Firestore field integrity" = PH20-01). Rules-touching commits:
`8554564` → `6bfb88d` → `189dfdc` (lease) → `fb373ee` (counters) → `9944e0f` (lease
`sameSession()`) → `b8824d5` (`pendingSales`) → `7b5520c` (auditLog `performedBy`) →
`d5e784d` (auditLog `performedByEmail` + `createdAt`).

### EMULATOR-VALIDATED RULES
`npm run test:rules` re-run this session → **2/2 files, 261 assertions
(150 + 111), 0 failed.** Covers actor identity, role/permission data
(`appSettings` admin-only), ledger immutability (`update: if false`), monotonic
invoice numbering, recovery data, `editLocks` uid+session, `pendingSales` creator
scope, unauthenticated deny, and a 111-assertion field-forgery matrix. The emulator
runs the **repository** ruleset.

### ACTUALLY DEPLOYED PRODUCTION RULES
Re-verified **today (2026-09-09)** by unauthenticated REST against the live project
(read-only, non-destructive):

```
GET  …/documents/customers        → HTTP 403      GET …/documents/counters       → 403
GET  …/documents/invoices         → HTTP 403      GET …/documents/appSettings    → 403
GET  …/documents/parts            → HTTP 403      GET …/documents/recoveryVault  → 403
GET  …/documents/auditLog         → HTTP 403      GET …/documents/editLocks      → 403
GET  …/documents/pendingSales     → HTTP 403      GET …/documents/salesRollups   → 403
POST …/documents/auditLog  (unauth create)        → HTTP 403  (nothing written)
```

**A hardened ruleset IS deployed and enforcing** — `read: if signedIn()` and
deny-by-default are live (re-confirms Phases 19–20).

**BUT the deployed ruleset is NOT confirmed to be the current repo ruleset.** The
`auditLog` **create** delta from PH15-03 (`7b5520c`) + PH20-01 (`d5e784d`) —

```
allow create: if signedIn()
  && request.resource.data.performedBy      == request.auth.uid          // live (PH15-era)
  && request.resource.data.performedByEmail == request.auth.token.email  // NOT deployed
  && request.resource.data.createdAt        == request.time;             // NOT deployed
```

— is documented as **not yet published** (`docs/KNOWN_LIMITATIONS.md` §🔴; `d5e784d`'s
own commit body: *"RULES DEPLOYMENT (owner action required)"*). The unauthenticated 403
above only proves `signedIn()` is required — it cannot prove the field pins. Until they
are deployed, **a signed-in user can INSERT a forged `auditLog` entry** with an
impersonated `performedByEmail` (the string the Audit Log UI *displays* as the actor)
and a back-dated `createdAt`. Real history stays immutable (`update: if false`,
`delete: if isAdmin()`) — this is insertion, not alteration. **The client already
writes the correct values, so the fix is a deploy with no code change.**

> **PH30-C1 (HIGH)** — deploy the current `firestore.rules`:
> `npx firebase login && npx firebase deploy --only firestore:rules --project balaji-auto-os-7`
> then confirm (Rules Playground, signed in as a non-owner) that an `auditLog` create
> with a foreign `performedByEmail` or a non-`request.time` `createdAt` is denied.
> Real-world impact is bounded (single trusted shop, insertion-only, immutable history),
> hence HIGH not CRITICAL — but it is an explicit, repeatedly-deferred security gate.

> **PH30-C2 (condition)** — the bootstrap owner account
> (`konabhargav2003@gmail.com`) must have a strong password (`KNOWN_LIMITATIONS` §🔴 #2).
> Not verifiable from this environment; standing per-deployment requirement.

Also not independently re-provable without credentials (emulator-verified + asserted
published): the `editLocks` `sameSession()` clause (`9944e0f`) and `pendingSales`
scoping (`b8824d5`). The docs state these predate the pending auditLog delta and were
published; the unauth probe is consistent with that but does not prove it.

CI (`.github/workflows/ci.yml`) does **not** deploy rules and does not run
`test:rules` — see **PH30-I3**.

## D. Authentication / authorization — PASS (subject to C)

- **Route protection**: `pages/index.js` redirects to `/login` unless `user || demoMode`;
  renders `BootSplash` while `loading`. Client-side by nature (client-only Firebase app).
- **Idle timeout**: `startIdleWatch` → `signOut(auth)` + `clearBusinessCaches()` +
  `/login?expired=1` (a shop terminal left on the floor does not stay signed in). Demo
  mode is exempt (no real session).
- **Role model** (`context/AuthContext.js`): `BOOTSTRAP_ADMINS` (code) ∪
  `appSettings/roles.admins[]` (Firestore) → `role ∈ {admin, staff, guest}` +
  `perms {costPrices, deletes, exports}` from `appSettings/roles.staff[email]`.
  `sessionId` is a per-mount `useRef`, never persisted (immune to storage clone — Phase
  7/29).
- **Firestore rules are the enforced boundary** — Phase 19 (full Owner/Admin/Staff/
  Unauth matrix, 24 privileged actions, 148 live emulator assertions) + Phase 20 (261
  forgery assertions). Deny-by-default re-verified live today (section C).
- Accepted / documented, security boundary correct: **PH19-L1** (a Staff `perms.deletes`
  toggle surfaces a "Delete Permanently" button that then fails `delete: if isAdmin()` —
  UX wart, not a hole); OWNER ≡ ADMIN with no transfer mechanism (by design);
  single-shop shared data (intentional).
- → **PH30-K5** (LOW): the role-model comment block in `AuthContext.js` (~line 30) still
  says *"Firestore rules use `request.auth != null` (single-trusted-shop model)"* — the
  shipped hardened rules are stricter (`isAdmin()` on deletes/`appSettings`, field pins
  on `auditLog`/`counters`/`editLocks`/`pendingSales`). Stale description, not a code
  defect.

## E. Demo mode / test-data isolation — PASS

- **Verified live this session**: entered demo mode (`?demo=1`), swept Dashboard →
  Inventory → Sales → Billing → invoice detail → Job Cards. **Zero network requests to
  `firestore.googleapis.com` or any `*.googleapis.com`** — demo mode never contacts the
  backend at all.
- Every Firestore `onSnapshot` subscription and every persist path in
  `InventoryDashboard.js` is gated: `if (demoMode) return;` for subscriptions,
  `if (demoMode) { …local/sessionStorage… } else { …Firestore… }` for writes. Demo
  writes land in `localStorage` / `sessionStorage` under `maruti_*_demo` /
  `STORAGE.DEMO_*` keys (the split is intentional and commented in `constants/index.js`).
- Demo mode **can** be reached in production by appending `?demo=1` / `?demo=admin` —
  **this is intentional** (the "LAUNCH INTERACTIVE DEMO" button on `/login`). Because it
  never initialises a Firestore write path, it **cannot** touch production data or
  config.
- Demo records are unmistakable: a persistent amber "Demo Mode — Safe sandbox. Changes
  stay in this browser and never touch real data." banner, and the signed-in identity
  shows `demo@balajiautoos.com`.
- **PH29-02** (INFO, documented): two demo tabs do not cross-sync business data (demo is
  an eval sandbox, not a multi-user workspace).

## F. Critical business flows — final smoke (demo mode) — PASS

Live smoke pass (demo seed: 123 parts, 744 sales rows, ~280 invoices):

| Area | Result |
|---|---|
| Dashboard | Inventory Health 99%, Workshop Score 83/100, all KPI tiles render, no NaN |
| Inventory — Parts | 123 parts, paginated 25/pg, stock badges (OK/LOW/OUT/Fast/Reorder), prices, filters — all correct |
| Inventory — KPIs | Total 123 / In stock 121 / Value ₹40,17,648 / Potential profit ₹13,89,867 / Low 18 / Out 2 |
| Sales ledger | 744 rows, each part / SKU / date / INV# / customer / qty×price / line total; month KPIs + Avg Margin 35.0% |
| Billing — KPIs & charts | GST ₹5,29,803.18, Parts Rev ₹29,43,351, Labour ₹14,22,676, Avg Invoice ₹16,540, Revenue Trend / Payment Modes / Parts-vs-Labour / Top Customers / Top Parts all render |
| Billing — invoice list | status + payment-mode + time filters, "New Invoice" |
| Invoice detail (paid) | correct state-machine lock — *"This invoice is Paid and locked as history. To make changes, use Duplicate … or issue a Credit Note."* |
| Invoice PDF button | no exception thrown (jsPDF path; sandbox blocks the actual save) |
| Job Card intake | full form renders (intake / client / vehicle / complaints / diagnostics / dashboard-warnings / body-damage map) |
| Console | **zero errors** except one benign `HEAD /outro.mp4 → 404` |

- → **PH30-F1** (INFO): `pages/login.js:64` probes for an optional
  `HEAD /outro.mp4` (a login "departure" video that was never shipped). 404 is handled
  gracefully (`.then(r => setHasOutro(r.ok)).catch(() => setHasOutro(false))`) — the
  feature degrades silently. Cosmetic console noise on every login-page load; harmless.
- Deep per-flow correctness (numbering, realization, reversal, idempotency, PO
  over-receipt, cancelled-PO protection, analytics reconciliation, empty states,
  malformed input) is covered by the executable suites of Phases 9–24 (**151 test
  files**) and was **not** re-litigated here, per the "release smoke pass" instruction.
- Not exercised: **authenticated production write flows** — no credentials in this
  environment (standing limitation across all 30 phases). Quick Sell / payment / PO
  receive / stock adjust against real Firestore, and real multi-terminal behaviour,
  remain browser-QA items for the owner.

## G. Failure / error UX — PASS

- Authoritative money/stock writes are transactional, `opId`-idempotent, fail-fast, and
  surface accurate retry-safe copy (Phases 4b / 5b / 6b / 8b / 26). Ambiguous failures
  keep the `opId` and show a "check the record before retrying" banner; every
  `runTransaction` is bounded by `lib/txTimeout.js` (12s / 6s) without cancelling.
- The 4 `.catch(() => {})` occurrences in `InventoryDashboard.js` are all
  non-authoritative cleanup (`recoveryMeta/current` delete, copy-suffix strip, a
  cleanup loop) — none swallows a money/stock error.
- Documented residuals (`KNOWN_LIMITATIONS.md`): a clean offline failure shows the
  conservative "it may already be recorded" copy (safe direction); **PH21-D2** — a
  forged/corrupt Firestore document with a wrong-type *scalar* nested field can still
  drop a secondary module view into the app-level `ErrorBoundary` (recovery = an admin
  deleting the offending doc; complete fix needs rules type-assertions, deferred).

## H. Performance / resource safety — PASS (vs Phase 25)

- Every live `onSnapshot` remains `limit()`-bounded (parts 2k / customers 1k /
  invoices+jobCards 3k / sales 2k). Pagination/filter/search are client-side over that
  window (documented). No regression found.
- Timer / channel cleanup is disciplined:
  - `hooks/useEditLease.js` — `clearInterval(hbRef.current)` on cleanup; `pagehide`
    listener added and removed.
  - `lib/session.js` — `clearInterval(timer)` returned from `startIdleWatch`.
  - `lib/durableOpId.js` — `BroadcastChannel` closed on `pagehide` (`{ once: true }`).
- **PH29-01 residual 8a** (the original tab losing its own in-flight `opId` continuity
  after a `BroadcastChannel` collision re-mint) is **carried, still open** — see
  `PHASE_29_PH29-01_VALIDATION.md`. Not a Phase 30 regression.
- `components/InventoryDashboard.js` is **16,259 lines** — one keystroke re-renders it
  (made interruptible via `useDeferredValue`; documented perf boundary; the split is a
  post-1.0 ROADMAP item). Feeds **PH30-K3**.

## I. Dependency / build health — PASS

- 9 production dependencies, **all used**. `xlsx` (SheetJS CDN tarball — the vendor's
  own recommended install), `qrcode`, and `jspdf` are loaded via **dynamic `import()`**
  for code-splitting (not dead — my first static grep missed the dynamic sites). `next`
  pinned `14.2.35`.
- devDependencies: Babel 8 preset stack + jsdom + testing-library + `firebase-tools`
  (rules emulator) + eslint/tailwind/postcss. Nothing suspicious; no unusual install
  scripts.
- → **PH30-I2** (INFO): `package.json` has no `engines` field (README/DEPLOYMENT say
  Node 18+, CI uses 22). Adding `"engines": { "node": ">=18" }` would make it explicit.

### Gate results (re-run this session)

```
npm test            → 151/151 test files passed          (16 assertions in the last file shown; 0 failed)
npm run test:rules  → 2/2 rules test files passed         (150 + 111 = 261 emulator assertions, 0 failed)
npm run lint        → exit 0                              (4 warnings, 0 errors — see below)
npm run build       → GREEN on HEAD 11b4f81               (GitHub Actions CI run, conclusion "success";
                                                           also run locally on the functionally-identical
                                                           15cb0ba during the PH29-01 validation. Not
                                                           re-run locally here to avoid clobbering the
                                                           running dev server's .next — see history.)
```

Lint warnings (all pre-existing, benign, 0 errors):
- `react-hooks/exhaustive-deps` — a `useMemo` missing `REMINDER_DAYS` in its dep array
  (`REMINDER_DAYS` is a stable module-level constant; the rule can't tell).
- ×3 `@next/next/no-img-element` — base64 part photos rendered via `<img>` (can't use
  `next/image` for `data:` URIs without extra config; documented).

- → **PH30-I3** (INFO): CI runs `lint` + `build` + `test` on every push but **not**
  `test:rules` (it needs the Firestore emulator + Java). The rules suite is a
  local/manual gate. Adding it to CI (via `firebase emulators:exec`) would close the
  loop.

## J. Deployment consistency — PASS

- `main` HEAD = `11b4f81` ("docs: PH29-01 — final external browser check attempted").
  Functional code is **unchanged since `cc8a2e8`** — `15cb0ba` and `11b4f81` are
  docs/test-only.
- Production `https://balaji-auto-os.vercel.app/` → **HTTP 200**, `Server: Vercel`,
  `bom1` (Mumbai) region, HSTS present, `X-Vercel-Cache: HIT`. Build id
  `eGCrjgNej4uUVetPK4OlD`.
- **The production bundle contains `ph7b:pi`** — the PH29-01 `BroadcastChannel`
  collision-watch from `cc8a2e8` — in
  `/_next/static/chunks/pages/index-*.js`. So the deployed code is current with the
  intended final functional commit.
- CI conclusion on `11b4f81`: **success**. `main` auto-deploys to Vercel on push.
- No deployment performed by this audit.

## K. Documentation accuracy — LOW findings

**PH29-01 is documented accurately** — `KNOWN_LIMITATIONS.md` (Phase 7b entry + the
"PHASE 29 UPDATE" block + the Phase 29 section) and `PHASE_29_PH29-01_VALIDATION.md`
all state: **PARTIALLY CONFIRMED**; real "Duplicate tab" behaviour **not observed**;
the simulated old-implementation failure **was** reproduced (real source executed);
the new `BroadcastChannel` mitigation **defeats the simulated condition** and keeps
same-tab-reload refresh-safety; **residual 8a remains open** unless separately fixed;
no browser-level certainty is claimed. ✔

Findings:

- **PH30-K1 (LOW)** — `docs/RELEASE_NOTES.md` "Release gate (all green)" block claims
  `npm test  119/119 test files passing`. Actual is **151/151** (32 test files added
  across Phases 16–29). Same block's "gapless invoice numbering" is now imprecise —
  Phase 2 guarantees *no-duplicate / monotonic* serials but **allows deliberate gaps**
  (a skipped number on a post-allocation failure, legal under GST Rule 46(b)).
  Also `docs/CHANGELOG.md` stops at the pre-1.0 stabilization and never mentions the
  Phase 1b–29 concurrency/integrity program (the real story lives in
  `KNOWN_LIMITATIONS.md` + `ROADMAP.md`).
- **PH30-K2 (LOW)** — `README.md` line 220 lists, as a known limitation,
  *"single-location concurrency (**invoice numbering is not yet transaction-safe**)"* —
  which **directly contradicts** `KNOWN_LIMITATIONS.md` ("Invoice numbering IS
  concurrency-safe — CONCURRENCY PHASE 2, shipped, rules published, production-verified
  with 1/2/3 concurrent clients") and `ROADMAP.md` (Phase 2 struck through as DONE).
  README line 174 ("multi-terminal concurrency … are open") is likewise stale — Phases
  1b–8b closed numbering, cross-workflow races, idempotency, refresh/network recovery,
  tab lifecycle and transaction atomicity.
- **PH30-K3 (LOW)** — `docs/ROADMAP.md` "Code health" calls `InventoryDashboard.js`
  *"the ~8,600-line composition root"*. It is **16,259 lines** — the file nearly
  doubled across the phase program. Understates the tech-debt item by ~2×.
- **PH30-K4 (LOW)** — `README.md` "Browser Support" table flatly marks
  Firefox and Safari (desktop & iOS) **"Supported"**. Phase 27 explicitly ran only
  **Chromium/Chrome 148 desktop + Chrome mobile device-emulation** and states *"NOT run
  and NOT claimed as verified: real Android Chrome, real iOS Safari, desktop Firefox,
  desktop Edge."* The table is stronger than the evidence (README does hedge nearby
  with "should be validated in-browser as part of release QA", and Edge≡Chromium is a
  fair engine-equivalence call).
- **PH30-K5 (LOW)** — stale rules-model comment in `context/AuthContext.js` (see D).

## L. Dead code — INFO

Conservative pass (REMOVE → REUSE → EXTEND → CONSOLIDATE → ADD):

- **PH30-L1 (INFO)** — `demoGuard()` at `components/InventoryDashboard.js:8801` is
  **defined and never called** (grep: one hit, the definition). Proven unreferenced —
  no dynamic call, not in tests, not a hook/route. The real demo write-protection is
  `demoCan()` / `demoBlockedTab()` / inline `if (demoMode) { notify.permissionDenied(…) }`
  guards. Phase 19 already flagged this (accepted finding #3). A 4-line REMOVE candidate
  for Stage 2 — no behaviour change.
- `services/billingService.js` `revenueLines` / `ledgerDelta` — the **tested twin** of
  the component-scoped production copies (`invoiceRevenueLines` /
  `planInvoiceRealization`). "Not wired into production" — both copies carry the same
  fixes and are tested, but this is a maintain-two-copies hazard, tracked in `ROADMAP.md`
  "Code health" ("finish the `services/` extraction"). Not dead (executed by the suite),
  not removed.
- `lib/demoData.js` `recordInvoiceSalesDelta` — its dead production branches were
  already removed in Phase 14 (preventative hardening); the function itself is still
  reached from the demo realization path.
- **No unreferenced module** found in `services/` / `hooks/` / `lib/` / `repositories/`
  — every file is imported by ≥1 non-test consumer.

## M. Production data safety — PH30-M1 (MEDIUM)

Production Firestore could not be inspected directly (no credentials — the standing
limitation). From the most complete accounting on record —
`docs/testing/FINAL_PHASE_1_15_BASELINE_REPORT.md` §12, plus the concurrency Phase
6b / 7 residue notes:

| Collection | Documented state | Why it looks like QA data |
|---|---|---|
| `parts` | 0 live documents | all QA test parts removed in earlier phases |
| `customers` | `CUST-0001` "QA Production Smoke Test" (`qa-smoke-test@example.test`, 1 vehicle, 1 invoice ₹1,680); `CUST-0002` "ZZ-QA-PH6B-CUSTOMER" / "ZZ-QA-PH7-CUSTOMER" | explicit QA names; `CUST-0001` is the *only* customer/vehicle/invoice in the project |
| `sales` | ~9 immutable rows referencing `ZZ-QA-PH5B-PART`, `ZZ-QA-PH4B-PART`, `ZZ-QA-PH4-PART`, `PH9-ORPHAN-PART` (incl. one `-1` reversal) | append-only ledger residue from concurrency-phase testing |
| `restocks` / `stockAdjustments` | QA-part rows referencing now-deleted parts | same |
| `counters/invoices` | **deleted** (Console) | so the next real invoice re-seeds as `INV-0002` |

- **Impact if the owner starts real operations on this same project:** `CUST-0001`'s
  QA customer/invoice **will** appear in Customers and Billing lists; the ~9 QA sales
  rows **will** appear in Sales, analytics, and the dashboard "Insights"
  ("ZZ-QA-PH5B-PART is trending"). On a fresh project — no effect.
- **No safe in-app cleanup path exists** for the immutable ledger rows (deleting them
  via Console would violate the append-only invariant the whole program protects).
- **Recommendation (owner action — NOT performed here):** before real go-live, either
  do a deliberate Firestore Console / script reset of `parts` / `customers` /
  `vehicles` / `invoices` / `jobCards` / `sales` / `restocks` / `stockAdjustments` /
  `purchaseOrders` / `reorderRequests` / `counters`, **or** point the production
  deployment at a fresh Firebase project (updating the six `NEXT_PUBLIC_FIREBASE_*`
  Vercel vars and `.firebaserc`, and re-publishing `firestore.rules` there).

**Zero production mutations were performed in this audit.** One unauthenticated
`auditLog` POST probe returned 403 and wrote nothing (identical to Phase 20's probe).

---

## N. Findings — detail

### PH30-C1 — Firestore rules not fully deployed (HIGH)

- **AREA:** C — Firebase / security release gate
- **REPRODUCTION:** compare `firestore.rules` @ `11b4f81` (auditLog `create` requires
  `performedByEmail == request.auth.token.email` AND `createdAt == request.time`)
  against the live project. `docs/KNOWN_LIMITATIONS.md` §🔴 and `d5e784d`'s commit body
  both state the delta is unpublished; CI does not deploy rules.
- **EXPECTED:** a signed-in non-owner client cannot create an `auditLog` document
  attributing an action to another user or at a back-dated time.
- **ACTUAL (documented / inferred):** on the live rule (pre-PH15 `create` form) a
  signed-in client can insert an `auditLog` entry with an arbitrary `performedByEmail`
  and `createdAt`. The unauthenticated 403 probe this session confirms `signedIn()` is
  required but cannot exercise the field pins.
- **EVIDENCE:** live REST probe (section C) + `KNOWN_LIMITATIONS.md` lines 20–42 +
  `d5e784d` commit message "RULES DEPLOYMENT (owner action required)".
- **IMPACT:** audit-trail *insertion* forgery (impersonated actor / timestamp). Real
  history remains immutable (`update: if false`, `delete: if isAdmin()`). Single
  trusted-shop context bounds the practical risk.
- **RECOMMENDATION:** `npx firebase login && npx firebase deploy --only firestore:rules
  --project balaji-auto-os-7`; then verify in the Rules Playground. **No code change.**

### PH30-M1 — QA/test data in the production Firebase project (MEDIUM)

- **AREA:** M — production data safety
- **REPRODUCTION:** sign in to `balaji-auto-os-7`; observe `CUST-0001` "QA Production
  Smoke Test" is the only customer, plus `CUST-0002` "ZZ-QA-PH6B/PH7-CUSTOMER" and ~9
  `ZZ-QA-*` sales-ledger rows.
- **EXPECTED:** a project presented as production-ready starts empty (or with only real
  business data).
- **ACTUAL:** the project has served as the iterative test environment for 30 phases;
  it holds QA customers/invoice/ledger residue and 0 live parts.
- **EVIDENCE:** `FINAL_PHASE_1_15_BASELINE_REPORT.md` §12; memory of concurrency
  Phases 6b/7.
- **IMPACT:** if real operations begin on this project, QA records surface in
  Customers / Billing / Sales / analytics until cleaned. None on a fresh project.
- **RECOMMENDATION:** owner resets the listed collections, or deploys against a fresh
  Firebase project. Not performed autonomously (destructive).

### PH30-K1..K5 — documentation staleness / contradiction (LOW ×5)

See section K. All are doc-only edits for Stage 2; none affects runtime.

### PH30-I1..I3, PH30-B1, PH30-F1, PH30-L1 — INFO

See sections A, B, F, I, L. No action required for release; PH30-L1 (`demoGuard()`) and
PH30-I2/I3 are optional Stage-2 tidy-ups.

---

## STAGE 1 EXIT

1. **RELEASE GATE STATUS:** READY WITH CONDITIONS
2. **CRITICAL:** 0 — none
3. **HIGH:** 1 — PH30-C1 (deploy `firestore.rules`; auditLog actor/timestamp pins not live)
4. **MEDIUM:** 1 — PH30-M1 (QA/test data in the production Firebase project)
5. **LOW:** 5 — PH30-K1 (RELEASE_NOTES `119/119` + CHANGELOG gap), PH30-K2 (README
   "invoice numbering not yet transaction-safe" — contradicts reality), PH30-K3
   (ROADMAP "~8,600-line" → 16,259), PH30-K4 (README browser-support table over-claims
   Firefox/Safari), PH30-K5 (stale rules comment in `AuthContext.js`)
6. **CONDITIONS REQUIRED BEFORE RELEASE:**
   1. Deploy `firestore.rules` to `balaji-auto-os-7` and verify the `auditLog` field
      pins in the Rules Playground (PH30-C1).
   2. Confirm a strong password on the bootstrap owner account (PH30-C2).
   3. Choose the production-data path: reset QA residue in `balaji-auto-os-7`, or go
      live on a fresh Firebase project (PH30-M1).
   4. *(Recommended, non-blocking)* fix the 5 LOW documentation items — especially the
      README invoice-numbering contradiction — before presenting as "completed".
7. **PRODUCTION CHANGES REQUIRED:** NO — no production **code** change is indicated.
   PH30-C1 / C2 / M1 are deploy / configuration / owner actions; PH30-K* are docs.
8. **PRODUCTION MUTATIONS PERFORMED:** ZERO (one unauthenticated `auditLog` POST probe
   → 403, wrote nothing).
9. **REMAINING KNOWN UNCERTAINTIES:**
   - Exact deployed-ruleset content — only the unauthenticated-deny subset is
     externally verifiable; the authenticated clauses (auditLog field pins, `editLocks`
     `sameSession()`, `pendingSales` scope) are emulator-verified + asserted-published,
     not re-provable without credentials.
   - PH29-01: real-Chrome "Duplicate tab" `window.name`-clone behaviour still unobserved
     (PARTIALLY CONFIRMED; residual 8a open) — carried from the PH29-01 validation.
   - Real-browser rendering / Lighthouse / iOS Safari / Firefox / print-PDF pixels — the
     standing Node/jsdom "verification ceiling".
   - Owner-account password strength — not checkable from this environment.
   - Exact current production QA-residue inventory — from the Phase 15 baseline + 2
     known post-baseline customer docs; not re-enumerated (no credentials).
   - Authenticated production write flows (Quick Sell / payment / PO receive / stock
     adjust / multi-terminal) — never exercisable in this environment.
10. **EXACT NEXT STEP:**
    Owner runs `npx firebase login` then
    `npx firebase deploy --only firestore:rules --project balaji-auto-os-7`, and
    confirms in the Rules Playground (as a non-owner) that an `auditLog` create with a
    foreign `performedByEmail` or a non-`request.time` `createdAt` is denied. In
    parallel: confirm the owner password, and decide existing-vs-fresh Firebase project
    for go-live. Once those are done, Phase 30 Stage 2 handles the 5 LOW documentation
    fixes (and optionally PH30-L1 / I2 / I3) — **no production-code changes indicated.**
