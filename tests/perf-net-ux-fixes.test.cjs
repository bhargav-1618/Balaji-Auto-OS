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
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
ok('no source file anywhere loads fonts from fonts.googleapis.com / fonts.gstatic.com (comments aside)',
  [...walk(path.join(ROOT, 'components')), ...walk(path.join(ROOT, 'pages')), ...walk(path.join(ROOT, 'styles')), ...walk(path.join(ROOT, 'lib'))].every((f) => !/fonts\.(googleapis|gstatic)\.com/.test(stripComments(fs.readFileSync(f, 'utf8')))));

console.log('\nPERF-001 follow-up — fonts are read from the repo, so a build needs no network\n');
// A CI build failed intermittently inside next/font/google ("An error occurred in next/font") because it
// DOWNLOADED the fonts from Google at build time. next/font/local reads committed files instead.
ok('NOTHING imports next/font/google (it makes the production build depend on Google being reachable)',
  [...walk(path.join(ROOT, 'components')), ...walk(path.join(ROOT, 'pages')), ...walk(path.join(ROOT, 'lib')), ...walk(path.join(ROOT, 'context'))].every((f) => !/next\/font\/google/.test(stripComments(fs.readFileSync(f, 'utf8')))));
ok('_app.js loads the brand faces with next/font/local', /import localFont from 'next\/font\/local';/.test(app) && (app.match(/= localFont\(\{/g) || []).length === 4);
const FILES = ['cinzel-latin', 'cinzel-latin-ext', 'montserrat-latin', 'montserrat-latin-ext'];
ok('all four font files are committed under styles/fonts and are real WOFF2 files (wOF2 signature, sane size)',
  FILES.every((n) => { const p = path.join(ROOT, 'styles/fonts', n + '.woff2'); if (!fs.existsSync(p)) return false; const b = fs.readFileSync(p); return b.slice(0, 4).toString('latin1') === 'wOF2' && b.length > 5000 && b.length < 200000; }));
ok('.gitattributes marks woff/woff2 as binary (the repo normalises line endings on every file, which would corrupt a font)', /^\*\.woff2 binary$/m.test(read('.gitattributes')) && /^\*\.woff binary$/m.test(read('.gitattributes')));
ok('every source path in _app.js points at a font file that exists', [...app.matchAll(/path: '(\.\.\/styles\/fonts\/[^']+)'/g)].length === 4 && [...app.matchAll(/path: '(\.\.\/styles\/fonts\/[^']+)'/g)].every((m) => fs.existsSync(path.join(ROOT, 'pages', m[1]))));
ok('the SIL Open Font License texts ship with the fonts (the licence requires it)', ['OFL-Cinzel.txt', 'OFL-Montserrat.txt'].every((n) => /SIL OPEN FONT LICENSE Version 1\.1/.test(fs.readFileSync(path.join(ROOT, 'styles/fonts', n), 'utf8'))));
ok('weights: Cinzel variable axis 400-900 and Montserrat 100-900 cover every weight the UI uses (400/500/600/700), font-display: swap',
  (app.match(/weight: '400 900'/g) || []).length === 2 && (app.match(/weight: '100 900'/g) || []).length === 2 && (app.match(/display: 'swap'/g) || []).length === 4);
ok('each family has a latin AND a latin-ext face with the right unicode-range (declarations)', (app.match(/prop: 'unicode-range'/g) || []).length === 4);
const rangeOf = (name) => { const m = app.match(new RegExp("cinzel-latin-ext|" + name + "[\\s\\S]{0,260}?unicode-range', value: '([^']+)'")); return m ? m[1] : ''; };
const inRange = (range, cp) => range.split(',').some((r) => { const [lo, hi] = r.trim().replace(/U\+/g, '').split('-').map((x) => parseInt(x, 16)); return cp >= lo && cp <= (hi ?? lo); });
const extRange = (app.match(/montserrat-latin-ext\.woff2[\s\S]{0,260}?unicode-range', value: '([^']+)'/) || [])[1] || '';
const latinRange = (app.match(/montserrat-latin\.woff2[\s\S]{0,260}?unicode-range', value: '([^']+)'/) || [])[1] || '';
ok('THE RUPEE SIGN (U+20B9) is served by the latin-ext face and is NOT in the latin face — this app prints it everywhere', inRange(extRange, 0x20B9) && !inRange(latinRange, 0x20B9));
ok('plain English text, digits, "€" and curly quotes stay in the latin face', [0x41, 0x7A, 0x30, 0x39, 0x20AC, 0x2019, 0x201C].every((cp) => inRange(latinRange, cp)));
ok('the large latin-ext files are NOT preloaded (only fetched when a ₹ / accented letter is on screen)', (stripComments(app).match(/preload: false/g) || []).length === 2);
ok('adjustFontFallback is off, otherwise a metric-adjusted system font would sit between the two faces and steal the ₹ from latin-ext', (app.match(/adjustFontFallback: false/g) || []).length === 4);
ok('the family names are published as --font-cinzel / --font-montserrat on :root as a two-face stack (global, so portals inherit)',
  /const FONT_CINZEL = \`\$\{cinzelLatin\.style\.fontFamily\}, \$\{cinzelExt\.style\.fontFamily\}\`;/.test(app)
  && /const FONT_MONTSERRAT = \`\$\{montserratLatin\.style\.fontFamily\}, \$\{montserratExt\.style\.fontFamily\}\`;/.test(app)
  && /<style jsx global>\{\`\s*:root \{ --font-cinzel: \$\{FONT_CINZEL\}; --font-montserrat: \$\{FONT_MONTSERRAT\}; \}\s*\`\}<\/style>/.test(app));
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
