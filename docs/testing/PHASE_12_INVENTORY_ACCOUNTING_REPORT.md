# PHASE 12 — Inventory Accounting Integrity Report

**Repository:** github.com/bhargav-1618/Balaji-Auto-OS
**Production:** https://balaji-auto-os.vercel.app
**Branch:** main
**Central question:** for every Part, can the current Firestore `stock` be
mathematically explained by its complete movement history? Negative stock is
not, by itself, a defect (Phases 9/11 already established this is deliberate
for realized sales) — the only question is whether every movement is
recorded, explainable, and applied exactly once.

---

## 1. Inventory model

Two fields on `parts/{id}` are relevant to this audit, and they are
**genuinely separate concepts** (confirmed from source, not assumed):

- **`stock`** — physical, authoritative on-shelf quantity. Every write to it
  is either an `increment()` inside a transaction that also writes an
  attributable ledger document, or (Part creation) an explicit opening value.
- **`reserved`** — a Job Card's claim on stock that hasn't been billed out
  yet. Touched ONLY by `applyReserveDelta` (`reserved: increment(...)`),
  which **never** touches `stock`. Reservation and physical stock are
  confirmed disjoint; the physical-stock accounting equation below correctly
  excludes reservation entirely.

No stock movement bypasses a Firestore transaction anywhere in the app
(confirmed by an exhaustive `stock: increment(` / `stock: safeStock` /
`stock: after` grep across every production file — see §16).

## 2. Stock equation

```
Opening Stock (Part creation's own `stock` field — no separate ledger doc)
+ PO Receipts               (services/purchaseOrderService.js: poReceiveDoc)
+ Manual Restocks            (receiveStockLineInner — no formal PO)
+ Quick-restock stepper      (commitStock, +1 only — see §4)
+ Positive Adjustments       (adjustStockLineInner, direction: 'correction')
+ Return / Reversal          (Credit Note -> invoice-realization reversal)
- Negative Adjustments       (adjustStockLineInner, direction: 'reduce' — CLAMPED at 0)
- Quick Sell                 (runQuickSaleTx — NOT clamped, negative allowed)
- Invoice Realization        (planInvoiceRealization / applyRealizationPlanInTx — NOT clamped)
= Current Stock
```

`reserved` is deliberately excluded — it is not part of this equation.

## 3. Opening-stock semantics

Opening stock is simply the `stock` value written when a Part document is
first created (the "Add Part" form, or a bulk `.xlsx`/`.csv` import — both
CREATE-ONLY, verified in §16 to never touch an existing part's document).
There is no separate "opening stock" ledger entry, and none is fabricated
by this audit — the Part document's own creation IS the anchor every later
movement is reconstructed from.

## 4. Movement taxonomy

| Movement | Direction | Ledger collection | Atomic with stock write | Idempotent | Missing-part handling |
|---|---|---|---|---|---|
| Part creation (Add Part / import) | opening | — (the part doc itself) | n/a | client-stable doc id | n/a |
| PO receive (`poReceiveDoc`) | IN | `restocks` | ✓ (Phase 3b/9) | ✓ (`appliedReceiptIds`) | skips missing part (PH9-02) |
| Manual Receive Stock (`receiveStockLineInner`) | IN | `restocks` | ✓ (Phase 4b) | ✓ (`restockOpId`) | throws (part MUST exist — this IS the part being restocked) |
| Quick-restock stepper (`commitStock`, +1) | IN | `restocks` | ✓ (Phase 8B) | ✓ (deterministic `qr_<id>_<stock>`) | n/a (part is on-screen) |
| Stock Adjustment, correction (`adjustStockLineInner`) | IN | `stockAdjustments` | ✓ (Phase 4b) | ✓ (`adjId`) | throws (part MUST exist) |
| Return / Reversal (Credit Note) | IN | `sales` (compensating negative row) | ✓ (Phase 8B/9, reused — PH11-01) | ✓ (diff-based) | skips missing part (PH9-01) |
| Stock Adjustment, reduce (`adjustStockLineInner`) | OUT (clamped ≥0) | `stockAdjustments` | ✓ | ✓ | throws (part MUST exist) |
| Quick Sell (`runQuickSaleTx`) | OUT (unclamped) | `sales` | ✓ (Phase 4b/8B) | ✓ (`opId`) | n/a (part is on-screen) |
| Invoice realization | OUT (unclamped) | `sales` | ✓ (Phase 8B) | ✓ (diff-based) | skips missing part (PH9-01) |
| Job Card reservation/release | n/a — touches `reserved`, never `stock` | — | ✓ (Phase 8B) | ✓ (`appliedReserveIds`) | skips missing part |
| **Edit Part (any field)** | **was: silent, unledgered** | — | — | — | **PH12-01 — CONFIRMED DEFECT, now FIXED** |

## 5. Movement sources — code locations

- `services/purchaseOrderService.js:poReceiveDoc`
- `components/InventoryDashboard.js:receiveStockLineInner`
- `components/InventoryDashboard.js:commitStock`
- `components/InventoryDashboard.js:adjustStockLineInner`
- `components/InventoryDashboard.js:runQuickSaleTx` (Quick Sell)
- `components/InventoryDashboard.js:planInvoiceRealization` / `applyRealizationPlanInTx`
- `components/InventoryDashboard.js:applyReserveDelta` (reserved only)
- `components/InventoryDashboard.js:handleSaveInner` (Part create/edit — where PH12-01 lived)

No other stock-changing code path exists (§16).

---

## 6–13. Scenario results

### 6. Stock-in results — SAFE
PO receive, manual restock, and the quick-restock stepper's `+1` path all
write their ledger row and increment `stock` inside one transaction, each
keyed by a stable idempotency id. Verified: exactly one ledger entry per
call, keyed by an id that makes a retry a no-op, not a duplicate.

### 7. Stock-out results — SAFE
Quick Sell and invoice realization both decrement `stock` unclamped (negative
stock intentionally reachable) inside the same transaction as their `sales`
ledger row. A repeated call (double-click, refresh+retry) is idempotent —
already proven in Phases 4b/5b/8B and re-confirmed unregressed here (full
suite green).

### 8. Adjustment results — SAFE
`adjustStockLineInner` records `before`/`after`/`signedQty`/`reason`/
`correctsId` in `stockAdjustments`, atomic with the `stock` increment.
"Reduce" is clamped so it can never remove more than is on record (§9);
"correction" adds back, explicitly linkable to the adjustment it corrects
via `correctsId`.

### 9. Negative-stock results — SAFE / INTENTIONAL (policy confirmed, not "fixed")
Two DIFFERENT, both-documented, both-correct policies coexist:
- **Quick Sell / invoice realization**: intentionally UNCLAMPED. A sale is a
  business event that already happened; clamping it would silently invent
  inventory on reversal (Phase 9's `applyStockDelta` comment: *"A negative
  stock figure is not a bug to be hidden — it is the TRUTH that the shop
  floor issued parts it did not have on the books."*).
- **Stock Adjustment "reduce"**: intentionally CLAMPED at 0. A physical-count
  correction (damage/loss) cannot remove more than the system believes
  exists — `computeStockAdjustment`'s `delta = Math.min(nonNegInt(qty), before)`.

Neither is a defect; each matches its own real-world semantics. Every
negative-stock value remains fully explainable by its movement history in
both cases (§18).

### 10. PO receiving results — SAFE
`poReceiveDoc` re-derives each line's server-truth `receivedQty` inside its
own transaction (Phase 3b, CWF-02) and rejects over-receipt as a whole
(`po/over-receipt`) before any write — so `stock` always equals exactly the
accepted (never-exceeding-ordered) received quantity; PO's own
`items[].receivedQty`, the `restocks` ledger, and `Part.stock` cannot diverge.

### 11. Quick Sell results — SAFE
One atomic transaction: stock decrement + `sales` row + `salesCount`
increment, keyed by a durable `opId` (survives refresh). A repeated
"Quick Sell" click after a lost ack finds the marker and applies nothing a
second time — verified unregressed (Phase 4b/5b/8B tests all still pass).

### 12. Invoice realization results — SAFE
`planInvoiceRealization` computes a pure diff (old realized qty vs. new);
`applyRealizationPlanInTx` applies stock delta + `sales` row inside the SAME
transaction as the invoice write itself (Phase 8B). One realized invoice
line always corresponds to exactly one `sales` row and one `stock` delta —
confirmed by the long-chain reconstruction in §15.

### 13. Returns/reversal results — SAFE (Phase 11's fix re-verified)
Credit Note reissues the invoice through the identical
`editInvoiceTransactional` → `planInvoiceRealization` path — Phase 11's
PH11-01 fix removed the one duplicate restoration path that used to exist
here. This phase re-confirms (source + full regression suite) that fix is
intact and remains the sole restoration mechanism.

---

## 14. Multi-Part results — SAFE

Every multi-part operation found (invoice with several lines, a Job Card's
`parts[]`, a multi-line PO) computes its per-part delta map FIRST and writes
every part's delta inside ONE transaction (`applyRealizationPlanInTx`'s
`Object.entries(plan.stockDeltas).forEach`, `applyReserveDelta`'s
`decisions.forEach` over `Promise.all`-read parts, `poReceiveDoc`'s
`activeLines.forEach`) — Phase 8B's "no partial accounting across parts on
one operation" guarantee, re-confirmed unregressed.

## 15. Long-chain reconstruction

A pure-model 8-step lifecycle (opening → PO receive → adjustment → Quick
Sell → restock → invoice realization → return → adjustment) was
reconstructed movement-by-movement with an INDEPENDENT oracle
(`tests/inventory-accounting-integrity.test.cjs`, §5):

```
Opening                     0
PO receive       +20       20
Adjustment (dmg)  -3       17
Quick Sell        -5       12
Restock          +10       22
Invoice realiz.   -8       14
Return            +8       22
Adjustment (corr) +2       24
```

Every intermediate state was checked individually (not just the final
total), and the return's `+8` was confirmed to net exactly to zero against
the `-8` invoice realization it reverses — the same single-restoration
guarantee Phase 11's PH11-01 fix established, now re-proven at the
accounting level, not just the transaction-boundary level.

## 16. Duplicate-movement audit

Exhaustive grep across `components/InventoryDashboard.js`: exactly **5**
`stock: increment(...)` sites (one each for the demo-mode realization
primitive, production invoice realization, Quick Sell, Stock Adjustment, and
manual Receive Stock) and exactly **3** `stock: safeStock` occurrences (one
local-state mirror + `commitStock`'s two mutually-exclusive branches, never
both firing for one call). No unexpected 6th write site exists. PO receive's
own single write site lives in `services/purchaseOrderService.js` (checked
separately). **No duplicate-movement path was found** — Phase 9's
missing-part-skip fixes and Phase 11's `onRestoreStock` removal already
closed the two that existed; this phase found no new one.

## 17. Missing-movement / source-without-movement audit

Every stock-out and stock-in path in §4 writes its ledger row inside the
SAME transaction as its `stock` write — a "source exists but no movement
recorded" gap is structurally impossible for any of them (the ledger row
and the stock write either both commit or neither does).

## 18. Source-without-movement — the ONE confirmed exception (PH12-01)

**Editing an existing Part's unrelated fields** (name, category, price,
supplier...) could silently change `stock` back to a stale value with **zero**
movement record — the "source" here is the Edit Part save itself, and it
produced a stock change with no `stockAdjustments`/`restocks`/`sales` row
explaining it. See §20 for the full analysis; this is the phase's one
confirmed defect, now fixed.

## 19. Firestore comparisons

Representative traced scenario (independent oracle vs. what the real
production code would persist, per §15's chain):

```
Part: (disposable test lineage, pure-model)

Oracle:                    24
Movements:
  +20 PO receive
  -3  Adjustment (damage)
  -5  Quick Sell
  +10 Restock
  -8  Invoice realization
  +8  Return
  +2  Adjustment (correction)
  (0  Opening)

Every movement traced to its exact ledger collection (§4) and idempotency
key; every intermediate state checked (§15).

Result: PASS — oracle, reconstructed running total, and the source
documents' own before/after fields agree exactly.
```

PH12-01's own before/after (pure-model, mirroring the real bug shape):

```
Part P-1: stock = 10 (loaded into the Edit Part form)
Concurrent Quick Sale: -3 units, ledgered in `sales`, stock -> 7 (Part's
  own _rev untouched — Quick Sell is an atomic stock-only transaction, not
  a guarded whole-document edit)

BEFORE the fix: saving an unrelated Edit Part field change writes
  stock: 10 back to Firestore — the real, ledgered -3 sale becomes
  unexplained by the resulting stock value (10, not 7).

AFTER the fix: the same save leaves stock untouched at 7 — matches the
  sales ledger exactly.
```

## 20. Confirmed defects

| ID | Summary | Severity |
|---|---|---|
| PH12-01 | Editing a Part's unrelated fields could silently revert `stock` to the stale value the Edit Part form loaded when opened, with zero movement record, because no stock-only transaction (Sell/Restock/Adjust/PO-receive/Invoice-realization) bumps a Part's `_rev` — so the Phase 1a guarded-edit conflict check cannot detect the intervening change | **HIGH** |

Classified HIGH, not CRITICAL: the resulting stock value is still internally
consistent with *some* legitimate prior state (the one the form loaded) —
it is not NaN, not a corrupted arbitrary number, and does not corrupt the
`sales`/`stockAdjustments`/`restocks` ledgers themselves (those rows remain
accurate) — but it silently discards a real, already-ledgered movement's
effect on the authoritative `stock` field, matching HIGH's definition
("a normal workflow can create unrecorded... stock movement") rather than
CRITICAL's ("materially incorrect and cannot be reconstructed" — it CAN be
reconstructed, from the ledger, which is exactly how this audit caught it).

## 21. Root cause

`handleSaveInner`'s shared create/edit `payload` object included a bare
`stock: nonNegInt(formData.stock)` field. The function's own adjacent
comment ("stock & salesCount are not in `payload` so Sell/Receive's atomic
counters are still never overwritten") documents the INTENDED invariant —
`salesCount` correctly honors it (absent from `payload`); `stock` had
regressed back in, most plausibly during an unrelated whitelist expansion
(the same block gained `oemNo`/`partNo`/`barcode`/`hsn`/etc. per an adjacent
comment) that never touched the `stock` line but also never re-verified it
stayed excluded. The CREATE branch's own `setDoc` call already re-specifies
`stock` explicitly and independently, confirming the ORIGINAL design never
needed `stock` in the shared object at all.

## 22. Fixes

- **`components/InventoryDashboard.js` — `handleSaveInner` (production
  payload)**: removed `stock: nonNegInt(formData.stock),` from the shared
  create/edit `payload` object. The CREATE branch is unaffected (its own
  `setDoc` call already sets `stock` explicitly). The EDIT branch
  (`store.saveGuarded` → `guardedSet`, `{merge:true}`) now simply never
  touches the `stock` key, so Firestore leaves whatever ledgered operations
  most recently set it to untouched.
- **`components/InventoryDashboard.js` — `handleSaveInner` (demo mode)**:
  the same regression existed in demo mode's local-state merge; an EDIT now
  re-pins `stock`/`salesCount` to the part's CURRENT value after spreading
  `built`, rather than letting `built`'s (possibly stale) form-time values
  win.

No schema change, no new collection, no rules change, no new transaction,
no new abstraction — a net **deletion** of the defect's root line, plus a
small, existing-pattern-consistent correction in the parallel demo path.

## 23. Automated tests

New **`tests/inventory-accounting-integrity.test.cjs`** (36 assertions):
- An independent accounting oracle (`reconstructStock`, summing signed
  movement deltas — never calling `computeStockAdjustment`/`invTotals`/
  `planInvoiceRealization`) checked against the phase brief's own worked
  example and an 8-step long-chain reconstruction (§15), every intermediate
  state verified individually.
- Source-pattern proof of every movement type in §4's taxonomy, including
  the pre-existing PH9-01/PH9-02 missing-part skips and PH11-01's
  single-restoration guarantee (re-verified, not re-litigated).
- A genuine functional/source proof of PH12-01's fix, plus a MANDATORY
  INJECTION MATRIX pure-model proof (the Phase 8B/9/10/11 convention) of the
  exact before/after stock-reversion shape.
- A duplicate-movement grep audit confirming exactly 5 `stock: increment(...)`
  sites and 3 `stock: safeStock` occurrences, matching the taxonomy exactly.
- This file deliberately does NOT duplicate `tests/inventory-service.test.cjs`'s
  existing direct coverage of `computeStockAdjustment`/`cardReservedQtys`/
  `reserveDelta`/`buildRestockRecord` (already thorough, including the
  "reduce clamped at 0" case) — reused, not re-tested.

## 24. Regression tests

`npm test`: **134/134** test files passed (133 pre-existing, unregressed +
1 new). This re-confirms Phases 1–11's protections (concurrency, `_rev`
guards, idempotency, refresh-safety, network recovery, lifecycle,
transaction-boundary, orphan handling, referential integrity, financial
integrity) are all intact after PH12-01's fix.

## 25. Production validation

- `npm test`: **134/134** passed.
- `npm run test:rules`: **133/133** passed, unchanged (no rules touched).
- `npx eslint .`: **0 errors** (pre-existing warnings only).
- `npm run build`: **succeeded.**
- Production smoke testing (post-deploy) is limited to safe, non-destructive
  navigation (Inventory list renders, an existing part's stock/ledger figures
  are unchanged) — reproducing PH12-01 live would require editing a real
  production Part while a concurrent real sale lands on it, which is exactly
  the kind of live financial/inventory corruption this program's own
  production-safety rules (repeated in every phase from 9 onward) prohibit
  manufacturing. The fix is proven instead by the independent oracle and
  pure-model proof above (§19), the same evidentiary standard already used
  for comparably irreversible scenarios in Phases 9/11.

## 26. QA cleanup

No QA inventory records were created this phase — verification used source
proof and pure-model reconstruction rather than live data manipulation.
Nothing to clean up.

## 27. Code-growth review

```
production lines added:      21   (components/InventoryDashboard.js)
production lines removed:    2
net production change:       +19
```

Of those 21 added lines, **19 are comments** explaining why (matching this
codebase's established documentation style) and **2 are real logic**: the
demo-mode edit merge now writes 2 extra object keys
(`stock: p.stock, salesCount: p.salesCount`) onto an EXISTING `setInventory`
call — no new function, no new file, no new abstraction. The defect's actual
fix in the production path is a pure **deletion** (one line removed, zero
lines added in its place) — the smallest possible correction, consistent
with `salesCount`'s pre-existing correct exclusion from the same object.

- **Significant new logic:** none. Both changes extend an already-existing
  object literal / already-existing `setInventory` call; neither introduces
  a new function, transaction, or validation path.
- **Existing mechanisms reused:** the shared create/edit `payload` object's
  own pre-existing exclusion pattern (already correctly applied to
  `salesCount`, now applied to `stock` too); the CREATE branch's own
  independent, already-correct `stock: nonNegInt(formData.stock)` (unchanged,
  needed no fix); Firestore's `{merge:true}` semantics (an absent key is
  left alone — no new merge logic was written, the existing `guardedSet`
  call is untouched).
- **Unnecessary code removed:** the single regressed `stock:` line in the
  shared payload — the root cause itself.

Test/documentation growth (expected, phase-mandated, not production):
`tests/inventory-accounting-integrity.test.cjs` (+327 lines, new, required
by Phase 12Y) and this report (new, required by Phase 12's own deliverable
list) — neither is incidental growth.

## 28. Remaining limitations

- PH12-01 was verified via source proof + pure-model reconstruction rather
  than a live production race (editing a real Part while a real concurrent
  sale lands), per this phase's own production-safety instructions.
- This phase re-verified Phases 1–11's guarantees via the full regression
  suite; it did not re-derive them from first principles.
- The asymmetry between Quick Sell/invoice-realization (unclamped, negative
  allowed) and Stock Adjustment "reduce" (clamped at 0) is documented as
  intentional (§9); a THEORETICAL race where a stale client-computed
  `signedQty` clamp decision is applied against a fresher server stock
  value inside `adjustStockLineInner`'s transaction was noted during
  discovery but is a Phase 1/3-style concurrency question (the clamp's own
  guarantee, not the accounting trail's explainability — the resulting
  ledger entry remains internally self-consistent even in that scenario) and
  was left out of scope per this phase's explicit instruction not to
  duplicate the Phase 1/3 concurrency suite.

## 29. Final PASS/FAIL assessment

**PASS.** One confirmed HIGH-severity inventory-accounting defect (PH12-01)
was found and fixed with the smallest possible change — a one-line deletion
restoring an already-documented, already-partially-honored invariant, plus
a small consistency fix in the parallel demo-mode path. Every other stock
movement source in the application (PO receive, manual restock, quick
restock, Stock Adjustment, Quick Sell, invoice realization, return/reversal,
Job Card reservation) was confirmed to write a complete, attributable,
atomic ledger entry alongside its stock change, with no duplicate-movement
or missing-movement gap found. Negative stock remains intentionally
supported and fully explainable wherever it is allowed to occur. All
regression gates are green.
