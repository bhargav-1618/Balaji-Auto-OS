/**
 * tests/purchase-order-service.test.cjs — Medium finding: test coverage.
 *
 * services/purchaseOrderService.js's nextPOStatus (extracted from
 * InventoryDashboard.js's advancePO during earlier remediation) had no
 * permanent unit test — only a throwaway equivalence check at extraction time.
 */
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'x';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'x';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'x';
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'x';
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = 'x';
process.env.NEXT_PUBLIC_FIREBASE_APP_ID = 'x';
require('./setup.cjs');
const { nextPOStatus } = require('../services/purchaseOrderService.js');

let PASS = 0, FAIL = 0;
const ok = (n, c) => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}`); } };

console.log('\npurchaseOrderService — PO lifecycle auto-advance ladder\n');
ok('draft -> pending', nextPOStatus('draft') === 'pending');
ok('pending -> approved', nextPOStatus('pending') === 'approved');
ok('approved -> sent', nextPOStatus('approved') === 'sent');
ok('sent -> received', nextPOStatus('sent') === 'received');
ok('partial -> received', nextPOStatus('partial') === 'received');
ok('received -> null (terminal state, no auto-advance)', nextPOStatus('received') === null);
ok('cancelled -> null (terminal state)', nextPOStatus('cancelled') === null);
ok('unknown status -> null', nextPOStatus('bogus') === null);
ok('undefined -> null', nextPOStatus(undefined) === null);

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
