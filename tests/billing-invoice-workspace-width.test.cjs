/**
 * tests/billing-invoice-workspace-width.test.cjs
 *
 * BILLING → NEW INVOICE: FULL WORKSPACE WIDTH, LAYOUT GRID & ALIGNMENT ARCHITECTURE.
 *
 * InvoiceModal is a Portal-rendered full-screen overlay (`fixed inset-0 z-[120]`) —
 * architecturally OUTSIDE the app shell's <main> element, so it never inherited the
 * shell's SHELL_WIDTH_CLS workspace-width budget (see split-layout-width-budget.test.cjs).
 * It fell back to its own narrower, unrelated `max-w-6xl xl:max-w-7xl` modal-dialog
 * convention (~1152–1280px) — the wrong reference: a full editable workspace with a
 * form + summary grid isn't a compact dialog, it's a page, and should get the SAME
 * wide-canvas budget every other page gets.
 *
 * Fixing the width alone surfaced two further, genuine layout bugs, caught by live
 * measurement rather than assumption — both fixed at the shared-container/parent-grid
 * level, per this review's explicit prohibition on margin/transform/breakpoint hacks:
 *
 *   1. Header/content edge mismatch — the header bar used its own bare `px-4 sm:px-6`
 *      padding while the body used SHELL_WIDTH_CLS/mx-auto, so the title/buttons sat at
 *      a different horizontal boundary than the form content once the body was widened.
 *      Fixed by wrapping the header's inner content in the same SHELL_WIDTH_CLS/mx-auto
 *      box, mirroring InventoryDashboard.js's own account-bar pattern.
 *
 *   2. Sticky Invoice Summary detached almost immediately on scroll — the flex parent
 *      used `lg:items-start`, which shrinks the summary column's box to its own content
 *      height (~360px) instead of the form column's height. A `position: sticky` child
 *      can only stick within ITS OWN parent's box, so with a ~360px parent it released
 *      after ~100px of scroll on any invoice with real content. Fixed by switching to
 *      `lg:items-stretch` so the summary column's (invisible) box matches the form
 *      column's height, giving the sticky panel room to track the scroll — the standard
 *      sticky-sidebar shape. Purely a box-height change: the visible summary card's own
 *      height is unaffected, since its styling lives on the sticky child, not this parent.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const R = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nBilling New Invoice — full workspace width + header alignment + sticky-summary fix\n');

const bill = R('components/billing/BillingModule.jsx');

// --- Billing reaches the ONE shared workspace-width constant, not its own literal ---
ok('BillingModule imports SHELL_WIDTH_CLS from the shared constants file',
  /import \{ statusColor, SHELL_WIDTH_CLS, SEMANTIC \} from '\.\.\/\.\.\/constants\/ui';/.test(bill));
ok('the old narrower modal-dialog width (max-w-6xl xl:max-w-7xl) is gone from the invoice editor',
  !/max-w-6xl xl:max-w-7xl/.test(bill));
ok('the locked-invoice info banner uses the shared workspace width',
  /className=\{`mx-auto w-full \$\{SHELL_WIDTH_CLS\} px-4 sm:px-6 pt-4`\}/.test(bill));
ok('the main form+summary content wrapper uses the shared workspace width',
  /className=\{`mx-auto w-full \$\{SHELL_WIDTH_CLS\} p-4 sm:p-6 pb-32 sm:pb-28 lg:flex lg:gap-6 lg:items-stretch`\}/.test(bill));

// --- Bug 1: header content shares the same horizontal boundary as body content ---
ok('the header bar wraps its inner content in the same SHELL_WIDTH_CLS/mx-auto box as the body (not bare full-bleed padding)',
  /<div className=\{`\$\{SHELL_WIDTH_CLS\} mx-auto flex items-center justify-between`\}>/.test(bill));

// --- Bug 2: sticky Invoice Summary can actually track scroll, not just release at top ---
ok('the form/summary flex parent stretches its columns (lg:items-stretch), not lg:items-start',
  !/lg:flex lg:gap-6 lg:items-start/.test(bill));
ok('the Invoice Summary column keeps its own sticky/scroll behaviour unchanged (lg:sticky lg:top-4, capped height, own scroll)',
  /lg:sticky lg:top-4 lg:max-h-\[calc\(100vh-8rem\)\] lg:overflow-y-auto dark-scroll/.test(bill));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
