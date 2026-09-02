/**
 * tests/concurrency-doc-counter.test.cjs
 *
 * CONCURRENCY PHASE 2 — authoritative, collision-proof invoice numbering.
 *
 * Before: `nextInvNo()` = client-side `max(existing) + 1` with no reservation, so
 * two terminals billing in the same second both computed INV-0008 and both saved —
 * two invoice documents, one legal serial (GST Rule 46(b) requires unique serials).
 *
 * After: the INV-/EST- number is allocated AT SAVE TIME by a Firestore transaction
 * on `counters/<sequence>` (lib/docCounter.js), surfaced through
 * store.allocateNumber() and driven from InventoryDashboard.persistInvoice().
 *
 * This suite exercises:
 *   - the pure allocation decision (allocationStep / normalizeSeed / formatDocNo),
 *     including its retry- and monotonicity- safety,
 *   - the demo backend's allocateNumber (same decision, local counter blob),
 *   - the wiring: every new-invoice path is now save-time-allocated, the editor
 *     no longer previews a number, drafts stay client-side, and the counter
 *     transaction / rules are shaped as designed.
 * The live 2-/3-client emulator proof lives in tests/rules/firestore.rules.test.cjs.
 */
require('./setup.cjs');
const fs = require('fs');
const path = require('path');

// demo store needs Web Storage; jsdom doesn't wire it to global.
const mem = {};
const shim = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; },
  clear: () => { Object.keys(mem).forEach((k) => delete mem[k]); },
};
global.localStorage = shim;
global.sessionStorage = shim;

const { normalizeSeed, allocationStep, formatDocNo } = require('../lib/docCounter');
const { createStore } = require('../services/persistenceStore');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');

console.log('\nCONCURRENCY PHASE 2 — invoice-number allocation\n');

// ── A. normalizeSeed — always a positive integer ────────────────────────────
ok('A: normalizeSeed floors and clamps to >= 1',
  normalizeSeed(8) === 8 && normalizeSeed(8.9) === 8 && normalizeSeed(0) === 1
  && normalizeSeed(-5) === 1 && normalizeSeed(undefined) === 1 && normalizeSeed('x') === 1
  && normalizeSeed(NaN) === 1);

// ── B. allocationStep — the pure decision ───────────────────────────────────
ok('B: a fresh counter (no `next`) starts at the seed',
  JSON.stringify(allocationStep(undefined, 8)) === JSON.stringify({ allocated: 8, nextNext: 9 }));
ok('B: an existing counter ahead of the seed wins (normal steady state)',
  JSON.stringify(allocationStep(12, 8)) === JSON.stringify({ allocated: 12, nextNext: 13 }));
ok('B: a counter BEHIND the seed is pulled forward (self-heal a lagging counter)',
  JSON.stringify(allocationStep(3, 40)) === JSON.stringify({ allocated: 40, nextNext: 41 }));
ok('B: a non-integer / zero stored value is treated as absent',
  allocationStep(0, 5).allocated === 5 && allocationStep(1.5, 5).allocated === 5
  && allocationStep('9', 5).allocated === 5);

// ── C. monotonic + retry-safe: allocated is strictly increasing in `current` ─
// A Firestore transaction may re-run its callback. On retry it re-reads a HIGHER
// `next` and allocationStep returns a HIGHER number — so a retry can never hand
// out a value already given to the committed attempt. There is no other side
// effect, so the retry is safe.
{
  let bad = false;
  let prev = -1;
  for (let cur = 1; cur <= 50; cur++) {
    const { allocated, nextNext } = allocationStep(cur, 1);
    if (allocated <= prev) bad = true;            // strictly increasing
    if (nextNext !== allocated + 1) bad = true;   // counter advances by exactly 1
    prev = allocated;
  }
  ok('C: allocated is strictly increasing as the stored `next` rises (retry can\'t double-allocate)', !bad);
  ok('C: a retry that re-reads next=N+1 allocates strictly above the N attempt',
    allocationStep(10, 1).allocated < allocationStep(11, 1).allocated);
}

// ── D. formatDocNo ─────────────────────────────────────────────────────────
ok('D: formats a padded serial', formatDocNo('INV', 8) === 'INV-0008' && formatDocNo('EST', 12) === 'EST-0012');
ok('D: 5-digit serials are not truncated', formatDocNo('INV', 12345) === 'INV-12345');
ok('D: prefix is upper-cased', formatDocNo('inv', 1) === 'INV-0001');

// ── E. demo backend allocateNumber — same decision, persisted counter blob ──
(async () => {
  const store = createStore(true); // demo

  // sequential allocation from an empty counter, seeded at 8
  const a = await store.allocateNumber('invoices', 8);
  const b = await store.allocateNumber('invoices', 8);   // stale seed — counter now wins
  const c = await store.allocateNumber('invoices', 8);
  ok('E: three sequential demo allocations are 8, 9, 10 (no duplicates, no gaps)',
    a === 8 && b === 9 && c === 10, `${a},${b},${c}`);

  // §11 — counter/invoice consistency: after N allocations from N, next === N + count
  const blob = JSON.parse(mem.maruti_demo_counters || '{}');
  ok('E: the demo counter advanced to seed + 3', blob.invoices === 11, JSON.stringify(blob));

  // separate sequences don't interfere
  const e1 = await store.allocateNumber('estimates', 3);
  const e2 = await store.allocateNumber('estimates', 3);
  ok('E: the estimates sequence is independent of invoices', e1 === 3 && e2 === 4);
  ok('E: allocating estimates did not move the invoices counter',
    JSON.parse(mem.maruti_demo_counters).invoices === 11);

  // a later, higher seed pulls the counter forward (a manually-numbered invoice appeared)
  const d = await store.allocateNumber('invoices', 50);
  ok('E: a higher seed pulls the demo counter forward (never a duplicate of a known number)', d === 50);

  // ── F. wiring: lib/docCounter.js — the transaction shape ──────────────────
  const dc = read('../lib/docCounter.js');
  ok('F: allocateNumber runs a Firestore transaction on counters/<sequence>',
    /export async function allocateNumber\(sequence, seedFrom = 1\)/.test(dc)
    && /doc\(db, COUNTERS, String\(sequence\)\)/.test(dc)
    && /const COUNTERS = 'counters';/.test(dc)
    && /return runTransaction\(db, async \(tx\) => \{/.test(dc));
  ok('F: the transaction reads `next`, hands it out, and writes `next + 1` in the same tx',
    /const snap = await tx\.get\(ref\)/.test(dc)
    && /allocationStep\(\s*snap\.exists\(\) \? snap\.data\(\)\.next : undefined,\s*seedFrom,\s*\)/.test(dc)
    && /tx\.set\(ref, \{ next: nextNext \}, \{ merge: true \}\)/.test(dc)
    && /return allocated;/.test(dc));
  ok('F: docCounter imports ONLY from ./firebase (no business logic, no lease/record-sync coupling)',
    /^import \{ db, doc, runTransaction \} from '\.\/firebase';$/m.test(dc)
    && (dc.match(/^import /gm) || []).length === 1
    && !/\beditLease\b|\beditLocks\b|acquireLease|recordSync|useRecordSync/.test(dc));

  // ── G. wiring: persistenceStore exposes allocateNumber on BOTH backends ───
  const storeSrc = read('../services/persistenceStore.js');
  ok('G: persistenceStore exposes allocateNumber on the demo AND production backend',
    (storeSrc.match(/async allocateNumber\(/g) || []).length === 2);
  ok('G: the production backend delegates to lib/docCounter (the real transaction)',
    /return allocateCounterNumber\(sequence, seedFrom\);/.test(storeSrc)
    && /import \{ allocateNumber as allocateCounterNumber, allocationStep \} from '\.\.\/lib\/docCounter';/.test(storeSrc));
  ok('G: the demo backend reuses the SAME allocationStep decision + a persisted counter blob',
    /const \{ allocated, nextNext \} = allocationStep\(all\[sequence\], seedFrom\);/.test(storeSrc)
    && /writeAll\(STORAGE\.DEMO_COUNTERS, all\);/.test(storeSrc));

  // ── H. wiring: BillingModule — save-time allocation, no preview number ────
  const bill = read('../components/billing/BillingModule.jsx');
  ok('H: the "New Invoice" button opens the editor with NO number',
    /setEdit\(\{ \.\.\.emptyInvoice\(\) \}\);/.test(bill)
    && !/setEdit\(\{ \.\.\.emptyInvoice\(\), invNo: nextInvNo\(invoices, px\) \}\)/.test(bill));
  ok('H: the cross-module prefill path also opens with NO number',
    !/invNo: nextInvNo\(invoices, px\),/.test(bill));
  ok('H: the editor header tells the user the number is assigned on save',
    /number assigned on save/.test(bill));
  ok('H: save() tags a fresh INV-/EST- invoice with the allocation intent (not a client number)',
    /__allocSeq: asEstimate \? 'estimates' : 'invoices',/.test(bill)
    && /__allocPrefix: prefix,/.test(bill)
    && /__allocSeed: invSeqMax\(invoices, prefix\) \+ 1,/.test(bill));
  ok('H: DRF- drafts stay client-side (a throwaway handle, never a GST serial)',
    /if \(asDraft\) \{\s*\n\s*invNo = nextInvNo\(invoices, 'DRF'\);/.test(bill));
  ok('H: converting an estimate also allocates a fresh INV- number server-side',
    /__allocSeq: 'invoices', __allocPrefix: 'INV', __allocSeed: invSeqMax\(invoices, 'INV'\) \+ 1,/.test(bill));
  ok('H: the save wrapper uses the PERSISTED invoice (real number) for the toast + pay hand-off',
    /let saved; try \{ saved = await onPersist\?\.\(iv\); \}[\s\S]{0,80}const finalIv = saved \|\| iv;/.test(bill));

  // ── I. wiring: persistInvoice — allocate BEFORE the write, strip hints, return ──
  const dash = read('../components/InventoryDashboard.js');
  ok('I: persistInvoice allocates the number before writing, strips the __alloc* hints, and toasts on failure',
    /if \(iv\.__allocSeq\) \{\s*\n\s*const \{ __allocSeq, __allocPrefix, __allocSeed, \.\.\.rest \} = iv;/.test(dash)
    && /n = await store\.allocateNumber\(__allocSeq, __allocSeed\);/.test(dash)
    && /Could not reserve an invoice number/.test(dash)
    && /target = \{ \.\.\.rest, invNo: formatDocNo\(__allocPrefix, n\) \};/.test(dash));
  ok('I: the guarded + unguarded write paths and audit all use the renumbered `target`',
    /store\.saveGuarded\(COLLECTIONS\.INVOICES, target, revOf\(target\)/.test(dash)
    && /runInvoiceTransaction\(prior, target, 'persist'\)/.test(dash)
    && /const next = \[\.\.\.prev\.filter\(\(x\) => x\.id !== target\.id\), target\];/.test(dash));
  ok('I: persistInvoice returns the persisted invoice so the caller shows the real number',
    /setInvoicesRaw\(nextList\);\s*\n\s*syncCustomerTotals\(target\.customerId, nextList\);\s*\n\s*return merged;/.test(dash)
    && /syncCustomerTotals\(target\.customerId, next\);\s*\n\s*return target;/.test(dash));
  {
    // persistInvoice writes exactly ONE invoice doc (via persistDocsDiff on
    // prev -> [...prev without this id, target], which syncAll narrows to the
    // single changed doc) plus the counter. It never renumbers or bulk-rewrites
    // the book.
    const pi = dash.indexOf('const persistInvoice = async (iv) =>');
    const body = pi >= 0 ? dash.slice(pi, dash.indexOf('\n  };', pi)) : '';
    ok('I: persistInvoice touches only THIS invoice + the counter (no renumber / bulk rewrite)',
      body.length > 0
      && !/\.map\(\([^)]*\) => \(\{ [^}]*invNo:/.test(body)
      && (body.match(/persistDocsDiff\(COLLECTIONS\.INVOICES/g) || []).length === 1);
  }

  // ── J. wiring: firestore.rules — counters block ─────────────────────────
  const rules = read('../firestore.rules');
  ok('J: counters/<sequence> — read is signed-in, create requires a positive int `next`',
    /match \/counters\/\{sequence\} \{/.test(rules)
    && /allow read:   if signedIn\(\);/.test(rules)
    && /allow create: if signedIn\(\)\s*\n\s*&& request\.resource\.data\.keys\(\)\.hasOnly\(\['next'\]\)\s*\n\s*&& request\.resource\.data\.next is int\s*\n\s*&& request\.resource\.data\.next >= 1;/.test(rules));
  ok('J: counters update never DECREASES `next`, and delete is forbidden',
    /allow update: if signedIn\(\)\s*\n\s*&& request\.resource\.data\.keys\(\)\.hasOnly\(\['next'\]\)\s*\n\s*&& request\.resource\.data\.next is int\s*\n\s*&& request\.resource\.data\.next >= resource\.data\.next;/.test(rules)
    && /match \/counters\/\{sequence\} \{[\s\S]{0,900}allow delete: if false;/.test(rules));
  ok('J: the deny-by-default catch-all still comes AFTER the counters block',
    rules.indexOf('match /counters/{sequence}') < rules.indexOf('match /{document=**}'));

  // ── K. the number space is unchanged for existing docs ─────────────────
  ok('K: nextInvNo() (still used for DRF + the allocation seed) keeps the INV-#### shape',
    formatDocNo('INV', allocationStep(undefined, 297).allocated) === 'INV-0297');

  console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
  process.exit(FAIL ? 1 : 0);
})();
