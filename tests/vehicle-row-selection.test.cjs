/**
 * tests/vehicle-row-selection.test.cjs
 *
 * Issue 2/2.1 (Customers & Vehicles UX review) — Vehicles had NO selection column, no
 * selection state, and no bulk actions at all: interaction consistency and bulk-operation
 * capability that Customers already had. Root cause: it was never built, not a shared
 * abstraction that regressed. Fix: a straight port of Customers' selection shape and
 * helpers (selectedIds Set keyed by id, page-scoped select-all/indeterminate, stale-id
 * pruning, an active/archived-aware bulk bar) — same semantics on both modules, so they
 * can't drift into two different selection behaviors again. See customer-row-selection
 * .test.cjs for the reference implementation this mirrors.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/vehicles/VehiclesModule.jsx'), 'utf8');

console.log('\nVehicles — row selection (checkboxes), matching Customers\n');

// --- state + identity-based selection ---
ok('selection state is a Set of ids, not persisted to the view-cache (VV)',
  /const \[selectedIds, setSelectedIds\] = useState\(\(\) => new Set\(\)\)/.test(src));
ok('stale ids (e.g. a deleted vehicle) are pruned so the selected count/bulk actions stay accurate',
  /const liveIds = new Set\(rows\.map\(\(r\) => r\.id\)\)/.test(src));

// --- select-all / indeterminate scoped to the current page ---
ok('"select all" is scoped to paged (current page), not the full filtered list — same as Customers',
  /const allPagedSelected = paged\.length > 0 && paged\.every\(\(r\) => selectedIds\.has\(r\.id\)\)/.test(src));
ok('header checkbox shows indeterminate when some but not all of the current page is selected',
  /const somePagedSelected = !allPagedSelected && paged\.some\(\(r\) => selectedIds\.has\(r\.id\)\)/.test(src));
ok('toggling select-all only adds/removes ids for rows on the current page',
  /const toggleSelectAllPaged = \(\) => setSelectedIds\(\(prev\) => \{[\s\S]{0,200}paged\.forEach\(\(r\) => next\.delete\(r\.id\)\)[\s\S]{0,100}paged\.forEach\(\(r\) => next\.add\(r\.id\)\)/.test(src));
ok('clearSelection resets to an empty Set (the "Clear selection" action)',
  /const clearSelection = \(\) => setSelectedIds\(new Set\(\)\)/.test(src));

// --- UI wiring ---
ok('header checkbox reflects allPagedSelected and sets the indeterminate DOM property via ref',
  /checked=\{allPagedSelected\}[\s\S]{0,150}el\.indeterminate = somePagedSelected/.test(src));
ok('header checkbox is wired to toggleSelectAllPaged',
  /onChange=\{toggleSelectAllPaged\}/.test(src));
ok('row checkbox reflects selectedIds.has(r.id) and is wired to toggleSelectOne',
  /checked=\{selectedIds\.has\(r\.id\)\}[\s\S]{0,80}onChange=\{\(\) => toggleSelectOne\(r\.id\)\}/.test(src));

// --- Issue 3: interaction model — checkbox selects ONLY, row click opens detail ONLY ---
ok('clicking the row checkbox does not also trigger the row\'s onClick (which opens the detail panel) — stopPropagation on the checkbox cell',
  /<td className="py-2\.5 px-3" onClick=\{\(e\) => e\.stopPropagation\(\)\}>\s*<input\s*\n\s*type="checkbox"\s*\n\s*checked=\{selectedIds\.has\(r\.id\)\}/.test(src));
ok('row click opens the detail panel (setSelId) and does NOT also toggle selection — one primary behavior per click target, not two competing state updates',
  /onClick=\{\(\) => \{ setSelId\(r\.id\); setDetailTab\('Overview'\); \}\}/.test(src) && !/onClick=\{\(\) => \{ setSelId\(r\.id\); toggleSelectOne/.test(src));

// --- bulk action bar ---
ok('a selection summary bar (count + Clear) is shown only while something is selected',
  /\{selectedIds\.size > 0 && \([\s\S]{0,300}\{selectedIds\.size\} selected/.test(src));
ok('the empty-state colSpan was widened from 11 to 12 to account for the new checkbox column',
  /colSpan=\{12\}/.test(src) && !/colSpan=\{11\}/.test(src));
// Issue 2.3 — bulk actions must be context-aware (which action shows depends on WHAT is
// selected), not a fixed always-visible button set. Mirrors Customers' selArchiveMix.
ok('Archive only appears when the selection actually contains a non-archived vehicle',
  /selArchiveMix\.active > 0 && <button onClick=\{\(\) => bulkArchiveVehicles\(true\)\}/.test(src));
ok('Restore only appears when the selection actually contains an archived vehicle',
  /selArchiveMix\.archived > 0 && <button onClick=\{\(\) => bulkArchiveVehicles\(false\)\}/.test(src));
ok('bulk delete respects the demo-mode delete permission gate, same as the single-row delete',
  /const bulkDeleteVehicles = async \(\) => \{\s*\n\s*if \(demoMode && !demoCanDelete\)/.test(src));
// Issue 2.2 — no hypothetical/filler bulk actions: only Export, Archive, Restore, Delete
// (the same operations already proven as real per-row actions), nothing invented.
ok('no bulk Edit/Duplicate/Create-Job-Card/Create-Invoice was added (those are inherently single-target actions, not bulk-coherent)',
  !/bulkEdit|bulkDuplicate|bulkCreateJobCard|bulkCreateInvoice/.test(src));

// --- Issue 2.4: invisible-selection guard ---
ok('a selection persisting across a filter change is surfaced, not silently hidden (same fix as Job Cards\' bulk selection)',
  /hiddenSelectedCount > 0 \? ` \(\$\{hiddenSelectedCount\} not shown by current filters\)` : ''/.test(src));

// --- export honors selection (Issue A — was previously ALWAYS the full filtered set) ---
// Universal Print/PDF selection-scope review — intersecting the selection with
// `filtered` (the Issue A fix asserted here previously) was ITSELF the bug this review
// fixes: pick 5, change the Fuel/Status filter so 2 no longer show, and the export used
// to silently contain 3 despite the badge still saying "5 selected (2 not shown by
// current filters)". Fixed to resolve against the FULL vehicle list (`rows`), same
// contract as Job Cards (lib/selectionScope.js) — see selection-scope-contract.test.cjs.
const expStart = src.indexOf('const buildVehicleExport = ()');
const expBlock = src.slice(expStart, expStart + 1600);
ok('export resolves the FULL selection via the shared resolveSelectedRecords contract (not re-intersected with the active filter) when rows are selected, otherwise the full filtered set',
  /const toExport = selectedIds\.size > 0 \? resolveSelectedRecords\(selectedIds, rows, \(r\) => r\.id\) : filtered/.test(expBlock));
ok('export rows are built from toExport (aliased `body`, not a shadowing local `rows`), so selection actually takes effect',
  /const body = toExport\.map/.test(expBlock) && /return \{ head, rows: body, count: toExport\.length \}/.test(expBlock));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
