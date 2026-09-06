/**
 * tests/rules/security-bypass.rules.test.cjs — PHASE 20
 *
 * FIELD-LEVEL Firestore security. Not "can a role touch a collection" (that is
 * tests/rules/firestore.rules.test.cjs) but: "even when an authenticated client
 * IS allowed into a collection, can it forge a protected field or violate an
 * invariant?"
 *
 * Runs the REAL firestore.rules against the emulator. Independent expectations —
 * every assertion says what SHOULD happen and checks the emulator agrees.
 *
 * The bar is NOT "make every field immutable". A single-shop client-side Firebase
 * app intentionally lets authenticated staff write ordinary business fields
 * (customer.name, part.stock, invoice.payments) — those are APPLICATION-ENFORCED
 * / DERIVED / INTENTIONALLY CLIENT-WRITABLE. The bar is: a malicious authenticated
 * client cannot forge an ACTOR identity, rewrite HISTORY, escalate a ROLE, take
 * over another user's LEASE, reach another user's PENDING op, or reverse the
 * monotonic invoice COUNTER.
 */
const {
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, serverTimestamp, Timestamp,
} = require('firebase/firestore');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { makeTestEnv, seedAdmins, seedDoc, OWNER_EMAIL, ADMIN_EMAIL, STAFF_EMAIL } = require('./helpers.cjs');

let PASS = 0, FAIL = 0;
const ok = (n, c) => { if (c) { PASS++; console.log(`  ok ${n}`); } else { FAIL++; console.log(`  FAIL ${n}`); } };
const allow = async (p) => { try { await assertSucceeds(p); return true; } catch { return false; } };
const deny = async (p) => { try { await assertFails(p); return true; } catch { return false; } };

const A = { uid: 'uid-A', email: STAFF_EMAIL };
const B = { uid: 'uid-B', email: 'staff-b@shop.test' };

async function main() {
  const testEnv = await makeTestEnv();
  try {
    // ===================================================================
    // 20D — UNAUTHENTICATED WRITE (create / update / delete) — Firestore
    //       itself must reject, not just the UI redirect.
    // ===================================================================
    await testEnv.clearFirestore();
    {
      const anon = testEnv.unauthenticatedContext().firestore();
      await seedDoc(testEnv, 'invoices/i1', { invNo: 'INV-0001', grandTotal: 500 });
      await seedDoc(testEnv, 'counters/invoices', { next: 5 });
      ok('20D anon: create invoice DENIED', await deny(setDoc(doc(anon, 'invoices/i9'), { grandTotal: 1 })));
      ok('20D anon: update invoice DENIED', await deny(updateDoc(doc(anon, 'invoices/i1'), { status: 'Paid' })));
      ok('20D anon: delete invoice DENIED', await deny(deleteDoc(doc(anon, 'invoices/i1'))));
      ok('20D anon: create sales row DENIED', await deny(setDoc(doc(anon, 'sales/s9'), { amount: 1 })));
      ok('20D anon: create auditLog DENIED', await deny(setDoc(doc(anon, 'auditLog/a9'), { performedBy: 'x', action: 'y' })));
      ok('20D anon: write appSettings DENIED', await deny(setDoc(doc(anon, 'appSettings/roles'), { admins: ['me'] })));
      ok('20D anon: advance counter DENIED', await deny(updateDoc(doc(anon, 'counters/invoices'), { next: 6 })));
      ok('20D anon: create editLock DENIED', await deny(setDoc(doc(anon, 'editLocks/customers__c1'), { ownerUid: 'x', sessionId: 's', expiresAt: Timestamp.fromMillis(Date.now() + 60000) })));
      ok('20D anon: create pendingSales DENIED', await deny(setDoc(doc(anon, 'pendingSales/p9'), { createdBy: 'x', partId: 'p', want: 1 })));
      ok('20D anon: read recoveryVault DENIED', await deny(getDoc(doc(anon, 'recoveryVault/v1'))));
    }

    // ===================================================================
    // 20I / 20O / 20Q — AUDIT LOG: actor identity is a security invariant.
    //   performedBy  — the caller's uid (PH15-03: must == request.auth.uid)
    //   performedByEmail — the string the audit UI DISPLAYS as "User" (PHASE 20)
    //   createdAt    — must be server-stamped, not client-backdated (PHASE 20)
    // ===================================================================
    await testEnv.clearFirestore();
    {
      const aDb = testEnv.authenticatedContext(A.uid, { email: A.email }).firestore();
      const good = () => ({
        action: 'delete_part', entity: 'Part', entityId: 'p1', details: {},
        performedBy: A.uid, performedByEmail: A.email, createdAt: serverTimestamp(),
      });
      ok('20I auditLog: a correctly self-attributed entry (own uid + own email + server time) is ALLOWED',
        await allow(addDoc(collection(aDb, 'auditLog'), good())));
      ok('20I auditLog: performedBy = ANOTHER uid → DENIED (PH15-03)',
        await deny(addDoc(collection(aDb, 'auditLog'), { ...good(), performedBy: B.uid })));
      ok('20I auditLog: performedBy MISSING → DENIED',
        await deny(addDoc(collection(aDb, 'auditLog'), (() => { const g = good(); delete g.performedBy; return g; })())));
      ok('20I auditLog: own uid but performedByEmail = ANOTHER user\'s email → DENIED (cannot impersonate the displayed actor — PHASE 20)',
        await deny(addDoc(collection(aDb, 'auditLog'), { ...good(), performedByEmail: OWNER_EMAIL })));
      ok('20I auditLog: own uid but performedByEmail = "System" → DENIED (cannot masquerade as a non-user)',
        await deny(addDoc(collection(aDb, 'auditLog'), { ...good(), performedByEmail: 'System' })));
      ok('20I auditLog: performedByEmail MISSING → DENIED (the displayed actor must be present and real)',
        await deny(addDoc(collection(aDb, 'auditLog'), (() => { const g = good(); delete g.performedByEmail; return g; })())));
      ok('20I auditLog: client-supplied past createdAt (backdated history) → DENIED (must be request.time)',
        await deny(addDoc(collection(aDb, 'auditLog'), { ...good(), createdAt: Timestamp.fromMillis(Date.now() - 5 * 86400000) })));
      ok('20I auditLog: client-supplied future createdAt → DENIED',
        await deny(addDoc(collection(aDb, 'auditLog'), { ...good(), createdAt: Timestamp.fromMillis(Date.now() + 86400000) })));
      // 20Q — existing entries are immutable history
      await seedDoc(testEnv, 'auditLog/seed1', { performedBy: B.uid, performedByEmail: B.email, action: 'sell_part', createdAt: Timestamp.now() });
      ok('20Q auditLog: UPDATE an existing entry (change actor) → DENIED (append-only)',
        await deny(updateDoc(doc(aDb, 'auditLog/seed1'), { performedByEmail: A.email })));
      ok('20Q auditLog: DELETE an existing entry as non-admin → DENIED',
        await deny(deleteDoc(doc(aDb, 'auditLog/seed1'))));
    }

    // ===================================================================
    // 20F / 20R — COUNTER: monotonic invoice numbering is a security invariant
    //   (a reversed counter = duplicate legal invoice serials).
    // ===================================================================
    await testEnv.clearFirestore();
    {
      const aDb = testEnv.authenticatedContext(A.uid, { email: A.email }).firestore();
      await seedDoc(testEnv, 'counters/invoices', { next: 10 });
      ok('20F counter: DECREASE 10 → 9 → DENIED', await deny(updateDoc(doc(aDb, 'counters/invoices'), { next: 9 })));
      ok('20F counter: reset 10 → 0 → DENIED', await deny(updateDoc(doc(aDb, 'counters/invoices'), { next: 0 })));
      ok('20F counter: reset 10 → 1 → DENIED', await deny(updateDoc(doc(aDb, 'counters/invoices'), { next: 1 })));
      ok('20F counter: set to a non-int (10 → 9.5) → DENIED', await deny(updateDoc(doc(aDb, 'counters/invoices'), { next: 9.5 })));
      ok('20F counter: set to a string → DENIED', await deny(updateDoc(doc(aDb, 'counters/invoices'), { next: '9999' })));
      ok('20F counter: add an extra field alongside next → DENIED (hasOnly)', await deny(updateDoc(doc(aDb, 'counters/invoices'), { next: 11, hijack: true })));
      ok('20F counter: DELETE the counter → DENIED (losing it restarts the serial)', await deny(deleteDoc(doc(aDb, 'counters/invoices'))));
      ok('20R counter: legitimate advance 10 → 11 → ALLOWED', await allow(updateDoc(doc(aDb, 'counters/invoices'), { next: 11 })));
      ok('20R counter: a large forward jump 11 → 100000 → ALLOWED (INFO — monotonic invariant holds; a nuisance, not a security breach; a trusted staffer could also cause a jump by rapid billing)',
        await allow(updateDoc(doc(aDb, 'counters/invoices'), { next: 100000 })));
      ok('20O counter: CREATE a new sequence with next < 1 → DENIED', await deny(setDoc(doc(aDb, 'counters/estimates'), { next: 0 })));
      ok('20O counter: CREATE with an extra field → DENIED', await deny(setDoc(doc(aDb, 'counters/estimates'), { next: 1, owner: 'x' })));
    }

    // ===================================================================
    // 20G / 20S — APP SETTINGS: role/permission data. A Staff user must not be
    //   able to touch ANYTHING here (business settings, admins, staff perms).
    // ===================================================================
    await testEnv.clearFirestore();
    {
      await seedAdmins(testEnv, [ADMIN_EMAIL]);
      await seedDoc(testEnv, 'appSettings/biz', { shopName: 'Real Shop', gst: '36AAA' });
      const staffDb = testEnv.authenticatedContext(A.uid, { email: A.email }).firestore();
      const adminDb = testEnv.authenticatedContext('admin-uid', { email: ADMIN_EMAIL }).firestore();
      ok('20G staff: change business settings (appSettings/biz) → DENIED', await deny(updateDoc(doc(staffDb, 'appSettings/biz'), { shopName: 'Hacked' })));
      ok('20G staff: add self to admins[] → DENIED', await deny(updateDoc(doc(staffDb, 'appSettings/roles'), { admins: [ADMIN_EMAIL, A.email] })));
      ok('20G staff: grant self a staff perm via appSettings/roles.staff → DENIED', await deny(setDoc(doc(staffDb, 'appSettings/roles'), { staff: { [A.email]: { deletes: true } } }, { merge: true })));
      ok('20G staff: create a brand-new appSettings doc → DENIED', await deny(setDoc(doc(staffDb, 'appSettings/evil'), { x: 1 })));
      ok('20G staff: inject an isAdmin/role field onto appSettings/biz → DENIED', await deny(updateDoc(doc(staffDb, 'appSettings/biz'), { isAdmin: true, role: 'owner' })));
      ok('20G nobody: delete appSettings → DENIED (delete: if false)', await deny(deleteDoc(doc(adminDb, 'appSettings/biz'))));
      ok('20G admin: legitimately update appSettings/roles → ALLOWED', await allow(updateDoc(doc(adminDb, 'appSettings/roles'), { admins: [ADMIN_EMAIL, B.email] })));
    }

    // ===================================================================
    // 20H / 20Q — LEDGERS: sales / restocks / stockAdjustments are append-only.
    //   Historical authoritative rows can never be rewritten by a client.
    // ===================================================================
    await testEnv.clearFirestore();
    {
      await seedAdmins(testEnv, [ADMIN_EMAIL]);
      for (const led of ['sales', 'restocks', 'stockAdjustments']) {
        await seedDoc(testEnv, `${led}/row1`, { amount: 1000, qty: 5, opId: 'op1', partId: 'p1' });
      }
      const staffDb = testEnv.authenticatedContext(A.uid, { email: A.email }).firestore();
      const adminDb = testEnv.authenticatedContext('admin-uid', { email: ADMIN_EMAIL }).firestore();
      for (const led of ['sales', 'restocks', 'stockAdjustments']) {
        ok(`20H ${led}: staff CREATE a new row → ALLOWED (the app appends rows; this is not a bypass)`,
          await allow(setDoc(doc(staffDb, `${led}/new1`), { amount: 1, opId: 'op-new', partId: 'p1' })));
        ok(`20H ${led}: staff UPDATE row1.amount (rewrite an authoritative historical figure) → DENIED`,
          await deny(updateDoc(doc(staffDb, `${led}/row1`), { amount: 999999 })));
        ok(`20H ${led}: staff UPDATE row1.opId (rewrite the idempotency marker) → DENIED`,
          await deny(updateDoc(doc(staffDb, `${led}/row1`), { opId: 'forged' })));
        ok(`20H ${led}: ADMIN UPDATE row1 → STILL DENIED (append-only overrides admin)`,
          await deny(updateDoc(doc(adminDb, `${led}/row1`), { amount: 999999 })));
        ok(`20H ${led}: staff DELETE row1 → DENIED (admin-only)`,
          await deny(deleteDoc(doc(staffDb, `${led}/row1`))));
      }
      // salesRollups is a DERIVED running aggregate, not an append-only ledger — update IS allowed.
      await seedDoc(testEnv, 'salesRollups/2026-01', { revenue: 1000 });
      ok('20H salesRollups: staff UPDATE → ALLOWED (INFO — a derived aggregate, fully recomputable from the immutable sales ledger; not an authoritative per-row record)',
        await allow(updateDoc(doc(staffDb, 'salesRollups/2026-01'), { revenue: 1500 })));
      ok('20H salesRollups: staff DELETE → DENIED (admin-only)',
        await deny(deleteDoc(doc(staffDb, 'salesRollups/2026-01'))));
    }

    // ===================================================================
    // 20J — EDIT LOCKS: ownerUid + sessionId cannot be forged to take over
    //   another user's ACTIVE editor lease.
    // ===================================================================
    await testEnv.clearFirestore();
    {
      const aDb = testEnv.authenticatedContext(A.uid, { email: A.email }).firestore();
      const bDb = testEnv.authenticatedContext(B.uid, { email: B.email }).firestore();
      const active = { ownerUid: A.uid, ownerEmail: A.email, sessionId: 'sess-A', acquiredAt: Timestamp.now(), heartbeatAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 90000) };
      await seedDoc(testEnv, 'editLocks/customers__c1', active);
      ok('20J B: create a lock claiming ownerUid = A → DENIED', await deny(setDoc(doc(bDb, 'editLocks/customers__c2'), { ...active, sessionId: 'sess-B' })));
      ok('20J B: overwrite A\'s ACTIVE lock (steal it, own uid) → DENIED', await deny(updateDoc(doc(bDb, 'editLocks/customers__c1'), { ownerUid: B.uid, sessionId: 'sess-B', expiresAt: Timestamp.fromMillis(Date.now() + 90000) })));
      ok('20J B: extend A\'s ACTIVE lock\'s expiresAt (denial of release) → DENIED', await deny(updateDoc(doc(bDb, 'editLocks/customers__c1'), { expiresAt: Timestamp.fromMillis(Date.now() + 90000) })));
      ok('20J B: delete A\'s ACTIVE lock → DENIED (delete only when expired)', await deny(deleteDoc(doc(bDb, 'editLocks/customers__c1'))));
      ok('20J A (real 2nd tab, same uid, DIFFERENT session): overwrite own active lock → DENIED (sameSession — PH7-27)',
        await deny(updateDoc(doc(aDb, 'editLocks/customers__c1'), { ownerUid: A.uid, sessionId: 'sess-A-tab2', expiresAt: Timestamp.fromMillis(Date.now() + 90000) })));
      ok('20J A: claim a lease with a >3-minute expiry (hold a record forever) → DENIED',
        await deny(setDoc(doc(aDb, 'editLocks/customers__c3'), { ownerUid: A.uid, ownerEmail: A.email, sessionId: 's', acquiredAt: Timestamp.now(), heartbeatAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 30 * 60000) })));
      ok('20J A: renew its OWN active lock (same session) → ALLOWED',
        await allow(updateDoc(doc(aDb, 'editLocks/customers__c1'), { ownerUid: A.uid, ownerEmail: A.email, sessionId: 'sess-A', heartbeatAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 90000) })));
    }

    // ===================================================================
    // 20K — PENDING SALES: strictly creator-scoped. A cannot be reached by B.
    // ===================================================================
    await testEnv.clearFirestore();
    {
      const aDb = testEnv.authenticatedContext(A.uid, { email: A.email }).firestore();
      const bDb = testEnv.authenticatedContext(B.uid, { email: B.email }).firestore();
      const psA = { opId: 'psA', partId: 'p1', partName: 'X', want: 2, pricePerUnit: 500, unitCost: 300, monthKey: '2026-01', createdBy: A.uid, createdByEmail: A.email, createdAt: Timestamp.now() };
      ok('20K A: create own pendingSale → ALLOWED', await allow(setDoc(doc(aDb, 'pendingSales/psA'), psA)));
      ok('20K A: create a pendingSale with createdBy = B → DENIED (cannot forge the creator)', await deny(setDoc(doc(aDb, 'pendingSales/psA2'), { ...psA, createdBy: B.uid })));
      ok('20K A: create a pendingSale with want = 0 → DENIED (shape check)', await deny(setDoc(doc(aDb, 'pendingSales/psA3'), { ...psA, want: 0 })));
      ok('20K A: create a pendingSale with want = -5 → DENIED', await deny(setDoc(doc(aDb, 'pendingSales/psA4'), { ...psA, want: -5 })));
      ok('20K B: READ A\'s pendingSale → DENIED', await deny(getDoc(doc(bDb, 'pendingSales/psA'))));
      ok('20K B: UPDATE A\'s pendingSale → DENIED (update: if false anyway)', await deny(updateDoc(doc(bDb, 'pendingSales/psA'), { want: 99 })));
      ok('20K B: DELETE A\'s pendingSale (fake a "replay") → DENIED', await deny(deleteDoc(doc(bDb, 'pendingSales/psA'))));
      ok('20K A: UPDATE own pendingSale → DENIED (create once, delete once — no updates)', await deny(updateDoc(doc(aDb, 'pendingSales/psA'), { want: 3 })));
      ok('20K A: DELETE own pendingSale (reconciled) → ALLOWED', await allow(deleteDoc(doc(aDb, 'pendingSales/psA'))));
    }

    // ===================================================================
    // 20L / 20M / 20N / 20P — BUSINESS-FIELD FORGERY on shared collections.
    //   These are INTENTIONALLY client-writable in a single-shop app — the
    //   authoritative money/stock path is the transaction layer + immutable
    //   ledgers, NOT the invoice/part doc. Assert Firestore ALLOWS the write
    //   (so we classify honestly) but that the security boundary elsewhere
    //   is intact (delete still admin-only; ledgers still immutable).
    // ===================================================================
    await testEnv.clearFirestore();
    {
      await seedAdmins(testEnv, [ADMIN_EMAIL]);
      await seedDoc(testEnv, 'invoices/i1', { invNo: 'INV-0001', grandTotal: 500, paid: 0, status: 'Pending', lines: [{ qty: 1, rate: 500 }], payments: [] });
      await seedDoc(testEnv, 'parts/p1', { name: 'Brake Pad', stock: 5, salesCount: 0 });
      const staffDb = testEnv.authenticatedContext(A.uid, { email: A.email }).firestore();

      ok('20L invoice: staff writes paid=999999 / balance=0 / status="Paid" directly → Firestore ALLOWS it (INTENTIONAL — status/paid/balance are DERIVED from lines+payments on every read; the stored scalar is advisory. No sales/stock/rollup moves — those are transaction-only.)',
        await allow(updateDoc(doc(staffDb, 'invoices/i1'), { paid: 999999, balance: 0, status: 'Paid', grandTotal: 1 })));
      ok('20L invoice: staff injects isAdmin/role/internal fields onto the invoice → Firestore ALLOWS it (INFO — the app never reads these off an invoice; no schema-driven privilege anywhere keys on an invoice field)',
        await allow(updateDoc(doc(staffDb, 'invoices/i1'), { isAdmin: true, role: 'owner', internal: true })));
      ok('20L invoice: staff DELETE → DENIED (the real boundary — admin-only)',
        await deny(deleteDoc(doc(staffDb, 'invoices/i1'))));

      ok('20M part: staff writes stock=999999 / salesCount=999999 directly → Firestore ALLOWS it (INTENTIONAL — the app itself writes parts.stock directly in every stock op; a trusted staffer already adjusts stock via the UI. The authoritative movement record is the immutable restocks/stockAdjustments/sales ledger.)',
        await allow(updateDoc(doc(staffDb, 'parts/p1'), { stock: 999999, salesCount: 999999 })));
      ok('20M part: staff writes a forged appliedReserveIds / opId marker onto the part → Firestore ALLOWS it (INFO — markers are idempotency de-dup keys, not authorization; a forged marker at worst SKIPS a legit retry, it cannot create a phantom sale)',
        await allow(updateDoc(doc(staffDb, 'parts/p1'), { appliedReserveIds: ['forged'], someOpId: 'x' })));
      ok('20M part: staff DELETE → DENIED (the real boundary — admin-only)',
        await deny(deleteDoc(doc(staffDb, 'parts/p1'))));

      ok('20N system fields: staff overwrites createdAt/_rev/createdBy on a customer → Firestore ALLOWS it (INFO — single-shop; _rev is an optimistic-concurrency hint enforced by the client transaction, not a security field; there is no createdBy-keyed authorization on customers)',
        (await seedDoc(testEnv, 'customers/c1', { name: 'Ravi', createdAt: Timestamp.now(), _rev: 3, createdBy: B.uid }), true)
        && await allow(updateDoc(doc(staffDb, 'customers/c1'), { createdAt: Timestamp.fromMillis(0), _rev: 0, createdBy: A.uid })));
    }

    // ===================================================================
    // 20E — AUTHENTICATED DELETE per Phase 19's matrix (spot re-check that the
    //       matrix still holds after any rules edit in this phase).
    // ===================================================================
    await testEnv.clearFirestore();
    {
      await seedAdmins(testEnv, [ADMIN_EMAIL]);
      for (const c of ['customers', 'invoices', 'jobCards', 'parts', 'suppliers', 'purchaseOrders', 'reorderRequests']) {
        await seedDoc(testEnv, `${c}/x1`, { n: 1 });
      }
      const staffDb = testEnv.authenticatedContext(A.uid, { email: A.email }).firestore();
      const adminDb = testEnv.authenticatedContext('admin-uid', { email: ADMIN_EMAIL }).firestore();
      for (const c of ['customers', 'invoices', 'jobCards', 'parts', 'suppliers', 'purchaseOrders', 'reorderRequests']) {
        ok(`20E staff: delete ${c} → DENIED`, await deny(deleteDoc(doc(staffDb, `${c}/x1`))));
        ok(`20E admin: delete ${c} → ALLOWED`, await allow(deleteDoc(doc(adminDb, `${c}/x1`))));
      }
    }

    // ===================================================================
    // 20S — CROSS-DOCUMENT: a client changes its OWN appSettings/roles → does
    //   the SAME request then get admin powers? (isAdmin() re-reads the doc.)
    // ===================================================================
    await testEnv.clearFirestore();
    {
      const staffDb = testEnv.authenticatedContext(A.uid, { email: A.email }).firestore();
      await seedDoc(testEnv, 'parts/p1', { name: 'X' });
      // The staffer cannot even WRITE appSettings/roles (create/update: if isAdmin()),
      // so the "escalate then act" chain is broken at step 1.
      ok('20S staff: write appSettings/roles to list self as admin → DENIED (chain broken at step 1)',
        await deny(setDoc(doc(staffDb, 'appSettings/roles'), { admins: [A.email] })));
      ok('20S staff: (with NO roles doc) delete a part → DENIED (isAdmin() needs the owner email or an existing admin list; a non-owner cannot bootstrap)',
        await deny(deleteDoc(doc(staffDb, 'parts/p1'))));
    }

    // ===================================================================
    // 20C — UNAUTHENTICATED READ — must match the actual model
    //   (everything requires signedIn(); recoveryVault requires isAdmin()).
    // ===================================================================
    await testEnv.clearFirestore();
    {
      const anon = testEnv.unauthenticatedContext().firestore();
      for (const c of ['customers', 'invoices', 'parts', 'suppliers', 'purchaseOrders', 'sales', 'restocks',
        'stockAdjustments', 'auditLog', 'appSettings', 'counters', 'editLocks', 'pendingSales', 'recoveryMeta', 'recoveryVault', 'salesRollups', 'reorderRequests']) {
        ok(`20C anon: read ${c} → DENIED`, await deny(getDoc(doc(anon, `${c}/anything`))));
      }
    }
  } finally {
    await testEnv.cleanup();
  }
  console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
  process.exit(FAIL ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
