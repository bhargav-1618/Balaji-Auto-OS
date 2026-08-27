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
const { doc, getDoc, setDoc, updateDoc, deleteDoc } = require('firebase/firestore');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { makeTestEnv, seedAdmins, seedDoc, OWNER_EMAIL, ADMIN_EMAIL, STAFF_EMAIL } = require('./helpers.cjs');

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
