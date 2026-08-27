/**
 * tests/dropdowns.test.cjs
 *
 * ISSUE 5 — a standing guard, not a one-off check.
 *
 * Every dropdown must render through DropdownPanel (portal + position:fixed), because
 * an `absolute` panel is clipped by any ancestor with overflow:hidden/auto — which is
 * what broke the vehicle and job-card lists. This test fails if anyone reintroduces
 * the absolute pattern, or reintroduces a silent `.slice(0, n)` cap on a result list.
 */
const fs = require('fs');
const path = require('path');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};

const ROOT = path.resolve(__dirname, '..');
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git', 'public', 'tests'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
};

const files = walk(path.join(ROOT, 'components'));

console.log('\nISSUE 5 — every dropdown uses the shared portal primitive\n');

// 1. No dropdown panel may be absolutely positioned any more.
//    Signature of the old bug: `absolute z-<n> mt-1 w-full` — a panel hanging below a field.
const ABSOLUTE_PANEL = /absolute\s+z-\[?\d+\]?\s+mt-1\s+w-full/;
const offenders = [];
files.forEach((f) => {
  const src = fs.readFileSync(f, 'utf8');
  src.split('\n').forEach((line, i) => {
    if (ABSOLUTE_PANEL.test(line)) offenders.push(`${path.relative(ROOT, f)}:${i + 1}`);
  });
});
ok('no dropdown is still absolutely positioned (was 11)',
  offenders.length === 0,
  offenders.length ? `still absolute:\n         ${offenders.join('\n         ')}` : '');

// 2. Everything that renders a dropdown imports the shared primitive.
const usesPanel = files.filter((f) => /DropdownPanel/.test(fs.readFileSync(f, 'utf8')));
ok('DropdownPanel is used across the modules',
  usesPanel.length >= 5, `used in ${usesPanel.length} files`);

// 3. No SILENT truncation of a search-result list. `.slice(0, n)` on a list filtered by
//    a user's query means matches exist that the user cannot reach, and nothing on
//    screen says so. Analytics "top 5 suppliers" slices are legitimate and are NOT
//    flagged — the discriminator is whether the filter tests a query string.
const QUERY_FILTER = /\.filter\([^\n]*(?:toLowerCase\(\)[^\n]*includes\(|includes\((?:q|ql|l|partQ|custQ)\b)[^\n]*\)\s*\.slice\(0,\s*\d+\)/;
const truncated = [];
files.forEach((f) => {
  const src = fs.readFileSync(f, 'utf8');
  src.split('\n').forEach((line, i) => {
    if (QUERY_FILTER.test(line)) truncated.push(`${path.relative(ROOT, f)}:${i + 1}  ${line.trim().slice(0, 90)}`);
  });
});
ok('no SEARCH-result list is silently truncated',
  truncated.length === 0,
  truncated.length ? `truncating:\n         ${truncated.join('\n         ')}` : '');

// 3b. Where a cap is genuinely necessary (the part searches are not virtualised), it
//     must be DISCLOSED to the user.
const billing = fs.readFileSync(path.join(ROOT, 'components/billing/BillingModule.jsx'), 'utf8');
const jobcards = fs.readFileSync(path.join(ROOT, 'components/jobcards/JobCardModule.jsx'), 'utf8');
ok('the billing part-search cap is disclosed ("Showing X of Y")',
  /Showing \{parts\.length\} of \{partMatches\.length\}/.test(billing));
ok('the job-card part-search cap is disclosed ("Showing X of Y")',
  /Showing \{partMatches\.length\} of \{allPartMatches\.length\}/.test(jobcards));

// 4. The primitive itself must stay fixed-positioned and portalled.
const dp = fs.readFileSync(path.join(ROOT, 'components/common/DropdownPanel.jsx'), 'utf8');
ok('DropdownPanel portals to document.body', /createPortal\([\s\S]*document\.body/.test(dp));
ok('DropdownPanel sets position:fixed inline (not via a Tailwind class)',
  /position:\s*'fixed'/.test(dp));
// Billing Action Menu architecture review — the window capture-phase listener is
// now the defensive catch-all layered on top of direct listeners on every real
// scroll ancestor (getScrollAncestors), not the only mechanism; the handler was
// also renamed (onMove -> onScroll) since scroll and resize now do genuinely
// different things (see DropdownPanel's own header comment).
ok('DropdownPanel re-measures on ancestor scroll (capture phase)',
  /addEventListener\('scroll',\s*onScroll,\s*true\)/.test(dp));
ok('DropdownPanel closes on Escape', /e\.key === 'Escape'/.test(dp));

// ISSUE 9 — entry animation, and it MUST respect reduced motion.
const css = fs.readFileSync(path.join(ROOT, 'styles/globals.css'), 'utf8');
ok('dropdowns have an entry animation', /@keyframes dropdownIn/.test(css));
ok('…applied to BOTH panel types',
  /\[data-dropdown-panel\],\s*\n\[data-searchselect-panel\] \{\s*\n\s*animation: dropdownIn/.test(css));
ok('…and it is disabled under prefers-reduced-motion',
  /@media \(prefers-reduced-motion[\s\S]*?animation-duration: 0\.001ms/.test(css));
ok('…and under the app\'s own reduce-motion setting',
  /html\.reduce-motion \*[\s\S]*?animation-duration: 0\.001ms/.test(css));
// The animation must END on transform:none. A lingering transform on the panel would
// make it a containing block for fixed descendants — the very thing we escaped.
ok('the animation lands on transform:none (does not create a containing block)',
  /to\s*\{\s*opacity: 1; transform: none; \}/.test(css));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
