// lib/demoPerms.js
//
// THE DEMO-PERMISSION MODEL — one source of truth.
//
// Owner/Admin decides what a Demo USER may do. Stored locally (never Firestore);
// consulted by InventoryDashboard's destructive-action guards (`demoCan()`) and
// edited by the Settings → Demo Permissions panel. Both sides import from here so
// the keys, defaults and storage key can never drift apart.
//
// Refactor Phase 12 — moved verbatim out of components/InventoryDashboard.js when
// SettingsView was extracted; `loadDemoPerms` was already shared (the container's
// own `demoPerms` state + its `maruti-demo-perms` refresh listener call it too).

// Default: everything a demo user could mutate is OFF (safe), read-only actions ON.
// Keys map to actions checked via demoCan().
export const DEMO_PERM_DEFAULTS = {
  deleteInventory: false, deleteCustomers: false, deleteVehicles: false, deleteSuppliers: false,
  deleteJobCards: false, deleteInvoices: false,
  exportExcel: true,
  editPricing: true, changeStock: true, accessSettings: true,
  viewAnalytics: true, viewReports: true,
};

export const DEMO_PERM_KEY = 'maruti_demo_perms';

// Enterprise grouping for the Demo Permissions settings page. Each entry maps a
// permission KEY (unchanged — logic still reads these via demoCan()) to a human
// title, a one-line description, and a `danger` flag for high-risk actions.
// Grouped by module the way an admin thinks about the app. `icon` is a lucide
// component NAME (the Settings panel resolves it against a local icon map).
export const DEMO_PERM_GROUPS = [
  { module: 'Inventory', icon: 'Package', items: [
    { key: 'deleteInventory', title: 'Delete Inventory', desc: 'Allow demo users to permanently delete inventory parts.', danger: true },
    { key: 'changeStock', title: 'Change Stock', desc: 'Allow adjusting stock levels, stock-in and stock-out.' },
    { key: 'exportExcel', title: 'Export Excel', desc: 'Allow exporting inventory and other data to Excel/CSV.' },
  ] },
  { module: 'Customers', icon: 'Users', items: [
    { key: 'deleteCustomers', title: 'Delete Customers', desc: 'Allow permanently deleting customer records.', danger: true },
  ] },
  { module: 'Vehicles', icon: 'Car', items: [
    { key: 'deleteVehicles', title: 'Delete Vehicles', desc: 'Allow permanently deleting vehicle records.', danger: true },
  ] },
  { module: 'Job Cards', icon: 'ClipboardList', items: [
    { key: 'deleteJobCards', title: 'Delete Job Cards', desc: 'Allow permanently deleting job cards.', danger: true },
  ] },
  { module: 'Billing', icon: 'Receipt', items: [
    { key: 'deleteInvoices', title: 'Delete Invoices', desc: 'Allow permanently deleting invoices and estimates.', danger: true },
    { key: 'editPricing', title: 'Edit Pricing', desc: 'Allow changing rates, discounts and line pricing on invoices.' },
  ] },
  { module: 'Suppliers', icon: 'Truck', items: [
    { key: 'deleteSuppliers', title: 'Delete Suppliers', desc: 'Allow permanently deleting supplier records.', danger: true },
  ] },
  { module: 'Administration', icon: 'ShieldCheck', items: [
    { key: 'accessSettings', title: 'Access Settings', desc: 'Allow opening the Settings area and changing preferences.' },
  ] },
  { module: 'Reports & Analytics', icon: 'BarChart3', items: [
    { key: 'viewReports', title: 'View Reports', desc: 'Allow opening the Reports page and exporting reports.' },
    { key: 'viewAnalytics', title: 'View Analytics', desc: 'Allow opening the Analytics dashboard and charts.' },
  ] },
];

export function loadDemoPerms() {
  try { return { ...DEMO_PERM_DEFAULTS, ...(JSON.parse(localStorage.getItem(DEMO_PERM_KEY) || '{}')) }; } catch { return { ...DEMO_PERM_DEFAULTS }; }
}
