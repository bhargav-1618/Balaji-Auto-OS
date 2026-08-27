// components/inventory/InventoryStock.jsx
// PHASE 1 · Slice 3 — Stock page. One home for stock operations: receive/adjust
// entry points, a reorder queue, a live current-stock summary, and a full movement
// timeline (stock in/out/adjustments). Reuses existing data + handlers; no schema change.
//
// Issue 7.7/7.8/7.9 (Stock Operations review) — the movement timeline used to be a
// bespoke implementation (type-filter only, no search, no date range, rows not
// clickable) built from a LOSSY {t,dir,kind,name,qty,extra} shape that discarded
// partId/sku/supplier/reference/notes/etc. before they ever reached the UI. Two
// OTHER modules (the top-level Stock In / Stock Out tabs) already had full
// search+date-range+type-filter+clickable-detail via the shared LedgerPage/
// LedgerRow/LedgerDetailDrawer components — but those lived un-exported inside
// InventoryDashboard.js, so this file couldn't reuse them and grew a second,
// weaker implementation instead. Now genuinely shared: this timeline builds the
// same LedgerPage-shaped items (full record data preserved) and reuses
// LedgerRow/LedgerDetailDrawer/filterLedgerItems + the pure
// buildMovementDetailSections formatter from inventoryService.js.
import React, { useMemo, useState, useEffect } from 'react';
import Pagination from './Pagination';
import PageHeader from '../common/PageHeader';
import CapacityBanner from '../common/CapacityBanner';
import { LedgerRow, LedgerDetailDrawer, filterLedgerItems } from '../common/LedgerPage';
import { useDeferredSearch } from '../../lib/useSearch';
import { buildMovementDetailSections } from '../../services/inventoryService';
import { tsToDate } from '../../lib/format';
import {
  PackagePlus, PackageX, PackageSearch, RefreshCw, History, ArrowRight,
  IndianRupee, ArrowDownCircle, ArrowUpCircle, SlidersHorizontal, MessageCircle, Boxes, Search,
} from 'lucide-react';

const num = (v) => (Number.isFinite(+v) ? +v : 0);
const toMillis = (t) => tsToDate(t)?.getTime() || 0;
const dstr = (ms) => (ms ? new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');

function Card({ children, className = '' }) {
  return <div className={`rounded-2xl backdrop-blur-sm ${className}`} style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>{children}</div>;
}

export default function InventoryStock({
  inventory = [], sales = [], restocks = [], stockAdjustments = [], formatINR,
  onReceive, onAdjust, onReorder, onBulkReceive,
  // Issue 7.14 — Dashboard KPI drill-down: "Today's Stock In"/"Today's Stock Out"
  // navigate here and ask to pre-apply a type+date filter, so the user lands on
  // the exact filtered view the card described instead of an unfiltered timeline
  // they'd have to re-filter by hand.
  initialFilter, onInitialFilterHandled,
  demoMode = false, actorEmail, capacityRefreshTick = 0, onCleanupComplete,
}) {
  const [q, setQ] = useState('');
  // Universal Search review: this timeline merges up to ~3000 sales+restocks+adjustments
  // (see the file header) and had no debounce at all, unlike every other LedgerPage
  // consumer (StockInView/StockOutView get it for free via LedgerPage's own internal
  // useDeferredSearch — this file calls filterLedgerItems directly, bypassing that).
  const [dq] = useDeferredSearch(q);
  const [range, setRange] = useState('all');
  const [tab, setTab] = useState('all'); // all | in | out | adjust
  const [showArchived, setShowArchived] = useState(false);
  const [movePage, setMovePage] = useState(1);
  const MOVE_PER = 25;
  const [detail, setDetail] = useState(null);
  useEffect(() => { setMovePage(1); }, [tab, q, range]);
  useEffect(() => {
    if (!initialFilter) return;
    if (initialFilter.type) setTab(initialFilter.type);
    if (initialFilter.range) setRange(initialFilter.range);
    onInitialFilterHandled?.();
  }, [initialFilter, onInitialFilterHandled]);
  const inr = (n) => (typeof formatINR === 'function' ? formatINR(n) : `₹${Math.round(num(n)).toLocaleString('en-IN')}`);

  const summary = useMemo(() => {
    const active = inventory.filter((p) => !p.archived);
    const units = active.reduce((s, p) => s + num(p.stock), 0);
    const value = active.reduce((s, p) => s + num(p.stock) * num(p.sellingPrice), 0);
    const reorder = active
      .filter((p) => num(p.stock) === 0 || num(p.stock) <= num(p.minStock || 5))
      .sort((a, b) => num(a.stock) - num(b.stock));
    return { units, value, reorder };
  }, [inventory]);

  // Issue 7.6 — resolve a correction's `correctsId` to a readable label for its
  // own detail view ("Corrects: Damage -5 on 12 Aug"), same lookup the Adjust
  // Stock modal itself offers when creating the link.
  const correctsLabelFor = (id) => {
    const src = stockAdjustments.find((a) => a.id === id);
    if (!src) return null;
    const qtyAbs = Math.abs(src.qty ?? src.quantity ?? 0);
    const d = tsToDate(src.createdAt);
    return `${src.reason || 'Adjustment'} −${qtyAbs}${d ? ` · ${d.toLocaleDateString('en-IN')}` : ''}`;
  };

  // Issue 5 (capacity architecture extension) — restocks/stockAdjustments records that
  // have been archived via the capacity cleanup wizard leave the ACTIVE timeline by
  // default (same "archived records don't disappear, just aren't active" convention as
  // Billing/Job Cards/Purchase Orders), with a toggle to bring them back into view
  // instead of a whole separate page — this timeline is already a merge of 3 sources,
  // so a lightweight toggle reads more clearly here than a third set of tabs.
  const items = useMemo(() => {
    const out = [];
    sales.forEach((s) => {
      if (!s.partId) return; // labour/services never touch stock
      if (!showArchived && s.archived === true) return;
      const t = toMillis(s.soldAt || s.createdAt || s.date);
      if (!t) return;
      const qty = num(s.qty || s.quantity || 1);
      out.push({
        id: 's' + s.id, t, ty: 'Sale', qty: -qty, amount: num(s.price) * qty,
        s: `${s.partName || s.name || 'Part'} ${s.invoiceNo || ''} ${s.customer || ''}`,
        ids: [s.sku].filter(Boolean),
        row: <LedgerRow left={<span className="flex items-center gap-2"><ArrowUpCircle size={14} className="text-blue-400 flex-shrink-0" />{s.partName || s.name || 'Part'}</span>} sub={`${dstr(t)}${s.invoiceNo ? ` · ${s.invoiceNo}` : ''}`} right={<span className="text-blue-400">−{qty}</span>} />,
        sections: buildMovementDetailSections('out', s),
      });
    });
    restocks.forEach((r) => {
      if (!showArchived && r.archived === true) return;
      const t = toMillis(r.receivedAt || r.createdAt || r.date);
      if (!t) return;
      const qty = num(r.qty || r.quantity);
      out.push({
        id: 'r' + r.id, t, ty: 'Received', qty, amount: num(r.unitCost) * qty,
        s: `${r.name || r.partName || 'Part'} ${r.supplierName || r.supplier || ''} ${r.reference || ''} ${r.poNumber || ''}`,
        ids: [r.sku, r.reference, r.poNumber].filter(Boolean),
        row: <LedgerRow left={<span className="flex items-center gap-2"><ArrowDownCircle size={14} className="text-emerald-400 flex-shrink-0" />{r.name || r.partName || 'Part'}</span>} sub={`${dstr(t)} · ${r.supplierName || r.supplier || '—'}`} right={<span className="text-emerald-400">+{qty}</span>} />,
        sections: buildMovementDetailSections('in', r),
      });
    });
    stockAdjustments.forEach((a) => {
      if (!showArchived && a.archived === true) return;
      const t = toMillis(a.createdAt);
      if (!t) return;
      const signed = num(a.qty ?? a.quantity);
      const isCorrection = signed > 0;
      out.push({
        id: 'a' + a.id, t, ty: isCorrection ? 'Correction' : (a.reason || 'Adjustment'), qty: signed, amount: Math.abs(signed),
        s: `${a.name || a.partName || 'Part'} ${a.reason || ''} ${a.byEmail || ''}`,
        ids: [a.sku].filter(Boolean),
        row: <LedgerRow left={<span className="flex items-center gap-2"><SlidersHorizontal size={14} className="text-amber-400 flex-shrink-0" />{a.name || a.partName || 'Part'}</span>} sub={`${dstr(t)} · ${isCorrection ? 'Correction' : (a.reason || 'Adjustment')}`} right={<span className="text-amber-400">{signed > 0 ? '+' : ''}{signed}</span>} />,
        sections: buildMovementDetailSections('adjust', a, { correctsLabel: a.correctsId ? correctsLabelFor(a.correctsId) : null }),
      });
    });
    return out.sort((a, b) => b.t - a.t);
  }, [sales, restocks, stockAdjustments, showArchived]);

  const dirOf = (ty) => (ty === 'Sale' ? 'out' : ty === 'Received' ? 'in' : 'adjust');
  const tabFiltered = tab === 'all' ? items : items.filter((it) => dirOf(it.ty) === tab);
  const filtered = useMemo(() => filterLedgerItems(tabFiltered, { q: dq, range, sort: 'Newest' }), [tabFiltered, dq, range]);
  const shown = filtered.slice((movePage - 1) * MOVE_PER, movePage * MOVE_PER);

  const now = Date.now(); const days30 = 30 * 86400000;
  const recent = items.filter((x) => now - x.t < days30).length;

  const fld = 'px-2.5 py-2 rounded-lg text-xs outline-none bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60';

  return (
    <PageHeader title="Stock" icon={Boxes}>
      {/* Issue 5 — Inventory Movement History capacity. The timeline above merges THREE
          independently-capped collections (restocks/"Stock In", stockAdjustments/
          "Stock Out via adjustment", sales — sales already has its own banner+guard on
          the Sales/Services views since it's created by Billing, not here). Rather than
          inventing a combined virtual "movement" capacity pool — which would require a
          new engine just for this screen, exactly what the brief says not to build —
          this surfaces the SAME two banners the universal capacity system already
          produces for restocks/stockAdjustments, right where movements are created and
          reviewed. Each stays independently accurate to its own real Firestore collection. */}
      <CapacityBanner moduleKey="restocks" demoMode={demoMode} actorEmail={actorEmail} refreshKey={`${restocks.length}-${capacityRefreshTick}`} className="mb-3" onCleanupComplete={onCleanupComplete} />
      <CapacityBanner moduleKey="stockAdjustments" demoMode={demoMode} actorEmail={actorEmail} refreshKey={`${stockAdjustments.length}-${capacityRefreshTick}`} className="mb-3" onCleanupComplete={onCleanupComplete} />
      {/* summary + quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-1"><span className="text-[10px] uppercase tracking-wider text-white/45">Units in stock</span><PackageSearch size={14} className="text-[#d4af37]" /></div>
          <div className="text-xl font-bold text-white">{summary.units.toLocaleString('en-IN')}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between mb-1"><span className="text-[10px] uppercase tracking-wider text-white/45">Stock value</span><IndianRupee size={14} className="text-emerald-400" /></div>
          <div className="text-xl font-bold text-emerald-400">{inr(summary.value)}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between mb-1"><span className="text-[10px] uppercase tracking-wider text-white/45">Movements · 30d</span><History size={14} className="text-blue-400" /></div>
          <div className="text-xl font-bold text-blue-400">{recent}</div>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        {typeof onReceive === 'function' && (
          <button onClick={onReceive} className="flex items-center gap-2 h-11 px-4 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] hover:brightness-110 active:scale-95 transition"><PackagePlus size={16} /> Receive Stock</button>
        )}
        {/* Issue 7.12 — receiving 40 different items one at a time is impractical
            for a real shipment; this opens the shipment-level form (one supplier/
            invoice/date, many part lines) instead of repeating the single-item flow. */}
        {typeof onBulkReceive === 'function' && (
          <button onClick={onBulkReceive} className="flex items-center gap-2 h-11 px-4 rounded-xl text-sm font-semibold bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 active:scale-95 transition"><Boxes size={16} /> Receive Shipment</button>
        )}
        {typeof onAdjust === 'function' && (
          <button onClick={onAdjust} className="flex items-center gap-2 h-11 px-4 rounded-xl text-sm font-semibold bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 active:scale-95 transition"><SlidersHorizontal size={16} /> Adjust Stock</button>
        )}
      </div>

      {/* reorder queue */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2"><RefreshCw size={15} className="text-[#fb923c]" /><h3 className="text-sm font-bold text-white/90">Reorder queue</h3><span className="text-xs text-white/45">({summary.reorder.length})</span></div>
        </div>
        {summary.reorder.length ? (
          <div className="space-y-1.5">
            {summary.reorder.slice(0, 8).map((p) => (
              <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.04] transition">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${num(p.stock) === 0 ? 'bg-red-500' : 'bg-amber-500'}`} />
                <span className="flex-1 min-w-0 text-sm text-white/80 truncate">{p.name}</span>
                <span className={`text-xs font-semibold ${num(p.stock) === 0 ? 'text-red-400' : 'text-amber-400'}`}>{num(p.stock)} / {num(p.minStock || 5)}</span>
                {typeof onReorder === 'function' && (
                  <button onClick={() => onReorder(p)} className="h-8 px-2.5 rounded-lg flex items-center gap-1 text-[11px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 active:scale-95" title="Reorder"><MessageCircle size={12} /> Reorder</button>
                )}
                {typeof onReceive === 'function' && (
                  <button onClick={() => onReceive(p)} className="h-8 px-2.5 rounded-lg flex items-center gap-1 text-[11px] font-semibold bg-white/5 border border-white/10 text-white/70 active:scale-95"><PackagePlus size={12} /> Receive</button>
                )}
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-white/45 py-6 text-center">Nothing needs reordering right now.</p>}
      </Card>

      {/* movement timeline */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2"><History size={15} className="text-[#d4af37]" /><h3 className="text-sm font-bold text-white/90">Movement timeline</h3></div>
          <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ background: 'rgba(var(--fg-rgb),0.04)' }}>
            {[{ k: 'all', label: 'All' }, { k: 'in', label: 'In' }, { k: 'out', label: 'Out' }, { k: 'adjust', label: 'Adjust' }].map((t) => (
              <button key={t.k} onClick={() => setTab(t.k)} className={`px-3 py-1 rounded-md text-xs font-semibold transition ${tab === t.k ? 'bg-[#d4af37] text-black' : 'text-white/50 hover:text-white/80'}`}>{t.label}</button>
            ))}
          </div>
        </div>
        {/* Issue 7.8/7.9 — search by part/SKU/user/supplier/reference + date range,
            same filterLedgerItems the Stock In/Stock Out tabs already use. */}
        <div className="flex flex-wrap gap-2 mb-3">
          <div className="relative flex-1 min-w-[160px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/45" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search part, SKU, supplier, reference…" className={`${fld} w-full pl-8`} />
          </div>
          <select value={range} onChange={(e) => setRange(e.target.value)} className={fld}>
            <option value="all" className="bg-[#111]">All time</option>
            <option value="today" className="bg-[#111]">Today</option>
            <option value="yesterday" className="bg-[#111]">Yesterday</option>
            <option value="thisweek" className="bg-[#111]">This week</option>
            <option value="thismonth" className="bg-[#111]">This month</option>
            <option value="7d" className="bg-[#111]">Last 7 days</option>
            <option value="30d" className="bg-[#111]">Last 30 days</option>
          </select>
          {/* Archived movements (freed via capacity cleanup) stay findable, not gone —
              off by default so the day-to-day timeline stays the active-only view. */}
          <label className="flex items-center gap-1.5 px-2.5 h-9 rounded-lg text-xs text-white/60 cursor-pointer" style={{ background: 'rgba(var(--fg-rgb),0.04)' }}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-[#d4af37]" /> Show archived
          </label>
        </div>
        {shown.length ? (
          <div className="space-y-1.5">
            {shown.map((it) => <button key={it.id} onClick={() => setDetail(it)} className="w-full text-left">{it.row}</button>)}
          </div>
        ) : <p className="text-xs text-white/45 py-6 text-center">No stock movements match your filters.</p>}
        {filtered.length > MOVE_PER && <Pagination page={movePage} total={filtered.length} perPage={MOVE_PER} onPage={setMovePage} />}
      </Card>

      <LedgerDetailDrawer title="Movement" icon={History} detail={detail} onClose={() => setDetail(null)} />
    </PageHeader>
  );
}
