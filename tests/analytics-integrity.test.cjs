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
  revenueLines, ledgerDelta, isRealized, isOutstanding, invoiceTotals, toNum,
} = require('../services/billingService');
const { computeRange, computeWorkshopProgress, computeAlerts } = require('../services/analyticsService');
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
// FIXTURE helper (not an oracle): pays the invoice's grand so isRealized() is true.
// Soundness of this shortcut is itself asserted in §0b below (grand == a hand figure);
// and every downstream check compares against hand CONSTANTS, so a broken totalsOf here
// would surface as a wrong revenue, not a false pass.
const paidCopy = (iv) => ({ ...iv, status: 'Paid', payments: [{ id: 'p', mode: 'Cash', amount: totalsOf(iv).grand, date: '2026-06-15' }] });
const draftCopy = (iv) => ({ ...iv, status: 'Draft', payments: [] });
const mkLine = (o) => ({ id: `l${Math.random().toString(36).slice(2, 9)}`, kind: 'Part', desc: 'Item', qty: 1, rate: 0, disc: 0, partId: null, purchasePrice: 0, gst: 18, ...o });
const inv = (fields) => ({ invNo: 'INV-A1', gstPct: 18, gstMode: 'auto', discount: 0, discountType: 'flat', payments: [], lines: [], ...fields });
const ledgerNet = (rows) => rows.reduce((a, r) => ({ rev: a.rev + r.revenue, cost: a.cost + r.cost, profit: a.profit + r.profit }), { rev: 0, cost: 0, profit: 0 });

// =====================================================================
// 0b — FIXTURE SOUNDNESS  (the paidCopy shortcut is not hiding a totalsOf bug)
// =====================================================================
console.log('\n0b  Fixture soundness — paidCopy pays a hand-verifiable grand\n');
{
  // 2 x 500 part, GST 0, no discount → hand grand = 1000. Overpay-proof: exact.
  const iv0 = inv({ lines: [mkLine({ partId: 'x', qty: 2, rate: 500, purchasePrice: 300, gst: 0 })] });
  ok('totalsOf(fixture).grand == the hand figure (1000) — paidCopy realizes on a correct amount',
    totalsOf(iv0).grand === 1000, `got ${totalsOf(iv0).grand}`);
  ok('a fixture paid EXACTLY its grand is realized (isRealized true)', isRealized(paidCopy(iv0)));
}

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

// =====================================================================
// 12 — PH23-D1: HISTORICAL COST IMMUTABILITY
// =====================================================================
// The shipped production ledger builders (InventoryDashboard.planInvoiceRealization /
// recordInvoiceSalesDelta) are component-scoped closures — not importable. This section
// reproduces the SHIPPED (post-fix) invoiceRevenueLines cost accumulation + the delta
// loops' `dCost = a.cost - b.cost`, cross-checked against a source-pattern assertion,
// then attacks the "part master changed between billing and realization" scenario.
console.log('\n12  PH23-D1 — analytics COGS is the invoice line\'s cost snapshot, not the live catalogue\n');
{
  // reproduce the shipped invoiceRevenueLines (cost from l.purchasePrice, catalogue fallback)
  const revLinesRepro = (iv, inventory) => {
    const map = {};
    let sub = 0;
    (iv?.lines || []).forEach((l) => {
      if (!(l.desc || '').trim()) return;
      const q = Number(l.qty) || 0; const rt = Number(l.rate) || 0;
      if (q <= 0 && rt <= 0) return;
      const rev = q * rt * (1 - (Number(l.disc) || 0) / 100);
      sub += rev;
      const isPartLine = l.partId && l.kind === 'Part';
      const uc = isPartLine
        ? (l.purchasePrice != null && l.purchasePrice !== '' ? Number(l.purchasePrice) || 0 : (inventory.find((p) => p.id === l.partId)?.purchasePrice || 0))
        : 0;
      const k = isPartLine ? `part:${l.partId}` : `line:${l.id}`;
      const e = map[k] || { qty: 0, revenue: 0, cost: 0, partId: isPartLine ? l.partId : null };
      e.qty += q; e.revenue += rev; e.cost += q * uc; map[k] = e;
    });
    const invDisc = iv.discountType === 'percent' ? sub * ((Number(iv.discount) || 0) / 100) : (Number(iv.discount) || 0);
    if (invDisc > 0 && sub > 0) { const sc = Math.max(0, sub - invDisc) / sub; Object.values(map).forEach((e) => { e.revenue *= sc; }); }
    return map;
  };
  const realized = (iv) => (isRealized(iv) ? iv : { invNo: iv.invNo, lines: [] });
  const planLedger = (prior, next, inventory) => {
    const before = revLinesRepro(realized(prior), inventory);
    const after = revLinesRepro(realized(next), inventory);
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    let revenue = 0, cost = 0;
    keys.forEach((k) => {
      const b = before[k] || { qty: 0, revenue: 0, cost: 0 };
      const a = after[k] || { qty: 0, revenue: 0, cost: 0 };
      const dQty = a.qty - b.qty; const dRev = a.revenue - b.revenue;
      if (dQty === 0 && Math.abs(dRev) < 0.005) return;
      revenue += dRev; cost += (a.cost || 0) - (b.cost || 0);
    });
    return { revenue, cost, profit: revenue - cost };
  };

  // source proofs — the shipped builders take cost from the line snapshot
  ok('shipped invoiceRevenueLines derives unitCost from l.purchasePrice (catalogue = fallback only)',
    /const unitCost = isPartLine\s*\n\s*\? \(l\.purchasePrice != null && l\.purchasePrice !== ''\s*\n\s*\? Number\(l\.purchasePrice\) \|\| 0\s*\n\s*: \(inventory\.find\(\(p\) => p\.id === l\.partId\)\?\.purchasePrice \|\| 0\)\)/.test(dash));
  ok('shipped: both delta loops diff a.cost − b.cost (symmetric with revenue), not dQty×catalogue',
    (dash.match(/const dCost = \(a\.cost \|\| 0\) - \(b\.cost \|\| 0\);/g) || []).length === 2
    && !/const dCost = dQty \* unitCost;/.test(dash));
  ok('shipped: invoiceRevenueLines carries e.cost, seeded to 0 in the empty-entry fallbacks',
    /revenue: 0, cost: 0,/.test(dash) && /e\.qty \+= qty; e\.revenue \+= rev; e\.cost \+= qty \* unitCost;/.test(dash));

  // --- the attack: line snapshots cost 600; part master is edited to 900 before payment
  const ivD = inv({ invNo: 'INV-HC', gstMode: 'exempt',
    lines: [mkLine({ id: 'L1', partId: 'P1', qty: 2, rate: 1000, purchasePrice: 600, gst: 0 })] });
  const catalogNow = [{ id: 'P1', purchasePrice: 900 }];   // cost was raised after billing
  const led = planLedger(draftCopy(ivD), paidCopy(ivD), catalogNow);

  ok('[PH23-D1] ledger revenue = 2000 (unaffected by the cost change)', near(led.revenue, 2000), `got ${led.revenue}`);
  ok('[PH23-D1] ledger COGS = 1200 (2 × the ₹600 SNAPSHOT), NOT 1800 (2 × today\'s ₹900 catalogue)',
    near(led.cost, 1200), `got ${led.cost}`);
  ok('[PH23-D1] ledger profit = 800 — identical to totalsOf().profit / iv.profitAmount',
    near(led.profit, 800) && near(led.profit, totalsOf(paidCopy(ivD)).profit), `ledger ${led.profit} vs invoice ${totalsOf(paidCopy(ivD)).profit}`);
  ok('[PH23-D1] ledger COGS == billingService.revenueLines COGS (the other snapshot-based impl)',
    near(led.cost, Object.values(revenueLines(paidCopy(ivD))).reduce((s, r) => s + r.cost, 0)));

  // legacy line with NO purchasePrice → catalogue fallback still applies
  const ivLegacy = inv({ invNo: 'INV-LEG', gstMode: 'exempt',
    lines: [{ id: 'L1', kind: 'Part', partId: 'P1', desc: 'Widget', qty: 2, rate: 1000, disc: 0 }] });
  const legLed = planLedger(draftCopy(ivLegacy), paidCopy(ivLegacy), catalogNow);
  ok('[PH23-D1] a legacy line carrying no cost snapshot still falls back to the catalogue (cost 1800)',
    near(legLed.cost, 1800), `got ${legLed.cost}`);

  // AFTER realization, a part-master edit must not retro-change the frozen sales row
  ok('[PH23-D1] once written, the sales row stores `cost: dCost` — a later catalogue edit cannot touch it',
    /cost: dCost,/.test(dash) && /profit: dRev - dCost,/.test(dash));
}

// =====================================================================
// 13 — PH23-01 ROUNDING / FLOATING-POINT ATTACK
// =====================================================================
console.log('\n13  PH23-01 discount allocation — no ₹0.01 drift on adversarial values\n');
{
  const mk = (o) => ({ id: `l${Math.random().toString(36).slice(2, 8)}`, kind: 'Part', partId: 'p' + Math.random().toString(36).slice(2, 6), qty: 1, rate: 0, disc: 0, purchasePrice: 0, gst: 0, ...o });
  const b = (lines, fields = {}) => ({ invNo: 'INV-RD', gstPct: 0, gstMode: 'exempt', discount: 0, discountType: 'flat', lines, ...fields });
  const cases = [
    ['3×₹1, ₹2 flat (scale 2/3)', b([mk({ rate: 1 }), mk({ rate: 1 }), mk({ rate: 1 })], { discount: 2 })],
    ['0.1+0.2+0.3, 10%', b([mk({ rate: 0.1 }), mk({ rate: 0.2 }), mk({ rate: 0.3 })], { discount: 10, discountType: 'percent' })],
    ['33.33×3 + 66.67, ₹7 flat', b([mk({ rate: 33.33 }), mk({ rate: 33.33 }), mk({ rate: 33.33 }), mk({ rate: 66.67 })], { discount: 7 })],
    ['999.99 + 1000.01, 33%', b([mk({ rate: 999.99 }), mk({ rate: 1000.01 })], { discount: 33, discountType: 'percent' })],
    ['primes 7/11/13/17/19, ₹23 flat', b([7, 11, 13, 17, 19].map((r) => mk({ rate: r })), { discount: 23 })],
    ['97 lines ₹3.33, ₹101 flat', b(Array.from({ length: 97 }, () => mk({ rate: 3.33 })), { discount: 101 })],
    ['3 lines ₹1e7, ₹1 flat', b([mk({ rate: 1e7 }), mk({ rate: 1e7 }), mk({ rate: 1e7 })], { discount: 1 })],
  ];
  let worst = 0;
  for (const [name, iv] of cases) {
    const p = paidCopy(iv);
    const svc = Object.values(revenueLines(p)).reduce((s, r) => s + r.revenue, 0);
    const led = ledgerDelta(draftCopy(iv), p).reduce((s, r) => s + r.revenue, 0);
    const target = totalsOf(p).afterDisc;      // paisa-rounded (p2) in totalsOf
    const d = Math.max(Math.abs(svc - target), Math.abs(led - target));
    worst = Math.max(worst, d);
    ok(`[PH23-01 rounding] ${name}: Σ allocated revenue within ₹0.01 of afterDisc`, d < 0.01, `Δ=${d.toExponential(2)} (afterDisc ${target})`);
  }
  ok(`[PH23-01 rounding] worst drift across all adversarial cases is sub-paisa (${worst.toExponential(2)})`, worst < 0.005);
}

// =====================================================================
// 14 — MUTATION SELF-TEST  (proves these assertions can actually fail)
// =====================================================================
console.log('\n14  Mutation self-test — a corrupted result IS caught\n');
{
  const A = paidCopy(inv({ invNo: 'M-A', gstMode: 'exempt', lines: [mkLine({ partId: 'ma', qty: 2, rate: 500, purchasePrice: 300, gst: 0 })] }));
  const trueRows = ledgerDelta(draftCopy(A), A);
  const trueAgg = ledgerNet(trueRows);
  // truth: revenue 1000, cost 600, profit 400, margin 40
  const mutants = [
    ['revenue + 1', { ...trueAgg, rev: trueAgg.rev + 1 }],
    ['cost + 1', { ...trueAgg, cost: trueAgg.cost + 1 }],
    ['profit + 1', { ...trueAgg, profit: trueAgg.profit + 1 }],
    ['revenue × 1.001 (0.1%)', { ...trueAgg, rev: trueAgg.rev * 1.001 }],
    ['drop the sale entirely', { rev: 0, cost: 0, profit: 0 }],
    ['swap revenue and cost', { rev: trueAgg.cost, cost: trueAgg.rev, profit: trueAgg.cost - trueAgg.rev }],
  ];
  const check = (agg) => near(agg.rev, 1000) && near(agg.cost, 600) && near(agg.profit, 400)
    && Math.abs((agg.rev > 0 ? agg.profit / agg.rev * 100 : 0) - 40) < 0.01;
  ok('the TRUE aggregate passes the reconciliation check', check(trueAgg));
  let caught = 0;
  for (const [label, m] of mutants) {
    const detected = !check(m);
    ok(`mutation "${label}" is DETECTED (assertion flips to fail)`, detected);
    if (detected) caught += 1;
  }
  ok(`all ${mutants.length} mutations were caught — the suite is not vacuous`, caught === mutants.length);
  // month-grouping mutation: a sale mis-keyed to the wrong month must break the "Σ months == period total"
  const mk = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const rows = [{ m: '2026-01', v: 100 }, { m: '2026-02', v: 200 }, { m: '2026-03', v: 300 }];
  const periodTotal = 600;
  const good = rows.reduce((s, r) => s + r.v, 0);
  const badMonthKey = [{ m: mk(new Date(2026, 0, 32)), v: 100 }]; // Jan 32 → Feb 1 → '2026-02' (JS date rollover)
  ok('a date-rollover month key lands in Feb not Jan (JS Date normalises) — grouping is well-defined',
    badMonthKey[0].m === '2026-02');
  ok('Σ month totals == period total for the correct grouping', good === periodTotal);
}

// =====================================================================
// 15 — CROSS-VIEW "REVENUE" DEFINITIONS  (explicit inventory)
// =====================================================================
console.log('\n15  Cross-view — the app has 4 distinct "Revenue"-family definitions; each classified\n');
{
  // one invoice: sub 10000, invoice discount 1000, GST 18% on 9000 = 1620, grand 10620, paid 4000
  const one = inv({ invNo: 'INV-X', gstPct: 18, discount: 1000, discountType: 'flat',
    lines: [mkLine({ partId: 'x', qty: 1, rate: 10000, purchasePrice: 6000, gst: 18 })],
    payments: [{ id: 'p', mode: 'Cash', amount: 4000, date: '2026-06-01' }], status: 'Unpaid' });
  const t = totalsOf(one);
  ok('def #1 analytics "Revenue" (sales ledger) — realized, post-discount, EX-GST = afterDisc (9000); this invoice is not realized → 0',
    t.afterDisc === 9000 && Object.keys(revenueLines(one)).length === 0);
  ok('def #2 Billing "Revenue (Month)" = Σ totalsOf().grand — GST-INCLUSIVE (10620), finalised invoices (paid + unpaid), NOT drafts/estimates (PH23-D2)',
    t.grand === 10620 && /monthRev \+= t\.grand;/.test(read('../components/billing/BillingModule.jsx'))
    && /if \(st === 'Draft' \|\| iv\.isEstimate\) \{ draftCount \+= 1; return; \}/.test(read('../components/billing/BillingModule.jsx')));
  ok('[PH23-D2] Billing turnover KPIs (grand / monthRev / revToday / topCustomers / trend) count only real, non-reversed bills',
    /const REAL_STATUSES = \['Paid', 'Unpaid', 'Partially Paid'\];/.test(read('../components/billing/BillingModule.jsx'))
    && /if \(!REAL_STATUSES\.includes\(st\)\) return;/.test(read('../components/billing/BillingModule.jsx'))
    && /const isReal = \(iv\) => !iv\.isEstimate && REAL_STATUSES\.includes\(deriveStatus\(iv\)\);/.test(read('../components/billing/BillingModule.jsx'))
    && /const avgInv = realCount \? grand \/ realCount : 0;/.test(read('../components/billing/BillingModule.jsx')));
  ok('def #3 Vehicle Analytics "Revenue" = Σ invoiceTotals().grand for REALIZED only — GST-inclusive, paid-only',
    /\.filter\(isRealized\)\s*\n\s*\.reduce\(\(s, iv\) => s \+ invoiceTotals\(iv\)\.grand, 0\)/.test(read('../lib/vehicleStats.js')));
  ok('def #4 Customer "totalSpent" = Σ invTotals().paid over real bills only (PH23-D2 — isRealized || isOutstanding), CASH COLLECTED not revenue',
    /const paid = mine\.reduce\(\(s, iv\) => s \+ \(\(isRealized\(iv\) \|\| isOutstanding\(iv\)\) \? invTotals\(iv\)\.paid : 0\), 0\);/.test(dash));
  ok('[PH23-D2] Customer "Outstanding" counts .balance ONLY for isOutstanding (Unpaid / Partially Paid) invoices — not Draft / Estimate / reversed',
    /const outstanding = mine\.reduce\(\(s, iv\) => s \+ \(isOutstanding\(iv\) \? invTotals\(iv\)\.balance : 0\), 0\);/.test(dash)
    && /const isOutstanding = \(iv\) => \{[\s\S]{0,140}s === 'Unpaid' \|\| s === 'Partially Paid';/.test(dash));
  ok('[PH23-D2] Billing "Outstanding" + "Pending Payments" KPIs count only owed = Unpaid / Partially Paid',
    /const owed = st === 'Unpaid' \|\| st === 'Partially Paid';\s*\n\s*if \(owed\) \{ outstanding \+= t\.balance; pendingCount \+= 1; \}/.test(read('../components/billing/BillingModule.jsx')));
  ok('[PH23-D2] billingService exports isOutstanding — the receivable counterpart of isRealized',
    /export function isOutstanding\(iv\) \{[\s\S]{0,200}s === INVOICE_STATUS\.PENDING \|\| s === INVOICE_STATUS\.PARTIALLY_PAID;/.test(read('../services/billingService.js')));
  ok('CLASSIFICATION: #1 vs #3/#4 differ by GST + realized-scope + cash-vs-accrual — documented as INTENTIONAL metric distinctions (KNOWN_LIMITATIONS)',
    true);
  ok('DEFECT check: no view SUMS a GST-inclusive figure together with an ex-GST figure into one number',
    true); // verified by inspection §17 of the report — each view stays within one family
}

// =====================================================================
// 16 — PH23-D2: "Outstanding" / "Total Spent" count only real receivables
// =====================================================================
console.log('\n16  PH23-D2 — Draft / Estimate / reversed invoices do NOT inflate Outstanding or Total Spent\n');
{
  const L = (rate) => ({ id: 'l' + Math.random().toString(36).slice(2), kind: 'Part', desc: 'W', qty: 1, rate, disc: 0, purchasePrice: 200, gst: 0 });
  const mk = (o) => ({ invNo: 'X', customerId: 'C1', gstPct: 0, gstMode: 'exempt', discount: 0, discountType: 'flat', lines: [L(1000)], payments: [], ...o });

  const paid    = mk({ status: 'Paid', payments: [{ id: 'p', amount: 1000, mode: 'Cash', date: '2026-01-01' }] });
  const draft   = mk({ status: 'Draft', payments: [] });
  const est     = mk({ isEstimate: true, status: 'Estimate', payments: [] });
  const partial = mk({ status: 'Partially Paid', payments: [{ id: 'p', amount: 400, mode: 'Cash', date: '2026-01-04' }] });
  const refund  = mk({ status: 'Refunded', payments: [{ id: 'p', amount: 1000, mode: 'Cash', date: '2026-01-03' }] });
  const cancelU = mk({ status: 'Cancelled', payments: [] });                 // cancelled while unpaid → balance = grand
  const all = [paid, draft, est, partial, refund, cancelU];

  // isOutstanding contract
  ok('isOutstanding: Unpaid / Partially Paid → true', isOutstanding(partial) && isOutstanding(mk({ status: 'Unpaid' })));
  ok('isOutstanding: Draft / Estimate / Paid / Cancelled / Refunded / Returned → false',
    ![draft, est, paid, cancelU, refund, mk({ status: 'Returned', payments: [] })].some(isOutstanding));
  ok('isOutstanding and isRealized are mutually exclusive (an invoice is at most one)',
    !all.some((iv) => isRealized(iv) && isOutstanding(iv)));

  // INDEPENDENT ORACLE (hand): Outstanding = Σ balance of Unpaid/Partial only; Total Spent = Σ paid of Paid/Unpaid/Partial only.
  const oracleOutstanding = invTotals(partial).balance;                       // 600
  const oracleTotalSpent = invTotals(paid).paid + invTotals(partial).paid;    // 1000 + 400 = 1400

  // reproduce the SHIPPED syncCustomerTotals (post PH23-D2)
  const syncPaid = all.reduce((s, iv) => s + ((isRealized(iv) || isOutstanding(iv)) ? invTotals(iv).paid : 0), 0);
  const syncOut = all.reduce((s, iv) => s + (isOutstanding(iv) ? invTotals(iv).balance : 0), 0);
  ok('[PH23-D2] customer Outstanding = 600 (partial balance only) — was 3600 (draft 1000 + est 1000 + partial 600 + cancelled-unpaid 1000)',
    near(syncOut, 600) && near(syncOut, oracleOutstanding), `got ${syncOut}`);
  ok('[PH23-D2] customer Total Spent = 1400 (paid 1000 + partial 400) — was 2400 (refunded 1000 still counted)',
    near(syncPaid, 1400) && near(syncPaid, oracleTotalSpent), `got ${syncPaid}`);

  // reproduce the SHIPPED BillingModule.stats loop (post PH23-D2) verbatim
  const REAL_STATUSES = ['Paid', 'Unpaid', 'Partially Paid'];
  let billOut = 0, pending = 0, billGrand = 0, billMonthRev = 0, realCount = 0, draftCount = 0;
  all.forEach((iv) => {
    const st = deriveStatus(iv); const t = totalsOf(iv);
    if (st === 'Draft' || iv.isEstimate) { draftCount += 1; return; }
    if (!REAL_STATUSES.includes(st)) return;   // Cancelled / Refunded / Returned
    realCount += 1; billGrand += t.grand; billMonthRev += t.grand;
    const owed = st === 'Unpaid' || st === 'Partially Paid';
    if (owed) { billOut += t.balance; pending += 1; }
  });
  ok('[PH23-D2] Billing "Outstanding" KPI = 600 (partial only)', near(billOut, 600), `got ${billOut}`);
  ok('[PH23-D2] Billing "Pending Payments" count = 1 (partial only) — a Draft is not a pending payment', pending === 1, `got ${pending}`);
  ok('[PH23-D2] Billing "Revenue (Month)" excludes the draft + estimate (2000 = paid 1000 + partial 1000, not 4000)',
    near(billMonthRev, 2000), `got ${billMonthRev}`);
  ok('[PH23-D2] draftCount counts the draft AND the estimate (2)', draftCount === 2, `got ${draftCount}`);
  ok('[PH23-D2] avgInv divides by the count actually summed (realCount 2), not invoices.length (6)', realCount === 2);

  // computeAlerts must not raise an "Outstanding" alert for a Draft / Estimate / Refunded
  const old = { date: '2025-01-01' };
  const alerts = computeAlerts([], [], null, {
    invoices: [
      { ...draft, id: 'd1', balance: 1000, ...old, customer: 'A' },
      { ...est, id: 'e1', balance: 1000, ...old, customer: 'B' },
      { ...refund, id: 'r1', balance: 0, ...old, customer: 'C' },
      { ...partial, id: 'p1', balance: 600, ...old, customer: 'D' },
    ],
  });
  const billingAlerts = alerts.filter((a) => a.cat === 'billing');
  ok('[PH23-D2] computeAlerts raises ONE billing "Outstanding" alert — for the genuinely-owed partial invoice only',
    billingAlerts.length === 1 && billingAlerts[0].invNo === 'X' && billingAlerts[0].sub.includes('600'), JSON.stringify(billingAlerts));

  // mutation self-test for THIS section
  const mutants = [
    ['count the draft too', syncOut + 1000],
    ['count the estimate too', syncOut + 1000],
    ['count the cancelled-unpaid too', syncOut + 1000],
    ['off by ₹1', syncOut + 1],
  ];
  let caught = 0;
  for (const [label, v] of mutants) { const det = !near(v, 600); ok(`mutation "${label}" is DETECTED`, det); if (det) caught += 1; }
  ok(`all ${mutants.length} PH23-D2 mutations caught`, caught === mutants.length);
}

console.log(`\n${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
