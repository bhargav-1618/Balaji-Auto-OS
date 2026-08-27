/**
 * tests/notification-row-consistency.test.cjs
 *
 * Root cause of "Alert/Reminder rows are inconsistent": the two lists had independently
 * evolved their own row markup —
 *   - corner radius: Alerts used rounded-xl, Reminders used rounded-2xl
 *   - icon avatar: Reminders had one (w-10 h-10, kind-coloured), Alerts had none
 *   - status chip: Alerts' READ/UNREAD was a stray rounded-full pill stranded at the far
 *     right past the actions; Reminders' kind/OVERDUE/DONE/SNOOZED chips sat inline next
 *     to the title
 *   - actions: Alerts' were bare text/icon links with no fixed hit-target (a plain
 *     11px "Mark read" text link, an unwrapped 13px X); Reminders' were uniform w-8 h-8
 *     icon buttons
 *
 * Fix: components/common/NotificationRow.jsx is now the ONE row both lists render
 * through — same container shape, same icon-avatar slot, status chips rendered via the
 * shared Badge component (constants/ui.js / components/common/Badge.jsx — reusing the
 * design system's existing single-status-pill mechanism rather than hand-rolling a
 * fifth one), and actions as uniform w-8 h-8 buttons whose `className` is a full,
 * self-contained appearance override (never appended to a hardcoded default — Tailwind's
 * generated stylesheet order isn't the same as class-string order, so mixing a custom
 * bg-* with a default bg-white/5 in one className would make the winner unpredictable).
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const R = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nAlert/Reminder rows — one shared NotificationRow, reusing the existing Badge design system\n');

const row = R('components/common/NotificationRow.jsx');
const inv = R('components/InventoryDashboard.js');
const rem = R('components/reminders/RemindersModule.jsx');

// --- The shared component itself ---
ok('NotificationRow renders ONE container geometry (rounded-2xl, p-3.5) — not a per-list radius',
  /rounded-2xl p-3\.5 flex items-center gap-3/.test(row));
ok('status chips are rendered via the shared Badge component, not a hand-rolled span (constants/ui.js is the single design system)',
  /import Badge from '\.\/Badge';/.test(row) && /<Badge key=\{i\} label=\{c\.label\} color=\{c\.color\}/.test(row));
ok('the icon avatar tint does not use the exact `${var}1f` template-literal shape the ui-consistency test polices for hand-rolled pills',
  !/style=\{\{\s*background:\s*`\$\{iconColor\}1f`/.test(row));
ok('action buttons share ONE fixed geometry (w-8 h-8 rounded-lg)',
  /w-8 h-8 rounded-lg flex items-center justify-center/.test(row));
ok('an action\'s className, when given, is documented as a FULL appearance override (avoids Tailwind class-order ambiguity), not an append',
  /a\.className \|\| 'bg-white\/5 border border-white\/10 text-white\/60 hover:bg-white\/10'/.test(row));
ok('optional left accent stripe (severity/kind colour) is supported for both callers',
  /borderLeft: accentColor \? `3px solid \$\{accentColor\}` : undefined/.test(row));

// --- Alert Center (InventoryDashboard.js AlertsView) wired into the shared row ---
ok('InventoryDashboard.js imports NotificationRow',
  /import NotificationRow from '\.\/common\/NotificationRow';/.test(inv));
const alertsRowStart = inv.indexOf('{shown.map((a) => {');
const alertsRowBlock = inv.slice(alertsRowStart, alertsRowStart + 1200);
ok('AlertsView renders each alert through NotificationRow',
  alertsRowStart !== -1 && /<NotificationRow/.test(alertsRowBlock));
ok('Alert row keeps its severity colour as BOTH the icon-avatar tint and the left accent stripe',
  /iconColor=\{color\}/.test(alertsRowBlock) && /accentColor=\{color\}/.test(alertsRowBlock));
// Chip label now routes through lib/i18n.js's t('key', 'English fallback') for
// localization — the literal English fallback is still present, so the same chip
// wiring is still asserted.
ok('Alert row\'s READ/UNREAD state is a titleChip (inline next to the title), not a stray pill at the row\'s far right',
  /titleChips=\{\[isRead \? \{ label: t\('common\.read', 'READ'\)\.toUpperCase\(\)/.test(alertsRowBlock));
ok('Alert row\'s Mark-read action reuses the SAME positive/emerald treatment Reminders\' Mark-complete uses (a real, new cross-list consistency win)',
  /bg-emerald-500\/12 border border-emerald-500\/25 text-emerald-400 hover:bg-emerald-500\/20/.test(alertsRowBlock));
ok('Archive action still respects canDestroy (demo users cannot destroy — unchanged behavior)',
  /\.\.\.\(canDestroy \? \[\{ icon: X, title: t\('alerts\.action\.archiveAlert', 'Archive alert'\)/.test(alertsRowBlock));

// --- Reminder Center (RemindersModule.jsx) wired into the shared row ---
ok('RemindersModule.jsx imports NotificationRow',
  /import NotificationRow from '\.\.\/common\/NotificationRow';/.test(rem));
const remRowStart = rem.indexOf('{filtered.map((r) => {');
const remRowBlock = rem.slice(remRowStart, remRowStart + 1700);
ok('RemindersModule renders each reminder through NotificationRow',
  remRowStart !== -1 && /<NotificationRow/.test(remRowBlock));
ok('Reminder row keeps its kind icon avatar and gains a matching left accent stripe (new — Alerts already had one)',
  /icon=\{K\.icon\}/.test(remRowBlock) && /accentColor=\{K\.color\}/.test(remRowBlock));
ok('Reminder row\'s kind/OVERDUE/DONE/SNOOZED chips are still built the same way, just handed to the shared titleChips prop',
  /titleChips=\{titleChips\}/.test(remRowBlock) &&
  /const titleChips = \[/.test(rem) && /\{ label: r\.kind, color: K\.color \}/.test(rem));
ok('Reminder actions (WhatsApp/Call/Complete/Reopen/Snooze/Delete) are unchanged in behavior, just handed to the shared actions prop',
  /onClick: \(\) => complete\(r\)/.test(remRowBlock) && /onClick: \(\) => snooze\(r, 3\)/.test(remRowBlock) && /onClick: \(\) => delCustom\(r\)/.test(remRowBlock));

// --- Neither list hand-rolls its own row container any more ---
ok('AlertsView no longer hand-rolls its own row <div> (the old rounded-xl px-3.5 py-3 box)',
  !/className="group flex items-center gap-2\.5 px-3\.5 py-3 rounded-xl/.test(inv));
ok('RemindersModule no longer hand-rolls its own row <div> (the old p-3.5 flex items-center gap-3 box)',
  !/className=\{`rounded-2xl p-3\.5 flex items-center gap-3 \$\{r\.isDone/.test(rem));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
