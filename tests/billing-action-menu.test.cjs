/**
 * tests/billing-action-menu.test.cjs — invoice row overflow (⋮) menu: Billing's OWN
 * wiring into the shared ActionMenu (which items, under what conditions, calling which
 * handlers). The shared positioning/keyboard-nav/section/disabled-reason/single-open
 * MECHANICS used to be hand-rolled here (own Portal, own flip/clamp math, own
 * __activeRowMenuClose registry) and are now verified once, generically, in
 * tests/action-menu-unification.test.cjs — this file only checks Billing-specific
 * business wiring, per the "test mechanics once, wiring per-caller" split already
 * established by tests/customer-action-menu.test.cjs.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const bill = fs.readFileSync(path.resolve(__dirname, '../components/billing/BillingModule.jsx'), 'utf8');

console.log('\nBilling — invoice row action menu wiring (shared ActionMenu)\n');

// --- Uses the shared component, not its own reimplementation ---
ok('imports the shared ActionMenu', /import ActionMenu from '\.\.\/common\/ActionMenu'/.test(bill));
ok('row menu rendered through ActionMenu, controlled by a per-row menuFor-style state (matches Vehicles/Customers/Job Cards)',
  /const \[rowMenuFor, setRowMenuFor\] = useState\(null\);/.test(bill) && /<ActionMenu anchorRef=\{rowMenuAnchorRef\(iv\.id\)\} open onClose=\{\(\) => setRowMenuFor\(null\)\}/.test(bill));
ok('each row gets a stable, distinct anchor ref (not a shared/recreated-per-render object)',
  /rowMenuAnchorRefs = useRef\(new Map\(\)\)/.test(bill));
ok('trigger exposes aria-haspopup/expanded reflecting this row\'s open state', /aria-haspopup="menu" aria-expanded=\{rowMenuFor === iv\.id\}/.test(bill));

// --- No leftover independent implementation ---
ok('no leftover RowActionsMenu component', !/function RowActionsMenu/.test(bill));
ok('no leftover single-active-menu registry (superseded by ActionMenu\'s own app-wide registry)', !/__activeRowMenuClose/.test(bill));
ok('no leftover tuple-based isAction() helper (items are now typed objects, shared shape)', !/const isAction = /.test(bill));
ok('the row menu itself no longer renders its own <Portal> (ActionMenu/DropdownPanel own that)',
  !/<Portal>[\s\S]{0,400}role="menu"/.test(bill));

// --- Sectioning preserved ---
// Section/item labels now route through lib/i18n.js's t('key', 'English fallback')
// for localization — the literal English string is still present as the fallback
// argument, so the same sectioning/wiring is still verifiable through that form.
ok('menu is organized into the same sections as before (Invoice/Financial/History/Communication)',
  /\{ type: 'section', label: t\('billing\.invoice', 'Invoice'\) \}/.test(bill) && /\{ type: 'section', label: t\('billing\.financial', 'Financial'\) \}/.test(bill) &&
  /\{ type: 'section', label: t\('billing\.history', 'History'\) \}/.test(bill) && /\{ type: 'section', label: t\('billing\.communication', 'Communication'\) \}/.test(bill));

// --- Disabled-with-reason preserved (not hidden) ---
ok('Refund shown disabled with reason when not paid',
  /label: t\('billing\.action\.refund', 'Refund'\), icon: IndianRupee, onClick: \(\) => \{\}, disabled: true, reason: 'Only a fully paid invoice can be refunded'/.test(bill));
ok('Return shown disabled with reason when unavailable',
  /label: t\('billing\.action\.returnRestoreStock', 'Return \(restore stock\)'\), icon: Receipt, onClick: \(\) => \{\}, disabled: true,/.test(bill));
ok('Collect Payment shown disabled with reason when no balance',
  /label: t\('billing\.action\.collectPayment', 'Collect Payment'\), icon: Wallet, onClick: \(\) => \{\}, disabled: true,/.test(bill));

// --- Declutter + primary visible actions unchanged ---
// Billing PDF Architecture Enhancement: "Download PDF" was renamed to "Customer
// Copy" (paired with the new "Workshop Copy") for parity with the new internal
// document variant — same overflow-menu placement, just a clearer label.
ok('secondary actions live in the overflow menu (Duplicate/Customer Copy/WhatsApp)',
  /label: t\('vehicles\.action\.duplicate', 'Duplicate'\), icon: Copy,/.test(bill) && /label: t\('billing\.action\.customerCopy', 'Customer Copy'\), icon: FileDown,/.test(bill) && /label: t\('billing\.action\.sendOnWhatsApp', 'Send on WhatsApp'\), icon: Send,/.test(bill));
ok('primary actions stay visible outside the menu (Edit/Collect/Print/Delete)',
  /title=\{t\('billing\.action\.editView', 'Edit \/ View'\)\}/.test(bill) && /title=\{t\('billing\.action\.collectPayment', 'Collect Payment'\)\}/.test(bill) && /title=\{t\('common\.print', 'Print'\)\}/.test(bill) && /title=\{demoMode && !demoCanDelete \? t\('billing\.disabledByAdmin', 'Disabled by administrator'\) : t\('common\.delete', 'Delete'\)\}/.test(bill));
ok('visible buttons have focus-visible ring', /focus-visible:ring-2 focus-visible:ring-\[#d4af37\]\/60/.test(bill));

// --- No functionality removed (all actions still reachable and wired) ---
ok('all financial actions still wired', /changeStatus\(iv, 'Refunded'/.test(bill) && /changeStatus\(iv, 'Returned'/.test(bill) && /changeStatus\(iv, 'Cancelled'/.test(bill) && /setPayFor\(iv\)/.test(bill));
ok('remaining actions still wired (Duplicate/Convert/Timeline)', /duplicateInvoice\(iv\)/.test(bill) && /convertEstimate\(iv\)/.test(bill) && /setTimelineFor\(iv\)/.test(bill));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
