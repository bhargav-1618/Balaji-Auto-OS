/**
 * tests/remove-staff-email-persists.test.cjs
 *
 * BUG-REMOVE-STAFF-NOOP — found live in production while re-verifying the
 * staff-perms draft/Save/Cancel flow: clicking "Remove" on a staff member showed a
 * genuine success toast ("X removed. They can still log in but with no special
 * access."), but the staffer was still present — with every permission they'd been
 * granted still intact — after a page reload.
 *
 * Root cause #1 (original bug): `staff` on appSettings/roles is a MAP field (keyed by
 * email). removeStaffEmail built `next = {...staffPerms}; delete next[email];` and
 * wrote it back via `setDoc(doc(..., 'roles'), { staff: next }, { merge: true })`.
 * Firestore's `merge: true` recursively MERGES map fields into the existing stored
 * map — it adds or overwrites the keys present in the written object, but a key
 * simply ABSENT from that object (because it was deleted client-side) is never
 * removed from the stored document. The write succeeds, the toast is honest about
 * the write succeeding, but the actual document is unchanged for that key.
 *
 * Root cause #2 (found live, AFTER shipping a first fix): the first fix switched to
 * `updateDoc(ref, { [\`staff.${email}\`]: deleteField() })` — a dot-path string. But
 * Firestore's dot-notation field paths split on EVERY "." in the string, and an email
 * address contains one (e.g. "gmail.com"). So the path didn't address the single map
 * key `staff["name@gmail.com"]` at all — it addressed a bogus 3-level-deep field
 * (staff -> "name@gmail" -> "com"), leaving the REAL key completely untouched. This
 * shipped, was verified against a mock in tests (which never round-trips through a
 * real Firestore path parser), and only surfaced by re-querying the live Firestore
 * REST API directly (bypassing the app's own listener/cache) after clicking Remove
 * and seeing the staffer still in the raw document.
 *
 * addStaffEmail doesn't have root cause #1 (merge correctly ADDS a new key). admins
 * (removeAdminEmail) doesn't have it either: `admins` is an ARRAY field, and merge
 * replaces array fields wholesale rather than deep-merging their elements, so
 * `setDoc({ admins: filtered }, { merge: true })` there really does drop the entry —
 * no analogue of root cause #2 applies to an array field either.
 *
 * Actual fix: removeStaffEmail builds the same `next` map (target key already
 * deleted) as before, but writes it via `updateDoc(ref, { staff: next, ... })`
 * instead of `setDoc(ref, { staff: next, ... }, { merge: true })`. Unlike setDoc's
 * merge:true, updateDoc replaces the VALUE of each top-level field it's given
 * wholesale rather than deep-merging it — so the plain (non-dotted) `staff` field
 * key needs no path-escaping and has no ambiguity about what the email string means,
 * while still correctly dropping the deleted key.
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

ok('removeStaffEmail keeps its exact original demo/isAdmin guard (unchanged authorization — see demo-isolation.test.cjs)',
  /async function removeStaffEmail\(rawEmail\) \{\s*if \(demoMode \|\| !isAdmin\) \{ notify\.permissionDenied\('Not available in demo\.'\); return; \}/.test(dash));

ok('removeStaffEmail builds the filtered "next" map and writes it via updateDoc (wholesale field replacement, not a merge)',
  /async function removeStaffEmail\(rawEmail\) \{[\s\S]{0,2000}const next = \{ \.\.\.staffPerms \}; delete next\[email\];[\s\S]{0,200}await updateDoc\(doc\(db, 'appSettings', 'roles'\), \{ staff: next, updatedAt: serverTimestamp\(\), updatedBy: user\?\.email \|\| '' \}\);/.test(dash));

ok('removeStaffEmail no longer uses setDoc/merge for the staff field (root cause #1 — merge deep-merges map fields, never deletes an absent key)',
  !/async function removeStaffEmail\(rawEmail\)[\s\S]{0,2000}await setDoc\(doc\(db, 'appSettings', 'roles'\), \{ staff: next/.test(dash));

ok('removeStaffEmail no longer builds a dot-path template-literal field key for staff (root cause #2 — an email contains "." and would split into the wrong nested path)',
  !/\[`staff\.\$\{email\}`\]/.test(dash));

ok('removeStaffEmail still shows the same success/error toasts as before (behavior-preserving, not just internals)',
  /async function removeStaffEmail\(rawEmail\) \{[\s\S]{0,2200}toast\.success\(`\$\{email\} removed\. They can still log in but with no special access\.`, \{ id: t \}\);[\s\S]{0,200}catch \(e\) \{ console\.error\('removeStaffEmail failed:', e\); toast\.error\('Could not remove staff\. Check Firestore rules\.', \{ id: t \}\); \}/.test(dash));

// ---- Contrast: removeAdminEmail is UNCHANGED and correctly unaffected — `admins` is
//    an array, so setDoc/merge with a filtered array really does replace it. Neither
//    root cause applies to an array field. --------------------------------------------
ok('removeAdminEmail (array field) is untouched — setDoc/merge with a filtered array still correctly replaces the whole array',
  /async function removeAdminEmail\(rawEmail\) \{[\s\S]{0,500}const next = dbAdmins\.filter\(\(e\) => e !== email\);[\s\S]{0,200}await setDoc\(doc\(db, 'appSettings', 'roles'\), \{ admins: next, updatedAt: serverTimestamp\(\), updatedBy: user\?\.email \|\| '' \}, \{ merge: true \}\);/.test(dash));

// ---- Firestore rules are unaffected: `allow create, update: if isAdmin();` on
//    appSettings/{docId} is coarse (no field-path restrictions), so switching from
//    setDoc/merge to a plain updateDoc changes nothing about who is authorized to
//    make this write. -------------------------------------------------------------
const rules = fs.readFileSync(path.resolve(__dirname, '..', 'firestore.rules'), 'utf8');
ok('appSettings write authorization is still the same coarse isAdmin() check (unaffected by this fix)',
  /match \/appSettings\/\{docId\} \{\s*allow read: if signedIn\(\);\s*allow create, update: if isAdmin\(\);/.test(rules));

// ---- Regression guard for root cause #2 specifically: any future dot-path field-key
//    built from a raw, unescaped identifier that could itself contain "." (an email,
//    a domain, a filename) is the same hazard, not just this one call site. Simple
//    static check: the codebase should not contain string-based dot-path field keys
//    interpolating `email` anywhere in the staff/admin management functions. ---------
ok('no other role-management write builds a dot-path field key by interpolating an email (the same hazard as root cause #2)',
  !/\[`\w+\.\$\{email\}`\]/.test(dash));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
