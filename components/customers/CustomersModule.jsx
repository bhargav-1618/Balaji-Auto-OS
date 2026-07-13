// components/customers/CustomersModule.jsx — v1
// Master–detail Customers module per reference: stats row → searchable/filterable
// table (type badges, vehicles, visits, spent, outstanding, status, actions) →
// right detail panel (profile, meta grid, vehicles w/ Add Vehicle, full history
// from Job Cards). All subcomponents hoisted (focus-safe). Local persistence v1.
import React, { useMemo, useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { confirmDialog } from '../common/ConfirmDialog';
import { num } from '../../lib/format';
import {
  Users, UserCheck, Car, IndianRupee, Search, Plus, Eye, Edit3, Trash2,
  X, Phone, Mail, MapPin, ChevronLeft, ChevronRight, FileDown, History, MoreVertical, AlertCircle, MessageCircle, PhoneCall, Archive, ClipboardList, Receipt, Camera, Upload, Star, ChevronDown, Check,
} from 'lucide-react';

const inr = (n) => `₹${Math.round(num(n)).toLocaleString('en-IN')}`;
const BASE_TYPES = ['Individual', 'Family', 'Walk-in', 'Repeat Customer', 'Corporate', 'Fleet Owner', 'Taxi / Cab Operator', 'Travel Agency', 'Government', 'Educational Institution', 'Insurance Company', 'Dealer', 'Workshop Partner', 'VIP', 'Cash Customer', 'Credit Customer', 'Other'];
const TYPE_META = {
  Individual: { color: '#60a5fa', desc: 'Private customer / individual person' },
  Family: { color: '#38bdf8', desc: 'Household with multiple vehicles' },
  'Walk-in': { color: '#9ca3af', desc: 'Walk-in / one-time customer' },
  'Repeat Customer': { color: '#22d3ee', desc: 'Returning / loyal customer' },
  Corporate: { color: '#a78bfa', desc: 'Company / organization with GST' },
  'Fleet Owner': { color: '#fb923c', desc: 'Owns multiple vehicles (transport / logistics)' },
  'Taxi / Cab Operator': { color: '#facc15', desc: 'Commercial taxi / cab operator' },
  'Travel Agency': { color: '#fbbf24', desc: 'Tours & travels operator' },
  Government: { color: '#93c5fd', desc: 'Government department or official vehicle' },
  'Educational Institution': { color: '#818cf8', desc: 'School / college transport' },
  'Insurance Company': { color: '#34d399', desc: 'Insurance company / TP / cashless' },
  Dealer: { color: '#f472b6', desc: 'Vehicle dealer or reseller business' },
  'Workshop Partner': { color: '#c084fc', desc: 'Partner garage / sublet work' },
  VIP: { color: '#d4af37', desc: 'High value / priority customer' },
  'Cash Customer': { color: '#4ade80', desc: 'Pays cash, no credit' },
  'Credit Customer': { color: '#f97316', desc: 'Billed on credit terms' },
  Other: { color: '#94a3b8', desc: 'Other customer category' },
};
const typeColor = (t) => (TYPE_META[t] ? TYPE_META[t].color : '#94a3b8');
const TYPE_COLORS = Object.fromEntries(Object.entries(TYPE_META).map(([k, v]) => [k, v.color]));
const TYPES = BASE_TYPES;
const inputCls = 'w-full px-3 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 text-white placeholder-white/25 outline-none focus:border-[#d4af37]/60 transition';
const cardStyle = { background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' };
const maskAadhar = (a) => { const d = String(a || '').replace(/\D/g, ''); return d.length >= 4 ? `XXXX XXXX ${d.slice(-4)}` : (a ? 'XXXX' : '—'); };
// Compress an image File to a small JPEG data URL (max ~900px, ~0.7 quality)
// so multiple vehicle photos stay well within storage limits.
const compressImage = (file, maxDim = 900, quality = 0.7) => new Promise((resolve, reject) => {
  if (!file || !file.type.startsWith('image/')) { reject(new Error('Not an image')); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) { height = Math.round((height * maxDim) / width); width = maxDim; }
      else if (height > maxDim) { width = Math.round((width * maxDim) / height); height = maxDim; }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = reader.result;
  };
  reader.onerror = reject;
  reader.readAsDataURL(file);
});
const nextCode = (list) => `SBBMC${String(list.reduce((m, c) => Math.max(m, Number((c.code || '').replace(/\D/g, '')) || 0), 0) + 1).padStart(2, '0')}`;

const emptyCustomer = () => ({
  id: `c_${Date.now()}_${Math.floor(Math.random() * 1e4)}`, code: '', name: '', phone: '', altPhone: '', extraPhones: [],
  email: '', address: '', area: '', city: '', district: '', state: '', pincode: '', country: 'India',
  gst: '', pan: '', companyName: '', type: 'Individual', status: 'Active',
  occupation: '', referenceBy: '', notes: '', totalSpent: 0, outstanding: 0,
  since: new Date().toISOString().slice(0, 10), createdAt: Date.now(), vehicles: [], history: [],
});
const emptyVehicle = () => ({ id: `v_${Date.now()}_${Math.floor(Math.random() * 1e4)}`, regNo: '', model: '', variant: '', color: '', fuel: 'Petrol', transmission: 'Manual', year: '', kms: '', engineNo: '', vin: '', insuranceExpiry: '', rcExpiry: '', lastService: '', status: 'Active', photos: [], coverPhoto: 0 });

function Stat({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="rounded-2xl p-3.5 flex items-center gap-3" style={cardStyle}>
      <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${color}1f`, color }}><Icon size={18} /></span>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-white/40 truncate">{label}</p>
        <p className="text-lg font-bold text-white leading-tight">{value}</p>
        {sub && <p className="text-[10px] text-emerald-400">{sub}</p>}
      </div>
    </div>
  );
}
function Badge({ children, color }) {
  return <span className="px-2 py-0.5 rounded-md text-[10px] font-bold" style={{ background: `${color}1f`, color, border: `1px solid ${color}40` }}>{children}</span>;
}
function Avatar({ name, size = 9 }) {
  return <span className="rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: 'rgba(212,175,55,0.15)', color: '#d4af37', width: size * 4, height: size * 4 }}>{(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>;
}
function Field({ label, req, error, children, className = '' }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label className="block text-[10px] uppercase tracking-wide text-white/40 mb-1.5">{label}{req && <span className="text-red-400"> *</span>}</label>
      {children}
      {error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}
    </div>
  );
}

// Field wrapper — HOISTED to module scope. Declared inside CustomerWizard it was
// re-created on every render, so React remounted the wrapped <input> on each
// keystroke and the field lost focus after one character.
function F({ label, req, error, children, className = '' }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label className="block text-[10px] uppercase tracking-wide text-white/40 mb-1.5">{label}{req && <span className="text-red-400"> *</span>}</label>
      {children}
      {error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}
    </div>
  );
}

function CustomerWizard({ initial, existing, canManage, onSave, onClose }) {
  const [f, setF] = useState(initial);
  const [step, setStep] = useState(0);
  const set = (patch) => setF((s) => ({ ...s, ...patch }));
  const [idMode, setIdMode] = useState(initial.code ? 'manual' : 'auto');
  const autoCode = nextCode(existing);

  const phoneErr = f.phone && !/^\d{10}$/.test(f.phone.replace(/\D/g, '')) ? 'Enter a valid 10-digit number' : null;
  const emailErr = f.email && !/^\S+@\S+\.\S+$/.test(f.email) ? 'Enter a valid email' : null;
  const gstErr = f.gst && !/^[0-9A-Z]{15}$/.test(f.gst.toUpperCase()) ? 'GST must be 15 characters' : null;
  const pinErr = f.pincode && !/^\d{6}$/.test(f.pincode) ? 'PIN must be 6 digits' : null;
  const dupPhone = existing.some((c) => c.id !== f.id && c.phone && c.phone === f.phone);
  const dupEmail = f.email && existing.some((c) => c.id !== f.id && (c.email || '').toLowerCase() === f.email.toLowerCase());
  const dupGst = f.gst && existing.some((c) => c.id !== f.id && (c.gst || '').toUpperCase() === f.gst.toUpperCase());
  const nameWarn = f.name.trim() && existing.some((c) => c.id !== f.id && c.name.trim().toLowerCase() === f.name.trim().toLowerCase() && c.phone !== f.phone);

  const STEPS = [
    { key: 'basic', label: 'Basic Info', icon: Users },
    { key: 'address', label: 'Address', icon: MapPin },
    { key: 'business', label: 'Business Info', icon: Receipt },
    { key: 'vehicles', label: `Vehicles${f.vehicles.length ? ` (${f.vehicles.length})` : ''}`, icon: Car },
    { key: 'notes', label: 'Notes & More', icon: Edit3 },
  ];

  const addVehicle = () => set({ vehicles: [...f.vehicles, emptyVehicle()] });
  const setVeh = (id, patch) => set({ vehicles: f.vehicles.map((v) => (v.id === id ? { ...v, ...patch } : v)) });
  const delVeh = (id) => set({ vehicles: f.vehicles.filter((v) => v.id !== id) });

  const validate = () => {
    if (f.name.trim().length < 3) { setStep(0); return 'Customer name must be at least 3 characters'; }
    if (!f.phone || phoneErr) { setStep(0); return 'A valid 10-digit primary mobile is required'; }
    if (dupPhone) { setStep(0); return 'A customer with this mobile number already exists'; }
    if (emailErr) { setStep(0); return emailErr; }
    if (dupEmail) { setStep(0); return 'A customer with this email already exists'; }
    if (pinErr) { setStep(1); return pinErr; }
    if (gstErr) { setStep(2); return gstErr; }
    if (dupGst) { setStep(2); return 'A customer with this GST already exists'; }
    if (idMode === 'manual') { if (!f.code.trim()) { setStep(0); return 'Enter a customer ID or use Auto Generate'; } if (existing.some((c) => c.id !== f.id && c.code === f.code.trim())) { setStep(0); return 'This customer ID already exists'; } }
    return null;
  };
  const save = () => {
    const err = validate();
    if (err) return toast.error(err);
    const composedAddr = f.address || [f.area, f.city, f.district, f.state, f.pincode].filter(Boolean).join(', ');
    onSave({ ...f, name: f.name.trim(), gst: f.gst.toUpperCase(), address: composedAddr, code: idMode === 'manual' ? f.code.trim() : (f.code || '') });
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const phone91 = (val, onCh, ph) => (
    <div className="flex gap-2"><span className="flex items-center px-3 rounded-xl text-sm text-white/60 bg-white/5 border border-white/10 flex-shrink-0">+91</span>
      <input value={val} inputMode="numeric" onChange={(e) => onCh(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder={ph} className={inputCls} /></div>
  );

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div className="w-full sm:max-w-3xl max-h-[94vh] flex flex-col rounded-t-2xl sm:rounded-2xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
          <h3 className="text-base font-bold text-white">{initial.code ? `Edit ${f.code}` : 'Add New Customer'}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10"><X size={17} /></button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col sm:flex-row">
          <div className="sm:w-44 flex-shrink-0 flex sm:flex-col gap-1 p-3 overflow-x-auto sm:overflow-visible" style={{ borderRight: '1px solid rgba(var(--fg-rgb),0.06)' }}>
            {STEPS.map((s, i) => (
              <button key={s.key} type="button" onClick={() => setStep(i)} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition ${step === i ? 'text-[#d4af37]' : 'text-white/55 hover:text-white/90 hover:bg-white/5'}`} style={step === i ? { background: 'rgba(212,175,55,0.1)' } : undefined}>
                <s.icon size={14} /> {s.label}
              </button>
            ))}
          </div>

          <div className="flex-1 min-w-0 overflow-y-auto dark-scroll p-5">
            {step === 0 && (
              <div className="space-y-3">
                <p className="text-sm font-bold text-white/80">Basic Information</p>
                <F label="Customer ID">
                  <div className="flex flex-wrap items-center gap-3 mb-1.5">
                    {[['auto', 'Auto Generate'], ['manual', 'Manual Entry']].map(([m, l]) => (
                      <label key={m} className="flex items-center gap-1.5 cursor-pointer text-xs text-white/70"><input type="radio" checked={idMode === m} onChange={() => setIdMode(m)} className="accent-[#d4af37]" /> {l}</label>
                    ))}
                  </div>
                  {idMode === 'auto' ? <p className="text-[11px] text-white/45">Auto ID: <span className="font-bold" style={{ color: '#d4af37' }}>{f.code || autoCode}</span></p>
                    : <input value={f.code} onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 14) })} placeholder="e.g. CUST-0009" className={inputCls} />}
                </F>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <F label="Customer Name" req error={nameWarn ? 'Same name exists with a different phone' : null}><input value={f.name} onChange={(e) => set({ name: e.target.value.slice(0, 100) })} placeholder="Enter customer name" className={inputCls} /></F>
                  <F label="Customer Type" req>
                    <select value={f.type} onChange={(e) => set({ type: e.target.value })} className={inputCls}>{TYPES.map((t) => <option key={t} style={{ background: '#141414' }}>{t}</option>)}</select>
                  </F>
                  <F label="Primary Mobile" req error={phoneErr || (dupPhone ? 'Already exists' : null)}>{phone91(f.phone, (v) => set({ phone: v }), 'Enter 10 digit number')}</F>
                  <F label="Alternate Mobile">{phone91(f.altPhone, (v) => set({ altPhone: v }), 'Enter 10 digit number')}</F>
                  <F label="Email" error={emailErr || (dupEmail ? 'Already exists' : null)}><input value={f.email} onChange={(e) => set({ email: e.target.value })} placeholder="Enter email address" className={inputCls} /></F>
                  <F label="Occupation"><input value={f.occupation} onChange={(e) => set({ occupation: e.target.value })} placeholder="Enter occupation" className={inputCls} /></F>
                  <F label="Reference By"><input value={f.referenceBy} onChange={(e) => set({ referenceBy: e.target.value })} placeholder="Select or enter reference" className={inputCls} /></F>
                  <F label="Status"><select value={f.status} onChange={(e) => set({ status: e.target.value })} className={inputCls}>{['Active', 'Inactive'].map((t) => <option key={t} style={{ background: '#141414' }}>{t}</option>)}</select></F>
                </div>
              </div>
            )}
            {step === 1 && (
              <div className="space-y-3">
                <p className="text-sm font-bold text-white/80">Address</p>
                <F label="Address Line"><textarea value={f.address} onChange={(e) => set({ address: e.target.value })} rows={2} className={`${inputCls} resize-none`} placeholder="Door no., street, landmark" /></F>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <F label="Area"><input value={f.area} onChange={(e) => set({ area: e.target.value })} className={inputCls} /></F>
                  <F label="City"><input value={f.city} onChange={(e) => set({ city: e.target.value })} className={inputCls} /></F>
                  <F label="District"><input value={f.district} onChange={(e) => set({ district: e.target.value })} className={inputCls} /></F>
                  <F label="State"><input value={f.state} onChange={(e) => set({ state: e.target.value })} className={inputCls} /></F>
                  <F label="PIN Code" error={pinErr}><input value={f.pincode} inputMode="numeric" onChange={(e) => set({ pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })} className={inputCls} /></F>
                  <F label="Country"><input value={f.country} onChange={(e) => set({ country: e.target.value })} className={inputCls} /></F>
                </div>
              </div>
            )}
            {step === 2 && (
              <div className="space-y-3">
                <p className="text-sm font-bold text-white/80">Business Details <span className="text-white/35 font-normal">(optional)</span></p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <F label="Company Name"><input value={f.companyName} onChange={(e) => set({ companyName: e.target.value })} className={inputCls} /></F>
                  <F label="GST Number" error={gstErr || (dupGst ? 'Already exists' : null)}><input value={f.gst} onChange={(e) => set({ gst: e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 15) })} placeholder="15-char GSTIN" className={inputCls} /></F>
                  <F label="PAN Number"><input value={f.pan} onChange={(e) => set({ pan: e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 10) })} className={inputCls} /></F>
                </div>
              </div>
            )}
            {step === 3 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-white/80">Vehicles ({f.vehicles.length})</p>
                  <button type="button" onClick={addVehicle} className="h-8 px-3 rounded-lg text-[11px] font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] flex items-center gap-1"><Plus size={12} /> Add Vehicle</button>
                </div>
                {f.vehicles.map((v, vi) => (
                  <div key={v.id} className="rounded-xl p-3" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
                    <div className="flex items-center justify-between mb-2"><span className="text-[11px] font-bold text-white/70">Vehicle {vi + 1}</span><button type="button" onClick={() => delVeh(v.id)} className="text-red-400/70 hover:text-red-400"><Trash2 size={13} /></button></div>
                    <div className="grid grid-cols-2 gap-2">
                      {[['regNo', 'Registration *', 13], ['model', 'Make & Model', 40], ['variant', 'Variant', 24], ['color', 'Color', 16], ['year', 'Year', 4], ['engineNo', 'Engine No.', 25], ['vin', 'VIN', 17]].map(([k, ph, mx]) => (
                        <input key={k} value={v[k]} onChange={(e) => { const val = ['regNo', 'vin', 'engineNo'].includes(k) ? e.target.value.toUpperCase().slice(0, mx) : e.target.value.slice(0, mx); setVeh(v.id, { [k]: val }); }} placeholder={ph} className={`${inputCls} py-2 text-xs`} />
                      ))}
                      <select value={v.fuel} onChange={(e) => setVeh(v.id, { fuel: e.target.value })} className={`${inputCls} py-2 text-xs`}>{['Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid'].map((t) => <option key={t} style={{ background: '#141414' }}>{t}</option>)}</select>
                      <select value={v.transmission || 'Manual'} onChange={(e) => setVeh(v.id, { transmission: e.target.value })} className={`${inputCls} py-2 text-xs`}>{['Manual', 'AMT', 'Automatic', 'CVT', 'DCT'].map((t) => <option key={t} style={{ background: '#141414' }}>{t}</option>)}</select>
                      <label className="text-[9px] text-white/40">Insurance Expiry<input type="date" value={v.insuranceExpiry} onChange={(e) => setVeh(v.id, { insuranceExpiry: e.target.value })} className={`${inputCls} py-2 text-xs mt-0.5`} style={{ colorScheme: 'dark' }} /></label>
                      <label className="text-[9px] text-white/40">RC Expiry<input type="date" value={v.rcExpiry} onChange={(e) => setVeh(v.id, { rcExpiry: e.target.value })} className={`${inputCls} py-2 text-xs mt-0.5`} style={{ colorScheme: 'dark' }} /></label>
                    </div>
                    <div className="mt-3">
                      <p className="text-[10px] uppercase tracking-wide text-white/40 mb-1.5">Vehicle Photos <span className="normal-case text-white/30">— upload, take photo, or drag & drop</span></p>
                      <div className="flex flex-wrap gap-2" onDragOver={(e) => e.preventDefault()} onDrop={async (e) => { e.preventDefault(); const imgs = []; for (const file of Array.from(e.dataTransfer.files).slice(0, 8)) { try { imgs.push(await compressImage(file)); } catch {} } if (imgs.length) setVeh(v.id, { photos: [...(v.photos || []), ...imgs].slice(0, 10) }); }}>
                        {(v.photos || []).map((p, pi) => (
                          <div key={pi} className="relative w-16 h-16 rounded-lg overflow-hidden group" style={{ border: (v.coverPhoto || 0) === pi ? '2px solid #d4af37' : '1px solid rgba(var(--fg-rgb),0.1)' }}>
                            <img src={p} alt="" className="w-full h-full object-cover" />
                            <button type="button" onClick={() => setVeh(v.id, { coverPhoto: pi })} title="Set as cover" className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-black/70 flex items-center justify-center" style={{ color: (v.coverPhoto || 0) === pi ? '#d4af37' : '#fff' }}><Star size={9} fill={(v.coverPhoto || 0) === pi ? '#d4af37' : 'none'} /></button>
                            <button type="button" onClick={() => setVeh(v.id, { photos: v.photos.filter((_, x) => x !== pi), coverPhoto: 0 })} className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center"><X size={9} /></button>
                            {(v.coverPhoto || 0) === pi && <span className="absolute bottom-0 inset-x-0 text-[7px] font-bold text-center text-black py-0.5" style={{ background: '#d4af37' }}>COVER</span>}
                          </div>
                        ))}
                        {(v.photos || []).length < 10 && (
                          <label className="w-16 h-16 rounded-lg flex flex-col items-center justify-center cursor-pointer text-white/40 hover:text-white/70 transition" style={{ border: '1px dashed rgba(var(--fg-rgb),0.25)' }}>
                            <Camera size={15} /><span className="text-[8px] mt-0.5">Add</span>
                            <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={async (e) => { const imgs = []; for (const file of Array.from(e.target.files).slice(0, 8)) { try { imgs.push(await compressImage(file)); } catch { toast.error('Could not read image'); } } if (imgs.length) setVeh(v.id, { photos: [...(v.photos || []), ...imgs].slice(0, 10) }); e.target.value = ''; }} />
                          </label>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {f.vehicles.length === 0 && <p className="text-xs text-white/35 text-center py-6">No vehicles yet. Click Add Vehicle.</p>}
              </div>
            )}
            {step === 4 && (
              <div className="space-y-3">
                <p className="text-sm font-bold text-white/80">Notes & More</p>
                <F label="Notes"><textarea value={f.notes} onChange={(e) => set({ notes: e.target.value.slice(0, 500) })} rows={4} className={`${inputCls} resize-none`} placeholder="Add any notes about the customer…" /></F>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3.5 flex-shrink-0" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.08)', background: 'var(--surface-2)', paddingBottom: 'max(0.875rem, env(safe-area-inset-bottom))' }}>
          <button onClick={onClose} className="py-3 px-5 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80">Cancel</button>
          <div className="flex gap-2">
            {step > 0 && <button onClick={() => setStep((s) => s - 1)} className="py-3 px-5 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80">Back</button>}
            {step < STEPS.length - 1 ? <button onClick={() => setStep((s) => s + 1)} className="py-3 px-6 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">Next</button>
              : <button onClick={save} className="py-3 px-6 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">Save Customer</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function VehicleModal({ initial, onSave, onClose }) {
  const [f, setF] = useState(initial);
  const set = (patch) => setF((s) => ({ ...s, ...patch }));
  const save = () => {
    if (!f.regNo.trim()) return toast.error('Registration number is required');
    if (!f.model.trim()) return toast.error('Make & model is required');
    onSave({ ...f, regNo: f.regNo.toUpperCase() });
  };
  return (
    <div className="fixed inset-0 z-[125] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <div className="w-full sm:max-w-md max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
          <h3 className="text-base font-bold text-white">{initial.regNo ? 'Edit Vehicle' : 'Add Vehicle'}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10"><X size={17} /></button>
        </div>
        <div className="flex-1 overflow-y-auto dark-scroll p-5 grid grid-cols-2 gap-3">
          <Field label="Registration No." req><input value={f.regNo} onChange={(e) => set({ regNo: e.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, '').slice(0, 13) })} placeholder="TS09AB1234" className={inputCls} /></Field>
          <Field label="Fuel"><select value={f.fuel} onChange={(e) => set({ fuel: e.target.value })} className={inputCls}>{['Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid'].map((t) => <option key={t} style={{ background: '#141414' }}>{t}</option>)}</select></Field>
          <Field label="Make & Model" req className="col-span-2"><input value={f.model} onChange={(e) => set({ model: e.target.value })} placeholder="e.g. Maruti Suzuki Swift VXi" className={inputCls} /></Field>
          <Field label="Year"><input value={f.year} inputMode="numeric" onChange={(e) => set({ year: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="2021" className={inputCls} /></Field>
          <Field label="KMs Driven"><input value={f.kms} inputMode="numeric" onChange={(e) => set({ kms: e.target.value.replace(/\D/g, '').slice(0, 7) })} placeholder="45820" className={inputCls} /></Field>
          <Field label="Last Service" className="col-span-2"><input type="date" value={f.lastService} onChange={(e) => set({ lastService: e.target.value })} className={inputCls} style={{ colorScheme: 'dark' }} /></Field>
        </div>
        <div className="flex gap-3 px-5 py-3.5 flex-shrink-0" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.08)', paddingBottom: 'max(0.875rem, env(safe-area-inset-bottom))' }}>
          <button onClick={onClose} className="flex-1 py-3 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80">Cancel</button>
          <button onClick={save} className="flex-1 py-3 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">Save Vehicle</button>
        </div>
      </div>
    </div>
  );
}

export default function CustomersModule({ demoMode = false, demoCanDelete = false, canManage = true, jobCards = [], invoices = [], customers, setCustomers, onCreateJobCard, onCreateInvoice }) {
  const [q, setQ] = useState('');
  const [typeF, setTypeF] = useState('All');
  const [statusF, setStatusF] = useState('All');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [selId, setSelId] = useState(null);
  const [editCust, setEditCust] = useState(null);
  const [editVeh, setEditVeh] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [detailTab, setDetailTab] = useState('Vehicles');
  useEffect(() => { setPage(1); }, [q, typeF, statusF, perPage]);

  const cardsOf = (c) => jobCards.filter((j) => (j.phone || '').replace(/\D/g, '') === (c.phone || '').replace(/\D/g, ''));
  const invoicesOf = (c) => invoices.filter((iv) => iv.customerId === c.id || (iv.phone || '').replace(/\D/g, '') === (c.phone || '').replace(/\D/g, ''));
  const billsOf = (c) => invoicesOf(c).length;
  const visitsOf = (c) => cardsOf(c).length;
  const lastVisitOf = (c) => { const t = Math.max(0, ...cardsOf(c).map((j) => j.savedAt || 0)); return t ? new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'; };
  const [menuFor, setMenuFor] = useState(null);
  useEffect(() => { const onDoc = () => setMenuFor(null); document.addEventListener('click', onDoc); return () => document.removeEventListener('click', onDoc); }, []);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return customers.filter((c) => {
      if (typeF !== 'All' && c.type !== typeF) return false;
      if (statusF !== 'All' && c.status !== statusF) return false;
      if (!ql) return true;
      const jobNos = cardsOf(c).map((j) => j.jobNo);
      const invNos = invoicesOf(c).map((iv) => iv.invNo);
      const hay = [c.name, c.code, c.phone, c.altPhone, ...(c.extraPhones || []), c.email, c.city, c.gst, c.companyName,
        ...(c.vehicles || []).flatMap((v) => [v.regNo, v.model, v.vin, v.engineNo]), ...jobNos, ...invNos]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(ql);
    });
  }, [customers, q, typeF, statusF, jobCards, invoices]);
  const paged = filtered.slice((page - 1) * perPage, page * perPage);
  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  const selected = useMemo(() => customers.find((c) => c.id === selId) || null, [customers, selId]);

  const stats = useMemo(() => {
    const now = new Date();
    const thisMonth = customers.filter((c) => { const d = new Date(c.since); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); }).length;
    return {
      total: customers.length,
      active: customers.filter((c) => c.status === 'Active').length,
      thisMonth,
      repeat: customers.filter((c) => visitsOf(c) > 1 || c.type === 'Repeat Customer').length,
      outstandingCount: customers.filter((c) => num(c.outstanding) > 0).length,
      outstanding: customers.reduce((s, c) => s + num(c.outstanding), 0),
      vehicles: customers.reduce((s, c) => s + (c.vehicles || []).length, 0),
    };
  }, [customers, jobCards]);

  const histEntry = (action, detail) => ({ at: Date.now(), action, detail, by: demoMode ? 'Demo User' : 'Admin' });
  const saveCustomer = (c) => {
    setCustomers((prev) => {
      const exists = prev.some((x) => x.id === c.id);
      if (exists) {
        return prev.map((x) => {
          if (x.id !== c.id) return x;
          const hist = [...(x.history || [])];
          const oldVehIds = new Set((x.vehicles || []).map((v) => v.id));
          (c.vehicles || []).forEach((v) => { if (!oldVehIds.has(v.id)) hist.push(histEntry('Vehicle Added', `${v.regNo} ${v.model || ''}`.trim())); });
          hist.push(histEntry('Customer Edited', c.name));
          return { ...c, history: hist };
        });
      }
      const hist = [histEntry('Customer Created', c.name), ...(c.vehicles || []).map((v) => histEntry('Vehicle Added', `${v.regNo} ${v.model || ''}`.trim()))];
      return [...prev, { ...c, code: c.code || nextCode(prev), createdAt: Date.now(), history: hist }];
    });
    setEditCust(null);
    toast.success('Customer saved');
  };
  const removeCustomer = async (c) => {
    if (demoMode && !demoCanDelete) { toast('This action has been disabled by the administrator.', { icon: '🔒' }); return; }
    if (!await confirmDialog({ title: `Delete ${c.name}?`, message: `${c.code} — this cannot be undone.`, danger: true, confirmText: 'Delete' })) return;
    setCustomers((prev) => prev.filter((x) => x.id !== c.id));
    if (selId === c.id) setSelId(null);
    toast.success('Customer deleted');
  };
  const saveVehicle = (v) => {
    setCustomers((prev) => prev.map((c) => {
      if (c.id !== selId) return c;
      const vehicles = c.vehicles.some((x) => x.id === v.id) ? c.vehicles.map((x) => (x.id === v.id ? v : x)) : [...c.vehicles, v];
      return { ...c, vehicles };
    }));
    setEditVeh(null);
    toast.success('Vehicle saved');
  };
  const exportCSV = () => {
    const rows = [['Code', 'Name', 'Type', 'Phone', 'Email', 'City', 'GST', 'Status', 'Vehicles', 'Visits', 'Total Spent', 'Outstanding'],
      ...filtered.map((c) => [c.code, c.name, c.type, c.phone, c.email, c.city, c.gst, c.status, (c.vehicles || []).length, visitsOf(c), num(c.totalSpent), num(c.outstanding)])];
    const csv = rows.map((r) => r.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };
  const custHistory = useMemo(() => (selected ? jobCards.filter((j) => (j.phone || '').replace(/\D/g, '') === (selected.phone || '').replace(/\D/g, '')).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)) : []), [selected, jobCards]);

  return (
    <div className="xl:flex xl:gap-4 xl:items-start">
      <div className="xl:flex-1 xl:min-w-0">
        {/* stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
          <Stat icon={Users} label="Total Customers" value={stats.total} color="#60a5fa" />
          <Stat icon={UserCheck} label="Active" value={stats.active} sub={stats.total ? `${Math.round((stats.active / stats.total) * 100)}% of total` : null} color="#34d399" />
          <Stat icon={Plus} label="Added This Month" value={stats.thisMonth} color="#38bdf8" />
          <Stat icon={History} label="Repeat Customers" value={stats.repeat} sub={stats.total ? `${Math.round((stats.repeat / stats.total) * 100)}% of total` : null} color="#22d3ee" />
          <Stat icon={AlertCircle} label="With Outstanding" value={stats.outstandingCount} sub={inr(stats.outstanding)} color="#f87171" />
          <Stat icon={Car} label="Vehicles Registered" value={stats.vehicles} color="#a78bfa" />
        </div>

        {/* toolbar */}
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, phone, email, city or GST no." className={`${inputCls} pl-9`} />
          </div>
          <select value={typeF} onChange={(e) => setTypeF(e.target.value)} className={`${inputCls} sm:w-44`}>{['All', ...TYPES].map((t) => <option key={t} style={{ background: '#141414' }}>{t === 'All' ? 'All Customer Types' : t}</option>)}</select>
          <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className={`${inputCls} sm:w-36`}>{['All', 'Active', 'Inactive'].map((t) => <option key={t} style={{ background: '#141414' }}>{t === 'All' ? 'All Status' : t}</option>)}</select>
          <button onClick={exportCSV} className="h-11 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-white/5 border border-white/10 text-white/75 hover:bg-white/10"><FileDown size={13} /> Export</button>
          {canManage && <button onClick={() => setEditCust(emptyCustomer())} className="h-11 px-4 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] flex items-center gap-1.5 active:scale-95 transition"><Plus size={14} /> New Customer</button>}
        </div>

        {/* table */}
        <div className="rounded-2xl overflow-hidden" style={cardStyle}>
          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="sticky top-0 z-10" style={{ background: 'var(--surface-1)' }}>
                <tr className="text-[10px] uppercase tracking-wide text-white/40" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
                  {['#', 'Customer ID', 'Customer Name', 'Phone / Email', 'Type', 'Vehicles', 'Visits', 'Total Bills', 'Total Revenue', 'Outstanding', 'Status', 'Last Visit', 'Actions'].map((h) => <th key={h} className="text-left font-semibold py-2.5 px-3 whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {paged.map((c, i) => (
                  <tr key={c.id} className={`transition cursor-pointer ${selId === c.id ? 'bg-[#d4af37]/8' : 'hover:bg-white/[0.03]'}`} onClick={() => setSelId(c.id)} style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.05)' }}>
                    <td className="py-2.5 px-3 text-white/40">{(page - 1) * perPage + i + 1}</td>
                    <td className="py-2.5 px-3"><span className="text-[11px] font-bold" style={{ color: '#d4af37' }}>{c.code}</span></td>
                    <td className="py-2.5 px-3"><div className="flex items-center gap-2.5"><Avatar name={c.name} /><p className="text-white/90 font-medium">{c.name}</p></div></td>
                    <td className="py-2.5 px-3"><p className="text-white/80">{c.phone}</p><p className="text-[10px] text-white/40 truncate max-w-[150px]">{c.email}</p></td>
                    <td className="py-2.5 px-3"><Badge color={typeColor(c.type)}>{c.type}</Badge></td>
                    <td className="py-2.5 px-3 text-center text-white/70">{(c.vehicles || []).length}</td>
                    <td className="py-2.5 px-3 text-center text-white/70">{visitsOf(c)}</td>
                    <td className="py-2.5 px-3 text-center text-white/70">{billsOf(c)}</td>
                    <td className="py-2.5 px-3 text-white/85">{inr(c.totalSpent)}</td>
                    <td className="py-2.5 px-3"><span className={num(c.outstanding) > 0 ? 'text-red-400 font-semibold' : 'text-white/50'}>{inr(c.outstanding)}</span></td>
                    <td className="py-2.5 px-3"><Badge color={c.status === 'Active' ? '#34d399' : '#9ca3af'}>{c.status}</Badge></td>
                    <td className="py-2.5 px-3 text-white/60 text-xs whitespace-nowrap">{lastVisitOf(c)}</td>
                    <td className="py-2.5 px-3 relative" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1 items-center">
                        <button onClick={() => setSelId(c.id)} title="View" className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 hover:bg-white/10"><Eye size={12} /></button>
                        {canManage && <button onClick={() => setEditCust(c)} title="Edit" className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 hover:bg-white/10"><Edit3 size={12} /></button>}
                        <button onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === c.id ? null : c.id); }} className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 hover:bg-white/10"><MoreVertical size={12} /></button>
                      </div>
                      {menuFor === c.id && (
                        <div className="absolute right-2 top-10 z-30 w-48 rounded-xl p-1 shadow-2xl" style={{ background: 'var(--surface-1)', border: '1px solid rgba(var(--fg-rgb),0.12)' }} onClick={(e) => e.stopPropagation()}>
                          {[
                            ['View Details', Eye, () => { setSelId(c.id); setMenuFor(null); }],
                            canManage && ['Edit Customer', Edit3, () => { setEditCust(c); setMenuFor(null); }],
                            canManage && ['Add Vehicle', Plus, () => { setSelId(c.id); setEditVeh(emptyVehicle()); setMenuFor(null); }],
                            canManage && ['Create Job Card', ClipboardList, () => { onCreateJobCard?.(c); setMenuFor(null); }],
                            canManage && ['Create Invoice', Receipt, () => { onCreateInvoice?.(c); setMenuFor(null); }],
                            ['View History', History, () => { setSelId(c.id); setDetailTab('Timeline'); setMenuFor(null); }],
                            c.phone && ['Send WhatsApp', MessageCircle, () => { window.open(`https://wa.me/91${c.phone}`, '_blank'); setMenuFor(null); }],
                            c.phone && ['Call Customer', PhoneCall, () => { window.location.href = `tel:+91${c.phone}`; setMenuFor(null); }],
                            canManage && [c.status === 'Active' ? 'Archive Customer' : 'Reactivate', Archive, () => { setCustomers((prev) => prev.map((x) => (x.id === c.id ? { ...x, status: x.status === 'Active' ? 'Inactive' : 'Active' } : x))); setMenuFor(null); }],
                            canManage && ['Delete Customer', Trash2, () => { setMenuFor(null); removeCustomer(c); }, true],
                          ].filter(Boolean).map(([label, Icon, on, danger]) => (
                            <button key={label} onClick={on} className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition ${danger ? 'text-red-400 hover:bg-red-500/10' : 'text-white/75 hover:bg-white/5'}`}><Icon size={13} /> {label}</button>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {paged.length === 0 && <tr><td colSpan={13} className="py-10 text-center text-white/35 text-xs">No customers match. {canManage && 'Click “New Customer” to add your first.'}</td></tr>}
              </tbody>
            </table>
          </div>
          {/* Mobile: cards instead of horizontal-scroll table */}
          <div className="md:hidden divide-y" style={{ borderColor: 'rgba(var(--fg-rgb),0.06)' }}>
            {paged.map((c) => (
              <div key={c.id} className="p-3.5" onClick={() => setSelId(c.id)}>
                <div className="flex items-center gap-3">
                  <Avatar name={c.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-white/90 font-medium truncate">{c.name}</p>
                      <span className="text-[9px] font-bold" style={{ color: '#d4af37' }}>{c.code}</span>
                    </div>
                    <p className="text-[11px] text-white/45 truncate">{c.phone}{c.email ? ` · ${c.email}` : ''}</p>
                  </div>
                  <Badge color={c.status === 'Active' ? '#34d399' : '#9ca3af'}>{c.status}</Badge>
                </div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className="text-[10px] text-white/45">{(c.vehicles || []).length} vehicle{(c.vehicles || []).length === 1 ? '' : 's'} · {billsOf(c)} bills · {inr(c.totalSpent)}</span>
                  {num(c.outstanding) > 0 && <span className="text-[10px] text-red-400 font-semibold">Due {inr(c.outstanding)}</span>}
                  <div className="ml-auto flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {canManage && <button onClick={() => setEditCust(c)} className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60"><Edit3 size={13} /></button>}
                    {canManage && <button onClick={() => onCreateInvoice?.(c)} className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60"><Receipt size={13} /></button>}
                    {c.phone && <button onClick={() => window.open(`https://wa.me/91${c.phone}`, '_blank')} className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-emerald-400/70"><MessageCircle size={13} /></button>}
                  </div>
                </div>
              </div>
            ))}
            {paged.length === 0 && <div className="py-10 text-center text-white/35 text-xs">No customers match. {canManage && 'Tap “New Customer” to add your first.'}</div>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.06)' }}>
            <span className="text-[11px] text-white/40">Showing {filtered.length ? (page - 1) * perPage + 1 : 0} to {Math.min(page * perPage, filtered.length)} of {filtered.length} customers</span>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 disabled:opacity-30"><ChevronLeft size={14} /></button>
              <span className="text-xs text-white/60">{page} / {pageCount}</span>
              <button disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)} className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 disabled:opacity-30"><ChevronRight size={14} /></button>
              <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))} className="h-8 px-2 rounded-lg text-xs bg-white/5 border border-white/10 text-white/70 outline-none">{[10, 25, 50, 100].map((n) => <option key={n} value={n} style={{ background: '#141414' }}>{n} / page</option>)}</select>
            </div>
          </div>
        </div>
      </div>

      {/* -------- detail panel -------- */}
      <div className="xl:w-[360px] xl:flex-shrink-0 mt-4 xl:mt-0">
        <div className="xl:sticky xl:top-4 rounded-2xl p-4" style={cardStyle}>
          {!selected ? (
            <div className="py-16 text-center">
              <Users size={26} className="mx-auto text-white/20 mb-3" />
              <p className="text-sm font-bold text-white/80">Customer Details</p>
              <p className="text-xs text-white/40 mt-1">Select a customer to view their profile, vehicles and history.</p>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-sm font-bold text-white/85">Customer Details</h3>
                <button onClick={() => setSelId(null)} className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:bg-white/10"><X size={14} /></button>
              </div>
              <div className="flex items-center gap-3 mb-3">
                <Avatar name={selected.name} size={12} />
                <div className="min-w-0">
                  <p className="text-base font-bold text-white flex items-center gap-2 flex-wrap">{selected.name} <Badge color={selected.status === 'Active' ? '#34d399' : '#9ca3af'}>{selected.status}</Badge></p>
                  <p className="text-[11px] text-white/45">{selected.code} <Badge color={typeColor(selected.type)}>{selected.type}</Badge></p>
                </div>
              </div>
              <div className="space-y-1.5 text-xs text-white/70 mb-4">
                <p className="flex items-center gap-2"><Phone size={12} className="text-white/35" /> {selected.phone}{selected.altPhone ? ` · ${selected.altPhone}` : ''}</p>
                {selected.email && <p className="flex items-center gap-2"><Mail size={12} className="text-white/35" /> {selected.email}</p>}
                {selected.address && <p className="flex items-start gap-2"><MapPin size={12} className="text-white/35 mt-0.5 flex-shrink-0" /> {selected.address}</p>}
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] rounded-xl p-3 mb-4" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                {[['GST No.', selected.gst || '—'], ['PAN', selected.pan || '—'], ['Company', selected.companyName || '—'], ['Customer Since', selected.since], ['Occupation', selected.occupation || '—'], ['Reference By', selected.referenceBy || '—'], ['Total Visits', visitsOf(selected)], ['Last Visit', lastVisitOf(selected)], ['Total Revenue', inr(selected.totalSpent)], ['Outstanding', inr(selected.outstanding)]].map(([k, v]) => (
                  <div key={k}><p className="text-white/35">{k}</p><p className={`font-semibold ${k === 'Outstanding' && num(selected.outstanding) > 0 ? 'text-red-400' : 'text-white/85'}`}>{v}</p></div>
                ))}
                {selected.notes && <div className="col-span-2"><p className="text-white/35">Notes</p><p className="text-white/70">{selected.notes}</p></div>}
              </div>

              {/* detail tabs */}
              <div className="flex gap-1 mb-3 overflow-x-auto dark-scroll -mx-1 px-1">
                {['Vehicles', 'Job Cards', 'Invoices', 'Payments', 'Timeline', 'Notes', 'Documents'].map((t) => (
                  <button key={t} onClick={() => setDetailTab(t)} className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap transition ${detailTab === t ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]' : 'text-white/55 bg-white/5 border border-white/10 hover:bg-white/10'}`}>{t}</button>
                ))}
              </div>

              {detailTab === 'Vehicles' && (
                <>
                  {canManage && <button onClick={() => setEditVeh(emptyVehicle())} className="w-full mb-2 h-9 rounded-lg text-[11px] font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] flex items-center justify-center gap-1"><Plus size={12} /> Add Vehicle</button>}
                  <div className="space-y-2">
                    {(selected.vehicles || []).map((v) => (
                      <div key={v.id} className="rounded-xl p-3" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                        <div className="flex items-center gap-2 mb-1.5">
                          {(v.photos || []).length > 0 && <img src={v.photos[v.coverPhoto || 0]} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />}
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-md" style={{ background: 'rgba(212,175,55,0.12)', color: '#d4af37' }}>{v.regNo}</span>
                          {canManage && (
                            <div className="flex gap-1 ml-auto">
                              <button onClick={() => setEditVeh(v)} className="w-6 h-6 rounded-md flex items-center justify-center text-white/45 hover:bg-white/10"><Edit3 size={11} /></button>
                              <button onClick={async () => { if (demoMode) { toast('Demo Mode — This action is disabled. Demo data resets automatically after reload.', { icon: '🧪' }); return; } if (await confirmDialog({ title: `Remove ${v.regNo}?`, message: 'This vehicle will be removed from the customer.', danger: true, confirmText: 'Remove' })) setCustomers((prev) => prev.map((c) => (c.id === selected.id ? { ...c, vehicles: c.vehicles.filter((x) => x.id !== v.id) } : c))); }} className="w-6 h-6 rounded-md flex items-center justify-center text-red-400/60 hover:bg-red-500/10"><Trash2 size={11} /></button>
                            </div>
                          )}
                        </div>
                        <p className="text-sm text-white/90 font-medium">{v.model}{v.variant ? ` ${v.variant}` : ''}</p>
                        <div className="grid grid-cols-2 gap-x-3 text-[10px] text-white/45 mt-1">
                          <span>Fuel: <span className="text-white/70">{v.fuel}</span></span>
                          <span>Year: <span className="text-white/70">{v.year || '—'}</span></span>
                          <span>Insurance: <span className="text-white/70">{v.insuranceExpiry || '—'}</span></span>
                          <span>RC: <span className="text-white/70">{v.rcExpiry || '—'}</span></span>
                        </div>
                      </div>
                    ))}
                    {(selected.vehicles || []).length === 0 && <p className="text-xs text-white/35 text-center py-3">No vehicles yet.</p>}
                  </div>
                </>
              )}

              {detailTab === 'Job Cards' && (
                <div className="space-y-1.5">
                  {cardsOf(selected).length ? [...cardsOf(selected)].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)).map((j, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 rounded-xl text-xs" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                      <span className="text-white/80">{j.jobNo} · {j.vehicle || '—'}</span><span className="text-white/40">{j.status}</span>
                    </div>
                  )) : <p className="text-xs text-white/35 text-center py-4">No job cards yet.</p>}
                  {canManage && <button onClick={() => onCreateJobCard?.(selected)} className="w-full mt-2 h-9 rounded-lg text-[11px] font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">+ Create Job Card</button>}
                </div>
              )}

              {detailTab === 'Invoices' && (
                <div className="space-y-1.5">
                  {invoicesOf(selected).length ? [...invoicesOf(selected)].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((iv, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 rounded-xl text-xs" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                      <span className="text-white/80">{iv.invNo} · {iv.date}</span><span style={{ color: iv.status === 'Paid' ? '#34d399' : iv.status === 'Partial' ? '#fbbf24' : '#f87171' }}>{iv.status}</span>
                    </div>
                  )) : <p className="text-xs text-white/35 text-center py-4">No invoices yet.</p>}
                  {canManage && <button onClick={() => onCreateInvoice?.(selected)} className="w-full mt-2 h-9 rounded-lg text-[11px] font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">+ Create Invoice</button>}
                </div>
              )}

              {detailTab === 'Payments' && (
                <div className="space-y-1.5">
                  {invoicesOf(selected).filter((iv) => num(iv.paid) > 0).length ? invoicesOf(selected).filter((iv) => num(iv.paid) > 0).map((iv, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 rounded-xl text-xs" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                      <span className="text-white/80">{iv.invNo}</span><span className="text-emerald-400">{inr(iv.paid)}</span>
                    </div>
                  )) : <p className="text-xs text-white/35 text-center py-4">No payments recorded.</p>}
                  <div className="flex justify-between px-3 py-2 mt-1 rounded-xl text-xs font-bold" style={{ background: 'rgba(var(--fg-rgb),0.05)' }}><span className="text-white/70">Outstanding</span><span style={{ color: num(selected.outstanding) > 0 ? '#f87171' : '#34d399' }}>{inr(selected.outstanding)}</span></div>
                </div>
              )}

              {detailTab === 'Timeline' && (
                <div className="space-y-2">
                  {[...(selected.history || [])].reverse().map((h, i) => (
                    <div key={i} className="flex gap-2.5">
                      <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: '#d4af37' }} />
                      <div><p className="text-xs text-white/85">{h.action} {h.detail ? <span className="text-white/50">· {h.detail}</span> : null}</p><p className="text-[10px] text-white/35">{new Date(h.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · {h.by}</p></div>
                    </div>
                  ))}
                  {(selected.history || []).length === 0 && <p className="text-xs text-white/35 text-center py-4">No history recorded yet.</p>}
                </div>
              )}

              {detailTab === 'Notes' && (
                <p className="text-xs text-white/70 whitespace-pre-wrap py-2">{selected.notes || 'No notes for this customer.'}</p>
              )}

              {detailTab === 'Documents' && (
                <div className="rounded-xl p-6 text-center" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px dashed rgba(var(--fg-rgb),0.15)' }}>
                  <FileDown size={20} className="mx-auto text-white/25 mb-2" />
                  <p className="text-xs text-white/50">Document uploads (RC, insurance, PAN, GST) arrive in a later part.</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {editCust && <CustomerWizard initial={editCust} existing={customers} canManage={canManage} onSave={saveCustomer} onClose={() => setEditCust(null)} />}
      {editVeh && selected && <VehicleModal initial={editVeh} onSave={saveVehicle} onClose={() => setEditVeh(null)} />}
    </div>
  );
}
