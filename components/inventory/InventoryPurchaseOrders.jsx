// components/inventory/InventoryPurchaseOrders.jsx
// PHASE 1 — Purchase Orders lifecycle: pending → approved → received → cancelled.
// Fully functional in demo (in-memory). In production it reads/writes a new
// `purchaseOrders` collection and, on "received", increments stock. Test on a
// staging Firebase before trusting production writes.
import React, { useMemo, useState, useEffect, useRef } from 'react';
import Pagination from './Pagination';
import {
  ClipboardList, Plus, Check, PackageCheck, XCircle, Trash2, ChevronRight,
  IndianRupee, X, MessageCircle, ChevronDown, Search,
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
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

const STATUS = {
  draft: { label: 'Draft', color: '#9ca3af', bg: 'rgba(156,163,175,0.12)', border: 'rgba(156,163,175,0.3)' },
  pending: { label: 'Pending Approval', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },
  approved: { label: 'Approved', color: '#60a5fa', bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.3)' },
  sent: { label: 'Sent', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.3)' },
  partial: { label: 'Partially Received', color: '#22d3ee', bg: 'rgba(34,211,238,0.12)', border: 'rgba(34,211,238,0.3)' },
  received: { label: 'Completed', color: '#4ade80', bg: 'rgba(74,222,128,0.12)', border: 'rgba(74,222,128,0.3)' },
  cancelled: { label: 'Cancelled', color: '#f87171', bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.3)' },
};

export default function InventoryPurchaseOrders({
  purchaseOrders = [], suppliers = [], inventory = [], formatINR, canManage = false,
  onCreate, onAdvance, onCancel,
}) {
  const [filter, setFilter] = useState('all');
  const [creating, setCreating] = useState(false);
  const [poQ, setPoQ] = useState('');
  const [page, setPage] = useState(1);
  const PER = 20;
  useEffect(() => { setPage(1); }, [filter, poQ]);
  const inr = (n) => (typeof formatINR === 'function' ? formatINR(n) : `₹${Math.round(num(n)).toLocaleString('en-IN')}`);

  const counts = useMemo(() => {
    const c = { all: purchaseOrders.length, draft: 0, pending: 0, approved: 0, sent: 0, partial: 0, received: 0, cancelled: 0 };
    purchaseOrders.forEach((p) => { if (c[p.status] != null) c[p.status] += 1; });
    return c;
  }, [purchaseOrders]);

  const shown = useMemo(() => {
    let list = filter === 'all' ? purchaseOrders : purchaseOrders.filter((p) => p.status === filter);
    const q = poQ.trim().toLowerCase();
    if (q) list = list.filter((p) => [p.poNumber, p.supplierName, ...(p.items || []).flatMap((it) => [it.name, it.sku])].filter(Boolean).join(' ').toLowerCase().includes(q));
    return [...list].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  }, [purchaseOrders, filter, poQ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <ClipboardList size={18} className="text-[#d4af37]" />
          <h2 className="text-base font-bold text-white">Purchase orders</h2>
        </div>
        {canManage && (
          <button onClick={() => setCreating(true)} className="ml-auto flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] active:scale-95 transition">
            <Plus size={16} /> New PO
          </button>
        )}
      </div>

      {/* status filter */}
      <div className="relative mb-2">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
        <input value={poQ} onChange={(e) => setPoQ(e.target.value)} placeholder="Search PO number, supplier, part, SKU…" className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 text-white placeholder-white/30 outline-none focus:border-[#d4af37]/60" />
      </div>
      <div className="flex items-center gap-1 p-1 rounded-xl w-max max-w-full overflow-x-auto" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
        {[['all', 'All'], ['draft', 'Draft'], ['pending', 'Pending Approval'], ['approved', 'Approved'], ['sent', 'Sent'], ['partial', 'Partial'], ['received', 'Completed'], ['cancelled', 'Cancelled']].map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className={`px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition ${filter === k ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]' : 'text-white/60 hover:text-white/90 hover:bg-white/5'}`}>
            {label} <span className="opacity-60">{counts[k] || 0}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="p-12 flex flex-col items-center gap-3 text-center rounded-2xl" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
          <ClipboardList size={30} className="text-white/20" />
          <p className="text-sm text-white/40">{filter === 'all' ? 'No purchase orders yet. Create one to start tracking pending → received.' : `No ${filter} purchase orders.`}</p>
          {canManage && filter === 'all' && (
            <button onClick={() => setCreating(true)} className="mt-1 flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] active:scale-95 transition"><Plus size={16} /> Create your first PO</button>
          )}
        </div>
      ) : (
        <>
        <div className="space-y-2.5">
          {shown.slice((page - 1) * PER, page * PER).map((po) => {
            const st = STATUS[po.status] || STATUS.pending;
            return (
              <div key={po.id} className="rounded-2xl p-4 backdrop-blur-sm" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-[120px]">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">{po.poNumber}</span>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide" style={{ color: st.color, background: st.bg, border: `1px solid ${st.border}` }}>{st.label}</span>
                    </div>
                    <div className="text-[11px] text-white/45 mt-0.5">{po.supplierName || '—'}</div>
                  </div>
                  <div className="text-xs text-white/50">
                    {(po.items || []).length} item{(po.items || []).length === 1 ? '' : 's'} · <span className="text-emerald-400 font-semibold">{inr(po.total)}</span>
                  </div>
                  <div className="text-[11px] text-white/35 ml-auto text-right">
                    <div>Created {fmtDate(toMillis(po.createdAt))}</div>
                    {po.status === 'received' && <div className="text-emerald-400/70">Received {fmtDate(toMillis(po.receivedAt))}</div>}
                    {po.status === 'cancelled' && <div className="text-red-400/70">Cancelled {fmtDate(toMillis(po.cancelledAt))}</div>}
                  </div>
                </div>

                {/* items */}
                {(po.items || []).length > 0 && (
                  <div className="mt-3 pt-3 space-y-1" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.05)' }}>
                    {(po.items || []).map((it, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="flex-1 min-w-0 text-white/70 truncate">{it.name}</span>
                        <span className="text-white/40">{num(it.qty)} × {inr(it.unitCost)}</span>
                        <span className="text-white/60 w-20 text-right tabular-nums">{inr(num(it.qty) * num(it.unitCost))}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* actions */}
                {canManage && ['draft', 'pending', 'approved', 'sent', 'partial'].includes(po.status) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {po.status === 'draft' && (
                      <button onClick={() => onAdvance?.(po, 'pending')} className="h-9 px-3 rounded-lg flex items-center gap-1.5 text-xs font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 active:scale-95 transition"><Check size={13} /> Submit for approval</button>
                    )}
                    {po.status === 'pending' && (
                      <button onClick={() => onAdvance?.(po, 'approved')} className="h-9 px-3 rounded-lg flex items-center gap-1.5 text-xs font-bold bg-blue-500/15 text-blue-300 border border-blue-500/30 active:scale-95 transition"><Check size={13} /> Approve</button>
                    )}
                    {po.status === 'approved' && (
                      <button onClick={() => onAdvance?.(po, 'sent')} className="h-9 px-3 rounded-lg flex items-center gap-1.5 text-xs font-bold bg-violet-500/15 text-violet-300 border border-violet-500/30 active:scale-95 transition"><PackageCheck size={13} /> Send to supplier</button>
                    )}
                    {(po.status === 'sent' || po.status === 'partial' || po.status === 'approved') && (
                      <button onClick={() => onAdvance?.(po, 'received')} className="h-9 px-3 rounded-lg flex items-center gap-1.5 text-xs font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 active:scale-95 transition"><PackageCheck size={13} /> Mark received (+stock)</button>
                    )}
                    <button onClick={() => onCancel?.(po)} className="h-9 px-3 rounded-lg flex items-center gap-1.5 text-xs font-semibold bg-white/5 border border-white/10 text-white/60 hover:text-red-400 active:scale-95 transition"><XCircle size={13} /> Cancel</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <Pagination page={page} total={shown.length} perPage={PER} onPage={setPage} />
        </>
      )}

      {creating && (
        <POCreateForm
          suppliers={suppliers.filter((s) => !s.archived)}
          inventory={inventory.filter((p) => !p.archived)}
          formatINR={formatINR}
          onClose={() => setCreating(false)}
          onSubmit={async (payload) => { const ok = await onCreate?.(payload); if (ok !== false) setCreating(false); }}
        />
      )}
    </div>
  );
}

// Custom dark dropdown — replaces the native <select> whose option list the
// browser renders white. Matches the app theme, searchable, keyboard-navigable.
function DarkSelect({ value, onChange, options, placeholder = 'Select…' }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const ref = useRef(null);
  const selected = options.find((o) => o.value === value);
  const filtered = q.trim() ? options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase())) : options;
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQ(''); } };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const pick = (v) => { onChange(v); setOpen(false); setQ(''); };
  const onKey = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(filtered.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[hi]) pick(filtered[hi].value); }
    else if (e.key === 'Escape') { setOpen(false); setQ(''); }
  };
  return (
    <div ref={ref} className="relative" onKeyDown={onKey}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} className="w-full px-3 py-2.5 rounded-xl text-sm text-left flex items-center justify-between gap-2 bg-white/5 border border-white/10 text-white hover:bg-white/[0.07] focus:border-[#d4af37]/60 focus:outline-none transition">
        <span className={`truncate ${selected ? 'text-white' : 'text-white/40'}`}>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={16} className={`text-white/40 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-[120] mt-1 w-full rounded-xl overflow-hidden shadow-2xl" style={{ background: 'var(--surface-2)', border: '1px solid rgba(var(--fg-rgb),0.12)' }} role="listbox">
          {options.length > 6 && (
            <div className="p-1.5" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" />
                <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} placeholder="Search…" className="w-full pl-7 pr-2.5 py-1.5 rounded-lg text-sm bg-white/5 border border-white/10 text-white placeholder-white/30 outline-none focus:border-[#d4af37]/50" />
              </div>
            </div>
          )}
          <div className="max-h-56 overflow-y-auto py-1 dark-scroll">
            {filtered.length ? filtered.map((o, i) => (
              <button key={o.value} type="button" onMouseEnter={() => setHi(i)} onClick={() => pick(o.value)} role="option" aria-selected={o.value === value} className={`w-full text-left px-3 py-2 text-sm truncate transition ${o.value === value ? 'bg-[#d4af37]/15 text-[#d4af37] font-semibold' : i === hi ? 'bg-white/[0.06] text-white' : 'text-white/80'}`}>{o.label}</button>
            )) : <div className="px-3 py-3 text-xs text-white/35 text-center">No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function POCreateForm({ suppliers, inventory, formatINR, onClose, onSubmit }) {
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState('Normal');
  const [expectedDate, setExpectedDate] = useState('');
  const [lines, setLines] = useState([]);
  const [partPick, setPartPick] = useState('');
  const inr = (n) => (typeof formatINR === 'function' ? formatINR(n) : `₹${Math.round(num(n)).toLocaleString('en-IN')}`);

  const addLine = () => {
    const p = inventory.find((x) => x.id === partPick);
    if (!p) return;
    if (lines.some((l) => l.partId === p.id)) return;
    setLines((prev) => [...prev, { partId: p.id, name: p.name, sku: p.sku || '', qty: Math.max(1, num(p.minStock) - num(p.stock)) || 1, unitCost: num(p.purchasePrice) }]);
    setPartPick('');
  };
  const setLine = (id, key, val) => setLines((prev) => prev.map((l) => (l.partId === id ? { ...l, [key]: val } : l)));
  const removeLine = (id) => setLines((prev) => prev.filter((l) => l.partId !== id));
  const total = lines.reduce((s, l) => s + num(l.qty) * num(l.unitCost), 0);
  const supplier = suppliers.find((s) => s.id === supplierId);

  const fld = 'w-full px-3 py-2.5 rounded-xl text-sm outline-none bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-[#d4af37]/60 transition';

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl" style={{ background: 'var(--surface-3)', border: '1px solid rgba(var(--fg-rgb),0.1)' }} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between px-5 py-4" style={{ background: 'var(--surface-3)', borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
          <h3 className="text-base font-bold text-white">New purchase order</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-white/40 mb-1.5">Supplier</label>
            <DarkSelect
              value={supplierId}
              onChange={setSupplierId}
              placeholder="Select supplier…"
              options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider text-white/40 mb-1.5">Add parts</label>
            <div className="flex gap-2">
              <div className="flex-1"><DarkSelect
                value={partPick}
                onChange={setPartPick}
                placeholder="Pick a part…"
                options={inventory.map((p) => ({ value: p.id, label: `${p.name}${p.sku ? ` (${p.sku})` : ''}` }))}
              /></div>
              <button onClick={addLine} disabled={!partPick} className="h-[42px] px-4 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] active:scale-95 disabled:opacity-40 flex items-center gap-1"><Plus size={15} /></button>
            </div>
          </div>

          {lines.length > 0 && (
            <div className="space-y-2">
              {lines.map((l) => (
                <div key={l.partId} className="flex items-center gap-2 p-2 rounded-xl" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white/85 truncate">{l.name}</div>
                    <div className="text-[10px] text-white/35">{l.sku}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <input type="number" min="1" value={l.qty} onChange={(e) => setLine(l.partId, 'qty', e.target.value)} className="w-14 px-2 py-1.5 rounded-lg text-sm text-center bg-white/5 border border-white/10 text-white" title="Qty" />
                    <span className="text-white/30 text-xs">×</span>
                    <input type="number" min="0" value={l.unitCost} onChange={(e) => setLine(l.partId, 'unitCost', e.target.value)} className="w-20 px-2 py-1.5 rounded-lg text-sm text-center bg-white/5 border border-white/10 text-white" title="Unit cost" />
                  </div>
                  <button onClick={() => removeLine(l.partId)} className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-red-400 hover:bg-red-500/10"><Trash2 size={13} /></button>
                </div>
              ))}
              <div className="flex justify-end text-sm font-semibold text-white/80 pt-1">Total: <span className="text-emerald-400 ml-2">{inr(total)}</span></div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-white/40 mb-1.5">Expected date (optional)</label>
              <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className={fld} />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-white/40 mb-1.5">Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className={fld}>{['Normal', 'High', 'Urgent'].map((p) => <option key={p} style={{ background: '#141414' }}>{p}</option>)}</select>
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-white/40 mb-1.5">Notes (optional)</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. urgent" className={fld} />
            </div>
          </div>
        </div>
        <div className="sticky bottom-0 flex gap-2 px-5 py-4" style={{ background: 'var(--surface-3)', borderTop: '1px solid rgba(var(--fg-rgb),0.08)' }}>
          <button onClick={onClose} className="flex-1 h-11 rounded-xl text-sm font-semibold bg-white/5 border border-white/10 text-white/70 active:scale-95">Cancel</button>
          <button
            onClick={() => onSubmit?.({ supplierId: supplierId || null, supplierName: supplier?.name || '—', items: lines, notes, expectedDate, priority, status: 'draft' })}
            disabled={lines.length === 0}
            className="flex-1 h-11 rounded-xl text-sm font-semibold bg-white/5 border border-white/10 text-white/70 active:scale-95 disabled:opacity-40"
          >Save Draft</button>
          <button
            onClick={() => onSubmit?.({ supplierId: supplierId || null, supplierName: supplier?.name || '—', items: lines, notes, expectedDate, priority })}
            disabled={lines.length === 0}
            className="flex-1 h-11 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] active:scale-95 disabled:opacity-40"
          >Create PO</button>
        </div>
      </div>
    </div>
  );
}
