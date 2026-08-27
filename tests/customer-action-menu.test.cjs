/**
 * tests/customer-action-menu.test.cjs
 *
 * Root cause: the three-dot action menu was a plain `position:absolute` <div> anchored
 * to the row's <td>. The desktop table wrapper is `overflow-x-auto` (needed so the table
 * can scroll horizontally on narrow screens) — any absolutely-positioned content that
 * overflows that wrapper's box gets clipped by it. The ~10-item menu (~360px tall) sitting
 * `top-10` below the trigger button extended well past the wrapper's bottom edge for any
 * row not near the very top, so it was clipped / rendered mixed in with table content
 * instead of floating above it — matching the reported overlap/clipping.
 *
 * Fix: reuse the same portalled DropdownPanel already used to fix this exact class of bug
 * in Add Part (TreeSelect/SupplierPicker) and Job Cards (MiniSelect/CustomerSearch),
 * instead of patching the old ad-hoc absolute positioning a third time.
 *
 * UNIVERSAL ISSUE U3 (overflow-menu unification) — superseded the DIRECT DropdownPanel
 * usage this test originally asserted. The three-dot menu now renders through the new
 * shared `components/common/ActionMenu.jsx`, which itself composes DropdownPanel for
 * positioning (so everything below about portalling/clipping/anchor-refs still holds —
 * ActionMenu didn't remove any of that, it just moved the item-row markup, keyboard nav,
 * and danger/disabled styling into one reusable place instead of every module hand-
 * rolling its own `<div role="menu">…map…</div>` body). See
 * tests/action-menu-unification.test.cjs for the new shared-component assertions.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/customers/CustomersModule.jsx'), 'utf8');

console.log('\nCustomers — three-dot action menu (shared ActionMenu, portalled via DropdownPanel)\n');

ok('CustomersModule imports the shared ActionMenu', /import ActionMenu from '\.\.\/common\/ActionMenu'/.test(src));
ok('the action menu is rendered through ActionMenu, not a raw absolute div or a hand-rolled DropdownPanel body',
  /<ActionMenu anchorRef=\{menuAnchorRef\(c\.id\)\} open onClose=\{\(\) => setMenuFor\(null\)\}/.test(src));
ok('no leftover ad-hoc absolute-positioned menu (the old `absolute right-2 top-10` pattern)',
  !/absolute right-2 top-10 z-30 w-48/.test(src));
ok('each row gets a stable, distinct anchor ref (not a shared/recreated-per-render object)',
  /menuAnchorRefs = useRef\(new Map\(\)\)/.test(src) && /menuAnchorRefs\.current\.set\(id, \{ current: null \}\)/.test(src));
ok('the old redundant global click-closer was removed (DropdownPanel now solely owns close)',
  !/document\.addEventListener\('click', onDoc\)/.test(src));
// role="menu"/"menuitem" a11y markup now lives ONCE inside ActionMenu.jsx itself (true
// for every caller by construction) rather than being asserted per-module — see
// tests/action-menu-unification.test.cjs.
ok('the trigger button exposes aria-expanded so assistive tech reflects open/closed state',
  /aria-haspopup="menu" aria-expanded=\{menuFor === c\.id\}/.test(src));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
