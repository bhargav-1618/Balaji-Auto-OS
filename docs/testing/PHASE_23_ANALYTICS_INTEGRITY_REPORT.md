# Phase 23 — Analytics / Source-of-Truth Reconciliation

**Purpose.** Prove that

```
authoritative invoice (lines + payments + invoice-level discount + GST)
      ↓  realization gate  (isRealized → status Paid)
sales / services ledger rows            (invoiceRevenueLines / planInvoiceRealization)
      ↓  monthly aggregation
salesRollups                            (increment(revenue/cost/profit/units/…) per month)
      ↓
dashboard / Reports / Sales analytics   (periodAgg / trend / ledgerByPart / SalesView.cards)
```

produces **mathematically correct** Revenue / Cost / Gross Profit / Margin — checked
against an independent hand-calculation that is never derived from a production
analytics helper.

**Outcome — one MEDIUM defect, fixed.**

| ID | Sev | One-line |
|---|---|---|
| **PH23-01** | MEDIUM | An **invoice-level discount** (flat ₹ or %) was folded into the invoice total (`totalsOf`/`invTotals` → `grandTotal` / `profitAmount`, and every Billing report) but **not** into the sales ledger / `salesRollups` / dashboard analytics / Monthly-Profit-Trend, which read per-line revenue. Every discounted paid invoice therefore **overstated analytics Revenue and Profit by the whole discount** (Cost was unchanged → Margin overstated too), and the operational dashboard disagreed with the Billing screen on the same invoice's profit. |

The GST-inclusive-vs-exclusive difference between the Billing "Revenue (Month)" card
and the operational-dashboard "Revenue" is an **intentional metric difference**
(invoice turnover vs recognized revenue) and is documented, not changed.

No `firestore.rules` change. `npm test` 144/144, `npm run test:rules` 2/2, lint 0,
build ✓. Live-verified in demo mode against real realized ledger rows.

---

## 1. Analytics architecture

| Layer | Where | What it is |
|---|---|---|
| **Authoritative** | `invoices` collection (`lines`, `payments`, `discount`/`discountType`, `gstPct`/`gstMode`) | the source of truth. `iv.grandTotal` / `iv.balance` / `iv.status` / `iv.profitAmount` / `iv.gstAmount` are **derived snapshots** refreshed on every save/payment from `BillingModule.totalsOf`. |
| **Realization gate** | `billingService.isRealized` (+ `InventoryDashboard.invTotals`/`invStatus`) | an invoice contributes to analytics **only when fully Paid**. Draft / estimate / partially-paid / cancelled → 0. |
| **Ledger** | `InventoryDashboard` — `invoiceRevenueLines` → `planInvoiceRealization` (prod, pure, inside a `runTransaction`) / `recordInvoiceSalesDelta` (demo). `services/billingService.revenueLines`/`ledgerDelta` is the exported/tested twin (not wired into production). | diff-based, idempotent, reversible. Writes one `sales` row per changed line, each carrying `revenue` / `cost` / `profit` / `margin` **snapshotted at realization**. |
| **Rollups** | `salesRollups/<YYYY-MM>` — `increment(revenue)`, `increment(cost)`, `increment(profit)`, `increment(units)`, `increment(partsRevenue/labourRevenue/serviceRevenue/outsideRevenue)` written in the **same transaction** as the ledger rows. | an unbounded monthly aggregate (the ledger listener is capped at `LIMITS.INVOICES_LIVE`). |
| **Analytics (pure)** | `services/analyticsService.js` — `computeRange`, `computeWorkshopScore`, `computeInsights`, `computeWorkshopProgress`, `computeInventoryHealth`, … | React-free, Firestore-free, unit-tested. **Does not** contain the revenue/cost/profit money math — that lives in the dashboard views. |
| **Analytics (view-scoped)** | `InventoryDashboard` — `OverviewView.periodAgg` / `.today`, `ReportsView.trend` / `.ledgerByPart` / `.kpi`, `SalesView.cards`, `ServicesView.cards` | aggregate the `sales` ledger (or `salesRollups` for the unbounded trend) by date range / part / category. |
| **Billing analytics** | `BillingModule.stats` (`monthRev` / `monthProfit` / `revToday` / `partsRev` / `labourRev` / `gstTotal`) | aggregates `totalsOf(iv)` **directly over invoices** — a *different* source from the ledger family. |

## 2. Metric inventory (23 metrics)

| # | Metric | Source | Formula |
|---|---|---|---|
| 1 | Dashboard **Revenue** (period / today) | `sales` ledger | `Σ s.revenue` (post-discount, ex-GST) over date range |
| 2 | Dashboard **Profit** (period / today) | `sales` ledger | `Σ s.profit` |
| 3 | Reports **Monthly Profit Trend — Revenue** | `salesRollups` (fallback: ledger) | `Σ month.revenue` |
| 4 | Reports **Trend — Cost** | rollups / ledger | `Σ month.cost` |
| 5 | Reports **Trend — Profit** | rollups / ledger | `totRev − totCost` |
| 6 | Reports **Trend — Margin %** | derived | `totRev > 0 ? totProfit/totRev×100 : 0` |
| 7 | Reports **Top Profitable Parts** (revenue / profit / margin) | `ledgerByPart` | `Σ s.revenue`, `Σ s.profit`, `profit/revenue×100` per `partId` |
| 8 | Reports **Vehicle Analytics** revenue | `lib/vehicleStats.revenueOf` → `billingService.invoiceTotals(iv).grand` | realized invoices' grand total (PH22-01) |
| 9 | Reports **capital / dead stock** KPI | `parts` | `lockedCapital` / `expectedProfit` — inventory valuation, not sales |
| 10 | Sales **Parts Revenue / Profit (Month)** | ledger (`Parts` + `Outside Purchase`) | `Σ s.revenue` / `Σ s.profit` this month |
| 11 | Sales **Avg Margin** | ledger | `proM > 0 → proM/revM×100` |
| 12 | Sales **Units Sold (Month)** | ledger | `Σ s.qty` |
| 13 | Services **Service Income / Profit (Month)** | ledger (`Labour` + `Service`) | `Σ s.revenue` / `Σ s.profit` |
| 14 | Billing **Revenue (Month) / Today** | `invoices` via `totalsOf` | `Σ t.grand` (**GST-inclusive**, post-discount) |
| 15 | Billing **Profit (Month) / Today** | `invoices` via `totalsOf` | `Σ t.profit` = `Σ (afterDisc − cost)` |
| 16 | Billing **GST Collected** | `invoices` via `totalsOf` | `Σ t.gst` |
| 17 | Billing **Parts / Labour Revenue** | `invoices` via `totalsOf` | `Σ t.partsRev` / `t.labourRev` (net of line discount) |
| 18 | Billing **Outstanding** | `invoices` via `totalsOf` | `Σ t.balance` |
| 19 | Workshop **Score** (0–100) | `analyticsService.computeWorkshopScore` | weighted: inventory health 40 / sales activity 25 / supplier 20 / alerts 15, renormalised over factors with real data |
| 20 | Workshop **Progress — Sales target** | `sales` ledger | `thisMonthRev / trailing-3-month-avg × 100` |
| 21 | Insights **"₹X collected today"** | `invoices[].payments` | `Σ payments where p.date === today` |
| 22 | Insights **"₹X of stock received this week"** | `restocks` | `Σ r.total` in last 7d |
| 23 | Customer / Supplier totals | stored aggregates (`c.totalSpent` / `c.outstanding`), recomputed by `syncCustomerTotals` from `invTotals` | `Σ invTotals(iv).paid` / `.balance` per customer |

## 3. Source-of-truth matrix

| Metric family | Authoritative source | Calculation | Rollup | UI output | Verdict |
|---|---|---|---|---|---|
| **Revenue** (dashboard / Sales / Services / Reports trend) | realized invoice lines | `Σ [qty·rate·(1−lineDisc%)] · (afterDisc/sub)` — post per-line **and** invoice-level discount, ex-GST | `salesRollups.revenue` (`increment`) | `Σ s.revenue` | **MATCHES SOURCE OF TRUTH** (after PH23-01) |
| **Cost** | realized part lines | `Σ qty · purchasePrice` (labour/services = 0 COGS) | `salesRollups.cost` | `Σ s.cost` | **MATCHES SOURCE OF TRUTH** |
| **Gross Profit** | — | `revenue − cost` | `salesRollups.profit` (== rev−cost) | `Σ s.profit` / `totRev−totCost` | **MATCHES SOURCE OF TRUTH** (after PH23-01) |
| **Margin %** | — | `profit / revenue × 100`, guarded `revenue > 0` | — | trend / part / avg margin | **MATCHES SOURCE OF TRUTH** |
| **Billing "Revenue (Month)"** | invoices via `totalsOf` | `Σ grand` (**GST-inclusive** turnover) | — | Billing KPI card | **INTENTIONAL DIFFERENCE** — invoice turnover, not recognized revenue (differs from #1 by the GST amount, by design) |
| **Vehicle Analytics revenue** | realized invoices | `Σ invoiceTotals(iv).grand` | — | Reports → Vehicle | **INTENTIONAL DIFFERENCE** — GST-inclusive per-vehicle turnover (PH22-01 made `invoiceTotals` the full model) |
| **Workshop Score / Progress** | live inventory + ledger + suppliers | weighted composites, renormalised over real-data factors | — | Dashboard cards | **MATCHES SOURCE OF TRUTH** (PH21-D1b fixed the `qtyOf` NaN) |
| **Capital / dead-stock KPI** | `parts` catalog | `stock · purchasePrice`, `salesCount === 0` filter | — | Reports capital header | **INTENTIONAL DIFFERENCE** — inventory valuation, not a sales metric |

## 4. Revenue reconciliation

Truth table (`tests/analytics-integrity.test.cjs` §1), GST-exempt for a clean check:

```
          qty  rate  cost/u   →  revenue   cost   profit
 Sale A:    2   500    300         1000      600     400
 Sale B:    4   500    300         2000     1200     800
 Sale C:    1   500    200          500      200     300
                                  ------    ----    ----
 Expected                          3500     2000    1500      margin = 1500/3500 = 42.857%
```

| Layer | Revenue | Cost | Profit | Margin |
|---|---|---|---|---|
| independent oracle | 3500 | 2000 | 1500 | 42.857% |
| `ledgerDelta` (draft → paid) | 3500 | 2000 | 1500 | 42.857% |
| reconstructed `salesRollups` increment | 3500 | 2000 | 1500 (== rev−cost) | — |
| `Σ totalsOf(iv).afterDisc` / `.profit` | 3500 | — | 1500 | — |
| Reports trend `totProfit = totRev − totCost` (source-verified) | 3500 | 2000 | 1500 | 42.857% |

**MATCHES SOURCE OF TRUTH.**

Definition established from source: **"Revenue" = the realized invoice subtotal, net of
per-line and invoice-level discount, excluding GST.** It is *not* cash collected
(a fully-paid invoice recognises 100% at once; a partial payment recognises 0 — see §15).

## 5. Cost reconciliation

- `cost = Σ (qty · purchasePrice)` for inventory **part** lines only; labour / service /
  outside-purchase lines carry **0 COGS** (`isPart ? qty·purchasePrice : 0`).
- `purchasePrice` is snapshotted **onto the invoice line** at pick time (demo seed and
  `BillingModule` both set `l.purchasePrice`), so a later catalog price change does not
  rewrite historical cost.
- Missing `purchasePrice` → `toNum(undefined) = 0` → that line's profit == its full
  revenue (correct for a part with no recorded cost).
- **The `cost = 0` class (BUG-LIVE-005)** — the demo `genRollups()` never accumulated
  `cost`, so the Monthly-Profit-Trend showed Cost ₹0 / Margin 100% while the ledger-based
  panels showed real margins. Fixed previously; `tests/demo-analytics-cost.test.cjs` and
  `tests/analytics-integrity.test.cjs` §10 both keep it closed (rollup cost == ledger cost
  ±0.5%, margin 5–95%). **No other hardcoded-zero / wrong-field / stale-snapshot cost
  path found** (§19).

**MATCHES SOURCE OF TRUTH.**

## 6. Gross-profit reconciliation

`profit = revenue − cost` at every layer. The `sales` row stores `profit` explicitly;
consumers read `s.profit ?? (s.revenue||0) − (s.cost||0)` (the `??` fallback only fires
for a legacy row missing the field). The Reports trend deliberately recomputes
`totProfit = totRev − totCost` rather than summing per-month `profit`, so a rollup with
drift cannot corrupt the headline figure. Negative profit is **never clamped** — a
loss-making sale reports `−400`, not `0` (§4 test). **MATCHES SOURCE OF TRUTH.**

## 7. Margin reconciliation

`margin % = profit / revenue × 100`. Every site guards the denominator:

| Site | Guard |
|---|---|
| Reports trend | `totRev > 0 ? (totProfit/totRev)×100 : 0` |
| `pMargin` (per part) | `r > 0 ? (profit/r)×100 : 0` |
| Sales `avgMargin` | `revM > 0 ? (proM/revM)×100 : 0` |
| `sales` row `.margin` | `dRev > 0 ? round(((dRev−dCost)/dRev)×1000)/10 : 0` |
| Sales row display | `s.margin != null ? s.margin : (s.revenue > 0 ? … : 0)` |

Tested: revenue 0 / cost 0 → 0%; revenue 0 / cost 100 → 0%; cost > revenue → −50%;
cost == revenue → 0%; healthy → 40%. **No NaN, no Infinity, no divide-by-zero.**
**MATCHES SOURCE OF TRUTH.**

## 8. Monthly totals

- Month key: **`YYYY-MM`, zero-padded** (`` `${y}-${String(m+1).padStart(2,'0')}` ``) —
  sorts lexically, `2025-12 < 2026-01`.
- Rollup key uses `new Date()` (the write instant), not the invoice date — a back-dated
  invoice realised today lands in **this** month's rollup. This is consistent between
  `planInvoiceRealization` and `recordInvoiceSalesDelta`; the ledger-fallback trend keys
  by `s.createdAt` (also the write instant). Consistent within the analytics family.
- `trend` prefers the unbounded `salesRollups`; only if none exist does it aggregate the
  (capped) recent ledger. Both paths carry revenue + cost + profit.

**MATCHES SOURCE OF TRUTH** (within the documented "realised-date" convention).

## 9. Date-boundary tests

`computeRange` (`tests/analytics-integrity.test.cjs` §8):

| Range | Start | End |
|---|---|---|
| `today` / `month` / `year` | `00:00:00.000` of the first day | `23:59:59.999` of today |
| `lastmonth` | day 1 of previous month, `00:00:00.000` | last day of previous month, `23:59:59.999` |

- `lastmonth.end < month.start` — **no overlap, no gap** (`month.start` is `lastmonth.end + 1ms`).
- Dashboards test `t >= range.start && t <= range.end` → the boundary is **closed on both
  ends**; a timestamp exactly on `range.start` is inside, `range.start − 1` is outside.
- `year` starts `Jan 1 00:00`.
- No off-by-one-day, no month-rollover error, no double-count / omission at a boundary.

**MATCHES SOURCE OF TRUTH.** (Timezone: all ranges are built in the browser's local
time via `setHours(0,0,0,0)` — correct for a single-branch, single-timezone workshop.)

## 10. Zero / empty behaviour

- No invoices → `ledgerDelta(null,null)` → revenue / cost / profit **exactly 0**.
- `revenueLines(undefined)` → `{}`, no throw.
- `computeWorkshopProgress({})` → every row a finite `pct` in `[0,100]`; "Sales target"
  with no history → `0%` (not `NaN%`).
- No stale previous-period carry-over — `periodAgg` recomputes `prevStart/prevEnd` from
  the current range each time.

**MATCHES SOURCE OF TRUTH.**

## 11. Negative-value behaviour

- Loss-making sale → **negative** profit preserved (`−400`), never clamped.
- Reversal / cancel → **exact inverse** delta (§14).
- Negative stock is intentionally allowed by the realization path (a sale already
  happened); `computeAlerts` surfaces it as a Critical "Negative stock" alert rather
  than hiding it.

**MATCHES SOURCE OF TRUTH.**

## 12. Discount / GST behaviour

| Input | Analytics Revenue | Analytics Profit | Invoice `grand` |
|---|---|---|---|
| no discount, GST 18% | line net | net − cost | net + GST |
| **per-line** discount | `qty·rate·(1−disc%)` | ↓ by the line discount | ↓ correspondingly |
| **invoice-level** discount (flat / %) | line net **× afterDisc/sub** (PH23-01) | ↓ by the discount | ↓ by the discount |
| GST 0 / 5 / 12 / 18 / 28 % | **unchanged** (GST is not revenue) | unchanged | ↑ by the tax |
| `gstMode: exempt` | unchanged | unchanged | == afterDisc |
| `gstMode: igst` | unchanged | unchanged | same total, IGST not CGST+SGST |

- **Analytics Revenue / Profit / Margin are ex-GST** — GST is a pass-through liability,
  not takings. This is consistent across the whole ledger family. The **Billing** "Revenue
  (Month)" card is GST-**inclusive** turnover — an intentional, separate metric.
- Both discount types now reach analytics (PH23-01). Independent-oracle tests: ₹1,000 flat
  off ₹10,000 → revenue 9,000 / profit 3,000; 20% off ₹2,000 → revenue 1,600 / profit 800.

## 13. Multi-line invoice behaviour

`tests/analytics-integrity.test.cjs` §7 — an invoice with the **same part on two lines**
plus **two independent labour lines**:

- The repeated part **aggregates** — the production/demo ledger path keys parts by
  `part:<partId>`, so 2 + 3 units → one attribution of qty 5, revenue 2,500. **Not
  double-counted.**
- The two labour lines key by `line:<id>` — both counted, **not merged** (labour revenue
  1,600, not 800).
- Cost = 5 × 300 = 1,500 (labour lines add 0). Follows Phase 14's aggregation semantics.

**MATCHES SOURCE OF TRUTH.**

## 14. Returns / reversal

`ledgerDelta(paid, cancelled)` on a ₹3,000-lines / ₹500-invoice-discount invoice:

| | Revenue | Cost | Profit |
|---|---|---|---|
| forward (draft → paid) | +2,500 | +1,800 | +700 |
| reversal (paid → cancelled) | −2,500 | −1,800 | −700 |
| **net** | **0** | **0** | **0** |

- Cancel / Refund / Return → `isRealized` false → `realizedRevenue` returns empty lines →
  full negative delta. Delete → `planInvoiceRealization(prior, null)` → same.
- Re-saving an unchanged paid invoice → `ledgerDelta` returns **`[]`** (idempotent, no
  double-count). The `salesRollups` `increment()` deltas net to zero the same way.

**MATCHES SOURCE OF TRUTH.**

## 15. Payment-vs-revenue semantics

**Established from source:** analytics "Revenue" is driven by **invoice realization
(status Paid)**, not by cash collected.

- Invoice ₹10,000, ₹4,000 paid → `isRealized` **false** → `revenueLines` empty → **0**
  analytics revenue for it. When the balance clears, the **whole** invoice recognises at
  once.
- The one metric that *is* cash-based — Insights **"₹X collected today"** — sums
  `payments[].amount where p.date === today` and is labelled accordingly.
- Billing **Outstanding** = `Σ totalsOf(iv).balance` (grand − payments) — a receivables
  figure, correctly separate from revenue.

This is a deliberate accrual-style model; **INTENTIONAL** and internally consistent.

## 16. SalesRollup reconciliation

Reconstructed the rollup the transaction engine writes (`increment(revenue)` /
`increment(cost)` / `increment(profit)` per month) from `planInvoiceRealization`'s
`rollupDeltas` and checked:

- `rollup.revenue == Σ ledger.revenue`, `rollup.cost == Σ ledger.cost`.
- `rollup.profit == rollup.revenue − rollup.cost` — **no drift** (the engine increments
  all three from the same `dRev` / `dCost`; there is no independent profit formula).

Against the **demo dataset** (`tests/analytics-integrity.test.cjs` §10):

| | rollup | ledger | match |
|---|---|---|---|
| Revenue | Σ `r.revenue` | Σ `s.revenue` | ±0.5% ✓ |
| Cost | Σ `r.cost` | Σ `s.cost` | ±0.5% ✓ (BUG-LIVE-005 stays closed) |
| Profit | Σ `r.profit` | Σ `s.profit` | ±0.5% ✓ |
| Profit == Rev − Cost | ✓ | | |
| Margin | 5–95% (plausible, not 100%) | | ✓ |
| Σ ledger revenue vs Σ paid-invoice `afterDisc` | | | ±2% ✓ |

**MATCHES SOURCE OF TRUTH — no rollup drift.**

## 17. Filtered analytics

- `OverviewView.periodAgg` filters `sales` **by date range first**, then aggregates the
  filtered set — `filter → aggregate`, not `aggregate-all → slice`.
- `ReportsView.trend` slices `series` by `monthsBack` *after* building it from the full
  rollup set — correct (rollups are already monthly aggregates; slicing months is the
  intended filter).
- `ledgerByPart` aggregates the full ledger; the Top-Profitable-Parts **search box
  filters which rows are shown**, it does not re-aggregate (a leaderboard, by design).
- `SalesView` / `ServicesView` filter to their category set (`Parts`+`Outside Purchase`
  / `Labour`+`Service`) then aggregate.

**MATCHES SOURCE OF TRUTH** — every filter is applied to the same source set the
aggregation runs over.

## 18. Dashboard / Report / Export consistency

| Metric | Dashboard | Reports | Sales/Services | Export | Same? |
|---|---|---|---|---|---|
| Revenue (ledger family) | `Σ s.revenue` | `Σ month.revenue` (rollup) / `Σ s.revenue` (fallback) | `Σ s.revenue` | Profitable-Parts XLSX = `pRev(p)` = `Σ s.revenue` | **YES** — one field, one meaning |
| Profit (ledger family) | `Σ s.profit` | `totRev − totCost` | `Σ s.profit` | XLSX `pProfit(p)` | **YES** |
| Margin | — | `totProfit/totRev` | `proM/revM` | XLSX `+pMargin(p).toFixed(1)` | **YES** |
| Revenue (invoice family) | — | Vehicle Analytics `Σ invoiceTotals.grand` | — | Vehicle Report XLSX/PDF (Phase 22) | **YES** (GST-inclusive, consistently) |
| Billing "Revenue (Month)" | — | — | — | Billing XLSX `Math.round(t.grand)` (Phase 22) | **YES** (GST-inclusive turnover) |

The **only** cross-family difference is GST inclusion (ledger family ex-GST, invoice
family incl-GST) and, before PH23-01, the invoice-level discount. Both are now either
**fixed** (discount) or **intentional and consistent within each family** (GST).

## 19. Known-regression verification

| Target | Status |
|---|---|
| **`cost = 0` (BUG-LIVE-005)** — demo rollups showed Cost ₹0 / Margin 100% | **CLOSED** — `demo-analytics-cost.test.cjs` + `analytics-integrity.test.cjs` §10 (rollup cost == ledger cost ±0.5%, margin 5–95%) |
| Broader "hardcoded zero" cost | none found — `unitCost = isPart ? (part?.purchasePrice || 0) : 0` is the only fallback and `0` is correct for a costless line |
| "wrong field name" (selling price read as cost) | not present — `revenue` reads `l.rate`, `cost` reads `l.purchasePrice`; never crossed |
| "stale Part snapshot" | line-level `purchasePrice` is snapshotted at pick time; catalog price changes do not rewrite history |
| "demo-only cost" | demo seed and runtime both carry `cost` / `purchasePrice`; `analyticsService` has no demo branch |
| independent financial-formula copies | `totalsOf` / `invTotals` / `invoiceTotals` (3 invoice-money copies, Phase 11 + PH22-01 keep them reconciled); `invoiceRevenueLines` / `billingService.revenueLines` (2 ledger copies — now both apply the discount, PH23-01); `oracleLedger` in the new test is a 3rd, independent check |
| **fabricated supplier on-time %** | already fixed (Phase — `computeWorkshopScore` drops the factor instead of hardcoding 80) |
| **`qtyOf` NaN** (forged `qty:"abc"` → "NaN/100") | already fixed (PH21-D1b) — re-covered by `analytics-scores.test.cjs` |

## 20. Firestore / source verification

Deterministic invoice **INV-0297** (demo, `?demo=1`), created + paid live:

```
SOURCE (invoice)        lines: PH23 Part 1×₹1000  +  General Servicing 1×₹500
                        invoice-level discount: ₹300 (flat)   GST: part 18%, labour 0
EXPECTED   sub 1500 → afterDisc 1200 → grand 1344   profit (afterDisc − cost) = 1200

FIRESTORE / demo store  iv.grandTotal 1344   iv.profitAmount 1200   iv.gstAmount 144   iv.discount "300"
                        sales rows on realization:
                          "PH23 Part"          revenue 800   cost 0   profit 800
                          "General Servicing"  revenue 400   cost 0   profit 400
                          Σ revenue 1200   Σ profit 1200

APPLICATION             Σ ledger revenue (1200) == iv.afterDisc (1200) == iv.profitAmount (1200)

RESULT                  MATCH  ✓   (pre-PH23-01 the ledger rows would have been 1000 + 500 = 1500 —
                                    overstated by exactly the ₹300 discount)
```

## 21. Live website validation

- Demo mode, real payment flow (`Collect & Close Invoice` → `runInvoiceRealizationDemo`
  → `recordInvoiceSalesDelta` → the patched `invoiceRevenueLines`): the realized ledger
  rows for a ₹300-discounted invoice summed to ₹1,200 revenue / ₹1,200 profit,
  reconciling exactly with `iv.afterDisc` / `iv.profitAmount` (§20).
- Workshop Score rendered `83/100 Good` (a real number, not `NaN/100` — PH21-D1b holds
  live).
- Demo `salesRollups` ↔ demo `sales` ledger ↔ demo paid-invoice subtotals all reconcile
  within tolerance (§16).
- Production read-only check: not performed (no authenticated production browser session
  this phase — same tooling limitation noted in Phases 6–7). The demo path exercises the
  identical realization + ledger code; only the write destination differs.

## 22. Confirmed defects

**PH23-01 (MEDIUM) — invoice-level discount missing from the analytics chain.**

## 23. Root cause

The E2E-workflow QA fix that made `invTotals` apply the invoice-level discount (so
`isRealized` stopped returning false for discounted-and-paid invoices, which had been
*silently skipping the entire realization engine* for them) fixed the **gate** but not
the **amounts**. Once discounted invoices started realising, the ledger builder
(`invoiceRevenueLines`) still computed `revenue = Σ qty·rate·(1−lineDisc%)` — the
**pre-invoice-discount** subtotal. So:

```
totalsOf(iv).afterDisc  = sub − invDisc        ← Billing screen, iv.grandTotal, iv.profitAmount
Σ sales[iv].revenue     = sub                   ← dashboard / Sales / Reports / Monthly Trend
                          ^^^ overstated by invDisc on every discounted paid invoice
```

Cost was unaffected, so **Profit was overstated by the full discount and Margin along
with it**, and the operational dashboard disagreed with the Billing screen on the same
invoice's profit. GST-scaling already used the `afterDisc/sub` ratio (Phase 11 §) — the
line-revenue scaling was the missing half of the same idea.

## 24. Fix

Allocate the invoice-level discount across the ledger's revenue lines with the **same
`afterDisc / sub` ratio** `totalsOf` / `invTotals` already use for GST — applied once,
in the shared line builder, so the `sales` rows, `salesRollups`, dashboard, Sales/Services
modules and the Monthly-Profit-Trend all reconcile to the invoice's own post-discount total.

- `components/InventoryDashboard.js` — `invoiceRevenueLines`: accumulate `sub`, then
  `const invDisc = discountType==='percent' ? sub*(disc/100) : disc; if (invDisc>0 && sub>0) scale each entry's revenue by max(0,sub−invDisc)/sub`. Covers **both** the
  production transaction path (`planInvoiceRealization`) and the demo path
  (`recordInvoiceSalesDelta`) — both call this one function.
- `services/billingService.js` — `revenueLines`: the same scaling, and recompute
  `profit = revenue − cost` after it. (This is the exported/tested twin; kept in lock-step
  even though production does not import it, and so that `Σ revenueLines(iv).revenue ==
  totalsOf(iv).afterDisc` holds as a test invariant.)

No new file, no new function, no new abstraction — the discount-amount expression is the
same one-liner already in `totalsOf` / `invTotals` / `invoiceTotals`.

## 25. Automated tests

`tests/analytics-integrity.test.cjs` (**NEW**, 70 assertions):

1. **Truth table** — oracle ↔ `ledgerDelta` ↔ reconstructed rollup ↔ `Σ totalsOf.afterDisc`/`.profit` ↔ source-verified `totProfit = totRev − totCost` (Revenue 3500 / Cost 2000 / Profit 1500 / Margin 42.857%).
2. **PH23-01** — flat + percent invoice discount reaches the ledger; reconciles with `totalsOf().afterDisc` / `.profit` / `invTotals().profit`; no-discount invoices untouched; shipped-source proof for both `invoiceRevenueLines` and `billingService.revenueLines`.
3. **GST** — ledger revenue is the ex-GST line net; `== totalsOf().afterDisc` for a taxed invoice; the GST-inclusive `grand` differs by exactly the tax.
4. **Margin** — 5 degenerate inputs, all finite; loss → negative profit not clamped; source guards verified.
5. **Payment vs revenue** — 40%-paid → `isRealized` false → `revenueLines` empty; full payment recognises the whole invoice.
6. **Returns / reversal** — exact inverse, net zero, idempotent re-save.
7. **Multi-line** — repeated part aggregates (qty 5), independent labour lines both counted.
8. **Date boundaries** — `computeRange` month/lastmonth/year, closed boundary, no overlap, zero-padded `YYYY-MM` key.
9. **Zero / empty** — no NaN / Infinity; "Sales target" 0% not NaN%.
10. **Rollup reconciliation** — demo rollups ↔ demo ledger ↔ demo paid-invoice subtotals.
11. **Dashboard / Sales / Reports** read the same `s.revenue` / `s.profit` fields (source-pattern).

Independent oracle (`oracleLedger`) re-derives every expected figure by hand; it never
calls a production analytics helper.

## 26. Regression results

| Gate | Result |
|---|---|
| `npm test` | **144 / 144 test files** (`analytics-integrity.test.cjs` new, 70 assertions) |
| `npm run test:rules` | **2 / 2** (150 + 111) — **no `firestore.rules` change** |
| `npm run lint` | **0 errors** (pre-existing `<img>` warnings only) |
| `npm run build` | **✓ compiled successfully** |

Phases 1–22 tests all remain green — `financial-integrity` 185, `ledger-integrity` 48,
`certification` 26, `concurrency-cross-workflow` 43, `workflow-*` all pass. The PH23-01
scaling is a no-op (`scale == 1`) for every `discount: 0` invoice, which is every invoice
those suites build.

## 27. QA cleanup

- One demo invoice **INV-0297** ("PH23 QA Discount Test") created in the browser demo
  sandbox and marked paid to exercise the fix, then **removed** from `maruti_invoices_demo`
  (297 → 296) and its two realized rows removed from `maruti_demo_sales` (1127 → 1125).
  Demo data is browser-local and never touches production Firestore.
- No scratch files left in `tests/`. No debug logging added. No secrets.
- Dev server and browser pane stopped.

## 28. Code-growth review

```
Production lines added:    ~28   (components/InventoryDashboard.js +16, services/billingService.js +12)
Production lines removed:     0
Net production change:     +28   (~15 of which are the explanatory comment blocks)

Test lines added:          ~250  (tests/analytics-integrity.test.cjs, new)
Documentation lines added: ~470  (this report + ROADMAP + KNOWN_LIMITATIONS entries)

New production functions:    0
New production files:        0
New abstractions:            0

Existing mechanisms reused:  the `afterDisc/sub` proportional-rescale ratio (already used
                             for GST by totalsOf / invTotals / invoiceTotals — Phase 11 §);
                             the invDisc one-liner (`discountType==='percent' ? … : …`).
Unnecessary code removed:    none (billingService.revenueLines / ledgerDelta are unused by
                             production but are the tested extraction target and are kept
                             in lock-step; documented as a cleanup candidate, not removed).

Significant new logic:       one `if (invDisc > 0 && sub > 0)` scaling block, twice.
Why existing mechanisms could not safely handle it:  the ledger is built per-line; the
                             invoice-level discount is invoice-scoped, so it has to be
                             allocated across lines — and the app's established way to do
                             that (the afterDisc/sub ratio) is exactly what is applied.
```

## 29. Remaining limitations

- **`billingService.revenueLines` / `ledgerDelta` are not wired into production** — the
  live ledger is built by the component-scoped `invoiceRevenueLines` /
  `planInvoiceRealization`. Both copies now carry the PH23-01 fix and are covered by
  tests, but the duplication is real; completing the `services/` extraction (so the
  component imports the service) is a `ROADMAP` "Code health" item, deferred (it needs the
  component's catalog-enrichment — `part?.sku` / `brandsOf` / `part?.category` — moved too,
  which is a larger, separate change).
- **Analytics "Revenue" is ex-GST; Billing "Revenue (Month)" is GST-inclusive** —
  intentional (recognized revenue vs invoice turnover). The two are internally consistent;
  a shop owner comparing the two cards sees the GST amount as the difference. A one-word
  label clarification is possible but no code defect exists, so none was made.
- **Rollup month key = realised-date, not invoice-date** — a back-dated invoice paid today
  contributes to *this* month's trend. Consistent across the analytics family; matches how
  a cash/accrual hybrid recognises revenue when money is received.
- **PH21-D2** (wrong-type nested scalar rendered as a React child) — unchanged; complete
  fix is Firestore-rules type assertions, still deferred.

## 30. Final PASS / FAIL assessment

**PASS.** Every dashboard / report / analytics metric was source-mapped and reconciled
against an independent hand-calculation: Revenue, Cost, Gross Profit and Margin are
mathematically correct at every layer — authoritative invoice → realization gate → sales
ledger → `salesRollups` → dashboard / Reports / Sales. One MEDIUM defect (**PH23-01** —
an invoice-level discount was applied to the invoice total and the Billing reports but
not to the analytics chain, overstating Revenue, Profit and Margin on every discounted
paid invoice) was confirmed, fixed by reusing the app's own `afterDisc/sub` allocation
ratio, verified with an independent oracle and live in demo mode, and reconciles the
ledger to the invoice's own post-discount total. The GST-inclusive-vs-exclusive
difference between the two Revenue cards is an intentional, internally-consistent metric
distinction. The previously-fixed `cost = 0` regression stays closed. Gates green, no
rules change.
