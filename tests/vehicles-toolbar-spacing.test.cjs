/**
 * tests/vehicles-toolbar-spacing.test.cjs
 *
 * VEHICLES DASHBOARD FILTER TOOLBAR OPTIMIZATION — "we have few filters for them it
 * have somewhat extra space if we remove that and just add export and add vehicle in
 * the same [row] is better."
 *
 * Root cause: a plain `<select>` IS the flex item in the toolbar's row, so its
 * `sm:w-36`/`sm:w-40` width class genuinely only took effect at the `sm:` breakpoint
 * (640px) and above. Below that, it fell back to `inputCls`'s own `w-full` and
 * stretched to the FULL row width for a value as short as "All Status" or "Latest".
 * MiniSelect's trigger button also carries `w-full`, but the button isn't the flex
 * item — MiniSelect's OUTER wrapper (`<div className="relative">`, the actual item in
 * this row) has no width class of its own, so it already rendered compact below sm:
 * regardless of what width class it was given. Live-measured at 620px: "All Makes" +
 * "All Fuels" (MiniSelect) sat compact side-by-side on one row, while "All Status" and
 * "Latest" (native <select>) EACH claimed the full ~585px row width alone — two
 * oddly-stretched dropdowns sandwiched between two compact ones, on the very same
 * toolbar. That inconsistency is the "extra space" — and it's also why Export + Add
 * Vehicle kept landing on their own mostly-empty row: the two full-width selects ate
 * three whole rows by themselves before the buttons ever got a chance to share one.
 *
 * Fix: `!w-36`/`!w-40` (unconditional, not sm:-gated) on the native selects, matching
 * MiniSelect's actual — if previously accidental — compact behavior at every width.
 * Same fix applied to Customers' Status select for consistency (same mismatch existed
 * there against its Type filter, just less visible with only 2 filters instead of 4).
 * No filtering/sorting logic touched — purely a width class change.
 *
 * UPDATE — a later pass added a `2xl:` widened variant on top of these same base
 * widths (`!w-36 2xl:!w-44` etc.) to close a leftover-space gap on genuinely wide
 * monitors; see tests/customers-vehicles-wide-toolbar.test.cjs. The base `!w-36`/`!w-40`
 * this file guards stay exactly as fixed here — only appended to, never replaced.
 *
 * UPDATE 2 (dropdown-standardization pass) — Status and Sort were converted from
 * native <select> to MiniSelect (a native select's open popup is OS-rendered and
 * can't be themed to match the app; see components/common/fieldStyles.js and the
 * dropdown-design-consistency test). The "plain grid item, no width class of its
 * own" property this file guards is UNCHANGED by that conversion: MiniSelect's
 * trigger still receives the same bare `inputCls` (no sm:-gated width appended),
 * and its outer wrapper still has no width class of its own — same grid-track
 * sizing behaviour as before, just via MiniSelect's markup instead of <select>'s.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const R = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nVehicles/Customers toolbar — consistent compact filter widths at every breakpoint\n');

const veh = R('components/vehicles/VehiclesModule.jsx');
const cust = R('components/customers/CustomersModule.jsx');

// SUPERSEDED by the later parent-driven grid toolbar (tests/customers-vehicles-wide-
// toolbar.test.cjs): the native selects are now plain grid items (className={inputCls},
// no width class of their own at all) inside a `repeat(auto-fit,minmax(...,1fr))` grid
// track — this solves the ORIGINAL problem this test guarded even more directly, since a
// grid item's track width is set by the grid, never by inputCls's own w-full falling back
// below sm:. The assertions below verify that grid-item sizing (and that the old sm:-gated
// widths that caused the full-width-below-640px bug are gone).
ok('Vehicles Status is a MiniSelect and a plain grid item (no fixed/gated width of its own — sized by its grid track)',
  /<MiniSelect value=\{statusF\}[\s\S]{0,400}inputCls=\{inputCls\}/.test(veh));
ok('Vehicles Sort is a MiniSelect and a plain grid item (no fixed/gated width of its own — sized by its grid track)',
  /<MiniSelect value=\{sortBy\}[\s\S]{0,700}inputCls=\{inputCls\}/.test(veh));
ok('Vehicles Status/Sort MiniSelects carry no sm:-gated width override on inputCls (would silently reintroduce the full-width-below-640px inconsistency)',
  !/inputCls=\{`\$\{inputCls\} sm:w-36`\}/.test(veh) && !/inputCls=\{`\$\{inputCls\} sm:w-40`\}/.test(veh));

ok('Customers Status is a MiniSelect and a plain grid item (no fixed/gated width of its own — sized by its grid track)',
  /<MiniSelect value=\{statusF\}[\s\S]{0,400}inputCls=\{inputCls\}/.test(cust));
ok('Customers Status MiniSelect carries no sm:-gated width override on inputCls',
  !/inputCls=\{`\$\{inputCls\} sm:w-36`\}/.test(cust));

// --- Filtering/sorting behavior itself is untouched — only the control/width changed ---
ok('Vehicles Status MiniSelect still drives statusF (same onPick target, same options, same "All" sentinel)',
  /<MiniSelect value=\{statusF\}[\s\S]{0,300}options=\{\['All', 'Active', 'Inactive', 'Archived'\]\}[\s\S]{0,300}onPick=\{\(v\) => setStatusF\(v \|\| 'All'\)\}/.test(veh));
ok('Vehicles Sort MiniSelect still drives sortBy with the full original option set',
  /options=\{\['latest', 'oldest', 'visits', 'revenue', 'lastService', 'upcoming'\]\}/.test(veh)
  && /lastService: t\('vehicles\.sort\.lastService', 'Last Service'\)/.test(veh)
  && /upcoming: t\('vehicles\.sort\.upcomingService', 'Upcoming Service'\)/.test(veh));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
