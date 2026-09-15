// services/inventoryService.js
// Inventory business writes decoupled from UI/state. Pure category-mapping
// helpers plus the Firestore batch operations. Demo (in-memory) handling and
// toasts stay in the component; these functions own the persistence.
import { doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { formatINR, tsToDate, asArray } from '../lib/format';
import { normalizeText } from '../lib/search';

// ---------------------------------------------------------------------------
// H-5A — pure inventory business logic extracted from InventoryDashboard.js.
// ZERO React, ZERO Firestore, ZERO DOM. Same reasoning as billingService.js:
// one definition of each rule, unit-testable in Node, no browser required.
// The component still owns all React state/hooks/Firestore writes/toasts —
// these functions only compute values from the inputs they're given.
// ---------------------------------------------------------------------------

// PHASE 21 (PH21-01) — these run at the write boundary (part save, restock,
// adjustment), so a value that is not a real, finite magnitude must NEVER reach
// Firestore. `<input type="number">` accepts a pasted 309-digit string as a valid
// value, but `parseInt`/`parseFloat` of it overflow to `Infinity`, and the old
// `Math.max(0, x || 0)` let that `Infinity` straight through — one `increment()`
// later a part's `stock` is permanently `Infinity`/`NaN` and can't be fixed from
// the UI. Now: reject non-finite outright, and clamp any real-but-absurd magnitude
// (a 1e308 paste) to MAX_SAFE_INTEGER so no downstream `stock * price` sum can
// overflow to `Infinity` either. Same `Number.isFinite` discipline billingService's
// `toNum` already uses for the money path.
const SANE_MAX = Number.MAX_SAFE_INTEGER;
const clampNonNeg = (n) => (Number.isFinite(n) && n > 0 ? Math.min(n, SANE_MAX) : 0);

/** Coerce to a non-negative integer. Guards against NaN, Infinity, floats, negatives, pasted junk. */
export const nonNegInt = (v) => clampNonNeg(parseInt(v, 10));

/** Coerce to a non-negative number (decimals allowed — prices, weights, etc.). */
export const nonNegNum = (v) => clampNonNeg(parseFloat(v));

// Issue 7.4 (Stock Operations review) — ONE definition of "did the price change",
// rounded to the nearest paisa so float noise (e.g. 480.1 - 480.10000000001) never
// reads as a diff. RestockModal and ReceivePOForm each had their own copy of this
// exact comparison (same logic, different rounding phrasing) — consolidated here.
export const pricesDiffer = (a, b) => Math.round((Number(a) || 0) * 100) !== Math.round((Number(b) || 0) * 100);

/** Sanitize a stock value before it reaches state or Firestore: integer, never negative,
 *  never non-finite (see nonNegInt/nonNegNum above for why that matters here). */
export const sanitizeStock = (v) => clampNonNeg(Math.floor(Number(v)));

/**
 * Classify a part's stock level against its reorder threshold.
 * Same three-way decision StatusBadge renders — extracted so the THRESHOLD RULE has one
 * definition, independent of how it's drawn.
 */
export function classifyStockLevel({ stock, minStock } = {}) {
  // Deliberately NOT coerced (no Number()/|| 0 fallback) — mirrors the exact conditions
  // StatusBadge already used, so an undefined/null stock falls through to 'ok' exactly
  // as before rather than silently becoming a new 'out'/'low' case.
  if (stock === 0) return 'out';
  if (stock <= (minStock || 5)) return 'low';
  return 'ok';
}

/** Shop-configurable "fast mover" threshold — owner can override in Settings → Inventory Behavior. */
export const FAST_MOVER_MIN = 10;

// Settings QA fix: was reading the orphaned legacy key maruti_fast_mover_min, which
// nothing has written to since Settings moved to biz.fastMover inside the single
// maruti_settings[_demo] JSON blob — so Settings -> Inventory -> Fast Mover saved
// correctly but never actually changed which parts get the Fast Mover badge. This
// function already reads localStorage directly (a pre-existing exception to this
// file's own "zero DOM" rule, not introduced here); demo/production is read via the
// same sessionStorage flag AuthContext bootstraps itself with, since this pure
// helper has no React props to receive demoMode through.
export function getFastMoverMin() {
  try {
    const key = sessionStorage.getItem('maruti_demo') === '1' ? 'maruti_settings_demo' : 'maruti_settings';
    const v = parseInt(JSON.parse(localStorage.getItem(key) || '{}').fastMover, 10);
    return Number.isFinite(v) && v > 0 ? v : FAST_MOVER_MIN;
  } catch {
    return FAST_MOVER_MIN;
  }
}

/**
 * Single definition of "fast mover" — a part's own `salesCount` against the shop's
 * configured threshold. Extracted so every place that counts fast movers (the Parts
 * table badge, the Categories dashboard cards) agrees; a category card that recomputed
 * this from the raw `sales` array with its own hardcoded threshold used to disagree with
 * the badge a user would actually see once inside that category.
 */
export const isFastMover = (p) => (p?.salesCount || 0) >= getFastMoverMin();

/**
 * A job card's reserved parts, keyed by partId — {partId: qty}.
 * Cancelled/Closed/Delivered cards hold no reservation (parts either returned or billed
 * out). Delta-based like billingService's stockDelta, so re-saves never double-count.
 */
export function cardReservedQtys(card) {
  const map = {};
  if (!card || ['Cancelled', 'Closed', 'Delivered'].includes(card.status)) return map;
  // PH21-01 — nonNegInt (not Number(p.qty) || 0): the job-card parts field accepts a
  // pasted over-long digit string, and this feeds `reserved: increment(delta)`.
  // PH21-D1 — asArray (not `|| []`): a wrong-type `parts` must not throw (this runs on job-card save).
  asArray(card.parts).forEach((p) => { if (p.partId) map[p.partId] = (map[p.partId] || 0) + nonNegInt(p.qty); });
  return map;
}

/**
 * The reservation delta between two versions of a job card (or between a card and
 * deletion, when `next` is null/undefined) — {partId: signedDelta}.
 * Positive = additional stock reserved. Negative = reservation released.
 * Diff-based and idempotent, same discipline as billingService.stockDelta.
 */
export function reserveDelta(prior, next) {
  const before = cardReservedQtys(prior);
  const after = cardReservedQtys(next);
  const delta = {};
  new Set([...Object.keys(before), ...Object.keys(after)]).forEach((id) => {
    const d = (after[id] || 0) - (before[id] || 0);
    if (d !== 0) delta[id] = d;
  });
  return delta;
}

/**
 * The before/after/delta for a manual stock adjustment (damage/loss/correction).
 * `direction: 'correction'` ADDS qty (a positive count-correction); anything else
 * REDUCES stock, clamped so it can never go below zero and never reduce by more than
 * what's actually on the shelf. `signedQty` is what the ledger/audit records
 * (negative = reduction, positive = correction) — same convention handleAdjustStock
 * already used inline.
 */
export function computeStockAdjustment({ currentStock, qty, direction = 'reduce' } = {}) {
  const before = currentStock || 0;
  const isCorrection = direction === 'correction';
  const delta = isCorrection ? nonNegInt(qty) : Math.min(nonNegInt(qty), before);
  const after = isCorrection ? before + delta : Math.max(0, before - delta);
  const signedQty = isCorrection ? delta : -delta;
  return { before, after, delta, signedQty, isCorrection };
}

// ---------------------------------------------------------------------------
// REFACTOR PHASE 9 — shared inventory-analytics helpers, moved VERBATIM out of
// InventoryDashboard.js so the container, MobilePartCard and (later) AnalyticsView
// all resolve ONE definition of each. Pure value-from-input functions; the only
// external reads are the same Settings blob `getFastMoverMin` above already reads
// (via the `maruti_demo` sessionStorage bootstrap flag — no React prop to thread
// demoMode through a module-scope helper), documented on `currentSettingsKey`.
// ---------------------------------------------------------------------------

const DEAD_STOCK_DAYS = 90;      // default; owner can override in Settings
const REORDER_MULTIPLIER = 2;    // default reorder top-up = minStock × this − stock

// Settings QA fix: these used to read standalone legacy keys
// (maruti_dead_stock_days/maruti_reorder_mult) that nothing has written to since
// Settings moved to the single maruti_settings[_demo] JSON blob (biz.deadDays/
// biz.reorderMult) — so Settings -> Inventory's Dead Stock/Reorder Top-up fields
// saved correctly but never actually changed Dead Stock badges or suggested reorder
// quantities. These are module-scope pure helpers (no React props to carry
// demoMode down through every caller), so demo/production is read the same
// lightweight way AuthContext bootstraps it initially — sessionStorage's
// 'maruti_demo' flag — rather than threading a new parameter through every call
// site down multiple layers of other pure helpers. (Same rationale, and the same
// DOM-read exception, as getFastMoverMin above.)
function currentSettingsKey() { try { return sessionStorage.getItem('maruti_demo') === '1' ? 'maruti_settings_demo' : 'maruti_settings'; } catch { return 'maruti_settings'; } }
function currentBizSettings() { try { return JSON.parse(localStorage.getItem(currentSettingsKey()) || '{}'); } catch { return {}; } }
export function getDeadStockDays() { const v = parseInt(currentBizSettings().deadDays, 10); return Number.isFinite(v) && v > 0 ? v : DEAD_STOCK_DAYS; }
export function getReorderMultiplier() { const v = parseFloat(currentBizSettings().reorderMult); return Number.isFinite(v) && v >= 1 ? v : REORDER_MULTIPLIER; }

export const lockedCapital = (p) => (p.purchasePrice || 0) * (p.stock || 0);
export const expectedProfit = (p) => ((p.sellingPrice || 0) - (p.purchasePrice || 0)) * (p.stock || 0);

// Firestore Timestamp → JS Date → age in days (uses lastRestockedAt, else createdAt).
export const ageDays = (p) => { const d = tsToDate(p?.lastRestockedAt) || tsToDate(p?.createdAt); return d ? Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000)) : null; };

// Issue 5: dead stock is about STALENESS, not quantity. A never-sold item that
// has been sitting (since last restock / creation) past the threshold. A fresh
// never-sold item is NOT dead stock yet.
export const isDeadStock = (p) => {
  if ((p.salesCount || 0) !== 0 || (p.stock || 0) <= 0) return false;
  const age = ageDays(p);
  return age != null && age >= getDeadStockDays();
};
export const deadStockReason = (p) => {
  const age = ageDays(p);
  return age != null ? `No sales recorded · unsold for ${age} days (≥ ${getDeadStockDays()}).` : 'No sales recorded.';
};

// Array-safe readers — compatibleCars/categories may be arrays (tree-select) or
// legacy comma strings.
export const asList = (v) => (Array.isArray(v) ? v : v ? String(v).split(',').map((x) => x.trim()).filter(Boolean) : []);
// #3: compatibleCars is stored grouped as [{ brand, models:[...] }]. These read
// it back into a flat model list (also tolerating legacy flat arrays/strings).
export const flattenVehicles = (v) => {
  if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
    return v.flatMap((g) => (Array.isArray(g?.models) ? g.models : []));
  }
  return asList(v);
};
export const compatModels = (p) => flattenVehicles(p?.compatibleCars);
export const compatStr = (p) => compatModels(p).join(' ');
export const categoriesStr = (p) => asList(p.categories).join(' ');
export const partIsUniversal = (p) =>
  normalizeText([p.vehicle, compatStr(p)].join(' ')).includes('universal');

// The vehicle brands a part fits — the grouped [{brand,models}] shape's brands,
// else the single legacy `vehicle` string.
export const brandsOf = (p) => {
  if (Array.isArray(p.compatibleCars) && typeof p.compatibleCars[0] === 'object') {
    return p.compatibleCars.map((g) => g.brand).filter(Boolean);
  }
  return p.vehicle ? [p.vehicle] : [];
};

// ---------------------------------------------------------------------------
// H-5D — workflow orchestration extracted from InventoryDashboard.js.
// ---------------------------------------------------------------------------

/**
 * The shape of a restock ledger entry (demo mode). Pulled out of two
 * near-duplicate inline builders — advancePO's bulk PO-receive branch and
 * handleReceiveStock's single-part branch — so there is one definition of a
 * restock record's fields. Callers resolve their own unitCost fallback chain
 * and id-prefix convention before calling this; `poNumber`/`byEmail` are only
 * included when the caller passes one, matching the two original shapes.
 */
export function buildRestockRecord({ id, partId, name, sku, qty, unitCost, supplierName, supplierId, poNumber, reference, purchaseDate, notes, byEmail, createdAt } = {}) {
  const q = nonNegNum(qty);      // PH21-01 — finite-guarded (feeds stock += q and total = q * cost)
  const cost = nonNegNum(unitCost);
  return {
    id, partId,
    name: name || '', partName: name || '', sku: sku || '',
    qty: q, quantity: q,
    unitCost: cost, total: q * cost,
    supplier: supplierName || '', supplierName: supplierName || '',
    ...(supplierId ? { supplierId } : {}),
    ...(poNumber ? { poNumber } : {}),
    ...(reference ? { reference } : {}),
    ...(purchaseDate ? { purchaseDate } : {}),
    ...(notes ? { notes } : {}),
    ...(byEmail ? { byEmail } : {}),
    createdAt,
  };
}

// A part belongs to `name` if its primary category matches or it appears in the
// categories array.
export const catMatches = (p, name) => p.category === name || (Array.isArray(p.categories) && p.categories.includes(name));

// Produce the field patch to remap a part from oldName → newName across both the
// scalar `category` and the `categories` array (deduped). Pure.
export const remapCatFields = (p, oldName, newName) => {
  const out = {};
  if (p.category === oldName) out.category = newName;
  if (Array.isArray(p.categories) && p.categories.includes(oldName)) {
    const mapped = p.categories.map((c) => (c === oldName ? newName : c));
    out.categories = mapped.filter((c, i, a) => a.indexOf(c) === i);
  }
  return out;
};

// Batch-rename a category across all affected parts (production).
export function renameCategoryDocs(affected, oldName, newName) {
  const batch = writeBatch(db);
  affected.forEach((p) => batch.update(doc(db, 'parts', p.id), { ...remapCatFields(p, oldName, newName), updatedAt: serverTimestamp() }));
  return batch.commit();
}

// Batch-delete a category by reassigning its parts to "Uncategorised" (production).
export function deleteCategoryDocs(affected, name) {
  const batch = writeBatch(db);
  affected.forEach((p) => batch.update(doc(db, 'parts', p.id), { ...remapCatFields(p, name, 'Uncategorised'), updatedAt: serverTimestamp() }));
  return batch.commit();
}

// ---------------------------------------------------------------------------
// Issue 7.7 — ONE definition of "what a stock movement's detail view shows",
// shared by the Inventory Stock tab's timeline and the per-part movement
// history modal (previously two separate, non-clickable timelines with no
// detail view at all). Pure and React-free so both call sites format a
// restock/sale/adjustment record identically. Only renders fields actually
// present on the record — never invents Purchase Order/Invoice/Job Card rows
// for a record type that doesn't carry them.
const mdstr = (ts) => { const d = tsToDate(ts); return d ? d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; };

export function buildMovementDetailSections(type, record, { correctsLabel } = {}) {
  const r = record || {};
  const name = r.name || r.partName || 'Part';
  const sku = r.sku || '';
  const by = r.byEmail || r.by || r.soldByEmail || '';

  if (type === 'in') {
    const qty = r.qty ?? r.quantity ?? 0;
    const txn = [['Type', 'Stock Received'], ['Part', name]];
    if (sku) txn.push(['SKU', sku]);
    txn.push(['Quantity', `+${qty}`]);
    const purchase = [];
    if (r.supplierName || r.supplier) purchase.push(['Supplier', r.supplierName || r.supplier]);
    if (r.poNumber) purchase.push(['Purchase Order', r.poNumber]);
    if (r.reference) purchase.push(['Invoice / Reference', r.reference]);
    if (r.unitCost != null) purchase.push(['Purchase Price', formatINR(r.unitCost)]);
    if (r.unitCost != null && qty) purchase.push(['Total', formatINR((r.unitCost || 0) * qty)]);
    const record_ = [];
    if (by) record_.push(['Received By', by]);
    record_.push(['Date', mdstr(r.purchaseDate || r.createdAt)]);
    if (r.notes) record_.push(['Notes', r.notes]);
    return [{ title: 'Transaction', rows: txn }, ...(purchase.length ? [{ title: 'Purchase', rows: purchase }] : []), { title: 'Record', rows: record_ }];
  }

  if (type === 'out') {
    const qty = r.qty ?? r.quantity ?? 0;
    const txn = [['Type', 'Sale'], ['Part', name]];
    if (sku) txn.push(['SKU', sku]);
    txn.push(['Quantity', `-${qty}`]);
    const sale = [];
    if (r.invoiceNo) sale.push(['Invoice', r.invoiceNo]);
    if (r.customer) sale.push(['Customer', r.customer]);
    if (r.vehicle) sale.push(['Vehicle', r.vehicle]);
    if (r.jobNo || r.jobCard) sale.push(['Related Job Card', r.jobNo || r.jobCard]);
    if (r.price != null || r.unitPrice != null) sale.push(['Unit Price', formatINR(r.price ?? r.unitPrice)]);
    if (r.revenue != null) sale.push(['Revenue', formatINR(r.revenue)]);
    const record_ = [];
    if (by) record_.push(['Sold By', by]);
    record_.push(['Date', mdstr(r.soldAt || r.createdAt)]);
    return [{ title: 'Transaction', rows: txn }, ...(sale.length ? [{ title: 'Sale', rows: sale }] : []), { title: 'Record', rows: record_ }];
  }

  // 'adjust' — stockAdjustments record
  const signed = r.qty ?? r.quantity ?? 0;
  const isCorrection = signed > 0;
  const txn = [['Type', isCorrection ? 'Correction' : (r.reason || 'Adjustment')], ['Part', name]];
  if (sku) txn.push(['SKU', sku]);
  txn.push(['Quantity', `${signed > 0 ? '+' : ''}${signed}`]);
  const adj = [];
  if (!isCorrection && r.reason) adj.push(['Reason', r.reason]);
  if (r.stockBefore != null && r.stockAfter != null) adj.push(['Stock Before → After', `${r.stockBefore} → ${r.stockAfter}`]);
  if (r.correctsId && correctsLabel) adj.push(['Corrects', correctsLabel]);
  const record_ = [];
  if (by) record_.push(['Recorded By', by]);
  record_.push(['Date', mdstr(r.createdAt)]);
  if (r.notes) record_.push(['Notes', r.notes]);
  return [{ title: 'Transaction', rows: txn }, ...(adj.length ? [{ title: 'Adjustment', rows: adj }] : []), { title: 'Record', rows: record_ }];
}
