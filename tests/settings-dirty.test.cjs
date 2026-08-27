/**
 * tests/settings-dirty.test.cjs — ISSUE 1
 *
 * "Change a setting, change it back → Save Changes stays enabled."
 *
 * The normaliser below is the one shipped in InventoryDashboard.js. It is duplicated
 * here rather than exported, because SettingsView is a private function inside an
 * 11k-line module and exporting it just for a test would be a bigger change than the
 * fix. The test asserts the SHIPPED defaults table stays in sync with the accessors.
 */
const fs = require('fs');
const path = require('path');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};

const SRC = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');

// Pull the real defaults + normaliser out of the shipped file and execute them.
const defaultsBlock = SRC.match(/const SETTINGS_DEFAULTS = \{[\s\S]*?\n\};/);
const normBlock = SRC.match(/function normalizeSettings\(obj = \{\}\) \{[\s\S]*?\n\}/);
// eslint-disable-next-line no-new-func
const { SETTINGS_DEFAULTS, normalizeSettings } = new Function(
  `${defaultsBlock[0]}\n${normBlock[0]}\nreturn { SETTINGS_DEFAULTS, normalizeSettings };`,
)();

const dirty = (a, b) => normalizeSettings(a) !== normalizeSettings(b);

console.log('\nISSUE 1 — settings dirty state\n');

// THE REPORTED BUG. Saved settings are `{}` (nothing persisted yet — the common case).
const saved = {};

ok('a freshly loaded settings page is NOT dirty', !dirty(saved, saved));

// Toggle "Low Stock Alerts" OFF. `on={biz[k] !== false}` so this writes an explicit false.
const off = { ...saved, remLowStock: false };
ok('toggling a setting OFF marks it dirty', dirty(off, saved));

// Toggle it back ON. bset writes `true` — it can never write the key back OUT.
const backOn = { ...off, remLowStock: true };
ok('toggling it BACK ON clears dirty (this was the bug)',
  !dirty(backOn, saved),
  `raw JSON differs (${JSON.stringify(backOn)} vs ${JSON.stringify(saved)}) but the effective settings are identical`);

// Key ORDER must not matter — JSON.stringify is order-sensitive, meaning is not.
ok('key order does not affect dirty state',
  !dirty({ remService: true, remLowStock: true }, { remLowStock: true, remService: true }));

// Explicitly writing a value that equals the default is not a change.
ok('writing a value equal to its default is not a change',
  !dirty({ ...saved, roundOff: true, gstOptional: true }, saved));

ok('…and writing one that differs from the default IS a change',
  dirty({ ...saved, roundOff: false }, saved));

// Empty string and absent must mean the same thing (text fields).
ok('empty string equals absent', !dirty({ ...saved, currency: '' }, saved));

// A real edit must still register, or we would have broken Save entirely.
ok('a genuine edit still marks dirty', dirty({ ...saved, currency: 'INR' }, saved));

// Saving rebases: dirty must clear.
const afterSave = { ...backOn, currency: 'INR' };
ok('after Save, the new baseline is not dirty', !dirty(afterSave, afterSave));

// --- the defaults table must stay in sync with the ACCESSORS in the JSX.
// If someone adds `biz.foo !== false` without adding foo:true here, Save sticks again.
// Strip comments first — the explanatory comment above the defaults table literally
// contains the string `biz.x !== false`, and matching that would flag a field named "x".
const CODE = SRC.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
const accessors = [...CODE.matchAll(/biz\.([a-zA-Z0-9_]+)\s*!==\s*false/g)].map((m) => m[1]);
const bracket = SRC.includes('on={biz[k] !== false}');   // the rem* notification loop
const missing = accessors.filter((k) => SETTINGS_DEFAULTS[k] !== true);
ok('every `biz.x !== false` accessor has a `true` default registered',
  missing.length === 0,
  missing.length ? `missing true-defaults for: ${missing.join(', ')} — Save will stick for these` : '');
ok('the rem* notification toggles use the !== false idiom (defaults registered)', bracket);

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
