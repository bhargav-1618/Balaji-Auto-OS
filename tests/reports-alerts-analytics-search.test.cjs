/**
 * tests/reports-alerts-analytics-search.test.cjs
 *
 * The Universal Search Engine audit (see tests/customer-search-ranking.test.cjs and
 * tests/vehicles-module.test.cjs for the identifier-collision bug this review started
 * from) also flagged three ad hoc search implementations in InventoryDashboard.js that
 * bypass lib/useSearch.js entirely:
 *
 * 1. ReportTable (backs all 10+ Reports tabs) — a flat `rows.join(' ').includes(ql)`
 *    substring match with NO ranking at all. Rows are plain arrays with no named/typed
 *    fields (each report has its own column shape), so there is no single "identifier"
 *    field to isolate the way record-object modules do — substring-across-columns IS the
 *    correct model here, closer to spreadsheet search than "find the one record." What
 *    was actually missing was RANKING: a row where some cell EQUALS the query exactly is
 *    a stronger match than one where the query is merely a substring somewhere, but both
 *    used to sort identically. Fixed: exact-cell-match now ranks first when no explicit
 *    column sort is chosen (an explicit column sort still wins, unchanged).
 *
 * 2. AlertsView — filtered by a raw, undebounced `q` with no ranking; a title that
 *    EQUALS or STARTS WITH the query used to sort no differently than one where the
 *    query only appeared as a mid-string fragment. Alerts don't have a formal identifier
 *    field (their `id` is an internal key, not something a user searches by), so this
 *    stays a free-text search — fixed with debouncing (useDeferredSearch, was the one
 *    other undebounced box in this file besides Reports) and title-relevance ranking.
 *
 * 3. AnalyticsView's Top Profitable Parts / Fast Movers / Dead Stock widgets filtered
 *    parts by `p.name` ONLY — searching a part's own SKU/OEM/barcode/Part No. (the same
 *    identifiers searchable everywhere else in Inventory) silently matched nothing.
 *    These three are ranked LEADERBOARDS (sorted by profit/units/locked capital); their
 *    search box FILTERS which parts appear, it deliberately does NOT re-rank by
 *    relevance — that would defeat the point of a profit-sorted list. Fixed: a shared
 *    `partMatchesQuery` helper also checks sku/oemNo/barcode/partNo, sort order
 *    untouched.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');

console.log('\nReportTable / AlertsView / Analytics — search fixes\n');

// --- 1. ReportTable ---
const rtStart = src.indexOf('function ReportTable({');
ok('ReportTable call site found', rtStart !== -1);
const rtBlock = src.slice(rtStart, rtStart + 1600);
ok('ReportTable ranks rows: an exact cell match (score 2) outranks a mere substring match (score 1)',
  /if \(c === ql\) \{ score = 2; break; \}/.test(rtBlock) && /if \(score < 1 && c\.includes\(ql\)\) score = 1;/.test(rtBlock));
ok('ReportTable no longer uses the flat, unranked r.join(\' \').includes(ql) filter',
  !/rows\.filter\(\(r\) => r\.join\(' '\)\.toLowerCase\(\)\.includes\(ql\)\)/.test(rtBlock));
ok('ReportTable still returns rows untouched with no query (no ranking overhead when not searching)',
  /if \(!ql\) return rows;/.test(rtBlock));
{
  // Behavioral mirror of the exact ranking logic just added.
  const rankFilter = (rows, ql) => {
    if (!ql) return rows;
    const scored = [];
    for (const r of rows) {
      let score = 0;
      for (const cell of r) {
        const c = String(cell ?? '').toLowerCase();
        if (c === ql) { score = 2; break; }
        if (score < 1 && c.includes(ql)) score = 1;
      }
      if (score > 0) scored.push({ r, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map((x) => x.r);
  };
  const rows = [
    ['INV-01', 'Ramesh Kumar', '5000'],   // "5000" is a SUBSTRING of nothing exact here — actually let's use a cleaner case below
  ];
  const rows2 = [
    ['INV-01', 'contains BRA-RE-002 in notes', '100'], // fragment match only
    ['INV-02', 'BRA-RE-002', '200'],                    // exact cell match
  ];
  const out = rankFilter(rows2, 'bra-re-002');
  ok('an exact-cell match ranks first, ahead of a row where the query is merely a substring',
    out[0][0] === 'INV-02', out.map((r) => r[0]).join(', '));
}

// --- Reports search is debounced (was the one raw, undebounced box in this file besides Alerts) ---
const rvStart = src.indexOf('function ReportsView(props) {');
const rvBlock = src.slice(rvStart, rvStart + 1300);
ok('ReportsView debounces its search input via the shared useDeferredSearch hook',
  /const \[dq\] = useDeferredSearch\(q\);/.test(rvBlock));
ok('every <ReportTable> call site now receives the debounced dq, not the raw q',
  (src.match(/<ReportTable q=\{dq\}/g) || []).length >= 10 && !/<ReportTable q=\{q\}/.test(src));

// --- 2. AlertsView ---
const avStart = src.indexOf('function AlertsView({');
const avBlock = src.slice(avStart, avStart + 3200);
ok('AlertsView debounces its search input via the shared useDeferredSearch hook',
  /const \[dq\] = useDeferredSearch\(q\);/.test(avBlock));
ok('AlertsView ranks matches: title EQUALS query (3) > title STARTS WITH query (2) > substring-only (1)',
  /if \(title === needle\) return 3;/.test(avBlock) && /if \(title\.startsWith\(needle\)\) return 2;/.test(avBlock));
ok('the alerts filter itself still runs against the debounced dq, not the raw q',
  /const needle = safeLower\(dq\.trim\(\)\);/.test(avBlock));
// Placeholder now routes through lib/i18n.js's t('key', 'English fallback').
ok('the search input itself stays bound to the raw, uncontrolled-lag q (typing is never delayed)',
  /<input value=\{q\} onChange=\{\(e\) => setQ\(e\.target\.value\)\} placeholder=\{t\('alerts\.searchPlaceholder'/.test(src));

// --- 3. AnalyticsView (Top Profitable Parts / Fast Movers / Dead Stock) ---
const anStart = src.indexOf('function AnalyticsView({');
const anBlock = src.slice(anStart, anStart + 6000);
ok('a shared partMatchesQuery helper checks name AND sku/oemNo/barcode/partNo (was name-only)',
  /const partMatchesQuery = \(p, q\) => !q \|\| safeLower\(p\.name\)\.includes\(q\)/.test(anBlock) &&
  /\(p\.sku && safeLower\(p\.sku\)\.includes\(q\)\)/.test(anBlock));
ok('Top Profitable Parts uses the shared helper', /parts\s*\n\s*\.filter\(\(p\) => pUnits\(p\) > 0 && partMatchesQuery\(p, q\)\)/.test(src));
ok('Fast Movers uses the shared helper', /parts\.filter\(\(p\) => pUnits\(p\) > 0 && partMatchesQuery\(p, q\)\)\.sort\(\(a, b\) => pUnits\(b\) - pUnits\(a\)\)/.test(src));
ok('Dead Stock uses the shared helper', /isDeadStock\(p\) && partMatchesQuery\(p, q\) && \(ageDays\(p\) == null \|\| ageDays\(p\) >= dsAge\)/.test(src));
ok('no leftover name-only filter remains in any of the three widgets',
  !/safeLower\(p\.name\)\.includes\(q\)\)\)/.test(src) || (src.match(/safeLower\(p\.name\)\.includes\(q\)/g) || []).length === 1); // the one remaining occurrence is inside partMatchesQuery's own OR-chain
ok('these three widgets deliberately keep their metric-based sort (profit/units/locked capital) — search only filters, does not re-rank by relevance',
  /\.sort\(\(a, b\) => \(ppSort === 'margin' \? pMargin\(b\) - pMargin\(a\) : ppSort === 'revenue' \? pRev\(b\) - pRev\(a\) : pProfit\(b\) - pProfit\(a\)\)\)/.test(src));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
