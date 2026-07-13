// services/purchaseOrderService.js
// Purchase Order business writes, decoupled from UI/state. The component keeps
// demo (in-memory) handling and toasts; production Firestore writes live here.
import { collection, doc, addDoc, updateDoc, writeBatch, serverTimestamp, increment } from 'firebase/firestore';
import { db } from '../lib/firebase';

const n = (x) => Number(x) || 0;

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
    .map((it) => ({ partId: it.partId, name: it.name || '', sku: it.sku || '', qty: n(it.qty), unitCost: n(it.unitCost), gst: n(it.gst) || 0 }));
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

// Advance pending→approved or approved→received. Receiving increments stock and
// records restocks in one atomic batch.
export function poAdvanceDoc(po, next, userEmail) {
  const tsField = next === 'approved' ? 'approvedAt' : 'receivedAt';
  if (next === 'received') {
    const batch = writeBatch(db);
    batch.update(doc(db, 'purchaseOrders', po.id), { status: 'received', receivedAt: serverTimestamp() });
    (po.items || []).forEach((it) => {
      if (!it.partId) return;
      batch.update(doc(db, 'parts', it.partId), { stock: increment(n(it.qty)), purchasePrice: n(it.unitCost) || 0, lastRestockedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      batch.set(doc(collection(db, 'restocks')), { partId: it.partId, partName: it.name, sku: it.sku, qty: n(it.qty), quantity: n(it.qty), unitCost: n(it.unitCost), total: n(it.qty) * n(it.unitCost), supplierName: po.supplierName, poNumber: po.poNumber, createdAt: serverTimestamp(), byEmail: userEmail || null });
    });
    return batch.commit();
  }
  return updateDoc(doc(db, 'purchaseOrders', po.id), { status: next, [tsField]: serverTimestamp() });
}

export function poCancelDoc(poId) {
  return updateDoc(doc(db, 'purchaseOrders', poId), { status: 'cancelled', cancelledAt: serverTimestamp() });
}
