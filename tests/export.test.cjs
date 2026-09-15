/**
 * tests/export.test.cjs — ISSUE 4 (Excel shows ######## instead of dates)
 *
 * Builds a workbook with the SAME sheetFrom() logic the app uses, writes it, reads it
 * back, and inspects the cells. "######## " is Excel's way of saying the column is too
 * narrow for a numeric/date value — a CSV cannot carry column widths OR cell types, so
 * the format itself was the bug.
 */
require('./setup.cjs');            // babel require-hook, so we can load the real ESM module
const XLSX = require('xlsx');
const os = require('os');
const path = require('path');
const { buildSheet, asDate } = require('../lib/exportSheet.js');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};

// The helper under test is the REAL one from lib/exportSheet.js — not a copy. If the
// shipped code and this test ever drift, the test is worthless.
const sheetFrom = (head, rows, dateCols = []) => buildSheet(XLSX, head, rows, dateCols);

console.log('\nISSUE 4 — Excel export: real dates, sized columns\n');

const head = ['Invoice', 'Date', 'Customer', 'Phone', 'Vehicle', 'Job Card', 'Advisor',
  'Subtotal', 'GST', 'Grand Total', 'Paid', 'Balance', 'Profit', 'Status'];
const rows = [
  ['INV-0022', asDate('2026-07-13'), 'Suresh Sharma', '9857700547', 'Mahindra Bolero B6 Delta', '', '', 9021, 541, 9562, 9562, 0, 7165, 'Paid'],
  ['INV-0029', asDate('2026-07-13'), 'Ramesh Sharma', '9262965817', 'Mahindra Thar', '', '', 12699, 2286, 14985, 14985, 0, 5426, 'Paid'],
  ['INV-0196', asDate('2026-01-02'), 'Anil Reddy', '9999999999', 'Renault Kwid', '', '', 18775, 2415, 21190, 21190, 0, 9597, 'Paid'],
];

const ws = sheetFrom(head, rows, [1]);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Invoices');

// Round-trip through a real .xlsx file, exactly as Excel would read it.
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true });
// SheetJS does not restore column widths or number formats on read unless asked:
// cellStyles gives back '!cols', cellNF gives back the '.z' format string. Without
// these the data IS in the file but the reader silently drops it — which would have
// made this test fail against correct code.
const back = XLSX.read(buf, { type: 'buffer', cellDates: true, cellStyles: true, cellNF: true });
const s = back.Sheets.Invoices;

// 1. Date column carries DATE cells, not strings.
const b2 = s.B2;
ok('the Date cell is a real date, not text',
  b2 && b2.t === 'd' && b2.v instanceof Date,
  b2 ? `type=${b2.t} value=${JSON.stringify(b2.v)}` : 'B2 missing');

ok('the date value round-trips to the correct day',
  b2 && b2.v instanceof Date && b2.v.getFullYear() === 2026 && b2.v.getMonth() === 6 && b2.v.getDate() === 13,
  b2 && b2.v instanceof Date ? String(b2.v) : 'not a Date');

ok('the date carries an explicit dd-mmm-yyyy number format',
  b2 && /d{2}-mmm-yyyy/i.test(b2.z || ''),
  b2 ? `z=${b2.z}` : '');

// 2. Column widths exist — this is what stops "########".
const cols = s['!cols'];
ok('column widths are written (a CSV cannot carry these at all)',
  Array.isArray(cols) && cols.length === head.length,
  cols ? `got ${cols.length}, expected ${head.length}` : 'no !cols');

ok('the Date column is wide enough for dd-mmm-yyyy (>= 11 chars)',
  cols && cols[1].wch >= 11, cols ? `Date wch=${cols[1].wch}` : '');

ok('every column is at least 8 wide',
  cols && cols.every((c) => c.wch >= 8));

ok('the Vehicle column widened to fit its longest value',
  cols && cols[4].wch >= 'Mahindra Bolero B6 Delta'.length,
  cols ? `Vehicle wch=${cols[4].wch}` : '');

// 3. Header / row shape must match — this was a live column-shift bug.
ok('header count matches every row length (no column shift)',
  rows.every((r) => r.length === head.length),
  `head=${head.length}, rows=${rows.map((r) => r.length).join(',')}`);

// 4. Numbers stay numeric (so Excel can SUM them).
ok('money cells stay numeric',
  s.J2 && s.J2.t === 'n' && s.J2.v === 9562,
  s.J2 ? `type=${s.J2.t} v=${s.J2.v}` : 'J2 missing');

// --- NO EXPORT MAY REGRESS TO CSV. A CSV cannot carry cell types or column widths, so
// dates render as ######## and money arrives as TEXT that =SUM() returns 0 over. Every
// export in the app now goes through lib/exportSheet.js.
{
  const fs2 = require('fs');
  const path2 = require('path');
  const ROOT2 = path2.resolve(__dirname, '..');
  const walk2 = (dir, out = []) => {
    for (const e of fs2.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.next', '.git', 'tests'].includes(e.name)) continue;
      const p2 = path2.join(dir, e.name);
      if (e.isDirectory()) walk2(p2, out);
      else if (/\.(js|jsx)$/.test(e.name)) out.push(p2);
    }
    return out;
  };
  const csvWriters = [];
  walk2(path2.join(ROOT2, 'components')).forEach((f) => {
    const src = fs2.readFileSync(f, 'utf8');
    src.split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '').trim();
      if (/type:\s*['"]text\/csv/.test(code)) csvWriters.push(`${path2.relative(ROOT2, f)}:${i + 1}`);
    });
  });
  ok('NO component still writes a raw CSV blob (was 4)',
    csvWriters.length === 0,
    csvWriters.length ? `still emitting CSV:\n         ${csvWriters.join('\n         ')}` : '');

  const users = walk2(path2.join(ROOT2, 'components'))
    .filter((f) => /exportSheet/.test(fs2.readFileSync(f, 'utf8')));
  ok('every exporting module uses the ONE shared writer',
    users.length >= 4, `${users.length} modules import lib/exportSheet`);
}

// --- money must stay NUMERIC so Excel can total it.
{
  const head2 = ['Customer', 'Total Spent', 'Outstanding'];
  const rows2 = [['Anil Reddy', 276453, 8984], ['Praveen Sharma', 238783, 0]];
  const ws2 = sheetFrom(head2, rows2);
  const buf2 = XLSX.write({ SheetNames: ['C'], Sheets: { C: ws2 } }, { type: 'buffer', bookType: 'xlsx' });
  const back2 = XLSX.read(buf2, { type: 'buffer' });
  const cell = back2.Sheets.C.B2;
  ok('money is a NUMBER cell, not text (=SUM used to return 0)',
    cell && cell.t === 'n' && cell.v === 276453,
    cell ? `type=${cell.t} v=${cell.v}` : 'B2 missing');
}

// --- the column-shift guard. bulkExport used to push 10 values under 9 headers, so on
// the GST report the "CGST" column actually held SGST. Anyone filing from that sheet
// filed wrong numbers. writeSheet must now REFUSE to write a misaligned sheet.
const { writeSheet } = require('../lib/exportSheet.js');
// os/path (imported above) build a real OS temp path — '/tmp/...' is Unix-only and
// silently fails to write on Windows (no C:\tmp by default), which made "an aligned
// sheet still writes normally" fail for an environment reason unrelated to writeSheet
// itself: the earlier "misaligned" case still passed because that write is rejected by
// writeSheet's own header/row-count validation before it ever reaches the filesystem.
const neverExistPath = path.join(os.tmpdir(), 'balaji-export-test-should-never-exist.xlsx');
const alignedPath = path.join(os.tmpdir(), 'balaji-export-test-aligned.xlsx');
(async () => {
  let threw = null;
  try {
    await writeSheet({
      filename: neverExistPath,
      sheetName: 'X',
      head: ['Invoice', 'Date', 'Customer'],            // 3 headers
      rows: [['INV-1', asDate('2026-07-13'), 'Anil', 'EXTRA']],  // 4 values
    });
  } catch (e) { threw = e; }
  ok('a misaligned sheet is REFUSED, not silently shifted',
    !!threw && /headers but a row has/.test(threw.message),
    threw ? threw.message : 'writeSheet happily wrote a shifted sheet');

  ok('…and no file was produced',
    !require('fs').existsSync(neverExistPath));

  // the aligned case still writes
  let ok2 = true;
  try {
    await writeSheet({
      filename: alignedPath, sheetName: 'X',
      head: ['Invoice', 'Date', 'Customer'],
      rows: [['INV-1', asDate('2026-07-13'), 'Anil']],
      dateCols: [1],
    });
  } catch (e) { ok2 = false; }
  ok('an aligned sheet still writes normally', ok2);
  try { require('fs').unlinkSync(alignedPath); } catch {}

  console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
  process.exit(FAIL ? 1 : 0);
})();
