# Known Limitations — Balaji Auto OS v1.0.0

Honest disclosure of what is NOT covered by this release. None of these is a hidden
defect; each is a documented boundary.

## 🔴 Deployment security — required per environment (not code)

1. **The Firestore security rules must be published to the target Firebase project.**
   `firestore.rules` in the repo is the hardened, correct ruleset, but rules only take
   effect once deployed (`firebase deploy --only firestore:rules`). Until then the
   project runs whatever rules are live there — often permissive defaults under which
   any signed-in user can delete records. The UI role checks (`isAdmin` / `canManage`)
   are client guards, NOT a security boundary.
2. **The owner account must have a strong password.** The bootstrap owner
   (`BOOTSTRAP_ADMINS` in `context/AuthContext.js`) always has full access; a weak
   password on it is a full-data-takeover risk.

These are configuration, cannot be fixed in the codebase, and must be verified for every
deployment. *(The reference deployment — Firebase project `balaji-auto-os-7` — has the
rules published.)*

## 🟠 Concurrency (single-location safe; fix before multi-terminal)

- **Invoice numbering is not concurrency-safe.** Two devices creating an invoice in the
  same second can collide. Needs a server-side counter (`runTransaction`). Low risk for a
  single-counter workshop.
- **Concurrent stock decrement** has the same class of race.

## 🟡 Performance (fine at current scale)

- The main dashboard is one large component; a keystroke re-renders it. This is made
  INTERRUPTIBLE via `useDeferredValue` (typing never blocks) but is not cheap. Splitting
  the container is a post-1.0 refactor.
- No table virtualisation. Pagination (25/page) keeps this a non-issue today; revisit
  past ~10,000 rows with a raised page size.

## Verification ceiling — browser-only, unverified here

All automated verification runs in Node/jsdom. The following require a real browser and
have NOT been measured:

- Actual rendering and pixel layout across desktop/tablet/mobile/large-monitor.
- Live Firestore round-trips and offline recovery.
- Print / PDF visual output.
- Lighthouse metrics: FCP, LCP, TBT, CLS, and category scores.
- The "feel" of the login boot sequence timing.

The code is built to pass these (transform/opacity-only animation, reserved image
dimensions, labelled controls, tiny bundle), but confirming them is a runtime task.

## UI consistency (partial)

The design-system foundation exists (`constants/ui.js`, shared `Badge`, one dropdown
primitive). A full cross-module spacing/typography sweep was intentionally deferred
because it requires visual verification on rendered pages, not blind code edits.
