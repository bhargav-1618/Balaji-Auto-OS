# Deployment — Balaji Auto OS v1.0.0

> This file replaces the old `docs/DEPLOYMENT_GUIDE.md`. Section 4 below has been corrected
> to match the real, current test tooling (see [docs/testing/TESTING.md](../testing/TESTING.md))
> — the old version referenced a `scan-undef.cjs .` path missing its `tools/` prefix and a
> hand-picked list of ~11 test names with a stale "218 passed" count, predating the
> `npm test` script that now runs the full current suite (109 files).

## 0. Requirements

- Node.js 18+ (build tested on Node 22)
- A Firebase project with Authentication (Email/Password) and Firestore enabled
- The `.env.local` in this package already contains the project's public Firebase
  `NEXT_PUBLIC_*` keys (these ship in the client bundle by design; they are not secrets).

## 1. Security — DO THIS FIRST (not optional)

The application logic is production-quality, but the DEPLOYMENT is not safe until both
of these are done. Neither can be fixed in code.

### 1a. Publish the Firestore security rules
The correct rules are in `firestore.rules`. Publish them:

    firebase deploy --only firestore:rules

or paste the file's contents into Firebase Console → Firestore → Rules → Publish.

Until this is done, any signed-in staff user can delete every invoice. The role checks
in the UI are guards, not a security boundary.

### 1b. Change the owner password
Set a strong password on the owner account before exposing the app publicly.

## 2. Install & build

    npm install
    npm run build
    npm start            # serves the production build

The build must end with "Compiled successfully". A CssSyntaxError warning from the
styled-jsx pipeline is harmless and expected.

## 3. Environment

`.env.local` (included) holds:

    NEXT_PUBLIC_FIREBASE_API_KEY=...
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
    (and the remaining NEXT_PUBLIC_FIREBASE_* keys)

To deploy against a different Firebase project, replace these values.

## 4. Verify the build (optional but recommended)

The full test suite and its harness dependencies (`jsdom`, `@testing-library/*`,
`@babel/*`) ship as ordinary `devDependencies` — `npm install` is the only setup step:

    npm run lint
    npm test                       # every tests/*.test.cjs file
    node tools/scan-undef.cjs .    # undefined-identifier scan
    node tools/scan-tdz.cjs .      # temporal-dead-zone scan

See [docs/testing/TESTING.md](../testing/TESTING.md) for expected output and what each
category of suite actually verifies.

## 5. Post-deploy smoke test (browser — do this yourself)

Automated tests run in Node, not a browser. After deploying, manually verify:

- Log in (real account + demo). The "Ignition" boot plays once, then a short transition
  on refresh.
- Create an invoice, add parts + labour, collect payment. Confirm stock decrements and
  the sale appears in Sales/Reports.
- Cancel that invoice. Confirm stock is restored and revenue reverses.
- Export invoices to Excel. Dates must read e.g. `13-Jul-2026` and sort; money columns
  must `SUM`.
- Mark-as-Paid → confirm → close, then scroll. The page must scroll (old freeze).
- Run Lighthouse on `/login` and `/`.

## 6. Rollback

This is a static Next.js build. Redeploy the previous build artifact to roll back; no
database migration is involved in this release.
