# Development Guide — Balaji Auto OS

Local setup and day-to-day development workflow. For what the app does and how it's laid
out, see the root [README.md](../../README.md) and
[docs/architecture/ARCHITECTURE.md](../architecture/ARCHITECTURE.md).

> This file replaces the old `docs/SETUP_GUIDE.md`. That version had drifted from the real
> code — it told readers to edit a `ROLE_MAP` object in `context/AuthContext.js` that does not
> exist, and shipped a sample Firestore ruleset covering only 2 of the app's 16+ collections
> (already flagged in `docs/QA_AUDIT_SECTION1_FOUNDATION.md`, finding M-16). Both are corrected
> below against the actual current code.

## 1. Prerequisites

- **Node.js 18+** (built/tested on Node 22) — https://nodejs.org
- **Git**
- A **Firebase project** with **Authentication (Email/Password)** and **Firestore** enabled —
  https://console.firebase.google.com

## 2. Install

```bash
git clone <this repository>
cd balaji-auto-os
npm install
```

## 3. Environment setup

```bash
cp .env.local.example .env.local
```

Fill in the six `NEXT_PUBLIC_FIREBASE_*` values from Firebase Console → Project Settings →
Your Apps → Web App (see root `README.md`'s Environment Variables section for the exact list).
These are public client keys by design — the security boundary is `firestore.rules`, not key
secrecy. The app fails fast with an actionable error if any required variable is missing.

## 4. Run the dev server

```bash
npm run dev      # http://localhost:3000
```

Sign in with a Firebase Auth user you created in the console, or use **Demo Mode** (see
below) to explore without any Firebase setup at all.

## 5. Demo Mode vs. Demo Admin vs. Production

The app has three distinct access levels, all driven by `context/AuthContext.js`:

| Mode | How to enter | Data | Can delete/archive/reset? |
|------|---------------|------|----------------------------|
| **Demo User** | `?demo=1` or the public demo login (`demo@balajiautoos.com` / `Demo@123`) | Isolated in-memory sandbox seeded by `lib/demoGarageSeed.js` / `lib/demoData.js` — never touches Firestore | No (add/edit only) |
| **Demo Admin** | `?demo=admin` or `demo-admin@balajiautoos.com` | Same isolated sandbox | Yes, but scoped to the demo sandbox only |
| **Production** | A real Firebase Auth account | Live Firestore | Governed by role: **admin** or **staff** |

Production roles are **not** a hardcoded map in source. They're read live from Firestore at
`appSettings/roles` → `{ admins: [...emails] }`, editable from the in-app Settings page by an
existing admin. `BOOTSTRAP_ADMINS` in `context/AuthContext.js` is a code-level safety net — a
short list of emails (the owner) that are always admin even if that Firestore document is
empty or fails to load — not the primary mechanism. Client-side role checks
(`isAdmin`/`canManage`) are UX convenience only; `firestore.rules` is the actual trust
boundary (admin-only deletes, append-only ledgers, default-deny).

## 6. Common dev workflows

```bash
npm run build     # production build — must compile clean
npm run lint      # ESLint
npm test          # full suite: every tests/*.test.cjs file (Node/jsdom, no browser)
node tests/<suite>.test.cjs   # a single suite
npm run test:rules            # Firestore rules vs. the real rules engine (needs the Firebase emulator)
node tools/scan-undef.cjs .   # undefined-identifier scan
node tools/scan-tdz.cjs .     # temporal-dead-zone scan
node bench/search.cjs         # micro-benchmarks (search/customers/inventory)
```

See [docs/testing/TESTING.md](../testing/TESTING.md) for what each suite actually verifies
and its limits.

## 7. Safe test-data creation

Never create throwaway records against a real production Firebase project without a cleanup
plan. Prefer, in order:

1. **Demo Mode** (`?demo=1` / `?demo=admin`) — fully isolated, resettable, cannot touch
   production data or config. The default choice for exploring a workflow.
2. If you must test against a real project (e.g. a staging Firebase project), use clearly
   marked names (a consistent prefix) for every record you create, and delete them through
   the app's own UI (Customers/Vehicles/Job Cards/Billing/Inventory/Suppliers all support
   delete from their row actions) when done — never edit Firestore documents by hand.
3. Never run cleanup with direct Firestore console deletes on a shared/production project
   without confirming with whoever owns that data.

## 8. Debugging

- **Console errors first** — the browser console and Next.js dev server terminal output are
  the first two places to look; most wiring bugs surface there before a test would catch them.
- **`tools/leak.cjs`** flags `useEffect` hooks that create a subscription/timer/listener with
  no cleanup function — a common source of stale-data bugs after navigating away from a tab.
- **IndexedDB inspection** — Firestore's local persistence cache
  (`indexedDB.open('firestore/[DEFAULT]/<project-id>/main')`, `remoteDocumentsV14` store) is
  useful ground truth when the UI and what you expect the database to hold seem to disagree.
- **`docs/KNOWN_LIMITATIONS.md`** documents the verification ceiling — what automated tests
  do *not* cover (rendered pixels, print/PDF/xlsx downloads, live Firestore round-trips) —
  before assuming a gap is a bug.

## 9. Feature notes worth knowing before you touch them

- **Voice search** (`components/InventoryDashboard.js`, "Voice search" section) uses the
  browser's native Web Speech API (`window.SpeechRecognition`/`webkitSpeechRecognition`),
  toggling between `en-IN` and `te-IN` (Telugu). Requires Chrome or Edge; the app shows a
  clear error on unsupported browsers rather than failing silently.
- **Barcode/QR scanning** — `hooks/useBarcodeScanner.js` +
  `components/common/BarcodeScanButton.jsx`.
- **WhatsApp links** — plain `wa.me` deep links pre-filled with a message (e.g. low-stock
  supplier reorder, invoice payment reminders); no WhatsApp Business API/key involved.

## 10. Deployment

See [docs/deployment/DEPLOYMENT.md](../deployment/DEPLOYMENT.md) — publishing the Firestore
security rules is a required, non-optional step before any real go-live, independent of
hosting provider.
