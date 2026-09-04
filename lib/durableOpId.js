// lib/durableOpId.js
//
// DURABLE OPERATION IDENTITY — Phase 5b (refresh / reload reliability),
// hardened in Phase 7b (PH7-01, tab-duplication safety).
//
// Phase 4b gave every retryable business write a stable operation id, but stored
// it in a React `useRef` — which the browser destroys on a full page reload. So
// the sequence *transaction commits server-side -> ack lost to a refresh -> user
// reloads and retries* produced a SECOND business effect, because the retry
// minted a fresh id the backend had never seen (Phase 5 findings PH5-02..PH5-04,
// PH5-07). Phase 5b fixed that by keeping the id in **sessionStorage**, which
// survives a reload of the same tab.
//
// PHASE 7b — sessionStorage survives more than "a reload of the same tab": the
// HTML Living Standard requires a browsing context created by CLONING another
// one (the browser's own "Duplicate tab" / "Reopen closed tab") to share the
// sessionStorage of the context it was cloned from. A plain new tab does not do
// this — only a genuine clone does. So a tab duplicated mid-payment inherited the
// origin tab's in-flight opId, and a genuinely DIFFERENT second business action
// (started independently in the duplicate) was silently treated as a retry of
// the first and swallowed by the backend's own idempotency marker (Phase 7
// discovery, PH7-01 — proven against the emulator with a real payment
// transaction: Tab A's ₹500 applied, Tab B's independently-different ₹700 on the
// inherited id did not).
//
// THE FIX — a page-instance tag, using `window.name`:
//   `window.name` is a property of the BROWSING CONTEXT itself. Verified live
//   (production, this phase): it SURVIVES a reload/navigation of the SAME tab
//   (confirmed empirically — set it, reload, it's still there), exactly like
//   sessionStorage. But a NEW top-level browsing context — a plain new tab OR a
//   duplicated one — starts with an EMPTY `window.name` (confirmed empirically
//   for a plain new tab; a duplicate is, per spec, a like-for-like NEW browsing
//   context for everything except the one thing explicitly speced to clone,
//   sessionStorage). `window.name` is not part of that clone. It is, in other
//   words, the one piece of ambient browser state with EXACTLY the lifetime this
//   fix needs: alive across MY OWN tab's reloads, dead in anyone else's tab
//   (including one that started as a literal copy of mine).
//
//   Every value written to sessionStorage is now tagged with the page-instance
//   id this boot minted (or recovered from `window.name`). On read, an entry
//   tagged with a DIFFERENT page-instance id than the current boot's own is
//   provably NOT this tab's own earlier attempt — it can only have arrived by
//   sessionStorage's clone-on-duplicate behavior — so it is never reused for a
//   genuinely new intent. An entry tagged with the SAME page-instance id (this
//   tab, reloaded) is reused exactly as before.
//
//   Not universally provable across every browser without literally triggering
//   a chrome-level "Duplicate tab" gesture (this codebase's own tooling cannot
//   drive that), but `window.name`'s survive-reload / reset-on-new-context
//   behavior is standard, spec-defined browsing-context state (not a
//   Chromium-specific quirk) and was verified live in this session's actual
//   production browser for both halves it needs: survives-same-tab-reload, and
//   empty-in-a-genuinely-new-context.
//
// LIFECYCLE
//   readOrCreateOpId(scope)  - on mount: return the id already stored for `scope`
//                              IF it was tagged by this same page instance (a
//                              recovery from OUR OWN earlier attempt); otherwise
//                              (absent, or tagged by a different instance —
//                              inherited via tab duplication) mint a fresh one.
//   peekOpId(scope)          - was an id already stored on mount BY THIS PAGE
//                              INSTANCE? -> an earlier attempt on this exact
//                              intent did NOT confirm; warn the user before they
//                              retry. An inherited (different-instance) entry
//                              does not count — it isn't this tab's own retry.
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
//
// This module owns `window.name` exclusively — nothing else in this app reads
// or writes it (verified at the time this was written). The value it stores
// there is namespaced (`ph7b:pi:` prefix) so a future, unrelated use of
// `window.name` can detect and safely ignore/overwrite it rather than silently
// colliding.

const PREFIX = 'ph5b:op:';
const PAGE_INSTANCE_PREFIX = 'ph7b:pi:';
const mint = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

// Cached after first derivation — `window.name` is stable for the lifetime of
// this browsing context once set, so there is no reason to re-read/re-parse it
// on every call.
let cachedPageInstanceId; // undefined = not yet derived; null = unavailable

/**
 * The id of THIS page instance (this specific browsing context's current
 * lifetime, from its first navigation to now — reload-stable, duplicate-proof).
 * `null` if `window.name` is unavailable (SSR, or a sandboxed context that
 * blocks it) — callers degrade to the pre-Phase-7b "trust sessionStorage alone"
 * behavior in that narrow case rather than false-positive every single read.
 */
function getPageInstanceId() {
  if (cachedPageInstanceId !== undefined) return cachedPageInstanceId;
  if (typeof window === 'undefined') { cachedPageInstanceId = null; return null; }
  try {
    if (typeof window.name === 'string' && window.name.startsWith(PAGE_INSTANCE_PREFIX)) {
      cachedPageInstanceId = window.name;
      return cachedPageInstanceId;
    }
    const fresh = PAGE_INSTANCE_PREFIX + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    try { window.name = fresh; } catch { /* window.name write blocked — fall through, still return fresh for THIS read */ }
    cachedPageInstanceId = fresh;
    return fresh;
  } catch {
    cachedPageInstanceId = null;
    return null;
  }
}

/** Read + parse the tagged entry for `key`, or null if absent/unparseable. */
function readEntry(key) {
  let raw;
  try { raw = sessionStorage.getItem(key); } catch { return null; }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.opId === 'string') return parsed;
  } catch {
    // Not valid JSON — either a stray value, or an entry written by the
    // pre-Phase-7b bare-string format (only possible for an operation that was
    // literally in flight across a deploy boundary). Either way, not a tagged
    // entry we can trust as "this page instance's own attempt" — treated the
    // same as absent below.
  }
  return null;
}

function writeEntry(key, opId) {
  try { sessionStorage.setItem(key, JSON.stringify({ opId, pi: getPageInstanceId() })); } catch { /* ignore */ }
}

/** The id stored for `scope` BY THIS PAGE INSTANCE, or a freshly minted + stored one. */
export function readOrCreateOpId(scope, prefix = 'op') {
  const key = PREFIX + scope;
  const pi = getPageInstanceId();
  try {
    const entry = readEntry(key);
    if (entry && (pi === null || entry.pi === pi)) return entry.opId;
    // Either nothing stored, or it's tagged with a DIFFERENT page instance —
    // inherited via sessionStorage's clone-on-tab-duplicate behavior, not this
    // tab's own earlier attempt. A genuinely new intent gets a genuinely new id.
    const fresh = mint(prefix);
    writeEntry(key, fresh);
    return fresh;
  } catch {
    // sessionStorage blocked (private mode / storage disabled): degrade to an
    // in-memory-only id — no worse than Phase 4b was for this tab.
    return mint(prefix);
  }
}

/** True if THIS PAGE INSTANCE already stored an id for `scope` (an unconfirmed prior attempt of its own — not one inherited from a duplicated tab). */
export function peekOpId(scope) {
  const pi = getPageInstanceId();
  const entry = readEntry(PREFIX + scope);
  if (!entry) return null;
  if (pi !== null && entry.pi !== pi) return null; // inherited, not ours
  return entry.opId;
}

/** Forget the id for `scope` — the next attempt becomes a new intent. */
export function clearOpId(scope) {
  try { sessionStorage.removeItem(PREFIX + scope); } catch { /* ignore */ }
}
