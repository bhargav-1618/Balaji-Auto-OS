/**
 * tests/statcards.test.cjs — ISSUE 3
 *
 * The Vehicles dashboard showed "₹71,35,2 / 5,92 / 0" — a rupee figure broken across
 * three lines mid-digit. That is not clutter, it is an unreadable number. Two causes:
 * the value had no `whitespace-nowrap`, and the card was too narrow to hold it.
 */
const fs = require('fs');
const path = require('path');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};

const SRC = fs.readFileSync(path.resolve(__dirname, '../components/vehicles/VehiclesModule.jsx'), 'utf8');

// Execute the SHIPPED formatter, not a copy of it.
const fnSrc = SRC.match(/function compactINR\(v\) \{[\s\S]*?\n\}/)[0];
// eslint-disable-next-line no-new-func
const compactINR = new Function(`${fnSrc}\nreturn compactINR;`)();

console.log('\nISSUE 3 — stat cards: numbers must never wrap\n');

// The exact figure from the screenshot.
ok('the screenshot value renders compactly',
  compactINR(713525920) === '₹71.35 Cr',
  `got ${compactINR(713525920)}`);

ok('lakhs',    compactINR(679820) === '₹6.80 L',  `got ${compactINR(679820)}`);
ok('thousands', compactINR(9562) === '₹9.6K',     `got ${compactINR(9562)}`);
ok('small values stay exact', compactINR(450) === '₹450', `got ${compactINR(450)}`);
ok('zero', compactINR(0) === '₹0', `got ${compactINR(0)}`);
ok('negatives do not blow up', typeof compactINR(-500000) === 'string', `got ${compactINR(-500000)}`);
ok('an already-formatted string is parsed, not mangled',
  compactINR('₹71,35,25,920') === '₹71.35 Cr', `got ${compactINR('₹71,35,25,920')}`);
ok('garbage falls through unchanged rather than showing NaN',
  compactINR('—') === '—', `got ${compactINR('—')}`);

// Every compact value must be short enough to fit a stat card on one line.
const widest = [713525920, 679820, 9562, 450, 12345678901]
  .map(compactINR).reduce((m, s) => Math.max(m, s.length), 0);
ok('the widest compact value is <= 12 chars (fits the card)', widest <= 12, `widest = ${widest}`);

console.log('\n  --- the markup guarantees, not just the formatter ---\n');

ok('the stat VALUE is whitespace-nowrap (it wrapped mid-number before)',
  /font-bold text-white leading-tight whitespace-nowrap tabular-nums/.test(SRC));

ok('the stat LABEL no longer hard-truncates to "TOTAL…"',
  !/text-white\/40 truncate">\{label\}/.test(SRC));

ok('the exact rupee figure is still reachable (title attribute)',
  /title=\{s\.exact \? `\$\{s\.label\}: \$\{s\.exact\(stats\[s\.k\]\)\}` : undefined\}/.test(SRC));

// The single 11-across grid is gone: the cards are now grouped (Compliance always
// visible; Summary + Business collapsible) so the TABLE starts near the top.
ok('the cards are grouped, not one flat 11-across grid',
  /STAT_GROUPS = \{/.test(SRC) && /compliance:/.test(SRC) && /summary:/.test(SRC) && /business:/.test(SRC));
ok('Compliance is always visible (3 across)',
  /STAT_GROUPS\.compliance\.map/.test(SRC) && /grid-cols-3 gap-3 mb-3/.test(SRC));
ok('Summary + Business collapse so the table is not pushed down',
  /\{statsOpen && \(/.test(SRC) && /setStatsOpen/.test(SRC));
ok('the collapse choice is remembered',
  /localStorage\.setItem\('veh\.statsOpen'/.test(SRC));
{
  // Still exactly ELEVEN cards — the brief said group them, not add or remove any.
  const groups = SRC.match(/const STAT_GROUPS = \{[\s\S]*?\n  \};/)[0];
  const count = (groups.match(/\{ k: '/g) || []).length;
  ok('still exactly 11 cards — none added, none removed', count === 11, `found ${count}`);
}

ok('stat cards are keyboard-focusable filters (aria-pressed + focus ring)',
  /aria-pressed=\{!!active\}/.test(SRC) && /focus-visible:ring-2/.test(SRC));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
