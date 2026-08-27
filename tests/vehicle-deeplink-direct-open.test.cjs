/**
 * tests/vehicle-deeplink-direct-open.test.cjs
 *
 * Root cause of "Job Card 'View Vehicle' relies on search behaviour": Job Card's View
 * Vehicle button (and any other "View Vehicle" caller) opens a new tab at
 * /?open=vehicles:<regNo>#vehicles (InventoryDashboard.js), which stashes the
 * registration in localStorage under maruti_vehicles_open. VehiclesModule's OWN
 * one-shot effect for that key only ever called setQ(reg) — it filtered the list by
 * search text and left the user looking at a (possibly multi-row, possibly
 * zero-row-if-ranking-missed-it) filtered table, never actually opening the vehicle's
 * own detail record. Customers' identical deep-link (maruti_customer_open) had already
 * been fixed to select the exact record directly; Vehicles had not.
 *
 * A second, related bug in the old code: it read+cleared the localStorage token in a
 * mount-only effect (`useEffect(..., [])`), before `customers`/`rows` could possibly
 * have loaded — the exact race already fixed for Customers/Job Cards/Billing via a
 * pendingXOpen ref that is only cleared once actually resolved against loaded data.
 *
 * Fix: VehiclesModule now resolves the token against `rows` (the flattened
 * customer-vehicle list) by normalized registration number and calls setSelId(...) to
 * open that vehicle's own detail panel directly, using the same pendingVehOpen/
 * vehOpenDone pattern as the other modules.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/vehicles/VehiclesModule.jsx'), 'utf8');

console.log('\nVehicles — "View Vehicle" deep-link opens the exact record\n');

ok('the old search-only effect (setQ(reg) on mount, before data loads) is gone',
  !/let reg = null;\s*\n\s*try \{ reg = localStorage\.getItem\('maruti_vehicles_open'\)/.test(src));

const start = src.indexOf('const pendingVehOpen = useRef(null)');
ok('pendingVehOpen ref reads the token lazily (component-body read, not inside a mount effect) so it survives a Strict Mode double-mount', start !== -1);
const block = src.slice(start, start + 1200);

ok('token is read from the same maruti_vehicles_open key the dashboard writes',
  /localStorage\.getItem\('maruti_vehicles_open'\)/.test(block));
ok('resolution effect is keyed on `rows` (the actual data), not an empty dependency array',
  /\}, \[rows\]\);/.test(block));
ok('token is cleared only once resolved (vehOpenDone guard), not on the initial read',
  /if \(!key \|\| vehOpenDone\.current\) return;/.test(block));
ok('match is found by normalized registration number (case/whitespace-insensitive)',
  /const norm = \(r\) => \(r \|\| ''\)\.toUpperCase\(\)\.replace\(\/\\s\+\/g, ''\)/.test(block) &&
  /const match = rows\.find\(\(r\) => norm\(r\.regNo\) === norm\(key\)\)/.test(block));
ok('a match opens the vehicle\'s own detail panel directly (setSelId), not just a search filter',
  /setSelId\(match\.id\)/.test(block) && /setDetailTab\('Overview'\)/.test(block));
ok('search text is still set alongside the direct open (keeps list context consistent), not instead of it',
  /setSelId\(match\.id\)[\s\S]{0,80}setQ\(key\)/.test(block));
ok('an unmatched token still falls back to filtering by search once data has loaded, rather than hanging forever',
  /else if \(rows\.length\) \{[\s\S]{0,150}setQ\(key\)/.test(block));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
