/**
 * tests/invoice-prefill.test.cjs — PART-4
 *
 * The "Vehicle → Create Invoice" cross-module handoff. Vehicles/Customers WRITE a prefill
 * to localStorage and switch to Billing; Billing must READ it and open a populated invoice.
 * This was broken — Billing never read the key — so the flow produced a blank invoice.
 * These are source guards (the wiring lives in JSX we can't execute headless).
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nPART-4 — Create-Invoice cross-module prefill\n');

const dash = read('components/InventoryDashboard.js');
const billing = read('components/billing/BillingModule.jsx');
const vehicleSvc = read('services/vehicleService.js');

// WRITE side: the shared helper writes the prefill including the vehicle registration.
// H-5C: the field mapping itself was extracted to services/vehicleService.js's
// buildInvoicePrefillFields (pure customer+vehicle -> prefill mapper).
const hi = dash.indexOf('const writeInvoicePrefill = (c, token) =>');
const helper = hi >= 0 ? dash.slice(hi, hi + 400) : '';
ok('shared writeInvoicePrefill helper exists (used by Customers + Vehicles)', helper.length > 0);
ok('writeInvoicePrefill delegates to the shared buildInvoicePrefillFields mapper', /buildInvoicePrefillFields\(c, v\)/.test(helper));
const fi = vehicleSvc.indexOf('export function buildInvoicePrefillFields');
const fields = fi >= 0 ? vehicleSvc.slice(fi, fi + 400) : '';
ok('prefill write includes regNo', /regNo:/.test(fields), 'mapper missing regNo');
ok('prefill write includes the customer', /customer:/.test(fields));
ok('prefill write includes the phone', /phone:/.test(fields));
ok('both modules call the shared helper', (dash.match(/writeInvoicePrefill\(c/g) || []).length >= 2);

// READ side: Billing must consume and then clear the key.
ok('Billing READS the prefill (was the bug — it never did)',
  /getItem\('maruti_invoice_prefill'\)/.test(billing));
ok('Billing opens the editor from the prefill (setEdit with customer)',
  /setEdit\(\{[\s\S]*?customer: pf\.customer/.test(billing));
ok('Billing carries the registration into the invoice',
  /regNo: pf\.regNo/.test(billing));
ok('Billing clears the prefill so it fires once',
  /removeItem\('maruti_invoice_prefill'\)/.test(billing));
ok('the prefilled invoice gets a real invoice number, not blank',
  /invNo: nextInvNo\(invoices/.test(billing));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
