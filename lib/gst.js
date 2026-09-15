// lib/gst.js
// Canonical GSTIN validator — the ONE rule every GST field in the app (Customers,
// Suppliers, Billing, Business Profile) validates against. A GSTIN is 15 characters:
// 2-digit state code + 10-character PAN (5 letters, 4 digits, 1 letter) + 1 entity
// code + a literal 'Z' + 1 alphanumeric checksum. Do not add a second, weaker
// (length-only) regex anywhere else — import this instead.
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export function isValidGstin(value) {
  const v = (value || '').trim().toUpperCase();
  return GSTIN_REGEX.test(v);
}

export const GSTIN_ERROR = 'GSTIN must be a valid 15-character GSTIN (e.g. 27ABCDE1234F1Z5).';
