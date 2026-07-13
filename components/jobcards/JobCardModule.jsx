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
import toast from 'react-hot-toast';
import { confirmDialog } from '../common/ConfirmDialog';
import { buildQrPayload, makeQrDataUrl, QR_PT } from '../../lib/pdfQr';
import {
  ClipboardList, FileDown, Check, X, Plus, Search, ChevronDown, Camera,
  Trash2, Maximize2, Minimize2, CalendarClock, AlertTriangle, Eye, Edit3, Copy, Printer,
} from 'lucide-react';
import { VEHICLES } from '../../lib/vehicleCatalog';
import { num } from '../../lib/format';

/* ================= constants ================= */
const SHOP = {
  name: 'SRI BABA BALAJI MARUTI CARE',
  tag: 'PREMIUM AUTOMOTIVE SERVICE & DIAGNOSTICS · TRUSTED FOR OVER 25 YEARS',
  phones: '98665 71263 | 98661 23631 | 99125 60999',
  address: 'Door No. 7-10-38/3, NH16, Near Pantulugari Meda Bus Stop, Panthulugarimeda, Old Gajuwaka, Gajuwaka, Andhra Pradesh 530026',
  gst: '37XXXXX0000X1Z5', email: 'sribababalaji@gmail.com', website: 'balaji-auto-os.vercel.app',
};
const MASK = 'XXXXXXXX';

// 'Draft' deliberately sits OUTSIDE this list. STATUSES is the linear repair workflow
// and the code enforces "you can't skip a stage" against its indexes — putting Draft
// in it would make Draft a stage you must pass through. A draft is a not-yet-started
// job card: it has no place in the workflow until it is properly opened as 'Received'.
const DRAFT_STATUS = 'Draft';
const STATUSES = ['Received', 'Inspection', 'Estimate Ready', 'Estimate Approved', 'Waiting Parts', 'Repair Started', 'Repair Paused', 'Quality Check', 'Wash', 'Ready', 'Delivered', 'Closed', 'Cancelled'];
const STATUS_COLOR = {
  Draft: '#9ca3af',
  Received: '#60a5fa', Inspection: '#38bdf8', 'Estimate Ready': '#a78bfa', 'Estimate Approved': '#818cf8',
  'Waiting Parts': '#fbbf24', 'Repair Started': '#fb923c', 'Repair Paused': '#f59e0b', 'Quality Check': '#22d3ee',
  Wash: '#2dd4bf', Ready: '#34d399', Delivered: '#4ade80', Closed: '#9ca3af', Cancelled: '#f87171',
};
const statusColor = (s) => STATUS_COLOR[s] || '#9ca3af';

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
const toLocalInput = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const engOk = (v) => { const s = String(v || '').trim(); if (!s) return null; if (!/^[A-Za-z0-9-]+$/.test(s)) return 'Only letters, numbers and “-” allowed'; if (s.length < 5) return 'Engine no. must be at least 5 characters'; if (s.length > 25) return 'Engine no. must be at most 25 characters'; return null; };
const vinOk = (v) => { const s = String(v || '').trim(); if (!s) return null; if (!/^[A-HJ-NPR-Za-hj-npr-z0-9]+$/.test(s)) return 'Invalid character (I, O, Q and symbols not allowed)'; if (s.length < 11) return 'VIN must be at least 11 characters'; if (s.length > 17) return 'VIN must be at most 17 characters'; return null; };

/* ================= HOISTED subcomponents (the focus-bug fix) ================= */
const inputCls = 'w-full px-3 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 text-white placeholder-white/25 outline-none focus:border-[#d4af37]/60 transition';
const cardStyle = { background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' };

function Field({ label, req, error, children }) {
  return (
    <div className="min-w-0">
      <label className="block text-[10px] uppercase tracking-wide text-white/40 mb-1.5">{label}{req && <span className="text-red-400"> *</span>}</label>
      {children}
      {error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}
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

function MiniSelect({ value, placeholder, options, onPick, onAdd, addLabel, disabled }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const shown = useMemo(() => { const l = q.trim().toLowerCase(); return (l ? options.filter((o) => o.toLowerCase().includes(l)) : options); }, [q, options]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} className={`${inputCls} flex items-center justify-between text-left ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
        <span className={value ? 'text-white' : 'text-white/25'}>{value || placeholder}</span>
        <ChevronDown size={14} className="text-white/35 flex-shrink-0" />
      </button>
      {open && !disabled && (
        <div className="absolute z-40 mt-1 w-full rounded-xl overflow-hidden shadow-2xl" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }}>
          <div className="relative p-2" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.07)' }}>
            <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-full pl-8 pr-2 py-2 rounded-lg text-sm bg-white/5 border border-white/10 text-white placeholder-white/25 outline-none" />
          </div>
          <div className="max-h-52 overflow-y-auto dark-scroll">
            {shown.map((o) => (
              <button key={o} type="button" onClick={() => { onPick(o); setOpen(false); setQ(''); }} className={`w-full text-left px-3 py-2 text-sm transition ${o === value ? 'bg-[#d4af37]/15 text-white' : 'text-white/75 hover:bg-white/5'}`}>{o}</button>
            ))}
            {shown.length === 0 && <p className="px-3 py-3 text-xs text-white/40">No matches.</p>}
          </div>
          {onAdd && (
            <button type="button" onClick={() => { const name = window.prompt(addLabel); if (name && name.trim()) { onAdd(name.trim()); onPick(name.trim()); setOpen(false); setQ(''); } }} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-bold text-[#d4af37] hover:bg-white/5" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.07)' }}><Plus size={13} /> {addLabel}</button>
          )}
        </div>
      )}
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
  const models = make ? (catalog[make] || []) : [];
  return (
    <div className="grid grid-cols-2 gap-2">
      <MiniSelect value={make} placeholder="Manufacturer" options={makes} onPick={(m) => onChange({ make: m, model: '', vehicle: '' })} onAdd={(name) => onAddVehicle({ make: name, model: '' })} addLabel="Add New Manufacturer" />
      <MiniSelect value={model} placeholder={make ? 'Model' : 'Select make first'} options={models} disabled={!make} onPick={(m) => onChange({ make, model: m, vehicle: `${make} ${m}` })} onAdd={(name) => onAddVehicle({ make, model: name })} addLabel="Add New Model" />
    </div>
  );
}

function CustomerSearch({ customers, onFill }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useEffect(() => { if (!open) return undefined; const d = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', d); return () => document.removeEventListener('mousedown', d); }, [open]);
  const shown = useMemo(() => {
    const l = q.trim().toLowerCase();
    if (l.length < 2) return [];
    return customers.filter((c) => [c.name, c.phone, c.altPhone, c.code, ...(c.vehicles || []).flatMap((v) => [v.regNo, v.model, v.vin, v.engineNo])].filter(Boolean).join(' ').toLowerCase().includes(l)).slice(0, 8);
  }, [q, customers]);
  if (!customers.length) return null;
  return (
    <div className="relative mb-3" ref={ref}>
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
      <input value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} placeholder="Search existing customer by name, phone, vehicle no., VIN…" className={`${inputCls} pl-9`} />
      {open && shown.length > 0 && (
        <div className="absolute z-40 mt-1 w-full rounded-xl overflow-hidden shadow-2xl" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }}>
          {shown.map((c) => {
            const v = (c.vehicles || [])[0] || {};
            return (
              <button key={c.id} type="button" onClick={() => { onFill(c); setOpen(false); setQ(''); }} className="w-full text-left px-3 py-2 hover:bg-white/5">
                <p className="text-sm text-white/85">{c.name} <span className="text-white/40 text-[11px]">· {c.phone}</span></p>
                <p className="text-[10px] text-white/40">{c.code}{v.regNo ? ` · ${v.regNo} ${v.model || ''}` : ''}</p>
              </button>
            );
          })}
        </div>
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
    if (!tokens.length) return options.slice(0, 60);
    return options.filter((o) => { const l = o.toLowerCase(); return tokens.every((t) => l.includes(t)); }).slice(0, 60);
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
        <span className={value ? 'text-white' : 'text-white/25'}>{value || 'Search make & model…'}</span>
        <ChevronDown size={14} className="text-white/35 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-full rounded-xl overflow-hidden shadow-2xl" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }}>
          {!adding ? (
            <>
              <div className="relative p-2" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.07)' }}>
                <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Type manufacturer, model, variant…" className="w-full pl-8 pr-2 py-2 rounded-lg text-sm bg-white/5 border border-white/10 text-white placeholder-white/25 outline-none" />
              </div>
              <div className="max-h-56 overflow-y-auto dark-scroll">
                {shown.map((o, i) => (
                  <button key={o} type="button" onClick={() => pick(o)} onMouseEnter={() => setHi(i)} className={`w-full text-left px-3 py-2 text-sm transition ${i === hi ? 'bg-[#d4af37]/15 text-white' : 'text-white/75 hover:bg-white/5'}`}>{o}</button>
                ))}
                {shown.length === 0 && <p className="px-3 py-3 text-xs text-white/40">No matches.</p>}
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
                <select value={nv.fuel} onChange={(e) => setNv((s) => ({ ...s, fuel: e.target.value }))} className={inputCls}>{['Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid'].map((f) => <option key={f} style={{ background: '#141414' }}>{f}</option>)}</select>
                <select value={nv.transmission} onChange={(e) => setNv((s) => ({ ...s, transmission: e.target.value }))} className={inputCls}>{['Manual', 'AMT', 'Automatic', 'CVT', 'DCT'].map((f) => <option key={f} style={{ background: '#141414' }}>{f}</option>)}</select>
                <select value={nv.body} onChange={(e) => setNv((s) => ({ ...s, body: e.target.value }))} className={`${inputCls} col-span-2`}>{['Hatchback', 'Sedan', 'SUV', 'MUV', 'Pickup', 'Van', 'Coupe', 'Convertible'].map((f) => <option key={f} style={{ background: '#141414' }}>{f}</option>)}</select>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setAdding(false)} className="flex-1 py-2 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-white/70">Cancel</button>
                <button type="button" onClick={saveNew} className="flex-1 py-2 rounded-lg text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">Save Vehicle</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Split date + 12-hour time field. Avoids the native datetime-local popup entirely
// (which can't be reliably closed programmatically) so quick-set buttons always work
// and never leave a picker hanging open. Value stays in "YYYY-MM-DDTHH:mm" form.
function DateTimeField({ value, onChange, min, shortcuts = [] }) {
  const parse = (v) => {
    if (!v) return { date: '', h12: '', m: '', ap: 'AM' };
    const [d, t = ''] = v.split('T');
    const [H = '', M = ''] = t.split(':');
    const h = Number(H);
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return { date: d, h12: H === '' ? '' : String(h12), m: M, ap };
  };
  const build = ({ date, h12, m, ap }) => {
    if (!date) return '';
    let H = Number(h12 || 0);
    if (ap === 'PM' && H < 12) H += 12;
    if (ap === 'AM' && H === 12) H = 0;
    const hh = String(H).padStart(2, '0');
    const mm = String(m === '' ? 0 : Number(m)).padStart(2, '0');
    return `${date}T${hh}:${mm}`;
  };
  const cur = parse(value);
  const patch = (p) => onChange(build({ ...cur, ...p }));

  const apply = (k) => {
    const d = new Date();
    if (k === 'now') { /* keep now */ }
    else if (k === 'today6') d.setHours(18, 0, 0, 0);
    else { const days = { tomorrow: 1, plus2: 2, plus7: 7 }[k] || 0; d.setTime(Date.now() + days * 86400000); d.setHours(18, 0, 0, 0); }
    onChange(toLocalInput(d));
  };
  const minDate = min ? String(min).split('T')[0] : undefined;
  return (
    <div>
      <div className="flex gap-1.5">
        <input type="date" value={cur.date} min={minDate} onChange={(e) => patch({ date: e.target.value })} className={`${inputCls} flex-1`} style={{ colorScheme: 'dark' }} aria-label="Date" />
        <input type="number" inputMode="numeric" min={1} max={12} placeholder="hh" value={cur.h12} onChange={(e) => { const n = e.target.value.replace(/\D/g, '').slice(0, 2); patch({ h12: n }); }} className={`${inputCls} w-14 text-center`} aria-label="Hour" />
        <span className="self-center text-white/40">:</span>
        <input type="number" inputMode="numeric" min={0} max={59} placeholder="mm" value={cur.m} onChange={(e) => { const n = e.target.value.replace(/\D/g, '').slice(0, 2); patch({ m: n }); }} className={`${inputCls} w-14 text-center`} aria-label="Minute" />
        <div className="flex rounded-lg overflow-hidden border border-white/10">
          {['AM', 'PM'].map((x) => (
            <button key={x} type="button" onClick={() => patch({ ap: x })} className={`px-2 text-[11px] font-bold transition ${cur.ap === x ? 'bg-[#d4af37] text-black' : 'text-white/50 hover:bg-white/5'}`}>{x}</button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-1 mt-1.5">
        {shortcuts.map(([k, label]) => (
          <button key={k} type="button" onClick={() => apply(k)} className="px-2 py-1 rounded-md text-[10px] font-semibold text-white/55 bg-white/5 border border-white/10 hover:bg-white/10 transition">{label}</button>
        ))}
      </div>
    </div>
  );
}

/* ================= main module ================= */
const DRAFT_KEY = 'maruti_jobcard_draft_v2';
const CUSTOM_VEH_KEY = 'maruti_custom_vehicles';
const nextJobNo = (saved = []) => {
  const max = saved.reduce((m, c) => { const n = Number(String(c.jobNo || '').replace(/\D/g, '')); return /^SBBMC\d+$/i.test(String(c.jobNo || '')) && n > m ? n : m; }, 0);
  return `SBBMC${String(max + 1).padStart(2, '0')}`;
};
const emptyCard = (saved = []) => ({
  jobNo: nextJobNo(saved), jobNoMode: 'auto', dateIn: toLocalInput(new Date()), promised: '', advisor: '', technician: '', helper: '', labour: [],
  customer: '', phone: '', altPhone: '', address: '',
  vehicle: '', make: '', model: '', regNo: '', vin: '', fuel: 'Petrol', engineNo: '',
  complaints: ['', '', '', ''], diagnosis: ['', '', '', ''],
  warnings: [], warningsOther: '', invItems: [], invOther: '', parts: [],
  damages: [], damageOther: '',
  inspection: {}, inspectionTemplate: 'Major Service', photosBefore: [], photosAfter: [], notes: '', customerNote: '', technicianNote: '', billingNote: '',
  status: 'Received', statusLog: [{ status: 'Received', at: Date.now() }],
});

export default function JobCardModule({ demoMode = false, demoCanDelete = false, canManage = true, isAdmin = false, inventory = [], customers = [], onPersist, onDelete, onRegisterVehicle, savedCards = [] }) {
  const savedRef = useRef(savedCards);
  savedRef.current = savedCards;
  const lastCardRef = useRef(null);
  lastCardRef.current = [...(savedCards || [])].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0] || null;
  const splitVehicle = (c) => {
    if (c && c.vehicle && !c.make) {
      const mk = Object.keys(VEHICLES).find((m) => c.vehicle.startsWith(m));
      if (mk) return { ...c, make: mk, model: c.vehicle.slice(mk.length).trim() };
    }
    return c;
  };
  const [card, setCard] = useState(() => {
    try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); if (d && d.jobNo) return splitVehicle({ ...emptyCard(savedCards), ...d }); } catch {}
    return emptyCard(savedCards);
  });
  const [customVehicles, setCustomVehicles] = useState(() => { try { return JSON.parse(localStorage.getItem(CUSTOM_VEH_KEY) || '[]'); } catch { return []; } });
  const [saving, setSaving] = useState(false);
  const [fullPreview, setFullPreview] = useState(false);
  const [invQ, setInvQ] = useState('');
  const [previewCard, setPreviewCard] = useState(null);
  const [savedQ, setSavedQ] = useState('');
  const [savedStatusF, setSavedStatusF] = useState('All');
  const [savedLimit, setSavedLimit] = useState(20);
  useEffect(() => { setSavedLimit(20); }, [savedQ, savedStatusF]);
  const [warnQ, setWarnQ] = useState('');
  const [partQ, setPartQ] = useState('');
  const [noteTab, setNoteTab] = useState('notes');
  const [rowMenu, setRowMenu] = useState(null);
  const loadCard = async (jc) => { if (dirty.current && !await confirmDialog({ title: 'Load this card?', message: 'The current draft will be replaced.', confirmText: 'Load' })) return; setCard(splitVehicle({ ...emptyCard(savedRef.current), ...jc })); dirty.current = false; window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const duplicateCard = (jc) => { const copy = { ...jc, jobNo: nextJobNo(savedRef.current), status: 'Received', statusLog: [{ status: 'Received', at: Date.now() }], savedAt: undefined }; setCard(splitVehicle({ ...emptyCard(savedRef.current), ...copy })); dirty.current = true; toast.success('Duplicated — review and save as a new card'); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const dirty = useRef(false);
  const cardRef = useRef(card);
  cardRef.current = card;

  const set = useCallback((patch) => { dirty.current = true; setCard((c) => ({ ...c, ...patch })); }, []);

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
    return (ql ? names.filter((n) => n.toLowerCase().includes(ql)) : names).slice(0, 30);
  }, [inventory, invQ]);
  const partMatches = useMemo(() => {
    const ql = partQ.trim().toLowerCase();
    if (!ql) return [];
    return inventory.filter((p) => !p.archived && [p.name, p.sku, p.oemNo, p.partNo, p.barcode].filter(Boolean).join(' ').toLowerCase().includes(ql)).slice(0, 20);
  }, [inventory, partQ]);
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
      r.onload = () => setCard((c) => ({ ...c, [key]: [...c[key], r.result].slice(0, 8) }));
      r.readAsDataURL(f);
    });
    dirty.current = true;
  };
  const onDrop = (key) => (e) => { e.preventDefault(); addPhotos(key, e.dataTransfer.files); };

  // Status workflow: sequential for staff, override for admins; timestamps logged.
  const setStatus = (s) => {
    const cur = STATUSES.indexOf(card.status);
    const nxt = STATUSES.indexOf(s);
    if (nxt === cur) return;
    // Cancelled and Repair Paused can be set from any stage; others follow sequence (admins may skip).
    const jumpAllowed = s === 'Cancelled' || s === 'Repair Paused' || card.status === 'Repair Paused';
    if (!isAdmin && !jumpAllowed && nxt !== cur + 1) { toast.error(`Move to “${STATUSES[cur + 1] || '—'}” first — workflow can’t be skipped.`); return; }
    set({ status: s, statusLog: [...card.statusLog, { status: s, at: Date.now(), by: demoMode ? 'Demo User' : (card.advisor || 'Staff') }] });
  };

  function validate() {
    if (!card.jobNo.trim()) return 'Job Card Number is required';
    if (card.jobNoMode === 'manual' && savedRef.current.some((c) => c.jobNo === card.jobNo)) return 'Job Card Number already exists';
    if (!card.customer.trim()) return 'Customer name is required';
    if (!/^\d{10}$/.test(card.phone.replace(/\D/g, ''))) return 'Contact number must be a valid 10-digit number';
    if (!card.vehicle) return 'Select the vehicle make & model';
    if (!card.regNo.trim()) return 'Registration number is required';
    if (engErr) return engErr;
    if (vinErr) return vinErr;
    if (promisedErr) return promisedErr;
    return null;
  }
  // asDraft: park a partially-filled job card. The vehicle is often still being looked
  // at when the service advisor gets pulled away — demanding reg-no / engine no / VIN
  // up front just means the card never gets written. A draft needs only a name so it
  // can be found again; the full validation applies when it is properly opened.
  async function saveCard(asDraft = false) {
    if (!canManage) { toast.error('You do not have permission to save job cards.'); return; }
    if (asDraft) {
      if (!card.customer?.trim()) { toast.error('Customer name required — even for a draft.'); return; }
    } else {
      const err = validate();
      if (err) { toast.error(err); return; }
    }
    setSaving(true);
    try {
      await onPersist?.({
        ...card,
        status: asDraft ? DRAFT_STATUS : (card.status === DRAFT_STATUS ? 'Received' : card.status),
        isDraft: asDraft,
        savedAt: Date.now(),
      });
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
      dirty.current = false;
      toast.success(asDraft ? `Draft saved — ${card.customer}` : `Job card ${card.jobNo} saved`);
      setCard(emptyCard(savedRef.current));
    } catch (e) { console.error(e); toast.error('Could not save the job card.'); }
    finally { setSaving(false); }
  }

  /* ---------- PDF (matches SHOP.pdf reference; 2 pages + photos) ---------- */
  async function downloadPDF(source, printAfter = false) {
    const card = source && source.jobNo ? source : cardRef.current;
    const { jsPDF } = await import('jspdf');
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
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const W = 595; const M = 40; const shop = demoMode
      ? { ...SHOP, phones: 'XXXXXXXXXX', address: MASK, gst: MASK, email: MASK, website: MASK }
      : SHOP;
    const gold = [212, 175, 55];
    let page = 1;
    const watermark = () => {
      doc.saveGraphicsState();
      doc.setGState(new doc.GState({ opacity: 0.06 }));
      doc.setFontSize(52); doc.setTextColor(120, 100, 40);
      doc.text('SRI BABA BALAJI', W / 2, 480, { align: 'center', angle: 30 });
      doc.restoreGraphicsState();
    };
    const pageNo = () => { doc.setFontSize(8); doc.setTextColor(150); doc.text(`Page ${page}`, W - M, 828, { align: 'right' }); };
    const header = (sub) => {
      doc.setFillColor(20, 20, 20); doc.rect(M, 34, W - 2 * M, sub ? 26 : 66, 'F');
      if (!sub) {
        doc.setTextColor(...gold); doc.setFontSize(15); doc.setFont(undefined, 'bold');
        doc.text(shop.name, W / 2, 54, { align: 'center' });
        doc.setTextColor(235); doc.setFontSize(6.5); doc.setFont(undefined, 'normal');
        doc.text(SHOP.tag, W / 2, 65, { align: 'center' });
        doc.setTextColor(...gold); doc.setFontSize(7.5);
        doc.text(shop.phones, W / 2, 76, { align: 'center' });
        doc.setTextColor(220); doc.setFontSize(6.5);
        doc.text(shop.address, W / 2, 86, { align: 'center', maxWidth: W - 2 * M - 20 });
        doc.setFontSize(6); doc.setTextColor(200);
        doc.text(`GST: ${shop.gst}   ·   ${shop.email}   ·   ${shop.website}`, W / 2, 95, { align: 'center' });
        doc.setFillColor(...gold); doc.rect(M, 100, W - 2 * M, 2.4, 'F');
      } else {
        doc.setTextColor(240); doc.setFontSize(10); doc.setFont(undefined, 'bold');
        doc.text(sub, W / 2, 51, { align: 'center' });
        doc.setFont(undefined, 'normal');
      }
    };
    const secTitle = (y, t) => {
      doc.setFillColor(...gold); doc.rect(M, y - 8, 3, 11, 'F');
      doc.setTextColor(30); doc.setFontSize(8.5); doc.setFont(undefined, 'bold');
      doc.text(t, M + 8, y); doc.setFont(undefined, 'normal');
      return y + 8;
    };
    const boxRow = (y, cols, h = 30) => {
      const w = (W - 2 * M) / cols.length;
      cols.forEach((c, i) => {
        doc.setDrawColor(200); doc.rect(M + i * w, y, w - (i < cols.length - 1 ? 4 : 0), h);
        doc.setFontSize(6); doc.setTextColor(120); doc.text(c.label.toUpperCase(), M + i * w + 4, y + 9);
        doc.setFontSize(8.5); doc.setTextColor(25); doc.text(String(c.value || '—').slice(0, 42), M + i * w + 4, y + 21);
      });
      return y + h + 10;
    };

    // ---- PAGE 1 ----
    header();
    watermark();
    if (qrDataUrl) { try { doc.addImage(qrDataUrl, 'PNG', W - M - QR_PT, 100, QR_PT, QR_PT); doc.setFontSize(5.5); doc.setTextColor(140); doc.text('Scan to verify', W - M - QR_PT / 2, 100 + QR_PT + 8, { align: 'center' }); } catch {} }
    let y = 122;
    y = secTitle(y, '1. SERVICE INTAKE DETAILS');
    y = boxRow(y, [{ label: 'Job Card No.', value: card.jobNo }, { label: 'Date & Time In', value: fmtDT(card.dateIn) }, { label: 'Promised Delivery', value: fmtDT(card.promised) }, { label: 'Service Advisor', value: card.advisor }]);
    if (card.technician || card.helper) y = boxRow(y, [{ label: 'Technician', value: card.technician || '—' }, { label: 'Helper', value: card.helper || '—' }]);
    y = secTitle(y, '2. CLIENT PROFILE');
    y = boxRow(y, [{ label: 'Customer Name', value: card.customer }, { label: 'Contact Number', value: card.phone }, { label: 'Alternate Number', value: card.altPhone }]);
    y = boxRow(y, [{ label: 'Full Address', value: card.address }]);
    y = secTitle(y, '3. VEHICLE SPECIFICATIONS');
    y = boxRow(y, [{ label: 'Registration No.', value: card.regNo }, { label: 'Make & Model', value: card.vehicle }, { label: 'VIN / Chassis No.', value: card.vin }]);
    y = boxRow(y, [{ label: 'Fuel Type', value: card.fuel }, { label: 'Engine No.', value: card.engineNo }]);
    y = secTitle(y, '4. CLIENT INSTRUCTIONS & DIAGNOSTICS');
    doc.setFontSize(7.5); doc.setTextColor(60);
    const comp = card.complaints.filter(Boolean); const diag = card.diagnosis.filter(Boolean);
    const lines = Math.max(comp.length, diag.length, 3);
    doc.setFontSize(6.5); doc.setTextColor(120);
    doc.text('COMPLAINT / REQUEST', M + 2, y); doc.text('DIAGNOSIS / TECHNICIAN NOTES', M + (W - 2 * M) / 2 + 6, y);
    y += 8; doc.setFontSize(7.5); doc.setTextColor(50);
    for (let i = 0; i < lines; i += 1) {
      doc.text(`${i + 1}. ${comp[i] || ''}`.slice(0, 55), M + 2, y);
      doc.text(`${i + 1}. ${diag[i] || ''}`.slice(0, 55), M + (W - 2 * M) / 2 + 6, y);
      doc.setDrawColor(210); doc.line(M, y + 3, W - M, y + 3);
      y += 14;
    }
    y += 8;
    if ((card.labour || []).filter((lb) => lb.service).length) {
      y = secTitle(y, '4B. LABOUR & SERVICES');
      doc.setFontSize(6.5); doc.setTextColor(120);
      doc.text('SERVICE', M + 2, y); doc.text('HOURS', W - M - 150, y); doc.text('RATE', W - M - 100, y); doc.text('AMOUNT', W - M - 50, y);
      y += 8; doc.setFontSize(7.5); doc.setTextColor(50);
      let labTotal = 0;
      card.labour.filter((lb) => lb.service).forEach((lb) => {
        const amt = (Number(lb.hours) || 0) * (Number(lb.rate) || 0); labTotal += amt;
        doc.text(String(lb.service).slice(0, 45), M + 2, y);
        doc.text(String(lb.hours || '—'), W - M - 150, y); doc.text(String(lb.rate || '—'), W - M - 100, y); doc.text(`Rs. ${amt.toLocaleString('en-IN')}`, W - M - 50, y);
        doc.setDrawColor(220); doc.line(M, y + 3, W - M, y + 3); y += 13;
      });
      doc.setFontSize(8); doc.setTextColor(30); doc.text(`Total Labour: Rs. ${labTotal.toLocaleString('en-IN')}`, W - M - 2, y + 2, { align: 'right' }); y += 14;
    }
    y = secTitle(y, '5. TERMS OF SERVICE & AUTHORIZATION');
    doc.setFontSize(6.6); doc.setTextColor(80);
    const terms = [
      'I hereby authorize the repair work described above and agree to pay for labour, premium spare parts, and materials required at the workshop’s current rates.',
      'The workshop holds no liability for loss or damage to the vehicle or its contents due to fire, theft, or unforeseen circumstances beyond our strict control.',
      'I grant express permission to the workshop’s certified technicians to test-drive this vehicle on public roads for accurate diagnostic and inspection purposes.',
    ];
    terms.forEach((t) => { const wrapped = doc.splitTextToSize(`•  ${t}`, W - 2 * M - 8); doc.text(wrapped, M + 4, y); y += wrapped.length * 8 + 3; });
    y += 26;
    doc.setDrawColor(60); doc.line(M, y, M + 150, y); doc.line(W - M - 150, y, W - M, y);
    doc.setFontSize(6.5); doc.setTextColor(90);
    doc.text('AUTHORIZED CLIENT SIGNATURE', M, y + 9); doc.text('SERVICE ADVISOR SIGNATURE', W - M - 150, y + 9);
    doc.setFontSize(6); doc.setTextColor(150);
    doc.text('( PLEASE TURN OVER FOR COMPREHENSIVE VEHICLE INSPECTION )', W / 2, y + 26, { align: 'center' });
    pageNo();

    // ---- PAGE 2 ----
    doc.addPage(); page += 1; header('WORKSHOP FLOOR & QUALITY CONTROL'); watermark();
    y = 78;
    y = secTitle(y, '6. EXTERIOR CONDITION & INVENTORY CHECK');
    doc.setFontSize(6.5); doc.setTextColor(120); doc.text('DASHBOARD WARNINGS ON:', M + 2, y); y += 8;
    doc.setFontSize(7); doc.setTextColor(50);
    const warnList = [...card.warnings, ...(card.warningsOther ? [card.warningsOther] : [])];
    const warnTxt = warnList.length ? warnList.join(', ') : 'None reported';
    doc.splitTextToSize(warnTxt, W - 2 * M - 8).forEach((l) => { doc.text(l, M + 2, y); y += 9; });
    y += 4;
    doc.setFontSize(6.5); doc.setTextColor(120); doc.text('ACCESSORIES & ITEMS PRESENT:', M + 2, y); y += 8;
    doc.setFontSize(7); doc.setTextColor(50);
    const invList = [...card.invItems, ...(card.invOther ? [card.invOther] : [])];
    doc.splitTextToSize(invList.length ? invList.join(', ') : '—', W - 2 * M - 8).forEach((l) => { doc.text(l, M + 2, y); y += 9; });
    y += 4;
    doc.setFontSize(6.5); doc.setTextColor(120); doc.text('EXTERIOR CONDITION & PRE-EXISTING DAMAGES:', M + 2, y); y += 8;
    doc.setFontSize(7); doc.setTextColor(50);
    const dmg = card.damages.map((d) => { const bits = [d.type, d.severity, d.note].filter(Boolean).join(', '); return bits ? `${d.part} (${bits})` : d.part; });
    if (card.damageOther) dmg.push(card.damageOther);
    doc.splitTextToSize(dmg.length ? dmg.join(', ') : 'No visible damage recorded.', W - 2 * M - 8).forEach((l) => { doc.text(l, M + 2, y); y += 9; });
    y += 10;
    y = secTitle(y, '7. MULTI-POINT PREMIUM INSPECTION');
    const groups = Object.entries(INSPECTION);
    const colW = (W - 2 * M) / 2;
    for (let g = 0; g < groups.length; g += 2) {
      let rowY = y;
      [groups[g], groups[g + 1]].filter(Boolean).forEach(([title, items], ci) => {
        const x = M + ci * colW;
        doc.setFontSize(7); doc.setFont(undefined, 'bold'); doc.setTextColor(...gold);
        doc.text(title.toUpperCase(), x + 2, rowY); doc.setFont(undefined, 'normal');
        let iy = rowY + 10;
        doc.setFontSize(6.8); doc.setTextColor(50);
        items.forEach((it) => { doc.text(`[${card.inspection[it] ? 'x' : ' '}] ${it}`, x + 2, iy); iy += 9; });
      });
      y = rowY + 10 + 6 * 9 + 8;
    }
    y = secTitle(y, '8. NOTES');
    doc.setFontSize(7.5); doc.setTextColor(50);
    const combinedNotes = [card.notes && `Internal: ${card.notes}`, card.technicianNote && `Technician: ${card.technicianNote}`, card.customerNote && `Customer: ${card.customerNote}`].filter(Boolean).join('\n') || ' ';
    const noteLines = doc.splitTextToSize(combinedNotes, W - 2 * M - 8);
    noteLines.slice(0, 5).forEach((l) => { doc.text(l, M + 2, y); doc.setDrawColor(210); doc.line(M, y + 3, W - M, y + 3); y += 13; });
    y += 4;
    doc.setFontSize(7); doc.setTextColor(90);
    doc.text(`STATUS: ${card.status}   ·   ${card.statusLog.map((s) => `${s.status} ${new Date(s.at).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`).join('  →  ')}`.slice(0, 130), M + 2, y);
    y += 30;
    doc.setDrawColor(60); doc.line(M, y, M + 150, y); doc.line(W - M - 150, y, W - M, y);
    doc.setFontSize(6.5); doc.text('TECHNICIAN SIGNATURE', M, y + 9); doc.text('FINAL QUALITY CHECK (MANAGER)', W - M - 150, y + 9);
    pageNo();

    // ---- photos page (only if any) ----
    const photos = [...card.photosBefore.map((p) => ['BEFORE', p]), ...card.photosAfter.map((p) => ['AFTER', p])];
    if (photos.length) {
      doc.addPage(); page += 1; header('SERVICE PHOTOS'); watermark();
      let px = M; let py = 78;
      photos.slice(0, 8).forEach(([tag, img]) => {
        try {
          doc.addImage(img, 'JPEG', px, py, 120, 90);
          doc.setFontSize(6.5); doc.setTextColor(90); doc.text(tag, px, py + 100);
        } catch {}
        px += 132; if (px + 120 > W - M) { px = M; py += 118; }
      });
      pageNo();
    }
    if (printAfter) { doc.autoPrint(); window.open(doc.output('bloburl'), '_blank'); }
    else doc.save(`${card.jobNo}.pdf`);
  }

  /* ================= render ================= */
  return (
    <div className={`xl:flex xl:gap-4 xl:items-start ${fullPreview ? '' : ''}`}>
      {/* -------- form column -------- */}
      <div className={`${fullPreview ? 'hidden' : ''} xl:flex-1 xl:min-w-0 space-y-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-white flex items-center gap-2"><ClipboardList size={18} className="text-[#d4af37]" /> Job Card</h2>
          <div className="flex gap-2">
            <button onClick={async () => { if (dirty.current && !await confirmDialog({ title: 'Discard the current draft?', confirmText: 'Discard', danger: true })) return; setCard(emptyCard(savedRef.current)); dirty.current = false; try { localStorage.removeItem(DRAFT_KEY); } catch {} }} className="h-10 px-4 rounded-xl text-xs font-semibold bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 transition">New / Clear</button>
            <button onClick={() => saveCard(true)} disabled={saving || !card.customer?.trim()} title="Park this job card — nothing enters the workshop queue yet" className="h-10 px-4 rounded-xl text-xs font-bold bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 active:scale-95 transition disabled:opacity-40">Save Draft</button>
            {/* NOTE: must be () => saveCard(false), NOT onClick={saveCard}. React passes the
                click event as the first argument, which would land in `asDraft` as a truthy
                MouseEvent and silently turn every save into a draft. */}
            <button onClick={() => saveCard(false)} disabled={saving} className="h-10 px-5 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] active:scale-95 transition disabled:opacity-60">{saving ? 'Saving…' : 'Save Job Card'}</button>
          </div>
        </div>

        <Section n={1} title="Service Intake Details">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Job Card No.">
              <div className="flex flex-wrap items-center gap-3 mb-1.5">
                {[['auto', 'Auto Generate'], ['manual', 'Manual Entry']].map(([m, l]) => (
                  <label key={m} className="flex items-center gap-1.5 cursor-pointer text-[11px] text-white/70">
                    <input type="radio" checked={(card.jobNoMode || 'auto') === m} onChange={() => set(m === 'auto' ? { jobNoMode: 'auto', jobNo: nextJobNo(savedRef.current) } : { jobNoMode: 'manual' })} className="accent-[#d4af37]" /> {l}
                  </label>
                ))}
              </div>
              {(card.jobNoMode || 'auto') === 'auto'
                ? <div className="flex gap-2"><input value={card.jobNo} readOnly className={`${inputCls} opacity-70`} /><span className="self-center text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#d4af37]/15 text-[#d4af37]">AUTO</span></div>
                : <input value={card.jobNo} onChange={(e) => set({ jobNo: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 14) })} placeholder="e.g. SBBMC42" className={`${inputCls} ${savedRef.current.some((c) => c.jobNo === card.jobNo) ? 'border-red-500/60' : ''}`} />}
              {(card.jobNoMode === 'manual') && savedRef.current.some((c) => c.jobNo === card.jobNo) && <p className="text-[10px] text-red-400 mt-1">Job Card Number already exists</p>}
            </Field>
            <Field label="Service Advisor" req><input value={card.advisor} onChange={(e) => set({ advisor: e.target.value })} placeholder="e.g. Ramesh Kumar" className={inputCls} /></Field>
            <Field label="Technician"><input value={card.technician || ''} onChange={(e) => set({ technician: e.target.value })} placeholder="Primary technician" className={inputCls} /></Field>
            <Field label="Helper (optional)"><input value={card.helper || ''} onChange={(e) => set({ helper: e.target.value })} placeholder="Helper / assistant" className={inputCls} /></Field>
            <Field label="Date & Time In" req><DateTimeField value={card.dateIn} onChange={(v) => set({ dateIn: v })} shortcuts={[['now', 'Now'], ['today6', 'Today 6 PM']]} /></Field>
            <Field label="Promised Delivery" req error={promisedErr}><DateTimeField value={card.promised} onChange={(v) => set({ promised: v })} min={card.dateIn} shortcuts={[['tomorrow', 'Tomorrow'], ['plus2', '+2 Days'], ['plus7', '+7 Days']]} /></Field>
          </div>
        </Section>

        <Section n={2} title="Client Profile">
          <CustomerSearch customers={customers} onFill={(c) => { const v = (c.vehicles || [])[0] || {}; const mk = v.model ? Object.keys(VEHICLES).find((m) => v.model.startsWith(m)) : ''; set({ customer: c.name || '', phone: c.phone || '', altPhone: c.altPhone || '', address: c.address || '', vehicle: v.model || '', make: mk || '', model: mk ? v.model.slice(mk.length).trim() : '', regNo: v.regNo || '', vin: v.vin || '', engineNo: v.engineNo || '', fuel: v.fuel || card.fuel }); toast.success(`Loaded ${c.name}`); }} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Customer Name" req><input value={card.customer} onChange={(e) => set({ customer: e.target.value })} placeholder="Full name" className={inputCls} /></Field>
            <Field label="Contact Number" req error={card.phone && !/^\d{10}$/.test(card.phone.replace(/\D/g, '')) ? 'Enter a valid 10-digit number' : null}><input value={card.phone} inputMode="numeric" onChange={(e) => set({ phone: e.target.value.replace(/[^\d ]/g, '').slice(0, 12) })} placeholder="10-digit mobile" className={inputCls} /></Field>
            <Field label="Alternate Number"><input value={card.altPhone} inputMode="numeric" onChange={(e) => set({ altPhone: e.target.value.replace(/[^\d ]/g, '').slice(0, 12) })} placeholder="Optional" className={inputCls} /></Field>
            <Field label="Full Address"><textarea value={card.address} onChange={(e) => set({ address: e.target.value })} rows={2} placeholder="House, street, area, city" className={`${inputCls} resize-none`} /></Field>
          </div>
        </Section>

        <Section n={3} title="Vehicle Specifications">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Make & Model" req><CascadeVehicleSelect make={card.make} model={card.model} onChange={(patch) => set(patch)} customVehicles={customVehicles} onAddVehicle={addVehicle} /></Field>
            <Field label="Registration No." req><input value={card.regNo} onChange={(e) => set({ regNo: e.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, '').slice(0, 13) })} placeholder="TS09EX1234" className={inputCls} /></Field>
            <Field label="VIN / Chassis No." error={vinErr}><input value={card.vin} onChange={(e) => set({ vin: e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '').slice(0, 17) })} placeholder="11–17 characters" className={inputCls} /></Field>
            <Field label="Engine No." error={engErr}><input value={card.engineNo} onChange={(e) => set({ engineNo: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 25) })} placeholder="5–25 characters" className={inputCls} /></Field>
            <Field label="Fuel Type"><select value={card.fuel} onChange={(e) => set({ fuel: e.target.value })} className={inputCls}>{['Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid'].map((f) => <option key={f} style={{ background: '#141414' }}>{f}</option>)}</select></Field>
          </div>
          {(() => {
            const matched = customers.find((c) => (c.phone || '').replace(/\D/g, '') === (card.phone || '').replace(/\D/g, '') && card.phone);
            if (!matched || !card.regNo.trim() || !card.vehicle.trim()) return null;
            const onFile = (matched.vehicles || []).some((v) => (v.regNo || '').toUpperCase() === card.regNo.toUpperCase());
            if (onFile) return <p className="text-[11px] text-emerald-400/80 mt-2">✓ This vehicle is on {matched.name}’s file.</p>;
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
                  <p className="text-[10px] uppercase tracking-wide text-white/40">{label}</p>
                  <div className="flex gap-1.5">
                    {key === 'complaints' && lastCardRef.current && (lastCardRef.current.complaints || []).some(Boolean) && (
                      <button type="button" onClick={() => set({ complaints: [...(lastCardRef.current.complaints || []).filter(Boolean)] })} className="text-[10px] font-semibold text-white/40 hover:text-[#d4af37] flex items-center gap-1"><Copy size={11} /> Copy previous</button>
                    )}
                    <button type="button" onClick={() => set({ [key]: [...card[key], ''] })} className="text-[10px] font-bold text-[#d4af37] flex items-center gap-1"><Plus size={11} /> Add</button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {card[key].map((v, i) => (
                    <div key={`${key}-${i}`} className="flex items-center gap-1.5">
                      <span className="text-[11px] text-white/30 w-4 text-right flex-shrink-0">{i + 1}.</span>
                      <input value={v} onChange={(e) => { const arr = [...card[key]]; arr[i] = e.target.value; set({ [key]: arr }); }} placeholder={key === 'complaints' ? 'Customer complaint / request' : 'Technician diagnosis / note'} className={`${inputCls} flex-1`} />
                      {card[key].length > 1 && <button type="button" onClick={() => set({ [key]: card[key].filter((_, x) => x !== i) })} className="text-red-400/50 hover:text-red-400 flex-shrink-0"><Trash2 size={13} /></button>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section n={5} title="Exterior Condition & Inventory Check">
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <p className="text-[10px] uppercase tracking-wide text-white/40">Dashboard warnings on</p>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-white/30" />
                <input value={warnQ} onChange={(e) => setWarnQ(e.target.value)} placeholder="Filter…" className="pl-6 pr-2 py-1 rounded-lg text-[11px] bg-white/5 border border-white/10 text-white placeholder-white/25 outline-none w-24 focus:w-32 transition-all" />
              </div>
              <button type="button" onClick={() => set({ warnings: [...WARNINGS] })} className="text-[10px] font-semibold text-[#d4af37] hover:underline">Select All</button>
              <button type="button" onClick={() => set({ warnings: [] })} className="text-[10px] font-semibold text-white/40 hover:text-white/70">Clear All</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {WARNINGS.filter((w) => !warnQ.trim() || w.toLowerCase().includes(warnQ.trim().toLowerCase())).map((w) => <ChipToggle key={w} on={card.warnings.includes(w)} label={w} onClick={() => toggleList('warnings', w)} />)}
          </div>
          <input value={card.warningsOther} onChange={(e) => set({ warningsOther: e.target.value })} placeholder="Other warning (custom)…" className={`${inputCls} mb-4`} />

          <p className="text-[10px] uppercase tracking-wide text-white/40 mb-2">Accessories & items present <span className="normal-case text-white/30">(from your Inventory — updates automatically)</span></p>
          {card.invItems.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {card.invItems.map((n) => (
                <span key={n} className="flex items-center gap-1 pl-2 pr-1 py-1 rounded-lg text-[11px] font-semibold bg-[#d4af37]/12 text-[#d4af37] border border-[#d4af37]/25">{n}<button type="button" onClick={() => toggleList('invItems', n)}><X size={11} /></button></span>
              ))}
            </div>
          )}
          <div className="relative mb-1.5">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input value={invQ} onChange={(e) => setInvQ(e.target.value)} placeholder="Search inventory items to mark as present…" className={`${inputCls} pl-9`} />
          </div>
          {invQ && (
            <div className="max-h-36 overflow-y-auto dark-scroll rounded-xl mb-2" style={{ background: 'var(--surface-2)', border: '1px solid rgba(var(--fg-rgb),0.08)' }}>
              {invNames.map((n) => (
                <button key={n} type="button" onClick={() => { toggleList('invItems', n); setInvQ(''); }} className="w-full text-left px-3 py-2 text-sm text-white/75 hover:bg-white/5">{n}</button>
              ))}
              {invNames.length === 0 && <p className="px-3 py-2 text-xs text-white/40">No inventory items match.</p>}
            </div>
          )}
          <input value={card.invOther} onChange={(e) => set({ invOther: e.target.value })} placeholder="Other item (custom)…" className={inputCls} />
        </Section>

        <Section n={6} title="Damage Notes — Vehicle Body">
          <p className="text-[10px] text-white/40 mb-2">Tap every body part with existing damage, then add a note per part.</p>
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
                  <span className="text-[10px] text-white/40">{inspStats.total ? Math.round((inspStats.done / inspStats.total) * 100) : 0}%</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {groups.map(([group, items]) => (
                    <div key={group}>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-[#d4af37] mb-1.5">{group}</p>
                      <div className="space-y-1">
                        {items.map((it) => (
                          <label key={it} className="flex items-center gap-2 cursor-pointer select-none py-0.5">
                            <input type="checkbox" checked={!!card.inspection[it]} onChange={() => set({ inspection: { ...card.inspection, [it]: !card.inspection[it] } })} className="accent-[#d4af37] w-3.5 h-3.5 flex-shrink-0" />
                            <span className="text-xs text-white/70">{it}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </Section>

        <Section n={8} title="Photos">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[['photosBefore', 'Before Service'], ['photosAfter', 'After Service']].map(([key, label]) => (
              <div key={key} onDragOver={(e) => e.preventDefault()} onDrop={onDrop(key)}>
                <p className="text-[10px] uppercase tracking-wide text-white/40 mb-1.5">{label} <span className="text-white/25 normal-case">(drag & drop, or tap to shoot)</span></p>
                <div className="flex flex-wrap gap-2">
                  {card[key].map((img, i) => (
                    <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden" style={{ border: '1px solid rgba(var(--fg-rgb),0.1)' }}>
                      <img src={img} alt="" className="w-full h-full object-cover" />
                      <button type="button" onClick={() => set({ [key]: card[key].filter((_, x) => x !== i) })} className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center"><X size={10} /></button>
                    </div>
                  ))}
                  <label className="w-16 h-16 rounded-lg flex flex-col items-center justify-center cursor-pointer text-white/40 hover:text-white/70 transition" style={{ border: '1px dashed rgba(var(--fg-rgb),0.2)' }}>
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
          <p className="text-right text-[10px] text-white/30 mt-1">{(card[noteTab] || '').length} / 500</p>
        </Section>

        <Section n={10} title="Parts Reservation" right={<span className="text-[10px] text-white/40">reserves live inventory stock</span>}>
          <p className="text-[11px] text-white/40 mb-2">Add parts this job will consume. Saving the card reserves them in Inventory; cancelling or closing the card releases the reservation automatically.</p>
          <div className="relative mb-1.5">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input value={partQ} onChange={(e) => setPartQ(e.target.value)} placeholder="Search parts by name, SKU, OEM, barcode…" className={`${inputCls} pl-9`} />
          </div>
          {partQ && (
            <div className="max-h-40 overflow-y-auto dark-scroll rounded-xl mb-2" style={{ background: 'var(--surface-2)', border: '1px solid rgba(var(--fg-rgb),0.08)' }}>
              {partMatches.map((p) => {
                const avail = Math.max(0, (p.stock || 0) - (p.reserved || 0));
                const already = (card.parts || []).some((x) => x.partId === p.id);
                return (
                  <button key={p.id} type="button" disabled={already} onClick={() => { set({ parts: [...(card.parts || []), { partId: p.id, name: p.name, qty: 1, rate: Number(p.defaultSellingPrice || p.sellingPrice || 0) }] }); setPartQ(''); }} className={`w-full text-left px-3 py-2 flex justify-between items-center ${already ? 'opacity-40' : 'hover:bg-white/5'}`}>
                    <span className="text-sm text-white/80">{p.name} {p.sku ? <span className="text-white/35 text-[10px]">· {p.sku}</span> : null}</span>
                    <span className={`text-[10px] font-semibold ${avail > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{avail} avail</span>
                  </button>
                );
              })}
              {partMatches.length === 0 && <p className="px-3 py-2 text-xs text-white/40">No parts match.</p>}
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
                    <span className={`text-[10px] ${over ? 'text-red-400' : 'text-white/35'}`}>{avail} avail</span>
                    <input value={p.qty} inputMode="numeric" onChange={(e) => { const q = e.target.value.replace(/\D/g, ''); set({ parts: card.parts.map((x, xi) => (xi === i ? { ...x, qty: q } : x)) }); }} className={`w-14 py-1.5 text-center rounded-lg text-xs bg-white/5 border ${over ? 'border-red-500/50' : 'border-white/10'} text-white outline-none`} />
                    <button type="button" onClick={() => set({ parts: card.parts.filter((_, xi) => xi !== i) })} className="text-red-400/50 hover:text-red-400"><Trash2 size={13} /></button>
                  </div>
                );
              })}
              <p className="text-[10px] text-white/30 pt-0.5">These quantities move to <span className="text-white/50">Reserved</span> in Inventory when you save, and are released back once the card is marked <span className="text-white/50">Delivered</span> (or Closed / Cancelled).</p>
            </div>
          )}
        </Section>

        <Section n={11} title="Labour & Services" right={<button type="button" onClick={() => set({ labour: [...(card.labour || []), { id: `lb_${Date.now()}`, service: '', hours: '', rate: '', tech: '', notes: '' }] })} className="text-[10px] font-bold text-[#d4af37] flex items-center gap-1"><Plus size={11} /> Add Labour</button>}>
          {(card.labour || []).length === 0 && <p className="text-xs text-white/35 py-2">No labour lines yet. Click “Add Labour” to log services performed.</p>}
          <div className="space-y-2">
            {(card.labour || []).map((lb, i) => {
              const setLb = (patch) => set({ labour: card.labour.map((x) => (x.id === lb.id ? { ...x, ...patch } : x)) });
              const amt = (Number(lb.hours) || 0) * (Number(lb.rate) || 0);
              return (
                <div key={lb.id} className="rounded-xl p-2.5" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-[11px] text-white/30 w-4 flex-shrink-0">{i + 1}.</span>
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

        <Section n={12} title="Job Status" right={<span className="text-[10px] text-white/40">{isAdmin ? 'Admin: free movement' : 'Sequential workflow'}</span>}>
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
            <div className="flex flex-col sm:flex-row gap-2 mb-2.5">
              <div className="relative flex-1">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input value={savedQ} onChange={(e) => setSavedQ(e.target.value)} placeholder="Search job no., customer, phone, vehicle, reg, VIN, advisor…" className={`${inputCls} pl-9 py-2`} />
              </div>
              <select value={savedStatusF} onChange={(e) => setSavedStatusF(e.target.value)} className={`${inputCls} sm:w-40 py-2`}>{['All', ...STATUSES].map((s) => <option key={s} style={{ background: '#141414' }}>{s === 'All' ? 'All Statuses' : s}</option>)}</select>
            </div>
            {(() => {
              const ql = savedQ.trim().toLowerCase();
              const list = [...savedCards]
                .filter((jc) => savedStatusF === 'All' || jc.status === savedStatusF)
                .filter((jc) => !ql || [jc.jobNo, jc.customer, jc.phone, jc.vehicle, jc.regNo, jc.vin, jc.engineNo, jc.advisor, jc.technician].filter(Boolean).join(' ').toLowerCase().includes(ql))
                .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
              const visible = list.slice(0, savedLimit);
              return (
                <>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] text-white/40">{list.length} job card{list.length === 1 ? '' : 's'}{list.length > savedLimit ? ` · showing ${savedLimit}` : ''}</span>
                </div>
                <div className="space-y-1.5 max-h-64 overflow-y-auto dark-scroll">
                  {visible.map((jc, i) => (
                    <div key={jc.jobNo || i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl" style={{ background: 'rgba(var(--fg-rgb),0.02)' }}>
                      <button type="button" onClick={() => setPreviewCard(jc)} className="flex-1 min-w-0 text-left">
                        <span className="text-sm text-white/85 font-medium">{jc.jobNo}</span>
                        <span className="text-[11px] text-white/40"> · {jc.customer || '—'} · {jc.vehicle || '—'}</span>
                      </button>
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold flex-shrink-0" style={{ background: `${statusColor(jc.status)}1f`, color: statusColor(jc.status) }}>{jc.status}</span>
                      <div className="flex gap-1 flex-shrink-0">
                        <button onClick={() => setPreviewCard(jc)} title="Preview" className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/55 hover:bg-white/10"><Eye size={12} /></button>
                        <button onClick={() => loadCard(jc)} title="Edit" className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/55 hover:bg-white/10"><Edit3 size={12} /></button>
                        <button onClick={() => duplicateCard(jc)} title="Duplicate" className="hidden sm:flex w-7 h-7 rounded-lg items-center justify-center bg-white/5 border border-white/10 text-white/55 hover:bg-white/10"><Copy size={12} /></button>
                        <button onClick={() => downloadPDF(jc, true)} title="Print" className="hidden sm:flex w-7 h-7 rounded-lg items-center justify-center bg-white/5 border border-white/10 text-white/55 hover:bg-white/10"><Printer size={12} /></button>
                        <button onClick={() => downloadPDF(jc, false)} title="Download PDF" className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/55 hover:bg-white/10"><FileDown size={12} /></button>
                        <button onClick={async () => { if (demoMode && !demoCanDelete) { toast('This action has been disabled by the administrator.', { icon: '🔒' }); return; } if (await confirmDialog({ title: `Delete job card ${jc.jobNo}?`, message: 'This cannot be undone.', danger: true, confirmText: 'Delete' })) { onDelete?.(jc.jobNo); toast.success('Job card deleted'); } }} title={demoMode && !demoCanDelete ? 'Disabled by administrator' : 'Delete'} className={`w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 ${demoMode && !demoCanDelete ? 'text-white/25' : 'text-red-400/70 hover:bg-red-500/10'}`}><Trash2 size={12} /></button>
                      </div>
                    </div>
                  ))}
                  {list.length === 0 && <p className="text-xs text-white/35 text-center py-4">No job cards match your search.</p>}
                  {list.length > savedLimit && <button onClick={() => setSavedLimit((n) => n + 20)} className="w-full py-2 rounded-xl text-xs font-semibold bg-white/5 border border-white/10 text-white/70 hover:bg-white/10">Show more ({list.length - savedLimit} more)</button>}
                </div>
                </>
              );
            })()}
          </div>
        )}

        {previewCard && (
          <div className="fixed inset-0 z-[120] flex justify-end" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setPreviewCard(null)}>
            <div className="w-full max-w-md h-full overflow-y-auto dark-scroll p-5" style={{ background: 'var(--surface-1)', borderLeft: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-white">{previewCard.jobNo}</h3>
                <button onClick={() => setPreviewCard(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10"><X size={17} /></button>
              </div>
              <div className="space-y-2.5 text-sm">
                {[['Customer', previewCard.customer], ['Phone', previewCard.phone], ['Vehicle', previewCard.vehicle], ['Reg No.', previewCard.regNo], ['Advisor', previewCard.advisor], ['Status', previewCard.status], ['Date In', fmtDT(previewCard.dateIn)], ['Promised', fmtDT(previewCard.promised)]].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3"><span className="text-white/40">{k}</span><span className="text-white/85 text-right">{v || '—'}</span></div>
                ))}
                <div><p className="text-white/40 mb-1">Complaints</p>{(previewCard.complaints || []).filter(Boolean).map((c, x) => <p key={x} className="text-white/75 text-xs">• {c}</p>)}</div>
                <div><p className="text-white/40 mb-1">Diagnosis</p>{(previewCard.diagnosis || []).filter(Boolean).map((c, x) => <p key={x} className="text-white/75 text-xs">• {c}</p>)}</div>
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={() => { loadCard(previewCard); setPreviewCard(null); }} className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-white/5 border border-white/10 text-white/80 flex items-center justify-center gap-1.5"><Edit3 size={13} /> Edit</button>
                <button onClick={() => downloadPDF(previewCard, false)} className="flex-1 py-2.5 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] flex items-center justify-center gap-1.5"><FileDown size={13} /> PDF</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* -------- live preview column -------- */}
      <div className={`${fullPreview ? 'w-full' : 'hidden xl:block xl:w-[430px] xl:flex-shrink-0'} mt-4 xl:mt-0`}>
        <div className="xl:sticky xl:top-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-white/70 uppercase tracking-wide">Job Card PDF Preview <span className="ml-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">READY</span></h3>
            <div className="flex gap-1.5">
              <button onClick={() => downloadPDF(cardRef.current)} title="Download PDF" className="h-8 px-3 rounded-lg flex items-center gap-1.5 text-[11px] font-bold bg-white/5 border border-white/10 text-white/75 hover:bg-white/10"><FileDown size={13} /> Download PDF</button>
              <button onClick={() => setFullPreview((f) => !f)} title="Toggle full preview" className="w-8 h-8 rounded-lg hidden xl:flex items-center justify-center bg-white/5 border border-white/10 text-white/70 hover:bg-white/10">{fullPreview ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
            </div>
          </div>
          <div className="rounded-xl overflow-hidden" style={{ background: '#f5f2ea', color: '#1c1a16', maxHeight: '82vh', overflowY: 'auto' }}>
            {/* header */}
            <div style={{ background: '#161616', padding: '14px 16px', textAlign: 'center' }}>
              <p style={{ color: '#d4af37', fontWeight: 800, fontSize: 15, letterSpacing: '0.06em' }}>{SHOP.name}</p>
              <p style={{ color: '#ddd', fontSize: 7, letterSpacing: '0.14em', marginTop: 2 }}>{SHOP.tag}</p>
              <p style={{ color: '#d4af37', fontSize: 8, marginTop: 4 }}>{demoMode ? 'XXXXXXXXXX' : SHOP.phones}</p>
              <p style={{ color: '#ccc', fontSize: 7, marginTop: 2 }}>{demoMode ? MASK : SHOP.address}</p>
              <p style={{ color: '#aaa', fontSize: 6.5, marginTop: 2 }}>GST: {demoMode ? MASK : SHOP.gst} · {demoMode ? MASK : SHOP.email} · {demoMode ? MASK : SHOP.website}</p>
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
