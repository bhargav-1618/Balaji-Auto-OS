/**
 * tests/universal-search-boxes.test.cjs
 *
 * UNIVERSAL ISSUE — SEARCH BOXES ACROSS THE ENTIRE APPLICATION.
 *
 * A full-app audit (three parallel research passes covering every search box listed in
 * the brief) found lib/useSearch.js's useSearchIndex/matchIndexed already correctly
 * adopted by ~10 modules, but a real, recurring bug class everywhere else: identifiers
 * (SKU, reg no., VIN, invoice/job/PO number, GST, code) folded into the SAME
 * substring-matched free-text string as names — so an exact identifier query could
 * surface an unrelated record sharing a mere prefix, with no ranking to distinguish them.
 * Separately, matchIndexed's own identifier matching was EXACT-ONLY, which traded that
 * bug for a second one: "232" no longer found "SBBMC232" anywhere except the one module
 * that hand-built a digit-only workaround (see search-accuracy-exact-identifier.test.cjs
 * for that core-primitive fix). This suite covers every OTHER call site fixed in the same
 * pass: the New Invoice workflow's pickers (the highest-priority target — brief section
 * 23), Receive Stock/Shipment, Stock In/Out, the New PO part dropdown, Vehicles' Add
 * Vehicle owner picker + duplicate checks, Audit Log, and Reminders.
 *
 * Source-pattern assertions, matching this repo's established test convention.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const R = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nUniversal Search Boxes — cross-app identifier isolation + ranking\n');

// --- Part 1: SearchSelect — the shared modal dropdown gained identifier-aware ranking ---
{
  const src = R('components/common/SearchSelect.jsx');
  ok('SearchSelect imports rankIndexed/normId from the shared search primitive',
    /import \{ rankIndexed, normId \} from '\.\.\/\.\.\/lib\/useSearch';/.test(src));
  ok('SearchSelect accepts an optional searchIds accessor, parallel to searchText',
    /searchIds = \(\) => \[\],/.test(src));
  ok('SearchSelect builds a { hay, ids } entry per option and filters+ranks via rankIndexed, not a flat token-substring match',
    /hay: String\(searchTextRef\.current\(o\) \|\| ''\)\.toLowerCase\(\),/.test(src) &&
    /ids: \(searchIdsRef\.current\(o\) \|\| \[\]\)\.filter\(Boolean\)\.map\(normId\),/.test(src) &&
    /score: rankIndexed\(entries\[i\], l\)/.test(src));
}

// --- Part 2: Billing / New Invoice — the highest-priority target (brief section 23) ---
{
  const src = R('components/billing/BillingModule.jsx');
  ok('Billing imports useSearchIndex/searchAndRank/rankIndexed alongside the existing matchIndexed/normId',
    /import \{ useDeferredSearch, matchIndexed, normId, useSearchIndex, searchAndRank, rankIndexed, regKey(, phoneKey)? \} from '\.\.\/\.\.\/lib\/useSearch';/.test(src));
  ok('New Invoice Customer picker: code/GST/vehicle reg-VIN go through searchIds, not the free-text searchText',
    /searchIds=\{\(c\) => \[c\.code, c\.gst,\s*\.\.\.\(c\.vehicles \|\| \[\]\)\.flatMap\(\(v\) => \[v\.regNo, v\.reg, v\.vin\]\)\]\}/.test(src));
  ok('New Invoice Vehicle picker: reg/VIN/engine/chassis/RC go through searchIds',
    /searchIds=\{\(v\) => \[v\.regNo, v\.reg, v\.vin, v\.engineNo, v\.chassisNo, v\.rcNumber\]\}/.test(src));
  ok('New Invoice Job Card picker: Job No. (full + digits-only) + reg no. go through searchIds — same digit-only trick the Job Cards module\'s own list uses for the identical data',
    /searchIds=\{\(j\) => \[j\.jobNo, String\(j\.jobNo \|\| ''\)\.replace\(\/\\D\/g, ''\), j\.regNo\]\}/.test(src));
  ok('New Invoice Add Part picker: SKU/OEM/barcode are a proper useSearchIndex, no longer one flat substring-matched string mixing them with name/category',
    /const partSearchIndex = useSearchIndex\(\s*inventory,\s*\(p\) => p\.id,/.test(src) &&
    /\(p\) => \[p\.sku, p\.oemNo, p\.barcode\],/.test(src) &&
    /return searchAndRank\(inventory\.filter\(\(p\) => !p\.archived\), partSearchIndex, \(p\) => p\.id, l\);/.test(src));
  ok('the dead, never-rendered CustomerPicker function was removed, not left as an orphaned second implementation',
    !/function CustomerPicker\(/.test(src));
  ok('the main invoice list re-ranks exact-match-first when a query is active, falling back to date order with no query',
    /rankIndexed\(b\.entry, dq\) - rankIndexed\(a\.entry, dq\)/.test(src) && /if \(dq\.trim\(\)\) \{/.test(src));
}

// --- Part 3: InventoryDashboard.js — Receive Stock/Shipment, Stock In/Out, Audit Log ---
{
  const src = R('components/InventoryDashboard.js');
  ok('InventoryDashboard imports rankIndexed/useSearchIndex/searchAndRank alongside the existing matchIndexed/normId',
    /import \{ useDeferredSearch, normId, matchIndexed, rankIndexed, useSearchIndex, searchAndRank \} from '\.\.\/lib\/useSearch';/.test(src));
  ok('Receive Stock (QuickPickModal) picker: SKU/OEM/barcode/Part No. are a proper search index, not one flat substring string',
    /const partSearchIndex = useSearchIndex\(inventory, \(p\) => p\.id, \(p\) => \[p\.name\], \(p\) => \[p\.sku, p\.oemNo, p\.barcode, p\.partNo\]\);/.test(src));
  ok('Receive Shipment (BulkReceiveModal) picker: same identifier isolation as Receive Stock — was an independent, byte-for-byte duplicate of the same bug, now fixed the same way',
    /const pickerSearchIndex = useSearchIndex\(inventory, \(p\) => p\.id, \(p\) => \[p\.name\], \(p\) => \[p\.sku, p\.oemNo, p\.barcode, p\.partNo\]\);/.test(src));
  ok('Stock In (restocks): SKU/reference/PO number are now searchable identifiers, not silently absent from search entirely',
    /ids: \[r\.sku, r\.reference, r\.poNumber\],/.test(src));
  ok('Stock Out (sales + adjustments merge): SKU/invoice no. are now searchable identifiers',
    /ids: \[o\.sku, o\.invoiceNo\],/.test(src));
  ok('Audit Log: partId/supplierId/entityId are an exact-then-partial identifier index, isolated from name/user/action/reason free text',
    /const auditSearchIndex = useSearchIndex\(\s*auditLog,\s*\(e\) => e\.id,\s*\(e\) => \[e\.name, e\.performedByEmail, e\.action, e\.details\?\.reason\],\s*\(e\) => \[e\.partId, e\.supplierId, e\.entityId\],\s*\);/.test(src));
  ok('Audit Log search is now debounced via the shared useDeferredSearch hook',
    /const \[dq\] = useDeferredSearch\(q\);/.test(src.slice(src.indexOf('function AuditLogPanel'), src.indexOf('function AuditLogPanel') + 1000)));
  ok('Audit Log\'s live subscription cap was corrected from a hardcoded 100 (silently blind to older history) to the already-defined LIMITS.AUDIT_LIVE constant',
    /limit\(LIMITS\.AUDIT_LIVE\)/.test(src) && !/limit\(100\)/.test(src));
  ok('the New PO part dropdown (DarkSelect) now supports an optional per-option `ids` array, ranked via rankIndexed instead of a flat label substring match',
    /const scoreOpt = \(o, l\) => \(o\.ids \? rankIndexed\(\{ hay: o\.label\.toLowerCase\(\), ids: o\.ids \}, l\) : /.test(R('components/inventory/InventoryPurchaseOrders.jsx')));
  ok('the New PO part options now carry SKU/OEM as `ids` (supplier-aware grouping shares one option builder for both the flat and grouped picker)',
    /const toOpt = \(p\) => \(\{ value: p\.id, label: `\$\{p\.name\}\$\{p\.sku \? ` \(\$\{p\.sku\}\)` : ''\}`, ids: \[p\.sku, p\.oemNo\] \}\)/.test(R('components/inventory/InventoryPurchaseOrders.jsx')));
  ok('Command Palette search input is debounced via useDeferredSearch (was rebuilding the full per-keystroke, undebounced)',
    /const \[dq\] = useDeferredSearch\(q\); \/\/ Universal Search review/.test(src));
}

// --- Part 4: Vehicles — Add Vehicle owner picker + duplicate-check normalization ---
{
  const src = R('components/vehicles/VehiclesModule.jsx');
  ok('Vehicles imports regKey/normId for consistent identifier normalization (rankMatch replaced by rankIndexed — see tests/vehicles-module.test.cjs for why)',
    /import \{ useDeferredSearch, useSearchIndex, matchIndexed, rankIndexed, regKey, normId \} from '\.\.\/\.\.\/lib\/useSearch';/.test(src));
  ok('dupReg now uses regKey (strips spaces AND hyphens) instead of a bare .toUpperCase() that let "TS 09 EX 1234" and "TS09EX1234" register as different registrations',
    /const dupReg = f\.regNo && existingVehicles\.some\(\(v\) => v\.id !== f\.id && v\.regNo && regKey\(v\.regNo\) === regKey\(f\.regNo\)\);/.test(src));
  ok('dupVin/dupEngine now use the shared normId normalizer, not ad hoc .toUpperCase()',
    /const dupVin = f\.vin && existingVehicles\.some\(\(v\) => v\.id !== f\.id && v\.vin && normId\(v\.vin\) === normId\(f\.vin\)\);/.test(src) &&
    /const dupEngine = f\.engineNo && existingVehicles\.some\(\(v\) => v\.id !== f\.id && v\.engineNo && normId\(v\.engineNo\) === normId\(f\.engineNo\)\);/.test(src));
  ok('Add Vehicle\'s owner (customer) picker: Customer ID + every owned vehicle\'s reg no. go through a proper search index — was a raw substring match mixing identifiers into one flat string, the third independent "search existing customer" implementation in the app',
    /const ownerSearchIndex = useSearchIndex\(customers, \(c\) => c\.id, \(c\) => \[c\.name, c\.phone\], \(c\) => \[c\.code, \.\.\.\(c\.vehicles \|\| \[\]\)\.map\(\(v\) => v\.regNo\)\]\);/.test(src));
}

// --- Part 5: regKey itself was strengthened to strip hyphens/slashes, not just spaces ---
{
  const src = R('lib/useSearch.js');
  ok('regKey now strips spaces, hyphens AND slashes — "AP 40 LM 1234", "AP-40-LM-1234" and "AP/40/LM/1234" all normalize identically',
    /export const regKey = \(r\) => String\(r \|\| ''\)\.toUpperCase\(\)\.replace\(\/\[\\s\\-\/\]\+\/g, ''\);/.test(src));
}

// --- Part 6: LedgerPage (Sales/Services/Stock In/Stock Out/Inventory Stock) gained ranking ---
{
  const src = R('components/common/LedgerPage.jsx');
  ok('filterLedgerItems ranks exact-match-first when a query is active, falling back to the caller\'s chosen sort as a tie-break — untouched when there is no query',
    /arr = \[\.\.\.arr\]\.sort\(needle\s*\? \(a, b\) => rankIndexed\(entryOf\(b\), needle\) - rankIndexed\(entryOf\(a\), needle\) \|\| bySortOption\(a, b\)\s*: bySortOption\);/.test(src));
}
{
  const src = R('components/inventory/InventoryStock.jsx');
  ok('InventoryStock\'s own search box (feeding filterLedgerItems directly) is now debounced — was the one LedgerPage consumer that bypassed LedgerPage\'s own internal debouncing',
    /const \[dq\] = useDeferredSearch\(q\);/.test(src) && /filterLedgerItems\(tabFiltered, \{ q: dq, range, sort: 'Newest' \}\)/.test(src));
}

// --- Part 7: Suppliers gained debounce + exact-first ranking ---
{
  const src = R('components/inventory/SupplierDirectory.jsx');
  ok('Supplier Directory list search is now debounced via useDeferredSearch',
    /const \[listDq\] = useDeferredSearch\(listQ\);/.test(src));
  ok('an active query re-ranks the supplier list exact-match-first, the chosen sort (recent/name/city/...) applies only as a tie-break',
    /rankIndexed\(supplierSearchIndex\.get\(b\.id\), listDq\) - rankIndexed\(supplierSearchIndex\.get\(a\.id\), listDq\) \|\| bySortBy\(a, b\)/.test(src));
}

// --- Part 8: Purchase Orders gained debounce + ranking ---
{
  const src = R('components/inventory/InventoryPurchaseOrders.jsx');
  ok('PO search is now debounced via useDeferredSearch',
    /const \[poDq\] = useDeferredSearch\(poQ\);/.test(src));
  ok('an active query re-ranks the PO list exact-match-first, falling back to date order as the tie-break',
    /rankIndexed\(poSearchIndex\.get\(b\.id\), poDq\) - rankIndexed\(poSearchIndex\.get\(a\.id\), poDq\) \|\| byDate\(a, b\)/.test(src));
}

// --- Part 9: Reminders gained identifier search (previously none at all) ---
{
  const src = R('components/reminders/RemindersModule.jsx');
  ok('RemindersModule now imports the shared search primitives (previously didn\'t import lib/useSearch.js at all)',
    /import \{ useSearchIndex, matchIndexed, rankIndexed, useDeferredSearch \} from '\.\.\/\.\.\/lib\/useSearch';/.test(src));
  ok('auto-generated reminders now expose raw regNo/jobNo/poNumber fields (not just baked into the display `detail` string) so they can be matched as real identifiers',
    /regNo: v\.regNo \}\);/.test(src) && /jobNo: j\.jobNo, regNo: j\.regNo \}\);/.test(src) && /poNumber: po\.poNumber \}\);/.test(src));
  ok('the reminder search index isolates jobNo/poNumber/regNo as exact-then-partial identifiers, customer/detail/title/kind stay partial free text',
    /const reminderSearchIndex = useSearchIndex\(\s*all,\s*\(r\) => r\.id,\s*\(r\) => \[r\.customer, r\.detail, r\.title, r\.kind\],\s*\(r\) => \[r\.jobNo, r\.poNumber, r\.regNo\],/.test(src));
  ok('reminder search is debounced, and an active query ranks exact-match-first before falling back to the existing urgency sort (overdue, then priority)',
    /const \[dq\] = useDeferredSearch\(q\);/.test(src) &&
    /rankIndexed\(reminderSearchIndex\.get\(b\.id\), needle\) - rankIndexed\(reminderSearchIndex\.get\(a\.id\), needle\)/.test(src));
}

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
