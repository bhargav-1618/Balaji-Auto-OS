/**
 * tests/concurrency-lease.test.cjs
 *
 * CONCURRENCY PHASE 1b — single active editor / live edit lease.
 *
 * Multiple users may VIEW a record; only one may hold its EDIT lease at a time.
 * The lease is a UX coordination mechanism — the Phase 1a `_rev` transaction is
 * still the authoritative data-integrity layer and runs on every save regardless
 * of who holds (or doesn't hold) a lease.
 *
 * The lease is:
 *   - keyed  editLocks/<collection>__<docId>
 *   - acquired transactionally (two simultaneous Edit clicks → exactly one winner)
 *   - renewed by a heartbeat every HEARTBEAT_MS while held
 *   - released on save / cancel / unmount / tab close
 *   - EXPIRING (LEASE_MS) so a crashed editor never locks a record permanently
 *   - Firestore-rule-enforced (see tests/rules/firestore.rules.test.cjs)
 *
 * This suite covers the pure lease logic + the wiring into all five editors.
 * The rules and the live takeover behaviour are covered by the emulator suite
 * (`npm run test:rules`) and the two/three-client production verification.
 */
require('./setup.cjs');
const fs = require('fs');
const path = require('path');

// firebase SDK calls are never made here — only the pure helpers + source checks.
const { leaseId, leaseHeldByOther, leaseIsMine, LEASE_MS, HEARTBEAT_MS } = require('../lib/editLease');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');

console.log('\nCONCURRENCY PHASE 1b — single active editor / edit lease\n');

// ── lock id + timings ──────────────────────────────────────────────────────
ok('leaseId is "<collection>__<docId>"', leaseId('customers', 'c001') === 'customers__c001');
ok('leaseId coerces a non-string id', leaseId('jobCards', 12) === 'jobCards__12');
ok('lease duration is short enough to free abandoned edits quickly (60–180s)',
  LEASE_MS >= 60 * 1000 && LEASE_MS <= 180 * 1000);
ok('heartbeat renews well inside the lease window (≤ half the duration)',
  HEARTBEAT_MS > 0 && HEARTBEAT_MS <= LEASE_MS / 2);

// ── who holds the lease? ──────────────────────────────────────────────────
const now = Date.now();
const ts = (ms) => ({ toMillis: () => ms });
const active = { ownerUid: 'uid-A', sessionId: 's-A1', ownerEmail: 'a@x', expiresAt: ts(now + 30000) };
const expired = { ownerUid: 'uid-A', sessionId: 's-A1', ownerEmail: 'a@x', expiresAt: ts(now - 5000) };

ok('an ACTIVE lease owned by someone else blocks me', leaseHeldByOther(active, 'uid-B', 's-B1') === true);
ok('my OWN active lease does not block me', leaseHeldByOther(active, 'uid-A', 's-A1') === false);
ok('the same user in ANOTHER tab is still "someone else" (keys on sessionId, not just uid)',
  leaseHeldByOther(active, 'uid-A', 's-A2') === true);
ok('an EXPIRED lease blocks nobody', leaseHeldByOther(expired, 'uid-B', 's-B1') === false);
ok('no lease document → free', leaseHeldByOther(null, 'uid-B', 's-B1') === false);
ok('leaseIsMine is true only for my own active lease',
  leaseIsMine(active, 'uid-A', 's-A1') === true
  && leaseIsMine(active, 'uid-B', 's-B1') === false
  && leaseIsMine(expired, 'uid-A', 's-A1') === false);

// ── lib/editLease — transactional acquire, heartbeat, expiry ───────────────
const lib = read('../lib/editLease.js');
ok('acquire is a Firestore transaction (two simultaneous Edit clicks → one winner)',
  /export async function acquireLease/.test(lib) && /runTransaction\(db, async \(tx\) => \{/.test(lib) && /await tx\.get\(ref\)/.test(lib));
ok('acquire refuses when another client holds an ACTIVE lease (lease/held)',
  /const active = toMillis\(d\.expiresAt\) > Date\.now\(\)/.test(lib) && /throw new LeaseError\('lease\/held'/.test(lib));
ok('acquire succeeds on a free OR expired OR own lease (takeover / re-acquire)',
  /if \(active && !mine\) throw new LeaseError/.test(lib));
ok('expiresAt is capped by writing now + LEASE_MS (rules also reject a >3min expiry)',
  /Timestamp\.fromMillis\(Date\.now\(\) \+ LEASE_MS\)/.test(lib));
ok('release is best-effort and never throws (expiry is the real backstop)',
  // Phase 6b (PH6-03) — withTimeout(...) now wraps the transaction (bounds the
  // wait; the try/catch around the whole thing is unchanged and still swallows
  // every failure, including a timeout).
  /export async function releaseLease\(collectionName, docId, owner\) \{[\s\S]{0,120}try \{[\s\S]{0,300}withTimeout\(runTransaction/.test(lib));
ok('release is session-aware — a stale same-user tab cannot touch a lease another tab took over',
  /const mine = !!owner && d\.ownerUid === owner\.uid && d\.sessionId === owner\.sessionId;[\s\S]{0,60}if \(!mine\) return;/.test(lib));
ok('PH7-27 FIXED [fact]: release now UPDATES (backdates expiresAt into the past) instead of deleting — a raw Firestore delete carries no payload for the rules to check a releasing session\'s identity against, so restricting release to a session-scoped update is what lets the RULES (not just this client check) enforce that only the current session may give up its own lease',
  /tx\.update\(ref, \{[\s\S]{0,200}expiresAt: Timestamp\.fromMillis\(Date\.now\(\) - 1000\),/.test(lib));
ok('heartbeat renew is session-aware — a resumed stale tab cannot clobber a newer lease (lease/lost)',
  // Phase 6b (PH6-03) — withTimeout(...) now wraps the transaction; widened the
  // window to cover the added wrapper + explanatory comment, same assertion.
  /export async function renewLease[\s\S]{0,600}const mine = d\.ownerUid === uid && d\.sessionId === sessionId;[\s\S]{0,160}throw new LeaseError\('lease\/lost'/.test(lib));
ok('observeLease is a live onSnapshot (viewers see lock/unlock without a refresh)',
  /export function observeLease[\s\S]{0,120}return onSnapshot\(/.test(lib));

// ── the reusable hook ─────────────────────────────────────────────────────
const hook = read('../hooks/useEditLease.js');
ok('one reusable hook — not copied per component', /export function useEditLease\(collectionName, docId\)/.test(hook));
ok('hook is inert in demo mode / without a signed-in user or a record',
  /const canLease = !demoMode && !!uid && !!sessionId;/.test(hook));
ok('hook runs a heartbeat while a lease is held',
  /hbRef\.current = setInterval\(\(\) => \{[\s\S]{0,120}renewLease\(/.test(hook) && /HEARTBEAT_MS/.test(hook));
ok('hook releases on unmount and (best-effort) on tab close',
  /useEffect\(\(\) => \(\) => \{ release\(\); \}, \[release\]\);/.test(hook) && /addEventListener\('pagehide'/.test(hook));
ok('hook passes {uid, sessionId} to releaseLease so the session-ownership check can run',
  /releaseLease\(held\.collectionName, held\.docId, \{ uid, sessionId \}\)/.test(hook));
ok('a non-"held" acquire failure (offline / clock skew) still lets the user edit — _rev protects the save',
  /degraded: true/.test(hook));
ok('hook exposes the three states: available / mine / held',
  /status: mine \? 'mine' : \(heldByOther \? 'held' : 'available'\)/.test(hook));

// ── session identity ─────────────────────────────────────────────────────
const authCtx = read('../context/AuthContext.js');
ok('a stable per-tab sessionId is generated centrally in AuthContext',
  /const makeSessionId = \(\) =>/.test(authCtx) && /crypto\.randomUUID/.test(authCtx)
  && /sessionIdRef = useRef\(\)/.test(authCtx) && /sessionId: sessionIdRef\.current/.test(authCtx));
ok('sessionId is NOT persisted (a reload is a new session — a crashed tab\'s lease just expires)',
  !/localStorage[\s\S]{0,40}sessionId|sessionStorage[\s\S]{0,40}sessionId/i.test(authCtx));

// ── wired into all five editors + nested vehicles (via the customer) ──────
const dash = read('../components/InventoryDashboard.js');
const cust = read('../components/customers/CustomersModule.jsx');
const bill = read('../components/billing/BillingModule.jsx');
const jc = read('../components/jobcards/JobCardModule.jsx');

ok('Customers: editor open acquires, close/save releases (nested vehicles ride the customer lease)',
  /const lease = useEditLease\('customers', editCust && editCust\.id \? editCust\.id : selId\)/.test(cust)
  && /const r = await lease\.acquire\(c\.id\);/.test(cust)
  && /if \(!r\.ok\) \{ toast\.error\(`🔒 \$\{r\.heldBy\} is editing this customer/.test(cust)
  && /const closeCustomerEditor = useCallback\(\(\) => \{ lease\.release\(\); setReviewOpen\(false\); setEditCust\(null\); \}/.test(cust)
  && /lease\.release\(\);[^\n]*\n\s*setEditCust\(null\);\s*\n\s*toast\.success\('Customer saved'\)/.test(cust));
ok('Customers: a viewer\'s Edit button disables live when the lease is held',
  /disabled=\{c\.id === selId && lease\.status === 'held'\}/.test(cust)
  && /<EditLeaseBanner status=\{lease\.status\} heldByEmail=\{lease\.heldByEmail\}/.test(cust));
// PHASE 1c — a lost lease race NO LONGER closes the popup: it stays open read-only
// (viewOnly flag) and [Edit] re-acquires. Assert the close calls are gone from those
// branches and the view-only path is in place.
ok('Parts: lost lease race keeps the popup open read-only (not force-closed); successful save still releases',
  /const partLease = useEditLease\('parts', showModal && editPart && editPart\.id \? editPart\.id : null\)/.test(dash)
  && /partLease\.acquire\(editPart\.id\)\.then\(\(r\) => \{/.test(dash)
  && /if \(!r\.ok\) \{ toast\.error\([^\n]*setPartViewOnly\(true\); \}/.test(dash)
  && !/if \(!r\.ok\) \{ toast\.error\(`🔒 \$\{r\.heldBy\} is editing this part[\s\S]{0,120}setShowModal\(false\)/.test(dash)
  && /if \(!concRejected\) \{ partLease\.release\(\); setShowModal\(false\); setEditPart\(null\); \}/.test(dash)
  && /const claimPartEdit = useCallback\(async \(\) => \{[\s\S]{0,240}partLease\.acquire\(editPart\.id\)/.test(dash));
ok('Suppliers: lost lease race keeps the popup open read-only; successful save still releases',
  /const supplierLease = useEditLease\('suppliers', showSupplierModal && editSupplier && editSupplier\.id/.test(dash)
  && /supplierLease\.acquire\(editSupplier\.id\)\.then/.test(dash)
  && /if \(!r\.ok\) \{ toast\.error\([^\n]*setSupplierViewOnly\(true\); \}/.test(dash)
  && /if \(!concRejected\) \{ supplierLease\.release\(\); setShowSupplierModal\(false\)/.test(dash));
ok('Invoices: an EXISTING invoice editor acquires; lost race keeps the popup open read-only',
  /const isPersistedEdit = !!\(edit && edit\.id && \(invoices \|\| \[\]\)\.some\(\(iv\) => iv\.id === edit\.id\)\)/.test(bill)
  && /const invoiceLease = useEditLease\('invoices', isPersistedEdit \? edit\.id : null\)/.test(bill)
  && /invoiceLease\.acquire\(edit\.id\)\.then/.test(bill)
  && /if \(!r\.ok\) \{ toast\.error\([^\n]*setInvoiceViewOnly\(true\); \}/.test(bill)
  && !/if \(!r\.ok\) \{ toast\.error\(`🔒 \$\{r\.heldBy\} is editing this invoice[\s\S]{0,120}setEdit\(null\)/.test(bill)
  && /const closeInvoiceEditor = useCallback\(\(\) => \{ invoiceLease\.release\(\); setInvoiceReviewOpen\(false\); setEdit\(null\); \}/.test(bill));
ok('Job Cards: loading a SAVED card acquires; a lost race loads it read-only (not refused); save/clear releases',
  /const jcLease = useEditLease\('jobCards', leasedJobNo\)/.test(jc)
  && /const isSaved = !!\(jc && jc\.jobNo && \(savedRef\.current \|\| \[\]\)\.some\(\(c\) => c\.jobNo === jc\.jobNo\)\)/.test(jc)
  && /const r = await jcLease\.acquire\(jc\.jobNo\);\s*\n\s*setJcViewOnly\(!r\.ok\);/.test(jc)
  && /jcLease\.release\(\); setLeasedJobNo\(null\); setJcViewOnly\(false\);\s+\/\/ Phase 1b/.test(jc));

// ── separation of concerns: the lease is NOT the data-integrity layer ─────
ok('the Phase 1a guarded save (repo / store / lib/concurrency) never reads a lease or the record-sync layer',
  !/editLease|editLocks|acquireLease|useEditLease|recordSync|useRecordSync/.test(read('../repositories/firestoreRepository.js') + read('../services/persistenceStore.js') + read('../lib/concurrency.js')));
ok('a stale/deleted Phase 1a rejection keeps the editor AND the lease (does not release on failed save)',
  /if \(!concRejected\) \{ partLease\.release\(\)/.test(dash)
  && /if \(!concRejected\) \{ supplierLease\.release\(\)/.test(dash));

// ── rules block present + additive ───────────────────────────────────────
const rules = read('../firestore.rules');
ok('firestore.rules has an additive editLocks block',
  /match \/editLocks\/\{lockId\} \{/.test(rules)
  && /allow create: if signedIn\(\) && incomingShapeOk\(\)/.test(rules)
  && /allow update: if signedIn\(\) && \(/.test(rules)
  && /allow delete: if signedIn\(\) && expired\(\);/.test(rules));
ok('PH7-27 FIXED [fact]: the update rule now requires sameSession() (not just ownedByMe()) for any write against a still-ACTIVE lease, and DELETE is restricted to an already-EXPIRED lease only — session identity for the lease-holder is now enforced by the rules themselves, not just by the client transaction',
  /function sameSession\(\) \{\s*\n\s*return resource\.data\.sessionId == request\.resource\.data\.sessionId;/.test(rules)
  && /function releaseShapeOk\(\)/.test(rules)
  && /\(ownedByMe\(\) && sameSession\(\) && \(incomingShapeOk\(\) \|\| releaseShapeOk\(\)\)\)/.test(rules));
ok('editLocks is NOT an unrestricted authenticated-write collection',
  !/match \/editLocks\/\{lockId\} \{\s*allow read, write: if signedIn\(\);/.test(rules)
  && /request\.resource\.data\.expiresAt < request\.time \+ duration\.value\(3, 'm'\)/.test(rules));
ok('the deny-by-default catch-all is still last', /match \/\{document=\*\*\} \{\s*allow read, write: if false;/.test(rules));

// ── Phase-1a intact / no forbidden changes ───────────────────────────────
ok('Phase 1a payment fix + guarded saves still present',
  /const collectInvoicePayment = async \(invoiceId, pay\) => \{/.test(dash)
  && /store\.saveGuarded\(COLLECTIONS\.PARTS/.test(dash));
// CONCURRENCY PHASE 2 (the "later phase") landed: invoice numbers are now allocated
// by a Firestore transaction on counters/<sequence> (lib/docCounter.js) at save time.
// That allocator is INDEPENDENT of the Phase 1b edit lease — neither imports the other.
ok('invoice numbering is server-allocated (Phase 2) and independent of the edit lease',
  /export async function allocateNumber\(sequence, seedFrom/.test(read('../lib/docCounter.js'))
  && /runTransaction\(db, async \(tx\) => \{/.test(read('../lib/docCounter.js'))
  && /store\.allocateNumber\(__allocSeq, __allocSeed\)/.test(dash)
  && !/editLease|editLocks|acquireLease|useEditLease/.test(read('../lib/docCounter.js')));
ok('stock oversell policy unchanged (DO NOT CLAMP TO ZERO comment still there)',
  /DO NOT CLAMP TO ZERO/.test(dash));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
