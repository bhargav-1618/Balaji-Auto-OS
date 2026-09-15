// lib/useSearch.js
//
// Shared search primitives. Three rules, learned from measuring this app:
//
// 1. NEVER build the search haystack inside the filter callback.
//    Every module did this:
//
//        rows.filter((r) => [r.a, r.b, ...relatedIds(r)]
//          .filter(Boolean).join(' ').toLowerCase().includes(q))
//
//    …which allocates an array, a joined string and a lowercased copy FOR EVERY ROW,
//    ON EVERY KEYSTROKE. Worse, `relatedIds(r)` usually rescanned the whole job-card or
//    invoice array, so the cost was O(rows × records). In Vehicles, `invOf` called
//    `jcOf` *inside* an `invoices.filter` — a third nesting level. Measured at the real
//    dataset size (350 vehicles / 1,400 job cards / 1,129 invoices) that was
//    **36,442 ms per keystroke**. Not a typo: thirty-six seconds of blocked main thread
//    for one character. The 250ms debounce didn't help; it only delayed the freeze.
//
//    Build the haystack ONCE per data change. Filtering then becomes a substring test:
//    0.03 ms.
//
// 2. Render the typed character IMMEDIATELY; filter afterwards.
//    A debounce on the INPUT VALUE makes typing feel laggy — the character itself is
//    late. The input must stay fully controlled and instant; only the *derived* filter
//    may lag behind. That is what useDebounced does: `q` updates now, `dq` catches up.
//
// 3. Debounce is not a fix for an O(n·m) filter. It is a smoothing tool for a filter
//    that is already fast. If the work is 36 seconds, debouncing it just means the
//    freeze arrives 250 ms later. Fix the algorithm first.

import { useState, useEffect, useMemo, useRef, useDeferredValue } from 'react';

/**
 * PREFER THIS over useDebounced.
 *
 * React 18 renders the keystroke at URGENT priority (the character always appears
 * immediately) and re-renders anything derived from the returned value at LOW priority —
 * abandoning that render the moment the next character arrives. So typing can never wait
 * on the list, and results are NOT artificially delayed.
 *
 * A debounce cannot do either of those things. It does not stop the keystroke from
 * re-rendering the tree — it only postpones the derived work — and it adds a fixed lag to
 * results that the user feels as sluggishness once the filter itself is fast.
 *
 * Use a debounce ONLY when the work has a real external cost per invocation (a network
 * call, a write). For in-memory filtering, use this.
 */
export function useDeferredSearch(value) {
  const deferred = useDeferredValue(value);
  return [deferred, value !== deferred]; // [valueToFilterOn, isPending]
}

/**
 * Mirrors `value` after it has stopped changing for `delay` ms.
 * Kept for the cases where a fixed delay is genuinely wanted. Not the default.
 */
export function useDebounced(value, delay = 200) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/**
 * Build a Map of id -> lowercased searchable text, ONCE per change of `items` or `deps`.
 *
 * @param {any[]} items
 * @param {(item) => string} idFn     stable id
 * @param {(item) => any[]} textFn    the searchable fields (nulls are dropped)
 * @param {any[]} deps                anything else the text depends on (job cards, invoices…)
 */
export function useHaystacks(items, idFn, textFn, deps = []) {
  return useMemo(() => {
    const map = new Map();
    items.forEach((it) => {
      map.set(idFn(it), textFn(it).filter(Boolean).join(' ').toLowerCase());
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, ...deps]);
}

/** Match every whitespace-separated token, in any order. "swift ap01" finds both. */
export function matchTokens(hay, query) {
  if (!query) return true;
  if (!hay) return false;
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every((t) => hay.includes(t));
}

/**
 * Relevance score for ranking search results. `fields` is the record's distinct searchable
 * values (name, id, phone, regNo, …). Returns a higher number for stronger matches:
 *   4 = a field EQUALS the query exactly (unique identifier hit)
 *   3 = a field STARTS WITH the query
 *   2 = a field CONTAINS the query
 *   0 = no single-field match (token match may still apply for multi-word)
 * Case-insensitive; query is trimmed by the caller.
 */
export function rankMatch(fields, ql) {
  if (!ql) return 1;
  let best = 0;
  for (const f of fields) {
    if (!f) continue;
    const v = String(f).toLowerCase();
    if (v === ql) return 4;              // exact — can't beat this, return early
    if (v.startsWith(ql)) { best = Math.max(best, 3); continue; }
    if (v.includes(ql)) best = Math.max(best, 2);
  }
  return best;
}

/**
 * GLOBAL SEARCH ACCURACY — exact-identifier matching.
 *
 * Every module used to fold unique identifiers (Customer ID, Job Card Number, Invoice
 * Number, Registration Number, VIN/Chassis/Engine Number, Part Number/SKU, Supplier Code,
 * GST Number, RC Number, ...) into the SAME substring-searched haystack as names and other
 * free text. That is a data-integrity bug, not a UX nuance: typing the complete, correct
 * registration "SBBMC40" also matched "SBBMC400" and "SBBMC401", because all three contain
 * "sbbmc40" as a substring once lowercased and joined. Two different vehicles' service
 * history could be visually indistinguishable in a filtered list.
 *
 * Fix: keep identifier fields OUT of the token/substring haystack entirely, and match them
 * by normalized EXACT value only — no prefix, no substring. `useSearchIndex` builds both
 * per record; `matchIndexed` combines them. Name/contact/text fields (Customer Name, Vehicle
 * Make/Model, Owner Name, Part Name, Supplier Name, phone numbers, email, city, ...) are
 * unaffected — they stay in the token haystack exactly as before.
 */

/** Normalize an identifier for exact-match comparison: trim, lowercase, strip ALL whitespace
 *  (so "SB BMC 40", "sbbmc40" and "SBBMC40" all compare equal — same normalization spirit as
 *  `regKey`, generalized to any identifier field, not just registration numbers). */
export const normId = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, '');

/**
 * Build a per-item search index with TWO separate haystacks:
 *  - `hay`: partial/substring-searchable free text (names, cities, makes, phone
 *    numbers, ...).
 *  - `ids`: the record's OWN unique identifiers (its Customer ID, SKU, registration
 *    number, VIN, ...) — the strongest possible signal that THIS is the record the
 *    user meant.
 *
 * STRICT VALIDATION RULE — `idsFn`/`textFn` must return ONLY fields that genuinely
 * belong to THIS record. Never include: (a) a linked-but-different record's identifier
 * (a customer's job-card/invoice numbers, a vehicle's owner's Customer ID, ...), or (b)
 * an unrelated business-metric field (visit counts, revenue, stock levels, years) —
 * `rankIndexed` below has no way to tell a genuine identifier from a coincidental
 * numeric collision except by which fields this function was told to index. A record
 * that does not match one of ITS OWN configured fields must never appear in results,
 * full stop — there is no fallback tier for "sort of related."
 *
 * This is not a hypothetical: an earlier version of this file added an OPTIONAL 6th
 * `refIdsFn` argument specifically to let a linked record's identifier match, in its own
 * lower-ranked tier, reasoning that "ranked lower" was a safe compromise. It wasn't —
 * "ranked lower" is still "present," and reproduced live: this app numbers Job Cards
 * "SBBMC123", the SAME text format as a Customer ID, so a customer whose OWN identifiers
 * had nothing to do with the query still surfaced merely because ONE OF THEIR OWN JOB
 * CARDS happened to be numbered like a different customer's ID. Removed entirely, not
 * just unused — so the mistake can't quietly come back through a new call site.
 *
 * @param {any[]} items
 * @param {(item) => string} idFn      stable id for the Map key
 * @param {(item) => any[]} textFn     partial-match free-text fields (THIS record's own)
 * @param {(item) => any[]} idsFn      exact/prefix/suffix/contains identifier fields (THIS record's own)
 * @param {any[]} deps
 */
export function useSearchIndex(items, idFn, textFn, idsFn, deps = []) {
  return useMemo(() => {
    const map = new Map();
    items.forEach((it) => {
      map.set(idFn(it), {
        hay: textFn(it).filter(Boolean).join(' ').toLowerCase(),
        ids: idsFn(it).filter(Boolean).map(normId),
      });
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, ...deps]);
}

/**
 * UNIVERSAL SEARCH CORE — FIELD-AWARE, TIERED, RANKED, STRICTLY VALIDATED MATCHING.
 *
 * This is the ONE matching function every module's search goes through — module
 * differences live entirely in `useSearchIndex`'s field configuration (which fields are
 * `ids` vs `hay` for that record type), never in a second copy of this logic.
 *
 * `matchIndexed` (exact-identifier-only) fixed one real bug — identifiers dumped into a
 * substring haystack made "SBBMC40" also match "SBBMC400" — but it fixed it by making
 * identifiers exact-match-ONLY, which created a second problem: "232" no longer found
 * "SBBMC232" anywhere except the one module that hand-built a digit-only secondary id as
 * a workaround. Partial identifier fragments must work everywhere, AND when a fragment
 * matches several records that's fine AS LONG AS every one of them is a GENUINE match on
 * one of ITS OWN configured fields — never "pretend the first result is definitely the
 * intended one" without ranking backing that claim up, and never show a record that
 * doesn't actually match anything real just because a broader query happened to overlap
 * some unconfigured field by coincidence.
 *
 * A record scores 0 — and `searchAndRank`/`matchIndexed` therefore exclude it completely
 * — unless the query is found in a field `useSearchIndex` was explicitly told belongs to
 * THAT record. There is no fallback: no "show it anyway ranked lower," no "broaden the
 * search," no partial credit for a coincidental digit overlap in a field that was never
 * passed in. See `useSearchIndex`'s doc comment for the concrete bug this discipline
 * fixes (a customer surfacing via a same-shaped but unrelated job-card number).
 *
 *    8 = an identifier EQUALS the query exactly (unique, unambiguous — short-circuits)
 *    7 = an identifier STARTS WITH the query
 *    6 = an identifier ENDS WITH the query (suffix — "last 4 of the reg/phone/SKU")
 *    5 = an identifier CONTAINS the query (a genuine fragment, e.g. "232" in "SBBMC232")
 *    4 = a free-text field EQUALS the query exactly
 *    3 = a free-text field STARTS WITH the query
 *    2 = a free-text field CONTAINS the query, or every whitespace-token matches somewhere
 *    0 = no match — the record is discarded, not shown at a lower tier
 *
 * Identifiers always outrank free text — a matching SKU/registration/invoice number is a
 * far stronger, less ambiguous signal than a matching name/city fragment. Suffix matching
 * only engages for queries of 2+ characters (see MIN_SUFFIX_LEN) so a single trailing
 * digit doesn't manufacture noise across a whole identifier column.
 */
const MIN_SUFFIX_LEN = 2;
export function rankIndexed(entry, query) {
  if (!query) return 1;
  if (!entry) return 0;
  const q = query.trim();
  if (!q) return 1;
  const qId = normId(q);
  const ql = q.toLowerCase();

  let idBest = 0;
  if (qId && entry.ids) {
    for (const id of entry.ids) {
      if (!id) continue;
      if (id === qId) { idBest = 8; break; } // can't beat an exact hit — stop scanning
      if (id.startsWith(qId)) { idBest = Math.max(idBest, 7); continue; }
      if (qId.length >= MIN_SUFFIX_LEN && id.endsWith(qId)) { idBest = Math.max(idBest, 6); continue; }
      if (id.includes(qId)) idBest = Math.max(idBest, 5);
    }
  }
  if (idBest === 8) return idBest; // an exact hit on the record's own id wins outright

  let hayBest = 0;
  if (entry.hay) {
    if (entry.hay === ql) hayBest = 4;
    else if (entry.hay.startsWith(ql)) hayBest = 3;
    else if (entry.hay.includes(ql) || matchTokens(entry.hay, query)) hayBest = 2;
  }
  return Math.max(idBest, hayBest);
}

/**
 * Match one `useSearchIndex` entry against a query — boolean convenience wrapper over
 * `rankIndexed`. Drop-in for every existing `matchIndexed(...)` call site: same
 * signature, but identifiers are now ALSO partial-matched (not exact-only), so a query
 * like "232" finds "SBBMC232" through this same function everywhere it's already used,
 * with no call-site changes required.
 */
export function matchIndexed(entry, query) {
  return rankIndexed(entry, query) > 0;
}

/**
 * Filter + rank + sort a list against a `useSearchIndex` Map in one call — the reusable
 * "search this module's records" entry point (see the brief's "Universal Search Engine →
 * Module Search Configuration" architecture: this IS that shared engine; `idFn`/`indexMap`
 * are the module's configuration). Empty query returns the list untouched (optionally
 * through the caller's own default ordering via `tieBreak`) rather than an empty result.
 * Ties in relevance are broken by `tieBreak(a, b)` (e.g. newest-first, alphabetical) so a
 * module keeps its own secondary ordering once relevance is equal — omit it to leave
 * equally-ranked items in their original relative order (a stable sort).
 */
export function searchAndRank(items, indexMap, idFn, query, tieBreak) {
  const q = (query || '').trim();
  if (!q) return tieBreak ? [...items].sort(tieBreak) : items;
  const scored = items
    .map((it) => ({ it, score: rankIndexed(indexMap.get(idFn(it)), q) }))
    .filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score || (tieBreak ? tieBreak(a.it, b.it) : 0));
  return scored.map((x) => x.it);
}

/** Group an array into a Map by key. The antidote to `.filter()` inside `.map()`. */
export function indexBy(items, keyFn) {
  const map = new Map();
  (items || []).forEach((it) => {
    const k = keyFn(it);
    if (k === undefined || k === null || k === '') return;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  });
  return map;
}

/** Digits only — for phone-number keys. Computing this per row per keystroke was a cost. */
export const phoneKey = (p) => String(p || '').replace(/\D/g, '');

/** Reg-number key: upper, with spaces/hyphens/slashes stripped — the separators a
 *  workshop actually writes registrations with ("AP 40 LM 1234", "AP-40-LM-1234",
 *  "AP/40/LM/1234"), so all of them normalize to the same "AP40LM1234" and compare equal
 *  regardless of which formatting the user or the original data entry used. */
export const regKey = (r) => String(r || '').toUpperCase().replace(/[\s\-/]+/g, '');

/**
 * True while the user is actively typing (i.e. the debounced value has not caught up).
 * Useful to show a subtle "searching…" hint instead of a frozen-looking list.
 */
export function useIsSearching(value, debouncedValue) {
  return value !== debouncedValue;
}

/** Stable ref to the latest value, without causing re-renders. */
export function useLatest(value) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
