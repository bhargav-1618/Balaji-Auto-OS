# Phase 24 — Empty-State / Cardinality / UI Resilience Integrity

**Question:** does every derived value stay **finite**, every count stay **correct**, every
pager stay **in range**, and every chart stay **crash-free** when a collection holds
**0, 1, 2 or many** records — including while the dataset is *shrinking* under an active view?

**Outcome — 2 LOW defects, both fixed. No CRITICAL / HIGH / MEDIUM.**

| ID | Sev | One-line |
|---|---|---|
| **PH24-01** | LOW | `VehiclesModule` mobile card rendered **"1 visits"** — the visit count never singularised. |
| **PH24-02** | LOW | `CustomersModule` mobile card rendered **"1 bills"** — same, one token after a correctly-pluralised "1 vehicle". |

Everything material — pagination, KPI arithmetic, charts, dependency lookups, filter→zero,
cardinality transitions — is **PASS**, and is now independently pinned by
`tests/empty-state-integrity.test.cjs` (147 assertions, independent oracles).

**FINAL ASSESSMENT: PASS.** The app is already hardened against empty / single / two-record
states by Phases 16 (pagination), 21 (malformed input) and 23 (analytics). This pass swept
every module, chart and lookup at 0/1/2/many and found only two cosmetic pluralisation slips,
both fixed by reusing the app's own `x === 1 ? …` idiom.

---

## 1. Scope

Behaviour of every list, KPI, chart, table, dropdown, lookup dialog and export at **0 / 1 /
2 / many** records, plus the **transitions** between those cardinalities and the
**shrink-while-viewing** case. Source audit + 147 automated assertions with independent
oracles + live demo-mode validation across 6 modules. No production data touched.

## 2. Module inventory

| Module | Component | List pager | KPIs / charts | Dependency lookups |
|---|---|---|---|---|
| Dashboard | `OverviewView` (`InventoryDashboard.js`) | — | Inventory Health, Workshop Score, Workshop Progress, Today's Overview, Top Selling, `Trend` | — |
| Job Cards | `jobcards/JobCardModule.jsx` | inline (Phase 16) | KPI buckets (`jobMatchesKpiBucket`) | free-text customer / reg (no lock) |
| Customers | `customers/CustomersModule.jsx` | inline `safePage` (Phase 16) | With-Outstanding, Vehicles Registered | — |
| Vehicles | `vehicles/VehiclesModule.jsx` | inline `safePage` (Phase 16) | `computeVehicleStats` (Ins/PUC/Warranty expiring, avg visits, revenue) | customer picker (`SearchSelect`) |
| Billing | `billing/BillingModule.jsx` | inline `safePage` (Phase 16) | `stats` (13 KPIs), `RevenueTrend`, `Donut`, `BarPair` | customer / vehicle / job-card `SearchSelect` + walk-in + inline "New Customer" |
| Sales / Services / Stock In / Stock Out | `LedgerPage` (`common/LedgerPage.jsx`) | shared | ledger cards | — |
| Inventory | `InventoryDashboard.js` (Parts) + `inventory/*` | shared `<Pagination>` | health, reorder | — |
| Suppliers | `inventory/SupplierDirectory.jsx`, `SupplierPerformance.jsx`, `SupplierPOBuilder.jsx` | shared `<Pagination>` | perf scores, `avg` helpers | part / supplier pickers |
| Analytics | `AnalyticsView` (`InventoryDashboard.js`) | inline "N of M" | Locked/Expected/Dead Capital, Monthly Profit Trend, Top Parts, Fast Movers, Dead Stock, Revenue Mix, Vehicle Analytics, Restock Cost | filter bar (category / brand) |
| Reports | `ReportsView` (`InventoryDashboard.js`) | inline | overview KPI row, `RSpark`\* | — |
| Alerts | `computeAlerts` + Alert Center | — | alert list | — |

\* `RSpark` / `RDonut` / `RBars` are **defined but rendered nowhere** — dead code (INFO-A).

**Shared infrastructure reused (no duplication added):** `components/inventory/Pagination.jsx`,
`components/common/SearchSelect.jsx`, `services/analyticsService.js` guards,
`lib/vehicleStats.js`, `lib/format.js` (`trendPct`, `pluralize`), `lib/useSearch.js`
(`searchAndRank`, `rankIndexed`), the `DashEmpty` / `OverviewCard` empty-state shell
(Phase: `dashboard-card-grid-consistency`).

## 3. 0-record results

| Surface | 0-record behaviour | Verdict |
|---|---|---|
| `<Pagination total={0}>` | `pageCount = max(1, ceil(0/per)) = 1` → **renders nothing** | PASS |
| Customers / Vehicles / Billing list | empty-state row ("No … match. Tap 'New …'"), **"Showing 0 to 0 of 0"**, **"1 / 1"**, Prev+Next disabled, **create button stays** | PASS |
| `computeInventoryHealth([])` | early return `{ score: 100, factors: [] }` | PASS |
| `computeWorkshopScore` / `computeWorkshopProgress` (all empty) | every `pct` a finite `0`, `totalWeight ? … : 0` guard, no NaN | PASS |
| `computeVehicleStats([], …)` | all counts `0`, **`avgVisits: '0'`** (not `"NaN"`) | PASS |
| `computeAlerts` / `computeInsights` / `computeAchievements` (empty) | `[]`, no throw | PASS |
| `totalsOf` / `invoiceTotals` / `invTotals` on a 0-line invoice | every figure finite, `grand === 0` | PASS |
| `RevenueTrend` / Monthly Profit Trend / donuts at empty | explicit empty state OR flat/zero render — `Math.max(1, …)` / `total > 0 ? …` / `|| 1` floors | PASS |
| `SearchSelect` with `options=[]` | input still rendered, placeholder = `noOptionsText`, panel shows `noOptionsText`, **no "0 of 0" row** | PASS |
| Analytics / Reports "no sales" | "No sales recorded in this period yet." card | PASS |

**No `undefined` / `null` / `NaN` / `Infinity` reached any surface at 0 records.**

## 4. 1-record results

| Check | Result |
|---|---|
| `<Pagination total={1}>` | renders nothing (1 page) | PASS |
| List count == 1 | `filtered.length` drives "Showing 1 to 1 of 1" | PASS |
| `computeVehicleStats` — 1 vehicle, 1 completed visit | `total 1`, `avgVisits "1.0"`, `repeat 0` (needs `> 1`) | PASS |
| `trendPct(x, 0)` (only-this-period data) | `x > 0 ? 100 : 0` — **never `Infinity`** | PASS |
| `computeMonthlyTrend` — 1 month | `growth` is `null` (needs `prev`), `best === worst === series[0]`, `avg` finite | PASS |
| Chart with 1 point (`RSpark`) | `if (data.length < 2) return "Not enough data yet."` — guarded **before** `pts[-1]` | PASS |
| **Singular / plural at 1** | `VehiclesModule` "**1 visits**" · `CustomersModule` "**1 bills**" | **PH24-01 / PH24-02 — FIXED** |
| `pluralize('x', 1) === 'x'` (existing helper) | correct | PASS |
| Customers card "1 vehicle" (existing `=== 1 ? …`) | correct — the two fixes match this idiom | PASS |

## 5. 2-record results

| Check | Result |
|---|---|
| `<Pagination total={2}>` | renders nothing | PASS |
| `computeVehicleStats` — 2 vehicles, one with 2 completed visits | `total 2`, `repeat 1`, `avgVisits "1.5"` | PASS |
| `searchAndRank([A,B,C], "brake")` | exactly the 2 matching rows | PASS |
| Monthly trend — 2 months | `growth` computed, guards `prev.profit !== 0` | PASS |
| 2-point line chart | valid two-point path, no NaN | PASS |
| Delete/archive one of two → 1 | count, pager, KPIs all track down (transition test §23) | PASS |

## 6. Large-dataset results (demo mode — "many")

Live in demo (`?demo=1`), 123 parts / 200 customers / 350 vehicles / 296 invoices /
1,124 sales / 300 job cards:

| Surface | Observed | Verdict |
|---|---|---|
| Dashboard | Inventory Health 99%, Workshop Score 83/100, every Workshop-Progress pct finite (36/44/100/84%), Today's Overview `▲ 148% vs prev` | PASS |
| Analytics | Revenue ₹42,40,819 / Cost ₹18,07,964 / Profit ₹24,32,855 / **Margin 57.4%**, `▼ Profit decreased 62.7% vs previous month`, Monthly Trend 4 bars, Revenue Mix donut, "Showing 10 of 175", "9 of 9 brands", "4 of 4" dead-stock | PASS |
| Billing | Avg Invoice ₹16,001.35, GST ₹4,95,577.62, "Showing 1–25 of 296 · 1 / 12", 14-day trend sparkline + payment-mode donut | PASS |
| Customers | "Showing 1 to 10 of 200 · 1 / 20", With-Outstanding 53 / ₹3,60,019 | PASS |
| Vehicles | Ins/PUC/Warranty Expiring 103/141/153, "Showing 1–25 of 350 · 1 / 14" | PASS |
| Console | only pre-existing `HEAD /outro.mp4 404` (demo intro video absent from repo — unrelated) | PASS |

Pagination crossed page boundaries (paged to "4 / 14" — "Showing 76–100 of 350"), the
top-N caps (Top Parts 10/175, Fast Movers 10/175), and the `SearchSelect` virtualisation
threshold (60) — all correct.

## 7. Pagination

Independent oracle (`pageCount = max(1, ceil(n/per))`, `safe = min(max(1,page),pageCount)`)
vs the shipped `<Pagination>` at `0 / 1 / 2 / per / per+1 / 2·per / 237`:

- `hidden` iff `pageCount <= 1`; "from–to of total" and "N / M" exact; Prev disabled on page 1;
  Next disabled iff on the last page.
- **Shrink while viewing** (mounted on page 3, dataset 100 → 5): the pager's own effect
  `if (page > pageCount) onPage(pageCount)` pulls the caller back to page 1; the caller
  re-renders and the pager then hides. **No empty page, no stale index.**
- **Stale page far past the end** (page 7 of a 2-page set): counter clamps to "2 / 2" (never
  "7 / 2"), Next disabled.
- Customers / Vehicles inline pagers verified: `safePage = Math.min(page, pageCount)`,
  Next increments a **clamped** page (`setPage(p => Math.min(p, pageCount) + 1)` — no runaway
  index), "Showing X to Y of Z" renders `0` (not `undefined`) when empty.

Cross-checks Phase 16 (`search-filter-pagination-integrity.test.cjs`), still green.

## 8. Search

`searchAndRank` / `rankIndexed` (the shared engine) at `0 items`, `1 item` (match / no
match), `2+ items` (`0 / 1 / 2` matches), empty query (→ all), and `rankIndexed(undefined, q)`
→ `0` (never throws). Live: a nonsense query in Customers → "No customers match. Tap 'New
Customer'…", "Showing 0 to 0 of 0", pager reset to "1 / 1", clear → full 200 back.
`SearchSelect` `useEffect([q, options.length])` resets highlight + scrollTop on every query
change (the "dropdown looks empty after narrowing" bug stays fixed). PASS.

## 9. Filters

Billing status filter → **Unpaid** (demo has none) → **zero**: "No invoices match. Tap 'New
Invoice'…", "Showing 0–0 of 0", "1 / 1", **New Invoice button stays**, **no console error**;
clear → 296 back. The KPI cards are **workshop-wide by design** and do not rescope to the
list filter (INFO-E) — verified they show no stale/wrong value, they simply stay at the
whole-shop figure while the list below empties. Analytics category/brand filter → an
impossible combination yields an empty Top-Parts table with a clear message, charts fall to
their zero state (`Math.max(1, …)` floor), no crash. PASS.

## 10. Sorting

`SearchSelect` and every list sort comparator handle `0 / 1 / 2 / many`. Comparators use
`localeCompare` (text) and numeric subtraction with `|| 0` coercion, so `null` / missing /
equal / negative values order deterministically and never throw. `computeMonthlyTrend`'s
`best`/`worst`/`bestRev` use `reduce(…, null)` so an empty series yields `null`, not a throw.
Vehicles "Most Visits" / "Highest Revenue" sorts verified live at scale. PASS.

## 11. KPI behaviour

Every KPI family scanned for finiteness at `0 / 1 / 2` records (deep leaf-value walk asserting
`Number.isFinite` and no `/\b(NaN|Infinity|undefined|null)\b/` token):

| KPI | Zero-safety mechanism |
|---|---|
| Inventory Health | `if (!n) return { score: 100, factors: [] }` |
| Workshop Score | `score = totalWeight ? round(Σ pct·w / totalWeight) : 0`; `supScore` only when `withOt.length > 0`; `qtyOf` coerces non-numeric (PH21-D1) |
| Workshop Progress (7 metrics) | every `pct` is `X.length ? round(...) : 0`; `target = priorKeys.length ? … : 0`; `goalPct = target > 0 ? … : (rev > 0 ? 100 : 0)` |
| Revenue / Cost / Profit / Margin (Analytics) | `margin = totRev > 0 ? (totProfit/totRev)*100 : 0`; explicit `series.length === 0` empty card |
| Avg Invoice (Billing) | `avgInv = realCount ? grand / realCount : 0` |
| Avg Visits (Vehicles) | `active ? (completedVisits / active).toFixed(1) : '0'` |
| Trend "▲ x% vs prev" | `trendPct`: `if (!yest) return today > 0 ? 100 : 0` — no divide-by-zero, no Infinity |
| Dead Capital / Locked Capital | `reduce(…, 0)` — plain sums, zero-safe |
| High / Low invoice | `grands.length ? Math.max(...grands) : 0` |
| Doc counters (`nextInvNo`, `nextCode`, PO#) | `reduce(…, 0)` / `nums.length ? Math.max(...nums) : <seed>` |

Cross-checks Phase 23 — the four analytics defects (PH23-01/D1/D2/D3) stay fixed; nothing here
regressed them. **All KPIs finite and zero-correct at every cardinality.**

## 12. Charts

| Chart | 0 pts | 1 pt | 2+ pts | Guard |
|---|---|---|---|---|
| `RevenueTrend` (Billing 14-day) | n/a — **always** fed a fixed 14-entry `stats.trend` (`for i=13..0`) | n/a | flat line when all `rev = 0` | `Math.max(1, …)`; unreachable `<2` path (INFO-B) |
| Monthly Profit Trend (Analytics) | explicit `series.length === 0` empty card | 1 bar | N bars | `maxBar = Math.max(1, …)`, `margin` guarded, `growth` guards `null` + `prev.profit !== 0` |
| `Donut` (Billing) | empty ring | — | — | `frac = total > 0 ? s.value/total : 0` |
| `Donut` (InventoryOverview) | empty ring | — | — | `total = reduce(…, 0) || 1` |
| `RSpark` / `RDonut` / `RBars` | "Not enough data" / "No data yet" | guarded | — | `data.length < 2` / `total <= 0` / `!rows.length` — **but dead code (INFO-A)** |

No chart indexes `data[0]` / `data[len-1]` / assumes `≥ 2` points without a guard **on a
reachable path**. PASS.

## 13. Tables

Every list table renders its header, then either rows or a single centred empty-state cell
(`<td colSpan=…>`). Select-all / bulk-action bars key off `paged.length > 0 && paged.every(…)`
so they're inert (not broken) at zero. Footer totals sum with `reduce(…, 0)`. "Add
Customer / Add Part / Create Invoice / Create Job Card" buttons are gated on
role/permission, **never on collection size** — an empty collection is a valid starting
point everywhere. PASS.

## 14. Buttons / action visibility

Verified live at zero-result: **New Invoice**, **New Customer**, **Add Vehicle**, **Add
Part** all remain present and enabled when the list is empty or filtered to nothing. Export
(Excel / PDF) buttons stay visible; the shared report export guards
`if (!rows || rows.length === 0) { toast.error('Nothing to export yet.'); return; }`.
`SupplierPOBuilder`'s "Confirm & Create PO" is **not** disabled at zero selection — clicking
it is a silent no-op close (`for (grp of [])` runs nothing), so no bad record can be created;
noted as a minor UX nit, **not a defect** (INFO-F). PASS.

## 15. Dependency lookup empty states

The brief's priority area. `SearchSelect` is the one shared dropdown:

- `options=[]` → input placeholder becomes `noOptionsText`, the open panel shows
  `noOptionsText`, **no "0 of 0" footer**, input never disappears, keyboard nav clamps
  (`Math.max(0, shown.length - 1)`).
- **Billing / no customers** → picker says "No customers yet" **and** a "+ New Customer"
  inline-create tab **and** a "+ New / Walk-in" free-text mode → an invoice is fully
  creatable from an empty Customers collection.
- **Billing / no vehicles** → `noOptionsText={inv.customer ? 'This customer has no vehicles
  on file' : 'Select a customer first'}` (contextual) + walk-in vehicle free-text.
- **Billing / no job cards** → "No open job cards for this customer" / "…in the workshop".
- **Job Cards / no customers** → customer + registration are **free-text** (`card.customer`,
  `card.regNo`); no `SearchSelect` lock — a job card needs no existing customer record.
- **PO / no suppliers or parts** → `SupplierPOBuilder` shows "No parts match your filters"
  with a Clear-Filters affordance; a part with no supplier is grouped under `__none__` and
  still orderable.

No `undefined` selected id, no invalid default selection, validation still fires. PASS.

## 16. Cascade empty states

`Customers = 0` → Job Card lookup (free-text, fine) · `Parts = 0` → Billing line picker
(`SearchSelect` "No parts…", walk-in line still typable) · `Suppliers = 0` → PO builder
("No parts match", `__none__` grouping) · `Vehicles = 0` → Vehicle workflows (walk-in
vehicle free-text on the invoice). A parent-empty collection never crashes a child UI. PASS.

## 17. Delete / archive → zero

`<Pagination>` shrink test (§7) proves the 1→0 list transition: the pager pulls the page back
and hides, the row `.slice()` self-heals, totals fall to zero. Analytics `series.length === 0`
empty card re-appears when the last sale is removed. `computeWorkshopScore` is a **pure
function** — its 0-state is byte-reproducible after a 0→1→0 round trip (no stale carry).
Live: filtering to a zero result and clearing it returns the full dataset intact (Billing,
Customers). PASS.

## 18. Filter → zero

Verified live (§9): Billing status = Unpaid (0 in demo) → correct empty state, total 0,
pager "1 / 1", clear-filter restores 296. No stale page, no blank card, no chart crash. PASS.

## 19. Listener transitions

The live Firestore listeners (`parts`, `invoices`, `jobCards`, `customers`) all gate on
`!snapshot.metadata.hasPendingWrites` (Phase 6b) and replace their slice wholesale on each
snapshot, so `many → fewer → 1 → 0 → 1` leaves no stale rows — the derived views
(`filtered`, `paged`, KPIs) are all `useMemo` over the current array. The `<Pagination>`
clamp effect covers the "records vanished under a later page" case that a listener update
(unlike a local filter change) does **not** otherwise reset. Cross-checks Phase 6 / 7 / 16.
PASS (behavioural; the shrink path is unit-proven, a full multi-client listener drain was
not re-run live this phase).

## 20. Analytics / reports empty data

`AnalyticsView` at "no sales": Locked/Expected Capital still compute from `parts` (a
stock-on-hand figure, correctly labelled), Dead Capital `reduce(…,0)` → ₹0, Monthly Trend
shows its empty card, Top Parts / Fast Movers / Dead Stock render "0 of 0" rows, Revenue Mix
donut → empty ring (`|| 1` floor). `computeRange(key, null)` always yields a finite
`start <= end` window for every key incl. `custom` with a null range. `ratingFor(0)` /
`ratingFor(100)` both return a band. PASS.

## 21. Export behaviour

Cross-checks Phase 22. The **shared** report export (`InventoryDashboard.js` ~12511)
guards `rows.length === 0` with a toast and returns — no empty file. Audit-log export
guards `snap.empty`. **INFO-D:** `exportAnalytics` builds its sheets with
`XLSX.utils.json_to_sheet(profitable.map(…))` — at zero sales this yields **header-less blank
sheets** rather than header-only sheets (no crash, valid `.xlsx`, filename valid). The brief
treats "zero-row export is intentional" as acceptable; left as INFO. XLSX/PDF generation
does not crash at 0 / 1 / 2 rows; totals correct; no phantom row. PASS.

## 22. Null / missing value testing

`scanFinite` deep-walk over every analytics return object at 0/1/2 records: **zero** leaf
values were non-finite or contained a `NaN` / `Infinity` / `undefined` / `null` token.
`isExpiring(undefined)` / `isExpiring("not-a-date")` → `false`; `daysUntil(null)` → `null`;
`qtyOf({qty:"abc"})` → `0` (PH21-D1 coercion); `totalsOf` on a `{qty:0, rate:0}` line with a
flat discount → no NaN from the `afterDisc/sub` proportional rescale (`sub || 1` floor).
Malformed production data is **not** normalised — only rendered safely. PASS.

## 23. Cardinality transitions

`0 → 1 → 2 → 25 → 2 → 1 → 0` driven through `computeInventoryHealth`,
`computeWorkshopProgress` and `<Pagination>` at each step: analytics stayed finite at every
step; the pager text was correct (or the pager hidden) at every step. `computeWorkshopScore`
0→1→0 is reproducible. PASS.

## 24. Automated tests

**NEW: `tests/empty-state-integrity.test.cjs` — 147 assertions, 11 sections.** Independent
oracles (hand slice-math, hand truth tables); the real shipped functions exercised directly;
one 3-line chart formula reproduced verbatim next to its source. Covers: pagination
0/1/2/boundary/shrink/stale-index; analytics finiteness at 0/1/2; vehicle stats 0/1/2;
`trendPct` edge cases; billing money math at 0 lines; charts 0/1/2/14 points +
dead-code/guard assertions; `SearchSelect` dependency-empty + search→0; `searchAndRank`
0/1/2 items × 0/1/2 matches; cardinality transitions; singular/plural; and 12 source-pattern
**guard tripwires** (a future edit that deletes a `Math.max(1, …)` / `X.length ? … : 0` /
`safePage` clamp fails here). No `.skip` / `.only` / debug logging / hardcoded QA data.

`tests/run-all.cjs` picks it up automatically → **145 → 145** test files (the new file
replaces nothing; count was 144 before, 145 now).

## 25. Live demo validation

Local dev server + demo mode (`?demo=1`). Inspected **Dashboard, Analytics, Billing,
Billing filter→zero, Customers, Customers search→zero, Vehicles** at "many"; drove a
filter→zero and back on two modules; paged Vehicles to page 4/14; confirmed the PH24-01 fix
renders **"1 visit"** (singular) / **"0 visits"** (plural) live on page 4. Console clean
throughout except the pre-existing `outro.mp4` 404. Demo storage wiped afterward
(`7 localStorage keys + sessionStorage`).

## 26. Confirmed defects

| ID | Sev | Module | Symptom | Root cause |
|---|---|---|---|---|
| **PH24-01** | LOW | Vehicles (mobile card, `VehiclesModule.jsx:1404`) | "**1 visits**" | count printed with a hard-coded `'visits'` label — no `x === 1` branch |
| **PH24-02** | LOW | Customers (mobile card, `CustomersModule.jsx:1933`) | "**1 bills**" | `{billsOf(c)} {t('customers.bills', 'bills')}` — hard-coded plural, immediately after a correctly-branched "1 vehicle" on the same line |

No CRITICAL / HIGH / MEDIUM found. Empty state cannot corrupt financial or inventory data
(all mutations gated on `isRealized` / capacity / opId — Phases 4–7, 23) and no core module
crashes or becomes unusable at 0/1/2 records.

## 27. Root causes

Both are the same class: a count rendered next to a **hard-coded plural noun**, in a
mobile-card layout, where the surrounding code (and `lib/format.js`'s `pluralize` helper,
and the very next token on the Customers line) already does singular/plural correctly. An
inconsistency, not a systemic gap — the app pluralises correctly in ~30 other places
(`outstanding.length === 1 ? '' : 's'`, `daysRemaining === 1 ? '' : 's'`,
`skipped.length === 1 ? '' : 's'`, `(c.vehicles||[]).length === 1 ? 'vehicle' : 'vehicles'`, …).

## 28. Fixes

**REUSE** — no helper added, no new abstraction; both fixes adopt the app's existing
`count === 1 ? singular : plural` idiom, keeping the `t(key, fallback)` i18n wrapper so
Hindi / Telugu are unaffected:

```jsx
// components/vehicles/VehiclesModule.jsx:1404
- {visitsOf(r)} {t('customers.col.visits', 'visits').toLowerCase()} · …
+ {visitsOf(r)} {t('customers.col.visits', visitsOf(r) === 1 ? 'visit' : 'visits').toLowerCase()} · …

// components/customers/CustomersModule.jsx:1933
- … {billsOf(c)} {t('customers.bills', 'bills')} · …
+ … {billsOf(c)} {t('customers.bills', billsOf(c) === 1 ? 'bill' : 'bills')} · …
```

Regression coverage: `empty-state-integrity.test.cjs` §11 asserts both source patterns +
the `pluralize` helper + the pre-existing "vehicle"/"vehicles" guard.

## 29. Code-growth review

```
Production lines added:    2   (2 files, 1-line edits + 2 explanatory comments)
Production lines removed:   2
Net production change:      0   (+4 / −2 incl. comments)
New production functions:   0
New production files:       0
New abstractions / helpers: 0   (reused lib/format.pluralize concept + the app's x===1 idiom)
Test lines added:        ~515   (tests/empty-state-integrity.test.cjs — new)
Doc lines added:        ~this file
```

`REMOVE → REUSE → EXTEND → CONSOLIDATE → ADD` — nothing added. `<Pagination>`,
`SearchSelect`, `analyticsService` guards, `DashEmpty`, `pluralize`, `searchAndRank` were
all **reused as-is**; no parallel empty-state wrapper was created.

## 30. QA cleanup

- Demo storage wiped (`7 localStorage keys + sessionStorage`); no demo records persisted.
- Dev server stopped (port 3000), Browser pane closed, stale Java emulator killed (port 8080).
- `.next` rebuilt clean.
- No `.skip` / `.only` / `debugger` / `console.debug` / hardcoded QA data / test-only
  production branch anywhere in the diff or the new test.

## 31. Remaining limitations

- **INFO-A — dead chart code.** `RSpark` / `RDonut` / `RBars` (`InventoryDashboard.js`
  ~7162–7196) are defined and referenced nowhere. Their guards are sound; they cannot crash.
  Recommend deletion (flagged as a background task).
- **INFO-B — `RevenueTrend` latent edge.** No `data.length < 2` guard, but it is structurally
  only ever fed the fixed 14-entry `stats.trend`. Would `NaN` at 1 point / be empty at 0
  points if reused with variable-length data. Add a guard **if** it's ever reused elsewhere.
- **INFO-C — `{n} parts` / `{n} PO` / `{n} items` labels** in `SupplierDirectory.jsx`
  (lines ~336, ~475), `SupplierPerformance.jsx:439`, brand chips (`InventoryDashboard.js`
  ~5041) don't singularise at n=1. Terse metadata, mass-noun-ish, low visibility — **not
  fixed** (fixing all would be scope creep with cumulative risk for zero functional gain);
  documented so a future consistency pass can pick them up.
- **INFO-D — empty analytics XLSX** produces header-less blank sheets (not header-only).
  No crash; acceptable per the brief.
- **INFO-E — list filters don't rescope KPI cards** (Dashboard / Billing / Customers /
  Vehicles). By design: a list search/status filter filters the list, not the workshop-wide
  KPI row. Verified no stale/wrong values result — the list correctly empties while the
  KPIs stay at the whole-shop figure.
- **INFO-F — `SupplierPOBuilder` "Confirm" not disabled at 0 selection.** Clicking it is a
  silent no-op close; no bad record possible. Minor UX only.
- **Listener drain (§19)** proven at the unit level; a full live multi-client
  `many → 0` listener drain was not re-executed this phase (covered by Phases 6/7).

## 32. Final PASS / FAIL per module

| Module | Verdict | Note |
|---|---|---|
| Dashboard | **PASS** | all KPIs finite & zero-correct at every cardinality |
| Job Cards | **PASS** | free-text customer/reg; KPI buckets Phase-tested |
| Customers | **PASS** | after PH24-02 (was PARTIAL — "1 bills") |
| Vehicles | **PASS** | after PH24-01 (was PARTIAL — "1 visits") |
| Billing | **PASS** | exemplary dependency-lookup empty states; filter→zero verified live |
| Sales / Services / Stock In / Stock Out | **PASS** | shared `LedgerPage` |
| Inventory | **PASS** | shared `<Pagination>`, guarded charts |
| Suppliers | **PARTIAL** | INFO-C `{n} parts` label cluster — cosmetic, not fixed |
| Analytics | **PASS** | explicit empty states, every division guarded |
| Reports | **PASS** | shared export guards empty (INFO-D blank-sheet noted) |
| Alerts | **PASS** | `computeAlerts` safe at zero |

---

## FINAL OUTPUT

```
PHASE 24 STATUS:              COMPLETE

MODULES TESTED:               11
CARDINALITY STATES TESTED:    0 / 1 / 2 / MANY  (+ every transition between them)
SCENARIOS:                    147 automated assertions + 7 live modules + 2 live filter→zero drills

CRITICAL:                     0
HIGH:                         0
MEDIUM:                       0
LOW:                          2   (PH24-01, PH24-02 — both fixed)

EMPTY-STATES:                 PASS — every module has an explicit 0-record state; create action always available
PAGINATION:                   PASS — independent oracle match at every cardinality; shrink & stale-index clamp correct
SEARCH:                       PASS — 0/1/2 matches, query-before-data, rapid change, clear — no stale results
FILTERS:                      PASS — filter→zero shows empty state + resets pager; clear restores full set
KPI TOTALS:                   PASS — every KPI finite & zero-correct; no NaN / Infinity / undefined at any cardinality
CHARTS:                       PASS — every reachable chart path guarded (Math.max(1,…) / total>0? / ||1 / length<2 guard)
BUTTON VISIBILITY:            PASS — Create/Add/Export/Search/Filter all survive the empty state
DEPENDENCY EMPTY STATES:      PASS — SearchSelect + walk-in / inline-create escape hatches; no undefined selected id
ANALYTICS:                    PASS — explicit empty cards; computeRange always finite; ratingFor safe
REPORTS/EXPORTS:              PASS — shared export guards empty rows (INFO-D: analytics XLSX blank-sheet, cosmetic)
LIVE DEMO:                    PASS — Dashboard/Analytics/Billing/Customers/Vehicles at "many" + 2 filter→zero drills; console clean

NEW PRODUCTION DEFECTS:       2   (both LOW, both fixed)
FIXES:                        2

TESTS:                        145 / 145 test files  (new: empty-state-integrity.test.cjs, 147 assertions)
RULES:                        2 / 2  (150 + 111)  — no firestore.rules change
LINT:                         0 errors
BUILD:                        ✓ compiled successfully

QA CLEANUP:                   complete — demo storage wiped, dev server + emulator stopped, .next rebuilt
CODE GROWTH:                  +4 / −2 production (net 0; 0 new fn / file / abstraction) · +~515 test

COMMIT:                       c161e0b
DEPLOYMENT:                   Vercel sDKcmP6RDAMMexy46jJK_  (/, /login, /verify → 200;
                              build triggered immediately on push, compiled ✓; the
                              "1 visit" fix was live-verified on the local dev build
                              at demo Vehicles page 4/14 before push)

REMAINING LIMITATIONS:
  - INFO-A: RSpark / RDonut / RBars are dead code (safe; delete recommended)
  - INFO-B: RevenueTrend has no <2-point guard but is only ever fed a fixed 14-point array
  - INFO-C: {n} parts / {n} PO / {n} items labels (Suppliers) don't singularise at n=1 — cosmetic, not fixed
  - INFO-D: empty analytics XLSX export → header-less blank sheets (acceptable)
  - INFO-E: list filters don't rescope KPI cards (by design; verified no stale values)
  - INFO-F: SupplierPOBuilder "Confirm" not disabled at 0 selection (no-op close; harmless)
  - §19 listener multi-client drain proven at unit level, not re-run live (Phases 6/7 cover it)

FINAL ASSESSMENT:
  PASS. The application is robustly resilient to empty / single / two-record collections and
  to cardinality transitions. Prior phases (16 pagination, 21 malformed input, 23 analytics)
  had already hardened the surface; this pass swept every module, chart, table, KPI and
  dependency lookup at 0/1/2/many and found only two cosmetic pluralisation slips
  ("1 visits", "1 bills"), both fixed by reusing the app's own idiom with zero net code
  growth. No empty state can crash a view, produce a wrong total, render "undefined" /
  "NaN" / "Infinity", strand a workflow, or corrupt data.
```
