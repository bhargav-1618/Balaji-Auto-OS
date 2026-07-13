/**
 * Single source of truth for every magic string and number in the app.
 *
 * WHY THIS EXISTS: there were 40 distinct storage keys written as raw strings in 107
 * places. A single typo ('maruti_demo_sales' vs 'maruti_demo_sale') silently reads back
 * `null`, the app falls through to a seed, and the user's data appears to vanish with no
 * error — which is exactly the class of failure that produced the demo/ledger split.
 * Referencing a constant makes that a build-time ReferenceError instead.
 */

// ---------------------------------------------------------------------------
// Firestore collections. Never type these inline.
// ---------------------------------------------------------------------------
export const COLLECTIONS = Object.freeze({
  PARTS: 'parts',
  SUPPLIERS: 'suppliers',
  CUSTOMERS: 'customers',
  INVOICES: 'invoices',
  JOB_CARDS: 'jobCards',
  SALES: 'sales',
  RESTOCKS: 'restocks',
  STOCK_ADJUSTMENTS: 'stockAdjustments',
  REORDER_REQUESTS: 'reorderRequests',
  PURCHASE_ORDERS: 'purchaseOrders',
  AUDIT_LOG: 'auditLog',
  CATEGORIES: 'categories',
  VEHICLES: 'vehicles',
  SETTINGS: 'settings',
  STAFF: 'staff',
});

// ---------------------------------------------------------------------------
// Browser storage keys.
// ---------------------------------------------------------------------------
export const STORAGE = Object.freeze({
  // demo dataset (sessionStorage — cleared when the tab closes)
  DEMO_INVENTORY: 'maruti_demo_inv',
  DEMO_SUPPLIERS: 'maruti_demo_sup',
  DEMO_SALES: 'maruti_demo_sales',
  DEMO_RESTOCKS: 'maruti_demo_rs',
  DEMO_ADJUSTMENTS: 'maruti_demo_adj',
  DEMO_PURCHASE_ORDERS: 'maruti_demo_po',
  DEMO_AUDIT: 'maruti_demo_audit',
  DEMO_GARAGE_SEED: 'maruti_garage_seed',

  // demo dataset (localStorage — survives a tab close)
  DEMO_CUSTOMERS: 'maruti_customers_demo',
  DEMO_JOB_CARDS: 'maruti_jobcards_demo',
  DEMO_INVOICES: 'maruti_invoices_demo',
  DEMO_SCHEMA: 'maruti_demo_schema',

  // production caches (offline-first)
  PROD_CUSTOMERS: 'maruti_customers_prod',
  PROD_INVOICES: 'maruti_invoices_prod',
  PROD_JOB_CARDS: 'maruti_jobcards_prod',

  // user preferences
  PREFS: 'maruti_prefs',
  SETTINGS: 'maruti_settings',
  NAV_GROUPS: 'maruti_nav_groups',
  SIDEBAR_COLLAPSED: 'maruti_sidebar_collapsed',
  THEME: 'maruti_theme',

  // drafts (crash recovery)
  DRAFT_INVOICE: 'maruti_invoice_draft_v2',
  DRAFT_JOB_CARD: 'maruti_jobcard_draft_v2',
  DRAFT_PART: 'maruti_part_draft_v2',
  DRAFT_SUPPLIER: 'maruti_supplier_draft_v2',

  // diagnostics
  TXN_DEBUG: 'TXN_DEBUG',
});

// ---------------------------------------------------------------------------
// SCALE LIMITS.
//
// These are the numbers that keep Firestore affordable and the browser alive.
// Target scale: 10k parts, 100k customers, 50k vehicles, 500 concurrent users.
//
// Firestore bills PER DOCUMENT READ. An unbounded onSnapshot on `customers` at 100k
// docs costs 100,000 reads EVERY time a dashboard opens — ~$0.06 per user per load,
// ~$30 for 500 users, repeated on every reconnect. It also puts 100k objects into a
// React array, which will exhaust a browser tab.
//
// So: never subscribe to a whole collection. Subscribe to a bounded, ordered window
// and page/search the rest on demand.
// ---------------------------------------------------------------------------
export const LIMITS = Object.freeze({
  // live listener windows (the "hot" set the user actually looks at)
  PARTS_LIVE: 2000,
  CUSTOMERS_LIVE: 1000,
  SUPPLIERS_LIVE: 500,
  // NOTE: invoices/jobCards were hardcoded at limit(3000) in the container, bypassing
  // this file entirely. Raised here to match the SHIPPED behaviour rather than silently
  // shrinking a workshop's visible history — changing what a user can see is a product
  // decision, not a refactor. Lower it deliberately if the read cost justifies it.
  INVOICES_LIVE: 3000,
  JOB_CARDS_LIVE: 3000,
  SALES_LIVE: 2000,
  AUDIT_LIVE: 500,
  RESTOCKS_LIVE: 500,
  STOCK_ADJUSTMENTS_LIVE: 500,

  // on-demand paging (search / "load more")
  PAGE_SIZE: 50,
  SEARCH_RESULTS: 100,

  // UI guards
  DROPDOWN_VIRTUALISE_OVER: 60,
  MAX_AUDIT_ENTRIES: 500,
  MAX_VEHICLE_HISTORY: 50,
});

// ---------------------------------------------------------------------------
// Domain statuses. The ORDER of JOB_CARD_STATUSES is the workflow — the code enforces
// "you cannot skip a stage" against these indexes, so never reorder them casually.
// ---------------------------------------------------------------------------
export const INVOICE_STATUS = Object.freeze({
  DRAFT: 'Draft',
  ESTIMATE: 'Estimate',
  PENDING: 'Pending',
  PARTIALLY_PAID: 'Partially Paid',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
  RETURNED: 'Returned',
});

/** Statuses that mean money was NOT actually received — the engine must not fire. */
export const NON_REALIZING_STATUSES = Object.freeze([
  INVOICE_STATUS.CANCELLED,
  INVOICE_STATUS.REFUNDED,
  INVOICE_STATUS.RETURNED,
]);

export const JOB_CARD_STATUSES = Object.freeze([
  'Received', 'Inspection', 'Estimate Ready', 'Estimate Approved', 'Waiting Parts',
  'Repair Started', 'Repair Paused', 'Quality Check', 'Wash', 'Ready',
  'Delivered', 'Closed', 'Cancelled',
]);

/** Job cards that can still be billed (i.e. not finished or abandoned). */
export const BILLABLE_JOB_CARD_STATUSES = Object.freeze([
  'Received', 'Inspection', 'Estimate Ready', 'Estimate Approved', 'Waiting Parts',
  'Repair Started', 'Repair Paused', 'Quality Check', 'Wash', 'Ready',
]);

export const LINE_KIND = Object.freeze({
  PART: 'Part',
  LABOUR: 'Labour',
  OTHER: 'Other',      // outside purchase
});

export const REVENUE_CATEGORY = Object.freeze({
  PARTS: 'Parts',
  LABOUR: 'Labour',
  OUTSIDE_PURCHASE: 'Outside Purchase',
  SERVICE: 'Service',
});

export const DOC_PREFIX = Object.freeze({
  INVOICE: 'INV',
  ESTIMATE: 'EST',
  DRAFT: 'DRF',
});

export const ROLES = Object.freeze({
  ADMIN: 'admin',
  STAFF: 'staff',
  DEMO: 'demo',
});

export const GST_RATES = Object.freeze([0, 5, 12, 18, 28]);

export const BRAND = Object.freeze({
  GOLD: '#d4af37',
  GOLD_DARK: '#aa801e',
  PRODUCTION_URL: 'https://balaji-auto-os.vercel.app',
});

/**
 * The 16 modules. These ids are ALSO the deep-link contract (#billing, #inventory …),
 * so renaming one breaks every bookmark a workshop has saved. Treat as append-only.
 * Validating an incoming hash against this list also stops a crafted URL from pushing
 * arbitrary values into component state.
 */
export const TAB_KEYS = Object.freeze([
  'overview', 'jobcards', 'customers', 'vehicles', 'billing',
  'inventory', 'suppliers', 'sales', 'services', 'stockin', 'stockout',
  'analytics', 'reports', 'alerts', 'reminders', 'settings',
]);
