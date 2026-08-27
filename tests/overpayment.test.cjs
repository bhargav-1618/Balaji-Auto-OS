/**
 * tests/overpayment.test.cjs
 *
 * Reproduces the QA report for ISSUE 3 against the REAL shipped InvoiceModal:
 *   invoice total ₹4,799 → type a ₹5,000 payment → blur → try to settle it.
 * The invoice must NOT become Paid, and onSave must NOT be called.
 */
const { toasts, clear } = require('./setup.cjs');
const React = require('react');
const { act } = require('react');
const { createRoot } = require('react-dom/client');

const { InvoiceModal, totalsOf, deriveStatus } = require('../components/billing/BillingModule.jsx');
const { ConfirmHost } = require('../components/common/ConfirmDialog.jsx');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};

// ---- fixture ---------------------------------------------------------------
const PART = { id: 'p1', name: 'Hyundai Verna Brake Pads', sku: 'BRA-HY-001', stock: 18, price: 1398, cost: 900, gst: 18 };
const CUSTOMER = {
  id: 'c1', name: 'Chandra Naidu', phone: '9533132103', code: 'CUS-01',
  vehicles: [
    { id: 'v1', regNo: 'AP18QO1675', brand: 'Hyundai', model: 'Grand i10 Nios', fuel: 'Diesel', year: 2020, vin: 'MA1119010163176' },
    { id: 'v2', regNo: 'TS09EX1234', brand: 'Maruti', model: 'Swift', fuel: 'Petrol', year: 2019, vin: 'MB2229010163177' },
    { id: 'v3', regNo: 'KA05MN9090', brand: 'Tata', model: 'Altroz', fuel: 'Petrol', year: 2022, vin: 'MC3339010163178' },
    { id: 'v4', regNo: 'AP16TT4545', brand: 'Honda', model: 'City', fuel: 'Petrol', year: 2021, vin: 'MD4449010163179' },
    { id: 'v5', regNo: 'TS07QQ1111', brand: 'Kia', model: 'Seltos', fuel: 'Diesel', year: 2023, vin: 'ME5559010163180' },
  ],
};
// Total: 2 × 1398 = 2796 + 1500 labour = 4296 + 18% GST on parts (503.28) = 4799.28 → ₹4,799
const INVOICE = {
  id: 'i1', invNo: '', date: '2026-07-14',
  customerId: 'c1', customer: 'Chandra Naidu', phone: '9533132103', gstNo: '',
  vehicleId: 'v1', vehicle: 'Grand i10 Nios', regNo: 'AP18QO1675',
  jobCardId: '', jobNo: '',
  lines: [
    { id: 'l1', kind: 'Part', partId: 'p1', desc: 'Hyundai Verna Brake Pads', qty: 2, rate: 1398, disc: 0, gst: 18, cost: 900, hsn: '' },
    { id: 'l2', kind: 'Labour', partId: '', desc: 'General Servicing', qty: 1, rate: 1500, disc: 0, gst: 0, cost: 0, hsn: '' },
  ],
  payments: [], paid: 0, status: 'Draft', isEstimate: false, discount: 0, discType: '₹',
  gstMode: 'CGST + SGST', notes: '', terms: '', history: [],
};

const q = (sel) => document.querySelectorAll(sel);
const byText = (sel, re) => [...q(sel)].find((e) => re.test(e.textContent || ''));

function render(props) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(React.createElement(React.Fragment, null,
      React.createElement(InvoiceModal, props),
      React.createElement(ConfirmHost, null),
    ));
  });
  return { host, root };
}

// Native setter so React's onChange actually fires.
function type(el, value) {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}
function blur(el) {
  // React maps onBlur onto the native FOCUSOUT event (blur does not bubble, so React
  // cannot delegate it). Dispatching 'blur' here silently tested nothing.
  act(() => { el.dispatchEvent(new window.Event('focusout', { bubbles: true })); });
}
function click(el) {
  act(() => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); });
}

// ---------------------------------------------------------------------------
console.log('\nISSUE 3 — OVERPAYMENT (real InvoiceModal, jsdom)\n');

const saved = [];
clear();

const t0 = totalsOf(INVOICE);
console.log(`  fixture: grand = ₹${t0.grand}  (expect ~4799)`);

let crashed = null;
let view;
try {
  view = render({
    initial: INVOICE,
    invoices: [], customers: [CUSTOMER], inventory: [PART], jobCards: [],
    onSave: (iv, thenPay) => saved.push({ iv, thenPay }),
    onClose: () => {},
    demoMode: true,
  });
} catch (e) { crashed = e; }
ok('InvoiceModal renders', !crashed, crashed && crashed.message);

// 1. Add a payment row and type an OVERPAYMENT (5000 on a 4799 invoice).
const addBtn = byText('button', /Add payment/i);
ok('“Add payment” control exists', !!addBtn);
if (addBtn) click(addBtn);

// The payment amount input is the one inside the payments row: the row also holds
// a MiniSelect trigger for payment mode (Universal dropdown architecture review —
// this used to be a native <select>; MiniSelect renders a <button> showing the
// current mode as its text instead). Anchor on that button, never on a CSS class.
// A freshly-added payment defaults to mode: 'Cash' (see emptyPayment in
// BillingModule.jsx), so the trigger's text reads "Cash" until changed.
// The button sits inside MiniSelect's own wrapper <div>, itself inside the Mode
// <label> — so `closest('div')` alone would stop at MiniSelect's wrapper, not the
// payment row. Go up to the <label> first, then out to its parent (the row).
const modeBtn = byText('button', /^Cash$/);
const payRow = modeBtn ? modeBtn.closest('label')?.parentElement : null;
const target = payRow ? payRow.querySelector('input[inputmode="decimal"]') : null;
ok('payment amount field found', !!target, 'could not locate the payment amount input');

if (target) {
  type(target, '5000');
  blur(target);                       // ← the exact QA step: "clicks outside textbox"

  const errAfterBlur = toasts.filter((t) => t.level === 'error');
  ok('typing 5000 on a 4799 invoice raises a validation error on blur',
    errAfterBlur.length > 0,
    `no error toast fired. toasts so far: ${JSON.stringify(toasts)}`);

  ok('an inline overpayment error is shown in the Payments section',
    !!document.querySelector('[data-testid="overpay-error"]'),
    'no inline error element rendered');

  // 2. Does the UI now think it is fully paid?
  const markPaid = byText('button', /Mark as Paid/i);
  ok('invoice must NOT offer “Mark as Paid” while overpaid',
    !markPaid,
    'the header flipped to “Mark as Paid” — balance was floored to 0 by the overpayment');

  // 3. Try to settle it anyway (this is what QA did).
  const settle = markPaid || byText('button', /Save & Collect|Save &amp; Collect/i);
  if (settle) {
    click(settle);
    // the real ConfirmDialog may appear — accept it, exactly as a user would
    const yes = byText('button', /Yes, mark as Paid|Confirm/i);
    if (yes) click(yes);
  }

  ok('onSave must NOT be called with an overpaid invoice',
    saved.length === 0,
    saved.length ? `onSave WAS called. status=${saved[0].iv.status} paid=${saved[0].iv.paid} grand=${saved[0].iv.grandTotal}` : '');

  if (saved.length) {
    ok('…and if it was saved, at least it is not marked Paid',
      saved[0].iv.status !== 'Paid',
      `status = ${saved[0].iv.status}`);
  }

  const errs = toasts.filter((t) => t.level === 'error').map((t) => t.msg);
  console.log(`\n  error toasts seen: ${errs.length ? JSON.stringify(errs, null, 2) : '(none)'}`);
}

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
