/**
 * tests/production-dropdown-consistency.test.cjs
 *
 * Production-dropdown pass: Customer Type, State, and every vehicle-related dropdown
 * (Manufacturer/Model — already MiniSelect — plus Fuel Type/Transmission/Make filter,
 * which were still native <select>) now share the ONE MiniSelect implementation, so
 * search/scroll/keyboard/mouse/clear/cancel/mobile behavior is identical everywhere,
 * instead of native <select> (which on mobile opens as a full-screen OS picker — the
 * literal "excessively tall... full-screen list" complaint).
 *
 * Root cause for Customer Type specifically: a plain <select> with 17 options. Native
 * selects aren't length-capped or scrollable by CSS (the browser/OS renders the popup),
 * so there was no way to make it "compact" without changing the widget itself.
 *
 * Root cause for State: no dropdown existed at all — free-text <input>, and no
 * Indian-states master list existed anywhere in the codebase to back one.
 *
 * Root cause for Fuel Type/Transmission/Make-filter drift: JobCardModule.jsx hardcoded
 * an inline fuel array (missing 'LPG') instead of importing the shared FUELS constant
 * from lib/vehicleCatalog.js — the exact "separate list per module" problem the
 * Manufacturer master already solved elsewhere.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const R = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nProduction dropdown consistency — Customer Type, State, Vehicle dropdowns\n');

const cust = R('components/customers/CustomersModule.jsx');
const jc = R('components/jobcards/JobCardModule.jsx');
const veh = R('components/vehicles/VehiclesModule.jsx');
const miniSelect = R('components/common/MiniSelect.jsx');
const catalog = R('lib/vehicleCatalog.js');

// --- Customer Type: compact searchable MiniSelect, options unchanged ---
// Batch 4D: every MiniSelect inside a modal now also carries boundaryRef={modalRef}
// (see DropdownPanel's useAnchoredPosition) so its panel height is clamped to the
// MODAL's own bottom edge, not the full browser viewport — the fix for dropdowns
// that could render past a modal's own footer. Assertions below allow (but don't
// require) that trailing prop rather than an exact `/>` match.
ok('Add/Edit Customer form: Customer Type is now MiniSelect, not native <select>',
  /<MiniSelect value=\{f\.type\} placeholder="Select customer type" options=\{TYPES\} onPick=\{\(t\) => set\(\{ type: t \}\)\}[\s\S]{0,40}\/>/.test(cust));
ok('all 17 existing customer types are preserved (BASE_TYPES unchanged, none removed)',
  /const BASE_TYPES = \['Individual', 'Family', 'Walk-in', 'Repeat Customer', 'Corporate', 'Fleet Owner', 'Taxi \/ Cab Operator', 'Travel Agency', 'Government', 'Educational Institution', 'Insurance Company', 'Dealer', 'Workshop Partner', 'VIP', 'Cash Customer', 'Credit Customer', 'Other'\]/.test(cust));
ok('toolbar Customer Type filter is also MiniSelect (same widget, not module-specific)',
  /<MiniSelect value=\{typeF\} placeholder=\{t\('customers\.filter\.allTypes', 'All Customer Types'\)\} options=\{\['All', \.\.\.TYPES\]\}/.test(cust));

// --- MiniSelect scales to a compact, capped-height, scrollable panel (already true via
// DropdownPanel.MAX_PANEL_H — guard it stays that way since 17+ options now render there) ---
ok('MiniSelect panel height is capped (DropdownPanel.MAX_PANEL_H), not an unbounded full list',
  /import DropdownPanel from '\.\/DropdownPanel'/.test(miniSelect));
const dropdownPanel = R('components/common/DropdownPanel.jsx');
ok('DropdownPanel caps panel height (~420px "required 350-450 band") and scrolls beyond it',
  /MAX_PANEL_H = 420/.test(dropdownPanel));

// --- State: real Indian States + UTs master list, searchable dropdown ---
const states = R('lib/indianStates.js');
ok('lib/indianStates.js exports INDIAN_STATES', /export const INDIAN_STATES = \[/.test(states));
const stateCount = (states.match(/^\s*'[^']+',?$/gm) || []).length;
ok('INDIAN_STATES has the complete official count: 28 States + 8 Union Territories = 36',
  stateCount === 36, `found ${stateCount}`);
['Andhra Pradesh', 'Telangana', 'Ladakh', 'Jammu and Kashmir', 'Delhi', 'Puducherry', 'Dadra and Nagar Haveli and Daman and Diu'].forEach((s) => {
  ok(`INDIAN_STATES includes "${s}"`, states.includes(`'${s}'`));
});
ok('Address State field uses MiniSelect backed by INDIAN_STATES (was free-text input)',
  /<MiniSelect value=\{f\.state\} placeholder="Select state" options=\{INDIAN_STATES\}/.test(cust));
// Batch 4 Defect 3: State picking now also clears District/City/Area (the cascade's
// downstream levels), not just the state itself — still keeps its onAdd escape hatch.
ok('State keeps an onAdd escape hatch for rare non-standard entries, and clears the cascade below it',
  /options=\{INDIAN_STATES\} onPick=\{\(s\) => set\(\{ state: s, district: '', city: '', area: '' \}\)\} onAdd=\{\(name\) => set\(\{ state: name, district: '', city: '', area: '' \}\)\}/.test(cust));
// Batch 4 Defect 3: City/District are no longer free text. No exhaustive India-wide
// master dataset exists (or reasonably could) — but hand-rolling a partial one was
// worse than the alternative actually chosen: each level's MiniSelect options are
// DERIVED from what other customers already recorded under the same parent (State ->
// District -> City -> Area), real data that starts working immediately and improves
// as more customers are added, with onAdd still letting a genuinely new value through.
ok('City/District are cascading MiniSelects (State -> District -> City -> Area), disabled until their parent is chosen, not free text',
  /<MiniSelect value=\{f\.district\} placeholder=\{f\.state \? 'Select or type district' : 'Select state first'\} disabled=\{!f\.state\}/.test(cust) &&
  /<MiniSelect value=\{f\.city\} placeholder=\{f\.district \? 'Select or type city' : 'Select district first'\} disabled=\{!f\.district\}/.test(cust));
ok('Country still defaults to India (emptyCustomer)', /country: 'India'/.test(cust));

// --- Manufacturer master: cleaned up, centralized, no data loss ---
ok('Ashok Leyland removed from vehicle catalog (truck/bus manufacturer, no passenger models)',
  !/'Ashok Leyland'/.test(catalog));
ok('Eicher removed from vehicle catalog (truck/bus manufacturer, no passenger models)',
  !/^\s*Eicher:/m.test(catalog));
ok('Force trimmed to its genuine passenger model only (Gurkha) — Urbania/Traveller (minibus/van) dropped',
  /Force: \['Gurkha'\]/.test(catalog));
ok('Isuzu (D-Max/MU-X — genuine passenger SUVs/pickups sold in India) is preserved',
  /Isuzu: \['D-Max V-Cross', 'MU-X', 'Hi-Lander'\]/.test(catalog));
ok('legacy/discontinued brands still serviced by garages are preserved (no data loss for existing vehicle records)',
  /Fiat:/.test(catalog) && /Chevrolet:/.test(catalog) && /'HM Ambassador':/.test(catalog));
ok('MAKES is still derived from VEHICLES (single source of truth, not a separate list)',
  /export const MAKES = Object\.keys\(VEHICLES\)/.test(catalog));

// --- Fuel Type / Transmission: same widget + same shared data everywhere ---
ok('Job Card Fuel Type now imports the shared FUELS constant (was a hardcoded inline array missing LPG)',
  /import \{ VEHICLES, FUELS \} from '\.\.\/\.\.\/lib\/vehicleCatalog'/.test(jc));
ok('Job Card Fuel Type field uses MiniSelect with the shared FUELS list',
  /<MiniSelect value=\{card\.fuel \|\| 'Petrol'\} placeholder="Fuel Type" options=\{FUELS\}/.test(jc));
ok('Customers multi-vehicle step: Fuel/Transmission use MiniSelect',
  /<MiniSelect value=\{v\.fuel \|\| 'Petrol'\} placeholder="Fuel" options=\{FUELS\}/.test(cust) &&
  /<MiniSelect value=\{v\.transmission \|\| 'Manual'\} placeholder="Transmission" options=\{TRANSMISSIONS\}/.test(cust));
ok('Customers standalone VehicleModal: Fuel/Transmission use MiniSelect',
  /<MiniSelect value=\{f\.fuel \|\| 'Petrol'\} placeholder="Fuel" options=\{FUELS\} onPick=\{\(t\) => set\(\{ fuel: t \|\| 'Petrol' \}\)\}[\s\S]{0,40}\/>/.test(cust));
ok('Vehicles module wizard: Fuel/Transmission use MiniSelect',
  /<MiniSelect value=\{f\.fuel \|\| 'Petrol'\} placeholder="Fuel" options=\{FUELS\}/.test(veh) &&
  /<MiniSelect value=\{f\.transmission \|\| 'Manual'\} placeholder="Transmission" options=\{TRANSMISSIONS\}/.test(veh));
ok('Vehicles module Fuel filter still sets isEV alongside fuel (side effect preserved through the widget swap)',
  /isEV: v === 'Electric'/.test(veh));
ok('Vehicles toolbar Make/Fuel filters use MiniSelect',
  /<MiniSelect value=\{makeF\} placeholder=\{t\('vehicles\.filter\.allMakes', 'All Makes'\)\} options=\{makes\}/.test(veh) &&
  /<MiniSelect value=\{fuelF\} placeholder=\{t\('vehicles\.filter\.allFuels', 'All Fuels'\)\} options=\{\['All', \.\.\.FUELS\]\}/.test(veh));

// --- MiniSelect: clear-button sentinel fallback doesn't corrupt a required/defaulted field ---
ok('Fuel MiniSelects fall back to a valid default on clear, never leaving the field blank',
  (jc.match(/onPick=\{\(t\) => set\(\{ fuel: t \|\| 'Petrol' \}\)\}/g) || []).length >= 1);

// --- MiniSelect: optional `labels` map for filter "All" sentinels (new, backward-compatible) ---
ok('MiniSelect supports an optional labels map without changing the default (unlabeled) behavior',
  /const labelOf = \(o\) => \(labels && labels\[o\]\) \|\| o;/.test(miniSelect));
ok('search matches against both the label and the raw value',
  /labelOf\(o\)\.toLowerCase\(\)\.includes\(l\) \|\| o\.toLowerCase\(\)\.includes\(l\)/.test(miniSelect));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
