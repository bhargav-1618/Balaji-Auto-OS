// components/vehicles/VehiclesModule.jsx — Part 2 master rebuild.
// Vehicles are the single source of truth for anything vehicle-shaped, but are
// stored nested under their owning customer (customers[].vehicles) to prevent
// orphan records. This module gives full read/write over that data: rich
// dashboard, comprehensive search/filter/sort, a 7-step Add/Edit wizard with
// cascading make→model→variant, multi-photo capture (compressed) + documents,
// a tabbed detail panel, auto service history from Job Cards, reminders, and
// CSV/print export. All subcomponents hoisted (focus-safe).
import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { confirmDialog } from '../common/ConfirmDialog';
import Toggle from '../common/Toggle';
import {
  Car, Search, FileDown, ClipboardList, AlertTriangle, User, Plus, X, Edit3, Trash2,
  Eye, ChevronDown, ChevronLeft, ChevronRight, Camera, Star, Shield, FileText, Wrench,
  Copy, Archive, MoreVertical, IndianRupee, Clock, Printer, MapPin,
} from 'lucide-react';
import { VEHICLES, MAKES, variantsFor, FUELS, TRANSMISSIONS, BODY_TYPES, DRIVE_TYPES, OWNERSHIP_TYPES } from '../../lib/vehicleCatalog';
import { num } from '../../lib/format';

const inputCls = 'w-full px-3 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 text-white placeholder-white/25 outline-none focus:border-[#d4af37]/60 transition';
const cardStyle = { background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' };
const inr = (n) => `₹${num(n).toLocaleString('en-IN')}`;
const daysUntil = (d) => { if (!d) return null; return Math.round((new Date(d).getTime() - Date.now()) / 86400000); };
const expiryBadge = (d) => { const n = daysUntil(d); if (n === null) return null; if (n < 0) return { t: 'Expired', c: '#f87171' }; if (n <= 30) return { t: `${n}d`, c: '#fbbf24' }; return { t: 'Valid', c: '#34d399' }; };
const compressImage = (file, maxDim = 1000, quality = 0.7) => new Promise((resolve, reject) => {
  if (!file || !file.type.startsWith('image/')) { reject(new Error('Not an image')); return; }
  if (file.size > 10 * 1024 * 1024) { reject(new Error('Image exceeds 10MB')); return; }
  const reader = new FileReader();
  reader.onload = () => { const img = new Image(); img.onload = () => {
    let { width, height } = img;
    if (width > height && width > maxDim) { height = Math.round((height * maxDim) / width); width = maxDim; }
    else if (height > maxDim) { width = Math.round((width * maxDim) / height); height = maxDim; }
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    resolve(canvas.toDataURL('image/jpeg', quality));
  }; img.onerror = reject; img.src = reader.result; };
  reader.onerror = reject; reader.readAsDataURL(file);
});

function Stat({ icon: Icon, label, value, color, active, onClick }) {
  return (
    <button type="button" onClick={onClick} className="rounded-2xl p-3.5 flex items-center gap-3 text-left transition active:scale-[0.98]" style={{ ...cardStyle, ...(active ? { borderColor: 'rgba(212,175,55,0.5)', background: 'rgba(212,175,55,0.06)' } : {}) }}>
      <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${color}1f`, color }}><Icon size={18} /></span>
      <div className="min-w-0"><p className="text-[10px] uppercase tracking-wide text-white/40 truncate">{label}</p><p className="text-lg font-bold text-white leading-tight">{value}</p></div>
    </button>
  );
}
function Cascade({ make, model, variant, onChange }) {
  const models = make ? (VEHICLES[make] || []) : [];
  const variants = variantsFor(make);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <MiniSelect label="Manufacturer *" value={make} placeholder="Select make" options={MAKES} onPick={(m) => onChange({ make: m, model: '', variant: '' })} allowAdd onAdd={(v) => onChange({ make: v, model: '', variant: '' })} />
      <MiniSelect label="Model *" value={model} placeholder={make ? 'Select model' : 'Make first'} options={models} disabled={!make} onPick={(m) => onChange({ model: m })} allowAdd onAdd={(v) => onChange({ model: v })} />
      <MiniSelect label="Variant" value={variant} placeholder="Variant" options={variants} onPick={(v) => onChange({ variant: v })} allowAdd onAdd={(v) => onChange({ variant: v })} />
    </div>
  );
}
function MiniSelect({ label, value, placeholder, options, onPick, disabled, allowAdd, onAdd }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useEffect(() => { if (!open) return undefined; const d = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', d); return () => document.removeEventListener('mousedown', d); }, [open]);
  const shown = useMemo(() => { const l = q.trim().toLowerCase(); return (l ? options.filter((o) => o.toLowerCase().includes(l)) : options); }, [q, options]);
  return (
    <div>
      {label && <label className="block text-[10px] uppercase tracking-wide text-white/40 mb-1.5">{label}</label>}
      <div className="relative" ref={ref}>
        <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} className={`${inputCls} flex items-center justify-between text-left ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
          <span className={value ? 'text-white' : 'text-white/25'}>{value || placeholder}</span><ChevronDown size={14} className="text-white/35 flex-shrink-0" />
        </button>
        {open && !disabled && (
          <div className="absolute z-50 mt-1 w-full rounded-xl overflow-hidden shadow-2xl" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }}>
            <div className="relative p-2" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.07)' }}>
              <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-full pl-8 pr-2 py-2 rounded-lg text-sm bg-white/5 border border-white/10 text-white placeholder-white/25 outline-none" />
            </div>
            <div className="max-h-52 overflow-y-auto dark-scroll">
              {shown.map((o) => <button key={o} type="button" onClick={() => { onPick(o); setOpen(false); setQ(''); }} className={`w-full text-left px-3 py-2 text-sm transition ${o === value ? 'bg-[#d4af37]/15 text-white' : 'text-white/75 hover:bg-white/5'}`}>{o}</button>)}
              {shown.length === 0 && <p className="px-3 py-3 text-xs text-white/40">No matches.</p>}
            </div>
            {allowAdd && q.trim() && !options.includes(q.trim()) && (
              <button type="button" onClick={() => { onAdd(q.trim()); setOpen(false); setQ(''); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-bold text-[#d4af37] hover:bg-white/5" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.07)' }}><Plus size={13} /> Add “{q.trim()}”</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
function WField({ label, req, error, children, className = '' }) {
  return <div className={`min-w-0 ${className}`}><label className="block text-[10px] uppercase tracking-wide text-white/40 mb-1.5">{label}{req && <span className="text-red-400"> *</span>}</label>{children}{error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}</div>;
}

const emptyVehicle = () => ({
  id: `v_${Date.now()}_${Math.floor(Math.random() * 1e4)}`, regNo: '', make: '', model: '', variant: '', fuel: 'Petrol',
  transmission: 'Manual', year: '', color: '', bodyType: '', driveType: '', engineCC: '', isEV: false, batteryCapacity: '',
  regState: '', regDistrict: '', vin: '', engineNo: '', chassisNo: '', rcNumber: '', regDate: '', mfgDate: '', purchaseDate: '',
  odometer: '', serviceInterval: '10000', lastServiceKM: '', nextServiceKM: '', nextServiceDate: '',
  nickname: '', ownershipType: 'Primary Owner',
  insurer: '', policyNo: '', policyStart: '', policyEnd: '', idv: '', claimHistory: '', agentName: '', agentPhone: '', roadside: false, extWarranty: false, warrantyExpiry: '', pucExpiry: '',
  photos: [], coverPhoto: 0, documents: [], knownIssues: '', preferredOil: '', preferredBrand: '', specialInstructions: '', notes: '', tags: '',
  status: 'Active', createdAt: Date.now(), history: [],
});

// Normalize a vehicle object so every optional collection and nested object always
// has a safe default. Vehicles created by older demo data / earlier schema versions
// may be missing arrays like `photos` or `documents`; rendering `.length`/`.map` on
// those throws at runtime. We merge the incoming vehicle over a full default template
// (never overwriting real values with defaults) and coerce the known collections to
// arrays and the known nested containers to objects. This is done ONCE at the edges
// (wizard init, list mapping) so the UI can use the values directly and safely.
const asArray = (v) => (Array.isArray(v) ? v : []);
const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const normalizeVehicle = (v = {}) => {
  const base = emptyVehicle();
  const merged = { ...base, ...v };
  // guarantee every optional collection is a real array
  merged.photos = asArray(v.photos);
  merged.documents = asArray(v.documents);
  merged.history = asArray(v.history);
  merged.serviceHistory = asArray(v.serviceHistory);
  merged.fuelHistory = asArray(v.fuelHistory);
  merged.attachments = asArray(v.attachments);
  merged.reminders = asArray(v.reminders);
  merged.tags = v.tags == null ? '' : v.tags;
  // `insurance` may be an optional nested object in newer data; default to {}.
  merged.insurance = asObject(v.insurance);
  // NOTE: `owner` is overloaded — in row objects it holds the owner's display NAME
  // (a string). Preserve whatever was passed; only default to {} when truly absent
  // so we never clobber the name used by the table/detail views.
  merged.owner = v.owner == null ? {} : v.owner;
  // numeric index guard for the cover photo
  merged.coverPhoto = Number.isFinite(v.coverPhoto) ? v.coverPhoto : 0;
  if (merged.coverPhoto >= merged.photos.length) merged.coverPhoto = 0;
  // string fields rendered directly should never be undefined
  ['notes', 'knownIssues', 'specialInstructions', 'nickname', 'regNo', 'make', 'model', 'variant'].forEach((k) => { if (merged[k] == null) merged[k] = ''; });
  return merged;
};

// derive combined model string for legacy fields (job cards read v.model as "Make Model")
const combinedModel = (v) => [v.make, v.model].filter(Boolean).join(' ') + (v.variant ? ` ${v.variant}` : '');

function VehicleWizard({ initial, customers = [], existingVehicles = [], onSave, onClose, onCreateCustomer }) {
  // Seed customerId from the row-derived ownerId so the owner picker reflects the
  // current owner when editing (prevents "no owner selected" + save data-loss).
  // Normalize up-front so every optional collection/object is guaranteed present.
  // This is the single source of the crash fix: the form below can use f.photos,
  // f.documents, etc. directly without defensive checks.
  const [f, setF] = useState(() => normalizeVehicle({ ...initial, customerId: initial.customerId || initial.ownerId || '' }));
  const [step, setStep] = useState(0);
  const [custQ, setCustQ] = useState('');
  const [custOpen, setCustOpen] = useState(false);
  const set = (patch) => setF((s) => ({ ...s, ...patch }));
  const custRef = useRef(null);
  useEffect(() => { if (!custOpen) return undefined; const d = (e) => { if (custRef.current && !custRef.current.contains(e.target)) setCustOpen(false); }; document.addEventListener('mousedown', d); return () => document.removeEventListener('mousedown', d); }, [custOpen]);

  const STEPS = [
    { key: 'vehicle', label: 'Vehicle', icon: Car },
    { key: 'identity', label: 'Identification', icon: FileText },
    { key: 'owner', label: 'Ownership', icon: User },
    { key: 'insurance', label: 'Insurance', icon: Shield },
    { key: 'photos', label: `Photos${f.photos.length ? ` (${f.photos.length})` : ''}`, icon: Camera },
    { key: 'documents', label: 'Documents', icon: FileText },
    { key: 'notes', label: 'Notes', icon: Edit3 },
  ];

  const regErr = f.regNo && !/^[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{0,3}[ -]?\d{1,4}$/.test(f.regNo.replace(/\s/g, '')) ? 'Format like TS09EX1234' : null;
  const vinErr = f.vin && f.vin.length !== 17 ? 'VIN must be exactly 17 characters' : null;
  const dupReg = f.regNo && existingVehicles.some((v) => v.id !== f.id && (v.regNo || '').toUpperCase() === f.regNo.toUpperCase());
  const dupVin = f.vin && existingVehicles.some((v) => v.id !== f.id && v.vin && (v.vin || '').toUpperCase() === f.vin.toUpperCase());
  const dupEngine = f.engineNo && existingVehicles.some((v) => v.id !== f.id && v.engineNo && (v.engineNo || '').toUpperCase() === f.engineNo.toUpperCase());
  const odoErr = initial.odometer && num(f.odometer) < num(initial.odometer) ? `Odometer cannot be below previous (${initial.odometer} km)` : null;

  const validate = () => {
    if (!f.regNo.trim()) { setStep(0); return 'Registration number is required'; }
    if (regErr) { setStep(0); return regErr; }
    if (dupReg) { setStep(0); return 'A vehicle with this registration already exists'; }
    if (!f.make || !f.model) { setStep(0); return 'Manufacturer and model are required'; }
    if (vinErr) { setStep(1); return vinErr; }
    if (dupVin) { setStep(1); return 'This VIN already exists'; }
    if (odoErr) { setStep(1); return odoErr; }
    if (!f.customerId) { setStep(2); return 'Select an owner (or create a customer first)'; }
    return null;
  };
  const save = () => { const err = validate(); if (err) return toast.error(err); onSave({ ...f, regNo: f.regNo.toUpperCase(), model: f.model, vehicle: combinedModel(f) }); };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });

  const owner = customers.find((c) => c.id === f.customerId);
  const custShown = useMemo(() => { const l = custQ.trim().toLowerCase(); return (l ? customers.filter((c) => [c.name, c.phone, c.code].filter(Boolean).join(' ').toLowerCase().includes(l)) : customers).slice(0, 30); }, [custQ, customers]);

  const addPhotos = async (files) => {
    const imgs = [];
    for (const file of Array.from(files).slice(0, 30)) { try { imgs.push(await compressImage(file)); } catch (e) { toast.error(e.message || 'Image error'); } }
    if (imgs.length) set({ photos: [...f.photos, ...imgs].slice(0, 30) });
  };
  const addDocs = async (files) => {
    const docs = [];
    for (const file of Array.from(files).slice(0, 10)) {
      if (file.size > 10 * 1024 * 1024) { toast.error(`${file.name}: exceeds 10MB`); continue; }
      try { const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); docs.push({ name: file.name, type: file.type, data }); } catch { toast.error('Could not read document'); }
    }
    if (docs.length) set({ documents: [...f.documents, ...docs] });
  };

  const DOC_TYPES = ['RC', 'Insurance', 'PUC', 'Invoice', 'Warranty Card', 'Fastag', 'Emission Certificate'];

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div className="w-full sm:max-w-3xl max-h-[94vh] flex flex-col rounded-t-2xl sm:rounded-2xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
          <h3 className="text-base font-bold text-white">{initial.regNo ? `Edit ${initial.regNo}` : 'Add Vehicle'}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10"><X size={17} /></button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col sm:flex-row">
          <div className="sm:w-44 flex-shrink-0 flex sm:flex-col gap-1 p-3 overflow-x-auto sm:overflow-visible" style={{ borderRight: '1px solid rgba(var(--fg-rgb),0.06)' }}>
            {STEPS.map((s, i) => (
              <button key={s.key} type="button" onClick={() => setStep(i)} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition ${step === i ? 'text-[#d4af37]' : 'text-white/55 hover:text-white/90 hover:bg-white/5'}`} style={step === i ? { background: 'rgba(212,175,55,0.1)' } : undefined}><s.icon size={14} /> {s.label}</button>
            ))}
          </div>
          <div className="flex-1 min-w-0 overflow-y-auto dark-scroll p-5">
            {step === 0 && (
              <div className="space-y-3">
                <WField label="Registration Number" req error={regErr || (dupReg ? 'Already exists' : null)}><input value={f.regNo} onChange={(e) => set({ regNo: e.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, '').slice(0, 13) })} placeholder="TS09EX1234" className={inputCls} /></WField>
                <Cascade make={f.make} model={f.model} variant={f.variant} onChange={set} />
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <WField label="Fuel"><select value={f.fuel} onChange={(e) => set({ fuel: e.target.value, isEV: e.target.value === 'Electric' })} className={inputCls}>{FUELS.map((x) => <option key={x} style={{ background: '#141414' }}>{x}</option>)}</select></WField>
                  <WField label="Transmission"><select value={f.transmission} onChange={(e) => set({ transmission: e.target.value })} className={inputCls}>{TRANSMISSIONS.map((x) => <option key={x} style={{ background: '#141414' }}>{x}</option>)}</select></WField>
                  <WField label="Year"><input value={f.year} inputMode="numeric" onChange={(e) => set({ year: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="2021" className={inputCls} /></WField>
                  <WField label="Color"><input value={f.color} onChange={(e) => set({ color: e.target.value })} placeholder="White" className={inputCls} /></WField>
                  <WField label="Body Type"><select value={f.bodyType} onChange={(e) => set({ bodyType: e.target.value })} className={inputCls}><option value="" style={{ background: '#141414' }}>—</option>{BODY_TYPES.map((x) => <option key={x} style={{ background: '#141414' }}>{x}</option>)}</select></WField>
                  <WField label="Drive Type"><select value={f.driveType} onChange={(e) => set({ driveType: e.target.value })} className={inputCls}><option value="" style={{ background: '#141414' }}>—</option>{DRIVE_TYPES.map((x) => <option key={x} style={{ background: '#141414' }}>{x}</option>)}</select></WField>
                  <WField label="Engine CC"><input value={f.engineCC} inputMode="numeric" onChange={(e) => set({ engineCC: e.target.value.replace(/\D/g, '').slice(0, 5) })} placeholder="1197" className={inputCls} /></WField>
                  <WField label={f.isEV ? 'Battery (kWh)' : 'Battery (if EV)'}><input value={f.batteryCapacity} onChange={(e) => set({ batteryCapacity: e.target.value })} disabled={!f.isEV} placeholder={f.isEV ? '40.5' : '—'} className={`${inputCls} ${!f.isEV ? 'opacity-50' : ''}`} /></WField>
                  <div className="flex items-center gap-2.5 mt-5"><Toggle on={!!f.isEV} onChange={(v) => set({ isEV: v })} aria-label="Electric Vehicle" /><span className="text-xs text-white/70">Electric Vehicle</span></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <WField label="Registration State"><input value={f.regState} onChange={(e) => set({ regState: e.target.value })} placeholder="Telangana" className={inputCls} /></WField>
                  <WField label="Registration District"><input value={f.regDistrict} onChange={(e) => set({ regDistrict: e.target.value })} className={inputCls} /></WField>
                </div>
              </div>
            )}
            {step === 1 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <WField label="VIN" error={vinErr || (dupVin ? 'Already exists' : null)}><input value={f.vin} onChange={(e) => set({ vin: e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '').slice(0, 17) })} placeholder="17 characters" className={inputCls} /></WField>
                <WField label="Engine Number" error={dupEngine ? 'Duplicate engine no. — please verify' : null}><input value={f.engineNo} onChange={(e) => set({ engineNo: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 25) })} className={inputCls} /></WField>
                <WField label="Chassis Number"><input value={f.chassisNo} onChange={(e) => set({ chassisNo: e.target.value.toUpperCase() })} className={inputCls} /></WField>
                <WField label="RC Number"><input value={f.rcNumber} onChange={(e) => set({ rcNumber: e.target.value.toUpperCase() })} className={inputCls} /></WField>
                <WField label="Registration Date"><input type="date" value={f.regDate} onChange={(e) => set({ regDate: e.target.value })} className={inputCls} style={{ colorScheme: 'dark' }} /></WField>
                <WField label="Manufacturing Date"><input type="date" value={f.mfgDate} onChange={(e) => set({ mfgDate: e.target.value })} className={inputCls} style={{ colorScheme: 'dark' }} /></WField>
                <WField label="Purchase Date"><input type="date" value={f.purchaseDate} onChange={(e) => set({ purchaseDate: e.target.value })} className={inputCls} style={{ colorScheme: 'dark' }} /></WField>
                <WField label="Odometer (KM)" error={odoErr}><input value={f.odometer} inputMode="numeric" onChange={(e) => set({ odometer: e.target.value.replace(/\D/g, '').slice(0, 7) })} className={inputCls} /></WField>
                <WField label="Service Interval (KM)"><input value={f.serviceInterval} inputMode="numeric" onChange={(e) => set({ serviceInterval: e.target.value.replace(/\D/g, '').slice(0, 6) })} className={inputCls} /></WField>
                <WField label="Last Service KM"><input value={f.lastServiceKM} inputMode="numeric" onChange={(e) => set({ lastServiceKM: e.target.value.replace(/\D/g, '').slice(0, 7) })} className={inputCls} /></WField>
                <WField label="Next Service KM"><input value={f.nextServiceKM} inputMode="numeric" onChange={(e) => set({ nextServiceKM: e.target.value.replace(/\D/g, '').slice(0, 7) })} className={inputCls} /></WField>
                <WField label="Next Service Date"><input type="date" value={f.nextServiceDate} onChange={(e) => set({ nextServiceDate: e.target.value })} className={inputCls} style={{ colorScheme: 'dark' }} /></WField>
              </div>
            )}
            {step === 2 && (
              <div className="space-y-3">
                <WField label="Owner (Customer)" req>
                  <div className="relative" ref={custRef}>
                    <button type="button" onClick={() => setCustOpen((o) => !o)} className={`${inputCls} flex items-center justify-between text-left`}>
                      <span className={owner ? 'text-white' : 'text-white/25'}>{owner ? `${owner.name} · ${owner.phone}` : 'Select customer…'}</span><ChevronDown size={14} className="text-white/35" />
                    </button>
                    {custOpen && (
                      <div className="absolute z-50 mt-1 w-full rounded-xl overflow-hidden shadow-2xl" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }}>
                        <div className="relative p-2" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.07)' }}>
                          <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
                          <input autoFocus value={custQ} onChange={(e) => setCustQ(e.target.value)} placeholder="Search name / phone…" className="w-full pl-8 pr-2 py-2 rounded-lg text-sm bg-white/5 border border-white/10 text-white outline-none" />
                        </div>
                        <div className="max-h-56 overflow-y-auto dark-scroll">
                          {custShown.map((c) => <button key={c.id} type="button" onClick={() => { set({ customerId: c.id }); setCustOpen(false); setCustQ(''); }} className="w-full text-left px-3 py-2 hover:bg-white/5"><p className="text-sm text-white/85">{c.name}</p><p className="text-[10px] text-white/40">{c.code} · {c.phone}</p></button>)}
                          {custShown.length === 0 && <p className="px-3 py-3 text-xs text-white/40">No customers found.</p>}
                        </div>
                        {onCreateCustomer && <button type="button" onClick={() => { setCustOpen(false); onCreateCustomer(); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-bold text-[#d4af37] hover:bg-white/5" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.07)' }}><Plus size={13} /> Create New Customer</button>}
                      </div>
                    )}
                  </div>
                </WField>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <WField label="Vehicle Nickname"><input value={f.nickname} onChange={(e) => set({ nickname: e.target.value })} placeholder="e.g. Office car" className={inputCls} /></WField>
                  <WField label="Ownership Type"><select value={f.ownershipType} onChange={(e) => set({ ownershipType: e.target.value })} className={inputCls}>{OWNERSHIP_TYPES.map((x) => <option key={x} style={{ background: '#141414' }}>{x}</option>)}</select></WField>
                </div>
              </div>
            )}
            {step === 3 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <WField label="Insurance Company"><input value={f.insurer} onChange={(e) => set({ insurer: e.target.value })} className={inputCls} /></WField>
                <WField label="Policy Number"><input value={f.policyNo} onChange={(e) => set({ policyNo: e.target.value })} className={inputCls} /></WField>
                <WField label="Policy Start"><input type="date" value={f.policyStart} onChange={(e) => set({ policyStart: e.target.value })} className={inputCls} style={{ colorScheme: 'dark' }} /></WField>
                <WField label="Policy End / Insurance Expiry"><input type="date" value={f.policyEnd} onChange={(e) => set({ policyEnd: e.target.value, insuranceExpiry: e.target.value })} className={inputCls} style={{ colorScheme: 'dark' }} /></WField>
                <WField label="IDV (₹)"><input value={f.idv} inputMode="numeric" onChange={(e) => set({ idv: e.target.value.replace(/\D/g, '') })} className={inputCls} /></WField>
                <WField label="Claim History"><input value={f.claimHistory} onChange={(e) => set({ claimHistory: e.target.value })} placeholder="e.g. 1 claim (2024)" className={inputCls} /></WField>
                <WField label="Agent Name"><input value={f.agentName} onChange={(e) => set({ agentName: e.target.value })} className={inputCls} /></WField>
                <WField label="Agent Phone"><input value={f.agentPhone} inputMode="numeric" onChange={(e) => set({ agentPhone: e.target.value.replace(/\D/g, '').slice(0, 10) })} className={inputCls} /></WField>
                <WField label="PUC Expiry"><input type="date" value={f.pucExpiry} onChange={(e) => set({ pucExpiry: e.target.value })} className={inputCls} style={{ colorScheme: 'dark' }} /></WField>
                <WField label="Warranty Expiry"><input type="date" value={f.warrantyExpiry} onChange={(e) => set({ warrantyExpiry: e.target.value })} className={inputCls} style={{ colorScheme: 'dark' }} /></WField>
                <div className="flex items-center gap-2.5"><Toggle on={!!f.roadside} onChange={(v) => set({ roadside: v })} aria-label="Roadside Assistance" /><span className="text-xs text-white/70">Roadside Assistance</span></div>
                <div className="flex items-center gap-2.5"><Toggle on={!!f.extWarranty} onChange={(v) => set({ extWarranty: v })} aria-label="Extended Warranty" /><span className="text-xs text-white/70">Extended Warranty</span></div>
              </div>
            )}
            {step === 4 && (
              <div>
                <p className="text-[11px] text-white/45 mb-2">Up to 30 photos — camera, gallery or drag & drop. First/marked photo is the cover.</p>
                <div className="flex flex-wrap gap-2" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addPhotos(e.dataTransfer.files); }}>
                  {f.photos.map((p, pi) => (
                    <div key={pi} className="relative w-20 h-20 rounded-lg overflow-hidden" style={{ border: (f.coverPhoto || 0) === pi ? '2px solid #d4af37' : '1px solid rgba(var(--fg-rgb),0.1)' }}>
                      <img src={p} alt="" className="w-full h-full object-cover" />
                      <button type="button" onClick={() => set({ coverPhoto: pi })} title="Cover" className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-black/70 flex items-center justify-center" style={{ color: (f.coverPhoto || 0) === pi ? '#d4af37' : '#fff' }}><Star size={10} fill={(f.coverPhoto || 0) === pi ? '#d4af37' : 'none'} /></button>
                      <button type="button" onClick={() => set({ photos: f.photos.filter((_, x) => x !== pi), coverPhoto: 0 })} className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center"><X size={10} /></button>
                      {(f.coverPhoto || 0) === pi && <span className="absolute bottom-0 inset-x-0 text-[7px] font-bold text-center text-black py-0.5" style={{ background: '#d4af37' }}>COVER</span>}
                    </div>
                  ))}
                  {f.photos.length < 30 && (
                    <label className="w-20 h-20 rounded-lg flex flex-col items-center justify-center cursor-pointer text-white/40 hover:text-white/70 transition" style={{ border: '1px dashed rgba(var(--fg-rgb),0.25)' }}>
                      <Camera size={16} /><span className="text-[8px] mt-0.5">Add</span>
                      <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />
                    </label>
                  )}
                </div>
                <p className="text-[10px] text-white/30 mt-2">Suggested angles: front, rear, left, right, interior, dashboard, odometer, engine bay, boot, roof, existing damages.</p>
              </div>
            )}
            {step === 5 && (
              <div>
                <p className="text-[11px] text-white/45 mb-2">Upload RC, Insurance, PUC, Invoice, Warranty, Fastag, Emission (PDF or image, max 10MB).</p>
                <div className="space-y-1.5 mb-3">
                  {f.documents.map((d, di) => (
                    <div key={di} className="flex items-center justify-between px-3 py-2 rounded-xl text-xs" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                      <span className="text-white/80 truncate flex items-center gap-2"><FileText size={13} className="text-white/40" /> {d.name}</span>
                      <div className="flex gap-2 flex-shrink-0">
                        <a href={d.data} download={d.name} className="text-white/50 hover:text-white"><FileDown size={13} /></a>
                        <button type="button" onClick={() => set({ documents: f.documents.filter((_, x) => x !== di) })} className="text-red-400/60 hover:text-red-400"><Trash2 size={13} /></button>
                      </div>
                    </div>
                  ))}
                  {f.documents.length === 0 && <p className="text-xs text-white/35 text-center py-3">No documents uploaded.</p>}
                </div>
                <label className="inline-flex items-center gap-2 h-10 px-4 rounded-xl text-xs font-bold cursor-pointer text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]"><Plus size={13} /> Upload Document<input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { addDocs(e.target.files); e.target.value = ''; }} /></label>
              </div>
            )}
            {step === 6 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <WField label="Known Issues" className="sm:col-span-2"><textarea value={f.knownIssues} onChange={(e) => set({ knownIssues: e.target.value })} rows={2} className={`${inputCls} resize-none`} /></WField>
                <WField label="Preferred Oil"><input value={f.preferredOil} onChange={(e) => set({ preferredOil: e.target.value })} className={inputCls} /></WField>
                <WField label="Preferred Brand"><input value={f.preferredBrand} onChange={(e) => set({ preferredBrand: e.target.value })} className={inputCls} /></WField>
                <WField label="Special Instructions" className="sm:col-span-2"><textarea value={f.specialInstructions} onChange={(e) => set({ specialInstructions: e.target.value })} rows={2} className={`${inputCls} resize-none`} /></WField>
                <WField label="Internal Notes" className="sm:col-span-2"><textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} className={`${inputCls} resize-none`} /></WField>
                <WField label="Tags" className="sm:col-span-2"><input value={f.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="comma,separated,tags" className={inputCls} /></WField>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 flex-shrink-0" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.08)', background: 'var(--surface-2)', paddingBottom: 'max(0.875rem, env(safe-area-inset-bottom))' }}>
          <button onClick={onClose} className="py-3 px-5 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80">Cancel</button>
          <div className="flex gap-2">
            {step > 0 && <button onClick={() => setStep((s) => s - 1)} className="py-3 px-5 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80">Back</button>}
            {step < STEPS.length - 1 ? <button onClick={() => setStep((s) => s + 1)} className="py-3 px-6 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">Next</button>
              : <button onClick={save} className="py-3 px-6 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">Save Vehicle</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VehiclesModule({ demoMode = false, demoCanDelete = false, canManage = true, isAdmin = false, customers = [], jobCards = [], invoices = [], setCustomers, onCreateJobCard, onCreateInvoice, onCreateCustomer }) {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [makeF, setMakeF] = useState('All');
  const [fuelF, setFuelF] = useState('All');
  const [statusF, setStatusF] = useState('All');
  const [quickF, setQuickF] = useState(null);
  const [sortBy, setSortBy] = useState('latest');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [selId, setSelId] = useState(null);
  const [edit, setEdit] = useState(null);
  const [detailTab, setDetailTab] = useState('Overview');
  const [menuFor, setMenuFor] = useState(null);

  // debounce search
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(1); }, [dq, makeF, fuelF, statusF, quickF, sortBy]);
  useEffect(() => { const onDoc = () => setMenuFor(null); document.addEventListener('click', onDoc); return () => document.removeEventListener('click', onDoc); }, []);

  const rows = useMemo(() => {
    const out = [];
    customers.forEach((c) => (c.vehicles || []).forEach((v) => out.push(normalizeVehicle({ ...v, ownerId: c.id, owner: c.name, ownerCode: c.code, ownerPhone: c.phone, ownerType: c.type }))));
    return out;
  }, [customers]);

  const jcOf = (v) => jobCards.filter((j) => (j.regNo || '').toUpperCase() === (v.regNo || '').toUpperCase());
  const invOf = (v) => invoices.filter((iv) => (iv.vehicle || '').toUpperCase().includes((v.regNo || '').toUpperCase()) || jcOf(v).length);
  const revenueOf = (v) => invOf(v).reduce((s, iv) => s + (iv.lines || []).reduce((a, l) => a + num(l.qty) * num(l.rate), 0), 0);
  const visitsOf = (v) => jcOf(v).length;

  const makes = useMemo(() => ['All', ...Array.from(new Set(rows.map((r) => r.make).filter(Boolean))).sort()], [rows]);

  const filtered = useMemo(() => {
    const ql = dq.trim().toLowerCase();
    let list = rows.filter((r) => {
      if (makeF !== 'All' && r.make !== makeF) return false;
      if (fuelF !== 'All' && r.fuel !== fuelF) return false;
      if (statusF !== 'All' && (r.status || 'Active') !== statusF) return false;
      if (quickF === 'inService' && !jcOf(r).some((j) => !['Delivered', 'Ready'].includes(j.status))) return false;
      if (quickF === 'insurance' && !(daysUntil(r.insuranceExpiry) !== null && daysUntil(r.insuranceExpiry) <= 30)) return false;
      if (quickF === 'puc' && !(daysUntil(r.pucExpiry) !== null && daysUntil(r.pucExpiry) <= 30)) return false;
      if (quickF === 'fleet' && !['Fleet', 'Taxi', 'Government'].includes(r.ownershipType)) return false;
      if (quickF === 'repeat' && visitsOf(r) < 2) return false;
      if (!ql) return true;
      const jobNos = jcOf(r).map((j) => j.jobNo); const invNos = invOf(r).map((iv) => iv.invNo);
      return [r.regNo, r.vin, r.engineNo, r.owner, r.ownerPhone, r.make, r.model, r.variant, r.fuel, r.transmission, r.insurer, r.rcNumber, r.tags, ...jobNos, ...invNos].filter(Boolean).join(' ').toLowerCase().includes(ql);
    });
    const sorters = {
      latest: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
      oldest: (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
      visits: (a, b) => visitsOf(b) - visitsOf(a),
      revenue: (a, b) => revenueOf(b) - revenueOf(a),
      lastService: (a, b) => (b.lastService || '').localeCompare(a.lastService || ''),
      upcoming: (a, b) => (a.nextServiceDate || '9999').localeCompare(b.nextServiceDate || '9999'),
    };
    return [...list].sort(sorters[sortBy] || sorters.latest);
  }, [rows, dq, makeF, fuelF, statusF, quickF, sortBy, jobCards, invoices]);

  const paged = filtered.slice((page - 1) * perPage, page * perPage);
  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  const selected = useMemo(() => rows.find((r) => r.id === selId) || null, [rows, selId]);

  const stats = useMemo(() => {
    const inService = rows.filter((r) => jcOf(r).some((j) => !['Delivered', 'Ready'].includes(j.status))).length;
    const todayStr = new Date().toISOString().slice(0, 10);
    return {
      total: rows.length,
      active: rows.filter((r) => (r.status || 'Active') === 'Active').length,
      inService,
      deliveries: jobCards.filter((j) => j.status === 'Delivered' && new Date(j.savedAt || 0).toISOString().slice(0, 10) === todayStr).length,
      insurance: rows.filter((r) => { const d = daysUntil(r.insuranceExpiry); return d !== null && d <= 30; }).length,
      puc: rows.filter((r) => { const d = daysUntil(r.pucExpiry); return d !== null && d <= 30; }).length,
      warranty: rows.filter((r) => r.extWarranty || (daysUntil(r.warrantyExpiry) !== null && daysUntil(r.warrantyExpiry) > 0)).length,
      fleet: rows.filter((r) => ['Fleet', 'Taxi', 'Government'].includes(r.ownershipType)).length,
      avgVisits: rows.length ? (rows.reduce((s, r) => s + visitsOf(r), 0) / rows.length).toFixed(1) : '0',
      revenue: rows.reduce((s, r) => s + revenueOf(r), 0),
      repeat: rows.filter((r) => visitsOf(r) >= 2).length,
    };
  }, [rows, jobCards, invoices]);

  const writeVehicle = (v) => {
    if (!setCustomers) { toast.error('Cannot save in read-only mode'); return; }
    // Resolve the target owner robustly: prefer the picker's customerId, fall back
    // to the row-derived ownerId. Without this, editing a vehicle whose object only
    // carried ownerId would strip it from its customer and re-add it nowhere.
    const targetId = v.customerId || v.ownerId;
    if (!targetId) { toast.error('Select an owner for this vehicle'); return; }
    const prevOwnerId = v.ownerId || v.customerId;
    // strip transient/display-only fields before persisting onto the customer
    const { ownerId, owner, ownerCode, ownerPhone, ownerType, ...clean } = v;
    const vv = { ...clean, customerId: targetId };
    setCustomers((prev) => prev.map((c) => {
      // remove from the previous owner if the vehicle moved to a different customer
      if (c.id !== targetId) {
        if (c.id === prevOwnerId && prevOwnerId !== targetId) {
          return { ...c, vehicles: (c.vehicles || []).filter((x) => x.id !== v.id) };
        }
        return c;
      }
      const exists = (c.vehicles || []).some((x) => x.id === v.id);
      const hist = [...(v.history || [])];
      hist.push({ at: Date.now(), action: exists ? 'Vehicle Updated' : 'Vehicle Created', detail: v.regNo, by: demoMode ? 'Demo User' : 'Admin' });
      const vehicles = exists
        ? c.vehicles.map((x) => (x.id === v.id ? { ...vv, history: hist } : x))
        : [...(c.vehicles || []), { ...vv, history: hist }];
      return { ...c, vehicles };
    }));
    setEdit(null);
    toast.success('Vehicle saved');
  };
  const archiveVehicle = (v) => {
    setCustomers((prev) => prev.map((c) => (c.id === v.ownerId ? { ...c, vehicles: (c.vehicles || []).map((x) => (x.id === v.id ? { ...x, status: x.status === 'Archived' ? 'Active' : 'Archived' } : x)) } : c)));
    toast.success(v.status === 'Archived' ? 'Vehicle restored' : 'Vehicle archived');
  };
  const deleteVehicle = async (v) => {
    if (demoMode && !demoCanDelete) { toast('This action has been disabled by the administrator.', { icon: '🔒' }); return; }
    if (!await confirmDialog({ title: `Delete ${v.regNo}?`, message: 'This cannot be undone.', danger: true, confirmText: 'Delete' })) return;
    setCustomers((prev) => prev.map((c) => (c.id === v.ownerId ? { ...c, vehicles: (c.vehicles || []).filter((x) => x.id !== v.id) } : c)));
    if (selId === v.id) setSelId(null);
    toast.success('Vehicle deleted');
  };
  const duplicateVehicle = (v) => { const copy = { ...emptyVehicle(), ...v, id: `v_${Date.now()}`, regNo: '', vin: '', history: [] }; setEdit(copy); };

  const exportCSV = () => {
    const head = ['Reg No', 'Make', 'Model', 'Variant', 'Fuel', 'Year', 'Owner', 'Phone', 'Insurance Expiry', 'PUC Expiry', 'Visits', 'Revenue'];
    const body = filtered.map((r) => [r.regNo, r.make, r.model, r.variant, r.fuel, r.year, r.owner, r.ownerPhone, r.insuranceExpiry, r.pucExpiry, visitsOf(r), revenueOf(r)]);
    const csv = [head, ...body].map((row) => row.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `vehicles-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };

  const STAT_CARDS = [
    { k: 'total', icon: Car, label: 'Total Vehicles', color: '#a78bfa', filter: null },
    { k: 'active', icon: Car, label: 'Active', color: '#34d399', filter: null },
    { k: 'inService', icon: Wrench, label: 'In Service', color: '#60a5fa', filter: 'inService' },
    { k: 'deliveries', icon: ClipboardList, label: "Today's Deliveries", color: '#22d3ee', filter: null },
    { k: 'insurance', icon: Shield, label: 'Insurance Expiring', color: '#f87171', filter: 'insurance' },
    { k: 'puc', icon: AlertTriangle, label: 'PUC Expiring', color: '#fbbf24', filter: 'puc' },
    { k: 'warranty', icon: Shield, label: 'Warranty', color: '#818cf8', filter: null },
    { k: 'fleet', icon: User, label: 'Fleet Vehicles', color: '#fb923c', filter: 'fleet' },
    { k: 'avgVisits', icon: Clock, label: 'Avg Visits', color: '#94a3b8', filter: null },
    { k: 'revenue', icon: IndianRupee, label: 'Revenue', color: '#d4af37', filter: null, fmt: inr },
    { k: 'repeat', icon: Clock, label: 'Repeat Vehicles', color: '#4ade80', filter: 'repeat' },
  ];

  return (
    <div className="xl:flex xl:gap-4 xl:items-start">
      <div className="xl:flex-1 xl:min-w-0">
        {/* dashboard */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 mb-4">
          {STAT_CARDS.map((s) => <Stat key={s.k} icon={s.icon} label={s.label} value={s.fmt ? s.fmt(stats[s.k]) : stats[s.k]} color={s.color} active={quickF === s.filter && s.filter !== null} onClick={() => setQuickF(s.filter && quickF !== s.filter ? s.filter : null)} />)}
        </div>

        {/* toolbar */}
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reg no., VIN, engine, owner, phone, job card, invoice, make…" className={`${inputCls} pl-9`} />
          </div>
          <select value={makeF} onChange={(e) => setMakeF(e.target.value)} className={`${inputCls} sm:w-36`}>{makes.map((m) => <option key={m} style={{ background: '#141414' }}>{m === 'All' ? 'All Makes' : m}</option>)}</select>
          <select value={fuelF} onChange={(e) => setFuelF(e.target.value)} className={`${inputCls} sm:w-32`}>{['All', ...FUELS].map((m) => <option key={m} style={{ background: '#141414' }}>{m === 'All' ? 'All Fuels' : m}</option>)}</select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className={`${inputCls} sm:w-40`}>{[['latest', 'Latest'], ['oldest', 'Oldest'], ['visits', 'Most Visits'], ['revenue', 'Highest Revenue'], ['lastService', 'Last Service'], ['upcoming', 'Upcoming Service']].map(([v, l]) => <option key={v} value={v} style={{ background: '#141414' }}>{l}</option>)}</select>
          <button onClick={exportCSV} className="h-11 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-white/5 border border-white/10 text-white/75 hover:bg-white/10"><FileDown size={13} /> Export</button>
          {canManage && <button onClick={() => setEdit(emptyVehicle())} className="h-11 px-4 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] flex items-center gap-1.5 active:scale-95 transition"><Plus size={14} /> Add Vehicle</button>}
        </div>

        {/* table */}
        <div className="rounded-2xl overflow-hidden" style={cardStyle}>
          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-sm min-w-[880px]">
              <thead className="sticky top-0 z-10" style={{ background: 'var(--surface-1)' }}>
                <tr className="text-[10px] uppercase tracking-wide text-white/40" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
                  {['Vehicle', 'Reg No.', 'Owner', 'Fuel', 'Year', 'Insurance', 'PUC', 'Visits', 'Revenue', 'Status', 'Actions'].map((h) => <th key={h} className="text-left font-semibold py-2.5 px-3 whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => {
                  const ins = expiryBadge(r.insuranceExpiry); const puc = expiryBadge(r.pucExpiry);
                  return (
                    <tr key={`${r.ownerId}-${r.id}`} className={`transition cursor-pointer ${selId === r.id ? 'bg-[#d4af37]/8' : 'hover:bg-white/[0.03]'}`} onClick={() => { setSelId(r.id); setDetailTab('Overview'); }} style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.05)' }}>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2.5">
                          {(r.photos || []).length > 0 ? <img src={r.photos[r.coverPhoto || 0]} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" /> : <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(212,175,55,0.12)' }}><Car size={15} className="text-[#d4af37]" /></span>}
                          <div className="min-w-0"><p className="text-white/90 font-medium truncate">{combinedModel(r) || '—'}</p><p className="text-[10px] text-white/40">{r.ownershipType}</p></div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3"><span className="text-[11px] font-bold px-2 py-0.5 rounded-md" style={{ background: 'rgba(212,175,55,0.12)', color: '#d4af37' }}>{r.regNo}</span></td>
                      <td className="py-2.5 px-3"><p className="text-white/85">{r.owner}</p><p className="text-[10px] text-white/40">{r.ownerPhone}</p></td>
                      <td className="py-2.5 px-3 text-white/60">{r.fuel}</td>
                      <td className="py-2.5 px-3 text-white/60">{r.year || '—'}</td>
                      <td className="py-2.5 px-3">{ins ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${ins.c}1f`, color: ins.c }}>{ins.t}</span> : <span className="text-white/30">—</span>}</td>
                      <td className="py-2.5 px-3">{puc ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${puc.c}1f`, color: puc.c }}>{puc.t}</span> : <span className="text-white/30">—</span>}</td>
                      <td className="py-2.5 px-3 text-center text-white/70">{visitsOf(r)}</td>
                      <td className="py-2.5 px-3 text-white/85">{inr(revenueOf(r))}</td>
                      <td className="py-2.5 px-3"><span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: (r.status || 'Active') === 'Active' ? '#34d3991f' : '#9ca3af1f', color: (r.status || 'Active') === 'Active' ? '#34d399' : '#9ca3af' }}>{r.status || 'Active'}</span></td>
                      <td className="py-2.5 px-3 relative" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1 items-center">
                          <button onClick={() => { setSelId(r.id); setDetailTab('Overview'); }} title="View" className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 hover:bg-white/10"><Eye size={12} /></button>
                          {canManage && <button onClick={() => setEdit(r)} title="Edit" className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 hover:bg-white/10"><Edit3 size={12} /></button>}
                          <button onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === r.id ? null : r.id); }} className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 hover:bg-white/10"><MoreVertical size={12} /></button>
                        </div>
                        {menuFor === r.id && (
                          <div className="absolute right-2 top-10 z-30 w-48 rounded-xl p-1 shadow-2xl" style={{ background: 'var(--surface-1)', border: '1px solid rgba(var(--fg-rgb),0.12)' }} onClick={(e) => e.stopPropagation()}>
                            {[
                              ['View', Eye, () => { setSelId(r.id); setMenuFor(null); }],
                              canManage && ['Edit', Edit3, () => { setEdit(r); setMenuFor(null); }],
                              canManage && ['Duplicate', Copy, () => { duplicateVehicle(r); setMenuFor(null); }],
                              ['Create Job Card', ClipboardList, () => { onCreateJobCard?.({ name: r.owner, phone: r.ownerPhone, vehicles: [r] }); setMenuFor(null); }],
                              ['Create Invoice', IndianRupee, () => { onCreateInvoice?.({ id: r.ownerId, name: r.owner, phone: r.ownerPhone, vehicles: [r] }); setMenuFor(null); }],
                              canManage && [(r.status === 'Archived' ? 'Restore' : 'Archive'), Archive, () => { archiveVehicle(r); setMenuFor(null); }],
                              canManage && ['Delete', Trash2, () => { setMenuFor(null); deleteVehicle(r); }, true],
                            ].filter(Boolean).map(([label, Icon, on, danger]) => (
                              <button key={label} onClick={on} className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition ${danger ? 'text-red-400 hover:bg-red-500/10' : 'text-white/75 hover:bg-white/5'}`}><Icon size={13} /> {label}</button>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {paged.length === 0 && <tr><td colSpan={11} className="py-10 text-center text-white/35 text-xs">No vehicles match. {canManage && 'Click “Add Vehicle” to register one.'}</td></tr>}
              </tbody>
            </table>
          </div>
          {/* Mobile: cards instead of horizontal-scroll table */}
          <div className="md:hidden divide-y" style={{ borderColor: 'rgba(var(--fg-rgb),0.06)' }}>
            {paged.map((r) => {
              const ins = expiryBadge(r.insuranceExpiry); const puc = expiryBadge(r.pucExpiry);
              return (
                <div key={`${r.ownerId}-${r.id}`} className="p-3.5" onClick={() => { setSelId(r.id); setDetailTab('Overview'); }}>
                  <div className="flex items-center gap-3">
                    {(r.photos || []).length > 0 ? <img src={r.photos[r.coverPhoto || 0]} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" /> : <span className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(212,175,55,0.12)' }}><Car size={16} className="text-[#d4af37]" /></span>}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white/90 font-medium truncate">{combinedModel(r) || '—'}</p>
                      <p className="text-[11px] text-white/45 truncate">{r.owner} · {r.ownerPhone}</p>
                    </div>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-md flex-shrink-0" style={{ background: 'rgba(212,175,55,0.12)', color: '#d4af37' }}>{r.regNo}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {ins && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${ins.c}1f`, color: ins.c }}>Ins: {ins.t}</span>}
                    {puc && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${puc.c}1f`, color: puc.c }}>PUC: {puc.t}</span>}
                    <span className="text-[10px] text-white/45">{visitsOf(r)} visits · {inr(revenueOf(r))}</span>
                    <div className="ml-auto flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                      {canManage && <button onClick={() => setEdit(r)} className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60"><Edit3 size={13} /></button>}
                      <button onClick={() => onCreateInvoice?.({ id: r.ownerId, name: r.owner, phone: r.ownerPhone, vehicles: [r] })} className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60"><IndianRupee size={13} /></button>
                    </div>
                  </div>
                </div>
              );
            })}
            {paged.length === 0 && <div className="py-10 text-center text-white/35 text-xs">No vehicles match. {canManage && 'Tap “Add Vehicle” to register one.'}</div>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.06)' }}>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-white/40">Showing {filtered.length ? (page - 1) * perPage + 1 : 0}–{Math.min(page * perPage, filtered.length)} of {filtered.length}</span>
              <select value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }} className="h-7 px-1.5 rounded-lg text-[11px] bg-white/5 border border-white/10 text-white/70 outline-none">{[10, 25, 50, 100].map((n) => <option key={n} value={n} style={{ background: '#141414' }}>{n} / page</option>)}</select>
            </div>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 disabled:opacity-30"><ChevronLeft size={14} /></button>
              <span className="text-xs text-white/60">{page} / {pageCount}</span>
              <button disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)} className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 disabled:opacity-30"><ChevronRight size={14} /></button>
            </div>
          </div>
        </div>
      </div>

      {/* detail panel */}
      <div className="xl:w-[370px] xl:flex-shrink-0 mt-4 xl:mt-0">
        <div className="xl:sticky xl:top-4 rounded-2xl p-4" style={cardStyle}>
          {!selected ? (
            <div className="py-16 text-center"><Car size={26} className="mx-auto text-white/20 mb-3" /><p className="text-sm font-bold text-white/80">Vehicle Details</p><p className="text-xs text-white/40 mt-1">Select a vehicle to view its full history, documents and service record.</p></div>
          ) : (
            <>
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-sm font-bold text-white/85">Vehicle Details</h3>
                <button onClick={() => setSelId(null)} className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:bg-white/10"><X size={14} /></button>
              </div>
              {(selected.photos || []).length > 0 ? (
                <img src={selected.photos[selected.coverPhoto || 0]} alt="" className="w-full h-36 rounded-xl object-cover mb-2" />
              ) : <div className="w-full h-36 rounded-xl flex items-center justify-center mb-2" style={{ background: 'rgba(212,175,55,0.06)' }}><Car size={30} className="text-[#d4af37]/50" /></div>}
              {(selected.photos || []).length > 1 && (
                <div className="flex gap-1.5 mb-3 overflow-x-auto dark-scroll">{selected.photos.map((p, pi) => <img key={pi} src={p} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" style={{ border: (selected.coverPhoto || 0) === pi ? '2px solid #d4af37' : '1px solid rgba(var(--fg-rgb),0.1)' }} />)}</div>
              )}
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-bold px-2 py-0.5 rounded-md" style={{ background: 'rgba(212,175,55,0.12)', color: '#d4af37' }}>{selected.regNo}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: (selected.status || 'Active') === 'Active' ? '#34d3991f' : '#9ca3af1f', color: (selected.status || 'Active') === 'Active' ? '#34d399' : '#9ca3af' }}>{selected.status || 'Active'}</span>
              </div>
              <p className="text-base font-bold text-white">{combinedModel(selected)}</p>
              <p className="text-xs text-white/50 mb-3 flex items-center gap-1.5"><User size={12} /> {selected.owner} · {selected.ownerPhone}</p>

              <div className="flex gap-1 mb-3 overflow-x-auto dark-scroll -mx-1 px-1">
                {['Overview', 'Service', 'Invoices', 'Documents', 'Insurance', 'Timeline', 'Notes'].map((t) => (
                  <button key={t} onClick={() => setDetailTab(t)} className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap transition ${detailTab === t ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]' : 'text-white/55 bg-white/5 border border-white/10 hover:bg-white/10'}`}>{t}</button>
                ))}
              </div>

              {detailTab === 'Overview' && (
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] rounded-xl p-3" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                  {[['Fuel', selected.fuel], ['Transmission', selected.transmission], ['Year', selected.year || '—'], ['Color', selected.color || '—'], ['Body', selected.bodyType || '—'], ['Engine CC', selected.engineCC || '—'], ['VIN', selected.vin || '—'], ['Engine No.', selected.engineNo || '—'], ['Odometer', selected.odometer ? `${Number(selected.odometer).toLocaleString('en-IN')} km` : '—'], ['Visits', visitsOf(selected)], ['Revenue', inr(revenueOf(selected))], ['Ownership', selected.ownershipType]].map(([k, v]) => (
                    <div key={k}><p className="text-white/35">{k}</p><p className="font-semibold text-white/85 truncate">{v}</p></div>
                  ))}
                </div>
              )}
              {detailTab === 'Service' && (
                <div className="space-y-1.5">
                  {jcOf(selected).length ? [...jcOf(selected)].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)).map((j, i) => (
                    <div key={i} className="px-3 py-2 rounded-xl text-xs" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                      <div className="flex justify-between"><span className="text-white/80 font-medium">{j.jobNo}</span><span className="text-white/40">{j.status}</span></div>
                      <p className="text-[10px] text-white/45 mt-0.5">{(j.complaints || []).filter(Boolean)[0] || 'Service'} · {j.advisor || '—'}</p>
                    </div>
                  )) : <p className="text-xs text-white/35 text-center py-4">No service history yet.</p>}
                  {canManage && <button onClick={() => onCreateJobCard?.({ name: selected.owner, phone: selected.ownerPhone, vehicles: [selected] })} className="w-full mt-2 h-9 rounded-lg text-[11px] font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">+ Create Job Card</button>}
                </div>
              )}
              {detailTab === 'Invoices' && (
                <div className="space-y-1.5">
                  {invOf(selected).length ? invOf(selected).map((iv, i) => (
                    <div key={i} className="flex justify-between px-3 py-2 rounded-xl text-xs" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}><span className="text-white/80">{iv.invNo} · {iv.date}</span><span style={{ color: iv.status === 'Paid' ? '#34d399' : '#f87171' }}>{iv.status}</span></div>
                  )) : <p className="text-xs text-white/35 text-center py-4">No invoices yet.</p>}
                </div>
              )}
              {detailTab === 'Documents' && (
                <div className="space-y-1.5">
                  {(selected.documents || []).length ? selected.documents.map((d, i) => (
                    <a key={i} href={d.data} download={d.name} className="flex items-center justify-between px-3 py-2 rounded-xl text-xs hover:bg-white/5" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}><span className="text-white/80 flex items-center gap-2 truncate"><FileText size={13} className="text-white/40" /> {d.name}</span><FileDown size={13} className="text-white/40" /></a>
                  )) : <p className="text-xs text-white/35 text-center py-4">No documents. Add them via Edit → Documents.</p>}
                </div>
              )}
              {detailTab === 'Insurance' && (
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] rounded-xl p-3" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                  {[['Insurer', selected.insurer || '—'], ['Policy No.', selected.policyNo || '—'], ['Valid Till', selected.insuranceExpiry || selected.policyEnd || '—'], ['IDV', selected.idv ? inr(selected.idv) : '—'], ['PUC Expiry', selected.pucExpiry || '—'], ['Warranty', selected.warrantyExpiry || (selected.extWarranty ? 'Extended' : '—')], ['Agent', selected.agentName || '—'], ['Agent Ph.', selected.agentPhone || '—']].map(([k, v]) => (
                    <div key={k}><p className="text-white/35">{k}</p><p className="font-semibold text-white/85 truncate">{v}</p></div>
                  ))}
                </div>
              )}
              {detailTab === 'Timeline' && (
                <div className="space-y-2">
                  {[...(selected.history || [])].reverse().map((h, i) => (
                    <div key={i} className="flex gap-2.5"><span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: '#d4af37' }} /><div><p className="text-xs text-white/85">{h.action} {h.detail ? <span className="text-white/50">· {h.detail}</span> : null}</p><p className="text-[10px] text-white/35">{new Date(h.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {h.by}</p></div></div>
                  ))}
                  {(selected.history || []).length === 0 && <p className="text-xs text-white/35 text-center py-4">No history recorded yet.</p>}
                </div>
              )}
              {detailTab === 'Notes' && (
                <div className="space-y-2 text-xs">
                  {[['Known Issues', selected.knownIssues], ['Preferred Oil', selected.preferredOil], ['Preferred Brand', selected.preferredBrand], ['Special Instructions', selected.specialInstructions], ['Internal Notes', selected.notes], ['Tags', selected.tags]].filter(([, v]) => v).map(([k, v]) => (
                    <div key={k}><p className="text-white/35 text-[10px] uppercase">{k}</p><p className="text-white/80">{v}</p></div>
                  ))}
                  {![selected.knownIssues, selected.preferredOil, selected.preferredBrand, selected.specialInstructions, selected.notes, selected.tags].some(Boolean) && <p className="text-white/35 text-center py-4">No notes recorded.</p>}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 mt-4">
                <button onClick={() => onCreateJobCard?.({ name: selected.owner, phone: selected.ownerPhone, vehicles: [selected] })} className="h-10 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] flex items-center justify-center gap-1.5"><ClipboardList size={14} /> Job Card</button>
                {canManage && <button onClick={() => setEdit(selected)} className="h-10 rounded-xl text-xs font-bold bg-white/5 border border-white/10 text-white/80 flex items-center justify-center gap-1.5"><Edit3 size={14} /> Edit</button>}
              </div>
            </>
          )}
        </div>
      </div>

      {edit && <VehicleWizard initial={edit} customers={customers} existingVehicles={rows} onSave={writeVehicle} onClose={() => setEdit(null)} onCreateCustomer={onCreateCustomer} />}
    </div>
  );
}
