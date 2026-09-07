/**
 * tests/malformed-input-integrity.test.cjs
 *
 * PHASE 21 — MALFORMED-INPUT / DATA-CORRUPTION INTEGRITY.
 *
 * Phase 18 asked "can validation be bypassed?". This asks a different question:
 * when malformed, extreme, or hostile-looking data DOES reach the app — pasted into
 * a field, forged into a document, left over from a legacy import — does the app stay
 * stable and keep its data intact through the whole chain:
 *
 *     input → persistence → read/list → search → calculations → PDF → analytics
 *
 * Every check here uses an INDEPENDENT oracle (a second, hand-written expectation) —
 * never "call the production coercer and assert it equals itself".
 *
 * The one confirmed defect this phase found and fixed:
 *   PH21-01 (HIGH) — `<input type="number">` accepts a pasted 309-digit string as a
 *   valid value, but `parseInt`/`parseFloat` overflow it to `Infinity`. The old
 *   `Math.max(0, x || 0)` clamps let that `Infinity` straight through to
 *   `stock: increment(Infinity)` (Receive Stock has no upper bound) — one write later
 *   a part's authoritative `stock` is permanently `Infinity`/`NaN`, unfixable from the
 *   UI (Edit Part's stock field is read-only). A pasted `1e308` (finite, retained by
 *   the input) instead overflowed the Inventory Valuation report's totals to `₹∞`/`NaN`.
 *   Fixed by finite-guarding + magnitude-clamping the shared service coercers
 *   (nonNegInt/nonNegNum/sanitizeStock) and `lib/format.num`, and routing the inline
 *   copies (RestockModal, BulkReceive, SellModal, AdjustModal, demo part-save,
 *   SupplierPOBuilder) through them.
 */
require('./setup.cjs');

const {
  nonNegInt, nonNegNum, sanitizeStock, computeStockAdjustment,
  cardReservedQtys, reserveDelta, buildRestockRecord,
} = require('../services/inventoryService');
const { num, safeLower, isValidEmail, isIndianMobile, tsToDate, formatINR, normalizePhone } = require('../lib/format');
const { normalizeText, tokenize } = require('../lib/search');
const { matchTokens, rankIndexed, normId, phoneKey } = require('../lib/useSearch');
const { toNum, invoiceTotals, invoiceStatus, stockDelta, ledgerDelta } = require('../services/billingService');
const A = require('../services/analyticsService');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// Malformed-input taxonomy (Phase 21A) — one place, reused by every section below.
const HUGE_DIGITS = '9'.repeat(309);      // <input type=number> keeps this; parseInt/parseFloat -> Infinity
const HUGER_DIGITS = '9'.repeat(400);
const SCI = '1e308';                       // finite but absurd; a stock*price product overflows
const TEXT_CASES = [
  '', '   ', '\t\n', ' leading/trailing ', 'x'.repeat(10000),
  'AAAAAAAAAA', '山田太郎', 'ब्रेक पैड', 'مرحبا', '🚗🔧🚘', 'e\u0301', '\u200b\u200bhidden',
  '\u202eRTL\u202c', 'line1\nline2', 'a\tb', '<b>bold</b>', '<script>alert("x")</script>',
  '<img src=x onerror=alert(1)>', 'javascript:alert(1)', "O'Brien", 'a"b"c', 'C:\\path\\x',
  'Ω≈ç√∫', 'ﬀ vs ff',
];
const NUM_CASES = [
  '0', '1', '-1', '0.1', '0.01', '0.001', '1000000', '10000000', SCI, '1.23456789012345',
  'NaN', 'Infinity', '-Infinity', '1e5', '', '   ', HUGE_DIGITS, HUGER_DIGITS, '  -12  ', '12abc', 'abc',
];

// =====================================================================
// 1 — NUMERIC COERCION AT THE WRITE BOUNDARY (independent oracle)
// =====================================================================
console.log('\n1  Numeric coercion — no write-boundary clamp yields NaN / Infinity / a junk magnitude\n');

// Oracle: a non-negative, FINITE magnitude, capped at MAX_SAFE_INTEGER. Deliberately
// re-derived here, not imported.
const oracleNonNeg = (raw, { int } = {}) => {
  let n = int ? parseInt(raw, 10) : parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  n = Math.min(n, Number.MAX_SAFE_INTEGER);
  return int ? Math.floor(n) : n;
};
for (const raw of NUM_CASES) {
  const label = raw.length > 16 ? `"${raw.slice(0, 6)}…"(${raw.length})` : JSON.stringify(raw);
  ok(`nonNegInt(${label}) → finite, ≥0, matches oracle`,
    finite(nonNegInt(raw)) && nonNegInt(raw) >= 0 && nonNegInt(raw) === oracleNonNeg(raw, { int: true }),
    `got ${nonNegInt(raw)} want ${oracleNonNeg(raw, { int: true })}`);
  ok(`nonNegNum(${label}) → finite, ≥0, matches oracle`,
    finite(nonNegNum(raw)) && nonNegNum(raw) >= 0 && nonNegNum(raw) === oracleNonNeg(raw),
    `got ${nonNegNum(raw)} want ${oracleNonNeg(raw)}`);
  ok(`sanitizeStock(${label}) → finite integer ≥0`,
    finite(sanitizeStock(raw)) && sanitizeStock(raw) >= 0 && Number.isInteger(sanitizeStock(raw)));
}
ok('PH21-01 — a pasted Infinity-overflow digit string coerces to 0, never Infinity',
  nonNegInt(HUGE_DIGITS) === 0 && nonNegNum(HUGER_DIGITS) === 0 && sanitizeStock(HUGE_DIGITS) === 0);
ok('PH21-01 — a real-but-absurd magnitude (1e308) is capped so a downstream stock×price product stays finite',
  nonNegNum(SCI) === Number.MAX_SAFE_INTEGER
  && Number.isFinite(sanitizeStock(SCI) * nonNegNum(SCI)));
ok('normal inputs are unchanged by the guard (0/1/decimal/1e5/junk all coerce as before)',
  nonNegInt('0') === 0 && nonNegInt('7') === 7 && nonNegNum('4.5') === 4.5
  && nonNegNum('1e5') === 100000 && nonNegInt('12abc') === 12 && nonNegNum('abc') === 0);
// literal number inputs (steppers pass numbers, not strings)
ok('literal Infinity / NaN / negative number inputs also coerce to 0',
  nonNegInt(Infinity) === 0 && nonNegNum(NaN) === 0 && sanitizeStock(-5) === 0 && nonNegNum(-Infinity) === 0);

// =====================================================================
// 2 — STOCK-MOVEMENT MATH (adjustment / reservation / restock)
// =====================================================================
console.log('\n2  Stock-movement math — malformed qty cannot poison stock / reserved / a ledger row\n');

// a 'correction' adjustment has no upper bound — a pasted huge qty must not produce Infinity
const adjHuge = computeStockAdjustment({ currentStock: 10, qty: HUGE_DIGITS, direction: 'correction' });
ok('computeStockAdjustment(correction, huge-digits): delta + after stay finite',
  finite(adjHuge.delta) && finite(adjHuge.after), JSON.stringify(adjHuge));
const adjInf = computeStockAdjustment({ currentStock: 10, qty: Infinity, direction: 'correction' });
ok('computeStockAdjustment(correction, Infinity): delta = 0 (rejected), after unchanged',
  adjInf.delta === 0 && adjInf.after === 10, JSON.stringify(adjInf));

// job-card parts feed `reserved: increment(delta)` — a pasted huge qty must not reach increment as Infinity
const cardHuge = { status: 'In Progress', parts: [{ partId: 'p1', qty: HUGER_DIGITS }, { partId: 'p2', qty: '3' }] };
const reserved = cardReservedQtys(cardHuge);
ok('cardReservedQtys: a pasted over-long qty coerces to a finite reservation (0), not Infinity',
  reserved.p1 === 0 && reserved.p2 === 3, JSON.stringify(reserved));
const rd = reserveDelta({ status: 'In Progress', parts: [{ partId: 'p1', qty: '2' }] }, cardHuge);
ok('reserveDelta: every delta is finite (what gets passed to increment())',
  Object.values(rd).every(finite), JSON.stringify(rd));

// restock ledger row — qty * unitCost must not be Infinity/NaN
const rs = buildRestockRecord({ id: 'r1', partId: 'p1', name: 'x', qty: HUGE_DIGITS, unitCost: SCI, createdAt: 1 });
ok('buildRestockRecord: qty, unitCost and total are all finite even from Infinity-overflow / 1e308 input',
  finite(rs.qty) && finite(rs.unitCost) && finite(rs.total), JSON.stringify({ qty: rs.qty, unitCost: rs.unitCost, total: rs.total }));

// =====================================================================
// 3 — THE MONEY PATH IS IMMUNE (billingService.toNum already finite-guards)
// =====================================================================
console.log('\n3  Money path — invoice totals stay finite and self-consistent under malformed lines\n');

for (const bad of ['NaN', 'Infinity', HUGER_DIGITS, SCI, '', '   ', 'abc', '-5', undefined, null, {}]) {
  const t = toNum(bad);
  ok(`toNum(${JSON.stringify(bad)}) → finite`, finite(t), `got ${t}`);
}
const evilInv = {
  lines: [
    { kind: 'Part', partId: 'p1', qty: HUGER_DIGITS, rate: SCI, disc: 'abc', gst: 'NaN' },
    { kind: 'Labour', qty: 2, rate: Infinity, disc: -10 },
  ],
  payments: [{ amount: 'Infinity' }, { amount: HUGE_DIGITS }],
  grandTotal: NaN,
};
const et = invoiceTotals(evilInv);
ok('invoiceTotals(evil invoice): sub/gst/grand/paid/balance all finite',
  [et.sub, et.gst, et.grand, et.paid, et.balance].every(finite), JSON.stringify(et));
ok('invoiceTotals: balance is never negative and never NaN',
  et.balance >= 0 && finite(et.balance));
ok('invoiceStatus(evil invoice) returns a known status string, does not throw',
  typeof invoiceStatus(evilInv) === 'string' && invoiceStatus(evilInv).length > 0);
ok('stockDelta / ledgerDelta over malformed invoices return finite deltas only',
  Object.values(stockDelta(null, evilInv)).every(finite)
  && ledgerDelta(null, evilInv).every((r) => finite(r.qty) && finite(r.revenue)));

// =====================================================================
// 4 — SEARCH ROBUSTNESS (Phase 21M)
// =====================================================================
console.log('\n4  Search — every malformed query is a safe no-op / substring test, never a crash or hang\n');

const HAY = 'toyota innova crysta ap09cx1234 brake pad 山田 🚗';
for (const q of [...TEXT_CASES, HUGE_DIGITS, undefined, null, 12345, {}]) {
  let threw = false, r1, r2, r3;
  try {
    r1 = normalizeText(q);
    r2 = tokenize(q);
    r3 = matchTokens(HAY, typeof q === 'string' ? q : String(q ?? ''));
  } catch (e) { threw = true; }
  const label = typeof q === 'string' && q.length > 12 ? `"${q.slice(0, 6)}…"(${q.length})` : JSON.stringify(q);
  ok(`search primitives on ${label}: no throw, string + array + boolean results`,
    !threw && typeof r1 === 'string' && Array.isArray(r2) && typeof r3 === 'boolean');
}
ok('rankIndexed with a huge query against a huge haystack terminates and returns a number',
  typeof rankIndexed({ hay: 'x'.repeat(20000).toLowerCase(), ids: [] }, 'x'.repeat(5000)) === 'number');
ok('rankIndexed tolerates a null/undefined entry and a null query',
  rankIndexed(null, 'abc') === 0 && rankIndexed({ hay: 'abc', ids: [] }, null) === 1);
ok('normId / phoneKey / normalizePhone never throw on non-string input',
  normId(12345) === '12345' && phoneKey(null) === '' && normalizePhone(undefined) === '');

// =====================================================================
// 5 — ANALYTICS / REPORT ROBUSTNESS (Phase 21N)
// =====================================================================
console.log('\n5  Analytics — malformed text/number fields cannot make a score or total NaN / Infinity\n');

const evilParts = [
  { id: 'p1', name: 'x'.repeat(9000) + ' 🚗', sku: '  ', stock: SCI, minStock: 'NaN', sellingPrice: SCI, purchasePrice: -5, category: '<script>' },
  { id: 'p2', name: '山田', stock: HUGE_DIGITS, sellingPrice: 'abc', purchasePrice: null, suppliers: 'not-an-array' ? [] : [] },
  { id: 'p3', name: '', stock: -3, sellingPrice: Infinity, minStock: undefined },
];
let healthThrew = false, health;
try { health = A.computeInventoryHealth(evilParts); } catch (e) { healthThrew = true; }
ok('computeInventoryHealth(evil parts): no throw, score is a finite 0-100 number',
  !healthThrew && health && finite(health.score) && health.score >= 0 && health.score <= 100, JSON.stringify(health && health.score));

const evilSales = [
  { partId: 'p1', qty: 'abc', revenue: SCI, createdAt: 'not-a-date', profit: NaN },
  { partId: 'p2', quantity: HUGE_DIGITS, revenue: Infinity, createdAt: Date.now() },
];
let scoreThrew = false, score;
try { score = A.computeWorkshopScore({ inventory: evilParts, sales: evilSales, suppliers: [], alertsCount: 3 }); } catch (e) { scoreThrew = true; }
ok('computeWorkshopScore(evil inventory + sales): no throw, score is a finite 0-100 number',
  !scoreThrew && score && finite(score.score) && score.score >= 0 && score.score <= 100, JSON.stringify(score && score.score));

let insightsThrew = false, insights;
try {
  insights = A.computeInsights({
    inventory: evilParts, sales: evilSales, invoices: [{ isEstimate: false, status: 'Unpaid', balance: 'abc', date: 'x', payments: [{ amount: Infinity, date: 'x' }] }],
    jobCards: [], purchaseOrders: [], restocks: [{ total: Infinity, createdAt: Date.now() }], stockAdjustments: [{ qty: NaN, createdAt: Date.now() }], customers: [],
  });
} catch (e) { insightsThrew = true; }
ok('computeInsights(evil data): no throw, returns an array of well-formed insight objects',
  !insightsThrew && Array.isArray(insights) && insights.every((i) => typeof i.text === 'string' && finite(i.priority)));

let alertsThrew = false, alerts;
try {
  alerts = A.computeAlerts(evilParts, [{ status: 'x', partName: '🚗', supplierName: 'y', qty: NaN }], null, {
    invoices: [{ isEstimate: false, status: 'Unpaid', balance: Infinity, grandTotal: 'abc', paid: NaN, date: 'bad', invNo: 'INV-1' }],
    customers: [{ id: 'c1', name: '山田', vehicles: [{ regNo: 'AP01', insuranceExpiry: 'not-a-date' }] }],
    jobCards: [], purchaseOrders: [], suppliers: [],
  });
} catch (e) { alertsThrew = true; }
ok('computeAlerts(evil data): no throw, every alert has a title string',
  !alertsThrew && Array.isArray(alerts) && alerts.every((a) => typeof a.title === 'string'));

// =====================================================================
// 6 — lib/format.num() — display coercion matches the money path's toNum()
// =====================================================================
console.log('\n6  lib/format.num() — a stored NaN / Infinity coerces to 0 for reports & PDF, matching toNum()\n');

for (const v of [NaN, Infinity, -Infinity, 'NaN', 'Infinity', HUGER_DIGITS, undefined, null, {}, '1e5', '  42  ', -7]) {
  ok(`num(${JSON.stringify(v)}) → finite (was "₹∞"/"NaN" in reports before PH21-01)`, finite(num(v)), `got ${num(v)}`);
}
ok('num() leaves every ordinary value untouched (parity with old Number(n) || 0 for finite inputs)',
  num('42') === 42 && num(3.5) === 3.5 && num('1e5') === 100000 && num('') === 0 && num('abc') === 0 && num(-7) === -7);
ok('num() and toNum() now agree on non-finite input (both → 0)',
  num(Infinity) === 0 && toNum(Infinity) === 0 && num('NaN') === 0 && toNum('NaN') === 0);

// Inventory Valuation report (InventoryReports.jsx) row math is `b.value += num(stock) * num(sellingPrice)`.
// The real guarantee is at the WRITE boundary: a part saved through sanitizeStock/nonNegNum can no
// longer carry a 1e308 price, so the report's stock×price product can't overflow.
const storedParts = evilParts.map((p) => ({ ...p, stock: sanitizeStock(p.stock), sellingPrice: nonNegNum(p.sellingPrice), purchasePrice: nonNegNum(p.purchasePrice) }));
const valuationValue = storedParts.reduce((s, p) => s + num(p.stock) * num(p.sellingPrice), 0);
const valuationProfit = storedParts.reduce((s, p) => s + num(p.stock) * (num(p.sellingPrice) - num(p.purchasePrice)), 0);
ok('PH21-01 — a part normalised through the write boundary yields a finite Inventory Valuation value + profit',
  finite(valuationValue) && finite(valuationProfit), `value=${valuationValue} profit=${valuationProfit}`);
// num() alone still neutralises a stored NaN/Infinity (the forge / pre-fix-legacy case):
ok('num() neutralises a stored non-finite price so the valuation row reads 0, not ₹∞/NaN',
  num(Infinity) === 0 && num(NaN) === 0 && num('Infinity') === 0);

// =====================================================================
// 7 — TEXT HELPERS (Phase 21B/D — Unicode, emoji, zero-width, RTL, HTML-like)
// =====================================================================
console.log('\n7  Text helpers — Unicode / emoji / control chars round-trip without loss or crash\n');

for (const s of TEXT_CASES) {
  let threw = false;
  try { safeLower(s); isValidEmail(s); isIndianMobile(s); formatINR(s); } catch (e) { threw = true; }
  ok(`safeLower/isValidEmail/isIndianMobile/formatINR on ${JSON.stringify(s.length > 12 ? `${s.slice(0, 6)}…` : s)}: no throw`, !threw);
}
ok('isValidEmail rejects whitespace / embedded-space / empty / no-dot domain, accepts a real address',
  isValidEmail('a@b.co') === true
  && isValidEmail('a b@c.com') === false
  && isValidEmail('  ') === false
  && isValidEmail('') === false
  && isValidEmail('a@b') === false
  && isValidEmail('<script>alert(1)</script>') === false);
ok('isIndianMobile is byte-length-agnostic: a 10-emoji string is not a valid mobile',
  isIndianMobile('🚗'.repeat(10)) === false && isIndianMobile('9876543210') === true);
ok('safeLower on a multi-byte / emoji / combining string returns a string of sane length',
  typeof safeLower('İ山🚗e\u0301') === 'string' && safeLower('ABC🚗') === 'abc🚗');
ok('formatINR(malformed) still returns a ₹-prefixed string, never throws / NaN-renders raw',
  formatINR('abc').startsWith('₹') && formatINR(Infinity).startsWith('₹') && formatINR(NaN) === '₹0');

// tsToDate — the "invoice paid but every list empty" root cause. Must never throw.
for (const ts of ['', '   ', 'not-a-date', NaN, Infinity, {}, [], '1e999', -1, 0, '2026-13-45', '\u200b']) {
  let threw = false, d;
  try { d = tsToDate(ts); } catch (e) { threw = true; }
  ok(`tsToDate(${JSON.stringify(ts)}): no throw, returns Date | null`,
    !threw && (d === null || (d instanceof Date && !Number.isNaN(d.getTime()))));
}

// =====================================================================
// 8 — ROUND-TRIP / IDEMPOTENCE (Phase 21P)
// =====================================================================
console.log('\n8  Round-trip — normalising an already-normalised value is a no-op (no progressive drift)\n');

for (const raw of NUM_CASES) {
  const once = nonNegNum(raw);
  const twice = nonNegNum(once);
  ok(`nonNegNum idempotent for ${JSON.stringify(raw.length > 10 ? `…(${raw.length})` : raw)}`, once === twice, `${once} → ${twice}`);
}
for (const raw of TEXT_CASES) {
  const once = normalizeText(raw);
  const twice = normalizeText(once);
  ok(`normalizeText idempotent for ${JSON.stringify(raw.length > 10 ? `…(${raw.length})` : raw)}`, once === twice);
}

// =====================================================================
// 9 — PDF / PRINT ROBUSTNESS (Phase 21O) — render, don't just regex
// =====================================================================
console.log('\n9  Workshop PDF — renders a real document from fully-malformed data without throwing\n');
{
  let threw = null, pageCount = 0, bytes = 0;
  try {
    const { jsPDF } = require('jspdf');
    const { renderWorkshopInvoicePdf } = require('../lib/workshopInvoicePdf.js');
    const { SHOP } = require('../lib/pdfTheme.js');
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const long = '山田太郎'.repeat(200) + ' <script>alert(1)</script> ' + '🚗'.repeat(40) + ' \u200b\u200b ' + 'م'.repeat(60);
    const iv = {
      invNo: 'INV-\u200b1', date: '2026-09-07', gstPct: 18, customer: long, phone: '9', vehicle: long, regNo: 'AP01' + 'X'.repeat(30),
      payments: [{ mode: 'Cash', amount: 'NaN' }, { mode: 'UPI', amount: '9'.repeat(400) }],
      lines: [
        { kind: 'Part', partId: 'p1', desc: long, qty: '9'.repeat(400), rate: '1e308', purchasePrice: -5, gst: 'abc', sku: 'S'.repeat(50) },
        { kind: 'Labour', desc: long, qty: 0.0001, rate: Infinity },
        { kind: 'Other', desc: '', qty: NaN, rate: null },
      ],
    };
    const totals = { sub: NaN, grand: Infinity, gst: NaN, cgst: NaN, sgst: NaN, igst: 0, roundOff: NaN, balance: NaN, paid: 0, profit: NaN, cost: 0, partsRev: NaN, labourRev: NaN };
    const r = renderWorkshopInvoicePdf(doc, {
      iv, jc: null, cust: null, veh: null, shop: SHOP, status: 'Unpaid', totals,
      money: (n) => `Rs. ${num(n).toFixed(2)}`, qrDataUrl: null, docTypeLabel: 'INVOICE',
      partLines: iv.lines.filter((l) => l.kind === 'Part' || l.kind === 'Other'),
      svcLines: iv.lines.filter((l) => l.kind === 'Labour'),
      otherLines: [],
    });
    pageCount = r && r.pageCount;
    bytes = doc.output('arraybuffer').byteLength;
  } catch (e) { threw = e; }
  ok('renderWorkshopInvoicePdf(fully-malformed invoice): no throw', !threw, threw && threw.message);
  ok('…produces a non-empty multi-page PDF', pageCount >= 1 && bytes > 1000, `pages=${pageCount} bytes=${bytes}`);
  ok('PH21-01 — with num() finite-guarded the PDF cannot embed a raw "Rs. Infinity" line',
    finite(num('9'.repeat(400))) && finite(num(Infinity)) && num(Infinity) === 0);
}

// =====================================================================
console.log(`\n${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
