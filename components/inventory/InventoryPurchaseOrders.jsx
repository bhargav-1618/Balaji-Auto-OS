// components/inventory/InventoryPurchaseOrders.jsx
// PHASE 1 — Purchase Orders lifecycle: pending → approved → received → cancelled.
// Fully functional in demo (in-memory). In production it reads/writes a new
// `purchaseOrders` collection and, on "received", increments stock. Test on a
// staging Firebase before trusting production writes.
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import DropdownPanel, { ModalBoundaryContext } from '../common/DropdownPanel';
import MiniSelect from '../common/MiniSelect';
import PageHeader from '../common/PageHeader';
import Pagination from './Pagination';
import CapacityBanner from '../common/CapacityBanner';
import CapacityCleanupModal from '../common/CapacityCleanupModal';
import { checkCapacityGuard } from '../../lib/useCapacity';
import notify from '../common/notify';
import { useSearchIndex, matchIndexed, rankIndexed, useDeferredSearch } from '../../lib/useSearch';
import { pricesDiffer } from '../../services/inventoryService';
import { SEMANTIC } from '../../constants/ui';
import {
  ClipboardList, Plus, Check, PackageCheck, XCircle, Trash2,
  X, ChevronDown, Search,
} from 'lucide-react';

const num = (v) => (Number.isFinite(+v) ? +v : 0);
const toMillis = (t) => {
  if (!t) return 0;
  if (typeof t === 'number') return t < 1e12 ? t * 1000 : t;
  if (typeof t?.toMillis === 'function') return t.toMillis();
  if (t?.seconds) return t.seconds * 1000;
  const p = Date.parse(t);
  return Number.isNaN(p) ? 0 : p;
};
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

// COLOR SYSTEM REVIEW: 'cancelled' rendered DANGER red here — the same "Cancelled shown
// as red instead of muted" bug already found and fixed in the Job Card status filters and
// documented as a deliberately-resolved conflict in STATUS_COLOR (constants/ui.js) itself.
// A cancelled PO isn't a currently-active problem the way an overdue/unpaid invoice is —
// it's simply inactive, same as every other "Cancelled" in this app. The other six were
// already using colors that happen to equal SEMANTIC tokens exactly; routed through the
// tokens themselves so they can't drift independently of the shared palette again.
export const STATUS = {
  draft: { label: 'Draft', color: SEMANTIC.muted, bg: 'rgba(156,163,175,0.12)', border: 'rgba(156,163,175,0.3)' },
  pending: { label: 'Pending Approval', color: SEMANTIC.amber, bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },
  approved: { label: 'Approved', color: SEMANTIC.info, bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.3)' },
  sent: { label: 'Sent', color: SEMANTIC.violet, bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.3)' },
  partial: { label: 'Partially Received', color: SEMANTIC.cyan, bg: 'rgba(34,211,238,0.12)', border: 'rgba(34,211,238,0.3)' },
  received: { label: 'Completed', color: SEMANTIC.okAlt, bg: 'rgba(74,222,128,0.12)', border: 'rgba(74,222,128,0.3)' },
  cancelled: { label: 'Cancelled', color: SEMANTIC.muted, bg: 'rgba(156,163,175,0.12)', border: 'rgba(156,163,175,0.3)' },
};

export default function InventoryPurchaseOrders({
  purchaseOrders = [], suppliers = [], inventory = [], formatINR, canManage = false,
  demoMode = false, actorEmail, onCapacityCleanup,
  onCreate, onAdvance, onReceive, onCancel,
  // Issue 7.2 — Receive Stock's "Pending Deliveries" picker navigates here and
  // asks to auto-open a specific PO's receive form, instead of forcing the user
  // to re-find the same PO in this list by hand.
  initialReceivePOId, onInitialReceiveHandled,
  // 1.3 — Dashboard Insights ("N purchase orders pending approval") navigates here
  // and expects to land on that exact status filter already applied, same one-shot
  // deep-link pattern as initialReceivePOId above.
  initialStatusFilter, onInitialStatusFilterHandled,
}) {
  const [filter, setFilter] = useState('all');
  const [creating, setCreating] = useState(false);
  const [capacityBlockedOpen, setCapacityBlockedOpen] = useState(false);
  // Bumped by the wizard's onComplete to refresh the banner — NOT used to close the
  // modal (that's onClose/"Done", so the wizard's own result screen stays visible).
  const [capacityRefreshTick, setCapacityRefreshTick] = useState(0);
  // CAPACITY GUARD — checked before the "New purchase order" form even opens, so a
  // blocked attempt never leaves a half-filled draft behind. Same shape as Job
  // Cards/Billing: a single async check, then either open the form or the cleanup wizard.
  const guardedOpenCreate = async () => {
    const { blocked } = await checkCapacityGuard('purchaseOrders', { demoMode });
    if (blocked) {
      notify.warning('Record limit reached. Please free space before creating a new record.');
      setCapacityBlockedOpen(true);
      return;
    }
    setCreating(true);
  };
  const [receiving, setReceiving] = useState(null); // the PO currently being received, or null
  useEffect(() => {
    if (!initialReceivePOId) return;
    const po = purchaseOrders.find((p) => p.id === initialReceivePOId);
    if (po) setReceiving(po);
    onInitialReceiveHandled?.();
  }, [initialReceivePOId, purchaseOrders, onInitialReceiveHandled]);
  useEffect(() => {
    if (!initialStatusFilter) return;
    setFilter(initialStatusFilter);
    onInitialStatusFilterHandled?.();
  }, [initialStatusFilter, onInitialStatusFilterHandled]);
  const [poQ, setPoQ] = useState('');
  const [poDq] = useDeferredSearch(poQ);
  const [page, setPage] = useState(1);
  const PER = 20;
  useEffect(() => { setPage(1); }, [filter, poQ]);
  const inr = (n) => (typeof formatINR === 'function' ? formatINR(n) : `₹${Math.round(num(n)).toLocaleString('en-IN')}`);

  const counts = useMemo(() => {
    // 'all' means all ACTIVE purchase orders (archived ones left the active dataset —
    // see the capacity-archive feature) — same convention as Billing's invoice filter.
    const c = { all: 0, draft: 0, pending: 0, approved: 0, sent: 0, partial: 0, received: 0, cancelled: 0, archived: 0 };
    purchaseOrders.forEach((p) => {
      if (p.archived === true) { c.archived += 1; return; }
      c.all += 1;
      if (c[p.status] != null) c[p.status] += 1;
    });
    return c;
  }, [purchaseOrders]);

  // GLOBAL SEARCH ACCURACY: PO Number and Part Number (sku) match by EXACT value only — a
  // complete PO number can never also surface an unrelated PO whose number merely starts
  // with or contains it. Supplier name and part name stay partial-searchable, unchanged.
  const poSearchIndex = useSearchIndex(
    purchaseOrders,
    (p) => p.id,
    (p) => [p.supplierName, ...(p.items || []).map((it) => it.name)],
    (p) => [p.poNumber, ...(p.items || []).map((it) => it.sku)],
  );
  const shown = useMemo(() => {
    let list = filter === 'archived'
      ? purchaseOrders.filter((p) => p.archived === true)
      : purchaseOrders.filter((p) => p.archived !== true && (filter === 'all' || p.status === filter));
    const byDate = (a, b) => toMillis(b.createdAt) - toMillis(a.createdAt);
    if (poDq.trim()) {
      // Universal Search review: an active query re-ranks exact-match-first (rankIndexed)
      // instead of staying in date order regardless of relevance.
      list = [...list].filter((p) => matchIndexed(poSearchIndex.get(p.id), poDq))
        .sort((a, b) => rankIndexed(poSearchIndex.get(b.id), poDq) - rankIndexed(poSearchIndex.get(a.id), poDq) || byDate(a, b));
      return list;
    }
    return [...list].sort(byDate);
  }, [purchaseOrders, filter, poDq, poSearchIndex]);

  return (
    <PageHeader title="Purchase Orders" icon={ClipboardList} action={canManage && (
      <button onClick={guardedOpenCreate} className="flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] active:scale-95 transition">
        <Plus size={16} /> New PO
      </button>
    )}>
      <CapacityBanner moduleKey="purchaseOrders" demoMode={demoMode} actorEmail={actorEmail} refreshKey={`${purchaseOrders.length}-${capacityRefreshTick}`} className="mb-4" onCleanupComplete={onCapacityCleanup} />
      <CapacityCleanupModal
        open={capacityBlockedOpen} onClose={() => setCapacityBlockedOpen(false)}
        moduleKey="purchaseOrders" demoMode={demoMode} actorEmail={actorEmail}
        onComplete={() => { onCapacityCleanup?.(); setCapacityRefreshTick((n) => n + 1); }}
      />
      {/* status filter */}
      <div className="relative mb-2">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/45" />
        <input value={poQ} onChange={(e) => setPoQ(e.target.value)} placeholder="Search PO number, supplier, part, SKU…" className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 text-white placeholder-white/30 outline-none focus:border-[#d4af37]/60" />
      </div>
      <div className="flex items-center gap-1 p-1 rounded-xl w-max max-w-full overflow-x-auto" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
        {[['all', 'All'], ['draft', 'Draft'], ['pending', 'Pending Approval'], ['approved', 'Approved'], ['sent', 'Sent'], ['partial', 'Partial'], ['received', 'Completed'], ['cancelled', 'Cancelled'], ['archived', 'Archived']].map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className={`px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition ${filter === k ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]' : 'text-white/60 hover:text-white/90 hover:bg-white/5'}`}>
            {label} <span className="opacity-60">{counts[k] || 0}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="p-12 flex flex-col items-center gap-3 text-center rounded-2xl" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
          <ClipboardList size={30} className="text-white/20" />
          <p className="text-sm text-white/45">{filter === 'all' ? 'No purchase orders yet. Create one to start tracking pending → received.' : `No ${filter} purchase orders.`}</p>
          {canManage && filter === 'all' && (
            <button onClick={() => setCreating(true)} className="mt-1 flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] active:scale-95 transition"><Plus size={16} /> Create your first PO</button>
          )}
        </div>
      ) : (
        <>
        <div className="space-y-2.5">
          {shown.slice((page - 1) * PER, page * PER).map((po) => {
            const st = STATUS[po.status] || STATUS.pending;
            const items = po.items || [];
            const receivedCount = items.filter((it) => num(it.receivedQty) >= num(it.qty) && num(it.qty) > 0).length;
            const hasReceived = items.some((it) => num(it.receivedQty) > 0);
            return (
              <div key={po.id} className="rounded-2xl p-4 backdrop-blur-sm" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-[120px]">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">{po.poNumber}</span>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide" style={{ color: st.color, background: st.bg, border: `1px solid ${st.border}` }}>{st.label}</span>
                    </div>
                    <div className="text-[11px] text-white/45 mt-0.5">{po.supplierName || '—'}</div>
                  </div>
                  <div className="text-xs text-white/50">
                    {(po.items || []).length} item{(po.items || []).length === 1 ? '' : 's'} · <span className="text-emerald-400 font-semibold">{inr(po.total)}</span>
                  </div>
                  <div className="text-[11px] text-white/45 ml-auto text-right">
                    <div>Created {fmtDate(toMillis(po.createdAt))}</div>
                    {po.status === 'received' && <div className="text-emerald-400/70">Received {fmtDate(toMillis(po.receivedAt))}</div>}
                    {po.status === 'partial' && <div className="text-cyan-400/70">{receivedCount} of {items.length} items received</div>}
                    {po.status === 'cancelled' && <div className="text-red-400/70">Cancelled {fmtDate(toMillis(po.cancelledAt))}</div>}
                  </div>
                </div>

                {/* items */}
                {(po.items || []).length > 0 && (
                  <div className="mt-3 pt-3 space-y-1" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.05)' }}>
                    {(po.items || []).map((it, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="flex-1 min-w-0 text-white/70 truncate">{it.name}</span>
                        <span className="text-white/45">{num(it.qty)} × {inr(it.unitCost)}</span>
                        <span className="text-white/60 w-20 text-right tabular-nums">{inr(num(it.qty) * num(it.unitCost))}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* actions */}
                {canManage && ['draft', 'pending', 'approved', 'sent', 'partial'].includes(po.status) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {po.status === 'draft' && (
                      <button onClick={() => onAdvance?.(po, 'pending')} className="h-9 px-3 rounded-lg flex items-center gap-1.5 text-xs font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 active:scale-95 transition"><Check size={13} /> Submit for approval</button>
                    )}
                    {po.status === 'pending' && (
                      <button onClick={() => onAdvance?.(po, 'approved')} className="h-9 px-3 rounded-lg flex items-center gap-1.5 text-xs font-bold bg-blue-500/15 text-blue-300 border border-blue-500/30 active:scale-95 transition"><Check size={13} /> Approve</button>
                    )}
                    {po.status === 'approved' && (
                      <button onClick={() => onAdvance?.(po, 'sent')} className="h-9 px-3 rounded-lg flex items-center gap-1.5 text-xs font-bold bg-violet-500/15 text-violet-300 border border-violet-500/30 active:scale-95 transition"><PackageCheck size={13} /> Send to supplier</button>
                    )}
                    {(po.status === 'sent' || po.status === 'partial' || po.status === 'approved') && (
                      <button onClick={() => setReceiving(po)} className="h-9 px-3 rounded-lg flex items-center gap-1.5 text-xs font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 active:scale-95 transition"><PackageCheck size={13} /> Receive stock</button>
                    )}
                    {/* Issue 7 — a PO with any quantity already received can't be cancelled
                        (cancelPO in InventoryDashboard.js enforces this too; hiding it here
                        avoids offering an action that would just error). */}
                    {!hasReceived && (
                      <button onClick={() => onCancel?.(po)} className="h-9 px-3 rounded-lg flex items-center gap-1.5 text-xs font-semibold bg-white/5 border border-white/10 text-white/60 hover:text-red-400 active:scale-95 transition"><XCircle size={13} /> Cancel</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <Pagination page={page} total={shown.length} perPage={PER} onPage={setPage} />
        </>
      )}

      {creating && (
        <POCreateForm
          suppliers={suppliers.filter((s) => !s.archived)}
          inventory={inventory.filter((p) => !p.archived)}
          formatINR={formatINR}
          onClose={() => setCreating(false)}
          onSubmit={async (payload) => { const ok = await onCreate?.(payload); if (ok !== false) setCreating(false); }}
        />
      )}

      {receiving && (
        <ReceivePOForm
          key={`rcv:${receiving.id}`}
          po={receiving}
          inventory={inventory}
          formatINR={formatINR}
          onClose={() => setReceiving(null)}
          onSubmit={async (receivedLines, receiptId) => { const ok = await onReceive?.(receiving, receivedLines, receiptId); if (ok !== false) setReceiving(null); }}
        />
      )}
    </PageHeader>
  );
}

// Custom dark dropdown — replaces the native <select> whose option list the
// browser renders white. Matches the app theme, searchable, keyboard-navigable.
//
// Supplier-aware PO part picker: `options` (flat list) still works exactly as before
// for every other caller. `groups` is a new, optional alternative shape —
// [{ label, options }] — used only by the PO part picker below so it can render
// "Parts supplied by X" ahead of "Other Inventory Parts" while still searching (and
// letting the user pick from) the full combined set. Search re-filters WITHIN each
// group independently and preserves the grouping, so a match keeps showing under
// whichever section it actually belongs to instead of collapsing into one flat list.
function DarkSelect({ value, onChange, options, groups, placeholder = 'Select…' }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const ref = useRef(null);
  const srcGroups = useMemo(() => groups || [{ label: null, options: options || [] }], [groups, options]);
  const flatOptions = useMemo(() => srcGroups.flatMap((g) => g.options), [srcGroups]);
  const selected = flatOptions.find((o) => o.value === value);
  const scoreOpt = (o, l) => (o.ids ? rankIndexed({ hay: o.label.toLowerCase(), ids: o.ids }, l) : (o.label.toLowerCase().includes(l.toLowerCase()) ? 1 : 0));
  // Universal Search review: an option may optionally carry `ids` (identifier fields —
  // e.g. a part's SKU) alongside its display `label`. When present, matching/ranking
  // goes through rankIndexed (exact-then-partial identifier match, ranked above a plain
  // label match) instead of one flat substring test — options with no `ids` behave
  // exactly as before (plain label substring match).
  const filteredGroups = useMemo(() => {
    const l = q.trim();
    if (!l) return srcGroups.map((g) => ({ ...g, items: g.options }));
    return srcGroups.map((g) => {
      const scored = g.options.map((o) => ({ o, score: scoreOpt(o, l) })).filter((x) => x.score > 0);
      scored.sort((a, b) => b.score - a.score);
      return { ...g, items: scored.map((x) => x.o) };
    });
  }, [srcGroups, q]);
  const filteredFlat = useMemo(() => filteredGroups.flatMap((g) => g.items), [filteredGroups]);
  // Outside-click/Escape is owned by the portalled <DropdownPanel> below (its own
  // useOutsideClose, which correctly checks both the anchor AND the portalled panel).
  // A local `mousedown` + ref.contains() check here is WRONG: the panel renders via
  // a portal into <body>, so it is never a DOM descendant of `ref` — every mousedown
  // on an option button would be treated as "outside" and close the panel before the
  // click could register, silently dropping every pick. Never re-add it here.
  const pick = (v) => { onChange(v); setOpen(false); setQ(''); };
  const onKey = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(filteredFlat.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filteredFlat[hi]) pick(filteredFlat[hi].value); }
    else if (e.key === 'Escape') { setOpen(false); setQ(''); }
  };
  return (
    <div ref={ref} className="relative" onKeyDown={onKey}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} className="w-full px-3 py-2.5 rounded-xl text-sm text-left flex items-center justify-between gap-2 bg-white/5 border border-white/10 text-white hover:bg-white/[0.07] focus:border-[#d4af37]/60 focus:outline-none transition">
        <span className={`truncate ${selected ? 'text-white' : 'text-white/45'}`}>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={16} className={`text-white/45 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <DropdownPanel anchorRef={ref} open onClose={() => { setOpen(false); setQ(''); }} scroll={false}
          style={{ background: 'var(--surface-2)', border: '1px solid rgba(var(--fg-rgb),0.12)', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: 340 }}>
          {flatOptions.length > 6 && (
            <div className="p-1.5" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)', flex: '0 0 auto' }}>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/45" />
                <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} placeholder="Search…" className="w-full pl-7 pr-2.5 py-1.5 rounded-lg text-sm bg-white/5 border border-white/10 text-white placeholder-white/30 outline-none focus:border-[#d4af37]/50" />
              </div>
            </div>
          )}
          <div className="overflow-y-auto py-1 dark-scroll" style={{ flex: '1 1 auto' }} role="listbox">
            {filteredFlat.length ? filteredGroups.map((g, gi) => (g.items.length === 0 ? null : (
              <div key={g.label || `g${gi}`}>
                {g.label && (
                  <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-[#d4af37]/80 sticky top-0" style={{ background: 'var(--surface-2)' }}>
                    {g.label}
                  </div>
                )}
                {g.items.map((o) => {
                  const i = filteredFlat.indexOf(o);
                  return (
                    <button key={o.value} type="button" onMouseEnter={() => setHi(i)} onClick={() => pick(o.value)} role="option" aria-selected={o.value === value} className={`w-full text-left px-3 py-2 text-sm truncate transition ${o.value === value ? 'bg-[#d4af37]/15 text-[#d4af37] font-semibold' : i === hi ? 'bg-white/[0.06] text-white' : 'text-white/80'}`}>{o.label}</button>
                  );
                })}
              </div>
            ))) : <div className="px-3 py-3 text-xs text-white/45 text-center">No matches</div>}
          </div>
        </DropdownPanel>
      )}
    </div>
  );
}

function POCreateForm({ suppliers, inventory, formatINR, onClose, onSubmit }) {
  // Universal Issue #1 (dropdown/select/combobox architecture review) — this modal's
  // Supplier/Part DarkSelect dropdowns had no boundary to clamp against, so a long
  // option list could render past this panel's own edge. Same fix as every other
  // modal in the app: provide this panel's own ref via ModalBoundaryContext so every
  // DropdownPanel-backed control inside it (however deeply nested) is automatically
  // contained — no per-field wiring needed.
  const modalRef = useRef(null);
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState('Normal');
  const [expectedDate, setExpectedDate] = useState('');
  const [lines, setLines] = useState([]);
  const [partPick, setPartPick] = useState('');
  // Issue 7 (concurrency review) — onSubmit's caller awaits the actual PO write
  // before closing this modal; guard against a double-click creating two POs.
  // Phase 4b (PH4-06) — stable PO id for the life of this form; a retry after an
  // ambiguous failure re-writes the same document, not a second PO.
  const poIdRef = useRef(`po_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`);
  const [saving, setSaving] = useState(false);
  const submit = async (status) => {
    if (saving || lines.length === 0) return;
    setSaving(true);
    await onSubmit?.({ poId: poIdRef.current, supplierId: supplierId || null, supplierName: supplier?.name || '—', items: lines, notes, expectedDate, priority, ...(status ? { status } : {}) });
    setSaving(false);
  };
  const inr = (n) => (typeof formatINR === 'function' ? formatINR(n) : `₹${Math.round(num(n)).toLocaleString('en-IN')}`);

  const addLine = () => {
    const p = inventory.find((x) => x.id === partPick);
    if (!p) return;
    if (lines.some((l) => l.partId === p.id)) return;
    setLines((prev) => [...prev, { partId: p.id, name: p.name, sku: p.sku || '', qty: Math.max(1, num(p.minStock) - num(p.stock)) || 1, unitCost: num(p.purchasePrice) }]);
    setPartPick('');
  };
  const setLine = (id, key, val) => setLines((prev) => prev.map((l) => (l.partId === id ? { ...l, [key]: val } : l)));
  const removeLine = (id) => setLines((prev) => prev.filter((l) => l.partId !== id));
  const total = lines.reduce((s, l) => s + num(l.qty) * num(l.unitCost), 0);
  const supplier = suppliers.find((s) => s.id === supplierId);

  // Part 1 — supplier-aware part picker. A part is "supplied by" the selected supplier
  // if it appears in the part's own `suppliers` list (id match, or name match for the
  // rare row that was hand-typed with no id). Nothing is hidden — every part still
  // shows, just grouped so the supplier's own parts surface first.
  const isSuppliedBy = (part, sup) => {
    if (!sup) return false;
    const rows = Array.isArray(part.suppliers) ? part.suppliers : [];
    return rows.some((r) => (r.id && sup.id && r.id === sup.id)
      || (!r.id && r.name && sup.name && r.name.trim().toLowerCase() === sup.name.trim().toLowerCase()));
  };
  const toOpt = (p) => ({ value: p.id, label: `${p.name}${p.sku ? ` (${p.sku})` : ''}`, ids: [p.sku, p.oemNo] });
  const partGroups = useMemo(() => {
    if (!supplier) return null;
    const own = []; const other = [];
    inventory.forEach((p) => (isSuppliedBy(p, supplier) ? own : other).push(toOpt(p)));
    return [
      { label: `Parts supplied by ${supplier.name}`, options: own },
      { label: 'Other Inventory Parts', options: other },
    ];
  }, [supplier, inventory]);
  const flatPartOptions = useMemo(() => inventory.map(toOpt), [inventory]);

  const fld = 'w-full px-3 py-2.5 rounded-xl text-sm outline-none bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-[#d4af37]/60 transition';

  // Portal to <body>: this form renders inside <main> (`relative z-10`, its own
  // stacking context), so an inline `fixed inset-0` overlay stays capped at
  // <main>'s z-10 and the mobile bottom-nav (z-[80], a sibling of <main>) paints
  // over the sheet's sticky Cancel / Save Draft / Create PO footer.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div ref={modalRef} data-modal-panel="" className="w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl" style={{ background: 'var(--surface-3)', border: '1px solid rgba(var(--fg-rgb),0.1)' }} onClick={(e) => e.stopPropagation()}>
      <ModalBoundaryContext.Provider value={modalRef}>
        <div className="sticky top-0 flex items-center justify-between px-5 py-4" style={{ background: 'var(--surface-3)', borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
          <h3 className="text-base font-bold text-white">New purchase order</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-white/45 mb-1.5">Supplier</label>
            <DarkSelect
              value={supplierId}
              onChange={setSupplierId}
              placeholder="Select supplier…"
              options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider text-white/45 mb-1.5">Add parts</label>
            {supplier && (
              <p className="text-[11px] text-white/45 mb-1.5">
                Showing parts supplied by <span className="text-[#d4af37]">{supplier.name}</span> first — every other part is still available under &ldquo;Other Inventory Parts&rdquo;.
              </p>
            )}
            <div className="flex gap-2">
              <div className="flex-1"><DarkSelect
                value={partPick}
                onChange={setPartPick}
                placeholder="Pick a part…"
                groups={partGroups || undefined}
                options={partGroups ? undefined : flatPartOptions}
              /></div>
              <button onClick={addLine} disabled={!partPick} className="h-[42px] px-4 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] active:scale-95 disabled:opacity-40 flex items-center gap-1"><Plus size={15} /></button>
            </div>
          </div>

          {lines.length > 0 && (
            <div className="space-y-1.5">
              <div className="hidden sm:grid gap-2 px-2 text-[10px] uppercase tracking-wider text-white/40" style={{ gridTemplateColumns: 'minmax(0,1fr) 64px 84px 84px 28px' }}>
                <span>Part</span><span className="text-center">Qty</span><span className="text-center">Unit Cost</span><span className="text-right">Line Total</span><span />
              </div>
              {lines.map((l) => (
                <div key={l.partId} className="grid items-center gap-2 p-2 rounded-xl" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)', gridTemplateColumns: 'minmax(0,1fr) 64px 84px 84px 28px' }}>
                  <div className="min-w-0">
                    <div className="text-sm text-white/85 truncate">{l.name}</div>
                    <div className="text-[10px] text-white/45">{l.sku}</div>
                  </div>
                  <input type="number" min="1" value={l.qty} onChange={(e) => setLine(l.partId, 'qty', e.target.value)} className="w-full px-2 py-1.5 rounded-lg text-sm text-center bg-white/5 border border-white/10 text-white" title="Qty" />
                  <input type="number" min="0" value={l.unitCost} onChange={(e) => setLine(l.partId, 'unitCost', e.target.value)} className="w-full px-2 py-1.5 rounded-lg text-sm text-center bg-white/5 border border-white/10 text-white" title="Unit cost" />
                  <span className="text-sm text-white/70 text-right tabular-nums">{inr(num(l.qty) * num(l.unitCost))}</span>
                  <button onClick={() => removeLine(l.partId)} className="w-7 h-7 rounded-lg flex items-center justify-center text-white/45 hover:text-red-400 hover:bg-red-500/10 justify-self-end"><Trash2 size={13} /></button>
                </div>
              ))}
              <div className="flex justify-end text-sm font-semibold text-white/80 pt-1">Total: <span className="text-emerald-400 ml-2">{inr(total)}</span></div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-white/45 mb-1.5">Expected date (optional)</label>
              <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className={fld} />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-white/45 mb-1.5">Priority</label>
              {/* Universal dropdown architecture review — native <select> is a browser-owned
                  popup, immune to this app's theming/containment (same fix as this modal's
                  Supplier/Part DarkSelect fields above). */}
              <MiniSelect value={priority} options={['Normal', 'High', 'Urgent']} emptyValue="Normal" onPick={(v) => setPriority(v || 'Normal')} inputCls={fld} />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-white/45 mb-1.5">Notes (optional)</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. urgent" className={fld} />
            </div>
          </div>
        </div>
        <div className="sticky bottom-0 flex gap-2 px-5 py-4" style={{ background: 'var(--surface-3)', borderTop: '1px solid rgba(var(--fg-rgb),0.08)' }}>
          <button onClick={onClose} className="flex-1 h-11 rounded-xl text-sm font-semibold bg-white/5 border border-white/10 text-white/70 active:scale-95">Cancel</button>
          <button
            onClick={() => submit('draft')}
            disabled={lines.length === 0 || saving}
            aria-busy={saving}
            className="flex-1 h-11 rounded-xl text-sm font-semibold bg-white/5 border border-white/10 text-white/70 active:scale-95 disabled:opacity-40"
          >Save Draft</button>
          <button
            onClick={() => submit()}
            disabled={lines.length === 0 || saving}
            aria-busy={saving}
            className="flex-1 h-11 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] active:scale-95 disabled:opacity-40"
          >{saving ? 'Saving…' : 'Create PO'}</button>
        </div>
      </ModalBoundaryContext.Provider>
      </div>
    </div>,
    document.body,
  );
}

// Issue 7 (Purchase Order lifecycle review) — replaces the old single "Mark received
// (+stock)" click. Every line defaults to its outstanding remainder (qty minus whatever
// was already received on a prior partial receipt) so a user receiving everything in one
// go still just opens this and confirms — same number of real decisions as before. A user
// handling a partial delivery edits the quantities down instead.
function ReceivePOForm({ po, inventory, formatINR, onClose, onSubmit }) {
  const inr = (n) => (typeof formatINR === 'function' ? formatINR(n) : `₹${Math.round(num(n)).toLocaleString('en-IN')}`);
  const [lines, setLines] = useState(() => (po.items || [])
    .map((it) => ({
      partId: it.partId, name: it.name, sku: it.sku,
      orderedQty: num(it.qty), alreadyReceived: num(it.receivedQty),
      receiveQty: Math.max(0, num(it.qty) - num(it.receivedQty)),
      unitCost: num(it.unitCost),
    }))
    .filter((l) => l.orderedQty - l.alreadyReceived > 0));
  const setLine = (id, key, val) => setLines((prev) => prev.map((l) => (l.partId === id ? { ...l, [key]: val } : l)));
  const [confirmPriceUpdate, setConfirmPriceUpdate] = useState(false);

  // Lines whose entered cost differs from the part's current default purchase price —
  // uses the SAME pricesDiffer() comparison RestockModal's own diff-detection does
  // (Issue 7.4 — these were two independent copies of the identical rounding logic),
  // so receiving a PO never silently overwrites a part's master price without the
  // same explicit confirmation that flow already uses.
  const diffLines = lines.filter((l) => {
    if (num(l.receiveQty) <= 0) return false;
    const p = inventory.find((x) => x.id === l.partId);
    return p && pricesDiffer(l.unitCost, p.purchasePrice);
  });

  const fld = 'w-16 px-2 py-1.5 rounded-lg text-sm text-center bg-white/5 border border-white/10 text-white';

  // Issue 7 (concurrency review) — onSubmit's caller awaits the actual receivePO
  // write (updates the PO's receivedQty/status AND increments stock) before
  // closing this modal; guard against a double-click receiving the same
  // delivery twice.
  // Phase 4b (PH4-02) — ONE stable receipt id for the life of this form. Every
  // press of "Confirm Receipt" (including a retry after an ambiguous failure)
  // reuses it, so poReceiveDoc's transaction rejects a duplicate delivery. A
  // genuinely separate second receive (a later partial delivery) gets a new form
  // instance and a new id.
  const receiptIdRef = useRef(`rcpt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (saving) return;
    const receivedLines = lines
      .filter((l) => num(l.receiveQty) > 0)
      .map((l) => ({
        partId: l.partId,
        receiveQty: Math.max(0, Math.min(num(l.receiveQty), l.orderedQty - l.alreadyReceived)),
        unitCost: num(l.unitCost),
        updateDefaultPrice: diffLines.some((d) => d.partId === l.partId) ? confirmPriceUpdate : false,
      }));
    setSaving(true);
    await onSubmit?.(receivedLines, receiptIdRef.current);
    setSaving(false);
  };

  // Portal to <body> — same reason as NewPOForm above: escape <main>'s z-10
  // stacking context so the sheet's footer clears the mobile bottom-nav.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl" style={{ background: 'var(--surface-3)', border: '1px solid rgba(var(--fg-rgb),0.1)' }} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between px-5 py-4" style={{ background: 'var(--surface-3)', borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
          <div>
            <h3 className="text-base font-bold text-white">Receive {po.poNumber}</h3>
            <p className="text-[11px] text-white/45 mt-0.5">{po.supplierName}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          {lines.length === 0 ? (
            <p className="text-sm text-white/45 text-center py-6">Nothing left to receive on this PO.</p>
          ) : (
            <>
              <p className="text-xs text-white/45">Quantities default to what’s still outstanding. Reduce a line if this delivery doesn’t include everything — the rest stays open to receive later.</p>
              {lines.map((l) => (
                <div key={l.partId} className="p-2.5 rounded-xl" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white/85 truncate">{l.name}</div>
                      <div className="text-[10px] text-white/45">{l.alreadyReceived > 0 ? `${l.alreadyReceived} of ${l.orderedQty} already received` : `Ordered ${l.orderedQty}`}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <input type="number" min="0" max={l.orderedQty - l.alreadyReceived} value={l.receiveQty} onChange={(e) => setLine(l.partId, 'receiveQty', Math.max(0, Math.min(l.orderedQty - l.alreadyReceived, num(e.target.value))))} className={fld} title="Receive now" />
                      <span className="text-white/45 text-xs">×</span>
                      <input type="number" min="0" value={l.unitCost} onChange={(e) => setLine(l.partId, 'unitCost', e.target.value)} className={fld} title="Actual unit cost" />
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex justify-end text-sm font-semibold text-white/80 pt-1">
                Receiving now: <span className="text-emerald-400 ml-2">{inr(lines.reduce((s, l) => s + num(l.receiveQty) * num(l.unitCost), 0))}</span>
              </div>
              {diffLines.length > 0 && (
                <label className="flex items-start gap-2.5 rounded-xl px-3 py-2.5 cursor-pointer" style={{ background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.25)' }}>
                  <input type="checkbox" checked={confirmPriceUpdate} onChange={(e) => setConfirmPriceUpdate(e.target.checked)} className="mt-0.5 w-4 h-4 flex-shrink-0 accent-[#d4af37]" />
                  <span className="text-xs text-white/75">
                    {diffLines.length === 1 ? "This item's" : `${diffLines.length} items'`} received cost differs from its current default purchase price.
                    <span className="block font-semibold text-white/90 mt-0.5">Update the default purchase price for {diffLines.length === 1 ? 'it' : 'them'}?</span>
                  </span>
                </label>
              )}
            </>
          )}
        </div>
        <div className="sticky bottom-0 flex gap-2 px-5 py-4" style={{ background: 'var(--surface-3)', borderTop: '1px solid rgba(var(--fg-rgb),0.08)' }}>
          <button onClick={onClose} className="flex-1 h-11 rounded-xl text-sm font-semibold bg-white/5 border border-white/10 text-white/70 active:scale-95">Cancel</button>
          <button
            onClick={submit}
            disabled={lines.every((l) => num(l.receiveQty) <= 0) || saving}
            aria-busy={saving}
            className="flex-1 h-11 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] active:scale-95 disabled:opacity-40 flex items-center justify-center gap-1.5"
          ><PackageCheck size={15} /> {saving ? 'Saving…' : 'Confirm Receipt'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
