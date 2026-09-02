# Roadmap — Balaji Auto OS

Forward-looking work beyond 1.0.0. None of this blocks single-location use of the
current release.

- For what 1.0.0 deliberately does **not** cover (browser-only verification ceiling,
  single-location concurrency assumptions), see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).
- For the per-environment deployment steps (publish `firestore.rules`, strong owner
  password), see [deployment/DEPLOYMENT.md](deployment/DEPLOYMENT.md) § 1.

---

## Concurrency — before multi-terminal use

- ~~**Server-side invoice counter.**~~ **DONE — CONCURRENCY PHASE 2, shipped and
  production-verified.** `INV-` allocation runs inside a Firestore `runTransaction` on
  `counters/invoices` (`EST-` on `counters/estimates`) — `lib/docCounter.js` →
  `store.allocateNumber` → `persistInvoice` — at save time. The editor no longer
  previews a number ("number assigned on save"). Verified with 1, 2 and 3 concurrent
  clients against live Firestore: distinct, sequential serials, zero duplicates. New-
  invoice creation now requires connectivity (as editing an invoice and collecting a
  payment already did) — no offline local-sequence fallback, because a duplicate serial
  is worse than needing a connection. Drafts (`DRF-`) stay client-side by design.
  Rules (`firestore.rules`, published to `balaji-auto-os-7`): `counters/{sequence}` is
  read/advance for any signed-in user, never-decreasing (`next >= resource.data.next`),
  no client delete. A one-off reset (e.g. after test invoices) is a Console delete of
  the `counters/invoices` doc — it re-seeds from `max(existing) + 1` on the next save.
- **Transactional stock decrement on the billing path.** The inventory "quick sell"
  path already re-reads stock inside a `runTransaction`
  (`components/InventoryDashboard.js`); invoice-driven stock consumption does not yet.
  Wrap that path the same way — see `services/README.md` for where it belongs. This is
  now the only remaining pre-multi-terminal concurrency item.

## Scale — before large datasets

- **Move part images out of Firestore.** Production part photos are stored as base64
  `imageString` inside each `parts` document, so every inventory read pulls the full
  image payload. Upload to Firebase Storage, store the download URL, migrate existing
  docs, keep `imageString` only as a legacy fallback.
- **Table virtualization.** Inventory/sales lists paginate (25/page) but do not
  virtualize; revisit past ~10k rows with `react-window` or TanStack Virtual.
- **Composite indexes.** `firestore.indexes.json` is empty and correct today (all live
  queries are single-field). When a compound `where + orderBy` is introduced, add the
  index Firestore's error links and `firebase deploy --only firestore:indexes`.
- **Server-side search.** In-memory ranking is sub-millisecond at current scale; a
  hosted index (Algolia / Typesense) becomes necessary around ~100k customers.
- **Multi-branch stock.**

## Code health

- **Split `components/InventoryDashboard.js`.** It is the ~8,600-line composition root
  (live subscriptions, tab model, deep-link router, most reads/writes). Add unit tests
  for the pure logic still inline, then extract domain hooks (`useInventory`,
  `useSuppliers`, `useSales`) and per-tab route chunks. Tests must come first.
- **Finish the persistence-adapter migration.** `services/persistenceStore.js` is
  partially adopted; the rest of the shell still calls Firestore directly.
- **Accessibility polish.** A document-level focus trap (`lib/focusTrap.js`) and
  `prefers-reduced-motion` are in place. Remaining: `aria-label` on every icon-only
  button, and verifying tab order, visible focus, and 200% zoom in a real browser.
- **Reduce the demo-photo bundle.** `lib/partPhotos.js` inlines ~201 KB of base64 demo
  photos; move to a cacheable static asset.
- **Types.** TypeScript, or at least JSDoc typedefs on the `services/` boundary.
- **E2E + automated accessibility suite.** The current suite is Node/jsdom (logic and
  wiring only); add browser-level end-to-end and a11y checks.

## Product & compliance

- Credit / debit notes (invoice cancellation works today).
- E-invoicing & IRN (mandatory only above ₹5 crore turnover).
- Backdated-invoice locking after a GST return is filed.
- Granular roles (Manager / Reception / Mechanic) beyond admin / staff / guest.
- Bulk row actions, skeleton loaders, column resize.
- Optional explicit "Remember me" toggle (Firebase LOCAL persistence already keeps
  sessions across refresh/tabs).

---

## Resolved since the 1.0.0 gate

These were open items on the pre-1.0 checklist and are now done:

- Modal focus containment — one document-level trap (`lib/focusTrap.js`) covering every
  overlay; `Modal.js` carries `role="dialog"` / `aria-modal`.
- Duplicate-phone detection on customers (`CustomersModule.jsx` blocks the save and
  offers the existing record).
- Next.js patched to `14.2.35` (off the advisory in `14.2.3`).
