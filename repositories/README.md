# `repositories/` — Data Access Layer

The repository layer abstracts collection names, document shapes, and query construction
behind a small interface, so a caller can depend on intent (“save this invoice”) rather than
storage details. Currently `services/persistenceStore.js` is its only consumer — most
services (`inventoryService.js`, `purchaseOrderService.js`, etc.) and `InventoryDashboard.js`
still call the Firestore SDK directly. Extending repository coverage to those call sites is a
future consolidation, not the current state — see Future extension points.

## Contents

| File | Responsibility |
|------|----------------|
| `firestoreRepository.js` | Generic Firestore read/write/subscribe operations, currently used by `services/persistenceStore.js`. |

## Position in the architecture

```
services/persistenceStore.js  ──►  repositories/  ──►  Firestore SDK (lib/firebase.js)  ──►  Firestore

(other services, and InventoryDashboard.js itself, call firebase/firestore directly today)
```

- `persistenceStore.js` calls the repository to persist and retrieve data.
- The repository uses the initialised `db`/helpers from `lib/firebase.js`.
- Live subscriptions surface snapshot updates that flow back up as props to components.

## Responsibilities

- Centralise collection access and query construction.
- Provide read, write, and real-time subscription primitives.
- Keep Firestore-specific concerns (doc references, converters, batching) out of services
  and components.

## Security model

Client-side code enforces **no** trust boundary — the authoritative access control is the
Firestore security ruleset (`firestore.rules`): signed-in read/create/update, admin-only
deletes, append-only ledgers, and a default-deny catch-all. The repository is written to
operate within those rules; it is not a substitute for them.

## Developer notes & best practices

- Add new collections here, not inline in services/components.
- Keep methods intent-revealing and free of domain logic (that belongs in `services/`).
- Any move toward transactional writes (`runTransaction`, batched counters) is implemented
  at this boundary.

## Future extension points

- A caching/offline-reconciliation layer can be added here without touching callers.
- Per-collection typed repositories could be introduced if the generic interface grows.
