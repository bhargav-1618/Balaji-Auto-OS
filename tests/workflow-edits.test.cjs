/**
 * tests/workflow-edits.test.cjs
 *
 * The messy real-world journeys the happy-path day didn't cover:
 *   - a cashier EDITS a bill after part of it is paid
 *   - PARTIAL payment, then completing it
 *   - an attempted OVERPAYMENT (must be caught)
 *   - the owner opening the Vehicles module and reading fleet KPIs
 * All against the real billing + vehicleStats services.
 */
require('./setup.cjs');
const B = require('../services/billingService.js');
const V = require('../lib/vehicleStats.js');

let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const step = (s) => console.log(`\n── ${s} ──`);

console.log('\nMESSY JOURNEYS — edits, partial pay, overpay, vehicle KPIs\n');

const base = () => ({
  invNo: 'INV-0007', status: 'Draft', phone: '9876543210',
  lines: [
    { id: 'l1', kind: 'Part', partId: 'p1', desc: 'Clutch Plate', qty: 1, rate: 4000, disc: 0, gst: 18, purchasePrice: 2600, listPrice: 4000 },
    { id: 'l2', kind: 'Labour', partId: '', desc: 'Fitting', qty: 1, rate: 1200, disc: 0, gst: 0, purchasePrice: 0 },
  ],
  payments: [],
});

// ═══ PARTIAL PAYMENT ═══════════════════════════════════════════════════════
step('Cashier — customer pays half now, half on delivery');
const inv = base();
const total = B.invoiceTotals(inv).grand; // 4000+18%=4720 + 1200 = 5920
ok('bill total = 5920', Math.abs(total - 5920) < 1, `got ${total}`);
const partial = { ...inv, payments: [{ amount: 3000, mode: 'Cash' }] };
const pt = B.invoiceTotals(partial);
ok('after ₹3000, balance is 2920', Math.abs(pt.balance - 2920) < 1, `balance=${pt.balance}`);
ok('a partially-paid invoice is NOT realized (no stock/revenue yet)', !B.isRealized(partial));
ok('status reflects partial, not Paid', B.invoiceStatus(partial) !== 'Paid');

step('Customer returns to settle the balance');
const settled = { ...inv, status: 'Paid', payments: [{ amount: 3000, mode: 'Cash' }, { amount: 2920, mode: 'UPI' }] };
ok('two payments summing to the total → fully paid', B.invoiceStatus(settled) === 'Paid');
ok('now realized', B.isRealized(settled));
ok('multiple payments are summed, not overwritten', B.invoiceTotals(settled).paid === 5920);

// ═══ OVERPAYMENT ═══════════════════════════════════════════════════════════
step('Cashier fat-fingers an overpayment — must be caught');
const over = { ...inv, payments: [{ amount: 9999, mode: 'Cash' }] };
const ot = B.invoiceTotals(over);
// balance is floored at 0 for display (a customer isn't shown a negative "owed"); the
// overpayment is DETECTED via paid > grand, which the save-path guard rejects.
ok('overpayment is detectable: paid (9999) exceeds grand (5920)', ot.paid > ot.grand, `paid=${ot.paid} grand=${ot.grand}`);
ok('displayed balance is floored at 0 (never shows a negative owed)', ot.balance === 0);

// ═══ EDIT AFTER PAYMENT ════════════════════════════════════════════════════
step('Advisor adds a forgotten part to an already-paid bill');
const paid = { ...base(), status: 'Paid', payments: [{ amount: 5920, mode: 'Cash' }] };
const edited = {
  ...paid,
  lines: [...paid.lines, { id: 'l3', kind: 'Part', partId: 'p2', desc: 'Brake Fluid', qty: 1, rate: 500, disc: 0, gst: 18, purchasePrice: 300, listPrice: 500 }],
};
// grand rises to 5920 + 590 = 6510; still only 5920 paid → underpaid → de-realizes
ok('adding a part raises the total to 6510', Math.abs(B.invoiceTotals(edited).grand - 6510) < 1);
ok('the now-underpaid edited invoice de-realizes (cannot consume new stock unpaid)', !B.isRealized(edited));
// top up and it re-realizes, deducting ONLY the new part
const topped = { ...edited, payments: [{ amount: 6510, mode: 'Cash' }] };
ok('after top-up it is realized again', B.isRealized(topped));
const d = B.stockDelta(paid, topped);
ok('editing deducts ONLY the added brake fluid (−1), not the already-billed clutch',
  d.p2 === -1 && d.p1 === undefined, JSON.stringify(d));

// ═══ VEHICLE KPIs (owner's Vehicles tab) ═══════════════════════════════════
step('Owner — open Vehicles; KPIs must reflect only REAL realized invoices');
const vehicles = [
  { id: 'veh1', regNo: 'TS09AA1111', model: 'Swift', ownerPhone: '9876543210' },
  { id: 'veh2', regNo: 'TS09BB2222', model: 'Baleno', ownerPhone: '9000000000' },
];
const invoices = [
  { invNo: 'INV-1', regNo: 'TS09AA1111', status: 'Paid', lines: [{ kind: 'Part', qty: 1, rate: 1000, gst: 0 }], payments: [{ amount: 1000 }] },
  { invNo: 'INV-2', regNo: 'TS09AA1111', status: 'Draft', lines: [{ kind: 'Part', qty: 1, rate: 9999, gst: 0 }], payments: [] }, // must NOT count
  { invNo: 'INV-3', regNo: 'TS09BB2222', status: 'Cancelled', lines: [{ kind: 'Part', qty: 1, rate: 5000, gst: 0 }], payments: [] }, // must NOT count
];
const idx = V.buildVehicleIndex ? V.buildVehicleIndex([], invoices) : null;
if (idx) {
  const inv1 = V.invoicesOf(idx, vehicles[0]);
  const realized1 = inv1.filter((iv) => B.isRealized(iv));
  ok('vehicle 1 shows only its 1 REALIZED invoice (draft excluded)', realized1.length === 1, `got ${realized1.length}`);
  const inv2 = V.invoicesOf(idx, vehicles[1]);
  const realized2 = inv2.filter((iv) => B.isRealized(iv));
  ok('vehicle 2 shows 0 realized (its only invoice was cancelled)', realized2.length === 0, `got ${realized2.length}`);
  const rev1 = realized1.reduce((a, iv) => a + B.invoiceTotals(iv).grand, 0);
  ok('vehicle 1 revenue = 1000 (the 9999 draft did NOT leak in — the ₹71 Cr class of bug)', Math.abs(rev1 - 1000) < 1, `rev=${rev1}`);
} else {
  ok('buildVehicleIndex present', false, 'not exported');
}

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
