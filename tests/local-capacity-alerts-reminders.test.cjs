/**
 * tests/local-capacity-alerts-reminders.test.cjs
 *
 * UNIVERSAL ISSUE — 5,000 RECORD CAPACITY, EXTENDED TO ALERTS & REMINDERS.
 *
 * Alerts and Reminders were investigated (see services/localCapacityService.js's own
 * header) and found NOT to be Firestore collections at all — both are computed live on
 * every render from other app state, with only small localStorage id/entry sets actually
 * persisted. This suite verifies the "right-sized" local-capacity engine built for them:
 * same 5,000/4,500 policy numbers (reused from constants/capacity.js, not reinvented),
 * same warning/cleanup UX language, honest single-method cleanup (nothing to "archive" or
 * "export" for a bookkeeping entry), and — the critical safety property — active/unresolved
 * records are structurally impossible to select for cleanup regardless of age.
 *
 * Source-pattern assertions, matching this repo's established convention for the
 * Firestore capacity suite (tests/capacity-management.test.cjs).
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const R = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nLocal (non-Firestore) capacity management — Alerts & Reminders\n');

const svc = R('services/localCapacityService.js');
const banner = R('components/common/LocalCapacityBanner.jsx');
const inv = R('components/InventoryDashboard.js');
const rem = R('components/reminders/RemindersModule.jsx');

// --- Part 1: the engine reuses the SAME policy numbers, does not reinvent them ---
ok('getLocalCapacityStatus imports CAPACITY_LIMIT/CAPACITY_WARNING_THRESHOLD from constants/capacity.js rather than redefining 5000/4500',
  /import \{ CAPACITY_LIMIT, CAPACITY_WARNING_THRESHOLD, CLEANUP_BATCH_SIZE \} from '\.\.\/constants\/capacity';/.test(svc));
ok('getLocalCapacityStatus returns the same shape as the Firestore engine\'s getCapacityStatus (count/limit/remaining/atWarning/atLimit)',
  /atWarning: count >= CAPACITY_WARNING_THRESHOLD && count < CAPACITY_LIMIT,/.test(svc) &&
  /atLimit: count >= CAPACITY_LIMIT,/.test(svc));
ok('getLocalCleanupPreview batches at the same CLEANUP_BATCH_SIZE (1,000), oldest-first',
  /const sorted = \[\.\.\.eligibleAll\]\.sort\(\(a, b\) => \(a\.at\?\.getTime\(\) \?\? 0\) - \(b\.at\?\.getTime\(\) \?\? 0\)\);/.test(svc) &&
  /const eligible = sorted\.slice\(0, batchSize\);/.test(svc));
ok('eligibility is decided entirely by the CALLER (module-specific business rule), never guessed by the shared engine itself',
  /entries\.filter\(\(e\) => e\.eligible\)/.test(svc) && !/function checkEligibility/.test(svc));

// --- Part 2: the shared local banner offers exactly ONE honest method, not a fake 3-choice wizard ---
ok('LocalCapacityCleanupModal has no method-choice step — nothing to Archive or Export for a bookkeeping entry',
  !/step === 'choose'/.test(banner) && /step === 'preview'/.test(banner));
ok('the banner never renders below the warning threshold (same non-spam rule as the Firestore banner)',
  /if \(!status\.atWarning && !status\.atLimit\) return null;/.test(banner));
ok('a warning dismissal is remembered per 100-record band (same anti-spam mechanism, its own sessionStorage namespace)',
  /const dismissKey = \(moduleKey, band\) => `capacity_dismiss_local_\$\{moduleKey\}_\$\{band\}`;/.test(banner));
ok('canManage=false hides the destructive action but keeps the informational banner visible (permission-aware, not permission-blind)',
  /canManage && \(/.test(banner) && /Ask an admin to clear stale entries\./.test(banner));
ok('the preview is rebuilt fresh every time the modal opens (via an effect keyed on `open`), not computed once on mount — a stale preview could show a count that no longer matches reality',
  /useEffect\(\(\) => \{[\s\S]{0,50}if \(!open\)[\s\S]{0,400}setPreview\(getLocalCleanupPreview\(entries\)\);/.test(banner) &&
  /\}, \[open\]\);/.test(banner));

// --- Part 3: Alerts — eligibility is "no longer a live alert", never array age alone ---
ok('read/archived alert entries now carry a real timestamp (at), not just a bare id — needed to order oldest-first',
  /const \[readAlertEntries, setReadAlertEntries\] = useState\(\[\]\); \/\/ \[\{id, at\}\]/.test(inv) &&
  /const \[archivedAlertEntries, setArchivedAlertEntries\] = useState\(\[\]\); \/\/ \[\{id, at\}\]/.test(inv));
ok('readAlerts/archivedAlerts stay derived Sets (same .has() API every existing consumer already uses) — AlertsView itself needed zero changes',
  /const readAlerts = useMemo\(\(\) => new Set\(readAlertEntries\.map\(\(e\) => e\.id\)\), \[readAlertEntries\]\);/.test(inv) &&
  /const archivedAlerts = useMemo\(\(\) => new Set\(archivedAlertEntries\.map\(\(e\) => e\.id\)\), \[archivedAlertEntries\]\);/.test(inv));
ok('old plain-string-array localStorage data is normalized on load (backward compatible with pre-rollout data), not discarded',
  /const normalizeAlertEntries = \(raw\) => \{/.test(inv) &&
  /typeof x === 'string' \? \{ id: x, at: null \}/.test(inv));
ok('an alert entry is eligible ONLY if its id is no longer in the CURRENT live computeAlerts() output — an active/unresolved alert can never be selected regardless of entry age',
  /eligible: !liveAlertIds\.has\(e\.id\),/.test(inv) &&
  /const liveAlertIds = useMemo\(\(\) => new Set\(allAlerts\.map\(\(a\) => a\.id\)\), \[allAlerts\]\);/.test(inv));
ok('cleanup prunes from BOTH the read and archived entry stores by id, and re-persists both (never just one, which would let a pruned id silently reappear from the other store)',
  /const nextRead = readAlertEntries\.filter\(\(e\) => !ids\.has\(e\.id\)\);/.test(inv) &&
  /const nextArchived = archivedAlertEntries\.filter\(\(e\) => !ids\.has\(e\.id\)\);/.test(inv) &&
  /persistAlertEntries\(ALERT_READ_KEY, nextRead\);/.test(inv) &&
  /persistAlertEntries\(ALERT_ARCHIVED_KEY, nextArchived\);/.test(inv));
// Settings QA finding: 'maruti_read_alerts'/'maruti_archived_alerts' were NOT
// demo-isolated — a Demo/Demo Admin session's read/archived alert entries wrote
// into the same keys a real Production admin's browser also uses (every other
// per-mode store in this app, e.g. SETTINGS_KEY, already branches on demoMode).
ok('read/archived alert storage keys are demo-isolated, matching SETTINGS_KEY\'s existing pattern',
  /const ALERT_READ_KEY = demoMode \? 'maruti_read_alerts_demo' : 'maruti_read_alerts';/.test(inv) &&
  /const ALERT_ARCHIVED_KEY = demoMode \? 'maruti_archived_alerts_demo' : 'maruti_archived_alerts';/.test(inv));
// "Reset Demo Alerts" reset the data alerts are computed from but never touched
// read/archived state, so anything already marked read stayed read after a
// "reset" — the button's own description ("restore the original seeded demo
// dataset") didn't hold.
ok('resetDemoScope also clears demo read/archived alert-tracking state for the alerts/all scopes',
  /if \(scope === 'all' \|\| scope === 'alerts'\) \{\s*\n\s*setReadAlertEntries\(\[\]\);\s*\n\s*setArchivedAlertEntries\(\[\]\);/.test(inv));
ok('cleanup uses pushAudit (the dual-mode demo/production helper), never writeAudit (which is hardcoded to write straight to production Firestore with no demo branch at all)',
  /pushAudit\(\{ action: 'capacity_delete', entity: 'Alerts',/.test(inv));
ok('AlertsView wires the banner through with canManage tied to the SAME canDestroy permission already used for the archive-alert action (no new, weaker permission surface introduced)',
  /capacityStatus, capacityGetEntries, capacityOnConfirm, onCapacityCleanup \}\) \{/.test(inv) &&
  /canManage=\{canDestroy\}/.test(inv));

// --- Part 4: Reminders — eligibility is "done", never creation age alone (must survive a
// reminder created in January with a December due date — the brief's own example) ---
ok('reminder capacity entries are derived from `custom` only — "auto" reminders are never persisted at all, so there is nothing there to manage',
  /const reminderCapacityEntries = useMemo\(\(\) => custom\.map\(\(r\) => \{/.test(rem));
ok('eligibility is `done.has(r.id)` — completion status, never creation timestamp — so a not-yet-done reminder is structurally impossible to select no matter how old',
  /eligible: done\.has\(r\.id\) \};/.test(rem));
ok('creation time is derived from the EXISTING custom-<ms> id format (no new field, no migration) — addCustom already stamps it this way',
  /const ms = Number\(String\(r\.id\)\.split\('-'\)\[1\]\);/.test(rem) &&
  /id: `custom-\$\{Date\.now\(\)\}`/.test(rem));
ok('cleanup removes the pruned ids from custom AND scrubs them out of done/snoozed together (no orphaned bookkeeping left behind for a reminder that no longer exists)',
  /const nextCustom = custom\.filter\(\(r\) => !ids\.has\(r\.id\)\);/.test(rem) &&
  /const nextDone = new Set\(\[\.\.\.done\]\.filter\(\(id\) => !ids\.has\(id\)\)\);/.test(rem) &&
  /const nextSnoozed = Object\.fromEntries\(Object\.entries\(snoozed\)\.filter\(\(\[id\]\) => !ids\.has\(id\)\)\);/.test(rem));
ok('RemindersModule stays decoupled from Firestore/pushAudit specifics — it takes an onAudit callback prop rather than importing an audit helper directly',
  /export default function RemindersModule\(\{[\s\S]{0,200}onAudit \}\) \{/.test(rem) &&
  /onAudit\?\.\(\{ action: 'capacity_delete', entity: 'Reminders',/.test(rem));
ok('InventoryDashboard wires RemindersModule\'s onAudit to the SAME pushAudit used everywhere else (one audit trail, not a second parallel one)',
  /<RemindersModule[\s\S]{0,200}onAudit=\{pushAudit\}/.test(inv));
ok('the cleanup method\'s own copy explicitly states future/overdue-unresolved reminders are never touched (documents the protection the eligibility rule already enforces)',
  /Active, overdue-but-unresolved, and future reminders are never touched, no matter how long ago they were created\./.test(rem));

// --- Part 5: both modules stay demo-mode-safe with the SAME gating convention already
// established for their existing destructive actions (delCustom / archiveAlert) ---
ok('Reminders capacity cleanup is gated the same way the pre-existing delCustom is (fully disabled in demo mode, not partially)',
  /canManage=\{!demoMode\}/.test(rem));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
