/**
 * tests/billing-overpayment-lock.test.cjs
 *
 * BUG-LIVE-002 regression. On the deployed app: a ₹200 invoice, pay ₹201 →
 * the save was correctly blocked and "Overpaid by ₹1" was shown, BUT the header
 * still flipped to a green "Paid · Locked" badge and the whole editor went
 * read-only, so the operator could not even correct the amount down.
 *
 * Two defects fed this:
 *   A. deriveStatus() returned 'Paid' for an overpaid invoice, because t.balance
 *      is floored to 0 by Math.max(0, grand - paid).
 *   B. `locked` / `savedStatus` keyed on `!!inv.invNo` — but every entry point
 *      pre-allocates an invoice number before the modal opens, so a brand-new
 *      unsaved invoice already has a truthy invNo. It must key on actual
 *      persistence (`isPersisted`) instead.
 *
 * Also covers the payment-state matrix: ₹100 → Partially Paid, ₹200 → Paid,
 * ₹201 / ₹999990 → NOT Paid.
 */
require('./setup.cjs');
const fs = require('fs');
const path = require('path');
const { totalsOf, deriveStatus } = require('../components/billing/BillingModule.jsx');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};

console.log('\nBUG-LIVE-002 — overpayment must not read as Paid / Locked\n');

// A ₹200 grand-total invoice: one labour line, no GST.
const base = {
  id: 'i1', invNo: 'INV-0297', date: '2026-08-30',
  customerId: '', customer: 'QA Test Customer', phone: '', gstNo: '',
  lines: [{ id: 'l1', kind: 'Labour', partId: '', desc: 'QA Service', qty: 1, rate: 200, disc: 0, gst: 0, cost: 0, hsn: '' }],
  payments: [], paid: 0, status: 'Draft', isEstimate: false, discount: 0, gstMode: 'CGST + SGST', history: [],
};
const withPay = (amount) => ({ ...base, payments: amount ? [{ id: 'p1', mode: 'Cash', amount, ref: '', at: Date.now() }] : [] });

ok('fixture grand total is ₹200', totalsOf(base).grand === 200, `grand = ${totalsOf(base).grand}`);

// ---- deriveStatus matrix (defect A) --------------------------------------
ok('₹0 paid  → not Paid', deriveStatus(withPay(0)) !== 'Paid', deriveStatus(withPay(0)));
ok('₹100 paid → Partially Paid', deriveStatus(withPay(100)) === 'Partially Paid', deriveStatus(withPay(100)));
ok('₹200 paid → Paid', deriveStatus(withPay(200)) === 'Paid', deriveStatus(withPay(200)));
ok('₹201 paid → NOT Paid (overpaid by ₹1)', deriveStatus(withPay(201)) !== 'Paid', deriveStatus(withPay(201)));
ok('₹999990 paid → NOT Paid (gross overpayment)', deriveStatus(withPay(999990)) !== 'Paid', deriveStatus(withPay(999990)));

// balance/paid stay consistent regardless of status
const t201 = totalsOf(withPay(201));
ok('overpaid: paid reflects the real ₹201, balance floored at 0', t201.paid === 201 && t201.balance === 0);
const t999990 = totalsOf(withPay(999990));
ok('gross overpaid: paid ₹999990, balance 0 (never negative)', t999990.paid === 999990 && t999990.balance === 0);

// ---- lock keys on persistence, not on a pre-allocated number (defect B) ---
const src = fs.readFileSync(path.resolve(__dirname, '../components/billing/BillingModule.jsx'), 'utf8');
ok('savedStatus keys on isPersisted, not inv.invNo',
  /const savedStatus = isPersisted \? deriveStatus\(inv\) : null;/.test(src) &&
  !/const savedStatus = inv\.invNo \? deriveStatus/.test(src));
ok('locked keys on isPersisted, not !!inv.invNo',
  /const locked = !inv\.isEstimate && isPersisted && \[/.test(src));
ok('deriveStatus has an explicit overpaid guard before the Paid branch',
  /t\.paid > t\.grand \+ 0\.5\) return 'Partially Paid'/.test(src));

// ---- render: a NEW (unsaved) overpaid invoice is not locked ---------------
const React = require('react');
const { act } = require('react');
const { createRoot } = require('react-dom/client');
const { InvoiceModal } = require('../components/billing/BillingModule.jsx');
const { ConfirmHost } = require('../components/common/ConfirmDialog.jsx');

const host = document.createElement('div');
document.body.appendChild(host);
let crashed = null;
try {
  act(() => {
    createRoot(host).render(React.createElement(React.Fragment, null,
      // invNo is set (pre-allocated) AND already overpaid, but NOT in `invoices` → new/unsaved.
      React.createElement(InvoiceModal, {
        initial: withPay(999990),
        invoices: [], customers: [], inventory: [], jobCards: [],
        onSave: () => {}, onClose: () => {}, demoMode: true,
      }),
      React.createElement(ConfirmHost, null),
    ));
  });
} catch (e) { crashed = e; }
ok('InvoiceModal renders a new overpaid invoice without crashing', !crashed, crashed && crashed.message);

// InvoiceModal renders into a body-level portal, so query the document, not `host`.
const bodyText = document.body.textContent || '';
const btnLabels = [...document.querySelectorAll('button')].map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim());
ok('header does NOT show a "Paid · Locked" badge for a new unsaved invoice',
  !/Paid\s*[·.]\s*Locked/.test(bodyText),
  'the editor treated a pre-allocated invoice number as "saved"');
ok('the editor is still editable — Save / Save & Collect buttons are present',
  btnLabels.some((l) => /^Save$/.test(l)) && btnLabels.some((l) => /Save\s*&\s*Collect/i.test(l)),
  `buttons: ${JSON.stringify(btnLabels)}`);
ok('the editor is NOT in read-only mode (no Credit Note / locked banner)',
  !btnLabels.some((l) => /^Credit Note$/.test(l)) && !/locked as history/i.test(bodyText),
  `buttons: ${JSON.stringify(btnLabels)}`);
ok('a "New Invoice" header (not "Edit") is shown for the unsaved invoice',
  /New Invoice/.test(bodyText) && !/Edit INV-0297/.test(bodyText));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
