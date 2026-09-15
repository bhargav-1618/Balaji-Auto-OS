// lib/recordSync.js
//
// CONCURRENCY PHASE 1c — live record-update / conflict UX.
//
// Phase 1a (`_rev` guarded transaction) is still the authoritative data-integrity
// layer and Phase 1b (the edit lease) still decides who may edit. This module is
// the UX layer on top: while a record is open in a viewer or an editor, watch the
// ACTUAL record document and tell the open UI when another session changed it —
// so the user learns immediately, never loses unsaved work, and never has to
// refresh.
//
// It watches the RECORD document, never the lease document. That is deliberate:
// acquiring / renewing / releasing an edit lease must never look like a record
// change (spec §13 / §15).
//
// Demo mode never calls any of this (single in-memory client, no Firestore).

import { db, doc, onSnapshot } from './firebase';
import { revOf } from './concurrency';

/**
 * Live-observe ONE record document.
 *
 * `cb` receives:
 *   { exists: true, id, ...data }  — the current server document
 *   { exists: false }              — the document has been deleted
 *   null                           — a listener error (infer nothing; keep showing
 *                                    what we have)
 *
 * Returns the onSnapshot unsubscribe — the caller MUST call it on unmount.
 */
export function observeRecord(collectionName, docId, cb) {
  return onSnapshot(
    doc(db, collectionName, String(docId)),
    (snap) => cb(snap.exists() ? { exists: true, id: snap.id, ...snap.data() } : { exists: false }),
    () => cb(null),
  );
}

/**
 * Pure state machine. `baselineRev` is the `_rev` this session has acknowledged
 * (the one it opened with, advanced past its own saves / an explicit "view
 * updated"). `live` is the latest value from observeRecord.
 *
 * Idempotent: the same `live` in always yields the same status out, so repeated /
 * no-op snapshots can never produce a second notification (spec test L).
 */
export function recordSyncState(baselineRev, live) {
  if (!live) return 'current';                 // no data yet / listener error
  if (live.exists === false) return 'deleted';
  return revOf(live) === revOf({ _rev: baselineRev }) ? 'current' : 'updated';
}

/**
 * Field equality for the rebase.
 *
 * Primitives compare LOOSELY after trimming — a text input that yields "100"
 * (string) and a stored number 100 are the same value, and " x " vs "x" is not a
 * real edit. Objects / arrays compare by a stable deep stringify and are treated as
 * one whole unit (never element-merged).
 *
 * `'' == null == undefined` for this purpose — an empty form field and a missing
 * stored field are "the same" (not an edit).
 */
export function fieldsEqual(a, b) {
  if (a === b) return true;
  const emptyA = a === '' || a === null || a === undefined;
  const emptyB = b === '' || b === null || b === undefined;
  if (emptyA || emptyB) return emptyA && emptyB;
  if (typeof a !== 'object' && typeof b !== 'object') {
    return String(a).trim() === String(b).trim();
  }
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  try {
    return JSON.stringify(stableSort(a)) === JSON.stringify(stableSort(b));
  } catch {
    return false;
  }
}

function stableSort(v) {
  if (Array.isArray(v)) return v.map(stableSort);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((o, k) => { o[k] = stableSort(v[k]); return o; }, {});
  }
  return v;
}

/**
 * "KEEP MY CHANGES" REBASE (spec §5 / §6).
 *
 *   opened — the record as the editor opened it (carries the `_rev` it captured)
 *   local  — the editor's current in-progress form values
 *   latest — the newest server record
 *
 * Returns { merged, conflicts }:
 *   merged    — `latest` with the user's field changes re-applied ONLY where the
 *               other user provably did not touch that same field, and
 *               `merged._rev = revOf(latest)` (the new expected revision — the save
 *               still goes through the guarded transaction, this does not bypass it)
 *   conflicts — [{ key, mine, theirs }] for every field BOTH sides changed. `merged`
 *               keeps `theirs`; the caller MUST make the user pick each one. Nothing
 *               here is auto-resolved.
 *
 * Arrays / objects (vehicles[], invoice line items, structured objects) are compared
 * and carried WHOLE — a changed array is one conflict unit, never element-merged.
 * Financial / stock / server-managed fields are excluded by the caller's `keys`.
 */
export function rebaseRecord(opened, local, latest, { keys, isEqual = fieldsEqual } = {}) {
  const base = latest && typeof latest === 'object' ? latest : {};
  const merged = { ...base, _rev: revOf(base) };
  const conflicts = [];
  const fields = Array.isArray(keys) && keys.length
    ? keys
    : Object.keys(local || {}).filter((k) => k !== 'id' && k !== '_rev');

  for (const k of fields) {
    if (k === 'id' || k === '_rev') continue;
    const changedByMe = !isEqual(local ? local[k] : undefined, opened ? opened[k] : undefined);
    if (!changedByMe) continue;
    const changedByThem = !isEqual(base[k], opened ? opened[k] : undefined);
    if (changedByThem) {
      conflicts.push({ key: k, mine: local ? local[k] : undefined, theirs: base[k] });
    } else {
      merged[k] = local ? local[k] : undefined;   // safe: only I touched this field
    }
  }
  return { merged, conflicts };
}
