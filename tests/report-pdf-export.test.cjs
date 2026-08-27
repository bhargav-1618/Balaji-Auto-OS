/**
 * tests/report-pdf-export.test.cjs
 *
 * Customer/Vehicle/Service/Inventory (and every other) Report previously had NO PDF
 * export at all — only Excel (.xlsx), via the shared `writeSheet` helper every report
 * table already funneled through. Confirmed by direct audit before building anything:
 * grepped the entire codebase for jsPDF/downloadPDF/exportPDF/generatePDF and found
 * only the 4 already-reviewed document generators (Job Card, Invoice, Purchase Order,
 * Supplier Performance) — zero report screens had one.
 *
 * This is an explicitly-authorized NEW FEATURE (not a bug fix): add a PDF export
 * option alongside every existing Excel export, built as ONE shared, reusable
 * framework (`exportReportPDF` in lib/pdfTheme.js) so a report only ever needs to
 * hand it the exact same {head, rows} it already built for Excel — no per-report PDF
 * template, matching "future reports automatically support both Excel and PDF
 * exports without duplicating logic or layouts."
 *
 * Wiring:
 *   - The global Reports tab's shared <ReportTable> component (InventoryDashboard.js)
 *     gained ONE PDF button — because all 15 report sections (Revenue, Parts Sales,
 *     Service Sales, Labour, Outside Purchases, Billing, Inventory, CUSTOMER, VEHICLE,
 *     Job Card, Technician, Supplier, Purchase, GST, Audit) render through that same
 *     component, this single change gives every one of them PDF export at once.
 *   - components/inventory/InventoryReports.jsx (Valuation/Dead Stock/Low-Out/Profit)
 *     gained its own PDF button, reusing its existing `active.csv` [head, ...rows].
 *   - CustomersModule.jsx and VehiclesModule.jsx each gained a "PDF" toolbar button
 *     beside their existing Excel export, both reusing a shared row-building helper
 *     (buildCustomerExport/buildVehicleExport) so the two export formats can never
 *     drift apart on which columns or which rows they include.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const R = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nReport PDF export — one shared framework, wired into every report\n');

const theme = R('lib/pdfTheme.js');
const inv = R('components/InventoryDashboard.js');
const invReports = R('components/inventory/InventoryReports.jsx');
const cust = R('components/customers/CustomersModule.jsx');
const veh = R('components/vehicles/VehiclesModule.jsx');

// --- Part 1: the shared exporter itself ---
// Settings QA fix: `shop` lost its `= SHOP` default — no caller ever passed an
// explicit shop, so every report PDF export silently ignored Settings -> Business
// Profile. `shop` now defaults to the live, Settings-driven liveShop(demoMode)
// inside the function body instead (see the `shop || liveShop(demoMode)` line),
// so a saved Workshop Name/Phone/GST/Address/Email/Logo actually appears on
// Customer Report, Vehicle Report, etc. — not just Invoice/Job Card/Purchase Order.
ok('lib/pdfTheme.js exports exportReportPDF, taking the same {head, rows} shape every report already builds for Excel',
  /export async function exportReportPDF\(\{ title, head, rows, filters, filename, shop, demoMode = false \}\)/.test(theme));
ok('exportReportPDF defaults an unset shop to the live, Settings-driven shop (not the bare hardcoded SHOP)',
  /shop \|\| liveShop\(demoMode\)/.test(theme));
ok('uses landscape orientation (matches the one pre-existing tabular-PDF precedent, Supplier Performance)',
  /orientation: 'landscape'/.test(theme));
ok('column widths are measured from actual header/row content, not hard-coded per report (there are 15+ report shapes)',
  /const natural = head\.map\(\(h, i\) => \{/.test(theme));
ok('columns are scaled together to exactly fill the page width (never lopsided-left, never overflowing right)',
  /const scale = naturalSum > 0 \? availW \/ naturalSum : 1;/.test(theme));
ok('long cell values are truncated with an ellipsis to their column\'s final width, not left to overflow into the next column',
  /function fitText\(doc, text, maxW\)/.test(theme));
ok('reuses the same numeric-column heuristic as the on-screen ReportTable, so PDF right-alignment matches what the user already sees on screen',
  /export function reportNumericCols\(head, rows\)/.test(theme));
ok('paginates automatically — a row that would overflow the page triggers a new page with the letterhead and table header redrawn',
  /if \(y \+ ROW_H > H - M - 20\) newPage\(\);/.test(theme));
ok('every page gets the branded letterhead, watermark, and page number — matching the "print quality" standard set for the other 4 document PDFs',
  /const pageFooter = \(\) => \{ drawWatermark\(doc, \{ W, H \}\); drawPdfPageNumber\(doc, page, \{ W, M, H \}\); \};/.test(theme));
const midDotFilters = '${filters ? `   ' + String.fromCharCode(183) + '   ${filters}` : \'\'}';
ok('title + generation date/time + applied filters are shown up top, so the PDF records exactly what was exported',
  /const generated = `Generated: /.test(theme) && theme.includes(midDotFilters));
ok('handles an empty report gracefully (explicit "No data" message, not a blank table or a crash)',
  /doc\.text\('No data for this report\.', M \+ 6, y \+ 4\);/.test(theme));

// --- Date-object safety net (asDate() returns real Date objects for Excel's cellDates;
// several reports reuse those SAME rows for the PDF export) ---
ok('a raw Date object (from lib/exportSheet.js asDate(), reused as-is by several reports) is formatted as a readable date, not stringified as a full JS Date string',
  /function cellText\(v\) \{/.test(theme) && /v instanceof Date/.test(theme) && /toLocaleDateString\('en-IN'/.test(theme));
ok('fitText routes every cell/header through cellText before measuring or truncating it',
  /const t = String\(cellText\(text\)\);/.test(theme));

// GENUINE BUG, found by actually rendering and reading a real Customer Report PDF (not
// caught by any code-pattern check): money cells came through as "'0", "'8,984" — the
// leading ₹ silently corrupted into a stray apostrophe-like glyph. Root cause: jsPDF's
// built-in Helvetica (WinAnsi encoding) has no Rupee glyph (U+20B9) — the exact same
// limitation already documented and worked around in Billing's own PDF (its `money()`
// helper uses "Rs." instead of "₹"). Report rows reuse their on-screen formatINR/inr()
// strings — correct for HTML and for Excel (real Unicode fonts), wrong for jsPDF
// specifically. Re-rendered the same Customer Report after the fix and visually
// confirmed "Rs. 0" / "Rs. 8,984" render correctly.
ok('a ₹-prefixed currency string (from a report\'s on-screen formatINR/inr() helper, reused as-is for the PDF row) is rewritten to "Rs. " before rendering, not left to render as a corrupted glyph',
  /if \(typeof v === 'string' && v\.includes\('₹'\)\) return v\.replace\(\/₹\\s\*\/g, 'Rs\. '\);/.test(theme));

// --- Part 2: wired into the global Reports tab (covers Customer/Vehicle/Service/... in one place) ---
// Settings QA fix: ReportTable/ReportsView gained demoCanExport + onProtectedAction
// so the demo "Export Excel" permission actually gates the Excel button (csv, in
// ReportsView) and the PDF button (pdf, inside ReportTable itself) — previously
// neither checked it at all. Same demoMode prop stays; two new ones ride alongside.
ok('ReportTable (shared by all 15 report sections) accepts demoMode + the export permission props',
  /function ReportTable\(\{ head, rows, exportName, exportHead, q, csv, demoMode, demoCanExport = true, onProtectedAction \}\)/.test(inv));
ok('ReportTable gained a PDF export action alongside the existing Excel one, reusing the exact same sorted rows',
  /await exportReportPDF\(\{[\s\S]{0,300}head: exportHead \|\| head,\s*\n\s*rows: sorted,/.test(inv));
ok('every <ReportTable> call site passes demoMode + the export permission props (mechanical prop-threading, not a per-section rewrite)',
  // q={dq}, not q={q} — Universal Search Engine review: Reports search is now debounced
  // (see tests/reports-alerts-analytics-search.test.cjs), the one raw-undebounced search
  // box in this file besides Alerts. Prop-threading itself (demoMode) is unaffected.
  (inv.match(/q=\{dq\} csv=\{csv\} demoMode=\{demoMode\} demoCanExport=\{demoCanExport\} onProtectedAction=\{onProtectedAction\}/g) || []).length === 15);
ok('Customer Report and Vehicle Report sections specifically are among those 15 (confirms this fixes exactly what was asked)',
  /tab === 'customer' && <Card title="Customer Report">/.test(inv) && /tab === 'vehicle' && <Card title="Vehicle Report">/.test(inv));
ok('lib/pdfTheme.js exportReportPDF is imported into InventoryDashboard.js',
  /import \{ exportReportPDF \} from '\.\.\/lib\/pdfTheme';/.test(inv));

// --- Part 3: InventoryReports.jsx (Valuation/Dead Stock/Low-Out/Profit) ---
// A later fix (E2E workflow QA) changed this from `active.csv` to `active.rows`: `csv`
// is the RAW-NUMBER array built specifically so Excel's =SUM() works over money columns,
// and passing that same raw array to the PDF generator made every currency cell render
// as a bare "1689" instead of "Rs. 1,689" — reproduced live, every other report's PDF
// correctly showed "Rs. X,XXX" because those all pass their already-formatted display
// rows. `active.rows` is that same formatted array (exportReportPDF's own cellText()
// already converts "₹1,689" to "Rs. 1,689"), so no new formatting logic was needed.
ok('InventoryReports\' PDF button reuses its already-formatted active.rows/active.cols (not the raw-number active.csv meant for Excel SUM())',
  /const head = active\.cols;\s*\n\s*const body = active\.rows;/.test(invReports) && /await exportReportPDF\(/.test(invReports));
ok('InventoryReports accepts demoMode + the export permission props and passes them through',
  /export default function InventoryReports\(\{ inventory = \[\], sales = \[\], formatINR, demoMode, demoCanExport = true, onProtectedAction \}\)/.test(invReports));

// --- Part 4: Customers/Vehicles modules ---
ok('Customers: row-building shared between Excel and PDF (buildCustomerExport), not duplicated',
  /const buildCustomerExport = \(\) => \{/.test(cust) &&
  /const \{ head, rows \} = buildCustomerExport\(\);\s*\n\s*await writeSheet/.test(cust) &&
  /const \{ head, rows, count \} = buildCustomerExport\(\);\s*\n\s*const filters = /.test(cust));
ok('Customers: PDF export respects the same active filters/search/selection as the on-screen table',
  /typeF !== 'All' && `Type: \$\{typeF\}`/.test(cust) && /statusF !== 'All' && `Status: \$\{statusF\}`/.test(cust));
ok('Vehicles: row-building shared between Excel and PDF (buildVehicleExport), not duplicated',
  /const buildVehicleExport = \(\) => \{/.test(veh) &&
  /const \{ head, rows \} = buildVehicleExport\(\);\s*\n\s*await writeSheet/.test(veh));
ok('Vehicles: PDF export respects the same active filters/search as the on-screen table',
  /makeF !== 'All' && `Make: \$\{makeF\}`/.test(veh) && /fuelF !== 'All' && `Fuel: \$\{fuelF\}`/.test(veh));

// --- Neither Excel export was removed or modified in behavior ---
ok('Customers: writeSheet (Excel) call is untouched — same filename pattern, same sheet name',
  /await writeSheet\(\{ filename: `customers-\$\{stamp\(\)\}\.xlsx`, sheetName: 'Customers', head, rows \}\);/.test(cust));
ok('Vehicles: writeSheet (Excel) call is untouched — same filename pattern, same dateCols',
  /await writeSheet\(\{ filename: `vehicles-\$\{stamp\(\)\}\.xlsx`, sheetName: 'Vehicles', head, rows, dateCols: \[8, 9\] \}\);/.test(veh));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
