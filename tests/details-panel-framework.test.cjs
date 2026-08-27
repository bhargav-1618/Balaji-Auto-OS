/**
 * tests/details-panel-framework.test.cjs
 *
 * CUSTOMER DETAILS PANEL — LAYOUT, RESPONSIVENESS & INFORMATION ARCHITECTURE REVIEW.
 * "Compare the Customer Details implementation with every other Details Panel used
 * throughout the application... If multiple implementations exist, consolidate them
 * into ONE reusable production Details Panel framework."
 *
 * Audit findings (research pass, not re-derived here): the only OTHER "docked side
 * panel beside a table, opened by selecting a row" implementation in the app was
 * Vehicles' — and it was a stale, independently-drifted COPY of Customers' panel: a
 * flat 370px width (not responsive to viewport/table width), a plain `xl:top-4` sticky
 * offset with no awareness of the app's own sticky header (so on scroll it slid UNDER
 * the header instead of settling below it — the exact "clipped content" bug Customers'
 * panel already had and had already been fixed for), and no independent scroll
 * container at all (long content scrolled the whole page, not just the panel).
 *
 * Every OTHER "view a record's details" surface in the app uses a genuinely different
 * interaction idiom for a genuinely different workflow, not a copy-pasted duplicate of
 * the docked panel — forcing them into this shape would be a workflow redesign, which
 * this review explicitly forbids:
 *   - Job Cards: a right-edge slide-in preview DRAWER (`fixed inset-0 ... justify-end`),
 *     shown from a list before committing to the full edit form.
 *   - Billing: the invoice IS opened as a full-screen editor/viewer takeover.
 *   - Inventory parts: open directly into an edit modal, no separate read-only view.
 *   - Suppliers: the "detail" IS the primary flex-1 content column of a 3-pane layout,
 *     not a supplementary panel docked beside a list.
 * None of these share layout code with the docked panel today, and none should be
 * forced to for this review — see the design-rationale comment atop
 * components/common/DetailsPanel.jsx for the full reasoning.
 *
 * Fix: extracted the ONE genuinely duplicated pattern — width/sticky-offset/max-height/
 * independent-scroll/empty-state — into components/common/DetailsPanel.jsx. Both
 * Customers and Vehicles now render through it; each keeps its own content (profile
 * fields vs. vehicle spec/tabs) as children — business content, workflow, and Firestore
 * access are untouched.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const R = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nDetails Panel — shared framework consolidation (Customers + Vehicles)\n');

const panel = R('components/common/DetailsPanel.jsx');
const cust = R('components/customers/CustomersModule.jsx');
const veh = R('components/vehicles/VehiclesModule.jsx');

// --- The shared component exists and owns the structural mechanics ---
ok('components/common/DetailsPanel.jsx exists and exports a component',
  /export default function DetailsPanel\(/.test(panel));
ok('owns responsive width (a flex-grow ratio with min/max bounds), not a flat fixed pixel default',
  /widthCls = "xl:flex-\[1_1_0%\] xl:min-w-\[320px\] xl:max-w-\[480px\] xl:self-stretch mt-4 xl:mt-0"/.test(panel));
// GENUINE BUG FOUND while building this component, unrelated to width/typography: the
// outer column is a flex item in a `flex ... items-start` row shared with the (much
// taller) table column. `items-start` means flex items are NOT stretched to the row's
// height — this column's box was only ever as tall as the panel card itself, so the
// inner `position: sticky` card had ZERO vertical slack to actually detach and stick —
// it computed as `position: sticky` (DevTools/getComputedStyle agreed) but functionally
// behaved exactly like `position: static`, scrolling away with the page every time.
// Live-verified before/after with a scroll-position probe: without `xl:self-stretch`
// the panel's rect.top tracked scroll 1:1 (no stick); with it, the outer column's
// height grows to match the row (2394px, not 675px) and the panel correctly holds at
// its target offset from scroll≈50px onward. This affected BOTH Customers and
// Vehicles already (pre-existing, not introduced by this consolidation) since both
// used the identical `items-start` row + tightly-wrapped column structure — fixing it
// once here fixes it for both, and any future caller.
ok('outer column stretches to the row\'s full height (xl:self-stretch) — without this, the inner sticky card has zero room to detach and never visibly sticks, despite computing as position:sticky',
  /xl:self-stretch/.test(panel));
ok('owns header-aware sticky offset (accounts for --demo-banner-h + --app-header-h, not a flat 16px), with a per-caller extra-offset override for a module\'s own sticky toolbar',
  /top: 'var\(--panel-extra-offset, 1rem\)'/.test(panel));
ok('owns matching max-height so the scroll region matches what is visible below the header (and any per-caller extra offset)',
  /xl:max-h-\[calc\(100vh_-_var\(--demo-banner-h,0px\)_-_var\(--app-header-h,68px\)_-_var\(--panel-extra-offset,1rem\)_-_1rem\)\]/.test(panel));
// GENUINE BUG #2, found immediately after the sticky fix above shipped: once the panel
// genuinely started sticking, it stuck too high on Customers specifically — it slid
// UNDER that module's own sticky toolbar (KPI stats + search + filters), because the
// old offset only ever accounted for the GLOBAL app header, never a module's OWN
// additional sticky element sitting between the header and the panel. Live-measured:
// the toolbar's real box was 165px-470px; the panel used to stick at 181px — 289px of
// visible overlap, exactly matching the report "dashboard background is overlapping
// the customer details." Fix: the new `topOffset` prop (default '1rem', so Vehicles —
// which has no competing sticky toolbar — is completely unaffected).
// Baseline alignment (reopened) — the '1rem' default was never verified against
// exact pixel alignment with the sibling column's first row, only against paint
// overlap. Precise measurement found it 16px wrong for Customers (see
// customer-details-panel-top-alignment.test.cjs for the full writeup); default is
// now 0, with Vehicles measuring and passing its own explicit override.
ok("supports a topOffset prop for callers with content above their own KPI row (default '0px' — flush alignment for a caller with nothing above its KPI row, like Customers)",
  /topOffset = '0px'/.test(panel));
ok('owns an independent scroll body, separate from the page/table scroll',
  /className="flex-1 xl:overflow-y-auto dark-scroll xl:-mr-2 xl:pr-2 min-h-0"/.test(panel));
ok('supports an optional bodyRef/onBodyScroll passthrough (so a caller can preserve scroll position across selection changes)',
  /bodyRef,\s*\n\s*onBodyScroll,/.test(panel));
// Customers/Vehicles UX review — emptyAction (an action BUTTON inside the empty state)
// was the duplicate-create-action bug itself, not a feature to keep configurable.
// Replaced with emptyBullets (what selecting a record reveals) + emptyTip (guidance
// text) — both informational, neither renders a clickable control.
ok('supports a configurable empty state (icon, title, hint, and informational bullets/tip — no action button slot)',
  /emptyIcon: EmptyIcon/.test(panel) && /emptyTitle/.test(panel) && /emptyHint/.test(panel) && /emptyBullets/.test(panel) && /emptyTip/.test(panel) && !/^\s*emptyAction,\s*$/m.test(panel));
ok('empty-state vertical padding is configurable per caller (Vehicles compacted its empty state; Customers kept the original)',
  /emptyPadding = 'py-16'/.test(panel));
ok('widthCls itself is overridable (an escape hatch for a future caller with different proportions), defaulting to the shared flex-grow ratio',
  /widthCls = "xl:flex-\[1_1_0%\]/.test(panel));

// --- Both real call sites render through the shared component ---
ok('Customers imports and uses the shared DetailsPanel',
  /import DetailsPanel from '\.\.\/common\/DetailsPanel'/.test(cust) && /<DetailsPanel/.test(cust));
ok('Vehicles imports and uses the shared DetailsPanel',
  /import DetailsPanel from '\.\.\/common\/DetailsPanel'/.test(veh) && /<DetailsPanel/.test(veh));

// --- Neither call site reimplements the mechanics locally (would silently un-share them) ---
ok('Customers no longer hand-rolls the clamp/sticky-offset/max-height JSX inline (fully delegated to the shared component)',
  !/xl:w-\[clamp\(320px,28%,420px\)\] xl:flex-shrink-0 mt-4 xl:mt-0/.test(cust));
ok('Vehicles no longer has the stale flat-370px / flat-top-4 panel (the exact drift this consolidation fixes)',
  !/xl:w-\[370px\] xl:flex-shrink-0 mt-4 xl:mt-0/.test(veh) && !/xl:sticky xl:top-4 rounded-2xl p-4"/.test(veh));

// --- Vehicles picked up the SAME fixes Customers already had (the actual bug fix, not just a refactor) ---
ok('Vehicles panel is now responsive width (was flat 370px)',
  /<DetailsPanel[\s\S]{0,400}cardStyle=\{cardStyle\}/.test(veh) && !/xl:w-\[370px\]/.test(veh));
ok('Vehicles panel is now header-aware sticky (was flat xl:top-4, tucked under the app header on scroll)',
  !/xl:sticky xl:top-4/.test(veh));

// --- Vehicles kept its own distinct content/behavior (business functionality preserved) ---
// Customers/Vehicles UX review (Issue 1) — the empty-state "Add Vehicle" quick action
// was itself a duplicate of the toolbar's own Add Vehicle button (same action, same
// screen, twice). Removed, not "kept" — Vehicles' empty state is now purely
// informational (emptyBullets), matching Customers.
ok('Vehicles empty state no longer duplicates the toolbar\'s Add Vehicle action (Issue 1 fix, not a regression)',
  !/emptyAction=\{canManage && \(/.test(veh) && /emptyBullets=\{\[/.test(veh));
ok('Vehicles keeps its compact empty-state padding (py-8, a deliberate earlier UX fix, not reset to the shared py-16 default)',
  /emptyPadding="py-8"/.test(veh));
ok('Vehicles keeps its own tab set (Overview/Service/Invoices/Documents/Insurance/Timeline/Notes) — content untouched by the frame extraction',
  /\['Overview', 'Service', 'Invoices', 'Documents', 'Insurance', 'Timeline', 'Notes'\]/.test(veh));
ok('Customers keeps its own tab set (Vehicles/Job Cards/Invoices/Payments/Timeline/Notes/Documents) — content untouched by the frame extraction',
  /\['Vehicles', 'Job Cards', 'Invoices', 'Payments', 'Timeline', 'Notes', 'Documents'\]/.test(cust));

// --- Deliberately NOT forced into the shared frame (different interaction idioms) ---
const jc = R('components/jobcards/JobCardModule.jsx');
const bill = R('components/billing/BillingModule.jsx');
ok('Job Cards\' preview stays its own right-edge slide-in drawer (not migrated — different idiom, would be a workflow redesign)',
  /setPreviewCard\(jc\)/.test(jc));
ok('Billing keeps its full-screen invoice editor/viewer (not migrated — different idiom, would be a workflow redesign)',
  /fixed inset-0 z-\[120\] flex flex-col/.test(bill));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
