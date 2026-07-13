/**
 * PERSISTENCE ADAPTER — one interface, two backends.
 *
 * =============================================================================
 * WHY THIS EXISTS (this is the single highest-value abstraction in the project)
 * =============================================================================
 *
 * The container currently forks on `demoMode` in 52 places:
 *
 *     if (demoMode) { localStorage.setItem('maruti_invoices_demo', ...); return; }
 *     addDoc(collection(db, 'invoices'), ...);
 *
 * Every serious data bug this project has had was the SAME bug — a code path that
 * existed in one mode and not the other:
 *
 *   - `genSales()` fabricated a sales ledger for demo that production never had, so the
 *     two modes ran on different data models entirely.
 *   - The `applyDemoData` re-seed race clobbered engine writes. Demo-only path.
 *   - The audit log persisted to Firestore in production but was in-memory in demo, so
 *     it vanished on reload — demo-only path.
 *   - `tsToDate()` parsed Firestore Timestamps (production) but returned null for ISO
 *     strings (demo), so every demo record was silently filtered out of every view.
 *
 * 52 forks means 52 chances to implement one side and forget the other. The bugs were
 * not carelessness; they were the predictable output of a missing abstraction.
 *
 * With this adapter, a caller writes:
 *
 *     await store.save(COLLECTIONS.INVOICES, invoice);
 *
 * ...and CANNOT diverge, because there is only one call site for both modes. Demo mode
 * stops being a branch and becomes a swapped implementation — which is what the brief
 * always required: "In Demo Mode, the exact same transaction engine must run."
 *
 * Dependency direction is respected: this depends on repositories and constants, and on
 * nothing above it. No React, no components.
 */

import { STORAGE } from '../constants';
import * as repo from '../repositories/firestoreRepository';

/** Which localStorage/sessionStorage key backs each collection in demo mode. */
const DEMO_KEY = {
  parts: STORAGE.DEMO_INVENTORY,
  suppliers: STORAGE.DEMO_SUPPLIERS,
  sales: STORAGE.DEMO_SALES,
  customers: STORAGE.DEMO_CUSTOMERS,
  invoices: STORAGE.DEMO_INVOICES,
  jobCards: STORAGE.DEMO_JOB_CARDS,
  auditLog: STORAGE.DEMO_AUDIT,
  restocks: STORAGE.DEMO_RESTOCKS,
  stockAdjustments: STORAGE.DEMO_ADJUSTMENTS,
  purchaseOrders: STORAGE.DEMO_PURCHASE_ORDERS,
};

/** Keys that must survive a tab close (business records the user created). */
const DURABLE = new Set([STORAGE.DEMO_CUSTOMERS, STORAGE.DEMO_INVOICES, STORAGE.DEMO_JOB_CARDS]);

const backingStore = (key) => (DURABLE.has(key) ? localStorage : sessionStorage);

const readAll = (key) => {
  try {
    const raw = backingStore(key).getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error(`[store] could not read ${key}`, e);
    return null;
  }
};

const writeAll = (key, rows) => {
  try {
    backingStore(key).setItem(key, JSON.stringify(rows));
  } catch (e) {
    // NOT a silent catch. If this fails (quota exceeded, private mode) the user's work
    // survives in memory but dies on reload — they must be told, not quietly lose it.
    console.error(`[store] FAILED to persist ${key} — changes will be LOST on reload.`, e);
    throw new Error(`Could not save to demo storage (${key}). Your change may be lost on reload.`);
  }
};

/**
 * Build a persistence adapter for the current mode.
 *
 * @param {boolean} demoMode
 * @returns an object with the SAME shape in both modes.
 */
export function createStore(demoMode) {
  if (demoMode) {
    return {
      mode: 'demo',

      /** Insert or update one record by id. */
      async save(collectionName, record) {
        const key = DEMO_KEY[collectionName];
        if (!key) throw new Error(`[store] no demo backing key for "${collectionName}"`);
        const rows = readAll(key) || [];
        const idx = rows.findIndex((r) => r.id === record.id);
        if (idx >= 0) rows[idx] = record; else rows.unshift(record);
        writeAll(key, rows);
        return record.id;
      },

      /**
       * UPSERT MANY. Never deletes.
       *
       * This originally REPLACED the whole collection in demo while production merely
       * upserted — so `saveAll(c, [])` wiped every demo record and did nothing at all in
       * production. The equivalence test caught it. Deletion now has exactly one route
       * (`remove`), so the two backends cannot drift apart.
       */
      async saveAll(collectionName, records) {
        const key = DEMO_KEY[collectionName];
        if (!key) throw new Error(`[store] no demo backing key for "${collectionName}"`);
        const rows = readAll(key) || [];
        records.forEach((rec) => {
          const idx = rows.findIndex((r) => r.id === rec.id);
          if (idx >= 0) rows[idx] = rec; else rows.unshift(rec);
        });
        writeAll(key, rows);
      },

      /**
       * SYNC a whole collection from `prev` to `next`: upsert what changed, delete what
       * disappeared. This is deliberately distinct from `saveAll` (which never deletes)
       * because the container's existing `persistDocsDiff` has exactly these semantics,
       * and silently changing them during a migration is how data goes missing.
       *
       * @param idField the natural key — 'id' for most collections, 'jobNo' for job cards.
       */
      async syncAll(collectionName, prev, next, idField = 'id') {
        const key = DEMO_KEY[collectionName];
        if (!key) throw new Error(`[store] no demo backing key for "${collectionName}"`);
        // Demo has no server: `next` IS the whole collection, so write it wholesale.
        // That is equivalent to "upsert changed + delete missing" against `prev`.
        writeAll(key, next);
      },

      async remove(collectionName, id) {
        const key = DEMO_KEY[collectionName];
        if (!key) throw new Error(`[store] no demo backing key for "${collectionName}"`);
        writeAll(key, (readAll(key) || []).filter((r) => r.id !== id));
      },

      async list(collectionName) {
        const key = DEMO_KEY[collectionName];
        return key ? (readAll(key) || []) : [];
      },

      /** Demo has no server, so a "subscription" is a one-shot read. */
      subscribe(collectionName, onData) {
        const key = DEMO_KEY[collectionName];
        onData(key ? (readAll(key) || []) : []);
        return () => {};    // same contract as Firestore: returns an unsubscribe
      },
    };
  }

  return {
    mode: 'production',

    async save(collectionName, record) {
      const { id, ...data } = record;
      return id ? repo.upsert(collectionName, id, data) : repo.create(collectionName, data);
    },

    async saveAll(collectionName, records) {
      // Batched + chunked at 500 by the repository — Firestore's hard batch limit.
      await repo.commitBatch(records.map((r) => ({
        type: 'set', collection: collectionName, id: r.id, data: r,
      })));
    },

    /**
     * SYNC: upsert what changed, delete what disappeared.
     *
     * This mirrors the container's `persistDocsDiff` byte-for-byte in behaviour:
     *   - only writes docs whose JSON actually changed (avoids pointless writes, which
     *     cost money and burn quota),
     *   - guarantees a numeric `createdAt` so `orderBy('createdAt')` stays consistent
     *     across devices whose clocks disagree,
     *   - deletes docs present in `prev` but absent from `next`.
     * Any deviation here silently loses or duplicates customer records, so it is a
     * faithful port, not an improvement.
     */
    async syncAll(collectionName, prev, next, idField = 'id') {
      const prevMap = new Map((prev || []).map((d) => [d[idField], d]));
      const nextMap = new Map((next || []).map((d) => [d[idField], d]));
      const ops = [];

      (next || []).forEach((d) => {
        const before = prevMap.get(d[idField]);
        if (!before || JSON.stringify(before) !== JSON.stringify(d)) {
          ops.push({
            type: 'set',
            collection: collectionName,
            id: String(d[idField]),
            data: { ...d, createdAt: d.createdAt || Date.now(), updatedAt: new Date() },
            merge: true,
          });
        }
      });
      (prev || []).forEach((d) => {
        if (!nextMap.has(d[idField])) {
          ops.push({ type: 'delete', collection: collectionName, id: String(d[idField]) });
        }
      });

      if (!ops.length) return;
      await repo.commitBatch(ops);
    },

    async remove(collectionName, id) {
      return repo.remove(collectionName, id);
    },

    async list(collectionName) {
      const { rows } = await repo.fetchPage(collectionName, {});
      return rows;
    },

    subscribe(collectionName, onData, onError) {
      // Always bounded — the repository throws if `max` is omitted.
      return repo.subscribeWindow(collectionName, {
        max: 1000, onData, onError,
      });
    },
  };
}
