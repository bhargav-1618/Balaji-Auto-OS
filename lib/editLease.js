// lib/editLease.js
//
// CONCURRENCY PHASE 1b — single active editor per record.
//
// A transient coordination lock so two people don't waste time editing the same
// customer / part / supplier / job card / invoice at once. It is a UX mechanism
// ONLY — the authoritative data-integrity layer is the Phase 1a `_rev`
// transaction on the record itself, which is unchanged and still runs on every
// save regardless of who holds a lease.
//
// Model:  editLocks/<collection>__<docId>
//         { ownerUid, ownerEmail, sessionId, acquiredAt, heartbeatAt, expiresAt }
//
// Timings (see firestore.rules editLocks — it caps expiresAt at 3 minutes out):
//   LEASE_MS      90s  — a lease is dead 90s after its last heartbeat
//   HEARTBEAT_MS  30s  — a healthy editor renews every 30s (always ≥60s runway)
//
// Expiry is server-authoritative: the rules compare expiresAt to request.time,
// and a takeover only succeeds once the previous lease is genuinely expired. A
// crashed / disconnected editor therefore frees the record automatically after
// ~90s with no admin action.
//
// Demo mode never calls any of this (single in-memory client, no Firestore).

import {
  db, doc, onSnapshot, runTransaction, serverTimestamp, Timestamp,
} from './firebase';

export const LEASE_MS = 90 * 1000;
export const HEARTBEAT_MS = 30 * 1000;

export const leaseId = (collectionName, docId) => `${collectionName}__${String(docId)}`;
const leaseRef = (collectionName, docId) => doc(db, 'editLocks', leaseId(collectionName, docId));

const toMillis = (ts) => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : (typeof ts === 'number' ? ts : 0));

/** Is `lock` an ACTIVE lease held by someone other than {uid, sessionId}? */
export function leaseHeldByOther(lock, uid, sessionId) {
  if (!lock) return false;
  const active = toMillis(lock.expiresAt) > Date.now();
  const mine = lock.ownerUid === uid && lock.sessionId === sessionId;
  return active && !mine;
}

/** Is `lock` MY active lease? */
export function leaseIsMine(lock, uid, sessionId) {
  return !!lock && lock.ownerUid === uid && lock.sessionId === sessionId && toMillis(lock.expiresAt) > Date.now();
}

class LeaseError extends Error {
  constructor(code, heldBy) { super(code); this.name = 'LeaseError'; this.code = code; this.heldBy = heldBy; }
}

/**
 * Acquire the edit lease for a record. Transactional: two clients calling this at
 * the same moment produce exactly one winner. Succeeds if the lease is free, has
 * EXPIRED, or is already ours (a re-acquire / take-back). Throws
 * LeaseError('lease/held', <ownerEmail>) if another client holds it actively.
 */
export async function acquireLease(collectionName, docId, { uid, email, sessionId }) {
  const ref = leaseRef(collectionName, docId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) {
      const d = snap.data();
      const active = toMillis(d.expiresAt) > Date.now();
      const mine = d.ownerUid === uid && d.sessionId === sessionId;
      if (active && !mine) throw new LeaseError('lease/held', d.ownerEmail || 'another user');
    }
    tx.set(ref, {
      ownerUid: uid,
      ownerEmail: email || '',
      sessionId,
      acquiredAt: serverTimestamp(),
      heartbeatAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + LEASE_MS),
    });
  });
  return true;
}

/**
 * Extend my lease (heartbeat). Transactional and session-aware: Firestore rules
 * can only gate writes by `ownerUid`, so a stale tab of the SAME user (same uid,
 * different sessionId) that resumes from sleep would otherwise silently clobber a
 * newer lease another tab has taken over. This refuses in that case instead. A
 * rejection means I no longer hold the lease — the caller drops its "mine" state.
 */
export async function renewLease(collectionName, docId, { uid, email, sessionId }) {
  const ref = leaseRef(collectionName, docId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) {
      const d = snap.data();
      const mine = d.ownerUid === uid && d.sessionId === sessionId;
      const expired = toMillis(d.expiresAt) <= Date.now();
      if (!mine && !expired) throw new LeaseError('lease/lost', d.ownerEmail || 'another editor');
    }
    tx.set(ref, {
      ownerUid: uid,
      ownerEmail: email || '',
      sessionId,
      acquiredAt: serverTimestamp(),
      heartbeatAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + LEASE_MS),
    });
  });
  return true;
}

/**
 * Release my lease. Transactional and session-aware: only clears the lock if it
 * is genuinely mine (my uid AND my sessionId) or already expired — so a stale tab
 * cleaning up on close can't delete a lease that another tab of the same user has
 * since taken over. Best-effort: never blocks the UI, expiry is the backstop.
 */
export async function releaseLease(collectionName, docId, owner) {
  const ref = leaseRef(collectionName, docId);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const d = snap.data();
      const mine = !!owner && d.ownerUid === owner.uid && d.sessionId === owner.sessionId;
      const expired = toMillis(d.expiresAt) <= Date.now();
      if (mine || expired) tx.delete(ref);
    });
  } catch (e) {
    // A rejection here just means someone already took over an expired lease, or
    // we're offline. The lease's own expiry guarantees the record frees up.
  }
}

/**
 * Live-observe a record's edit lease. `cb(lock | null)` fires on every change.
 * Returns an unsubscribe function. Used by every open viewer so "being edited by
 * another user" appears and clears without a refresh.
 */
export function observeLease(collectionName, docId, cb) {
  return onSnapshot(
    leaseRef(collectionName, docId),
    (snap) => cb(snap.exists() ? snap.data() : null),
    () => cb(null),
  );
}
