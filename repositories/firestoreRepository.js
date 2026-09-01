/**
 * REPOSITORY LAYER — the only place in the app that talks to Firestore.
 *
 * Why this exists:
 *   1. `InventoryDashboard.js` made 74 raw Firestore calls inline. Query shapes were
 *      copy-pasted, so a cost or correctness fix had to be applied in N places and
 *      inevitably missed one.
 *   2. Several listeners subscribed to ENTIRE collections with no limit(). Firestore
 *      bills per document read: an unbounded `customers` listener at 100k docs costs
 *      100,000 reads every time a dashboard mounts — and puts 100k objects into a
 *      React array, which will kill a browser tab. Centralising the queries is what
 *      makes that bounded *by construction* rather than by remembering.
 *
 * Contains: CRUD, queries, batches, transactions. NO business logic, NO React.
 */

import {
  collection, doc, query, orderBy, where, limit, startAfter,
  onSnapshot, getDocs, getDoc, addDoc, setDoc, updateDoc, deleteDoc,
  writeBatch, serverTimestamp, getCountFromServer, runTransaction,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { COLLECTIONS, LIMITS } from '../constants/index';
import { revState, conflictError } from '../lib/concurrency';

/** Normalise a Firestore snapshot into plain objects with their id. */
const mapSnap = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

/**
 * Subscribe to a BOUNDED, ordered window of a collection.
 *
 * Every live listener in the app goes through here, so no caller can accidentally
 * stream a whole collection. `max` is required — there is deliberately no default of
 * "everything".
 *
 * @returns {() => void} unsubscribe — the caller MUST call this on unmount.
 */
export function subscribeWindow(collectionName, {
  max,
  orderField = 'createdAt',
  direction = 'desc',
  constraints = [],
  onData,
  onError,
}) {
  if (!max || max < 1) {
    throw new Error(`subscribeWindow(${collectionName}): a positive \`max\` is required. ` +
      'Unbounded listeners are what make Firestore bills explode and browser tabs OOM.');
  }
  const q = query(
    collection(db, collectionName),
    ...constraints,
    orderBy(orderField, direction),
    limit(max),
  );
  return onSnapshot(
    q,
    (snap) => onData?.(mapSnap(snap)),
    (err) => {
      // Never swallow this. A failed listener means the screen silently shows stale or
      // empty data, which is indistinguishable from "there are no records".
      console.error(`[Firestore] listener failed on "${collectionName}":`, err);
      onError?.(err);
    },
  );
}

/**
 * Fetch one page. Used for "load more" and for reaching records outside the live
 * window, so the UI never needs the whole collection in memory.
 *
 * @param cursor the last document snapshot from the previous page (or null)
 */
export async function fetchPage(collectionName, {
  pageSize = LIMITS.PAGE_SIZE,
  orderField = 'createdAt',
  direction = 'desc',
  constraints = [],
  cursor = null,
} = {}) {
  const parts = [collection(db, collectionName), ...constraints, orderBy(orderField, direction)];
  if (cursor) parts.push(startAfter(cursor));
  parts.push(limit(pageSize));
  const snap = await getDocs(query(...parts));
  return {
    rows: mapSnap(snap),
    cursor: snap.docs[snap.docs.length - 1] || null,
    done: snap.docs.length < pageSize,
  };
}

/**
 * Server-side search on an indexed field, using a prefix range.
 *
 * This is the alternative to "download 100k customers and filter in JS". It reads only
 * the matching documents. Requires the field to be indexed and stored lowercase.
 */
export async function searchByPrefix(collectionName, field, term, max = LIMITS.SEARCH_RESULTS) {
  const t = String(term || '').trim().toLowerCase();
  if (!t) return [];
  const snap = await getDocs(query(
    collection(db, collectionName),
    where(field, '>=', t),
    where(field, '<=', `${t}\uf8ff`),   // \uf8ff = highest code point → prefix match
    limit(max),
  ));
  return mapSnap(snap);
}

/**
 * Count documents matching `constraints` WITHOUT downloading them.
 *
 * getCountFromServer() bills as a single small aggregate read regardless of how many
 * documents match — this is the difference between "how many invoices exist" costing 1
 * read and costing 5,000 reads. Used by the capacity-management system (see
 * services/capacityService.js) so checking "are we near the 5,000-record limit" never
 * requires pulling the records themselves into the browser.
 */
export async function count(collectionName, constraints = []) {
  const snap = await getCountFromServer(query(collection(db, collectionName), ...constraints));
  return snap.data().count;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------
export async function getById(collectionName, id) {
  const snap = await getDoc(doc(db, collectionName, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function create(collectionName, data) {
  const ref = await addDoc(collection(db, collectionName), {
    ...data,
    createdAt: data.createdAt ?? serverTimestamp(),
  });
  return ref.id;
}

export async function upsert(collectionName, id, data) {
  await setDoc(doc(db, collectionName, id), data, { merge: true });
  return id;
}

export async function update(collectionName, id, patch) {
  await updateDoc(doc(db, collectionName, id), patch);
}

export async function remove(collectionName, id) {
  await deleteDoc(doc(db, collectionName, id));
}

/**
 * OPTIMISTIC-CONCURRENCY GUARDED WRITE (Phase 1a).
 *
 * Persist an edit to an EXISTING document only if it has not changed underneath
 * the editor. Runs inside a Firestore transaction so the existence + revision
 * check and the write cannot race:
 *
 *   1. re-read the current server document
 *   2. if it no longer exists  -> throw ConcurrencyError('conc/deleted')
 *      (an unconditional set() here would RESURRECT a deleted record — the exact
 *       delete-vs-edit bug this closes)
 *   3. if its `_rev` != the revision the editor captured on open
 *                              -> throw ConcurrencyError('conc/stale')
 *   4. otherwise merge the edit and set `_rev` to server._rev + 1
 *
 * `data` is written with { merge: true } — same as syncAll — so fields no form
 * manages (e.g. stock/salesCount on a part, managed by Sell/Receive) are never
 * clobbered. `_rev` and `updatedAt` are set by this function, not the caller.
 *
 * @returns the merged document as it now stands on the server (optimistic view)
 */
export async function guardedSet(collectionName, id, data, expectedRev, label) {
  const ref = doc(db, collectionName, String(id));
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const state = revState(snap.exists() ? snap.data() : null, expectedRev);
    const err = conflictError(state, label);
    if (err) throw err;
    const { id: _dropId, _rev: _dropRev, ...clean } = data || {};
    tx.set(ref, { ...clean, _rev: state.nextRev, updatedAt: serverTimestamp() }, { merge: true });
    return { ...snap.data(), ...clean, _rev: state.nextRev };
  });
}

/**
 * Commit many writes atomically. Firestore caps a batch at 500 operations, so we chunk
 * — a silent 501st write would otherwise throw and abort the whole transaction.
 */
export async function commitBatch(operations) {
  const CHUNK = 500;
  for (let i = 0; i < operations.length; i += CHUNK) {
    const batch = writeBatch(db);
    operations.slice(i, i + CHUNK).forEach((op) => {
      const ref = op.id
        ? doc(db, op.collection, op.id)
        : doc(collection(db, op.collection));
      if (op.type === 'set') batch.set(ref, op.data, { merge: op.merge !== false });
      else if (op.type === 'update') batch.update(ref, op.data);
      else if (op.type === 'delete') batch.delete(ref);
    });
    await batch.commit();
  }
}

// ---------------------------------------------------------------------------
// Named, bounded subscriptions. These are the ones the app actually uses; the limits
// live in constants/LIMITS so the cost profile is visible in one place.
// ---------------------------------------------------------------------------
export const subscribeParts = (onData, onError) =>
  subscribeWindow(COLLECTIONS.PARTS, { max: LIMITS.PARTS_LIVE, onData, onError });

export const subscribeCustomers = (onData, onError) =>
  subscribeWindow(COLLECTIONS.CUSTOMERS, { max: LIMITS.CUSTOMERS_LIVE, onData, onError });

export const subscribeSuppliers = (onData, onError) =>
  subscribeWindow(COLLECTIONS.SUPPLIERS, { max: LIMITS.SUPPLIERS_LIVE, onData, onError });

export const subscribeInvoices = (onData, onError) =>
  subscribeWindow(COLLECTIONS.INVOICES, { max: LIMITS.INVOICES_LIVE, onData, onError });

export const subscribeJobCards = (onData, onError) =>
  subscribeWindow(COLLECTIONS.JOB_CARDS, { max: LIMITS.JOB_CARDS_LIVE, onData, onError });

export const subscribeSales = (onData, onError) =>
  subscribeWindow(COLLECTIONS.SALES, { max: LIMITS.SALES_LIVE, onData, onError });

export const subscribeAuditLog = (onData, onError) =>
  subscribeWindow(COLLECTIONS.AUDIT_LOG, { max: LIMITS.AUDIT_LIVE, onData, onError });
