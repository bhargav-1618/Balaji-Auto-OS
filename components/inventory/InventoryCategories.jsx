// components/inventory/InventoryCategories.jsx
// PHASE 1 · Slice 2 — Categories page. One card per category with part count,
// stock value, low-stock count and fast-mover count. Clicking a card opens the
// Parts table filtered to that category. Computed live; no data-model change.
import React, { useMemo } from 'react';
import { confirmDialog } from '../common/ConfirmDialog';
import { Layers, AlertTriangle, Flame, ArrowRight, IndianRupee, Pencil, Trash2 } from 'lucide-react';

const num = (v) => (Number.isFinite(+v) ? +v : 0);
const catOf = (p) => (Array.isArray(p.categories) && p.categories[0]) || p.category || 'Uncategorised';

export default function InventoryCategories({ inventory = [], sales = [], formatINR, onOpenCategory, onRename, onDelete, canManage = false }) {
  const cards = useMemo(() => {
    const soldByPart = {};
    sales.forEach((s) => { if (s.partId) soldByPart[s.partId] = (soldByPart[s.partId] || 0) + num(s.qty || s.quantity || 1); });

    const byCat = {};
    inventory.filter((p) => !p.archived).forEach((p) => {
      const c = catOf(p);
      if (!byCat[c]) byCat[c] = { name: c, parts: 0, value: 0, low: 0, out: 0, fast: 0 };
      const b = byCat[c];
      b.parts += 1;
      b.value += num(p.stock) * num(p.sellingPrice);
      if (num(p.stock) === 0) b.out += 1;
      else if (num(p.stock) <= num(p.minStock || 5)) b.low += 1;
      if ((soldByPart[p.id] || 0) > 0) b.fast += 1;
    });
    return Object.values(byCat).sort((a, b) => b.value - a.value);
  }, [inventory, sales]);

  const inr = (n) => (typeof formatINR === 'function' ? formatINR(n) : `₹${Math.round(num(n)).toLocaleString('en-IN')}`);

  if (cards.length === 0) {
    return (
      <div className="p-12 flex flex-col items-center gap-3 text-center rounded-2xl" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
        <Layers size={30} className="text-white/20" />
        <p className="text-sm text-white/40">No categories yet. Add parts and their categories will show up here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Layers size={18} className="text-[#d4af37]" />
        <h2 className="text-base font-bold text-white">Categories</h2>
        <span className="text-xs text-white/40">({cards.length})</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.map((c) => {
          const isUncat = c.name === 'Uncategorised';
          const handleRename = (e) => {
            e.stopPropagation();
            const nn = window.prompt(`Rename category “${c.name}” to:`, c.name);
            if (nn && nn.trim() && nn.trim() !== c.name) onRename?.(c.name, nn.trim());
          };
          const handleDelete = async (e) => {
            e.stopPropagation();
            if (await confirmDialog({ title: `Delete “${c.name}”?`, message: `Its ${c.parts} part${c.parts === 1 ? '' : 's'} will move to “Uncategorised”. This does not delete any parts.`, danger: true, confirmText: 'Delete' })) onDelete?.(c.name);
          };
          return (
            <div
              key={c.name}
              onClick={() => onOpenCategory?.(c.name)}
              className="text-left rounded-2xl p-4 backdrop-blur-sm transition hover:bg-white/[0.06] active:scale-[0.99] group cursor-pointer"
              style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-white/90 truncate">{c.name}</h3>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {canManage && !isUncat && (
                    <>
                      <button onClick={handleRename} title="Rename category" className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-white/90 hover:bg-white/10 transition"><Pencil size={13} /></button>
                      <button onClick={handleDelete} title="Delete category" className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-red-400 hover:bg-red-500/10 transition"><Trash2 size={13} /></button>
                    </>
                  )}
                  <ArrowRight size={15} className="text-white/25 group-hover:text-[#d4af37] transition" />
                </div>
              </div>
              <div className="flex items-baseline gap-1.5 mb-3">
                <span className="text-2xl font-bold text-[#d4af37]">{c.parts}</span>
                <span className="text-xs text-white/40">parts</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg py-1.5" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                  <div className="flex items-center justify-center gap-1 text-emerald-400 text-xs font-semibold"><IndianRupee size={11} />{inr(c.value).replace('₹', '')}</div>
                  <div className="text-[9px] uppercase tracking-wide text-white/30 mt-0.5">Value</div>
                </div>
                <div className="rounded-lg py-1.5" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                  <div className="flex items-center justify-center gap-1 text-amber-400 text-xs font-semibold"><AlertTriangle size={11} />{c.low + c.out}</div>
                  <div className="text-[9px] uppercase tracking-wide text-white/30 mt-0.5">Reorder</div>
                </div>
                <div className="rounded-lg py-1.5" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                  <div className="flex items-center justify-center gap-1 text-pink-400 text-xs font-semibold"><Flame size={11} />{c.fast}</div>
                  <div className="text-[9px] uppercase tracking-wide text-white/30 mt-0.5">Fast</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
