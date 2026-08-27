/**
 * tests/customer-search-ranking.test.cjs
 *
 * REWRITTEN AGAIN — Strict Universal Search Validation review.
 *
 * History: the ORIGINAL version of this test mirrored CustomersModule.jsx's own
 * hand-rolled `customerRank(c, ql)` function (deleted — it never ranked "code contains
 * query" correctly, so an exact substring match on a customer's own code could tie with
 * pure noise). The FIRST rewrite fixed that by introducing a `refIds` band — customer's
 * own identifiers (`ids`) still won, but a linked job-card/invoice number could ALSO
 * match, just ranked lower. That turned out to be wrong too: reproduced live, searching
 * the real Customer ID "SBBMC122" (customer Bhargav Deshmukh) ALSO returned customer
 * SBBMC54 "Mangesh Deshmukh" — not because anything of Mangesh's own matched, but because
 * ONE OF HIS OWN JOB CARDS happened to be numbered "SBBMC122" (this app numbers Job
 * Cards the same "SBBMC123" shape as Customer IDs). "Ranked lower" is still "present" —
 * for a query that doesn't match Mangesh's own record, that presence is the bug.
 *
 * Current, final rule: a customer is only a match if the query hits ONE OF THAT
 * CUSTOMER'S OWN configured fields (code/gst/pan/name/phone/email/city/company/
 * referral/owned-vehicle regNo-vin-engineNo). Linked job-card and invoice numbers are
 * NOT configured fields for Customers and must never cause a customer to appear.
 * `useSearchIndex`'s `refIdsFn` mechanism that enabled this was removed from
 * lib/useSearch.js entirely, not just unused at this call site — see its doc comment.
 *
 * This test drives the REAL shared primitives (not a mirror) against customer-shaped
 * fixtures built the same way CustomersModule.jsx actually builds them.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const { normId, rankIndexed, searchAndRank } = require('../lib/useSearch.js');

console.log('\nCustomers — strict field-validated search (no phantom cross-reference matches)\n');

// Mirrors CustomersModule.jsx's actual entry shape: own identifiers in `ids`, free text
// in `hay`. Deliberately no `refIds` — linked job-card/invoice numbers are NOT part of
// a customer's own searchable fields.
const entryFor = (c) => ({
  hay: [c.name, c.phone].filter(Boolean).join(' ').toLowerCase(),
  ids: [c.code, c.gst, c.pan].filter(Boolean).map(normId),
});

console.log('\nThe flagship reproduced bug: a linked job card that collides in text with another customer\'s ID must NOT surface that other customer at all\n');
{
  // Real demo-data shape: Bhargav Deshmukh IS customer SBBMC122. Mangesh Deshmukh is a
  // totally different customer whose OWN job card happens to be numbered "SBBMC122" —
  // but that job-card number is not one of MANGESH's configured searchable fields.
  const bhargav = { code: 'SBBMC122', name: 'Bhargav Deshmukh', phone: '9577101399' };
  const mangesh = { code: 'SBBMC54', name: 'Mangesh Deshmukh', phone: '9503355461' };
  const items = [mangesh, bhargav]; // deliberately out of order
  const idx = new Map(items.map((c) => [c.code, entryFor(c)]));
  const out = searchAndRank(items, idx, (c) => c.code, 'SBBMC122', (a, b) => a.name.localeCompare(b.name));
  ok('exactly ONE result: the customer whose OWN code is the exact match',
    out.length === 1 && out[0].code === 'SBBMC122', out.map((c) => c.code).join(', ') || '(empty)');
  ok('the unrelated customer (whose own fields do not contain "SBBMC122" at all) scores 0 and is excluded, not ranked lower',
    rankIndexed(entryFor(mangesh), 'SBBMC122') === 0);
}

console.log('\nNumeric-fragment search: "122" must not let phone-number middle-digit noise bury the real match, and must not invent matches from unconfigured fields\n');
{
  // Real demo-data shape: a customer whose phone contains "122" as a substring — phone
  // IS a configured field, so this is a genuine (if weak) match, correctly included but
  // ranked below the identifier hit.
  const apTransport = { code: 'SBBMC135', name: 'AP State Transport', phone: '9448912238' }; // "122" is genuinely inside this phone
  const bhargav = { code: 'SBBMC122', name: 'Bhargav Deshmukh', phone: '9577101399' };
  // A THIRD customer with no "122" anywhere in any configured field at all — must not
  // appear, full stop (simulates the class of bug: matching via visits/revenue/an
  // unconfigured internal field, which this fixture models as simply absent).
  const unrelated = { code: 'SBBMC201', name: 'Ramesh Traders', phone: '9000000000' };
  const items = [apTransport, bhargav, unrelated];
  const idx = new Map(items.map((c) => [c.code, entryFor(c)]));
  const out = searchAndRank(items, idx, (c) => c.code, '122', (a, b) => a.name.localeCompare(b.name));
  ok('exact-code match ranks first', out[0].code === 'SBBMC122', out.map((c) => c.code).join(', '));
  ok('the phone-substring match is a genuine hit on a configured field, correctly included (ranked below)',
    out.some((c) => c.code === 'SBBMC135'));
  ok('the customer with NO "122" anywhere in any configured field does not appear at all',
    !out.some((c) => c.code === 'SBBMC201') && out.length === 2, out.map((c) => c.code).join(', '));
}

console.log('\nA genuinely nonexistent query must return ZERO results, never a fallback\n');
{
  const items = [
    { code: 'SBBMC122', name: 'Bhargav Deshmukh', phone: '9577101399' },
    { code: 'SBBMC54', name: 'Mangesh Deshmukh', phone: '9503355461' },
  ];
  const idx = new Map(items.map((c) => [c.code, entryFor(c)]));
  const out = searchAndRank(items, idx, (c) => c.code, 'ZXQ999999NONEXISTENT', (a, b) => a.name.localeCompare(b.name));
  ok('a fabricated, guaranteed-nonexistent query returns exactly zero results', out.length === 0, JSON.stringify(out));
  ok('rankIndexed itself scores a genuine non-match as 0 for every record',
    items.every((c) => rankIndexed(entryFor(c), 'ZXQ999999NONEXISTENT') === 0));
}

console.log('\nOther priority tiers (identifier > free text; exact > prefix > suffix > contains)\n');
{
  const rows = [
    { code: 'SBBMC02', name: 'AP08 Traders', phone: '9000000003' }, // no real match
    { code: 'SBBMC03', name: 'Ravi Kumar', phone: '9000000004', gst: 'AP08JP9806GSTIN' },
  ];
  const idx = new Map(rows.map((c) => [c.code, entryFor(c)]));
  const out = searchAndRank(rows, idx, (c) => c.code, 'AP08JP9806', (a, b) => a.name.localeCompare(b.name));
  ok('an identifier (GST) prefix match ranks the intended customer first, and the non-matching row is excluded',
    out.length === 1 && out[0].code === 'SBBMC03', out.map((c) => c.code).join(', '));
}
{
  const rows = [
    { code: 'SBBMC04', name: 'Nine Thousand Motors', phone: '9876500000' }, // no match
    { code: 'SBBMC05', name: 'Suresh', phone: '9876543210' },
  ];
  const idx = new Map(rows.map((c) => [c.code, entryFor(c)]));
  const out = searchAndRank(rows, idx, (c) => c.code, '9876543210', (a, b) => a.name.localeCompare(b.name));
  ok('an exact phone number (free text) still surfaces its record, and the non-matching row is excluded',
    out.length === 1 && out[0].code === 'SBBMC05', out.map((c) => c.code).join(', '));
}

// Empty query: rank-neutral, list order untouched (this is CustomersModule's own
// responsibility — searchAndRank with no query returns items as-is unless a tieBreak is
// explicitly requested). Empty query is the ONLY case that shows the full dataset.
ok('empty query returns the full dataset untouched (the ONLY case that does)', searchAndRank(
  [{ code: 'B' }, { code: 'A' }],
  new Map([['B', entryFor({ code: 'B' })], ['A', entryFor({ code: 'A' })]]),
  (c) => c.code, '',
).map((c) => c.code).join(',') === 'B,A');

console.log('\nSource wiring — no cross-reference matching, single shared engine\n');
const src = fs.readFileSync(path.resolve(__dirname, '../components/customers/CustomersModule.jsx'), 'utf8');
ok('customerRank no longer exists (deleted, not just unused)', !/customerRank/.test(src));
ok('no refIds/refIdsFn wiring remains — job-card/invoice numbers are not searchable customer fields',
  !/refIdsFn|cardsOf\(c\)\.map\(\(j\) => j\.jobNo\), \.\.\.invoicesOf/.test(src));
ok('CustomersModule imports searchAndRank (the shared filter+rank+sort entry point)',
  /useSearchIndex, searchAndRank/.test(src));
ok('the search index configures ONLY this customer\'s own identifiers (code/gst/pan/vehicle regNo-vin-engineNo)',
  /\(c\) => \[c\.code, c\.gst, c\.pan,\s*\n\s*\.\.\.\(c\.vehicles \|\| \[\]\)\.flatMap\(\(v\) => \[v\.regNo, v\.vin, v\.engineNo\]\)\],\s*\n\s*\[custIdx\],\s*\n\s*\);/.test(src));
ok('filtering + ranking goes through the single shared searchAndRank call', /searchAndRank\(prefiltered, searchIndex, \(c\) => c\.id, dq,/.test(src));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
