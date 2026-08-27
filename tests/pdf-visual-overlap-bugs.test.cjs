/**
 * tests/pdf-visual-overlap-bugs.test.cjs
 *
 * Two genuine, VISIBLE bugs found by actually rendering and reading real PDFs — the
 * kind of defect a regex-only test suite structurally cannot catch on its own, since
 * jsPDF draws imperatively at runtime and nothing about a wrong y-coordinate shows up
 * as a syntax or type error. Both were caught by generating a live PDF from the app
 * and reading the rendered output directly, then reproduced mathematically here so a
 * future change to the same code can't silently reintroduce either one.
 *
 * Bug 1 — Billing invoice: the QR code's "Scan to verify" caption landed INSIDE the
 * "PARTS USED" table header's filled bar. Caption at `qrTop + QR_PT + 8` = 261; the
 * header bar (old formula) spanned 259-277 — direct overlap, visible in the actual
 * exported PDF as caption text rendering inside the gray bar.
 *
 * Bug 2 — Billing invoice: the divider rule above "Grand Total" cut through the text
 * itself. The rule sat a flat 6pt above the row's own text baseline — fine for a
 * same-size row, but "Grand Total" draws at bold 10pt (the rows around it are 8.5pt),
 * so its own cap-height/ascenders reached up into where the rule was drawn.
 *
 * A third, related fix (typography consistency, not an overlap) is also guarded here:
 * Purchase Order's "PURCHASE ORDER" document-type label was 12pt normal-weight while
 * Billing's equivalent "TAX INVOICE"/"ESTIMATE" label — the one other document with a
 * comparable "type label directly under the letterhead" — is 13pt bold. Matched the
 * size/weight (kept PO's intentional gold color, not reverted to Billing's black).
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/billing/BillingModule.jsx'), 'utf8');
const po = fs.readFileSync(path.resolve(__dirname, '../components/inventory/SupplierPOBuilder.jsx'), 'utf8');

console.log('\nBilling PDF — QR caption no longer overlaps the PARTS USED table header\n');

// Workshop Copy PDF redesign: the workshop variant's QR is now drawn entirely by
// lib/workshopInvoicePdf.js's own structured header card (its own caption, its
// own position) — this customer-only line lost the isWorkshop ternary it used to
// share with that code path, but the POSITION this bug is actually about
// (qrTop + QR_PT + 8) is unchanged for the copy that still uses it; only assert that.
ok('customer-copy QR caption is drawn at qrTop + QR_PT + 8 (unchanged — this is the fixed point the table header must clear)',
  /doc\.text\('Scan to verify', W - M - QR_PT \/ 2, qrTop \+ QR_PT \+ 8, \{ align: 'center' \}\)/.test(src));
ok('line-items / table-header start y now reserves qrTop + QR_PT + 32 (was + 18), clearing the caption with real margin',
  /let y = Math\.max\(by \+ 8, qrTop \+ QR_PT \+ 32\);/.test(src));
ok('the old, too-tight + 18 gap is gone (would silently reintroduce the overlap)',
  !/let y = Math\.max\(by \+ 8, qrTop \+ QR_PT \+ 18\);/.test(src));

// Reproduce the actual geometry: header bar top must clear the caption's visual bottom.
{
  const qrTop = 140, QR_PT = 113;
  const captionY = qrTop + QR_PT + 8;      // 261 — caption baseline
  const captionVisualBottom = captionY + 3; // ~3pt descender clearance for a 6pt font
  const yNew = Math.max(0, qrTop + QR_PT + 32); // mirrors the fixed formula (`by` was never the binding constraint in the reported case)
  const headerBarTop = yNew - 12;
  ok('reproduced geometry: the table header bar\'s top edge now sits below the QR caption\'s visual bottom (no overlap)',
    headerBarTop > captionVisualBottom,
    `headerBarTop=${headerBarTop}, captionVisualBottom=${captionVisualBottom}`);
}

console.log('\nBilling PDF — divider rule no longer cuts through "Grand Total" text\n');

ok('extra clearance is added above the grand-total rule before it\'s drawn (y += 4)',
  /if \(Math\.abs\(t\.roundOff\) > 0\.001\) row\('Round Off', t\.roundOff\);\s*\n[\s\S]{0,600}y \+= 4;\s*\n\s*doc\.setDrawColor\(\.\.\.PDF_RULE\.medium\); doc\.line\(lx, y, cAmt, y\);/.test(src));
ok('extra clearance is added below the rule before Grand Total\'s own (larger, bold) text is drawn (y += 12)',
  /doc\.line\(lx, y, cAmt, y\);\s*\n\s*y \+= 12;\s*\n\s*row\('Grand Total', t\.grand, true\);/.test(src));
ok('the old tight `y - 6` rule offset (drawn at the SAME y Grand Total\'s own text uses) is gone',
  !/doc\.line\(lx, y - 6, cAmt, y - 6\);/.test(src));

console.log('\nPurchase Order PDF — document-type label typography matches Billing\'s equivalent\n');

ok('"PURCHASE ORDER" label is 13pt bold (was 12pt normal) — matches Billing\'s "TAX INVOICE"/"ESTIMATE" label size/weight',
  /doc\.setFontSize\(13\); doc\.setFont\(undefined, 'bold'\); doc\.setTextColor\(\.\.\.PDF_GOLD\.onLight\); doc\.text\('PURCHASE ORDER', M, y\); doc\.setFont\(undefined, 'normal'\);/.test(po));
ok('the gold color itself is intentionally kept (not reverted to Billing\'s black) — a prior, documented design decision',
  /PDF_GOLD\.onLight/.test(po));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
