// lib/verificationClient.js — binds lib/verification.js to the real Firestore SDK and makes it
// SAFE TO CALL FROM PDF / SAVE CODE: it never throws, never hangs, and does nothing in demo mode.
//
// Every failure (offline, rules not yet published, signed out, timeout) resolves to null/false.
// The callers then fall back to the legacy link — which /verify now labels "not verified" — so a
// verification problem can never break generating a PDF or saving an invoice.
import { collection, getDocs, query, where, limit, setDoc, getDoc } from 'firebase/firestore';
import { db, doc, serverTimestamp } from './firebase';
import { issueVerification, syncVerification, lookupVerification } from './verification';

// Bounded: an offline setDoc/getDocs would otherwise wait for the network indefinitely.
const TIMEOUT_MS = 4000;
const withTimeout = (p) => Promise.race([
  p,
  new Promise((_, reject) => setTimeout(() => reject(new Error('verification timeout')), TIMEOUT_MS)),
]);

const fb = () => ({ db, collection, getDocs, query, where, limit, setDoc, getDoc, doc, serverTimestamp, crypto: globalThis.crypto });

/** The verification id for this document (creating/refreshing its public record), or null. */
export async function issueVerificationId(input, { demoMode = false } = {}) {
  if (demoMode) return null; // demo data must never be written to the real database
  try { return await withTimeout(issueVerification(fb(), input)); } catch { return null; }
}

/** Best-effort refresh of an already-issued record after the document changed. Never throws. */
export async function syncVerificationRecord(input, { demoMode = false } = {}) {
  if (demoMode) return false;
  try { return await withTimeout(syncVerification(fb(), input)); } catch { return false; }
}

/** For the public /verify page. Throws on a lookup error (the page shows "couldn't check"). */
export function lookupVerificationRecord(id) {
  return withTimeout(lookupVerification(fb(), id));
}
