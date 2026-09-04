// lib/opId.js
//
// OPERATION IDENTITY — Phase 4b (duplicate-action / idempotency hardening).
//
// A retryable business operation (collect a payment, receive a PO line, quick-sell,
// adjust stock, restock, create a PO/supplier) needs a STABLE identity so that a
// duplicate delivery — a double-click, a retry after an ambiguous/failed response,
// a Firestore transaction-callback replay, or a lost server ack — resolves to ONE
// business effect, while a genuinely separate second action gets a NEW identity and
// is allowed through.
//
// LIFECYCLE CONTRACT (the important part):
//   - The client generates ONE opId per logical user intent and reuses it for
//     every retry of that same intent.
//   - It is NOT regenerated because React re-rendered, the handler was called again,
//     the request failed, or the response timed out.
//   - A NEW opId is created only when the user starts a NEW action (a fresh modal,
//     an explicit "add another payment", etc.).
//   - Phase 5b: the id is kept in `sessionStorage` (see `lib/durableOpId.js` /
//     `hooks/useDurableOpId.js`), keyed by workflow + record, so it SURVIVES A
//     BROWSER REFRESH of the tab — a reload + retry recovers the same id and the
//     backend marker de-duplicates. It is gone when the tab CLOSES (the correct
//     lifetime for "a business intent in progress"); that residual is documented
//     in docs/KNOWN_LIMITATIONS.md.
//
// BACKEND CONTRACT: every idempotent operation records its opId atomically, inside
// the same Firestore transaction that applies the business effect — either as the
// natural document id (`sales/{saleOpId}`, `stockAdjustments/{opId}`,
// `restocks/{opId}`), as an element already in an array (`payments[].id`), or in a
// bounded "applied" list on the parent (`purchaseOrders.appliedReceiptIds`). The
// transaction reads that marker BEFORE any write and returns the authoritative
// current state unchanged if the opId is already present.
//
// Timestamp is used only for ordering / collision-resistance, never as the identity
// test — two operations are "the same" iff their opId strings are equal.

const rand = () => Math.random().toString(36).slice(2, 10);

/** A fresh operation id. Call ONCE per logical intent, then reuse across retries. */
export const newOpId = (prefix = 'op') => `${prefix}_${Date.now().toString(36)}_${rand()}${rand().slice(0, 4)}`;

/** How many applied-receipt ids to keep on a PO doc (bounded so the doc can't grow forever). */
export const APPLIED_RECEIPTS_CAP = 60;
