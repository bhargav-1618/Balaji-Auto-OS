// hooks/useLiveCollection.js
//
// REFACTOR PHASE 6 — the React-lifecycle half of a live Firestore collection
// subscription, factored out of the ~8 identical hand-rolled blocks that fronted
// the dashboard's simplest listeners:
//
//     useEffect(() => {
//       if (demoMode) return;
//       const unsub = onSnapshot(q, next, error);
//       return unsub;
//     }, []);
//
// What this hook owns, and nothing more:
//   1. the demo gate — a disabled listener never calls `subscribe()`, exactly
//      like the `if (demoMode) return` guard it replaces. `enabled` is read once
//      on mount (every caller passes `!demoMode`, which is session-stable — demo
//      vs. production is fixed by the route/auth for the life of the mount).
//   2. mount-once subscribe + unmount unsubscribe — `subscribe()` runs once and
//      must return its Firestore unsubscribe fn, which React calls on unmount.
//      A `[]` dependency list, matching every inline listener this replaces.
//
// What it deliberately does NOT know about: the query, ordering, limits, the
// snapshot shape, mapping, or error routing. All of that stays at the call site
// (visible, greppable, individually testable). A listener with special snapshot
// handling — `hasPendingWrites` gating, `includeMetadataChanges`, derived local
// state, a purge side-effect, or a non-`[]` dependency list (a nonce-driven
// re-subscribe, an `isAdmin` gate) — keeps its own inline `useEffect` and does
// not use this hook.

import { useEffect } from 'react';

/**
 * @param {boolean} enabled   subscribe only when true (callers pass `!demoMode`)
 * @param {() => (undefined | (() => void))} subscribe
 *        invoked once on mount; return the Firestore unsubscribe function
 */
export function useLiveCollection(enabled, subscribe) {
  useEffect(() => {
    if (!enabled) return undefined;
    const unsub = subscribe();
    return typeof unsub === 'function' ? unsub : undefined;
    // Mount-once by design: `enabled` (= !demoMode) does not change within a
    // session, and every listener this replaces used a `[]` dependency list for
    // exactly that reason. Re-subscribing listeners stay inline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
