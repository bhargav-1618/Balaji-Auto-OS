# `tests/` — Automated Test Suite

The regression safety net for Balaji Auto OS — run `npm test` for the current pass count.
Tests run in plain Node (no browser) and combine two techniques — static source assertions
and standalone logic harnesses — to verify behaviour that can be checked without a rendering
engine.

## How the suites work

Each suite is a self-contained `.cjs` file with a tiny assertion helper:

```js
const ok = (name, cond) => { /* increments pass/fail, prints ✓/✗ */ };
// ... assertions ...
console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
```

Two kinds of checks appear together:

1. **Source assertions** — read a component file and assert structural facts (a handler is
   wired, a dep array is correct, an export routes through the shared writer, a dead prop is
   gone). These guard against regressions in wiring and conventions.
2. **Logic harnesses** — re-implement or import a pure function and assert its output on
   representative inputs (financial totals, status transitions, search ranking, KPI
   aggregation). These verify calculations directly.

## Coverage map (selected)

- **Financial integrity:** `revenue-consistency`, `overpayment`, `certification`,
  `analytics-scores` — cross-module money invariants.
- **Workflows:** `workflow-day`, `workflow-edits`, `workflow-billing-day`,
  `workflow-edit-cascade`, `invoice-prefill` — end-to-end business flows.
- **Modules:** `vehicles-module`, `billing-action-menu`, `supplier-polish`,
  `supplier-performance`, `jobcard-hardening`, `jobcard-phaseb`, `reports-polish`,
  `reports-overview`, `sales-detail-dialog`, `services-detail-dialog`, and more.
- **Security/isolation:** `security-rules`, `demo-isolation`, `deploy-security`.

## Running

```bash
npm test                                   # every tests/*.test.cjs file
node tests/revenue-consistency.test.cjs    # a single suite
```

See `docs/testing/TESTING.md` for expected output.

## Firestore Security Rules tests (separate)

`tests/rules/` tests `firestore.rules` against the real rules engine via the Firebase
Emulator. It's excluded from `npm test` (a non-recursive glob skips subdirectories) since it
needs a JVM and a running emulator — a heavier dependency than the rest of the suite. Run it
with `npm run test:rules`.

## Verification ceiling (important)

These tests run in Node/jsdom. They verify **logic and wiring**, not rendered pixels. The
following are **not** covered here and require real-browser QA: layout/responsive rendering,
print/PDF/xlsx downloads, live Firestore round-trips, focus/keyboard visibility, and
performance at scale. Suites never claim to verify browser-only behaviour.

## Best practices for new suites

- Assert the smallest stable fact that proves the behaviour; avoid brittle wide-window
  regexes.
- For calculations, prefer a logic harness over a source assertion.
- Keep each suite independent and side-effect free; end with the pass/fail summary + exit
  code so the loop runner can aggregate results.

## Related tooling

`tools/` contains static scanners (`scan-undef`, `scan-tdz`) run alongside the suite to
catch undefined identifiers and temporal-dead-zone hazards. `bench/` holds micro-benchmarks
for search/list operations.
