# Release Notes — Balaji Auto OS v1.0.0

Offline-first auto-parts and garage ERP for Indian workshops.
Next.js 14 · React 18 · Firebase Firestore.

## Release gate (all green)

    next build            ✓ compiled successfully
    undefined-identifier  0 real (4 known false positives: CSS/self/caches, all guarded)
    TDZ scan              0
    npm test              151/151 test files passing (Node/jsdom)
    npm run test:rules    261/261 emulator assertions (2 files)
    ─────────────────────────────────────
    CI (.github/workflows/ci.yml)  lint · build · test — green

The suite grew from 119 files at the original tag to 151 through the post-release
reliability & integrity program (see [CHANGELOG.md](CHANGELOG.md) and
[ROADMAP.md](ROADMAP.md)); `test:rules` runs against the Firestore emulator and is a
local/CI-optional gate.

See [testing/TESTING.md](testing/TESTING.md) for what each suite covers and the
verification ceiling.

## What this release certifies (executable, against real code)

- **Transaction engine** — pay/cancel cascade is reversible, idempotent, never
  double-counts; totals derive from line items; a stale stored `grandTotal` is ignored;
  no-duplicate, monotonic invoice numbering (a deliberate gap can occur if a save fails
  after a serial is allocated — legal under GST Rule 46(b); a duplicate never can);
  refuses to consume stock beyond what was paid for.
- **Every Vehicle KPI** matches the underlying data.
- **Search** is sub-millisecond at real dataset size (350 vehicles / ~2,500 records).
- **Every export** is a real `.xlsx`: date cells, sized columns, numeric money, no
  column shift.
- **One design system** for badges, dropdowns, focus handling.
- **Login** is an 8.59 KB pure-CSS boot experience with auth fully preserved.

## Highlights

- The ₹71.35 Cr revenue miscalculation is fixed and tested.
- Vehicle search went from 36 seconds per keystroke to sub-millisecond.
- Every Excel export opens correctly in Excel, LibreOffice and Google Sheets.
- New "Ignition" login — premium automotive boot sequence, lightweight, accessible.

## Verification ceiling (read this)

Everything above is verified by executing code in Node/jsdom. It is NOT verified in a
real browser or against live Firestore. Not covered: actual rendering, pixel layout,
print/PDF output, and Lighthouse metrics (FCP/LCP/TBT/CLS). A human must click through
a deployed build before final sign-off. See KNOWN_LIMITATIONS.md.

Several ceiling items listed here at the original tag — multi-client concurrency,
duplicate-action idempotency, refresh/offline recovery, live multi-client Firestore
behaviour — were subsequently addressed and verified with 2–3 concurrent clients
against the Firestore emulator and the production project during the post-release
reliability program (see CHANGELOG.md). The automated suite is still Node/jsdom, so the
browser-rendering / print / Lighthouse ceiling and full real-device browser coverage
still stand and remain a manual release-QA step.

## Before you go live — REQUIRED, not code

See [deployment/DEPLOYMENT.md](deployment/DEPLOYMENT.md) § 1 "Security — DO THIS FIRST".
Two configuration steps (publishing the Firestore rules to your Firebase project and
setting a strong owner password) gate whether a deployment is safe, and neither can be
fixed in the codebase.
