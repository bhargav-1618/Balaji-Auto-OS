# Phase 23 — Deep Adversarial Re-Audit

**Purpose.** An independent second pass whose job was to **disprove** the Phase 23
PASS, not repeat it. Specifically: does

```
BILLING SOURCE → INVOICE REALIZATION → SALES LEDGER → ROLLUPS → ANALYTICS → DASHBOARD / REPORTS / EXPORTS
```

survive a formula-by-formula forensic trace, an adversarial oracle, rounding /
date-boundary / historical-cost attacks, and mutation testing?

**Outcome — the Phase 23 PASS is PARTIALLY CONFIRMED, with one new MEDIUM defect.**

- PH23-01 (invoice-level discount) — **CONFIRMED FIXED**; the `afterDisc/sub`
  allocation is rounding-exact (worst drift across 7 adversarial cases:
  `8.5 × 10⁻¹⁴`).
- Revenue / Gross-Profit / Margin reconciliation — **CONFIRMED**.
- **Cost reconciliation — was only PARTIALLY true.** The Phase 23 test proved cost
  through `billingService.ledgerDelta` (an exported, tested helper) — but that helper
  **is not wired into production**. The shipped ledger builder
  (`InventoryDashboard.planInvoiceRealization` / `recordInvoiceSalesDelta`) re-read
  **the live part catalogue** for COGS instead of the invoice line's cost snapshot.
  → **PH23-D1 (MEDIUM)**, found here, fixed.
- Mutation testing — **NEW**: 6 deliberate corruptions of the truth table, all 6
  caught. The suite is not vacuous.

| ID | Sev | One-line |
|---|---|---|
| **PH23-D1** | MEDIUM | The sales ledger / `salesRollups` / dashboard analytics took COGS from the **live** `part.purchasePrice` at realization time, not the invoice line's `purchasePrice` snapshot (which `totalsOf` / `iv.profitAmount` / `billingService.revenueLines` all use). An invoice drafted before a part-cost change and paid after it recorded a different profit in analytics than on its own invoice; editing a paid invoice priced the delta at today's cost. |

No `firestore.rules` change. `npm test` 144/144, `npm run test:rules` 2/2, lint 0,
build ✓. PH23-D1 fix **live-verified** in demo mode.

---

## 1. Scope

Every analytics / reporting calculation that produces or consumes Revenue, Cost,
Gross Profit, Margin, monthly totals, `salesRollups`, per-part / per-vehicle /
per-customer money, or a workshop KPI. The Phase 23 fixes (`invoiceRevenueLines` /
`billingService.revenueLines` discount allocation) were re-attacked; the shipped
component ledger path was traced independently of `billingService`.

## 2. Previous Phase 23 claim (as written)

> "PASS. Revenue / Cost / Gross Profit / Margin are mathematically correct at every
> layer. One MEDIUM defect (PH23-01 — invoice-level discount) found and fixed. The
> GST inclusion difference is intentional. The cost = 0 regression stays closed."

Its **COST RECONCILIATION** section: *"MATCHES SOURCE OF TRUTH — `cost = Σ qty·purchasePrice`,
snapshotted onto the invoice line at pick time, so a later catalog price change does
not rewrite historical cost."*

That statement is **true of `billingService.revenueLines` and `totalsOf`** — and
**false of the shipped production ledger builder**, which never read the line
snapshot. The Phase 23 test only exercised the former.

## 3. Independent methodology

- **Forensic source trace** of every `revenue` / `cost` / `profit` / `margin`
  expression (`§5`).
- **A second oracle** (`§6`) reconstructing the shipped `invoiceRevenueLines` +
  the `planInvoiceRealization` / `recordInvoiceSalesDelta` diff loops **line for
  line** from source (they are component-scoped closures — not importable), each
  reproduction guarded by a source-pattern assertion so it cannot silently drift
  from what ships.
- **Adversarial datasets** — rounding-hostile rates, invoice-discount extremes,
  date-rollover keys, part-cost changes mid-lifecycle.
- **Mutation testing** (`§32`) — corrupt the expected values, confirm the
  assertions flip to fail.
- **Live demo validation** of PH23-D1 end to end (`§28`).

## 4. Source-of-truth architecture (re-confirmed + corrected)

| Layer | Shipped code | COGS source (BEFORE this audit) | COGS source (AFTER) |
|---|---|---|---|
| Invoice snapshot | `BillingModule.totalsOf` → `iv.profitAmount` / `iv.grandTotal` | `l.purchasePrice` (line snapshot) | unchanged |
| Realization gate | `billingService.isRealized` / `InventoryDashboard.invTotals` | reads stored `iv.profitAmount` | unchanged |
| **Ledger (PROD)** | `InventoryDashboard.planInvoiceRealization` (in `runTransaction`) | **`inventory.find(...).purchasePrice`** — live catalogue ❌ | **`a.cost − b.cost`** from the line snapshot ✅ |
| **Ledger (DEMO)** | `InventoryDashboard.recordInvoiceSalesDelta` | **live catalogue** ❌ | **line snapshot** ✅ |
| Ledger (exported twin, **unused in prod**) | `billingService.revenueLines` / `ledgerDelta` | `l.purchasePrice` ✅ (always correct) | unchanged |
| Rollups | `applyRealizationPlanInTx` → `increment(cost)` | fed by the PROD ledger's `dCost` ❌ | fed by the corrected `dCost` ✅ |
| Quick Sell | `runQuickSaleTx` | `part.purchasePrice` at sale instant — **correct** (point-in-time sale, no snapshot exists) | unchanged |
| Analytics views | `OverviewView.periodAgg` / `ReportsView.trend` / `ledgerByPart` / `SalesView` | read the frozen `sales.cost` — immutable once written ✅ | unchanged |

## 5. Formula inventory (revenue / cost / profit)

| File · function | Formula | Authoritative? | Divergence risk |
|---|---|---|---|
| `BillingModule.totalsOf` | `cost = Σ num(l.purchasePrice)·num(l.qty)`; `profit = afterDisc − cost` | **YES** (the invoice's own profit) | — |
| `InventoryDashboard.invTotals` | `profit = toNum(iv.profitAmount)` (stored) | derived from `totalsOf` | — |
| `billingService.invoiceTotals` | mirrors `totalsOf` (PH22-01) | derived | — |
| `billingService.revenueLines` | `cost = l.partId ? qty·toNum(l.purchasePrice) : 0` | **YES** (line snapshot) — but **not called by production** | — |
| `InventoryDashboard.invoiceRevenueLines` + `planInvoiceRealization` / `recordInvoiceSalesDelta` | **was** `dCost = dQty · inventory.find(...).purchasePrice`; **now** `dCost = a.cost − b.cost`, `e.cost += qty · (l.purchasePrice ?? catalogue)` | **YES** (post-fix) | **PH23-D1** — resolved |
| `runQuickSaleTx` | `cost = want · unitCost` (call-site passes `part.purchasePrice`) | YES — instantaneous sale | none (no billing/realization gap) |
| `analyticsService.computeWorkshopProgress` | `revOf = Number(s.revenue ?? s.total ?? 0)` | reads frozen ledger | none |
| `lib/vehicleStats.revenueOf` | `Σ invoiceTotals(iv).grand` for `isRealized` | **GST-inclusive** turnover | §17 — intentional, cross-view |
| `syncCustomerTotals` | `totalSpent = Σ invTotals(iv).paid` | **cash collected** | §17 — intentional, cross-view |
| `AnalyticsView.kpi` (`lockedCapital` / `expectedProfit`) | `(p.sellingPrice − p.purchasePrice)·p.stock` | inventory valuation, not a sales metric | §17 — intentional |

## 6. Independent oracle

`tests/analytics-integrity.test.cjs`:

- **`oracleLedger(iv)`** — re-derives `lineNet → sub → invDisc → afterDisc → lineRev
  (scaled) → lineCost → profit` by hand; never calls a production helper.
- **`§12 planLedger`** — a line-for-line reproduction of the *shipped*
  `invoiceRevenueLines` (cost accumulation + catalogue fallback) and the diff loops'
  `dCost = a.cost − b.cost`, each backed by a `dash.match(...)` source assertion so
  the reproduction provably matches what ships.
- **`§0b`** — asserts the `paidCopy` fixture pays a *hand-verified* grand (1000),
  so the "pay the invoice to realize it" shortcut cannot mask a `totalsOf` bug.

## 7. PH23-01 attack results  (invoice-level discount allocation)

`§13` — the `afterDisc/sub` line-revenue scaling attacked with:

| case | afterDisc | Σ allocated | drift |
|---|---|---|---|
| 3×₹1, ₹2 flat (scale 2/3) | 1.00 | 1.00 | 0 |
| ₹0.1+0.2+0.3, 10 % | 0.54 | 0.54 | 0 |
| 33.33×3 + 66.67, ₹7 flat | 159.66 | 159.66 | 0 |
| 999.99 + 1000.01, 33 % | 1340.00 | 1340.00 | 0 |
| primes 7/11/13/17/19, ₹23 flat | 44.00 | 44.00 | 0 |
| 97 lines ₹3.33, ₹101 flat | 222.01 | 222.01 | 8.5 × 10⁻¹⁴ |
| 3 lines ₹1e7, ₹1 flat | 29 999 999 | 29 999 999 | 0 |

**Worst drift `8.5 × 10⁻¹⁴`** — sub-nano-paisa. The only non-zero result is
`totalsOf`'s own `p2()` paisa-rounding of a `₹999.999`-type subtotal (≤ ₹0.001),
which rounds away on any display. **PH23-01 CONFIRMED — rounding-safe.**

## 8. Revenue results

Truth table (`§1`), GST-exempt: `oracle 3500 ↔ ledgerDelta 3500 ↔ reconstructed
rollup 3500 ↔ Σ totalsOf().afterDisc 3500`. **CONFIRMED — MATCHES SOURCE OF TRUTH.**

Revenue is **unaffected by PH23-D1** (that is a cost-side defect).

## 9. Cost results  →  PH23-D1

`§12` — line snapshots ₹600/unit; the part master is raised to ₹900 between billing
and realization:

| | value |
|---|---|
| `totalsOf().profit` (Billing report / `iv.profitAmount`) | **₹800** (2 × (1000 − 600)) |
| `billingService.revenueLines` Σcost | **₹1200** (line snapshot) |
| shipped component ledger Σcost — **BEFORE** | **₹1800** (2 × today's ₹900) ❌ |
| → analytics profit for this invoice — **BEFORE** | **₹200**, vs the invoice's own ₹800 |
| shipped component ledger Σcost — **AFTER the fix** | **₹1200** ✅ (== `revenueLines`, reconciles with `profitAmount`) |
| legacy line carrying no `purchasePrice` — **AFTER** | falls back to catalogue (₹1800) ✅ (backward compatible) |

**CONFIRMED DEFECT — now fixed.** See `§27`.

## 10. Historical-cost immutability results

- **AFTER realization**: the `sales` row stores `cost: dCost` and `profit: dRev − dCost`
  as plain numbers. A later part-master edit cannot touch a written row — the
  analytics views read `s.cost`, never recompute. **Immutability holds** (asserted
  `§12`).
- **BEFORE realization** (draft edited / part cost changed, then paid): **was
  broken** — the sale realized at *today's* catalogue cost. **Fixed** — realizes at
  the line's billing-time snapshot.
- **Editing a paid invoice** (add a unit): **was** priced at today's catalogue;
  **now** the added `dQty` is priced at the line's own snapshot (`a.cost − b.cost`).

## 11. Gross-profit results

`profit = revenue − cost` at every layer; `salesRollups.profit` incremented from the
same `dRev − dCost` as `revenue`/`cost` → **no drift** (`rollup.profit ==
rollup.revenue − rollup.cost` by construction). Negative profit never clamped
(`§4`: a loss sale reports −₹400). **CONFIRMED.**

## 12. Margin results

`margin = profit/revenue×100`, `revenue > 0` guarded at all 5 sites
(`pMargin` / `avgMargin` / trend / `sales.margin` / row display). 5 degenerate
inputs, all finite. **CONFIRMED.** PH23-D1 also mis-stated **margin** on affected
invoices (cost wrong → margin wrong); fixed with the cost fix.

## 13. Discount results

`§2`, `§19`: no-discount / per-line / invoice-flat / invoice-percent / combined —
`Σ ledger revenue == totalsOf().afterDisc` and `Σ ledger profit == totalsOf().profit`
in every combination. **CONFIRMED.**

## 14. GST results

`§3`: analytics revenue / cost / profit **never contain GST** — `s.revenue` is
`qty·rate·(1−disc%)` (ex-GST line net), `s.cost` is `qty·purchasePrice`, GST is only
ever a separate figure (`iv.gstAmount`, Billing `gstTotal`, GST report). GST cannot
be double-counted in the profit chain because it is **structurally absent**.
**CONFIRMED CLEAN.**

## 15. Payment vs revenue results

`§5`: a 40 %-paid invoice → `isRealized` false → `revenueLines` empty → **0** analytics
revenue; full payment recognises the whole invoice at once. Accrual-style, deliberate.
**CONFIRMED.**

## 16. Status semantics

`§6` (Phase 23) unchanged and re-confirmed: `Draft` / `Estimate` / partial → not in
analytics; `Paid` → in; `Cancelled` / `Refunded` / `Returned` → reversed via an exact
inverse delta (`§6` Phase 23, `§6` here). The gate is `isRealized`, **not** a raw
status string.

## 17. Cross-view formula differences  (explicit inventory — `§15`)

| # | View | "Revenue" definition | Classification |
|---|---|---|---|
| 1 | Dashboard / Sales / Services / Reports Monthly Trend | realized invoice subtotal, **post-discount, ex-GST** (`Σ sales.revenue`) | the analytics baseline |
| 2 | **Billing "Revenue (Month)" / "Revenue Today"** | `Σ totalsOf(iv).grand` — **GST-inclusive**, **and includes Draft + Unpaid** invoices (everything except Cancelled) | **INTENTIONAL but mislabeled** — it is *invoiced turnover*, not revenue. LOW. Documented in `KNOWN_LIMITATIONS`. |
| 3 | Vehicle Analytics "Revenue" | `Σ invoiceTotals(iv).grand` for `isRealized` — **GST-inclusive**, paid-only | **INTENTIONAL** — per-vehicle turnover. Its code comment's claim of "agrees with … Analytics by construction" is **inaccurate** (differs by GST); comment corrected. |
| 4 | Customer "Total Spent" | `Σ invTotals(iv).paid` — **cash collected** | **INTENTIONAL** — a collections/receivables figure. |

**DEFECT check:** no view sums a GST-inclusive figure together with an ex-GST figure
into one number — each stays inside one family. The differences are definitional,
not arithmetic errors. Sharpened in `KNOWN_LIMITATIONS`.

## 18. Rounding / floating-point results

`§13` (above) — PH23-01 allocation drift `≤ 10⁻¹³`. `totalsOf` rounds money to paisa
at the boundary (`p2()`); the ledger keeps unrounded values, so a `₹999.999`-type
subtotal can differ by `≤ ₹0.001` between the invoice's `afterDisc` and `Σ ledger
revenue`. Sub-paisa, non-accumulating in practice (needs pathological rates).
**INFO — not a defect.**

## 19. Date-boundary results

`§8` (Phase 23) re-run + `§14` here: `computeRange` month/lastmonth/year is closed on
both ends, `lastmonth.end + 1ms == month.start` (no overlap, no gap); a JS
`Date(2026, 0, 32)` normalises to Feb 1 → `'2026-02'` (grouping is well-defined at a
rollover); `YYYY-MM` keys are zero-padded and sort lexically. **CONFIRMED.**

## 20. Monthly rollup results

`§10`, `§16` (Phase 23) + `§14` here: `Σ month totals == period total`; demo rollups
reconcile with the demo ledger (±0.5 %) and with paid-invoice subtotals (±2 %); the
`cost = 0` regression (BUG-LIVE-005) stays closed. PH23-D1's cost error also flowed
into `salesRollups.cost` (fed by the same `dCost`) — the same fix corrects the rollup.

## 21. Rollup drift results

Every rollup writer increments `revenue` / `cost` / `profit` from the **same** delta
in the **same** transaction, so `rollup.profit == rollup.revenue − rollup.cost`
cumulatively — **structurally impossible to drift**. Shape note: invoice realization
writes `partsRevenue/labourRevenue/serviceRevenue/outsideRevenue/units`; Quick Sell
writes `units/orders`. The Reports trend reads only `revenue/cost/profit` (present on
both), so mixed-source months are still correct; the extra fields are just sparsely
populated. **INFO.**

## 22. Reversal results

`§6` (Phase 23): sale + reversal nets to **0 / 0 / 0**; re-saving a paid invoice
posts **no** new ledger rows (idempotent). PH23-D1 fix keeps this — the reversal
diffs `a.cost − b.cost` the same way, so a cancelled invoice unwinds the exact cost
it booked (its own snapshot), not today's catalogue.

## 23. Duplicate-realization results

Cross-checked against Phases 4b/5b/8b — not re-tested end to end. The realization
plan is diff-based (`prior → next` on realized values); saving the same paid invoice
twice yields a zero delta; the transaction is keyed (`sales/{opId}` for Quick Sell,
diff-idempotent for invoices). PH23-D1's fix does not touch idempotency (still a
pure `a − b` diff). **No regression.**

## 24. Zero / null / malformed results

`§9` (Phase 23) re-run: empty invoices → 0/0/0, `revenueLines(undefined)` → `{}`,
`computeWorkshopProgress({})` → finite %; PH21-D1's `asArray` guards still hold.
PH23-D1's `l.purchasePrice != null && l.purchasePrice !== ''` guard coerces a missing
/ blank / string cost snapshot to the catalogue fallback rather than `NaN`.

## 25. Cross-view results

`§17` (above). The 4 "Revenue" definitions are inventoried and classified in the
test (`§15`) and in `KNOWN_LIMITATIONS`.

## 26. Cache / refresh + Concurrency cross-check

Not re-tested end to end (Phases 5b/6b/22U cover it). The analytics views are pure
functions of `sales` / `rollups` / `invoices` React state, which is
listener-hydrated; a refresh re-derives from the same source. PH23-D1's fix is in
the write path (what cost gets frozen), not the read path, so refresh consistency is
unchanged.

## 27. Confirmed defect + root cause + fix

### PH23-D1 (MEDIUM)

| | |
|---|---|
| **Workflow** | (a) draft an invoice, the part's cost is edited (or a PO is received at a new price with "update default price"), then the invoice is paid; or (b) edit a paid invoice after a part-cost change. |
| **Expected** | analytics COGS for that sale = the cost captured on the invoice line when it was billed (what `totalsOf` / `iv.profitAmount` / the Billing report use). |
| **Actual (before)** | `planInvoiceRealization` / `recordInvoiceSalesDelta` computed `dCost = dQty × inventory.find(partId).purchasePrice` — **today's** catalogue cost. The `sales` row, `salesRollups.cost`, and every dashboard / Sales / Reports profit & margin for that sale used the wrong cost; the operational dashboard disagreed with the Billing screen on the same invoice's profit. |
| **Root cause** | `invoiceRevenueLines` (which both diff loops consume) carried `qty` and `revenue` per line but **not cost**, so the loops had to re-source cost — and reached for the live `part` object they were already fetching for `part.name` / `part.sku`. `billingService.revenueLines` (the exported twin) always used `l.purchasePrice`; production just never called it. Same class as PH23-01: correct source (`totalsOf`), an intermediate re-calculation missing an input, a plausible-looking dashboard. |
| **User impact** | A shop that revalues parts (PO receipts, price edits) sees analytics profit/margin drift from the invoices' own figures — understated when costs rose, overstated when they fell — between billing and payment, and on any later edit of a paid invoice. Realized-and-untouched sales are unaffected (their `sales` row is frozen). |
| **Fix** | `invoiceRevenueLines` now accumulates `e.cost` per key from `l.purchasePrice` (catalogue fallback only for a legacy line with no snapshot), and also carries `e.listPrice`. Both diff loops now compute `dCost = a.cost − b.cost` — **symmetric with the existing `dRev = a.revenue − b.revenue`** — instead of `dQty × liveCatalogue`. `unitCost` on the sales row becomes `dCost / dQty`. All four money paths (`totalsOf`, `invTotals` via `profitAmount`, `billingService.revenueLines`, the component ledger) now agree. |
| **Regression test** | `tests/analytics-integrity.test.cjs` §12 — source-pattern assertions on the shipped expressions + a line-for-line reproduction proving `Σ ledger COGS == 1200` (snapshot) not `1800` (catalogue), reconciling with `totalsOf().profit`; a legacy-line case proving the catalogue fallback still fires; an immutability assertion (`sales` row stores `cost: dCost`). |
| **Live validation** | Demo mode: draft INV-0299 (line snapshot ₹1000), then two PO receipts raised `demo-part-1.purchasePrice` to **₹1200**, then paid the invoice → `sales` row `cost 1000`, `profit 398`, `margin 28.5` — **the ₹1000 snapshot, not the ₹1200 catalogue**, and `profit 398 == iv.profitAmount 398`. Pre-fix this row would have been `cost 1200 / profit 198`. |

## 28. Remaining duplication

- `billingService.revenueLines` / `ledgerDelta` remain the **exported, tested, but
  production-unused** twin of `InventoryDashboard.invoiceRevenueLines` /
  `planInvoiceRealization`. Both now apply the invoice discount (PH23-01) **and**
  take COGS from the line snapshot (PH23-D1), so they agree — but the duplication is
  real. Completing the `services/` extraction (so the component imports the service)
  stays a `ROADMAP` "Code health" item; it needs the component's catalogue
  enrichment (`part.name` / `part.sku` / `brandsOf` / `part.category`) moved too.

## 29. Remaining limitations

- **Analytics vs Billing "Revenue" labels** — analytics is realized ex-GST; the
  Billing card is GST-inclusive turnover *including unpaid invoices*. Numerically
  correct sums of different things; a label clarification (not a code change) is the
  right fix. Documented.
- **Sub-paisa ledger/afterDisc gap** on pathological rates (≤ ₹0.001/invoice, §18).
- **PH21-D2** (wrong-type nested scalar as a React child) — unchanged, deferred.
- **Authenticated production reconciliation** — not performed (no authenticated
  production browser session this session, same tooling limit as Phases 6/7/22/23).
  The demo path exercises the identical realization + ledger code; only the write
  destination differs.

## 30. Code-growth review

```
Production lines added:     ~35   (components/InventoryDashboard.js only)
Production lines removed:    ~11
Net production change:       +24   (~18 of which are the PH23-D1 comment blocks)

Test lines added:           ~170  (tests/analytics-integrity.test.cjs §0b, §12–15)
Test lines changed:            2  (tests/ledger-integrity.test.cjs — 1 brittle regex widened)
Documentation lines added:  ~430  (this report + ROADMAP + KNOWN_LIMITATIONS)

New production functions:      0
New production files:          0
New abstractions:              0

Existing mechanisms reused:   the diff-loop pattern itself — `dCost = a.cost − b.cost`
                              is the exact shape of the `dRev = a.revenue − b.revenue`
                              already one line above it; the `l.purchasePrice ?? catalogue`
                              fallback mirrors the adjacent `meta.listPrice || catalogue`.
Unnecessary code removed:     the `const part = …; const unitCost = part?.purchasePrice`
                              catalogue lookup for cost (part is still fetched for
                              name/sku/brands, so no net object fetch removed).

Significant new logic:        `invoiceRevenueLines` now accumulates `e.cost`; both diff
                              loops diff it instead of multiplying by a live figure.
Why an existing mechanism could not handle it:  the two diff loops are
                              component-scoped closures duplicated from a pre-Phase-8B
                              function; `billingService.revenueLines` already does the
                              right thing but is not on the production path. Wiring the
                              component to the service is the real consolidation and is
                              a separate, larger task (see §28).
```

## 31. Regression results

| Gate | Result |
|---|---|
| `npm test` | **144 / 144 test files** (`analytics-integrity.test.cjs` 105 assertions — was 70) |
| `npm run test:rules` | **2 / 2** (150 + 111) — **no `firestore.rules` change** |
| `npm run lint` | **0 errors** |
| `npm run build` | **✓ compiled successfully** |

No `.skip` / `.only` / mock-only shortcuts introduced. Mutation self-test (`§32`)
proves the analytics assertions are non-vacuous.

## 32. Mutation-test evidence

`tests/analytics-integrity.test.cjs` §14 — the truth-table aggregate (Rev 1000 /
Cost 600 / Profit 400 / Margin 40) is mutated and the reconciliation check re-run:

| mutation | detected? |
|---|---|
| revenue + 1 | ✅ |
| cost + 1 | ✅ |
| profit + 1 | ✅ |
| revenue × 1.001 (0.1 %) | ✅ |
| drop the sale entirely | ✅ |
| swap revenue and cost | ✅ |

**6 / 6 mutations caught.** The assertions can detect analytics corruption.

## 33. Test-suite quality assessment

| | before this audit | after |
|---|---|---|
| assertions | 70 | **105** |
| exercises the **shipped** ledger path | ✗ (only `billingService.ledgerDelta`, unused in prod) | ✅ (`§12` reproduces `planInvoiceRealization` + source-pattern assertions) |
| independent-oracle expected values | mostly (some `Σ totalsOf` cross-checks) | + `§0b` fixture-soundness, + `§12` hand constants |
| rounding / float attack | ✗ | ✅ `§13` (7 adversarial cases) |
| historical-cost immutability | ✗ | ✅ `§12` |
| mutation self-test | ✗ | ✅ `§14` (6/6) |
| cross-view definition inventory | prose only | ✅ `§15` (4 definitions, source-asserted) |

## 34. Confirmed defects

**PH23-D1 (MEDIUM)** — `§27`. No CRITICAL, no HIGH, no additional MEDIUM, no LOW.

## 35–37. Root causes / fixes / remaining duplication

`§27` and `§28`.

## 38. Remaining limitations

`§29`.

## 39. Code-growth review

`§30`.

## 40. Regression results

`§31`.

## 41. QA cleanup

- Live PH23-D1 validation created demo invoices **INV-0297 / INV-0298 / INV-0299**,
  two demo PO receipts, and modified `demo-part-1.purchasePrice` — all in the
  **browser demo sandbox** (never production Firestore). All demo storage keys were
  then wiped and the demo **re-seeded pristine** (296 invoices, `demo-part-1`
  purchasePrice back to 830, stock 18 — verified). No QA residue.
- Scratch probes (`scratchpad/ph23*.cjs`) deleted.
- No debug logging, no secrets, no `.skip` / `.only`.
- Dev server and browser pane stopped.

## 42. Final classification

**CONDITIONAL PASS.**

Analytics Revenue / Gross Profit / Margin reconcile end to end against an independent
oracle, mutation testing proves the suite is non-vacuous, and PH23-01's discount
allocation is rounding-exact. **Cost** did **not** fully reconcile: the shipped
production ledger took COGS from the live part catalogue, not the invoice line's
snapshot — **PH23-D1**, a genuine "source correct → intermediate re-calculation
missing an input → plausible wrong dashboard" defect of the same class Phase 23
was chartered to find. It is fixed (the ledger now diffs the line's own cost
snapshot, symmetric with revenue), verified by an independent reproduction and live
in demo mode, and reconciles all four money paths.

The single remaining condition on an unqualified PASS: **authenticated production
reconciliation was not performed** (tooling limitation, not an app issue). Every
other invariant is independently supported.

---

## Final summary

```
PHASE 23 DEEP RE-AUDIT: CONDITIONAL PASS

PREVIOUS PHASE 23 PASS:            PARTIALLY CONFIRMED
  - Revenue / Gross Profit / Margin: CONFIRMED
  - PH23-01 (invoice discount):      CONFIRMED FIXED (rounding-exact, worst drift 8.5e-14)
  - Cost reconciliation:             PARTIALLY CONFIRMED → the tested path was not the
                                     shipped path; shipped path had PH23-D1

SOURCE-OF-TRUTH CHAIN:             correct after PH23-D1 fix
INDEPENDENT ORACLE:                oracleLedger + a line-for-line reproduction of the
                                   shipped component ledger, source-pattern-guarded
REVENUE:                           MATCHES (3500 at every layer)
COST:                              was WRONG on the shipped path (PH23-D1) → FIXED (1200, not 1800)
GROSS PROFIT:                      MATCHES (revenue − cost, no rollup drift)
MARGIN:                            MATCHES (guarded; was mis-stated on PH23-D1 invoices → fixed)
DISCOUNT:                          MATCHES (flat/percent/combined; PH23-01 rounding-exact)
GST:                               structurally absent from the profit chain — CLEAN
PAYMENT VS REVENUE:                accrual (realized), intentional
DATE BOUNDARIES:                   closed both ends, no overlap/gap, rollover well-defined
MONTHLY ROLLUPS:                   reconcile; profit == revenue − cost by construction
REVERSALS:                         exact inverse, idempotent
DUPLICATE REALIZATION:             diff-based, unchanged by the fix — no regression
HISTORICAL COST:                   post-realization: immutable (frozen row);
                                   pre-realization / on-edit: was broken → FIXED
CROSS-VIEW CONSISTENCY:            4 "Revenue" definitions, all classified; no mixed-unit sums
LIVE DEMO:                         PH23-D1 fix verified end to end (INV-0299: cost 1000 not 1200)
AUTHENTICATED PRODUCTION:          NOT PERFORMED (no authenticated session — tooling limit)
FIRESTORE RULES:                   unchanged; 2/2
PROPERTY TESTING:                  profit == revenue − cost, Σ months == period, rollup == Σ ledger — hold
MUTATION TESTING:                  6/6 corruptions detected

NEW DEFECTS FOUND:                 1
CRITICAL:                          0
HIGH:                              0
MEDIUM:                            1  (PH23-D1)
LOW:                               0

FIXES:                             1
TESTS:                             105 assertions (analytics-integrity.test.cjs), +35 new
TESTS THAT WOULD FAIL UNDER MUTATION:  6/6 (verified)
PRODUCTION CODE CHANGE:            yes
PRODUCTION NET LINES:              +24 (1 file; ~18 comment)
COMMIT:                            5862e0f
DEPLOYMENT:                        Vercel JmDw5LSq9NR_zzCyRspJM (/, /login, /verify → 200)
QA CLEANUP:                        complete — demo re-seeded pristine, scratch deleted
REMAINING LIMITATIONS:             billingService ledger twin unused in prod (ROADMAP);
                                   Billing "Revenue" label = turnover not revenue (doc);
                                   sub-paisa afterDisc/ledger gap on pathological rates (INFO);
                                   authenticated production reconciliation not run
FINAL CONFIDENCE:                  HIGH for the analytics math; MEDIUM-HIGH overall
                                   (pending authenticated-production spot-check)
```
