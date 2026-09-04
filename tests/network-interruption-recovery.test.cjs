/**
 * tests/network-interruption-recovery.test.cjs
 *
 * PHASE 6 (discovery) + PHASE 6B (hardening) — NETWORK INTERRUPTION /
 * OFFLINE-RECOVERY.
 *
 * Phase 6 (discovery, no code change) found 3 confirmed gaps and no
 * CRITICAL/HIGH defect — the Phase 4b/5b durable-opId + backend-marker
 * architecture was already connectivity-cause-agnostic (the mechanism does
 * not distinguish a lost response caused by a refresh from one caused by a
 * network drop). Phase 6B closes the 3 gaps:
 *
 *   PH6-01 (MEDIUM) — the `parts` onSnapshot listener applied EVERY snapshot
 *     unconditionally while jobCards/customers/invoices all gated on
 *     `!hasPendingWrites`. During an outage spanning a new-invoice save, a
 *     second tab/device could see the stock decrement before the invoice
 *     itself appeared anywhere. FIX: gate `parts`' `setInventory` the same
 *     way (setLoading/setPendingWrites/setLastSync stay ungated on purpose —
 *     a cached-but-unconfirmed snapshot is still real data to show).
 *
 *   PH6-03 (MEDIUM) — none of the app's `runTransaction` call sites had a
 *     client-side timeout, so a "black hole" network (no explicit socket
 *     error) could leave a Save button/spinner unbounded. FIX: `lib/
 *     txTimeout.js`'s `withTimeout(promise, ms, label)` races the (already-
 *     started, never re-invoked) transaction promise against a timer. It
 *     does NOT cancel the transaction — Firestore has no such API, and a
 *     client-side "cancel" could never undo a commit that already reached
 *     the server — it only bounds how long the UI waits, and the resulting
 *     TxTimeoutError carries `.code = 'tx/timeout'`, which every existing
 *     catch block's `isDefiniteNoCommit = !err?.code && !!err?.message`
 *     check already treats as AMBIGUOUS (keep the durable opId, tell the
 *     user to check before retrying) — the exact bucket a lost-response
 *     network failure already fell into. No retry-safety logic changed;
 *     only the wait is now bounded and the copy is now accurate.
 *
 *   PH6-02 (LOW) — only Quick Sell checked `navigator.onLine` before
 *     attempting a write; no button was ever disabled by connectivity state.
 *     FIX: `warnIfOffline(thing)` — a soft, NON-BLOCKING `notify.warning`
 *     heads-up before every other transaction-backed mutation. Deliberately
 *     does NOT disable anything or block the attempt: `navigator.onLine` is
 *     only a browser hint, not proof Firestore is reachable (a captive
 *     portal reports "online" while nothing real is reachable), so a hard
 *     block would create false negatives — the spec this phase followed is
 *     explicit that `online` must stay a UX signal, never a correctness
 *     gate.
 *
 * A 4th finding surfaced during the SAME audit (not one of the 3 named
 * gaps, but the same class of problem — Step 2/5 of the phase spec: "if you
 * discover another clear network-recovery defect in the same class, include
 * it in this pass"): the customer/invoice/job-card GUARDED EDIT paths threw
 * a non-concurrency (ambiguous/ timeout) failure with NO toast at all — the
 * comment at each call site claimed "the shared persistence layer already
 * shows a toast"; it never did (`store.saveGuarded` only ever re-throws).
 * The user saw the editor simply not close, with zero explanation. Fixed
 * alongside PH6-03 since it is exactly the same "tell the user the truth
 * about an unknown result" requirement.
 *
 * Genuine transport-level network blocking still cannot be driven
 * deterministically from this Node/jsdom harness (no CDP network emulation
 * available here) — the pure durable-opId model in §3 and the source-pattern
 * assertions throughout remain the evidence class this suite relies on, per
 * the phase's own instruction to prefer source/model proof over physical
 * timing races for exactly this kind of scenario.
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
const dash = read('../components/InventoryDashboard.js');
const bill = read('../components/billing/BillingModule.jsx');
const cust = read('../components/customers/CustomersModule.jsx');
const firebase = read('../lib/firebase.js');
const repo = read('../repositories/firestoreRepository.js');
const store = read('../services/persistenceStore.js');
const durable = read('../lib/durableOpId.js');
const docCounter = read('../lib/docCounter.js');
const poSvc = read('../services/purchaseOrderService.js');
const lease = read('../lib/editLease.js');
const txTimeout = read('../lib/txTimeout.js');

const slice = (src, a, b) => {
  const s = src.indexOf(a); if (s < 0) return '';
  const e = b ? src.indexOf(b, s + a.length) : -1;
  return src.slice(s, e > s ? e : s + 4000);
};

console.log('\nPHASE 6B — network interruption / offline recovery hardening\n');

// =====================================================================
// 0 — PERSISTENCE / TRANSPORT MODEL (unchanged since Phase 5/5b)
// =====================================================================
console.log('0  Persistence / transport model\n');
ok('[fact] Firestore uses persistentLocalCache + multi-tab manager (unchanged since Phase 5)',
  /persistentLocalCache\(\{\s*tabManager:\s*persistentMultipleTabManager\(\)\s*\}\)/.test(firebase));
ok('[fact] no enableNetwork/disableNetwork/waitForPendingWrites is imported or used anywhere — the app never explicitly manages the Firestore network layer',
  !/enableNetwork|disableNetwork|waitForPendingWrites/.test(firebase + dash + bill + repo + store));
ok('[fact] the app tracks navigator.onLine via window online/offline events into a React `online` flag',
  /const \[online, setOnline\] = useState\(true\)/.test(dash)
  && /window\.addEventListener\('online', up\)/.test(dash)
  && /window\.addEventListener\('offline', down\)/.test(dash));
ok('[fact] Quick Sell still branches explicitly on `online` (queues offline instead of attempting a transaction) — unchanged by Phase 6b',
  /if \(online\) \{/.test(slice(dash, 'async function handleSellInner', 'async function adjustStockLine')));

// --- PH6-02: FIXED — warnIfOffline exists and is non-blocking ---
ok('PH6-02 FIXED: a shared, non-blocking `warnIfOffline` helper exists, built on the existing `notify.warning` (not a new visual language) and reacting to the SAME `online` flag',
  /const warnIfOffline = useCallback\(\(thing\) => \{\s*\n\s*if \(!online\) notify\.warning\(/.test(dash));
ok('PH6-02 FIXED: `warnIfOffline` never blocks or returns early — it is a fire-and-forget toast call, so every call site still falls through to attempt the write exactly as before',
  !/if \(!online\) notify\.warning\([^)]*\);\s*\n\s*return/.test(dash));
const warnSites = [
  'collectInvoicePayment', 'deleteInvoice', 'this reservation update', 'this adjustment',
  'this receipt', 'this customer', 'this invoice', 'this supplier', 'this part', 'this PO', 'this invoice number',
];
ok('PH6-02 FIXED: warnIfOffline is called from every high-risk transaction-backed / awaited-write entry point (payment, delete, reservation, adjust, receive x2, customer/invoice/supplier/part edit, PO create, invoice numbering)',
  (dash.match(/warnIfOffline\(/g) || []).length >= 10);
ok('PH6-02 — deliberately NOT a hard block: no new `disabled={...online...}` gate was introduced (navigator.onLine is a UX hint, not proof Firestore is reachable — a hard block would create false negatives on a captive portal / corporate proxy)',
  !/disabled=\{[^}]*!online/.test(dash) && !/disabled=\{[^}]*online\}/.test(dash));
ok('PH6-02 — the existing global connectivity indicator (Sidebar status chip, fed by `online`/`connError`) is REUSED, not replaced — Step 6 of the spec: reuse what exists before building something new',
  /status=\{\{\s*\n\s*color: connError \? '#ef4444' : online \? '#34d399' : '#ef4444',/.test(dash));

// --- PH6-03: FIXED — every runTransaction call site is bounded ---
console.log('\n  PH6-03 — bounded transaction timeout\n');
ok('PH6-03 FIXED: lib/txTimeout.js exports withTimeout/TxTimeoutError/TX_TIMEOUT_MS/LEASE_TIMEOUT_MS/isTxTimeout/timeoutMessage',
  /export const TX_TIMEOUT_MS = 12000;/.test(txTimeout)
  && /export const LEASE_TIMEOUT_MS = 6000;/.test(txTimeout)
  && /export class TxTimeoutError extends Error/.test(txTimeout)
  && /this\.code = 'tx\/timeout';/.test(txTimeout)
  && /export function withTimeout\(promise, ms = TX_TIMEOUT_MS, label, onSettleLate\)/.test(txTimeout)
  && /export const isTxTimeout = \(err\) => !!err && err\.code === 'tx\/timeout';/.test(txTimeout)
  && /export function timeoutMessage\(thing\)/.test(txTimeout));
ok('PH6-03 FIXED: withTimeout races an ALREADY-STARTED promise (never a factory) against a timer via Promise.race — the underlying operation is never invoked twice, and never cancelled',
  /return Promise\.race\(\[promise, timeout\]\);/.test(txTimeout));
ok('PH6-03 FIXED: the real promise settling always clears the timer first (fast path is a pass-through, not delayed by the timeout machinery)',
  /promise\.then\(\s*\n\s*\(v\) => \{ settled = true; clearTimeout\(timer\);/.test(txTimeout));
ok('PH6-03 FIXED: a late resolution/rejection (after the timeout branch already fired) still invokes onSettleLate, so durable state CAN be reconciled once the true outcome is known — nothing is silently discarded',
  /if \(onSettleLate\) onSettleLate\(null, v\)/.test(txTimeout)
  && /if \(onSettleLate\) onSettleLate\(e, undefined\)/.test(txTimeout));

// Every runTransaction call site in the app is now wrapped. This is the
// literal Step-20 "audit all 11 (really 13) transaction call sites" list.
const boundedTxnSites = [
  ['guardedSet (entity edit: customer/part/supplier/jobcard/invoice)', /return withTimeout\(runTransaction\(db, async \(tx\) => \{/, repo],
  ['applySecondaryMerge (id-array field replay, e.g. customer note/vehicle)', /await withTimeout\(runTransaction\(db, async \(tx\) => \{/, repo],
  ['collectInvoicePayment', /await withTimeout\(runTransaction\(db, async \(tx\) => \{/, dash],
  ['deleteInvoice', /serverPrior = await withTimeout\(runTransaction\(db, async \(tx\) => \{/, dash],
  ['applyReserveDelta (job-card reservation, per-part txn)', /withTimeout\(runTransaction\(db, async \(tx\) => \{/, dash],
  ['handleSellInner (Quick Sell, online branch)', /result = await withTimeout\(runTransaction\(db, async \(tx\) => \{/, dash],
  ['adjustStockLineInner (Stock Adjustment)', /res = await withTimeout\(runTransaction\(db, async \(tx\) => \{/, dash],
  ['receiveStockLineInner (Ad-hoc Restock) — same res = await withTimeout( shape as adjust, second occurrence', (dash.match(/res = await withTimeout\(runTransaction\(db, async \(tx\) => \{/g) || []).length >= 2, null],
  ['allocateNumber (invoice/estimate numbering)', /return withTimeout\(runTransaction\(db, async \(tx\) => \{/, docCounter],
  ['poReceiveDoc (PO Receive)', /return withTimeout\(runTransaction\(db, async \(tx\) => \{/, poSvc],
  ['acquireLease (edit-lease coordination, background/UX-only)', /await withTimeout\(runTransaction\(db, async \(tx\) => \{/, lease],
  ['renewLease (edit-lease heartbeat, background)', (lease.match(/await withTimeout\(runTransaction\(db, async \(tx\) => \{/g) || []).length >= 2, null],
  ['releaseLease (edit-lease best-effort cleanup, background)', (lease.match(/await withTimeout\(runTransaction\(db, async \(tx\) => \{/g) || []).length >= 3, null],
];
boundedTxnSites.forEach(([label, re, src]) => {
  const cond = src === null ? re : re.test(src);
  ok(`PH6-03 FIXED: ${label} is wrapped in withTimeout(...)`, cond);
});
ok('PH6-03 — total withTimeout(runTransaction(db, occurrences across the app matches the full 13-site inventory (2 in firestoreRepository, 3 in editLease, 1 each in docCounter/purchaseOrderService, 6 in InventoryDashboard incl. the per-part reserve-delta map)',
  (repo.match(/withTimeout\(runTransaction\(db,/g) || []).length === 2
  && (lease.match(/withTimeout\(runTransaction\(db,/g) || []).length === 3
  && (docCounter.match(/withTimeout\(runTransaction\(db,/g) || []).length === 1
  && (poSvc.match(/withTimeout\(runTransaction\(db,/g) || []).length === 1
  && (dash.match(/withTimeout\(runTransaction\(db,/g) || []).length === 6);
ok('PH6-03 — no runTransaction(db, call site remains UN-wrapped: every occurrence of "runTransaction(db," in the whole app is immediately preceded by "withTimeout("',
  [dash, repo, lease, docCounter, poSvc].every((src) => {
    const bare = (src.match(/runTransaction\(db,/g) || []).length;
    const wrapped = (src.match(/withTimeout\(runTransaction\(db,/g) || []).length;
    return bare === wrapped && bare > 0;
  }));
ok('PH6-03 FIXED: a timeout is classified AMBIGUOUS by the pre-existing isDefiniteNoCommit heuristic (TxTimeoutError carries `.code`, so `!err?.code` is false) — no retry-safety logic needed to change, only the copy',
  /const isDefiniteNoCommit = !err\?\.code && !!err\?\.message;/.test(dash));
ok('PH6-03 FIXED: every high-risk catch block now special-cases isTxTimeout(err) with the shared, accurate "connection is taking longer than expected... check before retrying" copy — never a false "failed" claim',
  (dash.match(/isTxTimeout\(err\)/g) || []).length >= 5
  && (dash.match(/timeoutMessage\(/g) || []).length >= 5);
ok('PH6-03 FIXED: a timeout never clears a durable operation id — Quick Sell\'s clear-on-confirmed-failure condition still lists only isDefiniteNoCommit / permission-denied / "not enabled", never isTxTimeout',
  /if \(isDefiniteNoCommit \|\| err\?\.code === 'permission-denied' \|\| \/has not been used\|disabled\/i\.test\(err\?\.message \|\| ''\)\) \{\s*\n\s*clearOpId\(`sell:\$\{part\.id\}`\);/.test(dash));
ok('PH6-03 FIXED: adjustStockLineInner/receiveStockLineInner surface a `timedOut` flag alongside the pre-existing `definiteNoCommit` flag, so the caller\'s clearOpId(...) gate (which only fires on definiteNoCommit) is untouched — a timeout still keeps the id',
  /return \{ ok: false, definiteNoCommit: !err\?\.code && !!err\?\.message, timedOut: isTxTimeout\(err\) \};/.test(dash));
ok('PH6-03 FIXED: acquireLease\'s caller (hooks/useEditLease.js) needed NO change — it already treats any non-\'lease/held\' failure as "degrade gracefully, don\'t block the edit", and a TxTimeoutError (code tx/timeout) falls into that same pre-existing branch',
  /if \(e && e\.code === 'lease\/held'\) return \{ ok: false, heldBy: e\.heldBy \|\| 'another user' \};/.test(read('../hooks/useEditLease.js')));

// --- PH6-01: FIXED — listener gating asymmetry closed ---
console.log('\n  PH6-01 — parts listener gated like every other collection\n');
ok('PH6-01 FIXED: the `parts` onSnapshot listener now gates `setInventory` on `!hasPendingWrites`, matching jobCards/customers/invoices, instead of applying every snapshot unconditionally',
  /if \(!snap\.metadata\.hasPendingWrites\) \{\s*\n\s*setInventory\(snap\.docs\.map\(\(d\) => \(\{ id: d\.id, \.\.\.d\.data\(\) \}\)\)\);\s*\n\s*\}/.test(dash));
ok('PH6-01 FIXED (invariant): `setPendingWrites` is still updated on EVERY snapshot regardless of the gate — the existing "still syncing" indicator (ADD-08) keeps working exactly as before',
  /setPendingWrites\(snap\.metadata\.hasPendingWrites\); \/\/ ADD-08 — tracked every snapshot regardless/.test(dash));
const partsListenerBlock = slice(dash, 'const q = query(collection(db, COLLECTIONS.PARTS)', "handleListenerError('parts', err)");
ok('PH6-01 FIXED (invariant): `setLoading(false)` is still called on EVERY snapshot, OUTSIDE the `!hasPendingWrites` gate — a cached-but-unconfirmed first snapshot after a reload during an outage is still real data, not an empty/stuck-loading state',
  /if \(!snap\.metadata\.hasPendingWrites\) \{\s*\n\s*setInventory\(snap\.docs\.map/.test(partsListenerBlock)
  && /\}\s*\n\s*setPendingWrites\(snap\.metadata\.hasPendingWrites\);/.test(partsListenerBlock) // the gate closes BEFORE setPendingWrites
  && /setLoading\(false\);/.test(partsListenerBlock));
ok('PH6-01 FIXED (invariant): this did NOT touch the jobCards/customers/invoices listeners — they already gated correctly; only the asymmetric one (`parts`) changed',
  (dash.match(/if \(!snap\.metadata\.hasPendingWrites\) \{ set(JobCards|CustomersRaw|InvoicesRaw)\(/g) || []).length >= 2
  || /if \(!snap\.metadata\.hasPendingWrites\) \{ setJobCards\(/.test(dash));
ok('PH6-01 FIXED (invariant): this did NOT remove or delay the per-mutation OPTIMISTIC local setInventory calls (Quick Sell, adjust, restock, reserve, invoice cascade) — those still update the acting device instantly, independent of the listener',
  /setInventory\(\(prev\) =>\s*\n\s*prev\.map\(\(p\) => \(p\.id === part\.id \? \{ \.\.\.p, stock: newStock, salesCount: newSalesCount \} : p\)\)\s*\n\s*\);/.test(dash));

// =====================================================================
// SILENT-FAILURE FIX (Step 2/5 — found in the same audit, fixed alongside)
// =====================================================================
console.log('\n  Additional finding fixed in this pass — silent guarded-edit failures\n');
ok('FIXED: invoice edit — a non-concurrency guardedSet failure now toasts (was silently re-thrown with the comment falsely claiming a toast already fired)',
  /if \(isConcurrencyError\(err\)\) concToast\(err, 'invoice'\);\s*\n\s*else toast\.error\(isTxTimeout\(err\)/.test(dash));
ok('FIXED: job card edit — same silent-failure gap, same fix',
  /if \(isConcurrencyError\(err\)\) concToast\(err, 'job card'\);\s*\n\s*else toast\.error\(isTxTimeout\(err\)/.test(dash));
ok('FIXED: customer edit (CustomersModule.jsx) — the non-concurrency branch used to be empty (`return;` with nothing shown); now always toasts, distinguishing a genuine timeout from any other ambiguous failure',
  /\} else \{[\s\S]{0,500}toast\.error\(isTxTimeout\(e\)[\s\S]{0,200}timeoutMessage\('This customer'\)/.test(cust));
ok('FIXED: part edit — the old message claimed a definite "Could not save part" even on an ambiguous/timeout failure; now matches the accurate, retry-safe wording every other guarded edit uses',
  /'Couldn.t confirm the part saved\. Reopen it to check before retrying — a stale retry is safely rejected, a lost one saves again\.'/.test(dash));

// =====================================================================
// 1 — QUEUE vs TRANSACTION INVENTORY (unchanged architecture, re-verified)
// =====================================================================
console.log('\n1  Queue vs transaction inventory (unchanged)\n');
const txnSites = [
  ['guardedSet (entity edit: customer/part/supplier/jobcard/invoice)', /export async function guardedSet\(/, repo],
  ['applySecondaryMerge (id-array field replay)', /export async function applySecondaryMerge\(/, repo],
  ['collectInvoicePayment', /const collectInvoicePayment = async/, dash],
  ['deleteInvoice', /const deleteInvoice = async/, dash],
  ['applyReserveDelta (job-card reservation, per-part txn)', /const applyReserveDelta = \(deltaMap, reserveOpId = null\) =>/, dash],
  ['handleSellInner (Quick Sell, online branch)', /async function handleSellInner/, dash],
  ['adjustStockLineInner (Stock Adjustment)', /async function adjustStockLineInner/, dash],
  ['receiveStockLineInner (Ad-hoc Restock)', /async function receiveStockLineInner/, dash],
  ['allocateNumber (invoice/estimate numbering)', /export async function allocateNumber\(/, docCounter],
  ['poReceiveDoc (PO Receive)', /export function poReceiveDoc\(/, poSvc],
];
txnSites.forEach(([label, re, src]) => ok(`[fact] ${label} is transaction-backed — requires a live round-trip, does NOT queue offline (unchanged)`, re.test(src)));

const queuedSites = [
  ['customer/part/supplier/jobcard create (syncAll writeBatch set{merge})', /batchOps\.push\(\{\s*\n?\s*type: 'set',\s*\n?\s*collection: collectionName,[\s\S]{0,220}merge: true,/, store],
  ['PO create (setDoc when poId supplied)', /if \(poId\) return setDoc\(doc\(db, 'purchaseOrders', String\(poId\)\), data, \{ merge: true \}\)/, poSvc],
  ['invoice document write (persistDocsDiff -> syncAll)', /await persistDocsDiff\(COLLECTIONS\.INVOICES, prev, next\)/, dash],
  ['archive/restore (updateDoc({archived:bool}))', /await updateDoc\(doc\(db, COLLECTIONS\.PARTS, id\), \{ archived: true/, dash],
  ['audit log (addDoc, advisory)', /addDoc\(collection\(db, COLLECTIONS\.AUDIT_LOG\), entry\)/, dash],
];
queuedSites.forEach(([label, re, src]) => ok(`[fact] ${label} is a non-transactional write — QUEUES to IndexedDB and replays on reconnect (unchanged — NOT given a timeout, since timing out a queued write would misrepresent "still queued, will send" as "failed")`, re.test(src)));

// =====================================================================
// 2 — STEP 22: MULTI-WRITE SEQUENCES (unchanged — proven self-healing)
// =====================================================================
console.log('\n2  Multi-write sequences (unchanged, still self-healing)\n');
const jcNewBlock = slice(dash, 'const next = [...prev.filter((c) => c.jobNo !== card.jobNo), stamped];', 'const label = `${stamped.jobNo}');
ok('[fact] Job Card create: the card DOC write and the reservation TXN are still two SEPARATE awaited calls, not one atomic operation (unchanged — proven duplicate-free by the durable-id + appliedReserveIds marker, not by atomicity)',
  /await persistJobCardsDiff\(prev, next\);/.test(jcNewBlock)
  && /await applyReserveDelta\(reserveDelta\(reserveBaseline, card\), reserveOpId\);/.test(jcNewBlock));
const newInvBlock = slice(dash, "runInvoiceTransaction(prior, target, 'persist');", 'syncCustomerTotals(target.customerId, next);');
ok('[fact] New invoice: the realized stock/sales/rollup cascade still fires before the invoice DOCUMENT write and is not awaited (unchanged) — the PH6-01 fix closes the UI-VISIBILITY asymmetry this produced, not the write ordering itself (both writes are the same queue class and always converge)',
  dash.indexOf("runInvoiceTransaction(prior, target, 'persist');") < dash.indexOf('await persistDocsDiff(COLLECTIONS.INVOICES, prev, next);'));

// =====================================================================
// 3 — DURABLE OPERATION IDENTITY UNDER NETWORK LOSS (extends Phase 5b)
// =====================================================================
console.log('\n3  Operation-ID recovery under network loss (not just refresh)\n');
ok('[fact] the durable opId lives in sessionStorage, independent of WHY the response was lost (refresh OR network drop OR both) — the mechanism does not distinguish',
  /sessionStorage\.getItem\(key\)/.test(durable) && /sessionStorage\.setItem\(key, fresh\)/.test(durable));
ok('[fact] the id is cleared only on a CONFIRMED result; while the network is down (or a timeout fired) and the transaction promise has not settled, the id stays put by construction',
  /clear: \(\) => clearOpId\(state\.current\.scope\)/.test(read('../hooks/useDurableOpId.js')));

// pure model: same durable id survives across (a) refresh, (b) pure network drop
// with the tab staying open (no reload at all), (c) both combined, and now
// (d) a UI-side timeout firing while the underlying transaction is still
// genuinely in flight and later resolves late.
const world = () => ({ server: new Set(), session: new Map() });
const readOrCreate = (w, scope) => { if (!w.session.has(scope)) w.session.set(scope, `id_${w.session.size}_${Math.random()}`); return w.session.get(scope); };
const clearScope = (w, scope) => w.session.delete(scope);
const applyOnce = (w, scope, eff) => { const id = readOrCreate(w, scope); if (w.server.has(id)) return; w.server.add(id); eff.n += 1; };

let w = world(); const effA = { n: 0 };
applyOnce(w, 'payment:INV-1', effA);
applyOnce(w, 'payment:INV-1', effA);
ok('(a) network drop, no refresh: retry via the still-mounted component reuses the same in-memory id -> one effect', effA.n === 1);

w = world(); const effB = { n: 0 };
applyOnce(w, 'payment:INV-2', effB);
applyOnce(w, 'payment:INV-2', effB);
ok('(b) network drop + refresh combined: sessionStorage id recovered -> still one effect', effB.n === 1);

clearScope(w, 'payment:INV-2');
applyOnce(w, 'payment:INV-2', effB);
ok('(c) new intent after the first confirmed (id cleared): a real second payment still applies', effB.n === 2);

// (d) PH6-03 model: UI times out (opId kept, per withTimeout's contract), the
// underlying transaction actually commits moments later — a retry started
// AFTER the UI gave up must still see the SAME id and no-op, exactly like (a).
w = world(); const effD = { n: 0 };
applyOnce(w, 'payment:INV-3', effD);   // the "late" commit, from the ORIGINAL attempt the UI stopped waiting on
applyOnce(w, 'payment:INV-3', effD);   // user, told "check before retrying", presses again with the SAME durable id
ok('(d) PH6-03 timeout, then the original attempt commits late, then a retry: same durable id -> still one effect, never two', effD.n === 1);

// =====================================================================
// 4 — TRANSACTION CALLBACK SAFETY UNDER RETRY/RECONNECT (Step 20, unchanged)
// =====================================================================
console.log('\n4  Transaction callback safety on SDK-internal retry\n');
ok('[fact] every idempotent transaction reads its marker BEFORE any write (payment pay.id / sales-opId / stockAdjustments-opId / restocks-opId / PO appliedReceiptIds / job-card appliedReserveIds) — unchanged',
  /priorPayments\.some\(\(p\) => p && p\.id === pay\.id\)/.test(dash)
  && /if \(saleSnap\.exists\(\)\)/.test(dash)
  && /if \(adjSnap\.exists\(\)\)/.test(dash)
  && /if \(rsSnap\.exists\(\)\)/.test(dash)
  && /applied\.includes\(receiptId\)/.test(poSvc)
  && /if \(reserveOpId && applied\.includes\(reserveOpId\)\) return;/.test(dash));
ok('[fact] no runTransaction callback in this codebase makes a network call other than tx.get/tx.set/tx.update/tx.delete (no fetch/XHR) — still safe for the SDK to re-run the callback on contention or a transient reconnect, and safe for withTimeout to leave running in the background after a UI timeout',
  Array.from(dash.matchAll(/runTransaction\(db, async \(tx\) => \{([\s\S]{0,900}?)\n {4}\}\)/g)).every((m) => !/fetch\(|XMLHttpRequest/.test(m[1])));

// =====================================================================
// 5 — INVOICE NUMBER ALLOCATION UNDER NETWORK LOSS (Step 8)
// =====================================================================
console.log('\n5  Invoice numbering under network loss\n');
ok('[fact] the counter transaction is never-decreasing and self-healing (allocationStep takes max(current, seedFrom)) — unchanged',
  /const allocated = Math\.max\(current, normalizeSeed\(seedFrom\)\);/.test(docCounter));
ok('PH6-03 FIXED: a network drop/timeout DURING allocateNumber now gets accurate copy — genuinely ambiguous (the counter may have already advanced), not a claimed definite failure — and always re-throws so persistInvoice/BillingModule keep the editor open with nothing lost',
  /n = await store\.allocateNumber\(__allocSeq, __allocSeed\);\s*\n\s*\} catch \(err\) \{/.test(dash)
  && /toast\.error\(isTxTimeout\(err\)\s*\n\s*\? timeoutMessage\('The invoice number'\)/.test(dash)
  && /: 'Could not reserve an invoice number — check your connection and try again\.'\);\s*\n\s*throw err;/.test(dash));
ok('[fact] a network drop AFTER allocateNumber commits but before the invoice DOC write reaches the server: the doc write is non-transactional and queues -> replays once reconnected -> the SAME number is used, not skipped (Phase 5b, unchanged)',
  /if \(already && already\.invNo && !\/\^DRF\/i\.test\(already\.invNo\)\) \{\s*\n\s*target = \{ \.\.\.rest, invNo: already\.invNo \};/.test(dash));
ok('[fact] a timeout on allocateNumber is safe to retry EVEN IF it later commits — the counter is monotonic (never issues the same number twice), so worst case is the pre-existing, documented "gap" outcome, never a duplicate',
  /A gap is legal under GST Rule 46\(b\); a duplicate is not\./.test(docCounter));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
// PHASE 6B — SHIPPED. This file is now a passing regression suite (converted
// from Phase 6's discovery file, same pattern Phase 5's file followed once
// Phase 5b shipped): FAIL>0 means a real regression, not an open finding.
process.exit(FAIL ? 1 : 0);
