// components/common/LedgerPage.jsx
// Extracted from InventoryDashboard.js (Issue 7.7/7.8/7.9 — Stock Operations review).
// Was defined ONLY inside InventoryDashboard.js despite already backing four modules
// (Sales, Services, Stock In, Stock Out) — so when Inventory's own "Stock" sub-tab
// needed the exact same search/filter/date-range/clickable-detail behaviour, it
// couldn't reuse this at all and grew a second, weaker, bespoke timeline instead
// (type-filter only, no search, rows not clickable). Promoted here so every
// consumer — including that Stock sub-tab now — shares ONE implementation of
// filtering, date-range math, and the movement/record detail drawer.
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Download, X, ChevronRight } from 'lucide-react';
import PageHeader from './PageHeader';
import notify from './notify';
import toast from '../../lib/toast';
import { writeSheet, asDate, stamp } from '../../lib/exportSheet';
import { useDeferredSearch, matchIndexed, normId, rankIndexed } from '../../lib/useSearch';
import { safeLower, tsToDate } from '../../lib/format';
import { lockBody, unlockBody } from '../Modal';
import { useTranslation } from '../../lib/i18n';

export function LedgerRow({ left, mid, right, sub }) {
  return (
    <div className="group flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-all duration-150 hover:bg-white/[0.06] hover:shadow-lg hover:shadow-black/20 hover:-translate-y-px" style={{ background: 'rgba(var(--fg-rgb),0.025)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
      <div className="min-w-0 flex-1"><p className="text-sm text-white/90 font-medium truncate">{left}</p>{sub && <p className="text-[11px] text-white/45 mt-0.5">{sub}</p>}</div>
      {mid && <span className="text-xs text-white/50 flex-shrink-0">{mid}</span>}
      <span className="text-sm font-semibold flex-shrink-0">{right}</span>
      <ChevronRight size={15} className="text-white/15 group-hover:text-white/45 transition flex-shrink-0" />
    </div>
  );
}

export function StatStrip({ cards }) {
  const n = cards.length;
  const lgCols = n % 4 === 0 ? 4 : n % 3 === 0 ? 3 : n % 5 === 0 ? 5 : n <= 4 ? n : (n % 2 === 0 ? Math.min(n, 4) : 3);
  const lgClass = { 1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6' }[lgCols] || 'lg:grid-cols-4';
  const smClass = n % 3 === 0 ? 'sm:grid-cols-3' : 'sm:grid-cols-2';
  return (
    <div className={`grid grid-cols-2 ${smClass} ${lgClass} gap-3`}>
      {cards.map((c) => (
        <div key={c.label} className="rounded-2xl p-3.5 backdrop-blur-sm transition hover:bg-white/[0.05]" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
          <div className="flex items-center gap-2 mb-1.5">
            {c.icon && <span className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(212,175,55,0.12)' }}><c.icon size={13} className="text-[#d4af37]" /></span>}
            <span className="text-[10px] uppercase tracking-wider text-white/45 leading-tight">{c.label}</span>
          </div>
          <p className="text-xl font-bold" style={{ color: c.color || '#fff' }}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}

export const dstr = (ts) => { const d = tsToDate(ts); return d ? d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; };

// Issue 7.9 — the date-range window a `range` value resolves to. Exported so any
// caller doing its own filtering outside <LedgerPage> (the Inventory Stock tab,
// which reuses LedgerRow/the detail drawer but keeps its own page layout) computes
// the SAME "This Week"/"This Month"/custom windows instead of a second definition
// that could quietly drift from this one.
export function rangeToWindow(range, customStart, customEnd) {
  const now = Date.now(), day = 86400000;
  const yStart = new Date(); yStart.setHours(0, 0, 0, 0);
  if (range === 'today') return { from: yStart.getTime(), to: now };
  if (range === 'yesterday') return { from: yStart.getTime() - day, to: yStart.getTime() };
  if (range === '7d') return { from: now - 7 * day, to: now };
  if (range === '30d') return { from: now - 30 * day, to: now };
  if (range === 'thisweek') {
    const d = new Date(); const dow = d.getDay(); const diff = dow === 0 ? 6 : dow - 1; // Monday start
    const monday = new Date(d); monday.setDate(d.getDate() - diff); monday.setHours(0, 0, 0, 0);
    return { from: monday.getTime(), to: now };
  }
  if (range === 'thismonth') {
    const d = new Date(); const first = new Date(d.getFullYear(), d.getMonth(), 1);
    return { from: first.getTime(), to: now };
  }
  if (range === 'custom') {
    const from = customStart ? new Date(customStart).setHours(0, 0, 0, 0) : 0;
    const to = customEnd ? new Date(customEnd).setHours(23, 59, 59, 999) : now;
    return { from, to };
  }
  return null; // 'all'
}

// Issue 7.8/7.9 — the ONE filter+sort implementation for every ledger-shaped list in
// the app. Items are pre-normalized: { id, t(ms), s(searchText), ids?, ty, qty,
// amount }. Exported (not just used internally by <LedgerPage>) so a caller with its
// own page layout — Inventory's Stock tab — filters identically instead of
// reimplementing search/range/sort a second time.
export function filterLedgerItems(items, { q, type, range, sort, customStart, customEnd } = {}) {
  const needle = (q || '').trim();
  const win = rangeToWindow(range, customStart, customEnd);
  const entryOf = (it) => ({ hay: safeLower(it.s), ids: (it.ids || []).map(normId) });
  let arr = items.filter((it) => {
    // GLOBAL SEARCH ACCURACY: items may carry an optional `ids` array (unique
    // identifiers — Invoice No., Part Number/SKU, ...) that match exact-then-partial via
    // rankIndexed (identifier hits ranked above free-text ones) — see matchIndexed. `s`
    // (name/customer/vehicle/etc.) stays partial-searchable exactly as before.
    if (needle && !matchIndexed(entryOf(it), needle)) return false;
    if (type && type !== 'all' && it.ty !== type) return false;
    if (win && (it.t < win.from || it.t > win.to)) return false;
    return true;
  });
  const bySortOption = (a, b) => {
    if (sort === 'Oldest') return a.t - b.t;
    if (sort === 'Largest Qty') return Math.abs(b.qty || 0) - Math.abs(a.qty || 0);
    if (sort === 'Highest Revenue' || sort === 'Highest Amount' || sort === 'Highest Profit') return (b.amount || 0) - (a.amount || 0);
    return b.t - a.t;
  };
  // Universal Search review: an active query ranks exact-match-first (rankIndexed),
  // falling back to the user's chosen sort as a tie-break — previously a search stayed
  // in whatever sort was picked (usually Newest) regardless of relevance, so typing an
  // exact invoice/SKU number didn't surface it above a merely-recent unrelated row. With
  // no query, the user's explicit sort choice is applied exactly as before, untouched.
  arr = [...arr].sort(needle
    ? (a, b) => rankIndexed(entryOf(b), needle) - rankIndexed(entryOf(a), needle) || bySortOption(a, b)
    : bySortOption);
  return arr;
}

// Issue 7.7 — one shared record-detail drawer. `detail` is either a flat
// { detail: {label:value} } record or a { title, sections:[{title, rows:[[k,v]]}] }
// grouped one (used for richer stock-movement detail). Only fields actually present
// on the record are ever rendered — nothing invented.
export function LedgerDetailDrawer({ title, icon, detail, onClose }) {
  const { t } = useTranslation();
  const Icon = icon;
  const bodyRef = useRef(null);
  const prevFocusRef = useRef(null);
  useEffect(() => {
    if (!detail) return undefined;
    prevFocusRef.current = typeof document !== 'undefined' ? document.activeElement : null;
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    const t = lockBody();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { unlockBody(t); document.removeEventListener('keydown', onKey); prevFocusRef.current?.focus?.(); };
  }, [detail, onClose]);
  if (!detail || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="ledger-detail-title" className="w-full sm:max-w-[800px] max-h-[88vh] flex flex-col rounded-t-2xl sm:rounded-2xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)', animation: 'ledger-detail-in 170ms ease-out' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-4" style={{ background: 'var(--surface-1)', borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
          <h3 id="ledger-detail-title" className="text-base font-bold text-white flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(212,175,55,0.12)' }}>{Icon ? <Icon size={16} className="text-[#d4af37]" /> : null}</span>
            <span className="truncate">{title} {t('ledger.detail', 'detail')}{(() => { const ref = detail.detail?.Invoice || detail.detail?.Reference; return ref && ref !== '—' ? <span className="text-white/45 font-normal"> · {ref}</span> : null; })()}</span>
          </h3>
          <button onClick={onClose} aria-label={t('common.close', 'Close') + ' dialog'} className="w-10 h-10 -mr-1.5 rounded-xl flex items-center justify-center text-white/50 hover:bg-white/10 hover:text-white transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]/60"><X size={18} /></button>
        </div>
        <div ref={bodyRef} className="flex-1 overflow-y-auto ledger-detail-scroll px-6 py-4 pb-8">
          {detail.sections ? (
            <div className="space-y-5">
              {detail.sections.map((sec) => (
                <div key={sec.title}>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#d4af37]/70 mb-1.5">{sec.title}</p>
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                    {sec.rows.map(([k, node], ri) => (
                      <div key={k} className="grid grid-cols-[130px_1fr] gap-4 px-3.5 py-2.5 text-sm items-center" style={ri < sec.rows.length - 1 ? { borderBottom: '1px solid rgba(var(--fg-rgb),0.05)' } : undefined}>
                        <span className="text-white/45 flex-shrink-0">{k}</span>
                        <span className="text-white/90 text-right font-medium break-words">{node}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            Object.entries(detail.detail).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-2.5 text-sm" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.05)' }}>
                <span className="text-white/45 flex-shrink-0">{k}</span>
                <span className="text-white/90 text-right font-medium break-words">{String(v ?? '—')}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Reusable ledger page: search + date range + type filter + sort + pagination
// (10/25/50/100 per page) + CSV export of the filtered set + a detail drawer.
// Items are pre-normalized: { id, t(ms), s(searchText), ty(type), qty, amount, row, detail }.
export default function LedgerPage({ title, icon, cards, items, typeOptions, sortOptions, csvName, csvHeader, demoMode = false, demoCanExport = true, onProtectedAction }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [range, setRange] = useState('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [type, setType] = useState('all');
  const [sort, setSort] = useState((sortOptions && sortOptions[0]) || 'Newest');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);
  const [perPage, setPerPage] = useState(25);
  const PER = perPage;
  const Icon = icon;
  // ISSUE 3/7: the ledgers hold the largest lists in the app (the Sales / Services /
  // Stock ledgers run to thousands of rows). The typed character renders immediately —
  // `q` stays fully controlled — while the filter+sort lags 150ms behind it.
  const [dq] = useDeferredSearch(q);
  useEffect(() => { setPage(1); }, [dq, range, type, sort, perPage, customStart, customEnd]);
  const filtered = useMemo(
    () => filterLedgerItems(items, { q: dq, type, range, sort, customStart, customEnd }),
    [items, dq, range, type, sort, customStart, customEnd]
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PER));
  const shown = filtered.slice((page - 1) * PER, page * PER);
  // Was CSV. The Sales and Services ledgers carry a Date column plus a dozen money
  // columns — exactly the sheet an owner opens to total revenue and sort by date. As
  // CSV the dates rendered ######## and the money arrived as text, so =SUM() gave 0.
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    if (demoMode && !demoCanExport) { onProtectedAction?.(); return; }
    if (exporting) return;
    if (filtered.length === 0) { toast.error(t('ledger.nothingToExport', 'Nothing to export with the current filters.')); return; }
    setExporting(true);
    try {
      const detailRows = filtered.map((it) => it.detail);
      const head = csvHeader || Object.keys(detailRows[0]);
      const dateCols = head.reduce((acc, h, i) => (/date/i.test(h) ? [...acc, i] : acc), []);
      const rows = detailRows.map((r) => head.map((h, i) => (dateCols.includes(i) ? asDate(r[h]) : r[h] ?? '')));
      await writeSheet({ filename: `${csvName}_${stamp()}.xlsx`, sheetName: String(csvName).slice(0, 28), head, rows, dateCols });
      notify.exported(`Exported ${filtered.length} rows.`);
    } catch (e) {
      toast.error('Export failed.');
    } finally {
      setExporting(false);
    }
  };
  const fld = 'px-2.5 py-2 rounded-lg text-xs outline-none bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60';
  return (
    <PageHeader title={title} icon={icon} action={<button onClick={exportCsv} disabled={exporting} aria-busy={exporting} className="disabled:opacity-50 disabled:cursor-wait flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#d4af37] bg-[#d4af37]/10 border border-[#d4af37]/30 hover:bg-[#d4af37]/20"><Download size={14} /> {t('common.export', 'Export')}</button>}>
      {cards && <StatStrip cards={cards} />}
      <div className="flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.search', 'Search') + '…'} className={`${fld} flex-1 min-w-[140px]`} />
        <select value={range} onChange={(e) => setRange(e.target.value)} className={fld}>
          <option value="all" className="bg-[#111]">{t('ledger.range.allTime', 'All time')}</option>
          <option value="today" className="bg-[#111]">{t('billing.filter.today', 'Today')}</option>
          <option value="yesterday" className="bg-[#111]">{t('ledger.range.yesterday', 'Yesterday')}</option>
          <option value="thisweek" className="bg-[#111]">{t('billing.filter.thisWeek', 'This week')}</option>
          <option value="thismonth" className="bg-[#111]">{t('billing.filter.thisMonth', 'This month')}</option>
          <option value="7d" className="bg-[#111]">{t('ledger.range.last7Days', 'Last 7 days')}</option>
          <option value="30d" className="bg-[#111]">{t('ledger.range.last30Days', 'Last 30 days')}</option>
          <option value="custom" className="bg-[#111]">{t('ledger.range.customRange', 'Custom range…')}</option>
        </select>
        {range === 'custom' && (
          <>
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} max={customEnd || undefined} className={fld} aria-label="From date" />
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} min={customStart || undefined} max={new Date().toISOString().slice(0, 10)} className={fld} aria-label="To date" />
          </>
        )}
        {typeOptions && (
          <select value={type} onChange={(e) => setType(e.target.value)} className={fld}>
            <option value="all" className="bg-[#111]">{t('ledger.allTypes', 'All types')}</option>
            {typeOptions.map((ty) => <option key={ty} value={ty} className="bg-[#111]">{ty}</option>)}
          </select>
        )}
        {sortOptions && (
          <select value={sort} onChange={(e) => setSort(e.target.value)} className={fld}>
            {sortOptions.map((s) => <option key={s} value={s} className="bg-[#111]">{s}</option>)}
          </select>
        )}
      </div>
      {filtered.length === 0 ? (
        // Issue 8 (cross-module review) — this one shared component backs four modules
        // (Sales/Services/Stock In/Stock Out); its empty state was the only text-only one
        // in the app, unlike Customers/Vehicles/Inventory Parts/Reminders. `Icon` (the
        // module's own nav icon) was already threaded through as a prop, just unused here.
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          {Icon && <Icon size={26} className="text-white/20" />}
          <p className="text-sm text-white/45">{t('ledger.empty.noMatch', 'No records match your filters.')}</p>
        </div>
      ) : (
        <>
          <p className="text-[11px] text-white/45">{t('dynamic.showingOfTotal', `Showing ${shown.length} of ${filtered.length}`, { n: shown.length, total: filtered.length })}</p>
          <div className="space-y-1.5">
            {shown.map((it) => <button key={it.id} onClick={() => setDetail(it)} className="w-full text-left">{it.row}</button>)}
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-3">
            <div className="flex items-center gap-2 text-xs text-white/45">
              <span>{t('ledger.rows', 'Rows')}:</span>
              <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))} className="bg-white/5 border border-white/15 rounded-lg px-2 py-1 text-white/80 focus:outline-none focus:border-[#d4af37]/50">
                {[10, 25, 50, 100].map((n) => <option key={n} value={n} style={{ background: 'var(--surface-2)' }}>{n}</option>)}
              </select>
              <span className="ml-1">{t('dynamic.showingRange', `${filtered.length === 0 ? 0 : (page - 1) * PER + 1}–${Math.min(page * PER, filtered.length)} of ${filtered.length}`, { from: filtered.length === 0 ? 0 : (page - 1) * PER + 1, to: Math.min(page * PER, filtered.length), total: filtered.length, entity: '' })}</span>
            </div>
            {pages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-white/70 disabled:opacity-30">{t('common.previous', 'Previous')}</button>
                <span className="text-xs text-white/50">{t('common.page', 'Page')} {page} / {pages}</span>
                <button disabled={page === pages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-white/70 disabled:opacity-30">{t('common.next', 'Next')}</button>
              </div>
            )}
          </div>
        </>
      )}
      {/* Portaled to document.body: escapes <main>'s stacking context so this never
          renders clipped/underneath the sticky app header. See LedgerDetailDrawer. */}
      <LedgerDetailDrawer title={title} icon={icon} detail={detail} onClose={() => setDetail(null)} />
    </PageHeader>
  );
}
