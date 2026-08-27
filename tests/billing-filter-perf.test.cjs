/**
 * tests/billing-filter-perf.test.cjs
 *
 * Billing filters/search: "All" resets, combinations compose, pagination clamps, and the
 * search pipeline precomputes per-data (not per-keystroke). Behavioural + source guards.
 */
require('./setup.cjs');
const B = require('../services/billingService.js');
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/billing/BillingModule.jsx'), 'utf8');

console.log('\nBilling — filter reset, sync, pagination clamp, search perf\n');

// ── the filter predicate mirrors the module ────────────────────────────────
const rows = [
  { iv: { invNo: 'INV-1', customer: 'Anil', payments: [{ mode: 'Cash' }] }, status: 'Paid', hay: 'inv-1 anil' },
  { iv: { invNo: 'INV-2', customer: 'Sita', payments: [] }, status: 'Draft', hay: 'inv-2 sita' },
  { iv: { invNo: 'INV-3', customer: 'Anita', payments: [{ mode: 'UPI' }] }, status: 'Paid', hay: 'inv-3 anita' },
];
const filter = (list, { statusF = 'All', payModeF = 'All', q = '' }) => list.filter(({ iv, status, hay }) => {
  if (statusF !== 'All' && status !== statusF) return false;
  if (payModeF !== 'All' && !(iv.payments || []).some((p) => p.mode === payModeF)) return false;
  return !q || hay.includes(q.toLowerCase());
});

ok('All/All/empty → every invoice', filter(rows, {}).length === 3);
ok('status Paid → 2', filter(rows, { statusF: 'Paid' }).length === 2);
ok('return to All Status → 3 restored', filter(rows, { statusF: 'All' }).length === 3);
ok('payment Cash → 1', filter(rows, { payModeF: 'Cash' }).length === 1);
ok('return to All Payments → 3 restored', filter(rows, { payModeF: 'All' }).length === 3);
ok('status+payment compose (Paid+UPI → 1)', filter(rows, { statusF: 'Paid', payModeF: 'UPI' }).length === 1);
ok('search+status compose (an + Paid → Anil, Anita)', filter(rows, { q: 'an', statusF: 'Paid' }).length === 2);
ok('clearing status within a search restores that search set', filter(rows, { q: 'an', statusF: 'All' }).length === 2);
ok('all cleared → everything', filter(rows, {}).length === 3);

// ── source guards ──────────────────────────────────────────────────────────
ok('filter options carry explicit values (All resets, not filters-for-label)',
  // Capacity-archive review: 'Archived' was appended after 'Returned' so an archived
  // invoice (see services/capacityService.js's archiveRecords) stays reachable from
  // this same dropdown instead of just disappearing from the list.
  /'Returned', 'Archived'\]\.map\(\(s\) => <option key=\{s\} value=\{s\}/.test(src) && /PAYMENT_MODES\]\.map\(\(s\) => <option key=\{s\} value=\{s\}/.test(src));
ok('filtered derives from the precomputed master invoiceRows',
  /const filtered = useMemo\(\(\) => \{[\s\S]{0,200}invoiceRows\.filter/.test(src));
ok('pagination clamps synchronously (safePage)', /const safePage = Math\.min\(page, pageCount\)/.test(src));
ok('paged slices with safePage', /filtered\.slice\(\(safePage - 1\) \* PER/.test(src));

// ── search perf: precompute once per data change, deferred input ────────────
ok('search haystack + sort + status precomputed per-data (invoiceRows memo)',
  /const invoiceRows = useMemo\(\(\) => \[\.\.\.invoices\][\s\S]{0,260}\.map\(\(iv\) => \(\{[\s\S]{0,160}hay:/.test(src));
ok('invoiceRows memo depends on invoices only (not the query)',
  /\}\)\), \[invoices\]\);/.test(src));
ok('search uses a deferred value (non-blocking input)', /useDeferredSearch\(q\)/.test(src));
ok('filtered depends on the deferred query, not raw q',
  /\}, \[invoiceRows, dq, statusF, payModeF, dateF\]\);/.test(src));

// ── pagination clamp behaviour ─────────────────────────────────────────────
const filtered = new Array(4).fill({}); // 4 rows after a filter
const PER = 25, stalePage = 3;
const pageCount = Math.max(1, Math.ceil(filtered.length / PER));
const safePage = Math.min(stalePage, pageCount);
ok('stale page=3 clamps so 4 rows still show (no empty flash)',
  filtered.slice((safePage - 1) * PER, safePage * PER).length === 4);

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
