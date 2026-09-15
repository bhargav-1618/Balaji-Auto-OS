// components/inventory/views/ReportsView.jsx
//
// REFACTOR PHASE 8 — the Reports tab, extracted verbatim from InventoryDashboard.js.
// Pure props → JSX: reads no Firestore, owns no transaction/persistence/navigation.
// Every money/status figure routes through the SAME canonical
// billingService.invoiceTotals / invoiceStatus (aliased `invTotals` / `invStatus`
// here, exactly as in the container) that the rest of the app treats as its one
// source of truth — see the Phase 5 canonicalization.

import { useState, useEffect, useMemo } from 'react';
import { FileText, Search, X, Download, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { invoiceTotals as invTotals, invoiceStatus as invStatus } from '../../../services/billingService';
import { asArray, tsToDate } from '../../../lib/format';
import { SEMANTIC, statusColor } from '../../../constants/ui';
import { topVehicleBrands } from '../../../services/vehicleService';
import { writeSheet, asDate, stamp } from '../../../lib/exportSheet';
import { exportReportPDF } from '../../../lib/pdfTheme';
import { useDeferredSearch } from '../../../lib/useSearch';
import { RptCard } from '../ui/DashboardCards';
import PageHeader from '../../common/PageHeader';
import notify from '../../common/notify';
import toast from '../../../lib/toast';

// Local copy of the report chart palette. AnalyticsView (which stays in the container
// for now) keeps its own copy of this same fixed 8-hex brand palette — the same
// local-copy tradeoff Phase 3 made for `inr` in LedgerViews.
const RPT_COLORS = ['#d4af37', '#60a5fa', '#34d399', '#f472b6', '#a78bfa', '#fbbf24', '#22d3ee', '#fb923c'];

// Production report table (hoisted so its pagination/sort state survives parent
// re-renders). Renders one page at a time — never dumps the full dataset — so it
// scales to 10k/100k rows. Search is provided by the parent (`q`) and filters
// only THIS report's rows; export writes the full filtered+sorted set, not just
// the visible page.
function ReportTable({ head, rows, exportName, exportHead, q, csv, demoMode, demoCanExport = true, onProtectedAction }) {
  const ql = (q || '').trim().toLowerCase();
  // GLOBAL SEARCH ACCURACY — RANKING. Report rows are plain arrays (no named/typed
  // fields — each report has its own column shape, so there's no single "identifier"
  // field to isolate the way record-object modules do), so this stays a substring
  // search across every column — that IS the correct model for a report grid, closer to
  // spreadsheet search than "find the one record." What was missing was RANKING: a row
  // where some cell EQUALS the query exactly is a much stronger, more deliberate match
  // than a row where the query merely appears as a substring somewhere, but both used to
  // sort identically (whatever order `rows` happened to arrive in). Ranked here; an
  // explicit column sort (sortCol below) still wins when the user picks one — this only
  // governs the default, no-column-sort-chosen order.
  const filtered = useMemo(() => {
    if (!ql) return rows;
    const scored = [];
    for (const r of rows) {
      let score = 0;
      for (const cell of r) {
        const c = String(cell ?? '').toLowerCase();
        if (c === ql) { score = 2; break; }
        if (score < 1 && c.includes(ql)) score = 1;
      }
      if (score > 0) scored.push({ r, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map((x) => x.r);
  }, [rows, ql]);
  // Detect numeric/currency columns so they can be right-aligned with tabular figures.
  const numericCols = useMemo(() => {
    const NUM_HEAD = /^(total|gst|cgst|sgst|igst|taxable|profit|revenue|cost|sold price|sell price|rate|paid|balance|outstanding|qty|stock|stock value|hours|jobs|labour revenue|items|vehicles|invoices|odometer|rating)$/i;
    const sample = filtered.slice(0, 20);
    return head.map((h, i) => {
      if (NUM_HEAD.test(String(h).trim())) return true;
      if (!sample.length) return false;
      let numeric = 0, seen = 0;
      for (const r of sample) { const v = String(r[i] ?? '').trim(); if (!v || v === '—') continue; seen += 1; if (/^[₹]?[\d,]+(\.\d+)?$/.test(v)) numeric += 1; }
      return seen > 0 && numeric / seen >= 0.8;
    });
  }, [head, filtered]);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(1);
  const [per, setPer] = useState(25);
  useEffect(() => { setPage(1); }, [ql, sortCol, sortDir, per, rows.length]);
  const sorted = useMemo(() => {
    if (sortCol == null) return filtered;
    const numOf = (x) => { const n = parseFloat(String(x).replace(/[₹,\s]/g, '')); return Number.isFinite(n) && /^[₹\d,.\s-]+$/.test(String(x)) ? n : null; };
    const arr = [...filtered].sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol]; const an = numOf(av), bn = numOf(bv);
      if (an !== null && bn !== null) return an - bn;
      return String(av).localeCompare(String(bv), undefined, { numeric: true });
    });
    return sortDir === 'desc' ? arr.reverse() : arr;
  }, [filtered, sortCol, sortDir]);
  const pages = Math.max(1, Math.ceil(sorted.length / per));
  const pageRows = sorted.slice((page - 1) * per, page * per);
  const toggleSort = (i) => { if (sortCol === i) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSortCol(i); setSortDir('asc'); } };
  // PDF export reuses the EXACT same {head, rows} the Excel button already builds —
  // one shared framework (lib/pdfTheme.js exportReportPDF), not a report-specific PDF.
  // `exportName` ("Customer-Report", "Vehicle-Report", ...) already exists for the
  // xlsx filename; reused here as both the PDF's title and its own filename, so a
  // report's Excel and PDF exports are named consistently as a pair.
  const pdf = async () => {
    if (demoMode && !demoCanExport) { onProtectedAction?.(); return; }
    try {
      await exportReportPDF({
        title: String(exportName).replace(/-/g, ' '),
        head: exportHead || head,
        rows: sorted,
        filters: ql ? `Search: "${q}"` : undefined,
        filename: `${exportName}-${stamp()}.pdf`,
        demoMode,
      });
      notify.exported(`Exported ${exportName}`);
    } catch { toast.error('PDF export failed.'); }
  };
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <p className="text-[11px] text-white/45">{sorted.length.toLocaleString('en-IN')} row{sorted.length === 1 ? '' : 's'}{ql ? ' (filtered)' : ''}</p>
        <div className="flex items-center gap-1.5">
          <button onClick={() => csv(exportName, exportHead || head, sorted)} className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/75 hover:bg-white/10 flex items-center gap-1"><Download size={11} /> Excel ({sorted.length.toLocaleString('en-IN')})</button>
          <button onClick={pdf} className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/75 hover:bg-white/10 flex items-center gap-1"><Download size={11} /> PDF ({sorted.length.toLocaleString('en-IN')})</button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
        <table className="w-full text-xs min-w-[520px]">
          <thead className="sticky top-0 z-10">
            <tr className="text-[10px] uppercase text-white/45" style={{ background: 'var(--surface-2)' }}>
              {head.map((h, i) => (
                <th key={h} onClick={() => toggleSort(i)} className={`${numericCols[i] ? 'text-right' : 'text-left'} font-semibold py-2 px-3 whitespace-nowrap cursor-pointer select-none hover:text-white/70`} title="Click to sort">
                  <span className="inline-flex items-center gap-1">{h}{sortCol === i && <span className="text-[#d4af37]">{sortDir === 'asc' ? '▲' : '▼'}</span>}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, i) => <tr key={(page - 1) * per + i} style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.05)' }} className="hover:bg-white/[0.02]">{r.map((c, j) => <td key={j} className={`py-1.5 px-3 text-white/75 whitespace-nowrap ${numericCols[j] ? 'text-right tabular-nums' : ''}`}>{c}</td>)}</tr>)}
            {sorted.length === 0 && <tr><td colSpan={head.length} className="py-8 text-center text-white/45">{ql ? 'No rows match your search.' : 'No data for this report yet.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {sorted.length > 0 && (
        <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-white/45">Showing {(page - 1) * per + 1}–{Math.min(page * per, sorted.length)} of {sorted.length.toLocaleString('en-IN')}</span>
            <select value={per} onChange={(e) => setPer(Number(e.target.value))} className="h-7 px-1.5 rounded-lg text-[11px] bg-white/5 border border-white/10 text-white/70 outline-none">{[25, 50, 100].map((n) => <option key={n} value={n} style={{ background: '#141414' }}>{n} / page</option>)}</select>
          </div>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage(1)} className="h-7 px-2 rounded-lg text-[11px] bg-white/5 border border-white/10 text-white/60 disabled:opacity-30">« First</button>
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 disabled:opacity-30"><ChevronLeft size={14} /></button>
            <span className="text-[11px] text-white/60">Page {page} / {pages}</span>
            <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 disabled:opacity-30"><ChevronRight size={14} /></button>
            <button disabled={page >= pages} onClick={() => setPage(pages)} className="h-7 px-2 rounded-lg text-[11px] bg-white/5 border border-white/10 text-white/60 disabled:opacity-30">Last »</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Reports-view charts live INSIDE ReportsView as `RptBars` / `RptDonut` (below).
// Earlier module-level copies (`RSpark` / `RDonut` / `RBars`) were dead duplicates
// and have been removed — don't re-add a second, unwired set here.
// RptCard (the card shell) now lives in ./inventory/ui/DashboardCards (Refactor Phase 1).

// Module-scoped view state — a plain JS-module-level object, NOT sessionStorage-backed
// (Navigation State + Data Freshness review — this used to mirror into sessionStorage
// specifically so a Browser Refresh restored the last-viewed report/range, which is the bug
// that review flagged, not a feature). Survives a tab-switch unmount (the module stays
// loaded, so this object keeps its values while the user is elsewhere), but resets on a
// real reload, since the JS module re-evaluates from scratch then — a reload should land
// back on the Overview report at the default range, not silently resurrect whichever report
// was open before.
const defaultReportsView = () => ({ tab: 'overview', range: '30' });
const reportsViewState = defaultReportsView();

function ReportsView(props) {
  const { isAdmin, demoMode, demoCanExport = true, onProtectedAction, formatINR, invoices = [], customers = [], jobCards = [], inventory = [], suppliers = [], purchaseOrders = [], sales = [], restocks = [], stockAdjustments = [], auditLog = [], counts = {} } = props;
  const money = (n) => (typeof formatINR === 'function' ? formatINR(n) : `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`);
  const RV = reportsViewState;
  const [tab, setTab] = useState(RV.tab);
  const [range, setRange] = useState(RV.range);
  const [q, setQ] = useState('');
  // The typed character renders immediately (q stays fully controlled); only the
  // derived filter passed to ReportTable lags — same shared hook every other search box
  // in this app uses, was previously the one search input in this file with no
  // debouncing at all.
  const [dq] = useDeferredSearch(q);
  // Write back to the in-memory cache so it restores on tab-switch remount — not on
  // reload, see reportsViewState's own comment above.
  useEffect(() => { RV.tab = tab; RV.range = range; }, [tab, range]);

  const now = new Date();
  const startOfRange = useMemo(() => { if (range === 'all') return new Date(0); const d = new Date(); const days = { today: 0, '7': 7, '30': 30, '90': 90, '365': 365 }[range] ?? 30; d.setDate(d.getDate() - days); d.setHours(0, 0, 0, 0); return d; }, [range]);
  const inRange = (dateStr) => { if (!dateStr) return false; if (range === 'all') return true; const d = new Date(dateStr); if (Number.isNaN(d.getTime())) return false; return d >= startOfRange; };
  const inRangeMs = (ms) => { if (range === 'all') return true; if (!ms) return false; return ms >= startOfRange.getTime(); };
  // Which report sections are date-bounded (the range control applies) vs current-state
  // snapshots (range does not apply — the UI says so instead of silently ignoring it).
  const DATE_FILTERABLE = new Set(['sales', 'partsales', 'servicesales', 'laboursales', 'outsidesales', 'billing', 'jobcard', 'gst', 'audit']);


  // revenue/profit trend (last 14 days)

  // COLOR SYSTEM REVIEW: these two donut charts break down records BY STATUS (Paid/
  // Unpaid/Draft/... and Received/Ready/Delivered/...) — real semantic states, not
  // interchangeable categories. Coloring them positionally (RPT_COLORS[i % length])
  // meant the SAME status rendered a DIFFERENT color depending on which order it
  // happened to appear in that render's data — "Paid" could be gold, blue, or pink from
  // one refresh to the next, and never matched the same word's color on the Billing/Job
  // Cards table it summarizes. Now pulls from the ONE shared statusColor() map every
  // status badge in the app already uses, so the donut's "Paid" slice is the exact same
  // green as the "Paid" badge in Billing, every time.
  const invoiceStatusMix = useMemo(() => { const m = {}; invoices.forEach((iv) => { const s = invStatus(iv); m[s] = (m[s] || 0) + 1; }); return Object.entries(m).map(([label, value]) => ({ label, value, color: statusColor(label) })); }, [invoices]);
  const jobStatusMix = useMemo(() => { const m = {}; jobCards.forEach((j) => { m[j.status || 'Received'] = (m[j.status || 'Received'] || 0) + 1; }); return Object.entries(m).map(([label, value]) => ({ label, value, color: statusColor(label) })); }, [jobCards]);
  const topCustomers = useMemo(() => { const m = {}; invoices.forEach((iv) => { if (invStatus(iv) === 'Cancelled') return; m[iv.customer || '—'] = (m[iv.customer || '—'] || 0) + invTotals(iv).grand; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, v]) => ({ label, v, display: money(v) })); }, [invoices]);
  // E2E workflow QA fix: same gross-vs-net bug as invTotals' parts/labour and Billing's
  // own topParts — summed raw qty*rate with no line-discount adjustment, inflating a
  // discounted part's reported Reports/Analytics revenue above what was actually billed.
  const topParts = useMemo(() => { const m = {}; invoices.forEach((iv) => asArray(iv.lines).filter((l) => l.kind === 'Part').forEach((l) => { const gross = (Number(l.qty) || 0) * (Number(l.rate) || 0); const net = l.disc ? Math.max(0, gross - gross * ((Number(l.disc) || 0) / 100)) : gross; m[l.desc || '—'] = (m[l.desc || '—'] || 0) + net; })); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, v]) => ({ label, v, display: money(v) })); }, [invoices]);
  const brandMix = useMemo(() => topVehicleBrands(customers, 8).map((x, i) => ({ ...x, color: RPT_COLORS[i % RPT_COLORS.length] })), [customers]);
  // COLOR SYSTEM REVIEW: this is a SEVERITY gradient (older overdue money = more
  // concerning), not an arbitrary category breakdown — positional rainbow coloring
  // actively misled here: the 61-90 day bucket rendered GREEN, the color that means
  // "healthy" everywhere else in this app, for money that is in fact more overdue than
  // the 0-30 bucket. Fixed to one hue (danger red) at escalating opacity, so the chart
  // itself reads as "getting worse" left to right, the way an aging report should.
  const AGEING_SEVERITY = ['4d', '66', '88', 'ff']; // opacity steps: ~30%, 40%, 53%, 100%
  const outstandingAgeing = useMemo(() => {
    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    invoices.forEach((iv) => { const t = invTotals(iv); if (t.balance <= 0) return; const days = Math.floor((now - new Date(iv.date)) / 864e5); if (days <= 30) buckets['0-30'] += t.balance; else if (days <= 60) buckets['31-60'] += t.balance; else if (days <= 90) buckets['61-90'] += t.balance; else buckets['90+'] += t.balance; });
    return Object.entries(buckets).map(([label, value], i) => ({ label, value, color: `${SEMANTIC.danger}${AGEING_SEVERITY[i]}` }));
  }, [invoices]);
  const technicianPerf = useMemo(() => {
    const m = {};
    jobCards.forEach((j) => { const tech = j.technician || '—'; if (!m[tech]) m[tech] = { jobs: 0, labour: 0 }; m[tech].jobs += 1; m[tech].labour += asArray(j.labour).reduce((s, l) => s + (Number(l.hours) || 0) * (Number(l.rate) || 0), 0); }); // PH21-D1
    return Object.entries(m).filter(([k]) => k !== '—').sort((a, b) => b[1].labour - a[1].labour).slice(0, 8).map(([label, d]) => ({ label, jobs: d.jobs, labour: d.labour }));
  }, [jobCards]);

  // Was CSV with every value quoted, so the analytics figures reached Excel as text.
  const csv = async (name, head, rows) => {
    if (demoMode && !demoCanExport) { onProtectedAction?.(); return; }
    try {
      const dateCols = head.reduce((acc, h, i) => (/date/i.test(h) ? [...acc, i] : acc), []);
      const body = rows.map((r) => r.map((x, i) => (dateCols.includes(i) ? asDate(x) : x ?? '')));
      await writeSheet({ filename: `${name}-${stamp()}.xlsx`, sheetName: String(name).slice(0, 28), head, rows: body, dateCols });
      notify.exported(`Exported ${name}`);
    } catch (e) {
      toast.error('Export failed.');
    }
  };

  const SECTIONS = [
    ['overview', 'Overview'],
    ['sales', 'Revenue (Invoices)'], ['partsales', 'Parts Sales'], ['servicesales', 'Service Sales'], ['laboursales', 'Labour Charges'], ['outsidesales', 'Outside Purchases'],
    ['billing', 'Billing'], ['inventory', 'Inventory'], ['customer', 'Customer'],
    ['vehicle', 'Vehicle'], ['jobcard', 'Job Card'], ['technician', 'Technician'], ['supplier', 'Supplier'], ['purchase', 'Purchase'], ['gst', 'GST'], ['audit', 'Audit'],
  ];

  const Card = RptCard;

  // ---- per-section report table data ----
  const salesRows = invoices.filter((iv) => !iv.isEstimate && inRange(iv.date)).map((iv) => { const t = invTotals(iv); return [iv.invNo, iv.date, iv.customer, iv.vehicle || '', money(t.grand), money(t.gst), money(t.profit), invStatus(iv)]; });
  // Line-level revenue reports, split by category, sourced from the sales ledger.
  const catOfSale = (s) => s.revenueType || s.category || (s.partId ? 'Parts' : 'Service');
  const saleMs = (s) => { const d = tsToDate(s.createdAt); return d ? d.getTime() : 0; };
  const saleDateStr = (s) => { const d = tsToDate(s.createdAt); return d ? d.toLocaleDateString('en-IN') : ''; };
  const salesByCat = (cats) => sales.filter((s) => cats.includes(catOfSale(s)) && inRangeMs(saleMs(s)));
  const partSaleRows = salesByCat(['Parts']).map((s) => [s.name, s.invoiceNo || '—', s.customer || '—', s.vehicle || '—', String(s.qty ?? ''), money(s.unitCost || 0), money(s.unitPrice || 0), money(s.revenue || 0), money(s.profit || 0), saleDateStr(s)]);
  const serviceSaleRows = salesByCat(['Service']).map((s) => [s.name, s.invoiceNo || '—', s.customer || '—', s.vehicle || '—', s.technician || '—', String(s.qty ?? ''), money(s.unitPrice || 0), money(s.revenue || 0), saleDateStr(s)]);
  const labourSaleRows = salesByCat(['Labour']).map((s) => [s.name, s.invoiceNo || '—', s.customer || '—', s.vehicle || '—', s.technician || '—', String(s.qty ?? ''), money(s.unitPrice || 0), money(s.revenue || 0), saleDateStr(s)]);
  const outsideSaleRows = salesByCat(['Outside Purchase']).map((s) => [s.name, s.invoiceNo || '—', s.customer || '—', s.vehicle || '—', String(s.qty ?? ''), money(s.unitPrice || 0), money(s.revenue || 0), saleDateStr(s)]);
  const billingRows = invoices.filter((iv) => inRange(iv.date)).map((iv) => { const t = invTotals(iv); return [iv.invNo, iv.date, iv.customer, money(t.grand), money(t.paid), money(t.balance), invStatus(iv), asArray(iv.payments).map((p) => p.mode).join('/') || '—']; });
  const inventoryRows = inventory.filter((p) => !p.archived).map((p) => [p.name, p.sku || '', p.stock || 0, money((Number(p.stock) || 0) * (Number(p.purchasePrice) || 0)), money(p.sellingPrice || p.defaultSellingPrice || 0), p.category || '', p.brand || '']);
  const customerRows = customers.map((c) => { const cInv = invoices.filter((iv) => (iv.phone || '') === (c.phone || '')); const rev = cInv.reduce((s, iv) => s + invTotals(iv).grand, 0); return [c.name, c.phone || '', c.city || '', (c.vehicles || []).length, cInv.length, money(rev), money(c.outstanding || 0)]; });
  const vehicleRows = customers.flatMap((c) => asArray(c.vehicles).map((v) => [v.regNo || '', v.make || (v.vehicle || '').split(' ')[0] || '', v.model || v.vehicle || '', v.fuel || '', c.name, v.insuranceExpiry || '', v.odometer || ''])); // PH21-D1
  // E2E workflow QA fix: this passed the raw stored value straight through — for a Job
  // Card that's `j.dateIn` (a datetime-local input string, "2026-08-27T00:04"), never
  // `saleDateStr()`-style formatted like every other report's date column ("26/8/2026").
  // Reproduced live: Job Card Report's PDF and on-screen table both showed the raw
  // ISO-ish string verbatim, inconsistent with Revenue/Parts/Labour/Billing/Customer/
  // Vehicle reports sitting right next to it in the same tab bar. Matched to the same
  // `toLocaleDateString('en-IN')` pattern `saleDateStr()` already uses — kept as a plain
  // string (not a real Date object) since ReportTable renders cells directly as JSX
  // children, which throws on a raw Date instance.
  const jobDateStr = (j) => { const raw = j.date || j.dateIn; if (!raw) return ''; const d = new Date(raw); return Number.isNaN(d.getTime()) ? String(raw) : d.toLocaleDateString('en-IN'); };
  const jobcardRows = jobCards.filter((j) => inRange(j.date || j.dateIn)).map((j) => [j.jobNo, jobDateStr(j), j.customer || '', j.vehicle || '', j.technician || '', j.advisor || '', j.status || '']);
  const technicianRows = technicianPerf.map((t) => [t.label, t.jobs, money(t.labour)]);
  const supplierRows = suppliers.map((s) => [s.name, s.code || '', s.type || '', s.city || '', s.gst ? 'GST' : 'Non-GST', money(s.outstanding || 0), s.rating || '']);
  // Issue 8 (cross-module review) — Status alone can now read "Partially Received" (the
  // real partial-receiving lifecycle added in the PO pass), but this report gave no sense
  // of HOW MUCH — the data (items[].receivedQty) already exists on the PO doc, just wasn't
  // surfaced here.
  const purchaseRows = purchaseOrders.map((po) => {
    const items = po.items || [];
    const orderedUnits = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
    const receivedUnits = items.reduce((s, it) => s + (Number(it.receivedQty) || 0), 0);
    const received = orderedUnits > 0 && receivedUnits > 0 ? `${receivedUnits} / ${orderedUnits} units` : '—';
    return [po.poNumber, po.supplierName || '', po.status || '', items.length, received, money(po.total || 0), po.expectedDate || '', po.priority || 'Normal'];
  });
  // Refactor Phase 5 — reads the canonical invoiceTotals shape: `.afterDisc` is the
  // 2-dp pre-GST taxable base (was the `.taxable` alias), and `.cgst`/`.sgst`/`.igst`
  // are split from the ALREADY-ROUNDED gst so cgst + sgst === gst exactly (was a
  // hand `t.gst / 2` that could each round up on an odd-paisa amount).
  const gstRows = invoices.filter((iv) => !iv.isEstimate && invStatus(iv) !== 'Cancelled' && inRange(iv.date)).map((iv) => { const t = invTotals(iv); return [iv.invNo, iv.date, iv.gstNo || 'Unregistered', money(t.afterDisc), money(t.cgst), money(t.sgst), money(t.igst), money(t.gst)]; });
  // E2E workflow QA fix: this read a.at/a.by/a.user/a.meta, but every real writer
  // (pushAudit and writeAudit, both in this same file) stamps entries as
  // createdAt/performedBy/performedByEmail/details — a field-name mismatch left over
  // from an older schema. Since no entry ever HAD an `.at` field, `inRangeMs(undefined)`
  // filtered out literally every row, so this report showed "0 rows" / "No data for
  // this report yet" no matter how much real audit activity existed. Reproduced live:
  // Invoice Created/Paid events for two fresh invoices, confirmed present in Firestore,
  // never appeared here under any date range.
  const auditAtMs = (a) => { const v = a.createdAt ?? a.at; if (v?.toMillis) return v.toMillis(); if (typeof v === 'string') return new Date(v).getTime(); if (typeof v === 'number') return v; return NaN; };
  const auditRows = auditLog.filter((a) => inRangeMs(auditAtMs(a))).slice(0, 500).map((a) => [a.action || a.type || '', a.entity || a.module || '', a.performedByEmail || a.by || a.user || 'System', Number.isFinite(auditAtMs(a)) ? new Date(auditAtMs(a)).toLocaleString('en-IN') : '', typeof (a.details ?? a.meta) === 'string' ? (a.details ?? a.meta) : JSON.stringify(a.details ?? a.meta ?? {}).slice(0, 60)]);

  // ── Overview KPIs — reuse existing invTotals/invStatus; no new financial logic ──
  const kpis = useMemo(() => {
    const live = invoices.filter((iv) => !iv.isEstimate && invStatus(iv) !== 'Cancelled');
    const revenue = live.reduce((s, iv) => s + invTotals(iv).grand, 0);
    const gst = live.reduce((s, iv) => s + invTotals(iv).gst, 0);
    const outstanding = invoices.reduce((s, iv) => s + (invStatus(iv) === 'Cancelled' ? 0 : Math.max(0, invTotals(iv).balance)), 0);
    const openJobs = jobCards.filter((j) => !['Closed', 'Cancelled', 'Delivered'].includes(j.status)).length;
    const invValue = inventory.filter((p) => !p.archived).reduce((s, p) => s + (Number(p.stock) || 0) * (Number(p.purchasePrice) || 0), 0);
    return { revenue, gst, outstanding, invoices: live.length, openJobs, invValue };
  }, [invoices, jobCards, inventory]);

  const RptBars = ({ data }) => {
    const max = Math.max(1, ...data.map((d) => d.v ?? d.value ?? 0));
    if (!data.length) return <p className="text-xs text-white/45 py-6 text-center">No data available.</p>;
    return (
      <div className="space-y-2">
        {data.map((d, i) => (
          <div key={d.label + i} className="flex items-center gap-2">
            <span className="text-[11px] text-white/60 w-28 truncate" title={d.label}>{d.label}</span>
            <div className="flex-1 h-4 rounded bg-white/5 overflow-hidden"><div className="h-full rounded" style={{ width: `${((d.v ?? d.value ?? 0) / max) * 100}%`, background: d.color || RPT_COLORS[i % RPT_COLORS.length] }} /></div>
            <span className="text-[11px] text-white/70 tabular-nums w-20 text-right">{d.display ?? d.value}</span>
          </div>
        ))}
      </div>
    );
  };
  const RptDonut = ({ data }) => {
    const total = data.reduce((s, d) => s + (d.value || 0), 0);
    if (!total) return <p className="text-xs text-white/45 py-6 text-center">No data available.</p>;
    let acc = 0;
    const stops = data.map((d) => { const start = (acc / total) * 100; acc += d.value; const end = (acc / total) * 100; return `${d.color} ${start}% ${end}%`; }).join(', ');
    return (
      <div className="flex items-center gap-4">
        <div className="w-24 h-24 rounded-full flex-shrink-0 relative" style={{ background: `conic-gradient(${stops})` }} aria-hidden="true">
          <div className="absolute inset-[30%] rounded-full flex items-center justify-center" style={{ background: '#141414' }}><span className="text-xs font-bold text-white/70 tabular-nums">{total}</span></div>
        </div>
        <div className="flex-1 space-y-1">
          {data.map((d, i) => <div key={d.label + i} className="flex items-center gap-2 text-[11px]"><span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: d.color }} /><span className="text-white/60 flex-1 truncate">{d.label}</span><span className="text-white/70 tabular-nums">{d.value}</span></div>)}
        </div>
      </div>
    );
  };

  // Invoice Status card — deliberately NOT the shared RptDonut above (that stays
  // untouched: Job Status and Vehicle Brand Mix render through it unchanged). This
  // is a dedicated renderer using the SAME `invoices` array (and therefore the SAME
  // invStatus()/invTotals() this file already treats as the one source of truth for
  // invoice money/status — see kpis.outstanding above) so every number on the card
  // can never disagree with another. `mix` reuses invoiceStatusMix exactly as it
  // already exists — every slice is a REAL status invStatus() actually returns for
  // this data; nothing here can display a status the app doesn't have.
  //
  // No donut here (removed by request): it duplicated the same collection-rate
  // information as the Collection Progress bar below with a second visual encoding
  // of the identical number. One collection indicator (the progress bar) instead of
  // two — nothing computes a chart-only value that only fed the removed donut.
  const InvoiceStatusPanel = ({ mix, invoices: invs }) => {
    const total = mix.reduce((s, d) => s + (d.value || 0), 0);
    if (!total) return <p className="text-xs text-white/45 py-8 text-center">No invoice data available.</p>;
    // Per-invoice grand = paid + balance always holds (invTotals derives balance as
    // max(0, grand - paid)), so summing the same three fields across the same
    // invoice list guarantees Total Invoice Value = Collected + Outstanding by
    // construction — no separate reconciliation step needed.
    const sums = invs.reduce((s, iv) => { const t = invTotals(iv); s.grand += t.grand; s.paid += t.paid; s.balance += t.balance; return s; }, { grand: 0, paid: 0, balance: 0 });
    const collectionRate = sums.grand > 0 ? (sums.paid / sums.grand) * 100 : 0;
    const allCollected = sums.balance <= 0 && sums.grand > 0;
    // Collection Progress below is a genuinely different cut of the SAME
    // invs/invTotals pass above, not a restatement of collectionRate: collectionRate
    // is value-weighted (₹ collected ÷ ₹ billed); collectedPct is count-weighted
    // (invoices with zero balance ÷ all invoices) — the two can legitimately differ
    // (e.g. many small paid invoices + one large outstanding one), so showing both
    // is real information. avg/high/low give a third, distinct lens (invoice size
    // distribution) nothing else on this card surfaces.
    const grands = invs.map((iv) => invTotals(iv).grand);
    const avgInvoice = grands.length ? Math.round(sums.grand / grands.length) : 0;
    const highInvoice = grands.length ? Math.max(...grands) : 0;
    const lowInvoice = grands.length ? Math.min(...grands) : 0;
    const collectedCount = invs.filter((iv) => invTotals(iv).balance <= 0).length;
    const collectedPct = total > 0 ? (collectedCount / total) * 100 : 0;
    return (
      <div className="space-y-3.5">
        {/* Status breakdown — real counts/percentages, communicated by both the
            color swatch AND text (label + count + %), not color alone. Full card
            width now that there's no donut column to share space with. */}
        <div className="space-y-1">
          {mix.map((d) => (
            <div key={d.label} className="flex items-center gap-2 text-[11px]">
              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: d.color }} aria-hidden="true" />
              <span className="text-white/60 flex-1 truncate">{d.label}</span>
              <span className="text-white/80 tabular-nums">{d.value}</span>
              <span className="text-white/40 tabular-nums w-9 text-right">{Math.round((d.value / total) * 100)}%</span>
            </div>
          ))}
        </div>
        <div className="h-px" style={{ background: 'rgba(var(--fg-rgb),0.08)' }} />
        {/* Financial summary — each row is its own full-width flex, not a narrow
            grid, so labels share one left edge and values share one right edge by
            construction (same container width every row) rather than by a fixed
            column measurement. */}
        <div className="space-y-1.5 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="text-white/45">Total Invoice Value</span>
            <span className="text-white/85 font-semibold tabular-nums" title={money(sums.grand)}>{money(sums.grand)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/45">Collected</span>
            <span className="font-semibold tabular-nums" style={{ color: SEMANTIC.ok }} title={money(sums.paid)}>{money(sums.paid)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/45">Outstanding</span>
            <span className="font-semibold tabular-nums" style={{ color: sums.balance > 0 ? SEMANTIC.danger : 'rgba(var(--fg-rgb),0.6)' }} title={money(sums.balance)}>{money(sums.balance)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/45">Collection Rate</span>
            <span className="text-white/85 font-semibold tabular-nums">{collectionRate.toFixed(1)}%</span>
          </div>
        </div>
        <div className="h-px" style={{ background: 'rgba(var(--fg-rgb),0.08)' }} />
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-white/45 mb-2">Payment Performance</p>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-white/60">Collection Progress</span>
              <span className="text-white/80 font-semibold tabular-nums">{Math.round(collectedPct)}%</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(var(--fg-rgb),0.08)' }}>
              <div className="h-full rounded-full" style={{ width: `${collectedPct}%`, background: allCollected ? SEMANTIC.ok : SEMANTIC.gold }} />
            </div>
            <p className="text-[10px] text-white/45 flex items-center gap-1">
              {allCollected && <Check size={11} className="flex-shrink-0" style={{ color: SEMANTIC.ok }} />}
              <span>{collectedCount} of {total} invoice{total === 1 ? '' : 's'} fully collected</span>
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 text-center">
            <div>
              <p className="text-[9px] uppercase tracking-wide text-white/40">Avg Invoice</p>
              <p className="text-xs font-semibold text-white/85 tabular-nums truncate" title={money(avgInvoice)}>{money(avgInvoice)}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wide text-white/40">Highest</p>
              <p className="text-xs font-semibold text-white/85 tabular-nums truncate" title={money(highInvoice)}>{money(highInvoice)}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wide text-white/40">Lowest</p>
              <p className="text-xs font-semibold text-white/85 tabular-nums truncate" title={money(lowInvoice)}>{money(lowInvoice)}</p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <PageHeader title="Reports" icon={FileText}
      subtitle={DATE_FILTERABLE.has(tab)
        ? `${SECTIONS.find(([k]) => k === tab)?.[1] || ''} · ${{ today: 'Today', 7: 'Last 7 days', 30: 'This month', 90: 'This quarter', 365: 'This year', all: 'All time' }[range]}`
        : `${SECTIONS.find(([k]) => k === tab)?.[1] || ''} · current snapshot`}
      action={
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-white/45 hidden sm:block">Range</label>
        <select value={range} onChange={(e) => setRange(e.target.value)} aria-label="Report date range" disabled={!DATE_FILTERABLE.has(tab)} title={DATE_FILTERABLE.has(tab) ? 'Filter this report by date' : 'This report shows current data — date range does not apply'} className="px-2.5 py-2 rounded-lg text-xs bg-white/5 border border-white/10 text-white outline-none focus:border-[#d4af37]/60 disabled:opacity-40 disabled:cursor-not-allowed">
          {[['today', 'Today'], ['7', 'Last 7 Days'], ['30', 'This Month'], ['90', 'Quarter'], ['365', 'Year'], ['all', 'All Time']].map(([v, l]) => <option key={v} value={v} style={{ background: '#141414' }}>{l}</option>)}
        </select>
      </div>
    }>
      {/* section tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl w-max max-w-full overflow-x-auto dark-scroll" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
        {SECTIONS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${tab === k ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]' : 'text-white/60 hover:text-white/90'}`}>{l}</button>)}
      </div>

      {tab !== 'overview' && (
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/45" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search within this report…" aria-label="Search within this report" className="w-full pl-9 pr-9 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 text-white placeholder-white/30 outline-none focus:border-[#d4af37]/60" />
        {q && <button onClick={() => setQ('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg flex items-center justify-center text-white/45 hover:text-white hover:bg-white/10"><X size={14} /></button>}
      </div>
      )}

      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {/* COLOR SYSTEM REVIEW: this row was still 6 independently hardcoded hex values
                (green/blue/red/gold/amber/purple — one of every color for six cards, the
                exact "every KPI has its own unrelated color" anti-pattern the rest of the
                app was fixed to avoid) and had never been brought in line with the SEMANTIC
                tokens used everywhere else. Revenue is the one headline aggregate → gold,
                matching Billing's "Today's Revenue"/Sales &amp; Services' "Revenue Today".
                Outstanding is a genuine negative financial state → danger, unchanged in
                spirit (was already red) but now via the shared token. Invoices/GST
                Collected/Open Jobs/Inventory Value are plain magnitude or breakdown
                figures with no inherent status of their own → muted, matching Billing's
                own "GST Collected"/"Today's Invoices" and Inventory's own "Inventory
                Value" conventions elsewhere in this same file. */}
            {[
              ['Revenue', money(kpis.revenue), 'Non-cancelled invoices', SEMANTIC.gold],
              ['Invoices', String(kpis.invoices), 'Billed to date', SEMANTIC.muted],
              ['Outstanding', money(kpis.outstanding), 'Unpaid balances', SEMANTIC.danger],
              ['GST Collected', money(kpis.gst), 'On taxable sales', SEMANTIC.muted],
              ['Open Jobs', String(kpis.openJobs), 'Active job cards', SEMANTIC.muted],
              ['Inventory Value', money(kpis.invValue), 'Stock at cost', SEMANTIC.muted],
            ].map(([label, value, sub, color]) => (
              <div key={label} className="rounded-2xl p-3.5" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
                <p className="text-[10px] uppercase tracking-wide text-white/45">{label}</p>
                <p className="text-lg font-bold mt-1 tabular-nums truncate" style={{ color }} title={value}>{value}</p>
                <p className="text-[10px] text-white/45 mt-0.5">{sub}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <RptCard title="Invoice Status"><InvoiceStatusPanel mix={invoiceStatusMix} invoices={invoices} /></RptCard>
            <RptCard title="Job Status"><RptDonut data={jobStatusMix} /></RptCard>
            <RptCard title="Top Customers by Revenue"><RptBars data={topCustomers} /></RptCard>
            <RptCard title="Top Parts by Value"><RptBars data={topParts} /></RptCard>
            <RptCard title="Outstanding Ageing"><RptBars data={outstandingAgeing} /></RptCard>
            <RptCard title="Vehicle Brand Mix"><RptDonut data={brandMix} /></RptCard>
          </div>
          <p className="text-[11px] text-white/45 text-center">Overview reflects all-time data. Use the section tabs above for date-filtered detail reports.</p>
        </div>
      )}


      {tab === 'sales' && <Card title="Revenue by Invoice"><ReportTable q={dq} csv={csv} demoMode={demoMode} demoCanExport={demoCanExport} onProtectedAction={onProtectedAction} head={['Invoice', 'Date', 'Customer', 'Vehicle', 'Total', 'GST', 'Profit', 'Status']} rows={salesRows} exportName="Revenue-by-Invoice" /></Card>}
      {tab === 'partsales' && <Card title="Parts Sales"><ReportTable q={dq} csv={csv} demoMode={demoMode} demoCanExport={demoCanExport} onProtectedAction={onProtectedAction} head={['Part', 'Invoice', 'Customer', 'Vehicle', 'Qty', 'Cost', 'Sold Price', 'Revenue', 'Profit', 'Date']} rows={partSaleRows} exportName="Parts-Sales-Report" /></Card>}
      {tab === 'servicesales' && <Card title="Service Sales"><ReportTable q={dq} csv={csv} demoMode={demoMode} demoCanExport={demoCanExport} onProtectedAction={onProtectedAction} head={['Service', 'Invoice', 'Customer', 'Vehicle', 'Technician', 'Qty', 'Rate', 'Revenue', 'Date']} rows={serviceSaleRows} exportName="Service-Sales-Report" /></Card>}
      {tab === 'laboursales' && <Card title="Labour Charges"><ReportTable q={dq} csv={csv} demoMode={demoMode} demoCanExport={demoCanExport} onProtectedAction={onProtectedAction} head={['Labour', 'Invoice', 'Customer', 'Vehicle', 'Technician', 'Hours', 'Rate', 'Revenue', 'Date']} rows={labourSaleRows} exportName="Labour-Charges-Report" /></Card>}
      {tab === 'outsidesales' && <Card title="Outside Purchases"><ReportTable q={dq} csv={csv} demoMode={demoMode} demoCanExport={demoCanExport} onProtectedAction={onProtectedAction} head={['Item', 'Invoice', 'Customer', 'Vehicle', 'Qty', 'Rate', 'Revenue', 'Date']} rows={outsideSaleRows} exportName="Outside-Purchases-Report" /></Card>}
      {tab === 'billing' && <Card title="Billing Report"><ReportTable q={dq} csv={csv} demoMode={demoMode} demoCanExport={demoCanExport} onProtectedAction={onProtectedAction} head={['Invoice', 'Date', 'Customer', 'Total', 'Paid', 'Balance', 'Status', 'Modes']} rows={billingRows} exportName="Billing-Report" /></Card>}
      {tab === 'inventory' && <Card title="Inventory Report"><ReportTable q={dq} csv={csv} demoMode={demoMode} demoCanExport={demoCanExport} onProtectedAction={onProtectedAction} head={['Part', 'SKU', 'Stock', 'Stock Value', 'Sell Price', 'Category', 'Brand']} rows={inventoryRows} exportName="Inventory-Report" /></Card>}
      {tab === 'customer' && <Card title="Customer Report"><ReportTable q={dq} csv={csv} demoMode={demoMode} demoCanExport={demoCanExport} onProtectedAction={onProtectedAction} head={['Customer', 'Phone', 'City', 'Vehicles', 'Invoices', 'Revenue', 'Outstanding']} rows={customerRows} exportName="Customer-Report" /></Card>}
      {tab === 'vehicle' && <Card title="Vehicle Report"><ReportTable q={dq} csv={csv} demoMode={demoMode} demoCanExport={demoCanExport} onProtectedAction={onProtectedAction} head={['Reg No', 'Brand', 'Model', 'Fuel', 'Owner', 'Insurance Expiry', 'Odometer']} rows={vehicleRows} exportName="Vehicle-Report" /></Card>}
      {tab === 'jobcard' && <Card title="Job Card Report"><ReportTable q={dq} csv={csv} demoMode={demoMode} demoCanExport={demoCanExport} onProtectedAction={onProtectedAction} head={['Job No', 'Date', 'Customer', 'Vehicle', 'Technician', 'Advisor', 'Status']} rows={jobcardRows} exportName="JobCard-Report" /></Card>}
      {tab === 'technician' && <Card title="Technician Report"><ReportTable q={dq} csv={csv} demoMode={demoMode} demoCanExport={demoCanExport} onProtectedAction={onProtectedAction} head={['Technician', 'Jobs', 'Labour Revenue']} rows={technicianRows} exportName="Technician-Report" /></Card>}
      {tab === 'supplier' && <Card title="Supplier Report"><ReportTable q={dq} csv={csv} demoMode={demoMode} demoCanExport={demoCanExport} onProtectedAction={onProtectedAction} head={['Supplier', 'Code', 'Type', 'City', 'GST', 'Outstanding', 'Rating']} rows={supplierRows} exportName="Supplier-Report" /></Card>}
      {tab === 'purchase' && <Card title="Purchase Report"><ReportTable q={dq} csv={csv} demoMode={demoMode} demoCanExport={demoCanExport} onProtectedAction={onProtectedAction} head={['PO', 'Supplier', 'Status', 'Items', 'Received', 'Total', 'Expected', 'Priority']} rows={purchaseRows} exportName="Purchase-Report" /></Card>}
      {tab === 'gst' && <Card title="GST Report" right={<span className="text-[10px] text-white/45">GST optional — unregistered suppliers/customers included at 0%</span>}><ReportTable q={dq} csv={csv} demoMode={demoMode} demoCanExport={demoCanExport} onProtectedAction={onProtectedAction} head={['Invoice', 'Date', 'GSTIN', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total GST']} rows={gstRows} exportName="GST-Report" /></Card>}
      {tab === 'audit' && <Card title="Audit Report">{isAdmin ? <ReportTable q={dq} csv={csv} demoMode={demoMode} demoCanExport={demoCanExport} onProtectedAction={onProtectedAction} head={['Action', 'Module', 'User', 'Timestamp', 'Details']} rows={auditRows} exportName="Audit-Report" /> : <p className="text-sm text-white/45 py-6 text-center">Audit reports are available to administrators.</p>}</Card>}
    </PageHeader>
  );
}

export { ReportTable, defaultReportsView };
export default ReportsView;
