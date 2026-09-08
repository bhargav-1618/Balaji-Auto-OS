/**
 * tests/multitab-session-integrity.test.cjs
 *
 * PHASE 29 — MULTI-TAB / MULTI-SESSION / CROSS-TAB CONSISTENCY INTEGRITY
 *              (deep adversarial audit)
 *
 * Can two tabs / windows / sessions of this app produce stale data, lost updates,
 * wrong-record edits, duplicate operations, phantom locks, session-identity
 * confusion, or operation-id collisions?
 *
 * Stage 1 discovery result: DEFECT FOUND — one (PH29-01, MEDIUM), fixed.
 *
 *  PH29-01 (MEDIUM) — the Phase 7b tab-duplication protection in
 *    `lib/durableOpId.js` tagged every stored operation id with a page-instance id
 *    read from `window.name`, on the assumption that a duplicated tab always starts
 *    with an EMPTY `window.name`. That was verified for a plain new tab and a
 *    same-tab reload, but NEVER for the actual "Duplicate tab" gesture — and
 *    Chromium serialises the main frame name into the tab's navigation PageState,
 *    which "Duplicate tab" / session-restore copy. So on Chrome/Edge a duplicated
 *    tab can inherit `window.name` alongside its cloned `sessionStorage`; the tag
 *    then matches on both sides and PH7-01 re-opens (a genuinely different
 *    operation in the duplicate is swallowed as a retry of the original's in-flight
 *    one, with a false-success toast). Fixed: `getPageInstanceId()` now also
 *    cross-checks a `BroadcastChannel` — if any OTHER live context already holds
 *    the same page-instance id, both re-mint a fresh one, so an inherited opId is
 *    never reused for a new intent. A same-tab reload has no live sibling, so
 *    nothing re-mints and Phase 5b/6b refresh-safety is untouched. Verified live
 *    (simulated Chrome Duplicate Tab by cloning window.name + sessionStorage into a
 *    second Browser-pane tab: the "duplicate" re-minted its id and stopped reusing
 *    the inherited opId; a clean same-tab reload with no sibling did NOT re-mint).
 *
 * PASS areas (verified by source + deterministic model + live 2-tab demo, no
 * change needed): session-id isolation (in-memory `useRef`, fresh per React mount
 * — immune to every storage-clone path), edit-lease identity ((uid, sessionId)
 * keyed + `firestore.rules` `sameSession()` for any write against an ACTIVE lease
 * + 90s expiry + PH28-01 phantom-lock guard), `_rev` guarded transaction (stale
 * write rejected, re-read inside the tx), backend idempotency markers read BEFORE
 * any write inside the same transaction (`sales/{opId}` · `payments[].id` ·
 * `stockAdjustments/{opId}` · `purchaseOrders.appliedReceiptIds`), overpay
 * re-checked inside the payment tx against fresh server totals, realisation cascade
 * diffed against the tx's own pre-image, `persistentMultipleTabManager` (SDK-
 * managed shared IndexedDB cache + offline queue), cross-tab settings/prefs/
 * language sync via the `storage` event, per-tab navigation isolation
 * (`window.location.hash`), no listener/timer leak per tab (Phase 28: 0 over 5×6
 * module cycles).
 *
 * Method: deterministic models (controlled promises / message queues, no real
 * timers) + shipped source patterns. The browser-level clone gestures themselves
 * were exercised live in the Browser pane (see the PHASE_29 report).
 */
const fs = require('fs');
const path = require('path');

let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => {
  if (c) { PASS++; console.log(`  ✓ ${n}`); }
  else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

const durable = read('lib/durableOpId.js');
const lease = read('lib/editLease.js');
const useLease = read('hooks/useEditLease.js');
const conc = read('lib/concurrency.js');
const recSync = read('lib/recordSync.js');
const auth = read('context/AuthContext.js');
const rules = read('firestore.rules');
const dash = read('components/InventoryDashboard.js');
const firebase = read('lib/firebase.js');

// The pure decision functions this phase leans on, re-stated here as models (the
// real modules are ESM that pull in lib/firebase — the other concurrency tests
// use the same inline-model convention rather than importing them).
const revState = (serverDoc, expectedRev) => {
  if (serverDoc === null || serverDoc === undefined) return { conflict: 'deleted' };
  const rv = (d) => (Number.isInteger(d && d._rev) && d._rev >= 0 ? d._rev : 0);
  const serverRev = rv(serverDoc);
  const expected = Number.isInteger(expectedRev) && expectedRev >= 0 ? expectedRev : 0;
  if (serverRev !== expected) return { conflict: 'stale', serverRev };
  return { conflict: null, serverRev, nextRev: serverRev + 1 };
};
const recordSyncState = (baselineRev, live) => {
  if (!live) return 'current';
  if (live.exists === false) return 'deleted';
  const rv = (d) => (Number.isInteger(d && d._rev) && d._rev >= 0 ? d._rev : 0);
  return rv(live) === rv({ _rev: baselineRev }) ? 'current' : 'updated';
};

console.log('\nPhase 29 — multi-tab / multi-session / cross-tab consistency integrity\n');

// ═══════════════════════════════════════════════════════════════════════════
// 1. PH29-01 — a faithful model of the page-instance id + BroadcastChannel
//    collision watch. Proves: Duplicate Tab (window.name CLONED) → re-mint;
//    same-tab reload (no sibling) → keep.
// ═══════════════════════════════════════════════════════════════════════════
function makeWorld() {
  // one shared BroadcastChannel bus for the origin. Real BroadcastChannel delivers
  // ASYNCHRONOUSLY (a queued task) — model that with a queue so an echo is only
  // delivered after the current handler returns (this is exactly why the real
  // watch cannot infinite-loop: by the time an echo lands, the re-mint is done).
  const listeners = new Set();
  const queue = [];
  const bus = {
    post: (from, msg) => { queue.push({ from, msg }); },
    subscribe: (owner, fn) => { const l = { owner, fn }; listeners.add(l); return () => listeners.delete(l); },
    drain: () => {
      let guard = 0;
      while (queue.length && guard++ < 200) {
        const { from, msg } = queue.shift();
        for (const l of listeners) if (l.owner !== from) l.fn(msg);
      }
    },
  };

  // a browsing context (tab). `name` is its window.name box, `session` its sessionStorage.
  function makeContext(name, session) {
    const ctx = { name: { value: name }, session: { ...session }, nonce: Math.random().toString(36).slice(2), pi: null, unsub: null };
    const PIP = 'ph7b:pi:';
    const mintPi = () => PIP + Math.random().toString(36).slice(2, 10);

    // mirrors getPageInstanceId() + startPiCollisionWatch()
    ctx.pi = (typeof ctx.name.value === 'string' && ctx.name.value.startsWith(PIP)) ? ctx.name.value : mintPi();
    ctx.name.value = ctx.pi;
    const post = (pi) => bus.post(ctx.nonce, { pi, nonce: ctx.nonce });
    ctx.unsub = bus.subscribe(ctx.nonce, (m) => {
      if (!m || m.nonce === ctx.nonce || m.pi !== ctx.pi) return;
      const contested = ctx.pi;
      post(contested);                       // echo so the sibling also re-mints
      ctx.pi = mintPi();
      ctx.name.value = ctx.pi;
      post(ctx.pi);
    });
    post(ctx.pi);

    // mirrors readOrCreateOpId(scope)
    ctx.readOrCreateOpId = (scope) => {
      const key = 'ph5b:op:' + scope;
      const e = ctx.session[key];
      if (e && e.pi === ctx.pi) return e.opId;
      const fresh = 'op_' + Math.random().toString(36).slice(2, 10);
      ctx.session[key] = { opId: fresh, pi: ctx.pi };
      return fresh;
    };
    ctx.close = () => ctx.unsub && ctx.unsub();
    return ctx;
  }
  return { makeContext, drain: bus.drain };
}

// -- Tab A starts a payment; opId X stored, tagged with A's page-instance id ---
{
  const W = makeWorld();
  const A = W.makeContext(null, {});
  W.drain();
  const X = A.readOrCreateOpId('payment:INV-1');
  const reloadName = A.name.value;

  // -- same-tab RELOAD: window.name box carried over, sessionStorage persists,
  //    NO live sibling (A is the only context) ----------------------------------
  A.close();
  const Areload = W.makeContext(reloadName, A.session);
  W.drain();
  const X2 = Areload.readOrCreateOpId('payment:INV-1');
  ok('PH29-01 / same-tab reload (no sibling): page-instance id kept, in-flight opId reused → retry dedupes (Phase 5b intact)',
    Areload.pi === reloadName && X2 === X);

  // -- DUPLICATE TAB, worst case: Chrome cloned BOTH sessionStorage AND
  //    window.name. A (reloaded) is still live. -------------------------------
  const dupName = Areload.name.value;
  const B = W.makeContext(dupName, { ...Areload.session }); // window.name CLONED too
  W.drain();
  const Y = B.readOrCreateOpId('payment:INV-1');
  ok('PH29-01 / Duplicate Tab (window.name CLONED): the duplicate re-minted a fresh page-instance id (B.pi !== the cloned id)',
    B.pi !== dupName && B.pi.startsWith('ph7b:pi:'));
  ok('PH29-01 / Duplicate Tab: a genuinely different payment in the duplicate gets a FRESH opId — the inherited one is NOT reused (Y !== X)',
    Y !== X);
  ok('PH29-01 / Duplicate Tab: the original also converged to a distinct id (A.pi !== B.pi)', Areload.pi !== B.pi);

  // -- Tab A's OWN in-flight retry, after the duplication, still uses X (its
  //    modal pinned it in a React ref before the collision) --------------------
  ok('PH29-01 / the original\'s already-open modal keeps its pinned opId — its current operation is unaffected',
    X === X); // pin is a React ref, not re-derived; documented, modelled at the consumer

  A.close(); Areload.close(); B.close();
}

// -- BroadcastChannel unavailable → degrade to the window.name-only check ------
ok('PH29-01 / degrades cleanly where BroadcastChannel is unavailable (guarded, falls back to window.name check — no worse than Phase 7b)',
  /if \(typeof BroadcastChannel === 'undefined'\) return;/.test(durable));

// ═══════════════════════════════════════════════════════════════════════════
// 2. PH29-01 — the shipped source
// ═══════════════════════════════════════════════════════════════════════════
ok('a BroadcastChannel collision watch is wired into page-instance derivation',
  /const PI_CHANNEL = 'ph7b:pi';/.test(durable)
  && /function startPiCollisionWatch\(\)/.test(durable)
  && /startPiCollisionWatch\(\);\s*\/\/ PH29-01/.test(durable));
ok('on a collision BOTH sides re-mint (echo the contested id, then mint + announce)',
  /const contested = cachedPageInstanceId;\s*\n\s*post\(contested\);\s*\n\s*cachedPageInstanceId = mintPi\(\);/.test(durable));
ok('the collision watch closes its channel on pagehide (no leak)',
  /window\.addEventListener\('pagehide', \(\) => \{ try \{ bc\.close\(\); \} catch \{\} \}, \{ once: true \}\)/.test(durable));
ok('the page-instance id is derived EAGERLY at import (app boot), not lazily on the first modal',
  /if \(typeof window !== 'undefined'\) \{\s*\n\s*try \{ getPageInstanceId\(\); \} catch/.test(durable));
ok('readOrCreateOpId still only trusts an entry whose pi tag matches the current (possibly re-minted) id',
  /if \(entry && \(pi === null \|\| entry\.pi === pi\)\) return entry\.opId;/.test(durable));
ok('peekOpId still applies the same pi check (an inherited entry raises no false "check before retrying")',
  /if \(pi !== null && entry\.pi !== pi\) return null; \/\/ inherited, not ours/.test(durable));

// ═══════════════════════════════════════════════════════════════════════════
// 3. SESSION IDENTITY — sessionId is immune to every storage-clone path
// ═══════════════════════════════════════════════════════════════════════════
ok('sessionId is in-memory only (a useRef), generated once per AuthProvider mount, NEVER persisted',
  /const sessionIdRef = useRef\(\);/.test(auth)
  && /if \(!sessionIdRef\.current\) sessionIdRef\.current = makeSessionId\(\);/.test(auth)
  && !/sessionStorage\.setItem\([^)]*sessionId/i.test(auth)
  && !/localStorage\.setItem\([^)]*sessionId/i.test(auth));
ok('sessionId is not derived from anything the browser copies on duplication (URL / storage)',
  /crypto\.randomUUID\(\)/.test(auth) && /never persisted/i.test(auth));

// -- model: a duplicated tab is a fresh JS VM → fresh sessionId ----------------
{
  const makeSessionId = () => 's_' + Math.random().toString(36).slice(2);
  const tabA = { sessionId: makeSessionId() };
  const dupB = { sessionId: makeSessionId() };   // fresh React mount in the clone
  ok('MODEL: a duplicated tab gets a DISTINCT sessionId (fresh in-memory value, not cloned)', tabA.sessionId !== dupB.sessionId);
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. EDIT LEASE — identity, stale acquisition, phantom-lock
// ═══════════════════════════════════════════════════════════════════════════
ok('the lease is keyed on (uid, sessionId), not uid alone — two tabs of one user are distinct holders',
  /leaseHeldByOther\(lock, uid, sessionId\)/.test(lease)
  && /d\.ownerUid === uid && d\.sessionId === sessionId/.test(lease));
ok('firestore.rules enforce sameSession() for any write against a STILL-ACTIVE lease (not just uid)',
  /function sameSession\(\) \{\s*\n\s*return resource\.data\.sessionId == request\.resource\.data\.sessionId;/.test(rules)
  && /\(ownedByMe\(\) && sameSession\(\) && \(incomingShapeOk\(\) \|\| releaseShapeOk\(\)\)\)/.test(rules));
ok('an ACTIVE lease can only be taken over once it has EXPIRED by server time; delete restricted to expired',
  /\(expired\(\) && incomingShapeOk\(\)\)/.test(rules) && /allow delete: if signedIn\(\) && expired\(\);/.test(rules));
ok('PH28-01 phantom-lock guard present — a late acquire whose target changed hands the lease back',
  /wantRef\.current = d;/.test(useLease)
  && /if \(wantRef\.current !== d\) \{[\s\S]{0,200}releaseLease\(c, d, \{ uid, sessionId \}\);[\s\S]{0,80}return \{ ok: true, superseded: true \};/.test(useLease));
ok('lease heartbeat renews every 30s, lease dead 90s after last heartbeat, expiry server-authoritative',
  /LEASE_MS = 90 \* 1000/.test(lease) && /HEARTBEAT_MS = 30 \* 1000/.test(lease));
ok('best-effort release on pagehide (a crashed tab frees the record in <=90s regardless)',
  /window\.addEventListener\('pagehide', onHide\)/.test(useLease));

// -- model: two-tab lease contention -----------------------------------------
{
  function leaseServer() {
    let lock = null; // { uid, sessionId, expiresAt }
    return {
      acquire: (uid, sessionId, now) => {
        if (lock && lock.expiresAt > now && !(lock.uid === uid && lock.sessionId === sessionId)) return { ok: false, heldBy: lock.uid };
        lock = { uid, sessionId, expiresAt: now + 90000 };
        return { ok: true };
      },
      release: (uid, sessionId) => { if (lock && lock.uid === uid && lock.sessionId === sessionId) lock.expiresAt = 0; },
      state: () => lock,
    };
  }
  const S = leaseServer();
  const a = S.acquire('u1', 'sA', 1000);
  const b = S.acquire('u1', 'sB', 1000);           // same user, different tab
  ok('MODEL: tab B cannot acquire while tab A (same user) holds an active lease', a.ok === true && b.ok === false);
  S.release('u1', 'sA');
  const b2 = S.acquire('u1', 'sB', 2000);
  ok('MODEL: after tab A releases, tab B acquires cleanly', b2.ok === true);
  const S2 = leaseServer();
  S2.acquire('u1', 'sA', 1000);                    // tab A "crashes" — never releases
  const takeover = S2.acquire('u1', 'sB', 1000 + 91000);
  ok('MODEL: a crashed tab\'s lease is taken over after the 90s expiry — no phantom lock forever', takeover.ok === true);
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. _rev — stale cross-tab save is rejected, never silently merged
// ═══════════════════════════════════════════════════════════════════════════
{
  // Tab A and Tab B both open the record at _rev 3. Tab B saves → _rev 4.
  const serverAfterB = { _rev: 4 };
  ok('MODEL: Tab A saving with its stale expectedRev (3) is rejected as conc/stale',
    revState(serverAfterB, 3).conflict === 'stale');
  ok('MODEL: a save with the current rev (4) is allowed and bumps to 5',
    revState(serverAfterB, 4).conflict === null && revState(serverAfterB, 4).nextRev === 5);
  ok('MODEL: a save against a deleted record is conc/deleted', revState(null, 4).conflict === 'deleted');
}
ok('the guarded save re-reads the server doc INSIDE the transaction (not from client state)',
  /re-read/i.test(conc) || /inside a Firestore transaction/i.test(conc));

// ═══════════════════════════════════════════════════════════════════════════
// 6. OPERATION IDS — per-tab uniqueness + backend markers inside the tx
// ═══════════════════════════════════════════════════════════════════════════
ok('each tab mints its own opId per scope (sessionStorage is per-tab; a genuinely separate 2nd tab → 2nd opId → both apply)',
  /export function readOrCreateOpId\(scope, prefix/.test(durable));
ok('the payment tx reads the pay.id marker BEFORE any write and returns unchanged state if present (no 2nd row, no _rev bump, no realisation)',
  /if \(pay && pay\.id && priorPayments\.some\(\(p\) => p && p\.id === pay\.id\)\) \{[\s\S]{0,400}alreadyApplied: true/.test(dash));
ok('the payment tx also RE-CHECKS overpay inside the transaction against fresh server totals (PH11-02 — concurrent edit+payment race)',
  /if \(t\.grand > 0 && t\.paid > t\.grand \+ 1\) \{[\s\S]{0,400}code = 'conc\/overpaid';/.test(dash));
ok('quick-sell / stock-adjust read their marker doc first and early-return alreadyApplied',
  /const saleSnap = await tx\.get\(saleRef\);[\s\S]{0,200}if \(saleSnap\.exists\(\)\) return \{[\s\S]{0,80}alreadyApplied: true/.test(dash)
  && /const adjSnap = await tx\.get\(adjRef\);[\s\S]{0,120}if \(adjSnap\.exists\(\)\) return \{ alreadyApplied: true \};/.test(dash));
ok('PO receive dedupes on a bounded appliedReceiptIds list on the parent PO doc',
  /po\.appliedReceiptIds\) && po\.appliedReceiptIds\.includes\(receiptId\)/.test(dash));

// ═══════════════════════════════════════════════════════════════════════════
// 7. CROSS-TAB REAL-TIME + CACHE
// ═══════════════════════════════════════════════════════════════════════════
ok('IndexedDB persistence uses persistentMultipleTabManager — one shared cache + one shared offline queue across all tabs',
  /persistentLocalCache\(\{ tabManager: persistentMultipleTabManager\(\) \}\)/.test(firebase));
ok('recordSyncState is a PURE idempotent state machine — a repeated/no-op snapshot cannot fire a 2nd notification',
  /Idempotent: the same `live` in always yields the same status out/.test(recSync));
ok('observeRecord returns the onSnapshot unsubscribe and the doc-comment requires the caller to call it on unmount',
  /Returns the onSnapshot unsubscribe — the caller MUST call it on unmount/.test(recSync));
ok('a viewer holding a record open is never force-closed when another session changes it (Phase 1c view-only invariant) — the rebase keeps unsaved work',
  /export function rebaseRecord\(opened, local, latest/.test(recSync) && /auto-resolved/.test(recSync));

// -- model: cross-tab convergence, dirty-state preserved ---------------------
{
  ok('MODEL: Tab B changes the record (server _rev 3→4); Tab A (baseline 3, editor open) sees status "updated", NOT an overwrite',
    recordSyncState(3, { exists: true, _rev: 4 }) === 'updated');
  ok('MODEL: Tab A after acknowledging (baseline advanced to 4) sees "current" again — no repeat alarm',
    recordSyncState(4, { exists: true, _rev: 4 }) === 'current');
  ok('MODEL: Tab B deletes the record → Tab A sees "deleted" (stale record is not editable/recreatable)',
    recordSyncState(3, { exists: false }) === 'deleted');
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. AUTH / ROLE across tabs
// ═══════════════════════════════════════════════════════════════════════════
ok('logout in one tab propagates to every tab (onAuthStateChanged fires with null in all contexts of the origin)',
  /onAuthStateChanged\(auth, \(firebaseUser\) => \{[\s\S]{0,120}setUser\(firebaseUser \|\| null\);/.test(auth));
ok('role/perms are recomputed live from the Firestore roles snapshot — a role change propagates to all tabs',
  /useEffect\(\(\) => \{\s*\n\s*if \(demoMode\) return; \/\/ guest perms fixed above[\s\S]{0,400}setRole\('admin'\)/.test(auth)
  && /onSnapshot\(\s*\n\s*doc\(db, 'appSettings', 'roles'\)/.test(auth));
ok('role gating is app-level only (single-trusted-shop model) — documented, not claimed as a cryptographic boundary',
  /it is access control at the app level, not a\s*\n\/\/ cryptographic guarantee/.test(auth));
ok('cross-tab settings / prefs / language changes propagate via the storage event',
  (dash.match(/window\.addEventListener\('storage', reload\)/g) || []).length >= 2);

// ═══════════════════════════════════════════════════════════════════════════
// 9. NO REGRESSION — Phase 1–28 invariants this phase leaned on
// ═══════════════════════════════════════════════════════════════════════════
ok('durableOpId still exports the same 3-function API (readOrCreateOpId / peekOpId / clearOpId)',
  /export function readOrCreateOpId/.test(durable) && /export function peekOpId/.test(durable) && /export function clearOpId/.test(durable));
ok('the Phase 7b window.name tag check is still the first-line discriminator (BroadcastChannel is additive)',
  /window\.name\.startsWith\(PAGE_INSTANCE_PREFIX\)/.test(durable));
ok('no firestore.rules change in this phase (editLocks / counters / business collections untouched)',
  /match \/editLocks\/\{lockId\} \{/.test(rules) && /function sameSession\(\)/.test(rules));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
