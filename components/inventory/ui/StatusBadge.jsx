import React from 'react';
import { MessageCircle } from 'lucide-react';
import { classifyStockLevel } from '../../../services/inventoryService';

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
// Parts review (Issue 6.2) — a separate "Reorder" button used to sit next to this
// badge on every low/out row, always visible and independently labeled, so the same
// fact ("this needs reordering") was said twice: once by the badge's colour/text,
// once by the button's own presence. Folding the reorder trigger INTO the badge —
// only for the two states it actually applies to — turns two adjacent controls
// making the same claim into one. `onReorder` is optional so every other call site
// (or a future one with nothing to reorder into) keeps the badge exactly as before.
export default function StatusBadge({ stock, minStock, onReorder }) {
  // H-5A: the out/low/ok threshold decision is now classifyStockLevel (pure, in
  // inventoryService) — same conditions, single source of truth. Only the DECISION
  // moved; the JSX/classes below are unchanged (H-10 deliberately left this component's
  // rendering as-is, since it's Tailwind-class-based rather than hex+Badge-based).
  const level = classifyStockLevel({ stock, minStock });
  const reorderBtn = onReorder && (level === 'out' || level === 'low') && (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onReorder(); }}
      title="Generate a WhatsApp purchase order"
      className="flex items-center justify-center w-4 h-4 -mr-0.5 rounded-full hover:bg-black/15 active:scale-90 transition"
    >
      <MessageCircle size={10} />
    </button>
  );
  if (level === 'out') {
    return (
      <span className="inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-500/15 text-red-400 border border-red-500/30">
        Out{reorderBtn}
      </span>
    );
  }
  if (level === 'low') {
    return (
      <span
        className="inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/30 whitespace-nowrap"
        title={`Current stock: ${stock} · Minimum stock: ${minStock || 5}`}
      >
        Low ({stock}/{minStock || 5}){reorderBtn}
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
      OK
    </span>
  );
}
