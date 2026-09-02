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

- **Invoice numbering IS concurrency-safe** (CONCURRENCY PHASE 2 — shipped, rules
  published, production-verified with 1/2/3 concurrent clients). The `INV-`/`EST-`
  serial is allocated at save time by a Firestore transaction on `counters/invoices` /
  `counters/estimates` (`lib/docCounter.js`) — two terminals billing in the same moment
  get distinct, sequential numbers. A new invoice no longer previews a number; the
  editor says *"number assigned on save"*. Drafts (`DRF-`) stay client-side (a
  throwaway handle, never a GST serial, and a unique doc id means a clash loses no
  data). Behaviour notes:
  - Creating a new invoice now **requires connectivity** (same as editing an invoice or
    collecting a payment, which were already transactional). On failure the editor stays
    open with nothing lost.
  - If a save fails *after* the number is allocated, that number is **skipped** (a gap)
    — legal under GST Rule 46(b), and far preferable to a duplicate.
  - The counter only moves forward. To reset it (e.g. after test invoices), delete the
    `counters/invoices` document in the Firebase Console — it re-seeds from
    `max(existing) + 1` on the next save. Clients cannot lower it (`allow delete: if
    false`, `next >= resource.data.next`).
- **Concurrent stock decrement** still has the last-write-wins race — a `runTransaction`
  on the invoice-driven stock path is the one remaining pre-multi-terminal item.

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
