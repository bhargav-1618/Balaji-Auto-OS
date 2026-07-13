// components/billing/BillingModule.jsx — invoices with line items, GST, payments.
// Writes back to customers (totalSpent += paid, outstanding += balance) so the
// Customers/Reminders/Dashboard figures stay live. Local persistence per
// workspace (invoices prop + onPersist/onDelete), mirroring Job Cards/Customers.
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { confirmDialog } from '../common/ConfirmDialog';
import { lockBody, unlockBody } from '../Modal';
import { buildQrPayload, makeQrDataUrl, QR_PT } from '../../lib/pdfQr';
import { tsToDate, localDateStr, displayDate , num } from '../../lib/format';
import SearchSelect from '../common/SearchSelect';
import {
  Receipt, Search, Plus, X, FileDown, Trash2, Eye, IndianRupee, Wallet, Clock, ChevronDown, Printer, Send, TrendingUp, FileText, Undo2, Redo2, Check, ChevronLeft, ChevronRight, MoreVertical, Copy, RefreshCw,
  Save,
} from 'lucide-react';

const inr = (n) => `₹${num(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const inputCls = 'w-full px-3 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 text-white placeholder-white/25 outline-none focus:border-[#d4af37]/60 transition';

// Render children into document.body so full-screen overlays (the invoice editor,
// payment sheet, etc.) are never trapped by an ancestor that creates a containing
// block for position:fixed (transform / filter / will-change / contain on any
// parent in the dashboard shell). This is the root-cause fix for the modal
// scrolling with the page and the dashboard header/banner showing through.
// Hoisted to module scope so its component identity is STABLE across parent
// re-renders. When this lived inside InvoiceModal it was redefined on every
// keystroke, so React remounted each row's inputs and focus was lost after one
// character. As a top-level component it mounts once and keeps focus (Excel-like).
function LineRowBase({ l, setLine, delLine, dupLine, moveLine, clearPartLink, inventory, discountEnabled, gstEnabled, defaultGst, priceOverride = true }) {
  const invPart = l.partId ? inventory.find((p) => p.id === l.partId) : null;
  const isLabour = l.kind === 'Labour';
  // BACK-COMPAT: labour lines saved before flat-pricing existed have no `hourly`
  // flag but DO carry an hours value in qty. If we treated those as flat we'd hide
  // the qty field while it silently kept multiplying — the row would read "Rs.600"
  // while actually billing 2 x 600 = Rs.1200. So a labour line is hourly if it says
  // so, OR if its quantity isn't 1 (which can only mean hours were entered).
  const isHourly = isLabour && (l.hourly === true || (l.hourly === undefined && num(l.qty) !== 1));
  // Likewise, an old labour line with GST on it must keep showing its GST field —
  // otherwise the tax is applied but invisible.
  const showTax = !isLabour || l.taxable === true || num(l.gst) > 0;
  const isInvPart = !!l.partId;
  const sku = l.sku || invPart?.sku || '';
  const oem = l.oem || invPart?.oemNo || invPart?.oem || '';
  const rack = l.rack || invPart?.rack || invPart?.location || '';
  const unit = l.unit || invPart?.unit || '';
  const avail = l.availStock != null ? l.availStock : (invPart ? ((invPart.stock || 0) - (invPart.reserved || 0)) : null);
  const qtyExceeds = isInvPart && avail != null && num(l.qty) > avail;
  const belowFloor = l.floorPrice > 0 && num(l.rate) > 0 && num(l.rate) < l.floorPrice;
  // Catalogue price captured when the part was picked. We keep it so reporting can
  // show BOTH the inventory selling price and the price actually billed.
  const listPrice = num(l.listPrice);
  const overridden = isInvPart && listPrice > 0 && Math.abs(num(l.rate) - listPrice) > 0.005;
  const rateEditable = !isInvPart || priceOverride;
  const lineTotal = num(l.qty) * num(l.rate) * (1 - (discountEnabled ? num(l.disc) : 0) / 100);
  const kindLabel = isLabour ? 'Labour' : l.kind === 'Other' ? 'Outside Purchase' : 'Part';

  return (
    <div className="rounded-xl p-2.5" style={{ background: 'rgba(var(--fg-rgb),0.025)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
      {/* Inventory-part identity strip. The part is LINKED (that's what makes stock
          move), but nothing here is read-only — Replace swaps the link, and every
          field below stays editable until the invoice is finalised. */}
      {isInvPart && (
        <div className="flex items-start justify-between gap-2 mb-2 px-0.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] text-white/45">
              {sku && <span>SKU: <span className="text-white/65">{sku}</span></span>}
              {oem && <span>OEM: <span className="text-white/65">{oem}</span></span>}
              {rack && <span>Rack: <span className="text-white/65">{rack}</span></span>}
              {unit && <span>Unit: <span className="text-white/65">{unit}</span></span>}
              {avail != null && <span className={avail > 0 ? 'text-emerald-400/70' : 'text-red-400'}>{avail > 0 ? `${avail} in stock` : 'out of stock'}</span>}
            </div>
          </div>
          <button type="button" onClick={() => clearPartLink?.(l.id)} title="Wrong part? Clear it and search for the correct one" className="text-[10px] font-bold px-2 py-1 min-h-[28px] rounded-lg bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 hover:text-white/85 flex items-center gap-1 flex-shrink-0"><RefreshCw size={11} /> Replace</button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-x-2 gap-y-1.5">
        {/* Description is ALWAYS editable, including for inventory parts — a workshop
            often appends "(rear)" or "x2 set" to the printed line. Editing the text
            does not break the inventory link, so stock still moves correctly. */}
        <label className="flex-1 min-w-[140px]">
          <span className="block text-[9px] uppercase tracking-wide text-white/35 mb-0.5">{isLabour ? 'Service Description' : isInvPart ? 'Part (linked to inventory)' : 'Item Description'}</span>
          <input value={l.desc} onChange={(e) => setLine(l.id, { desc: e.target.value })} placeholder={isLabour ? 'e.g. Engine oil change' : 'Item name'} className={`${inputCls} py-2`} />
        </label>

        {/* Flat-priced services have no quantity — the owner types the charge directly.
            Only show Hours when the line has been explicitly switched to hourly. */}
        {(!isLabour || isHourly) && (
          <label className="w-16">
            <span className="block text-[9px] uppercase tracking-wide text-white/35 mb-0.5">{isLabour ? 'Hours' : 'Qty'}</span>
            <input value={l.qty} inputMode="decimal" onChange={(e) => setLine(l.id, { qty: e.target.value.replace(/[^\d.]/g, '') })} placeholder={isLabour ? 'Hrs' : 'Qty'} className={`${inputCls} py-2 text-center ${qtyExceeds ? 'border-amber-500/60' : ''}`} />
          </label>
        )}

        <label className={isLabour && !isHourly ? 'w-28' : 'w-24'}>
          <span className="block text-[9px] uppercase tracking-wide text-white/35 mb-0.5">{isLabour ? (isHourly ? 'Rate/hr' : 'Amount ₹') : 'Rate'}</span>
          <input value={l.rate} inputMode="decimal" disabled={!rateEditable}
            onChange={(e) => setLine(l.id, { rate: e.target.value.replace(/[^\d.]/g, ''), approvedBelowFloor: false })}
            placeholder="Rate" title={rateEditable ? undefined : 'Price override is disabled in Billing settings'}
            className={`${inputCls} py-2 text-right ${belowFloor && !l.approvedBelowFloor ? 'border-red-500/60' : ''} ${!rateEditable ? 'opacity-60 cursor-not-allowed' : ''}`} />
        </label>

        {discountEnabled && (
          <label className="w-16">
            <span className="block text-[9px] uppercase tracking-wide text-white/35 mb-0.5">Disc %</span>
            <input value={l.disc} inputMode="decimal" onChange={(e) => setLine(l.id, { disc: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0" className={`${inputCls} py-2 text-center`} />
          </label>
        )}

        {/* GST is NOT shown on labour by default — a human service isn't a taxed
            inventory item for most small workshops. It can be enabled per line. */}
        {gstEnabled && showTax && (
          <label className="w-20">
            <span className="block text-[9px] uppercase tracking-wide text-white/35 mb-0.5">GST</span>
            <select value={l.gst != null ? l.gst : defaultGst} onChange={(e) => setLine(l.id, { gst: Number(e.target.value) })} className={`${inputCls} py-2 px-1`}>
              {[[0, 'No GST'], [5, '5%'], [12, '12%'], [18, '18%'], [28, '28%']].map(([g, lbl]) => <option key={g} value={g} style={{ background: '#141414' }}>{lbl}</option>)}
            </select>
          </label>
        )}

        {gstEnabled && showTax && (
          <label className="w-24">
            <span className="block text-[9px] uppercase tracking-wide text-white/35 mb-0.5">{isLabour ? 'SAC' : 'HSN'}</span>
            <input value={l.hsn || ''} onChange={(e) => setLine(l.id, { hsn: e.target.value.replace(/[^0-9]/g, '').slice(0, 8) })} placeholder="Code" className={`${inputCls} py-2`} />
          </label>
        )}

        <div className="ml-auto text-right min-w-[88px]">
          <span className="block text-[9px] uppercase tracking-wide text-white/35 mb-0.5">Total</span>
          <span className="block text-base font-bold text-white pb-1.5">{inr(lineTotal)}</span>
        </div>
      </div>

      {/* Inline notices: stock limit, price override vs catalogue, floor approval. */}
      {(qtyExceeds || belowFloor || overridden) && (
        <div className="flex flex-wrap items-center gap-2 mt-1.5 px-0.5">
          {qtyExceeds && <span className="text-[10px] text-amber-400">Only {avail} in stock — billing {num(l.qty)}.</span>}
          {overridden && (
            <span className="text-[10px] text-white/45">
              Catalogue {inr(listPrice)} → billed {inr(num(l.rate))}
              <button type="button" onClick={() => setLine(l.id, { rate: listPrice, approvedBelowFloor: false })} className="ml-1.5 font-bold text-[#d4af37] hover:underline">reset</button>
            </span>
          )}
          {belowFloor && (l.approvedBelowFloor
            ? <span className="text-[10px] font-bold text-emerald-400">✓ below-floor approved</span>
            : <button type="button" onClick={() => setLine(l.id, { approvedBelowFloor: true })} className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-300">Below floor {inr(l.floorPrice)} — approve</button>)}
        </div>
      )}

      {/* Line actions. Always available while the invoice is editable. */}
      <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-2 px-0.5" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.05)' }}>
        {/* Per-line opt-ins for services: hourly billing and GST are the exception,
            not the default, so they live here rather than cluttering every row. */}
        {isLabour && (
          <>
            <button type="button" onClick={() => setLine(l.id, { hourly: !isHourly, qty: isHourly ? 1 : (num(l.qty) || 1) })} title="Bill this service by the hour instead of a flat charge" className={`text-[10px] px-2.5 py-1.5 min-h-[30px] rounded-lg border ${isHourly ? 'bg-[#d4af37]/15 border-[#d4af37]/30 text-[#d4af37]' : 'bg-white/5 border-white/10 text-white/55 hover:bg-white/10'}`}>{isHourly ? '✓ Hourly' : 'Bill hourly'}</button>
            {gstEnabled && <button type="button" onClick={() => setLine(l.id, { taxable: !showTax, gst: showTax ? 0 : (defaultGst || 18) })} title="Charge GST on this service" className={`text-[10px] px-2.5 py-1.5 min-h-[30px] rounded-lg border ${showTax ? 'bg-[#d4af37]/15 border-[#d4af37]/30 text-[#d4af37]' : 'bg-white/5 border-white/10 text-white/55 hover:bg-white/10'}`}>{showTax ? '✓ GST' : 'Add GST'}</button>}
          </>
        )}
        <button type="button" onClick={() => dupLine?.(l.id)} title="Duplicate this line with all its values" className="text-[10px] px-2.5 py-1.5 min-h-[30px] rounded-lg bg-white/5 border border-white/10 text-white/55 hover:bg-white/10 hover:text-white/80 flex items-center gap-1"><Copy size={10} /> Duplicate</button>
        <span className="text-[10px] text-white/25 ml-1">Move to:</span>
        {l.kind !== 'Part' && <button type="button" onClick={() => moveLine?.(l.id, 'Part')} title="Move to Parts" className="text-[10px] px-2.5 py-1.5 min-h-[30px] rounded-lg bg-white/5 border border-white/10 text-white/55 hover:bg-white/10 hover:text-white/80">Parts</button>}
        {l.kind !== 'Labour' && <button type="button" onClick={() => moveLine?.(l.id, 'Labour')} title="Move to Labour & Services" className="text-[10px] px-2.5 py-1.5 min-h-[30px] rounded-lg bg-white/5 border border-white/10 text-white/55 hover:bg-white/10 hover:text-white/80">Labour</button>}
        {l.kind !== 'Other' && <button type="button" onClick={() => moveLine?.(l.id, 'Other')} title="Move to Outside Purchase" className="text-[10px] px-2.5 py-1.5 min-h-[30px] rounded-lg bg-white/5 border border-white/10 text-white/55 hover:bg-white/10 hover:text-white/80">Outside</button>}
        <span className="text-[9px] text-white/20 ml-1 hidden sm:inline">({kindLabel})</span>
        <button type="button" onClick={() => delLine(l.id)} title="Remove this line from the invoice" className="ml-auto text-[10px] px-2.5 py-1.5 min-h-[30px] rounded-lg text-red-400/70 hover:bg-red-500/10 hover:text-red-400 flex items-center gap-1"><Trash2 size={10} /> Remove</button>
      </div>
    </div>
  );
}

function Portal({ children, lock = false }) {
  const [el] = useState(() => (typeof document !== 'undefined' ? document.createElement('div') : null));
  useEffect(() => {
    if (!el) return undefined;
    el.setAttribute('data-billing-portal', '');
    document.body.appendChild(el);
    return () => { try { document.body.removeChild(el); } catch {} };
  }, [el]);
  // Full-screen modals must freeze the page behind them, otherwise the wheel/touch
  // scrolls the dashboard underneath and the modal feels "stuck". Uses the ONE
  // shared reference-counted lock (components/Modal.js) so stacked modals nest
  // correctly. Opt-in: the row-actions dropdown portals too but must not lock.
  useEffect(() => {
    if (!lock) return undefined;
    const t = lockBody();
    return () => unlockBody(t);
  }, [lock]);
  if (!el) return null;
  return createPortal(children, el);
}
const cardStyle = { background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' };

// Row actions dropdown that renders in a Portal with fixed positioning computed
// from the trigger's rect. It flips upward when there isn't room below, clamps to
// the viewport horizontally, closes on outside-click / Escape / scroll / resize,
// and sits at the highest z-index so it is never clipped by the table's overflow
// container or hidden under the page — the "menu opens underneath" bug.
function RowActionsMenu({ items }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const [pos, setPos] = useState(null);
  const place = () => {
    const b = btnRef.current?.getBoundingClientRect(); if (!b) return;
    const vw = window.innerWidth;
    const vh = window.visualViewport?.height || window.innerHeight; // keyboard-aware
    // Menu never wider than the screen (small phones) and never taller than the
    // visible viewport (short screens / keyboard open).
    const MENU_W = Math.min(200, vw - 16);
    const itemH = 34;
    const MENU_H = Math.min(items.length * itemH + 8, vh - 16);
    const spaceBelow = vh - b.bottom;
    const flipUp = spaceBelow < MENU_H + 12 && b.top > MENU_H + 12;
    let left = b.right - MENU_W; // right-align to the trigger
    left = Math.max(8, Math.min(left, vw - MENU_W - 8));
    let top = flipUp ? b.top - MENU_H - 6 : b.bottom + 6;
    top = Math.max(8, Math.min(top, vh - MENU_H - 8)); // never off-screen either way
    setPos({ top, left, width: MENU_W, maxHeight: MENU_H });
  };
  const toggle = (e) => { e.stopPropagation(); if (!open) place(); setOpen((o) => !o); };
  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); document.removeEventListener('click', close); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <>
      <button ref={btnRef} onClick={toggle} title="More actions" className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/55 hover:bg-white/10"><MoreVertical size={13} /></button>
      {open && pos && (
        <Portal>
          <div onClick={(e) => e.stopPropagation()} className="fixed z-[200] rounded-xl p-1 shadow-2xl overflow-y-auto overscroll-contain dark-scroll" style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight, background: 'var(--surface-1)', border: '1px solid rgba(var(--fg-rgb),0.14)' }}>
            {items.map(([label, Icon, on, danger]) => (
              <button key={label} onClick={() => { setOpen(false); on(); }} className={`w-full flex items-center gap-2.5 px-3 py-2.5 min-h-[36px] rounded-lg text-xs hover:bg-white/5 ${danger ? 'text-red-400' : 'text-white/75'}`}><Icon size={13} /> {label}</button>
            ))}
          </div>
        </Portal>
      )}
    </>
  );
}

const SHOP = {
  name: 'SRI BABA BALAJI MARUTI CARE', tag: 'PREMIUM AUTOMOTIVE SERVICE & DIAGNOSTICS',
  phones: '98665 71263 | 98661 23631', gst: '37XXXXX0000X1Z5',
  address: 'Door No. 7-10-38/3, NH16, Old Gajuwaka, Andhra Pradesh 530026',
};
// 🔴 GST Rule 46(b): a tax invoice must carry a UNIQUE, CONSECUTIVE serial number.
//
// The previous implementation stripped ALL non-digits from every document number, so
// INV / EST / DRF shared one number space:
//     existing: INV-0009, EST-0012, DRF-0020   ->   next INV = INV-0021
// Estimates and drafts were INFLATING the legal tax-invoice sequence, jumping it from
// 0009 straight to 0021. A GST audit reads that as 11 missing invoices.
//
// Each prefix now owns its own independent sequence, so INV numbers stay consecutive no
// matter how many estimates or drafts are raised.
//
// NOTE — this is still a CLIENT-SIDE max. Two counters billing in the same moment can
// still both compute INV-0010 (see the duplicate guard in save(), which catches the
// collision on write). A truly gap-free, collision-proof sequence requires a server-side
// counter (a Firestore transaction on a `counters/invoices` doc). That is flagged as the
// #1 v1.0 blocker in the audit report — it cannot be fixed correctly on the client alone.
const nextInvNo = (list, prefix = 'INV') => {
  const px = String(prefix || 'INV').toUpperCase();
  const highest = (list || []).reduce((max, i) => {
    const no = String(i.invNo || '');
    // ONLY consider documents sharing this exact prefix.
    const m = no.match(/^([A-Za-z]+)-(\d+)$/);
    if (!m || m[1].toUpperCase() !== px) return max;
    return Math.max(max, parseInt(m[2], 10) || 0);
  }, 0);
  return `${px}-${String(highest + 1).padStart(4, '0')}`;
};
// Labour/service lines are FLAT-PRICED by default: a garage owner bills
// "Water Wash 500", not 1.5 hours x Rs.333. `hourly: false` means qty is pinned to
// 1 and only the amount is entered. GST defaults to 0 on labour because most small
// Indian workshops don't charge GST on labour (they can still turn it on per line).
// Monotonic, collision-proof line ids. `Date.now()` + a 4-digit random could collide
// when two lines are created in the same millisecond (easy with a fast Duplicate
// click) — duplicate React keys then make edits land on the wrong row.
let __lineSeq = 0;
const newLineId = () => `l_${Date.now().toString(36)}_${(++__lineSeq).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
const emptyLine = (kind = 'Service') => ({
  id: newLineId(),
  desc: '', qty: 1, rate: 0, disc: 0,
  gst: kind === 'Labour' ? 0 : 18,
  hourly: false,
  kind,
});
const emptyPayment = () => ({ id: `p_${Date.now()}_${Math.floor(Math.random() * 1e4)}`, mode: 'Cash', amount: 0, ref: '', at: Date.now() });
// The services an Indian workshop bills every day. One tap adds the line; the owner
// then types the charge. Saves retyping "General Servicing" a hundred times a week.
const COMMON_SERVICES = [
  'General Servicing', 'Water Wash', 'Oil Change Labour', 'Wheel Alignment', 'Wheel Balancing',
  'AC Service', 'AC Gas Filling', 'Denting', 'Painting', 'Polishing',
  'Electrical Repair', 'Scanning / Diagnostics', 'Brake Service', 'Battery Installation', 'Pickup & Drop',
];
const PAYMENT_MODES = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Cheque', 'Credit', 'Wallet'];
const LABOUR_CATEGORIES = ['General Service', 'Engine', 'Electrical', 'AC', 'Painting', 'Body Shop', 'Wheel Alignment', 'Suspension', 'Accessories', 'Custom'];
const INV_STATUSES = ['Draft', 'Estimate', 'Invoice', 'Partially Paid', 'Paid', 'Cancelled', 'Refunded', 'Returned'];
const statusColor = (s) => ({ Draft: '#9ca3af', Estimate: '#a78bfa', 'Estimate Sent': '#818cf8', Invoice: '#60a5fa', Unpaid: '#f87171', Pending: '#f87171', 'Partially Paid': '#fbbf24', Partial: '#fbbf24', Paid: '#34d399', Cancelled: '#9ca3af', Refunded: '#fb923c', Returned: '#f472b6' }[s] || '#9ca3af');
const emptyInvoice = () => ({
  id: `inv_${Date.now()}_${Math.floor(Math.random() * 1e4)}`, invNo: '', date: localDateStr(),
  customerId: '', customer: '', phone: '', email: '', gstNo: '', address: '',
  vehicle: '', regNo: '', vin: '', engineNo: '', odometer: '',
  jobCardId: '', jobNo: '', advisor: '', technician: '',
  gstPct: 18, gstMode: 'auto', discount: 0, discountType: 'flat',
  lines: [emptyLine('Part')], payments: [], paid: 0, status: 'Draft', isEstimate: false, estimateValidTill: '', notes: '', terms: '',
  history: [], createdAt: Date.now(),
});

function Field({ label, children, className = '' }) {
  return <div className={`min-w-0 ${className}`}><label className="block text-[10px] uppercase tracking-wide text-white/40 mb-1.5">{label}</label>{children}</div>;
}
function Stat({ icon: Icon, label, value, color }) {
  return (
    <div className="rounded-2xl p-3.5 flex items-center gap-3" style={cardStyle}>
      <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${color}1f`, color }}><Icon size={18} /></span>
      <div className="min-w-0"><p className="text-[10px] uppercase tracking-wide text-white/40 truncate">{label}</p><p className="text-lg font-bold text-white leading-tight">{value}</p></div>
    </div>
  );
}

const totalsOf = (inv) => {
  const lines = inv.lines || [];
  // Per-line: amount after line discount; GST computed per line when line.gst present,
  // else falls back to the invoice-level gstPct (backward compatible).
  let sub = 0, lineGst = 0, cost = 0;
  lines.forEach((l) => {
    const gross = num(l.qty) * num(l.rate);
    const lineDisc = l.disc ? gross * (num(l.disc) / 100) : 0;
    const net = Math.max(0, gross - lineDisc);
    sub += net;
    const rate = l.gst != null ? num(l.gst) : num(inv.gstPct);
    lineGst += net * (rate / 100);
    cost += num(l.purchasePrice) * num(l.qty);
  });
  // Invoice-level discount (flat ₹ or %) applied on subtotal.
  const invDisc = inv.discountType === 'percent' ? sub * (num(inv.discount) / 100) : num(inv.discount);
  const afterDisc = Math.max(0, sub - invDisc);
  // If any line carried its own GST we use the summed line GST; otherwise invoice gstPct.
  const anyLineGst = lines.some((l) => l.gst != null);
  let gst = anyLineGst ? lineGst * (afterDisc / (sub || 1)) : afterDisc * (num(inv.gstPct) / 100);
  if (inv.gstMode === 'exempt') gst = 0; // GST is optional — exempt zeroes all tax
  const isIgst = inv.gstMode === 'igst';
  const grandRaw = afterDisc + gst;
  const grand = Math.round(grandRaw);
  const roundOff = grand - grandRaw;
  // Payments are the SINGLE SOURCE OF TRUTH. An invoice is only ever "paid" to the
  // extent that real payment entries exist for it.
  //
  // The legacy `inv.paid` scalar used to be a fallback here, and that was a genuine
  // money bug: any invoice carrying a stale/imported `paid` value with no payment
  // rows would derive as "Paid" on its own — which then locked the invoice AND
  // deducted stock, with no one having collected anything. We now only fall back to
  // `inv.paid` for a legacy record that has never had payments recorded AND is
  // explicitly flagged as such, so a new invoice can never self-declare as paid.
  const hasPayments = Array.isArray(inv.payments) && inv.payments.length > 0;
  const legacyPaid = !hasPayments && inv.legacyPaid === true ? num(inv.paid) : 0;
  const paid = hasPayments ? inv.payments.reduce((s, p) => s + num(p.amount), 0) : legacyPaid;
  const balance = Math.max(0, grand - paid);
  const profit = afterDisc - cost;
  const partsRev = lines.filter((l) => l.kind === 'Part').reduce((s, l) => s + num(l.qty) * num(l.rate), 0);
  const labourRev = lines.filter((l) => l.kind === 'Labour').reduce((s, l) => s + num(l.qty) * num(l.rate), 0);
  // 💰 ROUND MONEY TO PAISA AT THE BOUNDARY.
  //
  // Binary floating point cannot represent 0.1, so these values arrive as things like
  // 59.999399999999994 and were being handed straight to the invoice, the PDF and the
  // GSTR-1 export. A tax invoice must state tax to 2 decimal places; printing
  // ₹29.999699999999997 as CGST is not a legal figure, and summing unrounded values
  // across a month makes the filed return disagree with the books by a few paise —
  // which is exactly what a GST reconciliation flags.
  //
  // CGST/SGST are halved from a rounded total and the remainder is pushed onto CGST, so
  // cgst + sgst === gst EXACTLY. Otherwise a ₹0.01 split error appears on odd amounts.
  const p2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
  const gstR = p2(gst);
  const halfS = p2(gstR / 2);              // SGST takes the clean half
  const halfC = p2(gstR - halfS);          // CGST absorbs the odd paisa
  return {
    sub: p2(sub), afterDisc: p2(afterDisc), gst: gstR,
    cgst: isIgst ? 0 : halfC,
    sgst: isIgst ? 0 : halfS,
    igst: isIgst ? gstR : 0,
    isIgst, grand, roundOff: p2(roundOff),
    balance: p2(balance), paid: p2(paid), profit: p2(profit), cost: p2(cost),
    partsRev: p2(partsRev), labourRev: p2(labourRev),
  };
};
const deriveStatus = (inv) => {
  if (inv.status === 'Cancelled' || inv.status === 'Refunded' || inv.status === 'Returned') return inv.status;
  if (inv.isEstimate) return 'Estimate';
  const t = totalsOf(inv);
  if (t.balance <= 0 && t.grand > 0) return 'Paid';
  if (t.paid > 0) return 'Partially Paid';
  return inv.status === 'Draft' ? 'Draft' : 'Unpaid';
};

function CustomerPicker({ customers, value, onPick }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useEffect(() => { if (!open) return undefined; const d = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', d); return () => document.removeEventListener('mousedown', d); }, [open]);
  const shown = useMemo(() => { const l = q.trim().toLowerCase(); return (l ? customers.filter((c) => [c.name, c.phone, c.code].filter(Boolean).join(' ').toLowerCase().includes(l)) : customers).slice(0, 40); }, [q, customers]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className={`${inputCls} flex items-center justify-between text-left`}>
        <span className={value ? 'text-white' : 'text-white/25'}>{value || 'Select customer…'}</span><ChevronDown size={14} className="text-white/35" />
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-full rounded-xl overflow-hidden shadow-2xl" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }}>
          <div className="relative p-2" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.07)' }}>
            <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / phone…" className="w-full pl-8 pr-2 py-2 rounded-lg text-sm bg-white/5 border border-white/10 text-white placeholder-white/25 outline-none" />
          </div>
          <div id="cust-list" role="listbox" className="max-h-56 overflow-y-auto overscroll-contain dark-scroll">
            {shown.map((c) => (
              <button key={c.id} type="button" onClick={() => { onPick(c); setOpen(false); setQ(''); }} className="w-full text-left px-3 py-2 hover:bg-white/5">
                <p className="text-sm text-white/85">{c.name}</p><p className="text-[10px] text-white/40">{c.code} · {c.phone}</p>
              </button>
            ))}
            {shown.length === 0 && <p className="px-3 py-3 text-xs text-white/40">No customers. Add them in the Customers tab.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, sub, children, defaultOpen = true, badge }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-4 py-2.5 text-left">
        <span className="flex items-center gap-2"><span className="text-sm font-bold text-white/85">{title}</span>{badge != null && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#d4af37]/15 text-[#d4af37] font-bold">{badge}</span>}{sub && <span className="text-[11px] text-white/40">{sub}</span>}</span>
        <ChevronDown size={16} className={`text-white/40 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function InvoiceModal({ initial, invoices, customers, inventory, jobCards = [], onSave, onClose, demoMode, onQuickCustomer, onQuickVehicle, onDownloadPDF, onDuplicate, onCreditNote }) {
  // Billing settings (admin-controlled): GST & discount can be switched off entirely.
  const billingCfg = useMemo(() => { try { return JSON.parse(localStorage.getItem('maruti_settings') || '{}'); } catch { return {}; } }, []);
  const gstEnabled = billingCfg.gstOptional !== false; // default on; admin can disable
  const discountEnabled = billingCfg.discountOptional !== false;
  // Rate override on inventory parts. Default ON: an Indian workshop routinely bills
  // a part above/below its catalogue price (negotiation, old stock, loyal customer).
  // The catalogue price is preserved on the line as `listPrice` so reporting can
  // show BOTH the original selling price and what was actually billed.
  const priceOverride = billingCfg.priceOverride !== false;
  const defaultGst = billingCfg.defaultTax !== undefined && billingCfg.defaultTax !== '' ? Number(billingCfg.defaultTax) : 18;
  const DRAFT_KEY = `maruti_invoice_draft_${initial.id}`;
  const restoredRef = useRef(false);
  const [inv, setInvRaw] = useState(() => {
    // Restore an autosaved draft for brand-new invoices. localStorage (not session)
    // so the draft survives a browser crash, tab close or machine restart — real
    // workshops get interrupted constantly and shouldn't lose a half-built bill.
    if (!initial.invNo) {
      try {
        const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
        if (d && d.id === initial.id) { restoredRef.current = true; return d; }
      } catch {}
    }
    return initial;
  });
  useEffect(() => { if (restoredRef.current) toast('Unsaved draft restored.', { icon: '📝' }); }, []);
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const [, force] = useState(0);
  const setInv = (updater) => {
    setInvRaw((prev) => {
      undoStack.current.push(prev);
      if (undoStack.current.length > 50) undoStack.current.shift();
      redoStack.current = [];
      return typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
    });
  };
  const undo = () => { if (!undoStack.current.length) return; setInvRaw((cur) => { redoStack.current.push(cur); return undoStack.current.pop(); }); force((x) => x + 1); };
  const redo = () => { if (!redoStack.current.length) return; setInvRaw((cur) => { undoStack.current.push(cur); return redoStack.current.pop(); }); force((x) => x + 1); };
  // Warn on close if there are unsaved edits (any edit pushes onto the undo stack).
  const guardedClose = async () => {
    const dirty = undoStack.current.length > 0 && JSON.stringify(inv) !== JSON.stringify(initial);
    if (dirty) {
      const ok = await confirmDialog({ title: 'Discard unsaved changes?', message: 'This invoice has changes that haven’t been saved.', confirmText: 'Discard', cancelText: 'Keep editing', danger: true });
      if (!ok) return;
    }
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    onClose();
  };
  const set = (patch) => setInv((s) => ({ ...s, ...patch }));
  const [partQ, setPartQ] = useState('');
  const [replaceFor, setReplaceFor] = useState(null); // line id awaiting a new part
  const partSearchRef = useRef(null);
  const setLine = (id, patch) => setInv((s) => ({ ...s, lines: s.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const addLine = (kind, desc = '') => set({ lines: [...inv.lines, { ...emptyLine(kind), desc }] });
  const delLine = (id) => {
    const gone = inv.lines.find((x) => x.id === id);
    const rest = inv.lines.filter((x) => x.id !== id);
    // Remove ALWAYS works (previously it silently refused on the last line). If that
    // empties the invoice completely, drop a fresh blank row in so the user still has
    // somewhere to type — an editor with zero rows is a dead end.
    set({ lines: rest.length ? rest : [emptyLine(gone?.kind || 'Part')] });
  };
  // Duplicate a line in place (common when billing 2 of the same job/part variant).
  const dupLine = (id) => set({
    lines: inv.lines.flatMap((l) => (l.id === id ? [l, { ...l, id: newLineId() }] : [l])),
  });
  // Move a line between Parts / Labour / Outside Purchase without retyping it.
  // Moving OUT of Parts drops the inventory link (so it stops touching stock);
  // a line can only become a true inventory Part by picking it from the search.
  const moveLine = (id, kind) => {
    const l = inv.lines.find((x) => x.id === id); if (!l) return;
    // Moving INTO Parts is only meaningful for a real inventory item. A line with
    // kind='Part' but no partId would be counted as Parts revenue with ZERO cost —
    // i.e. reported at 100% margin — silently corrupting profit. So we don't allow
    // a bare "make this a part" move; the user picks the item from inventory, which
    // links it properly (and makes it move stock).
    if (kind === 'Part' && !l.partId) {
      clearPartLink(id);
      toast('Pick the item from inventory so stock and cost are tracked.', { icon: '🔍' });
      return;
    }
    const patch = { kind };
    if (kind !== 'Part') {
      // Leaving Parts drops the inventory link so the line stops touching stock.
      patch.partId = null; patch.sku = ''; patch.oem = ''; patch.rack = '';
      patch.availStock = null; patch.floorPrice = 0; patch.purchasePrice = 0;
      patch.listPrice = 0; patch.approvedBelowFloor = false;
    }
    if (kind === 'Labour') { patch.hourly = false; patch.qty = 1; } // services are flat-priced
    setLine(id, patch);
    toast.success(`Moved to ${kind === 'Other' ? 'Outside Purchase' : kind === 'Labour' ? 'Labour & Services' : 'Parts'}`);
  };
  // Clear a wrongly-picked inventory part from a line, keeping the row so the user
  // can immediately search and pick the correct one (no need to delete the invoice).
  // "Replace": keep the row, arm it to receive the next part picked from the search,
  // and jump the cursor into the search box. The row's qty is preserved. Picking a
  // part while armed swaps it in place (see addPartFromInventory).
  const clearPartLink = (id) => {
    setReplaceFor(id);
    setPartQ('');
    setTimeout(() => partSearchRef.current?.focus(), 30);
    toast('Search and pick the replacement part.', { icon: '🔍' });
  };
  // Add a part from inventory, capturing its full metadata onto the line so the row
  // (and its expanded detail) can show SKU/OEM/stock/rack/unit without re-lookup.
  // If the same part is already on the invoice, just increment its quantity.
  // Build the inventory-linked line data for a catalogue part. `listPrice` records
  // the catalogue selling price at the moment of billing, so a rate override is
  // always reportable as "catalogue X -> billed Y" and the inventory price itself
  // is never mutated.
  const partLineData = (p) => ({
    desc: p.name,
    rate: num(p.defaultSellingPrice || p.sellingPrice || p.purchasePrice),
    listPrice: num(p.defaultSellingPrice || p.sellingPrice),
    partId: p.id,
    sku: p.sku || '',
    oem: p.oemNo || p.oem || '',
    rack: p.rack || p.location || '',
    unit: p.unit || '',
    hsn: p.hsn || '',
    floorPrice: num(p.minSellingPrice),
    purchasePrice: num(p.purchasePrice),
    mrp: num(p.mrp || p.sellingPrice),
    availStock: (p.stock || 0) - (p.reserved || 0),
    gst: Number(p.gst) || 18,
    approvedBelowFloor: false,
  });
  const addPartFromInventory = (p) => {
    // Replace mode: a row asked for a new part -> swap this row's part in place,
    // keeping the row (and its qty/disc) rather than deleting and recreating it.
    if (replaceFor) {
      const target = inv.lines.find((l) => l.id === replaceFor);
      setLine(replaceFor, { ...partLineData(p), kind: 'Part', qty: target?.qty || 1 });
      setReplaceFor(null);
      toast.success(`Replaced with ${p.name}`);
      return;
    }
    const existing = inv.lines.find((l) => l.partId === p.id && l.kind === 'Part');
    if (existing) { setLine(existing.id, { qty: (Number(existing.qty) || 0) + 1 }); toast.success(`${p.name} qty +1`); return; }
    const line = {
      ...emptyLine('Part'),
      ...partLineData(p),
      qty: 1,
    };
    set({ lines: [...inv.lines.filter((l) => l.desc.trim() || l.rate), line] });
  };
  const t = totalsOf(inv);
  // Smart-action state: is there anything worth saving, and is it fully paid?
  const hasBillItems = inv.lines.some((l) => l.desc.trim() && num(l.rate) > 0);
  const canSave = !!(inv.customer && inv.customer.trim()) && hasBillItems;
  const fullyPaid = t.balance <= 0.5 && t.grand > 0;
  // A saved, fully-paid (or cancelled/refunded) invoice is locked — read-only
  // history. Estimates and unpaid/partially-paid invoices stay editable.
  const savedStatus = inv.invNo ? deriveStatus(inv) : null;
  const locked = !inv.isEstimate && !!inv.invNo && ['Paid', 'Cancelled', 'Refunded', 'Returned'].includes(savedStatus);
  const [newCust, setNewCust] = useState(null); // {name,phone,email,gst} when adding inline
  const [newVeh, setNewVeh] = useState(null); // {regNo,make,model,fuel} when adding inline
  // Show a generous result set — the dropdown is scrollable (max-h + overflow-y),
  // so capping at a handful was hiding valid matches. 50 keeps it fast while making
  // "no hidden items" true in practice for a workshop's catalogue.
  const parts = useMemo(() => { const l = partQ.trim().toLowerCase(); if (l.length < 2) return []; return inventory.filter((p) => !p.archived && [p.name, p.sku, p.oemNo, p.barcode].filter(Boolean).join(' ').toLowerCase().includes(l)).slice(0, 50); }, [partQ, inventory]);
  const [partHi, setPartHi] = useState(0); // keyboard-highlighted index
  useEffect(() => { setPartHi(0); }, [partQ]);
  // Customer lookup must reach EVERY customer, not a truncated slice. It also has to
  // match on the vehicle — a workshop identifies a customer by their number plate far
  // more often than by name. Searching therefore covers name, phone, customer code AND
  // every registration number / make / model on the customer's vehicles.
  // We only cap the RENDERED list (for DOM performance); a search always scans the
  // full customer set, so no customer is ever unreachable.

  // ALL vehicles for the selected customer. Matching only on customerId meant that a
  // customer resolved by phone/name (or re-opened from a saved invoice, where the id may
  // not round-trip) showed ZERO vehicles. Never truncate this list.
  const custVehicles = useMemo(() => {
    const phone = (inv.phone || '').replace(/\D/g, '').slice(-10);
    const name = (inv.customer || '').trim().toLowerCase();
    const c = customers.find((x) => (inv.customerId && x.id === inv.customerId))
      || customers.find((x) => phone && (x.phone || '').replace(/\D/g, '').slice(-10) === phone)
      || customers.find((x) => name && (x.name || '').trim().toLowerCase() === name);
    return c ? (c.vehicles || []) : [];
  }, [customers, inv.customerId, inv.phone, inv.customer]);
  // Job cards for the selected customer.
  // Matching on PHONE ALONE was too brittle: a customer with no phone on file, or a
  // job card whose phone was typed with +91/spaces, matched nothing — so the dropdown
  // looked empty even though the cards existed. Match on any strong identifier, and
  // only offer cards that are actually billable (not already closed/cancelled).
  const BILLABLE_JC = ['Received', 'Inspection', 'Estimate Ready', 'Estimate Approved', 'Waiting Parts', 'Repair Started', 'Repair Paused', 'Quality Check', 'Wash', 'Ready'];
  const custJobCards = useMemo(() => {
    const phone = (inv.phone || '').replace(/\D/g, '').slice(-10);
    const cust = (inv.customer || '').trim().toLowerCase();
    const reg = (inv.regNo || '').replace(/\s/g, '').toUpperCase();
    const billable = jobCards.filter((j) => !j.status || BILLABLE_JC.includes(j.status));
    // No customer chosen yet -> offer EVERY billable job card, so the advisor can search
    // by job number / reg no and have it pull the customer in. Previously this returned
    // [] and the dropdown was simply dead until a customer was picked.
    if (!phone && !cust && !reg) return billable;
    return jobCards.filter((j) => {
      if (j.status && !BILLABLE_JC.includes(j.status)) return false;   // closed/cancelled/delivered
      const jPhone = (j.phone || '').replace(/\D/g, '').slice(-10);
      const jCust = (j.customer || '').trim().toLowerCase();
      const jReg = (j.regNo || '').replace(/\s/g, '').toUpperCase();
      return (phone && jPhone && jPhone === phone)
        || (reg && jReg && jReg === reg)
        || (cust && jCust && jCust === cust);
    });
  }, [jobCards, inv.phone, inv.customer, inv.regNo]);

  // Keep the highlight inside the list whenever the results change.

  const pickCustomer = (c) => {
    const v = (c.vehicles || [])[0] || {};
    set({ customerId: c.id, customer: c.name, phone: c.phone, email: c.email || '', gstNo: c.gst || '', address: c.address || '',
      vehicle: v.vehicle || v.model || '', regNo: v.regNo || '', vin: v.vin || '', engineNo: v.engineNo || '' });
  };
  const pickVehicle = (v) => set({
    vehicleId: v.id || '',
    vehicle: [v.brand, v.model, v.variant].filter(Boolean).join(' ') || v.vehicle || v.model || '',
    regNo: v.regNo || v.reg || '', vin: v.vin || '', engineNo: v.engineNo || '',
    odometer: v.odometer || '', fuel: v.fuel || '',
  });
  // Inline "New Customer": create instantly via parent, auto-select, keep editing.
  const saveNewCustomer = () => {
    if (!newCust?.name?.trim()) return toast.error('Customer name required.');
    if (newCust.phone && !/^\d{10}$/.test(newCust.phone)) return toast.error('Enter a valid 10-digit number.');
    if (!onQuickCustomer) return toast.error('Cannot create customer here.');
    const c = onQuickCustomer({ name: newCust.name.trim(), phone: newCust.phone || '', email: newCust.email || '', gst: newCust.gst || '' });
    if (c) { set({ customerId: c.id, customer: c.name, phone: c.phone, email: c.email || '', gstNo: c.gst || '' }); setNewCust(null); toast.success(`Added ${c.name}`); }
  };
  // Inline "Add Vehicle": create under the selected customer, auto-select onto invoice.
  const saveNewVehicle = () => {
    if (!inv.customerId) return toast.error('Select a customer first.');
    if (!newVeh?.regNo?.trim()) return toast.error('Registration number required.');
    if (!onQuickVehicle) return toast.error('Cannot add vehicle here.');
    const v = onQuickVehicle(inv.customerId, { regNo: newVeh.regNo.toUpperCase().trim(), make: newVeh.make || '', model: newVeh.model || '', vehicle: [newVeh.make, newVeh.model].filter(Boolean).join(' '), fuel: newVeh.fuel || '' });
    if (v) { pickVehicle(v); setNewVeh(null); toast.success(`Added ${v.regNo}`); }
  };
  const linkJobCard = (j) => {
    // import labour + parts + advisor/technician from the job card
    const jcLines = [];
    (j.parts || []).forEach((p) => { const inP = inventory.find((x) => x.id === p.partId); jcLines.push({ ...emptyLine('Part'), desc: p.name || inP?.name || 'Part', qty: p.qty || 1, rate: num(p.rate || inP?.defaultSellingPrice || inP?.sellingPrice), partId: p.partId, floorPrice: num(inP?.minSellingPrice), purchasePrice: num(inP?.purchasePrice), mrp: num(inP?.mrp) }); });
    (j.labour || []).forEach((lb) => { if (lb.service) jcLines.push({ ...emptyLine('Labour'), desc: lb.service, qty: num(lb.hours) || 1, rate: num(lb.rate), category: 'General Service' }); });
    // If the advisor found the card by its number before choosing a customer, adopt the
    // card's customer rather than leaving the invoice with a job card but no customer.
    const owner = customers.find((c) => (c.phone || '').replace(/\D/g, '').slice(-10) === (j.phone || '').replace(/\D/g, '').slice(-10))
      || customers.find((c) => (c.name || '').trim().toLowerCase() === (j.customer || '').trim().toLowerCase());
    const adopt = (!inv.customer && (j.customer || owner))
      ? { customerId: owner?.id || '', customer: owner?.name || j.customer || '', phone: owner?.phone || j.phone || '', gstNo: owner?.gst || inv.gstNo }
      : {};
    set({ ...adopt, jobCardId: j.jobNo, jobNo: j.jobNo, advisor: j.advisor || '', technician: j.technician || '', vehicle: j.vehicle || inv.vehicle, regNo: j.regNo || inv.regNo, lines: jcLines.length ? [...inv.lines.filter((l) => l.desc.trim()), ...jcLines] : inv.lines });
    toast.success(`Linked ${j.jobNo}${jcLines.length ? ` — imported ${jcLines.length} line(s)` : ''}`);
  };

  // Add an EMPTY payment row. It deliberately does not pre-fill the balance: an
  // invoice must never read "Paid" until the user has actually entered what was
  // collected. The balance is shown as a one-tap hint on the row instead.
  const addPayment = () => set({ payments: [...(inv.payments || []), emptyPayment()] });
  const setPayment = (id, patch) => set({ payments: (inv.payments || []).map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const delPayment = (id) => set({ payments: (inv.payments || []).filter((p) => p.id !== id) });

  const savingRef = useRef(false);
  // Marking an invoice Paid is the moment the whole ERP moves: stock leaves the
  // shelf, ledgers are written, the invoice locks. It must be a deliberate act with
  // the consequences spelled out — never a side-effect of typing a number.
  const confirmMarkPaid = async () => {
    if (!canSave) return;
    const partCount = inv.lines.filter((l) => l.partId && l.kind === 'Part').length;
    const ok = await confirmDialog({
      title: `Mark ${inv.invNo || 'this invoice'} as Paid?`,
      message: `Collected ${inr(t.paid)} against a total of ${inr(t.grand)}.\n\nThis will:\n• Deduct ${partCount} inventory part${partCount === 1 ? '' : 's'} from stock\n• Create Stock Out records\n• Post the parts to Sales and the labour to Services\n• Update Reports, Analytics and the Dashboard\n• Lock this invoice as history\n\nThis can only be undone with a Refund or Credit Note.`,
      confirmText: 'Yes, mark as Paid',
      tone: 'gold',
    });
    if (ok) save(false);
  };
  const save = (asEstimate = false, thenPay = false, asDraft = false) => {
    if (savingRef.current) return; // prevent double-submit
    // A DRAFT is deliberately permissive: a workshop parks a half-written bill all the
    // time (customer is deciding, waiting on a part, shift change). It needs a name to
    // be findable, but nothing else — and crucially it must NOT consume an invoice
    // number (see below), because a burned number leaves a gap in the legal sequence.
    if (!inv.customer || !inv.customer.trim()) return toast.error('Customer name required — even for a draft.');
    const billItems = inv.lines.filter((l) => l.desc.trim());
    if (!asDraft && billItems.length === 0) return toast.error('Add at least one bill item.');
    // blank / negative / zero validation per line
    for (const l of billItems) {
      // Negatives are never allowed, even on a draft — they corrupt totals.
      if (num(l.qty) < 0 || num(l.rate) < 0 || num(l.disc) < 0 || num(l.gst) < 0) return toast.error(`“${l.desc}” has a negative value. Quantities, rates, discount and GST must be zero or more.`);
      if (num(l.disc) > 100) return toast.error(`“${l.desc}” discount can’t exceed 100%.`);
      // A draft may legitimately have a line with no qty/price filled in yet.
      if (!asDraft && num(l.qty) <= 0) return toast.error(`“${l.desc}” has zero quantity. Set a quantity of at least 1.`);
    }
    if (!asDraft && !billItems.some((l) => num(l.rate) > 0)) return toast.error('Add a rate to at least one bill item.');
    const unapproved = inv.lines.find((l) => l.floorPrice > 0 && num(l.rate) > 0 && num(l.rate) < l.floorPrice && !l.approvedBelowFloor);
    if (unapproved) return toast.error(`“${unapproved.desc || 'A part'}” is below floor price — manager approval required.`);
    // invoice-level discount can't be negative
    if (num(inv.discount) < 0) return toast.error('Invoice discount can’t be negative.');
    const snap0 = totalsOf({ ...inv, lines: billItems });
    if (!asEstimate && !asDraft && snap0.grand <= 0) return toast.error('Invoice total is zero. Add priced items before saving an invoice.');
    // duplicate invoice-number guard (only when this invoice already carries a number)
    if (inv.invNo && invoices.some((x) => x.id !== inv.id && x.invNo === inv.invNo)) return toast.error(`Invoice number ${inv.invNo} already exists.`);

    // ---- 📦 STOCK AVAILABILITY -------------------------------------------------
    // There was NO check that a part being billed actually exists in stock. An advisor
    // could bill 5 brake pads with 2 on the shelf. Combined with the old Math.max(0)
    // clamp in applyStockDelta, that silently INVENTED inventory on reversal.
    //
    // An estimate/draft is exempt: quoting a part you need to order is normal and must
    // stay possible. Only a real invoice moves stock, so only a real invoice is gated.
    if (!asEstimate && !asDraft) {
      // Sum per part — the same part can appear on several lines.
      const wanted = {};
      billItems.forEach((l) => {
        if (l.partId && l.kind === 'Part') wanted[l.partId] = (wanted[l.partId] || 0) + num(l.qty);
      });
      // Stock already committed by THIS invoice's previous version must not be counted
      // against it again, or editing a saved invoice would fail against its own stock.
      const alreadyCommitted = {};
      const prior = invoices.find((x) => x.id === inv.id);
      const priorRealized = prior && !prior.isEstimate && prior.status !== 'Draft'
        && !['Cancelled', 'Refunded', 'Returned'].includes(prior.status)
        && deriveStatus(prior) === 'Paid';
      if (priorRealized) {
        (prior.lines || []).forEach((l) => {
          if (l.partId && l.kind === 'Part') alreadyCommitted[l.partId] = (alreadyCommitted[l.partId] || 0) + num(l.qty);
        });
      }
      const short = [];
      Object.keys(wanted).forEach((pid) => {
        const part = inventory.find((p) => p.id === pid);
        if (!part) return;
        const available = num(part.stock) + (alreadyCommitted[pid] || 0);
        if (wanted[pid] > available) {
          short.push(`${part.name}: need ${wanted[pid]}, have ${available}`);
        }
      });
      if (short.length) {
        return toast.error(`Not enough stock — ${short.join('; ')}. Reduce the quantity or restock first.`, { duration: 7000 });
      }
    }

    // ---- 💰 OVERPAYMENT --------------------------------------------------------
    // Payments were never checked against the invoice total, and `balance` is floored
    // with Math.max(0, ...) — so collecting ₹99,999 on a ₹1,000 invoice showed a clean
    // zero balance and the ₹98,999 excess simply vanished from the books. The customer
    // is owed that money; the workshop has no record of it.
    if (!asEstimate && !asDraft) {
      const totalPaid = payments.reduce((a, p) => a + num(p.amount), 0);
      const snapPay = totalsOf({ ...inv, lines: billItems, payments });
      if (payments.some((p) => num(p.amount) < 0)) {
        return toast.error('A payment amount cannot be negative.');
      }
      // Allow ₹1 of slack for rounding, but no more.
      if (totalPaid > snapPay.grand + 1) {
        return toast.error(`Payments (${inr(totalPaid)}) exceed the invoice total (${inr(snapPay.grand)}). Collect the correct amount or raise a refund.`, { duration: 7000 });
      }
    }

    // ---- 🏗 JOB CARD DOUBLE-BILLING --------------------------------------------
    // Nothing stopped the same job card being billed twice: the customer is charged
    // twice, stock deducts twice and revenue double-counts. Estimates are exempt (you
    // may legitimately quote a job card more than once before it is approved).
    if (!asEstimate && !asDraft && inv.jobNo) {
      const clash = invoices.find((x) => x.id !== inv.id
        && x.jobNo === inv.jobNo
        && !x.isEstimate
        && x.status !== 'Draft'
        && !['Cancelled', 'Refunded', 'Returned'].includes(x.status));
      if (clash) {
        return toast.error(`Job card ${inv.jobNo} is already billed on ${clash.invNo}. Cancel that invoice first, or unlink the job card.`, { duration: 7000 });
      }
    }
    // `paid` is only ever a MIRROR of the payment rows — never an independent value.
    // Saving an invoice with no payment rows therefore always persists paid = 0, so
    // editing/duplicating/printing can never make an invoice look settled.
    const paidNow = (inv.payments || []).reduce((s, p) => s + num(p.amount), 0);
    if (paidNow < 0) return toast.error('Collected amount can’t be negative.');
    if (!asEstimate && paidNow > snap0.grand + 0.5) return toast.error('Payment exceeds invoice total.');
    savingRef.current = true;
    setTimeout(() => { savingRef.current = false; }, 1500); // release after the save round-trip
    const prefix = asEstimate ? (billingCfg.estPrefix || 'EST') : (billingCfg.invPrefix || 'INV');
    // An ESTIMATE is a quotation, not a bill. It must never carry payments and must
    // never derive as Paid — the screenshot showed "EST-0003 ... Paid Rs.7,700",
    // which meant an estimate had money attached to it and printed as an INVOICE.
    const payments = (asEstimate || asDraft)
      ? []
      // Drop zero/blank payment rows. An empty row was being persisted, producing
      // "Payments: Cash Rs. 0.00, Cash Rs. 7,700.00" on the PDF.
      : (inv.payments || []).filter((p) => num(p.amount) > 0);

    // NUMBERING: an estimate gets EST-*, an invoice gets INV-*. Converting an
    // estimate to an invoice must ISSUE A FRESH INVOICE NUMBER — previously the
    // EST- number was carried over, so a real tax invoice went out numbered
    // "EST-0003", which is not a valid invoice series.
    // NUMBERING. A DRAFT NEVER TAKES AN INVOICE NUMBER. Invoice numbers must form a
    // clean, gapless sequence for GST/audit purposes — if a parked, half-finished bill
    // consumed INV-0007 and was later abandoned, the books would show a permanent hole.
    // The draft gets a number only when it is actually saved as an invoice/estimate.
    const numberIsEstimate = /^EST/i.test(inv.invNo || '');
    const numberIsDraft = /^DRF/i.test(inv.invNo || '');
    const needsNewNumber = asDraft
      ? !inv.invNo                                                   // temp DRF- handle only
      : (!inv.invNo || numberIsDraft || (!asEstimate && numberIsEstimate) || (asEstimate && !numberIsEstimate && !inv.invNo));
    const invNo = needsNewNumber
      ? nextInvNo(invoices, asDraft ? 'DRF' : asEstimate ? 'EST' : prefix)
      : inv.invNo;

    const clean = { ...inv, isEstimate: asEstimate && !asDraft, lines: billItems, payments, invNo };
    clean.paid = (asEstimate || asDraft) ? 0 : payments.reduce((a, p) => a + num(p.amount), 0);
    const snap = totalsOf(clean);
    clean.grandTotal = snap.grand; clean.balance = snap.balance; clean.gstAmount = snap.gst; clean.profitAmount = snap.profit;
    clean.status = asDraft ? 'Draft' : asEstimate ? 'Estimate' : deriveStatus(clean);
    clean.history = [...(inv.history || []), { at: Date.now(), action: asDraft ? 'Draft Saved' : inv.invNo ? 'Invoice Edited' : (asEstimate ? 'Estimate Created' : 'Invoice Created'), by: demoMode ? 'Demo User' : 'Staff' }];
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    onSave(clean, thenPay && !asEstimate && snap.balance > 0);
  };
  // autosave draft for new invoices (debounced) so an accidental close doesn't lose work
  useEffect(() => {
    if (inv.invNo) return; // only autosave unsaved new invoices
    const id = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(inv)); } catch {} }, 600);
    return () => clearTimeout(id);
  }, [inv, DRAFT_KEY]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') guardedClose();
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(false); }
      else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });

  const partLines = inv.lines.filter((l) => l.kind === 'Part');
  const labourLines = inv.lines.filter((l) => l.kind === 'Labour');
  const otherLines = inv.lines.filter((l) => l.kind !== 'Part' && l.kind !== 'Labour');
  // Badges must reflect REAL lines, not blank placeholder rows. A freshly-added
  // empty row shouldn't make the section read "Parts (1)" — it only counts once
  // the user has actually named it (or priced it).
  const isFilled = (l) => !!(l.desc || '').trim() || num(l.rate) > 0;
  const partCount = partLines.filter(isFilled).length;
  const labourCount = labourLines.filter(isFilled).length;
  const otherCount = otherLines.filter(isFilled).length;

  return (
    <Portal lock>
    <div className="fixed inset-0 z-[120] flex flex-col" style={{ background: 'var(--surface-0)' }}>
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 flex-shrink-0" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)', background: 'var(--surface-1)' }}>
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={guardedClose} className="w-9 h-9 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10"><X size={18} /></button>
          <div className="min-w-0"><h3 className="text-base font-bold text-white truncate">{inv.invNo ? `Edit ${inv.invNo}` : 'New Invoice'}</h3><p className="text-[11px] text-white/40 truncate">{inv.customer || 'No customer selected'}</p></div>
        </div>
        <div className="hidden sm:flex items-center gap-2">
          <div className="text-right mr-1"><p className="text-[9px] uppercase tracking-wide text-white/35 leading-none">Total</p><p className="text-base font-bold leading-tight" style={{ color: '#d4af37' }}>{inr(t.grand)}</p></div>
          {locked ? (
            <>
              <span className="h-9 px-3 rounded-lg text-[11px] font-bold flex items-center gap-1.5 bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"><Check size={13} /> {savedStatus} · Locked</span>
              <button onClick={() => onDownloadPDF?.(inv, true)} title="Print" className="h-9 px-3 rounded-lg text-xs font-bold bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 flex items-center gap-1.5"><Printer size={14} /> Print</button>
              <button onClick={() => onDownloadPDF?.(inv, false)} title="Download PDF" className="h-9 px-3 rounded-lg text-xs font-bold bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 flex items-center gap-1.5"><FileDown size={14} /> PDF</button>
              <button onClick={() => onDuplicate?.(inv)} title="Duplicate to a new editable invoice" className="h-9 px-3 rounded-lg text-xs font-bold bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 flex items-center gap-1.5"><Plus size={14} /> Duplicate</button>
              {savedStatus === 'Paid' && <button onClick={() => onCreditNote?.(inv)} title="Create a credit note (return / reverse this invoice)" className="h-9 px-3 rounded-lg text-xs font-bold bg-white/5 border border-red-500/25 text-red-300 hover:bg-red-500/10 flex items-center gap-1.5"><Undo2 size={14} /> Credit Note</button>}
            </>
          ) : (
            <>
              <button onClick={undo} disabled={!undoStack.current.length} title="Undo (Ctrl+Z)" className="h-9 w-9 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 disabled:opacity-30"><Undo2 size={15} /></button>
              <button onClick={redo} disabled={!redoStack.current.length} title="Redo (Ctrl+Y)" className="h-9 w-9 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 disabled:opacity-30"><Redo2 size={15} /></button>
              <button onClick={() => save(false, false, true)} disabled={!inv.customer?.trim()} title="Park this bill — no invoice number is used, nothing is billed" className="h-9 px-3 rounded-lg text-xs font-bold bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"><Save size={13} /> Save Draft</button>
              <button onClick={() => save(true)} disabled={!canSave} title="Save as estimate" className="h-9 px-3 rounded-lg text-xs font-bold bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed">Estimate</button>
              <button onClick={() => save(false)} disabled={!canSave} className="h-9 px-3 rounded-lg text-xs font-bold bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed">Save</button>
              {fullyPaid
                ? <button onClick={confirmMarkPaid} disabled={!canSave} title="Collected amount covers the total — settle this invoice" className="h-9 px-4 rounded-lg text-xs font-bold text-black bg-gradient-to-r from-emerald-400 to-emerald-500 flex items-center gap-1.5 disabled:opacity-40"><Check size={14} /> Mark as Paid</button>
                : <button onClick={() => save(false, true)} disabled={!canSave} title="Save and collect payment" className="h-9 px-4 rounded-lg text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"><Wallet size={14} /> Save &amp; Collect</button>}
            </>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto dark-scroll">
        {locked && (
          <div className="max-w-6xl xl:max-w-7xl mx-auto px-4 sm:px-6 pt-4">
            <div className="rounded-xl px-4 py-2.5 flex items-center gap-2 text-xs" style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', color: '#6ee7b7' }}>
              <Check size={14} /> This invoice is <b>{savedStatus}</b> and locked as history. To make changes, use <b>Duplicate</b> to create a new editable invoice, or issue a <b>Credit Note</b>.
            </div>
          </div>
        )}
        <div className="max-w-6xl xl:max-w-7xl mx-auto p-4 sm:p-6 pb-32 sm:pb-28 lg:flex lg:gap-6 lg:items-start" style={locked ? { pointerEvents: 'none', opacity: 0.85 } : undefined}>
          <div className="lg:flex-1 lg:min-w-0 space-y-4">
            {/* Customer & Vehicle */}
            <Section title="Customer & Vehicle" sub={inv.customer ? `${inv.customer} · ${inv.phone}` : 'Search or walk-in'}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Customer" className="sm:col-span-2">
                  <SearchSelect
                    value={inv.customer}
                    options={customers}
                    onSelect={pickCustomer}
                    getKey={(c) => c.id}
                    getLabel={(c) => c.name}
                    getSub={(c) => {
                      const regs = (c.vehicles || []).map((v) => v.regNo || v.reg).filter(Boolean).join(', ');
                      return [c.code, c.phone, regs].filter(Boolean).join(' · ')
                        + (num(c.outstanding) > 0 ? ` · outstanding ${inr(c.outstanding)}` : '');
                    }}
                    // Searchable by name, phone, code, email, GST and EVERY vehicle the
                    // customer owns (reg no / make / model) — a workshop usually knows the
                    // number plate, not the customer's name.
                    searchText={(c) => [c.name, c.phone, c.code, c.email, c.gst,
                      ...(c.vehicles || []).flatMap((v) => [v.regNo, v.reg, v.brand, v.model, v.vin])]
                      .filter(Boolean).join(' ')}
                    placeholder="Search name, phone, code or vehicle no…"
                    emptyText="No customer matches"
                    noOptionsText="No customers yet"
                    inputClassName={inputCls}
                    allowClearSelection
                    onClearSelection={() => set({ customerId: '', customer: '', phone: '', gstNo: '', vehicle: '', regNo: '', vehicleId: '' })}
                  />
                </Field>
                <Field label="Date"><input type="date" value={inv.date} onChange={(e) => set({ date: e.target.value })} className={inputCls} style={{ colorScheme: 'dark' }} /></Field>
                <Field label="Customer Name (walk-in)"><input value={inv.customer} onChange={(e) => set({ customer: e.target.value, customerId: inv.customerId })} placeholder="Type name for walk-in" className={inputCls} /></Field>
                <Field label="Phone"><input value={inv.phone} onChange={(e) => set({ phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} placeholder="10-digit" className={inputCls} /></Field>
                <Field label="GST No. (optional)"><input value={inv.gstNo} onChange={(e) => set({ gstNo: e.target.value.toUpperCase() })} placeholder="Customer GSTIN" className={inputCls} /></Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                <Field label="Vehicle" className="sm:col-span-2">
                  <SearchSelect
                    value={inv.vehicle ? `${inv.vehicle}${inv.regNo ? ` · ${inv.regNo}` : ''}` : ''}
                    options={custVehicles}
                    onSelect={pickVehicle}
                    getKey={(v, i) => v.id || v.regNo || i}
                    getLabel={(v) => [v.brand, v.model, v.variant].filter(Boolean).join(' ') || v.regNo || 'Vehicle'}
                    getSub={(v) => [v.regNo || v.reg, v.fuel, v.year, v.vin].filter(Boolean).join(' · ')}
                    searchText={(v) => [v.brand, v.model, v.variant, v.regNo, v.reg, v.vin, v.fuel, v.year]
                      .filter(Boolean).join(' ')}
                    placeholder={inv.customer ? 'Search model, reg no, VIN or fuel…' : 'Select a customer first'}
                    emptyText="No vehicle matches"
                    noOptionsText={inv.customer ? 'This customer has no vehicles on file' : 'Select a customer first'}
                    inputClassName={inputCls}
                    allowClearSelection
                    onClearSelection={() => set({ vehicle: '', regNo: '', vehicleId: '' })}
                  />
                </Field>
                <Field label="Reg. No."><input value={inv.regNo} onChange={(e) => set({ regNo: e.target.value.toUpperCase() })} className={inputCls} /></Field>
              </div>
            </Section>

            {/* Inline New Customer mini-form */}
            {newCust && (
              <div className="fixed inset-0 z-[130] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(3px)' }} onClick={() => setNewCust(null)}>
                <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}><h3 className="text-base font-bold text-white">New Customer</h3><button onClick={() => setNewCust(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10"><X size={17} /></button></div>
                  <div className="p-5 space-y-3">
                    <div><label className="block text-[11px] uppercase tracking-wide text-white/40 mb-1.5">Name<span className="text-red-400"> *</span></label><input autoFocus value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} placeholder="Customer name" className={inputCls} /></div>
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="block text-[11px] uppercase tracking-wide text-white/40 mb-1.5">Phone</label><input value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} placeholder="10-digit" className={inputCls} /></div>
                      <div><label className="block text-[11px] uppercase tracking-wide text-white/40 mb-1.5">GST (optional)</label><input value={newCust.gst} onChange={(e) => setNewCust({ ...newCust, gst: e.target.value.toUpperCase() })} placeholder="GSTIN" className={inputCls} /></div>
                    </div>
                    <div><label className="block text-[11px] uppercase tracking-wide text-white/40 mb-1.5">Email (optional)</label><input value={newCust.email} onChange={(e) => setNewCust({ ...newCust, email: e.target.value })} placeholder="email@…" className={inputCls} /></div>
                  </div>
                  <div className="flex gap-2 px-5 py-4" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.08)', background: 'var(--surface-2)', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
                    <button onClick={() => setNewCust(null)} className="flex-1 py-3 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80">Cancel</button>
                    <button onClick={saveNewCustomer} className="flex-1 py-3 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">Save &amp; Select</button>
                  </div>
                </div>
              </div>
            )}
            {/* Inline Add Vehicle mini-form */}
            {newVeh && (
              <div className="fixed inset-0 z-[130] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(3px)' }} onClick={() => setNewVeh(null)}>
                <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}><h3 className="text-base font-bold text-white">Add Vehicle</h3><button onClick={() => setNewVeh(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10"><X size={17} /></button></div>
                  <div className="p-5 space-y-3">
                    <div><label className="block text-[11px] uppercase tracking-wide text-white/40 mb-1.5">Registration No.<span className="text-red-400"> *</span></label><input autoFocus value={newVeh.regNo} onChange={(e) => setNewVeh({ ...newVeh, regNo: e.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, '').slice(0, 13) })} placeholder="TS09EX1234" className={inputCls} /></div>
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="block text-[11px] uppercase tracking-wide text-white/40 mb-1.5">Make</label><input value={newVeh.make} onChange={(e) => setNewVeh({ ...newVeh, make: e.target.value })} placeholder="Maruti" className={inputCls} /></div>
                      <div><label className="block text-[11px] uppercase tracking-wide text-white/40 mb-1.5">Model</label><input value={newVeh.model} onChange={(e) => setNewVeh({ ...newVeh, model: e.target.value })} placeholder="Swift" className={inputCls} /></div>
                    </div>
                    <div><label className="block text-[11px] uppercase tracking-wide text-white/40 mb-1.5">Fuel</label><select value={newVeh.fuel} onChange={(e) => setNewVeh({ ...newVeh, fuel: e.target.value })} className={inputCls}><option value="" style={{ background: '#141414' }}>Select…</option>{['Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid'].map((f) => <option key={f} style={{ background: '#141414' }}>{f}</option>)}</select></div>
                  </div>
                  <div className="flex gap-2 px-5 py-4" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.08)', background: 'var(--surface-2)', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
                    <button onClick={() => setNewVeh(null)} className="flex-1 py-3 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80">Cancel</button>
                    <button onClick={saveNewVehicle} className="flex-1 py-3 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">Save &amp; Select</button>
                  </div>
                </div>
              </div>
            )}

            {/* Job Card link */}
            <Section title="Job Card" sub={inv.jobNo ? `Linked: ${inv.jobNo}` : 'Optional — import labour & parts'} defaultOpen={false} badge={inv.jobNo ? '1' : null}>
              <SearchSelect
                value={inv.jobNo}
                options={custJobCards}
                onSelect={linkJobCard}
                getKey={(j) => j.jobNo}
                getLabel={(j) => j.jobNo}
                getSub={(j) => [j.regNo, j.vehicle, j.customer, j.status].filter(Boolean).join(' · ')}
                searchText={(j) => [j.jobNo, j.regNo, j.vehicle, j.customer, j.phone, j.status, j.make, j.model]
                  .filter(Boolean).join(' ')}
                placeholder="Search job no, customer, vehicle, reg no, phone or status…"
                emptyText="No job card matches"
                noOptionsText={inv.customer ? 'No open job cards for this customer' : 'Select a customer first'}
                inputClassName={inputCls}
                allowClearSelection
                onClearSelection={() => set({ jobCardId: '', jobNo: '' })}
              />
              {inv.jobNo && <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-white/50"><span>Advisor: <span className="text-white/75">{inv.advisor || '—'}</span></span><span>Technician: <span className="text-white/75">{inv.technician || '—'}</span></span><button type="button" onClick={() => set({ jobCardId: '', jobNo: '' })} className="text-red-400/60 hover:text-red-400">Unlink</button></div>}
            </Section>

            {/* Parts */}
            <Section title="Parts" sub="Items issued from your inventory — these reduce stock" badge={partCount || null}>
              {replaceFor && (
                <div className="mb-2 rounded-xl px-3 py-2 flex items-center justify-between gap-2 text-[11px]" style={{ background: 'rgba(212,175,55,0.10)', border: '1px solid rgba(212,175,55,0.30)', color: '#e8c96a' }}>
                  <span>Replacing a part — pick the correct one from the search below.</span>
                  <button type="button" onClick={() => setReplaceFor(null)} className="font-bold px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white/70">Cancel</button>
                </div>
              )}
              <div className="relative mb-3">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input ref={partSearchRef} value={partQ} onChange={(e) => setPartQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (!parts.length) return;
                    if (e.key === 'ArrowDown') { e.preventDefault(); setPartHi((i) => Math.min(i + 1, parts.length - 1)); }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); setPartHi((i) => Math.max(i - 1, 0)); }
                    else if (e.key === 'Enter') { e.preventDefault(); const p = parts[partHi]; if (p) { addPartFromInventory(p); setPartQ(''); } }
                    else if (e.key === 'Escape') { setPartQ(''); }
                  }}
                  role="combobox" aria-expanded={parts.length > 0} aria-controls="inv-search-list" aria-autocomplete="list"
                  placeholder="Search inventory by name, SKU, OEM, barcode…" className={`${inputCls} pl-9 pr-9`} />
                {partQ && (
                  <button type="button" aria-label="Clear search"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setPartQ(''); setPartHi(0); partSearchRef.current?.focus(); }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md text-white/40 hover:text-white hover:bg-white/10">
                    <X size={13} />
                  </button>
                )}
                {parts.length > 0 && (
                  <div id="inv-search-list" role="listbox" className="absolute z-30 mt-1 w-full rounded-xl shadow-2xl overflow-y-auto overscroll-contain dark-scroll" style={{ maxHeight: 'min(20rem, 45vh)', background: 'var(--surface-2)', border: '1px solid rgba(212,175,55,0.25)' }}>
                    {parts.map((p, pi) => {
                      const avail = (p.stock || 0) - (p.reserved || 0);
                      const price = num(p.defaultSellingPrice || p.sellingPrice || p.mrp);
                      return (
                        <button key={p.id} type="button" role="option" aria-selected={pi === partHi}
                          ref={(el) => { if (el && pi === partHi) el.scrollIntoView({ block: 'nearest' }); }}
                          onMouseEnter={() => setPartHi(pi)}
                          onClick={() => { addPartFromInventory(p); setPartQ(''); }}
                          className={`w-full text-left px-3 py-2.5 transition border-b last:border-0 ${pi === partHi ? 'bg-[#d4af37]/15' : 'hover:bg-[#d4af37]/10'}`} style={{ borderColor: 'rgba(var(--fg-rgb),0.06)' }}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-white/90 truncate">{p.name}</p>
                              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 mt-0.5 text-[10px] text-white/45">
                                {p.sku && <span>SKU: <span className="text-white/60">{p.sku}</span></span>}
                                {(p.oemNo || p.oem) && <span>OEM: <span className="text-white/60">{p.oemNo || p.oem}</span></span>}
                                {(p.rack || p.location) && <span>Rack: <span className="text-white/60">{p.rack || p.location}</span></span>}
                                {p.unit && <span>Unit: <span className="text-white/60">{p.unit}</span></span>}
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-sm font-bold" style={{ color: '#d4af37' }}>{inr(price)}</p>
                              <p className={`text-[10px] font-semibold ${avail > 0 ? 'text-emerald-400/80' : 'text-red-400'}`}>{avail > 0 ? `${avail} in stock` : 'out of stock'}</p>
                              {gstEnabled && <p className="text-[9px] text-white/40">GST {Number(p.gst) || 18}%</p>}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                {parts.length === 0 && partQ.trim().length >= 2 && (
                  <div className="absolute z-30 mt-1 w-full rounded-xl overflow-hidden shadow-2xl" style={{ background: 'var(--surface-2)', border: '1px solid rgba(245,158,11,0.35)' }}>
                    <div className="px-3 py-2.5 flex items-start gap-2" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                      <span className="text-amber-400 mt-0.5 flex-shrink-0">⚠</span>
                      <div>
                        <p className="text-xs font-semibold text-white/85">“{partQ.trim()}” is not in your inventory.</p>
                        <p className="text-[10px] text-white/45 mt-0.5">Parts must come from inventory so stock and profit stay correct. If you bought this from outside for this job, bill it as an Outside Purchase.</p>
                      </div>
                    </div>
                    <button type="button" onClick={() => { addLine('Other', partQ.trim()); setPartQ(''); toast('Added under Outside Purchase.', { icon: '🧾' }); }} className="w-full text-left px-3 py-2.5 text-xs text-white/80 hover:bg-[#d4af37]/10 flex items-center gap-2"><Plus size={13} className="text-[#d4af37]" /> Bill as Outside Purchase item</button>
                  </div>
                )}
              </div>
              <div className="space-y-2">{partLines.map((l) => <LineRowBase key={l.id} l={l} setLine={setLine} delLine={delLine} dupLine={dupLine} moveLine={moveLine} clearPartLink={clearPartLink} inventory={inventory} discountEnabled={discountEnabled} gstEnabled={gstEnabled} defaultGst={defaultGst} priceOverride={priceOverride} />)}{partLines.length === 0 && <p className="text-xs text-white/35 py-3 text-center rounded-lg" style={{ background: 'rgba(var(--fg-rgb),0.02)' }}>No parts yet — search your inventory above to add one.</p>}</div>
              <p className="mt-2 text-[10px] text-white/30">Only inventory items can be added here. Anything bought from outside belongs in <b className="text-white/45">Outside Purchase</b> below.</p>
            </Section>

            {/* Labour */}
            <Section title="Labour & Services" sub="Enter the service and the amount you're charging" badge={labourCount || null}>
              {/* One-tap common services — the owner adds the line, then types the charge. */}
              <div className="flex flex-wrap gap-1.5 mb-2.5">
                {COMMON_SERVICES.map((svcName) => (
                  <button key={svcName} type="button" onClick={() => addLine('Labour', svcName)} className="text-[10px] px-2.5 py-1.5 min-h-[30px] rounded-lg bg-white/5 border border-white/10 text-white/60 hover:bg-[#d4af37]/10 hover:text-[#d4af37] hover:border-[#d4af37]/30 transition">+ {svcName}</button>
                ))}
              </div>
              <div className="space-y-2">{labourLines.map((l) => <LineRowBase key={l.id} l={l} setLine={setLine} delLine={delLine} dupLine={dupLine} moveLine={moveLine} clearPartLink={clearPartLink} inventory={inventory} discountEnabled={discountEnabled} gstEnabled={gstEnabled} defaultGst={defaultGst} priceOverride={priceOverride} />)}{labourLines.length === 0 && <p className="text-xs text-white/35 py-2 text-center rounded-lg" style={{ background: 'rgba(var(--fg-rgb),0.02)' }}>No labour yet — add a service line below.</p>}</div>
              <button type="button" onClick={() => addLine('Labour')} className="mt-2 text-[11px] font-bold text-[#d4af37] flex items-center gap-1"><Plus size={12} /> Add custom service</button>
            </Section>

            {/* Other / outside purchase */}
            <Section title="Outside Purchase" sub="Externally sourced items billed to the customer" defaultOpen={false} badge={otherCount || null}>
              <p className="text-[11px] text-white/40 mb-2 rounded-lg px-3 py-2" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>Items purchased externally and billed to the customer without entering your inventory (e.g. a part bought from another shop for this job). These don’t affect stock levels.</p>
              <div className="space-y-2">{otherLines.map((l) => <LineRowBase key={l.id} l={l} setLine={setLine} delLine={delLine} dupLine={dupLine} moveLine={moveLine} clearPartLink={clearPartLink} inventory={inventory} discountEnabled={discountEnabled} gstEnabled={gstEnabled} defaultGst={defaultGst} priceOverride={priceOverride} />)}{otherLines.length === 0 && <p className="text-xs text-white/35 py-2 text-center rounded-lg" style={{ background: 'rgba(var(--fg-rgb),0.02)' }}>Nothing added yet.</p>}</div>
              <button type="button" onClick={() => addLine('Other')} className="mt-2 text-[11px] font-bold text-[#d4af37] flex items-center gap-1"><Plus size={12} /> Add outside-purchase item</button>
            </Section>

            {/* Payments */}
            {inv.isEstimate ? (
              <Section title="Payments" sub="Not applicable to an estimate" defaultOpen={false}>
                <p className="text-xs text-white/40 py-2">This is an <b>estimate</b> (a quotation). Payments can only be collected once it is converted to an invoice — so an estimate can never show as Paid, and it never touches stock or revenue.</p>
              </Section>
            ) : (
            <Section title="Payments" sub={t.paid > 0 ? `Paid ${inr(t.paid)} · balance ${inr(t.balance)}` : 'Split across modes'} badge={(inv.payments || []).filter((p) => num(p.amount) > 0).length || null}>
              <div className="space-y-2">
                {(inv.payments || []).map((p) => (
                  <div key={p.id} className="flex flex-wrap items-end gap-2 rounded-xl p-2.5" style={{ background: 'rgba(var(--fg-rgb),0.025)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
                    <label className="w-32">
                      <span className="block text-[9px] uppercase tracking-wide text-white/35 mb-0.5">Mode</span>
                      <select value={p.mode} onChange={(e) => setPayment(p.id, { mode: e.target.value })} className={`${inputCls} py-2`}>{PAYMENT_MODES.map((m) => <option key={m} style={{ background: '#141414' }}>{m}</option>)}</select>
                    </label>
                    <label className="flex-1 min-w-[100px]">
                      <span className="flex items-center justify-between text-[9px] uppercase tracking-wide text-white/35 mb-0.5">
                        <span>Amount</span>
                        {t.balance > 0 && <span className="normal-case text-[9px] text-white/35">still due {inr(t.balance)}</span>}
                      </span>
                      <input value={p.amount} inputMode="decimal" onChange={(e) => setPayment(p.id, { amount: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0" className={`${inputCls} py-2 text-right`} />
                    </label>
                    <label className="flex-1 min-w-[120px]">
                      <span className="block text-[9px] uppercase tracking-wide text-white/35 mb-0.5">Reference (optional)</span>
                      <input value={p.ref} onChange={(e) => setPayment(p.id, { ref: e.target.value })} placeholder="UPI ref / txn no." className={`${inputCls} py-2`} />
                    </label>
                    <button type="button" onClick={() => delPayment(p.id)} title="Remove payment" className="w-9 h-9 mb-0.5 rounded-lg flex items-center justify-center text-red-400/60 hover:bg-red-500/10 hover:text-red-400 flex-shrink-0"><Trash2 size={14} /></button>
                  </div>
                ))}
                {(inv.payments || []).length === 0 && <p className="text-xs text-white/35 py-2 text-center rounded-lg" style={{ background: 'rgba(var(--fg-rgb),0.02)' }}>No payment recorded yet — add one to collect against this invoice.</p>}
              </div>
              <button type="button" onClick={addPayment} className="mt-2 text-[11px] font-bold text-[#d4af37] flex items-center gap-1"><Plus size={12} /> Add payment</button>
            </Section>
            )}

            {/* Notes */}
            <Section title="Notes & Terms" defaultOpen={false}>
              <Field label="Notes"><textarea value={inv.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} className={`${inputCls} resize-none`} placeholder="Notes shown on invoice…" /></Field>
              <div className="mt-2"><Field label="Estimate valid till (for estimates)"><input type="date" value={inv.estimateValidTill} onChange={(e) => set({ estimateValidTill: e.target.value })} className={inputCls} style={{ colorScheme: 'dark' }} /></Field></div>
            </Section>
          </div>

          {/* Summary — sticky on wide screens, stacks below on narrow. Own scroll
              so a tall summary on a short viewport never overlaps or clips. */}
          <div className="lg:w-80 lg:flex-shrink-0 mt-3 lg:mt-0">
            <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto dark-scroll rounded-2xl p-4" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.2)' }}>
              <p className="text-xs font-bold uppercase tracking-wide text-[#d4af37] mb-3">Invoice Summary</p>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between text-white/55"><span>Parts</span><span>{inr(t.partsRev)}</span></div>
                <div className="flex justify-between text-white/55"><span>Labour</span><span>{inr(t.labourRev)}</span></div>
                <div className="flex justify-between text-white/55"><span>Subtotal</span><span>{inr(t.sub)}</span></div>
                {discountEnabled && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-white/55">Discount</span>
                    <div className="flex items-center gap-1">
                      <input value={inv.discount} inputMode="numeric" onChange={(e) => set({ discount: e.target.value.replace(/[^\d.]/g, '') })} className="w-16 py-1 px-2 rounded-lg text-xs text-right bg-white/5 border border-white/10 text-white outline-none" />
                      <select value={inv.discountType} onChange={(e) => set({ discountType: e.target.value })} className="py-1 px-1 rounded-lg text-xs bg-white/5 border border-white/10 text-white outline-none"><option value="flat" style={{ background: '#141414' }}>₹</option><option value="percent" style={{ background: '#141414' }}>%</option></select>
                    </div>
                  </div>
                )}
                {gstEnabled && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-white/55">GST Mode</span>
                    <select value={inv.gstMode || 'auto'} onChange={(e) => set({ gstMode: e.target.value })} className="py-1 px-2 rounded-lg text-xs bg-white/5 border border-white/10 text-white outline-none">
                      <option value="auto" style={{ background: '#141414' }}>CGST + SGST</option>
                      <option value="igst" style={{ background: '#141414' }}>IGST</option>
                      <option value="exempt" style={{ background: '#141414' }}>Exempt / No GST</option>
                    </select>
                  </div>
                )}
                {gstEnabled && (t.isIgst
                  ? <div className="flex justify-between text-white/55"><span>IGST</span><span>{inr(t.igst)}</span></div>
                  : <><div className="flex justify-between text-white/55"><span>CGST</span><span>{inr(t.cgst)}</span></div><div className="flex justify-between text-white/55"><span>SGST</span><span>{inr(t.sgst)}</span></div></>)}
                <div className="flex justify-between text-white/40 text-[11px]"><span>Round off</span><span>{inr(t.roundOff)}</span></div>
                <div className="flex justify-between font-bold text-white pt-1.5 text-base" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.1)' }}><span>Grand Total</span><span style={{ color: '#d4af37' }}>{inr(t.grand)}</span></div>
                <div className="flex justify-between text-emerald-400"><span>Paid</span><span>{inr(t.paid)}</span></div>
                <div className="flex justify-between font-bold" style={{ color: t.balance > 0 ? '#f87171' : '#34d399' }}><span>Balance</span><span>{inr(t.balance)}</span></div>
                {t.cost > 0 && <div className="flex justify-between text-[11px] pt-1 mt-1" style={{ borderTop: '1px dashed rgba(var(--fg-rgb),0.1)', color: t.profit >= 0 ? '#4ade80' : '#f87171' }}><span>Est. Profit ({t.afterDisc > 0 ? Math.round((t.profit / t.afterDisc) * 100) : 0}%)</span><span>{inr(t.profit)}</span></div>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* mobile action bar */}
      <div className="sm:hidden flex items-center gap-2 px-4 py-3 flex-shrink-0" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.08)', background: 'var(--surface-1)', paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <div className="flex-shrink-0"><p className="text-[8px] uppercase tracking-wide text-white/35 leading-none">Total</p><p className="text-sm font-bold leading-tight" style={{ color: '#d4af37' }}>{inr(t.grand)}</p></div>
        {locked ? (
          <>
            <button onClick={() => onDownloadPDF?.(inv, true)} className="flex-1 py-3 rounded-xl text-xs font-bold bg-white/5 border border-white/10 text-white/80 flex items-center justify-center gap-1"><Printer size={13} /> Print</button>
            <button onClick={() => onDownloadPDF?.(inv, false)} className="flex-1 py-3 rounded-xl text-xs font-bold bg-white/5 border border-white/10 text-white/80 flex items-center justify-center gap-1"><FileDown size={13} /> PDF</button>
            <button onClick={() => onDuplicate?.(inv)} className="flex-1 py-3 rounded-xl text-xs font-bold bg-white/5 border border-white/10 text-white/80 flex items-center justify-center gap-1"><Plus size={13} /> Duplicate</button>
          </>
        ) : (
          <>
            <button onClick={() => save(false, false, true)} disabled={!inv.customer?.trim()} className="flex-1 py-3 rounded-xl text-xs font-bold bg-white/5 border border-white/10 text-white/70 disabled:opacity-40">Draft</button>
            <button onClick={() => save(false)} disabled={!canSave} className="flex-1 py-3 rounded-xl text-xs font-bold bg-white/5 border border-white/10 text-white/80 disabled:opacity-40">Save</button>
            {fullyPaid
              ? <button onClick={confirmMarkPaid} disabled={!canSave} className="flex-1 py-3 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-emerald-400 to-emerald-500 flex items-center justify-center gap-1 disabled:opacity-40"><Check size={13} /> Mark as Paid</button>
              : <button onClick={() => save(false, true)} disabled={!canSave} className="flex-1 py-3 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] flex items-center justify-center gap-1 disabled:opacity-40"><Wallet size={13} /> Save &amp; Collect</button>}
          </>
        )}
      </div>
    </div>
    </Portal>
  );
}

function PaymentModal({ invoice, onCollect, onClose }) {
  const t = totalsOf(invoice);
  const [mode, setMode] = useState('Cash');
  const [amount, setAmount] = useState(String(Math.round(t.balance)));
  const [ref, setRef] = useState('');
  const [notes, setNotes] = useState('');
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const remaining = Math.max(0, t.balance - num(amount));
  const overpay = num(amount) > t.balance + 0.5;
  const willClose = !overpay && num(amount) > 0 && remaining <= 0.5;
  // Cash needs no reference; digital modes do. Keeps the counter flow to a minimum.
  const needsRef = ['UPI', 'Card', 'Bank Transfer', 'Cheque', 'Wallet'].includes(mode);
  const confirm = () => {
    if (num(amount) <= 0) { toast.error('Enter the amount received.'); return; }
    if (overpay) { toast.error('Payment exceeds the balance due.'); return; }
    onCollect(invoice, mode, amount, ref, { notes, paidOn });
  };
  return (
    <Portal lock>
    <div className="fixed inset-0 z-[130] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(3px)' }} onClick={onClose}>
      <div className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl flex flex-col" style={{ maxHeight: '92vh', background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }} ref={(el) => { if (el && typeof CSS !== 'undefined' && CSS.supports?.('height', '100dvh')) el.style.maxHeight = '92dvh'; }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
          <h3 className="text-base font-bold text-white">Collect Payment</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10"><X size={17} /></button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto overscroll-contain dark-scroll flex-1 min-h-0" onKeyDown={(e) => { if (e.key === 'Enter') confirm(); }}>
          <div className="rounded-xl p-3 text-sm" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
            <div className="flex justify-between text-white/60"><span>{invoice.invNo} · {invoice.customer}</span></div>
            <div className="flex justify-between mt-1"><span className="text-white/50">Grand Total</span><span className="text-white/85 font-bold">{inr(t.grand)}</span></div>
            <div className="flex justify-between"><span className="text-white/50">Already Paid</span><span className="text-emerald-400">{inr(t.paid)}</span></div>
            <div className="flex justify-between font-bold"><span className="text-white/50">Balance Due</span><span style={{ color: '#f87171' }}>{inr(t.balance)}</span></div>
          </div>
          <Field label="Amount Received">
            <input autoFocus value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="₹ amount received" className={`${inputCls} text-right text-lg font-bold ${overpay ? 'border-red-500/60' : ''}`} />
          </Field>
          {/* One-tap amounts — the counter case is "customer pays the full balance". */}
          <div className="flex flex-wrap gap-1.5 -mt-1">
            <button type="button" onClick={() => setAmount(String(Math.round(t.balance)))} className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-[#d4af37]/15 text-[#d4af37] border border-[#d4af37]/25">Full balance {inr(t.balance)}</button>
            <button type="button" onClick={() => setAmount(String(Math.round(t.balance / 2)))} className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/60">Half</button>
            <button type="button" onClick={() => setAmount('')} className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/60">Clear</button>
          </div>
          {overpay && <p className="text-[11px] text-red-400">Payment exceeds the balance due.</p>}
          {!overpay && num(amount) > 0 && !willClose && <p className="text-[11px] text-white/45">Part payment — <span className="text-white/70 font-semibold">{inr(remaining)}</span> will remain outstanding.</p>}
          <Field label="Payment Method">
            <div className="grid grid-cols-4 gap-1.5">{PAYMENT_MODES.map((m) => <button key={m} type="button" onClick={() => setMode(m)} className={`py-2 rounded-lg text-[10px] font-semibold ${mode === m ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]' : 'text-white/60 bg-white/5 border border-white/10'}`}>{m}</button>)}</div>
          </Field>
          <div className={`grid gap-2 ${needsRef ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {needsRef && <Field label={mode === 'Cheque' ? 'Cheque No.' : 'Reference No.'}><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={mode === 'UPI' ? 'UPI txn ref' : 'Reference'} className={inputCls} /></Field>}
            <Field label="Paid On"><input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className={inputCls} style={{ colorScheme: 'dark' }} /></Field>
          </div>
          <Field label="Notes (optional)"><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any note for this payment…" className={inputCls} /></Field>
          {/* Make the consequence explicit — this is the moment stock leaves the shelf. */}
          {willClose && (
            <div className="rounded-xl px-3 py-2.5 flex items-start gap-2 text-[11px]" style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', color: '#6ee7b7' }}>
              <Check size={13} className="mt-0.5 flex-shrink-0" />
              <span>This settles the invoice. It will be marked <b>Paid</b> and locked, spare-part stock will be deducted, and the sale will post to your Parts Sales and Service Income.</span>
            </div>
          )}
        </div>
        <div className="flex gap-2 px-5 py-4 flex-shrink-0" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.08)', background: 'var(--surface-2)', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <button onClick={onClose} className="flex-1 py-3 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80">Cancel</button>
          <button onClick={confirm} disabled={num(amount) <= 0 || overpay} className="flex-1 py-3 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] disabled:opacity-40 disabled:cursor-not-allowed">{willClose ? 'Collect & Close Invoice' : 'Record Payment'}</button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

const CHART_COLORS = ['#d4af37', '#60a5fa', '#34d399', '#f472b6', '#a78bfa', '#fbbf24', '#22d3ee'];
function RevenueTrend({ data }) {
  const max = Math.max(1, ...data.map((d) => d.rev));
  const W = 520, H = 120, pad = 4;
  const pts = data.map((d, i) => { const x = pad + (i / (data.length - 1)) * (W - 2 * pad); const y = H - pad - (d.rev / max) * (H - 2 * pad); return [x, y]; });
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${path} L${pts[pts.length - 1][0].toFixed(1)},${H - pad} L${pts[0][0].toFixed(1)},${H - pad} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 120 }} preserveAspectRatio="none">
      <defs><linearGradient id="revgrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#d4af37" stopOpacity="0.35" /><stop offset="100%" stopColor="#d4af37" stopOpacity="0" /></linearGradient></defs>
      <path d={area} fill="url(#revgrad)" />
      <path d={path} fill="none" stroke="#d4af37" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2" fill="#d4af37" />)}
    </svg>
  );
}
function Donut({ segments, total }) {
  let acc = 0; const R = 52, C = 60, sw = 16, circ = 2 * Math.PI * R;
  return (
    <svg viewBox="0 0 120 120" width="120" height="120" className="flex-shrink-0">
      <circle cx={C} cy={C} r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={sw} />
      {segments.map((s, i) => { const frac = total > 0 ? s.value / total : 0; const dash = frac * circ; const el = <circle key={i} cx={C} cy={C} r={R} fill="none" stroke={s.color} strokeWidth={sw} strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-acc * circ} transform={`rotate(-90 ${C} ${C})`} />; acc += frac; return el; })}
    </svg>
  );
}
function BarPair({ parts, labour }) {
  const max = Math.max(1, parts, labour);
  return (
    <div className="space-y-3 w-full">
      {[['Parts', parts, '#818cf8'], ['Labour', labour, '#f472b6']].map(([l, v, c]) => (
        <div key={l}>
          <div className="flex justify-between text-[11px] mb-1"><span className="text-white/60">{l}</span><span className="text-white/80">{inr(v)}</span></div>
          <div className="h-2.5 rounded-full bg-white/5 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(v / max) * 100}%`, background: c }} /></div>
        </div>
      ))}
    </div>
  );
}

export default function BillingModule({ demoMode = false, demoCanDelete = false, canManage = true, isAdmin = false, invoices, customers = [], inventory = [], jobCards = [], onPersist, onDelete, onRestoreStock, onQuickCustomer, onQuickVehicle }) {
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('All');
  const [payModeF, setPayModeF] = useState('All');
  const [dateF, setDateF] = useState('All');
  const [edit, setEdit] = useState(null);
  const [payFor, setPayFor] = useState(null);
  const [timelineFor, setTimelineFor] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const toggleSel = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSel = () => setSelected(new Set());
  const [page, setPage] = useState(1);
  const [PER, setPER] = useState(25);
  useEffect(() => { setPage(1); }, [q, statusF, payModeF, dateF, PER]);

  const inDateRange = (iv) => {
    if (dateF === 'All') return true;
    const d = new Date(iv.date); const now = new Date();
    if (dateF === 'Today') return d.toDateString() === now.toDateString();
    if (dateF === 'Week') { const wk = new Date(now); wk.setDate(now.getDate() - 7); return d >= wk; }
    if (dateF === 'Month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    return true;
  };
  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return [...invoices].sort((a, b) => (b.date || '').localeCompare(a.date || '')).filter((iv) => {
      const st = deriveStatus(iv);
      if (statusF !== 'All' && st !== statusF) return false;
      if (payModeF !== 'All' && !(iv.payments || []).some((p) => p.mode === payModeF)) return false;
      if (!inDateRange(iv)) return false;
      if (!ql) return true;
      return [iv.invNo, iv.customer, iv.phone, iv.vehicle, iv.regNo, iv.vin, iv.jobNo, iv.advisor, iv.technician, iv.gstNo].filter(Boolean).join(' ').toLowerCase().includes(ql);
    });
  }, [invoices, q, statusF, payModeF, dateF]);
  const paged = filtered.slice((page - 1) * PER, page * PER);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PER));

  const collectPayment = (iv, mode, amount, ref, meta = {}) => {
    if (iv.isEstimate) { toast.error('Convert this estimate to an invoice before collecting payment.'); return; }
    if (num(amount) <= 0) { toast.error('Enter the amount received.'); return; }
    const pay = { ...emptyPayment(), mode, amount: num(amount), ref, notes: meta.notes || '', date: meta.paidOn || new Date().toISOString().slice(0, 10) };
    const next = { ...iv, payments: [...(iv.payments || []), pay] };
    next.paid = next.payments.reduce((s, p) => s + num(p.amount), 0);
    // Refresh the persisted totals on the SAME object we hand to the engine. This was
    // the bug: {...iv} carried a stale grandTotal, the engine's gate read it, decided
    // the invoice wasn't fully paid, and skipped every downstream update in silence.
    const snap = totalsOf(next);
    next.grandTotal = snap.grand;
    next.balance = snap.balance;
    next.gstAmount = snap.gst;
    next.profitAmount = snap.profit;
    next.status = deriveStatus(next);
    next.history = [...(iv.history || []), { at: Date.now(), action: `Payment ${inr(amount)} (${mode})`, by: demoMode ? 'Demo User' : 'Staff' }];
    onPersist?.(next);
    setPayFor(null);
    toast.success(`Payment of ${inr(amount)} recorded`);
  };
  const duplicateInvoice = (iv) => setEdit({ ...emptyInvoice(), ...iv, id: `inv_${Date.now()}`, invNo: '', payments: [], paid: 0, status: 'Draft', history: [] });
  const exportCSV = () => {
    const head = ['Invoice', 'Date (ISO)', 'Date', 'Customer', 'Phone', 'Vehicle', 'Job Card', 'Advisor', 'Subtotal', 'GST', 'Grand Total', 'Paid', 'Balance', 'Profit', 'Status'];
    // Dates: emit BOTH an ISO value (sorts correctly, unambiguous) and a readable
    // form. Never blank — fall back to the record's createdAt if `date` is missing.
    const body = filtered.map((iv) => {
      const t = totalsOf(iv);
      const iso = iv.date || localDateStr(tsToDate(iv.createdAt) || new Date());
      return [iv.invNo, iso, displayDate(iso), iv.customer, iv.phone, iv.vehicle, iv.jobNo, iv.advisor, Math.round(t.sub), Math.round(t.gst), t.grand, Math.round(t.paid), Math.round(t.balance), Math.round(t.profit), deriveStatus(iv)];
    });
    const csv = [head, ...body].map((r) => r.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };
  const selectedInvoices = () => invoices.filter((iv) => selected.has(iv.id));
  const bulkExport = (gstOnly = false) => {
    const rows = selectedInvoices();
    if (!rows.length) return toast.error('Select invoices first');
    const head = gstOnly ? ['Invoice', 'Date', 'Customer', 'GSTIN', 'Taxable', 'CGST', 'SGST', 'Total GST', 'Grand Total'] : ['Invoice', 'Date', 'Customer', 'Phone', 'Vehicle', 'Grand Total', 'Paid', 'Balance', 'Status'];
    const body = rows.map((iv) => {
      const t = totalsOf(iv);
      const iso = iv.date || localDateStr(tsToDate(iv.createdAt) || new Date());
      return gstOnly
        ? [iv.invNo, iso, displayDate(iso), iv.customer, iv.gstNo || '', Math.round(t.afterDisc), Math.round(t.cgst), Math.round(t.sgst), Math.round(t.gst), t.grand]
        : [iv.invNo, iso, displayDate(iso), iv.customer, iv.phone, iv.vehicle, t.grand, Math.round(t.paid), Math.round(t.balance), deriveStatus(iv)];
    });
    const csv = [head, ...body].map((r) => r.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `${gstOnly ? 'gst-report' : 'invoices'}-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    toast.success(`Exported ${rows.length} invoice(s)`);
  };
  const bulkPDF = async () => { const rows = selectedInvoices(); if (!rows.length) return toast.error('Select invoices first'); for (const iv of rows) { await downloadPDF(iv, false); } toast.success(`Downloaded ${rows.length} PDF(s)`); };
  const bulkReminder = () => {
    const rows = selectedInvoices().filter((iv) => totalsOf(iv).balance > 0 && iv.phone);
    if (!rows.length) return toast.error('No selected invoices with a balance & phone');
    rows.forEach((iv) => { const t = totalsOf(iv); window.open(`https://wa.me/91${(iv.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(`Reminder: Invoice ${iv.invNo} has a pending balance of ${inr(t.balance)}. Kindly clear at your convenience. — Sri Baba Balaji Maruti Care`)}`, '_blank'); });
    toast.success(`Opened ${rows.length} reminder(s)`);
  };
  const bulkArchive = () => { const rows = selectedInvoices(); rows.forEach((iv) => onPersist?.({ ...iv, archived: true })); toast.success(`Archived ${rows.length}`); clearSel(); };
  const bulkDelete = async () => {
    if (demoMode && !demoCanDelete) return toast('This action has been disabled by the administrator.', { icon: '🔒' });
    if (!isAdmin) return toast.error('Only admins can bulk-delete');
    const rows = selectedInvoices();
    if (!await confirmDialog({ title: `Delete ${rows.length} invoice(s)?`, message: 'This cannot be undone.', danger: true, confirmText: 'Delete' })) return;
    rows.forEach((iv) => onDelete?.(iv)); toast.success(`Deleted ${rows.length}`); clearSel();
  };
  const convertEstimate = (iv) => {
    const next = { ...iv, isEstimate: false, invNo: nextInvNo(invoices, 'INV'), status: 'Unpaid', history: [...(iv.history || []), { at: Date.now(), action: `Converted from estimate ${iv.invNo}`, by: demoMode ? 'Demo User' : 'Staff' }] };
    next.status = deriveStatus(next);
    onPersist?.(next);
    toast.success(`${iv.invNo} → ${next.invNo}`);
  };
  const changeStatus = (iv, status, verb) => {
    // Cancel/Refund/Return restore inventory stock via the parent's delete-style path
    // is handled at persist; here we just flag the status + history. Stock restoration
    // for returns happens through onDelete's stock-restore logic when appropriate.
    const next = { ...iv, status, history: [...(iv.history || []), { at: Date.now(), action: verb, by: demoMode ? 'Demo User' : 'Staff' }] };
    onPersist?.(next);
    if (status === 'Returned' || status === 'Refunded') onRestoreStock?.(iv);
    toast.success(`${iv.invNo}: ${verb}`);
  };

  const stats = useMemo(() => {
    const today = localDateStr();   // LOCAL date, not UTC — see localDateStr()
    const now = new Date();
    let grand = 0, paid = 0, outstanding = 0, gstTotal = 0, partsRev = 0, labourRev = 0, profitToday = 0;
    let revToday = 0, invToday = 0, draftCount = 0, pendingCount = 0, monthRev = 0, monthProfit = 0;
    const modeSplit = {};
    invoices.forEach((iv) => {
      const t = totalsOf(iv); const st = deriveStatus(iv);
      if (st === 'Cancelled') return;
      grand += t.grand; paid += t.paid; outstanding += t.balance; gstTotal += t.gst;
      partsRev += t.partsRev; labourRev += t.labourRev;
      if (iv.date === today) { revToday += t.grand; invToday += 1; profitToday += t.profit; }
      const d = new Date(iv.date);
      if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) { monthRev += t.grand; monthProfit += t.profit; }
      if (st === 'Draft' || iv.isEstimate) draftCount += 1;
      if (t.balance > 0 && !iv.isEstimate) pendingCount += 1;
      (iv.payments || []).forEach((p) => { modeSplit[p.mode] = (modeSplit[p.mode] || 0) + num(p.amount); });
    });
    const avgInv = invoices.length ? grand / invoices.length : 0;
    // --- chart series (dependency-free SVG) ---
    // Revenue trend: last 14 days
    const trend = [];
    for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const key = localDateStr(d); const rev = invoices.filter((iv) => iv.date === key && deriveStatus(iv) !== 'Cancelled').reduce((s, iv) => s + totalsOf(iv).grand, 0); trend.push({ key, label: `${d.getDate()}/${d.getMonth() + 1}`, rev }); }
    // Top customers by revenue
    const custMap = {};
    invoices.forEach((iv) => { if (deriveStatus(iv) === 'Cancelled') return; const k = iv.customer || '—'; custMap[k] = (custMap[k] || 0) + totalsOf(iv).grand; });
    const topCustomers = Object.entries(custMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
    // Top parts by revenue
    const partMap = {};
    invoices.forEach((iv) => { if (deriveStatus(iv) === 'Cancelled') return; (iv.lines || []).filter((l) => l.kind === 'Part').forEach((l) => { const k = l.desc || '—'; partMap[k] = (partMap[k] || 0) + num(l.qty) * num(l.rate); }); });
    const topParts = Object.entries(partMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { count: invoices.length, grand, paid, outstanding, gstTotal, partsRev, labourRev, profitToday, revToday, invToday, draftCount, pendingCount, monthRev, monthProfit, avgInv, modeSplit, trend, topCustomers, topParts };
  }, [invoices]);

  // `internal` renders the WORKSHOP COPY: it keeps internal annotations such as
  // "(outside purchase)". The CUSTOMER copy never shows them — where a part was
  // sourced from is the workshop's business, not the customer's, and printing it
  // looks unprofessional (and invites questions about margin).
  const downloadPDF = async (iv, printAfter = false, internal = false) => {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const W = 595; const M = 40; const t = totalsOf(iv);
    // PDF-safe money: jsPDF's built-in Helvetica (WinAnsi) has NO Rupee glyph (U+20B9),
    // so "₹" renders as garbage. Use "Rs." + Indian digit grouping, which the built-in
    // font renders perfectly and every Indian workshop/customer reads correctly.
    const money = (n) => `Rs. ${num(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const shop = demoMode ? { ...SHOP, phones: 'XXXXXXXXXX', gst: 'XXXXXXXX', address: 'XXXXXXXX' } : SHOP;
    // QR: short payload (keeps the module count low so each module stays big enough
    // to scan) rendered at high resolution and drawn LARGE on the page. The old one
    // encoded ~81 chars into a 50pt square = 1.35pt per module, which no phone could
    // resolve -> "No usable data found".
    const qrPayload = buildQrPayload({
      kind: 'invoice',
      docNo: iv.invNo,
      shopName: shop.name,
      customer: iv.customer,
      vehicle: iv.regNo || iv.vehicle,
      date: iv.date,
      total: t.grand,
      status: deriveStatus(iv),
    });
    const qrDataUrl = await makeQrDataUrl(qrPayload);
    // ---- Header band
    doc.setFillColor(20, 20, 20); doc.rect(M, 34, W - 2 * M, 62, 'F');
    doc.setTextColor(212, 175, 55); doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.text(shop.name, W / 2, 56, { align: 'center' });
    doc.setTextColor(230, 230, 230); doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.text(shop.tag, W / 2, 68, { align: 'center' });
    doc.setFontSize(7); doc.text(`${shop.phones}   |   GST: ${shop.gst}`, W / 2, 79, { align: 'center' });
    doc.text(shop.address, W / 2, 89, { align: 'center' });
    doc.setFillColor(212, 175, 55); doc.rect(M, 96, W - 2 * M, 2.6, 'F');
    // ---- Title + meta
    doc.setTextColor(20, 20, 20); doc.setFontSize(13); doc.setFont('helvetica', 'bold');
    doc.text(iv.isEstimate ? 'ESTIMATE / QUOTATION' : (iv.gstNo ? 'TAX INVOICE' : 'INVOICE'), M, 124);
    if (internal) {
      doc.setFontSize(7.5); doc.setTextColor(150, 40, 40); doc.setFont('helvetica', 'bold');
      doc.text('WORKSHOP COPY - INTERNAL', M + 150, 124);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(60, 60, 60);
    }
    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(60, 60, 60);
    doc.text(`Invoice No: ${iv.invNo}`, W - M, 114, { align: 'right' });
    doc.text(`Date: ${iv.date}`, W - M, 126, { align: 'right' });
    // ---- Bill-to block
    let by = 146;
    doc.setTextColor(40, 40, 40); doc.setFontSize(9);
    doc.text(`Bill To: ${iv.customer || '-'}${iv.phone ? `   ${iv.phone}` : ''}`, M, by); by += 12;
    if (iv.vehicle) { doc.text(`Vehicle: ${iv.vehicle}${iv.regNo ? ` (${iv.regNo})` : ''}`, M, by); by += 12; }
    if (iv.jobNo) { doc.text(`Job Card: ${iv.jobNo}${iv.advisor ? `   Advisor: ${iv.advisor}` : ''}`, M, by); by += 12; }
    if (iv.gstNo) { doc.text(`Customer GSTIN: ${iv.gstNo}`, M, by); by += 12; }
    // QR sits BELOW the invoice meta text and to the right of the bill-to block, with
    // its own reserved band. It previously started at y=122 with an 88pt height, which
    // ran straight through "Date:" and into the table header (see reported PDF).
    const qrTop = 140;
    if (qrDataUrl) {
      try {
        doc.addImage(qrDataUrl, 'PNG', W - M - QR_PT, qrTop, QR_PT, QR_PT);
        doc.setFontSize(6); doc.setTextColor(150, 150, 150);
        doc.text('Scan to verify', W - M - QR_PT / 2, qrTop + QR_PT + 8, { align: 'center' });
      } catch { /* QR is optional; never break the PDF */ }
    }
    // ---- Line items, split the way an Indian workshop bills:
    //      PARTS USED   (name, qty, rate, amount)   then
    //      LABOUR / SERVICES (service name, amount)  -- no Qty column, because a
    //      "Water Wash" is not 2 units of anything. Only a service explicitly billed
    //      hourly shows Hours x Rate/hr.
    // Mixing them in one table (as the old PDF did) made services look like stock
    // items and confused customers.
    let y = Math.max(by + 8, qrTop + QR_PT + 18);
    const cQty = W - M - 200, cRate = W - M - 120, cAmt = W - M - 6;
    const lineAmt = (l) => num(l.qty) * num(l.rate) * (1 - (num(l.disc) || 0) / 100);
    const pageBreak = () => { if (y > 700) { doc.addPage(); y = 60; } };

    const partLines = (iv.lines || []).filter((l) => l.kind === 'Part' || l.kind === 'Other');
    const svcLines = (iv.lines || []).filter((l) => l.kind === 'Labour' || l.kind === 'Service');
    const otherLines = (iv.lines || []).filter((l) => !['Part', 'Other', 'Labour', 'Service'].includes(l.kind));

    const sectionHeader = (title, withQty) => {
      pageBreak();
      doc.setFillColor(240, 236, 226); doc.rect(M, y - 12, W - 2 * M, 18, 'F');
      doc.setFontSize(8); doc.setTextColor(40, 40, 40); doc.setFont('helvetica', 'bold');
      doc.text(title, M + 6, y);
      if (withQty) { doc.text('QTY', cQty, y, { align: 'center' }); doc.text('RATE', cRate, y, { align: 'right' }); }
      doc.text('AMOUNT', cAmt, y, { align: 'right' });
      doc.setFont('helvetica', 'normal'); y += 18;
    };

    // -- Parts (and outside purchases): full qty x rate breakdown
    if (partLines.length) {
      sectionHeader('PARTS USED', true);
      partLines.forEach((l) => {
        pageBreak();
        doc.setTextColor(30, 30, 30); doc.setFontSize(8.5);
        const label = (internal && l.kind === 'Other') ? `${String(l.desc || '-')} (outside purchase)` : String(l.desc || '-');
        doc.text(label.slice(0, 52), M + 6, y);
        doc.text(String(num(l.qty)), cQty, y, { align: 'center' });
        doc.text(money(l.rate), cRate, y, { align: 'right' });
        doc.text(money(lineAmt(l)), cAmt, y, { align: 'right' });
        doc.setDrawColor(224, 224, 224); doc.line(M, y + 5, W - M, y + 5); y += 17;
      });
      y += 8;
    }

    // -- Labour / services: name + amount only, unless billed hourly
    if (svcLines.length) {
      sectionHeader('LABOUR / SERVICES', false);
      svcLines.forEach((l) => {
        pageBreak();
        doc.setTextColor(30, 30, 30); doc.setFontSize(8.5);
        // A service is hourly if flagged, or (legacy data) if its qty isn't 1.
        const hourly = l.hourly === true || (l.hourly === undefined && num(l.qty) !== 1);
        doc.text(String(l.desc || '-').slice(0, 52), M + 6, y);
        if (hourly) {
          doc.setFontSize(7.5); doc.setTextColor(110, 110, 110);
          doc.text(`${num(l.qty)} hr x ${money(l.rate)}/hr`, cRate, y, { align: 'right' });
          doc.setFontSize(8.5); doc.setTextColor(30, 30, 30);
        }
        doc.text(money(lineAmt(l)), cAmt, y, { align: 'right' });
        doc.setDrawColor(224, 224, 224); doc.line(M, y + 5, W - M, y + 5); y += 17;
      });
      y += 8;
    }

    // -- Anything uncategorised still gets printed; never silently drop a billed line.
    if (otherLines.length) {
      sectionHeader('OTHER CHARGES', true);
      otherLines.forEach((l) => {
        pageBreak();
        doc.setTextColor(30, 30, 30); doc.setFontSize(8.5);
        doc.text(String(l.desc || '-').slice(0, 52), M + 6, y);
        doc.text(String(num(l.qty)), cQty, y, { align: 'center' });
        doc.text(money(l.rate), cRate, y, { align: 'right' });
        doc.text(money(lineAmt(l)), cAmt, y, { align: 'right' });
        doc.setDrawColor(224, 224, 224); doc.line(M, y + 5, W - M, y + 5); y += 17;
      });
      y += 8;
    }
    // ---- Totals block
    y += 8; const lx = W - M - 165;
    const row = (k, v, bold) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(bold ? 10 : 8.5); doc.setTextColor(bold ? 20 : 80, bold ? 20 : 80, bold ? 20 : 80); doc.text(k, lx, y); doc.text(money(v), cAmt, y, { align: 'right' }); y += bold ? 17 : 14; };
    row('Subtotal', t.sub);
    const invDisc = iv.discountType === 'percent' ? t.sub * (num(iv.discount) / 100) : num(iv.discount);
    if (invDisc) row('Discount', -invDisc);
    // GST lines are driven by the invoice's actual computed tax — never by a UI
    // toggle (which lives in the editor scope and isn't available here). This makes
    // downloadPDF self-contained and covers exempt / IGST / CGST+SGST / plain GST.
    if (iv.gstMode === 'exempt') { /* GST exempt — no tax line */ }
    else if (t.isIgst && t.igst > 0.005) row('IGST', t.igst);
    else if (iv.gstNo && (t.cgst > 0.005 || t.sgst > 0.005)) { row('CGST', t.cgst); row('SGST', t.sgst); }
    else if (t.gst > 0.005) row('GST', t.gst);
    if (Math.abs(t.roundOff) > 0.001) row('Round Off', t.roundOff);
    doc.setDrawColor(200, 200, 200); doc.line(lx, y - 6, cAmt, y - 6);
    row('Grand Total', t.grand, true); row('Paid', t.paid); row('Balance Due', t.balance, true);
    if ((iv.payments || []).length) { doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(120, 120, 120); doc.text(`Payments: ${iv.payments.map((p) => `${p.mode} ${money(p.amount)}`).join(',  ')}`.slice(0, 95), M, y + 6); }
    // ---- Footer
    const fy = 792;
    doc.setDrawColor(210, 210, 210); doc.line(M, fy - 34, W - M, fy - 34);
    doc.setFontSize(7.5); doc.setTextColor(120, 120, 120); doc.setFont('helvetica', 'normal');
    doc.text('Thank you for choosing ' + shop.name + '.', M, fy - 22);
    if (iv.isEstimate) doc.text('This is an estimate and not a tax invoice. Prices subject to change.', M, fy - 12);
    else doc.text('Goods once sold will not be taken back. E&OE.', M, fy - 12);
    doc.setDrawColor(180, 180, 180); doc.line(W - M - 150, fy - 20, W - M, fy - 20);
    doc.setFontSize(8); doc.setTextColor(90, 90, 90); doc.text('Authorised Signatory', W - M, fy - 8, { align: 'right' });
    doc.setFontSize(7); doc.setTextColor(150, 150, 150); doc.text('For ' + shop.name, W - M, fy + 1, { align: 'right' });
    if (printAfter) { doc.autoPrint(); window.open(doc.output('bloburl'), '_blank'); } else doc.save(`${iv.invNo}.pdf`);
  };

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <Stat icon={IndianRupee} label="Today's Revenue" value={inr(stats.revToday)} color="#34d399" />
        <Stat icon={Receipt} label="Today's Invoices" value={stats.invToday} color="#60a5fa" />
        <Stat icon={FileText} label="Drafts / Estimates" value={stats.draftCount} color="#a78bfa" />
        <Stat icon={Clock} label="Pending Payments" value={stats.pendingCount} color="#fbbf24" />
        <Stat icon={Wallet} label="Outstanding" value={inr(stats.outstanding)} color="#f87171" />
        <Stat icon={TrendingUp} label="GST Collected" value={inr(stats.gstTotal)} color="#22d3ee" />
        <Stat icon={Receipt} label="Parts Revenue" value={inr(stats.partsRev)} color="#818cf8" />
        <Stat icon={Receipt} label="Labour Revenue" value={inr(stats.labourRev)} color="#f472b6" />
        <Stat icon={TrendingUp} label="Profit Today" value={inr(stats.profitToday)} color="#4ade80" />
        <Stat icon={IndianRupee} label="Avg Invoice" value={inr(stats.avgInv)} color="#94a3b8" />
        <Stat icon={IndianRupee} label="Revenue (Month)" value={inr(stats.monthRev)} color="#d4af37" />
        <Stat icon={TrendingUp} label="Profit (Month)" value={inr(stats.monthProfit)} color="#34d399" />
      </div>

      {invoices.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
          <div className="lg:col-span-2 rounded-2xl p-4" style={cardStyle}>
            <p className="text-xs font-bold uppercase tracking-wide text-white/50 mb-2">Revenue Trend <span className="text-white/30 normal-case font-normal">· last 14 days</span></p>
            <RevenueTrend data={stats.trend} />
            <div className="flex justify-between text-[9px] text-white/30 mt-1">{stats.trend.filter((_, i) => i % 3 === 0).map((d) => <span key={d.key}>{d.label}</span>)}</div>
          </div>
          <div className="rounded-2xl p-4" style={cardStyle}>
            <p className="text-xs font-bold uppercase tracking-wide text-white/50 mb-2">Payment Modes</p>
            {(() => {
              const segs = Object.entries(stats.modeSplit).map(([k, v], i) => ({ label: k, value: v, color: CHART_COLORS[i % CHART_COLORS.length] }));
              const total = segs.reduce((s, x) => s + x.value, 0);
              if (total <= 0) return <p className="text-xs text-white/35 py-6 text-center">No payments recorded yet.</p>;
              return (
                <div className="flex items-center gap-3">
                  <Donut segments={segs} total={total} />
                  <div className="space-y-1 min-w-0 flex-1">{segs.sort((a, b) => b.value - a.value).map((s) => <div key={s.label} className="flex items-center justify-between gap-2 text-[11px]"><span className="flex items-center gap-1.5 min-w-0"><span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} /><span className="text-white/60 truncate">{s.label}</span></span><span className="text-white/45">{Math.round((s.value / total) * 100)}%</span></div>)}</div>
                </div>
              );
            })()}
          </div>
          <div className="rounded-2xl p-4" style={cardStyle}>
            <p className="text-xs font-bold uppercase tracking-wide text-white/50 mb-3">Parts vs Labour</p>
            <BarPair parts={stats.partsRev} labour={stats.labourRev} />
          </div>
          <div className="rounded-2xl p-4" style={cardStyle}>
            <p className="text-xs font-bold uppercase tracking-wide text-white/50 mb-2">Top Customers</p>
            <div className="space-y-1.5">{stats.topCustomers.map(([name, v], i) => <div key={name} className="flex items-center justify-between gap-2 text-[11px]"><span className="text-white/60 truncate">{i + 1}. {name}</span><span className="text-[#d4af37] font-semibold">{inr(v)}</span></div>)}{stats.topCustomers.length === 0 && <p className="text-xs text-white/35">No data.</p>}</div>
          </div>
          <div className="rounded-2xl p-4" style={cardStyle}>
            <p className="text-xs font-bold uppercase tracking-wide text-white/50 mb-2">Top Selling Parts</p>
            <div className="space-y-1.5">{stats.topParts.map(([name, v], i) => <div key={name} className="flex items-center justify-between gap-2 text-[11px]"><span className="text-white/60 truncate">{i + 1}. {name}</span><span className="text-emerald-400 font-semibold">{inr(v)}</span></div>)}{stats.topParts.length === 0 && <p className="text-xs text-white/35">No parts billed yet.</p>}</div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row flex-wrap gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoice, customer, phone, vehicle, reg, VIN, job card, advisor…" className={`${inputCls} pl-9`} />
        </div>
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className={`${inputCls} sm:w-36`}>{['All', 'Draft', 'Estimate', 'Unpaid', 'Partially Paid', 'Paid', 'Cancelled', 'Refunded', 'Returned'].map((s) => <option key={s} style={{ background: '#141414' }}>{s === 'All' ? 'All Status' : s}</option>)}</select>
        <select value={payModeF} onChange={(e) => setPayModeF(e.target.value)} className={`${inputCls} sm:w-32`}>{['All', ...PAYMENT_MODES].map((s) => <option key={s} style={{ background: '#141414' }}>{s === 'All' ? 'All Payments' : s}</option>)}</select>
        <select value={dateF} onChange={(e) => setDateF(e.target.value)} className={`${inputCls} sm:w-28`}>{[['All', 'All Time'], ['Today', 'Today'], ['Week', 'This Week'], ['Month', 'This Month']].map(([v, l]) => <option key={v} value={v} style={{ background: '#141414' }}>{l}</option>)}</select>
        <button onClick={exportCSV} className="h-11 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-white/5 border border-white/10 text-white/75 hover:bg-white/10"><FileDown size={13} /> Export</button>
        {canManage && <button onClick={() => { let px = 'INV'; try { px = JSON.parse(localStorage.getItem('maruti_settings') || '{}').invPrefix || 'INV'; } catch {} setEdit({ ...emptyInvoice(), invNo: nextInvNo(invoices, px) }); }} className="h-11 px-4 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] flex items-center gap-1.5 active:scale-95 transition"><Plus size={14} /> New Invoice</button>}
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 px-3 py-2.5 rounded-xl" style={{ background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.25)' }}>
          <span className="text-xs font-bold text-[#d4af37]">{selected.size} selected</span>
          <button onClick={bulkPDF} className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/75 hover:bg-white/10 flex items-center gap-1"><Printer size={11} /> PDF</button>
          <button onClick={() => bulkExport(false)} className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/75 hover:bg-white/10 flex items-center gap-1"><FileDown size={11} /> Export</button>
          <button onClick={() => bulkExport(true)} className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/75 hover:bg-white/10 flex items-center gap-1"><FileDown size={11} /> GST Export</button>
          <button onClick={bulkReminder} className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-emerald-400/80 hover:bg-white/10 flex items-center gap-1"><Send size={11} /> Payment Reminder</button>
          {canManage && <button onClick={bulkArchive} className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/75 hover:bg-white/10">Archive</button>}
          {isAdmin && <button onClick={bulkDelete} className="text-[11px] px-2.5 py-1 rounded-lg bg-red-500/10 border border-red-500/25 text-red-400 hover:bg-red-500/20 flex items-center gap-1"><Trash2 size={11} /> Delete</button>}
          <button onClick={clearSel} className="text-[11px] px-2.5 py-1 rounded-lg text-white/50 hover:text-white ml-auto">Clear</button>
        </div>
      )}

      <div className="rounded-2xl overflow-hidden" style={cardStyle}>
        <div className="overflow-x-auto hidden md:block">
          <table className="w-full text-sm min-w-[960px]">
            <thead className="sticky top-0 z-10" style={{ background: 'var(--surface-1)' }}>
              <tr className="text-[10px] uppercase tracking-wide text-white/40" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
                <th className="py-2.5 px-3 w-8"><input type="checkbox" checked={paged.length > 0 && paged.every((iv) => selected.has(iv.id))} onChange={(e) => { const n = new Set(selected); paged.forEach((iv) => e.target.checked ? n.add(iv.id) : n.delete(iv.id)); setSelected(n); }} className="accent-[#d4af37]" /></th>
                {['Invoice', 'Date', 'Customer / Vehicle', 'Job Card', 'Total', 'Paid', 'Balance', 'GST', 'Status', 'Actions'].map((h) => <th key={h} className="text-left font-semibold py-2.5 px-3 whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {paged.map((iv) => {
                const t = totalsOf(iv);
                const st = deriveStatus(iv);
                const sc = statusColor(st);
                return (
                  <tr key={iv.id} className="transition hover:bg-white/[0.03]" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.05)' }}>
                    <td className="py-2.5 px-3"><input type="checkbox" checked={selected.has(iv.id)} onChange={() => toggleSel(iv.id)} className="accent-[#d4af37]" /></td>
                    <td className="py-2.5 px-3"><span className="text-[11px] font-bold" style={{ color: iv.isEstimate ? '#a78bfa' : '#d4af37' }}>{iv.invNo}</span></td>
                    <td className="py-2.5 px-3 text-white/60">{iv.date}</td>
                    <td className="py-2.5 px-3"><p className="text-white/85">{iv.customer}</p><p className="text-[10px] text-white/40">{iv.vehicle || iv.phone || '—'}</p></td>
                    <td className="py-2.5 px-3 text-white/55 text-[11px]">{iv.jobNo || '—'}</td>
                    <td className="py-2.5 px-3 text-white/85">{inr(t.grand)}</td>
                    <td className="py-2.5 px-3 text-emerald-400/90">{inr(t.paid)}</td>
                    <td className="py-2.5 px-3"><span style={{ color: t.balance > 0 ? '#f87171' : '#34d399' }}>{inr(t.balance)}</span></td>
                    <td className="py-2.5 px-3 text-white/55 text-[11px]">{inr(t.gst)}</td>
                    <td className="py-2.5 px-3"><span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: `${sc}1f`, color: sc }}>{st}</span></td>
                    <td className="py-2.5 px-3">
                      <div className="flex gap-1">
                        {canManage && <button onClick={() => setEdit(iv)} title="Edit / View" className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/55 hover:bg-white/10"><Eye size={12} /></button>}
                        {canManage && t.balance > 0 && st !== 'Cancelled' && <button onClick={() => setPayFor(iv)} title="Collect Payment" className="w-7 h-7 rounded-lg flex items-center justify-center bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20"><Wallet size={12} /></button>}
                        {canManage && <button onClick={() => duplicateInvoice(iv)} title="Duplicate" className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/55 hover:bg-white/10"><Plus size={12} /></button>}
                        <button onClick={() => downloadPDF(iv, true)} title="Print" className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/55 hover:bg-white/10"><Printer size={12} /></button>
                        <button onClick={() => downloadPDF(iv, false)} title="Download PDF" className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/55 hover:bg-white/10"><FileDown size={12} /></button>
                        {iv.phone && <button onClick={() => window.open(`https://wa.me/91${(iv.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(`Invoice ${iv.invNo} — Total ${inr(t.grand)}, Balance ${inr(t.balance)}. Thank you for choosing Sri Baba Balaji Maruti Care.`)}`, '_blank')} title="WhatsApp" className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-emerald-400/70 hover:bg-white/10"><Send size={12} /></button>}
                        {canManage && (
                          <RowActionsMenu items={[
                            iv.isEstimate && ['Convert to Invoice', FileText, () => convertEstimate(iv)],
                            ['Workshop Copy (internal)', FileDown, () => downloadPDF(iv, false, true)],
                            st !== 'Cancelled' && st !== 'Paid' && ['Cancel Invoice', X, () => changeStatus(iv, 'Cancelled', 'Cancelled')],
                            st === 'Paid' && ['Refund', IndianRupee, () => changeStatus(iv, 'Refunded', 'Refunded')],
                            st !== 'Returned' && st !== 'Cancelled' && ['Return (restore stock)', Receipt, () => changeStatus(iv, 'Returned', 'Returned')],
                            ['View Timeline', Clock, () => setTimelineFor(iv)],
                          ].filter(Boolean)} />
                        )}
                        {canManage && <button onClick={async () => { if (demoMode && !demoCanDelete) { toast('This action has been disabled by the administrator.', { icon: '🔒' }); return; } if (await confirmDialog({ title: `Delete ${iv.invNo}?`, message: 'This cannot be undone.', danger: true, confirmText: 'Delete' })) { onDelete?.(iv); toast.success('Invoice deleted'); } }} title={demoMode && !demoCanDelete ? 'Disabled by administrator' : 'Delete'} className={`w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 ${demoMode && !demoCanDelete ? 'text-white/25' : 'text-red-400/70 hover:bg-red-500/10'}`}><Trash2 size={12} /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={11} className="py-10 text-center text-white/35 text-xs">No invoices match. {canManage && 'Click “New Invoice” to bill a customer.'}</td></tr>}
            </tbody>
          </table>
        </div>
        {/* Mobile: cards instead of a wide horizontal-scroll table */}
        <div className="md:hidden divide-y" style={{ borderColor: 'rgba(var(--fg-rgb),0.06)' }}>
          {paged.map((iv) => {
            const t = totalsOf(iv); const st = deriveStatus(iv); const sc = statusColor(st);
            return (
              <div key={iv.id} className="p-3.5" onClick={() => canManage && setEdit(iv)}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold" style={{ color: iv.isEstimate ? '#a78bfa' : '#d4af37' }}>{iv.invNo}</span>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${sc}1f`, color: sc }}>{st}</span>
                    </div>
                    <p className="text-sm text-white/85 truncate mt-0.5">{iv.customer}</p>
                    <p className="text-[10px] text-white/40 truncate">{iv.vehicle || iv.phone || '—'} · {iv.date}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-white/90">{inr(t.grand)}</p>
                    {t.balance > 0 ? <p className="text-[10px] text-red-400">Due {inr(t.balance)}</p> : <p className="text-[10px] text-emerald-400">Paid</p>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mt-2.5" onClick={(e) => e.stopPropagation()}>
                  {canManage && <button onClick={() => setEdit(iv)} className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold bg-white/5 border border-white/10 text-white/70 flex items-center justify-center gap-1"><Eye size={12} /> View</button>}
                  {canManage && t.balance > 0 && st !== 'Cancelled' && <button onClick={() => setPayFor(iv)} className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 flex items-center justify-center gap-1"><Wallet size={12} /> Collect</button>}
                  <button onClick={() => downloadPDF(iv, false)} title="PDF" className="w-8 py-1.5 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60"><FileDown size={12} /></button>
                  {iv.phone && <button onClick={() => window.open(`https://wa.me/91${(iv.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(`Invoice ${iv.invNo} — Total ${inr(t.grand)}, Balance ${inr(t.balance)}.`)}`, '_blank')} title="WhatsApp" className="w-8 py-1.5 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-emerald-400/70"><Send size={12} /></button>}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="py-10 text-center text-white/35 text-xs">No invoices match. {canManage && 'Tap “New Invoice” to bill a customer.'}</div>}
        </div>
        <div className="flex items-center justify-between px-4 py-3 gap-2 flex-wrap" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.06)' }}>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-white/40">Showing {filtered.length ? (page - 1) * PER + 1 : 0}–{Math.min(page * PER, filtered.length)} of {filtered.length}</span>
            <select value={PER} onChange={(e) => setPER(Number(e.target.value))} className="h-7 px-1.5 rounded-lg text-[11px] bg-white/5 border border-white/10 text-white/70 outline-none">{[10, 25, 50, 100].map((n) => <option key={n} value={n} style={{ background: '#141414' }}>{n} / page</option>)}</select>
          </div>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 disabled:opacity-30"><ChevronDown size={14} className="rotate-90" /></button>
            <span className="text-xs text-white/60">{page} / {pageCount}</span>
            <button disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)} className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 disabled:opacity-30"><ChevronDown size={14} className="-rotate-90" /></button>
          </div>
        </div>
      </div>

      {payFor && <PaymentModal invoice={payFor} onCollect={collectPayment} onClose={() => setPayFor(null)} />}
      {timelineFor && (
        <div className="fixed inset-0 z-[130] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(3px)' }} onClick={() => setTimelineFor(null)}>
          <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
              <h3 className="text-base font-bold text-white">{timelineFor.invNo} · Timeline</h3>
              <button onClick={() => setTimelineFor(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10"><X size={17} /></button>
            </div>
            <div className="p-5 max-h-[60vh] overflow-y-auto dark-scroll">
              {(timelineFor.history || []).length === 0 ? <p className="text-sm text-white/40 text-center py-6">No history recorded yet.</p> : (
                <div className="space-y-3">
                  {[...(timelineFor.history || [])].reverse().map((h, i) => (
                    <div key={i} className="flex gap-3">
                      <div className="flex flex-col items-center"><span className="w-2.5 h-2.5 rounded-full bg-[#d4af37] mt-1" />{i < (timelineFor.history.length - 1) && <span className="w-px flex-1 bg-white/10 my-1" />}</div>
                      <div className="pb-1"><p className="text-sm text-white/85">{h.action}</p><p className="text-[10px] text-white/40">{new Date(h.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}{h.by ? ` · ${h.by}` : ''}</p></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {edit && <InvoiceModal initial={edit} invoices={invoices} customers={customers} inventory={inventory} jobCards={jobCards} demoMode={demoMode} onQuickCustomer={onQuickCustomer} onQuickVehicle={onQuickVehicle} onDownloadPDF={downloadPDF} onDuplicate={(iv) => { setEdit(null); setTimeout(() => duplicateInvoice(iv), 60); }} onCreditNote={(iv) => { setEdit(null); setTimeout(() => changeStatus(iv, 'Returned', 'Returned'), 60); }} onSave={(iv, thenPay) => { onPersist?.(iv); setEdit(null); toast.success(`${iv.isEstimate ? 'Estimate' : 'Invoice'} ${iv.invNo} saved`); if (thenPay) setTimeout(() => setPayFor(iv), 120); }} onClose={() => setEdit(null)} />}
    </div>
  );
}

export { totalsOf };
