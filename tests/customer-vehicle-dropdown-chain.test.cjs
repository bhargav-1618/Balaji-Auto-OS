/**
 * tests/customer-vehicle-dropdown-chain.test.cjs
 *
 * Vehicle section (Make/Model/Variant) review:
 *   - The Manufacturer field used an older, separate dropdown implementation
 *     (a native <input list> + <datalist>) with the exact same "closes without
 *     applying" outside-click bug already found and fixed in Job Cards' MiniSelect.
 *     Rather than patch that bug a second time in a second implementation, MiniSelect
 *     was extracted to components/common/MiniSelect.jsx and reused here.
 *   - The field order let Variant be entered before Make even existed, and Model's
 *     options weren't scoped until a Make was picked. Reordered to a logical
 *     dependency chain: Manufacturer -> Model -> Variant -> Colour -> Year ->
 *     Engine No. -> VIN -> Fuel -> Transmission (Registration stays first — it's the
 *     vehicle's primary identifier, not part of this ordering ask).
 *
 * Global Vehicle Master consolidation pass: the Manufacturer->Model pair (and the
 * "disable Model until Make is chosen" rule specifically) used to be reimplemented by
 * hand at FOUR separate call sites — this wizard step, the standalone VehicleModal,
 * Vehicles module's Cascade, and Job Cards' CascadeVehicleSelect — each with its own
 * `options={...}` / `disabled={!make}` wiring that had to independently stay correct.
 * Extracted into components/common/VehicleMakeModelSelect.jsx, the ONE place that now
 * owns the Manufacturer->Model dependency rule; every call site passes it onPickMake/
 * onPickModel callbacks for what should happen to ITS OWN other fields (Variant, a
 * combined "vehicle" string) rather than reimplementing the disable/options logic.
 * Variant intentionally stays owned by each caller (pre-existing designs differ:
 * some clear Variant on a Model change, Vehicles' Cascade doesn't — unifying that
 * would be a business-logic change, not a duplication fix).
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/customers/CustomersModule.jsx'), 'utf8');
const miniSelectSrc = fs.readFileSync(path.resolve(__dirname, '../components/common/MiniSelect.jsx'), 'utf8');
const vmmsSrc = fs.readFileSync(path.resolve(__dirname, '../components/common/VehicleMakeModelSelect.jsx'), 'utf8');

console.log('\nCustomers — Vehicle section Manufacturer/Model/Variant dependency chain\n');

ok('CustomersModule reuses the shared MiniSelect (no third dropdown implementation)',
  /import MiniSelect from '\.\.\/common\/MiniSelect'/.test(src));
ok('CustomersModule reuses the shared VehicleMakeModelSelect (no duplicated Manufacturer->Model logic)',
  /import VehicleMakeModelSelect from '\.\.\/common\/VehicleMakeModelSelect'/.test(src));
ok('shared MiniSelect owns outside-close via the portalled DropdownPanel (no local mousedown/ref.contains bug)',
  !/document\.addEventListener\('mousedown'/.test(miniSelectSrc) && /DropdownPanel anchorRef=\{ref\}/.test(miniSelectSrc));

// --- The shared component itself owns the core dependency rule, tested ONCE here ---
ok('VehicleMakeModelSelect: Model is disabled until a Manufacturer is chosen',
  /disabled=\{!make\}/.test(vmmsSrc));
ok('VehicleMakeModelSelect: Model options are scoped to the chosen Manufacturer (modelsFor(make), empty when no make)',
  /const models = make \? modelsFor\(make\) : \[\];/.test(vmmsSrc));

// --- CustomerWizard's inline vehicle step ---
{
  const start = src.indexOf('Vehicles ({f.vehicles.length})');
  // Window widened 4000 -> 7000 (Batch 4B), then 7000 -> 8000 here: the VIN field now
  // sits ~7506 chars after `start` (confirmed by direct measurement, not guessed) as
  // more legitimate content (i18n t() wrapping, further field additions) accumulated
  // ahead of it in source order — none of it changes the actual field order asserted
  // below, just how much source sits before it. Widened with headroom rather than to
  // the exact measured distance so the next few lines of legitimate growth don't
  // immediately re-break this.
  const block = src.slice(start, start + 8000);
  ok('wizard: uses the shared VehicleMakeModelSelect for Manufacturer/Model (not a hand-rolled pair)',
    /<VehicleMakeModelSelect/.test(block));
  ok('wizard: Variant MiniSelect is disabled until a Model is chosen', /options=\{variantsFor\(v\.make\)\}[\s\S]{0,80}disabled=\{!v\.model\}/.test(block));
  ok('wizard: picking a new Manufacturer resets Model AND Variant (no incompatible combo)',
    /onPickMake=\{\(m\) => setVeh\(v\.id, \{ make: m, model: '', variant: '' \}\)\}/.test(block));
  ok('wizard: picking a new Model resets Variant', /onPickModel=\{\(m\) => setVeh\(v\.id, \{ model: m, variant: '' \}\)\}/.test(block));
  // Order in source reflects render/DOM order for a top-to-bottom, left-to-right 2-col grid.
  const order = ['placeholder="Registration', '<VehicleMakeModelSelect', 'placeholder={v.model ? \'Variant\'', "'Colour'", "'Year'", "'Engine No.'", "'VIN'"]
    .map((needle) => block.indexOf(needle));
  ok('wizard: fields appear in the required order (Registration, Manufacturer+Model, Variant, Colour, Year, Engine No., VIN)',
    order.every((v) => v !== -1) && order.every((v, i) => i === 0 || v > order[i - 1]), order.join(','));
}

// --- Standalone VehicleModal (Customer Details -> Add/Edit Vehicle) ---
{
  const start = src.indexOf('function VehicleModal(');
  // Defect #49 (reopened again) added a multi-line root-cause comment ahead of this
  // component's return statement (createPortal fix — see CustomersModule.jsx), pushing
  // Fuel/Transmission past the old 4500-char window; widened, not shrunk-content-to-fit.
  const block = src.slice(start, start + 6000);
  ok('VehicleModal: uses the shared VehicleMakeModelSelect for Manufacturer/Model (not a hand-rolled pair)',
    /<VehicleMakeModelSelect/.test(block));
  ok('VehicleModal: Variant MiniSelect is disabled until a Model is chosen', /options=\{variantsFor\(f\.make\)\}[\s\S]{0,80}disabled=\{!f\.model\}/.test(block));
  ok('VehicleModal: picking a new Manufacturer resets Model AND Variant', /onPickMake=\{\(m\) => set\(\{ make: m, model: '', variant: '' \}\)\}/.test(block));
  const order = ['label="Registration No.', '<VehicleMakeModelSelect', 'label="Variant"', 'label="Year"', 'label="Fuel"', 'label="Transmission"']
    .map((needle) => block.indexOf(needle));
  ok('VehicleModal: fields appear in the required order (Registration, Manufacturer+Model, Variant, Year, Fuel, Transmission)',
    order.every((v) => v !== -1) && order.every((v, i) => i === 0 || v > order[i - 1]), order.join(','));
}

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
