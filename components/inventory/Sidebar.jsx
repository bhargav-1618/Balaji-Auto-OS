// components/inventory/Sidebar.jsx
//
// REFACTOR PHASE 8 — the app-shell left navigation (desktop rail + mobile drawer),
// extracted verbatim from InventoryDashboard.js. Pure props → JSX: it owns NO
// routing logic — `activeTab` / `setActiveTab` stay in the container, and every
// item just calls the `setActiveTab` prop (the container keeps the hash sync, the
// history `onPop` guard, `blockingModalRef`, `snapBack` — none of that moved).
// The NAV_GROUPS config + GROUP_OF_TAB lookup move here because nothing else uses
// them; NAV_ITEMS is a long-dead flatten kept co-located with its source array.

import { useState, useEffect } from 'react';
import {
  LayoutDashboard, ClipboardList, Users, Car, Receipt, ShoppingCart, Wrench,
  Package, Truck, PackagePlus, Send, BarChart3, FileText, AlertTriangle, Bell,
  Settings, ChevronDown, RefreshCw,
} from 'lucide-react';
import { useTranslation } from '../../lib/i18n';
import { STORAGE } from '../../constants';
import { assertBodyUnlockedIfNoModals } from '../Modal';
import SidebarTheme from './ui/SidebarTheme';

// Local copy — also read by SettingsView (still in the container). Mirrors
// package.json "version"; the same value already appears in two places in the app.
const APP_VERSION = '1.0.0';

// Sidebar grouped into collapsible workflow sections. `id`s are the SAME activeTab
// keys — routing/permissions unchanged. `badge` names a live counter; `admin` gates.
const NAV_GROUPS = [
  { key: 'dashboard', header: null, items: [
    { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
  ] },
  { key: 'operations', header: 'Operations', items: [
    { id: 'jobcards', label: 'Job Cards', icon: ClipboardList, badge: 'jobcards' },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'vehicles', label: 'Vehicles', icon: Car },
    { id: 'billing', label: 'Billing', icon: Receipt },
    { id: 'sales', label: 'Sales', icon: ShoppingCart },
    { id: 'services', label: 'Services', icon: Wrench },
  ] },
  { key: 'inventory', header: 'Inventory', items: [
    { id: 'inventory', label: 'Inventory', icon: Package, badge: 'inventory' },
    { id: 'suppliers', label: 'Suppliers', icon: Truck },
    { id: 'stockin', label: 'Stock In', icon: PackagePlus },
    { id: 'stockout', label: 'Stock Out', icon: Send },
  ] },
  { key: 'bi', header: 'Business Intelligence', items: [
    { id: 'analytics', label: 'Analytics', icon: BarChart3, admin: true },
    { id: 'reports', label: 'Reports', icon: FileText },
  ] },
  { key: 'communication', header: 'Communication', items: [
    { id: 'alerts', label: 'Alerts', icon: AlertTriangle, badge: 'alerts' },
    { id: 'reminders', label: 'Reminders', icon: Bell, badge: 'reminders' },
  ] },
  { key: 'administration', header: 'Administration', items: [
    { id: 'settings', label: 'Settings', icon: Settings },
  ] },
];
const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
// which group holds a given tab id (used to auto-expand the active section)
const GROUP_OF_TAB = NAV_GROUPS.reduce((acc, g) => { g.items.forEach((it) => { acc[it.id] = g.key; }); return acc; }, {});

function Sidebar({ activeTab, setActiveTab, collapsed, setCollapsed, mobileOpen, setMobileOpen, isAdmin, alertCount, reminderCount = 0, jobCount = 0, inventoryCount = 0, status, onRetry }) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setMobileOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen, setMobileOpen]);
  const width = collapsed ? 72 : 280;
  const go = (id) => { setActiveTab(id); setMobileOpen(false); };
  const badgeFor = (key) => ({ alerts: alertCount, reminders: reminderCount, jobcards: jobCount, inventory: inventoryCount }[key] || 0);

  // collapsible sections — persisted, auto-expand the active section.
  const [openGroups, setOpenGroups] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem(STORAGE.NAV_GROUPS) || 'null'); if (saved) return saved; } catch {}
    return NAV_GROUPS.reduce((a, g) => { a[g.key] = true; return a; }, {});
  });
  useEffect(() => { try { localStorage.setItem(STORAGE.NAV_GROUPS, JSON.stringify(openGroups)); } catch {} }, [openGroups]);
  // Self-heal a stranded body-scroll lock. If a modal ever failed to clean up, the
  // page would be silently unscrollable with nothing on screen to explain it; this
  // releases the lock whenever we navigate and nothing is actually open.
  useEffect(() => { assertBodyUnlockedIfNoModals(); }, [activeTab]);
  useEffect(() => { const gk = GROUP_OF_TAB[activeTab]; if (gk) setOpenGroups((s) => (s[gk] ? s : { ...s, [gk]: true })); }, [activeTab]);
  const toggleGroup = (key) => setOpenGroups((s) => ({ ...s, [key]: !s[key] }));

  // Rendered as a function call, NOT as a <Component>. Defining a component inside
  // render gives it a fresh identity each time, so React would remount every nav item on
  // every Sidebar render (each activeTab change, each badge tick) — key does not help,
  // since React checks component type first. A plain function call reconciles normally.
  const renderItem = (it) => {
    const active = activeTab === it.id;
    const badge = it.badge ? badgeFor(it.badge) : 0;
    const label = t(`nav.${it.id}`, it.label);
    return (
      <button key={it.id} onClick={() => go(it.id)} title={collapsed ? label : undefined} aria-current={active ? 'page' : undefined}
        className={`group relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${active ? 'text-[#d4af37] font-semibold' : 'text-white/55 hover:bg-white/[0.06] hover:text-white/90'}`}
        style={active ? { background: 'linear-gradient(90deg, rgba(212,175,55,0.16), rgba(212,175,55,0.05))', boxShadow: '0 0 0 1px rgba(212,175,55,0.18)' } : undefined}>
        {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full" style={{ background: 'linear-gradient(180deg,#e8c84a,#aa801e)' }} />}
        <it.icon size={18} className={`flex-shrink-0 transition-colors ${active ? 'text-[#d4af37]' : 'text-white/50 group-hover:text-[#d4af37]'}`} />
        {!collapsed && <span className="flex-1 text-left truncate">{label}</span>}
        {!collapsed && badge > 0 && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${it.badge === 'alerts' ? 'bg-red-500/20 text-red-400' : 'bg-[#d4af37]/20 text-[#d4af37]'}`}>{badge > 99 ? '99+' : badge}</span>}
        {collapsed && badge > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full" style={{ background: it.badge === 'alerts' ? '#f87171' : '#d4af37' }} />}
      </button>
    );
  };
  const inner = (
    <div className="flex flex-col h-full" style={{ width }}>
      {/* Brand → app home (the Dashboard/Overview tab). Uses the same go() the nav
          items use, so it follows the app's tab + #hash routing with no page reload;
          a real <button> keeps Enter/Space activation and focus styling for free. */}
      <button type="button" onClick={() => go('overview')} aria-label="Go to Dashboard home"
        aria-current={activeTab === 'overview' ? 'page' : undefined}
        className="flex items-center gap-2 w-full text-left px-4 py-4 border-b border-white/8 transition-colors hover:bg-white/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]/50 focus-visible:ring-inset">
        <span className="flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0 overflow-hidden bg-gradient-to-br from-[#e8c84a] to-[#aa801e]">
          <img src="/icons/icon-512.png" alt="Sri Baba Balaji Maruti Care" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        </span>
        {!collapsed && <span className="min-w-0"><span className="block text-xs font-bold text-[#d4af37] leading-tight truncate">SRI BABA BALAJI</span><span className="block text-[10px] text-white/45 truncate">MARUTI CARE</span></span>}
      </button>
      <nav className="flex-1 overflow-y-auto dark-scroll px-2 py-3 space-y-0.5" aria-label="Main navigation">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((it) => !it.admin || isAdmin);
          if (!items.length) return null;
          const open = collapsed ? true : (openGroups[group.key] !== false);
          const groupBadge = items.reduce((s, it) => s + (it.badge ? badgeFor(it.badge) : 0), 0);
          return (
            <div key={group.key} className="pt-1.5">
              {!collapsed && group.header && (
                <button onClick={() => toggleGroup(group.key)} aria-expanded={open}
                  className="w-full flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white/45 hover:text-white/55 transition">
                  <ChevronDown size={12} className="transition-transform duration-200" style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
                  <span className="flex-1 text-left">{t(`navGroup.${group.key}`, group.header)}</span>
                  {!open && groupBadge > 0 && <span className="w-1.5 h-1.5 rounded-full bg-[#d4af37]" />}
                </button>
              )}
              {collapsed && group.header && <div className="mx-3 my-2 h-px" style={{ background: 'rgba(var(--fg-rgb),0.07)' }} />}
              <div className="grid transition-all duration-200 ease-out" style={{ gridTemplateRows: open ? '1fr' : '0fr' }}>
                <div className="overflow-hidden"><div className="space-y-0.5 pt-0.5">{items.map((it) => renderItem(it))}</div></div>
              </div>
            </div>
          );
        })}
      </nav>
      <SidebarTheme collapsed={collapsed} />
      {!collapsed && (
        <div className="m-2 p-2.5 rounded-xl flex items-center gap-2" style={{ background: 'rgba(var(--fg-rgb),0.02)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
          <button onClick={() => go('settings')} className="flex-1 min-w-0 flex items-center gap-2 text-left" title="Open Settings for full system info">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: status.color }} />
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-semibold leading-tight" style={{ color: status.color }}>{status.label}</span>
              <span className="block text-[10px] text-white/45 truncate">v{APP_VERSION} · {status.records} records</span>
            </span>
          </button>
          {/* H-8: retrySync() existed but was never reachable from the UI — a Connection
              Error left the user with no recovery but a full page reload. This is the
              missing control, shown only while there's actually something to retry. */}
          {status.label === 'Connection Error' && onRetry ? (
            <button onClick={onRetry} title="Retry connection" aria-label="Retry connection" className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-white/50 hover:text-[#d4af37] hover:bg-white/10 transition">
              <RefreshCw size={13} />
            </button>
          ) : (
            <Settings size={13} className="text-white/45 flex-shrink-0" />
          )}
        </div>
      )}
      <button onClick={() => setCollapsed((v) => !v)} className="hidden md:flex items-center justify-center gap-2 m-2 py-2 rounded-lg text-xs text-white/45 hover:bg-white/5 hover:text-white/70 transition" title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        <ChevronDown size={14} className={`transition-transform ${collapsed ? '-rotate-90' : 'rotate-90'}`} /> {!collapsed && 'Collapse'}
      </button>
    </div>
  );
  return (
    <>
      {/* Desktop */}
      <aside className="hidden md:block fixed left-0 top-0 bottom-0 z-50 transition-all" style={{ width, background: 'var(--surface-0)', borderRight: '1px solid rgba(212,175,55,0.12)' }}>{inner}</aside>
      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-[60]">
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setMobileOpen(false)} />
          {/* APPLICATION SHELL: was `overflow-y-auto` on THIS <aside> too — a second,
              OUTER scroll container wrapping the entire `inner` (branding + nav +
              footer), stacked on top of `inner`'s own correct internal scroll (only
              `<nav>` is `flex-1 overflow-y-auto`). With two nested scrollers, scrolling
              anywhere over the branding/footer area (outside the nav's own box, but
              still inside this outer one) scrolled the WHOLE drawer as one unit —
              exactly "sidebar footer scrolls together with navigation," but only on
              mobile/tablet widths (the desktop <aside> below never had this extra
              overflow). Removed; `inner`'s own flex/overflow structure is sufficient —
              matches desktop exactly, branding and footer now stay fixed while only
              the nav list scrolls. */}
          <aside className="absolute left-0 top-0 bottom-0" style={{ width: 280, background: 'var(--surface-0)', borderRight: '1px solid rgba(212,175,55,0.15)', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>{inner}</aside>
        </div>
      )}
    </>
  );
}

export { Sidebar };
export default Sidebar;
