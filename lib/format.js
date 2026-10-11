// lib/format.js
// Pure formatting / phone / date helpers extracted from InventoryDashboard.js as
// part of the incremental refactor. No React, no state — safe to unit-test.

export const safeLower = (val) => (val || '').toString().toLowerCase();

// Plural of an English noun PHRASE for count-sensitive UI copy ("1 job card" / "2 job
// cards", "1 ledger entry" / "2 ledger entries"). Naive `label + 's'` is wrong for any
// label ending in a consonant + "y" (e.g. "ledger entry" -> "ledger entrys") — this
// covers that one real case in this app's record labels without pulling in a full i18n
// pluralization library for what is, so far, exactly one irregular pattern.
export function pluralize(label, count) {
  if (count === 1) return label;
  if (/[^aeiou]y$/i.test(label)) return `${label.slice(0, -1)}ies`;
  return `${label}s`;
}

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
// STRICT Indian MOBILE — the rule every "mobile number" field in this app expects.
// After stripping a single optional +91 / 91 country code (the +91 UI prefix and
// "91 98765…" paste both normalize here), the number must be EXACTLY 10 digits and
// start 6–9. Rejects: shorter/longer values, a leading 0/1/2/3/4/5, landlines, and
// any non-numeric input. This is the mobile-only counterpart to isValidIndianPhone
// (which also allows 11-digit landlines) — use THIS wherever the label says "mobile".
export const isIndianMobile = (s) => parseIndianMobile(s).ok; // QA VAL-001/VAL-003 — see parseIndianMobile below
export const MOBILE_ERROR = 'Enter a valid 10-digit Indian mobile number (starts with 6–9)';
// normalize a phone field AS the user types/pastes.
export const phoneInput = (val) => {
  let d = digitsOnly(val);
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2);
  if (d.startsWith('0')) return d.slice(0, 11);
  return d.slice(0, 10);
};
// normalize a MOBILE field as the user types/pastes: drop a +91/91 country code,
// cap at 10 digits. No landline / leading-0 branch — use phoneInput for that.
export const mobileInput = (val) => sanitizeMobileInput(val); // QA DATA-001 — see sanitizeMobileInput below
// wa.me needs a country code; assume +91 for 10-digit Indian mobiles
export const waNumber = (s) => {
  const d = normalizePhone(s);
  return d.length === 10 ? `91${d}` : digitsOnly(s);
};

// ---- Email helper ----
// The app accepts ANY real customer/business email — there is deliberately NO
// domain whitelist. It rejects two things:
//   1. malformed syntax — no @, empty local/domain, whitespace, `@@`, a leading/
//      trailing/doubled dot in the local part, a domain with no dot or a bad TLD.
//   2. obvious placeholders — the RFC 2606 / RFC 6761 reserved names that can
//      never be a deliverable address: the `example.com/.net/.org` documentation
//      domains, and the `.test` / `.invalid` / `.localhost` / `.example` TLDs.
//      (`test@example.io` etc. stay valid — only the reserved names are blocked.)
export const EMAIL_ERROR = 'Enter a real email address (placeholders like example.com aren’t accepted)';
export const isValidEmail = (s) => {
  const e = String(s ?? '').trim();
  if (!e || /\s/.test(e)) return false;
  const m = /^([^\s@]+)@([^\s@]+)$/.exec(e);        // exactly one @, non-empty both sides
  if (!m) return false;
  const [, local, domain] = m;
  if (/^\.|\.$|\.\./.test(local)) return false;      // no leading/trailing/doubled dot in local part
  // domain: dot-separated labels of [a-z0-9-] (no leading/trailing hyphen), 2+ labels, alpha TLD ≥2
  if (!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) return false;
  const labels = domain.toLowerCase().split('.');
  const tld = labels[labels.length - 1];
  const sld = labels[labels.length - 2];
  if (['test', 'invalid', 'localhost', 'example'].includes(tld)) return false;
  if (sld === 'example' && ['com', 'net', 'org'].includes(tld)) return false;
  return true;
};

// ---- Indian mobile numbers: the ONE strict implementation ----
//
// QA DATA-001 / VAL-001 / VAL-003. Customers, Vehicles, Reminders, Billing and Job Cards
// each carried their own copy of `value.replace(/\D/g,'').slice(0,10)`, which has two
// real faults:
//   1. It cuts BEFORE it understands the number. Pasting "+919123456781" gave "9191234567"
//      — a different, valid-looking mobile belonging to somebody else — and the form saved
//      it with no warning. An 11-digit entry was cut the same way.
//   2. It only checks length, so "0123456789", "5123456789" and "9999999999" all passed.
//
// The rules below are deliberately narrow. A prefix is removed ONLY when the digit count
// proves it is a prefix; anything we cannot positively identify is kept visible and
// rejected, never "fixed" by guessing.
//
//   +91XXXXXXXXXX      explicit +91 (any spacing/hyphens)  -> strip 91
//   91XXXXXXXXXX       exactly 12 digits starting 91       -> strip 91
//   0XXXXXXXXXX        exactly 11 digits starting 0        -> strip 0 (trunk prefix)
//   XXXXXXXXXX         exactly 10 digits                   -> as is
//   anything else      rejected: too short / too long / other country code
//
// A 10-digit result must then start with 6, 7, 8 or 9 (Indian mobile numbering plan) and
// must not be one repeated digit (a placeholder / typing slip, e.g. 9999999999).
//
// Landlines are intentionally NOT accepted here: every caller labels these fields
// "mobile". (Suppliers keep their older, landline-tolerant isValidIndianPhone.)
export const MOBILE_ERRORS = {
  empty: 'Enter a 10-digit mobile number',
  chars: 'Mobile number can contain only digits (spaces, hyphens and a leading + are allowed)',
  tooShort: 'Enter a 10-digit mobile number',
  tooLong: 'Too many digits — enter a 10-digit mobile number (a +91, 91 or 0 prefix is removed automatically)',
  country: 'Only Indian (+91) mobile numbers are supported',
  badStart: 'Indian mobile numbers start with 6, 7, 8 or 9',
  repeated: 'Enter a real mobile number — every digit is the same',
};

// Longest digit string kept in a field. Purely a runaway-paste cap (E.164 max is 15): it is
// far above 10 on purpose, so an over-long entry stays visible and gets rejected instead
// of being silently cut down to a different number.
const MOBILE_FIELD_MAX_DIGITS = 15;

/**
 * Strictly parse a user-entered Indian mobile number.
 * @returns {{ ok: boolean, value?: string, code?: string, error?: string }}
 *   `value` is the canonical 10-digit string when ok. Never throws.
 */
export function parseIndianMobile(input) {
  const raw = String(input ?? '').trim();
  const fail = (code) => ({ ok: false, code, error: MOBILE_ERRORS[code] });
  if (!raw) return fail('empty');
  // Digits, spaces, hyphens, dots and brackets are formatting. A '+' is only meaningful as
  // the very first character. Anything else (letters, symbols) is not a phone number.
  if (/[^\d\s\-.()+]/.test(raw) || raw.slice(1).includes('+')) return fail('chars');
  const hasPlus = raw.startsWith('+');
  const digits = digitsOnly(raw);
  if (!digits) return fail('tooShort');

  let n = digits;
  if (hasPlus) {
    if (!digits.startsWith('91')) return fail('country');
    n = digits.slice(2);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    n = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    n = digits.slice(1);
  } else if (digits.length === 12) {
    return fail('country'); // 2-digit country code + 10 digits, but not +91
  }
  if (n.length < 10) return fail('tooShort');
  if (n.length > 10) return fail('tooLong');
  if (!/^[6-9]/.test(n)) return fail('badStart');
  if (/^(\d)\1{9}$/.test(n)) return fail('repeated');
  return { ok: true, value: n };
}

/**
 * Validation message for a mobile field, or null when valid.
 * An empty value is valid unless `required` (callers own "is this field mandatory").
 */
export function validateIndianMobile(input, { required = false } = {}) {
  if (!String(input ?? '').trim()) return required ? MOBILE_ERRORS.empty : null;
  return parseIndianMobile(input).error || null;
}

export const isValidIndianMobile = (input) => parseIndianMobile(input).ok;

/**
 * The value to PERSIST for a mobile field: the canonical 10 digits when the input is a
 * valid mobile, otherwise the input exactly as given (an invalid number is never
 * "repaired" on its way to storage — validation is what stops it, not this).
 */
export const toCanonicalMobile = (input) => {
  const r = parseIndianMobile(input);
  return r.ok ? r.value : String(input ?? '').trim();
};

/**
 * As-you-type / on-paste normaliser for a mobile <input>. Returns the digits to show.
 * Removes a +91 / 91 / 0 prefix only when the digit count proves it is one (see rules
 * above); never truncates to 10, so a wrong number stays visible for validateIndianMobile
 * to reject. Letters and symbols are dropped, as the fields always did.
 */
export function sanitizeMobileInput(raw) {
  const s = String(raw ?? '');
  const hasPlus = /^\s*\+/.test(s);
  let d = digitsOnly(s);
  if (hasPlus ? d.startsWith('91') : (d.length === 12 && d.startsWith('91'))) d = d.slice(2);
  else if (!hasPlus && d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d.slice(0, MOBILE_FIELD_MAX_DIGITS);
}

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
 * PHASE 21 (PH21-01): a non-finite input (a stored NaN/Infinity, or the Infinity a
 * pasted 309-digit string overflows to) now coerces to 0 instead of passing straight
 * through — matching toNum() — so a report total, dashboard tile or PDF line reads 0,
 * not "₹∞" / "Rs. NaN". `Number(n) || 0` already mapped NaN→0; this also catches ±Infinity.
 */
export const num = (n) => { const v = Number(n); return Number.isFinite(v) ? v : 0; };

/**
 * Coerce a value that is SUPPOSED to be an array to a real array.
 *
 * PHASE 21 DEEP VALIDATION (PH21-D1): the `x || []` idiom used to guard "the field
 * isn't there" all over the calculators does NOT catch a field that is present but
 * the WRONG TYPE — `'oops' || []` is `'oops'`, and the next `.forEach`/`.map` throws,
 * which (there is one app-level ErrorBoundary) takes down the whole app until the bad
 * document is removed. A Firestore document can hold any shape an authenticated client
 * (or a half-finished write / bad migration) puts there — `invoice.lines`,
 * `customer.vehicles`, `jobCard.parts` are only arrays by convention, not by rule.
 *
 * This is the same normalise-at-the-edge guard `components/vehicles/VehiclesModule.jsx`
 * already applied locally (`normalizeVehicle`), lifted to the shared layer so the
 * calculators every screen routes through can't be crashed by one malformed record.
 */
export const asArray = (v) => (Array.isArray(v) ? v : []);
