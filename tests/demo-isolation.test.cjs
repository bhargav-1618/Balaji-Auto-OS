/**
 * tests/demo-isolation.test.cjs — PART-6.2
 *
 * Demo mode must never touch PRODUCTION data or config. Static guards over the source:
 * role-management writes are demo-blocked, settings are namespaced by mode, and demo
 * state lives under separate keys that are cleared on exit.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const dash = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');
const billing = fs.readFileSync(path.resolve(__dirname, '../components/billing/BillingModule.jsx'), 'utf8');
const auth = fs.readFileSync(path.resolve(__dirname, '../context/AuthContext.js'), 'utf8');

console.log('\nPART-6.2 — demo admin isolation\n');

// 1. every role-management write is demo-blocked (defense-in-depth; UI already hides them)
for (const fn of ['addStaffEmail', 'removeStaffEmail', 'setStaffPermission', 'addAdminEmail', 'removeAdminEmail']) {
  const re = new RegExp(`async function ${fn}\\([^)]*\\)\\s*\\{\\s*if \\(demoMode \\|\\| !isAdmin\\)`);
  ok(`${fn} is blocked in demo mode`, re.test(dash));
}

// 2. settings are namespaced by mode — demo can't overwrite production config
ok('dashboard settings key is namespaced by mode',
  /const SETTINGS_KEY = demoMode \? 'maruti_settings_demo' : 'maruti_settings'/.test(dash));
ok('saveBiz writes the namespaced key (not hardcoded production)',
  /localStorage\.setItem\(SETTINGS_KEY, JSON\.stringify\(biz\)\)/.test(dash));
ok('no hardcoded production settings WRITE remains',
  !/localStorage\.setItem\('maruti_settings',/.test(dash));
ok('BillingModule reads the namespaced settings key',
  /const SETTINGS_KEY = demoMode \? 'maruti_settings_demo'/.test(billing));

// 3. demo role is 'guest', never 'admin' → isAdmin stays false in demo
ok('demo mode sets role to guest, never admin', /if \(demoMode\)[\s\S]{0,400}setRole\('guest'\)/.test(auth));
ok('the Firestore role subscription is skipped in demo', /if \(demoMode\) return;[\s\S]{0,80}roles/.test(auth) || /Skipped entirely in demo/.test(auth));

// 4. demo drafts/history are namespaced, and caches cleared on exit
ok('part drafts are namespaced by mode', /maruti_part_draft_v1_\$\{demoMode \? 'demo' : 'prod'\}/.test(dash));
ok('demo exit clears business caches (no demo data bleeds into prod)',
  /clearBusinessCaches\(\)/.test(auth));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
