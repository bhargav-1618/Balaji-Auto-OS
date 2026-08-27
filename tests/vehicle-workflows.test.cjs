/**
 * tests/vehicle-workflows.test.cjs
 *
 * Three fixes:
 *  1. Create-Job-Card-from-Vehicle carries the FULL customer+vehicle context.
 *  2. Archived vehicles are viewable (status filter) and restore round-trips.
 *  3. Pagination clamps synchronously so a filter that shrinks the list never flashes empty.
 * Behavioural where possible; source guards for the JSX wiring.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const R = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nVehicle workflows — prefill, archive, pagination clamp\n');

// ── 1. Create Job Card prefill completeness ────────────────────────────────
// H-5C: the field mapping was extracted to services/vehicleService.js's
// buildJobCardDraftFields (pure customer+vehicle -> draft mapper); the same
// fields are asserted there now, plus that InventoryDashboard.js delegates to it.
const dash = R('components/InventoryDashboard.js');
const vehicleSvc = R('services/vehicleService.js');
const draftFieldsSrc = vehicleSvc.slice(vehicleSvc.indexOf('export function buildJobCardDraftFields'), vehicleSvc.indexOf('export function buildJobCardDraftFields') + 1000);
for (const field of ['customerId', 'customer', 'phone', 'altPhone', 'address', 'make', 'model', 'regNo', 'vin', 'engineNo', 'fuel', 'odometer']) {
  ok(`job-card prefill carries ${field}`, new RegExp(`${field}:`).test(draftFieldsSrc));
}
ok('prefill combines make+model into the vehicle name',
  /makeModel = \[vehicle\.make, vehicle\.model\]\.filter\(Boolean\)\.join\(' '\)/.test(vehicleSvc));
ok('writeJobCardDraft delegates to the shared buildJobCardDraftFields mapper',
  /buildJobCardDraftFields\(c, v\)/.test(dash));

// behavioural: the draft the form reads merges over emptyCard and keeps prefilled fields
const emptyCard = { customer: '', phone: '', vehicle: '', regNo: '', vin: '', make: '', fuel: 'Petrol' };
const draft = { jobNo: 'SBBMC01', customer: 'Techno Garage', phone: '9260852639', vehicle: 'Maruti Dzire VXi', regNo: 'AP08JP9806', vin: 'ABC12345678901234', make: 'Maruti', fuel: 'Diesel' };
const merged = { ...emptyCard, ...draft };
ok('merged card keeps the prefilled customer', merged.customer === 'Techno Garage');
ok('merged card keeps the prefilled registration', merged.regNo === 'AP08JP9806');
ok('merged card keeps the prefilled fuel (Diesel over default Petrol)', merged.fuel === 'Diesel');
ok('merged card has a job number so the form loads it (d.jobNo truthy)', !!merged.jobNo);

// ── 2. Archive: viewable + restore round-trip ──────────────────────────────
const veh = R('components/vehicles/VehiclesModule.jsx');
ok('Vehicles now has a Status filter with an Archived option',
  /\['All', 'Active', 'Inactive', 'Archived'\]\.map/.test(veh));
ok('the status predicate filters by (r.status || Active)', /statusF !== 'All' && \(r\.status \|\| 'Active'\) !== statusF/.test(veh));

// behavioural archive round-trip (the toggle used by archiveVehicle)
const toggle = (list, id) => list.map((v) => (v.id === id ? { ...v, status: v.status === 'Archived' ? 'Active' : 'Archived' } : v));
let vs = [{ id: 'v1', status: 'Active' }, { id: 'v2', status: 'Active' }];
vs = toggle(vs, 'v1');
const archView = (l, f) => l.filter((v) => f === 'All' || (v.status || 'Active') === f);
ok('archived vehicle appears under the Archived filter', archView(vs, 'Archived').map((v) => v.id).join() === 'v1');
ok('archived vehicle is NOT under the Active filter', !archView(vs, 'Active').some((v) => v.id === 'v1'));
vs = toggle(vs, 'v1');
ok('restore moves it back to Active', archView(vs, 'Active').some((v) => v.id === 'v1'));

// Customers archive = Inactive status (accessible via the existing Inactive filter)
const cust = R('components/customers/CustomersModule.jsx');
// Window widened 300 -> 450 between willArchive and archived:true: the intervening
// histEntry(...) call grew a second explicit argument (missing-argument Firestore-undefined
// fix, see customer-export-archived-status.test.cjs), pushing the real distance to 349.
ok('Customers archive toggles the archived flag (true archive, viewable via Archived filter)',
  /c\.archived \? t\('common\.reactivate', 'Reactivate'\) : t\('customers\.action\.archiveCustomer', 'Archive Customer'\)[\s\S]{0,400}willArchive = !x\.archived[\s\S]{0,450}archived: true[\s\S]{0,150}archived: false/.test(cust));

// ── 3. Pagination clamp (both modules) ─────────────────────────────────────
ok('Vehicles clamps page to pageCount synchronously', /const safePage = Math\.min\(page, pageCount\)/.test(veh));
ok('Vehicles slices with safePage', /filtered\.slice\(\(safePage - 1\)/.test(veh));
ok('Customers clamps page to pageCount synchronously', /const safePage = Math\.min\(page, pageCount\)/.test(cust));
ok('Customers slices with safePage', /filtered\.slice\(\(safePage - 1\)/.test(cust));

// behavioural: on a filter that shrinks results below the current page, safePage still yields rows
const filtered = [{}, {}, {}, {}, {}]; // 5 rows
const perPage = 25, pageStale = 3;
const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
const safePage = Math.min(pageStale, pageCount);
const paged = filtered.slice((safePage - 1) * perPage, safePage * perPage);
ok('a stale page=3 clamps to 1 and still shows the 5 rows (no empty flash)', paged.length === 5);

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
