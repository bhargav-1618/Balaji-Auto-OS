/**
 * tests/filter-reset.test.cjs
 *
 * "All X" filter options must reset the filter, not filter FOR the literal label. The bug:
 * <option> rendered display text ("All Customer Types") with no value attribute, so its
 * value became that text — which never equals the 'All' sentinel the predicate checks,
 * emptying the table. These guard that every "All" option carries an explicit value.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const R = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\n"All X" filter options reset correctly (explicit option values)\n');

// --- behavioural: the predicate treats 'All' as no-filter, but breaks on the label ---
const applyType = (rows, typeF) => rows.filter((c) => typeF === 'All' || c.type === typeF);
const rows = [{ type: 'Corporate' }, { type: 'Fleet Owner' }, { type: 'Individual' }];
ok('predicate: typeF="All" returns every row', applyType(rows, 'All').length === 3);
ok('predicate: typeF="Corporate" filters to 1', applyType(rows, 'Corporate').length === 1);
ok('predicate: the DISPLAY label as a value would empty the list (the bug)',
  applyType(rows, 'All Customer Types').length === 0);

// --- source guards: every "All …" option must set value to the sentinel, not the label ---
// Customers Type, Vehicles Make and Vehicles Fuel filters were later converted from
// native <select> to MiniSelect (production-dropdown pass) — MiniSelect has no
// value-vs-text ambiguity at all (options ARE the value; a separate `labels` map only
// changes what's DISPLAYED, never what onPick receives), so this class of bug is
// structurally impossible there now. Guard the NEW mechanism instead: the `labels` map
// supplies the friendly text, and onPick falls back to the 'All' sentinel (MiniSelect's
// clear button always fires onPick('')) rather than ever passing ''.
const cust = R('components/customers/CustomersModule.jsx');
// labels/onPick param renamed for localization (placeholder/labels now route through
// lib/i18n.js's t('key', 'English fallback') — the loop param was renamed v/st to
// avoid shadowing the translation function t() in scope). Same sentinel-fallback
// behavior either way.
// The `labels` map was pulled out into a memoized `typeFilterLabels` (every one of the
// 17 customer TYPES gets its own customerType.<type> translation now, not just the
// "All" sentinel) — guard both halves: the memo actually translates every type, and the
// JSX still wires labels/emptyValue/onPick the same sentinel-fallback way.
ok('Customers type filter: typeFilterLabels translates the All sentinel AND every customer type',
  /const typeFilterLabels = useMemo\(\(\) => \(\{ All: t\('customers\.filter\.allTypes', 'All Customer Types'\), \.\.\.Object\.fromEntries\(TYPES\.map\(\(ty\) => \[ty, t\(`customerType\.\$\{ty\}`, ty\)\]\)\) \}\)/.test(cust));
ok('Customers type filter: MiniSelect wires typeFilterLabels, and onPick falls back to the All sentinel (not empty string)',
  /options=\{\['All', \.\.\.TYPES\]\} labels=\{typeFilterLabels\} emptyValue="All" onPick=\{\(v\) => setTypeF\(v \|\| 'All'\)\}/.test(cust));
ok('Customers status select: option carries explicit value={t}',
  /\['All', 'Active', 'Inactive', 'Archived'\]\.map\(\(st\) => <option key=\{st\} value=\{st\}/.test(cust));
ok('Customers: no valueless "All Customer Types" option remains',
  !/<option key=\{t\} style=\{\{ background: '#141414' \}\}>\{t === 'All' \? 'All Customer Types'/.test(cust));

const bill = R('components/billing/BillingModule.jsx');
ok('Billing status select carries explicit value',
  // 'Archived' appended after 'Returned' — see billing-filter-perf.test.cjs's matching note.
  /'Returned', 'Archived'\]\.map\(\(s\) => <option key=\{s\} value=\{s\}/.test(bill));
ok('Billing payments select carries explicit value',
  /\['All', \.\.\.PAYMENT_MODES\]\.map\(\(s\) => <option key=\{s\} value=\{s\}/.test(bill));

const veh = R('components/vehicles/VehiclesModule.jsx');
ok('Vehicles make filter: MiniSelect labels the All sentinel, and onPick falls back to it (not empty string)',
  /options=\{makes\} labels=\{\{ All: t\('vehicles\.filter\.allMakes', 'All Makes'\) \}\} emptyValue="All" onPick=\{\(m\) => setMakeF\(m \|\| 'All'\)\}/.test(veh));
ok('Vehicles fuel filter: MiniSelect labels the All sentinel, and onPick falls back to it (not empty string)',
  /options=\{\['All', \.\.\.FUELS\]\} labels=\{\{ All: t\('vehicles\.filter\.allFuels', 'All Fuels'\) \}\} emptyValue="All" onPick=\{\(m\) => setFuelF\(m \|\| 'All'\)\}/.test(veh));

// combinations still compose correctly (search + type + status)
const applyAll = (list, { q = '', typeF = 'All', statusF = 'All' }) => list.filter((c) =>
  (typeF === 'All' || c.type === typeF) &&
  (statusF === 'All' || c.status === statusF) &&
  (!q || c.name.toLowerCase().includes(q.toLowerCase())));
const data = [
  { name: 'Anil', type: 'Corporate', status: 'Active' },
  { name: 'Sita', type: 'Fleet Owner', status: 'Inactive' },
  { name: 'Anita', type: 'Corporate', status: 'Inactive' },
];
ok('search+type+status compose', applyAll(data, { q: 'an', typeF: 'Corporate', statusF: 'Inactive' }).length === 1);
ok('clearing type back to All restores within an active search',
  applyAll(data, { q: 'a', typeF: 'All' }).length === 3);
ok('clearing all three shows everything', applyAll(data, {}).length === 3);

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
