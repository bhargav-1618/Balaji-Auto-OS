# Balaji Auto OS

[![CI](https://github.com/bhargav-1618/Balaji-Auto-OS/actions/workflows/ci.yml/badge.svg)](https://github.com/bhargav-1618/Balaji-Auto-OS/actions/workflows/ci.yml)

Version 1.0.0 · An offline-first auto-parts and garage ERP for Indian workshops.

## Project Overview

Balaji Auto OS is a workshop management system covering the full service lifecycle:
customers and their vehicles, job cards, billing and payments, parts sales, labour/services,
inventory and suppliers, and business analytics. It is built as a single-page Next.js
application backed by Firebase Firestore, with a fully isolated demo mode for
demonstrations.

## Features

- **Customers & Vehicles** — profiles, multiple vehicles per owner, service history, duplicate-phone detection.
- **Job Cards** — service intake, complaints/diagnosis, parts reservation, status workflow, printable job card (PDF + QR).
- **Billing** — invoices, estimates, partial/full payments, GST, discounts, credit notes; a reversible transaction engine that derives every total from line items.
- **Sales & Services** — parts-sales and labour ledgers with detail panels and Excel/CSV export.
- **Inventory & Suppliers** — stock, low-stock alerts, stock-in/stock-out ledgers, supplier directory.
- **Analytics & Reports** — revenue/profit KPIs, inventory health, workshop score, reminders.
- **Roles & Permissions** — admin / staff / guest, enforced by Firestore security rules.
- **Demo Mode** — a fully isolated in-memory sandbox that cannot touch production data or config.

## Architecture

- **Next.js 14** (Pages Router) + **React 18**, styled with **Tailwind CSS**.
- **Firebase Firestore** for persistence; **Firebase Auth** for sign-in.
- Business logic lives in framework-free pure functions under `services/` and `lib/`,
  so it is unit-testable without a browser.
- The Firestore **security rules are the security boundary**; client-side role checks are
  convenience only.

For a full breakdown of layers, data flow, authentication, navigation, and module
relationships, see **[docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md)**.

## Folder Structure

```
Balaji-Auto-OS/
├── components/          UI components and feature modules (per business area)
├── pages/               Next.js routes (/, /login, /verify, 404, _app, _document)
├── services/            Business logic (billing engine, analytics, workflows)
├── repositories/        Firestore data-access layer
├── context/             React Context providers (auth / roles / demo)
├── hooks/               Reusable React hooks (barcode scanner, etc.)
├── lib/                 Shared utilities (format, search, Firebase init, exports, PDF/QR)
├── constants/           Design tokens, collection names, limits, status colours
├── public/              Static assets (icons, manifest, service worker)
├── styles/              Global + module CSS
├── tests/               Automated test suites (Node/jsdom) + tests/rules (emulator)
├── bench/               Performance micro-benchmarks
├── tools/               Dev scripts (static scanners)
├── scripts/             One-off maintenance/generation scripts
├── docs/                Documentation, guides, release notes, roadmap
│   ├── architecture/    ARCHITECTURE.md — layers, data flow, subsystems, business workflows
│   ├── development/     DEVELOPMENT.md — local setup, dev workflow, demo modes
│   ├── testing/         TESTING.md — running suites, QA coverage, verification ceiling
│   └── deployment/      DEPLOYMENT.md — build, env, Firebase rules, rollback
├── .github/workflows/   CI (lint · build · test)
├── firebase.json        Firestore rules + indexes deploy config
├── .firebaserc          Default Firebase project for the CLI
├── firestore.rules      Security rules (the security boundary)
├── firestore.indexes.json
├── next.config.js       Next config + security headers + CSP
├── tailwind.config.js
├── postcss.config.js
├── package.json
├── VERSION
└── README.md
```

Every major folder contains its own `README.md` describing its purpose.

## Installation

Requires Node.js 18+ (tested on Node 22; CI runs Node 22).

```bash
npm install
```

## Environment Variables

Firebase configuration is read entirely from environment variables (all public
`NEXT_PUBLIC_*` client keys — security comes from the Firestore rules, not key secrecy).
Copy the example and fill in your Firebase project values:

```bash
cp .env.local.example .env.local
```

Required keys:

```
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
```

`.env.local` is gitignored and must never be committed. The app fails fast with an
actionable error if any variable is missing.

Optional: `NEXT_PUBLIC_SITE_URL` — a stable public origin baked into the QR code on
invoice/job-card PDFs. See `.env.local.example` for details; the app works without it.

## Running Locally

```bash
npm run dev      # start the dev server (http://localhost:3000)
npm run build    # production build
npm run start    # serve the production build
npm run lint     # ESLint
npm test         # full test suite
```

## Demo Login

Three access levels — see [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md#demo-vs-demo-admin-vs-production)
for the full model:

- **Demo User** — `demo@balajiautoos.com` / `Demo@123`. A fully isolated in-memory sandbox
  (no production data); add/edit only.
- **Demo Admin** — `demo-admin@balajiautoos.com`. Same sandbox, plus delete/archive/reset —
  scoped to the sandbox only, never production.
- **Production/Admin** — a real Firebase Auth account whose email is listed in
  `appSettings/roles` (Firestore) or in the code-level `BOOTSTRAP_ADMINS` fallback in
  `context/AuthContext.js`. Full access, governed by `firestore.rules`.

## Testing

Test suites execute real shipped code in a Node/jsdom harness. The harness
dependencies are ordinary devDependencies — `npm install` is all that's needed:

```bash
npm test                           # run the full suite
node tests/<suite>.test.cjs        # run one suite
node tools/scan-undef.cjs .        # undefined-identifier scan
node tools/scan-tdz.cjs .          # temporal-dead-zone scan
```

See [docs/testing/TESTING.md](docs/testing/TESTING.md) for details.

## Deployment

The app is a standard Next.js build and is hosted on **Vercel**, backed by the
**Firebase** project pinned in `.firebaserc`. Pushes to `main` deploy automatically.

To stand up a new environment:

1. Deploy the app (Vercel), setting the six `NEXT_PUBLIC_FIREBASE_*` environment variables.
2. **Publish the Firestore security rules** to your Firebase project — required before go-live:
   ```bash
   firebase deploy --only firestore:rules
   ```
3. Enable **Email/Password** authentication and create the owner account with a strong password.

See [docs/deployment/DEPLOYMENT.md](docs/deployment/DEPLOYMENT.md) for details and
[docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) for the verification ceiling.

## Technologies Used

Next.js 14 · React 18 · Tailwind CSS · Firebase (Firestore + Auth) · lucide-react ·
react-hot-toast · jsPDF · qrcode · SheetJS (xlsx).

## Status & Version History

Current version: **1.0.0** — first production release, targeting single-location
workshops. The transaction/billing engine is covered by an executable test suite;
multi-terminal concurrency and a few operational items are open and tracked in
[docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) and
[docs/ROADMAP.md](docs/ROADMAP.md).

See [docs/CHANGELOG.md](docs/CHANGELOG.md) and
[docs/RELEASE_NOTES.md](docs/RELEASE_NOTES.md) for release detail.

## Browser Support

Targets current evergreen desktop and mobile browsers:

| Browser | Support |
|---------|---------|
| Chrome / Edge (Chromium) | Fully supported (primary target) |
| Firefox | Supported |
| Safari (desktop & iOS) | Supported |

The UI is responsive across desktop, laptop, tablet, and mobile, and preserves pinch-zoom
for accessibility (WCAG 1.4.4). Rendering, print/PDF output, and download behaviour should
be validated in-browser as part of release QA.

## Troubleshooting

- **App fails to start / blank screen with an env-var error** — a required
  `NEXT_PUBLIC_FIREBASE_*` variable is missing from `.env.local`. The app fails fast with an
  actionable message; re-check against the Environment Variables list above.
- **"Permission denied" reading/writing Firestore** — the security rules haven't been
  published yet (`firebase deploy --only firestore:rules`), or the signed-in account isn't
  in `appSettings/roles`/`BOOTSTRAP_ADMINS` for an admin-only action. See Production
  Deployment above and `docs/architecture/ARCHITECTURE.md`'s Demo/Demo Admin/Production
  section.
- **Signed in but the wrong login screen / demo data instead of real data** — check the URL
  for a lingering `?demo=1`/`?demo=admin` query param or `maruti_demo`/`maruti_demo_admin`
  in `sessionStorage`; demo mode is sticky per-tab until explicitly exited.
- **Voice search says "needs Chrome or Edge"** — the Web Speech API isn't available in that
  browser; this is expected, not a bug (see `docs/development/DEVELOPMENT.md`).
- **A test suite fails locally but the app works fine in the browser** — check
  `docs/testing/TESTING.md`'s verification ceiling: the Node/jsdom suite verifies logic and
  wiring, not rendered pixels — some categories of "bug" are only visible in a real browser.
- Still stuck: `docs/KNOWN_LIMITATIONS.md` documents every known boundary honestly; if it's
  not listed there or above, it's a genuine bug worth filing.

## Known Limitations

Known boundaries are documented honestly in
**[docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md)** — including single-location
concurrency (invoice numbering is not yet transaction-safe), the absence of list
virtualisation (pagination covers current scale), and the browser-only verification ceiling.
Two deployment-time operational tasks (publishing the Firestore rules and setting a strong
owner password) must be completed before go-live.

## Author

Developed for **Sri Baba Balaji Maruti Care**.

## License

Proprietary — © Sri Baba Balaji Maruti Care. All rights reserved.
