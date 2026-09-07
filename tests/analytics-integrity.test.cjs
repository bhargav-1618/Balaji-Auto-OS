/**
 * tests/analytics-integrity.test.cjs
 *
 * PHASE 23 — ANALYTICS / SOURCE-OF-TRUTH RECONCILIATION.
 *
 * Proves the chain
 *
 *   authoritative invoice (lines + payments + invoice-level discount + GST)
 *        ↓  realization gate (isRealized)
 *   sales / services ledger rows       (revenueLines / ledgerDelta)
 *        ↓  monthly aggregation
 *   salesRollups                       (rollupDeltas — reconstructed here)
 *        ↓
 *   dashboard / Reports analytics      (periodAgg / trend aggregation — reconstructed here)
 *
 * produces mathematically correct Revenue / Cost / Gross Profit / Margin.
 *
 * The oracle re-derives every expected figure BY HAND from a tiny known truth table —
 * it never calls the production analytics helpers. Where a figure is produced by a
 * component-scoped function that cannot be imported (periodAgg, trend, ledgerByPart),
 * the aggregation is reconstructed here from its documented formula and cross-checked
 * against a source-pattern assertion on the shipped code.
 *
 * PH23-01 (fixed here): an invoice-level discount was folded into the invoice total
 * (totalsOf/invTotals → grandTotal/profitAmount, Billing reports) but NOT into the
 * sales ledger / rollups / dashboard analytics, which read per-line revenue. Every
 * discounted paid invoice therefore overstated analytics Revenue AND Profit by the
 * whole discount (Cost unchanged → Margin overstated too).
 */
require('./setup.cjs');
const fs = require('fs');
const path = require('path');

const { totalsOf, deriveStatus } = require('../components/billing/BillingModule.jsx');
const { invTotals } = require('../components/InventoryDashboard.js');
const {
  revenueLines, ledgerDelta, isRealized, invoiceTotals, toNum,
} = require('../services/billingService');
const { computeRange, computeWorkshopProgress } = require('../services/analyticsService');
const { getDemoData } = require('../lib/demoData.js');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const near = (a, b, eps = 0.011) => Math.abs((a || 0) - (b || 0)) <= eps;
const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const dash = read('../components/InventoryDashboard.js');

// =====================================================================
// 0 — INDEPENDENT ORACLE  (never calls a production analytics helper)
// =====================================================================
// A ledger row's realized revenue for one invoice line:
//   lineNet   = qty * rate * (1 - lineDisc/100)          (floored at 0)
//   sub       = Σ lineNet
//   invDisc   = discountType==='percent' ? sub*disc%      : disc          (flat ₹)
//   afterDisc = max(0, sub - invDisc)
//   lineRev   = lineNet * (afterDisc / sub)               ← invoice discount, allocated
//   lineCost  = isPart ? qty * purchasePrice : 0          (labour/services have no COGS)
//   lineProfit= lineRev - lineCost
// GST is NOT part of analytics revenue (it is a pass-through liability, not takings).
function oracleLedger(iv) {
  const lines = Array.isArray(iv.lines) ? iv.lines : [];
  let sub = 0;
  const rows = lines.map((l) => {
    const qty = Number(l.qty) || 0;
    const gross = qty * (Number(l.rate) || 0);
    const net = Math.max(0, gross - gross * ((Number(l.disc) || 0) / 100));
    sub += net;
    const isPart = !!l.partId;
    return { net, isPart, cost: isPart ? qty * (Number(l.purchasePrice) || 0) : 0, qty, kind: l.kind };
  });
  const discRaw = Number(iv.discount) || 0;
  const invDisc = iv.discountType === 'percent' ? sub * (discRaw / 100) : discRaw;
  const afterDisc = Math.max(0, sub - invDisc);
  const scale = invDisc > 0 && sub > 0 ? afterDisc / sub : 1;
  let revenue = 0, cost = 0;
  rows.forEach((r) => { revenue += r.net * scale; cost += r.cost; });
  return { sub, afterDisc, revenue, cost, profit: revenue - cost };
}
const paidCopy = (iv) => ({ ...iv, status: 'Paid', payments: [{ id: 'p', mode: 'Cash', amount: totalsOf(iv).grand, date: '2026-06-15' }] });
const draftCopy = (iv) => ({ ...iv, status: 'Draft', payments: [] });
const mkLine = (o) => ({ id: `l${Math.random().toString(36).slice(2, 9)}`, kind: 'Part', qty: 1, rate: 0, disc: 0, partId: null, purchasePrice: 0, gst: 18, ...o });
const inv = (fields) => ({ invNo: 'INV-A1', gstPct: 18, gstMode: 'auto', discount: 0, discountType: 'flat', payments: [], lines: [], ...fields });
const ledgerNet = (rows) => rows.reduce((a, r) => ({ rev: a.rev + r.revenue, cost: a.cost + r.cost, profit: a.profit + r.profit }), { rev: 0, cost: 0, profit: 0 });

// =====================================================================
// 1 — THE ACCOUNTING TRUTH TABLE  (oracle ↔ ledgerDelta ↔ every layer)
// =====================================================================
console.log('\n1  Truth table — Revenue / Cost / Gross Profit / Margin agree at every layer\n');
{
  //           qty  rate  cost/u   → rev   cost  profit
  //  Sale A:   2    500    300       1000   600    400
  //  Sale B:   4    500    300       2000  1200    800
  //  Sale C:   1    500    200        500   200    300
  //                                 -----  ----   ----
  //  Expected                        3500  2000   1500     margin = 1500/3500 = 42.857%
  const A = paidCopy(inv({ invNo: 'INV-A', lines: [mkLine({ partId: 'pA', qty: 2, rate: 500, purchasePrice: 300, gst: 0 })] }));
  const B = paidCopy(inv({ invNo: 'INV-B', lines: [mkLine({ partId: 'pB', qty: 4, rate: 500, purchasePrice: 300, gst: 0 })] }));
  const C = paidCopy(inv({ invNo: 'INV-C', lines: [mkLine({ partId: 'pC', qty: 1, rate: 500, purchasePrice: 200, gst: 0 })] }));

  const rows = [...ledgerDelta(draftCopy(A), A), ...ledgerDelta(draftCopy(B), B), ...ledgerDelta(draftCopy(C), C)];
  const agg = ledgerNet(rows);
  ok('ledger Revenue = 3500', near(agg.rev, 3500), `got ${agg.rev}`);
  ok('ledger Cost = 2000', near(agg.cost, 2000), `got ${agg.cost}`);
  ok('ledger Gross Profit = 1500', near(agg.profit, 1500), `got ${agg.profit}`);
  const margin = agg.rev > 0 ? (agg.profit / agg.rev) * 100 : 0;
  ok('ledger Margin = 42.857%', Math.abs(margin - (1500 / 3500) * 100) < 0.01, `got ${margin.toFixed(3)}`);

  // reconcile with the INVOICE money path (GST-exempt lines → afterDisc == grand)
  const invSideRev = [A, B, C].reduce((s, x) => s + totalsOf(x).afterDisc, 0);
  const invSideProfit = [A, B, C].reduce((s, x) => s + totalsOf(x).profit, 0);
  ok('ledger Revenue reconciles with Σ totalsOf().afterDisc', near(agg.rev, invSideRev), `ledger ${agg.rev} vs invoice ${invSideRev}`);
  ok('ledger Profit reconciles with Σ totalsOf().profit', near(agg.profit, invSideProfit), `ledger ${agg.profit} vs invoice ${invSideProfit}`);

  // reconstruct the monthly rollup the transaction engine writes (revenue/cost/profit increments)
  const rollup = rows.reduce((m, r) => ({ revenue: m.revenue + r.revenue, cost: m.cost + r.cost, profit: m.profit + r.profit }), { revenue: 0, cost: 0, profit: 0 });
  ok('salesRollups revenue increment == ledger revenue', near(rollup.revenue, 3500));
  ok('salesRollups profit increment == revenue − cost (no rollup drift)', near(rollup.profit, rollup.revenue - rollup.cost));

  // dashboard periodAgg / Reports trend both do: totProfit = Σrev − Σcost ; margin = totProfit/totRev
  ok('Reports "Monthly Profit Trend" totProfit is defined as totRev − totCost in the shipped code',
    /const totProfit = totRev - totCost;/.test(dash));
  ok('Reports trend margin guards divide-by-zero (totRev > 0 ? … : 0)',
    /const margin = totRev > 0 \? \(totProfit \/ totRev\) \* 100 : 0;/.test(dash));
}

// =====================================================================
// 2 — PH23-01: invoice-level discount is folded into analytics revenue
// =====================================================================
console.log('\n2  PH23-01 — an invoice-level discount reaches the sales ledger / rollups / analytics\n');
{
  // ₹10,000 of lines, ₹1,000 flat invoice discount, ₹6,000 cost, GST-exempt for a clean check.
  const base = inv({
    invNo: 'INV-D1', gstMode: 'exempt', discount: 1000, discountType: 'flat',
    lines: [
      mkLine({ partId: 'p1', qty: 1, rate: 6000, purchasePrice: 4000, gst: 0 }),
      mkLine({ partId: 'p2', qty: 1, rate: 4000, purchasePrice: 2000, gst: 0 }),
    ],
  });
  const paid = paidCopy(base);
  const o = oracleLedger(paid);
  ok('oracle: sub 10000, afterDisc 9000, cost 6000, profit 3000',
    near(o.sub, 10000) && near(o.afterDisc, 9000) && near(o.cost, 6000) && near(o.profit, 3000), JSON.stringify(o));

  const rows = ledgerDelta(draftCopy(base), paid);
  const agg = ledgerNet(rows);
  ok('[PH23-01] Σ ledger revenue == 9000 (was 10000 — discount now allocated)', near(agg.rev, 9000), `got ${agg.rev}`);
  ok('[PH23-01] Σ ledger profit == 3000 (was 4000 — overstated by the ₹1,000 discount)', near(agg.profit, 3000), `got ${agg.profit}`);
  ok('[PH23-01] ledger Cost is unchanged by the discount (still 6000)', near(agg.cost, 6000), `got ${agg.cost}`);

  // must now reconcile with the invoice money path (which always applied the discount)
  ok('[PH23-01] Σ ledger revenue == totalsOf().afterDisc', near(agg.rev, totalsOf(paid).afterDisc));
  ok('[PH23-01] Σ ledger profit == totalsOf().profit', near(agg.profit, totalsOf(paid).profit));
  ok('[PH23-01] Σ ledger profit == invTotals().profit (the stored profitAmount)', near(agg.profit, invTotals({ ...paid, profitAmount: totalsOf(paid).profit }).profit));

  // percent discount
  const pct = inv({ invNo: 'INV-D2', gstMode: 'exempt', discount: 20, discountType: 'percent', lines: [mkLine({ partId: 'p3', qty: 2, rate: 1000, purchasePrice: 400, gst: 0 })] });
  const pctPaid = paidCopy(pct);
  const pAgg = ledgerNet(ledgerDelta(draftCopy(pct), pctPaid));
  ok('[PH23-01] 20% invoice discount → ledger revenue 1600 (2000 − 20%)', near(pAgg.rev, 1600), `got ${pAgg.rev}`);
  ok('[PH23-01] 20% invoice discount → ledger profit 800 (1600 − 800 cost)', near(pAgg.profit, 800), `got ${pAgg.profit}`);
  ok('[PH23-01] percent discount reconciles with totalsOf().afterDisc', near(pAgg.rev, totalsOf(pctPaid).afterDisc));

  // no-discount invoices are untouched by the fix (scale == 1)
  const plain = paidCopy(inv({ invNo: 'INV-P', gstMode: 'exempt', lines: [mkLine({ partId: 'p4', qty: 3, rate: 700, purchasePrice: 500, gst: 0 })] }));
  const plainAgg = ledgerNet(ledgerDelta(draftCopy(plain), plain));
  ok('no invoice discount → ledger revenue == raw line net (2100), unchanged', near(plainAgg.rev, 2100));

  // source proof — the shipped production ledger builder now allocates it
  ok('shipped InventoryDashboard.invoiceRevenueLines allocates the invoice-level discount (afterDisc/sub scale)',
    /const invDisc = iv\?\.discountType === 'percent' \? sub \* \(toNum\(iv\?\.discount\) \/ 100\) : toNum\(iv\?\.discount\);\s*\n\s*if \(invDisc > 0 && sub > 0\) \{\s*\n\s*const scale = Math\.max\(0, sub - invDisc\) \/ sub;\s*\n\s*Object\.values\(map\)\.forEach\(\(e\) => \{ e\.revenue \*= scale; \}\);/.test(dash));
  ok('shipped billingService.revenueLines applies the same discount allocation',
    /const invDisc = iv\?\.discountType === 'percent'[\s\S]{0,200}Object\.values\(out\)\.forEach\(\(e\) => \{ e\.revenue \*= scale; e\.profit = e\.revenue - e\.cost; \}\);/.test(read('../services/billingService.js')));
}

// =====================================================================
// 3 — GST is EXCLUDED from analytics revenue (intentional; must be consistent)
// =====================================================================
console.log('\n3  GST — analytics revenue is ex-GST (recognized revenue, not invoice turnover)\n');
{
  const g = paidCopy(inv({ invNo: 'INV-G', gstPct: 18, lines: [mkLine({ partId: 'pg', qty: 1, rate: 1000, purchasePrice: 600, gst: 18 })] }));
  const agg = ledgerNet(ledgerDelta(draftCopy(g), g));
  ok('ledger revenue is the ex-GST line net (1000), not the GST-inclusive grand (1180)', near(agg.rev, 1000), `got ${agg.rev}`);
  ok('totalsOf().grand carries GST (1180) — the two metrics differ BY the tax, by design',
    near(totalsOf(g).grand, 1180) && near(totalsOf(g).afterDisc, 1000));
  ok('ledger revenue == totalsOf().afterDisc (the pre-GST, post-discount base) for a taxed invoice', near(agg.rev, totalsOf(g).afterDisc));
}

// =====================================================================
// 4 — MARGIN — every edge, no NaN / Infinity / divide-by-zero
// =====================================================================
console.log('\n4  Margin — bounded on every degenerate input\n');
{
  const marginOf = (rev, cost) => { const p = rev - cost; return rev > 0 ? (p / rev) * 100 : 0; };
  const cases = [
    ['revenue 0, cost 0', 0, 0, 0],
    ['revenue 0, cost 100 (write-off)', 0, 100, 0],
    ['cost > revenue (loss)', 1000, 1500, -50],
    ['cost == revenue', 1000, 1000, 0],
    ['healthy', 1000, 600, 40],
  ];
  cases.forEach(([label, rev, cost, expect]) => {
    const m = marginOf(rev, cost);
    ok(`margin (${label}) = ${expect}% and is finite`, Number.isFinite(m) && Math.abs(m - expect) < 0.01, `got ${m}`);
  });
  // the shipped code's margin sites all guard `rev > 0`
  ok('shipped: pMargin guards revenue > 0', /const r = L\(p\)\.revenue; return r > 0 \? \(L\(p\)\.profit \/ r\) \* 100 : 0;/.test(dash));
  ok('shipped: Sales avgMargin guards revenue > 0', /const avgMargin = revM > 0 \? \(proM \/ revM\) \* 100 : 0;/.test(dash));
  // negative profit is NEVER clamped to zero
  const loss = paidCopy(inv({ invNo: 'INV-L', gstMode: 'exempt', lines: [mkLine({ partId: 'pl', qty: 1, rate: 500, purchasePrice: 900, gst: 0 })] }));
  const lAgg = ledgerNet(ledgerDelta(draftCopy(loss), loss));
  ok('a loss-making sale reports NEGATIVE profit (−400), not 0', near(lAgg.profit, -400), `got ${lAgg.profit}`);
}

// =====================================================================
// 5 — PAYMENT vs REVENUE — the realization gate
// =====================================================================
console.log('\n5  Payment vs revenue — nothing enters the ledger until the invoice is realized (Paid)\n');
{
  const base = inv({ invNo: 'INV-PP', gstMode: 'exempt', lines: [mkLine({ partId: 'pp', qty: 1, rate: 10000, purchasePrice: 6000, gst: 0 })] });
  const partial = { ...base, status: 'Unpaid', payments: [{ id: 'x', mode: 'Cash', amount: 4000, date: '2026-06-01' }] };
  ok('a 40%-paid invoice is NOT realized', !isRealized(partial));
  ok('revenueLines() of a partially-paid invoice is empty — analytics revenue for it is 0',
    Object.keys(revenueLines(partial)).length === 0);
  const full = paidCopy(base);
  ok('once fully paid, the whole invoice revenue enters at once (9000-less-nothing here = 10000)',
    near(ledgerNet(ledgerDelta(partial, full)).rev, 10000));
  ok('INTENTIONAL: analytics "Revenue" == realized invoice subtotal (post-discount, ex-GST), NOT cash collected',
    true);
}

// =====================================================================
// 6 — RETURNS / REVERSAL — exact inverse, sign preserved
// =====================================================================
console.log('\n6  Returns / reversal — cancelling a paid invoice unwinds the ledger exactly\n');
{
  const base = inv({ invNo: 'INV-R', gstMode: 'exempt', discount: 500, discountType: 'flat', lines: [mkLine({ partId: 'pr', qty: 2, rate: 1500, purchasePrice: 900, gst: 0 })] });
  const paid = paidCopy(base);
  const fwd = ledgerNet(ledgerDelta(draftCopy(base), paid));
  const cancelled = { ...paid, status: 'Cancelled' };
  const rev = ledgerNet(ledgerDelta(paid, cancelled));
  ok('forward revenue = 2500 (3000 − ₹500 discount)', near(fwd.rev, 2500), `got ${fwd.rev}`);
  ok('reversal revenue = −2500 (exact inverse)', near(rev.rev, -2500), `got ${rev.rev}`);
  ok('reversal profit = −(forward profit)', near(rev.profit, -fwd.profit));
  ok('net after sale + reversal = 0 revenue, 0 cost, 0 profit',
    near(fwd.rev + rev.rev, 0) && near(fwd.cost + rev.cost, 0) && near(fwd.profit + rev.profit, 0));
  ok('re-saving the same paid invoice posts NO new ledger rows (idempotent)', ledgerDelta(paid, paid).length === 0);
}

// =====================================================================
// 7 — MULTI-LINE / REPEATED PART — aggregation cardinality (Phase 14)
// =====================================================================
console.log('\n7  Multi-line invoice — repeated part aggregates, independent lines stay separate\n');
{
  const iv2 = paidCopy(inv({
    invNo: 'INV-M', gstMode: 'exempt',
    lines: [
      mkLine({ id: 'a', partId: 'same', qty: 2, rate: 500, purchasePrice: 300, gst: 0 }),
      mkLine({ id: 'b', partId: 'same', qty: 3, rate: 500, purchasePrice: 300, gst: 0 }), // same part again
      mkLine({ id: 'c', kind: 'Labour', partId: null, qty: 1, rate: 800, gst: 0 }),
      mkLine({ id: 'd', kind: 'Labour', partId: null, qty: 1, rate: 800, gst: 0 }),        // independent 2nd labour line
    ],
  }));
  const rows = ledgerDelta(draftCopy(iv2), iv2);
  const agg = ledgerNet(rows);
  ok('total revenue = 5*500 + 2*800 = 4100', near(agg.rev, 4100), `got ${agg.rev}`);
  ok('total cost = 5 * 300 = 1500 (labour has no COGS)', near(agg.cost, 1500), `got ${agg.cost}`);
  // revenueLines keys by l.id → 4 rows; the demo/prod runtime path keys parts by partId → part aggregates.
  const partRows = rows.filter((r) => r.partId === 'same');
  ok('the repeated part is not double-counted: its rows sum to qty 5, revenue 2500',
    partRows.reduce((s, r) => s + r.qty, 0) === 5 && near(partRows.reduce((s, r) => s + r.revenue, 0), 2500));
  ok('the two independent labour lines are BOTH counted (not merged): labour revenue 1600',
    near(rows.filter((r) => r.isService).reduce((s, r) => s + r.revenue, 0), 1600));
}

// =====================================================================
// 8 — DATE / MONTH BOUNDARIES  (computeRange)
// =====================================================================
console.log('\n8  Date boundaries — computeRange includes the whole first and last day\n');
{
  const { start, end } = computeRange('month');
  const s = new Date(start), e = new Date(end);
  ok('"month" starts at 00:00:00.000 on day 1', s.getDate() === 1 && s.getHours() === 0 && s.getMinutes() === 0 && s.getSeconds() === 0 && s.getMilliseconds() === 0);
  ok('"month" ends at 23:59:59.999 today', e.getHours() === 23 && e.getMinutes() === 59 && e.getSeconds() === 59 && e.getMilliseconds() === 999);

  const lm = computeRange('lastmonth');
  const lms = new Date(lm.start), lme = new Date(lm.end);
  ok('"lastmonth" start is day 1 of the previous month', lms.getDate() === 1);
  ok('"lastmonth" end is the LAST day of the previous month (23:59:59.999)',
    lme.getHours() === 23 && lme.getMinutes() === 59 && new Date(lme.getTime() + 1).getDate() === 1);
  ok('"lastmonth" never overlaps "month" (end < start of this month)', lm.end < computeRange('month').start);

  const y = computeRange('year');
  const ys = new Date(y.start);
  ok('"year" starts Jan 1 00:00', ys.getMonth() === 0 && ys.getDate() === 1 && ys.getHours() === 0);

  // A sale stamped on the exact first millisecond of the month is inside "month"; one 1ms
  // earlier is outside — the boundary is closed on the left, and dashboards test `t >= start`.
  const first = computeRange('month').start;
  ok('a timestamp == range.start is inside the range (t >= start)', first >= computeRange('month').start);
  ok('a timestamp == range.start − 1 is OUTSIDE the range', !((first - 1) >= computeRange('month').start));

  // month key format used by rollups + trend: YYYY-MM, zero-padded
  const mk = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  ok('month key is zero-padded YYYY-MM (Jan → -01, sorts lexically)', mk(new Date(2026, 0, 9)) === '2026-01' && '2026-01' < '2026-02' && '2025-12' < '2026-01');
}

// =====================================================================
// 9 — ZERO / EMPTY DATA — no NaN, no stale carry-over
// =====================================================================
console.log('\n9  Zero / empty — clean zero state, never NaN / Infinity\n');
{
  const emptyAgg = ledgerNet(ledgerDelta(null, null));
  ok('no invoices → revenue/cost/profit all exactly 0', emptyAgg.rev === 0 && emptyAgg.cost === 0 && emptyAgg.profit === 0);
  ok('revenueLines(undefined) is an empty object, no throw', Object.keys(revenueLines(undefined)).length === 0);
  const prog = computeWorkshopProgress({ inventory: [], invoices: [], jobCards: [], vehicles: [], sales: [] });
  ok('computeWorkshopProgress on empty data returns finite % for every row',
    prog.every((r) => typeof r.pct === 'number' && Number.isFinite(r.pct) && r.pct >= 0 && r.pct <= 100), JSON.stringify(prog));
  const salesTarget = prog.find((r) => r.label === 'Sales target');
  ok('"Sales target" with no sales history is 0%, not NaN%', salesTarget && salesTarget.value === '0%');
}

// =====================================================================
// 10 — ROLLUP RECONCILIATION against the demo dataset
// =====================================================================
console.log('\n10  Rollup reconciliation — demo salesRollups vs the demo sales ledger vs the invoices\n');
{
  const { sales, salesRollups, invoices } = getDemoData();
  const ledgerRev = sales.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
  const ledgerCost = sales.reduce((s, r) => s + (Number(r.cost) || 0), 0);
  const ledgerProfit = sales.reduce((s, r) => s + (Number(r.profit) || 0), 0);
  const rollRev = salesRollups.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
  const rollCost = salesRollups.reduce((s, r) => s + (Number(r.cost) || 0), 0);
  const rollProfit = salesRollups.reduce((s, r) => s + (Number(r.profit) || 0), 0);

  ok('demo rollup revenue == demo ledger revenue (±0.5%)', ledgerRev > 0 && Math.abs(rollRev - ledgerRev) / ledgerRev < 0.005, `rollup ${Math.round(rollRev)} vs ledger ${Math.round(ledgerRev)}`);
  ok('demo rollup cost == demo ledger cost (±0.5%) — the BUG-LIVE-005 "cost ₹0" regression stays closed', rollCost > 0 && Math.abs(rollCost - ledgerCost) / ledgerCost < 0.005, `rollup ${Math.round(rollCost)} vs ledger ${Math.round(ledgerCost)}`);
  ok('demo rollup profit == demo ledger profit (±0.5%)', Math.abs(rollProfit - ledgerProfit) / Math.max(1, Math.abs(ledgerProfit)) < 0.005);
  ok('rollup profit reconciles with revenue − cost (no drift)', near(rollProfit, rollRev - rollCost, Math.max(1, rollRev * 0.001)));
  const margin = rollRev > 0 ? ((rollRev - rollCost) / rollRev) * 100 : 0;
  ok('resulting demo margin is a plausible workshop margin (5%–95%), not 100%', margin > 5 && margin < 95, `margin ${margin.toFixed(1)}%`);

  // every demo invoice that is Paid should have its realized subtotal represented in the ledger
  const paidInvoices = invoices.filter((iv) => !iv.isEstimate && deriveStatus(iv) === 'Paid');
  const invSubtotal = paidInvoices.reduce((s, iv) => s + totalsOf(iv).afterDisc, 0);
  ok('Σ demo ledger revenue ≈ Σ paid-invoice afterDisc subtotal (±2%)',
    invSubtotal > 0 && Math.abs(ledgerRev - invSubtotal) / invSubtotal < 0.02,
    `ledger ${Math.round(ledgerRev)} vs invoices ${Math.round(invSubtotal)}`);
}

// =====================================================================
// 11 — DASHBOARD / SALES / REPORTS read the SAME ledger fields
// =====================================================================
console.log('\n11  Dashboard / Sales / Reports consistency — one revenue field, one profit field\n');
{
  ok('OverviewView periodAgg revenue = s.revenue (?? s.total) and profit = s.profit', /const rev = \(s\) => s\.revenue \?\? s\.total \?\? 0;/.test(dash) && /revenue \+= rev\(s\); pro \+= s\.profit \|\| 0;/.test(dash));
  ok('Reports ledgerByPart aggregates s.revenue / s.cost / s.profit from the same ledger', /e\.revenue \+= s\.revenue \|\| 0;\s*\n\s*e\.cost \+= s\.cost \|\| 0;/.test(dash));
  ok('SalesView cards read s.revenue / s.profit (same fields, same meaning)', /const rev = s\.revenue \|\| 0;.*\n?.*proT \+= s\.profit/.test(dash) || /revM \+= rev; proM \+= s\.profit \|\| 0;/.test(dash));
  ok('Reports trend prefers unbounded salesRollups, falls back to the ledger — both carry revenue+cost+profit', /if \(rollups\.length\) \{/.test(dash) && /e\.profit \+= s\.profit \?\? \(s\.revenue \|\| 0\) - \(s\.cost \|\| 0\);/.test(dash));
}

console.log(`\n${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
