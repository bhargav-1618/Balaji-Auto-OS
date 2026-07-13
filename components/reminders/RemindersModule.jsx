// components/reminders/RemindersModule.jsx — Reminder Management Center.
// Auto-generated reminders derived from live customer/vehicle/billing/PO data
// (kept in sync automatically) PLUS user-created custom reminders persisted
// locally. Actions: complete / snooze / WhatsApp / call. Demo users cannot delete.
import React, { useMemo, useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { BellRing, Search, ShieldAlert, FileClock, Wrench, IndianRupee, MessageCircle, PhoneCall, Plus, Check, Clock, X, ShieldCheck, Truck, PhoneOutgoing, Package, CalendarDays } from 'lucide-react';

const inputCls = 'w-full px-3 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 text-white placeholder-white/25 outline-none focus:border-[#d4af37]/60 transition';
const cardStyle = { background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' };
const days = (d) => { if (!d) return null; const t = new Date(d).getTime(); if (Number.isNaN(t)) return null; return Math.round((t - Date.now()) / 86400000); };
const SERVICE_INTERVAL = 180;
const KIND = {
  Insurance: { icon: ShieldAlert, color: '#f87171' },
  RC: { icon: FileClock, color: '#fbbf24' },
  PUC: { icon: ShieldCheck, color: '#34d399' },
  Warranty: { icon: ShieldCheck, color: '#a78bfa' },
  Service: { icon: Wrench, color: '#60a5fa' },
  Payment: { icon: IndianRupee, color: '#f472b6' },
  'PO Follow-up': { icon: Package, color: '#22d3ee' },
  Delivery: { icon: Truck, color: '#fb923c' },
  'Follow-up': { icon: PhoneOutgoing, color: '#818cf8' },
  Custom: { icon: BellRing, color: '#d4af37' },
};
const kindMeta = (k) => KIND[k] || KIND.Custom;

function Stat({ icon: Icon, label, value, color, onClick }) {
  return (
    <button onClick={onClick} className="text-left rounded-2xl p-3.5 flex items-center gap-3 transition hover:bg-white/[0.05]" style={cardStyle}>
      <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${color}1f`, color }}><Icon size={18} /></span>
      <div className="min-w-0"><p className="text-[10px] uppercase tracking-wide text-white/40 truncate">{label}</p><p className="text-lg font-bold text-white leading-tight">{value}</p></div>
    </button>
  );
}

export default function RemindersModule({ customers = [], invoices = [], jobCards = [], purchaseOrders = [], suppliers = [], demoMode = false }) {
  const [q, setQ] = useState('');
  const [kindF, setKindF] = useState('All');
  const [statusF, setStatusF] = useState('active'); // active | completed | all
  const [custom, setCustom] = useState([]);
  const [done, setDone] = useState(() => new Set());
  const [snoozed, setSnoozed] = useState(() => ({}));
  const [showAdd, setShowAdd] = useState(false);
  const STORE = demoMode ? 'maruti_reminders_demo' : 'maruti_reminders_prod';

  useEffect(() => { try { const d = JSON.parse(localStorage.getItem(STORE) || 'null'); if (d) { setCustom(d.custom || []); setDone(new Set(d.done || [])); setSnoozed(d.snoozed || {}); } } catch {} }, [STORE]);
  const persist = (next) => { try { localStorage.setItem(STORE, JSON.stringify({ custom: next.custom ?? custom, done: [...(next.done ?? done)], snoozed: next.snoozed ?? snoozed })); } catch {} };

  const auto = useMemo(() => {
    const out = [];
    customers.forEach((c) => {
      if (Number(c.outstanding) > 0) out.push({ id: `pay-${c.id}`, kind: 'Payment', title: 'Outstanding payment', detail: `₹${Number(c.outstanding).toLocaleString('en-IN')} pending`, due: null, priority: 2, customer: c.name, phone: c.phone });
      (c.vehicles || []).forEach((v) => {
        const label = `${v.regNo || ''} · ${v.model || v.vehicle || ''}`.trim();
        const add = (kind, field, within) => { const n = days(v[field]); if (n !== null && n <= within) out.push({ id: `${kind}-${c.id}-${v.id || v.regNo}`, kind, title: `${kind} renewal`, detail: `${label} — ${n < 0 ? `expired ${-n}d ago` : `${n}d left`}`, due: v[field], priority: n < 0 ? 3 : 2, customer: c.name, phone: c.phone }); };
        add('Insurance', 'insuranceExpiry', 45); add('RC', 'rcExpiry', 45); add('PUC', 'pucExpiry', 30); add('Warranty', 'warrantyExpiry', 45);
        if (v.lastService) { const since = -days(v.lastService); if (since >= SERVICE_INTERVAL - 15) out.push({ id: `svc-${c.id}-${v.id || v.regNo}`, kind: 'Service', title: 'Service due', detail: `${label} — last serviced ${since}d ago`, due: null, priority: since >= SERVICE_INTERVAL ? 2 : 1, customer: c.name, phone: c.phone }); }
      });
    });
    jobCards.forEach((j) => { if (j.status === 'Ready') out.push({ id: `del-${j.jobNo}`, kind: 'Delivery', title: 'Vehicle pickup', detail: `${j.vehicle || ''} ready · ${j.jobNo}`, due: null, priority: 2, customer: j.customer, phone: j.phone }); });
    purchaseOrders.forEach((po) => { if (['draft', 'pending', 'sent'].includes(po.status)) out.push({ id: `pofu-${po.id}`, kind: 'PO Follow-up', title: 'Purchase order follow-up', detail: `${po.poNumber} · ${po.supplierName || ''} (${po.status})`, due: po.expectedDate || null, priority: 1, customer: po.supplierName }); });
    return out;
  }, [customers, jobCards, purchaseOrders]);

  const all = useMemo(() => {
    const now = Date.now();
    return [...auto, ...custom].map((r) => {
      const sn = snoozed[r.id];
      const effectiveDue = sn || r.due;
      const isDone = done.has(r.id) || r.status === 'Completed';
      const dleft = days(effectiveDue);
      return { ...r, effectiveDue, isDone, dleft, overdue: !isDone && ((dleft !== null && dleft < 0) || r.priority === 3), snoozedTill: sn };
    }).filter((r) => !(snoozed[r.id] && new Date(snoozed[r.id]).getTime() > now && !r.isDone) ? true : true);
  }, [auto, custom, done, snoozed]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return all.filter((r) => {
      if (statusF === 'active' && r.isDone) return false;
      if (statusF === 'completed' && !r.isDone) return false;
      if (kindF !== 'All' && r.kind !== kindF) return false;
      if (ql && ![r.customer, r.detail, r.title, r.kind].filter(Boolean).join(' ').toLowerCase().includes(ql)) return false;
      return true;
    }).sort((a, b) => (b.overdue - a.overdue) || (b.priority - a.priority));
  }, [all, q, kindF, statusF]);

  const cards = useMemo(() => {
    const isDue = (r, lo, hi) => { const d = r.dleft; return !r.isDone && d !== null && d >= lo && d <= hi; };
    return {
      today: all.filter((r) => isDue(r, 0, 0)).length,
      tomorrow: all.filter((r) => isDue(r, 1, 1)).length,
      week: all.filter((r) => isDue(r, 0, 7)).length,
      overdue: all.filter((r) => r.overdue).length,
      service: all.filter((r) => r.kind === 'Service' && !r.isDone).length,
      insurance: all.filter((r) => r.kind === 'Insurance' && !r.isDone).length,
      payment: all.filter((r) => r.kind === 'Payment' && !r.isDone).length,
      completed: all.filter((r) => r.isDone).length,
    };
  }, [all]);

  const complete = (r) => { const n = new Set(done); n.add(r.id); setDone(n); persist({ done: n }); toast.success('Marked complete'); };
  const reopen = (r) => { const n = new Set(done); n.delete(r.id); setDone(n); persist({ done: n }); };
  const snooze = (r, d = 3) => { const till = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10); const n = { ...snoozed, [r.id]: till }; setSnoozed(n); persist({ snoozed: n }); toast.success(`Snoozed ${d} day(s)`); };
  const addCustom = (rem) => { const next = [...custom, { ...rem, id: `custom-${Date.now()}`, kind: rem.kind || 'Custom', priority: rem.priority || 1 }]; setCustom(next); persist({ custom: next }); setShowAdd(false); toast.success('Reminder added'); };
  const delCustom = (r) => { if (demoMode) { toast('Demo Mode — This action is disabled. Demo data resets automatically after reload.', { icon: '🧪' }); return; } const next = custom.filter((x) => x.id !== r.id); setCustom(next); persist({ custom: next }); toast.success('Deleted'); };

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 mb-4">
        <Stat icon={CalendarDays} label="Today" value={cards.today} color="#d4af37" onClick={() => { setStatusF('active'); setKindF('All'); }} />
        <Stat icon={CalendarDays} label="Tomorrow" value={cards.tomorrow} color="#60a5fa" onClick={() => setStatusF('active')} />
        <Stat icon={CalendarDays} label="This Week" value={cards.week} color="#a78bfa" onClick={() => setStatusF('active')} />
        <Stat icon={Clock} label="Overdue" value={cards.overdue} color="#f87171" onClick={() => setStatusF('active')} />
        <Stat icon={Wrench} label="Service Due" value={cards.service} color="#60a5fa" onClick={() => setKindF('Service')} />
        <Stat icon={ShieldAlert} label="Insurance Due" value={cards.insurance} color="#fb923c" onClick={() => setKindF('Insurance')} />
        <Stat icon={IndianRupee} label="Payments" value={cards.payment} color="#f472b6" onClick={() => setKindF('Payment')} />
        <Stat icon={Check} label="Completed" value={cards.completed} color="#34d399" onClick={() => setStatusF('completed')} />
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reminders by customer, detail, type…" className={`${inputCls} pl-9`} />
        </div>
        <select value={kindF} onChange={(e) => setKindF(e.target.value)} className={`${inputCls} sm:w-40`}>{['All', ...Object.keys(KIND)].map((t) => <option key={t} style={{ background: '#141414' }}>{t === 'All' ? 'All Types' : t}</option>)}</select>
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className={`${inputCls} sm:w-32`}>{[['active', 'Active'], ['completed', 'Completed'], ['all', 'All']].map(([v, l]) => <option key={v} value={v} style={{ background: '#141414' }}>{l}</option>)}</select>
        <button onClick={() => setShowAdd(true)} className="h-11 px-4 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] flex items-center gap-1.5 whitespace-nowrap"><Plus size={14} /> Add Reminder</button>
      </div>

      <div className="space-y-2">
        {filtered.map((r) => {
          const K = kindMeta(r.kind); const Icon = K.icon;
          return (
            <div key={r.id} className={`rounded-2xl p-3.5 flex items-center gap-3 ${r.isDone ? 'opacity-55' : ''}`} style={cardStyle}>
              <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${K.color}1f`, color: K.color }}><Icon size={17} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white/90 flex items-center gap-1.5 flex-wrap">{r.title}
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${K.color}22`, color: K.color }}>{r.kind}</span>
                  {r.overdue && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#f8717124', color: '#f87171' }}>OVERDUE</span>}
                  {r.isDone && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#34d39924', color: '#34d399' }}>DONE</span>}
                  {r.snoozedTill && !r.isDone && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#94a3b824', color: '#94a3b8' }}>SNOOZED</span>}
                </p>
                <p className="text-xs text-white/50">{[r.customer, r.detail].filter(Boolean).join(' · ')}{r.effectiveDue ? ` · due ${r.effectiveDue}` : ''}</p>
              </div>
              <div className="flex gap-1.5 flex-shrink-0">
                {r.phone && <a href={`https://wa.me/91${(r.phone || '').replace(/\D/g, '')}`} target="_blank" rel="noreferrer" title="WhatsApp" className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-emerald-400/80 hover:bg-white/10"><MessageCircle size={14} /></a>}
                {r.phone && <a href={`tel:+91${(r.phone || '').replace(/\D/g, '')}`} title="Call" className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 hover:bg-white/10"><PhoneCall size={14} /></a>}
                {!r.isDone ? <button onClick={() => complete(r)} title="Mark complete" className="w-8 h-8 rounded-lg flex items-center justify-center bg-emerald-500/12 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20"><Check size={14} /></button>
                  : <button onClick={() => reopen(r)} title="Reopen" className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60"><Clock size={14} /></button>}
                {!r.isDone && <button onClick={() => snooze(r, 3)} title="Snooze 3 days" className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 hover:bg-white/10"><Clock size={14} /></button>}
                {r.id.startsWith('custom-') && <button onClick={() => delCustom(r)} title="Delete" className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-red-400/70 hover:bg-red-500/10"><X size={14} /></button>}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="rounded-2xl p-12 text-center" style={cardStyle}>
            <BellRing size={26} className="mx-auto text-white/20 mb-3" />
            <p className="text-sm text-white/60">No reminders match.</p>
            <p className="text-xs text-white/35 mt-1">Reminders appear automatically from insurance/RC/PUC/warranty expiry, service intervals, outstanding balances, ready-for-pickup job cards, and pending POs. Add your own with “Add Reminder”.</p>
          </div>
        )}
      </div>

      {showAdd && <AddReminderModal customers={customers} onAdd={addCustom} onClose={() => setShowAdd(false)} />}
    </div>
  );
}

function AddReminderModal({ customers, onAdd, onClose }) {
  const [f, setF] = useState({ title: '', kind: 'Custom', detail: '', customer: '', phone: '', due: '', priority: 1 });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <div className="fixed inset-0 z-[130] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(3px)' }} onClick={onClose}>
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
          <h3 className="text-base font-bold text-white">Add Reminder</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10"><X size={17} /></button>
        </div>
        <div className="p-5 space-y-3">
          <input value={f.title} onChange={set('title')} placeholder="Title" className={inputCls} />
          <div className="grid grid-cols-2 gap-2">
            <select value={f.kind} onChange={set('kind')} className={inputCls}>{['Custom', 'Follow-up', 'Service', 'Payment', 'Delivery', 'PO Follow-up'].map((k) => <option key={k} style={{ background: '#141414' }}>{k}</option>)}</select>
            <select value={f.priority} onChange={(e) => setF((s) => ({ ...s, priority: Number(e.target.value) }))} className={inputCls}><option value={1} style={{ background: '#141414' }}>Low</option><option value={2} style={{ background: '#141414' }}>Medium</option><option value={3} style={{ background: '#141414' }}>High</option></select>
          </div>
          <input value={f.detail} onChange={set('detail')} placeholder="Detail / note" className={inputCls} />
          <div className="grid grid-cols-2 gap-2">
            <input value={f.customer} onChange={set('customer')} placeholder="Customer (optional)" className={inputCls} />
            <input value={f.phone} onChange={(e) => setF((s) => ({ ...s, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} placeholder="Phone (optional)" className={inputCls} />
          </div>
          <div><label className="text-[11px] text-white/40">Due date</label><input type="date" value={f.due} onChange={set('due')} className={inputCls} style={{ colorScheme: 'dark' }} /></div>
        </div>
        <div className="flex gap-2 px-5 py-4" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.08)', background: 'var(--surface-2)', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <button onClick={onClose} className="flex-1 py-3 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80">Cancel</button>
          <button onClick={() => { if (!f.title.trim()) { toast.error('Enter a title'); return; } onAdd(f); }} className="flex-1 py-3 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">Add Reminder</button>
        </div>
      </div>
    </div>
  );
}
