/**
 * tests/verify-page.test.cjs — security audit, SEC-04
 *
 * Renders the REAL pages/verify.js with a controllable router and a controllable record lookup.
 * The page must:
 *   - show details from the workshop's record (with "matches the workshop's records") for a valid id;
 *   - say plainly when it couldn't check (network) vs when the document does not exist;
 *   - NEVER present a self-describing LEGACY link as confirmed — always "NOT VERIFIED", never green/paid;
 *   - ignore every legacy parameter when an id is present (an attacker can't append a forged status);
 *   - render hostile text as text.
 */
require('./setup.cjs');
const React = require('react');
const path = require('path');
const fs = require('fs');
const { render, cleanup, waitFor, fireEvent } = require('@testing-library/react');

let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };

// ---- stubs injected BEFORE the page is loaded ------------------------------------------------
const router = { isReady: true, query: {} };
let lookupImpl = async () => ({ state: 'notfound' });
const lookups = [];
const stubModule = (resolved, exports) => { require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports }; };
stubModule(require.resolve('next/router'), { useRouter: () => router });
stubModule(require.resolve('../lib/verificationClient.js'), { lookupVerificationRecord: (id) => { lookups.push(id); return lookupImpl(id); } });
const VerifyPage = require('../pages/verify.js').default;

const GOOD = 'ab12cd34ef56ab12cd34ef56ab12cd34';
const record = (extra = {}) => ({ state: 'ok', record: { kind: 'invoice', docNo: 'INV-0042', date: '2026-10-11', status: 'Paid', total: 5900, updatedAtMs: Date.UTC(2026, 9, 11), ...extra } });
const show = (query, ready = true) => { cleanup(); lookups.length = 0; router.isReady = ready; router.query = query; return render(React.createElement(VerifyPage)); };
const text = (r) => r.container.textContent;
const settle = (r, re) => waitFor(() => { if (!re.test(text(r))) throw new Error('not yet: ' + text(r).slice(0, 120)); }, { timeout: 3000 });

(async () => {
  console.log('\nnew link: /verify?id=<record id>\n');
  lookupImpl = async () => record();
  let r = show({ id: GOOD });
  ok('while looking up it says it is checking (no flash of wrong content)', /Checking with the workshop/.test(text(r)));
  await settle(r, /Matches the workshop/);
  ok('a valid record shows the document number, date, amount and status from the record', /INV-0042/.test(text(r)) && /2026-10-11/.test(text(r)) && /₹5,900\.00/.test(text(r)) && /PAID/.test(text(r)));
  ok('it says the details match the workshop\'s records', /Matches the workshop’s records/.test(text(r)));
  ok('it tells the customer the status is "as of" a date and to check the balance with the workshop', /as of 11 Oct 2026/.test(text(r)) && /contact the workshop/i.test(text(r)));
  ok('the page asked for exactly that id, once', lookups.length === 1 && lookups[0] === GOOD);
  ok('no customer / vehicle rows exist on the verified page (minimal public data)', !/Customer|Vehicle/.test(text(r)));

  lookupImpl = async () => record({ kind: 'jobcard', docNo: 'JC-0007', status: 'Ready for delivery', total: null });
  r = show({ id: GOOD }); await settle(r, /JC-0007/);
  ok('a job card shows "Job Card No." and omits the amount row when there is none', /Job Card No\./.test(text(r)) && !/Amount/.test(text(r)));
  ok('a not-paid status is NOT styled as confirmed-good (amber, not green)', (() => {
    const b = [...r.container.querySelectorAll('span')].find((s) => /READY FOR DELIVERY/.test(s.textContent));
    return !!b && /251, ?191, ?36/.test(b.style.color) && !/52, ?211, ?153/.test(b.style.color);
  })());

  lookupImpl = async () => ({ state: 'notfound' });
  r = show({ id: GOOD }); await settle(r, /couldn’t find this document/);
  ok('an unknown id says it was not found and warns not to rely on the link', /couldn’t find this document/.test(text(r)) && /do not rely on it/.test(text(r)) && !!r.container.querySelector('[role="alert"]'));

  r = show({ id: 'abc' });
  await settle(r, /couldn’t find this document/);
  ok('a malformed id is "not found" WITHOUT querying the database', lookups.length === 0);
  r = show({ id: GOOD.toUpperCase() }); await settle(r, /couldn’t find this document/);
  ok('an uppercase id is rejected locally too', lookups.length === 0);
  r = show({ id: ['x', GOOD] }); await settle(r, /couldn’t find this document/);
  ok('a repeated ?id=…&id=… parameter (array) is not treated as valid', lookups.length === 0);

  let attempts = 0;
  lookupImpl = async () => { attempts += 1; if (attempts === 1) throw new Error('offline'); return record(); };
  r = show({ id: GOOD }); await settle(r, /Couldn’t check right now/);
  ok('a lookup failure says it COULDN\'T CHECK — it does not claim the document is fake', /not a result about your document/.test(text(r)) && !/couldn’t find this document/.test(text(r)));
  fireEvent.click(r.container.querySelector('button'));
  await settle(r, /Matches the workshop/);
  ok('"Try again" retries and then shows the record', attempts === 2 && /INV-0042/.test(text(r)));

  console.log('\nattacker-edited links\n');
  lookupImpl = async () => ({ state: 'notfound' });
  r = show({ id: GOOD, no: 'INV-9999', c: 'Victim', t: '999999', s: 'Paid' }); await settle(r, /couldn’t find this document/);
  ok('legacy parameters appended to an id link are IGNORED (cannot forge details onto a real/unknown id)', !/INV-9999|Victim|999,999|PAID/.test(text(r)));
  lookupImpl = async () => record();
  r = show({ id: GOOD, no: 'INV-9999', c: 'Victim', t: '999999', s: 'Overdue' }); await settle(r, /Matches the workshop/);
  ok('...and a real record is shown from the record, not from the extra parameters', /INV-0042/.test(text(r)) && !/INV-9999|Victim|999,999|Overdue/.test(text(r)));

  console.log('\nlegacy links (already printed / offline / demo)\n');
  r = show({ no: 'INV-0004', c: 'Ramesh', v: 'AP31AB1234', d: '2026-09-07', t: '5900', s: 'Paid' });
  ok('a legacy link is shown under a prominent NOT VERIFIED notice', /NOT VERIFIED/.test(text(r)) && !!r.container.querySelector('[role="alert"]'));
  ok('...it never says it matches the workshop\'s records', !/Matches the workshop/.test(text(r)));
  ok('...and a forged "Paid" is NOT styled as a confirmed-paid badge (no green pill at all)', ![...r.container.querySelectorAll('span')].some((s) => /PAID/.test(s.textContent)) && !/52, ?211, ?153|34d399/i.test(r.container.innerHTML.replace(/Matches[^<]*/, '')));
  ok('the details from the link are still shown (the old links keep working) and the database is not queried', /INV-0004/.test(text(r)) && /Ramesh/.test(text(r)) && /AP31AB1234/.test(text(r)) && lookups.length === 0);
  ok('it tells people to confirm with the workshop before paying', /confirm this document with the workshop before paying/.test(text(r)));
  r = show({ no: 'INV-1', c: '<img src=x onerror=alert(1)>', s: '<script>alert(1)</script>', v: '"><svg onload=alert(1)>' });
  ok('hostile text in a legacy link is rendered as TEXT (no element injected)', !r.container.querySelector('img') && !r.container.querySelector('script') && !r.container.querySelector('svg') && /<img src=x/.test(text(r)));
  lookupImpl = async () => record({ docNo: '<b onmouseover=alert(1)>x</b>', status: '<img src=x>' });
  r = show({ id: GOOD }); await settle(r, /Matches the workshop/);
  ok('hostile text inside a STORED record is rendered as text too', !r.container.querySelector('img') && !r.container.querySelector('b'));

  console.log('\nother states\n');
  r = show({});
  ok('a bare /verify says there is nothing to verify', /Nothing to verify/.test(text(r)));
  r = show({}, false);
  ok('before the router is ready it shows a neutral placeholder (not a flash of "nothing to verify")', /Checking…/.test(text(r)) && !/Nothing to verify/.test(text(r)));
  const src = fs.readFileSync(path.resolve(__dirname, '../pages/verify.js'), 'utf8');
  ok('it waits for the first client mount as well as the router (avoids a React hydration mismatch on a bare /verify)', /const \[mounted, setMounted\] = useState\(false\);\s*\n\s*useEffect\(\(\) => \{ setMounted\(true\); \}, \[\]\);\s*\n\s*const ready = mounted && router\.isReady;/.test(fs.readFileSync(path.resolve(__dirname, '../pages/verify.js'), 'utf8')));
  ok('the page is noindex and sends no Referer (the id is in the URL)', /robots" content="noindex"/.test(src) && /name="referrer" content="no-referrer"/.test(src));

  cleanup();
  console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
