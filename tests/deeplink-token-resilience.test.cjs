/**
 * tests/deeplink-token-resilience.test.cjs
 *
 * Root-cause regression guard for "clicking a Job Card from Customer Details opens a
 * new page without loading the selected Job Card" (and the identical customer deep-link
 * defect in Vehicles -> Customers, and the identical invoice deep-link defect in
 * Customers/Vehicles -> Billing).
 *
 * JobCardModule, CustomersModule, and BillingModule each hand off a one-shot token via
 * localStorage (maruti_jobcard_open / maruti_customer_open / maruti_invoice_open) to the
 * new tab. The token used to be READ AND IMMEDIATELY REMOVED on the component's very first
 * render, before the target list (savedCards / customers / invoices) had even loaded from
 * Firestore/demo data. That's a one-shot
 * read with no protection against the component mounting more than once before the data
 * arrives — which React Strict Mode deliberately does in development (mount -> cleanup ->
 * mount again), and which ordinary render races can also cause in production. The FIRST
 * (often throwaway) mount silently consumed and deleted the token; by the time the
 * surviving mount's effect ran with the list actually loaded, the token was already gone,
 * so the correct "retry once data arrives" logic had nothing left to retry with, landing
 * on a blank record.
 *
 * The fix: clear the token only once it is actually RESOLVED (found, or confirmed absent
 * from a fully-loaded list) — never on the initial read.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };

console.log('\nDeep-link one-shot token resilience (Job Cards + Customers + Billing)\n');

const jc = fs.readFileSync(path.resolve(__dirname, '../components/jobcards/JobCardModule.jsx'), 'utf8');
const cm = fs.readFileSync(path.resolve(__dirname, '../components/customers/CustomersModule.jsx'), 'utf8');
const bm = fs.readFileSync(path.resolve(__dirname, '../components/billing/BillingModule.jsx'), 'utf8');

// --- Job Cards: maruti_jobcard_open ---
{
  const start = jc.indexOf("pendingJobOpen = useRef(null)");
  const block = jc.slice(start, start + 2000);
  ok('JobCardModule: initial read does NOT also remove the token in the same statement',
    !/localStorage\.getItem\('maruti_jobcard_open'\) \|\| ''; localStorage\.removeItem\('maruti_jobcard_open'\)/.test(block));
  ok('JobCardModule: token is removed on the SUCCESS path (match found)',
    /if \(match\) \{[\s\S]{0,200}localStorage\.removeItem\('maruti_jobcard_open'\)/.test(block));
  ok('JobCardModule: token is also removed on the "loaded but not found" resolved path',
    /else if \(\(savedCards \|\| \[\]\)\.length\) \{[\s\S]{0,400}localStorage\.removeItem\('maruti_jobcard_open'\)/.test(block));
}

// --- Customers: maruti_customer_open (identical pattern, fixed identically) ---
{
  const start = cm.indexOf("pendingCustOpen = useRef(null)");
  const block = cm.slice(start, start + 1400);
  ok('CustomersModule: initial read does NOT also remove the token in the same statement',
    !/localStorage\.getItem\('maruti_customer_open'\) \|\| ''; localStorage\.removeItem\('maruti_customer_open'\)/.test(block));
  ok('CustomersModule: token is removed on the SUCCESS path (match found)',
    /if \(match\) \{[\s\S]{0,200}localStorage\.removeItem\('maruti_customer_open'\)/.test(block));
  ok('CustomersModule: token is also removed on the "loaded but not found" resolved path',
    /else if \(customers\.length\) \{[\s\S]{0,200}localStorage\.removeItem\('maruti_customer_open'\)/.test(block));
}

// --- Billing: maruti_invoice_open (identical pattern, fixed identically) ---
{
  const start = bm.indexOf("pendingInvOpen = useRef(null)");
  const block = bm.slice(start, start + 1400);
  ok('BillingModule: initial read does NOT also remove the token in the same statement',
    !/localStorage\.getItem\('maruti_invoice_open'\) \|\| ''; localStorage\.removeItem\('maruti_invoice_open'\)/.test(block));
  ok('BillingModule: token is removed on the SUCCESS path (match found)',
    /if \(match\) \{[\s\S]{0,200}localStorage\.removeItem\('maruti_invoice_open'\)/.test(block));
  ok('BillingModule: token is also removed on the "loaded but not found" resolved path',
    /else if \(\(invoices \|\| \[\]\)\.length\) \{[\s\S]{0,400}localStorage\.removeItem\('maruti_invoice_open'\)/.test(block));
}

// --- Behavioural mirror: simulate a throwaway first mount (Strict Mode) followed by the
// surviving mount, and confirm the FIXED read/resolve pattern survives it while the OLD
// pattern would not. ---
{
  // OLD (buggy) pattern: read-and-clear on first render, regardless of whether data has
  // loaded yet.
  function simulateOldPattern(savedCardsAtEachMount) {
    const store = { maruti_jobcard_open: 'SBBMC301' };
    let card = null;
    savedCardsAtEachMount.forEach((savedCards) => {
      // "mount": render-time read-and-clear
      let pending = store.maruti_jobcard_open || '';
      delete store.maruti_jobcard_open;
      // effect
      if (pending) {
        const match = savedCards.find((c) => c.jobNo === pending);
        if (match) card = match;
      }
    });
    return card;
  }
  // FIXED pattern: read only (no clear) on mount; clear only once resolved.
  function simulateFixedPattern(savedCardsAtEachMount) {
    const store = { maruti_jobcard_open: 'SBBMC301' };
    let card = null;
    let done = false;
    savedCardsAtEachMount.forEach((savedCards) => {
      const pending = store.maruti_jobcard_open || '';
      if (!pending || done) return;
      const match = savedCards.find((c) => c.jobNo === pending);
      if (match) { card = match; done = true; delete store.maruti_jobcard_open; }
      else if (savedCards.length) { done = true; delete store.maruti_jobcard_open; }
    });
    return card;
  }
  const target = { jobNo: 'SBBMC301', customer: 'Anitha' };
  // First "mount" happens before data has loaded (savedCards = []); second (surviving)
  // mount happens after data has loaded — exactly the Strict Mode / render-race scenario.
  const mounts = [[], [target]];

  ok('OLD pattern (read-and-clear on render): loses the record across a throwaway remount',
    simulateOldPattern(mounts) === null);
  ok('FIXED pattern: the surviving mount still finds the record after a throwaway remount',
    simulateFixedPattern(mounts) === target, JSON.stringify(simulateFixedPattern(mounts)));
  // Sanity: a normal single mount (no remount) works under both patterns.
  ok('FIXED pattern still works on a normal single mount with data already loaded',
    simulateFixedPattern([[target]]) === target);
}

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
