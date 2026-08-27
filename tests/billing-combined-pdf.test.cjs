/**
 * tests/billing-combined-pdf.test.cjs
 *
 * Universal selection→export/PDF/print record-set review, Issue 9/10/12/13 — Billing
 * was the one confirmed offender across the whole app (a dedicated audit re-checked
 * Customers, Vehicles, Job Cards, Inventory Parts, Inventory Reports, SupplierPOBuilder,
 * SupplierPerformance, LedgerPage/Stock In-Out — all already produce exactly one file/
 * print job per bulk action from one authoritative selection). Billing's bulk "PDF"
 * looped downloadPDF(iv) once per selected invoice — each call built its OWN jsPDF
 * instance and called doc.save() independently, so selecting 20 invoices and clicking
 * PDF fired 20 separate browser downloads. There was also no bulk Print action at all
 * (only a per-row one), so Print and PDF could never even claim to share a scope.
 *
 * Fix: split the single monolithic downloadPDF into drawInvoiceDocument (draws ONE
 * invoice onto whatever doc/page it's handed, never creates or saves the doc) + a thin
 * downloadPDF wrapper (single-invoice, unchanged output) + downloadCombinedInvoicePDF
 * (one jsPDF instance, drawInvoiceDocument called in a loop with addPage() between
 * invoices, ONE save/print at the end) — the exact same three-way split Job Cards
 * already proved correct (drawJobCardDocument/downloadPDF/downloadCombinedPDF).
 * bulkPDF and the new bulkPrint are now both thin calls into the same combined
 * function, fed by the same selectedInvoices() — so Excel/PDF/Print can never diverge.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const bill = fs.readFileSync(path.resolve(__dirname, '../components/billing/BillingModule.jsx'), 'utf8');

console.log('\nBilling — combined bulk PDF/Print (one file/job, not N)\n');

// --- the drawer/wrapper/combined split exists ---
ok('drawInvoiceDocument draws onto an EXISTING doc — it does not create its own jsPDF instance or save it (that would defeat combining)',
  /async function drawInvoiceDocument\(doc, iv, mode = 'customer'\) \{/.test(bill) &&
  !/async function drawInvoiceDocument[\s\S]{0,200}new jsPDF/.test(bill));
ok('downloadPDF is now a thin single-invoice wrapper: creates the doc, calls drawInvoiceDocument, saves/prints — same output as before',
  /const downloadPDF = async \(iv, printAfter = false, mode = 'customer'\) => \{\s*\n\s*const \{ jsPDF \} = await import\('jspdf'\);\s*\n\s*const doc = new jsPDF\(\{ unit: PDF_PAGE\.unit, format: PDF_PAGE\.format \}\);\s*\n\s*await drawInvoiceDocument\(doc, iv, mode\);/.test(bill));

// --- the actual fix: ONE jsPDF instance for the whole selection ---
const combinedStart = bill.indexOf('const downloadCombinedInvoicePDF = async');
ok('downloadCombinedInvoicePDF exists', combinedStart !== -1);
const combinedBlock = bill.slice(combinedStart, combinedStart + 1700);
ok('exactly ONE jsPDF instance is created for the entire selection (not one per invoice)',
  (combinedBlock.match(/new jsPDF\(/g) || []).length === 1);
ok('invoices are drawn onto that SAME shared doc via drawInvoiceDocument, with addPage() between them (never a fresh doc per invoice)',
  /if \(i > 0\) doc\.addPage\(\);[\s\S]{0,150}await drawInvoiceDocument\(doc, rows\[i\], mode\)/.test(combinedBlock));
ok('exactly ONE save/print call for the whole batch (doc.save or doc.autoPrint+window.open), not one per invoice',
  (combinedBlock.match(/doc\.save\(|doc\.autoPrint\(\)/g) || []).length === 2); // one save branch + one autoPrint branch, mutually exclusive at runtime
ok('a single invoice still takes the identical-output single-file shortcut (keeps the plain <invNo>.pdf filename, not a "1 selected" combined-file name)',
  /if \(rows\.length === 1\) \{ await downloadPDF\(rows\[0\], printAfter, mode\); return; \}/.test(combinedBlock));
ok('zero selection is explicitly blocked with a clear message, never silently exports/prints everything',
  /if \(!rows\.length\) \{ toast\.error\('No invoices selected\. Select at least one invoice to continue\.'\); return; \}/.test(combinedBlock));
ok('a hard cap prevents an unusably large combined PDF / a frozen tab, same MAX_BULK_INVOICE_PDF used before',
  /if \(rows\.length > MAX_BULK_INVOICE_PDF\) \{/.test(combinedBlock));
ok('progress state (bulkDocBusy) is tracked per invoice as the combined doc builds, same UX contract as Job Cards\' downloadCombinedPDF',
  /setBulkDocBusy\(\{ mode: printAfter \? 'print' : 'pdf', done: 0, total: rows\.length \}\)/.test(combinedBlock) &&
  /setBulkDocBusy\(\{ mode: printAfter \? 'print' : 'pdf', done: i \+ 1, total: rows\.length \}\)/.test(combinedBlock));

// --- per-invoice page numbering stays correct inside a combined document ---
ok('each invoice records where its OWN first page lands in the real (possibly multi-invoice) document, so its footer reads "Page 1 of N" relative to itself, never the combined document\'s absolute page count',
  /const pageStart = doc\.internal\.getNumberOfPages\(\);/.test(bill));
ok('the page-number footer targets the invoice\'s ACTUAL page (pageStart-offset), not page 1..N of the whole document',
  /doc\.setPage\(pageStart \+ p - 1\); drawPdfPageNumber\(doc, p, \{ W, M, total: isWorkshop \? page : undefined \}\);/.test(bill));

// --- Print and PDF share the exact same scope and combining path (Issue 12/13) ---
ok('bulkPrint exists — Print was previously a per-row-only action, with no bulk equivalent at all',
  /const bulkPrint = \(\) => downloadCombinedInvoicePDF\(selectedInvoices\(\), true\)/.test(bill));
ok('bulkPDF and bulkPrint both resolve from the SAME selectedInvoices() (the one authoritative scope also used by Excel/GST Export/Payment Reminder/Archive/Delete)',
  /const bulkPDF = \(\) => downloadCombinedInvoicePDF\(selectedInvoices\(\), false\)/.test(bill));
ok('the bulk toolbar exposes both actions (Print and PDF), not just PDF',
  /onClick=\{bulkPrint\}[\s\S]{0,250}Print<\/button>/.test(bill) && /onClick=\{bulkPDF\}[\s\S]{0,250}PDF<\/button>/.test(bill));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
