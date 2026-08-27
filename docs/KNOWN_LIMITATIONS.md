# Known Limitations — Balaji Auto OS v1.0.0

Honest disclosure of what is NOT covered by this release. None of these is a hidden
defect; each is a documented boundary.

## 🔴 Deployment security — MUST be done before go-live (not code)

1. **Firestore security rules are not published.** `firestore.rules` is correct in the
   repo but must be pasted into the Firebase console. Until then, any signed-in staff
   user can delete every invoice. The UI role checks (`isAdmin` / `canManage`) are client
   guards, NOT a security boundary — they are bypassable without database rules.
2. **The bootstrap owner password is weak** if left at its default. Change it before
   exposing the app publicly.

These are configuration, cannot be fixed in the codebase, and outrank everything else.

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
