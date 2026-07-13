// services/analyticsService.js
// Pure, UI-free business logic extracted from the InventoryDashboard monolith
// as the first step of an incremental (behaviour-preserving) refactor toward a
// services/ + hooks/ + features/ structure. Everything here is a pure function:
// no React, no state, no Firestore — trivially testable in isolation.

// --- internal helpers (self-contained so this module has no coupling) ---
const safeLower = (val) => (val || '').toString().toLowerCase();
const tsToDate = (ts) => (ts?.toDate ? ts.toDate() : ts?.seconds ? new Date(ts.seconds * 1000) : ts instanceof Date ? ts : null);

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
  const supScore = withOt.length ? Math.round(withOt.reduce((a, s) => a + (s.onTimePct || 0), 0) / withOt.length) : 80;
  const alertScore = Math.max(0, 100 - alertsCount * 5);
  const score = Math.round(ih * 0.4 + salesScore * 0.25 + supScore * 0.2 + alertScore * 0.15);
  const factors = [
    { label: 'Inventory health', pct: Math.round(ih), weight: 40 },
    { label: 'Sales activity', pct: Math.round(salesScore), weight: 25 },
    { label: 'Supplier performance', pct: Math.round(supScore), weight: 20 },
    { label: 'Alert pressure', pct: Math.round(alertScore), weight: 15 },
  ];
  return { score: Math.max(0, Math.min(100, score)), factors };
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

// --- Derived "AI" insights (honest, computed — no fabricated numbers) ---
export function computeInsights({ inventory = [], sales = [], suppliers = [], purchaseOrders = [], restocks = [] }) {
  const active = inventory.filter((p) => !p.archived);
  const now = Date.now(); const d7 = 7 * 86400000;
  const out = [];
  const recent = sales.filter((s) => { const d = tsToDate(s.createdAt); return d && now - d.getTime() < d7; });
  const qtyOf = (s) => s.qty ?? s.quantity ?? 0;
  const unitsSold = recent.reduce((a, s) => a + qtyOf(s), 0);
  if (unitsSold > 0) out.push({ kind: 'sales', text: `${unitsSold} part${unitsSold === 1 ? '' : 's'} sold in the last 7 days` });
  // trending part by recent units
  const byPart = {};
  recent.forEach((s) => { if (s.name) byPart[s.name] = (byPart[s.name] || 0) + qtyOf(s); });
  const top = Object.entries(byPart).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] > 0) out.push({ kind: 'trending', text: `${top[0]} is trending (${top[1]} sold this week)` });
  const recvVal = restocks.filter((r) => { const d = tsToDate(r.createdAt); return d && now - d.getTime() < d7; }).reduce((a, r) => a + (r.total || (r.qty || 0) * (r.unitCost || 0) || 0), 0);
  if (recvVal > 0) out.push({ kind: 'received', text: `₹${Math.round(recvVal).toLocaleString('en-IN')} of stock received this week` });
  const reorder = active.filter((p) => (p.stock || 0) === 0 || (p.stock || 0) <= (p.minStock || 5)).length;
  if (reorder > 0) out.push({ kind: 'reorder', text: `${reorder} part${reorder === 1 ? '' : 's'} need reordering` });
  const noImg = active.filter((p) => !(p.imageString || p.image)).length;
  if (noImg > 0) out.push({ kind: 'image', text: `${noImg} item${noImg === 1 ? '' : 's'} still need an image uploaded` });
  const linked = new Set(); active.forEach((p) => (p.suppliers || []).forEach((s) => linked.add(s?.id || s)));
  const inactiveSup = suppliers.filter((s) => !s.archived && !linked.has(s.id)).length;
  if (inactiveSup > 0) out.push({ kind: 'supplier', text: `${inactiveSup} supplier${inactiveSup === 1 ? '' : 's'} have no linked parts` });
  const pendingPO = purchaseOrders.filter((p) => p.status === 'pending').length;
  if (pendingPO > 0) out.push({ kind: 'po', text: `${pendingPO} purchase order${pendingPO === 1 ? '' : 's'} pending approval` });
  // Highest-revenue category this week
  const catRev = {};
  recent.forEach((s) => { const p = active.find((x) => x.id === s.partId); const c = p?.category; if (c) catRev[c] = (catRev[c] || 0) + (s.revenue ?? s.total ?? 0); });
  const topCat = Object.entries(catRev).sort((a, b) => b[1] - a[1])[0];
  if (topCat && topCat[1] > 0) out.push({ kind: 'category', text: `${topCat[0]} is your top-earning category this week (₹${Math.round(topCat[1]).toLocaleString('en-IN')})` });
  // Parts added today
  const sod = new Date(); sod.setHours(0, 0, 0, 0);
  const addedToday = inventory.filter((p) => { const d = tsToDate(p.createdAt); return d && d.getTime() >= sod.getTime(); }).length;
  if (addedToday > 0) out.push({ kind: 'added', text: `${addedToday} part${addedToday === 1 ? '' : 's'} added today` });
  // Slow-moving stock (in stock, no sale in 30 days)
  const d30 = 30 * 86400000;
  const soldRecentIds = new Set(sales.filter((s) => { const d = tsToDate(s.createdAt); return d && now - d.getTime() < d30; }).map((s) => s.partId));
  const slow = active.filter((p) => (p.stock || 0) > 0 && !soldRecentIds.has(p.id)).length;
  if (slow > 0) out.push({ kind: 'slow', text: `${slow} in-stock part${slow === 1 ? '' : 's'} had no sale in 30 days` });
  return out.slice(0, 8);
}

// --- Achievement / onboarding milestones ---
export function computeAchievements({ inventory = [], sales = [], suppliers = [], purchaseOrders = [], restocks = [] }) {
  const health = computeInventoryHealth(inventory).score;
  return [
    { label: 'First Supplier', done: suppliers.some((s) => !s.archived) },
    { label: 'First Sale', done: sales.length > 0 },
    { label: 'First Purchase Order', done: purchaseOrders.length > 0 },
    { label: 'First Stock In', done: restocks.length > 0 },
    { label: '100 Parts Added', done: inventory.length >= 100 },
    { label: '100 Sales Completed', done: sales.length >= 100 },
    { label: 'Inventory Complete', done: health >= 90 },
    { label: '10 Purchase Orders', done: purchaseOrders.length >= 10 },
  ];
}
