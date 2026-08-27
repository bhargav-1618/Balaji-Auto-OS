/**
 * tests/capacity-management.test.cjs
 *
 * UNIVERSAL ISSUE — 5,000 RECORD MAXIMUM, CAPACITY WARNING & CONTROLLED DATA CLEANUP.
 *
 * Application-wide record-capacity policy for high-growth transactional collections
 * (Job Cards, Billing/Invoices, Purchase Orders, Stock In, Stock Out, Sales/Services).
 * Verifies the shared engine (constants/capacity.js, services/capacityService.js,
 * services/persistenceStore.js's new bulk/count methods), the shared UI
 * (CapacityBanner, CapacityCleanupModal), and that every applicable module is wired
 * through the SAME engine rather than a one-off implementation per module.
 *
 * Source-pattern assertions (this suite's established convention) rather than live
 * Firestore calls — capacityService's production path talks to a real Firestore
 * aggregate query, which this offline test harness cannot exercise; what CAN and MUST
 * be verified statically is that the numbers/logic/wiring are correct and consistent.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const R = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\n5,000-record capacity management — engine, UI, and per-module wiring\n');

const cap = R('constants/capacity.js');
const svc = R('services/capacityService.js');
const store = R('services/persistenceStore.js');
const repo = R('repositories/firestoreRepository.js');
const useCap = R('lib/useCapacity.js');
const banner = R('components/common/CapacityBanner.jsx');
const modal = R('components/common/CapacityCleanupModal.jsx');
const { pluralize } = require('../lib/format.js');

// --- Part 1: the numbers are exactly what the brief specifies, in ONE place ---
ok('CAPACITY_LIMIT is exactly 5,000 (not invented)', /export const CAPACITY_LIMIT = 5000;/.test(cap));
ok('CAPACITY_WARNING_THRESHOLD is 4,500 (early warning before the hard max)', /export const CAPACITY_WARNING_THRESHOLD = 4500;/.test(cap));
ok('CLEANUP_BATCH_SIZE is the fixed 1,000 default (no arbitrary custom-quantity field)', /export const CLEANUP_BATCH_SIZE = 1000;/.test(cap));

// --- Part 2: applicable-module policy — high-growth ledgers only, not master data ---
['jobCards', 'invoices', 'purchaseOrders', 'restocks', 'stockAdjustments', 'sales'].forEach((k) => {
  ok(`CAPACITY_MODULES registers "${k}"`, new RegExp(`${k}: \\{`).test(cap));
});
ok('customers/vehicles/suppliers/parts are NOT governed by this policy (master data, not a growth ledger)',
  !/customers:\s*\{/.test(cap) && !/vehicles:\s*\{/.test(cap) && !/suppliers:\s*\{/.test(cap) && !/\bparts:\s*\{/.test(cap));
ok('sales is explicitly marked as having no direct-create guard (auto-generated from Billing, not its own action)',
  /hasDirectCreate: false/.test(cap));
ok('every OTHER module has a direct-create guard (hasDirectCreate: true)',
  (cap.match(/hasDirectCreate: true/g) || []).length === 5);

// --- Part 3: active count derivation is safe against pre-existing (un-flagged) documents ---
ok('active count is derived as total - archived, never a direct "archived==false" query',
  /const count = Math\.max\(0, total - archived\)/.test(svc));
ok('persistenceStore documents WHY archived==false would undercount legacy documents',
  /never match a missing field against `false`/.test(store));
ok('countArchived exists in BOTH the demo and production branches',
  (store.match(/async countArchived\(collectionName\)/g) || []).length === 2);
ok('production count uses a real Firestore aggregate read (getCountFromServer), never fetching documents to count them',
  /getCountFromServer/.test(repo) && /export async function count\(collectionName, constraints = \[\]\)/.test(repo));

// --- Part 4: bulk operations are batched, not one write per record ---
ok('removeMany exists in both branches (bulk delete, not N individual remove() calls)',
  /async removeMany\(collectionName, ids, idField = 'id'\)/.test(store) && /async removeMany\(collectionName, ids\)/.test(store));
ok('updateMany exists in both branches (bulk archive-flag patch)',
  /async updateMany\(collectionName, ids, patch, idField = 'id'\)/.test(store) && /async updateMany\(collectionName, ids, patch\)/.test(store));
ok('production bulk ops route through commitBatch, which chunks at Firestore\'s 500-op limit',
  /await repo\.commitBatch\(ids\.map\(\(id\) => \(\{ type: 'delete'/.test(store) &&
  /await repo\.commitBatch\(ids\.map\(\(id\) => \(\{ type: 'update'/.test(store) &&
  /const CHUNK = 500;/.test(repo));

// --- Part 5: oldest-eligible scanning uses a real business timestamp, never array order ---
ok('the oldest-first scan sorts/orders by the module\'s configured dateField, not array position',
  /orderField: cfg\.dateField, direction: 'asc'/.test(svc) &&
  /const da = recordDate\(moduleKey, a\)\?\.getTime\(\) \?\? 0;/.test(svc));
ok('invoices use the actual invoice date field ("date"), matching the brief\'s "Invoice date" requirement',
  /invoices: \{[\s\S]{0,150}dateField: 'date',/.test(cap));

// --- Part 6: eligibility reuses EXISTING status logic, never re-derives it ---
ok('invoice eligibility reuses billingService\'s invoiceStatus (the one trusted status derivation), not a re-implementation',
  /import \{ invoiceStatus \} from '\.\/billingService';/.test(svc) && /const status = invoiceStatus\(record\);/.test(svc));
ok('job cards protect anything not Delivered/Closed/Cancelled from cleanup',
  /TERMINAL_JOB_CARD_STATUSES = Object\.freeze\(\['Delivered', 'Closed', 'Cancelled'\]\)/.test(cap));
ok('invoices protect anything not settled (Paid/Cancelled/Refunded/Returned) from cleanup',
  /TERMINAL_INVOICE_STATUSES = Object\.freeze\(\['Paid', 'Cancelled', 'Refunded', 'Returned'\]\)/.test(cap));
ok('purchase orders protect anything still in-flight (only received/cancelled are terminal)',
  /TERMINAL_PO_STATUSES = Object\.freeze\(\['received', 'cancelled'\]\)/.test(cap));
ok('a closed job card still referenced by a still-open invoice is protected (cross-reference, not just its own status)',
  /activeInvoiceJobNos.*has\(record\.jobNo\)/.test(svc));
ok('the preview reports protected records with a reason, matching the brief\'s worked example (Eligible/Protected breakdown)',
  /protectedCount \+= 1;/.test(svc) && /protectedSamples/.test(svc));

// --- Part 7: export-then-delete is atomic from the user's perspective ---
ok('exportAndDeleteRecords calls the export FIRST and lets a throw propagate before any delete runs',
  /export async function exportAndDeleteRecords[\s\S]{0,60}await exportRecordsToExcel\(moduleKey, records\); \/\/ throws => nothing below runs/.test(svc));
ok('the wizard\'s export step and delete step are genuinely separate — a user can cancel AFTER a successful export without deleting anything',
  /cancelAfterExport/.test(modal) && /Cancel — Keep Records/.test(modal));
ok('the post-export delete uses the SAME record set the export already produced (never re-derives "oldest N" a second time)',
  /deleteRecords\(moduleKey, preview\.eligible, \{ demoMode, actorEmail \}\)/.test(modal));

// --- Part 8: delete is truly permanent; archive is a genuinely different operation ---
ok('deleteRecords physically removes the documents (removeMany), not a soft-delete flag',
  /export async function deleteRecords[\s\S]{0,220}await store\.removeMany\(cfg\.collection, ids, cfg\.idField \|\| 'id'\);/.test(svc));
ok('archiveRecords flips a flag and keeps the document (never calls removeMany)',
  /export async function archiveRecords[\s\S]{0,400}await store\.updateMany\(cfg\.collection, ids, patch, cfg\.idField \|\| 'id'\);/.test(svc) &&
  /archived: true, archivedAt:/.test(svc));
ok('the UI never labels the permanent-delete action as "Archive" or vice versa',
  /Delete Oldest 1,000/.test(modal) && /Archive Oldest 1,000/.test(modal) && /This action is permanent\./.test(modal));

// --- Part 9: audit trail reuses the EXISTING audit log, not a new parallel history ---
ok('cleanup writes to the same auditLog collection/local-storage the rest of the app already reads',
  /await store\.save\(COLLECTIONS\.AUDIT_LOG, entry\);/.test(svc));
ok('the audit entry records method, module, count, and date range (who/when/what/how many)',
  /action: `capacity_\$\{method\}`/.test(svc) && /performedByEmail: actorEmail/.test(svc) && /dateRangeLabel/.test(svc));

// --- Part 10: the user is never auto-decided for — three explicit choices, no default ---
ok('the cleanup wizard presents exactly three methods (delete / export_delete / archive), never auto-picks one',
  (modal.match(/id: '(delete|export_delete|archive)'/g) || []).length === 3);
ok('nothing in the service layer runs a cleanup without an explicit method argument from the caller',
  !/function autoCleanup/.test(svc) && !/automaticCleanup/.test(svc));

// --- Part 11: create-time guard blocks BEFORE any draft/form exists, never mid-save ---
ok('checkCapacityGuard is the shared blocking primitive every module\'s "New X" action calls',
  /export async function checkCapacityGuard\(moduleKey, \{ demoMode \} = \{\}\)/.test(useCap) &&
  /return \{ blocked: status\.atLimit, status \};/.test(useCap));
ok('the guard documents WHY it must run before the form opens (no draft left to lose)',
  /BEFORE[\s\S]{0,20}opening any create form/.test(useCap));

// --- Part 12: the warning banner is non-spammy (per-band dismissal, never every page load) ---
ok('the banner never renders below the warning threshold',
  /if \(!status\.atWarning && !status\.atLimit\) return null;/.test(banner));
ok('the AT-LIMIT banner cannot be dismissed (the blocking state must stay visible)',
  /atLimit is never dismissible/.test(banner));
ok('a warning dismissal is remembered per 100-record band, so growth past that band re-warns instead of staying silently dismissed forever',
  /const bandOf = \(count\) => Math\.floor\(count \/ 100\) \* 100;/.test(banner));

// --- Part 13: every applicable module is wired through the SAME engine ---
const jc = R('components/jobcards/JobCardModule.jsx');
const bill = R('components/billing/BillingModule.jsx');
const po = R('components/inventory/InventoryPurchaseOrders.jsx');
const poBuilder = R('components/inventory/SupplierPOBuilder.jsx');
const inv = R('components/InventoryDashboard.js');

ok('Job Cards: guards new-card creation via the shared checkCapacityGuard (not a bespoke check)',
  /checkCapacityGuard\('jobCards', \{ demoMode \}\)/.test(jc) && /<CapacityBanner/.test(jc));
ok('Job Cards: only a genuinely NEW jobNo triggers the guard — editing an existing card is never blocked',
  /const isNewCard = !savedRef\.current\.some\(\(c\) => c\.jobNo === card\.jobNo\);/.test(jc));
ok('Billing: New Invoice is guarded before the (pre-allocated) invoice number is ever assigned to the editor',
  /checkCapacityGuard\('invoices', \{ demoMode \}\)/.test(bill) && /<CapacityBanner moduleKey="invoices"/.test(bill));
ok('Purchase Orders: both independent creation entry points (main list + quick-create drawer) are guarded',
  /checkCapacityGuard\('purchaseOrders', \{ demoMode \}\)/.test(po) && /checkCapacityGuard\('purchaseOrders', \{ demoMode \}\)/.test(poBuilder));
ok('Stock In / Stock Out: guarded at the shared write choke point (receiveStockLine / adjustStockLine), covering single AND bulk flows in one place',
  /checkCapacityGuard\('restocks', \{ demoMode \}\)/.test(inv) && /checkCapacityGuard\('stockAdjustments', \{ demoMode \}\)/.test(inv));
ok('Sales & Services: banner present on both views (they share one `sales`-collection capacity), no independent create guard',
  (inv.match(/CapacityBanner moduleKey="sales"/g) || []).length === 2);
ok('one shared CapacityCleanupModal instance serves every capacity guard inside the InventoryDashboard monolith (not one per call site)',
  /const \[capacityCleanupModule, setCapacityCleanupModule\] = useState\(null\);/.test(inv) &&
  (inv.match(/setCapacityCleanupModule\(/g) || []).length >= 4);

// --- Part 13b: job cards are keyed by jobNo, not `.id` — demo-mode records never get
// an `.id` field at all (persistJobCardsDiff calls store.syncAll(..., 'jobNo')), so
// every identity-touching operation must resolve through the configured idField.
ok('jobCards module declares idField: "jobNo" (the one collection NOT keyed by .id)',
  /jobCards: \{[\s\S]{0,1100}idField: 'jobNo',/.test(cap));
ok('capacityService resolves identity through a shared recordId() helper, not a hardcoded record.id',
  /function recordId\(moduleKey, record\)/.test(svc) && /return record\[cfg\.idField \|\| 'id'\];/.test(svc));
ok('deleteRecords/archiveRecords/exportAndDeleteRecords all use recordId() and pass idField through to the store',
  (svc.match(/records\.map\(\(r\) => recordId\(moduleKey, r\)\)/g) || []).length === 3 &&
  (svc.match(/cfg\.idField \|\| 'id'/g) || []).length >= 3);
ok('the job-card cross-reference check compares against record.jobNo, not record.id',
  /ctx\.activeInvoiceJobNos && ctx\.activeInvoiceJobNos\.has\(record\.jobNo\)/.test(svc));
ok('persistenceStore\'s bulk demo operations accept a configurable idField (default \'id\')',
  /async removeMany\(collectionName, ids, idField = 'id'\)/.test(store) &&
  /async updateMany\(collectionName, ids, patch, idField = 'id'\)/.test(store) &&
  /!idSet\.has\(r\[idField\]\)/.test(store) && /idSet\.has\(r\[idField\]\)/.test(store));

// --- Part 14: archived records stay reachable, not silently erased from history ---
ok('Billing\'s invoice list keeps an explicit "Archived" filter — archiving never makes an invoice unreachable',
  /'Returned', 'Archived'\]/.test(bill) && /if \(statusF === 'Archived'\) return iv\.archived === true/.test(bill));
ok('Purchase Orders keeps the same explicit archived-visibility pattern',
  /\['archived', 'Archived'\]/.test(po) && /filter === 'archived'/.test(po));
ok('Billing\'s revenue/GST/lifetime stats derive from the FULL invoices array, not the archived-filtered list — historical totals still include archived invoices',
  /const stats = useMemo\(\(\) => \{/.test(bill) && !/const stats = useMemo\(\(\) => \{[\s\S]{0,50}filtered/.test(bill));

// --- Part 15: onComplete must never close the wizard — that would hide its own
// success/failure result from the user before they ever see it. Only the user's
// explicit "Done" click (onClose) may dismiss it. Caught live: every guard-triggered
// wizard instance originally wired onComplete to close itself, so a successful delete
// silently vanished the modal instead of showing "N records deleted successfully."
ok('CapacityCleanupModal\'s own onDone always calls onClose (dismissal is user-driven, not automatic)',
  /function ResultStep\(\{ result, onDone \}\)/.test(modal) && /<button onClick=\{onDone\}/.test(modal));
[jc, bill, po].forEach((src, i) => {
  const name = ['Job Cards', 'Billing', 'Purchase Orders'][i];
  ok(`${name}: the blocked-create wizard's onComplete does NOT close the modal (no setCapacityBlockedOpen(false) inside it)`,
    !/onComplete=\{\(\) => \{?\s*setCapacityBlockedOpen\(false\)/.test(src));
  ok(`${name}: onComplete instead refreshes the underlying collection/banner`,
    /onComplete=\{\(\) => \{ onCapacityCleanup\?\.\(\); setCapacityRefreshTick/.test(src));
});
ok('InventoryDashboard\'s shared modal onComplete does NOT close itself, and refreshes the just-cleaned collection\'s React state (not just a tick)',
  !/onComplete=\{\(\) => setCapacityCleanupModule\(null\)\}/.test(inv) &&
  /onComplete=\{\(\) => \{ refreshCapacityCollection\(capacityCleanupModule\); setCapacityRefreshTick/.test(inv));
ok('a dedicated refreshCapacityCollection helper re-reads the affected collection from the store and republishes it into React state (fixes stale tables/KPIs after cleanup, not just the banner count)',
  /const refreshCapacityCollection = useCallback\(async \(moduleKey\) => \{/.test(inv) &&
  /const rows = await createStore\(demoMode\)\.list\(collectionName\);/.test(inv) &&
  /setter\(rows\);/.test(inv));

// --- Part 16: Audit Log joins the SAME universal engine — no parallel implementation ---
// (Universal Issue: Stock In/Out/Audit Log/Alerts/Reminders capacity rollout)
ok('CAPACITY_MODULES registers "auditLog"', /auditLog: \{/.test(cap));
ok('auditLog has no direct-create guard (append-only exhaust of other actions, same reasoning as sales)',
  /auditLog: \{[\s\S]{0,400}hasDirectCreate: false,/.test(cap));
ok('auditLog restricts cleanup to Archive / Export+Delete — raw permanent Delete is deliberately not offered (stronger retention than an ordinary ledger)',
  /auditLog: \{[\s\S]{0,600}allowedMethods: \['archive', 'export_delete'\],/.test(cap));
ok('allowedCleanupMethods() defaults to all three methods for every module that does not set allowedMethods',
  /export function allowedCleanupMethods\(moduleKey\)[\s\S]{0,150}return cfg\?\.allowedMethods \|\| \['delete', 'export_delete', 'archive'\];/.test(cap));
ok('CapacityCleanupModal filters its offered methods through allowedCleanupMethods, not a hardcoded list per module',
  /import \{ allowedCleanupMethods \} from '\.\.\/\.\.\/constants\/capacity';/.test(modal) &&
  /const allowed = new Set\(allowedCleanupMethods\(moduleKey\)\);/.test(modal));
ok('auditLog has an EXPORT_COLUMNS entry reusing the same writeSheet path as every other module',
  /auditLog: \{[\s\S]{0,100}head: \['Action', 'Entity', 'Entity ID', 'Performed By', 'Details', 'Date'\],/.test(svc));
ok('Analytics/Audit Log: CapacityBanner wired into AuditLogPanel, sharing the same refresh/actorEmail plumbing as every other tab',
  /function AuditLogPanel\(\{ auditLog, demoMode, actorEmail, capacityRefreshTick = 0, onCleanupComplete \}\)/.test(inv) &&
  /<CapacityBanner\s*\n\s*moduleKey="auditLog"/.test(inv));
ok('auditLog cleanup refresh is wired through the SAME refreshCapacityCollection/CAPACITY_STATE_SETTERS map as every other module (no bespoke audit-refresh path)',
  /auditLog: setAuditLog,/.test(inv));
ok('the Analytics tab (and therefore Audit Log capacity cleanup) stays admin-gated at the tab level — no new unauthenticated destructive surface introduced',
  /activeTab === 'analytics' && \(isAdmin \|\| demoMode\)/.test(inv));

// --- Part 17: the choose-step message accurately reflects warning vs at-limit state
// (the wizard can be opened from either — a hardcoded "reached the maximum" string
// would misreport status for a module opened while merely approaching the limit) ---
ok('the cleanup wizard\'s opening message is conditional on atLimit, not a hardcoded "reached the maximum" string',
  /capacityStatus\.atLimit\s*\n\s*\? 'This dataset has reached the maximum active-record limit/.test(modal) &&
  /: `Approaching the limit/.test(modal));

// --- Part 18: pluralize() — a real bug found during live browser verification
// ("4,601 / 5,000 tracked alert entrys tracked", "ledger entrys", "audit entrys" — naive
// `label + 's'` breaks for any label ending in a consonant + "y"). Every capacity-UI call
// site that used to do that inline now goes through this one shared helper instead. ---
ok('pluralize leaves a singular count untouched', pluralize('ledger entry', 1) === 'ledger entry');
ok('pluralize correctly handles the consonant+y -> ies case (the actual bug)', pluralize('ledger entry', 2) === 'ledger entries' && pluralize('audit entry', 5) === 'audit entries');
ok('pluralize does the ordinary +s case for everything else', pluralize('job card', 2) === 'job cards' && pluralize('purchase order', 0) === 'purchase orders');
ok('pluralize does not mis-fire on a word ending in a VOWEL + y (e.g. "day" -> "days", not "daies")', pluralize('day', 2) === 'days');
ok('CapacityBanner/CapacityCleanupModal/LocalCapacityBanner all route their record-count copy through pluralize(), not a naive `${label}s` or `${label}${n===1?"":"s"}` inline',
  /import \{ pluralize \} from '\.\.\/\.\.\/lib\/format';/.test(banner) &&
  /import \{ pluralize \} from '\.\.\/\.\.\/lib\/format';/.test(modal) &&
  !/cfg\.recordLabel\}s/.test(banner) && !/cfg\.recordLabel\}s/.test(modal) &&
  !/cfg\.recordLabel\}\$\{/.test(modal));
ok('capacityService\'s own cleanup-audit-trail message uses pluralize too (the audit entry text itself must not say "ledger entrys")',
  /details: `\$\{count\} \$\{pluralize\(cfg\.recordLabel, count\)\} \(\$\{dateRangeLabel\}\) via capacity cleanup`,/.test(svc));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
