/**
 * services/capacityService.js
 *
 * RECORD-CAPACITY MANAGEMENT — the one engine behind the 5,000-active-record policy
 * (see constants/capacity.js) for every applicable high-growth collection.
 *
 * WHAT THIS FILE OWNS:
 *   - counting active records without downloading them (production: a real Firestore
 *     aggregate read via repositories/firestoreRepository.js's count(); demo: the
 *     already-local array's length — see persistenceStore.js for why those are the
 *     right primitive for each mode),
 *   - finding the oldest ELIGIBLE records for cleanup — "eligible" excludes anything
 *     still tied to an open business process (an active job card, an unpaid invoice, an
 *     in-progress purchase order), determined from the SAME status logic the rest of the
 *     app already trusts (e.g. `invoiceStatus()` from billingService, not a re-implementation),
 *   - the three cleanup operations (delete / export-then-delete / archive), each
 *     batched through persistenceStore so a 1,000-record cleanup never downloads more
 *     than it has to and never issues 1,000 individual writes,
 *   - writing an audit trail entry for every cleanup, through the SAME auditLog
 *     collection/local-storage key the rest of the app's audit trail already uses (see
 *     COLLECTIONS.AUDIT_LOG) — so a cleanup shows up in the existing Audit Log panel
 *     with no separate history UI to build.
 *
 * WHAT THIS FILE DOES NOT OWN: whether a given invoice/job-card/PO's own status is
 * correct — that logic lives in billingService.js / the job-card and PO status enums,
 * and is imported here rather than duplicated (services/README.md: "Financial
 * calculations... change only with a corresponding test update").
 */

import { serverTimestamp } from 'firebase/firestore';
import { createStore } from './persistenceStore';
import * as repo from '../repositories/firestoreRepository';
import { invoiceStatus } from './billingService';
import { tsToDate, pluralize } from '../lib/format';
import { writeSheet, stamp as dateStamp } from '../lib/exportSheet';
import { COLLECTIONS } from '../constants/index';
import {
  CAPACITY_MODULES, CAPACITY_LIMIT, CAPACITY_WARNING_THRESHOLD, CLEANUP_BATCH_SIZE,
  TERMINAL_JOB_CARD_STATUSES, TERMINAL_PO_STATUSES, TERMINAL_INVOICE_STATUSES,
} from '../constants/capacity';

// Safety bound on how many records the oldest-eligible scan will walk through looking
// for CLEANUP_BATCH_SIZE eligible ones, in case a pathological dataset has far more
// protected than eligible old records. Generous (well above the batch size) without
// being unbounded — see getCleanupPreview().
const MAX_SCAN = CAPACITY_LIMIT + 1000;
const PROD_PAGE_SIZE = 500;

function moduleConfig(moduleKey) {
  const cfg = CAPACITY_MODULES[moduleKey];
  if (!cfg) throw new Error(`[capacityService] unknown capacity module "${moduleKey}"`);
  return cfg;
}

/**
 * Is this record safe to delete/archive right now? Never array position, never load
 * order — always the record's own current business state, checked the same way the
 * rest of the app checks it.
 *
 * `ctx` optionally carries cross-collection reference sets the CALLER already has
 * loaded in memory (e.g. a component already holds the bounded `invoices` array via its
 * live subscription) — passing them in avoids an extra Firestore read purely for a
 * protection check. Without `ctx`, the cross-reference checks are skipped (documented
 * per module below) rather than silently treated as "protected forever".
 */
function checkEligibility(moduleKey, record, ctx = {}) {
  switch (moduleKey) {
    case 'jobCards': {
      if (!TERMINAL_JOB_CARD_STATUSES.includes(record.status)) {
        return { eligible: false, reason: `Active job card (status: ${record.status || 'unknown'})` };
      }
      // A closed/delivered/cancelled card can still be the jobNo an open invoice
      // references — deleting it would orphan that invoice's job-card link. Job cards
      // are keyed by jobNo, not `.id` (see the idField note on this module's config).
      if (ctx.activeInvoiceJobNos && ctx.activeInvoiceJobNos.has(record.jobNo)) {
        return { eligible: false, reason: 'Linked to a still-open invoice' };
      }
      return { eligible: true };
    }
    case 'invoices': {
      const status = invoiceStatus(record);
      if (!TERMINAL_INVOICE_STATUSES.includes(status)) {
        return { eligible: false, reason: `Invoice not yet settled (status: ${status})` };
      }
      return { eligible: true };
    }
    case 'purchaseOrders': {
      if (!TERMINAL_PO_STATUSES.includes(record.status)) {
        return { eligible: false, reason: `Purchase order still in progress (status: ${record.status || 'unknown'})` };
      }
      return { eligible: true };
    }
    case 'sales': {
      // Sales/Services ledger rows carry the invoice number that generated them
      // (`source: 'invoice', invoiceNo`). A row whose parent invoice is still open is
      // protected — the invoice may still be edited, and its ledger rows recomputed.
      if (record.invoiceNo && ctx.activeInvoiceNos && ctx.activeInvoiceNos.has(record.invoiceNo)) {
        return { eligible: false, reason: 'Parent invoice is still open' };
      }
      return { eligible: true };
    }
    // Stock In (restocks) and Stock Out (stockAdjustments) are terminal, immutable
    // receipt/movement events with no in-progress workflow state — nothing to protect.
    case 'restocks':
    case 'stockAdjustments':
    default:
      return { eligible: true };
  }
}

function recordDate(moduleKey, record) {
  const cfg = moduleConfig(moduleKey);
  return tsToDate(record[cfg.dateField]);
}

/** The record's identity value for this module — `.id` for everything except job
 *  cards, which key on `jobNo` (see that module's `idField` config for why). */
function recordId(moduleKey, record) {
  const cfg = moduleConfig(moduleKey);
  return record[cfg.idField || 'id'];
}

const fmtDate = (d) => (d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

/**
 * Active-record count for one module, WITHOUT downloading the records themselves.
 * `active = total - archived` (see persistenceStore.countArchived for why that's the
 * safe form rather than a direct "archived == false" query).
 */
export async function getCapacityStatus(moduleKey, { demoMode }) {
  const cfg = moduleConfig(moduleKey);
  const store = createStore(demoMode);
  const [total, archived] = await Promise.all([
    store.count(cfg.collection),
    store.countArchived(cfg.collection),
  ]);
  const count = Math.max(0, total - archived);
  return {
    moduleKey,
    count,
    archived,
    limit: CAPACITY_LIMIT,
    warningThreshold: CAPACITY_WARNING_THRESHOLD,
    remaining: Math.max(0, CAPACITY_LIMIT - count),
    atWarning: count >= CAPACITY_WARNING_THRESHOLD && count < CAPACITY_LIMIT,
    atLimit: count >= CAPACITY_LIMIT,
  };
}

/**
 * Find the oldest CLEANUP_BATCH_SIZE eligible records, oldest-first, skipping over
 * (and counting) any protected records encountered along the way — matching the
 * product brief's own worked example: "Oldest: 1,300 → Eligible: 1,000, Protected: 300."
 *
 * Demo mode scans the already-local array (cheap — no network cost either way).
 * Production mode pages through Firestore oldest-first via fetchPage(), never pulling
 * more than MAX_SCAN documents even in the worst case of a mostly-protected old tail.
 */
export async function getCleanupPreview(moduleKey, { demoMode, ctx = {}, batchSize = CLEANUP_BATCH_SIZE } = {}) {
  const cfg = moduleConfig(moduleKey);
  const eligible = [];
  const protectedSamples = [];
  let protectedCount = 0;
  let scannedCount = 0;

  const consider = (record) => {
    if (record.archived === true) return; // already out of the active set
    scannedCount += 1;
    const verdict = checkEligibility(moduleKey, record, ctx);
    if (verdict.eligible) {
      eligible.push(record);
    } else {
      protectedCount += 1;
      if (protectedSamples.length < 5) protectedSamples.push({ id: recordId(moduleKey, record), reason: verdict.reason });
    }
  };

  if (demoMode) {
    const store = createStore(true);
    const all = await store.list(cfg.collection);
    const sorted = [...all].sort((a, b) => {
      const da = recordDate(moduleKey, a)?.getTime() ?? 0;
      const db = recordDate(moduleKey, b)?.getTime() ?? 0;
      return da - db; // oldest first
    });
    for (const record of sorted) {
      if (eligible.length >= batchSize || scannedCount >= MAX_SCAN) break;
      consider(record);
    }
  } else {
    let cursor = null;
    let done = false;
    while (!done && eligible.length < batchSize && scannedCount < MAX_SCAN) {
      // eslint-disable-next-line no-await-in-loop
      const page = await repo.fetchPage(cfg.collection, {
        pageSize: PROD_PAGE_SIZE, orderField: cfg.dateField, direction: 'asc', cursor,
      });
      page.rows.forEach((record) => {
        if (eligible.length >= batchSize || scannedCount >= MAX_SCAN) return;
        consider(record);
      });
      cursor = page.cursor;
      done = page.done;
    }
  }

  const dates = eligible.map((r) => recordDate(moduleKey, r)).filter(Boolean).sort((a, b) => a - b);
  return {
    moduleKey,
    eligible,
    eligibleCount: eligible.length,
    protectedCount,
    protectedSamples,
    scannedCount,
    dateFrom: dates[0] || null,
    dateTo: dates[dates.length - 1] || null,
    dateRangeLabel: dates.length ? `${fmtDate(dates[0])} → ${fmtDate(dates[dates.length - 1])}` : '—',
  };
}

// ---------------------------------------------------------------------------
// Per-module Excel column mapping — one place, reused by both the standalone "Export"
// action and the "Export to Excel & Delete" cleanup path.
// ---------------------------------------------------------------------------
const EXPORT_COLUMNS = {
  jobCards: {
    head: ['Job No', 'Customer', 'Vehicle', 'Reg No', 'Status', 'Created'],
    dateCols: [5],
    row: (r) => [r.jobNo || r.id, r.customer || '', r.vehicle || '', r.regNo || '', r.status || '', tsToDate(r.createdAt) || ''],
  },
  invoices: {
    head: ['Invoice No', 'Customer', 'Vehicle', 'Status', 'Grand Total', 'Date'],
    dateCols: [5],
    row: (r) => [r.invNo || r.id, r.customer || '', r.vehicle || '', invoiceStatus(r), r.grandTotal ?? r.grand ?? 0, tsToDate(r.date) || ''],
  },
  purchaseOrders: {
    head: ['PO No', 'Supplier', 'Status', 'Total', 'Created'],
    dateCols: [4],
    row: (r) => [r.poNo || r.id, r.supplierName || r.supplier || '', r.status || '', r.total ?? 0, tsToDate(r.createdAt) || ''],
  },
  restocks: {
    head: ['Part', 'Supplier', 'Qty', 'Cost', 'Date'],
    dateCols: [4],
    row: (r) => [r.name || r.partName || '', r.supplierName || r.supplier || '', r.qty ?? 0, r.cost ?? 0, tsToDate(r.purchaseDate || r.createdAt) || ''],
  },
  stockAdjustments: {
    head: ['Part', 'Reason', 'Qty Delta', 'Date'],
    dateCols: [3],
    row: (r) => [r.name || r.partName || '', r.reason || '', r.qty ?? r.delta ?? 0, tsToDate(r.createdAt) || ''],
  },
  sales: {
    head: ['Item', 'Category', 'Invoice No', 'Qty', 'Revenue', 'Date'],
    dateCols: [5],
    row: (r) => [r.name || '', r.category || r.revenueType || '', r.invoiceNo || '', r.qty ?? 0, r.revenue ?? r.total ?? 0, tsToDate(r.createdAt) || ''],
  },
  // Preserves the fields section 8 of the capacity brief calls out by name (event,
  // user, timestamp, record reference, metadata) — `details` is stringified rather than
  // dropped, since it's the before/after payload every audit consumer actually cares
  // about (see writeAudit/pushAudit call sites for what it holds per action type).
  auditLog: {
    head: ['Action', 'Entity', 'Entity ID', 'Performed By', 'Details', 'Date'],
    dateCols: [5],
    row: (r) => [r.action || '', r.entity || '', r.entityId || '', r.performedByEmail || r.performedBy || '', typeof r.details === 'string' ? r.details : JSON.stringify(r.details || {}), tsToDate(r.createdAt) || ''],
  },
};

/** Export a set of records to a real .xlsx file. Throws on failure — callers that chain
 *  a delete after this MUST check for that throw and skip the delete (see
 *  runExportAndDelete below); this function has no side effect beyond the file itself. */
export async function exportRecordsToExcel(moduleKey, records) {
  const cfg = moduleConfig(moduleKey);
  const cols = EXPORT_COLUMNS[moduleKey];
  await writeSheet({
    filename: `${cfg.collection}-oldest-${records.length}-${dateStamp()}.xlsx`,
    sheetName: cfg.label.slice(0, 31),
    head: cols.head,
    rows: records.map(cols.row),
    dateCols: cols.dateCols,
  });
}

// ---------------------------------------------------------------------------
// Audit trail — reuses the SAME auditLog collection/local-storage the rest of the app's
// Audit Log panel already reads (components/InventoryDashboard.js's pushAudit writes
// the same shape). A cleanup therefore shows up in the existing audit UI for free.
// ---------------------------------------------------------------------------
async function writeCapacityAudit({ demoMode, method, moduleKey, count, dateRangeLabel, actorEmail }) {
  const cfg = moduleConfig(moduleKey);
  const store = createStore(demoMode);
  const entry = {
    id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    action: `capacity_${method}`, // capacity_delete | capacity_export_delete | capacity_archive
    entity: cfg.label,
    entityId: '',
    details: `${count} ${pluralize(cfg.recordLabel, count)} (${dateRangeLabel}) via capacity cleanup`,
    performedBy: null,
    performedByEmail: actorEmail || null,
    createdAt: demoMode ? new Date().toISOString() : serverTimestamp(),
  };
  await store.save(COLLECTIONS.AUDIT_LOG, entry);
}

/** Permanently delete the given records. Truly permanent — no hidden retained copy. */
export async function deleteRecords(moduleKey, records, { demoMode, actorEmail } = {}) {
  const cfg = moduleConfig(moduleKey);
  const store = createStore(demoMode);
  const ids = records.map((r) => recordId(moduleKey, r));
  await store.removeMany(cfg.collection, ids, cfg.idField || 'id');
  const dates = records.map((r) => recordDate(moduleKey, r)).filter(Boolean).sort((a, b) => a - b);
  const dateRangeLabel = dates.length ? `${fmtDate(dates[0])} → ${fmtDate(dates[dates.length - 1])}` : '—';
  await writeCapacityAudit({ demoMode, method: 'delete', moduleKey, count: ids.length, dateRangeLabel, actorEmail });
  return { count: ids.length };
}

/**
 * Archive the given records: they leave the ACTIVE count (via the `archived` flag,
 * counted by countArchived()/getCapacityStatus()) but the documents themselves are
 * untouched otherwise — same id, same fields, still reachable by an "Archived"/"All"
 * view. This is the ONLY safe way to "move" a record given this app's pure-client
 * Firestore architecture (no backend to run a cross-collection migration): flipping a
 * flag on the existing document preserves every other collection's reference to it
 * (e.g. an invoice's `jobNo` still resolves) with zero new security-rule surface.
 */
export async function archiveRecords(moduleKey, records, { demoMode, actorEmail } = {}) {
  const cfg = moduleConfig(moduleKey);
  const store = createStore(demoMode);
  const ids = records.map((r) => recordId(moduleKey, r));
  const patch = { archived: true, archivedAt: demoMode ? new Date().toISOString() : serverTimestamp() };
  await store.updateMany(cfg.collection, ids, patch, cfg.idField || 'id');
  const dates = records.map((r) => recordDate(moduleKey, r)).filter(Boolean).sort((a, b) => a - b);
  const dateRangeLabel = dates.length ? `${fmtDate(dates[0])} → ${fmtDate(dates[dates.length - 1])}` : '—';
  await writeCapacityAudit({ demoMode, method: 'archive', moduleKey, count: ids.length, dateRangeLabel, actorEmail });
  return { count: ids.length };
}

/**
 * Export THEN delete, atomic from the user's point of view: the delete step never runs
 * unless the export step actually completed. If exportRecordsToExcel throws, this
 * function propagates that error and returns without touching a single document — the
 * caller's catch block is what the "No records were deleted" failure toast reports on.
 */
export async function exportAndDeleteRecords(moduleKey, records, { demoMode, actorEmail } = {}) {
  await exportRecordsToExcel(moduleKey, records); // throws => nothing below runs
  const cfg = moduleConfig(moduleKey);
  const store = createStore(demoMode);
  const ids = records.map((r) => recordId(moduleKey, r));
  await store.removeMany(cfg.collection, ids, cfg.idField || 'id');
  const dates = records.map((r) => recordDate(moduleKey, r)).filter(Boolean).sort((a, b) => a - b);
  const dateRangeLabel = dates.length ? `${fmtDate(dates[0])} → ${fmtDate(dates[dates.length - 1])}` : '—';
  await writeCapacityAudit({ demoMode, method: 'export_delete', moduleKey, count: ids.length, dateRangeLabel, actorEmail });
  return { count: ids.length };
}

export { CAPACITY_LIMIT, CAPACITY_WARNING_THRESHOLD, CLEANUP_BATCH_SIZE, CAPACITY_MODULES };
