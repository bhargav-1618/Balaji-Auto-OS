/**
 * tests/customer-dashboard-layout.test.cjs
 *
 * Root cause of "the Customers dashboard feels crowded on full desktop width, but clean
 * at about half the screen" (diagnosed when the page shell still capped ALL content at
 * max-w-7xl — the universal-width-architecture migration since then removed that
 * per-tab default, see split-layout-width-budget.test.cjs, but this specific grid-column
 * bug and its fix below are independent of that and still apply): `lg:`/`xl:` are
 * VIEWPORT breakpoints, not measurements of this grid's actual available width. Past
 * the `xl` breakpoint the detail panel on the right permanently claims a fixed 360px
 * alongside the table column — so once a screen is wide enough to trigger `xl:flex`, the
 * KPI grid's real budget was capped at roughly max-w-7xl minus 360px minus gaps
 * (~850-900px at the time), REGARDLESS of how much wider the monitor is. `lg:grid-cols-6` forced six
 * cards into that same ~900px, each far narrower than its icon+value+sub-label content
 * wants. At roughly half a desktop screen, `xl:flex` isn't active (the detail panel
 * stacks below instead of beside), so the SAME grid got the browser's full width at only
 * 3 columns — comfortably wide per card. This is a source-assertion guard for the fix
 * (cap the grid at 3 columns everywhere, and give the toolbar's search field a sane max
 * width instead of growing unbounded).
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/customers/CustomersModule.jsx'), 'utf8');

console.log('\nCustomers — desktop dashboard proportions\n');

ok('KPI grid no longer jumps to 6 columns at the lg viewport breakpoint (was lg:grid-cols-6)',
  !/grid-cols-2 sm:grid-cols-3 lg:grid-cols-6/.test(src));
ok('KPI grid caps at 3 columns (matches the width it actually gets once the xl: detail panel is showing)',
  /grid grid-cols-2 sm:grid-cols-3 gap-3\.5 mb-4/.test(src));
ok('all 6 KPI Stat cards are still rendered (layout-only change, no cards removed)',
  (src.match(/<Stat icon=\{/g) || []).length === 6);

// Search's own max-w cap is now moot: the toolbar redesign (see
// tests/customers-vehicles-toolbar-redesign.test.cjs) gave search its own full-width
// row, so it no longer shares a row with the filters/buttons it needed capping
// against in the first place. Superseded by that test file, not re-asserted here.
// The Type/Status filters were later converted from fixed widths to flex-GROW items
// (flex-1 with min-w/max-w bounds) so the toolbar fills wide rows responsively without a
// dead gap — see tests/customers-vehicles-wide-toolbar.test.cjs. The point of THIS
// assertion is unchanged: whatever their sizing, the Type/Status filters are sized
// independently of the Row-1 search box (Row 1 is a standalone full-width search; Row 2
// holds the filters), so the search box's width never squeezes them.
ok('type and status filters are sized independently of the search box (Row 2 holds them in a parent-driven grid, not Row 1)',
  /gridTemplateColumns: 'repeat\(auto-fit, minmax\(13rem, 1fr\)\)'/.test(src));
// Window widened: the report-PDF-export pass (lib/pdfTheme.js exportReportPDF) added a
// second "PDF" export button between Excel and New Customer — same grouped div, just
// one more sibling button to skip over before reaching "New Customer".
ok('Export and New Customer stay grouped together at the end of the toolbar row',
  /onClick=\{exportCSV\}[\s\S]{0,20}disabled=\{exporting\}[\s\S]{0,1000}New Customer/.test(src));

// The detail panel's width was flat-fixed (xl:w-[360px]) when this specific test was
// written, then made responsive (clamp-based) — see customer-details-panel.test.cjs.
// Superseded again by the Details Panel framework consolidation: the panel's width now
// lives in the SHARED components/common/DetailsPanel.jsx (used by both Customers and
// Vehicles), not inlined here, so it's asserted there instead of duplicated in this file.

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
