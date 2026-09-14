/**
 * tests/remove-staff-email-persists.test.cjs
 *
 * BUG-REMOVE-STAFF-NOOP — found live in production while re-verifying the
 * staff-perms draft/Save/Cancel flow: clicking "Remove" on a staff member showed a
 * genuine success toast ("X removed. They can still log in but with no special
 * access."), but the staffer was still present — with every permission they'd been
 * granted still intact — after a page reload.
 *
 * Root cause: `staff` on appSettings/roles is a MAP field (keyed by email).
 * removeStaffEmail built `next = {...staffPerms}; delete next[email];` and wrote it
 * back via `setDoc(doc(..., 'roles'), { staff: next }, { merge: true })`. Firestore's
 * `merge: true` recursively MERGES map fields into the existing stored map — it adds
 * or overwrites the keys present in the written object, but a key simply ABSENT from
 * that object (because it was deleted client-side) is never removed from the stored
 * document. The write succeeds, the toast is honest about the write succeeding, but
 * the actual document is unchanged for that key: the "removed" staffer keeps every
 * permission indefinitely. This is exactly the class of bug the current task cares
 * about — a permission-revoking control that silently doesn't take effect.
 *
 * addStaffEmail doesn't have this bug (merge correctly ADDS a new key). admins
 * (removeAdminEmail) doesn't have it either: `admins` is an ARRAY field, and merge
 * replaces array fields wholesale rather than deep-merging their elements, so
 * `setDoc({ admins: filtered }, { merge: true })` there really does drop the entry.
 *
 * Fix: removeStaffEmail now uses `updateDoc` with a computed field path,
 * `{ [\`staff.${email}\`]: deleteField() }` — the actual Firestore-documented way to
 * remove one key from a stored map without touching the rest of the document.
 */
const fs = require('fs');
const path = require('path');
let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const dash = fs.readFileSync(path.resolve(__dirname, '..', 'components/InventoryDashboard.js'), 'utf8');

console.log('\nremoveStaffEmail actually persists a removal (BUG-REMOVE-STAFF-NOOP)\n');

ok('deleteField is imported from firebase/firestore',
  /import\s*\{[\s\S]{0,400}deleteField,?[\s\S]{0,50}\}\s*from\s*'firebase\/firestore'/.test(dash));

ok('removeStaffEmail keeps its exact original demo/isAdmin guard (unchanged authorization — see demo-isolation.test.cjs)',
  /async function removeStaffEmail\(rawEmail\) \{\s*if \(demoMode \|\| !isAdmin\) \{ notify\.permissionDenied\('Not available in demo\.'\); return; \}/.test(dash));

ok('removeStaffEmail uses updateDoc + deleteField() on the specific staff.<email> path, not a setDoc/merge object that silently no-ops on map fields',
  /async function removeStaffEmail\(rawEmail\) \{[\s\S]{0,1600}await updateDoc\(doc\(db, 'appSettings', 'roles'\), \{ \[`staff\.\$\{email\}`\]: deleteField\(\), updatedAt: serverTimestamp\(\), updatedBy: user\?\.email \|\| '' \}\);/.test(dash));

ok('removeStaffEmail no longer builds a "next" map and setDoc/merges it (the exact shape that caused the no-op)',
  !/async function removeStaffEmail\(rawEmail\) \{[\s\S]{0,1600}const next = \{ \.\.\.staffPerms \}; delete next\[email\];/.test(dash));

ok('removeStaffEmail still shows the same success/error toasts as before (behavior-preserving, not just internals)',
  /async function removeStaffEmail\(rawEmail\) \{[\s\S]{0,1800}toast\.success\(`\$\{email\} removed\. They can still log in but with no special access\.`, \{ id: t \}\);[\s\S]{0,200}catch \(e\) \{ console\.error\('removeStaffEmail failed:', e\); toast\.error\('Could not remove staff\. Check Firestore rules\.', \{ id: t \}\); \}/.test(dash));

// ---- Contrast: removeAdminEmail is UNCHANGED and correctly unaffected — `admins` is
//    an array, so setDoc/merge with a filtered array really does replace it. This
//    isn't a case that also needs the deleteField() fix. ----------------------------
ok('removeAdminEmail (array field) is untouched — setDoc/merge with a filtered array still correctly replaces the whole array',
  /async function removeAdminEmail\(rawEmail\) \{[\s\S]{0,500}const next = dbAdmins\.filter\(\(e\) => e !== email\);[\s\S]{0,200}await setDoc\(doc\(db, 'appSettings', 'roles'\), \{ admins: next, updatedAt: serverTimestamp\(\), updatedBy: user\?\.email \|\| '' \}, \{ merge: true \}\);/.test(dash));

// ---- Firestore rules are unaffected: `allow create, update: if isAdmin();` on
//    appSettings/{docId} is coarse (no field-path restrictions), so switching from
//    setDoc/merge to updateDoc with a dot-path field changes nothing about who is
//    authorized to make this write. -------------------------------------------------
const rules = fs.readFileSync(path.resolve(__dirname, '..', 'firestore.rules'), 'utf8');
ok('appSettings write authorization is still the same coarse isAdmin() check (unaffected by this fix)',
  /match \/appSettings\/\{docId\} \{\s*allow read: if signedIn\(\);\s*allow create, update: if isAdmin\(\);/.test(rules));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
