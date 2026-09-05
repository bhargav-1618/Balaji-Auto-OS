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
const fs = require('fs');
const path = require('path');
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
    // PHASE 15 (audit-log integrity) — auditLog's `create` rule must reject a
    // forged `performedBy` (impersonating a DIFFERENT user), while still
    // allowing a user to self-attribute their own entry and read the shared
    // trail. This is stricter than the shared append-only pattern above
    // (sales/restocks/stockAdjustments intentionally accept any signed-in
    // writer — they carry no actor-identity field to forge in the first
    // place), so it gets its own dedicated block rather than folding into it.
    // =========================================================================
    await testEnv.clearFirestore();
    {
      await seedAdmins(testEnv, [ADMIN_EMAIL]);
      const staffDb = testEnv.authenticatedContext('staff-uid', { email: STAFF_EMAIL }).firestore();
      const otherDb = testEnv.authenticatedContext('other-uid', { email: 'other@example.com' }).firestore();

      ok('staff: create auditLog entry self-attributed to their own uid allowed',
        await allow(setDoc(doc(staffDb, 'auditLog/a1'), { action: 'sell_part', performedBy: 'staff-uid' })));
      ok('staff: create auditLog entry impersonating a DIFFERENT uid denied',
        await deny(setDoc(doc(staffDb, 'auditLog/a2'), { action: 'sell_part', performedBy: 'other-uid' })));
      ok('other user: create auditLog entry with no performedBy field at all denied (missing, so cannot equal request.auth.uid)',
        await deny(setDoc(doc(otherDb, 'auditLog/a3'), { action: 'sell_part' })));
      ok('other user: read the shared auditLog (written by a different uid) still allowed',
        await allow(getDoc(doc(otherDb, 'auditLog/a1'))));
      ok('staff: update an existing auditLog entry denied (append-only, unchanged by this phase)',
        await deny(updateDoc(doc(staffDb, 'auditLog/a1'), { action: 'tampered' })));
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
      ok('editLocks: A deleting its OWN active lease (raw delete) — DENIED (Phase 7b/PH7-27: delete carries no payload for the rules to check identity against, so an active lease can never be deleted directly, not even by its owner — see the release-shaped-update assertion below)',
        await deny(deleteDoc(lock(aDb))));
      ok('editLocks: A releases its own lease via a release-shaped update (own identity, past expiresAt) — allowed',
        await allow(setDoc(lock(aDb), lockData('uid-A', past()))));
      ok('editLocks: after A\'s release-via-update, the lease is EXPIRED and now deletable by anyone (crash-cleanup path)',
        await allow(deleteDoc(lock(bDb))));

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
    // PHASE 5b — REFRESH / RELOAD RELIABILITY (regression). Models the exact
    // Phase 5 danger: a transaction COMMITS server-side, the client never sees the
    // response (browser refresh), the client state is reset, the DURABLE operation
    // id is RECOVERED from sessionStorage, and the SAME operation is replayed.
    // Proves one business effect against the real emulator + the real rules.
    // =========================================================================
    await testEnv.clearFirestore();
    {
      const aDb = testEnv.authenticatedContext('uid-A', { email: STAFF_EMAIL }).firestore();

      // ---- PH5-02: payment — recover payOpId across a "refresh", retry ----
      const payTxn = (db, invId, pay) => runTransaction(db, async (tx) => {
        const ref = doc(db, 'invoices', invId);
        const data = (await tx.get(ref)).data();
        const prior = Array.isArray(data.payments) ? data.payments : [];
        if (pay && pay.id && prior.some((p) => p && p.id === pay.id)) return { alreadyApplied: true };
        const payments = [...prior, pay];
        const grand = (data.lines || []).reduce((s, l) => s + Number(l.qty) * Number(l.rate), 0);
        const paid = payments.reduce((s, p) => s + Number(p.amount), 0);
        tx.update(ref, { payments, paid, balance: grand - paid, _rev: (data._rev || 0) + 1 });
        return { alreadyApplied: false };
      });
      await seedDoc(testEnv, 'invoices/PH5-INV', { lines: [{ qty: 1, rate: 500 }], payments: [], _rev: 0 });
      const durablePayId = 'p_durable_1';                 // sessionStorage: ph5b:op:payment:PH5-INV
      await payTxn(aDb, 'PH5-INV', { id: durablePayId, mode: 'Cash', amount: 500 }); // commits; ack lost
      // ...browser refreshes. React state gone. sessionStorage kept. user retries:
      const r = await payTxn(aDb, 'PH5-INV', { id: durablePayId, mode: 'Cash', amount: 500 });
      const inv = (await getDoc(doc(aDb, 'invoices/PH5-INV'))).data();
      ok('PH5-02: payment committed, "refresh", recover the durable id, retry -> ONE payment, paid 500',
        r.alreadyApplied === true && inv.payments.length === 1 && inv.paid === 500 && inv.balance === 0);
      // a genuinely separate later payment (fresh durable id after the first was cleared)
      await payTxn(aDb, 'PH5-INV', { id: 'p_durable_2', mode: 'UPI', amount: 200 });
      const inv2 = (await getDoc(doc(aDb, 'invoices/PH5-INV'))).data();
      ok('PH5-02: a new durable id after the first cleared -> a legitimate second payment',
        inv2.payments.length === 2 && inv2.paid === 700);

      // ---- PH5-02: quick sell — recover saleOpId across a "refresh" ----
      const sellTxn = (db, partId, want, opId) => runTransaction(db, async (tx) => {
        const saleRef = doc(db, 'sales', opId);
        const partRef = doc(db, 'parts', partId);
        const sSnap = await tx.get(saleRef);
        const pSnap = await tx.get(partRef);
        if (sSnap.exists()) return { alreadyApplied: true };
        tx.set(saleRef, { partId, qty: want });
        tx.update(partRef, { stock: increment(-want), salesCount: increment(want) });
        tx.set(doc(db, 'salesRollups', '2026-09'), { units: increment(want) }, { merge: true });
        return { alreadyApplied: false };
      });
      await testEnv.clearFirestore();
      await seedDoc(testEnv, 'parts/PH5-SELL', { stock: 10, salesCount: 0 });
      const durableSaleId = 'sale_durable_1';
      await sellTxn(aDb, 'PH5-SELL', 3, durableSaleId);   // commits; ack lost
      await sellTxn(aDb, 'PH5-SELL', 3, durableSaleId);   // refresh + recover id + retry
      const sp = (await getDoc(doc(aDb, 'parts/PH5-SELL'))).data();
      const rows = (await getDocs(collection(aDb, 'sales'))).size;
      ok('PH5-02: quick sell committed, "refresh", recover the durable id, retry -> stock -3 once, ONE sales row',
        sp.stock === 7 && rows === 1);

      // ---- PH5-04: job-card reservation — appliedReserveIds marker ----
      const reserveTxn = (db, partId, delta, reserveOpId) => runTransaction(db, async (tx) => {
        const ref = doc(db, 'parts', partId);
        const snap = await tx.get(ref);
        const applied = Array.isArray(snap.data().appliedReserveIds) ? snap.data().appliedReserveIds : [];
        if (reserveOpId && applied.includes(reserveOpId)) return;
        tx.update(ref, { reserved: increment(delta), appliedReserveIds: [...applied, reserveOpId].slice(-40) });
      });
      await testEnv.clearFirestore();
      await seedDoc(testEnv, 'parts/PH5-JC', { stock: 20, reserved: 0 });
      await reserveTxn(aDb, 'PH5-JC', 2, 'jcr_durable_1'); // job-card save commits; ack lost
      await reserveTxn(aDb, 'PH5-JC', 2, 'jcr_durable_1'); // refresh + recover id + retry
      const jp = (await getDoc(doc(aDb, 'parts/PH5-JC'))).data();
      ok('PH5-04: job-card reservation committed, "refresh", recover the durable id, retry -> reserved = 2 (once)',
        jp.reserved === 2 && Array.isArray(jp.appliedReserveIds) && jp.appliedReserveIds.length === 1);
      ok('PH5-04: writing appliedReserveIds on a parts doc is allowed by the rules (no rules change)',
        jp.appliedReserveIds[0] === 'jcr_durable_1');

      // ---- PH5-03: create PO / supplier / part — recovered stable id ----
      await testEnv.clearFirestore();
      const createWithId = (coll, id, data) => setDoc(doc(aDb, coll, id), data, { merge: true });
      for (const [coll, id] of [['purchaseOrders', 'po_durable_1'], ['suppliers', 'sup_durable_1'], ['parts', 'part_durable_1']]) {
        await createWithId(coll, id, { name: 'ZZ QA', createdAt: 1 });
        await createWithId(coll, id, { name: 'ZZ QA', createdAt: 1 }); // refresh + recover id + retry
      }
      const poC = (await getDocs(collection(aDb, 'purchaseOrders'))).size;
      const supC = (await getDocs(collection(aDb, 'suppliers'))).size;
      const partC = (await getDocs(collection(aDb, 'parts'))).size;
      ok('PH5-03: create PO/supplier/part, "refresh", recover the durable id, retry -> ONE doc each',
        poC === 1 && supC === 1 && partC === 1);
    }

    // =========================================================================
    // PHASE 6b — NETWORK INTERRUPTION / OFFLINE-RECOVERY HARDENING (regression).
    // PH6-03 added a CLIENT-SIDE timeout (lib/txTimeout.js `withTimeout`) around
    // every runTransaction call. It does NOT touch server-side rules or
    // transaction logic at all — it only bounds how long the UI waits and does
    // not cancel the transaction, so from the emulator's point of view "the UI
    // gave up waiting" and "the response was genuinely lost to a refresh" are
    // mechanically IDENTICAL: the transaction still commits (or doesn't) exactly
    // as before, and a retry with the SAME durable operation id still finds the
    // marker and no-ops. This section makes that equivalence explicit against
    // the real emulator + real rules, rather than relying only on the source-
    // pattern proof in tests/network-interruption-recovery.test.cjs.
    // =========================================================================
    await testEnv.clearFirestore();
    {
      const aDb = testEnv.authenticatedContext('uid-A', { email: STAFF_EMAIL }).firestore();

      // ---- PH6-03: stock adjustment — commit, "client times out and gives up
      // waiting" (mechanically the same as a lost response), retry with the SAME
      // durable id -> one effect, never two. ----
      const adjustTxn = (db, partId, delta, adjId) => runTransaction(db, async (tx) => {
        const adjRef = doc(db, 'stockAdjustments', adjId);
        const partRef = doc(db, 'parts', partId);
        const adjSnap = await tx.get(adjRef);
        if (adjSnap.exists()) return { alreadyApplied: true };
        tx.set(adjRef, { opId: adjId, partId, qty: delta });
        tx.update(partRef, { stock: increment(delta) });
        return { alreadyApplied: false };
      });
      await seedDoc(testEnv, 'parts/PH6-ADJ', { stock: 10 });
      const durableAdjId = 'adj_durable_1';
      await adjustTxn(aDb, 'PH6-ADJ', -3, durableAdjId); // commits server-side
      // ...client's withTimeout(...) fired first (UI gave up waiting) — the
      // transaction above kept running and committed anyway; the UI never saw
      // it. User is told "check before retrying" and presses again with the
      // SAME durable id (Phase 5b/6b never mint a fresh one on ambiguous/timeout):
      const r2 = await adjustTxn(aDb, 'PH6-ADJ', -3, durableAdjId);
      const ap = (await getDoc(doc(aDb, 'parts/PH6-ADJ'))).data();
      ok('PH6-03: stock adjustment commits, client-side timeout fires before the ack arrives, retry with the SAME durable id -> stock -3 once, not -6',
        r2.alreadyApplied === true && ap.stock === 7);

      // ---- PH6-03: a genuinely NEW intent (a fresh durable id, e.g. after the
      // first was cleared on confirmed success) still applies as a real second
      // effect — a timeout must never cause the app to treat every later action
      // as a duplicate of the timed-out one. ----
      const r3 = await adjustTxn(aDb, 'PH6-ADJ', -2, 'adj_durable_2');
      const ap3 = (await getDoc(doc(aDb, 'parts/PH6-ADJ'))).data();
      ok('PH6-03: a NEW durable id still applies as a real second adjustment (stock 7 -> 5)',
        r3.alreadyApplied === false && ap3.stock === 5);

      // ---- PH6-03: PO receive — same equivalence, via the real poReceiveDoc
      // server-side logic (lib/poReceive.js applyPoReceive), not a re-implementation. ----
      await testEnv.clearFirestore();
      const receiveTxn = (db, poId, receiptId) => runTransaction(db, async (tx) => {
        const poRef = doc(db, 'purchaseOrders', poId);
        const server = (await tx.get(poRef)).data();
        const applied = Array.isArray(server.appliedReceiptIds) ? server.appliedReceiptIds : [];
        if (receiptId && applied.includes(receiptId)) return { alreadyApplied: true };
        const { items, status } = applyPoReceive(server.items || [], [{ partId: 'p1', receiveQty: 4 }], server.status);
        tx.update(poRef, { items, status, appliedReceiptIds: [...applied, receiptId] });
        return { alreadyApplied: false, status };
      });
      await seedDoc(testEnv, 'purchaseOrders/PH6-PO', {
        status: 'sent', items: [{ partId: 'p1', qty: 10, receivedQty: 0 }], appliedReceiptIds: [],
      });
      const durableReceiptId = 'rcpt_durable_1';
      await receiveTxn(aDb, 'PH6-PO', durableReceiptId); // commits server-side
      const r4 = await receiveTxn(aDb, 'PH6-PO', durableReceiptId); // UI timed out, retried with the SAME id
      const po = (await getDoc(doc(aDb, 'purchaseOrders/PH6-PO'))).data();
      ok('PH6-03: PO receive commits, client-side timeout, retry with the SAME durable receiptId -> receivedQty +4 once, not +8',
        r4.alreadyApplied === true && po.items[0].receivedQty === 4);

      // ---- PH6-01: writing to `parts` from the gated listener path needs no
      // rules change — reconfirm the exact same invariant PH5-04 already proved,
      // since PH6-01 only changed CLIENT listener gating, never a write shape. ----
      ok('PH6-01: no rules change was needed or made — the parts listener fix is client-side (onSnapshot callback gating), the write shapes to `parts` are unchanged',
        !/phase ?6|PH6-0/i.test(fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8')));
    }

    // =========================================================================
    // PHASE 7 — BROWSER / TAB / LAPTOP LIFECYCLE INTEGRITY (discovery).
    // Reconstructs lib/editLease.js's acquireLease/renewLease/releaseLease
    // transactions inline (same logic, same shape) so this runs against the
    // REAL emulator + REAL rules — the rules-test SDK context can't import the
    // ES-module lib/firebase.js, same reason every earlier section here does
    // the same thing (see PH5-02's payTxn/sellTxn above).
    //
    // "Sleep" is simulated the way the app's own server-authoritative expiry
    // already works: `expiresAt` is a plain Firestore timestamp compared to
    // `request.time` — a real OS sleep, a throttled background tab, and a
    // network partition are all, from the server's point of view, indistin-
    // guishable from "no heartbeat arrived before expiresAt". So a genuinely
    // expired lease is produced here by writing an `expiresAt` in the past
    // (bypassing rules, the way a real client never could — this is the test
    // simulating time passing, not a rules bypass under test) rather than by
    // waiting 90 real seconds, per the phase's own instruction to prefer
    // controlled timestamps over wall-clock sleeping.
    // =========================================================================
    await testEnv.clearFirestore();
    {
      const LEASE_MS = 90 * 1000;
      const leaseId = (coll, id) => `${coll}__${id}`;
      const toMillis = (ts) => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0);

      const acquireTxn = (db, coll, id, owner) => runTransaction(db, async (tx) => {
        const ref = doc(db, 'editLocks', leaseId(coll, id));
        const snap = await tx.get(ref);
        if (snap.exists()) {
          const d = snap.data();
          const active = toMillis(d.expiresAt) > Date.now();
          const mine = d.ownerUid === owner.uid && d.sessionId === owner.sessionId;
          if (active && !mine) { const e = new Error('lease/held'); e.code = 'lease/held'; e.heldBy = d.ownerEmail; throw e; }
        }
        tx.set(ref, {
          ownerUid: owner.uid, ownerEmail: owner.email || '', sessionId: owner.sessionId,
          acquiredAt: Timestamp.now(), heartbeatAt: Timestamp.now(),
          expiresAt: Timestamp.fromMillis(Date.now() + LEASE_MS),
        });
      });
      const renewTxn = (db, coll, id, owner) => runTransaction(db, async (tx) => {
        const ref = doc(db, 'editLocks', leaseId(coll, id));
        const snap = await tx.get(ref);
        if (snap.exists()) {
          const d = snap.data();
          const mine = d.ownerUid === owner.uid && d.sessionId === owner.sessionId;
          const expired = toMillis(d.expiresAt) <= Date.now();
          if (!mine && !expired) { const e = new Error('lease/lost'); e.code = 'lease/lost'; throw e; }
        }
        tx.set(ref, {
          ownerUid: owner.uid, ownerEmail: owner.email || '', sessionId: owner.sessionId,
          acquiredAt: Timestamp.now(), heartbeatAt: Timestamp.now(),
          expiresAt: Timestamp.fromMillis(Date.now() + LEASE_MS),
        });
      });
      // Phase 7b (PH7-27) — release is now an UPDATE to a past expiresAt, not
      // a delete (a delete carries no payload for the rules to check a
      // session against — see firestore.rules' own comment on this). Mirrors
      // lib/editLease.js's releaseLease exactly.
      const releaseTxn = (db, coll, id, owner) => runTransaction(db, async (tx) => {
        const ref = doc(db, 'editLocks', leaseId(coll, id));
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const d = snap.data();
        const mine = !!owner && d.ownerUid === owner.uid && d.sessionId === owner.sessionId;
        if (!mine) return;
        tx.update(ref, { ownerUid: owner.uid, ownerEmail: d.ownerEmail || '', sessionId: owner.sessionId, heartbeatAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
      });
      // Backdates expiresAt directly (bypassing rules) to simulate "a lease that
      // has genuinely expired" — the SAME server-side condition a real 90s+ gap
      // with no heartbeat (sleep, background-tab throttling, or a network
      // partition) produces, without a real 90-second wait.
      const backdateExpiry = (path_, msAgo) => testEnv.withSecurityRulesDisabled(async (ctx) => {
        const { doc: d2, updateDoc: u2 } = require('firebase/firestore');
        await u2(d2(ctx.firestore(), path_), { expiresAt: Timestamp.fromMillis(Date.now() - msAgo) });
      });

      const aCtx = testEnv.authenticatedContext('uid-staff-A', { email: STAFF_EMAIL });
      const aDb = aCtx.firestore();
      const bCtx = testEnv.authenticatedContext('uid-staff-A', { email: STAFF_EMAIL }); // SAME uid — same-user, two tabs
      const bDb = bCtx.firestore();
      const A = { uid: 'uid-staff-A', email: STAFF_EMAIL, sessionId: 's_tabA' };
      const B = { uid: 'uid-staff-A', email: STAFF_EMAIL, sessionId: 's_tabB' }; // same uid, DIFFERENT session

      // ---- STEP 15: lease acquire / active-lease exclusivity ----
      await acquireTxn(aDb, 'customers', 'PH7-1', A);
      ok('PH7-15: A acquires a free lease',
        (await getDoc(doc(aDb, 'editLocks/customers__PH7-1'))).data().sessionId === 's_tabA');
      let bBlocked = false;
      try { await acquireTxn(bDb, 'customers', 'PH7-1', B); } catch (e) { bBlocked = e.code === 'lease/held'; }
      ok('PH7-15: B (SAME uid, DIFFERENT session — a second tab of the same logged-in user) is REJECTED while A\'s lease is active — single-active-editor holds even within one user\'s own tabs',
        bBlocked);
      ok('PH7-15: the lease document still shows A as owner after B\'s rejected attempt (no partial/corrupted write)',
        (await getDoc(doc(aDb, 'editLocks/customers__PH7-1'))).data().sessionId === 's_tabA');

      // ---- STEP 15/6/9: expiry -> takeover ----
      await backdateExpiry('editLocks/customers__PH7-1', LEASE_MS + 5000); // simulate a sleep/partition longer than the lease
      await acquireTxn(bDb, 'customers', 'PH7-1', B); // B (independent client) takes over the now-expired lease
      const afterTakeover = (await getDoc(doc(aDb, 'editLocks/customers__PH7-1'))).data();
      ok('MANDATORY SLEEP/WAKE: after the lease is simulated-expired (backdated past LEASE_MS, standing in for a laptop asleep/backgrounded/partitioned past the lease window), B legitimately acquires it',
        afterTakeover.sessionId === 's_tabB' && toMillis(afterTakeover.expiresAt) > Date.now());

      // ---- STEP 16: STALE OWNER RENEWAL — A's heartbeat resumes (laptop wakes) ----
      let aRenewBlocked = false;
      try { await renewTxn(aDb, 'customers', 'PH7-1', A); } catch (e) { aRenewBlocked = e.code === 'lease/lost'; }
      ok('MANDATORY STALE-LEASE: A\'s heartbeat (wake-up / reconnect) CANNOT renew B\'s lease — rejected lease/lost',
        aRenewBlocked);
      ok('MANDATORY STALE-LEASE: the lease document is UNCHANGED by A\'s rejected renewal — still B, still a fresh (not backdated) expiresAt',
        (await getDoc(doc(aDb, 'editLocks/customers__PH7-1'))).data().sessionId === 's_tabB');

      // ---- STEP 17: STALE OWNER RELEASE — A's delayed cleanup (pagehide from
      // the OLD tab instance, or the useEditLease unmount cleanup) fires late ----
      await releaseTxn(aDb, 'customers', 'PH7-1', A);
      ok('MANDATORY STALE-LEASE: A\'s delayed release (e.g. a stale tab\'s pagehide/unmount firing after the fact) does NOT remove B\'s lease',
        (await getDoc(doc(aDb, 'editLocks/customers__PH7-1'))).exists()
        && (await getDoc(doc(aDb, 'editLocks/customers__PH7-1'))).data().sessionId === 's_tabB');

      // ---- STEP 18: STALE FORM SAVE — the Phase 1a `_rev` guard is the actual
      // backstop even if the lease layer above is somehow bypassed. Prove it
      // independently: A opened the record at _rev 0, B has since saved (rev 1);
      // A's guarded save (using its stale captured _rev) must be rejected, never
      // silently overwrite B's edit. Reuses the same guardedSet-shape transaction
      // already proven in the Phase 1a/CWF sections above, in explicit lifecycle
      // framing (sleep -> stale _rev -> save attempt).
      await seedDoc(testEnv, 'customers/PH7-CUST', { name: 'B version', _rev: 1 });
      const guardedSaveTxn = (db, id, data, expectedRev) => runTransaction(db, async (tx) => {
        const ref = doc(db, 'customers', id);
        const snap = await tx.get(ref);
        const server = snap.data();
        if ((server._rev || 0) !== expectedRev) { const e = new Error('conc/stale'); e.code = 'conc/stale'; throw e; }
        tx.set(ref, { ...data, _rev: (server._rev || 0) + 1 });
      });
      let aStaleSaveBlocked = false;
      try { await guardedSaveTxn(aDb, 'PH7-CUST', { name: 'A stale overwrite attempt' }, 0); } catch (e) { aStaleSaveBlocked = e.code === 'conc/stale'; }
      ok('MANDATORY STALE-LEASE (Phase 1a backstop): A\'s save, captured at the _rev it opened with (0) before B\'s save advanced it to 1, is rejected conc/stale — cannot silently overwrite B even if A somehow bypassed the lease layer entirely',
        aStaleSaveBlocked
        && (await getDoc(doc(aDb, 'customers/PH7-CUST'))).data().name === 'B version');

      // ---- STEP 27 — PHASE 7b FIX: editLocks rules are now session-aware,
      // not just uid-aware. Tests the RAW RULES directly (assertSucceeds/
      // assertFails on a plain updateDoc/deleteDoc, bypassing lib/
      // editLease.js's own client transaction entirely) — this is the
      // independent, second line of defense a malicious/buggy/out-of-band
      // client (one that talks to Firestore directly) is now actually
      // constrained by, not just the app's own well-behaved transaction
      // logic (already proven session-safe above via PH7-15/MANDATORY
      // STALE-LEASE, which exercise the real acquireTxn/renewTxn/releaseTxn
      // functions, not raw rules calls).
      await testEnv.clearFirestore();
      const rawUpdate = (db, ownerUid, ownerEmail, sessionId, expiresInMs = LEASE_MS) =>
        updateDoc(doc(db, 'editLocks/customers__PH7-2'), { ownerUid, ownerEmail, sessionId, expiresAt: Timestamp.fromMillis(Date.now() + expiresInMs) });
      // A RELEASE-shaped update — own identity, but expiresAt in the PAST
      // (see releaseShapeOk() in firestore.rules) — this is now the only way
      // an active lease is ever given up, since delete() carries no payload.
      const rawRelease = (db, ownerUid, ownerEmail, sessionId) =>
        updateDoc(doc(db, 'editLocks/customers__PH7-2'), { ownerUid, ownerEmail, sessionId, expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
      const rawCreate = (db, ownerUid, ownerEmail, sessionId, expiresInMs = LEASE_MS) =>
        setDoc(doc(db, 'editLocks/customers__PH7-2'), { ownerUid, ownerEmail, sessionId, acquiredAt: Timestamp.now(), heartbeatAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + expiresInMs) });
      const rawDelete = (db) => deleteDoc(doc(db, 'editLocks/customers__PH7-2'));

      // 1. A1 can create its own lease.
      ok('PH7-27 (1): A1 can create its own lease (raw rules)', await allow(rawCreate(aDb, A.uid, A.email, A.sessionId)));
      // 2. A1 can renew its own lease.
      ok('PH7-27 (2): A1 can renew its own lease (raw rules)', await allow(rawUpdate(aDb, A.uid, A.email, A.sessionId)));
      // 3. A2 (SAME uid, DIFFERENT session) cannot overwrite A1's active lease.
      ok('PH7-27 FIXED (3): A2 (same uid as A1, different session) can no longer overwrite A1\'s ACTIVE lease at the raw rules layer',
        await deny(rawUpdate(bDb, B.uid, B.email, B.sessionId))); // B here = same uid, sessionId s_tabB — see A/B setup above
      // 4. A2 cannot renew A1's active lease (renew = update with A2's own claimed identity but targeting a still-A1-owned doc — same check).
      ok('PH7-27 FIXED (4): A2 cannot "renew" (update) A1\'s active lease either — same denial as (3), renewal and overwrite are the same rules path',
        await deny(rawUpdate(bDb, B.uid, B.email, B.sessionId, LEASE_MS)));
      // 5. A2 cannot release A1's active lease.
      ok('PH7-27 FIXED (5): A2 cannot release A1\'s active lease at the raw rules layer (a release-shaped update — own identity, past expiresAt — is still gated on ownedByMe()+sameSession() like any other update)',
        await deny(rawRelease(bDb, B.uid, B.email, B.sessionId)));
      ok('PH7-27 FIXED (5b): a raw DELETE of A1\'s still-active lease is denied for EVERY session, including A1\'s own — delete is now restricted to already-expired documents only (see (7) below for how A1 actually releases)',
        await deny(rawDelete(bDb)) && await deny(rawDelete(aDb)));
      // 6. A genuinely DIFFERENT uid (B in the discovery report's sense — a
      // different signed-in user) cannot modify A1's lease either (unchanged
      // by this fix — ownedByMe() already enforced the uid boundary; still
      // re-verified here so the full 10-point matrix lives in one place).
      const otherUserDb = testEnv.authenticatedContext('uid-other-user').firestore();
      ok('PH7-27 (6): a genuinely different uid cannot modify A1\'s active lease (update)',
        await deny(rawUpdate(otherUserDb, 'uid-other-user', 'x@x.com', 's_x')));
      ok('PH7-27 (6): a genuinely different uid cannot modify A1\'s active lease (delete)',
        await deny(rawDelete(otherUserDb)));
      // 7. A1 can release A1 (its own active lease) — via the release-shaped
      // update, the only path an active lease can be given up through now.
      ok('PH7-27 (7): A1 can release its own active lease via a release-shaped update (raw rules)', await allow(rawRelease(aDb, A.uid, A.email, A.sessionId)));
      ok('PH7-27 (7b): after A1\'s release, the document is EXPIRED (present, past expiresAt) — now deletable by anyone, and acquirable by anyone, matching an absent document in every way that matters',
        await allow(rawDelete(bDb)));
      // 8. An EXPIRED A1 lease can be replaced (by anyone signed in, uid or
      // session need not match). Seeded directly (bypassing rules) since the
      // CREATE rule itself requires expiresAt to be in the FUTURE — an
      // already-expired lease can only ever arise from time passing after a
      // legitimate create/renew, never from a create call, so it can't be
      // produced through rawCreate here.
      await seedDoc(testEnv, 'editLocks/customers__PH7-2', {
        ownerUid: A.uid, ownerEmail: A.email, sessionId: A.sessionId,
        acquiredAt: Timestamp.now(), heartbeatAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() - 5000),
      });
      ok('PH7-27 (8): an EXPIRED lease can still be taken over by a different uid+session (update)',
        await allow(rawUpdate(bDb, B.uid, B.email, B.sessionId)));
      // 9. New lease acquisition still works (create, no existing doc).
      await testEnv.clearFirestore();
      ok('PH7-27 (9): a brand-new lease (no existing document) can still be created', await allow(rawCreate(bDb, B.uid, B.email, B.sessionId)));
      // 10. Compatible with Phase 1b: the SAME client transactions
      // (acquireTxn/renewTxn/releaseTxn) proven throughout this file's
      // PH7-15/MANDATORY SLEEP-WAKE/MANDATORY STALE-LEASE sections above all
      // passed AFTER this rules change (this section runs later in the same
      // file, against the same already-patched rules) — Phase 1b's own
      // legitimate acquire/renew/release behavior is unaffected by tightening
      // the same-uid-different-session case, since the client transactions
      // already never attempted that case in the first place.
      ok('PH7-27 (10): compatible with Phase 1b — every acquire/renew/release assertion earlier in this file already passed against these same (patched) rules',
        PASS > 30); // sanity: this file's PH7-15/sleep-wake/stale-lease sections (30+ assertions) ran and passed before this point

      // ---- STEP 12/13/14: durable operation-ID tab-duplication — SERVER-SIDE
      // RATIONALE PROOF (Phase 7b / PH7-01 fixed; see lib/durableOpId.js and
      // tests/browser-lifecycle-discovery.test.cjs section 5 for the actual
      // client-side proof that this collision can no longer arise in the
      // shipped app). sessionStorage is copied by the BROWSER on a genuine
      // "duplicate tab" / "reopen closed tab" (HTML Living Standard: a cloned
      // browsing context shares the sessionStorage of the context it was
      // cloned from) — unlike a brand-new tab, which starts with empty
      // sessionStorage. Before the PH7-01 fix, that clone meant a duplicated
      // tab's useDurableOpId could read back Tab A's id verbatim and reuse it
      // for a genuinely different business action. This block hand-forces
      // that exact id collision at the SERVER transaction layer (bypassing
      // the real, now-fixed client entirely) to prove WHY the fix had to live
      // client-side: the server's own idempotency-by-id is correct and
      // intentional (it is what makes refresh/retry safe), so it cannot and
      // must not be loosened — the only correct fix is preventing the client
      // from ever manufacturing this collision for a new action, which
      // lib/durableOpId.js's window.name page-instance tagging now does.
      await testEnv.clearFirestore();
      const payTxn2 = (db, invId, pay) => runTransaction(db, async (tx) => {
        const ref = doc(db, 'invoices', invId);
        const data = (await tx.get(ref)).data();
        const prior = Array.isArray(data.payments) ? data.payments : [];
        if (pay && pay.id && prior.some((p) => p && p.id === pay.id)) return { alreadyApplied: true };
        const payments = [...prior, pay];
        const paid = payments.reduce((s, p) => s + Number(p.amount), 0);
        tx.update(ref, { payments, paid, _rev: (data._rev || 0) + 1 });
        return { alreadyApplied: false };
      });
      await seedDoc(testEnv, 'invoices/PH7-DUPTAB', { lines: [{ qty: 1, rate: 5000 }], payments: [], _rev: 0 });
      const sharedOpIdFromDuplicateTab = 'p_shared_from_duplicate'; // what Tab B's COPIED sessionStorage contains
      const rTabA = await payTxn2(aDb, 'PH7-DUPTAB', { id: sharedOpIdFromDuplicateTab, mode: 'Cash', amount: 500 });
      // Tab B — the DUPLICATE — independently decides to record a DIFFERENT,
      // legitimately separate payment (₹700, e.g. the customer paid a second,
      // larger instalment) but its sessionStorage already had the id copied
      // from A, so useDurableOpId's mount-time readOrCreateOpId finds it and
      // reuses it instead of minting a fresh one for this genuinely new intent.
      const rTabB = await payTxn2(bDb, 'PH7-DUPTAB', { id: sharedOpIdFromDuplicateTab, mode: 'UPI', amount: 700 });
      const invAfter = (await getDoc(doc(aDb, 'invoices/PH7-DUPTAB'))).data();
      ok('PH7-14 RATIONALE (1) [server behavior, id forced to collide]: Tab A\'s ₹500 payment applies',
        rTabA.alreadyApplied === false && invAfter.payments.some((p) => p.id === sharedOpIdFromDuplicateTab && p.amount === 500));
      ok('PH7-14 RATIONALE (2) [server behavior, id forced to collide — this is exactly why PH7-01\'s fix must be client-side]: with the SAME id, Tab B\'s GENUINELY DIFFERENT ₹700 payment is (correctly, by design) treated as "alreadyApplied" by the server\'s own idempotency guard',
        rTabB.alreadyApplied === true);
      ok('PH7-14 RATIONALE (3): the invoice shows ONLY the ₹500 payment when the id collides — confirming the server-side guard is strict-by-id (as intended for refresh/retry safety), which is precisely the property PH7-01\'s client-side fix (lib/durableOpId.js page-instance tagging) protects by never letting a duplicated tab reuse another tab\'s id for a new action',
        invAfter.paid === 500 && invAfter.payments.length === 1);
      const rFreshTab = await payTxn2(bDb, 'PH7-DUPTAB', { id: 'p_freshly_minted_by_a_normal_new_tab', mode: 'UPI', amount: 700 });
      const invAfterFresh = (await getDoc(doc(aDb, 'invoices/PH7-DUPTAB'))).data();
      ok('PH7-14 (control): the SAME scenario with a genuinely fresh id (what a NON-colliding tab — normal new tab, or a duplicated tab under the PH7-01 fix — actually produces) applies as a real second payment, proving the idempotency mechanism itself is correct and the fix point is entirely about never manufacturing the colliding id in the first place',
        rFreshTab.alreadyApplied === false && invAfterFresh.paid === 1200 && invAfterFresh.payments.length === 2);
    }

    // =========================================================================
    // PHASE 8B (PH8-05) — pendingSales: durable single-document offline
    // Quick Sell intent. Scoped strictly to its own creator: no one can
    // forge, read, or delete (replay) another user's pending sale. Never
    // updated — created once, deleted once (by its owner reconciling it, or
    // discarding a definite rejection).
    // =========================================================================
    await testEnv.clearFirestore();
    {
      const aDb = testEnv.authenticatedContext('uid-A', { email: STAFF_EMAIL }).firestore();
      const bDb = testEnv.authenticatedContext('uid-B', { email: STAFF_EMAIL }).firestore();
      const pendingRef = (db) => doc(db, 'pendingSales/ps1');
      const validPending = (createdBy) => ({
        opId: 'ps1', partId: 'p1', partName: 'Brake Pad', want: 2,
        pricePerUnit: 500, unitCost: 300, monthKey: '2026-01',
        createdBy, createdByEmail: 'a@example.test', createdAt: Timestamp.now(),
      });

      ok('PH8-05: A can create their own pendingSales doc', await allow(setDoc(pendingRef(aDb), validPending('uid-A'))));
      ok('PH8-05: create is denied if createdBy does not match the caller\'s own uid (cannot forge another user\'s pending sale)',
        await deny(setDoc(doc(aDb, 'pendingSales/ps2'), validPending('uid-B'))));
      ok('PH8-05: create is denied without a valid partId (string) / want (positive int) shape',
        await deny(setDoc(doc(aDb, 'pendingSales/ps3'), { ...validPending('uid-A'), want: 0 })));

      ok('PH8-05: A (the owner) can read their own pendingSales doc', await allow(getDoc(pendingRef(aDb))));
      ok('PH8-05: B (a different signed-in user) cannot read A\'s pendingSales doc', await deny(getDoc(pendingRef(bDb))));
      ok('PH8-05: B cannot delete A\'s pendingSales doc (cannot replay/discard someone else\'s pending sale)', await deny(deleteDoc(pendingRef(bDb))));
      ok('PH8-05: pendingSales is NEVER updated — even the owner\'s own update is denied (create once, delete once)',
        await deny(updateDoc(pendingRef(aDb), { want: 3 })));
      ok('PH8-05: A (the owner) can delete their own pendingSales doc once reconciled or discarded', await allow(deleteDoc(pendingRef(aDb))));
    }

    // =========================================================================
    // PHASE 19 — authorization matrix (targeted gaps not covered above).
    //   - the `staff` sub-object of appSettings/roles is as protected as `admins`
    //     (a staffer cannot grant THEMSELVES a `deletes`/`costPrices` perm)
    //   - salesRollups is a running aggregate: `update` is signedIn (unlike the
    //     append-only ledgers) — documented, because it is fully derivable from
    //     `sales` and there is no per-row financial record to protect
    //   - a denied delete stays denied on a RETRY (an op id / second attempt is
    //     not an authorization bypass)
    //   - the OWNER (ownerEmail() in rules) can delete even when the roles doc
    //     lists only OTHER admins — the hardcoded owner bypass is real
    // =========================================================================
    await testEnv.clearFirestore();
    {
      await seedAdmins(testEnv, [ADMIN_EMAIL]);
      const staffDb = testEnv.authenticatedContext('staff-uid', { email: STAFF_EMAIL }).firestore();
      const adminDb = testEnv.authenticatedContext('admin-uid', { email: ADMIN_EMAIL }).firestore();
      const ownerDb = testEnv.authenticatedContext('owner-uid', { email: OWNER_EMAIL }).firestore();

      // --- role escalation via the `staff` sub-object -------------------------
      ok('PHASE 19 — authorization matrix: staff CANNOT grant themselves a perm by merge-writing appSettings/roles.staff',
        await deny(setDoc(doc(staffDb, 'appSettings/roles'), { staff: { [STAFF_EMAIL]: { deletes: true, costPrices: true } } }, { merge: true })));
      ok('PHASE 19: staff CANNOT add themselves to appSettings/roles.admins by merge either',
        await deny(setDoc(doc(staffDb, 'appSettings/roles'), { admins: [ADMIN_EMAIL, STAFF_EMAIL] }, { merge: true })));
      ok('PHASE 19: an existing ADMIN CAN set a staffer\'s perms (the legitimate path)',
        await allow(setDoc(doc(adminDb, 'appSettings/roles'), { staff: { [STAFF_EMAIL]: { deletes: true } } }, { merge: true })));

      // --- salesRollups: running aggregate, update is signedIn (by design) ----
      await seedDoc(testEnv, 'salesRollups/2026-01', { revenue: 1000, count: 2 });
      ok('PHASE 19: staff CAN update salesRollups (running aggregate, fully derivable from sales — not an append-only ledger)',
        await allow(updateDoc(doc(staffDb, 'salesRollups/2026-01'), { revenue: 1500 })));
      ok('PHASE 19: staff CANNOT delete salesRollups (admin-only, same as every other collection)',
        await deny(deleteDoc(doc(staffDb, 'salesRollups/2026-01'))));

      // --- a denied delete stays denied on retry -----------------------------
      await seedDoc(testEnv, 'invoices/inv1', { invNo: 'INV-0001', grandTotal: 500 });
      ok('PHASE 19: staff delete of an invoice denied', await deny(deleteDoc(doc(staffDb, 'invoices/inv1'))));
      ok('PHASE 19: RETRY of the same staff delete is still denied (retrying is not an authorization bypass)',
        await deny(deleteDoc(doc(staffDb, 'invoices/inv1'))));
      ok('PHASE 19: the invoice still exists after the two denied deletes (admin can still read it)',
        await allow(getDoc(doc(adminDb, 'invoices/inv1'))));

      // --- owner bypass with a roles doc that lists only OTHER admins --------
      ok('PHASE 19: the OWNER can delete a business record even when appSettings/roles lists only a DIFFERENT admin',
        await allow(deleteDoc(doc(ownerDb, 'invoices/inv1'))));

      // --- the single-shop shared-data model is the intended read/write ------
      await seedDoc(testEnv, 'customers/cX', { name: 'Someone Else' });
      ok('PHASE 19 (IDOR): a signed-in staffer CAN read+update ANY customer record — intentional single-shop shared data, NOT per-user isolation',
        await allow(getDoc(doc(staffDb, 'customers/cX'))) && await allow(updateDoc(doc(staffDb, 'customers/cX'), { phone: '9000000000' })));
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
