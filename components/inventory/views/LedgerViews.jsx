/**
 * components/inventory/views/LedgerViews.jsx
 *
 * Refactor Phase 3 — view extraction. The four thin ledger views that were
 * file-local components inside InventoryDashboard.js: SalesView, ServicesView,
 * StockInView and StockOutView. Each is a purely presentational wrapper over the
 * shared LedgerPage component (KPI cards + a searchable/sortable/exportable list
 * + a record-detail drawer) reading only its props — the sales / restocks /
 * stockAdjustments arrays the container passes down.
 *
 * Moved verbatim: KPI aggregation, row/section builders, the CSV detail object,
 * the CapacityBanner wiring and every className/label are unchanged. No Firestore,
 * no demoMode-from-context (it arrives as a prop), no navigation, no transaction
 * or idempotency code — the container still owns all of that.
 */
import React, { useMemo } from 'react';
import { TrendingUp, Wrench, ShoppingCart, PackagePlus, Send } from 'lucide-react';
import { useTranslation } from '../../../lib/i18n';
import { tsToDate, isSameDay } from '../../../lib/format';
import { SEMANTIC } from '../../../constants/ui';
import LedgerPage, { LedgerRow, dstr } from '../../common/LedgerPage';
import CapacityBanner from '../../common/CapacityBanner';

// Money formatter — verbatim copy of InventoryDashboard.js's module-local `inr`
// (rounds before grouping, unlike lib/format's formatINR which keeps the paise).
const inr = (n) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

export function SalesView({ sales, demoMode, demoCanExport = true, onProtectedAction, actorEmail, onCleanupComplete }) {
  const { t } = useTranslation();
  const catOf = (s) => s.revenueType || s.category || (s.partId ? 'Parts' : 'Service');
  // SALES = inventory parts only (spec). Labour/services live in the Services tab.
  const partSales = useMemo(() => sales.filter((s) => catOf(s) === 'Parts' || catOf(s) === 'Outside Purchase'), [sales]);
  const cards = useMemo(() => {
    const now = new Date();
    let revT = 0, proT = 0, revM = 0, proM = 0, partsM = 0, outsideM = 0, unitsM = 0;
    partSales.forEach((s) => {
      const d = tsToDate(s.createdAt); if (!d) return;
      const rev = s.revenue || 0; const cat = catOf(s);
      if (isSameDay(d, now)) { revT += rev; proT += s.profit || 0; }
      if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
        revM += rev; proM += s.profit || 0; unitsM += s.qty || 0;
        if (cat === 'Parts') partsM += rev; else outsideM += rev;
      }
    });
    const avgMargin = revM > 0 ? (proM / revM) * 100 : 0;
    // COLOR SYSTEM REVIEW: Revenue cards (both time scopes) stay gold, matching Billing's
    // own Revenue Today/Month; Profit stays green, matching Billing's Profit Today/Month
    // (same word, same meaning, same color everywhere). Outside Purchase/Avg Margin/
    // Units Sold are plain magnitudes with no status meaning — were amber/cyan/violet
    // with no semantic reason, now neutral.
    return [
      { label: t('sales.kpi.partsRevenueMonth', 'Parts Revenue (Month)'), value: inr(partsM), icon: TrendingUp, color: SEMANTIC.gold },
      { label: t('sales.kpi.outsidePurchaseMonth', 'Outside Purchase (Month)'), value: inr(outsideM), color: SEMANTIC.muted },
      { label: t('sales.kpi.partsProfitMonth', 'Parts Profit (Month)'), value: inr(proM), color: SEMANTIC.ok },
      { label: t('sales.kpi.avgMargin', 'Avg Margin'), value: `${avgMargin.toFixed(1)}%`, color: SEMANTIC.muted },
      { label: t('sales.kpi.unitsSoldMonth', 'Units Sold (Month)'), value: unitsM.toLocaleString('en-IN'), color: SEMANTIC.muted },
      { label: t('sales.kpi.revenueToday', 'Revenue Today'), value: inr(revT), color: SEMANTIC.gold },
    ];
  }, [partSales, t]);
  const catColor = (c) => ({ Parts: '#60a5fa', 'Outside Purchase': '#fbbf24' }[c] || '#9ca3af');
  const items = useMemo(() => partSales.map((s) => {
    const d = tsToDate(s.createdAt);
    const cat = catOf(s);
    const marginVal = s.margin != null ? s.margin : (s.revenue > 0 ? (s.profit / s.revenue) * 100 : 0);
    const profit = s.profit || 0;
    const outstanding = s.outstanding != null ? s.outstanding : null;
    const txt = (v) => <span className="text-white/90">{v}</span>;
    const muted = (v) => <span className="text-white/45">{v}</span>;
    const num = (v) => <span className="text-white/90 tabular-nums">{v}</span>;
    const profitNode = <span className="tabular-nums font-semibold" style={{ color: profit > 0 ? '#34d399' : profit < 0 ? '#f87171' : 'inherit' }}>{inr(profit)}</span>;
    const marginChip = <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full tabular-nums" style={{ background: marginVal >= 0 ? 'rgba(52,211,153,0.14)' : 'rgba(248,113,113,0.14)', color: marginVal >= 0 ? '#34d399' : '#f87171' }}>{marginVal.toFixed(1)}%</span>;
    // Row badge: show the real inventory category (Engine/Filters/etc.) when the record
    // carries one that adds information. Suppress it when it would just echo the coarse
    // ledger type ("Parts"/"Outside Purchase"), which is redundant inside this module.
    const fineCat = (s.category || '').trim();
    const badgeCat = fineCat && fineCat !== cat && fineCat !== 'Parts' && fineCat !== 'Outside Purchase' ? fineCat : null;
    const sections = [
      { title: 'Basic Information', rows: [
        ['Category', txt(cat)], ['Part', txt(s.name)], ['SKU', s.sku ? txt(s.sku) : muted('Not Recorded')],
        ['Invoice', s.invoiceNo ? txt(s.invoiceNo) : muted('Walk-in / No Invoice')],
        ['Customer', s.customer ? txt(s.customer) : muted('Not Recorded')],
        ['Vehicle', s.vehicle ? txt(`${s.vehicle}${s.regNo ? ` (${s.regNo})` : ''}`) : muted('Not Recorded')],
      ] },
      { title: 'Pricing', rows: [
        ['Quantity', num(s.qty)],
        ['Catalogue Price', s.listPrice ? num(inr(s.listPrice)) : muted('Not Set')],
        ['Sold Price', num(inr(s.unitPrice))],
        ['Discount', s.discount ? num(`${s.discount}%`) : muted('None')],
        ['Extra Charged', s.extraRevenue ? num(`${s.extraRevenue > 0 ? '+' : ''}${inr(s.extraRevenue)}`) : muted('None')],
      ] },
      { title: 'Financial', rows: [
        ['Cost Price', num(inr(s.unitCost || 0))],
        ['Revenue', num(inr(s.revenue))],
        ['Profit', profitNode],
        ['Margin', marginChip],
      ] },
      { title: 'Payment', rows: [
        ['GST', s.gst ? num(`${s.gst}%`) : muted('Not Applicable')],
        ['Payment', s.payModes ? txt(s.payModes) : muted('Pending')],
        ['Outstanding', outstanding == null ? muted('—') : outstanding > 0 ? <span className="tabular-nums text-red-400">{inr(outstanding)}</span> : <span className="tabular-nums text-emerald-400">{inr(0)} (Paid)</span>],
      ] },
      { title: 'Workshop', rows: [
        ['Technician', s.technician ? txt(s.technician) : muted('Not Assigned')],
        ['Date', txt(dstr(s.createdAt))],
      ] },
    ];
    return {
      id: s.id, t: d?.getTime() || 0,
      // GLOBAL SEARCH ACCURACY: SKU (Part Number) and Invoice No. moved out of the
      // partial-searched `s` string into `ids` — matched by EXACT value only (see
      // LedgerPage's filter). Name/category/customer/vehicle/email stay partial-searchable.
      s: `${s.name} ${cat} ${s.customer || ''} ${s.vehicle || ''} ${s.soldByEmail || ''}`,
      ids: [s.sku, s.invoiceNo],
      ty: cat, qty: s.qty, amount: s.revenue || 0,
      row: <LedgerRow left={<span className="flex items-center gap-2">{s.name}{s.sku ? <span className="text-[9px] text-white/45">{s.sku}</span> : null}{badgeCat ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${catColor(cat)}1f`, color: catColor(cat) }}>{badgeCat}</span> : null}</span>} sub={`${dstr(s.createdAt)}${s.invoiceNo ? ` \u00b7 ${s.invoiceNo}` : ''}${s.customer ? ` \u00b7 ${s.customer}` : ''}`} mid={`${s.qty} \u00d7 ${inr(s.unitPrice)}`} right={<span className="text-emerald-400">{inr(s.revenue)}</span>} />,
      sections,
      detail: {
        Category: cat, Part: s.name, SKU: s.sku || '\u2014', Invoice: s.invoiceNo || '\u2014',
        Customer: s.customer || '\u2014', Vehicle: s.vehicle ? `${s.vehicle}${s.regNo ? ` (${s.regNo})` : ''}` : '\u2014',
        Quantity: s.qty,
        'Catalogue Price': s.listPrice ? inr(s.listPrice) : '\u2014',
        'Sold Price': inr(s.unitPrice),
        'Extra Charged': s.extraRevenue ? `${s.extraRevenue > 0 ? '+' : ''}${inr(s.extraRevenue)}` : '\u2014',
        'Cost Price': inr(s.unitCost || 0),
        Revenue: inr(s.revenue), Profit: inr(s.profit),
        Margin: `${marginVal.toFixed(1)}%`,
        GST: s.gst ? `${s.gst}%` : '\u2014', Discount: s.discount ? `${s.discount}%` : '\u2014',
        Payment: s.payModes || '\u2014', Outstanding: s.outstanding != null ? inr(s.outstanding) : '\u2014',
        Technician: s.technician || '\u2014', Date: dstr(s.createdAt),
      },
    };
  }), [partSales]);
  return (
    <>
      {/* Sales and Services are two filtered views of the SAME `sales` ledger
          collection, so they share ONE capacity banner (not two independent counts
          of the same underlying data — see ServicesView below, which renders the
          identical banner). No create-time guard here: a `sales` row is never created
          by a direct user action, only as a side effect of billing an invoice — that
          action already has its own guard (see BillingModule's New Invoice button). */}
      <CapacityBanner moduleKey="sales" demoMode={demoMode} actorEmail={actorEmail} refreshKey={sales.length} className="mb-4" onCleanupComplete={onCleanupComplete} />
      <LedgerPage title={t('page.sales', 'Parts Sales')} icon={ShoppingCart} cards={cards} items={items}
        typeOptions={['Parts', 'Outside Purchase']}
        sortOptions={['Newest', 'Oldest', 'Highest Revenue', 'Highest Profit']}
        csvName="Parts-Sales"
        csvHeader={['Category', 'Part', 'SKU', 'Invoice', 'Customer', 'Vehicle', 'Quantity', 'Catalogue Price', 'Sold Price', 'Extra Charged', 'Cost Price', 'Revenue', 'Profit', 'Margin', 'GST', 'Discount', 'Payment', 'Outstanding', 'Technician', 'Date']}
        demoMode={demoMode} demoCanExport={demoCanExport} onProtectedAction={onProtectedAction} />
    </>
  );
}

export function ServicesView({ sales, demoMode, demoCanExport = true, onProtectedAction, actorEmail, onCleanupComplete }) {
  const { t } = useTranslation();
  const catOf = (s) => s.revenueType || s.category || (s.partId ? 'Parts' : 'Service');
  // SERVICES = labour / service revenue only. No inventory, no COGS.
  const svc = useMemo(() => sales.filter((s) => catOf(s) === 'Service' || catOf(s) === 'Labour'), [sales]);
  const cards = useMemo(() => {
    const now = new Date();
    let revT = 0, revM = 0, labourM = 0, serviceM = 0, jobsM = 0;
    const techSet = new Set();
    svc.forEach((s) => {
      const d = tsToDate(s.createdAt); if (!d) return;
      const rev = s.revenue || 0; const cat = catOf(s);
      if (isSameDay(d, now)) { revT += rev; }
      if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
        revM += rev; jobsM += 1; if (s.technician) techSet.add(s.technician);
        if (cat === 'Labour') labourM += rev; else serviceM += rev;
      }
    });
    // COLOR SYSTEM REVIEW: Service/Labour Revenue are the two BREAKDOWN components that
    // sum to Total Service Income — neutral, like Billing's own Parts/Labour Revenue
    // breakdown cards, so the one real aggregate (Total Service Income) doesn't have to
    // compete with its own components for gold. Revenue Today was blue here but gold in
    // Billing/Sales for the identical label — fixed to match (same word, same color
    // everywhere). Jobs/Technicians are plain counts, not statuses — neutral.
    return [
      { label: t('services.kpi.serviceRevenueMonth', 'Service Revenue (Month)'), value: inr(serviceM), icon: Wrench, color: SEMANTIC.muted },
      { label: t('services.kpi.labourRevenueMonth', 'Labour Revenue (Month)'), value: inr(labourM), color: SEMANTIC.muted },
      { label: t('services.kpi.totalServiceIncome', 'Total Service Income'), value: inr(revM), color: SEMANTIC.gold },
      { label: t('services.kpi.jobsMonth', 'Jobs (Month)'), value: jobsM.toLocaleString('en-IN'), color: SEMANTIC.muted },
      { label: t('services.kpi.techniciansActive', 'Technicians Active'), value: String(techSet.size), color: SEMANTIC.muted },
      { label: t('sales.kpi.revenueToday', 'Revenue Today'), value: inr(revT), color: SEMANTIC.gold },
    ];
  }, [svc, t]);
  const items = useMemo(() => svc.map((s) => {
    const d = tsToDate(s.createdAt);
    const cat = catOf(s);
    const hoursVal = s.hours || s.qty || 1;
    const hoursLabel = `${hoursVal} ${hoursVal === 1 ? 'hr' : 'hrs'}`;
    const profit = s.profit || 0;
    const collected = !(s.outstanding > 0);
    const txt = (v) => <span className="text-white/90">{v}</span>;
    const muted = (v) => <span className="text-white/45">{v}</span>;
    const num = (v) => <span className="text-white/90 tabular-nums">{v}</span>;
    const profitNode = <span className="tabular-nums font-semibold" style={{ color: profit > 0 ? '#34d399' : profit < 0 ? '#f87171' : 'inherit' }}>{inr(profit)}</span>;
    const statusBadge = <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: collected ? 'rgba(52,211,153,0.14)' : 'rgba(248,113,113,0.14)', color: collected ? '#34d399' : '#f87171' }}>{collected ? 'Collected' : 'Outstanding'}</span>;
    const sections = [
      { title: 'Basic Information', rows: [
        ['Category', txt(cat)], ['Service', txt(s.name)],
        ['Invoice', s.invoiceNo ? txt(s.invoiceNo) : muted('Walk-in / No Invoice')],
        ['Customer', s.customer ? txt(s.customer) : muted('Not Recorded')],
        ['Vehicle', s.vehicle ? txt(`${s.vehicle}${s.regNo ? ` (${s.regNo})` : ''}`) : muted('Not Recorded')],
      ] },
      { title: 'Workshop', rows: [
        ['Technician', s.technician ? txt(s.technician) : muted('Not Assigned')],
        ['Hours', num(hoursLabel)],
        ['Date', txt(dstr(s.createdAt))],
      ] },
      { title: 'Pricing', rows: [
        ['Rate', num(inr(s.unitPrice))],
        ['Discount', s.discount ? num(`${s.discount}%`) : muted('None')],
      ] },
      { title: 'Financial', rows: [
        ['Revenue', num(inr(s.revenue))],
        ['Profit', profitNode],
      ] },
      { title: 'Payment', rows: [
        ['GST', s.gst ? num(`${s.gst}%`) : muted('Not Applicable')],
        ['Payment', s.payModes ? txt(s.payModes) : muted(collected ? 'Collected' : 'Pending')],
        ['Status', statusBadge],
      ] },
    ];
    return {
      id: s.id, t: d?.getTime() || 0,
      // GLOBAL SEARCH ACCURACY: Invoice No. moved out of the partial-searched `s` string
      // into `ids` — matched by EXACT value only (see LedgerPage's filter). Name/category/
      // technician/customer/vehicle stay partial-searchable.
      s: `${s.name} ${cat} ${s.technician || ''} ${s.customer || ''} ${s.vehicle || ''}`,
      ids: [s.invoiceNo],
      ty: cat, qty: s.qty, amount: s.revenue || 0,
      row: <LedgerRow left={<span className="flex items-center gap-2">{s.name}</span>} sub={`${dstr(s.createdAt)}${s.invoiceNo ? ` \u00b7 ${s.invoiceNo}` : ''}${s.customer ? ` \u00b7 ${s.customer}` : ''}${s.technician ? ` \u00b7 ${s.technician}` : ''}`} mid={`${s.hours || s.qty || 1} \u00d7 ${inr(s.unitPrice)}`} right={<span className="text-emerald-400">{inr(s.revenue)}</span>} />,
      sections,
      detail: {
        Category: cat, Service: s.name, Invoice: s.invoiceNo || '\u2014', Customer: s.customer || '\u2014',
        Vehicle: s.vehicle ? `${s.vehicle}${s.regNo ? ` (${s.regNo})` : ''}` : '\u2014', Technician: s.technician || '\u2014',
        Hours: s.hours || s.qty || 1, Rate: inr(s.unitPrice), Discount: s.discount ? `${s.discount}%` : '\u2014',
        GST: s.gst ? `${s.gst}%` : '\u2014', 'Service Revenue': inr(s.revenue), Profit: inr(s.profit),
        Payment: s.payModes || '\u2014', Status: s.outstanding > 0 ? 'Outstanding' : 'Collected', Date: dstr(s.createdAt),
      },
    };
  }), [svc]);
  return (
    <>
      <CapacityBanner moduleKey="sales" demoMode={demoMode} actorEmail={actorEmail} refreshKey={sales.length} className="mb-4" onCleanupComplete={onCleanupComplete} />
      <LedgerPage title={t('page.services', 'Service & Labour Income')} icon={Wrench} cards={cards} items={items}
        typeOptions={['Service', 'Labour']}
        sortOptions={['Newest', 'Oldest', 'Highest Revenue']}
        csvName="Service-Revenue"
        csvHeader={['Category', 'Service', 'Invoice', 'Customer', 'Vehicle', 'Technician', 'Hours', 'Rate', 'Discount', 'GST', 'Service Revenue', 'Profit', 'Payment', 'Status', 'Date']}
        demoMode={demoMode} demoCanExport={demoCanExport} onProtectedAction={onProtectedAction} />
    </>
  );
}

export function StockInView({ restocks, demoMode, demoCanExport = true, onProtectedAction, actorEmail, capacityRefreshTick = 0, onCleanupComplete }) {
  const { t } = useTranslation();
  const cards = useMemo(() => {
    const now = new Date();
    let receiptsT = 0, unitsT = 0, costT = 0;
    restocks.forEach((r) => { const d = tsToDate(r.createdAt); if (isSameDay(d, now)) { receiptsT += 1; unitsT += r.qty || 0; costT += (r.unitCost || 0) * (r.qty || 0); } });
    return [
      { label: t('stockIn.kpi.receiptsToday', 'Receipts Today'), value: receiptsT, icon: PackagePlus },
      { label: t('stockIn.kpi.unitsReceived', 'Units Received'), value: unitsT, color: '#d4af37' },
      { label: t('stockIn.kpi.purchaseCost', 'Purchase Cost'), value: inr(costT) },
      { label: t('stockIn.kpi.totalReceipts', 'Total Receipts'), value: restocks.length },
    ];
  }, [restocks, t]);
  const items = useMemo(() => restocks.map((r) => {
    // Sort/aging stays anchored to createdAt (system truth — when this was
    // actually entered); the DISPLAYED date prefers the business-meaningful
    // purchaseDate the user recorded (paperwork often lags physical receipt),
    // falling back to createdAt for older records that predate this field.
    const d = tsToDate(r.createdAt);
    const displayDate = r.purchaseDate || r.createdAt;
    return {
      id: r.id, t: d?.getTime() || 0, s: `${r.name || r.partName} ${r.supplierName || ''}`, ty: 'Receipt', qty: r.qty, amount: (r.unitCost || 0) * (r.qty || 0),
      // Universal Search review: SKU/reference/PO number are exact-then-partial
      // identifiers (matched via rankIndexed inside filterLedgerItems), not folded into
      // the free-text `s` string above — same fields InventoryStock.jsx's merged
      // timeline already isolates correctly for this identical restocks data; this view
      // had silently regressed to the pre-fix flat-string pattern.
      ids: [r.sku, r.reference, r.poNumber],
      row: <LedgerRow left={r.name || r.partName} sub={`${dstr(displayDate)} · ${r.supplierName || '—'}${r.reference ? ` · Ref ${r.reference}` : ''}`} mid={r.unitCost ? `@ ${inr(r.unitCost)}` : ''} right={<span className="text-[#d4af37]">+{r.qty}</span>} />,
      detail: { Part: r.name || r.partName, Supplier: r.supplierName || '—', Quantity: r.qty, 'Unit Cost': r.unitCost ? inr(r.unitCost) : '—', Invoice: r.reference || '—', 'Received By': r.byEmail || '—', Date: dstr(displayDate), ...(r.notes ? { Notes: r.notes } : {}) },
    };
  }), [restocks]);
  return (
    <>
      <CapacityBanner moduleKey="restocks" demoMode={demoMode} actorEmail={actorEmail} refreshKey={`${restocks.length}-${capacityRefreshTick}`} className="mb-4" onCleanupComplete={onCleanupComplete} />
      <LedgerPage title={t('page.stockIn', 'Stock In — Goods Received')} icon={PackagePlus} cards={cards} items={items} sortOptions={['Newest', 'Oldest', 'Largest Qty']} csvName="StockIn" csvHeader={['Part', 'Supplier', 'Quantity', 'Unit Cost', 'Reference', 'Received By', 'Date']} demoMode={demoMode} demoCanExport={demoCanExport} onProtectedAction={onProtectedAction} />
    </>
  );
}
export function StockOutView({ sales, stockAdjustments, demoMode, demoCanExport = true, onProtectedAction, actorEmail, capacityRefreshTick = 0, onCleanupComplete }) {
  const { t } = useTranslation();
  const cards = useMemo(() => {
    const count = (reason) => stockAdjustments.filter((a) => (a.reason || '') === reason).reduce((s, a) => {
      const d = (a.stockAfter != null && a.stockBefore != null) ? (a.stockAfter - a.stockBefore) : (a.qty || 0);
      return s + (d < 0 ? Math.abs(d) : 0);
    }, 0);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();
    const todayOut = sales.filter((s) => (tsToDate(s.createdAt)?.getTime() || 0) >= todayMs).reduce((s, x) => s + (x.qty || 0), 0)
      + stockAdjustments.filter((a) => { const d = (a.stockAfter != null && a.stockBefore != null) ? (a.stockAfter - a.stockBefore) : (a.qty || 0); return d < 0 && (tsToDate(a.createdAt)?.getTime() || 0) >= todayMs; }).reduce((s, a) => { const d = (a.stockAfter - a.stockBefore) || -(a.qty || 0); return s + Math.abs(d); }, 0);
    return [
      { label: t('stockOut.kpi.todaysStockOut', "Today's Stock Out"), value: todayOut, icon: Send, color: '#d4af37' },
      { label: t('stockOut.kpi.customerSalesUnits', 'Customer Sales (units)'), value: sales.filter((x) => !!x.partId && (x.revenueType || x.category || 'Parts') === 'Parts').reduce((s, x) => s + (x.qty || 0), 0), icon: ShoppingCart, color: '#34d399' },
      { label: t('stockOut.kpi.damaged', 'Damaged'), value: count('Damage'), color: '#ef4444' },
      { label: t('stockOut.kpi.lostTheft', 'Lost / Theft'), value: count('Lost Item') + count('Theft'), color: '#ef4444' },
      { label: t('stockOut.kpi.returns', 'Returns'), value: count('Supplier Return') + count('Branch Transfer'), color: '#60a5fa' },
    ];
  }, [sales, stockAdjustments, t]);
  const reasonColor = (r) => r === 'Sale' ? '#34d399' : r === 'Damage' || r === 'Lost Item' ? '#ef4444' : '#d4af37';
  const items = useMemo(() => {
    // Stock Out reflects PHYSICAL stock leaving the shelf. Only inventory-linked
    // parts qualify — labour, services and outside purchases never touch stock, so
    // they must not appear here (they'd otherwise show as phantom reductions).
    const isStockMoving = (s) => {
      const cat = s.revenueType || s.category || (s.partId ? 'Parts' : 'Service');
      return !!s.partId && cat === 'Parts';
    };
    const arr = sales.filter(isStockMoving).map((s) => ({ id: 's' + s.id, name: s.name, when: s.createdAt, qty: -(s.qty || 0), reason: 'Sale', by: s.soldByEmail, notes: [s.invoiceNo, s.customer, s.vehicle].filter(Boolean).join(' · '), sku: s.sku, invoiceNo: s.invoiceNo }))
      .concat(stockAdjustments.filter((a) => {
        const d = (a.stockAfter != null && a.stockBefore != null) ? (a.stockAfter - a.stockBefore) : (a.qty || 0);
        return d < 0;
      }).map((a) => {
        const d = (a.stockAfter != null && a.stockBefore != null) ? (a.stockAfter - a.stockBefore) : (a.qty || 0);
        return { id: 'a' + a.id, name: a.name, when: a.createdAt, qty: d, reason: a.reason || 'Adjustment', by: a.byEmail, notes: a.notes || '', sku: a.sku };
      }));
    return arr.map((o) => {
      const dt = tsToDate(o.when);
      return {
        id: o.id, t: dt?.getTime() || 0, s: `${o.name} ${o.reason} ${o.by || ''}`, ty: o.reason, qty: o.qty, amount: Math.abs(o.qty),
        // Universal Search review: SKU/invoice no. are exact-then-partial identifiers —
        // previously folded into `notes` only (sales) or not searchable at all
        // (adjustments), unlike the sibling Sales/Services views in this same file
        // which already isolate these correctly for the identical underlying records.
        ids: [o.sku, o.invoiceNo],
        row: <LedgerRow left={<span className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full" style={{ background: reasonColor(o.reason) }} />{o.name}</span>} sub={`${dstr(o.when)} · ${o.reason}${o.by ? ` · ${o.by}` : ''}`} right={<span style={{ color: reasonColor(o.reason) }}>{o.qty}</span>} />,
        detail: { Part: o.name, Reason: o.reason, Quantity: o.qty, 'Recorded By': o.by || '—', Notes: o.notes || '—', Date: dstr(o.when) },
      };
    });
  }, [sales, stockAdjustments]);
  return (
    <>
      {/* Stock Out is a computed MERGE of the sales ledger (part sales) and
          stockAdjustments (damage/loss/etc.) — there's no single "stockOut" collection
          to check capacity against. The adjustments half has its own direct "Adjust
          Stock" creation action (guarded in adjustStockLine above), so that's the
          capacity signal shown here; the sale-driven half is governed by the
          Sales/Services ledger banner instead (see SalesView/ServicesView). */}
      <CapacityBanner moduleKey="stockAdjustments" demoMode={demoMode} actorEmail={actorEmail} refreshKey={`${stockAdjustments.length}-${capacityRefreshTick}`} className="mb-4" onCleanupComplete={onCleanupComplete} />
      <LedgerPage title={t('page.stockOut', 'Stock Out — Sales & Reductions')} icon={Send} cards={cards} items={items} typeOptions={['Sale', 'Job Card Usage', 'Internal Workshop Usage', 'Damage', 'Lost Item', 'Theft', 'Expired', 'Personal Use', 'Supplier Return', 'Branch Transfer', 'Adjustment', 'Correction', 'Audit Adjustment']} sortOptions={['Newest', 'Oldest', 'Largest Qty']} csvName="StockOut" csvHeader={['Part', 'Reason', 'Quantity', 'Recorded By', 'Notes', 'Date']} demoMode={demoMode} demoCanExport={demoCanExport} onProtectedAction={onProtectedAction} />
    </>
  );
}
