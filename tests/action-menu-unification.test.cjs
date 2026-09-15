/**
 * tests/action-menu-unification.test.cjs
 *
 * UNIVERSAL ISSUE U3 — the app had three genuinely different "three-dot" overflow-menu
 * implementations: Vehicles/Customers/JobCards/SupplierDirectory already shared
 * DropdownPanel for positioning but each hand-rolled its own item-row markup (drifting on
 * width/trigger-size/icon-size/text-size, no keyboard nav, no disabled/reason support);
 * Billing's RowActionsMenu was a fully independent reimplementation with its own Portal +
 * positioning math but the richest feature set (keyboard nav, sections, disabled+reason,
 * a single-open registry scoped only to itself); InventoryDashboard's "Actions ▼" menu was
 * hand-rolled and NOT portaled at all, exposed to the same ancestor stacking-context
 * clipping bug already portal-fixed elsewhere in this app.
 *
 * Fix: ONE shared components/common/ActionMenu.jsx, composing the app's existing
 * DropdownPanel positioning/portal primitive (kept content-agnostic, unchanged) and
 * adding — once — item rows (icon/label/danger/disabled+reason), section dividers,
 * keyboard arrow-nav + Enter-to-select (lifted from Billing's implementation, the most
 * complete of the three), and a single-open-at-a-time registry that now spans every
 * ActionMenu instance app-wide (previously each tier only enforced single-open within
 * its own module). Every call site's own business logic (what each item DOES) is
 * unchanged — only the shared rendering/positioning/keyboard mechanics moved here.
 *
 * Per-caller wiring (which items, which conditions, which handlers) is verified in each
 * module's own test file (tests/customer-action-menu.test.cjs, tests/billing-action-menu
 * .test.cjs, tests/supplier-polish.test.cjs, etc.) — this file verifies the shared
 * component's mechanics ONCE, true for every caller by construction.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const R = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nActionMenu — shared overflow-menu component (positioning, keyboard nav, sections, single-open)\n');

const menu = R('components/common/ActionMenu.jsx');

// --- Composes the existing positioning primitive, does not reimplement it ---
ok('ActionMenu exports a default component', /export default function ActionMenu\(/.test(menu));
ok('composes the shared DropdownPanel for positioning/portal (does not reimplement Portal/flip/clamp math)',
  /import DropdownPanel from '\.\/DropdownPanel'/.test(menu) && /<DropdownPanel anchorRef=\{anchorRef\}/.test(menu));
ok('no independent Portal/createPortal reimplementation inside ActionMenu itself',
  !/createPortal/.test(menu));

// --- Item rendering: sections + items, danger, disabled+reason ---
ok('renders section dividers with role="separator"', /it\.type === 'section'[\s\S]{0,150}role="separator"/.test(menu));
ok('renders items with role="menuitem"', /role="menuitem"/.test(menu));
ok('danger items get red styling', /it\.danger \? 'bg-red-500\/15 text-red-300'/.test(menu) && /it\.danger \? 'text-red-400/.test(menu));
ok('disabled items are non-interactive with a reason tooltip', /if \(it\.disabled\) return;/.test(menu) && /title=\{it\.disabled \? \(it\.reason \|\| 'Unavailable'\) : undefined\}/.test(menu));
ok('disabled+reason uses the app\'s amber advisory color (#fbbf24), not a dim/washed-out icon',
  /text-\[#fbbf24\]/.test(menu));
ok('disabled items carry aria-disabled for a11y', /aria-disabled=\{it\.disabled \? true : undefined\}/.test(menu));

// --- Keyboard nav (lifted from Billing's original, the most complete implementation) ---
ok('ArrowDown/ArrowUp move the highlight among enabled, non-section items only',
  /const navIdx = flat\.map/.test(menu) && /e\.key === 'ArrowDown'/.test(menu) && /e\.key === 'ArrowUp'/.test(menu));
ok('Enter activates the highlighted item (and closes first, matching mouse-click order)',
  /e\.key === 'Enter'/.test(menu) && /onClose\?\.\(\); it\.onClick\(\);/.test(menu));
ok('Escape is deliberately NOT re-handled here (DropdownPanel already owns it for every dropdown in the app)',
  !/e\.key === 'Escape'/.test(menu));
ok('keyboard highlight moves real DOM focus (Tab flows out naturally, no focus trap)',
  /querySelector\(`\[data-idx="\$\{hi\}"\]`\)\?\.focus\?\.\(\)/.test(menu));

// --- Single-open-at-a-time, now app-wide instead of per-module ---
ok('module-scope registry shared by every ActionMenu instance (not per-caller state)',
  /let activeToken = null;/.test(menu) && /let activeCloseFn = null;/.test(menu));
ok('opening a menu closes whichever other instance was previously open, synchronously',
  /if \(activeToken && activeToken !== token && activeCloseFn\) activeCloseFn\(\);/.test(menu));
ok('registry keyed by a stable per-instance token, not the caller\'s onClose reference (which is commonly a fresh closure every render)',
  /const tokenRef = useRef\(\{\}\);/.test(menu) && /const closeRef = useRef\(onClose\);/.test(menu));

// --- Falsy-entry filtering (preserves every call site's existing `cond && {...}` idiom) ---
ok('falsy items (from conditional inclusion) are filtered internally', /const flat = \(items \|\| \[\]\)\.filter\(Boolean\)/.test(menu));

// --- No per-caller visual-override escape hatch (className/style) — deliberate, so
// every menu keeps ONE visual language instead of reopening the drift this
// consolidation removed. boundaryRef/panelRef are kept as they're direct pass-
// throughs of DropdownPanel's own necessary positioning API, not new surface area. ---
ok('no className/style override props exist on ActionMenu (one enforced visual language, not a re-opened escape hatch)',
  !/className,\s*\n\s*style,/.test(menu) && !/\bclassName:\s*''/.test(menu));

// --- Every migrated call site actually uses it (all three tiers) ---
const callers = [
  ['components/vehicles/VehiclesModule.jsx', 'Vehicles'],
  ['components/customers/CustomersModule.jsx', 'Customers'],
  ['components/jobcards/JobCardModule.jsx', 'Job Cards'],
  ['components/inventory/SupplierDirectory.jsx', 'Supplier Directory'],
  ['components/billing/BillingModule.jsx', 'Billing'],
  ['components/InventoryDashboard.js', 'InventoryDashboard (header Actions menu)'],
];
callers.forEach(([file, name]) => {
  const src = R(file);
  ok(`${name} imports and uses the shared ActionMenu`,
    /import ActionMenu from '.*common\/ActionMenu'/.test(src) && /<ActionMenu /.test(src));
});

// --- Tier C specifically fixed a real bug, not just a style unification: the old
// "Actions ▼" menu was NOT portaled (a plain `absolute` div inside <main>'s own
// stacking context) and had a redundant manual backdrop div for outside-close. Both are
// gone now that it renders through ActionMenu/DropdownPanel. ---
const dash = R('components/InventoryDashboard.js');
ok('the old non-portaled `absolute right-0 mt-1.5 w-60` Actions menu div is gone',
  !/absolute right-0 mt-1\.5 w-60 z-\[56\]/.test(dash));
ok('the old redundant manual backdrop div (`fixed inset-0 z-[55]`) for outside-close is gone',
  !/fixed inset-0 z-\[55\]/.test(dash));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
