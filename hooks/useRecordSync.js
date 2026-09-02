// hooks/useRecordSync.js
//
// CONCURRENCY PHASE 1c — the one reusable React binding for "watch the open record
// for changes another session makes" (see lib/recordSync.js). Every viewer and
// every editor uses this; the logic lives in one place.
//
//   const sync = useRecordSync('customers', openId, openedRecord?._rev);
//   ...
//   // viewer:  <RecordUpdatedNotice status={sync.status} onAcknowledge={sync.markSynced} />
//   // editor:  <RecordConflictBanner status={sync.status} onReview={...} onClose={...} />
//   //          <ConflictReviewDialog latest={sync.latest} .../>
//   // after this session's OWN save:  sync.markSynced(newRev)
//
// It watches the RECORD document only — never the edit lease — so lease
// acquire / renew / release can never look like a record change.

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { revOf } from '../lib/concurrency';
import { observeRecord, recordSyncState } from '../lib/recordSync';

export function useRecordSync(collectionName, docId, openedRev) {
  const { demoMode } = useAuth();
  const active = !demoMode && !!docId;

  const [live, setLive] = useState(null);
  const baselineRef = useRef(revOf({ _rev: openedRev }));
  const keyRef = useRef(null);
  const [, bump] = useReducer((x) => (x + 1) % 1e9, 0);

  // Re-baseline whenever the watched record changes (new editor / new selection).
  // Deriving a ref during render is the same pattern AuthContext uses for its
  // per-tab sessionId — it must NOT be an effect or the first snapshot after a
  // switch would compare against the previous record's revision.
  const nextKey = active ? `${collectionName}/${String(docId)}` : null;
  if (keyRef.current !== nextKey) {
    keyRef.current = nextKey;
    baselineRef.current = revOf({ _rev: openedRev });
  }

  useEffect(() => {
    if (!active) { setLive(null); return undefined; }
    setLive(null);
    return observeRecord(collectionName, docId, setLive);
  }, [active, collectionName, docId]);

  const status = active ? recordSyncState(baselineRef.current, live) : 'current';

  // Acknowledge the current server revision:
  //  - the user clicked "View Updated Record" / "Review Latest", or
  //  - this session just saved its own change (pass the new `_rev` so it doesn't
  //    self-alarm before the listener has caught up).
  const markSynced = useCallback((rev) => {
    if (typeof rev === 'number' && rev >= 0) baselineRef.current = rev;
    else if (live && live.exists !== false) baselineRef.current = revOf(live);
    else return;
    bump();
  }, [live]);

  return {
    status,                                                   // 'current' | 'updated' | 'deleted'
    latest: live && live.exists !== false ? live : null,      // the fresh server record
    markSynced,
  };
}
