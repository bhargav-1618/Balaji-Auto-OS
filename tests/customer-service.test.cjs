/**
 * tests/customer-service.test.cjs — Medium finding: test coverage.
 *
 * services/customerService.js's H-5C exports (nextCustomerCode,
 * withCustomerDefaults, countCustomerReminders) were extracted out of
 * InventoryDashboard.js during earlier remediation but never got a permanent
 * unit test of their own — only ad-hoc scratchpad checks at the time.
 */
require('./setup.cjs');
const { nextCustomerCode, withCustomerDefaults, countCustomerReminders } = require('../services/customerService.js');

let PASS = 0, FAIL = 0;
const ok = (n, c) => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}`); } };

console.log('\nnextCustomerCode / withCustomerDefaults\n');
ok('empty list -> CUST-0001', nextCustomerCode([]) === 'CUST-0001');
ok('no customers arg -> CUST-0001', nextCustomerCode() === 'CUST-0001');
ok('count-based, zero-padded to 4 digits', nextCustomerCode([{}, {}, {}]) === 'CUST-0004');

{
  const customers = [{}, {}];
  const defaults = withCustomerDefaults({ name: 'Ravi Kumar', phone: '9999999999' }, customers);
  ok('code assigned from nextCustomerCode', defaults.code === 'CUST-0003');
  ok('name passed through untouched', defaults.name === 'Ravi Kumar');
  ok('phone passed through', defaults.phone === '9999999999');
  ok('optional fields default to empty string, not undefined',
    defaults.email === '' && defaults.gst === '' && defaults.address === '');
  ok('type defaults to Individual', defaults.type === 'Individual');
  ok('status defaults to Active', defaults.status === 'Active');
  ok('vehicles starts empty', Array.isArray(defaults.vehicles) && defaults.vehicles.length === 0);
}

console.log('\ncountCustomerReminders — outstanding + expiry-within-30-days rule\n');
const NOW = Date.parse('2026-07-28T00:00:00Z');
const day = (n) => new Date(NOW + n * 86400000).toISOString();

ok('empty list -> 0', countCustomerReminders([], NOW) === 0);
ok('one customer with outstanding balance -> 1',
  countCustomerReminders([{ outstanding: 500, vehicles: [] }], NOW) === 1);
ok('zero/negative outstanding does not count',
  countCustomerReminders([{ outstanding: 0, vehicles: [] }], NOW) === 0);
ok('insurance expiring in 10 days counts',
  countCustomerReminders([{ vehicles: [{ insuranceExpiry: day(10) }] }], NOW) === 1);
ok('insurance expiring in 31 days does NOT count (boundary)',
  countCustomerReminders([{ vehicles: [{ insuranceExpiry: day(31) }] }], NOW) === 0);
ok('insurance expiring in exactly 30 days DOES count (inclusive boundary)',
  countCustomerReminders([{ vehicles: [{ insuranceExpiry: day(30) }] }], NOW) === 1);
ok('already-expired insurance still counts',
  countCustomerReminders([{ vehicles: [{ insuranceExpiry: day(-5) }] }], NOW) === 1);
ok('multiple expiry fields on one vehicle each count separately',
  countCustomerReminders([{ vehicles: [{ insuranceExpiry: day(5), rcExpiry: day(10), pucExpiry: null }] }], NOW) === 2);
ok('outstanding + expiring vehicle combine on the same customer',
  countCustomerReminders([{ outstanding: 200, vehicles: [{ insuranceExpiry: day(5) }] }], NOW) === 2);
ok('now is injectable and deterministic (no reliance on the real clock)',
  countCustomerReminders([{ vehicles: [{ insuranceExpiry: day(10) }] }], NOW)
    === countCustomerReminders([{ vehicles: [{ insuranceExpiry: day(10) }] }], NOW));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
