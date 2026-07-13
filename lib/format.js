// lib/format.js
// Pure formatting / phone / date helpers extracted from InventoryDashboard.js as
// part of the incremental refactor. No React, no state — safe to unit-test.

export const safeLower = (val) => (val || '').toString().toLowerCase();

export function formatINR(n) {
  return `₹${(n || 0).toLocaleString('en-IN')}`;
}

// ---- Phone helpers ----
export const digitsOnly = (s) => (s || '').toString().replace(/\D/g, '');
export const tenDigits = (s) => digitsOnly(s).slice(0, 10);
// canonical phone key — last 10 digits (strips +91, spaces, hyphens)
export const normalizePhone = (str) => String(str ?? '').replace(/\D/g, '').slice(-10);
// extract the real Indian mobile from input that may carry +91 / 91 / leading 0.
export const toIndianPhone = (s) => {
  let d = digitsOnly(s);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2); // +91XXXXXXXXXX
  if (d.length === 11 && d.startsWith('0')) return d;        // landline 0XXXXXXXXXX
  return d.length > 10 ? d.slice(-10) : d;
};
// valid Indian phone — 10-digit mobile starting 6–9, or 11-digit landline starting 0.
export const isValidIndianPhone = (s) => {
  const d = toIndianPhone(s);
  if (d.length === 11) return d.startsWith('0');
  if (d.length === 10) return /^[6-9]/.test(d);
  return false;
};
// normalize a phone field AS the user types/pastes.
export const phoneInput = (val) => {
  let d = digitsOnly(val);
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2);
  if (d.startsWith('0')) return d.slice(0, 11);
  return d.slice(0, 10);
};
// wa.me needs a country code; assume +91 for 10-digit Indian mobiles
export const waNumber = (s) => {
  const d = normalizePhone(s);
  return d.length === 10 ? `91${d}` : digitsOnly(s);
};

// ---- Date helpers ----
// Convert ANY timestamp shape this app produces into a Date.
//
// ROOT CAUSE OF "invoice paid but Sales/Services/StockOut/Reports/Analytics/Dashboard
// all empty": this used to handle only Firestore Timestamps and Date objects, and
// returned null for everything else. But demo mode writes `createdAt` as an ISO
// STRING (`new Date().toISOString()`), and seed data uses epoch NUMBERS. Every
// consumer does `const d = tsToDate(x); if (!d) return;` — so those rows were
// silently DISCARDED from every list, KPI and chart. The records existed in the
// store the whole time; the date filter threw them away.
//
// Accepts: Firestore Timestamp | {seconds} | Date | ISO string | epoch ms | epoch s.
export const tsToDate = (ts) => {
  if (ts == null) return null;
  if (ts instanceof Date) return Number.isNaN(ts.getTime()) ? null : ts;
  if (typeof ts?.toDate === 'function') { const d = ts.toDate(); return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null; }
  if (typeof ts?.seconds === 'number') return new Date(ts.seconds * 1000);
  if (typeof ts?._seconds === 'number') return new Date(ts._seconds * 1000); // serialized Timestamp
  if (typeof ts === 'number') {
    // Heuristic: values below ~1e11 are seconds, above are milliseconds.
    const d = new Date(ts < 1e11 ? ts * 1000 : ts);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof ts === 'string') {
    const s = ts.trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) { const n = Number(s); return new Date(n < 1e11 ? n * 1000 : n); }
    const d = new Date(s); // ISO-8601 and most common formats
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};
export function isSameDay(d, ref) { return d && d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate(); }
export function trendPct(today, yest) {
  if (!yest) return today > 0 ? 100 : 0;
  return Math.round(((today - yest) / yest) * 100);
}

// LOCAL calendar date as YYYY-MM-DD. One source of truth for invoice dates.
//
// `new Date().toISOString().slice(0,10)` returns the **UTC** date. India runs at
// UTC+5:30, so a job billed at 2am IST on the 13th stamps as "2026-07-12" — the
// invoice lands on the wrong day, and `iv.date === today` then fails, leaving
// Today's Revenue / Today's Invoices showing 0 or yesterday's figures.
export const localDateStr = (d = new Date()) => {
  const dt = d instanceof Date ? d : (tsToDate(d) || new Date());
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Human-readable invoice date for PDFs/exports, e.g. "12-Jul-2026".
export const displayDate = (v) => {
  const d = tsToDate(v);
  if (!d) return '';
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d.getDate()).padStart(2, '0')}-${MON[d.getMonth()]}-${d.getFullYear()}`;
};

/**
 * Canonical numeric coercion for UI/display maths.
 * Was copy-pasted byte-for-byte into 5 component files. Verified identical before
 * consolidating, so this changes no behaviour.
 * NOTE: for LEDGER maths use toNum() from services/billingService — it permits
 * negatives (a refund is a negative delta), which this deliberately does too, but the
 * service version is the one the money path depends on.
 */
export const num = (n) => Number(n) || 0;
