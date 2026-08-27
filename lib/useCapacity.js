// lib/useCapacity.js
//
// React-connecting layer for services/capacityService.js. Lives in lib/ (not hooks/)
// per hooks/README.md's own rule — this touches Firestore-backed data and toasts, so it
// belongs "alongside its domain", the same way lib/useSearch.js does for search.
import { useState, useEffect, useCallback, useRef } from 'react';
import { getCapacityStatus } from '../services/capacityService';

/**
 * Live active-record count/limit status for one capacity module.
 *
 * Refetches on mount and whenever `refreshKey` changes — bump `refreshKey` (e.g. a
 * counter in the caller's state) after a cleanup completes or a new record is created,
 * so the banner/guard reading this never shows a stale count.
 */
export function useCapacityStatus(moduleKey, { demoMode, refreshKey = 0 } = {}) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await getCapacityStatus(moduleKey, { demoMode });
      if (mountedRef.current) setStatus(s);
    } catch (e) {
      console.error(`[capacity] status check failed for "${moduleKey}":`, e);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [moduleKey, demoMode]);

  useEffect(() => { refresh(); }, [refresh, refreshKey]);

  return { status, loading, refresh };
}

/**
 * CREATE-TIME CAPACITY GUARD. Call this at the very top of a "New X" handler, BEFORE
 * opening any create form/modal — checked and awaited synchronously in that handler, not
 * wired through a component's render cycle. Blocking BEFORE the form ever opens is what
 * satisfies "new records must not be silently lost": there is no in-progress draft to
 * lose, because the user was never let into the form in the first place while blocked.
 *
 * @returns {Promise<{blocked: boolean, status: object}>}
 */
export async function checkCapacityGuard(moduleKey, { demoMode } = {}) {
  const status = await getCapacityStatus(moduleKey, { demoMode });
  return { blocked: status.atLimit, status };
}
