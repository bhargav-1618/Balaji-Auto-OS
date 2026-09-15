/**
 * BILLING SERVICE — the business rules of the transaction engine.
 *
 * ZERO React. ZERO Firestore. ZERO UI. Pure functions over plain objects.
 *
 * Why this matters here specifically: every one of the money bugs in this app came from
 * the same root — the *same question* ("is this invoice actually paid?", "what is the
 * grand total?") being answered by two different pieces of code that disagreed.
 *
 *   - `invTotals` in InventoryDashboard read a STORED `grandTotal`, while BillingModule
 *     computed it from the line items. collectPayment() never refreshed the stored
 *     field, so Billing said "Paid" and the engine said "Pending" — and the engine
 *     silently did nothing. Inventory, Sales, Services, Reports and the Dashboard all
 *     stayed frozen while the invoice displayed as paid.
 *
 * Consolidating these rules in ONE module means there is exactly one definition of
 * "paid" and one definition of "total", and no caller can desynchronise them. It also
 * means they can be unit-tested in Node in milliseconds, with no browser.
 *
 * @typedef {Object} InvoiceLine
 * @property {'Part'|'Labour'|'Other'} kind
 * @property {string|null} partId   present iff kind === 'Part'
 * @property {number} qty
 * @property {number} rate
 * @property {number} [disc]        percent, 0-100
 * @property {number} [gst]         percent
 * @property {number} [purchasePrice]
 * @property {number} [listPrice]
 *
 * @typedef {Object} Invoice
 * @property {string} id
 * @property {string} invNo
 * @property {InvoiceLine[]} lines
 * @property {{amount:number}[]} payments
 * @property {string} status
 * @property {boolean} [isEstimate]
 */

import {
  INVOICE_STATUS, NON_REALIZING_STATUSES, LINE_KIND, REVENUE_CATEGORY,
} from '../constants/index';
import { asArray } from '../lib/format';

/** Coerce to a finite number. Accepts negatives — a refund is a negative delta. */
export const toNum = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Round money to paisa at the boundary — an EPSILON-corrected round-half-up.
 *
 * Binary floating point cannot represent 0.1, so intermediate money values arrive as
 * things like 59.999399999999994. A tax invoice must state tax to 2 decimal places, and
 * summing unrounded values across a month makes a filed GST return disagree with the
 * books by a few paise. Rounding happens HERE, once, at the contract boundary — no
 * caller rounds and no caller receives raw floats.
 *
 * ONE implementation for the whole app: BillingModule.totalsOf and
 * InventoryDashboard.invTotals delegate to invoiceTotals, so this is the only `p2`.
 */
export const p2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

/**
 * Totals for an invoice, DERIVED FROM ITS LINE ITEMS.
 *
 * THE canonical invoice-money implementation (Refactor Phase 5 — Stage 1 spec §7).
 * BillingModule.totalsOf and InventoryDashboard.invTotals both delegate here, so the
 * Billing screen, the invoice PDF, the persisted grandTotal / balance / gstAmount /
 * profitAmount, the transaction engine's realization gate, every Reports / analytics
 * figure and lib/vehicleStats.revenueOf all compute invoice money exactly one way.
 *
 * Contract:
 *   - money fields at 2 dp (paise); `grand` further rounded to the nearest RUPEE
 *     (the "Round Off" line every Indian retail/GST invoice carries).
 *   - line discount (percent) reduces `sub` / `partsRev` / `labourRev`; the
 *     invoice-level discount (flat ₹ or %) produces `afterDisc` and rescales GST by
 *     afterDisc/sub, but does NOT touch the parts/labour split
 *     (invariant: partsRev + labourRev === sub — the split reconciles to the subtotal).
 *   - GST: per-line rate summed then scaled by afterDisc/sub; flat afterDisc·gstPct%
 *     only when NO line carries its own `gst`; 0 when gstMode === 'exempt'.
 *   - CGST/SGST split from the ALREADY-ROUNDED gst (SGST the clean half, CGST absorbs
 *     the odd paisa) so cgst + sgst === gst EXACTLY; IGST carries the whole tax when
 *     gstMode === 'igst'.
 *   - paid = Σ payment-row amounts; else the legacy `iv.paid` scalar ONLY when
 *     iv.legacyPaid === true; else 0 — an unflagged stale/imported `paid` must never
 *     let an invoice self-declare as paid (that was a genuine money bug).
 *   - profit = afterDisc − cost, computed LIVE (never the stored `profitAmount`).
 *   - `grand` falls back to the stored `grandTotal` ONLY for a legacy import with no lines.
 */
export function invoiceTotals(iv) {
  const lines = asArray(iv?.lines); // PH21-D1 — a wrong-type `lines` must not throw (this runs on every screen)

  const netOfLine = (l) => {
    const gross = toNum(l.qty) * toNum(l.rate);
    const lineDisc = l.disc ? gross * (toNum(l.disc) / 100) : 0;
    return Math.max(0, gross - lineDisc);
  };

  let sub = 0;
  let lineGst = 0;
  let cost = 0;
  lines.forEach((l) => {
    const net = netOfLine(l);
    sub += net;
    const rate = l.gst != null ? toNum(l.gst) : toNum(iv?.gstPct);
    lineGst += net * (rate / 100);
    cost += toNum(l.purchasePrice) * toNum(l.qty);
  });

  const invDisc = iv?.discountType === 'percent' ? sub * (toNum(iv?.discount) / 100) : toNum(iv?.discount);
  const afterDisc = Math.max(0, sub - invDisc);
  const anyLineGst = lines.some((l) => l.gst != null);
  let gst = anyLineGst ? lineGst * (afterDisc / (sub || 1)) : afterDisc * (toNum(iv?.gstPct) / 100);
  if (iv?.gstMode === 'exempt') gst = 0;
  const isIgst = iv?.gstMode === 'igst';

  const grandRaw = afterDisc + gst;
  // Fall back to the stored value ONLY for a legacy/imported invoice that carries no lines.
  const grand = lines.length ? Math.round(grandRaw) : toNum(iv?.grandTotal);
  const roundOff = grand - grandRaw;

  const hasPayments = Array.isArray(iv?.payments) && iv.payments.length > 0;
  const legacyPaid = !hasPayments && iv?.legacyPaid === true ? toNum(iv?.paid) : 0;
  const paid = hasPayments ? iv.payments.reduce((s, p) => s + toNum(p.amount), 0) : legacyPaid;

  const balance = Math.max(0, grand - paid);
  const profit = afterDisc - cost;
  const partsRev = lines.filter((l) => l.kind === LINE_KIND.PART).reduce((s, l) => s + netOfLine(l), 0);
  const labourRev = lines.filter((l) => l.kind === LINE_KIND.LABOUR).reduce((s, l) => s + netOfLine(l), 0);

  const gstR = p2(gst);
  const halfS = p2(gstR / 2);           // SGST takes the clean half
  const halfC = p2(gstR - halfS);       // CGST absorbs the odd paisa → cgst + sgst === gst

  return {
    sub: p2(sub),
    afterDisc: p2(afterDisc),
    gst: gstR,
    cgst: isIgst ? 0 : halfC,
    sgst: isIgst ? 0 : halfS,
    igst: isIgst ? gstR : 0,
    isIgst,
    grand,
    roundOff: p2(roundOff),
    paid: p2(paid),
    balance: p2(balance),
    cost: p2(cost),
    profit: p2(profit),
    partsRev: p2(partsRev),
    labourRev: p2(labourRev),
  };
}

/**
 * The invoice's status, DERIVED — never a stale stored field, except the three explicit
 * terminal overrides. Payment data always wins over `iv.status`. Identical rule to
 * BillingModule.deriveStatus and InventoryDashboard.invStatus, which delegate here
 * (Refactor Phase 5).
 */
export function invoiceStatus(iv) {
  if (!iv) return INVOICE_STATUS.PENDING;
  if (NON_REALIZING_STATUSES.includes(iv.status)) return iv.status;
  if (iv.isEstimate) return INVOICE_STATUS.ESTIMATE;
  const t = invoiceTotals(iv);
  // PH11-02 — an OVERPAID invoice's books do not balance: `balance` is floored to 0 by
  // Math.max, which would otherwise read as a clean "Paid" and lock the invoice.
  // Overpayment is an error state, never "Paid"; the excess is surfaced separately as
  // "Overpaid by ₹X". 0.5 slack absorbs rounding.
  if (t.grand > 0 && t.paid > t.grand + 0.5) return INVOICE_STATUS.PARTIALLY_PAID;
  if (t.balance <= 0 && t.grand > 0) return INVOICE_STATUS.PAID;
  if (t.paid > 0) return INVOICE_STATUS.PARTIALLY_PAID;
  return iv.status === INVOICE_STATUS.DRAFT ? INVOICE_STATUS.DRAFT : INVOICE_STATUS.PENDING;
}

/**
 * THE GATE. An invoice is "realized" when money has genuinely been received for it —
 * and ONLY then may it move stock or write to the sales/services ledger.
 *
 * A draft or estimate is never realized; nor is a cancelled/refunded/returned invoice.
 */
export function isRealized(iv) {
  if (!iv || iv.isEstimate) return false;
  if (iv.status === INVOICE_STATUS.DRAFT) return false;
  if (NON_REALIZING_STATUSES.includes(iv.status)) return false;
  return invoiceStatus(iv) === INVOICE_STATUS.PAID;
}

/**
 * THE RECEIVABLE GATE — the symmetric counterpart of isRealized(). An invoice is
 * "outstanding" only when it is a FINALISED bill (never a draft or an estimate),
 * not cancelled/refunded/returned, and still has money owed on it.
 *
 * PH23-D2 — `invTotals(iv).balance` alone is NOT this test: a Draft or an Estimate
 * also has `balance === grand` (no payments), so summing `.balance` over "everything
 * except Cancelled" (as the Billing "Outstanding" KPI and syncCustomerTotals did)
 * counts every open quote and every work-in-progress draft as a real receivable, and
 * a red danger figure claims the shop is owed money nobody has been billed for.
 */
export function isOutstanding(iv) {
  if (!iv || iv.isEstimate) return false;
  const s = invoiceStatus(iv);
  return s === INVOICE_STATUS.PENDING || s === INVOICE_STATUS.PARTIALLY_PAID;
}

/** Which ledger a line belongs to: Sales (parts) or Services (labour). */
export function lineCategory(l) {
  if (l?.partId && l.kind === LINE_KIND.PART) return REVENUE_CATEGORY.PARTS;
  if (l?.kind === LINE_KIND.LABOUR) return REVENUE_CATEGORY.LABOUR;
  if (l?.kind === LINE_KIND.OTHER) return REVENUE_CATEGORY.OUTSIDE_PURCHASE;
  return REVENUE_CATEGORY.SERVICE;
}

/** Quantities of each inventory part on an invoice — {partId: qty}. */
export function partQuantities(iv) {
  const out = {};
  asArray(iv?.lines).forEach((l) => {
    if (l.partId && l.kind === LINE_KIND.PART) out[l.partId] = (out[l.partId] || 0) + toNum(l.qty);
  });
  return out;
}

/** Quantities that have ACTUALLY been consumed — i.e. only if the invoice is paid. */
export const realizedPartQuantities = (iv) => (isRealized(iv) ? partQuantities(iv) : {});

/**
 * The stock delta between two versions of an invoice.
 *
 * Diff-based, so it is IDEMPOTENT: re-saving an unchanged paid invoice yields {} and
 * nothing moves. React is allowed to invoke a state updater more than once, and an
 * "apply once" flag would eventually be got wrong; a diff cannot be.
 *
 * Negative = leaving the shelf. Positive = coming back (refund/cancel).
 */
export function stockDelta(prior, next) {
  const before = realizedPartQuantities(prior);
  const after = realizedPartQuantities(next);
  const delta = {};
  new Set([...Object.keys(before), ...Object.keys(after)]).forEach((id) => {
    const d = (before[id] || 0) - (after[id] || 0);
    if (d !== 0) delta[id] = d;
  });
  return delta;
}

/** Revenue lines keyed by line id — only when realized. */
export function revenueLines(iv) {
  const out = {};
  if (!isRealized(iv)) return out;
  let sub = 0;
  asArray(iv.lines).forEach((l) => {
    const qty = toNum(l.qty);
    const gross = qty * toNum(l.rate);
    const revenue = Math.max(0, gross - gross * (toNum(l.disc) / 100));
    sub += revenue;
    const cost = l.partId ? qty * toNum(l.purchasePrice) : 0;
    out[l.id] = {
      name: l.desc,
      partId: l.partId || null,
      category: lineCategory(l),
      isService: !l.partId,
      qty,
      revenue,
      cost,
      profit: revenue - cost,
      listPrice: toNum(l.listPrice),
      technician: l.technician || '',
    };
  });
  // PHASE 23 (PH23-01) — fold the invoice-level discount into each line's realized
  // revenue with the SAME afterDisc/sub ratio invoiceTotals() uses (and PHASE 11 §
  // documents for GST). Without it, Σ revenueLines().revenue = the PRE-discount
  // subtotal, so the sales ledger / rollups / dashboard analytics overstated revenue
  // and profit by the whole discount on every discounted invoice.
  const invDisc = iv?.discountType === 'percent' ? sub * (toNum(iv?.discount) / 100) : toNum(iv?.discount);
  if (invDisc > 0 && sub > 0) {
    const scale = Math.max(0, sub - invDisc) / sub;
    Object.values(out).forEach((e) => { e.revenue *= scale; e.profit = e.revenue - e.cost; });
  }
  return out;
}

/**
 * The sales/services ledger delta between two invoice versions.
 * Same diff logic as stock: reversible, idempotent, and never double-counts.
 */
export function ledgerDelta(prior, next) {
  const before = revenueLines(prior);
  const after = revenueLines(next);
  const rows = [];
  new Set([...Object.keys(before), ...Object.keys(after)]).forEach((key) => {
    const b = before[key] || { qty: 0, revenue: 0, cost: 0 };
    const a = after[key] || { qty: 0, revenue: 0, cost: 0 };
    const dQty = a.qty - b.qty;
    const dRev = a.revenue - b.revenue;
    const dCost = a.cost - b.cost;
    if (dQty === 0 && Math.abs(dRev) < 0.005) return;   // no change → no row

    const meta = after[key] || before[key];
    const unit = dQty !== 0 ? dRev / dQty : 0;
    rows.push({
      name: meta.name,
      partId: meta.partId,
      category: meta.category,
      isService: meta.isService,
      qty: dQty,
      revenue: dRev,
      cost: dCost,
      profit: dRev - dCost,
      unitPrice: unit,
      listPrice: meta.listPrice,
      // What the workshop charged ABOVE the catalogue price. Surfacing this is the
      // difference between "we sold a part" and "we made ₹100 extra on that part".
      extraRevenue: (meta.partId && meta.listPrice > 0) ? (unit - meta.listPrice) * dQty : 0,
      technician: meta.technician,
    });
  });
  return rows;
}

/** Next document number in a gapless sequence, e.g. INV-0007. */
export function nextDocNumber(existing, prefix) {
  const nums = (existing || [])
    .filter((i) => String(i.invNo || '').startsWith(`${prefix}-`))
    .map((i) => parseInt(String(i.invNo).split('-')[1], 10) || 0);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}-${String(next).padStart(4, '0')}`;
}
