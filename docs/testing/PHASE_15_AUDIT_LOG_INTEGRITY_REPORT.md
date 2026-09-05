# Phase 15 — Audit-Log Integrity Audit

## 1. Audit architecture

The audit trail is explicitly **advisory / best-effort**, never a financial
or inventory ledger (Phase 14 already covers ledger correctness). Every
audit write in this app shares the same shape of contract:

- Written **after** its authoritative operation has already committed
  (post-commit), inside the same `try` block as the `await` that confirmed
  success — never before, never unconditionally.
- **Fire-and-forget**: `addDoc(...).catch((e) => console.error(...))`, with
  no `return` in front of it and no caller awaiting it. A dropped audit
  write is silently logged to the console only — it never blocks, retries,
  or surfaces to the user, and never retroactively claims the business
  operation itself failed.
- Bounded to the last 500 entries in demo mode (`sessionStorage`); no
  equivalent cap exists in production (Firestore collection, paged by the
  UI).

## 2. Audit writer inventory (Phase 15A)

Two helpers, both confirmed still present, both writing to the same
`COLLECTIONS.AUDIT_LOG` collection:

| Helper | Entry shape | Domains |
|---|---|---|
| `pushAudit({action, entity, entityId, detail})` | Fixed `entity`/`entityId`/`details` fields | Invoice lifecycle (via `runPostCommitDerivedEffects`), Job Card create/update/status-change, Customer/Vehicle lifecycle (via an `onAudit` prop passed to `CustomersModule`/`VehiclesModule`/`RemindersModule`), capacity-cleanup |
| `writeAudit(action, target={}, details={})` | `...target` spread — entity-specific field names (`partId`, `supplierId`, `poNumber`) | Part CRUD/archive/restore, Supplier CRUD/archive/restore, Sell/Restock/Stock-Adjustment, category rename/delete, PO create/status/receive/cancel, permission changes |

Both stamp `performedBy: user?.uid || null` and
`performedByEmail: demoMode ? 'demo@...' : (user?.email || null)` from the
**same real auth source** — confirmed via source (§4). Both are called
directly from `InventoryDashboard.js`'s own handlers, or indirectly via an
`onAudit` prop for the three child modules that don't have direct closure
access to `pushAudit`.

**Confirmed still non-overlapping**: no call site was found where both
helpers fire for the same logical event (Phase 14's own finding,
re-verified here rather than re-derived). The two different entry shapes
are a code-organization observation (a consumer must know which shape a
given `action` produced), not a correctness defect — not consolidated,
per this phase's own "do not create a new audit framework merely to
organize existing audit helpers" instruction.

## 3. Event matrix (Phase 15B)

| # | Business action | Audit mechanism | Cardinality | Timing |
|---|---|---|---|---|
| 1–4 | Customer create/edit/delete/archive/restore | `onAudit` → `pushAudit` | 1 per action | Post-commit (`.then()` on `setCustomers`'s promise) |
| 5 | Vehicle create/edit/remove/archive/restore | `onAudit` → `pushAudit` | 1 per action | Post-commit |
| 6 | Job Card create/edit/status change | `pushAudit`, direct | 1 per save (status-change label takes priority over generic "Updated") | Post-commit, inside the same `try` as the guarded save |
| 7–10 | Invoice create/edit/finalization/deletion | `pushAudit` via `runPostCommitDerivedEffects` | 1 per transaction outcome | Post-commit |
| 11 | Payment | `pushAudit` via `runPostCommitDerivedEffects` (now labeled distinctly — see PH15-02) | 1 per confirmed, non-duplicate payment | Post-commit |
| 12 | Part create/edit/delete/archive/restore | `writeAudit`, direct | 1 per action (+1 extra `price_change` entry when cost/margin fields changed) | Post-commit |
| 13 | Stock adjustment | `writeAudit`, direct | 1 per confirmed, non-duplicate adjustment | Post-commit, gated on `!alreadyApplied` |
| 14 | Restock (3 entry points: PO receive, Quick Restock stepper, manual form) | `writeAudit`, direct | 1 per confirmed line/action | Post-commit, gated on `!alreadyApplied`/`!res?.alreadyApplied` |
| 15 | Quick Sell | `writeAudit`, direct | 1 per confirmed, non-duplicate sale | Post-commit, gated on `!alreadyApplied` |
| 16–17 | PO create/edit/receive | `writeAudit`, direct | 1 per action; receive is gated on `!res?.alreadyApplied` | Post-commit |
| 18–19 | Supplier CRUD/archive/restore | `writeAudit`, direct | 1 per action | Post-commit |
| 20 | Permission/role changes | `writeAudit`/direct writes to `appSettings/roles` | 1 per change | Post-commit |

No action in this matrix was found with an audit write positioned before
or outside its authoritative transaction's confirmed success (§8).

## 4. WHO verification (Phase 15C) — PH15-01, confirmed and fixed

`pushAudit`/`writeAudit` always correctly captured the real actor
(`user?.uid`/`user?.email`). **A separate, parallel mechanism did not**:
three modules maintain their own **embedded**, per-record history/notes
arrays (`customer.history[]`/`noteEntries[]`, `vehicle.history[]`/
`notesLog[]`, `invoice.history[]`) shown directly in each record's own
detail view — and all three hardcoded a static, non-identifying actor
placeholder for every production entry, regardless of which user actually
performed the action:

- `CustomersModule.jsx`: `by: demoMode ? 'Demo User' : 'Admin'` (2 sites)
- `VehiclesModule.jsx`: `by: demoMode ? 'Demo User' : 'Admin'` (1 site) and
  `by: 'You'` (1 site — a note feature that identified no one at all, in
  **any** mode, not even demo)
- `BillingModule.jsx`: `by: demoMode ? 'Demo User' : 'Staff'` (4 sites —
  invoice create/edit, payment, estimate conversion, status change)

**Tested**: User A performs an edit, User B performs a different edit —
before the fix, both entries said the identical fixed string, every time,
for every production user, on every one of these 8 call sites. This is a
genuine "audit says X but the real actor was Y" defect for every
production entry these paths ever wrote.

**Confirmed NOT a defect**: `pushAudit`'s own, separately-written entry for
the SAME underlying actions (e.g., "Invoice Created", "Customer Updated")
was always correctly attributed — so the SHARED, authoritative `auditLog`
answer to "who did this" was never wrong; only these three
records' own embedded, user-visible display fields were.

**Root cause**: the real actor's email was already computed once in
`InventoryDashboard.js` as `capacityActorEmail` and already passed as an
`actorEmail` prop into 6+ other child components (`JobCardModule`,
`SalesView`, `ServicesView`, `StockInView`, `StockOutView`, the
capacity-cleanup modal) for an unrelated purpose — but was never wired into
`CustomersModule`/`VehiclesModule`, and `BillingModule` already received
it yet never used it for its own `history[]` writes.

**Fix**: reused `capacityActorEmail`/`actorEmail` — the exact value already
flowing through this codebase for this exact purpose — at all 8 call
sites, replacing the hardcoded placeholders. Added `actorEmail` as a new
prop to `CustomersModule`/`VehiclesModule` (mirroring the identical,
already-established pattern used for the other 6 components);
`BillingModule` already had the prop and simply needed it used.

**Deliberately NOT changed**: Job Card's own `statusLog`/`notesLog`
attribute `by` to `card.advisor` (the case's assigned advisor — a genuine
business-domain field), not a bare placeholder. No evidence this is
unintentional (unlike the three bare literals above), and Job Card's
SEPARATE, correctly-attributed shared `auditLog` entries (via `pushAudit`)
already answer "who is logged in and did this" independently — changing an
established, user-visible convention on speculation was avoided per this
phase's "do not make speculative fixes" instruction.

## 5. WHAT verification (Phase 15D) — PH15-02, confirmed and fixed

Every audit action found already correctly distinguishes create vs. edit
vs. delete vs. archive vs. restore for every entity that supports all of
them (Part, Supplier, Customer, Vehicle) — no generic action was found
substituting for a more specific one, **except one**: a payment that did
**not** fully realize the invoice (a partial payment, or any payment after
the first) fell through `runPostCommitDerivedEffects`'s action ternary all
the way to the generic `'Invoice Updated'` label, with a `detail` string
showing only the invoice's total — identical to what any unrelated
line-item edit would also show. This is the exact "payment recorded as
generic invoice edit" failure mode this phase's own brief names as an
example to look for.

**Confirmed NOT a defect**: a payment that DOES fully realize the invoice
already correctly gets the more specific `'Invoice Paid'` label
(`becamePaid` check, unchanged, still checked first).

**Fix**: added a `newPayment` check — `next.payments.length` grew relative
to `prior.payments.length` — using data `collectInvoicePayment` already
produces (no new field, no new mechanism). When true and the invoice
wasn't also reversed in the same call, the action is now `'Payment
Received'` and the `detail` string shows the actual amount and mode
collected instead of the invoice's unrelated total.

## 6. WHEN verification (Phase 15F)

Both helpers use `serverTimestamp()` in production and
`new Date().toISOString()` in demo mode (no live Firestore to generate a
server timestamp against) — consistent semantics across both. The
timestamp represents **authoritative commit time** (the audit write
happens after the confirming `await`), not action-initiation or
enqueue time, for every call site checked in §8. Chronology for a
create→pay→realize sequence is explainable: "Invoice Created" always
precedes "Payment Received"/"Invoice Paid" in the shared log, since the
payment/realization audit write cannot execute before the create
transaction it depends on has already committed and returned.

## 7. RECORD-ID verification (Phase 15E)

`writeAudit`-based entries consistently key on the entity's own stable
Firestore document id (`partId`, `supplierId`) — never a name alone.
Invoice entries key on `invNo`, which (unlike Job Card's `jobNo`) is
allocated from a monotonically-increasing Firestore counter
(`counters/<sequence>`, Phase 2) and is never reused once issued — a safe,
human-readable, still-stable choice.

**One real, out-of-phase-scope limitation found**: Job Card audit entries
key on `jobNo`, which **is** the job card's own Firestore document id
(`idField: 'jobNo'`). `nextJobCardNumber` computes the next number purely
from the highest number seen in the **currently-existing** job cards array
(no persistent counter) — so a hard-**deleted** job card's number could in
principle be reissued to a later, different job card, and the audit log's
`entityId` for that number would then describe two different physical job
cards over time, distinguishable only by timestamp ordering within the
same collection. This is a Job Card **number-issuance** characteristic
(the same class of concern Phase 10 partially addressed for the
invoice-cross-reference case, PH10-01) — not something `pushAudit`/
`writeAudit` introduce, and fixing it would mean re-architecting Job Card
numbering (e.g., a persistent counter like invoices already have), which
is a materially larger change than "harden the audit log" and was judged
out of this phase's scope. Documented as a remaining limitation (§17), not
fixed here, per this phase's "do not manufacture a code change" /
"do not make speculative fixes" instructions — likelihood is low in
practice (Job Cards are far more commonly archived/status-changed than
hard-deleted).

## 8. Failed-operation audit testing (Phase 15N) — the critical check

Traced every stock/financial-adjacent write site's audit call against its
surrounding `try`/`catch` and idempotency guard:

- **PO receive**: the catch block (over-receipt, deleted PO, timeout)
  writes no audit entry at all; the success-path `writeAudit('po_receive',
  ...)` is gated on `!res?.alreadyApplied` and sits after `await
  poReceiveDoc(...)` inside the try.
- **Stock Adjustment**: `writeAudit('stock_adjustment', ...)` sits inside
  `if (!alreadyApplied)`, itself only reachable after the transaction's own
  try/catch already returned early on failure.
- **Quick Sell**: the production catch block returns before reaching
  `writeAudit('sell_part', ...)`; a retry that hits the opId-keyed
  idempotency guard also returns before it.
- **Payment**: the `conc/overpaid` rejection (PH11-02's guard) throws
  before the transaction's own write; callers only invoke
  `runPostCommitDerivedEffects` (the function that pushes the
  invoice/payment audit entry) after a confirmed, non-throwing result.
- **Manual restock**: `if (alreadyApplied) return {...}` comes before both
  of its `writeAudit` calls.
- **Supplier delete**: `writeAudit('delete_supplier', ...)` sits after
  both the parts-unlink `Promise.all` and the `deleteDoc` succeed, inside
  the same `try`.
- **Part create/edit**: `writeAudit('create_part'/'update_part'/
  'price_change', ...)` all sit after `await store.saveGuarded(...)`/
  `await setDoc(...)` inside the same `try`.

**No case was found** where an audit entry could be written describing an
operation that the authoritative transaction did not actually commit — the
dangerous "PO receive → transaction ABORTED → audit: 'PO received
successfully'" shape this phase explicitly warns against was not found
anywhere checked.

## 9. Duplicate-event results (Phase 15P)

Every opId-guarded write site's audit call is positioned **after** its own
`alreadyApplied`/idempotency check returns early — confirmed for Quick
Sell, Stock Adjustment, Restock (all three entry points), PO receive, and
Payment. A retry, double-click, or replayed delivery that the underlying
operation correctly recognizes as a duplicate does not produce a second
audit entry. Every opId-bearing audit entry additionally carries that same
opId in its own `details`, so even a hypothetical future regression that
did retry past a guard would leave duplicate audit rows traceable back to
one originating operation rather than looking like two unrelated events.

## 10. Missing-event results (Phase 15Q)

No business action in the matrix (§3) was found with zero audit coverage.
Customer/Vehicle lifecycle events reach the shared `auditLog`
**indirectly** (via an `onAudit` prop wired to `pushAudit`, since those are
child components without direct closure access) rather than directly —
initially looked like a gap during discovery, confirmed present once the
indirect wiring was traced.

## 11. Wrong-target results (Phase 15R)

Covered in §7 (RECORD-ID verification). Parts/Suppliers/Invoices all key on
stable, non-reused identifiers. Job Card's `jobNo`-as-document-id carries a
real but narrow, out-of-phase-scope reissue risk (documented, not fixed).

## 12. Concurrency/retry results (Phase 15S/15T)

Not re-run as a full suite (Phase 1–14 already own this territory) — cross-
checked specifically that the audit-write ordering holds under the same
guard every authoritative write already uses: a stale-`_rev`-rejected edit
throws before reaching its `pushAudit`/`writeAudit` call (true for every
guarded save checked — Part, Supplier, Job Card, Invoice), so Client B's
rejected concurrent edit in the classic "A succeeds, B gets stale `_rev`"
scenario never produces a misleading audit entry; only A's confirmed
commit does. The same idempotency markers this program's Phase 4b/8B
already built (`appliedReceiptIds`, opId-keyed docs) are what every
audit-gating check in §8/§9 relies on — reused, not re-derived.

## 13. Audit content verification (Phase 15U)

Spot-checked representative entries' full field sets against their source
business documents (via source tracing rather than a live write, per this
phase's production-safety mandate): `stock_adjustment`/`receive_stock`/
`sell_part` entries all carry `opId`, `partId`, `qty`, and either
`stockBefore`/`stockAfter` or `unitPrice`/`revenue` as appropriate — the
transaction's own fresh read values, not client-held snapshots (re-confirms
Phase 13's stale-snapshot findings weren't reintroduced here). Supplier/PO
entries carry `supplierId`/`poNumber` alongside a human-readable `name`.

## 14. Security/rules results (Phase 15V) — PH15-03, confirmed and fixed

`firestore.rules`'s `auditLog` match block: `allow read, create: if
signedIn(); allow update: if false; allow delete: if isAdmin();`. Update
is correctly unconditionally denied (append-only) and delete is correctly
admin-only — both matched the intended contract. **`create` did not
validate the document's content at all**: any signed-in user could write
an `auditLog` document with **any** `performedBy`/`performedByEmail`,
including a different user's uid — the rule enforced *that* a signed-in
user could create an entry, never *that* the entry accurately identified
its own creator. This is a genuine "can a user impersonate the actor
identity" gap this phase's own brief explicitly asks to check for.

**Fix**: `allow create: if signedIn() && request.resource.data.performedBy
== request.auth.uid;` — the same self-attribution pattern the
`pendingSales` collection's own rule already uses a few lines below,
reused rather than invented. Read access is unchanged (every signed-in
user can still read the shared trail); update/delete are unchanged.
Verified against the real Firestore Rules emulator (not just a text
match): a self-attributed create succeeds, an impersonation attempt is
denied, a missing `performedBy` is denied, reads/update/delete semantics
are all unchanged — `tests/rules/firestore.rules.test.cjs` (+5 new
assertions, 138/138 total, up from 133).

**Deployment note**: this repo's rules changes are not auto-deployed by
CI (`firebase.json` + `.github/workflows/ci.yml` run tests/build only) —
publishing this change to the live `balaji-auto-os-7` project requires the
same manual `firebase deploy --only firestore:rules` (or Firebase Console)
step this program's earlier concurrency phases (1b, 2) already documented
as the established practice. Flagged explicitly in the final output below.

## 15. Confirmed defects

| ID | Severity | Summary |
|---|---|---|
| PH15-01 | HIGH | Customer/Vehicle/Invoice embedded history/notes hardcoded a static actor placeholder ('Admin'/'You'/'Staff') for every production entry, never the real signed-in user — while the SHARED, authoritative `auditLog` was always correctly attributed via `pushAudit`/`writeAudit` |
| PH15-02 | MEDIUM | A partial (non-realizing) payment was audited as the generic 'Invoice Updated', indistinguishable from any unrelated edit — the invoice's own financial state remained correct throughout |
| PH15-03 | MEDIUM | `auditLog`'s Firestore rule allowed any signed-in user to write an entry with a forged `performedBy`, so the audit trail's own actor-identity field was not actually enforced server-side |

No CRITICAL defect found: no audit entry was found falsely claiming a
financially/inventory-significant operation succeeded when it had not.

## 16. Root causes

- **PH15-01**: `CustomersModule`/`VehiclesModule`/`BillingModule`'s own
  embedded per-record history features were each written independently of
  `pushAudit`/`writeAudit` (which already correctly captured real actor
  identity) and predate — or were never updated to use — the
  `capacityActorEmail`/`actorEmail` prop pattern established for a
  different purpose (capacity-cleanup banners) and later reused elsewhere.
- **PH15-02**: `runPostCommitDerivedEffects`'s action-classification ternary
  was written before partial payments were a distinctly-audited concept;
  its `becamePaid`/`unPaid` booleans only detect a REALIZATION state
  transition, not "a payment was added" in isolation.
- **PH15-03**: the `auditLog` rule was written to match the shared
  append-only ledger pattern (`sales`/`restocks`/`stockAdjustments`), which
  correctly need no content validation on create (they carry no
  forgeable actor-identity field) — `auditLog` does carry one
  (`performedBy`) and was never given the extra check that field needs.

## 17. Fixes

1. Reused `capacityActorEmail`/`actorEmail` (already computed and already
   passed to 6+ other components) at all 8 hardcoded-placeholder call
   sites across `CustomersModule.jsx`, `VehiclesModule.jsx`, and
   `BillingModule.jsx`; added `actorEmail` as a new prop to the first two
   (mirroring the identical existing pattern), wired from
   `InventoryDashboard.js`'s render calls.
2. Extended `runPostCommitDerivedEffects` with a `newPayment` check (diffed
   from data the function already receives) and a new `'Payment Received'`
   action + amount/mode-specific `detail`, used only when a payment was
   added but didn't also fully realize the invoice.
3. Tightened `auditLog`'s Firestore `create` rule to require
   `performedBy == request.auth.uid`, reusing `pendingSales`'s existing
   self-attribution pattern.

No new file, no new abstraction, no new framework — every fix reused an
existing value, an existing prop-passing convention, or an existing rules
pattern already proven elsewhere in this exact codebase.

## 18. Automated tests

`tests/audit-log-integrity.test.cjs` (new, 33 assertions): source-pattern
proofs of both helpers' shared contract (fire-and-forget, real actor
source, non-overlapping domains); the three PH15-01 fixes verified absent-
before/present-after at all 8 call sites; PH15-02's fix verified against
the real ternary ordering and detail-string construction; ordering proofs
for every failed-operation and duplicate-retry case in §8/§9 (correcting
two initial test-authoring bugs where a demo-mode branch's earlier
occurrence of the same call shadowed the production one being checked —
caught and fixed during this phase's own work, the same kind of
self-correction Phase 11/14's reports recorded); `tests/rules/
firestore.rules.test.cjs` (+5 new emulator assertions for PH15-03).

While applying the VehiclesModule.jsx fix, a first attempt added a 5-line
explanatory comment above the `addNote` fix, which pushed
`tests/vehicles-module.test.cjs`'s own fixed-width regex (`const addNote =
[\s\S]{0,500}notesLog:`) past its 500-character window, failing an
unrelated, pre-existing assertion (`addNote does not touch structured note
fields`). Caught by the full regression run (§19), not by this phase's own
new test file; fixed by trimming the comment (eventually removing it
entirely, since the code is self-evident and matches the other three
files' style) rather than widening the test's window — the smaller, more
targeted change.

## 19. Regression results

- `npm test`: **137/137** test files passed (136 previous + 1 new).
- `npm run test:rules`: **138/138** passed (133 previous + 5 new).
- `npx eslint .`: 0 errors (38 pre-existing warnings, unchanged).
- `npm run build`: succeeded.

## 20. Production validation

No customer, vehicle, invoice, part, supplier, or PO record was created,
edited, or moved against real data to verify these fixes — every finding
was established by source-code tracing and the emulator/pure-model tests
in §18, per this phase's explicit production-safety mandate.

**Deployment record:**
- **Commit:** `7b5520c` (`fix(audit): harden audit-log integrity`), pushed
  to `main`, deployed by Vercel.
- **Build verification:** `window.__NEXT_DATA__.buildId` read
  `rrbvmI8DBW3GBXkFLZqL6`, distinct from the prior known build id
  (`WZKw23TFpvholBJ5v8sLj`), confirming the new commit is live.
- **Console check:** zero console messages of any kind on load or after
  navigating to Customers.
- **Render check:** navigated to the Customers module (one of the four
  components this phase edited) — renders correctly with the new
  `actorEmail` prop wired in; existing customer data displays normally.
  No record was created, edited, or moved.

## 21. QA cleanup

None required — no QA/test data was created this phase.

## 22. Code-growth review

```
production lines added:      39   (components/*.js, *.jsx)
production lines removed:    13
net production change:       +26

firestore.rules lines added:  10
firestore.rules lines removed: 1
net rules change:             +9
```

Breakdown: `components/InventoryDashboard.js` +16/−3 (2 new `actorEmail`
prop-wiring args, the `newPayment` detection + action/detail branches for
PH15-02, explanatory comments); `components/billing/BillingModule.jsx`
+11/−4 (4 hardcoded-literal replacements + 1 explanatory comment);
`components/customers/CustomersModule.jsx` +9/−3 (1 new prop, 2
hardcoded-literal replacements, explanatory comments);
`components/vehicles/VehiclesModule.jsx` +3/−3 (1 new prop, 2
hardcoded-literal replacements — no added comment here, trimmed during
this phase's own work after it pushed a fixed-width test regex in
`tests/vehicles-module.test.cjs` past its window; see §18). `firestore.
rules` +10/−1 (1 line tightened, 6 lines of explanatory comment, plus the
read/create rule split from one line to two).

- **Significant new logic**: none. Every fix is either a literal
  replacement (an existing hardcoded string swapped for an existing prop),
  a small extension to an existing ternary using data the function already
  receives, or one added clause to an existing rule.
- **Existing mechanisms reused**: `capacityActorEmail`/`actorEmail` (already
  computed, already used by 6+ components); `collectInvoicePayment`'s own
  `payments[]` array (no new field); `pendingSales`'s established
  self-attribution rule pattern (`request.resource.data.<field> ==
  request.auth.uid`).
- **Unnecessary code removed**: none found beyond the literal replacements
  themselves (the old hardcoded strings).

Test/documentation growth (phase-mandated, not production):
`tests/audit-log-integrity.test.cjs` (new, ~230 lines), 5 new assertions
in `tests/rules/firestore.rules.test.cjs`, and this report (new).

## 23. Remaining limitations

- Job Card audit entries key on `jobNo`, which can in principle be
  reissued to a different job card after a hard delete (§7/§11) — a
  Job Card number-issuance characteristic, not an audit-helper defect;
  fixing it would require a persistent counter (Phase 2's own invoice
  pattern) and was judged out of this phase's scope.
- Job Card's own `statusLog`/`notesLog` attribute `by` to the assigned
  advisor, not the logged-in user — left as a possibly-intentional
  business convention, not changed on speculation (§4).
- The two audit helpers' differing entry shapes remain a code-organization
  observation, not consolidated (re-confirms Phase 14's own finding).
- The `firestore.rules` change (PH15-03) requires a manual publish to the
  live Firebase project — pushing to `main` alone does not change live
  enforcement (§14).
- Audit logging remains, by design, fire-and-forget and non-idempotent at
  the row level for the rare case where a caller retries past its own
  guard — documented, not hardened, since no such caller was found to
  exist (§9), and manufacturing durable audit-idempotency infrastructure
  without a proven need was explicitly out of scope.

## 24. Final PASS/FAIL assessment

**PASS.** No CRITICAL defect found — no audit entry was found falsely
claiming a financially/inventory-significant operation succeeded when it
had not. Three confirmed defects (one HIGH, two MEDIUM) found and fixed
with the smallest possible change, each reusing an already-established
mechanism in this exact codebase. All gates green.
