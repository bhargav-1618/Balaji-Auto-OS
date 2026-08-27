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
  ok('empty inventory → 100 (nothing to be unhealthy)', empty.score === 100);

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
}

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
