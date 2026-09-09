// components/inventory/views/AnalyticsView.jsx
//
// REFACTOR PHASE 10 — the Executive Analytics tab, extracted verbatim from
// InventoryDashboard.js. Pure props -> JSX: it reads no Firestore, owns no
// transaction/persistence/navigation state, and every figure is computed from
// the data it is handed (inventory / sales / rollups / restocks / auditLog /
// stockAdjustments) plus the shared, canonical inventory helpers moved to
// services/inventoryService.js in Phase 9. `onEditPart` and the capacity /
// export callbacks come in as props.
//
// Moved together (all AnalyticsView-only): AuditLogPanel (purely presentational,
// consumes props; CapacityBanner still owns its own cleanup), the ASearch /
// ViewMoreBar presentational bits, and the SEVERITY / AGING_BUCKETS /
// AUDIT_FILTERS constants. `partMatchesQuery` stays inline in AnalyticsView
// (pure — needs only safeLower + the part object).

import { useState, useEffect, useMemo } from 'react';
import {
  Search, BarChart3, Download, TrendingUp, Wrench, Users,
  PackagePlus, PackageX, Zap, Archive, Edit3, ShieldCheck,
} from 'lucide-react';
import {
  asList, brandsOf, lockedCapital, expectedProfit, partIsUniversal,
  flattenVehicles, ageDays, isDeadStock,
} from '../../../services/inventoryService';
import { formatINR, tsToDate, safeLower } from '../../../lib/format';
import { useDeferredSearch, useSearchIndex, matchIndexed } from '../../../lib/useSearch';
import { useViewMore } from '../../../hooks/useViewMore';
import { ACard } from '../ui/DashboardCards';
import AuditRow from '../ui/AuditRow';
import PageHeader from '../../common/PageHeader';
import MiniSelect from '../../common/MiniSelect';
import CapacityBanner from '../../common/CapacityBanner';
import notify from '../../common/notify';
import toast from '../../../lib/toast';

// Local copies of two tiny pure formatters and the copy-suffix stripper — the
// same local-copy tradeoff Phase 3/8 made for `inr` in LedgerViews and
// `RPT_COLORS` in ReportsView. `baseName` still has its own definition in the
// container (part-copy business logic); this is the read-only display use.
const inr = (n) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const RPT_COLORS = ['#d4af37', '#60a5fa', '#34d399', '#f472b6', '#a78bfa', '#fbbf24', '#22d3ee', '#fb923c'];
const baseName = (s) => safeLower(s).replace(/\s*\(copy(?:\s*\d+)?\)\s*$/i, '').trim();

const ASearch = ({ value, onChange, placeholder }) => (
  <div className="relative">
    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/45" />
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder || 'Search…'} className="w-40 sm:w-52 pl-7 pr-2 py-1.5 rounded-lg text-xs outline-none bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-[#d4af37]/60" />
  </div>
);

const ViewMoreBar = ({ pager, label }) =>
  pager.total === 0 ? null : (
    <div className="flex items-center justify-between mt-3 text-[11px] text-white/45">
      <span>Showing {pager.shown} of {pager.total} {label}</span>
      {pager.hasMore && (
        <button onClick={pager.showMore} className="px-3 py-1 rounded-lg font-semibold text-[#d4af37] bg-[#d4af37]/10 border border-[#d4af37]/30 hover:bg-[#d4af37]/20 transition">View More</button>
      )}
    </div>
  );

const SEVERITY = {
  '0–30 Days': { dot: '#34d399', label: 'Healthy' },
  '31–60 Days': { dot: '#fbbf24', label: 'Attention' },
  '61–90 Days': { dot: '#f59e0b', label: 'Aging' },
  '91–180 Days': { dot: '#fb923c', label: 'Aging' },
  '180+ Days': { dot: '#f87171', label: 'Critical' },
};
const AGING_BUCKETS = [
  { key: '0–30 Days', min: 0, max: 30 },
  { key: '31–60 Days', min: 31, max: 60 },
  { key: '61–90 Days', min: 61, max: 90 },
  { key: '91–180 Days', min: 91, max: 180 },
  { key: '180+ Days', min: 181, max: Infinity },
];

// brandsOf moved to services/inventoryService.js (Refactor Phase 9).

// Issues 6/7/8: audit log with search, filter, and Load-More pagination so the
// panel stays fast as entries grow. (The live subscription caps the loaded set;
// true 10k-scale needs server-side cursors — noted in the report.)
const AUDIT_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'stock_adjustment', label: 'Stock Adjustments' },
  { key: 'Damage', label: 'Damage' },
  { key: 'Lost Item', label: 'Lost Items' },
  { key: 'Personal Use', label: 'Personal Use' },
  { key: 'Correction', label: 'Corrections' },
  { key: 'price_change', label: 'Price Changes' },
  { key: 'below_floor_sale', label: 'Below-floor Sales' },
  { key: 'delete_supplier', label: 'Supplier Changes' },
  { key: 'archive_part', label: 'Archives' },
  { key: 'restore_part', label: 'Restores' },
  { key: 'delete_part', label: 'Deletions' },
];
function AuditLogPanel({ auditLog, demoMode, actorEmail, capacityRefreshTick = 0, onCleanupComplete }) {
  const [q, setQ] = useState('');
  const [dq] = useDeferredSearch(q);
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const PER = 25;

  // Universal Search review: partId/supplierId/entityId (identifiers) are now
  // exact-then-partial matched via rankIndexed, isolated from name/user/action/reason
  // (free text) — previously all folded into one substring-matched string, so an exact
  // part id could accidentally surface an unrelated entry that merely contains it.
  const auditSearchIndex = useSearchIndex(
    auditLog,
    (e) => e.id,
    (e) => [e.name, e.performedByEmail, e.action, e.details?.reason],
    (e) => [e.partId, e.supplierId, e.entityId],
  );
  const filtered = useMemo(() => {
    return auditLog.filter((e) => {
      // filter by action, or by adjustment reason for the reason-level filters.
      if (filter !== 'all') {
        const reasonFilters = ['Damage', 'Lost Item', 'Personal Use', 'Correction'];
        if (reasonFilters.includes(filter)) {
          if (e.action !== 'stock_adjustment' || (e.details?.reason || '') !== filter) return false;
        } else if (e.action !== filter) return false;
      }
      return matchIndexed(auditSearchIndex.get(e.id), dq);
    });
  }, [auditLog, dq, filter, auditSearchIndex]);

  const shown = filtered.slice(0, page * PER);
  useEffect(() => { setPage(1); }, [dq, filter]);

  const fld = 'px-3 py-2 rounded-lg text-xs outline-none bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60';
  return (
    <ACard title="Audit Log" icon={ShieldCheck}>
      <CapacityBanner
        moduleKey="auditLog"
        demoMode={demoMode}
        actorEmail={actorEmail}
        refreshKey={`${auditLog.length}-${capacityRefreshTick}`}
        onCleanupComplete={onCleanupComplete}
        className="mb-3"
      />
      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search part, user, action…" className={`${fld} flex-1`} />
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className={fld}>
          {AUDIT_FILTERS.map((f) => <option key={f.key} value={f.key} className="bg-[#111]">{f.label}</option>)}
        </select>
      </div>
      {filtered.length === 0 ? (
        <p className="text-xs text-white/45">{auditLog.length === 0 ? 'No audited actions yet. Deletes, price changes, below-floor sales, archives, restores, and stock adjustments are recorded here.' : 'No entries match your search / filter.'}</p>
      ) : (
        <>
          <p className="text-[11px] text-white/45 mb-2">Showing {shown.length} of {filtered.length}</p>
          <div className="space-y-1.5">
            {shown.map((e) => <AuditRow key={e.id} e={e} />)}
          </div>
          {shown.length < filtered.length && (
            <button onClick={() => setPage((p) => p + 1)} className="w-full mt-3 py-2 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-white/70 hover:bg-white/10">
              Load more ({filtered.length - shown.length} remaining)
            </button>
          )}
        </>
      )}
    </ACard>
  );
}

function AnalyticsView({ inventory, sales = [], rollups = [], restocks = [], auditLog = [], stockAdjustments = [], onEditPart, demoMode, demoCanExport = true, onProtectedAction, actorEmail, capacityRefreshTick = 0, onAuditCleanupComplete }) {
  // ---- Global filters (apply to all part-based sections) ----
  const [fCategory, setFCategory] = useState('All');
  const [fBrand, setFBrand] = useState('All');
  const [range, setRange] = useState('6m'); // trend date range

  const categoryOpts = useMemo(() => ['All', ...new Set(inventory.flatMap((p) => [p.category, ...asList(p.categories)]).filter(Boolean))], [inventory]);
  const brandOpts = useMemo(() => ['All', ...new Set(inventory.flatMap((p) => brandsOf(p)).filter(Boolean))], [inventory]);

  const parts = useMemo(
    () =>
      inventory.filter(
        (p) =>
          (fCategory === 'All' || p.category === fCategory || asList(p.categories).includes(fCategory)) &&
          (fBrand === 'All' || brandsOf(p).includes(fBrand))
      ),
    [inventory, fCategory, fBrand]
  );

  // ---- KPI + capital health ----
  const kpi = useMemo(() => {
    const totalLocked = parts.reduce((s, p) => s + lockedCapital(p), 0);
    const totalProfit = parts.reduce((s, p) => s + expectedProfit(p), 0);
    const deadCapital = parts.filter((p) => (p.salesCount || 0) === 0).reduce((s, p) => s + lockedCapital(p), 0);
    const healthyCapital = Math.max(0, totalLocked - deadCapital);
    const deadPct = totalLocked > 0 ? Math.round((deadCapital / totalLocked) * 100) : 0;
    return { totalLocked, totalProfit, deadCapital, healthyCapital, deadPct };
  }, [parts]);

  // ---- 1. Monthly Profit Trend ----
  // FIX-07: prefer the unbounded monthly rollups; fall back to aggregating the
  // (capped) recent ledger only if no rollups exist yet.
  const trend = useMemo(() => {
    const monthsBack = { '30d': 1, '3m': 3, '6m': 6, '12m': 12 }[range]; // undefined = all
    let series;
    if (rollups.length) {
      series = rollups
        .map((r) => ({ key: r.month, revenue: r.revenue || 0, cost: r.cost || 0, profit: r.profit ?? (r.revenue || 0) - (r.cost || 0) }))
        .filter((m) => m.key)
        .sort((a, b) => a.key.localeCompare(b.key));
      if (monthsBack) series = series.slice(-monthsBack);
    } else {
      const days = { '30d': 30, '3m': 90, '6m': 180, '12m': 365 }[range];
      const cutoff = days ? Date.now() - days * 86400000 : 0;
      const months = new Map();
      sales.forEach((s) => {
        const d = tsToDate(s.createdAt);
        if (!d || d.getTime() < cutoff) return;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const e = months.get(key) || { key, revenue: 0, cost: 0, profit: 0 };
        e.revenue += s.revenue || 0;
        e.cost += s.cost || 0;
        e.profit += s.profit ?? (s.revenue || 0) - (s.cost || 0);
        months.set(key, e);
      });
      series = [...months.values()].sort((a, b) => a.key.localeCompare(b.key));
    }
    const totRev = series.reduce((s, m) => s + m.revenue, 0);
    const totCost = series.reduce((s, m) => s + m.cost, 0);
    const totProfit = totRev - totCost;
    const margin = totRev > 0 ? (totProfit / totRev) * 100 : 0;
    const best = series.reduce((b, m) => (!b || m.profit > b.profit ? m : b), null);
    const worst = series.reduce((b, m) => (!b || m.profit < b.profit ? m : b), null);
    const bestRev = series.reduce((b, m) => (!b || m.revenue > b.revenue ? m : b), null);
    const avg = series.length ? totProfit / series.length : 0;
    const last = series[series.length - 1];
    const prev = series[series.length - 2];
    const growth = last && prev && prev.profit !== 0 ? ((last.profit - prev.profit) / Math.abs(prev.profit)) * 100 : null;
    return { series, totRev, totCost, totProfit, margin, best, worst, bestRev, avg, growth };
  }, [sales, rollups, range]);

  // FIX-04: single source of truth for money figures — aggregate the sales LEDGER
  // per part (revenue/cost/profit snapshotted at the actual sale price), instead
  // of salesCount × current price. Keeps Top Parts / Fast Movers / Vehicle
  // Analytics consistent with the Monthly Profit Trend.
  const ledgerByPart = useMemo(() => {
    const m = new Map();
    sales.forEach((s) => {
      const e = m.get(s.partId) || { units: 0, revenue: 0, cost: 0, profit: 0 };
      e.units += s.qty || 0;
      e.revenue += s.revenue || 0;
      e.cost += s.cost || 0;
      e.profit += s.profit ?? (s.revenue || 0) - (s.cost || 0);
      m.set(s.partId, e);
    });
    return m;
  }, [sales]);
  const L = (p) => ledgerByPart.get(p.id) || { units: 0, revenue: 0, cost: 0, profit: 0 };
  const pUnits = (p) => L(p).units;
  const pRev = (p) => L(p).revenue;
  const pProfit = (p) => L(p).profit;
  const pMargin = (p) => { const r = L(p).revenue; return r > 0 ? (L(p).profit / r) * 100 : 0; };

  // GLOBAL SEARCH ACCURACY: these three widgets (Top Profitable Parts, Fast Movers, Dead
  // Stock) are ranked LEADERBOARDS sorted by a business metric (profit/units/locked
  // capital) — their search box FILTERS which parts appear, it doesn't re-rank them by
  // relevance (that would defeat the point of a profit-sorted or units-sorted list).
  // Previously the filter only checked `p.name`, so searching a part's own SKU/OEM/
  // barcode/Part No. — the same identifiers searchable everywhere else in Inventory —
  // silently matched nothing. Reused across all three below.
  const partMatchesQuery = (p, q) => !q || safeLower(p.name).includes(q)
    || (p.sku && safeLower(p.sku).includes(q)) || (p.oemNo && safeLower(p.oemNo).includes(q))
    || (p.barcode && safeLower(p.barcode).includes(q)) || (p.partNo && safeLower(p.partNo).includes(q));

  // ---- 2. Top Profitable Parts ----
  const [ppSearch, setPpSearch] = useState('');
  const [ppSort, setPpSort] = useState('profit');
  const profitable = useMemo(() => {
    const q = safeLower(ppSearch);
    return parts
      .filter((p) => pUnits(p) > 0 && partMatchesQuery(p, q))
      .sort((a, b) => (ppSort === 'margin' ? pMargin(b) - pMargin(a) : ppSort === 'revenue' ? pRev(b) - pRev(a) : pProfit(b) - pProfit(a)));
  }, [parts, ppSearch, ppSort, ledgerByPart]);
  const ppPager = useViewMore(profitable, 10, ppSearch + ppSort);

  // ---- 3. Vehicle Analytics ----
  const [vehMode, setVehMode] = useState('brand');
  const [vehSearch, setVehSearch] = useState('');
  const vehAgg = useMemo(() => {
    const brands = new Map();
    const models = new Map();
    parts.forEach((p) => {
      const units = pUnits(p);
      if (!units) return;
      const rev = pRev(p);
      const prof = pProfit(p);
      const grouped = Array.isArray(p.compatibleCars) && typeof p.compatibleCars[0] === 'object' ? p.compatibleCars : null;
      let bList = [];
      let mList = [];
      // Issue 5: a Universal part is bucketed once under "Universal" — never
      // duplicated across every brand (which would inflate vehicle analytics).
      if (partIsUniversal(p)) { bList = ['Universal']; mList = ['Universal']; }
      else if (grouped) grouped.forEach((g) => { if (g.brand) bList.push(g.brand); (g.models || []).forEach((m) => mList.push(m)); });
      else { mList = flattenVehicles(p.compatibleCars); if (p.vehicle) bList = [p.vehicle]; }
      if (!bList.length) bList = ['Unspecified'];
      if (!mList.length) mList = ['Unspecified'];
      bList.forEach((b) => { const e = brands.get(b) || { name: b, units: 0, rev: 0, prof: 0 }; e.units += units; e.rev += rev; e.prof += prof; brands.set(b, e); });
      mList.forEach((m) => { const e = models.get(m) || { name: m, units: 0, rev: 0, prof: 0 }; e.units += units; e.rev += rev; e.prof += prof; models.set(m, e); });
    });
    const toArr = (map) => {
      const arr = [...map.values()];
      const totRev = arr.reduce((s, x) => s + x.rev, 0) || 1;
      const totUnits = arr.reduce((s, x) => s + x.units, 0) || 1;
      arr.forEach((x) => { x.revPct = (x.rev / totRev) * 100; x.unitPct = (x.units / totUnits) * 100; });
      return arr.sort((a, b) => b.rev - a.rev);
    };
    return { brands: toArr(brands), models: toArr(models) };
  }, [parts, ledgerByPart]);
  const vehRows = useMemo(() => {
    const q = safeLower(vehSearch);
    return (vehMode === 'brand' ? vehAgg.brands : vehAgg.models).filter((r) => !q || safeLower(r.name).includes(q));
  }, [vehAgg, vehMode, vehSearch]);
  const vehPager = useViewMore(vehRows, 10, vehSearch + vehMode);

  // ADD-05: sales by staff (from the ledger's soldByEmail).
  // Revenue mix (Parts vs Labour vs Service vs Outside), top services, technician
  // productivity, most-profitable service/part — the "how does my garage earn?"
  // analytics (#9). All sourced from the sales ledger.
  const catOfSale = (s) => s.revenueType || s.category || (s.partId ? 'Parts' : 'Service');
  const revenueMix = useMemo(() => {
    const m = {};
    sales.forEach((s) => { const c = catOfSale(s); m[c] = (m[c] || 0) + (s.revenue || 0); });
    const total = Object.values(m).reduce((a, b) => a + b, 0) || 1;
    const order = ['Parts', 'Labour', 'Service', 'Outside Purchase', 'Miscellaneous'];
    return order.filter((c) => m[c]).map((c, i) => ({ label: c, value: m[c], pct: (m[c] / total) * 100, color: RPT_COLORS[i % RPT_COLORS.length] }));
  }, [sales]);
  const topServices = useMemo(() => {
    const m = new Map();
    sales.filter((s) => catOfSale(s) === 'Service' || catOfSale(s) === 'Labour').forEach((s) => {
      const e = m.get(s.name) || { name: s.name, revenue: 0, count: 0, profit: 0 };
      e.revenue += s.revenue || 0; e.profit += s.profit || 0; e.count += 1; m.set(s.name, e);
    });
    return [...m.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  }, [sales]);
  const techAgg = useMemo(() => {
    const m = new Map();
    sales.filter((s) => s.technician).forEach((s) => {
      const e = m.get(s.technician) || { name: s.technician, revenue: 0, jobs: 0, hours: 0 };
      e.revenue += s.revenue || 0; e.jobs += 1; e.hours += Number(s.hours || s.qty) || 0; m.set(s.technician, e);
    });
    return [...m.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  }, [sales]);

  const staffAgg = useMemo(() => {
    const m = new Map();
    sales.forEach((s) => {
      const key = s.soldByEmail || 'Unknown';
      const e = m.get(key) || { name: key, units: 0, revenue: 0, profit: 0, orders: 0 };
      e.units += s.qty || 0;
      e.revenue += s.revenue || 0;
      e.profit += s.profit ?? (s.revenue || 0) - (s.cost || 0);
      e.orders += 1;
      m.set(key, e);
    });
    return [...m.values()].sort((a, b) => b.revenue - a.revenue);
  }, [sales]);

  // ADD-02: restock spend — total, this month, and by supplier.
  const restockAgg = useMemo(() => {
    const now = new Date();
    const thisKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    let total = 0, month = 0, units = 0;
    const bySup = new Map();
    restocks.forEach((r) => {
      const t = r.total || (r.qty || 0) * (r.unitCost || 0);
      total += t;
      units += r.qty || 0;
      const d = tsToDate(r.createdAt);
      if (d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === thisKey) month += t;
      const key = r.supplier || 'Unknown';
      const e = bySup.get(key) || { name: key, spend: 0, units: 0, orders: 0 };
      e.spend += t; e.units += r.qty || 0; e.orders += 1;
      bySup.set(key, e);
    });
    return { total, month, units, orders: restocks.length, bySup: [...bySup.values()].sort((a, b) => b.spend - a.spend) };
  }, [restocks]);

  // Task 8: shrinkage (non-sale reductions) by reason.
  const adjustAgg = useMemo(() => {
    const byReason = new Map();
    let units = 0;
    stockAdjustments.forEach((a) => {
      const r = a.reason || 'Adjustment';
      const mag = Math.abs(a.qty || 0); // qty is signed; show magnitude per reason
      const e = byReason.get(r) || { reason: r, units: 0, events: 0 };
      e.units += mag; e.events += 1; units += mag;
      byReason.set(r, e);
    });
    return { units, events: stockAdjustments.length, byReason: [...byReason.values()].sort((a, b) => b.units - a.units) };
  }, [stockAdjustments]);

  // ---- 4. Fast Movers ----
  const [fmSearch, setFmSearch] = useState('');
  const fastMovers = useMemo(() => {
    const q = safeLower(fmSearch);
    return parts.filter((p) => pUnits(p) > 0 && partMatchesQuery(p, q)).sort((a, b) => pUnits(b) - pUnits(a));
  }, [parts, fmSearch, ledgerByPart]);
  const fmPager = useViewMore(fastMovers, 10, fmSearch);

  // ---- 5. Inventory Aging ----
  const [openBucket, setOpenBucket] = useState(null);
  const aging = useMemo(
    () =>
      AGING_BUCKETS.map((b) => {
        const items = parts.filter((p) => { const a = ageDays(p); return a != null && a >= b.min && a <= b.max && (p.stock || 0) > 0; });
        return {
          ...b,
          items,
          count: items.length,
          value: items.reduce((s, p) => s + (p.stock || 0) * (p.sellingPrice || 0), 0),
          locked: items.reduce((s, p) => s + lockedCapital(p), 0),
        };
      }),
    [parts]
  );
  const hasAges = useMemo(() => parts.some((p) => ageDays(p) != null), [parts]);

  // ---- 6. Dead Stock ----
  const [dsSearch, setDsSearch] = useState('');
  const [dsAge, setDsAge] = useState(0); // min days
  const [dsDiscount, setDsDiscount] = useState(20);
  const deadStock = useMemo(() => {
    const q = safeLower(dsSearch);
    return parts
      .filter((p) => isDeadStock(p) && partMatchesQuery(p, q) && (ageDays(p) == null || ageDays(p) >= dsAge))
      .sort((a, b) => lockedCapital(b) - lockedCapital(a));
  }, [parts, dsSearch, dsAge]);
  const dsPager = useViewMore(deadStock, 10, dsSearch + dsAge);
  const deadTotals = useMemo(() => {
    const value = deadStock.reduce((s, p) => s + (p.stock || 0) * (p.sellingPrice || 0), 0);
    const locked = deadStock.reduce((s, p) => s + lockedCapital(p), 0);
    return { value, locked };
  }, [deadStock]);
  const suggestedLiq = (p) => Math.max(Math.round((p.purchasePrice || 0) * 1.05), Math.round((p.sellingPrice || 0) * 0.8));

  async function exportAnalytics() {
    if (demoMode && !demoCanExport) { onProtectedAction?.(); return; }
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(profitable.map((p) => ({ Part: p.name, Stock: p.stock || 0, Revenue: pRev(p), Profit: pProfit(p), 'Margin %': +pMargin(p).toFixed(1) }))), 'Profitable Parts');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(vehAgg.brands.map((b) => ({ Brand: b.name, Units: b.units, Revenue: b.rev, 'Revenue %': +b.revPct.toFixed(1) }))), 'Vehicle Brands');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(deadStock.map((p) => ({ Part: p.name, Stock: p.stock || 0, 'Locked Capital': lockedCapital(p), 'Days In Stock': ageDays(p) ?? '—', 'Suggested Price': suggestedLiq(p) }))), 'Dead Stock');
      // Issue 5: stock adjustments incl. reason + notes + before/after + user.
      if (stockAdjustments.length) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stockAdjustments.map((a) => ({
          Date: tsToDate(a.createdAt)?.toLocaleString('en-IN') || '',
          Part: a.name || '',
          Reason: a.reason || '',
          Qty: a.qty,
          'Stock Before': a.stockBefore ?? '',
          'Stock After': a.stockAfter ?? '',
          Notes: a.notes || '',
          User: a.byEmail || '',
        }))), 'Stock Adjustments');
      }
      XLSX.writeFile(wb, `Analytics_${new Date().toISOString().slice(0, 10)}.xlsx`);
      notify.exported('Analytics exported');
    } catch (e) {
      console.error(e);
      toast.error('Export failed');
    }
  }

  const th = 'text-left px-3 py-2 text-[10px] uppercase tracking-wider text-white/45 font-medium';
  const td = 'px-3 py-2 text-sm';
  // Sticky first column: keeps the part name pinned while numbers scroll on a
  // phone. Background matches the panel so scrolled content slides under it.
  const thSticky = th + ' sticky left-0 z-10';
  const tdSticky = td + ' sticky left-0 z-10';
  const stickyBg = { background: 'var(--surface-0)' };
  const maxBar = Math.max(1, ...trend.series.map((m) => Math.max(m.revenue, m.profit)));

  return (
    <PageHeader title="Analytics" icon={BarChart3} action={
      <button onClick={exportAnalytics} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#d4af37] bg-[#d4af37]/10 border border-[#d4af37]/30 hover:bg-[#d4af37]/20 transition">
        <Download size={13} /> Export Excel
      </button>
    }>
      {/* Filter bar */}
      <div className="rounded-2xl p-3 flex flex-wrap items-center gap-2 backdrop-blur-sm mb-6" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
        <span className="text-[11px] uppercase tracking-wider text-white/45 font-semibold px-1">Filters</span>
        {/* MiniSelect, not a native <select>: categoryOpts/brandOpts are data-driven and
            can run long — a native select's popup has no CSS-controllable max-height, so
            a long list here would render past the panel. MiniSelect caps and internally
            scrolls regardless of how many categories/brands exist. */}
        <div className="w-[160px]">
          <MiniSelect value={fCategory} options={categoryOpts} emptyValue="All" labels={{ All: 'All Categories' }} onPick={setFCategory}
            inputCls="w-full px-2.5 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60 outline-none" />
        </div>
        <div className="w-[160px]">
          <MiniSelect value={fBrand} options={brandOpts} emptyValue="All" labels={{ All: 'All Brands' }} onPick={setFBrand}
            inputCls="w-full px-2.5 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60 outline-none" />
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { label: 'Total Locked Capital', value: kpi.totalLocked, hint: 'Purchase × stock on hand' },
          { label: 'Total Expected Profit', value: kpi.totalProfit, hint: '(MRP − purchase) × stock' },
          { label: 'Total Dead Capital', value: kpi.deadCapital, hint: 'Locked in never-sold items' },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl p-5 backdrop-blur-sm" style={{ background: 'linear-gradient(135deg, rgba(212,175,55,0.10), rgba(170,128,30,0.04))', border: '1px solid rgba(212,175,55,0.25)' }}>
            <p className="text-[11px] uppercase tracking-wider text-[#d4af37]/80 font-semibold">{k.label}</p>
            <p className="text-2xl font-bold text-white mt-2">{formatINR(k.value)}</p>
            <p className="text-[11px] text-white/45 mt-1">{k.hint}</p>
          </div>
        ))}
      </div>

      {/* Copy-workflow: unique products vs inventory records (copies counted once) */}
      {(() => {
        const active = inventory.filter((p) => !p.archived);
        const uniqueProducts = new Set(active.map((p) => baseName(p.name))).size;
        const records = active.length;
        return (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-white/50 -mt-2">
            <span><span className="text-white/80 font-semibold">{uniqueProducts}</span> unique product{uniqueProducts !== 1 ? 's' : ''}</span>
            <span><span className="text-white/80 font-semibold">{records}</span> inventory record{records !== 1 ? 's' : ''}</span>
            {records > uniqueProducts && <span className="text-[#d4af37]/70">({records - uniqueProducts} are copies)</span>}
          </div>
        );
      })()}

      {/* 1. MONTHLY PROFIT TREND */}
      <ACard
        title="Monthly Profit Trend"
        icon={TrendingUp}
        right={
          <select value={range} onChange={(e) => setRange(e.target.value)} className="px-2.5 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60 outline-none">
            <option value="30d" className="bg-[#111]">Last 30 Days</option>
            <option value="3m" className="bg-[#111]">Last 3 Months</option>
            <option value="6m" className="bg-[#111]">Last 6 Months</option>
            <option value="12m" className="bg-[#111]">Last 12 Months</option>
            <option value="all" className="bg-[#111]">All Time</option>
          </select>
        }
      >
        {trend.series.length === 0 ? (
          <div className="rounded-xl px-4 py-8 text-center bg-white/[0.03] border border-white/10">
            <p className="text-sm text-white/50">No sales recorded in this period yet.</p>
            <p className="text-xs text-white/45 mt-1">Each checkout sale is logged here — the trend builds up as you sell.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {[
                { l: 'Revenue', v: formatINR(trend.totRev), c: 'text-white' },
                { l: 'Cost', v: formatINR(trend.totCost), c: 'text-white/70' },
                { l: 'Profit', v: formatINR(trend.totProfit), c: 'text-emerald-400' },
                { l: 'Margin', v: `${trend.margin.toFixed(1)}%`, c: 'text-[#d4af37]' },
              ].map((m) => (
                <div key={m.l} className="rounded-xl px-3 py-2.5 bg-white/[0.03] border border-white/8">
                  <p className="text-[10px] uppercase tracking-wider text-white/45">{m.l}</p>
                  <p className={`text-lg font-bold ${m.c}`}>{m.v}</p>
                </div>
              ))}
            </div>
            {trend.growth != null && (
              <p className={`text-xs font-semibold mb-3 ${trend.growth >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {trend.growth >= 0 ? '▲' : '▼'} Profit {trend.growth >= 0 ? 'increased' : 'decreased'} {Math.abs(trend.growth).toFixed(1)}% vs previous month
              </p>
            )}
            {/* simple SVG-free bar chart: revenue (gold) + profit (emerald) per month */}
            <div className="flex items-end gap-2 h-40 overflow-x-auto pb-1">
              {trend.series.map((m) => (
                <div key={m.key} className="flex flex-col items-center gap-1 min-w-[44px]" title={`Revenue ${formatINR(m.revenue)} · Profit ${formatINR(m.profit)}`}>
                  <div className="flex items-end gap-0.5 h-32">
                    <div className="w-3 rounded-t bg-gradient-to-t from-[#aa801e] to-[#e8c84a]" style={{ height: `${(m.revenue / maxBar) * 100}%` }} />
                    <div className="w-3 rounded-t bg-gradient-to-t from-emerald-700 to-emerald-400" style={{ height: `${(Math.max(0, m.profit) / maxBar) * 100}%` }} />
                  </div>
                  <span className="text-[9px] text-white/45">{m.key.slice(2)}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[11px] text-white/45">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#d4af37]" /> Revenue</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-400" /> Profit</span>
              {trend.best && <span>Best: {trend.best.key} ({formatINR(trend.best.profit)})</span>}
              {trend.worst && <span>Worst: {trend.worst.key} ({formatINR(trend.worst.profit)})</span>}
              <span>Avg/mo: {formatINR(Math.round(trend.avg))}</span>
              {trend.bestRev && <span>Top revenue: {trend.bestRev.key}</span>}
            </div>
          </>
        )}
      </ACard>

      {/* 2. TOP PROFITABLE PARTS */}
      <ACard
        title="Top Profitable Parts"
        icon={TrendingUp}
        right={
          <div className="flex items-center gap-2">
            <ASearch value={ppSearch} onChange={setPpSearch} placeholder="Search parts…" />
            <select value={ppSort} onChange={(e) => setPpSort(e.target.value)} className="px-2 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60 outline-none">
              <option value="profit" className="bg-[#111]">Total Profit</option>
              <option value="margin" className="bg-[#111]">Profit Margin %</option>
              <option value="revenue" className="bg-[#111]">Revenue</option>
            </select>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>{['Part', 'Stock', 'Revenue', 'Profit', 'Margin'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {ppPager.visible.map((p) => (
                <tr key={p.id} className="hover:bg-white/[0.03]" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.04)' }}>
                  <td className={`${td} text-white`}>{p.name}</td>
                  <td className={`${td} text-white/60`}>{p.stock || 0}</td>
                  <td className={`${td} text-white/80`}>{formatINR(pRev(p))}</td>
                  <td className={`${td} text-emerald-400 font-semibold`}>{formatINR(pProfit(p))}</td>
                  <td className={`${td} text-[#d4af37]`}>{pMargin(p).toFixed(1)}%</td>
                </tr>
              ))}
              {profitable.length === 0 && <tr><td className={`${td} text-white/45`} colSpan={5}>No sales recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <ViewMoreBar pager={ppPager} label="parts" />
      </ACard>

      {/* 3. VEHICLE ANALYTICS */}
      <ACard
        title="Vehicle Analytics"
        icon={BarChart3}
        right={
          <div className="flex items-center gap-2">
            <ASearch value={vehSearch} onChange={setVehSearch} placeholder="Search…" />
            <div className="flex rounded-lg overflow-hidden border border-white/10">
              {['brand', 'model'].map((m) => (
                <button key={m} onClick={() => setVehMode(m)} className={`px-2.5 py-1.5 text-xs font-semibold capitalize ${vehMode === m ? 'bg-[#d4af37]/20 text-[#d4af37]' : 'text-white/50 hover:bg-white/5'}`}>{m}s</button>
              ))}
            </div>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>{[vehMode === 'brand' ? 'Brand' : 'Model', 'Units', 'Revenue', 'Profit', 'Rev %'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {vehPager.visible.map((r) => (
                <tr key={r.name} className="hover:bg-white/[0.03]" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.04)' }}>
                  <td className={`${td} text-white`}>{r.name}</td>
                  <td className={`${td} text-white/60`}>{r.units}</td>
                  <td className={`${td} text-white/80`}>{formatINR(r.rev)}</td>
                  <td className={`${td} text-emerald-400`}>{formatINR(r.prof)}</td>
                  <td className={td}>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-gradient-to-r from-[#e8c84a] to-[#aa801e]" style={{ width: `${r.revPct}%` }} /></div>
                      <span className="text-[#d4af37] text-xs">{r.revPct.toFixed(0)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
              {vehRows.length === 0 && <tr><td className={`${td} text-white/45`} colSpan={5}>No vehicle sales data yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <ViewMoreBar pager={vehPager} label={vehMode === 'brand' ? 'brands' : 'models'} />
      </ACard>

      {/* Revenue mix: Parts vs Labour vs Service vs Outside */}
      <ACard title="Revenue Mix — Parts vs Labour vs Service" icon={TrendingUp}>
        {revenueMix.length === 0 ? (
          <p className="text-xs text-white/45">No revenue recorded yet.</p>
        ) : (
          <div className="space-y-2.5">
            {revenueMix.map((r) => (
              <div key={r.label}>
                <div className="flex items-center justify-between text-xs mb-1"><span className="text-white/70">{r.label}</span><span className="text-white/90 font-semibold">{inr(r.value)} · {r.pct.toFixed(1)}%</span></div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(var(--fg-rgb),0.06)' }}><div className="h-full rounded-full" style={{ width: `${r.pct}%`, background: r.color }} /></div>
              </div>
            ))}
          </div>
        )}
      </ACard>

      {/* Top services / labour by revenue */}
      <ACard title="Top Services & Labour by Revenue" icon={Wrench}>
        {topServices.length === 0 ? (
          <p className="text-xs text-white/45">No service or labour revenue yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[420px]">
              <thead><tr className="text-[10px] uppercase text-white/45"><th className="text-left py-1.5 px-2">Service</th><th className="text-right py-1.5 px-2">Jobs</th><th className="text-right py-1.5 px-2">Revenue</th><th className="text-right py-1.5 px-2">Profit</th></tr></thead>
              <tbody>{topServices.map((s) => <tr key={s.name} style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.05)' }}><td className="py-1.5 px-2 text-white/80">{s.name}</td><td className="py-1.5 px-2 text-right text-white/60">{s.count}</td><td className="py-1.5 px-2 text-right text-white/85">{inr(s.revenue)}</td><td className="py-1.5 px-2 text-right text-emerald-400">{inr(s.profit)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </ACard>

      {/* Technician productivity */}
      {techAgg.length > 0 && (
        <ACard title="Technician Productivity" icon={Users}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[420px]">
              <thead><tr className="text-[10px] uppercase text-white/45"><th className="text-left py-1.5 px-2">Technician</th><th className="text-right py-1.5 px-2">Jobs</th><th className="text-right py-1.5 px-2">Hours</th><th className="text-right py-1.5 px-2">Revenue</th></tr></thead>
              <tbody>{techAgg.map((tv) => <tr key={tv.name} style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.05)' }}><td className="py-1.5 px-2 text-white/80">{tv.name}</td><td className="py-1.5 px-2 text-right text-white/60">{tv.jobs}</td><td className="py-1.5 px-2 text-right text-white/60">{tv.hours}</td><td className="py-1.5 px-2 text-right text-white/85">{inr(tv.revenue)}</td></tr>)}</tbody>
            </table>
          </div>
        </ACard>
      )}

      {/* Sales by Staff (ADD-05) */}
      <ACard title="Sales by Staff" icon={Users}>
        {staffAgg.length === 0 ? (
          <p className="text-xs text-white/45">No sales recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>{['Staff', 'Orders', 'Units', 'Revenue', 'Profit'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {staffAgg.map((r) => (
                  <tr key={r.name} className="hover:bg-white/[0.03]" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.04)' }}>
                    <td className={`${td} text-white`}>{r.name}</td>
                    <td className={`${td} text-white/60`}>{r.orders}</td>
                    <td className={`${td} text-white/60`}>{r.units}</td>
                    <td className={`${td} text-white/80`}>{formatINR(r.revenue)}</td>
                    <td className={`${td} text-emerald-400`}>{formatINR(r.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-white/45 mt-2">Sales recorded before staff attribution show as “Unknown”.</p>
          </div>
        )}
      </ACard>

      {/* Restock Cost (ADD-02) */}
      <ACard title="Restock Cost" icon={PackagePlus}>
        {restocks.length === 0 ? (
          <p className="text-xs text-white/45">No goods-received records yet. Use the green “Receive” button on a part to log a restock.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              {[
                ['Total spent', formatINR(restockAgg.total)],
                ['This month', formatINR(restockAgg.month)],
                ['Units received', restockAgg.units],
                ['Receipts', restockAgg.orders],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl p-3" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                  <div className="text-[10px] uppercase tracking-wider text-white/45">{k}</div>
                  <div className="text-base font-bold text-[#d4af37] mt-0.5">{v}</div>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>{['Supplier', 'Receipts', 'Units', 'Spend'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {restockAgg.bySup.slice(0, 10).map((r) => (
                    <tr key={r.name} className="hover:bg-white/[0.03]" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.04)' }}>
                      <td className={`${td} text-white`}>{r.name}</td>
                      <td className={`${td} text-white/60`}>{r.orders}</td>
                      <td className={`${td} text-white/60`}>{r.units}</td>
                      <td className={`${td} text-[#d4af37]`}>{formatINR(r.spend)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </ACard>

      {/* Task 8: Stock adjustments (non-sales) */}
      <ACard title="Stock Adjustments (non-sales)" icon={PackageX}>
        {stockAdjustments.length === 0 ? (
          <p className="text-xs text-white/45">No non-sale stock changes recorded. Use the amber “Adjust” action on a part to log damage, loss, or a correction.</p>
        ) : (
          <>
            <p className="text-xs text-white/50 mb-2">{adjustAgg.units} units across {adjustAgg.events} adjustments — kept separate from sales so revenue stays accurate.</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {adjustAgg.byReason.map((r) => (
                <div key={r.reason} className="rounded-xl p-3" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                  <div className="text-[10px] uppercase tracking-wider text-white/45">{r.reason}</div>
                  <div className="text-base font-bold text-amber-400 mt-0.5">{r.units} <span className="text-[10px] text-white/45 font-normal">units</span></div>
                  <div className="text-[10px] text-white/45">{r.events} event{r.events !== 1 ? 's' : ''}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </ACard>

      {/* 4. FAST MOVERS */}
      <ACard title="Fast Movers" icon={Zap} right={<ASearch value={fmSearch} onChange={setFmSearch} placeholder="Search parts…" />}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>{['#', 'Part', 'Units Sold', 'Revenue', 'Profit'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {fmPager.visible.map((p, i) => (
                <tr key={p.id} className="hover:bg-white/[0.03]" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.04)' }}>
                  <td className={`${td} text-[#d4af37] font-bold`}>{i + 1}</td>
                  <td className={`${td} text-white`}>{p.name}</td>
                  <td className={`${td} text-emerald-400 font-semibold`}>{pUnits(p)}</td>
                  <td className={`${td} text-white/80`}>{formatINR(pRev(p))}</td>
                  <td className={`${td} text-white/80`}>{formatINR(pProfit(p))}</td>
                </tr>
              ))}
              {fastMovers.length === 0 && <tr><td className={`${td} text-white/45`} colSpan={5}>No sales recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <ViewMoreBar pager={fmPager} label="parts" />
      </ACard>

      {/* 5. INVENTORY AGING REPORT */}
      <ACard title="Inventory Aging Report" icon={Archive}>
        {!hasAges && <p className="text-[11px] text-amber-400/70 mb-2">Aging uses each part’s stock-in date (createdAt). Parts without one aren’t bucketed.</p>}
        <div className="space-y-2">
          {aging.map((b) => {
            const sev = SEVERITY[b.key];
            const open = openBucket === b.key;
            return (
              <div key={b.key} className="rounded-xl overflow-hidden" style={{ background: 'rgba(var(--fg-rgb),0.02)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
                <button onClick={() => setOpenBucket(open ? null : b.key)} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.03] text-left">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: sev.dot }} />
                  <span className="text-sm font-semibold text-white w-28 flex-shrink-0">{b.key}</span>
                  <span className="text-[10px] uppercase tracking-wide flex-shrink-0" style={{ color: sev.dot }}>{sev.label}</span>
                  <div className="flex-1" />
                  <span className="text-xs text-white/50">{b.count} parts</span>
                  <span className="text-xs text-white/70 hidden sm:inline">Value {formatINR(b.value)}</span>
                  <span className="text-xs text-[#d4af37]">Locked {formatINR(b.locked)}</span>
                  <span className={`text-white/45 transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
                </button>
                {open && (
                  <div className="px-3 pb-2 overflow-x-auto" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                    {b.items.length ? (
                      <table className="w-full">
                        <thead><tr>{['Part', 'Qty', 'Value', 'Days in Stock'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                        <tbody>
                          {b.items.slice(0, 50).map((p) => (
                            <tr key={p.id} style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.04)' }}>
                              <td className={`${td} text-white`}>{p.name}</td>
                              <td className={`${td} text-white/60`}>{p.stock || 0}</td>
                              <td className={`${td} text-white/80`}>{formatINR((p.stock || 0) * (p.sellingPrice || 0))}</td>
                              <td className={`${td} text-white/60`}>{ageDays(p) ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : <p className="text-xs text-white/45 py-2">No parts in this range.</p>}
                    {b.items.length > 50 && <p className="text-[11px] text-white/45 py-1">Showing first 50 of {b.items.length}.</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ACard>

      {/* 6. DEAD STOCK ANALYSIS */}
      <ACard
        title="Dead Stock Analysis"
        icon={Archive}
        right={
          <div className="flex items-center gap-2 flex-wrap">
            <ASearch value={dsSearch} onChange={setDsSearch} placeholder="Search…" />
            <select value={dsAge} onChange={(e) => setDsAge(+e.target.value)} className="px-2 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60 outline-none">
              <option value={0} className="bg-[#111]">All ages</option>
              <option value={30} className="bg-[#111]">30+ days</option>
              <option value={60} className="bg-[#111]">60+ days</option>
              <option value={90} className="bg-[#111]">90+ days</option>
              <option value={180} className="bg-[#111]">180+ days</option>
            </select>
          </div>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
          <div className="rounded-xl px-3 py-2.5 bg-white/[0.03] border border-white/8"><p className="text-[10px] uppercase tracking-wider text-white/45">Dead Stock Value</p><p className="text-base font-bold text-white">{formatINR(deadTotals.value)}</p></div>
          <div className="rounded-xl px-3 py-2.5 bg-white/[0.03] border border-white/8"><p className="text-[10px] uppercase tracking-wider text-white/45">Locked Capital</p><p className="text-base font-bold text-red-400">{formatINR(deadTotals.locked)}</p></div>
          <div className="rounded-xl px-3 py-2.5 bg-white/[0.03] border border-white/8 col-span-2 sm:col-span-1">
            <p className="text-[10px] uppercase tracking-wider text-white/45 mb-1">Recovery @ discount</p>
            <div className="flex gap-1">
              {[10, 20, 30, 40].map((d) => (
                <button key={d} onClick={() => setDsDiscount(d)} className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${dsDiscount === d ? 'bg-[#d4af37] text-black' : 'bg-white/5 text-white/50'}`}>{d}%</button>
              ))}
            </div>
            <p className="text-sm font-bold text-emerald-400 mt-1">{formatINR(Math.round(deadTotals.value * (1 - dsDiscount / 100)))}</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>{['Part', 'Stock', 'Locked', 'Days', 'Suggested ₹', ''].map((h, i) => <th key={i} className={i === 0 ? thSticky : th} style={i === 0 ? stickyBg : undefined}>{h}</th>)}</tr></thead>
            <tbody>
              {dsPager.visible.map((p) => (
                <tr key={p.id} className="hover:bg-white/[0.03]" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.04)' }}>
                  <td className={`${tdSticky} text-white`} style={stickyBg}>{p.name}</td>
                  <td className={`${td} text-white/60`}>{p.stock || 0}</td>
                  <td className={`${td} text-red-400`}>{formatINR(lockedCapital(p))}</td>
                  <td className={`${td} text-white/60`}>{ageDays(p) ?? '—'}</td>
                  <td className={`${td} text-[#d4af37] font-semibold`}>{formatINR(suggestedLiq(p))}</td>
                  <td className={td}><button onClick={() => onEditPart(p)} className="flex items-center gap-1 text-[11px] font-semibold text-[#d4af37] hover:underline"><Edit3 size={11} /> Liquidate</button></td>
                </tr>
              ))}
              {deadStock.length === 0 && <tr><td className={`${td} text-white/45`} colSpan={6}>No dead stock — everything’s moving!</td></tr>}
            </tbody>
          </table>
        </div>
        <ViewMoreBar pager={dsPager} label="items" />
      </ACard>

      {/* Audit Log (ADD-06) — admin-only; the whole Analytics tab is admin-gated */}
      <AuditLogPanel auditLog={auditLog} demoMode={demoMode} actorEmail={actorEmail} capacityRefreshTick={capacityRefreshTick} onCleanupComplete={onAuditCleanupComplete} />

      <p className="text-[11px] text-white/45 text-center pb-2">
        Revenue, cost &amp; profit are computed from the sales ledger (actual sale prices); the Monthly Trend uses unbounded monthly rollups.
      </p>
    </PageHeader>
  );
}

export { AnalyticsView, AuditLogPanel };
export default AnalyticsView;
