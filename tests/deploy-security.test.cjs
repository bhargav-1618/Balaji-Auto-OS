/**
 * tests/deploy-security.test.cjs — PART-6.3
 *
 * Deployment / codebase security hygiene. What's checkable from the repo:
 * no committed secrets, env-based Firebase config, baseline security headers.
 * (Live-URL items — published rules, owner password, HTTPS — are runtime/console
 * state and are called out in the audit, not asserted here.)
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const R = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nPART-6.3 — deployment & codebase security hygiene\n');

// secrets
const gi = R('.gitignore');
ok('.env.local is gitignored', /\.env\.local/.test(gi));
const fb = R('lib/firebase.js');
ok('Firebase config reads from env, no hardcoded apiKey literal',
  /apiKey: process\.env\.NEXT_PUBLIC_FIREBASE_API_KEY/.test(fb) && !/apiKey:\s*['"]AIza/.test(fb));
ok('config fails fast with an actionable error when env is missing',
  /MISSING_ENV/.test(fb) && /throw new Error/.test(fb));
ok('.env.local.example holds placeholders, not real keys',
  /your_api_key_here/.test(R('.env.local.example')) && !/AIza/.test(R('.env.local.example')));

// no committed secrets anywhere in source
let leaked = [];
for (const f of ['components/InventoryDashboard.js', 'lib/firebase.js', 'context/AuthContext.js']) {
  if (/AIza[0-9A-Za-z_-]{30,}/.test(R(f))) leaked.push(f);
}
ok('no Google API key literal committed in source', leaked.length === 0, leaked.join(', '));

// security headers
const nc = R('next.config.js');
for (const h of ['X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Strict-Transport-Security', 'Permissions-Policy']) {
  ok(`security header set: ${h}`, new RegExp(h).test(nc));
}
ok('security headers apply to all routes (/:path*)', /source: '\/:path\*'/.test(nc));
ok('camera permission matches actual usage (job-card photo capture)',
  /camera=\(self\)/.test(nc) && /capture="environment"/.test(R('components/jobcards/JobCardModule.jsx')));

// deployability (from 6.1)
ok('firebase.json exists for CLI rule deploy', fs.existsSync(path.resolve(__dirname, '../firebase.json')));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
