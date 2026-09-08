import React, { useState, useRef } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import DropdownPanel from '../../common/DropdownPanel';

export default function DateRangeControl({ value, onChange, custom, onCustomChange, label }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const presets = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['year', 'This year'], ['custom', 'Custom range']];
  const short = presets.find((p) => p[0] === value)?.[1] || 'Today';
  return (
    <div className="relative">
      <button ref={anchorRef} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className="flex items-center gap-2 h-10 px-3.5 rounded-xl text-sm font-semibold bg-white/5 border border-white/10 text-white/85 hover:bg-white/10 active:scale-95 transition">
        <Calendar size={15} className="text-[#d4af37]" /> {value === 'custom' ? label : short} <ChevronDown size={15} className={`text-white/45 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <DropdownPanel anchorRef={anchorRef} open onClose={() => setOpen(false)} scroll={false} width={224}
          className="p-1.5 shadow-2xl" style={{ background: 'var(--surface-2)', border: '1px solid rgba(var(--fg-rgb),0.1)' }}>
          <div role="menu">
            {presets.map(([k, l]) => (
              <button key={k} role="menuitem" onClick={() => { onChange(k); if (k !== 'custom') setOpen(false); }} className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${value === k ? 'bg-[#d4af37]/15 text-[#d4af37] font-semibold' : 'text-white/70 hover:bg-white/5'}`}>{l}</button>
            ))}
            {value === 'custom' && (
              <div className="p-2 space-y-2 mt-1" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.1)' }}>
                <label className="block text-[10px] uppercase tracking-wide text-white/45">From</label>
                <input type="date" value={custom?.start || ''} onChange={(e) => onCustomChange({ ...custom, start: e.target.value })} className="w-full px-2 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-white" />
                <label className="block text-[10px] uppercase tracking-wide text-white/45">To</label>
                <input type="date" value={custom?.end || ''} onChange={(e) => onCustomChange({ ...custom, end: e.target.value })} className="w-full px-2 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-white" />
                <button onClick={() => setOpen(false)} className="w-full py-1.5 rounded-lg text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">Apply</button>
              </div>
            )}
          </div>
        </DropdownPanel>
      )}
    </div>
  );
}
