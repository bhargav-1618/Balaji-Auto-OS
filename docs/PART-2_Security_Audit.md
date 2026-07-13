# PART-2 — Authentication, Authorization & Session Audit

**Project:** Balaji Auto OS · **Version at audit:** 12.3.0
**Scope:** Authentication · Authorization · Session Management · Routing · Navigation · Shell · Global Search
**Method:** Traced the actual implementation. Nothing assumed.

---

## ⚠️ READ THIS FIRST

> **Authorization scores 9.0 in the repository and 3.0 in production.**
>
> The hardened Firestore ruleset is written, verified and promoted to `firestore.rules`.
> **It has not been published in the Firebase console.**
>
> **Until you publish it, any signed-in staff member can delete every invoice and every
> customer from the browser console.** The 65 UI permission checks are decoration.
>
> This is a five-minute fix and it is the highest-severity item in the entire program.

---

## 🔴 CRITICAL — Privilege escalation (FIXED IN REPO, NOT YET LIVE)

**Issue.** Authorization was **UI-only**.

**Root cause.** The deployed `firestore.rules` gated everything on `request.auth != null`
— **zero role checks** — while the UI carried **65** `isAdmin`/`perms` checks. A correct
`firestore.rules.hardened` (19 role checks) had been written and **never promoted**.

**Impact.** Any signed-in staff member could open DevTools and `deleteDoc()` every
invoice, customer and job card. Permission UI was cosmetic.

**Fix.** Promoted the hardened ruleset after verifying compatibility:
- reads the **same** `appSettings/roles` doc the app already reads/writes
- same owner email
- `appSettings` writable **only by admins** → **no self-promotion**
- ledgers **append-only** (`allow update: if false`)
- 14 admin-gated deletes

**Files:** `firestore.rules` (previous ruleset preserved as `firestore.rules.permissive.bak`)
**Regression risk:** Low in code · **HIGH if published without testing an admin login first**

---

## 🔴 HIGH — Logout leaked customer data (FIXED)

**Root cause.** `signOut()` clears the Firebase token but **not** the offline-first caches.

**Impact.** On a shared workshop counter PC, the next person to open the app saw the
**previous user's customers and invoices** rendered from `localStorage` before auth
resolved. A privacy breach involving customer names, phone numbers and vehicle details.

**Fix.** `lib/session.js` → `clearBusinessCaches()`, wired into logout **and** `exitDemo`.
Preferences (theme, sidebar) are deliberately kept — they are not customer data.

---

## 🔴 HIGH — Session never expired (FIXED)

**Root cause.** No `setPersistence()` call existed anywhere. Firebase defaulted to
`browserLocalPersistence`, so **every login persisted forever** — including on a shared
terminal where the user did not tick "remember me". The checkbox only saved the *email*.

**Fix.**
- `remember` → `browserLocalPersistence`; otherwise `browserSessionPersistence` (dies with the tab)
- **8-hour idle timeout** → signs out, clears caches, redirects to `/login?expired=1`
- Login page shows the expiry message. Being silently dumped at login mid-shift reads as a crash.

---

## 🔴 HIGH — Pinch-zoom blocked (FIXED)

`maximum-scale=1` in `pages/index.js` **overrode** the correct viewport in `_app.js`.
WCAG 1.4.4 failure — and a real problem for older workshop owners who zoom to read part
numbers.

---

## 🟡 MEDIUM — Fixed

| Issue | Root cause | Fix |
|---|---|---|
| **AuthContext re-render storm** | Inline object literal → new context value **every render** → every `useAuth()` consumer re-renders | `useMemo`'d. Also `useCallback`'d `exitDemo`, which was recreated each render and **would have defeated the memo entirely**. |
| **No deep linking** | 16 modules behind one URL; `activeTab` was `useState`. Browser Back **exited the app**; refresh lost your place; you could not bookmark "the Billing screen". | Hash-synced (`#billing`), validated against `TAB_KEYS`. |
| **No 404 page** | Fell through to Next.js default — looks like a broken deployment | Branded `pages/404.js` |
| **Ctrl+K searched the catalogue only** | Parts/suppliers/categories/vehicles — useless when a customer rings quoting a number plate | Now searches customers, invoices, job cards. The dispatcher **silently ignored the new types** until completed. |

---

## Verification

```
Deep-link hash validation ......... 9/9 PASS
  (rejects #<script>, #__proto__, #constructor, path traversal)
Engine regression ................. 8/8 PASS — business behaviour untouched
Undefined-identifier scanner ...... clean
TDZ scanner ....................... clean
Build ............................. green
```

---

## Scores

| Area | Before | After |
|---|---|---|
| Authentication | 7.5 | **9.2** |
| **Authorization (repo)** | **3.0** | **9.0** |
| **Authorization (PRODUCTION)** | **3.0** | **3.0 ← until rules are published** |
| Session Management | 5.0 | **9.3** |
| Routing | 5.5 | 8.3 |
| Navigation | 7.5 | 8.5 |
| Dashboard | 8.0 | 8.2 |
| Sidebar | 8.0 | 8.2 |
| Header | 7.5 | 7.8 |
| Global Search | 6.0 | **8.5** |
| Application Shell | 7.0 | 8.0 |
| Performance | 7.0 | 8.5 |
| Accessibility | 6.0 | 8.0 |
| **Overall Part-2** | **6.4** | **8.5** |

Not 9.5. Reasons below.

---

## What prevents 10/10

1. **The rules are not published.** Authorization is 3.0 in production until you paste them
   into the Firebase console.
2. **`InventoryDashboard.js` is still 11,000+ lines.** Shell, sidebar, header, dashboard and
   all 16 modules are one component — they cannot be independently tested or lazy-loaded.
3. **Hash routing is pragmatic, not real routing.** No per-module code splitting; the initial
   bundle carries all 16 modules.
4. **No automated a11y or E2E suite, and no browser.** Every claim is code-verified, never
   browser-observed.

---

## Deferred to v2.0

- Splitting the container into real routes
- Server-side search (Algolia/Typesense) — the palette filters the in-memory window; fine at
  1,000 customers, needs indexing at 100,000
- Granular roles (Manager / Reception / Mechanic) — rules support admin vs staff today;
  finer tiers need a schema decision from the owner
