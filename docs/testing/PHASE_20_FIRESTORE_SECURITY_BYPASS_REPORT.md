# Phase 20 — Firestore Security-Rule Bypass / Field-Level Integrity

## 1. Rules architecture

`firestore.rules` is the only security boundary (the app is a client-only static
export; there is no server). Helper functions:

| Fn | Meaning |
|---|---|
| `signedIn()` | `request.auth != null` |
| `userEmail()` | `request.auth.token.email.lower()` (or `''`) |
| `ownerEmail()` | hardcoded `konabhargav2003@gmail.com` — mirrors `BOOTSTRAP_ADMINS` |
| `isAdmin()` | owner email **or** `userEmail() in get(appSettings/roles).data.admins` |

Three enforcement tiers:

1. **`signedIn()`** — single-shop trust: any authenticated staff member may
   read, create and update the operational collections.
2. **`isAdmin()`** — all hard **deletes**, all **`appSettings`** writes, all
   **recovery** access.
3. **Field-level invariants** — where a document carries an identity, a counter,
   or historical authority: `auditLog` (actor), `counters` (`next` monotonic +
   `hasOnly`), `editLocks` (`ownerUid`/`sessionId`/`expiresAt`), `pendingSales`
   (`createdBy` + shape), and the append-only ledgers (`update: if false`).

## 2. Collection-level matrix

| Collection | read | create | update | delete | field-level checks |
|---|---|---|---|---|---|
| parts, suppliers, categories, vehicles, customers, invoices, jobCards, purchaseOrders, reorderRequests | `signedIn` | `signedIn` | `signedIn` | **`isAdmin`** | — |
| sales, restocks, stockAdjustments | `signedIn` | `signedIn` | **`false`** | **`isAdmin`** | append-only |
| salesRollups | `signedIn` | `signedIn` | `signedIn` | **`isAdmin`** | — (derived aggregate) |
| **auditLog** | `signedIn` | `signedIn` **+ `performedBy == request.auth.uid` + `performedByEmail == request.auth.token.email` + `createdAt == request.time`** | **`false`** | **`isAdmin`** | **actor identity + server time (PH15 + PH20)** |
| **appSettings/{docId}** | `signedIn` | **`isAdmin`** | **`isAdmin`** | **`false`** | admin-only write, no delete |
| recoveryVault/{id} | **`isAdmin`** | **`isAdmin`** | **`false`** | **`isAdmin`** | admin-only, no update |
| recoveryMeta/{id} | `signedIn` | **`isAdmin`** | **`isAdmin`** | **`isAdmin`** | admin-only write |
| **editLocks/{lockId}** | `signedIn` | `signedIn` **+ `incomingShapeOk()`** (`ownerUid == auth.uid`, `sessionId is string`, `expiresAt ∈ (now, now+3m]`) | `signedIn` **+ ((`expired()` & `incomingShapeOk()`) \| (`ownedByMe()` & `sameSession()` & (`incomingShapeOk()` \| `releaseShapeOk()`)))** | `signedIn` **+ `expired()`** | ownership + session + expiry bound |
| **pendingSales/{opId}** | `signedIn` **+ `resource.data.createdBy == auth.uid`** | `signedIn` **+ `createdBy == auth.uid` + `partId is string` + `want is int > 0`** | **`false`** | `signedIn` **+ `resource.data.createdBy == auth.uid`** | creator scope + shape |
| **counters/{sequence}** | `signedIn` | `signedIn` **+ `hasOnly(['next'])` + `next is int >= 1`** | `signedIn` **+ `hasOnly(['next'])` + `next is int >= resource.data.next`** | **`false`** | monotonic, no field injection, no delete |
| `{document=**}` | **`false`** | **`false`** | **`false`** | **`false`** | deny-by-default |

## 3. Protected-field inventory

| Field | Where | Classification | Basis |
|---|---|---|---|
| `auditLog.performedBy` | auditLog | **FIRESTORE-PROTECTED** | `== request.auth.uid` (PH15-03) |
| `auditLog.performedByEmail` | auditLog | **FIRESTORE-PROTECTED (PH20 fix)** | `== request.auth.token.email` — this is the string the Audit UI displays |
| `auditLog.createdAt` | auditLog | **FIRESTORE-PROTECTED (PH20 fix)** | `== request.time` — no back-dating |
| `auditLog.action / entity / entityId / details` | auditLog | INTENTIONALLY CLIENT-WRITABLE | free-form; a fabricated event is now stamped with the fabricator's real uid+email+time, so it is attributable, not an impersonation |
| `counters.next` | counters | **FIRESTORE-PROTECTED** | monotonic (`>=`), `hasOnly(['next'])`, `is int`, no delete |
| `editLocks.ownerUid` | editLocks | **FIRESTORE-PROTECTED** | `create`/`takeover` require `== request.auth.uid` |
| `editLocks.sessionId` | editLocks | **FIRESTORE-PROTECTED** | `sameSession()` gates renew/release of an active lease (PH7-27) |
| `editLocks.expiresAt` | editLocks | **FIRESTORE-PROTECTED** | must be `∈ (now, now+3m]` on a claim; `<= now` on a release |
| `pendingSales.createdBy` | pendingSales | **FIRESTORE-PROTECTED** | `== request.auth.uid` on create; read/delete scoped to it |
| `pendingSales.want` | pendingSales | **FIRESTORE-PROTECTED** | `is int > 0` |
| `appSettings/roles.admins[]`, `.staff{}` | appSettings | **FIRESTORE-PROTECTED** | entire doc `create,update: if isAdmin()` |
| business-settings fields (`appSettings/biz`, etc.) | appSettings | **FIRESTORE-PROTECTED** | same admin-only rule |
| `sales/restocks/stockAdjustments` every field incl. `amount`, `qty`, `opId` | ledgers | **FIRESTORE-PROTECTED** (immutable) | `update: if false` overrides even admin |
| `invoice.status / paid / balance / grandTotal / subtotal` | invoices | **DERIVED** | recomputed by `deriveStatus`/`invoiceTotals` from `lines`+`payments` on every read — a forged stored scalar is ignored by the money path |
| `invoice.payments[]` | invoices | **APPLICATION-ENFORCED** | source of truth for money received; double-realization blocked by the diff-based idempotent cascade + `pay.id` transaction guard; a forged array does NOT trigger any stock/ledger side-effect (the realization cascade runs only from the app's own `persistInvoice`/`collectInvoicePayment`/`deleteInvoice` handlers, never from the invoices snapshot listener) |
| `invoice.discount / gst / lines[].rate` | invoices | INTENTIONALLY CLIENT-WRITABLE | single-shop; the invoice editor writes them directly; totals re-derive |
| `part.stock` | parts | INTENTIONALLY CLIENT-WRITABLE | the app writes `parts.stock` directly in every stock op; a staffer already adjusts it via the UI; the authoritative movement record is the **immutable** `restocks`/`stockAdjustments`/`sales` ledger |
| `part.salesCount` | parts | INTENTIONALLY CLIENT-WRITABLE / DERIVED | drives the "fast mover" badge only; recomputable from `sales` |
| `part.appliedReserveIds`, `*.opId` markers | parts / ledgers | APPLICATION-ENFORCED | idempotency de-dup keys, not authorization; a forged marker at worst skips a legit retry — it cannot create a phantom sale |
| `_rev` | all guarded entities | APPLICATION-ENFORCED | optimistic-concurrency hint; the client `guardedSet` transaction enforces it — not a security field |
| `createdAt / createdBy / updatedAt` (non-audit) | customers, parts, … | INTENTIONALLY CLIENT-WRITABLE | single-shop; no authorization anywhere keys on a business record's `createdBy` |
| `archived / deletedAt / terminal status` | customers, invoices, POs, jobCards | APPLICATION-ENFORCED (state machine, Phase 17) | soft, reversible; `capacityService` eligibility + `applyPoReceive`/`setStatus` guards |
| `role`, `isAdmin`, permission flags | — | **N/A — no such writable field exists** | role is derived in `isAdmin()` from `appSettings/roles` (admin-write-only) + the hardcoded owner email |

## 4. Unauthenticated read results (Phase 20C)

Emulator, `unauthenticatedContext()`:

| Collection | Result |
|---|---|
| customers, invoices, parts, suppliers, purchaseOrders, sales, restocks, stockAdjustments, auditLog, appSettings, counters, editLocks, pendingSales, recoveryMeta, salesRollups, reorderRequests | **DENIED** ✅ |
| recoveryVault | **DENIED** ✅ (stricter — `isAdmin()`) |

**17/17 collections deny unauthenticated read.** Live-confirmed on `balaji-auto-os-7`:
unauthenticated REST reads of `auditLog` / `invoices` / `counters` / `appSettings`
/ `recoveryVault` / `parts` all return **`403 PERMISSION_DENIED`**.

## 5. Unauthenticated write results (Phase 20D)

Emulator + live REST:

| Attempt | Result |
|---|---|
| create / update / delete invoice | **DENIED** ✅ |
| create sales row | **DENIED** ✅ |
| create auditLog entry | **DENIED** ✅ (live: `403 PERMISSION_DENIED`, nothing written) |
| write appSettings/roles | **DENIED** ✅ |
| advance counter | **DENIED** ✅ |
| create editLock | **DENIED** ✅ |
| create pendingSales | **DENIED** ✅ |
| read recoveryVault | **DENIED** ✅ |

**Firestore itself rejects every unauthenticated write** — independent of the UI
redirect.

## 6. Authenticated delete results (Phase 20E)

Emulator, non-admin (`staff-uid`) vs admin:

| Collection | staff delete | admin delete |
|---|---|---|
| customers, invoices, jobCards, parts, suppliers, purchaseOrders, reorderRequests | **DENIED** ✅ | **ALLOWED** ✅ |
| sales, restocks, stockAdjustments, salesRollups, auditLog | **DENIED** ✅ | ALLOWED (admin — the owner-only "Reset All Data" path, which snapshots first) |
| appSettings | **DENIED** (even admin — `delete: if false`) | **DENIED** ✅ |
| counters | **DENIED** (even admin — `delete: if false`) | **DENIED** ✅ |
| recoveryVault | **DENIED** ✅ | ALLOWED |
| editLocks (active) | **DENIED** ✅ | **DENIED** (only an expired lease is deletable) |
| pendingSales (another user's) | **DENIED** ✅ | **DENIED** (creator-scoped, not admin-scoped) |

Matches Phase 19's matrix exactly. No regression from this phase's rule edit.

## 7. Counter manipulation (Phase 20F / 20R)

Seeded `counters/invoices = { next: 10 }`, authenticated non-admin:

| Attempt | Expected | Actual |
|---|---|---|
| `next` 10 → 9 (decrease) | DENY | **DENY** ✅ |
| `next` → 0 | DENY | **DENY** ✅ |
| `next` → 1 (reset) | DENY | **DENY** ✅ |
| `next` → 9.5 (non-int) | DENY | **DENY** ✅ |
| `next` → `"9999"` (string) | DENY | **DENY** ✅ |
| `{ next: 11, hijack: true }` (extra field) | DENY | **DENY** ✅ (`hasOnly`) |
| `deleteDoc(counters/invoices)` | DENY | **DENY** ✅ |
| `next` 10 → 11 (legit advance) | ALLOW | **ALLOW** ✅ |
| `next` 11 → 100000 (large forward jump) | ALLOW | **ALLOW** — **INFO**, §22 |
| create `counters/estimates` with `next: 0` | DENY | **DENY** ✅ |
| create with an extra field | DENY | **DENY** ✅ |

The **monotonic-numbering security invariant** ("no duplicate legal invoice
serials") is intact. A large *forward* jump is permitted by `next >= resource.data.next`
— classified **INFO** (§22): it burns number space and looks odd but creates no
duplicate serial, corrupts no data, loses no money, and a trusted staffer could
cause a jump by rapid billing anyway. Tightening to an upper bound risks breaking
the deliberate `>=` (transaction-retry) semantics the rule comment explains — not
worth it.

## 8. appSettings manipulation (Phase 20G / 20S)

Authenticated non-admin (`staff-uid`), roles doc seeded with a *different* admin:

| Attempt | Actual |
|---|---|
| update `appSettings/biz.shopName` (business settings) | **DENIED** ✅ |
| add self to `appSettings/roles.admins[]` | **DENIED** ✅ |
| merge-write `appSettings/roles.staff[self] = { deletes: true }` | **DENIED** ✅ |
| create a brand-new `appSettings/evil` doc | **DENIED** ✅ |
| inject `{ isAdmin: true, role: 'owner' }` onto `appSettings/biz` | **DENIED** ✅ |
| delete any `appSettings` doc | **DENIED** ✅ (`delete: if false`, even for admin) |
| **cross-doc**: write roles to list self, then do an admin action | **DENIED at step 1** — the escalation chain never starts |
| admin: legitimately update `appSettings/roles.admins` | **ALLOWED** ✅ |

**A Staff user cannot touch anything under `appSettings`** — business settings,
the admin list, or per-staff permissions. No role escalation.

## 9. Ledger modification (Phase 20H / 20Q)

Seeded a row in each of `sales` / `restocks` / `stockAdjustments`:

| Attempt | Actual |
|---|---|
| staff CREATE a new row | **ALLOWED** — the app appends rows; not a bypass |
| staff UPDATE `row1.amount` (rewrite an authoritative figure) | **DENIED** ✅ |
| staff UPDATE `row1.opId` (rewrite the idempotency marker) | **DENIED** ✅ |
| **admin** UPDATE `row1` | **DENIED** ✅ — append-only overrides admin |
| staff DELETE `row1` | **DENIED** ✅ (admin-only) |
| staff UPDATE `salesRollups/2026-01` | **ALLOWED** — **INFO** (a derived running aggregate, fully recomputable from the immutable `sales` ledger; the app increments it on every quick-sell / payment realization; cannot be `update: if false`) |
| staff DELETE `salesRollups` | **DENIED** ✅ |

**No client — staff or admin — can rewrite or delete a historical authoritative
ledger row.** The critical invariant holds exactly.

## 10. Audit-log actor forgery (Phase 20I) — **CONFIRMED DEFECT, FIXED**

Authenticated non-admin (`uid-A`, `staff@shop.test`):

| Attempt | Expected | **Before fix** | After fix |
|---|---|---|---|
| create entry: own uid + own email + `serverTimestamp()` | ALLOW | ALLOW | **ALLOW** ✅ |
| create entry: `performedBy` = another uid | DENY | DENY ✅ (PH15-03) | **DENY** ✅ |
| create entry: `performedBy` missing | DENY | DENY ✅ | **DENY** ✅ |
| create entry: own uid, **`performedByEmail` = `owner@shop.test`** (impersonate the displayed actor) | DENY | **ALLOW ❌ DEFECT** | **DENY** ✅ |
| create entry: own uid, `performedByEmail` = `"System"` | DENY | **ALLOW ❌** | **DENY** ✅ |
| create entry: `performedByEmail` missing | DENY | **ALLOW ❌** | **DENY** ✅ |
| create entry: client-supplied **past** `createdAt` (back-date history) | DENY | **ALLOW ❌** | **DENY** ✅ |
| create entry: client-supplied **future** `createdAt` | DENY | **ALLOW ❌** | **DENY** ✅ |
| UPDATE an existing entry (change actor) | DENY | DENY ✅ | **DENY** ✅ |
| DELETE an existing entry (non-admin) | DENY | DENY ✅ | **DENY** ✅ |

**The defect:** PH15-03 pinned `performedBy` (the uid), but the Audit Log UI
displays **`performedByEmail`** (`components/InventoryDashboard.js` lines 4259,
4267 — `e.performedByEmail || 'unknown'`), which the rule left unconstrained. A
signed-in staffer could `POST` to Firestore an audit entry showing **another
user** (e.g. the owner) performing **any action** at **any time** — real history
could not be *erased* (`update: if false`, `delete: if isAdmin()`) but a forged
entry could be *inserted*. `createdAt` was likewise unconstrained → back-dating.

**Severity: MEDIUM.** Security-sensitive field forgeable via direct Firestore, but
bounded: single-shop trusted-staff model; the cryptographic `performedBy` uid was
still correct (forensically recoverable); no privilege escalation; history
immutable. "An important field-level invariant is missing from the rules but
application logic currently compensates" — the app's own writers always set the
right values. Fixed because it *completes* the invariant PH15-03 established.

## 11. Edit-lock manipulation (Phase 20J)

Seeded `editLocks/customers__c1` = an ACTIVE lease owned by `uid-A` / `sess-A`:

| Attempt (by `uid-B` unless noted) | Actual |
|---|---|
| create a lock claiming `ownerUid = A` | **DENIED** ✅ (`incomingShapeOk` requires `== request.auth.uid`) |
| overwrite A's active lock (own uid, steal it) | **DENIED** ✅ (`expired()` false, `ownedByMe()` false) |
| extend A's active lock's `expiresAt` | **DENIED** ✅ |
| delete A's active lock | **DENIED** ✅ (`delete: if expired()` only) |
| **`uid-A`, DIFFERENT session** (`sess-A-tab2`): overwrite own active lock | **DENIED** ✅ — `sameSession()` (PH7-27) |
| `uid-A`: claim with a >3-minute `expiresAt` (hold forever) | **DENIED** ✅ |
| `uid-A`, same session: renew own active lock | **ALLOWED** ✅ |

**`ownerUid` + `sessionId` cannot be forged to take over another user's — or even
another tab of the same user's — active editor lease.**

## 12. pendingSales isolation (Phase 20K)

`uid-A` creates `pendingSales/psA` (`createdBy: uid-A`):

| Attempt | Actual |
|---|---|
| A: create own pending sale | **ALLOWED** ✅ |
| A: create with `createdBy = uid-B` (forge the creator) | **DENIED** ✅ |
| A: create with `want = 0` / `want = -5` (shape) | **DENIED** ✅ |
| B: READ A's pending sale | **DENIED** ✅ |
| B: UPDATE A's pending sale | **DENIED** ✅ (also `update: if false`) |
| B: DELETE A's pending sale (fake a replay) | **DENIED** ✅ |
| A: UPDATE own pending sale | **DENIED** ✅ (create-once/delete-once) |
| A: DELETE own pending sale (reconciled) | **ALLOWED** ✅ |

**Strictly creator-scoped.** `createdBy` and `opId` cannot be forged; the doc is
unreachable by any other user.

## 13. Financial field forgery (Phase 20L)

Authenticated non-admin, seeded `invoices/i1` (with `lines` + empty `payments`):

| Attempt | Firestore | Classification |
|---|---|---|
| `updateDoc(i1, { paid: 999999, balance: 0, status: 'Paid', grandTotal: 1 })` | **ALLOWS** | **DERIVED** — `deriveStatus`/`invoiceTotals` recompute from `lines`+`payments` on every read; the stored scalar is advisory. **No `sales` row, no `salesRollups` bump, no stock movement** — the realization cascade runs *only* from the app's own `persistInvoice`/`collectInvoicePayment`/`deleteInvoice` handlers (each a re-reading transaction), never from the invoices snapshot listener. A forged invoice doc gives a staffer nothing they can't already do via the UI's "Collect Payment", and it cannot corrupt the immutable ledger. |
| inject `{ isAdmin: true, role: 'owner', internal: true }` onto the invoice | **ALLOWS** | **INFO** — no code path anywhere reads a privilege/role field off an invoice doc; there is no schema-driven authorization. |
| `deleteDoc(i1)` | **DENIES** ✅ | **FIRESTORE-PROTECTED** — the real boundary (admin-only). |

**Not a defect.** This is exactly the "architecture intentionally allows
authenticated clients to update financial records while business invariants are
enforced by transaction code + immutable ledgers" case.

## 14. Inventory field forgery (Phase 20M)

| Attempt | Firestore | Classification |
|---|---|---|
| `updateDoc(p1, { stock: 999999, salesCount: 999999 })` | **ALLOWS** | **INTENTIONALLY CLIENT-WRITABLE** — the app writes `parts.stock` directly in every stock op (`handleSaveInner`, `commitStock`, restock, adjust); a trusted staffer already changes stock via the UI. The authoritative movement history is the **immutable** `restocks` / `stockAdjustments` / `sales` ledger, which a forged `parts` write cannot touch. |
| write forged `appliedReserveIds` / `*.opId` markers onto the part | **ALLOWS** | **INFO** — markers are idempotency de-dup keys, not authorization. A forged marker at worst causes a legit retry to be skipped; it **cannot manufacture a phantom sale** (a sale is one atomic transaction that writes the immutable `sales` row + the stock decrement together). |
| `deleteDoc(p1)` | **DENIES** ✅ | **FIRESTORE-PROTECTED** — admin-only. |

**Not a defect.** No security or authoritative-state invariant is violated.

## 15. System field forgery (Phase 20N)

| Field | Attempt | Firestore | Classification |
|---|---|---|---|
| `customer.createdAt` / `_rev` / `createdBy` | staff overwrites all three | **ALLOWS** | **INFO** — single-shop; `_rev` is a client-transaction concurrency hint, not a security field; no authorization keys on a business record's `createdBy`; `createdAt` on non-audit docs is display-only |
| `auditLog.createdAt` | client-supplied value | **DENIES** ✅ (PH20 fix) | **FIRESTORE-PROTECTED** — `== request.time` |
| `editLocks.expiresAt` | far-future value | **DENIES** ✅ | **FIRESTORE-PROTECTED** — bounded |
| `counters.next` | any non-monotonic value | **DENIES** ✅ | **FIRESTORE-PROTECTED** |

The system fields that are **security-sensitive** (audit time, lease expiry,
counter state) are all rules-protected. The rest are single-shop display metadata.

## 16. Forged create fields (Phase 20O)

| Create with a forged field | Result |
|---|---|
| `auditLog` with `performedBy` = another uid | **DENIED** ✅ |
| `auditLog` with a forged `performedByEmail` | **DENIED** ✅ (PH20) |
| `editLock` with `ownerUid` = another uid | **DENIED** ✅ |
| `counter` with `next` < 1 or an extra field | **DENIED** ✅ |
| `pendingSale` with `createdBy` = another uid | **DENIED** ✅ |
| `appSettings/*` doc (any) by a non-admin | **DENIED** ✅ |
| `customer` with `createdBy` = another uid | **ALLOWED** — INFO (no authorization uses it) |

## 17. Extra-field injection (Phase 20P)

| Doc | Injected field | Result |
|---|---|---|
| `counters` | `{ next: 11, hijack: true }` | **DENIED** ✅ (`hasOnly(['next'])`) |
| `appSettings/biz` | `{ isAdmin: true, role: 'owner' }` | **DENIED** ✅ (whole doc admin-only) |
| `invoice` | `{ isAdmin: true, role: 'owner', internal: true }` | **ALLOWED** — INFO: no code reads a privilege field off an invoice; **there is no schema-driven privilege anywhere in the app**, so an extra field on a business doc is inert junk, not an escalation |
| `part` | `{ someOpId: 'x' }` | **ALLOWED** — INFO (inert) |

The two documents where a stray field *could* matter (`counters`, `appSettings`)
are locked. Everywhere else, the app's authorization derives from `appSettings/roles`
+ the hardcoded owner email — never from a field on a business record — so
arbitrary extra fields create no risk.

## 18. Immutable fields (Phase 20Q)

| Collection | Immutable via | Verified |
|---|---|---|
| `sales` / `restocks` / `stockAdjustments` — every field | `update: if false` | staff **and** admin update DENIED ✅ |
| `auditLog` — every field | `update: if false` | update DENIED ✅ |
| `counters.next` — cannot decrease | `next >= resource.data.next` | decrease / reset DENIED ✅ |
| `editLocks.ownerUid` / `sessionId` on an active lease | `ownedByMe() && sameSession()` | cross-user & cross-session change DENIED ✅ |
| `pendingSales.createdBy` | `update: if false` + creator-scoped | any update DENIED ✅ |
| `appSettings` — no delete | `delete: if false` | delete DENIED (even admin) ✅ |

## 19. Counter monotonicity (Phase 20R)

Current `next = 10`: `→ 9`, `→ 8`, `→ 0`, `→ 1` all **DENIED**; `→ 11`, `→ 100000`
**ALLOWED** (monotonic); `deleteDoc` **DENIED**. The application transaction layer
(`lib/docCounter.js`) owns *allocation*; the **rule** owns the *safety property*
(never decreases, never deleted, no other field). Both verified.

## 20. Cross-document bypass (Phase 20S)

| Chain | Broken at |
|---|---|
| write own `appSettings/roles` to list self as admin → then do an admin action | **step 1** — `appSettings create,update: if isAdmin()`, and a non-owner with no roles doc is not admin, so cannot bootstrap |
| forge `auditLog` actor → impersonate | **the write** — PH20 fix pins `performedBy` + `performedByEmail` + `createdAt` |
| forge `editLock` owner → lease takeover | **the write** — `ownerUid == request.auth.uid` + `sameSession()` |
| forge `pendingSales` creator → reach another user's op | **the write** — `createdBy == request.auth.uid`; read/delete scoped |
| manipulate `counters` → obtain a chosen invoice number | partially — a *forward* jump to a chosen number is allowed (INFO §22); a *reused/lower* number is DENIED (the invariant that matters) |
| alter `invoice` fields to appear paid → trigger realization | **no trigger** — the realization cascade never runs from a remote invoice change; §13 |

The rules validate **both** `resource.data` and `request.resource.data` wherever
identity or monotonicity is at stake (`editLocks` `sameSession()` compares old
`resource.data.sessionId` to new `request.resource.data.sessionId`; `counters`
compares `request.resource.data.next` to `resource.data.next`; `pendingSales`
read/delete key on `resource.data.createdBy`).

## 21. Application-vs-rules comparison (Phase 20T)

| Case | App says | Firestore says | Classification |
|---|---|---|---|
| Staff deletes a customer/invoice/part | DENY (`canManage` / `canDelete` hidden) | **DENY** (`delete: if isAdmin()`) | **INTENTIONAL LAYERING** — both agree, Firestore authoritative |
| Staff edits an invoice's stored `paid`/`status` | app never writes it that way; editor re-derives | ALLOW (`update: if signedIn()`) | **INTENTIONAL LAYERING** — derived-on-read; single-shop |
| Staff-with-`perms.deletes` clicks "Delete Permanently" on a part | ALLOW (button shown) | **DENY** (`delete: if isAdmin()`) | **UX ISSUE** (Phase 19 LOW / PH19-L1) — security is correct; the toggle over-promises. Firestore must stay the boundary; not weakened. |
| Staff forges `auditLog.performedByEmail` via REST | N/A (app always writes the real email) | **was ALLOW → now DENY** | **was a SECURITY ISSUE → FIXED (PH20-01)** |
| Staff writes `salesRollups` directly | app writes it (quick-sell / realization) | ALLOW | **INTENTIONAL LAYERING** — derived aggregate |
| Counter forward-jump | app never does it | ALLOW | **INTENTIONAL** (`>=` for txn-retry compat) — INFO |

## 22. Confirmed defects

### PH20-01 — auditLog actor/time forgery via direct Firestore (MEDIUM) — **FIXED**

The `auditLog` `create` rule pinned `performedBy` (uid) but not `performedByEmail`
(the string the Audit UI displays) or `createdAt`. A signed-in staffer could
`POST` an audit entry that shows another user performing any action at any time.
History could not be erased (`update: if false`, `delete: if isAdmin()`), but a
forged entry could be inserted. **Confirmed in the emulator** (5 forgery vectors
succeeded against the pre-fix rule).

### INFO / INTENTIONAL (no fix — the security boundary is correct)

| Ref | Observation | Class |
|---|---|---|
| PH20-I1 | `counters.next` accepts an arbitrarily large **forward** jump (`>=`). Monotonic invariant (no duplicate serials) holds; a jump burns number space only. A trusted staffer could also jump the counter by rapid billing. Tightening risks the deliberate `>=` (txn-retry) semantics. | INFO |
| PH20-I2 | `invoice.status/paid/balance/grandTotal` are directly writable by any signed-in user. **DERIVED** — recomputed from `lines`+`payments` on every read; a forged scalar is ignored by the money path and triggers no ledger/stock side-effect. | INTENTIONAL |
| PH20-I3 | `part.stock/salesCount` are directly writable. **INTENTIONALLY CLIENT-WRITABLE** — the app writes them directly; authoritative history is the immutable ledger. | INTENTIONAL |
| PH20-I4 | `salesRollups` `update: if signedIn()` (not `if false` like the ledgers). Derived running aggregate, recomputable from `sales`. | INTENTIONAL |
| PH20-I5 | Extra fields can be added to `invoices` / `parts` / `customers`. No schema-driven authorization anywhere — inert junk, not an escalation vector. `counters` and `appSettings` (where it would matter) are locked. | INTENTIONAL |
| PH20-I6 | `_rev` / `createdAt` / `createdBy` on non-audit business docs are client-writable. Single-shop; `_rev` is a client-transaction concurrency hint, not a security field. | INTENTIONAL |

## 23. Root causes

**PH20-01** — PH15-03 correctly identified "audit actor is a security invariant"
and pinned `performedBy`. It was written from the write path (`pushAudit` sets
`performedBy: user.uid`) rather than the *read* path — and the Audit Log UI reads
`performedByEmail`, a field the rule never saw. A secondary root cause:
`capacityService.writeCapacityAudit` wrote `performedBy: null` (a permanent-delete
audit entry with no actor uid), which a strict `performedBy == uid` rule would
have rejected — so the rule could not simply be tightened without also fixing that
writer.

## 24. Fixes

**Fix 1 — `firestore.rules` (auditLog `create`): +2 clauses.**
```
allow create: if signedIn()
  && request.resource.data.performedBy == request.auth.uid
  && request.resource.data.performedByEmail == request.auth.token.email   // PH20 — the DISPLAYED actor
  && request.resource.data.createdAt == request.time;                     // PH20 — no back-dating
```
REUSES the exact self-attribution pattern PH15-03 / `pendingSales` already use.
No new helper. `update: if false` / `delete: if isAdmin()` unchanged.

**Fix 2 — `services/capacityService.js` `writeCapacityAudit`: +7 net lines.**
A capacity cleanup permanently deletes records; its audit entry must carry the
real signed-in identity, not `performedBy: null`. Now:
```js
import { auth } from '../lib/firebase';
const u = demoMode ? null : auth.currentUser;
// ...
performedBy: u ? u.uid : null,
performedByEmail: u ? u.email : (actorEmail || null),
```
`auth.currentUser` is the *same identity the rules see*; a cleanup is only
reachable from a signed-in session. Demo (never Firestore) is unchanged. This is
also a genuine integrity improvement independent of the rule.

**Fix 3 — `package.json`: 1 line.** `test:rules` now runs `tests/rules/run-all.cjs`
(a 20-line runner mirroring `tests/run-all.cjs`) so the emulator suite is two
files instead of one.

`pushAudit` / `writeAudit` already wrote `performedBy: user.uid` +
`performedByEmail: user.email` + `createdAt: serverTimestamp()` — **no change
needed** to the two main writers.

## 25. Automated tests

**NEW: `tests/rules/security-bypass.rules.test.cjs` — 111 emulator assertions.**
Field-level forgery matrix, independent expectations: unauthenticated
read+write (20C/20D); auditLog actor/time forgery incl. the 5 pre-fix vectors
(20I/20O/20Q); counter decrement / reset / non-int / extra-field / delete /
forward-jump (20F/20R); appSettings by staff — business settings, admins, staff
perms, extra fields (20G/20S); ledger immutability incl. admin-still-denied
(20H/20Q); editLock forge/steal/cross-session/hold-forever (20J); pendingSales
cross-user + shape (20K); financial/inventory/system field forgery classified
honestly as ALLOW-but-not-a-bypass (20L/20M/20N/20P); authenticated delete matrix
(20E); cross-document escalation broken at step 1 (20S).

**EXTENDED: `tests/rules/firestore.rules.test.cjs`** — the PH15 auditLog block now
also asserts a different `performedByEmail` and a back-dated `createdAt` are
DENIED, and the legit self-entry (uid + email + server time) is ALLOWED. **150
assertions** (was 148, one rewritten to the full valid shape).

**Runner:** `tests/rules/run-all.cjs`. `npm run test:rules` → **261 / 261** across
2 files.

Static tests updated for the stronger rule text (1–2 lines each, intent
unchanged): `tests/audit-log-integrity.test.cjs`,
`tests/authorization-matrix-integrity.test.cjs`,
`tests/validation-bypass-integrity.test.cjs`, `tests/capacity-management.test.cjs`
(the last also gains a Phase-20 assertion that the capacity audit carries the real
uid).

## 26. Live website checks (Phase 20V)

Safe checks only (no forged/destructive writes against production):

| Check | Result |
|---|---|
| unauthenticated `/` | redirected to `/login` |
| unauthenticated Firestore REST read — `auditLog`, `invoices`, `counters`, `appSettings`, `recoveryVault`, `parts` | **all `403 PERMISSION_DENIED`** |
| unauthenticated Firestore REST **create** on `auditLog` | **`403 PERMISSION_DENIED`** — nothing written |
| role-based UI (Demo guest vs Demo admin Settings) | matches Phase 19 — admin sections require a real production admin login |

The `performedByEmail` clause could not be live-verified — that requires an
authenticated forge attempt, and no test credentials are available (Phase 20X
forbids using real ones). The base `signedIn()` boundary is confirmed live.

## 27. QA cleanup

- No production data written. One unauthenticated `auditLog` POST probe was made
  against `balaji-auto-os-7` — it returned `403` and wrote nothing.
- No roles changed. No test credentials created or committed.
- Emulator data is ephemeral (`clearFirestore()` per block; `emulators:exec` tears
  the emulator down).

## 28. Code-growth review

| | |
|---|---|
| Production lines added | **~+25** (`firestore.rules` +16, `capacityService.js` +9) |
| Production lines removed | **~−11** (`firestore.rules` −9 old comment, `capacityService.js` −2) |
| Net production change | **~+14** (of which ~10 are expanded rule/code comments) |
| `firestore.rules` — logic added | **2 clauses** (`performedByEmail ==`, `createdAt ==`) |
| `firestore.rules` — logic removed | 0 |
| New production functions | **0** |
| New production files | **0** |
| New abstractions | **0** |
| Existing rules/helpers reused | the PH15-03 `== request.auth.uid` self-attribution pattern; `request.auth.token.email`; `request.time`; `auth.currentUser`; `tests/rules/helpers.cjs`; the `tests/run-all.cjs` runner shape |
| Unnecessary code removed | none required |
| Significant new security logic | **the two auditLog `create` clauses** — needed because the rule protected the uid (which nothing displays) but not the displayed actor email or the timestamp, so a signed-in client could still insert an impersonating / back-dated entry. Application code could not "handle it" — the whole point is that a client bypassing the app must be stopped at the rules layer. |
| `package.json` | 1 line (test runner) |
| New test lines | `tests/rules/security-bypass.rules.test.cjs` ~280, `tests/rules/run-all.cjs` ~20 |

## 29. Remaining limitations

- **`firestore.rules` is not deployed to `balaji-auto-os-7`.** The base ruleset
  (deny-by-default, `signedIn()` reads, `isAdmin()` deletes, `appSettings`
  admin-only, ledger `update: if false`, counter monotonicity) IS live — confirmed
  by live `403` responses. But the `auditLog` `create` rule on the live project is
  the pre-Phase-15 form (`create: if signedIn()`), so **until the owner deploys,
  a signed-in client can still forge an `auditLog` entry** (uid, email, time,
  action). The client already writes the correct values, so deployment needs no
  code change. **OWNER ACTION REQUIRED** — §30.
- `counters.next` forward-jump is unbounded (PH20-I1, INFO).
- The `performedByEmail`/`createdAt` clauses were verified in the emulator, not
  live (no credentials for an authenticated forge attempt).
- Single-shop shared-data model — every authenticated user reads/writes all
  business records, and `invoice`/`part` fields are client-writable — is
  **intentional**, not a limitation to fix (the transaction layer + immutable
  ledgers are the real invariant enforcers).

## 30. Final PASS/FAIL assessment

**PASS.**

Direct emulator testing of forged and malicious writes confirms that the Firestore
rules protect every field that is a genuine security or authoritative-state
invariant:

- **actor identity** — `auditLog.performedBy` **and** `performedByEmail` **and**
  `createdAt` (PH15 + PH20); `pendingSales.createdBy`; `editLocks.ownerUid` +
  `sessionId`
- **role/permission data** — the entire `appSettings` tree, admin-write-only, no
  delete; no writable `role` field exists anywhere
- **historical authority** — `sales` / `restocks` / `stockAdjustments` /
  `auditLog` are `update: if false` (overrides admin); no client can rewrite or
  delete a ledger row
- **monotonic invoice numbering** — `counters.next` never decreases, no field
  injection, no delete
- **recovery data** — `recoveryVault` / `recoveryMeta` admin-only
- **unauthenticated access** — every collection denies read and write at the data
  layer, confirmed live (`403`)

The ordinary business fields that a single-shop client-side app intentionally
lets authenticated staff write (`customer.name`, `part.stock`, `invoice.payments`,
`_rev`) are correctly classified DERIVED / APPLICATION-ENFORCED / INTENTIONALLY
CLIENT-WRITABLE — a malicious client writing them violates **no** security
invariant, cannot move money or stock through a side channel, and cannot corrupt
the immutable ledger.

**One MEDIUM defect (PH20-01)** — the `auditLog` actor forgery via the
unconstrained displayed-email and timestamp fields — was found by direct emulator
testing and **fixed** with two rule clauses (reusing the existing self-attribution
pattern) plus a one-writer correction, verified by 261 emulator assertions.

The only open item is **deployment**: the owner must publish the current
`firestore.rules` (which now carries both the Phase 15 and Phase 20 auditLog
hardening) to `balaji-auto-os-7`:

```bash
npx firebase login
npx firebase deploy --only firestore:rules --project balaji-auto-os-7
```

Then, from a signed-in staff account, confirm in the Rules Playground that an
`auditLog` create with `performedByEmail` ≠ the caller's token email is denied.
