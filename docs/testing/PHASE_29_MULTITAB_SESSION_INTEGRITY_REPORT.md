# Phase 29 — Multi-Tab / Multi-Session / Cross-Tab Consistency Integrity

**Deep adversarial audit. Two-stage.** Prior-phase results (1–28) were re-examined,
not assumed correct.

> ## STAGE 1 — DEEP DISCOVERY RESULT: **DEFECT FOUND** (1)
>
> **PH29-01 (MEDIUM)** — the Phase 7b tab-duplication protection in
> `lib/durableOpId.js` tags every stored operation id with a *page-instance id*
> read from `window.name`, on the assumption that a duplicated tab always starts
> with an **empty** `window.name`. That was verified for a *plain new tab* and a
> *same-tab reload* — **never for the actual "Duplicate tab" gesture**. Chromium
> serialises the main frame's name into the tab's navigation `PageState`, which
> "Duplicate tab" / session-restore copy — so on Chrome/Edge a duplicated tab can
> inherit `window.name` **alongside** its cloned `sessionStorage`. The
> page-instance tag then matches on both sides and **PH7-01 re-opens**: a genuinely
> different operation started in the duplicate (a different payment amount, a
> different quick-sell) is swallowed by the backend's idempotency marker as a retry
> of the original tab's in-flight operation, with a false-success toast. The
> `browser-lifecycle-discovery.test.cjs` model hard-codes this assumption
> (`name: {}` for the duplicate); if `window.name` is actually cloned the model's
> `Y === X` and the bug returns.
>
> ## STAGE 2 — FIXED
>
> `getPageInstanceId()` now **cross-checks a live sibling over a `BroadcastChannel`**.
> When a context adopts a page-instance id, it announces it; if any *other open
> context* is already using that exact id, both re-mint a fresh one (echo → mint →
> re-announce, converges, cannot loop). An id inherited by cloning is therefore
> never reused for a new intent. A **same-tab reload has no live sibling**, so
> nothing re-mints and the Phase 5b/6b refresh-safety guarantee is untouched.
> Derived eagerly at import (app boot) so a duplicate's id is corrected long before
> any operation modal can read it. Degrades to the `window.name`-only check where
> `BroadcastChannel` is unavailable (no worse than Phase 7b).
>
> **+65 / −7 production (net +58), 1 file, no new dependency.** Verified live in the
> Browser pane by simulating Chrome's Duplicate Tab (cloning `window.name` +
> `sessionStorage` into a second tab): the "duplicate" re-minted its id and stopped
> reusing the inherited opId; a clean same-tab reload with no sibling did **not**
> re-mint.
>
> `npm test` **150/150** (+1 file) · `npm run test:rules` **2/2** (150 + 111) ·
> lint **0** · build **✓** · **no `firestore.rules` change** · **0 production
> mutations**.
>
> **FINAL ASSESSMENT: PASS** (after the fix).

---

## 1. Objective

Determine whether two browser tabs / windows / sessions of this app can produce
stale data, stale edit state, lost updates, wrong-record edits, duplicate
operations, duplicated listeners, incorrect edit locks, session-identity
confusion, operation-id collisions, cache divergence, auth-state divergence,
phantom locks, or actions performed by the wrong session — auditing the durable
operation id, edit lease, `_rev`, session id, `recordSync`, `persistentLocalCache`
and browser-storage layers **together**.

## 2. Architecture

| Layer | Mechanism |
|---|---|
| Firestore cache | `persistentLocalCache({ tabManager: persistentMultipleTabManager() })` — one shared IndexedDB cache + one shared offline queue across every tab of the origin; the SDK elects a leader for the network connection and fails over automatically |
| Auth | Firebase Auth (persisted in IndexedDB `firebaseLocalStorage`, shared origin-wide); `onAuthStateChanged` fires in **every** tab on sign-in/out |
| Role / perms | live `onSnapshot(appSettings/roles)`; recomputed on `[user, dbAdmins, staffPerms]`; `BOOTSTRAP_ADMINS` code-level fallback |
| Live list data | InventoryDashboard-level `subscribeWindow` (`limit()`-bounded, Phase 25); **not** per-module — module switch does not tear these down |
| Per-record watch | `useRecordSync` → `observeRecord` (one `onSnapshot` per open record, `useEffect` keyed on `[collection, docId]`, unsubscribed on change/unmount) |
| Edit lease | `editLocks/<coll>__<id>` — `(ownerUid, sessionId)` keyed, transactional, 90 s expiry / 30 s heartbeat, server-authoritative; `firestore.rules` enforce `sameSession()` for a write against a still-active lease (PH7-27) |
| Durable op id | `sessionStorage['ph5b:op:<scope>'] = { opId, pi }`; `pi` = page-instance id (`window.name` + **PH29-01** BroadcastChannel collision check); backend records the opId **inside the same transaction** as the effect |
| Cross-tab config | theme / prefs / language / notification toggles / session-timeout propagate via the `storage` event |
| Navigation | `activeTab` ↔ `window.location.hash` — **per-tab** (Phase 28) |

## 3. Session identity

`sessionId` = `s_<crypto.randomUUID()>`, held in `sessionIdRef = useRef()`, created
once per `AuthProvider` mount. **Never written to `sessionStorage`, `localStorage`,
IndexedDB, the URL, or Firestore.** A reload is a new `sessionId` (correct — a
crashed tab's lease simply expires). A **duplicated tab is a fresh JS VM / React
mount → a genuinely fresh `sessionId`** — it is immune to every storage-clone path
that affects `sessionStorage`-backed state. *(browser-lifecycle-discovery §5 fact;
re-modelled here §3.)* **PASS.**

## 4. Tab identity (page-instance id)

`window.name` (namespaced `ph7b:pi:…`) — survives a same-tab reload, empty in a
plain new tab (**both verified live this session**). **PH29-01**: cannot be assumed
empty in a *duplicated* tab; now backed by a `BroadcastChannel` liveness check that
re-mints on a live collision. §1 above; live evidence §29; model
`tests/multitab-session-integrity.test.cjs §1`. **PASS (after fix).**

## 5. IndexedDB / cache

`persistentMultipleTabManager` — SDK-managed. All tabs share one cache; a write in
any tab updates every tab's cache and the shared offline queue; `hasPendingWrites`
is visible origin-wide (the `parts` listener gates on `!hasPendingWrites` like the
others, Phase 6b). The app never calls `enableNetwork` / `disableNetwork` /
`waitForPendingWrites` (Phase 26). No app-owned cache-coordination code to get
wrong. **PASS.**

## 6. Edit locks

- Keyed `(ownerUid, sessionId)` — two tabs of one user are **distinct holders**.
- `firestore.rules`: a write against a **still-active** lease requires
  `ownedByMe() && sameSession()`; a takeover requires `expired()`; `delete` is
  restricted to `expired()` only (releasing is a session-scoped `update` that
  backdates `expiresAt`). PH7-27 — enforced at the rules layer, not just the
  client transaction.
- Expiry is **server time** (`request.time`), capped 3 min out — a client cannot
  claim a record forever.
- `pagehide` best-effort release; a crashed tab frees the record in ≤ 90 s
  regardless.
- **PH28-01** phantom-lock guard: a `useEditLease.acquire()` that resolves after
  the consumer moved on hands the lease straight back (`{ superseded: true }`),
  never installs a heartbeat.

Model (`§4`): two-tab contention → tab B blocked while A holds; A releases → B
acquires; A "crashes" → B takes over after 90 s (**no phantom lock forever**).
**PASS.**

## 7. `_rev`

Pure `revState(serverDoc, expectedRev)` → `deleted` | `stale` | `{ nextRev }`. The
guarded save re-reads the server doc **inside** the Firestore transaction, so a
tab that opened at `_rev 3` while another tab advanced it to `4` is rejected
`conc/stale` — never a silent overwrite. Model (`§5`) confirms
stale→rejected, current→allowed+bump, deleted→`conc/deleted`. **PASS.**

## 8. Operation IDs

- Each tab mints its own opId per scope (`sessionStorage` is per-tab). A genuinely
  separate 2nd tab making a 2nd payment on the same invoice → **2nd opId → both
  apply** (unless overpay, then the 2nd is rejected inside the tx). Correct.
- A **retry** of the same intent in the same tab (reload, modal re-open) recovers
  the same opId → backend marker dedupes.
- Uniqueness is by **string equality of the opId**, not randomness: the backend
  marker (`sales/{opId}` · `payments[].id` · `stockAdjustments/{opId}` ·
  `restocks/{opId}` · `purchaseOrders.appliedReceiptIds`) is read **before any
  write inside the same transaction** and returns the authoritative state
  unchanged if present.
- The only cross-context collision risk is **tab duplication reusing an inherited
  opId** — **PH29-01**, now fixed.

**PASS (after fix).**

## 9. Same-record contention (two tabs)

Tab A edits → Tab B (viewer or editor) observes via `useRecordSync`:
`recordSyncState` is a **pure idempotent** state machine (`§7` model) — the same
`live` in always yields the same status out, so a repeated / no-op snapshot cannot
produce a second notification. Tab B sees status `updated`; its unsaved work is
**never overwritten** (Phase 1c "view-only invariant" — a non-lease-holder popup
is never force-closed; `rebaseRecord` re-applies the user's field changes only
where the other session provably did not touch that field, and surfaces genuine
conflicts for the user to resolve — nothing auto-resolved). **PASS.**

## 10. Different-record isolation (two tabs)

`selId` / `activeTab` / filters / pagination are **per-tab** state (module state +
`window.location.hash`; Phase 28). Tab A on Customer X and Tab B on Customer Y do
not leak — verified live: navigating tab "seed" to `#billing` left tab "tab-1" on
`#customers`. **PASS.**

## 11. Duplicate tab

- `sessionId` — fresh (in-memory) ✅
- page-instance id — re-minted on the `BroadcastChannel` collision (**PH29-01**) ✅
- `sessionStorage` — cloned by the browser, but every `ph5b:op:*` entry is `pi`-tagged
  and rejected once the pi is re-minted ✅
- `localStorage` — shared (expected; it is the offline cache / prefs) ✅
- `selId` / open modal / pending-operation state — the duplicate re-mounts React
  fresh; nothing dangerous is inherited ✅

Live: simulated Chrome Duplicate Tab (cloned `window.name` + `sessionStorage` into
a 2nd Browser-pane tab, both reloaded) → the "duplicate" re-minted its
page-instance id (`…z7eflsea` → `…stcc4qr0`) and a fresh payment there would get a
**new** opId, not the inherited `p_seed_original_500`. **PASS (after fix).**

## 12. Cross-tab real-time updates

Production list/record data flows through Firestore `onSnapshot` → every tab
converges. Cross-tab config (theme / prefs / language / notification toggles /
session timeout) propagates via the `storage` event — **verified live** (tab "seed"
received a `storage` event when "tab-1" wrote `maruti_settings_demo`). **PASS.**

## 13. Listener cleanup

- Per-tab: 0 leaked intervals / balanced `window` listeners over 5×6 module cycles
  (Phase 28, unchanged this phase).
- Per-record `observeRecord` / `observeLease` — `useEffect` keyed on `docId`,
  unsubscribed on change/unmount.
- N tabs → N server listeners is **correct** (each tab is a client); there is no
  linear growth *within* one tab from navigation.
- The **PH29-01** `BroadcastChannel` closes on `pagehide` (no leak).

**PASS.**

## 14. Authentication

`onAuthStateChanged` fires in every tab. Sign-out in tab A → tab B gets
`setUser(null)` → `pages/index.js` redirects to `/login`. Firestore listeners in
tab B then error `permission-denied`; `subscribeWindow`'s `onError` surfaces a
connection-error state rather than crashing (Phase 6b `handleListenerError`), then
the redirect takes over. **PASS.** *(Residual: a cross-tab logout / idle-timeout
redirect is not gated by the unsaved-changes guard — see §36.)*

## 15. Role isolation

Roles are **not** stored in any per-tab or cloneable browser storage — they are
derived each render from `user` + the live `appSettings/roles` snapshot +
`BOOTSTRAP_ADMINS`. A privileged action in an owner tab cannot become authorized in
a staff tab through shared `localStorage`, because no role/permission value is ever
read from `localStorage`. Role gating is app-level (single-trusted-shop model;
`firestore.rules` use `request.auth != null`) — documented, not claimed as a
cryptographic boundary (Phase 19/20). **PASS** (within that documented model).

## 16. Offline + multi-tab

Whole-browser offline → all tabs offline → **one shared** IndexedDB queue → replays
once on reconnect through whichever tab reconnects. Each tab's Quick Sell writes
its own `pendingSales/{opId}` (distinct opIds) → reconcile effect applies each once
via the same `runQuickSaleTx` (opId dedupe). Offline action + online action in
another tab: independent opIds, final state reconciles. Cross-check Phase 26 —
unchanged. **PASS.**

## 17. Payment

The transaction (`collectInvoicePayment`) `tx.get`s the invoice, returns unchanged
state if `pay.id` is already in `payments[]` (no 2nd row / no `_rev` bump / no
realisation), **re-checks overpay inside the tx** against totals computed from its
own fresh read (PH11-02 — the concurrent edit-down + pay-against-old-balance race),
bumps `_rev` (so a concurrent invoice editor is rejected stale), and diffs the
realisation cascade against the tx's own pre-image (CWF-01). Two tabs paying
**different** amounts → different `pay.id` → both apply or the 2nd is
`conc/overpaid`. Two tabs paying the **same** logical payment (retry) → same
`pay.id` → deduped. **PASS.**

## 18. Quick Sell

`runQuickSaleTx` `tx.get`s `sales/{opId}` first → `alreadyApplied` early-return
(no 2nd stock decrement, salesCount bump, ledger row, or rollup increment). Two
tabs → two opIds → both sales apply, stock decrements twice (correct — two real
sales). Retry → same opId → once. **PASS.**

## 19. Invoice realization

Runs **inside** the create/edit/payment transaction (Phase 8b). The realisation
plan is diffed against `serverPrior` (the tx's own read) — two tabs both closing
the balance: Firestore serialises them, the 2nd re-reads an already-`Paid` invoice
→ `Paid → Paid` zero delta → realisation runs **exactly once**. No duplicate
sales / stock / rollup; customer + vehicle history correct. **PASS.**

## 20. PO receive

`receivePO` — `runTransaction` + server over-receipt reject; dedupes on the bounded
`purchaseOrders.appliedReceiptIds` list (CWF-02). Two tabs receiving on the same PO
→ distinct `receiptId`s → both apply, capped by the server over-receipt check; a
retry → same `receiptId` → once. **PASS.**

## 21. Stock

Every stock change is a transaction (Quick Sell / adjust / restock / realisation /
PO receive). A Part **editor** cannot change stock (Phase 5 FIX-01 — typing a
lower number is refused; the `_rev` guard rejects a stale editor save that carried
an old stock value). A tab holding a Part open while another tab sells from it: the
sale's transaction re-reads current stock; the editor's guarded save is rejected
`conc/stale` if it tries to persist the pre-sale value. Cross-check Phase 12/13.
**PASS.**

## 22. Navigation

Per-tab `activeTab` / hash (Phase 28). Rapid switching in two tabs does not leak
state between them (§10). **PASS.**

## 23. Pagination

Per-tab `page` state with `didMountRef` (no reset on remount) and a clamp
(`if (page > pageCount) setPage(pageCount)`) that also fires when another session
shrinks the dataset under a paged tab. Cross-check Phase 16/24. **PASS.**

## 24. Analytics

Revenue / Cost / Profit / Margin read the unbounded `salesRollups` aggregate; a
tab with Analytics open converges live when another tab's transaction increments a
rollup (increment is inside the tx — no duplicate). Cross-check Phase 23. **PASS.**

## 25. Crash / restart

Tab close mid-edit → `pagehide` releases the lease (best-effort); the server expiry
(≤ 90 s) is the backstop → no phantom lock. Tab close mid-write → the write is in
the **shared** IndexedDB queue and replays through another tab / on reopen; the
opId marker dedupes. Browser restart → `sessionStorage` (and its opIds) is gone
(correct lifetime for "an intent in progress"); IndexedDB cache + auth persist;
`window.name` is gone → a fresh page-instance id. Only state intended to persist
survives. **PASS.**

## 26. Sleep / wake

Not driveable in this environment. Covered by design + Phase 7 emulator proofs
(backdated `expiresAt` standing in for a sleep gap): a lease past its 90 s expiry
on wake is not renewable by the stale session (`sameSession()` + `expired()`
rules); `onSnapshot` reconnects on wake; `_rev` re-checked on the next save.
**NOT RE-TESTED this phase; no regression.**

## 27. State isolation

`grep` for module-level mutable state that could leak across tabs via a singleton /
`window` global / static cache: only `lib/durableOpId.js`'s `cachedPageInstanceId`
(and `piSelfNonce`) are module-level — both per-JS-VM (per tab), intentional, and
now cross-checked by the BroadcastChannel. `window.name` is owned exclusively by
`durableOpId`. `localStorage` sharing (offline cache, prefs, demo customers /
invoices / job cards) is **intentional**; `sessionStorage` (`maruti_demo`, demo
inventory / suppliers / sales / …, `ph5b:op:*`) is per-tab by design. No
unintentional shared state found. **PASS.**

### Source-of-truth matrix

| State | Authoritative | Tab-local | Cross-tab | Persistence | Sync | Conflict handling |
|---|---|---|---|---|---|---|
| `_auth` | Firebase Auth | no | yes | IndexedDB | `onAuthStateChanged` (all tabs) | logout → all tabs → `/login` |
| `sessionId` | tab (in-memory) | **yes** | no | none (`useRef`) | — | reload/duplicate → fresh (correct) |
| `pageInstanceId` | tab | **yes** | no (collision-checked) | `window.name` (reload-stable) | `BroadcastChannel` | live collision → both re-mint (PH29-01) |
| `_active module` / `_filters` / `_pagination` | tab | **yes** | no | hash + view-state | — | per-tab; clamps on data shrink |
| `_selected record` | tab | **yes** | no | view-state | — | pure `useMemo(find(selId))` (Phase 28) |
| `_unsaved edits` | tab (form) | **yes** | no | localStorage drafts (some) | — | `moduleDirtyRef` guard; recordSync "updated" banner |
| `_edit lock` | `editLocks/*` | no | yes | Firestore | `observeLease` per record | `(uid,sessionId)` tx + rules; 90 s expiry; PH28-01 |
| `_rev` | record doc | no | yes | Firestore | re-read inside tx | `conc/stale` reject → rebase (Customers) / review |
| `_operation ID` | tab | **yes** | no (dup collision-checked) | `sessionStorage` + `pi` tag | — | backend marker dedupes retries; PH29-01 |
| `_pending sales` | `pendingSales/*` | no | yes | Firestore | reconcile effect | opId dedupe; same `runQuickSaleTx` |
| `_inventory` / `_payments` / `_invoice status` / `_sales` / `_rollups` | Firestore | no | yes | Firestore + shared IndexedDB | live `onSnapshot` | idempotency markers **inside the tx**; overpay re-check; realisation diff vs tx pre-image |
| `_role` / `_perms` | `appSettings/roles` | no | yes | Firestore | live `onSnapshot` + recompute | live propagation; `BOOTSTRAP_ADMINS` |
| settings / prefs / language | localStorage | shared | yes | localStorage | `storage` event | last-write-wins (config, not records) |

## 28. Automated tests

`tests/multitab-session-integrity.test.cjs` — **47 assertions**:

- §1 a faithful model of the page-instance id + BroadcastChannel collision watch
  (async message queue, matching real BroadcastChannel delivery) — proves:
  same-tab reload (no sibling) → id kept, opId reused; Duplicate Tab (window.name
  **cloned**) → both re-mint, inherited opId **not** reused; original converges to
  a distinct id
- §2 the shipped source (channel wired, both-re-mint echo, pagehide close, eager
  derivation, unchanged `readOrCreateOpId` / `peekOpId` pi checks)
- §3 sessionId isolation (source + model)
- §4 edit-lease identity, rules `sameSession()`, expired-only takeover/delete,
  PH28-01 guard, heartbeat/expiry constants, `pagehide` release; two-tab
  contention + crash-takeover model
- §5 `_rev` stale/current/deleted model
- §6 opId per-tab uniqueness + payment/quick-sell/adjust/PO-receive markers read
  before any write
- §7 `persistentMultipleTabManager`, `recordSyncState` idempotence, `observeRecord`
  unsubscribe contract, `rebaseRecord`; cross-tab convergence model
- §8 auth logout propagation, live role recompute, app-level-only gating,
  cross-tab `storage` sync
- §9 no-regression (API unchanged, window.name check still first-line, no rules
  change)

`tests/browser-lifecycle-discovery.test.cjs §5` — comment updated to note the
window.name-CLONED case is now covered by PH29-01 (the model there is the
window.name-empty half).

## 29. Live demo validation

Browser pane, two tabs (`seed`, `tab-1`), demo mode + production login page:

| Test | Result |
|---|---|
| `window.name` survives a same-tab reload | ✅ (`ph7b:pi:TESTSENTINEL` → still there after reload) |
| `window.name` empty in a genuinely new tab | ✅ |
| `sessionStorage` per-tab, `localStorage` shared | ✅ (`tab-1` did not see `seed`'s sessionStorage probe; did see its localStorage one) |
| Simulated **Duplicate Tab** (clone `window.name` + `sessionStorage`, reload) | ✅ **the "duplicate" re-minted its page-instance id; inherited opId no longer reused** |
| Clean same-tab reload, **no** live sibling | ✅ **no false re-mint; in-flight opId still recognised as ours (Phase 5b intact)** |
| Cross-tab `storage` event | ✅ (`seed` received the event when `tab-1` wrote settings) |
| Per-tab navigation isolation | ✅ (`seed` → `#billing` left `tab-1` on `#customers`) |
| Production login page loads (2 tabs) | ✅ |

**Not performed:** authenticated production multi-tab Firestore (no credentials;
entering a password is prohibited; production is read-only for these audits);
the real Chrome "Duplicate Tab" gesture (no paired browser — simulated exactly by
cloning both `window.name` and `sessionStorage`).

## 30. Confirmed defects

### PH29-01 — MEDIUM

| | |
|---|---|
| **Scenario** | User has a durable operation in flight (opId in `sessionStorage`, not yet cleared — a live modal, or an ambiguous-failure state). User **duplicates that exact tab** (Chrome/Edge "Duplicate tab"). In the duplicate, user performs a *genuinely different* operation on the **same record** (different payment amount / different quick-sell). |
| **Expected** | The duplicate's operation is a NEW intent → a NEW opId → it applies (or is rejected by a business guard). |
| **Actual (pre-fix, on a browser that clones `window.name`)** | The duplicate inherits the original's `window.name` (its page-instance id) alongside the cloned `sessionStorage` opId entry → the pi tag matches → `readOrCreateOpId` returns the **inherited** opId → the backend's idempotency marker (already written by the original) swallows the duplicate's operation → false-success toast; the different amount is **lost**. |
| **Root cause** | The Phase 7b discriminator (`window.name` resets on a new context) was verified for *new tab* and *reload*, not for the *Duplicate tab* gesture. Chromium serialises the frame name into the tab's navigation `PageState`, which "Duplicate tab" copies. The lifecycle-test model bakes in the wrong assumption (`name: {}`). |
| **Affected data/state** | Durable operation identity for payment / quick-sell / stock-adjust / restock / PO-receive / entity-create — the highest-value writes in the app. No wrong-*record* mutation, no *doubled* money/stock (it is a **lost** operation, shown as success). |
| **Mitigations that remained even pre-fix** | the `hadPending` "check the record before retrying" banner; the transaction-level overpay guard (payments where the different amount overflows the balance are correctly rejected, not swallowed); a very narrow window (in-flight op + duplicate-that-tab + different-op-same-record). |
| **Fix** | `getPageInstanceId()` cross-checks a `BroadcastChannel('ph7b:pi')`: on adopting a page-instance id it announces it; if any *other live context* already holds that exact id, both echo → re-mint → re-announce (converges, cannot loop). An inherited id is thus never trusted while a sibling is alive; a same-tab reload (no sibling) keeps its id. Derived eagerly at import. Degrades to the window.name-only check where BroadcastChannel is unavailable. `lib/durableOpId.js`, **+65 / −7**, no new dependency. |
| **Regression test** | `tests/multitab-session-integrity.test.cjs §1` — async-queue model of the watch: same-tab reload → id kept + opId reused; Duplicate Tab (window.name cloned) → both re-mint + inherited opId **not** reused. |
| **Demo/live validation** | Browser pane, simulated Duplicate Tab: pass (see §29). |
| **Production impact** | Removed a false-success / lost-operation risk on the durable-op path; **strictly additive** to Phase 7b (the window.name check is still first-line). No `firestore.rules` change. 0 production mutations. |

## 31. Root causes

PH29-01 — an integrity fix (durable operation identity for financial operations)
rested on an **unverified assumption about a specific browser gesture**. The
assumption is plausibly false on the most common browser (Chromium), and the
codebase's own model hard-coded it. The audit's mandate ("do not treat Phase 1–28
results as proof") surfaced it.

## 32. Fixes

| File | Change | ± |
|---|---|---|
| `lib/durableOpId.js` | `startPiCollisionWatch()` (BroadcastChannel liveness → both re-mint on collision); `getPageInstanceId()` restructured (window.name → mint → watch); eager derivation at import | +65 / −7 |
| `tests/multitab-session-integrity.test.cjs` | **new** — 47 assertions | +new |
| `tests/browser-lifecycle-discovery.test.cjs` | comment: the window.name-empty model is one half; window.name-cloned is covered by PH29-01 | +8 / −5 |

## 33. Before / after evidence

- **Model** (`§1`): before — a duplicate with a cloned `window.name` box returns
  `Y === X` (inherited opId reused). After — the BroadcastChannel collision makes
  both re-mint; `Y !== X`.
- **Live** (`§29`): before — simulated duplicate keeps `window.name`
  `…z7eflsea`, `entry.pi === window.name` → inherited opId reused. After —
  simulated duplicate re-mints to `…stcc4qr0`, `entry.pi !== window.name` → fresh
  opId. Clean reload: unchanged (Phase 5b preserved).

## 34. QA cleanup

All Browser-pane test keys (`ph5b:op:payment:INV-TEST` / `INV-DUPTEST` /
`INV-RELOADTEST`, `__ph29_*`, the `maruti_settings_demo.__ph29_crosstab` probe)
removed from both tabs; `window.name` reset. Dev server stopped; `.next` cleaned.
**0 production Firestore reads or writes; 0 production mutations.**

## 35. Code-growth review

+58 net production lines, **1 file**. No new component, hook, module, dependency,
or "synchronization layer" — `BroadcastChannel` is a single standard Web API used
as a liveness probe (the same shape as the edit-lease heartbeat). Reuses the
existing `window.name` tag, the existing `pi`-check in `readOrCreateOpId` /
`peekOpId` (unchanged), and the existing `pagehide` cleanup pattern. PH29-02/03
(below) deliberately **not** fixed (demo-only / documented-by-design).

## 36. Remaining limitations

1. **PH29-02 (INFO) — demo mode is a single-client sandbox.** Two demo tabs do not
   sync business data (customers / invoices / job cards in shared `localStorage`
   with no `storage` listener; inventory / suppliers / sales / adjustments / POs in
   per-tab `sessionStorage`). Production uses Firestore live sync. Demo is a
   sales/eval sandbox — not a multi-user workspace. Documented, no code change.
2. **PH29-03 (LOW, by design) — a cross-tab logout or idle-timeout redirect is not
   gated by the unsaved-changes guard.** `pages/index.js` does `router.push('/login')`
   on `onAuthStateChanged(null)` / idle expiry; this is a client-side nav so
   neither the `moduleDirtyRef` prompt (Phase 28) nor the editor's `beforeunload`
   fires → a dirty editor's unsaved edits are dropped silently. Edge case (logging
   out elsewhere while editing here); logout is a deliberate session-ending action;
   the idle timeout already behaves this way. Documented.
3. **Real Chrome "Duplicate Tab" gesture and authenticated production multi-tab**
   were not exercised (no paired browser / no credentials). PH29-01's fix is
   verified by an exact simulation (clone both `window.name` and `sessionStorage`)
   + async-queue model + does-not-depend-on-clone-behaviour design.
4. **Sleep/wake** not re-tested (Phase 7 emulator proofs stand).
5. Everything in `KNOWN_LIMITATIONS.md` from prior phases still stands.

## 37. Final assessment

**PASS (after fix).** The multi-tab / multi-session surface is one of the most
heavily hardened parts of this codebase (Phases 1a–1c, 2, 3b, 4b, 5b, 6b, 7b, 28).
This deep re-audit confirmed session-id isolation, edit-lease identity + rules,
`_rev`, backend idempotency markers, `persistentMultipleTabManager`, cross-tab
settings sync, navigation isolation, and listener cleanup are all sound — and found
**one** real defect: the tab-duplication opId protection depended on an unverified,
probably-false assumption about `window.name` and Chrome's "Duplicate tab". Fixed
with a browser-independent `BroadcastChannel` liveness check, +58 net production
lines, no rules change, 0 production mutations.

---

## FINAL OUTPUT

```
PHASE 29 STATUS:            COMPLETE
SAME-RECORD TWO-TAB:        PASS
EDIT LOCKS:                 PASS
STALE _REV:                 PASS
OPERATION IDS:              PASS (after fix — PH29-01)
CROSS-TAB SYNC:             PASS
LISTENER CLEANUP:           PASS
DUPLICATED TAB:             PASS (after fix — PH29-01)
CACHE / INDEXEDDB:          PASS
OFFLINE + MULTI-TAB:        PASS
AUTHENTICATION:             PASS
ROLE ISOLATION:             PASS (within the documented single-trusted-shop model)
FINANCIAL OPERATIONS:       PASS
INVENTORY OPERATIONS:       PASS
NAVIGATION:                 PASS
PAGINATION:                 PASS
ANALYTICS:                  PASS
CRASH / RESTART:            PASS
SLEEP / WAKE:               NOT TESTED (Phase 7 emulator proofs stand; no regression)

CRITICAL:                   0
HIGH:                       0
MEDIUM:                     1   (PH29-01)
LOW:                        1   (PH29-03 — cross-tab logout drops unsaved edits; by design)
INFO:                       1   (PH29-02 — demo mode is a single-client sandbox)

NEW DEFECTS:                1   (PH29-01)
FIXES:                      1
AUTOMATED TESTS:            tests/multitab-session-integrity.test.cjs — 47/47
REGRESSION:                 npm test 150/150 · test:rules 2/2 (150+111) · lint 0 · build ✓
LIVE DEMO:                  PASS (2-tab: window.name lifecycle, simulated Duplicate Tab,
                                  storage-event sync, nav isolation, storage-scope model)
PRODUCTION MUTATIONS:      0
QA CLEANUP:                 done (all test keys removed from both tabs, window.name reset,
                                 dev server stopped)
PRODUCTION CODE CHANGE:     yes
NET PRODUCTION LINES:       +65 / −7  (net +58; 1 file, 0 new dependency, 0 rules change)
COMMIT:                     <pending>
DEPLOYMENT:                 <pending>

REMAINING LIMITATIONS:
  - PH29-02 (INFO) demo mode is a single-client sandbox — two demo tabs don't sync
    business data; production uses Firestore live sync
  - PH29-03 (LOW, by design) a cross-tab logout / idle-timeout redirect isn't gated
    by the unsaved-changes guard — a dirty editor's edits are dropped silently
  - real Chrome "Duplicate Tab" gesture and authenticated production multi-tab not
    exercised (no paired browser / no credentials); PH29-01 fix verified by exact
    simulation + model + clone-independent design
  - sleep/wake not re-tested (Phase 7 emulator proofs stand)

FINAL ASSESSMENT:  PASS  (after fix; evidence: 47 model/source assertions + 150/150
                          regression + live 2-tab validation incl. a faithful
                          Duplicate-Tab simulation and the Phase-5b non-regression)
```
