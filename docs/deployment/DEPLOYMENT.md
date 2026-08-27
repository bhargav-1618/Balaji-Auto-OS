# Deployment — Balaji Auto OS v1.0.0

Build, environment, Firebase setup, and the pre-go-live security steps. For what to
verify after each release, see [docs/testing/TESTING.md](../testing/TESTING.md).

## 0. Requirements

- Node.js 18+ (build tested on Node 22)
- A Firebase project with Authentication (Email/Password) and Firestore enabled
- The six `NEXT_PUBLIC_FIREBASE_*` values for that project (Firebase Console → Project
  Settings → Your Apps → Web App). These are public client keys — they ship in the
  client bundle by design and are not secrets; the security boundary is `firestore.rules`.

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

`.env.local` is gitignored and is **not** in the repo — create it from the template:

    cp .env.local.example .env.local     # then fill in the six NEXT_PUBLIC_FIREBASE_* values

    NEXT_PUBLIC_FIREBASE_API_KEY=...
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
    (and the remaining NEXT_PUBLIC_FIREBASE_* keys)

On Vercel (or any host), set these six as environment variables instead of a file. The
app fails fast with an actionable error if any is missing.

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

## 6. Hosting & rollback

The app is a standard Next.js build hosted on Vercel, with `main` set to auto-deploy.
To roll back, promote the previous deployment in the Vercel dashboard (or redeploy the
previous build artifact on any other host). No database migration is involved in this
release, so a rollback is code-only.
