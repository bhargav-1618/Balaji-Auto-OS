// components/inventory/SupplierDirectory.jsx
// Master–detail Supplier Directory (ERP style): left supplier list, center detail
// panel with tabs + summary + parts table, right docked PO builder (passed in).
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { num } from '../../lib/format';
import { SEMANTIC } from '../../constants/ui';
import { useSearchIndex, matchIndexed, rankIndexed, useDeferredSearch } from '../../lib/useSearch';
import {
  Search, Phone, Star, Edit3, MoreVertical, Eye, Plus,
  Archive, Trash2, ChevronDown, MessageCircle, PackagePlus,
} from 'lucide-react';
import ActionMenu from '../common/ActionMenu';
import ResizablePanes from '../common/ResizablePanes';
import { useTranslation } from '../../lib/i18n';


// Module-scoped view state — a plain JS-module-level object, NOT sessionStorage-backed.
// Survives a tab-switch unmount (the module stays loaded, so this object keeps its values
// while the user is elsewhere) — genuinely useful in-app navigation memory, and brings
// Suppliers' selected-record behavior in line with Customers/Vehicles (previously `selId`
// here was plain useState and didn't survive a tab-switch at all, an inconsistency in the
// other direction). Deliberately does NOT survive a real reload: the JS module re-evaluates
// from scratch then, resetting back to defaultSupView() — a reload should land on the
// directory at a sane default, not silently resurrect a stale search/selection from before.
const defaultSupView = () => ({ q: '', statusF: 'All', sortBy: 'recent', selId: null });
const supplierViewState = defaultSupView();

export default function SupplierDirectory({
  suppliers = [], inventory = [], purchaseOrders = [], restocks = [], formatINR, loading = false,
  canManage = false, onEdit, onArchive, onDelete, onAddPart, onViewPart, onAddToPO, onReceiveStock, poPanel, selectSupplierId,
}) {
  const { t } = useTranslation();
  const inr = (n) => (typeof formatINR === 'function' ? formatINR(n) : `₹${Math.round(num(n)).toLocaleString('en-IN')}`);
  const active = useMemo(() => suppliers.filter((s) => !s.archived), [suppliers]);
  const V = supplierViewState;
  const [listQ, setListQ] = useState(V.q);
  const [listDq] = useDeferredSearch(listQ); // Universal Search review: was undebounced
  const [selId, setSelId] = useState(V.selId);
  const [tab, setTab] = useState('overview');
  const [partsQ, setPartsQ] = useState('');
  const [partsPage, setPartsPage] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [statusF, setStatusF] = useState(V.statusF);
  const [sortBy, setSortBy] = useState(V.sortBy);
  const [listPage, setListPage] = useState(1);
  // Write back to the in-memory cache so it restores on tab-switch remount — not on
  // reload, see supplierViewState's own comment above.
  useEffect(() => { V.q = listQ; V.statusF = statusF; V.sortBy = sortBy; V.selId = selId; }, [listQ, statusF, sortBy, selId]);

  // Resizable 3-pane workspace (Suppliers workspace review). Deliberately PLAIN
  // useState, not sessionStorage-backed like listQ/statusF/sortBy above — the brief
  // wants dragged widths to survive a supplier/tab switch but reset the moment the
  // user leaves Suppliers or reloads. Since this state lives in THIS component and
  // Suppliers only renders it while its tab is active, unmounting (navigate away) or
  // reloading both already throw this state away for free — no explicit persistence
  // or reset code needed to satisfy that boundary.
  //
  // Bounds are sized from each pane's actual content, not arbitrary numbers:
  //   Directory (260-440, default 320): a supplier row needs room for avatar + name +
  //     code/city/type + status dot + counts; below ~260px those start truncating hard.
  //   Supplier View (480-1100): the Overview tab's KPI grid wants at least 2 usable
  //     columns and the parts table has 6 columns — 480px is where those stop being
  //     legible. 1100px is the point past which a detail panel reads as "excessively
  //     wide" for scannable text/tables rather than genuinely more useful (Issue 3).
  //   Purchase Order (260-420, default 300): needs a search box, category chips, and a
  //     part row with a quantity stepper without wrapping.
  const [dirWidth, setDirWidth] = useState(320);
  const [poWidth, setPoWidth] = useState(300);
  const PANE_BOUNDS = {
    left: { min: 260, max: 440 },
    center: { min: 480, max: 1100 },
    right: { min: 260, max: 420 },
  };
  const LIST_PER = 12;
  const menuRef = useRef(null);
  const PARTS_PER = 8;

  const outstandingOf = (s) => num(s.outstanding) || 0;
  // Issue 6 (Suppliers module review) — matching restocks to a supplier by NAME meant
  // renaming a supplier silently orphaned its own purchase history (a restock written
  // under the old name would never match again). Match by supplierId first (every
  // restock-creation path now stamps it); fall back to name only for legacy restocks
  // written before that field existed.
  const restocksFor = (s) => restocks.filter((r) => (r.supplierId ? r.supplierId === s.id : (r.supplierName || '') === s.name));
  const lastPurchaseOf = (s) => {
    const rs = restocksFor(s);
    const t = Math.max(0, ...rs.map((r) => (r.receivedAt?.toMillis?.() || r.createdAt?.toMillis?.() || 0)));
    return t || 0;
  };

  // Does a supplier pass a given status filter? (shared by the list and the chip counts)
  const passesStatus = (s, f) => {
    if (f === 'Archived') return !!s.archived;
    if (f === 'Preferred') return !!(s.preferred || s.isPreferred);
    if (f === 'Active') return !(s.status && s.status !== 'Active');
    if (f === 'Inactive') return s.status === 'Inactive';
    if (f === 'Blocked') return s.status === 'Blocked' || s.blocked;
    if (f === 'Outstanding') return outstandingOf(s) > 0;
    return true; // 'All'
  };

  // E2E workflow QA fix: Suppliers had no way to view or restore an archived supplier —
  // every list/search/count/selection below was built from `active` (suppliers.filter
  // (s => !s.archived)) unconditionally, and there was no 'Archived' filter chip at all.
  // Customers/Vehicles/Parts all support archive+restore with a visible Archived view;
  // Suppliers silently didn't, making "Archive Supplier" a one-way, unrecoverable action
  // from inside the app. Reproduced live: an archived test supplier vanished from every
  // filter including "All" and could not be found even by exact-name search.
  // `browsable` is the universe this view operates over: archived suppliers only when
  // the Archived chip is selected, active ones otherwise — same partition Customers uses.
  const STATUS_FILTERS = ['All', 'Active', 'Preferred', 'Inactive', 'Blocked', 'Outstanding', 'Archived'];
  const browsable = useMemo(() => (statusF === 'Archived' ? suppliers.filter((s) => s.archived) : active), [statusF, suppliers, active]);
  // GLOBAL SEARCH ACCURACY: Supplier Code and GST No. match by EXACT value only — a
  // complete supplier code can never also surface an unrelated supplier whose code merely
  // starts with or contains it. Name/city/type/phone stay partial-searchable, unchanged.
  const supplierSearchIndex = useSearchIndex(
    browsable,
    (s) => s.id,
    (s) => [s.name, ...(s.altNames || []), s.city, s.type, (s.phoneNumbers?.[0]?.number || s.phone || '')],
    (s) => [s.code, s.gst],
  );
  // Live counts per filter — respect the current search text so the numbers match what
  // the user would actually see, but are independent of the currently-selected chip.
  // The Archived count is computed from the full supplier list (not `active`, which
  // excludes archived suppliers by definition) so the chip shows a real, non-zero count.
  const filterCounts = useMemo(() => {
    const searched = listDq.trim()
      ? active.filter((s) => matchIndexed(supplierSearchIndex.get(s.id), listDq))
      : active;
    const c = {};
    STATUS_FILTERS.forEach((f) => { c[f] = searched.filter((s) => passesStatus(s, f)).length; });
    c.Archived = suppliers.filter((s) => s.archived).length;
    return c;
  }, [active, suppliers, listDq, supplierSearchIndex]);
  const listScrollRef = useRef(null);

  const listShown = useMemo(() => {
    let list = browsable.filter((s) => passesStatus(s, statusF));
    const sorters = {
      recent: (a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0),
      name: (a, b) => (a.name || '').localeCompare(b.name || ''),
      city: (a, b) => (a.city || '').localeCompare(b.city || ''),
      rating: (a, b) => num(b.rating) - num(a.rating),
      outstanding: (a, b) => outstandingOf(b) - outstandingOf(a),
      lastPurchase: (a, b) => lastPurchaseOf(b) - lastPurchaseOf(a),
    };
    const bySortBy = sorters[sortBy] || sorters.recent;
    if (listDq.trim()) {
      // Universal Search review: an active query ranks exact-match-first, the chosen
      // sort applies only as a tie-break — previously search results stayed in
      // whatever browse-sort was picked, regardless of match quality.
      return list.filter((s) => matchIndexed(supplierSearchIndex.get(s.id), listDq))
        .sort((a, b) => rankIndexed(supplierSearchIndex.get(b.id), listDq) - rankIndexed(supplierSearchIndex.get(a.id), listDq) || bySortBy(a, b));
    }
    return [...list].sort(bySortBy);
  }, [browsable, listDq, statusF, sortBy, restocks, supplierSearchIndex]);

  const listPaged = useMemo(() => listShown.slice((listPage - 1) * LIST_PER, listPage * LIST_PER), [listShown, listPage]);
  const listPageCount = Math.max(1, Math.ceil(listShown.length / LIST_PER));
  useEffect(() => { setListPage(1); if (listScrollRef.current) listScrollRef.current.scrollTop = 0; }, [listDq, statusF, sortBy]);

  // Reads from the full `suppliers` list (not `active`) so an archived supplier stays
  // selectable/viewable via the Archived filter — this was the second half of the
  // archive/restore gap: even with a list entry, `active.find` could never match one.
  const selected = useMemo(() => (selId ? suppliers.find((s) => s.id === selId) || null : null), [suppliers, selId]);

  // External selection (e.g. clicking a row in the Performance dashboard).
  useEffect(() => { if (selectSupplierId) setSelId(selectSupplierId); }, [selectSupplierId]);

  useEffect(() => { setTab('overview'); setPartsQ(''); setPartsPage(1); setMenuOpen(false); }, [selected?.id]);
  // Outside-click / Escape handling for the actions menu is now owned by the
  // portalled <DropdownPanel> below (see components/common/DropdownPanel.jsx),
  // which is the one shared implementation used by every row-action menu in
  // the app instead of each module hand-rolling its own listener pair.

  const partsOf = (sup) => (sup ? inventory.filter((p) => !p.archived && (p.suppliers || []).some((x) => (x?.id || x) === sup.id)) : []);
  const phoneOf = (sup) => sup?.phoneNumbers?.[0]?.number || sup?.phone || '';
  const codeOf = (sup) => sup?.code || (sup?.id ? `SUP-${String(sup.id).replace(/\D/g, '').slice(-3).padStart(3, '0') || '001'}` : 'SUP-001');
  const statsOf = (sup) => {
    const parts = partsOf(sup);
    return {
      parts: parts.length,
      pos: purchaseOrders.filter((po) => po.supplierId === sup?.id).length,
      stockValue: parts.reduce((s, p) => s + num(p.stock) * num(p.purchasePrice), 0),
      low: parts.filter((p) => num(p.stock) > 0 && num(p.stock) <= num(p.minStock || 5)).length,
      records: sup?.records || parts.length,
      archived: inventory.filter((p) => p.archived && (p.suppliers || []).some((x) => (x?.id || x) === sup?.id)).length,
    };
  };

  // GLOBAL SEARCH ACCURACY: Part Number (sku) matches by EXACT value only. Name/category/
  // vehicle/compatible-cars stay partial-searchable, unchanged.
  const partSearchIndex = useSearchIndex(
    inventory,
    (p) => p.id,
    (p) => [p.name, p.category, p.vehicle, ...(p.compatibleCars || [])],
    (p) => [p.sku],
  );
  const selParts = useMemo(() => {
    if (!selected) return [];
    let list = partsOf(selected);
    if (partsQ.trim()) list = list.filter((p) => matchIndexed(partSearchIndex.get(p.id), partsQ));
    return list;
  }, [selected, partsQ, inventory, partSearchIndex]);

  const selPos = useMemo(() => (selected ? purchaseOrders.filter((po) => po.supplierId === selected.id) : []), [selected, purchaseOrders]);
  const selTxns = useMemo(() => (selected ? restocksFor(selected).slice(0, 50) : []), [selected, restocks]);

  const st = selected ? statsOf(selected) : null;
  const waNum = String(phoneOf(selected)).replace(/\D/g, '').slice(-10);

  const menuItems = [
    canManage && { type: 'item', label: t('suppliers.action.addNewPart', 'Add New Part'), icon: Plus, onClick: () => onAddPart?.() },
    canManage && { type: 'item', label: selected?.archived ? t('suppliers.action.restoreSupplier', 'Restore Supplier') : t('suppliers.action.archiveSupplier', 'Archive Supplier'), icon: Archive, onClick: () => onArchive?.(selected) },
    canManage && { type: 'item', label: t('suppliers.action.deleteSupplier', 'Delete Supplier'), icon: Trash2, danger: true, onClick: () => onDelete?.(selected) },
  ];

  const TABS = [
    ['overview', t('common.overview', 'Overview')], ['parts', `${t('suppliers.tab.parts', 'Parts')} (${st?.parts || 0})`], ['pos', `${t('suppliers.tab.purchaseOrders', 'Purchase Orders')} (${selPos.length})`],
    ['txns', `${t('suppliers.tab.transactions', 'Transactions')} (${selTxns.length})`], ['notes', t('common.notes', 'Notes')], ['docs', t('common.documents', 'Documents')],
  ];

  const card = { background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' };
  const partsPaged = selParts.slice((partsPage - 1) * PARTS_PER, partsPage * PARTS_PER);
  const partsPageCount = Math.max(1, Math.ceil(selParts.length / PARTS_PER));

  const PartsTable = ({ rows }) => (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm min-w-[520px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-white/45" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
            <th className="text-left font-semibold py-2 px-2">Part / Vehicle</th>
            <th className="text-left font-semibold py-2 px-2">Category</th>
            <th className="text-center font-semibold py-2 px-2">Stock</th>
            <th className="text-center font-semibold py-2 px-2">Min</th>
            <th className="text-right font-semibold py-2 px-2">Price</th>
            <th className="text-right font-semibold py-2 px-2 w-20">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const low = num(p.stock) > 0 && num(p.stock) <= num(p.minStock || 5);
            const out = num(p.stock) === 0;
            return (
              <tr key={p.id} className="transition hover:bg-white/[0.03] group" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.05)' }}>
                <td className="py-2.5 px-2">
                  <p className="text-white/90 font-medium">{p.name}</p>
                  <p className="text-[11px] text-white/45">{[p.vehicle, p.sku].filter(Boolean).join(' · ')}</p>
                </td>
                <td className="py-2.5 px-2 text-white/60">{p.category || '—'}</td>
                <td className="py-2.5 px-2 text-center">
                  <span className={`font-semibold ${out ? 'text-red-400' : low ? 'text-amber-400' : 'text-white/85'}`}>{num(p.stock)}</span>
                  {low && <p className="text-[10px] text-amber-400/80">Min: {p.minStock || 5}</p>}
                </td>
                <td className="py-2.5 px-2 text-center text-white/50">{p.minStock || 5}</td>
                <td className="py-2.5 px-2 text-right text-white/85">{inr(p.sellingPrice || p.purchasePrice || 0)}</td>
                <td className="py-2.5 px-1 whitespace-nowrap text-right">
                  <div className="inline-flex items-center gap-1 opacity-60 group-hover:opacity-100 transition">
                    <button onClick={() => onViewPart?.(p)} title="View Part Details (new tab)" className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/55 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]/60"><Eye size={12} /></button>
                    {canManage && onReceiveStock && <button onClick={() => onReceiveStock(p)} title="Receive Stock" className="w-7 h-7 rounded-lg flex items-center justify-center bg-emerald-500/12 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"><PackagePlus size={12} /></button>}
                    {onAddToPO && <button onClick={() => onAddToPO(p, selected)} title="Add to Purchase Order" className="w-7 h-7 rounded-lg flex items-center justify-center bg-[#d4af37]/12 border border-[#d4af37]/25 text-[#d4af37] hover:bg-[#d4af37]/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]/60"><Plus size={12} /></button>}
                  </div>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-white/45 text-xs">No parts.</td></tr>}
        </tbody>
      </table>
    </div>
  );

  const leftContent = (
    <div className="rounded-2xl p-2" style={card}>
          <div className="relative mb-2">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/45" />
            <input value={listQ} onChange={(e) => setListQ(e.target.value)} placeholder={t('suppliers.searchPlaceholder', 'Search name, code, city, GST…')} className="w-full pl-9 pr-3 py-2 rounded-xl text-sm bg-white/5 border border-white/10 text-white placeholder-white/30 outline-none focus:border-[#d4af37]/60" />
          </div>
          <div className="flex gap-1.5 mb-2 overflow-x-auto dark-scroll">
            {STATUS_FILTERS.map((f) => (
              <button key={f} onClick={() => setStatusF(f)} className={`px-2 py-1 rounded-lg text-[10px] font-semibold whitespace-nowrap transition-all duration-150 ${statusF === f ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] shadow-sm shadow-[#d4af37]/30' : 'text-white/55 bg-white/5 border border-white/10 hover:bg-white/10'}`}>{f === 'All' ? t('common.all', 'All') : t(`status.${f.toLowerCase()}`, f)} ({filterCounts[f] ?? 0})</button>
            ))}
          </div>
          <div className="flex items-center justify-between mb-1.5 px-1 gap-2">
            <p className="text-[11px] text-white/45 truncate">
              Showing {listShown.length} {statusF === 'All' ? '' : `${statusF} `}Supplier{listShown.length === 1 ? '' : 's'}
              {(statusF !== 'All' || listQ) && <button onClick={() => { setStatusF('All'); setListQ(''); }} className="ml-1.5 text-[#d4af37] hover:underline">Clear</button>}
            </p>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="px-1.5 py-0.5 rounded-md text-[10px] bg-white/5 border border-white/10 text-white/70 outline-none flex-shrink-0">
              {[['recent', 'Recently Added'], ['name', 'A–Z'], ['city', 'City'], ['rating', 'Rating'], ['outstanding', 'Outstanding'], ['lastPurchase', 'Last Purchase']].map(([v, l]) => <option key={v} value={v} style={{ background: '#141414' }}>{l}</option>)}
            </select>
          </div>
          <div ref={listScrollRef} className="space-y-1 max-h-[62vh] overflow-y-auto dark-scroll px-1 py-1 -mx-1">
            {/* Issue 8 (cross-module review) — this tab had no loading skeleton at all while
                its own sibling, Suppliers → Performance, already does (same `loading` state,
                same call site). Matches that skeleton's shape (6 rows, animate-pulse). */}
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-xl animate-pulse">
                  <span className="w-8 h-8 rounded-full flex-shrink-0" style={{ background: 'rgba(var(--fg-rgb),0.06)' }} />
                  <span className="flex-1 space-y-1.5">
                    <span className="block h-3 rounded" style={{ background: 'rgba(var(--fg-rgb),0.06)', width: `${55 + (i % 3) * 10}%` }} />
                    <span className="block h-2.5 rounded w-1/3" style={{ background: 'rgba(var(--fg-rgb),0.05)' }} />
                  </span>
                </div>
              ))
            ) : listPaged.map((s) => {
              const ss = statsOf(s);
              const on = selected?.id === s.id;
              const out = outstandingOf(s);
              const blocked = s.status === 'Blocked' || s.blocked;
              const pref = s.preferred || s.isPreferred;
              const dot = blocked ? '#f87171' : out > 0 ? '#fb923c' : pref ? '#60a5fa' : '#34d399';
              const lp = lastPurchaseOf(s);
              return (
                <button key={s.id} onClick={() => setSelId(s.id)} className={`w-full text-left p-2.5 rounded-xl flex items-center gap-2.5 transition-all duration-200 ${on ? 'bg-[#d4af37]/12 -translate-y-px' : 'hover:bg-white/5 border border-transparent'}`} style={on ? { border: '1px solid rgba(212,175,55,0.55)', boxShadow: '0 0 0 3px rgba(212,175,55,0.12), 0 6px 16px rgba(212,175,55,0.10)' } : undefined}>
                  <span className="relative w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: 'rgba(212,175,55,0.15)', color: '#d4af37' }}>
                    {(s.name || '?')[0].toUpperCase()}
                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2" style={{ background: dot, borderColor: 'var(--surface-1)' }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold text-white/90 truncate">{s.name}</span>
                      {pref && <span className="text-[8px] font-bold px-1 py-0.5 rounded text-[#d4af37]" style={{ background: 'rgba(212,175,55,0.15)' }}>PREF</span>}
                    </span>
                    <span className="block text-[10px] text-white/45 truncate">{[codeOf(s), s.city, s.type].filter(Boolean).join(' · ')}</span>
                    <span className="flex items-center justify-between mt-0.5">
                      <span className="text-[9px] text-white/45">{ss.parts} parts{ss.pos ? ` · ${ss.pos} PO` : ''}{lp ? ` · ${new Date(lp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : ''}</span>
                      {/* COLOR SYSTEM REVIEW: was orange — a THIRD different color for the
                          same "amount owed" concept that's danger/red in Billing's own
                          Outstanding KPI, the Reports Overview KPI row, and Supplier
                          Performance's own Outstanding tile. Aligned to match. */}
                      {out > 0 && <span className="text-[9px] font-bold" style={{ color: SEMANTIC.danger }}>{inr(out)}</span>}
                    </span>
                  </span>
                </button>
              );
            })}
            {!loading && listShown.length === 0 && (
              <div className="text-center py-8 px-3">
                <p className="text-xs text-white/45 mb-2">{t('suppliers.empty.noMatch', 'No suppliers match your current filters.')}</p>
                <button onClick={() => { setStatusF('All'); setListQ(''); }} className="text-xs font-semibold text-[#d4af37] hover:underline">Clear Filters</button>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between px-1 pt-2">
            <span className="text-[10px] text-white/45">{listShown.length ? (listPage - 1) * LIST_PER + 1 : 0}–{Math.min(listPage * LIST_PER, listShown.length)} of {listShown.length}</span>
            {listPageCount > 1 && (
              <div className="flex items-center gap-2">
                <button disabled={listPage <= 1} onClick={() => setListPage((p) => p - 1)} className="text-[11px] px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white/60 disabled:opacity-30">Prev</button>
                <span className="text-[10px] text-white/45">{listPage} / {listPageCount}</span>
                <button disabled={listPage >= listPageCount} onClick={() => setListPage((p) => p + 1)} className="text-[11px] px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white/60 disabled:opacity-30">Next</button>
              </div>
            )}
          </div>
        </div>
  );

  const centerContent = (
    <>
      {!selected ? (
          <div className="rounded-2xl p-10 sm:p-14 flex flex-col items-center text-center" style={card}>
            <span className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'rgba(212,175,55,0.12)' }}><Eye size={24} className="text-[#d4af37]" /></span>
            <h3 className="text-lg font-bold text-white mb-1">Select a Supplier</h3>
            <p className="text-sm text-white/50 mb-4">Choose a supplier from the list to view:</p>
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-white/45">
              <span>• Supplier Overview</span><span>• Parts Supplied</span><span>• Purchase Orders</span><span>• Transactions</span><span>• Notes</span>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl p-4 sm:p-5" style={card}>
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-3 pb-4" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-11 h-11 rounded-full flex items-center justify-center text-base font-bold flex-shrink-0" style={{ background: 'rgba(212,175,55,0.15)', color: '#d4af37' }}>{(selected.name || '?')[0].toUpperCase()}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-bold text-white truncate">{selected.name}</h2>
                    {(selected.preferred || selected.isPreferred) && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded text-[#d4af37]" style={{ background: 'rgba(212,175,55,0.15)' }}>PREFERRED</span>}
                    {selected.gst && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded text-emerald-400 flex items-center gap-0.5" style={{ background: 'rgba(52,211,153,0.12)' }}>✓ GST</span>}
                    {selected.status && selected.status !== 'Active' && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: selected.status === 'Blocked' ? 'rgba(248,113,113,0.15)' : 'rgba(156,163,175,0.15)', color: selected.status === 'Blocked' ? '#f87171' : '#9ca3af' }}>{selected.status.toUpperCase()}</span>}
                  </div>
                  <p className="text-[11px] text-white/45">{[codeOf(selected), selected.type, selected.city].filter(Boolean).join(' · ')}{selected.rating ? <span className="text-white/60"> · {Number(selected.rating).toFixed(1)} <Star size={10} className="inline text-[#d4af37]" fill="#d4af37" /></span> : null}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {waNum && <a href={`https://wa.me/91${waNum}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-white/70"><Phone size={14} /> {phoneOf(selected)} <MessageCircle size={14} className="text-emerald-400" /></a>}
                {canManage && <button onClick={() => onEdit?.(selected)} className="h-9 px-3 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 transition flex items-center gap-1.5"><Edit3 size={13} /> {t('suppliers.action.editSupplier', 'Edit Supplier')}</button>}
                <div className="relative">
                  <button ref={menuRef} onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen} className="w-9 h-9 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/70 hover:bg-white/10"><MoreVertical size={16} /></button>
                  {menuOpen && (
                    <ActionMenu anchorRef={menuRef} open onClose={() => setMenuOpen(false)} items={menuItems} />
                  )}
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mt-3 mb-4 overflow-x-auto dark-scroll">
              {TABS.map(([k, label]) => (
                <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${tab === k ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]' : 'text-white/55 hover:text-white/90 hover:bg-white/5'}`}>{label}</button>
              ))}
            </div>

            {tab === 'overview' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[[t('suppliers.kpi.totalParts', 'Total Parts'), st.parts, '#fff'], [t('suppliers.tab.purchaseOrders', 'Purchase Orders'), st.pos, '#fff'], [t('suppliers.kpi.stockValue', 'Stock Value'), inr(st.stockValue), '#34d399'], [t('inventory.kpi.lowStock', 'Low Stock'), st.low, '#fbbf24']].map(([l, v, c]) => (
                    <div key={l} className="rounded-xl p-3 min-w-0" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                      <p className="text-[10px] uppercase tracking-wide text-white/45 truncate">{l}</p>
                      <p className={`text-lg font-bold mt-0.5 tabular-nums truncate ${c === '#fff' ? 'text-white' : ''}`} style={c !== '#fff' ? { color: c } : undefined} title={String(v)}>{v}</p>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-xl p-3" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#d4af37] mb-2">{t('suppliers.section.businessInformation', 'Business Information')}</p>
                    <div className="space-y-1 text-[11px]">
                      {[['Contact Person', selected.contactPerson], ['Type', selected.type], ['Email', selected.email], ['WhatsApp', selected.whatsapp], ['GST', selected.gst || 'Non-GST supplier'], ['PAN', selected.pan], ['State', selected.state], ['City', selected.city], ['PIN', selected.pincode], ['Address', selected.address]].filter(([, v]) => v).map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2"><span className="text-white/45">{k}</span><span className="text-white/80 text-right truncate">{v}</span></div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl p-3" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#d4af37] mb-2">{t('suppliers.section.paymentTerms', 'Payment & Terms')}</p>
                    <div className="space-y-1 text-[11px]">
                      {[['Payment Mode', selected.paymentMode], ['Credit Days', selected.creditDays ? `${selected.creditDays} days` : ''], ['Opening Balance', selected.openingBalance ? inr(selected.openingBalance) : ''], ['Outstanding', outstandingOf(selected) ? inr(outstandingOf(selected)) : '₹0'], ['Account Holder', selected.accountHolder], ['Bank', selected.bankName], ['A/C No.', selected.accountNumber ? `••••${String(selected.accountNumber).slice(-4)}` : ''], ['IFSC', selected.ifsc], ['UPI', selected.upi]].filter(([, v]) => v).map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2"><span className="text-white/45">{k}</span><span className="text-white/80 text-right truncate">{v}</span></div>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-bold text-white mb-2">{t('suppliers.partsSupplied', 'Parts Supplied')} ({st.parts})</h3>
                  <PartsTable rows={selParts.slice(0, 6)} />
                  {st.parts > 6 && <button onClick={() => setTab('parts')} className="mt-2 mx-auto block text-xs font-semibold text-[#d4af37] hover:underline">View all {st.parts} parts</button>}
                </div>
              </div>
            )}

            {tab === 'parts' && (
              <div className="space-y-3">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/45" />
                  <input value={partsQ} onChange={(e) => { setPartsQ(e.target.value); setPartsPage(1); }} placeholder={t('suppliers.searchPartsPlaceholder', 'Search parts in this supplier…')} className="w-full pl-9 pr-3 py-2 rounded-xl text-sm bg-white/5 border border-white/10 text-white placeholder-white/30 outline-none focus:border-[#d4af37]/60" />
                </div>
                <PartsTable rows={partsPaged} />
                {partsPageCount > 1 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/45">{(partsPage - 1) * PARTS_PER + 1}–{Math.min(partsPage * PARTS_PER, selParts.length)} of {selParts.length}</span>
                    <div className="flex gap-1.5">
                      <button disabled={partsPage <= 1} onClick={() => setPartsPage((p) => p - 1)} className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/70 disabled:opacity-30">Prev</button>
                      <span className="px-2 py-1 text-white/60">{partsPage}/{partsPageCount}</span>
                      <button disabled={partsPage >= partsPageCount} onClick={() => setPartsPage((p) => p + 1)} className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/70 disabled:opacity-30">Next</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === 'pos' && (
              <div className="space-y-2">
                {selPos.length ? selPos.map((po) => (
                  <div key={po.id} className="flex items-center justify-between p-3 rounded-xl" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                    <div><p className="text-sm text-white/90 font-medium">{po.poNumber}</p><p className="text-[11px] text-white/45">{(po.items || []).length} items · {po.status}</p></div>
                    <span className="text-sm font-semibold text-[#d4af37]">{inr(po.total)}</span>
                  </div>
                )) : <p className="text-xs text-white/45 text-center py-8">No purchase orders for this supplier yet.</p>}
              </div>
            )}

            {tab === 'txns' && (
              <div className="space-y-2">
                {selTxns.length ? selTxns.map((r, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-xl" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                    <div><p className="text-sm text-white/90 font-medium">{r.partName || r.name || 'Stock received'}</p><p className="text-[11px] text-white/45">×{r.qty || r.quantity || 0}{r.poNumber ? ` · ${r.poNumber}` : ''}</p></div>
                    <span className="text-sm text-emerald-400">+{r.qty || r.quantity || 0}</span>
                  </div>
                )) : <p className="text-xs text-white/45 text-center py-8">No stock-in transactions recorded for this supplier.</p>}
              </div>
            )}

            {tab === 'notes' && (
              <div className="rounded-xl p-4 text-sm text-white/70 whitespace-pre-wrap" style={{ background: 'rgba(var(--fg-rgb),0.03)', minHeight: 80 }}>{selected.notes || <span className="text-white/45">No notes for this supplier.</span>}</div>
            )}
            {tab === 'docs' && (
              <p className="text-xs text-white/45 text-center py-10">Document attachments aren’t enabled yet.</p>
            )}
          </div>
        )}
    </>
  );

  // poPanel is a render function (see InventoryDashboard.js), called with the currently
  // selected supplier so the docked PO builder can switch into supplier-aware mode —
  // `selected` is null when nothing's picked, which is exactly the "general inventory"
  // mode the PO builder should fall back to.
  const rightContent = poPanel ? (
    <div className="xl:sticky xl:top-4" style={{ height: 'calc(100vh - 96px)' }}>{poPanel(selected)}</div>
  ) : null;

  return (
    <ResizablePanes
      left={{ ...PANE_BOUNDS.left, width: dirWidth, onWidthChange: setDirWidth, content: leftContent }}
      center={{ ...PANE_BOUNDS.center, content: centerContent }}
      right={{ ...PANE_BOUNDS.right, width: poWidth, onWidthChange: setPoWidth, content: rightContent, hidden: !poPanel }}
    />
  );
}
