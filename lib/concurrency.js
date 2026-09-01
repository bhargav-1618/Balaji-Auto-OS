// lib/concurrency.js
//
// Optimistic-concurrency primitives shared by the persistence layer and the
// repository. Phase 1a — the authoritative data-integrity net: a stale client
// can never silently overwrite a newer server document.
//
// A protected document carries an integer `_rev`. It is concurrency METADATA,
// not a business field — nothing in any form binds to it. An editor captures the
// `_rev` it loaded; the guarded write re-reads the server document inside a
// Firestore transaction, refuses the write if the document is gone
// (`conc/deleted`) or its `_rev` moved (`conc/stale`), and otherwise writes with
// `_rev` incremented exactly once.
//
// Legacy documents written before this feature have no `_rev`. They read as
// revision 0 — no migration, no bulk rewrite. The first successful guarded save
// writes `_rev: 1`.

export const CONC_DELETED = 'conc/deleted';
export const CONC_STALE = 'conc/stale';

export class ConcurrencyError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'ConcurrencyError';
    this.code = code; // 'conc/deleted' | 'conc/stale'
  }
}

/** True for a stale/deleted rejection thrown by a guarded save. */
export const isConcurrencyError = (e) => !!e && (e.code === CONC_DELETED || e.code === CONC_STALE);

/** A missing / non-numeric `_rev` is revision 0. */
export const revOf = (docData) => {
  const r = docData && docData._rev;
  return Number.isInteger(r) && r >= 0 ? r : 0;
};

/**
 * The guarded-write decision, as a pure function so the demo and production
 * backends (and the tests) all agree.
 *
 * @param serverDoc   the current server document, or null/undefined if it is gone
 * @param expectedRev the `_rev` the editor captured when it opened the record
 * @returns { conflict: 'deleted' } | { conflict: 'stale', serverRev } | { conflict: null, serverRev, nextRev }
 */
export function revState(serverDoc, expectedRev) {
  if (serverDoc === null || serverDoc === undefined) return { conflict: 'deleted' };
  const serverRev = revOf(serverDoc);
  const expected = Number.isInteger(expectedRev) && expectedRev >= 0 ? expectedRev : 0;
  if (serverRev !== expected) return { conflict: 'stale', serverRev };
  return { conflict: null, serverRev, nextRev: serverRev + 1 };
}

/** Turn a revState conflict into the matching ConcurrencyError. */
export function conflictError(state, label) {
  if (state.conflict === 'deleted') {
    return new ConcurrencyError(CONC_DELETED, `${label || 'This record'} was deleted by another user.`);
  }
  if (state.conflict === 'stale') {
    return new ConcurrencyError(CONC_STALE, `${label || 'This record'} was changed by another user after you opened it.`);
  }
  return null;
}
