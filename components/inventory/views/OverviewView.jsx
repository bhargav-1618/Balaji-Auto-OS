import { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard, ShieldCheck, Star, Sparkles, AlertTriangle, Check, ChevronRight,
  Trophy, TrendingUp, ShoppingCart, Zap, Plus, Users, PackagePlus, Upload, Send,
  Trash2, History,
} from 'lucide-react';
import {
  computeRange, computeInventoryHealth, computeWorkshopScore, computeInsights,
  computeWorkshopProgress,
} from '../../../services/analyticsService';
import { tsToDate, isSameDay, trendPct, asArray } from '../../../lib/format';
import { useTranslation } from '../../../lib/i18n';
import { SEMANTIC } from '../../../constants/ui';
import DateRangeControl from '../ui/DateRangeControl';
import { OverviewCard, DashEmpty, ScoreCard } from '../ui/DashboardCards';
import PageHeader from '../../common/PageHeader';
import PartImageThumb from '../ui/PartImageThumb';

// Refactor Phase 11 — OverviewView (the top-level Dashboard tab) extracted verbatim
// from InventoryDashboard.js. Presentation-only: local UI state + pure useMemo
// derivations over props; every mutation goes back through a callback prop. The
// shared analytics/format helpers already lived in services/lib; PartImageThumb is
// now an explicit `demoMode` prop (see ../ui/PartImageThumb).

// Insights is limited visual real estate — this caps how many ranked insights are ever
// shown at once. The engine itself returns every currently-relevant insight (already
// ranked); capping display (not generation) here keeps the "don't pad with low-value
// filler" rule in computeInsights fully decoupled from "how tall can this card be."
const MAX_INSIGHTS = 8;

function OverviewView({ inventory, demoMode = false, sales, suppliers, auditLog, restocks, stockAdjustments = [], reorderRequests = [], purchaseOrders = [], invoices = [], jobCards = [], customers = [], vehicles = [], lastSync, lastBackup, online, connError, onNavigate, onAddPart, onAddSupplier, onImport, onReorder, onAdvanceStatus, onClearRequest, onEditPart, isAdmin, canDestroy = true, onQuickSell, onQuickReceive }) {
  const { t } = useTranslation();
  const active = useMemo(() => inventory.filter((p) => !p.archived), [inventory]);
  const now = new Date();
  const yesterday = new Date(Date.now() - 86400000);

  // Insights heartbeat — Firestore listeners already push new data reactively (see the
  // onSnapshot subscriptions feeding inventory/sales/etc.), so most insight recomputation
  // needs no help. But a purely time-window fact ("3 new customers THIS WEEK") can go stale
  // with zero data changes simply because the calendar rolled over — nothing re-renders this
  // component to notice. A coarse 5-minute tick is enough to catch that boundary crossing
  // without turning this into a real-time polling surface (this is a back-office dashboard,
  // not a trading terminal).
  const [insightsTick, setInsightsTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setInsightsTick((t) => t + 1), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // --- Dashboard date range (drives all sales-based widgets) ---
  const [dateRange, setDateRange] = useState('today');
  const [customRange, setCustomRange] = useState({ start: '', end: '' });
  const range = useMemo(() => computeRange(dateRange, customRange), [dateRange, customRange]);
  const periodAgg = useMemo(() => {
    const len = Math.max(1, range.end - range.start);
    const prevStart = range.start - len - 1;
    const prevEnd = range.start - 1;
    const rev = (s) => s.revenue ?? s.total ?? 0;
    const qty = (s) => s.qty ?? s.quantity ?? 0;
    let revenue = 0, pro = 0, cnt = 0, pRev = 0, pPro = 0, pCnt = 0;
    sales.forEach((s) => {
      const d = tsToDate(s.createdAt); if (!d) return;
      const t = d.getTime();
      if (t >= range.start && t <= range.end) { revenue += rev(s); pro += s.profit || 0; cnt += 1; }
      else if (t >= prevStart && t <= prevEnd) { pRev += rev(s); pPro += s.profit || 0; pCnt += 1; }
    });
    return { rev: revenue, pro, cnt, pRev, pPro, pCnt };
  }, [sales, range]);

  // --- Today's Overview (real, from the sales ledger) ---
  const today = useMemo(() => {
    let revT = 0, proT = 0, cntT = 0, revY = 0, proY = 0, cntY = 0;
    sales.forEach((s) => {
      const d = tsToDate(s.createdAt);
      if (!d) return;
      if (isSameDay(d, now)) { revT += s.revenue || 0; proT += s.profit || 0; cntT += 1; }
      else if (isSameDay(d, yesterday)) { revY += s.revenue || 0; proY += s.profit || 0; cntY += 1; }
    });
    let movesIn = 0, movesOut = cntT;
    restocks.forEach((r) => { const d = tsToDate(r.createdAt); if (isSameDay(d, now)) movesIn += 1; });
    let adjToday = 0;
    stockAdjustments.forEach((a) => { const d = tsToDate(a.createdAt); if (isSameDay(d, now)) adjToday += 1; });
    return { revT, proT, cntT, revY, proY, cntY, movesIn, movesOut, adjToday };
  }, [sales, restocks]);

  // --- Inventory health ---
  const health = useMemo(() => {
    const total = active.length;
    const out = active.filter((p) => (p.stock || 0) === 0).length;
    const low = active.filter((p) => (p.stock || 0) > 0 && (p.stock || 0) <= (p.minStock || 5)).length;
    const healthy = total - out - low;
    return { total, out, low, healthy, pct: total ? Math.round((healthy / total) * 100) : 100 };
  }, [active]);

  // --- Reorder center (stock <= min) ---
  const reorder = useMemo(() => active
    .filter((p) => (p.stock || 0) <= (p.minStock || 5))
    .map((p) => {
      const need = Math.max((p.minStock || 5) * 2 - (p.stock || 0), (p.minStock || 5));
      const sup = asArray(p.suppliers).find((s) => s.isPreferred) || asArray(p.suppliers)[0]; // PH21-D1
      return { p, need, supplier: sup?.name || '—', cost: need * (p.purchasePrice || 0) };
    })
    .sort((a, b) => (a.p.stock || 0) - (b.p.stock || 0)), [active]);

  // --- Low stock (>0 and <= min) ---
  const lowStock = useMemo(() => active.filter((p) => (p.stock || 0) > 0 && (p.stock || 0) <= (p.minStock || 5)).sort((a, b) => (a.stock || 0) - (b.stock || 0)), [active]);

  // --- Recent activity (audit logs only) ---
  const ACT_LABEL = { delete_part: 'Part deleted', delete_supplier: 'Supplier deleted', price_change: 'Price changed', below_floor_sale: 'Below-floor sale', stock_adjustment: 'Stock adjusted', archive_part: 'Part archived', restore_part: 'Part restored', create_part: 'Part created', update_part: 'Part updated', sell_part: 'Sale recorded', quick_restock: 'Stock received', create_supplier: 'Supplier added', update_supplier: 'Supplier updated', po_create: 'Purchase order created', po_status: 'Purchase order updated' };
  const recent = useMemo(() => auditLog.slice(0, 6).map((e) => ({ id: e.id, label: ACT_LABEL[e.action] || e.action, name: e.name || '', when: tsToDate(e.createdAt) })), [auditLog]);

  // --- Top selling (from sales ledger within the selected range) ---
  const topSelling = useMemo(() => {
    const m = new Map();
    sales.forEach((s) => {
      if (!s.partId) return;
      const d = tsToDate(s.createdAt); if (!d) return;
      const t = d.getTime();
      if (t < range.start || t > range.end) return;
      const cur = m.get(s.partId) || { partId: s.partId, name: s.name || '', units: 0, revenue: 0 };
      cur.units += s.qty ?? s.quantity ?? 0; cur.revenue += s.revenue ?? s.total ?? 0;
      m.set(s.partId, cur);
    });
    return [...m.values()].sort((a, b) => b.units - a.units).slice(0, 5);
  }, [sales, range]);

  // --- Top suppliers (real: linked parts + purchase value of their stock) ---
  const topSuppliers = useMemo(() => suppliers.map((s) => {
    const linked = active.filter((p) => asArray(p.suppliers).some((sp) => sp.id === s.id || sp.name === s.name)); // PH21-D1
    const value = linked.reduce((sum, p) => sum + (p.purchasePrice || 0) * (p.stock || 0), 0);
    return { id: s.id, name: s.name, count: linked.length, value };
  }).filter((s) => s.count > 0).sort((a, b) => b.value - a.value).slice(0, 5), [suppliers, active]);

  const totalRecords = inventory.length + suppliers.length + sales.length + restocks.length + auditLog.length;
  const fmt = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
  const ago = (d) => {
    if (!d) return '—';
    const m = Math.floor((Date.now() - d.getTime()) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} hr ago`;
    return d.toLocaleDateString('en-IN');
  };

  const Trend = ({ pct }) => (
    <span className={`text-[11px] font-semibold ${pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{pct >= 0 ? '▲' : '▼'} {Math.abs(pct)}% vs prev</span>
  );

  const invHealth = useMemo(() => computeInventoryHealth(inventory), [inventory]);
  const workshop = useMemo(() => computeWorkshopScore({ inventory, sales, suppliers, alertsCount: health.out + health.low, invHealthScore: invHealth.score }), [inventory, sales, suppliers, health, invHealth]);
  // insightsTick (see the heartbeat above) is a deliberate time-only dependency: it never
  // changes a VALUE computeInsights reads, it just forces a periodic recompute so "this
  // week"/"today" time windows expire on schedule even with no other data change.
  const insights = useMemo(
    () => computeInsights({ inventory, sales, suppliers, purchaseOrders, restocks, invoices, jobCards, customers, stockAdjustments }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inventory, sales, suppliers, purchaseOrders, restocks, invoices, jobCards, customers, stockAdjustments, insightsTick]
  );
  const workshopProgress = useMemo(() => computeWorkshopProgress({ inventory, invoices, jobCards, sales }), [inventory, invoices, jobCards, sales]);

  return (
    <PageHeader title={t('page.dashboard', 'Dashboard')} icon={LayoutDashboard} subtitle={<>{t('dashboard.viewing', 'Viewing')} <span className="text-[#d4af37] font-semibold">{range.label}</span></>}
      action={<DateRangeControl value={dateRange} onChange={setDateRange} custom={customRange} onCustomChange={setCustomRange} label={range.label} />}>
      {/* Inventory Health + Workshop Score */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ScoreCard title="Inventory Health" icon={ShieldCheck} score={invHealth.score} factors={invHealth.factors} />
        <ScoreCard title="Workshop Score" icon={Star} score={workshop.score} suffix="/100" factors={workshop.factors} note="Weighted: inventory health 40%, sales activity 25%, supplier performance 20%, alert pressure 15%. Factors with no data yet are shown as N/A and excluded, with the remaining weights rescaled." />
      </div>

      {/* AI Insights + Workshop Progress. Dashboard Card Height review — this row used to
          carry items-start (added in an earlier pass so Workshop Progress's fixed
          7-metric checklist wouldn't get force-stretched into dead space by a
          content-heavy Insights day). That traded away the opposite, worse problem:
          on a QUIET day, a short Insights card sat at its own natural height next to a
          taller Workshop Progress, leaving a visible gap before the next row — "same
          row = same structural height" is the higher-priority rule now. Default grid
          stretch (no items-start) lets EVERY row auto-size to its tallest natural-height
          member and grows every sibling to match; a card with less content just shows
          extra room below its own content instead of being clipped or leaving a gap —
          see OverviewCard's own flex-col + DASH_CARD_MIN_H for how that room is used. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <OverviewCard className="lg:col-span-2">
          <h3 className="text-xs uppercase tracking-wider text-white/45 mb-3 flex items-center gap-2"><Sparkles size={14} className="text-[#d4af37]" /> Insights</h3>
          {insights.length ? (
            <div className="space-y-1">
              {insights.slice(0, MAX_INSIGHTS).map((it) => {
                const tone = it.severity === 'critical' ? 'text-red-400' : it.severity === 'warning' ? 'text-amber-400' : it.severity === 'positive' ? 'text-emerald-400' : 'text-white/45';
                const Icon = it.severity === 'critical' || it.severity === 'warning' ? AlertTriangle : Check;
                const content = (
                  <>
                    <Icon size={15} className={`${tone} flex-shrink-0`} />
                    <span className="flex-1 text-left">{it.text}</span>
                    {it.nav && <ChevronRight size={14} className="text-white/20 flex-shrink-0" />}
                  </>
                );
                return it.nav ? (
                  <button key={it.kind} onClick={() => onNavigate(it.nav.tab, it.nav.opts)} className="w-full flex items-center gap-2.5 text-sm text-white/80 py-1.5 px-1.5 -mx-1.5 rounded-lg hover:bg-white/[0.05] transition text-left">
                    {content}
                  </button>
                ) : (
                  <div key={it.kind} className="flex items-center gap-2.5 text-sm text-white/80 py-1.5 px-1.5">
                    {content}
                  </div>
                );
              })}
            </div>
          ) : (inventory.length === 0 && sales.length === 0 && suppliers.length === 0) ? (
            <DashEmpty icon={Sparkles} title="No insights yet" hint="Add parts and record sales to see trends here." />
          ) : (
            <div className="flex-1 flex items-center gap-2.5 text-sm text-white/60">
              <Check size={15} className="text-emerald-400 flex-shrink-0" />
              <div>
                <p className="font-semibold text-white/80">All caught up</p>
                <p className="text-xs text-white/45">No new activity or urgent issues right now.</p>
              </div>
            </div>
          )}
        </OverviewCard>
        <OverviewCard>
          <h3 className="text-xs uppercase tracking-wider text-white/45 mb-3 flex items-center gap-2"><Trophy size={14} className="text-[#d4af37]" /> Workshop Progress</h3>
          <div className="space-y-2.5">
            {workshopProgress.map((w) => (
              <div key={w.label}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-white/70">{w.label}</span>
                  <span className="text-white/90 font-semibold">{w.value}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(var(--fg-rgb),0.06)' }}>
                    <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${Math.max(0, Math.min(100, w.pct))}%`, background: w.pct >= 75 ? '#34d399' : w.pct >= 40 ? '#d4af37' : '#fb923c' }} />
                  </div>
                </div>
                {w.hint && <p className="text-[10px] text-white/45 mt-0.5">{w.hint}</p>}
              </div>
            ))}
          </div>
        </OverviewCard>
      </div>

      {/* Overview (date-range driven) + Inventory Health (live) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <OverviewCard className="lg:col-span-2">
          <h3 className="text-xs uppercase tracking-wider text-white/45 mb-3 flex items-center gap-2"><TrendingUp size={14} className="text-[#d4af37]" /> Overview · {range.label}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <p className="text-[11px] text-white/45">Revenue</p>
              <p className="text-xl font-bold text-white">{fmt(periodAgg.rev)}</p>
              <Trend pct={trendPct(periodAgg.rev, periodAgg.pRev)} />
            </div>
            <div>
              <p className="text-[11px] text-white/45">Profit</p>
              <p className="text-xl font-bold text-emerald-400">{fmt(periodAgg.pro)}</p>
              <Trend pct={trendPct(periodAgg.pro, periodAgg.pPro)} />
            </div>
            <div>
              <p className="text-[11px] text-white/45">Sales</p>
              <p className="text-xl font-bold text-white">{periodAgg.cnt}</p>
              <Trend pct={trendPct(periodAgg.cnt, periodAgg.pCnt)} />
            </div>
            <div>
              <p className="text-[11px] text-white/45">Avg order</p>
              <p className="text-xl font-bold text-white">{fmt(periodAgg.cnt ? periodAgg.rev / periodAgg.cnt : 0)}</p>
              <p className="text-[11px] text-white/45">per sale</p>
            </div>
          </div>
          {periodAgg.cnt === 0 && <p className="text-[11px] text-white/45 mt-3">No sales in this period.</p>}
        </OverviewCard>

        <OverviewCard>
          <h3 className="text-xs uppercase tracking-wider text-white/45 mb-3 flex items-center gap-2"><ShieldCheck size={14} className="text-[#d4af37]" /> Inventory Health</h3>
          <div className="flex items-center gap-4">
            <div className="relative w-20 h-20 flex-shrink-0">
              <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(var(--fg-rgb),0.08)" strokeWidth="3" />
                <circle cx="18" cy="18" r="15.9" fill="none" stroke={health.pct >= 70 ? '#34d399' : health.pct >= 40 ? '#d4af37' : '#ef4444'} strokeWidth="3" strokeDasharray={`${health.pct} ${100 - health.pct}`} strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-bold text-white">{health.pct}%</span>
              </div>
            </div>
            <div className="flex-1 space-y-1.5 text-sm">
              <div className="flex items-center justify-between"><span className="text-white/50">Low Stock</span><span className="font-bold text-[#d4af37]">{health.low}</span></div>
              <div className="flex items-center justify-between"><span className="text-white/50">Out of Stock</span><span className="font-bold text-red-400">{health.out}</span></div>
              <div className="flex items-center justify-between"><span className="text-white/50">Total Parts</span><span className="font-bold text-white">{health.total}</span></div>
            </div>
          </div>
        </OverviewCard>
      </div>

      {/* Reorder Center + Quick Actions — Dashboard Card Height review: this row
          previously carried items-start (added to stop Quick Actions' fixed 5-button
          panel from being stretched into dead space below Reorder Center's taller
          table). Reversed: "same row, same outer card height" is the higher-priority
          rule now — Quick Actions' outer card grows to match Reorder Center's, its own
          5 buttons stay naturally sized at the top with room below rather than being
          stretched/duplicated/padded with filler. Default grid stretch (no items-start)
          achieves that automatically; see the Insights/Workshop Progress row above for
          the full reasoning. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <OverviewCard className="lg:col-span-2">
          <h3 className="text-xs uppercase tracking-wider text-white/45 mb-3 flex items-center gap-2"><ShoppingCart size={14} className="text-[#d4af37]" /> Reorder Center</h3>
          {reorder.length === 0 ? (
            <DashEmpty icon={ShoppingCart} title="Nothing needs reordering 🎉" hint="All parts are above their minimum stock level." />
          ) : (
            <div className="space-y-1">
              <div className="hidden sm:grid grid-cols-12 gap-2 px-2 pb-1 text-[10px] uppercase tracking-wider text-white/45">
                <span className="col-span-4">Part</span><span className="col-span-1 text-center">Stock</span><span className="col-span-1 text-center">Min</span><span className="col-span-1 text-center">Need</span><span className="col-span-2">Supplier</span><span className="col-span-1 text-right">Cost</span><span className="col-span-2 text-right">Action</span>
              </div>
              {reorder.slice(0, 6).map(({ p, need, supplier, cost }) => (
                <div key={p.id} className="grid grid-cols-12 gap-2 items-center px-2 py-1.5 rounded-lg hover:bg-white/[0.04]">
                  <button onClick={() => onEditPart(p)} className="col-span-12 sm:col-span-4 flex items-center gap-2 text-left min-w-0">
                    <PartImageThumb src={p.imageString} alt={p.name} demoMode={demoMode} />
                    <span className="min-w-0"><span className="block text-sm text-white truncate">{p.name}</span><span className="block text-[10px] text-white/45">{p.sku || '—'}</span></span>
                  </button>
                  <span className="col-span-1 text-center text-sm font-bold text-red-400">{p.stock || 0}</span>
                  <span className="hidden sm:block col-span-1 text-center text-sm text-white/50">{p.minStock || 5}</span>
                  <span className="hidden sm:block col-span-1 text-center text-sm font-bold text-[#d4af37]">{need}</span>
                  <span className="hidden sm:block col-span-2 text-xs text-white/60 truncate">{supplier}</span>
                  <span className="hidden sm:block col-span-1 text-right text-xs text-white/70">{fmt(cost)}</span>
                  <div className="col-span-12 sm:col-span-2 flex justify-end">
                    <button onClick={() => onReorder(p)} className="px-3 py-1 rounded-lg text-[11px] font-bold bg-[#d4af37]/15 text-[#d4af37] border border-[#d4af37]/30 hover:bg-[#d4af37]/25">Order</button>
                  </div>
                </div>
              ))}
              {reorder.length > 6 && (
                <button onClick={() => onNavigate('inventory', { subView: 'parts', invFilter: 'reorder' })} className="w-full mt-2 py-2 text-xs font-semibold text-[#d4af37] hover:underline">View all {reorder.length} reorder items →</button>
              )}
            </div>
          )}
        </OverviewCard>

        <OverviewCard>
          <h3 className="text-xs uppercase tracking-wider text-white/45 mb-3 flex items-center gap-2"><Zap size={14} className="text-[#d4af37]" /> Quick Actions</h3>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Add Part', icon: Plus, onClick: onAddPart },
              { label: 'Add Supplier', icon: Users, onClick: onAddSupplier },
              { label: 'Receive Stock', icon: PackagePlus, onClick: onQuickReceive },
              { label: 'Record Sale', icon: ShoppingCart, onClick: onQuickSell },
              { label: 'Import', icon: Upload, onClick: onImport, full: true },
            ].map((a) => (
              <button key={a.label} onClick={a.onClick} className={`${a.full ? 'col-span-2' : ''} flex flex-col items-center justify-center gap-1.5 py-4 rounded-xl bg-white/[0.03] border border-white/8 hover:border-[#d4af37]/40 hover:bg-[#d4af37]/[0.06] transition`}>
                <a.icon size={18} className="text-[#d4af37]" />
                <span className="text-[11px] font-semibold text-white/80">{a.label}</span>
              </button>
            ))}
          </div>
        </OverviewCard>
      </div>

      {/* Pending Supplier Actions — real reorder requests, status-tracked */}
      <OverviewCard>
        <h3 className="text-xs uppercase tracking-wider text-white/45 mb-3 flex items-center gap-2"><Send size={14} className="text-[#d4af37]" /> Pending Supplier Actions</h3>
        {(() => {
          const pending = reorderRequests.filter((r) => r.status !== 'Delivered');
          if (pending.length === 0) return <DashEmpty icon={Send} title="No pending supplier requests" hint="Use “Order” in the Reorder Center to start one." />;
          // H-10: was inline hex duplicated from the shared palette. NOT routed through
          // the shared statusColor()/STATUS_COLOR lookup — these are purchase-order
          // statuses, not in that map's vocabulary at all ('Requested'/'Awaiting
          // Delivery' would silently fall back to muted), and STATUS_COLOR's own
          // 'Delivered' (job-card sense, SEMANTIC.okAlt = #4ade80) is a different, already
          //-documented value than this PO sense (#34d399) — routing through the shared
          // lookup would visibly change this specific badge. Sourcing the TOKENS directly
          // preserves the exact existing colours while still removing the duplicated hex.
          const poStatusColor = { 'Requested': SEMANTIC.gold, 'Awaiting Delivery': SEMANTIC.info, 'Delivered': SEMANTIC.ok };
          return (
            <div className="space-y-1">
              <div className="hidden sm:grid grid-cols-12 gap-2 px-2 pb-1 text-[10px] uppercase tracking-wider text-white/45">
                <span className="col-span-3">Supplier</span><span className="col-span-3">Part</span><span className="col-span-1 text-center">Qty</span><span className="col-span-2">Requested</span><span className="col-span-3 text-right">Status / Action</span>
              </div>
              {pending.map((r) => {
                const d = tsToDate(r.createdAt);
                return (
                  <div key={r.id} className="grid grid-cols-12 gap-2 items-center px-2 py-1.5 rounded-lg hover:bg-white/[0.04]">
                    <span className="col-span-6 sm:col-span-3 text-sm text-white/85 truncate">{r.supplierName}</span>
                    <span className="col-span-6 sm:col-span-3 text-sm text-white/60 truncate">{r.partName}</span>
                    <span className="hidden sm:block col-span-1 text-center text-sm text-[#d4af37] font-bold">{r.qty}</span>
                    <span className="hidden sm:block col-span-2 text-[11px] text-white/45">{d ? d.toLocaleDateString('en-IN') : '—'}</span>
                    <div className="col-span-12 sm:col-span-3 flex items-center justify-end gap-1.5">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${poStatusColor[r.status]}22`, color: poStatusColor[r.status] }}>{r.status}</span>
                      {r.status !== 'Delivered' && (
                        <button onClick={() => onAdvanceStatus(r)} className="text-[10px] font-semibold px-2 py-0.5 rounded bg-white/8 text-white/70 hover:bg-white/15" title="Advance status">
                          {r.status === 'Requested' ? '→ Awaiting' : '→ Delivered'}
                        </button>
                      )}
                      {canDestroy && (<button onClick={() => onClearRequest(r)} className="text-white/45 hover:text-red-400" title="Remove request"><Trash2 size={12} /></button>)}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </OverviewCard>

      {/* Low Stock + Recent Activity + Top Selling — Dashboard Card Height review, the
          flagship reported case: Low Stock Alerts (thumbnail rows, usually the tallest)
          left Recent Activity and especially an empty Top Selling ("No sales recorded
          yet") sitting at their own short natural height, with a visible gap before the
          next row. This row previously carried items-start specifically to let each card
          size independently — reversed here: default grid stretch makes every card in
          this row match the tallest one's outer height, and DashEmpty (see Top Selling's
          empty branch below) centers its message inside whatever height that turns out
          to be, instead of sitting orphaned at the top of a short, collapsed card. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <OverviewCard>
          <h3 className="text-xs uppercase tracking-wider text-white/45 mb-3 flex items-center gap-2"><AlertTriangle size={14} className="text-[#d4af37]" /> Low Stock Alerts</h3>
          {lowStock.length === 0 ? (
            <DashEmpty icon={AlertTriangle} title="No low-stock parts" hint="Every part is comfortably above its minimum stock level." />
          ) : (
            <div className="space-y-1">
              {lowStock.slice(0, 5).map((p) => (
                <button key={p.id} onClick={() => onQuickReceive(p)} title="Receive stock for this part" className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] text-left">
                  <PartImageThumb src={p.imageString} alt={p.name} demoMode={demoMode} />
                  <span className="min-w-0 flex-1"><span className="block text-sm text-white truncate">{p.name}</span><span className="block text-[10px] text-white/45">{p.sku || '—'}</span></span>
                  <span className="text-xs text-white/50">{p.stock}/{p.minStock || 5}</span>
                  <span className="text-[10px] font-bold text-red-400">Low</span>
                </button>
              ))}
              {/* Universal drill-down navigation review — this card silently capped at
                  5 with no way to see the rest, the same "hidden data, no discovery
                  path" gap the Reorder Center's own link was built to close. invFilter
                  'low' is narrower than Reorder Center's 'reorder' (which also includes
                  fully out-of-stock parts) — a genuinely distinct, already-supported
                  filter, not a duplicate of that link. */}
              {lowStock.length > 5 && (
                <button onClick={() => onNavigate('inventory', { subView: 'parts', invFilter: 'low' })} className="w-full mt-2 py-2 text-xs font-semibold text-[#d4af37] hover:underline">View all {lowStock.length} low-stock parts →</button>
              )}
            </div>
          )}
        </OverviewCard>

        <OverviewCard>
          <h3 className="text-xs uppercase tracking-wider text-white/45 mb-3 flex items-center gap-2"><History size={14} className="text-[#d4af37]" /> Recent Activity</h3>
          {recent.length === 0 ? (
            <DashEmpty icon={History} title="No activity yet" hint="Sales, stock changes and job updates will appear here." />
          ) : (
            <div className="space-y-1.5">
              {recent.map((r) => (
                <div key={r.id} className="flex items-center gap-2 text-sm py-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#d4af37] flex-shrink-0" />
                  <span className="flex-1 min-w-0 truncate text-white/80">{r.label}{r.name ? <span className="text-white/45"> · {r.name}</span> : ''}</span>
                  <span className="text-[10px] text-white/45 flex-shrink-0">{ago(r.when)}</span>
                </div>
              ))}
            </div>
          )}
        </OverviewCard>

        <OverviewCard>
          <h3 className="text-xs uppercase tracking-wider text-white/45 mb-3 flex items-center gap-2"><Star size={14} className="text-[#d4af37]" /> Top Selling · {range.label}</h3>
          {topSelling.length === 0 ? (
            <DashEmpty icon={Star} title="No sales recorded yet" hint="Sales will appear here once transactions come in." />
          ) : (
            <div>
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 pb-1.5 mb-1 border-b border-white/5 text-[10px] uppercase tracking-wider text-white/45">
                <span>Product</span>
                <span className="text-right">Qty</span>
                <span className="text-right min-w-[70px]">Revenue</span>
              </div>
              <div className="space-y-1.5">
                {topSelling.map((t) => (
                  <div key={t.partId} className="grid grid-cols-[1fr_auto_auto] gap-x-4 items-center text-sm">
                    <span className="min-w-0 truncate text-white/85">{t.name}</span>
                    <span className="text-right tabular-nums text-white font-semibold">{t.units}</span>
                    <span className="text-right tabular-nums text-white/50 min-w-[70px]">{fmt(t.revenue)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </OverviewCard>
      </div>

      {/* Top Suppliers (System Status lives in the sidebar + Settings — not repeated here) */}
      <div className="grid grid-cols-1 gap-4">
        <OverviewCard>
          <h3 className="text-xs uppercase tracking-wider text-white/45 mb-3 flex items-center gap-2"><Users size={14} className="text-[#d4af37]" /> Top Suppliers</h3>
          {topSuppliers.length === 0 ? (
            <DashEmpty icon={Users} title="No suppliers linked to parts yet" />
          ) : (
            <div className="space-y-1">
              <div className="hidden sm:grid grid-cols-12 gap-2 px-2 pb-1 text-[10px] uppercase tracking-wider text-white/45">
                <span className="col-span-6">Supplier</span><span className="col-span-3 text-center">Parts Supplied</span><span className="col-span-3 text-right">Stock Value</span>
              </div>
              {topSuppliers.map((s) => (
                <div key={s.id} className="grid grid-cols-12 gap-2 items-center px-2 py-1.5 rounded-lg hover:bg-white/[0.04]">
                  <span className="col-span-6 text-sm text-white/85 truncate">{s.name}</span>
                  <span className="col-span-3 text-center text-sm text-white/60">{s.count}</span>
                  <span className="col-span-3 text-right text-sm font-semibold text-[#d4af37]">{fmt(s.value)}</span>
                </div>
              ))}
              {/* This top-5-by-stock-value ranking is a teaser for a real destination
                  (SupplierPerformance.jsx) that already exists — full ranking across
                  every metric, not just stock value, with search/sort/comparison. Not
                  phrased "View all N" like the other cards: this isn't revealing more
                  ROWS of the same metric, it's pointing at the fuller analysis tool. */}
              <button onClick={() => onNavigate('suppliers', { subView: 'performance' })} className="w-full mt-2 py-2 text-xs font-semibold text-[#d4af37] hover:underline">View Supplier Performance →</button>
            </div>
          )}
        </OverviewCard>
      </div>
    </PageHeader>
  );
}

export default OverviewView;
