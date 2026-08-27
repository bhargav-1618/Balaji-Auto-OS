/**
 * tests/dashboard-card-grid-consistency.test.cjs
 *
 * DASHBOARD — UNIVERSAL CARD HEIGHT, EMPTY-STATE & GRID CONSISTENCY FIX.
 *
 * Root cause (confirmed by live measurement in a prior review, see
 * dashboard-drilldown-navigation.test.cjs's "Workspace Optimization" section): three of
 * the Dashboard's six widget grid rows already use `items-start` so a much-taller sibling
 * doesn't force dead whitespace into a shorter one — but that same override meant a card
 * with NO content (an empty-state "No sales recorded yet") had nothing stopping it from
 * collapsing to a sliver next to a populated sibling in the same row. The fix is a
 * structural floor, not a per-widget hack: every Dashboard card now renders through ONE
 * shared shell (OverviewCard) with a `min-h-*` floor + `flex flex-col`, and every
 * empty-state renders through ONE shared, vertically-centered component (DashEmpty) that
 * fills whatever space that floor gives it — never a bare top-left `<p>` again.
 *
 * Source-pattern assertions, matching this repo's established test convention.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const inv = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');
// Scope to OverviewView's own source for checks that would otherwise false-positive
// against unrelated components elsewhere in this file that happen to reuse similar
// wording (e.g. Analytics' own "No sales recorded yet" table rows, the Parts table's
// own filter-empty message) — those are legitimately out of this task's scope.
const ovStart = inv.indexOf('function OverviewView({');
const ovEnd = inv.indexOf('\n}\n', ovStart);
const overview = inv.slice(ovStart, ovEnd);

console.log('\nDashboard — universal card height, empty-state & grid consistency\n');

// --- Part 1: ONE shared card shell, not per-widget hacks ---
ok('DASH_CARD_MIN_H is a single named floor, not a magic number inlined per widget',
  /const DASH_CARD_MIN_H = 'min-h-\[260px\]';/.test(inv));
ok('OverviewCard applies the floor + flex-col to every card that renders through it',
  /function OverviewCard\(\{ children, className = '' \}\) \{\s*return \(\s*<div className=\{`rounded-2xl p-4 backdrop-blur-sm \$\{DASH_CARD_MIN_H\} flex flex-col \$\{className\}`\}/.test(inv));
ok('ScoreCard (Inventory Health / Workshop Score) now renders through the SAME shared shell instead of its own hand-rolled div',
  /function ScoreCard\(\{ title, icon: Icon, score, suffix = '%', factors, note \}\) \{\s*const r = ratingFor\(score\);\s*return \(\s*<OverviewCard>/.test(inv));
ok('the two previously hand-rolled Insights/Workshop Progress divs are gone — both now use OverviewCard',
  !/lg:col-span-2 rounded-2xl p-4 backdrop-blur-sm" style=\{\{ background: 'rgba\(var\(--fg-rgb\),0\.03\)'/.test(inv) &&
  (inv.match(/<OverviewCard(?:\s+className="lg:col-span-2")?>/g) || []).length >= 6);
ok('no divergent card background (0.02 vs 0.03 alpha / with-or-without backdrop-blur) remains — every Dashboard card uses the one OverviewCard shape now',
  !/rounded-2xl p-4 \$\{className\}.*rgba\(var\(--fg-rgb\),0\.02\)/.test(inv));

// --- Part 2: ONE shared, vertically-centered empty state, not a bare top-left <p> ---
ok('DashEmpty exists as the one shared empty-state body (icon + title + optional hint), centered via flex-1 in the parent\'s flex column',
  /function DashEmpty\(\{ icon: Icon, title, hint \}\) \{\s*return \(\s*<div className="flex-1 flex flex-col items-center justify-center text-center gap-1\.5 py-4">/.test(inv));
ok('every Dashboard widget\'s empty state now renders DashEmpty, not a bare `<p className="text-sm text-white/40 py-4 text-center">`',
  (inv.match(/<DashEmpty icon=\{/g) || []).length >= 7);
ok('the old bare-<p> empty-state idiom is gone from EVERY Dashboard widget (Reorder Center/Low Stock/Recent Activity/Top Selling/Top Suppliers/Pending Supplier) — scoped to OverviewView only, since unrelated views elsewhere in this file (Analytics\' own sales tables, the Parts table\'s own filter-empty message) legitimately keep their own bare <p> for a different context',
  !/text-sm text-white\/45 py-4 text-center/.test(overview) &&
  !/text-sm text-white\/45 py-6 text-center/.test(overview));
ok('Insights\' own "no insights yet" branch also uses DashEmpty (was a bare <p>, inconsistent with its sibling "All caught up" branch which already had an icon)',
  /No insights yet.*hint="Add parts and record sales to see trends here\."/.test(inv) || /title="No insights yet" hint="Add parts and record sales to see trends here\."/.test(inv));
ok('Insights\' "All caught up" branch is also flex-1 so IT vertically centers too (previously py-4, top-aligned like the bug case)',
  /\) : \(inventory\.length === 0 && sales\.length === 0 && suppliers\.length === 0\) \? \(\s*<DashEmpty[\s\S]{0,120}\/>\s*\) : \(\s*<div className="flex-1 flex items-center gap-2\.5 text-sm text-white\/60">/.test(overview));

// --- Part 3, REVISED: a follow-up brief ("FIX ONLY THIS DASHBOARD LAYOUT BUG — CARD
// HEIGHTS MUST NOT COLLAPSE WITH DATA") deliberately reversed the items-start decision
// this Part originally guarded. Its CORE RULE is "same row = same structural height",
// achieved via CSS Grid's default align-items:stretch — so items-start was REMOVED from
// all three rows that had it. DASH_CARD_MIN_H (Part 1) remains as a backstop for the case
// stretch can't help with (every card in a row short/empty at once), but row-equal-height
// is now primarily grid-driven, not min-height-driven. This guard now checks the opposite:
// items-start is gone everywhere, and every multi-column row uses the identical plain
// grid className. ---
ok('Insights + Workshop Progress row no longer uses items-start — default grid stretch now equalizes this row too, scoped to the actual grid row not a comment mentioning both names',
  /<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">\s*<OverviewCard className="lg:col-span-2">\s*<h3 className="text-xs uppercase tracking-wider text-white\/45 mb-3 flex items-center gap-2"><Sparkles/.test(overview) &&
  /Workshop Progress<\/h3>/.test(overview));
ok('Reorder Center + Quick Actions row no longer uses items-start',
  /<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">\s*<OverviewCard className="lg:col-span-2">\s*<h3 className="text-xs uppercase tracking-wider text-white\/45 mb-3 flex items-center gap-2"><ShoppingCart[^>]*\/> Reorder Center/.test(overview) &&
  /Quick Actions<\/h3>/.test(overview));
ok('Low Stock + Recent Activity + Top Selling row no longer uses items-start — the flagship reported case now gets true row-equal outer-card height via default stretch',
  /<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">\s*<OverviewCard>\s*<h3 className="text-xs uppercase tracking-wider text-white\/45 mb-3 flex items-center gap-2"><AlertTriangle[^>]*\/> Low Stock Alerts/.test(overview) &&
  /Recent Activity<\/h3>/.test(overview) && /Top Selling/.test(overview));
ok('the Overview/Inventory Health row is unchanged — it never carried items-start and still doesn\'t, since default stretch was always its behavior',
  /Overview \(date-range driven\) \+ Inventory Health \(live\) \*\/\}\s*\n\s*<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">/.test(overview));
ok('no items-start override survives anywhere in OverviewView — one uniform grid mechanism across all rows, per the newer brief\'s explicit priority',
  !/grid grid-cols-1 lg:grid-cols-3 gap-4 items-start/.test(overview));

// --- Part 4: information density preserved — DashEmpty replaces the empty MESSAGE only,
// never removes real rows/values/actions from the populated branch ---
ok('Top Selling\'s populated branch (product/qty/revenue table) is completely untouched by the empty-state change',
  /topSelling\.map\(\(t\) => \(\s*<div key=\{t\.partId\} className="grid grid-cols-\[1fr_auto_auto\] gap-x-4 items-center text-sm">/.test(inv));
ok('Reorder Center\'s populated branch ("View all N reorder items" link, per-row Order button) is untouched',
  /reorder\.length > 6 && \(\s*<button onClick=\{\(\) => onNavigate\('inventory', \{ subView: 'parts', invFilter: 'reorder' \}\)\}/.test(inv));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
