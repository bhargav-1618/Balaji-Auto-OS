/**
 * tests/login-outro-probe-gated.test.cjs
 *
 * The login page's optional "outro" departure video was detected at runtime with
 * `fetch('/outro.mp4', { method: 'HEAD' })` on every single page load. This
 * deployment ships no public/outro.mp4 at all, so that probe was a guaranteed,
 * permanent 404 on every login — not a real error, just a network call checking
 * for a file that will never exist here.
 *
 * Fix: gate the probe behind NEXT_PUBLIC_HAS_OUTRO_VIDEO (unset by default, since
 * the file isn't present). Unset, the probe never fires and `hasOutro` stays at
 * its existing `false` default — the exact outcome the HEAD request always
 * resolved to anyway, just without the network round-trip/404. A deployment that
 * DOES add the file can set the env var to opt back into detecting it.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../pages/login.js'), 'utf8');

console.log('\nLogin — outro.mp4 existence probe is env-gated (no more guaranteed 404)\n');

ok('OUTRO_VIDEO_AVAILABLE reads NEXT_PUBLIC_HAS_OUTRO_VIDEO, defaulting to unavailable when unset',
  /const OUTRO_VIDEO_AVAILABLE = process\.env\.NEXT_PUBLIC_HAS_OUTRO_VIDEO === '1';/.test(src));
ok('the HEAD probe only fires when the feature is explicitly enabled — no unconditional fetch(\'/outro.mp4\') left over',
  /if \(OUTRO_VIDEO_AVAILABLE\) fetch\('\/outro\.mp4', \{ method: 'HEAD' \}\)\.then\(\(r\) => setHasOutro\(r\.ok\)\)\.catch\(\(\) => setHasOutro\(false\)\);/.test(src)
  && !/^\s*fetch\('\/outro\.mp4'/m.test(src));
ok('hasOutro still defaults to false — a disabled probe reproduces exactly the outcome the always-404ing HEAD request already produced, not a new behaviour',
  /const \[hasOutro, setHasOutro\] = useState\(false\);/.test(src));
ok('the success handler is untouched — hasOutro=false still falls straight through to the plain redirect, never touching the video path',
  /if \(hasOutro\) setOutro\(true\);\s*\n\s*else window\.location\.href = href;/.test(src));
ok('the <video> element itself (still src="/outro.mp4") is untouched — re-enabling the feature later needs no player changes, only the env var + the actual file',
  /<video\s*\n\s*ref=\{outroRef\} src="\/outro\.mp4" autoPlay muted playsInline/.test(src));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
