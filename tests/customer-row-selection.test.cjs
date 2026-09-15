/**
 * tests/customer-row-selection.test.cjs
 *
 * Root cause of "no row selection": the table had no selection column or state at all —
 * single-row checkboxes, select-all, and clear-selection didn't exist in any form.
 *
 * Fix: selectedIds is a Set of customer ids (not row indices/positions), so selection
 * survives search, filter, and pagination changes by identity — selecting a customer on
 * page 1, then searching/filtering it out of view and back in, or paging away and back,
 * leaves it selected. Select-all/indeterminate operate on the CURRENT PAGE only (paged),
 * so selecting all on page 1 then moving to page 2 does not silently select page 2 too.
 * A stale-id cleanup effect drops ids for customers no longer in `customers` (e.g.
 * deleted) so the "N selected" count and export never reference a row that no longer
 * exists. Export (exportCSV) uses the selection, intersected with the active
 * search/filter (`filtered`), when any rows are selected, and falls back to the full
 * filtered set otherwise — unchanged for the no-selection case.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/customers/CustomersModule.jsx'), 'utf8');

console.log('\nCustomers — row selection (checkboxes)\n');

// --- state + identity-based selection ---
ok('selection state is a Set of ids, not persisted to the q/page/etc. view-cache',
  /const \[selectedIds, setSelectedIds\] = useState\(\(\) => new Set\(\)\)/.test(src));
ok('stale ids (e.g. a deleted customer) are pruned so the selected count/export stay accurate',
  /const liveIds = new Set\(customers\.map\(\(c\) => c\.id\)\)/.test(src));

// --- select-all / indeterminate scoped to the current page ---
ok('"select all" is scoped to paged (current page), not the full filtered list',
  /const allPagedSelected = paged\.length > 0 && paged\.every\(\(c\) => selectedIds\.has\(c\.id\)\)/.test(src));
ok('header checkbox shows indeterminate when some but not all of the current page is selected',
  /const somePagedSelected = !allPagedSelected && paged\.some\(\(c\) => selectedIds\.has\(c\.id\)\)/.test(src));
ok('toggling select-all only adds/removes ids for rows on the current page',
  /const toggleSelectAllPaged = \(\) => setSelectedIds\(\(prev\) => \{[\s\S]{0,200}paged\.forEach\(\(c\) => next\.delete\(c\.id\)\)[\s\S]{0,100}paged\.forEach\(\(c\) => next\.add\(c\.id\)\)/.test(src));
ok('clearSelection resets to an empty Set (the "Clear" action)',
  /const clearSelection = \(\) => setSelectedIds\(new Set\(\)\)/.test(src));

// --- UI wiring ---
ok('header checkbox reflects allPagedSelected and sets the indeterminate DOM property via ref (checked alone cannot show indeterminate)',
  /checked=\{allPagedSelected\}[\s\S]{0,150}el\.indeterminate = somePagedSelected/.test(src));
ok('header checkbox is wired to toggleSelectAllPaged',
  /onChange=\{toggleSelectAllPaged\}/.test(src));
ok('row checkbox reflects selectedIds.has(c.id) and is wired to toggleSelectOne',
  /checked=\{selectedIds\.has\(c\.id\)\}[\s\S]{0,80}onChange=\{\(\) => toggleSelectOne\(c\.id\)\}/.test(src));
ok('clicking the row checkbox does not also trigger the row\'s onClick (which opens the detail panel)',
  /<td className="py-2\.5 px-3" onClick=\{\(e\) => e\.stopPropagation\(\)\}>\s*<input\s*\n\s*type="checkbox"\s*\n\s*checked=\{selectedIds\.has\(c\.id\)\}/.test(src));
ok('a selection summary bar (count + Clear) is shown only while something is selected',
  /\{selectedIds\.size > 0 && \([\s\S]{0,300}\{selectedIds\.size\} selected/.test(src));
ok('the empty-state colSpan was widened from 13 to 14 to account for the new checkbox column',
  /colSpan=\{14\}/.test(src) && !/colSpan=\{13\}/.test(src));
// Issue 2.4 (Select All ambiguity, Customers/Vehicles UX review) — selection deliberately
// persists across a filter change (paging back to a previous filter should still show
// what you picked there), but that makes an INVISIBLE selection possible: pick some
// customers, change the Type/Status filter, and the badge used to just say "N selected"
// with no sign some are no longer even in view. See the matching fix in
// vehicle-row-selection.test.cjs.
ok('a selection persisting across a filter change is surfaced, not silently hidden (same fix as Job Cards\' bulk selection)',
  /hiddenSelectedCount > 0 \? ` \(\$\{hiddenSelectedCount\} not shown by current filters\)` : ''/.test(src));

// --- export honors selection ---
// Anchor moved to buildCustomerExport: this selection-vs-filtered logic was extracted
// out of exportCSV into a shared helper reused by both exportCSV and the new exportPDF.
// Universal Print/PDF selection-scope review — intersecting the selection with
// `filtered` (the old behavior asserted here) was ITSELF the bug this review fixes:
// pick 5, change the Type/Status filter so 2 no longer show, and the export used to
// silently contain 3 despite the badge still saying "5 selected (2 not shown by
// current filters)". Fixed to resolve against the FULL customer list, same contract
// as Job Cards (lib/selectionScope.js) — see tests/selection-scope-contract.test.cjs.
const expStart = src.indexOf('const buildCustomerExport = ()');
const expBlock = src.slice(expStart, expStart + 1600);
ok('export resolves the FULL selection via the shared resolveSelectedRecords contract (not re-intersected with the active filter) when rows are selected, otherwise the full filtered set',
  /const toExport = selectedIds\.size > 0 \? resolveSelectedRecords\(selectedIds, customers, \(c\) => c\.id\) : filtered/.test(expBlock));
ok('export rows are built from toExport, not the raw filtered list, so selection actually takes effect',
  /const rows = toExport\.map/.test(expBlock));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
