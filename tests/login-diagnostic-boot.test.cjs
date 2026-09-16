/**
 * tests/login-diagnostic-boot.test.cjs
 *
 * The login boot sequence is a choreographed cinematic sequence over a real photographic
 * environment (public/images/login-hero.jpg, Unsplash License): camera settle + mouse
 * parallax for depth, a CAUSAL lighting chain (electrical flicker → needle catches light
 * → headlight bloom rises → floor spill → console receives power) rather than independent
 * glows, focus-reactive fields, and cosmetic submit-state text cycling — all via CSS
 * keyframes/delays or cheap transform-only JS, no new dependency, no JS animation timeline.
 * The RPM/KM-H/SYS instrument strip (SystemInstruments) was removed after a composition
 * review found it floating disconnected above the console, pushing the console down for
 * no gain — this file guards that removal too.
 *
 * This is presentation-only work: no auth logic changed. This test verifies (a) the photo
 * asset and its license are present, (b) the causal-lighting and camera/parallax elements
 * exist and are properly decorative/gated, (c) reduced-motion kills every one of them,
 * and (d) the existing Firebase auth call path in pages/login.js is untouched.
 */
const fs = require('fs');
const path = require('path');
let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nLogin cinematic boot sequence (camera, causal lighting, instruments)\n');

const scan = read('components/login/DiagnosticScan.jsx');
const card = read('components/login/SignInCard.jsx');
const wordmark = read('components/login/Wordmark.jsx');
const ignitionBtn = read('components/login/IgnitionButton.jsx');
const loginPage = read('pages/login.js');
const css = read('styles/login.module.css');

// ---- The photo asset exists and carries a documented, permissive license ------------
ok('public/images/login-hero.jpg exists',
  fs.existsSync(path.resolve(__dirname, '..', 'public/images/login-hero.jpg')));
ok('the photo\'s license is documented in docs/ATTRIBUTIONS.md',
  fs.existsSync(path.resolve(__dirname, '..', 'docs/ATTRIBUTIONS.md')) &&
  /Unsplash License/.test(read('docs/ATTRIBUTIONS.md')));
ok('login.js uses next/image with fill + priority (LCP element, gets responsive/format optimization)',
  /<Image[\s\S]{0,200}src="\/images\/login-hero\.jpg"[\s\S]{0,200}fill[\s\S]{0,200}priority/.test(loginPage));

// ---- Camera settle + mouse parallax (depth, not a flat scale(1.02)) -------------------
ok('the photo starts zoomed AND panned and eases to rest — an autonomous push-and-pan that runs regardless of mouse movement, not a flat scale(1.02) or a mouse-only effect',
  /@keyframes cameraSettle \{[\s\S]{0,150}scale\(1\.12\) translate\(1\.6%, 1\.1%\)[\s\S]{0,150}scale\(1\) translate\(0%, 0%\)/.test(css));
ok('the environment layer and the console move by DIFFERENT amounts on mouse parallax (that differential is what reads as depth)',
  /\.heroParallax[\s\S]{0,100}translate3d\(calc\(var\(--px, 0\) \* 20px\)/.test(css) &&
  /\.console[\s\S]{0,600}translate3d\(calc\(var\(--px, 0\) \* -6px\)/.test(css));
ok('the parallax effect writes --px/--py once per animation frame (rAF-throttled), not once per pointermove event',
  /if \(!raf\) raf = requestAnimationFrame\(flush\)/.test(loginPage));
ok('parallax is skipped on touch devices and under reduced motion (no pointer to track / no unnecessary movement)',
  /pointer: coarse[\s\S]{0,400}reduced\(\)/.test(loginPage));

// ---- Causal lighting chain: each beat is a consequence of the one before it -----------
ok('the headlight bloom has a real electrical-flicker stage before its main rise (not a single flat fade-in)',
  /@keyframes bloomOn \{[\s\S]{0,400}flicker 1[\s\S]{0,300}flicker 2/.test(css));
ok('the floor spill exists and is gated by the same `needle` flag as the bloom (a consequence of it, same lifetime)',
  /\{needle && <div className=\{styles\.floorSpillOn\} aria-hidden="true" \/>\}/.test(loginPage));
ok('the floor spill starts only after the bloom\'s real rise has landed (later delay than bloomOn\'s start)',
  (() => {
    const bloom = css.match(/\.seqFull \.headlightBloomOn \{ animation: bloomOn [\d.]+s ease-out ([\d.]+)s/);
    const spill = css.match(/\.seqFull \.floorSpillOn \{ animation: spillIn [\d.]+s ease-out ([\d.]+)s/);
    return !!bloom && !!spill && parseFloat(spill[1]) > parseFloat(bloom[1]);
  })());
ok('the console receives a "power" pulse (border/shadow) after it has already appeared, combined with cardIn on the same element (not a conflicting second animation rule)',
  /\.seqFull \.revealCard \{ opacity: 0; animation: cardIn [\d.]+s[\s\S]{0,60}, consolePulse/.test(css));
ok('needle/bloom/floor-spill are unmounted only after their longest animation (floor spill) has finished, not mid-flight',
  /setTimeout\(\(\) => setNeedle\(false\), 1500\)/.test(loginPage));

// ---- DiagnosticScan is purely decorative, no auth/state involvement -------------
ok('DiagnosticScan takes no props (purely decorative, no auth wiring)',
  /export default function DiagnosticScan\(\)/.test(scan));
ok('DiagnosticScan is aria-hidden (decorative, not announced to screen readers)',
  /<div className=\{styles\.diagnosticScan\} aria-hidden="true">/.test(scan));
ok('SignInCard imports DiagnosticScan and only renders it during the full sequence',
  /import DiagnosticScan from '\.\/DiagnosticScan';/.test(card) &&
  /\{!instant && <DiagnosticScan \/>\}/.test(card));
ok('SignInCard no longer duplicates the brand block (Wordmark is the single brand heading now)',
  !/SRI BABA BALAJI MARUTI CARE/.test(card));

// ---- Wordmark carries the one consolidated brand block ---------------------------------
ok('Wordmark renders the brand icon and both the product name and business name',
  /brandIcon/.test(wordmark) && /BALAJI/.test(wordmark) && /Sri Baba Balaji Maruti Care/.test(wordmark));

// ---- Instrument strip removed: no dead component, no import, no orphaned CSS ---------
ok('AutomotiveHud was consolidated into SystemInstruments and never left behind',
  !fs.existsSync(path.resolve(__dirname, '..', 'components/login/AutomotiveHud.jsx')));
ok('SystemInstruments (RPM/KM-H/SYS strip) was removed entirely, not just unmounted — it floated disconnected above the console and pushed it down for no compositional gain',
  !fs.existsSync(path.resolve(__dirname, '..', 'components/login/SystemInstruments.jsx')));
ok('login.js no longer imports or renders SystemInstruments',
  !/SystemInstruments/.test(loginPage));
ok('the instrument-strip CSS (.statRow/.statChip/.statBar/.hud/.hudLine and their keyframes) was removed, not left orphaned',
  !/\.statRow|\.statChip|\.statBar|statSweep|\.hudLine|hudLineCycle/.test(css));

// ---- Focus-reactive fields: "the system becomes active" ------------------------------
ok('a field reacts on focus with a one-shot scan sweep, scoped to the input box only — NOT the outer wrapper that also holds the label (clipping that wrapper malformed the label\'s first letter against its own border-radius)',
  /\.fieldBox:focus-within::after \{ animation: fieldScan/.test(css) && !/\.fieldWrap \{[^}]*overflow/.test(css));

// ---- Submit-state text cycling: cosmetic only, never gates the real auth call ---------
ok('the submit button cycles AUTHENTICATING → VERIFYING while loading, purely cosmetic (keyed on the existing `loading` prop, not a fake timer that blocks anything)',
  /const PHASES = \['AUTHENTICATING', 'VERIFYING'\];/.test(ignitionBtn) &&
  /if \(!loading\) \{ setPhase\(0\); return undefined; \}/.test(ignitionBtn));

// ---- CSS: scanSweep keyframe unchanged in shape (transform+opacity only) -------------
ok('scanSweep keyframe exists (transform+opacity only, no layout properties)',
  /@keyframes scanSweep \{[\s\S]{0,300}transform: translateY/.test(css));

// ---- Reduced motion kills every boot-only / motion element, same treatment across the board
ok('prefers-reduced-motion kills the needle, headlight bloom, floor spill and diagnostic scan',
  /@media \(prefers-reduced-motion: reduce\) \{[\s\S]{0,700}\.needle \{ display: none !important; \}[\s\S]{0,300}\.headlightBloomOn, \.floorSpillOn, \.diagnosticScan \{ display: none !important; \}/.test(css));
ok('prefers-reduced-motion forces the hero photo to its final visible, unscaled state (no fade-in, no camera settle)',
  /@media \(prefers-reduced-motion: reduce\) \{[\s\S]{0,300}\.heroPhoto \{ opacity: 1 !important; transform: none !important; animation: none !important; \}/.test(css));
ok('prefers-reduced-motion disables the parallax transform on both layers (no unnecessary movement)',
  /@media \(prefers-reduced-motion: reduce\) \{[\s\S]{0,400}\.heroParallax, \.console \{ transform: none !important; transition: none !important; \}/.test(css));
ok('prefers-reduced-motion disables the field focus-scan',
  /@media \(prefers-reduced-motion: reduce\) \{[\s\S]{0,900}\.fieldBox::after \{ display: none !important; \}/.test(css));

// ---- Guard: no auth/error/redirect logic was touched -------------------------------
ok('Firebase signInWithEmailAndPassword call is unchanged',
  /await signInWithEmailAndPassword\(auth, email, password\);/.test(loginPage));
ok('the demo-login shortcut is unchanged',
  /em === 'demo@balajiautoos\.com' && password === 'Demo@123'/.test(loginPage));
ok('the error-mapping switch (wrong credentials / too-many-requests / generic) is unchanged',
  /err\.code === 'auth\/invalid-credential' \? 'Wrong email or password'/.test(loginPage));
ok('the re-entry submit guard (submitting ref) is unchanged',
  /if \(submitting\.current\) return;\s*\n\s*submitting\.current = true;/.test(loginPage));
ok('setPersistence (remember-me) call is unchanged',
  /await setPersistence\(auth, remember \? browserLocalPersistence : browserSessionPersistence\);/.test(loginPage));
ok('the IgnitionButton\'s cosmetic text cycling never disables the button independently of the real `loading` state (still `disabled={loading}`)',
  /disabled=\{loading\}/.test(ignitionBtn));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
