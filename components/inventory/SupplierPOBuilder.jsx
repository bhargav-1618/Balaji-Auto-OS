// components/inventory/SupplierPOBuilder.jsx
// Global Purchase Order builder (right-panel drawer). Search parts across every
// supplier, select with quantity steppers, review a GST-inclusive summary, then
// create the PO(s) — grouped by supplier — and optionally share via WhatsApp.
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { X, Search, Plus, Minus, ClipboardList, Check, MessageCircle, ChevronLeft, Trash2, PackageX, FileDown } from 'lucide-react';
import { useSearchIndex, matchIndexed } from '../../lib/useSearch';
import { PDF_PAGE, PDF_GOLD, PDF_RULE, PDF_TEXT, liveShop, drawPdfHeader, drawPdfPageNumber } from '../../lib/pdfTheme';
import { checkCapacityGuard } from '../../lib/useCapacity';
import notify from '../common/notify';

export default function SupplierPOBuilder({ inventory = [], suppliers = [], restocks = [], formatINR, onClose, onCreatePO, docked = false, seedPart = null, demoMode = false, selectedSupplier = null }) {
  const inr = (n) => (typeof formatINR === 'function' ? formatINR(n) : `₹${Math.round(n || 0).toLocaleString('en-IN')}`);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [sel, setSel] = useState({});        // partId -> qty
  // External "Add to Purchase Order": when the seed signal changes, add that part (min qty 1)
  // without clobbering anything already selected.
  const seedRef = useRef(null);
  const poListRef = useRef(null);
  useEffect(() => { if (poListRef.current) poListRef.current.scrollTop = 0; }, [filter, q, selectedSupplier?.id]);
  useEffect(() => {
    if (!seedPart || !seedPart.id) return;
    const sig = `${seedPart.id}::${seedPart._n || ''}`;
    if (seedRef.current === sig) return;
    seedRef.current = sig;
    // Issue 6 (Suppliers module review) — this used to always seed qty 1, a different rule
    // from the reorder qty (`suggested`, below) manual selection already uses for the same
    // part. One qty rule for "add this part to a PO," not two.
    const part = inventory.find((p) => p.id === seedPart.id);
    const qty = part ? Math.max(1, suggested(part)) : 1;
    setSel((s) => (s[seedPart.id] ? s : { ...s, [seedPart.id]: qty }));
  }, [seedPart]); // eslint-disable-line react-hooks/exhaustive-deps
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  // Issue (Supplier-aware PO panel) — separate pagination per section, not one shared
  // "visible" count. Supplied-parts and other-parts are two different lists once a
  // supplier is selected (see suppliedList/otherList below); sharing one counter would
  // mean paging through "Other Parts" silently also reveals more "Parts supplied by X"
  // rows, or vice versa — visually incoherent since they're rendered as separate blocks.
  const [visibleSupplied, setVisibleSupplied] = useState(30);
  const [visibleOther, setVisibleOther] = useState(30);
  // The prior selected supplier's id — used only to detect an actual CHANGE (not the
  // initial selection) so the "still in your order" toast below fires on a genuine
  // switch, not on first mount or on re-renders where the same supplier stays selected.
  const prevSupplierIdRef = useRef(selectedSupplier?.id ?? null);

  const active = useMemo(() => inventory.filter((p) => !p.archived), [inventory]);
  const restockedIds = useMemo(() => new Set(restocks.map((r) => r.partId)), [restocks]);
  const supplierOf = (p) => (Array.isArray(p.suppliers) && p.suppliers[0]) || null;
  const suggested = (p) => Math.max((p.minStock || 5) * 2 - (p.stock || 0), p.minStock || 5);
  const isLow = (p) => (p.stock || 0) > 0 && (p.stock || 0) <= (p.minStock || 5);
  const isOut = (p) => (p.stock || 0) === 0;

  const counts = useMemo(() => ({
    all: active.length,
    low: active.filter(isLow).length,
    out: active.filter(isOut).length,
    frequent: active.filter((p) => restockedIds.has(p.id)).length,
  }), [active, restockedIds]);

  const [debQ, setDebQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebQ(q), 350); return () => clearTimeout(t); }, [q]);

  // GLOBAL SEARCH ACCURACY: Part Number (sku) is a strict identifier field (exact/
  // prefix/suffix/contains via rankIndexed, ranked above free text) — not folded into
  // the same fuzzy bucket as name/category/vehicle/compatible-cars/supplier, which stay
  // partial-searchable text. The old "min 3 chars before searching" gate was removed —
  // see the `list` useMemo below.
  const partSearchIndex = useSearchIndex(
    active,
    (p) => p.id,
    (p) => {
      const sup = supplierOf(p);
      const rec = suppliers.find((s) => s.id === sup?.id);
      return [p.name, p.category, p.vehicle, ...(p.compatibleCars || []), sup?.name || '', ...(rec?.altNames || [])];
    },
    (p) => [p.sku],
    [suppliers],
  );
  const list = useMemo(() => {
    const raw = debQ.trim();
    return active.filter((p) => {
      if (filter === 'low' && !isLow(p)) return false;
      if (filter === 'out' && !isOut(p)) return false;
      if (filter === 'frequent' && !restockedIds.has(p.id)) return false;
      // Strict Search Validation review: a NON-EMPTY query — even a single character —
      // must genuinely filter, never fall back to "show everything." The old 3-char
      // minimum meant typing "s" showed the complete unfiltered part list instead of
      // parts that actually contain "s"; only a genuinely EMPTY query skips filtering.
      if (!raw) return true;
      return matchIndexed(partSearchIndex.get(p.id), raw);
    });
  }, [active, debQ, filter, restockedIds, partSearchIndex]);

  // Supplier-aware PO panel — a part "belongs to" the selected supplier if ANY of its
  // linked suppliers matches, not just its first/primary one (supplierOf() above reads
  // only suppliers[0], which is right for "who does a checkout line get grouped under,"
  // but wrong here — a part with 3 suppliers, none of them primary, is still genuinely
  // supplied by all 3). Mirrors SupplierDirectory.jsx's own partsOf() matching exactly,
  // so "supplied by this supplier" means the same thing on both sides of the split pane.
  const suppliedIds = useMemo(() => {
    if (!selectedSupplier?.id) return null;
    const set = new Set();
    active.forEach((p) => {
      if ((p.suppliers || []).some((x) => (x?.id || x) === selectedSupplier.id)) set.add(p.id);
    });
    return set;
  }, [active, selectedSupplier?.id]);

  // Same filtered/searched `list` as always — just partitioned into two groups when a
  // supplier is selected, instead of a second, separately-filtered query. This is what
  // keeps search genuinely covering BOTH groups: it's one filter pass over the full
  // active-parts array (never a paginated/visible slice), split afterward for display.
  const suppliedList = useMemo(() => (suppliedIds ? list.filter((p) => suppliedIds.has(p.id)) : []), [list, suppliedIds]);
  const otherList = useMemo(() => (suppliedIds ? list.filter((p) => !suppliedIds.has(p.id)) : list), [list, suppliedIds]);

  // "Clearly communicate the supplier change" (brief) without a blocking confirmation:
  // the cart here is deliberately multi-supplier-capable already (see `groups` below —
  // one order can produce several POs, grouped by each PART's own supplier, not by
  // whichever supplier's catalog you were last browsing). Switching who you're BROWSING
  // never reassigns or drops anything already selected, so there is nothing to confirm
  // or lose — a brief, non-blocking toast is the honest amount of ceremony for "your
  // context changed, your cart didn't," not a modal interrupting an intentional
  // multi-supplier shopping flow.
  useEffect(() => {
    const prevId = prevSupplierIdRef.current;
    const nextId = selectedSupplier?.id ?? null;
    if (prevId !== nextId && prevId != null && nextId != null && Object.keys(sel).length > 0) {
      notify.info(`Now browsing ${selectedSupplier.name}'s parts — your ${Object.keys(sel).length} selected item${Object.keys(sel).length === 1 ? ' is' : 's are'} still in the order.`);
    }
    prevSupplierIdRef.current = nextId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSupplier?.id]);

  const toggle = (p) => setSel((s) => { const n = { ...s }; if (n[p.id] != null) delete n[p.id]; else n[p.id] = suggested(p); return n; });
  const setQty = (id, v) => setSel((s) => ({ ...s, [id]: Math.max(1, Math.round(v) || 1) }));
  const clearAll = () => setSel({});
  useEffect(() => { setVisibleSupplied(30); setVisibleOther(30); }, [q, filter, selectedSupplier?.id]);
  // Search-result caps: while actively searching, both sections show up to 100 matches
  // immediately instead of the normal 30-per-page browsing cap — a real search query
  // realistically narrows a catalog to well under 100 hits, so this is what "search
  // finds it without needing to click Load more" (brief) means in practice, without
  // literally rendering an unbounded list for a query that matches everything.
  const isSearching = debQ.trim().length >= 3;
  const suppliedCap = isSearching ? Math.max(visibleSupplied, 100) : visibleSupplied;
  const otherCap = isSearching ? Math.max(visibleOther, 100) : visibleOther;

  const selectedParts = useMemo(() => Object.keys(sel).map((id) => active.find((p) => p.id === id)).filter(Boolean), [sel, active]);
  const totalQty = selectedParts.reduce((s, p) => s + (sel[p.id] || 0), 0);
  const subtotal = selectedParts.reduce((s, p) => s + (sel[p.id] || 0) * (p.purchasePrice || 0), 0);
  // GST-optional rule: use each part's own GST% (0 when the part/supplier is non-GST)
  // rather than forcing 18%. Purchase orders still generate correctly at 0% GST.
  const gst = Math.round(selectedParts.reduce((s, p) => { const rate = Number(p.gst) || 0; return s + (sel[p.id] || 0) * (p.purchasePrice || 0) * (rate / 100); }, 0));
  const gstPctLabel = (() => { const rates = Array.from(new Set(selectedParts.map((p) => Number(p.gst) || 0))); return rates.length === 1 ? `${rates[0]}%` : 'mixed'; })();
  const grand = subtotal + gst;
  const eta = useMemo(() => { const d = new Date(Date.now() + 3 * 86400000); return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }, []);
  const phoneOf = (sup) => {
    const rec = suppliers.find((s) => s.id === sup?.id);
    const raw = sup?.phone || rec?.phoneNumbers?.[0]?.number || rec?.phone || '';
    return String(raw).replace(/\D/g, '').slice(-10);
  };
  const waSend = (grp) => {
    const ph = phoneOf(grp.supplier);
    const lines = grp.items.map((it) => `• ${it.name} × ${it.qty}`).join('%0A');
    const total = grp.items.reduce((s, it) => s + it.qty * it.unitCost, 0);
    const msg = `Hello ${grp.supplier?.name || ''},%0A%0AWe would like to place the following order:%0A${lines}%0A%0AEstimated Total: ${inr(total)}%0APlease confirm availability and expected delivery.%0A%0AThank you,%0ASri Baba Balaji Maruti Care`;
    if (ph) window.open(`https://wa.me/91${ph}?text=${msg}`, '_blank');
  };
  const downloadPDF = async () => {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: PDF_PAGE.unit, format: PDF_PAGE.format });
    const { W, M } = PDF_PAGE;
    const money = (n) => `Rs ${Math.round(n || 0).toLocaleString('en-IN')}`;
    let page = 1;
    // GLOBAL PDF FRAMEWORK: Purchase Order previously had NO letterhead at all — just
    // three lines of plain text with a third, unrelated "gold-ish" color
    // (150,120,40, distinct from both Job Card's and Invoice's 212,175,55) and no
    // page numbers on a document that already breaks across pages. It's the same
    // kind of formal, supplier-facing document as an Invoice, so it now shares the
    // exact same branded header (lib/pdfTheme.js) as Job Card and Invoice/Estimate.
    // liveShop(demoMode): Settings QA fix — Purchase Order previously used the bare
    // hardcoded SHOP, so a saved Workshop Name/Phone/GST/Address/Email never showed
    // here even though it did on Invoice/Job Card once those were fixed too. See
    // lib/pdfTheme.js.
    let y = drawPdfHeader(doc, { W, M, shop: liveShop(demoMode) }) - 6;
    // GLOBAL PDF FRAMEWORK (typography consistency): was 12pt normal-weight — the
    // ONE other document with a comparable "document-type label directly below the
    // letterhead" (Billing's "TAX INVOICE"/"ESTIMATE") uses 13pt bold. Matched here so
    // the two most similar sibling documents share the same heading weight/size; the
    // gold color itself is intentionally kept (PDF_GOLD.onLight — see lib/pdfTheme.js),
    // not reverted to Billing's black, per the earlier documented color decision.
    doc.setFontSize(13); doc.setFont(undefined, 'bold'); doc.setTextColor(...PDF_GOLD.onLight); doc.text('PURCHASE ORDER', M, y); doc.setFont(undefined, 'normal'); y += 16;
    doc.setFontSize(9); doc.setTextColor(...PDF_TEXT.muted);
    doc.text(`Date: ${new Date().toLocaleDateString('en-IN')}    Estimated delivery: ~ ${eta}`, M, y); y += 24;
    const pageBreak = (limit) => { if (y > limit) { doc.addPage(); page += 1; y = 48; } };
    groups.forEach((grp) => {
      pageBreak(760);
      doc.setFontSize(11); doc.setTextColor(...PDF_TEXT.body); doc.text(grp.supplier?.name || 'No supplier linked', M, y); y += 15;
      doc.setFontSize(9); doc.setTextColor(...PDF_TEXT.muted);
      doc.text('Item', M + 8, y); doc.text('Qty', 350, y); doc.text('Unit', 415, y); doc.text('Total', 490, y); y += 6;
      doc.setDrawColor(...PDF_RULE.medium); doc.line(M, y, W - M, y); y += 12;
      doc.setTextColor(50, 50, 50);
      grp.items.forEach((it) => {
        pageBreak(785);
        doc.text(String(it.name).slice(0, 52), M + 8, y);
        doc.text(String(it.qty), 350, y);
        doc.text(money(it.unitCost), 415, y);
        doc.text(money(it.qty * it.unitCost), 490, y);
        y += 14;
      });
      const gt = grp.items.reduce((s, it) => s + it.qty * it.unitCost, 0);
      doc.setTextColor(...PDF_TEXT.body); doc.text(`Subtotal: ${money(gt)}`, 415, y + 2); y += 24;
    });
    pageBreak(760);
    doc.setDrawColor(...PDF_RULE.medium); doc.line(M, y, W - M, y); y += 16;
    doc.setFontSize(10); doc.setTextColor(60, 60, 60);
    doc.text(`Subtotal: ${money(subtotal)}`, 415, y); y += 15;
    doc.text(`GST (${gstPctLabel}): ${money(gst)}`, 415, y); y += 16;
    doc.setFontSize(12); doc.setTextColor(...PDF_TEXT.ink); doc.text(`Total Amount: ${money(grand)}`, 415, y);
    for (let p = 1; p <= page; p += 1) { doc.setPage(p); drawPdfPageNumber(doc, p, { W, M }); }
    doc.save(`purchase-order-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const groups = useMemo(() => {
    const g = {};
    selectedParts.forEach((p) => {
      const sup = supplierOf(p);
      const key = sup?.id || '__none__';
      (g[key] = g[key] || { supplier: sup, items: [] }).items.push({ partId: p.id, name: p.name, sku: p.sku || '', qty: sel[p.id], unitCost: p.purchasePrice || 0 });
    });
    return Object.values(g);
  }, [selectedParts, sel]);

  const confirm = async () => {
    if (busy) return;
    // CAPACITY GUARD — a second, independent PO-creation entry point from
    // InventoryPurchaseOrders.jsx's own "New PO" (this one is the quick-create drawer
    // reachable from a low-stock/reorder flow), so it needs its own check rather than
    // relying on the other screen's guard ever running. Checked once for the whole
    // batch: purchase-order volume is naturally low (grouped by supplier, rarely more
    // than a few POs per submit), so a single "are we already at the hard limit" check
    // before the loop is the right amount of ceremony here — not a per-PO recheck.
    const { blocked } = await checkCapacityGuard('purchaseOrders', { demoMode });
    if (blocked) {
      notify.warning('Record limit reached. Please free space before creating a new record.');
      return;
    }
    setBusy(true);
    try {
      for (const grp of groups) {
        // eslint-disable-next-line no-await-in-loop
        await onCreatePO?.({ supplierId: grp.supplier?.id || null, supplierName: grp.supplier?.name || '—', items: grp.items, notes: 'Created from PO builder' });
      }
      onClose?.();
    } finally { setBusy(false); }
  };

  const chip = (k, label, n) => (
    <button key={k} type="button" onClick={() => setFilter(k)} className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap transition ${filter === k ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]' : 'text-white/60 bg-white/5 border border-white/10 hover:bg-white/10'}`}>{label} ({n})</button>
  );

  // Shared row renderer for BOTH sections (supplied and other) — same interaction
  // pattern (checkbox → qty stepper) and same information density everywhere, so the
  // two groups read as one coherent list that's merely SORTED by relevance, not two
  // differently-behaving widgets. `hideSupplier` drops the redundant "· SupplierName"
  // meta text inside the supplied-parts section (already implied by the section
  // heading above it) while keeping it in "Other Parts", where seeing who DOES supply
  // an other part is actually useful context.
  const renderPartRow = (p, { hideSupplier = false } = {}) => {
    const on = sel[p.id] != null;
    return (
      <div key={p.id} className={`flex items-center gap-2 px-2 py-2 rounded-xl mb-1 transition ${on ? 'bg-emerald-500/10' : 'hover:bg-white/[0.03]'}`}>
        <button onClick={() => toggle(p)} className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border transition ${on ? 'bg-emerald-500 border-emerald-500' : 'border-white/25'}`}>{on && <Check size={13} className="text-black" />}</button>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-white/90 font-medium truncate">{p.name}</p>
          <p className="text-[10px] text-white/45 truncate">{[p.vehicle, p.category || 'Uncategorised', hideSupplier ? null : supplierOf(p)?.name].filter(Boolean).join(' · ')}</p>
          <p className="text-[10px] mt-0.5">{p.sku ? <span className="text-white/45">{p.sku} · </span> : null}<span className={isOut(p) ? 'text-red-400' : isLow(p) ? 'text-amber-400' : 'text-white/45'}>Stock {p.stock || 0}</span><span className="text-white/45"> · min {p.minStock || 5} · suggest {suggested(p)}</span></p>
        </div>
        {on ? (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={() => setQty(p.id, sel[p.id] - 1)} className="w-6 h-6 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/70 hover:bg-white/10"><Minus size={12} /></button>
            <input value={sel[p.id]} onChange={(e) => setQty(p.id, Number(e.target.value))} className="w-9 text-center text-sm bg-transparent text-white outline-none" />
            <button onClick={() => setQty(p.id, sel[p.id] + 1)} className="w-6 h-6 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/70 hover:bg-white/10"><Plus size={12} /></button>
          </div>
        ) : (
          <span className="text-[11px] text-white/45 flex-shrink-0">{inr(p.purchasePrice || 0)}</span>
        )}
      </div>
    );
  };

  const panel = (
    <div className={`w-full h-full flex flex-col ${docked ? 'rounded-2xl overflow-hidden' : 'sm:max-w-md'}`} style={{ background: 'var(--surface-1)', ...(docked ? { border: '1px solid rgba(212,175,55,0.2)' } : { borderLeft: '1px solid rgba(212,175,55,0.2)' }) }} onClick={(e) => e.stopPropagation()}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
          <div className="flex items-center gap-2">
            {reviewing && <button onClick={() => setReviewing(false)} className="w-8 h-8 -ml-1 rounded-lg flex items-center justify-center text-white/60 hover:bg-white/10"><ChevronLeft size={18} /></button>}
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2"><ClipboardList size={16} className="text-[#d4af37]" /> {reviewing ? 'Review Order' : 'Purchase Order'}</h3>
              {/* No Supplier State Must Remain Clean — this only ever reads
                  selectedSupplier.name when selectedSupplier itself is truthy, so a
                  stray "Parts supplied by undefined" can't render during the split
                  second before a selection exists or right after it's cleared. */}
              {!reviewing && (
                <p className="text-[11px] text-white/45 truncate">
                  {selectedSupplier ? <>Supplier: <span className="text-white/70 font-semibold">{selectedSupplier.name}</span></> : 'Search and add parts from any supplier.'}
                </p>
              )}
            </div>
          </div>
          {!docked && <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10"><X size={18} /></button>}
        </div>

        {!reviewing ? (
          <>
            {/* Search + filters */}
            <div className="px-4 pt-3 pb-2 flex-shrink-0 space-y-2">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/45" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search parts by name, SKU, vehicle, category…" className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 text-white placeholder-white/30 outline-none focus:border-[#d4af37]/60" />
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1 dark-scroll">
                {chip('all', 'All', counts.all)}
                {chip('low', 'Low Stock', counts.low)}
                {chip('out', 'Out of Stock', counts.out)}
                {chip('frequent', 'Frequent', counts.frequent)}
              </div>
              <p className="text-[11px] text-white/45 px-0.5">
                {list.length} match{list.length === 1 ? '' : 'es'} for {filter === 'all' ? 'All Parts' : filter === 'low' ? 'Low Stock' : filter === 'out' ? 'Out of Stock' : 'Frequently Ordered'}
                {(filter !== 'all' || q) && <button onClick={() => { setFilter('all'); setQ(''); }} className="ml-1.5 text-[#d4af37] hover:underline">Clear</button>}
              </p>
            </div>

            {/* Part list — Supplier-aware PO panel: two sections once a supplier is
                selected (supplied parts first, then everything else, divided by a
                labeled heading — never a hard cut, "Other Parts" stays fully browsable
                and searchable). With no supplier selected, suppliedIds is null and
                otherList IS simply the whole filtered list, so this renders as the
                original single flat list — one code path for both states, not two. */}
            <div ref={poListRef} className="flex-1 overflow-y-auto dark-scroll px-2">
              {list.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-14 text-center"><PackageX size={26} className="text-white/20" /><p className="text-sm text-white/45">No parts match your filters.</p>{(filter !== 'all' || q) && <button onClick={() => { setFilter('all'); setQ(''); }} className="text-xs font-semibold text-[#d4af37] hover:underline">Clear Filters</button>}</div>
              ) : (
                <>
                  {selectedSupplier && (
                    <div className="mb-2">
                      <div className="flex items-center justify-between px-1 pt-1 pb-1.5">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-[#d4af37]">Parts supplied by {selectedSupplier.name} ({suppliedList.length})</p>
                      </div>
                      {suppliedList.length === 0 ? (
                        <p className="text-xs text-white/45 px-1 pb-2">No supplied parts match your current search/filter.</p>
                      ) : (
                        <>
                          {suppliedList.slice(0, suppliedCap).map((p) => renderPartRow(p, { hideSupplier: true }))}
                          {suppliedList.length > suppliedCap && (
                            <button onClick={() => setVisibleSupplied((v) => v + 30)} className="w-full my-2 py-2 rounded-xl text-xs font-semibold text-white/70 bg-white/5 border border-white/10 hover:bg-white/10 transition">Load more supplied parts ({suppliedList.length - suppliedCap} more)</button>
                          )}
                        </>
                      )}
                      {/* Separator between "supplied by this supplier" and everything else —
                          a labeled divider, not just spacing, so the boundary between the two
                          groups is unmissable at a glance. */}
                      <div className="flex items-center gap-2 mt-3 mb-2 px-1">
                        <div className="h-px flex-1" style={{ background: 'rgba(var(--fg-rgb),0.1)' }} />
                        <span className="text-[10px] font-bold uppercase tracking-wide text-white/45">Other Parts</span>
                        <div className="h-px flex-1" style={{ background: 'rgba(var(--fg-rgb),0.1)' }} />
                      </div>
                      <p className="text-[10px] text-white/45 px-1 pb-1.5">Not currently linked to {selectedSupplier.name} — still orderable if needed.</p>
                    </div>
                  )}
                  {otherList.slice(0, otherCap).map((p) => renderPartRow(p))}
                  {otherList.length > otherCap && (
                    <button onClick={() => setVisibleOther((v) => v + 30)} className="w-full my-2 py-2 rounded-xl text-xs font-semibold text-white/70 bg-white/5 border border-white/10 hover:bg-white/10 transition">Load more parts ({otherList.length - otherCap} more)</button>
                  )}
                </>
              )}
            </div>

            {/* Selected Items + Order Summary */}
            {selectedParts.length > 0 && (
              <div className="flex-shrink-0 px-4 py-3" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.08)', background: 'var(--surface-2)' }}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-white">Selected Items ({selectedParts.length})</span>
                  <button onClick={clearAll} className="text-[11px] text-red-400 hover:underline">Clear All</button>
                </div>
                <div className="max-h-24 overflow-y-auto dark-scroll space-y-1 mb-2 pr-1">
                  {selectedParts.map((p) => (
                    <div key={p.id} className="flex items-center justify-between text-xs gap-2">
                      <span className="text-white/70 truncate flex-1">{p.name}</span>
                      <span className="text-white/45 flex-shrink-0">Qty: {sel[p.id]}</span>
                      <button onClick={() => toggle(p)} aria-label="Remove" className="text-red-400 hover:text-red-300 flex-shrink-0"><X size={12} /></button>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg p-2.5 space-y-1 mb-2" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                  <div className="flex justify-between text-[11px]"><span className="text-white/45">Total Items</span><span className="text-white/80">{selectedParts.length}</span></div>
                  <div className="flex justify-between text-[11px]"><span className="text-white/45">Total Quantity</span><span className="text-white/80">{totalQty}</span></div>
                  <div className="flex justify-between text-[11px]"><span className="text-white/45">Subtotal</span><span className="text-white/80">{inr(subtotal)}</span></div>
                  <div className="flex justify-between text-[11px]"><span className="text-white/45">GST ({gstPctLabel})</span><span className="text-white/80">{inr(gst)}</span></div>
                  <div className="flex justify-between pt-1" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.06)' }}><span className="text-xs font-bold text-white">Total Amount</span><span className="text-sm font-bold text-[#d4af37]">{inr(grand)}</span></div>
                </div>
                <button onClick={() => setReviewing(true)} className="w-full h-11 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] active:scale-95 transition">Review Order</button>
              </div>
            )}
          </>
        ) : (
          /* Review screen */
          <div className="flex-1 overflow-y-auto dark-scroll p-4 space-y-3">
            <p className="text-xs text-white/45">This order will create {groups.length} purchase order{groups.length === 1 ? '' : 's'}, grouped by supplier. Estimated delivery around <span className="text-white/80 font-semibold">{eta}</span>.</p>
            {groups.map((grp, gi) => {
              const gTotal = grp.items.reduce((s, it) => s + it.qty * it.unitCost, 0);
              return (
                <div key={gi} className="rounded-xl p-3" style={{ background: 'var(--surface-2)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
                  <p className="text-sm font-bold text-white mb-2">{grp.supplier?.name || 'No supplier linked'}</p>
                  {grp.items.map((it) => (
                    <div key={it.partId} className="flex justify-between text-xs py-1"><span className="text-white/70 truncate mr-2">{it.name} × {it.qty}</span><span className="text-white/85 flex-shrink-0">{inr(it.qty * it.unitCost)}</span></div>
                  ))}
                  <div className="flex items-center justify-between pt-2 mt-1" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                    <span className="text-xs font-semibold text-white/60">Subtotal <span className="text-[#d4af37]">{inr(gTotal)}</span></span>
                    {phoneOf(grp.supplier) && (
                      <button onClick={() => waSend(grp)} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition"><MessageCircle size={12} /> WhatsApp</button>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="rounded-xl p-3 space-y-1.5" style={{ background: 'var(--surface-2)', border: '1px solid rgba(212,175,55,0.2)' }}>
              <div className="flex justify-between text-sm"><span className="text-white/50">Subtotal</span><span className="text-white/85">{inr(subtotal)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-white/50">GST ({gstPctLabel})</span><span className="text-white/85">{inr(gst)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-white/50">Est. delivery</span><span className="text-white/85">~ {eta}</span></div>
              <div className="flex justify-between"><span className="text-sm font-bold text-white">Total Amount</span><span className="text-base font-bold text-[#d4af37]">{inr(grand)}</span></div>
            </div>
            <div className="space-y-2 pt-1">
              <button onClick={confirm} disabled={busy} className="w-full h-11 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] active:scale-95 transition disabled:opacity-60 flex items-center justify-center gap-2"><ClipboardList size={16} /> {busy ? 'Creating…' : `Confirm & Create ${groups.length > 1 ? groups.length + ' POs' : 'PO'}`}</button>
              <button onClick={downloadPDF} className="w-full h-10 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 active:scale-95 transition"><FileDown size={15} /> Download PDF</button>
              <p className="text-[11px] text-white/45 text-center">After creating, open each PO to approve, share on WhatsApp, or receive stock.</p>
            </div>
          </div>
        )}
    </div>
  );
  if (docked) return panel;
  return (
    <div className="fixed inset-0 z-[110] flex justify-end" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }} onClick={onClose}>
      {panel}
    </div>
  );
}
