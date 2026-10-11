/**
 * tests/phone-field-wiring.test.cjs
 *
 * QA DATA-001 / VAL-001 / VAL-003 — every mobile-number field must go through the SHARED
 * helpers in lib/format.js (mobileInput to sanitise as you type/paste, isIndianMobile to
 * validate), and none may keep an ad-hoc "strip non-digits and cut to 10" sanitiser, which
 * silently turned a pasted "+91 91234 56781"-style number into a DIFFERENT valid-looking one.
 *
 * The helpers themselves are exercised at runtime in mobile-email-validation.test.cjs and
 * contact-validation.test.cjs; this file guards the WIRING in each module (source assertions,
 * this repo's convention for UI wiring).
 */
require('./setup.cjs');
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { mobileInput, isIndianMobile } = require('../lib/format');

console.log('\nthe shared helpers carry the three fixes (runtime)\n');
ok('DATA-001: a pasted +91 number keeps its real 10 digits', mobileInput('+91 91234 56781') === '9123456781');
ok('DATA-001: an 11-digit paste with a trunk 0 loses only the 0', mobileInput('09123456781') === '9123456781');
ok('DATA-001: an over-long paste is NOT silently cut to a different valid number — it stays invalid', isIndianMobile(mobileInput('912345678199')) === false && isIndianMobile(mobileInput('91234567819')) === false);
ok('VAL-001: numbers starting 0-5 are rejected', ['0123456789', '1234567890', '5123456789'].every((n) => !isIndianMobile(n)));
ok('VAL-003: repeated-digit numbers are rejected', ['9999999999', '8888888888', '7777777777', '6666666666'].every((n) => !isIndianMobile(n)));
ok('a normal mobile still passes (with or without +91)', isIndianMobile('9876543210') && isIndianMobile('+919876543210'));

console.log('\nwiring — no module keeps the old cut-to-10 phone sanitiser\n');
const MODULES = {
  Billing: 'components/billing/BillingModule.jsx',
  Customers: 'components/customers/CustomersModule.jsx',
  Vehicles: 'components/vehicles/VehiclesModule.jsx',
  Reminders: 'components/reminders/RemindersModule.jsx',
  'Job Cards': 'components/jobcards/JobCardModule.jsx',
};
// the exact shapes the audit found: strip non-digits then slice(0, 10) / slice(0, 13) straight into a phone field
const OLD_SANITISERS = [
  /phone: e\.target\.value\.replace\(\/\\D\/g, ''\)\.slice\(0, 10\)/,
  /[aA]ltPhone: e\.target\.value\.replace\(\/\\D\/g, ''\)\.slice\(0, 10\)/,
  /phone: e\.target\.value\.replace\(\/\[\^\\d \]\/g, ''\)\.slice\(0, 13\)/,
  /[aA]ltPhone: e\.target\.value\.replace\(\/\[\^\\d \]\/g, ''\)\.slice\(0, 13\)/,
];
for (const [name, rel] of Object.entries(MODULES)) {
  const src = read(rel);
  ok(`${name}: imports the shared mobile helpers`, /\bmobileInput\b/.test(src) && /\bisIndianMobile\b/.test(src));
  ok(`${name}: no ad-hoc "strip non-digits, cut to 10/13" phone sanitiser is left`, OLD_SANITISERS.every((re) => !re.test(src)), OLD_SANITISERS.filter((re) => re.test(src)).map(String).join(' '));
}
const cust = read(MODULES.Customers), jc = read(MODULES['Job Cards']), bill = read(MODULES.Billing), rem = read(MODULES.Reminders), veh = read(MODULES.Vehicles);
ok('Customers: the phone input sanitises through mobileInput', /onCh\(mobileInput\(e\.target\.value\)\)/.test(cust));
ok('Customers: primary and alternate mobile are both validated', /phoneErr = f\.phone && !isIndianMobile\(f\.phone\)/.test(cust) && /altPhoneErr = f\.altPhone && !isIndianMobile\(f\.altPhone\)/.test(cust));
ok('Job Cards: contact and alternate sanitise through mobileInput (they kept spaces + a 13-char cut before)', (jc.match(/phone: mobileInput\(e\.target\.value\)/g) || []).length === 1 && (jc.match(/altPhone: mobileInput\(e\.target\.value\)/g) || []).length === 1);
ok('Job Cards: both numbers are validated before save', /!isIndianMobile\(card\.phone\)/.test(jc) && /card\.altPhone && !isIndianMobile\(card\.altPhone\)/.test(jc));
ok('Billing: the invoice phone and the inline New Customer phone sanitise through mobileInput', (bill.match(/mobileInput\(e\.target\.value\)/g) || []).length >= 2);
ok('Billing: a real invoice cannot be saved with an invalid phone', /if \(inv\.phone && !isIndianMobile\(inv\.phone\)\) return toast\.error\(MOBILE_ERROR\)/.test(bill));
ok('Reminders: the optional phone sanitises through mobileInput and blocks Add when invalid', /phone: mobileInput\(e\.target\.value\)/.test(rem) && /f\.phone && !isIndianMobile\(f\.phone\)/.test(rem));
ok('Vehicles: the inline "Create New Customer" phone sanitises (it used to let "+", "-" and spaces through) and validates', /sanitizeMobileInput\(e\.target\.value\)/.test(veh) && /!isIndianMobile\(quickCust\.phone\)/.test(veh));
ok('Vehicles: Agent Phone sanitises through mobileInput and validates', /agentPhone: mobileInput\(e\.target\.valu/.test(veh) && /f\.agentPhone && !isIndianMobile\(f\.agentPhone\)/.test(veh));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
