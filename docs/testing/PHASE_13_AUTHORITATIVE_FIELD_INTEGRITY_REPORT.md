# Phase 13 — Authoritative-Field Stale-Snapshot Audit

## 1. Objective

For every entity examined across this program (Customer, Vehicle, Job Card,
Invoice, Supplier, Part), find fields that can be written by **more than one
workflow**, and for each one verify:

1. every writer of that field,
2. whether each writer participates in the `_rev` (or equivalent) revision
   protocol,
3. whether any whole-document editor can save a stale snapshot of that
   field,
4. that an unrelated edit cannot overwrite a newer authoritative value,
5. that the fix — where one is needed — excludes the authoritative field
   from the stale payload, or makes the missing writer participate in the
   existing revision protocol, rather than inventing a new synchronization
   mechanism.

The explicit warning driving this phase: **a document having a `_rev` field
proves nothing by itself.** PH12-01 (Phase 12) slipped through precisely
because Part's stock-only transactions never bumped `_rev`, so Edit Part's
`_rev` guard was blind to them. This phase looks for the same shape of gap
everywhere else.

## 2. Method

For each entity's whole-document editor (the "wizard"): read its exact save
payload, then grep every other write site touching that collection to find
a second writer of any field the wizard's payload also carries. For every
match, determine whether the second writer bumps `_rev` (or is otherwise
reconciled via `replayIdArray`) — if not, and the wizard's payload includes
a stale copy of that field, that is a confirmed defect under this phase's
own criteria (an *authoritative* value being silently overwritten — a
field's own designers explicitly classifying it non-authoritative/
denormalized takes it out of scope, per §6 below).

## 3. Per-entity findings

### Customer

- `totalSpent` / `outstanding` (billing write-back) and `noteEntries` /
  `documents` (detail-panel actions) are written by `setCustomers()` calls
  that go through `store.syncAll`'s diff-based path — narrow, field-level,
  no `_rev` bump (by design; these are not whole-document edits).
- The Customer wizard's own save (`saveCustomerEdit` →
  `store.saveGuarded`) **already destructures these fields out of its own
  payload** before calling the guarded save
  (`CustomersModule.jsx`: `const { noteEntries, documents, totalSpent,
  outstanding, visits, ...wizardFields } = c;`). The wizard's payload never
  carries a stale copy of them — nothing to fix. This was Phase 3b's
  (CWF-03) own fix, re-verified here, not re-derived.
- `vehicles[]` (nested array, edited from both the wizard and the detail
  panel's quick-add) is handled by `replayIdArray` on **both** sides —
  the wizard via `guardedSet`'s `idArrayKeys: ['vehicles']` +
  `clientBefore` option, secondary writes via `applySecondaryMerge`'s own
  `idArrayReplays`. Both routes reconcile against server truth instead of
  blind-overwriting. Already correct.

**Verdict: clean, no fix needed.**

### Job Card

- Grepped every write site touching `COLLECTIONS.JOB_CARDS`: only the
  guarded wizard save (`saveGuarded`, whole-document, `_rev`-checked) and
  the diff-based `syncAll` path (create/delete, which only ever writes
  fields that actually changed in **live** local state — not a stale
  snapshot). No narrow secondary writer of any job-card field exists in
  production.
- `linkJobCard` (BillingModule, pulling a job card's details into an
  invoice being drafted) only sets **local invoice form state** — it never
  writes back to the job card document.

**Verdict: no second writer exists for any job-card field — nothing to
protect against.**

### Invoice

- `payments[]` / `paid` / `balance` / `status` are the interesting case:
  unlike Customer's excluded fields, the invoice edit modal **legitimately
  owns** these too (it can add/edit/remove a payment row directly), so
  exclusion does not apply — both the modal's Save and the standalone
  "Collect Payment" quick action are real, independent, intentional ways to
  change the same fields.
- Traced `collectInvoicePayment` (the quick action's transactional target):
  it deliberately **does** bump `_rev` on every payment — the function's own
  comment states this exact reason: *"a payment also bumps `_rev`, so an
  invoice editor that was open when the payment landed is correctly
  rejected as stale on save (otherwise its stale `payments` copy could
  clobber this one)."* `editInvoiceTransactional` (the modal's Save target)
  already checks `_rev` via `revState`/`conflictError` before writing.
  Both writers participate in the same protocol — a stale modal save is
  correctly rejected, not silently merged.
- (`collectInvoicePayment` does *not* reject on a stale `_rev` itself —
  it always re-reads and appends, which is why two concurrent payments
  both succeed [BUG-CONC-01's original fix] — but it always *advances*
  `_rev`, which is what protects the *other* direction of the race.)

**Verdict: clean. This looked like the most likely candidate for a
PH12-01-shaped gap, and it was already closed — deliberately, not by
accident.**

### Part

- Re-verified Phase 12's own fix still holds: `stock` remains excluded from
  the shared edit/create payload, and `salesCount` / `reserved` were never
  in it to begin with. All three stay owned exclusively by Quick
  Sell/Restock/Adjustment/PO-receive/Job-Card-reserve, none of which bump
  `_rev` — this is why they must stay excluded, not a regression.
- `suppliers[]` (a denormalized display copy of a linked supplier's
  name/phone) **is** written by both the Part edit form and a Supplier
  rename's fan-out cascade, with the cascade not bumping `_rev`. This was
  already identified and explicitly accepted in Phase 8B: the field is
  documented as *"DERIVED/DENORMALIZED, not authoritative... a stale
  part-level display is recoverable (it self-corrects the next time that
  part or supplier is edited)."* It is out of this phase's scope by its own
  criteria (only *authoritative* values), and by Phase 8B's own explicit,
  reasoned decision not to force an unbounded fan-out into one transaction
  for a cosmetic field.

**Verdict: no new defect; one already-accepted, already-documented
non-authoritative exception re-confirmed, not re-opened.**

### Supplier — PH13-01 (confirmed defect)

- The full Supplier edit wizard's save (`saveGuarded(COLLECTIONS.SUPPLIERS,
  ...)`) sends a payload including `name`, `phoneNumbers`, `primaryPhone`,
  `phones`, `phone` — a snapshot loaded when the wizard opened.
- `persistSupplierEdit` — reachable from **inside the Part modal**, as a
  quick way to fix a linked supplier's name/phone without leaving the part
  form — writes those exact same fields via a plain `updateDoc`, and did
  **not** bump `_rev`.
- Unlike Invoice's payments (protected because the competing writer *does*
  bump `_rev`) and unlike Customer's excluded fields (protected because the
  wizard never sends them), Supplier's name/phone had **neither**
  protection: two legitimate editors of the same authoritative fields,
  only one of which participated in the revision protocol.
- **Reproduced**: a Supplier wizard opened with `_rev=0`; a concurrent
  `persistSupplierEdit` corrects the name (server now shows the corrected
  name, but `_rev` unchanged); the wizard's `_rev` check against server
  truth still reports **no conflict** (`revState` returns
  `{conflict: null}`) — so the wizard's later save would silently write its
  stale name/phone right back over the correction, with no toast, no
  banner, no trace.

## 4. Root cause

`persistSupplierEdit` was written as a narrow "secondary" update (correctly
modeled on `applySecondaryMerge`'s pattern of not bumping `_rev` for fields
the wizard doesn't own) — but name/phone are **not** disjoint from the
wizard's own fields the way `applySecondaryMerge`'s targets (notes,
totals, vehicles) are from the *wizard's* payload. Whoever wrote this quick
edit reused the "narrow write, don't touch `_rev`" shape without noticing it
was writing into a field range the guarded wizard also owns outright.

## 5. Fix

One line, in `persistSupplierEdit` (`components/InventoryDashboard.js`):
add `_rev: increment(1)` to its existing `updateDoc` call. This makes the
quick edit participate in the exact revision protocol the Supplier
wizard's `guardedSet` already checks — reusing Phase 1a's existing
mechanism (the same shape `collectInvoicePayment` already uses for
Invoice), not adding a new synchronization path. `increment(1)` on a
possibly-absent `_rev` field is safe: `revOf()` already treats a missing
`_rev` as revision 0, and Firestore's `increment()` on a missing field
starts from 0, so the first bump correctly produces `_rev: 1` for a legacy
supplier with no `_rev` yet — identical to how every other guarded write in
this codebase already treats a pre-Phase-1a document.

No new abstraction, no new file, no new transaction — the fix sits inside
the same `updateDoc` call the function already made.

## 6. Tests

`tests/authoritative-field-integrity.test.cjs` (new, 10 assertions):

- A MANDATORY MATRIX proof using the **real, production** `revState()`
  function (from `lib/concurrency.js` — not a mock or reimplementation):
  before the fix, `revState` reports no conflict for the wizard's stale
  save (reproducing the gap); after the fix, it correctly reports
  `conflict: 'stale'`.
- A source-pattern proof that the shipped `persistSupplierEdit` now
  includes `_rev: increment(1)` in its `updateDoc` payload.
- Six `[fact]` proofs recording why each other checked field (Customer's
  excluded fields + `vehicles[]` replay, Part's `stock`/`salesCount`/
  `reserved` exclusion, Invoice's `_rev`-bumping payment write, Job Card's
  single-writer status, Part's documented-non-authoritative `suppliers[]`)
  was found already correct rather than re-deriving phases already proven
  elsewhere.

## 7. Gates

- `npm test`: **full suite passed** (see deployment addendum, §9, for the
  exact count run against this commit).
- `npm run test:rules`: passed, unchanged — no rules touched.
- `npx eslint .`: **0 errors** (pre-existing warnings only).
- `npm run build`: succeeded.

## 8. Code-growth review

```
production lines added:      14   (components/InventoryDashboard.js)
production lines removed:     0
net production change:       +14
```

Of those 14 lines, **13 are a comment** explaining why this write now
bumps `_rev` (matching this codebase's established documentation style)
and **1 is real logic**: `_rev: increment(1),` added to an *existing*
`updateDoc` call.

- **Significant new logic:** none. The fix is a single field added to an
  object literal already being written; no new function, transaction, or
  file.
- **Existing mechanisms reused:** Phase 1a's `_rev`/`increment` revision
  protocol (the exact same mechanism the Supplier wizard's `guardedSet`
  already checks, and the exact same shape `collectInvoicePayment` already
  uses for Invoice payments) — no new synchronization mechanism was
  introduced, per this phase's own instruction to prefer reuse.
- **Unnecessary code removed:** none — no dead code was found during this
  audit.
- **Fields excluded from a stale payload vs. sync mechanism added:** this
  phase's one fix took the "make the missing writer participate in the
  existing protocol" branch, not the "exclude from payload" branch, because
  — unlike Customer's totalSpent/outstanding or Part's stock/salesCount —
  the Supplier wizard *legitimately* owns name/phone too; excluding them
  from the wizard's own payload would have broken its primary purpose.

Test/documentation growth (phase-mandated, not production):
`tests/authoritative-field-integrity.test.cjs` (new, 131 lines) and this
report (new).

## 9. Final assessment

**PASS.** One confirmed defect (PH13-01, MEDIUM — a reverted contact
detail, not money or stock) found and fixed with the smallest possible
change. Every other multi-writer authoritative field checked this phase
(Customer's totalSpent/outstanding/noteEntries/documents/vehicles, Part's
stock/salesCount/reserved, Invoice's payments/paid/balance/status, Job
Card's fields) was already correctly protected by an existing mechanism —
`_rev` exclusion, `_rev` participation, or `replayIdArray` reconciliation —
and required no further change. All gates green.

## 10. Deployment record

- **Commit:** `fb46721` (`fix(concurrency): harden authoritative-field
  revision protocol`), pushed to `main`, deployed by Vercel.
- **Build verification:** `window.__NEXT_DATA__.buildId` read
  `FUKT0xtznzhM3JqbeaFfZ`, distinct from the prior known build id
  (`KsltSrytglH01fCm7wz0e`), confirming the new commit is live.
- **Console check:** no application JS errors — only the same benign
  browser/network noise observed consistently since Phase 10
  (`ERR_QUIC_PROTOCOL_ERROR.QUIC_PACKET_WRITE_ERROR`, `ERR_BLOCKED_BY_CLIENT`,
  one bare 400 status).
- No supplier, part, or invoice record was created, edited, saved, or
  moved against real data to perform this check — the fix's correctness is
  established by the real-`revState()` proof and source-pattern proof in
  `tests/authoritative-field-integrity.test.cjs` (§6), not by a live
  reproduction.
