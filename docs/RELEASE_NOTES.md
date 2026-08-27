# Release Notes — Balaji Auto OS v1.0.0

Offline-first auto-parts and garage ERP for Indian workshops.
Next.js 14 · React 18 · Firebase Firestore.

## Release gate (all green on the frozen build)

    next build            ✓ compiled successfully
    undefined-identifier  0 real (4 known false positives: CSS/self/caches, all guarded)
    TDZ scan              0
    ─────────────────────────────────────
    218 automated assertions, 0 failures

    overpayment     7    dropdowns      14    export         15
    regression     46    scrolllock     10    settings-dirty 14
    statcards      18    vehiclestats   33    perf           20
    ui-consistency 15    certification  26

## What this release certifies (executable, against real code)

- **Transaction engine** — pay/cancel cascade is reversible, idempotent, never
  double-counts; totals derive from line items; a stale stored `grandTotal` is ignored;
  gapless invoice numbering; refuses to consume stock beyond what was paid for.
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
live Firestore round-trips, concurrency across devices, offline recovery, print/PDF
output, and Lighthouse metrics (FCP/LCP/TBT/CLS). A human must click through a deployed
build before final sign-off. See KNOWN_LIMITATIONS.md.

## Before you go live — REQUIRED, not code

See DEPLOYMENT_GUIDE.md § "Security — do this first". Two configuration steps
(publishing Firestore rules, changing the owner password) gate whether this deployment
is safe, and neither can be fixed in the codebase.
