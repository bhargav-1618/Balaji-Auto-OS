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

/**
 * ID-KEYED ARRAY REPLAY (Phase 3b — CWF-03).
 *
 * A non-guarded "secondary" write to a customer (add a note, add/edit a vehicle,
 * star a default) used to persist the WHOLE customer document. Two such writes
 * racing — each from its own stale snapshot — meant the last writer's whole-doc
 * `set` silently reverted the other's change to a DIFFERENT field.
 *
 * This is the merge engine that fixes it. Given the array as this client SAW it
 * when it started (`before`), the array it now WANTS (`after`), and the array as
 * it stands on the server RIGHT NOW (`server`, re-read inside a transaction),
 * produce the array that applies THIS client's specific intent — the elements it
 * added, removed, or modified, keyed by `id` — on top of server truth. Elements
 * the client never touched keep the server's version, so a concurrent add/edit
 * by someone else survives.
 *
 * - add:    in `after`, not in `before`  -> appended (unless the id is already on the server)
 * - remove: in `before`, not in `after`  -> dropped from the result
 * - modify: in both, content changed     -> this client's version wins for that element
 * - untouched (in `before` and `after` unchanged) -> server's current version is kept
 *
 * Order: server order first (minus removals, with modifications applied in place),
 * then this client's genuinely-new elements appended. Deterministic and idempotent
 * — re-running against the same (before, after, server) yields the same result, and
 * a retried transaction simply re-reads a fresher `server`.
 *
 * Only for arrays whose elements are objects carrying a stable `id`
 * (customer `vehicles`, `noteEntries`). Everything else stays a plain field write.
 */
export function replayIdArray(before, after, server) {
  const b = Array.isArray(before) ? before : [];
  const a = Array.isArray(after) ? after : [];
  const s = Array.isArray(server) ? server : [];
  const beforeById = new Map(b.filter((x) => x && x.id != null).map((x) => [x.id, x]));
  const afterById = new Map(a.filter((x) => x && x.id != null).map((x) => [x.id, x]));
  const removedIds = new Set(
    b.filter((x) => x && x.id != null && !afterById.has(x.id)).map((x) => x.id),
  );
  const out = [];
  const seen = new Set();
  for (const el of s) {
    const id = el && el.id;
    if (id != null && removedIds.has(id)) continue;          // this client deleted it
    if (id != null) seen.add(id);
    const mine = id != null ? afterById.get(id) : undefined;
    const orig = id != null ? beforeById.get(id) : undefined;
    if (mine && orig && JSON.stringify(mine) !== JSON.stringify(orig)) {
      out.push(mine);                                        // this client edited it
    } else {
      out.push(el);                                          // untouched -> keep server's
    }
  }
  for (const el of a) {
    const id = el && el.id;
    if (id != null && !beforeById.has(id) && !seen.has(id)) {
      out.push(el);                                          // genuinely new on this client
      seen.add(id);
    }
  }
  return out;
}

/** True when every element of a non-empty array is an object carrying an `id`. */
export const isIdKeyedArray = (v) =>
  Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === 'object' && x.id != null);

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
