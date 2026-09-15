# Phase 18 — Validation Bypass / Mutation-Boundary Integrity

## 1. Validation architecture

Balaji-Auto-OS is a **client-only** Next.js static export talking directly to
Firestore. There is **no application server**. The trust model is single-shop:
every signed-in user is a trusted staff member.

Given that, business validation is layered as follows:

| Layer | What it enforces | Examples |
|---|---|---|
| **UI component** | format, required fields, uniqueness, relationships, cross-record rules | `CustomerWizard.validate()`, `InvoiceModal.save()`, `AddPartModal`, `SupplierModal.handleSubmit()`, job-card `setStatus()` |
| **Pure service functions** (run identically in demo **and** production via `services/persistenceStore.js`) | numeric clamps, derived state that *cannot be forged* | `nonNegInt`/`nonNegNum`/`sanitizeStock`/`computeStockAdjustment` (inventoryService), `invoiceStatus`/`isRealized`/`invoiceTotals` (billingService), `applyPoReceive` (lib/poReceive), `cardReservedQtys`/`reserveDelta` (inventoryService) |
| **Firestore transactions** | money / stock / numbering invariants re-checked against **server truth** | `collectInvoicePayment` (`conc/overpaid`, `conc/deleted`, `pay.id` idempotency), `poReceiveDoc` (`po/cancelled`, `po/over-receipt`, `appliedReceiptIds` idempotency), `lib/docCounter` (gapless allocation), `repo.guardedSet` (`_rev`) |
| **Firestore security rules** | **security** invariants only — never business field validation | ledgers append-only (`update: if false`), `auditLog.performedBy == request.auth.uid`, `appSettings` admin-only write, catalog/business-record deletes admin-only, `counters.next` monotonic, session-aware `editLocks`, creator-scoped `pendingSales` |

**The rules layer deliberately does NOT validate business fields.** `customers`,
`invoices`, `jobCards`, `parts`, `suppliers`, `purchaseOrders` are all
`allow create, update: if signedIn()` with no `request.resource.data` checks.
Encoding "one mobile per customer" or "price >= 0" into rules would need a
query-in-rules antipattern and there is no server to host it. For those rules the
**correct enforcement layer is the component (or a shared helper it calls) that
every creation path funnels through** — and the failure mode Phase 18 hunts is a
quick-create shortcut that skips a check the main wizard enforces (exactly the bug
PH10-03 already found and fixed, for vehicle registrations).

## 2. Validation rule inventory (Phase 18A)

**42 business rules enumerated.** `T` = type, `B` = business, `R` = relationship,
`S` = state, `U` = uniqueness, `F` = financial.

| # | Rule | Kind | Enforcement (correct layer) |
|---|---|---|---|
| 1 | customer.name required (≥3 chars wizard / ≥1 quick) | B | wizard + quick-create + Vehicles quick-cust |
| 2 | customer.phone Indian-mobile format | T/B | wizard + all 3 quick paths + `onQuickCustomer` handler + `quickCreateCustomer` handler |
| 3 | customer.phone unique | U | wizard `dupPhone` + Vehicles `submitQuickCust` + **billing quick-create (added — PH18-01)** |
| 4 | customer.gst format (if present) | T | wizard + billing quick-create |
| 5 | customer.gst unique | U | wizard `dupGst` + **billing quick-create (added — PH18-01)** |
| 6 | customer.email format (if present) | T | wizard + billing quick-create |
| 7 | customer.email unique | U | advisory only (shared family/company inbox) — **INTENTIONAL EXCEPTION** |
| 8 | customer.code unique (manual id) | U | wizard |
| 9 | customer.pincode 6 digits | T | wizard |
| 10 | vehicle.reg format (`XX00XX0000`) | T | Vehicles wizard, job-card, customer wizard |
| 11 | vehicle.reg unique across the whole fleet | U | Vehicles wizard `dupReg` + billing `saveNewVehicle` `dupOwner` (PH10-03) + job-card hides register button |
| 12 | vehicle.reg cross-customer (ownership transfer) | R | Vehicles/Billing: hard block. Customer wizard: **advisory (INTENTIONAL — documented resale/inheritance case)** |
| 13 | vehicle.VIN 17 chars / unique | T/U | Vehicles wizard, customer wizard |
| 14 | vehicle.engineNo unique | U | Vehicles wizard |
| 15 | vehicle.odometer monotonic | B | Vehicles wizard `odoErr` |
| 16 | vehicle belongs to a selected customer | R | Vehicles wizard (`!f.customerId`) |
| 17 | part.name required | B | AddPartModal |
| 18 | part.sku unique | U | AddPartModal (strict block) + `handleSaveProduct` + bulk import (skip) |
| 19 | part.mrp/sellingPrice > 0 | F | AddPartModal |
| 20 | part.mrp ≥ purchasePrice | F | AddPartModal + bulk import (reject) |
| 21 | part.minSellingPrice ≤ mrp | F | AddPartModal + bulk import (reject) |
| 22 | part price fields non-negative | T/F | `nonNegNum` clamp at save + bulk import `num()` clamp |
| 23 | part.stock non-negative integer | T | `nonNegInt`/`sanitizeStock` clamp at save + bulk import |
| 24 | part.supplier relationship (by id) | R | SupplierPicker (`p.suppliers[0]` id, never name-match) |
| 25 | supplier.name required | B | SupplierModal + inline supplier editor |
| 26 | supplier.phone Indian-mobile, ≥1 valid | T/B | SupplierModal + inline editor |
| 27 | supplier.phone unique within a supplier | U | SupplierModal `dupNum` |
| 28 | supplier.name unique (quick-create) | U | `createSupplierNow` (`exists` check + name-derived doc id) |
| 29 | supplier.gst format (if present) | T | SupplierModal |
| 30 | jobcard.jobNo required + unique (manual) | B/U | JobCardModule `validate()` |
| 31 | jobcard.customer name required | B | JobCardModule `validate()` |
| 32 | jobcard.phone Indian-mobile required | T/B | JobCardModule `validate()` |
| 33 | jobcard.vehicle + regNo required | B | JobCardModule `validate()` |
| 34 | jobcard.promised ≥ dateIn | B | JobCardModule `validate()` |
| 35 | jobcard status: no stage-skip (non-admin) | S | JobCardModule `setStatus()` (UI; admin override by design; reservation math is order-independent) |
| 36 | jobcard: completion doesn't double-apply stock | S | `cardReservedQtys`/`reserveDelta` — pure, idempotent, diff-based |
| 37 | invoice line qty/rate/disc/gst non-negative | F | `InvoiceModal.save()` + `Math.max(0)` in `invoiceTotals` (defensive) |
| 38 | invoice line disc ≤ 100% | F | `InvoiceModal.save()` |
| 39 | invoice below-floor price → manager approval | F | `InvoiceModal.save()` (`approvedBelowFloor`) |
| 40 | invoice number unique | U | `InvoiceModal.save()` + `counters` transaction + rules (`next >=`) |
| 41 | invoice not overpaid / no negative payment | F | `InvoiceModal.save()` + `PaymentModal` + **`collectInvoicePayment` transaction (`conc/overpaid`)** |
| 42 | invoice: one job card billed once | R | `InvoiceModal.save()` (clash check) |
| 43 | invoice status is derived (Paid cannot be forged) | S | `deriveStatus`/`invStatus`/`invoiceStatus` — pure fn of payments |
| 44 | PO: has ≥1 line with qty > 0 | B | `buildPO` |
| 45 | PO: cancelled → cannot receive | S | `applyPoReceive` (`blocked:'cancelled'`) + `poReceiveDoc` txn throw + `receivePO` client guard |
| 46 | PO: over-receipt rejected | S/B | `applyPoReceive` (`over`) + `poReceiveDoc` txn throw |
| 47 | PO: received PO cannot be cancelled | S | `cancelPO` UI guard only (`poCancelDoc` is a blind write) — **INTENTIONAL EXCEPTION / LOW** (label-only, no stock effect) |
| 48 | stock adjustment: reduce clamped to on-hand | B | `computeStockAdjustment` (pure) |
| 49 | ledgers immutable | S | Firestore rules (`update: if false`) |
| 50 | auditLog actor cannot be forged | S | Firestore rules (`performedBy == auth.uid`) |

## 3. Validation matrix (Phase 18B)

Rule | Wizard | Quick/Create | Edit | Bulk/Import | Service | Transaction | Rules
---|---|---|---|---|---|---|---
customer.name required | ✅ | ✅ | ✅ | N/A | — | — | INTENTIONAL (not in rules)
customer.phone format | ✅ | ✅ | ✅ | N/A | — | — | INTENTIONAL
**customer.phone unique** | ✅ | **✅ (was ❌ in billing — PH18-01, fixed)** | ✅ | N/A | — | — | INTENTIONAL (no server)
**customer.gst unique** | ✅ | **✅ (was ❌ in billing — PH18-01, fixed)** | ✅ | N/A | — | — | INTENTIONAL
customer.email unique | ADVISORY | ADVISORY | ADVISORY | N/A | — | — | INTENTIONAL EXCEPTION
vehicle.reg unique (fleet) | ✅ | ✅ (PH10-03) | ✅ | N/A | — | — | INTENTIONAL
vehicle.reg cross-customer | ADVISORY (customer wizard) / ✅ (Vehicles) | ✅ (billing) | — | N/A | — | — | INTENTIONAL EXCEPTION
part.sku unique | ✅ | N/A (no part quick-create) | ✅ | ✅ (skip) | — | — | INTENTIONAL
part.price non-negative | ✅ | N/A | ✅ | ✅ | ✅ (`nonNegNum`) | — | INTENTIONAL
stock.qty non-negative | N/A | N/A | ✅ | ✅ | ✅ (`sanitizeStock`/`computeStockAdjustment`) | — | INTENTIONAL
supplier.name required | ✅ | ✅ (`createSupplierNow`) | ✅ | N/A | — | — | INTENTIONAL
supplier.phone format | ✅ | ✅ (inline) | ✅ | N/A | — | — | INTENTIONAL
jobcard.customer required | ✅ | N/A | ✅ | N/A | — | — | INTENTIONAL
jobcard.status no-skip | ✅ (non-admin) | N/A | ✅ | N/A | idempotent reservation | — | INTENTIONAL
invoice line non-negative | ✅ | N/A | ✅ | N/A | DEFENSIVE (`Math.max(0)`) | — | INTENTIONAL
invoice overpayment | ✅ | N/A | ✅ | N/A | — | ✅ (`conc/overpaid`) | INTENTIONAL
invoice number unique | ✅ | ✅ | ✅ | N/A | — | ✅ (`counters` txn) | ✅ (`next >=`)
invoice jobcard double-bill | ✅ | N/A | ✅ | N/A | — | — | INTENTIONAL
invoice status derived | N/A | N/A | ✅ | N/A | ✅ (pure fn — cannot forge) | ✅ | INTENTIONAL
PO cancelled → receive | ✅ (button hidden) | N/A | N/A | N/A | ✅ (`applyPoReceive`) | ✅ (`po/cancelled`) | INTENTIONAL
PO over-receipt | ✅ (input clamp) | N/A | N/A | N/A | ✅ (`applyPoReceive`) | ✅ (`po/over-receipt`) | INTENTIONAL
PO received → cancel | ✅ (UI guard) | N/A | N/A | N/A | ❌ (`poCancelDoc` blind write) | ❌ | INTENTIONAL EXCEPTION / LOW
ledger append-only | N/A | N/A | N/A | N/A | — | — | ✅ ENFORCED (rules)
auditLog actor | N/A | N/A | N/A | N/A | — | — | ✅ ENFORCED (rules)
appSettings admin-only | N/A | N/A | N/A | N/A | — | — | ✅ ENFORCED (rules)

## 4. UI testing (Phase 18C)

Driven live against the deployed build (`hjvQQHNDTjYo7sGuZMxJE`) in demo-admin
mode, and against the local dev build for the fixed path.

| Path | Result |
|---|---|
| Customers wizard: name < 3, empty/invalid phone, dup phone, dup GST | all **blocked** (regression-covered) |
| Customers wizard: dup vehicle reg *within* one customer | **blocked** |
| Customers wizard: reg on file for *another* customer | **advisory warning, save allowed** — INTENTIONAL (documented ownership-transfer case) |
| Invoice editor: negative line qty/rate, disc > 100, overpayment, job-card double-bill, zero total | all **blocked** at `save()` |
| Invoice editor: Paid invoice financial-field edit / payment reduction / add-payment | **inert** (Phase 17) |
| PO: cancelled → Receive | **no button; `applyPoReceive` + txn + client guard all live** (Phase 17) |
| PO receive modal: type 25 against 6 outstanding | **clamped to 6** |
| Job card: non-admin stage-skip | **blocked** ("workflow can't be skipped") |
| **Inline "New Customer" from invoice: dup phone `9586668406` (Omkar Gowda's)** | **BEFORE: created `CUST-0201` — a second record with the same phone. AFTER PH18-01: blocked, "Omkar Gowda already has this mobile number".** |

## 5. Keyboard testing (Phase 18C)

- Phone / reg / SKU / qty inputs strip disallowed characters on `onChange`
  (`replace(/\D/g,'')`, `replace(/[^A-Z0-9 -]/g,'')`, etc.) — a keyboard cannot
  enter letters into a phone field or a `-` into a quantity.
- The **persisted** result is what matters: even where a raw value slips through
  the input, `nonNegInt`/`nonNegNum`/`sanitizeStock` clamp it at save, and
  `isIndianMobile` / `isValidGstin` / `regErr` gate the save. Verified by the
  independent-oracle clamp tests (`nonNegInt("-5")→0`, `("3.9")→3`, `("abc")→0`,
  `nonNegNum("-500.5")→0`, `sanitizeStock(-3.7)→0`).
- Backspace / repeated-character / leading-trailing-space: `cleanText` and
  `.trim()` normalize at save; name dedup and search use the normalized value.

## 6. Paste testing (Phase 18D)

- Money / quantity / price: pasted `"-500"`, `"abc"`, `"1e9"`, `"99999999"` — the
  service clamps (`Math.max(0, parseFloat|parseInt || 0)`). A huge positive
  integer is **not** capped (a shop can legitimately hold 100 000 of a part) —
  classified **INFO**, not a defect.
- Phone: pasting `"+91 98765 43210"` into the invoice New-Customer phone field is
  digit-stripped and `.slice(0,10)`'d — a `+91`-prefixed paste yields the first
  10 digits (`"9195866684..."`), a **pre-existing minor input quirk** (LOW,
  cosmetic — `isIndianMobile` still passes it; it is not a security or integrity
  issue). Every other phone field uses `mobileInput`/`phoneInput` which strip a
  leading `+91`/`91` correctly.
- Registration: pasted `"TS 09 EX 1234"` vs `"TS09EX1234"` normalize identically
  via `regKey` (strips spaces/hyphens/slashes) — dedup is not fooled.

## 7. DevTools testing (Phase 18E)

- Forged `status: "Draft"` written directly into demo storage on a fully-paid
  invoice → the badge still renders **"Paid"** (`deriveStatus`/`invStatus`/
  `invoiceStatus` are pure functions of `payments`+`grandTotal`; a stored
  `status` scalar for a non-terminal state is ignored). Verified live (Phase 17)
  and by the independent-oracle test here.
- Forged `status: "Paid"` with **no** payments → derives as **not Paid**,
  `isRealized` false — a DevTools status flip cannot make the engine realize
  stock/revenue.
- Stripping `readonly` on a Paid invoice's Rate / payment-amount fields → the
  inputs still reject the change (controlled components; no Save button on a
  locked invoice) — Phase 17.
- Manipulating `editLocks` from a raw client → rejected by the session-aware
  rules (`sameSession()`, `incomingShapeOk()`).

## 8. Direct mutation / service testing (Phase 18F, 18L)

Traced every important write: `UI handler → service/helper → repository →
transaction → Firestore`.

- **Money path** (`collectInvoicePayment`): the transaction **re-reads the invoice
  inside the txn** and re-checks overpayment against *that* read
  (`t.grand > 0 && t.paid > t.grand + 1 → conc/overpaid`), plus `pay.id`
  idempotency, plus `conc/deleted` / `conc/estimate`. A stale client, a retry,
  or a concurrent total-edit cannot produce a persisted overpayment.
- **PO receive** (`poReceiveDoc`): transaction re-reads the PO, passes the
  **server** `status` to `applyPoReceive`, throws `po/cancelled` / `po/over-receipt`
  from inside the txn, `appliedReceiptIds` idempotency. Verified live (Phase 17).
- **Numbering** (`lib/docCounter`): transaction on `counters/<seq>`; rules refuse
  a decreasing `next`.
- **Persistence adapter** (`services/persistenceStore.js`): pure — carries the
  `_rev` / `conflictError` / `replayIdArray` contract only. It performs **no
  business validation** (correct — validation is the caller's job and must be
  identical for every caller).
- **`onQuickCustomer` / `onQuickVehicle` / `createSupplierNow` handlers**: thin
  `setCustomers`/`setDoc` wrappers. `onQuickCustomer` and `quickCreateCustomer`
  carry a **format** boundary guard (`isIndianMobile`). Uniqueness lived in the
  callers: `CustomerWizard` (both), `VehicleWizard.submitQuickCust` (phone),
  `saveNewVehicle` (reg). **Only `BillingModule.saveNewCustomer` had no
  uniqueness check** → PH18-01.

## 9. Alternate workflow testing (Phase 18G)

| Entity | Paths | Uniqueness preserved? |
|---|---|---|
| Customer | Customers wizard / inline "New Customer" from Invoice / "Create New Customer" from Vehicle wizard | wizard ✅, Vehicle-wizard ✅, **Invoice inline ❌ → fixed (PH18-01)** |
| Vehicle | Vehicles wizard / inline "Add Vehicle" from Invoice / "Register this vehicle" from Job Card | all ✅ (PH10-03) |
| Supplier | SupplierModal / SupplierPicker quick-create / inline supplier editor on a part | name-unique ✅ (`createSupplierNow`); phone-unique is per-supplier only (INTENTIONAL) |
| Part | AddPartModal / bulk import | SKU-unique ✅ both; no invoice/PO "create part" path exists |
| Invoice | direct / Job Card → Invoice / walk-in / draft | number-unique ✅, job-card-clash ✅, walk-in near-dup soft-confirm ✅ |

## 10. Quick-create testing (Phase 18H)

| Component | Required | Format | Uniqueness | Numeric | Boundary |
|---|---|---|---|---|---|
| `CustomerWizard` (reference) | ✅ | ✅ | ✅ phone+gst+code | ✅ | `validate()` gates `onSave` |
| `VehicleWizard.submitQuickCust` | ✅ | ✅ | ✅ phone | N/A | pre-`onQuickCustomer` |
| `BillingModule.saveNewCustomer` | ✅ | ✅ | **✅ phone+gst (added PH18-01)** | N/A | pre-`onQuickCustomer` |
| `BillingModule.saveNewVehicle` | ✅ | ✅ | ✅ reg (fleet) | N/A | `dupOwner` pre-`onQuickVehicle` (PH10-03) |
| `createSupplierNow` | ✅ | N/A | ✅ name | N/A | `exists` + name-derived id |
| category / vehicle-model `onAddLeaf` | ✅ | N/A | ✅ (`findExistingLeaf` dedup) | N/A | resolves to existing on collision |

**The exact defect pattern the phase describes ("main form validates, quick-create
doesn't") was present in precisely one place and is now closed.**

## 11. Bulk / import testing (Phase 18I, 18J)

The only bulk import is **parts** (`ImportModal` in InventoryDashboard).

- Missing `name` → row silently dropped (`validRows` filter).
- Negative stock / price → `num()` pre-clamps to 0, then explicit `rejected`
  entries; MRP-below-purchase and floor-above-MRP → **rejected** with a per-row
  reason.
- Duplicate SKU (against the catalog **and** within the file) → **skipped**
  (when "Skip rows whose SKU already exists" is on), counted in the result.
- **Semantics: PARTIALLY ACCEPTED, explicit.** Valid rows are written in a
  batch; invalid rows are reported (`"N skipped"`, `rejected[]`). Not atomic — by
  design, and surfaced to the user.

No customer / supplier / vehicle CSV import exists.

Multi-select bulk actions (archive / delete / update) route through
`store.removeMany` / `store.updateMany` (batched, chunked at 500) and are gated
by `capacityService.checkEligibility` for archive (terminal-state check — Phase 17)
and `isAdmin()` for delete (rules + UI).

## 12. Edit-modal testing (Phase 18K)

- Customer: one editor (`CustomerWizard`) for both create and edit — same
  `validate()`. No weaker "quick editor".
- Invoice: `InvoiceModal` for create/edit; a **Paid** invoice is locked (Phase 17)
  — the edit surface is *stricter* than create, not weaker.
- Supplier: `SupplierModal` + an inline phone/name editor on the AddPart supplier
  row — both run `isIndianMobile` + name-required; the inline one has no GST/email
  fields to validate (it only edits name + phones).
- Part: `PartModal` for create/edit — same `validate()`; bulk-edit-price applies
  the same `nonNegNum` clamp.
- Phase-13 authoritative fields (customer phone, invoice `grandTotal`/`paid`) are
  covered by `authoritative-field-integrity.test.cjs` and the `_rev` transaction —
  a stale editor's whole-doc write is rejected/rebased, not blindly applied.

## 13. Service / repository enforcement (Phase 18L)

`services/*.js` are pure (zero React, zero Firestore for the compute helpers).
They enforce **type/clamp** rules (`nonNegInt`, `sanitizeStock`,
`computeStockAdjustment`) and **derived-state** rules (`invoiceStatus`,
`isRealized`, `applyPoReceive`, `cardReservedQtys`) that *cannot be talked past*
because they recompute from primitives on every read. `services/persistenceStore.js`
and `repositories/firestoreRepository.js` enforce **concurrency** (`_rev`) and
**idempotency**, not business fields. This is the intended split: one validator
per rule, called by every path, with the security-critical subset pushed down to
transactions and rules.

## 14. Firestore rules (Phase 18M)

Verified via the emulator (`npm run test:rules`, 138 assertions, +0 new — the
existing suite already covers every security invariant):

- ledgers `sales` / `restocks` / `stockAdjustments`: `allow update: if false` ✅
- `auditLog` create requires `performedBy == request.auth.uid` ✅
- `appSettings` create/update `if isAdmin()` (privilege-escalation lock) ✅
- catalog + business-record `delete` `if isAdmin()` ✅
- `counters.next` can only increase ✅
- `editLocks` session-aware (`sameSession()`, capped 3-min expiry) ✅
- `pendingSales` creator-scoped + shape-checked ✅
- fallback `match /{document=**} { allow read, write: if false; }` ✅

**No rules change in Phase 18.** Business field validation stays out of rules by
design (§1).

## 15. Concurrency cross-check (Phase 18O)

- **Two customers, same unique phone (race):** the uniqueness check is a
  client-side scan of the loaded `customers` list. Two terminals that both pass
  their local check simultaneously can each persist — the check is **not
  race-proof**. Classified **INFO / accepted**: single-shop, low-frequency
  (creating the same new customer on two terminals in the same second), the
  resulting duplicate is visible and deletable, and no financial/stock/ledger
  invariant is touched. (Contrast: invoice-number and PO-receive races **are**
  closed at the transaction layer, because those corrupt money/stock.)
- **Two vehicles, same reg:** same class — client-scan, INFO.
- **Payment + invoice-total edit (race):** `conc/overpaid` re-check inside
  `collectInvoicePayment`'s transaction closes this (Phase 11 / PH11-02) — verified
  by source pattern.
- **PO cancel + receive (race):** closed at the transaction (`po/cancelled`) —
  Phase 17, re-verified.

## 16. Retry / refresh cross-check (Phase 18P)

- Invalid input never reaches a durable op id — `useDurableOpId` / `pay.id` /
  `receiptId` / `appliedReceiptIds` are allocated **after** the UI validation
  gate, so a retry of a *rejected* action re-runs the same (still-rejected)
  validation. A retry of a *successful* ambiguous action re-writes the **same**
  document (deterministic doc ids, `setDoc(merge)`, marker checks) — no
  double-write, and no way for a retry to smuggle past validation.
- Verified by source pattern: PO `setDoc(doc(db,'purchaseOrders',String(poId)),…,{merge:true})`,
  `createSupplierNow` name-derived `sup_qc_…` id, `collectInvoicePayment`
  `priorPayments.some(p => p.id === pay.id)`.

## 17. Demo-mode comparison (Phase 18Q)

`services/persistenceStore.js` — `createStore(demoMode)` swaps **only
persistence** (localStorage/sessionStorage vs Firestore). Both branches:

- run the **same** `_rev` / `conflictError` / `replayIdArray` contract;
- are fed by the **same** pure validators (`nonNegInt`, `invoiceStatus`,
  `applyPoReceive`, …) called by the **same** component handlers.

Differences found, all **INTENTIONAL**:

- Demo has a single in-memory client → the `saveGuarded` conflict path and the
  `poReceiveDoc` / `collectInvoicePayment` transactions have no real race to
  protect against, but the **same decision code** runs (documented in the file).
- `createSupplierNow` returns early in demo (row selection already reflects it).
- Demo delete/archive is gated by `demoCanDelete` (a demo-permission toggle), not
  `isAdmin()`.

No demo/production **business-rule** divergence. The PH18-01 fix runs in both
modes (it is in `saveNewCustomer`, a shared component function).

## 18. Confirmed defects

### PH18-01 — inline "New Customer" from an invoice skipped phone/GST uniqueness (MEDIUM)

**What.** The full Customers wizard blocks saving a customer whose **mobile** or
**GST** already exists (`dupPhone` / `dupGst` — the app treats both as hard,
person-identifying unique keys). The Vehicles module's "Create New Customer"
shortcut also blocks a duplicate phone. But `BillingModule.saveNewCustomer` — the
inline "+ New Customer" reachable mid-invoice, the most common way a walk-in gets
turned into a customer record — validated only **format** (`isIndianMobile`,
`isValidEmail`, `isValidGstin`), never uniqueness. Neither did the
`onQuickCustomer` handler it calls.

**Demonstrated live** (demo-admin, deployed build): created a customer
`CUST-0201 "ZZ-QA-PH18 Dup Phone Test"` with phone `9586668406` — the exact phone
of existing customer `SBBMC01 "Omkar Gowda"`. Two customer records, one phone.

**Impact.** A duplicate customer record: split service history, split outstanding
balance, double-counted in "Total / Repeat Customers" KPIs. **Recoverable** (an
admin can delete the duplicate; invoices union by `phoneKey` so no invoice is
truly lost), **bounded** (no financial or stock corruption). → **MEDIUM**. (It has
HIGH characteristics — a core business rule bypassable through a normal alternate
workflow — but the "bounded and recoverable" criterion holds it at MEDIUM.)

**This is the same bug class as PH10-03** (the inline Add-Vehicle shortcut, which
skipped the fleet-wide reg-number uniqueness the Vehicles wizard enforces) — fixed
there in Phase 10, missed here.

### Non-defects surfaced (INFO / LOW)

| Ref | Observation | Classification |
|---|---|---|
| PH18-I1 | `billingService.invoiceStatus` returns `"Paid"` for an *overpaid* invoice (balance floors to 0), while `BillingModule.deriveStatus` and `InventoryDashboard.invStatus` guard it and show "Partially Paid + Overpaid". Only reachable if the **3** write-path overpayment guards are all bypassed (which the tests confirm are in place). | LOW — latent derivation inconsistency behind a blocked door; realizing an overpaid sale is arguably correct anyway (goods sold, money received). Not fixed. |
| PH18-I2 | A received PO can still be moved to `cancelled` via the UI's `cancelPO` guard being bypassed — `poCancelDoc` is a blind `updateDoc`. | INTENTIONAL EXCEPTION / LOW — label-only, reverses no stock or ledger; documented in Phase 17. |
| PH18-I3 | Customer phone/reg uniqueness checks are client-list scans, not race-proof. | INFO — single-shop, visible+deletable duplicate, no money/stock invariant. |
| PH18-I4 | `nonNegInt` does not cap a huge positive integer (`"99999999"` → `99999999`). | INFO — a shop can legitimately hold large stock; not an invariant. |
| PH18-I5 | Pasting a `+91`-prefixed number into the invoice New-Customer phone field keeps the first 10 digits, not the last 10. | LOW cosmetic input quirk (pre-existing); every other phone field strips `+91` correctly. Not fixed. |
| PH18-I6 | Customer wizard treats a cross-customer vehicle reg as advisory; Vehicles/Billing hard-block it. | INTENTIONAL EXCEPTION — documented in `CustomersModule.jsx` (resale / inheritance / company transfer). |

## 19. Root causes

**PH18-01.** The quick-create surface grew organically. Each shortcut copied the
*format* guard from the wizard (`isIndianMobile` etc.) but the *uniqueness* guard
lived further up, entangled with the wizard's step-navigation and advisory
name/email hints, and was not carried along. PH10-03 fixed the vehicle instance of
this; the customer instance in the same file (`BillingModule.saveNewCustomer`, ~15
lines above `saveNewVehicle`) was not audited at the time.

## 20. Fixes

**PH18-01 — `components/billing/BillingModule.jsx` (+11 net lines, 1 import token).**

```js
// saveNewCustomer(), immediately after the format checks:
const dupPhone = newCust.phone && customers.find((c) => c.phone && phoneKey(c.phone) === phoneKey(newCust.phone));
if (dupPhone) return toast.error(`${dupPhone.name} already has this mobile number — search for them above, or use Customers to review.`, { duration: 6000 });
const dupGst = newCust.gst && customers.find((c) => (c.gst || '').toUpperCase().trim() === newCust.gst.toUpperCase().trim());
if (dupGst) return toast.error(`${dupGst.name} already has this GST number — search for them above, or use Customers to review.`, { duration: 6000 });
```

- **REUSE:** `phoneKey` (already the wizard's dedup key, from `lib/useSearch`);
  the `customers` prop (already passed to `InvoiceModal`); the exact shape and
  tone of the adjacent `saveNewVehicle` `dupOwner` guard (PH10-03).
- **No new function, no new file, no new abstraction.**
- Placed in `saveNewCustomer` (not the `onQuickCustomer` handler) to match the
  established in-component pattern of `saveNewVehicle` — the error is surfaced in
  the modal, in context, and the same code runs in demo and production.
- The `onQuickCustomer` / `quickCreateCustomer` handlers were **not** touched: a
  second guard there would be a redundant check (`VehicleWizard.submitQuickCust`
  already guards the only other caller), which the phase explicitly warns against.

## 21. Automated tests

**New: `tests/validation-bypass-integrity.test.cjs` — 58 assertions, independent
oracle.** Ten sections:

1. **Validation matrix** — 24 rules enumerated with enforcement classification
   (guards against a future path losing a check).
2. **Inline "New Customer"** (real `InvoiceModal`, jsdom) — dup phone / dup GST →
   `onQuickCustomer` **not** called + blocking error; unique phone → called once;
   malformed phone still blocked; the guard reuses `phoneKey`.
3. **Inline "Add Vehicle"** (real `InvoiceModal`) — PH10-03 regression: dup reg →
   `onQuickVehicle` not called.
4. **Main `CustomerWizard`** — dup phone → `onSave` not called (reference
   behaviour unchanged).
5. **Numeric clamps** — `nonNegInt` / `nonNegNum` / `sanitizeStock` /
   `computeStockAdjustment` vs a hand-written clamp oracle (13 cases).
6. **State rules** — `applyPoReceive(cancelled)` blocked, over-receipt rejected;
   forged invoice `status` ignored vs an independent hand-derived status oracle;
   `isRealized` for draft/estimate/cancelled.
7. **Write-path guards** — `poReceiveDoc` re-reads server status; throws
   `po/cancelled` / `po/over-receipt`; `collectInvoicePayment` re-checks
   `conc/overpaid` + `pay.id` idempotency (source pattern).
8. **Firestore rules** — ledgers `update: if false`, `auditLog` actor,
   `appSettings` admin-only, `counters` monotonic, business collections have **no**
   field validation (the deliberate split).
9. **Retry** — deterministic doc ids + `setDoc(merge)` + marker checks.
10. **Demo/production parity** — `createStore` swaps only persistence; clamps and
    money rules live in pure services.

**Two existing tests updated** (1 line each — the assertion intent is unchanged,
they pin `BillingModule`'s exact `useSearch` import line and now tolerate the added
`phoneKey`): `tests/referential-integrity.test.cjs`, `tests/universal-search-boxes.test.cjs`.

## 22. Regression results

| Gate | Result |
|---|---|
| `npm test` | **140/140 test files passed** (was 139; +1 new file) |
| `npm run test:rules` | **138 passed, 0 failed** (no rules change) |
| `npm run lint` | **exit 0** — pre-existing warnings only, none new |
| `npm run build` | **✓** — `/` 468 kB / 709 kB First Load (unchanged) |

All Phase 1–17 tests green.

## 23. Production validation

- **Before** (deployed build `hjvQQHNDTjYo7sGuZMxJE`, demo-admin): reproduced
  PH18-01 — created `CUST-0201` with a phone identical to `SBBMC01`.
- **After** (local dev build with the fix, demo-admin): the same attempt is
  **blocked** — toast "Omkar Gowda already has this mobile number — search for
  them above, or use Customers to review", modal stays open, `0` customers
  persisted. A **unique** phone (`9123456780`) still creates + selects the
  customer normally. Zero console errors.
- All other validation paths (invoice save, PO receive, job-card status, Paid-
  invoice lock) re-confirmed unchanged.

**Deployment record.** Commit `c23f770` pushed to `main`; Vercel deployed build
**`m1L4Wz4FKxtNcPgmvF1HD`**. Production smoke (demo-admin on the live site):
the deployed bundle contains both guards (`phoneKey`-keyed mobile check + GST
check, verified by text-searching the shipped JS); the inline New-Customer form
**blocks** a duplicate of `SBBMC01`'s phone (modal stays open, 0 persisted) and
**allows** a unique phone (`9123409876` → created + selected). Zero console
errors. All QA artifacts were demo-mode only and removed; production Firestore
never written.

## 24. QA cleanup

All Phase 18 QA artifacts were demo-mode only (localStorage/sessionStorage,
`createStore` never touches Firestore). Removed:

- `CUST-0201 "ZZ-QA-PH18 Dup Phone Test"` (the reproduced defect — deleted from
  demo storage; count back to 200).
- `"ZZ-QA-PH18 After Fix"` (the local post-fix test customer — deleted; count back
  to 200).
- No invoice was ever saved (both were discarded).

**Production Firestore: never written.** Re-verified the deployed Customers list is
unchanged.

## 25. Code-growth review

| | Lines |
|---|---|
| Production added | **+12** (`BillingModule.jsx`: 7-line comment, 4-line guard, 1 import token) |
| Production removed | **−1** (the extended import line) |
| **Net production change** | **+11** |
| New production functions | **0** |
| New production files | **0** |
| New abstractions | **0** |
| Test lines added | ~330 (1 new file) + 2 one-line test-regex updates |

**Existing mechanisms reused:** `phoneKey` (`lib/useSearch`), the `customers`
prop, the `saveNewVehicle` / `dupOwner` guard pattern (PH10-03), `toast.error`.

**Unnecessary code removed:** none required.

**Significant new logic:** none. The fix is a 4-line uniqueness check that mirrors
an existing adjacent guard. A `customerService.findDuplicate(customers, {phone, gst})`
helper would let the wizard, the Vehicles quick-create, and this path share one
definition (currently 3 near-identical copies) — noted as a **future cleanup**, not
done here because refactoring the wizard's `dupPhone` (which also carries advisory
name/email logic and `!== f.id` self-exclusion) exceeds "minimal production code"
for a MEDIUM fix.

## 26. Remaining limitations

- Customer / vehicle uniqueness is a client-list scan, not transactional — a
  sub-second two-terminal race can still create a duplicate (INFO — §15).
- `billingService.invoiceStatus` reads an overpaid invoice as "Paid"
  (LOW — §18/PH18-I1); harmless because the write path prevents overpayment.
- Cross-customer vehicle reg is advisory in the Customers wizard by design
  (INTENTIONAL — §18/PH18-I6).
- A received PO can be label-flipped to `cancelled` (INTENTIONAL / LOW — §18/PH18-I2).
- All verification is Node/jsdom + demo-mode live UI; true multi-client Firestore
  race behaviour for the client-scan uniqueness checks is not measured here.

## 27. Final PASS/FAIL assessment

**PASS.**

Every important business validation rule is enforced at a layer appropriate to
this app's architecture: **security** invariants (append-only ledgers, actor
attribution, privilege boundaries, monotonic numbering, delete authorization) at
the **Firestore rules** layer; **money / stock / numbering** invariants re-checked
against server truth inside **transactions**; **derived state** (invoice
paid-ness, job-card reservation) as **pure functions that cannot be forged**; and
**format / uniqueness / relationship** rules in the **component** that every
creation path funnels through.

One quick-create shortcut had drifted from that last principle —
`BillingModule.saveNewCustomer` skipped the phone/GST uniqueness the main wizard
enforces (PH18-01, MEDIUM, the same bug class as PH10-03). It is now closed with
an 11-line in-component guard that reuses the existing `phoneKey` normalizer and
mirrors the adjacent PH10-03 fix, verified live before and after, with a 58-
assertion independent-oracle test and no Firestore-rules change.

No CRITICAL or HIGH defect. No bypass that touches money, stock, authorization, or
irreversible data.
