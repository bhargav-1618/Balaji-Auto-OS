// components/common/PageHeader.jsx — Universal Page Header standard: the ONE way to
// build a page header for the whole app.
//
// Before this: a near-identical component (`PageShell`) already existed, but was
// defined LOCALLY inside InventoryDashboard.js (not exported, not shared), and only 4
// of ~20 views used it. Several other views hand-rolled a near-duplicate of the same
// icon-badge + title idea with drifted spacing/sizing each time — the exact drift
// PageShell was meant to prevent but never reached, since it wasn't shared. Many other
// views (Customers, Vehicles, Billing's list, Analytics, Reminders, several Inventory
// sub-views) had no title at all. Separately, a global sticky bar in the app shell
// existed purely to inject a lone "Add Part"/"Add Supplier" button, pushed to the far
// right with no title — a second, competing header mechanism instead of being part of
// the page's own header (see InventoryDashboard.js's removal of that bar in this same
// pass, replaced by this component's `action` slot on the Inventory/Suppliers views).
//
// This promotes PageShell's shape — already the richest of the three competing shapes
// found (title, subtitle, icon badge, action slot, proven across 4 different call
// patterns) — into one shared, exported component every module imports.
//
// Composable two ways from the SAME component (no separate "headerOnly" mode):
//   - Pass `children` to let PageHeader own the whole content flow (matches every
//     existing PageShell consumer: LedgerPage, ReportsView, AlertsView, SettingsView).
//   - Omit `children` and render <PageHeader/> as the first child inside your own
//     wrapper, with your own toolbar/table as sibling elements below it (matches the
//     dominant "title → toolbar → content" shape used by Customers/Vehicles/Billing).
//
// `action` is reserved for buttons/menus (Export, New PO, Add Part, Mark all read) —
// search inputs, filter chips and toolbars belong in `children`/siblings instead, so
// this slot means the same thing everywhere it's used.
import React from 'react';

export default function PageHeader({ title, subtitle, icon: Icon, action, children }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>
        <h2 className="text-lg font-bold text-white flex items-center gap-2.5">
          {Icon && <span className="flex items-center justify-center w-8 h-8 rounded-xl flex-shrink-0" style={{ background: 'rgba(212,175,55,0.12)' }}><Icon size={17} className="text-[#d4af37]" /></span>}
          <span className="min-w-0">
            {title}
            {subtitle && <span className="block text-[11px] font-normal text-white/45 mt-0.5 truncate">{subtitle}</span>}
          </span>
        </h2>
        {action}
      </div>
      {children}
    </div>
  );
}
