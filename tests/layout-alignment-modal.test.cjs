/**
 * tests/layout-alignment-modal.test.cjs
 *
 * #54 — Details-panel / KPI-row top alignment. Both modules use the same two-column flex
 *       (xl:flex xl:items-start, left flex-[2], panel flex-[1]). The panel aligns to the top
 *       of that flex row. For the panel to align to the FIRST KPI ROW, the left column must
 *       START with the KPI grid in BOTH modules. Customers already did; Vehicles had a
 *       "Compliance · next N days" label+toggle row above its KPIs, pushing them below the
 *       panel top. Fix: that header row was moved ABOVE the two-column flex.
 *
 * #49 — Add/Edit modals could leave the viewport as content grew. Fixed by capping the
 *       modal to available space (dvh minus overlay padding) and making the overlay scroll.
 *
 * These check wiring; the pixel-perfect alignment must be confirmed in a browser.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const veh = fs.readFileSync(path.resolve(__dirname, '../components/vehicles/VehiclesModule.jsx'), 'utf8');
const cust = fs.readFileSync(path.resolve(__dirname, '../components/customers/CustomersModule.jsx'), 'utf8');

console.log('\n#54 panel/KPI alignment + #49 modal viewport containment\n');

// #54 — both modules share the two-column flex
ok('Vehicles uses the shared two-column flex (xl:flex xl:items-start)', /<div className="xl:flex xl:gap-4 xl:items-start">/.test(veh));
ok('Customers uses the shared two-column flex (xl:flex xl:items-start)', /<div className="xl:flex xl:gap-4 xl:items-start">/.test(cust));

// The compliance label + summary/business TOGGLE belong to the KPI dashboard (left column),
// as its header row — NOT above the two-column flex (which made the toggle float over the
// Vehicle Details panel). The panel aligns to the top of this row via xl:items-start.
const flexIdx = veh.indexOf('<div className="xl:flex xl:gap-4 xl:items-start">');
const afterFlex = veh.slice(flexIdx);
ok('Vehicles compliance label + summary toggle live INSIDE the left column (KPI dashboard)',
  /xl:flex-\[2_1_0%\] xl:min-w-0">[\s\S]{0,900}Compliance · next \{REMINDER_DAYS\} days[\s\S]{0,500}summary &amp; business/.test(afterFlex));
ok('the summary toggle is NOT placed above the two-column flex (would float over the panel)',
  !/days[\s\S]{0,400}summary &amp; business[\s\S]{0,80}<div className="xl:flex xl:gap-4 xl:items-start">/.test(veh));
ok('Vehicles left column: toggle row is followed by the COMPLIANCE KPI grid',
  /summary &amp; business[\s\S]{0,1100}COMPLIANCE — the cards that mean money[\s\S]{0,700}grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3/.test(afterFlex));

// Customers left column already starts with its KPI grid (reference/unchanged)
ok('Customers left column starts with its KPI grid (unchanged reference)',
  /xl:flex-\[2_1_0%\] xl:min-w-\[640px\]">[\s\S]{0,600}<div className="grid grid-cols-2 sm:grid-cols-3 gap-3\.5 mb-4">/.test(cust));

// Shared DetailsPanel column has no top offset on xl (aligns to flex top)
const dp = fs.readFileSync(path.resolve(__dirname, '../components/common/DetailsPanel.jsx'), 'utf8');
ok('DetailsPanel column has no xl top margin (xl:mt-0) so it aligns to the flex row top', /xl:mt-0/.test(dp));

// #49 — modal viewport containment, both wizards
ok('CustomerWizard modal is a fixed-height flex box capped to the viewport',
  /h-\[100dvh\] sm:h-auto max-h-\[100dvh\] sm:max-h-\[calc\(100dvh-2rem\)\] flex flex-col/.test(cust));
ok('CustomerWizard overlay does not scroll (header can never be pushed off-screen)',
  /flex items-end sm:items-center justify-center p-0 sm:p-4"/.test(cust));
ok('VehicleWizard modal is a fixed-height flex box capped to the viewport',
  /h-\[100dvh\] sm:h-auto max-h-\[100dvh\] sm:max-h-\[calc\(100dvh-2rem\)\] flex flex-col/.test(veh));
ok('VehicleWizard overlay does not scroll (header can never be pushed off-screen)',
  /flex items-end sm:items-center justify-center p-0 sm:p-4"/.test(veh));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
