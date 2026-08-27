/**
 * tests/dashboard-drilldown-navigation.test.cjs
 *
 * Universal Drill-Down Navigation review — "View all N reorder items" (and every
 * other Dashboard KPI/summary drill-down that shares the same onNavigate(tab, opts)
 * call) used to switch the Dashboard's own activeTab IN PLACE, silently replacing
 * the Dashboard the owner was monitoring with whatever module the link pointed at,
 * landing on a full workspace (search/filter/sort/pagination/real actions) that
 * deserved the SAME new-tab treatment this app already gives View Customer/Vehicle/
 * Invoice/Job Card from a detail panel — not a second, weaker mechanism.
 *
 * Fix: onNavigate now opens the destination in a new browser tab via the SAME
 * ?open=<key>:<query>#<tab> deep-link router those other flows already use (a new
 * `nav:<json>` key carrying the {tab, opts} shape onNavigate always received), so:
 *   - the Dashboard tab is left completely untouched (Requirement 2/5),
 *   - the destination lands pre-filtered on ITS OWN first render (Requirement 1/3),
 *   - because only a FILTER description crosses the tab boundary (never a frozen
 *     list), the destination always reflects current data, not a stale count
 *     (Part 6 — a part restocked between click and tab-open is correctly no longer
 *     "needs reorder" there).
 *
 * Deliberately NOT touched: InventoryOverview's own onNavigate (Inventory's internal
 * Dashboard/Parts/Stock/PO sub-tabs) — that's navigation WITHIN a module the user is
 * already inside, not a cross-module drill-down, so it correctly stays same-tab
 * (Part 10 — this is normal in-page tab switching, not a "leave the workspace"
 * interaction). Also not touched: Customers'/SupplierDirectory's own in-panel
 * "Show all N job cards/invoices/parts" buttons — those expand a compact, related,
 * already-in-view dataset in place, exactly the "In-page interaction" case Part 3
 * calls for, not a drill-down to a separate workspace.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const dash = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');

console.log('\nUniversal Dashboard drill-down navigation (View All / KPI / Insights)\n');

// --- the shared URL builder exists and is documented as reusable ---
ok('dashboardDrillDownUrl exists as a shared, reusable helper (not inlined per call site)',
  /function dashboardDrillDownUrl\(tab, opts\) \{/.test(dash));
ok('it reuses the existing ?open=<key>:<query>#<tab> router (nav: key) rather than inventing a second navigation mechanism',
  /return `\/\?open=nav:\$\{payload\}#\$\{tab\}`/.test(dash));
ok('it JSON-encodes the full {tab, opts} shape, not just a single short alias — carries whatever filter state the summary promised',
  /JSON\.stringify\(\{ tab, opts: opts \|\| \{\} \}\)/.test(dash));

// --- the Dashboard's OWN onNavigate (OverviewView) now opens a new tab ---
const overviewNavStart = dash.indexOf("isAdmin={isAdmin}\n            onNavigate={(tab, opts) => {");
ok('OverviewView call site anchor found', overviewNavStart !== -1);
const overviewNavBlock = dash.slice(overviewNavStart, overviewNavStart + 1300);
ok('the top-level Dashboard\'s onNavigate opens the destination in a new browser tab (window.open(..., \'_blank\'))',
  /window\.open\(dashboardDrillDownUrl\(tab, opts\), '_blank'\)/.test(overviewNavBlock));
ok('it no longer switches the Dashboard\'s own activeTab in place (the confirmed bug — same-tab replacement)',
  !/setActiveTab\(tab\);\s*\n\s*if \(opts\?\.subView\) setInvSubView/.test(overviewNavBlock));

// --- InventoryOverview's OWN onNavigate (module-internal sub-tab switching) is UNCHANGED — same-tab ---
ok('InventoryOverview\'s own onNavigate (switching Inventory\'s OWN Dashboard/Parts/Stock/PO sub-tabs) still navigates in-page — this is not a cross-module drill-down',
  /onNavigate=\{\(tab, opts\) => \{ if \(opts\?\.subView\) setInvSubView\(opts\.subView\); if \(opts\?\.invFilter\) setInvFilter\(opts\.invFilter\); if \(opts\?\.stockFilter\) setPendingStockFilter\(opts\.stockFilter\); setCategoryFilter\('All'\); setSearch\(''\); \}\}/.test(dash));

// --- the deep-link parser (mount effect) understands the new `nav:` key ---
const parserJsonStart = dash.indexOf("tabPart === 'nav' && query");
ok('the deep-link parser decodes the nav: payload', parserJsonStart !== -1);
ok('bad/corrupt JSON in the nav payload fails safe (try/catch), never a broken generic page (Part 11)',
  /try \{ navPayload = JSON\.parse\(decodeURIComponent\(query\)\); \} catch \{ navPayload = null; \}/.test(dash));
ok('the destination tab is resolved from the DECODED payload\'s own .tab (not a fixed alias) so `nav:` can target any module',
  /const targetTab = \(navPayload\?\.tab && TAB_KEYS\.includes\(navPayload\.tab\)\)/.test(dash));

const parserOptsStart = dash.indexOf("tabPart === 'nav' && navPayload");
ok('opts-application block for the nav payload found', parserOptsStart !== -1);
const parserOptsBlock = dash.slice(parserOptsStart, parserOptsStart + 1300);
ok('opts are applied scoped to the correct target tab (inventory vs suppliers vs billing vs jobcards), not applied unconditionally regardless of destination',
  /if \(targetTab === 'inventory'\) \{[\s\S]{0,600}\} else if \(targetTab === 'suppliers' && opts\.subView\) \{[\s\S]{0,150}\} else if \(targetTab === 'billing' && opts\.statusFilter\) \{[\s\S]{0,150}\} else if \(targetTab === 'jobcards' && opts\.kpiFilter\) \{/.test(parserOptsBlock));

// --- every Dashboard drill-down routes through the SAME onNavigate (one universal rule, not per-card logic) ---
ok('the Reorder Center "View all N reorder items" link calls onNavigate (inherits the new-tab fix automatically, no separate patch needed)',
  /onClick=\{\(\) => onNavigate\('inventory', \{ subView: 'parts', invFilter: 'reorder' \}\)\}/.test(dash));
ok('Insights list items with a nav target call the SAME onNavigate (one shared mechanism for every KPI drill-down)',
  /onClick=\{\(\) => onNavigate\(it\.nav\.tab, it\.nav\.opts\)\}/.test(dash));

// --- confirmed gap fixed: Low Stock Alerts had no way to see beyond its top-5 cap ---
ok('Low Stock Alerts now has a "View all" link once the list exceeds the shown top-5, using the distinct (narrower) invFilter=\'low\', not a duplicate of Reorder Center\'s \'reorder\' filter',
  /lowStock\.length > 5\) \{[\s\S]{0,20}<button onClick=\{\(\) => onNavigate\('inventory', \{ subView: 'parts', invFilter: 'low' \}\)\}/.test(dash) || /onClick=\{\(\) => onNavigate\('inventory', \{ subView: 'parts', invFilter: 'low' \}\)\}/.test(dash));
ok('Top Suppliers links to the real, already-existing Supplier Performance workspace rather than a fake/duplicate destination',
  /onClick=\{\(\) => onNavigate\('suppliers', \{ subView: 'performance' \}\)\}/.test(dash));

// --- Workspace Optimization (Part 7/8), REVISED: an earlier pass here added
// items-start to these two rows so a shorter sibling card (e.g. Quick Actions'
// fixed 5-button panel) would size to its OWN content instead of being
// stretched to a taller sibling's height (Reorder Center's up-to-6-row table).
// A later, more explicit brief ("FIX ONLY THIS DASHBOARD LAYOUT BUG — CARD
// HEIGHTS MUST NOT COLLAPSE WITH DATA") deliberately REVERSES that call: its
// CORE RULE is "same row = same structural height", and it explicitly accepts
// the dead-space tradeoff ("the card stretches, the content remains naturally
// positioned... do not stretch the two rows vertically just to fill every
// pixel"). items-start was removed from all three rows that had it so CSS
// Grid's default align-items:stretch does the equalizing — every row now
// auto-sizes to its tallest natural-content member and grows every sibling's
// OUTER card to match, while flex flex-col + DashEmpty still keep each card's
// own inner content naturally positioned (not force-stretched) within that
// taller outer box. ---
console.log('\nWorkspace Optimization — row-equal-height via default grid stretch (revised)\n');
ok('Reorder Center + Quick Actions row no longer uses items-start (reversed: same-row-equal-height now outranks per-card content-sizing; Quick Actions\' outer card grows to match Reorder Center, its 5 buttons stay naturally positioned at the top)',
  /Reorder Center \+ Quick Actions[\s\S]{0,1100}className="grid grid-cols-1 lg:grid-cols-3 gap-4"/.test(dash) &&
  !/Reorder Center \+ Quick Actions[\s\S]{0,1100}className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start"/.test(dash));
ok('Low Stock Alerts + Recent Activity + Top Selling row no longer uses items-start (the flagship reported case — all three cards in this row now share the same outer height, with DashEmpty centering itself inside whatever height that turns out to be for a 0-record widget)',
  /Low Stock \+ Recent Activity \+ Top Selling[\s\S]{0,900}className="grid grid-cols-1 lg:grid-cols-3 gap-4"/.test(dash) &&
  !/Low Stock \+ Recent Activity \+ Top Selling[\s\S]{0,900}className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start"/.test(dash));
ok('the Insights + Workshop Progress row (the original reference fix this pattern was extended from) has ALSO had items-start removed — the newer brief applies uniformly, not just to the two later rows',
  !/className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start"/.test(dash));
// The Overview/Inventory Health row never carried items-start (it was already
// naturally balanced) — still true and still untouched under the new rule too,
// since default stretch was already its behavior.
ok('the Overview + Inventory Health row is unchanged — plain grid stretch, as it always was',
  /Overview \(date-range driven\) \+ Inventory Health \(live\) \*\/\}\s*\n\s*<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">/.test(dash));
// Every multi-column Dashboard row now uses the exact same plain grid className
// — one consistent mechanism, not per-row special-casing.
ok('all four multi-column Dashboard rows share the identical plain grid className (no row-specific items-start/items-stretch overrides remain anywhere in the component)',
  (dash.match(/className="grid grid-cols-1 lg:grid-cols-3 gap-4"/g) || []).length >= 4 &&
  !/grid grid-cols-1 lg:grid-cols-3 gap-4 items-start/.test(dash));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
