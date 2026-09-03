// lib/poReceive.js
//
// PURE purchase-order receive logic — Phase 3b (CWF-02). No Firebase, no React,
// so it can be unit-tested directly and imported into the security-rules test
// SDK context (which cannot load lib/firebase). services/purchaseOrderService.js
// re-exports this and wraps it in a Firestore transaction.

const n = (x) => Number(x) || 0;

/**
 * Apply a set of received-line deltas to a PO's line items.
 *
 * `serverItems` MUST be the PO's items as they stand on the server RIGHT NOW
 * (re-read inside a transaction) — never a client snapshot. Each received line's
 * `receiveQty` is the delta arriving THIS time; it is added to the SERVER's
 * current `receivedQty` for that part, so two partial receipts landing at once
 * both count (4 + 3 -> 7, not last-writer-wins 3).
 *
 * Over-receipt is rejected as a whole: if applying every delta would push any
 * line's `receivedQty` past its ordered `qty`, `over` is returned and NOTHING is
 * applied. The transaction caller aborts on `over`, so no stock moves and no
 * restock row is written.
 *
 * @returns {{ items, status, fullyReceived, over: null | {name,ordered,already,delta} }}
 */
function applyPoReceive(serverItems, receivedLines, currentStatus) {
  const items = serverItems || [];
  const lines = receivedLines || [];
  let over = null;
  const nextItems = items.map((it) => {
    const line = lines.find((r) => r.partId === it.partId);
    const delta = line ? n(line.receiveQty) : 0;
    if (delta <= 0) return it;
    const newReceived = n(it.receivedQty) + delta;
    if (!over && newReceived > n(it.qty)) {
      over = { name: it.name || it.partId, ordered: n(it.qty), already: n(it.receivedQty), delta };
    }
    return { ...it, receivedQty: newReceived };
  });
  if (over) return { items, status: currentStatus, fullyReceived: false, over };
  const fullyReceived = nextItems.length > 0 && nextItems.every((it) => n(it.receivedQty) >= n(it.qty));
  const anyReceived = nextItems.some((it) => n(it.receivedQty) > 0);
  const status = fullyReceived ? 'received' : anyReceived ? 'partial' : currentStatus;
  return { items: nextItems, status, fullyReceived, over: null };
}

module.exports = { applyPoReceive };
