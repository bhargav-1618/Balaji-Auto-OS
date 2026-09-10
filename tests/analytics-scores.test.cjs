/**
 * tests/analytics-scores.test.cjs — PART-2
 *
 * The dashboard shows percentages to a workshop OWNER who makes decisions on them.
 * Every one must come from real data. This proves:
 *   - scores change when the underlying data changes (i.e. they are computed, not fixed)
 *   - a factor with NO data is excluded and reported as such, never fabricated
 *   - the old hardcoded supplier-80 fallback is gone
 */
const path = require('path');
const fs = require('fs');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};

// Load the real service via the babel require-hook used by the other suites.
require('./setup.cjs');
const A = require('../services/analyticsService.js');

console.log('\nPART-2 — dashboard scores are REAL calculations\n');

// ── computeInventoryHealth reflects actual data completeness ────────────────
{
  const empty = A.computeInventoryHealth([]);
  ok('empty inventory → null + noData (unmeasurable, NOT a fabricated 100)',
    empty.score === null && empty.noData === true && empty.factors.length === 0);
  // …and that null must not poison the composite: a totally empty shop has no
  // Workshop Score either, rather than a misleading "Fair" propped up by IH=100.
  const emptyWs = A.computeWorkshopScore({ inventory: [], sales: [], suppliers: [], alertsCount: 0 });
  ok('empty shop → Workshop Score is null + noData (not a number)',
    emptyWs.score === null && emptyWs.noData === true);

  const bare = A.computeInventoryHealth([
    { id: 'p1', name: 'x', stock: 10, minStock: 5 }, // no sku/img/supplier/price/vehicle/cat
  ]);
  const full = A.computeInventoryHealth([
    { id: 'p1', name: 'x', sku: 'S1', image: 'i', suppliers: [{ id: 's1' }], sellingPrice: 100, compatibleCars: ['Swift'], category: 'Brakes', stock: 10, minStock: 5 },
  ]);
  ok('a fully-documented part scores higher than a bare one',
    full.score > bare.score, `bare=${bare.score} full=${full.score}`);
  ok('the score is data-derived, not a constant',
    bare.score !== full.score);

  // SKU coverage factor must equal the real fraction
  const half = A.computeInventoryHealth([
    { id: 'a', name: 'a', sku: 'S1', stock: 5, minStock: 5 },
    { id: 'b', name: 'b', stock: 5, minStock: 5 },
  ]);
  const skuFactor = half.factors.find((f) => /SKU/.test(f.label));
  ok('SKU coverage = real fraction (1 of 2 = 50%)', skuFactor.pct === 50, `got ${skuFactor.pct}`);
}

// ── computeWorkshopScore: the fabricated supplier-80 fallback is GONE ────────
{
  const src = fs.readFileSync(path.resolve(__dirname, '../services/analyticsService.js'), 'utf8');
  ok('the hardcoded supplier fallback (": 80") is removed from source',
    !/withOt\.length \? [^:]*: 80/.test(src),
    'a hardcoded 80 supplier score is still present');

  // No supplier tracks on-time → supplier factor is null (no data), NOT 80.
  const noSup = A.computeWorkshopScore({
    inventory: [{ id: 'p', name: 'x', sku: 'S', sellingPrice: 5, stock: 5, minStock: 5 }],
    sales: [], suppliers: [{ id: 's', name: 'Acme' }], alertsCount: 0,
  });
  const supFactor = noSup.factors.find((f) => /Supplier/.test(f.label));
  ok('supplier factor is null when no supplier tracks on-time', supFactor.pct == null, `got ${supFactor.pct}`);
  ok('supplier factor is flagged noData', supFactor.noData === true);
  ok('the score still computes (from the factors that DO have data)',
    typeof noSup.score === 'number' && noSup.score >= 0 && noSup.score <= 100, `got ${noSup.score}`);

  // With supplier data, it IS included and reflects the real average.
  const withSup = A.computeWorkshopScore({
    inventory: [{ id: 'p', name: 'x', sku: 'S', sellingPrice: 5, stock: 5, minStock: 5 }],
    sales: [], suppliers: [{ id: 's1', onTimePct: 90 }, { id: 's2', onTimePct: 70 }], alertsCount: 0,
  });
  const sf = withSup.factors.find((f) => /Supplier/.test(f.label));
  ok('supplier factor = real average of onTimePct (90,70 → 80)', sf.pct === 80, `got ${sf.pct}`);
  ok('and with data it is NOT flagged noData', !sf.noData);
}

// ── alert pressure is real (drops as alerts rise) ───────────────────────────
{
  const calm = A.computeWorkshopScore({ inventory: [], sales: [], suppliers: [], alertsCount: 0 });
  const noisy = A.computeWorkshopScore({ inventory: [], sales: [], suppliers: [], alertsCount: 10 });
  const cf = calm.factors.find((f) => /Alert/.test(f.label));
  const nf = noisy.factors.find((f) => /Alert/.test(f.label));
  ok('alert pressure = 100 with no alerts', cf.pct === 100);
  ok('alert pressure drops as alerts rise (10 alerts → 50)', nf.pct === 50, `got ${nf.pct}`);
}

// ── achievements are all real data checks (spot-check) ──────────────────────
{
  const none = A.computeAchievements({});
  ok('no data → nothing achieved', none.every((a) => !a.done));
  const some = A.computeAchievements({ sales: [{}], suppliers: [{ id: 's' }] });
  ok('First Sale unlocks from real sales data', some.find((a) => a.label === 'First Sale').done);
  ok('100 Parts stays locked below 100', !some.find((a) => a.label === '100 Parts Added').done);
  // computeInventoryHealth now returns score:null when empty — this must not crash
  // the "Inventory Complete" milestone (null >= 90 → false, still gated on length).
  ok('computeAchievements: "Inventory Complete" stays locked on an empty inventory',
    !none.find((a) => a.label === 'Inventory Complete').done);
}

// ── ZERO-DATA EDGE MATRIX — score is meaningful & monotone as data appears ──
// The defect: a freshly-reset shop showed "Inventory Health 100% Excellent" and
// "Workshop Score 69/100 Fair" with NOTHING in it. Correct: both are "No data yet"
// until real data exists, then they compute normally.
{
  const rNull = A.ratingFor(null);
  ok('ratingFor(null) → "No data yet" band, not a green/orange colour band',
    rNull.label === 'No data yet');
  ok('ratingFor(NaN) → "No data yet" (never "Needs work" red for a non-number)',
    A.ratingFor(NaN).label === 'No data yet');
  ok('ratingFor(0) is still a real band (a measured 0 is "Needs work", not "No data")',
    A.ratingFor(0).label === 'Needs work');

  const part = { id: 'p1', name: 'Brake Pad', sku: 'BP-1', image: 'x', suppliers: [{ id: 's' }], sellingPrice: 500, compatibleCars: ['Swift'], category: 'Brakes', stock: 10, minStock: 3 };
  const recentSale = { id: 'sale1', qty: 4, revenue: 2000, createdAt: Date.now() - 2 * 86400000 };

  const cases = [
    ['empty system',        { inventory: [], sales: [], suppliers: [] },              null, null],
    ['1 part, no sales',     { inventory: [part], sales: [], suppliers: [] },          'num', 'num'],
    ['1 part + 1 sale',      { inventory: [part], sales: [recentSale], suppliers: [] },'num', 'num'],
    ['1 part + stock-out',   { inventory: [{ ...part, stock: 0 }], sales: [], suppliers: [] }, 'num', 'num'],
  ];
  for (const [label, input, expIH, expWS] of cases) {
    const ih = A.computeInventoryHealth(input.inventory);
    const ws = A.computeWorkshopScore({ ...input, alertsCount: 0 });
    const chk = (v, exp) => exp === null ? v === null : (Number.isFinite(v) && v >= 0 && v <= 100);
    ok(`[${label}] Inventory Health ${expIH === null ? 'null' : '0-100'}`, chk(ih.score, expIH), JSON.stringify(ih.score));
    ok(`[${label}] Workshop Score ${expWS === null ? 'null' : '0-100'}`, chk(ws.score, expWS), JSON.stringify(ws.score));
    ok(`[${label}] no NaN / Infinity in either result`,
      ![ih.score, ws.score].some((v) => typeof v === 'number' && !Number.isFinite(v)));
  }

  // Monotonic: a stock-out part is LESS healthy than a fully-stocked one (real signal).
  const healthy = A.computeInventoryHealth([part]).score;
  const stockedOut = A.computeInventoryHealth([{ ...part, stock: 0 }]).score;
  ok('Inventory Health drops when a part goes out of stock (still a real calculation)',
    healthy > stockedOut, `healthy=${healthy} stockedOut=${stockedOut}`);

  // Populated-state calculation is UNCHANGED by the empty-state fix.
  const populated = A.computeWorkshopScore({
    inventory: [part], sales: [recentSale],
    suppliers: [{ id: 's1', onTimePct: 90 }], alertsCount: 2,
  });
  ok('populated Workshop Score still computes a weighted number (fix is empty-only)',
    Number.isFinite(populated.score) && populated.score > 0 && !populated.noData);
}

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
