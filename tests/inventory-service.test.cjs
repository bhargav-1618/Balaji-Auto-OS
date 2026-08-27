/**
 * tests/inventory-service.test.cjs — Medium finding: test coverage.
 *
 * services/inventoryService.js's pure H-5A/H-5D exports (nonNegInt, nonNegNum,
 * sanitizeStock, classifyStockLevel, cardReservedQtys, reserveDelta,
 * computeStockAdjustment, buildRestockRecord) were extracted out of
 * InventoryDashboard.js during earlier remediation but never got a permanent
 * unit test of their own — only ad-hoc scratchpad checks at the time. This
 * closes that gap by asserting each function directly against the same
 * hand-derived expected values used to verify the original extraction.
 */
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'x';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'x';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'x';
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'x';
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = 'x';
process.env.NEXT_PUBLIC_FIREBASE_APP_ID = 'x';
require('./setup.cjs');
const {
  nonNegInt, nonNegNum, sanitizeStock, classifyStockLevel,
  cardReservedQtys, reserveDelta, computeStockAdjustment, buildRestockRecord,
} = require('../services/inventoryService.js');

let PASS = 0, FAIL = 0;
const ok = (n, c) => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}`); } };
const sameFields = (a, b, fields) => fields.every((f) => JSON.stringify(a[f]) === JSON.stringify(b[f]));

console.log('\ninventoryService — coercion helpers\n');
ok('nonNegInt(-5) = 0', nonNegInt(-5) === 0);
ok('nonNegInt("12abc") = 12', nonNegInt('12abc') === 12);
ok('nonNegInt(3.9) = 3 (parseInt truncates)', nonNegInt(3.9) === 3);
ok('nonNegNum(-1.5) = 0', nonNegNum(-1.5) === 0);
ok('nonNegNum("2.5kg") = 2.5', nonNegNum('2.5kg') === 2.5);
ok('sanitizeStock(3.9) = 3', sanitizeStock(3.9) === 3);
ok('sanitizeStock(-4) = 0', sanitizeStock(-4) === 0);
ok('sanitizeStock(NaN) = 0', sanitizeStock(NaN) === 0);

console.log('\nclassifyStockLevel — three-way threshold decision\n');
ok('stock=0 -> out', classifyStockLevel({ stock: 0, minStock: 5 }) === 'out');
ok('stock=3 min=5 -> low', classifyStockLevel({ stock: 3, minStock: 5 }) === 'low');
ok('stock=5 min=5 -> low (boundary, <=)', classifyStockLevel({ stock: 5, minStock: 5 }) === 'low');
ok('stock=6 min=5 -> ok', classifyStockLevel({ stock: 6, minStock: 5 }) === 'ok');
ok('stock=10 no minStock -> default threshold 5 -> ok', classifyStockLevel({ stock: 10 }) === 'ok');
ok('stock=undefined -> ok (not coerced to a false "out")', classifyStockLevel({ stock: undefined, minStock: 5 }) === 'ok');

console.log('\ncardReservedQtys — reservation snapshot by status\n');
{
  const card = { status: 'Received', parts: [{ partId: 'p1', qty: 2 }, { partId: 'p2', qty: 3 }, { partId: 'p1', qty: 1 }] };
  ok('active status sums qty per part', JSON.stringify(cardReservedQtys(card)) === JSON.stringify({ p1: 3, p2: 3 }));
  ['Cancelled', 'Closed', 'Delivered'].forEach((status) => {
    ok(`${status} cards hold no reservation`, JSON.stringify(cardReservedQtys({ ...card, status })) === '{}');
  });
  ok('null card -> {}', JSON.stringify(cardReservedQtys(null)) === '{}');
  ok('parts without partId are ignored', JSON.stringify(cardReservedQtys({ status: 'Received', parts: [{ qty: 5 }] })) === '{}');
}

console.log('\nreserveDelta — diff between two card versions\n');
{
  const prior = { status: 'Received', parts: [{ partId: 'p1', qty: 2 }] };
  const next = { status: 'Received', parts: [{ partId: 'p1', qty: 5 }, { partId: 'p2', qty: 1 }] };
  ok('increase + new part', JSON.stringify(reserveDelta(prior, next)) === JSON.stringify({ p1: 3, p2: 1 }));
  ok('release on delete (next=null)', JSON.stringify(reserveDelta(prior, null)) === JSON.stringify({ p1: -2 }));
  ok('unchanged card -> empty delta', JSON.stringify(reserveDelta(prior, prior)) === '{}');
}

console.log('\ncomputeStockAdjustment — reduce vs correction math\n');
[
  { in: { currentStock: 10, qty: 3, direction: 'reduce' }, want: { before: 10, after: 7, delta: 3, signedQty: -3, isCorrection: false } },
  { in: { currentStock: 10, qty: 15, direction: 'reduce' }, want: { before: 10, after: 0, delta: 10, signedQty: -10, isCorrection: false }, note: 'clamped: cannot reduce past 0' },
  { in: { currentStock: 10, qty: 5, direction: 'correction' }, want: { before: 10, after: 15, delta: 5, signedQty: 5, isCorrection: true } },
  { in: { currentStock: 0, qty: 5, direction: 'reduce' }, want: { before: 0, after: 0, delta: 0, signedQty: 0, isCorrection: false } },
].forEach(({ in: input, want, note }) => {
  const got = computeStockAdjustment(input);
  ok(`${JSON.stringify(input)}${note ? ` (${note})` : ''}`, sameFields(got, want, ['before', 'after', 'delta', 'signedQty', 'isCorrection']));
});

console.log('\nbuildRestockRecord — shared restock-entry shape\n');
{
  const a = buildRestockRecord({ id: 'r1', partId: 'p1', name: 'Radiator', sku: 'RAD-1', qty: 4, unitCost: 500, supplierName: 'Lumax', poNumber: 'PO-1', createdAt: 't1' });
  ok('bulk-PO shape: all fields present, poNumber included, no byEmail', a.total === 2000 && a.poNumber === 'PO-1' && !('byEmail' in a));
  ok('name/partName and supplier/supplierName aliases match', a.name === a.partName && a.supplier === a.supplierName);

  const b = buildRestockRecord({ id: 'r2', partId: 'p2', name: 'Brake Pad', qty: 10, unitCost: 300, supplierName: 'Ceat', byEmail: 'demo@x.com', createdAt: 't2' });
  ok('single-part shape: byEmail included, no poNumber', b.total === 3000 && b.byEmail === 'demo@x.com' && !('poNumber' in b));

  const c = buildRestockRecord({ id: 'r3', qty: '5', unitCost: '10' });
  ok('numeric coercion for string qty/unitCost', c.total === 50 && c.qty === 5 && c.unitCost === 10);
}

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
