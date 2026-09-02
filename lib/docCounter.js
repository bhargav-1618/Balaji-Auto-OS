// lib/docCounter.js
//
// CONCURRENCY PHASE 2 — authoritative, collision-proof document numbering.
//
// Invoice numbers were allocated client-side as `max(existing) + 1` with no
// reservation, so two terminals billing in the same moment both computed
// INV-0008 and both saved — two documents, one legal serial (GST Rule 46(b)
// requires unique, consecutive serials).
//
// This replaces that with a Firestore transaction on a per-sequence counter
// document:
//
//     counters/invoices    { next: <int> }
//     counters/estimates   { next: <int> }
//
// The number is allocated AT SAVE TIME (not previewed): the editor shows no
// number until the record is persisted, at which point `allocateNumber()` hands
// out exactly one value and advances the counter in the same transaction.
//
// RETRY SAFETY: a Firestore transaction may re-run its callback under contention.
// The callback here only READS the counter and BUFFERS one write; the write is
// applied solely on commit, so two concurrent attempts can never both succeed —
// the loser re-reads the (now higher) value and returns that instead. There is
// no other side effect, so the retry is safe.
//
// SELF-HEALING: `seedFrom` is the highest number the caller already knows about
// (from its loaded list) + 1. It is used to INITIALISE a missing counter and to
// pull forward a counter that somehow lags the real book. `Math.max(current,
// seedFrom)` means the counter can only ever move FORWARD — it never decrements
// and never issues a number at or below one that already exists.
//
// FAILURE SEMANTICS: allocation commits before the record write. If the record
// write then fails, the allocated number is SKIPPED (a gap), never reused for a
// different document. A gap is legal under GST Rule 46(b); a duplicate is not.
//
// Demo mode has a single in-memory client and no server — see
// services/persistenceStore.js for the equivalent local implementation.

import { db, doc, runTransaction } from './firebase';

const COUNTERS = 'counters';

/** Coerce any input to a positive integer seed (>= 1). */
export function normalizeSeed(seedFrom) {
  const n = Math.floor(Number(seedFrom));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * The pure allocation decision, shared by the production transaction, the demo
 * backend and the tests so all three agree.
 *
 * @param {number|undefined} currentNext  the counter's stored `next`, if any
 * @param {number} seedFrom               highest known number + 1
 * @returns {{ allocated: number, nextNext: number }}
 */
export function allocationStep(currentNext, seedFrom) {
  const current = Number.isInteger(currentNext) && currentNext >= 1 ? currentNext : 0;
  const allocated = Math.max(current, normalizeSeed(seedFrom));
  return { allocated, nextNext: allocated + 1 };
}

/** Format an allocated integer as a padded document number, e.g. (INV, 8) -> "INV-0008". */
export function formatDocNo(prefix, n) {
  return `${String(prefix || 'INV').toUpperCase()}-${String(n).padStart(4, '0')}`;
}

/**
 * Allocate the next number in a named sequence, atomically.
 *
 * @param {string} sequence  the counter doc id, e.g. 'invoices' | 'estimates'
 * @param {number} seedFrom  highest number the caller already knows about + 1
 * @returns {Promise<number>} the allocated integer (caller formats it)
 */
export async function allocateNumber(sequence, seedFrom = 1) {
  const ref = doc(db, COUNTERS, String(sequence));
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const { allocated, nextNext } = allocationStep(
      snap.exists() ? snap.data().next : undefined,
      seedFrom,
    );
    // { merge: true } so a future field addition to the counter doc is non-breaking;
    // the rules still enforce `hasOnly(['next'])`, so this write carries only `next`.
    tx.set(ref, { next: nextNext }, { merge: true });
    return allocated;
  });
}
