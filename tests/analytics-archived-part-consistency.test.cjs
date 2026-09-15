/**
 * tests/analytics-archived-part-consistency.test.cjs
 *
 * BUG-LIVE-P2-01 regression guard — "Analytics: archived-part inventory
 * valuation inconsistency."
 *
 * AnalyticsView's `parts` memo (the ONE list feeding Total Locked Capital,
 * Total Expected Profit, Top Profitable Parts, Fast Movers, Dead Stock and
 * Aging) filtered only by category/brand — it never excluded archived
 * parts, unlike every other inventory-derived view in the app: the
 * Inventory dashboard, Reports -> Inventory, computeInventoryHealth /
 * computeWorkshopScore (services/analyticsService.js), and even this same
 * Analytics page's own "N unique products / N inventory records" summary
 * line a few dozen lines below, which correctly built its own separate
 * `active = inventory.filter(p => !p.archived)` list.
 *
 * Net effect observed live in production: an archived part with real
 * stock/cost/price counted toward Locked Capital, Expected Profit, and
 * appeared in Top Profitable Parts, while the record/product counts (and
 * Inventory dashboard, and Reports -> Inventory) correctly read it as
 * excluded — an internally contradictory Analytics page describing the
 * same underlying data two different ways.
 *
 * Renders the REAL AnalyticsView component (not a mirror) with one active
 * and one archived part, both with recorded sales (so both are eligible
 * for the Top Profitable Parts leaderboard, which requires units > 0) and
 * proves the archived part is excluded from every affected figure while
 * the active part is correctly included.
 */
require('./setup.cjs');
const fs = require('fs');
const path = require('path');
let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};

const src = fs.readFileSync(path.resolve(__dirname, '../components/inventory/views/AnalyticsView.jsx'), 'utf8');

console.log('\nAnalytics — archived parts must be excluded from every inventory-derived figure\n');

// ---- 1. Source shape: the shared `parts` list must exclude archived, matching
//    the predicate the page's own "unique products" line already uses. --------
ok('the shared `parts` memo now excludes archived parts',
  /const parts = useMemo\(\s*\(\) =>\s*inventory\.filter\(\s*\(p\) =>\s*!p\.archived &&/.test(src));
ok('the "unique products / inventory records" line still uses its own independently-correct filter (unchanged)',
  /const active = inventory\.filter\(\(p\) => !p\.archived\);/.test(src));

// ---- 2. Behavioural: render the REAL component with one active + one archived
//    part, both with recorded sales units, and inspect the actual rendered DOM. --
const React = require('react');
const { act } = require('react');
const { createRoot } = require('react-dom/client');
const { AnalyticsView } = require('../components/inventory/views/AnalyticsView.jsx');

const activePart = {
  id: 'active1', name: 'QA_Active_Part', archived: false,
  stock: 10, purchasePrice: 100, sellingPrice: 200, salesCount: 5,
  category: 'Test', categories: ['Test'],
};
const archivedPart = {
  id: 'archived1', name: 'QA_Archived_Part', archived: true,
  stock: 17, purchasePrice: 300, sellingPrice: 500, salesCount: 3,
  category: 'Test', categories: ['Test'],
};
const sales = [
  { partId: 'active1', qty: 5, revenue: 1000, cost: 500, profit: 500 },
  { partId: 'archived1', qty: 3, revenue: 1500, cost: 900, profit: 600 },
];

const host = document.createElement('div');
document.body.appendChild(host);
let crashed = null;
try {
  act(() => {
    createRoot(host).render(React.createElement(AnalyticsView, {
      inventory: [activePart, archivedPart],
      sales,
      rollups: [], restocks: [], auditLog: [], stockAdjustments: [],
      onEditPart: () => {}, demoMode: true, demoCanExport: true,
      onProtectedAction: () => {}, actorEmail: 'qa@test',
    }));
  });
} catch (e) { crashed = e; }
ok('AnalyticsView renders a mixed active/archived inventory without crashing', !crashed, crashed && crashed.message);

const bodyText = host.textContent || '';

// Expected (active-only): Locked Capital = 10*100 = 1,000. Expected Profit =
// 10*(200-100) = 1,000. If the archived part leaked in, these would instead
// read 6,100 / 4,400 (i.e. 5,100 / 3,400 higher — the exact production numbers
// reported live: archived-part Locked Capital 17*300=5,100, Expected Profit
// 17*(500-300)=3,400).
ok('Total Locked Capital excludes the archived part (reads 1,000, not 6,100)',
  /Total Locked Capital[\s\S]{0,80}?1,000/.test(bodyText) || /₹1,000[\s\S]{0,200}Total Locked Capital/.test(bodyText),
  bodyText.slice(bodyText.indexOf('Total Locked Capital') - 10, bodyText.indexOf('Total Locked Capital') + 60));
ok('the archived part\'s capital (₹5,100) is nowhere in the KPI row',
  !/5,100/.test(bodyText));
ok('the archived part\'s expected profit (₹3,400) is nowhere in the KPI row',
  !/3,400/.test(bodyText));

// Note: the DOM concatenates adjacent text nodes with no literal space between
// them (real browsers add visual gaps via layout, not characters), so match
// digits immediately preceding "unique product" without a \b/whitespace
// requirement on the left.
ok('"unique products / inventory records" correctly reads 1 (active-only), not 0',
  /1\s*unique product/.test(bodyText));
ok('...and both counts AGREE with the KPI cards (no internal contradiction)',
  !/0\s*unique product/.test(bodyText));

ok('Top Profitable Parts includes the active part',
  bodyText.includes('QA_Active_Part'));
ok('Top Profitable Parts EXCLUDES the archived part, even though it has recorded sales units',
  !bodyText.includes('QA_Archived_Part'));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
