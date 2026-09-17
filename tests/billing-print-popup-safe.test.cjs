/**
 * tests/billing-print-popup-safe.test.cjs
 *
 * ID-6 — Billing "Print" (invoice detail and bulk) could silently do nothing.
 *
 * Root cause: downloadPDF/downloadCombinedInvoicePDF called
 * `window.open(doc.output('bloburl'), '_blank')` AFTER `await import('jspdf')`
 * and `await drawInvoiceDocument(...)`. A browser is free to treat the
 * triggering click's user-activation as expired by the time an async chain
 * like that resolves — confirmed live in this environment by intercepting
 * window.open: it was called with the correct blob URL and `_blank`, and
 * returned null (blocked), with no error or feedback shown to the user.
 *
 * Fix: open the tab synchronously (openPrintWindow), still inside the click
 * handler and before any await, then point it at the finished PDF once
 * generation completes (finishPrintWindow) — the standard popup-safe pattern.
 * Both failure points now give the user an explicit message and point them at
 * the still-working PDF download button instead of failing silently:
 *   - window.open() itself returns null (blocked outright)
 *   - the user closes the pre-opened tab before the PDF finishes generating
 * The plain PDF-download path (printAfter=false) is completely untouched.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const bill = fs.readFileSync(path.resolve(__dirname, '../components/billing/BillingModule.jsx'), 'utf8');

console.log('\nBilling — Print is popup-safe and never fails silently (ID-6)\n');

// --- window.open happens synchronously, before any async PDF work ---
ok('openPrintWindow opens the tab with a plain, synchronous window.open (no await before it)',
  /const openPrintWindow = \(\) => \{\s*\n\s*const win = window\.open\('', '_blank'\);/.test(bill));
ok('downloadPDF calls openPrintWindow as its very first statement — before the `await import(\'jspdf\')` that used to break the user-gesture chain',
  /const downloadPDF = async \(iv, printAfter = false, mode = 'customer'\) => \{\s*\n\s*const printWin = printAfter \? openPrintWindow\(\) : null;\s*\n\s*if \(printAfter && !printWin\) return;\s*\n\s*const \{ jsPDF \} = await import\('jspdf'\);/.test(bill));
ok('downloadCombinedInvoicePDF (bulk print) opens the same way, before its own async PDF-drawing loop',
  /const printWin = printAfter \? openPrintWindow\(\) : null;\s*\n\s*if \(printAfter && !printWin\) return;\s*\n\s*setBulkDocBusy\(/.test(bill));

// --- popup-blocked case: user is told, never silent ---
ok('openPrintWindow shows a clear, actionable error (pointing at the PDF button) when window.open() itself is blocked, and returns null instead of proceeding into a void',
  /if \(!win\) \{\s*\n\s*toast\.error\('Your browser blocked the print window\. Use the PDF button instead, or allow pop-ups for this site\.', \{ duration: 7000 \}\);\s*\n\s*return null;\s*\n\s*\}/.test(bill));
ok('both callers bail out immediately when openPrintWindow returns null (never fall through to generate a PDF nobody can see)',
  (bill.match(/if \(printAfter && !printWin\) return;/g) || []).length === 2);

// --- window-closed-mid-generation case: also never silent ---
ok('finishPrintWindow checks win.closed and tells the user (pointing at the PDF button) instead of throwing or doing nothing if the tab was closed while the PDF was still generating',
  /const finishPrintWindow = \(win, doc\) => \{\s*\n\s*if \(win\.closed\) \{\s*\n\s*toast\.error\('Print window was closed before the document was ready\. Use the PDF button instead\.', \{ duration: 7000 \}\);\s*\n\s*return;\s*\n\s*\}/.test(bill));
ok('only on the happy path does finishPrintWindow autoPrint + navigate the pre-opened window to the finished PDF',
  /doc\.autoPrint\(\);\s*\n\s*win\.location = doc\.output\('bloburl'\);\s*\n\s*\};/.test(bill));

// --- exactly one window ever, reused for loading state -> finished PDF (no duplicate windows) ---
// (BillingModule.jsx also calls window.open() for unrelated WhatsApp deep links —
// those are pre-existing, untouched, and irrelevant to printing, so this scopes
// strictly to openPrintWindow's own body, not the whole file.)
const openPrintWindowSrc = bill.slice(bill.indexOf('const openPrintWindow = ()'), bill.indexOf('const finishPrintWindow = '));
ok('exactly one window.open call inside openPrintWindow (single print window, reused for the loading placeholder AND the finished PDF — never a second, duplicate window)',
  (openPrintWindowSrc.match(/window\.open\(/g) || []).length === 1);
ok('finishPrintWindow is the only thing that calls doc.autoPrint() / sets win.location — both call sites (single + bulk print) route through it instead of duplicating the open/print logic',
  (bill.match(/doc\.autoPrint\(\)/g) || []).length === 1 && (bill.match(/finishPrintWindow\(printWin, doc\)/g) || []).length === 2);

// --- the plain PDF download path is completely unaffected ---
ok('the non-print (PDF download) branch of downloadPDF is untouched: doc.save(`${iv.invNo}.pdf`) still runs with no print-window involved',
  /if \(printAfter\) finishPrintWindow\(printWin, doc\); else doc\.save\(`\$\{iv\.invNo\}\.pdf`\);/.test(bill));
ok('the non-print (PDF download) branch of the bulk combined export is untouched: doc.save(`Invoices-N-selected-...pdf`) still runs with no print-window involved',
  /if \(printAfter\) finishPrintWindow\(printWin, doc\);\s*\n\s*else doc\.save\(`Invoices-\$\{rows\.length\}-selected-\$\{stamp\}\.pdf`\);/.test(bill));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
