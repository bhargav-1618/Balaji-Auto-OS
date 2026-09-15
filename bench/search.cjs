/**
 * bench/search.cjs — MEASURE, don't guess.
 *
 * Reproduces the vehicle search/filter/sort work at the real dataset size shown in the
 * app ("2,529 records", 350 vehicles) and times each stage.
 */
require('../tests/setup.cjs');
const S = require('../lib/vehicleStats.js');

const N_VEH = 350;
const N_JOBS = 1400;
const N_INV = 1129;

const rnd = (n) => Math.floor(Math.random() * n);
const MAKES = ['Maruti', 'Hyundai', 'Tata', 'Mahindra', 'Kia', 'Honda', 'Toyota', 'Renault'];
const MODELS = ['Swift', 'Baleno', 'Nexon', 'Thar', 'Seltos', 'City', 'Innova', 'Kwid'];

const vehicles = Array.from({ length: N_VEH }, (_, i) => ({
  id: `v${i}`,
  regNo: `AP${String(i % 40).padStart(2, '0')}XY${String(1000 + i)}`,
  make: MAKES[i % MAKES.length],
  model: MODELS[i % MODELS.length],
  variant: 'ZXi',
  vin: `VIN${i}${'X'.repeat(10)}`,
  engineNo: `ENG${i}${'Y'.repeat(8)}`,
  owner: `Owner ${i}`,
  ownerPhone: `98${String(10000000 + i)}`,
  fuel: i % 2 ? 'Petrol' : 'Diesel',
  transmission: 'Manual',
  insurer: 'Bajaj Allianz',
  rcNumber: `RC${i}`,
  tags: 'tag',
  status: 'Active',
  ownershipType: i % 10 === 0 ? 'Fleet' : 'Individual',
  insuranceExpiry: '2026-09-01',
  pucExpiry: '2026-08-01',
  warrantyExpiry: '2027-01-01',
  createdAt: i,
}));

const jobCards = Array.from({ length: N_JOBS }, (_, i) => ({
  jobNo: `JC-${i}`,
  regNo: vehicles[i % N_VEH].regNo,
  status: ['Delivered', 'Closed', 'Repair Started', 'Ready', 'Cancelled'][i % 5],
  savedAt: Date.now(),
}));

const invoices = Array.from({ length: N_INV }, (_, i) => ({
  invNo: `INV-${i}`,
  regNo: vehicles[i % N_VEH].regNo,
  vehicle: vehicles[i % N_VEH].model,
  lines: [{ kind: 'Part', qty: 2, rate: 1500, disc: 0, gst: 18 }],
  payments: [{ amount: 3540 }],
  status: 'Paid',
}));

const time = (label, fn, iters = 1) => {
  fn(); // warm
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i += 1) fn();
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1e6 / iters;
  console.log(`  ${label.padEnd(52)} ${ms.toFixed(2)} ms`);
  return ms;
};

console.log(`\nDataset: ${N_VEH} vehicles · ${N_JOBS} job cards · ${N_INV} invoices\n`);

// ---------------------------------------------------------------------------
// THE OLD CODE — jcOf/invOf rescanning the whole array per vehicle.
// ---------------------------------------------------------------------------
console.log('OLD (pre-index) — a full rescan per vehicle:');

const oldJcOf = (v) => jobCards.filter((j) => (j.regNo || '').toUpperCase() === (v.regNo || '').toUpperCase());
const oldInvOf = (v) => invoices.filter((iv) => (iv.vehicle || '').toUpperCase().includes((v.regNo || '').toUpperCase()) || oldJcOf(v).length);

// The search haystack, rebuilt for EVERY row on EVERY keystroke.
const oldSearch = (ql) => vehicles.filter((r) => {
  const jobNos = oldJcOf(r).map((j) => j.jobNo);
  const invNos = oldInvOf(r).map((iv) => iv.invNo);
  return [r.regNo, r.vin, r.engineNo, r.owner, r.ownerPhone, r.make, r.model, r.variant,
    r.fuel, r.transmission, r.insurer, r.rcNumber, r.tags, ...jobNos, ...invNos]
    .filter(Boolean).join(' ').toLowerCase().includes(ql);
});

const oldMs = time('one keystroke: filter with search text', () => oldSearch('swift'));

// ---------------------------------------------------------------------------
// THE NEW CODE — index once, then a plain substring test.
// ---------------------------------------------------------------------------
console.log('\nNEW (indexed):');

const idx = S.buildVehicleIndex(jobCards, invoices);
time('buildVehicleIndex (once per data change)', () => S.buildVehicleIndex(jobCards, invoices));

// Precomputed haystack, built once per data change — not per keystroke.
const haystacks = new Map();
const buildHaystacks = () => {
  haystacks.clear();
  vehicles.forEach((r) => {
    const jobNos = S.jobsOf(idx, r).map((j) => j.jobNo);
    const invNos = S.invoicesOf(idx, r).map((iv) => iv.invNo);
    haystacks.set(r.id, [r.regNo, r.vin, r.engineNo, r.owner, r.ownerPhone, r.make, r.model,
      r.variant, r.fuel, r.transmission, r.insurer, r.rcNumber, r.tags, ...jobNos, ...invNos]
      .filter(Boolean).join(' ').toLowerCase());
  });
};
time('build search haystacks (once per data change)', buildHaystacks);

const newMs = time('one keystroke: filter with search text',
  () => vehicles.filter((r) => haystacks.get(r.id).includes('swift')), 20);

console.log(`\n  → per-keystroke work: ${oldMs.toFixed(2)} ms  →  ${newMs.toFixed(2)} ms   (${(oldMs / newMs).toFixed(0)}× faster)`);
console.log(`  → a 60fps frame is 16.7 ms. Old was ${(oldMs / 16.7).toFixed(1)} frames of blocked main thread PER KEYSTROKE.\n`);
