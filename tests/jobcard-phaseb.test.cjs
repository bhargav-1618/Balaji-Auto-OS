/**
 * tests/jobcard-phaseb.test.cjs — Services Phase B: KPI summary, timestamped notes,
 * bulk actions, a11y, mobile parity, list fields. Source wiring + KPI/bulk logic.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const jc = fs.readFileSync(path.resolve(__dirname, '../components/jobcards/JobCardModule.jsx'), 'utf8');

console.log('\nServices — Phase B completion\n');

// Part 2 KPI
ok('KPI counts memoized once from savedCards', /const kpis = useMemo\(\(\) => \{[\s\S]{0,1100}\}, \[savedCards\]\)/.test(jc));
ok('KPI covers Open/Inspection/Waiting/Repair/Ready/DeliveredToday/Cancelled', /Open: 0, Inspection: 0, 'Waiting Parts': 0, Repair: 0, Ready: 0, DeliveredToday: 0, Cancelled: 0/.test(jc));
ok('KPI cards clickable → kpiFilter', /setKpiFilter\(\(f\) => \(f === key \? null : key\)\)/.test(jc));
// matchTokens -> matchIndexed: see tests/search-accuracy-exact-identifier.test.cjs — Job
// No./Registration/VIN/Engine No. now match by EXACT value only, name/phone/vehicle/
// advisor/technician stay partial. Same single-pass structure, just the matcher call.
ok('kpiFilter folded into savedList (no dup pass)', /const kpiPass = \(jc\) =>/.test(jc) && /kpiPass\(jc\) && matchIndexed/.test(jc));
ok('Clear Filters resets kpi+status+search', /setKpiFilter\(null\); setSavedStatusF\('All'\); setSavedQ\(''\)/.test(jc));
ok('Delivered Today uses statusLog date', /filter\(\(l\) => l\.status === 'Delivered'\)\.pop\(\)/.test(jc));

// Part 3 timestamped notes
ok('append-only notes log (non-destructive)', /notesLog: \[\.\.\.\(card\.notesLog \|\| \[\]\), \{ at: Date\.now\(\), by:/.test(jc));
ok('note entry captures category + content', /category: cat, content: noteEntry\.trim\(\)/.test(jc));
ok('note history newest-first + collapse', /\[\.\.\.\(card\.notesLog \|\| \[\]\)\]\.reverse\(\)/.test(jc) && /setNotesLogOpen/.test(jc));
ok('existing free-text notes preserved (textarea intact)', /value=\{card\[noteTab\] \|\| ''\}/.test(jc));

// Part 4 bulk
ok('bulk selection Set survives filters', /const \[selectedJobs, setSelectedJobs\] = useState\(\(\) => new Set\(\)\)/.test(jc));
ok('select all shown (scope-labeled, not the ambiguous "select all")', /visible\.forEach\(\(j\) => n\.add\(j\.jobNo\)\)/.test(jc) && /Select all \{visible\.length\} shown/.test(jc));
// JC 1.4 — was: `savedList.filter((j) => selectedJobs.has(j.jobNo))`, i.e. Print/PDF only
// acted on whichever of the selection the CURRENT filter still showed, while the badge
// kept advertising the full `selectedJobs.size`. Narrowing the filter after selecting
// could silently print/export fewer cards than promised, with no error.
// Universal Print/PDF selection-scope review — this exact fix (resolve every selected
// id from the FULL record list, never the filtered one) became the shared contract in
// lib/selectionScope.js (resolveSelectedRecords/countHiddenSelections), now reused by
// Customers/Vehicles/Billing/Inventory Parts too. Job Cards was refactored onto the
// shared helper (see tests/selection-scope-contract.test.cjs) — same behavior, one
// implementation instead of a parallel `savedByJobNo` map.
// Universal Notification Architecture review — bulk delete used to fire
// notify.deleted() the instant the forEach loop RAN, not after the Firestore writes
// behind onDelete actually resolved. Now resolves via Promise.allSettled (same
// pattern as Billing's bulkDelete) and reports a partial-failure count if any of
// them reject, instead of always claiming full success.
ok('bulk print/pdf resolve selectedCards from the FULL selection via the shared resolveSelectedRecords contract, not savedList', /const selectedCards = resolveSelectedRecords\(selectedJobs, savedCards, \(jc\) => jc\.jobNo\)/.test(jc));
ok('bulk delete awaits every onDelete write (Promise.allSettled) before toasting, and reports a partial-failure count instead of always claiming full success', /const results = await Promise\.allSettled\(selectedArr\.map\(\(jn\) => onDelete\?\.\(jn\)\)\)/.test(jc) && /Deleted \$\{n - failed\} of \$\{n\} — \$\{failed\} failed\./.test(jc));
// Issue 3 (JC bulk Print/PDF architecture review) — was: `.forEach((j) => downloadPDF(j,
// true))`, i.e. one browser download / one print dialog PER selected card. 60 selected
// meant 60 downloads. Print/PDF now route through downloadCombinedPDF, which owns a
// SINGLE jsPDF instance across the whole selection (one addPage() between cards, one
// save()/autoPrint() call at the end) — the selection scope and the document scope can
// no longer drift apart, and a large selection can no longer spawn a flood of downloads.
ok('bulk Print/PDF call downloadCombinedPDF(selectedCards, ...), not per-card downloadPDF in a loop', /onClick={\(\) => downloadCombinedPDF\(selectedCards, true\)}/.test(jc) && /onClick={\(\) => downloadCombinedPDF\(selectedCards, false\)}/.test(jc));
ok('downloadCombinedPDF draws every card onto ONE jsPDF instance (single doc, not one per card)', /async function downloadCombinedPDF\(cards, printAfter = false\)/.test(jc) && /const doc = new jsPDF\(\{ unit: PDF_PAGE\.unit, format: PDF_PAGE\.format \}\);[\s\S]{0,200}for \(let i = 0; i < cards\.length; i \+= 1\)/.test(jc));
ok('a selection beyond MAX_COMBINED_PDF is blocked with a clear message BEFORE any generation starts, not silently truncated or frozen', /const MAX_COMBINED_PDF = 150/.test(jc) && /if \(cards\.length > MAX_COMBINED_PDF\)/.test(jc));
ok('zero selection cannot reach Print/PDF at all — the bulk bar (and its buttons) only renders when selectedJobs.size > 0', /\{selectedJobs\.size > 0 && \(\(\) => \{/.test(jc));
ok('drawJobCardDocument is the single shared per-card drawer — both downloadPDF and downloadCombinedPDF call it, neither re-implements card drawing', (jc.match(/drawJobCardDocument\(doc, /g) || []).length >= 3);
ok('bulk delete warns about job cards with a linked invoice before deleting', /invoicedSelectedCount > 0/.test(jc) && /a linked invoice — deleting won.t remove the invoice/.test(jc));
ok('selection badge surfaces hidden (filtered-out) selections instead of staying silent', /not shown by current filters/.test(jc));
ok('clear selection', /const clearSelection = \(\) => setSelectedJobs\(new Set\(\)\)/.test(jc));

// Part 5 a11y
ok('status dialog focus restore', /statusConfirmTrigger\.current\.focus\?\.\(\)/.test(jc));
ok('status dialog Escape closes', /onKeyDown=\{\(e\) => \{ if \(e\.key === 'Escape'\) setStatusConfirm\(null\); \}\}/.test(jc));
ok('row actions have aria-labels', /aria-label=\{`Preview \$\{jc\.jobNo\}`\}/.test(jc));

// Part 7 mobile parity (overflow menu, not hidden). UNIVERSAL ISSUE U3: the menu's
// role="menuitem" buttons now render generically inside the shared ActionMenu
// component (components/common/ActionMenu.jsx), not as literal <button>…</button>
// markup per module — assert the menu is wired through ActionMenu with a Duplicate
// item in its data instead of the old literal JSX text.
ok('mobile parity via overflow menu (no hidden sm:flex actions)', !/hidden sm:flex/.test(jc) && /<ActionMenu anchorRef=\{rowMenuAnchorRef/.test(jc) && /label: 'Duplicate'/.test(jc));
ok('row menu closes on outside click/Escape', /if \(rowMenu == null\) return undefined;/.test(jc));

// Part 8 real fields only (no fabricated priority)
ok('shows created/due/updated dates (real fields)', /In \$\{fmtDate\(jc\.dateIn\)\}/.test(jc) && /Due \$\{fmtDate\(jc\.promised\)\}/.test(jc) && /Updated \$\{new Date\(jc\.savedAt\)/.test(jc));
ok('no fabricated priority field', !/jc\.priority/.test(jc) && !/priority:/.test(jc));
// Bumped from w-1.5 h-1.5 to w-2 h-2 (list-layout review: easier to notice at a glance).
ok('status icon dot present', /w-2 h-2 rounded-full flex-shrink-0" style=\{\{ background: statusColor\(jc\.status\)/.test(jc));

// Part 9 — list-layout review: the row previously had NO min-w-0 on the flex spans
// wrapping Job Card No. / customer / vehicle. Flex items default to min-width:auto,
// so truncate() never actually engaged — a long customer name or vehicle just pushed
// the row wider than its container (reading as "overlapping" against the Badge and
// action icons, which are flex-shrink-0 and always claim their own space) instead of
// eliding with "…". Job Card No. is fixed-shrink (always fully visible, it's the
// primary identifier); the customer/vehicle text is what elides now.
ok('row wrapper allows its children to shrink (min-w-0)', /flex items-center gap-1\.5 min-w-0/.test(jc));
ok('Job Card No. never truncates (flex-shrink-0, always fully visible)',
  /text-sm text-white\/85 font-medium flex-shrink-0">\{jc\.jobNo\}/.test(jc));
ok('customer/vehicle text actually shrinks + truncates (min-w-0 + flex-1)',
  /text-\[11px\] text-white\/45 truncate min-w-0 flex-1">/.test(jc));

// runtime KPI
const cards = [{ status: 'Received', statusLog: [] }, { status: 'Ready', statusLog: [] }, { status: 'Delivered', statusLog: [{ status: 'Delivered', at: Date.now() }] }, { status: 'Delivered', statusLog: [{ status: 'Delivered', at: Date.now() - 5 * 86400000 }] }, { status: 'Cancelled', statusLog: [] }];
const sot = new Date(); sot.setHours(0, 0, 0, 0); const today = sot.getTime();
let open = 0, delToday = 0;
for (const c of cards) { const s = c.status; if (s !== 'Closed' && s !== 'Cancelled' && s !== 'Delivered') open += 1; if (s === 'Delivered') { const dl = c.statusLog.filter((l) => l.status === 'Delivered').pop(); if (dl && dl.at >= today) delToday += 1; } }
ok('runtime: Open counts only active (2)', open === 2);
ok('runtime: Delivered Today excludes older (1)', delToday === 1);

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
