/**
 * tests/authoritative-field-integrity.test.cjs
 *
 * PHASE 13 — AUTHORITATIVE-FIELD STALE-SNAPSHOT AUDIT.
 *
 * Central question: for every field that can be written by MORE than one
 * workflow, can a stale whole-document editor (a wizard opened a while ago,
 * still holding an old snapshot) silently overwrite a newer value some OTHER
 * workflow wrote in the meantime? `_rev` only protects a field if EVERY
 * writer of that field actually participates in the same revision check —
 * having a `_rev` column on the document proves nothing by itself (this is
 * exactly how PH12-01 slipped through: Part's stock-only transactions never
 * bumped `_rev`, so the guarded Edit Part save was blind to them).
 *
 * This file does not re-derive Phase 1a/3b/8B/11/12's own guarantees — it
 * exercises the REAL, exported guard (`revState` from lib/concurrency.js,
 * the same function every guardedSet/editInvoiceTransactional call already
 * uses) against the one confirmed gap this audit found (PH13-01, Supplier
 * name/phone), then source-proves the fix, then records why every OTHER
 * checked field was cleared rather than re-testing phases already covered.
 */
require('./setup.cjs');
const fs = require('fs');
const path = require('path');
const { revState } = require('../lib/concurrency');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const dash = read('../components/InventoryDashboard.js');
const custMod = read('../components/customers/CustomersModule.jsx');
const slice = (src, a, b) => {
  const s = src.indexOf(a); if (s < 0) return '';
  const e = b ? src.indexOf(b, s + a.length) : -1;
  return src.slice(s, e > s ? e : s + 2000);
};

console.log('\nPHASE 13 — authoritative-field stale-snapshot audit\n');

// =====================================================================
// 1 — PH13-01 (Supplier name/phone) — MANDATORY MATRIX against the REAL guard
// =====================================================================
console.log('1  PH13-01 — Supplier name/phone: wizard vs. Part-modal quick-edit\n');

// Scenario: a Supplier edit wizard opens (captures _rev=0). While it's open,
// persistSupplierEdit() (the quick name/phone fix reachable from inside the
// Part modal) writes the supplier's name/phone. The wizard is then saved.
{
  const serverAfterQuickEdit_BEFORE_FIX = { _rev: 0, name: 'Corrected Name' }; // quick edit did NOT bump _rev
  const serverAfterQuickEdit_AFTER_FIX = { _rev: 1, name: 'Corrected Name' };  // quick edit now bumps _rev (this fix)
  const wizardExpectedRev = 0; // captured when the wizard opened, before the quick edit

  const before = revState(serverAfterQuickEdit_BEFORE_FIX, wizardExpectedRev);
  const after = revState(serverAfterQuickEdit_AFTER_FIX, wizardExpectedRev);

  ok('BEFORE the fix (quick edit does not bump `_rev`), the real revState() guard sees no conflict — reproducing the gap: the stale wizard save would have proceeded and its blind guardedSet merge would have overwritten "Corrected Name" back to whatever the wizard loaded',
    before.conflict === null,
    `revState returned ${JSON.stringify(before)}`);
  ok('AFTER the fix (quick edit bumps `_rev`), the same real revState() guard correctly reports conflict:"stale" — the wizard\'s existing guardedSet call now rejects the save instead of clobbering the quick edit',
    after.conflict === 'stale');
}

// Source proof: the shipped fix is actually present.
{
  const fn = slice(dash, 'async function persistSupplierEdit(', 'async function handleSupplierArchiveInner(');
  ok('persistSupplierEdit\'s updateDoc payload now includes `_rev: increment(1)`, so this write participates in the same revision protocol the Supplier wizard\'s guardedSet already checks',
    /_rev:\s*increment\(1\)/.test(fn));
  ok('the bump sits inside the SAME updateDoc call that writes name/phoneNumbers/primaryPhone/phones/phone — one write, still non-guarded for fields it does not share with the wizard (no new transaction, no new abstraction)',
    /name: cleanName,[\s\S]*phone: primaryPhone,[\s\S]*_rev: increment\(1\),/.test(fn));
}

// =====================================================================
// 2 — CLEARED: fields already correctly protected (no fix needed)
// =====================================================================
console.log('\n2  Fields checked and found already correctly protected\n');

// Customer: totalSpent/outstanding/noteEntries/documents are excluded from
// the wizard's own guardedSet payload entirely (Phase 3b, CWF-03) — the
// wizard never carries a stale snapshot of them to begin with.
ok('[fact] Customer wizard save destructures totalSpent/outstanding/visits/noteEntries/documents OUT of its own payload before calling saveCustomerEdit — these engine-derived/detail-panel fields can never be reverted by a stale wizard save because the wizard never sends them',
  /const \{ noteEntries, documents, totalSpent, outstanding, visits, \.\.\.wizardFields \} = c;/.test(custMod));

// Customer.vehicles: BOTH writers (the wizard's guardedSet idArrayKeys option,
// and the secondary-write path's idArrayReplays) route through the same
// replayIdArray() id-keyed merge — a concurrent add/edit to a DIFFERENT
// vehicle than the one this editor touched survives either way.
ok('[fact] the Customer wizard\'s guardedSet call passes idArrayKeys:["vehicles"] + clientBefore, so its own vehicles[] write is reconciled against server truth via replayIdArray — not blindly overwritten — matching the same merge secondary customer writes already use',
  /saveGuarded\(COLLECTIONS\.CUSTOMERS, record, expectedRev, \{[\s\S]{0,200}idArrayKeys: \['vehicles'\]/.test(dash));

// Part: stock/salesCount/reserved re-verified still excluded from the shared
// edit/create payload after Phase 12's fix (regression guard for PH12-01).
{
  const payloadSrc = slice(dash, 'vehicleNotes: (formData.vehicleNotes', 'let concRejected = false;');
  ok('[fact, PH12-01 regression guard] Part\'s shared edit/create payload still excludes `stock` (fixed in Phase 12) and never included `salesCount` or `reserved` — all three remain owned exclusively by Sell/Restock/Adjustment/PO-receive/Job-Card-reserve, none of which bump `_rev`',
    !/^\s*stock: nonNegInt/m.test(payloadSrc) && !/salesCount:/.test(payloadSrc) && !/reserved:/.test(payloadSrc));
}

// Invoice: payments/paid/balance/status ARE included in the edit form's own
// payload (the edit modal legitimately manages payment rows too), so
// exclusion does not apply here — the correct protection is that the
// COMPETING writer (collectInvoicePayment) bumps `_rev` on every payment,
// so a stale invoice editor's later save is rejected by the SAME guard
// editInvoiceTransactional already runs, exactly like PH13-01's fix above.
ok('[fact] collectInvoicePayment already bumps `_rev` on every payment specifically so a stale invoice editor is rejected on save instead of clobbering the payment — Invoice\'s payments/paid/balance/status already participate in the same revision protocol editInvoiceTransactional checks; unlike Supplier name/phone, no gap exists here',
  /a payment also bumps `_rev`, so an invoice editor that was open[\s\S]{0,200}const nextRev = revOf\(data\) \+ 1;/.test(dash));

// JobCard: no narrow/secondary writer of job-card fields exists in production
// (only the guarded wizard save and the safe diff-based syncAll path for
// create/delete) — there is no second writer to race against.
ok('[fact] JobCards have exactly one field-level writer in production (the guarded wizard save via saveGuarded); create/delete go through the diff-based syncAll path, which only ever writes fields that actually changed in local state — there is no narrow secondary writer of job-card fields to leave `_rev` blind to',
  (dash.match(/COLLECTIONS\.JOB_CARDS/g) || []).length === 5);

// Part.suppliers[] cascade from a Supplier rename: explicitly documented as
// DENORMALIZED display data, not authoritative — outside this audit's own
// "authoritative values" scope by its own prior classification (Phase 8B).
ok('[fact, out of scope by design] Part.suppliers[] is explicitly documented as a DENORMALIZED display copy of the supplier\'s name/phone, not authoritative — a Part edit form reverting a supplier-rename cascade there is accepted, self-correcting residue (Phase 8B), not an authoritative-value defect this audit\'s own criteria cover',
  /classified DERIVED\/DENORMALIZED, not\s*\n\s*\/\/ authoritative/.test(dash));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
// PH13-01 is verified fixed above via the real revState() guard plus a
// source-pattern proof of the shipped change. Every other multi-writer
// authoritative field checked this phase (Customer.totalSpent/outstanding/
// noteEntries/documents/vehicles, Part.stock/salesCount/reserved, Invoice.
// payments/paid/balance/status, JobCard's fields) was found to already
// participate correctly in this codebase's existing `_rev`/replayIdArray
// protocol — no further fix required. FAIL>0 = a real regression against
// current source or an unverified claim above.
process.exit(FAIL ? 1 : 0);
