/**
 * tests/rules/staff-allowlist.rules.test.cjs — security audit, Stage 2
 *
 * SEC-02  Who counts as STAFF.  Before: any signed-in Firebase user could read AND write all shop
 *         data, so if Firebase sign-up was open a stranger who registered an account owned the
 *         shop. Now `appSettings/roles.allowedEmails` can restrict staff to a known list.
 * SEC-03  Email verification. `appSettings/roles.requireVerifiedEmail` makes every role depend
 *         on a VERIFIED email, so an unverified self-registered account cannot ride on an
 *         admin's (or the owner's) email string.
 *
 * Both are OPT-IN: with neither field set the rules behave exactly as they always did (the other
 * rules test files, unchanged, prove that). Runs the REAL firestore.rules on the emulator.
 */
const {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, serverTimestamp,
} = require('firebase/firestore');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { makeTestEnv, seedDoc, OWNER_EMAIL, ADMIN_EMAIL, STAFF_EMAIL } = require('./helpers.cjs');

let PASS = 0, FAIL = 0;
const ok = (n, c) => { if (c) { PASS++; console.log(`  ok ${n}`); } else { FAIL++; console.log(`  FAIL ${n}`); } };
const allow = async (p) => { try { await assertSucceeds(p); return true; } catch { return false; } };
const deny = async (p) => { try { await assertFails(p); return true; } catch { return false; } };

const STRANGER = 'stranger@evil.test';
const ctx = (testEnv, uid, email, verified = true) => testEnv.authenticatedContext(uid, { email, email_verified: verified }).firestore();
const roles = (extra = {}) => ({ admins: [ADMIN_EMAIL], ...extra });
const newInvoice = () => ({ invNo: 'INV-9', lines: [], payments: [], grandTotal: 1 });

// the operations a stranger would try, as a table so every sensitive collection is covered
const probes = (db) => ([
  ['read invoices',           () => getDoc(doc(db, 'invoices/i1'))],
  ['list customers',          () => getDocs(collection(db, 'customers'))],
  ['create invoice',          () => setDoc(doc(db, 'invoices/new1'), newInvoice())],
  ['update customer',         () => updateDoc(doc(db, 'customers/c1'), { name: 'pwned' })],
  ['create job card',         () => setDoc(doc(db, 'jobCards/j9'), { parts: [], labour: [] })],
  ['read parts',              () => getDoc(doc(db, 'parts/p1'))],
  ['create sale (ledger)',    () => setDoc(doc(db, 'sales/s9'), { amount: 1 })],
  ['read auditLog',           () => getDoc(doc(db, 'auditLog/a1'))],
  ['read appSettings/roles',  () => getDoc(doc(db, 'appSettings/roles'))],
  ['advance counter',         () => updateDoc(doc(db, 'counters/invoices'), { next: 99 })],
]);

async function seedShop(testEnv, rolesDoc) {
  await testEnv.clearFirestore();
  await seedDoc(testEnv, 'appSettings/roles', rolesDoc);
  await seedDoc(testEnv, 'invoices/i1', { invNo: 'INV-1', lines: [], payments: [], grandTotal: 5 });
  await seedDoc(testEnv, 'customers/c1', { name: 'Real Customer', vehicles: [] });
  await seedDoc(testEnv, 'parts/p1', { name: 'Brake pad', stock: 3 });
  await seedDoc(testEnv, 'auditLog/a1', { action: 'x', performedBy: 'u' });
  await seedDoc(testEnv, 'counters/invoices', { next: 5 });
}

async function main() {
  const testEnv = await makeTestEnv();
  try {
    // ============================================================ DEFAULT (opt-in OFF)
    await seedShop(testEnv, roles());                       // no allowedEmails, no requireVerifiedEmail
    {
      const db = ctx(testEnv, 'u-any', STRANGER, false);    // unverified, not listed anywhere
      ok('DEFAULT: with no switches set, any signed-in user is staff, exactly as before (read invoices)', await allow(getDoc(doc(db, 'invoices/i1'))));
      ok('DEFAULT: ...and can create an invoice (unchanged behaviour — nothing breaks on publish)', await allow(setDoc(doc(db, 'invoices/new1'), newInvoice())));
      ok('DEFAULT: an UNAUTHENTICATED request is still denied', await deny(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'invoices/i1'))));
    }
    await seedShop(testEnv, { admins: [ADMIN_EMAIL], allowedEmails: [] });
    ok('DEFAULT: an EMPTY allowedEmails list means "off" (cannot accidentally lock everyone out)', await allow(getDoc(doc(ctx(testEnv, 'u-any', STRANGER), 'invoices/i1'))));
    await seedShop(testEnv, { admins: [ADMIN_EMAIL], allowedEmails: 'not-a-list' });
    ok('DEFAULT: a malformed allowedEmails (not a list) is ignored rather than locking everyone out', await allow(getDoc(doc(ctx(testEnv, 'u-any', STRANGER), 'invoices/i1'))));

    // ============================================================ SEC-02  allowlist ON
    await seedShop(testEnv, roles({ allowedEmails: [STAFF_EMAIL], staff: { 'perm-staff@shop.test': { costPrices: true } } }));
    {
      const stranger = ctx(testEnv, 'u-s', STRANGER);
      for (const [name, run] of probes(stranger)) ok(`SEC-02 stranger (signed in, NOT listed): ${name} DENIED`, await deny(run()));
      ok('SEC-02 stranger cannot add themselves to allowedEmails (appSettings is admin-only)', await deny(setDoc(doc(stranger, 'appSettings/roles'), roles({ allowedEmails: [STRANGER] }))));
      ok('SEC-02 stranger cannot create their own staff entry either', await deny(updateDoc(doc(stranger, 'appSettings/roles'), { 'staff.stranger@evil.test': {} })));

      const staff = ctx(testEnv, 'u-st', STAFF_EMAIL);
      ok('SEC-02 listed staff: read invoices ALLOWED', await allow(getDoc(doc(staff, 'invoices/i1'))));
      ok('SEC-02 listed staff: update customer ALLOWED', await allow(updateDoc(doc(staff, 'customers/c1'), { name: 'Updated' })));
      ok('SEC-02 listed staff: create invoice ALLOWED', await allow(setDoc(doc(staff, 'invoices/new2'), newInvoice())));
      ok('SEC-02 listed staff matched case-insensitively (token email "Staff@Shop.Test")', await allow(getDoc(doc(ctx(testEnv, 'u-st2', 'Staff@Shop.Test'), 'invoices/i1'))));
      ok('SEC-02 listed staff still CANNOT do admin-only things (delete a part)', await deny(deleteDoc(doc(staff, 'parts/p1'))));
      ok('SEC-02 listed staff still CANNOT write appSettings', await deny(updateDoc(doc(staff, 'appSettings/roles'), { allowedEmails: [STAFF_EMAIL, STRANGER] })));

      ok('SEC-02 a user with an existing "staff" permissions entry is staff without being re-listed', await allow(getDoc(doc(ctx(testEnv, 'u-ps', 'perm-staff@shop.test'), 'invoices/i1'))));
      ok('SEC-02 an admin who is not in allowedEmails keeps full access', await allow(getDoc(doc(ctx(testEnv, 'u-ad', ADMIN_EMAIL), 'invoices/i1'))));
      ok('SEC-02 admin can still delete (admin ops unaffected)', await allow(deleteDoc(doc(ctx(testEnv, 'u-ad', ADMIN_EMAIL), 'parts/p1'))));
      ok('SEC-02 the OWNER can never be locked out by a mistaken allowlist', await allow(getDoc(doc(ctx(testEnv, 'u-ow', OWNER_EMAIL), 'invoices/i1'))));
      ok('SEC-02 the owner can edit appSettings to fix a bad allowlist', await allow(setDoc(doc(ctx(testEnv, 'u-ow', OWNER_EMAIL), 'appSettings/roles'), roles({ allowedEmails: [STAFF_EMAIL, 'new@shop.test'] }))));
    }
    // a token with NO email (e.g. phone / anonymous sign-in) can never match the list
    await seedShop(testEnv, roles({ allowedEmails: [STAFF_EMAIL] }));
    ok('SEC-02 a signed-in user with NO email (phone/anonymous) is denied once the allowlist is on', await deny(getDoc(doc(testEnv.authenticatedContext('u-ph', { phone_number: '+910000000000' }).firestore(), 'invoices/i1'))));

    // ============================================================ SEC-03  verified email
    await seedShop(testEnv, roles({ requireVerifiedEmail: true }));
    {
      const unverifiedAdmin = ctx(testEnv, 'u-ua', ADMIN_EMAIL, false);
      const verifiedAdmin = ctx(testEnv, 'u-va', ADMIN_EMAIL, true);
      ok('SEC-03 UNVERIFIED account claiming the admin email: admin delete DENIED', await deny(deleteDoc(doc(unverifiedAdmin, 'parts/p1'))));
      ok('SEC-03 UNVERIFIED account claiming the admin email: cannot rewrite appSettings/roles', await deny(setDoc(doc(unverifiedAdmin, 'appSettings/roles'), roles({ admins: [ADMIN_EMAIL, 'me@evil.test'] }))));
      ok('SEC-03 UNVERIFIED account: ordinary staff reads are denied too (the whole role is not honoured)', await deny(getDoc(doc(unverifiedAdmin, 'invoices/i1'))));
      ok('SEC-03 VERIFIED admin: delete ALLOWED', await allow(deleteDoc(doc(verifiedAdmin, 'parts/p1'))));
      ok('SEC-03 VERIFIED staff: read ALLOWED', await allow(getDoc(doc(ctx(testEnv, 'u-vs', STAFF_EMAIL, true), 'invoices/i1'))));
      ok('SEC-03 UNVERIFIED staff: read DENIED', await deny(getDoc(doc(ctx(testEnv, 'u-us', STAFF_EMAIL, false), 'invoices/i1'))));
      const ownerUnverified = ctx(testEnv, 'u-ou', OWNER_EMAIL, false);
      ok('SEC-03 owner email with an UNVERIFIED token is denied (a stranger who registers the owner address gets nothing)', await deny(getDoc(doc(ownerUnverified, 'invoices/i1'))));
      ok('SEC-03 owner email VERIFIED: full access', await allow(getDoc(doc(ctx(testEnv, 'u-ov', OWNER_EMAIL, true), 'invoices/i1'))));
      ok('SEC-03 a token with no email_verified claim at all is treated as unverified', await deny(getDoc(doc(testEnv.authenticatedContext('u-nc', { email: STAFF_EMAIL }).firestore(), 'invoices/i1'))));
    }
    // the switch is off by default, so an unverified owner is NOT locked out unless the owner turns it on
    await seedShop(testEnv, roles());
    ok('SEC-03 with the switch OFF an unverified owner token still works (no accidental lock-out on publish)', await allow(getDoc(doc(ctx(testEnv, 'u-ou', OWNER_EMAIL, false), 'invoices/i1'))));

    // ============================================================ both together
    await seedShop(testEnv, roles({ allowedEmails: [STAFF_EMAIL], requireVerifiedEmail: true }));
    ok('BOTH: listed + verified staff ALLOWED', await allow(getDoc(doc(ctx(testEnv, 'u1', STAFF_EMAIL, true), 'invoices/i1'))));
    ok('BOTH: listed but UNVERIFIED staff DENIED', await deny(getDoc(doc(ctx(testEnv, 'u2', STAFF_EMAIL, false), 'invoices/i1'))));
    ok('BOTH: verified but NOT listed DENIED', await deny(getDoc(doc(ctx(testEnv, 'u3', STRANGER, true), 'invoices/i1'))));
  } finally {
    await testEnv.cleanup();
  }
  console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
