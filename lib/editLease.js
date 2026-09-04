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
import { withTimeout, LEASE_TIMEOUT_MS } from './txTimeout';

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
  // Phase 6b (PH6-03) — bound the wait; the caller (hooks/useEditLease.js `acquire`)
  // already treats ANY non-'lease/held' failure as "don't block the edit, the
  // Phase 1a `_rev` guard still protects the save" — a TxTimeoutError falls into
  // that same existing degrade-gracefully branch with no caller change needed.
  await withTimeout(runTransaction(db, async (tx) => {
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
  }), LEASE_TIMEOUT_MS, 'Acquiring the edit lease');
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
  // Phase 6b (PH6-03) — bound the wait; the caller already `.catch(() => release())`s
  // on ANY failure, so a bounded timeout just makes a stuck heartbeat let go sooner
  // instead of leaving an interval re-firing against an indefinitely-hung promise.
  await withTimeout(runTransaction(db, async (tx) => {
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
  }), LEASE_TIMEOUT_MS, 'Renewing the edit lease');
  return true;
}

/**
 * Release my lease. Transactional and session-aware: only touches the lock if
 * it is genuinely mine (my uid AND my sessionId) — so a stale tab cleaning up on
 * close can't affect a lease that another tab of the same user has since taken
 * over. Best-effort: never blocks the UI, expiry is the backstop regardless.
 *
 * Phase 7b (PH7-27) — this now UPDATES the document to an already-past
 * `expiresAt` instead of deleting it. A Firestore `delete` carries no payload,
 * so the rules have nothing to check a releasing session's identity against —
 * `firestore.rules` closes that gap by restricting `delete` to already-expired
 * documents only, which means an ACTIVE lease can no longer be removed by a
 * delete call at all, from any session, including its own. Releasing is
 * therefore now the exact same shape as a renewal, just with the expiry
 * pointed at the past instead of the future (see `releaseShapeOk()` in the
 * rules) — reusing the identical session-aware update path renew already
 * uses, rather than needing a delete-specific rule that can't exist.
 * Nothing downstream distinguishes "document gone" from "document present but
 * expired": `leaseHeldByOther`/`leaseIsMine` above and `acquireLease`'s own
 * `active` check all key off `expiresAt` vs. now, never existence — so this is
 * observably identical to every reader of the lease.
 */
export async function releaseLease(collectionName, docId, owner) {
  const ref = leaseRef(collectionName, docId);
  try {
    // Phase 6b (PH6-03) — already wrapped in a try/catch that swallows every
    // failure (best-effort cleanup); bounding the wait just avoids leaving a
    // dangling promise on a black-hole network past this call returning.
    await withTimeout(runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const d = snap.data();
      const mine = !!owner && d.ownerUid === owner.uid && d.sessionId === owner.sessionId;
      if (!mine) return; // not ours to touch — the expiry backstop frees it regardless
      tx.update(ref, {
        ownerUid: owner.uid,
        ownerEmail: d.ownerEmail || '',
        sessionId: owner.sessionId,
        heartbeatAt: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() - 1000),
      });
    }), LEASE_TIMEOUT_MS, 'Releasing the edit lease');
  } catch (e) {
    // A rejection here just means someone already took over (this session's
    // own identity no longer matches, so `mine` above would be false on the
    // NEXT attempt anyway), or we're offline. The lease's own expiry
    // guarantees the record frees up regardless of whether this ever lands.
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
