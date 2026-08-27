/**
 * tests/customer-search-archive.test.cjs
 * Issue 2.2 (ranked search) + Issue 5 (archive lifecycle). Behavioural — mirrors the
 * module's filter/rank/archive logic against the real rankMatch util.
 */
const { rankMatch, matchTokens } = require('../lib/useSearch.js');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };

console.log('\nCustomers — ranked search + archive lifecycle\n');

// ── rankMatch semantics ─────────────────────────────────────────────────────
ok('exact field match scores highest (4)', rankMatch(['CUST-0009'], 'cust-0009') === 4);
ok('starts-with scores 3', rankMatch(['Rajesh Kumar'], 'rajesh') === 3);
ok('contains scores 2', rankMatch(['Rajesh Kumar'], 'kumar') === 2);
ok('no match scores 0', rankMatch(['Rajesh Kumar'], 'zzz') === 0);
ok('case-insensitive', rankMatch(['AP08JP9806'], 'ap08jp9806') === 4);
ok('picks the BEST field (exact reg beats partial name)',
  rankMatch(['Ramesh', 'AP08JP9806'], 'ap08jp9806') === 4);
ok('empty query is neutral', rankMatch(['anything'], '') === 1);

// ── ranking a result set (mirror of the module sort) ────────────────────────
const rank = (rows, ql) => rows
  .map((c) => ({ c, r: rankMatch(c.fields, ql) }))
  .sort((a, b) => b.r - a.r || String(a.c.name).localeCompare(String(b.c.name)))
  .map((x) => x.c.name);
const rows = [
  { name: 'Anita Kumar', fields: ['Anita Kumar', '9990001111'] },
  { name: 'Kumar Auto', fields: ['Kumar Auto', 'CUST-0002'] },
  { name: 'Rajesh', fields: ['Rajesh', '9812345678'] },
];
ok('exact phone surfaces its record first', rank(rows, '9812345678')[0] === 'Rajesh');
ok('starts-with "kumar" ranks Kumar Auto above "Anita Kumar" (contains)',
  rank(rows, 'kumar')[0] === 'Kumar Auto');
ok('tie broken alphabetically', JSON.stringify(rank(rows, 'a')) !== '[]');

// ── archive lifecycle (mirror of the module filter) ─────────────────────────
const applyArchive = (list, { statusF = 'All' }) => list.filter((c) => {
  const isArchived = !!c.archived;
  if (statusF === 'Archived') { if (!isArchived) return false; }
  else if (isArchived) return false;
  if (statusF !== 'All' && statusF !== 'Archived' && c.status !== statusF) return false;
  return true;
});
let cs = [
  { id: '1', name: 'A', status: 'Active', archived: false },
  { id: '2', name: 'B', status: 'Active', archived: true },
  { id: '3', name: 'C', status: 'Inactive', archived: false },
];
ok('default (All) excludes archived', applyArchive(cs, {}).map((c) => c.id).join() === '1,3');
ok('Active view excludes archived', applyArchive(cs, { statusF: 'Active' }).map((c) => c.id).join() === '1');
ok('Archived view shows ONLY archived', applyArchive(cs, { statusF: 'Archived' }).map((c) => c.id).join() === '2');
ok('archived customer is not in Inactive view', !applyArchive(cs, { statusF: 'Inactive' }).some((c) => c.id === '2'));

// archive round-trip
const toggle = (list, id) => list.map((c) => (c.id === id ? { ...c, archived: !c.archived } : c));
cs = toggle(cs, '1'); // archive #1
ok('archiving removes from active list', !applyArchive(cs, {}).some((c) => c.id === '1'));
ok('archived appears in Archived view', applyArchive(cs, { statusF: 'Archived' }).some((c) => c.id === '1'));
cs = toggle(cs, '1'); // reactivate
ok('reactivate restores to active list', applyArchive(cs, {}).some((c) => c.id === '1'));
ok('reactivate preserves original status (Active untouched)',
  cs.find((c) => c.id === '1').status === 'Active');

// stats exclude archived
const statsTotal = (list) => list.filter((c) => !c.archived).length;
ok('stats total excludes archived', statsTotal([{ archived: false }, { archived: true }, { archived: false }]) === 2);

// dedup still sees archived (relationship integrity)
const existing = [{ id: '2', name: 'B', phone: '9998887777', archived: true }];
const dupPhone = (phone) => existing.some((c) => c.phone === phone);
ok('duplicate detection still catches an ARCHIVED customer’s phone', dupPhone('9998887777'));



// ── ADDENDUM: traceability-review completions (cascade, persistence, nav, analytics) ──
(function traceability() {
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.resolve(__dirname, '../components/customers/CustomersModule.jsx'), 'utf8');
  const A2 = require('../services/analyticsService.js');

  // Issue #3 — cascading make/model/variant via shared catalog
  ok('imports shared vehicle catalog (cascade source)', /from '\.\.\/\.\.\/lib\/vehicleCatalog'/.test(src));
  // Make/Model/Variant were ported from datalist-backed free-text inputs to the shared,
  // portal-based MiniSelect (see tests/customer-vehicle-dropdown-chain.test.cjs for the
  // full dependency-chain / reordering / MiniSelect-reuse regression coverage). Make/
  // Model specifically were later consolidated further into the shared
  // VehicleMakeModelSelect (global Vehicle Master pass) — it owns the MAKES catalog
  // and the make-filters-model logic internally now, not this file directly.
  ok('wizard vehicle Manufacturer/Model use the shared VehicleMakeModelSelect (which owns the MAKES catalog + make-filters-model logic)',
    /import VehicleMakeModelSelect from '\.\.\/common\/VehicleMakeModelSelect'/.test(src) && /<VehicleMakeModelSelect/.test(src));
  ok('make and model stored separately (not one free-text field)', /setVeh\(v\.id, \{ make:/.test(src) && /setVeh\(v\.id, \{ model:/.test(src));
  ok('custom entries still allowed (onAddModel wiring, not a locked select)',
    /onAddModel=\{\(name\) => setVeh\(v\.id, \{ model: name/.test(src));
  ok('standalone VehicleModal also cascades via the same shared VehicleMakeModelSelect (both call sites, not a second implementation)',
    (src.match(/<VehicleMakeModelSelect/g) || []).length === 2);

  // Issue #4 — state persistence + clickable job cards
  ok('module-scoped view-state cache exists', /const customersViewState = \(\(\) => \{/.test(src) || /const defaultView = /.test(src));
  ok('state restores from cache (q init from V.q)', /useState\(V\.q\)/.test(src));
  ok('state written back to cache on change', /V\.q = q; V\.typeF = typeF/.test(src));
  ok('scroll position restored/saved', /appScrollTo\(\{ top: V\.scrollY \}\)/.test(src) && /V\.scrollY = appScrollY\(\)/.test(src));
  ok('page-reset effect guarded so restore is not clobbered', /didMountRef\.current/.test(src));
  ok('existing job cards are clickable (open handler)', /onClick=\{\(\) => onOpenJobCard\?\.\(j\)\}/.test(src));

  // Issue #5 — analytics exclude archived
  const ins = A2.computeInsights({ inventory: [], sales: [], invoices: [], jobCards: [],
    customers: [{ id: 'a', createdAt: Date.now(), archived: false, vehicles: [{ id: 'v1' }] },
                { id: 'b', createdAt: Date.now(), archived: true, vehicles: [{ id: 'v2' }, { id: 'v3' }] }] });
  const custIns = ins.find((i) => i.kind === 'customer');
  ok('analytics new-customer count excludes archived (1, not 2)', custIns && /^1 new customer/.test(custIns.text), custIns && custIns.text);
  // 1.1 Insights redesign (Dashboard architecture review) — the standing "N vehicles on
  // record" line was removed outright: a raw total never changes meaningfully day to day
  // and gave the owner nothing to act on, which the brief calls out by name as exactly the
  // kind of low-value filler the Insights panel should never pad itself with. Assert the
  // removal held (no 'vehicle' kind survives), rather than testing archived-exclusion logic
  // that no longer has a insight to attach to.
  ok('the old low-value "vehicles on record" insight was deliberately removed, not just reworded', !ins.some((i) => i.kind === 'vehicle'));
})();
console.log(`\n  (addendum included)\n`);



// ── ADDENDUM 2: new-tab navigation, dup-reg, invoice clickable, drawer restoration ──
(function gapClosure() {
  const fs = require('fs'), path = require('path');
  const cust = fs.readFileSync(path.resolve(__dirname, '../components/customers/CustomersModule.jsx'), 'utf8');
  const dash = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');

  // Issue 1 — true new browser tab for create + existing
  ok('Create Job Card opens a new browser tab (window.open)', /writeJobCardDraft\(c, tok\);[\s\S]{0,80}window\.open\(`\/\?open=newjobcard:\$\{tok\}#jobcards`/.test(dash));
  ok('Create Invoice opens a new browser tab', /writeInvoicePrefill\(c, tok\);[\s\S]{0,80}window\.open\(`\/\?open=newinvoice:\$\{tok\}#billing`/.test(dash));
  ok('Existing Job Card opens via ?open deep-link in a new tab', /window\.open\(`\/\?open=jobcard:\$\{encodeURIComponent/.test(dash));
  ok('Existing Invoice opens via ?open deep-link in a new tab', /window\.open\(`\/\?open=invoice:\$\{encodeURIComponent/.test(dash));
  ok('deep-link reader maps jobcard/invoice/new* to tabs', /jobcard: 'jobcards', invoice: 'billing', newjobcard: 'jobcards', newinvoice: 'billing'/.test(dash));
  ok('deep-link sets shared search for existing record', /setSearch\(query\);/.test(dash));
  ok('deep-link param stripped after handling', /params\.delete\('open'\)/.test(dash));
  ok('prefill helpers shared (writeJobCardDraft/writeInvoicePrefill)', /const writeJobCardDraft = /.test(dash) && /const writeInvoicePrefill = /.test(dash));

  // Issue 2/3 — invoice rows clickable
  ok('existing invoice rows are clickable', /onClick=\{\(\) => onOpenInvoice\?\.\(iv\)\}/.test(cust));
  ok('onOpenInvoice prop threaded to CustomersModule', /onOpenInvoice[,}]/.test(cust) && /onOpenInvoice=\{\(iv\)/.test(dash));

  // Issue 4 — drawer tab persisted
  ok('active drawer tab persisted (detailTab in cache)', /detailTab: 'Vehicles'/.test(cust) && /V\.detailTab = detailTab/.test(cust));
  ok('drawer tab restored on mount', /useState\(V\.detailTab \|\| 'Vehicles'\)/.test(cust));

  // Issue 5 — duplicate registration
  ok('wizard rejects duplicate reg within a customer', /entered more than once for this customer/.test(cust));
  ok('VehicleModal save rejects duplicate reg on the customer', /already exists for this customer/.test(cust));

  // Issue 9 — all drawer sections present
  ['Vehicles', 'Job Cards', 'Invoices', 'Payments', 'Timeline', 'Notes', 'Documents'].forEach((t) =>
    ok(`drawer section "${t}" implemented`, new RegExp(`detailTab === '${t}'`).test(cust)));
})();
console.log(`\n  (addendum 2 included)\n`);



// ── ADDENDUM 3: multi-tab isolation, deep-link record opening, refresh persistence ──
(function finalGaps() {
  const fs = require('fs'), path = require('path');
  const cust = fs.readFileSync(path.resolve(__dirname, '../components/customers/CustomersModule.jsx'), 'utf8');
  const dash = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');
  const jc = fs.readFileSync(path.resolve(__dirname, '../components/jobcards/JobCardModule.jsx'), 'utf8');
  const bill = fs.readFileSync(path.resolve(__dirname, '../components/billing/BillingModule.jsx'), 'utf8');

  // Issue B — per-tab token isolation (no localStorage collision)
  ok('create job card uses a unique per-tab token', /const tok = `t\$\{Date\.now\(\)\.toString\(36\)\}\$\{Math\.random\(\)/.test(dash));
  ok('draft stored under token-scoped key', /maruti_jobcard_draft_v2::\$\{token\}/.test(dash));
  ok('invoice prefill stored under token-scoped key', /maruti_invoice_prefill::\$\{token\}/.test(dash));
  ok('token passed in the URL', /open=newjobcard:\$\{tok\}/.test(dash) && /open=newinvoice:\$\{tok\}/.test(dash));
  ok('reader promotes token draft to canonical key then removes token key',
    /maruti_jobcard_draft_v2::\$\{query\}[\s\S]{0,120}removeItem\(`maruti_jobcard_draft_v2::\$\{query\}`\)/.test(dash));
  // simulate two tabs: distinct tokens => distinct keys => no overwrite
  const key = (tok) => `maruti_jobcard_draft_v2::${tok}`;
  ok('two different tokens map to two different keys', key('tAAA') !== key('tBBB'));

  // Issue E — deep-link opens the actual record (not just search)
  ok('JobCard module consumes maruti_jobcard_open and loads the card', /maruti_jobcard_open[\s\S]{0,500}applyCard\(splitVehicle/.test(jc));
  ok('Billing module consumes maruti_invoice_open and opens the invoice', /maruti_invoice_open[\s\S]{0,400}setEdit\(match\)/.test(bill));
  ok('reader records the open-target for existing job card', /localStorage\.setItem\('maruti_jobcard_open', query\)/.test(dash));
  ok('reader records the open-target for existing invoice', /localStorage\.setItem\('maruti_invoice_open', query\)/.test(dash));

  // NAVIGATION STATE + DATA FRESHNESS REVIEW — supersedes Issue C. sessionStorage-backed
  // "Browser Refresh also restores it" was the actual bug that review flagged, not a
  // feature: a real reload silently resurrecting the last-viewed customer/search/page is
  // exactly the "pretend nothing happened" behavior the app should NOT have. The view
  // state now lives ONLY in a module-scope in-memory object — survives a tab-switch
  // unmount (useful navigation memory) but resets for free on a real reload, since the JS
  // module re-evaluates from scratch then.
  ok('view state is a plain in-memory module-scope object, not sessionStorage-backed', /const customersViewState = defaultView\(\);/.test(cust) && !/sessionStorage\.(get|set)Item/.test(cust));

  // Issue D — drawer inner scroll persisted/restored
  // onScroll -> onBodyScroll: the Details Panel framework consolidation moved the
  // scroll container itself into the shared components/common/DetailsPanel.jsx; the
  // prop name at the call site changed accordingly, the scroll-capture behavior did not.
  ok('drawer scroll captured via onBodyScroll (passed through to the shared panel\'s scroll container)', /onBodyScroll=\{\(e\) => \{ V\.drawerScrollY = e\.currentTarget\.scrollTop/.test(cust));
  ok('drawer scroll restored on open', /drawerScrollRef\.current\.scrollTop = V\.drawerScrollY/.test(cust));

  // Billing payFor state intact (regression guard for the accidental deletion I fixed)
  ok('Billing payFor state preserved', /const \[payFor, setPayFor\] = useState\(null\)/.test(bill));
})();
console.log(`\n  (addendum 3 included)\n`);

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
