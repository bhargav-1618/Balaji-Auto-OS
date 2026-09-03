/**
 * tests/rules/firestore.rules.test.cjs
 *
 * Firestore Security Rules test suite (H-13). Runs the REAL firestore.rules
 * file against the Firestore Emulator — nothing is re-implemented or mocked.
 * Isolated from the main `npm test` suite: requires the emulator (Java), so
 * it's invoked separately via `npm run test:rules` (firebase emulators:exec
 * starts a fresh emulator, runs this file, tears it down, and propagates the
 * exit code).
 *
 * Rule patterns covered (see firestore.rules for the authoritative source):
 *   - "catalog" pattern (parts/suppliers/categories/vehicles/customers/
 *     invoices/jobCards/purchaseOrders all share it): read/create/update by
 *     any signed-in user, delete admin-only. Exercised via `parts` and
 *     `customers` as representatives.
 *   - append-only ledger pattern (sales/restocks/stockAdjustments/auditLog):
 *     read/create signed-in, update ALWAYS false, delete admin-only.
 *     Exercised via `sales`.
 *   - appSettings: the privilege-escalation fix — read signed-in, but
 *     create/update admin-ONLY, so staff can no longer grant themselves
 *     admin by writing appSettings/roles directly.
 *   - recoveryVault: admin-only read/create/delete, update always false.
 *   - the owner-email bypass (ownerEmail() in firestore.rules) that keeps
 *     the permanent owner admin even with no appSettings/roles doc at all.
 *   - the deny-by-default fallback for any unlisted path.
 */
const {
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  runTransaction, increment, Timestamp,
} = require('firebase/firestore');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { makeTestEnv, seedAdmins, seedDoc, OWNER_EMAIL, ADMIN_EMAIL, STAFF_EMAIL } = require('./helpers.cjs');
// Pure, firebase-free — safe to import into the rules-test SDK context.
const { applyPoReceive } = require('../../lib/poReceive.js');

// lib/concurrency.js is ES-module; inline a faithful copy of the ONE pure helper
// this test needs (same contract, same code — see lib/concurrency.js replayIdArray).
function replayIdArray(before, after, server) {
  const b = Array.isArray(before) ? before : [];
  const a = Array.isArray(after) ? after : [];
  const s = Array.isArray(server) ? server : [];
  const beforeById = new Map(b.filter((x) => x && x.id != null).map((x) => [x.id, x]));
  const afterById = new Map(a.filter((x) => x && x.id != null).map((x) => [x.id, x]));
  const removedIds = new Set(b.filter((x) => x && x.id != null && !afterById.has(x.id)).map((x) => x.id));
  const out = [];
  const seen = new Set();
  for (const el of s) {
    const id = el && el.id;
    if (id != null && removedIds.has(id)) continue;
    if (id != null) seen.add(id);
    const mine = id != null ? afterById.get(id) : undefined;
    const orig = id != null ? beforeById.get(id) : undefined;
    if (mine && orig && JSON.stringify(mine) !== JSON.stringify(orig)) out.push(mine);
    else out.push(el);
  }
  for (const el of a) {
    const id = el && el.id;
    if (id != null && !beforeById.has(id) && !seen.has(id)) { out.push(el); seen.add(id); }
  }
  return out;
}

let PASS = 0, FAIL = 0;
const ok = (n, c) => { if (c) { PASS++; console.log(`  ok ${n}`); } else { FAIL++; console.log(`  FAIL ${n}`); } };

const allow = async (p) => { try { await assertSucceeds(p); return true; } catch { return false; } };
const deny = async (p) => { try { await assertFails(p); return true; } catch { return false; } };

async function main() {
  const testEnv = await makeTestEnv();

  try {
    // =========================================================================
    // Anonymous user — denied protected operations
    // =========================================================================
    await testEnv.clearFirestore();
    {
      const db = testEnv.unauthenticatedContext().firestore();
      ok('anon: read parts denied', await deny(getDoc(doc(db, 'parts/p1'))));
      ok('anon: create parts denied', await deny(setDoc(doc(db, 'parts/p1'), { name: 'X' })));
      ok('anon: read appSettings/roles denied', await deny(getDoc(doc(db, 'appSettings/roles'))));
      ok('anon: read/write on an unlisted collection denied', await deny(getDoc(doc(db, 'somethingUnlisted/x'))));
    }

    // =========================================================================
    // "Catalog" pattern — parts, customers (representative of 8 collections
    // that share this exact rule: read/create/update signedIn, delete admin)
    // =========================================================================
    await testEnv.clearFirestore();
    {
      const staffDb = testEnv.authenticatedContext('staff-uid', { email: STAFF_EMAIL }).firestore();
      await seedDoc(testEnv, 'parts/p1', { name: 'Radiator', stock: 5 });
      await seedDoc(testEnv, 'customers/c1', { name: 'Ravi Kumar' });

      ok('staff: read parts allowed', await allow(getDoc(doc(staffDb, 'parts/p1'))));
      ok('staff: create parts allowed', await allow(setDoc(doc(staffDb, 'parts/p2'), { name: 'Brake Pad' })));
      ok('staff: update parts allowed', await allow(updateDoc(doc(staffDb, 'parts/p1'), { stock: 4 })));
      ok('staff: delete parts denied (admin-only)', await deny(deleteDoc(doc(staffDb, 'parts/p1'))));

      ok('staff: read customers allowed', await allow(getDoc(doc(staffDb, 'customers/c1'))));
      ok('staff: create customers allowed', await allow(setDoc(doc(staffDb, 'customers/c2'), { name: 'Anu' })));
      ok('staff: delete customers denied (admin-only)', await deny(deleteDoc(doc(staffDb, 'customers/c1'))));
    }

    // Admin (listed in appSettings/roles.admins) CAN delete.
    await testEnv.clearFirestore();
    {
      await seedAdmins(testEnv, [ADMIN_EMAIL]);
      await seedDoc(testEnv, 'parts/p1', { name: 'Radiator' });
      const adminDb = testEnv.authenticatedContext('admin-uid', { email: ADMIN_EMAIL }).firestore();
      ok('admin: delete parts allowed', await allow(deleteDoc(doc(adminDb, 'parts/p1'))));
    }

    // =========================================================================
    // Append-only ledger pattern — sales (representative of sales/restocks/
    // stockAdjustments/auditLog): read/create signedIn, update ALWAYS false.
    // =========================================================================
    await testEnv.clearFirestore();
    {
      await seedAdmins(testEnv, [ADMIN_EMAIL]);
      await seedDoc(testEnv, 'sales/s1', { amount: 1000 });
      const staffDb = testEnv.authenticatedContext('staff-uid', { email: STAFF_EMAIL }).firestore();
      const adminDb = testEnv.authenticatedContext('admin-uid', { email: ADMIN_EMAIL }).firestore();

      ok('staff: create sales allowed', await allow(setDoc(doc(staffDb, 'sales/s2'), { amount: 500 })));
      ok('staff: update sales denied (append-only, not even for staff)', await deny(updateDoc(doc(staffDb, 'sales/s1'), { amount: 999 })));
      ok('admin: update sales STILL denied (append-only overrides admin)', await deny(updateDoc(doc(adminDb, 'sales/s1'), { amount: 999 })));
      ok('staff: delete sales denied (admin-only)', await deny(deleteDoc(doc(staffDb, 'sales/s1'))));
      ok('admin: delete sales allowed', await allow(deleteDoc(doc(adminDb, 'sales/s1'))));
    }

    // =========================================================================
    // appSettings — THE privilege-escalation fix under test. Staff must not
    // be able to write appSettings/roles (which is how admin status itself
    // is granted) even though they can read it and write everything else.
    // =========================================================================
    await testEnv.clearFirestore();
    {
      await seedAdmins(testEnv, [ADMIN_EMAIL]);
      const staffDb = testEnv.authenticatedContext('staff-uid', { email: STAFF_EMAIL }).firestore();
      const adminDb = testEnv.authenticatedContext('admin-uid', { email: ADMIN_EMAIL }).firestore();

      ok('staff: read appSettings/roles allowed', await allow(getDoc(doc(staffDb, 'appSettings/roles'))));
      ok('staff: cannot self-promote by writing appSettings/roles', await deny(updateDoc(doc(staffDb, 'appSettings/roles'), { admins: [STAFF_EMAIL, ADMIN_EMAIL] })));
      ok('staff: cannot create a NEW appSettings doc either', await deny(setDoc(doc(staffDb, 'appSettings/other'), { x: 1 })));
      ok('admin: CAN update appSettings/roles', await allow(updateDoc(doc(adminDb, 'appSettings/roles'), { admins: [ADMIN_EMAIL, STAFF_EMAIL] })));
      ok('nobody: delete appSettings denied (delete: false, unconditional)', await deny(deleteDoc(doc(adminDb, 'appSettings/roles'))));
    }

    // =========================================================================
    // recoveryVault — admin-only surface entirely.
    // =========================================================================
    await testEnv.clearFirestore();
    {
      await seedAdmins(testEnv, [ADMIN_EMAIL]);
      const staffDb = testEnv.authenticatedContext('staff-uid', { email: STAFF_EMAIL }).firestore();
      const adminDb = testEnv.authenticatedContext('admin-uid', { email: ADMIN_EMAIL }).firestore();

      ok('staff: read recoveryVault denied', await deny(getDoc(doc(staffDb, 'recoveryVault/v1'))));
      ok('staff: create recoveryVault denied', await deny(setDoc(doc(staffDb, 'recoveryVault/v1'), { snap: {} })));
      ok('admin: create recoveryVault allowed', await allow(setDoc(doc(adminDb, 'recoveryVault/v1'), { snap: {} })));
      ok('admin: update recoveryVault denied (update: false, unconditional)', await deny(updateDoc(doc(adminDb, 'recoveryVault/v1'), { snap: { x: 1 } })));
      ok('admin: delete recoveryVault allowed', await allow(deleteDoc(doc(adminDb, 'recoveryVault/v1'))));
    }

    // =========================================================================
    // Owner-email bypass — the permanent owner is always admin, even with NO
    // appSettings/roles document at all (can never be locked out).
    // =========================================================================
    await testEnv.clearFirestore();
    {
      // Deliberately NOT seeding appSettings/roles at all.
      await seedDoc(testEnv, 'parts/p1', { name: 'Radiator' });
      const ownerDb = testEnv.authenticatedContext('owner-uid', { email: OWNER_EMAIL }).firestore();
      const staffDb = testEnv.authenticatedContext('staff-uid', { email: STAFF_EMAIL }).firestore();

      ok('owner: delete parts allowed with NO appSettings/roles doc present', await allow(deleteDoc(doc(ownerDb, 'parts/p1'))));
      ok('non-owner staff: delete parts still denied with no roles doc', await deny(deleteDoc(doc(staffDb, 'parts/nonexistent'))));
    }

    // =========================================================================
    // =========================================================================
    // editLocks — CONCURRENCY PHASE 1b single-active-editor lease. A UX
    // coordination lock; it must not be stealable or corruptible from a raw
    // client (Phase 1a `_rev` stays the data-integrity authority regardless).
    // =========================================================================
    await testEnv.clearFirestore();
    {
      const future = () => Timestamp.fromMillis(Date.now() + 90 * 1000);   // valid 90s lease
      const farFuture = () => Timestamp.fromMillis(Date.now() + 30 * 60 * 1000); // 30 min — too long
      const past = () => Timestamp.fromMillis(Date.now() - 60 * 1000);      // already expired

      const aDb = testEnv.authenticatedContext('uid-A', { email: STAFF_EMAIL }).firestore();
      const bDb = testEnv.authenticatedContext('uid-B', { email: ADMIN_EMAIL }).firestore();
      const lock = (db) => doc(db, 'editLocks/customers__c1');
      const lockData = (uid, exp) => ({ ownerUid: uid, ownerEmail: 'x', sessionId: 's1', acquiredAt: Timestamp.now(), heartbeatAt: Timestamp.now(), expiresAt: exp });

      ok('editLocks: read allowed for any signed-in user',
        await allow(getDoc(lock(aDb))));
      ok('editLocks: A creates a lease for itself with a valid expiry — allowed',
        await allow(setDoc(lock(aDb), lockData('uid-A', future()))));

      await testEnv.clearFirestore();
      ok('editLocks: create with ownerUid != auth.uid — DENIED',
        await deny(setDoc(lock(aDb), lockData('uid-SOMEONE-ELSE', future()))));
      ok('editLocks: create with a past expiry — DENIED (must be an active lease)',
        await deny(setDoc(lock(aDb), lockData('uid-A', past()))));
      ok('editLocks: create with a >3-minute expiry — DENIED (cannot claim a record forever)',
        await deny(setDoc(lock(aDb), lockData('uid-A', farFuture()))));

      // Active lease held by A
      await testEnv.clearFirestore();
      await seedDoc(testEnv, 'editLocks/customers__c1', lockData('uid-A', future()));
      ok('editLocks: A renews its OWN active lease (heartbeat) — allowed',
        await allow(setDoc(lock(aDb), lockData('uid-A', future()))));
      ok('editLocks: B updating A\'s ACTIVE lease (theft) — DENIED',
        await deny(setDoc(lock(bDb), lockData('uid-B', future()))));
      ok('editLocks: B deleting A\'s ACTIVE lease — DENIED',
        await deny(deleteDoc(lock(bDb))));
      ok('editLocks: A releases its own lease (delete) — allowed',
        await allow(deleteDoc(lock(aDb))));

      // Expired lease left by A
      await testEnv.clearFirestore();
      await seedDoc(testEnv, 'editLocks/customers__c1', lockData('uid-A', past()));
      ok('editLocks: B takes over an EXPIRED lease, becoming the owner — allowed',
        await allow(setDoc(lock(bDb), lockData('uid-B', future()))));
      await seedDoc(testEnv, 'editLocks/customers__c1', lockData('uid-A', past()));
      ok('editLocks: B taking over an expired lease but writing SOMEONE ELSE as owner — DENIED',
        await deny(setDoc(lock(bDb), lockData('uid-C', future()))));
      await seedDoc(testEnv, 'editLocks/customers__c1', lockData('uid-A', past()));
      ok('editLocks: anyone may clear an EXPIRED lease (crash cleanup) — allowed',
        await allow(deleteDoc(lock(bDb))));

      ok('editLocks: unauthenticated create — DENIED',
        await deny(setDoc(doc(testEnv.unauthenticatedContext().firestore(), 'editLocks/customers__c1'), lockData('uid-A', future()))));
    }

    // =========================================================================
    // counters/<sequence> — CONCURRENCY PHASE 2 document-number allocator.
    // { next: <int> } advanced by a client transaction (lib/docCounter.js). The
    // rules must let any signed-in user READ + ADVANCE it, but never DECREMENT,
    // DELETE, or add fields — that monotonic guarantee is what stops duplicate
    // invoice serials.
    // =========================================================================
    await testEnv.clearFirestore();
    {
      const aDb = testEnv.authenticatedContext('uid-A', { email: STAFF_EMAIL }).firestore();
      const anon = testEnv.unauthenticatedContext().firestore();
      const ctr = (db) => doc(db, 'counters/invoices');

      // ---- rule shape ----
      ok('counters: anon read DENIED', await deny(getDoc(ctr(anon))));
      ok('counters: signed-in read allowed', await allow(getDoc(ctr(aDb))));
      ok('counters: first allocation — create { next: 8 } allowed', await allow(setDoc(ctr(aDb), { next: 8 })));
      await testEnv.clearFirestore();
      ok('counters: create { next: 0 } DENIED (must be a positive serial)', await deny(setDoc(ctr(aDb), { next: 0 })));
      ok('counters: create with an extra field DENIED', await deny(setDoc(ctr(aDb), { next: 8, owner: 'x' })));
      ok('counters: anon create DENIED', await deny(setDoc(ctr(anon), { next: 8 })));

      await seedDoc(testEnv, 'counters/invoices', { next: 8 });
      ok('counters: advance next 8 -> 9 allowed', await allow(setDoc(ctr(aDb), { next: 9 }, { merge: true })));
      await seedDoc(testEnv, 'counters/invoices', { next: 8 });
      ok('counters: rewrite next 8 -> 8 allowed (no-op — keeps transaction retries from failing as permission-denied)',
        await allow(setDoc(ctr(aDb), { next: 8 }, { merge: true })));
      ok('counters: DECREMENT next 8 -> 3 DENIED (would cause duplicate serials)', await deny(setDoc(ctr(aDb), { next: 3 }, { merge: true })));
      ok('counters: update adding a field DENIED', await deny(setDoc(ctr(aDb), { next: 20, note: 'x' }, { merge: true })));
      ok('counters: update next to a non-int DENIED', await deny(setDoc(ctr(aDb), { next: 9.5 }, { merge: true })));
      ok('counters: DELETE DENIED (losing the counter restarts the sequence)', await deny(deleteDoc(ctr(aDb))));

      // ---- §9/§10/§11 — concurrent allocation from independent clients ----
      // The exact allocation transaction from lib/docCounter.js, replicated here
      // (the rules-test SDK can't import the app's lib/firebase). Clients fire it
      // at once against a shared counter; the emulator serialises the contending
      // transactions with retries.
      const allocate = (db, seedFrom) => runTransaction(db, async (tx) => {
        const ref = doc(db, 'counters/invoices');
        const snap = await tx.get(ref);
        const current = snap.exists() && Number.isInteger(snap.data().next) ? snap.data().next : 0;
        const n = Math.max(current, Math.max(1, Math.floor(seedFrom) || 1));
        tx.set(ref, { next: n + 1 });
        return n;
      });
      const bDb = testEnv.authenticatedContext('uid-B', { email: ADMIN_EMAIL }).firestore();
      const cDb = testEnv.authenticatedContext('uid-C', { email: OWNER_EMAIL }).firestore();

      // sequential sanity — counter starts empty, seed 8
      await testEnv.clearFirestore();
      const s1 = await allocate(aDb, 8);
      const s2 = await allocate(bDb, 8);
      const s3 = await allocate(cDb, 8);
      ok('counters: sequential allocation is 8, 9, 10 (no dup, no gap, counter self-seeds)',
        JSON.stringify([s1, s2, s3]) === JSON.stringify([8, 9, 10]), `${s1},${s2},${s3}`);
      ok('counters: after 3 allocations from 8, next = 11', (await getDoc(ctr(aDb))).data().next === 11);

      // 3 clients concurrently
      await testEnv.clearFirestore();
      await seedDoc(testEnv, 'counters/invoices', { next: 8 });
      const got = await Promise.all([allocate(aDb, 5), allocate(bDb, 5), allocate(cDb, 5)]);
      ok('counters: 3 concurrent clients get 3 DISTINCT numbers', new Set(got).size === 3, `got ${JSON.stringify(got)}`);
      ok('counters: the 3 numbers are exactly 8, 9, 10 (sequential, no gap)',
        JSON.stringify([...got].sort((x, y) => x - y)) === JSON.stringify([8, 9, 10]));
      ok('counters: the counter advanced to start + 3 (next = 11)',
        (await getDoc(ctr(aDb))).data().next === 11);

      // a second concurrent burst continues from 11 with no reuse of the first
      const got2 = await Promise.all([allocate(aDb, 1), allocate(bDb, 1)]);
      ok('counters: a second burst continues cleanly (11, 12) with no reuse',
        JSON.stringify([...got2].sort((x, y) => x - y)) === JSON.stringify([11, 12])
        && got2.every((n) => !got.includes(n)));
      ok('counters: after 5 total allocations from 8, next = 13', (await getDoc(ctr(aDb))).data().next === 13);
    }

    // =========================================================================
    // CONCURRENCY PHASE 3b — cross-workflow data-integrity fixes, run against
    // the real emulator with two independent clients. The transaction bodies
    // mirror the app services (the rules-test SDK cannot import lib/firebase),
    // and no rules change was needed — every write is already signed-in-allowed.
    // =========================================================================
    await testEnv.clearFirestore();
    {
      const aDb = testEnv.authenticatedContext('uid-A', { email: STAFF_EMAIL }).firestore();
      const bDb = testEnv.authenticatedContext('uid-B', { email: ADMIN_EMAIL }).firestore();

      // ---- helpers mirroring the app ----
      const invPaid = (data) => {
        const paid = (data.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
        const grand = (data.lines || []).reduce((s, l) => s + Number(l.qty) * Number(l.rate), 0);
        return { paid, grand, balance: grand - paid };
      };
      const isRealized = (iv) => !!iv && !iv.isEstimate
        && !['Cancelled', 'Refunded', 'Returned'].includes(iv.status)
        && iv.grand > 0 && iv.balance <= 0;
      // the Phase 3b collectInvoicePayment transaction — returns its OWN pre-image
      const collectPayment = (db, invId, pay) => runTransaction(db, async (tx) => {
        const ref = doc(db, 'invoices', invId);
        const snap = await tx.get(ref);
        const data = snap.data();
        const serverPrior = { ...data, id: invId, ...invPaid(data) };
        const payments = [...(data.payments || []), pay];
        const merged = { ...data, payments };
        const t = invPaid(merged);
        tx.update(ref, { payments, paid: t.paid, balance: t.balance, status: t.balance <= 0 ? 'Paid' : 'Invoice', _rev: (data._rev || 0) + 1 });
        return { serverPrior, fresh: { ...merged, id: invId, ...t, status: t.balance <= 0 ? 'Paid' : 'Invoice' } };
      });

      // ---- CWF-01 — concurrent payment realizes the invoice exactly once ----
      await testEnv.clearFirestore();
      await seedDoc(testEnv, 'invoices/INV-C1', {
        invNo: 'INV-C1', isEstimate: false, status: 'Invoice', _rev: 0,
        lines: [{ id: 'l1', kind: 'Part', partId: 'pX', qty: 2, rate: 500 }], payments: [],
      });
      const [rA, rB] = await Promise.all([
        collectPayment(aDb, 'INV-C1', { id: 'pA', mode: 'Cash', amount: 1000 }),
        collectPayment(bDb, 'INV-C1', { id: 'pB', mode: 'UPI', amount: 1000 }),
      ]);
      const crossings = [rA, rB].filter((r) => !isRealized(r.serverPrior) && isRealized(r.fresh)).length;
      const invC1 = (await getDoc(doc(aDb, 'invoices/INV-C1'))).data();
      ok('CWF-01: exactly ONE of the two concurrent payments crossed unpaid -> Paid',
        crossings === 1, `crossings=${crossings}`);
      ok('CWF-01: both payment records survived', (invC1.payments || []).length === 2);
      ok('CWF-01: final invoice is Paid with paid total 2000 (overpayment recorded truthfully)',
        invC1.status === 'Paid' && invC1.paid === 2000);
      ok('CWF-01: _rev advanced by exactly 2 (one bump per payment)', invC1._rev === 2);

      // ---- CWF-02 — concurrent PO receive ----
      const receive = (db, poId, lines) => runTransaction(db, async (tx) => {
        const ref = doc(db, 'purchaseOrders', poId);
        const snap = await tx.get(ref);
        const server = snap.data();
        const { items, status, over } = applyPoReceive(server.items || [], lines, server.status);
        if (over) { const e = new Error('over-receipt'); e.code = 'po/over-receipt'; throw e; }
        tx.update(ref, { items, status });
        lines.forEach((ln) => {
          if (!ln.partId || Number(ln.receiveQty) <= 0) return;
          tx.update(doc(db, 'parts', ln.partId), { stock: increment(Number(ln.receiveQty)) });
          tx.set(doc(collection(db, 'restocks')), { partId: ln.partId, qty: Number(ln.receiveQty), poNumber: server.poNumber });
        });
        return { status, items };
      });

      await testEnv.clearFirestore();
      await seedDoc(testEnv, 'parts/pRcv', { name: 'Pad', stock: 0 });
      await seedDoc(testEnv, 'purchaseOrders/PO-C2', {
        poNumber: 'PO-C2', status: 'approved',
        items: [{ partId: 'pRcv', name: 'Pad', qty: 10, receivedQty: 0 }],
      });
      await Promise.all([
        receive(aDb, 'PO-C2', [{ partId: 'pRcv', receiveQty: 4 }]),
        receive(bDb, 'PO-C2', [{ partId: 'pRcv', receiveQty: 3 }]),
      ]);
      const poC2 = (await getDoc(doc(aDb, 'purchaseOrders/PO-C2'))).data();
      const partC2 = (await getDoc(doc(aDb, 'parts/pRcv'))).data();
      const restocksC2 = (await getDocs(collection(aDb, 'restocks'))).size;
      ok('CWF-02: concurrent 4 + 3 -> PO receivedQty = 7 (no lost receive)',
        poC2.items[0].receivedQty === 7, `receivedQty=${poC2.items[0].receivedQty}`);
      ok('CWF-02: part stock = 7 (matches PO tracking — consistent)', partC2.stock === 7, `stock=${partC2.stock}`);
      ok('CWF-02: exactly 2 restock rows (one per receipt, no duplicate from a retry)', restocksC2 === 2, `rows=${restocksC2}`);

      // 6 + 6 against ordered 10 — one must be rejected whole, stock stays +6
      await testEnv.clearFirestore();
      await seedDoc(testEnv, 'parts/pRcv2', { name: 'Pad', stock: 0 });
      await seedDoc(testEnv, 'purchaseOrders/PO-C3', {
        poNumber: 'PO-C3', status: 'approved',
        items: [{ partId: 'pRcv2', name: 'Pad', qty: 10, receivedQty: 0 }],
      });
      const settled = await Promise.allSettled([
        receive(aDb, 'PO-C3', [{ partId: 'pRcv2', receiveQty: 6 }]),
        receive(bDb, 'PO-C3', [{ partId: 'pRcv2', receiveQty: 6 }]),
      ]);
      const rejected = settled.filter((s) => s.status === 'rejected').length;
      const poC3 = (await getDoc(doc(aDb, 'purchaseOrders/PO-C3'))).data();
      const partC3 = (await getDoc(doc(aDb, 'parts/pRcv2'))).data();
      ok('CWF-02: 6 + 6 vs ordered 10 — exactly one receive is rejected', rejected === 1, `rejected=${rejected}`);
      ok('CWF-02: over-receipt did NOT silently reach 12 — PO receivedQty = 6', poC3.items[0].receivedQty === 6, `receivedQty=${poC3.items[0].receivedQty}`);
      ok('CWF-02: rejected transaction moved NO stock — part stock = 6', partC3.stock === 6, `stock=${partC3.stock}`);

      // ---- CWF-03 — concurrent secondary customer writes ----
      const mergeArray = (db, custId, key, before, after) => runTransaction(db, async (tx) => {
        const ref = doc(db, 'customers', custId);
        const snap = await tx.get(ref);
        if (!snap.exists()) { const e = new Error('deleted'); e.code = 'conc/deleted'; throw e; }
        tx.set(ref, { [key]: replayIdArray(before, after, snap.data()[key]) }, { merge: true });
      });

      await testEnv.clearFirestore();
      await seedDoc(testEnv, 'customers/C3', { name: 'ZZ QA', noteEntries: [], vehicles: [], phone: '9000000000' });
      await Promise.all([
        mergeArray(aDb, 'C3', 'noteEntries', [], [{ id: 'n1', text: 'A note' }]),
        mergeArray(bDb, 'C3', 'vehicles', [], [{ id: 'v1', regNo: 'AP01AA1111' }]),
      ]);
      let cC3 = (await getDoc(doc(aDb, 'customers/C3'))).data();
      ok('CWF-03 (note + vehicle): BOTH survive — the note is not reverted by the vehicle write',
        (cC3.noteEntries || []).length === 1 && (cC3.vehicles || []).length === 1
        && cC3.phone === '9000000000', JSON.stringify({ n: cC3.noteEntries, v: cC3.vehicles }));

      await testEnv.clearFirestore();
      await seedDoc(testEnv, 'customers/C4', { name: 'ZZ QA', noteEntries: [], vehicles: [] });
      await Promise.all([
        mergeArray(aDb, 'C4', 'noteEntries', [], [{ id: 'nA', text: 'from A' }]),
        mergeArray(bDb, 'C4', 'noteEntries', [], [{ id: 'nB', text: 'from B' }]),
      ]);
      cC3 = (await getDoc(doc(aDb, 'customers/C4'))).data();
      ok('CWF-03 (note + note): BOTH notes survive (same-array concurrent append)',
        (cC3.noteEntries || []).length === 2
        && cC3.noteEntries.some((x) => x.id === 'nA') && cC3.noteEntries.some((x) => x.id === 'nB'),
        JSON.stringify(cC3.noteEntries));

      await testEnv.clearFirestore();
      await seedDoc(testEnv, 'customers/C5', { name: 'ZZ QA', vehicles: [{ id: 'v0', regNo: 'AP01OLD' }] });
      await Promise.all([
        mergeArray(aDb, 'C5', 'vehicles', [{ id: 'v0', regNo: 'AP01OLD' }], [{ id: 'v0', regNo: 'AP01OLD' }, { id: 'vA', regNo: 'AP01AAA' }]),
        mergeArray(bDb, 'C5', 'vehicles', [{ id: 'v0', regNo: 'AP01OLD' }], [{ id: 'v0', regNo: 'AP01OLD' }, { id: 'vB', regNo: 'AP01BBB' }]),
      ]);
      cC3 = (await getDoc(doc(aDb, 'customers/C5'))).data();
      ok('CWF-03 (vehicle + vehicle): the pre-existing vehicle and BOTH new vehicles survive',
        (cC3.vehicles || []).length === 3
        && ['v0', 'vA', 'vB'].every((id) => cC3.vehicles.some((v) => v.id === id)),
        JSON.stringify(cC3.vehicles.map((v) => v.id)));
    }

    // =========================================================================
    // PHASE 4b — DUPLICATE-ACTION / IDEMPOTENCY (regression). Each transaction
    // callback below is re-implemented to MATCH the shipped service code: it reads
    // an operation-id marker BEFORE any write and applies NOTHING if the marker is
    // already present. The assertions prove that one user intent, delivered twice
    // (a lost-ack transaction retry, or an app-level re-click that reuses the same
    // opId), produces exactly ONE business effect against the real emulator.
    // =========================================================================
    await testEnv.clearFirestore();
    {
      const aDb = testEnv.authenticatedContext('uid-A', { email: STAFF_EMAIL }).firestore();

      // ---- PH4-01: collectInvoicePayment — pay.id idempotency guard ----
      // Mirrors InventoryDashboard.js: `priorPayments.some(p => p && p.id === pay.id)`
      // → return current state, write nothing.
      const collectPaymentTxn = (db, invId, pay) => runTransaction(db, async (tx) => {
        const ref = doc(db, 'invoices', invId);
        const data = (await tx.get(ref)).data();
        const priorPayments = Array.isArray(data.payments) ? data.payments : [];
        if (pay && pay.id && priorPayments.some((p) => p && p.id === pay.id)) {
          return { alreadyApplied: true };                        // <-- duplicate delivery: no-op
        }
        const payments = [...priorPayments, pay];
        const grand = (data.lines || []).reduce((s, l) => s + Number(l.qty) * Number(l.rate), 0);
        const paid = payments.reduce((s, p) => s + Number(p.amount), 0);
        tx.update(ref, { payments, paid, balance: grand - paid, _rev: (data._rev || 0) + 1 });
        return { alreadyApplied: false };
      });
      await seedDoc(testEnv, 'invoices/PH4-INV', { lines: [{ qty: 1, rate: 500 }], payments: [], _rev: 0 });
      await collectPaymentTxn(aDb, 'PH4-INV', { id: 'p_x', mode: 'Cash', amount: 500 });   // commit 1
      const dupPay = await collectPaymentTxn(aDb, 'PH4-INV', { id: 'p_x', mode: 'Cash', amount: 500 }); // lost-ack retry, SAME id
      let inv = (await getDoc(doc(aDb, 'invoices/PH4-INV'))).data();
      ok('PH4-01: a re-run of one payment intent (same pay.id) appends the payment ONCE',
        inv.payments.filter((p) => p.id === 'p_x').length === 1, JSON.stringify(inv.payments.map((p) => p.id)));
      ok('PH4-01: paid stays 500, balance 0 — the retry is reported alreadyApplied',
        inv.paid === 500 && inv.balance === 0 && dupPay.alreadyApplied === true, `paid=${inv.paid} balance=${inv.balance} alreadyApplied=${dupPay.alreadyApplied}`);
      // a genuinely separate second payment (new id) still goes through
      await collectPaymentTxn(aDb, 'PH4-INV', { id: 'p_y', mode: 'Cash', amount: 200 });
      inv = (await getDoc(doc(aDb, 'invoices/PH4-INV'))).data();
      ok('PH4-01: a DIFFERENT payment id is a new intent — it is still recorded',
        inv.payments.length === 2 && inv.paid === 700, `payments=${inv.payments.length} paid=${inv.paid}`);

      // ---- PH4-02: poReceiveDoc — appliedReceiptIds guard ----
      // Mirrors services/purchaseOrderService.js: read appliedReceiptIds first; if
      // this receiptId is present, return server state and apply nothing.
      const receiveTxn = (db, poId, delta, receiptId) => runTransaction(db, async (tx) => {
        const ref = doc(db, 'purchaseOrders', poId);
        const s = (await tx.get(ref)).data();
        const applied = Array.isArray(s.appliedReceiptIds) ? s.appliedReceiptIds : [];
        if (receiptId && applied.includes(receiptId)) return { alreadyApplied: true };
        const items = s.items.map((it) => ({ ...it, receivedQty: Number(it.receivedQty) + delta }));
        tx.update(ref, { items, appliedReceiptIds: [...applied, receiptId].slice(-60) });
        tx.update(doc(db, 'parts', s.items[0].partId), { stock: increment(delta) });
        tx.set(doc(collection(db, 'restocks')), { poNumber: s.poNumber, qty: delta });
        return { alreadyApplied: false };
      });
      await seedDoc(testEnv, 'parts/PH4-PART', { stock: 0 });
      await seedDoc(testEnv, 'purchaseOrders/PH4-PO', { poNumber: 'PH4-PO', status: 'approved', items: [{ partId: 'PH4-PART', qty: 10, receivedQty: 0 }] });
      await receiveTxn(aDb, 'PH4-PO', 4, 'rcpt_1');   // commit 1
      await receiveTxn(aDb, 'PH4-PO', 4, 'rcpt_1');   // lost-ack retry of "receive 4" — SAME receiptId
      const po4 = (await getDoc(doc(aDb, 'purchaseOrders/PH4-PO'))).data();
      const part4 = (await getDoc(doc(aDb, 'parts/PH4-PART'))).data();
      const restock4 = (await getDocs(collection(aDb, 'restocks'))).size;
      ok('PH4-02: receiving 4 once, delivered twice with the same receiptId, stays receivedQty 4',
        po4.items[0].receivedQty === 4, `receivedQty=${po4.items[0].receivedQty}`);
      ok('PH4-02: stock +4 and exactly ONE restock ledger row for one receipt',
        part4.stock === 4 && restock4 === 1, `stock=${part4.stock} restockRows=${restock4}`);
      // a genuinely separate second receipt (new receiptId) still applies
      await receiveTxn(aDb, 'PH4-PO', 3, 'rcpt_2');
      const po4b = (await getDoc(doc(aDb, 'purchaseOrders/PH4-PO'))).data();
      ok('PH4-02: a DIFFERENT receiptId is a new receipt — it still applies (receivedQty 7)',
        po4b.items[0].receivedQty === 7, `receivedQty=${po4b.items[0].receivedQty}`);

      // ---- PH4-03: quick sell — sales/{opId} is the marker, whole sale in one txn ----
      // Mirrors handleSellInner's online path: read sales/{opId} + part; if the sale
      // doc exists, apply nothing; else set the sale row + decrement stock + rollup.
      const sellTxn = (db, partId, want, opId) => runTransaction(db, async (tx) => {
        const saleRef = doc(db, 'sales', opId);
        const partRef = doc(db, 'parts', partId);
        const saleSnap = await tx.get(saleRef);
        const partSnap = await tx.get(partRef);
        if (saleSnap.exists()) return { alreadyApplied: true };
        const cur = partSnap.data().stock || 0;
        if (want > cur) throw new Error('not enough');
        tx.set(saleRef, { partId, qty: want });
        tx.update(partRef, { stock: increment(-want), salesCount: increment(want) });
        tx.set(doc(db, 'salesRollups', '2026-09'), { units: increment(want), orders: increment(1) }, { merge: true });
        return { alreadyApplied: false };
      });
      await testEnv.clearFirestore();
      await seedDoc(testEnv, 'parts/PH4-SELL', { stock: 10, salesCount: 0 });
      await sellTxn(aDb, 'PH4-SELL', 3, 'sale_op_1');   // commit 1
      await sellTxn(aDb, 'PH4-SELL', 3, 'sale_op_1');   // lost-ack retry — SAME opId
      const sellPart = (await getDoc(doc(aDb, 'parts/PH4-SELL'))).data();
      const salesRows = (await getDocs(collection(aDb, 'sales'))).size;
      const roll = (await getDoc(doc(aDb, 'salesRollups/2026-09'))).data();
      ok('PH4-03: selling 3 once, delivered twice with the same opId, decrements stock by 3 only',
        sellPart.stock === 7, `stock=${sellPart.stock} (expected 7)`);
      ok('PH4-03: exactly ONE sales row and the rollup counts one order',
        salesRows === 1 && roll.units === 3 && roll.orders === 1, `salesRows=${salesRows} units=${roll.units} orders=${roll.orders}`);

      // ---- PH4-04 / PH4-05: stock adjust / restock — natural-id marker ----
      const adjustTxn = (db, partId, signedQty, adjId) => runTransaction(db, async (tx) => {
        const adjRef = doc(db, 'stockAdjustments', adjId);
        const partRef = doc(db, 'parts', partId);
        const adjSnap = await tx.get(adjRef);
        const partSnap = await tx.get(partRef);
        if (adjSnap.exists()) return { alreadyApplied: true };
        const before = partSnap.data().stock || 0;
        tx.set(adjRef, { opId: adjId, partId, qty: signedQty, stockBefore: before, stockAfter: before + signedQty });
        tx.update(partRef, { stock: increment(signedQty) });
        return { alreadyApplied: false };
      });
      await testEnv.clearFirestore();
      await seedDoc(testEnv, 'parts/PH4-ADJ', { stock: 20 });
      await adjustTxn(aDb, 'PH4-ADJ', -5, 'adj_op_1');
      await adjustTxn(aDb, 'PH4-ADJ', -5, 'adj_op_1');   // retry, same adjId
      const adjPart = (await getDoc(doc(aDb, 'parts/PH4-ADJ'))).data();
      const adjRows = (await getDocs(collection(aDb, 'stockAdjustments'))).size;
      ok('PH4-04: adjusting −5 once, delivered twice with the same adjId, applies −5 once (stock 15, 1 ledger row)',
        adjPart.stock === 15 && adjRows === 1, `stock=${adjPart.stock} rows=${adjRows}`);

      // ---- PH4-06: PO create / supplier create — client-stable doc id ----
      // Mirrors poCreateDoc / handleSupplierSaveInner: setDoc(doc(db, coll, stableId), data, {merge:true}).
      await testEnv.clearFirestore();
      const createWithId = (db, coll, id, data) => setDoc(doc(db, coll, id), data, { merge: true });
      await createWithId(aDb, 'purchaseOrders', 'po_op_1', { poNumber: 'PO-1', total: 100 });
      await createWithId(aDb, 'purchaseOrders', 'po_op_1', { poNumber: 'PO-1', total: 100 }); // retry, same id
      await createWithId(aDb, 'suppliers', 'sup_op_1', { name: 'ZZ QA Supplier' });
      await createWithId(aDb, 'suppliers', 'sup_op_1', { name: 'ZZ QA Supplier' });           // retry, same id
      const poCount = (await getDocs(collection(aDb, 'purchaseOrders'))).size;
      const supCount = (await getDocs(collection(aDb, 'suppliers'))).size;
      ok('PH4-06: a retried PO create with the same client id writes ONE purchaseOrders doc',
        poCount === 1, `poCount=${poCount}`);
      ok('PH4-06: a retried supplier create with the same client id writes ONE suppliers doc',
        supCount === 1, `supCount=${supCount}`);

      // ---- CLEARED: delete is idempotent (Phase 3b) ----
      await testEnv.clearFirestore();
      await seedAdmins(testEnv, [ADMIN_EMAIL]);
      const adminDb = testEnv.authenticatedContext('uid-admin', { email: ADMIN_EMAIL }).firestore();
      const deleteTxn = (db, invId) => runTransaction(db, async (tx) => {
        const snap = await tx.get(doc(db, 'invoices', invId));
        if (!snap.exists()) return { unwound: false };   // 2nd delivery: no-op
        tx.delete(doc(db, 'invoices', invId));
        return { unwound: true };
      });
      await seedDoc(testEnv, 'invoices/PH4-DEL', { lines: [{ qty: 1, rate: 100 }], status: 'Paid' });
      const d1 = await deleteTxn(adminDb, 'PH4-DEL');
      const d2 = await deleteTxn(adminDb, 'PH4-DEL');   // duplicate delivery
      ok('CLEARED: delete invoice — 2nd delivery unwinds nothing (idempotent)',
        d1.unwound === true && d2.unwound === false);
    }

    // =========================================================================
    // Deny-by-default fallback for any collection not explicitly listed.
    // =========================================================================
    await testEnv.clearFirestore();
    {
      await seedAdmins(testEnv, [ADMIN_EMAIL]);
      const adminDb = testEnv.authenticatedContext('admin-uid', { email: ADMIN_EMAIL }).firestore();
      ok('admin: read on an unlisted collection still denied (fallback deny)', await deny(getDoc(doc(adminDb, 'somethingUnlisted/x'))));
      ok('admin: write on an unlisted collection still denied (fallback deny)', await deny(setDoc(doc(adminDb, 'somethingUnlisted/x'), { a: 1 })));
    }
  } finally {
    await testEnv.cleanup();
  }

  console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
  process.exit(FAIL ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
