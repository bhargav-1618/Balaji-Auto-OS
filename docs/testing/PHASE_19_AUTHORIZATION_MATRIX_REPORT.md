# Phase 19 — Authorization Matrix / Access-Control Integrity

## 1. Authentication model

Balaji-Auto-OS is a **client-only** Next.js static export + Firebase (Auth +
Firestore). No application server.

| State | How it is entered | `useAuth()` result |
|---|---|---|
| **Authenticated (real)** | `signInWithEmailAndPassword` → `onAuthStateChanged` delivers a Firebase user | `user` = Firebase user, `role` = `admin`\|`staff` |
| **Demo guest** | `?demo=1` / `?demo=admin` / login "Launch Interactive Demo" — sets `sessionStorage.maruti_demo` | `user` = a **synthetic object** (`isDemo:true`, no `uid`), `role` = `guest`. **No Firebase auth token is ever minted.** |
| **Unauthenticated** | no token, not demo | `user` = `null`, `role` = `null` |

Route protection (`pages/index.js`): `if (!loading && !user && !demoMode) router.push('/login')`,
and the dashboard renders `<BootSplash "Redirecting…">` — never any data — while
`!user && !demoMode`. An idle terminal is signed out and its cached business data
cleared (`startIdleWatch` → `signOut` + `clearBusinessCaches`).

**The client redirect is convenience.** The authoritative barrier is
`firestore.rules`: every collection is `read: if signedIn()` or stricter, so an
unauthenticated client that bypassed the redirect still reads nothing —
**confirmed live: an unauthenticated Firestore REST read of `customers` on
`balaji-auto-os-7` returns `403 PERMISSION_DENIED`** (§26).

## 2. Role model

```
context/AuthContext.js
  BOOTSTRAP_ADMINS = ['konabhargav2003@gmail.com']   // the OWNER — permanent, code-level
  isAdmin(email)  = email ∈ BOOTSTRAP_ADMINS  ||  email ∈ dbAdmins           // dbAdmins ← appSettings/roles.admins[]
  if isAdmin → role 'admin', perms { costPrices:true, deletes:true, exports:true }
  else       → role 'staff', perms ← appSettings/roles.staff[email]  (each defaults false)

firestore.rules
  ownerEmail() = 'konabhargav2003@gmail.com'                                  // same email, hardcoded
  isAdmin()    = userEmail() == ownerEmail()  ||  userEmail() ∈ get(appSettings/roles).admins
  signedIn()   = request.auth != null
```

| | OWNER | ADMIN | STAFF | STAFF+perms | DEMO (guest) | UNAUTH |
|---|---|---|---|---|---|---|
| app `role` | `admin` | `admin` | `staff` | `staff` | `guest` | `null` |
| app `isAdmin` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| app `canManageData` (create/edit business records) | ✅ | ✅ | ❌ | ❌ | ❌ (demoAdmin: ✅ on demo data) | ❌ |
| app `canDelete` (delete/archive UI) | ✅ | ✅ | ❌ | ✅ if `perms.deletes` | ❌ (demoAdmin: ✅) | ❌ |
| Firestore `signedIn()` | ✅ | ✅ | ✅ | ✅ | **N/A — demo never writes Firestore** | ❌ |
| Firestore `isAdmin()` | ✅ | ✅ | ❌ | ❌ | N/A | ❌ |

**Key facts derived (not assumed) from the source:**

- **OWNER ≡ ADMIN at runtime.** Identical `role`, identical `perms`, identical
  Firestore capability. The *only* owner distinction: the owner email is
  hardcoded in both `BOOTSTRAP_ADMINS` and `ownerEmail()`, so the owner can never
  be locked out even with an empty/missing `appSettings/roles` doc, and the UI
  renders the owner row with no "Remove admin" control.
- **There is NO ownership-transfer mechanism.** No `owner` field exists in
  `appSettings/roles` or anywhere writable. An admin cannot become "the owner".
- **STAFF is read-only for Customers / Vehicles / Job Cards / Billing / Suppliers**
  (every module gets `canManage={canManageData || demoMode}` = admin-or-demo).
  Staff *can* view everything, **record sales / Quick Sell**, **receive & adjust
  stock**, **add/edit parts** — matching the Settings copy "Staff can always view
  stock and record sales." (INFO — §18.)
- **Per-staff perms** (`costPrices`, `exports`) are pure app-layer and work
  end-to-end. **`deletes`** grants the archive/restore UI (soft `update`, works),
  but a **hard** delete still hits `firestore.rules` `delete: if isAdmin()` and
  fails — LOW inconsistency, §21.
- **DEMO mode never touches production Firestore** — `services/persistenceStore.js`
  swaps to a localStorage/sessionStorage backend for `role === 'guest'`. Demo
  authorization (`demoPerms` / `protectedDemoToast`) is a **sandbox UX concern
  only** (INFO).

## 3. Complete authorization matrix

Legend: ✅ allowed · ❌ denied · ⚠️ UI-only restriction (data layer intentionally
shared) · N/A. **AUTHORITATIVE LAYER** = where the boundary is really enforced.

| Action | Owner | Admin | Staff | Unauth | UI ENFORCEMENT | MUTATION ENFORCEMENT | FIRESTORE ENFORCEMENT | AUTHORITATIVE |
|---|:-:|:-:|:-:|:-:|---|---|---|---|
| View any collection (customers, invoices, parts, sales, audit, PO, …) | ✅ | ✅ | ✅ | ❌ | route redirect | — | `read: if signedIn()` | **Firestore** |
| Create Customer / Vehicle / Job Card | ✅ | ✅ | ⚠️ UI-blocked | ❌ | `canManage`(admin) | — | `create: if signedIn()` | UI (Firestore shared by design) |
| Edit Customer / Invoice / Job Card / Part / Supplier / PO | ✅ | ✅ | ⚠️ UI-blocked (Part edit: ✅) | ❌ | `canManage`(admin); Part editor ungated | `_rev` guarded txn | `update: if signedIn()` | UI (Firestore shared) |
| **Delete** Customer / Invoice / Job Card / Part / Supplier / PO | ✅ | ✅ | ❌ | ❌ | `canManage` / `canDelete` | `store.remove` | **`delete: if isAdmin()`** | **Firestore** |
| Archive / Restore (soft, reversible) | ✅ | ✅ | ⚠️ UI-blocked | ❌ | `canManage`(admin) | `capacityService` eligibility | `update: if signedIn()` | UI (soft state) |
| **Bulk delete** (multi-select) | ✅ | ✅ | ❌ | ❌ | explicit `if (!isAdmin)` re-check | `removeMany` batch | **`delete: if isAdmin()` per doc** | **Firestore** |
| Record sale / Quick Sell | ✅ | ✅ | ✅ | ❌ | ungated | `runQuickSaleTx` (atomic) | `sales create: if signedIn()` | Firestore (intentional) |
| Collect Payment / Refund / Return | ✅ | ✅ | ⚠️ UI-blocked | ❌ | `canManage`(admin) | `conc/overpaid` + `pay.id` txn | `invoices update: if signedIn()` | UI + txn |
| Add / Edit Part | ✅ | ✅ | ✅ | ❌ | ungated | `handleSave` + clamps | `parts create/update: if signedIn()` | Firestore (intentional — stock work) |
| Modify stock / adjustment / restock | ✅ | ✅ | ✅ | ❌ | ungated | clamps + `runTransaction` | `signedIn()` (parts + ledgers) | Firestore (intentional) |
| Receive PO | ✅ | ✅ | ✅ | ❌ | ungated (Inventory tab) | `poReceiveDoc` txn (`po/cancelled`, `po/over-receipt`, idempotency) | `signedIn()` | Firestore + txn state guards |
| Cancel PO / Cancel Invoice | ✅ | ✅ | ✅ (PO) / ⚠️ UI-blocked (Invoice, in Billing) | ❌ | mixed | blind `updateDoc` | `update: if signedIn()` | Firestore (intentional) |
| **Edit a ledger row** (sale / restock / adjustment) | ❌ | ❌ | ❌ | ❌ | no UI | — | **`update: if false`** | **Firestore (absolute — overrides admin)** |
| **Forge auditLog `performedBy`** (impersonate) | ❌ | ❌ | ❌ | ❌ | no UI | `pushAudit` sets `user.uid` | **`create` iff `performedBy == request.auth.uid`** | **Firestore** — repo ✅ / **LIVE pending (§25)** |
| Edit App Settings / roles | ✅ | ✅ | ❌ | ❌ | `section === 'users' && isAdmin` | `addAdminEmail` | **`appSettings create,update: if isAdmin()`** | **Firestore** |
| Manage Users / grant staff perms | ✅ | ✅ | ❌ | ❌ | `section === 'users' && isAdmin` | `setStaffPermission` | **`appSettings … if isAdmin()`** | **Firestore** |
| Reset All Data / Recovery Vault restore | ✅ | ✅ | ❌ | ❌ | `section === 'backup' && isAdmin` | `resetAllData` | **`recoveryVault` + `recoveryMeta` `isAdmin()`; deletes `isAdmin()`** | **Firestore** |
| View Audit Log **panel** | ✅ | ✅ | ✅ | ❌ | shown to all authenticated | — | `auditLog read: if signedIn()` | Firestore (shared) |
| Export **Audit Report** (CSV) | ✅ | ✅ | ⚠️ `isAdmin` in Reports; else `perms.exports` | ❌ | `isAdmin` / `canExport` | client-side CSV | N/A (read already allowed) | UI |
| Self-promote to admin | ❌ | — | ❌ | ❌ | no UI | — | **`appSettings … if isAdmin()`** | **Firestore** |
| Transfer ownership | N/A | N/A | N/A | N/A | no mechanism | — | `ownerEmail()` hardcoded | **N/A (by design)** |
| Read/write another shop record (IDOR) | ✅ | ✅ | ✅ | ❌ | shared lists | — | `signedIn()` | **INTENTIONAL — single-shop shared data** |
| Read another user's `pendingSales` | ❌ | ❌ | ❌ | ❌ | no UI | — | **`read iff createdBy == request.auth.uid`** | **Firestore** |
| Steal / overwrite another session's `editLocks` | ❌ | ❌ | ❌ | ❌ | `lib/editLease.js` session txn | client txn | **rules: `ownerUid == auth.uid` + `sameSession()`** | **Firestore** |
| Decrement invoice counter (cause duplicate serials) | ❌ | ❌ | ❌ | ❌ | not exposed | `lib/docCounter` txn | **rules: `next >= resource.data.next`** | **Firestore** |

**Actions discovered: 24** privileged operations (the table). **Roles verified: 4**
(Owner, Admin, Staff, Unauthenticated) + Demo guest as a 5th sandbox context.

## 4. Read authorization (Phase 19C)

| Collection | Owner | Admin | Staff | Unauth | Firestore rule | Website behaviour |
|---|:-:|:-:|:-:|:-:|---|---|
| customers, vehicles(catalog), jobCards, invoices, parts, suppliers, purchaseOrders, categories, sales, restocks, stockAdjustments, salesRollups, reorderRequests, auditLog | ✅ | ✅ | ✅ | ❌ | `read: if signedIn()` | live sub via `onSnapshot`; unauth is redirected before any sub starts |
| appSettings/roles | ✅ | ✅ | ✅ | ❌ | `read: if signedIn()` (the app needs it to resolve roles) | — |
| recoveryVault | ✅ | ✅ | ❌ | ❌ | `read: if isAdmin()` | Backup section admin-only |
| recoveryMeta | ✅ | ✅ | ✅ | ❌ | `read: if signedIn()` | banner only |
| pendingSales/{opId} | own only | own only | own only | ❌ | `read: iff resource.data.createdBy == request.auth.uid` | reconciled client-side |
| editLocks | ✅ | ✅ | ✅ | ❌ | `read: if signedIn()` | lease coordination |
| counters | ✅ | ✅ | ✅ | ❌ | `read: if signedIn()` | numbering |
| any unlisted collection (`settings`, `staff`, …) | ❌ | ❌ | ❌ | ❌ | fallback `if false` | — |

**Emulator-proven** (`npm run test:rules`): anon read denied on `parts` and
`appSettings/roles`; staff read allowed on `parts`/`customers`; staff read of
another user's `pendingSales` denied; admin read of an unlisted collection denied.

## 5. Create authorization (Phase 19D)

| Create | UI allows | Service allows | Firestore allows | Verdict |
|---|---|---|---|---|
| Customer / Vehicle / Job Card / Invoice | admin (or demo) | no role gate | any `signedIn` | Staff blocked by UI; Firestore intentionally shared |
| Part | any authenticated | no role gate | any `signedIn` | intentional (stock work) |
| Supplier (module) | admin | — | any `signedIn` | Staff blocked by UI |
| Supplier (inline, from a Part's supplier picker → `createSupplierNow`) | **any authenticated** | name-unique + demo early-return | any `signedIn` | **alternate-workflow inconsistency, LOW — §21** |
| PO | any authenticated (Inventory tab) | `buildPO` validation | any `signedIn` | intentional |
| Stock adjustment / Restock / Quick Sell | any authenticated | clamps + atomic txn | `sales`/`restocks`/`stockAdjustments` `create: if signedIn()` | intentional |
| Audit entry | app-internal only | `pushAudit`/`writeAudit` stamp `performedBy = uid` | `create iff performedBy == request.auth.uid` | **actor cannot be forged (repo); LIVE pending — §25** |
| appSettings doc | admin only | — | **`create: if isAdmin()`** | Firestore-enforced |
| recoveryVault doc | admin only | — | **`create: if isAdmin()`** | Firestore-enforced |
| pendingSales | own only | offline path | **`create iff createdBy == request.auth.uid` + shape check** | Firestore-enforced |
| counters | app-internal | `docCounter` txn | `create iff next is int ≥ 1, hasOnly(['next'])` | Firestore-enforced |

## 6. Update authorization (Phase 19E)

| Update target | Owner/Admin | Staff (UI) | Staff (direct Firestore) | Authoritative |
|---|:-:|:-:|:-:|---|
| Customer / Vehicle / Job Card / Invoice / Part / Supplier / PO fields | ✅ | ❌ (blocked by `canManage`; Part editor is ungated) | ✅ `update: if signedIn()` | INTENTIONAL single-shop; `_rev` txn guards concurrency, not authz |
| **Append-only ledger row** (`sales`/`restocks`/`stockAdjustments`) | ❌ | ❌ | ❌ **`update: if false`** | **Firestore — absolute, overrides admin** (emulator-proven for staff AND admin) |
| **auditLog entry** | ❌ | ❌ | ❌ **`update: if false`** | **Firestore** |
| `salesRollups/{month}` (running aggregate) | ✅ | via Quick Sell / payment realization | ✅ `update: if signedIn()` | INTENTIONAL — fully derivable from `sales`, no per-row financial record; documented in rules and the new emulator test |
| **appSettings/roles** (`admins[]` OR `staff{}`) | ✅ | ❌ | ❌ **`create,update: if isAdmin()`** | **Firestore** — staff cannot self-promote via `admins` **or** via the `staff` sub-object (new emulator test) |
| **recoveryMeta** | ✅ | ❌ | ❌ **`update: if isAdmin()`** | **Firestore** |
| **counters/{seq}.next** | monotonic only | monotonic only | monotonic only (`next >= resource.data.next`) | **Firestore** |
| **editLocks** | current session only | current session only | rules: `ownerUid == auth.uid && sameSession()` | **Firestore** (PH7-27) |

## 7. Delete authorization (Phase 19F)

DELETE ≠ ARCHIVE ≠ CANCEL ≠ RESTORE.

| Op | What it is | Owner/Admin | Staff | Firestore |
|---|---|:-:|:-:|---|
| **Hard delete** (`deleteDoc`) — parts, suppliers, categories, vehicles, customers, invoices, jobCards, purchaseOrders, sales, restocks, stockAdjustments, salesRollups, auditLog, reorderRequests, recoveryVault, recoveryMeta | permanent removal | ✅ | ❌ | **`delete: if isAdmin()`** everywhere (recoveryMeta: `isAdmin()`; sales/restocks/adj/audit: `isAdmin()`) — emulator-proven |
| **Archive** | `update {archived:true}` — reversible | ✅ | ⚠️ UI-blocked | `update: if signedIn()` (soft state) |
| **Restore / Reactivate** | `update {archived:false}` | ✅ | ⚠️ UI-blocked | `update: if signedIn()` |
| **Cancel** (invoice/PO) | `update {status:'cancelled'}` — terminal, no data loss | ✅ (invoice in Billing) / any auth (PO) | mixed | `update: if signedIn()` + txn state guards (Phase 17) |
| **`appSettings` delete** | — | ❌ | ❌ | **`delete: if false` (unconditional)** |
| **`counters` delete** | — | ❌ | ❌ | **`delete: if false`** (losing it restarts the serial) |
| **`editLocks` delete** | only an already-EXPIRED lease | only expired | only expired | `delete: if signedIn() && expired()` (PH7-27) |
| **`pendingSales` delete** | own only | own only | own only | `delete iff createdBy == request.auth.uid` |

**Retry cross-check (new emulator test):** a staff `deleteDoc` on an invoice is
denied; the identical retry is denied again; the invoice is still readable
afterwards. An operation id / a second attempt is not an authorization bypass.

## 8. Settings authorization (Phase 19)

`SettingsView` receives the **real** `isAdmin` (`role === 'admin'`), NOT
`canManageData`. Therefore:

| Settings section | Owner | Admin | Staff | Demo (guest / admin) |
|---|:-:|:-:|:-:|:-:|
| Business Profile, Appearance, Notifications, About, System info | ✅ | ✅ | ✅ | ✅ |
| **Users & Roles** (add/remove admin, add staff, grant perms) | ✅ | ✅ | ❌ (tab not in list; section re-checks `isAdmin`) | ❌ |
| **Backup & Data** (full backup, Reset All Data, Restore Vault) | ✅ | ✅ | ❌ | ❌ |
| **Demo Permissions** | ✅ | ✅ | ❌ | ❌ (`showDemoPanel = isAdmin && …` — the real admin configures the demo, from outside it) |

**Live-verified:** a Demo User's Settings shows only Business Profile /
Notifications / Appearance / About; Demo Admin's Settings is identical (the admin
sections require a real production admin login). Every admin write also passes
through `appSettings … if isAdmin()` at Firestore.

## 9. Audit authorization (Phase 19Q)

- `auditLog read: if signedIn()` — every authenticated user sees the shared shop
  audit log (the panel). The **Audit Report export** is `isAdmin`-gated in Reports.
- `pushAudit` / `writeAudit` (`components/InventoryDashboard.js`) always stamp
  `performedBy: user?.uid` and `performedByEmail`. In demo mode `performedBy` is
  `null` (synthetic user has no uid) but demo audit rows go only to
  `localStorage.maruti_demo_audit`, never Firestore.
- **`auditLog create: if signedIn() && request.resource.data.performedBy ==
  request.auth.uid`** — a client cannot write an entry attributed to another user,
  and cannot omit `performedBy` (missing ≠ `request.auth.uid`). **Emulator-proven
  (Phase 15 + Phase 19).**
- An unauthorized attempt (denied at Firestore) writes **no** audit row — the
  denied write never reaches the audit path, which is fired only on the app's own
  successful mutations. The app does not (by design) log denied attempts; Phase 19
  does not require it to.

## 10. Direct Firestore tests (Phase 19H) — emulator, `npm run test:rules`

**148 assertions pass (was 138; +10 for Phase 19).** Real `firestore.rules`, real
Firestore emulator, real authenticated contexts (`owner-uid`/`admin-uid`/
`staff-uid`/`other-uid`/unauthenticated). Coverage per collection × role × op:

| Collection | anon | staff | admin | owner |
|---|---|---|---|---|
| parts / customers (repr. of 8 catalog collections) | R❌ C❌ | R✅ C✅ U✅ **D❌** | D✅ | D✅ (with no roles doc) |
| sales / restocks / stockAdjustments / auditLog | C❌ | C✅ **U❌** D❌ | **U❌** D✅ | — |
| salesRollups | — | U✅ D❌ | — | — |
| auditLog forged `performedBy` | — | **C❌** (impersonation + missing both denied) | — | — |
| appSettings/roles `admins[]` | — | **U❌ (self-promote)** C❌(new doc) | U✅ | — |
| appSettings/roles `staff{}` sub-object | — | **U❌ (self-grant perm)** | U✅ | — |
| recoveryVault | — | **R❌ C❌** | R✅ C✅ **U❌** D✅ | — |
| recoveryMeta | — | (read ✅) | full ✅ | — |
| counters | R❌ | R✅; **U❌ decrement / +field / non-int**; **D❌** | — | — |
| editLocks | C❌ | own C✅ U✅; **foreign ownerUid C❌**; **steal active U❌ D❌**; **cross-session U❌ D❌** (PH7-27) | — | — |
| pendingSales | — | own C✅ R✅ D✅; **foreign createdBy C❌**; **B read/delete A's ❌**; **U❌ always** | — | — |
| invoices (retry) | — | **D❌, retry D❌** | R✅ after | **D✅ owner bypass with a different admin listed** |
| unlisted collection | R❌ W❌ | — | **R❌ W❌ (fallback)** | — |
| IDOR | — | **read+update ANY customer ✅ (intentional single-shop)** | — | — |

## 11. Forged-field tests (Phase 19I)

Client-supplied identity is **never** trusted by the rules:

| Field | Rule | Emulator result |
|---|---|---|
| `auditLog.performedBy` = another uid | `create iff == request.auth.uid` | **DENIED** (Phase 15) |
| `auditLog.performedBy` missing | same | **DENIED** (missing ≠ uid) |
| `editLocks.ownerUid` = another uid | `create iff == request.auth.uid` | **DENIED** |
| `editLocks` steal an active lease (correct uid, wrong session) | `sameSession()` | **DENIED** (PH7-27) |
| `pendingSales.createdBy` = another uid | `create iff == request.auth.uid` | **DENIED** |
| `counters` extra field / non-int / decrement | `hasOnly(['next'])`, `is int`, `>= resource.data.next` | **DENIED** |
| `appSettings/roles.admins` = `[self]` | `create,update: if isAdmin()` | **DENIED for staff** |
| `appSettings/roles.staff[self]` = `{deletes:true}` | same | **DENIED for staff** (new) |

There is **no** writable `role` field on the user; role is derived server-side in
the rules from `appSettings/roles` (admin-write-only) + the hardcoded owner email.

## 12. Role-escalation tests (Phase 19J)

| Attempt | Path | Result |
|---|---|---|
| Staff → Admin | write `appSettings/roles.admins` | **DENIED** (Firestore `isAdmin()`) |
| Staff → grant self `deletes` perm | write `appSettings/roles.staff` | **DENIED** (new emulator test) |
| Staff → make itself owner | no `owner` field exists anywhere writable | **impossible by construction** |
| Admin → become "owner" | no ownership-transfer mechanism; `ownerEmail()` is a rules literal | **impossible** |
| Admin → lock the owner out | write `appSettings/roles.admins = []` | permitted **but harmless** — `isAdmin()` still returns true for `ownerEmail()`; the owner is never in the list to begin with |
| Anyone → bootstrap admin via first write to an empty `appSettings/roles` | `create: if isAdmin()` — the first writer must ALREADY be an admin (i.e. the owner) | **DENIED for non-owner** |

**Zero role-escalation paths.**

## 13. Wrong-record / IDOR tests (Phase 19K)

The application is **intentionally single-shop with shared data**: every
authenticated user reads and writes every business record. This is a documented
design choice (`firestore.rules` header: *"Every signed-in user is trusted to READ
all shop data (single-shop model). If you later need multi-tenant isolation, reads
must also be scoped."*). Phase 19 verifies the model, it does not impose a SaaS
one.

- Staff reading/updating customer B (not "their" customer) — **allowed, by
  design.** INFO, not a defect. (New emulator assertion documents this
  explicitly so it can never be mistaken for an accidental hole.)
- The **only** user-scoped collection is `pendingSales` (a private, transient
  offline-Quick-Sell intent): user B **cannot** read or delete user A's pending
  sale — emulator-proven.
- `recoveryVault` / `recoveryMeta` are **admin-scoped**, not user-scoped.

## 14. UI vs Firestore comparison (Phase 19L)

| Action | Classification |
|---|---|
| Delete any business record / ledger row / recovery record | **UI + rules** — hidden from Staff **and** `delete: if isAdmin()` / `if false` |
| Edit App Settings / roles / grant perms | **UI + rules** — `isAdmin` section gate **and** `appSettings … if isAdmin()` |
| Reset All Data / Recovery Vault | **UI + rules** |
| Edit a ledger row | **rules only** (no UI exists; `update: if false`) |
| Forge auditLog actor | **rules only** (no UI; `performedBy == auth.uid`) — repo ✅, **live pending §25** |
| Steal an editLock / decrement a counter | **rules only** (not exposed in UI) |
| Create Customer/Invoice/Job Card (Staff) | **UI only** — hidden from Staff; Firestore `create: if signedIn()` **intentionally** shared (single-shop). Safe direction: UI stricter than rules. |
| Archive / Restore / Cancel (Staff) | **UI only** — soft, reversible state; Firestore shared by design |
| Hard-delete via `perms.deletes` toggle | **inconsistent (LOW)** — UI shows the button, Firestore rejects it. §21. Security is correct (Firestore wins); the toggle over-promises. |
| Inline supplier create (non-admin) vs Suppliers module (admin) | **inconsistent (LOW)** — §21. Non-destructive; Firestore `signedIn()` allows both. |
| Read shared data (any authenticated user) | **intentionally unrestricted** |

## 15. Alternate-workflow tests (Phase 19M)

| Restricted action | Alternate route | Does the restriction hold? |
|---|---|---|
| Edit App Settings / roles | no alternate modal exists — only the `isAdmin` Settings section | ✅ holds (+ Firestore) |
| Reset All Data | only the `isAdmin` Backup section | ✅ holds (+ Firestore `isAdmin()` on `recoveryVault`/`recoveryMeta` + `delete: if isAdmin()`) |
| Delete Customer / Invoice | list row menu / detail panel / **mobile card menu** — all gated on the same `canManage` | ✅ holds; **and Firestore `delete: if isAdmin()` is the real barrier** regardless of any menu |
| Create Customer | main wizard / **inline "New Customer" from an invoice** / **"Create New Customer" from a vehicle** | all admin-or-demo (`onQuickCustomer` reached only from `canManage` surfaces); Firestore `signedIn()` intentionally shared |
| Create Supplier | Suppliers module (admin) / **inline supplier picker on a Part (any authenticated)** | **inconsistent (LOW) — §21**; non-destructive |
| Create Part | main "Add Part" / invoice line | invoice lines are free-text or existing parts — no "create part" alternate. ✅ |
| Receive PO | PO row / PO detail | same `receivePO` handler + `poReceiveDoc` txn either way. ✅ |
| Bulk delete | multi-select bars in each module | explicit `if (!isAdmin)` re-check in the handler + Firestore per-doc `isAdmin()`. ✅ |

## 16. Quick-create / modal / mobile-card authorization (Phase 19N)

Every quick-create / inline-create surface funnels through a handler that is
itself reachable only from a `canManage` (admin) context — **except**
`createSupplierNow` (§21, LOW). Mobile-card action menus mirror the desktop
`canManage` gate (the same `ActionMenu items` array, filtered by the same flag).
No quick path exposes a Firestore-`isAdmin()` action (delete / roles / recovery)
to a non-admin.

## 17. Bulk authorization (Phase 19O)

| Bulk op | UI gate | Firestore |
|---|---|---|
| CSV / Excel import (parts only) | ungated (any authenticated) | `parts create: if signedIn()` per row | intentional (stock work); Phase 18 covered validation |
| Bulk archive / reactivate | `canManage` (admin) | `update: if signedIn()` (soft) |
| **Bulk delete** | button hidden from Staff **+ explicit `if (!isAdmin) return`** in the handler | **`delete: if isAdmin()` per doc** in the batch — a batch does not bypass per-doc rules |
| Batch stock adjustment | ungated | `stockAdjustments create: if signedIn()` per row | intentional |
| Reset All Data (mass delete) | `isAdmin` Settings section | every delete in the batch is `if isAdmin()`; the recovery snapshot is `isAdmin()` |

**An action forbidden individually is not made possible through a batch** — the
emulator enforces rules per document even inside a `writeBatch`.

## 18. State + authorization (Phase 19P)

Authorization (role) and state-transition rules (Phase 17) are **orthogonal** and
both apply:

| Scenario | Role check | State check | Combined |
|---|---|---|---|
| Staff + Paid invoice → financial edit | Staff can't reach the editor (`canManage`) | Paid invoice is locked (Phase 17) | double-blocked |
| Staff + Cancelled PO → Receive | Staff *can* receive (ungated) | `applyPoReceive` + `poReceiveDoc` throw `po/cancelled` | blocked by the **state** guard, not the role |
| Staff + Archived Customer → edit | Staff can't reach the editor | archived is a filter, not a lock | blocked by role |
| Admin + terminal ledger row → edit | Admin *is* authorized generally | `update: if false` | **blocked by state** (append-only overrides admin) |
| Admin + Reset All Data | authorized | snapshots first, 30-day recovery window | allowed, recoverable |

"Allowed role" ≠ "allowed state transition" — verified they are enforced
independently.

## 19. Audit interaction (Phase 19Q)

Cross-checked against Phase 15. A **successful** privileged action writes exactly
one audit row with `performedBy` = the acting uid (un-forgeable once §25 is live).
A **denied** action (Firestore rejects) writes **nothing** — the app's audit calls
sit on the success path of its own transactions. The design does not record denied
attempts; Phase 19 does not require it.

## 20. Retry / network cross-check (Phase 19R / 19S)

- **Retry:** a denied delete stays denied on the identical retry (new emulator
  assertion). Durable op ids (`useDurableOpId`, `pay.id`, `receiptId`,
  `appliedReceiptIds`) are allocated *after* any role/UI gate and only ever make a
  *successful* op idempotent — they cannot turn a denied op into a successful one,
  because the rules re-evaluate on every write attempt.
- **Network:** an offline mutation is queued by the Firestore SDK and **re-sent on
  reconnect, where the rules run again**. `pendingSales` (the one durable offline
  intent) is creator-scoped and shape-checked at the rules layer, so an offline
  Quick Sell cannot be reconciled by, or forged for, another user. No unauthorized
  op becomes authorized by going offline.

## 21. Confirmed defects

**No CRITICAL, no HIGH, no confirmed authorization defect requiring a production
code change.** The Firestore rules correctly and demonstrably enforce every
boundary that must be a security boundary (hard deletes, role management, ledger
immutability, recovery data, actor attribution, counter monotonicity, lease
identity, per-user pending sales, deny-by-default).

Findings (all LOW / INFO — the security boundary holds in every case):

| Ref | Finding | Severity | Why not fixed |
|---|---|---|---|
| **PH19-L1** | `perms.deletes` grants a Staff member the archive/restore UI (works — soft `update`) **and** the "Delete Permanently" button (**fails** — `firestore.rules` `delete: if isAdmin()`). The button surfaces then errors with "Could not delete part." | **LOW** | The **security boundary is correct** — a hard delete stays admin-only. Fixing = either weaken the rules to read `appSettings/roles.staff[email].deletes` (a `get()` per delete that *expands* what non-admins can destroy — the phase forbids weakening rules) or remove a documented product toggle. Neither is warranted. Documented as a limitation. |
| **PH19-L2** | The Suppliers **module**'s "Add Supplier" is admin-only (`canManage`), but the **inline supplier picker on a Part** (`createSupplierNow`) creates a supplier for any authenticated user. Same alternate-workflow inconsistency class as Phase 18's PH18-01 / Phase 10's PH10-03. | **LOW** | Supplier creation is non-destructive and `suppliers create: if signedIn()` intentionally allows it (single-shop). No integrity or security impact — a duplicate/extra supplier is visible and deletable. |
| **PH19-L3** | `context/InventoryDashboard.js` defines `demoGuard()` (a "read-only demo" interceptor) that is **never called** — dead code. The actual demo write-protection (`demoMode && !demoAdmin && !demoPerms.X → protectedDemoToast`) is present and thorough at every write site. | **LOW** | Dead, harmless, misleading only to a code reader. A cleanup, not a security fix — deliberately kept out of a security commit. Spin-off candidate. |
| **PH19-I1** | `salesRollups/{month}` is `update: if signedIn()` (not `update: if false` like the append-only ledgers). A staffer could corrupt a monthly aggregate via direct Firestore. | **INFO** | It is a **derived** running total, fully recomputable from the immutable `sales` ledger, with no per-row financial record. `update: if false` would break Quick Sell / payment realization. Documented in the rules and the new emulator test. |
| **PH19-I2** | STAFF is fully read-only for Customers / Vehicles / Job Cards / Billing / Suppliers (every module `canManage={canManageData \|\| demoMode}` = admin-or-demo). | **INFO** | Matches the app's documented model ("Staff can always view stock and record sales"). The **safe** direction: UI is stricter than Firestore. Not a security concern. |
| **PH19-I3** | OWNER ≡ ADMIN at runtime; no ownership-transfer mechanism. | **INFO** | By design — the hardcoded owner is a lock-out safety net, not a privilege tier. |
| **PH19-I4** | Single-shop shared data — every authenticated user reads/writes every business record (IDOR by a SaaS lens). | **INFO** | Explicitly intentional; the phase instructs not to impose per-user isolation. |

## 22. Root causes

- **PH19-L1** — `firestore.rules` deliberately made *every* hard delete `isAdmin()`
  (Phase 6bfb88d / security-rules test §2), predating the per-staff `deletes`
  toggle. The two were never reconciled because the security-correct outcome
  (deny) is also the safe one.
- **PH19-L2** — the same organic growth that caused PH18-01: an inline
  quick-create shortcut that predates / sidesteps the module's own role gate.
- **PH19-L3** — `demoGuard()` was superseded by the finer-grained `demoPerms` /
  `protectedDemoToast` model and left behind.

## 23. Fixes

**No production code change required.** (Per the phase: findings are LOW/INFO, the
security boundary is correct at the data layer, and every candidate "fix" either
weakens `firestore.rules` — forbidden — or removes a documented feature.)

Test coverage added instead (§24).

## 24. Automated tests

**NEW: `tests/authorization-matrix-integrity.test.cjs` — 76 static assertions.**
Independently verifies:
1. role model (authenticated states, owner identity = rules `ownerEmail()`, admin
   = bootstrap ∪ dbAdmins, staff perms default-false, no "owner" role, no
   ownership-transfer field, demo = synthetic guest);
2. UI enforcement plumbing (`isAdmin = role==='admin'`, `canManageData`,
   `canManage` on every module, `canDelete`, the bulk-delete `isAdmin` re-check,
   Settings section gates, route redirect, idle logout, below-floor = real
   `isAdmin`);
3. `firestore.rules` encodes each boundary (per-collection read/create/update
   signedIn + delete `isAdmin`; ledgers `update:false`; auditLog
   `performedBy==auth.uid`; appSettings `isAdmin` write; recovery `isAdmin`;
   counters monotonic; editLocks/pendingSales identity; deny-by-default);
4. a **22-row authorization matrix** with every cell classified and every
   destructive row required to be authoritative at Firestore;
5. forged-field / escalation rule shape;
6. a cross-reference that a **live emulator proof exists** for each protected cell
   (so the static file and `tests/rules/…` can never silently drift);
7. the **deployment gap** stays flagged in `KNOWN_LIMITATIONS.md`.

**EXTENDED: `tests/rules/firestore.rules.test.cjs` — +10 emulator assertions**
("PHASE 19 — authorization matrix" section): staff cannot self-grant a perm via
the `staff` sub-object; admin can (legit path); `salesRollups` staff-update
allowed / staff-delete denied; a denied delete stays denied on retry; the owner
bypass works with a *different* admin listed; the single-shop IDOR read+update is
explicitly asserted as intentional.

## 25. Firebase rules

**RULES TESTED: PASS — `npm run test:rules` → 148 / 148** (138 pre-existing + 10
Phase 19), real emulator, real `firestore.rules`. No rules change.

**RULES PUBLISHED LIVE: NO — owner action required (pre-existing, unchanged by
this phase).**

- The **base ruleset IS live** on `balaji-auto-os-7` — confirmed by a live
  unauthenticated Firestore REST read returning **403 `PERMISSION_DENIED`** (§26),
  i.e. `read: if signedIn()` is enforced in production.
- **`firestore.rules` was last modified at commit `7b5520c` (Phase 15, PH15-03 —
  the `auditLog` `performedBy == request.auth.uid` self-attribution check).** The
  last commit that recorded a deployment is `6bfb88d` ("Mark firestore.rules as
  deployed to balaji-auto-os-7"), which is **before** `7b5520c`.
- Therefore the **auditLog actor-forgery protection may not be live.** Until it
  is, a *signed-in* client could write an `auditLog` entry with a forged
  `performedBy` (it cannot forge deletes, roles, ledgers, or recovery — those were
  live as of Phase 14).
- The Firebase CLI in this environment has **no authorized account**
  (`firebase login:list` → "No authorized accounts"), no `FIREBASE_TOKEN`. Rules
  cannot be deployed or their live version inspected from here without
  authenticating — which this phase must not do.
- **The client already writes `performedBy = user.uid`, so publishing needs NO
  code change.**

**OWNER ACTION REQUIRED:**
```bash
npx firebase login
npx firebase deploy --only firestore:rules --project balaji-auto-os-7
```
Then, from a signed-in staff account, confirm in the Firebase Console Rules
Playground that an `auditLog` create with `performedBy` ≠ the caller's uid is
denied.

## 26. Live website validation (Phase 19V)

| Check | Result |
|---|---|
| Unauthenticated visit to `/` | **redirected to `/login`** (path `/login`, password field, title "Sign in") — the dashboard renders no data |
| Unauthenticated Firestore REST read of `customers` on `balaji-auto-os-7` | **403 `PERMISSION_DENIED`** — the live rules enforce `read: if signedIn()` |
| Demo User (`?demo=1`, role `guest`) — Settings | shows only Business Profile / Notifications / Appearance / About — **no Users & Roles, no Backup & Data, no Demo Permissions** |
| Demo Admin (`?demo=admin`) — Settings | **identical** — admin sections need a real production admin login (`SettingsView` gets the real `isAdmin`, which is false in demo) |
| Demo (either) → any real write | never reaches Firestore (`createStore(demoMode)` → localStorage) — production data untouched (re-confirmed across Phases 17–18) |
| Console errors on any of the above | none |

Real Staff/Admin production logins were **not** exercised — no test credentials
are available and Phase 19W forbids touching real roles. The data-layer
authorization for those roles is proven authoritatively by the 148 emulator
assertions; the UI plumbing by the 76 static assertions.

## 27. QA cleanup

- No production data written. No roles changed anywhere. No test credentials
  created or committed.
- The browser's demo `sessionStorage` flags were cleared during validation.
- Emulator data is ephemeral (`testEnv.clearFirestore()` between blocks,
  `emulators:exec` tears the emulator down).

## 28. Code-growth review

**No production code change required.**

| | Lines |
|---|---|
| Production added | **0** |
| Production removed | **0** |
| Net production change | **0** |
| `firestore.rules` change | **none** |
| New production functions / files / abstractions | **0 / 0 / 0** |
| Test lines added | `tests/authorization-matrix-integrity.test.cjs` (~215, new) + `tests/rules/firestore.rules.test.cjs` (+52) |

**Existing mechanisms reused (verified, not duplicated):** the `role` / `isAdmin`
/ `canManage` / `canDelete` chain in `AuthContext` + `InventoryDashboard`;
`firestore.rules` `isAdmin()` / `signedIn()` / `ownerEmail()`; the
`tests/rules/helpers.cjs` emulator harness; the static-analysis style of
`tests/security-rules.test.cjs`.

**Significant new logic:** none. Phase 19 is an audit; the deliverable is the
matrix + the independent verifier + the flagged deployment gap.

## 29. Remaining limitations

- **`firestore.rules` PH15-03 (auditLog actor) not confirmed live on
  `balaji-auto-os-7`** — owner action required (§25). The base ruleset (deletes,
  roles, ledgers, recovery, counters, deny-by-default) IS live.
- `perms.deletes` for a Staff member does not enable a **hard** delete (Firestore
  admin-only) — LOW, §21/PH19-L1.
- Inline supplier quick-create is reachable by any authenticated user — LOW,
  §21/PH19-L2.
- Dead `demoGuard()` — LOW cleanup, §21/PH19-L3.
- Real Staff / Admin **production** logins were not exercised live (no safe test
  credentials); covered by emulator + static tests.
- Single-shop shared data model — every authenticated user reads/writes all shop
  records — is **intentional**, not a limitation to fix.

## 30. Final PASS/FAIL assessment

**PASS.**

The authorization model is coherent and **enforced where it must be — at the
Firestore rules layer**, not merely in the UI. For every destructive or privileged
action (hard delete, role/permission management, ledger mutation, recovery-data
access, actor attribution, invoice-number monotonicity, edit-lease identity,
per-user pending sales) the rules deny a non-admin / non-owner / cross-user /
unauthenticated request, proven by 148 live emulator assertions. The UI role gates
(`canManage`, `isAdmin`, section gates, route redirect, idle logout) are a
consistent, defence-in-depth layer *on top of* that boundary, and where they
differ from the rules they are **stricter**, never looser (Staff is read-only in
the UI for records Firestore would let them write — the safe direction).

There is **no CRITICAL or HIGH defect, no direct-Firestore bypass, no
role-escalation path, no wrong-record access issue, and no alternate-workflow
bypass** of a security boundary. Three LOW inconsistencies and four INFO design
notes are documented; none is a security hole and none warrants weakening a rule
or adding an authorization framework.

The **one** open item is deployment, not code: the current `firestore.rules` (with
the Phase 15 auditLog actor check) needs `firebase deploy` by the owner. The base
ruleset is live and enforcing.
