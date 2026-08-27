# `components/` — UI Component Library

The presentation layer of Balaji Auto OS. Every screen the user sees is composed from
components in this directory. Components are organised by business module, with a small set
of shared primitives at the root.

## Architecture

The application uses a **single-page, tabbed shell** rather than per-screen routing. The
root component `InventoryDashboard.js` hosts the navigation shell, the deep-link router,
and mounts each module based on the active tab. Individual modules live in their own
subfolders and are self-contained: each owns its list/detail/form UI, local view state,
and the handlers that persist through the service layer.

```
components/
├── InventoryDashboard.js   App shell: nav, tab routing, deep-link reader, module mounting
├── ErrorBoundary.js        Top-level React error boundary (graceful failure UI)
├── Modal.js                Shared modal primitive
├── common/                 Cross-module primitives (ConfirmDialog, shared inputs)
├── login/                  Authentication screen + boot splash
├── customers/              Customer directory, profile, create/edit
├── vehicles/               Vehicle registry, wizard, insurance/documents/history
├── inventory/              Parts, suppliers, purchase orders, supplier performance
├── billing/               Invoices, payments, action menu, PDF generation
├── jobcards/               Job cards / work orders, workflow, inspection
└── reminders/              System-derived reminders from live data
```

## Responsibilities

- Render module UI and own transient view state (search text, active filters, pagination,
  selection, open dialogs).
- Validate user input at the field level before delegating writes.
- Module subfolders (`customers/`, `vehicles/`, `inventory/`, `billing/`, `jobcards/`,
  `reminders/`) delegate persistence to handler props passed down from
  `InventoryDashboard.js` — they don't hold Firestore subscriptions or call the SDK
  themselves. `InventoryDashboard.js` itself is the exception: as the shell, it *is* where
  the live Firestore subscriptions and most direct reads/writes actually live today (only
  the pure business-logic pieces have been extracted into `services/` so far — see
  `services/README.md`). "Components never touch Firestore" describes the module
  subfolders' contract with the shell, not a claim that the shell itself avoids Firestore.
- Emit cross-module navigation via the deep-link convention (see Data Flow).

## Data flow

```
User interaction
   → component local state (useState / useMemo)
   → parent handler (onPersist / onDelete / …) passed down from InventoryDashboard
   → InventoryDashboard.js — mostly direct Firestore calls today, with the pure business-
     logic pieces (stock math, numbering, workflow decisions) routed through services/
   ← live snapshot subscription updates props  → component re-renders
```

Business data flows **down** as props from the shell (which holds the live Firestore
subscriptions) and changes flow **up** through handler callbacks. This keeps the module
subfolders free of data-access concerns and makes them independently testable — the
composition root (`InventoryDashboard.js`) carries that concern instead.

## Cross-module navigation

Modules navigate to each other through a deep-link convention read by the shell:
`?open=<prefix>:<query>#<tab>` (e.g. `?open=customer:SBBMC12#customers`). The writer opens
the URL; the reader in `InventoryDashboard.js` resolves the prefix to a tab and stores a
handoff key in `localStorage`, which the destination module consumes once on mount. Every
writer prefix has exactly one consumer — the graph is closed and verified by tests.

## View-state persistence

List modules persist their search/filter/sort/tab selections to `sessionStorage` under
dedicated keys (`maruti_<module>_view`) so the view survives tab switches and refreshes.
This is kept strictly separate from **form drafts**, which use token-scoped keys
(`maruti_<entity>_draft_<token>`) to stay isolated across multiple browser tabs.

## Important files

- **`InventoryDashboard.js`** — the shell. Holds live data subscriptions, the tab model,
  the deep-link reader, permission/demo gating, and mounts every module. Large by design
  (it is the composition root); splitting it is a documented post-1.0 refactor.
- **`ErrorBoundary.js`** — wraps the app so a render error shows a recovery UI instead of a
  white screen.
- **`common/ConfirmDialog.jsx`** — promise-based confirmation used app-wide for destructive
  actions.

## Dependencies

- `react`, `react-dom` — UI runtime.
- `lucide-react` — icon set.
- `react-hot-toast` — transient notifications.
- `lib/` — formatting, search ranking, export, PDF/QR, session helpers.
- `services/` — the pure business logic extracted from the shell so far; most of the
  shell's Firestore access itself is still direct (see `services/README.md`).

## Developer notes & best practices

- New pure logic (calculations, workflow decisions, numbering) belongs in `services/`, not
  inline in a module — that's the established, ongoing direction, not yet the full picture.
- Prefer `useMemo` for derived lists and `useDeferredValue`/deferred search for typing
  responsiveness on large datasets.
- Currency, dates, and numbers should format through `lib/format.js` where practical for
  consistency; several existing call sites still inline `toLocaleString` (see `lib/README.md`).
- New exports should call `lib/exportSheet.js`'s `writeSheet`; a few existing ones in
  `InventoryDashboard.js` build their workbook directly with the same lazily-imported `xlsx`
  package instead — all still produce a real `.xlsx`, never a raw CSV blob.
- Every dialog should trap focus on open and restore it on close.

## Future extension points

- New modules follow the existing pattern: a subfolder, a mount branch in the shell, and
  handler props wired to a service.
- The shell can be decomposed into a router + per-tab lazy-loaded chunks to reduce initial
  bundle size without changing module internals.
