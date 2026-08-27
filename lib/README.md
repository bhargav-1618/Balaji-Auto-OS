# `lib/` — Shared Utilities & Integrations

Framework-agnostic helpers and third-party integrations used across the application. Code
here is deliberately free of module-specific business rules — it provides reusable
primitives (formatting, search, exports, Firebase access) that any component or service can
depend on.

## Contents

| File | Purpose |
|------|---------|
| `firebase.js` | Firebase app initialisation; exports `db`, `auth`, and the Firestore/Auth helpers used throughout. All config comes from `NEXT_PUBLIC_FIREBASE_*` env vars. |
| `session.js` | Idle-timeout watcher and business-cache clearing used to expire sessions on shared terminals. |
| `format.js` | Currency (INR), date, and number formatting — the single source of display formatting. |
| `search.js` / `useSearch.js` | Ranked search (`rankMatch`: exact/starts-with/contains) plus `useDeferredSearch` and `matchTokens` for responsive, tokenised filtering. |
| `exportSheet.js` | The one export path: `writeSheet` builds real `.xlsx` files (column widths, typed cells). All module exports funnel through here — no raw CSV. |
| `pdfQr.js` | QR-payload builder and data-URL helper for invoice/job-card PDFs. |
| `focusTrap.js` | Focus-trap helper for accessible modals/dialogs. |
| `vehicleCatalog.js` / `vehicleStats.js` | Make/model reference data and derived vehicle statistics. |
| `partImages.js` / `partPhotos.js` | Part image resolution and base64 photo handling. |
| `demoData.js` / `demoGarageSeed.js` | Deterministic demo dataset for the public sandbox. |
| `indianStates.js` | All 28 states + 8 union territories, for address forms' State field. |

## Data flow & dependencies

`lib/` sits below both components and services. It depends only on the framework, Firebase,
and small third-party libraries (`xlsx`, `jspdf`, `qrcode`). Nothing in `lib/` imports from
`components/` or `services/`, keeping the dependency graph acyclic.

```
components/ ─┐
services/   ─┼─► lib/ ─► (firebase, xlsx, jspdf, qrcode)
repositories/┘
```

## Developer notes & best practices

- **Formatting:** always render money/dates/numbers through `format.js`; never inline
  `toLocaleString` in components.
- **Exports:** prefer calling `writeSheet` for new exports — it's the one place column
  widths/date-cell typing/header-row-count validation are guaranteed. A few existing exports
  in `InventoryDashboard.js` build their workbook directly with the same lazily-imported
  `xlsx` package instead of calling `writeSheet`; all of them still produce a real, typed
  `.xlsx` (never a raw CSV blob) — `tests/export.test.cjs` guards that invariant.
- **Firebase:** treat `firebase.js` as the only place that initialises the SDK. Storage was
  intentionally removed — files are stored as base64 in Firestore.
- **Search:** reuse `useDeferredSearch` for any large-list filter so typing never blocks
  rendering.

## Future extension points

- Server-side, transaction-safe counters (invoice numbering, stock decrement) would live
  behind a helper here once multi-terminal writes are required.
- A thin caching layer for reference data (vehicle catalog) could be added without changing
  callers.
