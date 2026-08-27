/**
 * tests/vehicles-module.test.cjs — Vehicles module: ranked search, combobox keyboard nav,
 * context-aware drawer footers, new-tab navigation, state persistence, customer deep-link.
 * Behavioural where possible; source guards for JSX wiring.
 */
const fs = require('fs'), path = require('path');
const { rankIndexed, normId } = require('../lib/useSearch.js');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const veh = fs.readFileSync(path.resolve(__dirname, '../components/vehicles/VehiclesModule.jsx'), 'utf8');
const dash = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');
const cust = fs.readFileSync(path.resolve(__dirname, '../components/customers/CustomersModule.jsx'), 'utf8');
const miniSelect = fs.readFileSync(path.resolve(__dirname, '../components/common/MiniSelect.jsx'), 'utf8');

console.log('\nVehicles module — search, combobox, drawer, navigation, persistence\n');

// ── Issue 1: ranked search + fields — REWRITTEN AGAIN (Strict Search Validation review) ──
// History: Vehicles used to rank its final sort via `rankMatch(rankFieldsOf.get(r.id),
// ql)`, a SEPARATE field list/scorer than the `searchIndex` the filter stage actually
// matched against — and `searchIndex`'s own `ids` array mixed the vehicle's OWN
// identifiers (regNo/vin/engineNo/chassisNo/rcNumber) with fanned-out identifiers of TWO
// OTHER collections (owner's Customer ID, linked job/invoice numbers). A first fix moved
// the linked identifiers into a separate, lower-ranked `refIds` band — reproduced live
// and rejected: a vehicle whose OWN reg/VIN had nothing to do with the query could still
// surface merely because ONE OF ITS OWN JOB CARDS happened to be numbered like a
// different record's identifier (this app numbers Job Cards "SBBMC123", the same text
// shape as other identifiers). "Ranked lower" is still "present" for a non-match.
//
// Current, final rule: `useSearchIndex`'s `refIdsFn` mechanism was removed from
// lib/useSearch.js entirely. `ids` now holds ONLY this vehicle's own fields (regNo/vin/
// engineNo/chassisNo/rcNumber); owner Customer ID and linked job/invoice numbers are not
// configured vehicle fields and must never cause a vehicle to appear. The final sort
// ranks via the shared `rankIndexed(searchIndex.get(r.id), dq)` against that SAME index,
// not a second, disconnected field list.
const searchStart = veh.indexOf('const searchIndex = useSearchIndex(');
ok('searchIndex call site found', searchStart !== -1);
const searchBlock = veh.slice(searchStart, searchStart + 700);
ok('imports rankIndexed (not the old, disconnected rankMatch)', /import \{ useDeferredSearch, useSearchIndex, matchIndexed, rankIndexed, regKey, normId \}/.test(veh));
ok('own `ids` holds ONLY this vehicle\'s own fields (regNo/vin/engineNo/chassisNo/rcNumber) — no cross-collection fan-out',
  /\(r\) => \[r\.regNo, r\.vin, r\.engineNo, r\.chassisNo, r\.rcNumber\],/.test(searchBlock));
ok('no refIds/refIdsFn wiring remains — owner Customer ID and linked job/invoice numbers are not searchable vehicle fields',
  !/refIdsFn|ownerCode, \.\.\.jobsOf/.test(searchBlock));
ok('haystack includes chassisNo (PRD requires chassis search) via free text, unaffected', /r\.chassisNo/.test(veh));
ok('placeholder communicates key fields', /Search by Registration, Vehicle, Owner, VIN, Chassis, Engine/.test(veh));
ok('final sort ranks via rankIndexed against the SAME searchIndex the filter used (no more disconnected rankFieldsOf, no more rankMatch(...) calls — a historical-context comment mentioning the old name is fine)',
  /rank: rankIndexed\(searchIndex\.get\(r\.id\), dq\)/.test(veh) && !/rankFieldsOf/.test(veh) && !/rankMatch\(/.test(veh));

// Strict validation behaviour: exact own registration is the only match; a vehicle whose
// only connection to the query is a LINKED job card must not appear at all.
{
  const entryFor = (v) => ({
    hay: [v.owner].filter(Boolean).join(' ').toLowerCase(),
    ids: [v.regNo].filter(Boolean).map(normId),
  });
  const exactReg = { id: 'a', regNo: 'TS09AB1234', owner: 'Suresh' };
  const nameMatch = { id: 'b', regNo: 'TS09AB1111', owner: 'Ramesh Kumar' }; // no match at all
  const linkedJobCollision = { id: 'c', regNo: 'AP31LN9732', owner: 'Someone' }; // its OWN reg has nothing to do with the query; only a (unmodeled) linked job card would have collided
  const rows = [linkedJobCollision, nameMatch, exactReg];
  const idx = new Map(rows.map((r) => [r.id, entryFor(r)]));
  const { searchAndRank } = require('../lib/useSearch.js');
  const out = searchAndRank(rows, idx, (r) => r.id, 'ts09ab1234');
  ok('exactly ONE result: the vehicle whose OWN registration is the exact match',
    out.length === 1 && out[0].id === 'a', out.map((r) => r.id).join(', ') || '(empty)');
  ok('a vehicle with no genuine match on its own fields scores 0 (would be excluded even if a linked job card happened to collide)',
    rankIndexed(entryFor(linkedJobCollision), 'ts09ab1234') === 0);
}

// ── Issue 2: combobox keyboard nav + customer reg search ─────────────────────
// Vehicles used to run its OWN local `function MiniSelect` (shadowing the shared
// components/common/MiniSelect.jsx import — it had no such import at all), with an
// outside-click handler that used `document.addEventListener('mousedown', ...)`
// checking only `ref.current.contains(e.target)`. Since the dropdown panel is
// portalled into <body>, it's never a descendant of that ref — every mousedown on an
// option was treated as "outside" and closed the panel before its own click could
// register, and — confirmed live — a click meant for a manufacturer option landed on
// the wizard's backdrop instead, silently closing the whole Add/Edit Vehicle modal.
// Fixed by deleting the local duplicate and importing the shared, correct MiniSelect
// (which checks both the anchor AND the portalled panel). The shared component was
// missing arrow-key navigation the local one had, so that was ported into the ONE
// shared implementation instead of re-duplicating it locally — every MiniSelect
// caller app-wide (Customer Type, State, Fuel, Transmission, Manufacturer/Model in
// every module) gets it, not just Vehicles.
ok('MiniSelect has keyboard navigation (Arrow/Enter)', /const onKey = \(e\) => \{[\s\S]{0,400}ArrowDown[\s\S]{0,200}ArrowUp[\s\S]{0,200}Enter/.test(miniSelect));
ok('MiniSelect highlights the active option', /i === hi \? 'bg-white\/10/.test(miniSelect));
ok('Vehicles no longer runs its own local MiniSelect (imports the shared one)',
  !/function MiniSelect\(/.test(veh) && /import MiniSelect from '\.\.\/common\/MiniSelect'/.test(veh));
ok('customer selector searches by registration number too', /\.\.\.\(c\.vehicles \|\| \[\]\)\.map\(\(v\) => v\.regNo\)/.test(veh));
ok('customer selector has keyboard nav', /setCustHi\(\(h\) => Math\.min/.test(veh));

// ── Issue 3: context-aware drawer footers + clickable records ────────────────
ok('drawer footer is context-aware per tab', /const actions = \{[\s\S]{0,1200}Overview:[\s\S]{0,1200}Service:[\s\S]{0,1200}Invoices:/.test(veh));
ok('Service tab footer offers Create Job Card', /Service: \[[\s\S]{0,200}Create Job Card/.test(veh));
ok('Insurance tab footer offers Edit + Renew Insurance (PRD)', /Insurance: \[[\s\S]{0,300}Edit Insurance[\s\S]{0,200}Renew Insurance/.test(veh));
ok('existing job cards clickable (open handler)', /onClick=\{\(\) => onOpenJobCard\?\.\(j\)\}/.test(veh));
ok('existing invoices clickable (open handler)', /onClick=\{\(\) => onOpenInvoice\?\.\(iv\)\}/.test(veh));
ok('owner clickable → open customer', /onClick=\{\(\) => onOpenCustomer\?\.\(\{ id: selected\.ownerId/.test(veh));
ok('no leftover single generic footer (Job Card + Edit) ', !/<ClipboardList size=\{14\} \/> Job Card<\/button>\s*\{canManage && <button onClick=\{\(\) => setEdit\(selected\)\} className="h-10 rounded-xl text-xs font-bold bg-white\/5/.test(veh));

// ── Issue: new-tab navigation wired (true browser tab) ───────────────────────
ok('Vehicles create Job Card opens a new tab with token', /writeJobCardDraft\(c, tok\);[\s\S]{0,120}open=newjobcard:\$\{tok\}/.test(dash));
ok('Vehicles existing Job Card opens via deep-link', /window\.open\(`\/\?open=jobcard:\$\{encodeURIComponent/.test(dash));
ok('Vehicles owner opens customer via deep-link', /window\.open\(`\/\?open=customer:\$\{encodeURIComponent/.test(dash));
ok('reader maps customer deep-link to customers tab', /customer: 'customers'/.test(dash));
ok('customer deep-link records open-target', /localStorage\.setItem\('maruti_customer_open', query\)/.test(dash));
ok('Customers module consumes maruti_customer_open', /maruti_customer_open[\s\S]{0,400}setSelId\(match\.id\)/.test(cust));

// ── Issue: state persistence (tab switch + refresh) ──────────────────────────
// NAVIGATION STATE + DATA FRESHNESS REVIEW: the cache is now a plain in-memory
// module-scope object, not sessionStorage-backed — surviving a real reload was the bug
// that review flagged, not a feature. Still survives a tab-switch unmount for free (the
// JS module stays loaded), just resets on reload since the module re-evaluates then.
ok('Vehicles view-state cache exists', /const vehiclesViewState = defaultVehView\(\);/.test(veh));
ok('Vehicles state is NOT sessionStorage-backed', !/sessionStorage\.(get|set)Item/.test(veh));
ok('Vehicles restores q/filters/sort/page/selected/tab', /const \[q, setQ\] = useState\(VV\.q\)/.test(veh) && /useState\(VV\.sortBy\)/.test(veh) && /useState\(VV\.detailTab/.test(veh));
ok('page-reset guarded so restore is not clobbered', /vDidMount\.current/.test(veh));
ok('page scroll restored/saved', /appScrollTo\(\{ top: VV\.scrollY \}\)/.test(veh) && /VV\.scrollY = appScrollY\(\)/.test(veh));

// ── Issue 1: table layout ────────────────────────────────────────────────────
ok('registration badge does not wrap/clip', /inline-block whitespace-nowrap text-\[11px\] font-bold px-2 py-0\.5 rounded-md/.test(veh));
ok('table scrolls horizontally with min width', /overflow-x-auto hidden md:block/.test(veh) && /min-w-\[880px\]/.test(veh));

// ── Vehicle validation (dup reg/vin/engine) ─────────────────────────────────
ok('duplicate registration blocked', /A vehicle with this registration already exists/.test(veh));
ok('duplicate VIN blocked', /This VIN already exists/.test(veh));
ok('registration required', /Registration Number" req/.test(veh));



// ── Phase 2 self-review fixes ────────────────────────────────────────────────
(function phase2() {
  const jc = fs.readFileSync(path.resolve(__dirname, '../components/jobcards/JobCardModule.jsx'), 'utf8');
  const bill = fs.readFileSync(path.resolve(__dirname, '../components/billing/BillingModule.jsx'), 'utf8');
  // scrollIntoView added to both comboboxes. Issue 7.5 (Stock Operations review) gave
  // MiniSelect optional grouped-options rendering (non-clickable group-label rows), so
  // option buttons are no longer reliably the Nth DOM child — scroll-into-view now
  // finds the highlighted option via a `data-idx` attribute instead of positional
  // indexing, which works identically whether options are grouped or flat.
  ok('MiniSelect scrolls highlighted row into view', /listRef\.current\?\.querySelector\(`\[data-idx="\$\{hi\}"\]`\)[\s\S]{0,60}scrollIntoView/.test(miniSelect));
  ok('customer selector scrolls highlighted row into view', /custListRef\.current\?\.children\?\.\[custHi\][\s\S]{0,60}scrollIntoView/.test(veh));
  // footer honesty: no misleading "View All Job Cards/Invoices" that opened the customer
  ok('View All Job Cards action present (PRD)', /View All Job Cards/.test(veh) && /onViewJobCards\?\.\(selected\)/.test(veh));
  ok('View All Invoices action present (PRD)', /View All Invoices/.test(veh) && /onViewInvoices\?\.\(selected\)/.test(veh));
  // deep-link race fixes: resolve when data arrives, not mount-only
  ok('customer deep-link resolves on data arrival (not mount-only)', /pendingCustOpen[\s\S]{0,600}\}, \[customers\]\)/.test(cust));
  ok('jobcard deep-link resolves on savedCards arrival', /pendingJobOpen[\s\S]{0,1200}\}, \[savedCards\]\)/.test(jc));
  ok('invoice deep-link resolves on invoices arrival', /pendingInvOpen[\s\S]{0,700}\}, \[invoices, canManage\]\)/.test(bill));
  ok('deep-link keys consumed once (guard refs)', /custOpenDone\.current/.test(cust) && /jobOpenDone\.current/.test(jc) && /invOpenDone\.current/.test(bill));
})();
console.log(`\n  (phase 2 addendum)\n`);



// ── Phase 2.5 corrections ────────────────────────────────────────────────────
(function phase25() {
  // PRD footer actions restored (exact labels)
  ok('Documents footer has Upload + View All Documents', /Upload Document/.test(veh) && /View All Documents/.test(veh));
  ok('Timeline footer has View Full History', /View Full History/.test(veh));
  // View All → true tab, reg-filtered deep-links
  ok('View All Job Cards opens jobcardlist deep-link with reg', /open=jobcardlist:\$\{encodeURIComponent\(v\.regNo/.test(dash));
  ok('View All Invoices opens invoicelist deep-link with reg', /open=invoicelist:\$\{encodeURIComponent\(v\.regNo/.test(dash));
  ok('reader maps jobcardlist/invoicelist to modules', /jobcardlist: 'jobcards', invoicelist: 'billing'/.test(dash));
  ok('reader sets jobcard list filter', /localStorage\.setItem\('maruti_jobcard_list_filter', query\)/.test(dash));
  ok('reader sets invoice list filter', /localStorage\.setItem\('maruti_invoice_list_filter', query\)/.test(dash));
  // consumers filter the lists
  const jc = fs.readFileSync(path.resolve(__dirname, '../components/jobcards/JobCardModule.jsx'), 'utf8');
  const bill = fs.readFileSync(path.resolve(__dirname, '../components/billing/BillingModule.jsx'), 'utf8');
  ok('JobCard module consumes jobcard list filter', /maruti_jobcard_list_filter[\s\S]{0,120}setSavedQ\(reg\)/.test(jc));
  ok('Billing module consumes invoice list filter', /maruti_invoice_list_filter[\s\S]{0,120}setQ\(reg\)/.test(bill));
  // Inline Create New Customer — no navigate-away
  ok('wizard has inline quick-create customer', /const submitQuickCust = /.test(veh) && /setQuickCust\(/.test(veh));
  ok('quickCreateCustomer creates + returns a customer', /const quickCreateCustomer = [\s\S]{0,700}return created;/.test(veh));
  // Universal Notification Architecture review — quickCreateCustomer used to hand
  // back "created" (and this caller treated it as confirmed) the instant setCustomers
  // was CALLED, not after the write behind it actually resolved. Now awaited, same
  // premature-success fix as writeVehicle/archiveVehicle/deleteVehicle already had.
  ok('inline create auto-selects the new customer', /const created = await onQuickCustomer\?\.\([\s\S]{0,120}set\(\{ customerId: created\.id \}\)/.test(veh));
  ok('Create New Customer no longer navigates away (setActiveTab removed for vehicles)', !/onCreateCustomer=\{\(\) => setActiveTab\('customers'\)\}/.test(dash));
})();
console.log(`\n  (phase 2.5 addendum)\n`);



// ── Phase 3.1: Add Note + View Full History (vehicle history) ────────────────
(function phase31() {
  ok('Notes footer has BOTH Add Note and Edit Notes', /Notes: \[[\s\S]{0,300}Add Note[\s\S]{0,300}Edit Notes/.test(veh));
  ok('Add Note opens the note composer', /setNoteText\(''\); setAddNoteFor\(selected\)/.test(veh));
  ok('addNote appends to notesLog (non-destructive)', /notesLog: \[\.\.\.\(x\.notesLog \|\| \[\]\), entry\]/.test(veh));
  ok('addNote does not touch structured note fields', /const addNote = [\s\S]{0,500}notesLog: \[\.\.\./.test(veh) && !/const addNote = [\s\S]{0,500}notes:/.test(veh));
  ok('notesLog entries are displayed in the Notes tab', /selected\.notesLog \|\| \[\]\)\.length > 0/.test(veh));
  // View Full History now shows VEHICLE history (not customer)
  ok('View Full History opens the vehicle history modal', /setHistoryFor\(selected\)/.test(veh));
  ok('View Full History no longer opens the customer', !/View Full History<\/button>[\s\S]{0}/.test(veh) || !/onOpenCustomer\?\.\(owner\)\} className=\{btnS\}><Eye size=\{14\} \/> View Full History/.test(veh));
  ok('history modal renders vehicle history entries', /historyFor\.history \|\| \[\]\)\]\.reverse\(\)/.test(veh));
})();
console.log(`\n  (phase 3.1 addendum)\n`);

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
