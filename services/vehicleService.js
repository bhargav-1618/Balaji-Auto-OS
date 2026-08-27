// services/vehicleService.js
// Vehicle business rules decoupled from UI/state. Same discipline as
// customerService.js/jobCardService.js — ZERO React, ZERO Firestore, ZERO DOM.
// Vehicles are stored nested on the customer (c.vehicles[]); InventoryDashboard.js
// still owns the setCustomers() writes, these functions only compute the values.

// ---------------------------------------------------------------------------
// H-5C — pure vehicle business logic extracted from InventoryDashboard.js.
// ---------------------------------------------------------------------------

/** A customer's primary (first-registered) vehicle, or {} if they have none. */
export function primaryVehicle(customer = {}) {
  return (customer.vehicles || [])[0] || {};
}

/**
 * The field defaults for a vehicle created via a "quick add" flow (Job Card
 * register-on-the-fly, Billing quick-vehicle). The caller still generates
 * `id` itself (time-based, not pure). A vehicle's own `status`, if present,
 * wins over the 'Active' default — same as the original inline spread order.
 */
export function withVehicleDefaults(veh = {}) {
  return { status: 'Active', ...veh };
}

/**
 * Find the index of the vehicle a paid invoice belongs to: exact registration
 * match when the invoice recorded one, otherwise a fallback match on the
 * "brand model" label. Pulled verbatim out of touchVehicleHistory's findIndex.
 */
export function findVehicleIndex(vehicles = [], { reg = '', label = '' } = {}) {
  return (vehicles || []).findIndex((v) => {
    const vr = String(v.regNo || v.reg || '').trim().toUpperCase();
    return (reg && vr === reg) || (!reg && `${v.brand || ''} ${v.model || ''}`.trim() === label);
  });
}

/**
 * The updated vehicle document after a service visit: prepends a bounded
 * service-history entry and rolls up lastServiceDate/lastInvoiceNo/totalSpend/
 * serviceCount. Pulled verbatim out of touchVehicleHistory. `maxHistory` and
 * `now` are injected (not read from LIMITS/Date.now() directly) so the
 * function stays deterministic under test.
 */
export function buildVehicleHistoryUpdate(vehicle = {}, { invoiceNo = '', date, amount = 0, odometer = null, maxHistory = 200, now = Date.now() } = {}) {
  const history = [
    { at: now, invoiceNo, amount, odometer },
    ...(vehicle.serviceHistory || []),
  ].slice(0, maxHistory);
  return {
    ...vehicle,
    lastServiceDate: date || new Date(now).toISOString().slice(0, 10),
    lastInvoiceNo: invoiceNo,
    totalSpend: (Number(vehicle.totalSpend) || 0) + amount,
    serviceCount: (Number(vehicle.serviceCount) || 0) + 1,
    serviceHistory: history,
  };
}

/**
 * Top N vehicle makes across all customers, most-common first. Pulled
 * verbatim out of the Reports "brandMix" useMemo — only the counting/sorting
 * is extracted; color assignment (a presentation concern) stays in the
 * component.
 */
export function topVehicleBrands(customers = [], limit = 8) {
  const m = {};
  (customers || []).forEach((c) => (c.vehicles || []).forEach((v) => {
    const b = (v.make || (v.vehicle || '').split(' ')[0] || 'Other');
    m[b] = (m[b] || 0) + 1;
  }));
  return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([label, value]) => ({ label, value }));
}

/**
 * The customer+vehicle fields for a new Job Card draft (everything except
 * `jobNo`, which jobCardService.nextJobCardNumber owns). Pulled verbatim out
 * of writeJobCardDraft.
 */
export function buildJobCardDraftFields(customer = {}, vehicle = {}) {
  const makeModel = [vehicle.make, vehicle.model].filter(Boolean).join(' ').trim();
  return {
    customerId: customer.id || '',
    customer: customer.name || '',
    phone: customer.phone || '',
    altPhone: customer.altPhone || '',
    address: customer.address || '',
    vehicle: makeModel || vehicle.model || vehicle.vehicle || '',
    make: vehicle.make || '',
    model: vehicle.model || '',
    regNo: vehicle.regNo || '',
    vin: vehicle.vin || '',
    engineNo: vehicle.engineNo || '',
    fuel: vehicle.fuel || 'Petrol',
    odometer: vehicle.odometer || '',
  };
}

/**
 * The customer+vehicle fields for a new-invoice prefill. Pulled verbatim out
 * of writeInvoicePrefill.
 */
export function buildInvoicePrefillFields(customer = {}, vehicle = {}) {
  return {
    customerId: customer.id,
    customer: customer.name,
    phone: customer.phone,
    vehicle: vehicle.model || '',
    regNo: vehicle.regNo || '',
    make: vehicle.make || '',
    model: vehicle.model || '',
  };
}
