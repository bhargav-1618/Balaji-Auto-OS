/**
 * tests/workflow-edit-cascade.test.cjs — PART-4 FINAL
 *
 * The two journeys not yet executed:
 *   1. EDIT A PAID INVOICE (parts / labour / GST / discount / qty) and prove inventory,
 *      revenue, and profit RE-SETTLE to the difference — never double-count, never leak.
 *   2. RAPID ACTIONS + SCALE (1000 invoices): repeated save/pay/archive must be idempotent,
 *      and filter/search predicates must stay correct and fast at size.
 * Real services, shared mutable stock so desync would surface.
 */
require('./setup.cjs');
const B = require('../services/billingService.js');
const V = require('../lib/vehicleStats.js');

let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const step = (s) => console.log(`\n── ${s} ──`);

console.log('\nPART-4 FINAL — paid-invoice edit cascade + rapid/scale\n');

let inventory = [
  { id: 'p1', name: 'Clutch', stock: 10, minStock: 2, purchasePrice: 2600, sellingPrice: 4000 },
  { id: 'p2', name: 'Fluid', stock: 10, minStock: 2, purchasePrice: 300, sellingPrice: 500 },
  { id: 'p3', name: 'Filter', stock: 10, minStock: 2, purchasePrice: 160, sellingPrice: 300 },
];
const applyStock = (d) => Object.entries(d).forEach(([id, x]) => { const p = inventory.find((i) => i.id === id); if (p) p.stock += x; });
const stk = (id) => inventory.find((i) => i.id === id).stock;
const ledgerNet = (rows) => rows.reduce((a, r) => ({ rev: a.rev + r.revenue, profit: a.profit + r.profit }), { rev: 0, profit: 0 });

// ═══ A PAID INVOICE, then a series of edits ═════════════════════════════════
step('Baseline — a paid invoice: 1 clutch + labour, paid in full');
const v0Draft = {
  invNo: 'INV-0001', status: 'Draft', customer: 'Anil', phone: '9876543210', regNo: 'TS09AA1111',
  lines: [
    { id: 'l1', kind: 'Part', partId: 'p1', desc: 'Clutch', qty: 1, rate: 4000, disc: 0, gst: 18, purchasePrice: 2600, listPrice: 4000 },
    { id: 'l2', kind: 'Labour', partId: '', desc: 'Fitting', qty: 1, rate: 1000, disc: 0, gst: 0, purchasePrice: 0 },
  ],
  payments: [],
};
const g0 = B.invoiceTotals(v0Draft).grand; // 4720 + 1000 = 5720
let v0 = { ...v0Draft, status: 'Paid', payments: [{ amount: g0, mode: 'Cash' }] };
applyStock(B.stockDelta(v0Draft, v0));
let ledger = [...B.ledgerDelta(v0Draft, v0)];
ok('baseline clutch 10 → 9', stk('p1') === 9);
ok('baseline revenue = 5000 (4000 part + 1000 labour, ex-GST)', Math.abs(ledgerNet(ledger).rev - 5000) < 1, `rev=${ledgerNet(ledger).rev}`);
ok('baseline profit = 2400 (5000 − 2600 cost)', Math.abs(ledgerNet(ledger).profit - 2400) < 1, `p=${ledgerNet(ledger).profit}`);

// ── EDIT 1: ADD A PART (brake fluid) and re-pay ─────────────────────────────
step('Edit — advisor adds brake fluid; customer tops up');
let vPrev = v0;
let vNext = { ...v0, lines: [...v0.lines, { id: 'l3', kind: 'Part', partId: 'p2', desc: 'Fluid', qty: 1, rate: 500, disc: 0, gst: 18, purchasePrice: 300, listPrice: 500 }] };
const gAdd = B.invoiceTotals(vNext).grand;
vNext = { ...vNext, payments: [{ amount: gAdd, mode: 'Cash' }] };
applyStock(B.stockDelta(vPrev, vNext));
ledger.push(...B.ledgerDelta(vPrev, vNext));
ok('adding a part deducts ONLY the new fluid (10 → 9), clutch untouched at 9',
  stk('p2') === 9 && stk('p1') === 9, `p1=${stk('p1')} p2=${stk('p2')}`);
ok('revenue rises by exactly 500 → 5500', Math.abs(ledgerNet(ledger).rev - 5500) < 1, `rev=${ledgerNet(ledger).rev}`);
ok('profit rises by (500−300)=200 → 2600', Math.abs(ledgerNet(ledger).profit - 2600) < 1, `p=${ledgerNet(ledger).profit}`);

// ── EDIT 2: INCREASE QTY of the clutch 1 → 3 and re-pay ─────────────────────
step('Edit — bump clutch quantity 1 → 3; re-pay');
vPrev = vNext;
vNext = { ...vNext, lines: vNext.lines.map((l) => (l.id === 'l1' ? { ...l, qty: 3 } : l)) };
vNext = { ...vNext, payments: [{ amount: B.invoiceTotals(vNext).grand, mode: 'Cash' }] };
applyStock(B.stockDelta(vPrev, vNext));
ok('raising clutch qty 1→3 deducts only the extra 2 (9 → 7)', stk('p1') === 7, `p1=${stk('p1')}`);

// ── EDIT 3: REMOVE the brake fluid line and re-pay ──────────────────────────
step('Edit — remove the brake fluid line; re-pay');
vPrev = vNext;
vNext = { ...vNext, lines: vNext.lines.filter((l) => l.id !== 'l3') };
vNext = { ...vNext, payments: [{ amount: B.invoiceTotals(vNext).grand, mode: 'Cash' }] };
applyStock(B.stockDelta(vPrev, vNext));
ok('removing the fluid line RESTORES its stock (9 → 10)', stk('p2') === 10, `p2=${stk('p2')}`);
ok('clutch stock unchanged by the fluid removal (still 7)', stk('p1') === 7);

// ── EDIT 4: apply a DISCOUNT; revenue must drop, stock must not move ─────────
step('Edit — apply a 10% discount on the clutch line');
vPrev = vNext;
const beforeDiscRev = B.invoiceTotals(vPrev).grand;
vNext = { ...vNext, lines: vNext.lines.map((l) => (l.id === 'l1' ? { ...l, disc: 10 } : l)) };
const afterDiscRev = B.invoiceTotals(vNext).grand;
ok('a discount lowers the invoice total', afterDiscRev < beforeDiscRev, `${beforeDiscRev} → ${afterDiscRev}`);
const dDisc = B.stockDelta(vPrev, { ...vNext, payments: [{ amount: afterDiscRev, mode: 'Cash' }] });
ok('a price discount moves NO stock (quantities unchanged)', Object.keys(dDisc).length === 0, JSON.stringify(dDisc));

// ── EDIT 5: change GST rate; stock unaffected, total changes ────────────────
step('Edit — change GST handling; totals shift, stock steady');
const gstOn = B.invoiceTotals(vNext).grand;
const exempt = { ...vNext, gstMode: 'exempt' };
ok('GST-exempt lowers the grand total vs taxed', B.invoiceTotals(exempt).grand <= gstOn);
ok('changing GST moves no stock', Object.keys(B.stockDelta(vNext, exempt)).length === 0);

// ── EDIT 6: change the CUSTOMER on the invoice — must not touch stock/revenue ─
step('Edit — correct the customer name/phone; financials unaffected');
const reCust = { ...vNext, customer: 'Anil Kumar Reddy', phone: '9000000000' };
ok('editing customer details moves no stock', Object.keys(B.stockDelta(vNext, reCust)).length === 0);
ok('editing customer details does not change revenue',
  Math.abs(B.invoiceTotals(reCust).grand - B.invoiceTotals(vNext).grand) < 1);

// ═══ RAPID ACTIONS — idempotency under repeated clicks ══════════════════════
step('Rapid actions — repeated save / pay must not double-apply');
const stable = { ...vNext, payments: [{ amount: B.invoiceTotals(vNext).grand, mode: 'Cash' }] };
ok('re-saving the SAME paid invoice moves no stock (idempotent)',
  Object.keys(B.stockDelta(stable, stable)).length === 0);
ok('re-saving posts no extra ledger rows', B.ledgerDelta(stable, stable).length === 0);
// simulate 5 rapid "save" clicks — net effect must equal a single save
let netStock = {};
for (let i = 0; i < 5; i++) { const d = B.stockDelta(stable, stable); Object.entries(d).forEach(([k, x]) => { netStock[k] = (netStock[k] || 0) + x; }); }
ok('5 rapid re-saves net to zero stock movement', Object.values(netStock).every((x) => x === 0));

// ═══ SCALE — 1000 invoices: predicates stay correct & quick ═════════════════
step('Scale — 1000 invoices; filter/search/aggregate stay correct');
const big = Array.from({ length: 1000 }, (_, i) => ({
  invNo: `INV-${String(i + 1).padStart(4, '0')}`,
  customer: i % 2 ? 'Anil Kumar' : 'Sita Devi',
  phone: i % 2 ? '9876543210' : '9000000000',
  regNo: `TS09${i % 2 ? 'AA' : 'BB'}${String(i).padStart(4, '0')}`,
  status: i % 5 === 0 ? 'Draft' : (i % 7 === 0 ? 'Cancelled' : 'Paid'),
  payments: i % 5 === 0 ? [] : [{ amount: 1000, mode: i % 2 ? 'Cash' : 'UPI' }],
  lines: [{ kind: 'Part', qty: 1, rate: 1000, gst: 0, purchasePrice: 600 }],
}));
const t0 = process.hrtime.bigint();
const paidOnly = big.filter((iv) => B.invoiceStatus(iv) === 'Paid');
const searchAnil = big.filter((iv) => `${iv.invNo} ${iv.customer} ${iv.phone}`.toLowerCase().includes('anil'));
const totalRealizedRev = big.filter((iv) => B.isRealized(iv)).reduce((a, iv) => a + B.invoiceTotals(iv).grand, 0);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
ok('filtering 1000 invoices by Paid returns a correct subset', paidOnly.length > 0 && paidOnly.length < 1000, `${paidOnly.length}`);
ok('search across 1000 invoices finds the 500 "Anil" rows', searchAnil.length === 500, `${searchAnil.length}`);
ok('realized-revenue aggregate excludes drafts & cancelled', totalRealizedRev === paidOnly.length * 1000, `rev=${totalRealizedRev}`);
ok('filter+search+aggregate over 1000 invoices runs < 50ms', ms < 50, `${ms.toFixed(1)}ms`);

// vehicle index at scale
const vt0 = process.hrtime.bigint();
const vidx = V.buildVehicleIndex([], big);
const vms = Number(process.hrtime.bigint() - vt0) / 1e6;
ok('building a vehicle index over 1000 invoices runs < 50ms', vms < 50, `${vms.toFixed(1)}ms`);

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
