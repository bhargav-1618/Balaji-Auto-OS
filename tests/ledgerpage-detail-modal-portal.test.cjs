/**
 * tests/ledgerpage-detail-modal-portal.test.cjs
 *
 * Root cause of "the detail popup renders under the header" in Sales/Services/Stock
 * In/Stock Out: LedgerPage's detail modal (`{detail && (<div className="fixed
 * inset-0 z-[110] ...">`) rendered INLINE inside <main>, never as a portal. <main>
 * itself is `relative z-10` (established so page content sits above a decorative
 * z-0 background texture elsewhere in this file) — which means <main> creates its
 * OWN stacking context. A descendant's z-index (this modal's z-110) only wins
 * against something OUTSIDE that context if the CONTEXT ITSELF outranks it: the
 * real comparison happening was <main>'s z-10 vs. the sticky app header's z-30, not
 * 110 vs. 30 — <main> (10) loses, so everything inside it, including a z-110 modal,
 * painted underneath the header regardless of its own z-index. Confirmed live:
 * opening a Sales record showed the modal's own title bar and close button clipped
 * under the header, with no visible dimmed backdrop over the header/sidebar.
 *
 * Fixed by portaling the modal to document.body via createPortal — escaping
 * <main>'s stacking context entirely, the same fix DropdownPanel already uses for
 * the analogous "trapped by an ancestor" class of bug. LedgerPage is the SHARED
 * component behind Sales, Services, Stock In, and Stock Out, so this one fix covers
 * all four.
 *
 * Issue 7.7/7.8/7.9 (Stock Operations review) — the drawer was later extracted into
 * its own `LedgerDetailDrawer` component in components/common/LedgerPage.jsx so the
 * Inventory Stock tab and the per-part Movement History modal could reuse the same
 * portal fix instead of risking the same stacking-context bug a third and fourth
 * time. Only the source file this test reads changed; the fix itself did not.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const ledgerSrc = fs.readFileSync(path.resolve(__dirname, '../components/common/LedgerPage.jsx'), 'utf8');
const dashSrc = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');

console.log('\nLedgerPage detail modal — portaled to <body>, escapes <main>\'s stacking context\n');

ok('createPortal is imported from react-dom', /import \{ createPortal \} from 'react-dom'/.test(ledgerSrc));

const start = ledgerSrc.indexOf('export function LedgerDetailDrawer');
// Widened from 4000: aria-label/detail-suffix text now route through lib/i18n.js's
// t('key', 'English fallback') calls, pushing 'document.body,' further into the block.
const block = ledgerSrc.slice(start, start + 4400);
ok('the detail modal is portaled via createPortal (not rendered inline inside <main>)',
  /return createPortal\(/.test(block));
// Widened from 3400: aria-label/detail-suffix text now route through lib/i18n.js's
// t('key', 'English fallback') calls, adding length ahead of this same content.
ok('createPortal targets document.body',
  /return createPortal\(\s*\n\s*<div className="fixed inset-0 z-\[110\][\s\S]{0,3600}document\.body,/.test(block));
ok('the modal keeps its own backdrop, centering, and close-on-backdrop-click behavior (portaling only changes WHERE it mounts, not its own markup/behavior)',
  /style=\{\{ background: 'rgba\(0,0,0,0\.85\)', backdropFilter: 'blur\(6px\)' \}\} onClick=\{onClose\}/.test(block));
ok('LedgerPage is confirmed shared by Sales/Services/Stock In/Stock Out (one fix, four modules)',
  (dashSrc.match(/<LedgerPage/g) || []).length === 4);
ok('LedgerDetailDrawer is confirmed shared by the Inventory Stock tab + per-part Movement History too (one portal fix, six consumers total)',
  /<LedgerDetailDrawer /.test(dashSrc) && /<LedgerDetailDrawer /.test(fs.readFileSync(path.resolve(__dirname, '../components/inventory/InventoryStock.jsx'), 'utf8')));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
