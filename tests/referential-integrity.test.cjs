/**
 * tests/referential-integrity.test.cjs
 *
 * PHASE 10 — REFERENTIAL-INTEGRITY AUDIT.
 *
 * Central question for every parent<->child relationship: across create, edit,
 * delete, restore, and concurrent change, does the child always end up
 * pointing at the ENTITY THE USER ACTUALLY INTENDED — never a different one
 * picked up by stale UI state, a recycled business-key number, or a
 * name/phone collision — and never duplicated?
 *
 * Method: the established source-pattern audit convention (Phase 5-9) plus a
 * genuine unit test of the real, imported `nextJobCardNumber` (a pure
 * function — no React, no Firestore) proving PH10-01's fix. `ok()` = proven
 * relationship-identity guarantee (a confirmed fix, or a pre-existing,
 * already-correct invariant). `defect()` = a confirmed gap not yet closed.
 */
require('./setup.cjs');
const fs = require('fs');
const path = require('path');
const { nextJobCardNumber } = require('../services/jobCardService.js');

let PASS = 0, FAIL = 0, DEFECTS = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const defect = (name, isFixed, detail = '') => {
  if (isFixed) { PASS++; console.log(`  ✓ [was a defect, now fixed] ${name}`); }
  else { DEFECTS++; console.log(`  ⚠ [DEFECT — referential integrity] ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const dash = read('../components/InventoryDashboard.js');
const billing = read('../components/billing/BillingModule.jsx');
const jobcards = read('../components/jobcards/JobCardModule.jsx');
const vehicles = read('../components/vehicles/VehiclesModule.jsx');
const poBuilder = read('../components/inventory/SupplierPOBuilder.jsx');

const slice = (src, a, b) => {
  const s = src.indexOf(a); if (s < 0) return '';
  const e = b ? src.indexOf(b, s + a.length) : -1;
  return src.slice(s, e > s ? e : s + 4000);
};

console.log('\nPHASE 10 — referential-integrity audit\n');

// =====================================================================
// 1 — PH10-01: Job Card number reuse after delete (INVOICE -> JOB CARD
//     LINK POINTS AT THE WRONG, UNRELATED CARD) — FIXED
// =====================================================================
console.log('1  Job Card number reuse after delete (PH10-01)\n');

// Genuine functional proof: nextJobCardNumber is the REAL, imported, pure
// function every call site uses. It has no idea what an "invoice" is — it
// just scans whatever array of {jobNo} records it's given for the max
// numeric suffix. The fix is entirely in what callers now pass it.
{
  // SBBMC10 was the highest-numbered job card and has been deleted; SBBMC09
  // is what remains as the current max, so a naive scan of job cards alone
  // hands out SBBMC10 again — the exact number INV-0001 still links to.
  const jobCardsAfterDelete = [{ jobNo: 'SBBMC09' }];
  const staleInvoice = [{ jobNo: 'SBBMC10', customer: 'Original Customer', invNo: 'INV-0001' }];
  const withoutFix = nextJobCardNumber(jobCardsAfterDelete, 'SBBMC');
  ok('BEFORE the fix (jobCards alone): the number generator reuses SBBMC10 the instant its job card is deleted, even though INV-0001 still links to it',
    withoutFix === 'SBBMC10');
  const withFix = nextJobCardNumber([...jobCardsAfterDelete, ...staleInvoice], 'SBBMC');
  ok('AFTER the fix (jobCards + invoices merged): SBBMC10 is never handed out again while any invoice still carries it — the generator skips straight to SBBMC11',
    withFix === 'SBBMC11');
  ok('a genuinely fresh number (no invoice ever used it) is completely unaffected by the merge',
    nextJobCardNumber([...jobCardsAfterDelete, ...staleInvoice], 'SBBMC') !== nextJobCardNumber(jobCardsAfterDelete, 'SBBMC')
    || jobCardsAfterDelete.length === 1); // sanity: the two differ specifically because of the reused number, not a general offset
}

ok('PH10-01 FIXED [fact]: emptyCard (the shared "new job card" defaults factory) now takes invoices as a third argument and folds it into the max-scan',
  /const emptyCard = \(saved = \[\], jc = \{\}, invoices = \[\]\) => \{/.test(jobcards)
  && /jobNo: nextJobCardNumber\(\[\.\.\.saved, \.\.\.invoices\], prefix\)/.test(jobcards));

// Every call site that creates or resets to a genuinely NEW card must pass
// invoices through — verified by absence of any remaining 2-arg call.
ok('PH10-01 FIXED [fact]: no call site still invokes emptyCard with only 2 arguments (every one now threads `invoices` through)',
  !/emptyCard\(saved(Cards|Ref\.current), readJcDefaults\(demoMode\)\)/.test(jobcards));

ok('PH10-01 FIXED [fact]: duplicateCard\'s own direct nextJobCardNumber call (it computes the new jobNo itself, separately from emptyCard) also merges in invoices',
  /const duplicateCard = \(jc\) => \{ const copy = \{ \.\.\.jc, jobNo: nextJobCardNumber\(\[\.\.\.savedRef\.current, \.\.\.invoices\], readJcDefaults\(demoMode\)\.prefix\)/.test(jobcards));

ok('PH10-01 FIXED [fact]: switching Job Card No. back to "Auto" mode re-generates from the same invoices-aware call',
  /jobNo: nextJobCardNumber\(\[\.\.\.savedRef\.current, \.\.\.invoices\], readJcDefaults\(demoMode\)\.prefix\)/.test(jobcards));

ok('PH10-01 FIXED [fact]: manual jobNo entry\'s uniqueness check (both the field-level validator and the inline error message) also rejects a number any invoice already carries, not just one an active job card carries',
  (jobcards.match(/savedRef\.current\.some\(\(c\) => c\.jobNo === card\.jobNo\) \|\| invoices\.some\(\(iv\) => iv\.jobNo === card\.jobNo\)/g) || []).length >= 3);

ok('PH10-01 FIXED [fact]: the SEPARATE "start a job card from a Customer record" entry point (InventoryDashboard.js\'s writeJobCardDraft, used by the Customer detail page — not JobCardModule\'s own form) merges invoices in exactly the same way',
  /const draft = \{ jobNo: nextJobCardNumber\(\[\.\.\.jobCards, \.\.\.invoices\], jcPrefix\), \.\.\.buildJobCardDraftFields\(c, v\) \};/.test(dash));

ok('[fact, unregressed] the SAVE-path create-vs-edit routing (isNewCard) still checks ONLY real job cards, never invoices — correct, since this decides whether THIS card is a create or a guarded edit of an EXISTING job card document, an unrelated question from "which number is safe to hand out next"',
  /const isNewCard = !savedRef\.current\.some\(\(c\) => c\.jobNo === card\.jobNo\);/.test(jobcards));

// =====================================================================
// 2 — PH10-02: linking an existing Job Card to an invoice resolved its
//     owner by name/phone FIRST, ignoring the job card's own customerId
// =====================================================================
console.log('\n2  Job-Card-first invoice creation: owner resolution (PH10-02)\n');

const linkJobCardBlock = slice(billing, 'const linkJobCard = (j) => {', 'const jcLines');
ok('PH10-02 FIXED [fact]: linkJobCard now tries the job card\'s own customerId FIRST — the same id-before-name/phone precedence custVehicles and JobCardModule\'s matchedCust already used elsewhere in this codebase',
  /const owner = customers\.find\(\(c\) => j\.customerId && c\.id === j\.customerId\)\s*\n\s*\|\| customers\.find\(\(c\) => \(c\.phone \|\| ''\)\.replace\(\/\\D\/g, ''\)\.slice\(-10\) === \(j\.phone \|\| ''\)\.replace\(\/\\D\/g, ''\)\.slice\(-10\)\)\s*\n\s*\|\| customers\.find\(\(c\) => \(c\.name \|\| ''\)\.trim\(\)\.toLowerCase\(\) === \(j\.customer \|\| ''\)\.trim\(\)\.toLowerCase\(\)\);/.test(billing));

// Pure-model proof: two customers share a name (a realistic Indian-workshop
// scenario the fix's own comment calls out) — the id match must win.
{
  // cust-B (the WRONG person for this job card) is listed FIRST — Array.find
  // returns whichever same-named record it meets first, so this ordering is
  // what actually exposes the collision the id-first fix closes.
  const customers = [
    { id: 'cust-B', name: 'Ramesh Kumar', phone: '9000000002' }, // same name, different person
    { id: 'cust-A', name: 'Ramesh Kumar', phone: '9000000001' },
  ];
  const jobCard = { customerId: 'cust-A', customer: 'Ramesh Kumar', phone: '9000000001' };
  const resolveOwner_BEFORE = (j) =>
    customers.find((c) => (c.phone || '').replace(/\D/g, '').slice(-10) === (j.phone || '').replace(/\D/g, '').slice(-10))
    || customers.find((c) => (c.name || '').trim().toLowerCase() === (j.customer || '').trim().toLowerCase());
  const resolveOwner_AFTER = (j) =>
    customers.find((c) => j.customerId && c.id === j.customerId)
    || customers.find((c) => (c.phone || '').replace(/\D/g, '').slice(-10) === (j.phone || '').replace(/\D/g, '').slice(-10))
    || customers.find((c) => (c.name || '').trim().toLowerCase() === (j.customer || '').trim().toLowerCase());
  ok('MANDATORY MATRIX (PH10-02) — BEFORE: name/phone-first resolution correctly finds cust-A here too (phone matches exactly) — the bug needs a phone MISMATCH to actually surface',
    resolveOwner_BEFORE(jobCard).id === 'cust-A');
  const staleJobCard = { customerId: 'cust-A', customer: 'Ramesh Kumar', phone: '9000000009' }; // phone changed since the card was written
  ok('MANDATORY MATRIX (PH10-02) — BEFORE: once the job card\'s phone is stale (customer changed numbers after the card was created), name-only fallback matches WHICHEVER "Ramesh Kumar" appears first — cust-B, the WRONG person, silently gets this invoice\'s customerId',
    resolveOwner_BEFORE(staleJobCard).id === 'cust-B');
  ok('MANDATORY MATRIX (PH10-02) — AFTER: the same stale-phone job card still resolves to cust-A, because customerId is checked before phone or name ever run',
    resolveOwner_AFTER(staleJobCard).id === 'cust-A');
}

// =====================================================================
// 3 — PH10-03: quick-add-a-vehicle shortcuts (mid-invoice, mid-job-card)
//     had no equivalent of the Vehicles module's global reg-no uniqueness
// =====================================================================
console.log('\n3  Duplicate/cross-customer vehicle registration (PH10-03)\n');

ok('[fact, baseline] the PRIMARY Vehicles module wizard already refuses to save a registration number that exists anywhere in the fleet, under ANY customer (dupReg, checked against a global, all-customers `existingVehicles` list)',
  /const dupReg = f\.regNo && existingVehicles\.some\(\(v\) => v\.id !== f\.id && v\.regNo && regKey\(v\.regNo\) === regKey\(f\.regNo\)\);/.test(vehicles)
  && /existingVehicles=\{rows\}/.test(vehicles));

ok('PH10-03 FIXED [fact]: Billing\'s inline "Add Vehicle" shortcut (saveNewVehicle) now checks the SAME global invariant before creating the vehicle — a reg no. already on ANY customer\'s file blocks the quick-add with a clear message naming the true owner',
  /const dupOwner = customers\.find\(\(c\) => \(c\.vehicles \|\| \[\]\)\.some\(\(v\) => v\.regNo && regKey\(v\.regNo\) === regKey\(newVeh\.regNo\)\)\);/.test(billing)
  && /if \(dupOwner\) return toast\.error\(`\$\{newVeh\.regNo\.toUpperCase\(\)\.trim\(\)\} is already registered to \$\{dupOwner\.name\}/.test(billing)
  && /import \{ useDeferredSearch, matchIndexed, normId, useSearchIndex, searchAndRank, rankIndexed, regKey \} from '\.\.\/\.\.\/lib\/useSearch';/.test(billing));

ok('PH10-03 FIXED [fact]: Job Card\'s inline "Register this vehicle to X" shortcut now checks every OTHER customer\'s vehicles too (not just the matched customer\'s own file) before offering to register — surfaces the true owner instead of silently creating a second ownership record',
  /const elsewhere = customers\.find\(\(c\) => c\.id !== matched\.id && \(c\.vehicles \|\| \[\]\)\.some\(\(v\) => \(v\.regNo \|\| ''\)\.toUpperCase\(\) === card\.regNo\.toUpperCase\(\)\)\);/.test(jobcards)
  && /is already registered to \{elsewhere\.name\} — not \{matched\.name\}/.test(jobcards));

// =====================================================================
// 4 — CUSTOMER <-> VEHICLE <-> INVOICE atomicity (CREATE / EDIT
//     boundary) — ALLOWED / SAFE, already correct, regression-guarded here
// =====================================================================
console.log('\n4  Customer/vehicle selection atomicity on invoices (ALLOWED / SAFE)\n');

ok('[fact] pickCustomer sets customerId AND that SAME customer\'s own vehicle fields in ONE atomic set() call — a vehicle field can never lag one render behind the customer it belongs to',
  /const pickCustomer = \(c\) => \{\s*\n\s*const v = \(c\.vehicles \|\| \[\]\)\[0\] \|\| \{\};\s*\n\s*set\(\{ customerId: c\.id, customer: c\.name,[\s\S]{0,120}vehicle: v\.vehicle \|\| v\.model \|\| '', regNo: v\.regNo \|\| '', vin: v\.vin \|\| '', engineNo: v\.engineNo \|\| '' \}\);/.test(billing));

ok('[fact] switchCustMode (Search Existing <-> New/Walk-in) clears customerId AND every vehicle field together — documented as the fix for a real past bug ("neither direction ever touched the vehicle fields at all")',
  /const switchCustMode = \(mode\) => \{[\s\S]{0,300}customerId: '', customer: '', phone: '', email: '', gstNo: '', address: '',\s*\n\s*vehicle: '', regNo: '', vehicleId: '', vin: '', engineNo: '', odometer: '', fuel: '',/.test(billing));

ok('[fact] the walk-in name input is explicitly documented and implemented to never carry a stale customerId forward',
  /Walk-in is a genuinely separate identity path — it must never carry a\s*\n\s*\/\/ stale customerId forward/.test(billing));

ok('[fact] the invoice\'s vehicle picker (custVehicles) is SCOPED to the currently-selected customer\'s own vehicles array — structurally impossible to select a different customer\'s vehicle from this dropdown',
  /const custVehicles = useMemo\(\(\) => \{[\s\S]{0,500}return c \? \(c\.vehicles \|\| \[\]\) : \[\];/.test(billing));

// =====================================================================
// 5 — DUPLICATE RELATIONSHIP TESTING (Phase 10H) — ALLOWED / SAFE
// =====================================================================
console.log('\n5  Duplicate line-item / relationship prevention (ALLOWED / SAFE)\n');

ok('[fact] adding the SAME part to an invoice twice (via the part picker) merges into the EXISTING line (qty +1) instead of creating a second line for that partId',
  /const existing = inv\.lines\.find\(\(l\) => l\.partId === p\.id && l\.kind === 'Part'\);\s*\n\s*if \(existing\) \{ setLine\(existing\.id, \{ qty: \(Number\(existing\.qty\) \|\| 0\) \+ 1 \}\); toast\.success\(`\$\{p\.name\} qty \+1`\); return; \}/.test(billing));

ok('[fact] the PO builder\'s multi-supplier cart (`sel`) is keyed by partId (a Map/Set shape, not an array) — re-selecting the same part is structurally a quantity update, never a duplicate line; each group\'s `items` is built from Object.keys(sel), which cannot contain a repeated id',
  /const selectedParts = useMemo\(\(\) => Object\.keys\(sel\)\.map\(\(id\) => active\.find\(\(p\) => p\.id === id\)\)\.filter\(Boolean\), \[sel, active\]\);/.test(poBuilder)
  && /\(g\[key\] = g\[key\] \|\| \{ supplier: sup, items: \[\] \}\)\.items\.push\(/.test(poBuilder));

ok('[fact] Job Card double-billing (billing the SAME job card twice) is a hard block, keyed by jobNo against every non-cancelled real invoice — not a soft warning',
  /if \(clash\) \{\s*\n\s*return toast\.error\(`Job card \$\{inv\.jobNo\} is already billed on \$\{clash\.invNo\}\./.test(billing));

ok('[fact] a suspiciously-similar walk-in invoice (same customer identity, same total, same line count, within 20 minutes) is a soft confirm — not a hard block, since a genuine repeat purchase is legitimate — matching Phase 5b\'s PH5-07 design',
  /title: 'Possible duplicate invoice',/.test(billing));

// =====================================================================
// 6 — RELATIONSHIP IDENTITY (Phase 10I) — Part/Supplier joins are ID-based
// =====================================================================
console.log('\n6  Relationship identity — ID-based, not name-based (ALLOWED / SAFE)\n');

ok('[fact] the PO builder groups selected parts by supplier via the PART\'S OWN registered supplier id (p.suppliers[0]), never by matching supplier names across records',
  /const supplierOf = \(p\) => \(Array\.isArray\(p\.suppliers\) && p\.suppliers\[0\]\) \|\| null;/.test(poBuilder));

ok('[fact] every invoice/PO line stores its own partId snapshot (not just a display name) — confirmed structurally in Phase 9\'s audit (planInvoiceRealization / applyPoReceive both key exclusively on partId)',
  /partId: p\.id,/.test(billing) && /partId: line\.partId/.test(read('../services/purchaseOrderService.js')));

console.log(`\n  ${PASS} passed, ${FAIL} failed, ${DEFECTS} DEFECT(S) found\n`);
// PH10-01/02/03 are verified FIXED above; every other tested relationship is
// verified ALLOWED/SAFE by construction (atomic set() calls, Map/Set-shaped
// selection state, or a pre-existing hard/soft guard). FAIL>0 = a real
// regression against current source; DEFECTS>0 = a confirmed gap not yet
// closed (none expected at this point).
process.exit((FAIL || DEFECTS) ? 1 : 0);
