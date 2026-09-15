# `services/` — Application / Domain Service Layer

The service layer sits between UI components and the data-access repositories. Services
encapsulate **domain operations and orchestration** — computing analytics, assembling
invoices, applying purchase-order effects — so components stay focused on presentation and
repositories stay focused on persistence.

## Contents

| File | Responsibility |
|------|----------------|
| `billingService.js` | Invoice assembly and billing-side domain operations. |
| `inventoryService.js` | Stock movement orchestration (in/out, reservation effects), category remapping, restock-record shaping. |
| `purchaseOrderService.js` | Purchase-order lifecycle, receiving → stock updates, status auto-advance. |
| `jobCardService.js` | Job-card numbering (`SBBMC##`). |
| `customerService.js` | Customer code generation, quick-create defaults, reminder-count aggregation. |
| `vehicleService.js` | Vehicle lookup/history rollup, quick-create defaults, job-card/invoice draft field mapping. |
| `analyticsService.js` | Derived metrics and aggregations for analytics/reporting. |
| `persistenceStore.js` | Persistence coordination and store helpers. |

## Position in the architecture

```
components/ (UI, view state)
     │  handler callbacks
     ▼
services/  (domain operations, orchestration)   ◄── this folder
     │
     ▼
repositories/ (Firestore reads/writes)
     │
     ▼
Firestore
```

No component imports `repositories/` directly. In practice today, most Firestore reads/
writes/listeners still live inline in `InventoryDashboard.js` itself rather than routed
through a service — the diagram above is the target shape, not a claim that every operation
currently follows it. What *has* been extracted into `services/` (H-5A–H-5D) is the pure,
unit-testable business logic: stock/reservation math, document numbering, workflow
decisions. Extracting the remaining direct Firestore calls is a larger, separate effort.

## Responsibilities

- Encapsulate domain logic that spans more than a single record or collection.
- Coordinate multi-step operations (e.g. receiving a PO increments stock and records the
  movement) so callers get one atomic-feeling entry point.
- Produce derived/aggregate data for analytics and reports without duplicating calculations
  across components.

## Developer notes & best practices

- Keep Firestore specifics (queries, doc shapes) in `repositories/`; services should express
  *what* happens, not *how* it is stored.
- Financial calculations are stable and covered by regression tests — change them only with
  a corresponding test update.
- Prefer pure, testable functions; push side effects to the repository boundary.

## Future extension points

- Transaction-safe counters (invoice numbering, concurrent stock decrement) belong here,
  wrapping a repository `runTransaction`, when multi-terminal writes are introduced.
- Additional domains (payroll, CRM) would each add a service module following this pattern.
