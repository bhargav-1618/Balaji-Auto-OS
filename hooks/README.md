# `hooks/` — Shared React Hooks

Generic, reusable React concerns extracted out of `components/InventoryDashboard.js` —
scroll locking, viewport detection, pagination — with zero business logic. Domain-specific
hooks (search debouncing) live alongside their domain in `lib/` (see `lib/useSearch.js`);
this folder is for hooks that are pure React plumbing, not tied to any one feature.

## Contents

| File | Purpose |
|------|---------|
| `useBodyScrollLock.js` | Reference-counted body/app-scroller lock for the lifetime of a mounted modal or full-screen page. |
| `useIsMobile.js` | Viewport-size detection via `matchMedia`; drives the desktop-modal vs. mobile-full-screen-page split used throughout the app's forms. |
| `useViewMore.js` | Progressive "View More" pager (no artificial Top-N cap), used by Analytics' ranked tables. |

## Developer notes

- Keep hooks here generic — if a hook only makes sense for one domain (billing, inventory),
  it belongs next to that domain's service, not here.
- No Firestore, no toasts, no navigation. These hooks may only touch the DOM/browser APIs
  (`matchMedia`, scroll) and React state.
