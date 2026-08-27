/**
 * tests/customer-export-archived-status.test.cjs
 *
 * Root cause of "exported archived customers don't show as archived": the CSV export's
 * Status column wrote c.status ('Active'/'Inactive') directly — a field completely
 * independent of c.archived, and never touched by archiving. An archived customer is
 * only visible in the export at all when the Archived filter is selected (the module's
 * `filtered` list excludes archived records everywhere else), and in that view the
 * export's Status column showed the customer's PRE-ARCHIVE status (e.g. "Active") with
 * nothing indicating the record was archived.
 *
 * A second, related gap: the "Archive Customer" action only ever toggled
 * `c.archived`, so there was no archived date/by to show even if the export wanted one.
 *
 * Fix: the archive/reactivate menu action now also stamps archivedAt/archivedBy (cleared
 * on reactivate) and logs a history entry, using the exact histEntry()/demoMode pattern
 * already used for Customer Created/Edited/Vehicle Added elsewhere in this file. The
 * export's Status column shows "Archived" first when c.archived is true (Active/Inactive
 * customers are unaffected and still show their real status), and two new columns
 * (Archived Date, Archived By) are populated only for archived rows.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/customers/CustomersModule.jsx'), 'utf8');

console.log('\nCustomers — export shows archived status/date/by\n');

// --- archive action now records archivedAt/archivedBy + history ---
// Label routes through lib/i18n.js's t('key', 'English fallback') for localization —
// the literal English fallback strings are still present, so this anchor still finds
// the same code.
const archiveStart = src.indexOf("t('common.reactivate', 'Reactivate') : t('customers.action.archiveCustomer', 'Archive Customer')");
const archiveBlock = src.slice(archiveStart, archiveStart + 900);
ok('archive action found', archiveStart !== -1);
ok('archiving stamps archivedAt (Date.now()) and archivedBy (demoMode-aware, matching histEntry\'s existing pattern)',
  /archivedAt: Date\.now\(\), archivedBy: demoMode \? 'Demo User' : 'Admin'/.test(archiveBlock));
ok('reactivating clears archivedAt/archivedBy rather than leaving stale archive data',
  /archived: false, archivedAt: null, archivedBy: null/.test(archiveBlock));
ok('the toggle logs a history entry (Customer Archived / Customer Reactivated), same as other customer actions',
  // histEntry(action, detail) now always passes its 2nd arg explicitly (here '') — a
  // later fix (see the "missing-argument fix" comment right above this call site in
  // CustomersModule.jsx): calling it with only `action` left `detail: undefined` in the
  // pushed history entry, and Firestore's WriteBatch.set() rejects ANY undefined field
  // anywhere in the document, silently failing the entire Archive/Reactivate write.
  /histEntry\(willArchive \? 'Customer Archived' : 'Customer Reactivated', ''\)/.test(archiveBlock));

// --- export reflects it ---
// Anchor moved to buildCustomerExport: the head/rows-building code that used to live
// directly inside exportCSV was extracted into a shared helper (both exportCSV and the
// new exportPDF call it), so the Status/Archived-Date/Archived-By logic asserted below
// now lives there instead.
const expStart = src.indexOf('const buildCustomerExport = ()');
// Window widened: the Universal Print/PDF selection-scope review added an explanatory
// comment above `toExport` inside this same function, pushing the archived-date/by
// columns further into the source text than this fixed-size slice originally assumed.
const expBlock = src.slice(expStart, expStart + 2000);
ok('export header adds Archived Date and Archived By columns',
  /'Status', 'Archived Date', 'Archived By', 'Vehicles'/.test(expBlock));
ok('Status column shows "Archived" for archived rows regardless of the underlying c.status value',
  /c\.archived \? 'Archived' : c\.status/.test(expBlock));
ok('Archived Date / Archived By columns are populated only for archived rows (blank otherwise)',
  /c\.archived \? fmtDate\(c\.archivedAt\) : ''/.test(expBlock) &&
  /c\.archived \? \(c\.archivedBy \|\| ''\) : ''/.test(expBlock));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
