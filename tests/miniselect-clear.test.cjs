/**
 * tests/miniselect-clear.test.cjs
 *
 * Root cause of "Make/Model dropdown has no clear/cancel/reset workflow": MiniSelect
 * (components/common/MiniSelect.jsx) is the ONE shared combobox used for every
 * Manufacturer/Model/Variant field in both Job Cards (CascadeVehicleSelect) and
 * Customers (wizard vehicle step + standalone VehicleModal). Once a value was picked,
 * the only way back to "nothing selected" was reopening the panel and picking a
 * DIFFERENT option from the list — there was no way to clear it back to empty, and no
 * visible affordance suggesting one should exist.
 *
 * "Cancel a pending entry" (typing a new name, then backing out without adding it) was
 * already correctly handled — DropdownPanel's shared Escape/outside-click close resets
 * MiniSelect's local search text (onClose={() => { setOpen(false); setQ(''); }}) — so
 * this fix is scoped to the missing piece: a real clear-to-empty control.
 *
 * Fix (in the ONE shared component, per the "same root cause → same fix" rule, so
 * every caller in both modules gets it with no call-site changes): a small "×" button
 * appears next to the trigger, only when a value is selected, calling onPick(''). Every
 * existing onPick handler in both modules is already of the form
 * `(m) => setX({ field: m, ...cascadeResets })`, so onPick('') clears the field AND
 * correctly cascades (e.g. clearing Make also clears Model) with zero changes needed
 * at any call site.
 *
 * Follow-up fix (global dropdown clear/cancel consistency pass): the clear button was
 * originally a `<span role="button">` NESTED INSIDE the trigger `<button>` — invalid
 * HTML (a button may not contain other focusable/interactive descendants), which
 * produced exactly the reported symptoms — clicks needing multiple tries, focus lost,
 * inconsistent keyboard handling — because browsers handle nested interactive elements
 * unreliably. Clear is now a real, separate `<button>`, a SIBLING of the trigger (not
 * nested), absolutely positioned into the same visual spot. Its handler
 * (`handleClear`) also now atomically resets the in-progress search text and closes
 * the panel if it was open, and returns focus to the trigger — previously it only
 * called onPick(''), leaving stale search text/an open panel behind if Clear was
 * clicked while the panel was open.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/common/MiniSelect.jsx'), 'utf8');
const jc = fs.readFileSync(path.resolve(__dirname, '../components/jobcards/JobCardModule.jsx'), 'utf8');
const cust = fs.readFileSync(path.resolve(__dirname, '../components/customers/CustomersModule.jsx'), 'utf8');

console.log('\nMiniSelect — clear/reset workflow (shared by Job Cards + Customers)\n');

// value !== emptyValue (added by the Vehicles-toolbar clear-icon review): a plain
// picker's "nothing selected" state is '' (emptyValue's default), so this is exactly
// the same "only when a value is actually selected" check as before for every
// existing caller here — Job Card/Customers Manufacturer/Model/Variant/State never
// pass emptyValue, so they're unaffected. Filter dropdowns (Customers/Vehicles
// toolbars) now pass emptyValue="All" so Clear stays hidden at their sentinel default
// too — see tests/vehicles-toolbar-clear-icon.test.cjs.
ok('clear control only renders when a value is actually selected (and not equal to the caller\'s emptyValue sentinel)',
  /\{value && value !== emptyValue && !disabled && \(/.test(src));
ok('clear is a real <button> element, a SIBLING of the trigger — not nested inside it (the invalid-HTML bug that caused unreliable clicks/keyboard/focus)',
  /<\/button>[\s\S]{0,1200}\{value && value !== emptyValue && !disabled && \(\s*\n\s*<button/.test(src));
ok('chevron is positioned independently of the trigger button (own absolute position, pointer-events-none so clicks pass through to the trigger) — not inside the flex row with Clear, so neither icon\'s position depends on whether the other is rendered',
  /<ChevronDown size=\{14\} className="absolute right-3 top-1\/2 -translate-y-1\/2 text-white\/45 pointer-events-none" \/>/.test(src));
ok('trigger reserves icon space UNCONDITIONALLY (!pr-12, not toggled by value presence) — this is what actually stops icons from shifting when a value is selected/cleared',
  /className=\{`\$\{inputCls\} flex items-center text-left !pr-12 \$\{disabled \? 'opacity-50 cursor-not-allowed' : ''\}`\}/.test(src));
ok('clicking clear does not also toggle the dropdown open (stopPropagation) and routes through the atomic handleClear',
  /onClick=\{\(e\) => \{ e\.stopPropagation\(\); handleClear\(\); \}\}/.test(src));
ok('clear also has an explicit Enter/Space keydown handler — live keyboard testing showed relying solely on native <button> activation was not reliable',
  /onKeyDown=\{\(e\) => \{ if \(e\.key === 'Enter' \|\| e\.key === ' '\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); handleClear\(\); \} \}\}/.test(src));
ok('clear has an accessible label',
  /aria-label=\{`Clear \$\{placeholder \|\| 'selection'\}`\}/.test(src));
ok('handleClear clears the value, discards search text, closes the panel, resets the highlight, and restores focus — one atomic reset regardless of open/closed state',
  /const handleClear = \(\) => \{\s*\n\s*onPick\(emptyValue\);\s*\n\s*setQ\(''\);\s*\n\s*setOpen\(false\);\s*\n\s*setHi\(0\);\s*\n\s*triggerRef\.current\?\.focus\(\);/.test(src));
// Bug found during live production-remediation verification (Analytics Category/Brand
// filters): handleClear used to hardcode onPick(''), so a filter dropdown with
// emptyValue="All" reset to '' instead of 'All' — a value that matches neither 'All'
// nor any real option, silently zeroing every filtered result. Resetting to
// emptyValue (default '') keeps every existing plain-picker caller byte-for-byte
// unaffected while making filter dropdowns reset to their own sentinel correctly.
ok('clearing resets to the caller\'s emptyValue sentinel (default \'\', so plain pickers are unaffected; filter dropdowns with emptyValue="All" correctly return to "All", not a dead \'\' value)',
  /onPick\(emptyValue\)/.test(src) && !/onPick\(''\);/.test(src));

// "Cancel a pending typed entry" — already handled by DropdownPanel's shared
// Escape/outside-click close, which resets MiniSelect's own search text. Guard that
// this wasn't disturbed by the clear-button change.
ok('closing the panel (Escape/outside-click) still resets the in-progress search text',
  /onClose=\{\(\) => \{ setOpen\(false\); setQ\(''\); \}\}/.test(src));

// Every existing caller's Manufacturer pick already resets dependent fields — this is
// what makes onPick('') a correct, cascade-safe "clear" with no per-caller changes.
// Manufacturer/Model were later consolidated into the shared VehicleMakeModelSelect
// (global Vehicle Master pass), which takes onPickMake/onPickModel — same reset
// behavior, different prop name at each call site.
ok('Job Card Manufacturer pick already resets Model/vehicle on change (cascade reuse target)',
  /onPickMake=\{\(m\) => onChange\(\{ make: m, model: '', vehicle: '' \}\)\}/.test(jc));
ok('Customers wizard Manufacturer pick already resets Model/Variant on change (cascade reuse target)',
  /onPickMake=\{\(m\) => setVeh\(v\.id, \{ make: m, model: '', variant: '' \}\)\}/.test(cust));
ok('Customers VehicleModal Manufacturer pick already resets Model/Variant on change (cascade reuse target)',
  /onPickMake=\{\(m\) => set\(\{ make: m, model: '', variant: '' \}\)\}/.test(cust));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
