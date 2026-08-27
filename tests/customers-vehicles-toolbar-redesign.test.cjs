/**
 * tests/customers-vehicles-toolbar-redesign.test.cjs
 *
 * CUSTOMERS & VEHICLES DASHBOARD SEARCH/FILTER TOOLBAR LAYOUT.
 *
 * Before: a single row held the search box AND every filter/sort/export/action
 * control together. That forced a running tug-of-war between the search box's width
 * and everything else in the row — three separate prior fixes (see
 * customer-dashboard-layout.test.cjs, customer-search-placeholder.test.cjs) had to add
 * a max-width cap, a min-width guard, and flex-wrap just to keep the search
 * placeholder from truncating while the filter controls stayed usable.
 *
 * After: two rows.
 *   Row 1 — search box alone, always full width. No cap needed: nothing else shares
 *     the row, so there's nothing to fight over.
 *   Row 2 — every filter dropdown, the sort dropdown (Vehicles), Export, and the
 *     primary action button (New Customer / Add Vehicle), wrapping freely.
 * Same two-row pattern in both modules, for consistency. No business logic, data, or
 * filtering/sorting/export behavior changed — this is layout-only.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nCustomers & Vehicles — toolbar redesign (Row 1 search, Row 2 filters)\n');

// --- Customers ---
{
  const src = read('components/customers/CustomersModule.jsx');
  const start = src.indexOf("{/* Toolbar — REDESIGNED");
  const block = src.slice(start, start + 6200);

  ok('Customers: Row 1 is a standalone full-width search box (own div, no filters alongside it)',
    /<div className="mb-2\.5">\s*\n\s*<div className="relative">\s*\n\s*<Search size=\{14\}/.test(block));
  ok('Customers: search input is unconditionally full-width (w-full), no max-w/min-w cap',
    /className=\{`\$\{inputCls\} pl-9 w-full`\}/.test(block));
  ok('Customers: Row 2 is a separate wrapping flex row for filters/export/action',
    /<div className="flex flex-wrap gap-2\.5">/.test(block));
  ok('Customers: Row 2 still has the Customer Type filter, Status filter, Export, and New Customer — nothing dropped',
    /<MiniSelect value=\{typeF\}/.test(block) && /<select value=\{statusF\}/.test(block) && /onClick=\{exportCSV\}/.test(block) && /New Customer/.test(block));
  ok('Customers: Customer Type filter sits in a parent-driven grid track (min 13rem) so its long "All Customer Types" label never truncates',
    /gridTemplateColumns: 'repeat\(auto-fit, minmax\(13rem, 1fr\)\)'/.test(block));
}

// --- Vehicles ---
{
  const src = read('components/vehicles/VehiclesModule.jsx');
  const start = src.indexOf("{/* Toolbar — REDESIGNED");
  const block = src.slice(start, start + 6200);

  ok('Vehicles: Row 1 is a standalone full-width search box (own div, no filters alongside it)',
    /<div className="mb-2\.5">\s*\n\s*<div className="relative">\s*\n\s*<Search size=\{14\}/.test(block));
  ok('Vehicles: search input is unconditionally full-width (w-full), no max-w/min-w cap',
    /className=\{`\$\{inputCls\} pl-9 w-full`\}/.test(block));
  ok('Vehicles: Row 2 is a separate wrapping flex row for filters/sort/export/action',
    /<div className="flex flex-wrap gap-2 mb-3">/.test(block));
  ok('Vehicles: Row 2 still has Make/Fuel/Status filters, the Sort dropdown, Export, and Add Vehicle — nothing dropped',
    /<MiniSelect value=\{makeF\}/.test(block) && /<MiniSelect value=\{fuelF\}/.test(block) && /<select value=\{statusF\}/.test(block) && /<select value=\{sortBy\}/.test(block) && /onClick=\{exportCSV\}/.test(block) && /Add Vehicle/.test(block));
}

// --- Consistency between the two modules ---
{
  const cust = read('components/customers/CustomersModule.jsx');
  const veh = read('components/vehicles/VehiclesModule.jsx');
  ok('Both modules use the identical Row-1 search markup shape (same redesign pattern, not two divergent implementations)',
    /<div className="mb-2\.5">\s*\n\s*<div className="relative">/.test(cust) && /<div className="mb-2\.5">\s*\n\s*<div className="relative">/.test(veh));
  ok('Both modules put filters/export/action in a plain flex-wrap row (no leftover flex-col/sm:flex-row single-row toolbar)',
    !/flex flex-col sm:flex-row sm:flex-wrap gap-2\.5/.test(cust) && !/flex flex-col sm:flex-row sm:flex-wrap gap-2 mb-3/.test(veh));
}

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
