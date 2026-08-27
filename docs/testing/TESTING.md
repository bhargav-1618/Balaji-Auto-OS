# Testing — Balaji Auto OS

> This file replaces the old `docs/RUN_TESTS.md`. Its original "reproducing the suite"
> content is unchanged below; the sections after it summarize the QA coverage areas and the
> environment's verification ceiling.

## Reproducing the test suite

Everything here runs the REAL shipped code — the logic under test is never mocked.

## Setup (once)
    npm install

The Node/jsdom test harness's dependencies (jsdom, @testing-library/*, @babel/*)
are ordinary devDependencies in package.json — no separate install step needed.

## Build + static scanners
    npx next build
    node tools/scan-undef.cjs .      # undefined Program-level identifiers (crash catcher)
    node tools/scan-tdz.cjs .        # temporal-dead-zone reads (the payments bug)

## The suite
    npm test                   # runs every tests/*.test.cjs file
    node tests/<name>.test.cjs # or run a single suite directly

## What each covers
    certification    transaction engine: pay/cancel cascade, stock, ledger, idempotency
    overpayment      cannot overpay or mark-paid-while-overpaid
    vehiclestats     every dashboard KPI vs known data
    perf             per-keystroke budget (5ms) at real dataset size
    export           real .xlsx: date cells, column widths, numeric, no column shift
    dropdowns        portal, keyboard, mouse, Esc, no absolute-positioned panels
    scrolllock       one reference-counted body lock (no second writer)
    settings-dirty   dirty-state normalisation
    ui-consistency   one badge system, one status map, a11y guards
    regression       the interaction paths the fixes could have broken

## Benchmarks (informational)
    node bench/search.cjs      # 36,442ms -> 0.03ms per keystroke, measured
    node bench/customers.cjs
    node bench/inventory.cjs

## QA coverage areas

Automated (`tests/*.test.cjs`, run by `npm test`) and manual/browser QA are complementary —
see "Verification ceiling" below for exactly where the line falls.

- **Functional** — module-level regression suites per feature area (billing, job cards,
  customers, vehicles, inventory, suppliers). `regression.test.cjs` specifically re-checks
  interaction paths that a past fix could have re-broken.
- **Settings** — `settings-dirty.test.cjs` (dirty-state normalisation),
  `settings-nav-guard.test.cjs` (unsaved-changes navigation guard).
- **Mobile** — `app-shell-mobile-drawer-scroll.test.cjs` and friends assert structural facts
  (scroll container ownership, safe-area padding) about the mobile drawer; actual rendered
  layout at phone/tablet breakpoints is manual/browser QA (see ceiling below).
- **Search** — `search-accuracy-exact-identifier.test.cjs` and `search-framework-consistency
  .test.cjs` verify the shared ranking engine (`lib/useSearch.js`'s `rankIndexed`/
  `matchIndexed`) end to end: exact/prefix/suffix/contains tiers for identifier fields,
  substring matching for free-text fields, and that every module's search box goes through
  the same engine rather than a hand-rolled one. `universal-search-boxes.test.cjs` and
  `jobcard-search-ranking.test.cjs`/`customer-search-ranking.test.cjs` cover individual boxes.
- **Audit** — `security-rules.test.cjs`, `deploy-security.test.cjs`, `demo-isolation.test.cjs`
  verify the append-only audit ledger and that demo mode cannot reach production data/rules.
- **End-to-end** — `workflow-day.test.cjs`, `workflow-edits.test.cjs`,
  `workflow-billing-day.test.cjs`, `workflow-edit-cascade.test.cjs`, `invoice-prefill.test.cjs`
  trace a full business flow (Job Card → Billing → Payment → stock) rather than one function.
- **PDF/Excel** — `pdf-framework-consistency.test.cjs`, `pdf-framework-readability.test.cjs`,
  `pdf-visual-overlap-bugs.test.cjs`, `report-pdf-export.test.cjs`, `billing-combined-pdf
  .test.cjs`, `export.test.cjs` assert structural facts about the shared PDF/Excel writers
  (`lib/pdfTheme.js`, `lib/exportSheet.js`) — correct headers, no raw-number/currency-format
  regressions, real `.xlsx` cell types. Actual rendered PDF pixels (clipping, pagination,
  overlap) require generating a real file and opening it — see ceiling below.
- **Regression** — `revenue-consistency.test.cjs`, `overpayment.test.cjs`,
  `certification.test.cjs`, `analytics-scores.test.cjs` are cross-module financial-integrity
  invariants, run on every change to money-adjacent code.
- **Data integrity** — the same financial/regression suites above, plus manual verification
  against Firestore's own local IndexedDB cache
  (`indexedDB.open('firestore/[DEFAULT]/<project>/main')` → `remoteDocumentsV14`) as ground
  truth when validating a live workflow end to end.

## Verification ceiling (known environment limitations)

The Node/jsdom suite verifies **logic and wiring**, not rendered pixels. It does **not**
cover: real browser layout/responsive rendering, actual print/PDF/xlsx file output (only that
the generator is called with correct, well-formed data), live Firestore round-trips, focus/
keyboard visibility, or performance at real-world scale. These require manual QA in an actual
browser against a real (or demo) Firestore project. See
[docs/KNOWN_LIMITATIONS.md](../KNOWN_LIMITATIONS.md) for the full, honestly-disclosed list —
including single-location invoice-numbering concurrency and the absence of list
virtualisation — which is not repeated here to avoid two copies drifting apart.
