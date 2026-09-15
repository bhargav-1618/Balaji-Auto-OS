/**
 * tests/invoice-savedstatus-not-draft.test.cjs
 *
 * BUG-LIVE-P1-03 regression guard — "Invoice Edit screen falsely transitions to
 * 'Paid · Locked' before save."
 *
 * BillingModule's InvoiceModal used to compute `savedStatus = deriveStatus(inv)`,
 * where `inv` is the LIVE, UNSAVED DRAFT the user is currently editing (payments
 * included). So typing a payment amount that brought the DRAFT's balance to zero
 * flipped `locked` to true and hid Save immediately — before anything was written.
 * A reload correctly showed the invoice still unpaid, because nothing had been
 * persisted; "saved status" must mean the PERSISTED record's status, not the
 * draft's.
 *
 * The fix: `savedStatus` is now derived from the invoice looked up in the
 * `invoices` list (the same list `isPersisted` already checks), not from `inv`.
 */
const fs = require('fs');
const path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };

const src = fs.readFileSync(path.resolve(__dirname, '../components/billing/BillingModule.jsx'), 'utf8');

console.log("\nInvoice editor — 'Paid · Locked' must reflect the persisted record, not the live draft\n");

// ── 1. Source shape: savedStatus must be derived from a persisted lookup, not `inv`. ──
ok('savedStatus is looked up from the persisted invoices list, not the live draft `inv`',
  /const persistedInvoice = isPersisted \? invoices\.find\(\(x\) => x\.id === initial\.id\) : null;\s*\n\s*const savedStatus = persistedInvoice \? deriveStatus\(persistedInvoice\) : null;/.test(src));
ok('the old draft-derived savedStatus computation is gone',
  !/const savedStatus = isPersisted \? deriveStatus\(inv\) : null;/.test(src));
ok('`locked` still gates on isPersisted + the persisted status (unchanged downstream contract)',
  /const locked = !inv\.isEstimate && isPersisted && \['Paid', 'Cancelled', 'Refunded', 'Returned'\]\.includes\(savedStatus\);/.test(src));

// ── 2. Behavioural mirror of invoiceStatus's decision tree (services/billingService.js),
//    parametrized directly on {grand, paid} so this doesn't need the full GST engine. ──
function deriveStatus({ grand, paid, status, isEstimate }) {
  const NON_REALIZING = ['Cancelled', 'Refunded', 'Returned'];
  if (NON_REALIZING.includes(status)) return status;
  if (isEstimate) return 'Estimate';
  if (grand > 0 && paid > grand + 0.5) return 'Partially Paid';
  if (grand - paid <= 0 && grand > 0) return 'Paid';
  if (paid > 0) return 'Partially Paid';
  return status === 'Draft' ? 'Draft' : 'Unpaid';
}
const isLocked = (savedStatus, isEstimate, isPersisted) =>
  !isEstimate && isPersisted && ['Paid', 'Cancelled', 'Refunded', 'Returned'].includes(savedStatus);

// The exact repro: an invoice is persisted at Unpaid (grand=1000, paid=0). The user,
// mid-edit, types a payment of 1000 into the LIVE DRAFT — but has not clicked Save.
const persisted = { grand: 1000, paid: 0, status: 'Unpaid', isEstimate: false };
const draftWithTypedPayment = { grand: 1000, paid: 1000, status: 'Unpaid', isEstimate: false };

const oldBuggySavedStatus = deriveStatus(draftWithTypedPayment); // the OLD (wrong) source
const fixedSavedStatus = deriveStatus(persisted); // the NEW (correct) source

ok('OLD behaviour would have reproduced the bug (draft-derived status reads Paid before save)',
  oldBuggySavedStatus === 'Paid' && isLocked(oldBuggySavedStatus, false, true) === true);
ok('FIXED behaviour: status derived from the PERSISTED record stays Unpaid before save',
  fixedSavedStatus === 'Unpaid');
ok('FIXED behaviour: the editor is NOT locked while the payment is still only a draft',
  isLocked(fixedSavedStatus, false, true) === false);

// After a real save, the persisted record itself now has paid=1000 — status must
// correctly flip to Paid and the editor correctly locks.
const afterSave = { grand: 1000, paid: 1000, status: 'Unpaid', isEstimate: false };
ok('after an ACTUAL save, the persisted record correctly derives Paid',
  deriveStatus(afterSave) === 'Paid');
ok('...and the editor correctly locks once the record is genuinely persisted as Paid',
  isLocked(deriveStatus(afterSave), false, true) === true);

// Partial payment must never falsely lock, whether as a draft or once persisted.
const partial = { grand: 1000, paid: 400, status: 'Unpaid', isEstimate: false };
ok('a partial payment never locks the editor (draft or persisted)',
  isLocked(deriveStatus(partial), false, true) === false);

// A brand-new, never-saved invoice must never show as locked, regardless of its
// draft totals (isPersisted gates this independently of savedStatus).
ok('a brand-new unsaved invoice is never locked, even if its draft happens to balance to zero',
  isLocked(deriveStatus(draftWithTypedPayment), false, false) === false);

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
