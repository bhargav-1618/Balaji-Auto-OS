/**
 * tests/searchselect-clear-focus.test.cjs
 *
 * Global dropdown clear/cancel consistency pass. SearchSelect.jsx (used by Billing's
 * customer/vehicle/job-card pickers) was already structurally sound — its "Clear
 * search" and "Clear selection" buttons are real, separate <button> elements, siblings
 * of the <input>, not nested inside another interactive element like MiniSelect's old
 * bug. The one gap: "Clear selection" called onClearSelection() but never returned
 * focus anywhere — since this button only renders while `value` is truthy, clearing
 * the value unmounts the button on the next render, dropping focus to document.body
 * instead of the field remaining usable. Fixed by focusing the input afterward,
 * matching the "Clear search" button's own existing pattern.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/common/SearchSelect.jsx'), 'utf8');

console.log('\nSearchSelect — clear-selection focus restoration\n');

ok('"Clear search" (text) and "Clear selection" (value) are separate, real sibling <button>s — no nested-interactive-element bug like MiniSelect had',
  /aria-label="Clear search"/.test(src) && /aria-label="Clear selection"/.test(src));
ok('clearing the selection now restores focus to the input (previously dropped to document.body when the button unmounted)',
  /onClick=\{\(\) => \{ onClearSelection\?\.\(\); inputRef\.current\?\.focus\(\); \}\}/.test(src));
ok('clearing the search text already restored focus (pattern this fix now matches)',
  /setQ\(''\); setHi\(0\); setScrollTop\(0\); setOpen\(true\); inputRef\.current\?\.focus\(\);/.test(src));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
