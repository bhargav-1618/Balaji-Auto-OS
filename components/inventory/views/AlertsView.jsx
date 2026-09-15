/**
 * components/inventory/views/AlertsView.jsx
 *
 * Refactor Phase 3 — view extraction. The Alert Center view, previously a
 * file-local component inside InventoryDashboard.js. Purely presentational:
 * reads the computed `alerts` array plus the read/archived id Sets and capacity
 * props the container passes down, and calls back through onMarkRead / onArchive /
 * onEditPart / onQuickReceive / capacityOnConfirm. Local UI state only
 * (search query, category filter, page, the detail drawer, pinned ids).
 *
 * Moved verbatim: every className, the KPI tile grid, the debounced+ranked search,
 * pagination, the portaled detail drawer and its sticky footer. No Firestore, no
 * demoMode, no navigation guards, no transactions — the container still owns the
 * alert stores, persistence and permissions.
 */
import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, RefreshCw, Check, X } from 'lucide-react';
import { useTranslation } from '../../../lib/i18n';
import { useDeferredSearch } from '../../../lib/useSearch';
import { safeLower } from '../../../lib/format';
import { SEMANTIC } from '../../../constants/ui';
import toast from '../../../lib/toast';
import PageHeader from '../../common/PageHeader';
import LocalCapacityBanner from '../../common/LocalCapacityBanner';
import NotificationRow from '../../common/NotificationRow';

export default function AlertsView({ alerts, readIds, archivedIds, onMarkRead, onMarkAllRead, onArchive, onEditPart, onQuickReceive, inventory, canDestroy = true, capacityStatus, capacityGetEntries, capacityOnConfirm, onCapacityCleanup }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  // The typed character renders immediately; only the derived filter lags — was the one
  // undebounced search box in this file besides Reports (see ReportsView).
  const [dq] = useDeferredSearch(q);
  const [cat, setCat] = useState('all');
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState(null);
  const [pinned, setPinned] = useState(new Set());
  const PER = 25;
  const visible = useMemo(() => alerts.filter((a) => !archivedIds.has(a.id)), [alerts, archivedIds]);
  const counts = useMemo(() => ({
    critical: visible.filter((a) => a.sev === 'Critical').length,
    warning: visible.filter((a) => a.sev === 'Warning').length,
    info: visible.filter((a) => ['Inventory', 'Supplier'].includes(a.sev)).length,
    inventory: visible.filter((a) => ['critical', 'warning', 'inventory'].includes(a.cat)).length,
    customer: visible.filter((a) => a.cat === 'customer').length,
    vehicle: visible.filter((a) => a.cat === 'vehicle').length,
    billing: visible.filter((a) => a.cat === 'billing').length,
    supplier: visible.filter((a) => a.cat === 'supplier').length,
    total: visible.length,
    unread: visible.filter((a) => !readIds.has(a.id)).length,
    acknowledged: visible.filter((a) => readIds.has(a.id)).length,
  }), [visible, readIds]);
  const filtered = useMemo(() => {
    const needle = safeLower(dq.trim());
    const matched = visible.filter((a) => {
      if (cat === 'unread' && readIds.has(a.id)) return false;
      if (cat === 'read' && !readIds.has(a.id)) return false;
      if (cat === 'inventory' && !['critical', 'warning', 'inventory'].includes(a.cat)) return false;
      if (['customer', 'vehicle', 'billing', 'supplier'].includes(cat) && a.cat !== cat) return false;
      if (cat === 'critical' && a.sev !== 'Critical') return false;
      if (needle && !safeLower(`${a.title} ${a.sub} ${a.module || ''}`).includes(needle)) return false;
      return true;
    });
    if (!needle) return matched;
    // GLOBAL SEARCH ACCURACY — RANKING. Alerts are synthesized notification strings, not
    // records with a formal identifier field (their `id` is an internal key like
    // "low-<partId>", not something a user searches by) — so this stays a substring
    // search over title/sub/module, the correct model here. What was missing was
    // ranking: a title that EQUALS or STARTS WITH the query is a stronger, more
    // deliberate match than one where the query only appears as a mid-string fragment.
    const rankOf = (a) => {
      const title = safeLower(a.title);
      if (title === needle) return 3;
      if (title.startsWith(needle)) return 2;
      return 1;
    };
    return [...matched].sort((a, b) => rankOf(b) - rankOf(a));
  }, [visible, dq, cat, readIds]);
  useEffect(() => { setPage(1); }, [dq, cat]);
  const pages = Math.max(1, Math.ceil(filtered.length / PER));
  // PHASE 16 — the effect above resets on a FILTER change; this keeps `page` in
  // range when the alerts list shrinks without one (an alert resolved/dismissed,
  // here or by a concurrent client, while a later page is open).
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  const shown = filtered.slice((page - 1) * PER, page * PER);
  // COLOR SYSTEM REVIEW: 'Warning' rendered GOLD here but AMBER in the KPI filter tile
  // just below (the brief's own worked example of a design-system failure — the same
  // severity telling two different stories on the same screen). Inventory/Supplier are
  // categories riding in the same `a.sev` field, not real severities, so they get neutral
  // muted rather than inventing a category-color meaning that would compete with the two
  // real severities for attention.
  const sevColor = { Critical: SEMANTIC.danger, Warning: SEMANTIC.warn, Inventory: SEMANTIC.muted, Supplier: SEMANTIC.muted };
  const fld = 'px-2.5 py-2 rounded-lg text-xs outline-none bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60';
  // Out-of-stock / low-stock alerts ('out-'/'low-' ids) are a shortage the user wants
  // to replenish — route those to Receive Stock. Other part-linked alerts (SKU
  // conflict, negative stock, no supplier) are data/config issues that genuinely need
  // Edit Part, so they're left alone.
  const openPart = (a) => {
    onMarkRead(a.id);
    if (a.partId) {
      const p = inventory.find((x) => x.id === a.partId);
      if (p) {
        const isStockShortage = a.id.startsWith('low-') || a.id.startsWith('out-');
        if (isStockShortage && onQuickReceive) onQuickReceive(p); else onEditPart(p);
      }
    }
    setDrawer(a);
  };
  return (
    <PageHeader title={t('page.alertCenter', 'Alert Center')} icon={AlertTriangle} action={counts.unread > 0 && <button onClick={onMarkAllRead} className="text-xs font-semibold text-white/60 hover:text-white px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">{t('alerts.markAllRead', 'Mark all read')}</button>}>
      {capacityStatus && (
        <LocalCapacityBanner
          moduleKey="alerts"
          moduleLabel="Alerts"
          recordLabel="tracked alert entry"
          status={capacityStatus}
          getEntries={capacityGetEntries}
          methodTitle="Remove Stale Entries"
          methodBlurb="Permanently remove read/archived tracking for alerts whose underlying issue is already resolved. Alerts that are still active are never touched, no matter how old."
          onConfirm={capacityOnConfirm}
          onComplete={onCapacityCleanup}
          canManage={canDestroy}
        />
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
        {/* COLOR SYSTEM REVIEW: 10 tiles, ~8 independently-picked hex colors, mixing
            actual severity (Critical/Warning) with plain categories (Customer/Billing/
            Vehicle/Supplier/Inventory) and read-state (Unread/Acknowledged/Total) — the
            exact "every KPI has its own unrelated color" anti-pattern. Categories aren't
            statuses and don't need to compete for attention with the two real severities,
            so they go muted; Unread matches the UNREAD chip a few lines below (also gold);
            Acknowledged is a genuine resolved/positive state → green; Total stays neutral. */}
        {[
          { label: 'Critical', value: counts.critical, color: SEMANTIC.danger },
          { label: 'Warning', value: counts.warning, color: SEMANTIC.warn },
          { label: 'Customer', value: counts.customer, color: SEMANTIC.muted },
          { label: 'Billing', value: counts.billing, color: SEMANTIC.muted },
          { label: 'Vehicle', value: counts.vehicle, color: SEMANTIC.muted },
          { label: 'Supplier', value: counts.supplier, color: SEMANTIC.muted },
          { label: 'Unread', value: counts.unread, color: SEMANTIC.gold },
          { label: 'Acknowledged', value: counts.acknowledged, color: SEMANTIC.ok },
          { label: 'Inventory', value: counts.inventory, color: SEMANTIC.muted },
          { label: 'Total', value: counts.total, color: SEMANTIC.muted },
        ].map((c) => (
          <button key={c.label} onClick={() => setCat(c.label.toLowerCase() === 'acknowledged' ? 'read' : c.label.toLowerCase() === 'unread' ? 'unread' : c.label.toLowerCase())} className="text-left rounded-xl p-3 transition hover:bg-white/[0.05]" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
            <p className="text-[10px] uppercase tracking-wider text-white/45">{t(`alerts.category.${c.label.toLowerCase()}`, c.label)}</p>
            <p className="text-xl font-bold mt-0.5" style={{ color: c.color }}>{c.value}</p>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('alerts.searchPlaceholder', 'Search alerts by title, detail, module…')} className={`${fld} flex-1 min-w-[140px]`} />
        <select value={cat} onChange={(e) => setCat(e.target.value)} className={fld}>
          {[['all', t('common.all', 'All')], ['unread', t('common.unread', 'Unread')], ['read', t('alerts.category.acknowledged', 'Acknowledged')], ['critical', t('alerts.category.critical', 'Critical')], ['inventory', t('alerts.category.inventory', 'Inventory')], ['customer', t('alerts.category.customer', 'Customer')], ['vehicle', t('alerts.category.vehicle', 'Vehicle')], ['billing', t('alerts.category.billing', 'Billing')], ['supplier', t('alerts.category.supplier', 'Supplier')]].map(([v, l]) => <option key={v} value={v} className="bg-[#111]">{l}</option>)}
        </select>
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-emerald-400/80 py-8 text-center">{visible.length === 0 ? t('alerts.empty.allClear', 'All clear — no active alerts. ✓') : t('alerts.empty.noMatch', 'No alerts match your filter.')}</p>
      ) : (
        <>
          <p className="text-[11px] text-white/45">{t('dynamic.showingOfTotal', `Showing ${shown.length} of ${filtered.length}`, { n: shown.length, total: filtered.length })}</p>
          <div className="space-y-2">
            {shown.map((a) => {
              const isRead = readIds.has(a.id);
              const color = sevColor[a.sev] || '#888';
              return (
                <NotificationRow
                  key={a.id}
                  icon={AlertTriangle}
                  iconColor={color}
                  accentColor={color}
                  title={a.title}
                  meta={a.sub}
                  muted={isRead}
                  onTitleClick={() => openPart(a)}
                  titleChips={[isRead ? { label: t('common.read', 'READ').toUpperCase(), color: SEMANTIC.muted } : { label: t('common.unread', 'UNREAD').toUpperCase(), color: SEMANTIC.gold }]}
                  actions={[
                    isRead
                      ? { icon: RefreshCw, title: t('alerts.action.markUnread', 'Mark unread'), onClick: () => onMarkRead(a.id, false) }
                      : { icon: Check, title: t('alerts.action.markRead', 'Mark read'), onClick: () => onMarkRead(a.id, true), className: 'bg-emerald-500/12 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20' },
                    ...(canDestroy ? [{ icon: X, title: t('alerts.action.archiveAlert', 'Archive alert'), onClick: () => onArchive(a.id), className: 'bg-white/5 border border-white/10 text-white/45 hover:text-red-400 hover:bg-white/10' }] : []),
                  ]}
                />
              );
            })}
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-white/70 disabled:opacity-30">{t('common.previous', 'Previous')}</button>
              <span className="text-xs text-white/50">{t('common.page', 'Page')} {page} / {pages}</span>
              <button disabled={page === pages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-white/70 disabled:opacity-30">{t('common.next', 'Next')}</button>
            </div>
          )}
        </>
      )}
      {drawer && typeof document !== 'undefined' && createPortal((
        // Portal to <body>: AlertsView renders inside <main> (`relative z-10`, its
        // own stacking context), so this `fixed inset-0` drawer was capped at
        // <main>'s z-10 — its header hid under the demo banner (z-[90]) and its
        // sticky Pin / Acknowledge / Resolve footer under the mobile bottom-nav
        // (z-[80]). Same fix as the Job Card preview drawer.
        <div className="fixed inset-0 z-[120] flex justify-end" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }} onClick={() => setDrawer(null)}>
          <div className="w-full sm:max-w-md h-full overflow-y-auto dark-scroll" style={{ background: 'var(--surface-1)', borderLeft: '1px solid rgba(212,175,55,0.2)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between p-5" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
              <div className="min-w-0"><div className="flex items-center gap-2"><h3 className="text-base font-bold text-white">{drawer.title}</h3><span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${sevColor[drawer.sev] || '#888'}22`, color: sevColor[drawer.sev] || '#888' }}>{drawer.sev}</span></div><p className="text-[11px] text-white/45 mt-1">{drawer.sub}</p></div>
              <button onClick={() => setDrawer(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10 flex-shrink-0"><X size={17} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                {[[t('alerts.field.sourceModule', 'Source Module'), drawer.module || '—'], [t('alerts.field.category', 'Category'), drawer.cat || '—'], [t('alerts.field.priority', 'Priority'), drawer.sev], [t('common.status', 'Status'), readIds.has(drawer.id) ? t('alerts.category.acknowledged', 'Acknowledged') : t('common.unread', 'Unread')], drawer.regNo && [t('vehicles.col.vehicle', 'Vehicle'), drawer.regNo], drawer.invNo && [t('billing.col.invoice', 'Invoice'), drawer.invNo], drawer.jobNo && [t('nav.jobcards', 'Job Card'), drawer.jobNo]].filter(Boolean).map(([k, v]) => (
                  <div key={k} className="rounded-lg p-2" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}><p className="text-white/45">{k}</p><p className="text-white/80 mt-0.5">{v}</p></div>
                ))}
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#d4af37] mb-2">{t('alerts.timeline', 'Timeline')}</p>
                <div className="space-y-2">
                  {[[t('alerts.alertGenerated', 'Alert generated'), 'now'], readIds.has(drawer.id) && [t('alerts.category.acknowledged', 'Acknowledged'), 'now']].filter(Boolean).map(([label], i) => (
                    <div key={i} className="flex gap-2.5 items-start"><span className="w-2 h-2 rounded-full bg-[#d4af37] mt-1" /><div><p className="text-xs text-white/80">{label}</p></div></div>
                  ))}
                </div>
              </div>
              <p className="text-[10px] text-white/45">{t('alerts.channelsNote', 'Notification channels (in-app active; email / SMS / WhatsApp architecture-ready).')}</p>
            </div>
            <div className="sticky bottom-0 flex gap-2 p-4" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.08)', background: 'var(--surface-2)' }}>
              <button onClick={() => { setPinned((s) => { const n = new Set(s); n.has(drawer.id) ? n.delete(drawer.id) : n.add(drawer.id); return n; }); }} className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-white/5 border border-white/10 text-white/80">{pinned.has(drawer.id) ? t('alerts.unpin', 'Unpin') : t('alerts.pin', 'Pin')}</button>
              <button onClick={() => { onMarkRead(drawer.id, false); toast.success(t('alerts.category.acknowledged', 'Acknowledged')); }} className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/25">{t('common.acknowledge', 'Acknowledge')}</button>
              <button onClick={() => { onArchive(drawer.id); setDrawer(null); toast.success(t('alerts.resolved', 'Resolved')); }} className="flex-1 py-2.5 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">{t('common.resolve', 'Resolve')}</button>
            </div>
          </div>
        </div>
      ), document.body)}
    </PageHeader>
  );
}
