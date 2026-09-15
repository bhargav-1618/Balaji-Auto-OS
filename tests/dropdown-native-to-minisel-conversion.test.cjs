/**
 * tests/dropdown-native-to-minisel-conversion.test.cjs
 *
 * FINAL DROPDOWN UI STANDARDIZATION.
 *
 * User-reported problem: "Customer Type" opens with the app's own rounded,
 * shadowed, themed popup (MiniSelect, via the shared DropdownPanel primitive),
 * while equivalent filters — Vehicles' Make/Fuel/Status/Sort, Customers' Status,
 * Billing's Status/Payment/Date, Reminders' Kind/Status — opened with a
 * rectangular, browser-native popup. Root cause: those controls were still
 * native <select>/<option> elements. A native <select>'s OPEN popup (its
 * corners, shadow, option-row spacing, and hover/selected highlight) is
 * rendered by the OS/browser, not the page — no CSS in any browser can give it
 * the app's rounded-xl/shadow-2xl design or override its native highlight
 * color. Confirmed by inspecting the existing "Universal dropdown architecture
 * review" precedent already in VehiclesModule.jsx (Fuel/Transmission/Body
 * Type/Drive Type in the Add-Vehicle wizard, and Customer/Supplier Type
 * elsewhere) — this fix extends that SAME established pattern to the filter
 * bar, rather than introducing a new one.
 *
 * Fix: converted the listed filter/sort controls from native <select> to the
 * app's existing MiniSelect primitive (which already renders through
 * DropdownPanel, the app's one canonical rounded-xl/shadow-2xl popup). Added
 * an optional `hideSearch` prop to MiniSelect (small, additive, backward
 * compatible) so a 3-11-option filter list doesn't carry a search box the way
 * MiniSelect's existing 100+-row catalog pickers do.
 *
 * This test proves, for every converted control, that the exact same option
 * set / value semantics / sentinel-fallback the native <select> had are
 * preserved — not just that "MiniSelect appears somewhere in the file". Every
 * OTHER dropdown-related test in this repo already established the convention
 * of source-pattern assertions for these large module files (no existing test
 * anywhere renders VehiclesModule/CustomersModule/BillingModule/
 * RemindersModule behaviorally — they're too large and prop-heavy); this test
 * follows that same convention for the source-level checks, and ADDS a real
 * behavioral render of MiniSelect itself, using the exact options/labels one
 * converted control (Vehicles Status) now passes, to prove the underlying
 * primitive's actual DOM behavior — not just that the right props were typed.
 */
require('./setup.cjs');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

console.log('\nDropdown standardization — native <select> to MiniSelect conversion\n');

// ---- 1. MiniSelect's hideSearch extension: additive, backward compatible. -------
const miniSelect = read('components/common/MiniSelect.jsx');
ok('MiniSelect accepts an optional hideSearch prop, defaulting to false (every existing caller unaffected)',
  /hideSearch = false/.test(miniSelect));
ok('...the search row is conditionally rendered, not removed outright (existing 100+-row catalog pickers keep their search box)',
  /\{!hideSearch && \(/.test(miniSelect));
ok('...when hidden, the option list itself becomes keyboard-focusable so Arrow/Enter still work without a search box',
  /tabIndex=\{hideSearch \? -1 : undefined\}/.test(miniSelect) && /onKeyDown=\{hideSearch \? onKey : undefined\}/.test(miniSelect));

// ---- 2. Every converted control: same option set, same value semantics, same
//    'All'/default sentinel fallback as the native <select> it replaced. -----------
const veh = read('components/vehicles/VehiclesModule.jsx');
const cust = read('components/customers/CustomersModule.jsx');
const bill = read('components/billing/BillingModule.jsx');
const rem = read('components/reminders/RemindersModule.jsx');

ok('Vehicles Status: no native <select> for statusF remains',
  !/<select value=\{statusF\}/.test(veh));
ok('Vehicles Status: MiniSelect carries the exact same 4 status values and onPick falls back to the All sentinel (same predicate the table filter still checks)',
  /<MiniSelect value=\{statusF\}[\s\S]{0,150}options=\{\['All', 'Active', 'Inactive', 'Archived'\]\}[\s\S]{0,400}emptyValue="All" onPick=\{\(v\) => setStatusF\(v \|\| 'All'\)\}/.test(veh));

ok('Vehicles Sort: no native <select> for sortBy remains',
  !/<select value=\{sortBy\}/.test(veh));
ok('Vehicles Sort: MiniSelect carries the exact same 6 sort keys in the exact same order (same sortBy switch the table still reads)',
  /options=\{\['latest', 'oldest', 'visits', 'revenue', 'lastService', 'upcoming'\]\}/.test(veh));

ok('Customers Status: no native <select> for statusF remains',
  !/<select value=\{statusF\}/.test(cust));
ok('Customers Status: MiniSelect carries the exact same 4 status values and onPick falls back to the All sentinel',
  /<MiniSelect value=\{statusF\}[\s\S]{0,150}options=\{\['All', 'Active', 'Inactive', 'Archived'\]\}[\s\S]{0,400}emptyValue="All" onPick=\{\(v\) => setStatusF\(v \|\| 'All'\)\}/.test(cust));

ok('Billing Status: no native <select> for statusF remains',
  !/<select value=\{statusF\}/.test(bill));
ok('Billing Status: MiniSelect carries the exact same 11 status values in the exact same order (same statusF the invoice filter still checks)',
  /options=\{\['All', 'Outstanding', 'Draft', 'Estimate', 'Unpaid', 'Partially Paid', 'Paid', 'Cancelled', 'Refunded', 'Returned', 'Archived'\]\}/.test(bill));
ok('Billing Payment Mode: no native <select> for payModeF remains',
  !/<select value=\{payModeF\}/.test(bill));
ok('Billing Payment Mode: MiniSelect still derives its options from the same PAYMENT_MODES source, prefixed with the same All sentinel',
  /options=\{\['All', \.\.\.PAYMENT_MODES\]\}/.test(bill));
ok('Billing Date: no native <select> for dateF remains',
  !/<select value=\{dateF\}/.test(bill));
ok('Billing Date: MiniSelect carries the exact same 4 date-range values (All/Today/Week/Month)',
  /options=\{\['All', 'Today', 'Week', 'Month'\]\}/.test(bill));

ok('Reminders Kind: no native <select> for kindF remains',
  !/<select value=\{kindF\}/.test(rem));
ok('Reminders Kind: MiniSelect derives its options from the same KIND source, prefixed with the same All sentinel — and now carries an EXPLICIT \'All\' value (the native <option> here previously had none, deriving its value from rendered text instead, a latent bug this conversion incidentally fixes)',
  /options=\{\['All', \.\.\.Object\.keys\(KIND\)\]\}[\s\S]{0,150}emptyValue="All" onPick=\{\(v\) => setKindF\(v \|\| 'All'\)\}/.test(rem));
ok('Reminders Status: no native <select> for statusF remains',
  !/<select value=\{statusF\}/.test(rem));
ok('Reminders Status: MiniSelect carries the exact same 3 values (active/completed/all) in the exact same order',
  /options=\{\['active', 'completed', 'all'\]\}/.test(rem));

// ---- 3. Every converted control still routes through the canonical popup
//    primitive — this is what actually fixes the reported visual mismatch. --------
[veh, cust, bill, rem].forEach((src, i) => {
  const name = ['VehiclesModule', 'CustomersModule', 'BillingModule', 'RemindersModule'][i];
  ok(`${name} imports MiniSelect (the canonical popup primitive)`,
    /import MiniSelect from ['"].*common\/MiniSelect['"]/.test(src));
});

// ---- 4. Behavioral: render the REAL MiniSelect with the EXACT props Vehicles'
//    Status filter now passes, and prove — via real DOM, not string matching —
//    that selecting an option fires onPick with the real status value, and that
//    the open popup renders through the canonical DropdownPanel shape. ------------
const React = require('react');
const { act } = require('react');
const { createRoot } = require('react-dom/client');
const MiniSelect = require('../components/common/MiniSelect.jsx').default;

const picked = [];
const host = document.createElement('div');
document.body.appendChild(host);
act(() => {
  createRoot(host).render(
    React.createElement(MiniSelect, {
      value: 'All',
      placeholder: 'All Status',
      options: ['All', 'Active', 'Inactive', 'Archived'],
      labels: { All: 'All Status', Active: 'Active', Inactive: 'Inactive', Archived: 'Archived' },
      emptyValue: 'All',
      onPick: (v) => picked.push(v || 'All'),
      hideSearch: true,
    }),
  );
});
const trigger = host.querySelector('button[aria-haspopup="listbox"]');
ok('Rendered MiniSelect (Vehicles Status shape) has a real trigger button', !!trigger);
act(() => { trigger.click(); });
const panel = document.querySelector('[data-dropdown-panel]');
ok('...opening it renders the canonical DropdownPanel popup (rounded-xl shadow-2xl)',
  !!panel && panel.className.includes('rounded-xl') && panel.className.includes('shadow-2xl'));
ok('...hideSearch actually suppressed the search input (no "Search…" box for this 4-option filter)',
  !document.querySelector('input[placeholder="Search…"]'));
const activeOption = Array.from(document.querySelectorAll('[role="option"]')).find((o) => o.textContent.trim() === 'Active');
ok('...the "Active" option is present in the real rendered listbox', !!activeOption);
act(() => { activeOption.click(); });
ok('...clicking it fires onPick with the real value "Active" (the same value the table filter checks — not a label, not empty)',
  picked[picked.length - 1] === 'Active');

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
