// components/inventory/SupplierPerformance.jsx
// Read-only supplier performance. Shows seeded metrics in demo; in production it
// degrades gracefully (shows "—" until such fields are captured). No writes — safe.
import React, { useMemo, useState } from 'react';
import { Gauge, Star, Clock, Target, IndianRupee, Package, ChevronDown } from 'lucide-react';

const num = (v) => (Number.isFinite(+v) ? +v : 0);
const has = (v) => v !== undefined && v !== null && v !== '';

export default function SupplierPerformance({ suppliers = [], inventory = [], formatINR }) {
  const [open, setOpen] = useState(true);
  const inr = (n) => (typeof formatINR === 'function' ? formatINR(n) : `₹${Math.round(num(n)).toLocaleString('en-IN')}`);

  const rows = useMemo(() => {
    const linkedCount = (sid) => inventory.filter((p) => !p.archived && Array.isArray(p.suppliers) && p.suppliers.some((s) => (s?.id || s) === sid)).length;
    return suppliers.map((s) => ({
      id: s.id,
      name: s.name,
      rating: s.rating,
      ratingCount: s.ratingCount,
      lead: s.leadTimeDays,
      onTime: s.onTimePct,
      accuracy: s.orderAccuracyPct,
      outstanding: s.outstanding,
      linked: linkedCount(s.id),
    })).sort((a, b) => num(b.rating) - num(a.rating));
  }, [suppliers, inventory]);

  const anyMetrics = rows.some((r) => has(r.rating) || has(r.lead) || has(r.onTime));

  const agg = useMemo(() => {
    const withLead = rows.filter((r) => has(r.lead));
    const withOnTime = rows.filter((r) => has(r.onTime));
    const withAcc = rows.filter((r) => has(r.accuracy));
    const avg = (arr, k) => (arr.length ? arr.reduce((s, r) => s + num(r[k]), 0) / arr.length : null);
    return {
      lead: avg(withLead, 'lead'),
      onTime: avg(withOnTime, 'onTime'),
      accuracy: avg(withAcc, 'accuracy'),
      outstanding: rows.reduce((s, r) => s + num(r.outstanding), 0),
    };
  }, [rows]);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-2xl overflow-hidden backdrop-blur-sm mt-5" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-left" style={{ borderBottom: open ? '1px solid rgba(var(--fg-rgb),0.06)' : 'none' }}>
        <Gauge size={16} className="text-[#d4af37]" />
        <h3 className="text-sm font-bold text-white/90 flex-1">Supplier performance</h3>
        <ChevronDown size={16} className={`text-white/40 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          {!anyMetrics && (
            <p className="text-xs text-white/40 px-4 py-3">Performance metrics (lead time, ratings, on-time %) aren’t captured yet in production — they’ll populate here as you record purchase orders and deliveries. This panel is fully populated in the demo.</p>
          )}
          {anyMetrics && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px" style={{ background: 'rgba(var(--fg-rgb),0.06)' }}>
              {[
                { label: 'Avg lead time', value: agg.lead != null ? `${agg.lead.toFixed(1)} days` : '—', icon: Clock, color: '#60a5fa' },
                { label: 'On-time', value: agg.onTime != null ? `${Math.round(agg.onTime)}%` : '—', icon: Target, color: '#4ade80' },
                { label: 'Order accuracy', value: agg.accuracy != null ? `${Math.round(agg.accuracy)}%` : '—', icon: Gauge, color: '#d4af37' },
                { label: 'Outstanding', value: inr(agg.outstanding), icon: IndianRupee, color: '#f59e0b' },
              ].map((k) => (
                <div key={k.label} className="p-3" style={{ background: 'rgba(15,15,15,0.6)' }}>
                  <div className="flex items-center gap-1.5 mb-1"><k.icon size={12} style={{ color: k.color }} /><span className="text-[10px] uppercase tracking-wide text-white/40">{k.label}</span></div>
                  <div className="text-base font-bold" style={{ color: k.color }}>{k.value}</div>
                </div>
              ))}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                  {['Supplier', 'Rating', 'Lead time', 'On-time', 'Accuracy', 'Outstanding', 'Parts'].map((c) => (
                    <th key={c} className="px-4 py-2.5 text-[11px] uppercase tracking-wider text-white/40 font-semibold whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-white/[0.03] transition" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.04)' }}>
                    <td className="px-4 py-2.5 text-white/85 font-medium whitespace-nowrap">{r.name}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {has(r.rating) ? (
                        <span className="inline-flex items-center gap-1 text-white/80"><Star size={12} className="text-[#d4af37] fill-[#d4af37]" />{num(r.rating).toFixed(1)}<span className="text-white/30 text-xs">({r.ratingCount || 0})</span></span>
                      ) : <span className="text-white/30">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-white/60 whitespace-nowrap">{has(r.lead) ? `${num(r.lead).toFixed(1)} d` : '—'}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{has(r.onTime) ? <span className={num(r.onTime) >= 90 ? 'text-emerald-400' : 'text-amber-400'}>{Math.round(num(r.onTime))}%</span> : <span className="text-white/30">—</span>}</td>
                    <td className="px-4 py-2.5 text-white/60 whitespace-nowrap">{has(r.accuracy) ? `${Math.round(num(r.accuracy))}%` : '—'}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{num(r.outstanding) > 0 ? <span className="text-amber-400">{inr(r.outstanding)}</span> : <span className="text-white/40">Clear</span>}</td>
                    <td className="px-4 py-2.5 text-white/60 whitespace-nowrap"><span className="inline-flex items-center gap-1"><Package size={12} className="text-white/30" />{r.linked}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
