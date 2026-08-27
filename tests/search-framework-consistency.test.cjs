/**
 * tests/search-framework-consistency.test.cjs
 *
 * Global search framework audit. Most core list searches (Customers, Vehicles, Job
 * Cards, Billing) already share lib/useSearch.js's useDeferredSearch/matchTokens —
 * confirmed via a full-repo audit, not assumed. Two concrete, safe-to-fix issues
 * found within that audit:
 *
 * 1. InventoryDashboard.js's Ctrl+K command-palette search read `customers`,
 *    `invoices`, and `jobCards` inside a useMemo whose dependency array only listed
 *    `[q, inventory, suppliers]` — a real stale-closure bug: editing/adding a
 *    customer, invoice, or job card without also touching inventory/suppliers/the
 *    query text left the palette's results for those three record types frozen at
 *    whatever they were the last time the memo actually recomputed.
 *
 * 2. InventoryDashboard.js's main Parts search called `useDeferredValue(search)`
 *    directly instead of the shared `useDeferredSearch` hook — despite that exact
 *    hook already being imported and used elsewhere in the SAME file (the Ctrl+K
 *    palette's own search, ~line 5883). Functionally identical output, but two
 *    separate spellings of the same pattern in one file is exactly the kind of drift
 *    this review flags. Consolidated to the one shared hook.
 *
 * UPDATE — Universal Search Engine review: the two hand-rolled ranking functions flagged
 * above as "not touched, documented" (customerRank, savedCardRank) turned out to BE real
 * bugs, not just duplication — see tests/customer-search-ranking.test.cjs and
 * tests/jobcard-search-ranking.test.cjs. Both are now deleted; both modules rank via the
 * shared rankIndexed/searchAndRank directly against the same entry their filter stage
 * already built.
 *
 * UPDATE — Universal Search Boxes review: the "several smaller inline pickers don't
 * debounce" gap flagged above IS the follow-up pass; useDeferredSearch now also covers
 * the Audit Log search (and others, module by module) — so the exact-count assertion
 * below was narrowed to "these two original call sites are still present and correct"
 * rather than "exactly two exist in the whole file", since that count legitimately grows
 * as more modules adopt the shared hook and would otherwise need bumping by hand every
 * time a genuine fix lands.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const dash = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');
const ledger = fs.readFileSync(path.resolve(__dirname, '../components/common/LedgerPage.jsx'), 'utf8');

console.log('\nGlobal search framework — stale deps + duplicate debounce fixes\n');

ok('Ctrl+K palette search useMemo depends on customers/invoices/jobCards (was missing — stale results for those three record types; the dep list has since grown further with the per-type search indexes added by the Universal Search review, but still includes all of these)',
  /\}, \[dq, activeParts, suppliers, customers, invoices, jobCards, partIndex, supplierIndex, customerIndex, invoiceIndex, jobCardIndex\]\);/.test(dash));
ok('Parts search now uses the shared useDeferredSearch hook (was a separate direct useDeferredValue call)',
  /const \[debouncedSearch, isSearchStale\] = useDeferredSearch\(search\);/.test(dash));
ok('useDeferredValue is no longer imported directly (its only remaining use was the one just consolidated)',
  !/import \{[^}]*useDeferredValue/.test(dash));
// Issue 7.7/7.8/7.9 (Stock Operations review) — LedgerPage's own useDeferredSearch(q)
// call moved out of InventoryDashboard.js into components/common/LedgerPage.jsx along
// with the rest of the component; the shared hook is still used at exactly the same
// two call sites overall, just one of them now lives in a different file.
ok('the shared useDeferredSearch hook is still used at its original two call sites — Parts search in InventoryDashboard.js, LedgerPage\'s own search in components/common/LedgerPage.jsx (and now others too, as more modules adopt it)',
  (dash.match(/useDeferredSearch\(/g) || []).length >= 1 && (ledger.match(/useDeferredSearch\(/g) || []).length === 1);

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
