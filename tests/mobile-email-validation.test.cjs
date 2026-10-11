/**
 * tests/mobile-email-validation.test.cjs
 *
 * QA report findings DATA-001, VAL-001, VAL-002, VAL-003 — the shared Indian-mobile and
 * email rules in lib/format.js (the REAL module, loaded through the Babel hook; nothing is
 * re-implemented here).
 *
 *  DATA-001  a pasted "+919123456781" was cut to "9191234567" — a different valid-looking
 *            number — by `.replace(/\D/g,'').slice(0,10)`, and the form saved it.
 *  VAL-001   mobiles starting 0-5 were accepted.
 *  VAL-002   "a@@b.com" matched /^\S+@\S+\.\S+$/.
 *  VAL-003   "9999999999" was accepted.
 *
 * Wiring of these helpers into each module is asserted in phone-field-wiring.test.cjs.
 */
require('./setup.cjs');
const {
  parseIndianMobile, validateIndianMobile, isValidIndianMobile, sanitizeMobileInput,
  MOBILE_ERRORS, isValidEmail,
} = require('../lib/format');

let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const accepts = (input, expected) => {
  const r = parseIndianMobile(input);
  ok(`accepts ${JSON.stringify(input)} -> ${expected}`, r.ok && r.value === expected, JSON.stringify(r));
};
const rejects = (input, code) => {
  const r = parseIndianMobile(input);
  ok(`rejects ${JSON.stringify(input)} (${code})`, !r.ok && r.code === code && r.error === MOBILE_ERRORS[code], JSON.stringify(r));
};

console.log('\nDATA-001 — supported prefixes are normalised, never truncated\n');
accepts('9123456781', '9123456781');          // plain ten-digit mobile
accepts('+919123456781', '9123456781');       // +91
accepts('+91 91234 56781', '9123456781');     // +91 with spacing
accepts('919123456781', '9123456781');        // 91 (exactly 12 digits)
accepts('09123456781', '9123456781');         // trunk 0 (exactly 11 digits)
accepts('98765 43210', '9876543210');         // spaces
accepts('98765-43210', '9876543210');         // hyphens
accepts('(98765) 43210', '9876543210');       // brackets
accepts('  9876543210  ', '9876543210');      // surrounding whitespace
accepts('9112345678', '9112345678');          // a real number that merely STARTS with 91 is untouched

console.log('\nDATA-001 — anything that cannot be positively identified is rejected, not "fixed"\n');
rejects('91234567810', 'tooLong');            // eleven digits, not a 0 prefix
rejects('9123456781000', 'tooLong');          // thirteen digits
rejects('123', 'tooShort');
rejects('98765', 'tooShort');
rejects('+91', 'tooShort');
rejects('+91 98765', 'tooShort');
rejects('+447911123456', 'country');          // unsupported country code (explicit +)
rejects('447911123456', 'country');           // 12 digits, 2-digit code, not 91
rejects('+1 2025550123', 'country');
rejects('abcdefghij', 'chars');               // alphabetic input
rejects('98765abcde', 'chars');
rejects('98765#43210', 'chars');
rejects('91+9123456781', 'chars');            // '+' anywhere but first
rejects('', 'empty');
rejects('   ', 'empty');
rejects(null, 'empty');
rejects(undefined, 'empty');
// The corruption the report demonstrated must now be impossible to reach silently:
ok('"+919123456781" can never come out as 9191234567',
  parseIndianMobile('+919123456781').value !== '9191234567');

console.log('\nVAL-001 — numbers starting 0-5 are not Indian mobiles\n');
rejects('0123456789', 'badStart');
rejects('5123456789', 'badStart');
rejects('1234567890', 'badStart');
rejects('4123456789', 'badStart');
rejects('01234567890', 'badStart');           // 0-prefixed 11 digits whose real number starts 1
['6', '7', '8', '9'].forEach((d) => accepts(`${d}123456780`, `${d}123456780`));
ok('"0123456789" and "5123456789" are not valid mobiles', !isValidIndianMobile('0123456789') && !isValidIndianMobile('5123456789'));

console.log('\nVAL-003 — a single repeated digit is a placeholder, not a number\n');
rejects('9999999999', 'repeated');
rejects('6666666666', 'repeated');
rejects('0000000000', 'badStart');            // rejected either way
accepts('9999999990', '9999999990');          // SOME repeated digits are fine
accepts('9898989898', '9898989898');
accepts('9111111111', '9111111111');
accepts('9876543210', '9876543210');

console.log('\nvalidateIndianMobile — message contract used by every form\n');
ok('empty + optional -> no error', validateIndianMobile('') === null && validateIndianMobile(undefined) === null);
ok('empty + required -> message', validateIndianMobile('', { required: true }) === MOBILE_ERRORS.empty);
ok('valid -> null', validateIndianMobile('9123456781') === null && validateIndianMobile('+919123456781') === null);
ok('invalid -> its specific message', validateIndianMobile('5123456789') === MOBILE_ERRORS.badStart
  && validateIndianMobile('9999999999') === MOBILE_ERRORS.repeated
  && validateIndianMobile('12') === MOBILE_ERRORS.tooShort);

console.log('\nsanitizeMobileInput — what the <input> shows while typing / pasting\n');
const s = sanitizeMobileInput;
ok('+91 paste is stripped', s('+919123456781') === '9123456781');
ok('+91 with spaces is stripped', s('+91 91234 56781') === '9123456781');
ok('91 paste (12 digits) is stripped', s('919123456781') === '9123456781');
ok('0 paste (11 digits) is stripped', s('09123456781') === '9123456781');
ok('spaces and hyphens are removed', s('98765-43210') === '9876543210' && s('98765 43210') === '9876543210');
ok('letters/symbols are dropped (as the fields always did)', s('abc9123') === '9123' && s('abcdefghij') === '');
ok('a plain ten-digit number is untouched', s('9123456781') === '9123456781');
ok('a number that merely starts with 91 is untouched', s('9112345678') === '9112345678');
ok('an 11-digit entry is NOT truncated to a different number', s('91234567810') === '91234567810');
ok('a 13-digit entry is NOT truncated to a different number', s('9123456781000') === '9123456781000');
ok('an unsupported country code stays visible so it can be rejected', s('+447911123456') === '447911123456');
ok('runaway paste is capped at 15 digits (E.164 max)', s('9'.repeat(40)).length === 15);
ok('nullish -> empty string', s('') === '' && s(null) === '' && s(undefined) === '');
ok('typing progressively never alters earlier digits', ['9', '91', '912', '9123', '91234', '912345', '9123456', '91234567', '912345678', '9123456781']
  .every((p) => s(p) === p));
// The input is controlled: its own output is fed straight back in on the next render.
const samples = ['+919123456781', '919123456781', '09123456781', '9123456781', '98765 43210', '+447911123456', '91234567810', '9'.repeat(40), '', 'abc'];
ok('sanitizer is idempotent (safe to re-run on its own output)', samples.every((x) => s(s(x)) === s(x)),
  samples.filter((x) => s(s(x)) !== s(x)).join(', '));
// A pasted +91 number must round-trip through sanitize -> validate cleanly.
ok('sanitize -> validate round-trip accepts a pasted +91 number', validateIndianMobile(s('+919123456781')) === null);
ok('sanitize -> validate round-trip rejects an over-long entry', validateIndianMobile(s('91234567810')) === MOBILE_ERRORS.tooLong);

console.log('\nVAL-002 — email\n');
// (main's isValidEmail also rejects the reserved example.com/.net/.org placeholders, so real domains are used here)
const good = ['name@gmail.com', 'a@b.co', 'name+tag@gmail.com', 'first.last@sub.company.co.in', 'A_B-C@x-y.org', '  padded@gmail.com  '];
const bad = ['a@@b.com', 'foo@bar', 'abc@', '@b.com', 'a b@c.com', 'a@b', 'a@b.c', 'a@.com', 'a@b..com', 'a..b@c.com', '.a@b.com', 'a.@b.com', 'a@-b.com', 'a@b-.com', 'a@b@c.com', '', '   ', null, undefined];
good.forEach((e) => ok(`accepts ${JSON.stringify(e)}`, isValidEmail(e) === true));
bad.forEach((e) => ok(`rejects ${JSON.stringify(e)}`, isValidEmail(e) === false));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
