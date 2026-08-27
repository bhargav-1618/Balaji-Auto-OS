// lib/vehicleStats.js
//
// The Vehicles dashboard KPIs. ONE definition, reusing the billing engine's own gate
// (`isRealized`) rather than re-deriving revenue by hand.
//
// ─────────────────────────────────────────────────────────────────────────────────
// WHAT WAS WRONG
//
// 1. THE ₹71.35 Cr BUG. `invOf` was:
//
//        invoices.filter((iv) => iv.vehicle.includes(v.regNo) || jcOf(v).length)
//                                                              └── never mentions `iv`
//
//    The second clause has no reference to the invoice being filtered. So for any
//    vehicle with at least one job card, the predicate was truthy for EVERY invoice in
//    the system, and `revenueOf(vehicle)` returned the WHOLE WORKSHOP'S revenue.
//    Summed across 350 vehicles that produced ₹71.35 Cr. The number was not merely
//    badly formatted; it was meaningless.
//
// 2. Revenue counted DRAFTS, ESTIMATES, CANCELLED and REFUNDED invoices, and summed
//    raw `qty * rate` — ignoring discount and GST, and duplicating logic the billing
//    engine already owns. An estimate that was never accepted counted as money earned.
//
// 3. IN SERVICE excluded only 'Delivered' and 'Ready' from 13 job-card statuses — so a
//    CANCELLED or CLOSED job card counted as a vehicle currently in the workshop.
//
// 4. AVG VISITS divided by ALL vehicles (spec: active only) and counted ALL job cards
//    including open and cancelled ones (spec: completed visits).
//
// 5. REPEAT VEHICLES counted vehicles with >= 2 job cards of ANY status, including
//    cancelled ones (spec: more than one COMPLETED visit).
//
// 6. WARRANTY counted every vehicle whose warranty had NOT expired (266 of 350) — that
//    is a "has warranty" count, not a "warranty expiring" one, and the `extWarranty`
//    flag was honoured regardless of its expiry date.
//
// 7. TODAY'S DELIVERIES compared UTC dates. India is UTC+5:30, so anything delivered
//    before 05:30 IST was attributed to the previous day.
//
// 8. Everything was O(n·m): jcOf()/invOf() rescanned the full job-card and invoice
//    arrays for every vehicle, inside filters and sorters, on every render.
//    350 vehicles × 2,529 records, repeatedly. Now indexed once per data change.
// ─────────────────────────────────────────────────────────────────────────────────

import { isRealized, invoiceTotals } from '../services/billingService';

/** A job card that is still open — the vehicle is physically in the workshop. */
export const OPEN_JOB_STATUSES = [
  'Received', 'Inspection', 'Estimate Ready', 'Estimate Approved',
  'Waiting Parts', 'Repair Started', 'Repair Paused', 'Quality Check', 'Wash', 'Ready',
];

/** A job card that represents a COMPLETED visit. Cancelled is not a visit. */
export const COMPLETED_JOB_STATUSES = ['Delivered', 'Closed'];

export const DEFAULT_REMINDER_DAYS = 30;

const upper = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');

/** Local (not UTC) yyyy-mm-dd. India is UTC+5:30 — a UTC compare loses 5.5 hours. */
export function localDay(d = new Date()) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** Whole days until `iso`; null when there is no date. Negative = already expired. */
export function daysUntil(iso) {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  then.setHours(0, 0, 0, 0);
  return Math.round((then - today) / 86400000);
}

/** Expiring = has a date, not already long gone, and falls inside the reminder window. */
export function isExpiring(iso, windowDays = DEFAULT_REMINDER_DAYS) {
  const d = daysUntil(iso);
  return d !== null && d <= windowDays;
}

/**
 * Index job cards and invoices by registration number ONCE.
 * Build this in a useMemo keyed on [jobCards, invoices] — never inside a filter.
 */
export function buildVehicleIndex(jobCards = [], invoices = []) {
  const jobsByReg = new Map();
  jobCards.forEach((j) => {
    const k = upper(j.regNo);
    if (!k) return;
    if (!jobsByReg.has(k)) jobsByReg.set(k, []);
    jobsByReg.get(k).push(j);
  });

  const invByReg = new Map();
  invoices.forEach((iv) => {
    // Link on regNo — the identifier. `iv.vehicle` holds a MODEL name
    // ("Grand i10 Nios"), so the old substring match against a reg number was
    // never going to hit anyway; the `|| jcOf(v).length` fallback was masking that.
    const k = upper(iv.regNo);
    if (!k) return;
    if (!invByReg.has(k)) invByReg.set(k, []);
    invByReg.get(k).push(iv);
  });

  return { jobsByReg, invByReg };
}

export const jobsOf = (idx, v) => idx.jobsByReg.get(upper(v.regNo)) || [];
export const invoicesOf = (idx, v) => idx.invByReg.get(upper(v.regNo)) || [];

/** Completed visits for a vehicle. Open and cancelled job cards are NOT visits. */
export const completedVisitsOf = (idx, v) =>
  jobsOf(idx, v).filter((j) => COMPLETED_JOB_STATUSES.includes(j.status)).length;

/** Is the vehicle physically in the workshop right now? */
export const isInService = (idx, v) =>
  jobsOf(idx, v).some((j) => OPEN_JOB_STATUSES.includes(j.status));

/**
 * Revenue actually earned on a vehicle.
 * Gated by the billing engine's own `isRealized` — the SAME gate that decides whether
 * an invoice may move stock or write to the ledger. So this figure agrees with Billing,
 * Sales, Services, Reports and Analytics by construction, rather than by coincidence.
 * Drafts, estimates, cancelled and refunded invoices contribute nothing.
 */
export const revenueOf = (idx, v) =>
  invoicesOf(idx, v)
    .filter(isRealized)
    .reduce((s, iv) => s + invoiceTotals(iv).grand, 0);

/** A vehicle counts as active unless it is archived or explicitly not Active. */
export const isActive = (v) => !v.archived && (v.status || 'Active') === 'Active';

/**
 * Every KPI on the Vehicles dashboard, from one pass over the vehicle list.
 * `rows` must be the FULL vehicle list, not the filtered one.
 */
export function computeVehicleStats(rows, idx, opts = {}) {
  const windowDays = Number(opts.reminderDays) || DEFAULT_REMINDER_DAYS;
  const today = localDay();

  let total = 0;
  let active = 0;
  let inService = 0;
  let insurance = 0;
  let puc = 0;
  let warranty = 0;
  let fleet = 0;
  let repeat = 0;
  let revenue = 0;
  let completedVisits = 0;

  rows.forEach((v) => {
    total += 1;
    const act = isActive(v);
    if (act) active += 1;
    if (isInService(idx, v)) inService += 1;
    if (isExpiring(v.insuranceExpiry, windowDays)) insurance += 1;
    if (isExpiring(v.pucExpiry, windowDays)) puc += 1;
    // WARRANTY EXPIRING — by expiry DATE, never by manufacture year, and the
    // extWarranty flag alone is not proof of cover.
    if (isExpiring(v.warrantyExpiry, windowDays)) warranty += 1;
    // Only vehicles EXPLICITLY marked fleet. 'Taxi'/'Government' are ownership types,
    // not fleets, and lumping them in inflated the figure.
    if (v.ownershipType === 'Fleet' || v.isFleet === true) fleet += 1;

    const visits = completedVisitsOf(idx, v);
    completedVisits += visits;
    if (visits > 1) repeat += 1;          // MORE THAN ONE completed visit
    revenue += revenueOf(idx, v);
  });

  // Deliveries: distinct VEHICLES delivered today (two job cards on one vehicle is
  // still one vehicle), compared in LOCAL time.
  const deliveredToday = new Set();
  idx.jobsByReg.forEach((jobs, reg) => {
    if (jobs.some((j) => COMPLETED_JOB_STATUSES.includes(j.status)
      && localDay(j.deliveredAt || j.savedAt || 0) === today)) deliveredToday.add(reg);
  });

  return {
    total,
    active,
    inService,
    deliveries: deliveredToday.size,
    insurance,
    puc,
    warranty,
    fleet,
    // Completed visits ÷ ACTIVE vehicles (spec), not ÷ all vehicles.
    avgVisits: active ? (completedVisits / active).toFixed(1) : '0',
    revenue,
    repeat,
  };
}
