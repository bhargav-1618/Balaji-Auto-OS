#!/usr/bin/env node
// scripts/render-workshop-pdf-stress.js
//
// Local visual-verification harness for the Workshop Copy PDF redesign
// (lib/workshopInvoicePdf.js). Generates a batch of PDFs using the EXACT SAME
// renderer the running app calls — no browser, no Firebase, no React — covering a
// normal invoice plus the explicit stress-test scenarios from the redesign brief
// (very long names/addresses, many parts/labour rows, large multi-page notes,
// missing linked records, large quantities/prices), then converts every PDF page
// to a PNG with poppler's pdftoppm so each page can actually be looked at, instead
// of trusting "it generated without throwing" as proof the layout is correct.
//
// Usage: node scripts/render-workshop-pdf-stress.js
// Output: scratch/workshop-pdf-stress/<fixture>.pdf and .../<fixture>-N.png

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

// ---- Load the app's own ES-module lib files from plain Node --------------------
// lib/workshopInvoicePdf.js (and the pdfTheme/pdfQr/format files it imports) are
// written with import/export for the Next.js app's webpack build. This registers
// a require() hook that transpiles just those files with the @babel/core +
// @babel/plugin-transform-modules-commonjs packages Next.js/Jest already pull into
// node_modules — no change to the project's own package.json or build config.
const babel = require('@babel/core');
const LIB_DIR = path.join(__dirname, '..', 'lib') + path.sep;
const Module = require('module');
const origJsLoader = Module._extensions['.js'];
Module._extensions['.js'] = function (module, filename) {
  if (filename.startsWith(LIB_DIR)) {
    const src = fs.readFileSync(filename, 'utf8');
    const { code } = babel.transformSync(src, {
      filename,
      babelrc: false,
      configFile: false,
      plugins: ['@babel/plugin-transform-modules-commonjs'],
    });
    module._compile(code, filename);
    return;
  }
  origJsLoader(module, filename);
};

const { jsPDF } = require('jspdf');
const { renderWorkshopInvoicePdf } = require('../lib/workshopInvoicePdf.js');
const { PDF_PAGE, PDF_RULE, SHOP, drawPdfPageNumber } = require('../lib/pdfTheme.js');
const { makeQrDataUrl } = require('../lib/pdfQr.js');

const OUT_DIR = path.join(__dirname, '..', 'scratch', 'workshop-pdf-stress');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ---- totalsOf() — mirrors components/billing/BillingModule.jsx's own function
// exactly (it isn't exported; this is a deliberate, faithful copy for generating
// internally-consistent stress-test numbers, not a second implementation the app
// depends on). Kept in lockstep by inspection whenever that function changes.
const num = (n) => Number(n) || 0;
function totalsOf(inv) {
  const lines = inv.lines || [];
  let sub = 0, lineGst = 0, cost = 0;
  lines.forEach((l) => {
    const gross = num(l.qty) * num(l.rate);
    const lineDisc = l.disc ? gross * (num(l.disc) / 100) : 0;
    const net = Math.max(0, gross - lineDisc);
    sub += net;
    const rate = l.gst != null ? num(l.gst) : num(inv.gstPct);
    lineGst += net * (rate / 100);
    cost += num(l.purchasePrice) * num(l.qty);
  });
  const invDisc = inv.discountType === 'percent' ? sub * (num(inv.discount) / 100) : num(inv.discount);
  const afterDisc = Math.max(0, sub - invDisc);
  const anyLineGst = lines.some((l) => l.gst != null);
  let gst = anyLineGst ? lineGst * (afterDisc / (sub || 1)) : afterDisc * (num(inv.gstPct) / 100);
  if (inv.gstMode === 'exempt') gst = 0;
  const isIgst = inv.gstMode === 'igst';
  const grandRaw = afterDisc + gst;
  const grand = Math.round(grandRaw);
  const roundOff = grand - grandRaw;
  const hasPayments = Array.isArray(inv.payments) && inv.payments.length > 0;
  const legacyPaid = !hasPayments && inv.legacyPaid === true ? num(inv.paid) : 0;
  const paid = hasPayments ? inv.payments.reduce((s, p) => s + num(p.amount), 0) : legacyPaid;
  const balance = Math.max(0, grand - paid);
  const profit = afterDisc - cost;
  const partsRev = lines.filter((l) => l.kind === 'Part').reduce((s, l) => s + num(l.qty) * num(l.rate), 0);
  const labourRev = lines.filter((l) => l.kind === 'Labour').reduce((s, l) => s + num(l.qty) * num(l.rate), 0);
  const p2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
  const gstR = p2(gst);
  const halfS = p2(gstR / 2);
  const halfC = p2(gstR - halfS);
  return {
    sub: p2(sub), afterDisc: p2(afterDisc), gst: gstR,
    cgst: isIgst ? 0 : halfC, sgst: isIgst ? 0 : halfS, igst: isIgst ? gstR : 0,
    isIgst, grand, roundOff: p2(roundOff),
    balance: p2(balance), paid: p2(paid), profit: p2(profit), cost: p2(cost),
    partsRev: p2(partsRev), labourRev: p2(labourRev),
  };
}
const money = (n) => `Rs. ${num(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const deriveStatus = (inv) => {
  if (inv.status === 'Cancelled' || inv.status === 'Refunded' || inv.status === 'Returned') return inv.status;
  if (inv.isEstimate) return 'Estimate';
  const t = totalsOf(inv);
  if (t.balance <= 0 && t.grand > 0) return 'Paid';
  if (t.paid > 0) return 'Partially Paid';
  return inv.status === 'Draft' ? 'Draft' : 'Unpaid';
};

// Same fixed footer the real generator draws (components/billing/BillingModule.jsx)
// — replicated here so page-bottom overlap checks are meaningful (a card that
// truly collides with the footer band is exactly the defect being screened for).
function drawFooter(doc, { W, M, shop, iv, isWorkshop, page }) {
  const fy = 792;
  doc.setDrawColor(...PDF_RULE.medium); doc.line(M, fy - 34, W - M, fy - 34);
  doc.setFontSize(7.5); doc.setTextColor(120, 120, 120); doc.setFont('helvetica', 'normal');
  if (isWorkshop) doc.text('INTERNAL WORKSHOP COPY  ·  SYSTEM-GENERATED DOCUMENT', M, fy - 22);
  else doc.text('Thank you for choosing ' + shop.name + '.', M, fy - 22);
  if (isWorkshop) doc.text('Not valid as a tax invoice. For workshop and management use only — not for customer distribution.', M, fy - 12);
  else doc.text('Goods once sold will not be taken back. E&OE.', M, fy - 12);
  doc.setDrawColor(...PDF_RULE.medium); doc.line(W - M - 150, fy - 20, W - M, fy - 20);
  doc.setFontSize(8); doc.setTextColor(90, 90, 90); doc.text('Authorised Signatory', W - M, fy - 8, { align: 'right' });
  doc.setFontSize(7); doc.setTextColor(150, 150, 150); doc.text('For ' + shop.name, W - M, fy + 1, { align: 'right' });
  for (let p = 1; p <= page; p += 1) { doc.setPage(p); drawPdfPageNumber(doc, p, { W, M, total: isWorkshop ? page : undefined }); }
}

async function renderFixture(name, build) {
  const { iv, jc, cust, veh, partLines, svcLines, otherLines } = build();
  const { W, M } = PDF_PAGE;
  const doc = new jsPDF({ unit: PDF_PAGE.unit, format: PDF_PAGE.format });
  const shop = SHOP;
  const t = totalsOf(iv);
  const status = deriveStatus(iv);
  const docTypeLabel = iv.isEstimate ? 'ESTIMATE / QUOTATION' : (iv.gstNo ? 'TAX INVOICE' : 'INVOICE');
  const qrDataUrl = await makeQrDataUrl(`http://localhost:3000/?open=invoice:${encodeURIComponent(iv.invNo)}`);

  const { pageCount } = renderWorkshopInvoicePdf(doc, {
    iv, jc, cust, veh, shop, status, totals: t, money, qrDataUrl, docTypeLabel, partLines, svcLines, otherLines,
  });
  drawFooter(doc, { W, M, shop, iv, isWorkshop: true, page: pageCount });

  const outPdf = path.join(OUT_DIR, `${name}.pdf`);
  fs.writeFileSync(outPdf, Buffer.from(doc.output('arraybuffer')));
  console.log(`  ${name}: ${pageCount} page(s) -> ${path.relative(process.cwd(), outPdf)}`);
  return { name, pageCount, outPdf };
}

// ---- Fixtures -------------------------------------------------------------------
// Each one targets specific items from the redesign brief's stress-test list
// (Issue 6). Comment on each fixture states exactly which.

function fixtureNormal() {
  const iv = {
    invNo: 'INV-1001', date: '2026-08-05', isEstimate: false, gstNo: '29ABCDE1234F1Z5', gstPct: 18,
    customerId: 'c1', vehicleId: 'v1', jobNo: 'SBBMC0142', advisor: 'Kiran', technician: 'Suresh',
    customer: 'Ramesh Kumar', phone: '9876543210', vehicle: 'Hyundai i20', regNo: 'TS09EX1234',
    payments: [{ mode: 'UPI', amount: 18500 }],
    lines: [
      { kind: 'Part', desc: 'Brake Pad Set (Front)', qty: 1, rate: 2200, purchasePrice: 1400, sku: 'BRK-2201', rack: 'A3' },
      { kind: 'Part', desc: 'Engine Oil 5W30 4L', qty: 1, rate: 2800, purchasePrice: 2000, sku: 'OIL-5W30-4', rack: 'B1' },
      { kind: 'Part', desc: 'Oil Filter', qty: 1, rate: 350, purchasePrice: 180, sku: 'FLT-OIL-09' },
      { kind: 'Labour', desc: 'General Service', qty: 1, rate: 1800 },
      { kind: 'Labour', desc: 'Wheel Alignment & Balancing', qty: 1, rate: 900 },
    ],
  };
  const cust = { id: 'c1', name: 'Ramesh Kumar', code: 'CUS-0042', phone: '9876543210', email: 'ramesh.kumar@example.com', type: 'Regular', since: '2023-04-12', gst: '29ABCDE1234F1Z5', address: '12-3-45, MG Road', area: 'Panjagutta', city: 'Hyderabad', district: 'Hyderabad' };
  const veh = { id: 'v1', regNo: 'TS09EX1234', make: 'Hyundai', model: 'i20', variant: 'Sportz', fuel: 'Petrol', vin: 'MALA851ALJM123456', engineNo: 'G4FCJM123456', odometer: 45230, insurer: 'ICICI Lombard', policyNo: 'POL-99123', policyEnd: '2027-03-15' };
  const jc = { jobNo: 'SBBMC0142', advisor: 'Kiran', technician: 'Suresh', helper: 'Ravi', statusLog: [{ status: 'Delivered', at: '2026-08-05T15:00:00Z' }], complaints: ['Brake noise while braking'], diagnosis: ['Worn front brake pads'], customerNote: 'Customer requested pickup after 5 PM.', technicianNote: 'Replaced pads, checked rotor thickness — within limits.' };
  const partLines = iv.lines.filter((l) => l.kind === 'Part' || l.kind === 'Other');
  const svcLines = iv.lines.filter((l) => l.kind === 'Labour' || l.kind === 'Service');
  const otherLines = iv.lines.filter((l) => !['Part', 'Other', 'Labour', 'Service'].includes(l.kind));
  return { iv, jc, cust, veh, partLines, svcLines, otherLines };
}

// Issue 6: extremely long customer name, very long address, long vehicle name,
// long technician name, long part names, large quantities, large prices, and many
// outside-purchase rows — combined into one realistic worst-case invoice, plus
// enough parts/labour rows to force genuine multi-page continuation.
function fixtureExtremeStress() {
  const longName = 'Venkata Naga Satya Sai Ramakrishna Subrahmanyam Chowdary Garu';
  const longAddr = 'Flat No. 402, 4th Floor, Sri Lakshmi Venkateswara Residency, Beside Ayyappa Swamy Temple, Opposite Big Bazaar, Old Gajuwaka Main Road, Gajuwaka, Visakhapatnam, Andhra Pradesh';
  const longTech = 'Chinta Venkata Naga Ramakrishna Prasad (Senior Technician — Diesel & Petrol Specialist)';
  const iv = {
    invNo: 'INV-9999', date: '2026-08-05', isEstimate: false, gstNo: '37XXXXX0000X1Z5', gstPct: 18,
    customerId: 'c2', vehicleId: 'v2', jobNo: 'SBBMC0999', advisor: 'Advisor Name With Extra Length For Testing',
    technician: longTech,
    customer: longName, phone: '9988776655',
    vehicle: 'Mahindra XUV700 AX7L Luxury Pack Automatic Diesel 4WD', regNo: 'AP31XY9876',
    payments: [{ mode: 'Cash', amount: 50000 }, { mode: 'Card', amount: 75000 }, { mode: 'UPI', amount: 25000 }],
    lines: [
      ...Array.from({ length: 22 }, (_, i) => ({
        kind: 'Part',
        desc: `Genuine OEM Replacement Part — Extended Description For Stress Testing Column Wrap Number ${i + 1} (Heavy Duty, Imported)`,
        qty: [1, 2, 5, 20][i % 4],
        rate: [499.5, 12500, 45000, 85000][i % 4],
        purchasePrice: [300, 9000, 32000, 60000][i % 4],
        sku: `SKU-${1000 + i}-XXL`,
        rack: `Z${i % 9}-${i}`,
      })),
      ...Array.from({ length: 14 }, (_, i) => ({
        kind: 'Other',
        desc: `Outside Purchase Item ${i + 1} — Sourced From Local Vendor On Priority`,
        qty: 1, rate: 1500 + i * 250, purchasePrice: 1000 + i * 150,
      })),
      ...Array.from({ length: 16 }, (_, i) => ({
        kind: 'Labour',
        desc: `Extended Diagnostic & Repair Labour Line ${i + 1} — Multi-Stage Procedure Requiring Specialist Attention`,
        qty: i % 3 === 0 ? 3.5 : 1, rate: i % 3 === 0 ? 850 : 2200, hourly: i % 3 === 0,
      })),
    ],
  };
  const cust = { id: 'c2', name: longName, code: 'CUS-9999', phone: '9988776655', altPhone: '9123456780', email: 'a.very.long.email.address.for.testing@example-company-domain.co.in', type: 'VIP / Fleet', since: '2019-01-01', gst: '37XXXXX0000X1Z5', address: longAddr, area: '', city: '', district: '' };
  const veh = { id: 'v2', regNo: 'AP31XY9876', make: 'Mahindra', model: 'XUV700 AX7L Luxury Pack Automatic Diesel 4WD', variant: 'AX7L', fuel: 'Diesel', vin: 'MA1XUV700LJM9876543210', engineNo: 'MHDIESEL4WD987654321', odometer: 128450, insurer: 'Bajaj Allianz General Insurance Company Limited', policyNo: 'POL-2026-XUV-998877', policyEnd: '2027-11-30', extWarranty: true, warrantyExpiry: '2028-06-15' };
  const jc = {
    jobNo: 'SBBMC0999', advisor: 'Advisor Name With Extra Length For Testing', technician: longTech, helper: 'Helper Name Also Reasonably Long For Testing',
    statusLog: [{ status: 'Delivered', at: '2026-08-05T18:30:00Z' }],
    complaints: ['Engine warning light intermittently on during highway driving above 80kmph, accompanied by a faint burning smell near the front left wheel well', 'AC not cooling sufficiently on rear vents'],
    diagnosis: ['Diagnosed a faulty EGR valve causing intermittent limp mode; also found the front-left brake caliper partially seized, generating heat consistent with the reported smell', 'Rear AC blower motor resistor burnt out'],
  };
  const partLines = iv.lines.filter((l) => l.kind === 'Part' || l.kind === 'Other');
  const svcLines = iv.lines.filter((l) => l.kind === 'Labour' || l.kind === 'Service');
  const otherLines = iv.lines.filter((l) => !['Part', 'Other', 'Labour', 'Service'].includes(l.kind));
  return { iv, jc, cust, veh, partLines, svcLines, otherLines };
}

// Issue 6: "large internal notes" — several very long paragraphs across all four
// note fields, specifically to force the Internal Notes card's page-spanning
// (openFlowCard) path independent of table pagination.
function fixtureLargeNotes() {
  const para = (label) => `${label}: ` + Array.from({ length: 40 }, (_, i) => `Detail point ${i + 1} regarding the service history and observations recorded during this visit, including component condition, wear patterns, and recommendations for the customer's future maintenance schedule.`).join(' ');
  const iv = {
    invNo: 'INV-2002', date: '2026-08-05', isEstimate: false, gstNo: '29ABCDE1234F1Z5', gstPct: 18,
    customerId: 'c3', vehicleId: 'v3', jobNo: 'SBBMC0210', advisor: 'Kiran', technician: 'Suresh',
    customer: 'Anil Sharma', phone: '9012345678', vehicle: 'Toyota Innova Crysta', regNo: 'KA05MN4321',
    payments: [{ mode: 'Cash', amount: 5200 }],
    lines: [
      { kind: 'Part', desc: 'Air Filter', qty: 1, rate: 650, purchasePrice: 400 },
      { kind: 'Labour', desc: 'AC Service', qty: 1, rate: 1500 },
    ],
  };
  const cust = { id: 'c3', name: 'Anil Sharma', code: 'CUS-0210', phone: '9012345678', type: 'Regular', since: '2021-06-01', address: '45 Brigade Road', area: 'Central', city: 'Bengaluru', district: 'Bengaluru Urban' };
  const veh = { id: 'v3', regNo: 'KA05MN4321', make: 'Toyota', model: 'Innova Crysta', variant: 'ZX', fuel: 'Diesel', vin: 'MBJXXXCRYSTA123456', engineNo: 'GD-2TR-654321', odometer: 62100 };
  const jc = {
    jobNo: 'SBBMC0210', advisor: 'Kiran', technician: 'Suresh', helper: 'Ravi',
    statusLog: [{ status: 'Delivered', at: '2026-08-05T12:00:00Z' }],
    complaints: ['AC not cold enough'], diagnosis: ['Low refrigerant, minor leak at condenser'],
    customerNote: para('Service Advisor Note'),
    technicianNote: para('Technician Note'),
    billingNote: para('Billing Note'),
    notes: para('Workshop Notes'),
  };
  const partLines = iv.lines.filter((l) => l.kind === 'Part' || l.kind === 'Other');
  const svcLines = iv.lines.filter((l) => l.kind === 'Labour' || l.kind === 'Service');
  const otherLines = iv.lines.filter((l) => !['Part', 'Other', 'Labour', 'Service'].includes(l.kind));
  return { iv, jc, cust, veh, partLines, svcLines, otherLines };
}

// Issue 6 (implicit): missing customer/vehicle/job-card records — the "record was
// deleted after the invoice was raised" case — combined with a LABOUR-ONLY
// invoice (no Parts, no Other Charges at all) so the Parts/Other cards must not
// render, not even empty.
function fixtureMissingRecordsLabourOnly() {
  const iv = {
    invNo: 'INV-3003', date: '2026-08-05', isEstimate: false, gstNo: '', gstPct: 18,
    customerId: 'deleted-cust', vehicleId: 'deleted-veh', jobNo: 'SBBMC0055',
    customer: 'Walk-in Customer', phone: '', vehicle: 'Maruti Alto', regNo: 'TS07AB1122',
    payments: [],
    lines: [
      { kind: 'Labour', desc: 'Battery Jump Start', qty: 1, rate: 300 },
      { kind: 'Labour', desc: 'Puncture Repair', qty: 2, rate: 150 },
    ],
  };
  const partLines = [];
  const svcLines = iv.lines.filter((l) => l.kind === 'Labour' || l.kind === 'Service');
  const otherLines = [];
  return { iv, jc: null, cust: null, veh: null, partLines, svcLines, otherLines };
}

// Issue 6: "many parts" in isolation (no labour at all) — forces the Parts table
// card alone to span several pages, so the repeated-header / "(continued)" /
// retroactive-border behaviour can be checked without any other card interleaved.
function fixtureManyPartsOnly() {
  const iv = {
    invNo: 'INV-4004', date: '2026-08-05', isEstimate: false, gstNo: '29ABCDE1234F1Z5', gstPct: 18,
    customerId: 'c4', vehicleId: 'v4', jobNo: 'SBBMC0301', advisor: 'Meera', technician: 'Naveen',
    customer: 'Suresh Reddy', phone: '9765432109', vehicle: 'Tata Ace Gold', regNo: 'TS08CD5566',
    payments: [{ mode: 'Bank Transfer', amount: 250000 }],
    lines: Array.from({ length: 70 }, (_, i) => ({
      kind: 'Part',
      desc: `Fleet Maintenance Part #${i + 1} — ${['Bearing', 'Gasket', 'Bushing', 'Sensor', 'Belt'][i % 5]}`,
      qty: (i % 5) + 1, rate: 200 + i * 15, purchasePrice: 120 + i * 9,
      sku: `FLT-${500 + i}`, rack: i % 3 === 0 ? `R${i}` : undefined,
    })),
  };
  const cust = { id: 'c4', name: 'Suresh Reddy', code: 'CUS-0301', phone: '9765432109', type: 'Fleet', since: '2020-02-14', gst: '29ABCDE1234F1Z5', address: '7-1-58 Ameerpet', area: 'Ameerpet', city: 'Hyderabad', district: 'Hyderabad' };
  const veh = { id: 'v4', regNo: 'TS08CD5566', make: 'Tata', model: 'Ace Gold', variant: 'CX', fuel: 'Diesel', engineNo: 'TATAACE998877', odometer: 88000 };
  const jc = { jobNo: 'SBBMC0301', advisor: 'Meera', technician: 'Naveen', statusLog: [{ status: 'Delivered', at: '2026-08-05T09:00:00Z' }], complaints: ['Fleet 6-monthly maintenance'], diagnosis: ['Routine — multiple wear parts replaced'] };
  const partLines = iv.lines.filter((l) => l.kind === 'Part' || l.kind === 'Other');
  const svcLines = [];
  const otherLines = [];
  return { iv, jc, cust, veh, partLines, svcLines, otherLines };
}

async function main() {
  console.log('Rendering Workshop Copy PDF stress fixtures...\n');
  const fixtures = [
    ['normal', fixtureNormal],
    ['extreme-stress', fixtureExtremeStress],
    ['large-notes', fixtureLargeNotes],
    ['missing-records-labour-only', fixtureMissingRecordsLabourOnly],
    ['many-parts-only', fixtureManyPartsOnly],
  ];
  const results = [];
  for (const [name, build] of fixtures) {
    // eslint-disable-next-line no-await-in-loop
    const r = await renderFixture(name, build);
    results.push(r);
  }
  console.log('\nConverting to PNG (pdftoppm, 150dpi)...\n');
  const pdftoppmBin = process.env.PDFTOPPM_BIN || 'C:\\Program Files\\MiKTeX\\miktex\\bin\\x64\\pdftoppm.exe';
  for (const r of results) {
    const pages = fs.readdirSync(OUT_DIR).filter((f) => f.startsWith(`${r.name}-`) && f.endsWith('.png'));
    pages.forEach((f) => fs.unlinkSync(path.join(OUT_DIR, f))); // clear stale PNGs from a prior run
    execFileSync(pdftoppmBin, ['-png', '-r', '150', r.outPdf, path.join(OUT_DIR, r.name)]);
    const pngs = fs.readdirSync(OUT_DIR).filter((f) => f.startsWith(`${r.name}-`) && f.endsWith('.png')).sort();
    console.log(`  ${r.name}: ${pngs.length} PNG page(s)`);
  }
  console.log(`\nDone. Output in ${OUT_DIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
