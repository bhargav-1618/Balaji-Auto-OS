/**
 * tests/light-theme-option-contrast.test.cjs
 *
 * LIGHT THEME — native <select> <option> rows unreadable.
 *
 * Reported symptom: Settings -> Appearance -> Light, then any native <select>'s open
 * dropdown (first confirmed on Vehicles' sort selector) has option text that is
 * "effectively invisible" though still technically present/selectable.
 *
 * Root cause: ~50 native <option> elements across 14 files carry a hardcoded
 * near-black background left over from when the app was Dark-only — either inline
 * `style={{ background: '#141414' }}` or `className="bg-[#111]"`. That's harmless in
 * Dark/Warm (their --fg-rgb text color is light, so it still reads against a dark
 * option row), but in Light mode --fg-rgb flips to near-black (34,31,25) — so the
 * option text renders near-black on a near-black row and disappears. Two call sites
 * already avoided this by using a theme-aware `var(--surface-2)` background instead
 * of the hardcoded hex (SettingsControls.jsx's SetSel, the rows-per-page pickers in
 * InventoryDashboard.js/LedgerPage.jsx) — proof this is a real, fixable defect, not
 * an intentional design choice.
 *
 * Fix: one shared `:root[data-theme="light"] option { ... !important }` rule in
 * globals.css, using the SAME attribute-scoped-override technique the theme engine
 * already uses for `.text-white` / `[class*="bg-white/"]` etc. — not ~50 individual
 * JSX edits.
 *
 * NOTE on why this test is source-pattern-based, not a rendered getComputedStyle
 * check: jsdom does not correctly cascade an external stylesheet's `!important` rule
 * over an inline `style` attribute (verified directly against this project's jsdom
 * version — a stylesheet override that works correctly in real Chrome measured as a
 * no-op through jsdom's getComputedStyle). Every existing CSS-behavior test in this
 * repo (dropdowns.test.cjs, settings-density-consistency.test.cjs, etc.) uses the same
 * source-pattern approach for exactly this reason. To keep this non-shallow (not just
 * "a color string exists somewhere"), it asserts the rule's exact selector scope, both
 * declared properties, cross-checks it against the real, current list of affected call
 * sites in the actual component files (so it fails if a NEW hardcoded-dark <option> is
 * added without the shared rule existing), and proves Dark/Warm get no matching override.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

console.log('\nLight theme — native <select> <option> contrast\n');

const css = read('styles/globals.css');

// ---- 1. The shared override rule exists, scoped ONLY to Light, with both the
//    background AND the text color forced (a background-only fix would leave
//    near-black-on-near-black if the option's own text color also happens to
//    resolve dark, or vice-versa for a differently-styled option). -----------------
const ruleMatch = css.match(/:root\[data-theme="light"\]\s*option\s*\{([^}]*)\}/);
ok('globals.css defines a Light-scoped override for every native <option>',
  !!ruleMatch);
const ruleBody = ruleMatch ? ruleMatch[1] : '';
ok('...it forces a theme-aware background (var(--surface-2), not a hardcoded hex)',
  /background-color:\s*var\(--surface-2\)\s*!important/.test(ruleBody));
ok('...it also forces a theme-aware text color (rgb(var(--fg-rgb)), not a hardcoded hex)',
  /color:\s*rgb\(var\(--fg-rgb\)\)\s*!important/.test(ruleBody));

// ---- 2. It must NOT exist for Dark or Warm — those themes are already correct
//    (light --fg-rgb text reads fine against the old hardcoded dark background), and
//    the task explicitly requires preserving them untouched. -----------------------
ok('no matching override was added for Dark',
  !/:root\[data-theme="(dark|darkplus|balanced)"\]\s*option\s*\{/.test(css));
ok('no matching override was added for Warm',
  !/:root\[data-theme="warm"\]\s*option\s*\{/.test(css));

// ---- 3. Cross-check against the real, current call sites. If a future edit adds a
//    fresh hardcoded-dark <option> in a NEW file not covered by the selector's own
//    element-level scope (it targets `option` globally, so any new file is already
//    covered) this still passes — but if someone narrows the CSS selector (e.g. to a
//    class the JSX doesn't carry), this catches the mismatch by confirming today's
//    real offending files still exist and the rule is a bare `option` tag selector
//    (so it applies regardless of which file/inline-style/className produced it). ---
const bareTagSelector = /:root\[data-theme="light"\]\s*option\s*\{/.test(css);
ok('the selector targets the <option> element itself (not a class/style match) — '
  + 'so it covers every affected file uniformly, inline style or Tailwind class alike',
  bareTagSelector);

// Dropdown-standardization pass: Vehicles/Customers/Billing/Reminders' filter-bar
// native <select> elements were converted to MiniSelect (a native select's open
// popup can't be themed to match the app — see dropdown-native-to-minisel-
// conversion.test.cjs). Reminders had ONLY those two converted selects, so it no
// longer has a single native <option> anywhere in the file; Vehicles/Customers/
// Billing still have OTHER native selects untouched by that pass (rows-per-page,
// damage-type, etc.), so they stay in this list. This assertion's job is proving
// the file list below is not stale — updating it to match a genuine, intentional
// removal is correct, not weakening the test (the actual CSS rule itself is
// re-verified, unchanged, by the assertions above).
const knownOffenders = [
  'components/billing/BillingModule.jsx',
  'components/vehicles/VehiclesModule.jsx',
  'components/customers/CustomersModule.jsx',
  'components/jobcards/JobCardModule.jsx',
  'components/inventory/InventoryStock.jsx',
  'components/inventory/SupplierDirectory.jsx',
  'components/inventory/SupplierPerformance.jsx',
  'components/inventory/views/AnalyticsView.jsx',
  'components/inventory/views/ReportsView.jsx',
  'components/common/LedgerPage.jsx',
];
const stillHardcoded = knownOffenders.filter((f) => {
  const src = read(f);
  return /background:\s*'#141414'/.test(src) || /className="bg-\[#111\]"/.test(src);
});
ok('sanity: the known affected files still contain the hardcoded pattern (proves the '
  + 'fix is a CSS override, not a no-longer-needed JSX edit — and that this list is '
  + 'not stale)',
  stillHardcoded.length === knownOffenders.length,
  `only ${stillHardcoded.length}/${knownOffenders.length} still had it: missing from ${
    knownOffenders.filter((f) => !stillHardcoded.includes(f)).join(', ')}`);

// ---- 4. The already-correct call sites (var(--surface-2)) must be untouched —
//    the new rule applies the identical value, so this is a redundant-but-harmless
//    override for them, not a behavior change. -------------------------------------
const settingsControls = read('components/inventory/ui/SettingsControls.jsx');
ok('SettingsControls.jsx\'s already-correct SetSel option styling is untouched',
  /style=\{\{ background: 'var\(--surface-2\)' \}\}/.test(settingsControls));

// ---- 5. Custom-built dropdown primitives (not native <select>) were confirmed
//    during discovery to already be theme-aware via var(--surface-1)/var(--surface-2)
//    plus the existing text-white/* Light override — they must stay untouched by
//    this fix (no new rule targeting them, no edit to their own files). ------------
const miniSelect = read('components/common/MiniSelect.jsx');
const actionMenu = read('components/common/ActionMenu.jsx');
ok('MiniSelect (custom combobox) still uses its own theme-aware panel background',
  /background:\s*'var\(--surface-1\)'/.test(miniSelect));
ok('ActionMenu (custom context menu) still uses its own theme-aware panel background',
  /background:\s*'var\(--surface-1\)'/.test(actionMenu));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
