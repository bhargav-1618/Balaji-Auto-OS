# Phase 23 — Deep Adversarial Re-Audit, Round 2

**Purpose.** A third independent pass. Do not trust the Phase 23-DEEP CONDITIONAL
PASS. Trace the paths production actually executes (not the tested-but-unused
`billingService` twins), re-run mutation testing, and hunt for another

> source correct → intermediate calculation wrong → plausible UI result

defect — of exactly the kind PH23-01 (invoice discount in the ledger) and PH23-D1
(analytics COGS = live catalogue) already were.

**Outcome — one new MEDIUM defect (`PH23-D2`), fixed.**

| ID | Sev | One-line |
|---|---|---|
| **PH23-D2** | MEDIUM | The Billing "**Outstanding**" and "**Pending Payments**" KPIs (red danger figures) and the per-customer **Outstanding** / **Total Spent** totals summed `invTotals(iv).balance` / `.paid` over **every invoice except Cancelled** — so a **Draft** (work-in-progress, never billed) and an **Estimate** (a quote) each read as their full grand total *owed*, and a **Refunded / Returned** sale still counted as revenue and its returned payment as "spent". A ₹9,440 draft made the dashboard say the shop was owed ₹9,440 nobody had been billed. The app's own list filter, `computeWorkshopProgress`, and `isRealized` all use the correct predicate; these three aggregators did not. |

PH23-01 and PH23-D1 both **re-confirmed** (rounding-exact; live-verified). Mutation
testing re-run: **16 / 16** deliberate corruptions caught (the 6 from DEEP-1 plus 10
new, incl. PH23-D2 and rounding). No `firestore.rules` change. `npm test` 144/144,
`npm run test:rules` 2/2, lint 0, build ✓. PH23-D2 fix **live-verified** in demo mode.

**FINAL CLASSIFICATION: CONDITIONAL PASS** — the analytics *math* is sound and
independently verified (revenue / cost / profit / margin / rollups / reversals /
dates), PH23-D2 is fixed with an independent oracle + live check, and the only
condition on an unqualified PASS is that **authenticated production reconciliation
was not performed** (tooling limitation — no authenticated production session).

---

## 1. Method

- **Traced the shipped path only.** `billingService.revenueLines` / `ledgerDelta` are
  exported and tested but **not imported by production** (DEEP-1 §28); this round
  worked from `InventoryDashboard.invoiceRevenueLines` / `planInvoiceRealization` /
  `recordInvoiceSalesDelta` / `syncCustomerTotals` and `BillingModule.stats` — the
  code that runs.
- **Enumerated every rollup writer** (`applyRealizationPlanInTx`, `runQuickSaleTx`) and
  every `.balance` / `.paid` / `outstanding` aggregation site (6 found).
- **Independent probes** (`scratchpad/d2-*.cjs`) reproducing `syncCustomerTotals` and
  the `stats` loop line-for-line, checked against hand-computed correct values.
- **Mutation testing** — corrupt the expected values, confirm the assertions fail.
- **Live demo validation** of PH23-D2 end to end.

## 2. PH23-01 and PH23-D1 re-confirmation

| | Result |
|---|---|
| **PH23-01** (invoice-level discount folded into the ledger via `afterDisc/sub`) | **CONFIRMED** — 7 adversarial rounding cases (`§13` of `analytics-integrity.test.cjs`), worst drift `8.5 × 10⁻¹⁴`; `Σ allocated revenue == totalsOf().afterDisc` in every case. |
| **PH23-D1** (analytics COGS from the invoice line's `purchasePrice` snapshot, not the live catalogue) | **CONFIRMED** — `§12` reproduces the shipped `invoiceRevenueLines` + `dCost = a.cost − b.cost` loops with source-pattern guards; legacy-line catalogue fallback still fires; `Σ ledger COGS == totalsOf().profit`-derived. Re-verified live in DEEP-1 (INV-0299). |
| Bonus PH23-D1 effect | The old `dCost = dQty × liveCatalogue` also meant **a fully-reversed sale left permanent rollup drift** if the catalogue moved between realization and reversal (`forward + reversal ≠ 0`). The `a.cost − b.cost` diff makes it exactly 0. |

## 3. Rollup writers — inventory

| Writer | Month key | Fields incremented |
|---|---|---|
| `applyRealizationPlanInTx` (invoice realization) | `` `${now.getFullYear()}-${MM}` `` — **client `new Date()` at plan time** | `revenue, cost, profit, units, partsRevenue, labourRevenue, serviceRevenue, outsideRevenue` |
| `runQuickSaleTx` (Quick Sell) | client `new Date()` at click time | `revenue, cost, profit, units, orders` |

- **`rollup.profit == rollup.revenue − rollup.cost`** holds cumulatively — both writers
  increment all three from the *same* delta in the *same* transaction. No drift
  possible. (`§10` demo reconciliation + property test.)
- The sales-row `createdAt` is `serverTimestamp()` (commit time); the rollup key is
  `new Date()` (plan / click time). At an exact month boundary with clock skew or a
  long transaction retry these could differ by a month → the Reports **trend** (keyed
  by the rollup) and the dashboard **periodAgg** (keyed by `s.createdAt`) would then
  attribute one sale to different months. **INFO / theoretical** — needs a realization
  within seconds of midnight on the 1st; demo `genRollups` derives from `s.createdAt`
  so demo is self-consistent; matches DEEP-1's treatment of the realised-date
  convention. Not fixed.
- `rollup.partsRevenue` / `labourRevenue` / `serviceRevenue` / `outsideRevenue` /
  `orders` are **written but never read** (the trend reads only `revenue`/`cost`/`profit`).
  Quick Sell not populating the category split is therefore harmless. **INFO**.

## 4. The `.balance` / `.paid` / "outstanding" aggregation sites (6)

| Site | Predicate (BEFORE) | Correct? |
|---|---|---|
| `BillingModule.stats.outstanding` | `st !== 'Cancelled'` → sum `t.balance` | ❌ counts Draft + Estimate + Refunded + Returned |
| `BillingModule.stats.pendingCount` | `t.balance > 0 && !iv.isEstimate` | ❌ counts Draft |
| `InventoryDashboard.syncCustomerTotals` — `outstanding` | **no filter** → sum `invTotals(iv).balance` over `mine` | ❌ counts everything |
| `InventoryDashboard.syncCustomerTotals` — `totalSpent` | **no filter** → sum `invTotals(iv).paid` | ❌ counts Refunded / Returned / Cancelled payments |
| `BillingModule.bulkReminder` (WhatsApp) | `totalsOf(iv).balance > 0 && iv.phone` | ❌ would text a customer about a Draft / Estimate "pending balance" |
| `analyticsService.computeAlerts` — billing alerts | `iv.isEstimate || iv.status === 'Cancelled'` excluded | ❌ raises "Outstanding: overdue" for a Draft / Refunded |
| — *for contrast* — `computeWorkshopProgress`, the list `statusF==='Outstanding'` filter | `['Unpaid', 'Partially Paid']` | ✅ **the correct predicate — the app already knew it** |

The app has the right predicate in three places and the wrong (too-loose) one in six.
That is a strong signal PH23-D2 is an oversight, not a "pipeline view" by design — and
the KPI is coloured `SEMANTIC.danger` (red), i.e. "money at risk", not "pipeline".

## 5. PH23-D2 — evidence

### Probe (`scratchpad/d2-cust.cjs`, reproducing `syncCustomerTotals` verbatim)

A customer with: 1 Paid ₹1000, 1 Draft ₹1000, 1 Estimate ₹1000, 1 Partially-Paid
(₹400 of ₹1000), 1 Refunded (₹1000 collected then returned).

| | correct | SHIPPED (before) |
|---|---|---|
| Total Spent | 1400 (1000 + 400) | **3400** (+ refunded 1000 + …) |
| Outstanding | 600 (partial balance) | **2600** (+ draft 1000 + estimate 1000) |

### Live (demo mode, dev server)

Baseline Billing dashboard: Today's Revenue ₹21,637, Outstanding ₹0, Pending Payments
0, Avg Invoice ₹16,165.06.

Created **one Draft dated today, grand ₹9,440** (`DRF-0001`, `balance 9440`):

| KPI | BEFORE the fix | AFTER the fix |
|---|---|---|
| Outstanding | **₹5,900** (a similar earlier draft) | **₹0** — unchanged |
| Pending Payments | **1** | **0** — unchanged |
| Today's Revenue | would include the ₹9,440 | **₹21,637** — unchanged |
| Avg Invoice | shifted | **₹16,165.06** — unchanged |
| Drafts / Estimates | 1 | **1** (correct) |

**A draft now leaks into no money KPI — only the "Drafts / Estimates" count.**

## 6. PH23-D2 — root cause & fix

**Root cause.** `invTotals(iv).balance` is `max(0, grand − paid)`; a Draft or Estimate
has `paid == 0`, so `balance == grand`. The aggregators used `balance > 0` (or summed
`.balance` over "not Cancelled") as a proxy for "this invoice is an outstanding
receivable" — a proxy that a quote and a work-in-progress draft both pass.

**Fix (REUSE / EXTEND — no new abstraction beyond one 6-line predicate):**

1. `services/billingService.js` — **new `isOutstanding(iv)`**: the symmetric
   counterpart of `isRealized(iv)`. `true` only for `invoiceStatus(iv) ∈ {Unpaid,
   Partially Paid}` and not an estimate. (`isRealized` = "money is here"; `isOutstanding`
   = "money is owed"; every other state contributes nothing.)
2. `components/InventoryDashboard.js` — `syncCustomerTotals`: a local `isOutstanding`
   mirroring the local `isRealized`; `outstanding` sums `.balance` only for
   `isOutstanding`, `totalSpent` sums `.paid` only for `isRealized || isOutstanding`
   (a real, non-reversed bill).
3. `components/billing/BillingModule.jsx` — `stats`: the money loop now **skips Draft +
   Estimate entirely** (they go to `draftCount` only) and only sums a
   `REAL_STATUSES = ['Paid', 'Unpaid', 'Partially Paid']` invoice — so Revenue
   (Month/Today), GST Collected, Parts/Labour Revenue, Avg Invoice, the 14-day trend,
   Top Customers, Top Parts, **and** Outstanding + Pending Payments all count only
   real, non-reversed bills. `avgInv` divides by `realCount`, not `invoices.length`.
4. `components/billing/BillingModule.jsx` — `bulkReminder`: only texts customers about
   `['Unpaid', 'Partially Paid']` invoices.
5. `services/analyticsService.js` — `computeAlerts` billing alerts: exclude
   `['Draft', 'Estimate', 'Cancelled', 'Refunded', 'Returned']`.

## 7. Revenue / Cost / Profit / Margin — re-checked

Unchanged from DEEP-1 (§8–§12) and re-run here: the truth table (Rev 3500 / Cost 2000 /
Profit 1500 / Margin 42.857 %) agrees at every layer; margin guarded on every
degenerate input; negative profit never clamped; reversals net to zero; GST is
structurally absent from the profit chain. PH23-D2 does **not** touch the
revenue/cost/profit ledger — it is a receivables-KPI defect only.

## 8. Date / month aggregation — re-checked

`computeRange` month / lastmonth / year: closed on both ends, `lastmonth.end + 1ms ==
month.start`, `Date(2026,0,32)` normalises to `'2026-02'`, `YYYY-MM` sorts lexically.
`custom` range: `new Date(custom.start)` on a `<input type="date">` value (`YYYY-MM-DD`)
parses as UTC midnight, then `setHours(0,0,0,0)` snaps to local midnight — correct for
India (UTC+5:30, ahead of UTC) and any timezone ahead of UTC; a timezone *behind* UTC
could see a one-day shift on the range start. **INFO** (single-branch, single-timezone
workshop; not fixed).

## 9. Duplicate realization / historical cost — re-checked

- `planInvoiceRealization` is diff-based (`prior → next` on realized values); re-running
  it for an unchanged paid invoice yields a zero delta. PH23-D2's fix does not touch
  this path.
- Post-realization the `sales` row freezes `cost` / `profit` as plain numbers; a later
  part-master or invoice-status edit cannot retro-change it (DEEP-1 §10, re-asserted).

## 10. Mutation testing

`tests/analytics-integrity.test.cjs` §14 (from DEEP-1) + §16 (new):

| mutation | detected? |
|---|---|
| revenue / cost / profit + 1 | ✅ ✅ ✅ |
| revenue × 1.001 (0.1 %) | ✅ |
| drop the sale / swap revenue↔cost | ✅ ✅ |
| **PH23-D2**: count the draft in Outstanding | ✅ |
| **PH23-D2**: count the estimate in Outstanding | ✅ |
| **PH23-D2**: count the cancelled-unpaid in Outstanding | ✅ |
| **PH23-D2**: Outstanding off by ₹1 | ✅ |
| a date-rollover month key lands in the right month | ✅ |

**16 / 16 corruptions caught.** The suite is not vacuous.

## 11. Test-suite quality

| | DEEP-1 | DEEP-2 |
|---|---|---|
| `analytics-integrity.test.cjs` assertions | 105 | **125** |
| exercises the shipped ledger path (`planInvoiceRealization`) | ✅ | ✅ |
| exercises the shipped receivables path (`syncCustomerTotals`, `stats`) | ✗ | ✅ (`§16` reproduces both verbatim + independent oracle) |
| mutation self-test | 6 | **16** |
| independent oracle for every headline figure | ✅ | ✅ |

## 12. Regression gates

| Gate | Result |
|---|---|
| `npm test` | **144 / 144 test files** (`analytics-integrity.test.cjs` 125 assertions) |
| `npm run test:rules` | **2 / 2** (150 + 111) — no `firestore.rules` change |
| `npm run lint` | **0 errors** |
| `npm run build` | **✓ compiled successfully** |

3 brittle source-pattern assertions (in `revenue-consistency`, `orphan-record-integrity`,
`analytics-integrity` §15) widened for the added `isOutstanding` filter / comment
blocks — no behavioural assertion weakened.

## 13. Code-growth review

```
Production lines added:     ~67   (BillingModule.jsx, InventoryDashboard.js, billingService.js, analyticsService.js)
Production lines removed:    ~12
Net production change:       +55   (~30 of which are the PH23-D2 comment blocks)

Test lines added:           ~55   (analytics-integrity.test.cjs §16 + updated §15)
Test lines changed:           3   (brittle source regexes widened)
Documentation lines added:  ~330  (this report + ROADMAP + KNOWN_LIMITATIONS)

New production functions:     1   (billingService.isOutstanding — the symmetric
                                   counterpart of the existing isRealized)
New production files:          0
New abstractions:              0

Existing mechanisms reused:   isRealized's own shape; INVOICE_STATUS constants; the
                              `['Unpaid','Partially Paid']` predicate the list filter
                              and computeWorkshopProgress already used.
```

## 14. QA cleanup

- Live PH23-D2 validation created demo drafts (`DRF-0001`, walk-in) in the browser demo
  sandbox — never production Firestore. All demo storage wiped, demo re-seeded pristine
  (verified). `.next/` was rebuilt clean (a `npm run build` had clobbered the running
  dev server's chunks — dev restarted, not a code issue).
- Scratch probes (`scratchpad/d2-*.cjs`) deleted.
- No debug logging, no `.skip` / `.only`, no secrets.
- Dev server + browser pane stopped.

## 15. Remaining limitations

- **`billingService.revenueLines` / `ledgerDelta`** — still exported, tested, and *not
  wired into production*. Carries PH23-01 + PH23-D1; finishing the `services/`
  extraction is a `ROADMAP` "Code health" item.
- **Rollup month key = client `new Date()` at plan time**, sales row = `serverTimestamp()`
  — a theoretical month-boundary split (§3). INFO.
- **`custom` date-range start** could shift one day for a timezone *behind* UTC (§8).
  INFO (single-timezone app).
- **Analytics "Revenue" (ex-GST, realized) vs Billing "Revenue (Month)" (GST-inclusive,
  finalised paid + unpaid)** — an intentional metric distinction (DEEP-1 §17); the
  Billing card is now *invoiced turnover of real bills*, no longer polluted by drafts.
- **Historical rollups / `sales` rows are not retroactively corrected** by PH23-01 /
  PH23-D1 / PH23-D2 — an increment-based aggregate cannot be. Data realized before each
  fix keeps that fix's pre-state (ledger and rollup agree with each other, both from
  the same old plan). No migration was run.
- **Authenticated production reconciliation not performed** — no authenticated
  production browser session (tooling limitation, not an app issue).
- **PH21-D2** (wrong-type nested scalar as a React child) — unchanged, deferred.

## 16. Final classification

**CONDITIONAL PASS.**

The analytics math — revenue, cost, gross profit, margin, monthly totals, rollups,
reversals, date boundaries — reconciles end-to-end against an independent oracle, and
mutation testing (16/16) proves the suite detects corruption. PH23-01 and PH23-D1 are
re-confirmed. One new MEDIUM defect (**PH23-D2** — Draft / Estimate / reversed invoices
inflating the red "Outstanding" and "Pending Payments" KPIs and the per-customer
Outstanding / Total Spent, of the same *source-correct → intermediate-predicate-wrong →
plausible-red-UI* class as PH23-01/D1) was found and fixed by giving the app one shared
`isOutstanding` gate — the receivable counterpart of its existing `isRealized` — and
routing the six aggregation sites through the predicate the rest of the app already
used. Verified with an independent probe and live in demo mode.

The single condition on an unqualified PASS: **authenticated production data was not
reconciled** (no authenticated session available). Every invariant is independently
supported by source trace + oracle + mutation test + demo-mode live check.

```
PHASE 23 DEEP RE-AUDIT (ROUND 2): CONDITIONAL PASS

PREVIOUS (DEEP-1) CONDITIONAL PASS:  PARTIALLY CONFIRMED
  - analytics math (rev/cost/profit/margin/rollups/dates/reversals):  CONFIRMED
  - PH23-01, PH23-D1:                                                 RE-CONFIRMED (rounding-exact; live)
  - receivables KPIs:                                                 NOT previously audited → PH23-D2

SOURCE-OF-TRUTH CHAIN:            correct
INDEPENDENT ORACLE:              oracleLedger + verbatim reproductions of the shipped
                                 planInvoiceRealization AND syncCustomerTotals AND stats loop
REVENUE / COST / GROSS PROFIT / MARGIN:   MATCH (unchanged by PH23-D2)
DISCOUNT (PH23-01):              rounding-exact, worst drift 8.5e-14
GST:                             structurally absent from the profit chain — CLEAN
OUTSTANDING / PENDING PAYMENTS:  was WRONG (draft/estimate/reversed counted) → FIXED
CUSTOMER "Outstanding" / "Total Spent":  was WRONG → FIXED
DATE BOUNDARIES:                 closed both ends; two INFO edge notes (§3, §8)
MONTHLY ROLLUPS:                 profit == revenue − cost by construction; no drift
REVERSALS:                       exact inverse; PH23-D1 also removed a catalogue-move drift
DUPLICATE REALIZATION:           diff-based, unchanged — no regression
HISTORICAL COST:                 frozen sales row — immutable post-realization
LIVE DEMO:                       PH23-D2 fix verified (a ₹9,440 draft moves NO money KPI)
AUTHENTICATED PRODUCTION:        NOT PERFORMED (tooling limit)
FIRESTORE RULES:                 unchanged; 2/2
PROPERTY TESTING:                profit == rev − cost, Σ months == period, rollup == Σ ledger — hold
MUTATION TESTING:                16 / 16 corruptions detected

NEW DEFECTS:                     1   (PH23-D2)
CRITICAL 0 · HIGH 0 · MEDIUM 1 · LOW 0
FIXES:                           1
PRODUCTION NET LINES:            +55  (4 files; ~30 comment; 1 new fn = isOutstanding)
COMMIT:                          82762ae
DEPLOYMENT:                      Vercel eOZvu5zjQxqoLp-I7ZNQF (/, /login, /verify → 200)
QA CLEANUP:                      complete
FINAL CONFIDENCE:                HIGH for the analytics math; MEDIUM-HIGH overall
                                 (pending an authenticated-production spot-check)
```
