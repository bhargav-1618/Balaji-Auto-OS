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
// Refactor Phase 12 — SettingsView extracted verbatim to its own file. The container
// (src) still owns the navigation guard (settingsDirtyRef + the confirm() prompts +
// beforeunload); SettingsView's own save/dirty wiring reads from sv.
const sv = fs.readFileSync(path.resolve(__dirname, '../components/inventory/views/SettingsView.jsx'), 'utf8');

console.log('\nPART-5.1 — unsaved-settings navigation guard\n');

// Category B config uses explicit save, not auto-save
ok('business config persists ONLY via saveBiz (explicit), never on edit',
  /const bset = \(patch\) => setBiz/.test(sv) && /const saveBiz = \(\) => \{/.test(sv) && !/bset[\s\S]{0,40}localStorage\.setItem\('maruti_settings'/.test(sv));
ok('Save/Cancel are gated on dirty', /disabled=\{!dirty\}/.test(sv));

// safe prefs DO auto-save (Category A) — theme/density
// H-9: the key now sources from STORAGE.PREFS (constants/index.js) instead of the raw
// literal — same value, single source of truth.
ok('appearance prefs auto-save (Category A) via updatePrefs',
  /const updatePrefs = [\s\S]{0,120}localStorage\.setItem\((?:'maruti_prefs'|STORAGE\.PREFS)/.test(sv));

// the new nav guard
ok('SettingsView reports dirty state upward (onDirtyChange)',
  /onDirtyChange\?\.\(dirty\)/.test(sv));
ok('a dirty ref backs the memoized navigation guard (no stale closure)',
  /settingsDirtyRef\.current = settingsDirty/.test(src));
ok('leaving settings while dirty confirms before discarding',
  /settingsDirtyRef\.current[\s\S]{0,120}confirm\('You have unsaved settings/.test(src));
ok('the guard does not fire when navigating INTO settings',
  /tab !== 'settings' && settingsDirtyRef\.current/.test(src));
// BUG-LIVE-SETTINGS-02 — this assertion used to just check that the STRING
// "addEventListener('beforeunload'" appears ANYWHERE in the whole container
// file (`src`, 10,000+ lines). PartModal and SupplierModal — unrelated to
// Settings — already register their OWN beforeunload handlers for their OWN
// dirty state, so this always matched regardless of whether Settings itself
// had one — and it didn't. Now scoped to SettingsView.jsx (`sv`) and to a
// handler actually keyed on Settings' own `dirty` flag.
ok('beforeunload guard exists for SETTINGS\' own dirty state specifically (not just present somewhere in the container)',
  /useEffect\(\(\) => \{\s*if \(!dirty\) return undefined;\s*const h = \(e\) => \{ e\.preventDefault\(\); e\.returnValue = ''; \};\s*window\.addEventListener\('beforeunload', h\);/.test(sv));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
