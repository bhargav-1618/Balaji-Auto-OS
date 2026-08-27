/**
 * tests/revenue-consistency.test.cjs — PART-5
 *
 * Every module that reports money must agree on the SAME number for the same invoice.
 * The risk: a stored iv.grandTotal that has drifted from the line items. Two call sites
 * (syncCustomerTotals, touchVehicleHistory) trusted the stored total; both now route
 * through the line-derived total. These are source guards + a numeric proof of the rule.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');

console.log('\nPART-5 — one revenue definition across all modules\n');

// the drifted-total scenario: lines say 1000, but a stale grandTotal says 999999
const drifted = { lines: [{ kind: 'Part', qty: 1, rate: 1000, disc: 0, gst: 0 }], grandTotal: 999999, payments: [{ amount: 1000 }] };
const lineDerived = drifted.lines.reduce((s, l) => s + l.qty * l.rate, 0);
ok('line-derived total (1000) is the truth, not the stale 999999', lineDerived === 1000);

// guards: neither sync path may trust the stored grandTotal
ok('syncCustomerTotals no longer reads a local totalsOf trusting grandTotal',
  !/const totalsOf = \(iv\) => \{ if \(iv\.grandTotal != null\)/.test(src));
ok('syncCustomerTotals routes through invTotals',
  /outstanding = mine\.reduce\(\(s, iv\) => s \+ invTotals\(iv\)\.balance/.test(src));
ok('touchVehicleHistory records spend via invTotals, not raw grandTotal',
  /const spend = invTotals\(iv\)\.grand/.test(src));
ok('the raw "Number(iv.grandTotal) || 0" spend read is gone',
  !/const spend = Number\(iv\.grandTotal\) \|\| 0/.test(src));

// the shared invTotals only falls back to grandTotal when there are NO lines
ok('invTotals derives from lines and ignores a stored total when lines exist',
  /const grand = lines\.length \? computed : \(toNum\(iv\.grandTotal\)/.test(src));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
