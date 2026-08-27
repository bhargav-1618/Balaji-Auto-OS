// services/customerService.js
// Customer business rules decoupled from UI/state. Same discipline as
// jobCardService.js/inventoryService.js — ZERO React, ZERO Firestore, ZERO DOM.
// InventoryDashboard.js still owns all React state/setCustomers calls; these
// functions only compute the values it writes.

// ---------------------------------------------------------------------------
// H-5C — pure customer business logic extracted from InventoryDashboard.js.
// ---------------------------------------------------------------------------

/**
 * Next sequential customer code, "CUST-0001"-style, 4-digit zero-padded.
 * Pulled verbatim out of InventoryDashboard.js's onQuickCustomer handler —
 * same algorithm (count-based, not gap-aware) as before.
 */
export function nextCustomerCode(customers = []) {
  return `CUST-${String((customers || []).length + 1).padStart(4, '0')}`;
}

/**
 * The field defaults for a customer created via a "quick create" flow (the
 * inline customer prompt reachable from Billing/Vehicles/Job Cards). The
 * caller still generates `id` and `createdAt` itself (time-based, not pure).
 */
export function withCustomerDefaults(data = {}, customers = []) {
  return {
    code: nextCustomerCode(customers),
    name: data.name,
    phone: data.phone || '',
    email: data.email || '',
    gst: data.gst || '',
    address: data.address || '',
    type: 'Individual',
    status: 'Active',
    vehicles: [],
  };
}

/**
 * How many reminder-worthy items exist across all customers right now: one per
 * customer with outstanding balance, plus one per vehicle document (insurance/
 * RC/PUC) expiring within 30 days (including already-expired). Same rule the
 * sidebar badge count used inline. `now` is injectable so this stays
 * deterministic under test; defaults to the real clock in production.
 */
export function countCustomerReminders(customers = [], now = Date.now()) {
  let n = 0;
  const daysUntil = (x) => (x ? Math.round((new Date(x).getTime() - now) / 86400000) : null);
  (customers || []).forEach((c) => {
    if (Number(c.outstanding) > 0) n += 1;
    (c.vehicles || []).forEach((v) => {
      [v.insuranceExpiry, v.rcExpiry, v.pucExpiry].forEach((x) => {
        const k = daysUntil(x);
        if (k !== null && k <= 30) n += 1;
      });
    });
  });
  return n;
}
