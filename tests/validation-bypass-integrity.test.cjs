/**
 * tests/validation-bypass-integrity.test.cjs — PHASE 18
 *
 * "Is a business rule enforced where the data is WRITTEN, or only by the UI it
 * happens to be typed into?"
 *
 * This app is a client-only static site + Firestore, single-shop trust model.
 * Firestore rules are the SECURITY boundary (append-only ledgers, admin-only
 * deletes, self-attributed auditLog, monotonic counters) — NOT a business-
 * validation layer, by design. So for rules like "one mobile per customer" the
 * correct enforcement layer is the component/service that ALL creation paths
 * funnel through, and the defect pattern is a quick-create shortcut that skips a
 * check the main wizard enforces (see PH10-03 for the same bug, for vehicles).
 *
 * Everything below drives the REAL shipped source. The oracles are hand-derived,
 * never the production validator itself.
 */
const { toasts, clear } = require('./setup.cjs');
const fs = require('fs');
const path = require('path');
const React = require('react');
const { act } = require('react');
const { createRoot } = require('react-dom/client');

const { InvoiceModal, deriveStatus } = require('../components/billing/BillingModule.jsx');
const { CustomerWizard, emptyCustomer } = require('../components/customers/CustomersModule.jsx');
const { ConfirmHost } = require('../components/common/ConfirmDialog.jsx');
const { applyPoReceive } = require('../lib/poReceive');
const {
  nonNegInt, nonNegNum, sanitizeStock, computeStockAdjustment,
} = require('../services/inventoryService');
const { invoiceStatus, isRealized, invoiceTotals } = require('../services/billingService');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};

const q = (sel, root = document) => [...root.querySelectorAll(sel)];
const byText = (sel, re, root = document) => q(sel, root).find((e) => re.test(e.textContent || ''));
function type(el, value) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
  act(() => { setter.call(el, value); el.dispatchEvent(new window.Event('input', { bubbles: true })); });
}
function click(el) { act(() => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); }); }
const errs = () => toasts.filter((t) => t.level === 'error').map((t) => t.msg);

// Portals render into <body> and outlive their host unless unmounted — track + tear
// down every root so a stale modal from a previous case can't answer a later query.
const LIVE = [];
function mount(el) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(el));
  LIVE.push({ root, host });
  return host;
}
function teardown() {
  while (LIVE.length) {
    const { root, host } = LIVE.pop();
    act(() => root.unmount());
    host.remove();
  }
  document.body.querySelectorAll('div').forEach((d) => { if (!d.hasChildNodes() && !d.firstChild) d.remove(); });
  clear();
}
// the New Customer sub-modal's own root (scopes input lookups away from the
// invoice form's identically-placeholdered PHONE / GST fields)
const custModalRoot = () => {
  const h = byText('h3', /^New Customer$/);
  return h ? h.closest('div[class*="z-["]') || h.parentElement.parentElement : null;
};
const vehModalRoot = () => {
  const h = byText('h3', /^Add Vehicle$/);
  return h ? h.closest('div[class*="z-["]') || h.parentElement.parentElement : null;
};

const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
const billSrc = read('../components/billing/BillingModule.jsx');
const dashSrc = read('../components/InventoryDashboard.js');
const poSrc = read('../services/purchaseOrderService.js');
const rulesSrc = read('../firestore.rules');
const custModSrc = read('../components/customers/CustomersModule.jsx');
const vehModSrc = read('../components/vehicles/VehiclesModule.jsx');

// =====================================================================
console.log('\nPHASE 18 — VALIDATION BYPASS / MUTATION-BOUNDARY INTEGRITY\n');

// ---------------------------------------------------------------------
// 1. INDEPENDENT VALIDATION MATRIX (documentation + guard against regressions)
//    path columns: wizard | quick-create | edit | bulk/import | service | txn | rules
// ---------------------------------------------------------------------
console.log('1. Validation matrix — every rule classified\n');
const MATRIX = [
  ['customer.name.required',        { wizard: 'ENFORCED', quick: 'ENFORCED', rules: 'N/A' }],
  ['customer.phone.format',         { wizard: 'ENFORCED', quick: 'ENFORCED', rules: 'N/A' }],
  ['customer.phone.unique',         { wizard: 'ENFORCED', quick: 'ENFORCED (fixed PH18)', rules: 'N/A (no server)' }],
  ['customer.gst.unique',           { wizard: 'ENFORCED', quick: 'ENFORCED (fixed PH18)', rules: 'N/A' }],
  ['customer.email.format',         { wizard: 'ENFORCED', quick: 'ENFORCED', rules: 'N/A' }],
  ['vehicle.reg.unique(fleet)',     { wizard: 'ENFORCED', quick: 'ENFORCED (PH10-03)', rules: 'N/A' }],
  ['vehicle.reg.crossCustomer',     { wizard: 'INTENTIONAL EXCEPTION (advisory — ownership transfer)', rules: 'N/A' }],
  ['part.sku.unique',               { wizard: 'ENFORCED', bulk: 'ENFORCED (skip)', rules: 'N/A' }],
  ['part.price.nonNegative',        { service: 'ENFORCED (nonNegNum clamp)', bulk: 'ENFORCED', rules: 'N/A' }],
  ['part.mrp>=purchase',            { wizard: 'ENFORCED', bulk: 'ENFORCED', rules: 'N/A' }],
  ['stock.qty.nonNegative',         { service: 'ENFORCED (sanitizeStock/computeStockAdjustment)', rules: 'N/A' }],
  ['invoice.line.nonNegative',      { wizard: 'ENFORCED', service: 'DEFENSIVE (Math.max(0) in totals)', rules: 'N/A' }],
  ['invoice.overpayment',           { wizard: 'ENFORCED', txn: 'ENFORCED (conc/overpaid)', rules: 'N/A' }],
  ['invoice.number.unique',         { wizard: 'ENFORCED', txn: 'ENFORCED (counters monotonic)', rules: 'ENFORCED (next >= )' }],
  ['invoice.jobcard.doubleBill',    { wizard: 'ENFORCED', rules: 'N/A' }],
  ['invoice.status.derived',        { service: 'ENFORCED (pure fn of payments — cannot be forged)', rules: 'N/A' }],
  ['po.cancelled.cannotReceive',    { ui: 'ENFORCED', txn: 'ENFORCED (po/cancelled)', rules: 'N/A' }],
  ['po.overReceipt',                { ui: 'ENFORCED', txn: 'ENFORCED (po/over-receipt)', rules: 'N/A' }],
  ['jobcard.status.noSkip',         { ui: 'ENFORCED (non-admin)', service: 'reservation is idempotent pure fn', rules: 'N/A' }],
  ['ledger.appendOnly',             { rules: 'ENFORCED (update: if false)' }],
  ['auditLog.actor',               { rules: 'ENFORCED (performedBy == auth.uid)' }],
  ['appSettings.adminOnly',         { rules: 'ENFORCED (isAdmin())' }],
  ['deletes.adminOnly',             { rules: 'ENFORCED (isAdmin())' }],
];
ok('matrix enumerates >= 20 business rules', MATRIX.length >= 20, `only ${MATRIX.length}`);
ok('every rule row carries at least one enforcement classification',
  MATRIX.every(([, m]) => Object.keys(m).length >= 1));

// ---------------------------------------------------------------------
// 2. QUICK-CREATE vs MAIN WIZARD — customer phone / GST uniqueness
//    (the confirmed PH18 defect + its fix, driven through the real InvoiceModal)
// ---------------------------------------------------------------------
console.log('\n2. Inline "New Customer" from an invoice — uniqueness must match the wizard\n');

const EXISTING_CUSTOMER = {
  id: 'c1', code: 'CUST-0001', name: 'Omkar Gowda',
  phone: '9586668406', gst: '36ABCDE1234F1Z5', vehicles: [],
};
const PART = { id: 'p1', name: 'Brake Pad', sku: 'BRK-1', stock: 10, defaultSellingPrice: 500, purchasePrice: 300, gst: 18 };
const BLANK_INVOICE = {
  id: 'i1', invNo: '', date: '2026-09-05', customerId: '', customer: '', phone: '', gstNo: '',
  vehicleId: '', vehicle: '', regNo: '', jobCardId: '', jobNo: '',
  lines: [{ id: 'l1', kind: 'Labour', partId: '', desc: '', qty: 1, rate: 0, disc: 0, gst: 0, cost: 0, hsn: '' }],
  payments: [], paid: 0, status: 'Draft', isEstimate: false, discount: 0, discType: '₹',
  gstMode: 'CGST + SGST', notes: '', terms: '', history: [],
};

function renderInvoice(overrides = {}) {
  const quickCustomerCalls = [];
  const quickVehicleCalls = [];
  mount(React.createElement(React.Fragment, null,
    React.createElement(InvoiceModal, {
      initial: BLANK_INVOICE,
      invoices: [], customers: [EXISTING_CUSTOMER], inventory: [PART], jobCards: [],
      onSave: () => {}, onClose: () => {}, demoMode: true,
      onQuickCustomer: (d) => { quickCustomerCalls.push(d); return { id: 'cNEW', name: d.name, phone: d.phone, gst: d.gst }; },
      onQuickVehicle: (cid, veh) => { quickVehicleCalls.push({ cid, veh }); return { id: 'vNEW', regNo: veh.regNo }; },
      ...overrides,
    }),
    React.createElement(ConfirmHost, null),
  ));
  return { quickCustomerCalls, quickVehicleCalls };
}

// open the New Customer sub-modal: switch to "Search Existing" mode, click "+ New Customer"
function openNewCustomer() {
  const searchTab = byText('button', /Search Existing/);
  if (searchTab) click(searchTab);
  const newBtn = byText('button', /New Customer/);
  if (newBtn) click(newBtn);
  return !!custModalRoot();
}
function fillNewCustomer({ name, phone, gst }) {
  const root = custModalRoot();
  if (!root) return false;
  const ins = q('input', root);
  const nameInput = ins.find((i) => /customer name/i.test(i.placeholder || ''));
  const phoneInput = ins.find((i) => /^10-digit$/i.test(i.placeholder || ''));
  const gstInput = ins.find((i) => /^GSTIN$/i.test(i.placeholder || ''));
  if (nameInput && name != null) type(nameInput, name);
  if (phoneInput && phone != null) type(phoneInput, phone);
  if (gstInput && gst != null) type(gstInput, gst);
  return !!(nameInput && phoneInput && gstInput);
}
function clickSaveAndSelect(root) {
  const b = byText('button', /Save\s*&(amp;)?\s*Select/i, root || document);
  if (b) click(b);
}

// 2a. DUPLICATE PHONE — must be blocked, onQuickCustomer must NOT fire
let v = renderInvoice();
ok('invoice modal renders + New Customer sub-modal opens', openNewCustomer());
ok('New Customer modal exposes its own name/phone/gst fields', fillNewCustomer({ name: 'Different Person', phone: '9586668406' }));
clickSaveAndSelect(custModalRoot());
ok('duplicate phone: onQuickCustomer is NOT called (no record persisted)',
  v.quickCustomerCalls.length === 0,
  `onQuickCustomer fired with ${JSON.stringify(v.quickCustomerCalls)}`);
ok('duplicate phone: a blocking error names the existing customer',
  errs().some((m) => /already has this mobile/i.test(m)),
  `errors: ${JSON.stringify(errs())}`);
teardown();

// 2b. DUPLICATE GST — must be blocked
v = renderInvoice();
openNewCustomer();
fillNewCustomer({ name: 'Another Co', phone: '9000000001', gst: '36ABCDE1234F1Z5' }); // same GST as Omkar
clickSaveAndSelect(custModalRoot());
ok('duplicate GST: onQuickCustomer is NOT called',
  v.quickCustomerCalls.length === 0, JSON.stringify(v.quickCustomerCalls));
ok('duplicate GST: a blocking error is shown',
  errs().some((m) => /already has this GST/i.test(m)), `errors: ${JSON.stringify(errs())}`);
teardown();

// 2c. UNIQUE phone — must go through
v = renderInvoice();
openNewCustomer();
fillNewCustomer({ name: 'Brand New Customer', phone: '9812345678' });
clickSaveAndSelect(custModalRoot());
ok('unique phone: onQuickCustomer IS called exactly once',
  v.quickCustomerCalls.length === 1, JSON.stringify(v.quickCustomerCalls));
ok('unique phone: no error toast', !errs().length, JSON.stringify(errs()));
teardown();

// 2d. FORMAT still enforced (regression) — invalid phone
v = renderInvoice();
openNewCustomer();
fillNewCustomer({ name: 'Bad Phone', phone: '12345' });
clickSaveAndSelect(custModalRoot());
ok('malformed phone: still blocked, onQuickCustomer not called',
  v.quickCustomerCalls.length === 0 && errs().length > 0, JSON.stringify(errs()));
teardown();

// 2e. static: the fix reuses phoneKey (not a new hand-rolled normalizer)
ok('the inline guard reuses phoneKey from lib/useSearch (no fourth phone normalizer)',
  /phoneKey\(c\.phone\) === phoneKey\(newCust\.phone\)/.test(billSrc)
  && /from '\.\.\/\.\.\/lib\/useSearch'/.test(billSrc.split('\n').find((l) => l.includes('phoneKey')) || ''));

// ---------------------------------------------------------------------
// 3. ALTERNATE WORKFLOW — the inline "Add Vehicle" shortcut (PH10-03 regression)
// ---------------------------------------------------------------------
console.log('\n3. Inline "Add Vehicle" from an invoice — reg uniqueness (PH10-03 must stay green)\n');
const CUST_WITH_VEH = { id: 'c1', code: 'CUST-0001', name: 'Owner A', phone: '9586668406', vehicles: [{ id: 'v1', regNo: 'TS09AB1234', model: 'Swift' }] };
{
  const quickVeh = [];
  mount(React.createElement(React.Fragment, null,
    React.createElement(InvoiceModal, {
      initial: { ...BLANK_INVOICE, customerId: 'c1', customer: 'Owner A', phone: '9586668406' },
      invoices: [], customers: [CUST_WITH_VEH], inventory: [PART], jobCards: [],
      onSave: () => {}, onClose: () => {}, demoMode: true,
      onQuickCustomer: () => null,
      onQuickVehicle: (cid, veh) => { quickVeh.push({ cid, veh }); return { id: 'vNEW', regNo: veh.regNo }; },
    }),
    React.createElement(ConfirmHost, null),
  ));
  const addVehBtn = byText('button', /Add Vehicle/);
  if (addVehBtn) click(addVehBtn);
  const vroot = vehModalRoot() || document;
  const regInput = q('input', vroot).find((i) => /TS09EX1234/i.test(i.placeholder || ''));
  if (regInput) type(regInput, 'TS09AB1234'); // dup — already on CUST_WITH_VEH
  clickSaveAndSelect(vroot);
  ok('duplicate registration: onQuickVehicle NOT called',
    quickVeh.length === 0, JSON.stringify(quickVeh));
  ok('duplicate registration: blocking error mentions the current owner',
    errs().some((m) => /already registered to/i.test(m)), JSON.stringify(errs()));
  teardown();
}
ok('billing Add-Vehicle guard still present in source (dupOwner via regKey)',
  /const dupOwner = customers\.find\(\(c\) => \(c\.vehicles \|\| \[\]\)\.some\(\(v\) => v\.regNo && regKey\(v\.regNo\) === regKey\(newVeh\.regNo\)\)\)/.test(billSrc));

// ---------------------------------------------------------------------
// 4. MAIN WIZARD — the reference behaviour must be unchanged
// ---------------------------------------------------------------------
console.log('\n4. Main Customer wizard still blocks a duplicate phone (regression)\n');
{
  const saved = [];
  mount(React.createElement(CustomerWizard, {
    initial: emptyCustomer(),
    existing: [{ id: 'c9', code: 'CUST-0009', name: 'Existing Person', phone: '9876500000' }],
    canManage: true, onSave: (c) => saved.push(c), onClose: () => {}, demoMode: true,
  }));
  const nameInput = q('input').find((i) => /enter customer name/i.test(i.placeholder || ''));
  type(nameInput, 'Duplicate Attempt');
  const phoneInput = q('input').find((i) => /10 digit number|enter 10 digit/i.test(i.placeholder || ''));
  type(phoneInput, '9876500000');
  // walk to the end and Save
  for (let i = 0; i < 6; i++) { const n = byText('button', /^Next$/); if (n) click(n); }
  const saveBtn = byText('button', /Save Customer|Save$/);
  if (saveBtn) click(saveBtn);
  ok('wizard: onSave NOT called for a duplicate phone', saved.length === 0, JSON.stringify(saved.map((s) => s.name)));
  ok('wizard: "already exists" error surfaced',
    errs().some((m) => /already exists/i.test(m)) || q('*').some((e) => /already exists/i.test(e.textContent || '')),
    JSON.stringify(errs()));
  teardown();
}
ok('wizard dupPhone predicate uses phoneKey (source)',
  /phoneKey\(c\.phone\) === phoneKey\(f\.phone\)/.test(custModSrc));
ok('VehiclesModule quick-customer also blocks a duplicate phone (source)',
  /customers\.some\(\(c\) => \(c\.phone \|\| ''\)\.replace\(\/\\D\/g, ''\) === phone\)/.test(vehModSrc)
  || /a customer with this phone already exists/i.test(vehModSrc));

// ---------------------------------------------------------------------
// 5. NUMERIC / TYPE clamps at the service layer (independent oracle)
// ---------------------------------------------------------------------
console.log('\n5. Numeric clamps — paste / keyboard cannot persist a negative or junk value\n');
const clampInt = (raw) => { const n = parseInt(raw, 10); return Number.isFinite(n) ? Math.max(0, n) : 0; };
const clampNum = (raw) => { const n = parseFloat(raw); return Number.isFinite(n) ? Math.max(0, n) : 0; };
for (const raw of ['-5', '  -12 ', 'abc', '', '3.9', '1e5', '99999999', '-0']) {
  ok(`nonNegInt(${JSON.stringify(raw)}) === oracle (${clampInt(raw)})`, nonNegInt(raw) === clampInt(raw), `got ${nonNegInt(raw)}`);
}
for (const raw of ['-500.5', 'junk', '', '480.10', '-0.001']) {
  ok(`nonNegNum(${JSON.stringify(raw)}) === oracle (${clampNum(raw)})`, nonNegNum(raw) === clampNum(raw), `got ${nonNegNum(raw)}`);
}
ok('sanitizeStock floors + clamps negative to 0', sanitizeStock(-3.7) === 0 && sanitizeStock('5.9') === 5 && sanitizeStock('bad') === 0);
// a reduce adjustment can never drive stock negative or reduce by more than on-hand
const adj = computeStockAdjustment({ currentStock: 2, qty: 10, direction: 'reduce' });
ok('computeStockAdjustment: reduce is clamped to on-hand (after >= 0, delta <= stock)',
  adj.after === 0 && adj.delta === 2 && adj.signedQty === -2, JSON.stringify(adj));
const adjC = computeStockAdjustment({ currentStock: 5, qty: -3, direction: 'correction' });
ok('computeStockAdjustment: a negative correction qty is clamped to 0', adjC.delta === 0 && adjC.after === 5, JSON.stringify(adjC));

// ---------------------------------------------------------------------
// 6. STATE validation — pure decision functions cannot be talked past
// ---------------------------------------------------------------------
console.log('\n6. State rules — cancelled PO / over-receipt / forged invoice status\n');
const poItems = [{ partId: 'p1', name: 'Brake Pad', sku: 'BRK-1', qty: 4, receivedQty: 0 }];
const rc = applyPoReceive(poItems, [{ partId: 'p1', receiveQty: 4 }], 'cancelled');
ok('applyPoReceive(cancelled) returns blocked:"cancelled" and applies nothing',
  rc.blocked === 'cancelled' && rc.over == null && JSON.stringify(rc.items) === JSON.stringify(poItems), JSON.stringify(rc));
const ro = applyPoReceive(poItems, [{ partId: 'p1', receiveQty: 99 }], 'sent');
ok('applyPoReceive over-receipt is rejected (over set, not silently capped)',
  ro.over && ro.over.delta === 99 && ro.over.ordered === 4, JSON.stringify(ro.over));
const rok = applyPoReceive(poItems, [{ partId: 'p1', receiveQty: 3 }], 'sent');
ok('applyPoReceive valid partial → status partial, receivedQty 3',
  rok.status === 'partial' && rok.items[0].receivedQty === 3 && !rok.over && !rok.blocked, JSON.stringify(rok));

// independent invoice-status oracle: pure fn of lines + payments + terminal overrides
const oracleStatus = (iv) => {
  if (['Cancelled', 'Refunded', 'Returned'].includes(iv.status)) return iv.status;
  if (iv.isEstimate) return 'Estimate';
  const grand = (iv.lines || []).reduce((s, l) => {
    const gross = (Number(l.qty) || 0) * (Number(l.rate) || 0);
    const net = Math.max(0, gross - gross * ((Number(l.disc) || 0) / 100));
    return s + net + net * ((Number(l.gst) || 0) / 100);
  }, 0);
  const g = Math.round(grand);
  const paid = (iv.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  if (g > 0 && paid >= g) return 'Paid';
  if (paid > 0) return 'Partially Paid';
  return iv.status === 'Draft' ? 'Draft' : 'Pending';
};
const forgedPaid = { status: 'Draft', isEstimate: false, lines: [{ kind: 'Labour', qty: 1, rate: 1000, disc: 0, gst: 0 }], payments: [{ amount: 1000 }] };
ok('invoiceStatus ignores a forged status:"Draft" on a fully-paid invoice → "Paid"',
  invoiceStatus(forgedPaid) === 'Paid' && oracleStatus(forgedPaid) === 'Paid',
  `service=${invoiceStatus(forgedPaid)} oracle=${oracleStatus(forgedPaid)}`);
const forgedUnpaid = { status: 'Paid', isEstimate: false, lines: [{ kind: 'Labour', qty: 1, rate: 1000, disc: 0, gst: 0 }], payments: [] };
ok('invoiceStatus ignores a forged status:"Paid" with no payments → not Paid',
  invoiceStatus(forgedUnpaid) !== 'Paid' && !isRealized(forgedUnpaid), invoiceStatus(forgedUnpaid));
ok('isRealized: draft / estimate / cancelled never realize',
  !isRealized({ status: 'Draft', lines: [{ kind: 'Labour', qty: 1, rate: 100 }], payments: [{ amount: 100 }] })
  && !isRealized({ isEstimate: true, lines: [{ kind: 'Labour', qty: 1, rate: 100 }], payments: [{ amount: 100 }] })
  && !isRealized({ status: 'Cancelled', lines: [{ kind: 'Labour', qty: 1, rate: 100 }], payments: [{ amount: 100 }] }));
// overpaid: the EDITOR gate (deriveStatus) must refuse "Paid"; balance floors at 0.
// (billingService.invoiceStatus floors balance and so reads an overpaid invoice as
//  "Paid" — reachable only if the 3 write-path overpayment guards are bypassed;
//  noted as a LOW latent derivation inconsistency, not a live defect.)
const over = { id: 'o', invNo: 'INV-1', status: 'Pending', isEstimate: false, discount: 0, gstMode: 'CGST + SGST', history: [], lines: [{ id: 'l', kind: 'Labour', partId: '', desc: 'Svc', qty: 1, rate: 1000, disc: 0, gst: 0, cost: 0, hsn: '' }], payments: [{ id: 'p', mode: 'Cash', amount: 1500, ref: '', at: 1 }] };
ok('overpaid invoice: the editor gate deriveStatus refuses "Paid"', deriveStatus(over) !== 'Paid', deriveStatus(over));
ok('overpaid invoice: displayed balance is floored at 0 (never negative)', invoiceTotals(over).balance === 0);

// ---------------------------------------------------------------------
// 7. MUTATION-BOUNDARY guards exist in the WRITE path, not just the UI
// ---------------------------------------------------------------------
console.log('\n7. Write-path guards — transaction re-reads server truth\n');
ok('poReceiveDoc re-reads the PO inside the transaction and passes SERVER status to applyPoReceive',
  /runTransaction\(db, async \(tx\) => \{[\s\S]{0,600}tx\.get\(poRef\)[\s\S]{0,900}applyPoReceive\(server\.items \|\| \[\], receivedLines, server\.status\)/.test(poSrc));
ok('poReceiveDoc throws po/cancelled and po/over-receipt from inside the txn',
  /e\.code = 'po\/cancelled'/.test(poSrc) && /e\.code = 'po\/over-receipt'/.test(poSrc));
ok('collectInvoicePayment re-checks overpayment against the txn\'s own fresh read (conc/overpaid)',
  /const collectInvoicePayment[\s\S]{0,3500}t\.grand > 0 && t\.paid > t\.grand \+ 1[\s\S]{0,400}err\.code = 'conc\/overpaid'/.test(dashSrc));
ok('collectInvoicePayment is idempotent on pay.id (no double payment row on retry)',
  /priorPayments\.some\(\(p\) => p && p\.id === pay\.id\)/.test(dashSrc));

// ---------------------------------------------------------------------
// 8. FIRESTORE RULES — security invariants, NOT business validation
// ---------------------------------------------------------------------
console.log('\n8. Firestore rules — the deliberate boundary split\n');
ok('ledgers (sales / restocks / stockAdjustments) are append-only: update if false',
  /match \/sales\/\{saleId\} \{[\s\S]{0,120}allow update: if false/.test(rulesSrc)
  && /match \/restocks\/\{restockId\} \{[\s\S]{0,120}allow update: if false/.test(rulesSrc)
  && /match \/stockAdjustments\/\{adjId\} \{[\s\S]{0,120}allow update: if false/.test(rulesSrc));
ok('auditLog create is self-attributed (performedBy == request.auth.uid)',
  /allow create: if signedIn\(\) && request\.resource\.data\.performedBy == request\.auth\.uid/.test(rulesSrc));
ok('appSettings writes are admin-only (privilege-escalation lock)',
  /match \/appSettings\/\{docId\} \{[\s\S]{0,120}allow create, update: if isAdmin\(\)/.test(rulesSrc));
ok('counters/next can never decrease (invoice-number monotonicity)',
  /request\.resource\.data\.next >= resource\.data\.next/.test(rulesSrc));
ok('business collections are create/update: if signedIn() — NO field validation in rules (by design)',
  /match \/customers\/\{customerId\} \{[\s\S]{0,120}allow create, update: if signedIn\(\);/.test(rulesSrc)
  && /match \/invoices\/\{invoiceId\} \{[\s\S]{0,120}allow create, update: if signedIn\(\);/.test(rulesSrc)
  && /match \/parts\/\{partId\} \{[\s\S]{0,120}allow create, update: if signedIn\(\);/.test(rulesSrc));

// ---------------------------------------------------------------------
// 9. RETRY / durable op-id — an ambiguous failure + retry does not double-write
// ---------------------------------------------------------------------
console.log('\n9. Retry safety — durable op ids on the create paths\n');
ok('PO create uses a deterministic doc id (setDoc merge) so a retry re-writes the SAME PO',
  /setDoc\(doc\(db, 'purchaseOrders', String\(poId\)\), data, \{ merge: true \}\)/.test(poSrc));
ok('supplier / part / invoice creates carry a durable opId (survives refresh)',
  /useDurableOpId\('create-supplier'/.test(dashSrc) || /useDurableOpId\(/.test(dashSrc));
ok('quick-create supplier is idempotent (name-derived doc id + setDoc merge)',
  /const quickId = `sup_qc_\$\{safeLower\(cleanName\)/.test(dashSrc));

// ---------------------------------------------------------------------
// 10. DEMO vs PRODUCTION — one validator, swapped persistence
// ---------------------------------------------------------------------
console.log('\n10. Demo/production parity\n');
const storeSrc = read('../services/persistenceStore.js');
ok('createStore(demoMode) swaps ONLY persistence — same _rev / conflict contract both sides',
  /export function createStore\(demoMode\) \{[\s\S]{0,200}if \(demoMode\) \{/.test(storeSrc)
  && /revState\(/.test(storeSrc) && /conflictError\(/.test(storeSrc));
ok('the numeric clamps (nonNegInt/nonNegNum/sanitizeStock) live in a pure service, not a component',
  /export const nonNegInt/.test(read('../services/inventoryService.js'))
  && /export const sanitizeStock/.test(read('../services/inventoryService.js')));
ok('the money/status rules live in a pure service (billingService) run by both modes',
  /export function invoiceStatus/.test(read('../services/billingService.js'))
  && /export function isRealized/.test(read('../services/billingService.js')));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
