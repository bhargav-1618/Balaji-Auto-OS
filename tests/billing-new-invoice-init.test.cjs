/**
 * tests/billing-new-invoice-init.test.cjs
 *
 * BUG-LIVE-004 regression. On the deployed app, clicking "New Invoice" opened an
 * editor titled "Edit INV-0297" — reading as though an existing invoice was being
 * edited. Investigation: the invoice DATA is genuinely clean (fresh id, blank
 * customer, no line items, ₹0) and the number is correctly the next in sequence —
 * the number is just pre-allocated so a save lands on it. The defect was the
 * header label: it said "Edit <number>" whenever inv.invNo was truthy, which is
 * always true at this entry point.
 *
 * Guards: emptyInvoice() always mints a fresh unique id and blank state; the
 * header distinguishes a new (unsaved) invoice from a persisted one; a stale
 * autosaved draft is only ever restored for an id that is NOT persisted AND
 * matches exactly (so "New Invoice" never resurrects someone else's draft).
 */
require('./setup.cjs');
const fs = require('fs');
const path = require('path');
const { emptyInvoice, nextInvNo, totalsOf } = require('../components/billing/BillingModule.jsx');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};

console.log('\nBUG-LIVE-004 — New Invoice starts clean\n');

// ---- emptyInvoice(): a genuinely fresh, blank invoice every time ----------
const a = emptyInvoice();
const b = emptyInvoice();
ok('every emptyInvoice() has a unique id', a.id !== b.id, `${a.id} === ${b.id}`);
ok('id is namespaced and non-guessable', /^inv_\d+_\d+$/.test(a.id), a.id);
ok('no invoice number is pre-baked into emptyInvoice itself', a.invNo === '');
ok('no customer', !a.customerId && !a.customer && !a.phone);
ok('status is Draft, not paid/settled', a.status === 'Draft' && a.paid === 0 && a.isEstimate === false);
ok('no payments', Array.isArray(a.payments) && a.payments.length === 0);
ok('starts with exactly one blank line, total ₹0',
  a.lines.length === 1 && totalsOf(a).grand === 0,
  `lines=${a.lines.length} grand=${totalsOf(a).grand}`);

// ---- nextInvNo: New Invoice gets the NEXT number, never an existing one ---
const existing = Array.from({ length: 296 }, (_, i) => ({ invNo: `INV-${String(i + 1).padStart(4, '0')}` }));
const next = nextInvNo(existing, 'INV');
ok('nextInvNo returns INV-0297 for a book of 296', next === 'INV-0297', next);
ok('nextInvNo never collides with an existing number',
  !existing.some((x) => x.invNo === next));

// ---- header label distinguishes new vs. persisted ------------------------
const src = fs.readFileSync(path.resolve(__dirname, '../components/billing/BillingModule.jsx'), 'utf8');
ok('editor header keys the "Edit" label on isPersisted, not inv.invNo',
  /isPersisted \? `Edit \$\{inv\.invNo\}` : \(inv\.invNo \? `New Invoice · \$\{inv\.invNo\}` : 'New Invoice'\)/.test(src) &&
  !/\{inv\.invNo \? `Edit \$\{inv\.invNo\}` : 'New Invoice'\}/.test(src));

// ---- draft restore (Phase 5b: static key, adopts the draft's own id) ----
ok('autosaved-draft restore is skipped when editing a persisted invoice', /if \(isPersisted\) return;\s*\n\s*try \{\s*\n\s*const d = JSON\.parse\(localStorage\.getItem\(DRAFT_KEY\)/.test(src));
ok('a drafted invoice that already committed is cleared, not re-restored',
  /if \(invoices\.some\(\(x\) => x\.id === d\.id\)\) \{ clearInvDraft\(\); return; \}/.test(src));
ok('the invoice draft key is static (survives a browser refresh) — Phase 5b PH5-01',
  /const DRAFT_KEY = `maruti_invoice_draft_v2_/.test(src)
  && !/const DRAFT_KEY = `maruti_invoice_draft_\$\{initial\.id\}`/.test(src));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
