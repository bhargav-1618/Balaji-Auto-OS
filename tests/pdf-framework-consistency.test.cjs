/**
 * tests/pdf-framework-consistency.test.cjs
 *
 * GLOBAL PDF GENERATION FRAMEWORK — layout, typography & readability review.
 *
 * The bug: every PDF generator (Job Card, Invoice/Estimate, Purchase Order, Supplier
 * Performance Report) hard-coded its own copy of page geometry, brand color, and shop
 * branding text, with ZERO sharing between files. That let real drift accumulate
 * silently, found by audit:
 *   - SHOP (name/tagline/phones/address/GST/email/website) was retyped by hand in
 *     both JobCardModule.jsx and BillingModule.jsx, with DIFFERENT tagline/phone/
 *     address text between them — two document types from the same shop printing
 *     different contact details, a correctness bug, not a style nuance.
 *   - The brand gold was [212,175,55] in Job Card and Invoice, an unrelated
 *     [150,120,40] in Purchase Order, and undefined in Supplier Performance.
 *   - The header band (identical visual element) was 66pt in Job Card, 62pt in
 *     Invoice — copy-paste drift.
 *   - Purchase Order had NO letterhead/branding/page numbers at all — the least
 *     formal-looking of three otherwise-comparable supplier/customer-facing PDFs.
 *   - Invoice alone used four different gray values for the same kind of divider line.
 *   - Supplier Performance was the only generator not using jsPDF's `pt` unit system
 *     (defaulted to `mm`), so its geometry lived in a different measurement space
 *     from every other document.
 *
 * Fix: lib/pdfTheme.js is now the ONE shared source for page geometry (PDF_PAGE),
 * brand color (PDF_GOLD), divider grays (PDF_RULE), text tones (PDF_TEXT), shop
 * branding (SHOP/maskShop), and the letterhead/page-number draw helpers
 * (drawPdfHeader/drawPdfPageNumber). All four generators import from it instead of
 * re-declaring their own copies. Document-specific BODY layout (line items, table
 * columns, section content) is untouched — this only touches shared letterhead
 * chrome, colors, and page geometry, never business logic or stored data.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nPart 1 — lib/pdfTheme.js: the shared source of truth\n');

const theme = read('lib/pdfTheme.js');
ok('exports PDF_PAGE with pt/a4 geometry (the ONE page-size source)',
  /export const PDF_PAGE = \{ unit: 'pt', format: 'a4', W: 595, H: 842, M: 40 \};/.test(theme));
ok('exports ONE canonical brand gold, with a deliberately darker variant for text directly on white paper (readability)',
  /export const PDF_GOLD = \{ onDark: \[212, 175, 55\], onLight: \[150, 110, 30\] \};/.test(theme));
ok('exports shared divider/rule grays (replacing 4 different ad hoc values in Invoice alone)',
  /export const PDF_RULE = \{ light: \[224, 224, 224\], medium: \[190, 190, 190\] \};/.test(theme));
ok('exports ONE canonical SHOP branding object (was hand-retyped, with drift, in 2 files)',
  /export const SHOP = \{/.test(theme) && /TRUSTED FOR OVER 25 YEARS/.test(theme));
ok('exports a shared demo-mode masking helper', /export function maskShop\(/.test(theme));
ok('exports a shared letterhead-drawing helper', /export function drawPdfHeader\(/.test(theme));
ok('exports a shared page-number footer helper', /export function drawPdfPageNumber\(/.test(theme));
ok('header band height is a single named constant (was 66 in Job Card, 62 in Invoice — literal drift)',
  /export const HEADER_BAND_H = 66;/.test(theme));

console.log('\nPart 2 — every generator migrated off its own local copies, onto the shared theme\n');

// --- Job Card ---
{
  const src = read('components/jobcards/JobCardModule.jsx');
  // Widened from an exact-import-line match: the readability follow-up pass added
  // drawSectionTitle/drawSignatureBlock/drawChipList/drawPhotoGrid/PDF_SPACING to
  // the same import — check the original letterhead names are still all present on
  // that import line, not that the line is byte-identical to before.
  {
    const importLine = (src.match(/^import \{[^}]*\} from '\.\.\/\.\.\/lib\/pdfTheme';$/m) || [''])[0];
    ok('Job Card: imports the shared theme (page/gold/shop/header/page-number)',
      ['PDF_PAGE', 'PDF_GOLD', 'SHOP', 'maskShop', 'drawPdfHeader', 'drawPdfPageNumber'].every((n) => importLine.includes(n)));
  }
  ok('Job Card: no more local SHOP re-declaration', !/const SHOP = \{\s*\n\s*name: 'SRI BABA BALAJI/.test(src));
  // `shop: brandedShop` (not bare `shop`) since the Business Logo feature: a copy of
  // `shop` with the Settings-configured logoDataUrl merged in, so drawPdfHeader can
  // draw it — still a straight delegation to the shared helper, just with the logo
  // resolved first rather than the header band losing branding capability.
  ok('Job Card: header/page-number delegate to the shared helpers', /const pageNo = \(\) => drawPdfPageNumber\(doc, page, \{ W, M \}\);/.test(src) && /const header = \(sub\) => drawPdfHeader\(doc, \{ W, M, shop: brandedShop, sub \}\);/.test(src));
  ok('Job Card: page geometry comes from PDF_PAGE, not a local literal', /const \{ W, M \} = PDF_PAGE;/.test(src));
  // Settings QA fix: the intermediate `shop = demoMode ? maskShop(SHOP) : SHOP`
  // (bare hardcoded SHOP either way) is gone — brandedShop is now built directly
  // from liveShop(demoMode) (Settings -> Business Profile), masked in demo mode via
  // the same shared maskShop() helper, matching Billing's identical fix.
  ok('Job Card: demo-mode masking uses the shared helper, applied to the live Settings-driven shop',
    /const brandedShop = demoMode \? maskShop\(liveShop\(demoMode\)\) : liveShop\(demoMode\);/.test(src));
}

// --- Invoice / Estimate (Billing) ---
{
  const src = read('components/billing/BillingModule.jsx');
  // Widened for the same reason as Job Card above: drawPdfPageNumber was added to
  // this import (Billing previously had NO page numbers at all — see the dedicated
  // "no broken page breaks" assertions further down).
  // PDF_GOLD dropped out of this specific import list when the Workshop Copy PDF
  // redesign moved every workshop-mode section (including everything gold-styled —
  // the profitability panel, the header card's accents) into its own dedicated
  // module (lib/workshopInvoicePdf.js, checked separately below); the customer
  // copy that stays in this file never used PDF_GOLD.
  {
    const importLine = (src.match(/^import \{[^}]*\} from '\.\.\/\.\.\/lib\/pdfTheme';$/m) || [''])[0];
    ok('Billing: imports the shared theme', ['PDF_PAGE', 'PDF_RULE', 'SHOP', 'maskShop', 'drawPdfHeader'].every((n) => importLine.includes(n)));
  }
  ok('Billing: delegates the workshop copy to the dedicated renderer, not a re-declared local one',
    /import \{ renderWorkshopInvoicePdf \} from '\.\.\/\.\.\/lib\/workshopInvoicePdf';/.test(src));
  ok('Billing: no more local SHOP re-declaration', !/const SHOP = \{\s*\n\s*name: 'SRI BABA BALAJI MARUTI CARE', tag:/.test(src));
  ok('Billing: header delegates to the shared helper (was its own 62pt-tall hand-drawn band)',
    /drawPdfHeader\(doc, \{ W, M, shop \}\);/.test(src));
  ok('Billing: page geometry comes from PDF_PAGE', /const \{ W, M \} = PDF_PAGE;/.test(src));
  // Back down to 3 (one call site per table type: Parts, Labour, Other) now that
  // the Workshop Copy PDF redesign moved every workshop-mode table into its own
  // module — this file only draws the CUSTOMER copy's tables. The new module has
  // its own equivalent guard just below.
  ok('Billing: the 3 line-item row dividers use the shared light rule (were a hard-coded (224,224,224))',
    (src.match(/setDrawColor\(\.\.\.PDF_RULE\.light\)/g) || []).length === 3);
  ok('Billing: the totals/footer/signature dividers use the shared medium rule (were 3 different grays: 200/210/180)',
    (src.match(/setDrawColor\(\.\.\.PDF_RULE\.medium\)/g) || []).length === 3);
  ok('Billing: no raw 212,175,55 gold literal left (fully delegated to PDF_GOLD via the shared header)',
    !/212, 175, 55/.test(src));
}

// --- Purchase Order ---
{
  const src = read('components/inventory/SupplierPOBuilder.jsx');
  // Settings QA fix: SHOP dropped from this import — Purchase Order now calls
  // liveShop(demoMode) (Settings -> Business Profile: Workshop Name/Phone/GST/
  // Address/Email/Logo), not the bare hardcoded SHOP, so a saved Business Profile
  // actually shows on generated Purchase Orders like it already does on Invoice/Job
  // Card. SHOP itself is unused here now (no local re-declaration, no direct read).
  ok('Purchase Order: imports the shared theme', /import \{ PDF_PAGE, PDF_GOLD, PDF_RULE, PDF_TEXT, liveShop, drawPdfHeader, drawPdfPageNumber \} from '\.\.\/\.\.\/lib\/pdfTheme';/.test(src));
  ok('Purchase Order: now draws the shared branded letterhead, live from Settings (previously had NO header band/branding at all, then a hardcoded SHOP)',
    /drawPdfHeader\(doc, \{ W, M, shop: liveShop\(demoMode\) \}\)/.test(src));
  ok('Purchase Order: the rogue third gold value (150,120,40) is gone, replaced by the shared on-light gold token',
    !/150, 120, 40/.test(src) && /PDF_GOLD\.onLight/.test(src));
  ok('Purchase Order: now stamps page numbers (previously had none, despite already paginating on overflow)',
    /drawPdfPageNumber\(doc, p, \{ W, M \}\)/.test(src));
  ok('Purchase Order: page geometry comes from PDF_PAGE, not bare 40/555 literals', /const \{ W, M \} = PDF_PAGE;/.test(src));
}

// --- Supplier Performance Report ---
{
  const src = read('components/inventory/SupplierPerformance.jsx');
  // Widened for the same reason as Job Card/Billing above: drawPdfPageNumber was
  // added once this generator's own silent 40-row data cap was removed and its
  // (now genuinely multi-page) output needed page numbers too.
  {
    const importLine = (src.match(/^import \{[^}]*\} from '\.\.\/\.\.\/lib\/pdfTheme';$/m) || [''])[0];
    ok('Supplier Performance: imports the shared theme (page geometry + text tones)',
      ['PDF_PAGE', 'PDF_TEXT'].every((n) => importLine.includes(n)));
  }
  ok('Supplier Performance: now uses pt units explicitly (was the only generator left on jsPDF\'s default mm)',
    /new jsPDF\(\{ unit: PDF_PAGE\.unit, format: PDF_PAGE\.format, orientation: 'landscape' \}\)/.test(src));
  ok('Supplier Performance: margin comes from the shared PDF_PAGE.M, not a local literal', /const \{ M \} = PDF_PAGE;/.test(src));
  ok('Supplier Performance: title/subtitle/body use the shared text-color tokens', /PDF_TEXT\.ink/.test(src) && /PDF_TEXT\.muted/.test(src) && /PDF_TEXT\.body/.test(src));
}

// --- Workshop Copy PDF renderer (Issue 2 redesign) ---
{
  const src = read('lib/workshopInvoicePdf.js');
  {
    const importLine = (src.match(/^import \{[^}]*\} from '\.\/pdfTheme';$/m) || [''])[0];
    ok('Workshop PDF: imports the shared theme (page/gold/rule/text/header)',
      ['PDF_PAGE', 'PDF_GOLD', 'PDF_RULE', 'PDF_TEXT', 'drawPdfHeader'].every((n) => importLine.includes(n)));
  }
  ok('Workshop PDF: the 4 row/rule dividers use the shared light rule, not a hard-coded gray',
    (src.match(/setDrawColor\(\.\.\.PDF_RULE\.light\)/g) || []).length === 4);
  ok('Workshop PDF: the Profitability panel is the only accent-bordered card (PDF_GOLD.onLight border)',
    (src.match(/borderAccent: PDF_GOLD\.onLight/g) || []).length === 1);
  ok('Workshop PDF: page geometry comes from PDF_PAGE, not bare literals', /const \{ W, M \} = PDF_PAGE;/.test(src));
  ok('Workshop PDF: no raw 212,175,55 gold literal (fully delegated to PDF_GOLD)', !/212, 175, 55/.test(src));
}

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
