/**
 * tests/module-modals-portaled.test.cjs
 *
 * Root cause (a recurring class in this repo): every module component renders
 * inside <main id="app-scroll">, which is `relative z-10` — its own stacking
 * context. An inline `fixed inset-0 z-[1xx]` overlay is therefore only ever
 * compared at <main>'s z-10, which LOSES to the demo banner (z-[90]) and the
 * mobile bottom-nav (z-[80]) that are siblings of <main>. On a phone the demo
 * banner covered a right-side drawer's header and the bottom-nav covered a
 * bottom-sheet's Cancel / primary-action footer — the primary button was not
 * even tappable (a tap at its centre hit the nav's Alerts button instead).
 *
 * Confirmed live on the deployed ?demo=1 build at 390x844:
 *   - Reminders  "Add Reminder"  — Cancel / Add Reminder hidden behind the nav
 *   - Inventory  "New PO"        — Cancel / Save Draft / Create PO behind the nav
 *   - Alerts     detail drawer   — header under the banner, footer under the nav
 *
 * Fix (same one already used for CustomerWizard, the Add-Vehicle modal, LedgerPage
 * and the Job Card preview drawer): portal the overlay to document.body so it
 * escapes <main>'s stacking context and its own z-index genuinely applies.
 *
 * NOTE: the Billing "View Timeline" sheet uses the same `fixed inset-0` +
 * `items-end` pattern but is NOT covered here — its only trigger lives in the
 * `hidden md:block` desktop table, so it can never be opened while the
 * `md:hidden` bottom-nav exists. No defect, left unchanged.
 */
const fs = require('fs');
const path = require('path');

let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const slice = (src, from, len) => { const i = src.indexOf(from); return i < 0 ? '' : src.slice(i, i + len); };

console.log('\nmodule modals / drawers — portaled to <body>, clear the mobile app chrome\n');

// ── Reminders: Add Reminder modal ─────────────────────────────────────────────
const rem = read('../components/reminders/RemindersModule.jsx');
const remBlock = slice(rem, 'function AddReminderModal', 5000);
ok('Reminders: createPortal imported from react-dom',
  /import \{ createPortal \} from 'react-dom'/.test(rem));
ok('Reminders: AddReminderModal returns createPortal(',
  /return createPortal\(\s*\n\s*<div className="fixed inset-0 z-\[130\]/.test(remBlock));
ok('Reminders: the portal target is document.body',
  /\n\s*document\.body,\s*\n\s*\);\s*\n\}/.test(remBlock));
ok('Reminders: the sheet keeps its backdrop + close-on-backdrop-click',
  /z-\[130\] flex items-end sm:items-center[^"]*"[^>]*onClick=\{onClose\}/.test(remBlock));
ok('Reminders: the Cancel + Add Reminder footer is still present',
  /Cancel<\/button>/.test(remBlock) && /Add Reminder<\/button>/.test(remBlock));

// ── Inventory Purchase Orders: New PO + Receive PO ────────────────────────────
const po = read('../components/inventory/InventoryPurchaseOrders.jsx');
ok('Purchase Orders: createPortal imported from react-dom',
  /import \{ createPortal \} from 'react-dom'/.test(po));
ok('Purchase Orders: BOTH forms portal to document.body (New PO + Receive PO)',
  (po.match(/return createPortal\(/g) || []).length >= 2 &&
  (po.match(/\n\s*document\.body,\s*\n\s*\);/g) || []).length >= 2);
ok('Purchase Orders: both sheets keep their sticky footers (New PO + Receive PO)',
  (po.match(/sticky bottom-0 flex gap-2/g) || []).length >= 2);
ok('Purchase Orders: New PO keeps its Cancel / Save Draft / Create PO buttons',
  /Cancel<\/button>/.test(po) && />Save Draft<\/button>/.test(po) && /'Create PO'\}<\/button>/.test(po));
ok('Purchase Orders: Receive PO keeps its Confirm Receipt button',
  /Receive \{po\.poNumber\}/.test(po) && /Confirm Receipt/.test(po));

// ── Alerts: alert-detail drawer (InventoryDashboard.js / AlertsView) ──────────
const dash = read('../components/InventoryDashboard.js');
const alertsBlock = slice(dash, 'function AlertsView', 30000);
ok('Alerts: the alert-detail drawer is portaled via createPortal to document.body',
  /\{drawer && typeof document !== 'undefined' && createPortal\(\(/.test(alertsBlock) &&
  /\), document\.body\)\}/.test(alertsBlock));
ok('Alerts: the drawer keeps its right-side overlay + close-on-backdrop-click',
  /<div className="fixed inset-0 z-\[120\] flex justify-end"[^>]*onClick=\{\(\) => setDrawer\(null\)\}/.test(alertsBlock));
ok('Alerts: the sticky Pin / Acknowledge / Resolve footer is still present',
  /sticky bottom-0/.test(alertsBlock) && /'Resolve'\)\}<\/button>/.test(alertsBlock) && /'Acknowledge'\)\}<\/button>/.test(alertsBlock));

// ── Billing: invoice Timeline sheet is deliberately NOT portaled ─────────────
const bill = read('../components/billing/BillingModule.jsx');
ok('Billing: the "View Timeline" trigger is desktop-only (hidden md:block) — no nav to hide it, so no portal needed',
  /<div className="overflow-x-auto hidden md:block">[\s\S]*?onClick: \(\) => setTimelineFor\(iv\)[\s\S]*?<div className="md:hidden divide-y/.test(bill) &&
  !/md:hidden divide-y[\s\S]{0,1500}setTimelineFor/.test(bill));

// ── the shared root cause is still real (guard against a future regression) ───
ok('<main> is still a stacking context (relative z-10) — the reason these need portals',
  /<main id=\{APP_SCROLL_ID\}[^>]*className="relative z-10/.test(dash));
ok('the mobile bottom-nav (z-[80]) and demo banner (z-[90]) still sit OUTSIDE <main>',
  /md:hidden fixed bottom-0 left-0 right-0 z-\[80\]/.test(dash) &&
  /className="flex-none flex items-center justify-center[\s\S]{0,80}z-\[90\]"/.test(dash));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
