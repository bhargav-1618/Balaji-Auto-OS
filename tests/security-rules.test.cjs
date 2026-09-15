/**
 * tests/security-rules.test.cjs — PART-6.1
 *
 * The Firestore rules ARE the security boundary (the React isAdmin/canManage checks are
 * UI convenience). These are STATIC guarantees over firestore.rules — they can't run the
 * Firestore emulator here, but they lock the properties that matter so a future edit
 * can't silently reopen a hole. The rules must still be tested in the Rules Playground
 * before publishing (the file header says so).
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const rules = fs.readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf8');
const auth = fs.readFileSync(path.resolve(__dirname, '../context/AuthContext.js'), 'utf8');

console.log('\nPART-6.1 — Firestore security-rule guarantees\n');

// 1. privilege escalation closed: appSettings writable only by admins
ok('appSettings WRITE is admin-only (staff cannot self-promote)',
  /match \/appSettings\/\{docId\}[\s\S]*?allow create, update: if isAdmin\(\)/.test(rules));

// 2. every destructive delete on BUSINESS DATA is admin-gated. The one exception
// is editLocks (Phase 1b, session-check hardened Phase 7b/PH7-27) — a transient
// coordination lock, deletable only once it has EXPIRED (never an active one,
// not even by its own owner — an active lease is given up via a release-shaped
// UPDATE instead, since delete carries no payload for the rules to check a
// releasing session's identity against); it holds no business data.
const deleteLines = rules.split('\n').filter((l) => /allow delete:/.test(l));
const businessDeletes = deleteLines.filter((l) => !/^\s*allow delete: if signedIn\(\) && expired\(\);\s*$/.test(l));
ok('every delete rule on business data is admin-only or explicitly false',
  businessDeletes.length > 0 && businessDeletes.every((l) => /isAdmin\(\)/.test(l) || /if false/.test(l)),
  businessDeletes.filter((l) => !/isAdmin\(\)|if false/.test(l)).join(' | '));
ok('editLocks delete is restricted to an already-EXPIRED lease only (never an active one, not even by its own owner — PH7-27 closes the gap raw delete cannot be made session-aware for)',
  /match \/editLocks\/\{lockId\}[\s\S]*?allow delete: if signedIn\(\) && expired\(\);/.test(rules));

// 3. ledgers are immutable (append-only) — audit log can't be tampered
for (const led of ['sales', 'restocks', 'stockAdjustments', 'auditLog']) {
  const block = new RegExp(`match /${led}/\\{[^}]*\\}[\\s\\S]*?allow update: if false`);
  ok(`${led} is append-only (update: false) — cannot be edited`, block.test(rules));
}

// 4. owner can never be locked out (hardcoded owner fallback)
ok('owner email is a hardcoded admin fallback', /function ownerEmail\(\)[\s\S]*?konabhargav2003@gmail\.com/.test(rules));
ok('the rules owner matches BOOTSTRAP_ADMINS in code',
  /konabhargav2003@gmail\.com/.test(rules) && /konabhargav2003@gmail\.com/.test(auth));

// 5. default deny
ok('default rule denies everything not explicitly allowed',
  /match \/\{document=\*\*\}[\s\S]*?allow read, write: if false/.test(rules));

// 6. reads require auth (no public data)
ok('no collection allows unauthenticated read', !/allow read: if true/.test(rules));

// 7. deployability (this pass): firebase.json wires the rules for CLI deploy
const fb = fs.existsSync(path.resolve(__dirname, '../firebase.json'));
ok('firebase.json exists so rules deploy via CLI (not manual paste)', fb);
if (fb) {
  const j = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../firebase.json'), 'utf8'));
  ok('firebase.json points at firestore.rules', j.firestore && j.firestore.rules === 'firestore.rules');
}

// 8. client perms default-deny for staff
ok('staff permissions default to false (deny-by-default)',
  /setPerms\(\{ costPrices: !!p\.costPrices, deletes: !!p\.deletes, exports: !!p\.exports \}\)/.test(auth));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
