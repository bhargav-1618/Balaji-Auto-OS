/**
 * tests/certification.test.cjs — SPRINT 3
 *
 * The one flow that, if wrong, loses a workshop real money: the reversible cascade.
 * Paying an invoice must reduce stock and post revenue; cancelling must unwind BOTH,
 * exactly, with no residue. Idempotent re-application must not double-count.
 *
 * Executes the REAL services/billingService.js — the shipped engine, not a copy.
 */
require('./setup.cjs');
const E = require('../services/billingService.js');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};

const paidInvoice = (over = {}) => ({
  invNo: 'INV-0001', status: 'Paid',
  lines: [
    { id: 'l1', kind: 'Part', partId: 'p1', desc: 'Brake Pad', qty: 2, rate: 1500, disc: 0, gst: 18, purchasePrice: 900, listPrice: 1500 },
    { id: 'l2', kind: 'Part', partId: 'p2', desc: 'Oil Filter', qty: 1, rate: 400, disc: 0, gst: 18, purchasePrice: 250, listPrice: 400 },
    { id: 'l3', kind: 'Labour', partId: '', desc: 'Servicing', qty: 1, rate: 1000, disc: 0, gst: 0, purchasePrice: 0 },
  ],
  // Payment MUST cover the derived grand total (5012), or the engine correctly treats
  // the invoice as not-fully-paid and nothing cascades. That is the gate working.
  payments: [{ amount: 5012, mode: 'Cash' }],
  ...over,
});
const draft = (iv) => ({ ...iv, status: 'Draft', payments: [] });
const cancelled = (iv) => ({ ...iv, status: 'Cancelled' });

console.log('\nSPRINT 3 — TRANSACTION ENGINE CERTIFICATION (real billingService)\n');

// ── isRealized gate ────────────────────────────────────────────────────────
ok('a Paid invoice is realized', E.isRealized(paidInvoice()));
ok('a Draft is NOT realized', !E.isRealized(draft(paidInvoice())));
ok('a Cancelled invoice is NOT realized', !E.isRealized(cancelled(paidInvoice())));
ok('an Estimate is NOT realized', !E.isRealized({ ...paidInvoice(), isEstimate: true, status: 'Paid' }));

// ── totals derive from line items (never a stored grandTotal) ──────────────
{
  const t = E.invoiceTotals(paidInvoice());
  // parts 2×1500 + 1×400 = 3400; +18% GST = 612; labour 1000 (no gst) → 5012
  ok('totals derive from line items', Math.abs(t.grand - 5012) < 1, `grand = ${t.grand}`);
  // A STALE stored grandTotal must be ignored — this was a real money bug.
  const t2 = E.invoiceTotals({ ...paidInvoice(), grandTotal: 999999 });
  ok('a stale stored grandTotal is IGNORED (derives from lines)',
    Math.abs(t2.grand - 5012) < 1, `grand = ${t2.grand}`);
}

// ── STOCK CASCADE ──────────────────────────────────────────────────────────
// Draft → Paid: stock must DROP by the billed quantities.
{
  const d = E.stockDelta(draft(paidInvoice()), paidInvoice());
  ok('paying reduces stock by billed qty (p1: 2, p2: 1)',
    d.p1 === -2 && d.p2 === -1, JSON.stringify(d));
  ok('labour lines never touch stock', d.l3 === undefined && !('' in d));
}
// Paid → Cancelled: stock must be RESTORED, exactly.
{
  const d = E.stockDelta(paidInvoice(), cancelled(paidInvoice()));
  ok('cancelling restores stock by exactly the billed qty (p1: +2, p2: +1)',
    d.p1 === 2 && d.p2 === 1, JSON.stringify(d));
}
// Round-trip: draft→paid→cancel must net to ZERO stock movement.
{
  const down = E.stockDelta(draft(paidInvoice()), paidInvoice());
  const up = E.stockDelta(paidInvoice(), cancelled(paidInvoice()));
  const net = {};
  [...Object.keys(down), ...Object.keys(up)].forEach((k) => { net[k] = (down[k] || 0) + (up[k] || 0); });
  ok('pay → cancel nets to ZERO stock movement (fully reversible)',
    Object.values(net).every((v) => v === 0), JSON.stringify(net));
}
// IDEMPOTENT: paid→paid must move NOTHING (re-saving a paid invoice can't double-deduct).
{
  const d = E.stockDelta(paidInvoice(), paidInvoice());
  ok('re-saving an unchanged paid invoice moves no stock (idempotent)',
    Object.keys(d).length === 0, JSON.stringify(d));
}
// Editing a quantity on a paid invoice moves only the DIFFERENCE.
{
  // Editing a paid line and TOPPING UP the payment moves only the difference.
  const before = paidInvoice();
  const after = paidInvoice();
  after.lines = after.lines.map((l) => (l.id === 'l1' ? { ...l, qty: 5 } : l));
  // grand rises by 3×1500 +18% = 5310 → new grand 10322; pay it in full
  after.payments = [{ amount: E.invoiceTotals(after).grand, mode: 'Cash' }];
  const d = E.stockDelta(before, after);
  ok('increasing a fully-paid line qty from 2→5 deducts only the extra 3',
    d.p1 === -3, JSON.stringify(d));

  // And the safety property: raising qty WITHOUT paying the extra de-realizes the
  // invoice, so stock is not silently over-consumed.
  const underpaid = paidInvoice();
  underpaid.lines = underpaid.lines.map((l) => (l.id === 'l1' ? { ...l, qty: 5 } : l));
  ok('raising qty without paying the extra de-realizes (cannot over-consume stock)',
    !E.isRealized(underpaid));
}

// ── LEDGER CASCADE ─────────────────────────────────────────────────────────
{
  const rows = E.ledgerDelta(draft(paidInvoice()), paidInvoice());
  const rev = rows.reduce((s, r) => s + r.revenue, 0);
  // revenue lines exclude GST: 3000 + 400 + 1000 = 4400
  ok('paying posts revenue rows (parts + labour, ex-GST = 4400)',
    Math.abs(rev - 4400) < 1, `revenue = ${rev}`);
  ok('the ledger separates parts from services',
    rows.some((r) => !r.isService) && rows.some((r) => r.isService));
  const profit = rows.reduce((s, r) => s + r.profit, 0);
  // cost 2×900 + 1×250 = 2050; profit = 4400 - 2050 = 2350
  ok('profit = revenue − cost (4400 − 2050 = 2350)',
    Math.abs(profit - 2350) < 1, `profit = ${profit}`);
}
{
  const rows = E.ledgerDelta(paidInvoice(), cancelled(paidInvoice()));
  const rev = rows.reduce((s, r) => s + r.revenue, 0);
  ok('cancelling REVERSES the revenue exactly (−4400)',
    Math.abs(rev + 4400) < 1, `revenue = ${rev}`);
}
{
  const rows = E.ledgerDelta(paidInvoice(), paidInvoice());
  ok('re-saving posts no ledger rows (idempotent)', rows.length === 0, `${rows.length} rows`);
}

// ── INVOICE NUMBERING (gapless, GST Rule 46b) ──────────────────────────────
{
  const existing = [{ invNo: 'INV-0001' }, { invNo: 'INV-0002' }, { invNo: 'INV-0003' }];
  ok('next invoice number is gapless', E.nextDocNumber(existing, 'INV') === 'INV-0004');
  ok('estimate series is separate from invoice series',
    E.nextDocNumber(existing, 'EST') === 'EST-0001');
  ok('first invoice in an empty system is INV-0001',
    E.nextDocNumber([], 'INV') === 'INV-0001');
}

// ── EDGE CASES ─────────────────────────────────────────────────────────────
{
  // 100+ line items
  const big = { ...paidInvoice(),
    lines: Array.from({ length: 120 }, (_, i) => ({
      id: `l${i}`, kind: 'Part', partId: `p${i}`, desc: `Part ${i}`, qty: 1, rate: 100, disc: 0, gst: 18, purchasePrice: 60, listPrice: 100 })),
    payments: [{ amount: 14160, mode: 'Cash' }] };
  const d = E.stockDelta(draft(big), big);
  ok('a 120-line invoice cascades every line', Object.keys(d).length === 120);
  const t = E.invoiceTotals(big);
  ok('a 120-line invoice totals correctly (12000 + 18% = 14160)',
    Math.abs(t.grand - 14160) < 1, `grand = ${t.grand}`);
}
{
  // same part on two lines must AGGREGATE, not overwrite
  const iv = { ...paidInvoice(), payments: [{ amount: 500, mode: 'Cash' }], lines: [
    { id: 'a', kind: 'Part', partId: 'p1', desc: 'x', qty: 2, rate: 100, disc: 0, gst: 0, purchasePrice: 50 },
    { id: 'b', kind: 'Part', partId: 'p1', desc: 'x', qty: 3, rate: 100, disc: 0, gst: 0, purchasePrice: 50 },
  ] };
  const d = E.stockDelta(draft(iv), iv);
  ok('the same part on two lines aggregates to one stock delta (−5)',
    d.p1 === -5, JSON.stringify(d));
}
{
  ok('an empty invoice cascades nothing', Object.keys(E.stockDelta({ lines: [] }, { lines: [] })).length === 0);
  ok('totals of an empty invoice are zero', E.invoiceTotals({ lines: [] }).grand === 0);
}

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
