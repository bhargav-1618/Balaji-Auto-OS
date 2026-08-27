/**
 * tests/pdf-framework-readability.test.cjs
 *
 * GLOBAL PDF GENERATION FRAMEWORK — LAYOUT, TYPOGRAPHY, READABILITY & PRINT QUALITY
 * REVIEW. Follow-up to the letterhead/constants consolidation (see
 * pdf-framework-consistency.test.cjs) — that pass unified page geometry, brand color,
 * SHOP branding and the header/footer. This pass goes into the DOCUMENT BODY itself:
 * heading-to-content spacing, list/bullet compression, inspection-group separation,
 * signature block consistency, adaptive photo grids, and two genuine dynamic-content
 * bugs (Job Card silently dropped photos past 8; Billing had no page numbers and no
 * letterhead at all on continuation pages; Supplier Performance silently dropped rows
 * past 40). No business logic or generated data touched anywhere in this pass —
 * only shared draw helpers replacing hand-rolled, per-generator, and in Job Card's
 * case internally-duplicated (two near-identical signature blocks) copies.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const R = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nPDF framework — typography, spacing, signature/photo helpers, dynamic content\n');

const theme = R('lib/pdfTheme.js');

// --- Part 1: the new shared helpers exist ---
// Batch 3 Defect 4/5: "signature area appears cramped" — 34pt (~12mm) above the
// line wasn't enough room for an actual pen signature (standard practice leaves
// ~16-20mm); bumped to 46pt, shared by every document using this signature block.
ok('exports PDF_SPACING (afterSectionTitle, groupGap, signatureTopGap, signatureLabelGap)',
  /export const PDF_SPACING = \{/.test(theme) && /afterSectionTitle: 14/.test(theme) && /groupGap: 12/.test(theme) && /signatureTopGap: 46/.test(theme));
ok('drawSectionTitle gives real breathing room below a heading (14pt, was a flat 8pt)',
  /export function drawSectionTitle\(doc, y, text,/.test(theme) && /return y \+ PDF_SPACING\.afterSectionTitle;/.test(theme));
ok('drawSignatureBlock draws a consistent left+right signature pair, replacing copy-pasted per-caller code',
  /export function drawSignatureBlock\(doc, y, leftLabel, rightLabel,/.test(theme));
ok('drawChipList exists — turns a LIST of discrete items into a wrapping flow instead of one undifferentiated paragraph',
  /export function drawChipList\(doc, x, y, items, maxWidth,/.test(theme));
ok('drawChipList wraps to a new row when a chip would overflow, rather than always growing one line',
  /if \(cx \+ totalW > x \+ maxWidth && cx > x\) \{ cx = x; cy \+= lineGap; \}/.test(theme));
ok('drawPhotoGrid exists — computes columns from available width instead of a hard-coded per-row count',
  /export function drawPhotoGrid\(doc, photos, \{ x, y, maxWidth, bottomLimit,/.test(theme) &&
  /const cols = Math\.max\(1, Math\.floor\(\(maxWidth \+ gap\) \/ \(cellW \+ gap\)\)\);/.test(theme));
ok('drawPhotoGrid numbers repeated captions ("BEFORE 1", "BEFORE 2"...) instead of an undifferentiated repeated label',
  /const caption = seen\[captionBase\] > 1 \|\| photos\.filter/.test(theme));
ok('drawPhotoGrid paginates via a caller-supplied newPage() when content would overflow, rather than silently dropping items',
  /if \(py \+ cellH \+ captionGap > bottomLimit\) \{\s*\n\s*const resume = newPage\(\);/.test(theme));

// --- Part 2: Job Card actually uses them ---
const jc = R('components/jobcards/JobCardModule.jsx');
ok('Job Card: secTitle delegates to the shared drawSectionTitle',
  /const secTitle = \(y, t\) => drawSectionTitle\(doc, y, t, \{ M, gold \}\);/.test(jc));
ok('Job Card: dashboard warnings / accessories / damages use drawChipList (were one wrapped comma-paragraph each)',
  (jc.match(/drawChipList\(doc, M \+ 2, y,/g) || []).length === 3);
ok('Job Card: both signature blocks (page 1 client/advisor, page 2 technician/QC) use the shared drawSignatureBlock',
  (jc.match(/drawSignatureBlock\(doc, y, /g) || []).length === 2);
ok('Job Card: inspection-category gap uses the shared PDF_SPACING.groupGap',
  /iy \+= PDF_SPACING\.groupGap; colY\[col\] = iy;/.test(jc));
ok('Job Card: photo page uses the shared adaptive drawPhotoGrid (was a hard .slice(0, 8) + fixed 120x90 grid)',
  /drawPhotoGrid\(doc, photos, \{/.test(jc) && !/photos\.slice\(0, 8\)/.test(jc));
ok('Job Card: photo grid pagination redraws the letterhead + page number on each new photo page (no blank continuation page)',
  /newPage: \(\) => \{ pageNo\(\); doc\.addPage\(\); page \+= 1; header\('SERVICE PHOTOS'\); watermark\(\); return 78; \}/.test(jc));

// --- Part 3: Billing's genuine dynamic-content bugs are fixed ---
const bill = R('components/billing/BillingModule.jsx');
ok('Billing: now stamps page numbers on every page (previously had NONE anywhere in the generator)',
  // Widened for the Workshop PDF polish pass: the loop now also passes
  // `total` (opt-in, workshop-only — "Page N of Total", Issue 4) alongside
  // the original `{ W, M }` every page already got.
  // Universal selection→export/PDF/print record-set review — setPage's target
  // widened again, from the page's own absolute index (p) to pageStart + p - 1:
  // downloadPDF became a thin wrapper around the shared drawInvoiceDocument
  // drawer (see tests/billing-combined-pdf.test.cjs), which can now be invoked
  // for an invoice sitting anywhere inside a combined multi-invoice PDF — its
  // footer must still read "Page 1 of 2" relative to ITS OWN pages, not the
  // combined document's absolute page count.
  /for \(let p = 1; p <= page; p \+= 1\) \{ doc\.setPage\(pageStart \+ p - 1\); drawPdfPageNumber\(doc, p, \{ W, M, total: isWorkshop \? page : undefined \}\); \}/.test(bill));
ok('Billing: continuation pages (long invoices) redraw the branded letterhead instead of starting on a blank, unidentified page',
  /drawPdfHeader\(doc, \{ W, M, shop, sub: `\$\{docTypeLabel\} — \$\{iv\.invNo\} \(continued\)`\}/.test(bill) ||
  /drawPdfHeader\(doc, \{ W, M, shop, sub: `\$\{docTypeLabel\} — \$\{iv\.invNo\} \(continued\)` \}\)/.test(bill));
ok('Billing: the totals block reserves room for itself as a whole (won\'t split mid-block or collide with the fixed-position footer)',
  /if \(y \+ 8 \+ 130 > 700\) \{ doc\.addPage\(\); page \+= 1;/.test(bill));

// --- Part 4: Supplier Performance's silent data-loss bug is fixed ---
const sp = R('components/inventory/SupplierPerformance.jsx');
ok('Supplier Performance: no longer caps the export at 40 rows (pagination already handles any length correctly)',
  !/data\.slice\(0, 40\)/.test(sp) && /data\.forEach\(\(row\) => \{/.test(sp));
ok('Supplier Performance: now stamps page numbers on every page (previously had none)',
  /for \(let p = 1; p <= page; p \+= 1\) \{ doc\.setPage\(p\); drawPdfPageNumber/.test(sp));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
