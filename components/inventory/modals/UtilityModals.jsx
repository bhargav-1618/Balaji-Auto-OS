import React, { useState, useMemo } from 'react';
import { PackageX, X, ShoppingCart, MessageCircle, AlertTriangle, Phone, ShieldCheck, LogOut, History, ChevronRight } from 'lucide-react';
import { useBodyScrollLock } from '../../../hooks/useBodyScrollLock';
import { formatINR, tsToDate } from '../../../lib/format';
import { buildMovementDetailSections } from '../../../services/inventoryService';
import { LedgerDetailDrawer } from '../../common/LedgerPage';

// Small standalone inventory modals — out-of-stock alternatives, reorder PO router,
// logout confirmation, per-part movement history. Extracted verbatim from
// components/InventoryDashboard.js (Refactor Phase 2 — modal extraction). Pure UI:
// no Firestore, no state ownership beyond local, all data + callbacks come in as props.

// ---------------------------------------------------------------------------
// FEATURE 5: Out-of-stock → alternative-part suggester
// ---------------------------------------------------------------------------
export function AlternativeModal({ part, alternatives, onPick, onClose }) {
  useBodyScrollLock();
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden backdrop-blur-md"
        style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>
          <div className="flex items-center gap-2">
            <PackageX size={18} className="text-red-400" />
            <h2 className="text-base font-bold text-white">Out of Stock</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/60 transition">
            <X size={16} />
          </button>
        </div>

        <div className="p-5">
          <p className="text-sm text-white/60 mb-3">
            <span className="font-semibold text-white">{part.name}</span> is out of stock. Suggested alternatives in <span className="text-[#d4af37]">{part.category || 'this category'}</span>:
          </p>
          {alternatives.length ? (
            <div className="space-y-2">
              {alternatives.map((alt) => (
                <button
                  key={alt.id}
                  onClick={() => onPick(alt)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl text-left transition active:scale-[0.99] bg-white/5 border border-white/10 hover:border-[#d4af37]/40 hover:bg-[#d4af37]/10"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-white truncate">{alt.name}</span>
                    <span className="block text-xs text-white/45">
                      {alt.vehicle || 'Universal'} · {formatINR(alt.sellingPrice)}
                      {alt.locationBin ? ` · ${alt.locationBin}` : ''}
                    </span>
                  </span>
                  <span className="flex items-center gap-1 text-xs font-bold text-emerald-400 flex-shrink-0">
                    {alt.stock} in stock <ShoppingCart size={14} />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-xl px-4 py-6 text-center bg-white/[0.03] border border-white/10">
              <p className="text-sm text-white/45">No in-stock alternatives in this category. Time to reorder.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FIX 2: Reorder PO router — block alert OR pick-a-number micro-modal
// ---------------------------------------------------------------------------
export function ReorderModal({ target, onPick, onClose }) {
  useBodyScrollLock();
  const { part, supplierName, contacts = [], block } = target;
  return (
    <div
      className="fixed inset-0 z-[115] flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-sm rounded-2xl overflow-hidden backdrop-blur-md"
        style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>
          <div className="flex items-center gap-2">
            <MessageCircle size={18} className="text-[#d4af37]" />
            <h2 className="text-base font-bold text-white">{block ? 'Operational Block' : 'Send Purchase Order'}</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/60 transition">
            <X size={16} />
          </button>
        </div>

        {block ? (
          <div className="p-5">
            <div className="flex items-start gap-3 rounded-xl p-3 bg-red-500/10 border border-red-500/25">
              <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-white/80">
                Please assign a supplier with a valid contact record to <span className="font-semibold text-white">{part.name}</span> before generating a purchase order.
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-full mt-4 py-2.5 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] hover:brightness-110 transition"
            >
              Got it
            </button>
          </div>
        ) : (
          <div className="p-5">
            <p className="text-xs text-white/50 mb-3">
              <span className="text-white/80 font-semibold">{supplierName}</span> has multiple contacts. Choose where to send the PO for <span className="text-[#d4af37]">{part.name}</span>:
            </p>
            <div className="space-y-2">
              {contacts.map((c, i) => (
                <button
                  key={`${c.number}-${i}`}
                  onClick={() => onPick(c.number)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl text-left transition active:scale-[0.99] bg-white/5 border border-white/10 hover:border-[#d4af37]/40 hover:bg-[#d4af37]/10"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Phone size={14} className="text-[#d4af37] flex-shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-white truncate">Send to {c.label || 'Contact'}</span>
                      <span className="block text-xs text-white/45">{c.number}</span>
                    </span>
                  </span>
                  <MessageCircle size={16} className="text-emerald-400 flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function LogoutConfirmModal({ onCancel, onConfirm }) {
  useBodyScrollLock();
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        className="w-full max-w-sm rounded-2xl overflow-hidden backdrop-blur-md p-6"
        style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }}
      >
        <div className="flex flex-col items-center text-center gap-3">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(212,175,55,0.12)', border: '1px solid rgba(212,175,55,0.3)' }}
          >
            <ShieldCheck size={26} className="text-[#d4af37]" />
          </div>
          <h2 className="text-lg font-bold text-white">Confirm Logout</h2>
          <p className="text-sm text-white/55">Are you sure you want to securely log out?</p>
        </div>
        <div className="flex gap-3 mt-6">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 transition"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] hover:brightness-110 active:scale-[0.98] transition flex items-center justify-center gap-1.5"
          >
            <LogOut size={15} /> Confirm Logout
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProductLedgerModal({ part, sales, restocks, stockAdjustments, onClose }) {
  useBodyScrollLock();
  // Issue 7.7 — rows used to be plain, non-clickable divs with no way to see the
  // full record (supplier, invoice, PO, reason, who, notes). Now builds the same
  // sections shape the Stock tab's timeline uses (buildMovementDetailSections) and
  // opens the same shared LedgerDetailDrawer — one detail view, not two.
  const [detail, setDetail] = useState(null);
  const correctsLabelFor = (id) => {
    const src = stockAdjustments.find((a) => a.id === id);
    if (!src) return null;
    const qtyAbs = Math.abs(src.qty ?? src.quantity ?? 0);
    const d = tsToDate(src.createdAt);
    return `${src.reason || 'Adjustment'} −${qtyAbs}${d ? ` · ${d.toLocaleDateString('en-IN')}` : ''}`;
  };
  const rows = useMemo(() => {
    const out = [];
    sales.filter((s) => s.partId === part.id).forEach((s) =>
      out.push({ id: 's' + s.id, t: tsToDate(s.createdAt), type: s.source === 'invoice' ? 'Sale (Invoice)' : 'Sale', qty: -(s.qty || 0), note: [s.invoiceNo, s.customer].filter(Boolean).join(' · ') || (s.belowFloor ? 'below floor' : ''), by: s.soldByEmail, sections: buildMovementDetailSections('out', s) }));
    restocks.filter((r) => r.partId === part.id).forEach((r) =>
      out.push({ id: 'r' + r.id, t: tsToDate(r.createdAt), type: 'Purchase', qty: +(r.qty || 0), note: r.supplierName || '', by: r.byEmail, sections: buildMovementDetailSections('in', r) }));
    stockAdjustments.filter((a) => a.partId === part.id).forEach((a) =>
      out.push({ id: 'a' + a.id, t: tsToDate(a.createdAt), type: a.reason || 'Adjustment', qty: a.qty || 0, note: a.notes || '', by: a.byEmail, sections: buildMovementDetailSections('adjust', a, { correctsLabel: a.correctsId ? correctsLabelFor(a.correctsId) : null }) }));
    return out.filter((r) => r.t).sort((a, b) => b.t - a.t);
  }, [part.id, sales, restocks, stockAdjustments]);

  const color = (q) => (q > 0 ? 'text-emerald-400' : 'text-red-400');
  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>
          <div className="flex items-center gap-2"><History size={18} className="text-[#d4af37]" /><h2 className="text-base font-bold text-white">Movement history — {part.name}</h2></div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/60"><X size={16} /></button>
        </div>
        <div className="p-5 max-h-[70vh] overflow-y-auto">
          <p className="text-xs text-white/45 mb-3">Current stock: <span className="text-white/80 font-semibold">{part.stock || 0}</span></p>
          {rows.length === 0 ? (
            <p className="text-sm text-white/45">No recorded movements yet. Sales, goods received, and stock adjustments for this part will appear here.</p>
          ) : (
            <div className="space-y-1.5">
              {rows.map((r) => (
                <button key={r.id} onClick={() => setDetail(r)} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition hover:bg-white/[0.05]" style={{ background: 'rgba(var(--fg-rgb),0.02)', border: '1px solid rgba(var(--fg-rgb),0.05)' }}>
                  <span className={`text-sm font-bold w-12 text-right flex-shrink-0 ${color(r.qty)}`}>{r.qty > 0 ? `+${r.qty}` : r.qty}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-white truncate">{r.type}{r.note && <span className="text-white/45"> · {r.note}</span>}</div>
                    <div className="text-[10px] text-white/45">{r.t.toLocaleString('en-IN')}{r.by ? ` · ${r.by}` : ''}</div>
                  </div>
                  <ChevronRight size={14} className="text-white/20 flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <LedgerDetailDrawer title="Movement" icon={History} detail={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
