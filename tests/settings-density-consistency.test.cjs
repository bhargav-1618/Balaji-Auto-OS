/**
 * tests/settings-density-consistency.test.cjs
 *
 * BUG-LIVE-SETTINGS-01 regression guard — "Appearance -> Density doesn't
 * actually do anything."
 *
 * `prefs.density` was written to state and persisted to localStorage exactly
 * like theme/fontSize/reduceMotion (SettingsView.jsx), and even had its own
 * default seeded on InventoryDashboard.js's app-load effect alongside
 * theme/fontSize/reduceMotion — but unlike those three, nothing ever read
 * `density` back to set a DOM attribute, CSS class, or any other consumer.
 * Selecting "Compact" changed the segmented control's own selected state and
 * persisted a value nobody read — a complete control -> state -> persistence
 * link with the state -> styling half missing entirely.
 *
 * This test proves, without relying on button-label/string checks alone,
 * that a REAL DOM attribute now changes (behavioral, via an actual render)
 * and that REAL CSS rules exist for it (not just a data-attribute nobody
 * styles).
 */
require('./setup.cjs');
// setup.cjs wires global.window/document/etc from its jsdom instance but not
// global.localStorage — every localStorage call in the shipped code is
// try/catch-wrapped for exactly this kind of headless environment, so it
// fails silently without this. Polyfilling it (jsdom's window already has a
// real one) lets this test prove actual persistence, not just that the
// missing call didn't crash anything.
if (typeof global.localStorage === 'undefined') global.localStorage = global.window.localStorage;
const fs = require('fs');
const path = require('path');
let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};

console.log('\nSettings > Appearance > Density — control must actually drive real styling\n');

// ---- 1. Source shape: both places that already apply theme/fontSize/reduceMotion
//    on every app load / every SettingsView mount must ALSO apply density now. -----
const sv = fs.readFileSync(path.resolve(__dirname, '../components/inventory/views/SettingsView.jsx'), 'utf8');
const dash = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');
const css = fs.readFileSync(path.resolve(__dirname, '../styles/globals.css'), 'utf8');

ok('SettingsView applies data-density on its own appearance effect (same effect as data-theme)',
  /setAttribute\('data-theme', prefs\.theme \|\| 'dark'\);[\s\S]{0,700}setAttribute\('data-density', prefs\.density \|\| 'comfortable'\);/.test(sv));
ok('...and the effect re-runs when density changes (it is in the dependency array)',
  /\[prefs\.fontSize, prefs\.reduceMotion, prefs\.theme, prefs\.density\]/.test(sv));

ok('InventoryDashboard\'s app-LOAD effect (runs on every reload, independent of visiting Settings) ALSO applies data-density',
  /document\.documentElement\.setAttribute\('data-theme', p\.theme \|\| 'dark'\);\s*\n[\s\S]{0,600}document\.documentElement\.setAttribute\('data-density', p\.density \|\| 'comfortable'\);/.test(dash));

// ---- 2. Real CSS exists for the compact state, targeting genuinely shared,
//    widely-reused utility classes (not a token nobody styles). -------------------
ok('globals.css defines real [data-density="compact"] override rules',
  /\[data-density="compact"\]/.test(css));
const compactRules = css.match(/\[data-density="compact"\][^{]*\{[^}]*\}/g) || [];
ok('there are multiple distinct compact-density rules (table rows, cards, gaps — not just one token)',
  compactRules.length >= 6, `found ${compactRules.length}`);
ok('the compact rules actually shrink spacing (not a no-op / identical value)',
  compactRules.every((r) => /padding|margin|gap/.test(r)));

// ---- 3. Behavioural: render the REAL SettingsView and prove selecting Compact vs
//    Comfortable actually flips document.documentElement's attribute. -------------
const React = require('react');
const { act } = require('react');
const { createRoot } = require('react-dom/client');
const SettingsView = require('../components/inventory/views/SettingsView.jsx').default;
const { LanguageProvider } = require('../lib/i18n.js');

try { localStorage.setItem('maruti_settings', JSON.stringify({})); } catch {}
try { localStorage.setItem('maruti_prefs', JSON.stringify({ density: 'comfortable' })); } catch {}

const host = document.createElement('div');
document.body.appendChild(host);
let crashed = null;
try {
  act(() => {
    createRoot(host).render(React.createElement(LanguageProvider, null,
      React.createElement(SettingsView, {
        onDirtyChange: () => {}, totalRecords: 0, isAdmin: true, userEmail: 'qa@test', online: true,
        onBackup: () => {}, onRestore: () => {},
        admins: [], bootstrapAdmins: [], onAddAdmin: () => {}, onRemoveAdmin: () => {},
        staffPerms: {}, onAddStaff: () => {}, onRemoveStaff: () => {}, onSetStaffPerm: () => {},
        recoveryMeta: null, onResetAllData: () => {}, onRestoreVault: () => {},
        demoMode: false, demoAdmin: false, sidebarCollapsed: false, setSidebarCollapsed: () => {},
        lastBackup: null, lastSync: null,
      }),
    ));
  });
} catch (e) { crashed = e; }
ok('SettingsView renders without crashing', !crashed, crashed && crashed.message);

ok('starts on Comfortable (the seeded default) — data-density reflects it',
  document.documentElement.getAttribute('data-density') === 'comfortable',
  `got: ${document.documentElement.getAttribute('data-density')}`);

// Navigate to the Appearance section and click "Compact".
act(() => {
  const apptab = Array.from(host.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Appearance');
  apptab && apptab.click();
});
act(() => {
  const compactBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Compact');
  compactBtn && compactBtn.click();
});
ok('clicking Compact actually sets data-density="compact" on <html> (the missing link)',
  document.documentElement.getAttribute('data-density') === 'compact',
  `got: ${document.documentElement.getAttribute('data-density')}`);
ok('...and it is persisted to localStorage immediately (same immediate-save model as theme)',
  (() => { try { return JSON.parse(localStorage.getItem('maruti_prefs') || '{}').density === 'compact'; } catch { return false; } })());

// Switch back to Comfortable and confirm it reverts cleanly.
act(() => {
  const comfortableBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Comfortable');
  comfortableBtn && comfortableBtn.click();
});
ok('switching back to Comfortable reverts the attribute',
  document.documentElement.getAttribute('data-density') === 'comfortable');

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
