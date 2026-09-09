/**
 * tests/billing-canonical-convergence.test.cjs
 *
 * REFACTOR PHASE 5 — the billing-specification convergence gate.
 *
 * Stage 1 established that the app has THREE copies of the invoice money maths —
 * BillingModule.totalsOf (the UI + PDF + persisted-field path), InventoryDashboard
 * .invTotals (the transaction engine's realization gate + Reports), and
 * services/billingService.invoiceTotals (behind lib/vehicleStats + capacityService) —
 * and that they were NOT identical: `invoiceTotals` still computed a GROSS parts/labour
 * split, rounded to whole rupees, had no `legacyPaid` fallback, and `invoiceStatus`
 * was missing the PH11-02 overpayment guard.
 *
 * This file is the literal 14-fixture convergence proof from the approved spec. It
 * asserts, against an INDEPENDENT hand-written oracle (never calls a production
 * money function), that every implementation agrees on every field of the canonical
 * contract.
 *
 * BEFORE Step A/B (fixing billingService) some assertions here are EXPECTED to fail —
 * exactly and only the invoiceTotals / invoiceStatus rows flagged `[pre-fix: KNOWN
 * DIVERGENCE]`. AFTER Step A/B every assertion must pass.
 */
require('./setup.cjs');
let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};

const { totalsOf, deriveStatus } = require('../components/billing/BillingModule.jsx');
const { invoiceTotals, invoiceStatus, isRealized, isOutstanding } = require('../services/billingService');
const { invTotals, invStatus } = require('../components/InventoryDashboard.js');

const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) < eps;

// ─────────────────────────────────────────────────────────────────────────────
// INDEPENDENT ORACLE — the approved canonical contract, hand-written from the
// Stage 1 spec §7. Calls NOTHING from production.
//   net       = max(0, qty·rate − (disc? qty·rate·disc/100 : 0))       per line
//   sub       = Σ net
//   invDisc   = discountType==='percent' ? sub·discount/100 : discount  (flat ₹)
//   afterDisc = max(0, sub − invDisc)
//   gst       = anyLineGst ? Σ(net·lineGst%)·(afterDisc/sub) : afterDisc·gstPct% ; 0 if exempt
//   grand     = round(afterDisc + gst)  → nearest RUPEE  (fallback: grandTotal if no lines)
//   roundOff  = grand − (afterDisc + gst)
//   paid      = Σ payment-row amounts ; else num(iv.paid) iff legacyPaid===true ; else 0
//   balance   = max(0, grand − paid)
//   cost      = Σ (purchasePrice · qty)
//   profit    = afterDisc − cost              (LIVE compute, not stored profitAmount)
//   partsRev  = Σ net for kind==='Part'   ┐  invariant partsRev + labourRev === sub
//   labourRev = Σ net for kind==='Labour' ┘  (line disc affects this; invoice disc does NOT)
//   cgst/sgst = p2 split of p2(gst); sgst clean half, cgst absorbs odd paisa (cgst+sgst===gst)
//   money fields returned at 2 dp (paise); grand to the rupee.
// ─────────────────────────────────────────────────────────────────────────────
const p2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const N = (v) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
const netOf = (l) => { const g = N(l.qty) * N(l.rate); const d = l.disc ? g * (N(l.disc) / 100) : 0; return Math.max(0, g - d); };
function oracle(iv) {
  const lines = Array.isArray(iv && iv.lines) ? iv.lines : [];
  let sub = 0, lineGst = 0, cost = 0;
  lines.forEach((l) => {
    const net = netOf(l);
    sub += net;
    const r = l.gst != null ? N(l.gst) : N(iv && iv.gstPct);
    lineGst += net * (r / 100);
    cost += N(l.purchasePrice) * N(l.qty);
  });
  const invDisc = (iv && iv.discountType) === 'percent' ? sub * (N(iv && iv.discount) / 100) : N(iv && iv.discount);
  const afterDisc = Math.max(0, sub - invDisc);
  const anyLineGst = lines.some((l) => l.gst != null);
  let gst = anyLineGst ? lineGst * (afterDisc / (sub || 1)) : afterDisc * (N(iv && iv.gstPct) / 100);
  if ((iv && iv.gstMode) === 'exempt') gst = 0;
  const isIgst = (iv && iv.gstMode) === 'igst';
  const grandRaw = afterDisc + gst;
  const grand = lines.length ? Math.round(grandRaw) : N(iv && iv.grandTotal);
  const roundOff = grand - grandRaw;
  const hasPayments = Array.isArray(iv && iv.payments) && iv.payments.length > 0;
  const legacyPaid = !hasPayments && (iv && iv.legacyPaid) === true ? N(iv && iv.paid) : 0;
  const paid = hasPayments ? iv.payments.reduce((s, p) => s + N(p.amount), 0) : legacyPaid;
  const balance = Math.max(0, grand - paid);
  const profit = afterDisc - cost;
  const partsRev = lines.filter((l) => l.kind === 'Part').reduce((s, l) => s + netOf(l), 0);
  const labourRev = lines.filter((l) => l.kind === 'Labour').reduce((s, l) => s + netOf(l), 0);
  const gstR = p2(gst);
  const halfS = p2(gstR / 2);
  const halfC = p2(gstR - halfS);
  return {
    sub: p2(sub), afterDisc: p2(afterDisc), gst: gstR,
    cgst: isIgst ? 0 : halfC, sgst: isIgst ? 0 : halfS, igst: isIgst ? gstR : 0, isIgst,
    grand, roundOff: p2(roundOff), paid: p2(paid), balance: p2(balance),
    profit: p2(profit), cost: p2(cost), partsRev: p2(partsRev), labourRev: p2(labourRev),
  };
}
function oracleStatus(iv) {
  if (!iv) return 'Unpaid';
  if (['Cancelled', 'Refunded', 'Returned'].includes(iv.status)) return iv.status;
  if (iv.isEstimate) return 'Estimate';
  const t = oracle(iv);
  if (t.grand > 0 && t.paid > t.grand + 0.5) return 'Partially Paid';
  if (t.balance <= 0 && t.grand > 0) return 'Paid';
  if (t.paid > 0) return 'Partially Paid';
  return iv.status === 'Draft' ? 'Draft' : 'Unpaid';
}

// ─── fixture builders ───────────────────────────────────────────────────────
const L = (o) => ({ id: `l_${Math.random().toString(36).slice(2, 8)}`, kind: 'Part', desc: 'Item', qty: 1, rate: 0, disc: 0, gst: 18, partId: null, purchasePrice: 0, ...o });
const I = (o) => ({ invNo: 'INV-CV', gstPct: 18, gstMode: 'auto', discount: 0, discountType: 'flat', payments: [], lines: [], ...o });

// ─── the 14-fixture matrix (Stage 1 §4) ─────────────────────────────────────
const FIXTURES = [
  { n: 'F1  normal (1 Part ×2 @500, gst18, pp300)',
    iv: I({ lines: [L({ kind: 'Part', qty: 2, rate: 500, gst: 18, purchasePrice: 300, partId: 'p1' })] }),
    expect: { sub: 1000, afterDisc: 1000, gst: 180, grand: 1180, paid: 0, balance: 1180, profit: 400, cost: 600, partsRev: 1000, labourRev: 0, status: 'Unpaid' } },

  { n: 'F2  percentage invoice discount 10%',
    iv: I({ discount: 10, discountType: 'percent', lines: [L({ kind: 'Part', qty: 2, rate: 500, gst: 18, purchasePrice: 300, partId: 'p1' })] }),
    expect: { sub: 1000, afterDisc: 900, gst: 162, grand: 1062, paid: 0, balance: 1062, profit: 300, cost: 600, partsRev: 1000, labourRev: 0, status: 'Unpaid' } },

  { n: 'F3  fixed invoice discount ₹100',
    iv: I({ discount: 100, discountType: 'flat', lines: [L({ kind: 'Part', qty: 2, rate: 500, gst: 18, purchasePrice: 300, partId: 'p1' })] }),
    expect: { sub: 1000, afterDisc: 900, gst: 162, grand: 1062, paid: 0, balance: 1062, profit: 300, cost: 600, partsRev: 1000, labourRev: 0, status: 'Unpaid' } },

  { n: 'F4  line-level discount 10%',
    iv: I({ lines: [L({ kind: 'Part', qty: 1, rate: 1000, disc: 10, gst: 18, purchasePrice: 400, partId: 'p1' })] }),
    expect: { sub: 900, afterDisc: 900, gst: 162, grand: 1062, paid: 0, balance: 1062, profit: 500, cost: 400, partsRev: 900, labourRev: 0, status: 'Unpaid' } },

  { n: 'F5  mixed parts + labour',
    iv: I({ lines: [
      L({ kind: 'Part', qty: 1, rate: 1000, gst: 18, purchasePrice: 600, partId: 'p1' }),
      L({ kind: 'Labour', qty: 1, rate: 500, gst: 0 }),
    ] }),
    expect: { sub: 1500, afterDisc: 1500, gst: 180, grand: 1680, paid: 0, balance: 1680, profit: 900, cost: 600, partsRev: 1000, labourRev: 500, status: 'Unpaid' } },

  { n: 'F6  zero GST',
    iv: I({ lines: [L({ kind: 'Part', qty: 2, rate: 250, gst: 0, purchasePrice: 100, partId: 'p1' })] }),
    expect: { sub: 500, afterDisc: 500, gst: 0, grand: 500, paid: 0, balance: 500, profit: 300, cost: 200, partsRev: 500, labourRev: 0, status: 'Unpaid' } },

  { n: 'F7  rounded GST (rate 333.33, gst18)',
    iv: I({ lines: [L({ kind: 'Part', qty: 1, rate: 333.33, gst: 18, purchasePrice: 0, partId: 'p1' })] }),
    expect: { sub: 333.33, afterDisc: 333.33, gst: 60, grand: 393, paid: 0, balance: 393, profit: 333.33, cost: 0, partsRev: 333.33, labourRev: 0, status: 'Unpaid' } },

  { n: 'F8  legacy invoice with paid field  [pre-fix: KNOWN DIVERGENCE — invoiceTotals/invoiceStatus]',
    iv: I({ legacyPaid: true, paid: 1000, payments: [], lines: [L({ kind: 'Part', qty: 1, rate: 1000, gst: 0, partId: 'p1' })] }),
    expect: { sub: 1000, afterDisc: 1000, gst: 0, grand: 1000, paid: 1000, balance: 0, profit: 1000, cost: 0, partsRev: 1000, labourRev: 0, status: 'Paid' } },

  { n: 'F9  invoice with payments array (partial)',
    iv: I({ payments: [{ id: 'p', amount: 400 }], lines: [L({ kind: 'Part', qty: 1, rate: 1000, gst: 0, partId: 'p1' })] }),
    expect: { sub: 1000, afterDisc: 1000, gst: 0, grand: 1000, paid: 400, balance: 600, profit: 1000, cost: 0, partsRev: 1000, labourRev: 0, status: 'Partially Paid' } },

  { n: 'F10  fully paid',
    iv: I({ payments: [{ id: 'p', amount: 1000 }], lines: [L({ kind: 'Part', qty: 1, rate: 1000, gst: 0, partId: 'p1' })] }),
    expect: { sub: 1000, afterDisc: 1000, gst: 0, grand: 1000, paid: 1000, balance: 0, profit: 1000, cost: 0, partsRev: 1000, labourRev: 0, status: 'Paid' } },

  { n: 'F11  partially paid (two payments short of grand)',
    iv: I({ payments: [{ id: 'a', amount: 300 }, { id: 'b', amount: 250 }], lines: [L({ kind: 'Part', qty: 1, rate: 1000, gst: 0, partId: 'p1' })] }),
    expect: { sub: 1000, afterDisc: 1000, gst: 0, grand: 1000, paid: 550, balance: 450, profit: 1000, cost: 0, partsRev: 1000, labourRev: 0, status: 'Partially Paid' } },

  { n: 'F12  overpaid  [pre-fix: KNOWN DIVERGENCE — invoiceStatus]',
    iv: I({ payments: [{ id: 'p', amount: 2000 }], lines: [L({ kind: 'Part', qty: 1, rate: 1000, gst: 0, partId: 'p1' })] }),
    expect: { sub: 1000, afterDisc: 1000, gst: 0, grand: 1000, paid: 2000, balance: 0, profit: 1000, cost: 0, partsRev: 1000, labourRev: 0, status: 'Partially Paid' } },

  { n: 'F13  cancelled (verbatim override)',
    iv: I({ status: 'Cancelled', payments: [{ id: 'p', amount: 1000 }], lines: [L({ kind: 'Part', qty: 1, rate: 1000, gst: 0, partId: 'p1' })] }),
    expect: { grand: 1000, paid: 1000, balance: 0, status: 'Cancelled' } },

  { n: 'F14a  estimate',
    iv: I({ isEstimate: true, lines: [L({ kind: 'Part', qty: 1, rate: 1000, gst: 18, partId: 'p1' })] }),
    expect: { grand: 1180, paid: 0, balance: 1180, status: 'Estimate' } },

  { n: 'F14b  draft, no payment',
    iv: I({ status: 'Draft', lines: [L({ kind: 'Part', qty: 1, rate: 1000, gst: 18, partId: 'p1' })] }),
    expect: { grand: 1180, paid: 0, balance: 1180, status: 'Draft' } },

  { n: 'F14c  draft, fully paid (payment wins over stale status)',
    iv: I({ status: 'Draft', payments: [{ id: 'p', amount: 1180 }], lines: [L({ kind: 'Part', qty: 1, rate: 1000, gst: 18, partId: 'p1' })] }),
    expect: { grand: 1180, paid: 1180, balance: 0, status: 'Paid' } },
];

// A no-lines legacy invoice (T8) — the grand total falls back to the stored field.
const F_NOLINES = { n: 'F-nolines  legacy import (lines:[], grandTotal:5000)  [pre-fix: KNOWN DIVERGENCE — totalsOf has no fallback]',
  iv: I({ lines: [], grandTotal: 5000, payments: [{ id: 'p', amount: 5000 }] }),
  expect: { grand: 5000, paid: 5000, balance: 0, status: 'Paid' } };

// ─── T-oracle-soundness ─────────────────────────────────────────────────────
console.log('\nbilling-canonical-convergence — the 14-fixture matrix vs the independent oracle\n');
console.log('0  oracle soundness — the hand oracle reproduces the hand-verified expected figures\n');
[...FIXTURES, F_NOLINES].forEach(({ n, iv, expect }) => {
  const o = oracle(iv);
  const fields = Object.keys(expect).filter((k) => k !== 'status');
  const okAll = fields.every((k) => near(o[k], expect[k]));
  ok(`${n} — oracle matches the hand figures (${fields.join('/')})`, okAll,
    `oracle=${JSON.stringify(pick(o, fields))}  expected=${JSON.stringify(expect)}`);
  if (expect.status) ok(`${n} — oracleStatus === '${expect.status}'`, oracleStatus(iv) === expect.status, `got '${oracleStatus(iv)}'`);
});
function pick(obj, keys) { const r = {}; keys.forEach((k) => { r[k] = obj[k]; }); return r; }

// ─── T6 — the three totals implementations converge on the canonical contract ─
console.log('\n1  T6 — totalsOf / invoiceTotals / invTotals all match the oracle (canonical shared fields)\n');
const CANON_FIELDS_FULL = ['sub', 'afterDisc', 'gst', 'cgst', 'sgst', 'igst', 'grand', 'roundOff', 'paid', 'balance', 'profit', 'cost', 'partsRev', 'labourRev'];
const CANON_FIELDS_MIN = ['grand', 'paid', 'balance'];

function checkTotals(label, fn, fields, iv, o) {
  const t = fn(iv);
  const bad = fields.filter((k) => !near(t[k], o[k]));
  ok(`${label} matches oracle (${fields.join('/')})`, bad.length === 0,
    `mismatched: ${bad.map((k) => `${k}: got ${t[k]} want ${o[k]}`).join(' ; ')}`);
}

[...FIXTURES, F_NOLINES].forEach(({ n, iv }) => {
  const o = oracle(iv);
  // totalsOf and invTotals are expected to be canonical already; invoiceTotals is the one
  // Step A brings in line. F13/F14* have no meaningful money-field expectations beyond grand.
  const full = !/F13|F14a/.test(n);
  checkTotals(`${n}  · totalsOf`, totalsOf, full ? CANON_FIELDS_FULL.filter((f) => hasField(totalsOf(iv), f)) : CANON_FIELDS_MIN, iv, o);
  checkTotals(`${n}  · invoiceTotals`, invoiceTotals, full ? CANON_FIELDS_FULL.filter((f) => hasField(invoiceTotals(iv), f)) : CANON_FIELDS_MIN, iv, o);
  // invTotals: Stage 1 confirmed grand/paid/balance already converge; `.profit` (reads the
  // stored profitAmount pre-Step-D) is covered independently by T11.
  checkTotals(`${n}  · invTotals`, invTotals, CANON_FIELDS_MIN, iv, o);
});
function hasField(obj, f) { return obj && obj[f] !== undefined; }

// ─── status convergence across all five status derivations ───────────────────
console.log('\n2  T2/T3/T7 — status: deriveStatus / invStatus / invoiceStatus all match the oracle\n');
[...FIXTURES, F_NOLINES].forEach(({ n, iv, expect }) => {
  if (!expect.status) return;
  ok(`${n}  · deriveStatus === '${expect.status}'`, deriveStatus(iv) === expect.status, `got '${deriveStatus(iv)}'`);
  ok(`${n}  · invStatus === '${expect.status}'`, invStatus(iv) === expect.status, `got '${invStatus(iv)}'`);
  ok(`${n}  · invoiceStatus === '${expect.status}'`, invoiceStatus(iv) === expect.status, `got '${invoiceStatus(iv)}'`);
});

// ─── T2 — legacyPaid, spelled out across every path ──────────────────────────
console.log('\n3  T2 — legacyPaid fixture (legacyPaid:true, paid:1000, payments:[])\n');
{
  const iv = I({ legacyPaid: true, paid: 1000, payments: [], lines: [L({ kind: 'Part', qty: 1, rate: 1000, gst: 0, partId: 'p1' })] });
  const paths = { totalsOf: totalsOf(iv), invTotals: invTotals(iv), invoiceTotals: invoiceTotals(iv) };
  Object.entries(paths).forEach(([name, t]) => {
    ok(`T2 · ${name}.paid === 1000`, near(t.paid, 1000), `got ${t.paid}`);
    ok(`T2 · ${name}.balance === 0`, near(t.balance, 0), `got ${t.balance}`);
  });
  ok('T2 · deriveStatus === "Paid"', deriveStatus(iv) === 'Paid', `got '${deriveStatus(iv)}'`);
  ok('T2 · invStatus === "Paid"', invStatus(iv) === 'Paid', `got '${invStatus(iv)}'`);
  ok('T2 · invoiceStatus === "Paid"', invoiceStatus(iv) === 'Paid', `got '${invoiceStatus(iv)}'`);
}

// ─── T3 — overpayment ───────────────────────────────────────────────────────
console.log('\n4  T3 — overpayment: never a clean "Paid" on any status path (PH11-02)\n');
{
  const iv = I({ payments: [{ id: 'p', amount: 2000 }], lines: [L({ kind: 'Part', qty: 1, rate: 1000, gst: 0, partId: 'p1' })] });
  ok('T3 · invoiceStatus(overpaid) === "Partially Paid"', invoiceStatus(iv) === 'Partially Paid', `got '${invoiceStatus(iv)}'`);
  ok('T3 · deriveStatus(overpaid) === "Partially Paid"', deriveStatus(iv) === 'Partially Paid', `got '${deriveStatus(iv)}'`);
  ok('T3 · invStatus(overpaid) === "Partially Paid"', invStatus(iv) === 'Partially Paid', `got '${invStatus(iv)}'`);
  ok('T3 · balance still floors at 0 (books do not go negative)', invoiceTotals(iv).balance === 0);
  ok('T3 · paid > grand is still traceable from the payment record', invoiceTotals(iv).paid === 2000);
  // T10 — the two gates that consume billingService.invoiceStatus (capacityService
  // cleanup-eligibility + JobCardModule open-invoice detection) both key off
  // TERMINAL = [Paid, Cancelled, Refunded, Returned]. "Partially Paid" ∉ TERMINAL,
  // so an overpaid invoice is neither cleanup-eligible nor treated as a closed bill.
  const TERMINAL = ['Paid', 'Cancelled', 'Refunded', 'Returned'];
  ok('T10 · invoiceStatus(overpaid) ∉ TERMINAL — not cleanup-eligible, keeps its job card open', !TERMINAL.includes(invoiceStatus(iv)));
  ok('T10 · a genuinely settled (exactly paid) invoice IS terminal — the guard does not over-reach',
    TERMINAL.includes(invoiceStatus(I({ payments: [{ id: 'p', amount: 1000 }], lines: [L({ kind: 'Part', qty: 1, rate: 1000, gst: 0, partId: 'p1' })] }))));
}

// ─── T5 — GST report: odd-paise GST, exact CGST + SGST reconciliation ────────
console.log('\n5  T5 — GST report fixture: odd-paise GST, cgst + sgst === gst exactly\n');
{
  // qty 1 × 1007.77 @ 18% → raw GST 181.3986 → p2 → 181.40 → SGST 90.70, CGST 90.70
  // qty 1 × 555.55 @ 18%  → raw GST 99.999 → p2 → 100.00 → SGST 50.00, CGST 50.00
  // qty 1 × 33.33 @ 18%   → raw GST 5.9994 → p2 → 6.00 → SGST 3.00, CGST 3.00
  for (const rate of [1007.77, 555.55, 33.33, 12345.67]) {
    const iv = I({ gstNo: '36ABCDE1234F1Z5', lines: [L({ kind: 'Part', qty: 1, rate, gst: 18, partId: 'p1' })] });
    const o = oracle(iv);
    [['totalsOf', totalsOf(iv)], ['invoiceTotals', invoiceTotals(iv)]].forEach(([name, t]) => {
      ok(`T5 · ${name} @${rate}: cgst + sgst === gst exactly`, near(t.cgst + t.sgst, t.gst, 0.0001), `cgst ${t.cgst} + sgst ${t.sgst} != gst ${t.gst}`);
      ok(`T5 · ${name} @${rate}: gst matches oracle to the paisa`, near(t.gst, o.gst, 0.0001), `got ${t.gst} want ${o.gst}`);
      ok(`T5 · ${name} @${rate}: afterDisc (the taxable base) matches oracle`, near(t.afterDisc, o.afterDisc), `got ${t.afterDisc} want ${o.afterDisc}`);
    });
  }
  // IGST — interstate: cgst/sgst zero, igst carries the whole tax
  const ig = I({ gstMode: 'igst', lines: [L({ kind: 'Part', qty: 1, rate: 1000, gst: 18, partId: 'p1' })] });
  [['totalsOf', totalsOf(ig)], ['invoiceTotals', invoiceTotals(ig)]].forEach(([name, t]) => {
    ok(`T5 · ${name} IGST: cgst === 0 && sgst === 0 && igst === gst`, t.cgst === 0 && t.sgst === 0 && near(t.igst, t.gst), JSON.stringify({ cgst: t.cgst, sgst: t.sgst, igst: t.igst, gst: t.gst }));
    ok(`T5 · ${name} IGST: isIgst === true`, t.isIgst === true);
  });
}

// ─── T8 — no-lines legacy fixture ───────────────────────────────────────────
console.log('\n6  T8 — no-lines legacy invoice (lines:[], grandTotal:5000) → grand === 5000\n');
{
  const iv = I({ lines: [], grandTotal: 5000, payments: [{ id: 'p', amount: 5000 }] });
  ok('T8 · invoiceTotals(no-lines).grand === 5000', invoiceTotals(iv).grand === 5000, `got ${invoiceTotals(iv).grand}`);
  ok('T8 · invTotals(no-lines).grand === 5000', invTotals(iv).grand === 5000, `got ${invTotals(iv).grand}`);
  ok('T8 · totalsOf(no-lines).grand === 5000 (after Step D — the fallback is now shared)', totalsOf(iv).grand === 5000, `got ${totalsOf(iv).grand}`);
}

// ─── T11 — invTotals().profit is an INDEPENDENT figure, not a totalsOf passthrough ─
console.log('\n7  T11 — invTotals().profit computed independently (afterDisc − cost), verified vs a hand figure\n');
{
  // 1 Part ×1 @10000, purchasePrice 6000, flat invoice discount 1000, GST-exempt.
  // afterDisc = 9000 ; cost = 6000 ; profit = 3000   (hand-verified, no production fn)
  const paid = I({ gstMode: 'exempt', discount: 1000, discountType: 'flat',
    lines: [L({ kind: 'Part', qty: 1, rate: 10000, gst: 0, purchasePrice: 6000, partId: 'p1' })],
    payments: [{ id: 'p', amount: 9000 }] });
  ok('T11 · invTotals(paid).profit === 3000 (independent hand figure, NOT totalsOf().profit)', near(invTotals(paid).profit, 3000), `got ${invTotals(paid).profit}`);
  ok('T11 · invoiceTotals(paid).profit === 3000', near(invoiceTotals(paid).profit, 3000), `got ${invoiceTotals(paid).profit}`);
  ok('T11 · totalsOf(paid).profit === 3000', near(totalsOf(paid).profit, 3000), `got ${totalsOf(paid).profit}`);
}

// ─── T4 — mixed Part/Labour + line + invoice discount: partsRev + labourRev === sub ─
console.log('\n8  T4 — Part+Labour with line & invoice discount: partsRev + labourRev === sub, all impls agree\n');
{
  const iv = I({ discount: 15, discountType: 'percent', lines: [
    L({ kind: 'Part', qty: 2, rate: 500, disc: 10, gst: 18, purchasePrice: 200, partId: 'p1' }),   // net 900
    L({ kind: 'Labour', qty: 1, rate: 400, disc: 0, gst: 0 }),                                      // net 400
  ] });
  const o = oracle(iv); // sub = 1300
  [['totalsOf', totalsOf(iv)], ['invoiceTotals', invoiceTotals(iv)], ['invTotals', invTotals(iv)]].forEach(([name, t]) => {
    if (t.partsRev === undefined) { ok(`T4 · ${name} exposes partsRev/labourRev`, false, 'field missing'); return; }
    ok(`T4 · ${name}: partsRev + labourRev === sub (${o.sub})`, near(t.partsRev + t.labourRev, o.sub), `${t.partsRev} + ${t.labourRev} != ${o.sub}`);
    ok(`T4 · ${name}: partsRev === 900 (net of the 10% line discount, NOT the 15% invoice discount)`, near(t.partsRev, 900), `got ${t.partsRev}`);
    ok(`T4 · ${name}: labourRev === 400`, near(t.labourRev, 400), `got ${t.labourRev}`);
  });
}

// ─── T9-adjacent — isRealized / isOutstanding parity on the discounted+exempt case ─
console.log('\n9  isRealized / isOutstanding agree with the status oracle on the tricky fixtures\n');
{
  const discountedExemptPaid = I({ gstMode: 'exempt', discount: 12.5, discountType: 'percent',
    lines: [L({ kind: 'Part', qty: 3, rate: 800, gst: 0, purchasePrice: 500, partId: 'p1' })],
    payments: [{ id: 'p', amount: oracle(I({ gstMode: 'exempt', discount: 12.5, discountType: 'percent', lines: [L({ kind: 'Part', qty: 3, rate: 800, gst: 0, purchasePrice: 500, partId: 'p1' })] })).grand }] });
  ok('a discounted + GST-exempt fully-paid invoice isRealized', isRealized(discountedExemptPaid) === true);
  ok('…and is NOT outstanding', isOutstanding(discountedExemptPaid) === false);
  const overpaid = FIXTURES.find((f) => /F12/.test(f.n)).iv;
  ok('an overpaid invoice is NOT realized (Step B — status is now "Partially Paid", consistent with the engine)', isRealized(overpaid) === false);
  ok('an overpaid invoice IS outstanding (balance 0, so it adds nothing numerically)', isOutstanding(overpaid) === true);
}

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
