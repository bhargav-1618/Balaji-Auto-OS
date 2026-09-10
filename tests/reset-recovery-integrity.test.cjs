/**
 * tests/reset-recovery-integrity.test.cjs
 *
 * FINAL PRODUCTION ACCEPTANCE — Reset All Data / Recovery Vault coverage.
 *
 * Real defect this locks down: `Settings → Backup & Data → Reset All Data` cleared
 * customers/vehicles/invoices/sales/restocks/auditLog/salesRollups but LEFT
 * `purchaseOrders` live, because `RECOVERY_COLLECTIONS` (the single allow-list that
 * drives snapshot + meta + delete, and which restore/purge round-trip) omitted it.
 *
 * The reset/recovery pipeline is fully GENERIC over that one array:
 *   - capture:  for (name of RECOVERY_COLLECTIONS) getDocs(collection(db, name)) → recoveryVault
 *   - meta:     counts[name] = snap.size
 *   - delete:   for (name of RECOVERY_COLLECTIONS) ... batch.delete(doc(db, name, id))
 *   - restore:  reads every vault doc, batch.set(doc(db, v.coll, v.docId), v.data)  — array-independent
 *   - purge:    deletes every vault doc for the snapshot                            — array-independent
 * So the correct + complete fix is: the array must list every APPLICATION BUSINESS +
 * DERIVED collection, and NONE of the preserve-list (config / vault / transient).
 *
 * These are INDEPENDENT oracles — the expected sets are hand-maintained here from
 * constants/index.js COLLECTIONS + firestore.rules, never read back from the code
 * under test.
 */
require('./setup.cjs');
const fs = require('fs');
const path = require('path');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');

console.log('\nFINAL ACCEPTANCE — Reset All Data / Recovery Vault collection coverage\n');

const dash = read('../components/InventoryDashboard.js');
const rules = read('../firestore.rules');
const { COLLECTIONS } = require('../constants');

// ── 1. Parse the live RECOVERY_COLLECTIONS array straight from source ──────────
const m = dash.match(/const RECOVERY_COLLECTIONS = \[([^\]]+)\];/);
ok('RECOVERY_COLLECTIONS is declared in InventoryDashboard.js', !!m);
const recovery = m ? m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [];

// ── 2. Every APPLICATION BUSINESS + DERIVED collection MUST be reset ──────────
// (A) business data + (B) derived data, per the phase's collection classification.
const MUST_RESET = [
  'parts', 'suppliers', 'categories', 'vehicles', 'customers', 'invoices',
  'jobCards', 'purchaseOrders', 'sales', 'restocks', 'stockAdjustments',
  'reorderRequests', 'auditLog',
  'salesRollups', // derived (not in COLLECTIONS const — inline 'salesRollups')
];
for (const c of MUST_RESET) {
  ok(`RECOVERY_COLLECTIONS includes business/derived collection: ${c}`, recovery.includes(c),
    `have [${recovery.join(', ')}]`);
}
ok('RECOVERY_COLLECTIONS includes purchaseOrders (the regression)', recovery.includes('purchaseOrders'));

// ── 3. NO configuration / system / vault / transient collection may be reset ──
const MUST_PRESERVE = [
  'counters',        // rules: delete=false — losing it restarts serials at 1
  'appSettings',     // admin/staff role config; rules: delete=false
  'recoveryVault',   // the vault itself
  'recoveryMeta',    // the vault pointer
  'editLocks',       // transient, self-expiring edit leases
  'pendingSales',    // transient, per-creator-scoped; self-reconciled
  'staff', 'settings', // legacy COLLECTIONS entries — never wire into a bulk wipe
];
for (const c of MUST_PRESERVE) {
  ok(`RECOVERY_COLLECTIONS does NOT reset preserved collection: ${c}`, !recovery.includes(c));
}

// ── 4. Cross-check against the COLLECTIONS constant ──────────────────────────
// Every COLLECTIONS value is either reset or on the documented preserve list.
const known = new Set([...MUST_RESET, ...MUST_PRESERVE]);
for (const name of Object.values(COLLECTIONS)) {
  ok(`COLLECTIONS.${name} is classified (reset or preserved), not forgotten`, known.has(name),
    `'${name}' is neither in MUST_RESET nor MUST_PRESERVE`);
}

// ── 5. The pipeline is generic over the array (adding to it is sufficient) ────
ok('capture loop iterates RECOVERY_COLLECTIONS',
  /for \(const name of RECOVERY_COLLECTIONS\) \{\s*\n\s*const snap = await getDocs\(collection\(db, name\)\);/.test(dash));
ok('meta records a per-collection count for the whole array',
  /counts\[name\] = snap\.size;/.test(dash));
ok('delete loop iterates RECOVERY_COLLECTIONS (after the snapshot is safe)',
  /\/\/ 3\) Now delete all live docs[\s\S]*?for \(const name of RECOVERY_COLLECTIONS\) \{[\s\S]*?batch\.delete\(doc\(db, name, d\.id\)\)/.test(dash));
ok('restore is array-independent — replays every vault doc by its stored coll/docId',
  /if \(v\.coll && v\.docId\) \{ batch\.set\(doc\(db, v\.coll, v\.docId\), v\.data \|\| \{\}\); total\+\+; \}/.test(dash));
ok('snapshot is written BEFORE any delete (never destroy before the vault is safe)',
  dash.indexOf('Copy all live docs into recoveryVault') < dash.indexOf('Now delete all live docs'));

// ── 6. Rules permit the reset + restore round-trip for purchaseOrders ────────
ok('firestore.rules: purchaseOrders delete is admin-only (Reset All Data runs as owner)',
  /match \/purchaseOrders\/\{poId\} \{[\s\S]*?allow delete: if isAdmin\(\);/.test(rules));
ok('firestore.rules: purchaseOrders create is signed-in (restore re-creates them)',
  /match \/purchaseOrders\/\{poId\} \{[\s\S]*?allow create, update: if signedIn\(\);/.test(rules));
ok('firestore.rules: counters delete is permanently false (reset must never touch it)',
  /match \/counters\/\{sequence\} \{[\s\S]*?allow delete: if false;/.test(rules));

// ── 7. A live onSnapshot on purchaseOrders means the UI empties itself post-reset ──
ok('purchaseOrders has a live listener → the PO screen refreshes to empty after reset',
  /onSnapshot\(\s*\n?\s*query\(collection\(db, COLLECTIONS\.PURCHASE_ORDERS\)/.test(dash)
  || /collection\(db, COLLECTIONS\.PURCHASE_ORDERS\), orderBy\('createdAt', 'desc'\), limit\(300\)\)/.test(dash));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
