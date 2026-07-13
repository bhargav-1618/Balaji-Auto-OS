// components/inventory/SupplierPOBuilder.jsx
// Global Purchase Order builder (right-panel drawer). Search parts across every
// supplier, select with quantity steppers, review a GST-inclusive summary, then
// create the PO(s) — grouped by supplier — and optionally share via WhatsApp.
import React, { useMemo, useState, useEffect } from 'react';
import { X, Search, Plus, Minus, ClipboardList, Check, MessageCircle, ChevronLeft, Trash2, PackageX, FileDown } from 'lucide-react';

export default function SupplierPOBuilder({ inventory = [], suppliers = [], restocks = [], formatINR, onClose, onCreatePO, docked = false }) {
  const inr = (n) => (typeof formatINR === 'function' ? formatINR(n) : `₹${Math.round(n || 0).toLocaleString('en-IN')}`);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [sel, setSel] = useState({});        // partId -> qty
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(30);

  const active = useMemo(() => inventory.filter((p) => !p.archived), [inventory]);
  const restockedIds = useMemo(() => new Set(restocks.map((r) => r.partId)), [restocks]);
  const supplierOf = (p) => (Array.isArray(p.suppliers) && p.suppliers[0]) || null;
  const suggested = (p) => Math.max((p.minStock || 5) * 2 - (p.stock || 0), p.minStock || 5);
  const isLow = (p) => (p.stock || 0) > 0 && (p.stock || 0) <= (p.minStock || 5);
  const isOut = (p) => (p.stock || 0) === 0;

  const counts = useMemo(() => ({
    all: active.length,
    low: active.filter(isLow).length,
    out: active.filter(isOut).length,
    frequent: active.filter((p) => restockedIds.has(p.id)).length,
  }), [active, restockedIds]);

  const [debQ, setDebQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebQ(q), 350); return () => clearTimeout(t); }, [q]);

  const list = useMemo(() => {
    const raw = debQ.trim().toLowerCase();
    const tokens = raw.length >= 3 ? raw.split(/\s+/).filter(Boolean) : []; // min 3 chars before searching
    return active.filter((p) => {
      if (filter === 'low' && !isLow(p)) return false;
      if (filter === 'out' && !isOut(p)) return false;
      if (filter === 'frequent' && !restockedIds.has(p.id)) return false;
      if (!tokens.length) return true;
      const sup = supplierOf(p);
      const rec = suppliers.find((s) => s.id === sup?.id);
      const aliases = (rec?.altNames || []).join(' ');
      const hay = [p.name, p.sku, p.category, p.vehicle, ...(p.compatibleCars || []), sup?.name || '', aliases]
        .filter(Boolean).join(' ').toLowerCase();
      return tokens.every((t) => hay.includes(t)); // partial + contains + multi-token
    });
  }, [active, debQ, filter, restockedIds, suppliers]);

  const toggle = (p) => setSel((s) => { const n = { ...s }; if (n[p.id] != null) delete n[p.id]; else n[p.id] = suggested(p); return n; });
  const setQty = (id, v) => setSel((s) => ({ ...s, [id]: Math.max(1, Math.round(v) || 1) }));
  const clearAll = () => setSel({});
  useEffect(() => { setVisible(30); }, [q, filter]);

  const selectedParts = useMemo(() => Object.keys(sel).map((id) => active.find((p) => p.id === id)).filter(Boolean), [sel, active]);
  const totalQty = selectedParts.reduce((s, p) => s + (sel[p.id] || 0), 0);
  const subtotal = selectedParts.reduce((s, p) => s + (sel[p.id] || 0) * (p.purchasePrice || 0), 0);
  // GST-optional rule: use each part's own GST% (0 when the part/supplier is non-GST)
  // rather than forcing 18%. Purchase orders still generate correctly at 0% GST.
  const gst = Math.round(selectedParts.reduce((s, p) => { const rate = Number(p.gst) || 0; return s + (sel[p.id] || 0) * (p.purchasePrice || 0) * (rate / 100); }, 0));
  const gstPctLabel = (() => { const rates = Array.from(new Set(selectedParts.map((p) => Number(p.gst) || 0))); return rates.length === 1 ? `${rates[0]}%` : 'mixed'; })();
  const grand = subtotal + gst;
  const eta = useMemo(() => { const d = new Date(Date.now() + 3 * 86400000); return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }, []);
  const phoneOf = (sup) => {
    const rec = suppliers.find((s) => s.id === sup?.id);
    const raw = sup?.phone || rec?.phoneNumbers?.[0]?.number || rec?.phone || '';
    return String(raw).replace(/\D/g, '').slice(-10);
  };
  const waSend = (grp) => {
    const ph = phoneOf(grp.supplier);
    const lines = grp.items.map((it) => `• ${it.name} × ${it.qty}`).join('%0A');
    const total = grp.items.reduce((s, it) => s + it.qty * it.unitCost, 0);
    const msg = `Hello ${grp.supplier?.name || ''},%0A%0AWe would like to place the following order:%0A${lines}%0A%0AEstimated Total: ${inr(total)}%0APlease confirm availability and expected delivery.%0A%0AThank you,%0ASri Baba Balaji Maruti Care`;
    if (ph) window.open(`https://wa.me/91${ph}?text=${msg}`, '_blank');
  };
  const downloadPDF = async () => {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const money = (n) => `Rs ${Math.round(n || 0).toLocaleString('en-IN')}`;
    let y = 48;
    doc.setFontSize(16); doc.setTextColor(30, 30, 30); doc.text('SRI BABA BALAJI MARUTI CARE', 40, y); y += 20;
    doc.setFontSize(12); doc.setTextColor(150, 120, 40); doc.text('Purchase Order', 40, y); y += 16;
    doc.setFontSize(9); doc.setTextColor(120, 120, 120);
    doc.text(`Date: ${new Date().toLocaleDateString('en-IN')}    Estimated delivery: ~ ${eta}`, 40, y); y += 24;
    groups.forEach((grp) => {
      if (y > 760) { doc.addPage(); y = 48; }
      doc.setFontSize(11); doc.setTextColor(30, 30, 30); doc.text(grp.supplier?.name || 'No supplier linked', 40, y); y += 15;
      doc.setFontSize(9); doc.setTextColor(110, 110, 110);
      doc.text('Item', 48, y); doc.text('Qty', 350, y); doc.text('Unit', 415, y); doc.text('Total', 490, y); y += 6;
      doc.setDrawColor(210); doc.line(40, y, 555, y); y += 12;
      doc.setTextColor(50, 50, 50);
      grp.items.forEach((it) => {
        if (y > 785) { doc.addPage(); y = 48; }
        doc.text(String(it.name).slice(0, 52), 48, y);
        doc.text(String(it.qty), 350, y);
        doc.text(money(it.unitCost), 415, y);
        doc.text(money(it.qty * it.unitCost), 490, y);
        y += 14;
      });
      const gt = grp.items.reduce((s, it) => s + it.qty * it.unitCost, 0);
      doc.setTextColor(30, 30, 30); doc.text(`Subtotal: ${money(gt)}`, 415, y + 2); y += 24;
    });
    if (y > 760) { doc.addPage(); y = 48; }
    doc.setDrawColor(190); doc.line(40, y, 555, y); y += 16;
    doc.setFontSize(10); doc.setTextColor(60, 60, 60);
    doc.text(`Subtotal: ${money(subtotal)}`, 415, y); y += 15;
    doc.text(`GST (${gstPctLabel}): ${money(gst)}`, 415, y); y += 16;
    doc.setFontSize(12); doc.setTextColor(20, 20, 20); doc.text(`Total Amount: ${money(grand)}`, 415, y);
    doc.save(`purchase-order-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const groups = useMemo(() => {
    const g = {};
    selectedParts.forEach((p) => {
      const sup = supplierOf(p);
      const key = sup?.id || '__none__';
      (g[key] = g[key] || { supplier: sup, items: [] }).items.push({ partId: p.id, name: p.name, sku: p.sku || '', qty: sel[p.id], unitCost: p.purchasePrice || 0 });
    });
    return Object.values(g);
  }, [selectedParts, sel]);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      for (const grp of groups) {
        // eslint-disable-next-line no-await-in-loop
        await onCreatePO?.({ supplierId: grp.supplier?.id || null, supplierName: grp.supplier?.name || '—', items: grp.items, notes: 'Created from PO builder' });
      }
      onClose?.();
    } finally { setBusy(false); }
  };

  const chip = (k, label, n) => (
    <button key={k} type="button" onClick={() => setFilter(k)} className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap transition ${filter === k ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]' : 'text-white/60 bg-white/5 border border-white/10 hover:bg-white/10'}`}>{label} ({n})</button>
  );

  const panel = (
    <div className={`w-full h-full flex flex-col ${docked ? 'rounded-2xl overflow-hidden' : 'sm:max-w-md'}`} style={{ background: 'var(--surface-1)', ...(docked ? { border: '1px solid rgba(212,175,55,0.2)' } : { borderLeft: '1px solid rgba(212,175,55,0.2)' }) }} onClick={(e) => e.stopPropagation()}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
          <div className="flex items-center gap-2">
            {reviewing && <button onClick={() => setReviewing(false)} className="w-8 h-8 -ml-1 rounded-lg flex items-center justify-center text-white/60 hover:bg-white/10"><ChevronLeft size={18} /></button>}
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2"><ClipboardList size={16} className="text-[#d4af37]" /> {reviewing ? 'Review Order' : 'Purchase Order'}</h3>
              {!reviewing && <p className="text-[11px] text-white/45">Search and add parts from any supplier.</p>}
            </div>
          </div>
          {!docked && <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10"><X size={18} /></button>}
        </div>

        {!reviewing ? (
          <>
            {/* Search + filters */}
            <div className="px-4 pt-3 pb-2 flex-shrink-0 space-y-2">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search parts by name, SKU, vehicle, category…" className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 text-white placeholder-white/30 outline-none focus:border-[#d4af37]/60" />
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1 dark-scroll">
                {chip('all', 'All', counts.all)}
                {chip('low', 'Low Stock', counts.low)}
                {chip('out', 'Out of Stock', counts.out)}
                {chip('frequent', 'Frequent', counts.frequent)}
              </div>
            </div>

            {/* Part list */}
            <div className="flex-1 overflow-y-auto dark-scroll px-2">
              {list.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-14 text-center"><PackageX size={26} className="text-white/20" /><p className="text-sm text-white/40">No parts match.</p></div>
              ) : list.slice(0, visible).map((p) => {
                const on = sel[p.id] != null;
                return (
                  <div key={p.id} className={`flex items-center gap-2 px-2 py-2 rounded-xl mb-1 transition ${on ? 'bg-emerald-500/10' : 'hover:bg-white/[0.03]'}`}>
                    <button onClick={() => toggle(p)} className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border transition ${on ? 'bg-emerald-500 border-emerald-500' : 'border-white/25'}`}>{on && <Check size={13} className="text-black" />}</button>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white/90 font-medium truncate">{p.name}</p>
                      <p className="text-[10px] text-white/40 truncate">{[p.vehicle, p.category || 'Uncategorised', supplierOf(p)?.name].filter(Boolean).join(' · ')}</p>
                      <p className="text-[10px] mt-0.5">{p.sku ? <span className="text-white/35">{p.sku} · </span> : null}<span className={isOut(p) ? 'text-red-400' : isLow(p) ? 'text-amber-400' : 'text-white/45'}>Stock {p.stock || 0}</span><span className="text-white/30"> · min {p.minStock || 5} · suggest {suggested(p)}</span></p>
                    </div>
                    {on ? (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => setQty(p.id, sel[p.id] - 1)} className="w-6 h-6 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/70 hover:bg-white/10"><Minus size={12} /></button>
                        <input value={sel[p.id]} onChange={(e) => setQty(p.id, Number(e.target.value))} className="w-9 text-center text-sm bg-transparent text-white outline-none" />
                        <button onClick={() => setQty(p.id, sel[p.id] + 1)} className="w-6 h-6 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/70 hover:bg-white/10"><Plus size={12} /></button>
                      </div>
                    ) : (
                      <span className="text-[11px] text-white/40 flex-shrink-0">{inr(p.purchasePrice || 0)}</span>
                    )}
                  </div>
                );
              })}
              {list.length > visible && (
                <button onClick={() => setVisible((v) => v + 30)} className="w-full my-2 py-2 rounded-xl text-xs font-semibold text-white/70 bg-white/5 border border-white/10 hover:bg-white/10 transition">Load more parts ({list.length - visible} more)</button>
              )}
            </div>

            {/* Selected Items + Order Summary */}
            {selectedParts.length > 0 && (
              <div className="flex-shrink-0 px-4 py-3" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.08)', background: 'var(--surface-2)' }}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-white">Selected Items ({selectedParts.length})</span>
                  <button onClick={clearAll} className="text-[11px] text-red-400 hover:underline">Clear All</button>
                </div>
                <div className="max-h-24 overflow-y-auto dark-scroll space-y-1 mb-2 pr-1">
                  {selectedParts.map((p) => (
                    <div key={p.id} className="flex items-center justify-between text-xs gap-2">
                      <span className="text-white/70 truncate flex-1">{p.name}</span>
                      <span className="text-white/45 flex-shrink-0">Qty: {sel[p.id]}</span>
                      <button onClick={() => toggle(p)} aria-label="Remove" className="text-red-400 hover:text-red-300 flex-shrink-0"><X size={12} /></button>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg p-2.5 space-y-1 mb-2" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                  <div className="flex justify-between text-[11px]"><span className="text-white/45">Total Items</span><span className="text-white/80">{selectedParts.length}</span></div>
                  <div className="flex justify-between text-[11px]"><span className="text-white/45">Total Quantity</span><span className="text-white/80">{totalQty}</span></div>
                  <div className="flex justify-between text-[11px]"><span className="text-white/45">Subtotal</span><span className="text-white/80">{inr(subtotal)}</span></div>
                  <div className="flex justify-between text-[11px]"><span className="text-white/45">GST ({gstPctLabel})</span><span className="text-white/80">{inr(gst)}</span></div>
                  <div className="flex justify-between pt-1" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.06)' }}><span className="text-xs font-bold text-white">Total Amount</span><span className="text-sm font-bold text-[#d4af37]">{inr(grand)}</span></div>
                </div>
                <button onClick={() => setReviewing(true)} className="w-full h-11 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] active:scale-95 transition">Review Order</button>
              </div>
            )}
          </>
        ) : (
          /* Review screen */
          <div className="flex-1 overflow-y-auto dark-scroll p-4 space-y-3">
            <p className="text-xs text-white/45">This order will create {groups.length} purchase order{groups.length === 1 ? '' : 's'}, grouped by supplier. Estimated delivery around <span className="text-white/80 font-semibold">{eta}</span>.</p>
            {groups.map((grp, gi) => {
              const gTotal = grp.items.reduce((s, it) => s + it.qty * it.unitCost, 0);
              return (
                <div key={gi} className="rounded-xl p-3" style={{ background: 'var(--surface-2)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
                  <p className="text-sm font-bold text-white mb-2">{grp.supplier?.name || 'No supplier linked'}</p>
                  {grp.items.map((it) => (
                    <div key={it.partId} className="flex justify-between text-xs py-1"><span className="text-white/70 truncate mr-2">{it.name} × {it.qty}</span><span className="text-white/85 flex-shrink-0">{inr(it.qty * it.unitCost)}</span></div>
                  ))}
                  <div className="flex items-center justify-between pt-2 mt-1" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                    <span className="text-xs font-semibold text-white/60">Subtotal <span className="text-[#d4af37]">{inr(gTotal)}</span></span>
                    {phoneOf(grp.supplier) && (
                      <button onClick={() => waSend(grp)} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition"><MessageCircle size={12} /> WhatsApp</button>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="rounded-xl p-3 space-y-1.5" style={{ background: 'var(--surface-2)', border: '1px solid rgba(212,175,55,0.2)' }}>
              <div className="flex justify-between text-sm"><span className="text-white/50">Subtotal</span><span className="text-white/85">{inr(subtotal)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-white/50">GST ({gstPctLabel})</span><span className="text-white/85">{inr(gst)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-white/50">Est. delivery</span><span className="text-white/85">~ {eta}</span></div>
              <div className="flex justify-between"><span className="text-sm font-bold text-white">Total Amount</span><span className="text-base font-bold text-[#d4af37]">{inr(grand)}</span></div>
            </div>
            <div className="space-y-2 pt-1">
              <button onClick={confirm} disabled={busy} className="w-full h-11 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] active:scale-95 transition disabled:opacity-60 flex items-center justify-center gap-2"><ClipboardList size={16} /> {busy ? 'Creating…' : `Confirm & Create ${groups.length > 1 ? groups.length + ' POs' : 'PO'}`}</button>
              <button onClick={downloadPDF} className="w-full h-10 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 active:scale-95 transition"><FileDown size={15} /> Download PDF</button>
              <p className="text-[11px] text-white/35 text-center">After creating, open each PO to approve, share on WhatsApp, or receive stock.</p>
            </div>
          </div>
        )}
    </div>
  );
  if (docked) return panel;
  return (
    <div className="fixed inset-0 z-[110] flex justify-end" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }} onClick={onClose}>
      {panel}
    </div>
  );
}
