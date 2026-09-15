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

// ── Issue 1/5: viewport-driven, centered ───────────────────────────────────
ok('loginGrid is viewport-driven (min-height 100dvh)', /\.loginGrid\s*\{[^}]*min-height:\s*100dvh/.test(page));
ok('loginGrid centers its content (justify + align center)',
  /\.loginGrid\s*\{[^}]*justify-content:\s*center[^}]*align-items:\s*center/.test(page));

// ── Issue 2/3/4/6/7: ONE spacing scale, no stacked margins ─────────────────
ok('loginRight is a flex column with a single gap', /\.loginRight\s*\{[^}]*display:\s*flex[^}]*gap:\s*16px/.test(page));
ok('loginRight owns the column width (max-width)', /\.loginRight\s*\{[^}]*max-width:\s*400px/.test(page));
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
