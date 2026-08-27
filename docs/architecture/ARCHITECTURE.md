# Balaji Auto OS — Architecture

This document describes how Balaji Auto OS is structured and how data moves through it. It
is intended for developers extending the system and reviewers assessing its design.

## Overview

Balaji Auto OS is an offline-first auto-parts and garage ERP for Indian workshops. It is a
**Next.js (Pages Router) single-page application** backed by **Firebase (Firestore + Auth)**,
styled with **Tailwind + styled-jsx** in a carbon-black/gold theme. The UI is a tabbed shell
rather than a multi-route site; modules are mounted by tab and navigate to each other through
a deep-link convention.

## Layered architecture

```
┌───────────────────────────────────────────────────────────┐
│  pages/            Route entry, auth guard, shell mount    │
├───────────────────────────────────────────────────────────┤
│  components/       UI modules + shell (view state only)    │
├───────────────────────────────────────────────────────────┤
│  services/         Domain operations & orchestration       │
├───────────────────────────────────────────────────────────┤
│  repositories/     Firestore data access (only layer here) │
├───────────────────────────────────────────────────────────┤
│  lib/firebase.js   SDK init (db, auth) from env vars       │
└───────────────────────────────────────────────────────────┘
        cross-cutting: context/ (auth), constants/, lib/ (utils)
```

Each layer depends only on the one below it. Components never reach Firestore directly;
they call handlers that route through services and repositories.

## Folder hierarchy

```
balaji-auto-os/
├── pages/           Next.js routes (/, /login, /verify, 404, _app, _document)
├── components/      UI modules + InventoryDashboard shell
├── services/        Domain/orchestration layer
├── repositories/    Firestore access layer
├── lib/             Utilities + Firebase init + exports/PDF/search
├── context/         AuthContext (global auth state)
├── constants/       TAB_KEYS, collection names, limits, UI tokens
├── styles/          Global CSS + design tokens
├── public/          Static assets
├── tests/           Node/jsdom suites (109 files, run by `npm test`)
├── tools/           Static scanners (undef, TDZ)
├── bench/           Micro-benchmarks
├── docs/            Guides, audits, release notes, this file
├── firestore.rules  Security rules (least-privilege, default-deny)
├── firebase.json    Firebase config (rules + indexes)
└── next.config.js   Security headers + CSP
```

## Data flow

```
User action
  │
  ▼
Component (local view state: search/filter/pagination/selection)
  │  handler callback (onPersist / onDelete / …)
  ▼
Service (domain operation, orchestration)
  │
  ▼
Repository (Firestore read/write/subscribe)
  │
  ▼
Firestore  ──►  live snapshot  ──►  props flow back down  ──►  re-render
```

Data flows **down** as props from the shell (which owns live subscriptions); changes flow
**up** through handler callbacks. Derived data uses `useMemo`; large-list typing uses
deferred search so input never blocks rendering.

## Authentication flow

```
/login ── email/password ──► Firebase Auth
   ▲                              │ onAuthStateChanged
   │                              ▼
   │                        AuthContext (user, loading, demoMode)
   │                              │
   │                              ▼
   └── redirect if not signed ── pages/index.js ──► InventoryDashboard (shell)
                                   │
                                   ▼
                        idle-timeout watch (lib/session.js)
                                   │ inactivity
                                   ▼
                        sign out + clear business caches ──► /login?expired=1
```

- Protected entry: `index.js` redirects unauthenticated users to `/login`.
- Idle timeout expires sessions on shared shop terminals and clears cached data.
- Demo mode enters an isolated sandbox dataset without real credentials.

## Navigation flow

The shell holds the active tab and renders the matching module. Cross-module links use:

```
?open=<prefix>:<query>#<tab>
        │        │       └─ target tab (validated against TAB_KEYS)
        │        └─ record key / search term
        └─ writer prefix (customer, invoice, vehicles, inventory, jobcard, …)
```

The reader in `InventoryDashboard.js` resolves the prefix to a tab and writes a one-shot
handoff key to `localStorage`; the destination module consumes it on mount. Every writer
prefix has exactly one consumer — the graph is closed and covered by tests.

## Module relationships

```
Customers ──► Vehicles ──► Job Cards ──► Billing (invoice, dedup by job no.)
    ▲            │                          │
    └────────────┴──────────────────────────┘  (deep links both directions)

Inventory ◄──► Suppliers ──► Purchase Orders ──► Receiving ──► Stock update
                    │
                    └──► Supplier Performance (analytics dashboard)

Reports / Analytics  ◄── read-only aggregates over all of the above
```

## State management

- **Server state:** Firestore live subscriptions held by the shell, passed down as props.
- **Global state:** `AuthContext` (auth/demo) only.
- **View state:** local `useState`/`useMemo` per module; list search/filter/sort persisted
  to `sessionStorage` under `maruti_<module>_view`.
- **Drafts:** token-scoped `localStorage` keys (`maruti_<entity>_draft_<token>`) for
  multi-tab isolation.

## Firebase integration

- `lib/firebase.js` initialises the SDK from `NEXT_PUBLIC_FIREBASE_*` env vars and exports
  `db`/`auth`.
- `firestore.rules` is the authoritative trust boundary: signed-in read/create/update,
  admin-only deletes, append-only ledgers (`sales`, `restocks`, `stockAdjustments`,
  `auditLog`), admin-only `appSettings` writes (no privilege escalation), and a default-deny
  catch-all. Client-side permission checks are UX only.
- Files (part/vehicle photos, documents) are stored as base64 in Firestore; Firebase Storage
  is intentionally not used.

## Demo vs. Demo Admin vs. Production

Three access levels, all resolved in `context/AuthContext.js`:

| | Entry | Data | Delete/archive/reset |
|---|---|---|---|
| **Demo User** | `?demo=1`, or `demo@balajiautoos.com` | Isolated in-memory sandbox (`lib/demoGarageSeed.js`/`lib/demoData.js`) — never touches Firestore | No |
| **Demo Admin** | `?demo=admin`, or `demo-admin@balajiautoos.com` | Same sandbox | Yes, scoped to the sandbox only |
| **Production** | Real Firebase Auth sign-in | Live Firestore | Governed by role — see below |

Production authorization is **not** a hardcoded map. Roles are read live from Firestore at
`appSettings/roles` → `{ admins: [...emails] }`, editable in-app from Settings by an existing
admin. `BOOTSTRAP_ADMINS` (a short code-level list, currently just the owner) is a permanent
safety net if that document is empty, fails to load, or a permission error occurs — not the
primary mechanism. Every component receives derived `isAdmin`/`canManage`/`demoMode`/
`demoCanDelete`/`demoCanExport` props from this one resolution; these are **UX guards only**.
The actual trust boundary is `firestore.rules` (admin-only deletes, append-only ledgers,
default-deny catch-all) — see "Firebase integration" above.

## Inventory lifecycle

```
Purchase Order (Suppliers) ─► Receive Stock ─► stock += qty, restocks ledger entry
                                                       │
Job Card reserves parts ─► stock available check ─►  │
                                                       ▼
Invoice line consumes reserved stock ─► stock -= qty, sales ledger entry
                                                       │
                                                       ▼
                              stock ≤ minStock ─► Low Stock alert (Dashboard/Reports)
                              manual correction ─► Stock Adjustment (stockAdjustments ledger)
```

Every stock-changing event writes to an append-only Firestore ledger (`restocks`, `sales`, or
`stockAdjustments`) in addition to mutating the part's `stock` field — the ledgers are the
audit trail; the field is the fast-read current value.

## Audit architecture

`auditLog` is an append-only Firestore collection (creates only — no update/delete, enforced
by `firestore.rules`), written alongside privileged actions (archive/restore/delete, role
changes, settings changes). It's surfaced two ways: the Analytics module's own embedded audit
log panel (its own `useSearchIndex` over `name`/`performedByEmail`/`action`/`details.reason`),
and the generic Reports → Audit tab (a plain substring `ReportTable` search) — these are two
different UIs over the same collection, not two audit systems.

## Search architecture

One shared engine, `lib/useSearch.js`, used by every module's search box — no module hand-
rolls its own filter. Two functions:

- **`useSearchIndex(items, idFn, textFn, idsFn)`** builds a per-record index once per data
  change: a `hay` string (free-text fields — name, city, phone, category, …) and a normalized
  `ids` array (this record's *own* unique identifiers only — SKU, registration number, VIN,
  Customer/Job Card/Invoice number — never a linked-but-different record's identifier).
- **`rankIndexed(entry, query)`** scores a match: identifiers outrank free text (exact `8` >
  prefix `7` > suffix `6`, 2+ chars > contains `5`), then free text (exact `4` > prefix `3` >
  contains/token `2`), `0` = excluded entirely. `matchIndexed` is the boolean wrapper.

This tiered design is deliberate history, not incidental: an earlier version matched
identifiers by substring only, which made "SBBMC40" also match "SBBMC400"; a later version
tried folding a *linked* record's identifiers in at a lower tier (a customer surfacing merely
because one of their job cards happened to share a number shape with an unrelated customer's
ID) and reverted it, for the same reason. See the header comment in `lib/useSearch.js` for the
full reasoning — it is the canonical source, this section is only a map to it.

## PDF/export architecture

- **`lib/pdfTheme.js`** — the one shared landscape-report PDF generator
  (`exportReportPDF({title, head, rows, filters, filename, shop, demoMode})`), used by every
  report export (Revenue, Parts/Service/Labour Sales, Inventory, Billing, GST, Audit, …).
  Shared helpers: `drawPdfHeader`/`drawWatermark`/`drawPdfPageNumber` for branding, `cellText()`
  (replaces `₹` with `Rs. ` — jsPDF's built-in Helvetica has no Rupee glyph), `fitText()`
  (binary-search ellipsis truncation). A caller must pass its already-formatted display rows
  (with `₹`/`Rs.` strings) through this generator — passing a raw-number array meant for
  Excel's `SUM()` produces unformatted currency cells (a real, since-fixed bug in
  `InventoryReports.jsx`).
- **`lib/workshopInvoicePdf.js`** — the separate, more elaborate Workshop Copy invoice PDF
  (multi-page notes, QR code via `lib/pdfQr.js`). Zero React/DOM/Firebase dependency by
  design, so it can be exercised from a plain Node script
  (`scripts/render-workshop-pdf-stress.js`) for visual regression checking against synthetic
  edge-case invoices, independent of the running app.
- **`lib/exportSheet.js`** (`writeSheet`) — the shared Excel/CSV writer. Numbers are written
  as real numeric cells, not quoted strings — an earlier writer quoted every value, which
  made a valuation/profit export arrive in Excel with money columns as text, so `=SUM()`
  silently returned `0`.

## Settings architecture

One settings blob per mode, in `localStorage` under `maruti_settings` (production) /
`maruti_settings_demo` (demo) — never shared between the two. Every field (Business Profile,
Appearance — theme/font size/reduce-motion, language) applies instantly on save via a
`maruti-settings` `CustomEvent`, so every mounted component reacts without a page reload or
prop-drilling, and without a separate "Save Changes" step for preference-style fields.

## Localization

`lib/i18n.js` is the single, first-and-only localization system (`LanguageProvider` context +
`useTranslation()`'s `t(key, fallbackEnglish, params)`). The selected locale is read from the
same settings blob above (`biz.language`) — not a second, competing key. English is never
duplicated into a translation dictionary: every call site already owns its English string and
passes it as `t()`'s fallback, so `t()` only ever answers "is there an hi/te override for this
key?" — supported locales today are English and Telugu (`te-IN`), matching the same language
pair used by voice search (see `docs/development/DEVELOPMENT.md`).

## Business workflows

Three representative flows, each noting the Firestore collection(s) data lands in and which
modules read it back.

### Service flow: Customer → Vehicle → Job Card → Billing → Audit

```
Customer (customers) ─► Vehicle (embedded on the customer doc)
        │
        ▼
Job Card (jobCards) — Received → Inspection → Estimate → Repair → Ready → Delivered
        │  reserves parts on creation, releases on Delivered/Closed/Cancelled
        ▼
Invoice (invoices) — generated from the Job Card, deduped by job number (no duplicate
        │             invoices for the same job)
        ▼
Payment(s) recorded on the invoice — outstanding tracked, balance floored at 0
        │
        ▼
Inventory consumption — invoice Part lines decrement `parts.stock`, write a `sales` ledger
        │              entry (see Inventory lifecycle above)
        ▼
auditLog — privileged actions along the way (archive/delete/status change) are appended
        │
        ▼
Reports / Analytics / Dashboard — read-only aggregates over all of the above
```

Consumers: `components/customers/CustomersModule.jsx`, `components/vehicles/VehiclesModule
.jsx`, `components/jobcards/JobCardModule.jsx`, `components/billing/BillingModule.jsx`,
`InventoryDashboard.js` (Reports/Analytics/Dashboard tabs).

### Procurement flow: Purchase Order → Receive Stock → Inventory → Movement Timeline

```
Purchase Order (purchaseOrders) — built against a supplier (suppliers), line items = parts
        ▼
Receive Stock — supplier delivers; receiving writes a `restocks` ledger entry per line and
        │        increments `parts.stock`
        ▼
Inventory (parts) — current stock/pricing; Low Stock / Out of Stock computed live from it
        ▼
Movement Timeline — the part's own history view reconstructs its movement from the
                     `restocks` + `sales` + `stockAdjustments` ledgers (never from mutating
                     the stock field alone, which has no history)
```

Consumers: `components/inventory/SupplierPOBuilder.jsx`, `components/inventory
/SupplierDirectory.jsx`, `components/inventory/SupplierPerformance.jsx`,
`services/inventoryService.js`, `services/purchaseOrderService.js`.

### Revenue flow: Invoice → Payment → Revenue → Reports → Analytics

```
Invoice (invoices) — line items (Part/Labour/Other) → GST → totals
        ▼
Payment(s) — cash/UPI/card/etc.; an invoice is only "realized" (counts as revenue) once
        │     fully paid — a partially-paid or draft invoice does not leak into KPIs
        ▼
Revenue — Dashboard/Billing KPIs, Vehicle-level revenue (only realized invoices)
        ▼
Reports — Revenue by Invoice, Parts/Service/Labour Sales, GST Report (all via the shared
        │  PDF/export engines above)
        ▼
Analytics — workshop score, profit, top customers/suppliers — read-only aggregates
```

Consumers: `components/billing/BillingModule.jsx`, `InventoryDashboard.js` (Reports,
Analytics, Dashboard tabs). Financial invariants for this flow are the most heavily
regression-tested area of the codebase — see `revenue-consistency.test.cjs`,
`overpayment.test.cjs`, `certification.test.cjs` in
[docs/testing/TESTING.md](../testing/TESTING.md).

## Developer workflow

```
edit ─► npm run build (must compile)
     ─► node tools/scan-undef.cjs .   (known FP count)
     ─► node tools/scan-tdz.cjs .     (0)
     ─► run tests/ suites             (must stay green)
```

Guardrails: do not change financial calculations, Firestore schema, invoice numbering, or
security rules without corresponding test updates. Business logic is covered by regression
suites; wiring is covered by source assertions and the static scanners.

## Known boundaries

See `docs/KNOWN_LIMITATIONS.md`. In brief: single-location concurrency (invoice numbering
is not yet transaction-safe), no list virtualisation (pagination covers current scale), the
shell is a large composition root (post-1.0 split), and all browser-only behaviour (render,
print/PDF, live Firestore) requires manual QA. Publishing the Firestore rules and setting a
strong owner password are deployment-time operational tasks.
