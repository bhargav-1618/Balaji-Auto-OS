// lib/workshopInvoicePdf.js
//
// WORKSHOP COPY PDF — dedicated renderer (Issue: "Professional Document Layout,
// Rendering & Verification Review").
//
// Pulled out of BillingModule.jsx's downloadPDF on purpose, not just to shrink that
// file: a 2700-line React component is the wrong place to stress-test a document
// generator against synthetic edge-case data (very long names, 60-part invoices,
// multi-page notes). This module has zero React/DOM/Firebase dependency — it only
// needs a jsPDF `doc` instance and plain data — so it can be exercised directly from
// a Node script (see scripts/render-workshop-pdf-stress.js) and the output PNGs
// inspected page by page, instead of trusting "it generated without throwing" as
// proof of a correct layout.
//
// The CUSTOMER copy is NOT touched by this module — it stays exactly as it was,
// inline in BillingModule.jsx. Every section below exists ONLY for the internal,
// staff-facing document.
//
// DOCUMENT LANGUAGE — "every major section in a clear bordered container" (Issue 1)
// instead of the previous flat, undifferentiated text blocks. Two container tiers:
//   - Neutral card: light gray title strip, gray border. Used for every section
//     except Profitability.
//   - Accent card: pale gold title strip + fill, gold border. Used ONLY for
//     Profitability Summary — the one panel this document exists to surface, so it
//     is the one place emphasis is earned, not sprinkled everywhere.
// Square corners throughout (not rounded) — a printed workshop form, not an app
// panel; this also keeps every border/fill computation a plain rect, no
// corner-radius edge cases to get wrong under stress data.

import { PDF_PAGE, PDF_GOLD, PDF_RULE, PDF_TEXT, drawPdfHeader } from './pdfTheme';
import { QR_PT } from './pdfQr';
import { num } from './format';

const { W, M } = PDF_PAGE;
// Footer/signature band starts its top rule at fy-34=758 (fy=792, see
// BillingModule.jsx's shared footer). That footer is drawn exactly ONCE, on
// whatever page is jsPDF's "current" page after the whole content loop — i.e.
// it only ever physically appears on the document's actual LAST page. Every
// earlier page reserves this margin for a footer that will never be drawn on
// it, which was the single biggest cause of Issue 1's "one more page for just
// Internal Notes": a card missing a page by 10-15pt got pushed to a whole new
// page instead of using real, safe space still below it. 745 leaves 13pt of
// clearance to the footer rule — the same order as CARD.gapAfter (10) between
// any two ordinary cards, so a last-page card sits at the document's normal
// rhythm, not jammed against the signature block — while reclaiming the rest
// of the margin every non-last page was paying for nothing. 748 = 758 - 10:
// the footer rule's own y minus exactly one CARD.gapAfter, so a last-page
// card's bottom border sits the same distance from the footer rule as it
// would from the next card's title band on any other page.
const PAGE_BOTTOM = 748;
// Where content starts on every page after the first (below the slim
// continuation letterhead — see makeCursor.newPage below). Named so the
// "would this fit on a fresh page" lookahead used by Internal Notes can
// reference the same value the cursor itself uses, instead of a second,
// silently-driftable copy of the same number.
const CONTINUATION_TOP = 78;

const CARD = {
  borderNeutral: [170, 170, 170],
  borderAccent: PDF_GOLD.onLight,
  titleBgNeutral: [244, 242, 237],
  titleBgAccent: [247, 240, 220],
  bodyFillAccent: [252, 250, 242],
  titleTextNeutral: PDF_TEXT.body,
  titleTextAccent: PDF_GOLD.onLight,
  titleH: 20,
  padX: 10,
  // Named (Issue 8: was 5 different hand-copied magic numbers — 14, 14, 15, 10,
  // 8 — scattered across every card's own height formula; drifting any one of
  // them without updating the others is exactly how the earlier column-overlap
  // bugs happened). Every fixed-height card's own formula below now derives
  // from these two, so tightening spacing is a one-line change, not a hunt.
  contentTopPad: 11,     // title band bottom -> first content line
  contentBottomPad: 6,   // last content line -> card's bottom border
  gapAfter: 10,          // card's bottom border -> next section's top (was 14)
};

// Type scale (Issue 7) — one source of truth for every card this module draws, so
// "card title" or "field label" always means the same size/weight everywhere,
// instead of each section re-guessing its own numbers.
const TYPE = {
  docTitle: 14,
  cardTitle: 9,
  colHeader: 7.5,
  fieldLabel: 7,
  fieldValue: 8.5,
  body: 8.5,
  subtext: 7,
  metaValue: 10,
};

// COLOR SYSTEM REVIEW: Estimate/Refunded/Returned didn't match the app's own canonical
// STATUS_COLOR map (constants/ui.js) — Estimate is violet on-screen but was blue here,
// Refunded is orange on-screen but was purple here, Returned is pink on-screen but was
// blue here. A customer-facing PDF disagreeing with the app's own badge for the same
// status is exactly the "same business status, different color depending on where you
// look" failure. Re-derived as this file's existing light-bg/dark-text pairs already
// were (each one is that color family's Tailwind -100/-700 shade), just now from the
// correct family. Paid/Partially Paid/Unpaid/Draft/Cancelled already matched and are
// unchanged.
const STATUS_COLORS = {
  Paid: { bg: [214, 245, 226], text: [15, 118, 68] },
  'Partially Paid': { bg: [255, 240, 199], text: [146, 100, 7] },
  Unpaid: { bg: [252, 224, 224], text: [153, 27, 27] },
  Draft: { bg: [232, 232, 232], text: [80, 80, 80] },
  Estimate: { bg: [237, 233, 254], text: [109, 40, 217] },
  Cancelled: { bg: [235, 235, 235], text: [120, 120, 120] },
  Refunded: { bg: [255, 237, 213], text: [194, 65, 12] },
  Returned: { bg: [252, 231, 243], text: [190, 24, 93] },
};

// Truncate-with-ellipsis — a flat `.slice()` with no ellipsis reads as a broken/
// cut-off word, not a deliberately shortened one.
// Width-aware truncation: measures against the CURRENT font/size/weight already
// set on `doc` (every call site sets that immediately before calling this), so a
// value gets to use the column's actual available space rather than a guessed
// character count. The earlier character-count version cut "ICICI Lombard
// (POL-99123) — valid till 2027-03-15" down to "...— valid till …" — discarding
// the one piece of information (the actual date) a workshop would look at this
// field for — despite the column having real room left at 8.5pt bold.
const truncW = (doc, v, maxWidth) => {
  const s = String(v);
  if (doc.getTextWidth(s) <= maxWidth) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.getTextWidth(`${s.slice(0, mid)}…`) <= maxWidth) lo = mid; else hi = mid - 1;
  }
  return `${s.slice(0, lo)}…`;
};
const hasVal = ([, v]) => v !== null && v !== undefined && String(v).trim() !== '';

/**
 * Mutable drawing cursor shared by every card helper below. `page`/`y` play the
 * same role as the `page`/`y` locals BillingModule.jsx's own downloadPDF already
 * used before this extraction — kept as an object here only so helper functions can
 * mutate them without every one of them returning `{y, page}` tuples.
 */
function makeCursor(doc, { shop, docTypeLabel, iv, cust, veh }) {
  // Issue 4: a continuation page needs to identify itself even if separated
  // from the rest of the printout — the invoice number alone (the old
  // default) isn't enough to reunite a stray page with the right customer
  // or vehicle. Built once up front and width-truncated to what the
  // letterhead's single-line sub-band can actually hold (drawPdfHeader
  // draws it centered at 10pt bold with no wrapping of its own).
  const custName = cust?.name || iv.customer;
  const regNo = veh?.regNo || iv.regNo;
  const idBits = [`${docTypeLabel} — ${iv.invNo}`, custName, regNo].filter(Boolean).join('  ·  ');
  doc.setFontSize(10); doc.setFont(undefined, 'bold');
  const suffix = ' (continued)';
  const defaultSub = `${truncW(doc, idBits, W - 2 * M - 20 - doc.getTextWidth(suffix))}${suffix}`;
  const ctx = {
    y: 0,
    page: 1,
    newPage(subLabel) {
      doc.addPage();
      ctx.page += 1;
      drawPdfHeader(doc, { W, M, shop, sub: subLabel || defaultSub });
      ctx.y = CONTINUATION_TOP;
    },
  };
  return ctx;
}

function drawStatusBadge(doc, x, y, status) {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.Draft;
  doc.setFontSize(TYPE.fieldLabel); doc.setTextColor(130, 130, 130); doc.setFont('helvetica', 'normal');
  doc.text('STATUS', x, y);
  const label = String(status || '—').toUpperCase();
  doc.setFontSize(8.5); doc.setFont('helvetica', 'bold');
  const w = doc.getTextWidth(label) + 14;
  doc.setFillColor(...colors.bg);
  doc.rect(x, y + 4, w, 15, 'F');
  doc.setTextColor(...colors.text);
  doc.text(label, x + 7, y + 14);
  doc.setFont('helvetica', 'normal'); doc.setTextColor(...PDF_TEXT.body);
}

/**
 * Fixed-height card — used for every section whose content height is fully known
 * before drawing starts (header, Bill To/Vehicle, Job Card, Financial Summary,
 * Profitability). Reserves the whole height up front and page-breaks BEFORE
 * opening if it wouldn't fit, so a card (and its title) is never split — "no
 * orphan section titles" (Issue 5) is structurally impossible for these sections,
 * not just avoided by convention.
 */
function openCard(doc, ctx, { title, height, accent }) {
  if (ctx.y + height > PAGE_BOTTOM) ctx.newPage();
  const top = ctx.y;
  const bottom = top + height;
  if (accent) { doc.setFillColor(...CARD.bodyFillAccent); doc.rect(M, top, W - 2 * M, height, 'F'); }
  doc.setFillColor(...(accent ? CARD.titleBgAccent : CARD.titleBgNeutral));
  doc.rect(M, top, W - 2 * M, CARD.titleH, 'F');
  doc.setDrawColor(...(accent ? CARD.borderAccent : CARD.borderNeutral));
  doc.setLineWidth(0.75);
  doc.rect(M, top, W - 2 * M, height, 'S');
  if (title) {
    doc.setFontSize(TYPE.cardTitle); doc.setFont('helvetica', 'bold');
    doc.setTextColor(...(accent ? CARD.titleTextAccent : CARD.titleTextNeutral));
    doc.text(title, M + CARD.padX, top + 14);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...PDF_TEXT.body);
  }
  ctx.y = top + CARD.titleH + CARD.contentTopPad;
  return { top, bottom };
}
function closeCard(ctx, bottom) { ctx.y = bottom + CARD.gapAfter; }

/**
 * Page-spanning TABLE card (Parts / Labour / Other Charges). Content height is
 * NOT known up front — "many parts" (Issue 6 stress case) can legitimately span
 * several pages — so the border is drawn RETROACTIVELY: paint the title + column
 * header immediately, accumulate rows, and only stroke the enclosing rect once the
 * actual consumed height for that page-segment is known (either because the table
 * finished, or a row wouldn't fit and the segment must close early). On overflow,
 * the card re-opens on the new page with the title marked "(continued)" and the
 * SAME column header repeated — a broken table resuming with no header at all was
 * the exact defect the previous pass already fixed once; this generalises that fix
 * to a bordered container instead of a bare filled band.
 */
function openTableCard(doc, ctx, { title, accent, columns, minFirstRowH = 24 }) {
  if (ctx.y + CARD.titleH + 24 + minFirstRowH > PAGE_BOTTOM) ctx.newPage();
  let segTop = ctx.y;
  const paintHeader = (continued) => {
    doc.setFillColor(...(accent ? CARD.titleBgAccent : CARD.titleBgNeutral));
    doc.rect(M, segTop, W - 2 * M, CARD.titleH, 'F');
    doc.setFontSize(TYPE.cardTitle); doc.setFont('helvetica', 'bold');
    doc.setTextColor(...(accent ? CARD.titleTextAccent : CARD.titleTextNeutral));
    doc.text(continued ? `${title} (continued)` : title, M + CARD.padX, segTop + 14);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...PDF_TEXT.body);
    ctx.y = segTop + CARD.titleH + 15;
    doc.setFontSize(TYPE.colHeader); doc.setTextColor(100, 100, 100); doc.setFont('helvetica', 'bold');
    columns.forEach((c) => doc.text(c.label, c.x, ctx.y, { align: c.align || 'left' }));
    doc.setDrawColor(...CARD.borderNeutral); doc.setLineWidth(0.4);
    doc.line(M + CARD.padX, ctx.y + 5, W - M - CARD.padX, ctx.y + 5);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...PDF_TEXT.body);
    ctx.y += 15;
  };
  paintHeader(false);
  // Reserved the same way as openFlowCard's FLOW_CLOSE_PAD: finish() always
  // extends the border 8pt past whatever ctx.y is when the table ends, and
  // that extension isn't itself checked against PAGE_BOTTOM anywhere — so it
  // has to be reserved up front on every row, not just assumed to fit.
  const TABLE_CLOSE_PAD = 8;
  return {
    ensureRow(rowH) {
      if (ctx.y + rowH + TABLE_CLOSE_PAD > PAGE_BOTTOM) {
        doc.setDrawColor(...(accent ? CARD.borderAccent : CARD.borderNeutral)); doc.setLineWidth(0.75);
        doc.rect(M, segTop, W - 2 * M, (ctx.y + 6) - segTop, 'S');
        ctx.newPage();
        segTop = ctx.y;
        paintHeader(true);
      }
    },
    finish() {
      doc.setDrawColor(...(accent ? CARD.borderAccent : CARD.borderNeutral)); doc.setLineWidth(0.75);
      doc.rect(M, segTop, W - 2 * M, (ctx.y + 8) - segTop, 'S');
      ctx.y += CARD.gapAfter;
    },
  };
}

/**
 * Page-spanning FLOW card (Internal Notes) — same retroactive-border technique as
 * the table card, but for wrapped paragraph text rather than columns. A single very
 * long note (Issue 6: "large internal notes") can outgrow a page on its own; this
 * lets the card close, continue on the next page with its title marked
 * "(continued)", and reopen without ever splitting a line of text across the break.
 */
function openFlowCard(doc, ctx, { title, minFirstLineH = 20 }) {
  // Neither of these is gated by ensureLine's own check below, yet both land
  // between the last checked line and the card's actual bottom border: every
  // caller (Internal Notes) adds a fixed 8pt gap after each item — including
  // the last — before moving to the next one, and finish() then extends the
  // border a further 10pt past whatever ctx.y is at that point. Reserving
  // both here (not just the border's own 10) is what makes ensureLine's
  // guarantee real: this card's eventual bottom border never lands past
  // PAGE_BOTTOM, whichever line turns out to be the last one drawn.
  const FLOW_CLOSE_PAD = 18;
  if (ctx.y + CARD.titleH + CARD.contentTopPad + minFirstLineH > PAGE_BOTTOM) ctx.newPage();
  let segTop = ctx.y;
  const paintTitle = (continued) => {
    doc.setFillColor(...CARD.titleBgNeutral);
    doc.rect(M, segTop, W - 2 * M, CARD.titleH, 'F');
    doc.setFontSize(TYPE.cardTitle); doc.setFont('helvetica', 'bold'); doc.setTextColor(...CARD.titleTextNeutral);
    doc.text(continued ? `${title} (continued)` : title, M + CARD.padX, segTop + 14);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...PDF_TEXT.body);
    ctx.y = segTop + CARD.titleH + CARD.contentTopPad;
  };
  paintTitle(false);
  return {
    ensureLine(lineH = 11) {
      if (ctx.y + lineH + FLOW_CLOSE_PAD > PAGE_BOTTOM) {
        // Snapshot BEFORE anything below touches the graphics state: newPage()
        // itself draws the slim continuation letterhead (10pt bold) and paintTitle
        // draws this card's own title (TYPE.cardTitle, bold) — neither resets font
        // SIZE back afterward (only weight/color), so a page break mid-paragraph
        // left the caller's body text silently rendering at 9-10pt instead of its
        // own 8.5pt, wider than what splitTextToSize had wrapped it to fit, so
        // wrapped lines ran past the card's right border after every break (found
        // rendering the "large internal notes" stress fixture). Capturing the size
        // here — before newPage/paintTitle run — and restoring it after makes a
        // break invisible to whatever font state the caller had active.
        const savedSize = doc.getFontSize();
        doc.setDrawColor(...CARD.borderNeutral); doc.setLineWidth(0.75);
        doc.rect(M, segTop, W - 2 * M, (ctx.y + 8) - segTop, 'S');
        ctx.newPage();
        segTop = ctx.y;
        paintTitle(true);
        doc.setFontSize(savedSize);
      }
    },
    finish() {
      doc.setDrawColor(...CARD.borderNeutral); doc.setLineWidth(0.75);
      doc.rect(M, segTop, W - 2 * M, (ctx.y + 10) - segTop, 'S');
      ctx.y += CARD.gapAfter;
    },
  };
}

// ---- Header card (Issue 2) ------------------------------------------------
// Title + doc-type + Invoice No / Status / Date / Generated, with the QR seated
// inside the SAME container instead of floating loose beside a wall of text.
// QR_PT (113pt) is a deliberately large, previously-fixed size — smaller modules
// made the code unscannable on a phone (see BillingModule.jsx's own QR comment) —
// so this card is sized to comfortably enclose it, not the other way around.
function renderHeaderCard(doc, ctx, { iv, status, docTypeLabel, qrDataUrl, generatedAt }) {
  const height = 152;
  if (ctx.y + height > PAGE_BOTTOM) ctx.newPage();
  const top = ctx.y;
  const left = M, right = W - M;
  const qrSize = QR_PT;
  const qrX = right - 12 - qrSize;
  const qrY = top + 12;
  const textRight = qrX - 16;

  doc.setDrawColor(...CARD.borderNeutral); doc.setLineWidth(0.75);
  doc.rect(left, top, right - left, height, 'S');

  doc.setFontSize(TYPE.docTitle); doc.setFont('helvetica', 'bold'); doc.setTextColor(...PDF_TEXT.danger);
  doc.text('WORKSHOP COPY — INTERNAL USE ONLY', left + 12, top + 24);
  doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(100, 100, 100);
  doc.text(docTypeLabel, left + 12, top + 38);
  doc.setFont('helvetica', 'normal');

  doc.setDrawColor(...PDF_RULE.light); doc.setLineWidth(0.5);
  doc.line(left + 12, top + 48, textRight, top + 48);

  const metaX1 = left + 12, metaX2 = left + 12 + (textRight - left - 12) / 2 + 6;
  const metaY1 = top + 68, metaY2 = top + 112;
  const metaColW = (textRight - left - 12) / 2 - 12;
  const metaField = (x, y, label, value) => {
    doc.setFontSize(TYPE.fieldLabel); doc.setTextColor(130, 130, 130); doc.setFont('helvetica', 'normal');
    doc.text(label, x, y);
    doc.setFontSize(TYPE.metaValue); doc.setTextColor(20, 20, 20); doc.setFont('helvetica', 'bold');
    doc.text(truncW(doc, value, metaColW), x, y + 14);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...PDF_TEXT.body);
  };
  metaField(metaX1, metaY1, 'INVOICE NO', iv.invNo || '—');
  drawStatusBadge(doc, metaX2, metaY1 - 9, status);
  metaField(metaX1, metaY2, 'DATE', iv.date || '—');
  metaField(metaX2, metaY2, 'GENERATED', generatedAt);

  if (qrDataUrl) {
    try {
      doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
      doc.setFontSize(6.5); doc.setTextColor(150, 150, 150);
      doc.text('Scan to open in app', qrX + qrSize / 2, qrY + qrSize + 10, { align: 'center' });
      doc.setTextColor(...PDF_TEXT.body);
    } catch { /* QR is optional; never break the PDF */ }
  }

  ctx.y = top + height + CARD.gapAfter;
}

// ---- Bill To / Vehicle — two cards side by side (Issue 3) ------------------
function renderBillToVehicleCards(doc, ctx, { cust, veh, iv }) {
  const gap = 16;
  const colW = (W - 2 * M - gap) / 2;
  const leftX = M, rightX = M + colW + gap;
  const innerW = colW - 2 * CARD.padX;
  const addr = [cust?.address, cust?.area, cust?.city, cust?.district].filter(Boolean).join(', ') || iv.address;

  const leftFields = [
    ['Customer Name', cust?.name || iv.customer],
    ['Customer ID', cust?.code],
    ['Phone', cust?.phone || iv.phone],
    ['Alternate Phone', cust?.altPhone],
    ['Email', cust?.email || iv.email],
    ['Customer Type', cust?.type],
    ['Customer Since', cust?.since],
    ['GST Number', cust?.gst || iv.gstNo],
    ['Address', addr, { wrap: true }],
  ].filter(hasVal);
  const rightFields = [
    ['Registration No', veh?.regNo || iv.regNo],
    ['Make', veh?.make],
    ['Model', veh?.model || iv.vehicle],
    ['Variant', veh?.variant],
    ['Fuel Type', veh?.fuel],
    ['VIN / Chassis', veh?.vin || veh?.chassisNo || iv.vin],
    ['Engine Number', veh?.engineNo || iv.engineNo],
    ['Odometer', (veh?.odometer || iv.odometer) ? `${veh?.odometer || iv.odometer} km` : null],
    ['Insurance', veh?.insurer ? `${veh.insurer}${veh.policyNo ? ` (${veh.policyNo})` : ''}${veh.policyEnd ? ` — valid till ${veh.policyEnd}` : ''}` : null, { wrap: true }],
    ['Warranty', veh?.extWarranty ? `Extended warranty${veh.warrantyExpiry ? ` — valid till ${veh.warrantyExpiry}` : ''}` : null, { wrap: true }],
  ].filter(hasVal);

  const colHeight = (fields) => {
    let h = 0;
    fields.forEach(([, v, opts]) => {
      if (opts && opts.wrap) {
        const lines = doc.splitTextToSize(String(v), innerW).slice(0, 3);
        h += 12 + lines.length * 10 + 4;
      } else h += 22;
    });
    return h;
  };
  const bodyH = Math.max(colHeight(leftFields), colHeight(rightFields), 22);
  const cardH = CARD.titleH + CARD.contentTopPad + bodyH + CARD.contentBottomPad;

  if (ctx.y + cardH > PAGE_BOTTOM) ctx.newPage();
  const top = ctx.y;

  const drawColumn = (title, x, fields) => {
    doc.setFillColor(...CARD.titleBgNeutral); doc.rect(x, top, colW, CARD.titleH, 'F');
    doc.setDrawColor(...CARD.borderNeutral); doc.setLineWidth(0.75); doc.rect(x, top, colW, cardH, 'S');
    doc.setFontSize(TYPE.cardTitle); doc.setFont('helvetica', 'bold'); doc.setTextColor(...CARD.titleTextNeutral);
    doc.text(title, x + CARD.padX, top + 14);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...PDF_TEXT.body);
    let fy = top + CARD.titleH + CARD.contentTopPad;
    fields.forEach(([k, v, opts]) => {
      doc.setFontSize(TYPE.fieldLabel); doc.setTextColor(130, 130, 130); doc.setFont('helvetica', 'normal');
      doc.text(String(k).toUpperCase(), x + CARD.padX, fy);
      doc.setFontSize(TYPE.fieldValue); doc.setTextColor(30, 30, 30); doc.setFont('helvetica', 'bold');
      if (opts && opts.wrap) {
        const lines = doc.splitTextToSize(String(v), innerW).slice(0, 3);
        lines.forEach((ln, i) => doc.text(ln, x + CARD.padX, fy + 10 + i * 10));
        fy += 12 + lines.length * 10 + 4;
      } else {
        doc.text(truncW(doc, v, innerW), x + CARD.padX, fy + 10);
        fy += 22;
      }
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...PDF_TEXT.body);
    });
  };
  drawColumn('BILL TO', leftX, leftFields);
  drawColumn('VEHICLE', rightX, rightFields);

  ctx.y = top + cardH + CARD.gapAfter;
  if (!cust) { doc.setFontSize(7.5); doc.setTextColor(150, 150, 150); doc.text('Customer profile not on file — details above are from the invoice record.', M, ctx.y); ctx.y += 12; }
  if (!veh && (iv.vehicle || iv.regNo)) { doc.setFontSize(7.5); doc.setTextColor(150, 150, 150); doc.text('Vehicle profile not on file — details above are from the invoice record.', M, ctx.y); ctx.y += 12; }
  doc.setTextColor(...PDF_TEXT.body);
}

// ---- Job Card card ----------------------------------------------------------
// Short identity fields (No/Advisor/Technician/Helper/Delivered) stay a compact
// 2-per-row grid; Complaint/Diagnosis get their own full-width wrapped paragraphs
// — those two fields are free text a service advisor writes and can run long
// (Issue 6), so they're never truncated the way the short identity fields are.
function renderJobCardCard(doc, ctx, { iv, jc }) {
  const innerW = W - 2 * M - 2 * CARD.padX;
  if (!iv.jobNo || !jc) {
    const msg = !iv.jobNo ? 'No job card linked to this invoice.' : `Job Card ${iv.jobNo} details not on file — reference shown from the invoice only.`;
    const height = CARD.titleH + CARD.contentTopPad + 17 + CARD.contentBottomPad;
    const { bottom } = openCard(doc, ctx, { title: 'JOB CARD', height });
    doc.setFontSize(TYPE.body); doc.setTextColor(110, 110, 110);
    doc.text(msg, M + CARD.padX, ctx.y);
    doc.setTextColor(...PDF_TEXT.body);
    closeCard(ctx, bottom);
    return;
  }
  const delivered = (jc.statusLog || []).find((s) => s.status === 'Delivered');
  const shortFields = [
    ['Job Card No', jc.jobNo],
    ['Service Advisor', jc.advisor || iv.advisor],
    ['Technician', jc.technician || iv.technician],
    ['Helper', jc.helper],
    ['Delivered On', delivered ? new Date(delivered.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null],
  ].filter(hasVal);
  const longFields = [
    ['Complaint', (jc.complaints || []).filter(Boolean).join('; ')],
    ['Diagnosis', (jc.diagnosis || []).filter(Boolean).join('; ')],
  ].filter(([, v]) => v && String(v).trim() !== '');

  const shortH = Math.ceil(shortFields.length / 2) * 22;
  const longH = longFields.reduce((s, [, v]) => s + 10 + doc.splitTextToSize(String(v), innerW).length * 11 + 8, 0);
  const bodyH = shortH + (longFields.length ? 4 : 0) + longH;
  const height = CARD.titleH + CARD.contentTopPad + Math.max(bodyH, 17) + CARD.contentBottomPad;

  const { bottom } = openCard(doc, ctx, { title: 'JOB CARD', height });
  if (shortFields.length) {
    const colW = (innerW - 16) / 2;
    const lx = M + CARD.padX, rx = lx + colW + 16;
    for (let i = 0; i < shortFields.length; i += 2) {
      const [lk, lv] = shortFields[i];
      doc.setFontSize(TYPE.fieldLabel); doc.setTextColor(130, 130, 130); doc.setFont('helvetica', 'normal');
      doc.text(String(lk).toUpperCase(), lx, ctx.y);
      doc.setFontSize(TYPE.fieldValue); doc.setTextColor(30, 30, 30); doc.setFont('helvetica', 'bold');
      doc.text(truncW(doc, lv, colW), lx, ctx.y + 10);
      if (shortFields[i + 1]) {
        const [rk, rv] = shortFields[i + 1];
        doc.setFontSize(TYPE.fieldLabel); doc.setTextColor(130, 130, 130); doc.setFont('helvetica', 'normal');
        doc.text(String(rk).toUpperCase(), rx, ctx.y);
        doc.setFontSize(TYPE.fieldValue); doc.setTextColor(30, 30, 30); doc.setFont('helvetica', 'bold');
        doc.text(truncW(doc, rv, colW), rx, ctx.y + 10);
      }
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...PDF_TEXT.body);
      ctx.y += 22;
    }
  }
  if (longFields.length) ctx.y += 4;
  longFields.forEach(([label, text]) => {
    doc.setFontSize(TYPE.fieldLabel); doc.setTextColor(130, 130, 130); doc.setFont('helvetica', 'bold');
    doc.text(label.toUpperCase(), M + CARD.padX, ctx.y); ctx.y += 10;
    doc.setFontSize(TYPE.body); doc.setTextColor(40, 40, 40); doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(String(text), innerW);
    lines.forEach((ln) => { doc.text(ln, M + CARD.padX, ctx.y); ctx.y += 11; });
    ctx.y += 8;
  });
  doc.setTextColor(...PDF_TEXT.body);
  closeCard(ctx, bottom);
}

// ---- Parts table card ---------------------------------------------------------
// Dedicated Cost / Amount / Profit(Margin) columns instead of subtext — a
// management document's core table should let cost/profit be scanned down a
// column. Part names wrap to up to 2 lines instead of a hard character cut, so a
// long name (Issue 6) never collides with the numeric columns.
function renderPartsCard(doc, ctx, { partLines, money }) {
  if (!partLines.length) return;
  const left = M + CARD.padX;
  const right = W - M - CARD.padX;
  // Column right-edges, each budgeted for its own worst-case content width
  // (measured via doc.getTextWidth against real stress-test values, not
  // guessed) so adjacent right-aligned columns can never collide:
  //   QTY    ~30pt (a handful of digits)
  //   RATE   ~70pt (single money value up to ~Rs 1,00,000 — measured 52-60pt)
  //   COST   ~80pt (purchasePrice*qty can run past RATE alone — measured up to 64pt)
  //   AMOUNT ~85pt (qty*rate, the same order as COST — measured up to 64pt)
  //   PROFIT ~95pt (bold, PLUS "(NN%)" — the widest column — measured up to 80pt)
  // Each budget carries a real margin (15-20pt) over its measured worst case; the
  // defensive font-shrink below (profitColW) is the second line of defence for
  // whatever a margin this generous still doesn't cover.
  const wQty = M + 175, wRate = M + 245, wCost = M + 325, wAmt = M + 410, wProfit = right;
  const nameW = wQty - left - 16;
  const table = openTableCard(doc, ctx, {
    title: 'PARTS USED',
    columns: [
      { label: 'PART', x: left, align: 'left' },
      { label: 'QTY', x: wQty, align: 'right' },
      { label: 'RATE', x: wRate, align: 'right' },
      { label: 'COST', x: wCost, align: 'right' },
      { label: 'AMOUNT', x: wAmt, align: 'right' },
      { label: 'PROFIT (MARGIN)', x: wProfit, align: 'right' },
    ],
  });
  const profitColW = wProfit - wAmt - 10;
  const lineAmt = (l) => num(l.qty) * num(l.rate) * (1 - (num(l.disc) || 0) / 100);
  partLines.forEach((l) => {
    const label = l.kind === 'Other' ? `${String(l.desc || '-')} (outside purchase)` : String(l.desc || '-');
    const nameLines = doc.splitTextToSize(label, nameW).slice(0, 2);
    const bits = [];
    if (l.sku) bits.push(`SKU ${l.sku}`);
    if (l.rack) bits.push(`Loc ${l.rack}`);
    const subtext = bits.join('  ·  ');
    const rowH = nameLines.length * 11 + (subtext ? 9 : 0) + 8;
    table.ensureRow(rowH);
    const cost = num(l.purchasePrice) * num(l.qty);
    const amt = lineAmt(l);
    const profit = amt - cost;
    const marginPct = amt > 0 ? (profit / amt) * 100 : 0;
    doc.setTextColor(...PDF_TEXT.body); doc.setFontSize(TYPE.fieldValue);
    nameLines.forEach((ln, i) => doc.text(ln, left, ctx.y + i * 11));
    doc.text(String(num(l.qty)), wQty, ctx.y, { align: 'right' });
    doc.text(money(l.rate), wRate, ctx.y, { align: 'right' });
    doc.setTextColor(110, 110, 110); doc.text(money(cost), wCost, ctx.y, { align: 'right' });
    doc.setTextColor(...PDF_TEXT.body); doc.text(money(amt), wAmt, ctx.y, { align: 'right' });
    // Defensive: an extreme rupee value could still outgrow even a generously
    // sized column. Rather than let it silently overlap AMOUNT, shrink the font
    // until it fits — a smaller-but-complete figure beats a clipped/overlapping one.
    doc.setFont('helvetica', 'bold');
    const profitText = `${money(profit)} (${marginPct.toFixed(0)}%)`;
    let profitSize = 8;
    doc.setFontSize(profitSize);
    while (profitSize > 6 && doc.getTextWidth(profitText) > profitColW) { profitSize -= 0.5; doc.setFontSize(profitSize); }
    doc.setTextColor(...(profit >= 0 ? [20, 110, 60] : PDF_TEXT.danger));
    doc.text(profitText, wProfit, ctx.y, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(TYPE.fieldValue); doc.setTextColor(...PDF_TEXT.body);
    let ny = ctx.y + nameLines.length * 11;
    if (subtext) { doc.setFontSize(TYPE.subtext); doc.setTextColor(150, 150, 150); doc.text(subtext, left, ny); doc.setFontSize(TYPE.fieldValue); doc.setTextColor(...PDF_TEXT.body); ny += 9; }
    ctx.y = ny + 2;
    doc.setDrawColor(...PDF_RULE.light); doc.line(left, ctx.y, right, ctx.y); ctx.y += 6;
  });
  table.finish();
}

// ---- Labour table card ---------------------------------------------------------
function renderLabourCard(doc, ctx, { svcLines, money, iv, jc }) {
  if (!svcLines.length) return;
  const left = M + CARD.padX;
  const amtX = W - M - CARD.padX;
  const table = openTableCard(doc, ctx, {
    title: 'LABOUR / SERVICES',
    columns: [
      { label: 'SERVICE', x: left, align: 'left' },
      { label: 'AMOUNT', x: amtX, align: 'right' },
    ],
  });
  const lineAmt = (l) => num(l.qty) * num(l.rate) * (1 - (num(l.disc) || 0) / 100);
  // The hourly-rate note ("3.5 hr x Rs. 850.00/hr") right-aligns at hourlyX with
  // its own ~95pt zone (measured worst case ~80pt + margin) — the name column
  // must wrap BEFORE that zone's own leftmost reach, not just before hourlyX
  // itself, or a long service name's first line runs directly into the note's
  // own text (found in stress testing: "...Requiring Specialist Attention"
  // overlapping "3.5 hr x Rs. 850.00/hr" when both sat near the same x).
  const hourlyX = amtX - 90;
  const hourlyZoneW = 95;
  const nameW = (hourlyX - hourlyZoneW) - left - 10;
  svcLines.forEach((l) => {
    const tech = iv.technician || jc?.technician;
    const nameLines = doc.splitTextToSize(String(l.desc || '-'), nameW).slice(0, 2);
    const hourly = l.hourly === true || (l.hourly === undefined && num(l.qty) !== 1);
    const rowH = nameLines.length * 11 + (tech ? 11 : 0) + 8;
    table.ensureRow(rowH);
    doc.setTextColor(...PDF_TEXT.body); doc.setFontSize(TYPE.fieldValue);
    nameLines.forEach((ln, i) => doc.text(ln, left, ctx.y + i * 11));
    if (hourly) {
      doc.setFontSize(7.5); doc.setTextColor(110, 110, 110);
      doc.text(`${num(l.qty)} hr x ${money(l.rate)}/hr`, hourlyX, ctx.y, { align: 'right' });
      doc.setFontSize(TYPE.fieldValue); doc.setTextColor(...PDF_TEXT.body);
    }
    doc.text(money(lineAmt(l)), amtX, ctx.y, { align: 'right' });
    let ny = ctx.y + nameLines.length * 11;
    if (tech) {
      doc.setFontSize(TYPE.subtext); doc.setTextColor(130, 130, 130);
      doc.text(`Technician: ${tech}`, left, ny);
      doc.setFontSize(TYPE.fieldValue); doc.setTextColor(...PDF_TEXT.body);
      ny += 9;
    }
    ctx.y = ny + 2;
    doc.setDrawColor(...PDF_RULE.light); doc.line(left, ctx.y, amtX, ctx.y); ctx.y += 6;
  });
  table.finish();
}

// ---- Other Charges table card ---------------------------------------------------
function renderOtherCard(doc, ctx, { otherLines, money }) {
  if (!otherLines.length) return;
  const left = M + CARD.padX;
  const oQty = M + 300, oRate = M + 420, oAmt = W - M - CARD.padX;
  const nameW = oQty - left - 16;
  const table = openTableCard(doc, ctx, {
    title: 'OTHER CHARGES',
    columns: [
      { label: 'DESCRIPTION', x: left, align: 'left' },
      { label: 'QTY', x: oQty, align: 'right' },
      { label: 'RATE', x: oRate, align: 'right' },
      { label: 'AMOUNT', x: oAmt, align: 'right' },
    ],
  });
  const lineAmt = (l) => num(l.qty) * num(l.rate) * (1 - (num(l.disc) || 0) / 100);
  otherLines.forEach((l) => {
    const nameLines = doc.splitTextToSize(String(l.desc || '-'), nameW).slice(0, 2);
    const rowH = nameLines.length * 11 + 8;
    table.ensureRow(rowH);
    doc.setTextColor(...PDF_TEXT.body); doc.setFontSize(TYPE.fieldValue);
    nameLines.forEach((ln, i) => doc.text(ln, left, ctx.y + i * 11));
    doc.text(String(num(l.qty)), oQty, ctx.y, { align: 'right' });
    doc.text(money(l.rate), oRate, ctx.y, { align: 'right' });
    doc.text(money(lineAmt(l)), oAmt, ctx.y, { align: 'right' });
    ctx.y += nameLines.length * 11 + 2;
    doc.setDrawColor(...PDF_RULE.light); doc.line(left, ctx.y, oAmt, ctx.y); ctx.y += 6;
  });
  table.finish();
}

// ---- Financial Summary card ------------------------------------------------
function renderFinancialSummaryCard(doc, ctx, { iv, t, money }) {
  const rows = [];
  rows.push(['Subtotal', t.sub]);
  const invDisc = iv.discountType === 'percent' ? t.sub * (num(iv.discount) / 100) : num(iv.discount);
  if (invDisc) rows.push(['Discount', -invDisc]);
  if (iv.gstMode === 'exempt') { /* GST exempt — no tax line */ }
  else if (t.isIgst && t.igst > 0.005) rows.push(['IGST', t.igst]);
  else if (iv.gstNo && (t.cgst > 0.005 || t.sgst > 0.005)) { rows.push(['CGST', t.cgst]); rows.push(['SGST', t.sgst]); }
  else if (t.gst > 0.005) rows.push(['GST', t.gst]);
  if (Math.abs(t.roundOff) > 0.001) rows.push(['Round Off', t.roundOff]);

  const payments = iv.payments || [];
  const paymentsLine = payments.length ? `Payments: ${payments.map((p) => `${p.mode} ${money(p.amount)}`).join(',  ')}` : null;
  const bodyH = rows.length * 14 + 11 + 3 * 17 + (paymentsLine ? 12 : 0);
  const height = CARD.titleH + CARD.contentTopPad + bodyH + CARD.contentBottomPad;
  const { bottom } = openCard(doc, ctx, { title: 'FINANCIAL SUMMARY', height });

  const lx = M + CARD.padX, rx = W - M - CARD.padX;
  const row = (k, v, bold) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(bold ? 10 : 8.5);
    doc.setTextColor(bold ? 20 : 80, bold ? 20 : 80, bold ? 20 : 80);
    doc.text(k, lx, ctx.y); doc.text(money(v), rx, ctx.y, { align: 'right' });
    ctx.y += bold ? 17 : 14;
  };
  rows.forEach(([k, v]) => row(k, v, false));
  ctx.y += 3;
  doc.setDrawColor(...PDF_RULE.medium); doc.line(lx, ctx.y, rx, ctx.y);
  ctx.y += 11;
  row('Grand Total', t.grand, true);
  row('Paid', t.paid, false);
  row('Balance Due', t.balance, true);
  if (paymentsLine) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(120, 120, 120);
    doc.text(truncW(doc, paymentsLine, rx - lx), lx, ctx.y);
  }
  doc.setTextColor(...PDF_TEXT.body);
  closeCard(ctx, bottom);
}

// ---- Profitability Summary card (accent) ------------------------------------
function renderProfitabilityCard(doc, ctx, { t, money }) {
  const partsProfit = t.partsRev - t.cost;
  const marginPct = t.afterDisc > 0 ? (t.profit / t.afterDisc) * 100 : 0;
  const height = CARD.titleH + CARD.contentTopPad + 5 * 14 + 12 + 10 + 15 + 12 + CARD.contentBottomPad;
  const { bottom } = openCard(doc, ctx, { title: 'PROFITABILITY SUMMARY', height, accent: true });

  const lx = M + CARD.padX, rx = W - M - CARD.padX;
  const row = (k, v, bold) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(bold ? 10 : 8.5);
    doc.setTextColor(bold ? 20 : 80, bold ? 20 : 80, bold ? 20 : 80);
    doc.text(k, lx, ctx.y); doc.text(money(v), rx, ctx.y, { align: 'right' });
    ctx.y += bold ? 17 : 14;
  };
  row('Total Parts Revenue', t.partsRev);
  row('Total Parts Cost', t.cost);
  row('Parts Profit', partsProfit);
  row('Total Labour Revenue', t.labourRev);
  row('Labour Profit', t.labourRev);
  doc.setFontSize(6.5); doc.setTextColor(150, 150, 150); doc.setFont('helvetica', 'italic');
  doc.text('Labour cost is not tracked separately in this system; labour profit equals labour revenue.', lx, ctx.y);
  ctx.y += 12;
  doc.setFont('helvetica', 'normal');
  doc.setDrawColor(...PDF_GOLD.onLight); doc.setLineWidth(0.5); doc.line(lx, ctx.y - 2, rx, ctx.y - 2); doc.setLineWidth(0.2);
  ctx.y += 10;
  doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(...PDF_GOLD.onLight);
  doc.text('Gross Profit', lx, ctx.y); doc.text(money(t.profit), rx, ctx.y, { align: 'right' });
  ctx.y += 15;
  doc.setFontSize(9.5); doc.text('Gross Margin', lx, ctx.y); doc.text(`${marginPct.toFixed(1)}%`, rx, ctx.y, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setTextColor(...PDF_TEXT.body);
  closeCard(ctx, bottom);
}

// ---- Internal Notes card ------------------------------------------------------
function renderInternalNotesCard(doc, ctx, { jc }) {
  const innerW = W - 2 * M - 2 * CARD.padX;
  const notes = jc ? [
    jc.customerNote && ['Service Advisor Note', jc.customerNote],
    jc.technicianNote && ['Technician Note', jc.technicianNote],
    jc.billingNote && ['Billing Note', jc.billingNote],
    jc.notes && ['Workshop Notes', jc.notes],
  ].filter(Boolean) : [];

  if (!notes.length) {
    const height = CARD.titleH + CARD.contentTopPad + 17 + CARD.contentBottomPad;
    const { bottom } = openCard(doc, ctx, { title: 'INTERNAL NOTES', height });
    doc.setFontSize(TYPE.body); doc.setTextColor(110, 110, 110);
    doc.text('No internal notes recorded.', M + CARD.padX, ctx.y);
    doc.setTextColor(...PDF_TEXT.body);
    closeCard(ctx, bottom);
    return;
  }

  // Internal Notes is always the last section (see the fixed order this
  // module renders in). Most invoices carry only a couple of short notes —
  // small enough that the whole card would comfortably fit on ONE fresh
  // page. If it doesn't fit in what's left of the current page but would
  // fit whole on a new one, break now rather than let the per-line flow
  // below split it: letting note 1 land here and note 2 spill to a
  // "(continued)" card one page later is a needlessly fragmented card for
  // content that was never actually too big for a single page.
  const notesTotalH = notes.reduce((s, [, text]) => s + 10 + doc.splitTextToSize(String(text), innerW).length * 11 + 8, 0);
  const wholeCardH = CARD.titleH + CARD.contentTopPad + notesTotalH + CARD.contentBottomPad;
  if (ctx.y + wholeCardH > PAGE_BOTTOM && CONTINUATION_TOP + wholeCardH <= PAGE_BOTTOM) ctx.newPage();

  const card = openFlowCard(doc, ctx, { title: 'INTERNAL NOTES' });
  notes.forEach(([label, text]) => {
    card.ensureLine(21);
    doc.setFontSize(TYPE.fieldLabel); doc.setTextColor(130, 130, 130); doc.setFont('helvetica', 'bold');
    doc.text(label.toUpperCase(), M + CARD.padX, ctx.y); ctx.y += 10;
    doc.setFontSize(TYPE.body); doc.setTextColor(40, 40, 40); doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(String(text), innerW);
    lines.forEach((ln) => { card.ensureLine(11); doc.text(ln, M + CARD.padX, ctx.y); ctx.y += 11; });
    ctx.y += 8;
  });
  doc.setTextColor(...PDF_TEXT.body);
  card.finish();
}

/**
 * Main entry point. Draws the letterhead, the structured header card, and every
 * body card in the fixed section order the brief specifies (Company+Invoice →
 * Bill To+Vehicle → Job Card → Parts → Labour → Other → Financial Summary →
 * Profitability → Internal Notes), then returns the final page count so the
 * caller (BillingModule.jsx) can run its own page-numbering + footer pass exactly
 * as it already does for the customer copy.
 */
export function renderWorkshopInvoicePdf(doc, params) {
  const { iv, jc, cust, veh, shop, status, totals: t, money, qrDataUrl, docTypeLabel, partLines, svcLines, otherLines } = params;

  // drawPdfHeader's own return value is the y BELOW its full 5-line letterhead
  // (name/tagline/phones/address/GST+email+website) + gold rule — using a
  // hardcoded guess here instead previously put the header card's title 46pt too
  // high, drawing it directly on top of the letterhead's own contact line.
  const bodyTop = drawPdfHeader(doc, { W, M, shop });
  const ctx = makeCursor(doc, { shop, docTypeLabel, iv, cust, veh });
  ctx.y = bodyTop;

  const generatedAt = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  renderHeaderCard(doc, ctx, { iv, status, docTypeLabel, qrDataUrl, generatedAt });
  renderBillToVehicleCards(doc, ctx, { cust, veh, iv });
  renderJobCardCard(doc, ctx, { iv, jc });
  renderPartsCard(doc, ctx, { partLines, money });
  renderLabourCard(doc, ctx, { svcLines, money, iv, jc });
  renderOtherCard(doc, ctx, { otherLines, money });
  renderFinancialSummaryCard(doc, ctx, { iv, t, money });
  renderProfitabilityCard(doc, ctx, { t, money });
  renderInternalNotesCard(doc, ctx, { jc });

  return { pageCount: ctx.page };
}
