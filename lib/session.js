/**
 * Session hygiene for a SHARED workshop terminal.
 *
 * The counter PC in an Indian workshop is used by the owner, the receptionist and the
 * service advisor — often within the same hour. Firebase's signOut() only drops the
 * auth token; this app is offline-first, so customer lists, invoices and job cards
 * remain in localStorage and would be rendered from cache for the NEXT person before
 * auth resolves. That is a data leak between staff, and a privacy problem with
 * customers' names, phone numbers and vehicle details.
 */

import { STORAGE } from '../constants';

/** Every key that holds BUSINESS data (as opposed to a harmless UI preference). */
const BUSINESS_KEYS = [
  STORAGE.PROD_CUSTOMERS, STORAGE.PROD_INVOICES, STORAGE.PROD_JOB_CARDS,
  STORAGE.DEMO_CUSTOMERS, STORAGE.DEMO_JOB_CARDS, STORAGE.DEMO_INVOICES,
  STORAGE.DEMO_INVENTORY, STORAGE.DEMO_SUPPLIERS, STORAGE.DEMO_SALES,
  STORAGE.DEMO_RESTOCKS, STORAGE.DEMO_ADJUSTMENTS, STORAGE.DEMO_PURCHASE_ORDERS,
  STORAGE.DEMO_AUDIT, STORAGE.DEMO_GARAGE_SEED,
  STORAGE.DRAFT_INVOICE, STORAGE.DRAFT_JOB_CARD, STORAGE.DRAFT_PART, STORAGE.DRAFT_SUPPLIER,
];

/**
 * Wipe cached business records. Deliberately KEEPS preferences (theme, sidebar state,
 * nav groups) — those are not customer data and resetting them every logout is just
 * annoying on a shared machine.
 */
export function clearBusinessCaches() {
  if (typeof window === 'undefined') return;
  BUSINESS_KEYS.forEach((k) => {
    // Not a silent catch: if we cannot clear a cache we must know, because the
    // consequence is one user seeing another user's customers.
    try { localStorage.removeItem(k); } catch (e) { console.error(`[session] could not clear ${k}`, e); }
    try { sessionStorage.removeItem(k); } catch (e) { console.error(`[session] could not clear ${k}`, e); }
  });
}

/**
 * Idle timeout. A workshop terminal left unattended on the shop floor should not stay
 * authenticated indefinitely — anyone walking past can issue invoices or read customer
 * data. Firebase's default persistence never expires client-side, so we enforce it.
 */
export const IDLE_LIMIT_MS = 8 * 60 * 60 * 1000;   // one working day

export function startIdleWatch(onExpire, limitMs = IDLE_LIMIT_MS) {
  if (typeof window === 'undefined') return () => {};
  let last = Date.now();
  const bump = () => { last = Date.now(); };
  const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
  events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
  const timer = setInterval(() => {
    if (Date.now() - last > limitMs) onExpire();
  }, 60 * 1000);
  return () => {
    events.forEach((e) => window.removeEventListener(e, bump));
    clearInterval(timer);
  };
}
