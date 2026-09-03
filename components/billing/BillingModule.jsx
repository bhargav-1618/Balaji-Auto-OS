// components/billing/BillingModule.jsx — invoices with line items, GST, payments.
// Writes back to customers (totalSpent += paid, outstanding += balance) so the
// Customers/Reminders/Dashboard figures stay live. Local persistence per
// workspace (invoices prop + onPersist/onDelete), mirroring Job Cards/Customers.
import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import toast from '../../lib/toast';
import { confirmDialog } from '../common/ConfirmDialog';
import { lockBody, unlockBody } from '../Modal';
import { buildQrPayload, makeQrDataUrl, QR_PT } from '../../lib/pdfQr';
import { PDF_PAGE, PDF_RULE, SHOP, maskShop, liveShop, drawPdfHeader, drawPdfPageNumber } from '../../lib/pdfTheme';
import { renderWorkshopInvoicePdf } from '../../lib/workshopInvoicePdf';
import { tsToDate, localDateStr, displayDate , num, isIndianMobile, isValidEmail, MOBILE_ERROR, EMAIL_ERROR } from '../../lib/format';
import SearchSelect from '../common/SearchSelect';
import MiniSelect from '../common/MiniSelect';
import VehicleMakeModelSelect from '../common/VehicleMakeModelSelect';
import DropdownPanel, { ModalBoundaryContext } from '../common/DropdownPanel';
import ActionMenu from '../common/ActionMenu';
import PageHeader from '../common/PageHeader';
import { useEditLease } from '../../hooks/useEditLease';
import { useRecordSync } from '../../hooks/useRecordSync';
import { useLeaseReleaseToast } from '../../hooks/useLeaseReleaseToast';
import { revOf } from '../../lib/concurrency';
import EditLeaseBanner from '../common/EditLeaseBanner';
import EditAvailableBar from '../common/EditAvailableBar';
import RecordUpdatedNotice from '../common/RecordUpdatedNotice';
import RecordConflictBanner from '../common/RecordConflictBanner';
import ConflictReviewDialog from '../common/ConflictReviewDialog';
import { useTranslation } from '../../lib/i18n';
import CapacityBanner from '../common/CapacityBanner';
import CapacityCleanupModal from '../common/CapacityCleanupModal';
import { checkCapacityGuard } from '../../lib/useCapacity';
import notify from '../common/notify';
import { writeSheet, asDate, stamp } from '../../lib/exportSheet';
import { useDeferredSearch, matchIndexed, normId, useSearchIndex, searchAndRank, rankIndexed } from '../../lib/useSearch';
import { resolveSelectedRecords, countHiddenSelections } from '../../lib/selectionScope';
import { statusColor, SHELL_WIDTH_CLS, SEMANTIC } from '../../constants/ui';
import { BILLABLE_JOB_CARD_STATUSES } from '../../constants';
import { isValidGstin, GSTIN_ERROR } from '../../lib/gst';
import Badge from '../common/Badge';
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
function LineRowBase({ l, setLine, delLine, dupLine, moveLine, clearPartLink, inventory, discountEnabled, gstEnabled, defaultGst, priceOverride = true, pricingLocked = false }) {
  // Parts review (Issue 3.1/3.2) — "Move to Parts/Labour/Outside" used to be three
  // always-visible buttons next to Duplicate/Remove on EVERY row, regardless of how
  // rarely a given line actually needs reclassifying. Consolidated into the same
  // shared ActionMenu every other row-actions menu in this app already uses (see the
  // header comment above Portal below) — Duplicate/Remove stay always-visible since
  // those really are used on nearly every line.
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const moveMenuAnchorRef = useRef(null);
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
  // Settings QA fix: Demo Permissions' "Edit Pricing" ("Allow changing rates,
  // discounts and line pricing on invoices") saved but gated nothing — every
  // demo session could freely edit rate/discount regardless of the toggle.
  // pricingLocked is the demo-only half of this; priceOverride is the separate,
  // pre-existing Billing-settings concept for whether a linked part's catalogue
  // price can be overridden at all — the two stack rather than replace each other.
  const rateEditable = (!isInvPart || priceOverride) && !pricingLocked;
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
          <span className="block text-[9px] uppercase tracking-wide text-white/45 mb-0.5">{isLabour ? 'Service Description' : isInvPart ? 'Part (linked to inventory)' : 'Item Description'}</span>
          <input value={l.desc} onChange={(e) => setLine(l.id, { desc: e.target.value })} placeholder={isLabour ? 'e.g. Engine oil change' : 'Item name'} className={`${inputCls} py-2`} />
          {/* Parts review (Issue 3.1) — locking this field outright would break the
              legitimate reason it stays editable (see comment above); the real concern
              was ambiguity between what's printed and which master record it's linked
              to. Surfacing the catalogue name whenever the two diverge resolves that
              without giving up the ability to annotate a line. */}
          {isInvPart && invPart?.name && invPart.name !== l.desc && (
            <span className="block text-[9px] text-white/45 mt-0.5 truncate">Catalogue: {invPart.name}</span>
          )}
        </label>

        {/* Flat-priced services have no quantity — the owner types the charge directly.
            Only show Hours when the line has been explicitly switched to hourly. */}
        {(!isLabour || isHourly) && (
          <label className="w-16">
            <span className="block text-[9px] uppercase tracking-wide text-white/45 mb-0.5">{isLabour ? 'Hours' : 'Qty'}</span>
            <input value={l.qty} inputMode="decimal" onChange={(e) => setLine(l.id, { qty: e.target.value.replace(/[^\d.]/g, '') })} placeholder={isLabour ? 'Hrs' : 'Qty'} className={`${inputCls} py-2 text-center ${qtyExceeds ? 'border-amber-500/60' : ''}`} />
          </label>
        )}

        <label className={isLabour && !isHourly ? 'w-28' : 'w-24'}>
          <span className="block text-[9px] uppercase tracking-wide text-white/45 mb-0.5">{isLabour ? (isHourly ? 'Rate/hr' : 'Amount ₹') : 'Rate'}</span>
          <input value={l.rate} inputMode="decimal" disabled={!rateEditable}
            onChange={(e) => setLine(l.id, { rate: e.target.value.replace(/[^\d.]/g, ''), approvedBelowFloor: false })}
            placeholder="Rate" title={rateEditable ? undefined : pricingLocked ? 'This action has been disabled by the administrator.' : 'Price override is disabled in Billing settings'}
            className={`${inputCls} py-2 text-right ${belowFloor && !l.approvedBelowFloor ? 'border-red-500/60' : ''} ${!rateEditable ? 'opacity-60 cursor-not-allowed' : ''}`} />
        </label>

        {discountEnabled && (
          <label className="w-16">
            <span className="block text-[9px] uppercase tracking-wide text-white/45 mb-0.5">Disc %</span>
            <input value={l.disc} inputMode="decimal" disabled={pricingLocked}
              onChange={(e) => setLine(l.id, { disc: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0"
              title={pricingLocked ? 'This action has been disabled by the administrator.' : undefined}
              className={`${inputCls} py-2 text-center ${pricingLocked ? 'opacity-60 cursor-not-allowed' : ''}`} />
          </label>
        )}

        {/* GST is NOT shown on labour by default — a human service isn't a taxed
            inventory item for most small workshops. It can be enabled per line. */}
        {gstEnabled && showTax && (
          <label className="w-28">
            <span className="block text-[9px] uppercase tracking-wide text-white/45 mb-0.5">GST</span>
            {/* Universal dropdown architecture review — native <select> is a browser-owned
                popup, immune to this app's theming/containment. `width` below widens only
                the popup itself, not this trigger.
                Parts review (Issue 3.4): the trigger was w-20 (80px), which combined with
                MiniSelect's own reserved icon padding left only a few px of real text room
                — enough for "18%" but not "No GST" (the label for 0%), which is exactly the
                truncated-value complaint ("1…"). Widened to fit the longest label without
                truncating; still narrower than Description, matching every other short
                numeric field on this row. */}
            <MiniSelect
              value={String(l.gst != null ? l.gst : defaultGst)}
              options={['0', '5', '12', '18', '28']}
              labels={{ '0': 'No GST', '5': '5%', '12': '12%', '18': '18%', '28': '28%' }}
              emptyValue={String(defaultGst)}
              onPick={(v) => setLine(l.id, { gst: Number(v || defaultGst) })}
              inputCls={`${inputCls} py-2 px-1`}
              width={140}
            />
          </label>
        )}

        {gstEnabled && showTax && (
          <label className="w-24">
            <span className="block text-[9px] uppercase tracking-wide text-white/45 mb-0.5">{isLabour ? 'SAC' : 'HSN'}</span>
            <input value={l.hsn || ''} onChange={(e) => setLine(l.id, { hsn: e.target.value.replace(/[^0-9]/g, '').slice(0, 8) })} placeholder="Code" className={`${inputCls} py-2`} />
          </label>
        )}

        <div className="ml-auto text-right min-w-[88px]">
          <span className="block text-[9px] uppercase tracking-wide text-white/45 mb-0.5">Total</span>
          <span className="block text-base font-bold text-white pb-1.5">{inr(lineTotal)}</span>
        </div>
      </div>

      {/* Outside Purchase traceability (Issue 4.6) — an outside-purchase item has no
          inventory record backing it, so unlike a Part line it carries no supplier/
          audit trail at all otherwise. Free-text rather than a supplier picker: this
          module has no `suppliers` prop wired in (workshop suppliers live in the
          Inventory module), and a real picker integration is a larger cross-module
          change than this traceability gap needs — a name and a reference number is
          what an audit actually asks for. Optional, so it never blocks billing. */}
      {l.kind === 'Other' && (
        <div className="flex flex-wrap items-end gap-x-2 gap-y-1.5 mt-1.5">
          <label className="flex-1 min-w-[140px]">
            <span className="block text-[9px] uppercase tracking-wide text-white/45 mb-0.5">Supplier (optional)</span>
            <input value={l.supplierName || ''} onChange={(e) => setLine(l.id, { supplierName: e.target.value })} placeholder="Who was this bought from?" className={`${inputCls} py-2`} />
          </label>
          <label className="flex-1 min-w-[140px]">
            <span className="block text-[9px] uppercase tracking-wide text-white/45 mb-0.5">Purchase Ref. (optional)</span>
            <input value={l.purchaseRef || ''} onChange={(e) => setLine(l.id, { purchaseRef: e.target.value })} placeholder="Their invoice / bill no." className={`${inputCls} py-2`} />
          </label>
        </div>
      )}

      {/* Inline notices: stock limit, price override vs catalogue, floor approval. */}
      {(qtyExceeds || belowFloor || overridden) && (
        <div className="flex flex-wrap items-center gap-2 mt-1.5 px-0.5">
          {qtyExceeds && <span className="text-[10px] text-amber-400">Only {avail} in stock — billing {num(l.qty)}.</span>}
          {overridden && (
            <span className="text-[10px] text-white/45">
              Catalogue {inr(listPrice)} → billed {inr(num(l.rate))}
              {!pricingLocked && <button type="button" onClick={() => setLine(l.id, { rate: listPrice, approvedBelowFloor: false })} className="ml-1.5 font-bold text-[#d4af37] hover:underline">reset</button>}
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
        <button ref={moveMenuAnchorRef} type="button" onClick={() => setMoveMenuOpen((v) => !v)} title={`Reclassify this line (currently ${kindLabel})`} aria-haspopup="menu" aria-expanded={moveMenuOpen} className="text-[10px] px-2.5 py-1.5 min-h-[30px] rounded-lg bg-white/5 border border-white/10 text-white/55 hover:bg-white/10 hover:text-white/80 flex items-center gap-1">
          <MoreVertical size={10} /> {kindLabel}
        </button>
        {moveMenuOpen && (
          <ActionMenu anchorRef={moveMenuAnchorRef} open onClose={() => setMoveMenuOpen(false)} items={[
            { type: 'section', label: 'Move to' },
            l.kind !== 'Part' && { type: 'item', label: 'Parts', onClick: () => moveLine?.(l.id, 'Part') },
            l.kind !== 'Labour' && { type: 'item', label: 'Labour & Services', onClick: () => moveLine?.(l.id, 'Labour') },
            l.kind !== 'Other' && { type: 'item', label: 'Outside Purchase', onClick: () => moveLine?.(l.id, 'Other') },
          ]} />
        )}
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

// UNIVERSAL ISSUE U3 (overflow-menu unification): this used to be a fully independent
// row-actions dropdown — its own Portal, its own flip/clamp positioning math duplicating
// DropdownPanel, and its own single-active-menu registry scoped only to this component
// (a self-contained component per row was the only way to give each row its own open/
// close hook state without lifting anything into the parent). It had the richest feature
// set of the app's three menu implementations (keyboard arrow-nav, section dividers,
// disabled+reason tooltips), which is exactly why it became the reference implementation
// for the new shared components/common/ActionMenu.jsx — that component now owns all of
// the above (positioning via the shared DropdownPanel primitive instead of reimplementing
// it, keyboard nav lifted from here, and a single-open registry that now spans every
// ActionMenu instance app-wide, not just this module's own rows). ActionMenu is a
// controlled component (matching DropdownPanel's own convention and every other call
// site in the app), so the per-row open/close state that used to live inside this
// component now lives in BillingModule itself as `rowMenuFor` — the exact same "one
// state variable holding which row is open" pattern already used by Vehicles/Customers/
// Job Cards, rather than a bespoke per-row component. One behavior note: DropdownPanel
// repositions the menu on scroll instead of closing it (this component used to close on
// any scroll) — matching every other menu in the app, and strictly better UX (a menu
// that survives an incidental scroll instead of vanishing), not a regression.

// SHOP moved to lib/pdfTheme.js — GLOBAL PDF FRAMEWORK: this was retyped by hand here
// and in JobCardModule.jsx with drifted tagline/phones/address text (this copy was
// missing the "TRUSTED FOR OVER 25 YEARS" tagline suffix, a third phone number, and
// the email/website fields entirely) between two documents from the same shop — one
// canonical source now, imported above.
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
// CONCURRENCY PHASE 2 — the AUTHORITATIVE INV-/EST- number is now allocated at SAVE
// TIME by a Firestore transaction on `counters/<sequence>` (lib/docCounter.js, via
// store.allocateNumber in persistInvoice). The editor no longer previews a number.
//
// `invSeqMax` / `nextInvNo` remain for:
//   - the `seedFrom` value handed to the transaction (highest known + 1), so a
//     missing/lagging counter initialises itself correctly, and
//   - DRF- drafts, which are a throwaway internal handle (never a GST serial, and a
//     clash loses no data — the doc id is unique) and stay client-side.
const invSeqMax = (list, prefix) => {
  const px = String(prefix || 'INV').toUpperCase();
  return (list || []).reduce((max, i) => {
    const m = String(i.invNo || '').match(/^([A-Za-z]+)-(\d+)$/);
    if (!m || m[1].toUpperCase() !== px) return max;   // ONLY this exact prefix
    return Math.max(max, parseInt(m[2], 10) || 0);
  }, 0);
};
const nextInvNo = (list, prefix = 'INV') => {
  const px = String(prefix || 'INV').toUpperCase();
  return `${px}-${String(invSeqMax(list, px) + 1).padStart(4, '0')}`;
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
// Shared by InvoiceModal's linkJobCard (Job Card search inside an already-open invoice)
// AND BillingModule's own cross-module prefill effect below (the Job Cards module's
// "Generate Invoice" quick action) — a job card's parts/labour must import identically
// no matter which entry point brought it onto an invoice. Before this was extracted,
// the "Generate Invoice" path had its own, separate prefill that carried only
// customer/vehicle/jobNo, silently dropping every part, labour line, advisor and
// technician the job card already had recorded (Job Card review, Issue 2.3/2.4).
const buildJobCardImportLines = (jc, inventory) => {
  const jcLines = [];
  (jc.parts || []).forEach((p) => { const inP = inventory.find((x) => x.id === p.partId); jcLines.push({ ...emptyLine('Part'), desc: p.name || inP?.name || 'Part', qty: p.qty || 1, rate: num(p.rate || inP?.defaultSellingPrice || inP?.sellingPrice), partId: p.partId, floorPrice: num(inP?.minSellingPrice), purchasePrice: num(inP?.purchasePrice), mrp: num(inP?.mrp) }); });
  (jc.labour || []).forEach((lb) => { if (lb.service) jcLines.push({ ...emptyLine('Labour'), desc: lb.service, qty: num(lb.hours) || 1, rate: num(lb.rate), category: 'General Service' }); });
  return jcLines;
};
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
// statusColor now comes from constants/ui.js — ONE map shared with Job Cards, Vehicles
// and Inventory, so the same status word cannot render as two different colours on two
// pages. Every hex is unchanged (see the note there about 'Cancelled').
// CONCURRENCY PHASE 1c — invoice fields whose "another user changed this" diff is
// worth showing in the review (compared record-vs-record; mode="review", no auto
// field merge — payments/totals/status are transaction-managed and excluded).
const INVOICE_CONFLICT_FIELDS = [
  { key: 'customer', label: 'Customer' },
  { key: 'phone', label: 'Phone' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'regNo', label: 'Reg. number' },
  { key: 'odometer', label: 'Odometer' },
  { key: 'advisor', label: 'Advisor' },
  { key: 'technician', label: 'Technician' },
  { key: 'discount', label: 'Discount' },
  { key: 'lines', label: 'Line items', format: (v) => `${(v || []).length} line${(v || []).length === 1 ? '' : 's'}` },
  { key: 'notes', label: 'Notes' },
  { key: 'terms', label: 'Terms' },
  { key: 'isEstimate', label: 'Is estimate', format: (v) => (v ? 'Yes' : 'No') },
];

const emptyInvoice = () => ({
  id: `inv_${Date.now()}_${Math.floor(Math.random() * 1e4)}`, invNo: '', date: localDateStr(),
  customerId: '', customer: '', phone: '', email: '', gstNo: '', address: '',
  vehicle: '', regNo: '', vin: '', engineNo: '', odometer: '',
  jobCardId: '', jobNo: '', advisor: '', technician: '',
  gstPct: 18, gstMode: 'auto', discount: 0, discountType: 'flat',
  lines: [emptyLine('Part')], payments: [], paid: 0, status: 'Draft', isEstimate: false, estimateValidTill: '', notes: '', terms: '',
  history: [], createdAt: Date.now(),
});

function Field({ label, children, className = '', error }) {
  return <div className={`min-w-0 ${className}`}><label className="block text-[10px] uppercase tracking-wide text-white/45 mb-1.5">{label}</label>{children}{error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}</div>;
}
function Stat({ icon: Icon, label, value, color }) {
  // Mobile QA fix: this value <p> had no whitespace-nowrap/tabular-nums, so a long
  // currency figure (₹4,89,212.64) wrapped mid-digit at the narrow 2-col phone width —
  // "₹4,89,21" / "2.64" split across two lines. Same fix as Vehicles' own Stat
  // component: nowrap the value and shrink a step for ones that still don't fit,
  // rather than letting a number ever break across lines.
  const text = String(value ?? '');
  const size = text.length > 9 ? 'text-sm' : text.length > 6 ? 'text-base' : 'text-lg';
  return (
    <div className="rounded-2xl p-3.5 flex items-center gap-3" style={cardStyle}>
      <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${color}1f`, color }}><Icon size={18} /></span>
      <div className="min-w-0"><p className="text-[10px] uppercase tracking-wide text-white/45 truncate">{label}</p><p className={`${size} font-bold text-white leading-tight whitespace-nowrap tabular-nums`}>{value}</p></div>
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
  // Settings QA fix: these two used raw qty*rate (gross), not net-of-line-discount —
  // so a discounted line's Parts/Labour revenue split didn't match the Subtotal it's
  // supposed to add up to (and, since these same figures drive the Billing KPI cards'
  // "Parts Revenue"/"Labour Revenue" and Reports/Analytics, any discounted line
  // inflated reported revenue by exactly the discount amount, invoice after invoice).
  // Same net = gross - lineDisc as the `sub` loop above, so Parts + Labour === sub.
  const netOfLine = (l) => { const gross = num(l.qty) * num(l.rate); const lineDisc = l.disc ? gross * (num(l.disc) / 100) : 0; return Math.max(0, gross - lineDisc); };
  const partsRev = lines.filter((l) => l.kind === 'Part').reduce((s, l) => s + netOfLine(l), 0);
  const labourRev = lines.filter((l) => l.kind === 'Labour').reduce((s, l) => s + netOfLine(l), 0);
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
  // BUG-LIVE-002: an OVERPAID invoice's books do not balance — `t.balance` is floored
  // to 0 by Math.max(0, …), which used to read as "Paid" (and then locked the invoice).
  // Overpayment is an error state, never "Paid"; the excess is surfaced separately as
  // "Overpaid by ₹X". 0.5 slack absorbs rounding.
  if (t.grand > 0 && t.paid > t.grand + 0.5) return 'Partially Paid';
  if (t.balance <= 0 && t.grand > 0) return 'Paid';
  if (t.paid > 0) return 'Partially Paid';
  return inv.status === 'Draft' ? 'Draft' : 'Unpaid';
};

function Section({ title, sub, children, defaultOpen = true, badge }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-4 py-2.5 text-left">
        <span className="flex items-center gap-2"><span className="text-sm font-bold text-white/85">{title}</span>{badge != null && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#d4af37]/15 text-[#d4af37] font-bold">{badge}</span>}{sub && <span className="text-[11px] text-white/45">{sub}</span>}</span>
        <ChevronDown size={16} className={`text-white/45 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function InvoiceModal({ initial, invoices, customers, inventory, jobCards = [], onSave, onClose, demoMode, demoCanEditPricing = true, onQuickCustomer, onQuickVehicle, onDownloadPDF, onDuplicate, onCreditNote, readOnly = false, banner = null }) {
  // Billing settings (admin-controlled): GST & discount can be switched off entirely.
  const SETTINGS_KEY = demoMode ? 'maruti_settings_demo' : 'maruti_settings';
  const billingCfg = useMemo(() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; } }, [SETTINGS_KEY]);
  const gstEnabled = billingCfg.gstOptional !== false; // default on; admin can disable
  const discountEnabled = billingCfg.discountOptional !== false;
  // Rate override on inventory parts. Default ON: an Indian workshop routinely bills
  // a part above/below its catalogue price (negotiation, old stock, loyal customer).
  // The catalogue price is preserved on the line as `listPrice` so reporting can
  // show BOTH the original selling price and what was actually billed.
  const priceOverride = billingCfg.priceOverride !== false;
  // Settings QA fix: Demo Permissions' "Edit Pricing" saved but gated nothing —
  // demoCanEditPricing arrives already resolved for demoAdmin/production (see
  // demoCan() in InventoryDashboard.js), so this is just "are we a Demo User
  // the owner has NOT granted this to."
  const pricingLocked = demoMode && !demoCanEditPricing;
  const defaultGst = billingCfg.defaultTax !== undefined && billingCfg.defaultTax !== '' ? Number(billingCfg.defaultTax) : 18;
  // Settings QA fix: Default Labour Rate/Default Discount % saved into
  // biz.labourRate/biz.defaultDiscount correctly but had no consumer anywhere —
  // addLine() below always started every new line at rate:0, disc:0 regardless.
  // Same "override emptyLine()'s pure defaults at the one place billingCfg is in
  // scope" pattern already used for defaultGst just above.
  const defaultLabourRate = billingCfg.labourRate !== undefined && billingCfg.labourRate !== '' ? Number(billingCfg.labourRate) : 0;
  const defaultDiscountPct = billingCfg.defaultDiscount !== undefined && billingCfg.defaultDiscount !== '' ? Number(billingCfg.defaultDiscount) : 0;
  const DRAFT_KEY = `maruti_invoice_draft_${initial.id}`;
  const restoredRef = useRef(false);
  // Issue 1 (Add Vehicle popup architecture review) — this full-screen editor's own
  // root, for consistency with every other modal shell (see ModalBoundaryContext in
  // components/common/DropdownPanel.jsx). Lower practical impact here since the
  // panel is already near-viewport-sized, but keeps the fix universal.
  const modalRef = useRef(null);
  // Payments/Validation review (Issue 5.3) — this used to gate on `!initial.invNo`,
  // meant to mean "a brand-new, unsaved invoice." That was already wrong when the
  // editor pre-allocated a preview number; under Phase 2 a new invoice carries NO
  // number at all until it is saved, so `invNo` is a doubly-unreliable signal here.
  // The real signal for "does this invoice already have a safe copy elsewhere" is
  // whether it exists in the persisted `invoices` list — a DRF-/INV- string can be
  // present on an invoice nobody has saved yet, and absent on a brand-new one.
  const isPersisted = invoices.some((x) => x.id === initial.id);
  const [inv, setInvRaw] = useState(() => {
    // Restore an autosaved draft for any invoice not yet actually persisted.
    // localStorage (not session) so the draft survives a browser crash, tab close
    // or machine restart — real workshops get interrupted constantly and shouldn't
    // lose a half-built bill.
    if (!isPersisted) {
      try {
        const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
        if (d && d.id === initial.id) { restoredRef.current = true; return d; }
      } catch {}
    }
    return initial;
  });
  useEffect(() => { if (restoredRef.current) notify.info('Unsaved draft restored.'); }, []);
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
  // Validation review (Issue 5.4) — every validation in save() was a toast popup with
  // no way to find the field it was complaining about. Customer-required is the FIRST
  // check and by far the most common failure (an empty invoice with items added but no
  // customer yet), so it's the one worth a real "take me there" — SearchSelect doesn't
  // forward a ref its caller can call .focus() on, so scroll-into-view + a brief ring
  // is the achievable equivalent here, not a full per-field error system for every one
  // of save()'s ~10 checks (most are rare edge cases a toast already serves fine).
  const customerFieldRef = useRef(null);
  const [customerFieldFlash, setCustomerFieldFlash] = useState(false);
  const partAnchorRef = useRef(null);   // Issue 5: anchor for the portalled parts dropdown
  const setLine = (id, patch) => setInv((s) => ({ ...s, lines: s.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  // Labour review (Issue 4.2) — COMMON_SERVICES is a fixed list; a workshop's own
  // most-billed services (or ones outside that list entirely) got no shortcut at
  // all otherwise. Tracks the last few DISTINCT service names actually billed,
  // workshop-wide rather than per-invoice — demo/production data must never mix,
  // the same convention Billing settings already use for their own localStorage key.
  const RECENT_LABOUR_KEY = demoMode ? 'maruti_recent_services_demo' : 'maruti_recent_services';
  const [recentServices, setRecentServices] = useState(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_LABOUR_KEY) || '[]'); } catch { return []; }
  });
  const addLine = (kind, desc = '') => {
    // Settings QA fix (continued): emptyLine() hardcodes gst:18 for every non-Labour
    // kind, which pre-empted LineRowBase's own `l.gst != null ? l.gst : defaultGst`
    // fallback (18 is never null, so defaultGst was unreachable dead code for any
    // freshly created line) — same shape of bug as rate/disc above, fixed the same
    // way: override with the real Settings-driven value at creation, not left to a
    // fallback that can never fire. Labour intentionally starts untaxed (gst: 0) —
    // GST on labour is an explicit opt-in via the "Add GST" toggle, unrelated to
    // Default GST %, which is a Parts-line concept.
    set({ lines: [...inv.lines, { ...emptyLine(kind), desc, rate: kind === 'Labour' ? defaultLabourRate : 0, disc: defaultDiscountPct, gst: kind === 'Labour' ? 0 : defaultGst }] });
    if (kind === 'Labour' && desc.trim()) {
      setRecentServices((prev) => {
        const next = [desc.trim(), ...prev.filter((s) => s !== desc.trim())].slice(0, 6);
        try { localStorage.setItem(RECENT_LABOUR_KEY, JSON.stringify(next)); } catch {}
        return next;
      });
    }
  };
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
      notify.info('Pick the item from inventory so stock and cost are tracked.');
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
    notify.info('Search and pick the replacement part.');
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
    // Settings QA fix: fell back to a hardcoded 18 when the part itself carries no
    // GST rate, silently ignoring Settings -> Billing -> Default GST %. The part's
    // OWN rate (if it has one) still correctly wins — this only changes what a
    // part with no configured rate falls back to.
    gst: Number(p.gst) || defaultGst,
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
      disc: defaultDiscountPct,
      ...partLineData(p),
      qty: 1,
    };
    set({ lines: [...inv.lines.filter((l) => l.desc.trim() || l.rate), line] });
  };
  const t = totalsOf(inv);
  // Smart-action state: is there anything worth saving, and is it fully paid?
  const hasBillItems = inv.lines.some((l) => l.desc.trim() && num(l.rate) > 0);
  const canSave = !readOnly && !!(inv.customer && inv.customer.trim()) && hasBillItems;
  // GSTIN is optional here (a customer may not be GST-registered), but if entered it
  // must be a real GSTIN — same canonical rule as Customers/Suppliers (lib/gst.js).
  const gstNoErr = inv.gstNo && !isValidGstin(inv.gstNo) ? GSTIN_ERROR : null;
  // Issue 3 (Billing New Invoice workflow review) — the Customer field used to
  // render an existing-customer SearchSelect AND a plain walk-in name <input>
  // simultaneously, both bound to the same inv.customer/customerId, with nothing
  // distinguishing which one an operator was "supposed" to use — typing in one
  // silently overwrote whatever was in the other. A segmented toggle shows exactly
  // one input at a time; it changes nothing about inv.customer/customerId/canSave
  // or either input's own onChange handler, only which single one is visible.
  // Defaults to whichever mode matches the invoice as loaded (an existing customer
  // already linked opens in Search mode; anything else — a fresh invoice or an
  // existing walk-in draft — opens in Walk-in mode).
  const [custMode, setCustMode] = useState(() => (inv.customerId ? 'search' : 'walkin'));
  // OVERPAYMENT (Issue 3). `t.balance` is floored with Math.max(0, …), so collecting
  // ₹5,000 against a ₹4,799 invoice produced balance = ₹0 — indistinguishable from a
  // correctly settled bill. The header then flipped to "Mark as Paid" and one click
  // locked an invoice whose books were ₹201 out. The excess must be visible, not floored.
  const collected = (inv.payments || []).reduce((s, p) => s + num(p.amount), 0);
  const overpayBy = Math.max(0, collected - t.grand);
  const overpaid = t.grand > 0 && collected > t.grand + 0.5; // ₹0.50 slack for rounding
  const negativePayment = (inv.payments || []).some((p) => num(p.amount) < 0);
  const paymentsInvalid = overpaid || negativePayment;
  // An overpaid invoice is NEVER "fully paid". It is wrong, and it must not be settleable.
  const fullyPaid = t.balance <= 0.5 && t.grand > 0 && !paymentsInvalid;
  // A saved, fully-paid (or cancelled/refunded) invoice is locked — read-only
  // history. Estimates and unpaid/partially-paid invoices stay editable.
  // BUG-LIVE-002/004: lock on ACTUAL persistence, not on `inv.invNo`. Every entry
  // point (New Invoice, Job Card prefill) pre-allocates an invoice NUMBER before this
  // modal opens, so `inv.invNo` is truthy for a brand-new unsaved invoice — which made
  // a new-but-overpaid invoice render "Paid · Locked" and freeze the editor. `isPersisted`
  // (already computed above) is the real "this invoice has a saved copy" signal.
  const savedStatus = isPersisted ? deriveStatus(inv) : null;
  const locked = !inv.isEstimate && isPersisted && ['Paid', 'Cancelled', 'Refunded', 'Returned'].includes(savedStatus);
  const [newCust, setNewCust] = useState(null); // {name,phone,email,gst} when adding inline
  const [newVeh, setNewVeh] = useState(null); // {regNo,make,model,fuel} when adding inline
  // Show a generous result set — the dropdown is scrollable (max-h + overflow-y),
  // so capping at a handful was hiding valid matches. 50 keeps it fast while making
  // "no hidden items" true in practice for a workshop's catalogue.
  // A cap is still needed here (this list is NOT virtualised), but it must never be
  // SILENT. Previously it sliced to 50 and said nothing, so a workshop with 300 matching
  // parts had no way to know the one it wanted was simply not being drawn.
  // Universal Search review: SKU/OEM No./barcode are exact-then-partial IDENTIFIER
  // matches (via rankIndexed), no longer mixed into the same free-text haystack as
  // name/category/compatible-vehicle — the same fix already applied to the Job Cards
  // module's own Add Part picker for this identical inventory data (see
  // lib/useSearch.js's header comment for why that mixing was a real bug, not a UX
  // nuance: an exact SKU query could substring-match a different, unrelated part).
  const partSearchIndex = useSearchIndex(
    inventory,
    (p) => p.id,
    (p) => [p.name, p.category,
      ...(Array.isArray(p.categories) ? p.categories : []),
      ...(Array.isArray(p.compatibleCars) ? p.compatibleCars.flatMap((g) => (Array.isArray(g?.models) ? g.models : [])) : [])],
    (p) => [p.sku, p.oemNo, p.barcode],
  );
  const partMatches = useMemo(() => {
    const l = partQ.trim();
    // Strict Search Validation review: a genuine single-character match (e.g. "S"
    // finding every part whose name starts with S) must be returned, not artificially
    // withheld — a 2-character minimum silently hid real matches for the shortest,
    // most common searches. Only a genuinely EMPTY query shows nothing (no autocomplete
    // dump on focus); the PART_CAP + relevance ranking below keep a broad 1-char query
    // usable (exact/prefix hits surface first, capped to 50).
    if (!l) return [];
    // Parts review (Issue 3.5) — name/sku/oem/barcode alone missed the two other
    // identifiers a service advisor commonly searches by: the part's category, and
    // the vehicle it's compatible with. Same field shapes InventoryDashboard.js's
    // own part search already reads (category/categories array, compatibleCars
    // grouped as [{ brand, models: [...] }]).
    return searchAndRank(inventory.filter((p) => !p.archived), partSearchIndex, (p) => p.id, l);
  }, [partQ, inventory, partSearchIndex]);
  const PART_CAP = 50;
  const parts = useMemo(() => partMatches.slice(0, PART_CAP), [partMatches]);
  const [partHi, setPartHi] = useState(0); // keyboard-highlighted index
  const partNavByKey = useRef(false);      // ISSUE 6: only auto-scroll for KEYBOARD nav
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
  // Uses the SHARED constant (constants/index.js) — this was previously a hand-copied
  // literal that happened to be value-identical, one of three independent "which
  // statuses are invoiceable" answers in the codebase (Job Card review, Issue 2.6/2.8).
  const custJobCards = useMemo(() => {
    const phone = (inv.phone || '').replace(/\D/g, '').slice(-10);
    const cust = (inv.customer || '').trim().toLowerCase();
    const reg = (inv.regNo || '').replace(/\s/g, '').toUpperCase();
    const billable = jobCards.filter((j) => !j.status || BILLABLE_JOB_CARD_STATUSES.includes(j.status));
    // No customer chosen yet -> offer EVERY billable job card, so the advisor can search
    // by job number / reg no and have it pull the customer in. Previously this returned
    // [] and the dropdown was simply dead until a customer was picked.
    if (!phone && !cust && !reg) return billable;
    return jobCards.filter((j) => {
      if (j.status && !BILLABLE_JOB_CARD_STATUSES.includes(j.status)) return false;   // closed/cancelled/delivered
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
  // Switching Customer mode is a complete context change, not a display toggle — every
  // previously-resolved customer AND vehicle field must clear, in BOTH directions, or
  // the UI can show "Walk-in" while still silently billing against a stale
  // existing-customer/vehicle record underneath (the exact bug this closes: the old
  // walk-in <input> preserved customerId on every keystroke, and neither direction
  // ever touched the vehicle fields at all).
  const switchCustMode = (mode) => {
    if (mode === custMode) return;
    setCustMode(mode);
    set({
      customerId: '', customer: '', phone: '', email: '', gstNo: '', address: '',
      vehicle: '', regNo: '', vehicleId: '', vin: '', engineNo: '', odometer: '', fuel: '',
    });
  };
  // Inline "New Customer": create instantly via parent, auto-select, keep editing.
  const saveNewCustomer = () => {
    if (!newCust?.name?.trim()) return toast.error('Customer name required.');
    if (newCust.phone && !isIndianMobile(newCust.phone)) return toast.error(MOBILE_ERROR);
    if (newCust.email && !isValidEmail(newCust.email)) return toast.error(EMAIL_ERROR);
    if (newCust.gst && !isValidGstin(newCust.gst)) return toast.error(GSTIN_ERROR);
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
    const jcLines = buildJobCardImportLines(j, inventory);
    // If the advisor found the card by its number before choosing a customer, adopt the
    // card's customer rather than leaving the invoice with a job card but no customer.
    const owner = customers.find((c) => (c.phone || '').replace(/\D/g, '').slice(-10) === (j.phone || '').replace(/\D/g, '').slice(-10))
      || customers.find((c) => (c.name || '').trim().toLowerCase() === (j.customer || '').trim().toLowerCase());
    const adoptsCustomer = !inv.customer && (j.customer || owner);
    const adopt = adoptsCustomer
      ? { customerId: owner?.id || '', customer: owner?.name || j.customer || '', phone: owner?.phone || j.phone || '', gstNo: owner?.gst || inv.gstNo }
      : {};
    // Job Card review (Issue 2.2/2.8) — a job-card-first flow (search Job Card before
    // touching the Customer toggle) used to leave custMode on its default 'walkin', so
    // the customer this just resolved was live on the invoice but INVISIBLE (the
    // Walk-in tab renders a plain name input, not the fields this sets). Switching to
    // Search mode here is display-only — it does not re-touch any of the fields above.
    if (adoptsCustomer && owner) setCustMode('search');
    set({
      ...adopt, jobCardId: j.jobNo, jobNo: j.jobNo,
      // Previously unconditional (`j.advisor || ''`), which BLANKED an advisor/technician
      // already typed on the invoice whenever the linked job card simply didn't have one
      // recorded — the same "don't clobber what's already there" fallback the vehicle
      // fields below already used, just missing here.
      advisor: j.advisor || inv.advisor || '', technician: j.technician || inv.technician || '',
      vehicle: j.vehicle || inv.vehicle, regNo: j.regNo || inv.regNo,
      lines: jcLines.length ? [...inv.lines.filter((l) => l.desc.trim()), ...jcLines] : inv.lines,
    });
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
    if (readOnly) return; // Phase 1c — view-only while another user holds the edit lease
    if (savingRef.current) return; // prevent double-submit
    // A DRAFT is deliberately permissive: a workshop parks a half-written bill all the
    // time (customer is deciding, waiting on a part, shift change). It needs a name to
    // be findable, but nothing else — and crucially it must NOT consume an invoice
    // number (see below), because a burned number leaves a gap in the legal sequence.
    if (!inv.customer || !inv.customer.trim()) {
      customerFieldRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setCustomerFieldFlash(true);
      setTimeout(() => setCustomerFieldFlash(false), 2000);
      return toast.error('Customer name required — even for a draft.');
    }
    if (inv.gstNo && !isValidGstin(inv.gstNo)) return toast.error(GSTIN_ERROR);
    if (inv.phone && !isIndianMobile(inv.phone)) return toast.error(MOBILE_ERROR);
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

    // ---- PAYMENT ROWS ----------------------------------------------------------
    // MUST be declared BEFORE the overpayment guard below, which reads it.
    //
    // This `const` used to sit ~40 lines FURTHER DOWN, after the guard. Because it is
    // a `const`, the reads in the guard hit the temporal dead zone and threw
    // "ReferenceError: Cannot access 'payments' before initialization" on EVERY real
    // invoice save (Save, Save & Collect and Mark as Paid all route through here).
    // The guard therefore never ran even once, and no invoice could be saved at all.
    // Verified by executing this component in jsdom — see tests/overpayment.test.cjs.
    //
    // An ESTIMATE is a quotation, not a bill. It must never carry payments and must
    // never derive as Paid — the screenshot showed "EST-0003 ... Paid Rs.7,700",
    // which meant an estimate had money attached to it and printed as an INVOICE.
    const payments = (asEstimate || asDraft)
      ? []
      // Drop zero/blank payment rows. An empty row was being persisted, producing
      // "Payments: Cash Rs. 0.00, Cash Rs. 7,700.00" on the PDF.
      : (inv.payments || []).filter((p) => num(p.amount) > 0);

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
    const prefix = asEstimate ? (billingCfg.estPrefix || 'EST') : (billingCfg.invPrefix || 'INV');

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

    // Phase 2 — a fresh INV-/EST- number is allocated by a Firestore transaction in
    // persistInvoice (store.allocateNumber). Here we only DECLARE the intent: the
    // sequence, the display prefix and a seed (highest number we can see + 1, which
    // initialises a missing counter / pulls a lagging one forward). DRF- drafts are
    // a throwaway client handle and keep the local max()+1.
    let invNo = inv.invNo;
    let alloc = null;
    if (needsNewNumber) {
      if (asDraft) {
        invNo = nextInvNo(invoices, 'DRF');
      } else {
        invNo = '';
        alloc = {
          __allocSeq: asEstimate ? 'estimates' : 'invoices',
          __allocPrefix: prefix,
          __allocSeed: invSeqMax(invoices, prefix) + 1,
        };
      }
    }

    const clean = { ...inv, isEstimate: asEstimate && !asDraft, lines: billItems, payments, invNo, ...(alloc || {}) };
    clean.paid = (asEstimate || asDraft) ? 0 : payments.reduce((a, p) => a + num(p.amount), 0);
    const snap = totalsOf(clean);
    clean.grandTotal = snap.grand; clean.balance = snap.balance; clean.gstAmount = snap.gst; clean.profitAmount = snap.profit;
    clean.status = asDraft ? 'Draft' : asEstimate ? 'Estimate' : deriveStatus(clean);
    clean.history = [...(inv.history || []), { at: Date.now(), action: asDraft ? 'Draft Saved' : inv.invNo ? 'Invoice Edited' : (asEstimate ? 'Estimate Created' : 'Invoice Created'), by: demoMode ? 'Demo User' : 'Staff' }];
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    // C-1: the double-submit guard used to release on a blind 1500ms timer, which assumed
    // onSave finished (near-)instantly. Now that onSave genuinely awaits the Firestore
    // write, release it when that real round-trip settles instead — otherwise a slow
    // save could re-enable the button and let a second click double-submit mid-save.
    Promise.resolve(onSave(clean, thenPay && !asEstimate && snap.balance > 0)).finally(() => { savingRef.current = false; });
  };
  // autosave draft for new invoices (debounced) so an accidental close doesn't lose work.
  // Same fix as the restore check above: gate on actual persistence, not on whether
  // a number has been allocated (see the Issue 5.3 comment above `isPersisted`).
  useEffect(() => {
    if (invoices.some((x) => x.id === inv.id)) return;
    const id = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(inv)); } catch {} }, 600);
    return () => clearTimeout(id);
  }, [inv, DRAFT_KEY, invoices]);
  useEffect(() => {
    const onKey = (e) => {
      // Issue 1.5 (Customer & Vehicle review) — root cause of "the date field doesn't
      // behave consistently": this is a WINDOW-level listener, so it fires on every
      // Escape press anywhere in the modal, including one already handled by a nested
      // widget (SearchSelect's own dropdown calls preventDefault() and closes just
      // itself). preventDefault() stops the browser's default action, not propagation,
      // so the keydown still reached here and closed the ENTIRE invoice — a customer
      // search dropdown open for the Customer or Vehicle field, dismissed with Escape,
      // silently discarded the whole invoice being edited. Any handler that already
      // claimed the key (defaultPrevented) is not this handler's to also act on.
      if (e.defaultPrevented) return;
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
    <div ref={modalRef} data-modal-panel="" className="fixed inset-0 z-[120] flex flex-col" style={{ background: 'var(--surface-0)' }}>
      <ModalBoundaryContext.Provider value={modalRef}>
      <div className="px-4 sm:px-6 py-3 flex-shrink-0" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)', background: 'var(--surface-1)' }}>
        {/* New Invoice workspace-width review: the bar itself stays full-bleed (background/
            border reach the viewport edge), but its CONTENT is bounded to the same
            SHELL_WIDTH_CLS/mx-auto box as the body below — otherwise the title/buttons sit
            ~55px inboard of where the form content starts, a visible edge mismatch. Mirrors
            InventoryDashboard.js's own account-bar (outer full-bleed div, inner constrained
            div) rather than inventing a second pattern for the same problem. */}
        <div className={`${SHELL_WIDTH_CLS} mx-auto flex items-center justify-between`}>
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={guardedClose} className="w-9 h-9 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10"><X size={18} /></button>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-white truncate">
              {isPersisted ? `Edit ${inv.invNo}` : (inv.invNo ? `New Invoice · ${inv.invNo}` : 'New Invoice')}
              {/* Phase 2 — the INV- serial is now allocated by the server at save time, not
                  previewed. Say so, so the missing number doesn't read as a bug. */}
              {!isPersisted && !inv.invNo && <span className="ml-2 text-[10px] font-medium text-white/40">· number assigned on save</span>}
            </h3>
            <p className="text-[11px] text-white/45 truncate">{inv.customer || 'No customer selected'}</p>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2">
          <div className="text-right mr-1"><p className="text-[9px] uppercase tracking-wide text-white/45 leading-none">Total</p><p className="text-base font-bold leading-tight" style={{ color: '#d4af37' }}>{inr(t.grand)}</p></div>
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
              <button onClick={() => save(false)} disabled={!canSave || paymentsInvalid} title={paymentsInvalid ? 'Payment cannot exceed outstanding amount' : undefined} className="h-9 px-3 rounded-lg text-xs font-bold bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed">Save</button>
              {fullyPaid
                ? <button onClick={confirmMarkPaid} disabled={!canSave} title="Collected amount covers the total — settle this invoice" className="h-9 px-4 rounded-lg text-xs font-bold text-black bg-gradient-to-r from-emerald-400 to-emerald-500 flex items-center gap-1.5 disabled:opacity-40"><Check size={14} /> Mark as Paid</button>
                : <button onClick={() => save(false, true)} disabled={!canSave || paymentsInvalid} title={paymentsInvalid ? 'Payment cannot exceed outstanding amount' : 'Save and collect payment'} className="h-9 px-4 rounded-lg text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"><Wallet size={14} /> Save &amp; Collect</button>}
            </>
          )}
        </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto dark-scroll">
        {banner && <div className={`mx-auto w-full ${SHELL_WIDTH_CLS} px-4 sm:px-6 pt-4`}>{banner}</div>}
        {locked && (
          <div className={`mx-auto w-full ${SHELL_WIDTH_CLS} px-4 sm:px-6 pt-4`}>
            {/* Mobile QA fix: the icon + text used to be direct flex children of a
                `flex items-center` row. With `<b>` tags splitting the sentence into
                several text-node siblings, flex laid out EACH run as its own item
                instead of letting them flow as one paragraph — the sentence rendered
                as a scrambled grid of word-fragments instead of a normal line-wrapped
                paragraph. Wrapping the whole sentence in one <span> restores normal
                inline text flow; only the icon stays a separate flex item. */}
            <div className="rounded-xl px-4 py-2.5 flex items-start gap-2 text-xs" style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', color: '#6ee7b7' }}>
              <Check size={14} className="flex-shrink-0 mt-0.5" />
              <span>This invoice is <b>{savedStatus}</b> and locked as history. To make changes, use <b>Duplicate</b> to create a new editable invoice, or issue a <b>Credit Note</b>.</span>
            </div>
          </div>
        )}
        {/* New Invoice workspace-width review, Invoice Summary sticky check: this was
            `lg:items-start`, which lets the summary column's box shrink to its own
            content height (~360px) instead of matching the form column's (~1000px+).
            A `position: sticky` child can only stick within ITS OWN parent's box — with
            a ~360px parent, the summary detached and scrolled away after ~100px of
            scrolling on any invoice with real content, i.e. essentially always. Default
            (stretch) alignment makes the summary column's box match the taller form
            column, which is what gives the sticky panel room to actually track the
            scroll before releasing near the bottom — the standard sticky-sidebar shape.
            Purely a box-height change: the summary's own visible card keeps its natural
            (shorter) height, since the visual styling lives on the sticky child, not on
            this stretched parent. */}
        <div className={`mx-auto w-full ${SHELL_WIDTH_CLS} p-4 sm:p-6 pb-32 sm:pb-28 lg:flex lg:gap-6 lg:items-stretch`} style={(locked || readOnly) ? { pointerEvents: 'none', opacity: 0.85 } : undefined}>
          <div className="lg:flex-1 lg:min-w-0 space-y-4">
            {/* Customer & Vehicle */}
            {/* Mobile QA fix: inv.phone can genuinely be unset (walk-in edited before a
                phone was entered) — interpolating it directly rendered the literal
                string "undefined" next to the customer's name. */}
            <Section title="Customer & Vehicle" sub={inv.customer ? `${inv.customer}${inv.phone ? ` · ${inv.phone}` : ''}` : 'Search or walk-in'}>
              <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
                <div ref={customerFieldRef} className={`min-w-0 sm:col-span-3 rounded-xl transition-shadow ${customerFieldFlash ? 'ring-2 ring-red-500/70' : ''}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-[10px] uppercase tracking-wide text-white/45">Customer<span className="text-red-400"> *</span></label>
                    {custMode === 'search' && (
                      <button type="button" onClick={() => setNewCust({ name: '', phone: '', email: '', gst: '' })} className="flex items-center gap-0.5 text-[10px] font-semibold text-[#d4af37]/80 hover:text-[#d4af37]">
                        <Plus size={11} /> New Customer
                      </button>
                    )}
                  </div>
                  {/* Segmented control, not two independent labels — a shared pill-shaped
                      container with a visible baseline background is what actually reads as
                      "one control with two positions." The earlier version (a highlighted tab
                      next to a dim gray one) was mistaken for a single active label with no
                      alternative, not two switchable modes — the exact confusion reported. */}
                  <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-white/5 border border-white/10 mb-1.5" role="tablist" aria-label="Customer lookup mode">
                    <button type="button" role="tab" aria-selected={custMode === 'search'} onClick={() => switchCustMode('search')} className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${custMode === 'search' ? 'bg-[#d4af37]/20 text-[#d4af37]' : 'text-white/55 hover:text-white/85 hover:bg-white/5'}`}>Search Existing</button>
                    <button type="button" role="tab" aria-selected={custMode === 'walkin'} onClick={() => switchCustMode('walkin')} className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${custMode === 'walkin' ? 'bg-[#d4af37]/20 text-[#d4af37]' : 'text-white/55 hover:text-white/85 hover:bg-white/5'}`}>+ New / Walk-in</button>
                  </div>
                  {custMode === 'search' ? (
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
                      // Searchable by name, phone and EVERY vehicle's make/model — a workshop
                      // usually knows the number plate, not the customer's name. Identifiers
                      // (code, GST, vehicle reg/VIN) go through searchIds below instead of
                      // this free-text haystack — see SearchSelect's own header comment.
                      searchText={(c) => [c.name, c.phone,
                        ...(c.vehicles || []).flatMap((v) => [v.brand, v.model])]
                        .filter(Boolean).join(' ')}
                      searchIds={(c) => [c.code, c.gst,
                        ...(c.vehicles || []).flatMap((v) => [v.regNo, v.reg, v.vin])]}
                      placeholder="Search name, phone, code or vehicle no…"
                      emptyText="No customer matches"
                      noOptionsText="No customers yet"
                      inputClassName={inputCls}
                      allowClearSelection
                      onClearSelection={() => set({ customerId: '', customer: '', phone: '', gstNo: '', vehicle: '', regNo: '', vehicleId: '' })}
                    />
                  ) : (
                    // Walk-in is a genuinely separate identity path — it must never carry a
                    // stale customerId forward (that silently re-attaches whatever gets typed
                    // here to a PREVIOUSLY selected existing customer's record).
                    <input value={inv.customer} onChange={(e) => set({ customer: e.target.value })} placeholder="Type name for walk-in" className={inputCls} />
                  )}
                </div>
                <Field label="Date"><input type="date" value={inv.date} onChange={(e) => set({ date: e.target.value })} className={inputCls} style={{ colorScheme: 'dark' }} /></Field>
                <Field label="Phone" error={inv.phone && !isIndianMobile(inv.phone) ? MOBILE_ERROR : null}><input value={inv.phone} onChange={(e) => set({ phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} placeholder="10-digit" className={inputCls} /></Field>
                <Field label="GST No. (optional)" error={gstNoErr}><input value={inv.gstNo} onChange={(e) => set({ gstNo: e.target.value.toUpperCase() })} placeholder="Customer GSTIN" className={`${inputCls} ${gstNoErr ? 'border-red-500/60 focus:border-red-500/80' : ''}`} /></Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-6 gap-3 mt-3">
                <div className="min-w-0 sm:col-span-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-[10px] uppercase tracking-wide text-white/45">Vehicle</label>
                    {/* Only offered once an EXISTING customer is resolved — onQuickVehicle
                        attaches to inv.customerId, which walk-in never has (by design: a
                        walk-in vehicle is just free text on the invoice, no master record). */}
                    {custMode === 'search' && inv.customerId && (
                      <button type="button" onClick={() => setNewVeh({ regNo: '', make: '', model: '', fuel: '' })} className="flex items-center gap-0.5 text-[10px] font-semibold text-[#d4af37]/80 hover:text-[#d4af37]">
                        <Plus size={11} /> Add Vehicle
                      </button>
                    )}
                  </div>
                  {custMode === 'search' ? (
                    <SearchSelect
                      value={inv.vehicle ? `${inv.vehicle}${inv.regNo ? ` · ${inv.regNo}` : ''}` : ''}
                      options={custVehicles}
                      onSelect={pickVehicle}
                      getKey={(v, i) => v.id || v.regNo || i}
                      getLabel={(v) => [v.brand, v.model, v.variant].filter(Boolean).join(' ') || v.regNo || 'Vehicle'}
                      getSub={(v) => [v.regNo || v.reg, v.fuel, v.year, v.vin].filter(Boolean).join(' · ')}
                      // Issue 1: must match reg no, model, VIN, ENGINE NUMBER, fuel and the
                      // CUSTOMER NAME. engineNo/chassisNo/rcNumber/variant were absent, so a
                      // receptionist searching by engine number got "No vehicle matches".
                      // Universal Search review: reg/VIN/engine/chassis/RC (identifiers) now
                      // go through searchIds — previously mixed into this same free-text
                      // haystack, so an exact reg no. like "SBBMC40" could substring-match an
                      // unrelated "SBBMC400" with no ranking to tell them apart.
                      searchText={(v) => [
                        v.brand, v.make, v.model, v.variant,
                        v.fuel, v.transmission, v.year, v.color,
                        v.owner, v.ownerPhone, inv.customer, inv.phone,
                      ].filter(Boolean).join(' ')}
                      searchIds={(v) => [v.regNo, v.reg, v.vin, v.engineNo, v.chassisNo, v.rcNumber]}
                      placeholder={inv.customer ? 'Search model, reg no, VIN or fuel…' : 'Select a customer first'}
                      emptyText="No vehicle matches"
                      noOptionsText={inv.customer ? 'This customer has no vehicles on file' : 'Select a customer first'}
                      inputClassName={inputCls}
                      allowClearSelection
                      onClearSelection={() => set({ vehicle: '', regNo: '', vehicleId: '' })}
                    />
                  ) : (
                    // Walk-in previously had NO way to type a vehicle description at all — this
                    // field silently stayed the customer-linked SearchSelect (always empty,
                    // "select a customer first") regardless of mode, so only Reg. No. could be
                    // entered. Mirrors the Customer field's own search/walk-in branch above.
                    <input value={inv.vehicle} onChange={(e) => set({ vehicle: e.target.value })} placeholder="e.g. Maruti Swift Vdi" className={inputCls} />
                  )}
                </div>
                <Field label="Reg. No."><input value={inv.regNo} onChange={(e) => set({ regNo: e.target.value.toUpperCase() })} className={inputCls} /></Field>
              </div>
            </Section>

            {/* Inline New Customer mini-form */}
            {newCust && (
              <div className="fixed inset-0 z-[130] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(3px)' }} onClick={() => setNewCust(null)}>
                <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}><h3 className="text-base font-bold text-white">New Customer</h3><button onClick={() => setNewCust(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10"><X size={17} /></button></div>
                  <div className="p-5 space-y-3">
                    <div><label className="block text-[11px] uppercase tracking-wide text-white/45 mb-1.5">Name<span className="text-red-400"> *</span></label><input autoFocus value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} placeholder="Customer name" className={inputCls} /></div>
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="block text-[11px] uppercase tracking-wide text-white/45 mb-1.5">Phone</label><input value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} placeholder="10-digit" className={`${inputCls} ${newCust.phone && !isIndianMobile(newCust.phone) ? 'border-red-500/60 focus:border-red-500/80' : ''}`} />{newCust.phone && !isIndianMobile(newCust.phone) && <p className="text-[10px] text-red-400 mt-1">{MOBILE_ERROR}</p>}</div>
                      <div><label className="block text-[11px] uppercase tracking-wide text-white/45 mb-1.5">GST (optional)</label><input value={newCust.gst} onChange={(e) => setNewCust({ ...newCust, gst: e.target.value.toUpperCase() })} placeholder="GSTIN" className={`${inputCls} ${newCust.gst && !isValidGstin(newCust.gst) ? 'border-red-500/60 focus:border-red-500/80' : ''}`} />{newCust.gst && !isValidGstin(newCust.gst) && <p className="text-[10px] text-red-400 mt-1">{GSTIN_ERROR}</p>}</div>
                    </div>
                    <div><label className="block text-[11px] uppercase tracking-wide text-white/45 mb-1.5">Email (optional)</label><input value={newCust.email} onChange={(e) => setNewCust({ ...newCust, email: e.target.value })} placeholder="email@…" className={`${inputCls} ${newCust.email && !isValidEmail(newCust.email) ? 'border-red-500/60 focus:border-red-500/80' : ''}`} />{newCust.email && !isValidEmail(newCust.email) && <p className="text-[10px] text-red-400 mt-1">{EMAIL_ERROR}</p>}</div>
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
                    <div><label className="block text-[11px] uppercase tracking-wide text-white/45 mb-1.5">Registration No.<span className="text-red-400"> *</span></label><input autoFocus value={newVeh.regNo} onChange={(e) => setNewVeh({ ...newVeh, regNo: e.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, '').slice(0, 13) })} placeholder="TS09EX1234" className={inputCls} /></div>
                    {/* Same Manufacturer→Model cascade used by Customers/Vehicles/Job Cards
                        (components/common/VehicleMakeModelSelect.jsx) — this form used to be
                        two free-text inputs, the only place in the app still letting Make/Model
                        drift from the shared catalog. */}
                    <VehicleMakeModelSelect
                      make={newVeh.make}
                      model={newVeh.model}
                      onPickMake={(m) => setNewVeh({ ...newVeh, make: m, model: '' })}
                      onPickModel={(m) => setNewVeh({ ...newVeh, model: m })}
                      makeLabel="Make"
                      modelLabel="Model"
                      inputCls={inputCls}
                      renderField={(label, req, children) => (
                        <div><label className="block text-[11px] uppercase tracking-wide text-white/45 mb-1.5">{label}</label>{children}</div>
                      )}
                    />
                    {/* Universal dropdown architecture review — native <select> is a
                        browser-owned popup, immune to this app's theming/containment. */}
                    <div><label className="block text-[11px] uppercase tracking-wide text-white/45 mb-1.5">Fuel</label><MiniSelect value={newVeh.fuel} placeholder="Select…" options={['Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid']} onPick={(v) => setNewVeh({ ...newVeh, fuel: v })} inputCls={inputCls} /></div>
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
                // Universal Search review: Job No. and reg no. (identifiers) go through
                // searchIds — this previously reproduced the exact "232 substring-matches
                // any job number containing 232" bug the Job Cards module's own list search
                // already fixed for the same underlying data (see lib/useSearch.js).
                searchText={(j) => [j.vehicle, j.customer, j.phone, j.status, j.make, j.model]
                  .filter(Boolean).join(' ')}
                searchIds={(j) => [j.jobNo, String(j.jobNo || '').replace(/\D/g, ''), j.regNo]}
                placeholder="Search job no, customer, vehicle, reg no, phone or status…"
                emptyText="No job card matches"
                // Job Card search is independent of Customer selection (Issue 2.1) — with no
                // customer chosen, custJobCards already returns every billable job card in
                // the workshop, so this ONLY renders when that set is genuinely empty. The
                // old "Select a customer first" copy implied a gate that doesn't exist here.
                noOptionsText={inv.customer ? 'No open job cards for this customer' : 'No open job cards in the workshop'}
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
              <div className="relative mb-3" ref={partAnchorRef}>
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/45" />
                <input ref={partSearchRef} value={partQ} onChange={(e) => setPartQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (!parts.length) return;
                    if (e.key === 'ArrowDown') { e.preventDefault(); partNavByKey.current = true; setPartHi((i) => Math.min(i + 1, parts.length - 1)); }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); partNavByKey.current = true; setPartHi((i) => Math.max(i - 1, 0)); }
                    else if (e.key === 'Enter') { e.preventDefault(); const p = parts[partHi]; if (p) { addPartFromInventory(p); setPartQ(''); } }
                    else if (e.key === 'Escape') { setPartQ(''); }
                  }}
                  role="combobox" aria-expanded={parts.length > 0} aria-controls="inv-search-list" aria-autocomplete="list"
                  placeholder="Search inventory by name, SKU, OEM, barcode…" className={`${inputCls} pl-9 pr-9`} />
                {partQ && (
                  <button type="button" aria-label="Clear search"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setPartQ(''); setPartHi(0); partSearchRef.current?.focus(); }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md text-white/45 hover:text-white hover:bg-white/10">
                    <X size={13} />
                  </button>
                )}
                {parts.length > 0 && (
                  <DropdownPanel anchorRef={partAnchorRef} open onClose={() => setPartQ('')}
                    style={{ background: 'var(--surface-2)', border: '1px solid rgba(212,175,55,0.25)' }}>
                  <div id="inv-search-list" role="listbox" className="dark-scroll">
                    {parts.map((p, pi) => {
                      const avail = (p.stock || 0) - (p.reserved || 0);
                      const price = num(p.defaultSellingPrice || p.sellingPrice || p.mrp);
                      return (
                        <button key={p.id} type="button" role="option" aria-selected={pi === partHi}
                          // ISSUE 6: this used to scrollIntoView whenever the row became
                          // highlighted — and onMouseEnter highlighted it. So hovering
                          // scrolled the list UNDER the pointer; the row moved between
                          // mousedown and mouseup, the browser never fired `click`, and
                          // the part was never added. Enter worked because nothing moved.
                          // Only follow the highlight when the KEYBOARD drove it.
                          ref={(el) => { if (el && pi === partHi && partNavByKey.current) el.scrollIntoView({ block: 'nearest' }); }}
                          onMouseEnter={() => { partNavByKey.current = false; setPartHi(pi); }}
                          onMouseDown={(e) => e.preventDefault()}   // keep focus on the input
                          onClick={() => { addPartFromInventory(p); setPartQ(''); partSearchRef.current?.focus(); }}
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
                              {gstEnabled && <p className="text-[9px] text-white/45">GST {Number(p.gst) || 18}%</p>}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {partMatches.length > parts.length && (
                    <p className="px-3 py-1.5 text-[10px] text-amber-300/80" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.08)' }}>
                      Showing {parts.length} of {partMatches.length} matches — refine your search to narrow it down.
                    </p>
                  )}
                  </DropdownPanel>
                )}
                {parts.length === 0 && partQ.trim().length >= 2 && (
                  <DropdownPanel anchorRef={partAnchorRef} open onClose={() => setPartQ('')} scroll={false}
                    style={{ background: 'var(--surface-2)', border: '1px solid rgba(245,158,11,0.35)', overflow: 'hidden' }}>
                  <div>
                    <div className="px-3 py-2.5 flex items-start gap-2" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                      <span className="text-amber-400 mt-0.5 flex-shrink-0">⚠</span>
                      <div>
                        <p className="text-xs font-semibold text-white/85">“{partQ.trim()}” is not in your inventory.</p>
                        <p className="text-[10px] text-white/45 mt-0.5">Parts must come from inventory so stock and profit stay correct. If you bought this from outside for this job, bill it as an Outside Purchase.</p>
                      </div>
                    </div>
                    <button type="button" onClick={() => { addLine('Other', partQ.trim()); setPartQ(''); notify.info('Added under Outside Purchase.'); }} className="w-full text-left px-3 py-2.5 text-xs text-white/80 hover:bg-[#d4af37]/10 flex items-center gap-2"><Plus size={13} className="text-[#d4af37]" /> Bill as Outside Purchase item</button>
                  </div>
                  </DropdownPanel>
                )}
              </div>
              <div className="space-y-2">{partLines.map((l) => <LineRowBase key={l.id} l={l} setLine={setLine} delLine={delLine} dupLine={dupLine} moveLine={moveLine} clearPartLink={clearPartLink} inventory={inventory} discountEnabled={discountEnabled} gstEnabled={gstEnabled} defaultGst={defaultGst} priceOverride={priceOverride} pricingLocked={pricingLocked} />)}{partLines.length === 0 && <p className="text-xs text-white/45 py-3 text-center rounded-lg" style={{ background: 'rgba(var(--fg-rgb),0.02)' }}>No parts yet — search your inventory above to add one.</p>}</div>
              <p className="mt-2 text-[10px] text-white/45">Only inventory items can be added here. Anything bought from outside belongs in <b className="text-white/45">Outside Purchase</b> below.</p>
            </Section>

            {/* Labour */}
            <Section title="Labour & Services" sub="Enter the service and the amount you're charging" badge={labourCount || null}>
              {/* One-tap common services — the owner adds the line, then types the charge. */}
              <div className="flex flex-wrap gap-1.5 mb-2.5">
                {COMMON_SERVICES.map((svcName) => (
                  <button key={svcName} type="button" onClick={() => addLine('Labour', svcName)} className="text-[10px] px-2.5 py-1.5 min-h-[30px] rounded-lg bg-white/5 border border-white/10 text-white/60 hover:bg-[#d4af37]/10 hover:text-[#d4af37] hover:border-[#d4af37]/30 transition">+ {svcName}</button>
                ))}
              </div>
              {/* Labour review (Issue 4.2) — this workshop's own most-billed services,
                  separate from the fixed COMMON_SERVICES list above (skips anything
                  already shown there, so nothing appears twice). */}
              {recentServices.filter((s) => !COMMON_SERVICES.includes(s)).length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                  <span className="text-[9px] uppercase tracking-wide text-white/45">Recently used:</span>
                  {recentServices.filter((s) => !COMMON_SERVICES.includes(s)).map((svcName) => (
                    <button key={svcName} type="button" onClick={() => addLine('Labour', svcName)} className="text-[10px] px-2.5 py-1.5 min-h-[30px] rounded-lg bg-white/5 border border-white/10 text-white/60 hover:bg-[#d4af37]/10 hover:text-[#d4af37] hover:border-[#d4af37]/30 transition">+ {svcName}</button>
                  ))}
                </div>
              )}
              <div className="space-y-2">{labourLines.map((l) => <LineRowBase key={l.id} l={l} setLine={setLine} delLine={delLine} dupLine={dupLine} moveLine={moveLine} clearPartLink={clearPartLink} inventory={inventory} discountEnabled={discountEnabled} gstEnabled={gstEnabled} defaultGst={defaultGst} priceOverride={priceOverride} pricingLocked={pricingLocked} />)}{labourLines.length === 0 && <p className="text-xs text-white/45 py-2 text-center rounded-lg" style={{ background: 'rgba(var(--fg-rgb),0.02)' }}>No labour yet — add a service line below.</p>}</div>
              <button type="button" onClick={() => addLine('Labour')} className="mt-2 text-[11px] font-bold text-[#d4af37] flex items-center gap-1"><Plus size={12} /> Add custom service</button>
            </Section>

            {/* Other / outside purchase */}
            <Section title="Outside Purchase" sub="Externally sourced items billed to the customer" defaultOpen={false} badge={otherCount || null}>
              <p className="text-[11px] text-white/45 mb-2 rounded-lg px-3 py-2" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>Items purchased externally and billed to the customer without entering your inventory (e.g. a part bought from another shop for this job). These don’t affect stock levels.</p>
              <div className="space-y-2">{otherLines.map((l) => <LineRowBase key={l.id} l={l} setLine={setLine} delLine={delLine} dupLine={dupLine} moveLine={moveLine} clearPartLink={clearPartLink} inventory={inventory} discountEnabled={discountEnabled} gstEnabled={gstEnabled} defaultGst={defaultGst} priceOverride={priceOverride} pricingLocked={pricingLocked} />)}{otherLines.length === 0 && <p className="text-xs text-white/45 py-2 text-center rounded-lg" style={{ background: 'rgba(var(--fg-rgb),0.02)' }}>Nothing added yet.</p>}</div>
              <button type="button" onClick={() => addLine('Other')} className="mt-2 text-[11px] font-bold text-[#d4af37] flex items-center gap-1"><Plus size={12} /> Add outside-purchase item</button>
            </Section>

            {/* Payments */}
            {inv.isEstimate ? (
              <Section title="Payments" sub="Not applicable to an estimate" defaultOpen={false}>
                <p className="text-xs text-white/45 py-2">This is an <b>estimate</b> (a quotation). Payments can only be collected once it is converted to an invoice — so an estimate can never show as Paid, and it never touches stock or revenue.</p>
              </Section>
            ) : (
            <Section title="Payments" sub={t.paid > 0 ? `Paid ${inr(t.paid)} · balance ${inr(t.balance)}` : 'Split across modes'} badge={(inv.payments || []).filter((p) => num(p.amount) > 0).length || null}>
              <div className="space-y-2">
                {(inv.payments || []).map((p) => (
                  <div key={p.id} className="flex flex-wrap items-end gap-2 rounded-xl p-2.5" style={{ background: 'rgba(var(--fg-rgb),0.025)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
                    <label className="w-32">
                      <span className="block text-[9px] uppercase tracking-wide text-white/45 mb-0.5">Mode</span>
                      {/* Universal dropdown architecture review — native <select> is a
                          browser-owned popup, immune to this app's theming/containment. */}
                      <MiniSelect value={p.mode} options={PAYMENT_MODES} onPick={(v) => setPayment(p.id, { mode: v })} inputCls={`${inputCls} py-2`} width={180} />
                    </label>
                    <label className="flex-1 min-w-[100px]">
                      <span className="flex items-center justify-between text-[9px] uppercase tracking-wide text-white/45 mb-0.5">
                        <span>Amount</span>
                        {t.balance > 0 && <span className="normal-case text-[9px] text-white/45">still due {inr(t.balance)}</span>}
                      </span>
                      {/* Issue 3: validate WHILE TYPING and ON BLUR. The value is never
                          auto-corrected — the user must see and fix what they typed. */}
                      <input
                        value={p.amount}
                        inputMode="decimal"
                        aria-invalid={paymentsInvalid || undefined}
                        onChange={(e) => setPayment(p.id, { amount: e.target.value.replace(/[^\d.]/g, '') })}
                        onBlur={() => {
                          if (negativePayment) toast.error('A payment amount cannot be negative.');
                          else if (overpaid) toast.error(`Payment cannot exceed outstanding amount — over by ${inr(overpayBy)}.`);
                        }}
                        placeholder="0"
                        className={`${inputCls} py-2 text-right`}
                        style={paymentsInvalid ? { borderColor: 'rgba(248,113,113,0.7)' } : undefined}
                      />
                    </label>
                    <label className="flex-1 min-w-[120px]">
                      <span className="block text-[9px] uppercase tracking-wide text-white/45 mb-0.5">Reference (optional)</span>
                      <input value={p.ref} onChange={(e) => setPayment(p.id, { ref: e.target.value })} placeholder="UPI ref / txn no." className={`${inputCls} py-2`} />
                    </label>
                    <button type="button" onClick={() => delPayment(p.id)} title="Remove payment" className="w-9 h-9 mb-0.5 rounded-lg flex items-center justify-center text-red-400/60 hover:bg-red-500/10 hover:text-red-400 flex-shrink-0"><Trash2 size={14} /></button>
                  </div>
                ))}
                {(inv.payments || []).length === 0 && <p className="text-xs text-white/45 py-2 text-center rounded-lg" style={{ background: 'rgba(var(--fg-rgb),0.02)' }}>No payment recorded yet — add one to collect against this invoice.</p>}
                {/* Issue 3: the excess must be stated, never silently absorbed. */}
                {paymentsInvalid && (
                  <p role="alert" data-testid="overpay-error" className="text-xs font-bold px-3 py-2 rounded-lg" style={{ background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', color: '#fca5a5' }}>
                    {negativePayment
                      ? 'A payment amount cannot be negative.'
                      : `Payment cannot exceed outstanding amount. Collected ${inr(collected)} against a total of ${inr(t.grand)} — over by ${inr(overpayBy)}.`}
                  </p>
                )}
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
                      {/* Universal dropdown architecture review — native <select> is a
                          browser-owned popup, immune to this app's theming/containment. */}
                      <MiniSelect
                        value={inv.discountType}
                        options={['flat', 'percent']}
                        labels={{ flat: '₹', percent: '%' }}
                        emptyValue="flat"
                        onPick={(v) => set({ discountType: v || 'flat' })}
                        inputCls="py-1 px-1 rounded-lg text-xs bg-white/5 border border-white/10 text-white outline-none"
                        width={120}
                      />
                    </div>
                  </div>
                )}
                {gstEnabled && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-white/55">GST Mode</span>
                    {/* Universal dropdown architecture review — native <select> is a
                        browser-owned popup, immune to this app's theming/containment. */}
                    <MiniSelect
                      value={inv.gstMode || 'auto'}
                      options={['auto', 'igst', 'exempt']}
                      labels={{ auto: 'CGST + SGST', igst: 'IGST', exempt: 'Exempt / No GST' }}
                      emptyValue="auto"
                      onPick={(v) => set({ gstMode: v || 'auto' })}
                      inputCls="py-1 px-2 rounded-lg text-xs bg-white/5 border border-white/10 text-white outline-none"
                      width={180}
                    />
                  </div>
                )}
                {gstEnabled && (t.isIgst
                  ? <div className="flex justify-between text-white/55"><span>IGST</span><span>{inr(t.igst)}</span></div>
                  : <><div className="flex justify-between text-white/55"><span>CGST</span><span>{inr(t.cgst)}</span></div><div className="flex justify-between text-white/55"><span>SGST</span><span>{inr(t.sgst)}</span></div></>)}
                <div className="flex justify-between text-white/45 text-[11px]"><span>Round off</span><span>{inr(t.roundOff)}</span></div>
                <div className="flex justify-between font-bold text-white pt-1.5 text-base" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.1)' }}><span>Grand Total</span><span style={{ color: '#d4af37' }}>{inr(t.grand)}</span></div>
                <div className="flex justify-between text-emerald-400"><span>Paid</span><span>{inr(t.paid)}</span></div>
                <div className="flex justify-between font-bold" style={{ color: t.balance > 0 ? '#f87171' : '#34d399' }}><span>Balance</span><span>{inr(t.balance)}</span></div>
                {/* Issue 3: a floored ₹0 balance hid the excess entirely. State it. */}
                {overpaid && <div className="flex justify-between font-bold" style={{ color: '#f87171' }}><span>Overpaid by</span><span>{inr(overpayBy)}</span></div>}
                {t.cost > 0 && <div className="flex justify-between text-[11px] pt-1 mt-1" style={{ borderTop: '1px dashed rgba(var(--fg-rgb),0.1)', color: t.profit >= 0 ? '#4ade80' : '#f87171' }}><span>Est. Profit ({t.afterDisc > 0 ? Math.round((t.profit / t.afterDisc) * 100) : 0}%)</span><span>{inr(t.profit)}</span></div>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* mobile action bar */}
      <div className="sm:hidden flex items-center gap-2 px-4 py-3 flex-shrink-0" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.08)', background: 'var(--surface-1)', paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <div className="flex-shrink-0"><p className="text-[8px] uppercase tracking-wide text-white/45 leading-none">Total</p><p className="text-sm font-bold leading-tight" style={{ color: '#d4af37' }}>{inr(t.grand)}</p></div>
        {locked ? (
          <>
            <button onClick={() => onDownloadPDF?.(inv, true)} className="flex-1 py-3 rounded-xl text-xs font-bold bg-white/5 border border-white/10 text-white/80 flex items-center justify-center gap-1"><Printer size={13} /> Print</button>
            <button onClick={() => onDownloadPDF?.(inv, false)} className="flex-1 py-3 rounded-xl text-xs font-bold bg-white/5 border border-white/10 text-white/80 flex items-center justify-center gap-1"><FileDown size={13} /> PDF</button>
            <button onClick={() => onDuplicate?.(inv)} className="flex-1 py-3 rounded-xl text-xs font-bold bg-white/5 border border-white/10 text-white/80 flex items-center justify-center gap-1"><Plus size={13} /> Duplicate</button>
          </>
        ) : (
          <>
            <button onClick={() => save(false, false, true)} disabled={!inv.customer?.trim()} className="flex-1 py-3 rounded-xl text-xs font-bold bg-white/5 border border-white/10 text-white/70 disabled:opacity-40">Draft</button>
            <button onClick={() => save(false)} disabled={!canSave || paymentsInvalid} className="flex-1 py-3 rounded-xl text-xs font-bold bg-white/5 border border-white/10 text-white/80 disabled:opacity-40">Save</button>
            {fullyPaid
              ? <button onClick={confirmMarkPaid} disabled={!canSave} className="flex-1 py-3 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-emerald-400 to-emerald-500 flex items-center justify-center gap-1 disabled:opacity-40"><Check size={13} /> Mark as Paid</button>
              : <button onClick={() => save(false, true)} disabled={!canSave || paymentsInvalid} className="flex-1 py-3 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] flex items-center justify-center gap-1 disabled:opacity-40"><Wallet size={13} /> Save &amp; Collect</button>}
          </>
        )}
      </div>
      </ModalBoundaryContext.Provider>
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
  // Mutation-safety pass — this had NO in-flight guard at all: two rapid clicks both
  // called onCollect (collectPayment) with the same stale `invoice.payments` snapshot,
  // each independently computing a "next" payments array and writing it — confirmed
  // live as a genuine race (not merely "harmless" — which write wins is timing-
  // dependent, and any downstream stock/revenue side effect keyed off the Paid
  // transition could fire twice). savingRef is checked and set SYNCHRONOUSLY, before
  // onCollect is even called, so a second click while the first is still in flight is
  // a no-op — same architecture as Job Card/Vehicle Save. mountedRef guards the
  // post-await setSaving since a SUCCESSFUL collect unmounts this modal (parent clears
  // payFor) before the await here resolves.
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  // Phase 4b (PH4-01) — ONE stable payment id for the life of this modal. Every
  // press of "Record Payment" (including a retry after an ambiguous failure) reuses
  // it, so `collectInvoicePayment`'s transaction can recognise a duplicate delivery
  // and not append a second payment. It is regenerated only when the modal remounts
  // for a NEW "collect payment" intent (a genuinely separate payment gets a new id).
  const payOpIdRef = useRef(`p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`);
  const confirm = async () => {
    if (savingRef.current) return;
    if (num(amount) <= 0) { toast.error('Enter the amount received.'); return; }
    if (overpay) { toast.error('Payment exceeds the balance due.'); return; }
    savingRef.current = true;
    setSaving(true);
    try {
      await onCollect(invoice, mode, amount, ref, { notes, paidOn, opId: payOpIdRef.current });
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
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
          <button onClick={onClose} disabled={saving} className="flex-1 py-3 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80 disabled:opacity-40">Cancel</button>
          <button onClick={confirm} disabled={num(amount) <= 0 || overpay || saving} aria-busy={saving} className="flex-1 py-3 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] disabled:opacity-40 disabled:cursor-not-allowed">{saving ? 'Processing…' : (willClose ? 'Collect & Close Invoice' : 'Record Payment')}</button>
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
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p[0]} cy={p[1]} r="2" fill="#d4af37" />
          {/* larger invisible hit-target + native tooltip on every point */}
          <circle cx={p[0]} cy={p[1]} r="10" fill="transparent">
            <title>{`${data[i].label}: ${inr(data[i].rev)}`}</title>
          </circle>
        </g>
      ))}
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

// Module-scoped view state — a plain JS-module-level object, NOT sessionStorage-backed
// (Navigation State + Data Freshness review — this used to mirror into sessionStorage
// specifically so a Browser Refresh restored the old search/filters, which is the bug that
// review flagged, not a feature). Survives a tab-switch unmount (the module stays loaded,
// so this object keeps its values while the user is elsewhere on genuinely useful in-app
// navigation memory), but resets to defaultBillView() on a real reload, since the JS module
// re-evaluates from scratch then — a reload should show the current invoice list at a sane
// default filter, not silently resurrect a stale search from before.
const defaultBillView = () => ({ q: '', statusF: 'All', payModeF: 'All', dateF: 'All' });
const billingViewState = defaultBillView();

export default function BillingModule({ demoMode = false, demoCanDelete = false, demoCanEditPricing = true, demoCanExport = true, canManage = true, isAdmin = false, invoices, customers = [], inventory = [], jobCards = [], onPersist, onDelete, onCollectPayment, onRestoreStock, onQuickCustomer, onQuickVehicle, initialStatusFilter, onInitialStatusFilterHandled, actorEmail, onCapacityCleanup }) {
  const { t } = useTranslation();
  const SETTINGS_KEY = demoMode ? 'maruti_settings_demo' : 'maruti_settings';
  const V = billingViewState;
  const [q, setQ] = useState(V.q);
  const [statusF, setStatusF] = useState(V.statusF);
  const [payModeF, setPayModeF] = useState(V.payModeF);
  const [dateF, setDateF] = useState(V.dateF);
  // Write back to the in-memory cache so it restores on tab-switch remount — not on
  // reload, see billingViewState's own comment above.
  useEffect(() => { V.q = q; V.statusF = statusF; V.payModeF = payModeF; V.dateF = dateF; }, [q, statusF, payModeF, dateF]);
  // 1.3 — one-shot deep-link from a Dashboard Insight ("N invoices awaiting payment"),
  // same pattern as InventoryPurchaseOrders' initialReceivePOId/initialStatusFilter.
  useEffect(() => {
    if (!initialStatusFilter) return;
    setStatusF(initialStatusFilter);
    onInitialStatusFilterHandled?.();
  }, [initialStatusFilter, onInitialStatusFilterHandled]);
  const [edit, setEdit] = useState(null);
  // CONCURRENCY PHASE 1b/1c — single active editor for an existing invoice. New /
  // draft invoices (no persisted id yet) take no lease. If another user holds the
  // lease the popup stays OPEN read-only (Phase 1c) — never force-closed — and
  // becomes editable in place via [Edit] once the lease frees.
  const isPersistedEdit = !!(edit && edit.id && (invoices || []).some((iv) => iv.id === edit.id));
  const invoiceLease = useEditLease('invoices', isPersistedEdit ? edit.id : null);
  const [invoiceViewOnly, setInvoiceViewOnly] = useState(false);
  const [invoiceReviewOpen, setInvoiceReviewOpen] = useState(false);
  const invoiceSync = useRecordSync('invoices', isPersistedEdit ? edit.id : null, edit && edit._rev);
  useLeaseReleaseToast(invoiceLease.status);
  useEffect(() => {
    if (!isPersistedEdit) { setInvoiceViewOnly(false); return undefined; }
    let cancelled = false;
    setInvoiceViewOnly(false);
    invoiceSync.markSynced(revOf(edit));
    invoiceLease.acquire(edit.id).then((r) => {
      if (cancelled) return;
      if (!r.ok) { toast.error(`🔒 ${r.heldBy} is editing this invoice. You can view it once they finish.`, { duration: 6000 }); setInvoiceViewOnly(true); }
    });
    return () => { cancelled = true; };
  }, [isPersistedEdit, edit && edit.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const closeInvoiceEditor = useCallback(() => { invoiceLease.release(); setInvoiceReviewOpen(false); setEdit(null); }, [invoiceLease]);
  const claimInvoiceEdit = useCallback(async () => {
    if (!edit || !edit.id) return;
    const r = await invoiceLease.acquire(edit.id);
    if (!r.ok) { toast.error(`🔒 ${r.heldBy} is still editing this invoice.`); return; }
    if (invoiceSync.latest) setEdit(invoiceSync.latest);
    invoiceSync.markSynced();
    setInvoiceViewOnly(false);
  }, [edit, invoiceLease, invoiceSync]);
  const invoiceBanner = (
    <>
      {invoiceViewOnly && invoiceLease.status === 'held' && <EditLeaseBanner status="held" heldByEmail={invoiceLease.heldByEmail} className="mb-2" />}
      {invoiceViewOnly && invoiceLease.status !== 'held' && <EditAvailableBar onEdit={claimInvoiceEdit} className="mb-2" />}
      {invoiceViewOnly
        ? <RecordUpdatedNotice status={invoiceSync.status} onAcknowledge={() => { if (invoiceSync.latest) setEdit(invoiceSync.latest); invoiceSync.markSynced(); }} className="mb-2" />
        : <RecordConflictBanner status={invoiceSync.status} onReview={() => setInvoiceReviewOpen(true)} onClose={closeInvoiceEditor} className="mb-2" />}
    </>
  );
  const [capacityBlockedOpen, setCapacityBlockedOpen] = useState(false);
  // Bumped by the cleanup wizard's onComplete so the capacity banner re-checks its
  // count immediately after a cleanup — NOT used to close the modal (see the wizard's
  // own onClose/"Done" button for that; closing on onComplete would unmount the modal
  // before its own success/result screen ever became visible to the user).
  const [capacityRefreshTick, setCapacityRefreshTick] = useState(0);
  // Row "More actions" menu — one shared state variable holding which row is open,
  // matching the same pattern already used by Vehicles/Customers/Job Cards (see
  // ActionMenu.jsx's own header comment for why this replaced a self-contained
  // per-row RowActionsMenu component).
  const [rowMenuFor, setRowMenuFor] = useState(null);
  const rowMenuAnchorRefs = useRef(new Map());
  const rowMenuAnchorRef = (id) => {
    if (!rowMenuAnchorRefs.current.has(id)) rowMenuAnchorRefs.current.set(id, { current: null });
    return rowMenuAnchorRefs.current.get(id);
  };

  // Consume the cross-module "Create Invoice" prefill. Vehicles/Customers write the
  // selected customer + vehicle to localStorage and switch here; without this the invoice
  // opened blank (or didn't open at all) — losing the whole point of the action.
  // Job Cards' own "Generate Invoice" action also lands here, with a jobNo attached — see
  // the enrichment effect just below for why that's resolved separately, not inline here.
  const pendingJcEnrich = useRef(null);
  useEffect(() => {
    let pf = null;
    try { pf = JSON.parse(localStorage.getItem('maruti_invoice_prefill') || 'null'); } catch {}
    if (!pf) return;
    try { localStorage.removeItem('maruti_invoice_prefill'); } catch {}   // fire once
    if (!canManage) return;
    // Phase 2 — no preview number; the INV- serial is allocated by a server
    // transaction when this invoice is first saved (see save() / persistInvoice).
    setEdit({
      ...emptyInvoice(),
      customerId: pf.customerId || '',
      customer: pf.customer || '',
      phone: pf.phone || '',
      vehicle: pf.vehicle || pf.model || '',
      regNo: pf.regNo || '',
      jobNo: pf.jobNo || '',
      jobCardId: pf.jobNo || '',
    });
    if (pf.jobNo) pendingJcEnrich.current = pf.jobNo;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Job Card review (Issue 2.3/2.4) — "Generate Invoice" opens a brand-new tab, so
  // `jobCards` itself is almost certainly still loading from Firestore the instant the
  // effect above fires; resolving the job card there would silently find nothing. Retry
  // as `jobCards` arrives instead, and import parts/labour/advisor/technician the exact
  // same way linking a job card from inside an open invoice already does
  // (buildJobCardImportLines) — one shared result regardless of entry point. Guarded so
  // it only ever touches the invoice THIS prefill opened, and only once.
  useEffect(() => {
    const jobNo = pendingJcEnrich.current;
    if (!jobNo) return;
    const jc = jobCards.find((j) => j.jobNo === jobNo);
    if (!jc) return; // not loaded yet — this effect re-runs as jobCards changes
    pendingJcEnrich.current = null;
    const jcLines = buildJobCardImportLines(jc, inventory);
    setEdit((cur) => (cur && cur.jobNo === jobNo ? {
      ...cur,
      advisor: cur.advisor || jc.advisor || '',
      technician: cur.technician || jc.technician || '',
      vehicle: cur.vehicle || jc.vehicle || '',
      regNo: cur.regNo || jc.regNo || '',
      lines: jcLines.length ? jcLines : cur.lines,
    } : cur));
  }, [jobCards, inventory]);

  // Deep-link (Issue E): an existing invoice opened in a new tab from Customers lands here —
  // open the actual invoice in the editor. invoices load async, so resolve on arrival (once).
  // Same fix as Job Cards' / Customers' identical pending*Open mechanism: the token must
  // only be cleared once it's actually RESOLVED (found, or confirmed absent from a loaded
  // list), never on the initial read — otherwise a throwaway first mount (React Strict Mode
  // double-invokes effects in dev; ordinary render races can do the same in production)
  // consumes and deletes the one-shot token before `invoices` has even loaded, leaving the
  // surviving mount with nothing to retry and no invoice opened.
  const pendingInvOpen = useRef(null);
  const invOpenDone = useRef(false);
  if (pendingInvOpen.current === null) {
    try { pendingInvOpen.current = localStorage.getItem('maruti_invoice_open') || ''; } catch { pendingInvOpen.current = ''; }
  }
  useEffect(() => {
    const invNo = pendingInvOpen.current;
    if (!invNo || invOpenDone.current || !canManage) return;
    const match = (invoices || []).find((iv) => String(iv.invNo || '') === String(invNo));
    if (match) {
      invOpenDone.current = true;
      setEdit(match);
      try { localStorage.removeItem('maruti_invoice_open'); } catch {}
    } else if ((invoices || []).length) {
      // data loaded but no match — at least filter, and stop retrying
      invOpenDone.current = true;
      setQ(invNo);
      try { localStorage.removeItem('maruti_invoice_open'); } catch {}
    }
  }, [invoices, canManage]);

  // Deep-link: "View All Invoices" for a vehicle — filter the invoice list by its reg.
  useEffect(() => {
    let reg = null;
    try { reg = localStorage.getItem('maruti_invoice_list_filter'); localStorage.removeItem('maruti_invoice_list_filter'); } catch {}
    if (reg) setQ(reg);
  }, []);

  const [payFor, setPayFor] = useState(null);
  const [timelineFor, setTimelineFor] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const toggleSel = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSel = () => setSelected(new Set());
  // Drop ids for invoices that no longer exist (e.g. deleted elsewhere) so "N selected"
  // never overstates the real actionable set — same safeguard Job Cards/Customers/
  // Vehicles/Inventory Parts all already have for their own selections.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const liveIds = new Set(invoices.map((iv) => iv.id));
      const next = new Set([...prev].filter((id) => liveIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [invoices]);
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
  // ISSUE 2/3/6 — every keystroke used to: copy the whole invoice array, sort it with
  // localeCompare (O(n log n) string compares), call deriveStatus() on every invoice
  // (which re-totals every line item of every invoice), and rebuild a search haystack
  // per row. All of that is independent of the query. Derive it once per data change.
  const [dq] = useDeferredSearch(q);

  // GLOBAL SEARCH ACCURACY: Invoice No., Registration No., VIN, Job Card No. and GST No.
  // match by EXACT value only — a complete invoice number can never also surface an
  // unrelated invoice whose number merely starts with or contains it. Customer/phone/
  // vehicle/advisor/technician stay partial-searchable, unchanged.
  const invoiceRows = useMemo(() => [...invoices]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .map((iv) => ({
      iv,
      status: deriveStatus(iv),
      entry: {
        hay: [iv.customer, iv.phone, iv.vehicle, iv.advisor, iv.technician].filter(Boolean).join(' ').toLowerCase(),
        ids: [iv.invNo, iv.regNo, iv.vin, iv.jobNo, iv.gstNo].filter(Boolean).map(normId),
      },
    })), [invoices]);

  const filtered = useMemo(() => {
    let rows = invoiceRows.filter(({ iv, status, entry }) => {
      // CAPACITY ARCHIVE — an archived invoice left the ACTIVE dataset (see
      // services/capacityService.js's archiveRecords). It must not silently disappear
      // (historical/reporting access is a hard requirement), so it's reachable via its
      // own explicit 'Archived' filter value, but every OTHER filter — including 'All' —
      // means "all ACTIVE invoices", matching what "active record count" means
      // everywhere else in the app (the capacity banner, the 5,000 limit itself).
      if (statusF === 'Archived') return iv.archived === true && matchIndexed(entry, dq);
      if (iv.archived === true) return false;
      // 'Outstanding' is a composite of the two "money still owed" statuses — matches
      // the exact population the Dashboard Insight "N invoices awaiting payment" counts
      // (services/analyticsService.js computeInsights), so drilling in from there lands
      // on a filter that agrees with the number that was promised.
      if (statusF === 'Outstanding') { if (!['Unpaid', 'Partially Paid'].includes(status)) return false; }
      else if (statusF !== 'All' && status !== statusF) return false;
      if (payModeF !== 'All' && !(iv.payments || []).some((p) => p.mode === payModeF)) return false;
      if (!inDateRange(iv)) return false;
      return matchIndexed(entry, dq);
    });
    // Universal Search review: an active query re-ranks the filtered rows exact-match
    // first (rankIndexed) — previously this stayed in date-descending order always, so
    // typing the exact invoice number didn't surface it above other, weaker matches
    // (a partial customer-name hit, say) that merely happened to be more recent. With no
    // query, the existing date-descending order (set when invoiceRows was built) is left
    // completely alone.
    if (dq.trim()) {
      rows = [...rows].sort((a, b) => rankIndexed(b.entry, dq) - rankIndexed(a.entry, dq)
        || (b.iv.date || '').localeCompare(a.iv.date || ''));
    }
    return rows.map((x) => x.iv);
  }, [invoiceRows, dq, statusF, payModeF, dateF]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PER));
  // Clamp synchronously: a filter that shrinks the list below the current page would
  // otherwise slice out of range for one frame (empty-table flash) before the setPage(1)
  // effect runs. Never slice past the end.
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * PER, safePage * PER);

  // Billing Action Menu architecture review — a row's contextual menu must not
  // outlive the row's own presence in the currently-visible result set. Search,
  // status/payment/date filters, sorting, and pagination all funnel through
  // `paged`; watching that ONE value (instead of adding a close-call to every
  // individual filter/sort/page setter) is the root-cause fix, not a per-handler
  // patch — any future filter or view control added to this table inherits the
  // same guarantee for free. DropdownPanel's own anchor-visibility check (see
  // components/common/DropdownPanel.jsx) independently closes the menu the
  // instant its row scrolls out of view or is covered by anything else; this
  // effect covers the complementary case where the row disappears from the
  // result set without the anchor itself ever losing visibility mid-scroll.
  useEffect(() => {
    if (rowMenuFor && !paged.some((iv) => iv.id === rowMenuFor)) setRowMenuFor(null);
  }, [paged, rowMenuFor]);

  // Opening any of this module's own dialogs on top of a row (Edit, Collect
  // Payment, Timeline) must close a leftover open row menu — a menu opened via
  // one of these dialogs' own trigger already closes itself (ActionMenu closes
  // before invoking its item's onClick), but a DIFFERENT row's menu can still be
  // open when a dialog opens some other way. A stray menu should never render on
  // top of a dialog it no longer has any relationship to.
  useEffect(() => {
    if (edit || payFor || timelineFor) setRowMenuFor(null);
  }, [edit, payFor, timelineFor]);

  const collectPayment = async (iv, mode, amount, ref, meta = {}) => {
    if (iv.isEstimate) { toast.error('Convert this estimate to an invoice before collecting payment.'); return; }
    if (num(amount) <= 0) { toast.error('Enter the amount received.'); return; }
    // Phase 4b (PH4-01) — `meta.opId` is a STABLE id owned by PaymentModal for the
    // life of this "collect payment" intent; every retry reuses it so the backend
    // transaction can detect and reject a duplicate delivery. Fall back to a fresh
    // id only if a caller doesn't supply one (keeps the API backward-compatible).
    const pay = { ...emptyPayment(), id: meta.opId || emptyPayment().id, mode, amount: num(amount), ref, notes: meta.notes || '', date: meta.paidOn || new Date().toISOString().slice(0, 10) };
    // BUG-CONC-01 — in production, post the payment through the transactional path so
    // two cashiers collecting on the same invoice at once cannot lose a payment. The
    // handler re-reads the invoice server-side and appends to the CURRENT payments
    // array (see collectInvoicePayment in InventoryDashboard). Demo mode (one client,
    // no server) and any environment without the handler keep the in-memory flow below.
    if (onCollectPayment) {
      try {
        await onCollectPayment(iv.id, pay);
      } catch (e) {
        // Phase 4b — the payment carries a stable id, so pressing "Record Payment"
        // again is now safe: the transaction recognises the retry and will not add a
        // second payment. Word the error so it doesn't falsely promise nothing changed.
        toast.error(
          e?.code === 'conc/deleted'
            ? 'This invoice was changed or deleted by another user. Reload and try again.'
            : e?.code === 'conc/estimate'
            ? 'Convert this estimate to an invoice before collecting payment.'
            : 'Couldn’t confirm the payment went through. It may already be recorded — check the invoice, or press Record Payment again (a repeat is safe).',
        );
        return;
      }
      setPayFor(null);
      toast.success(`Payment of ${inr(amount)} recorded`);
      return;
    }
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
    // Universal Notification Architecture review — this used to close the modal and
    // toast "recorded" the instant onPersist was CALLED, not after the Firestore write
    // behind it actually resolved (same class of bug as Job Cards' delete flows).
    // onPersist's own shared layer (persistDocsDiff) already shows its own error toast
    // and re-throws on failure, so on rejection we just leave the modal open — the
    // owner sees why and can retry, rather than a false "recorded" they'd have to
    // notice was wrong.
    try { await onPersist?.(next); } catch (e) { return; }
    setPayFor(null);
    toast.success(`Payment of ${inr(amount)} recorded`);
  };
  const duplicateInvoice = (iv) => setEdit({ ...emptyInvoice(), ...iv, id: `inv_${Date.now()}`, invNo: '', payments: [], paid: 0, status: 'Draft', history: [] });
  // ISSUE 9: the exports became async when they started lazy-loading `xlsx`. Without a
  // busy flag the button looks dead while the chunk downloads, and an impatient double
  // click fires the export twice — two downloads, two toasts.
  const [exporting, setExporting] = useState(false);
  const runExport = async (fn) => {
    if (exporting) return;
    setExporting(true);
    try { await fn(); } catch (e) { toast.error('Export failed.'); } finally { setExporting(false); }
  };

  // ---- EXPORTS (ISSUE 4) ------------------------------------------------------
  // These emitted CSV. A CSV carries no column widths and no cell types, so Excel
  // auto-sized the date column too narrow and rendered "########", and the dates were
  // inert text that would not sort or filter as dates. Neither is fixable in CSV —
  // the format simply has nowhere to put that information. So: emit a real .xlsx with
  // genuine date cells (`t: 'd'`) and explicit column widths.
  const exportCSV = async () => {
    if (demoMode && !demoCanExport) return notify.permissionDenied('This action has been disabled by the administrator.');
    const head = ['Invoice', 'Date', 'Customer', 'Phone', 'Vehicle', 'Job Card', 'Advisor', 'Subtotal', 'GST', 'Grand Total', 'Paid', 'Balance', 'Profit', 'Status'];
    const rows = filtered.map((iv) => {
      const t = totalsOf(iv);
      const iso = iv.date || localDateStr(tsToDate(iv.createdAt) || new Date());
      return [iv.invNo, asDate(iso), iv.customer, iv.phone, iv.vehicle, iv.jobNo, iv.advisor,
        Math.round(t.sub), Math.round(t.gst), t.grand, Math.round(t.paid), Math.round(t.balance), Math.round(t.profit), deriveStatus(iv)];
    });
    await writeSheet({ filename: `invoices-${stamp()}.xlsx`, sheetName: 'Invoices', head, rows, dateCols: [1] });
  };
  // Universal selection-scope contract (lib/selectionScope.js, reference: Job Cards) —
  // resolved against the FULL invoice list, never `filtered`, so a status/payment/date
  // filter change after selecting never silently drops a selected invoice from a bulk
  // action. Billing already got this right independently; now sharing the same
  // implementation as every other module instead of its own parallel one.
  const selectedInvoices = () => resolveSelectedRecords(selected, invoices, (iv) => iv.id);
  const hiddenSelectedCount = useMemo(
    () => countHiddenSelections(selected, filtered, (iv) => iv.id),
    [selected, filtered],
  );
  const bulkExport = async (gstOnly = false) => {
    const rows = selectedInvoices();
    if (!rows.length) return toast.error('Select invoices first');
    // COLUMN-SHIFT BUG: the head had 9 columns but each row pushed 10 values (it emitted
    // BOTH an ISO date and a display date under a single "Date" header). Every column
    // from Date rightward was therefore shifted one place — on the GST report the
    // "CGST" column actually contained SGST, and "Grand Total" held the total GST.
    // One date column, one date value.
    const head = gstOnly
      ? ['Invoice', 'Date', 'Customer', 'GSTIN', 'Taxable', 'CGST', 'SGST', 'Total GST', 'Grand Total']
      : ['Invoice', 'Date', 'Customer', 'Phone', 'Vehicle', 'Grand Total', 'Paid', 'Balance', 'Status'];
    const body = rows.map((iv) => {
      const t = totalsOf(iv);
      const iso = iv.date || localDateStr(tsToDate(iv.createdAt) || new Date());
      return gstOnly
        ? [iv.invNo, asDate(iso), iv.customer, iv.gstNo || '', Math.round(t.afterDisc), Math.round(t.cgst), Math.round(t.sgst), Math.round(t.gst), t.grand]
        : [iv.invNo, asDate(iso), iv.customer, iv.phone, iv.vehicle, t.grand, Math.round(t.paid), Math.round(t.balance), deriveStatus(iv)];
    });
    // writeSheet throws if any row's length disagrees with the header, so a column
    // shift can never reach a customer's GST filing again.
    await writeSheet({
      filename: `${gstOnly ? 'gst-report' : 'invoices'}-${stamp()}.xlsx`,
      sheetName: gstOnly ? 'GST Report' : 'Invoices',
      head,
      rows: body,
      dateCols: [1],
    });
    notify.exported(`Exported ${rows.length} invoice(s)`);
  };
  // Universal selection-scope contract, large-selection half (Scenario 8): unlike Job
  // Cards' combined multi-page PDF, each invoice here downloads as its OWN separate
  // file (Customer/Workshop Copy are legally distinct documents, not pages of one
  // report) — so a big selection means many sequential native browser downloads, not
  // one big CPU-bound draw. Browsers throttle/prompt-block rapid multi-file downloads
  // well before hundreds, and handing someone 300 separate PDFs with no manifest is
  // its own usability problem — a smaller cap than Job Cards' 150, plus the same
  // busy/progress state and requestAnimationFrame yield so the tab stays responsive
  // and the toolbar can't be double-clicked mid-run.
  const MAX_BULK_INVOICE_PDF = 50;
  const [bulkDocBusy, setBulkDocBusy] = useState(null); // { mode: 'print'|'pdf', done, total } | null
  // Universal selection→export/PDF/print record-set review (Issue 12/13) — Print must
  // resolve and cap the exact same way PDF does, through the exact same combined
  // document, not a parallel per-invoice window.print() loop. Both are now thin calls
  // into downloadCombinedInvoicePDF (defined below, alongside drawInvoiceDocument/
  // downloadPDF) — selectedInvoices() is the one authoritative scope both read.
  const bulkPDF = () => downloadCombinedInvoicePDF(selectedInvoices(), false);
  const bulkPrint = () => downloadCombinedInvoicePDF(selectedInvoices(), true);
  const bulkReminder = () => {
    const rows = selectedInvoices().filter((iv) => totalsOf(iv).balance > 0 && iv.phone);
    if (!rows.length) return toast.error('No selected invoices with a balance & phone');
    rows.forEach((iv) => { const t = totalsOf(iv); window.open(`https://wa.me/91${(iv.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(`Reminder: Invoice ${iv.invNo} has a pending balance of ${inr(t.balance)}. Kindly clear at your convenience. — Sri Baba Balaji Maruti Care`)}`, '_blank'); });
    toast.success(`Opened ${rows.length} reminder(s)`);
  };
  // C-1 fix: these four all used to fire their toast (and, for bulk ops, clear selection)
  // the instant onPersist/onDelete was CALLED, not after it actually finished — so a
  // rejected write looked identical to a successful one. Each now awaits the real
  // outcome (Promise.allSettled for the bulk ones, so one failure doesn't stop the rest)
  // and reports exactly what happened instead of assuming success.
  const bulkArchive = async () => {
    const rows = selectedInvoices();
    const results = await Promise.allSettled(rows.map((iv) => onPersist?.({ ...iv, archived: true })));
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) toast.error(`Archived ${rows.length - failed} of ${rows.length} — ${failed} failed to save.`);
    else toast.success(`Archived ${rows.length}`);
    clearSel();
  };
  const bulkDelete = async () => {
    if (demoMode && !demoCanDelete) return notify.permissionDenied('This action has been disabled by the administrator.');
    if (!isAdmin) return toast.error('Only admins can bulk-delete');
    const rows = selectedInvoices();
    if (!await confirmDialog({ title: `Delete ${rows.length} invoice(s)?`, message: 'This cannot be undone.', danger: true, confirmText: 'Delete' })) return;
    const results = await Promise.allSettled(rows.map((iv) => onDelete?.(iv)));
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) toast.error(`Deleted ${rows.length - failed} of ${rows.length} — ${failed} failed.`);
    else notify.deleted(`Deleted ${rows.length}`);
    clearSel();
  };
  const convertEstimate = async (iv) => {
    // Phase 2 — a converted estimate must be ISSUED A FRESH invoice serial, and that
    // serial comes from the server counter (transaction), same as any new invoice. Tag
    // the intent; persistInvoice allocates it, then the guarded write applies it.
    const next = {
      ...iv, isEstimate: false, invNo: '', status: 'Unpaid',
      __allocSeq: 'invoices', __allocPrefix: 'INV', __allocSeed: invSeqMax(invoices, 'INV') + 1,
      history: [...(iv.history || []), { at: Date.now(), action: `Converted from estimate ${iv.invNo}`, by: demoMode ? 'Demo User' : 'Staff' }],
    };
    next.status = deriveStatus(next);
    let saved;
    try { saved = await onPersist?.(next); } catch (e) { return; }
    toast.success(`${iv.invNo} → ${(saved || next).invNo}`);
  };
  const changeStatus = async (iv, status, verb) => {
    // Cancel/Refund/Return restore inventory stock via the parent's delete-style path
    // is handled at persist; here we just flag the status + history. Stock restoration
    // for returns happens through onDelete's stock-restore logic when appropriate.
    const next = { ...iv, status, history: [...(iv.history || []), { at: Date.now(), action: verb, by: demoMode ? 'Demo User' : 'Staff' }] };
    try { await onPersist?.(next); } catch (e) { return; }
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
    // E2E workflow QA fix: same gross-vs-net bug as totalsOf's partsRev/labourRev — this
    // summed raw qty*rate, ignoring line discount, so a discounted part's "revenue" here
    // (and hence its rank in Top Selling Parts) was inflated above what the invoice
    // actually billed for it. Reproduced live: a 10%-off line showed its pre-discount
    // gross here instead of the net figure the Invoice Summary/KPIs correctly show.
    const partMap = {};
    invoices.forEach((iv) => { if (deriveStatus(iv) === 'Cancelled') return; (iv.lines || []).filter((l) => l.kind === 'Part').forEach((l) => { const k = l.desc || '—'; const gross = num(l.qty) * num(l.rate); const net = l.disc ? Math.max(0, gross - gross * (num(l.disc) / 100)) : gross; partMap[k] = (partMap[k] || 0) + net; }); });
    const topParts = Object.entries(partMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { count: invoices.length, grand, paid, outstanding, gstTotal, partsRev, labourRev, profitToday, revToday, invToday, draftCount, pendingCount, monthRev, monthProfit, avgInv, modeSplit, trend, topCustomers, topParts };
  }, [invoices]);

  // `internal` renders the WORKSHOP COPY: it keeps internal annotations such as
  // "(outside purchase)". The CUSTOMER copy never shows them — where a part was
  // sourced from is the workshop's business, not the customer's, and printing it
  // looks unprofessional (and invites questions about margin).
  // Billing Module — Invoice PDF Architecture. TWO document variants driven by
  // `mode`, genuinely two renderers now (not one function with mode-gated
  // sections):
  //   'customer' (default) — the document that leaves the building. Only what a
  //     customer is entitled to see: what they bought, what tax applies, what they
  //     owe. Drawn inline below, unchanged by the workshop-copy rewrite.
  //   'workshop' — an internal, staff/management document, fully delegated to
  //     lib/workshopInvoicePdf.js's card-based renderer ("Workshop Copy PDF —
  //     Professional Document Layout, Rendering & Verification Review"). Extracted
  //     out of this component specifically so the generator has zero React/DOM
  //     dependency and can be stress-tested from a plain Node script against
  //     synthetic edge-case invoices (see scripts/render-workshop-pdf-stress.js) —
  //     a document this information-dense needs more than "it exported without
  //     throwing" as proof it renders correctly.
  // Both variants still share: QR payload construction, money formatting, and the
  // fixed-position footer + page-numbering pass at the very end of this function.
  // Universal selection→export/PDF/print record-set review — this used to create its
  // OWN jsPDF instance and doc.save() internally, so a bulk action had no way to draw
  // more than one invoice onto a shared document: the only way to produce N invoices
  // was N separate calls, each with its own browser download. Split into a pure
  // drawer (drawInvoiceDocument, draws ONE invoice onto whatever doc/page it's handed
  // — never creates the doc, never saves it) plus a thin single-invoice wrapper
  // (downloadPDF, unchanged behaviour) and downloadCombinedInvoicePDF (the actual
  // fix — one jsPDF instance, one addPage() between invoices, one save/print call),
  // exactly mirroring Job Cards' drawJobCardDocument/downloadPDF/downloadCombinedPDF
  // split — the proven reference pattern, not a parallel one invented for Billing.
  async function drawInvoiceDocument(doc, iv, mode = 'customer') {
    const isWorkshop = mode === 'workshop';
    // Looked up once and reused everywhere below (Job Card section, labour
    // technician subtext, Internal Notes) — not re-queried per section.
    const jc = isWorkshop && iv.jobNo ? jobCards.find((j) => j.jobNo === iv.jobNo) : null;
    const { W, M } = PDF_PAGE; const t = totalsOf(iv);
    // The page-number footer below stamps EVERY page this invoice occupies with a
    // number relative to ITS OWN pages ("Page 1 of 2"), never the combined document's
    // absolute page count — so an invoice reads identically whether it was generated
    // standalone or is the 9th of 20 invoices in one combined PDF. pageStart records
    // where in the real document this invoice's own "page 1" actually lands.
    const pageStart = doc.internal.getNumberOfPages();
    // PDF-safe money: jsPDF's built-in Helvetica (WinAnsi) has NO Rupee glyph (U+20B9),
    // so "₹" renders as garbage. Use "Rs." + Indian digit grouping, which the built-in
    // font renders perfectly and every Indian workshop/customer reads correctly.
    const money = (n) => `Rs. ${num(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    // liveShop(demoMode) merges Settings -> Business Profile (Workshop Name/Phone/
    // GST/Address/Email/Logo) into the SHOP defaults; Settings QA fix — these fields
    // saved correctly but every PDF generator previously used the bare SHOP constant
    // and never read them. See lib/pdfTheme.js.
    const shop = demoMode ? maskShop(liveShop(demoMode)) : liveShop(demoMode);
    // Workshop copy never leaves the building, so its QR points staff straight at
    // this record inside the running app (the same ?open=invoice:<no> deep link the
    // rest of the app already uses for cross-module "open this record" links — see
    // InventoryDashboard.js's deep-link handler), not the public customer /verify
    // page. Reusing buildQrPayload's own public-URL QR for staff would be actively
    // wrong: it can only ever open a page that reads back sanitised, public-safe
    // fields, never the actual billing record.
    const internalLink = () => {
      if (typeof window === 'undefined' || !window.location || !iv.invNo) return '';
      const origin = `${window.location.origin}${window.location.pathname}`;
      return `${origin}?open=invoice:${encodeURIComponent(iv.invNo)}`;
    };
    // QR: short payload (keeps the module count low so each module stays big enough
    // to scan) rendered at high resolution and drawn LARGE on the page. The old one
    // encoded ~81 chars into a 50pt square = 1.35pt per module, which no phone could
    // resolve -> "No usable data found".
    const qrPayload = isWorkshop ? internalLink() : buildQrPayload({
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
    const docTypeLabel = iv.isEstimate ? 'ESTIMATE / QUOTATION' : (iv.gstNo ? 'TAX INVOICE' : 'INVOICE');
    const partLines = (iv.lines || []).filter((l) => l.kind === 'Part' || l.kind === 'Other');
    const svcLines = (iv.lines || []).filter((l) => l.kind === 'Labour' || l.kind === 'Service');
    const otherLines = (iv.lines || []).filter((l) => !['Part', 'Other', 'Labour', 'Service'].includes(l.kind));
    // `page` is tracked so the shared footer/page-numbering pass at the end of this
    // function knows how many pages to stamp, regardless of which renderer below
    // produced them.
    let page = 1;

    if (isWorkshop) {
      const cust = customers.find((c) => c.id === iv.customerId) || null;
      const veh = cust ? (cust.vehicles || []).find((v) => v.id === iv.vehicleId) : null;
      const result = renderWorkshopInvoicePdf(doc, {
        iv, jc, cust, veh, shop, status: deriveStatus(iv), totals: t, money, qrDataUrl, docTypeLabel, partLines, svcLines, otherLines,
      });
      page = result.pageCount;
    } else {
      // ---- Customer copy — unchanged by the workshop-copy rewrite above.
      // ---- Header band (GLOBAL PDF FRAMEWORK: shared with Job Card + Purchase Order —
      // see lib/pdfTheme.js. Was its own 62pt-tall band with only 4 letterhead lines
      // (no email/website); now the same 66pt band + full 5-line letterhead as every
      // other branded document, so all three carry identical, complete contact info.)
      drawPdfHeader(doc, { W, M, shop });
      // ---- Title + meta
      doc.setTextColor(20, 20, 20); doc.setFontSize(13); doc.setFont('helvetica', 'bold');
      doc.text(docTypeLabel, M, 124);
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
      // ---- Line items: PARTS USED (name, qty, rate, amount) then LABOUR / SERVICES
      // (service name, amount) -- no Qty column, because a "Water Wash" is not 2
      // units of anything. Only a service explicitly billed hourly shows Hours x
      // Rate/hr. Mixing them in one table made services look like stock items.
      // GLOBAL PDF FRAMEWORK (overlap fix, confirmed against an actual rendered PDF):
      // this was `+ 18`, leaving the table header starting at qrTop+QR_PT+18=271, so its
      // filled bar (drawn from y-12 to y-12+18, i.e. 259-277) directly covered the QR
      // caption text at qrTop+QR_PT+8=261 — "Scan to verify" rendered visually inside
      // the gray "PARTS USED" header bar. `+ 32` clears the caption's own text height
      // (it has a descender, "verify") with real margin before the header starts.
      let y = Math.max(by + 8, qrTop + QR_PT + 32);
      const cQty = W - M - 200, cRate = W - M - 120, cAmt = W - M - 6;
      const lineAmt = (l) => num(l.qty) * num(l.rate) * (1 - (num(l.disc) || 0) / 100);
      // GLOBAL PDF FRAMEWORK (readability/print-quality pass): a long invoice's
      // continuation page previously had NO letterhead at all, and NO page had a
      // page number anywhere in this generator. Every page gets the shared slim
      // continuation header (drawPdfHeader's `sub` mode) + a page number at save time.
      const pageBreak = () => {
        if (y > 700) {
          doc.addPage(); page += 1;
          drawPdfHeader(doc, { W, M, shop, sub: `${docTypeLabel} — ${iv.invNo} (continued)` });
          y = 78;
        }
      };
      const sectionHeader = (title, withQty) => {
        pageBreak();
        doc.setFillColor(240, 236, 226); doc.rect(M, y - 12, W - 2 * M, 18, 'F');
        doc.setFontSize(8); doc.setTextColor(40, 40, 40); doc.setFont('helvetica', 'bold');
        doc.text(title, M + 6, y);
        if (withQty) { doc.text('QTY', cQty, y, { align: 'center' }); doc.text('RATE', cRate, y, { align: 'right' }); }
        doc.text('AMOUNT', cAmt, y, { align: 'right' });
        doc.setFont('helvetica', 'normal'); y += 18;
      };
      if (partLines.length) {
        const drawPartsHeader = () => sectionHeader('PARTS USED', true);
        drawPartsHeader();
        partLines.forEach((l) => {
          const rowH = 23;
          if (y + rowH > 700) { doc.addPage(); page += 1; drawPdfHeader(doc, { W, M, shop, sub: `${docTypeLabel} — ${iv.invNo} (continued)` }); y = 78; drawPartsHeader(); }
          doc.setTextColor(30, 30, 30); doc.setFontSize(8.5);
          doc.text(String(l.desc || '-').slice(0, 52), M + 6, y);
          doc.text(String(num(l.qty)), cQty, y, { align: 'center' });
          doc.text(money(l.rate), cRate, y, { align: 'right' });
          doc.text(money(lineAmt(l)), cAmt, y, { align: 'right' });
          doc.setDrawColor(...PDF_RULE.light); doc.line(M, y + 5, W - M, y + 5); y += 17;
        });
        y += 8;
      }
      if (svcLines.length) {
        const drawLabourHeader = () => sectionHeader('LABOUR / SERVICES', false);
        drawLabourHeader();
        svcLines.forEach((l) => {
          const rowH = 17 + 6;
          if (y + rowH > 700) { doc.addPage(); page += 1; drawPdfHeader(doc, { W, M, shop, sub: `${docTypeLabel} — ${iv.invNo} (continued)` }); y = 78; drawLabourHeader(); }
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
          doc.setDrawColor(...PDF_RULE.light); doc.line(M, y + 5, W - M, y + 5); y += 17;
        });
        y += 8;
      }
      if (otherLines.length) {
        const drawOtherHeader = () => sectionHeader('OTHER CHARGES', true);
        drawOtherHeader();
        otherLines.forEach((l) => {
          const rowH = 23;
          if (y + rowH > 700) { doc.addPage(); page += 1; drawPdfHeader(doc, { W, M, shop, sub: `${docTypeLabel} — ${iv.invNo} (continued)` }); y = 78; drawOtherHeader(); }
          doc.setTextColor(30, 30, 30); doc.setFontSize(8.5);
          doc.text(String(l.desc || '-').slice(0, 52), M + 6, y);
          doc.text(String(num(l.qty)), cQty, y, { align: 'center' });
          doc.text(money(l.rate), cRate, y, { align: 'right' });
          doc.text(money(lineAmt(l)), cAmt, y, { align: 'right' });
          doc.setDrawColor(...PDF_RULE.light); doc.line(M, y + 5, W - M, y + 5); y += 17;
        });
        y += 8;
      }
      // ---- Totals block
      // Reserves room for the whole block (up to 9 rows: subtotal, discount, CGST+SGST,
      // round off, grand total, paid, balance, payments line) before starting it, rather
      // than the line-by-line `pageBreak()` used above — splitting a totals block itself
      // across a page break, or letting it collide with the fixed-position footer below,
      // is exactly the "no broken page breaks / no overlapping content" this pass targets.
      if (y + 8 + 130 > 700) { doc.addPage(); page += 1; drawPdfHeader(doc, { W, M, shop, sub: `${docTypeLabel} — ${iv.invNo} (continued)` }); y = 78; }
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
      // GLOBAL PDF FRAMEWORK (overlap fix, confirmed against an actual rendered PDF):
      // this rule sat only 6pt above the NEXT row's text baseline — fine for a same-size
      // row, but "Grand Total" draws at bold 10pt (vs the 8.5pt rows around it), so its
      // own cap-height/ascenders reached up into where the rule was drawn, and the rule
      // visibly cut through the "Grand Total" text itself. Real clearance on both sides
      // of the rule now, sized for the LARGER bold row that follows it.
      y += 4;
      doc.setDrawColor(...PDF_RULE.medium); doc.line(lx, y, cAmt, y);
      y += 12;
      row('Grand Total', t.grand, true); row('Paid', t.paid); row('Balance Due', t.balance, true);
      const hasPayments = (iv.payments || []).length > 0;
      if (hasPayments) { doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(120, 120, 120); doc.text(`Payments: ${iv.payments.map((p) => `${p.mode} ${money(p.amount)}`).join(',  ')}`.slice(0, 95), M, y + 6); }
      // Settings QA fix: Settings -> Billing -> Bank/UPI Details & Invoice Terms
      // ("Printed on every invoice and estimate") saved but were never drawn
      // anywhere. The totals block above always reserves room up to y=700 before
      // it's allowed to start (see the page-break check before it) — its own
      // content can never grow past that, which guarantees real, empty space
      // between here and the footer's divider line at fy-34=758 regardless of how
      // many totals rows this specific invoice drew. Only occupies that gap when
      // at least one of the two is actually set — never reserves space for an
      // empty field. Left column, small muted type, matching the "Payments:" line
      // just above it in weight; clamped so it can never reach into the footer
      // band even in a pathological case.
      if (!isWorkshop && (shop.bankDetails || shop.termsText || shop.hoursText)) {
        let by = Math.min(y + (hasPayments ? 16 : 6), 745);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(120, 120, 120);
        if (shop.bankDetails) { doc.text(`Bank / UPI: ${shop.bankDetails}`.slice(0, 100), M, by); by = Math.min(by + 9, 745); }
        if (shop.termsText) { doc.text(`Terms: ${shop.termsText}`.slice(0, 100), M, by); by = Math.min(by + 9, 745); }
        if (shop.hoursText) doc.text(`Working Hours: ${shop.hoursText}`.slice(0, 100), M, by);
      }
    }

    // ---- Footer (shared by both variants)
    const fy = 792;
    doc.setDrawColor(...PDF_RULE.medium); doc.line(M, fy - 34, W - M, fy - 34);
    doc.setFontSize(7.5); doc.setTextColor(120, 120, 120); doc.setFont('helvetica', 'normal');
    // Workshop copy is read by staff/management, not the customer, so its footer
    // leads with what an internal/audit document needs — what it is and who it's
    // NOT for — instead of customer-facing courtesy copy that doesn't apply here.
    if (isWorkshop) doc.text('INTERNAL WORKSHOP COPY  ·  SYSTEM-GENERATED DOCUMENT', M, fy - 22);
    // Settings QA fix: Settings -> Billing -> Invoice Footer ("Printed on every
    // invoice and estimate") saved into biz.bizFooter but nothing ever read it —
    // the customer-copy footer was always this hardcoded default regardless.
    // shop.footerText comes from liveShop() (lib/pdfTheme.js) — this function is
    // in the OUTER BillingModule component, not InvoiceModal, so billingCfg
    // (InvoiceModal's own local Settings read) isn't in scope here; shop already
    // is, from the same fix that wired Business Identity into this exact function.
    // Workshop copy's footer is a fixed internal-document label, not customer
    // courtesy copy, so it's deliberately not overridden here. Truncated like
    // every other free-text line drawn on this footer (e.g. the payments line
    // below) — a custom footer is free text with no length limit of its own.
    else doc.text((shop.footerText || `Thank you for choosing ${shop.name}.`).slice(0, 90), M, fy - 22);
    if (isWorkshop) doc.text('Not valid as a tax invoice. For workshop and management use only — not for customer distribution.', M, fy - 12);
    else if (iv.isEstimate) doc.text('This is an estimate and not a tax invoice. Prices subject to change.', M, fy - 12);
    else doc.text('Goods once sold will not be taken back. E&OE.', M, fy - 12);
    doc.setDrawColor(...PDF_RULE.medium); doc.line(W - M - 150, fy - 20, W - M, fy - 20);
    doc.setFontSize(8); doc.setTextColor(90, 90, 90); doc.text('Authorised Signatory', W - M, fy - 8, { align: 'right' });
    doc.setFontSize(7); doc.setTextColor(150, 150, 150); doc.text('For ' + shop.name, W - M, fy + 1, { align: 'right' });
    // GLOBAL PDF FRAMEWORK: page numbers on every page, including continuation pages.
    // Workshop pages also print the total (Issue 4: a page separated from the rest
    // should still say where it belongs — "Page 2 of 3" survives that, "Page 2" alone
    // doesn't). Customer copy keeps its exact prior "Page N" form. setPage targets
    // pageStart + p - 1 (this invoice's ACTUAL page in the real document), not p —
    // when this is invoice #3 of a combined PDF, its own "page 1" is nowhere near the
    // document's real page 1, but its footer must still say "Page 1", not "Page 9".
    for (let p = 1; p <= page; p += 1) { doc.setPage(pageStart + p - 1); drawPdfPageNumber(doc, p, { W, M, total: isWorkshop ? page : undefined }); }
  }

  const downloadPDF = async (iv, printAfter = false, mode = 'customer') => {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: PDF_PAGE.unit, format: PDF_PAGE.format });
    await drawInvoiceDocument(doc, iv, mode);
    if (printAfter) { doc.autoPrint(); window.open(doc.output('bloburl'), '_blank'); } else doc.save(`${iv.invNo}.pdf`);
  };

  // Universal selection→export/PDF/print record-set review (Issue 9/10) — the actual
  // fix: a bulk PDF/Print action must produce exactly ONE file/print job covering
  // exactly the selection, never N separate browser downloads or N print dialogs.
  // Same shape as Job Cards' downloadCombinedPDF: one jsPDF instance, drawn onto by
  // drawInvoiceDocument in a loop with addPage() between invoices, a hard cap so a
  // very large selection can't stall the tab or hand back a document nobody can use,
  // and a requestAnimationFrame yield between invoices so the tab stays responsive.
  const downloadCombinedInvoicePDF = async (rows, printAfter = false, mode = 'customer') => {
    if (!rows.length) { toast.error('No invoices selected. Select at least one invoice to continue.'); return; }
    if (rows.length === 1) { await downloadPDF(rows[0], printAfter, mode); return; } // identical output, keeps the <invNo>.pdf filename convention
    if (rows.length > MAX_BULK_INVOICE_PDF) {
      toast.error(`${rows.length} invoices selected — a single ${printAfter ? 'print job' : 'PDF'} supports up to ${MAX_BULK_INVOICE_PDF}. Narrow your selection and try again.`, { duration: 7000 });
      return;
    }
    setBulkDocBusy({ mode: printAfter ? 'print' : 'pdf', done: 0, total: rows.length });
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: PDF_PAGE.unit, format: PDF_PAGE.format });
      for (let i = 0; i < rows.length; i += 1) {
        if (i > 0) doc.addPage();
        // eslint-disable-next-line no-await-in-loop -- intentionally sequential, see Job Cards' downloadCombinedPDF
        await drawInvoiceDocument(doc, rows[i], mode);
        setBulkDocBusy({ mode: printAfter ? 'print' : 'pdf', done: i + 1, total: rows.length });
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      const stamp = new Date().toISOString().slice(0, 10);
      if (printAfter) { doc.autoPrint(); window.open(doc.output('bloburl'), '_blank'); }
      else doc.save(`Invoices-${rows.length}-selected-${stamp}.pdf`);
      toast.success(`${printAfter ? 'Print dialog opened' : 'PDF downloaded'} for exactly ${rows.length} selected invoice${rows.length === 1 ? '' : 's'}`);
    } finally {
      setBulkDocBusy(null);
    }
  };

  return (
    <PageHeader title={t('page.billing', 'Billing')} icon={Receipt}>
      <CapacityBanner moduleKey="invoices" demoMode={demoMode} actorEmail={actorEmail} refreshKey={`${invoices.length}-${capacityRefreshTick}`} className="mb-4" onCleanupComplete={onCapacityCleanup} />
      <CapacityCleanupModal
        open={capacityBlockedOpen} onClose={() => setCapacityBlockedOpen(false)}
        moduleKey="invoices" demoMode={demoMode} actorEmail={actorEmail}
        onComplete={() => { onCapacityCleanup?.(); setCapacityRefreshTick((n) => n + 1); }}
      />
      {/* COLOR SYSTEM REVIEW: 12 KPI cards used 10 different, mostly decorative colors
          (green/blue/violet/amber/red/cyan/indigo/pink/lighter-green/gray/gold/green) —
          almost every card invented its own accent with no semantic reason, exactly the
          "every card competes for attention" anti-pattern. Reworked so color communicates
          meaning: Revenue is the page's one deliberate business highlight (gold, matching
          Vehicles' own Revenue KPI); Profit is genuinely positive (green); Pending
          Payments and Outstanding keep their real warning/danger meaning (amber/red,
          matching the same words' Badge colors elsewhere in this app — see
          constants/ui.js STATUS_COLOR); every other card is a plain count or breakdown
          figure with no inherent status, so it stays neutral. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <Stat icon={IndianRupee} label={t('billing.kpi.todaysRevenue', "Today's Revenue")} value={inr(stats.revToday)} color={SEMANTIC.gold} />
        <Stat icon={Receipt} label={t('billing.kpi.todaysInvoices', "Today's Invoices")} value={stats.invToday} color={SEMANTIC.muted} />
        <Stat icon={FileText} label={t('billing.kpi.draftsEstimates', 'Drafts / Estimates')} value={stats.draftCount} color={SEMANTIC.muted} />
        <Stat icon={Clock} label={t('billing.kpi.pendingPayments', 'Pending Payments')} value={stats.pendingCount} color={SEMANTIC.warn} />
        <Stat icon={Wallet} label={t('customers.col.outstanding', 'Outstanding')} value={inr(stats.outstanding)} color={SEMANTIC.danger} />
        <Stat icon={TrendingUp} label={t('billing.kpi.gstCollected', 'GST Collected')} value={inr(stats.gstTotal)} color={SEMANTIC.muted} />
        <Stat icon={Receipt} label={t('billing.kpi.partsRevenue', 'Parts Revenue')} value={inr(stats.partsRev)} color={SEMANTIC.muted} />
        <Stat icon={Receipt} label={t('billing.kpi.labourRevenue', 'Labour Revenue')} value={inr(stats.labourRev)} color={SEMANTIC.muted} />
        <Stat icon={TrendingUp} label={t('billing.kpi.profitToday', 'Profit Today')} value={inr(stats.profitToday)} color={SEMANTIC.ok} />
        <Stat icon={IndianRupee} label={t('billing.kpi.avgInvoice', 'Avg Invoice')} value={inr(stats.avgInv)} color={SEMANTIC.muted} />
        <Stat icon={IndianRupee} label={t('billing.kpi.revenueMonth', 'Revenue (Month)')} value={inr(stats.monthRev)} color={SEMANTIC.gold} />
        <Stat icon={TrendingUp} label={t('billing.kpi.profitMonth', 'Profit (Month)')} value={inr(stats.monthProfit)} color={SEMANTIC.ok} />
      </div>

      {invoices.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
          <div className="lg:col-span-2 rounded-2xl p-4" style={cardStyle}>
            <p className="text-xs font-bold uppercase tracking-wide text-white/50 mb-2">Revenue Trend <span className="text-white/45 normal-case font-normal">· last 14 days</span></p>
            <RevenueTrend data={stats.trend} />
            <div className="flex justify-between text-[9px] text-white/45 mt-1">{stats.trend.filter((_, i) => i % 3 === 0).map((d) => <span key={d.key}>{d.label}</span>)}</div>
          </div>
          <div className="rounded-2xl p-4" style={cardStyle}>
            <p className="text-xs font-bold uppercase tracking-wide text-white/50 mb-2">Payment Modes</p>
            {(() => {
              const segs = Object.entries(stats.modeSplit).map(([k, v], i) => ({ label: k, value: v, color: CHART_COLORS[i % CHART_COLORS.length] }));
              const total = segs.reduce((s, x) => s + x.value, 0);
              if (total <= 0) return <p className="text-xs text-white/45 py-6 text-center">No payments recorded yet.</p>;
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
            <div className="space-y-1.5">{stats.topCustomers.map(([name, v], i) => <div key={name} className="flex items-center justify-between gap-2 text-[11px]"><span className="text-white/60 truncate">{i + 1}. {name}</span><span className="text-[#d4af37] font-semibold">{inr(v)}</span></div>)}{stats.topCustomers.length === 0 && <p className="text-xs text-white/45">No data.</p>}</div>
          </div>
          <div className="rounded-2xl p-4" style={cardStyle}>
            <p className="text-xs font-bold uppercase tracking-wide text-white/50 mb-2">Top Selling Parts</p>
            <div className="space-y-1.5">{stats.topParts.map(([name, v], i) => <div key={name} className="flex items-center justify-between gap-2 text-[11px]"><span className="text-white/60 truncate">{i + 1}. {name}</span><span className="text-emerald-400 font-semibold">{inr(v)}</span></div>)}{stats.topParts.length === 0 && <p className="text-xs text-white/45">No parts billed yet.</p>}</div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row flex-wrap gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/45" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('billing.searchPlaceholder', 'Search invoice, customer, phone, vehicle, reg, VIN, job card, advisor…')} className={`${inputCls} pl-9`} />
        </div>
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className={`${inputCls} sm:w-36`}>{['All', 'Outstanding', 'Draft', 'Estimate', 'Unpaid', 'Partially Paid', 'Paid', 'Cancelled', 'Refunded', 'Returned', 'Archived'].map((s) => <option key={s} value={s} style={{ background: '#141414' }}>{s === 'All' ? t('customers.filter.allStatus', 'All Status') : t(`status.${s.toLowerCase().replace(/\s/g, '')}`, s)}</option>)}</select>
        <select value={payModeF} onChange={(e) => setPayModeF(e.target.value)} className={`${inputCls} sm:w-32`}>{['All', ...PAYMENT_MODES].map((s) => <option key={s} value={s} style={{ background: '#141414' }}>{s === 'All' ? t('billing.filter.allPayments', 'All Payments') : s}</option>)}</select>
        <select value={dateF} onChange={(e) => setDateF(e.target.value)} className={`${inputCls} sm:w-28`}>{[['All', t('billing.filter.allTime', 'All Time')], ['Today', t('billing.filter.today', 'Today')], ['Week', t('billing.filter.thisWeek', 'This Week')], ['Month', t('billing.filter.thisMonth', 'This Month')]].map(([v, l]) => <option key={v} value={v} style={{ background: '#141414' }}>{l}</option>)}</select>
        <button onClick={() => runExport(exportCSV)} disabled={exporting} aria-busy={exporting} className="h-11 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-white/5 border border-white/10 text-white/75 hover:bg-white/10 disabled:opacity-50 disabled:cursor-wait"><FileDown size={13} /> {exporting ? t('billing.exporting', 'Exporting…') : t('common.export', 'Export')}</button>
        {canManage && (
          <button
            onClick={async () => {
              // CAPACITY GUARD — checked here, before the editor ever opens. Blocking at
              // the button means there is never a half-filled draft to lose if the limit
              // has been reached.
              const { blocked } = await checkCapacityGuard('invoices', { demoMode });
              if (blocked) {
                notify.warning('Record limit reached. Please free space before creating a new record.');
                setCapacityBlockedOpen(true);
                return;
              }
              // Phase 2 — no preview number; the INV- serial is allocated by a server
              // transaction when this invoice is first saved (see save() / persistInvoice).
              setEdit({ ...emptyInvoice() });
            }}
            className="h-11 px-4 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] flex items-center gap-1.5 active:scale-95 transition"
          ><Plus size={14} /> {t('billing.newInvoice', 'New Invoice')}</button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 px-3 py-2.5 rounded-xl" style={{ background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.25)' }}>
          <span className="text-xs font-bold text-[#d4af37]">{selected.size} selected{hiddenSelectedCount > 0 ? ` (${hiddenSelectedCount} not shown by current filters)` : ''}</span>
          {bulkDocBusy && <span className="text-[11px] text-white/50">Generating {bulkDocBusy.mode === 'print' ? 'print job' : 'PDF'} — {bulkDocBusy.done}/{bulkDocBusy.total}…</span>}
          <button onClick={bulkPrint} disabled={!!bulkDocBusy} className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/75 hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none flex items-center gap-1"><Printer size={11} /> Print</button>
          <button onClick={bulkPDF} disabled={!!bulkDocBusy} className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/75 hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none flex items-center gap-1"><FileDown size={11} /> PDF</button>
          <button onClick={() => runExport(() => bulkExport(false))} disabled={exporting} aria-busy={exporting} className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/75 hover:bg-white/10 disabled:opacity-50 disabled:cursor-wait flex items-center gap-1"><FileDown size={11} /> {exporting ? 'Exporting…' : 'Export'}</button>
          <button onClick={() => runExport(() => bulkExport(true))} disabled={exporting} aria-busy={exporting} className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/75 hover:bg-white/10 disabled:opacity-50 disabled:cursor-wait flex items-center gap-1"><FileDown size={11} /> GST Export</button>
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
              <tr className="text-[10px] uppercase tracking-wide text-white/45" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
                <th className="py-2.5 px-3 w-8"><input type="checkbox" checked={paged.length > 0 && paged.every((iv) => selected.has(iv.id))} onChange={(e) => { const n = new Set(selected); paged.forEach((iv) => e.target.checked ? n.add(iv.id) : n.delete(iv.id)); setSelected(n); }} className="accent-[#d4af37]" /></th>
                {[
                  ['Invoice', 'billing.col.invoice', 'Invoice'],
                  ['Date', 'billing.col.date', 'Date'],
                  ['Customer / Vehicle', 'billing.col.customerVehicle', 'Customer / Vehicle'],
                  ['Job Card', 'nav.jobcards', 'Job Card'],
                  ['Total', 'billing.col.total', 'Total'],
                  ['Paid', 'status.paid', 'Paid'],
                  ['Balance', 'billing.col.balance', 'Balance'],
                  ['GST', 'billing.col.gst', 'GST'],
                  ['Status', 'common.status', 'Status'],
                  ['Actions', 'common.actions', 'Actions'],
                ].map(([h, key, fallback]) => <th key={h} className="text-left font-semibold py-2.5 px-3 whitespace-nowrap">{t(key, fallback)}</th>)}
              </tr>
            </thead>
            <tbody>
              {paged.map((iv) => {
                const tot = totalsOf(iv);
                const st = deriveStatus(iv);
                const sc = statusColor(st);
                return (
                  <tr key={iv.id} className="transition hover:bg-white/[0.03]" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.05)' }}>
                    <td className="py-2.5 px-3"><input type="checkbox" checked={selected.has(iv.id)} onChange={() => toggleSel(iv.id)} className="accent-[#d4af37]" /></td>
                    <td className="py-2.5 px-3"><span className="text-[11px] font-bold" style={{ color: iv.isEstimate ? '#a78bfa' : '#d4af37' }}>{iv.invNo}</span></td>
                    <td className="py-2.5 px-3 text-white/60">{iv.date}</td>
                    <td className="py-2.5 px-3"><p className="text-white/85">{iv.customer}</p><p className="text-[10px] text-white/45">{iv.vehicle || iv.phone || '—'}</p></td>
                    <td className="py-2.5 px-3 text-white/55 text-[11px]">{iv.jobNo || '—'}</td>
                    <td className="py-2.5 px-3 text-white/85">{inr(tot.grand)}</td>
                    <td className="py-2.5 px-3 text-emerald-400/90">{inr(tot.paid)}</td>
                    <td className="py-2.5 px-3"><span style={{ color: tot.balance > 0 ? '#f87171' : '#34d399' }}>{inr(tot.balance)}</span></td>
                    <td className="py-2.5 px-3 text-white/55 text-[11px]">{inr(tot.gst)}</td>
                    <td className="py-2.5 px-3"><Badge status={t(`status.${st.toLowerCase().replace(/\s/g, '')}`, st)} color={sc} /></td>
                    <td className="py-2.5 px-3">
                      <div className="flex gap-1">
                        {canManage && <button onClick={() => setEdit(iv)} title={t('billing.action.editView', 'Edit / View')} className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/55 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]/60"><Eye size={12} /></button>}
                        {canManage && tot.balance > 0 && st !== 'Cancelled' && <button onClick={() => setPayFor(iv)} title={t('billing.action.collectPayment', 'Collect Payment')} className="w-7 h-7 rounded-lg flex items-center justify-center bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"><Wallet size={12} /></button>}
                        <button onClick={() => downloadPDF(iv, true)} title={t('common.print', 'Print')} className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/55 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]/60"><Printer size={12} /></button>
                        <button ref={rowMenuAnchorRef(iv.id)} onClick={(e) => { e.stopPropagation(); setRowMenuFor(rowMenuFor === iv.id ? null : iv.id); }} title={t('billing.action.moreActions', 'More actions')} aria-haspopup="menu" aria-expanded={rowMenuFor === iv.id} className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/55 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]/60"><MoreVertical size={13} /></button>
                        {rowMenuFor === iv.id && (
                          <ActionMenu anchorRef={rowMenuAnchorRef(iv.id)} open onClose={() => setRowMenuFor(null)} items={[
                            { type: 'section', label: t('common.documents', 'Documents') },
                            // The two PDF variants lead the menu — they're the most
                            // reached-for actions on a row, and pairing them directly
                            // above/below each other communicates the customer-vs-
                            // internal distinction on its own (see downloadPDF's own
                            // header comment for the shared-engine architecture).
                            { type: 'item', label: t('billing.action.customerCopy', 'Customer Copy'), icon: FileDown, onClick: () => downloadPDF(iv, false, 'customer') },
                            canManage && { type: 'item', label: t('billing.action.workshopCopy', 'Workshop Copy'), icon: FileDown, onClick: () => downloadPDF(iv, false, 'workshop') },
                            { type: 'section', label: t('billing.invoice', 'Invoice') },
                            canManage && { type: 'item', label: t('vehicles.action.duplicate', 'Duplicate'), icon: Copy, onClick: () => duplicateInvoice(iv) },
                            canManage && iv.isEstimate && { type: 'item', label: t('billing.action.convertToInvoice', 'Convert to Invoice'), icon: FileText, onClick: () => convertEstimate(iv) },
                            canManage && { type: 'section', label: t('billing.financial', 'Financial') },
                            canManage && (tot.balance > 0 && st !== 'Cancelled'
                              ? { type: 'item', label: t('billing.action.collectPayment', 'Collect Payment'), icon: Wallet, onClick: () => setPayFor(iv) }
                              : { type: 'item', label: t('billing.action.collectPayment', 'Collect Payment'), icon: Wallet, onClick: () => {}, disabled: true, reason: st === 'Cancelled' ? 'Invoice is cancelled' : 'No balance due' }),
                            canManage && (st === 'Paid'
                              ? { type: 'item', label: t('billing.action.refund', 'Refund'), icon: IndianRupee, onClick: () => changeStatus(iv, 'Refunded', 'Refunded') }
                              : { type: 'item', label: t('billing.action.refund', 'Refund'), icon: IndianRupee, onClick: () => {}, disabled: true, reason: 'Only a fully paid invoice can be refunded' }),
                            canManage && (st !== 'Returned' && st !== 'Cancelled'
                              ? { type: 'item', label: t('billing.action.returnRestoreStock', 'Return (restore stock)'), icon: Receipt, onClick: () => changeStatus(iv, 'Returned', 'Returned') }
                              : { type: 'item', label: t('billing.action.returnRestoreStock', 'Return (restore stock)'), icon: Receipt, onClick: () => {}, disabled: true, reason: st === 'Returned' ? 'Already returned' : 'Invoice is cancelled' }),
                            canManage && (st !== 'Cancelled' && st !== 'Paid'
                              ? { type: 'item', label: t('billing.action.cancelInvoice', 'Cancel Invoice'), icon: X, onClick: () => changeStatus(iv, 'Cancelled', 'Cancelled') }
                              : { type: 'item', label: t('billing.action.cancelInvoice', 'Cancel Invoice'), icon: X, onClick: () => {}, disabled: true, reason: st === 'Paid' ? 'A paid invoice cannot be cancelled — use Refund' : 'Already cancelled' }),
                            { type: 'section', label: t('billing.history', 'History') },
                            { type: 'item', label: t('billing.action.viewTimeline', 'View Timeline'), icon: Clock, onClick: () => setTimelineFor(iv) },
                            iv.phone && { type: 'section', label: t('billing.communication', 'Communication') },
                            iv.phone && { type: 'item', label: t('billing.action.sendOnWhatsApp', 'Send on WhatsApp'), icon: Send, onClick: () => window.open(`https://wa.me/91${(iv.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(`Invoice ${iv.invNo} — Total ${inr(tot.grand)}, Balance ${inr(tot.balance)}. Thank you for choosing Sri Baba Balaji Maruti Care.`)}`, '_blank') },
                          ]} />
                        )}
                        {canManage && <button onClick={async () => { if (demoMode && !demoCanDelete) { notify.permissionDenied('This action has been disabled by the administrator.'); return; } if (await confirmDialog({ title: `Delete ${iv.invNo}?`, message: 'This cannot be undone.', danger: true, confirmText: 'Delete' })) { try { await onDelete?.(iv); notify.deleted('Invoice deleted'); } catch (e) { /* deleteInvoice's own shared persistence layer already toasted the failure */ } } }} title={demoMode && !demoCanDelete ? t('billing.disabledByAdmin', 'Disabled by administrator') : t('common.delete', 'Delete')} className={`w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60 ${demoMode && !demoCanDelete ? 'text-white/45' : 'text-red-400/70 hover:bg-red-500/10'}`}><Trash2 size={12} /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={11} className="py-10 text-center text-white/45 text-xs">{t('billing.empty.noMatch', 'No invoices match.')} {canManage && t('billing.empty.clickToAdd', 'Click "New Invoice" to bill a customer.')}</td></tr>}
            </tbody>
          </table>
        </div>
        {/* Mobile: cards instead of a wide horizontal-scroll table */}
        <div className="md:hidden divide-y" style={{ borderColor: 'rgba(var(--fg-rgb),0.06)' }}>
          {paged.map((iv) => {
            const tot = totalsOf(iv); const st = deriveStatus(iv); const sc = statusColor(st);
            return (
              <div key={iv.id} className="p-3.5" onClick={() => canManage && setEdit(iv)}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold" style={{ color: iv.isEstimate ? '#a78bfa' : '#d4af37' }}>{iv.invNo}</span>
                      <Badge status={t(`status.${st.toLowerCase().replace(/\s/g, '')}`, st)} color={sc} size="sm" />
                    </div>
                    <p className="text-sm text-white/85 truncate mt-0.5">{iv.customer}</p>
                    <p className="text-[10px] text-white/45 truncate">{iv.vehicle || iv.phone || '—'} · {iv.date}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-white/90">{inr(tot.grand)}</p>
                    {tot.balance > 0 ? <p className="text-[10px] text-red-400">{t('common.due', 'Due')} {inr(tot.balance)}</p> : <p className="text-[10px] text-emerald-400">{t('status.paid', 'Paid')}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mt-2.5" onClick={(e) => e.stopPropagation()}>
                  {canManage && <button onClick={() => setEdit(iv)} className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold bg-white/5 border border-white/10 text-white/70 flex items-center justify-center gap-1"><Eye size={12} /> {t('common.view', 'View')}</button>}
                  {canManage && tot.balance > 0 && st !== 'Cancelled' && <button onClick={() => setPayFor(iv)} className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 flex items-center justify-center gap-1"><Wallet size={12} /> {t('billing.action.collect', 'Collect')}</button>}
                  <button onClick={() => downloadPDF(iv, false)} title={t('common.pdf', 'PDF')} className="w-8 py-1.5 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60"><FileDown size={12} /></button>
                  {iv.phone && <button onClick={() => window.open(`https://wa.me/91${(iv.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(`Invoice ${iv.invNo} — Total ${inr(tot.grand)}, Balance ${inr(tot.balance)}.`)}`, '_blank')} title="WhatsApp" className="w-8 py-1.5 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-emerald-400/70"><Send size={12} /></button>}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="py-10 text-center text-white/45 text-xs">{t('billing.empty.noMatch', 'No invoices match.')} {canManage && t('billing.empty.tapToAdd', 'Tap "New Invoice" to bill a customer.')}</div>}
        </div>
        <div className="flex items-center justify-between px-4 py-3 gap-2 flex-wrap" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.06)' }}>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-white/45">{t('dynamic.showingRange', `Showing ${filtered.length ? (safePage - 1) * PER + 1 : 0}–${Math.min(safePage * PER, filtered.length)} of ${filtered.length}`, { from: filtered.length ? (safePage - 1) * PER + 1 : 0, to: Math.min(safePage * PER, filtered.length), total: filtered.length, entity: '' })}</span>
            <select value={PER} onChange={(e) => setPER(Number(e.target.value))} className="h-7 px-1.5 rounded-lg text-[11px] bg-white/5 border border-white/10 text-white/70 outline-none">{[10, 25, 50, 100].map((n) => <option key={n} value={n} style={{ background: '#141414' }}>{n} {t('common.perPage', '/ page')}</option>)}</select>
          </div>
          <div className="flex items-center gap-2">
            <button disabled={safePage <= 1} onClick={() => setPage((p) => Math.min(p, pageCount) - 1)} className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 disabled:opacity-30"><ChevronDown size={14} className="rotate-90" /></button>
            <span className="text-xs text-white/60">{safePage} / {pageCount}</span>
            <button disabled={safePage >= pageCount} onClick={() => setPage((p) => Math.min(p, pageCount) + 1)} className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 disabled:opacity-30"><ChevronDown size={14} className="-rotate-90" /></button>
          </div>
        </div>
      </div>

      {payFor && <PaymentModal key={`pay:${payFor.id}`} invoice={payFor} onCollect={collectPayment} onClose={() => setPayFor(null)} />}
      {timelineFor && (
        <div className="fixed inset-0 z-[130] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(3px)' }} onClick={() => setTimelineFor(null)}>
          <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
              <h3 className="text-base font-bold text-white">{timelineFor.invNo} · Timeline</h3>
              <button onClick={() => setTimelineFor(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10"><X size={17} /></button>
            </div>
            <div className="p-5 max-h-[60vh] overflow-y-auto dark-scroll">
              {(timelineFor.history || []).length === 0 ? <p className="text-sm text-white/45 text-center py-6">No history recorded yet.</p> : (
                <div className="space-y-3">
                  {[...(timelineFor.history || [])].reverse().map((h, i) => (
                    <div key={i} className="flex gap-3">
                      <div className="flex flex-col items-center"><span className="w-2.5 h-2.5 rounded-full bg-[#d4af37] mt-1" />{i < (timelineFor.history.length - 1) && <span className="w-px flex-1 bg-white/10 my-1" />}</div>
                      <div className="pb-1"><p className="text-sm text-white/85">{h.action}</p><p className="text-[10px] text-white/45">{new Date(h.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}{h.by ? ` · ${h.by}` : ''}</p></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* C-1 fix: onSave used to fire the success toast and close the modal the instant it
          was called, regardless of whether onPersist (the Firestore write) actually
          succeeded — a rejected write looked identical to a successful one. It now awaits
          the real outcome and only closes/toasts on confirmed success; on failure the modal
          stays open (so nothing typed is lost) and the shared persistence layer's own toast
          already told the user what happened. */}
      {edit && <InvoiceModal key={`inv:${edit.id || 'new'}:${revOf(edit)}`} initial={edit} readOnly={invoiceViewOnly} banner={isPersistedEdit ? invoiceBanner : null} invoices={invoices} customers={customers} inventory={inventory} jobCards={jobCards} demoMode={demoMode} demoCanEditPricing={demoCanEditPricing} onQuickCustomer={onQuickCustomer} onQuickVehicle={onQuickVehicle} onDownloadPDF={downloadPDF} onDuplicate={(iv) => { setEdit(null); setTimeout(() => duplicateInvoice(iv), 60); }} onCreditNote={(iv) => { setEdit(null); setTimeout(() => changeStatus(iv, 'Returned', 'Returned'), 60); }} onSave={async (iv, thenPay) => { let saved; try { saved = await onPersist?.(iv); } catch (e) { return; } const finalIv = saved || iv; invoiceLease.release(); setEdit(null); toast.success(`${finalIv.isEstimate ? 'Estimate' : 'Invoice'} ${finalIv.invNo} saved`); if (thenPay) setTimeout(() => setPayFor(finalIv), 120); }} onClose={closeInvoiceEditor} />}
      {invoiceReviewOpen && isPersistedEdit && invoiceSync.latest && (
        <ConflictReviewDialog
          mode="review"
          title="This invoice was changed by another user"
          fields={INVOICE_CONFLICT_FIELDS}
          opened={edit}
          latest={invoiceSync.latest}
          onUseLatest={(latest) => { setInvoiceReviewOpen(false); invoiceSync.markSynced(revOf(latest)); setEdit({ ...latest }); }}
          onClose={() => setInvoiceReviewOpen(false)}
        />
      )}
    </PageHeader>
  );
}

export { totalsOf };
