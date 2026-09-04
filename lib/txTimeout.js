// lib/txTimeout.js
//
// CONCURRENCY PHASE 6b (PH6-03) — bound how long the UI waits for a Firestore
// `runTransaction` call without pretending to cancel it.
//
// Firestore gives no cancellation API for a transaction already in flight, and a
// client-side "cancel" could never undo a commit that already reached the server —
// so this does NOT abort anything. It races the real promise against a timer:
//
//   - the real promise settles first (the overwhelmingly common case)  -> its
//     value/rejection passes straight through, unchanged. Fast path is untouched.
//   - the timer fires first (a "black-hole" network with no fast socket error) ->
//     this rejects with a TxTimeoutError so the caller can stop the spinner and
//     show an accurate "we don't know yet" state, while the ORIGINAL promise keeps
//     running in the background exactly as if this wrapper didn't exist.
//
// `onSettleLate`, if given, still fires once the real promise eventually resolves
// or rejects — however long that takes — so a caller can reconcile durable state
// (e.g. clear a `ph5b:op:*` operation id, PH5-04/PH5-02 style) once the outcome is
// actually known, instead of leaving it "possibly pending" forever.
//
// Every existing catch block already treats an error with NO `.code` and a plain
// thrown `message` as a definite, nothing-committed business rejection (see
// `isDefiniteNoCommit` throughout components/InventoryDashboard.js) and anything
// else — permission errors, a dropped connection, now a TxTimeoutError — as
// AMBIGUOUS: keep the durable operation id, tell the user to check before retrying.
// TxTimeoutError carries `.code = 'tx/timeout'` for exactly that reason: it falls
// into the existing ambiguous branch for free, and callers only need to special-case
// the copy, not the retry-safety logic, which was already correct.

// Chosen threshold: comfortably above a normal Firestore transaction round trip
// (sub-second on wifi/LTE, typically 1-3s on a slow 3G) so a working-but-slow
// connection never trips it, while still bounding a genuinely stuck black-hole
// connection to a single-digit number of seconds instead of an unbounded wait.
export const TX_TIMEOUT_MS = 12000;

// Edit-lease acquire is a UX-only coordination step (see lib/editLease.js) whose
// caller ALREADY falls back to "don't block the edit" on any failure — so it should
// give up sooner than a financial/inventory mutation, not wait as long to do so.
export const LEASE_TIMEOUT_MS = 6000;

export class TxTimeoutError extends Error {
  constructor(label) {
    super(`${label || 'This operation'} is taking longer than expected.`);
    this.name = 'TxTimeoutError';
    this.code = 'tx/timeout';
  }
}

/**
 * Copy for the one new outcome this phase adds: the result is genuinely unknown,
 * not a confirmed failure. Every call site already has its own accurate copy for
 * confirmed failure and confirmed success; this is the third state.
 */
export function timeoutMessage(thing) {
  return `Connection is taking longer than expected. ${thing || 'The result'} may already be recorded — check before retrying.`;
}

/**
 * @param {Promise} promise            an ALREADY-STARTED promise (e.g. the return
 *                                      value of `runTransaction(db, cb)`) — never a
 *                                      factory, so wrapping it can never invoke the
 *                                      underlying operation twice.
 * @param {number} ms                  how long to wait before surfacing TxTimeoutError.
 * @param {string} [label]             used in the TxTimeoutError's own message.
 * @param {(err, value) => void} [onSettleLate]  called once, whenever `promise`
 *                                      itself finally settles — even if that is long
 *                                      after this function already returned via the
 *                                      timeout branch. Called with (error, undefined)
 *                                      on rejection or (null, value) on resolution.
 */
export function withTimeout(promise, ms = TX_TIMEOUT_MS, label, onSettleLate) {
  let settled = false;
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (!settled) reject(new TxTimeoutError(label));
    }, ms);
  });
  promise.then(
    (v) => { settled = true; clearTimeout(timer); if (onSettleLate) onSettleLate(null, v); },
    (e) => { settled = true; clearTimeout(timer); if (onSettleLate) onSettleLate(e, undefined); },
  );
  return Promise.race([promise, timeout]);
}

export const isTxTimeout = (err) => !!err && err.code === 'tx/timeout';
