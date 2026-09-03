// services/purchaseOrderService.js
// Purchase Order business writes, decoupled from UI/state. The component keeps
// demo (in-memory) handling and toasts; production Firestore writes live here.
import { collection, doc, addDoc, updateDoc, serverTimestamp, increment, runTransaction } from 'firebase/firestore';
import { db } from '../lib/firebase';
// Pure receive logic (Phase 3b, CWF-02) — kept firebase-free in lib/ so it is
// unit-testable and importable from the security-rules test SDK context.
import { applyPoReceive } from '../lib/poReceive';

const n = (x) => Number(x) || 0;

export { applyPoReceive };

// ---------------------------------------------------------------------------
// H-5D — workflow orchestration extracted from InventoryDashboard.js.
// ---------------------------------------------------------------------------

/**
 * The PO lifecycle's auto-advance step: draft -> pending -> approved -> sent ->
 * received. Pulled verbatim out of InventoryDashboard.js's advancePO — same
 * ladder, single source of truth for "what's next" when no explicit target
 * status is given.
 */
export function nextPOStatus(status) {
  if (status === 'draft') return 'pending';
  if (status === 'pending') return 'approved';
  if (status === 'approved') return 'sent';
  if (status === 'sent' || status === 'partial') return 'received';
  return null;
}

// Next PO number from existing POs (pure).
export function nextPONumber(purchaseOrders = []) {
  const nums = purchaseOrders
    .map((p) => parseInt(String(p.poNumber || '').replace(/\D/g, ''), 10))
    .filter((v) => !Number.isNaN(v));
  return `PO-${(nums.length ? Math.max(...nums) : 10040) + 1}`;
}

// Validate + build the PO payload (pure; no timestamps or side effects).
export function buildPO({ supplierId, supplierName, items, notes, expectedDate, priority, status }, purchaseOrders = []) {
  const clean = (items || [])
    .filter((it) => it.partId && n(it.qty) > 0)
    // Issue 7 (Purchase Order lifecycle review) — receivedQty tracks how much of THIS line
    // has actually arrived so far, separate from qty (what was ordered). Starts at 0; only
    // receivePO() ever increments it. Legacy PO docs written before this field existed are
    // read defensively as 0 everywhere this is consumed (Number(it.receivedQty) || 0).
    .map((it) => ({ partId: it.partId, name: it.name || '', sku: it.sku || '', qty: n(it.qty), unitCost: n(it.unitCost), gst: n(it.gst) || 0, receivedQty: 0 }));
  if (!clean.length) return { error: 'Add at least one line item with a quantity.' };
  const total = clean.reduce((s, it) => s + it.qty * it.unitCost, 0);
  const base = {
    poNumber: nextPONumber(purchaseOrders),
    supplierId: supplierId || null,
    supplierName: supplierName || '—',
    items: clean, total, notes: notes || '', status: status === 'draft' ? 'draft' : 'pending',
    priority: priority || 'Normal',
    expectedDate: expectedDate || null,
  };
  return { base, total, clean };
}

// --- Firestore writes (production) ---
export function poCreateDoc(base, userEmail) {
  return addDoc(collection(db, 'purchaseOrders'), { ...base, createdAt: serverTimestamp(), createdBy: userEmail || null });
}

// Advance draft→pending→approved→sent. Receiving (full or partial) is a
// separate function, poReceiveDoc, below — it needs per-line quantities, not
// just a target status.
export function poAdvanceDoc(po, next, userEmail) {
  const tsField = next === 'approved' ? 'approvedAt' : `${next}At`;
  return updateDoc(doc(db, 'purchaseOrders', po.id), { status: next, [tsField]: serverTimestamp() });
}

/**
 * Issue 7 (Purchase Order lifecycle review) — real partial receiving. `partial` used
 * to be a fully-wired status (filter chip, counts, accepted source state for "Mark
 * received") that no code path ever actually set — dead UI. This is what makes it real.
 *
 * receivedLines: [{ partId, receiveQty, unitCost, updateDefaultPrice }] — receiveQty is
 * the delta being received THIS TIME (never the line's full ordered qty on a second
 * partial receipt); unitCost is the actual cost this batch arrived at (may differ from
 * the PO's quoted unitCost); updateDefaultPrice is only true when the caller has already
 * confirmed the diff with the user (mirrors RestockModal's explicit confirm-before-
 * overwrite pattern — this never silently stomps a part's default price).
 *
 * Phase 3b (CWF-02) — this now runs inside a Firestore `runTransaction` that
 * RE-READS the PO and derives every line's new `receivedQty` from the server's
 * current value, not the caller's (possibly stale) `po`. Two partial receipts
 * landing at once therefore both count. Over-receipt past the ordered quantity is
 * rejected as a whole (`po/over-receipt`) — the transaction aborts, so no stock
 * moves and no restock row is written. Retry-safe: a retried attempt re-reads and
 * its aborted writes (including the auto-id restock docs) never commit, so there
 * are no duplicate restock rows.
 *
 * @returns {Promise<{ status, items }>} the authoritative post-receive PO state
 */
export function poReceiveDoc(po, receivedLines, userEmail) {
  const poRef = doc(db, 'purchaseOrders', po.id);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(poRef);
    if (!snap.exists()) {
      const e = new Error('This purchase order no longer exists. Reload before receiving.');
      e.code = 'po/deleted';
      throw e;
    }
    const server = snap.data();
    const { items: nextItems, status, fullyReceived, over } =
      applyPoReceive(server.items || [], receivedLines, server.status);
    if (over) {
      const e = new Error(
        `Can't receive ${over.delta} of "${over.name}" — only ${Math.max(0, over.ordered - over.already)} ` +
        `left to receive on this order (${over.already} of ${over.ordered} already received).`,
      );
      e.code = 'po/over-receipt';
      throw e;
    }
    const poUpdate = { items: nextItems, status };
    if (fullyReceived) poUpdate.receivedAt = serverTimestamp();
    tx.update(poRef, poUpdate);
    (receivedLines || []).forEach((line) => {
      if (!line.partId || n(line.receiveQty) <= 0) return;
      const partUpdate = { stock: increment(n(line.receiveQty)), lastRestockedAt: serverTimestamp(), updatedAt: serverTimestamp() };
      if (line.updateDefaultPrice) partUpdate.purchasePrice = n(line.unitCost) || 0;
      tx.update(doc(db, 'parts', line.partId), partUpdate);
      const it = (server.items || []).find((x) => x.partId === line.partId) || {};
      tx.set(doc(collection(db, 'restocks')), {
        partId: line.partId, partName: it.name, sku: it.sku,
        qty: n(line.receiveQty), quantity: n(line.receiveQty), unitCost: n(line.unitCost),
        total: n(line.receiveQty) * n(line.unitCost),
        supplier: po.supplierName, supplierId: po.supplierId || null, supplierName: po.supplierName,
        poNumber: po.poNumber, createdAt: serverTimestamp(), byEmail: userEmail || null,
      });
    });
    return { status, items: nextItems };
  });
}

export function poCancelDoc(poId) {
  return updateDoc(doc(db, 'purchaseOrders', poId), { status: 'cancelled', cancelledAt: serverTimestamp() });
}
