/**
 * tests/search-accuracy-exact-identifier.test.cjs
 *
 * GLOBAL SEARCH ACCURACY (exact-identifier search) — data-integrity review, UPDATED by
 * the Universal Search Boxes review.
 *
 * Original bug (still fixed): every module joined unique identifiers (Customer ID, Job
 * Card Number, Invoice Number, Registration Number, VIN/Chassis/Engine Number, Part
 * Number/SKU, Supplier Code, GST No., ...) into the SAME substring-searched haystack as
 * names and other free text, so two different records with a shared prefix were
 * VISUALLY INDISTINGUISHABLE in a filtered list — a data-integrity risk. Fix:
 * `useSearchIndex`/`matchIndexed` (+ `normId`) split every module's searchable fields
 * into an exact-match identifier bucket (`ids`) and a partial-match text bucket (`hay`).
 *
 * Universal Search Boxes review — REVISED: the original fix made identifiers EXACT-ONLY,
 * which traded one bug for another — "232" no longer found "SBBMC232" ANYWHERE except
 * the one module that hand-built a digit-only secondary id as a workaround, directly
 * contradicting "partial identifier search... applies universally, not only Job Cards".
 * The brief's own resolution (section 19): a fragment matching several records is FINE —
 * "avoid pretending the first result is definitely the intended one" — as long as
 * results are RANKED so an exact hit is always the obvious top result. So identifiers are
 * now partial-matched too (via the new `rankIndexed`/`searchAndRank`), exactly like free
 * text, but ranked strictly above it at every tier. "SBBMC40" now correctly SURFACES
 * "SBBMC400" as a lower-ranked partial hit instead of hiding it outright — that is the
 * actual fix for "visually indistinguishable" (they're now distinguishable BY RANK,
 * never mixed together unordered as the original bug report described).
 *
 * SECOND REVISION — identifier-mixing bug (own vs. linked-record identifiers). Found
 * live against real demo data: this app numbers Job Cards "SBBMC123", the SAME text
 * format as a Customer ID. Several modules' `ids` array mixed a record's OWN identifiers
 * with identifiers of LINKED-BUT-DIFFERENT records (a customer's linked job-card/invoice
 * numbers, a vehicle's linked job-card/invoice numbers and owner code) with no priority
 * distinction — so an unrelated record could rank as an equally strong "exact identifier"
 * hit merely because something IT links to shared text with a completely different
 * record's actual identifier. First fix: split into `ids` (own) and a SEPARATE `refIds`
 * (linked), scored in lower, non-overlapping tiers.
 *
 * THIRD REVISION — Strict Universal Search Validation. The `refIds` compromise above was
 * itself rejected: "ranked lower" is still "present" in the result list, and a record
 * that doesn't genuinely match anything of ITS OWN must not appear at ALL, not appear
 * ranked at the bottom. `refIds`/`refIdsFn` were removed from lib/useSearch.js entirely.
 * The rule now: a record scores 0 — and is therefore EXCLUDED, not merely deprioritized —
 * unless the query is found in a field `useSearchIndex` was explicitly told is one of
 * THAT record's own. See tests/customer-search-ranking.test.cjs and
 * tests/vehicles-module.test.cjs for the full reproduced-bug scenarios and the
 * zero-results-for-a-nonexistent-query proof.
 *
 * Part 1 tests the shared primitives directly (plain, hookless logic — no React renderer
 * needed). Part 2 verifies, per module, that identifier fields are still isolated into
 * the `ids` bucket (own fields only, no cross-collection fan-out) via source inspection,
 * consistent with how every other module-level test in this suite verifies UI logic.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

const { normId, matchIndexed, rankIndexed, searchAndRank, useSearchIndex } = require('../lib/useSearch.js');

console.log('\nPart 1 — shared primitive: lib/useSearch.js normId + matchIndexed + rankIndexed\n');

ok('normId trims, lowercases and strips ALL whitespace', normId('  SB BMC 40  ') === 'sbbmc40');
ok('normId is safe on null/undefined/empty', normId(null) === '' && normId(undefined) === '' && normId('') === '');

// The flagship reported scenario: a complete registration must match ITS OWN record as
// the clear top-ranked result — and a fragment must still be able to SURFACE related
// records (a genuinely different vehicle whose reg merely shares that prefix), just
// never confused for, or ranked above, the exact one.
const registry = [
  { id: 'v1', reg: 'SBBMC40' },
  { id: 'v2', reg: 'SBBMC400' },
  { id: 'v3', reg: 'SBBMC401' },
];
const entryFor = (v) => ({ hay: '', ids: [normId(v.reg)] });
ok('a complete identifier ("SBBMC40") matches its own exact record',
  matchIndexed(entryFor(registry[0]), 'SBBMC40') === true);
ok('...and now ALSO surfaces a different record whose identifier merely starts with it ("SBBMC400") — partial identifier search must work universally',
  matchIndexed(entryFor(registry[1]), 'SBBMC40') === true);
ok('...but the EXACT record ranks strictly higher (own-exact=8) than the merely-prefixed one (own-prefix=7) — never visually indistinguishable',
  rankIndexed(entryFor(registry[0]), 'SBBMC40') === 8 && rankIndexed(entryFor(registry[1]), 'SBBMC40') === 7 &&
  rankIndexed(entryFor(registry[0]), 'SBBMC40') > rankIndexed(entryFor(registry[1]), 'SBBMC40'));
ok('typing the FULL identifier "SBBMC400" ranks that record above "SBBMC40" (which is merely a prefix of the query, not equal to it) — "SBBMC40" scores 0 against "SBBMC400" and is excluded entirely',
  rankIndexed(entryFor(registry[1]), 'SBBMC400') === 8 && rankIndexed(entryFor(registry[0]), 'SBBMC400') === 0);
ok('searchAndRank puts the exact match first and the partial match second, never the reverse',
  (() => {
    const items = [registry[1], registry[0]]; // deliberately out of order
    const idx = new Map(items.map((v) => [v.id, entryFor(v)]));
    const out = searchAndRank(items, idx, (v) => v.id, 'SBBMC40');
    return out.length === 2 && out[0].id === 'v1' && out[1].id === 'v2';
  })());

ok('identifier match is case-insensitive and whitespace-insensitive (matches regKey-style normalization)',
  matchIndexed({ hay: '', ids: [normId('SB BMC 40')] }, 'sbbmc 40') === true);

ok('an empty query matches everything (no filter applied)', matchIndexed({ hay: 'x', ids: ['y'] }, '') === true);
ok('a query that matches neither the identifiers nor the text haystack does not match',
  matchIndexed({ hay: 'john doe', ids: ['sbbmc40'] }, 'zzz') === false);

console.log('\nPart 1b — name/text fields keep partial (substring/token) matching; identifiers now match the same way but rank higher\n');
ok('a partial substring still matches the TEXT haystack (name-type fields unaffected)',
  matchIndexed({ hay: 'john doe', ids: ['sbbmc40'] }, 'john') === true);
ok('a partial/prefix query now DOES match an identifier field too (the Universal Search fix — "232" must find "SBBMC232" everywhere)',
  matchIndexed({ hay: '', ids: ['sbbmc400'] }, 'sbbmc40') === true);
ok('...and a MIDDLE fragment (not just a prefix) also matches an identifier — "232" found inside "SBBMC232X"',
  matchIndexed({ hay: '', ids: ['sbbmc232x'] }, '232') === true);
ok('multi-word token search still works against the text haystack',
  matchIndexed({ hay: 'swift ap01 red', ids: [] }, 'swift red') === true);
ok('an identifier match always outranks a free-text match, at every tier (own-id-exact 8 > text-exact 4)',
  rankIndexed({ hay: 'sbbmc40', ids: ['zzz'] }, 'sbbmc40') === 4 &&
  rankIndexed({ hay: 'zzz', ids: ['sbbmc40'] }, 'sbbmc40') === 8);
ok('a suffix match ("last 4 digits") on an OWN identifier ranks above a plain mid-string contains match',
  rankIndexed({ hay: '', ids: ['ap40lm1234'] }, '1234') === 6 &&
  rankIndexed({ hay: '', ids: ['ap40lm1234extra'] }, '1234') === 5 &&
  rankIndexed({ hay: '', ids: ['ap40lm1234'] }, '1234') > rankIndexed({ hay: '', ids: ['ap40lm1234extra'] }, '1234'));
ok('STRICT VALIDATION: a `refIds` field is no longer a recognized concept at all — an entry carrying one is simply ignored, never a match source',
  rankIndexed({ hay: 'zzz', ids: [], refIds: ['sbbmc40'] }, 'sbbmc40') === 0);
ok('STRICT VALIDATION: a record with NOTHING in its own configured fields matching the query scores exactly 0 — never a lower, nonzero "sort of matched" tier',
  rankIndexed({ hay: 'unrelated text', ids: ['also-unrelated'] }, 'zxq999999nonexistent') === 0);

console.log('\nPart 2 — every module migrated to the shared exact-identifier framework\n');

// --- Customers --- (see tests/customer-search-ranking.test.cjs for the full strict-
// validation rationale and the reproduced-bug scenarios; these are the narrower "which
// fields, which bucket" source checks this file already does for every other module)
{
  const src = read('components/customers/CustomersModule.jsx');
  ok('Customers: imports useSearchIndex/searchAndRank (customerRank deleted, no more matchIndexed-then-separate-rank two-step)',
    /useSearchIndex, searchAndRank/.test(src) && !/useHaystacks, matchTokens/.test(src) && !/customerRank/.test(src));
  ok('Customers: Customer ID (code), GST, PAN, and vehicle Registration/VIN/Engine No. are the customer\'s OWN identifiers (`ids`)',
    /\(c\) => \[c\.code, c\.gst, c\.pan,/.test(src) && /v\.regNo, v\.vin, v\.engineNo/.test(src));
  ok('Customers: linked Job Card No. and Invoice No. are NOT searchable — no refIds/refIdsFn wiring exists anywhere in this file',
    !/refIdsFn/.test(src) && !/cardsOf\(c\)\.map\(\(j\) => j\.jobNo\), \.\.\.invoicesOf/.test(src));
  ok('Customers: name/phone/email/city/company/vehicle make-model stay in the partial `hay` bucket',
    /\(c\) => \[c\.name, c\.phone, c\.altPhone, \.\.\.\(c\.extraPhones \|\| \[\]\), c\.email, c\.city, c\.companyName, c\.referenceBy,/.test(src));
  ok('Customers: filter + rank + sort goes through the single shared searchAndRank call', /searchAndRank\(prefiltered, searchIndex, \(c\) => c\.id, dq,/.test(src));
}

// --- Vehicles --- (see tests/vehicles-module.test.cjs for the full strict-validation
// rationale and the reproduced-bug scenario)
{
  const src = read('components/vehicles/VehiclesModule.jsx');
  ok('Vehicles: imports useSearchIndex/matchIndexed/rankIndexed (rankMatch/rankFieldsOf removed)',
    /useSearchIndex, matchIndexed, rankIndexed/.test(src) && !/rankFieldsOf/.test(src));
  ok('Vehicles: Registration/VIN/Engine/Chassis No./RC Number are THIS vehicle\'s own identifiers (`ids`) — no cross-collection fields mixed in',
    /\(r\) => \[r\.regNo, r\.vin, r\.engineNo, r\.chassisNo, r\.rcNumber\],/.test(src));
  ok('Vehicles: owner Customer ID and linked Job/Invoice No. are NOT searchable — no refIds/refIdsFn wiring exists anywhere in this file',
    !/refIdsFn/.test(src) && !/ownerCode, \.\.\.jobsOf/.test(src));
  ok('Vehicles: owner name/phone, make/model/variant, fuel, transmission, insurer, tags stay partial',
    /\(r\) => \[r\.owner, r\.ownerPhone, r\.make, r\.model, r\.variant, r\.fuel, r\.transmission, r\.insurer, r\.tags\]/.test(src));
  ok('Vehicles: filter calls matchIndexed against the search index', /matchIndexed\(searchIndex\.get\(r\.id\), dq\)/.test(src));
}

// --- Job Cards ---
{
  const src = read('components/jobcards/JobCardModule.jsx');
  ok('Job Cards: imports useSearchIndex/matchIndexed/rankIndexed/normId', /useSearchIndex, matchIndexed, rankIndexed, normId/.test(src));
  ok('Job Cards (Saved list): Job No. (full + digits-only), Registration, VIN, Engine No. are exact-only',
    /ids: \[jc\.jobNo, String\(jc\.jobNo \|\| ''\)\.replace\(\/\\D\/g, ''\), jc\.regNo, jc\.vin, jc\.engineNo\]\.filter\(Boolean\)\.map\(normId\)/.test(src));
  ok('Job Cards (Saved list): customer/phone/vehicle/advisor/technician stay partial',
    /hay: \[jc\.customer, jc\.phone, jc\.vehicle, jc\.advisor, jc\.technician\]\.filter\(Boolean\)\.join\(' '\)\.toLowerCase\(\)/.test(src));
  ok('Job Cards (Saved list): filter calls matchIndexed', /matchIndexed\(entry, savedDq\)/.test(src));
  ok('Job Cards (CustomerSearch picker): Customer ID/Registration/VIN/Engine No. are exact-only',
    /\(c\) => \[c\.code, \.\.\.\(c\.vehicles \|\| \[\]\)\.flatMap\(\(v\) => \[v\.regNo, v\.vin, v\.engineNo\]\)\]/.test(src));
  ok('Job Cards (parts picker): Part Number/OEM No./Part No./barcode are exact-only',
    /\(p\) => \[p\.sku, p\.oemNo, p\.partNo, p\.barcode\]/.test(src));
}

// --- Billing / Invoices ---
{
  const src = read('components/billing/BillingModule.jsx');
  ok('Billing: imports matchIndexed/normId (not the old matchTokens)', /matchIndexed, normId/.test(src) && !/import \{ useDeferredSearch, matchTokens \}/.test(src));
  ok('Billing: Invoice No., Registration No., VIN, Job Card No. and GST No. are exact-only',
    /ids: \[iv\.invNo, iv\.regNo, iv\.vin, iv\.jobNo, iv\.gstNo\]\.filter\(Boolean\)\.map\(normId\)/.test(src));
  ok('Billing: customer/phone/vehicle/advisor/technician stay partial',
    /hay: \[iv\.customer, iv\.phone, iv\.vehicle, iv\.advisor, iv\.technician\]\.filter\(Boolean\)\.join\(' '\)\.toLowerCase\(\)/.test(src));
  ok('Billing: filter calls matchIndexed', /return matchIndexed\(entry, dq\);/.test(src));
}

// --- InventoryDashboard.js: Parts, Ledgers, Command Palette ---
{
  const src = read('components/InventoryDashboard.js');
  ok('Inventory Parts: SKU is excluded from the tokenized haystack and checked as a separate exact match',
    /sku: normId\(part\.sku\)/.test(src) && /entry\.sku && entry\.sku === rawQuery/.test(src));
  ok('Inventory Parts: OEM Number, Barcode and Manufacturer Part No. get the same exact-match treatment as SKU (Issue 6.8 — previously not searchable at all)',
    /oemNo: normId\(part\.oemNo\)/.test(src) && /barcode: normId\(part\.barcode\)/.test(src) && /partNo: normId\(part\.partNo\)/.test(src)
    && /entry\.oemNo && entry\.oemNo === rawQuery/.test(src) && /entry\.barcode && entry\.barcode === rawQuery/.test(src));
  ok('Inventory Parts: name/category/vehicle/compatibleCars/location keep their existing tokenized+synonym partial matching',
    /\[part\.name, part\.category, categoriesStr\(part\), part\.vehicle, compatStr\(part\), part\.locationBin\]/.test(src));
  // GLOBAL SEARCH ACCURACY — RANKING (this file's own review, requirement 10: results
  // must be ranked). Previously an exact SKU/OEM/barcode/Part No. hit passed the filter
  // via the shortcut above but was never actually surfaced ahead of anything — with no
  // explicit column sort, results stayed in raw inventory array order. Inventory → Parts
  // is the busiest single search in the app; it now ranks exact identifier hits first,
  // then identifier-fragment hits, then everything else matched via the token/synonym
  // path, with the user's chosen column sort as the tie-breaker (and the ONLY ordering
  // when there's no active query — untouched).
  ok('Inventory Parts: an active query ranks exact SKU/OEM/barcode/Part No. hits above identifier-fragment hits above token/synonym-only hits',
    /const rankOf = \(part\) => \{/.test(src) && /result\.sort\(\(a, b\) => rankOf\(b\) - rankOf\(a\) \|\| \(columnSort \? columnSort\(a, b\) : 0\)\);/.test(src));
  // Reproduced live: searching "002" (the fragment of SKU "BRA-RE-002" a mechanic can
  // actually read off a box) returned "No matching part found" — the exact-only shortcut
  // required the COMPLETE SKU, and the tokenized haystack deliberately excludes SKU
  // entirely, so a fragment matched nothing at all. Fixed with a guarded (2+ char)
  // contains-match alongside the exact one, so the FILTER (not just the ranking) now
  // finds fragment matches.
  ok('Inventory Parts: a 2+ character SKU/OEM/barcode/Part No. FRAGMENT (not just the complete identifier) now passes the filter, not just the ranking',
    /const idFragment = !exactId && rawQuery\.length >= 2 && \(/.test(src) &&
    /const matchesSearch = exactId \|\| idFragment/.test(src));
  ok('Inventory Parts: with no query, behavior is untouched (column sort, or array order — no ranking overhead)',
    /\} else if \(columnSort\) \{\s*\n\s*result\.sort\(columnSort\);\s*\n\s*\}/.test(src));
  ok('LedgerPage: supports an optional `ids` array via matchIndexed (exact-then-partial, ranked above `s`), alongside the existing partial `s` text (moved to components/common/LedgerPage.jsx)',
    (() => {
      const lp = read('components/common/LedgerPage.jsx');
      return /const entryOf = \(it\) => \(\{ hay: safeLower\(it\.s\), ids: \(it\.ids \|\| \[\]\)\.map\(normId\) \}\);/.test(lp)
        && /if \(needle && !matchIndexed\(entryOf\(it\), needle\)\) return false;/.test(lp);
    })());
  ok('SalesView: SKU and Invoice No. moved into `ids` (exact-only), out of the partial `s` string',
    /ids: \[s\.sku, s\.invoiceNo\],/.test(src));
  ok('ServicesView: Invoice No. moved into `ids` (exact-only)', /ids: \[s\.invoiceNo\],/.test(src));
  // Universal Search review: CommandPalette now builds one useSearchIndex per record
  // type (memoized once per data change, not rebuilt inline per keystroke) and ranks via
  // rankIndexed instead of the old inline matchIndexed({...}, needle) literal per push —
  // same identifier/free-text isolation, verified against the new shape.
  ok('CommandPalette: part SKU is exact-only (via a memoized useSearchIndex, not rebuilt per keystroke)',
    /const partIndex = useSearchIndex\(activeParts, \(p\) => p\.id, \(p\) => \[p\.name\], \(p\) => \[p\.sku\]\);/.test(src));
  ok('CommandPalette: supplier Code + GST are exact-only',
    /const supplierIndex = useSearchIndex\(suppliers, \(s\) => s\.id, \(s\) => \[s\.name, \.\.\.\(s\.altNames \|\| \[\]\)\], \(s\) => \[s\.code, s\.gst\]\);/.test(src));
  ok('CommandPalette: customer Code + registrations are exact-only, name/phone stay partial',
    /const customerIndex = useSearchIndex\(customers, \(c\) => c\.id, \(c\) => \[c\.name, c\.phone\], \(c\) => \[c\.code, \.\.\.\(c\.vehicles \|\| \[\]\)\.flatMap\(\(v\) => \[v\.regNo, v\.reg\]\)\]\);/.test(src));
  ok('CommandPalette: invoice No. + Registration No. are exact-only',
    /const invoiceIndex = useSearchIndex\(invoices, \(iv\) => iv\.id, \(iv\) => \[iv\.customer, iv\.vehicle\], \(iv\) => \[iv\.invNo, iv\.regNo\]\);/.test(src));
  ok('CommandPalette: Job Card No. (full + digits-only) + Registration No. are exact-only',
    /const jobCardIndex = useSearchIndex\(jobCards, \(j\) => j\.jobNo, \(j\) => \[j\.customer, j\.vehicle, j\.status\], \(j\) => \[j\.jobNo, String\(j\.jobNo \|\| ''\)\.replace\(\/\\D\/g, ''\), j\.regNo\]\);/.test(src));
  ok('CommandPalette: results are ranked exact-first before the 30-result cap, so parts (pushed first) can no longer crowd out a better-matching customer/invoice/job-card',
    /if \(needle\) out\.sort\(\(a, b\) => b\.score - a\.score\);/.test(src) && /return out\.slice\(0, 30\);/.test(src));
}

// --- Suppliers (+ Purchase Orders) ---
{
  const src = read('components/inventory/SupplierDirectory.jsx');
  ok('SupplierDirectory: Supplier Code + GST No. are exact-only, name/city/type/phone stay partial',
    /\(s\) => \[s\.code, s\.gst\]/.test(src) && /\(s\) => \[s\.name, \.\.\.\(s\.altNames \|\| \[\]\), s\.city, s\.type, \(s\.phoneNumbers\?\.\[0\]\?\.number \|\| s\.phone \|\| ''\)\]/.test(src));
  ok('SupplierDirectory: Part Number (sku) is exact-only for the in-supplier parts search',
    /\(p\) => \[p\.sku\]/.test(src));
}
{
  const src = read('components/inventory/InventoryPurchaseOrders.jsx');
  ok('InventoryPurchaseOrders: PO Number + item Part Number are exact-only, supplier/item names stay partial',
    /\(p\) => \[p\.poNumber, \.\.\.\(p\.items \|\| \[\]\)\.map\(\(it\) => it\.sku\)\]/.test(src));
}
{
  const src = read('components/inventory/SupplierPOBuilder.jsx');
  ok('SupplierPOBuilder: Part Number (sku) is exact-only', /\(p\) => \[p\.sku\],/.test(src));
}
{
  const src = read('components/inventory/InventoryArchive.jsx');
  ok('InventoryArchive: Part Number (sku) is exact-only, name/category stay partial',
    /\(p\) => \[p\.name, p\.category\], \(p\) => \[p\.sku\]/.test(src));
}

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
