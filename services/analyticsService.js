// services/analyticsService.js
// Pure, UI-free business logic extracted from the InventoryDashboard monolith
// as the first step of an incremental (behaviour-preserving) refactor toward a
// services/ + hooks/ + features/ structure. Everything here is a pure function:
// no React, no state, no Firestore — trivially testable in isolation.

// --- internal helpers (self-contained so this module has no coupling) ---
const safeLower = (val) => (val || '').toString().toLowerCase();
const tsToDate = (ts) => {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  if (ts.seconds) return new Date(ts.seconds * 1000);
  if (ts instanceof Date) return ts;
  const d = new Date(ts); // numeric ms or ISO string
  return isNaN(d.getTime()) ? null : d;
};

// --- Date range for the dashboard controller ---
export function computeRange(key, custom) {
  const now = new Date();
  const sod = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const eod = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
  const dfmt = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  let start, end, label;
  switch (key) {
    case 'today': start = sod(now); end = eod(now); label = "Today's data"; break;
    case 'yesterday': { const y = new Date(now.getTime() - 86400000); start = sod(y); end = eod(y); label = "Yesterday's data"; break; }
    case '7d': start = sod(new Date(now.getTime() - 6 * 86400000)); end = eod(now); label = 'Last 7 days'; break;
    case '30d': start = sod(new Date(now.getTime() - 29 * 86400000)); end = eod(now); label = 'Last 30 days'; break;
    case 'month': start = sod(new Date(now.getFullYear(), now.getMonth(), 1)); end = eod(now); label = 'This month'; break;
    case 'lastmonth': { const s = new Date(now.getFullYear(), now.getMonth() - 1, 1); const e = new Date(now.getFullYear(), now.getMonth(), 0); start = sod(s); end = eod(e); label = 'Last month'; break; }
    case 'year': start = sod(new Date(now.getFullYear(), 0, 1)); end = eod(now); label = 'This year'; break;
    case 'custom': {
      const s = custom?.start ? sod(new Date(custom.start)) : sod(now);
      const e = custom?.end ? eod(new Date(custom.end)) : eod(now);
      start = s; end = e; label = `${dfmt(s)} → ${dfmt(e)}`; break;
    }
    default: start = sod(now); end = eod(now); label = "Today's data";
  }
  return { start: start.getTime(), end: end.getTime(), label };
}

// --- Rating band for a 0-100 score ---
export function ratingFor(score) {
  if (score >= 90) return { label: 'Excellent', color: '#34d399' };
  if (score >= 75) return { label: 'Good', color: '#d4af37' };
  if (score >= 50) return { label: 'Fair', color: '#fb923c' };
  return { label: 'Needs work', color: '#ef4444' };
}

// --- Inventory health (0-100) with factor breakdown ---
export function computeInventoryHealth(inventory) {
  const active = inventory.filter((p) => !p.archived);
  const n = active.length;
  if (!n) return { score: 100, factors: [] };
  const frac = (f) => active.filter(f).length / n;
  const sku = frac((p) => String(p.sku || '').trim());
  const img = frac((p) => p.imageString || p.image);
  const sup = frac((p) => (p.suppliers || []).length > 0);
  const veh = frac((p) => (p.compatibleCars || []).length > 0 || String(p.vehicle || '').trim());
  const price = frac((p) => (p.sellingPrice || 0) > 0);
  const cat = frac((p) => String(p.category || '').trim() || (p.categories || []).length > 0);
  const out = frac((p) => (p.stock || 0) === 0);
  const low = frac((p) => (p.stock || 0) > 0 && (p.stock || 0) <= (p.minStock || 5));
  const stock = Math.max(0, 1 - (out + low * 0.5));
  const score = Math.round(100 * (sku * 0.18 + sup * 0.18 + price * 0.15 + img * 0.14 + veh * 0.13 + cat * 0.07 + stock * 0.15));
  const factors = [
    { label: 'SKU coverage', pct: Math.round(sku * 100) },
    { label: 'Images uploaded', pct: Math.round(img * 100) },
    { label: 'Supplier mapping', pct: Math.round(sup * 100) },
    { label: 'Vehicle mapping', pct: Math.round(veh * 100) },
    { label: 'Pricing set', pct: Math.round(price * 100) },
    { label: 'Stock health', pct: Math.round(stock * 100) },
  ];
  return { score: Math.max(0, Math.min(100, score)), factors };
}

// --- Composite workshop score (0-100) ---
export function computeWorkshopScore({ inventory, sales = [], suppliers = [], alertsCount = 0, invHealthScore }) {
  const ih = invHealthScore != null ? invHealthScore : computeInventoryHealth(inventory).score;
  const now = Date.now(); const d30 = 30 * 86400000;
  const qtyOf = (s) => s.qty ?? s.quantity ?? 0;
  const recentSales = sales.filter((s) => { const d = tsToDate(s.createdAt); return d && now - d.getTime() < d30; }).reduce((a, s) => a + qtyOf(s), 0);
  const salesScore = Math.min(100, Math.round(recentSales / 2)); // ~200 units/30d => 100
  const withOt = suppliers.filter((s) => s.onTimePct != null);
  // Supplier on-time performance: only measurable when at least one supplier tracks it.
  // Previously this fell back to a hardcoded 80 — a fabricated number shown as if it were
  // measured. Instead we treat it as "no data" and drop it from the weighted average
  // (renormalising the other weights below), so the score reflects only what is real.
  const hasSupData = withOt.length > 0;
  const supScore = hasSupData ? Math.round(withOt.reduce((a, s) => a + (s.onTimePct || 0), 0) / withOt.length) : null;
  const alertScore = Math.max(0, 100 - alertsCount * 5);

  // Weighted composite over only the factors that have real data.
  const parts = [
    { label: 'Inventory health', pct: Math.round(ih), weight: 40 },
    { label: 'Sales activity', pct: Math.round(salesScore), weight: 25 },
    { label: 'Supplier performance', pct: supScore, weight: 20, noData: !hasSupData },
    { label: 'Alert pressure', pct: Math.round(alertScore), weight: 15 },
  ];
  const scored = parts.filter((p) => p.pct != null);
  const totalWeight = scored.reduce((a, p) => a + p.weight, 0);
  const score = totalWeight ? Math.round(scored.reduce((a, p) => a + p.pct * p.weight, 0) / totalWeight) : 0;
  return { score: Math.max(0, Math.min(100, score)), factors: parts };
}

// --- Single source of truth for alerts (Alert Center + sidebar badge) ---
export function computeAlerts(inventory, reorderRequests, connError, extra = {}) {
  const { customers = [], invoices = [], jobCards = [], purchaseOrders = [], suppliers = [] } = extra;
  const active = inventory.filter((p) => !p.archived);
  const list = [];
  active.filter((p) => (p.stock || 0) === 0).forEach((p) => list.push({ id: 'out-' + p.id, sev: 'Critical', cat: 'critical', module: 'Inventory', title: `Out of stock: ${p.name}`, sub: p.sku || 'no SKU', partId: p.id }));
  active.filter((p) => (p.stock || 0) > 0 && (p.stock || 0) <= (p.minStock || 5)).forEach((p) => list.push({ id: 'low-' + p.id, sev: 'Warning', cat: 'warning', module: 'Inventory', title: `Low stock: ${p.name}`, sub: `${p.stock}/${p.minStock || 5} · ${p.sku || 'no SKU'}`, partId: p.id }));
  active.filter((p) => (p.stock || 0) < 0).forEach((p) => list.push({ id: 'neg-' + p.id, sev: 'Critical', cat: 'inventory', module: 'Inventory', title: `Negative stock: ${p.name}`, sub: `stock = ${p.stock}`, partId: p.id }));
  const bySku = {};
  active.forEach((p) => { const k = safeLower(p.sku); if (k) (bySku[k] = bySku[k] || []).push(p); });
  Object.values(bySku).filter((g) => g.length > 1).forEach((g) => list.push({ id: 'sku-' + safeLower(g[0].sku), sev: 'Inventory', cat: 'inventory', module: 'Inventory', title: `SKU conflict: ${g[0].sku}`, sub: `${g.length} parts share this SKU`, partId: g[0].id }));
  active.filter((p) => !(p.suppliers || []).length && (p.stock || 0) <= (p.minStock || 5)).forEach((p) => list.push({ id: 'nosup-' + p.id, sev: 'Inventory', cat: 'inventory', module: 'Inventory', title: `No supplier: ${p.name}`, sub: 'Needs reorder but has no linked supplier', partId: p.id }));
  reorderRequests.filter((r) => r.status !== 'Delivered').forEach((r) => list.push({ id: 'po-' + r.id, sev: 'Supplier', cat: 'supplier', module: 'Suppliers', title: `Reorder ${r.status}: ${r.partName}`, sub: `${r.supplierName} · ×${r.qty}` }));

  // --- Customer / Vehicle alerts (document expiry + service due) ---
  const now = Date.now();
  const daysTo = (d) => { if (!d) return null; const t = new Date(d).getTime(); if (Number.isNaN(t)) return null; return Math.round((t - now) / 86400000); };
  const expBadge = (n) => (n < 0 ? 'Critical' : n <= 15 ? 'Warning' : 'Inventory');
  customers.forEach((c) => {
    (c.vehicles || []).forEach((v) => {
      const label = `${v.regNo || v.model || v.vehicle || 'Vehicle'} · ${c.name}`;
      [['insuranceExpiry', 'Insurance'], ['pucExpiry', 'PUC'], ['rcExpiry', 'RC'], ['warrantyExpiry', 'Warranty']].forEach(([field, kind]) => {
        const n = daysTo(v[field]);
        if (n != null && n <= 30) list.push({ id: `${kind}-${c.id}-${v.id || v.regNo}`, sev: expBadge(n), cat: 'customer', module: 'Customers', title: `${kind} ${n < 0 ? 'expired' : 'expiring'}: ${label}`, sub: n < 0 ? `Expired ${Math.abs(n)} day(s) ago` : `Due in ${n} day(s)`, customerId: c.id, regNo: v.regNo });
      });
      // service due (based on nextServiceDate or serviceIntervalDays from last service)
      const nsd = daysTo(v.nextServiceDate);
      if (nsd != null && nsd <= 7) list.push({ id: `svc-${c.id}-${v.id || v.regNo}`, sev: nsd < 0 ? 'Warning' : 'Inventory', cat: 'customer', module: 'Customers', title: `Service due: ${label}`, sub: nsd < 0 ? `Overdue ${Math.abs(nsd)} day(s)` : `Due in ${nsd} day(s)`, customerId: c.id, regNo: v.regNo });
    });
  });

  // --- Billing alerts (outstanding balances) ---
  invoices.forEach((iv) => {
    if (iv.isEstimate || iv.status === 'Cancelled') return;
    const bal = iv.balance != null ? Number(iv.balance) : Math.max(0, (Number(iv.grandTotal) || 0) - (Number(iv.paid) || 0));
    if (bal > 0) {
      const ageDays = iv.date ? Math.floor((now - new Date(iv.date).getTime()) / 86400000) : 0;
      if (ageDays >= 7) list.push({ id: `due-${iv.id}`, sev: ageDays >= 45 ? 'Critical' : 'Warning', cat: 'billing', module: 'Billing', title: `Outstanding: ${iv.customer || 'Customer'}`, sub: `₹${Math.round(bal).toLocaleString('en-IN')} pending · ${iv.invNo} · ${ageDays}d`, invId: iv.id, invNo: iv.invNo });
    }
  });

  // --- Job Card alerts (ready for delivery / delayed) ---
  jobCards.forEach((j) => {
    if (j.status === 'Ready') list.push({ id: `jcready-${j.jobNo}`, sev: 'Inventory', cat: 'vehicle', module: 'Job Cards', title: `Ready for delivery: ${j.vehicle || j.jobNo}`, sub: `${j.customer || ''} · ${j.jobNo}`, jobNo: j.jobNo });
    else if (!['Delivered', 'Closed', 'Cancelled', 'Ready'].includes(j.status) && j.dateIn) { const age = Math.floor((now - new Date(j.dateIn).getTime()) / 86400000); if (age >= 5) list.push({ id: `jcdelay-${j.jobNo}`, sev: 'Warning', cat: 'vehicle', module: 'Job Cards', title: `Job delayed: ${j.vehicle || j.jobNo}`, sub: `Open ${age} days · ${j.status} · ${j.jobNo}`, jobNo: j.jobNo }); }
  });

  // --- Supplier / PO alerts ---
  purchaseOrders.forEach((po) => { if (['draft', 'pending'].includes(po.status)) list.push({ id: `poapp-${po.id}`, sev: 'Supplier', cat: 'supplier', module: 'Purchase', title: `PO ${po.status}: ${po.poNumber}`, sub: `${po.supplierName || ''} · awaiting action`, poId: po.id }); });

  if (connError) list.push({ id: 'sync', sev: 'Critical', cat: 'critical', module: 'System', title: 'Sync issue', sub: connError });
  return list;
}

// --- Operational Intelligence Engine (insights) ---
//
// Each insight is a small, independently-testable RULE: it reads current data, decides
// whether it's currently relevant (the "candidate → relevant" step of the lifecycle), and
// if so returns a fully-formed insight object. A rule that is no longer true simply returns
// null and drops out of the list on the next recompute — there is no persisted "insight
// history" to go stale, so a resolved condition (PO approved, stock received, invoice paid)
// disappears or updates its count on the very next render that sees the new data.
//
// Ranking: insights are NOT split into "activity first, state second" any more. Real
// operational urgency doesn't work that way — an unpaid invoice matters more than a
// trending part. Every rule carries a fixed `priority` (lower = shown first), grouped into
// bands: 0x = critical (stock-outs blocking sales), 1x = financial, 2x = approvals blocking
// procurement, 3x = reorder, 4x = day-to-day operations, 5x = trend/activity (nice-to-know,
// nothing to act on). Within a band, rules are already hand-ordered by real business impact.
//
// Deduplication: rather than a generic text-similarity pass, overlap is designed out at the
// source — "out of stock" and "needs reordering" used to both count stock===0 parts (the
// dashboard would say "20 need reordering" AND "2 are out of stock" for the same 2 parts).
// `reorderLowOnly` below is deliberately the NON-zero-stock slice so the two rules can never
// double-count the same part.
//
// Time windows are explicit per rule (today / this week / last 30 days) and are NOT implied
// by tier — an "activity" insight and a "state" insight can both reference "this week" and
// both say so in their text. Boundary-crossing (a "this week" fact becoming false purely
// because the calendar rolled over, with no new data written) is handled by the caller
// re-invoking this function on a periodic tick, not inside this pure function — see the
// heartbeat in InventoryDashboard's OverviewView.
//
// Every insight optionally carries `nav: { tab, opts }`, reusing the exact same
// {subView, invFilter, stockFilter, statusFilter} shape the rest of the app's drill-down
// navigation already uses, so clicking an insight lands the owner directly on the filtered,
// actionable view — not a generic module they have to re-filter by hand.
export function computeInsights({ inventory = [], sales = [], suppliers = [], purchaseOrders = [], restocks = [], invoices = [], jobCards = [], customers = [], stockAdjustments = [] }) {
  const active = inventory.filter((p) => !p.archived);
  const now = Date.now(); const d7 = 7 * 86400000;
  const sod = new Date(); sod.setHours(0, 0, 0, 0); const sodMs = sod.getTime();
  const isToday = (ts) => { const d = tsToDate(ts); return !!d && d.getTime() >= sodMs; };
  const qtyOf = (s) => s.qty ?? s.quantity ?? 0;
  const DONE = new Set(['Delivered', 'Closed', 'Cancelled']);
  const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
  const list = [];
  // `kind` is a stable slug per rule (unaffected by ranking/wording changes) — the same
  // role the old flat kind-tagged list served for any external code (or a test) that needs
  // to find "the reorder insight" rather than pattern-match display text.
  const push = (kind, priority, tier, severity, text, nav = null) => list.push({ kind, priority, tier, severity, text, nav });

  // ---- 0x CRITICAL — parts fully depleted right now, blocking sales/service ----
  const outNow = active.filter((p) => (p.stock || 0) === 0).length;
  if (outNow > 0) push('stockout', 0, 'state', 'critical', `${outNow} part${outNow === 1 ? '' : 's'} are out of stock`,
    { tab: 'inventory', opts: { subView: 'parts', invFilter: 'out' } });

  // ---- 1x FINANCIAL ----
  const unpaid = invoices.filter((iv) => !iv.isEstimate && ['Unpaid', 'Partially Paid'].includes(iv.status));
  if (unpaid.length > 0) push('payment', 10, 'state', 'warning', `${unpaid.length} invoice${unpaid.length === 1 ? '' : 's'} awaiting payment`,
    { tab: 'billing', opts: { statusFilter: 'Outstanding' } });
  // Revenue actually collected TODAY (each payment entry carries its own date).
  const todayStr = new Date().toISOString().slice(0, 10);
  const collectedToday = invoices.reduce(
    (sum, iv) => sum + (iv.payments || []).filter((p) => p.date === todayStr).reduce((s, p) => s + (Number(p.amount) || 0), 0),
    0
  );
  if (collectedToday > 0) push('collected', 11, 'activity', 'positive', `${inr(collectedToday)} collected today`);

  // ---- 2x APPROVALS — blocks the procurement pipeline until actioned ----
  const pendingPO = purchaseOrders.filter((p) => p.status === 'pending').length;
  if (pendingPO > 0) push('po', 20, 'state', 'warning', `${pendingPO} purchase order${pendingPO === 1 ? '' : 's'} pending approval`,
    { tab: 'inventory', opts: { subView: 'po', statusFilter: 'pending' } });

  // ---- 3x REORDER — low but NOT zero (mutually exclusive with the critical out-of-stock
  //      rule above, by construction — see header comment) ----
  const reorderLowOnly = active.filter((p) => (p.stock || 0) > 0 && (p.stock || 0) <= (p.minStock || 5)).length;
  if (reorderLowOnly > 0) push('reorder', 30, 'state', 'warning', `${reorderLowOnly} part${reorderLowOnly === 1 ? '' : 's'} running low and need reordering`,
    { tab: 'inventory', opts: { subView: 'parts', invFilter: 'reorder' } });

  // ---- 4x OPERATIONAL — day-to-day workshop state ----
  const liveJobs = jobCards.filter((j) => !j.isDraft && !j.archived);
  const awaitingDelivery = liveJobs.filter((j) => j.status === 'Ready').length;
  if (awaitingDelivery > 0) push('delivery', 40, 'state', 'warning', `${awaitingDelivery} vehicle${awaitingDelivery === 1 ? '' : 's'} ready for delivery`,
    { tab: 'jobcards', opts: { kpiFilter: 'Ready' } });
  const pendingJobs = liveJobs.filter((j) => !DONE.has(j.status)).length;
  if (pendingJobs > 0) push('jobs', 41, 'state', 'info', `${pendingJobs} job card${pendingJobs === 1 ? '' : 's'} in progress`,
    { tab: 'jobcards', opts: { kpiFilter: 'Open' } });
  // Job cards actually completed TODAY — an event, not a standing count.
  const completedToday = liveJobs.filter((j) => (j.status === 'Delivered' || j.status === 'Closed') && (isToday(j.savedAt) || isToday(j.updatedAt) || isToday(j.deliveredAt))).length;
  if (completedToday > 0) push('completed', 42, 'activity', 'positive', `${completedToday} job card${completedToday === 1 ? '' : 's'} completed today`);
  // Stock Out — units removed via manual adjustments this week (damage, loss, theft,
  // personal use...). Distinct from sales; a shop with heavy shrinkage/damage should see it.
  const recentAdj = stockAdjustments.filter((a) => { const d = tsToDate(a.createdAt); return d && now - d.getTime() < d7; });
  const adjOutQty = recentAdj.reduce((sum, a) => { const q = qtyOf(a); return q < 0 ? sum + Math.abs(q) : sum; }, 0);
  if (adjOutQty > 0) {
    const reasonCounts = {};
    recentAdj.forEach((a) => { const q = qtyOf(a); if (q < 0 && a.reason) reasonCounts[a.reason] = (reasonCounts[a.reason] || 0) + 1; });
    const topReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0];
    push('adjustment', 43, 'activity', 'warning', `${adjOutQty} unit${adjOutQty === 1 ? '' : 's'} removed via stock adjustments this week${topReason ? ` (mostly ${topReason[0]})` : ''}`,
      { tab: 'inventory', opts: { subView: 'stock', stockFilter: { type: 'adjust', range: '7d' } } });
  }
  const recvVal = restocks.filter((r) => { const d = tsToDate(r.createdAt); return d && now - d.getTime() < d7; }).reduce((a, r) => a + (r.total || (r.qty || 0) * (r.unitCost || 0) || 0), 0);
  if (recvVal > 0) push('received', 44, 'activity', 'positive', `${inr(recvVal)} of stock received this week`,
    { tab: 'inventory', opts: { subView: 'stock', stockFilter: { type: 'in', range: '7d' } } });
  const linked = new Set(); active.forEach((p) => (p.suppliers || []).forEach((s) => linked.add(s?.id || s)));
  const inactiveSup = suppliers.filter((s) => !s.archived && !linked.has(s.id)).length;
  if (inactiveSup > 0) push('supplier', 45, 'state', 'info', `${inactiveSup} supplier${inactiveSup === 1 ? '' : 's'} have no linked parts`);
  const noImg = active.filter((p) => !(p.imageString || p.image)).length;
  if (noImg > 0) push('image', 46, 'state', 'info', `${noImg} item${noImg === 1 ? '' : 's'} still need an image uploaded`);
  // Slow-moving stock (in stock, no sale in 30 days)
  const d30 = 30 * 86400000;
  const soldRecentIds = new Set(sales.filter((s) => { const d = tsToDate(s.createdAt); return d && now - d.getTime() < d30; }).map((s) => s.partId));
  const slow = active.filter((p) => (p.stock || 0) > 0 && !soldRecentIds.has(p.id)).length;
  if (slow > 0) push('slow', 47, 'state', 'info', `${slow} in-stock part${slow === 1 ? '' : 's'} had no sale in 30 days`);

  // ---- 5x TREND / ACTIVITY — informational, nothing to act on today ----
  const recent = sales.filter((s) => { const d = tsToDate(s.createdAt); return d && now - d.getTime() < d7; });
  const unitsSold = recent.reduce((a, s) => a + qtyOf(s), 0);
  if (unitsSold > 0) push('sales', 50, 'activity', 'info', `${unitsSold} part${unitsSold === 1 ? '' : 's'} sold in the last 7 days`);
  const byPart = {};
  recent.forEach((s) => { if (s.name) byPart[s.name] = (byPart[s.name] || 0) + qtyOf(s); });
  const top = Object.entries(byPart).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] > 0) push('trending', 51, 'activity', 'info', `${top[0]} is trending (${top[1]} sold this week)`);
  const catRev = {};
  recent.forEach((s) => { const p = active.find((x) => x.id === s.partId); const c = p?.category; if (c) catRev[c] = (catRev[c] || 0) + (s.revenue ?? s.total ?? 0); });
  const topCat = Object.entries(catRev).sort((a, b) => b[1] - a[1])[0];
  if (topCat && topCat[1] > 0) push('category', 52, 'activity', 'info', `${topCat[0]} is your top-earning category this week (${inr(topCat[1])})`);
  const addedToday = inventory.filter((p) => isToday(p.createdAt)).length;
  if (addedToday > 0) push('added', 53, 'activity', 'info', `${addedToday} part${addedToday === 1 ? '' : 's'} added today`);
  const liveCustomers = customers.filter((c) => !c.archived);
  const newCust = liveCustomers.filter((c) => { const d = tsToDate(c.createdAt); return d && now - d.getTime() < d7; }).length;
  if (newCust > 0) push('customer', 54, 'activity', 'info', `${newCust} new customer${newCust === 1 ? '' : 's'} added this week`);

  return list.sort((a, b) => a.priority - b.priority);
}

// --- Live workshop progress (current operational state, not onboarding milestones) ---
// Each item: { label, value (display), pct (0-100 for the bar), hint }. Everything is
// derived from live data so the dashboard reflects the CURRENT state of the workshop.
export function computeWorkshopProgress({ inventory = [], invoices = [], jobCards = [], vehicles = [], sales = [] } = {}) {
  const active = inventory.filter((p) => !p.archived);
  const now = new Date(); const sod = new Date(now); sod.setHours(0, 0, 0, 0);
  const toDate = (v) => { if (!v) return null; if (v?.toDate) return v.toDate(); if (v?.seconds) return new Date(v.seconds * 1000); if (v instanceof Date) return v; const d = new Date(v); return isNaN(d.getTime()) ? null : d; };
  const isToday = (v) => { const d = toDate(v); return d && d.getTime() >= sod.getTime(); };
  const DONE = new Set(['Delivered', 'Closed', 'Cancelled']);

  // Job cards
  const liveJobs = jobCards.filter((j) => !j.isDraft && !j.archived);
  const activeJobs = liveJobs.filter((j) => !DONE.has(j.status));
  const readyForDelivery = liveJobs.filter((j) => j.status === 'Ready');
  const completedToday = liveJobs.filter((j) => (j.status === 'Delivered' || j.status === 'Closed') && (isToday(j.savedAt) || isToday(j.updatedAt) || isToday(j.deliveredAt)));
  const serviceDone = liveJobs.length ? Math.round((liveJobs.filter((j) => DONE.has(j.status)).length / liveJobs.length) * 100) : 0;

  // Billing — realized vs outstanding (invoiceStatus lives in billingService; use stored/derived status defensively)
  const realizedInv = invoices.filter((iv) => !iv.isEstimate && (iv.status === 'Paid'));
  const outstanding = invoices.filter((iv) => !iv.isEstimate && ['Unpaid', 'Partially Paid'].includes(iv.status));
  const billable = invoices.filter((iv) => !iv.isEstimate && iv.status !== 'Cancelled' && iv.status !== 'Draft');
  const billingComplete = billable.length ? Math.round((realizedInv.length / billable.length) * 100) : 0;

  // Inventory coverage — parts at/above their minimum
  const healthy = active.filter((p) => (p.stock || 0) > (p.minStock || 0)).length;
  const coverage = active.length ? Math.round((healthy / active.length) * 100) : 0;
  const outOfStock = active.filter((p) => (p.stock || 0) === 0).length;

  // Revenue goal / sales target — this month's realized sales revenue vs a data-derived
  // target (the trailing 3-month average monthly revenue). No hardcoded target, no new UI.
  const revOf = (s) => Number(s.revenue ?? s.total ?? 0);
  const monthKey = (d) => `${d.getFullYear()}-${d.getMonth()}`;
  const monthly = {};
  sales.forEach((s) => { const d = toDate(s.createdAt); if (d) monthly[monthKey(d)] = (monthly[monthKey(d)] || 0) + revOf(s); });
  const thisKey = monthKey(now);
  const thisMonthRev = monthly[thisKey] || 0;
  const priorKeys = Object.keys(monthly).filter((k) => k !== thisKey).sort().slice(-3);
  const target = priorKeys.length ? priorKeys.reduce((s, k) => s + monthly[k], 0) / priorKeys.length : 0;
  const goalPct = target > 0 ? Math.min(100, Math.round((thisMonthRev / target) * 100)) : (thisMonthRev > 0 ? 100 : 0);
  const inr0 = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;

  return [
    { label: 'Active job cards', value: String(activeJobs.length), pct: liveJobs.length ? Math.round((activeJobs.length / liveJobs.length) * 100) : 0, hint: `${liveJobs.length} total` },
    { label: 'Completed today', value: String(completedToday.length), pct: liveJobs.length ? Math.min(100, Math.round((completedToday.length / Math.max(1, liveJobs.length)) * 100)) : 0, hint: 'jobs delivered/closed today' },
    { label: 'Awaiting delivery', value: String(readyForDelivery.length), pct: activeJobs.length ? Math.round((readyForDelivery.length / Math.max(1, activeJobs.length)) * 100) : 0, hint: 'ready to hand over' },
    { label: 'Sales target', value: `${goalPct}%`, pct: goalPct, hint: target > 0 ? `${inr0(thisMonthRev)} of ${inr0(target)} (3-mo avg)` : `${inr0(thisMonthRev)} this month` },
    { label: 'Service completion', value: `${serviceDone}%`, pct: serviceDone, hint: 'of all job cards closed' },
    { label: 'Billing completion', value: `${billingComplete}%`, pct: billingComplete, hint: `${outstanding.length} invoice${outstanding.length === 1 ? '' : 's'} outstanding` },
    { label: 'Inventory coverage', value: `${coverage}%`, pct: coverage, hint: `${outOfStock} out of stock` },
  ];
}

// --- Achievement / onboarding milestones (kept for first-run onboarding, no longer the
//     primary dashboard progress — see computeWorkshopProgress for live state) ---
export function computeAchievements({ inventory = [], sales = [], suppliers = [], purchaseOrders = [], restocks = [] }) {
  const health = computeInventoryHealth(inventory).score;
  return [
    { label: 'First Supplier', done: suppliers.some((s) => !s.archived) },
    { label: 'First Sale', done: sales.length > 0 },
    { label: 'First Purchase Order', done: purchaseOrders.length > 0 },
    { label: 'First Stock In', done: restocks.length > 0 },
    { label: '100 Parts Added', done: inventory.length >= 100 },
    { label: '100 Sales Completed', done: sales.length >= 100 },
    { label: 'Inventory Complete', done: inventory.length > 0 && health >= 90 },
    { label: '10 Purchase Orders', done: purchaseOrders.length >= 10 },
  ];
}
