// constants/capacity.js
//
// APPLICATION-WIDE RECORD-CAPACITY POLICY.
//
// WHY THIS EXISTS: Sales, Services, Job Cards, Invoices, Stock In, Stock Out and
// Purchase Orders are unbounded-growth ledgers — a workshop that runs for years will
// eventually accumulate thousands of them. Firestore bills per document read and a
// browser tab cannot hold an unbounded array (see repositories/firestoreRepository.js's
// own header on this), so "let it grow forever" is not a neutral choice, it is a slow
// failure. This file is the ONE place the numeric policy lives, so every module that
// enforces it reads the same limit instead of each inventing its own.
//
// Do not invent another maximum. 5,000 is the number the product decided on.
export const CAPACITY_LIMIT = 5000;

// Early warning at 90% of the limit — enough runway for a workshop to notice and act
// (roughly a week or two of normal volume) before the hard stop, without nagging from
// the very first thousand records the way a lower threshold would.
export const CAPACITY_WARNING_THRESHOLD = 4500;

// The default (and, per the product brief, only) cleanup batch size. Deliberately not
// user-adjustable: an arbitrary custom quantity is exactly the kind of "type any number
// you like" control that lets a distracted click free 1 record or 4,999 records with
// the same UI weight. A fixed, well-understood batch keeps every cleanup operation
// predictable and keeps `count - batch < limit` trivially true (5000 - 1000 = 4000).
export const CLEANUP_BATCH_SIZE = 1000;

/**
 * APPLICABLE MODULES — which collections this policy governs, and why.
 *
 * Deliberately NOT applied to every collection. Master/reference entities (customers,
 * vehicles, suppliers, parts) are edited-in-place records a workshop maintains for years,
 * not an append-only ledger — a shop with 4,000 customers isn't "running out of room",
 * it has 4,000 customers. Only genuinely high-growth, append-mostly transactional
 * ledgers are governed here.
 *
 * `dateField` is the field the OLDEST-cleanup query orders by. It must be a real, always-
 * present stored field — Firestore's orderBy() silently EXCLUDES any document missing
 * that field from the result set, so a field that's only sometimes populated (e.g.
 * restocks' `purchaseDate`) would make some old records invisible to cleanup rather than
 * eligible for it. `createdAt` is stamped on every write by
 * repositories/firestoreRepository.js's `create()`, so it is always present; `invoices`
 * uses its own `date` field instead (an ISO yyyy-mm-dd string — the actual invoice date
 * the business cares about, and lexicographically sortable, so orderBy still works and
 * matches "invoice date" as the brief requires).
 *
 * `hasDirectCreate` controls whether a create-time capacity GUARD applies. Sales and
 * Services are two UI lenses over the same `sales` collection, and a `sales` document is
 * never created directly by a user action — it is written automatically as a side effect
 * of billing an invoice (see services/billingService.js). There is no "Add Sale" button
 * to block, so blocking would have to happen at Invoice-save time instead, which already
 * has its OWN guard (the `invoices` module below) — gating the derived ledger a second
 * time would just block an unrelated invoice save for a reason the user can't see on
 * screen. `sales` therefore still gets the warning banner and full cleanup workflow
 * (it can still grow very large — several ledger rows per invoice), just no independent
 * "new record blocked" dialog of its own.
 */
export const CAPACITY_MODULES = Object.freeze({
  jobCards: {
    key: 'jobCards',
    collection: 'jobCards',
    label: 'Job Cards',
    recordLabel: 'job card',
    dateField: 'createdAt',
    hasDirectCreate: true,
    // Job cards are the ONE collection in this app keyed by a natural business id
    // (jobNo) instead of an opaque doc id — see InventoryDashboard.js's own
    // persistJobCardsDiff comment: "Job cards key on jobNo... NOT on `id`". In
    // production a Firestore doc's `.id` happens to equal its jobNo (docs are
    // written via setDoc(doc(db, COLLECTIONS.JOB_CARDS, jobNo)), so that case works
    // even without this override — but demo-mode records are plain objects that were
    // never given an `.id` field at all, so every other capacity module can rely on
    // the default ('id') while this one MUST use jobNo or every demo cleanup targets
    // the wrong (nonexistent) key and silently matches nothing — or, worse, matches
    // everything (every record's missing `.id` is equally `undefined`).
    idField: 'jobNo',
  },
  invoices: {
    key: 'invoices',
    collection: 'invoices',
    label: 'Billing / Invoices',
    recordLabel: 'invoice',
    dateField: 'date',
    hasDirectCreate: true,
  },
  purchaseOrders: {
    key: 'purchaseOrders',
    collection: 'purchaseOrders',
    label: 'Purchase Orders',
    recordLabel: 'purchase order',
    dateField: 'createdAt',
    hasDirectCreate: true,
  },
  restocks: {
    key: 'restocks',
    collection: 'restocks',
    label: 'Stock In',
    recordLabel: 'stock-in record',
    dateField: 'createdAt',
    hasDirectCreate: true,
  },
  stockAdjustments: {
    key: 'stockAdjustments',
    collection: 'stockAdjustments',
    label: 'Stock Out (Adjustments)',
    recordLabel: 'stock adjustment',
    dateField: 'createdAt',
    hasDirectCreate: true,
  },
  sales: {
    key: 'sales',
    collection: 'sales',
    label: 'Sales & Services Ledger',
    recordLabel: 'ledger entry',
    dateField: 'createdAt',
    hasDirectCreate: false, // see header comment — auto-created from Billing, not its own action
  },
  // Audit Log is append-only exhaust from EVERY other module (deletes, price changes,
  // stock adjustments, capacity cleanups themselves — see capacityService's own
  // writeCapacityAudit). There is no "Add Audit Entry" button, so — same reasoning as
  // `sales` above — it gets the warning banner and full cleanup workflow but no
  // independent create-time guard; gating would have to block an unrelated action
  // (e.g. deleting a part) for a capacity reason the user can't see on that screen.
  //
  // `allowedMethods` restricts this module to Archive / Export+Delete only — raw
  // permanent Delete is deliberately NOT offered here. Every other module's audit trail
  // depends on this collection being trustworthy history; an audit log is the one place
  // where "delete it and also write an audit entry about the delete" (capacityService's
  // normal safety net) is circular reassurance, not real retention. Archive keeps every
  // entry byte-identical and reachable; Export+Delete keeps an off-app backup before
  // anything leaves Firestore. See constants/capacity.js's `allowedMethods` doc below.
  auditLog: {
    key: 'auditLog',
    collection: 'auditLog',
    label: 'Audit Log',
    recordLabel: 'audit entry',
    dateField: 'createdAt',
    hasDirectCreate: false,
    allowedMethods: ['archive', 'export_delete'],
  },
});

/**
 * Which of the three cleanup methods (delete / export_delete / archive) a module's
 * cleanup wizard offers. Omit entirely to allow all three (the default for every
 * ordinary operational ledger) — only set this when a module's business/security
 * requirements specifically rule one out (see the `auditLog` entry above for the
 * only current example: CapacityCleanupModal.jsx reads this to filter its method list).
 */
export function allowedCleanupMethods(moduleKey) {
  const cfg = CAPACITY_MODULES[moduleKey];
  return cfg?.allowedMethods || ['delete', 'export_delete', 'archive'];
}

export const CAPACITY_MODULE_KEYS = Object.freeze(Object.keys(CAPACITY_MODULES));

/**
 * Terminal ("closed", cleanup-eligible) status sets — the SAME sets
 * services/capacityService.js uses internally to decide eligibility. Exported so a
 * calling component can build its OWN cross-reference lookup (e.g. "which job-card
 * numbers does a still-open invoice reference?") from data it already has loaded,
 * without duplicating this list a second time and risking the two drifting apart.
 */
export const TERMINAL_JOB_CARD_STATUSES = Object.freeze(['Delivered', 'Closed', 'Cancelled']);
export const TERMINAL_PO_STATUSES = Object.freeze(['received', 'cancelled']);
export const TERMINAL_INVOICE_STATUSES = Object.freeze(['Paid', 'Cancelled', 'Refunded', 'Returned']);
