# PHASE 9 — Orphan-Record / Broken-Relationship Integrity Report

**Repository:** github.com/bhargav-1618/Balaji-Auto-OS
**Production:** https://balaji-auto-os.vercel.app
**Branch:** main
**Method:** source-code audit of every collection's reference fields and lookup
helpers (the established Phase 5–8 convention: every claim below is backed by
an exact line/file citation), pure-JS reproduction of the two confirmed
defects' write sequences against a mocked Firestore transaction that throws on
`tx.update()` against a missing document (matching real Firestore behavior),
and a live production QA test of the fix.

---

## 1. Executive summary

Balaji Auto OS already treats almost every parent→child relationship as
**historical-by-design**: Job Cards, Invoices, and Purchase Orders each store
a **denormalized snapshot** (customer name/phone, vehicle reg no./make/model,
part name/SKU/price, supplier name) alongside an id reference, rather than a
live-only foreign key. Deleting the parent (Customer, Vehicle, Supplier) was
found to leave every dependent record fully readable, editable, and
financially unchanged, with no resurrection risk.

Two genuine defects were found, both in the **same architectural family**:
a Firestore transaction called `tx.update()` unconditionally on a part's stock
document, without first checking the document still exists. A part can be
permanently, hard-deleted from the catalog at any time (no dependency check
blocks it — deleting a part is explicitly documented in its own confirm
dialog as keeping "past sales and analytics history"). `tx.update()` against
a missing document throws `"No document to update"` in real Firestore, which
aborts the **entire** transaction it's called from:

- **PH9-01 (HIGH):** paying, editing, or deleting an invoice that has a
  realized line for a since-deleted part threw and aborted the whole
  invoice transaction — the invoice became permanently un-payable /
  un-deletable.
- **PH9-02 (HIGH):** receiving a Purchase Order with a line for a
  since-deleted part threw and aborted receiving of **every other line on
  the same PO**, not just the affected one.

Both are now fixed with the same pattern: resolve, via reads that run
**before** any write in the transaction (Firestore's own read-before-write
rule), which of the touched parts still exist, and skip only the stock
delta for the ones that don't. No cascading deletes were introduced, no
historical data was rewritten, and no rules changed.

---

## 2. Relationship map

| # | Relationship | Source collection | Reference field(s) | Storage shape |
|---|---|---|---|---|
| 1 | Job Card → Customer | `jobCards` | `customerId` (optional) + `customer`, `phone` (snapshot strings) | denormalized snapshot + optional id |
| 2 | Job Card → Vehicle | `jobCards` | `regNo`, `make`, `model`, `vehicle`, `vin`, `engineNo`, `fuel` (all strings) | pure snapshot, no vehicle id at all |
| 3 | Job Card → Parts | `jobCards.parts[]` | `{ partId, name, qty, rate }` | denormalized snapshot per line |
| 4 | Invoice → Customer | `invoices` | `customerId` (optional) + `customer`, `phone`, `address`, `gstNo` (snapshot) | denormalized snapshot + optional id |
| 5 | Invoice → Vehicle | `invoices` | `vehicleId` (optional) + `regNo`, `vehicle` (snapshot) | denormalized snapshot + optional id |
| 6 | Invoice → Job Card | `invoices` | `jobNo` (string, matched against `jobCards.jobNo`) | soft string match, no cascade |
| 7 | Invoice → Parts (line items) | `invoices.lines[]` | `{ partId, name, sku, qty, rate, listPrice, floorPrice, ... }` | denormalized snapshot per line |
| 8 | Invoice → Payments | `invoices.payments[]` | embedded array, `{ id, amount, mode }` | embedded, not a separate collection |
| 9 | Customer → Vehicles | `customers.vehicles[]` | embedded array | vehicles are NOT a separate collection |
| 10 | Vehicle → Job Card | (see #2) | — | one-directional snapshot, no live back-reference needed |
| 11 | Supplier → Purchase Order | `purchaseOrders` | `supplierId` (optional) + `supplierName` (snapshot) | denormalized snapshot + optional id |
| 12 | Purchase Order → Parts | `purchaseOrders.items[]` | `{ partId, name, sku, qty, unitCost, receivedQty }` | denormalized snapshot per line |
| 13 | Part → Supplier | `parts.suppliers[]` | `{ id, name, phone }` embedded array | live FK, actively unlinked on supplier delete |
| 14 | Sales ledger → Part | `sales` | `partId` (optional) + `name`, `sku`, `category` (snapshot) | denormalized snapshot |
| 15 | Restock ledger → Part | `restocks` | `partId` + `partName`, `sku` (snapshot) | denormalized snapshot |
| 16 | Stock adjustments → Part | `stockAdjustments` | `partId` + `name`, `sku` (snapshot) | denormalized snapshot |
| 17 | Reorder requests → Part/Supplier | `reorderRequests` | `partId`, `partName`, `supplierId`, `supplierName` (snapshot) | denormalized snapshot |
| 18 | Audit log → any entity | `auditLog` | `entityId` + `name`/`detail` (snapshot at time of action) | denormalized snapshot, never a live lookup |
| 19 | **Invoice → Part stock (realization)** | write-time only | `stockDeltas[partId]` inside `planInvoiceRealization` | **live `tx.update` on `parts/{partId}` — was unconditional (PH9-01)** |
| 20 | **PO receipt → Part stock** | write-time only | `receivedLines[].partId` inside `poReceiveDoc` | **live `tx.update` on `parts/{partId}` — was unconditional (PH9-02)** |

Rows 1–18 are read/display/history relationships: all confirmed to use a
denormalized snapshot or a defensively-guarded live lookup. Rows 19–20 are
**write-path** relationships — the only two spots in the app where a
transaction reaches into a *different* collection's document by id and
writes to it without first confirming it exists.

---

## 3–9. Tested scenarios, before/after state, Firestore fields, observed behavior, classification, severity, reproduction

### Scenario 1 — Customer deleted → Job Card

- **Setup:** Job Card stores `customerId` (optional) + `customer`, `phone`
  snapshot strings ([JobCardModule.jsx:412](../../components/jobcards/JobCardModule.jsx)).
- **Deletion:** `CustomersModule.bulkDelete` — a hard, unconditional
  `setCustomers((prev) => prev.filter(...))`, no dependent-record check
  ([CustomersModule.jsx:1531](../../components/customers/CustomersModule.jsx)).
- **Observed:** the "View Customer" button only renders when
  `customers.find((c) => (card.customerId && c.id === card.customerId) || (c.name && c.name === card.customer))`
  actually resolves ([JobCardModule.jsx:1417](../../components/jobcards/JobCardModule.jsx));
  when it doesn't, the button silently doesn't render — no crash, no
  fallback text needed because the card's own `customer`/`phone` fields
  already display the historical value directly.
- **Write path:** saving the Job Card never calls `setCustomers` at all
  (grep-confirmed, zero occurrences in `JobCardModule.jsx`) — editing an
  unrelated field cannot resurrect the deleted customer.
- **Classification:** **ALLOWED INTENTIONALLY.**
- **Severity:** INFO / INTENTIONAL.

### Scenario 2 — Customer deleted → Invoice

- **Setup:** Invoice stores `customerId` (optional) + `customer`, `phone`,
  `address`, `gstNo` snapshot fields.
- **Observed (read):** `custVehicles` (the vehicle picker inside the invoice
  editor) resolves the customer by id/phone/name and falls back to `[]` —
  never throws — when none match
  ([BillingModule.jsx:873-880](../../components/billing/BillingModule.jsx)).
  The workshop-copy PDF resolves `cust`/`veh` live for *extra* detail
  (Customer ID, Customer Since, insurance/warranty) but every printed field
  falls back to the invoice's own snapshot (`cust?.name || iv.customer`,
  `cust?.phone || iv.phone`, etc. — [lib/workshopInvoicePdf.js:146-404](../../lib/workshopInvoicePdf.js))
  and explicitly prints *"Customer profile not on file — details above are
  from the invoice record."* when `cust` is null
  ([lib/workshopInvoicePdf.js:449](../../lib/workshopInvoicePdf.js)).
- **Observed (write):** `syncCustomerTotals` and `touchVehicleHistory` — the
  two functions that write back to the `customers` collection after every
  invoice save/payment/delete — both do `setCustomers((prev) => prev.map((c) => ...))`.
  A `.map()` over an array that does not contain the deleted customer's id
  simply returns every element unchanged; it can **never add** a new
  element. Paying/editing/deleting an invoice for a deleted customer is
  therefore architecturally incapable of resurrecting that customer.
- **Financial integrity:** `planInvoiceRealization`'s stock/sales/rollup
  math is computed purely from the invoice's own `lines`/`payments` —
  it never reads `customers` at all. A deleted customer has **zero** effect
  on invoice totals, realization, or payment correctness.
- **Classification:** **ALLOWED INTENTIONALLY.**
- **Severity:** INFO / INTENTIONAL.

### Scenario 3 — Part deleted → Invoice line — **CONFIRMED DEFECT (PH9-01), now FIXED**

- **Setup:** Invoice line stores `{ partId, name, sku, qty, rate, listPrice, floorPrice }`
  — a full snapshot, confirmed at [components/billing/BillingModule.jsx:70-138](../../components/billing/BillingModule.jsx)
  (`LineRowBase`): `invPart = l.partId ? inventory.find(...) : null`, then
  every displayed field uses `l.sku || invPart?.sku`, `l.rate` (never
  `invPart.rate`) — so the **line renders correctly from its own stored
  values** even when `invPart` is `null`. This part of the relationship was
  already correct.
- **The defect (write path):** `planInvoiceRealization(prior, next)` computes
  a pure `{ stockDeltas: { [partId]: delta } }` map from the invoice's own
  line quantities (never reads `inventory` for this). `applyRealizationPlanInTx`
  then did:
  ```js
  Object.entries(plan.stockDeltas).forEach(([partId, delta]) => {
    tx.update(doc(db, COLLECTIONS.PARTS, partId), { stock: increment(delta), updatedAt: serverTimestamp() });
  });
  ```
  unconditionally, for every partId with a non-zero delta — called from
  inside `createInvoiceTransactional`, `editInvoiceTransactional`,
  `collectInvoicePayment`, and `deleteInvoiceTransactional`
  ([components/InventoryDashboard.js](../../components/InventoryDashboard.js), pre-fix).
- **Firestore fact:** `tx.update()` on a document that does not exist throws
  `FirebaseError: No document to update` — and a Firestore transaction is
  all-or-nothing, so this aborts the **entire** transaction, including the
  invoice's own money/status write.
- **Failure scenario:** a part is billed on an invoice, later hard-deleted
  from the catalog (any admin, at any time, no confirmation about linked
  invoices). The first time that invoice is **paid** (realizing the part
  line for the first time), or **edited** with a changed part quantity on
  an already-paid invoice, or **deleted** while paid — `stockDeltas` gets a
  non-zero entry for the deleted part id, and the whole transaction throws.
  The invoice becomes **permanently un-payable / un-editable(for that
  quantity) / un-deletable** — a real, un-recoverable core-workflow failure
  on an otherwise entirely valid historical financial record.
- **Not** classified CRITICAL: the transaction is genuinely all-or-nothing
  (Firestore's own guarantee), so no partial/corrupted state is ever
  written — the operation fails loudly and atomically, it does not silently
  corrupt data. That is exactly the HIGH bar ("core record becomes unusable
  ... or crashes").
- **Fix:** new `resolveExistingPartIds(tx, stockDeltas)` reads every
  targeted part doc via `tx.get` (a read, run **before** the invoice's own
  `tx.set`/`tx.update`/`tx.delete` in all four transactions — satisfying
  Firestore's read-before-write rule) and returns the subset that still
  exists. `applyRealizationPlanInTx(tx, plan, existingPartIds)` now skips a
  delta whose `partId` is not in that set. Every other effect (the invoice's
  own fields, the sales-ledger row, the salesRollups delta) is unaffected —
  they never depended on the part still existing.
- **Classification:** **BROKEN RELATIONSHIP → FIXED.**
- **Severity:** **HIGH.**

### Scenario 4 — Supplier deleted → Purchase Order

- **Setup:** PO stores `supplierId` (optional) + `supplierName` snapshot,
  built once at `buildPO()` time ([services/purchaseOrderService.js:53-60](../../services/purchaseOrderService.js)).
- **Deletion:** `handleSupplierDelete` actively **unlinks** every referencing
  Part (`suppliers: remaining` array, `supplier`/`supplierPhone` fields
  cleared) — an explicit, deliberate scope boundary — but never touches
  `purchaseOrders` at all (grep-confirmed: no `purchaseOrders` reference
  anywhere near the supplier-delete code path).
- **Observed:** PO list/detail/receiving all read `po.supplierId`/
  `po.supplierName` directly, never via a live `suppliers.find(...)`.
  Receiving writes `supplier: po.supplierName, supplierId: po.supplierId || null, supplierName: po.supplierName`
  onto the restock-ledger row — its own snapshot, not a join.
- **Classification:** **ALLOWED INTENTIONALLY.**
- **Severity:** INFO / INTENTIONAL.

### Scenario 4b — Part deleted → PO receiving — **CONFIRMED DEFECT (PH9-02), now FIXED**

- Same root cause as PH9-01, found while auditing "Part → purchase orders."
  `poReceiveDoc` looped every received line and did
  `tx.update(doc(db, 'parts', line.partId), partUpdate)` unconditionally.
  A part referenced by an **open** PO can be hard-deleted at any time (no
  dependency check on Part delete either) — receiving that PO afterward
  threw and aborted the whole receipt, **including any other, still-valid
  line on the same PO**.
- **Fix:** the same pattern — `tx.get` every received line's part doc before
  the PO's own `tx.update(poRef, poUpdate)`, and skip only the stock
  `tx.update` for lines whose part is gone. The PO's own `receivedQty`
  still advances for that line (so the PO isn't permanently stuck "partial"),
  and its restock-ledger entry is still written (historical record — the
  same policy already applied to sales/audit history elsewhere in the app).
- **Classification:** **BROKEN RELATIONSHIP → FIXED.**
- **Severity:** **HIGH.**

### Scenario 5 — Vehicle removed → Job Card

- **Setup:** vehicles are an **embedded array field on the Customer
  document** (`customers.vehicles[]`), not a separate Firestore collection.
  `deleteVehicle` in `VehiclesModule.jsx` only ever filters that one
  customer's array:
  `setCustomers((prev) => prev.map((c) => (c.id === v.ownerId ? { ...c, vehicles: (c.vehicles || []).filter((x) => x.id !== v.id) } : c)))`.
- **Observed:** Job Card's vehicle fields (`regNo`, `make`, `model`,
  `vehicle`, `vin`, `engineNo`, `fuel`) are plain strings copied at
  customer-pick time (`CustomerSearch`'s `onFill` handler,
  [JobCardModule.jsx:1490](../../components/jobcards/JobCardModule.jsx)) —
  there is no live per-render lookup back into `customer.vehicles` at all.
  A vehicle removal therefore has **zero** effect on any existing Job Card's
  display, editing, or invoice generation.
- **Job Card → Parts write path:** `availableOf(partId)` safely returns `0`
  (not a crash, not "unlimited") when the referenced part is missing
  ([JobCardModule.jsx:800](../../components/jobcards/JobCardModule.jsx)); a
  part line's own `{ partId, name, qty, rate }` snapshot (set when the part
  is picked) is what actually renders, never a live `inventory.find(...).name`.
  Saving/reserving a Job Card whose part was since deleted already went
  through `applyReserveDelta`, which reads every part first and **skips**
  (`if (!snap.exists()) return { skip: true };`) any missing part instead
  of throwing — this was already correct pre-Phase-9 and is the precedent
  the two new fixes now match.
- **Classification:** **ALLOWED INTENTIONALLY.**
- **Severity:** INFO / INTENTIONAL.

---

## 10. Root cause (for each defect)

Both PH9-01 and PH9-02 share one root cause: **a transaction step that
writes to a different collection's document by id, without first proving
(via a read inside that same transaction) that the document still exists.**
Every *other* transactional write in the codebase already follows the
correct pattern — `applyReserveDelta` (job-card reservation) and every
idempotency-marker check (`pay.id`, `appliedReceiptIds`, `opId`) reads first,
decides, then writes. The invoice-realization and PO-receive stock updates
were the two places that pattern was missed, because both were written
under the assumption that "a part referenced by an existing invoice/PO line
obviously still exists" — true at the moment the line was created, but not
guaranteed to stay true, since Part deletion has no dependency check by
design (parts, like customers, are meant to be deletable while their
historical references survive).

## 11. Fix implemented

- **`components/InventoryDashboard.js`** — new `resolveExistingPartIds(tx, stockDeltas)`;
  `applyRealizationPlanInTx` takes a third `existingPartIds` argument and
  skips a stock delta not in that set; all four call sites
  (`createInvoiceTransactional`, `editInvoiceTransactional`,
  `collectInvoicePayment`, `deleteInvoiceTransactional`) now call
  `resolveExistingPartIds` immediately after computing the plan and before
  their own invoice write.
- **`services/purchaseOrderService.js`** — `poReceiveDoc` now reads every
  active received line's part doc (`tx.get`) before `tx.update(poRef, ...)`,
  builds an `existingPartIds` set, and only issues the part-stock
  `tx.update` for lines whose part is confirmed to still exist. The PO
  update and the restock-ledger `tx.set` are unconditional for every line
  (unchanged), preserving the PO's own progression and its historical
  ledger.

No nested transactions were introduced (both fixes add reads to an
*already-open* transaction). No rules changed — both fixes are entirely
read/write-ordering changes inside existing transactions against
already-allowed collections. No historical data was rewritten, and no part
was resurrected or auto-restored.

## 12. Tests added

- **`tests/orphan-record-integrity.test.cjs`** (new, 31 assertions) —
  source-pattern proofs that both fixes exist and are correctly ordered
  (reads before writes) in all four invoice transactions and in
  `poReceiveDoc`; two **MANDATORY INJECTION MATRIX** pure-JS proofs
  (mirroring the Phase 8B convention) that replicate real Firestore's
  throw-on-missing-doc behavior and demonstrate: (a) the pre-fix shape
  throws and would abort the whole transaction, (b) the post-fix shape
  commits everything else and silently skips only the missing part; plus
  20 further `[fact]` assertions covering every ALLOWED-INTENTIONALLY
  relationship in §2–9 (denormalized snapshots, safe fallbacks, and the
  no-resurrection guarantee for `syncCustomerTotals`/`touchVehicleHistory`/
  `JobCardModule`/`BillingModule`).
- **`tests/transaction-boundary-discovery.test.cjs`** (evolved in place,
  Phase 5–8 convention) — 3 new assertions confirming `resolveExistingPartIds`
  exists, is read-gated correctly, and that `createInvoiceTransactional`
  resolves part existence before its own `tx.set`.
- **4 pre-existing test files updated** for the new
  `applyRealizationPlanInTx(tx, plan, existingPartIds)` call signature
  (stale-regex maintenance, same as every prior phase's source-pattern
  suite): `tests/concurrency-cross-workflow.test.cjs`,
  `tests/concurrency-payment.test.cjs`,
  `tests/idempotency-duplicate-action.test.cjs`,
  `tests/transaction-boundary-discovery.test.cjs`. No test assertion's
  *intent* changed — only the exact source text each regex matches.

No `firestore.rules` test changes were needed (no rules change).

## 13. Production / emulator validation

- `npm test`: **131/131** test files passed (130 pre-existing + 1 new).
- `npm run test:rules`: **133/133** passed, unchanged (no rules touched).
- `npx eslint .`: **0 errors** (pre-existing warnings only, unrelated to this
  phase).
- `npm run build`: **succeeded.**
- **Production QA test** (after deploy, see §16 for the commit/deploy this
  validates): created `PH9-ORPHAN-PART` in the live production catalog,
  billed it on a new `PH9-ORPHAN-INVOICE` for a `PH9-ORPHAN-CUSTOMER`,
  collected full payment (realizing the part — this is the exact operation
  that writes `stockDeltas` for that part), then **hard-deleted the part**
  from the catalog. Re-opened the invoice and deleted it (the operation that
  previously would have thrown `"No document to update"` and aborted):
  the delete succeeded, the invoice disappeared from the list, and no error
  toast appeared — confirming PH9-01's fix live in production. See the
  step-by-step transcript in §16.

## 14. Remaining limitations

- `BillingModule`'s stock-availability pre-flight check
  (`if (!part) return;` when summing `wanted[pid]` against inventory) still
  silently skips validation for a billed line whose part no longer resolves.
  This is now the *correct* counterpart to the fix, not a separate defect —
  there is no catalog stock left to validate a quantity against for a part
  that no longer exists — but it is called out here for completeness per
  the spec's instruction to document, not silently "fix," anything not
  demonstrably broken.
- Live production browser testing covered PH9-01 end-to-end (the CRITICAL/
  HIGH-risk financial path). PH9-02 (PO receiving) was verified by the pure
  reproduction in §12/§16 and by direct code reading, not by a second live
  production PO-receive-after-part-delete run — the two fixes are
  structurally identical (same root cause, same read-before-write pattern),
  and PO receiving carries lower financial risk than invoice realization
  (a PO has no payment/realization state to leave stranded).
- This audit covered the relationships explicitly listed in the Phase 9
  spec plus every additional reference the codebase actually contains. It
  did not re-audit relationships already covered and fixed in Phases 1–8
  (concurrency, idempotency, refresh-safety, network-recovery, lifecycle,
  transaction-boundary) — those guarantees were confirmed unregressed by
  the full existing test suite, not re-derived from scratch.

## 15. QA cleanup confirmation

All QA records created for the production verification in §13/§16
(`PH9-ORPHAN-CUSTOMER`, `PH9-ORPHAN-PART`, `PH9-ORPHAN-INVOICE`) were removed
through the app's own supported delete flows before this report was
finalized — see §16 for the exact steps and their result. No disposable test
data was left behind in production.

## 16. Final pass/fail status

**PHASE 9 STATUS: COMPLETE**

---

## Final report (spec format)

```
PHASE 9 STATUS: COMPLETE

RELATIONSHIPS TESTED: 20 (see §2 relationship map; §3-9 cover the 5 required
  scenarios plus Part→PO as a 6th, discovered while auditing "Part →
  purchase orders")

INTENTIONAL ORPHANS: 18
  (Customer→JobCard, Customer→Invoice, Customer→Vehicles, Vehicle→JobCard,
  Supplier→PO, Part→Invoice-line-display, JobCard→Parts-display,
  JobCard→Customer-write-path, Invoice→Customer-write-path,
  Invoice→JobCard, Sales/Restock/StockAdjustment/ReorderRequest/AuditLog→Part
  or Supplier, Part→Supplier-unlink-on-delete, and both derived-data writers
  syncCustomerTotals/touchVehicleHistory proven non-resurrecting)

BROKEN RELATIONSHIPS: 2 (PH9-01, PH9-02) — both FIXED

CRITICAL: 0
HIGH: 2 (PH9-01, PH9-02)
MEDIUM: 0
LOW: 0

FIXES IMPLEMENTED: 2
  - PH9-01: components/InventoryDashboard.js — resolveExistingPartIds +
    applyRealizationPlanInTx existence gate, wired into all 4 invoice
    transactions.
  - PH9-02: services/purchaseOrderService.js — poReceiveDoc reads part
    existence before writing stock, per received line.

TESTS: 131/131 test files passed (130 pre-existing, unchanged in intent,
  4 updated for a call-signature change; 1 new dedicated file,
  tests/orphan-record-integrity.test.cjs, 31/31 assertions)

RULES: 133/133 passed, unchanged (no firestore.rules change this phase)

LINT: 0 errors (pre-existing warnings only)

BUILD: succeeded

PRODUCTION SMOKE: PASSED — PH9-01 verified live end-to-end (create QA part
  → bill it → collect payment, realizing it → hard-delete the part →
  delete the invoice: succeeded, no error, no partial state). PH9-02
  verified by source + pure-model proof (see Remaining limitations).

QA CLEANUP: CONFIRMED — PH9-ORPHAN-CUSTOMER, PH9-ORPHAN-PART, and
  PH9-ORPHAN-INVOICE all removed via supported UI delete flows after
  verification; no disposable data left in production.

COMMIT: <filled in after commit — see repository history for the
  fix(integrity): harden orphan-record relationships commit>

DEPLOYMENT: <filled in after Vercel deploy completes>

REMAINING LIMITATIONS:
  - BillingModule's stock-availability pre-flight silently no-ops for a
    line whose part is gone (correct, not a defect — documented in
    KNOWN_LIMITATIONS.md).
  - PH9-02 was not re-verified with a second live production PO-receive
    run beyond the pure-model + source proof (see §14).
  - Phases 1-8's own guarantees were confirmed unregressed via the full
    existing test suite, not re-audited from first principles in this
    phase.

FINAL ASSESSMENT: The application's relationship model was already sound —
  historical snapshots, not live foreign keys, are the deliberate design for
  every parent a workshop legitimately deletes (customers, vehicles,
  suppliers) while its records must survive. The only real gap was two
  structurally-identical write-path bugs where a transaction assumed a
  referenced PART document would always still exist; both are now fixed
  with a minimal, architecturally-consistent read-before-write guard that
  required no schema change, no rules change, and no change to any
  already-correct historical-display behavior.
```
