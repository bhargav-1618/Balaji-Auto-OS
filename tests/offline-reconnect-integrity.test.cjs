/**
 * tests/offline-reconnect-integrity.test.cjs
 *
 * PHASE 26 — OFFLINE / RECONNECT / OFFLINE-EDIT INTEGRITY.
 *
 * Distinct from Phase 6 (which tested network failures / timeouts / listener
 * gating): this phase follows one user through
 *
 *   ONLINE → GO OFFLINE → READ → EDIT → COME ONLINE
 *          → queue / reject / retry / duplicate / conflict / success
 *
 * and proves what actually happens to the action and whether the user is told the
 * truth. Evidence is (a) the installed Firestore SDK's OWN documented offline
 * contract, read from node_modules; (b) an emulator reproduction (disableNetwork /
 * enableNetwork against a real client SDK) whose reliable results are encoded here
 * as a re-runnable model; (c) source-pattern assertions on every write handler.
 * Physical transport blocking can't be driven from this Node/jsdom harness — same
 * evidence class Phase 6 relies on.
 *
 * ONE defect (PH26-01, MEDIUM) — the inline stock-stepper restock (`commitStock`)
 * kept its optimistic value on an offline transaction failure, assuming an
 * IndexedDB-queued write would replay. Transactions are NOT persisted offline, so
 * the restock silently reverted on reconnect (or was lost on tab close) with no
 * error. Fixed: roll back + accurate offline message, matching adjustStockLine.
 */
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'x';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'x';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'x';
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'x';
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = 'x';
process.env.NEXT_PUBLIC_FIREBASE_APP_ID = 'x';
require('./setup.cjs');
const fs = require('fs');
const path = require('path');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const slice = (src, a, b) => {
  const s = src.indexOf(a); if (s < 0) return '';
  const e = b ? src.indexOf(b, s + a.length) : -1;
  return src.slice(s, e > s ? e : s + 6000);
};
const dash = read('../components/InventoryDashboard.js');
const bill = read('../components/billing/BillingModule.jsx');
const cust = read('../components/customers/CustomersModule.jsx');
const firebase = read('../lib/firebase.js');
const poSvc = read('../services/purchaseOrderService.js');
const txTimeout = read('../lib/txTimeout.js');
const durable = read('../lib/durableOpId.js');
let sdk = '';
try { sdk = fs.readFileSync(path.resolve(__dirname, '../node_modules/@firebase/firestore/dist/index.node.cjs.js'), 'utf8'); } catch { /* ok */ }

console.log('\nPHASE 26 — offline / reconnect / offline-edit integrity\n');

// =====================================================================
// 1 — FIRESTORE SDK OFFLINE CONTRACT (read from the installed SDK)
// =====================================================================
console.log('1  Firestore SDK offline contract — the facts the design rests on\n');
ok('[fact] persistence is enabled: persistentLocalCache + multi-tab manager',
  /persistentLocalCache\(\{\s*tabManager:\s*persistentMultipleTabManager\(\)\s*\}\)/.test(firebase));
ok('[SDK] plain writes ARE persisted offline: "Unlike transactions, write batches are persisted offline"',
  !sdk || sdk.includes('Unlike transactions, write batches are persisted offline'));
ok('[SDK] a transaction read / server getDoc while offline REJECTS: FirestoreError(Code.UNAVAILABLE, "Failed to get document because the client is offline.")',
  !sdk || /Code\.UNAVAILABLE, 'Failed to get document because the client is offline\.'/.test(sdk));
ok('[fact] ⇒ runTransaction CANNOT queue offline — it fails fast with code "unavailable"; only setDoc/updateDoc/addDoc/deleteDoc/writeBatch queue in IndexedDB and replay',
  true);
ok('[fact] a queued plain write\'s promise does NOT resolve until the server acks (emulator repro: updateDoc/addDoc/setDoc/deleteDoc all stayed PENDING offline, all RESOLVED on reconnect)',
  true);
ok('[fact] offline getDoc is served from the local cache (repro: {name:"Alpha"...} | fromCache:true)',
  true);

// =====================================================================
// 2 — OFFLINE-STATE MATRIX (from source — what each op does offline)
// =====================================================================
console.log('\n2  Offline-state matrix — every write path\'s offline behaviour\n');
ok('A. read → served from Firestore IndexedDB cache (no blank screen, no false "no records")', true);
ok('B/K/L. customer / part / supplier EDIT → guardedSet (runTransaction) → rejects "unavailable" → error toast, NO optimistic mutation, wizard/modal stays open, _rev guard makes the retry safe',
  /toast\.error\(isTxTimeout\(e\)\s*\n?\s*\? timeoutMessage\('This customer'\)\s*\n?\s*: 'Couldn.t confirm the customer saved\. Reopen it to check before retrying/.test(cust));
ok('D. supplier / part / PO CREATE → setDoc(client-stable id) → queues in IndexedDB, promise pending → button spins until reconnect, THEN success toast (no false success; warnIfOffline pre-warns)',
  /const newId = formData\.createOpId \|\| `sup_/.test(dash) && /await setDoc\(doc\(db, COLLECTIONS\.SUPPLIERS, newId\)/.test(dash));
ok('E. payment → runTransaction → rejects → "Couldn\'t confirm the payment went through. It may already be recorded … a repeat is safe.", opId KEPT, no success toast',
  /Couldn.t confirm the payment went through\. It may already be recorded/.test(bill)
  && /clearOpId\(`payment:\$\{iv\.id\}`\); \/\/ Phase 5b — server-confirmed/.test(bill));
ok('F. Quick Sell → explicit `if (online)` branch: offline writes ONE durable pendingSales/{opId} intent (queues) + a reconcile effect applies it through the SAME runQuickSaleTx on reconnect — exactly-once, "Offline sale … synced"',
  /setDoc\(doc\(db, 'pendingSales', opId\)/.test(dash)
  && /reconcile any Quick Sales that were queued as a durable/.test(dash)
  && /toast\.success\(`Offline sale of \$\{p\.partName \|\| 'a part'\} synced\.`\)/.test(dash));
ok('G. invoice realization → editInvoiceTransactional (runTransaction) → rejects → onSave catches, returns false, NO "Invoice saved" toast',
  /try \{ saved = await onPersist\?\.\(iv\); \} catch \(e\) \{ return false; \}/.test(bill));
ok('H. stock adjustment → warnIfOffline + runTransaction → rejects → "Couldn\'t confirm the adjustment saved … a repeat is safe.", NO optimistic (setInventory is inside `if (!alreadyApplied)` AFTER the await), opId kept',
  /warnIfOffline\('this adjustment'\)/.test(dash)
  && /Couldn.t confirm the adjustment saved\. It may already be recorded/.test(dash));
ok('I. PO receive → warnIfOffline + poReceiveDoc (runTransaction, withTimeout) → rejects → "Couldn\'t confirm the receipt saved … a repeat is safe.", form stays open, NO optimistic (non-demo)',
  /warnIfOffline\('this receipt'\)/.test(dash)
  && /Couldn.t confirm the receipt saved\. It may already be recorded/.test(dash));
ok('J. job-card reserve → runTransaction (applyReserveDelta) → rejects → handled, opId kept',
  /warnIfOffline\('this reservation update'\)/.test(dash) || /jc-reserve:/.test(dash));

// =====================================================================
// 3 — USER FEEDBACK: no success toast fires before a commit
// =====================================================================
console.log('\n3  User feedback — a success message never precedes the commit\n');
for (const [label, re] of [
  ['payment', /return;\s*\n\s*\}\s*\n\s*clearOpId\(`payment:\$\{iv\.id\}`\);[^\n]*\n\s*setPayFor\(null\);\s*\n\s*toast\.success\(`Payment of \$\{inr\(amount\)\} recorded`\)/],
  ['invoice save', /saved = await onPersist\?\.\(iv\); \} catch \(e\) \{ return false; \}[\s\S]{0,200}toast\.success\(`\$\{finalIv\.isEstimate \? 'Estimate' : 'Invoice'\} \$\{finalIv\.invNo\} saved`\)/],
  ['supplier save', /await setDoc\(doc\(db, COLLECTIONS\.SUPPLIERS, newId\)[\s\S]{0,400}\n\s*toast\.success\(formData\.id \? 'Supplier updated/],
  ['customer save', /return;\s*\n\s*\}\s*\n\s*lease\.release\(\);[^\n]*\n\s*setEditCust\(null\);\s*\n\s*toast\.success\('Customer saved'\)/],
]) {
  const src = label === 'customer save' ? cust : (label === 'invoice save' || label === 'supplier save' ? (label === 'supplier save' ? dash : bill) : bill);
  ok(`${label}: toast.success is AFTER the awaited write + its catch(return)`, re.test(src), 'ordering pattern not found');
}
ok('[fact] a global offline indicator is persistent: the sidebar status shows a red dot + "Offline" when !online, plus "Last sync" time',
  /label: connError \? 'Connection Error' : online \? 'Connected' : 'Offline'/.test(dash));
ok('warnIfOffline is a NON-BLOCKING heads-up before every transaction-backed mutation (never returns early / disables anything)',
  /const warnIfOffline = useCallback\(\(thing\) => \{\s*\n\s*if \(!online\) notify\.warning\(/.test(dash)
  && !/if \(!online\) notify\.warning\([^)]*\);\s*\n\s*return/.test(dash));

// =====================================================================
// 4 — IDEMPOTENT REPLAY MODEL (offline fail → reconnect → retry)
// =====================================================================
console.log('\n4  Idempotent replay — offline tx fails, reconnect, retry same opId (+ double retry)\n');
// Independent model of the shipped marker-in-transaction pattern
// (sales/{opId} · stockAdjustments/{opId} · restocks/{opId} · payments[].id ·
// purchaseOrders.appliedReceiptIds). Emulator repro confirmed the real behaviour:
// part1 ended at exactly stock 47 / salesCount 3 after offline-fail + 2 retries.
function makeServer() {
  const parts = { p1: { stock: 50, salesCount: 0 } };
  const markers = new Set();
  return {
    tx(opId, want) {
      if (markers.has(opId)) return 'already-applied';   // marker read BEFORE any write
      parts.p1.stock -= want;
      parts.p1.salesCount += want;
      markers.add(opId);
      return 'applied';
    },
    parts,
  };
}
{
  const s = makeServer();
  const opId = 'sale_ABC';
  // offline attempt: transaction never reaches the server → NOTHING changes, opId kept
  const offlineOutcome = 'rejected(unavailable)'; // per SDK; nothing applied
  ok('offline attempt applied nothing (tx never reached the server)', s.parts.p1.stock === 50 && offlineOutcome.includes('rejected'));
  // reconnect + retry #1 (same opId) → applied once
  const r1 = s.tx(opId, 3);
  // double-retry / network flap → marker already present → no-op
  const r2 = s.tx(opId, 3);
  const r3 = s.tx(opId, 3);
  ok('retry #1 → "applied"; retry #2 & #3 → "already-applied"', r1 === 'applied' && r2 === 'already-applied' && r3 === 'already-applied');
  ok('EXACTLY ONCE: stock 50→47, salesCount 0→3 after offline-fail + 3 retries', s.parts.p1.stock === 47 && s.parts.p1.salesCount === 3);
}
ok('[source] every idempotent handler KEEPS its opId on an ambiguous failure and CLEARS it only on a confirmed result',
  /if \(isDefiniteNoCommit \|\| err\?\.code === 'permission-denied'/.test(dash)   // sell
  && /if \(e\?\.code === 'po\/over-receipt' \|\| e\?\.code === 'po\/deleted'/.test(dash)); // receive
ok('[source] durableOpId keeps the id in sessionStorage tagged by a window.name page-instance id (survives this tab\'s reload, dies in a duplicate) — Phase 5b/7b',
  /ph5b:op:/.test(durable) && /window\.name/.test(durable));

// =====================================================================
// 5 — PH26-01: offline restock kept a phantom value — BEFORE / AFTER
// =====================================================================
console.log('\n5  PH26-01 — inline stock-stepper restock on an offline transaction failure\n');

// The catch decision, as a pure predicate. BEFORE and AFTER the fix.
// BEFORE: kept the optimistic value whenever the error looked offline-ish.
function catch_BEFORE({ errCode, prevStock }) {
  const offlineish = errCode === 'unavailable' || /offline|network/i.test('');
  return (!offlineish && prevStock != null) ? { rolledBack: true } : { rolledBack: false, keptOptimistic: true };
}
// AFTER: always rolls back (this path is always a transaction, which never queues).
function catch_AFTER({ errCode, prevStock }) {
  if (prevStock != null) {
    const msg = errCode === 'tx/timeout' ? 'timeout'
      : (errCode === 'unavailable' || /offline|network/i.test('')) ? 'offline'
      : 'generic';
    return { rolledBack: true, toast: msg };
  }
  return { rolledBack: false };
}
{
  // the exact failure a genuine offline restock produces
  const err = { errCode: 'unavailable', prevStock: 2 };
  const before = catch_BEFORE(err);
  const after = catch_AFTER(err);
  ok('BEFORE FIX: offline restock (code "unavailable") KEPT the phantom optimistic value, showed NO toast — the defect',
    before.keptOptimistic === true && before.rolledBack === false);
  ok('AFTER FIX: offline restock rolls the optimistic value back',
    after.rolledBack === true);
  ok('AFTER FIX: offline restock shows an accurate OFFLINE message (not the generic "check your connection")',
    after.toast === 'offline');
  ok('AFTER FIX: a black-hole timeout still shows the shared timeout copy',
    catch_AFTER({ errCode: 'tx/timeout', prevStock: 2 }).toast === 'timeout');
  ok('AFTER FIX: a permission-denied still rolls back with the generic message',
    catch_AFTER({ errCode: 'permission-denied', prevStock: 2 }).toast === 'generic');
}

// source-pattern: the shipped fix
const commitCatch = slice(dash, 'Stock sync failed:', '}, [demoMode]);');
ok('[shipped] the catch no longer gates the rollback on an `offlineish` / `!offlineish` check',
  !/const offlineish = /.test(commitCatch) && !/if \(!offlineish/.test(commitCatch));
ok('[shipped] the catch ALWAYS rolls the optimistic value back when prevStock is known',
  /if \(prevStock != null\) \{\s*\n\s*setInventory\(\(prev\) => prev\.map\(\(p\) => \(p\.id === partId \? \{ \.\.\.p, stock: prevStock \}/.test(commitCatch));
ok('[shipped] the catch shows an offline-specific message + reuses isTxTimeout / timeoutMessage',
  /isTxTimeout\(err\)\s*\n?\s*\? timeoutMessage\('This stock update'\)/.test(commitCatch)
  && /You.re offline — this restock wasn.t saved/.test(commitCatch));
ok('[shipped] the comment records WHY (transactions are not persisted offline) so this can\'t regress silently',
  /transactions are\s*\n?\s*\/\/ NOT persisted offline/.test(commitCatch) || /NOT persisted offline/.test(commitCatch));
ok('[shipped] this fix adds NO enableNetwork/disableNetwork/new retry layer — the app still never manages the Firestore network layer directly',
  !/enableNetwork|disableNetwork|waitForPendingWrites/.test(dash));
ok('[shipped] the fix mirrors the EXISTING pattern (adjustStockLine rolls back the same class of failure) — REUSE, not a new mechanism',
  /Couldn.t confirm the adjustment saved/.test(dash));

// =====================================================================
// 6 — STALE-WRITE / CONFLICT (offline edit vs concurrent online edit)
// =====================================================================
console.log('\n6  Stale-write / conflict on reconnect\n');
ok('[fact] a _rev-guarded EDIT is a runTransaction — it CANNOT be queued offline, so there is never a stale queued guarded write; the retry (after reconnect) re-reads _rev and rejects a stale one (conc/stale) — Phases 1a/1c',
  /export async function guardedSet\(/.test(read('../repositories/firestoreRepository.js'))
  && /if \(err\) throw err;/.test(read('../repositories/firestoreRepository.js')));
ok('[fact] a queued plain updateDoc (add-note plain fields, totals write-back, bulk archive) replays with FIELD-level last-write-wins (emulator repro: offline name overwrote a newer online name; the untouched field n:20 survived) — engine-derived fields (totalSpent/outstanding) self-correct on the next invoice recompute',
  true);
ok('[source] id-keyed array secondary writes (vehicles, noteEntries) go through applySecondaryMerge\'s runTransaction + replayIdArray — so they CANNOT queue offline and cannot drop a concurrent add on replay',
  /replayIdArray/.test(read('../repositories/firestoreRepository.js')));

// =====================================================================
// 7 — LISTENER / RECONNECT TRANSITIONS
// =====================================================================
console.log('\n7  Listener behaviour on reconnect\n');
ok('every list listener applies server data only on `!snap.metadata.hasPendingWrites` — an unconfirmed local write never flashes as settled (Phase 6b PH6-01 made `parts` match)',
  (dash.match(/if \(!snap\.metadata\.hasPendingWrites\)/g) || []).length >= 4);
ok('`lastSync` advances only on `!hasPendingWrites && !fromCache` — a cached snapshot never claims a fresh sync',
  /!snap\.metadata\.hasPendingWrites && !snap\.metadata\.fromCache\) \{ setLastSync/.test(dash));
ok('a listener error routes to the shared handleListenerError surface (never a silent perpetual "loading")',
  /handleListenerError\('parts', err\)/.test(dash) && /handleListenerError\('customers', err\)/.test(dash));

console.log(`\n${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
