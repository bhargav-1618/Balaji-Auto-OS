/**
 * tests/login-diagnostic-boot.test.cjs
 *
 * Adds a "diagnostic scan" beat to the login boot sequence, filling what was
 * previously a ~300-400ms gap where the sign-in card's outline had appeared
 * (via cardIn) but its content (logo, fields) hadn't started fading in yet —
 * an empty rounded rectangle that read as a loading glitch, not a deliberate
 * choreography step. Also adds a distinct "power pulse" radial flash at the
 * very start of the sequence, preceding the existing needle sweep.
 *
 * This is presentation-only, additive work: no auth logic changed. This test
 * verifies (a) the new pieces exist and are wired correctly, (b) they're
 * properly decorative (aria-hidden, no auth involvement), (c) reduced-motion
 * kills them exactly like every other boot element, and (d) the existing
 * Firebase auth call path in pages/login.js is untouched.
 */
const fs = require('fs');
const path = require('path');
let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nLogin diagnostic-boot sequence (power pulse + diagnostic scan)\n');

const scan = read('components/login/DiagnosticScan.jsx');
const card = read('components/login/SignInCard.jsx');
const loginPage = read('pages/login.js');
const css = read('styles/login.module.css');

// ---- DiagnosticScan is purely decorative, no auth/state involvement -------------
ok('DiagnosticScan takes no props (purely decorative, no auth wiring)',
  /export default function DiagnosticScan\(\)/.test(scan));
ok('DiagnosticScan is aria-hidden (decorative, not announced to screen readers)',
  /<div className=\{styles\.diagnosticScan\} aria-hidden="true">/.test(scan));
ok('DiagnosticScan renders the scan line and two HUD status lines',
  /styles\.scanLine/.test(scan) && /styles\.scanStatus1/.test(scan) && /styles\.scanStatus2/.test(scan));

// ---- Wired into SignInCard, only during the full boot sequence ------------------
ok('SignInCard imports DiagnosticScan',
  /import DiagnosticScan from '\.\/DiagnosticScan';/.test(card));
ok('DiagnosticScan only renders during the full sequence (never on a returning-visit instant load)',
  /\{!instant && <DiagnosticScan \/>\}/.test(card));

// ---- Power pulse wired into the scene, gated by the same `needle` state as the
//    existing sweep (so it only ever plays once, on first visit, same as the
//    element it precedes). ---------------------------------------------------------
ok('Power pulse renders in the scene, gated by the same `needle` boot flag as the existing sweep',
  /\{needle && <div className=\{`\$\{styles\.powerPulse\} \$\{styles\.powerPulseOn\}`\} aria-hidden="true" \/>\}/.test(loginPage));

// ---- CSS: keyframes exist, timed to close the gap (card content starts at 1.30s,
//    so the scan must fully resolve at or before that). -----------------------------
ok('powerPulse keyframe exists (opacity-only radial flash)',
  /@keyframes powerPulse \{[\s\S]{0,150}opacity: 0;[\s\S]{0,150}opacity: 1;[\s\S]{0,150}opacity: 0;/.test(css));
ok('scanSweep keyframe exists (transform+opacity only, no layout properties)',
  /@keyframes scanSweep \{[\s\S]{0,300}transform: translateY/.test(css));
ok('the diagnostic scan fades out at 1.15s — before the card\'s real content starts revealing at 1.30s',
  /\.seqFull \.diagnosticScan \{\s*animation: scanFadeOut 0\.3s ease-in 1\.15s forwards;/.test(css));

// ---- Reduced motion kills both new elements, same as every existing boot element ---
ok('prefers-reduced-motion kills both the power pulse and the diagnostic scan',
  /@media \(prefers-reduced-motion: reduce\) \{[\s\S]{0,400}\.powerPulse, \.diagnosticScan \{ display: none !important; \}/.test(css));

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

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
