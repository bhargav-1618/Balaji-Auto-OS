// lib/exportSheet.js
//
// ONE implementation of "write a real Excel file" for the whole app.
//
// Every export in this codebase emitted CSV. A CSV carries no column widths and no cell
// types, so Excel auto-sized date columns too narrow — that is what "########" means,
// Excel saying "this column is too narrow for this value" — and dates arrived as inert
// text that would not sort or filter chronologically. Neither is fixable in CSV: the
// format has nowhere to put that information.
//
// This writes a genuine .xlsx with:
//   * real date cells (t: 'd', formatted dd-mmm-yyyy) that Excel, LibreOffice and
//     Google Sheets all read as dates,
//   * explicit column widths sized to the content, so nothing shows as ########,
//   * a frozen header row,
//   * numbers left numeric so they can be SUMmed.

/** Parse a yyyy-mm-dd string into a Date. Returns the input untouched if it isn't one. */
export function asDate(iso) {
  if (!iso) return '';
  if (iso instanceof Date) return iso;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d;
}

/**
 * Build a worksheet from a header row and an array-of-arrays body.
 * @param {object} XLSX      the lazily-imported SheetJS module
 * @param {string[]} head    column headers
 * @param {any[][]} rows     row values; Date objects become real date cells
 * @param {number[]} dateCols indices of the columns holding dates
 */
export function buildSheet(XLSX, head, rows, dateCols = []) {
  const ws = XLSX.utils.aoa_to_sheet([head, ...rows], { cellDates: true });

  dateCols.forEach((c) => {
    for (let r = 1; r <= rows.length; r += 1) {
      const ref = XLSX.utils.encode_cell({ c, r });
      const cell = ws[ref];
      if (cell && cell.v instanceof Date) {
        cell.t = 'd';
        cell.z = 'dd-mmm-yyyy';
      }
    }
  });

  // Width each column to its widest value. This is the actual cure for "########".
  ws['!cols'] = head.map((h, c) => {
    const longest = rows.reduce((m, r) => {
      const v = r[c];
      const len = v instanceof Date ? 11 : String(v ?? '').length;
      return Math.max(m, len);
    }, String(h).length);
    return { wch: Math.min(Math.max(longest + 2, 8), 40) };
  });
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  return ws;
}

/**
 * Write a single-sheet workbook to disk.
 * Throws if any row's length disagrees with the header — a silent column shift is how
 * the GST report ended up printing SGST under the CGST heading.
 */
export async function writeSheet({ filename, sheetName, head, rows, dateCols = [] }) {
  const bad = rows.find((r) => r.length !== head.length);
  if (bad) {
    throw new Error(
      `Export aborted: ${head.length} headers but a row has ${bad.length} values. `
      + 'Every column after the mismatch would be shifted.',
    );
  }
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSheet(XLSX, head, rows, dateCols), sheetName);
  XLSX.writeFile(wb, filename);
}

/** Today, as a yyyy-mm-dd filename stamp. */
export const stamp = () => new Date().toISOString().slice(0, 10);
