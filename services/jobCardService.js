// services/jobCardService.js
// Job Card business rules decoupled from UI/state. Same pattern as
// billingService.js's nextDocNumber and purchaseOrderService.js's nextPONumber —
// ZERO React, ZERO Firestore, ZERO DOM. One definition of "what's the next job
// card number", callable from Node in milliseconds.

/**
 * Next job-card number, scanning the existing cards for the highest numeric
 * suffix among jobNo values that are EXACTLY `prefix` + digits (case
 * insensitive, nothing else) and incrementing by one. 2-digit, zero-padded.
 *
 * `prefix` defaults to "SBBMC" (this app's original hardcoded value) but is
 * driven live by Settings → Job Cards → Job Card Prefix (`biz.jcPrefix`) —
 * see the `readJcPrefix()` callers in JobCardModule.jsx and
 * InventoryDashboard.js. Prior to this fix the prefix was hardcoded here,
 * so changing the Settings field had no effect on Auto Generate.
 *
 * The match is intentionally strict (`^prefix\d+$`, not just "starts with
 * prefix"). A jobNo that merely starts with the prefix but contains other
 * digits elsewhere — e.g. a Manual Entry card saved as "SBBMC-2026-045" —
 * must NOT feed the max-scan: stripping all non-digits from a loose match
 * would glue "2026" and "045" into 2026045, and every future Auto Generate
 * would jump to an absurd number from then on. A non-standard manual number
 * is simply skipped for sequencing purposes rather than trusted to
 * extrapolate from.
 *
 * This is the single source of truth for "what's the next job card number" —
 * every caller (JobCardModule's own form, and creating a card from a
 * Customer record) must go through this function, not a local re-implementation,
 * so a future fix here only has to happen once.
 */
export function nextJobCardNumber(jobCards = [], prefix = 'SBBMC') {
  const p = (String(prefix || '').trim() || 'SBBMC').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${p}(\\d+)$`, 'i');
  const max = (jobCards || []).reduce((m, x) => {
    const match = re.exec(String(x.jobNo || '').trim());
    if (!match) return m;
    const n = Number(match[1]);
    return n > m ? n : m;
  }, 0);
  return `${String(prefix || '').trim() || 'SBBMC'}${String(max + 1).padStart(2, '0')}`;
}
