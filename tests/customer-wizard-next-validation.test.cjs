/**
 * tests/customer-wizard-next-validation.test.cjs
 *
 * BUG-LIVE-003 regression. On the deployed app: open "Add New Customer", leave the
 * Basic Info fields empty, click "Next" → the wizard advanced straight to the
 * Vehicles step with no validation. Root cause: the Next button was a bare
 * setStep(s + 1); validate() only ran on Save.
 *
 * The fix gates the Basic-Info step (the only step with hard-required fields):
 * an invalid Basic Info now keeps the wizard on step 0 and reveals the errors.
 * Later steps stay freely navigable (Save still runs the full validate()).
 */
require('./setup.cjs');
const fs = require('fs');
const path = require('path');
const React = require('react');
const { act } = require('react');
const { createRoot } = require('react-dom/client');
const { toasts, clear } = require('./setup.cjs');
const { CustomerWizard, emptyCustomer } = require('../components/customers/CustomersModule.jsx');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const q = (sel) => [...document.querySelectorAll(sel)];
const byText = (sel, re) => q(sel).find((e) => re.test(e.textContent || ''));
function type(el, value) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
  act(() => { setter.call(el, value); el.dispatchEvent(new window.Event('input', { bubbles: true })); });
}
function click(el) { act(() => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); }); }

function render() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    createRoot(host).render(React.createElement(CustomerWizard, {
      initial: emptyCustomer(),
      existing: [{ id: 'c9', name: 'Existing Person', phone: '9876500000', code: 'CUS-09' }],
      canManage: true,
      onSave: (c) => saved.push(c),
      onClose: () => {},
      demoMode: true,
    }));
  });
  return host;
}
const saved = [];

console.log('\nBUG-LIVE-003 — customer wizard "Next" validation\n');

// static: Next is wired to the gated handler, not a bare setStep
const src = fs.readFileSync(path.resolve(__dirname, '../components/customers/CustomersModule.jsx'), 'utf8');
ok('the Next button calls goNext (not a bare setStep(s + 1))',
  /onClick=\{goNext\}/.test(src) && !/onClick=\{\(\) => setStep\(\(s\) => s \+ 1\)\}/.test(src));
ok('goNext validates the Basic Info step before advancing',
  /const goNext = \(\) => \{[\s\S]{0,200}if \(step === 0\) \{[\s\S]{0,200}validateBasic\(\)/.test(src));
ok('validateBasic still requires name and a valid mobile (not weakened)',
  /f\.name\.trim\(\)\.length < 3/.test(src) && /!f\.phone \|\| phoneErr/.test(src) && /dupPhone/.test(src));

// behavioural
clear();
let host = render();

const stepText = () => document.body.textContent || '';
ok('wizard opens on Basic Info', /Basic Information/.test(stepText()));

const nextBtn = byText('button', /^Next$/);
ok('Next button exists', !!nextBtn);

// 1. empty Basic Info → click Next → must stay on Basic Info + show validation
click(nextBtn);
ok('empty required fields: wizard stays on Basic Info (does not reach Vehicles)',
  /Basic Information/.test(stepText()) && !/No vehicles yet\. Click Add Vehicle/.test(stepText()),
  'wizard advanced to Vehicles with empty Basic Info');
ok('a validation error is surfaced',
  toasts.some((t) => t.level === 'error') ||
  q('*').some((e) => /must be at least 3 characters|primary mobile is required/i.test(e.textContent || '')),
  `toasts: ${JSON.stringify(toasts)}`);

// 2. fill valid Basic Info → Next must now advance to Vehicles
const nameInput = q('input').find((i) => /customer name/i.test(i.previousElementSibling?.textContent || '') || i === q('input')[1]);
// robust: the first text input in the Basic Info step body is the name after Customer ID controls;
// find by placeholder used in the shipped component
const nameByPh = q('input').find((i) => /enter customer name/i.test(i.placeholder || ''));
type(nameByPh, 'Valid QA Customer');
const phoneInput = q('input').find((i) => /10 digit number|enter 10 digit/i.test(i.placeholder || ''));
type(phoneInput, '9811122233');
clear();
click(byText('button', /^Next$/));
ok('valid Basic Info: Next advances to the Vehicles step',
  /No vehicles yet\. Click Add Vehicle/.test(stepText()) || /Vehicles \(0\)/.test(stepText()),
  `did not advance. body: ${stepText().slice(0, 120)}`);
ok('no spurious validation error on a valid step',
  !toasts.some((t) => t.level === 'error'));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
