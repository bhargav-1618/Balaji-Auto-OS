# PHASE 10 — Referential-Integrity Audit Report

**Repository:** github.com/bhargav-1618/Balaji-Auto-OS
**Production:** https://balaji-auto-os.vercel.app
**Branch:** main
**Builds on:** Phase 9's orphan-record audit (`docs/testing/PHASE_9_ORPHAN_RECORD_REPORT.md`),
which already mapped every collection's reference fields and confirmed the
denormalized-snapshot design for parent deletion. Phase 10 asks the
complementary question: independent of deletion, does every relationship
always get **created, edited, and looked up** against the entity the user
actually intended — never a stale one, a name/phone collision, a recycled
number, or a duplicate?

---

## 1. Executive summary

Three confirmed referential-integrity defects were found and fixed, all in
the same family — **a relationship resolved by a mutable, reusable, or
ambiguous field instead of a stable id, with no fallback check against
collision**:

- **PH10-01 (HIGH):** Job Card numbers (`jobNo`) double as both the
  Firestore document id for job cards *and* the sole link field an invoice
  uses to find "its" job card. `nextJobCardNumber` only scanned currently
  *existing* job cards, so deleting the highest-numbered job card let its
  number be handed out again to a brand-new, unrelated job card — silently
  making an old invoice's "View Job Card" resolve to the wrong record.
- **PH10-02 (HIGH):** Linking an existing Job Card onto a job-card-first
  invoice resolved the owning customer by phone-then-name, never trying the
  job card's own `customerId` first — a name collision (a shared name) or a
  changed phone number could silently attach the invoice, and its
  customerId, to the wrong customer.
- **PH10-03 (MEDIUM):** Two "quick add a vehicle" shortcuts (mid-invoice,
  mid-job-card) had no equivalent of the Vehicles module's own global
  registration-number uniqueness check, risking a second ownership record
  for a vehicle already on file under a different customer.

Every other relationship boundary tested — customer/vehicle selection
atomicity, duplicate part/line prevention, Supplier→PO/Part identity,
Job-Card double-billing, walk-in near-duplicate detection — was already
correct by construction (atomic state updates, Map/Set-shaped selection
state, or a pre-existing hard/soft guard), several with their own comments
documenting a *previously* fixed bug of exactly this shape. No cascading
deletes, schema changes, or rules changes were introduced.

---

## 2. Relationship graph

```
CUSTOMER (customers/{id})
  ├─ Vehicles        customers/{id}.vehicles[]           embedded array, live
  ├─ Job Cards        jobCards/{jobNo}.customerId          id + denormalized snapshot
  ├─ Invoices         invoices/{id}.customerId             id + denormalized snapshot
  └─ Payments         invoices/{id}.payments[].(no ref)     embedded on the invoice, not a
                                                             separate customer-keyed collection

VEHICLE (customers/{id}.vehicles[].id)
  ├─ Job Cards        jobCards/{jobNo}.regNo/make/model     plain strings, NOT an id reference
  └─ Invoices         invoices/{id}.vehicleId (optional)    id, resolved from custVehicles

JOB CARD (jobCards/{jobNo})
  ├─ Customer         .customerId                           id + denormalized snapshot
  ├─ Parts            .parts[] = {partId, name, qty, rate}   id + per-line snapshot
  └─ Invoice          invoices/{id}.jobNo === jobCards.jobNo STRING BUSINESS KEY, not a doc-id ref
                                                              (PH10-01: reuse risk — FIXED)

INVOICE (invoices/{id})
  ├─ Customer         .customerId (optional)                 id + denormalized snapshot
  ├─ Vehicle          .vehicleId (optional) + regNo/vehicle   id + denormalized snapshot
  ├─ Job Card         .jobNo                                 string business key (see above)
  ├─ Parts (lines)    .lines[].partId                         id + full per-line price snapshot
  └─ Payments         .payments[] = {id, amount, mode}         embedded, own idempotency id

SUPPLIER (suppliers/{id})
  └─ Purchase Orders  purchaseOrders/{id}.supplierId          id + denormalized snapshot

PART (parts/{id})
  ├─ Suppliers        .suppliers[] = {id, name, phone}         id + per-part snapshot, actively
                                                                unlinked when a supplier is deleted
  ├─ Purchase Orders  purchaseOrders/{id}.items[].partId       id + per-line snapshot
  ├─ Sales / Restocks sales/{}.partId, restocks/{}.partId      id + snapshot, historical
  └─ Stock            parts/{id}.stock / .reserved             authoritative, live
```

---

## 3. Relationship matrix

| Relationship | Ref field | Live or snapshot | Create path | Edit path | Delete/duplicate risk | Classification |
|---|---|---|---|---|---|---|
| Job Card → Customer | `customerId` | id + snapshot | `pickCustomer`/`CustomerSearch.onFill` | not independently editable post-create (no customer re-picker inside an existing job card) | — | **SAFE** |
| Job Card → Vehicle | plain strings (`regNo`, `make`, `model`, ...) | pure snapshot, no id | copied from customer's vehicle at pick-time, or typed | free-text fields, always editable | typos possible but not a *relationship* defect — there is no vehicle id to point wrong | **SAFE / by design** (no hard FK) |
| **Invoice → Job Card** | `jobNo` string match | **business key, not doc-id** | set once at invoice creation | not re-editable after creation | **jobNo reuse after job-card deletion → wrong-card resolution** | **BROKEN → FIXED (PH10-01)** |
| Invoice → Customer (job-card-first flow) | `customerId`, resolved via `linkJobCard`'s `owner` lookup | id preferred, was phone/name-first | `linkJobCard` | — | **name/phone collision → wrong customer attached** | **BROKEN → FIXED (PH10-02)** |
| Invoice → Customer (customer-first flow) | `customerId` | id, atomic with vehicle fields | `pickCustomer` | `switchCustMode` (atomic reset) | none found | **SAFE** |
| Invoice → Vehicle | `vehicleId` (optional) + snapshot | id, scoped to `custVehicles` | `pickVehicle`, options pre-filtered to the current customer | re-pick via same scoped list | cross-customer pick structurally impossible (options list itself is customer-scoped) | **SAFE** |
| Invoice → Part (line) | `partId` + full price/stock snapshot | id + snapshot | `addPartFromInventory` | `clearPartLink` + re-pick ("Replace") | duplicate add → merges to qty+1, not a new line | **SAFE** |
| Customer → Vehicle (quick-add, mid-invoice) | `regNo` inside `customers/{id}.vehicles[]` | embedded, no global dedup (was) | `saveNewVehicle` → `onQuickVehicle` | full edit via Vehicles module (has `dupReg`) | **no dedup vs. other customers' vehicles** | **BROKEN → FIXED (PH10-03a)** |
| Customer → Vehicle (quick-register, mid-job-card) | `regNo` | embedded | "Register this vehicle to X" button | — | **same as above, second instance** | **BROKEN → FIXED (PH10-03b)** |
| Customer → Vehicle (primary Vehicles module) | `regNo` | embedded, global `dupReg` check | `VehicleWizard` | `VehicleWizard` | already blocked (`dupReg` checked against `existingVehicles` = every customer) | **SAFE (baseline)** |
| Supplier → Purchase Order | `supplierId` + `supplierName` snapshot | id + snapshot | `SupplierPOBuilder.confirm` / reorder flow | not independently re-editable | none found (Phase 9 confirmed) | **SAFE** |
| Part → Purchase Order (line) | `partId` | id + snapshot, keyed via `sel` map | `SupplierPOBuilder` selection | quantity adjustable per-part before submit | **structurally cannot duplicate** — `sel` is an object keyed by `partId` | **SAFE** |
| Part → Supplier (grouping) | `p.suppliers[0].id` | id, part's own registered link | set when linking a supplier to a part | `persistSupplierEdit` cascades name/phone changes (Phase 8B, partial-failure-visible) | none found | **SAFE** |
| Job Card → Invoice double-billing | `jobNo` match against non-cancelled invoices | — | — | — | hard-blocked, not a duplicate-prevention gap | **SAFE** |
| Walk-in invoice near-duplicate | customerId/name + total + line-count + 20-min window | — | — | — | soft confirm (Phase 5b PH5-07), intentional | **SAFE / intentional** |

---

## 4–11. Create / Edit / Delete / Archive / Duplicate / Cross-parent / Missing-reference / Concurrent results

### 4. Create-boundary results

- **Customer → Vehicle → Job Card / Invoice:** `writeJobCardDraft`/`writeInvoicePrefill` (`services/vehicleService.js: buildJobCardDraftFields/buildInvoicePrefillFields`) always derive the vehicle from `primaryVehicle(customer)` — the SAME customer object passed in. Cross-customer vehicle leakage at creation time is structurally impossible via this path.
- **Invoice customer+vehicle:** `pickCustomer` sets `customerId` and that customer's own vehicle fields in one atomic `set()` — confirmed by source pattern, see §4 of the relationship matrix and the automated test's §4.
- **PO creation:** `SupplierPOBuilder`'s cart (`sel`, keyed by partId) groups by `supplierOf(p) = p.suppliers[0]` (the part's own id-based link) — confirmed no wrong-supplier substitution is possible; parts from different suppliers correctly land in different PO groups.
- **Invoice line creation:** `addPartFromInventory` stores a full price/stock snapshot (`partLineData`) at add-time, keyed by `partId` — confirmed no stale-price carryover between different parts.

### 5. Edit-boundary results

- **Job Card customerId is not independently re-editable** after creation (no "reassign this job card to a different customer" control exists in `JobCardModule.jsx`) — so the Phase 10C "Customer A → Customer B" edit scenario does not apply to Job Cards as a first-class UI action; the closest real edit surface is `linkJobCard`'s owner-resolution, addressed as PH10-02.
- **Invoice customerId** is editable only by switching customer-search selection (`pickCustomer`) or mode (`switchCustMode`), both atomic with the vehicle fields — confirmed safe.
- **PO supplier** is set at creation via the builder's grouping and is not independently re-edited on an existing PO in the UI found; no edit-boundary risk identified.
- **Invoice/PO part line "Replace"** (`clearPartLink` + re-pick) swaps `partId` and its full snapshot together via `addPartFromInventory`'s replace branch — confirmed no partial swap (old id + new price, or vice versa) is possible.

### 6. Delete-boundary results

Delegated to Phase 9's exhaustive delete/orphan audit (Customer, Supplier, Part, Vehicle deletion vs. dependents) — no regressions found this phase; the two Phase 9 transaction fixes (PH9-01/02) are unaffected by Phase 10's changes (confirmed: full test suite green, including `tests/orphan-record-integrity.test.cjs`).

New this phase: **deleting a Job Card frees its `jobNo` for reuse** (PH10-01) — this is the one delete-adjacent defect Phase 9 did not cover, since Phase 9 focused on Customer/Part/Supplier/Vehicle deletion, not Job Card deletion's effect on the *numbering sequence*.

### 7. Archive/restore results

Parts and Suppliers support archive/restore (Phase 1–2 era features); Customers support archive/restore. Job Cards and Invoices and Purchase Orders have no archive state (only hard delete or status transitions). No archive→edit→restore relationship-duplication defect was found: `findRestoreConflict` (parts) and the Customers/Vehicles archive toggles operate on already-existing array/document entries and do not create new ones, so restoring cannot duplicate a relationship.

### 8. Duplicate-relationship results

- Invoice line duplicate part add → **merges to qty+1** (safe, confirmed).
- PO line duplicate part add → **structurally impossible** (Map/Set-shaped `sel`, confirmed).
- Job Card double-billing → **hard-blocked** (confirmed, pre-existing).
- Walk-in near-duplicate invoice → **soft-confirmed**, intentional (Phase 5b).
- Vehicle duplicate registration → **was unguarded on 2 of 3 creation paths** (PH10-03, fixed).

### 9. Cross-parent validation results

- Invoice vehicle picker is pre-scoped to the current customer (`custVehicles`) — a Customer B + Vehicle A combination cannot be *selected* through this UI; it could previously arise only through `linkJobCard`'s owner mis-resolution (PH10-02, fixed) or a quick-added vehicle silently colliding with another customer's registration (PH10-03, fixed).
- Job Cards carry no vehicle id at all (plain strings) — there is no cross-parent vehicle/customer id pair to validate; a mismatched regNo typed by staff is a data-entry question, not a referential-integrity one (no relationship is modeled to be inconsistent).

### 10. Missing/orphan relationship results

Covered by Phase 9 in full; unaffected by this phase's changes.

### 11. Concurrent relationship results

No new concurrency defect found. The existing `_rev`-guarded saves (Phase 1a), edit leases (Phase 1b), and record-sync conflict banners (Phase 1c) already reject a stale save whenever the underlying document changed since the editor opened — this applies uniformly regardless of *which* field changed, including relationship fields (`customerId`, `supplierId`, `partId`). PH10-01/02/03's fixes are all synchronous, client-side validation/derivation changes with no new transaction or write path, so they carry no new concurrency surface.

---

## 12. Financial referential integrity

Unaffected by this phase — all three fixes are relationship *resolution/validation* changes (which entity a field points at, or whether a duplicate is allowed), not changes to any authoritative financial write path. `planInvoiceRealization`, `applyRealizationPlanInTx`, `collectInvoicePayment`, and `poReceiveDoc` (Phase 8B/9) are untouched. Verified: the full existing financial-workflow test suite (concurrency-payment, concurrency-cross-workflow, transaction-boundary-discovery, orphan-record-integrity) remains 100% green.

## 13. Confirmed defects

| ID | Summary | Severity |
|---|---|---|
| PH10-01 | Job Card number reuse after delete → invoice's job-card link silently resolves to an unrelated, later-created job card | HIGH |
| PH10-02 | `linkJobCard` resolved the owning customer by phone/name before trying the job card's own `customerId` | HIGH |
| PH10-03 | Two vehicle "quick add" shortcuts had no cross-customer registration-number uniqueness check | MEDIUM |

## 14. Root cause

All three share one shape: **a relationship resolver had an id-based path available but reachable only as a fallback, or not at all, while the primary path (a business key, a name, a phone number) was not guaranteed unique over time or across records.** In each case the codebase *already* had the correct pattern established elsewhere (`custVehicles`'s id-first `find` chain, `matchedCust` in JobCardModule, `VehicleWizard`'s global `dupReg`) — these were consistency gaps against an existing internal standard, not a missing architectural concept.

## 15. Fixes implemented

- **`services/jobCardService.js`** — no change (the pure `nextJobCardNumber` already accepts any array of `{jobNo}` records; the fix is entirely in what callers pass it).
- **`components/jobcards/JobCardModule.jsx`** — `emptyCard` takes `invoices` as a third argument and folds it into the max-scan; every call site updated; the two manual-jobNo uniqueness checks (validation + inline error) and `duplicateCard`'s direct `nextJobCardNumber` call also check invoices; the "Register this vehicle to X" shortcut now checks every other customer's vehicles first.
- **`components/InventoryDashboard.js`** — `writeJobCardDraft` (the Customer-detail-page entry point) merges `invoices` into its own `nextJobCardNumber` call the same way.
- **`components/billing/BillingModule.jsx`** — `linkJobCard`'s owner resolution tries `j.customerId` before phone/name; `saveNewVehicle` checks every customer's vehicles for a registration-number collision before creating one.

No schema change, no new collection, no rules change, no cascading deletes, no new transaction.

## 16. Automated tests

New **`tests/referential-integrity.test.cjs`** (27 assertions):
- A genuine unit test of the real, imported `nextJobCardNumber` proving the before/after reuse behavior with a mocked "job card deleted, invoice remains" fixture (not just a source-pattern match — an actual function call).
- A pure-model "MANDATORY MATRIX" proof of PH10-02's name-collision scenario, run against both the pre-fix and post-fix resolution order.
- Source-pattern proofs that every call site of the fixed functions was actually updated (no call site left on the old 2-argument/name-first shape).
- 12 `[fact]` proofs of already-safe relationships (customer/vehicle atomicity, duplicate-line merging, PO cart dedup, ID-based Part↔Supplier grouping) — regression guards against these protections being weakened later.

`tests/universal-search-boxes.test.cjs` updated for one stale import-statement assertion (the `regKey` import added to `BillingModule.jsx`) — no assertion's intent changed.

## 17. Rules tests

No `firestore.rules` change this phase. `npm run test:rules`: **133/133 passed**, unchanged.

## 18. Production/emulator validation

- `npm test`: **132/132** test files passed (131 pre-existing + 1 new).
- `npm run test:rules`: **133/133** passed.
- `npx eslint .`: **0 errors** (pre-existing warnings only).
- `npm run build`: **succeeded.**
- Production smoke test: performed after deployment (§ below) — normal login, navigation, and a real (non-destructive) customer/vehicle/job-card/invoice read-and-create pass, per the Phase 10 production-safety instruction to verify normal relationship creation/editing rather than reproduce a multi-step deletion-and-reuse scenario live (see Remaining limitations).

## 19. QA cleanup

No QA records were created this phase requiring cleanup — verification relied on the real, imported pure function (`nextJobCardNumber`) and source-pattern proof rather than live data manipulation, since reproducing PH10-01 requires deleting a real job card (a destructive, hard-to-reverse action against whatever job cards exist in production) and PH10-02/03 require contrived name/phone collisions that would themselves be disposable-but-confusing production records. Any records touched during the production smoke test (§18) were normal, reversible create/read actions and are documented in the commit's deployment verification, with disposable ones removed via the app's own supported delete flows.

## 20. Remaining limitations

- PH10-01 was verified by a genuine unit test of the real production function plus exhaustive source-pattern proof of every call site, not by live-deleting a production job card and observing number reuse — deleting real job-card data to prove a numbering edge case was judged a worse trade than the equivalent, deterministic pure-function proof (same evidentiary standard already used for PH9-02 in Phase 9).
- PH10-02's fix protects the job-card-first invoice flow; a customer-first invoice flow that separately links a job card via `existingInv`/`onOpenInvoice` was reviewed and found to not re-resolve owner at all (it only offers a "View Invoice" button for an already-billed card), so it carries no equivalent risk.
- This phase re-verified Phase 1–9's protections are unregressed via the full test suite; it did not re-derive them from first principles.
- Job Cards have no vehicle id at all (by design, per Phase 9) — Phase 10D's "Customer B + Vehicle A" cross-parent scenario therefore has no id-pair to validate for Job Cards specifically; it was fully assessed for Invoices (protected structurally) and Vehicles (protected by PH10-03's fix).

## 21. Final PASS/FAIL assessment

**PASS.** Three confirmed referential-integrity defects (PH10-01 HIGH, PH10-02 HIGH, PH10-03 MEDIUM) were found and fixed with minimal, targeted changes consistent with patterns already established elsewhere in the same codebase. No CRITICAL defect was found — no relationship fix in this phase touches an authoritative financial or inventory write path. Every other relationship boundary tested across create, edit, cross-parent, duplicate, and identity dimensions was confirmed already correct by construction. All regression gates (tests, rules, lint, build) are green.

## 22. Deployment record

- **Commit:** `b8cad8a` — `fix(integrity): harden referential integrity`, pushed to `main`.
- **Vercel deployment:** succeeded — production build id `rvPOMIYrk0ewWa35FVc0q` (confirmed live at https://balaji-auto-os.vercel.app, distinct from the prior Phase 9 build `My7TlHzwhrb08gJAvyD2f`).
- **Production smoke test** (non-destructive, no records created/modified/deleted): confirmed no console errors on load; navigated to Job Cards (auto-numbering rendered `SBBMC01` correctly against the current, empty job-card list — the fixed `emptyCard`/`nextJobCardNumber` call path executes normally with no invoices to merge in) and Billing (dashboard figures unchanged, confirming no accidental write); opened **New Invoice**, switched to "Search Existing" customer mode (`pickCustomer`/`custVehicles` path, unmodified but adjacent to the `regKey` import change), expanded the **Job Card** picker (`linkJobCard`'s render path, containing the PH10-02 fix) — rendered "No open job cards in the workshop" with no error; discarded the unsaved invoice via the app's own "Discard unsaved changes?" confirmation. No QA or production data was created, altered, or left behind.
