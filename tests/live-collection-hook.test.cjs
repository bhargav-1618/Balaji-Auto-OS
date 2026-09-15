/**
 * tests/live-collection-hook.test.cjs — REFACTOR PHASE 6
 *
 * hooks/useLiveCollection.js is the extracted React-lifecycle half of the
 * dashboard's simplest Firestore listeners (sales, salesRollups, restocks,
 * stockAdjustments, reorderRequests, purchaseOrders, categories, customVehicles).
 *
 * The refactor's whole safety claim is "same behaviour, one place":
 *   1. a disabled listener never subscribes           (demo mode isolation)
 *   2. an enabled listener subscribes exactly once     (mount-once, [] deps)
 *   3. the unsubscribe fn runs on unmount              (no listener leak)
 *   4. a subscribe that returns nothing does not crash on unmount
 *   5. the hook is Firestore-agnostic — query / mapping / error routing stay at
 *      each call site (so the bounded-window + shared-error guarantees still hold)
 *   6. the four hasPendingWrites-gated listeners were NOT folded in
 *
 * 1–4 execute the real hook. 5–6 are source guards on the real call sites.
 */
require('./setup.cjs');
const fs = require('fs');
const path = require('path');
const React = require('react');
const { act } = require('react');
const { createRoot } = require('react-dom/client');
const { useLiveCollection } = require('../hooks/useLiveCollection.js');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};

console.log('\nREFACTOR PHASE 6 — useLiveCollection lifecycle\n');

// A harness component: calls the hook, and lets the test bump its own state to
// force re-renders (proving the subscription is mount-once, not per-render).
function makeHarness(enabled, subscribe) {
  let forceRerender;
  function Harness() {
    const [, setN] = React.useState(0);
    forceRerender = () => setN((n) => n + 1);
    useLiveCollection(enabled, subscribe);
    return null;
  }
  return { Harness, rerender: () => forceRerender && forceRerender() };
}

// ---- 1. disabled → never subscribes ---------------------------------------
{
  let subCalls = 0;
  const { Harness } = makeHarness(false, () => { subCalls += 1; return () => {}; });
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => { root.render(React.createElement(Harness)); });
  ok('enabled=false → subscribe() is never called (demo mode starts no listener)', subCalls === 0, `subCalls=${subCalls}`);
  act(() => { root.unmount(); });
}

// ---- 2 + 3. enabled → subscribes once, unsubscribes on unmount ------------
{
  let subCalls = 0, unsubCalls = 0;
  const { Harness, rerender } = makeHarness(true, () => { subCalls += 1; return () => { unsubCalls += 1; }; });
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => { root.render(React.createElement(Harness)); });
  ok('enabled=true → subscribe() called exactly once on mount', subCalls === 1, `subCalls=${subCalls}`);

  act(() => { rerender(); });
  act(() => { rerender(); });
  ok('re-render does NOT re-subscribe (mount-once, matching the [] deps it replaced)', subCalls === 1, `subCalls=${subCalls}`);
  ok('no premature unsubscribe while still mounted', unsubCalls === 0, `unsubCalls=${unsubCalls}`);

  act(() => { root.unmount(); });
  ok('unmount runs the Firestore unsubscribe exactly once (no listener leak)', unsubCalls === 1, `unsubCalls=${unsubCalls}`);
}

// ---- 4. subscribe returning a non-function is tolerated ------------------
{
  let crashed = null;
  const { Harness } = makeHarness(true, () => undefined);
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    act(() => { root.render(React.createElement(Harness)); });
    act(() => { root.unmount(); });
  } catch (e) { crashed = e; }
  ok('subscribe() → undefined does not crash the cleanup path', !crashed, crashed && crashed.message);
}

// ---- 5. the hook is Firestore-agnostic; call sites keep query/map/error ---
{
  const hook = fs.readFileSync(path.resolve(__dirname, '../hooks/useLiveCollection.js'), 'utf8');
  const hookImports = (hook.match(/^\s*import .+$/gm) || []).map((s) => s.trim());
  const hookCode = hook.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok('the hook imports only React (no Firestore, no repository, no lib) — pure effect lifecycle',
    hookImports.length === 1
    && hookImports[0] === "import { useEffect } from 'react';"
    && !/onSnapshot|firebase|collection\(|query\(/.test(hookCode));

  const dash = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');
  // each of the 8 folded listeners still carries its own onSnapshot + mapping at the call site
  const blocks = [...dash.matchAll(/useLiveCollection\(!demoMode, \(\) => onSnapshot\(([\s\S]*?)\n {2}\)\);/g)].map((m) => m[1]);
  ok('all 8 listeners are expressed as useLiveCollection(!demoMode, () => onSnapshot(...))', blocks.length === 8, `found ${blocks.length}`);
  ok('every folded listener maps snapshots itself: snap.docs.map((d) => ({ id: d.id, ...d.data() }))',
    blocks.every((b) => /snap\.docs\.map\(\(d\) => \(\{ id: d\.id, \.\.\.d\.data\(\) \}\)\)/.test(b)));
  ok('every folded listener routes its own error to the shared handleListenerError surface',
    blocks.every((b) => /\(err\) => handleListenerError\('[a-zA-Z]+', err\)/.test(b)));
  // the six bounded ledger windows keep their explicit orderBy + limit inline
  const bounded = blocks.filter((b) => /orderBy\(/.test(b));
  ok('the 6 bounded ledger windows keep orderBy + limit explicit at the call site (Phase 25 intact)',
    bounded.length === 6 && bounded.every((b) => /limit\((LIMITS\.[A-Z_]+|\d+)\)/.test(b)));
  ok('sales window still literally query(collection(db, COLLECTIONS.SALES), orderBy(\'createdAt\', \'desc\'), limit(LIMITS.SALES_LIVE))',
    /query\(collection\(db, COLLECTIONS\.SALES\), orderBy\('createdAt', 'desc'\), limit\(LIMITS\.SALES_LIVE\)\)/.test(dash));
}

// ---- 6. the hasPendingWrites-gated listeners were NOT folded in ----------
{
  const dash = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');
  ok('parts / customers / invoices / jobCards keep their own inline useEffect (hasPendingWrites gating preserved)',
    (dash.match(/if \(!snap\.metadata\.hasPendingWrites\)/g) || []).length >= 4
    && !/useLiveCollection\([\s\S]{0,600}hasPendingWrites/.test(dash));
  ok('the parts listener stays inline: bounded PARTS query + setPendingWrites + lastSync gating',
    /const q = query\(collection\(db, COLLECTIONS\.PARTS\), orderBy\('createdAt', 'desc'\), limit\(LIMITS\.PARTS_LIVE\)\)/.test(dash)
    && /setPendingWrites\(snap\.metadata\.hasPendingWrites\)/.test(dash)
    && /!snap\.metadata\.hasPendingWrites && !snap\.metadata\.fromCache\) \{ setLastSync/.test(dash));
  ok('the recoveryMeta doc listener (purgeVault expiry side-effect) stays inline',
    /onSnapshot\(\s*\n\s*doc\(db, 'recoveryMeta', 'current'\)[\s\S]{0,400}purgeVault\(data\.snapshotId\)/.test(dash));
  ok('the auditLog listener stays inline: isAdmin enable-gate + setAuditLog([]) on disable + [isAdmin] deps',
    /if \(!isAdmin\) \{ setAuditLog\(\[\]\); return; \}/.test(dash)
    && /const q = query\(collection\(db, COLLECTIONS\.AUDIT_LOG\), orderBy\('createdAt', 'desc'\), limit\(LIMITS\.AUDIT_LIVE\)\)/.test(dash)
    && /return unsub;\s*\n\s*\}, \[isAdmin\]\);/.test(dash));
}

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
