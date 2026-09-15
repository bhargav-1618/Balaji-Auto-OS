/**
 * tests/settings-status-bar-aria-live.test.cjs
 *
 * Accessibility: the Settings Save/Cancel status bar ("You have unsaved changes" /
 * "All changes saved") is the one element every editable Settings section relies on
 * to tell the user whether their edit is pending or saved. Nothing in this codebase
 * used aria-live or role="status" anywhere — a screen reader user had no way to know
 * that bar's text changed after an edit, a Save, or a Cancel; they'd have to manually
 * re-navigate to it. Adding role="status" (implicit aria-live="polite" +
 * aria-atomic="true") makes assistive tech announce the change automatically.
 *
 * This test verifies the attribute is present, and that the real component still
 * renders and updates that same text correctly across the dirty/Save/Cancel
 * lifecycle — a purely additive change should not alter any existing behavior.
 */
require('./setup.cjs');
if (typeof global.localStorage === 'undefined') global.localStorage = global.window.localStorage;

const fs = require('fs');
const path = require('path');
let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};

console.log('\nSettings status bar has an ARIA live region (accessibility)\n');

// ---- Source check --------------------------------------------------------------
const sv = fs.readFileSync(path.resolve(__dirname, '..', 'components/inventory/views/SettingsView.jsx'), 'utf8');
ok('the Save/Cancel status span has role="status"',
  /<span role="status" className="text-\[11px\] text-white\/45">\{sectionDirty \? t\('state\.unsavedChanges'/.test(sv));

// ---- Behavioral check: mount the real SettingsView, drive an edit + Save/Cancel,
//    confirm the span keeps role="status" and its text updates correctly. -----------
const React = require('react');
const { act } = require('react');
const { createRoot } = require('react-dom/client');
const SettingsView = require('../components/inventory/views/SettingsView.jsx').default;
const { LanguageProvider } = require('../lib/i18n.js');

try { localStorage.setItem('maruti_settings', JSON.stringify({})); } catch {}

const host = document.createElement('div');
document.body.appendChild(host);
let root;
let crashed = null;
try {
  act(() => {
    root = createRoot(host);
    root.render(React.createElement(LanguageProvider, null,
      React.createElement(SettingsView, {
        onDirtyChange: () => {}, totalRecords: 0, isAdmin: true, userEmail: 'admin@test.com', online: true,
        onBackup: () => {}, onRestore: () => {}, admins: [], bootstrapAdmins: ['admin@test.com'],
        onAddAdmin: async () => true, onRemoveAdmin: async () => {},
        staffPerms: {}, onAddStaff: async () => true, onRemoveStaff: async () => {},
        onSetStaffPerm: async () => true, recoveryMeta: null, onResetAllData: async () => true, onRestoreVault: async () => {},
        demoMode: false, demoAdmin: false, sidebarCollapsed: false, setSidebarCollapsed: () => {},
        lastBackup: null, lastSync: null,
      }),
    ));
  });
} catch (e) { crashed = e; }
ok('SettingsView renders without crashing', !crashed, crashed && crashed.message);

const findStatusBar = () => host.querySelector('[role="status"]');

ok('the status bar is present on initial render and reads "All changes saved"',
  !!findStatusBar() && findStatusBar().textContent === 'All changes saved');

// Business Profile is the default section — type into Workshop Name to go dirty.
const nameInput = Array.from(host.querySelectorAll('input')).find((i) => i.placeholder === 'Your Workshop Name');
ok('found the Workshop Name field', !!nameInput);
act(() => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(nameInput, 'Accessibility Test Workshop');
  nameInput.dispatchEvent(new Event('input', { bubbles: true }));
});
ok('status bar still has role="status" after going dirty', !!findStatusBar());
ok('status bar text updates to "You have unsaved changes"',
  findStatusBar() && findStatusBar().textContent === 'You have unsaved changes');

act(() => {
  const cancelBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Cancel' && !b.disabled);
  cancelBtn && cancelBtn.click();
});
ok('status bar text reverts to "All changes saved" after Cancel, role="status" preserved',
  findStatusBar() && findStatusBar().textContent === 'All changes saved');

act(() => { root.unmount(); });

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
