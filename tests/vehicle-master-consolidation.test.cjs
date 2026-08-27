/**
 * tests/vehicle-master-consolidation.test.cjs
 *
 * Global Vehicle Master framework pass. Root cause: the Manufacturer->Model dropdown
 * pair was reimplemented by hand at FOUR separate call sites — Job Cards'
 * CascadeVehicleSelect, Vehicles module's Cascade, and two inline MiniSelect pairs in
 * Customers (the multi-vehicle wizard step, the standalone VehicleModal) — each with
 * its own `options={...}` / `disabled={!make}` wiring. All four already shared the
 * same underlying MiniSelect widget and the same lib/vehicleCatalog.js data, but the
 * DEPENDENCY LOGIC ("Model is disabled until Manufacturer is chosen, options come
 * from the chosen Manufacturer") was duplicated four times — meaning a future bug fix
 * to that rule would only apply wherever someone remembered to also make it, exactly
 * the kind of drift this review flags.
 *
 * Fix: extracted components/common/VehicleMakeModelSelect.jsx as the ONE production
 * Vehicle Master component. It owns the dependency rule and the default MAKES/VEHICLES
 * catalog; every call site now passes onPickMake/onPickModel (what should happen to
 * ITS OWN other fields — Variant, a combined "vehicle" string, a custom-vehicles
 * catalog merge) rather than re-declaring options/disabled itself. Variant stays
 * owned by each caller since their pre-existing Variant behaviors genuinely differ
 * (unifying that would be a business-logic change, not a duplication fix).
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const R = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nGlobal Vehicle Master consolidation — one component, four call sites\n');

const vmms = R('components/common/VehicleMakeModelSelect.jsx');
const jc = R('components/jobcards/JobCardModule.jsx');
const veh = R('components/vehicles/VehiclesModule.jsx');
const cust = R('components/customers/CustomersModule.jsx');

// --- The shared component itself ---
ok('VehicleMakeModelSelect defaults to the shared MAKES/VEHICLES catalog',
  /import \{ MAKES, VEHICLES \} from '\.\.\/\.\.\/lib\/vehicleCatalog'/.test(vmms) &&
  /makeOptions = MAKES/.test(vmms) && /modelsFor = \(m\) => VEHICLES\[m\] \|\| \[\]/.test(vmms));
ok('VehicleMakeModelSelect renders Manufacturer and Model via the shared MiniSelect (not a new widget)',
  (vmms.match(/<MiniSelect/g) || []).length === 2);
ok('Model is disabled until a Manufacturer is chosen — owned in exactly one place now',
  /disabled=\{!make\}/.test(vmms));
ok('callers control what a Make/Model pick does to their OWN other fields via separate onPickMake/onPickModel (not one ambiguous onChange)',
  /onPick=\{onPickMake\}/.test(vmms) && /onPick=\{onPickModel\}/.test(vmms));
ok('supports a per-caller custom catalog (makeOptions/modelsFor overrides) — needed by Job Cards\' customVehicles merge',
  /makeOptions = MAKES/.test(vmms) && /modelsFor = \(m\)/.test(vmms));
ok('supports optional per-field labels via a renderField wrapper, defaulting to no wrapping (Job Cards wraps the whole pair itself)',
  /const wrap = renderField \|\| \(\(label, req, children\) => children\);/.test(vmms));

// --- All four call sites reuse it ---
ok('Job Cards: CascadeVehicleSelect delegates to the shared component (customVehicles catalog merge passed through)',
  /import VehicleMakeModelSelect from '\.\.\/common\/VehicleMakeModelSelect'/.test(jc) &&
  /<VehicleMakeModelSelect[\s\S]{0,300}makeOptions=\{makes\}[\s\S]{0,100}modelsFor=\{\(m\) => catalog\[m\] \|\| \[\]\}/.test(jc));
ok('Vehicles module: Cascade delegates to the shared component (Variant stays a separate sibling field)',
  /import VehicleMakeModelSelect from '\.\.\/common\/VehicleMakeModelSelect'/.test(veh) &&
  /<VehicleMakeModelSelect/.test(veh) && /<WField label="Variant">/.test(veh));
ok('Customers: both the wizard vehicle step AND the standalone VehicleModal delegate to the shared component',
  /import VehicleMakeModelSelect from '\.\.\/common\/VehicleMakeModelSelect'/.test(cust) &&
  (cust.match(/<VehicleMakeModelSelect/g) || []).length === 2);
ok('no module still imports MAKES/VEHICLES directly just to hand-roll its own Make/Model pair (Vehicles/Customers no longer need the raw catalog import)',
  !/import \{ VEHICLES, MAKES,/.test(veh) && !/import \{ VEHICLES, MAKES,/.test(cust));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
