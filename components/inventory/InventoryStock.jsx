// components/inventory/InventoryStock.jsx
// PHASE 1 · Slice 3 — Stock page. One home for stock operations: receive/adjust
// entry points, a reorder queue, a live current-stock summary, and a full movement
// timeline (stock in/out/adjustments). Reuses existing data + handlers; no schema change.
import React, { useMemo, useState, useEffect } from 'react';
import Pagination from './Pagination';
import {
  PackagePlus, PackageX, PackageSearch, RefreshCw, History, ArrowRight,
  IndianRupee, ArrowDownCircle, ArrowUpCircle, SlidersHorizontal, MessageCircle,
} from 'lucide-react';

const num = (v) => (Number.isFinite(+v) ? +v : 0);
const toMillis = (t) => {
  if (!t) return 0;
  if (typeof t === 'number') return t < 1e12 ? t * 1000 : t;
  if (typeof t?.toMillis === 'function') return t.toMillis();
  if (t?.seconds) return t.seconds * 1000;
  const p = Date.parse(t);
  return Number.isNaN(p) ? 0 : p;
};
const fmtDateTime = (ms) => (ms ? new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');

function Card({ children, className = '' }) {
  return <div className={`rounded-2xl backdrop-blur-sm ${className}`} style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>{children}</div>;
}

export default function InventoryStock({
  inventory = [], sales = [], restocks = [], stockAdjustments = [], formatINR,
  onReceive, onAdjust, onReorder, onOpenLedger,
}) {
  const [tab, setTab] = useState('all'); // all | in | out | adjust
  const [movePage, setMovePage] = useState(1);
  const MOVE_PER = 25;
  useEffect(() => { setMovePage(1); }, [tab]);
  const inr = (n) => (typeof formatINR === 'function' ? formatINR(n) : `₹${Math.round(num(n)).toLocaleString('en-IN')}`);

  const data = useMemo(() => {
    const active = inventory.filter((p) => !p.archived);
    const units = active.reduce((s, p) => s + num(p.stock), 0);
    const value = active.reduce((s, p) => s + num(p.stock) * num(p.sellingPrice), 0);
    const reorder = active
      .filter((p) => num(p.stock) === 0 || num(p.stock) <= num(p.minStock || 5))
      .sort((a, b) => num(a.stock) - num(b.stock));

    const moves = [];
    sales.forEach((s) => moves.push({ t: toMillis(s.soldAt || s.createdAt || s.date), dir: 'out', kind: 'Sale', name: s.partName || 'Part', qty: num(s.qty || s.quantity || 1), extra: inr(num(s.price) * num(s.qty || s.quantity || 1)) }));
    restocks.forEach((r) => moves.push({ t: toMillis(r.receivedAt || r.createdAt || r.date), dir: 'in', kind: 'Received', name: r.partName || 'Part', qty: num(r.qty || r.quantity), extra: r.supplierName || '' }));
    stockAdjustments.forEach((a) => moves.push({ t: toMillis(a.adjustedAt || a.createdAt || a.date), dir: 'adjust', kind: a.reason || 'Adjustment', name: a.partName || 'Part', qty: num(a.qty || a.quantity), extra: a.direction === 'correction' ? 'correction' : 'reduction' }));
    const timeline = moves.filter((x) => x.t).sort((a, b) => b.t - a.t);

    const now = Date.now(); const days30 = 30 * 86400000;
    const recent = timeline.filter((x) => now - x.t < days30).length;
    return { units, value, reorder, timeline, recent };
  }, [inventory, sales, restocks, stockAdjustments]);

  const filteredMoves = data.timeline.filter((m) => tab === 'all' || (tab === 'in' && m.dir === 'in') || (tab === 'out' && m.dir === 'out') || (tab === 'adjust' && m.dir === 'adjust'));
  const shown = filteredMoves.slice((movePage - 1) * MOVE_PER, movePage * MOVE_PER);

  return (
    <div className="space-y-4">
      {/* summary + quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-1"><span className="text-[10px] uppercase tracking-wider text-white/40">Units in stock</span><PackageSearch size={14} className="text-[#d4af37]" /></div>
          <div className="text-xl font-bold text-white">{data.units.toLocaleString('en-IN')}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between mb-1"><span className="text-[10px] uppercase tracking-wider text-white/40">Stock value</span><IndianRupee size={14} className="text-emerald-400" /></div>
          <div className="text-xl font-bold text-emerald-400">{inr(data.value)}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between mb-1"><span className="text-[10px] uppercase tracking-wider text-white/40">Movements · 30d</span><History size={14} className="text-blue-400" /></div>
          <div className="text-xl font-bold text-blue-400">{data.recent}</div>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        {typeof onReceive === 'function' && (
          <button onClick={onReceive} className="flex items-center gap-2 h-11 px-4 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] hover:brightness-110 active:scale-95 transition"><PackagePlus size={16} /> Receive Stock</button>
        )}
        {typeof onAdjust === 'function' && (
          <button onClick={onAdjust} className="flex items-center gap-2 h-11 px-4 rounded-xl text-sm font-semibold bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 active:scale-95 transition"><SlidersHorizontal size={16} /> Adjust Stock</button>
        )}
      </div>

      {/* reorder queue */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2"><RefreshCw size={15} className="text-[#fb923c]" /><h3 className="text-sm font-bold text-white/90">Reorder queue</h3><span className="text-xs text-white/40">({data.reorder.length})</span></div>
        </div>
        {data.reorder.length ? (
          <div className="space-y-1.5">
            {data.reorder.slice(0, 8).map((p) => (
              <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.04] transition">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${num(p.stock) === 0 ? 'bg-red-500' : 'bg-amber-500'}`} />
                <span className="flex-1 min-w-0 text-sm text-white/80 truncate">{p.name}</span>
                <span className={`text-xs font-semibold ${num(p.stock) === 0 ? 'text-red-400' : 'text-amber-400'}`}>{num(p.stock)} / {num(p.minStock || 5)}</span>
                {typeof onReorder === 'function' && (
                  <button onClick={() => onReorder(p)} className="h-8 px-2.5 rounded-lg flex items-center gap-1 text-[11px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 active:scale-95" title="WhatsApp reorder"><MessageCircle size={12} /> Reorder</button>
                )}
                {typeof onReceive === 'function' && (
                  <button onClick={() => onReceive(p)} className="h-8 px-2.5 rounded-lg flex items-center gap-1 text-[11px] font-semibold bg-white/5 border border-white/10 text-white/70 active:scale-95"><PackagePlus size={12} /> Receive</button>
                )}
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-white/35 py-6 text-center">Nothing needs reordering right now.</p>}
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
        {shown.length ? (
          <div className="space-y-1">
            {shown.map((m, i) => {
              const Icon = m.dir === 'in' ? ArrowDownCircle : m.dir === 'out' ? ArrowUpCircle : SlidersHorizontal;
              const col = m.dir === 'in' ? '#4ade80' : m.dir === 'out' ? '#60a5fa' : '#f59e0b';
              return (
                <div key={i} className="flex items-center gap-3 py-1.5">
                  <Icon size={15} style={{ color: col }} className="flex-shrink-0" />
                  <span className="flex-1 min-w-0 text-sm text-white/80 truncate">{m.name}</span>
                  <span className="text-xs text-white/40 hidden sm:inline">{m.kind}{m.extra ? ` · ${m.extra}` : ''}</span>
                  <span className="text-xs font-semibold tabular-nums" style={{ color: col }}>{m.dir === 'out' ? '−' : m.dir === 'in' ? '+' : '±'}{m.qty}</span>
                  <span className="text-[11px] text-white/30 w-24 text-right hidden sm:block">{fmtDateTime(m.t)}</span>
                </div>
              );
            })}
          </div>
        ) : <p className="text-xs text-white/35 py-6 text-center">No stock movements recorded yet.</p>}
        {filteredMoves.length > MOVE_PER && <Pagination page={movePage} total={filteredMoves.length} perPage={MOVE_PER} onPage={setMovePage} />}
      </Card>
    </div>
  );
}
