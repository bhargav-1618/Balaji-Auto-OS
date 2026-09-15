/**
 * tests/regression.test.cjs
 *
 * Guards the paths the fixes could plausibly have broken, plus the dropdown and
 * focus-trap behaviour the fixes were supposed to deliver. Executes the REAL
 * shipped components in jsdom.
 */
const { toasts, clear } = require('./setup.cjs');
const React = require('react');
const { act } = require('react');
const { createRoot } = require('react-dom/client');

const { InvoiceModal, totalsOf, deriveStatus } = require('../components/billing/BillingModule.jsx');
const { ConfirmHost } = require('../components/common/ConfirmDialog.jsx');
const { topmostOverlay, focusablesIn, installGlobalFocusTrap } = require('../lib/focusTrap.js');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};

const PART = { id: 'p1', name: 'Hyundai Verna Brake Pads', sku: 'BRA-HY-001', stock: 18, price: 1398, cost: 900, gst: 18 };
const CUSTOMER = {
  id: 'c1', name: 'Chandra Naidu', phone: '9533132103', code: 'CUS-01',
  vehicles: [
    { id: 'v1', regNo: 'AP18QO1675', brand: 'Hyundai', model: 'Grand i10 Nios', fuel: 'Diesel', year: 2020, vin: 'MA1119010163176', engineNo: 'D3FA1234567' },
    { id: 'v2', regNo: 'TS09EX1234', brand: 'Maruti', model: 'Swift', fuel: 'Petrol', year: 2019, vin: 'MB2229010163177', engineNo: 'K12MN7654321' },
    { id: 'v3', regNo: 'KA05MN9090', brand: 'Tata', model: 'Altroz', fuel: 'Petrol', year: 2022, vin: 'MC3339010163178', engineNo: 'REVO9988776' },
    { id: 'v4', regNo: 'AP16TT4545', brand: 'Honda', model: 'City', fuel: 'Petrol', year: 2021, vin: 'MD4449010163179', engineNo: 'L15ZZ1122334' },
    { id: 'v5', regNo: 'TS07QQ1111', brand: 'Kia', model: 'Seltos', fuel: 'Diesel', year: 2023, vin: 'ME5559010163180', engineNo: 'D16CR5566778' },
  ],
};
const JOBCARDS = [
  { id: 'j1', jobNo: 'SBBMC05', regNo: 'AP18QO1675', vehicle: 'Grand i10 Nios', customer: 'Chandra Naidu', phone: '9533132103', status: 'Received' },
  { id: 'j2', jobNo: 'SBBMC09', regNo: 'AP18QO1675', vehicle: 'Grand i10 Nios', customer: 'Chandra Naidu', phone: '9533132103', status: 'Ready' },
  { id: 'j3', jobNo: 'SBBMC11', regNo: 'TS09EX1234', vehicle: 'Swift', customer: 'Chandra Naidu', phone: '9533132103', status: 'Wash' },
];
const baseInvoice = () => ({
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
});

const q = (sel) => document.querySelectorAll(sel);
const byText = (sel, re) => [...q(sel)].find((e) => re.test(e.textContent || ''));
const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
const type = (el, v) => act(() => { setter.call(el, v); el.dispatchEvent(new window.Event('input', { bubbles: true })); });
const click = (el) => act(() => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); });
const focus = (el) => act(() => { el.focus(); el.dispatchEvent(new window.Event('focusin', { bubbles: true })); });
const key = (el, k, opts = {}) => act(() => {
  el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
});

function mount(props) {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(React.createElement(React.Fragment, null,
      React.createElement(InvoiceModal, props),
      React.createElement(ConfirmHost, null),
    ));
  });
  return root;
}

// Universal dropdown architecture review — the payment Mode field used to be a
// native <select> (anchored on above); it's now a MiniSelect <button> living inside
// its own wrapper <div>, itself inside the Mode <label> — so go up to the <label>
// first, then out to its parent (the row), same fix as tests/overpayment.test.cjs.
const payAmountInput = () => {
  const modeBtn = byText('button', /^Cash$/);
  const row = modeBtn ? modeBtn.closest('label')?.parentElement : null;
  return row ? row.querySelector('input[inputmode="decimal"]') : null;
};

async function main() {
// ===========================================================================
console.log('\nREGRESSION — the paths the fixes could have broken\n');

// --- R1: the HAPPY PATH still settles. This is the TDZ fix. ----------------
{
  clear();
  const saved = [];
  mount({
    initial: baseInvoice(), invoices: [], customers: [CUSTOMER], inventory: [PART], jobCards: JOBCARDS,
    onSave: (iv, thenPay) => saved.push({ iv, thenPay }), onClose: () => {}, demoMode: true,
  });
  const grand = totalsOf(baseInvoice()).grand;
  click(byText('button', /Add payment/i));
  type(payAmountInput(), String(grand));            // pay EXACTLY the total

  const markPaid = byText('button', /Mark as Paid/i);
  ok('R1 exact payment offers “Mark as Paid”', !!markPaid);

  let threw = null;
  try {
    if (markPaid) click(markPaid);
    // confirmDialog() is a PROMISE — `if (ok) save(false)` runs on a later microtask.
    // Without flushing it, onSave has simply not happened yet.
    await act(async () => { await Promise.resolve(); });
    const yes = byText('button', /Yes, mark as Paid/i);
    ok('R1 confirm dialog appears before settling', !!yes);
    if (yes) click(yes);
    await act(async () => { await Promise.resolve(); });
  } catch (e) { threw = e; }

  ok('R1 save() no longer throws (TDZ fixed)', !threw, threw && threw.message);
  ok('R1 onSave IS called for a correct payment', saved.length === 1,
    `onSave called ${saved.length} times`);
  if (saved.length) {
    ok('R1 invoice is marked Paid', saved[0].iv.status === 'Paid', `status = ${saved[0].iv.status}`);
    // CONCURRENCY PHASE 2 — a new invoice no longer carries a client-computed number.
    // save() emits the allocation intent; the server counter assigns the real INV-
    // serial in persistInvoice (store.allocateNumber), which this modal test stubs out.
    ok('R1 invoice save requests an INV- serial from the server counter (not a client number)',
      saved[0].iv.invNo === '' && saved[0].iv.__allocSeq === 'invoices' && saved[0].iv.__allocPrefix === 'INV',
      `invNo=${JSON.stringify(saved[0].iv.invNo)} __allocSeq=${saved[0].iv.__allocSeq}`);
    ok('R1 persisted paid mirrors the payment rows', Math.abs(saved[0].iv.paid - grand) < 0.5,
      `paid = ${saved[0].iv.paid}, grand = ${grand}`);
    ok('R1 balance is zero', Math.abs(saved[0].iv.balance) < 0.5, `balance = ${saved[0].iv.balance}`);
  }
}

// --- R2: PARTIAL payment still saves and is NOT Paid ----------------------
{
  clear();
  const saved = [];
  mount({
    initial: baseInvoice(), invoices: [], customers: [CUSTOMER], inventory: [PART], jobCards: JOBCARDS,
    onSave: (iv) => saved.push(iv), onClose: () => {}, demoMode: true,
  });
  click(byText('button', /Add payment/i));
  type(payAmountInput(), '2000');                    // partial
  const saveBtn = [...q('button')].find((b) => b.textContent.trim() === 'Save' && !b.disabled);
  ok('R2 Save is enabled for a partial payment', !!saveBtn);
  if (saveBtn) click(saveBtn);
  ok('R2 partial payment saves', saved.length === 1, `onSave called ${saved.length} times`);
  if (saved.length) {
    ok('R2 partial payment is NOT marked Paid', saved[0].status !== 'Paid', `status = ${saved[0].status}`);
    ok('R2 balance reflects the shortfall', saved[0].balance > 0, `balance = ${saved[0].balance}`);
  }
}

// --- R3: ESTIMATE still saves and carries no payments ---------------------
{
  clear();
  const saved = [];
  mount({
    initial: baseInvoice(), invoices: [], customers: [CUSTOMER], inventory: [PART], jobCards: JOBCARDS,
    onSave: (iv) => saved.push(iv), onClose: () => {}, demoMode: true,
  });
  const est = byText('button', /^Estimate$/);
  if (est) click(est);
  ok('R3 estimate saves', saved.length === 1, `onSave called ${saved.length} times`);
  if (saved.length) {
    ok('R3 estimate carries no payments', (saved[0].payments || []).length === 0);
    // Phase 2 — the EST- serial is assigned by the server counter at persist time.
    ok('R3 estimate save requests an EST- serial from the server counter',
      saved[0].invNo === '' && saved[0].__allocSeq === 'estimates' && saved[0].__allocPrefix === 'EST',
      `invNo=${JSON.stringify(saved[0].invNo)} __allocSeq=${saved[0].__allocSeq}`);
  }
}

// ===========================================================================
console.log('\nISSUES 1 & 2 — dropdown clipping / visibility\n');
{
  clear();
  mount({
    initial: baseInvoice(), invoices: [], customers: [CUSTOMER], inventory: [PART], jobCards: JOBCARDS,
    onSave: () => {}, onClose: () => {}, demoMode: true,
  });

  // Open the VEHICLE dropdown (the customer owns 5 vehicles).
  const vehInput = [...q('input')].find((i) => /Search model, reg no/i.test(i.placeholder || ''));
  ok('vehicle selector present', !!vehInput);

  // ISSUE 5: focus alone must NOT open the list (it used to pop open when the form
  // autofocused or the user merely tabbed through).
  focus(vehInput);
  ok('focus alone does NOT open the dropdown (Issue 5)',
    !document.querySelector('[data-searchselect-panel]'),
    'the dropdown opened on focus');

  click(vehInput);   // a CLICK opens it
  const panel = document.querySelector('[data-searchselect-panel]');
  ok('dropdown renders', !!panel);
  ok('dropdown is PORTALLED to <body>, not nested in the clipping Section',
    !!panel && panel.parentElement === document.body,
    panel ? `parent = ${panel.parentElement.tagName}` : 'no panel');
  ok('dropdown is position:fixed (immune to ancestor overflow)',
    !!panel && panel.style.position === 'fixed',
    panel ? `position = ${panel.style.position}` : 'no panel');
  const maxH = panel ? parseInt(panel.style.maxHeight, 10) : 0;
  ok('dropdown max-height is in the required 350–450px band',
    maxH >= 350 && maxH <= 450, `maxHeight = ${maxH}px`);

  const rows = panel ? panel.querySelectorAll('[role="option"]') : [];
  ok('ALL 5 vehicles are rendered (was clipping after 1)', rows.length === 5,
    `rendered ${rows.length} of 5`);

  const list = panel ? panel.querySelector('[role="listbox"]') : null;
  ok('the row list scrolls internally when it overflows',
    !!list && /auto|scroll/.test(list.className) === true);

  // Search must match ENGINE NUMBER (Issue 1) — previously absent from the haystack.
  type(vehInput, 'REVO9988776');
  const p2 = document.querySelector('[data-searchselect-panel]');
  const r2 = p2 ? [...p2.querySelectorAll('[role="option"]')] : [];
  ok('vehicle search matches ENGINE NUMBER', r2.length === 1 && /Altroz/.test(r2[0].textContent),
    `matched ${r2.length}: ${r2.map((r) => r.textContent).join(' | ')}`);

  type(vehInput, 'ap18');
  const r3 = [...document.querySelectorAll('[data-searchselect-panel] [role="option"]')];
  ok('vehicle search matches REG NO, case-insensitively', r3.length === 1 && /Grand i10/.test(r3[0].textContent),
    `matched ${r3.length}`);

  type(vehInput, 'nios');
  const r4 = [...document.querySelectorAll('[data-searchselect-panel] [role="option"]')];
  ok('vehicle search matches MODEL (partial)', r4.length === 1, `matched ${r4.length}`);

  // Keyboard (Issue 5)
  type(vehInput, '');
  key(vehInput, 'ArrowDown');
  key(vehInput, 'Enter');
  const p5 = document.querySelector('[data-searchselect-panel]');
  ok('Enter selects and closes the dropdown', !p5);
}

// --- Job card dropdown ----------------------------------------------------
{
  clear();
  mount({
    initial: baseInvoice(), invoices: [], customers: [CUSTOMER], inventory: [PART], jobCards: JOBCARDS,
    onSave: () => {}, onClose: () => {}, demoMode: true,
  });
  // The Job Card section is collapsed by default — expand it.
  const jcHeader = byText('button', /Job Card/i);
  if (jcHeader) click(jcHeader);
  const jcInput = [...q('input')].find((i) => /Search job no/i.test(i.placeholder || ''));
  ok('job card selector present', !!jcInput);
  if (jcInput) {
    focus(jcInput);
    ok('job card: focus alone does NOT open the dropdown (Issue 5)',
      !document.querySelector('[data-searchselect-panel]'));
    click(jcInput);
    const panel = document.querySelector('[data-searchselect-panel]');
    ok('job card dropdown is portalled to <body>', !!panel && panel.parentElement === document.body);
    const rows = panel ? panel.querySelectorAll('[role="option"]') : [];
    ok('all 3 billable job cards listed', rows.length === 3, `rendered ${rows.length} of 3`);

    type(jcInput, 'sbbmc05');
    const r = [...document.querySelectorAll('[data-searchselect-panel] [role="option"]')];
    ok('job card search matches JOB NO, case-insensitively', r.length === 1 && /SBBMC05/.test(r[0].textContent),
      `matched ${r.length}`);

    type(jcInput, 'ready');
    const r2 = [...document.querySelectorAll('[data-searchselect-panel] [role="option"]')];
    ok('job card search matches STATUS', r2.length === 1 && /SBBMC09/.test(r2[0].textContent), `matched ${r2.length}`);

    type(jcInput, 'ts09');
    const r3 = [...document.querySelectorAll('[data-searchselect-panel] [role="option"]')];
    ok('job card search matches VEHICLE REG', r3.length === 1 && /SBBMC11/.test(r3[0].textContent), `matched ${r3.length}`);
  }
}

// ===========================================================================
console.log('\nISSUE 6 — MOUSE selection must work exactly like keyboard\n');
{
  clear();
  const picked = [];
  mount({
    initial: baseInvoice(), invoices: [], customers: [CUSTOMER], inventory: [PART], jobCards: JOBCARDS,
    onSave: () => {}, onClose: () => {}, demoMode: true,
  });

  // --- MOUSE: click a vehicle row. Previously the row scrolled itself into view on
  // hover, moved out from under the pointer between mousedown and mouseup, and the
  // browser never fired `click` — so nothing was selected.
  const vehInput = [...q('input')].find((i) => /Search model, reg no/i.test(i.placeholder || ''));
  click(vehInput);
  let rows = [...document.querySelectorAll('[data-searchselect-panel] [role="option"]')];
  ok('vehicle list open with all 5 rows', rows.length === 5, `got ${rows.length}`);

  const target = rows.find((r) => /Altroz/.test(r.textContent));
  // hover first (this is what used to break it), then click
  act(() => { target.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true })); });
  act(() => { target.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: true })); });
  click(target);

  ok('MOUSE click selects the vehicle (was: nothing happened)',
    !document.querySelector('[data-searchselect-panel]'),
    'the dropdown is still open — the click did not select');

  const regField = [...q('input')].find((i) => (i.value || '') === 'KA05MN9090');
  ok('…and the clicked vehicle is the one that landed in the form',
    !!regField,
    'reg no field does not hold KA05MN9090');

  // --- KEYBOARD: same list, same outcome.
  clear();
  mount({
    initial: baseInvoice(), invoices: [], customers: [CUSTOMER], inventory: [PART], jobCards: JOBCARDS,
    onSave: () => {}, onClose: () => {}, demoMode: true,
  });
  const vi2 = [...q('input')].find((i) => /Search model, reg no/i.test(i.placeholder || ''));
  click(vi2);
  key(vi2, 'ArrowDown');
  key(vi2, 'ArrowDown');
  key(vi2, 'Enter');
  ok('KEYBOARD Enter selects too (unchanged)',
    !document.querySelector('[data-searchselect-panel]'));

  // --- Escape closes
  clear();
  mount({
    initial: baseInvoice(), invoices: [], customers: [CUSTOMER], inventory: [PART], jobCards: JOBCARDS,
    onSave: () => {}, onClose: () => {}, demoMode: true,
  });
  const vi3 = [...q('input')].find((i) => /Search model, reg no/i.test(i.placeholder || ''));
  click(vi3);
  ok('dropdown open before Escape', !!document.querySelector('[data-searchselect-panel]'));
  key(vi3, 'Escape');
  ok('Escape closes the dropdown', !document.querySelector('[data-searchselect-panel]'));
}

// ===========================================================================
console.log('\nISSUE 4 — focus trap\n');
{
  installGlobalFocusTrap();
  document.body.innerHTML = `
    <button id="outside-before">sidebar</button>
    <div class="fixed inset-0" style="z-index:130">
      <button id="m1">first</button>
      <input id="m2" />
      <button id="m3">last</button>
    </div>
    <button id="outside-after">other page button</button>
  `;
  // MutationObserver callbacks are async — let the trap see the new DOM.
  await new Promise((r) => setTimeout(r, 0));
  const overlay = topmostOverlay();
  ok('topmost overlay is detected', !!overlay && overlay.classList.contains('fixed'));

  const items = focusablesIn(overlay);
  ok('focusables inside the overlay are found (3)', items.length === 3, `found ${items.length}`);
  ok('focusables EXCLUDE the page behind',
    !items.some((el) => el.id.startsWith('outside')));

  const first = document.getElementById('m1');
  const last = document.getElementById('m3');

  // Tab from the LAST element must wrap to the FIRST, not escape to #outside-after.
  last.focus();
  const ev = new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  document.dispatchEvent(ev);
  ok('Tab on the last element wraps to the first (does not escape)',
    document.activeElement === first,
    `focus landed on #${document.activeElement && document.activeElement.id}`);

  // Shift+Tab from the FIRST must wrap to the LAST.
  first.focus();
  const ev2 = new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
  document.dispatchEvent(ev2);
  ok('Shift+Tab on the first element wraps to the last',
    document.activeElement === last,
    `focus landed on #${document.activeElement && document.activeElement.id}`);

  ok('overlay is stamped with role=dialog / aria-modal',
    overlay.getAttribute('role') === 'dialog' && overlay.getAttribute('aria-modal') === 'true');
}

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
}
main();
