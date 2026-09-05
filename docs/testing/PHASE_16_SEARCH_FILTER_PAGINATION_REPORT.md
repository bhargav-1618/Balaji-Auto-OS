# Phase 16 — Search / Filter / Sort / Pagination Consistency

## 1. Search/filter architecture

One shared search engine, `lib/useSearch.js`:

- `useSearchIndex(items, idFn, textFn, idsFn, deps)` — builds a `Map` of
  stable-id → `{ hay, ids }` per record, **memoized on `[items, ...deps]`**,
  so the haystack is rebuilt exactly once per data change, never per
  keystroke.
- `searchAndRank(items, indexMap, idFn, query, tieBreak)` — the single
  filter+rank+sort entry point. Maps over `items` **once** (`idFn` keys the
  index lookup), keeps only score > 0, sorts by score then `tieBreak`.
  Empty query returns the list through `tieBreak` (never an empty result).
- `rankIndexed` — field-aware tiered matching: exact-id (8) → id-prefix (7)
  → id-suffix (6) → id-contains (5) → text-exact (4) → text-prefix (3) →
  text-contains/token (2) → **0 = discarded, never shown at a lower tier**.
- `useDeferredSearch` — renders the keystroke at urgent priority, derives
  the filtered list at low priority (React 18 `useDeferredValue`).

Every module's search is *only* a `useSearchIndex` field configuration
plus a `searchAndRank` (or `matchIndexed` + a local sort) call. No module
carries a second copy of the matching logic.

**Result-set model (every list):**

```
listener-fed source array (customers / invoices / inventory / ...)
        │  (a live create / edit / delete / concurrent write mutates THIS)
        ▼
useMemo: status/category/date filter  ──►  full filtered set
        ▼
useMemo / inline: searchAndRank (relevance) or the module's own sort
        ▼
.slice((page-1)*per, page*per)  ──►  rendered rows  (keyed by doc id)
```

Because every derivation is a pure `useMemo` fed by the single
listener-updated array, **search/filter results self-heal on any data
change** — a record that no longer matches drops out of the filtered set on
the next render; one that starts matching enters it exactly once (it is one
entry in the source array). Rows are keyed by stable document ids
(`c.id`, `iv.id`, `po.id`, `s.id`, `` `${ownerId}-${vehId}` ``), never by
array index. The **only** derived-state that does not automatically track a
shrinking dataset is the **pagination page index** — the subject of this
phase's one finding.

## 2. Modules audited

| Module | List(s) | Page-state model | Clamp on live shrink? |
|---|---|---|---|
| Customers | 1 (table + mobile cards, one `page`) | synchronous `safePage = min(page, pageCount)` | ✅ (row-ordinal column fixed this phase — see §12) |
| Billing (Invoices) | 1 | synchronous `safePage` | ✅ |
| Vehicles | 1 | synchronous `safePage` | ✅ |
| Inventory → Parts | 1 (`InventoryDashboard.js`) | `useEffect: if (invPage > invTotalPages) setInvPage(...)` | ✅ |
| Inventory → Purchase Orders | 1 | shared `<Pagination>`, raw `page` slice | ⚠️→✅ (this phase) |
| Inventory → Archive | 1 | shared `<Pagination>`, raw `page` slice | ⚠️→✅ (this phase) |
| Inventory → Reports (table) | 1 | shared `<Pagination>`, raw `page` slice | ⚠️→✅ (this phase) |
| Inventory → Stock (movement timeline) | 1 | shared `<Pagination>` (rendered only when `>1` page) | ⚠️→✅ (this phase; live shrink was already unreachable — append-only ledger) |
| Inventory → Reports (report generator table) | 1 | `useEffect setPage(1)` with **`rows.length` in deps** | ✅ (already reset on live shrink) |
| Suppliers → directory list | 1 | custom pager, raw `page` | ⚠️→✅ (this phase) |
| Suppliers → per-supplier parts sub-list | 1 | custom pager, raw `page` | ⚠️→✅ (this phase) |
| Supplier Performance | 1 | synchronous `safePage` | ✅ |
| Alerts | 1 | custom pager, raw `page` | ⚠️→✅ (this phase) |
| Ledger pages (Sales / Services / Stock In / Stock Out) | 1 (`LedgerPage.jsx`) | custom pager, raw `page`, `page === pages` guards | ⚠️ documented, **not fixed** — append-only data + a `setPage(1)` effect covering every real shrink vector (date range, type, sort, per-page, custom dates) make the live-shrink case unreachable (§16, §24) |
| Job Cards | list is "show first N + Show More", **no page state** | n/a | n/a |

## 3. Result-set model

See §1. Verified independently in `tests/search-filter-pagination-integrity.test.cjs`:
`rendered rows ⊆ filtered set`, every rendered row appears exactly once,
`searchAndRank` over N matching records returns N distinct ids.

## 4. Filter → sort → pagination results (16C)

**SAFE.** Verified against a hand-built oracle: filtering runs against the
**full** source array (`customers.filter(...)` / `inventory.filter(...)`),
sorting applies to the filtered result, `.slice()` slices the sorted
filtered result, `total` = filtered length, page count = `ceil(total/per)`.
The "filter applied only to the visible page" bug does not exist anywhere —
every module filters the source array, not the page.

## 5. Pagination boundary results (16D)

**SAFE.** Oracle-verified for n = 0, 1, per−1, per, per+1, 2×per, exact
multiple, one beyond: page count is always `max(1, ceil(n/per))`, the last
valid page is never empty unless the list itself is empty, `from/to`
render `0` and `0` for an empty list.

## 6. Filter → edit results (16G) / Search → edit (16J)

**SAFE.** An edit updates the source array via the listener → the filter
memo and `useSearchIndex` memo (dep `[items]`) both recompute → the record
re-enters / leaves / re-ranks in the filtered set on the next render.
Verified with the real `searchAndRank`: renaming a record's searched field
out of a query drops it from that query's results; a code field edited from
`OF-100` → `XX-999` makes `searchAndRank(..., 'OF-100')` return `[]`. No
stale cached row survives (the row list is `paged.map((c) => ...)`
recomputed every render, keyed by id).

## 7. Filter → delete results (16H)

**SAFE for the row set; the one defect was the page index.** A delete/
archive removes the record from the source array → filtered set shrinks →
count and `pageCount` recompute. Row identity is by doc id, so no
"duplicate replacement row" and no stale row. **Before this phase**, four
modules left the page *index* stale when the shrink dropped it below the
current page (see §16).

## 8. Filter → create results (16I)

**SAFE.** A create appends to the source array → if it matches the active
filter it appears in the filtered set exactly once (one array entry), in
its sorted position; if it does not match it does not appear. Count and
`pageCount` grow. No stale empty-state (the empty-state branch is
`filtered.length === 0`, re-evaluated every render).

## 9. Search → concurrent update results (16O / 16P)

**SAFE** — this is the phase's mandatory scenario and it is architecturally
sound. Client B's edit reaches Client A through the same Firestore listener
that feeds the source array (Phases 1–3 already made those listeners
correct). `useSearchIndex`'s memo depends on `[items]`, so A's index
rebuilds, and `searchAndRank` re-runs:

- B renames `ABC Motors` → `XYZ Motors` while A searches `"ABC"` → the
  record leaves A's results, exactly one `ABC` record remains.
- B renames it back into the `ABC` set → A receives it again, **exactly
  once**, no duplicate row (verified: `res.filter(id === 'c1').length === 1`).
- A record changing sort position while staying in the filter → moves to
  its correct sorted slot on re-render (the sort is re-applied every
  render, not cached per row).

## 10. Combined filter results (16L)

**SAFE.** Where a module has multiple filters (Billing: status + payment
mode + date + search; Suppliers: status + search + sort; POs: status +
search) they compose with **AND** semantics via a single `.filter()`
predicate that returns `false` on the first failing clause. Clearing one
filter (`setStatusF('All')`) removes only its clause — no hidden residual
state (verified in the pre-existing `tests/billing-filter-perf.test.cjs`
and re-checked here). `Filter A → A+B → clear B → clear A` returns the full
set.

## 11. Count consistency (16N)

**SAFE.** Every "showing X–Y of Z" label and every "N / M" page counter is
derived from the **same** `filtered.length` the `.slice()` reads. There is
no separate count query. The clamped modules use `safePage` /
`filtered.length` for both the label and the slice; the shared
`<Pagination>` now uses a clamped `safe` for its label and counter too (it
previously showed `page` / `pageCount` which could read e.g. "41–25 of 25"
and "3 / 2" on a stale page — see §16).

## 12. Identity / duplicate-row analysis (16R)

**SAFE.** No paginated list keys rows by array index. Keys checked:
Customers `key={c.id}` (both views), Billing `key={iv.id}`, Vehicles
`` key={`${r.ownerId}-${r.id}`} `` (vehicles are nested, so owner+vehicle
id is the stable identity), POs `key={po.id}`, Suppliers `key={s.id}`,
Archive `key={p.id}`. `searchAndRank` output verified to contain N distinct
ids for N matches — no duplicate identity comes out of the engine.
One cosmetic issue fixed this phase: CustomersModule's row-**ordinal**
column (the plain "#" counter, not a key) used the raw `page`, so on a
stale page it could print `41, 42, …` beside the rows that `safePage`
correctly sliced as page 2 (`21, 22, …`). Changed to `safePage`.

## 13. Empty-state analysis (16S)

**SAFE.** Every module's empty branch is `filtered.length === 0` (or
`archived.length === 0`, `shown.length === 0`), re-evaluated every render —
no phantom rows, no stale "no results" after data arrives. "One result on
page 2" is impossible: `safePage` / the clamp effect pull the page back to
1. Deleting the last row of a filtered set drops to the empty state on the
next render.

## 14. Archive / restore analysis (16Q)

**SAFE.** Archive and delete are **not** treated as identical: `archived`
is a flag on the record (it stays in the source array, moves between the
"active" and "archived" filtered sets); delete removes it from the array
entirely. Verified: archiving a record moves it from the active set to the
archived set (each still exactly once); restoring moves it back. Counts and
`pageCount` recompute for both sets; the page index now clamps on the
resulting shrink (this phase).

## 15. Refresh / navigation analysis (16T)

**INTENTIONAL, consistent per module.** Customers / Vehicles / Suppliers
persist their view state (`q`, filters, `page`, `perPage`, selection) to a
**module-scoped in-memory cache object** (`customersViewState` /
`vehiclesViewState` / etc.) that survives a tab switch but not a full page
reload — so returning to the module from another tab lands you where you
left off, while a browser refresh starts clean. Billing / POs / Archive /
Alerts reset on mount. This is a deliberate, documented pattern (the cache
object and its `useEffect` write-back are explicit in each module) — not
URL-persisted, not `sessionStorage`. No change made — the phase's rule is
"consistency with the intended state model", and each module is internally
consistent.

## 16. Confirmed defects

### PH16-01 — pagination page index not clamped on a live dataset shrink (MEDIUM)

When a paginated list shrank **without a filter/search change** — a
delete, an archive, a restore, a status change that moves a record out of
the current filter tab, or a concurrent client's write — the current page
*index* was left stale in several modules. Their row `.slice()` used the
raw `page`, so it sliced past the end of the (now shorter) list and
rendered **an empty page**, while:

- the shared `<Pagination>` showed `"3 / 2"` (page > page count) and a
  nonsensical `"41–25 of 25"` range, with **Prev enabled** (recoverable in
  one click) — for Inventory → Purchase Orders / Archive / Reports;
- the custom pagers (Suppliers directory list, Suppliers parts sub-list,
  Alerts) **hid entirely** once the shrink reached ≤ 1 page
  (`{listPageCount > 1 && <pager>}`), leaving an empty list with **no
  visible control** to get back to the remaining records until the user
  changed a filter — the more severe instance.

Authoritative data was never wrong, deleted, duplicated, or acted upon
incorrectly — every record was correct and present in the source array;
only the paginated *view* of it was stale. Hence **MEDIUM** ("counts,
pagination, stale results become incorrect but authoritative data remains
safe").

Reachability: the Purchase Orders case is reachable in an ordinary
single-user workflow (open the "Pending" tab, page 2, approve/send several
POs → they leave the "pending" set). Archive/Suppliers are reachable when
restoring/deleting records while paginated. The three well-built modules
(Customers, Billing, Vehicles) and the main Parts list already handled it.

## 17. Root causes

The app grew **two** correct patterns for this and applied neither
everywhere:

1. **Synchronous clamp** — `const safePage = Math.min(page, pageCount)`
   used directly in the slice, count, and pager (Customers / Billing /
   Vehicles / Supplier Performance).
2. **Effect clamp** — `useEffect(() => { if (page > pageCount) setPage(pageCount) })`
   (main Parts list) or a `setPage(1)` effect with a `rows.length` dep
   (report-generator table).

The shared `<Pagination>` component had **neither** — it only guarded the
Prev/Next buttons against `page <= 1` / `page >= pageCount`, which does
nothing once `page` is already past the end. Its four callers, plus the
three custom pagers, inherited that gap. Each module's own `setPage(1)`
effect covered *filter changes* but not a *live shrink* with the filter
untouched.

## 18. Fixes

**Consolidated into the one shared component**, plus three one-line effect
clamps reusing pattern (2):

1. `components/inventory/Pagination.jsx` — added
   `useEffect(() => { if (page > pageCount) onPage(pageCount); }, [page, pageCount, onPage])`
   (`onPage` is a state setter at every call site → converges in one pass,
   no thrash) and switched the component's own display/button-guards to a
   clamped `safe = Math.min(Math.max(1, page), pageCount)`. When the effect
   fires `onPage`, the caller re-renders with the corrected `page` and its
   own raw `.slice()` self-heals. Fixes **Purchase Orders, Archive,
   Reports table, Stock timeline** in one place.
2. `components/inventory/SupplierDirectory.jsx` — two
   `if (listPage > listPageCount) setListPage(listPageCount)` /
   `if (partsPage > partsPageCount) setPartsPage(partsPageCount)` effects
   (custom pagers, matching pattern 2).
3. `components/InventoryDashboard.js` (AlertsView) — one
   `if (page > pages) setPage(pages)` effect.
4. `components/customers/CustomersModule.jsx` — the row-ordinal column
   `page` → `safePage` (already-computed variable; cosmetic consistency).

`components/common/LedgerPage.jsx` — **not changed**. Its data is
append-only and its `setPage(1)` effect already fires on every real shrink
vector (`[dq, range, type, sort, perPage, customStart, customEnd]`), so the
live-shrink-without-filter-change case is unreachable. Its `page === pages`
boundary guards are latently fragile but never exercised. Documented, not
fixed (§24) — fixing it would be a speculative change.

## 19. Automated tests

`tests/search-filter-pagination-integrity.test.cjs` (new, 48 assertions):

- An **independent pagination oracle** (hand-derived slice math, never
  calling production pagination code) checked against the app's actual
  `safePage` formula across every boundary (0, 1, per−1, per, per+1,
  2×per, exact multiple, one beyond) and the two headline shrink scenarios
  (page 4 → 1 page; page 3 → 2 pages).
- **The real `<Pagination>` component rendered** via `@testing-library/react`:
  `page=5, total=3` fires `onPage(1)`; `page=5` of a 3-page set fires
  `onPage(3)`; a valid page fires nothing (no thrash); the counter shows
  the clamped value, never `"9 / 3"`.
- **The real search engine** (`searchAndRank` / `rankIndexed` /
  `matchIndexed` — imported, not reimplemented): the mandatory 16P
  ABC→XYZ→ABC concurrent-rename scenario (leaves once, re-enters exactly
  once), exact-identifier edit-out, 40-record no-duplicate-identity,
  empty-result.
- Filter → sort → paginate against the oracle; sort-flip no-dupe/no-skip;
  count/range agreement; archive/restore set transitions.
- Per-module source proofs that every paginated list now has a clamp
  (synchronous `safePage`, effect, or the shared component's effect).

Expected results are never produced by calling the production
filter/sort/pagination functions under test.

## 20. Regression tests

- `npm test`: **138/138** test files passed (137 previous + 1 new). No
  existing test regressed — the pre-existing `tests/billing-filter-perf.test.cjs`
  ("pagination clamps synchronously (safePage)" / "stale page=3 clamps so 4
  rows still show") and `tests/vehicle-workflows.test.cjs` stay green.
- `npm run test:rules`: **138/138** — no rules touched.
- `npx eslint .`: **0 errors**, 38 warnings (baseline, unchanged — the new
  effects carry correct dep arrays).
- `npm run build`: succeeded.

## 21. Production validation

Verified by source tracing, the independent-oracle / real-component tests
above, and a read-only production smoke test (§ deployment record below).
No production business record was created, edited, deleted, archived, or
restored to test filtering — the live project holds only QA data (Phase 15
baseline §12) and the pagination-shrink behaviour is fully covered by the
component-render and oracle tests.

## 22. QA cleanup

None — no QA data created this phase.

## 23. Code-growth review

```
production lines added:    30   (4 files)
production lines removed:   7
net production change:     +23

  components/inventory/Pagination.jsx        +17 / −6  (≈10 of +17 are comment)
  components/inventory/SupplierDirectory.jsx  +8 / −0  (6 of +8 comment)
  components/InventoryDashboard.js            +4 / −0  (3 of +4 comment)
  components/customers/CustomersModule.jsx    +1 / −1  (page → safePage; net 0)
```

- **Significant new logic:** none beyond four one-line clamp effects, all
  of the identical shape `if (page > pageCount) setPage(pageCount)` that
  the main Parts list already used.
- **Existing mechanisms reused:** the shared `<Pagination>` component (the
  fix is one effect + a `safe` clamp *inside it* — no new component, no new
  hook, no new abstraction); the effect-clamp pattern already present in
  `InventoryDashboard.js`; `safePage` (already computed) in Customers.
- **Unnecessary code removed:** none found — the paginated modules had no
  duplicate filter/sort/pagination *logic* to consolidate (they already
  share `lib/useSearch.js` and, mostly, `<Pagination>`); only the missing
  clamp needed adding.

Test/documentation growth (not production):
`tests/search-filter-pagination-integrity.test.cjs` (new, ~320 lines) and
this report.

## 24. Remaining limitations

- `components/common/LedgerPage.jsx`'s pager uses `page === pages` /
  `page === 1` boundary guards (fragile if `page` ever exceeds `pages`) and
  a raw-`page` slice. Left unchanged: its data (Sales / Services / Stock In
  / Stock Out ledgers) is append-only, and its `setPage(1)` effect fires on
  every date-range / type / sort / per-page / custom-date change — the only
  ways its filtered set can shrink. The live-shrink-without-filter-change
  case is unreachable, so a fix would be speculative.
- View-state persistence differs by module (in-memory cache for
  Customers/Vehicles/Suppliers, reset-on-mount for Billing/POs/Archive/
  Alerts) — deliberate and internally consistent per module (§15), not
  unified.
- The clamp is a post-render effect for the shared-`<Pagination>` and
  custom-pager modules (one extra render, a possible sub-frame empty flash
  before the correction), vs. the synchronous `safePage` in
  Customers/Billing/Vehicles (no flash). Both are correct; unifying on the
  synchronous form everywhere was judged disproportionate to a MEDIUM
  cosmetic-window issue.

## 25. Final PASS/FAIL assessment

**PASS.** No CRITICAL or HIGH defect. Search, filter, sort, and combined-
filter behaviour are architecturally sound — every result set is a pure
derivation of the single listener-fed source array, self-healing on any
live data change, with stable-id row keys and no duplicate/missing-row
bugs. One MEDIUM defect (PH16-01: stale pagination page index on a live
dataset shrink) affected four modules through a gap in the shared
`<Pagination>` component and three custom pagers; fixed by consolidating
the clamp into that shared component plus three one-line effects, reusing
the pattern the app's best-built modules already used. All gates green.
