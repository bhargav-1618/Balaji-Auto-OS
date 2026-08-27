// components/inventory/SupplierPerformance.jsx
// Interactive Supplier Performance analytics dashboard.
//   - Preserves the original data mapping (rating/lead/onTime/accuracy/outstanding/
//     linked parts) and the "degrade gracefully when metrics absent" behaviour.
//   - Adds: debounced global search, multi-filter with chips + Clear, sortable columns,
//     pagination (25/50/100 + first/prev/next/last), interactive KPI cards, a derived
//     Supplier Health score (visual only), row click → open in Directory, row actions,
//     CSV/Excel/PDF export of the current view, sticky header, semantic colours,
//     empty/loading states, responsive card layout, and multi-select comparison.
// No writes, no business-logic/calculation changes — Health score is presentational.
import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  Gauge, Star, Clock, Target, IndianRupee, Package, ChevronDown, ChevronUp, Search,
  ArrowUpDown, ArrowUp, ArrowDown, Download, X, ExternalLink, Phone, Mail,
  ArrowLeftRight, GitCompare, Filter as FilterIcon,
} from 'lucide-react';
import { useDeferredSearch, useSearchIndex, rankIndexed } from '../../lib/useSearch';
import { writeSheet, stamp } from '../../lib/exportSheet';
import { PDF_PAGE, PDF_TEXT, drawPdfPageNumber } from '../../lib/pdfTheme';
import { SEMANTIC } from '../../constants/ui';

const num = (v) => (Number.isFinite(+v) ? +v : 0);
const has = (v) => v !== undefined && v !== null && v !== '';

// ── Supplier Health (visual indicator only; does not touch stored data) ──────────
// Blends the metrics we already have into a 0–100 score. Missing metrics are simply
// skipped so a partially-populated supplier still scores on what it has.
function healthOf(r) {
  const parts = [];
  if (has(r.rating)) parts.push(Math.max(0, Math.min(100, (num(r.rating) / 5) * 100)));
  if (has(r.onTime)) parts.push(Math.max(0, Math.min(100, num(r.onTime))));
  if (has(r.accuracy)) parts.push(Math.max(0, Math.min(100, num(r.accuracy))));
  if (has(r.lead)) parts.push(Math.max(0, Math.min(100, 100 - (num(r.lead) - 2) * 15))); // 2d≈100, 5d≈55
  if (has(r.outstanding)) parts.push(num(r.outstanding) <= 0 ? 100 : num(r.outstanding) > 50000 ? 30 : num(r.outstanding) > 10000 ? 60 : 85);
  if (!parts.length) return null;
  return Math.round(parts.reduce((s, x) => s + x, 0) / parts.length);
}
const healthBand = (score) => {
  if (score == null) return { label: 'No data', color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' };
  if (score >= 85) return { label: 'Excellent', color: '#34d399', bg: 'rgba(52,211,153,0.14)' };
  if (score >= 70) return { label: 'Good', color: '#4ade80', bg: 'rgba(74,222,128,0.12)' };
  if (score >= 50) return { label: 'Watch', color: '#fbbf24', bg: 'rgba(251,191,36,0.14)' };
  return { label: 'Risk', color: '#f87171', bg: 'rgba(248,113,113,0.14)' };
};

const PER_OPTIONS = [25, 50, 100];

export default function SupplierPerformance({ suppliers = [], inventory = [], formatINR, loading = false, onOpenSupplier, demoMode = false, demoCanExport = true, onProtectedAction }) {
  const [open, setOpen] = useState(true);
  const inr = (n) => (typeof formatINR === 'function' ? formatINR(n) : `₹${Math.round(num(n)).toLocaleString('en-IN')}`);

  const [q, setQ] = useState('');
  const [dq, searching] = useDeferredSearch(q);
  const [statusF, setStatusF] = useState('All');
  const [typeF, setTypeF] = useState('All');
  const [ratingF, setRatingF] = useState('All');
  const [outF, setOutF] = useState('All');
  const [leadF, setLeadF] = useState('All');
  const [onTimeF, setOnTimeF] = useState('All');
  const [accF, setAccF] = useState('All');
  const [kpiF, setKpiF] = useState(null); // interactive KPI filter: 'outstanding' | 'accuracy' | 'onTime' | null
  const [sortKey, setSortKey] = useState('rating');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [per, setPer] = useState(25);
  const [compare, setCompare] = useState([]); // selected ids for comparison
  const [showCompare, setShowCompare] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const scrollRef = useRef(null);

  const rows = useMemo(() => {
    const linkedCount = (sid) => inventory.filter((p) => !p.archived && Array.isArray(p.suppliers) && p.suppliers.some((s) => (s?.id || s) === sid)).length;
    return suppliers.map((s) => {
      const r = {
        id: s.id, name: s.name, code: s.code, gst: s.gst, contact: s.contactPerson,
        city: s.city, state: s.state, type: s.type, status: s.status,
        preferred: !!(s.preferred || s.isPreferred), blocked: s.status === 'Blocked' || s.blocked,
        rating: s.rating, ratingCount: s.ratingCount, lead: s.leadTimeDays,
        onTime: s.onTimePct, accuracy: s.orderAccuracyPct, outstanding: s.outstanding,
        orders: s.orderCount, phone: s.phoneNumbers?.[0]?.number || s.phone, email: s.email,
        linked: linkedCount(s.id),
      };
      r.health = healthOf(r);
      return r;
    });
  }, [suppliers, inventory]);

  const anyMetrics = rows.some((r) => has(r.rating) || has(r.lead) || has(r.onTime));

  // Same strict identifier/text split as SupplierDirectory's own search (the OTHER
  // Suppliers-tab view of the same records) — code/gst are this record's own identifiers
  // (exact/prefix/suffix/contains, never confused with an unrelated supplier's), name/
  // contact person/phone/city/state stay partial-searchable free text. This view used to
  // join all six fields (including code/gst) into one lowercased string and substring-test
  // it — the exact "identifiers in the free-text haystack" anti-pattern the rest of the
  // app was fixed to avoid.
  const supplierSearchIndex = useSearchIndex(
    rows,
    (r) => r.id,
    (r) => [r.name, r.contact, r.city, r.state, r.type, r.phone],
    (r) => [r.code, r.gst],
  );

  // KPI aggregates (over all rows — a stable dashboard summary, independent of filters)
  const agg = useMemo(() => {
    const avg = (arr, k) => (arr.length ? arr.reduce((s, r) => s + num(r[k]), 0) / arr.length : null);
    return {
      lead: avg(rows.filter((r) => has(r.lead)), 'lead'),
      onTime: avg(rows.filter((r) => has(r.onTime)), 'onTime'),
      accuracy: avg(rows.filter((r) => has(r.accuracy)), 'accuracy'),
      outstanding: rows.reduce((s, r) => s + num(r.outstanding), 0),
    };
  }, [rows]);

  const passesStatus = (r) => statusF === 'All'
    || (statusF === 'Preferred' && r.preferred) || (statusF === 'Blocked' && r.blocked)
    || (statusF === 'Active' && !(r.status && r.status !== 'Active')) || (statusF === 'Inactive' && r.status === 'Inactive');
  const passesType = (r) => typeF === 'All' || (r.type || '').toLowerCase() === typeF.toLowerCase();
  const passesRating = (r) => ratingF === 'All' || (ratingF === '5' && num(r.rating) >= 5) || (ratingF === '4.5' && num(r.rating) >= 4.5) || (ratingF === '4' && num(r.rating) >= 4);
  const passesOut = (r) => {
    const o = num(r.outstanding);
    if (outF === 'All') return true;
    if (outF === 'none') return o <= 0;
    if (outF === '1') return o >= 1;
    if (outF === '10000') return o >= 10000;
    if (outF === '50000') return o >= 50000;
    return true;
  };
  const passesLead = (r) => {
    if (leadF === 'All') return true;
    if (!has(r.lead)) return false;
    const l = num(r.lead);
    if (leadF === 'fast') return l < 2;
    if (leadF === 'mid') return l >= 2 && l <= 5;
    if (leadF === 'slow') return l > 5;
    return true;
  };
  const passesOnTime = (r) => {
    if (onTimeF === 'All') return true;
    if (!has(r.onTime)) return false;
    const v = num(r.onTime);
    if (onTimeF === 'high') return v > 95;
    if (onTimeF === 'mid') return v >= 90 && v <= 95;
    if (onTimeF === 'low') return v < 90;
    return true;
  };
  const passesAcc = (r) => {
    if (accF === 'All') return true;
    if (!has(r.accuracy)) return false;
    const v = num(r.accuracy);
    if (accF === 'high') return v > 95;
    if (accF === 'mid') return v >= 90 && v <= 95;
    if (accF === 'low') return v < 90;
    return true;
  };
  const passesKpi = (r) => {
    if (!kpiF) return true;
    if (kpiF === 'outstanding') return num(r.outstanding) > 0;
    if (kpiF === 'accuracy') return has(r.accuracy) && num(r.accuracy) < 95;
    if (kpiF === 'onTime') return has(r.onTime) && num(r.onTime) < 90;
    return true;
  };

  const filtered = useMemo(() => {
    const ql = dq.trim();
    let list = rows.filter((r) => passesStatus(r) && passesType(r) && passesRating(r) && passesOut(r) && passesLead(r) && passesOnTime(r) && passesAcc(r) && passesKpi(r));
    if (ql) list = list.filter((r) => rankIndexed(supplierSearchIndex.get(r.id), ql) > 0);
    const dir = sortDir === 'asc' ? 1 : -1;
    const key = sortKey;
    return [...list].sort((a, b) => {
      if (key === 'name') return dir * (a.name || '').localeCompare(b.name || '');
      return dir * (num(a[key]) - num(b[key]));
    });
  }, [rows, dq, statusF, typeF, ratingF, outF, leadF, onTimeF, accF, kpiF, sortKey, sortDir, supplierSearchIndex]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / per));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * per, safePage * per);
  useEffect(() => { setPage(1); if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [dq, statusF, typeF, ratingF, outF, leadF, onTimeF, accF, kpiF, per]);

  const activeFilterCount = [statusF, typeF, ratingF, outF, leadF, onTimeF, accF].filter((f) => f !== 'All').length + (kpiF ? 1 : 0) + (q ? 1 : 0);
  const clearAll = () => { setStatusF('All'); setTypeF('All'); setRatingF('All'); setOutF('All'); setLeadF('All'); setOnTimeF('All'); setAccF('All'); setKpiF(null); setQ(''); };

  const toggleSort = (key) => { if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc'); } };
  const SortIcon = ({ k }) => (sortKey !== k ? <ArrowUpDown size={11} className="text-white/45" /> : sortDir === 'asc' ? <ArrowUp size={11} className="text-[#d4af37]" /> : <ArrowDown size={11} className="text-[#d4af37]" />);

  const toggleCompare = (id) => setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= 4 ? c : [...c, id]));

  // ── Export (respects search + filters + sorting; exports the full filtered set) ──
  const exportRows = () => filtered.map((r) => ({
    Supplier: r.name, Code: r.code || '', Type: r.type || '', City: r.city || '',
    Rating: has(r.rating) ? num(r.rating).toFixed(1) : '', 'Lead Time (d)': has(r.lead) ? num(r.lead).toFixed(1) : '',
    'On-Time %': has(r.onTime) ? Math.round(num(r.onTime)) : '', 'Accuracy %': has(r.accuracy) ? Math.round(num(r.accuracy)) : '',
    Outstanding: num(r.outstanding), Parts: r.linked, Health: r.health == null ? '' : r.health,
  }));
  // Excel/CSV both funnel through the shared sheet writer (xlsx) — the codebase-wide
  // export convention (proper column widths, no raw CSV blobs).
  const exportSheet = async () => {
    if (demoMode && !demoCanExport) { onProtectedAction?.(); return; }
    const data = exportRows(); if (!data.length) return;
    try {
      const head = Object.keys(data[0]);
      const rows = data.map((row) => head.map((h) => row[h] ?? ''));
      await writeSheet({ filename: `supplier-performance-${stamp()}.xlsx`, sheetName: 'Performance', head, rows });
    } catch { /* no-op */ }
  };
  const exportPDF = async () => {
    if (demoMode && !demoCanExport) { onProtectedAction?.(); return; }
    const data = exportRows(); if (!data.length) return;
    try {
      const { default: jsPDF } = await import('jspdf');
      // GLOBAL PDF FRAMEWORK: pt units (was jsPDF's default mm — the only generator
      // not sharing a measurement system with the rest of the app) + the shared
      // ink/muted color tokens from lib/pdfTheme.js. This stays a lightweight,
      // unbranded tabular export (an internal ops report, not a customer/supplier-
      // facing document), so it intentionally skips the shared letterhead the other
      // three generators use — only the unit system and text colors are shared here.
      const doc = new jsPDF({ unit: PDF_PAGE.unit, format: PDF_PAGE.format, orientation: 'landscape' });
      const { M } = PDF_PAGE;
      const pageH = doc.internal.pageSize.getHeight();
      doc.setFontSize(13); doc.setTextColor(...PDF_TEXT.ink); doc.text('Supplier Performance', M, M + 2);
      doc.setFontSize(8); doc.setTextColor(...PDF_TEXT.muted);
      doc.text(`${data.length} suppliers · ${new Date().toLocaleDateString('en-IN')}`, M, M + 16);
      let y = M + 40; const head = Object.keys(data[0]);
      const colW = 76; const bottomLimit = pageH - M;
      let page = 1;
      doc.setFont(undefined, 'bold'); doc.setFontSize(8); doc.setTextColor(...PDF_TEXT.body);
      head.forEach((h, i) => doc.text(String(h), M + i * colW, y)); doc.setFont(undefined, 'normal');
      // GLOBAL PDF FRAMEWORK (dynamic-content pass): was `.slice(0, 40)` — any
      // supplier past the 40th was silently dropped with nothing on the page saying
      // so. The pagination below (`if (y > bottomLimit) addPage()`) already handles
      // an arbitrarily long list correctly; the cap was redundant leftover from
      // before that existed. Every row is now included.
      data.forEach((row) => {
        y += 17;
        if (y > bottomLimit) { doc.addPage(); page += 1; y = M + 20; }
        head.forEach((h, i) => doc.text(String(row[h] ?? '').slice(0, 14), M + i * colW, y));
      });
      for (let p = 1; p <= page; p += 1) { doc.setPage(p); drawPdfPageNumber(doc, p, { W: doc.internal.pageSize.getWidth(), M, H: pageH }); }
      doc.save(`supplier-performance-${stamp()}.pdf`);
    } catch { /* no-op */ }
  };

  if (rows.length === 0) return null;

  const outColor = (o) => (o <= 0 ? SEMANTIC.okAlt : o > 50000 ? SEMANTIC.danger : o > 10000 ? '#fbbf24' : '#fb923c');
  const leadColor = (l) => (l < 2 ? SEMANTIC.okAlt : l <= 5 ? '#fbbf24' : SEMANTIC.danger);
  // COLOR SYSTEM REVIEW: 'Order accuracy' used brand gold for no reason tied to its own
  // value (Section 3 — gold means brand/primary-action, not "one metric among four peers
  // that happened to get picked") → muted, same treatment as every other plain
  // magnitude/breakdown figure elsewhere in the app. 'Outstanding' was amber here but
  // danger everywhere else this exact word appears (Billing's own Outstanding KPI, the
  // Reports Overview KPI row) — aligned to match, since "Outstanding" always represents
  // the same unpaid-balance-risk concept regardless of module.
  const KPIS = [
    { key: null, label: 'Avg lead time', value: agg.lead != null ? `${agg.lead.toFixed(1)} days` : '—', icon: Clock, color: SEMANTIC.info, filter: 'lead' },
    { key: 'onTime', label: 'On-time', value: agg.onTime != null ? `${Math.round(agg.onTime)}%` : '—', icon: Target, color: SEMANTIC.okAlt, hint: 'Show delayed' },
    { key: 'accuracy', label: 'Order accuracy', value: agg.accuracy != null ? `${Math.round(agg.accuracy)}%` : '—', icon: Gauge, color: SEMANTIC.muted, hint: 'Below target' },
    { key: 'outstanding', label: 'Outstanding', value: inr(agg.outstanding), icon: IndianRupee, color: SEMANTIC.danger, hint: 'With balance' },
  ];

  const Chip = ({ onClear, children }) => (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#d4af37]/12 text-[#d4af37] border border-[#d4af37]/25">
      {children}<button onClick={onClear} aria-label="Remove filter" className="hover:text-white"><X size={10} /></button>
    </span>
  );
  const chipLabels = [
    statusF !== 'All' && ['Status: ' + statusF, () => setStatusF('All')],
    typeF !== 'All' && ['Type: ' + typeF, () => setTypeF('All')],
    ratingF !== 'All' && [`Rating ≥ ${ratingF}★`, () => setRatingF('All')],
    outF !== 'All' && ['Outstanding: ' + ({ none: 'None', 1: '₹1+', 10000: '₹10k+', 50000: '₹50k+' }[outF] || outF), () => setOutF('All')],
    leadF !== 'All' && ['Lead: ' + ({ fast: '<2d', mid: '2–5d', slow: '>5d' }[leadF]), () => setLeadF('All')],
    onTimeF !== 'All' && ['On-time: ' + ({ high: '>95%', mid: '90–95%', low: '<90%' }[onTimeF]), () => setOnTimeF('All')],
    accF !== 'All' && ['Accuracy: ' + ({ high: '>95%', mid: '90–95%', low: '<90%' }[accF]), () => setAccF('All')],
    kpiF && ['KPI: ' + kpiF, () => setKpiF(null)],
  ].filter(Boolean);

  const Select = ({ value, onChange, options, label }) => (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wide text-white/45">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="px-2 py-1.5 rounded-lg text-[11px] bg-white/5 border border-white/10 text-white/75 outline-none focus:border-[#d4af37]/50">
        {options.map(([v, l]) => <option key={v} value={v} style={{ background: '#141414' }}>{l}</option>)}
      </select>
    </label>
  );

  const compareRows = rows.filter((r) => compare.includes(r.id));

  return (
    <div className="rounded-2xl overflow-hidden backdrop-blur-sm mt-5" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-left" aria-expanded={open} style={{ borderBottom: open ? '1px solid rgba(var(--fg-rgb),0.06)' : 'none' }}>
        <Gauge size={16} className="text-[#d4af37]" />
        <h3 className="text-sm font-bold text-white/90 flex-1">Supplier performance</h3>
        <span className="text-[11px] text-white/45">{filtered.length} of {rows.length}</span>
        <ChevronDown size={16} className={`text-white/45 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          {!anyMetrics && (
            <p className="text-xs text-white/45 px-4 py-3">Performance metrics (lead time, ratings, on-time %) aren’t captured yet in production — they’ll populate here as you record purchase orders and deliveries. This panel is fully populated in the demo.</p>
          )}

          {/* KPI cards — interactive */}
          {anyMetrics && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px" style={{ background: 'rgba(var(--fg-rgb),0.06)' }}>
              {KPIS.map((k) => {
                const activeK = k.key && kpiF === k.key;
                const clickable = !!k.key || k.filter === 'lead';
                return (
                  <button key={k.label} type="button" disabled={!clickable}
                    onClick={() => { if (k.key) setKpiF((f) => (f === k.key ? null : k.key)); else if (k.filter === 'lead') { setSortKey('lead'); setSortDir('desc'); } }}
                    aria-pressed={activeK} title={k.key ? k.hint : 'Sort by lead time'}
                    className={`p-3 text-left transition ${clickable ? 'cursor-pointer hover:bg-white/[0.04]' : ''}`}
                    style={{ background: activeK ? 'rgba(212,175,55,0.10)' : 'rgba(15,15,15,0.6)' }}>
                    <div className="flex items-center gap-1.5 mb-1"><k.icon size={12} style={{ color: k.color }} /><span className="text-[10px] uppercase tracking-wide text-white/45">{k.label}</span></div>
                    <div className="text-base font-bold" style={{ color: k.color }}>{k.value}</div>
                    {activeK && <div className="text-[9px] text-[#d4af37] mt-0.5">● filtering</div>}
                  </button>
                );
              })}
            </div>
          )}

          {/* Toolbar: search + filter toggle + export */}
          <div className="px-4 py-3 flex flex-wrap items-center gap-2" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>
            <div className="relative flex-1 min-w-[180px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/45" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, code, GST, contact, city, state…" aria-label="Search suppliers" className="w-full pl-9 pr-16 py-2 rounded-xl text-sm bg-white/5 border border-white/10 text-white placeholder-white/30 outline-none focus:border-[#d4af37]/60" />
              {searching && q && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-white/45">Searching…</span>}
            </div>
            <button onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters} className={`h-9 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${activeFilterCount ? 'bg-[#d4af37]/15 text-[#d4af37] border border-[#d4af37]/30' : 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10'}`}><FilterIcon size={13} /> Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}</button>
            {compare.length > 0 && <button onClick={() => setShowCompare(true)} className="h-9 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 bg-white/5 border border-white/10 text-white/80 hover:bg-white/10"><GitCompare size={13} /> Compare ({compare.length})</button>}
            <div className="flex items-center gap-1">
              <button onClick={exportSheet} title="Export to Excel" className="h-9 px-2.5 rounded-lg text-[11px] font-semibold bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 flex items-center gap-1"><Download size={12} /> Excel</button>
              <button onClick={exportPDF} title="Export PDF" className="h-9 px-2.5 rounded-lg text-[11px] font-semibold bg-white/5 border border-white/10 text-white/70 hover:bg-white/10">PDF</button>
            </div>
          </div>

          {/* Filter panel */}
          {showFilters && (
            <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)', background: 'rgba(0,0,0,0.15)' }}>
              <Select label="Status" value={statusF} onChange={setStatusF} options={[['All', 'All'], ['Active', 'Active'], ['Preferred', 'Preferred'], ['Inactive', 'Inactive'], ['Blocked', 'Blocked']]} />
              <Select label="Type" value={typeF} onChange={setTypeF} options={[['All', 'All'], ['OEM', 'OEM'], ['Manufacturer', 'Manufacturer'], ['Dealer', 'Dealer'], ['Distributor', 'Distributor']]} />
              <Select label="Rating" value={ratingF} onChange={setRatingF} options={[['All', 'All'], ['5', '5★'], ['4.5', '4.5★+'], ['4', '4★+']]} />
              <Select label="Outstanding" value={outF} onChange={setOutF} options={[['All', 'All'], ['none', 'None'], ['1', '₹1+'], ['10000', '₹10k+'], ['50000', '₹50k+']]} />
              <Select label="Lead time" value={leadF} onChange={setLeadF} options={[['All', 'All'], ['fast', '<2 days'], ['mid', '2–5 days'], ['slow', '>5 days']]} />
              <Select label="On-time" value={onTimeF} onChange={setOnTimeF} options={[['All', 'All'], ['high', '>95%'], ['mid', '90–95%'], ['low', '<90%']]} />
              <Select label="Accuracy" value={accF} onChange={setAccF} options={[['All', 'All'], ['high', '>95%'], ['mid', '90–95%'], ['low', '<90%']]} />
            </div>
          )}

          {/* Active filter chips */}
          {chipLabels.length > 0 && (
            <div className="px-4 py-2 flex flex-wrap items-center gap-1.5" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>
              {chipLabels.map(([label, clr]) => <Chip key={label} onClear={clr}>{label}</Chip>)}
              <button onClick={clearAll} className="text-[10px] font-semibold text-white/50 hover:text-white ml-1">Clear all</button>
            </div>
          )}

          {/* Loading skeleton */}
          {loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-10 rounded-lg animate-pulse" style={{ background: 'rgba(var(--fg-rgb),0.05)' }} />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-14 text-center">
              <p className="text-sm text-white/45 mb-2">No suppliers match your filters.</p>
              <button onClick={clearAll} className="text-xs font-semibold text-[#d4af37] hover:underline">Clear Filters</button>
            </div>
          ) : (
            <>
              {/* Desktop table (sticky header + sticky first column) */}
              <div ref={scrollRef} className="hidden md:block overflow-auto dark-scroll" style={{ maxHeight: '60vh' }}>
                <table className="w-full text-sm border-collapse">
                  <thead className="sticky top-0 z-10" style={{ background: '#141414' }}>
                    <tr className="text-left" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.1)' }}>
                      <th className="sticky left-0 z-20 px-3 py-2.5 w-8" style={{ background: '#141414' }} aria-label="Select"></th>
                      {[['name', 'Supplier'], ['health', 'Health'], ['rating', 'Rating'], ['lead', 'Lead time'], ['onTime', 'On-time'], ['accuracy', 'Accuracy'], ['outstanding', 'Outstanding'], ['linked', 'Parts']].map(([k, label]) => (
                        <th key={k} className="px-3 py-2.5 text-[11px] uppercase tracking-wider text-white/45 font-semibold whitespace-nowrap">
                          <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-white/70"><span>{label}</span><SortIcon k={k} /></button>
                        </th>
                      ))}
                      <th className="px-3 py-2.5 text-right text-[11px] uppercase tracking-wider text-white/45 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map((r) => {
                      const band = healthBand(r.health);
                      return (
                        <tr key={r.id} className="group transition hover:bg-white/[0.04] cursor-pointer" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.04)' }}
                          onClick={() => onOpenSupplier?.(r.id)} tabIndex={0} role="button" aria-label={`Open ${r.name}`}
                          onKeyDown={(e) => { if (e.key === 'Enter') onOpenSupplier?.(r.id); }}>
                          <td className="sticky left-0 z-10 px-3 py-2.5 group-hover:bg-[#1a1a1a]" style={{ background: '#141414' }} onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={compare.includes(r.id)} onChange={() => toggleCompare(r.id)} aria-label={`Compare ${r.name}`} className="accent-[#d4af37]" />
                          </td>
                          <td className="px-3 py-2.5 font-medium text-white/85 whitespace-nowrap">{r.name}{r.preferred && <span className="ml-1.5 text-[8px] font-bold px-1 py-0.5 rounded text-[#d4af37]" style={{ background: 'rgba(212,175,55,0.15)' }}>PREF</span>}<div className="text-[10px] text-white/45 font-normal">{[r.code, r.city].filter(Boolean).join(' · ')}</div></td>
                          <td className="px-3 py-2.5 whitespace-nowrap"><span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: band.bg, color: band.color }}>{r.health == null ? '—' : `${band.label} ${r.health}`}</span></td>
                          <td className="px-3 py-2.5 whitespace-nowrap">{has(r.rating) ? <span className="inline-flex items-center gap-1 text-white/80"><Star size={12} className="text-[#d4af37] fill-[#d4af37]" />{num(r.rating).toFixed(1)}<span className="text-white/45 text-xs">({r.ratingCount || 0})</span></span> : <span className="text-white/45">—</span>}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">{has(r.lead) ? <span style={{ color: leadColor(num(r.lead)) }}>{num(r.lead).toFixed(1)} d</span> : <span className="text-white/45">—</span>}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">{has(r.onTime) ? <span className={num(r.onTime) >= 90 ? 'text-emerald-400' : 'text-amber-400'}>{Math.round(num(r.onTime))}%</span> : <span className="text-white/45">—</span>}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">{has(r.accuracy) ? <span className={num(r.accuracy) >= 95 ? 'text-emerald-400' : num(r.accuracy) >= 90 ? 'text-amber-400' : 'text-red-400'}>{Math.round(num(r.accuracy))}%</span> : <span className="text-white/45">—</span>}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">{num(r.outstanding) > 0 ? <span style={{ color: outColor(num(r.outstanding)) }}>{inr(r.outstanding)}</span> : <span className="text-white/45">Clear</span>}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-white/60"><span className="inline-flex items-center gap-1"><Package size={12} className="text-white/45" />{r.linked}</span></td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="inline-flex items-center gap-1 opacity-60 group-hover:opacity-100 transition">
                              {/* Issue 6 (Suppliers module review) — the row itself is already a
                                  full-width clickable button wired to the same onOpenSupplier?.(r.id)
                                  handler (see the <tr> above); a separate "View" icon here was a
                                  literal duplicate action, not a distinct one. Removed. "Open in new
                                  tab" stays — it's the one genuinely different affordance. */}
                              <button onClick={() => onOpenSupplier?.(r.id, '_blank')} title="Open in new tab" className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/55 hover:bg-white/10"><ExternalLink size={12} /></button>
                              {r.phone && <a href={`tel:${r.phone}`} onClick={(e) => e.stopPropagation()} title="Call" className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/55 hover:bg-white/10"><Phone size={12} /></a>}
                              {r.email && <a href={`mailto:${r.email}`} onClick={(e) => e.stopPropagation()} title="Email" className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/55 hover:bg-white/10"><Mail size={12} /></a>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden divide-y" style={{ borderColor: 'rgba(var(--fg-rgb),0.05)' }}>
                {paged.map((r) => {
                  const band = healthBand(r.health);
                  return (
                    <button key={r.id} onClick={() => onOpenSupplier?.(r.id)} className="w-full text-left p-3 hover:bg-white/[0.03] transition">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-semibold text-white/90 truncate">{r.name}</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: band.bg, color: band.color }}>{r.health == null ? '—' : `${band.label} ${r.health}`}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-white/50">
                        {has(r.rating) && <span>★ {num(r.rating).toFixed(1)}</span>}
                        {has(r.lead) && <span style={{ color: leadColor(num(r.lead)) }}>{num(r.lead).toFixed(1)}d lead</span>}
                        {has(r.onTime) && <span>{Math.round(num(r.onTime))}% on-time</span>}
                        {num(r.outstanding) > 0 ? <span style={{ color: outColor(num(r.outstanding)) }}>{inr(r.outstanding)}</span> : <span className="text-emerald-400/70">Clear</span>}
                        <span>{r.linked} parts</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Pagination */}
              <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                <div className="flex items-center gap-2 text-[11px] text-white/45">
                  <span>Showing {filtered.length ? (safePage - 1) * per + 1 : 0}–{Math.min(safePage * per, filtered.length)} of {filtered.length} suppliers</span>
                  <select value={per} onChange={(e) => setPer(Number(e.target.value))} aria-label="Rows per page" className="px-1.5 py-0.5 rounded-md text-[10px] bg-white/5 border border-white/10 text-white/70 outline-none">
                    {PER_OPTIONS.map((n) => <option key={n} value={n} style={{ background: '#141414' }}>{n} / page</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-1">
                  <button disabled={safePage <= 1} onClick={() => setPage(1)} className="px-2 py-1 rounded-lg text-[11px] bg-white/5 border border-white/10 text-white/70 disabled:opacity-30">First</button>
                  <button disabled={safePage <= 1} onClick={() => setPage((p) => p - 1)} className="px-2 py-1 rounded-lg text-[11px] bg-white/5 border border-white/10 text-white/70 disabled:opacity-30">Prev</button>
                  <span className="px-2 text-[11px] text-white/60">{safePage}/{pageCount}</span>
                  <button disabled={safePage >= pageCount} onClick={() => setPage((p) => p + 1)} className="px-2 py-1 rounded-lg text-[11px] bg-white/5 border border-white/10 text-white/70 disabled:opacity-30">Next</button>
                  <button disabled={safePage >= pageCount} onClick={() => setPage(pageCount)} className="px-2 py-1 rounded-lg text-[11px] bg-white/5 border border-white/10 text-white/70 disabled:opacity-30">Last</button>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* Comparison overlay */}
      {showCompare && compareRows.length > 0 && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setShowCompare(false)}>
          <div role="dialog" aria-modal="true" aria-label="Supplier comparison" className="w-full max-w-3xl max-h-[85vh] overflow-auto rounded-2xl dark-scroll" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 sticky top-0" style={{ background: 'var(--surface-1)', borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
              <h4 className="text-sm font-bold text-white flex items-center gap-2"><GitCompare size={15} className="text-[#d4af37]" /> Compare Suppliers</h4>
              <button onClick={() => setShowCompare(false)} aria-label="Close" className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10"><X size={18} /></button>
            </div>
            <table className="w-full text-sm">
              <thead><tr style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}><th className="text-left px-4 py-2 text-[11px] uppercase text-white/45">Metric</th>{compareRows.map((r) => <th key={r.id} className="text-left px-4 py-2 text-white/85 font-semibold">{r.name}</th>)}</tr></thead>
              <tbody>
                {[['Health', (r) => (r.health == null ? '—' : `${healthBand(r.health).label} (${r.health})`)], ['Rating', (r) => (has(r.rating) ? `${num(r.rating).toFixed(1)}★` : '—')], ['Lead time', (r) => (has(r.lead) ? `${num(r.lead).toFixed(1)} d` : '—')], ['On-time', (r) => (has(r.onTime) ? `${Math.round(num(r.onTime))}%` : '—')], ['Accuracy', (r) => (has(r.accuracy) ? `${Math.round(num(r.accuracy))}%` : '—')], ['Outstanding', (r) => (num(r.outstanding) > 0 ? inr(r.outstanding) : 'Clear')], ['Parts', (r) => r.linked]].map(([label, fn]) => (
                  <tr key={label} style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.04)' }}><td className="px-4 py-2 text-white/45 text-xs uppercase tracking-wide">{label}</td>{compareRows.map((r) => <td key={r.id} className="px-4 py-2 text-white/85">{fn(r)}</td>)}</tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3"><button onClick={() => setCompare([])} className="text-xs font-semibold text-white/50 hover:text-white">Clear selection</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
