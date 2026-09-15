/**
 * tests/navigation-race-integrity.test.cjs
 *
 * PHASE 28 — DOUBLE-NAVIGATION / STALE-ROUTE / RAPID-SELECTION INTEGRITY
 *
 * The race this phase hunts:
 *
 *     correct action  →  rapid navigation / selection change  →
 *     an older async operation resolves LATER  →  its result overwrites
 *     current state  →  the UI shows the wrong record / module / data
 *
 * Stage 1 discovery result: DEFECT FOUND — three (PH28-01/02/03), all now fixed.
 *
 *  PH28-01 (MEDIUM) — `hooks/useEditLease.js` `acquire()` is async. Between the call
 *    and its Firestore round-trip resolving, the user can close the editor, pick a
 *    different record, or Back out of the module. The resolved-too-late acquire still
 *    installed `heldRef` + a renewing heartbeat → a record edit-locked with nobody
 *    editing it (another user sees a false "🔒 …is editing"). It also let two of the
 *    consumers (`CustomersModule.openCustomerEditor`, `JobCardModule.loadCard`) OPEN
 *    THE WRONG RECORD when acquires resolved out of order. Fixed: a `wantRef` records
 *    the docId the consumer currently wants; a late acquire whose target no longer
 *    matches hands the lease straight back and returns `{ superseded: true }`, and the
 *    two record-gating consumers bail on `superseded`.
 *
 *  PH28-02 (LOW) — the Part / Supplier / Checkout / Restock / Stock-Adjust modals
 *    render OUTSIDE the `activeTab === …` conditionals. A browser Back while one was
 *    open swapped the module BEHIND the modal and left the address bar pointing at a
 *    tab the user couldn't see. Fixed: `onPop` keeps Back inert (snaps the hash back)
 *    while `blockingModalRef` is set.
 *
 *  PH28-03 (MEDIUM) — the hashchange handler (`onPop`, Back/Forward) called
 *    `setActiveTabRaw` directly, bypassing the unsaved-changes confirm that a sidebar
 *    click (`setActiveTab`) enforces via `settingsDirtyRef` / `moduleDirtyRef`. Back
 *    out of a dirty editor discarded the edits with no prompt. Fixed: `onPop` runs the
 *    same two confirms and snaps the hash back if the user cancels.
 *
 * PASS areas (verified live + by source, no change needed): rapid module switching
 * (A→B→A, A→B→C→A, 8-module hammer @15ms — hash & heading always match the last
 * click, zero console errors), Back/Forward final-state correctness, rapid record
 * selection (pure `useMemo(find(selId))` — no per-selection fetch, last click wins),
 * search (`useDeferredValue`, not a debounce — no stale-result race), per-record
 * listener cleanup (`useRecordSync` / `observeLease` keyed on docId), no timer /
 * listener leak across repeated navigation (measured: 0 leaked intervals over 5×6
 * module cycles).
 *
 * Method: pure deterministic models (controllable promises, no real sleeps) + shipped
 * source patterns. jsdom has no router; the navigation behaviour itself was verified
 * live in the browser pane (see PHASE_28 report).
 */
const fs = require('fs');
const path = require('path');

let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => {
  if (c) { PASS++; console.log(`  ✓ ${n}`); }
  else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); }
};
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

const lease = read('hooks/useEditLease.js');
const dash = read('components/InventoryDashboard.js');
const cust = read('components/customers/CustomersModule.jsx');
const jc = read('components/jobcards/JobCardModule.jsx');
const useSearch = read('lib/useSearch.js');

console.log('\nPhase 28 — navigation-race / stale-route / rapid-selection integrity\n');

// ───────────────────────────────────────────────────────────────────────────
// 1. PH28-01 — a faithful model of useEditLease's acquire/release ownership.
//    Proves: a late acquire whose consumer has moved on does NOT keep the lock.
// ───────────────────────────────────────────────────────────────────────────
function makeLeaseModel() {
  // mirrors hooks/useEditLease.js after the fix
  const server = { locks: new Map() };                 // docId -> 'held' | 'free'
  const acquireLease = (d) => { server.locks.set(d, 'held'); };
  const releaseLease = (d) => { server.locks.set(d, 'free'); };

  let held = null;          // heldRef
  let heartbeat = null;     // hbRef (interval id stand-in)
  let want = null;          // wantRef  ← the fix
  const stopHeartbeat = () => { heartbeat = null; };

  const release = () => {
    want = null;                                        // fix: in-flight acquire now unwanted
    stopHeartbeat();
    const h = held; held = null;
    if (h) releaseLease(h);
  };

  // returns a { resolve } handle so the test controls WHEN the round-trip completes
  const acquire = (d) => {
    want = d;
    let done;
    const p = new Promise((res) => { done = res; });
    const finish = () => {
      acquireLease(d);
      if (want !== d) { releaseLease(d); done({ ok: true, superseded: true }); return; }
      held = d;
      stopHeartbeat();
      heartbeat = `hb:${d}`;
      done({ ok: true });
    };
    return { promise: p, finish };
  };

  return { acquire, release, state: () => ({ held, heartbeat, want, server: Object.fromEntries(server.locks) }) };
}

(async () => {
  // -- scenario A: open editor A, close it BEFORE the acquire resolves --------
  {
    const L = makeLeaseModel();
    const a = L.acquire('A');
    L.release();                    // user closed the editor / navigated away
    a.finish();                     // the Firestore round-trip lands now
    const r = await a.promise;
    ok('PH28-01 / close-before-resolve: the acquire reports superseded', r.superseded === true);
    ok('PH28-01 / close-before-resolve: no heartbeat is left running', L.state().heartbeat === null);
    ok('PH28-01 / close-before-resolve: the record is NOT left locked on the server', L.state().server.A === 'free');
  }

  // -- scenario B: open A, then open B; A's acquire resolves LAST ------------
  {
    const L = makeLeaseModel();
    const a = L.acquire('A');
    const b = L.acquire('B');
    b.finish();                     // B resolves first
    a.finish();                     // A resolves second (out of order)
    const rb = await b.promise;
    const ra = await a.promise;
    ok('PH28-01 / out-of-order: B (the record wanted) is the one held', L.state().held === 'B');
    ok('PH28-01 / out-of-order: A resolved late → superseded, not held', ra.superseded === true && rb.ok === true);
    ok('PH28-01 / out-of-order: A is not left locked on the server', L.state().server.A === 'free');
    ok('PH28-01 / out-of-order: exactly one heartbeat, for B', L.state().heartbeat === 'hb:B');
  }

  // -- scenario C: the normal, uninterrupted path still works ---------------
  {
    const L = makeLeaseModel();
    const a = L.acquire('A');
    a.finish();
    const r = await a.promise;
    ok('PH28-01 / normal path unaffected: A is held, heartbeat running, no superseded flag',
      r.ok === true && !r.superseded && L.state().held === 'A' && L.state().heartbeat === 'hb:A');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. PH28-01 — the shipped source
  // ─────────────────────────────────────────────────────────────────────────
  ok('useEditLease tracks the wanted docId in a ref', /const wantRef = useRef\(null\);/.test(lease));
  ok('acquire() records its target as wanted before the round-trip', /wantRef\.current = d;\s*\n\s*try \{/.test(lease));
  ok('acquire() hands the lease back + returns superseded when the target changed mid-flight',
    /if \(wantRef\.current !== d\) \{\s*\n\s*releaseLease\(c, d, \{ uid, sessionId \}\);\s*\n\s*return \{ ok: true, superseded: true \};/.test(lease));
  ok('the degraded (offline) branch also bails when superseded', /if \(wantRef\.current !== d\) return \{ ok: true, superseded: true \};/.test(lease));
  ok('release() invalidates any in-flight acquire', /wantRef\.current = null;\s*\/\/ any in-flight acquire is now unwanted/.test(lease));
  ok('the heartbeat / heldRef install is still gated on a NON-superseded resolve',
    /heldRef\.current = \{ collectionName: c, docId: d \};\s*\n\s*setMine\(true\);\s*\n\s*stopHeartbeat\(\);\s*\n\s*hbRef\.current = setInterval/.test(lease));

  // ─────────────────────────────────────────────────────────────────────────
  // 3. PH28-01 — the two consumers that GATE record display behind the acquire
  //    must abandon a superseded result instead of opening the stale record.
  // ─────────────────────────────────────────────────────────────────────────
  ok('CustomersModule.openCustomerEditor bails on a superseded acquire (before setEditCust)',
    /const r = await lease\.acquire\(c\.id\);[\s\S]{0,260}if \(r\.superseded\) return;[\s\S]{0,400}setEditCust\(c\);/.test(cust));
  ok('JobCardModule.loadCard bails on a superseded acquire (before setLeasedJobNo / applyCard)',
    /const r = await jcLease\.acquire\(jc\.jobNo\);[\s\S]{0,320}if \(r\.superseded\) return;[\s\S]{0,200}setLeasedJobNo\(jc\.jobNo\);/.test(jc));
  ok('every other editor already commits its record target SYNCHRONOUSLY (no await before setEdit)',
    // Vehicles / Parts / Suppliers set the target then reconcile the lease in a guarded effect
    /const openEdit = \(vehicle, section = null\) => \{ setEdit\(vehicle\); setEditSection\(section\); \};/.test(read('components/vehicles/VehiclesModule.jsx'))
    && /onEditPart=\{\(p\) => \{ setEditPart\(p\); setShowModal\(true\); \}\}/.test(dash)
    && /onEdit=\{\(s\) => \{ setEditSupplier\(s\); setShowSupplierModal\(true\); \}\}/.test(dash));

  // ─────────────────────────────────────────────────────────────────────────
  // 4. PH28-02 — Back does not swap the module behind an open inventory modal
  // ─────────────────────────────────────────────────────────────────────────
  ok('a blockingModalRef exists and is documented as the PH28-02 guard',
    /const blockingModalRef = useRef\(false\);/.test(dash) && /PHASE 28 \(PH28-02\)/.test(dash));
  ok('blockingModalRef reflects the five tab-independent modals',
    /blockingModalRef\.current = !!\(showModal \|\| showSupplierModal \|\| checkoutPart \|\| restockTarget \|\| adjustTarget\);/.test(dash));
  ok('onPop refuses to switch tabs (snaps the hash back) while a blocking modal is open',
    /if \(blockingModalRef\.current\) \{ snapBack\(\); return; \}/.test(dash));

  // ─────────────────────────────────────────────────────────────────────────
  // 5. PH28-03 — Back/Forward honours the same unsaved-changes guard as a click
  // ─────────────────────────────────────────────────────────────────────────
  ok('onPop runs the settings-dirty confirm (same string as setActiveTab)',
    /if \(settingsDirtyRef\.current && typeof window !== 'undefined'\s*\n\s*&& !window\.confirm\('You have unsaved settings\. Leave without saving\?'\)\) \{ snapBack\(\); return; \}/.test(dash));
  ok('onPop runs the module-dirty confirm (same string as setActiveTab)',
    /if \(moduleDirtyRef\.current && typeof window !== 'undefined'\s*\n\s*&& !window\.confirm\('You have unsaved changes\. Leave without saving\?'\)\) \{ snapBack\(\); return; \}/.test(dash));
  ok('onPop no-ops a same-tab pop (no spurious prompt on a redundant history entry)',
    /if \(t === activeTabRef\.current\) return;/.test(dash));
  ok('setActiveTab (the sidebar-click path) still has its own identical guards',
    /if \(tab !== 'settings' && settingsDirtyRef\.current\) \{[\s\S]{0,140}window\.confirm\('You have unsaved settings/.test(dash)
    && /if \(tab !== activeTabRef\.current && moduleDirtyRef\.current\) \{[\s\S]{0,140}window\.confirm\('You have unsaved changes/.test(dash));

  // -- PH28-03 model: onPop with a dirty module + user answers "stay" -------
  function onPopModel({ targetTab, activeTab, moduleDirty, blockingModal, confirmAnswer }) {
    let tab = activeTab, snappedBack = false;
    const snapBack = () => { snappedBack = true; };
    const confirm = () => confirmAnswer;
    // (mirrors the shipped onPop branch order)
    if (targetTab === activeTab) return { tab, snappedBack };
    if (blockingModal) { snapBack(); return { tab, snappedBack }; }
    if (moduleDirty && !confirm()) { snapBack(); return { tab, snappedBack }; }
    tab = targetTab;
    return { tab, snappedBack };
  }
  {
    const stay = onPopModel({ targetTab: 'vehicles', activeTab: 'customers', moduleDirty: true, blockingModal: false, confirmAnswer: false });
    ok('PH28-03 model: dirty + "stay" → tab unchanged AND hash snapped back', stay.tab === 'customers' && stay.snappedBack === true);
    const leave = onPopModel({ targetTab: 'vehicles', activeTab: 'customers', moduleDirty: true, blockingModal: false, confirmAnswer: true });
    ok('PH28-03 model: dirty + "leave" → navigation proceeds', leave.tab === 'vehicles' && leave.snappedBack === false);
    const clean = onPopModel({ targetTab: 'vehicles', activeTab: 'customers', moduleDirty: false, blockingModal: false, confirmAnswer: false });
    ok('PH28-03 model: not dirty → Back works normally, no prompt', clean.tab === 'vehicles');
    const modal = onPopModel({ targetTab: 'overview', activeTab: 'inventory', moduleDirty: false, blockingModal: true, confirmAnswer: true });
    ok('PH28-02 model: blocking modal → Back inert, hash snapped back', modal.tab === 'inventory' && modal.snappedBack === true);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 6. The generic out-of-order-async invariant, as a reusable model:
  //    request A, then request B; B resolves first, then A. Latest wins.
  // ─────────────────────────────────────────────────────────────────────────
  function latestWins() {
    let wanted = null, shown = null;
    const select = (id) => {
      wanted = id;
      let done; const p = new Promise((r) => { done = r; });
      return { finish: (data) => { if (wanted === id) shown = data; done(); }, promise: p };
    };
    return { select, shown: () => shown, wanted: () => wanted };
  }
  {
    const M = latestWins();
    const a = M.select('A');
    const b = M.select('B');
    b.finish('B-data');
    a.finish('A-data');   // stale — must NOT overwrite
    ok('generic out-of-order model: the last-requested record is the one shown', M.shown() === 'B-data');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 7. No-regression — the PASS-area invariants this phase relied on
  // ─────────────────────────────────────────────────────────────────────────
  ok('record selection is a pure derivation, not a fetch (Customers)',
    /const selected = useMemo\(\(\) => customers\.find\(\(c\) => c\.id === selId\) \|\| null, \[customers, selId\]\);/.test(cust));
  ok('record selection is a pure derivation, not a fetch (Vehicles)',
    /const selected = useMemo\(\(\) => rows\.find\(\(r\) => r\.id === selId\) \|\| null, \[rows, selId\]\);/.test(read('components/vehicles/VehiclesModule.jsx')));
  ok('search is useDeferredValue (concurrent, abandons stale renders) — NOT an async debounce',
    /export function useDeferredSearch\(value\) \{\s*\n\s*const deferred = useDeferredValue\(value\);/.test(useSearch));
  ok('the kept useDebounced still clears its timer on every change (no late fire after nav)',
    /const t = setTimeout\(\(\) => setDebounced\(value\), delay\);\s*\n\s*return \(\) => clearTimeout\(t\);/.test(useSearch));
  ok('the once-registered hashchange listener still guards its stale closure via refs',
    /activeTabRef\.current/.test(dash) && /window\.addEventListener\('hashchange', onPop\)/.test(dash)
    && /return \(\) => window\.removeEventListener\('hashchange', onPop\)/.test(dash));
  ok('modules still unmount on tab switch (conditional render, one editor at a time)',
    /\{activeTab === 'customers' && \(/.test(dash) && /\{activeTab === 'vehicles' && \(/.test(dash));
  ok('inventory pagination still clamps an out-of-range page after data shrinks',
    /useEffect\(\(\) => \{ if \(invPage > invTotalPages\) setInvPage\(invTotalPages\); \}, \[invPage, invTotalPages\]\);/.test(dash));

  console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
  process.exit(FAIL ? 1 : 0);
})();
