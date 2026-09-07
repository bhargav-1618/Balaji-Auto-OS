# Phase 28 — Double-Navigation / Stale-Route / Rapid-Selection Integrity

**Two-stage phase.** Hunts the race:

> correct action → rapid navigation / selection change → an *older* async
> operation resolves later → its result overwrites current state → the UI shows
> the wrong record / module / data.

> ## STAGE 1 — DISCOVERY RESULT: **DEFECT FOUND** (3)
>
> **PH28-01 (MEDIUM)** — `hooks/useEditLease.js` `acquire()` is async (a Firestore
> transaction round-trip). Between calling it and its resolution the user can close
> the editor, pick a different record, or Back out of the module. A resolved-too-late
> acquire still installed `heldRef` + a **renewing heartbeat** → a record left
> edit-locked with nobody editing it (another user then sees a false "🔒 …is
> editing…"). It also let two consumers open the **wrong record** on out-of-order
> resolution: `CustomersModule.openCustomerEditor` and `JobCardModule.loadCard` both
> commit the record-to-show *after* `await …acquire()`.
>
> **PH28-02 (LOW)** — the Part / Supplier / Checkout / Restock / Stock-Adjust modals
> render **outside** the `activeTab === …` conditionals. A browser Back while one was
> open fired the hashchange handler and **silently swapped the module behind the
> modal**, leaving the address bar pointing at a tab the user couldn't see; closing
> the modal then dropped them on the wrong module.
>
> **PH28-03 (MEDIUM)** — the hashchange handler (`onPop`, Back/Forward) called
> `setActiveTabRaw` directly, **bypassing the unsaved-changes confirm** that a
> sidebar click (`setActiveTab`) enforces. Backing out of a dirty Settings page or
> entity editor discarded the edits with **no prompt** (a sidebar click prompts).
>
> ## STAGE 2 — FIXED (all three)
>
> - `useEditLease`: a `wantRef` records the docId the consumer currently wants; a late
>   acquire whose target no longer matches **hands the lease straight back** and
>   returns `{ superseded: true }`. `openCustomerEditor` / `loadCard` bail on
>   `superseded`. *(+19 / −0 in the hook, +4 / +4 in the two consumers.)*
> - `onPop`: a shared `snapBack()` + guard order — demo-blocked (existing) → same-tab
>   no-op → **blocking modal open → inert** → **settings-dirty / module-dirty confirm**
>   (the identical strings `setActiveTab` uses) → navigate. *(InventoryDashboard +32 / −4.)*
>
> **Net production code: +59 / −4 (net +55), 4 files, no new component, no new dependency.**
> Every guard reuses an existing pattern (`releaseLease`, the demo-blocked
> `replaceState`-revert, `setActiveTab`'s two `window.confirm`s).
>
> `npm test` **149/149** (+1 file) · `npm run test:rules` **2/2** · lint **0** ·
> build **✓** · no `firestore.rules` change · **0 production writes**.
>
> **FINAL ASSESSMENT: PASS** (after the fixes).

---

## 1. Objective

For every realistic rapid navigation / selection sequence, verify the final visible
state, selected record, module and URL are the ones the user's **last explicit
action** asked for — never a stale value an earlier async operation wrote after the
fact — and that no listener, timer or lock leaks across the churn.

## 2. Routing architecture

Single Next.js page. `pages/index.js` → `<InventoryDashboard />` is the whole app;
`/login` and `/verify` are the only other routes.

| Concern | Mechanism |
|---|---|
| "Module" navigation | client state `activeTab` (`useState('overview')`) ↔ `window.location.hash`. Every module is a conditional render `{activeTab === 'x' && <XView/>}` — it **unmounts** on tab switch. |
| Setting the tab (sidebar / cmdk) | `setActiveTab(tab)` — guards (demo-blocked, settings-dirty, module-dirty) → `setActiveTabRaw` → `history.pushState('#tab')`. |
| Back / Forward | a single `hashchange` listener (`onPop`), registered once (`[]` deps), reads `activeTabRef.current` / `demoBlockedTabRef.current` (refs, to dodge the stale closure) → `setActiveTabRaw`. |
| Deep links | `?open=<tab>:<query>` / `?open=nav:<json>` consumed once on mount; stash-and-consume via `localStorage` for the target module. |
| Next.js router | present (`useRouter()` for the `/login` redirect + idle logout) but **not** used for module nav. |

Trace: `URL hash` → `onPop` / mount effect → `activeTab` → `{activeTab === x && <Module/>}`
→ module's `selId` → `selected = useMemo(() => list.find(r => r.id === selId))` → render.

## 3. State architecture — why most of the target races cannot occur

| Layer | Shape | Race exposure |
|---|---|---|
| List data (parts/customers/invoices/…) | long-lived `onSnapshot` subscriptions **at the InventoryDashboard level**, `limit()`-bounded (Phase 25). Do **not** re-subscribe on module switch. | none from navigation |
| Selected record | `const selected = useMemo(() => list.find(r => r.id === selId) ‖ null, [list, selId])` — a **pure synchronous derivation**. Selecting = `setSelId(id)`. **No per-selection fetch.** | **none** — rapid A→B→C→D ends at `selId = D`; `selected` = D. Verified live. |
| Search / filter | `useDeferredValue` (`lib/useSearch.js` `useDeferredSearch`) — React 18 abandons the stale low-priority render when the next keystroke arrives. Not a debounce, no timer, no async. | **none** — a stale "query A" result is structurally impossible. |
| Per-record live listeners | `useRecordSync` / `observeLease` — `useEffect` keyed on `[collection, docId]`; cleanup unsubscribes the old doc before subscribing the new. | none — verified by source; effect deps correct. |
| Edit lease | `useEditLease.acquire()` — **async**. | **PH28-01** (see §9). |
| Editor "which record" | Vehicles / Parts / Suppliers / Invoices set `setEdit(x)` **synchronously**, reconcile the lease in a guarded effect. Customers / Job Cards set it **after** `await acquire`. | **PH28-01** for those two (see §7). |

## 4. Module-switch tests (live, demo mode)

| Sequence | Result |
|---|---|
| Customers → Vehicles → Customers @30ms | ends `#customers` / "Customers" ✅ |
| Billing → Inventory → Sales → Billing @25ms | ends `#billing` / "Billing" ✅ |
| Suppliers → Suppliers → Suppliers | `#suppliers` ✅ (no double-init) |
| 8 modules hammered @15ms | ends `#analytics` / "Analytics" ✅ |
| 10 modules hammered @18ms (post-fix) | ends `#customers` / "Customers" ✅ |

Every run: hash and heading agree, **0 console errors, 0 React warnings, 0 unhandled
rejections**, no stale module content flashed.

## 5. Back / Forward tests (live)

Built `#overview → #customers → #vehicles → #billing`, then:

| Action | Ends at |
|---|---|
| back | #vehicles ✅ |
| back | #customers ✅ |
| forward | #vehicles ✅ |
| forward | #billing ✅ |
| back, back, forward (rapid, 50ms) | #vehicles ✅ |
| back, back, forward (post-fix) | #reports ✅ (consistent) |

Final module always matches the URL. **PASS.**

*Note — rapid programmatic `history.back()` spam surfaced a Next.js-internal
`Cancel rendering route` unhandled rejection (its router aborting a superseded
popstate render). Navigation results were always correct; the rejection is framework
noise, dev-overlay-only, and clears on any hard load. Recorded as INFO (§30), not
fixed — a blanket rejection swallow risks masking real errors.*

## 6. Rapid record selection (live) — **HIGH PRIORITY**

Customers list, desktop split view. Selected rows `1 → 2 → 3 → 6` back-to-back (0ms,
React-batched) and `1 → 4 → 2 → 6` at 40ms spacing.

**Both** → detail panel shows **customer 6 (Rohit Gupta)**, the last click. Survived a
reload (view-state cache persisted the last `selId`). No intermediate record "won".

Root cause it's safe: `selected` is `useMemo(find(selId))` — there is no async request
per selection to lose a race to. **PASS.**

## 7. Record + Edit (live + source)

Select customer A, then customer B, then Edit → detail panel showed B (last
selection). The Edit target:

- **Vehicles / Parts / Suppliers / Invoices** — `setEdit(record)` runs synchronously
  on the click; the lease is acquired afterward in an effect with a `cancelled` guard.
  Rapid A→B→Edit → editor = B. **Safe, unchanged.**
- **Customers `openCustomerEditor` / Job Cards `loadCard`** — the record is committed
  **after** `await …acquire()`. On out-of-order resolution (B's acquire lands before
  A's) the editor opened **A**. This is **PH28-01**. Fixed: both now `return` on
  `r.superseded`.

## 8. Record + Modal (live)

The Part / Supplier / Checkout / Restock / Stock-Adjust modals are
`InventoryDashboard`-level state, **not** tied to `activeTab`. The module-level
wizards (Customer, Vehicle, Invoice, Job Card) live *inside* their module's render, so
they unmount when the module does.

- Contract established: **a modal is tied to the record it opened with**; changing the
  underlying selection does not re-target it (you can't — the overlay covers the list).
- **PH28-02**: browser Back while an inventory modal was open swapped the module
  *behind* it and moved the URL. Confirmed live (Add Part on `#inventory` → Back →
  URL `#overview`, Dashboard behind, Part form still floating). Fixed: `onPop` keeps
  Back inert (snaps the hash back) while `blockingModalRef` is set — verified live
  after the fix (Back → hash stays `#inventory`, form stays, no module swap).

## 9. Async race — the core stale-route defect (PH28-01)

`useEditLease.acquire(d)`:

```
BEFORE:  await acquireLease(d)  →  heldRef = d ; setInterval(renew d)   // unconditional
AFTER :  wantRef = d ; await acquireLease(d)
         if (wantRef !== d) { releaseLease(d); return { superseded:true } }   // ← the fix
         heldRef = d ; setInterval(renew d)
```

`release()` sets `wantRef = null`; a newer `acquire()` sets `wantRef` to its own
target. So any acquire that resolves after the consumer moved on gives the lease
straight back instead of pinning a phantom lock, and tells the caller (`superseded`)
to drop whatever it was about to open.

Deterministic model in `tests/navigation-race-integrity.test.cjs` §1 proves:

| Scenario | Before | After |
|---|---|---|
| open A, close before acquire resolves | heartbeat renews A forever; A locked | superseded; no heartbeat; A **free** |
| open A, open B, **A resolves last** | heldRef = A (wrong); A locked | held = B; A superseded + **free**; one heartbeat (B) |
| open A, uninterrupted | held = A | held = A (**unchanged**) |

## 10. Listener cleanup

- **Module listeners**: modules unmount on tab switch (conditional render). Measured —
  5 full cycles through 6 modules (30 mount/unmount pairs) → **0 leaked intervals**,
  window-listener counts net to zero per type.
- **Per-record listeners** (`observeRecord`, `observeLease`): `useEffect` keyed on
  `[collection, docId]`; cleanup runs before re-subscribe. Source-verified.
- **Debounce / RAF timers** (`SearchSelect` ×2, part-highlight, scroll-restore): every
  one has `return () => clearTimeout(t)` / RAF-cancel.
- Production `onSnapshot` subscriptions are InventoryDashboard-level and deliberately
  long-lived (Phase 25) — they are not per-module, so module churn cannot leak them.

## 11. Stale closures

The one `[]`-registered listener (`onPop`) reads `activeTabRef` / `settingsDirtyRef` /
`moduleDirtyRef` / `demoBlockedTabRef` / `blockingModalRef` — **all refs**, kept
current by render/effect. No stale-closure defect found. Async callbacks that capture
`selectedId`-style values (`openCustomerEditor(c)`, `loadCard(jc)`) capture the *row's
own* record object, not a mutable "current selection" — the risk there was
out-of-order resolution (PH28-01), now guarded.

## 12. Search / debounce

`useDeferredValue`, not a debounce — see §3. Rapid "query A → B → C" always shows C's
results (React discards the abandoned renders). `useDebounced` (kept for network-cost
cases only, currently unused for lists) clears its timer on every change. **PASS.**

## 13. Pagination + navigation

- Filter change → `setPage(1)` guarded by a `didMountRef` so a remount (module
  re-entry) restores the cached page instead of forcing page 1.
- Out-of-range page after data shrinks → `useEffect(() => { if (page > pageCount)
  setPage(pageCount) })` in Inventory / Suppliers / Customers.
- View-state (`q / filters / page / selId / detailTab`) persists in a module-scoped
  object so module switch → return restores the list where you left it.

**PASS** — cross-checks Phase 16 / 24.

## 14. Filter + record selection

`selectedIds` is a `Set` of ids (identity, not row index) — survives filter / sort /
pagination. An effect drops ids for records that no longer exist so "N selected" and
bulk actions never reference an invisible stale row. `selected` (the detail panel)
derives from `selId` against current data → if a filter hides the selected record the
panel shows empty/"select a record", never stale data. **PASS.**

## 15. Route + data loading

No per-route data fetch — everything derives from the resident subscriptions. The one
"load against real data" path (deep-link `?open=inventory:<sku>`) **peeks** the pending
key until `inventory.length > 0`, then consumes once — a mid-load navigation can't
double-consume or false-"not found". **PASS.**

## 16. Back / Forward during async load

There is no async load to interrupt (§15). Back/Forward only re-derives `activeTab`
from the hash. **PASS.**

## 17. Fast repeated navigation / clicks

Hammered module tabs, same tab repeatedly, back/forward — deterministic final state,
no duplicate listener init (verified §10), no double modal open (each modal is a
single boolean/record state). **PASS.**

## 18. State preservation (contract)

| State | Survives module switch | Survives Back / Forward |
|---|---|---|
| filters / search / page / sort | ✅ (view-state cache) | ✅ |
| selected record (`selId`) | ✅ | ✅ |
| open editor / modal (module-level) | ✗ — module unmounts (intentional) | ✗ — same |
| open modal (inventory-level) | n/a (survives, tab-independent) | **inert** post-fix (was: module swapped behind it) |
| unsaved form edits | prompted on leave (both paths, post-fix) | **prompted** post-fix (was: silently discarded) |

## 19. Unsaved form navigation (PH28-03)

Before: open a customer/invoice/part editor, type a change, press **Back** → editor
gone, edits discarded, **no prompt**. A sidebar click to the same destination *does*
prompt ("You have unsaved changes. Leave without saving?"). The asymmetry: `onPop`
called `setActiveTabRaw` directly; only `setActiveTab` ran the `moduleDirtyRef` /
`settingsDirtyRef` guard.

After: `onPop` runs the **identical two `window.confirm`s**; "Stay" snaps the hash
back and keeps the editor open. Verified live: clean Back/Forward fires **0** confirms;
the model test proves dirty + "Stay" → tab unchanged + hash reverted.

## 20. Combined navigation attacks

`Customers → cust A → Vehicles → veh B → Billing → inv C → Back → Customers → cust D →
Edit` and similar realistic chains: every final screen matched the last selection;
hash consistent; no console error. **PASS.**

## 21. Console / runtime errors

Across every rapid sequence: **no** uncaught exceptions, React warnings, hydration
errors, or "state update on an unmounted component" warnings from app code. Only
non-app noise: Next.js `Cancel rendering route` on rapid programmatic Back (INFO,
§30), and the pre-existing dev-only ServiceWorker-registration failure.

## 22. Listener-count evidence

Demo mode has no real Firestore listeners; measured proxies instead — `setInterval`
live count and per-type `window` listener balance across 5×6 module cycles: **0 net
growth**. Production `onSnapshot` count is architecturally bounded (module-level subs
don't re-create on switch; per-record subs clean up on `docId` change). Real-Firestore
listener counting requires a signed-in production session and was **not measured**.

## 23. Automated tests

`tests/navigation-race-integrity.test.cjs` — **36 assertions**:

- a faithful pure model of `useEditLease` acquire/release ownership (close-before-
  resolve, out-of-order, uninterrupted) — before/after
- the shipped `wantRef` / `superseded` source patterns
- both consumers bail on `superseded` before committing the record
- `blockingModalRef` + the `onPop` guard order (PH28-02)
- `onPop` runs the same two dirty confirms as `setActiveTab` (PH28-03), plus a pure
  `onPopModel` (dirty + "stay" → unchanged + snapped back; not dirty → proceeds;
  modal open → inert)
- a generic "latest-wins" out-of-order-async model
- no-regression: selection is a pure derivation; search is `useDeferredValue`;
  `useDebounced` clears its timer; hashchange listener uses refs; modules unmount;
  pagination clamps

`tests/concurrency-lease.test.cjs` §"Job Cards" updated (the assertion pinned the
exact line adjacency the `superseded` guard now sits between — behaviour unchanged).

## 24. Live demo validation

All performed in demo mode (`localStorage` only). Rapid module switching, Back/Forward
(2-deep and rapid), rapid record selection, record→record→Edit, Part modal + Back.
Recorded final visible state for each (§4–8). **No changes saved. Draft key
`maruti_part_draft_v1_demo` written by a test was cleared afterward.**

## 25. Confirmed defects

| ID | Severity | Summary |
|---|---|---|
| PH28-01 | MEDIUM | `useEditLease.acquire` phantom-lock + out-of-order wrong-record open |
| PH28-02 | LOW | inventory modals survive Back with URL / module desync |
| PH28-03 | MEDIUM | Back/Forward bypasses the unsaved-changes guard |
| PH28-04 | INFO | no `Cancel rendering route` rejection suppression (not fixed) |

## 26. Root causes

- **PH28-01** — `acquire` had no notion of "is this still wanted?"; success
  unconditionally installed the heartbeat. Two consumers additionally gated the
  *displayed record* on the async result.
- **PH28-02 / PH28-03** — `onPop` (Back/Forward) was a thin `setActiveTabRaw(t)` that
  never grew the guards `setActiveTab` (sidebar click) accumulated over Phases 1c / 7b.
  Back/Forward is the *third* navigation path, covered by neither `beforeunload` (page
  unload) nor `setActiveTab` (in-app click).

## 27. Fixes

| File | Change | ± |
|---|---|---|
| `hooks/useEditLease.js` | `wantRef`; `acquire` returns `{superseded:true}` + hands the lease back when the target changed mid-flight; `release` clears `wantRef` | +19 / −0 |
| `components/customers/CustomersModule.jsx` | `openCustomerEditor`: `if (r.superseded) return;` before `setEditCust` | +4 / −0 |
| `components/jobcards/JobCardModule.jsx` | `loadCard`: `if (r.superseded) return;` before `setLeasedJobNo` / `applyCard` | +4 / −0 |
| `components/InventoryDashboard.js` | `blockingModalRef` + updater effect; `onPop` → shared `snapBack()`, same-tab no-op, blocking-modal-inert, settings/module-dirty confirms | +32 / −4 |
| `tests/navigation-race-integrity.test.cjs` | **new** — 36 assertions | +new |
| `tests/concurrency-lease.test.cjs` | loosen one line-adjacency regex | +6 / −1 |

## 28. Before / after evidence

- **PH28-01** — model (§9): before, A's lease renews forever after the editor closed;
  after, superseded → released, no heartbeat.
- **PH28-02** — live: before, Add Part on `#inventory` + Back → `#overview` behind the
  form; after, Back → hash stays `#inventory`, form stays, no swap.
- **PH28-03** — live: before, dirty customer wizard + Back → wizard gone, 0 confirms;
  after (model + source), dirty + Back → `window.confirm('You have unsaved
  changes…')`, "Stay" reverts the hash.

## 29. QA cleanup

Demo `localStorage` only; `maruti_part_draft_v1_demo` cleared. Dev server stopped,
`.next` cleaned, viewport reset. **0 production Firestore reads or writes.**

## 30. Code-growth review

+55 net production lines across 4 files. No new component, hook, module, or
dependency. Every mechanism reused: `releaseLease` (existing), the demo-blocked
`replaceState` revert (existing in the same function), `setActiveTab`'s two confirms
(copied verbatim), a ref-mirror-of-state pattern (`activeTabRef` etc. already do it).
PH28-04 deliberately **not** fixed (framework noise; a global rejection swallow is a
worse trade than the noise).

## 31. Remaining limitations

1. **PH28-04** — rapid programmatic/user Back-Forward can log a Next.js
   `Cancel rendering route` unhandled rejection (dev-overlay only; navigation always
   correct). Documented, not fixed.
2. **Real-Firestore listener counting** not measured (needs a signed-in production
   session — out of scope: production is read-only navigation only).
3. PH28-01's fix is verified by an execution-flow model + source; the phantom-lock
   itself is production-only (demo has no leases) and was proven by flow, not a live
   two-session repro.
4. Everything in `KNOWN_LIMITATIONS.md` from prior phases still stands.

## 32. Final assessment

**PASS (after fixes).** Three real defects found in Stage 1 — a phantom edit-lock +
out-of-order wrong-record open, a modal/URL desync on Back, and a Back/Forward
unsaved-changes bypass — all fixed in Stage 2 by extending existing guards, with a
36-assertion regression suite. Rapid module switching, Back/Forward, rapid selection,
search, listener cleanup and state preservation were all verified sound (live +
model) with no change needed.

---

## FINAL OUTPUT

```
PHASE 28 STATUS:            COMPLETE
DOUBLE NAVIGATION:          PASS
BACK/FORWARD:               PASS
RAPID RECORD SELECTION:     PASS
RECORD → EDIT:              PASS (after fix — PH28-01)
MODALS:                     PASS (after fix — PH28-02)
ASYNC RACE:                 PASS (after fix — PH28-01)
LISTENER CLEANUP:           PASS
STALE CLOSURES:             PASS
SEARCH/DEBOUNCE:            PASS
FILTER/SELECTION:           PASS
STATE PRESERVATION:         PASS
UNSAVED FORM NAVIGATION:    PASS (after fix — PH28-03)
RUNTIME/CONSOLE:            PASS (1 INFO: Next.js Cancel-rendering-route noise)
LISTENER COUNT:             PASS (demo proxy: 0 leak) / NOT MEASURED (real Firestore)

CRITICAL:                   0
HIGH:                       0
MEDIUM:                     2   (PH28-01, PH28-03)
LOW:                        1   (PH28-02)
INFO:                       1   (PH28-04)

NEW DEFECTS:                3   (PH28-01/02/03)
FIXES:                      3
AUTOMATED TESTS:            tests/navigation-race-integrity.test.cjs — 36/36
REGRESSION:                 npm test 149/149 · test:rules 2/2 · lint 0 · build ✓
LIVE DEMO:                  PASS (module switch, Back/Forward, rapid selection, modal+Back)
PRODUCTION MUTATIONS:       0
QA CLEANUP:                 done (draft key cleared, dev stopped, viewport reset)
PRODUCTION CODE CHANGE:     yes
NET PRODUCTION LINES:       +59 / −4  (net +55; 4 files, 0 new component/dependency)
COMMIT:                     <pending>
DEPLOYMENT:                 <pending>

REMAINING LIMITATIONS:
  - PH28-04 Next.js Cancel-rendering-route rejection noise on rapid Back/Forward
    (dev-overlay only; navigation always correct) — documented, not fixed
  - real-Firestore listener count not measured (needs prod session; out of scope)
  - PH28-01 phantom-lock proven by execution-flow model (prod-only; no 2-session repro)

FINAL ASSESSMENT:  PASS  (after fixes; evidence: 36 model/source assertions +
                          149/149 regression + live demo validation of PH28-02 and
                          the no-regression navigation sweep)
```
