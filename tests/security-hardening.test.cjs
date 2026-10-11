/**
 * tests/security-hardening.test.cjs — security audit, Stage 2
 *
 * Fast source guards for the hardening that does NOT need the emulator. The behaviour of the
 * Firestore rules themselves is proven by tests/rules/staff-allowlist.rules.test.cjs
 * (needs the emulator: `npm run test:rules`).
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

console.log('\nSEC-06 — clickjacking protection in both header forms\n');
const cfg = read('next.config.js');
ok("CSP carries frame-ancestors 'self' (modern form)", /"frame-ancestors 'self'"/.test(cfg));
ok("X-Frame-Options SAMEORIGIN is still sent (older browsers)", /X-Frame-Options', value: 'SAMEORIGIN'/.test(cfg));
ok("the CSP still forbids plugins and base-uri / form-action hijacking", /"object-src 'none'"/.test(cfg) && /"base-uri 'self'"/.test(cfg) && /"form-action 'self'"/.test(cfg));
ok("production CSP never allows unsafe-eval (it is dev-only)", /isDev \? "'unsafe-eval'" : ''/.test(cfg));
ok('HSTS is preload-length with subdomains', /max-age=63072000; includeSubDomains; preload/.test(cfg));

console.log('\nSEC-02 / SEC-03 — rules: opt-in staff allowlist + verified email\n');
const rules = read('firestore.rules');
ok('the raw "has an Auth account" check is now authed(); signedIn() — used by every data rule — is the staff-aware check', /function authed\(\)\s*\{\s*return request\.auth != null;/.test(rules) && /function signedIn\(\)\s*\{\s*return authed\(\) && verifiedOk\(\)/.test(rules));
ok('signedIn() honours the optional allowlist and always lets the owner and admins in',
  /function signedIn\(\)[\s\S]{0,700}!allowlistOn\(\)[\s\S]{0,300}userEmail\(\) == ownerEmail\(\)[\s\S]{0,300}rolesDoc\(\)\.admins/.test(rules));
ok('the data rules were NOT rewritten: they still say "if signedIn()" (so the existing rule-shape tests stay valid)', (rules.match(/if signedIn\(\)/g) || []).length >= 30);
ok('an EMPTY or malformed allowedEmails means "off" (cannot lock everyone out by accident)', /rolesDoc\(\)\.allowedEmails is list\s*\n\s*&& rolesDoc\(\)\.allowedEmails\.size\(\) > 0/.test(rules));
ok('verified-email gate: a missing email_verified claim is treated as unverified', /\('email_verified' in request\.auth\.token\) && request\.auth\.token\.email_verified == true/.test(rules));
ok('isAdmin() applies the verified-email gate as well (via the raw authed() check, so there is no recursion)', /function isAdmin\(\)\s*\{\s*return authed\(\) && verifiedOk\(\)/.test(rules) && /return authed\(\) && request\.auth\.token\.email != null/.test(rules));
ok('the default is OFF: both switches are read from appSettings/roles, which only admins can write', /match \/appSettings\/\{docId\}[\s\S]{0,200}allow create, update: if isAdmin\(\)/.test(rules));
ok('the catch-all still denies everything not explicitly allowed', /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/.test(rules));
ok('the owner email in the rules matches BOOTSTRAP_ADMINS in the app (they must stay in sync)',
  (rules.match(/return '([^']+)';/) || [])[1] === (read('context/AuthContext.js').match(/BOOTSTRAP_ADMINS = \[\s*'([^']+)'/) || [])[1]);
ok('the new emulator test file exists and is picked up by the rules runner (*.test.cjs)', fs.existsSync(path.join(ROOT, 'tests/rules/staff-allowlist.rules.test.cjs')));

console.log('\nSEC-08 — patched transitive dependencies\n');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const ver = (n) => lock.packages[`node_modules/${n}`]?.version;
const gte = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return true; };
ok(`dompurify is pinned past the GHSA-p98j / GHSA-6688 range (<=3.4.15); installed ${ver('dompurify')}`, gte(ver('dompurify'), '3.4.16') && /3\.4\.16/.test(pkg.overrides.dompurify));
ok(`source-map-js is past GHSA-68fv-2mgg-jv7q (<=1.2.1); installed ${ver('source-map-js')}`, gte(ver('source-map-js'), '1.2.2') && /1\.2\.2/.test(pkg.overrides['source-map-js']));
ok('no dependency was added: runtime dependencies are unchanged', Object.keys(pkg.dependencies).sort().join() === 'firebase,jspdf,lucide-react,next,qrcode,react,react-dom,react-hot-toast,xlsx');

console.log('\nsecrets hygiene\n');
ok('.env files are git-ignored', /^\.env\.local$/m.test(read('.gitignore')) && /^\.env$/m.test(read('.gitignore')));
ok('the example env file holds placeholders only (no real-looking keys)', !/AIza[0-9A-Za-z_-]{35}/.test(read('.env.local.example')) && /your_/.test(read('.env.local.example')));
ok('the app refuses to start without its Firebase config (fails closed, names the missing keys)', /MISSING_ENV\.length/.test(read('lib/firebase.js')));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
