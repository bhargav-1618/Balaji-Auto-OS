// lib/verification.js — public-safe verification records for the customer /verify page.
// (Security audit SEC-04.)
//
// THE PROBLEM THIS SOLVES: the old QR link carried the invoice details IN the URL
// (/verify?no=INV-1&c=Name&t=5000&s=Paid) and the page simply printed them back, so anyone could
// type a link that showed a "PAID" invoice for any customer on the workshop's own domain.
// There is no server to sign or check a link, so the trusted source has to be Firestore:
//
//   • when a customer-copy PDF is generated, signed-in STAFF write a tiny record to
//     `verifications/<id>` where <id> is 128 random bits (32 hex chars);
//   • the QR carries only that id:  /verify?id=<id>;
//   • /verify fetches that one record by its exact id. Nobody can list the collection, so a
//     record can only be reached by someone who holds the link/QR.
//
// The record deliberately holds ONLY: kind, internal ref, document number, date, amount, status.
// No customer name, vehicle, phone, line items, costs or profit.
//
// This file is pure logic: every Firestore function is INJECTED (`fb`), so it is unit-tested with
// a fake and carries no Firebase import. lib/verificationClient.js binds it to the real SDK.

export const VERIFY_ID_RE = /^[a-f0-9]{32}$/;
export const VERIFY_KINDS = ['invoice', 'jobcard'];
export const VERIFICATIONS = 'verifications';

const str = (v, max) => {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  if (!s || s === 'undefined' || s === 'null' || s === 'NaN') return '';
  return s.slice(0, max);
};

// A date as a short string: ISO date for Timestamps / Dates / epoch millis, trimmed text otherwise.
const dateStr = (v) => {
  if (v === null || v === undefined || v === '') return '';
  try {
    if (typeof v === 'string') return str(v, 40);
    const ms = typeof v === 'number' ? v : (typeof v.toMillis === 'function' ? v.toMillis() : (v instanceof Date ? v.getTime() : NaN));
    return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : '';
  } catch { return ''; }
};

/** 128 random bits as 32 lowercase hex chars. Uses the platform CSPRNG; never Math.random. */
export function newVerifyId(cryptoLike) {
  const c = cryptoLike || (typeof globalThis !== 'undefined' ? globalThis.crypto : undefined);
  if (!c || typeof c.getRandomValues !== 'function') throw new Error('No secure random source available');
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The exact, minimal public record for a document — or null if it should not get one
 * (no document number, a draft, an unknown kind, or no internal ref to find it again by).
 * Field limits mirror firestore.rules (verificationShapeOk) — keep the two in step.
 */
export function buildVerificationRecord({ kind, ref, docNo, date, total, status } = {}) {
  if (!VERIFY_KINDS.includes(kind)) return null;
  const r = str(ref, 80);
  const no = str(docNo, 40);
  if (!r || !no) return null;
  if (/^DRF/i.test(no)) return null; // drafts are throw-away handles, never issued to a customer
  const rec = { kind, ref: r, docNo: no };
  const d = dateStr(date);
  if (d) rec.date = d;
  const n = Number(total);
  if (total !== null && total !== undefined && total !== '' && Number.isFinite(n) && n >= 0 && n < 1e12) {
    rec.total = Math.round(n * 100) / 100;
  }
  const s = str(status, 40);
  if (s) rec.status = s;
  return rec;
}

async function findExisting(fb, rec) {
  const q = fb.query(
    fb.collection(fb.db, VERIFICATIONS),
    fb.where('ref', '==', rec.ref),
    fb.where('kind', '==', rec.kind),
    fb.limit(1),
  );
  const snap = await fb.getDocs(q);
  const first = snap && snap.docs && snap.docs[0];
  return first ? first.id : null;
}

/**
 * Create (or refresh) the verification record for a document and return its id, or null if the
 * document is not eligible. Reuses the existing id for the same document so a QR that was
 * already printed keeps working and picks up the latest status/amount.
 * Throws on a Firestore error — callers decide how to degrade (the PDF code falls back to the
 * legacy link; see verificationClient).
 */
export async function issueVerification(fb, input) {
  const rec = buildVerificationRecord(input);
  if (!rec) return null;
  const id = (await findExisting(fb, rec)) || newVerifyId(fb.crypto);
  await fb.setDoc(fb.doc(fb.db, VERIFICATIONS, id), { ...rec, updatedAt: fb.serverTimestamp() });
  return id;
}

/**
 * Refresh an EXISTING record (status/amount changed after the QR was issued). Never creates one:
 * a document that no customer has a QR for needs no public record. Returns true if updated.
 */
export async function syncVerification(fb, input) {
  const rec = buildVerificationRecord(input);
  if (!rec) return false;
  const id = await findExisting(fb, rec);
  if (!id) return false;
  await fb.setDoc(fb.doc(fb.db, VERIFICATIONS, id), { ...rec, updatedAt: fb.serverTimestamp() });
  return true;
}

/**
 * What /verify shows for a id=<id> link. `fb` needs only { db, doc, getDoc }.
 * Returns { state: 'invalid' | 'notfound' | 'ok', record? } and THROWS on a transport/permission
 * error so the page can say "couldn't check" instead of wrongly claiming the document is fake.
 */
export async function lookupVerification(fb, id) {
  if (typeof id !== 'string' || !VERIFY_ID_RE.test(id)) return { state: 'invalid' };
  const snap = await fb.getDoc(fb.doc(fb.db, VERIFICATIONS, id));
  if (!snap.exists()) return { state: 'notfound' };
  const d = snap.data() || {};
  // Re-validate on the way out: show only the whitelisted fields, whatever is stored.
  const record = {
    kind: VERIFY_KINDS.includes(d.kind) ? d.kind : 'invoice',
    docNo: str(d.docNo, 40),
    date: str(d.date, 40),
    status: str(d.status, 40),
    total: Number.isFinite(Number(d.total)) && d.total !== null && d.total !== undefined ? Number(d.total) : null,
    updatedAtMs: d.updatedAt && typeof d.updatedAt.toMillis === 'function' ? d.updatedAt.toMillis() : null,
  };
  if (!record.docNo) return { state: 'notfound' };
  return { state: 'ok', record };
}
