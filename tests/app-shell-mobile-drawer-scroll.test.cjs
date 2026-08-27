/**
 * tests/app-shell-mobile-drawer-scroll.test.cjs
 *
 * Root cause of "sidebar footer / branding scroll away together with the navigation
 * menu on mobile": the desktop <aside> (fixed left-0 top-0 bottom-0, no overflow of its
 * own) already isolates scrolling correctly — it renders the SAME `inner` JSX, where
 * only the <nav> itself is `flex-1 overflow-y-auto`, so branding above and the
 * footer (connection status / version / Collapse) below stay fixed while just the nav
 * list scrolls. The MOBILE drawer's <aside>, however, ALSO had `overflow-y-auto
 * dark-scroll` directly on itself — a second, OUTER scroll container wrapping the
 * entire `inner` (branding + nav + footer) on top of the nav's own already-correct
 * internal scroll. With two nested scrollers, scrolling anywhere over the branding or
 * footer area (outside the nav's own box, but still inside the outer one) scrolled the
 * whole drawer as one unit — reproducing the reported bug, but only on mobile/tablet
 * widths, since the desktop <aside> never had the extra overflow.
 *
 * Fix: removed `overflow-y-auto dark-scroll` from the mobile <aside> itself. `inner`'s
 * own flex/overflow structure (identical on both branches) is sufficient on its own —
 * verified live at 375px: after the fix, the outer <aside>'s scrollHeight equals its
 * clientHeight (no overflow of its own), while the inner <nav> has real scrollable
 * content (scrollHeight 873 vs clientHeight 600) and scrolling it leaves the branding's
 * and footer's on-screen positions completely unchanged.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');

console.log('\nApplication shell — mobile drawer scroll isolation (only nav scrolls)\n');

// Isolate the mobile drawer block and the desktop <aside> block.
const drawerStart = src.indexOf('{/* Mobile drawer */}');
const drawerEnd = src.indexOf('</div>\n      )}', drawerStart) + '</div>\n      )}'.length;
const drawerBlock = src.slice(drawerStart, drawerEnd);

const desktopAsideMatch = src.match(/<aside className="hidden md:block fixed left-0 top-0 bottom-0[^"]*"/);

ok('mobile drawer block found', drawerStart !== -1 && drawerEnd > drawerStart);
ok('desktop <aside> found (reference — already correct, must stay untouched)', !!desktopAsideMatch);

ok('desktop <aside> has no overflow of its own (only its inner <nav> scrolls)',
  desktopAsideMatch && !/overflow/.test(desktopAsideMatch[0]));

ok('mobile drawer <aside> no longer has overflow-y-auto on itself (was the second, outer scroll container)',
  /<aside className="absolute left-0 top-0 bottom-0"/.test(drawerBlock) &&
  !/<aside className="absolute left-0 top-0 bottom-0 overflow-y-auto/.test(drawerBlock));

ok('mobile drawer <aside> still renders the shared `inner` content (branding + nav + footer), unchanged',
  /<aside className="absolute left-0 top-0 bottom-0"[^>]*>\{inner\}<\/aside>/.test(drawerBlock));

ok('mobile drawer <aside> keeps its safe-area padding (unrelated to scroll, must survive the fix)',
  /paddingTop: 'env\(safe-area-inset-top\)', paddingBottom: 'env\(safe-area-inset-bottom\)'/.test(drawerBlock));

// The shared `inner` JSX (rendered identically by both desktop and mobile) is where the
// real, single source of scroll isolation lives — confirm it still isolates only <nav>.
const innerStart = src.indexOf('const inner = (\n    <div className="flex flex-col h-full"');
const innerEnd = src.indexOf('\n  );', innerStart);
const innerBlock = src.slice(innerStart, innerEnd);
ok('shared `inner` block found (consumed as {inner} by both desktop and mobile <aside>)',
  innerStart !== -1 && innerEnd > innerStart);
ok('shared `inner`: only <nav> is the scrollable region (flex-1 overflow-y-auto)',
  (innerBlock.match(/overflow-y-auto/g) || []).length === 1 &&
  /<nav className="flex-1 overflow-y-auto dark-scroll/.test(innerBlock));
ok('shared `inner`: branding (logo/shop name) sits above <nav>, outside its scroll region',
  innerBlock.indexOf('SRI BABA BALAJI') > -1 &&
  innerBlock.indexOf('SRI BABA BALAJI') < innerBlock.indexOf('<nav className="flex-1 overflow-y-auto'));
ok('shared `inner`: connection-status/version footer button sits below <nav>, outside its scroll region',
  innerBlock.indexOf('<nav className="flex-1 overflow-y-auto') < innerBlock.indexOf('APP_VERSION'));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
