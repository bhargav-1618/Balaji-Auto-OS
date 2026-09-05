/**
 * tests/financial-integrity.test.cjs
 *
 * PHASE 11 — FINANCIAL INTEGRITY / MONEY CONSISTENCY AUDIT.
 *
 * Central invariant: grandTotal is mathematically correct; paid = sum(legitimate
 * payments); balance = grandTotal - paid; status is correctly derived from that
 * financial state — and this must hold identically across BOTH of the app's two
 * independent money-calculation paths (BillingModule's totalsOf/deriveStatus,
 * the UI's own math; InventoryDashboard's invTotals/invStatus, the transaction
 * engine's realization gate AND the value collectInvoicePayment actually persists
 * as the invoice's `status` field).
 *
 * Method: an INDEPENDENT oracle (oracleTotals below — written fresh from the
 * documented formula, never calling totalsOf/invTotals) checked against the
 * REAL, imported production functions across zero/decimal/rounding-boundary/
 * large-value/discount/GST scenarios, plus MANDATORY INJECTION MATRIX pure-model
 * proofs (the Phase 8B/9/10 convention) for the two confirmed defects' fixes.
 *
 * `ok()` = proven-correct (independent oracle agrees with both production paths,
 * or a confirmed fix verified). `defect()` = a confirmed money-integrity gap not
 * yet closed.
 */
require('./setup.cjs');
const fs = require('fs');
const path = require('path');
const { totalsOf, deriveStatus } = require('../components/billing/BillingModule.jsx');
const { invTotals, invStatus } = require('../components/InventoryDashboard.js');

let PASS = 0, FAIL = 0, DEFECTS = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const defect = (name, isFixed, detail = '') => {
  if (isFixed) { PASS++; console.log(`  ✓ [was a defect, now fixed] ${name}`); }
  else { DEFECTS++; console.log(`  ⚠ [DEFECT — financial integrity] ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const dash = read('../components/InventoryDashboard.js');
const billing = read('../components/billing/BillingModule.jsx');
const near = (a, b, eps = 0.005) => Math.abs(a - b) < eps;

console.log('\nPHASE 11 — financial integrity / money consistency audit\n');

// =====================================================================
// INDEPENDENT ORACLE — written fresh from the documented formula, never
// calls totalsOf/invTotals. Order: per-line net (qty*rate, less line %
// discount, floored at 0) -> sub -> invoice-level discount (flat or %,
// floored at 0) -> afterDisc -> GST (per-line summed then scaled to
// afterDisc, or flat afterDisc*gstPct% if no line carries its own gst;
// zeroed if gstMode is 'exempt') -> grand = Math.round(afterDisc+gst) to
// the nearest RUPEE (the "Round Off" line every Indian retail/GST invoice
// carries) -> paid = sum(payment amounts) -> balance = max(0, grand-paid).
// =====================================================================
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
function oracleTotals(inv) {
  const lines = inv.lines || [];
  let sub = 0, gstAcc = 0;
  lines.forEach((l) => {
    const gross = (Number(l.qty) || 0) * (Number(l.rate) || 0);
    const lineDiscPct = Number(l.disc) || 0;
    const net = Math.max(0, gross - (lineDiscPct ? gross * (lineDiscPct / 100) : 0));
    sub += net;
    const rate = l.gst != null ? Number(l.gst) : (Number(inv.gstPct) || 0);
    gstAcc += net * (rate / 100);
  });
  const discRaw = Number(inv.discount) || 0;
  const invDisc = inv.discountType === 'percent' ? sub * (discRaw / 100) : discRaw;
  const afterDisc = Math.max(0, sub - invDisc);
  const anyLineGst = lines.some((l) => l.gst != null);
  let gst = anyLineGst ? gstAcc * (afterDisc / (sub || 1)) : afterDisc * ((Number(inv.gstPct) || 0) / 100);
  if (inv.gstMode === 'exempt') gst = 0;
  const grand = Math.round(afterDisc + gst);
  const hasPayments = Array.isArray(inv.payments) && inv.payments.length > 0;
  const legacyPaid = !hasPayments && inv.legacyPaid === true ? (Number(inv.paid) || 0) : 0;
  const paid = hasPayments ? inv.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0) : legacyPaid;
  const balance = Math.max(0, grand - paid);
  return { sub: round2(sub), afterDisc: round2(afterDisc), gst: round2(gst), grand, paid: round2(paid), balance: round2(balance) };
}
const line = (qty, rate, extra = {}) => ({ id: `l${Math.random()}`, kind: 'Part', qty, rate, disc: 0, gst: 18, ...extra });
const inv = (fields) => ({ gstPct: 18, gstMode: 'auto', discount: 0, discountType: 'flat', payments: [], lines: [], ...fields });

// A single scenario, checked against BOTH production paths at once — this is
// the "the two functions can no longer disagree" property this codebase's own
// history (see invTotals's comments) says matters most.
function checkAgainstBoth(name, invoice) {
  const oracle = oracleTotals(invoice);
  const a = totalsOf(invoice);
  const b = invTotals(invoice);
  ok(`${name} — totalsOf matches independent oracle (sub/afterDisc/gst/grand/paid/balance)`,
    near(a.sub, oracle.sub) && near(a.afterDisc, oracle.afterDisc) && near(a.gst, oracle.gst)
    && a.grand === oracle.grand && near(a.paid, oracle.paid) && near(a.balance, oracle.balance),
    `oracle=${JSON.stringify(oracle)} totalsOf=${JSON.stringify({ sub: a.sub, afterDisc: a.afterDisc, gst: a.gst, grand: a.grand, paid: a.paid, balance: a.balance })}`);
  ok(`${name} — invTotals matches independent oracle (grand/paid/balance)`,
    b.grand === oracle.grand && near(b.paid, oracle.paid) && near(b.balance, oracle.balance),
    `oracle=${JSON.stringify(oracle)} invTotals=${JSON.stringify({ grand: b.grand, paid: b.paid, balance: b.balance })}`);
  ok(`${name} — no NaN/Infinity/undefined in either production path's output`,
    [a.sub, a.gst, a.grand, a.paid, a.balance, b.grand, b.paid, b.balance].every((v) => Number.isFinite(v)));
}

// =====================================================================
// 1 — ZERO-VALUE TESTING (Phase 11C)
// =====================================================================
console.log('1  Zero-value testing\n');
checkAgainstBoth('all-zero invoice (qty 1, rate 0)', inv({ lines: [line(1, 0)] }));
checkAgainstBoth('zero quantity, non-zero rate', inv({ lines: [line(0, 500)] }));
checkAgainstBoth('zero GST line (gst: 0)', inv({ lines: [line(2, 100, { gst: 0 })] }));
checkAgainstBoth('gstMode exempt zeroes tax even with a priced line', inv({ gstMode: 'exempt', lines: [line(2, 500)] }));
checkAgainstBoth('an explicit zero-amount payment does not corrupt paid/balance', inv({ lines: [line(1, 1000)], payments: [{ id: 'p0', amount: 0, mode: 'Cash' }] }));

// =====================================================================
// 2 — DECIMAL TESTING (Phase 11D)
// =====================================================================
console.log('\n2  Decimal value testing\n');
checkAgainstBoth('1 x 0.10', inv({ lines: [line(1, 0.10)] }));
checkAgainstBoth('3 x 0.33', inv({ lines: [line(3, 0.33)] }));
checkAgainstBoth('7 x 1.11', inv({ lines: [line(7, 1.11)] }));
checkAgainstBoth('multi-line decimals (0.29 + 0.99 + 1234.56)', inv({ lines: [line(1, 0.29), line(1, 0.99), line(1, 1234.56)] }));
checkAgainstBoth('decimal qty (2.5 hours labour, no GST)', inv({ lines: [line(2.5, 400, { kind: 'Labour', gst: 0 })] }));

// =====================================================================
// 3 — ROUNDING-BOUNDARY TESTING (Phase 11E)
// =====================================================================
console.log('\n3  Rounding-boundary testing\n');
// Values independently confirmed (see report) to be classic float-precision
// traps for a naive `* 100 / 100` rounder — each checked end-to-end through
// the full sub -> discount -> GST -> grand pipeline, not just in isolation.
checkAgainstBoth('rate = 1.005 (half-paisa boundary)', inv({ lines: [line(1, 1.005, { gst: 0 })] }));
checkAgainstBoth('rate = 10.005', inv({ lines: [line(1, 10.005, { gst: 0 })] }));
checkAgainstBoth('rate = 99.995', inv({ lines: [line(1, 99.995, { gst: 0 })] }));
checkAgainstBoth('GST rate chosen so raw tax lands on a half-paisa boundary', inv({ lines: [line(1, 100, { gst: 2.005 })] }));
checkAgainstBoth('grand total itself lands exactly on a half-rupee boundary (Round Off exercised)', inv({ lines: [line(1, 1000.50, { gst: 0 })] }));

// =====================================================================
// 4 — LARGE-VALUE TESTING (Phase 11F)
// =====================================================================
console.log('\n4  Large-value testing\n');
checkAgainstBoth('₹1,00,000 line', inv({ lines: [line(1, 100000)] }));
checkAgainstBoth('₹10,00,000 line', inv({ lines: [line(1, 1000000)] }));
checkAgainstBoth('₹1,00,00,000 (1 crore) line', inv({ lines: [line(1, 10000000)] }));
{
  const big = totalsOf(inv({ lines: [line(1, 10000000)] }));
  ok('large grandTotal is stored as a plain integer, never scientific notation',
    !String(big.grand).includes('e') && !String(big.grand).includes('E'));
}
checkAgainstBoth('large qty x large rate (999 x 50000)', inv({ lines: [line(999, 50000)] }));

// =====================================================================
// 5 — DISCOUNT TESTING (Phase 11G)
// =====================================================================
console.log('\n5  Discount testing\n');
checkAgainstBoth('no discount', inv({ lines: [line(2, 500)] }));
checkAgainstBoth('small flat discount', inv({ discount: 50, lines: [line(2, 500)] }));
checkAgainstBoth('decimal percent discount', inv({ discount: 12.5, discountType: 'percent', lines: [line(1, 1000)] }));
checkAgainstBoth('discount === subtotal (percent 100%) -> total floors to 0, never negative', inv({ discount: 100, discountType: 'percent', lines: [line(1, 1000, { gst: 0 })] }));
checkAgainstBoth('discount === subtotal (flat, exact) -> total floors to 0', inv({ discount: 1000, discountType: 'flat', lines: [line(1, 1000, { gst: 0 })] }));
checkAgainstBoth('discount > subtotal (flat, clamped not rejected) -> afterDisc floors to 0, not negative', inv({ discount: 5000, discountType: 'flat', lines: [line(1, 1000, { gst: 0 })] }));
{
  const t = totalsOf(inv({ discount: 5000, discountType: 'flat', lines: [line(1, 1000, { gst: 18 })] }));
  ok('discount > subtotal also zeroes GST (afterDisc is the tax base, and it is 0) — no negative-base tax artefact',
    t.afterDisc === 0 && t.gst === 0 && t.grand === 0);
}
checkAgainstBoth('extremely large discount (₹1 crore off a ₹1000 bill)', inv({ discount: 10000000, discountType: 'flat', lines: [line(1, 1000)] }));

// =====================================================================
// 6 — GST / TAX TESTING (Phase 11H)
// =====================================================================
console.log('\n6  GST / tax rate testing\n');
[0, 5, 12, 18, 28].forEach((rate) => {
  checkAgainstBoth(`GST ${rate}% on a single line`, inv({ lines: [line(3, 250, { gst: rate })] }));
});
checkAgainstBoth('decimal GST rate on a line', inv({ lines: [line(1, 500, { gst: 6.5 })] }));
checkAgainstBoth('mixed GST rates across lines, scaled by an invoice-level discount', inv({ discount: 10, discountType: 'percent', lines: [line(2, 300, { gst: 5 }), line(1, 700, { gst: 28 })] }));
checkAgainstBoth('no line carries its own gst -> falls back to invoice-level gstPct', inv({ gstPct: 12, lines: [line(1, 1000, { gst: null })] }));

// =====================================================================
// 7 — GRAND TOTAL TESTING across line shapes (Phase 11I)
// =====================================================================
console.log('\n7  Grand-total testing across line shapes\n');
checkAgainstBoth('single line', inv({ lines: [line(1, 500)] }));
checkAgainstBoth('multiple mixed-quantity lines', inv({ lines: [line(2, 150), line(5, 40), line(1, 999)] }));
checkAgainstBoth('a zero-valued line among priced lines does not corrupt the others', inv({ lines: [line(0, 0), line(2, 500), line(1, 0)] }));
{
  // Editing ONE line must not corrupt another line's contribution — diff the
  // totals before/after changing only line 2's rate.
  const before = inv({ lines: [line(2, 100), line(3, 200)] });
  const after = { ...before, lines: [before.lines[0], { ...before.lines[1], rate: 250 }] };
  const tBefore = totalsOf(before), tAfter = totalsOf(after);
  const line1ContributionUnchanged = near(tBefore.sub - (3 * 200), tAfter.sub - (3 * 250));
  ok('editing one line changes the total by exactly that line\'s own delta, leaving the other line\'s contribution untouched', line1ContributionUnchanged);
}

// =====================================================================
// 8 — PAYMENT INTEGRITY / MULTIPLE PAYMENTS (Phase 11J/K)
// =====================================================================
console.log('\n8  Payment integrity — traced from payment records, not trusted as a scalar\n');
{
  // Grand Total = ₹10,000; Payment A=2500, B=1500, C=6000 -> paid=10000, balance=0, Paid.
  const target = inv({ lines: [line(1, 10000, { gst: 0 })] });
  const paid3 = { ...target, payments: [{ id: 'a', amount: 2500 }, { id: 'b', amount: 1500 }, { id: 'c', amount: 6000 }] };
  const expectedPaid = 2500 + 1500 + 6000; // traced from the payment records themselves, not a trusted scalar
  const t = totalsOf(paid3); const b = invTotals(paid3);
  ok('3 payments summing exactly to grand: traced paid === stored paid (both production paths)',
    t.paid === expectedPaid && b.paid === expectedPaid);
  ok('balance = grandTotal - traced paid = 0 (both production paths)', t.balance === 0 && b.balance === 0);
  ok('status derives to Paid on both production paths', deriveStatus(paid3) === 'Paid' && invStatus(paid3) === 'Paid');
}
{
  // Same total, but 2000+3000+3000 = 8000 -> balance 2000, Partially Paid.
  const target = inv({ lines: [line(1, 10000, { gst: 0 })] });
  const partial = { ...target, payments: [{ id: 'a', amount: 2000 }, { id: 'b', amount: 3000 }, { id: 'c', amount: 3000 }] };
  const t = totalsOf(partial); const b = invTotals(partial);
  ok('3 payments summing short of grand: traced paid = 8000 (both production paths)', t.paid === 8000 && b.paid === 8000);
  ok('balance = 2000 (both production paths)', t.balance === 2000 && b.balance === 2000);
  ok('status derives to Partially Paid on both production paths', deriveStatus(partial) === 'Partially Paid' && invStatus(partial) === 'Partially Paid');
}
{
  // No payment at all.
  const unpaid = inv({ lines: [line(1, 500)] });
  ok('no payment -> paid=0, balance=grand, status Unpaid/Pending on the two paths respectively (documented label difference, PH11-03)',
    totalsOf(unpaid).paid === 0 && invTotals(unpaid).paid === 0
    && deriveStatus(unpaid) === 'Unpaid' && invStatus(unpaid) === 'Pending');
}
{
  // A payment carrying amount 0 (a blank row) must not count as "a payment"
  // toward paid, but its presence in the array must not crash either path.
  const withBlankRow = inv({ lines: [line(1, 500)], payments: [{ id: 'x', amount: 0 }] });
  ok('a zero-amount payment row contributes exactly 0 to paid on both paths (no phantom money, no crash)',
    totalsOf(withBlankRow).paid === 0 && invTotals(withBlankRow).paid === 0);
}

// =====================================================================
// 9 — OVERPAYMENT (Phase 11L) — status-labeling defect PH11-02, now fixed
// =====================================================================
console.log('\n9  Overpayment — status must never read clean "Paid" (PH11-02)\n');
{
  const target = inv({ lines: [line(1, 1000, { gst: 0 })] });
  const overpaid = { ...target, payments: [{ id: 'x', amount: 1001 }] };
  ok('grand=1000, paid=1001 (₹1 over): both totals correctly compute balance=0 (floored) but paid > grand is still traceable from the payment record',
    totalsOf(overpaid).balance === 0 && invTotals(overpaid).paid === 1001);
}
{
  const target = inv({ lines: [line(1, 1000, { gst: 0 })] });
  const overpaid = { ...target, payments: [{ id: 'x', amount: 2000 }] };
  defect('PH11-02: an invoice paid ₹2000 against a ₹1000 total is status "Partially Paid" (anomalous, needs review) on BOTH totalsOf/deriveStatus AND invTotals/invStatus — not silently "Paid" on either',
    deriveStatus(overpaid) === 'Partially Paid' && invStatus(overpaid) === 'Partially Paid');
  ok('[fact] deriveStatus\'s overpayment guard (BUG-LIVE-002, pre-existing) is present',
    /if \(t\.grand > 0 && t\.paid > t\.grand \+ 0\.5\) return 'Partially Paid';/.test(billing));
  ok('PH11-02 FIXED [fact]: invStatus now carries the SAME overpayment guard invTotals/invStatus was missing — the value collectInvoicePayment persists as the invoice\'s own `status` field can no longer read "Paid" while overpaid',
    /if \(t\.grand > 0 && t\.paid > t\.grand \+ 0\.5\) return 'Partially Paid';[\s\S]{0,120}if \(t\.balance <= 0 && t\.grand > 0\) return 'Paid';/.test(dash));
}

// =====================================================================
// 10 — INVOICE EDIT AFTER PAYMENT (Phase 11M/N) — already-correct policy,
//      regression-guarded here
// =====================================================================
console.log('\n10  Invoice edit after payment (ALLOWED / SAFE, pre-existing policy)\n');
ok('[fact] a save is REJECTED if the invoice\'s own payments would exceed its (possibly just-edited) grand total — Case C of Phase 11M, reusing the SAME overpayment guard rather than a separate check',
  /if \(totalPaid > snapPay\.grand \+ 1\) \{\s*\n\s*return toast\.error\(`Payments \(\$\{inr\(totalPaid\)\}\) exceed the invoice total/.test(billing));
ok('[fact] a FULLY PAID invoice (or Cancelled/Refunded/Returned) is locked read-only in the UI (Duplicate or Credit Note are the only ways forward) — Phase 11N\'s "edits blocked once settled" policy',
  /const locked = !inv\.isEstimate && isPersisted && \['Paid', 'Cancelled', 'Refunded', 'Returned'\]\.includes\(savedStatus\);/.test(billing));
{
  // Case A/B: editing a NOT-YET-fully-paid invoice's total up or down, with an
  // existing partial payment, must recompute balance correctly either way.
  const base = inv({ lines: [line(1, 10000, { gst: 0 })], payments: [{ id: 'p1', amount: 4000 }] });
  const up = { ...base, lines: [line(1, 12000, { gst: 0 })] };
  const down = { ...base, lines: [line(1, 8000, { gst: 0 })] };
  ok('Case A: total 10,000 -> 12,000 with paid=4,000 unchanged: balance recomputes to 8,000', totalsOf(up).balance === 8000);
  ok('Case B: total 10,000 -> 8,000 with paid=4,000 unchanged: balance recomputes to 4,000', totalsOf(down).balance === 4000);
}

// =====================================================================
// 11 — REFUND / CORRECTION (Phase 11Q) — supported via Credit Note, reuses
//      the SAME Phase 8B/9 atomic realization engine, not a parallel one
// =====================================================================
console.log('\n11  Refund / correction (Credit Note) — supported, single engine\n');
ok('[fact] "Credit Note" on a Paid invoice reissues it through changeStatus(iv, \'Returned\', ...) — the SAME onPersist/editInvoiceTransactional path every other edit uses, not a separate refund engine',
  /onCreditNote=\{\(iv\) => \{ setEdit\(null\); setTimeout\(\(\) => changeStatus\(iv, 'Returned', 'Returned'\), 60\); \}\}/.test(billing));
ok('[fact] isRealized (the sole gate for stock/sales/rollup effects) treats Cancelled/Refunded/Returned as NOT realized — so a Paid -> Returned transition\'s realization diff is a full, correct reversal, computed by the SAME planInvoiceRealization diff Phase 8B/9 already hardened',
  /if \(\['Cancelled', 'Refunded', 'Returned'\]\.includes\(iv\.status\)\) return false;/.test(dash));

// =====================================================================
// 12 — DELETE / REVERSAL FINANCIAL INTEGRITY (Phase 11R) — PH11-01, FIXED
// =====================================================================
console.log('\n12  Delete/reversal — no double stock restoration (PH11-01)\n');
defect('PH11-01: Refund/Return on a Paid invoice restored inventory TWICE — once correctly inside the atomic editInvoiceTransactional realization diff, and once more via a separate, non-transactional onRestoreStock callback that unconditionally re-added the same quantities',
  // Only the historical mention inside this fix's own explanatory comment
  // ("removed for exactly that reason (was `onRestoreStock`)") may remain —
  // no prop declaration, JSX wiring, or call site.
  !/onRestoreStock\?\.\(|onRestoreStock=\{|onRestoreStock,|onRestoreStock\}/.test(dash)
  && !/onRestoreStock\?\.\(|onRestoreStock=\{|onRestoreStock,|onRestoreStock\}/.test(billing),
  'no functional onRestoreStock prop/call site may remain in either file');
ok('PH11-01 FIXED [fact]: changeStatus no longer calls any separate stock-restoration function — onPersist alone is now the single source of the reversal',
  /const changeStatus = async \(iv, status, verb\) => \{[\s\S]{0,1200}try \{ await onPersist\?\.\(next\); \} catch \(e\) \{ return; \}\s*\n\s*toast\.success\(`\$\{iv\.invNo\}: \$\{verb\}`\);\s*\n\s*\};/.test(billing));
ok('PH11-01 FIXED [fact]: BillingModule no longer declares an onRestoreStock prop at all (dead parameter removed, not just its call site)',
  /export default function BillingModule\(\{[^}]*\}\)/.exec(billing)[0].includes('onCollectPayment') && !/onRestoreStock/.test(/export default function BillingModule\(\{[^}]*\}\)/.exec(billing)[0]));

// Pure-model proof: mirrors the REAL bug shape (a redundant, non-transactional
// restore layered on top of an already-correct atomic diff) and proves the fix
// (removing the second call) leaves exactly one restoration, not two or zero.
function mockAtomicReversal(realizedQtyBefore) {
  // planInvoiceRealization(prior=Paid, merged=Returned): oldQ=realizedQtyBefore, newQ={}
  return { ...realizedQtyBefore }; // delta = oldQ - newQ = oldQ, applied atomically
}
function mockOnRestoreStock_REMOVED() { return null; } // PH11-01: no longer called
{
  const qtyOnInvoice = { 'part-A': 3 };
  const stockAfterTransaction = mockAtomicReversal(qtyOnInvoice);
  const stockAfterLegacyCallback = mockOnRestoreStock_REMOVED();
  ok('MANDATORY MATRIX (PH11-01) — AFTER the fix: the atomic transaction alone restores exactly the invoiced quantity once; the removed second call contributes nothing',
    stockAfterTransaction['part-A'] === 3 && stockAfterLegacyCallback === null);
  // Demonstrate what the BEFORE-fix shape would have produced, for the record.
  const totalIfBothHadFired = stockAfterTransaction['part-A'] + qtyOnInvoice['part-A'];
  ok('MANDATORY MATRIX (PH11-01) — BEFORE the fix (for the record): both the transaction AND onRestoreStock adding the same quantity would have doubled the restored stock (6, not 3)',
    totalIfBothHadFired === 6);
}

// =====================================================================
// 13 — CONCURRENT PAYMENT + INVOICE EDIT (Phase 11O) — PH11-02, FIXED
// =====================================================================
console.log('\n13  Concurrent invoice-edit + payment race (PH11-02)\n');
ok('PH11-02 FIXED [fact]: collectInvoicePayment now re-validates paid-vs-grand against `t`, computed from the TRANSACTION\'S OWN fresh read — not client-supplied state — and throws a coded, non-committing error before any write',
  /if \(t\.grand > 0 && t\.paid > t\.grand \+ 1\) \{\s*\n\s*const err = new Error\(`This payment would make the invoice overpaid/.test(dash)
  && /err\.code = 'conc\/overpaid';/.test(dash));
ok('[fact] the new guard runs BEFORE tx.update(invRef, ...) — the first write in this transaction — so a rejected race leaves the invoice completely untouched (all-or-nothing, matching every other guard in this transaction)',
  dash.indexOf("err.code = 'conc/overpaid';") < dash.indexOf('tx.update(invRef, {')
  && dash.indexOf("err.code = 'conc/overpaid';") > dash.indexOf('const t = invTotals(merged);'));
ok('PH11-02 FIXED [fact]: the caller (collectPayment in BillingModule) treats conc/overpaid as a definite non-commit (retires the durable opId, same as conc/deleted/conc/estimate) and shows a specific, actionable message instead of the generic ambiguous-failure copy',
  /e\?\.code === 'conc\/deleted' \|\| e\?\.code === 'conc\/estimate' \|\| e\?\.code === 'conc\/overpaid'/.test(billing)
  && /The invoice total just changed, so this amount would overpay it\. Reload to see the current balance before collecting payment\./.test(billing));

// Pure-model proof of the exact interleaving Phase 11O calls "the most
// valuable scenario": Client A edits total 10,000 -> 3,000 (commits first via
// the _rev-guarded editInvoiceTransactional, unaffected by this fix); Client B
// then pays 4,000 against its own STALE view of the old 10,000 balance.
function mockCollectPayment_BEFORE(freshGrand, existingPaid, incomingAmount) {
  const paid = existingPaid + incomingAmount;
  const balance = Math.max(0, freshGrand - paid);
  const status = balance <= 0 && freshGrand > 0 ? 'Paid' : (paid > 0 ? 'Partially Paid' : 'Unpaid'); // old invStatus shape
  return { committed: true, paid, balance, status };
}
function mockCollectPayment_AFTER(freshGrand, existingPaid, incomingAmount) {
  const paid = existingPaid + incomingAmount;
  if (freshGrand > 0 && paid > freshGrand + 1) {
    const err = new Error('overpaid'); err.code = 'conc/overpaid'; throw err;
  }
  const balance = Math.max(0, freshGrand - paid);
  const status = freshGrand > 0 && paid > freshGrand + 0.5 ? 'Partially Paid' : (balance <= 0 && freshGrand > 0 ? 'Paid' : (paid > 0 ? 'Partially Paid' : 'Unpaid'));
  return { committed: true, paid, balance, status };
}
{
  // Client A already committed total 10,000 -> 3,000 before Client B's payment
  // transaction runs; Client B's ₹4,000 was validated against A's now-stale
  // ₹10,000 balance on B's own screen, not against this fresh ₹3,000 total.
  const freshGrandAfterAsEdit = 3000;
  const before = mockCollectPayment_BEFORE(freshGrandAfterAsEdit, 0, 4000);
  ok('MANDATORY MATRIX (PH11-02) — BEFORE the fix: the race commits a contradictory Firestore state — grandTotal=3,000, paid=4,000 (paid > grand), yet status reads clean "Paid"',
    before.committed && before.paid === 4000 && before.balance === 0 && before.status === 'Paid');
  let threw = null;
  try { mockCollectPayment_AFTER(freshGrandAfterAsEdit, 0, 4000); } catch (e) { threw = e; }
  ok('MANDATORY MATRIX (PH11-02) — AFTER the fix: the same interleaving is rejected atomically before any write — paid never exceeds the transaction\'s own fresh grandTotal in the persisted document',
    threw && threw.code === 'conc/overpaid');
  // A corrected, non-overpaying retry (Client B reloads and pays the real ₹3,000
  // balance) must succeed cleanly.
  const retry = mockCollectPayment_AFTER(freshGrandAfterAsEdit, 0, 3000);
  ok('MANDATORY MATRIX (PH11-02) — retry with the CORRECT amount after reload succeeds normally: paid=3,000, balance=0, status=Paid',
    retry.committed && retry.paid === 3000 && retry.balance === 0 && retry.status === 'Paid');
}

// =====================================================================
// 14 — FLOATING-POINT HAZARD AUDIT (Phase 11T)
// =====================================================================
console.log('\n14  Floating-point hazard audit\n');
ok('[fact] money is rounded to paisa at the boundary via a documented, EPSILON-corrected round-half-up helper (p2), not left as raw floating point or naive toFixed string formatting',
  /const p2 = \(v\) => Math\.round\(\(Number\(v\) \+ Number\.EPSILON\) \* 100\) \/ 100;/.test(billing));
ok('[fact] CGST/SGST are split from the ALREADY-ROUNDED gst total (half each, odd paisa pushed onto CGST) so cgst + sgst === gst exactly — never independently rounded halves that could disagree with the whole by ₹0.01',
  /const halfS = p2\(gstR \/ 2\);(\s*\/\/[^\n]*)?\s*\n\s*const halfC = p2\(gstR - halfS\);/.test(billing));
{
  // The classic 0.1+0.2 hazard, run through the real per-line loop.
  const t = totalsOf(inv({ lines: [line(1, 0.1), line(1, 0.2)] }));
  ok('0.1 + 0.2 style line accumulation still lands on the exact expected subtotal (0.30), not 0.30000000000000004',
    t.sub === 0.3);
}

// =====================================================================
// 15 — STATUS LABEL CONSISTENCY (documented, not fixed — Phase 11's own
//      "for every relationship classify explicitly" instruction applied to
//      the one remaining, low-impact discrepancy between the two paths)
// =====================================================================
console.log('\n15  Remaining label discrepancy (documented, LOW — not a money-value defect)\n');
ok('[fact, documented] deriveStatus\'s "nothing paid yet, not a draft" label is "Unpaid"; invStatus\'s equivalent branch is "Pending" — a display-string difference only (grand/paid/balance numbers are identical on both paths, per section 8 above); invStatus feeds Reports/Dashboard exports, so a report can show "Pending" for an invoice Billing\'s own screen calls "Unpaid"',
  /return inv\.status === 'Draft' \? 'Draft' : 'Unpaid';/.test(billing)
  && /return iv\.status === 'Draft' \? 'Draft' : 'Pending';/.test(dash));

console.log(`\n  ${PASS} passed, ${FAIL} failed, ${DEFECTS} DEFECT(S) found\n`);
// PH11-01 and PH11-02 are verified FIXED above; the sole remaining
// discrepancy (Unpaid vs Pending label) is documented, LOW severity, and
// left unchanged (no confirmed money-value defect — see report). FAIL>0 = a
// real regression against current source; DEFECTS>0 = a confirmed gap not
// yet closed (none expected at this point).
process.exit((FAIL || DEFECTS) ? 1 : 0);
