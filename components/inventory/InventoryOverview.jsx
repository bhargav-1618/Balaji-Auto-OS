// components/inventory/InventoryOverview.jsx
// PHASE 1 · Slice 1 — the Inventory module's landing page. Read-only overview
// (nothing editable here). Computes every metric from the data the app already
// holds, so there is no data-model change and no risk to existing flows. Styled
// to the Balaji Auto OS language: carbon black + gold, glass cards.
import React, { useMemo } from 'react';
import {
  PackageSearch, IndianRupee, AlertTriangle, PackageX, Archive, RefreshCw,
  Flame, Snowflake, Plus, PackagePlus, ShoppingCart, ArrowRight, TrendingUp,
  Clock, Layers,
} from 'lucide-react';

const GOLD = '#d4af37';

// ---- small, self-contained helpers (no external coupling) ----
const num = (v) => (Number.isFinite(+v) ? +v : 0);
const toMillis = (t) => {
  if (!t) return 0;
  if (typeof t === 'number') return t < 1e12 ? t * 1000 : t;
  if (typeof t?.toMillis === 'function') return t.toMillis();
  if (t?.seconds) return t.seconds * 1000;
  const p = Date.parse(t);
  return Number.isNaN(p) ? 0 : p;
};
const relTime = (ms) => {
  if (!ms) return '';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d}d ago`;
};
const inr = (n, formatINR) => (typeof formatINR === 'function' ? formatINR(n) : `₹${Math.round(num(n)).toLocaleString('en-IN')}`);

// ---- presentational atoms ----
function Card({ children, className = '', ...rest }) {
  return (
    <div
      className={`rounded-2xl backdrop-blur-sm ${className}`}
      style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}
      {...rest}
    >
      {children}
    </div>
  );
}

function Kpi({ label, value, sub, icon: Icon, color, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`text-left rounded-2xl p-4 backdrop-blur-sm transition w-full ${onClick ? 'hover:bg-white/[0.06] active:scale-[0.98] cursor-pointer' : ''}`}
      style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-wider text-white/40">{label}</span>
        <Icon size={14} style={{ color }} />
      </div>
      <div className="text-xl font-bold leading-tight" style={{ color }}>{value}</div>
      {sub != null && <div className="text-[11px] text-white/40 mt-0.5">{sub}</div>}
    </Tag>
  );
}

function SectionHead({ icon: Icon, title, action }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        {Icon && <Icon size={15} className="text-[#d4af37]" />}
        <h3 className="text-sm font-bold text-white/90">{title}</h3>
      </div>
      {action}
    </div>
  );
}

function Empty({ children }) {
  return <p className="text-xs text-white/35 py-6 text-center">{children}</p>;
}

// ---- donut (inline SVG, no dependency) ----
function Donut({ segments, centerLabel, centerValue }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let acc = 0;
  const R = 52, C = 60, sw = 16, circ = 2 * Math.PI * R;
  return (
    <div className="flex items-center gap-4">
      <svg width="120" height="120" viewBox="0 0 120 120" className="flex-shrink-0">
        <circle cx={C} cy={C} r={R} fill="none" stroke="rgba(var(--fg-rgb),0.06)" strokeWidth={sw} />
        {segments.map((seg, i) => {
          const frac = seg.value / total;
          const dash = frac * circ;
          const el = (
            <circle
              key={i}
              cx={C} cy={C} r={R} fill="none"
              stroke={seg.color} strokeWidth={sw}
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={-acc * circ}
              transform={`rotate(-90 ${C} ${C})`}
              strokeLinecap="butt"
            />
          );
          acc += frac;
          return el;
        })}
        <text x={C} y={C - 4} textAnchor="middle" className="fill-white" style={{ fontSize: 18, fontWeight: 700 }}>{centerValue}</text>
        <text x={C} y={C + 12} textAnchor="middle" style={{ fontSize: 9, fill: 'rgba(var(--fg-rgb),0.4)' }}>{centerLabel}</text>
      </svg>
      <div className="flex-1 min-w-0 space-y-1.5">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: seg.color }} />
            <span className="text-white/70 truncate flex-1">{seg.label}</span>
            <span className="text-white/45 tabular-nums">{seg.value}</span>
          </div>
        ))}
        {segments.length === 0 && <Empty>No categories yet.</Empty>}
      </div>
    </div>
  );
}

// ---- movement bars (last 14 days) ----
function MovementBars({ days }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <div className="flex items-end gap-1 h-24">
      {days.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
          <div className="w-full rounded-t transition-all" style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count ? 4 : 1, background: d.count ? 'linear-gradient(180deg,#d4af37,#aa801e)' : 'rgba(var(--fg-rgb),0.06)' }} title={`${d.label}: ${d.count} movements`} />
        </div>
      ))}
    </div>
  );
}

export default function InventoryOverview({
  inventory = [], sales = [], restocks = [], stockAdjustments = [], reorderRequests = [],
  formatINR, onNavigate, onAddPart, onQuickReceive, onQuickSell, onAddSupplier, onImport, onEditPart,
}) {
  const m = useMemo(() => {
    const active = inventory.filter((p) => !p.archived);
    const archived = inventory.filter((p) => p.archived);
    const low = active.filter((p) => num(p.stock) > 0 && num(p.stock) <= num(p.minStock || 5));
    const out = active.filter((p) => num(p.stock) === 0);
    const value = active.reduce((s, p) => s + num(p.stock) * num(p.sellingPrice), 0);
    const profit = active.reduce((s, p) => s + num(p.stock) * (num(p.sellingPrice) - num(p.purchasePrice)), 0);

    // units sold per part (fast movers / top selling / dead stock)
    const soldByPart = {};
    sales.forEach((s) => { const id = s.partId; if (!id) return; soldByPart[id] = (soldByPart[id] || 0) + num(s.qty || s.quantity || 1); });
    const withSales = active.map((p) => ({ p, sold: soldByPart[p.id] || 0 }));
    const topSelling = [...withSales].filter((x) => x.sold > 0).sort((a, b) => b.sold - a.sold).slice(0, 5);
    const fastMovers = topSelling.length;
    const deadStock = withSales.filter((x) => x.sold === 0 && num(x.p.stock) > 0);

    // category distribution (by active part count)
    const catCount = {};
    active.forEach((p) => { const c = (Array.isArray(p.categories) && p.categories[0]) || p.category || 'Uncategorised'; catCount[c] = (catCount[c] || 0) + 1; });
    const palette = ['#d4af37', '#4ade80', '#60a5fa', '#f59e0b', '#a78bfa', '#f472b6', '#34d399'];
    const catSorted = Object.entries(catCount).sort((a, b) => b[1] - a[1]);
    const top6 = catSorted.slice(0, 6);
    const restCount = catSorted.slice(6).reduce((s, [, v]) => s + v, 0);
    const segments = top6.map(([label, value], i) => ({ label, value, color: palette[i % palette.length] }));
    if (restCount) segments.push({ label: 'Other', value: restCount, color: 'rgba(var(--fg-rgb),0.25)' });

    // recently added
    const recentlyAdded = [...active].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)).slice(0, 5);

    // recent activity (sales + restocks + adjustments merged)
    const acts = [];
    sales.forEach((s) => acts.push({ t: toMillis(s.soldAt || s.createdAt || s.date), kind: 'sale', label: s.partName || 'Sale', meta: `${num(s.qty || s.quantity || 1)} sold`, color: '#60a5fa' }));
    restocks.forEach((r) => acts.push({ t: toMillis(r.receivedAt || r.createdAt || r.date), kind: 'receive', label: r.partName || 'Stock received', meta: `+${num(r.qty || r.quantity)}`, color: '#4ade80' }));
    stockAdjustments.forEach((a) => acts.push({ t: toMillis(a.adjustedAt || a.createdAt || a.date), kind: 'adjust', label: a.partName || 'Adjustment', meta: a.reason || 'adjusted', color: '#f59e0b' }));
    const activity = acts.filter((a) => a.t).sort((a, b) => b.t - a.t).slice(0, 7);

    // stock movement — last 14 days
    const dayMs = 86400000;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const start = today.getTime() - i * dayMs;
      const end = start + dayMs;
      const count = acts.filter((a) => a.t >= start && a.t < end).length;
      days.push({ label: new Date(start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), count });
    }

    const reorderNeeded = [...low, ...out].sort((a, b) => num(a.stock) - num(b.stock)).slice(0, 6);

    // today's stock movement (in from restocks, out from sales)
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();
    const todayIn = restocks.filter((r) => toMillis(r.receivedAt || r.createdAt || r.date) >= todayMs).reduce((s, r) => s + num(r.qty || r.quantity), 0);
    const todayOut = sales.filter((s) => toMillis(s.soldAt || s.createdAt || s.date) >= todayMs).reduce((sum, s) => sum + num(s.qty || s.quantity || 1), 0);
    const inStockCount = active.filter((p) => num(p.stock) > 0).length;
    const reservedUnits = active.reduce((s, p) => s + num(p.reserved), 0);

    return {
      total: active.length, value, profit, low: low.length, out: out.length,
      archived: archived.length, reorder: low.length + out.length, fastMovers,
      deadStock: deadStock.length, deadStockList: deadStock.slice(0, 5),
      topSelling, recentlyAdded, activity, days, segments, reorderNeeded,
      inStock: inStockCount, todayIn, todayOut, reservedUnits,
    };
  }, [inventory, sales, restocks, stockAdjustments]);

  const goParts = (filter) => onNavigate?.('inventory', { subView: 'parts', invFilter: filter });

  return (
    <div className="space-y-5">
      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Total Parts" value={m.total} icon={PackageSearch} color={GOLD} onClick={() => goParts('active')} />
        <Kpi label="In Stock" value={m.inStock} icon={PackageSearch} color="#34d399" onClick={() => goParts('instock')} />
        <Kpi label="Inventory Value" value={inr(m.value, formatINR)} icon={IndianRupee} color="#4ade80" onClick={() => goParts('instock')} />
        <Kpi label="Potential Profit" value={inr(m.profit, formatINR)} icon={TrendingUp} color="#22d3ee" onClick={() => goParts('active')} />
        <Kpi label="Low Stock" value={m.low} icon={AlertTriangle} color="#f59e0b" onClick={() => goParts('low')} />
        <Kpi label="Out of Stock" value={m.out} icon={PackageX} color="#ef4444" onClick={() => goParts('out')} />
        <Kpi label="Reorder Required" value={m.reorder} icon={RefreshCw} color="#fb923c" onClick={() => goParts('low')} />
        <Kpi label="Fast Movers" value={m.fastMovers} icon={Flame} color="#f472b6" onClick={() => goParts('fast')} />
        <Kpi label="Dead Stock" value={m.deadStock} icon={Snowflake} color="#60a5fa" onClick={() => goParts('dead')} />
        <Kpi label="Today's Stock In" value={m.todayIn} icon={RefreshCw} color="#4ade80" />
        <Kpi label="Today's Stock Out" value={m.todayOut} icon={RefreshCw} color="#f472b6" />
        <Kpi label="Reserved Stock" value={m.reservedUnits} icon={PackageSearch} color="#fbbf24" />
        <Kpi label="Archived" value={m.archived} icon={Archive} color="#a78bfa" onClick={() => goParts('archived')} />
      </div>

      {/* charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <SectionHead icon={Layers} title="Category distribution" />
          <Donut segments={m.segments} centerValue={m.total} centerLabel="parts" />
        </Card>
        <Card className="p-5">
          <SectionHead icon={TrendingUp} title="Stock movement" action={<span className="text-[11px] text-white/35">last 14 days</span>} />
          {m.days.some((d) => d.count) ? <MovementBars days={m.days} /> : <Empty>No stock movements recorded yet.</Empty>}
        </Card>
      </div>

      {/* lists row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Reorder required */}
        <Card className="p-5">
          <SectionHead icon={RefreshCw} title="Reorder required" action={m.reorder > 0 && <button onClick={() => goParts('low')} className="text-[11px] text-[#d4af37] hover:underline flex items-center gap-0.5">View all <ArrowRight size={11} /></button>} />
          {m.reorderNeeded.length ? (
            <div className="space-y-1.5">
              {m.reorderNeeded.map((p) => (
                <button key={p.id} onClick={() => onQuickReceive?.(p)} className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.04] transition text-left">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${num(p.stock) === 0 ? 'bg-red-500' : 'bg-amber-500'}`} />
                  <span className="flex-1 min-w-0 text-sm text-white/80 truncate">{p.name}</span>
                  <span className={`text-xs font-semibold ${num(p.stock) === 0 ? 'text-red-400' : 'text-amber-400'}`}>{num(p.stock)} / {num(p.minStock || 5)}</span>
                </button>
              ))}
            </div>
          ) : <Empty>Everything is well stocked. 🎉</Empty>}
        </Card>

        {/* Top selling */}
        <Card className="p-5">
          <SectionHead icon={Flame} title="Top selling parts" />
          {m.topSelling.length ? (
            <div className="space-y-1.5">
              {m.topSelling.map(({ p, sold }, i) => (
                <button key={p.id} onClick={() => onEditPart?.(p)} className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.04] transition text-left">
                  <span className="w-5 text-center text-xs font-bold text-white/30">{i + 1}</span>
                  <span className="flex-1 min-w-0 text-sm text-white/80 truncate">{p.name}</span>
                  <span className="text-xs font-semibold text-[#d4af37]">{sold} sold</span>
                </button>
              ))}
            </div>
          ) : <Empty>No sales recorded yet.</Empty>}
        </Card>

        {/* Recently added */}
        <Card className="p-5">
          <SectionHead icon={Plus} title="Recently added" />
          {m.recentlyAdded.length ? (
            <div className="space-y-1.5">
              {m.recentlyAdded.map((p) => (
                <button key={p.id} onClick={() => onEditPart?.(p)} className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.04] transition text-left">
                  <span className="flex-1 min-w-0 text-sm text-white/80 truncate">{p.name}</span>
                  <span className="text-[11px] text-white/35">{relTime(toMillis(p.createdAt))}</span>
                </button>
              ))}
            </div>
          ) : <Empty>No parts added yet.</Empty>}
        </Card>

        {/* Recent activity */}
        <Card className="p-5">
          <SectionHead icon={Clock} title="Recent stock activity" />
          {m.activity.length ? (
            <div className="space-y-2">
              {m.activity.map((a, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: a.color }} />
                  <span className="flex-1 min-w-0 text-sm text-white/75 truncate">{a.label}</span>
                  <span className="text-xs text-white/50">{a.meta}</span>
                  <span className="text-[11px] text-white/30 w-16 text-right">{relTime(a.t)}</span>
                </div>
              ))}
            </div>
          ) : <Empty>No recent activity.</Empty>}
        </Card>
      </div>
    </div>
  );
}
