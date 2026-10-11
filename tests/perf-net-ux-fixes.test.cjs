/**
 * tests/perf-net-ux-fixes.test.cjs
 *
 * QA report, batch 4:
 *   UX-001   a NEW invoice was titled "Edit INV-0297"
 *   PERF-001 render-blocking Google Fonts stylesheet (loaded twice: CSS @import + <link>)
 *   NET-001  the login page probed /outro.mp4 (not shipped) -> a 404 on every visit
 *
 * Source-assertion style, matching this repo. Real-browser proof (request log, computed
 * fonts, the invoice dialog title) is in the Playwright harness.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : /\.(js|jsx|css)$/.test(e.name) ? [p] : [];
});

console.log('\nUX-001 — a new invoice is not titled "Edit …"\n');
const bill = read('components/billing/BillingModule.jsx');
// (This defect is already fixed on main by its own title logic — these assertions keep it fixed.)
ok('a persisted invoice is "Edit INV-…", a new one is "New Invoice" (chosen by isPersisted, not by whether a number exists)',
  /\{isPersisted \? `Edit \$\{inv\.invNo\}` : \(inv\.invNo \? `New Invoice · \$\{inv\.invNo\}` : 'New Invoice'\)\}/.test(bill));
ok('the old title that said "Edit" for every invoice (the number is pre-allocated) is not back', !/\{inv\.invNo \? `Edit \$\{inv\.invNo\}` : 'New Invoice'\}/.test(bill));
ok('isPersisted is the "exists in the saved list" check', /const isPersisted = invoices\.some\(\(x\) => x\.id === initial\.id\);/.test(bill));

console.log('\nPERF-001 — no render-blocking third-party font stylesheet\n');
const doc = read('pages/_document.js'), css = read('styles/globals.css'), app = read('pages/_app.js');
ok('_document.js no longer links the Google Fonts stylesheet or preconnects to it', !/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(doc));
ok('globals.css no longer @imports it (an @import is render-blocking AND chained behind the CSS)', !/@import\s+url\(['"]?https?:/.test(css));
ok('no source file anywhere pulls fonts from fonts.googleapis.com any more',
  [...walk(path.join(ROOT, 'components')), ...walk(path.join(ROOT, 'pages')), ...walk(path.join(ROOT, 'styles'))].every((f) => !/fonts\.googleapis\.com/.test(fs.readFileSync(f, 'utf8'))));
ok('_app.js self-hosts Cinzel + Montserrat via next/font/google', /import \{ Cinzel, Montserrat \} from 'next\/font\/google';/.test(app));
ok('both faces keep the weights the UI uses (Cinzel 400/600/700, Montserrat 400/500/600) and font-display: swap',
  /Cinzel\(\{ subsets: \['latin'\], weight: \['400', '600', '700'\], display: 'swap' \}\)/.test(app) && /Montserrat\(\{ subsets: \['latin'\], weight: \['400', '500', '600'\], display: 'swap' \}\)/.test(app));
ok('the real (hashed) family names are published as --font-cinzel / --font-montserrat on :root (global, so portals inherit)',
  /<style jsx global>\{`\s*:root \{ --font-cinzel: \$\{cinzel\.style\.fontFamily\}; --font-montserrat: \$\{montserrat\.style\.fontFamily\}; \}\s*`\}<\/style>/.test(app));
ok('body font uses the variable with the plain name as a fallback', /font-family: var\(--font-montserrat\), 'Montserrat', sans-serif;/.test(css));
const tw = read('tailwind.config.js');
ok('Tailwind font-cinzel / font-montserrat resolve through the variables', /cinzel: \['var\(--font-cinzel\)', 'Cinzel', 'serif'\]/.test(tw) && /montserrat: \['var\(--font-montserrat\)', 'Montserrat', 'sans-serif'\]/.test(tw));
// every hard-coded font stack that names Montserrat/Cinzel must go through the variable first,
// otherwise it would silently fall back to a system font once the family is renamed by next/font.
const bad = [];
[...walk(path.join(ROOT, 'components')), ...walk(path.join(ROOT, 'pages')), ...walk(path.join(ROOT, 'styles'))].forEach((f) => {
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    if (!/font-?[Ff]amily\s*[:=]?\s*[:'"]?/.test(line) && !/fontFamily/.test(line)) return;
    if (/(Montserrat|Cinzel)/.test(line) && !/var\(--font-(montserrat|cinzel)\)/.test(line)) bad.push(`${path.relative(ROOT, f)}:${i + 1}`);
  });
});
ok('every font-family declaration naming Montserrat/Cinzel goes through the next/font variable first', bad.length === 0, bad.join(', '));
ok('the CSP still allows same-origin fonts (next/font serves from /_next/static/media)', /font-src 'self'/.test(read('next.config.js')));

console.log('\nPERF-001 follow-on — the service worker still registers once fonts no longer delay `load`\n');
// Found by the Playwright OFFLINE-01 test: the old `load` listener only worked because the blocking
// Google Fonts stylesheet held `load` back; after self-hosting, `load` fires before the effect runs.
ok('_app.js registers the worker immediately when the document is already complete',
  /if \(document\.readyState === 'complete'\) \{ onLoad\(\); return undefined; \}\s*\n\s*window\.addEventListener\('load', onLoad\);/.test(app));
ok('...and still falls back to the load event (and cleans it up) while the page is loading',
  /window\.addEventListener\('load', onLoad\);\s*\n\s*return \(\) => window\.removeEventListener\('load', onLoad\);/.test(app));
ok('the registration target is unchanged (/sw.js)', /\.register\('\/sw\.js'\)/.test(app));

console.log('\nNET-001 — login no longer requests the (unshipped) /outro.mp4\n');
const login = read('pages/login.js');
// (Already fixed on main — the probe is gated by NEXT_PUBLIC_HAS_OUTRO_VIDEO; these assertions keep it fixed.)
ok('the HEAD probe only runs when a deployment opts in (OUTRO_VIDEO_AVAILABLE, from NEXT_PUBLIC_HAS_OUTRO_VIDEO=1)',
  /const OUTRO_VIDEO_AVAILABLE = process\.env\.NEXT_PUBLIC_HAS_OUTRO_VIDEO === '1';/.test(login) && /if \(OUTRO_VIDEO_AVAILABLE\) fetch\('\/outro\.mp4', \{ method: 'HEAD' \}\)/.test(login));
ok('there is no unconditional fetch of /outro.mp4 left', (login.match(/fetch\('\/outro\.mp4'/g) || []).length === 1 && !/^\s*fetch\('\/outro\.mp4'/m.test(login));
ok('with the probe off, hasOutro stays false so sign-in navigates straight to the app (the behaviour it always had when the probe 404ed)',
  /const \[hasOutro, setHasOutro\] = useState\(false\);/.test(login) && /if \(hasOutro\) setOutro\(true\);\s*\n\s*else window\.location\.href = href;/.test(login));
ok('the feature is still there for a deployment that ships the video (the <video src="/outro.mp4"> path is intact)', /src="\/outro\.mp4"/.test(login));
ok('public/outro.mp4 really is not shipped (the reason the probe was a guaranteed 404)', !fs.existsSync(path.join(ROOT, 'public', 'outro.mp4')));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
