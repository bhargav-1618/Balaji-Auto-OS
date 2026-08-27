/**
 * tests/app-shell-fixed.test.cjs
 *
 * 1. DETAILS PANELS — Vehicles and Customers render the SAME hero component AND pass the
 *    SAME empty-state props. The panels previously diverged not in the hero markup (which
 *    was already identical) but in the props: Customers fell back to the default py-16
 *    with no action button, which is what rendered as a large empty dark block.
 *
 * 2. APPLICATION SHELL — scroll ownership. The document must not scroll at all; the shell
 *    is a viewport-height, overflow-hidden flex column, and the ONLY scroll container is
 *    <main id="app-scroll">. That is what makes the banner/header/sidebar/status bar
 *    immovable: they are outside the scrolling element, so no positioning trick is needed.
 *
 * NOTE: these verify wiring, not rendered pixels — the rendered result needs a browser.
 */
const fs = require('fs');
const path = require('path');

let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

const hero = read('components/common/DetailHero.jsx');
const veh = read('components/vehicles/VehiclesModule.jsx');
const cust = read('components/customers/CustomersModule.jsx');
const dash = read('components/InventoryDashboard.js');
const css = read('styles/globals.css');
const appScroll = read('lib/appScroll.js');
const modal = read('components/Modal.js');

console.log('\nShared details hero + scroll-owning application shell\n');

// ── 1. Shared hero + matching empty-state props ──────────────────────────────
ok('DetailHero is the one hero implementation', /export default function DetailHero/.test(hero));
ok('Vehicles renders the shared hero', /<DetailHero icon=\{Car\}/.test(veh));
ok('Customers renders the shared hero', /<DetailHero icon=\{Users\}/.test(cust));
const heroCopy = /w-full h-36 rounded-xl flex items-center justify-center mb-2/;
ok('neither module keeps a private hero copy', !heroCopy.test(veh) && !heroCopy.test(cust));

// Customers/Vehicles UX review — emptyAction (a "+ New X" button rendered INSIDE the
// empty detail panel) was itself a bug, not a fix to preserve: the exact same "create
// new record" action already lives in the page toolbar, so the empty panel showed it
// TWICE with no hierarchy between the copies. Replaced with emptyBullets (what
// selecting a record reveals) + emptyTip (guidance text) — informational, not a second
// action hub. py-8 (vs the framework's py-16 default) still stays matched between the
// two modules; only the action-button half of the old assertion changes.
ok('Vehicles empty state uses py-8 + informational bullets, NOT a duplicate action button', /emptyPadding="py-8"/.test(veh) && /emptyBullets=\{\[/.test(veh) && !/emptyAction=\{canManage/.test(veh));
ok('Customers empty state matches it (py-8 + bullets, not the default py-16 void, and no duplicate create button)',
  /emptyPadding="py-8"/.test(cust) && /emptyBullets=\{\[/.test(cust) && !/emptyAction=\{canManage/.test(cust));
ok('the New Customer action lives ONLY in the toolbar (the module\'s real new-customer setter is not duplicated into the empty panel)', /setEditCust\(emptyCustomer\(\)\)/.test(cust) && (cust.match(/setEditCust\(emptyCustomer\(\)\)/g) || []).length === 1);
ok('Customers KPIs/toolbar have NO opaque page-level bg wrapper (matches Vehicles, no black block behind the dashboard)',
  !/background: 'rgba\(10,10,10,0\.75\)'/.test(cust));
ok('the shop-title + Connected/last-synced status block was removed from the shell header',
  !/text-lg sm:text-xl font-bold bg-gradient-to-r from-\[#d4af37\] to-\[#aa801e\] bg-clip-text text-transparent/.test(dash)
  && !/'Auto Parts & Service' : activeTab === 'inventory' \? 'Inventory Dashboard'/.test(dash));
ok('Actions control sits beside Logout in the account bar (Actions button appears just before the Logout button)',
  /Global Actions menu — lives beside Logout in the shared account bar/.test(dash)
  && /Actions<\/span>[\s\S]{0,3500}setShowLogoutConfirm\(true\)/.test(dash));
ok('Actions no longer rendered as a separate bordered header card',
  !/px-3 sm:px-4 py-2\.5 rounded-xl text-sm font-semibold transition active:scale-95 text-white\/80 bg-white\/5 border border-white\/15/.test(dash));

// ── 2. Scroll ownership ──────────────────────────────────────────────────────
ok('overscroll-behavior:none appears on both html and body (kills rubber-band + chaining)',
  (css.match(/overscroll-behavior: none;/g) || []).length >= 2);
ok('body is pinned (position:fixed + inset:0) so there is no document overflow to rubber-band',
  /position: fixed;/.test(css) && /inset: 0;/.test(css) && /overflow: hidden;/.test(css));
ok('shell height uses dynamic viewport units (100dvh), not just 100vh',
  /height: 100dvh;/.test(css));
ok('no overflow-x:clip rule re-enables a document scroll context', !/overflow-x: clip/.test(css));

ok('shell root is a non-scrolling flex column sized to the dynamic viewport (100dvh)',
  /className=\{`relative overflow-hidden flex flex-col app-shell-bg/.test(dash)
  && /minHeight: '100dvh', maxHeight: '100dvh'/.test(dash));
ok('demo banner is an in-flow, non-shrinking shell row', /className="flex-none flex items-center justify-center gap-3 px-4 py-2 text-center z-\[90\]"/.test(dash));
ok('header block is an in-flow, non-shrinking shell row', /className="flex-none z-30 backdrop-blur-md"/.test(dash));
ok('banner/header no longer rely on sticky or fixed positioning',
  !/className="sticky top-0 z-\[90\]/.test(dash) && !/className=\{`fixed left-0 right-0 \$\{sidebarCollapsed/.test(dash));

// Width-architecture migration (U1/U2): <main> now owns ONLY scrolling (a plain string
// className, no more activeTab-conditional template literal) — width-capping/centering
// moved to a separate, non-scrolling inner <div> (see split-layout-width-budget.test.cjs
// for that assertion). <main> remaining the one true scroll container, with its own
// overscroll containment, still holds — just via a simpler className now.
ok('<main> is the single scroll container and contains its own overscroll',
  /<main id=\{APP_SCROLL_ID\} style=\{\{ overscrollBehavior: 'contain' \}\} className="relative z-10 flex-1 min-h-0 overflow-y-auto">/.test(dash));
ok('desktop sidebar stays fixed full-height', /fixed left-0 top-0 bottom-0 z-50/.test(dash));

// ── 3. Everything that scrolled the window now scrolls the container ─────────
ok('appScroll helper exists', /export const APP_SCROLL_ID = 'app-scroll'/.test(appScroll) && /export function appScrollTo/.test(appScroll));
ok('no window.scrollTo/scrollY left in the dashboard', !/window\.scrollTo|window\.scrollY/.test(dash));
ok('no window.scrollTo/scrollY left in Customers', !/window\.scrollTo|window\.scrollY/.test(cust));
ok('no window.scrollTo/scrollY left in Vehicles', !/window\.scrollTo|window\.scrollY/.test(veh));
ok('back-to-top and scroll memory use the container', /appScrollTo\(\{ top: 0, behavior: 'smooth' \}\)/.test(dash) && /appScrollY\(\)/.test(dash));

ok('modal lock freezes the scroll container', /const sc = getAppScroller\(\);[\s\S]{0,120}sc\.style\.overflow = 'hidden'/.test(modal));
ok('modal lock still falls back to the body pin when no shell is mounted (login page)',
  /Fall back to the classic body pin/.test(modal) && /b\.style\.position = 'fixed'/.test(modal));

// The measured vars other code still reads must keep being published.
ok('--demo-banner-h still measured', /setProperty\('--demo-banner-h', `\$\{el\.offsetHeight\}px`\)/.test(dash));
ok('--app-header-h still measured', /setProperty\('--app-header-h', `\$\{el\.offsetHeight\}px`\)/.test(dash));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
