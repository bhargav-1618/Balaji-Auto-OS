// services/purchaseOrderService.js
// Purchase Order business writes, decoupled from UI/state. The component keeps
// demo (in-memory) handling and toasts; production Firestore writes live here.
import { collection, doc, addDoc, updateDoc, writeBatch, serverTimestamp, increment } from 'firebase/firestore';
import { db } from '../lib/firebase';

const n = (x) => Number(x) || 0;

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
 * Firestore has no per-array-element increment, so the PO's own `items` array is
 * rewritten whole with each line's receivedQty bumped by its delta. Status is derived
 * AFTER applying every delta: every line fully received -> 'received'; at least one
 * line partially received -> 'partial'; otherwise unchanged.
 */
export function poReceiveDoc(po, receivedLines, userEmail) {
  const batch = writeBatch(db);
  const items = po.items || [];
  const nextItems = items.map((it) => {
    const line = receivedLines.find((r) => r.partId === it.partId);
    const delta = line ? n(line.receiveQty) : 0;
    return delta > 0 ? { ...it, receivedQty: n(it.receivedQty) + delta } : it;
  });
  const fullyReceived = nextItems.length > 0 && nextItems.every((it) => n(it.receivedQty) >= n(it.qty));
  const anyReceived = nextItems.some((it) => n(it.receivedQty) > 0);
  const status = fullyReceived ? 'received' : anyReceived ? 'partial' : po.status;
  const poUpdate = { items: nextItems, status };
  if (fullyReceived) poUpdate.receivedAt = serverTimestamp();
  batch.update(doc(db, 'purchaseOrders', po.id), poUpdate);
  receivedLines.forEach((line) => {
    if (!line.partId || n(line.receiveQty) <= 0) return;
    const partUpdate = { stock: increment(n(line.receiveQty)), lastRestockedAt: serverTimestamp(), updatedAt: serverTimestamp() };
    if (line.updateDefaultPrice) partUpdate.purchasePrice = n(line.unitCost) || 0;
    batch.update(doc(db, 'parts', line.partId), partUpdate);
    const it = items.find((x) => x.partId === line.partId) || {};
    batch.set(doc(collection(db, 'restocks')), {
      partId: line.partId, partName: it.name, sku: it.sku,
      qty: n(line.receiveQty), quantity: n(line.receiveQty), unitCost: n(line.unitCost),
      total: n(line.receiveQty) * n(line.unitCost),
      // Issue 6 backfill: PO-driven restocks never stamped supplierId, only the name —
      // the same string-matching fragility fixed in SupplierDirectory.jsx's Transactions tab.
      // Issue 8: also missing the singular `supplier` alias that buildRestockRecord and
      // RestockModal's own write both include — the dashboard's "Restock Spend by Supplier"
      // aggregation groups by THAT field, so every PO-receipt restock bucketed under
      // "Unknown" there without it.
      supplier: po.supplierName, supplierId: po.supplierId || null, supplierName: po.supplierName,
      poNumber: po.poNumber, createdAt: serverTimestamp(), byEmail: userEmail || null,
    });
  });
  return batch.commit();
}

export function poCancelDoc(poId) {
  return updateDoc(doc(db, 'purchaseOrders', poId), { status: 'cancelled', cancelledAt: serverTimestamp() });
}
