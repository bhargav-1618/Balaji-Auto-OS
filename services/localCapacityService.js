/**
 * services/localCapacityService.js
 *
 * LOCAL (non-Firestore) RECORD-CAPACITY MANAGEMENT — the same 5,000-active-record
 * policy as services/capacityService.js, applied to data that lives entirely in the
 * browser (localStorage), not in a Firestore collection.
 *
 * WHY THIS IS A SEPARATE FILE FROM capacityService.js, NOT A NEW CAPACITY_MODULES ENTRY:
 * capacityService.js's whole engine assumes a Firestore collection — an async aggregate
 * count(), a server-side orderBy(dateField) cursor scan, batched commitBatch() deletes.
 * Alerts and Reminders were investigated (not assumed) before this rollout and neither
 * has a growing Firestore collection behind it:
 *   - Alerts are computed fresh on every render from live inventory/customer/invoice/
 *     job-card state; the only thing actually PERSISTED is which alert ids the user has
 *     read/archived (two small localStorage id sets).
 *   - Reminders: the "auto" ones are computed live and never persisted at all; only
 *     user-created "custom" reminders (plus their done/snoozed flags) persist, also to
 *     localStorage.
 * Forcing either into capacityService's Firestore-shaped engine would mean either
 * inventing a fake document count that rarely if ever reaches 5,000 (misleading), or
 * migrating both modules onto Firestore collections just to reuse one code path (a much
 * bigger, riskier change the brief did not ask for and which "preserve existing... don't
 * redesign unnecessarily" rules out). This file is the SAME policy (5,000 / 4,500 from
 * constants/capacity.js — not reinvented), the SAME shape of preview (oldest-first,
 * eligible vs protected, real date range), applied honestly to what is actually stored.
 *
 * WHAT COUNTS AS A "RECORD" HERE, PER MODULE (see each call site for the full reasoning):
 *   - Alerts: entries in the read/archived id-tracking sets (components/InventoryDashboard.js).
 *   - Reminders: user-created custom reminders (components/reminders/RemindersModule.jsx).
 * Both are genuinely unbounded — nothing today ever removes an entry — which is exactly
 * the class of problem this policy exists to solve.
 */
import { CAPACITY_LIMIT, CAPACITY_WARNING_THRESHOLD, CLEANUP_BATCH_SIZE } from '../constants/capacity';

/** Same shape as capacityService's getCapacityStatus, computed synchronously since the
 *  data is already in memory (no Firestore round-trip to make this async for). */
export function getLocalCapacityStatus(count) {
  return {
    count,
    limit: CAPACITY_LIMIT,
    warningThreshold: CAPACITY_WARNING_THRESHOLD,
    remaining: Math.max(0, CAPACITY_LIMIT - count),
    atWarning: count >= CAPACITY_WARNING_THRESHOLD && count < CAPACITY_LIMIT,
    atLimit: count >= CAPACITY_LIMIT,
  };
}

const fmtDate = (d) => (d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

/**
 * `entries`: [{ id, at: Date|null, eligible: boolean }] — the caller has ALREADY applied
 * its own module-specific business rule to produce `eligible` (e.g. "this alert id no
 * longer appears in the live alert list" / "this reminder is marked done"). This function
 * only does the part that's genuinely shared: batch the oldest CLEANUP_BATCH_SIZE eligible
 * entries and summarize the affected date range, matching capacityService's own preview
 * shape so the two feel like one system to a user even though the engines differ.
 */
export function getLocalCleanupPreview(entries, { batchSize = CLEANUP_BATCH_SIZE } = {}) {
  const eligibleAll = entries.filter((e) => e.eligible);
  const protectedCount = entries.length - eligibleAll.length;
  const sorted = [...eligibleAll].sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
  const eligible = sorted.slice(0, batchSize);
  const dates = eligible.map((e) => e.at).filter(Boolean).sort((a, b) => a - b);
  return {
    eligible,
    eligibleCount: eligible.length,
    eligibleTotal: eligibleAll.length,
    protectedCount,
    dateFrom: dates[0] || null,
    dateTo: dates[dates.length - 1] || null,
    dateRangeLabel: dates.length ? `${fmtDate(dates[0])} → ${fmtDate(dates[dates.length - 1])}` : '—',
  };
}
