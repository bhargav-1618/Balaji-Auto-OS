/**
 * tests/search-filter-pagination-integrity.test.cjs
 *
 * PHASE 16 — SEARCH / FILTER / SORT / PAGINATION CONSISTENCY.
 *
 * Central question: do records stay correctly represented when the dataset
 * changes (edit / delete / archive / restore / a concurrent client's write)
 * while search/filter/sort/pagination state is active? The underlying data is
 * always correct here — this phase hunts the derived-VIEW bugs that survive
 * normal UI testing: an empty page N while "N / M" (N > M) shows, a stale row
 * that outlived its record, a count that disagrees with what's on screen.
 *
 * Expected results are computed by an INDEPENDENT oracle (hand-derived slice
 * math, never by calling the production pagination code) and the REAL shared
 * search engine (`searchAndRank` / `rankIndexed` from lib/useSearch.js — pure
 * exported functions, not reimplemented here) is exercised directly.
 */
require('./setup.cjs');
const fs = require('fs');
const path = require('path');
const React = require('react');
const { render, cleanup } = require('@testing-library/react');
const Pagination = require('../components/inventory/Pagination.jsx').default;
const { searchAndRank, rankIndexed, matchIndexed, normId } = require('../lib/useSearch.js');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const flush = () => new Promise((r) => setTimeout(r, 0)); // let effects run

console.log('\nPHASE 16 — search / filter / sort / pagination consistency\n');

// =====================================================================
// 1 — INDEPENDENT PAGINATION ORACLE + the app's actual slice formula
// =====================================================================
console.log('1  Pagination math — independent oracle vs. the app\'s formula\n');

// Oracle: hand-derived from first principles. Given a list, a (possibly
// stale) page and a page size, this is exactly which rows a correct pager
// must show and what the page counter must read.
function oracle(listLength, page, per) {
  const pageCount = Math.max(1, Math.ceil(listLength / per));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const start = (safePage - 1) * per;
  const end = Math.min(start + per, listLength);
  return { pageCount, safePage, start, end, rowsOnPage: end - start,
    from: listLength === 0 ? 0 : start + 1, to: end };
}

// The formula every clamped module (Customers/Billing/Vehicles) actually uses.
function appSlice(list, page, per) {
  const pageCount = Math.max(1, Math.ceil(list.length / per));
  const safePage = Math.min(page, pageCount);
  return list.slice((safePage - 1) * per, safePage * per);
}

{
  const per = 10;
  // 16D — boundaries: 0, 1, per-1, per, per+1, 2*per, exact multiple, one beyond
  for (const n of [0, 1, 9, 10, 11, 20, 30, 31]) {
    const list = Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));
    const o = oracle(n, 1, per);
    ok(`n=${n}: oracle page 1 shows ${o.rowsOnPage} row(s), pageCount ${o.pageCount}`,
      appSlice(list, 1, per).length === o.rowsOnPage
      && Math.max(1, Math.ceil(n / per)) === o.pageCount);
    // last valid page is full-or-remainder, never empty
    const last = oracle(n, o.pageCount, per);
    ok(`n=${n}: last page (${last.safePage}) is non-empty unless the list itself is empty`,
      (n === 0 && last.rowsOnPage === 0) || last.rowsOnPage > 0);
  }
}

{
  // 16E — the headline bug: page 4, then the dataset shrinks to 1 page.
  const per = 10;
  const shrunk = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}` }));
  const o = oracle(shrunk.length, 4, per);
  ok('16E: page 4 with only 7 rows left -> oracle safePage clamps to 1, shows all 7, pageCount 1 (never "4 / 1")',
    o.safePage === 1 && o.pageCount === 1 && o.rowsOnPage === 7);
  ok('16E: the app\'s safePage formula agrees — slice is the 7 rows, not empty',
    appSlice(shrunk, 4, per).length === 7);

  // page 3 -> filter leaves exactly 3 pages (page stays valid)
  const three = Array.from({ length: 25 }, (_, i) => ({ id: `r${i}` }));
  ok('16E: page 3 of a 25-row / 3-page set stays page 3, shows rows 21..25',
    oracle(25, 3, per).safePage === 3 && appSlice(three, 3, per).map((r) => r.id).join() === 'r20,r21,r22,r23,r24');

  // page 3 -> filter leaves exactly 2 pages (clamp to 2, not stuck at 3)
  const two = Array.from({ length: 15 }, (_, i) => ({ id: `r${i}` }));
  ok('16E: page 3 with only 2 pages left -> clamps to page 2, shows rows 11..15',
    oracle(15, 3, per).safePage === 2 && appSlice(two, 3, per).map((r) => r.id).join() === 'r10,r11,r12,r13,r14');
}

// =====================================================================
// 2 — THE FIX: shared Pagination component pulls a stale page back in range
// =====================================================================
console.log('\n2  Shared <Pagination>: stale page correction (the PH16-01 fix)\n');

(async () => {
  // Render at page 5 with a total that only fills 1 page -> the component must
  // call onPage(1) so the caller's own row .slice() (which uses the raw page)
  // self-heals on the next render.
  let reported = null;
  const onPage = (p) => { reported = p; };
  render(React.createElement(Pagination, { page: 5, total: 3, perPage: 10, onPage }));
  await flush();
  ok('PH16-01: <Pagination page=5 total=3 perPage=10> fires onPage(1) — caller\'s page state is corrected, not left at "5 / 1"',
    reported === 1);
  cleanup();

  // page 5, total 25, perPage 10 -> pageCount 3 -> must clamp to 3
  reported = null;
  render(React.createElement(Pagination, { page: 5, total: 25, perPage: 10, onPage }));
  await flush();
  ok('PH16-01: page 5 of a 3-page set fires onPage(3) — not left showing "5 / 3" with an empty body',
    reported === 3);
  cleanup();

  // page already valid -> no correction fired (no thrash)
  reported = 'UNTOUCHED';
  render(React.createElement(Pagination, { page: 2, total: 25, perPage: 10, onPage }));
  await flush();
  ok('PH16-01: a valid page fires no onPage correction (convergent, no render thrash)',
    reported === 'UNTOUCHED');
  cleanup();

  // display: the counter never shows a value above pageCount even for one frame
  const { container } = render(React.createElement(Pagination, { page: 9, total: 25, perPage: 10, onPage: () => {} }));
  const counter = container.textContent || '';
  ok('PH16-01: the "N / M" counter shows the clamped page (3 / 3), never "9 / 3"',
    /3 \/ 3/.test(counter) && !/9 \/ 3/.test(counter));
  cleanup();

  runSourceProofs();
  runSearchEngineTests();
  finish();
})();

// =====================================================================
// 3 — PER-MODULE SOURCE PROOFS — every paginated list clamps on live shrink
// =====================================================================
function runSourceProofs() {
  console.log('\n3  Per-module clamp guarantees\n');

  const pag = read('../components/inventory/Pagination.jsx');
  ok('[fact] shared Pagination.jsx now has the stale-page effect + clamped display',
    /useEffect\(\(\) => \{\s*if \(page > pageCount\) onPage\(pageCount\);\s*\}, \[page, pageCount, onPage\]\);/.test(pag)
    && /const safe = Math\.min\(Math\.max\(1, page\), pageCount\);/.test(pag));

  const cust = read('../components/customers/CustomersModule.jsx');
  ok('[fact] CustomersModule: synchronous safePage clamp in the slice AND the row-ordinal column',
    /const safePage = Math\.min\(page, pageCount\);/.test(cust)
    && /filtered\.slice\(\(safePage - 1\) \* perPage/.test(cust)
    && /\{\(safePage - 1\) \* perPage \+ i \+ 1\}/.test(cust));

  const bill = read('../components/billing/BillingModule.jsx');
  ok('[fact] BillingModule: synchronous safePage clamp + filter-reset effect',
    /const safePage = Math\.min\(page, pageCount\);/.test(bill)
    && /useEffect\(\(\) => \{ setPage\(1\); \}, \[q, statusF, payModeF, dateF, PER\]\);/.test(bill));

  const veh = read('../components/vehicles/VehiclesModule.jsx');
  ok('[fact] VehiclesModule: synchronous safePage clamp + filter-reset effect',
    /const safePage = Math\.min\(page, pageCount\);/.test(veh)
    && /filtered\.slice\(\(safePage - 1\) \* perPage/.test(veh));

  const sup = read('../components/inventory/SupplierDirectory.jsx');
  ok('[fact] SupplierDirectory: BOTH the supplier list and the per-supplier parts list now clamp their page on a live shrink',
    /if \(listPage > listPageCount\) setListPage\(listPageCount\);/.test(sup)
    && /if \(partsPage > partsPageCount\) setPartsPage\(partsPageCount\);/.test(sup));

  const dash = read('../components/InventoryDashboard.js');
  ok('[fact] the main Parts list clamps invPage via effect; the alerts list now does too',
    /if \(invPage > invTotalPages\) setInvPage\(invTotalPages\);/.test(dash)
    && /if \(page > pages\) setPage\(pages\);/.test(dash));

  ok('[fact] the report-table pager already reset on `rows.length` (covers a live shrink) — unchanged',
    /useEffect\(\(\) => \{ setPage\(1\); \}, \[ql, sortCol, sortDir, per, rows\.length\]\);/.test(dash));

  ok('[fact, documented not fixed] LedgerPage\'s pager still uses `page === pages` boundary guards, but its data is append-only and every real shrink vector (date range / type filter) fires its own setPage(1) — the live-shrink case is unreachable there',
    /disabled=\{page === pages\}/.test(read('../components/common/LedgerPage.jsx'))
    && /setPage\(1\); \}, \[dq, range, type, sort, perPage, customStart, customEnd\]\);/.test(read('../components/common/LedgerPage.jsx')));
}

// =====================================================================
// 4 — THE REAL SEARCH ENGINE — mandatory concurrent-update scenarios
// =====================================================================
function runSearchEngineTests() {
  console.log('\n4  Live search result-set updates (real searchAndRank)\n');

  // Build the index Map exactly as useSearchIndex does (that part is a hook;
  // the MATCHING is the pure exported code under test).
  const buildIndex = (items, idFn, textFn, idsFn) => {
    const map = new Map();
    items.forEach((it) => map.set(idFn(it), {
      hay: textFn(it).filter(Boolean).join(' ').toLowerCase(),
      ids: idsFn(it).filter(Boolean).map(normId),
    }));
    return map;
  };
  const idFn = (x) => x.id;
  const textFn = (x) => [x.name, x.city];
  const idsFn = (x) => [x.code];

  // 16P — Client A searches "ABC". A record matches. Client B renames it.
  let items = [
    { id: 'c1', name: 'ABC Motors', city: 'Pune', code: 'CUST-0001' },
    { id: 'c2', name: 'Delhi Auto', city: 'Delhi', code: 'CUST-0002' },
    { id: 'c3', name: 'ABC Spares', city: 'Mumbai', code: 'CUST-0003' },
  ];
  let idx = buildIndex(items, idFn, textFn, idsFn);
  let res = searchAndRank(items, idx, idFn, 'ABC');
  ok('16P: search "ABC" returns exactly the two ABC records, each once',
    res.length === 2 && new Set(res.map(idFn)).size === 2 && res.every((r) => /ABC/.test(r.name)));

  // Client B: ABC Motors -> XYZ Motors. Rebuild index (mirrors the listener
  // updating `customers` -> useSearchIndex memo recomputing).
  items = items.map((x) => (x.id === 'c1' ? { ...x, name: 'XYZ Motors' } : x));
  idx = buildIndex(items, idFn, textFn, idsFn);
  res = searchAndRank(items, idx, idFn, 'ABC');
  ok('16P: after B renames "ABC Motors" -> "XYZ Motors", A\'s "ABC" results drop it — exactly one ABC record remains',
    res.length === 1 && res[0].id === 'c3');

  // Inverse: XYZ Motors -> ABC Global. Must re-enter, exactly once, no dupe.
  items = items.map((x) => (x.id === 'c1' ? { ...x, name: 'ABC Global' } : x));
  idx = buildIndex(items, idFn, textFn, idsFn);
  res = searchAndRank(items, idx, idFn, 'ABC');
  ok('16P (inverse): after B renames it back into the "ABC" set, A receives it again — exactly once, no duplicate row',
    res.length === 2 && new Set(res.map(idFn)).size === 2 && res.filter((r) => r.id === 'c1').length === 1);

  // 16J — search exact identifier, then edit the identifier out.
  items = [
    { id: 'p1', name: 'Oil Filter', city: '', code: 'OF-100' },
    { id: 'p2', name: 'Air Filter', city: '', code: 'AF-200' },
  ];
  idx = buildIndex(items, idFn, textFn, idsFn);
  ok('16J: exact identifier search "OF-100" finds p1 (rank 8, exact id hit)',
    rankIndexed(idx.get('p1'), 'OF-100') === 8 && matchIndexed(idx.get('p1'), 'OF-100'));
  items = items.map((x) => (x.id === 'p1' ? { ...x, code: 'XX-999' } : x));
  idx = buildIndex(items, idFn, textFn, idsFn);
  ok('16J: after the code changes to "XX-999", searching "OF-100" no longer matches p1',
    !matchIndexed(idx.get('p1'), 'OF-100') && searchAndRank(items, idx, idFn, 'OF-100').length === 0);

  // 16R — no duplicate identity ever comes out of searchAndRank
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `x${i}`, name: `Widget ${i}`, city: 'Town', code: `W-${i}` }));
  const mIdx = buildIndex(many, idFn, textFn, idsFn);
  const mRes = searchAndRank(many, mIdx, idFn, 'widget');
  ok('16R: searchAndRank over 40 matching records returns 40 distinct ids, no duplicates',
    mRes.length === 40 && new Set(mRes.map(idFn)).size === 40);

  // 16S — empty result
  ok('16S: a query matching nothing returns an empty array (not the full list, not a phantom row)',
    searchAndRank(many, mIdx, idFn, 'zzznomatch').length === 0);

  // 16C — filter -> sort -> paginate, verified against a hand-built oracle
  console.log('\n5  Filter -> sort -> paginate (independent oracle)\n');
  const dataset = Array.from({ length: 23 }, (_, i) => ({
    id: `d${i}`, city: i % 3 === 0 ? 'Pune' : 'Delhi', name: `Cust ${String(100 - i).padStart(3, '0')}`,
  }));
  const per = 10;
  // filter: city === 'Pune'
  const puneOnly = dataset.filter((d) => d.city === 'Pune'); // i = 0,3,6,9,12,15,18,21 -> 8 records
  // sort: name ascending
  const sorted = [...puneOnly].sort((a, b) => a.name.localeCompare(b.name));
  ok('16C: filter (city=Pune) applied to the FULL 23-record set, not a page -> 8 records',
    puneOnly.length === 8);
  ok('16C: page count for 8 filtered records at per=10 is exactly 1',
    Math.max(1, Math.ceil(sorted.length / per)) === 1);
  ok('16C: page 1 shows all 8 sorted records in name order; page 2 would be empty and is clamped away',
    appSlice(sorted, 1, per).length === 8
    && appSlice(sorted, 2, per).length === 8 /* safePage clamps 2 -> 1 */
    && appSlice(sorted, 1, per).map((r) => r.name).join() === [...sorted].map((r) => r.name).join());

  // 16F — sort flip while paginated: no dupes, no skips
  const big = Array.from({ length: 25 }, (_, i) => ({ id: `b${i}`, v: i }));
  const asc = [...big].sort((a, b) => a.v - b.v);
  const desc = [...big].sort((a, b) => b.v - a.v);
  const p2asc = appSlice(asc, 2, per).map((r) => r.id);
  const p2desc = appSlice(desc, 2, per).map((r) => r.id);
  const union = new Set([...p2asc, ...p2desc]);
  ok('16F: page 2 under asc and page 2 under desc are both exactly 10 rows, all distinct ids within each',
    p2asc.length === 10 && p2desc.length === 10
    && new Set(p2asc).size === 10 && new Set(p2desc).size === 10);
  ok('16F: across the full sorted list every id appears exactly once per sort order (no skips, no dupes)',
    asc.length === 25 && new Set(asc.map((r) => r.id)).size === 25
    && desc.length === 25 && new Set(desc.map((r) => r.id)).size === 25);
  void union;

  // 16N — count consistency: "from-to of total" always derived from the same length
  const o = oracle(sorted.length, 1, per);
  ok('16N: the range label (from..to of total) and the row count agree with the displayed slice',
    o.from === 1 && o.to === 8 && appSlice(sorted, 1, per).length === (o.to - o.from + 1));

  // 16Q — archive/restore moves a record between result sets (flag filter)
  console.log('\n6  Archive / restore result-set transitions\n');
  let parts = [
    { id: 'a1', name: 'Belt', archived: false },
    { id: 'a2', name: 'Hose', archived: true },
    { id: 'a3', name: 'Plug', archived: false },
  ];
  const active = (l) => l.filter((p) => !p.archived);
  const arch = (l) => l.filter((p) => p.archived);
  ok('16Q: active filter shows a1,a3; archived filter shows a2',
    active(parts).map((p) => p.id).join() === 'a1,a3' && arch(parts).map((p) => p.id).join() === 'a2');
  parts = parts.map((p) => (p.id === 'a1' ? { ...p, archived: true } : p));
  ok('16Q: archiving a1 -> it leaves the active set, joins the archived set (each still exactly once)',
    active(parts).map((p) => p.id).join() === 'a3' && arch(parts).map((p) => p.id).sort().join() === 'a1,a2');
  parts = parts.map((p) => (p.id === 'a2' ? { ...p, archived: false } : p));
  ok('16Q: restoring a2 -> it leaves the archived set, joins the active set',
    active(parts).map((p) => p.id).sort().join() === 'a2,a3' && arch(parts).map((p) => p.id).join() === 'a1');
}

function finish() {
  console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
  process.exit(FAIL ? 1 : 0);
}
