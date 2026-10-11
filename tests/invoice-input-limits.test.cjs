/**
 * tests/invoice-input-limits.test.cjs
 *
 * QA report VAL-004 — "No upper limit on quantity × rate". Quantity 1,000,000,000 at a rate
 * of ₹1,000,000 produced a grand total of ₹1,180,000,000,000,000 with no warning.
 *
 * The limits live in services/billingService.js (pure, zero React) and are loaded here
 * through the Babel hook — the REAL module. The invoice ARITHMETIC is deliberately not
 * changed by this fix, so the second block pins ordinary results (the same cases the QA
 * suite's INV-01..05 check in the browser) to prove the limits only gate input.
 */
require('./setup.cjs');
const fs = require('fs'), path = require('path');
const {
  INVOICE_LIMITS, fieldLimitError, lineLimitError, totalLimitError, invoiceTotals,
} = require('../services/billingService');

let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const isMsg = (m) => typeof m === 'string' && m.length > 10;

console.log('\nDocumented limits\n');
ok('quantity ≤ 1,00,000', INVOICE_LIMITS.MAX_QTY === 100000);
ok('rate ≤ ₹1,00,00,000 (1 crore)', INVOICE_LIMITS.MAX_RATE === 10000000);
ok('line amount ≤ ₹10,00,00,000 (10 crore)', INVOICE_LIMITS.MAX_LINE_AMOUNT === 100000000);
ok('invoice total ≤ ₹100 crore', INVOICE_LIMITS.MAX_INVOICE_TOTAL === 1000000000);
ok('limits are frozen (cannot be mutated at runtime)', Object.isFrozen(INVOICE_LIMITS));

console.log('\nThe reported case is refused, with a message (not silently clamped)\n');
ok('quantity 1,000,000,000 is refused', isMsg(fieldLimitError('qty', '1000000000', { rate: '1000000' })));
ok('…and the message names the limit the user hit', /Quantity can’t exceed 1,00,000/.test(fieldLimitError('qty', '1000000000', { rate: 1 })));
ok('rate ₹1,000,000,000 is refused', /Rate can’t exceed ₹1,00,00,000/.test(fieldLimitError('rate', '1000000000', { qty: 1 })));
ok('a whole absurd line is refused by the save-time guard', isMsg(lineLimitError({ qty: 1e9, rate: 1e6 })));
ok('refusal returns text — the caller keeps the old value and shows it', typeof fieldLimitError('qty', '999999999', {}) === 'string');

console.log('\nBoundaries are inclusive; one past is refused\n');
ok('qty exactly 1,00,000 is allowed', fieldLimitError('qty', '100000', { rate: '100' }) === null);
ok('qty 1,00,001 is refused', isMsg(fieldLimitError('qty', '100001', { rate: '1' })));
ok('rate exactly ₹1 crore is allowed', fieldLimitError('rate', '10000000', { qty: '1' }) === null);
ok('rate ₹1 crore + 1 is refused', isMsg(fieldLimitError('rate', '10000001', { qty: '1' })));
ok('line amount exactly ₹10 crore (1,00,000 × ₹1,000) is allowed', fieldLimitError('qty', '100000', { rate: '1000' }) === null);
ok('line amount just over ₹10 crore is refused (via qty)', /Line amount/.test(fieldLimitError('qty', '100000', { rate: '1001' })));
ok('line amount just over ₹10 crore is refused (via rate)', /Line amount/.test(fieldLimitError('rate', '1001', { qty: '100000' })));
ok('the cross-check uses the OTHER field’s current value', fieldLimitError('qty', '101', { rate: '1000000' }) !== null && fieldLimitError('qty', '100', { rate: '1000000' }) === null);

console.log('\nLegitimate values are unaffected\n');
ok('fractional quantity 2.5 is allowed', fieldLimitError('qty', '2.5', { rate: '100' }) === null);
ok('fractional hours 0.25 are allowed', fieldLimitError('qty', '0.25', { rate: '400' }) === null);
ok('a typical bill (qty 4, rate ₹2,500) is allowed', fieldLimitError('qty', '4', { rate: '2500' }) === null && fieldLimitError('rate', '2500', { qty: '4' }) === null);
ok('mid-typing states ("", ".", "0.") are not limit errors', ['', '.', '0.', '0'].every((v) => fieldLimitError('qty', v, { rate: '100' }) === null));
ok('a legitimate line passes the save-time guard', lineLimitError({ qty: 2, rate: 500 }) === null && lineLimitError({ qty: '2.5', rate: '100' }) === null);
ok('an empty/new line passes the save-time guard', lineLimitError({}) === null && lineLimitError(null) === null);

console.log('\nOverflow / non-finite values are caught before they reach the arithmetic\n');
const huge = '1' + '0'.repeat(400);                       // Number(huge) === Infinity
ok('a 400-digit quantity is refused (it would overflow to Infinity)', Number(huge) === Infinity && isMsg(fieldLimitError('qty', huge, { rate: 1 })));
ok('a 400-digit rate is refused', isMsg(fieldLimitError('rate', huge, { qty: 1 })));
ok('qty × rate that would overflow is refused', isMsg(lineLimitError({ qty: 1e200, rate: 1e200 })));
ok('non-numeric text is not a limit error (the field’s character filter owns it)', fieldLimitError('qty', 'abc', {}) === null);
ok('total: NaN is refused', isMsg(totalLimitError(NaN)));
ok('total: Infinity is refused', isMsg(totalLimitError(Infinity)));
ok('total: exactly ₹100 crore is allowed, one rupee more is refused', totalLimitError(1000000000) === null && isMsg(totalLimitError(1000000001)));
ok('total: ordinary totals are allowed', totalLimitError(0) === null && totalLimitError(1180) === null && totalLimitError(1062) === null);
ok('the reported ₹1.18 quadrillion total is refused', isMsg(totalLimitError(1.18e15)));

console.log('\nThe arithmetic itself is untouched (same cases as QA INV-01..05)\n');
const line = (qty, rate, disc = 0) => ({ kind: 'Part', qty, rate, disc, gst: 18 });
const t = (qty, rate, disc) => invoiceTotals({ lines: [line(qty, rate, disc)], payments: [] });
ok('INV-01: 2 × 500 @18% -> sub 1000, gst 180, total 1180', t(2, 500).sub === 1000 && t(2, 500).gst === 180 && t(2, 500).grand === 1180);
ok('INV-02: 10% line discount -> sub 900, total 1062', t(2, 500, 10).sub === 900 && t(2, 500, 10).grand === 1062);
ok('INV-03: discount above 100% never goes negative', t(2, 500, 150).grand >= 0 && t(2, 500, 150).sub >= 0);
ok('INV-04: fractional 2.5 × 100 -> 250', t(2.5, 100).sub === 250);
ok('INV-05: balance equals grand total when nothing is paid', t(1, 1000).balance === t(1, 1000).grand);
ok('the largest allowed line still totals finitely', Number.isFinite(t(100000, 1000).grand) && t(100000, 1000).grand === 118000000);

console.log('\nWiring in BillingModule\n');
const bill = fs.readFileSync(path.resolve(__dirname, '../components/billing/BillingModule.jsx'), 'utf8');
ok('imports the limit functions from billingService', /import \{ fieldLimitError, lineLimitError, totalLimitError \} from '\.\.\/\.\.\/services\/billingService';/.test(bill));
ok('quantity input goes through the limit guard', /onChange=\{\(e\) => setLimited\('qty', e\.target\.value\)\}/.test(bill));
ok('rate input goes through the limit guard', /onChange=\{\(e\) => setLimited\('rate', e\.target\.value, \{ approvedBelowFloor: false \}\)\}/.test(bill));
ok('neither input still writes straight into the line', !/setLine\(l\.id, \{ qty: e\.target\.value/.test(bill) && !/setLine\(l\.id, \{ rate: e\.target\.value/.test(bill));
ok('a refused value leaves the field unchanged and shows an alert', /if \(msg\) \{ setLimitMsg\(msg\); return; \}/.test(bill) && /role="alert"[^>]*>\{limitMsg\} The value was not changed\./.test(bill));
ok('save() runs the per-line guard (drafts included)', /const limitErr = lineLimitError\(l\);\s*\n\s*if \(limitErr\) return toast\.error/.test(bill));
ok('save() runs the total guard before the zero-total check', /const totalErr = totalLimitError\(snap0\.grand\);[^\n]*\n\s*if \(totalErr\) return toast\.error\(totalErr\);\s*\n\s*if \(!asEstimate && !asDraft && snap0\.grand <= 0\)/.test(bill));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
