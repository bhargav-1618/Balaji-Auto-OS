# Balaji Auto OS — Remediation Plan (what to fix / update / change)

Version at time of writing: **3.9.2**. Each item lists: the problem, the exact
change, files touched, who must do it (me vs you-in-console), effort, regression
risk, and how to verify. Ordered by priority. Status legend:

- ✅ DONE — implemented + build-verified in this codebase
- ⚠️ YOU — needs an action only you can take (Firebase console / Vercel / secrets)
- 🔧 TODO — code change, not yet done (scoped below)

---

## P0 — BLOCKERS (do before any real production use)

### P0-1 ⚠️ Rotate the owner password + enable 2FA  ·  effort: 5 min  ·  risk: none
**Problem:** the owner account `konabhargav2003@gmail.com` (hardcoded permanent
admin in `context/AuthContext.js`) used `123456` and that password was exposed in
chat. With the current Firestore rules (P0-2), guessing the owner password = full
data takeover.
**Change:** Firebase Console → Authentication → Users → reset that password to a
long unique passphrase. Enable 2FA on the Google account. Change it anywhere it
was reused.
**Verify:** log in with the new password; old one fails.

### P0-2 ⚠️ Publish hardened Firestore rules  ·  effort: 20 min  ·  risk: med (test first)
**Problem (CRITICAL C1/C2):** live `firestore.rules` grant every signed-in user
full read/write/**delete** on all collections, and let any signed-in user write
`appSettings/roles` — i.e. **any staff account can self-promote to admin** via the
console/REST. UI role gating (`canDelete`, `canManageData`) is cosmetic; it never
reaches the database.
**Change:** publish `firestore.rules.hardened` (already in repo). It makes
`appSettings` writes and all destructive deletes **admin-only**, keeps ledgers
append-only.
**Steps:**
1. Firebase Console → Firestore → Rules.
2. Open **Rules Playground**. Test, for each collection, with: the owner email,
   a staff email, and an unauthenticated request — running read/create/update/delete.
   Confirm staff can read+create+update but **cannot delete** and **cannot write
   appSettings**; owner can do everything.
3. Confirm `appSettings/roles.admins` stores **lowercase** emails (the rule
   compares `request.auth.token.email.lower()`), and that the owner email in the
   rule matches `BOOTSTRAP_ADMINS`.
4. Paste the hardened rules, **Publish**. Keep a copy of the old rules to revert.
**Verify:** in Playground, a staff token's `delete` on `/parts/x` is DENIED and
`update` on `/appSettings/roles` is DENIED; owner's are ALLOWED.
**Rollback:** if the owner loses access, re-publish the previous rules and re-test.

---

## P1 — HIGH (fix before scaling beyond the current single shop)

### P1-1 🔧 Move part images out of Firestore (base64 → Storage)  ·  effort: 0.5–1 day  ·  risk: med
**Problem (HIGH H1):** production part photos are stored as base64 `imageString`
inside each `parts` document (`FileReader.readAsDataURL`, InventoryDashboard.js
~line 2000). Every inventory read pulls the full image payload → slow lists, high
read cost/bandwidth, and risk of breaching Firestore's 1 MB/doc limit on a
high-res upload. This is the main scalability liability.
**Change (outline):**
1. Enable Firebase **Storage**; add Storage rules (auth-only write, public/CDN read).
2. On upload: `uploadBytes(ref(storage, 'parts/${id}.jpg'), file)` →
   `getDownloadURL()` → store the **URL** in `imageUrl`, not base64.
3. Render from `imageUrl`; keep `imageString` only as a legacy fallback.
4. One-time migration script: for each part with `imageString`, upload the blob,
   set `imageUrl`, clear `imageString`.
**Why not done here:** needs your Storage bucket + rules + testing against real
uploads; shipping it blind could break the upload path. **Test on a copy first.**
**Verify:** a `parts` doc after upload contains a short `imageUrl` and no base64;
list reads are small in the Network tab.

### P1-2 🔧 Virtualize large tables + load-test  ·  effort: 0.5 day  ·  risk: low
**Problem (HIGH H2, NOT VERIFIED):** inventory/sales tables paginate but don't
virtualize. Behavior at 1k–10k rows is unverified (no infra / no live browser).
**Change:** wrap the inventory and sales lists in `react-window`
(`FixedSizeList`) or TanStack Virtual; render only visible rows. Lazy image attrs
already added (3.9.1).
**Verify:** seed 5k demo parts; scroll stays smooth; DOM node count stays bounded.

### P1-3 🔧 Composite indexes for any compound query  ·  effort: 1 hr  ·  risk: low
**Problem (HIGH H3, latent):** `firestore.indexes.json` is empty. Current
subscriptions are single-field `orderBy('name')` (no index needed), so nothing is
broken **today** — but any future `where + orderBy` on different fields throws
`failed-precondition` at runtime.
**Change:** when you add a compound query, let Firestore's error give you the
index link, add it to `firestore.indexes.json`, and `firebase deploy --only
firestore:indexes`.
**Verify:** run each query path against production-shaped data; no index errors.

---

## P2 — MEDIUM (quality / maintainability)

### P2-1 🔧 Add a test harness, then modularize the monolith  ·  effort: multi-day  ·  risk: high if unguarded
**Problem (M1/M2):** `components/InventoryDashboard.js` is ~8,600 lines with no
automated tests. High regression surface; hard to onboard/maintain.
**Change (order matters):**
1. First add unit tests (Vitest/Jest) for pure logic: stock math, SKU dedupe,
   supplier linkage `{id,name,phone,isPreferred}`, rollup increments.
2. Only then extract: `hooks/` (useInventory, useSuppliers, useSales),
   `services/` (firestore read/write), `components/` (views/modals).
**Why not done here:** refactoring 8.6k lines without tests risks breaking working
behavior — violates "no breaking changes." Tests must come first.
**Verify:** tests pass; build green; app behaves identically.

### P2-2 🔧 Accessibility pass (WCAG AA)  ·  effort: 1 day  ·  risk: low
**Problem (M3):** `prefers-reduced-motion` added (3.9.1), but icon-only buttons
largely lack `aria-label`; keyboard order, visible focus, screen-reader naming,
and 200% zoom are unverified.
**Change:** add `aria-label` to every icon-only button (archive/restore/delete/
edit/reorder/WhatsApp); ensure `:focus-visible` rings on all interactive
elements; verify tab order and dialog focus-trapping on modals.
**Verify:** keyboard-only walkthrough of add/edit/sell/reorder; screen-reader
announces each control; Lighthouse a11y ≥ 95.

---

## P3 — LOW

### P3-1 ✅ Upgrade Next.js off the vulnerable 14.2.3  ·  DONE (build-verified)
**Problem (L1):** `next@14.2.3` carries a published security advisory (your
`npm install` warned it).
**Change applied:** `package.json` → `"next": "14.2.35"` (latest patched in the
backward-compatible 14.2.x line). Reinstalled; the security warning is gone.
**Verify:** `npm install` no longer prints the next advisory; `next build` →
`▲ Next.js 14.2.35 · ✓ Compiled successfully` (done).

### P3-2 🔧 "Remember me" UI (optional)  ·  effort: 30 min  ·  risk: none
Firebase default LOCAL persistence already keeps sessions across refresh/tabs, so
this is cosmetic. Add an explicit toggle only if you want session-only mode.

---

## Verified-STRONG (no action needed — keep as is)
- Atomic stock deduction via `runTransaction` + `increment()` (sell path is race-safe).
- Append-only ledgers (`update: false` on sales/restocks/stockAdjustments/auditLog).
- Strict SKU uniqueness block (excludes self) on add/edit.
- Password reset (`sendPasswordResetEmail`) + Firebase brute-force throttling.
- In-memory demo isolation (synthetic user; zero Firestore reads by design).
- Image rendering: contain (no clipping) + `loading="lazy"` + `decoding="async"` + onError fallback.
- ErrorBoundary (no white-screen-of-death); `prefers-reduced-motion`.
- External links carry `rel="noopener noreferrer"`; no `dangerouslySetInnerHTML`.
- Automotive domain realism (suppliers, distribution, mappings) is credible.

---

## Still BLOCKED (cannot verify without a live browser session you drive)
Responsiveness at 320/375/768/1024/1280/1440px; keyboard + screen-reader a11y;
KPI-vs-source reconciliation; import/export round-trip on live data; multi-tab /
offline / slow-network; modal/z-index/overflow visual checks; performance at
500–10,000 records. Convert these to pass/fail by driving **Demo Admin**
(`?demo=admin`, no credentials, in-memory) and sharing screenshots/numbers.

---

## Suggested order of execution
1. **P0-1** rotate password + 2FA (5 min).
2. **P0-2** publish hardened rules after Playground testing (20 min). ← biggest risk reducer.
3. **P3-1** Next upgrade — already done; just deploy it.
4. **P1-1** images → Storage (before adding many real photos).
5. **P1-2 / P1-3** virtualization + indexes (before scaling).
6. **P2-1 / P2-2** tests+modularization, a11y (ongoing quality).
