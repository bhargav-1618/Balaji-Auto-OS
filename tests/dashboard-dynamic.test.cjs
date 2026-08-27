/**
 * tests/dashboard-dynamic.test.cjs
 *
 * Dashboard Insights + Workshop Progress must reflect LIVE operational state (job cards,
 * billing, inventory), not static onboarding milestones. Executes the real service.
 */
require('./setup.cjs');
const A = require('../services/analyticsService.js');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
console.log('\nDashboard — live Insights & Workshop Progress\n');

const inventory = [
  { id: 'p1', name: 'Clutch', stock: 0, minStock: 5, sku: 'C1' },      // out of stock
  { id: 'p2', name: 'Fluid', stock: 10, minStock: 5, sku: 'F1' },      // healthy
];
const jobCards = [
  { id: 'j1', status: 'Received', isDraft: false },
  { id: 'j2', status: 'Ready', isDraft: false },                        // awaiting delivery
  { id: 'j3', status: 'Delivered', isDraft: false, savedAt: Date.now() }, // completed today
  { id: 'j4', status: 'Received', isDraft: true },                     // draft — excluded
];
const invoices = [
  { invNo: 'INV-1', status: 'Paid', isEstimate: false },
  { invNo: 'INV-2', status: 'Unpaid', isEstimate: false },             // outstanding
  { invNo: 'INV-3', status: 'Partially Paid', isEstimate: false },     // outstanding
];

// ── Workshop Progress is live ──────────────────────────────────────────────
const wp = A.computeWorkshopProgress({ inventory, invoices, jobCards, sales: [] });
ok('progress returns live metric rows', Array.isArray(wp) && wp.length >= 5);
ok('no onboarding milestone labels remain (First Supplier/100 Parts/etc.)',
  !wp.some((w) => /First |100 |Inventory Complete/.test(w.label)));
const byLabel = (s) => wp.find((w) => w.label.toLowerCase().includes(s));
ok('Active job cards counts non-draft, non-done jobs (Received + Ready → 2)',
  byLabel('active job').value === '2', byLabel('active job')?.value);
ok('Awaiting delivery counts Ready jobs (j2 → 1)', byLabel('awaiting delivery').value === '1');
ok('Completed today counts delivered/closed today (j3 → 1)', byLabel('completed today').value === '1');
ok('Billing completion reflects outstanding invoices', /outstanding/.test(byLabel('billing').hint));
ok('Inventory coverage is a live % with out-of-stock hint', /%$/.test(byLabel('inventory coverage').value) && /out of stock/.test(byLabel('inventory coverage').hint));
ok('every progress row has a numeric pct 0-100', wp.every((w) => w.pct >= 0 && w.pct <= 100));

// values change when data changes (proves it's computed, not static)
const wp2 = A.computeWorkshopProgress({ inventory, invoices, jobCards: [...jobCards, { id: 'j5', status: 'Received', isDraft: false }], sales: [] });
ok('adding an in-progress job raises Active job cards (2 → 3)', byLabelOf(wp2, 'active job').value === '3');
function byLabelOf(list, s) { return list.find((w) => w.label.toLowerCase().includes(s)); }

// ── Insights include operational items ─────────────────────────────────────
const ins = A.computeInsights({ inventory, sales: [], invoices, jobCards });
const txt = ins.map((i) => i.text).join(' | ');
ok('insights mention job cards in progress', /job card.* in progress/.test(txt), txt);
ok('insights mention vehicles ready for delivery', /ready for delivery/.test(txt), txt);
ok('insights mention invoices awaiting payment', /awaiting payment/.test(txt), txt);
ok('insights are dynamic (empty data → no operational insights)',
  !A.computeInsights({ inventory: [], sales: [], invoices: [], jobCards: [] }).some((i) => /in progress|ready for delivery|awaiting payment/.test(i.text)));

console.log(`\n  (core checks done — see addendum below)\n`);

// ── ADDENDUM: all 9 insight domains + Revenue Goal (freeze-completion) ──────
(function completionChecks() {
  const inv = [{ id: 'p1', name: 'Clutch', stock: 0, minStock: 5 }, { id: 'p2', name: 'Fluid', stock: 10, minStock: 5 }];
  const jc = [{ id: 'j1', status: 'Received', isDraft: false }, { id: 'j2', status: 'Ready', isDraft: false }];
  const invo = [{ status: 'Unpaid', isEstimate: false }];
  const custs = [{ id: 'c1', name: 'A', createdAt: Date.now(), vehicles: [{ id: 'v1' }, { id: 'v2' }] }];
  const now = Date.now();
  const salesData = [{ partId: 'p2', name: 'Fluid', qty: 3, revenue: 500, createdAt: now }];
  const restocks = [{ qty: 3, unitCost: 100, total: 300, createdAt: now }];
  const ins = A.computeInsights({ inventory: inv, sales: salesData, invoices: invo, jobCards: jc, customers: custs, restocks, suppliers: [], purchaseOrders: [] });
  const kinds = new Set(ins.map((i) => i.kind));
  const txt = ins.map((i) => i.text).join(' | ');
  ok('Insights: Job Cards domain present', kinds.has('jobs') || kinds.has('delivery'));
  ok('Insights: Billing domain present', kinds.has('payment'));
  ok('Insights: Sales domain present', kinds.has('sales') || kinds.has('trending') || kinds.has('category'));
  ok('Insights: Stock In domain present', kinds.has('received'), txt);
  ok('Insights: Customers domain present (NEW)', kinds.has('customer'), txt);
  // 1.1 Insights redesign — the standing "N vehicles on record" domain was removed
  // outright (see tests/customer-search-archive.test.cjs for the dedicated removal
  // assertion): a raw total never changes meaningfully and gave the owner nothing to
  // act on, exactly the "don't pad with low-value filler" case the brief calls out.
  ok('Insights: Stock Out domain present (NEW)',
    A.computeInsights({ inventory: [{ id: 'p1', name: 'X', stock: 0, minStock: 5 }], sales: [], invoices: [], jobCards: [], customers: [] }).some((i) => i.kind === 'stockout'), txt);
  ok('Insights: Suppliers domain reachable (no linked parts)',
    A.computeInsights({ inventory: inv, sales: [], suppliers: [{ id: 's1', name: 'X' }], invoices: [], jobCards: [] }).some((i) => i.kind === 'supplier'));
  ok('Insights: Inventory domain present (reorder/out/added)', kinds.has('reorder') || kinds.has('stockout') || kinds.has('added') || kinds.has('image'));

  // Revenue Goal / Sales Target in Workshop Progress
  const wp = A.computeWorkshopProgress({ inventory: inv, invoices: invo, jobCards: jc, sales: salesData });
  const target = wp.find((w) => /sales target/i.test(w.label));
  ok('Workshop Progress: Sales Target / Revenue Goal row present', !!target, wp.map((w) => w.label).join(', '));
  ok('Sales Target has a live % and revenue hint', target && /%$/.test(target.value) && /₹/.test(target.hint));
})();

// ── ADDENDUM 2: Stock Out (adjustments), "today" activity, activity-before-state ──
// Regression guard for the "Insights feel repetitive/demo-like" review: the panel
// previously never looked at stockAdjustments at all (Stock In/Out was half-covered —
// only receiving, never manual reductions), had no "this happened today" signals, and
// mixed activity/state in a fixed order so the same standing checklist always led.
(function freshnessChecks() {
  const now = Date.now();
  const todayStr = new Date().toISOString().slice(0, 10);

  // Stock Out via manual adjustment (damage/theft/loss/...), NOT a sale.
  const stockAdjustments = [
    { partId: 'p1', qty: -5, reason: 'Damage', createdAt: now },
    { partId: 'p1', qty: -3, reason: 'Damage', createdAt: now },
    { partId: 'p2', qty: -2, reason: 'Theft', createdAt: now },
    { partId: 'p3', qty: 10, reason: 'Stock Count Difference', createdAt: now }, // a correction (+), not "out"
  ];
  const adjIns = A.computeInsights({ inventory: [], sales: [], invoices: [], jobCards: [], stockAdjustments });
  const adjHit = adjIns.find((i) => i.kind === 'adjustment');
  ok('Insights: Stock Out via adjustments is surfaced (NEW)', !!adjHit, adjIns.map((i) => i.text).join(' | '));
  ok('Stock Out total sums only reductions, ignores the +10 correction (5+3+2=10)', adjHit && /^10 units? removed/.test(adjHit.text), adjHit?.text);
  ok('Stock Out names the dominant reason (Damage: 2 of 3 reduction entries)', adjHit && /mostly Damage/.test(adjHit.text), adjHit?.text);
  ok('An adjustment outside the 7-day window is excluded',
    !A.computeInsights({ inventory: [], sales: [], invoices: [], jobCards: [], stockAdjustments: [{ partId: 'p1', qty: -5, reason: 'Damage', createdAt: now - 30 * 86400000 }] })
      .some((i) => i.kind === 'adjustment'));

  // Job card completed TODAY (event) vs. just "in progress" (standing state).
  const jcToday = A.computeInsights({
    inventory: [], sales: [], invoices: [],
    jobCards: [{ id: 'j1', status: 'Delivered', isDraft: false, savedAt: now }],
  });
  ok('Insights: "completed today" appears for a job delivered today (NEW)',
    jcToday.some((i) => i.kind === 'completed' && /completed today/.test(i.text)), jcToday.map((i) => i.text).join(' | '));

  // Revenue collected TODAY, read from each payment's own date field (how Billing
  // actually records payments — see BillingModule's collectPayment/emptyPayment).
  const payToday = A.computeInsights({
    inventory: [], sales: [], jobCards: [],
    invoices: [
      { status: 'Partially Paid', isEstimate: false, payments: [{ amount: 1500, date: todayStr }, { amount: 500, date: '2000-01-01' }] },
    ],
  });
  const collected = payToday.find((i) => i.kind === 'collected');
  ok('Insights: "collected today" sums only today-dated payments (NEW)', collected && /₹1,500 collected today/.test(collected.text), collected?.text);

  // 1.1 Insights redesign — ranking is no longer "activity always before state". Real
  // operational priority now decides order (Critical → Financial → Approvals → Reorder →
  // Operational → Trend/Activity, per the brief's own example ordering), so a standing
  // "job cards in progress" (state, operational tier) outranks a purely informational
  // "parts sold this week" (activity, trend tier) — the OPPOSITE of the old fixed rule.
  const mixed = A.computeInsights({
    inventory: [],
    sales: [{ partId: 'p1', name: 'Brake Pad', qty: 4, revenue: 400, createdAt: now }],
    invoices: [],
    jobCards: [{ id: 'j1', status: 'Received', isDraft: false }],
  });
  const salesIdx = mixed.findIndex((i) => i.kind === 'sales');
  const jobsIdx = mixed.findIndex((i) => i.kind === 'jobs');
  ok('Operational state (jobs in progress) is ranked ahead of informational trend activity (sales this week)',
    salesIdx !== -1 && jobsIdx !== -1 && jobsIdx < salesIdx, mixed.map((i) => `${i.kind}`).join(', '));

  // Critical (stock-outs) and financial (outstanding payments) rank ahead of everything,
  // including the operational tier above — matches the brief's example ordering exactly.
  const priorityMix = A.computeInsights({
    inventory: [{ id: 'p1', name: 'Clutch', stock: 0, minStock: 5 }],
    sales: [],
    invoices: [{ status: 'Unpaid', isEstimate: false }],
    jobCards: [{ id: 'j1', status: 'Received', isDraft: false }],
    purchaseOrders: [{ status: 'pending' }],
  });
  const kindOrder = priorityMix.map((i) => i.kind);
  ok('Full priority ordering matches Critical → Financial → Approval → Operational (stockout, payment, po, jobs)',
    kindOrder.indexOf('stockout') < kindOrder.indexOf('payment')
    && kindOrder.indexOf('payment') < kindOrder.indexOf('po')
    && kindOrder.indexOf('po') < kindOrder.indexOf('jobs'),
    kindOrder.join(', '));
})();

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
