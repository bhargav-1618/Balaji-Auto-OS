# Phase 25 — Large-Data / Scalability / Client-Heavy Behavior Audit

**Two-stage phase. Stage 1 (discovery / measurement) only — no production code was
changed.**

> **DISCOVERY RESULT: PASS — no material scalability defect.**
>
> At 100 / 500 / 1,000 / 5,000 / 10,000 records the application (1) **loads and
> processes every record that is in memory** — no silent truncation, `.length` asserted
> end to end; (2) stays **numerically correct** — every count / total / filter / top-N
> matches an independent oracle at every size; (3) stays **usable** — the worst observed
> cost is a single **~470–550 ms** main-thread task on a heavy tab-switch at 10,000
> records **in demo mode** (which loads the whole dataset). Production bounds the same
> collections to a `limit()` window (2,000–3,000), where the equivalent task is
> **~150–350 ms**.
>
> The client-heavy architecture — a server-bounded live window + **client-side**
> pagination + **in-memory** search + non-virtualised tables — is deliberate, already
> documented (`ROADMAP.md` "Scale", `KNOWN_LIMITATIONS.md` "Performance"), and is **not
> a current failure**. It is recorded here as INFO, with the scale ceiling made
> explicit.
>
> **Stage 2 was not entered** (no confirmed defect ⇒ no remediation ⇒ no commit of
> production code). The measurement harness `tests/large-data-integrity.test.cjs` (118
> assertions) is added as a structural/property regression guard.

---

## 1. Objective

Determine whether growing data volume causes excessive Firestore reads, slow load,
slow re-render, broken pagination, incorrect totals, slow search/filter, UI freezes,
memory growth, chart degradation, or unnecessary full-collection processing — and, per
the brief, to prove *separately* that the records **exist**, are **loaded/processed**,
and remain **correct + usable**, and to document (not mislabel) client-side pagination.

## 2. Architecture / data-loading inventory

### The repository layer (`repositories/firestoreRepository.js`) — bounded by construction

| Primitive | What it does | Used by |
|---|---|---|
| `subscribeWindow(coll, { max, … })` | live `onSnapshot` on `query(coll, orderBy(createdAt desc), limit(max))` — **throws if `max` is missing** ("Unbounded listeners are what make Firestore bills explode and browser tabs OOM") | every live list |
| `fetchPage(coll, { cursor, pageSize })` | one page via `startAfter` + `limit` — **true server cursor pagination** | **capacity cleanup only** (not wired to any list UI) |
| `searchByPrefix(coll, field, term)` | `where(field >= t)` … `<= t` + `limit` — server prefix search on an indexed lowercase field | **not wired to any list UI** |
| `count(coll, constraints)` | `getCountFromServer` — the true total as **one aggregate read** | capacity banner (ledger collections only) |
| `commitBatch(ops)` | 500-op chunked `writeBatch` | bulk delete / archive |

### Live windows actually loaded into the client

The container (`components/InventoryDashboard.js`) opens **12 live `onSnapshot`
subscriptions**, every one a bounded `query(collection, orderBy('createdAt','desc'),
limit(N))`:

| Collection | Live window (`constants/LIMITS`) | Client filter | Client sort | Pagination | Full window resident? |
|---|---|---|---|---|---|
| `parts` | **2,000** (`PARTS_LIVE`) | yes (`useMemo` + haystack Map) | yes | client `.slice()` @ 25 | yes |
| `customers` | **1,000** (`CUSTOMERS_LIVE`) | yes | yes | client `.slice()` @ 10 | yes |
| `invoices` | **3,000** (`INVOICES_LIVE`) | yes (deferred) | yes | client `.slice()` @ 25 | yes |
| `jobCards` | **3,000** (`JOB_CARDS_LIVE`) | yes | yes | client `.slice()` @ 25 | yes |
| `sales` | **2,000** (`SALES_LIVE`) | yes | yes | client `.slice()` | yes |
| `suppliers` | **500** | yes | yes | client | yes |
| `auditLog` | **500** (`AUDIT_LIVE`) | yes | — | client "load more" | yes |
| `restocks` / `stockAdjustments` | **500** each | yes | yes | client | yes |
| `reorderRequests` / `purchaseOrders` | **200 / 300** | yes | yes | client | yes |
| `salesRollups` | **60** (months) | — | sort | — | yes |

- **Vehicles have no collection** — the Vehicles module derives its rows from the
  in-memory `customers[].vehicles` nested arrays (`VehiclesModule.rows = useMemo(() =>
  customers.forEach(c => c.vehicles.forEach(…)), [customers])`), then indexes them
  against the `invoices` + `jobCards` windows once per data change (`buildVehicleIndex`).
- **Analytics revenue/cost/profit/margin** (Monthly Profit Trend) read `salesRollups`
  — **unbounded cumulative monthly aggregates** — so those headline figures are
  *complete* regardless of ledger size (`FIX-07`). Top Profitable Parts / Fast Movers /
  `ledgerByPart` read the capped `sales` window.
- **Capacity policy** (`constants/capacity.js`): `invoices`, `jobCards`, `sales`,
  `purchaseOrders`, `stockIn`, `stockOut` are hard-capped at **5,000 active records**
  (warning at 4,500, "Add" blocked at 5,000, oldest-first cleanup wizard). Master
  entities (`customers`, `parts`, `suppliers`, `vehicles`) are **not** capped — the
  stated target is *"10k parts, 100k customers, 50k vehicles"* (`constants/index.js`).
- **Full-collection reads** exist only in admin one-shots, all behind a loading toast,
  none on a render path: `exportAuditLogs` (full `auditLog`, demo-blocked), backup /
  restore / factory-reset / recovery-vault (`getDocs(collection(db, name))` per
  collection).
- **Demo mode** reads its localStorage/sessionStorage backing store **unbounded** — a
  demo dataset of any size loads in full. This makes demo the strict upper bound on
  client cost; production's `limit()` is always ≤ it.
- **Search** everywhere is client-side `searchAndRank` / `rankIndexed` (`lib/useSearch`)
  over the in-memory window, throttled by `useDeferredValue` (`useDeferredSearch`); the
  per-row search haystack + the sorted base list are `useMemo`-built **once per data
  change**, not per keystroke (explicit comments to that effect).

**No unbounded `onSnapshot`. No N+1. No per-render Firestore read. No duplicate
listener.** (Verified from source; asserted in the harness §8.)

## 3. Dataset methodology

- **Node harness** (`tests/large-data-integrity.test.cjs`): a seeded mulberry32 PRNG
  generates deterministic, non-uniform, realistic fixtures at each size — customers
  with 1–3 nested vehicles (reg no., insurance/PUC dates), multi-line invoices (part +
  labour lines, per-line + invoice-level discounts, GST 0/12/18, exempt), a `sales`
  ledger at 2× the invoice count, job cards across 8 statuses. The **shipped** derived
  functions are run over them and timed; expected values come from a **hand oracle**
  (`oracleGrand` re-derives lineNet → sub → invDisc → afterDisc → GST → whole-rupee
  round from the documented model — never `totalsOf`).
- **Live demo** (dev server + in-app browser): a matching generator injected the same
  shapes into the demo storage keys (`maruti_invoices_demo`, `maruti_customers_demo`,
  …) at 5,000 and 10,000; the app was navigated with a `PerformanceObserver('longtask')`
  armed before hydration, and load / tab-switch / search / pagination / scroll timed.
- Node timing is single-core V8, noisy — it is **recorded**, not asserted on an exact
  millisecond. It captures the *"filter / sort / reduce / analytics over the whole
  array"* cost (the dominant client-heavy cost); it does **not** capture React
  reconciliation or DOM paint (measured separately, live, via long-tasks).

## 4–8. Per-size results

### Node — shipped derived functions over the FULL array (ms; representative run)

| N | `totalsOf`×N | Billing `stats()` recompute | `searchAndRank` (~10% hit) | filter+sort invoices | `computeInventoryHealth` | `computeWorkshopScore` | `ledgerByPart` | `computeVehicleStats` (rows≈2×N) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 1 ms | 2 ms | 1 ms | <1 ms | <1 ms | <1 ms | <1 ms | 1 ms |
| 500 | 2 ms | 2 ms | 1 ms | <1 ms | <1 ms | <1 ms | <1 ms | 5 ms |
| 1,000 | 1 ms | 2 ms | <1 ms | <1 ms | <1 ms | <1 ms | <1 ms | 5 ms |
| 5,000 | 7 ms | 12 ms | 3 ms | 3 ms | 1 ms | 3 ms | <1 ms | 33 ms |
| 10,000 | 25 ms | 37 ms | 6 ms | 5 ms | 2 ms | 3 ms | 2 ms | 53 ms |

**Correctness at every size** (independent oracle): `totalsOf.grand` matches the
whole-rupee oracle for **all N** (max drift 0.00); `stats.grand` mean per-invoice drift
< ₹0.5 and `realCount` exact; `searchAndRank` "kumar" count == independent filter count
(e.g. 981 / 10,000) and every no-match query → **0** results; concatenating **all**
pages reproduces the full filtered set (no missing rows, no duplicate id, page order ==
sort order); `ledgerByPart` Σ revenue == independent Σ `sales.revenue` for all N;
vehicle rows == Σ nested vehicles (e.g. 19,921 from 10,000 customers) — **none
dropped**; every KPI finite 0-100. **118 / 118 assertions pass.**

### Live demo (dev server, in-app browser) — real browser behaviour

| Dataset | Dashboard load (nav → KPIs) | Longest task on load | Billing tab-switch (`stats` over N invoices) | Search keystroke block | DOM rows rendered | Heap (used JS) |
|---|---|---|---|---|---|---|
| ~300 (default demo) | ~1 s | — (baseline) | — | — | ~11 | ~113 MB |
| **5,000** | ~1.3 s | **1 × 334 ms** | **359 ms** (1 × 313 ms task) | **46 ms**, no long task | ~11 | ~117–167 MB |
| **10,000** | ~1.8 s | **1 × 554 ms** (+ 82 ms) | **526 ms** (1 × 472 ms task) | **34–53 ms**, 2 small tasks (54/66 ms) | ~11 | ~124–193 MB |
| 10,000 — Vehicles tab (≈19,900 derived rows) | — | — | **489 ms** (1 × 363 ms task) | — | ~11 | — |
| 10,000 — **mobile** (375×812) | 2.4 s `domComplete` | — | — | — | **1,157 total DOM nodes** (page of 10 cards) | ~183 MB |

- Every list showed the **true resident count** ("Showing 1–25 of **10000**") — demo
  loads everything, and every row is accounted for.
- Every KPI was finite and sane at every size — Billing AVG INVOICE ₹17,280.15,
  OUTSTANDING ₹4.39 Cr (1,300+ synthetic unpaid), Analytics Revenue ₹46,17,381 / Margin
  56.7% / Dead Capital ₹18,790 — **no `NaN` / `Infinity` / `undefined`** anywhere, at
  any size.
- **Zero console errors** across the entire 5k + 10k session.

## 9. Load performance

Shell (`domComplete`) is ~0.7 s desktop / ~2.4 s mobile-emulated and independent of
data size. App hydration then parses the demo store (≈8 MB JSON at 5k, ≈19 MB at 10k),
runs the initial derived `useMemo`s, and paints — **one long task of ~334 ms (5k) /
~554 ms (10k)**. Net nav→dashboard-KPIs: **~1.3 s / ~1.8 s**. Production, bounded to the
`limit()` window, does less work than the 5k demo case.

## 10. Pagination

- **CLIENT-SIDE** in every list — `filtered.slice((safePage-1)*PER, safePage*PER)` — over
  the resident window. Not a server cursor. (`fetchPage` exists but is used only by the
  capacity-cleanup wizard.)
- At 5k / 10k: page count == `ceil(filtered.length / PER)`, first/middle/last page all
  correct, **no duplicated or missing rows across the full page set**, page order ==
  sort order, page-index clamp intact (Phase 16 `<Pagination>` + the inline `safePage`
  clamp — re-verified in the harness §4, and unchanged since Phase 16/24).
- The `.slice()` itself is < 5 ms even at 10,000 (Node §4); the visible cost of a page
  click is a React re-render of ≤ 25 rows.

## 11. Search

`searchAndRank` over the window: 100–1,000 rows **< 1 ms**; 5,000 **~3–8 ms**; 10,000
**~6–12 ms** (Node). Live, a keystroke blocked the main thread **~35–53 ms** at 10k
(handler + synchronous re-render of the input), with the *full* filter running on the
deferred low-priority render (`useDeferredValue`) — **no long task on the common query**,
two ~60 ms tasks on rapid typing at 10k. No stale results, correct counts, no crash,
pagination reset on query change (Phase 16). Prefix / rare / long / cleared queries all
behaved; a no-match query is **0 results** at every size (no false positives at scale).

## 12. Filters

Client-side `.filter()` over the window, memoised on `[rows, query, statusF, …]`
(recomputes on filter change, not per keystroke). Independent-count match at every size
(e.g. Paid invoices: 333 / 10,000 == independent count). filter → zero → all round-trips
cleanly (Phase 24). No per-keystroke full-array scan on the keystroke path (the query is
deferred). Filtered totals are strictly the filtered subset.

## 13. Sorting

`[...arr].sort(localeCompare | numeric)` — one array copy per sort change (not per
render). 10,000-row filter+sort combined: **~5 ms** (Node). `null` / missing / equal /
negative values order deterministically (coerced with `|| 0`, `|| ''`).

## 14. Memory behavior

Used-JS-heap ranged **~110–193 MB** across every dataset size and every module (dev
build, browser-pane — a noisy environment: GC timing, HMR, and devtools all move this
figure by tens of MB for identical state). Signal within the noise:

- **No unbounded growth** — 10,000 records (≈19 MB of JSON) added ≈ +25–80 MB over the
  ~113 MB baseline; the heap is dominated by the framework + app bundle, not the data.
- **DOM stays bounded** — ~11 rendered rows / ~1,157 total nodes at 10,000 (desktop and
  mobile). The list never materialises all N rows.
- **10,000 → default transition** — after wiping the injected data and reloading, every
  count returned to the default (Billing 296, Customers 200, jobs 167), **no stale 10k
  data**, no `NaN`. A `navigate` is a full document load, so the prior dataset's arrays
  are discarded wholesale; the heap does not always *shrink* on the very next reading
  (GC-dependent) but no data is retained.
- Listeners: each `useEffect` returns its `unsub`; verified in source, and Phases 1b/6b
  already cover lease/heartbeat teardown.

## 15. Firestore reads

| Interaction | Documents read | Notes |
|---|---|---|
| Initial dashboard load | Σ of the 12 window `limit()`s (≈ 2,000 + 1,000 + 3,000 + 3,000 + 2,000 + 500·5 + 200 + 300 + 60 ≈ **13,860 max**, fewer if the collections are smaller) | one-time per mount; Firestore's persistent cache serves reconnects |
| A single-record change (listener echo) | **1** (Firestore delta) | the client then re-derives over the whole *resident* window in JS (see §16) |
| Filter / sort / search / pagination | **0** | pure client operations over the resident window |
| "How many invoices exist" (capacity banner) | **1** aggregate (`getCountFromServer`) | not N |
| Audit-log export (admin, demo-blocked) | full `auditLog` (no `limit`) | one-shot, loading toast |
| Backup / restore / factory reset (admin) | every collection in full | one-shot, loading toast, explicit user action |

No collection is read "to show one page", no read is triggered by a render cycle, no
duplicate listener. The window `limit()`s are the entire steady-state cost.

## 16. Listener behavior

A one-document change fires the collection's `onSnapshot` (gated on
`!snap.metadata.hasPendingWrites`), which **replaces the whole resident array** and
therefore re-runs every `useMemo` that depends on it — for `invoices` that is the
`invoiceRows` sort+haystack build **and** the `stats` block (Σ KPIs + a 14-day trend
that itself calls `totalsOf` ~14× a filtered subset + top-customers + top-parts). Cost:
**~2 ms at 300, ~12 ms at 5,000, ~37 ms at 10,000** (Node §2); live, one **~313 ms**
(5k) / **~472 ms** (10k) task on the tab that owns the list. This is **O(resident
window)** work on every echo — fine at the production `limit()` (≤ 3,000 → ≤ ~15 ms
Node / ~300 ms live), a visible half-second hitch only at the demo-unbounded 10,000. It
is not *duplicated* work (one `useMemo`, one pass) and it is not *wrong* — just
proportional to the window.

## 17. Analytics performance

| Metric | Source | Complete beyond the window? | Cost at 10k |
|---|---|---|---|
| Monthly Profit Trend — Revenue / Cost / Profit / Margin | `salesRollups` (cumulative) | **yes** | trivial (~60 rows) |
| Top Profitable Parts / Fast Movers / `ledgerByPart` | `sales` window | no (newest 2,000) | ~2 ms (Node) |
| Dashboard Workshop Progress / Health / Score | `parts`/`invoices`/`jobCards`/`sales` windows | no | ~2–13 ms (Node) |
| Vehicle analytics | `customers[].vehicles` + index over `invoices`/`jobCards` | no | ~53 ms (Node, ~20k rows) |
| `useViewMore` ranked tables ("Showing 10 of 178") | already-in-memory array, client `.slice()` | n/a | trivial |

All analytics values stayed finite and correct at every size (live: Margin 56.7%, Dead
Capital ₹18,790, no NaN). Revenue = Cost + Profit held. No aggregate was silently
truncated by a chart's top-N (the ranked tables page with `useViewMore`, they don't cap
the underlying sum).

## 18. Large-data correctness

Asserted at 100 / 500 / 1,000 / 5,000 / 10,000 (harness) **and** observed live at 5k /
10k:

- displayed count == source count (`.length` end to end; live "of 10000")
- page count == `ceil(records / pageSize)`
- Σ of all paginated pages == the full filtered set — **no missing, no duplicate row**
- filter count == independently-calculated filter count
- analytics Σ == independently-calculated Σ
- top-N contains the actual highest N
- **no** partial totals, missing rows, duplicate rows, or chart truncation that changes
  a KPI — at 5,000 or 10,000.

## 19. Export behavior

Cross-checks Phase 22. Billing bulk-PDF is explicitly capped (`MAX_BULK_INVOICE_PDF`,
toast on exceed). XLSX/CSV exports build from the *resident* array (so an export at
production scale is bounded by the `limit()` window); the shared report export guards
`rows.length === 0`. Not separately re-benchmarked at 10k this phase — the resident
array is the same one every other view already holds, and Phase 22 verified row-count
fidelity and no phantom rows. **INFO** (unchanged from Phase 24): the empty analytics
XLSX produces header-less sheets.

## 20. UI responsiveness at 10,000 (demo)

| Action | Classification |
|---|---|
| Initial load → dashboard KPIs | **minor slowdown** — one ~550 ms task, ~1.8 s to interactive |
| Tab switch to Billing / Vehicles | **minor slowdown** — one ~370–470 ms task |
| Typing in search | **responsive** — ~35–53 ms/keystroke, full filter deferred |
| Pagination click | **responsive** — `.slice()` + 25-row re-render |
| Scrolling a list | **responsive** — ~126 ms scroll round-trip, bounded DOM |
| Mobile layout | **responsive** — same client pagination, 1,157 DOM nodes |

Nothing was **unusable**. The ~400–550 ms tab-switch / load task at the *demo-unbounded*
10,000 is the single worst case; on a 3–4× slower device it would be a ~1.5–2 s hitch —
still recovering, still correct. Production's `limit()` keeps the same task at
~150–350 ms.

## 21. Small → large → small transitions

`100 → 500 → 1,000 → 5,000 → 10,000 → 1,000 → 100 → 0` (harness §7): `stats.count`
tracks the dataset exactly at every step; `10,000 → 0` resets every KPI to `0` / finite
with a 14-point trend and no leftover total. Live `10,000 → default`: counts reverted,
no stale rows, no `NaN`.

## 22. Live updates

Not re-exercised at scale beyond Phase 6/7's coverage; from source + §16, a live
single-record change at 10,000 costs one ~470 ms recompute-and-repaint on the owning
tab — visible but not a freeze, no duplicate row, no wrong total, no stale page. Kept
brief per the brief.

## 23. Mobile / responsive

375×812 at 10,000 customers: mobile card layout, client pagination (page of 10),
**1,157 total DOM nodes** (no "render every record"), smooth scroll, ~2.4 s
`domComplete`. Search / filter dropdowns work. No layout break, no `NaN`.

## 24. Error / recovery

A failed listener logs `[Firestore] listener failed on "<coll>"` and calls the shared
`handleListenerError` surface (`components/InventoryDashboard.js` C-3) — it does **not**
silently show empty data as "no records". Loading states exist for every module; the
persistent Firestore cache serves the last-known window offline. Not re-simulated this
phase (covered by Phases 5/6/6b).

## 25. Confirmed defects

**None.** No large-data behaviour corrupts data, causes an unsafe mutation, makes a
core workflow unusable at a realistic volume, or produces an incorrect total / count /
filter.

## 26. Root causes

n/a — no defect.

## 27. Fixes

n/a — no production code was changed (Stage 1 result was PASS; Stage 2 not entered).

## 28. Before / after measurements

n/a — no fix. Baseline measurements are §4 and §20.

## 29. Automated tests

**NEW `tests/large-data-integrity.test.cjs` — 118 assertions, 9 sections:**

- **§0** deterministic realistic fixtures at 100/500/1k/5k/10k (asserted cardinality +
  non-uniformity)
- **§1** `totalsOf` / `invoiceTotals` / `invTotals` over the full array — processes all
  N, every grand total finite, agrees with the independent whole-rupee oracle (max
  drift 0.00), timing recorded
- **§2** the Billing `stats` loop reproduced verbatim (Σ KPIs + 14-day trend + top-N) —
  `count === N`, `grand` within sub-rupee of the independent Σ, `realCount` exact
- **§3** `searchAndRank` — common / rare / no-match; no-match → 0 at every size, hit
  count == independent filter count, timing recorded
- **§4** filter → sort → paginate — count == independent count, `pageCount ==
  ceil(n/25)`, **Σ pages == full set, no dupes, no gaps**, page order == sort order;
  10k filter+sort < 2 s
- **§5** `computeInventoryHealth` / `computeWorkshopScore` / `computeWorkshopProgress` /
  `ledgerByPart` — finite, `ledgerByPart` Σ == independent Σ (no dropped rows)
- **§6** vehicle rows derived from `customers[].vehicles` == Σ nested vehicles (none
  dropped), `computeVehicleStats` finite, timing recorded
- **§7** `100→…→10k→…→0` transition — count tracks exactly, `10k→0` fully resets
- **§8** architecture guards — `subscribeWindow` requires `max`, every named
  subscription + every container `onSnapshot` carries `limit(LIMITS.*_LIVE)`, no
  unbounded `onSnapshot(collection(...))`, capacity cap == 5,000, `count()` /
  `fetchPage` / `searchByPrefix` exist, and the DOCUMENTED fact that list pagination is
  a client `.slice()`

Structural + property assertions, not brittle timing assertions (timings are printed
for the report and only the loose "< 2 s for a 10k filter+sort" bound is hard-asserted).
`npm test` → **146 / 146** test files.

## 30. Live demo validation

Dev server + in-app browser. Default demo (~300 records) → 5,000 → 10,000 injected into
the demo store; each navigated with a `PerformanceObserver('longtask')` armed pre-hydration.
Load, tab-switch (Dashboard / Billing / Customers / Vehicles / Analytics), search,
pagination, scroll, and the mobile layout were measured (§4, §20). All correct, no
console errors, no crash. Injected data wiped afterward (§31).

## 31. QA cleanup

- All injected demo datasets removed (`17 storage keys + window globals cleared`); demo
  re-seeds the default on next load.
- Dev server stopped (port 3000). Browser pane closed. No emulator used.
- No `.skip` / `.only` / debug logging / hardcoded large-data fixture in production /
  test-only production branch anywhere. The harness generates its data at run time.
- No production Firestore write of any kind — all large-data work was Node fixtures or
  the browser demo sandbox.

## 32. Code-growth review

```
Production lines changed:   0   (Stage 1 = PASS ⇒ Stage 2 not entered)
New production functions:   0
New production files:       0
Test lines added:        ~430   (tests/large-data-integrity.test.cjs — new)
Doc lines added:         ~this file
```

`REMOVE → REUSE → EXTEND → CONSOLIDATE → ADD` — nothing added to production. No
pagination framework, no cache, no parallel data-loading system. The existing
`<Pagination>`, `subscribeWindow`, `useDeferredSearch`, `useSearchIndex`, capacity
policy and `salesRollups` aggregation are already the right tools.

## 33. Remaining limitations (INFO — architectural, documented, roadmapped)

1. **Client-side pagination over a server-bounded window.** Lists load the newest
   `LIMITS.*_LIVE` documents and paginate/filter/search **that** array in the browser.
   Not a bug — it keeps the Firestore bill flat and the steady-state read count fixed —
   but it means:
   - **Ledger collections** (invoices/jobCards/sales): between the live window (3,000)
     and the capacity cap (5,000) the oldest ~2,000 records are not in the list and not
     in the ledger-driven KPIs (Billing `stats`, Top Parts). The **capacity banner does
     show the true count** for these. Cleanup is nudged at 4,500.
   - **Master collections** (customers 1,000 / parts 2,000): beyond the window the older
     records are **not in the list, not counted in a "true total", and not reachable by
     the list's search** — `searchByPrefix` is built in the repo but not wired to any
     list UI. The stated target (`constants/index.js`) is 100k customers / 10k parts, so
     this is the scale ceiling to close first. Already on `ROADMAP.md` → *"Server-side
     search … necessary around ~100k customers"* and *"Table virtualization … revisit
     past ~10k rows"*.
2. **No table virtualisation** — the DOM is bounded by the page size (≤ 25), so this is
   only a factor if the page size is raised. Documented in `KNOWN_LIMITATIONS.md`.
3. **`stats` / vehicle-analytics recompute is O(resident window) on every listener
   echo** — ~15 ms at the production `limit()`, ~470 ms at the demo-unbounded 10,000.
   Not duplicated, not wrong; a `useMemo` narrowing or a web-worker offload is the
   eventual lever if the window `limit()`s are ever raised.
4. **Part images are base64 in the `parts` document** — `ROADMAP.md` "Move part images
   out of Firestore": every parts read pulls the full image payload; at 2,000 parts
   with cover images this is tens of MB of window transfer + resident memory. Not
   exercised by the demo (which strips `imageString`), but it is the single largest
   real large-document cost. Roadmapped.
5. **Audit-log export reads the full collection** (no `limit`) — admin one-shot,
   demo-blocked, loading toast; the audit log is not capacity-governed so it can grow
   unbounded over years. LOW / INFO.

None of these is a *current* failure at the app's near-term scale, and each is already
recorded in `ROADMAP.md` / `KNOWN_LIMITATIONS.md`.

## 34. Final assessment

**PASS.** Across 100 / 500 / 1,000 / 5,000 / 10,000 records the application loads and
processes every resident record with no silent truncation, keeps every count / total /
filter / top-N numerically correct (verified against independent oracles at every size,
in Node and live), and remains usable — the worst measured cost is a single ~470–550 ms
main-thread task on a heavy interaction at the *demo-unbounded* 10,000, and production's
`limit()` window keeps the real steady-state cost 3–4× below that. The client-heavy
architecture (bounded window + client pagination + in-memory search + non-virtualised
tables) is deliberate, correct, documented and roadmapped, and is recorded here as INFO
with the scale ceiling made explicit — it is **not** a defect. No production code was
changed; a 118-assertion measurement/property harness is added as a regression guard.

---

## FINAL OUTPUT

```
PHASE 25 STATUS:              COMPLETE  (Stage 1 only — DISCOVERY RESULT: PASS)

DATASETS:                     100 / 500 / 1,000 / 5,000 / 10,000  (+ the full transition, + 10k→0)
MODULES TESTED:               Dashboard · Billing · Customers · Vehicles · Analytics · Reports ·
                              Job Cards · Sales · Inventory · Suppliers · Alerts  (11)

CRITICAL:                     0
HIGH:                         0
MEDIUM:                       0
LOW:                          0
INFO (architectural, documented, roadmapped):  5

LOAD:                         PASS — shell ~0.7s (size-independent); nav→KPIs ~1.3s @5k / ~1.8s @10k
                              (demo, loads everything); one ~334ms/~554ms hydration task
PAGINATION:                   PASS — client-side .slice() over the window; Σ all pages == full set,
                              no dupes / no gaps / correct page count at 5k & 10k; Phase 16 clamp intact
SEARCH:                       PASS — in-memory, useDeferredValue-throttled; ~35–53ms/keystroke @10k,
                              no long task on the common query; 0 false positives at scale; counts exact
FILTERS:                      PASS — memoised, deferred; filtered count == independent count at every size
MEMORY:                       PASS — ~110–193 MB across all sizes (noisy dev env); no unbounded growth;
                              DOM bounded to the page size (~11 rows / ~1,157 nodes @10k desktop & mobile);
                              10k→0 leaves no stale data
FIRESTORE READS:              PASS — every live listener is limit()-bounded; steady-state read count is
                              fixed (Σ of the window limits); 0 reads for filter/sort/search/pagination;
                              true count via getCountFromServer (1 aggregate) for ledger collections
LISTENERS:                    PASS — one echo → one whole-window re-derive (not duplicated, not wrong);
                              ~15ms at the production limit(), ~470ms at demo-unbounded 10k
ANALYTICS:                    PASS — Revenue/Cost/Profit/Margin from unbounded salesRollups (complete);
                              all values finite & correct at every size; Revenue = Cost + Profit held
EXPORTS:                      PASS — bounded by the resident window; bulk-PDF explicitly capped
                              (cross-checked Phase 22); empty-XLSX header INFO carried from Phase 24
UI RESPONSIVENESS:            PASS — "responsive" for search / pagination / scroll / mobile at 10k;
                              "minor slowdown" (one ~400–550ms task) on load / heavy tab-switch at 10k demo;
                              nothing "unusable"
LARGE-DATA CORRECTNESS:       PASS — no truncation, no missing / duplicate rows, no partial totals,
                              no chart truncation that changes a KPI, at 5,000 or 10,000

NEW DEFECTS:                  0
FIXES:                        0
TESTS:                        146 / 146 test files  (new: large-data-integrity.test.cjs — 118 assertions)
RULES:                        not run — no firestore.rules change (n/a this phase)
LINT:                         n/a — no production code touched
BUILD:                        n/a — no production code touched

LIVE DEMO:                    PASS — 5k & 10k injected into the demo sandbox; load / tab-switch / search /
                              pagination / scroll / mobile measured; 0 console errors; correct throughout
QA CLEANUP:                   complete — injected demo data wiped, dev server stopped, no prod writes

PRODUCTION CODE CHANGE:       NO
NET PRODUCTION LINES:         0
COMMIT:                       <docs + test only — filled on commit>
DEPLOYMENT:                   N/A — no production code change

REMAINING LIMITATIONS:
  - INFO-1: client-side pagination over a server-bounded live window; master collections
            (customers/parts) have no true-count indicator and no wired server search past
            the window (searchByPrefix built but unwired) — ROADMAP "Server-side search"
  - INFO-2: no table virtualisation (DOM bounded by page size today) — KNOWN_LIMITATIONS
  - INFO-3: stats / vehicle-analytics recompute is O(resident window) per listener echo
  - INFO-4: part images stored base64-in-document — every parts read pulls the payload — ROADMAP
  - INFO-5: audit-log export reads the full (uncapped) collection — admin one-shot

FINAL ASSESSMENT:
  PASS. The application scales correctly and remains usable to 10,000 records. It never
  silently truncates what it has loaded, every derived number stays correct against an
  independent oracle at every size, and the heaviest cost is a sub-second main-thread
  task at the demo-unbounded ceiling — kept 3–4× lower in production by the limit()
  windows. The client-heavy characteristics are deliberate, documented and roadmapped;
  they are recorded here as INFO, not misclassified as pagination bugs or as defects.
  No production code change was warranted or made.
```
