/**
 * tests/login-layout.test.cjs
 *
 * Login layout architecture guards. The page kept breaking because spacing came from
 * stacked independent margins and the eye icon used a hardcoded pixel offset. These lock
 * the root-cause fixes: one gap-based spacing scale, unified widths, and true centering.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const css = fs.readFileSync(path.resolve(__dirname, '../styles/login.module.css'), 'utf8');
const page = fs.readFileSync(path.resolve(__dirname, '../pages/login.js'), 'utf8');

console.log('\nLogin layout — architecture (single spacing system, robust centering)\n');

// ── Regression guard: the console's content must NEVER be unreachably clipped ──────────
// globals.css locks html/body to `position:fixed; overflow:hidden` for the authenticated
// app shell's own scroll container (#app-scroll) — a real screenshot from a live browser
// caught this same lock silently swallowing the login page's demo button on any viewport
// shorter than the console's content, with no way to scroll at all. .scene must be its
// own fixed, viewport-sized frame with its own overflow-y:auto — never `overflow:hidden`,
// which would reintroduce the exact same unreachable-content bug.
ok('.scene is its own fixed, viewport-sized scroll container (position:fixed + inset:0)',
  /\.scene\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/.test(css));
ok('.scene scrolls vertically when its content is taller than the viewport (overflow-y: auto, never hidden)',
  /\.scene\s*\{[^}]*overflow-y:\s*auto/.test(css) && !/\.scene\s*\{[^}]*overflow:\s*hidden\s*;/.test(css));
ok('the photo/vignette/ignition-effects environment layer is pinned to the viewport independent of .scene\'s scroll (.heroFixed, position:fixed)',
  /\.heroFixed\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/.test(css));

// ── Issue 1/5: viewport-driven, deliberately edge-anchored (not plain center/center) ──
// The console floats over the photo's negative space — bottom on mobile (photo's darker
// lower band), right on desktop (photo's dark right two-thirds) — never dead-center on
// top of the vehicle. This is intentional, not a regression of the old centering guard.
ok('loginGrid is viewport-driven (min-height 100dvh)', /\.loginGrid\s*\{[^}]*min-height:\s*100dvh/.test(page));
ok('loginGrid anchors the console to the bottom on mobile (over the photo\'s lower band)',
  /\.loginGrid\s*\{[^}]*justify-content:\s*flex-end[^}]*align-items:\s*center/.test(page));
ok('loginGrid anchors the console to the right on desktop (over the photo\'s dark side, never on top of the vehicle)',
  /@media[^{]*\{\s*\.loginGrid\s*\{[^}]*justify-content:\s*center[^}]*align-items:\s*flex-end/.test(page));

// ── Issue 2/3/4/6/7: ONE spacing scale, no stacked margins ─────────────────
// (loginRight was renamed .console and moved into the CSS module when the login became a
// single floating console over a photo instead of a two-panel layout — same principle.)
ok('console is a flex column with a single gap', /\.console\s*\{[^}]*display:\s*flex[^}]*gap:\s*14px/.test(css));
ok('console owns the column width (max-width)', /\.console\s*\{[^}]*max-width:\s*400px/.test(css));
ok('demoWrap no longer has its own stacking margin-top',
  !/\.demoWrap\s*\{[^}]*margin:\s*16px/.test(css) && !/\.demoWrap\s*\{[^}]*margin-top/.test(css));
ok('demoWrap is a flex column with one gap', /\.demoWrap\s*\{[^}]*display:\s*flex[^}]*gap:\s*12px/.test(css));
ok('orRow no longer carries its own stacking margin', !/\.orRow\s*\{[^}]*margin:/.test(css));
ok('loginFooter no longer carries a stacking margin-top', !/\.loginFooter\s*\{[^}]*margin-top/.test(css));

// ── Issue 3: card sizes to content, shares the parent width ─────────────────
ok('card no longer forces its own max-width (parent owns width)', !/\.card\s*\{[^}]*max-width:\s*400px/.test(css));
ok('card has no fixed/min height (sizes to content)',
  !/\.card\s*\{[^}]*min-height/.test(css) && !/\.card\s*\{[^}]*[^-]height:\s*\d/.test(css));

// ── Eye icon: robust centering like the lock icon ──────────────────────────
ok('pwToggle centers vertically via top:50% + translateY(-50%) (not a pixel offset)',
  /\.pwToggle\s*\{[^}]*top:\s*50%[^}]*transform:\s*translateY\(-50%\)/.test(css));
ok('pwToggle no longer uses the hardcoded top:34px', !/\.pwToggle\s*\{[^}]*top:\s*34px/.test(css));
ok('the lock icon uses the same robust centering (parity)',
  /\.fieldIcon\s*\{[^}]*top:\s*50%[^}]*transform:\s*translateY\(-50%\)/.test(css));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
