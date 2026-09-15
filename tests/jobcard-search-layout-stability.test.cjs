/**
 * tests/jobcard-search-layout-stability.test.cjs
 *
 * Root cause of "typing/deleting in the Saved Job Cards search box shifts the search
 * field and nearby controls": the "Clear Filters" button's condition included `savedQ`
 * (the search text) directly, so it mounted the instant the user typed a single
 * character and unmounted the instant they deleted back to empty — appearing/
 * disappearing ABOVE the search bar and pushing it (and everything below) down or up on
 * every keystroke.
 *
 * Fix: the button is now always present in the layout (its height is always reserved)
 * and toggled with `invisible`/`visibility:hidden` instead of conditional mounting —
 * that removes it from view and the tab order without removing its box from the flow,
 * so nothing around it reflows while searching/filtering/clearing.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/jobcards/JobCardModule.jsx'), 'utf8');

console.log('\nJob Card — Saved Job Cards search bar layout stability\n');

const start = src.indexOf('Clear Filters');
const block = src.slice(Math.max(0, start - 700), start + 400);

ok('Clear Filters button found near the saved-cards search/filter UI', start !== -1);
ok('the button is no longer conditionally MOUNTED based on savedQ (no more `&&` gate around it)',
  !/\{\(kpiFilter \|\| savedStatusF !== 'All' \|\| savedQ\) && \(\s*\n\s*<button[^>]*>Clear Filters/.test(block));
ok('the button toggles `invisible` (visibility:hidden — keeps its layout box) instead of unmounting',
  /\$\{\(kpiFilter \|\| savedStatusF !== 'All' \|\| savedQ\) \? 'visible' : 'invisible pointer-events-none'\}/.test(block));
ok('the button is removed from the tab order and hidden from assistive tech while inactive',
  /tabIndex=\{\(kpiFilter \|\| savedStatusF !== 'All' \|\| savedQ\) \? 0 : -1\}/.test(block) &&
  /aria-hidden=\{!\(kpiFilter \|\| savedStatusF !== 'All' \|\| savedQ\)\}/.test(block));
ok('clicking it still clears kpiFilter, status filter, and the search text (behavior unchanged)',
  /onClick=\{\(\) => \{ setKpiFilter\(null\); setSavedStatusF\('All'\); setSavedQ\(''\); \}\}/.test(block));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
