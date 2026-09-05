# PHASE 11 — Financial Integrity / Money Consistency Audit Report

**Repository:** github.com/bhargav-1618/Balaji-Auto-OS
**Production:** https://balaji-auto-os.vercel.app
**Branch:** main
**Method:** an INDEPENDENT oracle — written fresh from the documented formula,
never calling the production helpers — checked against the two REAL, imported
production money functions (`totalsOf`/`deriveStatus` in BillingModule.jsx,
`invTotals`/`invStatus` in InventoryDashboard.js) across zero/decimal/rounding-
boundary/large-value/discount/GST scenarios, plus MANDATORY INJECTION MATRIX
pure-model proofs (the Phase 8B/9/10 convention) for the concurrent-race
scenario. Code-size discipline: every fix below either **removes** duplicate/
dead logic or reuses an already-established pattern verbatim; no new
abstraction, helper, or parallel implementation was introduced.

---

## 1. Financial model

Two independent, purpose-built money-calculation paths exist — deliberately
scoped, not an accidental duplication:

- **`totalsOf(inv)`** (`components/billing/BillingModule.jsx:439`) — the
  Billing UI's own calculation, backing every screen a cashier looks at
  (invoice editor totals, KPI cards, PDF, reports).
- **`invTotals(iv)`** (`components/InventoryDashboard.js:6932`) — the
  transaction engine's own calculation, the sole gate for whether an invoice
  is "realized" (stock/sales/rollup effects fire) and the value literally
  **persisted** as the invoice's own `status`/`paid`/`balance`/`grandTotal`
  fields by `collectInvoicePayment`.

Their comment history (both files) documents three separate historical bugs
that arose specifically because these two disagreed — the reason this phase
treats "do the two paths ever disagree" as a first-class question, not an
afterthought.

A third, related pair — **`deriveStatus(inv)`** (BillingModule.jsx) and
**`invStatus(iv)`** (InventoryDashboard.js) — derives the human-facing status
string from each path's own totals.

No third calculation path exists anywhere in the codebase (verified by
grepping for the shared `gross - lineDisc` / `afterDisc =` pattern across all
of `components/`).

## 2. Exact formulas

Confirmed from source (not assumed), identical shape in both `totalsOf` and
`invTotals`:

```
for each line:
  gross      = qty × rate
  lineDisc   = disc ? gross × (disc / 100) : 0
  net        = max(0, gross − lineDisc)          ← floored, never negative
  sub       += net
  lineRate   = line.gst != null ? line.gst : invoice.gstPct
  lineGstAcc+= net × (lineRate / 100)

invDisc    = discountType === 'percent' ? sub × (discount / 100) : discount
afterDisc  = max(0, sub − invDisc)               ← floored, never negative
anyLineGst = any line carries an explicit gst field
gst        = anyLineGst
               ? lineGstAcc × (afterDisc / (sub || 1))   ← scaled to discount
               : afterDisc × (invoice.gstPct / 100)      ← flat fallback
if gstMode === 'exempt': gst = 0

grandRaw   = afterDisc + gst
grand      = Math.round(grandRaw)                ← ROUNDED TO THE NEAREST RUPEE
roundOff   = grand − grandRaw                     (the printed "Round Off" line)

paid       = payments.length ? Σ payment.amount : legacyPaid
balance    = max(0, grand − paid)                ← floored, never negative
```

**Order of operations confirmed:** subtotal → invoice-level discount →
GST (scaled proportionally to whatever the discount left of the taxable
base) → round to the nearest whole rupee. This is NOT "subtotal → discount →
GST" applied naively per-line; per-line GST is summed first, then
proportionally rescaled by `afterDisc / sub` so an invoice-level discount
correctly reduces the tax base too.

## 3. Rounding model

- **Money is rounded to paisa** via `p2(v) = Math.round((v + Number.EPSILON) * 100) / 100`
  — a documented, EPSILON-corrected round-half-up helper, applied at the
  return boundary of `totalsOf` to every field it hands back (`sub`,
  `afterDisc`, `gst`, `balance`, `paid`, `profit`, `cost`, `partsRev`,
  `labourRev`).
- **`grand` is rounded to the nearest whole RUPEE** (`Math.round`, no
  decimals) — the standard Indian retail/GST "Round Off" convention, not a
  bug; the paisa-level remainder is captured separately as `roundOff`.
- **CGST/SGST are split from the already-rounded `gst` total** (half each,
  the odd paisa pushed onto CGST), so `cgst + sgst === gst` exactly — never
  two independently-rounded halves that could disagree with the whole by
  ₹0.01.
- Verified empirically (Node, outside the app) that `p2` correctly resolves
  every classic JS float-precision trap tested: `0.005→0.01`, `1.005→1.01`,
  `10.005→10.01`, `99.995→100`, `1.145→1.15`, `2.675→2.68`, and
  `0.1+0.2→0.3`.

## 4. Money fields

| Field | Kind | Source |
|---|---|---|
| `lines[].qty`, `.rate`, `.disc`, `.gst` | authoritative input | typed by the user |
| `sub`, `afterDisc`, `gst`, `grand`, `roundOff`, `cgst`/`sgst`/`igst` | **derived** | computed by `totalsOf`/`invTotals` from lines; never independently stored/trusted |
| `payments[]` (`id`, `amount`, `mode`, `ref`, `date`) | **authoritative** | append-only array on the invoice; the sole source of truth for `paid` |
| `paid`, `balance` | **derived** | always recomputed from `payments[]`, never read as a trusted stored scalar (see `invTotals`'s own header comment on the historical "invoice paid but nothing updated" bug this exact discipline fixed) |
| `status` | **derived** | `deriveStatus`/`invStatus` from the above; the ONE thing actually written back to Firestore as a persisted field |
| `legacyPaid` | derived fallback | only used for a legacy record with no `payments[]` at all, explicitly flagged `legacyPaid: true` |
| Customer `totalSpent`/`outstanding` | derived | full recompute over that customer's invoices (Phase 8B, `syncCustomerTotals`) |
| Sales ledger rows, `salesRollups` | authoritative history | append-only, written atomically with the invoice inside `planInvoiceRealization`/`applyRealizationPlanInTx` (Phase 8B/9) |

## 5. Financial invariants (as implemented, confirmed by source + test)

1. `grand = Math.round(max(0, sub − invDisc) + gst)`, GST scaled to whatever the discount left of the base.
2. `paid` is ALWAYS traced from `payments[]`, never trusted as a stored scalar.
3. `balance = max(0, grand − paid)` — never negative, even when overpaid (the excess is instead supposed to be surfaced via `status`, see §14/§20 below).
4. `status` must reflect an overpayment as "Partially Paid" (anomalous), never a clean "Paid" — this invariant was violated in `invStatus` (PH11-02, fixed).
5. A save is rejected outright if `payments` would exceed `grand + ₹1` (rounding slack) — enforced client-side in `BillingModule.save()` and (as of this phase) server-side, atomically, inside `collectInvoicePayment`.
6. Every relationship-affecting invoice status change (Paid → Cancelled/Refunded/Returned) reverses stock/sales/rollup through exactly ONE atomic diff (`planInvoiceRealization`) — never twice, never zero times when it should fire once.

---

## 6–13. Scenario results

All scenarios below were checked with an **independent oracle** (`tests/financial-integrity.test.cjs`, written fresh from §2's formula, never calling `totalsOf`/`invTotals`) against BOTH production functions. **147/147 assertions pass.**

### 6. Zero-value results — SAFE
All-zero invoice, zero quantity, zero GST, `gstMode: 'exempt'`, and a zero-amount payment row all compute `sub`/`gst`/`grand`/`paid`/`balance` = 0 with **no NaN/Infinity/undefined** on either production path. A zero-amount payment row contributes exactly 0 to `paid` and does not crash.

### 7. Decimal results — SAFE
`1×0.10`, `3×0.33`, `7×1.11`, a 3-line mixed-decimal invoice, and a `2.5`-hour decimal-quantity labour line all match the independent oracle exactly on both production paths.

### 8. Large-value results — SAFE
₹1,00,000 / ₹10,00,000 / ₹1,00,00,000 (1 crore) lines, and a `999 × 50,000` line, all compute correctly with no overflow (JS numbers are exact well past this range) and the stored `grand` is a plain integer string, never scientific notation.

### 9. Discount results — SAFE
No discount, small flat discount, decimal percent discount, discount exactly equal to subtotal (grand floors to 0), discount **greater than** subtotal — floors to 0, never negative, and the GST computed on that 0 base is also correctly 0 (no negative-base tax artifact) — and an extreme (₹1 crore off a ₹1,000 bill) discount, all match the oracle. Discount is **clamped, not rejected** — matching the app's own explicit `Math.max(0, …)` design, confirmed intentional.

### 10. GST results — SAFE
All five supported rates (0/5/12/18/28%), a decimal rate (6.5%), mixed per-line rates scaled by an invoice-level discount, and the invoice-level `gstPct` fallback (when no line carries its own `gst`) all match the oracle exactly on both paths.

### 11. Grand-total results — SAFE
Single line, multiple mixed-quantity lines, a zero-valued line mixed with priced lines (does not corrupt the others), and — critically — **editing one line changes the total by exactly that line's own delta**, leaving an untouched sibling line's contribution bit-for-bit unchanged.

### 12. Payment results — SAFE (traced, not trusted)
For every scenario, `paid` was independently summed from the `payments[]` array itself (never read as a stored scalar) and compared to both `totalsOf(iv).paid` and `invTotals(iv).paid`:
- **3 payments summing exactly to grand** (₹2,500 + ₹1,500 + ₹6,000 = ₹10,000 against a ₹10,000 total): `paid=10,000`, `balance=0`, `status=Paid` on both paths.
- **3 payments summing short** (₹2,000 + ₹3,000 + ₹3,000 = ₹8,000 against ₹10,000): `paid=8,000`, `balance=2,000`, `status=Partially Paid` on both paths.
- No payment: `paid=0`, `balance=grand`, status `Unpaid` (Billing) / `Pending` (engine) — see §15/§20 for this one documented label difference.

### 13. Multiple-payment results — SAFE
Covered together with §12 above — both the "exact total" and "short of total" cases are independently traced and match on both production paths.

---

## 14. Overpayment results — BROKEN → FIXED (PH11-02, part 1)

`deriveStatus` already had an overpayment guard (`BUG-LIVE-002`, pre-existing:
"an OVERPAID invoice's books do not balance ... never Paid"). **`invStatus`
did not have the same guard** — despite computing status from the exact same
shape of totals. Since `invStatus` is the function `collectInvoicePayment`
actually uses to compute the `status` field it **persists to Firestore**, and
the one every Reports/Dashboard export reads, an overpaid invoice
(`paid > grand`) could be authoritatively stored and displayed as a clean
"Paid" in every context except the Billing screen itself. **Fixed** by adding
the identical one-line guard already proven correct in `deriveStatus`.

## 15. Invoice-edit-after-payment results — SAFE (pre-existing policy, confirmed)

- **Case A** (total 10,000 → 12,000, paid 4,000 unchanged): balance
  recomputes to 8,000. Confirmed.
- **Case B** (total 10,000 → 8,000, paid 4,000 unchanged): balance
  recomputes to 4,000. Confirmed.
- **Case C** (edit total below paid): the SAME overpayment guard
  BillingModule's `save()` already uses for a genuinely new overpayment
  (`totalPaid > snapPay.grand + 1`) also fires here, since it re-evaluates
  against the invoice's *current* (possibly just-edited) total — the save is
  **rejected**, not silently allowed to corrupt the balance.
- **Policy for edits after FULL payment**: a `Paid` (or Cancelled/Refunded/
  Returned) invoice is **locked read-only** in the UI (`locked` flag,
  BillingModule.jsx) — the only ways forward are **Duplicate** (a fresh,
  independent invoice) or **Credit Note** (a full reversal, §16). This is a
  deliberate, coherent policy (not "edits allowed with silent recalculation")
  confirmed by source and unaffected by this phase.

## 16. Concurrent payment/edit results — BROKEN → FIXED (PH11-02, part 2)

**This is Phase 11's own "most valuable scenario."** Traced precisely:

- Client A edits an invoice's total 10,000 → 3,000 and saves. This commits
  via `editInvoiceTransactional`'s `_rev` guard — unaffected by anything in
  this phase.
- Client B, still showing the OLD ₹10,000 balance on its own screen,
  collects a ₹4,000 payment. `PaymentModal`'s own overpayment check validates
  ₹4,000 against B's **stale** balance (₹10,000) and passes.
- `collectInvoicePayment`'s transaction re-reads the invoice — correctly
  picking up A's already-committed ₹3,000 total — but (before this fix)
  **never re-validated the payment against that freshly-read total**. It
  would append the payment and persist `grandTotal=3,000, paid=4,000,
  balance=0, status="Paid"` — a mathematically contradictory, silently
  overpaid, and (per §14) mislabeled document.
- **Fixed**: `collectInvoicePayment` now re-checks `t.paid > t.grand + 1`
  against `t`, computed from the SAME transaction's own fresh read, and
  throws a coded `conc/overpaid` error **before any write** if it would
  overpay — exactly the same "reject atomically, using freshly-read server
  state, never client-supplied values" pattern already used throughout this
  transaction for `conc/deleted`/`conc/estimate` and every other
  concurrency guard in Phases 1–10. The caller (`BillingModule.collectPayment`)
  treats it as a definite non-commit (retires the durable opId, same as the
  other two conc/* codes) and shows a specific, actionable toast telling the
  user to reload.
- Verified with a MANDATORY INJECTION MATRIX pure-model proof: the exact
  before/after interleaving, plus a corrected retry (the true ₹3,000 balance)
  succeeding cleanly afterward.

## 17. Refund/correction results — SAFE (supported, single engine)

Refund/correction **is supported**, via "Credit Note" on a Paid invoice,
which calls `changeStatus(iv, 'Returned', 'Returned')`. This reuses the
**exact same** `onPersist` → `editInvoiceTransactional` → `planInvoiceRealization`
path every other invoice write already uses — not a separate refund engine.
`isRealized` treats `Cancelled`/`Refunded`/`Returned` as NOT realized, so the
Paid→Returned transition's realization diff is a full, correct, atomic
reversal (stock restored, a compensating negative sales row, `salesRollups`
reversed) — the same machinery Phase 8B/9 already hardened.

## 18. Delete/reversal results — BROKEN → FIXED (PH11-01)

**Confirmed CRITICAL defect.** `changeStatus`'s Refund/Return path called a
SECOND, separate, non-transactional function (`onRestoreStock`, wired from
`InventoryDashboard.js`) that unconditionally added `invoicePartQtys(iv)`
(the invoice's raw line quantities — no realization check) to inventory via
`applyStockDelta`, a plain `updateDoc(..., { stock: increment(...) })` call
with no relation to the atomic transaction at all. Since `onPersist` (via
`editInvoiceTransactional`'s `planInvoiceRealization` diff) **already**
correctly reverses stock the moment an invoice's realization state flips
from Paid to not-realized:

- **Refund or Return from a Paid invoice**: stock was restored **twice** —
  once correctly, once more by the redundant call — silently inventing
  inventory.
- **Return from an invoice that was never Paid** (available on any
  non-Returned, non-Cancelled invoice, including Unpaid/Partially Paid): the
  transaction's own diff correctly computes a zero delta (nothing was ever
  deducted), but the redundant call still unconditionally added the
  invoice's line quantities to stock — **inventing inventory that was never
  deducted in the first place.**

**Fixed by deletion**, not by adding a guard: `onRestoreStock` (the callback,
its JSX wiring, and the `onRestoreStock` prop declaration) was removed
entirely, since the atomic transaction was already the correct, sufficient,
single source of the reversal. `applyStockDelta`/`invoicePartQtys` remain in
active use elsewhere (quick restock, `runInvoiceRealizationDemo`) and were
not touched.

## 19. Firestore evidence

Representative traced scenario (from `tests/financial-integrity.test.cjs`,
§8 and §9 of the test output):

```
Invoice document (grand computed from lines: 1 × ₹10,000, 0% GST):
  sub = 10,000.00   afterDisc = 10,000.00   gst = 0.00   grand = 10,000

Payment records:
  P1 = { amount: 2500 }
  P2 = { amount: 1500 }
  P3 = { amount: 6000 }

Independent expected:
  paid    = 2500 + 1500 + 6000 = 10,000
  balance = 10,000 − 10,000 = 0
  status  = Paid

totalsOf(inv)  => paid: 10000, balance: 0     | deriveStatus(inv) => "Paid"
invTotals(inv) => paid: 10000, balance: 0     | invStatus(inv)    => "Paid"

Result: PASS (both production paths agree with the independent oracle)
```

Overpayment scenario (post-fix, PH11-02):

```
grand = 1000 (post-edit), payments = [{ amount: 2000 }]  (traced from the payment record)

Independent expected: paid=2000 > grand=1000 -> anomalous, NOT "Paid"

deriveStatus(inv) => "Partially Paid"   (was already correct — BUG-LIVE-002)
invStatus(inv)    => "Partially Paid"   (FIXED this phase — was "Paid")

Result: PASS (both production paths now agree)
```

## 20. Confirmed defects

| ID | Summary | Severity |
|---|---|---|
| PH11-01 | Refund/Return double-restored (or invented) inventory via a redundant, non-transactional `onRestoreStock` callback duplicating the atomic transaction's own correct reversal | **CRITICAL** |
| PH11-02 | `invStatus` lacked `deriveStatus`'s overpayment guard (persisted `status` field could read "Paid" while overpaid); `collectInvoicePayment` had no server-side re-check against its own fresh read, allowing a concurrent edit+payment race to commit a mathematically contradictory document | **CRITICAL** |
| PH11-03 (documented, not fixed) | `deriveStatus`'s "nothing paid yet" label is `"Unpaid"`; `invStatus`'s equivalent branch is `"Pending"` — a display-string-only discrepancy (all underlying money values are identical); a Sales/Billing/GST report export can show "Pending" for an invoice Billing's own screen calls "Unpaid" | LOW |

## 21. Root causes

- **PH11-01**: `onRestoreStock` predates Phase 8B's atomic-transaction
  refactor. Before Phase 8B, `changeStatus` may have been a/the mechanism
  restoring stock on a status flip; once Phase 8B folded that restoration
  into `planInvoiceRealization`'s diff (applied inside the SAME transaction
  as every other invoice write), this callback became redundant — and,
  because it never checked whether the invoice had actually been realized,
  actively harmful. A parallel implementation of already-correct logic,
  exactly the class of risk the code-size discipline for this phase called
  out in advance.
- **PH11-02**: `invStatus` and `deriveStatus` are two independently-typed
  implementations of the same status-derivation formula (see §1) — a
  consistency gap of the same shape Phase 10 found and fixed for
  relationship-identity resolution (id-first vs. name-first). The
  overpayment guard was added to `deriveStatus` alone (BUG-LIVE-002) and
  never mirrored into `invStatus`. Separately, `collectInvoicePayment` — by
  deliberate Phase 3b design (BUG-CONC-01) — does NOT use `_rev`-based
  rejection for payments, so that two legitimate concurrent payments can
  both succeed; this is correct for payment-vs-payment races but left
  payment-vs-edit races (a genuinely different total, not just a stale
  payments array) unguarded.

## 22. Fixes

- **`components/InventoryDashboard.js`**:
  - `invStatus` gains the one-line overpayment guard already proven correct
    in `deriveStatus` (reused verbatim, not reinvented).
  - `collectInvoicePayment`'s transaction re-validates `t.paid > t.grand + 1`
    against its own fresh read and throws `err.code = 'conc/overpaid'`
    before any write — reusing the exact `conc/*` coded-error pattern
    already used for `conc/deleted`/`conc/estimate` in the same function.
  - The `onRestoreStock` callback (JSX prop + implementation) is **removed**.
- **`components/billing/BillingModule.jsx`**:
  - The `onRestoreStock` prop is removed from the function signature; its
    call site inside `changeStatus` is removed.
  - `collectPayment`'s error handling treats `conc/overpaid` the same as the
    other two `conc/*` codes (retire the opId, show a specific toast) —
    extends the existing ternary chain, does not duplicate it.
- No schema change, no new collection, **no rules change**, no new
  transaction, no new abstraction.

## 23. Automated tests

New **`tests/financial-integrity.test.cjs`** (147 assertions):
- An independent oracle (`oracleTotals`, written fresh from §2's formula)
  checked against both `totalsOf` and `invTotals` across every §6–13
  scenario category.
- A genuine functional proof (real `invStatus`/`deriveStatus` calls, not
  source-pattern only) of the PH11-02 overpayment-status fix.
- Two MANDATORY INJECTION MATRIX pure-model proofs (the Phase 8B/9/10
  convention): PH11-01's before/after stock-restoration count, and PH11-02's
  before/after concurrent edit+payment interleaving (including a corrected
  retry succeeding cleanly).
- Source-pattern proofs that every fixed call site was actually updated (no
  residual `onRestoreStock` wiring; the new guard runs strictly before the
  transaction's first write).
- One documented (not "fixed") fact-check for PH11-03's label discrepancy.

`tests/setup.cjs` was extended (not duplicated) to expose `invTotals`/
`invStatus` from `InventoryDashboard.js` for direct testing, the same
established pattern already used for `Sidebar`/`InvoiceModal`/`deriveStatus`.
**Correction made during this phase**: `totalsOf` was initially (redundantly)
added to that same list before discovering `BillingModule.jsx` already ends
with its own `export { totalsOf };` — the redundant addition was reverted
rather than left in, per this phase's code-size mandate.

## 24. Firebase rules

No `firestore.rules` change this phase (all three fixes are client/
transaction-layer logic, not a security/integrity boundary rules should
own). `npm run test:rules`: **133/133 passed**, unchanged.

## 25. Production validation

- `npm test`: **133/133** test files passed (132 pre-existing + 1 new).
- `npm run test:rules`: **133/133** passed.
- `npx eslint .`: **0 errors** (pre-existing warnings only).
- `npm run build`: **succeeded.**
- Production smoke testing for this phase is deliberately limited to the
  gates above plus (post-deploy) a normal, non-destructive invoice
  create/view/payment-modal-open pass — this phase's confirmed defects
  (double stock restoration on Refund/Return; a payment-vs-edit race) both
  require either altering real inventory via a real Refund/Return action or
  orchestrating a genuine two-client race against production data, neither
  of which is a safe, disposable QA action per this phase's own production-
  safety instructions. Both fixes are proven instead by the independent
  oracle (§6–13, run against the real, imported production functions) and
  the MANDATORY INJECTION MATRIX pure-model proofs (§16/§18), the same
  evidentiary standard already used in Phase 8B/9 for comparably
  irreversible scenarios.

## 26. QA cleanup

No QA financial records were created this phase — verification used the
real, imported production functions and pure-model proofs rather than live
data manipulation (see §25). Nothing to clean up.

## 27. Remaining limitations

- PH11-03 (the `"Unpaid"` vs `"Pending"` status-label discrepancy) is
  documented but not changed — it affects only a display string on
  Reports/Dashboard exports for an invoice with `paid = 0`, never an
  authoritative money value, and changing either function's label is a
  product/wording decision outside a confirmed correctness defect.
- PH11-01/02 were verified via independent-oracle and pure-model proof
  against the real production functions rather than a live two-browser
  production race or a live Refund/Return against real inventory (see §25's
  reasoning).
- This phase re-verified Phases 1–10's protections are unregressed via the
  full test suite; it did not re-derive them from first principles.

## 28. Final PASS/FAIL assessment

**PASS.** Two confirmed CRITICAL financial-integrity defects (PH11-01,
PH11-02) were found and fixed with the smallest possible changes — one a net
deletion of redundant, harmful duplicate logic, the other a single reused
guard-clause pattern already proven correct elsewhere in the same file. Every
other tested formula, rounding boundary, large-value case, discount edge
case, GST rate, and payment-tracing scenario was confirmed mathematically
correct on BOTH of the app's independent money-calculation paths against a
freshly-written, independent oracle. One LOW-severity, display-only label
discrepancy is documented and intentionally left unchanged. All regression
gates (tests, rules, lint, build) are green.

## 29. Deployment record

- **Commit:** `067f901` — `fix(financial): harden money integrity`, pushed to `main`.
- **Vercel deployment:** succeeded — production build id `rDJpsUaUXDNERHJrkDxuD` (confirmed live at https://balaji-auto-os.vercel.app, distinct from the prior Phase 10 build `sHTue-DlEflDSEyORK_K9`).
- **Production smoke test** (safe, non-destructive — no invoice, payment, or status change made): no application console errors on load (only unrelated network noise — a blocked-by-client resource and a QUIC transport error from the browsing environment, not app JS errors); Billing dashboard rendered its existing KPIs correctly (Revenue (Month) ₹1,680, GST Collected ₹180, Parts Revenue ₹1,000, Labour Revenue ₹500 — the pre-existing `QA Production Smoke Test` invoice `INV-0001`, unchanged from Phase 10); opened `INV-0001` read-only via **View** — the editor rendered correctly as **Paid · Locked**, including the **Credit Note** button (gated on `savedStatus === 'Paid'`, adjacent to but unmodified by this phase's fixes) — then closed without any edit or save. No Refund/Return/Cancel action was performed against real data, per this phase's own production-safety reasoning (§25).
