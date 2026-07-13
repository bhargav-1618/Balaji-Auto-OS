# RELEASE CHECKLIST — Version 1.0

**Product:** Balaji Auto OS · **Current version:** 12.3.0
**Status:** 🟠 APPROVED AFTER MAJOR FIXES · **Production readiness ~80%**

> Only **release blockers** appear in Part A. Nothing optional. If it is not a blocker,
> it is in the v2.0 roadmap at the bottom.

---

# PART A — 🔴 MUST FIX BEFORE v1.0

## A1. Publish the hardened Firestore rules ⏱️ 5 minutes

**Nothing else on this list matters until this is done.**

Right now, **any signed-in staff member can delete every invoice and customer** from the
browser console. The UI's 65 permission checks are cosmetic; the deployed rules only check
`request.auth != null`.

The correct ruleset is already in the repo at **`firestore.rules`** (19 role checks, 14
admin-gated deletes, append-only ledgers, no self-promotion).

- [ ] Open Firebase Console → Firestore → **Rules**
- [ ] Paste the contents of `firestore.rules`
- [ ] **Publish**
- [ ] **Test an admin login immediately** — confirm you can still delete/edit as owner
- [ ] Test a staff login — confirm delete is now blocked
- [ ] Rollback available at `firestore.rules.permissive.bak` if anything breaks

> ⚠️ Do not publish and walk away. Verify an admin can still work.

---

## A2. Server-side invoice counter 🔴 LEGAL

**Two terminals billing at the same moment both generate `INV-0003`.**

Under **CGST Rules 2017, Rule 46(b)**, a tax invoice must carry a **unique, consecutive**
serial number. Two invoices sharing a number = defective invoice → **your customer's input
tax credit is denied** → penalty exposure → reputational damage.

`nextInvNo()` is a client-side `max()` with **no reservation**. This **cannot be fixed on
the client**.

- [ ] Create a `counters/invoices` document in Firestore
- [ ] Allocate invoice numbers inside a **`runTransaction`** (read counter → increment → write)
- [ ] Fall back to the local sequence **only when offline**, and mark those invoices for
      re-numbering on reconnect
- [ ] Test: two browser tabs, both click "New Invoice" simultaneously → must produce
      **different** numbers

---

## A3. Transactional stock decrement 🔴

**Two terminals billing the last brake pad both pass the availability check.**

- [ ] Move the stock decrement into a **`runTransaction`** on the part document
- [ ] Re-read stock inside the transaction; abort if insufficient
- [ ] Test: two tabs, both bill the final unit → one must fail

---

## A4. Run a real QA cycle on real devices 🔴

**Nothing in this application has ever been clicked.** All five audits verified the code by
executing it in Node, scanning the AST, and simulating the DOM. **None of it is verified by
a human.**

- [ ] Bill an invoice end-to-end on a **real phone**
- [ ] **Overpay** an invoice → must be blocked
- [ ] Bill **more stock than you have** → must be blocked
- [ ] Bill **one job card twice** → must be blocked
- [ ] **Cancel** a paid invoice → stock restored, revenue reversed
- [ ] **Reload mid-payment** → no corruption
- [ ] **Print a 100-line invoice** → check page breaks, headers, footers
- [ ] **Scan the QR code** with a physical phone
- [ ] **Pinch-zoom** works (was blocked until recently)
- [ ] **Test the cloud migration with real data** ← *protects the one thing a workshop can
      never get back*

---

## A5. Modal focus traps ♿

**25 hand-rolled modals: 0 have `role="dialog"`, 0 have a focus trap.** Tab escapes the
dialog into the page behind it.

(`ConfirmDialog` — the one guarding deletes — is already correct.)

- [ ] Add `role="dialog"` + `aria-modal="true"` to all 25
- [ ] Trap Tab/Shift-Tab within the dialog
- [ ] Return focus to the trigger element on close
- [ ] Lock body scroll while open

---

## A6. Duplicate-phone detection on customers 🟠

Same customer created twice → **outstanding balance splits across two records** → the owner
chases the wrong figure.

- [ ] Warn (do not hard-block) when a phone number already exists
- [ ] Offer "Use existing customer" instead

---

# PART B — PRE-LAUNCH CONFIRMATIONS

- [ ] `NEXT_PUBLIC_SITE_URL` set in Vercel (QR codes point to production, not localhost)
- [ ] Firestore `createdAt` composite index accepted
- [ ] `.env.local` confirmed **not** committed (verified gitignored ✅)
- [ ] Owner admin email confirmed in `appSettings/roles`
- [ ] Backup/export tested — owner can get their data out

---

# PART C — v2.0 ROADMAP *(valuable, NOT blocking)*

### Compliance
- Credit notes / debit notes (cancellation works today)
- E-invoicing & IRN (only mandatory above ₹5 crore turnover)
- Backdated-invoice locking after GST filing

### Scale
- Server-side search (Algolia / Typesense) — needed at ~100k customers
- Multi-branch stock
- Table virtualization (pagination is sufficient today)

### Engineering
- Split `InventoryDashboard.js` into real routes (+ per-module code splitting)
- Extract domain hooks (`useInvoices`, `useInventory`) — 73 `useState` in one function
- Complete the persistence-adapter migration (~40% adopted)
- TypeScript, or JSDoc typedefs on the service boundary
- E2E + automated accessibility suite

### Product
- Granular roles (Manager / Reception / Mechanic)
- Bulk actions · skeleton loaders · column resize

---

## SIGN-OFF

| | |
|---|---|
| **Decision** | 🟠 **APPROVED AFTER MAJOR FIXES** |
| **Safe for** | Single-terminal workshops, after Part A |
| **Not safe for** | Multi-terminal workshops (concurrency) |
| **Production readiness** | **~80%** |

> The foundation is genuinely good. The transaction engine is correct, tested and
> reversible — the part most ERPs get wrong. What remains is the last mile between
> *"the code is correct"* and *"the system is safe in the hands of people whose livelihood
> depends on it."*
>
> **Do not let the last 20% be the part you rush.**
