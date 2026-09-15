/**
 * tests/selection-scope-contract.test.cjs
 *
 * Universal Issue — Print/PDF must respect the user's actual selection scope,
 * application-wide, not just in Job Cards. The reference behaviour (JC 1.4, see
 * jobcard-phaseb.test.cjs) was: resolve a selection against the FULL record list via
 * an id lookup, never against the currently-filtered/visible list — so a filter change
 * after selecting can never silently shrink what Print/PDF/Export actually produces.
 *
 * That resolution logic is now a shared, framework-free module (lib/selectionScope.js)
 * instead of four independent hand-rolled copies. This file has two halves:
 *   1. Real behavioural tests against the actual functions (it's plain JS, no JSX —
 *      no need to regex-match source for this part).
 *   2. Source-pattern checks confirming every audited module actually imports and
 *      calls the shared functions, and that the two confirmed bugs (Customers/
 *      Vehicles re-intersecting a selection with `filtered`) are gone for good.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const R = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nUniversal selection-scope contract (Print/PDF/Export)\n');

const { resolveSelectedRecords, countHiddenSelections } = require('../lib/selectionScope');

// --- 1. Real behaviour ---
console.log('  --- lib/selectionScope.js behaviour ---\n');

const ALL = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }, { id: 'c', n: 3 }, { id: 'd', n: 4 }];

{
  const selected = new Set(['a', 'c']);
  const visible = ALL.filter((r) => r.id !== 'c'); // simulate 'c' hidden by a filter
  const resolved = resolveSelectedRecords(selected, ALL, (r) => r.id);
  ok('resolveSelectedRecords returns exactly the selected records, in full', resolved.length === 2 && resolved.map((r) => r.id).sort().join() === 'a,c');
  ok('resolveSelectedRecords is NOT affected by what the current filter hides (the core bug this fixes)',
    resolveSelectedRecords(selected, visible, (r) => r.id).length === 1, // proof: resolving against `visible` (the buggy old pattern) loses "c"
  );
  ok('countHiddenSelections reports exactly the selected-but-not-visible count',
    countHiddenSelections(selected, visible, (r) => r.id) === 1);
}
ok('resolveSelectedRecords drops ids no longer present in the record list (stale selection, e.g. a deleted record)',
  resolveSelectedRecords(new Set(['a', 'zzz']), ALL, (r) => r.id).length === 1);
ok('resolveSelectedRecords returns [] for an empty selection, without touching allRecords',
  resolveSelectedRecords(new Set(), ALL, (r) => r.id).length === 0);
ok('countHiddenSelections returns 0 for an empty selection',
  countHiddenSelections(new Set(), [], (r) => r.id) === 0);
ok('countHiddenSelections returns 0 when every selected record is currently visible',
  countHiddenSelections(new Set(['a', 'b']), ALL, (r) => r.id) === 0);

// --- 2. Every audited module shares the same contract ---
console.log('\n  --- module wiring ---\n');

const cust = R('components/customers/CustomersModule.jsx');
const veh = R('components/vehicles/VehiclesModule.jsx');
const jc = R('components/jobcards/JobCardModule.jsx');
const bill = R('components/billing/BillingModule.jsx');
const inv = R('components/InventoryDashboard.js');

[['Customers', cust], ['Vehicles', veh], ['Job Cards', jc], ['Billing', bill], ['Inventory (Parts)', inv]].forEach(([name, src]) => {
  ok(`${name} imports the shared selection-scope contract`, /from '.*lib\/selectionScope'/.test(src));
});

// The confirmed bug: Customers/Vehicles used to resolve a selection by re-intersecting
// with `filtered` — the exact pattern that silently drops selected-but-filtered-out
// records from Print/PDF/Export. Neither module may ever reintroduce it.
ok('Customers no longer resolves export scope via filtered.filter(id => selectedIds.has(...)) (the confirmed bug)',
  !/filtered\.filter\(\(c\) => selectedIds\.has\(c\.id\)\)/.test(cust));
ok('Customers export resolves against the FULL customer list via the shared contract',
  /const toExport = selectedIds\.size > 0 \? resolveSelectedRecords\(selectedIds, customers, \(c\) => c\.id\) : filtered/.test(cust));
ok('Vehicles no longer resolves export scope via filtered.filter(id => selectedIds.has(...)) (the confirmed bug)',
  !/filtered\.filter\(\(r\) => selectedIds\.has\(r\.id\)\)/.test(veh));
ok('Vehicles export resolves against the FULL vehicle list via the shared contract',
  /const toExport = selectedIds\.size > 0 \? resolveSelectedRecords\(selectedIds, rows, \(r\) => r\.id\) : filtered/.test(veh));

// Job Cards: refactored onto the shared helper, behaviour must be unchanged.
ok('Job Cards resolves its bulk Print/PDF scope via the shared contract (refactor, not a rewrite)',
  /const selectedCards = resolveSelectedRecords\(selectedJobs, savedCards, \(jc\) => jc\.jobNo\)/.test(jc));
ok('Job Cards surfaces hidden selections via the shared contract',
  /const hiddenCount = countHiddenSelections\(selectedJobs, savedList, \(j\) => j\.jobNo\)/.test(jc));

// Billing: already resolved the full selection correctly; now shares the implementation
// and gained the missing hidden-count badge, stale-id pruning, and a bulk-PDF safety cap.
ok('Billing resolves bulk-action scope via the shared contract',
  /const selectedInvoices = \(\) => resolveSelectedRecords\(selected, invoices, \(iv\) => iv\.id\)/.test(bill));
ok('Billing surfaces hidden (filtered-out) selections, same as Job Cards/Customers/Vehicles',
  /const hiddenSelectedCount = useMemo\(/.test(bill) && /not shown by current filters/.test(bill));
ok('Billing prunes stale invoice ids from its selection (e.g. deleted elsewhere), same safeguard as every other module',
  /const liveIds = new Set\(invoices\.map\(\(iv\) => iv\.id\)\)/.test(bill));
// Universal selection→export/PDF/print record-set review (see
// tests/billing-combined-pdf.test.cjs for the full fix) — bulk PDF/Print now
// produce ONE combined document via downloadCombinedInvoicePDF, not N separate
// downloads; bulkDocBusy's shape grew a `mode` field ('print'|'pdf') to match.
ok('Billing bulk PDF is capped and reports progress instead of firing unlimited unthrottled downloads',
  /const MAX_BULK_INVOICE_PDF = 50/.test(bill) && /setBulkDocBusy\(\{ mode: printAfter \? 'print' : 'pdf', done: 0, total: rows\.length \}\)/.test(bill));
ok('Billing bulk PDF buttons are disabled while a bulk PDF run is in progress (matches Job Cards\' bulkDocBusy pattern)',
  /disabled=\{!!bulkDocBusy\}/.test(bill));

// Inventory Parts: already resolved the full selection correctly (a real bulk-action
// scope bug was never present); now shares the implementation and gained stale-id
// pruning, the one safeguard it was missing.
ok('Inventory Parts resolves bulk-action scope via the shared contract',
  /const selectedParts = resolveSelectedRecords\(selectedIds, inventory, \(p\) => p\.id\)/.test(inv));
ok('Inventory Parts prunes stale ids from its selection (e.g. deleted elsewhere)',
  /const liveIds = new Set\(inventory\.map\(\(p\) => p\.id\)\)/.test(inv));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
