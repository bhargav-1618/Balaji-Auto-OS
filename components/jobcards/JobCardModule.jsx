// components/jobcards/JobCardModule.jsx — v2 (production fixes)
// ROOT-CAUSE FIX: every subcomponent is hoisted to MODULE scope. Previously
// `Field` was declared inside the component, so each keystroke re-render
// recreated it and React remounted the input → focus lost after 1 character.
// Also: searchable Indian vehicle picker (+Add New Vehicle), engine/VIN live
// validation, date-time shortcuts with delivery>=intake, full warning-light
// grid + Other, inventory-driven checklist, body-part damage picker, enforced
// status workflow with timestamps, reference-matching 2-page PDF (+watermark,
// page numbers, demo masking), autosave 5s, Ctrl+S, unsaved-changes warning,
// drag&drop + camera photo capture.
import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import toast from '../../lib/toast';
import { appScrollTo } from '../../lib/appScroll';
import { confirmDialog } from '../common/ConfirmDialog';
import { buildQrPayload, makeQrDataUrl, QR_PT } from '../../lib/pdfQr';
import { PDF_PAGE, PDF_GOLD, SHOP, maskShop, liveShop, drawPdfHeader, drawPdfPageNumber, drawSectionTitle, drawSignatureBlock, drawChipList, drawPhotoGrid, PDF_SPACING } from '../../lib/pdfTheme';
import {
  ClipboardList, FileDown, Check, X, Plus, Search, ChevronDown, Camera,
  Trash2, Maximize2, Minimize2, CalendarClock, AlertTriangle, Eye, Edit3, Copy, Printer,
  User, Car, IndianRupee, MoreVertical, Undo2,
} from 'lucide-react';
import DropdownPanel from '../common/DropdownPanel';
import ActionMenu from '../common/ActionMenu';
import PageHeader from '../common/PageHeader';
import { useTranslation } from '../../lib/i18n';
import MiniSelect from '../common/MiniSelect';
import VehicleMakeModelSelect from '../common/VehicleMakeModelSelect';
import DateTimeField, { toLocalInput } from '../common/DateTimeField';
import CapacityBanner from '../common/CapacityBanner';
import CapacityCleanupModal from '../common/CapacityCleanupModal';
import { checkCapacityGuard } from '../../lib/useCapacity';
import { useEditLease } from '../../hooks/useEditLease';
import { useRecordSync } from '../../hooks/useRecordSync';
import { useLeaseReleaseToast } from '../../hooks/useLeaseReleaseToast';
import { revOf } from '../../lib/concurrency';
import EditLeaseBanner from '../common/EditLeaseBanner';
import EditAvailableBar from '../common/EditAvailableBar';
import RecordUpdatedNotice from '../common/RecordUpdatedNotice';
import RecordConflictBanner from '../common/RecordConflictBanner';
import ConflictReviewDialog from '../common/ConflictReviewDialog';
import { invoiceStatus } from '../../services/billingService';
import { TERMINAL_INVOICE_STATUSES } from '../../constants/capacity';
import { lockBody, unlockBody } from '../Modal';
import { useDeferredSearch, useSearchIndex, matchIndexed, rankIndexed, normId } from '../../lib/useSearch';
import { resolveSelectedRecords, countHiddenSelections } from '../../lib/selectionScope';
import { statusColor, SEMANTIC, JOB_CARD_STATUSES, JOB_CARD_DRAFT_STATUS } from '../../constants/ui';
import Badge from '../common/Badge';
import { VEHICLES, FUELS } from '../../lib/vehicleCatalog';
import notify from '../common/notify';
import { num, isIndianMobile, MOBILE_ERROR } from '../../lib/format';
import { nextJobCardNumber } from '../../services/jobCardService';

/* ================= constants ================= */
// SHOP/MASK moved to lib/pdfTheme.js — GLOBAL PDF FRAMEWORK: this was retyped by hand
// here and in BillingModule.jsx with drifted tagline/address text between the two;
// one canonical source now, imported above.
const MASK = 'XXXXXXXX';

// 'Draft' deliberately sits OUTSIDE this list. STATUSES is the linear repair workflow
// and the code enforces "you can't skip a stage" against its indexes — putting Draft
// in it would make Draft a stage you must pass through. A draft is a not-yet-started
// job card: it has no place in the workflow until it is properly opened as 'Received'.
// Both now live in constants/ui.js (JOB_CARD_STATUSES / JOB_CARD_DRAFT_STATUS) so the
// demo seed generator (lib/demoGarageSeed.js) shares the exact same workflow vocabulary
// instead of maintaining its own copy that can silently drift — see that constant's own
// comment for the concrete bug this caused.
const DRAFT_STATUS = JOB_CARD_DRAFT_STATUS;
const STATUSES = JOB_CARD_STATUSES;
// STATUS_COLOR moved to constants/ui.js — same hexes, one map.

// Single source of truth for "does this job card belong to KPI bucket X" — used by
// BOTH the KPI tile counts (kpis useMemo) and the table filter a KPI-tile click
// applies (kpiPass, inside savedList). Before this, the two were hand-duplicated
// copies of the same predicates; a tile's number and what clicking it actually
// filtered to could silently drift apart the moment one copy was edited without the
// other — exactly the Table-data-vs-KPI-data drift this needs to rule out structurally,
// not by discipline. A draft ("Save Draft") explicitly hasn't entered the workshop
// queue yet (see its own button tooltip), so it never counts toward any bucket here —
// it still appears in the saved-list table and in "All Statuses", just not as active
// workshop load.
const KPI_BUCKET_KEYS = ['Open', 'Inspection', 'Waiting Parts', 'Repair', 'Ready', 'DeliveredToday', 'Cancelled'];
function jobMatchesKpiBucket(jc, bucket, todayMs) {
  if (jc.isDraft) return false;
  const s = jc.status;
  if (bucket === 'Open') return s !== 'Closed' && s !== 'Cancelled' && s !== 'Delivered';
  if (bucket === 'Repair') return s === 'Repair Started' || s === 'Repair Paused';
  if (bucket === 'DeliveredToday') {
    if (s !== 'Delivered') return false;
    const dl = (jc.statusLog || []).filter((l) => l.status === 'Delivered').pop();
    return !!(dl && dl.at >= todayMs);
  }
  return s === bucket; // Inspection / Waiting Parts / Ready / Cancelled — bucket name IS the status
}

const WARNINGS = [
  'Check Engine', 'ABS', 'Battery', 'Oil Pressure', 'Brake', 'Parking Brake', 'Seat Belt', 'Airbag',
  'EPS', 'Traction Control', 'ESC', 'TPMS', 'Low Fuel', 'Coolant Temp', 'Glow Plug', 'DPF',
  'AdBlue', 'Transmission', 'Power Steering', 'Engine Service', 'Hill Assist', 'Lane Assist',
  'Blind Spot', 'Adaptive Cruise', 'Collision Warning', 'Parking Sensors', 'Camera Failure',
  'Auto Hold', 'Start/Stop', 'Suspension', '4WD', 'Immobilizer', 'High Beam', 'Fog Lamp',
];

const BODY_PARTS = [
  'Bonnet', 'Roof', 'Front Bumper', 'Rear Bumper', 'Front Left Fender', 'Front Right Fender',
  'Rear Left Fender', 'Rear Right Fender', 'Front Left Door', 'Front Right Door', 'Rear Left Door',
  'Rear Right Door', 'Boot', 'Tailgate', 'Left Mirror', 'Right Mirror', 'Front Windshield',
  'Rear Windshield', 'Headlights', 'Tail Lamps', 'Grille', 'Quarter Panel', 'Tyres', 'Wheels', 'Running Board',
];

const INSPECTION = {
  'Under the Hood': ['Engine Oil Level & Quality', 'Coolant Level & Radiator Hoses', 'Brake Fluid & Power Steering Fluid', 'Battery Load Test & Terminals', 'Air Filter & Spark Plugs Condition', 'Drive Belts & Pulleys'],
  'Brakes & Tires': ['Front Brake Pads & Discs Wear', 'Rear Brake Shoes & Drums / Pads', 'Parking Brake Adjustment', 'Tire Tread Depth (Uneven Wear Check)', 'Tire Pressures Calibrated', 'Wheel Alignment / Balancing Required?'],
  'Underbody & Suspension': ['Drive Shaft Boots (Axle Boots)', 'Steering Rack & Tie Rod Ends', 'Control Arm Bushings & Mounts', 'Shock Absorbers & Struts (Leaks)', 'Exhaust System / Silencer Integrity', 'Engine & Gearbox Oil Leaks'],
  'Interior, Electrical & AC': ['AC Gas Pressure & Cooling Output', 'Cabin / AC Filter Condition', 'All Exterior Bulbs & Headlight Throw', 'Power Windows & ORVM Mirrors', 'Horn, Wipers & Washer Fluid', 'Dashboard Controls & Display'],
};
const ALL_INSPECTION = Object.values(INSPECTION).flat();
// Named inspection templates — each lists the checklist items relevant to that
// service type. "Major Service" = the full premium sheet; others are subsets or
// specialised lists. Admins/advisors pick a template to scope the checklist.
const INSPECTION_TEMPLATES = {
  'Major Service': ALL_INSPECTION,
  'Small Service': ['Engine Oil Level & Quality', 'Coolant Level & Radiator Hoses', 'Air Filter & Spark Plugs Condition', 'Battery Load Test & Terminals', 'Front Brake Pads & Discs Wear', 'Tire Tread Depth (Uneven Wear Check)', 'Tire Pressures Calibrated', 'AC Gas Pressure & Cooling Output', 'Horn, Wipers & Washer Fluid'],
  Insurance: ['Front Brake Pads & Discs Wear', 'Rear Brake Shoes & Drums / Pads', 'All Exterior Bulbs & Headlight Throw', 'Tire Tread Depth (Uneven Wear Check)', 'Exhaust System / Silencer Integrity', 'Steering Rack & Tie Rod Ends', 'Shock Absorbers & Struts (Leaks)', 'Dashboard Controls & Display'],
  Accident: ['Steering Rack & Tie Rod Ends', 'Control Arm Bushings & Mounts', 'Shock Absorbers & Struts (Leaks)', 'Drive Shaft Boots (Axle Boots)', 'Wheel Alignment / Balancing Required?', 'All Exterior Bulbs & Headlight Throw', 'Engine & Gearbox Oil Leaks', 'Exhaust System / Silencer Integrity'],
  'General Inspection': ALL_INSPECTION,
  'EV Inspection': ['Battery Load Test & Terminals', 'Front Brake Pads & Discs Wear', 'Rear Brake Shoes & Drums / Pads', 'Tire Tread Depth (Uneven Wear Check)', 'Tire Pressures Calibrated', 'AC Gas Pressure & Cooling Output', 'All Exterior Bulbs & Headlight Throw', 'Dashboard Controls & Display', 'Steering Rack & Tie Rod Ends'],
};
const INSPECTION_TEMPLATE_NAMES = Object.keys(INSPECTION_TEMPLATES);


const fmtDT = (v) => { if (!v) return '—'; try { const d = new Date(v); return d.toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return v; } };
const fmtDate = (v) => { if (!v) return '—'; try { return new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }); } catch { return v; } };
const engOk = (v) =>{ const s = String(v || '').trim(); if (!s) return null; if (!/^[A-Za-z0-9-]+$/.test(s)) return 'Only letters, numbers and “-” allowed'; if (s.length < 5) return 'Engine no. must be at least 5 characters'; if (s.length > 25) return 'Engine no. must be at most 25 characters'; return null; };
const vinOk = (v) => { const s = String(v || '').trim(); if (!s) return null; if (!/^[A-HJ-NPR-Za-hj-npr-z0-9]+$/.test(s)) return 'Invalid character (I, O, Q and symbols not allowed)'; if (s.length < 11) return 'VIN must be at least 11 characters'; if (s.length > 17) return 'VIN must be at most 17 characters'; return null; };

/* ================= HOISTED subcomponents (the focus-bug fix) ================= */
const inputCls = 'w-full px-3 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 text-white placeholder-white/25 outline-none focus:border-[#d4af37]/60 transition';
const cardStyle = { background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' };

// `sub` is an optional slot BETWEEN the label and the input — e.g. Job Card No.'s
// Auto/Manual mode toggle. A field that renders one but sits next to a field that
// doesn't (same grid row) gets its input pushed down relative to its neighbor's,
// since CSS Grid stretches each cell's OUTER box to the row height but leaves the
// INNER content top-anchored. Rather than a magic-number margin/offset on the
// shorter neighbor (fragile — breaks the instant the toggle's own markup changes),
// the shorter neighbor renders an `invisible` clone of the SAME sub content, so its
// reserved height is whatever the browser actually computes for that markup, not a
// guessed pixel value. See Section 1 (Job Card No. / Service Advisor) for the only
// place in this form that currently needs it.
function Field({ label, req, error, errorId, sub, children }) {
  return (
    <div className="min-w-0">
      <label className="block text-[10px] uppercase tracking-wide text-white/45 mb-1.5">{label}{req && <span className="text-red-400"> *</span>}</label>
      {sub && <div className="mb-1.5">{sub}</div>}
      {children}
      {error && <p id={errorId} role="alert" className="text-[10px] text-red-400 mt-1">{error}</p>}
    </div>
  );
}
function Section({ n, title, children, right }) {
  return (
    <div className="rounded-2xl p-4" style={cardStyle}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold text-white/85 uppercase tracking-wide flex items-center gap-2">
          <span className="w-1 h-4 rounded-full inline-block" style={{ background: '#d4af37' }} />{n}. {title}
        </h3>
        {right}
      </div>
      {children}
    </div>
  );
}
function ChipToggle({ on, label, onClick }) {
  return (
    <button type="button" onClick={onClick} className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition active:scale-95 ${on ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]' : 'text-white/55 bg-white/5 border border-white/10 hover:bg-white/10'}`}>{label}</button>
  );
}


function CustomInspItem({ onAdd }) {
  const [v, setV] = useState('');
  const add = () => { const t = v.trim(); if (t) { onAdd(t); setV(''); } };
  return (
    <div className="flex items-center gap-1.5 pt-1">
      <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder="Add custom finding…" className="flex-1 px-2 py-1 rounded-md text-[11px] bg-white/5 border border-white/10 text-white placeholder-white/25 outline-none focus:border-[#d4af37]/40" />
      <button type="button" onClick={add} className="w-6 h-6 rounded-md flex items-center justify-center text-[#d4af37] bg-white/5 border border-white/10 hover:bg-white/10 flex-shrink-0"><Plus size={12} /></button>
    </div>
  );
}

function CascadeVehicleSelect({ make, model, onChange, customVehicles, onAddVehicle }) {
  // merge base VEHICLES with any custom-added makes/models
  const catalog = useMemo(() => {
    const c = JSON.parse(JSON.stringify(VEHICLES));
    (customVehicles || []).forEach((v) => { if (!c[v.make]) c[v.make] = []; if (v.model && !c[v.make].includes(v.model)) c[v.make].push(v.model); });
    return c;
  }, [customVehicles]);
  const makes = useMemo(() => Object.keys(catalog).sort(), [catalog]);
  return (
    <VehicleMakeModelSelect
      make={make}
      model={model}
      makeOptions={makes}
      modelsFor={(m) => catalog[m] || []}
      onPickMake={(m) => onChange({ make: m, model: '', vehicle: '' })}
      onPickModel={(m) => onChange({ make, model: m, vehicle: `${make} ${m}` })}
      onAddMake={(name) => onAddVehicle({ make: name, model: '' })}
      onAddModel={(name) => onAddVehicle({ make, model: name })}
    />
  );
}

function CustomerSearch({ customers, onFill }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  // Same fix as MiniSelect above: the results panel is portalled into <body> via
  // <DropdownPanel>, which already owns outside-click/Escape closing correctly.
  // The local `mousedown` + ref.contains() check this used to run treated every
  // click on a result row as "outside" and closed before onClick could fire — so
  // clicking a customer appeared to close the dropdown without ever applying it.
  // GLOBAL SEARCH ACCURACY: Customer ID, Registration No., VIN and Engine No. match by
  // EXACT value only — a complete registration like "SBBMC40" can never also surface
  // "SBBMC400"/"SBBMC401" just because they share that prefix. Name/phone/model stay
  // partial-searchable, unchanged. See lib/useSearch.js `useSearchIndex`/`matchIndexed`.
  const searchIndex = useSearchIndex(
    customers,
    (c) => c.id,
    (c) => [c.name, c.phone, c.altPhone, ...(c.vehicles || []).flatMap((v) => [v.model])],
    (c) => [c.code, ...(c.vehicles || []).flatMap((v) => [v.regNo, v.vin, v.engineNo])],
  );
  const shown = useMemo(() => {
    const l = q.trim();
    // Strict Search Validation review: a genuine single-character match must be
    // returned, not withheld by an arbitrary 2-character minimum — only a genuinely
    // EMPTY query shows nothing.
    if (!l) return [];
    // was .slice(0,8) — a silent cap that hid real matches
    return customers.filter((c) => matchIndexed(searchIndex.get(c.id), l));
  }, [q, customers, searchIndex]);
  if (!customers.length) return null;
  return (
    <div className="relative mb-3" ref={ref}>
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/45" />
      <input value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} placeholder="Search existing customer by name, phone, vehicle no., VIN…" className={`${inputCls} pl-9`} />
      {open && shown.length > 0 && (
        <DropdownPanel anchorRef={ref} open onClose={() => { setOpen(false); setQ(''); }}
          style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }}>
          {shown.map((c) => {
            const v = (c.vehicles || [])[0] || {};
            return (
              <button key={c.id} type="button" onClick={() => { onFill(c); setOpen(false); setQ(''); }} className="w-full text-left px-3 py-2 hover:bg-white/5">
                <p className="text-sm text-white/85">{c.name} <span className="text-white/45 text-[11px]">· {c.phone}</span></p>
                <p className="text-[10px] text-white/45">{c.code}{v.regNo ? ` · ${v.regNo} ${v.model || ''}` : ''}</p>
              </button>
            );
          })}
        </DropdownPanel>
      )}
    </div>
  );
}

function VehicleSelect({ value, onChange, customVehicles, onAddVehicle }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [adding, setAdding] = useState(false);
  const [nv, setNv] = useState({ make: '', model: '', variant: '', fuel: 'Petrol', transmission: 'Manual', body: 'Hatchback', year: String(new Date().getFullYear()) });
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const options = useMemo(() => {
    const out = [];
    Object.entries(VEHICLES).forEach(([make, models]) => models.forEach((m) => out.push(`${make} ${m}`)));
    (customVehicles || []).forEach((v) => out.push(`${v.make} ${v.model}${v.variant ? ' ' + v.variant : ''}`));
    return Array.from(new Set(out));
  }, [customVehicles]);
  const shown = useMemo(() => {
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return options;   // no cap: the panel scrolls
    return options.filter((o) => { const l = o.toLowerCase(); return tokens.every((t) => l.includes(t)); });   // no cap: the panel scrolls
  }, [q, options]);
  useEffect(() => { setHi(0); }, [q, open]);
  const pick = (v) => { onChange(v); setOpen(false); setQ(''); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[hi]) pick(shown[hi]); }
    else if (e.key === 'Escape') setOpen(false);
  };
  const saveNew = () => {
    if (!nv.make.trim() || !nv.model.trim()) { toast.error('Manufacturer and model are required'); return; }
    onAddVehicle(nv);
    pick(`${nv.make.trim()} ${nv.model.trim()}${nv.variant.trim() ? ' ' + nv.variant.trim() : ''}`);
    setAdding(false);
    setNv({ make: '', model: '', variant: '', fuel: 'Petrol', transmission: 'Manual', body: 'Hatchback', year: String(new Date().getFullYear()) });
    toast.success('Vehicle added');
  };
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className={`${inputCls} flex items-center justify-between text-left`}>
        <span className={value ? 'text-white' : 'text-white/45'}>{value || 'Search make & model…'}</span>
        <ChevronDown size={14} className="text-white/45 flex-shrink-0" />
      </button>
      {open && (
        <DropdownPanel anchorRef={ref} open onClose={() => { setOpen(false); setQ(''); }} scroll={false}
          style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {!adding ? (
            <>
              <div className="relative p-2" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.07)', flex: '0 0 auto' }}>
                <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/45" />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Type manufacturer, model, variant…" className="w-full pl-8 pr-2 py-2 rounded-lg text-sm bg-white/5 border border-white/10 text-white placeholder-white/25 outline-none" />
              </div>
              <div className="overflow-y-auto dark-scroll" style={{ flex: '1 1 auto' }}>
                {shown.map((o, i) => (
                  <button key={o} type="button" onClick={() => pick(o)} onMouseEnter={() => setHi(i)} className={`w-full text-left px-3 py-2 text-sm transition ${i === hi ? 'bg-[#d4af37]/15 text-white' : 'text-white/75 hover:bg-white/5'}`}>{o}</button>
                ))}
                {shown.length === 0 && <p className="px-3 py-3 text-xs text-white/45">No matches.</p>}
              </div>
              <button type="button" onClick={() => setAdding(true)} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-bold text-[#d4af37] hover:bg-white/5" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.07)' }}><Plus size={13} /> Add New Vehicle</button>
            </>
          ) : (
            <div className="p-3 space-y-2">
              <p className="text-xs font-bold text-white/85">Add New Vehicle</p>
              <div className="grid grid-cols-2 gap-2">
                <input value={nv.make} onChange={(e) => setNv((s) => ({ ...s, make: e.target.value }))} placeholder="Manufacturer *" className={inputCls} />
                <input value={nv.model} onChange={(e) => setNv((s) => ({ ...s, model: e.target.value }))} placeholder="Model *" className={inputCls} />
                <input value={nv.variant} onChange={(e) => setNv((s) => ({ ...s, variant: e.target.value }))} placeholder="Variant" className={inputCls} />
                <input value={nv.year} onChange={(e) => setNv((s) => ({ ...s, year: e.target.value.replace(/\D/g, '').slice(0, 4) }))} placeholder="Year" className={inputCls} />
                {/* Universal dropdown architecture review — native <select> is a
                    browser-owned popup, immune to this app's theming/containment. Same
                    fields, same fix as VehiclesModule's Add Vehicle wizard. */}
                <MiniSelect value={nv.fuel} placeholder="Fuel" options={['Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid']} emptyValue="Petrol" onPick={(v) => setNv((s) => ({ ...s, fuel: v || 'Petrol' }))} inputCls={inputCls} />
                <MiniSelect value={nv.transmission} placeholder="Transmission" options={['Manual', 'AMT', 'Automatic', 'CVT', 'DCT']} emptyValue="Manual" onPick={(v) => setNv((s) => ({ ...s, transmission: v || 'Manual' }))} inputCls={inputCls} />
                <div className="col-span-2"><MiniSelect value={nv.body} placeholder="Body Type" options={['Hatchback', 'Sedan', 'SUV', 'MUV', 'Pickup', 'Van', 'Coupe', 'Convertible']} emptyValue="Hatchback" onPick={(v) => setNv((s) => ({ ...s, body: v || 'Hatchback' }))} inputCls={inputCls} /></div>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setAdding(false)} className="flex-1 py-2 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-white/70">Cancel</button>
                <button type="button" onClick={saveNew} className="flex-1 py-2 rounded-lg text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">Save Vehicle</button>
              </div>
            </div>
          )}
        </DropdownPanel>
      )}
    </div>
  );
}

/* ================= main module ================= */
const DRAFT_KEY = 'maruti_jobcard_draft_v2';
const CUSTOM_VEH_KEY = 'maruti_custom_vehicles';
// Settings -> Job Cards -> Workflow Defaults saved correctly (biz.jcPrefix/
// jcStatus/jcTemplate/jcDelivery) but only jcPrefix had any effect on a new job
// card — Default Status, Inspection Template, and Estimated Delivery were all
// ignored, always falling back to a hardcoded 'Received'/'Major Service'/blank
// regardless of what was saved. Same direct-localStorage-read pattern already
// used for the PDF logo lookup below (jcLogoDataUrl), not a new settings
// pipeline — one read returns every Workflow Default a fresh card needs.
const JC_TEMPLATES = ['Major Service', 'Small Service', 'General Inspection', 'EV Inspection'];
const readJcDefaults = (demoMode) => {
  try {
    const biz = JSON.parse(localStorage.getItem(demoMode ? 'maruti_settings_demo' : 'maruti_settings') || '{}');
    const deliveryHours = Number(biz.jcDelivery);
    return {
      prefix: biz.jcPrefix || 'SBBMC',
      status: biz.jcStatus === 'Inspection' ? 'Inspection' : 'Received',
      template: JC_TEMPLATES.includes(biz.jcTemplate) ? biz.jcTemplate : 'Major Service',
      deliveryHours: Number.isFinite(deliveryHours) && deliveryHours > 0 ? deliveryHours : null,
    };
  } catch { return { prefix: 'SBBMC', status: 'Received', template: 'Major Service', deliveryHours: null }; }
};
// PHASE 10 (PH10-01) — nextJobCardNumber only sees CURRENTLY EXISTING job
// cards. jobNo doubles as the Firestore document id (persistJobCard saves
// with idField: 'jobNo'), so deleting the highest-numbered job card frees
// its number for reuse — but an invoice created from that job card keeps
// `jobNo` forever as its own denormalized link field (Invoice -> Job Card
// is a jobNo string match, not a doc-id reference; see BillingModule's
// `jobCards.find((j) => j.jobNo === iv.jobNo)`). Reusing the number would
// make that OLD, unrelated invoice's "View Job Card" suddenly resolve to
// a brand-new, unconnected job card (wrong customer/vehicle/complaint on
// display) — the exact failure mode the delete-confirmation dialog's own
// wording ("no longer able to open its source job card") promises does NOT
// happen. Folding `invoices` into the same max-scan (their `jobNo` field
// has the identical shape) means a number is never handed out again once
// any invoice still refers to it, deleted job card or not.
const emptyCard = (saved = [], jc = {}, invoices = []) => {
  const { prefix = 'SBBMC', status = 'Received', template = 'Major Service', deliveryHours = null } = jc;
  const dateIn = new Date();
  return {
    jobNo: nextJobCardNumber([...saved, ...invoices], prefix), jobNoMode: 'auto', dateIn: toLocalInput(dateIn),
    // Promised Delivery stays required/user-set either way (min={card.dateIn}, no
    // silent auto-submit) — this only saves the advisor re-picking it from the
    // same "Today/Tomorrow/+2/+7" shortcuts every single card when the workshop
    // already has one standard turnaround time.
    promised: deliveryHours ? toLocalInput(new Date(dateIn.getTime() + deliveryHours * 3600000)) : '',
    advisor: '', technician: '', helper: '', labour: [],
    customer: '', phone: '', altPhone: '', address: '',
    vehicle: '', make: '', model: '', regNo: '', vin: '', fuel: 'Petrol', engineNo: '',
    complaints: ['', '', '', ''], diagnosis: ['', '', '', ''],
    warnings: [], warningsOther: '', invItems: [], invOther: '', parts: [],
    damages: [], damageOther: '',
    inspection: {}, inspectionCustom: {}, inspectionTemplate: template, photosBefore: [], photosAfter: [], notes: '', customerNote: '', technicianNote: '', billingNote: '',
    status, statusLog: [{ status, at: Date.now() }],
  };
};

// CONCURRENCY PHASE 1c — job-card fields whose "another user changed this" diff is
// worth showing in the review (record-vs-record; mode="review", no auto field merge).
const JOBCARD_CONFLICT_FIELDS = [
  { key: 'customer', label: 'Customer' },
  { key: 'phone', label: 'Phone' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'regNo', label: 'Reg. number' },
  { key: 'advisor', label: 'Advisor' },
  { key: 'technician', label: 'Technician' },
  { key: 'status', label: 'Status' },
  { key: 'promised', label: 'Promised delivery' },
  { key: 'complaints', label: 'Complaints', format: (v) => `${(v || []).filter(Boolean).length} entered` },
  { key: 'diagnosis', label: 'Diagnosis', format: (v) => `${(v || []).filter(Boolean).length} entered` },
  { key: 'parts', label: 'Parts', format: (v) => `${(v || []).length} line${(v || []).length === 1 ? '' : 's'}` },
  { key: 'notes', label: 'Notes' },
];

// Module-scoped view state — a plain JS-module-level object, NOT sessionStorage-backed
// (Navigation State + Data Freshness review — this used to mirror into sessionStorage
// specifically so a Browser Refresh restored the old saved-list search/filter, which is the
// bug that review flagged, not a feature). Survives a tab-switch unmount (the module stays
// loaded, so this object keeps its values while the user is elsewhere), but resets on a
// real reload, since the JS module re-evaluates from scratch then — never touches
// DRAFT_KEY (the in-progress job card autosave), which is separate, protected business data.
const defaultJCView = () => ({ q: '', statusF: 'All' });
const jcViewState = defaultJCView();

export default function JobCardModule({ demoMode = false, demoCanDelete = false, canManage = true, isAdmin = false, inventory = [], customers = [], invoices = [], onPersist, onDelete, onRegisterVehicle, savedCards = [], onOpenCustomer, onOpenVehicle, onCreateInvoice, onOpenInvoice, initialKpiFilter, onInitialKpiFilterHandled, actorEmail, onCapacityCleanup, onDirtyChange }) {
  const { t } = useTranslation();
  const savedRef = useRef(savedCards);
  savedRef.current = savedCards;

  // CAPACITY GUARD — which closed/delivered/cancelled job-card numbers are still
  // referenced by a NOT-YET-settled invoice (Draft/Estimate/Unpaid/Partially Paid).
  // Deleting/archiving one of those would orphan that invoice's job-card link, so the
  // cleanup preview protects them even though their own status looks "finished". Built
  // from the `invoices` prop this component already receives — no extra fetch.
  const activeInvoiceJobNos = useMemo(() => {
    const set = new Set();
    (invoices || []).forEach((iv) => {
      if (iv.jobNo && !TERMINAL_INVOICE_STATUSES.includes(invoiceStatus(iv))) set.add(iv.jobNo);
    });
    return set;
  }, [invoices]);
  const [capacityBlockedOpen, setCapacityBlockedOpen] = useState(false);
  // Bumped by the cleanup wizard's onComplete to refresh the banner's count — NOT used
  // to close the modal (see the wizard's own onClose/"Done" for that; closing here
  // would unmount the modal before its own success/result screen was ever shown).
  const [capacityRefreshTick, setCapacityRefreshTick] = useState(0);

  const lastCardRef = useRef(null);
  // Was: [...(savedCards || [])].sort((a,b) => b.savedAt - a.savedAt)[0]
  // — a full array COPY and an O(n log n) SORT, on EVERY render, to find one maximum.
  // A max is a single O(n) pass with no allocation. This ran on every keystroke in the
  // module, every filter change, every state update.
  lastCardRef.current = useMemo(() => {
    let best = null;
    (savedCards || []).forEach((c) => {
      if (!best || (c.savedAt || 0) > (best.savedAt || 0)) best = c;
    });
    return best;
  }, [savedCards]);
  const splitVehicle = (c) => {
    if (c && c.vehicle && !c.make) {
      const mk = Object.keys(VEHICLES).find((m) => c.vehicle.startsWith(m));
      if (mk) return { ...c, make: mk, model: c.vehicle.slice(mk.length).trim() };
    }
    return c;
  };
  const [card, setCard] = useState(() => {
    try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); if (d && d.jobNo) return splitVehicle({ ...emptyCard(savedCards, readJcDefaults(demoMode), invoices), ...d }); } catch {}
    return emptyCard(savedCards, readJcDefaults(demoMode), invoices);
  });
  const [customVehicles, setCustomVehicles] = useState(() => { try { return JSON.parse(localStorage.getItem(CUSTOM_VEH_KEY) || '[]'); } catch { return []; } });
  // JC 1.2: snapshot-based undo for "Copy previous" (Section 4). Keyed by field
  // ('complaints'/'diagnosis') so each column undoes independently. Holds the exact
  // pre-copy value of that field — including whatever the advisor had already typed,
  // not just a blank slate — so Undo restores precisely, not just "clears the copy".
  // A second "Copy previous" click while undo is already armed does NOT overwrite the
  // snapshot: the field already holds copied (i.e. reproducible) data at that point, so
  // re-snapshotting it would make Undo a no-op instead of returning to the true original.
  const [copyUndo, setCopyUndo] = useState({});
  const [saving, setSaving] = useState(false);
  const [fullPreview, setFullPreview] = useState(false);
  // Settings QA fix: the on-screen "Job Card PDF Preview" panel below hardcoded
  // SHOP.name/tag/phones/address/gst/email/website directly — a second, independent
  // spot (besides the actual jsPDF generator) that never read Settings -> Business
  // Profile, so the on-screen preview didn't even match the real PDF it claims to
  // preview once the PDF generator was fixed. Memoized on [demoMode] like the
  // PDF generator's own brandedShop; doesn't need to re-read on every keystroke.
  const previewShop = useMemo(() => liveShop(demoMode), [demoMode]);
  const [invQ, setInvQ] = useState('');
  const [previewCard, setPreviewCard] = useState(null);
  // CONCURRENCY PHASE 1b/1c — single active editor while a SAVED job card is loaded
  // into the form. A brand-new card (not yet in savedCards) takes no lease. If
  // another user holds the lease the card still loads, READ-ONLY (Phase 1c), and
  // becomes editable in place via [Edit] once the lease frees.
  const [leasedJobNo, setLeasedJobNo] = useState(null);
  const jcLease = useEditLease('jobCards', leasedJobNo);
  const [jcViewOnly, setJcViewOnly] = useState(false);
  const [jcReviewOpen, setJcReviewOpen] = useState(false);
  const jcSync = useRecordSync('jobCards', leasedJobNo, card && card._rev);
  const previewSync = useRecordSync('jobCards', previewCard && previewCard.jobNo, previewCard && previewCard._rev);
  useLeaseReleaseToast(jcLease.status);
  const claimJobCardEdit = useCallback(async () => {
    if (!leasedJobNo) return;
    const r = await jcLease.acquire(leasedJobNo);
    if (!r.ok) { toast.error(`🔒 ${r.heldBy} is still editing this job card.`); return; }
    if (jcSync.latest) applyCard(splitVehicle({ ...emptyCard(savedRef.current, readJcDefaults(demoMode), invoices), ...jcSync.latest }));
    jcSync.markSynced();
    setDirty(false);
    setJcViewOnly(false);
  }, [leasedJobNo, jcLease, jcSync, demoMode]); // eslint-disable-line react-hooks/exhaustive-deps
  // Job Details drawer: reset its scroll to the top each time it opens (Issue 2) and lock
  // the page behind it so only the drawer scrolls (Issue 4).
  const previewBodyRef = useRef(null);
  useEffect(() => {
    if (!previewCard) return;
    if (previewBodyRef.current) previewBodyRef.current.scrollTop = 0;
    const t = lockBody();
    return () => unlockBody(t);
  }, [previewCard]);
  const [savedQ, setSavedQ] = useState(jcViewState.q);
  const [savedStatusF, setSavedStatusF] = useState(jcViewState.statusF);
  // Persist the list view (search + filter) to the in-memory cache so it survives a
  // tab-switch remount — not a reload, see jcViewState's own comment above.
  useEffect(() => { jcViewState.q = savedQ; jcViewState.statusF = savedStatusF; }, [savedQ, savedStatusF]);
  // The typed character renders immediately; only the filter lags behind it.
  const [savedDq] = useDeferredSearch(savedQ);
  // Haystack + sort computed once per data change, not per render.
  // GLOBAL SEARCH ACCURACY: jobNo/regNo/vin/engineNo are matched by EXACT value only (via
  // `entry.ids` + matchIndexed) — a complete Job Card Number like "SBBMC301" can never also
  // surface "SBBMC3010"/"SBBMC3011" just because they share that prefix. Customer/phone/
  // vehicle/advisor/technician stay partial-searchable in `entry.hay`, unchanged. The job
  // number's digit-only form ("301") is included as a SECOND exact id — see savedCardRank's
  // comment for why that's an intentional exact match, not a reintroduction of prefix matching.
  const savedSorted = useMemo(
    () => [...savedCards].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
      .map((jc) => ({
        jc,
        entry: {
          hay: [jc.customer, jc.phone, jc.vehicle, jc.advisor, jc.technician].filter(Boolean).join(' ').toLowerCase(),
          ids: [jc.jobNo, String(jc.jobNo || '').replace(/\D/g, ''), jc.regNo, jc.vin, jc.engineNo].filter(Boolean).map(normId),
        },
      })),
    [savedCards],
  );
  const [kpiFilter, setKpiFilter] = useState(null); // grouped KPI filter (Open/Repair/DeliveredToday/<status>)
  // 1.3 — one-shot deep-link from a Dashboard Insight ("N vehicles ready for delivery" /
  // "N job cards in progress"), same pattern as InventoryPurchaseOrders' initialReceivePOId.
  useEffect(() => {
    if (!initialKpiFilter) return;
    setKpiFilter(initialKpiFilter);
    // A stale status left over from before this deep-link (savedStatusF persists across a
    // tab-switch via jcViewState) could otherwise silently double-filter against it, same
    // class of bug as the KPI-tile/dropdown desync above.
    setSavedStatusF('All');
    onInitialKpiFilterHandled?.();
  }, [initialKpiFilter, onInitialKpiFilterHandled]);
  const savedList = useMemo(() => {
    const ql = savedDq.trim().toLowerCase();
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const todayMs = startOfToday.getTime();
    const kpiPass = (jc) => !kpiFilter || jobMatchesKpiBucket(jc, kpiFilter, todayMs);
    const matched = savedSorted
      .filter(({ jc, entry }) => (savedStatusF === 'All' || jc.status === savedStatusF) && kpiPass(jc) && matchIndexed(entry, savedDq));
    if (!ql) return matched.map((x) => x.jc); // no query — plain recency order, unchanged
    // Stable sort: within the same rank tier, savedSorted's recency order is preserved
    // (Array#sort is stable), so ties still read most-recent-first. Ranks via rankIndexed
    // against the SAME `entry` the filter above just used — previously this used a
    // separate `savedCardRank` that only scored jobNo/customer/vehicle, so an exact
    // regNo/VIN/engine-number match (present in `entry.ids`) would pass the filter but
    // rank no higher than an unrelated partial customer-name match.
    return matched
      .map((x) => ({ ...x, rank: rankIndexed(x.entry, savedDq) }))
      .sort((a, b) => b.rank - a.rank)
      .map((x) => x.jc);
  }, [savedSorted, savedDq, savedStatusF, kpiFilter]);
  const [savedLimit, setSavedLimit] = useState(20);
  useEffect(() => { setSavedLimit(20); }, [savedQ, savedStatusF, kpiFilter]);

  // Part 2 — KPI counts, derived once per data change from savedCards (no per-render or
  // per-filter recomputation). "Delivered Today" uses the Delivered statusLog entry date.
  const kpis = useMemo(() => {
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const todayMs = startOfToday.getTime();
    const k = { Open: 0, Inspection: 0, 'Waiting Parts': 0, Repair: 0, Ready: 0, DeliveredToday: 0, Cancelled: 0 };
    for (const jc of savedCards) {
      for (const bucket of KPI_BUCKET_KEYS) if (jobMatchesKpiBucket(jc, bucket, todayMs)) k[bucket] += 1;
    }
    return k;
  }, [savedCards]);

  // Part 4 — bulk selection (job numbers). Survives search/filter/sort until cleared —
  // same convention Inventory Parts' bulk selection already uses (selectedIds there is
  // never reset on filter change either). JC 1.4: what WAS a bug is that the bulk action
  // bar's own Print/PDF buttons only acted on `savedList.filter(...)` — the CURRENT
  // filtered view — while the badge showed `selectedJobs.size`, the FULL cross-filter
  // selection. Narrowing the status filter after selecting could silently print/export
  // fewer cards than the badge promised, with no error and no indication anything was
  // skipped. This became the reference implementation for the universal
  // selection-to-document-generation contract (lib/selectionScope.js) — resolving the
  // real record for every selected id regardless of the active filter, so an action
  // always covers exactly what the badge says it covers. See CustomersModule.jsx /
  // VehiclesModule.jsx for the same contract applied elsewhere.
  const [selectedJobs, setSelectedJobs] = useState(() => new Set());
  const toggleJob = (jobNo) => setSelectedJobs((s) => { const n = new Set(s); if (n.has(jobNo)) n.delete(jobNo); else n.add(jobNo); return n; });
  const clearSelection = () => setSelectedJobs(new Set());
  // Job Cards have no delete-dependency guard at all today (unlike e.g. Supplier delete,
  // which warns "linked to N parts" before proceeding) — an invoice can reference a job
  // card by jobNo (see the "View Invoice" lookup in Section 12 below); deleting the card
  // out from under it leaves that invoice's jobNo pointing at nothing. Same warn-then-let-
  // the-owner-decide pattern as Supplier delete, not a hard block — a workshop may
  // legitimately need to delete a stray/duplicate card even if billing already ran.
  const invoicedJobNos = useMemo(() => new Set((invoices || []).filter((iv) => iv.jobNo).map((iv) => iv.jobNo)), [invoices]);
  const [warnQ, setWarnQ] = useState('');
  const [partQ, setPartQ] = useState('');
  const [noteTab, setNoteTab] = useState('notes');
  const [noteEntry, setNoteEntry] = useState('');
  const [notesLogOpen, setNotesLogOpen] = useState(true);
  const [rowMenu, setRowMenu] = useState(null);
  // Stable per-row anchor ref for the "More actions" menu, portalled via DropdownPanel
  // — matches every other module's row-action menu so there's one shared positioning
  // implementation instead of a hand-rolled `absolute` div per module.
  const rowMenuAnchorRefs = useRef(new Map());
  const rowMenuAnchorRef = (id) => {
    if (!rowMenuAnchorRefs.current.has(id)) rowMenuAnchorRefs.current.set(id, { current: null });
    return rowMenuAnchorRefs.current.get(id);
  };
  useEffect(() => {
    if (rowMenu == null) return undefined;
    const close = () => setRowMenu(null);
    const onKey = (e) => { if (e.key === 'Escape') setRowMenu(null); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', onKey); };
  }, [rowMenu]);
  const loadCard = async (jc) => {
    if (dirty.current && !await confirmDialog({ title: 'Load this card?', message: 'The current draft will be replaced.', confirmText: 'Load' })) return;
    // Phase 1b/1c — acquire the edit lease for a SAVED card. If someone else holds
    // it, load the card anyway but READ-ONLY (never refuse) — [Edit] claims it later.
    const isSaved = !!(jc && jc.jobNo && (savedRef.current || []).some((c) => c.jobNo === jc.jobNo));
    if (isSaved) {
      jcSync.markSynced(revOf(jc));
      const r = await jcLease.acquire(jc.jobNo);
      setJcViewOnly(!r.ok);
      if (!r.ok) toast.error(`🔒 ${r.heldBy} is editing job card ${jc.jobNo}. You can view it once they finish.`, { duration: 6000 });
      setLeasedJobNo(jc.jobNo);
    } else {
      jcLease.release();
      setLeasedJobNo(null);
      setJcViewOnly(false);
    }
    applyCard(splitVehicle({ ...emptyCard(savedRef.current, readJcDefaults(demoMode), invoices), ...jc }));
    setDirty(false); setCopyUndo({}); appScrollTo({ top: 0, behavior: 'smooth' });
  };
  const duplicateCard = (jc) => { const copy = { ...jc, jobNo: nextJobCardNumber([...savedRef.current, ...invoices], readJcDefaults(demoMode).prefix), status: 'Received', statusLog: [{ status: 'Received', at: Date.now() }], savedAt: undefined }; applyCard(splitVehicle({ ...emptyCard(savedRef.current, readJcDefaults(demoMode), invoices), ...copy })); setDirty(true); setCopyUndo({}); toast.success('Duplicated — review and save as a new card'); appScrollTo({ top: 0, behavior: 'smooth' }); };
  // JC 1.2: copy a field from the most recent saved job card, snapshotting the current
  // (possibly hand-typed, unsaved) value first so it can be restored exactly.
  const copyPrevious = (key) => {
    const prevVals = ((lastCardRef.current && lastCardRef.current[key]) || []).filter(Boolean);
    if (!prevVals.length) return;
    setCopyUndo((u) => (key in u ? u : { ...u, [key]: card[key] }));
    set({ [key]: [...prevVals] });
  };
  const undoCopy = (key) => {
    if (!(key in copyUndo)) return;
    applyCard((c) => ({ ...c, [key]: copyUndo[key] }));
    setDirty(true);
    setCopyUndo((u) => { const n = { ...u }; delete n[key]; return n; });
  };
  const dirty = useRef(false);
  // PHASE 7b (PH7-02) — surface the same in-progress-edit state to the dashboard's
  // tab-switch guard (dirty.current alone is invisible to it; a ref write triggers
  // no effect). Every assignment site below is routed through this instead of
  // writing dirty.current directly, so the parent's flag never drifts from this
  // module's own.
  const setDirty = useCallback((v) => { dirty.current = v; if (onDirtyChange) onDirtyChange(v); }, [onDirtyChange]);
  // Defensive backstop: whatever state the draft was in, the whole module unmounting
  // (a tab switch away from Job Cards) means there is no more open editor for the
  // dashboard's guard to protect — never leave it stuck reporting dirty.
  useEffect(() => () => { if (onDirtyChange) onDirtyChange(false); }, [onDirtyChange]);
  const cardRef = useRef(card);
  // Synchronous double-save guard. disabled={saving} is async React state, so a rapid
  // second click can pass before the button re-renders disabled — persisting the card
  // twice. This ref flips in the same tick, before any await.
  const savingRef = useRef(false);

  // Every card mutation (this function is the ONLY place that calls the raw setCard from
  // useState) updates cardRef.current SYNCHRONOUSLY, in the same tick, before setCard's
  // commit. A render-time assignment (`cardRef.current = card`, once tried here) is NOT
  // equivalent: it re-derives the ref from whatever `card` a given render closure captured,
  // and if a stale render commits after a newer applyCard() call already advanced the ref
  // (e.g. two selections/saves fired back-to-back with no repaint in between), it stomps the
  // ref back to the older value. Routing every mutation through this one function — never
  // calling the raw setCard directly — makes the ref monotonically follow real calls, not
  // React's render/commit timing, so validate()/saveCard() (which read cardRef.current) always
  // see what was actually last set, however fast selections and Save are fired.
  const applyCard = useCallback((update) => {
    const next = typeof update === 'function' ? update(cardRef.current) : update;
    cardRef.current = next;
    setCard(next);
  }, []);

  const set = useCallback((patch) => {
    setDirty(true);
    applyCard((c) => ({ ...c, ...patch }));
  }, [applyCard, setDirty]);

  // Deep-link (Issue E): a job card opened in a new tab from Customers lands here — load
  // the actual record into the editor, not just a search. savedCards load async, so this
  // resolves when they arrive (consumed once).
  //
  // ROOT CAUSE of "opens a blank Job Card": the token used to used to be READ AND
  // IMMEDIATELY REMOVED from localStorage on the component's very first render (before
  // savedCards had even loaded). That's a ONE-SHOT read with no protection against the
  // component mounting more than once before the data arrives — which React's Strict
  // Mode deliberately does in development (mount → cleanup → mount again), and which can
  // also happen from ordinary render races. The FIRST (often throwaway) mount would
  // silently consume and delete the token; by the time the SURVIVING mount's effect ran
  // and savedCards had actually loaded, the token was already gone, so the retry logic
  // (which does work correctly) had nothing left to retry with — landing on a blank card.
  // Fix: only clear the token once it has actually been RESOLVED (found, or confirmed
  // absent from a fully-loaded list) — never on the initial read. Every render/remount
  // before the data arrives re-reads the SAME still-present token from localStorage.
  const pendingJobOpen = useRef(null);
  const jobOpenDone = useRef(false);
  if (pendingJobOpen.current === null) {
    try { pendingJobOpen.current = localStorage.getItem('maruti_jobcard_open') || ''; } catch { pendingJobOpen.current = ''; }
  }
  useEffect(() => {
    const jobNo = pendingJobOpen.current;
    if (!jobNo || jobOpenDone.current) return;
    const match = (savedCards || []).find((c) => String(c.jobNo || '') === String(jobNo));
    if (match) {
      jobOpenDone.current = true;
      applyCard(splitVehicle({ ...emptyCard(savedCards, readJcDefaults(demoMode), invoices), ...match }));
      setDirty(false);
      try { localStorage.removeItem('maruti_jobcard_open'); } catch {}
    } else if ((savedCards || []).length) {
      // Loaded, but genuinely not found (e.g. beyond the live window, or deleted) — filter
      // instead, and stop retrying: the token is now resolved, so clear it.
      jobOpenDone.current = true;
      setSavedQ(jobNo);
      try { localStorage.removeItem('maruti_jobcard_open'); } catch {}
    }
    // else: not loaded yet — leave the token in place and retry when savedCards changes.
    // applyCard is a stable (empty-dep) useCallback, omitted here deliberately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedCards]);

  // Deep-link: "View All Job Cards" for a vehicle — filter the saved-cards list by its reg.
  useEffect(() => {
    let reg = null;
    try { reg = localStorage.getItem('maruti_jobcard_list_filter'); localStorage.removeItem('maruti_jobcard_list_filter'); } catch {}
    if (reg) setSavedQ(reg);
  }, []);

  // Autosave: debounce + hard 5s interval + Ctrl+S + warn-before-leave.
  useEffect(() => {
    const t = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(card)); } catch {} }, 600);
    return () => clearTimeout(t);
  }, [card]);
  useEffect(() => {
    const iv = setInterval(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(cardRef.current)); } catch {} }, 5000);
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); try { localStorage.setItem(DRAFT_KEY, JSON.stringify(cardRef.current)); } catch {} toast.success('Draft saved', { id: 'jc-save' }); } };
    const onLeave = (e) => { if (dirty.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onLeave);
    return () => { clearInterval(iv); window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onLeave); };
  }, []);

  const addVehicle = (nv) => setCustomVehicles((prev) => { const next = [...prev, nv]; try { localStorage.setItem(CUSTOM_VEH_KEY, JSON.stringify(next)); } catch {} return next; });

  const engErr = engOk(card.engineNo);
  const vinErr = vinOk(card.vin);
  const promisedErr = card.promised && card.dateIn && card.promised < card.dateIn ? 'Promised delivery cannot be earlier than Date & Time In' : null;

  const invNames = useMemo(() => {
    const ql = invQ.trim().toLowerCase();
    const names = Array.from(new Set(inventory.filter((p) => !p.archived).map((p) => p.name))).sort();
    return (ql ? names.filter((n) => n.toLowerCase().includes(ql)) : names);   // no cap: the panel scrolls
  }, [inventory, invQ]);
  // Was a SILENT .slice(0, 20): with 25 matching brake pads, five simply never drew and
  // nothing said so. Cap retained (this list is not virtualised) but now disclosed.
  // GLOBAL SEARCH ACCURACY: Part Number (sku/oemNo/partNo) and barcode match by EXACT
  // value only — a complete part number can never also surface an unrelated part whose
  // number merely starts with or contains it. Part name stays partial-searchable.
  const partSearchIndex = useSearchIndex(
    inventory,
    (p) => p.id,
    (p) => [p.name],
    (p) => [p.sku, p.oemNo, p.partNo, p.barcode],
  );
  const allPartMatches = useMemo(() => {
    const ql = partQ.trim();
    if (!ql) return [];
    return inventory.filter((p) => !p.archived && matchIndexed(partSearchIndex.get(p.id), ql));
  }, [inventory, partQ, partSearchIndex]);
  const PART_CAP = 50;
  const partMatches = useMemo(() => allPartMatches.slice(0, PART_CAP), [allPartMatches]);
  const availableOf = (partId) => { const p = inventory.find((x) => x.id === partId); return p ? Math.max(0, (p.stock || 0) - (p.reserved || 0)) : 0; };

  const toggleList = (key, val) => set({ [key]: card[key].includes(val) ? card[key].filter((x) => x !== val) : [...card[key], val] });
  const toggleDamage = (part) => {
    const has = card.damages.some((d) => d.part === part);
    set({ damages: has ? card.damages.filter((d) => d.part !== part) : [...card.damages, { part, note: '' }] });
  };
  const setDamageNote = (part, note) => set({ damages: card.damages.map((d) => (d.part === part ? { ...d, note } : d)) });
  const setDamageField = (part, patch) => set({ damages: card.damages.map((d) => (d.part === part ? { ...d, ...patch } : d)) });

  const inspStats = useMemo(() => {
    const items = INSPECTION_TEMPLATES[card.inspectionTemplate] || ALL_INSPECTION;
    const done = items.filter((i) => card.inspection[i]).length;
    return { done, total: items.length };
  }, [card.inspection, card.inspectionTemplate]);

  // Photos: input (with capture) + drag&drop.
  const addPhotos = (key, files) => {
    Array.from(files || []).slice(0, 8).forEach((f) => {
      if (!f.type.startsWith('image/')) return;
      if (f.size > 900 * 1024) { toast.error(`${f.name}: image too large (max ~900KB)`); return; }
      const r = new FileReader();
      r.onload = () => applyCard((c) => ({ ...c, [key]: [...c[key], r.result].slice(0, 8) }));
      r.readAsDataURL(f);
    });
    setDirty(true);
  };
  const onDrop = (key) => (e) => { e.preventDefault(); addPhotos(key, e.dataTransfer.files); };

  // Status workflow: sequential for staff, override for admins; timestamps logged.
  const [statusConfirm, setStatusConfirm] = useState(null); // { to, from, isRegression, reason }
  const statusConfirmTrigger = useRef(null);
  const statusConfirmRef = useRef(null);
  useEffect(() => {
    let t;
    if (statusConfirm) { statusConfirmTrigger.current = document.activeElement; t = setTimeout(() => statusConfirmRef.current?.focus(), 0); }
    else if (statusConfirmTrigger.current) { statusConfirmTrigger.current.focus?.(); statusConfirmTrigger.current = null; }
    return () => clearTimeout(t);
  }, [statusConfirm]);

  const applyStatus = (s, reason) => {
    const cur = STATUSES.indexOf(card.status);
    const nxt = STATUSES.indexOf(s);
    const isOverride = isAdmin && nxt !== cur + 1 && !(s === 'Cancelled' || s === 'Repair Paused' || card.status === 'Repair Paused');
    const entry = { status: s, at: Date.now(), by: demoMode ? 'Demo User' : (card.advisor || 'Staff') };
    if (reason) entry.reason = reason;
    if (isOverride) entry.override = true;
    set({ status: s, statusLog: [...card.statusLog, entry] });
  };

  const setStatus = (s) => {
    const cur = STATUSES.indexOf(card.status);
    const nxt = STATUSES.indexOf(s);
    if (nxt === cur) return;
    // Cancelled and Repair Paused can be set from any stage; others follow sequence (admins may skip).
    const jumpAllowed = s === 'Cancelled' || s === 'Repair Paused' || card.status === 'Repair Paused';
    if (!isAdmin && !jumpAllowed && nxt !== cur + 1) { toast.error(`Move to “${STATUSES[cur + 1] || '—'}” first — workflow can’t be skipped.`); return; }
    // Part 3 — protect destructive/backward transitions with a confirmation + reason.
    const isRegression = nxt >= 0 && cur >= 0 && nxt < cur && s !== 'Cancelled';
    if (s === 'Cancelled' || s === 'Closed' || isRegression) {
      setStatusConfirm({ to: s, from: card.status, isRegression, reason: '' });
      return;
    }
    applyStatus(s);
  };

  function validate() {
    // cardRef.current, not the `card` closure — always the latest value, even mid-render.
    const card = cardRef.current;
    if (!card.jobNo.trim()) return 'Job Card Number is required';
    if (card.jobNoMode === 'manual' && (savedRef.current.some((c) => c.jobNo === card.jobNo) || invoices.some((iv) => iv.jobNo === card.jobNo))) return 'Job Card Number already exists';
    if (!card.customer.trim()) return 'Customer name is required';
    if (!isIndianMobile(card.phone)) return `Contact number: ${MOBILE_ERROR.toLowerCase()}`;
    if (card.altPhone && !isIndianMobile(card.altPhone)) return `Alternate number: ${MOBILE_ERROR.toLowerCase()}`;
    if (!card.vehicle) return 'Select the vehicle make & model';
    if (!card.regNo.trim()) return 'Registration number is required';
    const engErr = engOk(card.engineNo);
    if (engErr) return engErr;
    const vinErr = vinOk(card.vin);
    if (vinErr) return vinErr;
    if (card.promised && card.dateIn && card.promised < card.dateIn) return 'Promised delivery cannot be earlier than Date & Time In';
    return null;
  }
  // Part 1 — inline field-level errors for the three required fields. These mirror the
  // messages validate() already produces; they do not change the save gate (validate()
  // remains the single source of truth). `triedSave` reveals them on a blocked save;
  // per-field `touched` reveals them once the user has left a field empty.
  const [triedSave, setTriedSave] = useState(false);
  const [touched, setTouched] = useState({});
  const touch = (k) => setTouched((t) => (t[k] ? t : { ...t, [k]: true }));
  const fieldErrors = {
    jobNo: !card.jobNo.trim() ? 'Job Card Number is required'
      : (card.jobNoMode === 'manual' && (savedRef.current.some((c) => c.jobNo === card.jobNo) || invoices.some((iv) => iv.jobNo === card.jobNo))) ? 'Job Card Number already exists' : null,
    customer: !card.customer.trim() ? 'Customer name is required' : null,
    regNo: !card.regNo.trim() ? 'Registration number is required' : null,
  };
  const showErr = (k) => ((touched[k] || triedSave) && fieldErrors[k]) || null;
  // asDraft: park a partially-filled job card. The vehicle is often still being looked
  // at when the service advisor gets pulled away — demanding reg-no / engine no / VIN
  // up front just means the card never gets written. A draft needs only a name so it
  // can be found again; the full validation applies when it is properly opened.
  async function saveCard(asDraft = false) {
    if (jcViewOnly) return;   // Phase 1c — view-only while another user holds the edit lease
    if (savingRef.current) return;   // a save is already in flight (guards double-click)
    if (!canManage) { toast.error('You do not have permission to save job cards.'); return; }
    // Same reasoning as validate(): read the synchronous ref, not the render closure, so a
    // save fired immediately after a selection (e.g. picking a customer) persists what's
    // actually on screen rather than the pre-selection snapshot.
    const card = cardRef.current;
    if (asDraft) {
      if (!card.customer?.trim()) { toast.error('Customer name required — even for a draft.'); return; }
    } else {
      const err = validate();
      if (err) { setTriedSave(true); toast.error(err); return; }
    }
    // CAPACITY GUARD — only a genuinely NEW job card (its jobNo isn't already saved)
    // increases the active count, so only that path is gated. Checked BEFORE any
    // network write, so a blocked save never partially persists.
    const isNewCard = !savedRef.current.some((c) => c.jobNo === card.jobNo);
    if (isNewCard) {
      const { blocked } = await checkCapacityGuard('jobCards', { demoMode });
      if (blocked) {
        notify.warning('Record limit reached. Please free space before creating a new record.');
        setCapacityBlockedOpen(true);
        return;
      }
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await onPersist?.({
        ...card,
        status: asDraft ? DRAFT_STATUS : (card.status === DRAFT_STATUS ? 'Received' : card.status),
        isDraft: asDraft,
        savedAt: Date.now(),
      });
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
      setDirty(false);
      jcLease.release(); setLeasedJobNo(null); setJcViewOnly(false);   // Phase 1b — hand the lease back after a real save
      toast.success(asDraft ? `Draft saved — ${card.customer}` : `Job card ${card.jobNo} saved`);
      applyCard(emptyCard(savedRef.current, readJcDefaults(demoMode), invoices));
      setCopyUndo({});
    } catch (e) {
      // C-1: onPersist now genuinely rejects on a failed write (it used to resolve
      // instantly regardless of outcome), and the shared persistence layer already
      // shows a specific toast for the failure — avoid a redundant second one here.
      console.error(e);
    }
    finally { setSaving(false); savingRef.current = false; }
  }

  /* ---------- PDF (matches SHOP.pdf reference; 2 pages + photos) ----------
     JC 1.4/Issue-3: this used to be one function that both DREW a card's pages
     AND owned the jsPDF instance + save/print call. A bulk selection had no way
     to reuse the drawing without also getting a fresh document + a fresh
     save/print per card — which is exactly why "Print"/"PDF" on N selected
     records used to fire N separate downloads/print dialogs instead of one
     document covering the selection. Split into:
       - drawJobCardDocument(doc, card): draws ONE card's pages onto whatever
         page of `doc` is currently active. No jsPDF() construction, no
         save/print — purely additive, so it can be called once (downloadPDF)
         or N times in a loop onto the SAME doc (downloadCombinedPDF).
       - downloadPDF(source, printAfter): unchanged single-card behavior,
         now a 4-line wrapper around the shared drawer.
       - downloadCombinedPDF(cards, printAfter): the actual fix for Issue 3 —
         one jsPDF instance, one addPage() between cards, one save/print call
         covering exactly the cards passed in. */
  async function drawJobCardDocument(doc, card) {
    // Same QR fix as the invoice PDF. The old call used margin:0 — QR scanners
    // REQUIRE a quiet zone of >= 2 modules of white around the symbol, and without it
    // many refuse to lock on at all — and it was drawn at only 44pt, far too small
    // for the module count. Shared helper handles payload validity + sizing.
    const qrPayload = buildQrPayload({
      kind: 'jobcard',
      docNo: card.jobNo,
      shopName: SHOP.name,
      customer: card.customer,
      vehicle: card.regNo,
      date: card.date || card.createdAt,
      status: card.status,
    });
    const qrDataUrl = await makeQrDataUrl(qrPayload);
    // GLOBAL PDF FRAMEWORK: page geometry, brand gold, letterhead and page-number
    // footer now come from lib/pdfTheme.js — shared with Invoice/Estimate and
    // Purchase Order so all three carry identical branding. Body layout below
    // (secTitle/boxRow/etc.) is untouched — only the letterhead chrome moved.
    const { W, M } = PDF_PAGE;
    // Business Identity fields (Settings → Business Profile: Workshop Name/Phone/
    // GST/Address/Email/Logo) — Settings QA fix: these fields saved correctly into
    // biz.bizName/bizPhone/bizGst/bizAddress/bizEmail/logoDataUrl but nothing read
    // them for PDFs; only the logo was ever wired. liveShop() in lib/pdfTheme.js is
    // now the one place that reads Settings for this purpose — same call Billing's
    // invoice PDF uses, so the two branded documents can't drift from each other
    // again. maskShop() (used for `shop` above) never masks `.name` — a business
    // name isn't the kind of contact-detail PII phones/address/GST/email are, and
    // every demo screenshot already shows it prominently — so brandedShop.name is
    // live in demo mode too, matching that existing, already-tested policy; only
    // phones/address/GST/email stay masked there.
    const brandedShop = demoMode ? maskShop(liveShop(demoMode)) : liveShop(demoMode);
    const gold = PDF_GOLD.onDark;
    let page = 1;
    const watermark = () => {
      doc.saveGraphicsState();
      doc.setGState(new doc.GState({ opacity: 0.06 }));
      doc.setFontSize(52); doc.setTextColor(120, 100, 40);
      doc.text('SRI BABA BALAJI', W / 2, 480, { align: 'center', angle: 30 });
      doc.restoreGraphicsState();
    };
    const pageNo = () => drawPdfPageNumber(doc, page, { W, M });
    const header = (sub) => drawPdfHeader(doc, { W, M, shop: brandedShop, sub });
    // GLOBAL PDF FRAMEWORK (readability pass): shared drawSectionTitle gives 14pt of
    // air below a heading before content starts, not the old flat 8pt — "section
    // headings and their corresponding content are positioned too close together."
    const secTitle = (y, t) => drawSectionTitle(doc, y, t, { M, gold });
    // Truncating a real customer name/address/registration silently (no ellipsis) reads
    // as data loss, not a design choice — a long name just vanishes with no sign
    // anything was cut. Every boxRow/boxRowW cell now shows "…" when it doesn't fit.
    const fitCell = (s, n) => { const v = String(s ?? '').trim(); if (!v) return '—'; return v.length > n ? `${v.slice(0, n - 1)}…` : v; };
    const boxRow = (y, cols, h = 30) => {
      const w = (W - 2 * M) / cols.length;
      cols.forEach((c, i) => {
        doc.setDrawColor(200); doc.rect(M + i * w, y, w - (i < cols.length - 1 ? 6 : 0), h);
        doc.setFontSize(6); doc.setTextColor(120); doc.text(c.label.toUpperCase(), M + i * w + 4, y + 9);
        doc.setFontSize(8.5); doc.setTextColor(25); doc.text(fitCell(c.value, 42), M + i * w + 4, y + 21);
      });
      return y + h + 10;
    };
    // Same as boxRow but lays the columns out within a constrained total width (used to
    // keep a row clear of the QR gutter).
    const boxRowW = (y, cols, totalW, h = 30) => {
      const w = totalW / cols.length;
      cols.forEach((c, i) => {
        doc.setDrawColor(200); doc.rect(M + i * w, y, w - (i < cols.length - 1 ? 6 : 0), h);
        doc.setFontSize(6); doc.setTextColor(120); doc.text(c.label.toUpperCase(), M + i * w + 4, y + 9);
        doc.setFontSize(8.5); doc.setTextColor(25); doc.text(fitCell(c.value, 28), M + i * w + 4, y + 21);
      });
      return y + h + 10;
    };

    // ---- PAGE 1 ----
    // Was 72pt — chosen only to dodge a layout overlap (see the row2 fix below), at
    // the cost of scannability: lib/pdfQr.js's own documented threshold is ~2pt per
    // module, and 72pt on this 41x41-module verification URL gives only ~1.6pt/module
    // (below the threshold that file itself measured). Now that BOTH of Section 1's
    // rows are width-constrained to clear the QR gutter (not just the first), the QR
    // no longer has to be shrunk to fit — 94pt clears the threshold (~2.1pt/module)
    // while still ending flush with Section 1, no further overlap.
    const JC_QR = 94;
    header();
    watermark();
    if (qrDataUrl) { try { doc.addImage(qrDataUrl, 'PNG', W - M - JC_QR, 108, JC_QR, JC_QR); doc.setFontSize(5.5); doc.setTextColor(140); doc.text('Scan to verify', W - M - JC_QR / 2, 108 + JC_QR + 7, { align: 'center' }); } catch {} }
    // Section 1 has TWO stacked rows before the page has scrolled clear of the QR
    // (QR: y 108→180, plus its "Scan to verify" caption to ~192). The first row was
    // already width-constrained to dodge the QR gutter, but the second (Service
    // Advisor/Technician/Helper) reverted to the full-width boxRow — at y≈176 it's
    // still inside the QR+caption's vertical span, so its right-hand cell and border
    // drew straight under the QR image and the "Scan to verify" text drew across the
    // row's content. Both rows now share the same QR-avoiding width until content has
    // genuinely scrolled clear of the QR block.
    const QR_CLEAR_W = W - 2 * M - JC_QR - 10;
    let y = 122;
    y = secTitle(y, '1. SERVICE INTAKE DETAILS');
    y = boxRowW(y, [{ label: 'Job Card No.', value: card.jobNo }, { label: 'Date & Time In', value: fmtDT(card.dateIn) }, { label: 'Promised Delivery', value: fmtDT(card.promised) }], QR_CLEAR_W);
    y = boxRowW(y, [{ label: 'Service Advisor', value: card.advisor }, ...(card.technician || card.helper ? [{ label: 'Technician', value: card.technician || '—' }, { label: 'Helper', value: card.helper || '—' }] : [])], QR_CLEAR_W);
    y = secTitle(y, '2. CLIENT PROFILE');
    y = boxRow(y, [{ label: 'Customer Name', value: card.customer }, { label: 'Contact Number', value: card.phone }, { label: 'Alternate Number', value: card.altPhone }]);
    // Full Address used the same single-line boxRow as short fields — a real
    // Indian address rarely fits the 42-char slice() it used, and slice() gives
    // no ellipsis, so it silently cut off mid-word. Wraps across up to 3 lines
    // instead, with the box growing to fit (same border/label styling as boxRow).
    {
      const addrLines = doc.splitTextToSize(String(card.address || '—'), W - 2 * M - 8);
      const shown = addrLines.slice(0, 3);
      const boxH = Math.max(30, 13 + shown.length * 9);
      doc.setDrawColor(200); doc.rect(M, y, W - 2 * M, boxH);
      doc.setFontSize(6); doc.setTextColor(120); doc.text('FULL ADDRESS', M + 4, y + 9);
      doc.setFontSize(8.5); doc.setTextColor(25);
      shown.forEach((l, i) => doc.text(l, M + 4, y + 21 + i * 9));
      y += boxH + 10;
    }
    y = secTitle(y, '3. VEHICLE SPECIFICATIONS');
    y = boxRow(y, [{ label: 'Registration No.', value: card.regNo }, { label: 'Make & Model', value: card.vehicle }, { label: 'VIN / Chassis No.', value: card.vin }]);
    y = boxRow(y, [{ label: 'Fuel Type', value: card.fuel }, { label: 'Engine No.', value: card.engineNo }]);
    y = secTitle(y, '4. CLIENT INSTRUCTIONS & DIAGNOSTICS');
    const comp = card.complaints.filter(Boolean); const diag = card.diagnosis.filter(Boolean);
    if (!comp.length && !diag.length) {
      // Was: always rendered a minimum of 3 numbered rows even with nothing
      // entered, so an empty section showed "1. / 2. / 3." with nothing after
      // them — congested and confusing. One clear empty-state line instead.
      doc.setFontSize(7.5); doc.setTextColor(120);
      doc.text('No complaints or diagnosis notes recorded.', M + 2, y); y += 16;
    } else {
      // Was a hard .slice(0, 55) with no wrap and no ellipsis — a real complaint or
      // diagnosis note routinely runs past 55 characters ("Engine making unusual
      // knocking noise when accelerating uphill in 3rd gear") and simply vanished
      // past that point with no sign anything was cut, on a document handed to the
      // customer. Each row now wraps to as many lines as it actually needs, and the
      // row height grows to match — never silently drops text, and a long complaint
      // list just takes the vertical space it needs instead of overlapping the row
      // below it.
      const colGap = 14;
      const colW = (W - 2 * M - colGap) / 2;
      const col1X = M + 2, col2X = M + colW + colGap;
      doc.setFontSize(6.5); doc.setTextColor(120);
      doc.text('COMPLAINT / REQUEST', col1X, y); doc.text('DIAGNOSIS / TECHNICIAN NOTES', col2X, y);
      y += 12;
      const rowLineH = 10;
      const lines = Math.max(comp.length, diag.length, 1);
      for (let i = 0; i < lines; i += 1) {
        const cLines = doc.splitTextToSize(`${i + 1}. ${comp[i] || '—'}`, colW - 4);
        const dLines = doc.splitTextToSize(`${i + 1}. ${diag[i] || '—'}`, colW - 4);
        doc.setFontSize(7.5); doc.setTextColor(50);
        cLines.forEach((l, li) => doc.text(l, col1X, y + li * rowLineH));
        dLines.forEach((l, li) => doc.text(l, col2X, y + li * rowLineH));
        y += Math.max(cLines.length, dLines.length) * rowLineH + 5;
        doc.setDrawColor(215); doc.line(M, y - 4, W - M, y - 4);
      }
      y += 8;
    }
    // A very long complaint/diagnosis list (or a run of long entries that each wrap
    // to several lines) can now push page 1's remaining content — Labour, Terms of
    // Service, and the signature block — close to or past the printable area. The
    // signature block in particular must never be silently pushed off the bottom
    // edge, so page 1 gets the same "does this still fit?" guard the photo grid
    // already had: if not, start a fresh page and continue there instead of
    // drawing past the paper's edge.
    const PAGE_BOTTOM = 760;
    const ensureRoom = (need, sub) => {
      if (y + need > PAGE_BOTTOM) {
        pageNo(); doc.addPage(); page += 1; header(sub); watermark();
        y = 78;
      }
    };
    // E2E workflow QA fix: the on-screen form has a full "10. PARTS RESERVATION"
    // section (parts actually reserved against live inventory — see `card.parts`,
    // read throughout the editing UI above) but `card.parts` was never once read
    // anywhere in this PDF drawer — only Labour ("4B.") was ever drawn, and its own
    // "4B." label is the tell: a "4A." for parts was clearly intended and never
    // implemented. Reproduced live: saved a Job Card with a reserved part, generated
    // its PDF, and the part was completely absent from both pages — a technician or
    // customer reading the printed card would have no record of which parts this job
    // consumes, even though Inventory has genuinely reserved stock for it and Billing
    // can import the same line into an invoice. Mirrors the Labour table's own
    // layout/pagination pattern immediately below.
    if ((card.parts || []).length) {
      ensureRoom(50, 'JOB CARD (CONTINUED)');
      y = secTitle(y, '4A. PARTS RESERVATION');
      doc.setFontSize(6.5); doc.setTextColor(120);
      doc.text('PART', M + 2, y); doc.text('QTY', W - M - 150, y); doc.text('RATE', W - M - 100, y); doc.text('AMOUNT', W - M - 50, y);
      y += 8; doc.setFontSize(7.5); doc.setTextColor(50);
      let partsTotal = 0;
      card.parts.forEach((p) => {
        if (y + 13 > PAGE_BOTTOM) { pageNo(); doc.addPage(); page += 1; header('PARTS RESERVATION (CONTINUED)'); watermark(); y = 78; }
        const qty = Number(p.qty) || 0; const rate = Number(p.rate) || 0; const amt = qty * rate; partsTotal += amt;
        doc.text(fitCell(p.name, 45), M + 2, y);
        doc.text(String(p.qty || '—'), W - M - 150, y); doc.text(String(p.rate || '—'), W - M - 100, y); doc.text(`Rs. ${amt.toLocaleString('en-IN')}`, W - M - 50, y);
        doc.setDrawColor(220); doc.line(M, y + 3, W - M, y + 3); y += 13;
      });
      doc.setFontSize(8); doc.setTextColor(30); doc.text(`Total Parts: Rs. ${partsTotal.toLocaleString('en-IN')}`, W - M - 2, y + 2, { align: 'right' }); y += 14;
    }
    if ((card.labour || []).filter((lb) => lb.service).length) {
      ensureRoom(50, 'JOB CARD (CONTINUED)');
      y = secTitle(y, '4B. LABOUR & SERVICES');
      doc.setFontSize(6.5); doc.setTextColor(120);
      doc.text('SERVICE', M + 2, y); doc.text('HOURS', W - M - 150, y); doc.text('RATE', W - M - 100, y); doc.text('AMOUNT', W - M - 50, y);
      y += 8; doc.setFontSize(7.5); doc.setTextColor(50);
      let labTotal = 0;
      card.labour.filter((lb) => lb.service).forEach((lb) => {
        // A long labour list (multiple technicians, many line items) must not run off
        // the printable area either — same guard the section-level check above uses,
        // now per-row so it also catches a list that's long by itself.
        if (y + 13 > PAGE_BOTTOM) { pageNo(); doc.addPage(); page += 1; header('LABOUR & SERVICES (CONTINUED)'); watermark(); y = 78; }
        const amt = (Number(lb.hours) || 0) * (Number(lb.rate) || 0); labTotal += amt;
        doc.text(fitCell(lb.service, 45), M + 2, y);
        doc.text(String(lb.hours || '—'), W - M - 150, y); doc.text(String(lb.rate || '—'), W - M - 100, y); doc.text(`Rs. ${amt.toLocaleString('en-IN')}`, W - M - 50, y);
        doc.setDrawColor(220); doc.line(M, y + 3, W - M, y + 3); y += 13;
      });
      doc.setFontSize(8); doc.setTextColor(30); doc.text(`Total Labour: Rs. ${labTotal.toLocaleString('en-IN')}`, W - M - 2, y + 2, { align: 'right' }); y += 14;
    }
    // Terms + signature block are checked as ONE unit — a signature area split
    // across a page break (terms on page 1, signature stranded alone at the top of
    // a near-empty page 2) would look broken, and a signature silently pushed past
    // the printable bottom edge is worse: it just wouldn't print. ~170pt covers the
    // section title, three wrapped authorization clauses, and the signature block.
    ensureRoom(170, 'JOB CARD (CONTINUED)');
    y = secTitle(y, '5. TERMS OF SERVICE & AUTHORIZATION');
    doc.setFontSize(6.6); doc.setTextColor(80);
    const terms = [
      'I hereby authorize the repair work described above and agree to pay for labour, premium spare parts, and materials required at the workshop’s current rates.',
      'The workshop holds no liability for loss or damage to the vehicle or its contents due to fire, theft, or unforeseen circumstances beyond our strict control.',
      'I grant express permission to the workshop’s certified technicians to test-drive this vehicle on public roads for accurate diagnostic and inspection purposes.',
    ];
    // "Bullet lists appear compressed": was a flat 8pt per wrapped line + 3pt between
    // bullets — barely more than the 6.6pt font's own height. A touch more line-height
    // (8.5) and paragraph gap (5) gives each clause room to read as a distinct item.
    terms.forEach((t) => { const wrapped = doc.splitTextToSize(`•  ${t}`, W - 2 * M - 8); doc.text(wrapped, M + 4, y); y += wrapped.length * 8.5 + 5; });
    y += PDF_SPACING.signatureTopGap;
    const sigY = drawSignatureBlock(doc, y, 'AUTHORIZED CLIENT SIGNATURE', 'SERVICE ADVISOR SIGNATURE', { W, M });
    doc.setFontSize(6); doc.setTextColor(150);
    doc.text('( PLEASE TURN OVER FOR COMPREHENSIVE VEHICLE INSPECTION )', W / 2, sigY + 17, { align: 'center' });
    pageNo();

    // ---- PAGE 2 ----
    doc.addPage(); page += 1; header('WORKSHOP FLOOR & QUALITY CONTROL'); watermark();
    y = 78;
    y = secTitle(y, '6. EXTERIOR CONDITION & INVENTORY CHECK');
    // GLOBAL PDF FRAMEWORK (readability pass): these three were LISTS of discrete
    // items (warnings, accessories, damages), rendered as one undifferentiated
    // wrapped paragraph (`items.join(', ')` through splitTextToSize) — "large text
    // blocks should wrap naturally or organize into multiple rows/columns" is
    // exactly what that flattened. drawChipList keeps each item visually distinct
    // (a middle-dot separator) while still wrapping to a new row automatically.
    const listWidth = W - 2 * M - 8;
    doc.setFontSize(6.5); doc.setTextColor(120); doc.text('DASHBOARD WARNINGS ON:', M + 2, y); y += 8;
    const warnList = [...card.warnings, ...(card.warningsOther ? [card.warningsOther] : [])];
    y = drawChipList(doc, M + 2, y, warnList, listWidth, { emptyText: 'None reported' });
    y += 4;
    doc.setFontSize(6.5); doc.setTextColor(120); doc.text('ACCESSORIES & ITEMS PRESENT:', M + 2, y); y += 8;
    const invList = [...card.invItems, ...(card.invOther ? [card.invOther] : [])];
    y = drawChipList(doc, M + 2, y, invList, listWidth);
    y += 4;
    doc.setFontSize(6.5); doc.setTextColor(120); doc.text('EXTERIOR CONDITION & PRE-EXISTING DAMAGES:', M + 2, y); y += 8;
    const dmg = card.damages.map((d) => { const bits = [d.type, d.severity, d.note].filter(Boolean).join(', '); return bits ? `${d.part} (${bits})` : d.part; });
    if (card.damageOther) dmg.push(card.damageOther);
    y = drawChipList(doc, M + 2, y, dmg, listWidth, { emptyText: 'No visible damage recorded.' });
    y += 6;
    y = secTitle(y, '7. MULTI-POINT INSPECTION RESULTS');
    const tmplSet = new Set(INSPECTION_TEMPLATES[card.inspectionTemplate] || ALL_INSPECTION);
    // Build result groups: only checked standard items (within the chosen template) + checked customs.
    const resultGroups = Object.entries(INSPECTION).map(([title, items]) => {
      const checkedStd = items.filter((it) => tmplSet.has(it) && card.inspection[it]);
      const customs = ((card.inspectionCustom && card.inspectionCustom[title]) || []).filter((c) => card.inspection[`${title}::${c}`]);
      return [title, [...checkedStd, ...customs.map((c) => `${c} (custom)`)]];
    }).filter(([, list]) => list.length);
    if (!resultGroups.length) {
      doc.setFontSize(7.5); doc.setTextColor(120);
      doc.text('No inspection items marked for this job card.', M + 2, y); y += 16;
    } else {
      const colW = (W - 2 * M) / 2;
      let col = 0; let colY = [y, y];
      resultGroups.forEach(([title, list]) => {
        const x = M + col * colW;
        let iy = colY[col];
        doc.setFontSize(7); doc.setFont(undefined, 'bold'); doc.setTextColor(...gold);
        doc.text(title.toUpperCase(), x + 2, iy); doc.setFont(undefined, 'normal'); iy += 10;
        doc.setFontSize(6.8); doc.setTextColor(50);
        list.forEach((it) => { doc.splitTextToSize(`[x] ${it}`, colW - 8).forEach((ln) => { doc.text(ln, x + 2, iy); iy += 8.5; }); });
        iy += PDF_SPACING.groupGap; colY[col] = iy; // "inspection groups require better separation" (was 6, then 8)
        col = colY[0] <= colY[1] ? 0 : 1; // fill the shorter column next
      });
      y = Math.max(colY[0], colY[1]) + 4;
    }
    // Same page-1 signature guarantee applies here (ensureRoom, defined above, is
    // page-agnostic — it just checks y against PAGE_BOTTOM and starts a fresh page
    // with whatever running-header title it's given): a big Multi-Point Inspection
    // result set must not push Notes + the final signature block off the bottom
    // edge. ~180pt covers the section title, a few note lines, status line, and the
    // signature block itself.
    ensureRoom(180, 'WORKSHOP FLOOR & QUALITY CONTROL (CONTINUED)');
    y = secTitle(y, '8. NOTES');
    doc.setFontSize(7.5); doc.setTextColor(50);
    const combinedNotes = [card.notes && `Internal: ${card.notes}`, card.technicianNote && `Technician: ${card.technicianNote}`, card.customerNote && `Customer: ${card.customerNote}`].filter(Boolean).join('\n') || ' ';
    // Was a hard .slice(0, 5) — any notes wrapping past 5 lines (combining internal +
    // technician + customer notes) were silently dropped with no sign anything was
    // cut. Every line now draws; a genuinely long combined note just pushes the
    // signature block to a continuation page via the guard above instead of
    // discarding content.
    const noteLines = doc.splitTextToSize(combinedNotes, W - 2 * M - 8);
    noteLines.forEach((l) => {
      if (y + 13 > PAGE_BOTTOM) { pageNo(); doc.addPage(); page += 1; header('NOTES (CONTINUED)'); watermark(); y = 78; }
      doc.text(l, M + 2, y); doc.setDrawColor(210); doc.line(M, y + 3, W - M, y + 3); y += 13;
    });
    y += 4;
    doc.setFontSize(7); doc.setTextColor(90);
    doc.text(fitCell(`STATUS: ${card.status}   ·   ${card.statusLog.map((s) => `${s.status} ${new Date(s.at).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`).join('  →  ')}`, 130), M + 2, y);
    y += PDF_SPACING.signatureTopGap;
    ensureRoom(30, 'WORKSHOP FLOOR & QUALITY CONTROL (CONTINUED)');
    drawSignatureBlock(doc, y, 'TECHNICIAN SIGNATURE', 'FINAL QUALITY CHECK (MANAGER)', { W, M });
    pageNo();

    // ---- photos page(s) (only if any) ----
    // GLOBAL PDF FRAMEWORK (readability pass): was a hard `.slice(0, 8)` — any 9th+
    // photo was silently dropped, no page 3, nothing said so ("dynamic content...
    // large numbers of service photos" must not break the layout or lose data).
    // Also used a bare repeated "BEFORE"/"AFTER" caption regardless of count
    // ("repeated generic captions reduce professionalism"). drawPhotoGrid fixes both:
    // it paginates onto as many photo pages as actually needed, and numbers repeated
    // captions ("BEFORE 1", "BEFORE 2", ...) once there's more than one of a kind.
    const photos = [...card.photosBefore.map((p) => ['BEFORE', p]), ...card.photosAfter.map((p) => ['AFTER', p])];
    if (photos.length) {
      doc.addPage(); page += 1; header('SERVICE PHOTOS'); watermark();
      drawPhotoGrid(doc, photos, {
        x: M, y: 78, maxWidth: W - 2 * M, bottomLimit: 800,
        newPage: () => { pageNo(); doc.addPage(); page += 1; header('SERVICE PHOTOS'); watermark(); return 78; },
      });
      pageNo();
    }
  }

  async function downloadPDF(source, printAfter = false) {
    const card = source && source.jobNo ? source : cardRef.current;
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: PDF_PAGE.unit, format: PDF_PAGE.format });
    await drawJobCardDocument(doc, card);
    if (printAfter) { doc.autoPrint(); window.open(doc.output('bloburl'), '_blank'); }
    else doc.save(`${card.jobNo}.pdf`);
  }

  // Issue 3 — Print/PDF must operate on EXACTLY the records the user selected, as one
  // combined document (not N separate downloads/print dialogs, and never silently all
  // records). A hard cap keeps this a client-side, main-thread operation honest about
  // its limits: there's no background/async job queue in this app's architecture (pure
  // Firebase SPA, no server-side render worker) to hand a 3,000-card export off to, and
  // jsPDF's page-drawing is synchronous CPU work — attempting that many pages in one
  // document would both stall the tab for minutes and produce a multi-thousand-page
  // file nobody can actually use. Below the cap, cards are drawn onto ONE doc with a
  // `requestAnimationFrame` yield between each so the tab stays responsive (repaints,
  // the progress toast updates) instead of a single unbroken synchronous loop.
  const MAX_COMBINED_PDF = 150;
  const [bulkDocBusy, setBulkDocBusy] = useState(null); // { mode: 'print'|'pdf', done, total } | null
  async function downloadCombinedPDF(cards, printAfter = false) {
    if (!cards.length) { toast.error('No job cards selected. Select at least one job card to continue.'); return; }
    if (cards.length === 1) { await downloadPDF(cards[0], printAfter); return; } // identical output, keeps the SBBMC42.pdf filename convention
    if (cards.length > MAX_COMBINED_PDF) {
      toast.error(`${cards.length} job cards selected — a single ${printAfter ? 'print job' : 'PDF'} supports up to ${MAX_COMBINED_PDF}. Narrow your selection (search, status, or fewer rows) and try again.`, { duration: 7000 });
      return;
    }
    setBulkDocBusy({ mode: printAfter ? 'print' : 'pdf', done: 0, total: cards.length });
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: PDF_PAGE.unit, format: PDF_PAGE.format });
      for (let i = 0; i < cards.length; i += 1) {
        if (i > 0) doc.addPage();
        // eslint-disable-next-line no-await-in-loop -- intentionally sequential: each
        // card must finish drawing onto `doc` (and its own QR fetch resolve) before the
        // next one starts, and the yield below is what keeps the tab from freezing.
        await drawJobCardDocument(doc, cards[i]);
        setBulkDocBusy({ mode: printAfter ? 'print' : 'pdf', done: i + 1, total: cards.length });
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      const stamp = new Date().toISOString().slice(0, 10);
      if (printAfter) { doc.autoPrint(); window.open(doc.output('bloburl'), '_blank'); }
      else doc.save(`Job-Cards-${cards.length}-selected-${stamp}.pdf`);
      toast.success(`${printAfter ? 'Print dialog opened' : 'PDF downloaded'} for exactly ${cards.length} selected job card${cards.length === 1 ? '' : 's'}`);
    } finally {
      setBulkDocBusy(null);
    }
  }

  /* ================= render ================= */
  return (
    <div className={`xl:flex xl:gap-4 xl:items-start ${fullPreview ? '' : ''}`}>
      {/* -------- form column -------- */}
      <div className={`${fullPreview ? 'hidden' : ''} xl:flex-1 xl:min-w-0 space-y-4`}>
        <PageHeader title={t('page.jobcard', 'Job Card')} icon={ClipboardList} action={
          <div className="flex gap-2">
            {/* 1.1 layout review — the live PDF preview column is `hidden` below the `xl`
                breakpoint (a real laptop/tablet width, not just phones), and its own
                Download PDF button lives inside that hidden column. fullPreview already
                exists to show the preview at full width on ANY viewport — the only actual
                bug was that its own toggle button was ALSO `hidden xl:flex`, so the one
                control that unlocks it was hidden exactly when it was needed. This button
                is the reachable entry point below xl; see the matching exit toggle in the
                preview column's own header, fixed the same way. */}
            <button onClick={() => setFullPreview(true)} className="h-10 px-4 rounded-xl text-xs font-semibold bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 transition xl:hidden flex items-center gap-1.5"><FileDown size={14} /> Preview PDF</button>
            <button onClick={async () => { if (dirty.current && !await confirmDialog({ title: 'Discard the current draft?', confirmText: 'Discard', danger: true })) return; jcLease.release(); setLeasedJobNo(null); setJcViewOnly(false); applyCard(emptyCard(savedRef.current, readJcDefaults(demoMode), invoices)); setDirty(false); setCopyUndo({}); try { localStorage.removeItem(DRAFT_KEY); } catch {} }} className="h-10 px-4 rounded-xl text-xs font-semibold bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 transition">New / Clear</button>
            {!jcViewOnly && <button onClick={() => saveCard(true)} disabled={saving || !card.customer?.trim()} title="Park this job card — nothing enters the workshop queue yet" className="h-10 px-4 rounded-xl text-xs font-bold bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 active:scale-95 transition disabled:opacity-40">Save Draft</button>}
            {/* NOTE: must be () => saveCard(false), NOT onClick={saveCard}. React passes the
                click event as the first argument, which would land in `asDraft` as a truthy
                MouseEvent and silently turn every save into a draft. */}
            {!jcViewOnly && <button onClick={() => saveCard(false)} disabled={saving} className="h-10 px-5 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] active:scale-95 transition disabled:opacity-60">{saving ? 'Saving…' : 'Save Job Card'}</button>}
          </div>
        } />

        {/* Phase 1c — lease / record-status strip for the job-card form. */}
        {leasedJobNo && (
          <div className="space-y-2">
            {jcViewOnly && jcLease.status === 'held' && <EditLeaseBanner status="held" heldByEmail={jcLease.heldByEmail} />}
            {jcViewOnly && jcLease.status !== 'held' && <EditAvailableBar onEdit={claimJobCardEdit} />}
            {jcViewOnly
              ? <RecordUpdatedNotice status={jcSync.status} onAcknowledge={() => { if (jcSync.latest) applyCard(splitVehicle({ ...emptyCard(savedRef.current, readJcDefaults(demoMode), invoices), ...jcSync.latest })); jcSync.markSynced(); setDirty(false); }} />
              : <RecordConflictBanner status={jcSync.status} onReview={() => setJcReviewOpen(true)} onClose={() => { jcLease.release(); setLeasedJobNo(null); applyCard(emptyCard(savedRef.current, readJcDefaults(demoMode), invoices)); setDirty(false); }} />}
          </div>
        )}
        {jcReviewOpen && leasedJobNo && jcSync.latest && (
          <ConflictReviewDialog
            mode="review"
            title="This job card was changed by another user"
            fields={JOBCARD_CONFLICT_FIELDS}
            opened={card}
            latest={jcSync.latest}
            onUseLatest={(latest) => { setJcReviewOpen(false); jcSync.markSynced(revOf(latest)); applyCard(splitVehicle({ ...emptyCard(savedRef.current, readJcDefaults(demoMode), invoices), ...latest })); setDirty(false); }}
            onClose={() => setJcReviewOpen(false)}
          />
        )}

        <CapacityBanner
          moduleKey="jobCards" demoMode={demoMode} actorEmail={actorEmail}
          ctx={{ activeInvoiceJobNos }} refreshKey={`${savedCards.length}-${capacityRefreshTick}`}
          onCleanupComplete={onCapacityCleanup}
        />
        {/* Blocked-create path — opened when saveCard() detects a NEW card would push the
            active count over the limit. Kept as its own instance (not shared with the
            banner's internal one) so it can be triggered from the Save button's guard
            without the banner needing to be at/above warning itself yet. */}
        <CapacityCleanupModal
          open={capacityBlockedOpen} onClose={() => setCapacityBlockedOpen(false)}
          moduleKey="jobCards" demoMode={demoMode} actorEmail={actorEmail}
          ctx={{ activeInvoiceJobNos }} onComplete={() => { onCapacityCleanup?.(); setCapacityRefreshTick((n) => n + 1); }}
        />

        {/* Phase 1c — one disabled <fieldset> switches off the whole job-card form
            when this session is only a viewer (another user holds the edit lease). */}
        <fieldset disabled={jcViewOnly} style={jcViewOnly ? { border: 0, margin: 0, padding: 0, minInlineSize: 0, opacity: 0.92 } : { border: 0, margin: 0, padding: 0, minInlineSize: 0 }} className="space-y-4">
        {(() => {
          const existingInv = (invoices || []).find((iv) => iv.jobNo && card.jobNo && iv.jobNo === card.jobNo);
          const matchedCust = customers.find((c) => (card.customerId && c.id === card.customerId) || (c.name && c.name === card.customer));
          const canInvoice = ['Ready', 'Delivered', 'Closed'].includes(card.status);
          const hasCtx = card.customer || card.regNo;
          if (!hasCtx && !existingInv) return null;
          return (
            <div className="flex flex-wrap items-center gap-2">
              {matchedCust && onOpenCustomer && <button onClick={() => onOpenCustomer(matchedCust)} className="h-8 px-3 rounded-lg text-[11px] font-semibold bg-white/5 border border-white/10 text-white/75 hover:bg-white/10 flex items-center gap-1.5"><User size={12} /> View Customer</button>}
              {card.regNo && onOpenVehicle && <button onClick={() => onOpenVehicle(card.regNo)} className="h-8 px-3 rounded-lg text-[11px] font-semibold bg-white/5 border border-white/10 text-white/75 hover:bg-white/10 flex items-center gap-1.5"><Car size={12} /> View Vehicle</button>}
              {existingInv
                ? (onOpenInvoice && <button onClick={() => onOpenInvoice(existingInv)} className="h-8 px-3 rounded-lg text-[11px] font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] flex items-center gap-1.5"><IndianRupee size={12} /> View Invoice ({existingInv.invNo})</button>)
                : (canInvoice && onCreateInvoice && <button onClick={() => onCreateInvoice(card)} className="h-8 px-3 rounded-lg text-[11px] font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] flex items-center gap-1.5"><IndianRupee size={12} /> Generate Invoice</button>)}
            </div>
          );
        })()}

        <Section n={1} title="Service Intake Details">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* jobNoModeToggle is rendered TWICE: once for real in Job Card No.'s `sub`
                slot, and once again — identical markup, wrapped `invisible` — as Service
                Advisor's `sub` slot. Both fields then reserve exactly the same computed
                height above their input, so the two inputs land on the same row
                regardless of how tall this toggle happens to render. See the Field
                component's comment for why this beats a hardcoded offset. */}
            {(() => {
              const jobNoModeToggle = (
                <div className="flex flex-wrap items-center gap-3">
                  {[['auto', 'Auto Generate'], ['manual', 'Manual Entry']].map(([m, l]) => (
                    <label key={m} className="flex items-center gap-1.5 cursor-pointer text-[11px] text-white/70">
                      <input type="radio" checked={(card.jobNoMode || 'auto') === m} onChange={() => set(m === 'auto' ? { jobNoMode: 'auto', jobNo: nextJobCardNumber([...savedRef.current, ...invoices], readJcDefaults(demoMode).prefix) } : { jobNoMode: 'manual' })} className="accent-[#d4af37]" /> {l}
                    </label>
                  ))}
                </div>
              );
              return (
                <>
                  <Field label="Job Card No." error={showErr('jobNo')} errorId="err-jobNo" sub={jobNoModeToggle}>
                    {(card.jobNoMode || 'auto') === 'auto'
                      // The selected radio ("Auto Generate") already communicates the mode —
                      // a second "AUTO" badge next to the value was a redundant indicator.
                      ? <input value={card.jobNo} readOnly className={`${inputCls} opacity-70`} />
                      : <input value={card.jobNo} onChange={(e) => set({ jobNo: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 14) })} onBlur={() => touch('jobNo')} aria-invalid={!!showErr('jobNo')} aria-describedby={showErr('jobNo') ? 'err-jobNo' : undefined} placeholder="e.g. SBBMC42" className={`${inputCls} ${showErr('jobNo') ? 'border-red-500/70' : ''}`} />}
                    {(card.jobNoMode === 'manual') && (savedRef.current.some((c) => c.jobNo === card.jobNo) || invoices.some((iv) => iv.jobNo === card.jobNo)) && <p className="text-[10px] text-red-400 mt-1">Job Card Number already exists</p>}
                  </Field>
                  <Field label="Service Advisor" req sub={<div className="invisible" aria-hidden="true">{jobNoModeToggle}</div>}>
                    <input value={card.advisor} onChange={(e) => set({ advisor: e.target.value })} placeholder="e.g. Ramesh Kumar" className={inputCls} />
                  </Field>
                </>
              );
            })()}
            <Field label="Technician"><input value={card.technician || ''} onChange={(e) => set({ technician: e.target.value })} placeholder="Primary technician" className={inputCls} /></Field>
            <Field label="Helper (optional)"><input value={card.helper || ''} onChange={(e) => set({ helper: e.target.value })} placeholder="Helper / assistant" className={inputCls} /></Field>
            {/* Batch 3 Defect 2: intake and delivery are different real-world questions, so
                their shortcuts no longer share one "assume 6 PM" pattern. Intake is almost
                always "right now" (the vehicle is in front of the advisor) — the only other
                realistic case is logging a drop-off after the fact, hence "Start of Day"
                rather than the old "Today 6 PM" (an end-of-day time made no sense as a
                vehicle ARRIVAL default). Delivery scales with job complexity: Today for
                same-day routine service (the single most common promise in daily
                operations, previously missing entirely), then Tomorrow / +2 Days / +7 Days
                for standard, parts-dependent, and major repairs respectively. */}
            <Field label="Date & Time In" req><DateTimeField value={card.dateIn} onChange={(v) => set({ dateIn: v })} shortcuts={[['now', 'Now'], ['start9', 'Start of Day (9 AM)']]} /></Field>
            <Field label="Promised Delivery" req error={promisedErr}><DateTimeField value={card.promised} onChange={(v) => set({ promised: v })} min={card.dateIn} shortcuts={[['today6', 'Today'], ['tomorrow', 'Tomorrow'], ['plus2', '+2 Days'], ['plus7', '+7 Days']]} /></Field>
          </div>
        </Section>

        <Section n={2} title="Client Profile">
          {/* E2E workflow QA fix: this used to derive `make` by checking whether
              v.model (just "Swift") STARTS WITH a known make name ("Maruti Suzuki") —
              which can never match, since model and make are separate fields on the
              vehicle record. make/model always resolved to '' on every existing-customer
              link, silently leaving the required Make & Model field empty even though
              the linked vehicle had clean v.make/v.model data. Fixed to read v.make and
              v.model directly. */}
          <CustomerSearch customers={customers} onFill={(c) => { const v = (c.vehicles || [])[0] || {}; set({ customer: c.name || '', phone: c.phone || '', altPhone: c.altPhone || '', address: c.address || '', vehicle: v.vehicle || [v.make, v.model].filter(Boolean).join(' '), make: v.make || '', model: v.model || '', regNo: v.regNo || '', vin: v.vin || '', engineNo: v.engineNo || '', fuel: v.fuel || card.fuel }); toast.success(`Loaded ${c.name}`); }} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Customer Name" req error={showErr('customer')} errorId="err-customer"><input value={card.customer} onChange={(e) => set({ customer: e.target.value })} onBlur={() => touch('customer')} aria-invalid={!!showErr('customer')} aria-describedby={showErr('customer') ? 'err-customer' : undefined} placeholder="Full name" className={`${inputCls} ${showErr('customer') ? 'border-red-500/70' : ''}`} /></Field>
            <Field label="Contact Number" req error={card.phone && !isIndianMobile(card.phone) ? MOBILE_ERROR : null}><input value={card.phone} inputMode="numeric" onChange={(e) => set({ phone: e.target.value.replace(/[^\d ]/g, '').slice(0, 13) })} placeholder="10-digit mobile" className={inputCls} /></Field>
            <Field label="Alternate Number" error={card.altPhone && !isIndianMobile(card.altPhone) ? MOBILE_ERROR : null}><input value={card.altPhone} inputMode="numeric" onChange={(e) => set({ altPhone: e.target.value.replace(/[^\d ]/g, '').slice(0, 13) })} placeholder="Optional" className={inputCls} /></Field>
            <Field label="Full Address"><textarea value={card.address} onChange={(e) => set({ address: e.target.value })} rows={2} placeholder="House, street, area, city" className={`${inputCls} resize-none`} /></Field>
          </div>
        </Section>

        <Section n={3} title="Vehicle Specifications">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Make & Model" req><CascadeVehicleSelect make={card.make} model={card.model} onChange={(patch) => set(patch)} customVehicles={customVehicles} onAddVehicle={addVehicle} /></Field>
            <Field label="Registration No." req error={showErr('regNo')} errorId="err-regNo"><input value={card.regNo} onChange={(e) => set({ regNo: e.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, '').slice(0, 13) })} onBlur={() => touch('regNo')} aria-invalid={!!showErr('regNo')} aria-describedby={showErr('regNo') ? 'err-regNo' : undefined} placeholder="TS09EX1234" className={`${inputCls} ${showErr('regNo') ? 'border-red-500/70' : ''}`} /></Field>
            <Field label="VIN / Chassis No." error={vinErr}><input value={card.vin} onChange={(e) => set({ vin: e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '').slice(0, 17) })} placeholder="11–17 characters" className={inputCls} /></Field>
            <Field label="Engine No." error={engErr}><input value={card.engineNo} onChange={(e) => set({ engineNo: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 25) })} placeholder="5–25 characters" className={inputCls} /></Field>
            {/* Was a hardcoded inline array (missing LPG) instead of importing the shared
                FUELS list from lib/vehicleCatalog.js — the same drift already fixed in
                Customers/Vehicles. */}
            <Field label="Fuel Type"><MiniSelect value={card.fuel || 'Petrol'} placeholder="Fuel Type" options={FUELS} onPick={(t) => set({ fuel: t || 'Petrol' })} /></Field>
          </div>
          {(() => {
            const matched = customers.find((c) => (c.phone || '').replace(/\D/g, '') === (card.phone || '').replace(/\D/g, '') && card.phone);
            if (!matched || !card.regNo.trim() || !card.vehicle.trim()) return null;
            const onFile = (matched.vehicles || []).some((v) => (v.regNo || '').toUpperCase() === card.regNo.toUpperCase());
            if (onFile) return <p className="text-[11px] text-emerald-400/80 mt-2">✓ This vehicle is on {matched.name}’s file.</p>;
            // PHASE 10 (PH10-03) — `onFile` only looked at `matched`'s OWN vehicles, so a
            // reg no. already registered to a DIFFERENT customer could be "registered"
            // here too, creating a second ownership record for the same physical vehicle
            // with no link between the two. A reg no. is a real-world unique identifier —
            // check every customer, same invariant the Vehicles module's own wizard
            // (`dupReg`) already enforces.
            const elsewhere = customers.find((c) => c.id !== matched.id && (c.vehicles || []).some((v) => (v.regNo || '').toUpperCase() === card.regNo.toUpperCase()));
            if (elsewhere) return <p className="text-[11px] text-amber-400/80 mt-2">{card.regNo.toUpperCase()} is already registered to {elsewhere.name} — not {matched.name}. Check the registration number, or use Vehicles to reassign it.</p>;
            return (
              <button type="button" onClick={() => { onRegisterVehicle?.(matched.id, { regNo: card.regNo.toUpperCase(), model: card.vehicle, vin: card.vin, engineNo: card.engineNo, fuel: card.fuel }); toast.success(`Vehicle saved to ${matched.name}`); }} className="mt-2 h-9 px-3 rounded-lg text-[11px] font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] inline-flex items-center gap-1.5"><Plus size={13} /> Register this vehicle to {matched.name}</button>
            );
          })()}
        </Section>

        <Section n={4} title="Client Instructions & Diagnostics">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[['complaints', 'Complaint / Request'], ['diagnosis', 'Diagnosis / Technician Notes']].map(([key, label]) => (
              <div key={key}>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] uppercase tracking-wide text-white/45">{label}</p>
                  <div className="flex gap-1.5">
                    {/* JC 1.2: was complaints-only despite the UI showing complaints and
                        diagnosis as parallel, symmetric columns — diagnosis notes carry
                        over between visits just as often (e.g. a recurring noise the
                        technician already diagnosed last time). Now both columns get
                        Copy previous, and each swaps to an independent Undo once used,
                        so a copy on one column never affects the other's affordance. */}
                    {key in copyUndo ? (
                      <button type="button" onClick={() => undoCopy(key)} className="text-[10px] font-semibold text-[#d4af37] hover:text-[#e8c563] flex items-center gap-1"><Undo2 size={11} /> Undo</button>
                    ) : (
                      lastCardRef.current && (lastCardRef.current[key] || []).some(Boolean) && (
                        <button type="button" onClick={() => copyPrevious(key)} className="text-[10px] font-semibold text-white/45 hover:text-[#d4af37] flex items-center gap-1"><Copy size={11} /> Copy previous</button>
                      )
                    )}
                    <button type="button" onClick={() => set({ [key]: [...card[key], ''] })} className="text-[10px] font-bold text-[#d4af37] flex items-center gap-1"><Plus size={11} /> Add</button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {card[key].map((v, i) => (
                    <div key={`${key}-${i}`} className="flex items-center gap-1.5">
                      <span className="text-[11px] text-white/45 w-4 text-right flex-shrink-0">{i + 1}.</span>
                      <input value={v} onChange={(e) => { const arr = [...card[key]]; arr[i] = e.target.value; set({ [key]: arr }); }} placeholder={key === 'complaints' ? 'Customer complaint / request' : 'Technician diagnosis / note'} className={`${inputCls} flex-1`} />
                      {/* Batch 3 Defect 3: delete now behaves identically for every row
                          regardless of origin — typed, "+ Add"ed, or from "Copy previous"
                          (which can legitimately produce a single-row array, e.g. a repeat
                          customer whose last visit had only one complaint; that lone row
                          previously had no delete control at all since it only ever
                          appeared once length > 1). Removing the last row resets to one
                          empty placeholder — same convention as Supplier's Alternate
                          Names/Phone Numbers — rather than vanishing the section entirely. */}
                      <button type="button" onClick={() => { const next = card[key].filter((_, x) => x !== i); set({ [key]: next.length ? next : [''] }); }} className="text-red-400/50 hover:text-red-400 flex-shrink-0"><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section n={5} title="Exterior Condition & Inventory Check">
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <p className="text-[10px] uppercase tracking-wide text-white/45">Dashboard warnings on</p>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-white/45" />
                <input value={warnQ} onChange={(e) => setWarnQ(e.target.value)} placeholder="Filter…" className="pl-6 pr-2 py-1 rounded-lg text-[11px] bg-white/5 border border-white/10 text-white placeholder-white/25 outline-none w-24 focus:w-32 transition-all" />
              </div>
              <button type="button" onClick={() => set({ warnings: [...WARNINGS] })} className="text-[10px] font-semibold text-[#d4af37] hover:underline">Select All</button>
              <button type="button" onClick={() => set({ warnings: [] })} className="text-[10px] font-semibold text-white/45 hover:text-white/70">Clear All</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {WARNINGS.filter((w) => !warnQ.trim() || w.toLowerCase().includes(warnQ.trim().toLowerCase())).map((w) => <ChipToggle key={w} on={card.warnings.includes(w)} label={w} onClick={() => toggleList('warnings', w)} />)}
          </div>
          <input value={card.warningsOther} onChange={(e) => set({ warningsOther: e.target.value })} placeholder="Other warning (custom)…" className={`${inputCls} mb-4`} />

          <p className="text-[10px] uppercase tracking-wide text-white/45 mb-2">Accessories & items present <span className="normal-case text-white/45">(from your Inventory — updates automatically)</span></p>
          {card.invItems.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {card.invItems.map((n) => (
                <span key={n} className="flex items-center gap-1 pl-2 pr-1 py-1 rounded-lg text-[11px] font-semibold bg-[#d4af37]/12 text-[#d4af37] border border-[#d4af37]/25">{n}<button type="button" onClick={() => toggleList('invItems', n)}><X size={11} /></button></span>
              ))}
            </div>
          )}
          <div className="relative mb-1.5">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/45" />
            <input value={invQ} onChange={(e) => setInvQ(e.target.value)} placeholder="Search inventory items to mark as present…" className={`${inputCls} pl-9`} />
          </div>
          {invQ && (
            <div className="max-h-36 overflow-y-auto dark-scroll rounded-xl mb-2" style={{ background: 'var(--surface-2)', border: '1px solid rgba(var(--fg-rgb),0.08)' }}>
              {invNames.map((n) => (
                <button key={n} type="button" onClick={() => { toggleList('invItems', n); setInvQ(''); }} className="w-full text-left px-3 py-2 text-sm text-white/75 hover:bg-white/5">{n}</button>
              ))}
              {invNames.length === 0 && <p className="px-3 py-2 text-xs text-white/45">No inventory items match.</p>}
            </div>
          )}
          <input value={card.invOther} onChange={(e) => set({ invOther: e.target.value })} placeholder="Other item (custom)…" className={inputCls} />
        </Section>

        <Section n={6} title="Damage Notes — Vehicle Body">
          <p className="text-[10px] text-white/45 mb-2">Tap every body part with existing damage, then add a note per part.</p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {BODY_PARTS.map((p) => <ChipToggle key={p} on={card.damages.some((d) => d.part === p)} label={p} onClick={() => toggleDamage(p)} />)}
          </div>
          {card.damages.length > 0 && (
            <div className="space-y-1.5 mb-2">
              {card.damages.map((d) => (
                <div key={d.part} className="rounded-xl p-2.5" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-semibold text-[#d4af37] truncate">{d.part}</span>
                    <button type="button" onClick={() => toggleDamage(d.part)} className="text-red-400/50 hover:text-red-400"><X size={12} /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <select value={d.type || ''} onChange={(e) => setDamageField(d.part, { type: e.target.value })} className={`${inputCls} py-2 text-xs`}>
                      <option value="" style={{ background: '#141414' }}>Damage type…</option>
                      {['Scratch', 'Dent', 'Broken', 'Rust', 'Paint Damage', 'Glass Crack', 'Other'].map((t) => <option key={t} style={{ background: '#141414' }}>{t}</option>)}
                    </select>
                    <select value={d.severity || ''} onChange={(e) => setDamageField(d.part, { severity: e.target.value })} className={`${inputCls} py-2 text-xs`}>
                      <option value="" style={{ background: '#141414' }}>Severity…</option>
                      {['Minor', 'Moderate', 'Severe'].map((t) => <option key={t} style={{ background: '#141414' }}>{t}</option>)}
                    </select>
                    <input value={d.note} onChange={(e) => setDamageNote(d.part, e.target.value)} placeholder="Note (optional)" className={`${inputCls} py-2 text-xs col-span-2`} />
                  </div>
                </div>
              ))}
            </div>
          )}
          <input value={card.damageOther} onChange={(e) => set({ damageOther: e.target.value })} placeholder="Other damage (custom)…" className={inputCls} />
        </Section>

        <Section n={7} title={`Multi-Point Inspection (${inspStats.done}/${inspStats.total})`} right={
          <select value={card.inspectionTemplate || 'Major Service'} onChange={(e) => set({ inspectionTemplate: e.target.value })} className="px-2 py-1 rounded-lg text-[11px] bg-white/5 border border-white/10 text-white outline-none">
            {INSPECTION_TEMPLATE_NAMES.map((t) => <option key={t} style={{ background: '#141414' }}>{t}</option>)}
          </select>
        }>
          {(() => {
            const tmpl = new Set(INSPECTION_TEMPLATES[card.inspectionTemplate] || ALL_INSPECTION);
            const groups = Object.entries(INSPECTION).map(([g, items]) => [g, items.filter((it) => tmpl.has(it))]).filter(([, items]) => items.length);
            return (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full transition-all" style={{ width: `${inspStats.total ? (inspStats.done / inspStats.total) * 100 : 0}%`, background: 'linear-gradient(90deg,#d4af37,#aa801e)' }} /></div>
                  <span className="text-[10px] text-white/45">{inspStats.total ? Math.round((inspStats.done / inspStats.total) * 100) : 0}%</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {groups.map(([group, items]) => {
                    const customs = (card.inspectionCustom && card.inspectionCustom[group]) || [];
                    const allKeys = [...items, ...customs.map((c) => `${group}::${c}`)];
                    const allOn = allKeys.length && allKeys.every((k) => card.inspection[k]);
                    const setGroup = (on) => { const next = { ...card.inspection }; allKeys.forEach((k) => { next[k] = on; }); set({ inspection: next }); };
                    return (
                      <div key={group}>
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-[#d4af37]">{group}</p>
                          <div className="flex gap-1.5">
                            <button type="button" onClick={() => setGroup(true)} className="text-[9px] font-semibold text-white/45 hover:text-[#d4af37]">All</button>
                            <span className="text-white/20 text-[9px]">·</span>
                            <button type="button" onClick={() => setGroup(false)} className="text-[9px] font-semibold text-white/45 hover:text-[#d4af37]">None</button>
                          </div>
                        </div>
                        <div className="space-y-1">
                          {items.map((it) => (
                            <label key={it} className="flex items-center gap-2 cursor-pointer select-none py-0.5">
                              <input type="checkbox" checked={!!card.inspection[it]} onChange={() => set({ inspection: { ...card.inspection, [it]: !card.inspection[it] } })} className="accent-[#d4af37] w-3.5 h-3.5 flex-shrink-0" />
                              <span className="text-xs text-white/70">{it}</span>
                            </label>
                          ))}
                          {customs.map((c) => {
                            const key = `${group}::${c}`;
                            return (
                              <label key={key} className="flex items-center gap-2 cursor-pointer select-none py-0.5 group/ci">
                                <input type="checkbox" checked={!!card.inspection[key]} onChange={() => set({ inspection: { ...card.inspection, [key]: !card.inspection[key] } })} className="accent-[#d4af37] w-3.5 h-3.5 flex-shrink-0" />
                                <span className="text-xs text-white/70 flex-1">{c} <span className="text-[9px] text-[#d4af37]/60">custom</span></span>
                                <button type="button" onClick={(e) => { e.preventDefault(); const cc = { ...(card.inspectionCustom || {}) }; cc[group] = (cc[group] || []).filter((x) => x !== c); const ins = { ...card.inspection }; delete ins[key]; set({ inspectionCustom: cc, inspection: ins }); }} className="text-white/45 hover:text-red-400 opacity-0 group-hover/ci:opacity-100"><X size={11} /></button>
                              </label>
                            );
                          })}
                          <CustomInspItem onAdd={(name) => { const cc = { ...(card.inspectionCustom || {}) }; const list = cc[group] || []; if (!list.some((x) => x.toLowerCase() === name.toLowerCase())) { cc[group] = [...list, name]; set({ inspectionCustom: cc, inspection: { ...card.inspection, [`${group}::${name}`]: true } }); } }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </Section>

        <Section n={8} title="Photos">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[['photosBefore', 'Before Service'], ['photosAfter', 'After Service']].map(([key, label]) => (
              <div key={key} onDragOver={(e) => e.preventDefault()} onDrop={onDrop(key)}>
                <p className="text-[10px] uppercase tracking-wide text-white/45 mb-1.5">{label} <span className="text-white/45 normal-case">(drag & drop, or tap to shoot)</span></p>
                <div className="flex flex-wrap gap-2">
                  {card[key].map((img, i) => (
                    <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden" style={{ border: '1px solid rgba(var(--fg-rgb),0.1)' }}>
                      <img src={img} alt="" className="w-full h-full object-cover" />
                      <button type="button" onClick={() => set({ [key]: card[key].filter((_, x) => x !== i) })} className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center"><X size={10} /></button>
                    </div>
                  ))}
                  <label className="w-16 h-16 rounded-lg flex flex-col items-center justify-center cursor-pointer text-white/45 hover:text-white/70 transition" style={{ border: '1px dashed rgba(var(--fg-rgb),0.2)' }}>
                    <Camera size={16} /><span className="text-[9px] mt-0.5">Add</span>
                    <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => { addPhotos(key, e.target.files); e.target.value = ''; }} />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section n={9} title="Notes">
          <div className="flex gap-1 mb-2 flex-wrap">
            {[['notes', 'Internal'], ['customerNote', 'Customer'], ['technicianNote', 'Technician'], ['billingNote', 'Billing']].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setNoteTab(k)} className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${noteTab === k ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]' : 'text-white/55 bg-white/5 border border-white/10 hover:bg-white/10'}`}>{l}</button>
            ))}
          </div>
          <textarea value={card[noteTab] || ''} onChange={(e) => set({ [noteTab]: e.target.value.slice(0, 500) })} rows={3} placeholder={noteTab === 'customerNote' ? 'Notes shown to the customer / on invoice…' : noteTab === 'technicianNote' ? 'Technician working notes…' : noteTab === 'billingNote' ? 'Notes for billing / accounts…' : 'Internal notes (staff only)…'} className={`${inputCls} resize-none`} />
          <p className="text-right text-[10px] text-white/45 mt-1">{(card[noteTab] || '').length} / 500</p>

          {/* Part 3 — append-only note history. The free-text fields above are unchanged;
              this adds a running log without ever overwriting a previous note. */}
          <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.06)' }}>
            <div className="flex items-center gap-2 mb-2">
              <input value={noteEntry} onChange={(e) => setNoteEntry(e.target.value.slice(0, 300))} onKeyDown={(e) => { if (e.key === 'Enter' && noteEntry.trim()) { e.preventDefault(); const cat = { notes: 'Internal', customerNote: 'Customer', technicianNote: 'Technician', billingNote: 'Billing' }[noteTab] || 'Internal'; set({ notesLog: [...(card.notesLog || []), { at: Date.now(), by: demoMode ? 'Demo User' : (card.advisor || 'Staff'), category: cat, content: noteEntry.trim() }] }); setNoteEntry(''); } }} placeholder="Add a timestamped note & press Enter…" className={`${inputCls} py-2 flex-1`} />
              <button type="button" onClick={() => { if (!noteEntry.trim()) return; const cat = { notes: 'Internal', customerNote: 'Customer', technicianNote: 'Technician', billingNote: 'Billing' }[noteTab] || 'Internal'; set({ notesLog: [...(card.notesLog || []), { at: Date.now(), by: demoMode ? 'Demo User' : (card.advisor || 'Staff'), category: cat, content: noteEntry.trim() }] }); setNoteEntry(''); }} className="h-9 px-3 rounded-lg text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] flex items-center gap-1"><Plus size={12} /> Add</button>
            </div>
            {(card.notesLog || []).length > 0 && (
              <>
                <button type="button" onClick={() => setNotesLogOpen((o) => !o)} aria-expanded={notesLogOpen} className="text-[11px] font-semibold text-white/55 hover:text-white flex items-center gap-1 mb-1.5"><ChevronDown size={13} className={`transition-transform ${notesLogOpen ? 'rotate-180' : ''}`} /> Note history ({(card.notesLog || []).length}){notesLogOpen ? '' : ' — newest first'}</button>
                {notesLogOpen && (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto dark-scroll">
                    {[...(card.notesLog || [])].reverse().map((n, x) => (
                      <div key={x} className="px-3 py-2 rounded-xl" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                        <p className="text-xs text-white/80 whitespace-pre-wrap">{n.content}</p>
                        <p className="text-[10px] text-white/45 mt-0.5">{new Date(n.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {n.by || '—'} · <span className="text-[#d4af37]/70">{n.category}</span></p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </Section>

        <Section n={10} title="Parts Reservation" right={<span className="text-[10px] text-white/45">reserves live inventory stock</span>}>
          <p className="text-[11px] text-white/45 mb-2">Add parts this job will consume. Saving the card reserves them in Inventory; cancelling or closing the card releases the reservation automatically.</p>
          <div className="relative mb-1.5">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/45" />
            <input value={partQ} onChange={(e) => setPartQ(e.target.value)} placeholder="Search parts by name, SKU, OEM, barcode…" className={`${inputCls} pl-9`} />
          </div>
          {partQ && (
            <div className="max-h-64 overflow-y-auto dark-scroll rounded-xl mb-2" style={{ background: 'var(--surface-2)', border: '1px solid rgba(var(--fg-rgb),0.08)' }}>
              {partMatches.map((p) => {
                const avail = Math.max(0, (p.stock || 0) - (p.reserved || 0));
                const already = (card.parts || []).some((x) => x.partId === p.id);
                return (
                  <button key={p.id} type="button" disabled={already} onClick={() => { set({ parts: [...(card.parts || []), { partId: p.id, name: p.name, qty: 1, rate: Number(p.defaultSellingPrice || p.sellingPrice || 0) }] }); setPartQ(''); }} className={`w-full text-left px-3 py-2 flex justify-between items-center ${already ? 'opacity-40' : 'hover:bg-white/5'}`}>
                    <span className="text-sm text-white/80">{p.name} {p.sku ? <span className="text-white/45 text-[10px]">· {p.sku}</span> : null}</span>
                    <span className={`text-[10px] font-semibold ${avail > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{avail} avail</span>
                  </button>
                );
              })}
              {partMatches.length === 0 && <p className="px-3 py-2 text-xs text-white/45">No parts match.</p>}
              {allPartMatches.length > partMatches.length && (
                <p className="px-3 py-1.5 text-[10px] text-amber-300/80" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.08)' }}>
                  Showing {partMatches.length} of {allPartMatches.length} matches — refine your search.
                </p>
              )}
            </div>
          )}
          {(card.parts || []).length > 0 && (
            <div className="space-y-1.5">
              {card.parts.map((p, i) => {
                const avail = availableOf(p.partId) + (Number(p.qty) || 0); // add back this card's own hold for display
                const over = (Number(p.qty) || 0) > avail;
                return (
                  <div key={p.partId || i} className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                    <span className="flex-1 text-sm text-white/85 min-w-0 truncate">{p.name}</span>
                    <span className={`text-[10px] ${over ? 'text-red-400' : 'text-white/45'}`}>{avail} avail</span>
                    <input value={p.qty} inputMode="numeric" onChange={(e) => { const q = e.target.value.replace(/\D/g, ''); set({ parts: card.parts.map((x, xi) => (xi === i ? { ...x, qty: q } : x)) }); }} className={`w-14 py-1.5 text-center rounded-lg text-xs bg-white/5 border ${over ? 'border-red-500/50' : 'border-white/10'} text-white outline-none`} />
                    <button type="button" onClick={() => set({ parts: card.parts.filter((_, xi) => xi !== i) })} className="text-red-400/50 hover:text-red-400"><Trash2 size={13} /></button>
                  </div>
                );
              })}
              <p className="text-[10px] text-white/45 pt-0.5">These quantities move to <span className="text-white/50">Reserved</span> in Inventory when you save, and are released back once the card is marked <span className="text-white/50">Delivered</span> (or Closed / Cancelled).</p>
            </div>
          )}
        </Section>

        <Section n={11} title="Labour & Services" right={<button type="button" onClick={() => set({ labour: [...(card.labour || []), { id: `lb_${Date.now()}`, service: '', hours: '', rate: '', tech: '', notes: '' }] })} className="text-[10px] font-bold text-[#d4af37] flex items-center gap-1"><Plus size={11} /> Add Labour</button>}>
          {(card.labour || []).length === 0 && <p className="text-xs text-white/45 py-2">No labour lines yet. Click “Add Labour” to log services performed.</p>}
          <div className="space-y-2">
            {(card.labour || []).map((lb, i) => {
              const setLb = (patch) => set({ labour: card.labour.map((x) => (x.id === lb.id ? { ...x, ...patch } : x)) });
              const amt = (Number(lb.hours) || 0) * (Number(lb.rate) || 0);
              return (
                <div key={lb.id} className="rounded-xl p-2.5" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-[11px] text-white/45 w-4 flex-shrink-0">{i + 1}.</span>
                    <input value={lb.service} onChange={(e) => setLb({ service: e.target.value })} placeholder="Service / labour name" className={`${inputCls} flex-1 py-2`} />
                    <button type="button" onClick={() => set({ labour: card.labour.filter((x) => x.id !== lb.id) })} className="text-red-400/50 hover:text-red-400 flex-shrink-0"><Trash2 size={13} /></button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pl-5">
                    <input value={lb.hours} inputMode="decimal" onChange={(e) => setLb({ hours: e.target.value.replace(/[^\d.]/g, '') })} placeholder="Hours" className={`${inputCls} py-2 text-xs`} />
                    <input value={lb.rate} inputMode="numeric" onChange={(e) => setLb({ rate: e.target.value.replace(/\D/g, '') })} placeholder="Rate ₹/hr" className={`${inputCls} py-2 text-xs`} />
                    <input value={lb.tech} onChange={(e) => setLb({ tech: e.target.value })} placeholder="Technician" className={`${inputCls} py-2 text-xs`} />
                    <div className="flex items-center justify-end px-2 text-xs font-bold text-[#d4af37]">₹{amt.toLocaleString('en-IN')}</div>
                  </div>
                </div>
              );
            })}
          </div>
          {(card.labour || []).length > 0 && (
            <div className="flex justify-end mt-2 text-xs font-bold text-white/80">Total Labour: ₹{(card.labour || []).reduce((s, lb) => s + (Number(lb.hours) || 0) * (Number(lb.rate) || 0), 0).toLocaleString('en-IN')}</div>
          )}
        </Section>

        <Section n={12} title="Job Status" right={<span className="text-[10px] text-white/45">{isAdmin ? 'Admin: free movement' : 'Sequential workflow'}</span>}>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {STATUSES.map((s, i) => {
              const cur = STATUSES.indexOf(card.status);
              const reached = i <= cur && card.status !== 'Cancelled';
              const active = s === card.status;
              const col = statusColor(s);
              return (
                <button key={s} type="button" onClick={() => setStatus(s)} className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition active:scale-95" style={active ? { background: col, color: '#111' } : reached ? { background: `${col}1f`, color: col, border: `1px solid ${col}40` } : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.45)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  {reached && !active ? '✓ ' : ''}{s}
                </button>
              );
            })}
          </div>
          <div className="space-y-1">
            {card.statusLog.map((l, i) => (
              <p key={i} className="text-[11px] text-white/45"><span className="font-semibold" style={{ color: statusColor(l.status) }}>{l.status}</span> · {new Date(l.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}{l.by ? ` · ${l.by}` : ''}</p>
            ))}
          </div>
        </Section>

        {savedCards.length > 0 && (
          <div className="rounded-2xl p-4" style={cardStyle}>
            <h3 className="text-xs font-bold text-white/70 uppercase tracking-wide mb-2">Saved Job Cards ({savedCards.length})</h3>
            {(() => {
              // COLOR SYSTEM REVIEW: these tiles double as status FILTERS (clicking one
              // filters the list to that status) — exactly the "filters/dropdowns" surface
              // Section 16 requires to match the Job Card table/detail/Reports colors, but
              // each one had its own independently-picked hex instead of the shared
              // statusColor() map. The concrete bug this caused: 'Cancelled' rendered RED
              // here while every badge/Reports-chart elsewhere renders it MUTED (a
              // deliberately-resolved conflict — see STATUS_COLOR's own comment in
              // constants/ui.js) — the same status told two different stories depending on
              // which screen you were looking at. 'Open' (an aggregate of every in-progress
              // status, not a single real status) is this row's one headline figure → gold.
              // 'DeliveredToday' isn't a literal status either (it's "Delivered" scoped to
              // today) → info, matching Vehicles' own "Today's Deliveries" tile. The other
              // five map onto their real status via the same statusColor() every badge and
              // the Reports donut charts already use.
              const KPI_DEFS = [
                ['Open', 'Open Jobs', kpis.Open, SEMANTIC.gold],
                ['Inspection', 'Inspection', kpis.Inspection, statusColor('Inspection')],
                ['Waiting Parts', 'Waiting Parts', kpis['Waiting Parts'], statusColor('Waiting Parts')],
                ['Repair', 'Repair', kpis.Repair, statusColor('Repair Started')],
                ['Ready', 'Ready', kpis.Ready, statusColor('Ready')],
                ['DeliveredToday', 'Delivered Today', kpis.DeliveredToday, SEMANTIC.info],
                ['Cancelled', 'Cancelled', kpis.Cancelled, statusColor('Cancelled')],
              ];
              return (
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-3">
                  {KPI_DEFS.map(([key, label, val, color]) => {
                    const on = kpiFilter === key;
                    return (
                      // 1.3 — kpiFilter and savedStatusF (the dropdown below) are two UI
                      // affordances over the SAME underlying "which statuses are showing"
                      // question, not two independent filter dimensions. Picking a KPI tile
                      // must clear the dropdown's own state too — otherwise "All Statuses"
                      // in the dropdown can silently coexist with a still-active kpiFilter,
                      // which is exactly the "All Statuses shows no data" bug: the dropdown
                      // LOOKED reset but the list was still gated by the invisible sibling.
                      <button key={key} type="button" onClick={() => { setKpiFilter((f) => (f === key ? null : key)); setSavedStatusF('All'); }} aria-pressed={on}
                        className={`text-left rounded-xl p-2.5 transition ${on ? '' : 'hover:bg-white/[0.05]'}`}
                        style={{ background: on ? `${color}1f` : 'rgba(var(--fg-rgb),0.03)', border: `1px solid ${on ? color + '80' : 'rgba(var(--fg-rgb),0.06)'}` }}>
                        <p className="text-lg font-bold tabular-nums" style={{ color }}>{val}</p>
                        <p className="text-[9px] uppercase tracking-wide text-white/45 leading-tight truncate">{label}</p>
                      </button>
                    );
                  })}
                </div>
              );
            })()}
            {/* ROOT CAUSE of "the search bar shifts while typing": this button's condition
                included `savedQ` (the search text) directly, so it mounted/unmounted on
                the very FIRST keystroke and every backspace-to-empty — appearing or
                disappearing ABOVE the search bar and pushing it (and everything below)
                down or up on every character. Kept ALWAYS in the layout now (so its
                height is always reserved) and toggled with `invisible` instead of
                conditional rendering — `visibility:hidden` removes it from view and from
                the tab order without removing its box from the flow, so nothing around it
                ever reflows while searching/filtering/clearing. */}
            <button
              onClick={() => { setKpiFilter(null); setSavedStatusF('All'); setSavedQ(''); }}
              tabIndex={(kpiFilter || savedStatusF !== 'All' || savedQ) ? 0 : -1}
              aria-hidden={!(kpiFilter || savedStatusF !== 'All' || savedQ)}
              className={`text-[11px] font-semibold text-[#d4af37] hover:underline mb-2 ${(kpiFilter || savedStatusF !== 'All' || savedQ) ? 'visible' : 'invisible pointer-events-none'}`}
            >
              Clear Filters
            </button>
            {selectedJobs.size > 0 && (() => {
              // JC 1.4: the badge must never claim a count the buttons beside it don't
              // actually act on. hiddenCount surfaces the other half of that same "no
              // invisible selections" complaint: it's fine for a selection to persist
              // across a filter change (that's a deliberate cross-filter bulk-pick, same
              // as Inventory Parts), but the owner must be told when some of what they're
              // about to act on isn't the list they're currently looking at, rather than
              // finding out after the fact. Shared with every other module's bulk bar —
              // see lib/selectionScope.js.
              const selectedArr = [...selectedJobs];
              const hiddenCount = countHiddenSelections(selectedJobs, savedList, (j) => j.jobNo);
              const invoicedSelectedCount = selectedArr.filter((jn) => invoicedJobNos.has(jn)).length;
              // Issue 3 — resolved from the FULL selection (same fix as the earlier
              // Print/PDF scope bug), never from savedList: the document scope must equal
              // the selection scope exactly, including anything hidden by the current
              // filter — see the badge above, which already tells the owner so.
              const selectedCards = resolveSelectedRecords(selectedJobs, savedCards, (jc) => jc.jobNo);
              return (
                <div className="flex flex-wrap items-center gap-2 mb-2.5 px-3 py-2 rounded-xl" style={{ background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.25)' }}>
                  <span className="text-[11px] font-semibold text-[#d4af37]">{selectedJobs.size} selected{hiddenCount > 0 ? ` (${hiddenCount} not shown by current filters)` : ''}</span>
                  {bulkDocBusy && <span className="text-[11px] text-white/50">Generating {bulkDocBusy.mode === 'print' ? 'print job' : 'PDF'} — {bulkDocBusy.done}/{bulkDocBusy.total}…</span>}
                  <div className="flex-1" />
                  <button disabled={!!bulkDocBusy} onClick={() => downloadCombinedPDF(selectedCards, true)} className="h-8 px-2.5 rounded-lg text-[11px] font-semibold bg-white/5 border border-white/10 text-white/75 hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none flex items-center gap-1"><Printer size={12} /> Print</button>
                  <button disabled={!!bulkDocBusy} onClick={() => downloadCombinedPDF(selectedCards, false)} className="h-8 px-2.5 rounded-lg text-[11px] font-semibold bg-white/5 border border-white/10 text-white/75 hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none flex items-center gap-1"><FileDown size={12} /> PDF</button>
                  {canManage && <button onClick={async () => {
                    if (demoMode && !demoCanDelete) { notify.permissionDenied('This action has been disabled by the administrator.'); return; }
                    const n = selectedJobs.size;
                    const message = invoicedSelectedCount > 0
                      ? `This cannot be undone. ${invoicedSelectedCount} of these ${invoicedSelectedCount === 1 ? 'has' : 'have'} a linked invoice — deleting won't remove the invoice, but it will no longer be able to open its source job card.`
                      : 'This cannot be undone.';
                    if (await confirmDialog({ title: `Delete ${n} job card${n === 1 ? '' : 's'}?`, message, danger: true, confirmText: 'Delete' })) {
                      // Universal Notification Architecture review — this used to toast
                      // "deleted" the instant the click handler ran, before (and
                      // regardless of whether) the Firestore write behind onDelete
                      // actually succeeded. deleteJobCard returns the real persistence
                      // promise; await every one (Promise.allSettled, same pattern as
                      // Billing's bulkDelete) so the toast reflects the real outcome,
                      // including a partial-failure count if some writes reject.
                      const results = await Promise.allSettled(selectedArr.map((jn) => onDelete?.(jn)));
                      const failed = results.filter((r) => r.status === 'rejected').length;
                      clearSelection();
                      if (failed) toast.error(`Deleted ${n - failed} of ${n} — ${failed} failed.`);
                      else notify.deleted(`${n} job card${n === 1 ? '' : 's'} deleted`);
                    }
                  }} className="h-8 px-2.5 rounded-lg text-[11px] font-semibold bg-red-500/10 border border-red-500/25 text-red-400 hover:bg-red-500/20 flex items-center gap-1"><Trash2 size={12} /> Delete</button>}
                  <button onClick={clearSelection} className="h-8 px-2.5 rounded-lg text-[11px] font-semibold bg-white/5 border border-white/10 text-white/60 hover:bg-white/10">Clear</button>
                </div>
              );
            })()}
            <div className="flex flex-col sm:flex-row gap-2 mb-2.5">
              <div className="relative flex-1">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/45" />
                <input value={savedQ} onChange={(e) => setSavedQ(e.target.value)} placeholder="Search job no., customer, phone, vehicle, reg, VIN, advisor…" className={`${inputCls} pl-9 py-2`} />
              </div>
              {/* 1.3 — was a plain native <select>: the browser's own option-list styling
                  (large per-row padding, no max-height/scroll control) is exactly why it
                  rendered oversized for 14 options. MiniSelect is the app's one dropdown
                  primitive (compact rows, MAX_PANEL_H + internal scroll, portal-positioned
                  so it can't clip near a sticky header or the viewport edge) — reused here
                  rather than hand-tuning a second implementation. Picking a status here
                  also clears kpiFilter — see the KPI tile handler above for why that
                  sibling-state clear is required, not optional. */}
              <div className="sm:w-40">
                <MiniSelect value={savedStatusF === 'All' ? 'All Statuses' : savedStatusF} options={['All Statuses', ...STATUSES]} onPick={(v) => { setSavedStatusF(v === 'All Statuses' ? 'All' : (v || 'All')); setKpiFilter(null); }} inputCls={`${inputCls} py-2`} />
              </div>
            </div>
            {(() => {
              // ISSUE 6: this whole pipeline used to live INSIDE the JSX — an IIFE, so it
              // copied, filtered, rebuilt a haystack per card and RE-SORTED the entire
              // job-card list on EVERY RENDER of the module, not merely on every
              // keystroke. It is now memoized above (savedList) and keyed only on the
              // things that actually change it.
              const list = savedList;
              const visible = list.slice(0, savedLimit);
              return (
                <>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] text-white/45">{list.length} job card{list.length === 1 ? '' : 's'}{list.length > savedLimit ? ` · showing ${savedLimit}` : ''}</span>
                  {list.length > 0 && (() => {
                    const allShownSelected = visible.length > 0 && visible.every((j) => selectedJobs.has(j.jobNo));
                    // JC 1.4: plain "Select all" was ambiguous against three different
                    // scopes an owner could reasonably mean — the loaded batch, the full
                    // filtered result set (e.g. 201 "Open" cards when only 20 are loaded),
                    // or literally every job card ever created. The checkbox can only ever
                    // reach the batch currently rendered (matches Inventory Parts' own
                    // "Select all on page" convention), so it now says so explicitly. When
                    // more filtered results exist beyond that batch, a second, deliberate
                    // action lets the owner explicitly widen the scope instead of the
                    // checkbox silently doing it for them.
                    return (
                      <div className="flex items-center gap-2">
                        {allShownSelected && list.length > visible.length && (
                          <button type="button" onClick={() => setSelectedJobs((s) => { const n = new Set(s); list.forEach((j) => n.add(j.jobNo)); return n; })} className="text-[11px] font-semibold text-[#d4af37] hover:underline">
                            Select all {list.length} matching
                          </button>
                        )}
                        <label className="flex items-center gap-1.5 text-[11px] text-white/45 cursor-pointer">
                          <input type="checkbox" aria-label={`Select all ${visible.length} shown job cards`}
                            checked={allShownSelected}
                            onChange={(e) => setSelectedJobs((s) => { const n = new Set(s); if (e.target.checked) visible.forEach((j) => n.add(j.jobNo)); else visible.forEach((j) => n.delete(j.jobNo)); return n; })}
                            className="accent-[#d4af37]" /> Select all {visible.length} shown
                        </label>
                      </div>
                    );
                  })()}
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto dark-scroll">
                  {visible.map((jc, i) => (
                    <div key={jc.jobNo || i} className={`flex flex-wrap items-center gap-2.5 px-3 py-2.5 rounded-xl ${selectedJobs.has(jc.jobNo) ? 'ring-1 ring-[#d4af37]/40' : ''}`} style={{ background: 'rgba(var(--fg-rgb),0.02)' }}>
                      <input type="checkbox" checked={selectedJobs.has(jc.jobNo)} onChange={() => toggleJob(jc.jobNo)} aria-label={`Select ${jc.jobNo}`} className="accent-[#d4af37] flex-shrink-0" />
                      {/* min-w-0 on the flex row + flex-1/min-w-0 on the customer/vehicle span:
                          without it, flex items default to min-width:auto and refuse to shrink,
                          so truncate() never actually engaged — a long customer name or vehicle
                          just pushed the whole row wider than its container instead of eliding,
                          which is what read as "overlapping" against the Badge/action buttons
                          that always claim their own space (flex-shrink-0). Job Card No. stays
                          fully visible (fixed-shrink, it's the primary identifier); the customer
                          · vehicle text is what elides now.
                          Mobile QA fix: at phone widths, checkbox + Badge + the 4 flex-shrink-0
                          action icons already claimed the row's full ~280px on their own —
                          nothing was left for this flex-1 min-w-0 button, which was squeezed to
                          a true 0px and forced its text to wrap one character per line. flex-wrap
                          on the row (so Badge + action icons can drop to their own line) fixed
                          it inconsistently row-to-row — min-w-0 still let the flex-shrink
                          algorithm treat this button's hypothetical size as ~0 when deciding
                          whether to wrap at all, so some rows never triggered a wrap in the
                          first place. Dropping min-w-0 here too (its min-width now follows its
                          real content, same fix as the Customers/Vehicles toolbar) makes every
                          row wrap consistently instead of only some of them. */}
                      <button type="button" onClick={() => setPreviewCard(jc)} className="flex-1 text-left">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: statusColor(jc.status) }} />
                          <span className="text-sm text-white/85 font-medium flex-shrink-0">{jc.jobNo}</span>
                          <span className="text-[11px] text-white/45 truncate min-w-0 flex-1">· {jc.customer || '—'} · {jc.vehicle || '—'}</span>
                        </span>
                        <span className="block text-[10px] text-white/45 mt-1 pl-3.5">
                          {jc.dateIn ? `In ${fmtDate(jc.dateIn)}` : ''}{jc.promised ? ` · Due ${fmtDate(jc.promised)}` : ''}{jc.savedAt ? ` · Updated ${new Date(jc.savedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : ''}
                        </span>
                      </button>
                      <Badge status={jc.status} className="flex-shrink-0" />
                      <div className="flex gap-1.5 flex-shrink-0">
                        <button onClick={() => setPreviewCard(jc)} title="Preview" aria-label={`Preview ${jc.jobNo}`} className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/55 hover:bg-white/10"><Eye size={12} /></button>
                        <button onClick={() => loadCard(jc)} title="Edit" aria-label={`Edit ${jc.jobNo}`} className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/55 hover:bg-white/10"><Edit3 size={12} /></button>
                        <button onClick={() => downloadPDF(jc, false)} title="Download PDF" aria-label={`Download ${jc.jobNo}`} className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/55 hover:bg-white/10"><FileDown size={12} /></button>
                        <div className="relative">
                          <button ref={rowMenuAnchorRef(jc.jobNo || i)} onClick={(e) => { e.stopPropagation(); setRowMenu(rowMenu === (jc.jobNo || i) ? null : (jc.jobNo || i)); }} title="More actions" aria-haspopup="menu" aria-expanded={rowMenu === (jc.jobNo || i)} className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/55 hover:bg-white/10"><MoreVertical size={12} /></button>
                          {rowMenu === (jc.jobNo || i) && (
                            <ActionMenu anchorRef={rowMenuAnchorRef(jc.jobNo || i)} open onClose={() => setRowMenu(null)} items={[
                              { type: 'item', label: 'Duplicate', icon: Copy, onClick: () => duplicateCard(jc) },
                              { type: 'item', label: 'Print', icon: Printer, onClick: () => downloadPDF(jc, true) },
                              canManage && {
                                type: 'item', label: 'Delete', icon: Trash2, danger: true, onClick: async () => {
                                  if (demoMode && !demoCanDelete) { notify.permissionDenied('This action has been disabled by the administrator.'); return; }
                                  // Same dependency warning as the bulk-delete path below —
                                  // one job card is still one instance of the same class of
                                  // problem (an invoice can reference this jobNo).
                                  const message = invoicedJobNos.has(jc.jobNo)
                                    ? 'This cannot be undone. This job card has a linked invoice — deleting it won\'t remove the invoice, but it will no longer be able to open its source job card.'
                                    : 'This cannot be undone.';
                                  if (await confirmDialog({ title: `Delete job card ${jc.jobNo}?`, message, danger: true, confirmText: 'Delete' })) {
                                    // Same premature-success fix as the bulk delete above — wait
                                    // for the real persistence promise before confirming success.
                                    try { await onDelete?.(jc.jobNo); notify.deleted('Job card deleted'); } catch (e) { toast.error('Could not delete this job card. Check your connection and try again.'); }
                                  }
                                },
                              },
                            ]} />
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {list.length === 0 && <p className="text-xs text-white/45 text-center py-4">No job cards match your search.</p>}
                  {list.length > savedLimit && <button onClick={() => setSavedLimit((n) => n + 20)} className="w-full py-2 rounded-xl text-xs font-semibold bg-white/5 border border-white/10 text-white/70 hover:bg-white/10">Show more ({list.length - savedLimit} more)</button>}
                </div>
                </>
              );
            })()}
          </div>
        )}

        {statusConfirm && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setStatusConfirm(null)}>
            <div ref={statusConfirmRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Confirm status change" onKeyDown={(e) => { if (e.key === 'Escape') setStatusConfirm(null); }} className="w-full max-w-sm rounded-2xl p-5 outline-none" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
              <h4 className="text-sm font-bold text-white mb-3">Change status?</h4>
              <div className="flex items-center gap-2 text-xs mb-3">
                <span className="px-2 py-1 rounded-lg font-semibold" style={{ background: `${statusColor(statusConfirm.from)}1f`, color: statusColor(statusConfirm.from) }}>{statusConfirm.from}</span>
                <span className="text-white/45">→</span>
                <span className="px-2 py-1 rounded-lg font-semibold" style={{ background: `${statusColor(statusConfirm.to)}1f`, color: statusColor(statusConfirm.to) }}>{statusConfirm.to}</span>
              </div>
              <p className="text-[11px] text-white/50 mb-3">
                {statusConfirm.to === 'Cancelled' ? 'Cancelling releases any reserved parts and marks the job as not completed. This is recorded in the status history.'
                  : statusConfirm.to === 'Closed' ? 'Closing finalises the job card. Further edits should go through a new card or a reopen.'
                  : 'This moves the job backwards in the workflow. The change is recorded in the status history.'}
              </p>
              <label className="block text-[10px] uppercase tracking-wide text-white/45 mb-1">Reason (optional)</label>
              <textarea value={statusConfirm.reason} onChange={(e) => setStatusConfirm((s) => ({ ...s, reason: e.target.value }))} rows={2} placeholder="e.g. customer declined estimate" className={`${inputCls} resize-none mb-4`} />
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setStatusConfirm(null)} className="h-10 rounded-xl text-xs font-bold bg-white/5 border border-white/10 text-white/80">Cancel</button>
                <button type="button" onClick={() => { applyStatus(statusConfirm.to, statusConfirm.reason.trim()); const label = statusConfirm.to; setStatusConfirm(null); toast.success(`Status changed to ${label}`); }} className="h-10 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">Confirm</button>
              </div>
            </div>
          </div>
        )}
        </fieldset>
        {previewCard && createPortal((
          // ROOT CAUSE of "the SBBMC… header + Close (X) sit below the app chrome
          // instead of at the panel's own top": this drawer used to render inline,
          // nested inside <main> (InventoryDashboard.js — `relative z-10`, a real
          // stacking context). Its `fixed inset-0 z-[120]` was therefore compared at
          // <main>'s z-10 — which loses to the app's demo banner (z-[90]) and mobile
          // bottom-nav (z-[80]) that live OUTSIDE <main> — so the whole overlay,
          // header included, painted underneath them. The internal flex layout
          // (flex-shrink-0 header + flex-1 overflow-y-auto body) was already correct.
          // Fix = portal to document.body so the overlay escapes <main>'s context and
          // its z-[120] genuinely wins — the same fix already used for CustomerWizard,
          // the Add-Vehicle modal and LedgerPage in this codebase.
          <div className="fixed inset-0 z-[120] flex justify-end" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setPreviewCard(null)}>
            <div className="w-full max-w-md h-full flex flex-col" style={{ background: 'var(--surface-1)', borderLeft: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
              {/* Fixed header — job number, status and Close stay pinned while the body scrolls */}
              <div className="flex-shrink-0 flex items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)', background: 'var(--surface-1)' }}>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-white truncate">{previewCard.jobNo}</h3>
                  {previewCard.status && <span className="text-[11px] font-semibold" style={{ color: statusColor(previewCard.status) }}>{previewCard.status}</span>}
                </div>
                <button onClick={() => setPreviewCard(null)} aria-label="Close" className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10"><X size={17} /></button>
              </div>
              {/* Scrollable body */}
              <div ref={previewBodyRef} className="flex-1 overflow-y-auto dark-scroll p-5">
              {/* Phase 1c — another user changed/deleted this job card while it was open here. */}
              <RecordUpdatedNotice status={previewSync.status} onAcknowledge={() => previewSync.markSynced()} className="mb-3" />
              <div className="space-y-2.5 text-sm">
                {[['Customer', previewCard.customer], ['Phone', previewCard.phone], ['Vehicle', previewCard.vehicle], ['Reg No.', previewCard.regNo], ['Advisor', previewCard.advisor], ['Status', previewCard.status], ['Date In', fmtDT(previewCard.dateIn)], ['Promised', fmtDT(previewCard.promised)]].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3"><span className="text-white/45">{k}</span><span className="text-white/85 text-right">{v || '—'}</span></div>
                ))}
                <div><p className="text-white/45 mb-1">Complaints</p>{(previewCard.complaints || []).filter(Boolean).map((c, x) => <p key={x} className="text-white/75 text-xs">• {c}</p>)}</div>
                <div><p className="text-white/45 mb-1">Diagnosis</p>{(previewCard.diagnosis || []).filter(Boolean).map((c, x) => <p key={x} className="text-white/75 text-xs">• {c}</p>)}</div>
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={() => { loadCard(previewCard); setPreviewCard(null); }} className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-white/5 border border-white/10 text-white/80 flex items-center justify-center gap-1.5"><Edit3 size={13} /> Edit</button>
                <button onClick={() => downloadPDF(previewCard, false)} className="flex-1 py-2.5 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] flex items-center justify-center gap-1.5"><FileDown size={13} /> PDF</button>
              </div>
              </div>
            </div>
          </div>
        ), document.body)}
      </div>

      {/* -------- live preview column -------- */}
      <div className={`${fullPreview ? 'w-full' : 'hidden xl:block xl:w-[430px] xl:flex-shrink-0'} mt-4 xl:mt-0`}>
        <div className="xl:sticky xl:top-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-white/70 uppercase tracking-wide">Job Card PDF Preview <span className="ml-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">READY</span></h3>
            <div className="flex gap-1.5">
              <button onClick={() => downloadPDF(cardRef.current)} title="Download PDF" className="h-8 px-3 rounded-lg flex items-center gap-1.5 text-[11px] font-bold bg-white/5 border border-white/10 text-white/75 hover:bg-white/10"><FileDown size={13} /> Download PDF</button>
              {/* Below xl this column is only ever reachable WHILE fullPreview is true (see
                  the "Preview PDF" header button above) — so the way back to the form must
                  stay visible in that state regardless of width. At xl+, the column is
                  always visible and this only needs to appear there, matching its original
                  desktop-only "expand" role. */}
              <button onClick={() => setFullPreview((f) => !f)} title={fullPreview ? 'Back to form' : 'Toggle full preview'} className={`w-8 h-8 rounded-lg items-center justify-center bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 ${fullPreview ? 'flex' : 'hidden xl:flex'}`}>{fullPreview ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
            </div>
          </div>
          <div className="rounded-xl overflow-hidden" style={{ background: '#f5f2ea', color: '#1c1a16', maxHeight: '82vh', overflowY: 'auto' }}>
            {/* header */}
            <div style={{ background: '#161616', padding: '14px 16px', textAlign: 'center' }}>
              <p style={{ color: '#d4af37', fontWeight: 800, fontSize: 15, letterSpacing: '0.06em' }}>{previewShop.name}</p>
              <p style={{ color: '#ddd', fontSize: 7, letterSpacing: '0.14em', marginTop: 2 }}>{previewShop.tag}</p>
              <p style={{ color: '#d4af37', fontSize: 8, marginTop: 4 }}>{demoMode ? 'XXXXXXXXXX' : previewShop.phones}</p>
              <p style={{ color: '#ccc', fontSize: 7, marginTop: 2 }}>{demoMode ? MASK : previewShop.address}</p>
              <p style={{ color: '#aaa', fontSize: 6.5, marginTop: 2 }}>GST: {demoMode ? MASK : previewShop.gst} · {demoMode ? MASK : previewShop.email} · {demoMode ? MASK : previewShop.website}</p>
              <div style={{ height: 3, background: '#d4af37', marginTop: 8 }} />
            </div>
            <div style={{ padding: 14, fontSize: 10 }}>
              {[
                ['1. SERVICE INTAKE DETAILS', [['Job Card No.', card.jobNo], ['Date & Time In', fmtDT(card.dateIn)], ['Promised Delivery', fmtDT(card.promised)], ['Service Advisor', card.advisor || '—']]],
                ['2. CLIENT PROFILE', [['Customer Name', card.customer || '—'], ['Contact', card.phone || '—'], ['Alternate', card.altPhone || '—'], ['Address', card.address || '—']]],
                ['3. VEHICLE SPECIFICATIONS', [['Registration', card.regNo || '—'], ['Make & Model', card.vehicle || '—'], ['VIN / Chassis', card.vin || '—'], ['Fuel', card.fuel], ['Engine No.', card.engineNo || '—']]],
              ].map(([title, rows]) => (
                <div key={title} style={{ marginBottom: 10 }}>
                  <p style={{ fontWeight: 800, fontSize: 9, borderLeft: '3px solid #d4af37', paddingLeft: 6, marginBottom: 5 }}>{title}</p>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
                    {rows.map(([k, v]) => (
                      <tr key={k}><td style={{ border: '1px solid #cfc9ba', padding: '3px 6px', fontSize: 8, color: '#777', width: '38%' }}>{k}</td><td style={{ border: '1px solid #cfc9ba', padding: '3px 6px', fontSize: 9 }}>{v}</td></tr>
                    ))}
                  </tbody></table>
                </div>
              ))}
              <div style={{ marginBottom: 10 }}>
                <p style={{ fontWeight: 800, fontSize: 9, borderLeft: '3px solid #d4af37', paddingLeft: 6, marginBottom: 5 }}>4. CLIENT INSTRUCTIONS & DIAGNOSTICS</p>
                <div style={{ display: 'flex', gap: 10 }}>
                  {[['Complaint / Request', card.complaints], ['Diagnosis / Notes', card.diagnosis]].map(([t, arr]) => (
                    <div key={t} style={{ flex: 1 }}>
                      <p style={{ fontSize: 7.5, color: '#888', marginBottom: 3 }}>{t.toUpperCase()}</p>
                      {arr.filter(Boolean).length ? arr.filter(Boolean).map((c, i) => <p key={i} style={{ fontSize: 8.5, borderBottom: '1px dotted #bbb', padding: '2px 0' }}>{i + 1}. {c}</p>) : <p style={{ fontSize: 8.5, color: '#999' }}>—</p>}
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <p style={{ fontWeight: 800, fontSize: 9, borderLeft: '3px solid #d4af37', paddingLeft: 6, marginBottom: 5 }}>6. EXTERIOR CONDITION & INVENTORY CHECK</p>
                <p style={{ fontSize: 8 }}><b>Warnings:</b> {[...card.warnings, ...(card.warningsOther ? [card.warningsOther] : [])].join(', ') || 'None reported'}</p>
                <p style={{ fontSize: 8, marginTop: 3 }}><b>Items present:</b> {[...card.invItems, ...(card.invOther ? [card.invOther] : [])].join(', ') || '—'}</p>
                <p style={{ fontSize: 8, marginTop: 3 }}><b>Damages:</b> {card.damages.length || card.damageOther ? [...card.damages.map((d) => d.note ? `${d.part} (${d.note})` : d.part), ...(card.damageOther ? [card.damageOther] : [])].join(', ') : 'No visible damage recorded.'}</p>
              </div>
              <div style={{ marginBottom: 10 }}>
                <p style={{ fontWeight: 800, fontSize: 9, borderLeft: '3px solid #d4af37', paddingLeft: 6, marginBottom: 5 }}>7. MULTI-POINT PREMIUM INSPECTION</p>
                <p style={{ fontSize: 8 }}>Total checked: <b style={{ color: '#0a7c42' }}>{inspStats.done} / {inspStats.total}</b> · Pending: <b style={{ color: '#b8860b' }}>{inspStats.total - inspStats.done}</b></p>
              </div>
              <div style={{ marginBottom: 10 }}>
                <p style={{ fontWeight: 800, fontSize: 9, borderLeft: '3px solid #d4af37', paddingLeft: 6, marginBottom: 5 }}>9. JOB STATUS</p>
                <p style={{ fontSize: 8 }}>{card.statusLog.map((l) => `${l.status} (${new Date(l.at).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })})`).join(' → ')}</p>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 26 }}>
                {['AUTHORIZED CLIENT SIGNATURE', 'SERVICE ADVISOR SIGNATURE'].map((s) => (
                  <div key={s} style={{ width: '44%', textAlign: 'center' }}><div style={{ borderTop: '1.5px solid #444', marginBottom: 3 }} /><p style={{ fontSize: 6.5, color: '#666' }}>{s}</p></div>
                ))}
              </div>
              <p style={{ textAlign: 'center', fontSize: 6.5, color: '#999', marginTop: 10 }}>( PLEASE TURN OVER FOR COMPREHENSIVE VEHICLE INSPECTION ) · Page 1 of 2</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
