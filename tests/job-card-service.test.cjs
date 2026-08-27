/**
 * tests/job-card-service.test.cjs — Medium finding: test coverage.
 *
 * services/jobCardService.js's nextJobCardNumber (extracted from
 * InventoryDashboard.js during earlier remediation) had no permanent unit
 * test — only a throwaway inline check at the time of extraction.
 */
require('./setup.cjs');
const { nextJobCardNumber } = require('../services/jobCardService.js');

let PASS = 0, FAIL = 0;
const ok = (n, c) => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}`); } };

console.log('\njobCardService — SBBMC## number generation\n');
ok('empty list -> SBBMC01', nextJobCardNumber([]) === 'SBBMC01');
ok('no jobCards arg -> SBBMC01', nextJobCardNumber() === 'SBBMC01');
ok('single card -> next number', nextJobCardNumber([{ jobNo: 'SBBMC01' }]) === 'SBBMC02');
ok('scans for the MAX, not the last item',
  nextJobCardNumber([{ jobNo: 'SBBMC05' }, { jobNo: 'SBBMC02' }, { jobNo: 'SBBMC09' }]) === 'SBBMC10');
ok('2-digit to 3-digit overflow', nextJobCardNumber([{ jobNo: 'SBBMC99' }]) === 'SBBMC100');
ok('case-insensitive prefix match', nextJobCardNumber([{ jobNo: 'sbbmc07' }]) === 'SBBMC08');
ok('non-SBBMC-prefixed jobNo values are ignored for the max scan',
  nextJobCardNumber([{ jobNo: 'SBBMC03' }, { jobNo: 'XYZ999' }]) === 'SBBMC04');
ok('null/missing jobNo is ignored, not a crash',
  nextJobCardNumber([{ jobNo: 'SBBMC03' }, { jobNo: null }, {}]) === 'SBBMC04');

// Batch 3 Defect 1: a Manual Entry jobNo that merely STARTS with SBBMC but
// contains other digits (e.g. an operator typing a date into it) must not
// corrupt the sequence — this is the exact "generated number jumped
// unexpectedly" bug: a loose /^SBBMC/ match + blanket digit-strip glued
// "2026" and "045" into 2026045, so every future Auto Generate jumped to
// SBBMC2026046 instead of the real next number.
ok('a non-standard manual jobNo (extra digits via hyphens) does not corrupt the max scan',
  nextJobCardNumber([{ jobNo: 'SBBMC03' }, { jobNo: 'SBBMC-2026-045' }]) === 'SBBMC04');
ok('a non-standard manual jobNo alone falls back to SBBMC01, not a huge glued number',
  nextJobCardNumber([{ jobNo: 'SBBMC-2026-045' }]) === 'SBBMC01');
ok('trailing junk after the digits (not a clean prefix+digits match) is also ignored',
  nextJobCardNumber([{ jobNo: 'SBBMC03' }, { jobNo: 'SBBMC12X' }]) === 'SBBMC04');

// Settings QA finding: Settings -> Job Cards -> Job Card Prefix saved but had NO
// effect on Auto Generate, since this function's prefix was hardcoded to the
// literal string "SBBMC" with no parameter for it at all. Fixed by accepting an
// optional `prefix` (defaulting to 'SBBMC' so every call above keeps working
// unchanged) and building the scan regex from it instead of a literal.
console.log('\njobCardService — custom prefix (Settings -> Job Cards -> Job Card Prefix)\n');
ok('custom prefix, empty list -> PREFIX01', nextJobCardNumber([], 'QAJC') === 'QAJC01');
ok('custom prefix scans its own numbers, ignoring differently-prefixed cards',
  nextJobCardNumber([{ jobNo: 'QAJC05' }, { jobNo: 'SBBMC99' }], 'QAJC') === 'QAJC06');
ok('custom prefix is case-insensitive on match, canonical-cased on output',
  nextJobCardNumber([{ jobNo: 'qajc03' }], 'QAJC') === 'QAJC04');
ok('a prefix containing regex metacharacters does not throw and is treated literally',
  nextJobCardNumber([{ jobNo: 'AB.01' }], 'AB.') === 'AB.02');
ok('blank/whitespace-only prefix falls back to SBBMC', nextJobCardNumber([], '   ') === 'SBBMC01');

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
