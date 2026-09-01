// hooks/useEditLease.js
//
// CONCURRENCY PHASE 1b — the one reusable React binding for the single-active-
// editor lease (see lib/editLease.js). Every entity editor uses this; the lease
// logic lives in one place, not copied per component.
//
// Usage per module: mount it keyed to the record whose detail is currently
// selected / whose editor could be opened.
//
//   const lease = useEditLease('customers', selectedId);
//   ...
//   // opening the editor for record `c`:
//   const r = await lease.acquire(c.id);
//   if (!r.ok) { toast.error(`🔒 ${r.heldBy} is editing this record.`); return; }
//   openEditor(c);
//   ...
//   // closing the editor (save OR cancel):
//   await lease.release();
//
//   // in the detail view / Edit button (live via the observer):
//   <button disabled={lease.status === 'held'} ...>
//   {lease.status === 'held' && <Banner>Currently being edited by {lease.heldByEmail}</Banner>}
//
// While a lease is held a heartbeat renews it every HEARTBEAT_MS. It is released
// on editor close, on unmount, and (best-effort) on tab close; the lease's
// server-side expiry is the real backstop if all of those fail.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  acquireLease, renewLease, releaseLease, observeLease,
  leaseHeldByOther, HEARTBEAT_MS,
} from '../lib/editLease';

export function useEditLease(collectionName, docId) {
  const { user, sessionId, demoMode } = useAuth();
  const uid = user && user.uid;
  const email = user && user.email;

  // Live-observe the lease only for a real signed-in production session.
  const canLease = !demoMode && !!uid && !!sessionId;
  const observing = canLease && !!docId;

  const [lock, setLock] = useState(null);
  const [mine, setMine] = useState(false);
  const heldRef = useRef(null);   // { collectionName, docId } we currently hold
  const hbRef = useRef(null);

  const stopHeartbeat = useCallback(() => {
    if (hbRef.current) { clearInterval(hbRef.current); hbRef.current = null; }
  }, []);

  const release = useCallback(async () => {
    stopHeartbeat();
    const held = heldRef.current;
    heldRef.current = null;
    setMine(false);
    if (held && canLease) await releaseLease(held.collectionName, held.docId, { uid, sessionId });
  }, [canLease, stopHeartbeat, uid, sessionId]);

  const acquire = useCallback(async (targetId) => {
    const c = collectionName;
    const d = targetId || docId;
    if (!canLease || !d) return { ok: true };   // demo / no record → editing unrestricted
    try {
      await acquireLease(c, d, { uid, email, sessionId });
      heldRef.current = { collectionName: c, docId: d };
      setMine(true);
      stopHeartbeat();
      hbRef.current = setInterval(() => {
        renewLease(c, d, { uid, email, sessionId }).catch(() => { release(); });
      }, HEARTBEAT_MS);
      return { ok: true };
    } catch (e) {
      if (e && e.code === 'lease/held') return { ok: false, heldBy: e.heldBy || 'another user' };
      // Any other failure (offline, or a clock outside the rules' expiry window):
      // don't block the edit — the Phase 1a `_rev` transaction still protects the
      // save. The user just doesn't get the coordination lock this time.
      heldRef.current = { collectionName: c, docId: d, degraded: true };
      setMine(true);
      return { ok: true, degraded: true };
    }
  }, [collectionName, docId, canLease, uid, email, sessionId, stopHeartbeat, release]);

  useEffect(() => {
    if (!observing) { setLock(null); return undefined; }
    return observeLease(collectionName, docId, setLock);
  }, [observing, collectionName, docId]);

  // Best-effort release on tab close; the server-side expiry is the real guarantee.
  useEffect(() => {
    const onHide = () => {
      const held = heldRef.current;
      if (held && !held.degraded && canLease) releaseLease(held.collectionName, held.docId, { uid, sessionId });
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [canLease, uid, sessionId]);

  // Release whatever we hold when this hook unmounts.
  useEffect(() => () => { release(); }, [release]);

  const heldByOther = observing && leaseHeldByOther(lock, uid, sessionId);

  return {
    // 'available' — free to edit · 'mine' — I hold the lease · 'held' — someone else does
    status: mine ? 'mine' : (heldByOther ? 'held' : 'available'),
    heldByEmail: heldByOther ? (lock.ownerEmail || 'another user') : null,
    acquire,
    release,
  };
}
