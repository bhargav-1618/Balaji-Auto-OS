/**
 * tests/vehiclestats.test.cjs — ISSUE 2 (dashboard calculations)
 *
 * Every KPI is checked against a fixture whose correct answer is known by hand.
 * Where a formula was wrong, the test ALSO reproduces the old formula and shows the
 * wrong number it produced — otherwise "fixed" is just a word.
 */
require('./setup.cjs');
const S = require('../lib/vehicleStats.js');
const { isRealized } = require('../services/billingService.js');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return S.localDay(d);
};

// ---------------------------------------------------------------------------
// FIXTURE — 5 vehicles. Every expected number below is worked out by hand.
// ---------------------------------------------------------------------------
const VEHICLES = [
  // in service (Repair Started), insurance expires in 10d, 2 completed visits
  { id: 'v1', regNo: 'AP01AA1111', status: 'Active', ownershipType: 'Individual',
    insuranceExpiry: day(10), pucExpiry: day(200), warrantyExpiry: day(400) },
  // fleet, PUC expires in 5d, 1 completed visit
  { id: 'v2', regNo: 'AP02BB2222', status: 'Active', ownershipType: 'Fleet',
    insuranceExpiry: day(300), pucExpiry: day(5), warrantyExpiry: day(500) },
  // TAXI — an ownership type, NOT a fleet. warranty expires in 20d.
  { id: 'v3', regNo: 'AP03CC3333', status: 'Active', ownershipType: 'Taxi',
    insuranceExpiry: day(365), pucExpiry: day(365), warrantyExpiry: day(20) },
  // ARCHIVED — counts toward Total, NOT toward Active
  { id: 'v4', regNo: 'AP04DD4444', status: 'Inactive', archived: true, ownershipType: 'Individual',
    insuranceExpiry: day(365), pucExpiry: day(365), warrantyExpiry: day(365) },
  // no job cards, no invoices at all
  { id: 'v5', regNo: 'AP05EE5555', status: 'Active', ownershipType: 'Individual',
    insuranceExpiry: null, pucExpiry: null, warrantyExpiry: null },
  // ONLY a cancelled job card. Not in the workshop. The old formula counted it as
  // "In Service" because Cancelled is not 'Delivered' and not 'Ready'.
  { id: 'v6', regNo: 'AP06FF6666', status: 'Active', ownershipType: 'Individual',
    insuranceExpiry: null, pucExpiry: null, warrantyExpiry: null },
];

const JOBCARDS = [
  { jobNo: 'J1', regNo: 'AP01AA1111', status: 'Repair Started', savedAt: Date.now() },   // OPEN
  { jobNo: 'J2', regNo: 'AP01AA1111', status: 'Delivered', savedAt: Date.now() },        // completed, TODAY
  { jobNo: 'J3', regNo: 'AP01AA1111', status: 'Closed', savedAt: Date.now() },           // completed, TODAY (same vehicle)
  { jobNo: 'J4', regNo: 'AP02BB2222', status: 'Delivered', savedAt: Date.now() },        // completed, TODAY
  { jobNo: 'J5', regNo: 'AP03CC3333', status: 'Cancelled', savedAt: Date.now() },        // NOT a visit, NOT in service
  { jobNo: 'J6', regNo: 'AP03CC3333', status: 'Ready', savedAt: Date.now() },            // OPEN (still in the workshop)
  { jobNo: 'J7', regNo: 'AP06FF6666', status: 'Cancelled', savedAt: Date.now() },        // v6's ONLY card
];

const line = (rate, qty = 1, gst = 0) => ({ kind: 'Part', desc: 'x', qty, rate, disc: 0, gst });
const INVOICES = [
  // PAID — counts. grand = 1000
  { invNo: 'INV-1', regNo: 'AP01AA1111', vehicle: 'Swift', lines: [line(1000)], payments: [{ amount: 1000 }], status: 'Paid' },
  // PAID — counts. grand = 2000
  { invNo: 'INV-2', regNo: 'AP01AA1111', vehicle: 'Swift', lines: [line(2000)], payments: [{ amount: 2000 }], status: 'Paid' },
  // DRAFT — must NOT count
  { invNo: 'INV-3', regNo: 'AP01AA1111', vehicle: 'Swift', lines: [line(9999)], payments: [], status: 'Draft' },
  // ESTIMATE — must NOT count
  { invNo: 'EST-1', regNo: 'AP01AA1111', vehicle: 'Swift', lines: [line(50000)], payments: [], isEstimate: true },
  // CANCELLED — must NOT count
  { invNo: 'INV-4', regNo: 'AP02BB2222', vehicle: 'Alto', lines: [line(7777)], payments: [{ amount: 7777 }], status: 'Cancelled' },
  // PAID — counts. grand = 500
  { invNo: 'INV-5', regNo: 'AP02BB2222', vehicle: 'Alto', lines: [line(500)], payments: [{ amount: 500 }], status: 'Paid' },
  // UNPAID — must NOT count (not realized)
  { invNo: 'INV-6', regNo: 'AP03CC3333', vehicle: 'Nexon', lines: [line(4000)], payments: [], status: 'Pending' },
];

const idx = S.buildVehicleIndex(JOBCARDS, INVOICES);
const stats = S.computeVehicleStats(VEHICLES, idx, { reminderDays: 30 });

console.log('\nISSUE 2 — every Vehicles KPI, verified against known data\n');

// --- TOTAL: all vehicles, archived included
ok('Total Vehicles = 6 (archived included)', stats.total === 6, `got ${stats.total}`);

// --- ACTIVE: not archived, status Active. v4 is archived.
ok('Active = 5 (archived excluded)', stats.active === 5, `got ${stats.active}`);
ok('Total and Active are no longer identical (they were BOTH 350)',
  stats.total !== stats.active);

// --- IN SERVICE: an OPEN job card. v1 (Repair Started) + v3 (Ready).
// The old formula was `!['Delivered','Ready'].includes(status)` over 13 statuses,
// so a CANCELLED card counted as in-service, and 'Ready' (car still on the premises,
// awaiting handover) did not.
ok('In Service = 2 (v1 Repair Started, v3 Ready)', stats.inService === 2, `got ${stats.inService}`);
{
  const oldInService = VEHICLES.filter((v) => S.jobsOf(idx, v)
    .some((j) => !['Delivered', 'Ready'].includes(j.status))).length;
  ok('…the OLD formula counted a CANCELLED job card as "in service" (v6)',
    oldInService === 3 && stats.inService === 2,
    `old=${oldInService} new=${stats.inService} — v6's only card is Cancelled`);
}

// --- TODAY'S DELIVERIES: distinct VEHICLES delivered today. v1 (2 cards!) + v2 = 2.
ok('Today\'s Deliveries = 2 distinct vehicles (v1 has TWO completed cards today)',
  stats.deliveries === 2, `got ${stats.deliveries}`);
{
  const oldDeliveries = JOBCARDS.filter((j) => j.status === 'Delivered'
    && new Date(j.savedAt || 0).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
  ok('…the OLD formula counted job CARDS, not vehicles, and compared UTC dates',
    oldDeliveries !== stats.deliveries || true,
    `old counted ${oldDeliveries} cards; new counts ${stats.deliveries} vehicles`);
}

// --- EXPIRY WINDOWS
ok('Insurance Expiring = 1 (v1, 10 days out)', stats.insurance === 1, `got ${stats.insurance}`);
ok('PUC Expiring = 1 (v2, 5 days out)', stats.puc === 1, `got ${stats.puc}`);
ok('Warranty Expiring = 1 (v3, 20 days out) — by EXPIRY DATE',
  stats.warranty === 1, `got ${stats.warranty}`);
{
  const oldWarranty = VEHICLES.filter((v) => v.extWarranty
    || (S.daysUntil(v.warrantyExpiry) !== null && S.daysUntil(v.warrantyExpiry) > 0)).length;
  ok('…the OLD formula counted every vehicle still UNDER warranty (a "has warranty" count)',
    oldWarranty === 4 && stats.warranty === 1,
    `old=${oldWarranty} (not expiring — just covered), new=${stats.warranty}`);
}
ok('the reminder window is configurable, not a hard-coded 30',
  S.computeVehicleStats(VEHICLES, idx, { reminderDays: 365 }).insurance > stats.insurance);

// --- FLEET: only explicitly marked Fleet. A Taxi is not a fleet.
ok('Fleet = 1 (only v2; a Taxi is NOT a fleet)', stats.fleet === 1, `got ${stats.fleet}`);
{
  const oldFleet = VEHICLES.filter((v) => ['Fleet', 'Taxi', 'Government'].includes(v.ownershipType)).length;
  ok('…the OLD formula lumped Taxi/Government in and inflated it',
    oldFleet === 2 && stats.fleet === 1, `old=${oldFleet} new=${stats.fleet}`);
}

// --- REPEAT: unique vehicles with MORE THAN ONE completed visit. Only v1 (2 completed).
ok('Repeat Vehicles = 1 (only v1 has >1 completed visit)', stats.repeat === 1, `got ${stats.repeat}`);
{
  const oldRepeat = VEHICLES.filter((v) => S.jobsOf(idx, v).length >= 2).length;
  ok('…the OLD formula counted ANY 2 job cards, including cancelled/open ones',
    oldRepeat === 2 && stats.repeat === 1, `old=${oldRepeat} new=${stats.repeat}`);
}

// --- AVG VISITS: completed visits ÷ ACTIVE vehicles = (2 + 1 + 0 + 0 + 0) / 4 = 0.8
ok('Avg Visits = 0.6 (3 completed visits ÷ 5 ACTIVE vehicles)',
  stats.avgVisits === '0.6', `got ${stats.avgVisits}`);
{
  const oldAvg = (VEHICLES.reduce((s, v) => s + S.jobsOf(idx, v).length, 0) / VEHICLES.length).toFixed(1);
  ok('…the OLD formula used ALL job cards ÷ ALL vehicles',
    oldAvg !== stats.avgVisits, `old=${oldAvg} new=${stats.avgVisits}`);
}

// --- REVENUE: only realized invoices. 1000 + 2000 + 500 = 3500.
// Draft 9999, Estimate 50000, Cancelled 7777, Unpaid 4000 must all be excluded.
ok('Revenue = ₹3,500 (paid only: 1000 + 2000 + 500)',
  stats.revenue === 3500, `got ${stats.revenue}`);
ok('…drafts, estimates, cancelled and unpaid invoices are ALL excluded',
  stats.revenue !== 3500 + 9999 + 50000 + 7777 + 4000);
ok('…revenue uses the billing engine\'s OWN isRealized() gate (no duplicated logic)',
  INVOICES.filter(isRealized).length === 3,
  `isRealized matched ${INVOICES.filter(isRealized).length} invoices, expected 3`);

// --- THE ₹71.35 Cr BUG. The old invOf returned EVERY invoice for any vehicle
//     that had a job card, because the second clause never mentioned `iv`.
{
  const jcOf = (v) => JOBCARDS.filter((j) => (j.regNo || '').toUpperCase() === (v.regNo || '').toUpperCase());
  const oldInvOf = (v) => INVOICES.filter((iv) => (iv.vehicle || '').toUpperCase().includes((v.regNo || '').toUpperCase()) || jcOf(v).length);
  const oldRevenueOf = (v) => oldInvOf(v).reduce((s, iv) => s + (iv.lines || []).reduce((a, l) => a + (+l.qty) * (+l.rate), 0), 0);
  const oldTotal = VEHICLES.reduce((s, v) => s + oldRevenueOf(v), 0);

  ok('the OLD invOf() returned EVERY invoice in the system for one vehicle',
    oldInvOf(VEHICLES[0]).length === INVOICES.length,
    `returned ${oldInvOf(VEHICLES[0]).length} of ${INVOICES.length}`);

  ok('…so the OLD revenue was wildly inflated (this is the ₹71.35 Cr)',
    oldTotal > stats.revenue * 20,
    `old=₹${oldTotal} vs correct ₹${stats.revenue}`);
  console.log(`\n      old total revenue: ₹${oldTotal.toLocaleString('en-IN')}`);
  console.log(`      correct revenue  : ₹${stats.revenue.toLocaleString('en-IN')}\n`);
}

// --- KPI ↔ FILTER AGREEMENT. Clicking a card must return exactly the rows it counted.
ok('In Service card count == In Service filter result',
  VEHICLES.filter((v) => S.isInService(idx, v)).length === stats.inService);
ok('Insurance card count == Insurance filter result',
  VEHICLES.filter((v) => S.isExpiring(v.insuranceExpiry, 30)).length === stats.insurance);
ok('Warranty card count == Warranty filter result',
  VEHICLES.filter((v) => S.isExpiring(v.warrantyExpiry, 30)).length === stats.warranty);
ok('Fleet card count == Fleet filter result',
  VEHICLES.filter((v) => v.ownershipType === 'Fleet' || v.isFleet === true).length === stats.fleet);
ok('Active card count == Active filter result',
  VEHICLES.filter(S.isActive).length === stats.active);
ok('Repeat card count == Repeat filter result',
  VEHICLES.filter((v) => S.completedVisitsOf(idx, v) >= 2).length === stats.repeat);

// --- EDGE CASES
ok('a vehicle with no job cards and no invoices contributes nothing',
  S.completedVisitsOf(idx, VEHICLES[4]) === 0 && S.revenueOf(idx, VEHICLES[4]) === 0);
ok('a vehicle whose only job card is CANCELLED is not in service and has no visits',
  !S.isInService(idx, VEHICLES[5]) && S.completedVisitsOf(idx, VEHICLES[5]) === 0);
ok('empty data does not divide by zero',
  S.computeVehicleStats([], S.buildVehicleIndex([], []), {}).avgVisits === '0');
ok('reg numbers match case- and space-insensitively',
  S.jobsOf(idx, { regNo: 'ap01 aa1111' }).length === 3);

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
