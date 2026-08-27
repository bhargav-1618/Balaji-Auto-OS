# Balaji Auto OS — Remediation Plan (what to fix / update / change)

Outstanding engineering and deployment work, ordered by priority. Each item lists the
problem, the change, files touched, who must do it (code change vs. Firebase/Vercel
console), effort, regression risk, and how to verify. Status legend:

- ✅ DONE — implemented + build-verified in this codebase
- ⚙️ DEPLOY — a Firebase/Vercel/secrets action a deployer must take per environment
- 🔧 TODO — code change, not yet done (scoped below)

---

## P0 — Deployment security (per environment, before real production use)

### P0-1 ⚙️ Set a strong owner password + enable 2FA  ·  effort: 5 min  ·  risk: none
**Problem:** the owner account (hardcoded permanent admin in `context/AuthContext.js`
via `BOOTSTRAP_ADMINS`) has full data access. A weak or reused password on that
account = full data takeover.
**Change:** Firebase Console → Authentication → Users → set a long unique passphrase
for the owner account. Enable 2FA on the underlying Google account.
**Verify:** log in with the new password; a weak/old one fails.

### P0-2 ⚙️ Publish the Firestore rules to your project  ·  effort: 10 min  ·  risk: med (test first)
**Problem:** `firestore.rules` is the security boundary, but rules only take effect
once published to a Firebase project. Until then the project uses whatever rules are
live there (often permissive defaults), and UI role gating (`canDelete`,
`canManageData`) is cosmetic — it never reaches the database.
**Change:** publish the repo's `firestore.rules` (already the hardened ruleset:
`appSettings` writes and all destructive deletes are admin-only, ledgers append-only).
Run `firebase deploy --only firestore:rules` or paste it in the console.
*(The reference deployment — project `balaji-auto-os-7` — has this ruleset published.)*
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
are already present.
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
**Problem (M3):** `prefers-reduced-motion` is respected, but some icon-only buttons
still lack `aria-label`; keyboard order, visible focus, screen-reader naming,
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

### P3-3 🔧 Inline base64 demo photos bloat the client bundle  ·  effort: 1 hr  ·  risk: low
**Problem:** `lib/partPhotos.js` is 201 KB / 26 lines — two demo-mode part photos
(`brake-pads`, …) inlined as base64 JPEG strings, imported by `lib/partImages.js`
for the public demo sandbox's illustrations. Every client that loads that code
path downloads the full 201 KB in the JS bundle regardless of whether the demo
photos are ever shown, instead of a real static asset the browser can cache and
lazy-load. **Distinct from P1-1 above** — P1-1 is real, *production* user-uploaded
part photos stored as base64 inside Firestore documents (a database read-cost/
scalability concern); this is *demo-only* sample data inlined at build time (a
client bundle-size concern). Not fixed here: moving it to `public/` and switching
`partImages.js` to reference a URL touches every call site and changes load
behavior (inline data URI vs. network fetch) — out of scope for a docs/cleanup
pass with a zero-behavior-change constraint.
**Verify (if fixed later):** `next build`'s output shows a smaller First Load JS
for any route that imports `lib/partImages.js`.

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
