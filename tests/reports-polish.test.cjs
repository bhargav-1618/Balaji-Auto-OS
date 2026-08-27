/**
 * tests/reports-polish.test.cjs — Reports module fixes: functional date-range filter,
 * numeric alignment, header subtitle, search clear, snapshot indication.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const dash = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');
const pageHeader = fs.readFileSync(path.resolve(__dirname, '../components/common/PageHeader.jsx'), 'utf8');

console.log('\nReports — layout & functional fixes\n');

// Part 4 — range filter now actually applies
ok('inRange handles invalid dates', /if \(Number\.isNaN\(d\.getTime\(\)\)\) return false; return d >= startOfRange/.test(dash));
ok('inRangeMs added for ms timestamps', /const inRangeMs = \(ms\) =>/.test(dash));
ok('sales rows filtered by range', /invoices\.filter\(\(iv\) => !iv\.isEstimate && inRange\(iv\.date\)\)/.test(dash));
ok('billing rows filtered by range', /invoices\.filter\(\(iv\) => inRange\(iv\.date\)\)\.map/.test(dash));
ok('parts/service/labour/outside sales filtered by range', /cats\.includes\(catOfSale\(s\)\) && inRangeMs\(saleMs\(s\)\)/.test(dash));
ok('jobcard rows filtered by range', /jobCards\.filter\(\(j\) => inRange\(j\.date \|\| j\.dateIn\)\)/.test(dash));
ok('gst rows filtered by range', /invStatus\(iv\) !== 'Cancelled' && inRange\(iv\.date\)/.test(dash));
// The inline `a.at?.toMillis ? a.at.toMillis() : a.at` ternary this originally asserted
// was later extracted into a named `auditAtMs(a)` helper (also now handling
// `a.createdAt` first, and string-typed dates — a real improvement, not just a rename)
// so both the filter and the row-mapping below reuse the same timestamp resolution.
ok('audit rows filtered by range', /auditLog\.filter\(\(a\) => inRangeMs\(auditAtMs\(a\)\)\)/.test(dash) && /const auditAtMs = \(a\) => \{/.test(dash));
ok('snapshot tabs identified (range N/A)', /const DATE_FILTERABLE = new Set\(\[/.test(dash));
ok('range disabled + explained on snapshot tabs', /disabled=\{!DATE_FILTERABLE\.has\(tab\)\}/.test(dash) && /date range does not apply/.test(dash));

// Part 1 — header subtitle. UNIVERSAL PAGE HEADER STANDARDIZATION: PageShell was
// promoted to the shared, exported components/common/PageHeader.jsx (used by every
// module now, not just 4 views in InventoryDashboard.js) — same subtitle support,
// just imported instead of defined locally.
ok('PageHeader supports subtitle', /export default function PageHeader\(\{ title, subtitle, icon: Icon, action, children \}\)/.test(pageHeader));
ok('Reports imports and uses the shared PageHeader', /import PageHeader from '\.\/common\/PageHeader'/.test(dash) && /<PageHeader title="Reports" icon=\{FileText\}/.test(dash));
ok('Reports header shows active range in subtitle', /subtitle=\{DATE_FILTERABLE\.has\(tab\)/.test(dash) && /current snapshot/.test(dash));
ok('range select has focus ring + aria', /aria-label="Report date range"/.test(dash) && /disabled:cursor-not-allowed"/.test(dash) && /focus:border-\[#d4af37\]\/60 disabled:opacity-40/.test(dash));

// Part 2 — numeric alignment
ok('numeric columns detected', /const numericCols = useMemo/.test(dash) && /NUM_HEAD = /.test(dash));
ok('numeric headers right-aligned', /\$\{numericCols\[i\] \? 'text-right' : 'text-left'\}/.test(dash));
ok('numeric cells right-aligned + tabular', /\$\{numericCols\[j\] \? 'text-right tabular-nums' : ''\}/.test(dash));

// search clear
ok('search has clear button', /aria-label="Clear search"[\s\S]{0,80}setQ\(''\)/.test(dash) || /onClick=\{\(\) => setQ\(''\)\} aria-label="Clear search"/.test(dash));

// runtime
const mk = (range) => { if (range === 'all') return new Date(0); const d = new Date(); const days = { today: 0, 7: 7, 30: 30, 90: 90, 365: 365 }[range] ?? 30; d.setDate(d.getDate() - days); d.setHours(0, 0, 0, 0); return d; };
const inRange = (s, range, sor) => { if (!s) return false; if (range === 'all') return true; const x = new Date(s); if (Number.isNaN(x.getTime())) return false; return x >= sor; };
const sor30 = mk('30');
ok('runtime: today within 30d', inRange(new Date().toISOString().slice(0, 10), '30', sor30) === true);
ok('runtime: 60d ago excluded from 30d', inRange(new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10), '30', sor30) === false);
ok('runtime: all-time includes old', inRange(new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10), 'all', mk('all')) === true);

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
