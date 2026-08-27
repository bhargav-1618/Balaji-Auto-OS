/**
 * tests/sales-detail-dialog.test.cjs — Parts Sales Detail dialog UX polish:
 * sectioning, meaningful empty values, financial highlighting, dialog a11y/animation/scrollbar.
 * Source-level (JSX wiring) + logic checks. No business-logic/calculation changes asserted.
 *
 * Issue 7.7/7.8/7.9 (Stock Operations review) — the generic drawer SHELL (size,
 * sticky header, scroll lock, scrollbar, close button, animation, a11y) was
 * extracted from InventoryDashboard.js into components/common/LedgerPage.jsx as
 * `LedgerDetailDrawer`, reused now by the Inventory Stock tab and the per-part
 * Movement History modal too. The SALES-SPECIFIC content (sectioning, empty-value
 * copy, financial highlighting, the CSV-export detail object) stays in
 * InventoryDashboard.js's SalesView, since that's business logic specific to a
 * sale record, not part of the shared shell. Assertions below are split across
 * both files accordingly — the checks themselves are unchanged.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const dash = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');
const ledger = fs.readFileSync(path.resolve(__dirname, '../components/common/LedgerPage.jsx'), 'utf8');
const css = fs.readFileSync(path.resolve(__dirname, '../styles/globals.css'), 'utf8');

console.log('\nParts Sales Detail dialog — UX polish\n');

// #1 size (shared drawer shell)
ok('dialog widened to ~800px on desktop', /sm:max-w-\[800px\]/.test(ledger));
ok('dialog never overflows viewport (max-h + flex-col)', /max-h-\[88vh\] flex flex-col/.test(ledger));
// #2 sticky header (shared drawer shell)
ok('header is flex-shrink-0 (stays visible while body scrolls)', /flex-shrink-0 flex items-center justify-between px-6 py-4/.test(ledger));
ok('body scrolls independently', /ref=\{bodyRef\} className="flex-1 overflow-y-auto/.test(ledger));
// #3 sectioning (shared shell renders `.sections`; Sales itself builds them)
ok('dialog renders sections when present', /detail\.sections \?/.test(ledger));
ok('Parts Sales builds grouped sections', /title: 'Basic Information'/.test(dash) && /title: 'Pricing'/.test(dash) && /title: 'Financial'/.test(dash) && /title: 'Payment'/.test(dash) && /title: 'Workshop'/.test(dash));
// #4 meaningful empty values (Sales-specific, still in InventoryDashboard.js)
ok('GST empty → Not Applicable', /s\.gst \? num\(`\$\{s\.gst\}%`\) : muted\('Not Applicable'\)/.test(dash));
ok('Discount empty → None', /s\.discount \? num\(`\$\{s\.discount\}%`\) : muted\('None'\)/.test(dash));
ok('Payment empty → Pending', /s\.payModes \? txt\(s\.payModes\) : muted\('Pending'\)/.test(dash));
ok('Technician empty → Not Assigned', /s\.technician \? txt\(s\.technician\) : muted\('Not Assigned'\)/.test(dash));
ok('Outstanding zero → ₹0 (Paid)', /\(0\)\} \(Paid\)/.test(dash) || /\{inr\(0\)\} \(Paid\)/.test(dash));
// #5 financial highlighting (Sales-specific)
ok('profit green when positive, red when negative', /profit > 0 \? '#34d399' : profit < 0 \? '#f87171'/.test(dash));
ok('margin shown as a chip/badge', /const marginChip = <span className="inline-block[\s\S]{0,120}rounded-full/.test(dash));
ok('revenue/cost remain neutral (num, no color)', /\['Revenue', num\(inr\(s\.revenue\)\)\]/.test(dash) && /\['Cost Price', num\(inr\(s\.unitCost \|\| 0\)\)\]/.test(dash));
// #6 label alignment (shared drawer shell)
ok('fixed-width label column (grid 130px)', /grid-cols-\[130px_1fr\]/.test(ledger));
ok('numeric values right-aligned + tabular', /text-right font-medium/.test(ledger) && /tabular-nums/.test(dash));
// #7 scrollbar (shared drawer shell + global CSS)
ok('themed wider rounded scrollbar', /ledger-detail-scroll/.test(ledger) && /\.ledger-detail-scroll::-webkit-scrollbar \{ width: 9px/.test(css) && /border-radius: 9px/.test(css));
// #8 close button (shared drawer shell)
// aria-label now routes through lib/i18n.js's t('key', 'English fallback').
ok("close button larger with focus + hover", /aria-label=\{t\('common\.close', 'Close'\) \+ ' dialog'\} className="w-10 h-10[\s\S]{0,200}focus-visible:ring-2/.test(ledger));
// #10 animation (shared drawer shell + global CSS)
ok('dialog open animation 170ms', /animation: 'ledger-detail-in 170ms ease-out'/.test(ledger) && /@keyframes ledger-detail-in/.test(css));
ok('animation is fade + slight scale', /ledger-detail-in \{[\s\S]{0,80}scale\(0\.98\)/.test(css));
// #11 a11y (shared drawer shell)
ok('dialog has role + aria-modal + labelledby', /role="dialog" aria-modal="true" aria-labelledby="ledger-detail-title"/.test(ledger));
ok('Escape closes the dialog', /if \(e\.key === 'Escape'\) onClose\(\);/.test(ledger));
ok('focus returns to the previously-focused element on close', /prevFocusRef\.current = typeof document !== 'undefined' \? document\.activeElement : null;/.test(ledger) && /prevFocusRef\.current\?\.focus\?\.\(\);/.test(ledger));
// #12 regression: flat detail object preserved for CSV (no logic change; lives in shared LedgerPage now)
ok('flat detail object preserved for CSV export', /const detailRows = filtered\.map\(\(it\) => it\.detail\)/.test(ledger));
ok('detail object still carries all fields', /Revenue: inr\(s\.revenue\), Profit: inr\(s\.profit\)/.test(dash));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
