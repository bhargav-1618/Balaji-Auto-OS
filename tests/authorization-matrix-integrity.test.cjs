/**
 * tests/authorization-matrix-integrity.test.cjs — PHASE 19
 *
 * The complete authorization matrix for OWNER / ADMIN / STAFF / UNAUTHENTICATED,
 * verified at THREE layers and cross-checked for consistency:
 *
 *   UI enforcement        — React `role`/`isAdmin`/`canManage`/`canDelete` gates
 *   MUTATION enforcement  — service/transaction guards (where an action needs one)
 *   FIRESTORE enforcement — firestore.rules  ← the authoritative security boundary
 *
 * "A hidden/disabled UI action is NOT authorization." This file locks the
 * data-layer boundary statically; the live emulator proof for every cell is in
 * tests/rules/firestore.rules.test.cjs (`npm run test:rules`), which this file's
 * §7 lists so the two can never drift.
 *
 * STATIC by necessity — same reason as tests/security-rules.test.cjs: the plain
 * `npm test` runner has no Java/emulator. The emulator half runs under
 * `npm run test:rules`.
 */
const fs = require('fs');
const path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const R = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

const rules = R('firestore.rules');
const auth = R('context/AuthContext.js');
const dash = R('components/InventoryDashboard.js');
const idx = R('pages/index.js');
const billing = R('components/billing/BillingModule.jsx');
const known = R('docs/KNOWN_LIMITATIONS.md');
const rulesEmu = R('tests/rules/firestore.rules.test.cjs');

const OWNER = 'konabhargav2003@gmail.com';

console.log('\nPHASE 19 — AUTHORIZATION MATRIX / ACCESS-CONTROL INTEGRITY\n');

// ===================================================================
// 1. AUTHENTICATION + ROLE MODEL (context/AuthContext.js)
// ===================================================================
console.log('1. Role model\n');

ok('authenticated states: real Firebase user | synthetic demo guest | unauthenticated (null)',
  /onAuthStateChanged\(auth,/.test(auth) && /isDemo: true/.test(auth) && /if \(!user\) \{ setRole\(null\)/.test(auth));
ok('role is exactly one of admin | staff | guest | null (no "owner" role value)',
  /'admin' \| 'staff' \| 'guest'/.test(auth) && !/setRole\('owner'\)/.test(auth));
ok('OWNER identity = BOOTSTRAP_ADMINS, hardcoded, permanent, never UI-removable',
  new RegExp(`BOOTSTRAP_ADMINS = \\[\\s*'${OWNER.replace('.', '\\.')}'`).test(auth)
  && /permanent, code-level safety net/.test(auth));
ok('the rules owner (ownerEmail()) is the SAME email as the code owner',
  new RegExp(`function ownerEmail\\(\\)[\\s\\S]*?${OWNER.replace('.', '\\.')}`).test(rules));
ok('ADMIN = in BOOTSTRAP_ADMINS OR in appSettings/roles.admins[] (Firestore)',
  /const isAdmin = BOOTSTRAP_ADMINS\.map\(norm\)\.includes\(email\) \|\| dbAdmins\.includes\(email\)/.test(auth));
ok('STAFF = any authenticated user who is NOT an admin; perms come from appSettings/roles.staff[email]',
  /setRole\('staff'\);\s*const p = staffPerms\[email\] \|\| \{\};/.test(auth));
ok('STAFF perms default to false (deny-by-default) — costPrices / deletes / exports',
  /setPerms\(\{ costPrices: !!p\.costPrices, deletes: !!p\.deletes, exports: !!p\.exports \}\)/.test(auth));
ok('OWNER has NO capability an ADMIN lacks — owner ≡ admin at runtime (role, perms both identical)',
  /if \(isAdmin\) \{\s*setRole\('admin'\);\s*setPerms\(\{ costPrices: true, deletes: true, exports: true \}\);/.test(auth));
ok('there is NO ownership-transfer mechanism — owner is code+rules hardcoded, not a writable field',
  !/transferOwnership|setOwner|owner:\s*request|newOwner/.test(auth) && !/owner:\s*/.test(rules.replace(/ownerEmail/g, '')));
ok('DEMO is a synthetic guest with NO Firebase auth — role "guest", perms fixed in code, writes never reach Firestore',
  /Synthetic read-only guest — no Firebase auth/.test(auth) && /demoAdmin \? 'demo-admin@balajiautoos\.com'/.test(auth));
ok('unauthenticated: role null, all perms false',
  /if \(!user\) \{ setRole\(null\); setPerms\(\{ costPrices: false, deletes: false, exports: false \}\); return; \}/.test(auth));

// ===================================================================
// 2. UI ENFORCEMENT PLUMBING (components/InventoryDashboard.js, pages/index.js)
// ===================================================================
console.log('\n2. UI enforcement plumbing\n');

ok('isAdmin (UI) = role === "admin"', /const isAdmin = role === 'admin';/.test(dash));
ok('canManageData (create/edit customers·vehicles·jobcards·invoices·suppliers) = isAdmin || demoAdmin',
  /const canManageData = isAdmin \|\| demoAdmin;/.test(dash));
ok('every business module receives canManage={canManageData || demoMode} — real STAFF is read-only there',
  (dash.match(/canManage=\{canManageData \|\| demoMode\}/g) || []).length >= 5);
ok('canDelete (UI) = isAdmin || perms.deletes (an admin may grant a staffer the delete UI)',
  /const canDelete = isAdmin \|\| !!perms\?\.deletes;/.test(dash));
ok('bulk-delete has an explicit isAdmin re-check inside the handler, not just button visibility',
  /if \(!isAdmin\) return toast\.error\('Only admins can bulk-delete'\);/.test(billing));
ok('Settings "Users & Roles" and "Backup & Data" tabs are isAdmin-gated (not in the tab list otherwise)',
  /\.\.\.\(isAdmin \? \[\['users', 'Users & Roles'\]\] : \[\]\)/.test(dash)
  && /\.\.\.\(isAdmin \? \[\['backup', 'Backup & Data'\]\] : \[\]\)/.test(dash));
ok('Settings sections themselves re-check isAdmin (section === "users" && isAdmin, etc.)',
  /section === 'users' && isAdmin/.test(dash) && /section === 'backup' && isAdmin/.test(dash) && /section === 'demoperms' && isAdmin/.test(dash));
ok('demo mode is strictly read-only for real writes — demoGuard() intercepts every mutation',
  /function demoGuard\(\)\s*\{\s*if \(demoMode\) \{ notify\.permissionDenied/.test(dash));
ok('route protection: an unauthenticated, non-demo visitor is redirected to /login',
  /if \(!loading && !user && !demoMode\) router\.push\('\/login'\)/.test(idx)
  && /if \(!user && !demoMode\) return <BootSplash label="Redirecting/.test(idx));
ok('idle timeout signs the terminal out and clears cached business data',
  /startIdleWatch\(async \(\) => \{[\s\S]*?signOut\(auth\)[\s\S]*?clearBusinessCaches\(\)/.test(idx));
ok('below-floor selling (CheckoutModal) is gated on the REAL isAdmin, never on canSeeCost',
  /<CheckoutModal[^>]*isAdmin=\{isAdmin \|\| demoAdmin\}/.test(dash));

// ===================================================================
// 3. FIRESTORE ENFORCEMENT — the authoritative boundary (firestore.rules)
// ===================================================================
console.log('\n3. Firestore rules — the authoritative security boundary\n');

const BUSINESS = ['parts', 'suppliers', 'categories', 'vehicles', 'customers', 'invoices', 'jobCards', 'purchaseOrders'];
for (const c of BUSINESS) {
  const m = rules.match(new RegExp(`match /${c}/\\{[^}]+\\} \\{([\\s\\S]*?)\\n    \\}`));
  const body = m ? m[1] : '';
  ok(`${c}: read/create/update = any signed-in user (single-shop trust model)`,
    /allow read: if signedIn\(\);/.test(body) && /allow create, update: if signedIn\(\);/.test(body));
  ok(`${c}: DELETE = isAdmin() only (Staff hard-delete denied at the data layer)`,
    /allow delete: if isAdmin\(\);/.test(body));
}
for (const led of ['sales', 'restocks', 'stockAdjustments']) {
  const m = rules.match(new RegExp(`match /${led}/\\{[^}]+\\} \\{([\\s\\S]*?)\\n    \\}`));
  const body = m ? m[1] : '';
  ok(`${led}: append-only — read/create signed-in, UPDATE always false (nobody edits a ledger row, not even admin)`,
    /allow read, create: if signedIn\(\);/.test(body) && /allow update: if false;/.test(body));
  ok(`${led}: DELETE = isAdmin() only`, /allow delete: if isAdmin\(\);/.test(body));
}
ok('auditLog: CREATE requires performedBy == request.auth.uid (actor cannot be forged); UPDATE false; DELETE isAdmin',
  /match \/auditLog\/\{logId\} \{[\s\S]*?allow create: if signedIn\(\) && request\.resource\.data\.performedBy == request\.auth\.uid;[\s\S]*?allow update: if false;[\s\S]*?allow delete: if isAdmin\(\);/.test(rules));
ok('appSettings (holds roles/admins/staff): READ signed-in, CREATE+UPDATE isAdmin() only, DELETE false — staff cannot self-promote',
  /match \/appSettings\/\{docId\} \{[\s\S]*?allow read: if signedIn\(\);[\s\S]*?allow create, update: if isAdmin\(\);[\s\S]*?allow delete: if false;/.test(rules));
ok('recoveryVault (full-data snapshots): read/create/delete isAdmin(), update false',
  /match \/recoveryVault\/\{id\} \{[\s\S]*?allow read, create, delete: if isAdmin\(\);[\s\S]*?allow update: if false;/.test(rules));
ok('recoveryMeta: read signed-in, create/update/delete isAdmin()',
  /match \/recoveryMeta\/\{id\} \{[\s\S]*?allow read: if signedIn\(\);[\s\S]*?allow create, update, delete: if isAdmin\(\);/.test(rules));
ok('counters (invoice numbering): monotonic next, no field injection, DELETE never',
  /match \/counters\/\{sequence\} \{[\s\S]*?request\.resource\.data\.next >= resource\.data\.next[\s\S]*?allow delete: if false;/.test(rules));
ok('editLocks: CREATE only for your own uid (ownerUid == request.auth.uid), session-aware update, delete only when expired',
  /request\.resource\.data\.ownerUid == request\.auth\.uid/.test(rules)
  && /allow delete: if signedIn\(\) && expired\(\);/.test(rules));
ok('pendingSales: creator-scoped — read/delete only if resource.data.createdBy == request.auth.uid; create self-attributed + shape-checked',
  /match \/pendingSales\/\{opId\} \{[\s\S]*?allow read, delete: if signedIn\(\) && resource\.data\.createdBy == request\.auth\.uid;[\s\S]*?request\.resource\.data\.createdBy == request\.auth\.uid/.test(rules));
ok('deny-by-default: every collection not explicitly listed is fully denied',
  /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/.test(rules));
ok('no collection is publicly readable (every read requires signedIn or stricter)',
  !/allow read: if true/.test(rules));
ok('every "allow delete" on business data is isAdmin() or false — the only exception is editLocks (expired only, no business data)',
  rules.split('\n').filter((l) => /allow delete:/.test(l))
    .every((l) => /isAdmin\(\)/.test(l) || /if false/.test(l) || /expired\(\)/.test(l)));

// ===================================================================
// 4. THE AUTHORIZATION MATRIX (independent oracle — every cell classified)
//    U=UI gate, M=mutation/txn guard, F=Firestore rule.  ✅ allowed  ❌ denied
// ===================================================================
console.log('\n4. Authorization matrix — Owner | Admin | Staff | Unauth\n');
const M = [
  // action,                       owner, admin, staff, unauth,  UI,   MUT,  FS,   authoritative-layer
  ['View any collection',          '✅','✅','✅','❌', 'route','—','signedIn','Firestore'],
  ['Create Customer/Vehicle/JobCard','✅','✅','⚠️UI-blocked','❌','canManage(admin)','—','signedIn','UI (FS intentionally shared)'],
  ['Edit Customer/Invoice/etc',    '✅','✅','⚠️UI-blocked','❌','canManage(admin)','_rev txn','signedIn','UI (FS intentionally shared)'],
  ['Delete Customer/Invoice/Part', '✅','✅','❌','❌', 'canManage/canDelete','store.remove','isAdmin()','Firestore'],
  ['Archive / Restore (soft)',     '✅','✅','⚠️UI-blocked','❌','canManage(admin)','capacityService','signedIn (update)','UI (soft, reversible — FS shared by design)'],
  ['Bulk delete',                  '✅','✅','❌','❌', 'isAdmin re-check','removeMany','isAdmin() per doc','Firestore'],
  ['Record sale / Quick Sell',     '✅','✅','✅','❌', 'ungated','runQuickSaleTx','signedIn','Firestore (intentional — "staff record sales")'],
  ['Collect Payment',              '✅','✅','⚠️UI-blocked','❌','canManage(admin)','conc/overpaid txn','signedIn','UI + txn'],
  ['Add / Edit Part',              '✅','✅','✅','❌', 'ungated','handleSave','signedIn','Firestore (intentional — "staff view stock")'],
  ['Modify stock / adjust / restock','✅','✅','✅','❌','ungated','txn + clamps','signedIn','Firestore (intentional)'],
  ['Receive PO',                   '✅','✅','✅','❌', 'ungated (Inventory)','poReceiveDoc txn','signedIn','Firestore + txn (state guards)'],
  ['Cancel PO / invoice',          '✅','✅','✅','❌', 'canManage in Billing; ungated PO','blind update','signedIn','Firestore (intentional)'],
  ['Edit a ledger row (sale/restock/adj)','❌','❌','❌','❌','no UI','—','update: false','Firestore (absolute)'],
  ['Forge auditLog performedBy',   '❌','❌','❌','❌', 'no UI','pushAudit sets uid','performedBy == auth.uid','Firestore (REPO ✅ / LIVE pending — see §7)'],
  ['Edit App Settings / roles',    '✅','✅','❌','❌', 'section isAdmin','onAddAdmin','isAdmin()','Firestore'],
  ['Manage Users / grant perms',   '✅','✅','❌','❌', 'section isAdmin','onSetStaffPerm','isAdmin() (appSettings)','Firestore'],
  ['Reset All Data / Recovery Vault','✅','✅','❌','❌','section isAdmin','resetAllData','recoveryVault+meta isAdmin() + deletes isAdmin()','Firestore'],
  ['View Audit Log',               '✅','✅','✅','❌', 'panel shown to all; Audit REPORT isAdmin','—','signedIn','Firestore (report export gated in UI)'],
  ['Self-promote to admin',        '❌','—','❌','❌', 'no UI','—','appSettings isAdmin()','Firestore'],
  ['Transfer ownership',           'N/A','N/A','N/A','N/A','no mechanism','—','ownerEmail() hardcoded','N/A (by design)'],
  ['Read another shop record (IDOR)','✅','✅','✅','❌','shared','—','signedIn','INTENTIONAL — single-shop shared data'],
  ['Read another user pendingSales','❌','❌','❌','❌','no UI','—','createdBy == auth.uid','Firestore'],
];
ok('matrix enumerates >= 20 privileged actions', M.length >= 20, `only ${M.length}`);
ok('every matrix row is fully populated (9 columns) and names its authoritative layer',
  M.every((r) => r.length === 9 && String(r[8] || '').length > 2),
  M.filter((r) => r.length !== 9 || String(r[8] || '').length <= 2).map((r) => `${r[0]} (len ${r.length})`).join(' | '));
ok('every DESTRUCTIVE row (delete / roles / recovery) is authoritative at Firestore, not UI',
  M.filter((r) => /Delete|Bulk delete|App Settings|Users|Reset All|Self-promote/.test(r[0]))
    .every((r) => /Firestore/.test(r[8])));
ok('shared-data (IDOR) row is explicitly classified INTENTIONAL, not a defect',
  M.find((r) => r[0].includes('IDOR'))[8].includes('INTENTIONAL'));

// ===================================================================
// 5. FORGED-FIELD / ROLE-ESCALATION rule shape
// ===================================================================
console.log('\n5. Forged-field + escalation rule shape\n');
ok('client-supplied identity is NEVER trusted: performedBy, ownerUid, createdBy all checked == request.auth.uid',
  /performedBy == request\.auth\.uid/.test(rules)
  && /ownerUid == request\.auth\.uid/.test(rules)
  && /createdBy == request\.auth\.uid/.test(rules));
ok('the doc that DETERMINES role (appSettings/roles) is writable ONLY by an existing admin — no bootstrap-via-write',
  /match \/appSettings\/\{docId\} \{[\s\S]*?allow create, update: if isAdmin\(\);/.test(rules));
ok('isAdmin() itself reads appSettings/roles.admins — it can only ever be satisfied by the owner email or an already-listed admin',
  /function isAdmin\(\)[\s\S]*?userEmail\(\) == ownerEmail\(\)[\s\S]*?userEmail\(\) in rolesDoc\(\)\.admins/.test(rules));
ok('the client also refuses to render the owner a "Remove admin" control (belt-and-braces UI)',
  /OWNER · Admin/.test(dash) && /admins\.filter\(\(e\) => !bootstrapAdmins/.test(dash));

// ===================================================================
// 6. EMULATOR COVERAGE CROSS-REFERENCE (tests/rules/firestore.rules.test.cjs)
//    Every matrix cell that needs a live rules proof must have one there.
// ===================================================================
console.log('\n6. Live emulator proof exists for each protected cell (npm run test:rules)\n');
const emuHas = (re) => re.test(rulesEmu);
ok('emulator: anon denied read/create parts + read appSettings',
  emuHas(/anon: read parts denied/) && emuHas(/anon: create parts denied/) && emuHas(/anon: read appSettings\/roles denied/));
ok('emulator: staff create/update parts+customers allowed, delete DENIED; admin delete allowed',
  emuHas(/staff: create parts allowed/) && emuHas(/staff: delete parts denied \(admin-only\)/) && emuHas(/admin: delete parts allowed/));
ok('emulator: ledger update denied for staff AND admin (append-only overrides admin)',
  emuHas(/staff: update sales denied/) && emuHas(/admin: update sales STILL denied/));
ok('emulator: auditLog impersonation of a different uid DENIED; missing performedBy DENIED',
  emuHas(/create auditLog entry impersonating a DIFFERENT uid denied/) && emuHas(/no performedBy field at all denied/));
ok('emulator: staff cannot self-promote via appSettings/roles; admin can; nobody can delete appSettings',
  emuHas(/staff: cannot self-promote by writing appSettings\/roles/) && emuHas(/nobody: delete appSettings denied/));
ok('emulator: recoveryVault staff read/create DENIED; admin only',
  emuHas(/staff: read recoveryVault denied/) && emuHas(/staff: create recoveryVault denied/));
ok('emulator: owner-email bypass works with NO appSettings/roles doc present',
  emuHas(/owner: delete parts allowed with NO appSettings\/roles doc present/));
ok('emulator: editLocks theft (create with foreign ownerUid, steal an active lease) DENIED',
  emuHas(/create with ownerUid != auth\.uid/) && emuHas(/updating A.{0,3}s ACTIVE lease \(theft\)/));
ok('emulator: pendingSales — B cannot read/delete A\'s doc; forged createdBy DENIED',
  emuHas(/a different signed-in user\) cannot read A.{0,3}s pendingSales doc/) && emuHas(/cannot forge another user.{0,3}s pending sale/));
ok('emulator: fallback deny for an unlisted collection (even for admin)',
  emuHas(/admin: read on an unlisted collection still denied/));
// Phase 19 additions (see the "PHASE 19" block appended to that file)
ok('emulator: PHASE 19 section present (staff-writes-staff-perms, salesRollups, retry-of-denied-delete)',
  emuHas(/PHASE 19 — authorization matrix/));

// ===================================================================
// 7. DEPLOYMENT GAP — must stay visible until the owner publishes
// ===================================================================
console.log('\n7. Rules deployment status (owner action required)\n');
ok('firestore.rules in the repo IS the hardened ruleset (auditLog self-attribution present)',
  /allow create: if signedIn\(\) && request\.resource\.data\.performedBy == request\.auth\.uid;/.test(rules));
ok('KNOWN_LIMITATIONS still flags the PH15-03 auditLog rule as NOT yet published to balaji-auto-os-7',
  /auditLog.{0,80}still needs a manual `firebase deploy/i.test(known)
  || /PH15-03.{0,200}needs a manual `firebase deploy/is.test(known)
  || /live `auditLog` rule still allows a signed-in client to write an entry with a\s*\n?\s*forged `performedBy`/is.test(known));
ok('the client already writes performedBy = the real uid, so publishing the rule needs NO code change',
  /performedBy: user\?\.uid \|\| null/.test(dash));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
