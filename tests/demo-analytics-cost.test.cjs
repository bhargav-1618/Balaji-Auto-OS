/**
 * tests/demo-analytics-cost.test.cjs
 *
 * BUG-LIVE-005 regression. The Analytics "Monthly Profit Trend" reads the monthly
 * rollups; the demo seed's genRollups() never accumulated `cost`, so the trend
 * showed COST ₹0 / MARGIN 100% while every other panel (built from the sales
 * ledger, which carries cost) showed real margins.
 *
 * This asserts the demo rollups now carry a real cost that reconciles with the
 * per-month revenue and profit, and that genRollups accumulates it.
 */
require('./setup.cjs');
const fs = require('fs');
const path = require('path');
const { getDemoData } = require('../lib/demoData.js');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};

console.log('\nBUG-LIVE-005 — demo analytics cost / profit / margin\n');

const src = fs.readFileSync(path.resolve(__dirname, '../lib/demoData.js'), 'utf8');
ok('genRollups accumulates cost from the sale record',
  /map\[key\]\.cost \+= \(s\.cost \|\| 0\)/.test(src) && /revenue: 0, cost: 0, profit: 0/.test(src));

const { sales, salesRollups } = getDemoData();

ok('there are monthly rollups', salesRollups.length > 0);
ok('every rollup carries a numeric cost field',
  salesRollups.every((r) => typeof r.cost === 'number'),
  JSON.stringify(salesRollups[0]));

const totRev = salesRollups.reduce((s, r) => s + r.revenue, 0);
const totCost = salesRollups.reduce((s, r) => s + r.cost, 0);
const totProfit = salesRollups.reduce((s, r) => s + r.profit, 0);

ok('aggregate rollup cost is > 0 (not the ₹0 bug)', totCost > 0, `totCost = ${totCost}`);
ok('aggregate cost is a real fraction of revenue (10%–95%)',
  totCost > totRev * 0.1 && totCost < totRev * 0.95,
  `cost/revenue = ${(totCost / totRev * 100).toFixed(1)}%`);

// The Analytics trend computes totProfit = totRev - totCost. With cost populated it
// must equal the sum of the per-month profit the rollups already carried.
ok('revenue − cost reconciles with the rollups\' own profit (±₹1)',
  Math.abs((totRev - totCost) - totProfit) <= 1,
  `revenue−cost = ${Math.round(totRev - totCost)}, sum(profit) = ${Math.round(totProfit)}`);

const margin = totRev > 0 ? (totRev - totCost) / totRev * 100 : 0;
ok('resulting margin is a plausible workshop margin, not 100%',
  margin > 5 && margin < 95,
  `margin = ${margin.toFixed(1)}%`);

// Cross-check against the sales ledger (the source the rest of the page uses).
const ledgerCost = sales.reduce((s, x) => s + (x.cost || 0), 0);
ok('rollup cost matches the sales-ledger cost (±0.5%)',
  ledgerCost > 0 && Math.abs(totCost - ledgerCost) / ledgerCost < 0.005,
  `rollup ${Math.round(totCost)} vs ledger ${Math.round(ledgerCost)}`);

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
