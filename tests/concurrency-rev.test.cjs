/**
 * tests/concurrency-rev.test.cjs
 *
 * CONCURRENCY PHASE 1a — revision-guarded entity saves.
 *
 * The authoritative data-integrity net: a client that opened a record at
 * revision N can never silently overwrite the server once another client has
 * saved it (revision N+1). Reproduced live in the production concurrency test
 * (customers, parts, suppliers, job cards, invoices all last-write-wins).
 *
 * Fix: every entity EDIT now runs through a Firestore transaction that
 *   1. re-reads the current server document
 *   2. rejects with conc/deleted if it is gone (no set(merge) resurrection)
 *   3. rejects with conc/stale if its `_rev` moved under the editor
 *   4. otherwise merges the edit and sets `_rev` = server._rev + 1
 * Legacy documents with no `_rev` read as revision 0 — no migration.
 *
 * This suite exercises the pure decision (lib/concurrency.revState) and the
 * demo backend's saveGuarded (identical `_rev` bookkeeping, in-memory), and
 * asserts every production editor is wired to the guarded path.
 */
require('./setup.cjs');
const fs = require('fs');
const path = require('path');

// demo store needs Web Storage; jsdom doesn't wire it to global.
const mem = {};
const shim = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; },
  clear: () => { Object.keys(mem).forEach((k) => delete mem[k]); },
};
global.localStorage = shim;
global.sessionStorage = shim;

const { revState, revOf, isConcurrencyError, CONC_STALE, CONC_DELETED } = require('../lib/concurrency');
const { createStore } = require('../services/persistenceStore');
const { STORAGE } = require('../constants');

// demo backing-store keys (persistenceStore.DEMO_KEY)
const K = {
  customers: STORAGE.DEMO_CUSTOMERS,
  parts: STORAGE.DEMO_INVENTORY,
  suppliers: STORAGE.DEMO_SUPPLIERS,
  invoices: STORAGE.DEMO_INVOICES,
  jobCards: STORAGE.DEMO_JOB_CARDS,
};
const seed = (coll, rows) => { mem[K[coll]] = JSON.stringify(rows); };
const rows = (coll) => JSON.parse(mem[K[coll]] || '[]');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const store = createStore(true); // demo backend — same _rev logic, no Firestore

console.log('\nCONCURRENCY PHASE 1a — revision-guarded entity saves\n');

// ── A. revision initialization / legacy docs ────────────────────────────────
ok('A: a document with no `_rev` reads as revision 0', revOf({}) === 0 && revOf({ name: 'x' }) === 0);
ok('A: a non-integer / negative `_rev` reads as revision 0', revOf({ _rev: 'nope' }) === 0 && revOf({ _rev: -2 }) === 0 && revOf({ _rev: 1.5 }) === 0);
ok('A: revState on a legacy doc (no _rev) with expectedRev 0 → OK, nextRev 1',
  JSON.stringify(revState({ name: 'x' }, 0)) === JSON.stringify({ conflict: null, serverRev: 0, nextRev: 1 }));
ok('A: revState treats a missing expectedRev as 0', revState({ _rev: 0 }, undefined).conflict === null);

seed('customers', [{ id: 'legacy1', name: 'Legacy', phone: '9000000001' }]); // NO _rev
(async () => {
  const first = await store.saveGuarded('customers', { id: 'legacy1', name: 'Legacy EDITED', phone: '9000000001' }, 0, { label: 'This customer' });
  ok('A: first guarded save of a legacy doc succeeds and writes _rev: 1', first._rev === 1);
  ok('A: the edit landed', rows('customers')[0].name === 'Legacy EDITED');

  // ── B. successful save from rev N → N+1 ──────────────────────────────────
  seed('customers', [{ id: 'c5', name: 'Start', _rev: 5 }]);
  const b = await store.saveGuarded('customers', { id: 'c5', name: 'Saved by A' }, 5, {});
  ok('B: save from rev 5 succeeds', b._rev === 6);
  ok('B: resulting stored _rev is 6', rows('customers')[0]._rev === 6);

  // ── C. exactly one increment ────────────────────────────────────────────
  seed('parts', [{ id: 'p1', name: 'Part', stock: 10, _rev: 3 }]);
  await store.saveGuarded('parts', { id: 'p1', name: 'Part v2' }, 3, {});
  ok('C: one successful save increments _rev exactly once (3 → 4)', rows('parts')[0]._rev === 4);
  ok('C: unrelated field not in the payload is preserved (merge)', rows('parts')[0].stock === 10);

  // ── D. same-field conflict ──────────────────────────────────────────────
  seed('customers', [{ id: 'cD', occupation: 'orig', _rev: 5 }]);
  await store.saveGuarded('customers', { id: 'cD', occupation: 'Mechanic A' }, 5, {}); // A saves → rev 6
  let staleErr = null;
  try { await store.saveGuarded('customers', { id: 'cD', occupation: 'Mechanic B' }, 5, {}); } catch (e) { staleErr = e; }
  ok('D: B\'s save from the now-stale rev 5 is rejected', isConcurrencyError(staleErr) && staleErr.code === CONC_STALE);
  ok('D: A\'s value survived — B did NOT overwrite it', rows('customers')[0].occupation === 'Mechanic A');
  ok('D: the record was not touched by B (still rev 6)', rows('customers')[0]._rev === 6);

  // ── E. different-field conflict — unrelated field still lost the OLD way ──
  seed('suppliers', [{ id: 'sE', name: 'S', city: 'CityOrig', email: 'orig@x.co', _rev: 2 }]);
  await store.saveGuarded('suppliers', { id: 'sE', name: 'S', city: 'CITY-BY-A', email: 'orig@x.co' }, 2, {}); // A: city
  let e2 = null;
  try { await store.saveGuarded('suppliers', { id: 'sE', name: 'S', city: 'CityOrig', email: 'B@x.co' }, 2, {}); } catch (e) { e2 = e; }
  ok('E: B changing a DIFFERENT field is still rejected (rev moved)', isConcurrencyError(e2) && e2.code === CONC_STALE);
  const sE = rows('suppliers')[0];
  ok('E: A\'s complete latest record is intact', sE.city === 'CITY-BY-A' && sE.email === 'orig@x.co' && sE._rev === 3);

  // ── F. three-client stale conflict ──────────────────────────────────────
  seed('customers', [{ id: 'cF', v: 'base', _rev: 5 }]);
  await store.saveGuarded('customers', { id: 'cF', v: 'A' }, 5, {}); // A → rev 6
  let bF = null, cF = null;
  try { await store.saveGuarded('customers', { id: 'cF', v: 'B' }, 5, {}); } catch (e) { bF = e; }
  try { await store.saveGuarded('customers', { id: 'cF', v: 'C' }, 5, {}); } catch (e) { cF = e; }
  ok('F: B rejected', bF && bF.code === CONC_STALE);
  ok('F: C rejected', cF && cF.code === CONC_STALE);
  ok('F: A\'s value stands, rev 6', rows('customers')[0].v === 'A' && rows('customers')[0]._rev === 6);

  // ── G + H. delete vs edit — rejected, no resurrection ───────────────────
  seed('parts', [{ id: 'pG', name: 'Doomed', stock: 4, _rev: 1 }]);
  seed('parts', rows('parts').filter((r) => r.id !== 'pG')); // B deletes
  let delErr = null;
  try { await store.saveGuarded('parts', { id: 'pG', name: 'Doomed EDITED', sellingPrice: 999 }, 1, { label: 'This part' }); } catch (e) { delErr = e; }
  ok('G: A\'s stale save on the deleted part is rejected with conc/deleted', isConcurrencyError(delErr) && delErr.code === CONC_DELETED);
  ok('H: the deleted document was NOT recreated', !rows('parts').some((r) => r.id === 'pG'));

  // ── I. nested customer vehicle conflict ─────────────────────────────────
  seed('customers', [{ id: 'cV', name: 'V', vehicles: [{ id: 'v1', regNo: 'AP01' }], _rev: 5 }]);
  await store.saveGuarded('customers', { id: 'cV', name: 'V', vehicles: [{ id: 'v1', regNo: 'AP01' }, { id: 'v2', regNo: 'AP02' }] }, 5, {}); // A adds a vehicle
  let vErr = null;
  try { await store.saveGuarded('customers', { id: 'cV', name: 'V RENAMED', vehicles: [{ id: 'v1', regNo: 'AP01' }] }, 5, {}); } catch (e) { vErr = e; }
  ok('I: B\'s stale customer save is rejected — A\'s new vehicle is not lost', vErr && vErr.code === CONC_STALE);
  ok('I: A\'s vehicle addition is intact (2 vehicles)', rows('customers')[0].vehicles.length === 2);

  // ── J. per-entity wiring: every production editor routes through the guarded path ──
  const dash = read('../components/InventoryDashboard.js');
  const store_src = read('../services/persistenceStore.js');
  const repo_src = read('../repositories/firestoreRepository.js');
  const cust_src = read('../components/customers/CustomersModule.jsx');

  ok('J: repository exposes a transactional guardedSet (runTransaction + tx.get + existence + rev check)',
    /export async function guardedSet\(/.test(repo_src)
    && /runTransaction\(db, async \(tx\) => \{/.test(repo_src)
    && /const snap = await tx\.get\(ref\)/.test(repo_src)
    && /revState\(snap\.exists\(\) \? snap\.data\(\) : null, expectedRev\)/.test(repo_src)
    && /_rev: state\.nextRev/.test(repo_src));
  ok('J: persistenceStore exposes saveGuarded on BOTH backends',
    (store_src.match(/async saveGuarded\(/g) || []).length === 2);
  ok('J: Parts editor save is guarded', /store\.saveGuarded\(COLLECTIONS\.PARTS, \{ \.\.\.payload, id: formData\.id \}, revOf\(formData\)/.test(dash));
  ok('J: Suppliers editor save is guarded', /store\.saveGuarded\(COLLECTIONS\.SUPPLIERS, \{ \.\.\.payload, id: formData\.id \}, revOf\(formData\)/.test(dash));
  ok('J: Job Cards editor save is guarded (keyed by jobNo)', /store\.saveGuarded\(COLLECTIONS\.JOB_CARDS, card, revOf\(card\), \{ idField: 'jobNo'/.test(dash));
  ok('J: Invoices editor save is guarded (payment path untouched)',
    /store\.saveGuarded\(COLLECTIONS\.INVOICES, iv, revOf\(iv\)/.test(dash)
    && /collectInvoicePayment/.test(dash));
  ok('J: Customers editor save is guarded via onSaveCustomerEdit → saveCustomerEdit → store.saveGuarded',
    /const saveCustomerEdit = useCallback\(async \(record, expectedRev\) => \{[\s\S]{0,300}store\.saveGuarded\(COLLECTIONS\.CUSTOMERS, record, expectedRev/.test(dash)
    && /onSaveCustomerEdit=\{saveCustomerEdit\}/.test(dash)
    && /if \(existingCust && onSaveCustomerEdit\)/.test(cust_src)
    && /await onSaveCustomerEdit\(\{ \.\.\.c, history: hist \}/.test(cust_src));

  // ── K. the payment fix (78794dc) still there and now participates in _rev ──
  ok('K: BUG-CONC-01 payment transaction remains, and bumps _rev so an open invoice editor is rejected as stale',
    /const collectInvoicePayment = async \(invoiceId, pay\) => \{/.test(dash)
    && /const nextRev = revOf\(data\) \+ 1;/.test(dash)
    && /_rev: nextRev,/.test(dash));

  // ── L. editors carry the _rev they opened with ─────────────────────────
  ok('L: PartModal carries part._rev on save', /out\._rev = part\?\._rev;/.test(dash));
  ok('L: SupplierModal carries supplier._rev on save', /_rev: supplier\?\._rev \}/.test(dash));

  // ── M. no editLocks / heartbeat / session infra (Phase 1b is separate) ──
  ok('M: Phase 1a introduced no edit-lock machinery (that is Phase 1b)',
    !/editLocks|editLease|acquireLease|lockOwner|acquireLock/i.test(dash + store_src + repo_src + read('../lib/concurrency.js') + cust_src));
  ok('M: firestore.rules unchanged (no lock collection / lease rules)',
    !/editLocks|Lease|editLock/.test(read('../firestore.rules')));

  console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
  process.exit(FAIL ? 1 : 0);
})();
