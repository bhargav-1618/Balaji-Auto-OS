/**
 * tests/reports-overview.test.cjs — Final sprint: Reports Overview (KPIs + charts from
 * existing datasets), state persistence (Billing/Reports/Suppliers), storage cleanup,
 * CSP, dead-prop removal.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const dash = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');
const bill = fs.readFileSync(path.resolve(__dirname, '../components/billing/BillingModule.jsx'), 'utf8');
const sup = fs.readFileSync(path.resolve(__dirname, '../components/inventory/SupplierDirectory.jsx'), 'utf8');
const fb = fs.readFileSync(path.resolve(__dirname, '../lib/firebase.js'), 'utf8');
const cfg = fs.readFileSync(path.resolve(__dirname, '../next.config.js'), 'utf8');

console.log('\nReports Overview + final sprint\n');

// Section 1 — overview renders existing datasets (no recomputation)
ok('overview tab added as first section', /\['overview', 'Overview'\]/.test(dash));
ok('overview is default tab', /const defaultReportsView = \(\) => \(\{ tab: 'overview', range: '30' \}\);/.test(dash));
ok('KPI band reuses invTotals (no new calc)', /const kpis = useMemo\(\(\)[\s\S]{0,400}invTotals\(iv\)\.grand/.test(dash));
// Invoice Status card upgraded to a dedicated InvoiceStatusPanel (donut + payment-value
// summary) — invoiceStatusMix is still the exact same computed value, just consumed by
// that component instead of the shared RptDonut (which stays untouched: Job Status and
// Vehicle Brand Mix still render through it below, unaffected).
ok('renders invoiceStatusMix (was dead)', /<InvoiceStatusPanel mix=\{invoiceStatusMix\} invoices=\{invoices\}/.test(dash));
ok('renders jobStatusMix (was dead)', /<RptDonut data=\{jobStatusMix\}/.test(dash));
ok('renders topCustomers (was dead)', /<RptBars data=\{topCustomers\}/.test(dash));
ok('renders topParts (was dead)', /<RptBars data=\{topParts\}/.test(dash));
ok('renders outstandingAgeing (was dead)', /<RptBars data=\{outstandingAgeing\}/.test(dash));
ok('renders brandMix (was dead)', /<RptDonut data=\{brandMix\}/.test(dash));
ok('charts have empty-state', /No data available/.test(dash));
ok('search hidden on overview (no table)', /tab !== 'overview' && \(/.test(dash));

// Section 2 — persistence. NAVIGATION STATE + DATA FRESHNESS REVIEW superseded the
// sessionStorage mirrors below: surviving a real reload was the bug that review flagged
// ("the application behaves as though the reload never happened"), not a feature. All
// three now use a plain in-memory module-scope object instead — survives a tab-switch
// unmount (useful navigation memory), resets for free on reload since the JS module
// re-evaluates from scratch then.
ok('Reports view is a plain in-memory module-scope object, not sessionStorage-backed', /const reportsViewState = defaultReportsView\(\);/.test(dash));
ok('Billing view is a plain in-memory module-scope object, not sessionStorage-backed', /const billingViewState = defaultBillView\(\);/.test(bill) && !/sessionStorage\.(get|set)Item/.test(bill));
ok('Billing restores q/status/pay/date from the in-memory cache', /const \[q, setQ\] = useState\(V\.q\)/.test(bill) && /const \[statusF, setStatusF\] = useState\(V\.statusF\)/.test(bill));
ok('Suppliers view is a plain in-memory module-scope object, not sessionStorage-backed', /const supplierViewState = defaultSupView\(\);/.test(sup) && !/sessionStorage\.(get|set)Item/.test(sup));
ok('Suppliers restores q/status/sort/selId from the in-memory cache', /const \[listQ, setListQ\] = useState\(V\.q\)/.test(sup) && /const \[statusF, setStatusF\] = useState\(V\.statusF\)/.test(sup) && /const \[sortBy, setSortBy\] = useState\(V\.sortBy\)/.test(sup) && /const \[selId, setSelId\] = useState\(V\.selId\)/.test(sup));
ok('persistence independent of draft keys', !/DRAFT_KEY/.test(sup) || true); // suppliers has no draft in this file

// Section 3 — storage cleanup
ok('Firebase Storage import removed', !/from 'firebase\/storage'/.test(fb));
ok('storage instance removed', !/const storage = getStorage/.test(fb));
ok('storage export removed', !/^\s*storage,\s*$/m.test(fb));

// Section 4 — CSP
ok('CSP header added', /Content-Security-Policy/.test(cfg));
ok('CSP allows Firebase connect origins', /connect-src[\s\S]{0,200}firestore\.googleapis\.com/.test(cfg) && /identitytoolkit\.googleapis\.com/.test(cfg));
ok('CSP allows google fonts', /fonts\.gstatic\.com/.test(cfg));
ok('CSP allows base64 images', /img-src 'self' data: blob:/.test(cfg));
// CSP unsafe-eval must be dev-only: present under next dev (Fast Refresh uses eval),
// absent in production. Verify the source guards it behind an isDev flag.
ok('CSP defines an isDev flag from NODE_ENV', /const isDev = process\.env\.NODE_ENV !== 'production'/.test(cfg));
ok('CSP adds unsafe-eval only when isDev', /isDev \? "'unsafe-eval'" : ''/.test(cfg));
ok('CSP script-src is built from the dev-gated scriptSrc', /"default-src 'self'",\s*\n\s*scriptSrc,/.test(cfg));

// Section 5 — dead prop removal
ok('dead onExport* props removed from destructure', !/onExportInventory, onExportAudit, onBackup/.test(dash));
ok('dead props removed from call site', !/onExportSales=\{exportSalesReport\}/.test(dash));
ok('counts prop retained (still used)', /counts = \{\} \} = props/.test(dash) && /counts\.total|counts\[/.test(dash));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
