import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronLeft, ShoppingCart, X, AlertTriangle, PackageX, Boxes, Trash2 } from 'lucide-react';
import MobileFormPage from '../ui/MobileFormPage';
import { useBodyScrollLock } from '../../../hooks/useBodyScrollLock';
import { useDurableOpId } from '../../../hooks/useDurableOpId';
import { readOrCreateOpId } from '../../../lib/durableOpId';
import { formatINR, tsToDate } from '../../../lib/format';
import { useSearchIndex, searchAndRank } from '../../../lib/useSearch';
import { nonNegInt, nonNegNum } from '../../../services/inventoryService';
import DropdownPanel, { ModalBoundaryContext } from '../../common/DropdownPanel';
import MiniSelect from '../../common/MiniSelect';
import BarcodeScanButton from '../../common/BarcodeScanButton';

// Stock-movement modals — sell, manual adjustment, bulk adjustment, bulk receive.
// Extracted verbatim from components/InventoryDashboard.js (Refactor Phase 2 — modal
// extraction). These remain a UI layer: each derives its own durable operation id
// (Phase 5b) and hands it to a parent callback (onConfirm / onSubmit); the container
// still owns the transaction that consumes that id.

// ---------------------------------------------------------------------------
// Checkout modal — sell with bargain-floor (minSellingPrice) lock
// ---------------------------------------------------------------------------
export function CheckoutModal({ part, onConfirm, onClose, isAdmin = false, asPage = false }) {
  useBodyScrollLock(!asPage);
  const mrp = part.sellingPrice || 0;
  const floor = part.minSellingPrice || 0;
  const maxQty = part.stock || 0;
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState(String(mrp || ''));
  const [error, setError] = useState('');
  // Phase 4b (PH4-03) + Phase 5b (PH5-02) — ONE stable sale-operation id for this
  // "sell this part" intent. Stored in sessionStorage (via useDurableOpId) so it
  // SURVIVES A BROWSER REFRESH: handleSell's transaction writes the sale as
  // `sales/{saleOpId}` and no-ops on a repeat, so a reload + retry of the same
  // intent stays exactly-once. `hadPending` = an earlier sale attempt on this part
  // did not confirm before the page went away — warn before the retry.
  const { opId: saleOpId, hadPending: salePending } = useDurableOpId(`sell:${part.id}`, 'sale');

  const blockKeys = (e) => ['e', 'E', '+', '-', '.'].includes(e.key) && e.preventDefault();

  function confirm(override = false) {
    const rawQ = nonNegInt(qty);
    const p = nonNegNum(price); // PH21-01 — finite-guarded: feeds salesRollups revenue via increment()
    if (rawQ < 1) {
      setError('Enter a quantity of at least 1.');
      return;
    }
    if (rawQ > maxQty) {
      setError(`Cannot sell more than available stock (${maxQty}).`);
      return;
    }
    if (!(p > 0)) {
      setError('Enter the final negotiated price.');
      return;
    }
    const q = rawQ;
    // Task 4: below-floor is NOT hard-blocked. Mechanics can't override; owners
    // confirm via "Proceed Anyway", which records the sale at the actual price.
    if (floor > 0 && p < floor && !override) {
      if (!isAdmin) {
        setError(`Below the minimum floor of ${formatINR(floor)}. Only an owner/admin can sell below floor.`);
      }
      return;
    }
    onConfirm(q, p, floor > 0 && p < floor, saleOpId); // 3rd arg = belowFloorOverride, 4th = durable sale-op id
  }

  const fieldLabel = 'block text-[11px] uppercase tracking-wider text-white/45 mb-1.5';
  const fieldInput =
    'w-full px-3 py-2.5 rounded-xl text-sm outline-none bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-[#d4af37]/60 transition';

  const rawQty = nonNegInt(qty);
  const qtyInvalid = rawQty < 1 || rawQty > maxQty; // Issue 2
  const q = Math.max(1, Math.min(rawQty, maxQty || 1));
  const p = nonNegNum(price); // PH21-01
  const belowFloor = floor > 0 && p > 0 && p < floor; // Fix 4: bargain lock

  return (
    <div
      className={asPage ? 'h-[100dvh] flex flex-col overflow-hidden' : 'fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm'}
      style={{ background: asPage ? 'var(--surface-0)' : 'rgba(0,0,0,0.7)' }}
      onClick={asPage ? undefined : (e) => e.target === e.currentTarget && onClose()}
    >
      {/* PH27-01 — asPage is a full-screen phone page. The shell pins the document
          (position:fixed; overflow:hidden) so it can't scroll natively; cap to the
          dynamic viewport and let the body below own the ONE scroll region, or a tall
          checkout (offline / below-floor / error banners, or just the keyboard open
          over the price field) buries "Confirm Sale" off-screen with no way back. */}
      <div
        className={asPage ? 'w-full flex-1 min-h-0 flex flex-col' : 'w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl overflow-hidden backdrop-blur-md'}
        style={asPage ? undefined : { background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }}
      >
        <div
          className={`flex items-center gap-2 px-4 sm:px-5 py-3 sm:py-4 z-10 ${asPage ? 'flex-shrink-0' : 'sticky top-0'}`}
          style={{ background: asPage ? 'var(--surface-1)' : 'transparent', borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}
        >
          {asPage && (
            <button type="button" onClick={onClose} aria-label="Back" className="w-10 h-10 -ml-2 rounded-full flex items-center justify-center text-white/75 active:bg-white/10 transition">
              <ChevronLeft size={24} />
            </button>
          )}
          <div className="flex items-center gap-2 flex-1">
            <ShoppingCart size={18} className="text-[#d4af37]" />
            <h2 className="text-base font-bold text-white">Checkout — Sell Item</h2>
          </div>
          {!asPage && (
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/60 transition"
          >
            <X size={16} />
          </button>
          )}
        </div>

        <div className={asPage ? 'flex-1 min-h-0 overflow-y-auto dark-scroll p-5 space-y-4' : 'p-5 space-y-4'}>
          {salePending && (
            <div role="status" className="rounded-xl p-3 text-xs flex items-start gap-2" style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)', color: '#fbbf24' }}>
              <span aria-hidden>⚠️</span>
              <span>A sale of this part may not have finished before the page reloaded. <b>Check Stock Out first.</b> If you press Confirm Sale again it is safe — a repeat of the same sale is ignored.</span>
            </div>
          )}
          <div className="rounded-xl p-3" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
            <p className="text-sm font-semibold text-white">{part.name}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs">
              <span className="text-white/50">MRP: <span className="text-[#d4af37] font-semibold">{formatINR(mrp)}</span></span>
              <span className="text-white/50">Floor: <span className="text-amber-400 font-semibold">{floor > 0 ? formatINR(floor) : '—'}</span></span>
              <span className="text-white/50">In stock: <span className="text-white/80 font-semibold">{maxQty}</span></span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel}>Quantity</label>
              <input
                type="number"
                min="1"
                max={maxQty}
                step="1"
                value={qty}
                onChange={(e) => { setQty(e.target.value); setError(''); }}
                onKeyDown={blockKeys}
                className={`${fieldInput} ${qtyInvalid ? 'border-red-500/70 focus:border-red-500' : ''}`}
              />
              {rawQty > maxQty && <p className="text-[11px] text-red-400 mt-1">Max {maxQty} in stock.</p>}
            </div>
            <div>
              <label className={fieldLabel}>Final Price / unit (₹)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => { setPrice(e.target.value); setError(''); }}
                onKeyDown={blockKeys}
                placeholder="Negotiated price"
                autoFocus
                className={fieldInput}
              />
            </div>
          </div>

          {belowFloor ? (
            <div className="rounded-xl px-3 py-2.5 space-y-1.5 bg-amber-500/12 border border-amber-500/30">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                <AlertTriangle size={14} /> Below minimum floor price
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-white/60">
                <span>Floor: <span className="text-amber-400 font-semibold">{formatINR(floor)}</span></span>
                <span>Selling: <span className="text-white font-semibold">{formatINR(p)}</span></span>
                <span>Expected loss: <span className="text-red-400 font-semibold">{formatINR(Math.max(0, floor - p) * q)}</span></span>
              </div>
              {!isAdmin && <p className="text-[11px] text-red-400">Only an owner/admin can sell below the floor price.</p>}
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm bg-emerald-500/10 border border-emerald-500/25">
              <span className="text-white/60">Total</span>
              <span className="font-bold text-emerald-400">{formatINR(q * p)}</span>
            </div>
          )}

          {error && (
            <p className="text-xs font-semibold text-red-400 flex items-center gap-1.5">
              <AlertTriangle size={13} /> {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 transition"
            >
              Cancel
            </button>
            {belowFloor && isAdmin ? (
              <button
                onClick={() => confirm(true)}
                disabled={!(p > 0) || qtyInvalid}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white bg-red-500/90 hover:bg-red-500 active:scale-[0.98] transition disabled:opacity-40"
              >
                Proceed Anyway
              </button>
            ) : (
              <button
                onClick={() => confirm(false)}
                disabled={belowFloor || !(p > 0) || qtyInvalid}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] hover:brightness-110 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100"
              >
                {belowFloor ? 'Below Floor — Owner only' : 'Confirm Sale'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task 8: Stock Adjustment — reduce stock for a non-sale reason (damage, loss,
// personal use, manual correction). Recorded separately so analytics can tell
// shrinkage apart from real sales.
// ---------------------------------------------------------------------------
// Issue 7.5 — grouped by WHY stock is changing, not left as one flat 12-item list.
export const ADJUST_REASON_GROUPS = {
  Loss: ['Damage', 'Lost Item', 'Theft', 'Expired'],
  Inventory: ['Stock Count Difference', 'Audit Correction', 'Found', 'Adjustment'],
  Supplier: ['Supplier Return'],
  Internal: ['Personal Use', 'Sample'],
  Transfer: ['Branch Transfer'],
};
export function StockAdjustModal({ part, history = [], onConfirm, onClose, asPage = false }) {
  useBodyScrollLock(!asPage);
  // Issue 7.15 — same class of bug already fixed in RestockModal: this hand-rolled
  // overlay had no ref for its Reason MiniSelect to clamp against, so the dropdown
  // fell back to viewport-boundary math and could escape the modal. See
  // ModalBoundaryContext in components/common/DropdownPanel.jsx.
  const modalRef = useRef(null);
  const maxQty = part.stock || 0;
  const [direction, setDirection] = useState('reduce'); // 'reduce' | 'correction'
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState('Damage');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [correctsId, setCorrectsId] = useState('');
  // Issue 7 (concurrency review) — confirm() calls the parent's ASYNC
  // handleAdjustStock, which only closes this modal after its Firestore writes
  // resolve. Unlike RestockModal (whose writes are fire-and-forget so the modal
  // unmounts synchronously on the first click), that gap left the "Record
  // adjustment" button clickable for the round-trip — a fast double-click could
  // fire two separate stock-adjustment writes for one intended action.
  const [saving, setSaving] = useState(false);
  // Phase 4b (PH4-04) + Phase 5b (PH5-02) — durable adjustment-op id for this
  // "adjust this part's stock" intent; survives a browser refresh so a reload +
  // retry recovers the same id and `stockAdjustments/{opId}` de-duplicates.
  const { opId: adjustOpId, hadPending: adjustPending } = useDurableOpId(`adjust:${part.id}`, 'adj');
  const blockKeys = (e) => ['e', 'E', '+', '-', '.'].includes(e.key) && e.preventDefault();
  const isCorrection = direction === 'correction';

  // Issue 7.6 — a correction can optionally be linked to the specific earlier
  // reduction it's reversing, so the movement history can show "corrects: Damage
  // −5 on 12 Aug" instead of two unrelated-looking entries. Only this part's own
  // reductions (qty < 0) are offered — a correction reverses a reduction, never
  // another correction or a receipt. Newest first, capped so this stays a quick
  // pick rather than a full history browse (that's what Movement History is for).
  const recentReductions = useMemo(
    () => history.filter((h) => h.partId === part.id && (h.qty || h.quantity || 0) < 0)
      .sort((a, b) => (tsToDate(b.createdAt)?.getTime() || 0) - (tsToDate(a.createdAt)?.getTime() || 0))
      .slice(0, 8),
    [history, part.id]
  );
  const correctionTargetOptions = useMemo(() => recentReductions.map((h) => h.id), [recentReductions]);
  const correctionTargetLabels = useMemo(() => {
    const m = {};
    recentReductions.forEach((h) => {
      const d = tsToDate(h.createdAt);
      const qtyAbs = Math.abs(h.qty || h.quantity || 0);
      m[h.id] = `${h.reason || 'Adjustment'} −${qtyAbs}${d ? ` · ${d.toLocaleDateString('en-IN')}` : ''}`;
    });
    return m;
  }, [recentReductions]);
  useEffect(() => { if (!isCorrection) setCorrectsId(''); }, [isCorrection]);

  async function confirm() {
    const q = nonNegInt(qty); // PH21-01 — a 'correction' has no upper bound; must not pass Infinity to increment()
    if (q <= 0) { setError('Enter a quantity of 1 or more.'); return; }
    if (!isCorrection && q > maxQty) { setError(`Only ${maxQty} in stock.`); return; }
    if (saving) return;
    setSaving(true);
    await onConfirm({
      qty: q,
      direction,
      reason: isCorrection ? 'Correction' : reason,
      notes: notes.trim(),
      correctsId: isCorrection ? (correctsId || null) : null,
      opId: adjustOpId,
    });
    setSaving(false);
  }

  const fieldLabel = 'block text-[11px] uppercase tracking-wider text-white/45 mb-1.5';
  const fieldInput = 'w-full px-3 py-2.5 rounded-xl text-sm outline-none bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60 transition';
  const q = nonNegInt(qty); // PH21-01
  const after = isCorrection ? maxQty + q : maxQty - q;

  const inner = (
    <>
          {adjustPending && (
            <div role="status" className="rounded-xl p-3 text-xs flex items-start gap-2" style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)', color: '#fbbf24' }}>
              <span aria-hidden>⚠️</span>
              <span>A stock adjustment for this part may not have finished before the page reloaded. <b>Check Movement History first.</b> Recording it again is safe — a repeat of the same adjustment is ignored.</span>
            </div>
          )}
          {/* Issue 3: direction — reduce (loss) or correction (add stock back) */}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => { setDirection('reduce'); setError(''); }} className={`py-2.5 rounded-xl text-sm font-bold border transition ${!isCorrection ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-white/5 text-white/50 border-white/10'}`}>− Reduce</button>
            <button onClick={() => { setDirection('correction'); setError(''); }} className={`py-2.5 rounded-xl text-sm font-bold border transition ${isCorrection ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-white/5 text-white/50 border-white/10'}`}>+ Correction</button>
          </div>
          <p className="text-xs text-white/50">
            {isCorrection
              ? 'Add stock back to reverse an earlier adjustment that was recorded incorrectly — history is never edited, this adds a new, linked entry.'
              : 'Reduce stock for a reason other than a sale. Recorded separately and not counted as revenue.'}
            {' '}In stock: <span className="text-white/80 font-semibold">{maxQty}</span>
          </p>
          {isCorrection && (
            <div className="rounded-xl px-3 py-2.5 text-[11px] text-emerald-300/80" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
              <span className="font-semibold text-emerald-300/95">Example:</span> recorded Damage: 5, actual damage: 2 → Correction: +3.
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel}>Quantity</label>
              <input type="number" min="1" max={isCorrection ? undefined : maxQty} step="1" value={qty} onChange={(e) => { setQty(e.target.value); setError(''); }} onKeyDown={blockKeys} className={fieldInput} />
            </div>
            <div>
              <label className={fieldLabel}>Reason</label>
              {isCorrection ? (
                <div className={`${fieldInput} flex items-center text-emerald-300/90`}>Correction</div>
              ) : (
                <MiniSelect value={reason} placeholder="Select reason" groups={ADJUST_REASON_GROUPS} onPick={setReason} inputCls={fieldInput} />
              )}
            </div>
          </div>
          {isCorrection && recentReductions.length > 0 && (
            <div>
              <label className={fieldLabel}>Correcting which entry? <span className="text-white/45 normal-case">(optional)</span></label>
              <MiniSelect
                value={correctsId}
                placeholder="Not linked to a specific entry"
                options={correctionTargetOptions}
                labels={correctionTargetLabels}
                onPick={setCorrectsId}
                emptyValue=""
                inputCls={fieldInput}
              />
            </div>
          )}
          {error && <p className="text-xs font-semibold text-red-400 flex items-center gap-1.5"><AlertTriangle size={13} /> {error}</p>}
          <div>
            <label className={fieldLabel}>Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder={isCorrection ? 'e.g. Corrected — only 1 was actually damaged' : 'e.g. Leaked during transport, missing during audit…'}
              className={`${fieldInput} resize-none`}
            />
          </div>
          {q > 0 && (isCorrection || q <= maxQty) && (
            <p className="text-[11px] text-white/45">Stock: <span className="text-white/80 font-semibold">{maxQty} → {after}</span></p>
          )}
          {/* Parts review (Issue 6.3) — an adjustment that crosses the reorder minimum
              is exactly the kind of change the brief calls out as needing visible
              confirmation, not a silent number change. The reason/notes above already
              make this auditable; this makes the CONSEQUENCE visible before confirming. */}
          {!isCorrection && q > 0 && q <= maxQty && after >= 0 && after <= (part.minStock || 5) && (
            <p className="text-[11px] font-semibold text-amber-400 flex items-center gap-1.5">
              <AlertTriangle size={12} /> {after === 0 ? 'This will bring stock to zero.' : `This will drop stock to ${after}, at or below the reorder minimum (${part.minStock || 5}).`}
            </p>
          )}
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-3 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80">Cancel</button>
            <button onClick={confirm} disabled={saving} aria-busy={saving} className="flex-1 py-3 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] active:scale-[0.98] disabled:opacity-60 disabled:cursor-wait">{saving ? 'Saving…' : isCorrection ? 'Record correction' : 'Record adjustment'}</button>
          </div>
    </>
  );

  if (asPage) return <MobileFormPage title={`Adjust stock — ${part.name}`} onClose={onClose}><div className="p-5 space-y-4">{inner}</div></MobileFormPage>;

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={modalRef} data-modal-panel="" className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl max-h-[92vh] overflow-y-auto dark-scroll" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }}>
        <ModalBoundaryContext.Provider value={modalRef}>
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>
            <div className="flex items-center gap-2"><PackageX size={18} className="text-amber-400" /><h2 className="text-base font-bold text-white">Adjust stock — {part.name}</h2></div>
            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/60"><X size={16} /></button>
          </div>
          <div className="p-5 space-y-4">{inner}</div>
        </ModalBoundaryContext.Provider>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Issue 7.13 — Bulk Adjust Stock. Every row keeps its own reason + quantity.
// ---------------------------------------------------------------------------
export function BulkAdjustModal({ parts, onSubmit, onClose }) {
  useBodyScrollLock();
  const modalRef = useRef(null);
  // Phase 4b (PH4-04) — one stable adjustment-op id per row, fixed at mount so a
  // whole-batch retry reuses them (each line is deduped server-side by its opId).
  // Phase 5b — each row's op id is DURABLE (sessionStorage, keyed per part) so a
  // browser refresh + reopening Bulk Adjust recovers the pending ids and the
  // per-part `stockAdjustments/{opId}` marker de-duplicates the retry.
  const [rows, setRows] = useState(() => parts.map((p) => ({ part: p, qty: '1', reason: '', notes: '', opId: readOrCreateOpId(`bulk-adjust:${p.id}`, 'adj') })));
  const updateRow = (partId, patch) => setRows((prev) => prev.map((r) => (r.part.id === partId ? { ...r, ...patch } : r)));
  const removeRow = (partId) => setRows((prev) => prev.filter((r) => r.part.id !== partId));
  const isRowValid = (r) => { const q = parseInt(r.qty, 10) || 0; return q > 0 && q <= (r.part.stock || 0) && !!r.reason; };
  const canSubmit = rows.length > 0 && rows.every(isRowValid);
  // Issue 7 (concurrency review) — onSubmit (handleBulkAdjust) awaits every
  // line's write before this modal closes; guard against a double-click firing
  // the whole batch twice.
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (saving) return;
    setSaving(true);
    await onSubmit(rows.map((r) => ({ part: r.part, qty: parseInt(r.qty, 10) || 0, reason: r.reason, notes: r.notes, opId: r.opId })));
    setSaving(false);
  };

  const fld = 'w-full px-2.5 py-2 rounded-lg text-sm outline-none bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60 transition';

  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }} onClick={onClose}>
      <div ref={modalRef} data-modal-panel="" className="w-full sm:max-w-2xl max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
        <ModalBoundaryContext.Provider value={modalRef}>
          <div className="flex-shrink-0 flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2"><PackageX size={18} className="text-amber-400" /> Bulk Adjust Stock</h3>
              <p className="text-[11px] text-white/45 mt-0.5">Each part keeps its own reason — nothing here is applied to the whole batch at once.</p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/60"><X size={16} /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="space-y-3">
              {rows.map((r) => {
                const q = parseInt(r.qty, 10) || 0;
                const overStock = q > (r.part.stock || 0);
                return (
                  <div key={r.part.id} className="rounded-xl p-3" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-white truncate">{r.part.name}</span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[11px] text-white/45">In stock: {r.part.stock || 0}</span>
                        <button onClick={() => removeRow(r.part.id)} className="w-6 h-6 rounded-lg flex items-center justify-center text-white/45 hover:text-red-400 hover:bg-red-500/10 transition"><X size={12} /></button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <input type="number" min="1" max={r.part.stock || 0} value={r.qty} onChange={(e) => updateRow(r.part.id, { qty: e.target.value })} placeholder="Qty" className={`${fld}${overStock ? ' border-red-500/50' : ''}`} />
                        {overStock && <p className="text-[10px] text-red-400 mt-1">Only {r.part.stock || 0} in stock.</p>}
                      </div>
                      <MiniSelect value={r.reason} placeholder="Reason (required)" groups={ADJUST_REASON_GROUPS} onPick={(v) => updateRow(r.part.id, { reason: v })} inputCls={fld} />
                    </div>
                  </div>
                );
              })}
              {rows.length === 0 && <p className="text-sm text-white/45 text-center py-8">No parts left to adjust.</p>}
            </div>
          </div>
          <div className="flex-shrink-0 flex gap-2.5 px-5 py-4 safe-bottom-pad" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.08)' }}>
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 transition">Cancel</button>
            <button
              onClick={submit}
              disabled={!canSubmit || saving}
              aria-busy={saving}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition ${canSubmit && !saving ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] hover:brightness-110' : 'bg-white/5 text-white/45 cursor-not-allowed'}`}
            >
              {saving ? 'Saving…' : `Adjust ${rows.length} Part${rows.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </ModalBoundaryContext.Provider>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Issue 7.12 — Bulk Receive Stock. A shipment shares ONE supplier + invoice
// reference + delivery date; each line is its own part/qty/unit cost, added
// via the same extended search QuickPickModal uses (name/SKU/OEM/barcode).
// Submits through handleBulkReceive, which loops receiveStockLine — the exact
// same write the single-item RestockModal uses — so nothing here bypasses the
// restock ledger or audit trail.
// ---------------------------------------------------------------------------
export function BulkReceiveModal({ inventory, suppliers = [], onSubmit, onClose }) {
  useBodyScrollLock();
  const modalRef = useRef(null);
  // Issue 4 (Receive Shipment dropdown audit) — Supplier already goes through
  // MiniSelect/DropdownPanel (portal-rendered, boundary-clamped to modalRef via
  // ModalBoundaryContext below, auto-flips near the modal edge). This "Add Part"
  // results list was the one dropdown in this workflow that DIDN'T — it rendered
  // inline in normal document flow, pushing the line-items table down every time
  // it opened instead of floating over it like every other picker in the app.
  // Anchored the same way Supplier already is, for one consistent architecture.
  const pickerAnchorRef = useRef(null);
  const [supplierName, setSupplierName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState([]);
  const [pickerQ, setPickerQ] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const supplierOptions = useMemo(() => suppliers.filter((s) => !s.archived).map((s) => s.name).filter(Boolean), [suppliers]);
  // Universal Search review: same identifier-isolation fix as QuickPickModal's Add Part
  // picker above (byte-for-byte the same bug existed here, as an independent copy) —
  // SKU/OEM No./barcode/Part No. are exact-then-partial via rankIndexed, not one flat
  // substring-matched string.
  const pickerSearchIndex = useSearchIndex(inventory, (p) => p.id, (p) => [p.name], (p) => [p.sku, p.oemNo, p.barcode, p.partNo]);
  const pickerResults = useMemo(() => {
    if (!pickerQ.trim()) return [];
    const available = inventory.filter((p) => !p.archived && !lines.some((l) => l.part.id === p.id));
    return searchAndRank(available, pickerSearchIndex, (p) => p.id, pickerQ).slice(0, 20);
  }, [inventory, pickerQ, lines, pickerSearchIndex]);

  const addLine = (part) => {
    // Phase 4b (PH4-05) — one stable restock-op id per line, fixed when the line is
    // added so a whole-batch retry reuses it (server dedups by opId).
    setLines((prev) => [...prev, { part, qty: 1, unitCost: part.purchasePrice || 0, opId: readOrCreateOpId(`bulk-restock:${part.id}`, 'rs') }]);
    setPickerQ('');
    setPickerOpen(false);
  };
  const updateLine = (partId, patch) => setLines((prev) => prev.map((l) => (l.part.id === partId ? { ...l, ...patch } : l)));
  const removeLine = (partId) => setLines((prev) => prev.filter((l) => l.part.id !== partId));

  // PH21-01 — nonNegInt/nonNegNum: a bulk-receive line feeds the unbounded receive-stock
  // increment, so a pasted over-long digit string must not survive as Infinity.
  const totalUnits = lines.reduce((s, l) => s + nonNegInt(l.qty), 0);
  const totalCost = lines.reduce((s, l) => s + nonNegInt(l.qty) * nonNegNum(l.unitCost), 0);
  const canSubmit = lines.length > 0 && lines.every((l) => nonNegInt(l.qty) > 0);

  const fld = 'w-full px-3 py-2.5 rounded-xl text-sm outline-none bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-[#d4af37]/60 transition';
  const lbl = 'block text-[11px] uppercase tracking-wider text-white/45 mb-1';

  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }} onClick={onClose}>
      {/* Issue 4 (Receive Shipment dropdown audit) — root cause of the cramped Supplier
          list: this modal's height is purely CONTENT-driven (flex-col, no min-height),
          so with zero shipment lines added yet it renders at barely 300px tall even on
          a full-size desktop viewport. The Supplier dropdown correctly clamps its own
          height to THIS modal's boundary (ModalBoundaryContext, below) rather than the
          full viewport — by design, so it never overlaps unrelated page content past
          the modal's edge — but that means a short, empty modal starves the dropdown of
          room it has no real reason to be denied: measured live, a 700px-tall viewport
          left 195px of completely unused space below a 309px modal. The fix is the
          modal's own minimum height, not the dropdown: `min-h-[min(520px,80vh)]` gives
          it sensible headroom from the moment it opens (comfortably fitting the
          MAX_PANEL_H=420 the shared DropdownPanel system already targets) while the
          `80vh` term guarantees it never forces overflow on a short/mobile viewport —
          on a screen where 520px would exceed 80% of the height, the smaller value wins.
          `max-h-[92vh]` (unchanged) still governs the ceiling once real content (several
          shipment lines) makes the modal want to grow taller than that. */}
      <div ref={modalRef} data-modal-panel="" className="w-full sm:max-w-2xl min-h-[min(520px,80vh)] max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
        <ModalBoundaryContext.Provider value={modalRef}>
          <div className="flex-shrink-0 flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
            <h3 className="text-base font-bold text-white flex items-center gap-2"><Boxes size={18} className="text-[#d4af37]" /> Receive Shipment</h3>
            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/60"><X size={16} /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={lbl}>Supplier</label>
                <MiniSelect value={supplierName} placeholder="Select or type a supplier" options={supplierOptions} onPick={setSupplierName} onAdd={() => {}} inputCls={fld} />
              </div>
              <div>
                <label className={lbl}>Invoice / Reference <span className="text-white/45 normal-case">(optional)</span></label>
                <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="e.g. INV-2045" className={fld} />
              </div>
              <div>
                <label className={lbl}>Delivery Date</label>
                <input type="date" value={purchaseDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setPurchaseDate(e.target.value)} className={fld} />
              </div>
            </div>

            <div>
              <label className={lbl}>Add Part</label>
              <div className="flex gap-2" ref={pickerAnchorRef}>
                <div className="relative flex-1 min-w-0">
                  <input
                    value={pickerQ}
                    onChange={(e) => { setPickerQ(e.target.value); setPickerOpen(true); }}
                    onFocus={() => setPickerOpen(true)}
                    placeholder="Search name, SKU, OEM no., barcode…"
                    className={fld}
                  />
                </div>
                <BarcodeScanButton onDetect={(code) => { setPickerQ(code); setPickerOpen(true); }} label="" className="flex items-center justify-center w-11 h-11 rounded-lg bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:border-[#d4af37]/40 transition flex-shrink-0" />
              </div>
              {pickerOpen && pickerQ.trim() && (
                <DropdownPanel anchorRef={pickerAnchorRef} open onClose={() => setPickerOpen(false)} boundaryRef={modalRef} style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }}>
                  {pickerResults.length === 0 ? (
                    <p className="text-xs text-white/45 px-3 py-3">No matching parts.</p>
                  ) : pickerResults.map((p) => (
                    <button key={p.id} onClick={() => addLine(p)} className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 flex items-center justify-between gap-2" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.05)' }}>
                      <span className="truncate">{p.name}</span>
                      <span className="text-[11px] text-white/45 flex-shrink-0">{p.sku || 'no SKU'} · stock {p.stock ?? 0}</span>
                    </button>
                  ))}
                </DropdownPanel>
              )}
            </div>

            {lines.length > 0 && (
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(var(--fg-rgb),0.08)' }}>
                <table className="w-full text-sm">
                  <thead><tr style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                    <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-white/45 font-medium">Part</th>
                    <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider text-white/45 font-medium w-20">Qty</th>
                    <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider text-white/45 font-medium w-28">Unit Cost</th>
                    <th className="w-10" />
                  </tr></thead>
                  <tbody>
                    {lines.map((l) => {
                      // Issue 7.4 — same price-change signal RestockModal shows, kept
                      // read-only here (no per-line "update default?" checkbox — that
                      // decision stays in the focused single-item Receive Stock flow;
                      // a bulk shipment form offering it per row would bury the one
                      // thing this screen exists to make fast).
                      const priceDiffers = nonNegNum(l.unitCost) !== (l.part.purchasePrice || 0) && (l.part.purchasePrice || 0) > 0;
                      return (
                        <tr key={l.part.id} style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.05)' }}>
                          <td className="px-3 py-2">
                            <div className="text-white truncate max-w-[220px]">{l.part.name}</div>
                            <div className="text-[10px] text-white/45">{l.part.sku || 'no SKU'}
                              {priceDiffers && <span className="text-amber-400"> · price differs from default ({formatINR(l.part.purchasePrice)})</span>}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" min="1" value={l.qty} onChange={(e) => updateLine(l.part.id, { qty: e.target.value })} className="w-full px-2 py-1.5 rounded-lg text-sm text-right outline-none bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60" />
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" min="0" step="0.01" value={l.unitCost} onChange={(e) => updateLine(l.part.id, { unitCost: e.target.value })} className="w-full px-2 py-1.5 rounded-lg text-sm text-right outline-none bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60" />
                          </td>
                          <td className="px-2 py-2 text-center">
                            <button onClick={() => removeLine(l.part.id)} className="w-7 h-7 rounded-lg flex items-center justify-center text-white/45 hover:text-red-400 hover:bg-red-500/10 transition"><Trash2 size={13} /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {lines.length > 0 && (
              <div className="rounded-xl px-4 py-2.5 flex items-center justify-between text-sm" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                <span className="text-white/50">{lines.length} part{lines.length === 1 ? '' : 's'} · {totalUnits} units</span>
                <span className="text-[#d4af37] font-semibold">{formatINR(totalCost)}</span>
              </div>
            )}
          </div>
          <div className="flex-shrink-0 flex gap-2.5 px-5 py-4 safe-bottom-pad" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.08)' }}>
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 transition">Cancel</button>
            <button
              onClick={() => onSubmit({ supplierName, invoiceNumber, purchaseDate, lines: lines.map((l) => ({ part: l.part, qty: nonNegInt(l.qty), unitCost: nonNegNum(l.unitCost), opId: l.opId })) })}
              disabled={!canSubmit}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition ${canSubmit ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] hover:brightness-110' : 'bg-white/5 text-white/45 cursor-not-allowed'}`}
            >
              Receive Shipment{lines.length > 0 ? ` (${lines.length})` : ''}
            </button>
          </div>
        </ModalBoundaryContext.Provider>
      </div>
    </div>
  );
}
