/**
 * tests/vehicle-service.test.cjs — Medium finding: test coverage.
 *
 * services/vehicleService.js's H-5C exports (primaryVehicle,
 * withVehicleDefaults, findVehicleIndex, buildVehicleHistoryUpdate,
 * topVehicleBrands, buildJobCardDraftFields, buildInvoicePrefillFields) were
 * extracted out of InventoryDashboard.js during earlier remediation but never
 * got a permanent unit test of their own — only ad-hoc scratchpad checks at
 * the time.
 */
require('./setup.cjs');
const {
  primaryVehicle, withVehicleDefaults, findVehicleIndex, buildVehicleHistoryUpdate,
  topVehicleBrands, buildJobCardDraftFields, buildInvoicePrefillFields,
} = require('../services/vehicleService.js');

let PASS = 0, FAIL = 0;
const ok = (n, c) => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}`); } };

console.log('\nprimaryVehicle / withVehicleDefaults\n');
ok('first vehicle returned', primaryVehicle({ vehicles: [{ regNo: 'A' }, { regNo: 'B' }] }).regNo === 'A');
ok('no vehicles -> {}', JSON.stringify(primaryVehicle({ vehicles: [] })) === '{}');
ok('no customer arg -> {}', JSON.stringify(primaryVehicle()) === '{}');
ok('withVehicleDefaults sets status Active when absent', withVehicleDefaults({ regNo: 'X' }).status === 'Active');
ok('withVehicleDefaults preserves an explicit status (wins over default)', withVehicleDefaults({ regNo: 'X', status: 'Archived' }).status === 'Archived');

console.log('\nfindVehicleIndex — regNo match, label fallback\n');
{
  const vs = [{ regNo: 'AP01AB1234' }, { regNo: 'AP02CD5678' }, { brand: 'Honda', model: 'City' }];
  ok('match by exact regNo', findVehicleIndex(vs, { reg: 'AP02CD5678', label: '' }) === 1);
  ok('match by brand+model label fallback (no reg)', findVehicleIndex(vs, { reg: '', label: 'Honda City' }) === 2);
  ok('no match -> -1', findVehicleIndex(vs, { reg: 'ZZ99ZZ9999', label: '' }) === -1);
  ok('empty vehicles list -> -1', findVehicleIndex([], { reg: 'X', label: '' }) === -1);
}

console.log('\nbuildVehicleHistoryUpdate — service-visit rollup\n');
{
  const NOW = Date.parse('2026-07-28T00:00:00Z');
  const v = { totalSpend: 1000, serviceCount: 2, serviceHistory: [{ at: 1, invoiceNo: 'INV1', amount: 500 }] };
  const updated = buildVehicleHistoryUpdate(v, { invoiceNo: 'INV9', date: '2026-07-28', amount: 2500, odometer: 55000, maxHistory: 5, now: NOW });
  ok('totalSpend accumulates', updated.totalSpend === 3500);
  ok('serviceCount increments', updated.serviceCount === 3);
  ok('lastInvoiceNo updated', updated.lastInvoiceNo === 'INV9');
  ok('lastServiceDate uses the passed date', updated.lastServiceDate === '2026-07-28');
  ok('new history entry prepended (newest first)', updated.serviceHistory[0].invoiceNo === 'INV9' && updated.serviceHistory[1].invoiceNo === 'INV1');
  ok('history length grows by 1 when under the cap', updated.serviceHistory.length === 2);

  const vFull = { serviceHistory: [{ a: 1 }, { a: 2 }, { a: 3 }] };
  const capped = buildVehicleHistoryUpdate(vFull, { invoiceNo: 'X', date: '2026-07-28', amount: 10, maxHistory: 3, now: NOW });
  ok('history is capped at maxHistory', capped.serviceHistory.length === 3);

  const noDate = buildVehicleHistoryUpdate({}, { invoiceNo: 'X', amount: 0, now: NOW });
  ok('lastServiceDate falls back to now when no date given', noDate.lastServiceDate === new Date(NOW).toISOString().slice(0, 10));
}

console.log('\ntopVehicleBrands — sorted aggregation, respects limit\n');
{
  const customers = [
    { vehicles: [{ make: 'Honda' }, { make: 'Maruti' }] },
    { vehicles: [{ make: 'Honda' }, { vehicle: 'Toyota Fortuner' }] },
    { vehicles: [{}] },
  ];
  const mix = topVehicleBrands(customers, 8);
  ok('Honda (2 vehicles) sorts first', mix[0].label === 'Honda' && mix[0].value === 2);
  ok('vehicle without make falls back to first word of `vehicle`', mix.some((m) => m.label === 'Toyota'));
  ok('vehicle with neither make nor vehicle -> "Other"', mix.some((m) => m.label === 'Other'));
  ok('limit is respected', topVehicleBrands(customers, 1).length === 1);
  ok('empty customers -> []', topVehicleBrands([], 8).length === 0);
}

console.log('\nbuildJobCardDraftFields / buildInvoicePrefillFields — mapping\n');
{
  const c = { id: 'c1', name: 'Suresh', phone: '9000000000', altPhone: '', address: 'MG Road' };
  const v = { make: 'Honda', model: 'City VX', regNo: 'KA01AB1234', vin: 'VIN123', engineNo: 'ENG1', fuel: 'Diesel', odometer: 12000 };
  const draft = buildJobCardDraftFields(c, v);
  ok('draft carries every vehicle field', draft.regNo === 'KA01AB1234' && draft.vin === 'VIN123' && draft.engineNo === 'ENG1' && draft.fuel === 'Diesel' && draft.odometer === 12000);
  ok('draft combines make+model into the vehicle name', draft.vehicle === 'Honda City VX');
  ok('draft carries customer contact fields', draft.customerId === 'c1' && draft.customer === 'Suresh' && draft.phone === '9000000000');

  const emptyVehicleDraft = buildJobCardDraftFields(c, {});
  ok('fuel defaults to Petrol when the vehicle has none', emptyVehicleDraft.fuel === 'Petrol');
  ok('vehicle name empty string when there is no vehicle at all', emptyVehicleDraft.vehicle === '');

  const prefill = buildInvoicePrefillFields(c, v);
  ok('prefill carries regNo/make/model', prefill.regNo === 'KA01AB1234' && prefill.make === 'Honda' && prefill.model === 'City VX');
  ok('prefill vehicle field is just the model (not make+model)', prefill.vehicle === 'City VX');
  ok('prefill carries customer identity', prefill.customerId === 'c1' && prefill.customer === 'Suresh' && prefill.phone === '9000000000');
}

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
