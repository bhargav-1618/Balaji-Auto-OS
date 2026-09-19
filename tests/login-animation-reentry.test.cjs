/**
 * tests/login-animation-reentry.test.cjs — Login cinematic boot animation re-entry fix.
 *
 * Root cause: the boot sequence used to also require sessionStorage.getItem('balaji_booted')
 * !== '1', a flag set once and never cleared. sessionStorage survives client-side navigation
 * within a tab (logout's router.push('/login') never replayed the animation) and is copied
 * verbatim into a duplicated tab per the HTML spec (a duplicate inherited the flag and never
 * got its own play). Fixed by removing that persisted-flag gate entirely — reduced-motion is
 * now the only condition, and the effect's own [] deps already scope this to mount, not
 * re-render, so every genuine entry to the login page (fresh tab, logout return, a duplicated
 * tab, a refresh) plays the full sequence once.
 */
const fs = require('fs');
const path = require('path');
let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const loginPage = fs.readFileSync(path.resolve(__dirname, '..', 'pages/login.js'), 'utf8');

console.log('\nLogin cinematic boot animation — re-entry (logout / duplicate tab / refresh)\n');

// ---- The persisted "already booted" flag is gone -------------------------------------
// Checks run against the source with line comments stripped — the fix's own explanatory
// comment names the old flag/API calls verbatim as history, which is expected and fine;
// what matters is that none of it survives as actual, live code.
const loginPageNoComments = loginPage.replace(/\/\/.*$/gm, '');
ok('sessionStorage is never read for a "balaji_booted" / "already played" flag anymore',
  !/sessionStorage\.getItem\('balaji_booted'\)/.test(loginPageNoComments));
ok('sessionStorage is never written with a "balaji_booted" flag anymore',
  !/sessionStorage\.setItem\('balaji_booted'/.test(loginPageNoComments));
ok('no "balaji_booted" key survives anywhere in login.js (fully removed, not just unused)',
  !/balaji_booted/.test(loginPageNoComments));

// ---- Reduced motion is the ONLY remaining gate ----------------------------------------
ok('the full-sequence branch is gated by reduced-motion alone, not by any persisted "first this session" check',
  /if \(!reduced\(\)\) \{\s*\n\s*setBooted\(false\);\s*\n\s*setNeedle\(true\);/.test(loginPage));
ok('the instant/skip branch still exists for reduced motion (accessibility path untouched)',
  /setBooted\(true\);\s*\/\/ reduced motion → instant, no sequence/.test(loginPage));

// ---- Mount-scoped, not render-scoped: the boot-sequence effect still has empty deps ---
{
  // Find the useEffect that contains setNeedle(true) and confirm it closes with `, []);`
  const idx = loginPage.indexOf('setNeedle(true);');
  ok('setNeedle(true) is found inside the boot-sequence effect', idx !== -1);
  const after = loginPage.slice(idx, idx + 2000);
  ok('the boot-sequence effect still closes with an empty dependency array (runs once per mount, never on re-render — this was already true before the fix and remains true)',
    /\}, \[\]\);/.test(after));
}

// ---- Needle/timing/focus choreography is untouched by this fix ------------------------
ok('the needle-unmount timing (must outlive the longest gated animation) is unchanged',
  /setTimeout\(\(\) => setNeedle\(false\), 1500\)/.test(loginPage));
ok('the post-reveal focus timer (~2.6s) is unchanged',
  /focusTimers\.push\(setTimeout\(\(\) => \{[\s\S]{0,200}\}, 2600\)\)/.test(loginPage));
ok('the reduced() helper itself (prefers-reduced-motion check) is unchanged',
  /const reduced = \(\) => typeof window !== 'undefined' && window\.matchMedia\?\.\('\(prefers-reduced-motion: reduce\)'\)\.matches;/.test(loginPage));

// ---- Guard: auth/logout paths untouched by this fix ------------------------------------
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
ok('the "remember me" saved-email prefill logic is unchanged',
  /const saved = localStorage\.getItem\('maruti_login_email'\); if \(saved\) \{ setEmail\(saved\); setRemember\(true\); prefilled = true; \}/.test(loginPage));
ok('the demo-mode sessionStorage keys (maruti_demo/maruti_demo_admin) are still cleared on mount, unrelated to the removed boot flag',
  /sessionStorage\.removeItem\('maruti_demo'\); sessionStorage\.removeItem\('maruti_demo_admin'\);/.test(loginPage));

// ---- logout is not touched by this file at all (confirms scope stayed on login.js) ----
{
  const dash = fs.readFileSync(path.resolve(__dirname, '..', 'components/InventoryDashboard.js'), 'utf8');
  ok('logout still routes via router.push(\'/login\') (client-side nav, unchanged) — this file no longer needs a matching sessionStorage.removeItem for a boot flag that no longer exists',
    /await signOut\(auth\);[\s\S]{0,600}router\.push\('\/login'\);/.test(dash));
}

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
if (FAIL) process.exit(1);
