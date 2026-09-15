/**
 * tests/jobcard-search-ranking.test.cjs
 *
 * REWRITTEN — Universal Search Engine review.
 *
 * The original version of this test mirrored JobCardModule.jsx's own hand-rolled
 * `savedCardRank(card, ql)` function, used only for the FINAL SORT of the Saved Job
 * Cards list. That function is now DELETED — it only ever scored jobNo (full or
 * digits-only), customer name, and vehicle. It did NOT know about regNo/VIN/engine
 * number at all, even though those fields WERE already exact-identifier fields in the
 * filter stage's own `entry.ids` (built a few lines above it, in the exact same
 * component) — so a job card that passed the filter via an exact registration/VIN/
 * engine-number match could still be ranked no higher than an unrelated card that only
 * partially matched the customer name. Filter and rank silently disagreed about which
 * fields mattered, the same class of bug found in CustomersModule's now-deleted
 * `customerRank`.
 *
 * Fix: the final sort now calls the shared `rankIndexed(x.entry, savedDq)` directly
 * against the SAME `entry` object the filter stage already built and matched against —
 * one source of truth for "which fields are searchable and how strong is this hit",
 * not two disconnected ones.
 *
 * This test drives the real `rankIndexed` against Job-Card-shaped entries built the same
 * way JobCardModule.jsx actually builds them, and verifies the deleted function stays
 * deleted.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const { normId, rankIndexed } = require('../lib/useSearch.js');

console.log('\nJob Card — Saved Job Cards search ranking (rewritten after the savedCardRank deletion)\n');

// Mirrors JobCardModule.jsx's real savedSorted entry shape exactly (ids include both
// the full jobNo AND its digit-only form, plus regNo/vin/engineNo; hay is free text).
const entryFor = (jc) => ({
  hay: [jc.customer, jc.phone, jc.vehicle, jc.advisor, jc.technician].filter(Boolean).join(' ').toLowerCase(),
  ids: [jc.jobNo, String(jc.jobNo || '').replace(/\D/g, ''), jc.regNo, jc.vin, jc.engineNo].filter(Boolean).map(normId),
});

console.log('\nThe gap the deleted function had: an exact regNo/VIN/engine-number match must outrank a mere name/vehicle partial\n');
{
  // Previously: savedCardRank had NO case for regNo/vin/engineNo at all, so this card
  // would have fallen to the same bottom tier as any other passing match.
  const exactReg = { jobNo: 'SBBMC88', customer: 'Someone', vehicle: 'Maruti Swift', regNo: 'AP31LN9732' };
  const nameOnly = { jobNo: 'SBBMC89', customer: 'AP31LN9732 Motors', vehicle: 'Honda City' }; // name merely contains the text
  const rows = [nameOnly, exactReg];
  const ranked = rows.map((jc) => ({ jc, rank: rankIndexed(entryFor(jc), 'AP31LN9732') })).sort((a, b) => b.rank - a.rank);
  ok('the job card whose OWN registration is the exact match ranks first',
    ranked[0].jc.jobNo === 'SBBMC88', ranked.map((x) => x.jc.jobNo).join(', '));
  ok('an identifier (regNo) exact match scores strictly higher than a free-text (name) contains-match',
    rankIndexed(entryFor(exactReg), 'AP31LN9732') > rankIndexed(entryFor(nameOnly), 'AP31LN9732'));
}

console.log('\nJob number digits-only search still works as a genuine second identifier\n');
{
  const cards = [
    { jobNo: 'SBBMC145', customer: 'Ravi Kumar', vehicle: 'Maruti Swift' }, // no relation to "301"
    { jobNo: 'SBBMC22', customer: 'Lakshmi', vehicle: 'Hyundai i20', vin: 'MA3EJKD1S00301456' }, // "301" only inside VIN, mid-string
    { jobNo: 'SBBMC301', customer: 'Anitha', vehicle: 'Tata Punch' }, // exact job number digits
  ];
  const ranked = cards.map((jc) => ({ jc, rank: rankIndexed(entryFor(jc), '301') })).sort((a, b) => b.rank - a.rank);
  ok('exact Job Card No. digits match ranks first', ranked[0].jc.jobNo === 'SBBMC301', ranked.map((x) => x.jc.jobNo).join(', '));
  ok('an unrelated card (no match anywhere) scores 0 and would be filtered out entirely',
    rankIndexed(entryFor(cards[0]), '301') === 0);
}

console.log('\nPriority order end-to-end: job-number prefix > customer name > vehicle\n');
{
  const cards = [
    { jobNo: 'SBBMC9', customer: 'Someone', vehicle: 'Swift ZXI', phone: '9000000000' }, // vehicle contains "swift"
    { jobNo: 'SBBMC10', customer: 'Swift Motors Pvt Ltd', vehicle: 'Honda City' }, // customer contains "swift"
    { jobNo: 'SWIFT-2', customer: 'Someone Else', vehicle: 'Tata Nexon' }, // job number itself starts with "swift"
  ];
  const ranked = cards.map((jc) => ({ jc, rank: rankIndexed(entryFor(jc), 'swift') })).sort((a, b) => b.rank - a.rank);
  ok('Job Card No. prefix outranks a customer-name match', ranked[0].jc.jobNo === 'SWIFT-2', ranked.map((x) => x.jc.jobNo).join(', '));
  ok('customer-name match outranks a vehicle match', ranked[1].jc.jobNo === 'SBBMC10', ranked.map((x) => x.jc.jobNo).join(', '));
  ok('vehicle match ranks last of the three', ranked[2].jc.jobNo === 'SBBMC9', ranked.map((x) => x.jc.jobNo).join(', '));
}

// Empty query is rank-neutral.
ok('empty query is rank-neutral (returns 1, below every real match tier, and never used to reorder since callers short-circuit on !ql)',
  rankIndexed(entryFor({ jobNo: 'X' }), '') === 1);

console.log('\nSource wiring — the deleted function stays deleted, ranking uses the shared entry directly\n');
const jc = fs.readFileSync(path.resolve(__dirname, '../components/jobcards/JobCardModule.jsx'), 'utf8');
ok('savedCardRank the FUNCTION no longer exists (deleted, not just unused) — a historical-context comment mentioning the old name is fine',
  !/const savedCardRank = /.test(jc) && !/savedCardRank\(/.test(jc));
ok('imports rankIndexed from the shared engine', /useSearchIndex, matchIndexed, rankIndexed, normId/.test(jc));
ok('savedList sorts matches via rankIndexed against the SAME entry the filter used',
  /\.sort\(\(a, b\) => b\.rank - a\.rank\)/.test(jc) && /rank: rankIndexed\(x\.entry, savedDq\)/.test(jc));
ok('no query -> recency order only, no ranking overhead (unchanged)', /if \(!ql\) return matched\.map\(\(x\) => x\.jc\);/.test(jc));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
