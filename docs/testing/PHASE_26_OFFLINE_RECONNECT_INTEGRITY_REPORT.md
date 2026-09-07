# Phase 26 — Offline / Reconnect / Offline-Edit Integrity

**Two-stage phase.** Follows one user through **ONLINE → GO OFFLINE → READ → EDIT →
COME ONLINE → queue / reject / retry / duplicate / conflict / success** and proves
what actually happens to the action and whether the user is told the truth.

> ## STAGE 1 — DISCOVERY RESULT: **DEFECT FOUND**
>
> **PH26-01 (MEDIUM)** — the inline stock-stepper restock (`commitStock`, the `[+]`
> button / typing a higher stock number — the app's quick-restock path) kept its
> **optimistic value** on an offline transaction failure and showed **no error**. It
> assumed an IndexedDB-queued write would replay — but that path is a
> `runTransaction`, and **Firestore transactions are not persisted offline**. So an
> offline restock silently reverted on reconnect (or was lost with no trace if the tab
> closed first). Every *other* write path — payment, invoice realization, stock
> adjustment, PO receive, Quick Sell, customer/part/supplier edit — handles offline
> correctly.
>
> ## STAGE 2 — FIXED
>
> `commitStock`'s catch now always rolls the optimistic value back and shows an
> accurate message ("You're offline — this restock wasn't saved…"), exactly as
> `adjustStockLine` / `receivePO` already do for the same class of failure. **+19 / −7
> lines, 1 file, no new mechanism** (reuses `isTxTimeout` / `timeoutMessage`).
>
> `npm test` **147/147** · `npm run test:rules` **2/2** · lint **0** · build **✓** ·
> **0 production Firestore writes** this phase.
>
> **FINAL ASSESSMENT: PASS** (after the fix).

---

## 1. Objective

Prove what happens to a user action performed while offline — is it queued, rejected,
retried, duplicated, conflicted, or silently lost — and whether the UI tells the truth
(no "Saved" for a write that only queued or failed; no accidental duplicate on retry;
no "failed" for something that committed).

## 2. Offline architecture

| Layer | Configuration |
|---|---|
| Persistence | `initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })` — IndexedDB, multi-tab |
| Offline detection | `navigator.onLine` + `window` `online`/`offline` events → a React `online` flag (`InventoryDashboard`) |
| Pre-warning | `warnIfOffline(thing)` — a **non-blocking** `notify.warning` before every transaction-backed mutation (Phase 6b PH6-02). Deliberately never disables/blocks — `navigator.onLine` is a UX hint, not a correctness gate (a captive portal reports "online"). |
| Transaction wait bound | `withTimeout(promise, 12000)` (`lib/txTimeout.js`) — races the tx against a timer; timeout ⇒ `TxTimeoutError` (`code:'tx/timeout'`) = ambiguous, keep the opId (Phase 6b PH6-03). Does **not** cancel. |
| Idempotency | one stable `opId` per intent, stored in `sessionStorage` tagged by a `window.name` page-instance id (Phase 5b/7b), recorded **inside the same transaction** as the effect (`sales/{opId}` · `stockAdjustments/{opId}` · `restocks/{opId}` · `payments[].id` · `purchaseOrders.appliedReceiptIds`). The tx reads the marker **before** any write. |
| Global indicator | sidebar status: red dot + **"Offline"** when `!online`, "Connection Error" on `connError`, plus "Last sync" time. Settings page mirrors it. |
| The app never calls | `enableNetwork` / `disableNetwork` / `waitForPendingWrites` — it does not manage the Firestore network layer directly (verified). |

## 3. Firebase persistence behaviour (facts from the installed SDK + emulator repro)

Read from `node_modules/@firebase/firestore` and confirmed with a `disableNetwork` /
`enableNetwork` reproduction against a real client SDK + the emulator:

| Write kind | Offline behaviour | Promise resolves? | Replays on reconnect? |
|---|---|---|---|
| `getDoc` / listener read | served from IndexedDB cache (`fromCache:true`) | yes (cached) | n/a |
| `setDoc` / `updateDoc` / `addDoc` / `deleteDoc` | **queued in IndexedDB**, local cache updates with `hasPendingWrites:true` | **NO — stays pending until the server acks** | **yes** — flush on reconnect (repro: all four stayed PENDING offline, all RESOLVED after `enableNetwork`) |
| `writeBatch` | queued (atomic), replays | pending until ack | yes |
| **`runTransaction`** | **CANNOT run** — `tx.get` is a server read, which offline rejects `FirestoreError(Code.UNAVAILABLE, "Failed to get document because the client is offline.")` | rejects | **NO** — SDK: *"Unlike transactions, write batches are persisted offline"* |
| offline create **then** delete | collapses — net effect DELETE, no phantom doc (repro) | — | — |

> **Emulator fidelity note.** `@firebase/rules-unit-testing` + the Firestore emulator
> do **not** faithfully reproduce offline *transaction* semantics — with `disableNetwork`
> active, `getDoc` correctly rejects `unavailable`, but a `runTransaction` still
> resolved (loopback to the emulator stays reachable). Production Firestore has no
> loopback; the SDK's own `UNAVAILABLE … client is offline` error (thrown by the same
> server-read path a transaction's `tx.get` uses) and the explicit *"Unlike
> transactions, write batches are persisted offline"* documentation are the
> authoritative evidence. Every finding below rests on the SDK contract + source trace,
> not the emulator's transaction path.

## 4. Offline READ behaviour

**PASS.** Every list (customers / parts / invoices / job cards / suppliers / sales) is
fed by a bounded `onSnapshot`; offline, Firestore replays the last cached window from
IndexedDB. No blank screen, no false "no records", loading terminates, listener errors
route to the shared `handleListenerError` surface (never a silent perpetual "loading").
Cached data is not visually labelled "stale" on the list itself, but the sidebar shows
**"Offline"** and "Last sync HH:MM" while disconnected — `lastSync` advances **only** on
`!hasPendingWrites && !fromCache`, so a cached snapshot never claims a fresh sync.

## 5. Offline EDIT behaviour — the full matrix

| # | Operation | Mechanism | Offline result | User sees |
|---|---|---|---|---|
| A | read anything | cache | served from IndexedDB | data (sidebar: "Offline") |
| B | **Customer** wizard edit | `guardedSet` (runTransaction) | rejects `unavailable`, **no optimistic mutation**, wizard stays open | *"Couldn't confirm the customer saved. Reopen it to check before retrying — a stale retry is safely rejected, a lost one saves again."* |
| K/L | **Part / Supplier** edit | `guardedSet` (runTransaction) | rejects, no optimistic, modal stays open | *"Couldn't confirm the supplier saved. It may already exist — check … or press Save again (a repeat is safe)."* |
| D | **Part / Supplier / PO create** | `setDoc(client-stable id)` (plain) | **queues** in IndexedDB; the `await` stays pending → button spins until reconnect, **then** success toast | `warnIfOffline` pre-warning; spinner; no false success |
| E | **Payment** | runTransaction | rejects, opId **kept**, no success toast | *"Couldn't confirm the payment went through. It may already be recorded — check the invoice, or press Record Payment again (a repeat is safe)."* |
| F | **Quick Sell** | explicit `if (online)` branch → offline writes **one durable `pendingSales/{opId}`** intent (queues) + a reconcile effect applies it through the **same** `runQuickSaleTx` on reconnect | durably queued, exactly-once | optimistic stock decrement + *"Sold N × part"*; on reconnect *"Offline sale of X synced."* (or *"An offline sale of X could not be completed: …"*) |
| G | **Invoice save / realization** | `editInvoiceTransactional` (runTransaction) | rejects → `onSave` returns `false`, **no "Invoice saved" toast** | error toast, editor stays open |
| H | **Stock adjustment** | `warnIfOffline` + runTransaction | rejects → **no optimistic** (`setInventory` is inside `if (!alreadyApplied)` *after* the await), opId kept, modal stays open | *"Couldn't confirm the adjustment saved … a repeat is safe."* |
| I | **PO receive** | `warnIfOffline` + `poReceiveDoc` (runTransaction, withTimeout) | rejects → **no optimistic** (non-demo), form stays open, opId kept | *"Couldn't confirm the receipt saved … a repeat is safe."* |
| J | **Job-card reserve** | runTransaction | rejects, opId kept | handled via the shared conc/timeout branch |
| — | add-note (plain fields) / totals write-back / bulk archive | `updateDoc` / `setDoc` (plain) | **queues**, replays; engine-derived fields (`totalSpent`) self-correct on the next invoice recompute | — |
| — | add-note (array) / add-vehicle | `applySecondaryMerge` → runTransaction + `replayIdArray` | rejects offline — **cannot** queue a stale array | — |
| **✗** | **Quick restock — inline `[+]` stepper (`commitStock`)** | runTransaction (`qr_<partId>_<stock>` doc) | rejects `unavailable` → **(BEFORE FIX)** `offlineish` branch **kept the optimistic value, showed NO error, wrote no audit/ledger, no `warnIfOffline`** → silently reverted on the next reconnect snapshot, or lost on tab close | **← PH26-01** |

## 6. Reconnect behaviour

| Class | Offline | Reconnect | Final server state | Duplicate? |
|---|---|---|---|---|
| plain write (create / field edit / bulk archive) | queued | **replayed automatically** by IndexedDB | the queued value (field-level last-write-wins) | no — the client-stable doc id / `setDoc(merge)` makes replay idempotent |
| Quick Sell (offline branch) | `pendingSales/{opId}` queued | reconcile effect → `runQuickSaleTx` (opId dedup) → delete the pending doc | stock/sales/rollup/salesCount applied **exactly once** | no |
| transaction (payment / adjust / receive / invoice / edit) | **rejected**, opId kept | user retries → transaction runs, marker read first → applied **once** | correct | no — the in-transaction marker |
| `_rev`-guarded edit | **rejected** (can't queue) | retry re-reads `_rev`: unchanged → saves; changed by another client → `conc/stale` → conflict surfaced, wizard's "Updated elsewhere" banner + [Review Latest] | correct | no, no silent overwrite |

## 7. Queue / reject / retry classification

- **QUEUED** (auto-replay): part/supplier/PO **create**, field edits, bulk archive,
  totals write-back, Quick Sell's `pendingSales` intent.
- **REJECTED** (fail-fast, opId kept, retry-safe): every `runTransaction` — payment,
  invoice save/realize, stock adjustment, PO receive, job-card reserve, customer/part/
  supplier **edit**, invoice-number allocation.
- This split is deliberate and safe: no financial/authoritative write is ever left in
  an ambiguous "maybe queued, maybe committed" state — it either replays exactly (a
  plain idempotent write) or fails cleanly with an opId the retry reuses.

## 8. Duplicate-retry testing

Independent model of the shipped marker-in-transaction pattern + emulator confirmation:
offline attempt applies **nothing** (tx never reaches the server) → reconnect → retry
#1 → `applied` → retries #2/#3 (double-retry / network flap) → `already-applied` →
**stock 50→47, salesCount 0→3 — exactly once.** Every idempotent handler keeps its
opId on an ambiguous failure and clears it only on a confirmed result (success, or a
definite business rejection like "insufficient stock" / `po/over-receipt`). Cross-checks
Phases 4b / 5b / 7b — unchanged.

## 9. Refresh / close / reopen while offline

- A **queued plain write** is persisted in IndexedDB — it survives a refresh **and** a
  tab close, and replays whenever any tab for that origin reconnects (multi-tab
  manager). (SDK contract; Phase 5's `refresh-reload-consistency` covers the retry side.)
- A **failed transaction** left nothing to survive — the opId in `sessionStorage`
  survives *this tab's* reload (not a close), so a reload+retry recovers the same id and
  the backend marker de-duplicates (Phase 5b). A genuine tab *duplicate* gets a fresh
  page-instance id and does not inherit the intent (Phase 7b).
- **PH26-01's** failure mode: offline restock → tx fails → nothing queued, nothing in
  `sessionStorage` for `commitStock` (it has no durable opId) → close the tab → the
  restock is **gone with no trace**. The fix makes the failure *visible* so the user
  knows to redo it.

## 10. Multiple offline edits

Plain writes queue in order and replay in order; the last value for a field wins.
Transactions each fail independently (nothing queued), each retried independently on
reconnect. No lost update between *different* records; for the *same* field edited
offline while another client edits it online, see §18.

## 11. Two-tab / conflict

A `_rev`-guarded edit is a `runTransaction` → it **cannot be queued offline**, so there
is never a stale queued guarded write to replay. On reconnect the retry re-reads `_rev`
and rejects a stale one (`conc/stale`) — surfaced by every editor's "Updated elsewhere"
banner + [Review Latest] (Phases 1a/1c). Not re-driven with two live browser tabs this
phase (no second authenticated tab available — tooling limit, as in Phases 7/23); the
transaction-can't-queue property makes the outcome deterministic from the SDK contract.

## 12. Offline delete / archive

`deleteDoc` queues and replays; an offline create+delete of the same doc collapses to a
net delete (repro). Bulk archive is a chunked `writeBatch` (queues). No resurrection: a
`guardedSet` on a deleted doc throws `conc/deleted` rather than re-creating it
(Phase 1a) — and it can't queue anyway.

## 13. Payment (emulator / model only — no production money touched)

**PASS.** `warnIfOffline('this payment')` → `runTransaction` rejects → opId kept →
*"Couldn't confirm the payment went through … a repeat is safe."* → **no "Payment
recorded" toast**. Reconnect + retry → same opId → the payment is in `payments[]` keyed
by `payment.id`; the transaction sees it and applies nothing. `paid` / `balance` /
status stay correct. Refresh doesn't create a second payment (Phase 5b). Cross-checks
Phase 11 + 4/5.

## 14. Quick Sell (demo / emulator only)

**PASS.** The one write path with a bespoke offline design (Phase 8B PH8-05): offline it
persists **one** durable `pendingSales/{opId}` document (a single write *is* atomic,
online or offline), and a reconcile effect on `online` applies each through the exact
same `runQuickSaleTx` (opId-idempotent) then deletes the pending doc. Stock, `sales`,
`salesRollups`, `salesCount`, amount — each applied exactly once. A definite business
rejection (part gone / insufficient stock) on reconciliation discards the pending doc
with an explicit `toast.error`. Retry-safe.

## 15. PO receive (demo / emulator only)

**PASS.** `warnIfOffline('this receipt')` → `poReceiveDoc` transaction rejects → *"…a
repeat is safe."* + `return false` (form stays open). **No optimistic stock change** in
production. Reconnect + retry → `receiptId` in `appliedReceiptIds` → the transaction
no-ops. No over-receipt, no duplicate replay. Cross-checks Phase 3/4/5.

## 16. Invoice realization (demo / emulator only)

**PASS.** Transaction rejects offline → `onSave` catches → `return false`, **no
"Invoice saved" toast**. Reconnect + retry → the realization cascade re-reads and
applies once (Phase 8B/23). Revenue / cost / profit / rollup / customer totals stay
correct. Cross-checks Phase 8/23.

## 17. Stock adjustment / restock (demo / emulator only)

- **Stock adjustment** (modal): **PASS** — no optimistic, error toast, opId kept.
- **Quick restock** (inline stepper): **PH26-01** (§ below).

## 18. Stale-write behaviour

A queued plain `updateDoc` replays with **field-level last-write-wins** — reproduced:
an offline `{name: "A-offline"}` overwrote a newer online `{name: "B-online"}` on
reconnect; the field B also set (`n: 20`) that A didn't touch **survived**. This is
standard Firestore semantics and is **contained** here because the only fields written
by a *plain* (queueable) path are either (a) engine-derived (`totalSpent` / `outstanding`
— recomputed and re-written on the very next invoice save), or (b) create-time fields on
a brand-new doc (no concurrent editor). Everything a user *edits* by hand goes through
`guardedSet` (a transaction — can't queue — `_rev`-checked on retry) or
`applySecondaryMerge`'s `replayIdArray` transaction. No silent loss of a hand edit.

## 19. Listener behaviour

Every list listener applies server data only on `!snap.metadata.hasPendingWrites`, so an
unconfirmed local write never flashes as "settled" (Phase 6b PH6-01 brought `parts`
into line). `setPendingWrites(...)` is tracked every snapshot; `lastSync` advances only
on `!hasPendingWrites && !fromCache`. Reconnect transition observed in the repro:
`server → cache → cache+pending → server+pending → server`. No impossible business
state was rendered.

## 20. Network flap

`online`/`offline` events toggle the `online` flag; a pending plain write is not
re-queued (IndexedDB owns it); a failed transaction is not auto-retried (the user
drives the retry, reusing the opId). No duplicate on `online → offline → online → …`.

## 21. User messaging

**PASS** (after the fix). Every success toast fires strictly **after** the awaited write
resolves — verified by source-pattern for payment, invoice save, supplier save, customer
save (`… catch (e) { return; } … toast.success(…)`). No "Saved" / "Paid" / "Stock
updated" precedes a commit. The ambiguous copy ("it may already be recorded — a repeat
is safe") is *conservative* for the clean-offline case (nothing committed) but never
causes a wrong action — INFO, not a defect. `warnIfOffline` + the sidebar "Offline"
badge tell the user their connection state up front and continuously.

## 22. Data-integrity reconciliation

For every transaction path: offline → **0 rows written** (tx never reaches the server) →
reconnect + retry → the marker-first transaction applies the full effect **once**
across all layers (stock · `sales`/`stockAdjustments`/`restocks` row · `salesRollups` ·
`salesCount` · `payments[]` · `appliedReceiptIds`). Modelled in the test (`stock 50→47,
salesCount 0→3` after offline-fail + 3 retries) and consistent with Phases 4b/8B/23.

---

## 25. Confirmed defects

### PH26-01 (MEDIUM) — offline quick-restock kept a phantom stock value

**1. ORIGINAL CODE** (`components/InventoryDashboard.js`, `commitStock` catch):
```js
} catch (err) {
  console.error('Stock sync failed:', err);
  // Issue 1: an OFFLINE write is queued by IndexedDB and will replay — keep
  // the optimistic value. Any OTHER failure … roll the UI back …
  const offlineish = err?.code === 'unavailable' || /offline|network/i.test(err?.message || '');
  if (!offlineish && prevStock != null) {
    setInventory((prev) => prev.map((p) => (p.id === partId ? { ...p, stock: prevStock } : p)));
    toast.error('Could not update stock — the change was reverted. Check your connection / Firestore access.');
  }
}
```
The `[+]` stepper / typing a higher stock number calls `commitStock`, which always hits
the `delta > 0` branch: a `runTransaction` (stock set + a `restocks/{qr_…}` ledger row,
inside `withTimeout`).

**2. TEST / REPRODUCTION** — SDK contract + emulator + source trace:
- SDK: `FirestoreError(Code.UNAVAILABLE, 'Failed to get document because the client is
  offline.')` is thrown by the server-read path a transaction's `tx.get` uses.
- SDK: *"Unlike transactions, write batches are persisted offline"* — transactions are
  **not** queued.
- Emulator repro: an offline `getDoc` (same server-read path) → **REJECTED
  `unavailable`**.
- ⇒ genuine offline: `runTransaction` → `tx.get` rejects `unavailable` → the catch's
  `offlineish` is **true** → the rollback + toast are **skipped**.

**3. EXPECTED** — like `adjustStockLine` / `receivePO`: the optimistic value rolls back
and the user is told the restock was not saved (a transaction failure is a *definite*
no-commit that will not replay).

**4. ACTUAL** — the optimistic `setInventory` value (and the stepper's own local value)
**stays**, with **no toast, no audit entry, no `restocks` row, and no `warnIfOffline`**.
Nothing is queued. On the next `!hasPendingWrites` `parts` snapshot (delivered on
reconnect) `setInventory(server data)` silently overwrites the phantom value. If the tab
is closed before reconnect, the restock is **lost with no trace**.

**5. ROOT CAUSE** — the `offlineish` "keep the optimistic value, it'll replay" branch
was written for the *other* branch of `commitStock` (a plain `updateDoc`, which
genuinely queues). The same `catch` also serves the `runTransaction` branch, where the
"it'll replay" premise is **false**. (In practice `commitStock` is *always* the
transaction branch — the plain `updateDoc` branch is only reachable for `delta ≤ 0`,
which the stepper blocks upstream.)

**6. FIX** (`+19 / −7`, 1 file — REUSE, not a new mechanism):
```js
} catch (err) {
  console.error('Stock sync failed:', err);
  // PH26-01 — the only path here is a stock INCREASE ⇒ the runTransaction above.
  // Firestore transactions are NOT persisted offline … so an offline failure here
  // (code 'unavailable') definitely did NOT commit and nothing will replay. Roll
  // back + say so, exactly as adjustStockLine / receivePO already do.
  if (prevStock != null) {
    setInventory((prev) => prev.map((p) => (p.id === partId ? { ...p, stock: prevStock } : p)));
    toast.error(
      isTxTimeout(err)
        ? timeoutMessage('This stock update')
        : (err?.code === 'unavailable' || /offline|network/i.test(err?.message || ''))
        ? 'You’re offline — this restock wasn’t saved. Try again once your connection is back.'
        : 'Could not update stock — the change was reverted. Check your connection / Firestore access.',
    );
  }
}
```

**7. REGRESSION TEST** (`tests/offline-reconnect-integrity.test.cjs` §5) — pure
before/after model of the catch decision:
- `catch_BEFORE({ errCode:'unavailable', prevStock:2 })` → **`keptOptimistic:true,
  rolledBack:false`** (the defect)
- `catch_AFTER(…)` → **`rolledBack:true, toast:'offline'`**
- plus: timeout → shared timeout copy; permission-denied → generic message
- plus source-pattern on the shipped file: the catch no longer has `offlineish` /
  `!offlineish`; it always rolls back on known `prevStock`; it shows the offline copy
  and reuses `isTxTimeout` / `timeoutMessage`; the comment records *why* (so it can't
  regress silently); no `enableNetwork`/`disableNetwork`/new retry layer added.

**8. POST-FIX RESULT** — `npm test` **147 / 147** (new file: 43 assertions) ·
`npm run test:rules` **2 / 2** · `npm run lint` **0** · `npm run build` **✓**. Phase
6's `network-interruption-recovery` assertion *"the app never manages the Firestore
network layer"* still holds.

**9. LIVE / DEMO RESULT** — the fix compiles and the app runs clean (0 console errors);
the stepper happy path verified in demo mode (stock 18 → 19 on `[+]`, no error). The
offline-Firestore path itself cannot be driven in demo (demo writes go to localStorage,
which never goes offline) and the emulator does not faithfully simulate offline
transactions (loopback); the fix's behaviour is verified by the before/after model +
the shipped source pattern, and it exactly mirrors the already-shipped, already-tested
`adjustStockLine` rollback for the same failure class.

## 26–28. Root causes / fixes / before-after

Covered in §25 (the mandatory 9-step timeline). One defect, one fix.

## 29. QA cleanup

- Emulator reproduction scripts (`_ph26_repro.cjs`, `_ph26_tx.cjs`) deleted; their
  `.git/info/exclude` entries removed.
- Dev server + Firestore emulator stopped; demo storage wiped; browser pane closed.
- No `.skip` / `.only` / debug logging / temporary offline branch / test-only
  production logic in the diff or the new test.
- **0 production Firestore writes** — all offline work was the emulator or the demo
  sandbox.

## 30. Code-growth review

```
Production lines:   +19 / −7   (components/InventoryDashboard.js — 1 catch block; ~13 comment)
New production fns / files / abstractions:   0   (reuses isTxTimeout / timeoutMessage / the adjustStockLine pattern)
Test lines added:   ~250   (tests/offline-reconnect-integrity.test.cjs — new, 43 assertions)
Doc lines added:    ~this file
firestore.rules:    unchanged
```

`REMOVE → REUSE → EXTEND → CONSOLIDATE → ADD` — the fix *removed* the buggy `offlineish`
special-case and *reused* the existing rollback pattern + the existing timeout helpers.

## 31. Remaining limitations

- **INFO** — the ambiguous copy ("it may already be recorded — a repeat is safe") is
  shown even for a *clean* offline failure where nothing could have committed. Safe
  (never a wrong action; the retry is idempotent) but slightly imprecise. A deliberate
  choice: `navigator.onLine` is treated as a hint, never trusted to assert "definitely
  offline, definitely no commit."
- **INFO** — a plain offline **create** (part / supplier / PO) leaves the Save button
  spinning until reconnect (the `await setDoc` stays pending), then completes. No false
  success; `warnIfOffline` pre-warns; the write is durable. A "queued — will save when
  you're back online" state would be a nicer affordance (future).
- **INFO** — cached list data is not badged "offline / cached" on the list itself; the
  sidebar "Offline" badge + "Last sync" time are the signal.
- **INFO** — offline Quick Sell shows *"Sold N × part"* for a durably-queued
  `pendingSales` intent that reconciles on reconnect; the sale is committed as a
  pending intent, not yet applied to the server ledger at that instant. A defensible
  POS trade-off (Phase 8B), and the reconcile toasts both success and failure.
- Two live browser tabs for a real offline-vs-online conflict were not driven (no
  second authenticated tab — tooling limit); the transaction-can't-queue property makes
  the outcome deterministic from the SDK contract.
- Emulator + `rules-unit-testing` do not faithfully reproduce offline *transaction*
  rejection (§3 note).

## 32. Final assessment

**PASS** (after PH26-01 is fixed). Every write path now handles offline safely:
authoritative/financial operations are transactions that **fail fast, keep their opId,
and are idempotent on retry** — no false success, no duplicate, no silent overwrite;
simple writes **queue in IndexedDB and replay**; Quick Sell has a bespoke durable
pending-intent path. The one gap — the inline restock stepper keeping a phantom
optimistic value on an offline transaction failure — is fixed by making it roll back and
tell the truth, matching the pattern every other stock-mutating handler already used.

---

## FINAL OUTPUT

```
PHASE 26 STATUS:              COMPLETE

OFFLINE READ:                 PASS  — served from IndexedDB cache, no blank/false-empty, sidebar "Offline"
OFFLINE EDIT:                 PASS  — transactions fail-fast + opId-kept; plain writes queue; PH26-01 fixed
RECONNECT:                    PASS  — plain writes auto-replay; transactions retried by the user, idempotent
QUEUEING:                     MIXED (by design) — plain writes QUEUED; transactions REJECTED fast (never ambiguous financial state)
RETRY:                        PASS  — same opId reused, marker-in-transaction ⇒ exactly once
DUPLICATE PROTECTION:         PASS  — model + emulator: stock 50→47, salesCount 0→3 after offline-fail + 3 retries
CONFLICT PROTECTION:          PASS  — _rev edit is a tx (can't queue); retry re-checks _rev → conc/stale surfaced
USER FEEDBACK:                PASS  — every success toast is post-commit; warnIfOffline + persistent "Offline" badge; PH26-01 now tells the truth
PAYMENT:                      PASS  (emulator/model — no production money touched)
QUICK SELL:                   PASS  (demo/emulator) — durable pendingSales intent + reconcile, exactly once
INVOICE REALIZATION:          PASS  (demo/emulator) — tx rejects offline, no "saved" toast, idempotent retry
PO RECEIVE:                   PASS  (demo/emulator) — no optimistic, "a repeat is safe", appliedReceiptIds dedup
STOCK / RESTOCK:              PASS  — adjustment was already correct; quick-restock (PH26-01) FIXED
DATA RECONCILIATION:          PASS  — offline = 0 rows written; reconnect+retry = full effect once across every layer

CRITICAL:  0
HIGH:      0
MEDIUM:    1   (PH26-01 — fixed)
LOW:       0
INFO:      5

NEW DEFECTS:                  1
FIXES:                        1
AUTOMATED TESTS:              147 / 147 test files  (new: offline-reconnect-integrity.test.cjs — 43 assertions)
RULES:                        2 / 2  (150 + 111) — no firestore.rules change
LINT:                         0 errors
BUILD:                        ✓ compiled successfully
LIVE DEMO:                    PASS — app runs clean; stepper happy path unbroken (18→19, no error). Offline-Firestore path: SDK-contract + model evidence (demo can't go offline; emulator can't simulate offline transactions)
QA CLEANUP:                   complete — emulator scripts removed, dev+emulator stopped, demo storage wiped
PRODUCTION MUTATIONS:        0
CODE GROWTH:                  +19 / −7 production (1 file, ~13 comment; 0 new fn/file/abstraction) · +~250 test

COMMIT:                       01871c6
DEPLOYMENT:                   Vercel JCMGSzIFNXcU59ty9UcMV (/, /login, /verify -> 200; deployed bundle carries the new "this restock wasn't saved" message and no longer contains the `offlineish` variable)

REMAINING LIMITATIONS:
  - INFO: clean-offline failure shows the conservative "may already be recorded" copy (safe; navigator.onLine treated as a hint)
  - INFO: a plain offline create spins the Save button until reconnect (durable, no false success; no "queued" affordance)
  - INFO: cached list data not badged on the list (sidebar "Offline" + Last-sync is the signal)
  - INFO: offline Quick Sell says "Sold" for a durably-queued pending intent (Phase 8B POS trade-off)
  - two-tab live offline conflict not driven (tooling); emulator can't simulate offline transactions

FINAL ASSESSMENT:
  PASS. The offline / reconnect architecture is sound — financial and authoritative
  writes are transactions that fail fast offline with a preserved, idempotent operation
  id (no false success, no duplicate, no silent overwrite); simple writes queue in
  IndexedDB and replay; Quick Sell has a dedicated durable pending-intent path. Stage 1
  found one MEDIUM gap — the inline restock stepper kept a phantom optimistic value on
  an offline transaction failure and could silently lose the restock — and Stage 2
  fixed it by rolling back and telling the truth, reusing the exact pattern every other
  stock-mutating handler already uses. No new abstraction, no firestore.rules change,
  zero production writes.
```
