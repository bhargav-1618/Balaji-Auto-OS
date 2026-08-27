// lib/pdfTheme.js
//
// GLOBAL PDF GENERATION FRAMEWORK — the ONE shared letterhead/typography/color source
// for every generated PDF (Job Card, Invoice/Estimate, Purchase Order, Supplier
// Performance Report). Before this file existed, each generator hard-coded its own
// copy of these values with zero sharing between files, and that let real drift
// accumulate silently:
//
//   - SHOP (shop name/tagline/phones/address/GST/email/website) was retyped by hand
//     in both JobCardModule.jsx and BillingModule.jsx, with DIFFERENT tagline/address
//     copy between the two files — two document types from the same shop printing
//     different contact details is a real correctness bug, not a style nuance.
//   - The brand gold was [212,175,55] in Job Card and Invoice, an unrelated
//     [150,120,40] in Purchase Order, and not defined at all in Supplier Performance.
//   - The header band (the near-black rect the shop name sits in) was 66pt tall in
//     Job Card and 62pt in Invoice for the IDENTICAL visual element — copy-paste
//     drift, not an intentional difference — and Purchase Order had no header band,
//     no branding, and no logo at all: the least formal-looking of three otherwise
//     comparable supplier/customer-facing documents.
//   - Divider/rule lines used four different gray values in Invoice alone.
//
// None of this is business logic — no calculation, tax, total, or stored field
// changes here, only the shared letterhead chrome and the constants that drive it.
// Document-specific BODY layout (line items, columns, section content) is untouched
// and stays in each generator, since that legitimately differs by document type.

export const PDF_PAGE = { unit: 'pt', format: 'a4', W: 595, H: 842, M: 40 };

// One brand gold, used everywhere. `onDark` is the full-brightness value — only ever
// painted against the near-black header band, where its brightness gives strong
// contrast. `onLight` is a deliberately darker/desaturated gold for the rare case
// gold text sits directly on white paper (e.g. Purchase Order's document-type label):
// full-brightness gold there reads as washed-out/low-contrast, which the
// "readability" part of this review specifically called out.
export const PDF_GOLD = { onDark: [212, 175, 55], onLight: [150, 110, 30] };

// Divider/rule grays — Invoice alone previously used four different values
// ((200,200,200), (210,210,210), (224,224,224), (180,180,180)) for what is visually
// the same kind of line. Two deliberately-chosen weights, shared by every generator.
export const PDF_RULE = { light: [224, 224, 224], medium: [190, 190, 190] };

export const PDF_TEXT = { ink: [20, 20, 20], body: [30, 30, 30], muted: [110, 110, 110], faint: [150, 150, 150], danger: [150, 40, 40] };

// Type sizes for the letterhead / identity elements every branded document shares.
// Document BODY text (table cells, line items, section content) stays sized per
// document — that legitimately varies with how much each document needs to fit.
export const PDF_FONT = { brand: 15, tagline: 6.5, contact: 7.5, address: 6.5, legal: 6, sectionTitle: 8.5, pageNum: 8 };

export const HEADER_BAND_H = 66; // was 66 in Job Card, 62 in Invoice — Job Card's value wins (already fits the fuller 5-line letterhead; Invoice gains a touch more breathing room, not less).

export const SHOP = {
  name: 'SRI BABA BALAJI MARUTI CARE',
  tag: 'PREMIUM AUTOMOTIVE SERVICE & DIAGNOSTICS · TRUSTED FOR OVER 25 YEARS',
  phones: '98665 71263 | 98661 23631 | 99125 60999',
  address: 'Door No. 7-10-38/3, NH16, Near Pantulugari Meda Bus Stop, Panthulugarimeda, Old Gajuwaka, Gajuwaka, Andhra Pradesh 530026',
  gst: '37XXXXX0000X1Z5',
  email: 'sribababalaji@gmail.com',
  website: 'balaji-auto-os.vercel.app',
};

// Demo-mode masking — was duplicated with slightly different field sets between Job
// Card (masked phones/address/gst/email/website) and Invoice (masked phones/gst/
// address only). One canonical mask, applied everywhere demo mode is on.
const MASK = 'XXXXXXXX';
export function maskShop(shop = SHOP) {
  return { ...shop, phones: 'XXXXXXXXXX', address: MASK, gst: MASK, email: MASK, website: MASK };
}

// Settings QA fix: Settings -> Business Profile -> Business Identity's own card
// description says these fields are "Shown on invoices, estimates and reports", and
// Workshop Name/Phone/Email/GST Number/Address all saved correctly into
// biz.bizName/bizPhone/bizEmail/bizGst/bizAddress (localStorage
// maruti_settings/maruti_settings_demo) — but every PDF generator imported the bare
// hardcoded SHOP constant above directly and never read them, so the description was
// simply not true. This is the ONE place that reads Settings for PDF letterhead
// purposes; every generator now calls liveShop(demoMode) instead of using SHOP
// directly (same file already did this for the logo alone via each generator's own
// readBusinessLogo()-style read — consolidated here so a future field only needs
// wiring once). Only OVERRIDES with a non-empty saved value: a shop that never
// touched GST Number still prints SHOP's placeholder GSTIN, not a blank line.
export function liveShop(demoMode = false) {
  let biz = {};
  try { biz = JSON.parse(localStorage.getItem(demoMode ? 'maruti_settings_demo' : 'maruti_settings') || '{}'); } catch { /* keep defaults */ }
  const shop = { ...SHOP, logoDataUrl: biz.logoDataUrl || null };
  if (biz.bizName) shop.name = biz.bizName;
  if (biz.bizPhone) shop.phones = biz.bizPhone;
  if (biz.bizGst) shop.gst = biz.bizGst;
  if (biz.bizAddress) shop.address = biz.bizAddress;
  if (biz.bizEmail) shop.email = biz.bizEmail;
  // Settings -> Billing -> Invoice Footer/Bank-UPI Details/Invoice Terms
  // ("Printed on every invoice and estimate") — three orphaned fields found the
  // same QA pass: all saved into biz.bizFooter/bankDetails/terms but had no
  // reader. null (not '') when unset, so a caller can tell "use my own default"
  // apart from "the owner deliberately saved an empty value".
  const clean = (v) => (v && String(v).trim() ? String(v).trim() : null);
  shop.footerText = clean(biz.bizFooter);
  shop.bankDetails = clean(biz.bankDetails);
  shop.termsText = clean(biz.terms);
  shop.hoursText = clean(biz.bizHours);
  return shop;
}

/**
 * Draw the shared letterhead band: near-black rect, shop name in gold, tagline/
 * phones/address/GST-email-website in white-on-black, then a gold divider bar.
 * Returns the y-coordinate immediately below the band (where document body content
 * should start).
 *
 * Pass `sub` (a running-header title, e.g. "WORKSHOP FLOOR & QUALITY CONTROL") for
 * continuation pages that need a slim repeat header instead of the full letterhead —
 * mirrors Job Card's existing two-mode header, now shared.
 */
// Logo box, top-left of the header band — sized to sit inside HEADER_BAND_H (66pt)
// with room above/below, and far enough from the centered shop name that even a
// long workshop name doesn't collide with it (see SHOP.name above: comfortably
// short relative to a 595pt page, and this box only claims the far-left ~50pt).
const LOGO_BOX = { x: PDF_PAGE.M + 6, y: 40, size: 50 };

export function drawPdfHeader(doc, { W = PDF_PAGE.W, M = PDF_PAGE.M, shop = SHOP, sub } = {}) {
  doc.setFillColor(20, 20, 20);
  if (sub) {
    doc.rect(M, 34, W - 2 * M, 26, 'F');
    doc.setTextColor(240); doc.setFontSize(10); doc.setFont(undefined, 'bold');
    doc.text(sub, W / 2, 51, { align: 'center' });
    doc.setFont(undefined, 'normal');
    return 34 + 26 + 12;
  }
  doc.rect(M, 34, W - 2 * M, HEADER_BAND_H, 'F');
  // Business Logo (Settings → Business Profile → Branding), when configured —
  // object-fit: contain into a fixed box using the image's own natural aspect
  // ratio (never stretched), matching the on-screen preview's same behavior. A
  // logo is entirely optional: no logoDataUrl means the header renders exactly as
  // it always did, byte-for-byte the same layout as before this field existed.
  if (shop.logoDataUrl) {
    try {
      const box = LOGO_BOX;
      const props = doc.getImageProperties(shop.logoDataUrl);
      const scale = Math.min(box.size / props.width, box.size / props.height);
      const w = props.width * scale; const h = props.height * scale;
      doc.addImage(shop.logoDataUrl, 'PNG', box.x + (box.size - w) / 2, box.y + (box.size - h) / 2, w, h);
    } catch { /* a corrupt/unreadable logo never breaks the rest of the PDF */ }
  }
  doc.setTextColor(...PDF_GOLD.onDark); doc.setFontSize(PDF_FONT.brand); doc.setFont(undefined, 'bold');
  doc.text(shop.name, W / 2, 54, { align: 'center' });
  doc.setTextColor(235); doc.setFontSize(PDF_FONT.tagline); doc.setFont(undefined, 'normal');
  doc.text(shop.tag, W / 2, 65, { align: 'center' });
  doc.setTextColor(...PDF_GOLD.onDark); doc.setFontSize(PDF_FONT.contact);
  doc.text(shop.phones, W / 2, 76, { align: 'center' });
  doc.setTextColor(220); doc.setFontSize(PDF_FONT.address);
  doc.text(shop.address, W / 2, 86, { align: 'center', maxWidth: W - 2 * M - 20 });
  doc.setFontSize(PDF_FONT.legal); doc.setTextColor(200);
  doc.text(`GST: ${shop.gst}   ·   ${shop.email}   ·   ${shop.website}`, W / 2, 95, { align: 'center' });
  doc.setFillColor(...PDF_GOLD.onDark); doc.rect(M, 34 + HEADER_BAND_H, W - 2 * M, 2.4, 'F');
  return 34 + HEADER_BAND_H + 22;
}

/**
 * Shared page-number footer: "Page N", bottom-right, muted gray. Pass `total`
 * to render "Page N of Total" instead — opt-in so every existing caller
 * (Job Card, Purchase Order, Supplier Performance, Billing customer copy)
 * keeps its exact prior output; only a caller that starts passing `total`
 * sees the longer form.
 */
export function drawPdfPageNumber(doc, page, { W = PDF_PAGE.W, M = PDF_PAGE.M, H = PDF_PAGE.H, total } = {}) {
  doc.setFontSize(PDF_FONT.pageNum); doc.setTextColor(...PDF_TEXT.faint);
  doc.text(total ? `Page ${page} of ${total}` : `Page ${page}`, W - M, H - 14, { align: 'right' });
}

// ============================================================================
// LAYOUT/TYPOGRAPHY/READABILITY follow-up — everything below addresses the
// specific complaints the letterhead-only pass above didn't touch: heading-to-
// content spacing, inspection/list-group separation, signature block alignment,
// and adaptive photo grids. Same rule as above: no business logic, no generated
// data, only shared draw helpers that replace hand-rolled, per-generator copies.

// Was 8pt in Job Card's original secTitle (title baseline to first content line) —
// tight enough to read as "heading and content are positioned too close together."
export const PDF_SPACING = {
  afterSectionTitle: 14,   // was 8
  groupGap: 12,            // gap between sibling groups (e.g. inspection categories) — was 6-8, inconsistently
  // 34pt (~12mm) read as cramped for an actual pen signature — standard practice
  // for a signature line leaves ~16-20mm above it. 46pt (~16mm) applies to every
  // document that shares this signature block (Job Card, Invoice, Purchase Order).
  signatureTopGap: 46,     // was 34
  signatureLabelGap: 9,    // signature line to its caption label
};

/**
 * Section heading: the gold tab + bold title every document body uses to open a
 * section. Returns the y where content should start — now with real breathing room
 * below the title instead of the old flat +8.
 */
export function drawSectionTitle(doc, y, text, { M = PDF_PAGE.M, gold = PDF_GOLD.onDark } = {}) {
  doc.setFillColor(...gold); doc.rect(M, y - 8, 3, 11, 'F');
  doc.setTextColor(...PDF_TEXT.body); doc.setFontSize(PDF_FONT.sectionTitle); doc.setFont(undefined, 'bold');
  doc.text(text, M + 8, y); doc.setFont(undefined, 'normal');
  return y + PDF_SPACING.afterSectionTitle;
}

/**
 * A pair of signature lines (left + right), consistently spaced. Job Card drew this
 * twice by hand (once per page) with the same magic numbers copy-pasted between them
 * — "signature blocks appear unfinished / inconsistent alignment" is exactly what
 * copy-pasted-then-independently-tweaked spacing produces. One implementation, used
 * everywhere a document needs a signature pair.
 */
export function drawSignatureBlock(doc, y, leftLabel, rightLabel, { W = PDF_PAGE.W, M = PDF_PAGE.M, lineW = 150 } = {}) {
  doc.setDrawColor(60);
  doc.line(M, y, M + lineW, y);
  doc.line(W - M - lineW, y, W - M, y);
  doc.setFontSize(6.5); doc.setTextColor(90);
  doc.text(leftLabel, M, y + PDF_SPACING.signatureLabelGap);
  doc.text(rightLabel, W - M - lineW, y + PDF_SPACING.signatureLabelGap);
  return y + PDF_SPACING.signatureLabelGap;
}

/**
 * A flowing "chip" list — short discrete items (dashboard warnings, accessories on
 * file, pre-existing damages) laid out left-to-right with a visible separator dot,
 * wrapping to a new row automatically when a chip would overflow the available
 * width. Replaces the old `items.join(', ')` + `splitTextToSize` treatment, which
 * turned a LIST of distinct items into one undifferentiated wrapped paragraph —
 * "large text blocks should organize into multiple rows/columns" — a chip flow
 * keeps each item visually distinct while still wrapping naturally. Returns the new y.
 */
export function drawChipList(doc, x, y, items, maxWidth, { fontSize = 7, color = PDF_TEXT.body, lineGap = 11, emptyText = '—' } = {}) {
  doc.setFontSize(fontSize); doc.setTextColor(...color);
  if (!items || !items.length) { doc.text(emptyText, x, y); return y + lineGap; }
  const sep = '   ·   ';
  const sepW = doc.getTextWidth(sep);
  let cx = x; let cy = y;
  items.forEach((raw, i) => {
    const item = String(raw);
    const w = doc.getTextWidth(item);
    const needsSep = cx > x;
    const totalW = w + (needsSep ? sepW : 0);
    if (cx + totalW > x + maxWidth && cx > x) { cx = x; cy += lineGap; }
    if (cx > x) { doc.setTextColor(...PDF_TEXT.faint); doc.text(sep, cx, cy); cx += sepW; doc.setTextColor(...color); }
    doc.text(item, cx, cy); cx += w;
  });
  return cy + lineGap;
}

/**
 * Adaptive photo grid: computes how many columns actually fit `maxWidth` at a
 * target cell size (rather than a hard-coded 4-per-row that leaves the last row's
 * unused columns as dead white space), numbers repeated captions ("BEFORE 1",
 * "BEFORE 2"...) instead of an undifferentiated repeated "BEFORE", and — the
 * dynamic-content gap the old version had — automatically continues onto new pages
 * instead of silently dropping photos past a hard-coded cap of 8.
 *
 * `photos` is an array of [captionBase, dataUrl] pairs. `newPage()` must addPage +
 * redraw that page's header/watermark and return the y content should resume at —
 * the caller already owns that logic (it varies per document), this only owns the
 * grid math and pagination trigger.
 */
export function drawPhotoGrid(doc, photos, { x, y, maxWidth, bottomLimit, cellW = 120, cellH = 90, gap = 12, captionGap = 10, newPage } = {}) {
  const cols = Math.max(1, Math.floor((maxWidth + gap) / (cellW + gap)));
  let px = x; let py = y; let col = 0;
  const seen = {};
  photos.forEach(([captionBase, img]) => {
    if (py + cellH + captionGap > bottomLimit) {
      const resume = newPage();
      px = x; py = resume; col = 0;
    }
    seen[captionBase] = (seen[captionBase] || 0) + 1;
    const caption = seen[captionBase] > 1 || photos.filter(([c]) => c === captionBase).length > 1
      ? `${captionBase} ${seen[captionBase]}` : captionBase;
    try {
      doc.addImage(img, 'JPEG', px, py, cellW, cellH);
      doc.setFontSize(6.5); doc.setTextColor(90); doc.text(caption, px, py + cellH + captionGap);
    } catch { /* a corrupt/unreadable photo never breaks the rest of the PDF */ }
    col += 1;
    if (col >= cols) { col = 0; px = x; py += cellH + captionGap + gap; }
    else { px += cellW + gap; }
  });
}

// ============================================================================
// REPORT PDF EXPORT FRAMEWORK — Customer/Vehicle/Service/Inventory/Sales/GST/
// Audit/... Reports previously had NO PDF option at all, anywhere in the app —
// only Excel (.xlsx), via the ONE shared `writeSheet` helper every report table
// already funnels through. This is that same idea applied to PDF: ONE shared
// exporter (`exportReportPDF`), reused by every report table's PDF button,
// instead of a hand-built PDF per report type. A report only needs to hand it
// the exact same {head, rows} pair it already passes to the Excel writer — the
// framework owns branding, pagination, column sizing, and print quality.
//
// Landscape (matches the one pre-existing precedent for tabular PDFs in this
// app, Supplier Performance — a data table with several columns reads far
// better wide than tall). Column widths are NOT hand-specified per report
// (there are a dozen+ report types with completely different shapes): each
// column is measured against its header + a sample of its own row values, then
// every column is scaled together so the table always fills the full page
// width — narrow for a 3-column report, compressed-but-still-legible for a
// wide one. Any cell too long for its column's final width is truncated with
// an ellipsis rather than overflowing into the next column.

/** Diagonal, low-opacity brand watermark — generalized from Job Card's original
 *  (portrait-only, hard-coded position) so it also works on a landscape report page. */
export function drawWatermark(doc, { W = PDF_PAGE.W, H = PDF_PAGE.H, text = SHOP.name, opacity = 0.06, fontSize = 52, angle = 30 } = {}) {
  doc.saveGraphicsState();
  doc.setGState(new doc.GState({ opacity }));
  doc.setFontSize(fontSize); doc.setTextColor(120, 100, 40);
  doc.text(text, W / 2, H / 2, { align: 'center', angle });
  doc.restoreGraphicsState();
}

// Same "does this column look numeric?" heuristic as the on-screen ReportTable
// (InventoryDashboard.js) — kept in sync deliberately so a column that right-aligns
// on screen right-aligns in the PDF too, rather than the PDF inventing its own rule.
const NUM_HEAD_RE = /^(total|gst|cgst|sgst|igst|taxable|profit|revenue|cost|sold price|sell price|rate|paid|balance|outstanding|qty|stock|stock value|hours|jobs|labour revenue|items|vehicles|invoices|odometer|rating)$/i;
export function reportNumericCols(head, rows) {
  const sample = rows.slice(0, 20);
  return head.map((h, i) => {
    if (NUM_HEAD_RE.test(String(h).trim())) return true;
    if (!sample.length) return false;
    let numeric = 0, seen = 0;
    for (const r of sample) { const v = String(r[i] ?? '').trim(); if (!v || v === '—') continue; seen += 1; if (/^[₹]?[\d,]+(\.\d+)?$/.test(v)) numeric += 1; }
    return seen > 0 && numeric / seen >= 0.8;
  });
}

/** Binary-search truncation to a max pixel width, appending an ellipsis — avoids an
 *  O(chars) measure-one-char-at-a-time loop on large reports. Routes every value
 *  through `cellText` first, so a raw Date object (see below) is never stringified
 *  as-is. */
function fitText(doc, text, maxW) {
  const t = String(cellText(text));
  if (!t || doc.getTextWidth(t) <= maxW) return t;
  let lo = 0, hi = t.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const cand = `${t.slice(0, mid)}…`;
    if (doc.getTextWidth(cand) <= maxW) lo = mid; else hi = mid - 1;
  }
  return lo > 0 ? `${t.slice(0, lo)}…` : '…';
}

// Several reports build their {head, rows} once and feed BOTH the Excel writer and
// this PDF exporter with the exact same array — reuse, not duplication, is the whole
// point of a shared framework. But `lib/exportSheet.js`'s `asDate()` deliberately
// returns a real JS Date object (Excel needs that for `cellDates`), and a Date's
// default `String(date)` is a full "Wed Aug 01 2026 00:00:00 GMT+0530 (India
// Standard Time)" — unreadable in a table cell. Formatting it here, once, means every
// report can safely pass whatever it already built for Excel without a parallel
// "PDF-flavored" copy of the same rows.
// GENUINE BUG, found by actually rendering and reading a real Customer Report PDF
// (not caught by any code-pattern check): money cells came through as "'0", "'8,984"
// — the leading ₹ silently corrupted into a stray apostrophe-like glyph. Root cause:
// jsPDF's built-in Helvetica (WinAnsi encoding) has NO Rupee glyph (U+20B9) — the
// EXACT same limitation already documented and worked around in Billing's own PDF
// (see BillingModule.jsx's `money()` helper, "Rs." instead of "₹"). Report rows reuse
// their on-screen `formatINR`/`inr()` strings — correct for HTML and for Excel (real
// Unicode fonts), wrong for jsPDF specifically. Fixed once here, in the shared cell
// formatter, so every report's currency columns are correct in PDF automatically,
// regardless of whether that report's own code knows anything about this limitation.
function cellText(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  if (typeof v === 'string' && v.includes('₹')) return v.replace(/₹\s*/g, 'Rs. ');
  return v ?? '';
}

/**
 * The ONE shared report exporter. `head`/`rows` are the exact same arrays every
 * report already builds for its Excel export (`writeSheet`) — no report-specific
 * PDF code needed. `filters` is an optional short human-readable string (date
 * range, active search, section name) shown under the title, so the PDF records
 * exactly what was exported, not just that "a report" was exported.
 */
export async function exportReportPDF({ title, head, rows, filters, filename, shop, demoMode = false }) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: PDF_PAGE.unit, format: PDF_PAGE.format, orientation: 'landscape' });
  // Landscape swaps the page's own W/H relative to PDF_PAGE's portrait-tuned values —
  // drawPdfHeader/drawPdfPageNumber/drawWatermark all take W/H as parameters
  // specifically so they adapt instead of hard-coding a portrait page.
  const W = PDF_PAGE.H, H = PDF_PAGE.W, M = PDF_PAGE.M;
  // Settings QA fix: no caller ever passed an explicit `shop`, so this always fell
  // through to the bare hardcoded SHOP — every report PDF export (Customer Report,
  // Vehicle Report, etc.) ignored Settings -> Business Profile entirely. Default to
  // the live, Settings-driven shop instead; an explicit `shop` argument still wins
  // for any future caller that wants to pass its own.
  const brand = demoMode ? maskShop(shop || SHOP) : (shop || liveShop(demoMode));
  let page = 1;

  const pageHeader = (sub) => drawPdfHeader(doc, { W, M, shop: brand, sub });
  const pageFooter = () => { drawWatermark(doc, { W, H }); drawPdfPageNumber(doc, page, { W, M, H }); };

  let y = pageHeader();
  doc.setFontSize(13); doc.setFont(undefined, 'bold'); doc.setTextColor(...PDF_TEXT.ink);
  doc.text(title, M, y); doc.setFont(undefined, 'normal');
  const generated = `Generated: ${new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
  doc.setFontSize(9); doc.setTextColor(...PDF_TEXT.muted);
  doc.text(generated, W - M, y, { align: 'right' });
  y += 14;
  doc.setFontSize(9); doc.setTextColor(...PDF_TEXT.muted);
  doc.text(`${rows.length.toLocaleString('en-IN')} row${rows.length === 1 ? '' : 's'}${filters ? `   ·   ${filters}` : ''}`, M, y);
  y += 18;

  const numericCols = reportNumericCols(head, rows);
  const availW = W - 2 * M;
  const PAD = 10, MIN_COL = 42, MAX_COL = 180, ROW_H = 16, HEAD_H = 20;

  // Column widths: measure header + a sample of the column's own values, clamp to a
  // sane range, then scale every column together so the table always fills the page
  // width exactly — never a lopsided table hugging the left edge, never one hanging
  // off the right edge.
  doc.setFontSize(8);
  const sample = rows.slice(0, 60);
  const natural = head.map((h, i) => {
    let w = doc.getTextWidth(String(h)) + PAD;
    sample.forEach((r) => { w = Math.max(w, doc.getTextWidth(fitText(doc, r[i], MAX_COL)) + PAD); });
    return Math.min(MAX_COL, Math.max(MIN_COL, w));
  });
  const naturalSum = natural.reduce((s, w) => s + w, 0);
  const scale = naturalSum > 0 ? availW / naturalSum : 1;
  const colW = natural.map((w) => w * scale);
  const colX = []; { let x = M; colW.forEach((w) => { colX.push(x); x += w; }); }

  const drawTableHeader = () => {
    doc.setFillColor(240, 236, 226); doc.rect(M, y - 14, availW, HEAD_H, 'F');
    doc.setFont(undefined, 'bold'); doc.setFontSize(8); doc.setTextColor(...PDF_TEXT.body);
    head.forEach((h, i) => {
      const align = numericCols[i] ? 'right' : 'left';
      const tx = align === 'right' ? colX[i] + colW[i] - 6 : colX[i] + 6;
      doc.text(fitText(doc, h, colW[i] - 8), tx, y, { align });
    });
    doc.setFont(undefined, 'normal');
    y += HEAD_H - 2;
  };
  const newPage = () => {
    pageFooter();
    doc.addPage(); page += 1;
    y = pageHeader(`${title} (continued)`);
    y += 10;
    drawTableHeader();
  };

  drawWatermark(doc, { W, H });
  drawTableHeader();
  doc.setFontSize(8); doc.setTextColor(...PDF_TEXT.body);
  if (!rows.length) {
    doc.setTextColor(...PDF_TEXT.muted);
    doc.text('No data for this report.', M + 6, y + 4);
    y += ROW_H;
  }
  rows.forEach((r, ri) => {
    if (y + ROW_H > H - M - 20) newPage();
    if (ri % 2 === 1) { doc.setFillColor(250, 249, 246); doc.rect(M, y - 11, availW, ROW_H, 'F'); }
    doc.setTextColor(...PDF_TEXT.body);
    r.forEach((c, i) => {
      const align = numericCols[i] ? 'right' : 'left';
      const tx = align === 'right' ? colX[i] + colW[i] - 6 : colX[i] + 6;
      doc.text(fitText(doc, c, colW[i] - 8), tx, y, { align });
    });
    y += ROW_H;
  });
  pageFooter();
  doc.save(filename);
}
