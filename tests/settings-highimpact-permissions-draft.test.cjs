/**
 * tests/settings-highimpact-permissions-draft.test.cjs
 *
 * ADMIN SETTINGS — SAVE/CANCEL + CHANGE CONFIRMATION for high-impact permission
 * controls.
 *
 * Prior classification treated Demo Permissions and the per-staff permission pills
 * (Users & Roles) as intentionally immediate-save, same as Theme/Density. This task's
 * explicit new requirement: an important permission grant/revoke must NOT be able to
 * commit from a single stray click — it must stage as a draft, clearly show "unsaved
 * changes", and only take effect on an explicit Save Changes, with Cancel reverting to
 * the last-persisted state and a toast confirming success or failure.
 *
 * "Make admin" / "Add staff" / "Remove admin" / "Remove staff" are UNCHANGED and stay
 * atomic one-click actions (each is a single, clearly-scoped, already-toast-covered
 * account-lifecycle operation — see components/InventoryDashboard.js's
 * addAdminEmail/removeAdminEmail/addStaffEmail/removeStaffEmail, none of which this
 * pass touches). Only the per-staff PERMISSION PILLS (See cost prices / Delete
 * records / Run exports) were converted to the same draft model as Demo Permissions.
 *
 * This test verifies actual behavior — real localStorage writes (or their absence),
 * the real toast array the shared test harness intercepts react-hot-toast into (see
 * tests/setup.cjs), and real onDirtyChange calls — not merely that a Save/Cancel
 * button exists in the markup.
 */
require('./setup.cjs');
const { toasts, clear: clearToasts } = require('./setup.cjs');
if (typeof global.localStorage === 'undefined') global.localStorage = global.window.localStorage;

const fs = require('fs');
const path = require('path');
let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nAdmin Settings — high-impact permission draft/Save/Cancel/toast\n');

// ---- 1. Source shape: the draft/saved split and its Save/Cancel/toast wiring. -----
const sv = read('components/inventory/views/SettingsView.jsx');
ok('Demo Permissions: toggling only stages a draft — no localStorage write, no event dispatch inside toggleDemoPerm itself',
  /const toggleDemoPerm = \(key\) => setDemoPermsState\(\(d\) => \(\{ \.\.\.d, \[key\]: !d\[key\] \}\)\);/.test(sv));
ok('Demo Permissions: a separate saved-baseline exists for Cancel to revert to',
  /const \[demoPermsSaved, setDemoPermsSaved\] = useState/.test(sv));
ok('Demo Permissions: Save persists, notifies live demo sessions, and shows a success toast',
  /const saveDemoPermsChanges = \(\) => \{[\s\S]{0,300}localStorage\.setItem\(DEMO_PERM_KEY, JSON\.stringify\(demoPerms\)\)[\s\S]{0,100}window\.dispatchEvent\(new CustomEvent\('maruti-demo-perms'\)\)[\s\S]{0,150}toast\.success/.test(sv));
ok('Demo Permissions: Save failure shows an error toast',
  /const saveDemoPermsChanges[\s\S]{0,600}catch \(e\) \{\s*toast\.error/.test(sv));
ok('Demo Permissions: Cancel reverts the draft to the saved baseline',
  /const cancelDemoPermsChanges = \(\) => setDemoPermsState\(demoPermsSaved\);/.test(sv));

ok('Staff permission pills: toggling only stages a draft, does not call onSetStaffPerm directly',
  /const toggleStaffPermDraft = \(email, key\) => setStaffPermsDraft/.test(sv)
  && !/onClick=\{\(\) => onSetStaffPerm\(email, key,/.test(sv));
ok('Staff permission pills: Save reuses the existing per-permission write (onSetStaffPerm) once per changed key, and toasts success only if every call succeeded',
  /const saveStaffPermsDraft = async \(\) => \{[\s\S]{0,900}const ok = await onSetStaffPerm\(email, key, after\[key\]\);[\s\S]{0,200}if \(allOk\) toast\.success/.test(sv));
ok('Staff permission pills: Cancel reverts the draft to the live staffPerms prop (Firestore truth)',
  /const cancelStaffPermsDraft = \(\) => setStaffPermsDraft\(staffPerms\);/.test(sv));

ok('The combined dirty signal spans business draft + Demo Permissions draft + staff-permission draft',
  /const anyDirty = dirty \|\| demoPermsDirty \|\| staffPermsDirty;/.test(sv));

ok('Account-lifecycle actions (Make admin / Add staff / Remove admin / Remove staff) remain untouched atomic calls',
  /onAddAdmin\(newAdmin\)/.test(sv) && /onRemoveAdmin\(e\)/.test(sv) && /onAddStaff\(newStaff\)/.test(sv) && /onRemoveStaff\(email\)/.test(sv));

// ---- 2. setStaffPermission (InventoryDashboard.js): unchanged demo/isAdmin guard,
//    unchanged Firestore write shape, now returns true/false so the batched Save
//    above can tell success from failure without a second write path. -------------
const dash = read('components/InventoryDashboard.js');
ok('setStaffPermission keeps its exact original demo/isAdmin guard (unchanged authorization — see demo-isolation.test.cjs)',
  /async function setStaffPermission\(rawEmail, key, value\) \{\s*if \(demoMode \|\| !isAdmin\) \{ notify\.permissionDenied\('Not available in demo\.'\); return false; \}/.test(dash));
ok('setStaffPermission returns true on success and false on failure (additive — no existing caller read this before)',
  /await setDoc\(doc\(db, 'appSettings', 'roles'\), \{ staff: \{ \.\.\.staffPerms, \[email\]: \{ \.\.\.current, \[key\]: value \} \}, updatedAt: serverTimestamp\(\), updatedBy: user\?\.email \|\| '' \}, \{ merge: true \}\);\s*return true;/.test(dash)
  && /catch \(e\) \{ console\.error\('setStaffPermission failed:', e\); toast\.error\('Could not update permission\. Check Firestore rules\.'\); return false; \}/.test(dash));

// ---- 3. Behavioral: render the REAL SettingsView and drive the actual Demo
//    Permissions draft/Save/Cancel/toast/dirty lifecycle end to end. --------------
const React = require('react');
const { act } = require('react');
const { createRoot } = require('react-dom/client');
const SettingsView = require('../components/inventory/views/SettingsView.jsx').default;
const { LanguageProvider } = require('../lib/i18n.js');

try { localStorage.setItem('maruti_settings', JSON.stringify({})); } catch {}
try { localStorage.setItem('maruti_prefs', JSON.stringify({})); } catch {}
try { localStorage.setItem('maruti_demo_perms', JSON.stringify({ deleteInventory: false })); } catch {}
clearToasts();

const dirtyLog = [];
const setStaffPermCalls = [];
let setStaffPermReturn = true;
const onSetStaffPermMock = async (email, key, value) => {
  setStaffPermCalls.push({ email, key, value });
  return setStaffPermReturn;
};

const host = document.createElement('div');
document.body.appendChild(host);
let root;
let crashed = null;
try {
  act(() => {
    root = createRoot(host);
    root.render(React.createElement(LanguageProvider, null,
      React.createElement(SettingsView, {
        onDirtyChange: (d) => dirtyLog.push(d),
        totalRecords: 0, isAdmin: true, userEmail: 'admin@test.com', online: true,
        onBackup: () => {}, onRestore: () => {},
        admins: [], bootstrapAdmins: ['admin@test.com'],
        onAddAdmin: async () => true, onRemoveAdmin: async () => {},
        staffPerms: { 'staff@test.com': { costPrices: false, deletes: false, exports: false } },
        onAddStaff: async () => true, onRemoveStaff: async () => {},
        onSetStaffPerm: onSetStaffPermMock,
        recoveryMeta: null, onResetAllData: async () => true, onRestoreVault: async () => {},
        demoMode: false, demoAdmin: false, sidebarCollapsed: false, setSidebarCollapsed: () => {},
        lastBackup: null, lastSync: null,
      }),
    ));
  });
} catch (e) { crashed = e; }
ok('SettingsView renders without crashing', !crashed, crashed && crashed.message);

// ---- Demo Permissions lifecycle ---------------------------------------------------
act(() => {
  const demoTab = Array.from(host.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Demo Permissions');
  demoTab && demoTab.click();
});
const findToggle = (label) => Array.from(host.querySelectorAll('button[role="switch"]')).find((b) => {
  const row = b.closest('div')?.parentElement;
  return row && row.textContent.includes(label);
});
const deleteInventoryToggle = findToggle('Delete Inventory');
ok('Delete Inventory permission toggle is rendered', !!deleteInventoryToggle);

act(() => { deleteInventoryToggle.click(); });
ok('toggling a demo permission does NOT write to localStorage immediately',
  JSON.parse(localStorage.getItem('maruti_demo_perms') || '{}').deleteInventory !== true);
const unsavedBadge = host.textContent.includes('Unsaved');
ok('the draft/unsaved indicator becomes visible after toggling', unsavedBadge);
ok('onDirtyChange was called with true after toggling (navigation guard now covers Demo Permissions)',
  dirtyLog[dirtyLog.length - 1] === true);

// Cancel reverts.
act(() => {
  const cancelBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Cancel' && !b.disabled);
  cancelBtn && cancelBtn.click();
});
ok('Cancel reverted the toggle (still unchecked)',
  findToggle('Delete Inventory').getAttribute('aria-checked') === 'false');
ok('localStorage remains unchanged after Cancel (no write ever happened)',
  JSON.parse(localStorage.getItem('maruti_demo_perms') || '{}').deleteInventory !== true);
ok('onDirtyChange was called with false after Cancel', dirtyLog[dirtyLog.length - 1] === false);

// Toggle again and Save.
act(() => { findToggle('Delete Inventory').click(); });
clearToasts();
act(() => {
  const saveBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Save Changes' && !b.disabled);
  saveBtn && saveBtn.click();
});
ok('Save actually persisted the change to localStorage',
  JSON.parse(localStorage.getItem('maruti_demo_perms') || '{}').deleteInventory === true);
ok('Save produced exactly one success toast ("Demo permissions saved")',
  toasts.filter((t) => t.level === 'success' && /demo permissions saved/i.test(t.msg)).length === 1,
  JSON.stringify(toasts));
ok('onDirtyChange was called with false after Save (draft is clean again)', dirtyLog[dirtyLog.length - 1] === false);

// ---- Staff permission pills (Users & Roles) lifecycle — still on `host`, before
//    it gets unmounted for the reload-simulation check below. ---------------------
act(() => {
  const usersTab = Array.from(host.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Users & Roles');
  usersTab && usersTab.click();
});
const findPill = (label) => Array.from(host.querySelectorAll('button')).find((b) => b.textContent.trim().includes(label));
const costPricesPill = findPill('See cost prices');
ok('staff permission pill is rendered', !!costPricesPill);

act(() => { costPricesPill.click(); });
ok('clicking a staff permission pill does NOT call onSetStaffPerm immediately', setStaffPermCalls.length === 0);
ok('a pending-changes notice appears for the staff permission draft',
  host.textContent.includes('Unsaved permission changes'));

clearToasts();
act(() => {
  const saveBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Save Changes' && !b.disabled);
  saveBtn && saveBtn.click();
});
ok('Save committed exactly the changed permission via the existing onSetStaffPerm path',
  setStaffPermCalls.length === 1 && setStaffPermCalls[0].email === 'staff@test.com' && setStaffPermCalls[0].key === 'costPrices' && setStaffPermCalls[0].value === true);

// ---- Reload simulation: a fresh mount reads straight from localStorage, exactly
//    like a real browser refresh — proves the SAVED demo-permission value survives
//    and nothing unsaved leaks. Done last since it unmounts `host`'s root. ---------
act(() => { root.unmount(); });
const host2 = document.createElement('div');
document.body.appendChild(host2);
act(() => {
  createRoot(host2).render(React.createElement(LanguageProvider, null,
    React.createElement(SettingsView, {
      onDirtyChange: () => {}, totalRecords: 0, isAdmin: true, userEmail: 'admin@test.com', online: true,
      onBackup: () => {}, onRestore: () => {}, admins: [], bootstrapAdmins: ['admin@test.com'],
      onAddAdmin: async () => true, onRemoveAdmin: async () => {},
      staffPerms: {}, onAddStaff: async () => true, onRemoveStaff: async () => {},
      onSetStaffPerm: onSetStaffPermMock, recoveryMeta: null, onResetAllData: async () => true, onRestoreVault: async () => {},
      demoMode: false, demoAdmin: false, sidebarCollapsed: false, setSidebarCollapsed: () => {},
      lastBackup: null, lastSync: null,
    }),
  ));
});
act(() => {
  const demoTab = Array.from(host2.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Demo Permissions');
  demoTab && demoTab.click();
});
const reloadedToggle = Array.from(host2.querySelectorAll('button[role="switch"]')).find((b) => {
  const row = b.closest('div')?.parentElement;
  return row && row.textContent.includes('Delete Inventory');
});
ok('after a fresh mount (simulated reload), the SAVED permission value is what renders',
  reloadedToggle.getAttribute('aria-checked') === 'true');

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
