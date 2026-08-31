/**
 * tests/contact-validation.test.cjs
 *
 * "fix: tighten Indian contact validation" regression.
 *
 * ON THE DEPLOYED APP (reproduced): Add New Customer accepted phone "1234567890"
 * (10 digits but not an Indian mobile — starts 1) and email "test@example.com"
 * (a reserved placeholder domain) and SAVED the record — the wizard used a loose
 * `/^\d{10}$/` phone check and a loose `/^\S+@\S+\.\S+$/` email check, and the
 * same weak checks were copy-pasted into Job Cards and the Billing walk-in form.
 *
 * FIX: one canonical rule each in lib/format.js —
 *   isIndianMobile — EXACTLY 10 digits after stripping an optional +91/91, start 6-9.
 *   isValidEmail   — strict syntax + reject only RFC 2606/6761 reserved placeholder
 *                    names (example.com/.net/.org, .test/.invalid/.localhost/.example).
 *                    NO domain whitelist; every other real address stays valid.
 * — used by the Customer wizard, Job Cards, Billing walk-in, Vehicles quick-create,
 * and the shared quick-create boundary handlers (so no save path can bypass it).
 */
require('./setup.cjs');
const fs = require('fs');
const path = require('path');
const { isIndianMobile, isValidEmail, mobileInput, MOBILE_ERROR, EMAIL_ERROR } = require('../lib/format.js');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');

console.log('\ncontact validation — Indian mobile + real email\n');

// ── PHONE: valid Indian mobiles ────────────────────────────────────────────
for (const n of ['9876543210', '8765432109', '7654321098', '6543210987']) {
  ok(`valid mobile accepted: ${n}`, isIndianMobile(n) === true);
}
// supported country-code input forms (the +91 UI prefix / paste) must NOT be rejected
for (const n of ['+919876543210', '91 9876543210', '+91 9876543210', '  9876543210 ']) {
  ok(`country-code / spaced form accepted: "${n}"`, isIndianMobile(n) === true);
}

// ── PHONE: invalid — must all be rejected ──────────────────────────────────
for (const n of ['123', '1234567890', '5234567890', '0123456789', '987654321',
  '98765432101', 'abcdefghij', '+911234567890', '0000000000', '', null, undefined, '99999x9999']) {
  ok(`invalid mobile rejected: ${JSON.stringify(n)}`, isIndianMobile(n) === false);
}

// ── mobileInput normalization (what the field stores as you type/paste) ────
ok('mobileInput strips +91 and caps at 10', mobileInput('+91 9876543210') === '9876543210');
ok('mobileInput leaves a plain 10-digit number untouched', mobileInput('9876543210') === '9876543210');
ok('mobileInput drops the country code from a 12-digit paste', mobileInput('919876543210') === '9876543210');
ok('mobileInput truncates over-long input to 10', mobileInput('98765432109999') === '9876543210');

// ── EMAIL: valid real addresses (no whitelist — arbitrary domains allowed) ─
for (const e of ['customer@gmail.com', 'john.doe@gmail.com', 'name+service@gmail.com',
  'customer@company.in', 'a.b.c@sub.domain.co.uk', 'ok@example.io']) {
  ok(`valid email accepted: ${e}`, isValidEmail(e) === true);
}

// ── EMAIL: invalid — malformed OR reserved placeholder ────────────────────
for (const e of ['test@example.com', 'example@example.com', 'user@example.com',
  'test@', '@example.com', 'test', 'test@ ', 'test @gmail.com', 'test@@gmail.com',
  'test..name@gmail.com', 'test@gmail', '@gamil.com', '.lead@gmail.com', 'trail.@gmail.com',
  'x@localhost', 'x@foo.test', 'x@foo.invalid', '', null]) {
  ok(`invalid/placeholder email rejected: ${JSON.stringify(e)}`, isValidEmail(e) === false);
}
// the rule is domain-name-based, NOT an arbitrary blocklist: a real .io/.in domain
// that merely CONTAINS "example" as a label of a real TLD is only blocked for the
// reserved example.com/.net/.org zones — example.io stays valid (asserted above).

// ── error copy exists and is descriptive ─────────────────────────────────
ok('MOBILE_ERROR mentions the 6–9 rule', /6.?9/.test(MOBILE_ERROR));
ok('EMAIL_ERROR names the placeholder problem, not a whitelist', /placeholder|example/i.test(EMAIL_ERROR) && !/whitelist|allowed domains/i.test(EMAIL_ERROR));

// ── SOURCE: every entry point uses the shared validator, none keep /^\d{10}$/ ──
const cust = read('../components/customers/CustomersModule.jsx');
const jc = read('../components/jobcards/JobCardModule.jsx');
const bill = read('../components/billing/BillingModule.jsx');
const veh = read('../components/vehicles/VehiclesModule.jsx');
const dash = read('../components/InventoryDashboard.js');

ok('Customer wizard: phone uses isIndianMobile (loose /^\\d{10}$/ gone)',
  /isIndianMobile\(f\.phone\)/.test(cust) && !/\/\^\\d\{10\}\$\/\.test\(f\.phone/.test(cust));
ok('Customer wizard: alternate mobile is validated too',
  /altPhoneErr\s*=\s*f\.altPhone && !isIndianMobile\(f\.altPhone\)/.test(cust));
ok('Customer wizard: email uses isValidEmail (loose /^\\S+@\\S+/ gone)',
  /isValidEmail\(f\.email\)/.test(cust) && !/\/\^\\S\+@\\S\+\\\.\\S\+\$\/\.test\(f\.email\)/.test(cust));
ok('Customer wizard: save AND step-gate both run the check (validate + validateBasic reference phoneErr)',
  /const validate = \(\) => \{[\s\S]{0,400}!f\.phone \|\| phoneErr/.test(cust) &&
  /const validateBasic = \(\) => \{[\s\S]{0,300}!f\.phone \|\| phoneErr/.test(cust));
ok('Job Cards: contact number uses isIndianMobile',
  /isIndianMobile\(card\.phone\)/.test(jc) && !/\/\^\\d\{10\}\$\/\.test\(card\.phone/.test(jc));
ok('Billing walk-in: phone + email use the shared validators',
  /isIndianMobile\(newCust\.phone\)/.test(bill) && /isValidEmail\(newCust\.email\)/.test(bill));
ok('Vehicles quick-create: phone validated + normalized before create',
  /!isIndianMobile\(phone\)/.test(veh) && /mobileInput\(quickCust\.phone\)/.test(veh));
ok('Boundary: Vehicles quickCreateCustomer rejects a bad mobile',
  /if \(data\.phone && !isIndianMobile\(data\.phone\)\)/.test(veh));
ok('Boundary: Billing onQuickCustomer handler rejects a bad mobile/email',
  /data\?\.phone && !isIndianMobile\(data\.phone\)/.test(dash) && /data\?\.email && !isValidEmail\(data\.email\)/.test(dash));
ok('Suppliers: phone check moved to the canonical isIndianMobile',
  /phones\.find\(\(p\) => !isIndianMobile\(p\.number\)\)/.test(dash));

// ── global coverage: every other place that takes an Indian mobile / email ──
const rem = read('../components/reminders/RemindersModule.jsx');
ok('Job Cards: alternate number is validated on save too',
  /card\.altPhone && !isIndianMobile\(card\.altPhone\)/.test(jc));
ok('Vehicles: insurance agent phone is validated on save',
  /f\.agentPhone && !isIndianMobile\(f\.agentPhone\)/.test(veh));
ok('Billing: the invoice phone field is validated on save (same style as the GST check)',
  /if \(inv\.phone && !isIndianMobile\(inv\.phone\)\) return toast\.error\(MOBILE_ERROR\)/.test(bill));
ok('Settings: business profile phone + email validated before save',
  /bizPhoneErr = biz\.bizPhone && !isIndianMobile/.test(dash) &&
  /bizEmailErr = biz\.bizEmail && !isValidEmail/.test(dash) &&
  /if \(bizPhoneErr\)[\s\S]{0,90}if \(bizEmailErr\)/.test(dash));
ok('Reminders: optional contact phone validated before add',
  /f\.phone && !isIndianMobile\(f\.phone\)/.test(rem));
ok('Suppliers + staff + admin email all use isValidEmail (no loose /\\S+@\\S+/ left)',
  (dash.match(/isValidEmail\(/g) || []).length >= 4 &&
  !/\/\^\\S\+@\\S\+\\\.\\S\+\$\/\.test/.test(dash) &&
  !/\/\^\[\^\\s@\]\+@\[\^\\s@\]\+\\\.\[\^\\s@\]\+\$\/\.test/.test(dash));
ok('the loose /^\\d{10}$/ phone regex is gone from every module we touched',
  ![cust, jc, bill, veh].some((s) => /\/\^\\d\{10\}\$\/\.test\((?:f|card|newCust|inv)\.phone/.test(s)));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
