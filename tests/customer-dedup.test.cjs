/**
 * tests/customer-dedup.test.cjs — PART-3
 *
 * Duplicate-customer prevention must not be fooled by phone FORMATTING. A workshop that
 * saved "98765 43210" once must be told the number already exists when someone types
 * "9876543210" — otherwise the same customer is created twice and their history splits.
 *
 * This tests the real normalizer (phoneKey) and the dedup predicate it feeds.
 */
require('./setup.cjs');
const { phoneKey } = require('../lib/useSearch');

let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };

console.log('\nPART-3 — customer duplicate detection ignores phone formatting\n');

// the predicate as used in CustomersModule (phoneKey-normalised)
const existing = [
  { id: 'c1', name: 'Ramesh', phone: '98765 43210' },
  { id: 'c2', name: 'Suresh', phone: '+91-98765-11111' },
];
const isDupPhone = (candidate) =>
  candidate.phone && existing.some((c) => c.id !== candidate.id && c.phone && phoneKey(c.phone) === phoneKey(candidate.phone));

ok('spaced vs unspaced same number is a duplicate',
  isDupPhone({ id: 'new', phone: '9876543210' }));
ok('country-code / dashes normalise to a digit-only key',
  phoneKey('+91-98765-11111') === '919876511111');
ok('a genuinely different number is NOT a duplicate',
  !isDupPhone({ id: 'new', phone: '9000000000' }));
ok('editing the SAME customer is not flagged against itself',
  !isDupPhone({ id: 'c1', phone: '98765 43210' }));
ok('phoneKey strips all non-digits', phoneKey('(98765) 43210') === '9876543210');
ok('empty phone is never a duplicate', !isDupPhone({ id: 'new', phone: '' }));

// guard the source: the raw === comparison must not come back
const fs = require('fs');
const src = fs.readFileSync(require('path').resolve(__dirname, '../components/customers/CustomersModule.jsx'), 'utf8');
ok('source uses phoneKey for dup detection, not raw string ===',
  /phoneKey\(c\.phone\) === phoneKey\(f\.phone\)/.test(src),
  'dupPhone must normalise via phoneKey');

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
