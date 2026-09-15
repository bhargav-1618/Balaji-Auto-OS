/**
 * tests/jobcard-datetime-compact.test.cjs
 *
 * Root cause of "the Date & Time section takes excessive vertical space": the date
 * input (min-w-[140px]), hour/minute inputs (w-14 each), and AM/PM buttons
 * (min-w-[52px] each, px-3.5) together needed roughly 414px on one line. At the width
 * this field actually gets inside the 2-column intake grid, that routinely didn't fit,
 * so flex-wrap (added for genuine mobile narrowness) kicked in on ordinary desktop
 * widths too — dropping the AM/PM group to its own row and adding a full extra row of
 * height to BOTH Date In and Promised Delivery, every time the section rendered.
 *
 * Fix: tightened the four controls (date 140→112px min, hour/minute 56→44px, AM/PM
 * 52→36px min + less padding) so they fit on one line at normal widths — the section
 * gets visibly shorter without touching validation, the shortcut buttons, or the
 * AM/PM keyboard/click behavior. flex-wrap is kept as a fallback for real mobile
 * widths, so nothing is clipped there either.
 *
 * A second bug, only caught by live DOM measurement (getBoundingClientRect), not by
 * source-regex assertions: `inputCls` (shared by every field in this form) carries
 * `w-full`, and Tailwind's generated stylesheet places `.w-full` AFTER plain numeric
 * width utilities like `.w-11` — so `${inputCls} w-11 ...` silently LOST that CSS
 * tie-break and the hour/minute inputs rendered at the full row width (228px measured,
 * not 44px), pushing date/hour/minute/AM-PM onto four separate stacked rows instead of
 * one — the opposite of "compact". Fixed with Tailwind's `!` important-prefix
 * (`!w-11`), which is guaranteed to win regardless of utility source order. Verified
 * live: at 1440px+ width all four controls share one row; at 1280px only the AM/PM
 * group wraps (the documented mobile-style fallback), never hour/minute.
 *
 * Global Date & Time consolidation pass: DateTimeField was the ONLY date+time UI in
 * the entire app (confirmed via a full-repo audit — every other date field anywhere
 * is date-only, no time/AM-PM), used at exactly its original 2 call sites, both in
 * this same file. There was no cross-module duplication to reconcile. Extracted it
 * from JobCardModule.jsx to components/common/DateTimeField.jsx anyway — alongside
 * MiniSelect/DropdownPanel/SearchSelect, the app's other shared production
 * components — so it's a proper, discoverable, reusable "ONE production component"
 * any future module can import instead of being tempted to hand-roll its own, which
 * is exactly the root-cause pattern already fixed repeatedly for dropdowns this pass.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/common/DateTimeField.jsx'), 'utf8');
const jc = fs.readFileSync(path.resolve(__dirname, '../components/jobcards/JobCardModule.jsx'), 'utf8');

console.log('\nJob Card — Date & Time section compactness\n');

const start = src.indexOf('export default function DateTimeField');
// Window widened from 4900: the pending-state fix (tests/datetimefield-pending-time.test.cjs)
// added explanatory comments earlier in the function body, pushing the AM/PM-button and
// shortcuts JSX further from `start` than before. Slice to EOF so later assertions aren't
// silently truncated regardless of how much comment text precedes them.
const block = src.slice(start);

ok('DateTimeField is extracted to the shared components/common/ location (not a local function in JobCardModule.jsx anymore)',
  !/function DateTimeField\(/.test(jc) && /import DateTimeField, \{ toLocalInput \} from '\.\.\/common\/DateTimeField'/.test(jc));
ok('both call sites (Date & Time In, Promised Delivery) still use the shared component', (jc.match(/<DateTimeField/g) || []).length === 2);

ok('date input is narrower (min-w-[112px], was 140px) so it takes less of the row',
  /min-w-\[112px\]/.test(block) && !/min-w-\[140px\]/.test(block));
ok('hour/minute inputs are narrower (w-11, was w-14) — still enough for 2 digits',
  (block.match(/!w-11 text-center px-1/g) || []).length === 2 && !/w-14 text-center px-1/.test(block));
ok('hour/minute width uses the !important prefix so it actually wins over w-full (inputCls) — plain w-11 measurably lost this tie-break (228px rendered, not 44px)',
  !/\$\{inputCls\} w-11 text-center px-1/.test(block));
ok('AM/PM buttons are narrower (min-w-[36px] + px-2, was min-w-[52px] + px-3.5)',
  /min-w-\[36px\] px-2 text-xs font-bold/.test(block) && !/min-w-\[52px\]/.test(block));
ok('the main control row gap is tightened (gap-1, was gap-1.5) alongside the narrower controls',
  /flex flex-wrap gap-1 items-stretch/.test(block));
ok('the gap before the shortcuts row is tightened (mt-1, was mt-1.5)',
  /flex flex-wrap gap-1 mt-1>/.test(block) || /className="flex flex-wrap gap-1 mt-1"/.test(block));
ok('flex-wrap is kept as a fallback for genuinely narrow (mobile) widths',
  /flex flex-wrap gap-1 items-stretch/.test(block));

// --- behavior preserved: validation, shortcuts, AM/PM toggle ---
ok('AM/PM group is still keyboard-toggleable (arrow keys)', /onApKeyDown/.test(block) && /ArrowLeft.*ArrowRight.*ArrowUp.*ArrowDown/.test(block.replace(/\s/g, '')));
// cur.ap -> effective.ap: the pending-state fix (tests/datetimefield-pending-time.test.cjs)
// renders from `effective` (cur merged with any not-yet-committable pending edit) instead
// of the raw parsed `cur`, so a Hour/Minute/AM-PM value typed before a Date is picked is
// actually visible. Same aria-pressed behavior, just reading the right variable.
ok('AM/PM buttons still reflect selection via aria-pressed', /aria-pressed=\{effective\.ap === x\}/.test(block));
ok('shortcut buttons are still rendered from the shortcuts prop', /\{shortcuts\.map\(\(\[k, label\]\) => \(/.test(block));
ok('date/hour/minute still feed the same build()/patch() logic (no validation logic touched)',
  /patch\(\{ date: e\.target\.value \}\)/.test(block) && /patch\(\{ h12: n \}\)/.test(block) && /patch\(\{ m: n \}\)/.test(block));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
