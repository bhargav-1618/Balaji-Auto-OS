// lib/durableOpId.js
//
// DURABLE OPERATION IDENTITY — Phase 5b (refresh / reload reliability).
//
// Phase 4b gave every retryable business write a stable operation id, but stored
// it in a React `useRef` — which the browser destroys on a full page reload. So
// the sequence *transaction commits server-side -> ack lost to a refresh -> user
// reloads and retries* produced a SECOND business effect, because the retry
// minted a fresh id the backend had never seen (Phase 5 findings PH5-02..PH5-04,
// PH5-07).
//
// This module keeps the operation id in **sessionStorage**, so it survives a
// reload of the same tab (and only that tab — it is never synced anywhere, and it
// is gone when the tab closes, which is the correct lifetime for "a business
// intent the user is in the middle of").
//
// LIFECYCLE
//   readOrCreateOpId(scope)  - on mount: return the id already stored for `scope`
//                              (a recovery), else mint one and store it.
//   peekOpId(scope)          - was an id already stored on mount? -> an earlier
//                              attempt on this exact intent did NOT confirm; warn
//                              the user before they retry.
//   clearOpId(scope)         - call on a CONFIRMED result:
//                                * success                -> next attempt is a new intent
//                                * a business rejection that definitely did NOT
//                                  commit (e.g. "insufficient stock") -> same
//                              Do NOT clear on an ambiguous failure (network /
//                              timeout / the page went away) — keep it so the
//                              retry recovers the same id and the backend marker
//                              de-duplicates.
//
// `scope` must be STABLE for one logical intent and DISTINCT between intents:
//   payment:<invoiceId> · receive:<poId> · sell:<partId> · adjust:<partId> ·
//   restock:<partId> · create-po · create-supplier · create-part · jc-reserve:<jobNo>
// (one action per record at a time in this single-terminal-per-till app, so the
// record id is a sufficient discriminator; a genuine second action on the same
// record gets a fresh id because the first cleared its scope on success.)

const PREFIX = 'ph5b:op:';
const mint = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

/** The id stored for `scope`, or a freshly minted + stored one. */
export function readOrCreateOpId(scope, prefix = 'op') {
  const key = PREFIX + scope;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const fresh = mint(prefix);
    sessionStorage.setItem(key, fresh);
    return fresh;
  } catch {
    // sessionStorage blocked (private mode / storage disabled): degrade to an
    // in-memory-only id — no worse than Phase 4b was for this tab.
    return mint(prefix);
  }
}

/** True if an id was already stored for `scope` (an unconfirmed prior attempt). */
export function peekOpId(scope) {
  try { return sessionStorage.getItem(PREFIX + scope); } catch { return null; }
}

/** Forget the id for `scope` — the next attempt becomes a new intent. */
export function clearOpId(scope) {
  try { sessionStorage.removeItem(PREFIX + scope); } catch { /* ignore */ }
}
