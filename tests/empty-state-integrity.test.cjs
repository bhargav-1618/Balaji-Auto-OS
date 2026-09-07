/**
 * tests/empty-state-integrity.test.cjs
 *
 * PHASE 24 — EMPTY-STATE / CARDINALITY / UI RESILIENCE INTEGRITY.
 *
 * Central question: does every derived value stay FINITE, every count stay CORRECT,
 * every pager stay IN-RANGE, and every chart stay CRASH-FREE when a collection holds
 * 0, 1, 2 or "many" records — including while the dataset is SHRINKING under an active
 * view?
 *
 * The expected values here are computed by INDEPENDENT oracles (hand-derived slice
 * math / hand-summed truth tables), never by calling the production helper whose
 * output is under test. The REAL shipped functions are exercised directly — nothing
 * is re-implemented except a chart's 3-line path formula, which is reproduced
 * verbatim next to its own source so a divergence is a test failure.
 *
 * Cross-checks: Phase 16 (search/filter/sort/pagination), Phase 21 (malformed input),
 * Phase 22 (export), Phase 23 (analytics source-of-truth).
 */
require('./setup.cjs');
const fs = require('fs');
const path = require('path');
const React = require('react');
const { render, cleanup, act, fireEvent } = require('@testing-library/react');

const Pagination = require('../components/inventory/Pagination.jsx').default;
const SearchSelect = require('../components/common/SearchSelect.jsx').default;
const {
  computeRange, ratingFor, computeInventoryHealth, computeWorkshopScore,
  computeAlerts, computeInsights, computeAchievements, computeWorkshopProgress,
} = require('../services/analyticsService');
const {
  buildVehicleIndex, computeVehicleStats, isExpiring, daysUntil,
} = require('../lib/vehicleStats');
const { invoiceTotals, isRealized, isOutstanding } = require('../services/billingService');
const { totalsOf } = require('../components/billing/BillingModule.jsx');
const { invTotals } = require('../components/InventoryDashboard.js');
const { trendPct } = require('../lib/format');
const { searchAndRank, rankIndexed } = require('../lib/useSearch');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const flush = () => new Promise((r) => setTimeout(r, 0));

// Deep scan: is every leaf value of an object a finite number or a string with no
// "NaN" / "Infinity" / "undefined" / "null" token? This is the property the whole
// phase turns on — a KPI must never render one of those words.
const BAD = /\b(NaN|Infinity|undefined|null)\b/;
function scanFinite(node, trailOfPath = '$') {
  const problems = [];
  const walk = (v, p) => {
    if (v == null) return;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) problems.push(`${p} = ${v}`);
    } else if (typeof v === 'string') {
      if (BAD.test(v)) problems.push(`${p} = "${v}"`);
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${p}[${i}]`));
    } else if (typeof v === 'object') {
      Object.entries(v).forEach(([k, x]) => walk(x, `${p}.${k}`));
    }
  };
  walk(node, trailOfPath);
  return problems;
}

console.log('\nPHASE 24 — empty-state / cardinality / UI resilience integrity\n');

(async () => {
// =====================================================================
// 1 — PAGINATION: independent oracle vs the shipped <Pagination>
// =====================================================================
console.log('1  Pagination — 0 / 1 / 2 / pageSize / +1 / 2x / shrink\n');

// Oracle: hand-derived from first principles.
function pageOracle(total, page, per) {
  const pageCount = Math.max(1, Math.ceil(total / per));
  const safe = Math.min(Math.max(1, page), pageCount);
  const from = total === 0 ? 0 : (safe - 1) * per + 1;
  const to = Math.min(safe * per, total);
  return {
    pageCount, safe, from, to,
    hidden: pageCount <= 1,
    prevDisabled: safe <= 1,
    nextDisabled: safe >= pageCount,
  };
}

function renderPager(total, page, per = 20) {
  let current = page;
  const onPage = (p) => { current = p; };
  let container;
  act(() => { container = render(React.createElement(Pagination, { page, total, perPage: per, onPage })); });
  return { container, get page() { return current; } };
}

for (const [label, total, per] of [
  ['0 records', 0, 20],
  ['1 record', 1, 20],
  ['2 records', 2, 20],
  ['exactly one page', 20, 20],
  ['one page + 1', 21, 20],
  ['two full pages', 40, 20],
  ['many (237)', 237, 20],
]) {
  const exp = pageOracle(total, 1, per);
  const { container } = renderPager(total, 1, per);
  const txt = container.container.textContent || '';
  if (exp.hidden) {
    ok(`${label}: pager renders nothing (single page fits)`, txt.trim() === '', `got "${txt.trim()}"`);
  } else {
    ok(`${label}: shows "${exp.from}–${exp.to} of ${total}"`, txt.includes(`${exp.from}–${exp.to} of ${total}`), `got "${txt}"`);
    ok(`${label}: shows page "1 / ${exp.pageCount}"`, txt.includes(`1 / ${exp.pageCount}`), `got "${txt}"`);
    const prev = container.container.querySelector('button[aria-label="Previous page"]');
    const next = container.container.querySelector('button[aria-label="Next page"]');
    ok(`${label}: Previous disabled on page 1`, prev && prev.disabled === true);
    ok(`${label}: Next ${exp.nextDisabled ? 'disabled' : 'enabled'}`, next && next.disabled === exp.nextDisabled);
  }
  cleanup();
}

// SHRINK: mounted on page 3, dataset collapses to 5 rows → the pager's own effect
// must pull the caller's page back to 1 (Phase 16 clamp).
{
  let current = 3;
  const onPage = (p) => { current = p; };
  let r;
  act(() => { r = render(React.createElement(Pagination, { page: 3, total: 100, perPage: 20, onPage })); });
  await act(async () => { r.rerender(React.createElement(Pagination, { page: 3, total: 5, perPage: 20, onPage })); await flush(); });
  ok('shrink 100→5 while on page 3: onPage() pulled back to 1', current === 1, `page is ${current}`);
  // and after the caller re-renders with the corrected page, the pager is hidden
  act(() => { r.rerender(React.createElement(Pagination, { page: 1, total: 5, perPage: 20, onPage })); });
  ok('shrink: with 5 rows the pager then renders nothing (1 page)', (r.container.textContent || '').trim() === '');
  cleanup();
}

// STALE PAGE INDEX: page far past the end must never display "7 / 2".
{
  const exp = pageOracle(30, 7, 20);            // 2 pages, asked for page 7
  let r;
  act(() => { r = render(React.createElement(Pagination, { page: 7, total: 30, perPage: 20, onPage: () => {} })); });
  const txt = r.container.textContent || '';
  ok('stale page 7 of 2: counter clamps to "2 / 2", never "7 / 2"', txt.includes('2 / 2') && !txt.includes('7 / 2'), `got "${txt}"`);
  ok('stale page 7 of 2: Next is disabled (already at the real last page)', r.container.querySelector('button[aria-label="Next page"]').disabled === true);
  cleanup();
}

// =====================================================================
// 2 — ANALYTICS KPIs: every value FINITE at 0 / 1 / 2 records
// =====================================================================
console.log('\n2  Analytics KPIs — finite & zero-safe at 0 / 1 / 2 records\n');

const onePart = { id: 'p1', name: 'Air Filter', sku: 'AF-1', stock: 4, minStock: 2, purchasePrice: 100, sellingPrice: 150, gst: 18, suppliers: [{ id: 's1', name: 'ACME' }] };
const twoParts = [onePart, { id: 'p2', name: 'Oil Filter', sku: 'OF-1', stock: 0, minStock: 3, purchasePrice: 80, sellingPrice: 120, suppliers: [] }];

for (const [label, inv] of [['0 parts', []], ['1 part', [onePart]], ['2 parts', twoParts]]) {
  const h = computeInventoryHealth(inv);
  ok(`computeInventoryHealth(${label}): score is a finite 0-100`, Number.isFinite(h.score) && h.score >= 0 && h.score <= 100, JSON.stringify(h));
  ok(`computeInventoryHealth(${label}): every factor pct finite`, scanFinite(h).length === 0, scanFinite(h).join('; '));
  if (label === '0 parts') ok('computeInventoryHealth(0 parts): score 100, factors []', h.score === 100 && h.factors.length === 0);

  const w = computeWorkshopScore({ inventory: inv, sales: [], suppliers: [], alertsCount: 0 });
  ok(`computeWorkshopScore(${label}): score finite 0-100`, Number.isFinite(w.score) && w.score >= 0 && w.score <= 100, JSON.stringify(w.score));
  ok(`computeWorkshopScore(${label}): no NaN/Infinity anywhere`, scanFinite(w).length === 0, scanFinite(w).join('; '));

  const wp = computeWorkshopProgress({ inventory: inv, invoices: [], jobCards: [], vehicles: [], sales: [] });
  ok(`computeWorkshopProgress(${label}): every metric value/pct/hint clean`, scanFinite(wp).length === 0, scanFinite(wp).join('; '));
  ok(`computeWorkshopProgress(${label}): every pct is a finite 0-100`, wp.every((m) => Number.isFinite(m.pct) && m.pct >= 0 && m.pct <= 100), JSON.stringify(wp.map((m) => m.pct)));

  const al = computeAlerts(inv, [], null, {});
  ok(`computeAlerts(${label}): returns an array, no throw`, Array.isArray(al));

  const ins = computeInsights({ inventory: inv, sales: [], suppliers: [], purchaseOrders: [], restocks: [], invoices: [], jobCards: [], customers: [], stockAdjustments: [] });
  ok(`computeInsights(${label}): array, every text clean`, Array.isArray(ins) && ins.every((i) => !BAD.test(String(i.text || i.title || ''))));

  const ach = computeAchievements({ inventory: inv, sales: [], suppliers: [], purchaseOrders: [], restocks: [] });
  ok(`computeAchievements(${label}): no NaN/Infinity`, scanFinite(ach).length === 0, scanFinite(ach).join('; '));
}

// computeRange must always yield a finite window, even with a null/empty custom range
for (const key of ['today', '7d', '30d', 'custom', 'all', undefined]) {
  const r = computeRange(key, null);
  ok(`computeRange(${key}, null): start<=end, both finite`, Number.isFinite(r.start) && Number.isFinite(r.end) && r.start <= r.end, JSON.stringify(r));
}
ok('ratingFor(0) and ratingFor(100) both return a band', !!ratingFor(0).label && !!ratingFor(100).label);

// =====================================================================
// 3 — VEHICLE STATS at 0 / 1 / 2 vehicles
// =====================================================================
console.log('\n3  Vehicle analytics — 0 / 1 / 2 vehicles\n');

{
  const idx0 = buildVehicleIndex([], []);
  const s0 = computeVehicleStats([], idx0, {});
  ok('computeVehicleStats(0 vehicles): all counts 0', s0.total === 0 && s0.active === 0 && s0.revenue === 0 && s0.repeat === 0);
  ok('computeVehicleStats(0 vehicles): avgVisits is "0" not "NaN"', s0.avgVisits === '0', s0.avgVisits);
  ok('computeVehicleStats(0 vehicles): nothing NaN/Infinity', scanFinite(s0).length === 0, scanFinite(s0).join('; '));

  // 1 vehicle, 1 completed job card, 1 realized invoice
  const v1 = { id: 'v1', regNo: 'TS09AB1234', status: 'Active' };
  const jobs = [{ id: 'j1', regNo: 'TS09AB1234', status: 'Delivered', deliveredAt: 0 }];
  const invs = [{ id: 'i1', regNo: 'TS09AB1234', status: 'Paid', payments: [{ amount: 1180, mode: 'Cash', date: '2026-01-01' }], lines: [{ desc: 'Part', qty: 1, rate: 1000, gst: 18 }] }];
  const idx1 = buildVehicleIndex(jobs, invs);
  const s1 = computeVehicleStats([v1], idx1, {});
  ok('computeVehicleStats(1 vehicle): total 1, active 1', s1.total === 1 && s1.active === 1);
  ok('computeVehicleStats(1 vehicle, 1 completed visit): avgVisits "1.0"', s1.avgVisits === '1.0', s1.avgVisits);
  ok('computeVehicleStats(1 vehicle): revenue finite & >= 0', Number.isFinite(s1.revenue) && s1.revenue >= 0, String(s1.revenue));
  ok('computeVehicleStats(1 vehicle, single completed visit): repeat = 0 (needs >1)', s1.repeat === 0);

  // 2 vehicles, one with 2 completed visits → repeat = 1
  const v2 = { id: 'v2', regNo: 'TS10CD5678', status: 'Active' };
  const jobs2 = [...jobs, { id: 'j2', regNo: 'TS10CD5678', status: 'Delivered', deliveredAt: 0 }, { id: 'j3', regNo: 'TS10CD5678', status: 'Closed', deliveredAt: 0 }];
  const idx2 = buildVehicleIndex(jobs2, invs);
  const s2 = computeVehicleStats([v1, v2], idx2, {});
  ok('computeVehicleStats(2 vehicles): total 2', s2.total === 2);
  ok('computeVehicleStats(2 vehicles, one with 2 visits): repeat = 1', s2.repeat === 1, `repeat ${s2.repeat}`);
  ok('computeVehicleStats(2 vehicles): avgVisits = (1+2)/2 = "1.5"', s2.avgVisits === '1.5', s2.avgVisits);
}

// isExpiring / daysUntil with missing & malformed dates
ok('isExpiring(undefined) is false, never throws', isExpiring(undefined) === false);
ok('isExpiring("not-a-date") is false', isExpiring('not-a-date') === false);
ok('daysUntil(null) is null', daysUntil(null) === null);

// =====================================================================
// 4 — trendPct: the dashboard's "vs prev" arrow, all edge cases
// =====================================================================
console.log('\n4  trendPct — divide-by-zero / empty-period safety\n');
for (const [t, y, exp] of [
  [0, 0, 0],       // both periods empty → flat, not NaN
  [5, 0, 100],     // 0 → something → +100%, not Infinity
  [0, 5, -100],    // something → 0 → -100%
  [10, 5, 100],    // doubled
  [5, 10, -50],    // halved
]) {
  const got = trendPct(t, y);
  ok(`trendPct(${t}, ${y}) = ${exp} (finite)`, got === exp && Number.isFinite(got), `got ${got}`);
}
ok('trendPct(undefined, undefined) is finite (0)', Number.isFinite(trendPct(undefined, undefined)));

// =====================================================================
// 5 — BILLING MONEY MATH at 0 lines / empty invoice
// =====================================================================
console.log('\n5  Billing money math — empty / single-line invoice\n');
{
  const empty = { invNo: 'INV-1', lines: [], discount: 0, payments: [] };
  for (const [name, fn] of [['totalsOf', totalsOf], ['invoiceTotals', invoiceTotals], ['invTotals', invTotals]]) {
    const t = fn(empty);
    ok(`${name}(0 lines): every figure finite`, scanFinite(t).length === 0, scanFinite(t).join('; '));
    ok(`${name}(0 lines): grand total is 0`, Number(t.grand) === 0, String(t.grand));
  }
  // single line, invoice-level discount present → the afterDisc/sub rescale must not 0/0
  const one = { invNo: 'INV-2', lines: [{ desc: 'X', qty: 1, rate: 100, gst: 18 }], discount: 10, discountType: 'percent', payments: [] };
  for (const [name, fn] of [['totalsOf', totalsOf], ['invoiceTotals', invoiceTotals], ['invTotals', invTotals]]) {
    const t = fn(one);
    ok(`${name}(1 line, 10% inv disc): finite, grand > 0`, scanFinite(t).length === 0 && Number(t.grand) > 0, JSON.stringify(t));
  }
  // all-zero line (qty 0) → no NaN from a 0/0 proportional rescale
  const zero = { invNo: 'INV-3', lines: [{ desc: 'X', qty: 0, rate: 0, gst: 18 }], discount: 5, discountType: 'flat', payments: [] };
  for (const [name, fn] of [['totalsOf', totalsOf], ['invoiceTotals', invoiceTotals], ['invTotals', invTotals]]) {
    ok(`${name}(qty0/rate0 line + flat disc): no NaN`, scanFinite(fn(zero)).length === 0, scanFinite(fn(zero)).join('; '));
  }
  // The SAFETY-critical gate (controls stock / ledger writes) is conservative on junk.
  ok('isRealized({}) is false — the money gate never fires on a blank record', isRealized({}) === false);
  ok('isRealized(undefined) is false', isRealized(undefined) === false);
  // isOutstanding is display-only; it inherits invoiceStatus's documented default
  // ("not clearly paid/estimate/cancelled" ⇒ Unpaid), and a blank record contributes
  // ₹0 to any sum. What must hold: an Estimate / Draft / Cancelled is NOT outstanding.
  ok('isOutstanding(estimate) is false', isOutstanding({ isEstimate: true, lines: [] }) === false);
  ok('isOutstanding(cancelled) is false', isOutstanding({ status: 'Cancelled', lines: [] }) === false);
  ok('isOutstanding(a real unpaid bill) is true', isOutstanding({ status: 'Unpaid', lines: [{ desc: 'X', qty: 1, rate: 500 }], payments: [] }) === true);
}

// avgInv guard reproduction (BillingModule.stats): realCount 0 → 0, never grand/0
{
  const avgInv = (grand, realCount) => (realCount ? grand / realCount : 0);
  ok('avgInv oracle: 0 real invoices → 0 (not NaN)', avgInv(0, 0) === 0);
  ok('avgInv oracle: 2 invoices →5900 total → 2950', avgInv(5900, 2) === 2950);
  ok('shipped BillingModule keeps the `realCount ? grand / realCount : 0` guard',
    /realCount \? grand \/ realCount : 0/.test(read('../components/billing/BillingModule.jsx')));
}

// =====================================================================
// 6 — CHARTS: 0 / 1 / 2 / many data points
// =====================================================================
console.log('\n6  Charts — 0 / 1 / 2 / many points\n');

// -- 6a. RevenueTrend (Billing 14-day sparkline). Reproduce its 3-line path
// formula VERBATIM next to the source and prove it produces no "NaN" for the
// only inputs it is ever handed (a fixed 14-entry array, possibly all-zero).
function revenueTrendPath(data) {
  const max = Math.max(1, ...data.map((d) => d.rev));
  const W = 520, H = 120, pad = 4;
  const pts = data.map((d, i) => { const x = pad + (i / (data.length - 1)) * (W - 2 * pad); const y = H - pad - (d.rev / max) * (H - 2 * pad); return [x, y]; });
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = pts.length ? `${path} L${pts[pts.length - 1][0].toFixed(1)},${H - pad} L${pts[0][0].toFixed(1)},${H - pad} Z` : '';
  return path + ' ' + area;
}
const trend14zero = Array.from({ length: 14 }, (_, i) => ({ key: i, label: `${i}`, rev: 0 }));
const trend14real = trend14zero.map((d, i) => ({ ...d, rev: i === 3 ? 5000 : i * 100 }));
ok('RevenueTrend: 14 all-zero points → valid flat path, no "NaN"', !BAD.test(revenueTrendPath(trend14zero)));
ok('RevenueTrend: 14 real points → no "NaN"', !BAD.test(revenueTrendPath(trend14real)));
ok('RevenueTrend is only ever fed stats.trend, which is a fixed 14-iteration loop',
  /for \(let i = 13; i >= 0; i--\) \{[^]*?trend\.push\(/.test(read('../components/billing/BillingModule.jsx')));
// document the latent edge: the formula itself divides by (length-1) and indexes [-1]
ok('RevenueTrend formula WOULD produce "NaN" at 1 point / be empty at 0 (latent, unreached)',
  revenueTrendPath([{ rev: 5 }]).includes('NaN') && revenueTrendPath([]).trim() === '');

// -- 6b. RSpark / RDonut / RBars — keep their guards. (These are currently
// DEAD CODE — defined in InventoryDashboard.js, rendered nowhere — so they cannot
// crash a live view; the guards are asserted so a future re-wire stays safe.)
{
  const inv = read('../components/InventoryDashboard.js');
  ok('RSpark keeps the `data.length < 2` guard before indexing pts[-1]',
    /function RSpark\([^]*?if \(data\.length < 2\) return/.test(inv));
  ok('RDonut keeps the `total <= 0` guard before dividing by total',
    /function RDonut\([^]*?if \(total <= 0\) return/.test(inv));
  ok('RBars keeps the `!rows.length` guard',
    /function RBars\([^]*?if \(!rows\.length\) return/.test(inv));
  ok('RSpark / RDonut / RBars are currently unreferenced (dead code — INFO)',
    !/<RSpark|<RDonut|<RBars/.test(inv));
}

// -- 6c. Monthly Profit Trend (Analytics) — empty guard + maxBar floor
{
  const inv = read('../components/InventoryDashboard.js');
  ok('Analytics Monthly Profit Trend has an explicit `series.length === 0` empty state',
    /trend\.series\.length === 0 \? \(/.test(inv));
  ok('Analytics trend bar heights divide by `maxBar = Math.max(1, ...)` (never 0)',
    /const maxBar = Math\.max\(1, \.\.\.trend\.series\.map/.test(inv));
  ok('Analytics trend margin is `totRev > 0 ? ... : 0` guarded',
    /const margin = totRev > 0 \? \(totProfit \/ totRev\) \* 100 : 0;/.test(inv));
  ok('Analytics trend growth guards null AND prev.profit !== 0',
    /const growth = last && prev && prev\.profit !== 0 \?/.test(inv));
}

// -- 6d. Donut (Billing / InventoryOverview) — total floor
ok('Billing Donut fraction is `total > 0 ? s.value / total : 0`',
  /const frac = total > 0 \? s\.value \/ total : 0;/.test(read('../components/billing/BillingModule.jsx')));
ok('InventoryOverview Donut uses `reduce(..., 0) || 1` so total is never 0',
  /const total = segments\.reduce\(\(s, x\) => s \+ x\.value, 0\) \|\| 1;/.test(read('../components/inventory/InventoryOverview.jsx')));

// =====================================================================
// 7 — DEPENDENCY LOOKUP: SearchSelect with an EMPTY option collection
// =====================================================================
console.log('\n7  Dependency lookup — SearchSelect at 0 / 1 options, search→0\n');
{
  // 0 options → the input placeholder becomes noOptionsText and the open panel
  // shows it too. The field must never become an unusable dead-end.
  let r;
  act(() => {
    r = render(React.createElement(SearchSelect, {
      value: '', options: [], onSelect: () => {},
      getLabel: (o) => o.name, placeholder: 'Search customers…',
      noOptionsText: 'No customers yet', emptyText: 'No matches.',
    }));
  });
  const input = r.container.querySelector('input[role="combobox"]');
  ok('SearchSelect(0 options): input still rendered (never disappears)', !!input);
  ok('SearchSelect(0 options): placeholder is the noOptionsText', input.getAttribute('placeholder') === 'No customers yet', input.getAttribute('placeholder'));
  act(() => { input.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  ok('SearchSelect(0 options): opened panel shows "No customers yet"', (document.body.textContent || '').includes('No customers yet'));
  ok('SearchSelect(0 options): panel does NOT show a bogus "0 of 0" row', !(document.body.textContent || '').includes('0 of 0'));
  cleanup();
}
{
  // 1 option, query that matches nothing → emptyText (with the query echoed)
  let r;
  act(() => {
    r = render(React.createElement(SearchSelect, {
      value: '', options: [{ id: 'a', name: 'Ramesh Kumar' }], onSelect: () => {},
      getLabel: (o) => o.name, searchText: (o) => o.name,
      placeholder: 'Search…', noOptionsText: 'Nothing available.', emptyText: 'No matches.',
    }));
  });
  const input = r.container.querySelector('input[role="combobox"]');
  ok('SearchSelect(1 option): placeholder is the normal placeholder, not noOptionsText', input.getAttribute('placeholder') === 'Search…');
  await act(async () => {
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: 'zzzzz' } });
    await flush();
  });
  const body = document.body.textContent || '';
  ok('SearchSelect(1 option, query "zzzzz"): shows the empty-match state', body.includes('No matches.'));
  ok('SearchSelect(1 option, no match): no NaN/undefined in the panel', !BAD.test(body));
  cleanup();
}

// Shipped call sites give SearchSelect a USEFUL noOptionsText + a walk-in / quick-create escape hatch
{
  const bm = read('../components/billing/BillingModule.jsx');
  ok('Billing customer picker: noOptionsText="No customers yet" (not the bare default)', /noOptionsText="No customers yet"/.test(bm));
  ok('Billing customer picker: a "+ New Customer" quick-create escape hatch exists', /New Customer/.test(bm) && /switchCustMode\('walkin'\)/.test(bm));
  ok('Billing vehicle picker: contextual noOptionsText (needs a customer first / none on file)', /noOptionsText=\{inv\.customer \? 'This customer has no vehicles on file' : 'Select a customer first'\}/.test(bm));
}

// =====================================================================
// 8 — SEARCH / RANK at 0 / 1 / 2 items and 0 / 1 / 2 matches
// =====================================================================
console.log('\n8  searchAndRank — 0 / 1 / 2 items, 0 / 1 / 2 matches\n');
{
  const mk = (list) => {
    const m = new Map();
    list.forEach((o) => m.set(o.id, { hay: String(o.name).toLowerCase(), ids: [] }));
    return m;
  };
  const idFn = (o) => o.id;
  const A = { id: '1', name: 'Brake Pad' };
  const B = { id: '2', name: 'Brake Disc' };
  const C = { id: '3', name: 'Air Filter' };

  ok('searchAndRank([], ..., "brake"): [] (0 items)', JSON.stringify(searchAndRank([], mk([]), idFn, 'brake')) === '[]');
  ok('searchAndRank([A], "brake"): 1 match', searchAndRank([A], mk([A]), idFn, 'brake').length === 1);
  ok('searchAndRank([A], "zzz"): 0 matches', searchAndRank([A], mk([A]), idFn, 'zzz').length === 0);
  ok('searchAndRank([A,B,C], "brake"): exactly 2 matches', searchAndRank([A, B, C], mk([A, B, C]), idFn, 'brake').length === 2);
  ok('searchAndRank([A,B,C], "" ): returns all 3 (no query = no filter)', searchAndRank([A, B, C], mk([A, B, C]), idFn, '').length === 3);
  ok('rankIndexed(undefined-entry, "q"): 0, never throws', rankIndexed(undefined, 'q') === 0);
}

// =====================================================================
// 9 — CARDINALITY TRANSITIONS: 0→1→2→many→2→1→0
// =====================================================================
console.log('\n9  Cardinality transitions — the count/pager/KPI stays correct at every step\n');
{
  const seq = [0, 1, 2, 25, 2, 1, 0];
  let allFinite = true, pagerOk = true;
  for (const n of seq) {
    const parts = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Part ${i}`, stock: i, minStock: 1, purchasePrice: 10, sellingPrice: 20, suppliers: [] }));
    const h = computeInventoryHealth(parts);
    const wp = computeWorkshopProgress({ inventory: parts, invoices: [], jobCards: [], vehicles: [], sales: [] });
    if (scanFinite(h).length || scanFinite(wp).length) allFinite = false;
    // pager for this cardinality, viewed on page 1
    const exp = pageOracle(n, 1, 20);
    let r; act(() => { r = render(React.createElement(Pagination, { page: 1, total: n, perPage: 20, onPage: () => {} })); });
    const txt = (r.container.textContent || '').trim();
    if (exp.hidden ? txt !== '' : !txt.includes(`of ${n}`)) pagerOk = false;
    cleanup();
  }
  ok('transition 0→1→2→25→2→1→0: analytics stay finite at every step', allFinite);
  ok('transition 0→1→2→25→2→1→0: pager text correct (or hidden) at every step', pagerOk);
}

// Analytics 0→1→0: workshop score recovers, never sticks a stale value
{
  const p = { id: 'p1', name: 'X', stock: 5, minStock: 1, purchasePrice: 10, sellingPrice: 20, sku: 'X1', suppliers: [{ id: 's', name: 'S' }] };
  const empty1 = computeWorkshopScore({ inventory: [], sales: [], suppliers: [] }).score;
  const one = computeWorkshopScore({ inventory: [p], sales: [], suppliers: [] }).score;
  const empty2 = computeWorkshopScore({ inventory: [], sales: [], suppliers: [] }).score;
  ok('computeWorkshopScore 0→1→0: pure function, 0-state is reproducible (no stale carry)', empty1 === empty2 && Number.isFinite(one));
}

// =====================================================================
// 10 — SOURCE-PATTERN GUARDS (regression tripwires)
// =====================================================================
console.log('\n10  Guard tripwires — a future edit that removes one of these fails here\n');
{
  const pag = read('../components/inventory/Pagination.jsx');
  ok('Pagination: pageCount = Math.max(1, Math.ceil(total / perPage))', /const pageCount = Math\.max\(1, Math\.ceil\(total \/ perPage\)\);/.test(pag));
  ok('Pagination: clamps a stale later page back into range via effect', /if \(page > pageCount\) onPage\(pageCount\);/.test(pag));
  ok('Pagination: renders nothing when a single page fits', /if \(pageCount <= 1\) return null;/.test(pag));

  const as = read('../services/analyticsService.js');
  ok('analyticsService: computeInventoryHealth early-returns on 0 parts', /if \(!n\) return \{ score: 100, factors: \[\] \};/.test(as));
  ok('analyticsService: workshop score divides by totalWeight only when non-zero', /const score = totalWeight \? Math\.round\(/.test(as));
  ok('analyticsService: every computeWorkshopProgress pct has a `.length ? ... : 0` guard', !/\/ (liveJobs|billable|active|activeJobs)\.length\) \* 100\)(?!.*: 0)/.test(as) || /liveJobs\.length \? /.test(as));

  const vs = read('../lib/vehicleStats.js');
  ok('vehicleStats: avgVisits = active ? (completedVisits / active).toFixed(1) : "0"', /avgVisits: active \? \(completedVisits \/ active\)\.toFixed\(1\) : '0'/.test(vs));

  const fmt = read('../lib/format.js');
  ok('format.trendPct: `if (!yest) return today > 0 ? 100 : 0;`', /if \(!yest\) return today > 0 \? 100 : 0;/.test(fmt));

  const cm = read('../components/customers/CustomersModule.jsx');
  ok('CustomersModule: safePage clamp = Math.min(page, pageCount)', /const safePage = Math\.min\(page, pageCount\);/.test(cm));
  ok('CustomersModule: Next button increments a CLAMPED page (no runaway index)', /setPage\(\(p\) => Math\.min\(p, pageCount\) \+ 1\)/.test(cm));
  ok('CustomersModule: "Showing X to Y of Z" renders 0 (not undefined) when empty', /filtered\.length \? \(safePage - 1\) \* perPage \+ 1 : 0/.test(cm));

  const vm = read('../components/vehicles/VehiclesModule.jsx');
  ok('VehiclesModule: same safePage clamp + clamped Next as Customers', /const safePage = Math\.min\(page, pageCount\);/.test(vm) && /setPage\(\(p\) => Math\.min\(p, pageCount\) \+ 1\)/.test(vm));
}

// =====================================================================
// 11 — SINGULAR / PLURAL at exactly 1 record
// =====================================================================
console.log('\n11  Singular / plural — the "1 record" label reads correctly\n');
{
  const { pluralize } = require('../lib/format');
  ok('pluralize("visit", 1) === "visit"', pluralize('visit', 1) === 'visit');
  ok('pluralize("visit", 2) === "visits"', pluralize('visit', 2) === 'visits');
  ok('pluralize("entry", 2) === "entries" (consonant + y)', pluralize('entry', 2) === 'entries');
  ok('pluralize("visit", 0) === "visits"', pluralize('visit', 0) === 'visits');

  const vm = read('../components/vehicles/VehiclesModule.jsx');
  ok('PH24: Vehicles card visit count singularises at 1 ("1 visit", not "1 visits")',
    /visitsOf\(r\) === 1 \? 'visit' : 'visits'/.test(vm));
  const cm = read('../components/customers/CustomersModule.jsx');
  ok('PH24: Customers card bill count singularises at 1 ("1 bill", not "1 bills")',
    /billsOf\(c\) === 1 \? 'bill' : 'bills'/.test(cm));
  ok('PH24: Customers card vehicle count was ALREADY singular-safe (regression guard)',
    /\(c\.vehicles \|\| \[\]\)\.length === 1 \? 'vehicle' : 'vehicles'/.test(cm));

  // The app's established plural idiom is still used where it already existed
  const as = read('../services/analyticsService.js');
  ok('analyticsService keeps "invoice"/"invoices" singular-safe in computeWorkshopProgress',
    /outstanding\.length === 1 \? '' : 's'/.test(as));
}

console.log(`\n${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
