// constants/ui.js
//
// ONE source of truth for the design tokens. Nothing here is new: every value is lifted
// from what the app already uses. The point is that it now exists in ONE place, so a
// status badge in Billing cannot drift away from the same badge in Job Cards.
//
// WHAT WAS INCONSISTENT (measured across components/):
//   control heights : h-7, h-8, h-9, h-10, h-11, h-12, h-14   (7 different scales)
//   border radii    : rounded-md, -lg, -xl, -2xl, -3xl, -full (6)
//   card padding    : p-2, p-2.5, p-3, p-3.5, p-4, p-5, p-6   (7)
//   status badges   : FOUR independent implementations —
//                       BillingModule.statusColor()   (inline hex)
//                       JobCardModule.STATUS_COLOR    (inline hex)
//                       VehiclesModule.expiryBadge()  (inline hex)
//                       InventoryDashboard.StatusBadge (Tailwind bg-red-500/15 …)
//                     …with different padding, radius and type size in each.
//
// The HEX VALUES already agreed (#f87171 danger, #fbbf24 warn, #34d399 ok, #9ca3af
// muted). So unifying them changes ZERO colours — only the box around them.

// ---------------------------------------------------------------------------
// Semantic palette. These are the exact values already in use — do not re-pick them.
// ---------------------------------------------------------------------------
export const SEMANTIC = {
  gold: '#d4af37',      // brand
  danger: '#f87171',
  warn: '#fbbf24',
  amber: '#f59e0b',
  ok: '#34d399',
  okAlt: '#4ade80',
  info: '#60a5fa',
  infoAlt: '#38bdf8',
  cyan: '#22d3ee',
  teal: '#2dd4bf',
  violet: '#a78bfa',
  indigo: '#818cf8',
  orange: '#fb923c',
  pink: '#f472b6',
  muted: '#9ca3af',
};

// ---------------------------------------------------------------------------
// Every status the app can display, in one map. Merged VERBATIM from the four
// implementations — every hex below is one the app already shipped.
//
// ⚠ ONE GENUINE CONFLICT had to be resolved, and it is a real (small) colour change:
//
//     'Cancelled'  was  #9ca3af (grey) in Billing
//                  and  #f87171 (RED)  in Job Cards
//
// The same word rendered two different colours on two pages. Consistency and
// "change no colours" cannot both hold here — one of them has to move. Resolved to
// GREY, because Cancelled is a VOID state and sits with Closed / Refunded / Returned,
// while red is reserved throughout the app for danger (Unpaid, Expired, Critical).
// Net effect: a cancelled JOB CARD is now grey instead of red. Nothing else changes.
// Say the word and I will flip it the other way — it is a one-line edit.
// ---------------------------------------------------------------------------
export const STATUS_COLOR = {
  // invoices / billing
  Draft: SEMANTIC.muted,
  Estimate: SEMANTIC.violet,
  'Estimate Sent': SEMANTIC.indigo,
  Invoice: SEMANTIC.info,
  Unpaid: SEMANTIC.danger,
  Pending: SEMANTIC.danger,
  'Partially Paid': SEMANTIC.warn,
  Partial: SEMANTIC.warn,
  Paid: SEMANTIC.ok,
  Cancelled: SEMANTIC.muted,   // ← the resolved conflict (was red in Job Cards)
  Refunded: SEMANTIC.orange,
  Returned: SEMANTIC.pink,

  // job cards
  Received: SEMANTIC.info,
  Inspection: SEMANTIC.infoAlt,
  'Estimate Ready': SEMANTIC.violet,
  'Estimate Approved': SEMANTIC.indigo,
  'Waiting Parts': SEMANTIC.warn,
  'Repair Started': SEMANTIC.orange,
  'Repair Paused': SEMANTIC.amber,
  'Quality Check': SEMANTIC.cyan,
  Wash: SEMANTIC.teal,
  Ready: SEMANTIC.ok,
  Delivered: SEMANTIC.okAlt,
  Closed: SEMANTIC.muted,

  // compliance / stock
  Valid: SEMANTIC.ok,
  Expired: SEMANTIC.danger,
  Expiring: SEMANTIC.warn,
  Active: SEMANTIC.ok,
  Inactive: SEMANTIC.muted,
  'In Stock': SEMANTIC.ok,
  'Low Stock': SEMANTIC.warn,
  Low: SEMANTIC.warn,
  Critical: SEMANTIC.danger,
  Out: SEMANTIC.danger,
  'Out of Stock': SEMANTIC.danger,
};

/** The colour for any status. Unknown statuses fall back to muted — never to nothing. */
export const statusColor = (s) => STATUS_COLOR[s] || SEMANTIC.muted;

// The real Job Card repair workflow, in order — moved here (not left duplicated
// between JobCardModule.jsx and lib/demoGarageSeed.js) because the demo seed
// generator had ALREADY drifted from it: it hardcoded its own stale status list
// including 'Work In Progress', a value that has never been part of this workflow,
// which silently zeroed out five real KPI buckets (Inspection/Waiting Parts/Repair/
// Quality Check/Cancelled) in every seeded dataset. One array, imported everywhere a
// job card status is validated against or generated from, closes that class of bug.
export const JOB_CARD_STATUSES = ['Received', 'Inspection', 'Estimate Ready', 'Estimate Approved', 'Waiting Parts', 'Repair Started', 'Repair Paused', 'Quality Check', 'Wash', 'Ready', 'Delivered', 'Closed', 'Cancelled'];
// Deliberately excluded from JOB_CARD_STATUSES — see JobCardModule.jsx's own comment
// on DRAFT_STATUS for why a draft must never be a workflow stage.
export const JOB_CARD_DRAFT_STATUS = 'Draft';

// ---------------------------------------------------------------------------
// Control tokens. Three heights, not seven.
// ---------------------------------------------------------------------------
export const CONTROL = {
  sm: 'h-8',    // dense table actions, chips
  md: 'h-9',    // in-card buttons
  lg: 'h-11',   // filter-bar controls: search, selects, Export, primary action
};

/** The filter bar. Every page's search / select / button must use these, so they line up. */
export const FILTER_INPUT = 'h-11 px-3 rounded-xl text-sm';
export const FILTER_SELECT = 'h-11 px-3 rounded-xl text-xs font-semibold';
export const FILTER_BTN = 'h-11 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5';

export const RADIUS = {
  control: 'rounded-xl',   // inputs, buttons
  card: 'rounded-2xl',     // cards, panels
  chip: 'rounded-lg',      // small inline chips
  pill: 'rounded-full',    // badges
};

/** Icon sizes. An icon inside a button is 14; a card icon is 18; a page header is 20. */
export const ICON = { chip: 12, btn: 14, row: 16, card: 18, header: 20 };

// ---------------------------------------------------------------------------
// New Invoice workspace-width review — SHELL_WIDTH_CLS was previously a LOCAL
// constant inside InventoryDashboard.js, used only by the app shell's own <main>
// wrapper and its two sticky header bars. Billing's full-screen invoice editor
// (a Portal-rendered overlay, so it never inherits <main>'s width at all) had no
// way to reach it and fell back to its own narrower, unrelated `max-w-6xl
// xl:max-w-7xl` modal-dialog convention — the wrong reference: a full editable
// workspace with a form + summary grid isn't a compact dialog, it's a page, and
// should use the SAME wide-canvas budget every other page gets. Promoted here so
// any full-screen view (present or future) reads the one real workspace-width
// standard instead of inventing its own.
// ---------------------------------------------------------------------------
/** The app's one workspace-width budget: full width until an ultrawide monitor
 *  would stretch lines uncomfortably, capped only then. NOT a "narrow form"
 *  width — see SettingsView (constrains its own inner column) for that case. */
export const SHELL_WIDTH_CLS = 'max-w-none 2xl:max-w-[1800px]';
