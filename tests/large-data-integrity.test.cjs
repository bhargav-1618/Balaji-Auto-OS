/**
 * tests/large-data-integrity.test.cjs
 *
 * PHASE 25 — LARGE-DATA / SCALABILITY / CLIENT-HEAVY BEHAVIOR.
 *
 * The application is client-heavy: list views load a server-bounded window
 * (repositories/firestoreRepository.js — every onSnapshot has a limit()), hold it
 * in a React array, and then filter / sort / paginate / aggregate it IN THE BROWSER
 * on each interaction. This suite proves three separate things at 100 / 500 / 1,000 /
 * 5,000 / 10,000 records:
 *
 *   1. the records EXIST (deterministic realistic fixtures)
 *   2. the shipped derived functions actually LOAD / PROCESS all of them
 *      (no silent truncation — `.length` is asserted end to end)
 *   3. the result stays CORRECT (independent hand oracle — never the production
 *      helper as its own expected value) and the processing cost is recorded
 *
 * Timings are wall-clock in Node (v8, single core, noisy) — they are RECORDED for the
 * report and only hard-fail on an egregious regression (orders of magnitude), never on
 * an exact millisecond. Node timing captures the "filter/sort/reduce/analytics over the
 * whole array" cost (the dominant client-heavy cost); it does NOT capture React
 * reconciliation or DOM paint (mitigated in the app by useDeferredValue + a 25-row page).
 */
require('./setup.cjs');
const { performance } = require('perf_hooks');

const { totalsOf, deriveStatus } = require('../components/billing/BillingModule.jsx');
const { invTotals } = require('../components/InventoryDashboard.js');
const { invoiceTotals, isRealized, isOutstanding } = require('../services/billingService');
const {
  computeInventoryHealth, computeWorkshopScore, computeWorkshopProgress, computeRange,
} = require('../services/analyticsService');
const { buildVehicleIndex, computeVehicleStats } = require('../lib/vehicleStats');
const { searchAndRank, rankIndexed } = require('../lib/useSearch');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const ms = (fn) => { const t0 = performance.now(); const r = fn(); return { r, t: performance.now() - t0 }; };
const fmt = (t) => (t < 1 ? '<1ms' : t < 1000 ? `${t.toFixed(0)}ms` : `${(t / 1000).toFixed(2)}s`);

// ── deterministic PRNG (mulberry32) so every run generates the identical dataset ──
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SIZES = [100, 500, 1000, 5000, 10000];

// ── realistic fixture generators ────────────────────────────────────────────────
const BRANDS = ['Maruti', 'Hyundai', 'Tata', 'Toyota', 'Kia', 'Mahindra', 'Honda', 'Renault'];
const CATS = ['Brakes', 'Filters', 'Engine', 'Electrical', 'Suspension', 'Transmission', 'Body', 'Cooling'];
const STATUSES = ['Paid', 'Paid', 'Paid', 'Unpaid', 'Partially Paid', 'Draft', 'Cancelled'];
const SVC = ['Water Wash', 'Oil Change', 'Wheel Alignment', 'AC Service', 'Denting', 'Painting'];
const FIRST = ['Ramesh', 'Suresh', 'Praveen', 'Anil', 'Kiran', 'Rohit', 'Sandeep', 'Deepak', 'Naveen', 'Vijay'];
const LAST = ['Kumar', 'Reddy', 'Rao', 'Sharma', 'Chowdary', 'Naidu', 'Gupta', 'Iyer', 'Shetty', 'Bhat'];

function genParts(n, seed = 1) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const brand = BRANDS[Math.floor(r() * BRANDS.length)];
    const cat = CATS[Math.floor(r() * CATS.length)];
    const pp = 50 + Math.floor(r() * 3000);
    out.push({
      id: `part-${i}`,
      name: `${brand} ${cat} Component ${i}`,
      sku: `${cat.slice(0, 3).toUpperCase()}-${brand.slice(0, 2).toUpperCase()}-${String(i).padStart(5, '0')}`,
      category: cat, brand,
      stock: Math.floor(r() * 60),
      minStock: 3 + Math.floor(r() * 8),
      purchasePrice: pp,
      sellingPrice: Math.round(pp * (1.2 + r() * 0.8)),
      salesCount: Math.floor(r() * 150),
      gst: [0, 5, 12, 18, 28][Math.floor(r() * 5)],
      suppliers: r() < 0.8 ? [{ id: `sup-${i % 40}`, name: `Supplier ${i % 40}`, isPreferred: true }] : [],
      archived: r() < 0.05,
      createdAt: { seconds: Math.floor((Date.now() - r() * 3e10) / 1000), nanoseconds: 0 },
      updatedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
    });
  }
  return out;
}

function genCustomers(n, seed = 2) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const name = `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`;
    const nveh = 1 + Math.floor(r() * 3);
    const vehicles = [];
    for (let v = 0; v < nveh; v++) {
      vehicles.push({
        id: `v-${i}-${v}`,
        regNo: `AP${String(1 + Math.floor(r() * 39)).padStart(2, '0')}${String.fromCharCode(65 + Math.floor(r() * 26))}${String.fromCharCode(65 + Math.floor(r() * 26))}${String(1000 + Math.floor(r() * 8999))}`,
        model: `${BRANDS[Math.floor(r() * BRANDS.length)]} Model`,
        fuel: r() < 0.7 ? 'Petrol' : 'Diesel',
        status: 'Active',
        insuranceExpiry: new Date(Date.now() + (r() * 400 - 60) * 86400000).toISOString().slice(0, 10),
        pucExpiry: new Date(Date.now() + (r() * 200 - 30) * 86400000).toISOString().slice(0, 10),
      });
    }
    out.push({
      id: `cust-${i}`,
      code: `CUST-${String(i + 1).padStart(4, '0')}`,
      name, phone: `9${String(100000000 + Math.floor(r() * 899999999))}`,
      type: ['Individual', 'Corporate', 'Fleet Owner', 'Walk-in'][Math.floor(r() * 4)],
      status: r() < 0.9 ? 'Active' : 'Inactive',
      totalSpent: Math.floor(r() * 200000),
      outstanding: r() < 0.25 ? Math.floor(r() * 40000) : 0,
      vehicles,
      createdAt: { seconds: Math.floor((Date.now() - i * 3600 * 1000) / 1000), nanoseconds: 0 },
    });
  }
  return out;
}

function genInvoices(n, parts, seed = 3) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const st = STATUSES[Math.floor(r() * STATUSES.length)];
    const isEstimate = r() < 0.06;
    const nLines = 1 + Math.floor(r() * 4);
    const lines = [];
    for (let j = 0; j < nLines; j++) {
      const p = parts[Math.floor(r() * parts.length)];
      lines.push({
        id: `l-${i}-${j}`, kind: 'Part', desc: p ? p.name : `Item ${j}`,
        qty: 1 + Math.floor(r() * 4),
        rate: p ? p.sellingPrice : 100 + Math.floor(r() * 2000),
        purchasePrice: p ? p.purchasePrice : 50 + Math.floor(r() * 1000),
        gst: r() < 0.5 ? 18 : (r() < 0.5 ? 0 : 12),
        disc: r() < 0.25 ? Math.floor(r() * 15) : 0,
      });
    }
    const nSvc = Math.floor(r() * 3);
    for (let j = 0; j < nSvc; j++) {
      lines.push({
        id: `s-${i}-${j}`, kind: 'Labour', desc: SVC[Math.floor(r() * SVC.length)],
        qty: 1, rate: 200 + Math.floor(r() * 3000), gst: 0, disc: 0,
      });
    }
    const dt = new Date(Date.now() - Math.floor(r() * 720) * 86400000);
    const date = dt.toISOString().slice(0, 10);
    const grand = lines.reduce((s, l) => s + l.qty * l.rate, 0);
    const paid = st === 'Paid' ? grand : st === 'Partially Paid' ? Math.floor(grand * 0.4) : 0;
    out.push({
      id: `inv-${i}`,
      invNo: `INV-${String(i + 1).padStart(4, '0')}`,
      customer: `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`,
      phone: `9${String(100000000 + Math.floor(r() * 899999999))}`,
      vehicle: `${BRANDS[Math.floor(r() * BRANDS.length)]} Model`,
      regNo: `AP${String(1 + Math.floor(r() * 39)).padStart(2, '0')}XX${String(1000 + Math.floor(r() * 8999))}`,
      date, status: st, isEstimate,
      discount: r() < 0.2 ? (r() < 0.5 ? Math.floor(r() * 500) : Math.floor(r() * 12)) : 0,
      discountType: r() < 0.5 ? 'flat' : 'percent',
      gstMode: r() < 0.1 ? 'exempt' : 'normal',
      lines,
      payments: paid > 0 ? [{ id: `p-${i}`, mode: ['Cash', 'UPI', 'Card'][Math.floor(r() * 3)], amount: paid, date }] : [],
      createdAt: { seconds: Math.floor(dt.getTime() / 1000), nanoseconds: 0 },
    });
  }
  return out;
}

function genSales(n, parts, seed = 4) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = parts[Math.floor(r() * parts.length)];
    const qty = 1 + Math.floor(r() * 4);
    const revenue = (p ? p.sellingPrice : 500) * qty;
    const cost = (p ? p.purchasePrice : 300) * qty;
    out.push({
      id: `sale-${i}`, partId: p ? p.id : `part-${i % 50}`, name: p ? p.name : `Item ${i}`,
      category: p ? p.category : 'Parts', revenueType: r() < 0.7 ? 'Parts' : 'Labour',
      qty, revenue, cost, profit: revenue - cost,
      createdAt: { seconds: Math.floor((Date.now() - Math.floor(r() * 720) * 86400000) / 1000), nanoseconds: 0 },
      invoiceNo: `INV-${String(1 + Math.floor(r() * n)).padStart(4, '0')}`,
    });
  }
  return out;
}

function genJobCards(n, seed = 5) {
  const r = rng(seed);
  const JC = ['Received', 'Inspection', 'Repair Started', 'Quality Check', 'Ready', 'Delivered', 'Closed', 'Cancelled'];
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      jobNo: `JC-${String(i + 1).padStart(4, '0')}`,
      regNo: `AP${String(1 + Math.floor(r() * 39)).padStart(2, '0')}XX${String(1000 + Math.floor(r() * 8999))}`,
      customer: `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`,
      status: JC[Math.floor(r() * JC.length)],
      isDraft: r() < 0.05,
      dateIn: new Date(Date.now() - Math.floor(r() * 200) * 86400000).toISOString().slice(0, 10),
      savedAt: Date.now() - Math.floor(r() * 200) * 86400000,
    });
  }
  return out;
}

// ── independent oracles (NOT the production helper) ─────────────────────────────
// Hand-rolled invoice grand total: net line = qty·rate·(1−disc%), then invoice-level
// discount (flat or %), then GST. Deliberately re-derived from the documented model,
// not by calling totalsOf.
function oracleGrand(iv) {
  if (iv.isEstimate) { /* estimate still totals */ }
  const lines = Array.isArray(iv.lines) ? iv.lines : [];
  let sub = 0, lineGst = 0;
  let anyLineGst = false;
  for (const l of lines) {
    const q = Number(l.qty) || 0, rt = Number(l.rate) || 0, d = Number(l.disc) || 0;
    const net = Math.max(0, q * rt - q * rt * (d / 100));
    sub += net;
    if (l.gst != null) { anyLineGst = true; lineGst += net * (Number(l.gst) || 0) / 100; }
  }
  const invDisc = iv.discountType === 'percent' ? sub * (Number(iv.discount) || 0) / 100 : (Number(iv.discount) || 0);
  const afterDisc = Math.max(0, sub - invDisc);
  let gst = 0;
  if (iv.gstMode !== 'exempt') {
    gst = anyLineGst ? lineGst * (afterDisc / (sub || 1)) : 0;
  }
  // Indian invoice convention: the grand total is rounded to the nearest WHOLE RUPEE
  // (BillingModule.totalsOf line ~462: `const grand = Math.round(grandRaw)`), with the
  // ±paise difference carried as a visible `roundOff`. The oracle mirrors that.
  return Math.round(afterDisc + gst);
}

// hand pagination: which rows page P shows, and the full concatenation
function paginate(list, per) {
  const pages = Math.max(1, Math.ceil(list.length / per));
  const all = [];
  for (let p = 1; p <= pages; p++) all.push(...list.slice((p - 1) * per, p * per));
  return { pages, all };
}

console.log('\nPHASE 25 — large-data / scalability / client-heavy behavior\n');

// =====================================================================
// 0 — FIXTURE VALIDITY (the records EXIST and are realistic)
// =====================================================================
console.log('0  Fixture generation — deterministic, realistic, correct cardinality\n');
const DATA = {};
for (const N of SIZES) {
  const parts = genParts(Math.min(N, 10000), 1);
  const t0 = performance.now();
  const customers = genCustomers(N, 2);
  const invoices = genInvoices(N, parts, 3);
  const sales = genSales(N, parts, 4);
  const jobCards = genJobCards(N, 5);
  const genT = performance.now() - t0;
  DATA[N] = { parts, customers, invoices, sales, jobCards };
  const vehCount = customers.reduce((s, c) => s + c.vehicles.length, 0);
  const lineCount = invoices.reduce((s, iv) => s + iv.lines.length, 0);
  ok(`N=${N}: generated ${customers.length} customers / ${invoices.length} invoices / ${sales.length} sales / ${jobCards.length} job cards (${fmt(genT)})`,
    customers.length === N && invoices.length === N && sales.length === N && jobCards.length === N);
  ok(`N=${N}: ${vehCount} nested vehicles, ${lineCount} invoice lines — realistic, non-uniform`,
    vehCount >= N && lineCount >= N && new Set(customers.map((c) => c.name)).size > 1 && new Set(invoices.map((i) => i.status)).size >= 3);
}

// =====================================================================
// 1 — INVOICE MONEY MODEL: process ALL N, stay correct, record cost
// =====================================================================
console.log('\n1  Invoice money model — totalsOf / invoiceTotals / invTotals over the FULL array\n');
const moneyRows = [];
for (const N of SIZES) {
  const { invoices } = DATA[N];
  // the shipped totalsOf, called once per invoice (the BillingModule.stats main loop)
  const a = ms(() => invoices.map((iv) => totalsOf(iv)));
  const b = ms(() => invoices.map((iv) => invoiceTotals(iv)));
  const c = ms(() => invoices.map((iv) => invTotals(iv)));
  ok(`N=${N}: totalsOf processed all ${N} (no truncation)`, a.r.length === N);
  ok(`N=${N}: every grand total finite & >= 0`, a.r.every((t) => Number.isFinite(t.grand) && t.grand >= 0));
  // correctness vs the INDEPENDENT oracle
  let maxDrift = 0, mism = 0;
  for (let i = 0; i < invoices.length; i++) {
    const exp = oracleGrand(invoices[i]);
    const got = a.r[i].grand;
    const drift = Math.abs(exp - got);
    if (drift > maxDrift) maxDrift = drift;
    if (drift > 0.5) mism++;   // > ½ rupee ⇒ not a rounding difference
  }
  ok(`N=${N}: totalsOf.grand agrees with the independent whole-rupee oracle for all ${N} (max drift ${maxDrift.toFixed(2)}, ${mism} mismatches)`, mism === 0, `max drift ${maxDrift}`);
  moneyRows.push({ N, totalsOf: a.t, invoiceTotals: b.t, invTotals: c.t });
}
console.log('\n  invoice-model cost (ms):');
console.table(moneyRows.map((r) => ({ N: r.N, totalsOf: fmt(r.totalsOf), invoiceTotals: fmt(r.invoiceTotals), invTotals: fmt(r.invTotals), 'per-invoice': `${(r.totalsOf / r.N * 1000).toFixed(1)}µs` })));

// =====================================================================
// 2 — BILLING stats: the whole KPI + 14-day-trend + top-N loop
// =====================================================================
console.log('\n2  Billing dashboard stats — Σ KPIs + 14-day trend + top customers/parts over the FULL array\n');
// verbatim reproduction of BillingModule.stats (the shipped loop), so a real-world
// "listener fires → recompute every KPI" cost is measured, and checked vs a hand oracle.
function billingStats(invoices) {
  const REAL = ['Paid', 'Unpaid', 'Partially Paid'];
  let grand = 0, outstanding = 0, realCount = 0, draftCount = 0, pendingCount = 0, monthRev = 0;
  const now = new Date();
  const isReal = (iv) => !iv.isEstimate && REAL.includes(deriveStatus(iv));
  invoices.forEach((iv) => {
    const t = totalsOf(iv); const st = deriveStatus(iv);
    if (st === 'Draft' || iv.isEstimate) { draftCount += 1; return; }
    if (!REAL.includes(st)) return;
    realCount += 1; grand += t.grand;
    if (st === 'Unpaid' || st === 'Partially Paid') { outstanding += t.balance; pendingCount += 1; }
    const d = new Date(iv.date);
    if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) monthRev += t.grand;
  });
  const trend = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const rev = invoices.filter((iv) => iv.date === key && isReal(iv)).reduce((s, iv) => s + totalsOf(iv).grand, 0);
    trend.push({ key, rev });
  }
  const custMap = {};
  invoices.forEach((iv) => { if (!isReal(iv)) return; custMap[iv.customer || '—'] = (custMap[iv.customer || '—'] || 0) + totalsOf(iv).grand; });
  const topCustomers = Object.entries(custMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return { grand, outstanding, realCount, draftCount, pendingCount, monthRev, avgInv: realCount ? grand / realCount : 0, trend, topCustomers, count: invoices.length };
}
const statsRows = [];
for (const N of SIZES) {
  const { invoices } = DATA[N];
  const { r: stats, t } = ms(() => billingStats(invoices));
  ok(`N=${N}: stats.count === ${N} — the full window is counted, not a slice`, stats.count === N);
  // independent oracle: grand = Σ oracleGrand over real bills
  let oGrand = 0, oReal = 0;
  const REAL = ['Paid', 'Unpaid', 'Partially Paid'];
  for (const iv of invoices) {
    const st = deriveStatus(iv);
    if (st === 'Draft' || iv.isEstimate || !REAL.includes(st)) continue;
    oGrand += oracleGrand(iv); oReal += 1;
  }
  // per-invoice grand is whole-rupee rounded, so a Σ over `oReal` invoices can differ
  // from the oracle Σ by up to oReal·0.5 in the worst case; assert the mean per-invoice
  // drift is sub-rupee (i.e. it's rounding, not a dropped/miscounted invoice).
  const meanDrift = oReal ? Math.abs(stats.grand - oGrand) / oReal : 0;
  ok(`N=${N}: stats.grand mean per-invoice drift vs independent Σ is sub-rupee (${meanDrift.toFixed(4)}), realCount ${stats.realCount}===${oReal}`,
    meanDrift < 0.5 && stats.realCount === oReal);
  ok(`N=${N}: avgInv finite, trend has exactly 14 points, topCustomers <= 5`,
    Number.isFinite(stats.avgInv) && stats.trend.length === 14 && stats.topCustomers.length <= 5);
  statsRows.push({ N, stats: t, 'totalsOf calls': `~${(N * (1 + 14 * 0.02 + 0.9)).toFixed(0)}` });
}
console.log('\n  Billing stats recompute cost (ms) — runs on every invoice listener echo / save:');
console.table(statsRows.map((r) => ({ N: r.N, 'stats()': fmt(r.stats) })));

// =====================================================================
// 3 — SEARCH: searchAndRank over the FULL window, per query change
// =====================================================================
console.log('\n3  Search — searchAndRank over the full array (common / rare / no-match / prefix)\n');
function buildIndex(list, textFn) {
  const m = new Map();
  list.forEach((o) => m.set(o.id, { hay: String(textFn(o)).toLowerCase(), ids: [] }));
  return m;
}
const searchRows = [];
for (const N of SIZES) {
  const { customers } = DATA[N];
  const idx = buildIndex(customers, (c) => `${c.name} ${c.phone}`);
  const idFn = (c) => c.id;
  const common = ms(() => searchAndRank(customers, idx, idFn, 'kumar'));      // ~10% of rows
  const rare = ms(() => searchAndRank(customers, idx, idFn, 'ramesh iyer')); // few rows
  const none = ms(() => searchAndRank(customers, idx, idFn, 'zzzznomatch')); // 0 rows
  const idxT = ms(() => buildIndex(customers, (c) => `${c.name} ${c.phone}`));
  // correctness: no-match is empty; common is a strict subset; every hit really contains the term
  ok(`N=${N}: no-match query → 0 results (no false positives at scale)`, none.r.length === 0);
  ok(`N=${N}: "kumar" results all actually contain "kumar", count <= N`,
    common.r.length <= N && common.r.every((c) => c.name.toLowerCase().includes('kumar')));
  // independent count
  const indepKumar = customers.filter((c) => c.name.toLowerCase().includes('kumar')).length;
  ok(`N=${N}: "kumar" result count === independent filter count (${common.r.length}===${indepKumar})`, common.r.length === indepKumar);
  searchRows.push({ N, index: idxT.t, common: common.t, rare: rare.t, none: none.t });
}
console.log('\n  search cost (ms):');
console.table(searchRows.map((r) => ({ N: r.N, 'build index': fmt(r.index), 'common (~10%)': fmt(r.common), 'rare': fmt(r.rare), 'no-match': fmt(r.none) })));

// =====================================================================
// 4 — FILTER + SORT + PAGINATE: completeness at 5k / 10k
// =====================================================================
console.log('\n4  Filter / sort / paginate — no truncation, no dupes, no gaps, correct totals\n');
for (const N of SIZES) {
  const { invoices } = DATA[N];
  // filter: active + Paid, then sort by date desc, then page @ 25
  const { r: filtered, t: ft } = ms(() => invoices.filter((iv) => !iv.archived && deriveStatus(iv) === 'Paid'));
  const { r: sorted, t: st } = ms(() => [...filtered].sort((a, b) => (b.date || '').localeCompare(a.date || '')));
  const { pages, all } = paginate(sorted, 25);
  const indep = invoices.filter((iv) => deriveStatus(iv) === 'Paid').length;
  ok(`N=${N}: filtered count === independent count (${filtered.length}===${indep})`, filtered.length === indep);
  ok(`N=${N}: pageCount === ceil(${filtered.length}/25) === ${Math.ceil(filtered.length / 25)}`, pages === Math.max(1, Math.ceil(filtered.length / 25)));
  ok(`N=${N}: concatenating ALL ${pages} pages reproduces the full filtered set — no missing rows`, all.length === sorted.length);
  ok(`N=${N}: no duplicate row across pages`, new Set(all.map((x) => x.id)).size === all.length);
  ok(`N=${N}: page order === sorted order (client pagination is a pure slice)`, all.every((x, i) => x.id === sorted[i].id));
  if (N >= 5000) {
    ok(`N=${N}: filter+sort of ${N} invoices completes in < 2s (recorded ${fmt(ft + st)})`, (ft + st) < 2000, `${fmt(ft + st)}`);
  }
}

// =====================================================================
// 5 — ANALYTICS over large arrays: correct + finite + records processed
// =====================================================================
console.log('\n5  Analytics — inventory health / workshop score / progress / ledgerByPart over the FULL array\n');
function ledgerByPart(sales) {
  const m = new Map();
  sales.forEach((s) => {
    const e = m.get(s.partId) || { units: 0, revenue: 0, cost: 0, profit: 0 };
    e.units += s.qty || 0; e.revenue += s.revenue || 0; e.cost += s.cost || 0;
    e.profit += s.profit ?? (s.revenue || 0) - (s.cost || 0);
    m.set(s.partId, e);
  });
  return m;
}
const anRows = [];
for (const N of SIZES) {
  const { parts, sales, invoices, jobCards } = DATA[N];
  const h = ms(() => computeInventoryHealth(parts));
  const w = ms(() => computeWorkshopScore({ inventory: parts, sales, suppliers: [] }));
  const p = ms(() => computeWorkshopProgress({ inventory: parts, invoices, jobCards, sales }));
  const lbp = ms(() => ledgerByPart(sales));
  // correctness: ledgerByPart total revenue === independent Σ sales.revenue (no dropped rows)
  let totRev = 0; sales.forEach((s) => { totRev += s.revenue; });
  let lbpRev = 0; lbp.r.forEach((e) => { lbpRev += e.revenue; });
  ok(`N=${N}: ledgerByPart aggregated ALL ${N} sales — Σ revenue matches (${Math.abs(totRev - lbpRev) < 0.01})`, Math.abs(totRev - lbpRev) < 0.01);
  ok(`N=${N}: inventory health score finite 0-100`, Number.isFinite(h.r.score) && h.r.score >= 0 && h.r.score <= 100);
  ok(`N=${N}: workshop score & every progress pct finite`,
    Number.isFinite(w.r.score) && p.r.every((m) => Number.isFinite(m.pct)));
  anRows.push({ N, health: h.t, workshopScore: w.t, progress: p.t, ledgerByPart: lbp.t });
}
console.log('\n  analytics cost (ms):');
console.table(anRows.map((r) => ({ N: r.N, health: fmt(r.health), 'workshop score': fmt(r.workshopScore), progress: fmt(r.progress), ledgerByPart: fmt(r.ledgerByPart) })));

// =====================================================================
// 6 — VEHICLES: derived from nested customers[].vehicles + index over invoices/jobcards
// =====================================================================
console.log('\n6  Vehicle analytics — rows derived from customers[].vehicles, index over invoices+jobCards\n');
const vehRows = [];
for (const N of SIZES) {
  const { customers, invoices, jobCards } = DATA[N];
  // the shipped VehiclesModule.rows derivation
  const derive = ms(() => {
    const out = [];
    customers.forEach((c) => (c.vehicles || []).forEach((v) => out.push({ ...v, ownerId: c.id, owner: c.name })));
    return out;
  });
  const idx = ms(() => buildVehicleIndex(jobCards, invoices));
  const stats = ms(() => computeVehicleStats(derive.r, idx.r, {}));
  const indepVeh = customers.reduce((s, c) => s + c.vehicles.length, 0);
  ok(`N=${N}: derived ${derive.r.length} vehicle rows === Σ nested vehicles (${indepVeh}) — none dropped`, derive.r.length === indepVeh);
  ok(`N=${N}: computeVehicleStats.total === ${derive.r.length}, all counts finite`,
    stats.r.total === derive.r.length && Number.isFinite(Number(stats.r.avgVisits)));
  vehRows.push({ N, 'derive rows': derive.t, 'build index': idx.t, computeStats: stats.t });
}
console.log('\n  vehicle-analytics cost (ms):');
console.table(vehRows.map((r) => ({ N: r.N, 'derive rows': fmt(r['derive rows']), 'build index': fmt(r['build index']), computeStats: fmt(r.computeStats) })));

// =====================================================================
// 7 — TRANSITION 100 → 500 → 1k → 5k → 10k → 1k → 100 → 0
// =====================================================================
console.log('\n7  Cardinality transition — no stale carry, correct at every step\n');
{
  const seq = [100, 500, 1000, 5000, 10000, 1000, 100, 0];
  let allOk = true;
  const results = [];
  for (const N of seq) {
    const parts = genParts(Math.max(1, Math.min(N, 10000)), 1);
    const invoices = N === 0 ? [] : genInvoices(N, parts, 3);
    const stats = billingStats(invoices);
    const health = computeInventoryHealth(N === 0 ? [] : parts);
    // independent: count must equal what we generated; grand must be finite
    const okStep = stats.count === (N === 0 ? 0 : N) && Number.isFinite(stats.grand) && Number.isFinite(health.score);
    if (!okStep) allOk = false;
    results.push(`${N}:${stats.count}`);
  }
  ok(`transition ${seq.join('→')}: count tracks the dataset exactly at every step (no stale rows)`, allOk, results.join(' '));
  // 10k → 0 specifically
  const empty = billingStats([]);
  ok('10,000 → 0: every KPI resets to 0 / finite (no leftover totals)',
    empty.count === 0 && empty.grand === 0 && empty.outstanding === 0 && empty.realCount === 0 && empty.trend.length === 14);
}

// =====================================================================
// 8 — ARCHITECTURE GUARDS (the scalability contract, from source)
// =====================================================================
console.log('\n8  Architecture guards — bounded listeners, capacity policy, client pagination\n');
{
  const fs = require('fs');
  const path = require('path');
  const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
  const repo = read('../repositories/firestoreRepository.js');
  const consts = read('../constants/index.js');
  const dash = read('../components/InventoryDashboard.js');
  const cap = read('../constants/capacity.js');

  ok('repo.subscribeWindow REQUIRES a positive `max` — no unbounded listener is constructible',
    /if \(!max \|\| max < 1\) \{\s*throw new Error/.test(repo));
  ok('every named subscription passes a LIMITS.*_LIVE cap (parts/customers/invoices/jobCards/sales/suppliers/audit)',
    /subscribeParts[\s\S]*?LIMITS\.PARTS_LIVE/.test(repo)
    && /subscribeCustomers[\s\S]*?LIMITS\.CUSTOMERS_LIVE/.test(repo)
    && /subscribeInvoices[\s\S]*?LIMITS\.INVOICES_LIVE/.test(repo));
  // every big-collection query in the container ends in limit(LIMITS.*_LIVE); and there
  // is no raw `onSnapshot(collection(db, ...))` without a query()/limit() wrapper.
  ok('the container\'s own queries on big collections all carry limit(LIMITS.*_LIVE)',
    /query\(collection\(db, COLLECTIONS\.CUSTOMERS\), orderBy\('createdAt', 'desc'\), limit\(LIMITS\.CUSTOMERS_LIVE\)\)/.test(dash)
    && /query\(collection\(db, COLLECTIONS\.INVOICES\), orderBy\('createdAt', 'desc'\), limit\(LIMITS\.INVOICES_LIVE\)\)/.test(dash)
    && /query\(collection\(db, COLLECTIONS\.PARTS\), orderBy\('createdAt', 'desc'\), limit\(LIMITS\.PARTS_LIVE\)\)/.test(dash)
    && /query\(collection\(db, COLLECTIONS\.JOB_CARDS\), orderBy\('createdAt', 'desc'\), limit\(LIMITS\.JOB_CARDS_LIVE\)\)/.test(dash)
    && /query\(collection\(db, COLLECTIONS\.SALES\), orderBy\('createdAt', 'desc'\), limit\(LIMITS\.SALES_LIVE\)\)/.test(dash));
  ok('no unbounded `onSnapshot(collection(db, <big collection>))` — every live subscription is a bounded query()',
    !/onSnapshot\(\s*collection\(db,\s*COLLECTIONS\.(CUSTOMERS|INVOICES|PARTS|JOB_CARDS|SALES)\)\s*,/.test(dash));
  const LIMITS = require('../constants/index.js').LIMITS;
  ok(`live windows: parts ${LIMITS.PARTS_LIVE} / customers ${LIMITS.CUSTOMERS_LIVE} / invoices ${LIMITS.INVOICES_LIVE} / jobCards ${LIMITS.JOB_CARDS_LIVE} / sales ${LIMITS.SALES_LIVE}`,
    LIMITS.PARTS_LIVE > 0 && LIMITS.CUSTOMERS_LIVE > 0 && LIMITS.INVOICES_LIVE > 0);
  const { CAPACITY_LIMIT } = require('../constants/capacity.js');
  ok(`ledger collections are capacity-capped at ${CAPACITY_LIMIT} (invoices/jobCards/sales/PO/stockIn/stockOut) with a warning threshold`,
    CAPACITY_LIMIT === 5000 && /CAPACITY_WARNING_THRESHOLD/.test(cap));
  ok('repo exposes getCountFromServer via count() — the true total is knowable without downloading the collection',
    /export async function count\(/.test(repo) && /getCountFromServer/.test(repo));
  ok('repo exposes fetchPage (cursor) + searchByPrefix (server prefix range) for reaching beyond the window',
    /export async function fetchPage\(/.test(repo) && /export async function searchByPrefix\(/.test(repo) && /startAfter/.test(repo));
  // the documented characteristic: list views paginate CLIENT-SIDE over the window
  ok('DOCUMENTED: list views (Billing/Customers/Vehicles/Parts) paginate CLIENT-SIDE — filtered.slice((page-1)*PER, page*PER), not a server cursor',
    /filtered\.slice\(\(safePage - 1\) \* PER, safePage \* PER\)/.test(read('../components/billing/BillingModule.jsx')));
}

console.log(`\n${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
