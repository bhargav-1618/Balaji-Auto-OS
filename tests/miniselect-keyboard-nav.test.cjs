/**
 * tests/miniselect-keyboard-nav.test.cjs
 *
 * The shared components/common/MiniSelect.jsx had no arrow-key navigation at all
 * (only Escape-to-close, via DropdownPanel). VehiclesModule.jsx separately ran its OWN
 * local `function MiniSelect` with full ArrowUp/ArrowDown/Enter navigation — but that
 * local copy shadowed the shared import (VehiclesModule never imported the shared
 * component), so Vehicles' Manufacturer/Model/Variant dropdowns silently ran a
 * DIFFERENT implementation than every other module. That local copy also had a real
 * bug: its outside-click handler used `document.addEventListener('mousedown', ...)`
 * checking only `ref.current.contains(e.target)`, but the dropdown panel is rendered
 * through a portal into <body> — never a DOM descendant of that ref. Every mousedown
 * on an option was treated as "outside" and closed the panel before the click could
 * register; confirmed live, a click meant for "Toyota" instead landed on the wizard's
 * backdrop and silently closed the entire Add/Edit Vehicle modal.
 *
 * Fix: deleted the local duplicate; ported its keyboard navigation into the ONE shared
 * MiniSelect instead of re-duplicating it, so every caller app-wide (Customer Type,
 * State, Fuel, Transmission, Manufacturer/Model in Job Cards/Customers/Vehicles) gets
 * arrow-key navigation, and none of them can regress into the portal outside-click bug.
 *
 * A second bug surfaced only through live keyboard testing (not source review): a
 * duplicate Enter keydown dispatch landing before the panel-closing re-render commits
 * would read the same pre-close `open`/`hi` state and call onPick twice. Harmless when
 * onPick is idempotent (picking the same value twice), but a real double-fire
 * nonetheless — guarded with a synchronous ref (pickedRef), since state wouldn't be
 * visible to a second dispatch in time.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/common/MiniSelect.jsx'), 'utf8');
const veh = fs.readFileSync(path.resolve(__dirname, '../components/vehicles/VehiclesModule.jsx'), 'utf8');

console.log('\nMiniSelect — keyboard navigation + Enter double-fire guard\n');

ok('ArrowDown/ArrowUp move the highlight, clamped to the list bounds',
  /setHi\(\(h\) => Math\.min\(h \+ 1, shown\.length - 1\)\)/.test(src) &&
  /setHi\(\(h\) => Math\.max\(h - 1, 0\)\)/.test(src));
ok('highlight resets to the top whenever the panel (re)opens or the search text changes',
  /useEffect\(\(\) => \{ setHi\(0\); \}, \[q, open\]\);/.test(src));
// Issue 7.5 (Stock Operations review) — MiniSelect grew optional grouped-options
// support (non-clickable group-label header rows inline in the list, for the
// stock-adjustment Reason field), which meant option buttons are no longer
// reliably the Nth DOM child of the list (a header row can sit between them) —
// so scroll-into-view now finds the highlighted option by a `data-idx` attribute
// instead of positional indexing, which works identically grouped or flat.
ok('the highlighted row scrolls into view as it moves',
  /listRef\.current\?\.querySelector\(`\[data-idx="\$\{hi\}"\]`\)[\s\S]{0,60}scrollIntoView/.test(src));
ok('option buttons carry data-idx so scroll-into-view works whether options are grouped or flat',
  /data-idx=\{i\}/.test(src));
ok('hovering an option also updates the highlight (mouse and keyboard stay in sync)',
  /onMouseEnter=\{\(\) => setHi\(i\)\}/.test(src));

// --- Enter double-fire guard ---
ok('pickedRef guards Enter from double-firing onPick on a duplicate keydown dispatch',
  /const pickedRef = useRef\(false\)/.test(src) &&
  /if \(pickedRef\.current\) return;/.test(src));
ok('the guard is a ref (synchronous), not state — a second dispatch before re-render must see it immediately',
  /const pickedRef = useRef\(false\)/.test(src));
ok('the guard resets when the panel opens again, so a later Enter still works',
  /useEffect\(\(\) => \{ if \(open\) pickedRef\.current = false; \}, \[open\]\);/.test(src));
ok('picking via Enter sets pickedRef before calling onPick (closes the race window)',
  /if \(shown\[hi\]\) \{ pickedRef\.current = true; onPick\(shown\[hi\]\)/.test(src));

// --- Vehicles no longer runs a shadowing local duplicate ---
ok('VehiclesModule.jsx has no local `function MiniSelect` definition anymore',
  !/function MiniSelect\(/.test(veh));
ok('VehiclesModule.jsx imports the shared MiniSelect',
  /import MiniSelect from '\.\.\/common\/MiniSelect'/.test(veh));
ok('Vehicles no longer runs the buggy local outside-click pattern (mousedown + ref.contains on a non-portal ref)',
  !/document\.addEventListener\('mousedown', d\); return \(\) => document\.removeEventListener\('mousedown', d\); \}, \[open\]\);/.test(veh));

// --- ID-5: hideSearch dropdowns (Customers/Vehicles/Billing/Reminders status &
// type filters) never actually received keyboard focus, so ArrowDown/ArrowUp/Enter
// (wired above via onKey) never fired — ALL of the assertions above already prove
// the *logic* is correct once a keydown reaches onKey; these prove the *listbox
// actually gets focus* in the hideSearch case, which is the part that was broken.
//
// Root cause: `autoFocus` is a React-special-cased prop implemented only for
// button/input/select/textarea host elements (shouldAutoFocusHostComponent) — React
// silently drops it for a plain <div>, calling no DOM API and rendering no
// `autofocus` attribute. The listbox <div> here is not one of those tag types, so
// `autoFocus={hideSearch}` compiled away to nothing: opening a hideSearch dropdown
// left real focus on the trigger <button>, which has no keydown handler, so the
// highlighted option could never move by keyboard.
console.log('\nMiniSelect — hideSearch listbox keyboard focus (ID-5)\n');
ok('the listbox no longer relies on the React-no-op `autoFocus` prop on a <div>',
  !/autoFocus=\{hideSearch\}/.test(src));
ok('the listbox is focused via a ref callback that fires exactly when the node mounts, not a [open, hideSearch] effect (DropdownPanel portals its children one render AFTER `open` flips — see useAnchoredPosition\'s async `measure()` — so an effect keyed on `open` would already have run against a still-null ref by the time this div exists)',
  /const focusListboxOnMount = \(el\) => \{ listRef\.current = el; if \(el && hideSearch\) el\.focus\(\); \};/.test(src));
ok('the listbox <div> is wired to that callback ref (this is what actually moves focus into it for hideSearch dropdowns)',
  /<div ref=\{focusListboxOnMount\} id=\{listboxId\} role="listbox"/.test(src));
ok('the listbox keeps tabIndex=-1 in the hideSearch case (focusable programmatically without joining normal Tab order)',
  /tabIndex=\{hideSearch \? -1 : undefined\}/.test(src));
ok('the listbox keydown handler is still wired only for hideSearch (search-box dropdowns keep taking arrow keys on the search input instead, unchanged)',
  /onKeyDown=\{hideSearch \? onKey : undefined\}/.test(src));
ok('the search-box dropdown\'s own autoFocus is untouched (input is a React-native autofocus tag, so this path was never broken and must stay exactly as-is)',
  /<input\s*\n\s*autoFocus\s*\n\s*value=\{q\}/.test(src));
ok('the keyboard-highlighted option is exposed via aria-activedescendant on hi (tracks arrow-key movement)',
  /aria-activedescendant=\{shown\[hi\] \? optionId\(hi\) : undefined\}/.test(src));
ok('aria-selected on each option reflects the actually committed value, not the transient keyboard highlight (by design — activedescendant already carries the highlight)',
  /aria-selected=\{o === value\}/.test(src));
ok('mouse hover/click selection on options is untouched by the focus fix',
  /onMouseEnter=\{\(\) => setHi\(i\)\}/.test(src) && /onClick=\{\(\) => \{ onPick\(o\); setOpen\(false\); setQ\(''\); \}\}/.test(src));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
