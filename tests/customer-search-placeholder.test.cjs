/**
 * tests/customer-search-placeholder.test.cjs
 *
 * Root cause of "the placeholder is truncated (Search by name, phone, em...)": the
 * search field's own descriptive text was already reasonably complete, but it was
 * rendered inside a box capped at `max-w-xl` (576px, from the earlier dashboard-layout
 * proportion fix) inside a rigid single-line `sm:flex-row` toolbar — at the widths this
 * column realistically gets (see customer-dashboard-layout.test.cjs), that box was
 * sometimes narrower than the text needed, so the browser clipped it.
 *
 * Fix (original): a fuller, explicit placeholder (naming every searchable field) + a
 * wider cap (max-w-2xl) + a sensible min-width, and the toolbar row wraps (`flex-wrap`)
 * instead of silently squeezing the search box narrower than it needs whenever the
 * filters/buttons don't all fit on one line.
 *
 * Superseded by the toolbar redesign (see
 * tests/customers-vehicles-toolbar-redesign.test.cjs): search now has its own
 * always-full-width row, so it never again shares row space with filters/buttons —
 * the max-w cap, min-w guard, and wrap-instead-of-squeeze fix this file originally
 * asserted are no longer applicable (there's nothing left to squeeze against). The
 * placeholder text itself is unchanged and still asserted below.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/customers/CustomersModule.jsx'), 'utf8');

console.log('\nCustomers — search placeholder + field width\n');

// Placeholder now routes through lib/i18n.js's t('key', 'English fallback') for
// localization — the literal English string is still present as the fallback
// argument, so the same text is still asserted, just through that form.
ok('placeholder names every searchable field (Name, Phone, Email, Customer ID, Vehicle Registration)',
  /placeholder=\{t\('customers\.searchPlaceholder', 'Search by Customer Name, Phone Number, Email, Customer ID or Vehicle Registration'\)\}/.test(src));
ok('search field is full-width on its own row (toolbar redesign — no cap needed, nothing shares the row)',
  /<input value=\{q\} onChange=\{\(e\) => setQ\(e\.target\.value\)\} placeholder=\{t\('customers\.searchPlaceholder', 'Search by Customer Name, Phone Number, Email, Customer ID or Vehicle Registration'\)\} className=\{`\$\{inputCls\} pl-9 w-full`\}/.test(src));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
