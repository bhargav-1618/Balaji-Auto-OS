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

/** Coerce to a finite number. Accepts negatives — a refund is a negative delta. */
export const toNum = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Totals for an invoice, DERIVED FROM ITS LINE ITEMS.
 *
 * Never trust a stored `grandTotal`. That single decision is what broke the engine:
 * a stale stored total made `grand === 0`, so the invoice never counted as Paid, so the
 * engine skipped — silently. Deriving means no upstream code path can desynchronise it.
 */
export function invoiceTotals(iv) {
  const lines = iv?.lines || [];
  let sub = 0;
  let gst = 0;
  lines.forEach((l) => {
    const gross = toNum(l.qty) * toNum(l.rate);
    const net = Math.max(0, gross - gross * (toNum(l.disc) / 100));
    sub += net;
    gst += net * (toNum(l.gst) / 100);
  });

  const computed = Math.round(sub + gst);
  // Fall back to the stored value ONLY for legacy/imported invoices that carry no lines.
  const grand = lines.length ? computed : toNum(iv?.grandTotal);

  // Payment ROWS are the sole source of truth for money received.
  const hasPayments = Array.isArray(iv?.payments) && iv.payments.length > 0;
  const paid = hasPayments ? iv.payments.reduce((s, p) => s + toNum(p.amount), 0) : 0;

  return {
    sub: Math.round(sub),
    gst: Math.round(gst),
    grand,
    paid,
    balance: Math.max(0, grand - paid),
    parts: lines.filter((l) => l.kind === LINE_KIND.PART)
      .reduce((s, l) => s + toNum(l.qty) * toNum(l.rate), 0),
    labour: lines.filter((l) => l.kind === LINE_KIND.LABOUR)
      .reduce((s, l) => s + toNum(l.qty) * toNum(l.rate), 0),
  };
}

/** The invoice's status, derived — not read from a field that can go stale. */
export function invoiceStatus(iv) {
  if (!iv) return INVOICE_STATUS.PENDING;
  if (NON_REALIZING_STATUSES.includes(iv.status)) return iv.status;
  if (iv.isEstimate) return INVOICE_STATUS.ESTIMATE;
  const t = invoiceTotals(iv);
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
  (iv?.lines || []).forEach((l) => {
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
  (iv.lines || []).forEach((l) => {
    const qty = toNum(l.qty);
    const gross = qty * toNum(l.rate);
    const revenue = Math.max(0, gross - gross * (toNum(l.disc) / 100));
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
