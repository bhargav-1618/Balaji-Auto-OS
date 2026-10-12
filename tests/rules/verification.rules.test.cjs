/**
 * tests/rules/verification.rules.test.cjs — security audit, SEC-04
 *
 * The public /verify page reads `verifications/<id>`. These rules must make that safe:
 *   - anyone WITH the id can read that one record (it is a capability URL: 128 random bits);
 *   - nobody who is not staff can LIST or scrape the collection;
 *   - only staff can write, only the exact minimal shape — no customer name / vehicle / phone /
 *     line items / costs can be stored — and only under a well-formed random id;
 *   - the stranger, the unverified self-registered account and the anonymous visitor cannot forge one.
 * Runs the REAL firestore.rules on the emulator.
 */
const { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, serverTimestamp, Timestamp } = require('firebase/firestore');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { makeTestEnv, seedDoc, ADMIN_EMAIL, STAFF_EMAIL } = require('./helpers.cjs');

let PASS = 0, FAIL = 0;
const ok = (n, c) => { if (c) { PASS++; console.log(`  ok ${n}`); } else { FAIL++; console.log(`  FAIL ${n}`); } };
const allow = async (p) => { try { await assertSucceeds(p); return true; } catch { return false; } };
const deny = async (p) => { try { await assertFails(p); return true; } catch { return false; } };

const ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';       // 32 lowercase hex = a well-formed id
const ID2 = '0f0e0d0c0b0a09080706050403020100';
const rec = (extra = {}) => ({ kind: 'invoice', ref: 'inv_1700000000000_1234', docNo: 'INV-0042', date: '2026-10-11', total: 5900, status: 'Paid', updatedAt: serverTimestamp(), ...extra });

async function main() {
  const testEnv = await makeTestEnv();
  try {
    await testEnv.clearFirestore();
    await seedDoc(testEnv, 'appSettings/roles', { admins: [ADMIN_EMAIL] });
    await seedDoc(testEnv, `verifications/${ID}`, { kind: 'invoice', ref: 'inv_x', docNo: 'INV-0001', date: '2026-10-01', total: 1180, status: 'Paid', updatedAt: Timestamp.now() });
    await seedDoc(testEnv, `verifications/${ID2}`, { kind: 'jobcard', ref: 'jc_x', docNo: 'JC-0007', status: 'Ready', updatedAt: Timestamp.now() });
    await seedDoc(testEnv, 'invoices/i1', { invNo: 'INV-0001', lines: [], payments: [], grandTotal: 1180 });

    const anon = testEnv.unauthenticatedContext().firestore();
    const stranger = testEnv.authenticatedContext('u-x', { email: 'stranger@evil.test', email_verified: false }).firestore();
    const staff = testEnv.authenticatedContext('u-st', { email: STAFF_EMAIL, email_verified: true }).firestore();
    const admin = testEnv.authenticatedContext('u-ad', { email: ADMIN_EMAIL, email_verified: true }).firestore();

    // ---------------------------------------------------------------- READ
    ok('anonymous visitor WITH the id can read that one record (this is what /verify does)', await allow(getDoc(doc(anon, `verifications/${ID}`))));
    ok('a signed-in stranger with the id can read it too', await allow(getDoc(doc(stranger, `verifications/${ID}`))));
    ok('a malformed id (not 32 lowercase hex) is refused even for a read', await deny(getDoc(doc(anon, 'verifications/INV-0001'))));
    ok('a too-short id is refused', await deny(getDoc(doc(anon, 'verifications/abc123'))));
    ok('an UPPERCASE / non-hex id is refused', await deny(getDoc(doc(anon, 'verifications/A1B2C3D4E5F60718293A4B5C6D7E8F90'))));
    ok('a path-ish id cannot be used to reach another collection', await deny(getDoc(doc(anon, 'invoices/i1'))));
    ok('anonymous visitor CANNOT list the collection (no enumeration / scraping)', await deny(getDocs(collection(anon, 'verifications'))));
    ok('anonymous visitor CANNOT query by docNo to find a record', await deny(getDocs(query(collection(anon, 'verifications'), where('docNo', '==', 'INV-0001')))));
    // NOTE: with the staff allowlist OFF (the default) any signed-in user counts as staff (audit SEC-02), so a
    // signed-in stranger can list — that is the allowlist's job to close, and it is asserted ON at the bottom.
    ok('staff CAN list (needed to find an existing record by its ref when re-issuing)', await allow(getDocs(query(collection(staff, 'verifications'), where('ref', '==', 'inv_x')))));

    // ---------------------------------------------------------------- WRITE: who
    ok('anonymous visitor cannot create a record', await deny(setDoc(doc(anon, `verifications/${'1'.repeat(32)}`), rec())));
    ok('anonymous visitor cannot overwrite an existing record (forge a "Paid" page)', await deny(setDoc(doc(anon, `verifications/${ID}`), rec({ total: 1 }))));
    ok('anonymous visitor cannot update an existing record', await deny(updateDoc(doc(anon, `verifications/${ID}`), { status: 'Paid' })));
    ok('anonymous visitor cannot delete a record', await deny(deleteDoc(doc(anon, `verifications/${ID}`))));
    ok('staff can create a well-formed record under a well-formed id', await allow(setDoc(doc(staff, `verifications/${'2'.repeat(32)}`), rec())));
    ok('staff can refresh (update) an existing record', await allow(setDoc(doc(staff, `verifications/${ID}`), rec({ docNo: 'INV-0001', status: 'Cancelled' }))));
    ok('a job-card record (no amount) is accepted', await allow(setDoc(doc(staff, `verifications/${'3'.repeat(32)}`), { kind: 'jobcard', ref: 'jc_9', docNo: 'JC-0009', status: 'In Progress', updatedAt: serverTimestamp() })));
    ok('staff cannot delete (admin-only)', await deny(deleteDoc(doc(staff, `verifications/${ID}`))));
    ok('admin can delete', await allow(deleteDoc(doc(admin, `verifications/${ID2}`))));

    // ---------------------------------------------------------------- WRITE: shape (staff, but wrong content)
    const w = (extra, id = '4'.repeat(32)) => setDoc(doc(staff, `verifications/${id}`), rec(extra));
    ok('SHAPE: the customer NAME cannot be stored (no PII in a public record)', await deny(w({ customer: 'Ramesh Kumar' })));
    ok('SHAPE: a vehicle registration cannot be stored', await deny(w({ vehicle: 'AP31AB1234' })));
    ok('SHAPE: a phone number cannot be stored', await deny(w({ phone: '9876543210' })));
    ok('SHAPE: line items / cost / profit cannot be stored', await deny(w({ lines: [{ cost: 10 }] })) && await deny(w({ profit: 5 })));
    ok('SHAPE: an unknown kind is refused', await deny(w({ kind: 'estimate-secret' })));
    ok('SHAPE: docNo is required', await deny(setDoc(doc(staff, `verifications/${'5'.repeat(32)}`), { kind: 'invoice', ref: 'r', updatedAt: serverTimestamp() })));
    ok('SHAPE: an oversize docNo (>40) is refused', await deny(w({ docNo: 'X'.repeat(41) })));
    ok('SHAPE: an oversize status (>40) is refused', await deny(w({ status: 'Y'.repeat(41) })));
    ok('SHAPE: total must be a number', await deny(w({ total: '5900' })));
    ok('SHAPE: a negative total is refused', await deny(w({ total: -1 })));
    ok('SHAPE: updatedAt must be the SERVER time, not a client-chosen date', await deny(w({ updatedAt: Timestamp.fromDate(new Date('2020-01-01')) })));
    ok('SHAPE: a non-hex id cannot be created even by staff', await deny(setDoc(doc(staff, 'verifications/INV-0042'), rec())));
    ok('SHAPE: an uppercase-hex id cannot be created by staff', await deny(setDoc(doc(staff, `verifications/${'ABCDEF'.repeat(5)}AB`), rec())));

    // ---------------------------------------------------------------- the rest of the shop stays locked
    ok('the public read of verifications does NOT open invoices to anonymous users', await deny(getDoc(doc(anon, 'invoices/i1'))));
    ok('...nor customers', await deny(getDocs(collection(anon, 'customers'))));

    // ---------------------------------------------------------------- allowlist mode (SEC-02) still gates writes, never the public read
    await seedDoc(testEnv, 'appSettings/roles', { admins: [ADMIN_EMAIL], allowedEmails: [STAFF_EMAIL] });
    ok('allowlist ON: an UNLISTED signed-in user can no longer create records', await deny(setDoc(doc(stranger, `verifications/${'6'.repeat(32)}`), rec())));
    ok('allowlist ON: an unlisted user cannot list', await deny(getDocs(collection(stranger, 'verifications'))));
    ok('allowlist ON: listed staff can still create', await allow(setDoc(doc(staff, `verifications/${'7'.repeat(32)}`), rec())));
    ok('allowlist ON: the PUBLIC read by id still works for an anonymous customer (the QR must keep working)', await allow(getDoc(doc(anon, `verifications/${ID}`))));
  } finally {
    await testEnv.cleanup();
  }
  console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
