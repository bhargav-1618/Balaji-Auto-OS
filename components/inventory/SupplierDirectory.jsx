// components/inventory/SupplierDirectory.jsx
// Master–detail Supplier Directory (ERP style): left supplier list, center detail
// panel with tabs + summary + parts table, right docked PO builder (passed in).
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { num } from '../../lib/format';
import {
  Search, Phone, Star, Edit3, MoreVertical, Eye, Plus, ClipboardList,
  ArrowLeftRight, Archive, Trash2, ChevronDown, MessageCircle,
} from 'lucide-react';


export default function SupplierDirectory({
  suppliers = [], inventory = [], purchaseOrders = [], restocks = [], formatINR,
  canManage = false, onEdit, onArchive, onDelete, onAddPart, onJumpToPart, poPanel,
}) {
  const inr = (n) => (typeof formatINR === 'function' ? formatINR(n) : `₹${Math.round(num(n)).toLocaleString('en-IN')}`);
  const active = useMemo(() => suppliers.filter((s) => !s.archived), [suppliers]);
  const [listQ, setListQ] = useState('');
  const [selId, setSelId] = useState(null);
  const [tab, setTab] = useState('overview');
  const [partsQ, setPartsQ] = useState('');
  const [partsPage, setPartsPage] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [statusF, setStatusF] = useState('All');
  const [sortBy, setSortBy] = useState('recent');
  const [listPage, setListPage] = useState(1);
  const LIST_PER = 12;
  const menuRef = useRef(null);
  const PARTS_PER = 8;

  const outstandingOf = (s) => num(s.outstanding) || 0;
  const lastPurchaseOf = (s) => {
    const rs = restocks.filter((r) => (r.supplierName || '') === s.name);
    const t = Math.max(0, ...rs.map((r) => (r.receivedAt?.toMillis?.() || r.createdAt?.toMillis?.() || 0)));
    return t || 0;
  };

  const listShown = useMemo(() => {
    const q = listQ.trim().toLowerCase();
    let list = active.filter((s) => {
      if (statusF === 'Preferred' && !(s.preferred || s.isPreferred)) return false;
      if (statusF === 'Active' && (s.status && s.status !== 'Active')) return false;
      if (statusF === 'Inactive' && s.status !== 'Inactive') return false;
      if (statusF === 'Blocked' && s.status !== 'Blocked' && !s.blocked) return false;
      if (statusF === 'Outstanding' && outstandingOf(s) <= 0) return false;
      return true;
    });
    if (q) list = list.filter((s) => [s.name, ...(s.altNames || []), s.code, s.city, s.type, s.gst, (s.phoneNumbers?.[0]?.number || s.phone || '')].filter(Boolean).join(' ').toLowerCase().includes(q));
    const sorters = {
      recent: (a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0),
      name: (a, b) => (a.name || '').localeCompare(b.name || ''),
      city: (a, b) => (a.city || '').localeCompare(b.city || ''),
      rating: (a, b) => num(b.rating) - num(a.rating),
      outstanding: (a, b) => outstandingOf(b) - outstandingOf(a),
      lastPurchase: (a, b) => lastPurchaseOf(b) - lastPurchaseOf(a),
    };
    return [...list].sort(sorters[sortBy] || sorters.recent);
  }, [active, listQ, statusF, sortBy, restocks]);

  const listPaged = useMemo(() => listShown.slice((listPage - 1) * LIST_PER, listPage * LIST_PER), [listShown, listPage]);
  const listPageCount = Math.max(1, Math.ceil(listShown.length / LIST_PER));
  useEffect(() => { setListPage(1); }, [listQ, statusF, sortBy]);

  const selected = useMemo(() => (selId ? active.find((s) => s.id === selId) || null : null), [active, selId]);

  useEffect(() => { setTab('overview'); setPartsQ(''); setPartsPage(1); setMenuOpen(false); }, [selected?.id]);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDoc = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

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

  const selParts = useMemo(() => {
    if (!selected) return [];
    const q = partsQ.trim().toLowerCase();
    let list = partsOf(selected);
    if (q) list = list.filter((p) => [p.name, p.sku, p.category, p.vehicle, ...(p.compatibleCars || [])].filter(Boolean).join(' ').toLowerCase().includes(q));
    return list;
  }, [selected, partsQ, inventory]);

  const selPos = useMemo(() => (selected ? purchaseOrders.filter((po) => po.supplierId === selected.id) : []), [selected, purchaseOrders]);
  const selTxns = useMemo(() => (selected ? restocks.filter((r) => (r.supplierName || '') === selected.name).slice(0, 50) : []), [selected, restocks]);

  const st = selected ? statsOf(selected) : null;
  const waNum = String(phoneOf(selected)).replace(/\D/g, '').slice(-10);

  const menuItems = [
    canManage && { label: 'Add New Part', icon: Plus, on: () => { onAddPart?.(); setMenuOpen(false); } },
    { label: 'Purchase History', icon: ClipboardList, on: () => { setTab('pos'); setMenuOpen(false); } },
    { label: 'Transactions', icon: ArrowLeftRight, on: () => { setTab('txns'); setMenuOpen(false); } },
    canManage && { label: 'Archive Supplier', icon: Archive, on: () => { onArchive?.(selected); setMenuOpen(false); } },
    canManage && { label: 'Delete Supplier', icon: Trash2, danger: true, on: () => { onDelete?.(selected); setMenuOpen(false); } },
  ].filter(Boolean);

  const TABS = [
    ['overview', 'Overview'], ['parts', `Parts (${st?.parts || 0})`], ['pos', `Purchase Orders (${selPos.length})`],
    ['txns', `Transactions (${selTxns.length})`], ['notes', 'Notes'], ['docs', 'Documents'],
  ];

  const card = { background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' };
  const partsPaged = selParts.slice((partsPage - 1) * PARTS_PER, partsPage * PARTS_PER);
  const partsPageCount = Math.max(1, Math.ceil(selParts.length / PARTS_PER));

  const PartsTable = ({ rows }) => (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm min-w-[520px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-white/40" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
            <th className="text-left font-semibold py-2 px-2">Part / Vehicle</th>
            <th className="text-left font-semibold py-2 px-2">Category</th>
            <th className="text-center font-semibold py-2 px-2">Stock</th>
            <th className="text-center font-semibold py-2 px-2">Min</th>
            <th className="text-right font-semibold py-2 px-2">Price</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const low = num(p.stock) > 0 && num(p.stock) <= num(p.minStock || 5);
            const out = num(p.stock) === 0;
            return (
              <tr key={p.id} className="transition hover:bg-white/[0.03] cursor-pointer" onClick={() => onJumpToPart?.(p.id, p.name)} title="Open in Inventory" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.05)' }}>
                <td className="py-2.5 px-2">
                  <p className="text-white/90 font-medium">{p.name}</p>
                  <p className="text-[11px] text-white/40">{[p.vehicle, p.sku].filter(Boolean).join(' · ')}</p>
                </td>
                <td className="py-2.5 px-2 text-white/60">{p.category || '—'}</td>
                <td className="py-2.5 px-2 text-center">
                  <span className={`font-semibold ${out ? 'text-red-400' : low ? 'text-amber-400' : 'text-white/85'}`}>{num(p.stock)}</span>
                  {low && <p className="text-[10px] text-amber-400/80">Min: {p.minStock || 5}</p>}
                </td>
                <td className="py-2.5 px-2 text-center text-white/50">{p.minStock || 5}</td>
                <td className="py-2.5 px-2 text-right text-white/85">{inr(p.sellingPrice || p.purchasePrice || 0)}</td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-white/35 text-xs">No parts.</td></tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="xl:flex xl:gap-4 xl:items-start">
      {/* LEFT — supplier list */}
      <div className="xl:w-[272px] xl:flex-shrink-0 mb-4 xl:mb-0">
        <div className="rounded-2xl p-2" style={card}>
          <div className="relative mb-2">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input value={listQ} onChange={(e) => setListQ(e.target.value)} placeholder="Search name, code, city, GST…" className="w-full pl-9 pr-3 py-2 rounded-xl text-sm bg-white/5 border border-white/10 text-white placeholder-white/30 outline-none focus:border-[#d4af37]/60" />
          </div>
          <div className="flex gap-1.5 mb-2 overflow-x-auto dark-scroll">
            {['All', 'Active', 'Preferred', 'Inactive', 'Blocked', 'Outstanding'].map((f) => (
              <button key={f} onClick={() => setStatusF(f)} className={`px-2 py-1 rounded-lg text-[10px] font-semibold whitespace-nowrap transition ${statusF === f ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]' : 'text-white/55 bg-white/5 border border-white/10'}`}>{f}</button>
            ))}
          </div>
          <div className="flex items-center justify-between mb-1.5 px-1">
            <p className="text-[11px] text-white/40">{listShown.length} suppliers</p>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="px-1.5 py-0.5 rounded-md text-[10px] bg-white/5 border border-white/10 text-white/70 outline-none">
              {[['recent', 'Recently Added'], ['name', 'A–Z'], ['city', 'City'], ['rating', 'Rating'], ['outstanding', 'Outstanding'], ['lastPurchase', 'Last Purchase']].map(([v, l]) => <option key={v} value={v} style={{ background: '#141414' }}>{l}</option>)}
            </select>
          </div>
          <div className="space-y-1 max-h-[62vh] overflow-y-auto dark-scroll">
            {listPaged.map((s) => {
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
                    <span className="block text-[10px] text-white/40 truncate">{[codeOf(s), s.city, s.type].filter(Boolean).join(' · ')}</span>
                    <span className="flex items-center justify-between mt-0.5">
                      <span className="text-[9px] text-white/35">{ss.parts} parts{ss.pos ? ` · ${ss.pos} PO` : ''}{lp ? ` · ${new Date(lp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : ''}</span>
                      {out > 0 && <span className="text-[9px] font-bold" style={{ color: '#fb923c' }}>{inr(out)}</span>}
                    </span>
                  </span>
                </button>
              );
            })}
            {listShown.length === 0 && <p className="text-xs text-white/35 text-center py-6">No suppliers match.</p>}
          </div>
          <div className="flex items-center justify-between px-1 pt-2">
            <span className="text-[10px] text-white/40">{listShown.length ? (listPage - 1) * LIST_PER + 1 : 0}–{Math.min(listPage * LIST_PER, listShown.length)} of {listShown.length}</span>
            {listPageCount > 1 && (
              <div className="flex items-center gap-2">
                <button disabled={listPage <= 1} onClick={() => setListPage((p) => p - 1)} className="text-[11px] px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white/60 disabled:opacity-30">Prev</button>
                <span className="text-[10px] text-white/40">{listPage} / {listPageCount}</span>
                <button disabled={listPage >= listPageCount} onClick={() => setListPage((p) => p + 1)} className="text-[11px] px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white/60 disabled:opacity-30">Next</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* CENTER — detail */}
      <div className="xl:flex-1 xl:min-w-0 mb-4 xl:mb-0">
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
                {canManage && <button onClick={() => onEdit?.(selected)} className="h-9 px-3 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 transition flex items-center gap-1.5"><Edit3 size={13} /> Edit Supplier</button>}
                <div className="relative" ref={menuRef}>
                  <button onClick={() => setMenuOpen((o) => !o)} className="w-9 h-9 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/70 hover:bg-white/10"><MoreVertical size={16} /></button>
                  {menuOpen && (
                    <div className="absolute right-0 mt-1 z-30 w-48 rounded-xl p-1 shadow-2xl" style={{ background: 'var(--surface-1)', border: '1px solid rgba(var(--fg-rgb),0.12)' }}>
                      {menuItems.map((m) => (
                        <button key={m.label} onClick={m.on} className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition ${m.danger ? 'text-red-400 hover:bg-red-500/10' : 'text-white/75 hover:bg-white/5'}`}><m.icon size={14} /> {m.label}</button>
                      ))}
                    </div>
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
                  {[['Total Parts', st.parts, '#fff'], ['Purchase Orders', st.pos, '#fff'], ['Stock Value', inr(st.stockValue), '#34d399'], ['Low Stock', st.low, '#fbbf24']].map(([l, v, c]) => (
                    <div key={l} className="rounded-xl p-3" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                      <p className="text-[10px] uppercase tracking-wide text-white/40">{l}</p>
                      <p className={`text-lg font-bold mt-0.5 ${c === '#fff' ? 'text-white' : ''}`} style={c !== '#fff' ? { color: c } : undefined}>{v}</p>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-xl p-3" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#d4af37] mb-2">Business Information</p>
                    <div className="space-y-1 text-[11px]">
                      {[['Contact Person', selected.contactPerson], ['Type', selected.type], ['Email', selected.email], ['WhatsApp', selected.whatsapp], ['GST', selected.gst || 'Non-GST supplier'], ['PAN', selected.pan], ['State', selected.state], ['City', selected.city], ['PIN', selected.pincode], ['Address', selected.address]].filter(([, v]) => v).map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2"><span className="text-white/40">{k}</span><span className="text-white/80 text-right truncate">{v}</span></div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl p-3" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#d4af37] mb-2">Payment & Terms</p>
                    <div className="space-y-1 text-[11px]">
                      {[['Payment Mode', selected.paymentMode], ['Credit Days', selected.creditDays ? `${selected.creditDays} days` : ''], ['Opening Balance', selected.openingBalance ? inr(selected.openingBalance) : ''], ['Outstanding', outstandingOf(selected) ? inr(outstandingOf(selected)) : '₹0'], ['Account Holder', selected.accountHolder], ['Bank', selected.bankName], ['A/C No.', selected.accountNumber ? `••••${String(selected.accountNumber).slice(-4)}` : ''], ['IFSC', selected.ifsc], ['UPI', selected.upi]].filter(([, v]) => v).map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2"><span className="text-white/40">{k}</span><span className="text-white/80 text-right truncate">{v}</span></div>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-bold text-white mb-2">Parts Supplied ({st.parts})</h3>
                  <PartsTable rows={selParts.slice(0, 6)} />
                  {st.parts > 6 && <button onClick={() => setTab('parts')} className="mt-2 mx-auto block text-xs font-semibold text-[#d4af37] hover:underline">View all {st.parts} parts</button>}
                </div>
              </div>
            )}

            {tab === 'parts' && (
              <div className="space-y-3">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                  <input value={partsQ} onChange={(e) => { setPartsQ(e.target.value); setPartsPage(1); }} placeholder="Search parts in this supplier…" className="w-full pl-9 pr-3 py-2 rounded-xl text-sm bg-white/5 border border-white/10 text-white placeholder-white/30 outline-none focus:border-[#d4af37]/60" />
                </div>
                <PartsTable rows={partsPaged} />
                {partsPageCount > 1 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/40">{(partsPage - 1) * PARTS_PER + 1}–{Math.min(partsPage * PARTS_PER, selParts.length)} of {selParts.length}</span>
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
                    <div><p className="text-sm text-white/90 font-medium">{po.poNumber}</p><p className="text-[11px] text-white/40">{(po.items || []).length} items · {po.status}</p></div>
                    <span className="text-sm font-semibold text-[#d4af37]">{inr(po.total)}</span>
                  </div>
                )) : <p className="text-xs text-white/35 text-center py-8">No purchase orders for this supplier yet.</p>}
              </div>
            )}

            {tab === 'txns' && (
              <div className="space-y-2">
                {selTxns.length ? selTxns.map((r, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-xl" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                    <div><p className="text-sm text-white/90 font-medium">{r.partName || r.name || 'Stock received'}</p><p className="text-[11px] text-white/40">×{r.qty || r.quantity || 0}{r.poNumber ? ` · ${r.poNumber}` : ''}</p></div>
                    <span className="text-sm text-emerald-400">+{r.qty || r.quantity || 0}</span>
                  </div>
                )) : <p className="text-xs text-white/35 text-center py-8">No stock-in transactions recorded for this supplier.</p>}
              </div>
            )}

            {tab === 'notes' && (
              <div className="rounded-xl p-4 text-sm text-white/70 whitespace-pre-wrap" style={{ background: 'rgba(var(--fg-rgb),0.03)', minHeight: 80 }}>{selected.notes || <span className="text-white/35">No notes for this supplier.</span>}</div>
            )}
            {tab === 'docs' && (
              <p className="text-xs text-white/35 text-center py-10">Document attachments aren’t enabled yet.</p>
            )}
          </div>
        )}
      </div>

      {/* RIGHT — docked PO panel */}
      {poPanel && (
        <div className="hidden xl:block xl:w-[340px] xl:flex-shrink-0">
          <div className="xl:sticky xl:top-4" style={{ height: 'calc(100vh - 96px)' }}>{poPanel}</div>
        </div>
      )}
    </div>
  );
}
