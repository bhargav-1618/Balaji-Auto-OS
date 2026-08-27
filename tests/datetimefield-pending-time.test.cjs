/**
 * tests/datetimefield-pending-time.test.cjs
 *
 * Root cause of "Hour/Minute fields can't be entered reliably" (reported against
 * Job Card's Date & Time In / Promised Delivery, live-verified against the shared
 * DateTimeField component both use): `build()` returns '' unconditionally whenever
 * `date` is empty — so typing an Hour or Minute BEFORE picking a Date discarded that
 * keystroke on every single character. Live-reproduced: with Promised Delivery's
 * date unset, typing "10" into Hour left the field empty — every digit vanished the
 * instant it was typed, because onChange('') round-tripped back through parse('')
 * and reset the input to blank. This read exactly like "the field won't accept
 * clicks/keyboard input," though the actual defect was in the value-assembly logic,
 * not focus or click handling. Not focus-related: with a pre-filled date (Date & Time
 * In defaults to now()), typing worked fine — the bug was specific to the
 * empty-date case, which Promised Delivery hits by default (no default value).
 *
 * Fix: local `pending` state holds Hour/Minute/AM-PM edits made before a Date
 * exists (impossible to represent in the "YYYY-MM-DDTHH:mm" value string), instead
 * of discarding them. Once a Date is picked, the pending parts are folded into the
 * committed value and `pending` is cleared. Live-verified end-to-end: typed Hour=10,
 * Minute=44, clicked PM (all before picking a date, all correctly retained and
 * visible), then set the date — the final state correctly showed date=2026-08-01,
 * hour=10, minute=44, matching everything typed beforehand.
 *
 * A second, independent, lower-confidence contributing factor found during
 * investigation: type="number" inputs at 44px never had their native spin-button
 * decoration suppressed, which can make clicks near the right edge hit the native
 * stepper instead of placing a text cursor. Fixed globally in styles/globals.css —
 * doesn't change functionality (typing/backspacing/arrow-keys unaffected).
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/common/DateTimeField.jsx'), 'utf8');
const cssSrc = fs.readFileSync(path.resolve(__dirname, '../styles/globals.css'), 'utf8');

console.log('\nDateTimeField — pending Hour/Minute/AM-PM survive typing before a Date is picked\n');

ok('pending state exists to hold Hour/Minute/AM-PM edits made before a Date exists',
  /const \[pending, setPending\] = useState\(null\);/.test(src));
ok('effective (rendered) values merge pending on top of the parsed value, only while date is still empty',
  /const effective = pending && !cur\.date \? \{ \.\.\.cur, \.\.\.pending \} : cur;/.test(src));
ok('patch() holds the edit in pending (does NOT call onChange, does NOT discard it) when there is still no date',
  /if \(!next\.date\) \{ setPending\(\(prev\) => \(\{ \.\.\.\(prev \|\| \{\}\), \.\.\.p \}\)\); return; \}/.test(src));
ok('once a date exists, pending is cleared and the FULL merged value (including anything typed earlier) is committed',
  /setPending\(null\);\s*\n\s*onChange\(build\(next\)\);/.test(src));
ok('shortcut buttons (Now/Today 6PM/Tomorrow/etc.) clear any stale pending state — they always produce a complete, authoritative value',
  /setPending\(null\);\s*\n\s*onChange\(toLocalInput\(d\)\);/.test(src));
ok('all four rendered fields (Date, Hour, Minute, AM/PM) read from `effective`, not the raw parsed `cur`, so a pending edit is actually visible while typing',
  /value=\{effective\.date\}/.test(src) && /value=\{effective\.h12\}/.test(src) && /value=\{effective\.m\}/.test(src) && /effective\.ap === x/.test(src));

// --- secondary, lower-confidence contributing factor: native number-input spinner ---
ok('native spin-button decoration is suppressed globally for type="number" inputs (contributing factor: eats click area on a 44px-wide Hour/Minute box)',
  /input\[type='number'\]::-webkit-outer-spin-button,\s*\n\s*input\[type='number'\]::-webkit-inner-spin-button \{\s*\n\s*-webkit-appearance: none !important;/.test(cssSrc));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
