# Changelog — Balaji Auto OS

All notable changes to this project. Format loosely follows Keep a Changelog.
This is the first public release; entries below summarise the stabilisation work that
produced it, grouped by area rather than by date.

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
