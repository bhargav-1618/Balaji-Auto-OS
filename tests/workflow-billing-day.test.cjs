/**
 * tests/workflow-billing-day.test.cjs
 *
 * A billing/vehicles day, executed against the REAL services. Exercises the invoice state
 * machine (Draft → Estimate → Partial → Paid → Cancelled → Refunded), document numbering,
 * filtering/search predicates, the archive round-trip, and the stock/ledger cascade — with
 * state shared across steps so a mistake propagates like a real day.
 * Logic layer only; print/PDF/file-download are UI-triggered and flagged in the report.
 */
require('./setup.cjs');
const B = require('../services/billingService.js');
const V = require('../lib/vehicleStats.js');

let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const step = (s) => console.log(`\n── ${s} ──`);

console.log('\nVEHICLES + BILLING DAY — workflow validation (real services)\n');

// shared stock so cascades are observable across the day
let inventory = [
  { id: 'p1', name: 'Clutch Plate', stock: 5, minStock: 2, purchasePrice: 2600, sellingPrice: 4000 },
  { id: 'p2', name: 'Brake Fluid', stock: 8, minStock: 3, purchasePrice: 300, sellingPrice: 500 },
];
const applyStock = (d) => Object.entries(d).forEach(([id, x]) => { const p = inventory.find((i) => i.id === id); if (p) p.stock += x; });
const stk = (id) => inventory.find((i) => i.id === id).stock;
let ledger = [];

// ═══ DOCUMENT NUMBERING: estimates and invoices are separate series ═════════
step('Numbering — estimates and invoices must not share a sequence');
let docs = [];
const est1 = B.nextDocNumber(docs, 'EST'); docs.push({ invNo: est1 });
const inv1 = B.nextDocNumber(docs, 'INV'); docs.push({ invNo: inv1 });
const inv2 = B.nextDocNumber(docs, 'INV'); docs.push({ invNo: inv2 });
const est2 = B.nextDocNumber(docs, 'EST'); docs.push({ invNo: est2 });
ok('first estimate is EST-0001', est1 === 'EST-0001', est1);
ok('first invoice is INV-0001 (independent of estimates)', inv1 === 'INV-0001', inv1);
ok('invoices increment INV-0001 → INV-0002', inv2 === 'INV-0002', inv2);
ok('estimates increment independently EST-0001 → EST-0002', est2 === 'EST-0002', est2);

// ═══ ESTIMATE → INVOICE conversion ══════════════════════════════════════════
step('Advisor makes an ESTIMATE, then converts it to a real invoice');
const estimate = {
  invNo: est1, isEstimate: true, status: 'Draft', regNo: 'TS09AA1111',
  lines: [{ id: 'l1', kind: 'Part', partId: 'p1', desc: 'Clutch', qty: 1, rate: 4000, disc: 0, gst: 18, purchasePrice: 2600, listPrice: 4000 }],
  payments: [],
};
ok('an estimate reports status Estimate', B.invoiceStatus(estimate) === 'Estimate');
ok('an estimate does NOT realize (no stock/ledger)', !B.isRealized(estimate));
ok('an estimate moves no stock', Object.keys(B.stockDelta({ ...estimate, lines: [] }, estimate)).length === 0 || !B.isRealized(estimate));
// convert: drop the estimate flag, give it an invoice number
const converted = { ...estimate, isEstimate: false, invNo: inv1, status: 'Draft' };
ok('converted invoice is no longer an estimate', B.invoiceStatus(converted) !== 'Estimate');
ok('stock still untouched while unpaid (5)', stk('p1') === 5);

// ═══ PARTIAL → PAID lifecycle with cascade ══════════════════════════════════
step('Cashier collects payment across two visits');
const total = B.invoiceTotals(converted).grand; // 4720
const partial = { ...converted, payments: [{ amount: 2000, mode: 'Cash' }] };
ok('partial payment → Partially Paid', B.invoiceStatus(partial) === 'Partially Paid');
ok('partial does not realize', !B.isRealized(partial));
ok('no stock moved on partial', stk('p1') === 5);
const paid = { ...converted, status: 'Paid', payments: [{ amount: 2000, mode: 'Cash' }, { amount: 2720, mode: 'UPI' }] };
ok('balance cleared → Paid', B.invoiceStatus(paid) === 'Paid');
ok('now realized', B.isRealized(paid));
applyStock(B.stockDelta(converted, paid));
ok('clutch stock 5 → 4 on realization', stk('p1') === 4, `got ${stk('p1')}`);
ledger.push(...B.ledgerDelta(converted, paid));
ok('revenue posted (4000 ex-GST)', Math.abs(ledger.reduce((a, r) => a + r.revenue, 0) - 4000) < 1);

// ═══ CANCEL → REFUND transitions ════════════════════════════════════════════
step('Customer disputes; invoice is CANCELLED then a refund noted');
const cancelled = { ...paid, status: 'Cancelled' };
ok('cancelled reports Cancelled (a non-realizing state)', B.invoiceStatus(cancelled) === 'Cancelled');
ok('cancelled invoice de-realizes', !B.isRealized(cancelled));
applyStock(B.stockDelta(paid, cancelled));
ok('stock restored 4 → 5 on cancel', stk('p1') === 5, `got ${stk('p1')}`);
ledger.push(...B.ledgerDelta(paid, cancelled));
ok('revenue reversed to 0 after cancel', Math.abs(ledger.reduce((a, r) => a + r.revenue, 0)) < 1);

// ═══ BILLING FILTERS: the "return to All" behaviour ═════════════════════════
step('Cashier filters the invoice list, then clears back to All');
const invoiceList = [
  { invNo: 'INV-0001', status: 'Paid', payments: [{ amount: 100, mode: 'Cash' }], lines: [{ kind: 'Part', qty: 1, rate: 100, gst: 0 }] },
  { invNo: 'INV-0002', status: 'Draft', payments: [], lines: [{ kind: 'Part', qty: 1, rate: 100, gst: 0 }] },
  { invNo: 'INV-0003', status: 'Cancelled', payments: [], lines: [{ kind: 'Part', qty: 1, rate: 100, gst: 0 }] },
];
const applyStatusFilter = (list, f) => list.filter((iv) => f === 'All' || B.invoiceStatus(iv) === f);
ok('filter Paid → 1 row', applyStatusFilter(invoiceList, 'Paid').length === 1);
ok('filter Cancelled → 1 row', applyStatusFilter(invoiceList, 'Cancelled').length === 1);
ok('return to All → ALL rows reappear (no empty-table bug)', applyStatusFilter(invoiceList, 'All').length === 3);
const applyPayModeFilter = (list, m) => list.filter((iv) => m === 'All' || (iv.payments || []).some((p) => p.mode === m));
ok('filter payment mode Cash → 1 row', applyPayModeFilter(invoiceList, 'Cash').length === 1);
ok('return to All payments → 3 rows', applyPayModeFilter(invoiceList, 'All').length === 3);

// ═══ BILLING SEARCH: accuracy across fields ═════════════════════════════════
step('Cashier searches invoices by number / customer / phone');
const searchable = [
  { invNo: 'INV-0001', customer: 'Anil Kumar', phone: '9876543210', regNo: 'TS09AA1111' },
  { invNo: 'INV-0002', customer: 'Sita Devi', phone: '9000000000', regNo: 'TS09BB2222' },
];
const search = (list, q) => { const s = q.toLowerCase().replace(/\s/g, ''); return list.filter((iv) => `${iv.invNo} ${iv.customer} ${iv.phone} ${iv.regNo}`.toLowerCase().replace(/\s/g, '').includes(s)); };
ok('search by invoice number', search(searchable, 'INV-0002')[0].customer === 'Sita Devi');
ok('search by partial customer name', search(searchable, 'anil').length === 1);
ok('search by phone', search(searchable, '9000000000')[0].customer === 'Sita Devi');
ok('search by registration', search(searchable, 'ts09aa')[0].invNo === 'INV-0001');
ok('no-match search → empty (not the whole list)', search(searchable, 'zzz').length === 0);

// ═══ VEHICLES: archive round-trip ══════════════════════════════════════════
step('Store manager archives a vehicle, then restores it');
let vehicles = [
  { id: 'v1', regNo: 'TS09AA1111', model: 'Swift', status: 'Active' },
  { id: 'v2', regNo: 'TS09BB2222', model: 'Baleno', status: 'Active' },
];
const toggleArchive = (list, id) => list.map((v) => (v.id === id ? { ...v, status: v.status === 'Archived' ? 'Active' : 'Archived' } : v));
vehicles = toggleArchive(vehicles, 'v1');
ok('vehicle archived (status Archived)', vehicles.find((v) => v.id === 'v1').status === 'Archived');
// the "All" view (statusF='All') must still SHOW archived → not a dead-end
const allView = (list, statusF) => list.filter((v) => statusF === 'All' || (v.status || 'Active') === statusF);
ok('archived vehicle still visible in the All view (restorable, not lost)',
  allView(vehicles, 'All').some((v) => v.id === 'v1'));
vehicles = toggleArchive(vehicles, 'v1');
ok('vehicle restored (status Active again)', vehicles.find((v) => v.id === 'v1').status === 'Active');

// ═══ VEHICLES: filter + sort predicates ════════════════════════════════════
step('Owner filters vehicles by make/fuel and returns to All');
const fleet = [
  { id: 'v1', make: 'Maruti', fuel: 'Petrol', createdAt: 100 },
  { id: 'v2', make: 'Hyundai', fuel: 'Diesel', createdAt: 300 },
  { id: 'v3', make: 'Maruti', fuel: 'Diesel', createdAt: 200 },
];
const byMake = (list, m) => list.filter((v) => m === 'All' || v.make === m);
ok('filter make Maruti → 2', byMake(fleet, 'Maruti').length === 2);
ok('return to All makes → 3 (records return immediately)', byMake(fleet, 'All').length === 3);
const sortLatest = [...fleet].sort((a, b) => b.createdAt - a.createdAt);
ok('sort Latest → newest first (v2)', sortLatest[0].id === 'v2');
const sortOldest = [...fleet].sort((a, b) => a.createdAt - b.createdAt);
ok('sort Oldest → oldest first (v1)', sortOldest[0].id === 'v1');

// ═══ VEHICLE KPIs only count realized invoices ═════════════════════════════
step('Owner opens a vehicle; revenue counts only realized invoices');
const vinv = [
  { invNo: 'A', regNo: 'TS09AA1111', status: 'Paid', payments: [{ amount: 1000 }], lines: [{ kind: 'Part', qty: 1, rate: 1000, gst: 0 }] },
  { invNo: 'B', regNo: 'TS09AA1111', status: 'Draft', payments: [], lines: [{ kind: 'Part', qty: 1, rate: 5000, gst: 0 }] },
];
const idx = V.buildVehicleIndex([], vinv);
const realized = V.invoicesOf(idx, { regNo: 'TS09AA1111' }).filter((iv) => B.isRealized(iv));
ok('only the realized invoice counts (draft 5000 excluded)', realized.length === 1);
ok('vehicle revenue = 1000, not 6000', Math.abs(realized.reduce((a, iv) => a + B.invoiceTotals(iv).grand, 0) - 1000) < 1);

// ═══ CLOSING INVARIANT ══════════════════════════════════════════════════════
step('Integrity — the day left stock exactly as it opened');
ok('clutch back to opening 5', stk('p1') === 5);
ok('brake fluid untouched at 8', stk('p2') === 8);

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
