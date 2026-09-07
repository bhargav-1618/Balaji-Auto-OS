/**
 * tests/browser-viewport-integrity.test.cjs
 *
 * PHASE 27 — BROWSER COMPATIBILITY / VIEWPORT / MODAL INTEGRITY
 *
 * Stage 1 discovery found ONE defect, PH27-01 (HIGH):
 *
 *   The mobile full-screen forms in components/InventoryDashboard.js — the shared
 *   <MobileFormPage> (Receive Stock, Adjust Stock, Supplier) plus the hand-rolled
 *   `asPage` branches of <CheckoutModal> (Sell) and <PartModal> (Add / Edit Part) —
 *   rendered their content in a `min-h-screen flex flex-col` block in NORMAL
 *   DOCUMENT FLOW, on the stated assumption that "the BODY scrolls natively".
 *
 *   It does not. The application shell pins
 *       html, body { position: fixed; inset: 0; overflow: hidden; height: 100dvh }
 *   (styles/globals.css) so the document can NEVER be scrolled by touch or wheel,
 *   and these branches `return` BEFORE <main id="app-scroll">, so there is no shell
 *   scroll container in the tree either. Any form taller than the visible viewport
 *   — a short phone (375x667), the on-screen keyboard open, long validation text,
 *   or a draft / refresh-safety banner — had its lower half, INCLUDING required
 *   fields (New Part's Category & Vehicle), clipped below the fold with no way to
 *   reach it. `formValid` needs a category, so on a small phone a part could not be
 *   created at all: "Add Part" stayed disabled and nothing scrolled.
 *
 * Fix (Stage 2): each wrapper now mirrors the Customers / Vehicles / Billing
 * full-screen editors — capped to the dynamic viewport (`h-[100dvh] flex flex-col
 * overflow-hidden`) with the body in ONE real scroll region
 * (`flex-1 min-h-0 overflow-y-auto`). The `sticky bottom-0` action bars now pin to
 * that region instead of a document scroll that never existed.
 *
 * Browsers actually exercised in Stage 1 (recorded so the report cannot overclaim):
 *   - Chromium / Chrome 148 desktop  → responsive-emulation @ 375/390/667/768/1366/1920
 *   - Chrome mobile device emulation (Android UA, 5 touch points) @ 375x667, 375x812
 *   - NOT run: real Android Chrome, real iOS Safari, desktop Firefox, desktop Edge.
 *     Those rows are "responsive-emulation only" / "not tested" in the report.
 *
 * These assertions verify WIRING, not rendered pixels — the clip/scroll behaviour
 * itself was verified live in the browser pane (see PHASE_27 report). jsdom has no
 * layout engine, so the mechanism is proven here with a pure model + the shipped
 * source patterns that make that model's "after" case the one that ships.
 */
const fs = require('fs');
const path = require('path');

let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => {
  if (c) { PASS++; console.log(`  ✓ ${n}`); }
  else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

const dash = read('components/InventoryDashboard.js');
const css = read('styles/globals.css');
const cust = read('components/customers/CustomersModule.jsx');
const veh = read('components/vehicles/VehiclesModule.jsx');
const bill = read('components/billing/BillingModule.jsx');
const useIsMobile = read('hooks/useIsMobile.js');
const modalJs = read('components/Modal.js');

console.log('\nPhase 27 — browser / viewport / modal integrity (PH27-01)\n');

// ───────────────────────────────────────────────────────────────────────────
// 1. THE MECHANISM — a pure model of "is the content reachable?"
//
//    A full-screen form is usable on a phone iff, when its content is taller
//    than the visible viewport, SOME element in the chain can scroll to the
//    hidden part. There are exactly three ways that can be true:
//      (a) the document itself scrolls          — killed by the shell CSS
//      (b) a shell scroll container is an ancestor — absent on the `asPage` path
//      (c) the form provides its own scroll region — the fix
// ───────────────────────────────────────────────────────────────────────────
function resolveScroll({ rootHeightMode, innerScrollRegion, documentScrolls, contentPx, viewportPx }) {
  // rootHeightMode: 'grow'  → min-h-screen; height follows content, never caps
  //                 'cap'   → h-[100dvh] + overflow-hidden; height == viewport
  const rootPx = rootHeightMode === 'cap' ? viewportPx : Math.max(viewportPx, contentPx);
  let scrollOwner = 'none';
  if (documentScrolls) scrollOwner = 'document';
  else if (innerScrollRegion && rootHeightMode === 'cap') scrollOwner = 'inner';
  const overflowPx = Math.max(0, contentPx - viewportPx);
  const reachablePx = scrollOwner === 'none' ? Math.min(contentPx, rootPx, viewportPx) : contentPx;
  return { scrollOwner, overflowPx, reachablePx, fullyReachable: reachablePx >= contentPx };
}

// The app shell — measured live: body is position:fixed / overflow:hidden, and the
// asPage branch renders before <main id="app-scroll">.
const SHELL = { documentScrolls: false };
const TALL_FORM_ON_SE = { contentPx: 998, viewportPx: 667 }; // New Part step 1 @ 375x667, measured

// -- BEFORE the fix: min-h-screen, no inner scroll region -------------------
const before = resolveScroll({ rootHeightMode: 'grow', innerScrollRegion: false, ...SHELL, ...TALL_FORM_ON_SE });
ok('MODEL / before: a tall asPage form has NO scroll owner', before.scrollOwner === 'none', `got ${before.scrollOwner}`);
ok('MODEL / before: ~331px of the form is unreachable (Category + Vehicle below the fold)',
  before.overflowPx === 331 && before.fullyReachable === false);

// -- AFTER the fix: h-[100dvh] cap + inner overflow-y-auto -----------------
const after = resolveScroll({ rootHeightMode: 'cap', innerScrollRegion: true, ...SHELL, ...TALL_FORM_ON_SE });
ok('MODEL / after: the form body itself is the scroll owner', after.scrollOwner === 'inner');
ok('MODEL / after: 100% of the form content is reachable', after.fullyReachable === true && after.reachablePx === 998);

// -- the fix is NOT "let the document scroll" — the shell forbids it -------
const ifBodyScrolled = resolveScroll({ rootHeightMode: 'grow', innerScrollRegion: false, documentScrolls: true, ...TALL_FORM_ON_SE });
ok('MODEL / a hypothetical document scroll would also work — but the shell rules it out', ifBodyScrolled.fullyReachable === true);
ok('shell pins the document so body/native scroll is impossible (position:fixed + inset:0 + overflow:hidden on body)',
  /body\s*\{[\s\S]*?position: fixed;[\s\S]*?inset: 0;[\s\S]*?overflow: hidden;/.test(css));
ok('shell pins <html> the same way (overscroll-behavior:none on both)',
  (css.match(/overscroll-behavior: none;/g) || []).length >= 2 && /html\s*\{[\s\S]*?overflow: hidden;/.test(css));

// ───────────────────────────────────────────────────────────────────────────
// 2. PH27-01 — the BROKEN pattern must be GONE (regression guard)
// ───────────────────────────────────────────────────────────────────────────
ok('InventoryDashboard has NO `min-h-screen` className left (the un-scrollable root)',
  !/min-h-screen flex flex-col['"]/.test(dash), 'a className="min-h-screen ..." is still present');
ok('the misleading "the BODY scrolls natively" claim is no longer stated as fact',
  !/\* [^\n]*the BODY scrolls natively/i.test(dash) && /It does NOT|the app shell pins/.test(dash));
ok('the asPage comments now name the shell-pin as the reason a scroll region is needed',
  (dash.match(/PH27-01/g) || []).length >= 3
  && /position: fixed; (inset: 0; )?overflow: hidden; height: 100dvh/.test(dash));

// ───────────────────────────────────────────────────────────────────────────
// 3. PH27-01 — the SHIPPED fix, per wrapper
// ───────────────────────────────────────────────────────────────────────────

// -- <MobileFormPage> (Receive Stock / Adjust Stock / Supplier) -----------
const mfp = dash.slice(dash.indexOf('function MobileFormPage'), dash.indexOf('function MobileFormPage') + 2400);
ok('MobileFormPage root is viewport-capped, not min-h-screen',
  /return \(\s*<div className="h-\[100dvh\] flex flex-col overflow-hidden"/.test(mfp));
ok('MobileFormPage header is a non-shrinking flex row (flex-shrink-0), not sticky-in-a-non-scroller',
  /flex-shrink-0 flex items-center gap-2 px-3 py-3/.test(mfp) && !/sticky top-0 z-20/.test(mfp));
ok('MobileFormPage wraps {children} in ONE real scroll region',
  /<div className="flex-1 min-h-0 overflow-y-auto dark-scroll">\s*\{children\}\s*<\/div>/.test(mfp));

// -- <CheckoutModal> asPage (the Sell flow) --------------------------------
const co = dash.slice(dash.indexOf('function CheckoutModal'), dash.indexOf('function CheckoutModal') + 6000);
ok('CheckoutModal asPage root is viewport-capped',
  /asPage \? 'h-\[100dvh\] flex flex-col overflow-hidden'/.test(co));
ok('CheckoutModal asPage inner wrapper is a min-h-0 flex column (so the body can flex-scroll)',
  /asPage \? 'w-full flex-1 min-h-0 flex flex-col'/.test(co));
ok('CheckoutModal asPage header does not shrink; non-asPage keeps its sticky header',
  /asPage \? 'flex-shrink-0' : 'sticky top-0'/.test(co));
ok('CheckoutModal asPage body IS the scroll region ("Confirm Sale" reachable under banners / keyboard)',
  /asPage \? 'flex-1 min-h-0 overflow-y-auto dark-scroll p-5 space-y-4' : 'p-5 space-y-4'/.test(co));

// -- <PartModal> asPage (Add / Edit Part) ---------------------------------
// anchor on the render-branch marker (PartModal ALSO has an `if (asPage)` inside a
// useEffect far earlier — do not match that one).
const pmMark = dash.indexOf("{readOnly ? 'View Part' : isEdit ? 'Edit Part' : 'Add New Part'}");
const pmAsPage = dash.slice(pmMark - 900, pmMark + 400);
ok('PartModal asPage root is viewport-capped',
  /if \(asPage\) \{\s*return \(\s*<div className="h-\[100dvh\] flex flex-col overflow-hidden"/.test(pmAsPage)
  && !/min-h-screen/.test(pmAsPage));
ok('PartModal asPage header does not shrink',
  /flex-shrink-0 flex items-center gap-2 px-3 py-3/.test(pmAsPage));
ok('PartModal asPage wraps {bodyEl} in ONE real scroll region (Category / Vehicle now reachable)',
  /<div className="flex-1 min-h-0 overflow-y-auto dark-scroll">\s*\{bodyEl\}\s*<\/div>/.test(pmAsPage));
{
  const partForm = dash.slice(dash.indexOf('id="part-form"'), dash.indexOf('</form>', dash.indexOf('id="part-form"')));
  ok('PartModal asPage still keeps the form\'s own sticky bottom-0 Back/Next/Save bar (now pins to the scroll region)',
    /flex sm:hidden gap-3 pt-3 pb-1 mt-2 sticky bottom-0/.test(partForm));
}

// each fixed wrapper introduces EXACTLY ONE overflow-y-auto — never a nested pair
for (const [name, chunk] of [['MobileFormPage', mfp], ['PartModal asPage', pmAsPage]]) {
  const n = (chunk.match(/overflow-y-auto/g) || []).length;
  ok(`${name} declares a single scroll region (no nested scrollers)`, n === 1, `found ${n} overflow-y-auto`);
}
{
  // CheckoutModal: the asPage body className is the ONLY overflow-y-auto the branch adds
  const coAsPageScrollers = (co.match(/asPage \? 'flex-1 min-h-0 overflow-y-auto dark-scroll p-5 space-y-4'/g) || []).length;
  ok('CheckoutModal asPage declares a single scroll region (no nested scrollers)', coAsPageScrollers === 1);
}

// ───────────────────────────────────────────────────────────────────────────
// 4. PARITY — the fix is the pattern the rest of the app already uses
// ───────────────────────────────────────────────────────────────────────────
ok('Customers full-screen wizard already caps height + owns its scroll (flex-1 min-h-0 overflow-y-auto)',
  /h-\[100dvh\][\s\S]{0,120}flex flex-col/.test(cust) && /flex-1 min-h-0 overflow-y-auto/.test(cust));
ok('Vehicles full-screen wizard: same pattern',
  /h-\[100dvh\][\s\S]{0,140}flex flex-col/.test(veh) && /flex-1 (min-h-0 )?overflow-y-auto/.test(veh));
ok('Billing full-screen invoice editor: fixed-overlay + flex column + own scroll',
  /fixed inset-0 z-\[120\] flex flex-col/.test(bill) && /flex-1 min-h-0 overflow-y-auto/.test(bill));
ok('shared components/Modal.js already gives desktop dialogs a capped scroll body',
  /overflow-y-auto/.test(modalJs) && /(100dvh|visualViewport)/.test(modalJs));

// ───────────────────────────────────────────────────────────────────────────
// 5. RENDER-PATH — which viewport gets which shell
// ───────────────────────────────────────────────────────────────────────────
ok('useIsMobile breakpoint is 768 (Tailwind md) — < 768 => asPage, >= 768 => <Modal>',
  /useIsMobile\(breakpoint = 768\)/.test(useIsMobile) && /max-width: \$\{breakpoint - 1\}px/.test(useIsMobile));
ok('InventoryDashboard only takes the asPage branch under `if (isMobile)`',
  /if \(isMobile\) \{[\s\S]{0,4000}asPage/.test(dash));
ok('the >= 768 path for Add / Edit Part is the shared <Modal> (its own overflow-y-auto body)',
  /return \(\s*<Modal\s+onClose=\{onClose\}\s+title=\{readOnly \? 'View Part'/.test(dash));
ok('the >= 768 path for Sell keeps a plain non-scrolling body (short content, centred sm: dialog)',
  /asPage \? 'flex-1 min-h-0 overflow-y-auto dark-scroll p-5 space-y-4' : 'p-5 space-y-4'/.test(co));

// ───────────────────────────────────────────────────────────────────────────
// 6. NO horizontal-scroll / fixed-shell regressions from Phase "app-shell-fixed"
//    (still true — this phase changed only the mobile asPage forms)
// ───────────────────────────────────────────────────────────────────────────
ok('shell root still sized to the dynamic viewport (100dvh), non-scrolling flex column',
  /className=\{`relative overflow-hidden flex flex-col app-shell-bg/.test(dash)
  && /minHeight: '100dvh', maxHeight: '100dvh'/.test(dash));
ok('<main id="app-scroll"> is still the one shell scroll container',
  /<main id=\{APP_SCROLL_ID\} style=\{\{ overscrollBehavior: 'contain' \}\} className="relative z-10 flex-1 min-h-0 overflow-y-auto">/.test(dash));
ok('html, body still capped to max-width:100% (no horizontal page scroll)',
  /html, body \{ max-width: 100%; \}/.test(css));
ok('viewport meta allows user zoom (no maximum-scale / user-scalable=no lockout)',
  !/maximum-scale/.test(read('pages/_app.js')) && !/user-scalable/.test(read('pages/_app.js')));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
