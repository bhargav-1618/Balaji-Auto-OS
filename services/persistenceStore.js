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

import { where } from 'firebase/firestore';
import { STORAGE } from '../constants';
import * as repo from '../repositories/firestoreRepository';
import { allocateNumber as allocateCounterNumber, allocationStep } from '../lib/docCounter';
import { revState, conflictError, replayIdArray, isIdKeyedArray } from '../lib/concurrency';

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
       * GUARDED UPDATE of an existing record — optimistic concurrency (Phase 1a).
       *
       * Demo mode has a single in-memory client, so a real conflict is not
       * reachable here; this exists so the SAME `_rev` bookkeeping and the SAME
       * error contract (conc/deleted, conc/stale) run in both modes and the two
       * backends cannot drift. It rejects if the row is gone or its `_rev` moved,
       * and otherwise merges + increments `_rev` exactly once.
       */
      async saveGuarded(collectionName, record, expectedRev, {
        idField = 'id', label, idArrayKeys = [], clientBefore = null,
      } = {}) {
        const key = DEMO_KEY[collectionName];
        if (!key) throw new Error(`[store] no demo backing key for "${collectionName}"`);
        const rows = readAll(key) || [];
        const idx = rows.findIndex((r) => r[idField] === record[idField]);
        const state = revState(idx >= 0 ? rows[idx] : null, expectedRev);
        const err = conflictError(state, label);
        if (err) throw err;
        const { [idField]: _dropId, _rev: _dropRev, ...clean } = record;
        // Phase 3b (CWF-03) — same id-keyed array replay as production guardedSet
        // so the two backends keep an identical contract (a no-op with one client).
        for (const k of idArrayKeys) {
          if (Object.prototype.hasOwnProperty.call(clean, k)) {
            clean[k] = replayIdArray(clientBefore ? clientBefore[k] : undefined, clean[k], idx >= 0 ? rows[idx][k] : undefined);
          }
        }
        const merged = { ...rows[idx], ...clean, _rev: state.nextRev };
        rows[idx] = merged;
        writeAll(key, rows);
        return merged;
      },

      /**
       * ALLOCATE the next number in a named sequence (CONCURRENCY PHASE 2).
       *
       * Demo has one in-memory client, so there is no race to protect against —
       * but the SAME allocation decision (lib/docCounter.allocationStep) runs, and
       * a per-sequence counter blob is persisted so numbers stay stable across a
       * reload without a server. `seedFrom` (highest known + 1) initialises a
       * missing counter and pulls a lagging one forward, exactly as production.
       */
      async allocateNumber(sequence, seedFrom = 1) {
        const all = readAll(STORAGE.DEMO_COUNTERS) || {};
        const { allocated, nextNext } = allocationStep(all[sequence], seedFrom);
        all[sequence] = nextNext;
        writeAll(STORAGE.DEMO_COUNTERS, all);
        return allocated;
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

      /**
       * Count without loading records into a caller's state. Demo data already lives
       * entirely in local/session storage (no network round-trip either way), so this is
       * just `list().length` — the expensive part this mirrors (a real Firestore
       * aggregate read) simply doesn't exist in demo mode. See the production branch for
       * where that actually matters.
       */
      async count(collectionName) {
        const key = DEMO_KEY[collectionName];
        return key ? (readAll(key) || []).length : 0;
      },

      /**
       * Count only ARCHIVED records. Paired with `count()` by the capacity system to
       * derive `active = total - archived` — see the production branch for why that
       * subtraction, not a direct "count where archived==false" query, is the safe form.
       */
      async countArchived(collectionName) {
        const key = DEMO_KEY[collectionName];
        return key ? (readAll(key) || []).filter((r) => r.archived === true).length : 0;
      },

      /** Demo has no server, so a "subscription" is a one-shot read. */
      subscribe(collectionName, onData) {
        const key = DEMO_KEY[collectionName];
        onData(key ? (readAll(key) || []) : []);
        return () => {};    // same contract as Firestore: returns an unsubscribe
      },

      /**
       * Bulk delete by id. Used by the capacity-cleanup system (services/capacityService.js)
       * to remove up to 1,000 records in one pass instead of 1,000 separate `remove()`
       * calls — in demo mode that's one storage write instead of a thousand.
       *
       * `idField` defaults to 'id', but job cards key on `jobNo` instead (see
       * COLLECTIONS.JOB_CARDS callers) — demo-mode job card records were never given an
       * `.id` field at all, so filtering by `.id` there would match nothing (or, since
       * every record's missing `.id` is equally `undefined`, could match everything).
       */
      async removeMany(collectionName, ids, idField = 'id') {
        const key = DEMO_KEY[collectionName];
        if (!key) throw new Error(`[store] no demo backing key for "${collectionName}"`);
        const idSet = new Set(ids);
        writeAll(key, (readAll(key) || []).filter((r) => !idSet.has(r[idField])));
      },

      /**
       * Bulk patch by id (used for archiving: `{ archived: true, archivedAt }`). Merges
       * `patch` into each matching record rather than replacing it, matching `save()`'s
       * upsert-by-id semantics. See removeMany above for why `idField` is configurable.
       */
      async updateMany(collectionName, ids, patch, idField = 'id') {
        const key = DEMO_KEY[collectionName];
        if (!key) throw new Error(`[store] no demo backing key for "${collectionName}"`);
        const idSet = new Set(ids);
        const rows = (readAll(key) || []).map((r) => (idSet.has(r[idField]) ? { ...r, ...patch } : r));
        writeAll(key, rows);
      },
    };
  }

  return {
    mode: 'production',

    async save(collectionName, record) {
      const { id, ...data } = record;
      return id ? repo.upsert(collectionName, id, data) : repo.create(collectionName, data);
    },

    /**
     * GUARDED UPDATE of an existing record — optimistic concurrency (Phase 1a).
     * Delegates to the repository's transactional guardedSet: re-read, verify the
     * document exists, verify `_rev` still matches what the editor captured, then
     * merge + bump `_rev` atomically. Throws ConcurrencyError('conc/deleted' |
     * 'conc/stale') — the caller surfaces a safe message and keeps the editor open.
     */
    async saveGuarded(collectionName, record, expectedRev, {
      idField = 'id', label, idArrayKeys, clientBefore,
    } = {}) {
      return repo.guardedSet(
        collectionName, record[idField], record, expectedRev, label,
        { idArrayKeys, clientBefore },
      );
    },

    /**
     * ALLOCATE the next number in a named sequence (CONCURRENCY PHASE 2).
     * Delegates to lib/docCounter's Firestore transaction on `counters/<sequence>`
     * — the authoritative, retry-safe, collision-proof allocator. `seedFrom` is
     * the highest number the caller already knows about + 1 (from its loaded
     * list); it initialises a missing counter and self-heals a lagging one.
     */
    async allocateNumber(sequence, seedFrom) {
      return allocateCounterNumber(sequence, seedFrom);
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
     *
     * PHASE 8B (PH8-06) — CLASSIFICATION: this is an INDEPENDENT BATCH across the
     * documents it diffs, not a single atomic transaction spanning all of them.
     * Two phases: (1) every create/delete/scalar-update goes into ONE commitBatch
     * call (atomic within a 500-op chunk — see commitBatch's own PH8-03 note for
     * the >500 case); (2) id-keyed-array field changes (e.g. a customer's
     * `vehicles`/`noteEntries`) then run as a SEQUENTIAL loop of independent
     * per-document transactions (applySecondaryMerge), because each needs its own
     * server-truth read to replay onto (see lib/concurrency.js replayIdArray).
     * This is intentional, not a shortcut: `next`/`prev` here are almost always
     * ONE caller's own set of edits to UNRELATED documents (e.g. a bulk archive of
     * many different customers) — forcing them into one giant transaction would
     * only add lock contention between documents that have nothing to do with each
     * other, for no correctness benefit (a single business record's own edit is
     * still exactly one document in this diff in the overwhelmingly common case).
     * SAFETY: if phase 2 fails partway (doc A's merge succeeds, doc B's throws),
     * the loop stops and the rejection propagates to the caller (persistDocsDiff /
     * persistJobCardsDiff / setCustomers all re-throw after toasting — never
     * silently reported as success). RECOVERY: every write here is naturally
     * idempotent on retry — a create/update batch op re-applies the same target
     * values (a no-op if already there), and replayIdArray is explicitly
     * idempotent by design (re-running the same replay onto the now-current
     * server array yields the same result) — so a caller re-invoking syncAll with
     * the SAME prev/next after a partial failure always converges to the fully
     * -applied state, never double-applies the part that already committed, and
     * never loses a change that was still pending.
     */
    async syncAll(collectionName, prev, next, idField = 'id') {
      const prevMap = new Map((prev || []).map((d) => [d[idField], d]));
      const nextMap = new Map((next || []).map((d) => [d[idField], d]));
      const batchOps = [];      // creates + deletes — safe to commit together
      const merges = [];        // changed EXISTING docs — field-level, one at a time

      (next || []).forEach((d) => {
        const before = prevMap.get(d[idField]);
        if (!before) {
          batchOps.push({
            type: 'set',
            collection: collectionName,
            id: String(d[idField]),
            data: { ...d, createdAt: d.createdAt || Date.now(), updatedAt: new Date() },
            merge: true,
          });
          return;
        }
        if (JSON.stringify(before) === JSON.stringify(d)) return;   // nothing changed

        // Phase 3b (CWF-03) — write ONLY the top-level keys that actually changed,
        // not the whole document. A concurrent secondary write to a DIFFERENT field
        // then can't be reverted, and a `batch.update` (not `set merge`) can't
        // resurrect a doc deleted concurrently. For id-keyed array fields (customer
        // `vehicles`, `noteEntries`) the change is applied by replaying this
        // client's add/remove/edit onto the server's current array inside a
        // transaction, so a concurrent add to the SAME array also survives.
        const plainFields = {};
        const idArrayReplays = [];
        Object.keys(d).forEach((k) => {
          if (k === idField) return;
          if (JSON.stringify(before[k]) === JSON.stringify(d[k])) return;
          if (isIdKeyedArray(before[k]) || isIdKeyedArray(d[k])) {
            idArrayReplays.push({ key: k, before: before[k], after: d[k] });
          } else {
            plainFields[k] = d[k];
          }
        });
        if (!Object.keys(plainFields).length && !idArrayReplays.length) return;
        if (!idArrayReplays.length) {
          // scalar-only change — an atomic field update, batched with the rest
          batchOps.push({
            type: 'update',
            collection: collectionName,
            id: String(d[idField]),
            data: { ...plainFields, updatedAt: new Date() },
          });
        } else {
          merges.push({ id: String(d[idField]), plainFields, idArrayReplays });
        }
      });
      (prev || []).forEach((d) => {
        if (!nextMap.has(d[idField])) {
          batchOps.push({ type: 'delete', collection: collectionName, id: String(d[idField]) });
        }
      });

      if (batchOps.length) await repo.commitBatch(batchOps);
      for (const m of merges) {
        // eslint-disable-next-line no-await-in-loop
        await repo.applySecondaryMerge(collectionName, m.id, m.plainFields, m.idArrayReplays);
      }
    },

    async remove(collectionName, id) {
      return repo.remove(collectionName, id);
    },

    async list(collectionName) {
      const { rows } = await repo.fetchPage(collectionName, {});
      return rows;
    },

    /** A real Firestore aggregate count — one small read, regardless of collection size. */
    async count(collectionName) {
      return repo.count(collectionName, []);
    },

    /**
     * Count only ARCHIVED records via `where('archived','==',true)`. NOT mirrored as
     * `where('archived','==',false)` for "active" — pre-existing documents written
     * before this feature shipped have no `archived` field at all, and Firestore
     * equality queries never match a missing field against `false`, so that query would
     * silently return 0 and undercount every legacy record as "not active". Deriving
     * `active = total - archived` (see services/capacityService.js) is correct
     * regardless of whether the field exists on a given document.
     */
    async countArchived(collectionName) {
      return repo.count(collectionName, [where('archived', '==', true)]);
    },

    subscribe(collectionName, onData, onError) {
      // Always bounded — the repository throws if `max` is omitted.
      return repo.subscribeWindow(collectionName, {
        max: 1000, onData, onError,
      });
    },

    /**
     * Bulk delete by id, batched/chunked at 500 by the repository. No `idField` param
     * needed here (unlike the demo branch above) — `ids` must already be the caller's
     * chosen identity VALUES (e.g. jobNo for job cards), and a Firestore doc lookup by
     * id doesn't care what business field that value conceptually represents.
     */
    async removeMany(collectionName, ids) {
      await repo.commitBatch(ids.map((id) => ({ type: 'delete', collection: collectionName, id })));
    },

    /** Bulk patch by id, batched/chunked at 500 by the repository. Same id-value note as removeMany. */
    async updateMany(collectionName, ids, patch) {
      await repo.commitBatch(ids.map((id) => ({ type: 'update', collection: collectionName, id, data: patch })));
    },
  };
}
