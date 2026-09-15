/**
 * tests/jobcard-hardening.test.cjs — Services (Job Cards) Phase A workflow hardening:
 * inline validation, generate/view invoice, status confirmation, list persistence,
 * customer/vehicle quick links, override logging.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const jc = fs.readFileSync(path.resolve(__dirname, '../components/jobcards/JobCardModule.jsx'), 'utf8');
const dash = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');
const bill = fs.readFileSync(path.resolve(__dirname, '../components/billing/BillingModule.jsx'), 'utf8');
const veh = fs.readFileSync(path.resolve(__dirname, '../components/vehicles/VehiclesModule.jsx'), 'utf8');

console.log('\nServices — Phase A workflow hardening\n');

// Part 1 inline validation
ok('per-field errors derived for jobNo/customer/regNo', /const fieldErrors = \{/.test(jc) && /jobNo:/.test(jc) && /customer: !card\.customer\.trim\(\)/.test(jc) && /regNo: !card\.regNo\.trim\(\)/.test(jc));
ok('errors shown after touch or blocked save', /const showErr = \(k\) => \(\(touched\[k\] \|\| triedSave\)/.test(jc));
ok('blocked save reveals errors (keeps toast)', /if \(err\) \{ setTriedSave\(true\); toast\.error\(err\); return; \}/.test(jc));
ok('customer input has red border + aria', /showErr\('customer'\) \? 'border-red-500\/70'/.test(jc) && /aria-invalid=\{!!showErr\('customer'\)\}/.test(jc) && /aria-describedby=\{showErr\('customer'\) \? 'err-customer'/.test(jc));
ok('regNo input has red border + aria', /aria-invalid=\{!!showErr\('regNo'\)\}/.test(jc));
ok('jobNo manual input has aria', /aria-invalid=\{!!showErr\('jobNo'\)\}/.test(jc));
ok('Field error has id + role=alert (SR announce)', /\{error && <p id=\{errorId\} role="alert"/.test(jc));
ok('validate() logic unchanged (single source of truth)', /function validate\(\) \{[\s\S]{0,400}Job Card Number is required/.test(jc));

// Part 2 generate/view invoice
ok('existing invoice detected by jobNo', /const existingInv = \(invoices \|\| \[\]\)\.find\(\(iv\) => iv\.jobNo && card\.jobNo && iv\.jobNo === card\.jobNo\)/.test(jc));
ok('Generate Invoice only when Ready/Delivered/Closed', /\['Ready', 'Delivered', 'Closed'\]\.includes\(card\.status\)/.test(jc));
ok('View Invoice replaces Generate when invoice exists', /existingInv[\s\S]{0,200}View Invoice/.test(jc));
ok('invoice prefill carries jobNo (link + dedup)', /jobNo: jc\.jobNo \|\| ''/.test(dash) && /jobNo: pf\.jobNo \|\| ''/.test(bill));
ok('uses existing Billing (newinvoice deep-link)', /open=newinvoice:\$\{tok\}#billing/.test(dash));

// Part 3 status confirmation
ok('confirm required for Cancelled/Closed/regression', /if \(s === 'Cancelled' \|\| s === 'Closed' \|\| isRegression\)/.test(jc));
ok('confirm modal shows from→to + reason', /Change status\?/.test(jc) && /Reason \(optional\)/.test(jc));
ok('applyStatus records reason + override', /if \(reason\) entry\.reason = reason/.test(jc) && /if \(isOverride\) entry\.override = true/.test(jc));
ok('forward steps still immediate', /applyStatus\(s\);\n  \};/.test(jc));

// Part 4 list persistence — NAVIGATION STATE + DATA FRESHNESS REVIEW superseded the
// sessionStorage mirror: a real reload silently restoring the last search/filter was the
// bug, not a feature. Now a plain in-memory module-scope object — survives a tab-switch
// unmount, resets for free on reload.
ok('list view is a plain in-memory module-scope object, not sessionStorage-backed', /const jcViewState = defaultJCView\(\);/.test(jc) && !/sessionStorage\.(get|set)Item/.test(jc));
ok('search + filter restored on mount from the in-memory cache', /const \[savedQ, setSavedQ\] = useState\(jcViewState\.q\)/.test(jc));
ok('persistence independent of DRAFT_KEY', /DRAFT_KEY \(the in-progress job card autosave\), which is separate, protected business data/.test(jc));

// Part 5 quick links
ok('View Customer / View Vehicle buttons', /View Customer/.test(jc) && /View Vehicle/.test(jc));
ok('customer opens via deep-link new tab', /open=customer:\$\{encodeURIComponent\(c\.code \|\| c\.id/.test(dash));
ok('vehicle opens via deep-link new tab', /open=vehicles:\$\{encodeURIComponent\(reg/.test(dash));
// Was: the module only read the token and called setQ(reg) — a search-reliant filter,
// not opening the exact vehicle. Now it resolves the token against the loaded vehicle
// rows and selects the exact match directly (see customer-row-selection-equivalent
// pendingVehOpen/vehOpenDone pattern, shared with Customers/Job Cards/Billing).
ok('vehicles module consumes the deep-link by opening the exact matching vehicle directly (not just filtering by search)',
  /const pendingVehOpen = useRef\(null\)/.test(veh) &&
  /localStorage\.getItem\('maruti_vehicles_open'\)/.test(veh) &&
  /const match = rows\.find\(\(r\) => norm\(r\.regNo\) === norm\(key\)\)/.test(veh) &&
  /setSelId\(match\.id\)/.test(veh));

// runtime
const STATUSES = ['Received', 'Inspection', 'Estimate Ready', 'Estimate Approved', 'Waiting Parts', 'Repair Started', 'Repair Paused', 'Quality Check', 'Wash', 'Ready', 'Delivered', 'Closed', 'Cancelled'];
const needsConfirm = (from, to) => { const cur = STATUSES.indexOf(from), nxt = STATUSES.indexOf(to); const isReg = nxt >= 0 && cur >= 0 && nxt < cur && to !== 'Cancelled'; return to === 'Cancelled' || to === 'Closed' || isReg; };
ok('runtime: cancel/close/regression need confirm', needsConfirm('Repair Started', 'Cancelled') && needsConfirm('Ready', 'Closed') && needsConfirm('Quality Check', 'Inspection'));
ok('runtime: forward step no confirm', needsConfirm('Received', 'Inspection') === false);

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
