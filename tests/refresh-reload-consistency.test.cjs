/**
 * tests/refresh-reload-consistency.test.cjs
 *
 * PHASE 5b — REFRESH / RELOAD RELIABILITY regression suite.
 *
 * Phase 5 discovery proved that a browser refresh followed by a retry could
 * duplicate a money/stock transaction, because every Phase 4b operation id lived
 * in a `useRef` the reload destroyed. Phase 5b makes the identity DURABLE
 * (sessionStorage, via lib/durableOpId) and fixes the invoice-draft identity.
 *
 * This file now asserts the FIXED behaviour:
 *   INVARIANT: one logical business intent + refresh/reload/lost-response + retry
 *              = AT MOST one business effect; two genuinely separate intents still
 *              produce two effects.
 *
 * Method: source-pattern audit + a pure re-implementation of the durable-opId
 * lifecycle. The real emulator "commit -> lost response -> recover id -> retry ->
 * one effect" proof is in tests/rules/firestore.rules.test.cjs (§ PHASE 5b).
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
const jc = read('../components/jobcards/JobCardModule.jsx');
const poUI = read('../components/inventory/InventoryPurchaseOrders.jsx');
const firebase = read('../lib/firebase.js');
const repo = read('../repositories/firestoreRepository.js');
const store = read('../services/persistenceStore.js');
const durable = read('../lib/durableOpId.js');
const hook = read('../hooks/useDurableOpId.js');
const known = read('../docs/KNOWN_LIMITATIONS.md');
const poSvc = read('../services/purchaseOrderService.js');

console.log('\nPHASE 5b — refresh / reload reliability\n');

// =====================================================================
// 0 — PERSISTENCE MODEL
// =====================================================================
console.log('0  Persistence model\n');
ok('[fact] Firestore uses persistentLocalCache + multi-tab manager',
  /persistentLocalCache\(\{\s*tabManager:\s*persistentMultipleTabManager\(\)\s*\}\)/.test(firebase));
ok('[fact] non-transactional writes replay on reload; runTransaction does NOT (guardedSet is a transaction)',
  // Phase 6b (PH6-03) — withTimeout(...) wraps the transaction; behavior unchanged.
  /export async function guardedSet\([\s\S]{0,700}withTimeout\(runTransaction\(db, async \(tx\) => \{/.test(repo));
ok('[fact] new-entity create via syncAll is a writeBatch set{merge} (replays on reload; keyed by client id)',
  /batchOps\.push\(\{\s*\n?\s*type: 'set',\s*\n?\s*collection: collectionName,[\s\S]{0,220}merge: true,/.test(store));

// =====================================================================
// 1 — DURABLE OPERATION IDENTITY (lib/durableOpId + hook)
// =====================================================================
console.log('\n1  Durable operation identity\n');
ok('lib/durableOpId stores the id in sessionStorage (survives a tab refresh, gone on tab close)',
  /sessionStorage\.getItem\(key\)/.test(durable) && /sessionStorage\.setItem\(key, JSON\.stringify\(\{ opId, pi: getPageInstanceId\(\) \}\)\)/.test(durable));
// Phase 7b (PH7-01) — readOrCreateOpId now also verifies the stored entry was
// tagged by THIS page instance (window.name-derived, survives-reload/reset-on-
// new-context) before trusting it as "my own earlier attempt" — see the
// PHASE 7B section below for the full tab-duplication-safety proof. The
// same-tab recovery guarantee this assertion checks is unchanged.
ok('readOrCreateOpId returns the stored id if present AND tagged by this page instance (a recovery), else mints + stores one',
  /if \(entry && \(pi === null \|\| entry\.pi === pi\)\) return entry\.opId;/.test(durable));
ok('peekOpId reports whether an unconfirmed prior attempt exists; clearOpId retires it',
  /export function peekOpId\(scope\)/.test(durable) && /export function clearOpId\(scope\)/.test(durable));
ok('the hook pins the scope on first render and exposes { opId, hadPending, clear }',
  /if \(state\.current === null\)/.test(hook) && /hadPending: state\.current\.hadPending/.test(hook) && /clear: \(\) => clearOpId\(state\.current\.scope\)/.test(hook));
ok('storage-blocked (private mode) degrades to an in-memory id, never throws',
  /catch \{\s*\n?\s*\/\/[\s\S]{0,180}return mint\(prefix\);/.test(durable));

// pure model of the lifecycle: a marker set on the server + a durable id store
const makeWorld = () => ({ server: new Set(), session: new Map() });
const readOrCreate = (w, scope) => { if (!w.session.has(scope)) w.session.set(scope, `id_${w.session.size}_${Math.random()}`); return w.session.get(scope); };
const clear = (w, scope) => w.session.delete(scope);
const refresh = (w) => { /* sessionStorage survives a tab reload; only React memory is lost */ };
const applyOnce = (w, scope, effectRef) => {
  const id = readOrCreate(w, scope);
  if (w.server.has(id)) return; // backend marker check — already applied
  w.server.add(id);
  effectRef.n += 1;
};

// C: server commit + lost response + reload + retry  => ONE effect
let w = makeWorld();
const eff = { n: 0 };
applyOnce(w, 'payment:INV-1', eff);      // committed server-side
refresh(w);                              // ack lost; page reloads
applyOnce(w, 'payment:INV-1', eff);      // user retries — recovers the SAME id
ok('C/D (commit -> lost response -> reload -> retry): the effect is applied exactly ONCE',
  eff.n === 1, `effect count = ${eff.n}`);

// E: a genuinely separate second intent (id cleared on the first success) => a second effect
clear(w, 'payment:INV-1');               // first payment confirmed
applyOnce(w, 'payment:INV-1', eff);      // a real second partial payment
ok('E (new intent after the first confirmed): a genuinely separate action still produces its effect',
  eff.n === 2, `effect count = ${eff.n}`);

// F: two different records never collide
applyOnce(w, 'payment:INV-2', eff);
ok('F (different record): a different scope is a different intent',
  eff.n === 3, `effect count = ${eff.n}`);

// =====================================================================
// 2 — PH5-02: money/stock action ops are durable + cleared on a confirmed result
// =====================================================================
console.log('\n2  PH5-02 — payment / receive / sell / adjust / restock\n');
ok('payment: PaymentModal uses useDurableOpId(`payment:${invoice.id}`) and clears it on a confirmed result',
  /useDurableOpId\(`payment:\$\{invoice\.id\}`, 'p'\)/.test(bill)
  && /clearOpId\(`payment:\$\{iv\.id\}`\)/.test(bill));
ok('PO receive: ReceivePOForm uses useDurableOpId(`receive:${po.id}`); receivePO clears it on confirm / alreadyApplied',
  /useDurableOpId\(`receive:\$\{po\?\.id \|\| 'po'\}`, 'rcpt'\)/.test(poUI)
  && /clearOpId\(`receive:\$\{po\.id\}`\)/.test(dash));
ok('quick sell: CheckoutModal uses useDurableOpId(`sell:${part.id}`); handleSell clears it only when online-confirmed',
  /useDurableOpId\(`sell:\$\{part\.id\}`, 'sale'\)/.test(dash)
  && /if \(online\) clearOpId\(`sell:\$\{part\.id\}`\);/.test(dash));
ok('stock adjust: StockAdjustModal uses useDurableOpId(`adjust:${part.id}`); handleAdjustStock clears on confirm',
  /useDurableOpId\(`adjust:\$\{part\.id\}`, 'adj'\)/.test(dash)
  && /clearOpId\(`adjust:\$\{part\.id\}`\); \/\/ Phase 5b — server-confirmed/.test(dash));
ok('ad-hoc restock: RestockModal uses useDurableOpId(`restock:${part.id}`); handleReceiveStock clears on confirm',
  /useDurableOpId\(`restock:\$\{part\.id\}`, 'rs'\)/.test(dash)
  && /clearOpId\(`restock:\$\{part\.id\}`\); \/\/ Phase 5b — server-confirmed/.test(dash));
ok('an AMBIGUOUS failure keeps the id (only a definite non-commit / permission denial clears it)',
  /if \(isDefiniteNoCommit \|\| err\?\.code === 'permission-denied'/.test(dash)
  && /if \(result\.definiteNoCommit\) clearOpId\(`adjust:\$\{part\.id\}`\)/.test(dash));
ok('no Phase 4b action op id is a bare useRef any more',
  !/const payOpIdRef = useRef\(`p_/.test(bill)
  && !/const saleOpIdRef = useRef\(`sale_/.test(dash)
  && !/const adjustOpIdRef = useRef\(`adj_/.test(dash)
  && !/const restockOpIdRef = useRef\(`rs_/.test(dash)
  && !/const receiptIdRef = useRef\(`rcpt_/.test(poUI));
ok('the backend markers Phase 4b added are unchanged (in-session + recovered-id retry both de-dup)',
  /priorPayments\.some\(\(p\) => p && p\.id === pay\.id\)/.test(dash)
  && /if \(saleSnap\.exists\(\)\)/.test(dash)
  && /applied\.includes\(receiptId\)/.test(poSvc)
  && /if \(adjSnap\.exists\(\)\)/.test(dash)
  && /if \(rsSnap\.exists\(\)\)/.test(dash));

// =====================================================================
// 3 — PH5-03: create PO / supplier / part ids are durable
// =====================================================================
console.log('\n3  PH5-03 — create PO / supplier / part\n');
ok('PO create: POCreateForm uses useDurableOpId("create-po"); createPOInner clears it on confirm',
  /useDurableOpId\('create-po', 'po'\)/.test(poUI)
  && /clearPoCreateOp = \(\) => \{ if \(input\.poId\) clearOpId\('create-po'\); \}/.test(dash));
ok('supplier create: SupplierModal uses useDurableOpId("create-supplier"); container clears it on confirm',
  /useDurableOpId\('create-supplier', 'sup'\)/.test(dash)
  && /clearOpId\('create-supplier'\); \/\/ Phase 5b/.test(dash));
ok('part create: PartModal uses useDurableOpId("create-part"); container clears it on confirm',
  /useDurableOpId\('create-part', 'part'\)/.test(dash)
  && /if \(!formData\.id\) clearOpId\('create-part'\);/.test(dash));
ok('the create doc write still targets the client-stable id with setDoc merge (a recovered id re-writes the SAME doc)',
  /await setDoc\(doc\(db, COLLECTIONS\.PARTS, newPartId\)[\s\S]{0,160}\{ merge: true \}\)/.test(dash)
  && /await setDoc\(doc\(db, COLLECTIONS\.SUPPLIERS, newId\), \{ \.\.\.payload, createdAt: serverTimestamp\(\) \}, \{ merge: true \}\)/.test(dash)
  && /if \(poId\) return setDoc\(doc\(db, 'purchaseOrders', String\(poId\)\), data, \{ merge: true \}\)/.test(poSvc));
ok('bulk adjust / bulk receive rows use durable per-part ids too',
  /opId: readOrCreateOpId\(`bulk-adjust:\$\{p\.id\}`, 'adj'\)/.test(dash)
  && /opId: readOrCreateOpId\(`bulk-restock:\$\{part\.id\}`, 'rs'\)/.test(dash));

// pure model: setDoc to a stable, recovered id never duplicates
const docs = {};
const createWithId = (id) => { docs[id] = (docs[id] || 0) + 1; return id; };
w = makeWorld();
let poId = readOrCreate(w, 'create-po');
createWithId(poId); refresh(w); poId = readOrCreate(w, 'create-po'); createWithId(poId); // reload + retry
ok('create then reload + retry -> ONE purchaseOrders doc', Object.keys(docs).length === 1 && docs[poId] === 2 /* merged, not duplicated */);
clear(w, 'create-po');
createWithId(readOrCreate(w, 'create-po')); // a genuinely new PO
ok('a genuinely new create (id cleared) -> a second doc', Object.keys(docs).length === 2);

// =====================================================================
// 4 — PH5-04: job-card reservation has a persistent marker
// =====================================================================
console.log('\n4  PH5-04 — job-card reservation\n');
ok('applyReserveDelta takes a reserveOpId and applies the increment inside a transaction',
  // Phase 6b (PH6-03) — withTimeout(...) wraps each per-part transaction; behavior unchanged.
  /const applyReserveDelta = \(deltaMap, reserveOpId = null\) =>/.test(dash)
  && /Promise\.allSettled\(ids\.map\(\(id\) => withTimeout\(runTransaction\(db, async \(tx\) => \{/.test(dash));
ok('the transaction reads appliedReserveIds BEFORE the increment and skips a known reserveOpId',
  /const applied = Array\.isArray\(snap\.data\(\)\.appliedReserveIds\) \? snap\.data\(\)\.appliedReserveIds : \[\];/.test(dash)
  && /if \(reserveOpId && applied\.includes\(reserveOpId\)\) return;/.test(dash)
  && /appliedReserveIds: \[\.\.\.applied, reserveOpId\]\.slice\(-40\)/.test(dash));
ok('persistJobCard derives a DURABLE reserveOpId (recovered on refresh) and clears it on a confirmed save',
  /const reserveOpId = demoMode \? null : readOrCreateOpId\(reserveScope, 'jcr'\);/.test(dash)
  && /await applyReserveDelta\(reserveDelta\(reserveBaseline, card\), reserveOpId\);/.test(dash)
  && /clearOpId\(reserveScope\); \/\/ Phase 5b/.test(dash));
ok('deleteJobCard also passes a durable reservation-release op id',
  /const relOpId = demoMode \? null : readOrCreateOpId\(relScope, 'jcrd'\);/.test(dash)
  && /await applyReserveDelta\(reserveDelta\(baseline, null\), relOpId\);/.test(dash));

// pure model: reserved increment is applied once across a reload+retry
const partReserved = { P1: 0 };
const applied1 = { P1: [] };
const reserveTxn = (opIdVal, delta) => { if (applied1.P1.includes(opIdVal)) return; applied1.P1.push(opIdVal); partReserved.P1 += delta; };
w = makeWorld();
reserveTxn(readOrCreate(w, 'jc-reserve:JC-9'), 2);  // first save
refresh(w);
reserveTxn(readOrCreate(w, 'jc-reserve:JC-9'), 2);  // reload + retry, recovered id
ok('reservation increment across reload + retry: reserved = 2 (once), not 4', partReserved.P1 === 2);

// =====================================================================
// 5 — PH5-05: commitStock quick-restock ledger row is deterministic
// =====================================================================
console.log('\n5  PH5-05 — commitStock inline stepper\n');
ok('commitStock writes an ABSOLUTE stock value (idempotent on replay/retry)',
  /await updateDoc\(doc\(db, COLLECTIONS\.PARTS, partId\), \{\s*stock: safeStock,/.test(dash));
ok('the quick_restock ledger row is a setDoc to a deterministic id (part + target level) — a retry re-writes the same row',
  /const qrId = `qr_\$\{partId\}_\$\{safeStock\}`;/.test(dash)
  && /await setDoc\(doc\(db, COLLECTIONS\.RESTOCKS, qrId\)/.test(dash));

// =====================================================================
// 6 — PH5-01 / PH5-07: invoice draft identity + walk-in clash
// =====================================================================
console.log('\n6  PH5-01 / PH5-07 — invoice draft + walk-in\n');
ok('invoice draft key is STATIC (maruti_invoice_draft_v2_<env>), not namespaced by the per-open id',
  /const DRAFT_KEY = `maruti_invoice_draft_v2_\$\{demoMode \? 'demo' : 'prod'\}`/.test(bill)
  && !/const DRAFT_KEY = `maruti_invoice_draft_\$\{initial\.id\}`/.test(bill));
ok('the modal ADOPTS the restored draft id (Restore/Discard banner, like every other create form)',
  /setInvRaw\(stripDraftMeta\(d\)\)/.test(bill)
  && /const restoreInvDraft = \(\) =>/.test(bill)
  && /invDraftMeta &&/.test(bill));
ok('a drafted invoice that already committed (retry-after-refresh) clears the draft and is not re-drafted',
  /if \(invoices\.some\(\(x\) => x\.id === d\.id\)\) \{ clearInvDraft\(\); return; \}/.test(bill));
ok('the draft is cleared only on a CONFIRMED save (not on the Save click)',
  /\.then\(\(res\) => \{ if \(res !== false\) \{ try \{ localStorage\.removeItem\(DRAFT_KEY\); \} catch \{\} \} \}\)/.test(bill)
  && !/try \{ localStorage\.removeItem\(DRAFT_KEY\); \} catch \{\}\s*\n\s*\/\/ C-1: the double-submit guard/.test(bill));
ok('persistInvoice reuses an EXISTING number for a retry of the same invoice id — never allocates a second',
  /const already = invoicesRef\.current\.find\(\(x\) => x\.id === iv\.id\);/.test(dash)
  && /if \(already && already\.invNo && !\/\^DRF\/i\.test\(already\.invNo\)\) \{\s*\n\s*target = \{ \.\.\.rest, invNo: already\.invNo \};/.test(dash));
ok('a new WALK-IN invoice with a near-identical recent invoice asks for confirmation (PH5-07 safety net)',
  /Possible duplicate invoice/.test(bill)
  && /!inv\.jobNo && !isPersisted && billItems\.length/.test(bill));
ok('the job-card double-billing hard block is preserved',
  /is already billed on \$\{clash\.invNo\}/.test(bill));

// =====================================================================
// 7 — still refresh-consistent (unchanged, must not regress)
// =====================================================================
console.log('\n7  Unchanged refresh-consistent workflows\n');
ok('customer / part / supplier / jobcard drafts still use STATIC keys and survive a refresh',
  /const DRAFT_KEY = `maruti_customer_draft_v1_/.test(cust)
  && /const DRAFT_KEY = `maruti_part_draft_v1_/.test(dash)
  && /const SUP_DRAFT_KEY = `maruti_supplier_draft_v1_/.test(dash)
  && /const DRAFT_KEY = 'maruti_jobcard_draft_v2'/.test(jc));
ok('customer create still carries its client id in the draft (restore -> same customers/<id>)',
  /id: `c_\$\{Date\.now\(\)\}_\$\{Math\.floor\(Math\.random\(\) \* 1e4\)\}`/.test(cust));
ok('invoice numbers are still allocated at persist time (refresh before save consumes none)',
  /const needsNewNumber = asDraft/.test(bill) && /store\.allocateNumber\(__allocSeq, __allocSeed\)/.test(dash));
ok('runInvoiceTransaction is still diff-based / idempotent',
  /DIFF-BASED, therefore IDEMPOTENT/.test(dash));
ok('deleteInvoice is still !exists-guarded',
  /if \(!snap\.exists\(\)\) return null;/.test(dash));
ok('entity EDIT is still _rev-guarded',
  /const state = revState\(snap\.exists\(\) \? snap\.data\(\) : null, expectedRev\);/.test(repo));
ok('KNOWN_LIMITATIONS.md no longer claims the operation id "does not survive a full browser refresh"',
  !/does not \*\*not\*\* survive a full/i.test(known)
  && !/it does \*\*not\*\* survive a full\n\s*browser refresh/i.test(known));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
