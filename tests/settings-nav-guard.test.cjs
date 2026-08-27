/**
 * tests/settings-nav-guard.test.cjs — PART-5.1
 *
 * High-risk config (GST, invoice numbering, notifications) must NOT be silently lost when
 * the user navigates away in-app. beforeunload covered refresh/close; this guards tab
 * switches. Source guards (the wiring lives in JSX/handlers we can't execute headless).
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');

console.log('\nPART-5.1 — unsaved-settings navigation guard\n');

// Category B config uses explicit save, not auto-save
ok('business config persists ONLY via saveBiz (explicit), never on edit',
  /const bset = \(patch\) => setBiz/.test(src) && /const saveBiz = \(\) => \{/.test(src) && !/bset[\s\S]{0,40}localStorage\.setItem\('maruti_settings'/.test(src));
ok('Save/Cancel are gated on dirty', /disabled=\{!dirty\}/.test(src));

// safe prefs DO auto-save (Category A) — theme/density
// H-9: the key now sources from STORAGE.PREFS (constants/index.js) instead of the raw
// literal — same value, single source of truth.
ok('appearance prefs auto-save (Category A) via updatePrefs',
  /const updatePrefs = [\s\S]{0,120}localStorage\.setItem\((?:'maruti_prefs'|STORAGE\.PREFS)/.test(src));

// the new nav guard
ok('SettingsView reports dirty state upward (onDirtyChange)',
  /onDirtyChange\?\.\(dirty\)/.test(src));
ok('a dirty ref backs the memoized navigation guard (no stale closure)',
  /settingsDirtyRef\.current = settingsDirty/.test(src));
ok('leaving settings while dirty confirms before discarding',
  /settingsDirtyRef\.current[\s\S]{0,120}confirm\('You have unsaved settings/.test(src));
ok('the guard does not fire when navigating INTO settings',
  /tab !== 'settings' && settingsDirtyRef\.current/.test(src));
ok('beforeunload guard still present for refresh/close',
  /addEventListener\('beforeunload'/.test(src));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
