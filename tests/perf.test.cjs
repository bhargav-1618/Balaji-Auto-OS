/**
 * tests/perf.test.cjs
 *
 * Hard per-keystroke budgets, at the real dataset size. This is not a microbenchmark for
 * bragging — it FAILS if anyone reintroduces an O(n·m) filter, because that is exactly
 * how the vehicle search came to take 36 SECONDS per character.
 *
 * A 60fps frame is 16.7ms. Anything a keystroke does above that budget drops frames and
 * the app "feels frozen". Budgets below are deliberately generous (5ms) so the test is
 * about ALGORITHMIC class, not machine speed — a CI box being slow will not flake it,
 * but an accidental nested scan will blow through it by three orders of magnitude.
 */
require('./setup.cjs');
const S = require('../lib/vehicleStats.js');
const { indexBy, phoneKey, matchTokens } = require('../lib/useSearch.js');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};

const FRAME_MS = 16.7;
const BUDGET_MS = 5;      // a keystroke must cost well under one frame

const N_VEH = 350;
const N_CUST = 200;
const N_JOBS = 1400;
const N_INV = 1129;

const MAKES = ['Maruti', 'Hyundai', 'Tata', 'Mahindra', 'Kia', 'Honda', 'Toyota', 'Renault'];
const MODELS = ['Swift', 'Baleno', 'Nexon', 'Thar', 'Seltos', 'City', 'Innova', 'Kwid'];

const vehicles = Array.from({ length: N_VEH }, (_, i) => ({
  id: `v${i}`, regNo: `AP${String(i % 40).padStart(2, '0')}XY${1000 + i}`,
  make: MAKES[i % 8], model: MODELS[i % 8], variant: 'ZXi', vin: `VIN${i}XXXXXXXXX`,
  engineNo: `ENG${i}YYYYYYY`, owner: `Owner ${i}`, ownerPhone: `98${10000000 + i}`,
  fuel: i % 2 ? 'Petrol' : 'Diesel', transmission: 'Manual', insurer: 'Bajaj',
  rcNumber: `RC${i}`, tags: 't', status: 'Active',
  ownershipType: i % 10 === 0 ? 'Fleet' : 'Individual',
  insuranceExpiry: '2026-09-01', pucExpiry: '2026-08-01', warrantyExpiry: '2027-01-01',
}));
const customers = Array.from({ length: N_CUST }, (_, i) => ({
  id: `c${i}`, name: `Cust ${i}`, phone: `98${20000000 + i}`, code: `C${i}`, vehicles: [],
}));
const jobCards = Array.from({ length: N_JOBS }, (_, i) => ({
  jobNo: `JC-${i}`, regNo: vehicles[i % N_VEH].regNo, phone: customers[i % N_CUST].phone,
  status: ['Delivered', 'Closed', 'Repair Started', 'Ready', 'Cancelled'][i % 5], savedAt: Date.now(),
}));
const invoices = Array.from({ length: N_INV }, (_, i) => ({
  invNo: `INV-${i}`, regNo: vehicles[i % N_VEH].regNo, customerId: customers[i % N_CUST].id,
  phone: customers[i % N_CUST].phone, vehicle: vehicles[i % N_VEH].model,
  lines: [{ kind: 'Part', qty: 2, rate: 1500, disc: 0, gst: 18 }],
  payments: [{ amount: 3540 }], status: 'Paid',
}));

const timeIt = (fn, iters = 20) => {
  fn();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i += 1) fn();
  return Number(process.hrtime.bigint() - t0) / 1e6 / iters;
};

console.log(`\nPER-KEYSTROKE BUDGETS · ${N_VEH} vehicles · ${N_CUST} customers · ${N_JOBS} job cards · ${N_INV} invoices`);
console.log(`(one 60fps frame = ${FRAME_MS}ms; budget = ${BUDGET_MS}ms)\n`);

// ---- VEHICLES -------------------------------------------------------------
const vIdx = S.buildVehicleIndex(jobCards, invoices);
const vHay = new Map();
vehicles.forEach((r) => vHay.set(r.id, [r.regNo, r.vin, r.engineNo, r.owner, r.ownerPhone,
  r.make, r.model, r.variant, r.fuel, r.transmission, r.insurer, r.rcNumber, r.tags,
  ...S.jobsOf(vIdx, r).map((j) => j.jobNo),
  ...S.invoicesOf(vIdx, r).map((iv) => iv.invNo)].filter(Boolean).join(' ').toLowerCase()));

const vSearch = timeIt(() => vehicles.filter((r) => matchTokens(vHay.get(r.id), 'swift')));
ok(`vehicle search keystroke < ${BUDGET_MS}ms`, vSearch < BUDGET_MS, `${vSearch.toFixed(3)}ms`);
console.log(`      vehicle search: ${vSearch.toFixed(3)}ms`);

// The old algorithm, for contrast. Not timed in full — it would hang the suite.
{
  const oldJcOf = (v) => jobCards.filter((j) => j.regNo === v.regNo);
  const oldInvOf = (v) => invoices.filter((iv) => (iv.vehicle || '').includes(v.regNo) || oldJcOf(v).length);
  // ONE vehicle only. Extrapolate rather than run 350 of them.
  const one = timeIt(() => oldInvOf(vehicles[0]), 3);
  const projected = one * N_VEH;
  ok('the OLD nested-scan search was over budget by orders of magnitude',
    projected > BUDGET_MS * 100,
    `projected ${projected.toFixed(0)}ms per keystroke`);
  console.log(`      OLD algorithm, projected: ${(projected / 1000).toFixed(1)}s per keystroke (${(projected / FRAME_MS).toFixed(0)} dropped frames)`);
}

// ---- INDEX BUILD (once per data change, not per keystroke) -----------------
const idxMs = timeIt(() => S.buildVehicleIndex(jobCards, invoices), 5);
ok('building the index is cheap enough to do on every data change', idxMs < 50, `${idxMs.toFixed(2)}ms`);

// ---- CUSTOMERS ------------------------------------------------------------
const jobsByPhone = indexBy(jobCards, (j) => phoneKey(j.phone));
const invByCust = indexBy(invoices, (iv) => iv.customerId);
const cHay = new Map();
customers.forEach((c) => cHay.set(c.id, [c.name, c.code, c.phone,
  ...(jobsByPhone.get(phoneKey(c.phone)) || []).map((j) => j.jobNo),
  ...(invByCust.get(c.id) || []).map((iv) => iv.invNo)].filter(Boolean).join(' ').toLowerCase()));

const cSearch = timeIt(() => customers.filter((c) => matchTokens(cHay.get(c.id), 'cust 1')));
ok(`customer search keystroke < ${BUDGET_MS}ms`, cSearch < BUDGET_MS, `${cSearch.toFixed(3)}ms`);
console.log(`      customer search: ${cSearch.toFixed(3)}ms`);

{
  const oldCardsOf = (c) => jobCards.filter((j) => (j.phone || '').replace(/\D/g, '') === (c.phone || '').replace(/\D/g, ''));
  const oldInvOf = (c) => invoices.filter((iv) => iv.customerId === c.id || (iv.phone || '').replace(/\D/g, '') === (c.phone || '').replace(/\D/g, ''));
  const oldMs = timeIt(() => customers.filter((c) => [c.name, c.code, c.phone,
    ...oldCardsOf(c).map((j) => j.jobNo), ...oldInvOf(c).map((iv) => iv.invNo)]
    .filter(Boolean).join(' ').toLowerCase().includes('cust 1')), 3);
  ok('the OLD customer search blew the frame budget (it was also undebounced)',
    oldMs > FRAME_MS, `${oldMs.toFixed(1)}ms per keystroke — ${(oldMs / FRAME_MS).toFixed(1)} dropped frames`);
  console.log(`      OLD customer search: ${oldMs.toFixed(1)}ms (${(oldMs / cSearch).toFixed(0)}× slower)`);
}

// ---- BILLING --------------------------------------------------------------
const invRows = [...invoices]
  .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  .map((iv) => ({ iv, hay: [iv.invNo, iv.customer, iv.phone, iv.vehicle, iv.regNo].filter(Boolean).join(' ').toLowerCase() }));
const bSearch = timeIt(() => invRows.filter(({ hay }) => matchTokens(hay, 'inv-1')));
ok(`billing search keystroke < ${BUDGET_MS}ms`, bSearch < BUDGET_MS, `${bSearch.toFixed(3)}ms`);
console.log(`      billing search: ${bSearch.toFixed(3)}ms`);

// ---- STRUCTURAL GUARDS ----------------------------------------------------
console.log('\n  --- structural guards (these are what stop the regression) ---\n');

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const veh = read('components/vehicles/VehiclesModule.jsx');
const cust = read('components/customers/CustomersModule.jsx');
const bill = read('components/billing/BillingModule.jsx');
const jc = read('components/jobcards/JobCardModule.jsx');
const sel = read('components/common/SearchSelect.jsx');

// matchTokens(haystacks.get(...)) -> matchIndexed(searchIndex.get(...)): see
// tests/search-accuracy-exact-identifier.test.cjs — Registration/VIN/Engine/Chassis No.
// now match by EXACT value only; still a single precomputed-index lookup per row, no
// rescan reintroduced.
ok('Vehicles: no array rescan inside the filter (uses a precomputed haystack)',
  /matchIndexed\(searchIndex\.get\(r\.id\)/.test(veh) && !/const invOf = \(v\) => invoices\.filter/.test(veh));

ok('Vehicles: sort keys are precomputed, not recomputed per comparison',
  /\.map\(\(r\) => \(\{ r, k: keyFns\[sortBy\]\(r\) \}\)\)\.sort\(\(a, b\) => b\.k - a\.k\)/.test(veh));

ok('Customers: job cards / invoices are INDEXED, not rescanned per row',
  /indexBy\(jobCards/.test(cust) && /indexBy\(invoices/.test(cust));

ok('Customers: search is deferred, not blocking (it was not debounced at all)',
  /useDeferredSearch\(q\)/.test(cust));

// The heavy container: a keystroke there re-renders the WHOLE app tree, so the search
// value MUST be deferred. A debounce cannot fix it — the tree still re-renders per
// character, just as slowly, 150ms later.
const dash = read('components/InventoryDashboard.js');
// Was `useDeferredValue(search)` called directly — now routed through the same
// shared useDeferredSearch hook used elsewhere in this file (global search framework
// consolidation pass), which wraps the identical useDeferredValue call internally.
ok('InventoryDashboard: search is deferred (a keystroke re-renders the whole tree)',
  /const \[debouncedSearch, isSearchStale\] = useDeferredSearch\(search\)/.test(dash));
ok('InventoryDashboard: the old setTimeout debounce is gone',
  !/setTimeout\(\(\) => setDebouncedSearch\(search\), 150\)/.test(dash));
ok('Inventory: part haystacks precomputed, not rebuilt per part per keystroke',
  /const partHaystacks = useMemo/.test(dash));
ok('Inventory: expandToken hoisted out of the per-part loop',
  /const tokenCandidates = tokens\.map/.test(dash));

// No module should be left relying on an artificial delay for in-memory filtering.
{
  const debounced = [];
  ['components/vehicles/VehiclesModule.jsx', 'components/customers/CustomersModule.jsx',
    'components/billing/BillingModule.jsx', 'components/jobcards/JobCardModule.jsx',
    'components/InventoryDashboard.js'].forEach((f) => {
    if (/useDebounced\(/.test(read(f))) debounced.push(f);
  });
  ok('no module still uses a debounce for in-memory filtering (that is pure lag)',
    debounced.length === 0, debounced.join(', '));
}

ok('Billing: status + haystack derived once per data change, not per keystroke',
  /const invoiceRows = useMemo/.test(bill) && /status: deriveStatus\(iv\)/.test(bill));

ok('JobCards: the list is memoized, not rebuilt inside JSX on every render',
  /const savedList = useMemo/.test(jc) && !/const list = \[\.\.\.savedCards\]\s*\n\s*\.filter/.test(jc));

ok('JobCards: the newest card is an O(n) max, not a full copy+sort per render',
  !/lastCardRef\.current = \[\.\.\.\(savedCards \|\| \[\]\)\]\.sort/.test(jc));

ok('SearchSelect: haystacks keyed on OPTIONS, not on the inline searchText fn',
  /useMemo\(\s*\(\) => options\.map/.test(sel) && /searchTextRef/.test(sel));

// The killer pattern: a .filter() whose callback calls another .filter() over a
// different array. That is the O(n·m) signature.
const NESTED = /\.filter\(\([^)]*\) => [^\n]*\b(invoices|jobCards|customers|inventory)\.filter\(/;
const offenders = [];
['components/vehicles/VehiclesModule.jsx', 'components/customers/CustomersModule.jsx',
  'components/billing/BillingModule.jsx'].forEach((f) => {
  read(f).split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    if (NESTED.test(code)) offenders.push(`${f}:${i + 1}`);
  });
});
ok('NO filter callback rescans another array (the O(n·m) signature)',
  offenders.length === 0,
  offenders.length ? `nested scans:\n         ${offenders.join('\n         ')}` : '');

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
