/**
 * tests/concurrency-record-sync.test.cjs
 *
 * CONCURRENCY PHASE 1c — live record-update / conflict UX.
 *
 * Phase 1a (`_rev` guarded transaction) is still the data-integrity authority and
 * Phase 1b (the edit lease) still decides who edits. Phase 1c is the UX layer: while
 * a record is open in a viewer or an editor, watch the ACTUAL record document and
 * tell the open UI when another session changed it — so the user learns immediately,
 * never loses unsaved work, and never has to refresh.
 *
 * Covers the spec's automated cases A–M plus the "never force-close a viewer" invariant.
 */
require('./setup.cjs');
const fs = require('fs');
const path = require('path');

const { recordSyncState, rebaseRecord, fieldsEqual } = require('../lib/recordSync');
const { revOf } = require('../lib/concurrency');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');

console.log('\nCONCURRENCY PHASE 1c — live record update + conflict UX\n');

// ── recordSyncState — the pure state machine ────────────────────────────────
ok('A/D: a server rev BEYOND the acknowledged baseline → "updated"',
  recordSyncState(3, { exists: true, _rev: 4 }) === 'updated');
ok('B/C: the SAME rev (cancel / no-op) → "current" — no notification',
  recordSyncState(3, { exists: true, _rev: 3 }) === 'current');
ok('a missing _rev reads as revision 0',
  recordSyncState(0, { exists: true }) === 'current' && recordSyncState(0, { exists: true, _rev: 1 }) === 'updated');
ok('G: a deleted document → "deleted"',
  recordSyncState(3, { exists: false }) === 'deleted');
ok('a listener error (null) infers nothing → "current"',
  recordSyncState(3, null) === 'current');
ok('L: idempotent — the same live value in always yields the same status (no duplicate notification)',
  recordSyncState(3, { exists: true, _rev: 4 }) === recordSyncState(3, { exists: true, _rev: 4 }));

// ── rebaseRecord — "keep my changes" (spec §6) ─────────────────────────────
{
  const opened = { name: 'Ravi', phone: '900', address: 'Old', _rev: 5 };
  const local = { name: 'Ravi', phone: '9876543210', address: 'New Address', _rev: 5 };   // I changed phone + address
  const latest = { name: 'Updated Customer', phone: '900', address: 'Old', _rev: 6 };       // they changed name
  const { merged, conflicts } = rebaseRecord(opened, local, latest, { keys: ['name', 'phone', 'address'] });
  ok('§4: my non-conflicting field changes are re-applied onto the latest record',
    merged.phone === '9876543210' && merged.address === 'New Address');
  ok('§4: the other user\'s change on a field I did not touch is KEPT (not clobbered)',
    merged.name === 'Updated Customer');
  ok('the merged record adopts the LATEST revision as the new expected _rev',
    revOf(merged) === 6);
  ok('no conflicts when the two sides changed different fields',
    conflicts.length === 0);
}
{
  const opened = { title: 'A', _rev: 1 };
  const local = { title: 'MINE', _rev: 1 };
  const latest = { title: 'THEIRS', _rev: 2 };
  const { merged, conflicts } = rebaseRecord(opened, local, latest, { keys: ['title'] });
  ok('BOTH sides changed the same field → an explicit CONFLICT, never auto-resolved',
    conflicts.length === 1 && conflicts[0].key === 'title' && conflicts[0].mine === 'MINE' && conflicts[0].theirs === 'THEIRS');
  ok('a conflicted field keeps THEIRS in the merged draft until the user picks',
    merged.title === 'THEIRS');
}
{
  // Arrays / objects are one whole conflict unit — no element-level merge.
  const opened = { vehicles: [{ id: 'v1' }], _rev: 1 };
  const local = { vehicles: [{ id: 'v1' }, { id: 'v2' }], _rev: 1 };
  const latest = { vehicles: [{ id: 'v1' }, { id: 'v3' }], _rev: 2 };
  const { conflicts } = rebaseRecord(opened, local, latest, { keys: ['vehicles'] });
  ok('a structured field changed on both sides is ONE conflict (whole array), not merged element-by-element',
    conflicts.length === 1 && Array.isArray(conflicts[0].mine) && Array.isArray(conflicts[0].theirs));
}
ok('fieldsEqual is loose for primitives ("100" === 100) and empty-ish ("" === null)',
  fieldsEqual('100', 100) && fieldsEqual('', null) && fieldsEqual(' x ', 'x') && !fieldsEqual('a', 'b'));
ok('fieldsEqual deep-compares objects/arrays',
  fieldsEqual({ a: 1, b: [2, 3] }, { b: [2, 3], a: 1 }) && !fieldsEqual([1, 2], [2, 1]));

// ── lib/recordSync — watches the RECORD, not the lease ─────────────────────
const lib = read('../lib/recordSync.js');
ok('observeRecord is a live onSnapshot on the collection document',
  /export function observeRecord[\s\S]{0,200}return onSnapshot\([\s\S]{0,120}doc\(db, collectionName, String\(docId\)\)/.test(lib));
ok('H/I/§13: it watches the RECORD document — it imports nothing from lib/editLease',
  !/editLease|editLocks|acquireLease|renewLease/.test(lib));
ok('it reuses revOf from lib/concurrency (not a re-implementation)',
  /import \{ revOf \} from '\.\/concurrency'/.test(lib));

// ── hooks/useRecordSync ───────────────────────────────────────────────────
const hook = read('../hooks/useRecordSync.js');
ok('inert in demo mode / without a docId (no listener, always "current")',
  /const active = !demoMode && !!docId;/.test(hook)
  && /const status = active \? recordSyncState\(baselineRef\.current, live\) : 'current';/.test(hook));
ok('M: the observe effect returns the observeRecord unsubscribe (listener cleanup)',
  /useEffect\(\(\) => \{[\s\S]{0,200}return observeRecord\(collectionName, docId, setLive\);/.test(hook));
ok('markSynced advances the acknowledged baseline (own save / "view updated") — no self-alarm (§13)',
  /const markSynced = useCallback\(\(rev\) => \{[\s\S]{0,200}baselineRef\.current = rev;[\s\S]{0,160}baselineRef\.current = revOf\(live\)/.test(hook));
ok('watches the record doc, never the lease — imports nothing from useEditLease',
  !/useEditLease|editLease|acquireLease/.test(hook));

const relToast = read('../hooks/useLeaseReleaseToast.js');
ok('J/§12: "editing available" toast fires only on the held→available transition (dedup via a prev-value ref)',
  /prev\.current === 'held' && leaseStatus === 'available'/.test(relToast)
  && /toast\.success\('✅ This record is now available to edit\.'\)/.test(relToast)
  && /prev\.current = leaseStatus;/.test(relToast));

// ── shared components — exact spec strings (§16) ───────────────────────────
const notice = read('../components/common/RecordUpdatedNotice.jsx');
ok('RecordUpdatedNotice — "Record updated / This record was updated by another user." + [View Updated Record]',
  /Record updated/.test(notice) && /This record was updated by another user\./.test(notice) && /View Updated Record/.test(notice));
ok('RecordUpdatedNotice — deleted: "Record deleted / Another user deleted this record."',
  /Record deleted/.test(notice) && /Another user deleted this record\./.test(notice));
ok('RecordUpdatedNotice — role="status", not colour-only (icon + text), returns null when current',
  /role="status"/.test(notice) && /RefreshCw|Trash2/.test(notice) && /if \(status !== 'updated' && status !== 'deleted'\) return null;/.test(notice));

const conflictBanner = read('../components/common/RecordConflictBanner.jsx');
ok('RecordConflictBanner — "Updated elsewhere / Another user changed this record while you were working." + [Review Latest]',
  /Updated elsewhere/.test(conflictBanner) && /Another user changed this record while you were working\./.test(conflictBanner) && /Review Latest/.test(conflictBanner));
ok('RecordConflictBanner — deleted: "Your changes were not saved." + [Close]',
  /Your changes were not saved\./.test(conflictBanner) && /Close\s*<\/button>/.test(conflictBanner) && /onClose/.test(conflictBanner));

const dialog = read('../components/common/ConflictReviewDialog.jsx');
ok('ConflictReviewDialog — rebase mode: [Keep my changes] disabled until every conflict is picked',
  /const allConflictsPicked = conflicts\.every\(\(c\) => picks\[c\.key\] === 'mine' \|\| picks\[c\.key\] === 'theirs'\);/.test(dialog)
  && /disabled=\{!allConflictsPicked\}/.test(dialog));
ok('ConflictReviewDialog — review mode: [Load the latest version] / [Keep editing mine] (no auto-merge)',
  /Load the latest version/.test(dialog) && /Keep editing mine/.test(dialog));
ok('ConflictReviewDialog — portaled to document.body (escapes <main> stacking context), Escape closes',
  /import \{ createPortal \} from 'react-dom'/.test(dialog) && /return createPortal\(/.test(dialog) && /\n\s*document\.body,\n\s*\);/.test(dialog) && /e\.key === 'Escape'/.test(dialog));

const avail = read('../components/common/EditAvailableBar.jsx');
ok('EditAvailableBar — "✅ Editing available" + an [Edit] button that runs an authoritative acquire',
  /Editing available/.test(avail) && /This record is now available to edit\./.test(avail) && /onEdit/.test(avail));

// ── wiring — every module mounts useRecordSync + the shared components ─────
const cust = read('../components/customers/CustomersModule.jsx');
const dash = read('../components/InventoryDashboard.js');
const bill = read('../components/billing/BillingModule.jsx');
const jc = read('../components/jobcards/JobCardModule.jsx');

ok('Customers — useRecordSync on the open customer + RecordUpdatedNotice on the detail panel',
  /const recordSync = useRecordSync\('customers', watchedCustId, watchedCustRev\)/.test(cust)
  && /<RecordUpdatedNotice status=\{recordSync\.status\} onAcknowledge=\{\(\) => recordSync\.markSynced\(\)\}/.test(cust)
  && /useLeaseReleaseToast\(lease\.status\)/.test(cust));
ok('Customers — field-level rebase (mode="rebase"): CustomerWizard exposes its form via formValuesRef, ConflictReviewDialog wired',
  /useEffect\(\(\) => \{ if \(formValuesRef\) formValuesRef\.current = f; \}, \[f, formValuesRef\]\);/.test(cust)
  && /<ConflictReviewDialog[\s\S]{0,400}fields=\{CUSTOMER_CONFLICT_FIELDS\}[\s\S]{0,400}onKeepMine=/.test(cust));
ok('Customers — E: own save advances the baseline (recordSync.markSynced(fresh._rev)) so it does not self-alarm',
  /if \(fresh && Number\.isInteger\(fresh\._rev\)\) recordSync\.markSynced\(fresh\._rev\);/.test(cust));
// BUGFIX — a brand-new customer carries a client temp id (emptyCustomer()); record-sync
// must key on ACTUAL persisted-record membership, not id-truthiness, or useRecordSync
// subscribes to customers/<temp-id> which reads back as "deleted" and the new-customer
// wizard shows a false "🗑️ Record deleted" banner.
ok('Customers — new-customer bug fix: record-sync keyed on persisted membership, not id truthiness',
  /const isPersistedCust = useCallback\(\(id\) => !!id && customers\.some\(\(c\) => c\.id === id\), \[customers\]\);/.test(cust)
  && /const watchedCustId = isPersistedCust\(editCust && editCust\.id\) \? editCust\.id\s*\n?\s*: \(isPersistedCust\(selId\) \? selId : null\);/.test(cust));
ok('Customers — new-customer: no conflict banner + no review dialog for an unpersisted customer',
  /conflict=\{isPersistedCust\(editCust\.id\) \? \{ status: recordSync\.status/.test(cust)
  && /\{reviewOpen && isPersistedCust\(editCust && editCust\.id\) && recordSync\.latest && \(/.test(cust)
  && !/conflict=\{editCust\.id \? \{ status: recordSync\.status/.test(cust));   // the buggy form is gone
// BUG #2 — TEST 6: a stale Customer save was rejected + input preserved, but SILENT.
// saveCustomer's catch must surface the concurrency rejection like every other editor
// (which call concToast on isConcurrencyError), keeping the wizard open, no _rev bypass.
ok('Customers — stale save shows an explicit "changes not saved" message (BUG #2)',
  /import \{ revOf, isConcurrencyError, CONC_DELETED \} from '\.\.\/\.\.\/lib\/concurrency';/.test(cust)
  && /\} catch \(e\) \{[\s\S]{0,600}if \(isConcurrencyError\(e\)\) \{[\s\S]{0,200}This record was updated by another user\. Your changes were not saved\.[\s\S]{0,200}\}\s*else\s*\{/.test(cust));
// Phase 6b — the non-concurrency (ambiguous/timeout) branch used to do NOTHING:
// no toast, no signal the save might not have gone through. Now it always tells
// the user, distinguishing a genuine timeout from any other ambiguous failure.
ok('Customers — a non-concurrency save failure is no longer silent (Phase 6b)',
  /\} else \{[\s\S]{0,500}toast\.error\(isTxTimeout\(e\)[\s\S]{0,200}timeoutMessage\('This customer'\)[\s\S]{0,300}\}/.test(cust)
  && /import \{ isTxTimeout, timeoutMessage \} from '\.\.\/\.\.\/lib\/txTimeout';/.test(cust));
ok('Customers — stale save still keeps the wizard open + does not bypass _rev (unchanged)',
  // the guarded path is unchanged: onSaveCustomerEdit still runs with the opened _rev,
  // and the catch still `return`s BEFORE lease.release()/setEditCust(null) so nothing
  // typed is lost and no stale write happens. Phase 3b (CWF-03) — the payload dropped
  // panel-owned arrays (noteEntries/documents) + derived figures and passes clientBefore.
  /const fresh = await onSaveCustomerEdit\(\s*\{ \.\.\.wizardFields, history: hist \},\s*Number\.isInteger\(c\._rev\) && c\._rev >= 0 \? c\._rev : 0,\s*\{ clientBefore: existingCust \},\s*\);/.test(cust)
  && /\}\s*\n\s*return;\s*\n\s*\}\s*\n\s*lease\.release\(\);\s+\/\/ Phase 1b/.test(cust));

ok('Parts — useRecordSync + view-only mode + review dialog (mode="review")',
  /const partSync = useRecordSync\('parts',/.test(dash)
  && /const \[partViewOnly, setPartViewOnly\] = useState\(false\)/.test(dash)
  && /<ConflictReviewDialog\s*\n\s*mode="review"[\s\S]{0,300}fields=\{PART_CONFLICT_FIELDS\}/.test(dash)
  && /const claimPartEdit = useCallback\(async \(\) => \{/.test(dash));
ok('Suppliers — useRecordSync + view-only mode + review dialog',
  /const supplierSync = useRecordSync\('suppliers',/.test(dash)
  && /const \[supplierViewOnly, setSupplierViewOnly\] = useState\(false\)/.test(dash)
  && /fields=\{SUPPLIER_CONFLICT_FIELDS\}/.test(dash));
ok('Parts/Suppliers modals accept readOnly and wrap the body in a disabled <fieldset>',
  /function PartModal\([\s\S]{0,400}readOnly = false, banner = null/.test(dash)
  && /function SupplierModal\([\s\S]{0,200}readOnly = false, banner = null/.test(dash)
  && /<fieldset disabled=\{readOnly\}/.test(dash));

ok('Invoices — useRecordSync + view-only mode; the popup is NOT force-closed on a lost race',
  /const invoiceSync = useRecordSync\('invoices', isPersistedEdit \? edit\.id : null/.test(bill)
  && /const \[invoiceViewOnly, setInvoiceViewOnly\] = useState\(false\)/.test(bill)
  && /if \(!r\.ok\) \{ toast\.error\([^\n]*setInvoiceViewOnly\(true\); \}/.test(bill)
  && /if \(readOnly\) return; \/\/ Phase 1c/.test(bill));

ok('Job Cards — useRecordSync (form + preview drawer) + view-only fieldset + review dialog',
  /const jcSync = useRecordSync\('jobCards', leasedJobNo,/.test(jc)
  && /const previewSync = useRecordSync\('jobCards', previewCard && previewCard\.jobNo/.test(jc)
  && /<fieldset disabled=\{jcViewOnly\}/.test(jc)
  && /if \(jcViewOnly\) return;   \/\/ Phase 1c/.test(jc)
  && /fields=\{JOBCARD_CONFLICT_FIELDS\}/.test(jc));

// ── demo mode (§20) ───────────────────────────────────────────────────────
ok('demo mode is inert — useRecordSync short-circuits on demoMode before any listener',
  /const \{ demoMode \} = useAuth\(\);\s*\n\s*const active = !demoMode && !!docId;/.test(hook));

// ── §24 — nothing forbidden changed ───────────────────────────────────────
ok('Firestore rules unchanged for Phase 1c (record reads were already allow read: if signedIn())',
  !/recordSync|RecordUpdated|ConflictReview/.test(read('../firestore.rules')));
// (Invoice numbering itself is now owned by CONCURRENCY PHASE 2 — see
// tests/concurrency-doc-counter.test.cjs. Phase 1c did not touch it.)
ok('stock policy / payment transaction untouched by Phase 1c',
  /DO NOT CLAMP TO ZERO/.test(dash)
  && /const collectInvoicePayment = async \(invoiceId, pay\) => \{/.test(dash));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
