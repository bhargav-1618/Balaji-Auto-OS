// components/reminders/RemindersModule.jsx — Reminder Management Center.
// System-derived reminders computed from live customer/vehicle/billing/PO data
// (kept in sync automatically) PLUS user-created custom reminders persisted
// locally. Actions: complete / snooze / WhatsApp / call. Demo users cannot delete.
import React, { useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import toast from '../../lib/toast';
import notify from '../common/notify';
import { BellRing, Search, ShieldAlert, FileClock, Wrench, IndianRupee, MessageCircle, PhoneCall, Plus, Check, Clock, X, ShieldCheck, Truck, PhoneOutgoing, Package, CalendarDays } from 'lucide-react';
import NotificationRow from '../common/NotificationRow';
import { useSearchIndex, matchIndexed, rankIndexed, useDeferredSearch } from '../../lib/useSearch';
import PageHeader from '../common/PageHeader';
import MiniSelect from '../common/MiniSelect';
import LocalCapacityBanner from '../common/LocalCapacityBanner';
import { getLocalCapacityStatus } from '../../services/localCapacityService';
import { SEMANTIC } from '../../constants/ui';
import { useTranslation } from '../../lib/i18n';
import { isIndianMobile, MOBILE_ERROR } from '../../lib/format';

const inputCls = 'w-full px-3 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 text-white placeholder-white/25 outline-none focus:border-[#d4af37]/60 transition';
const cardStyle = { background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' };
const days = (d) => { if (!d) return null; const t = new Date(d).getTime(); if (Number.isNaN(t)) return null; return Math.round((t - Date.now()) / 86400000); };
// Settings QA fix: Settings -> Job Cards -> Service Reminder Days (placeholder
// "180", biz.serviceReminderDays) saved correctly but nothing read it — this
// component's own "Service due" auto-reminder used a hardcoded 180 (the exact
// same default value) regardless of what was actually saved.
const DEFAULT_SERVICE_INTERVAL = 180;
const readServiceInterval = (demoMode) => {
  try {
    const v = Number(JSON.parse(localStorage.getItem(demoMode ? 'maruti_settings_demo' : 'maruti_settings') || '{}').serviceReminderDays);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_SERVICE_INTERVAL;
  } catch { return DEFAULT_SERVICE_INTERVAL; }
};
// COLOR SYSTEM REVIEW: 'Insurance' and 'Payment' rendered their per-row type icon in red
// and pink respectively, while the KPI filter buttons above for those exact same kinds
// ("Insurance Due", "Payments") are both SEMANTIC.warn — clicking the amber "Insurance
// Due" button landed on a list where every row's own icon then read as danger-red, fighting
// with the separate OVERDUE badge that's supposed to be the one actual urgency signal.
// Aligned both to match their own KPI card. The rest have no KPI counterpart to conflict
// with and stay as distinct category colors (Section 14's "restrained but genuinely
// distinguishing" category-color allowance), several of which already equal SEMANTIC
// tokens exactly (RC=warn, PUC=ok, Service=info, Custom=gold).
const KIND = {
  Insurance: { icon: ShieldAlert, color: SEMANTIC.warn },
  RC: { icon: FileClock, color: '#fbbf24' },
  PUC: { icon: ShieldCheck, color: '#34d399' },
  Warranty: { icon: ShieldCheck, color: '#a78bfa' },
  Service: { icon: Wrench, color: '#60a5fa' },
  Payment: { icon: IndianRupee, color: SEMANTIC.warn },
  'PO Follow-up': { icon: Package, color: '#22d3ee' },
  Delivery: { icon: Truck, color: '#fb923c' },
  'Follow-up': { icon: PhoneOutgoing, color: '#818cf8' },
  Custom: { icon: BellRing, color: '#d4af37' },
};
const kindMeta = (k) => KIND[k] || KIND.Custom;

function Stat({ icon: Icon, label, value, color, onClick }) {
  // Mobile QA fix: same gap as Billing's/Customers' own Stat components — no
  // whitespace-nowrap/tabular-nums on the value let a long figure wrap mid-digit at
  // narrow phone widths. Nowrap + shrink-a-step, matching the other three Stat components.
  const text = String(value ?? '');
  const size = text.length > 9 ? 'text-sm' : text.length > 6 ? 'text-base' : 'text-lg';
  return (
    <button onClick={onClick} className="text-left rounded-2xl p-3.5 flex items-center gap-3 transition hover:bg-white/[0.05]" style={cardStyle}>
      <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${color}1f`, color }}><Icon size={18} /></span>
      <div className="min-w-0"><p className="text-[10px] uppercase tracking-wide text-white/45 truncate">{label}</p><p className={`${size} font-bold text-white leading-tight whitespace-nowrap tabular-nums`}>{value}</p></div>
    </button>
  );
}

export default function RemindersModule({ customers = [], invoices = [], jobCards = [], purchaseOrders = [], suppliers = [], demoMode = false, onAudit }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [kindF, setKindF] = useState('All');
  const [statusF, setStatusF] = useState('active'); // active | completed | all
  const [custom, setCustom] = useState([]);
  const [done, setDone] = useState(() => new Set());
  const [snoozed, setSnoozed] = useState(() => ({}));
  const [showAdd, setShowAdd] = useState(false);
  const STORE = demoMode ? 'maruti_reminders_demo' : 'maruti_reminders_prod';
  const [serviceInterval, setServiceInterval] = useState(() => readServiceInterval(demoMode));
  useEffect(() => {
    const reload = () => setServiceInterval(readServiceInterval(demoMode));
    reload();
    window.addEventListener('maruti-settings', reload);
    window.addEventListener('storage', reload);
    return () => { window.removeEventListener('maruti-settings', reload); window.removeEventListener('storage', reload); };
  }, [demoMode]);

  useEffect(() => { try { const d = JSON.parse(localStorage.getItem(STORE) || 'null'); if (d) { setCustom(d.custom || []); setDone(new Set(d.done || [])); setSnoozed(d.snoozed || {}); } } catch {} }, [STORE]);
  const persist = (next) => { try { localStorage.setItem(STORE, JSON.stringify({ custom: next.custom ?? custom, done: [...(next.done ?? done)], snoozed: next.snoozed ?? snoozed })); } catch {} };

  // Universal capacity rollout (Reminders) — see services/localCapacityService.js's
  // header for why this is a separate, lighter engine than services/capacityService.js:
  // "auto" reminders below are computed live and never persisted at all (nothing to
  // manage), so the only genuinely unbounded, persisted growth here is `custom` — a
  // real user-created record that nothing has ever removed. A reminder is only eligible
  // once it's actually `done` (completed) — never by creation age alone, so a reminder
  // created in January with a December due date is never touched just for being "old"
  // (the brief's own worked example). `custom-<ms>` ids already embed their creation
  // time (see addCustom below), so no new field/migration is needed to order oldest-first.
  const reminderCapacityEntries = useMemo(() => custom.map((r) => {
    const ms = Number(String(r.id).split('-')[1]);
    return { id: r.id, at: Number.isFinite(ms) ? new Date(ms) : null, eligible: done.has(r.id) };
  }), [custom, done]);
  const reminderCapacityStatus = useMemo(() => getLocalCapacityStatus(reminderCapacityEntries.length), [reminderCapacityEntries.length]);
  const pruneReminders = async (eligible) => {
    const ids = new Set(eligible.map((e) => e.id));
    const nextCustom = custom.filter((r) => !ids.has(r.id));
    const nextDone = new Set([...done].filter((id) => !ids.has(id)));
    const nextSnoozed = Object.fromEntries(Object.entries(snoozed).filter(([id]) => !ids.has(id)));
    setCustom(nextCustom);
    setDone(nextDone);
    setSnoozed(nextSnoozed);
    persist({ custom: nextCustom, done: nextDone, snoozed: nextSnoozed });
    onAudit?.({ action: 'capacity_delete', entity: 'Reminders', detail: `${ids.size} completed reminder${ids.size === 1 ? '' : 's'} removed via capacity cleanup` });
    return { count: ids.size };
  };

  const auto = useMemo(() => {
    const out = [];
    customers.forEach((c) => {
      if (Number(c.outstanding) > 0) out.push({ id: `pay-${c.id}`, kind: 'Payment', title: 'Outstanding payment', detail: `₹${Number(c.outstanding).toLocaleString('en-IN')} pending`, due: null, priority: 2, customer: c.name, phone: c.phone });
      (c.vehicles || []).forEach((v) => {
        const label = `${v.regNo || ''} · ${v.model || v.vehicle || ''}`.trim();
        // Universal Search review: regNo exposed as its own field (not just baked into
        // `detail`) so it can be matched as an EXACT-then-partial identifier via
        // rankIndexed, same as every other module's registration search.
        const add = (kind, field, within) => { const n = days(v[field]); if (n !== null && n <= within) out.push({ id: `${kind}-${c.id}-${v.id || v.regNo}`, kind, title: `${kind} renewal`, detail: `${label} — ${n < 0 ? `expired ${-n}d ago` : `${n}d left`}`, due: v[field], priority: n < 0 ? 3 : 2, customer: c.name, phone: c.phone, regNo: v.regNo }); };
        add('Insurance', 'insuranceExpiry', 45); add('RC', 'rcExpiry', 45); add('PUC', 'pucExpiry', 30); add('Warranty', 'warrantyExpiry', 45);
        if (v.lastService) { const since = -days(v.lastService); if (since >= serviceInterval - 15) out.push({ id: `svc-${c.id}-${v.id || v.regNo}`, kind: 'Service', title: 'Service due', detail: `${label} — last serviced ${since}d ago`, due: null, priority: since >= serviceInterval ? 2 : 1, customer: c.name, phone: c.phone, regNo: v.regNo }); }
      });
    });
    jobCards.forEach((j) => { if (j.status === 'Ready') out.push({ id: `del-${j.jobNo}`, kind: 'Delivery', title: 'Vehicle pickup', detail: `${j.vehicle || ''} ready · ${j.jobNo}`, due: null, priority: 2, customer: j.customer, phone: j.phone, jobNo: j.jobNo, regNo: j.regNo }); });
    purchaseOrders.forEach((po) => { if (['draft', 'pending', 'sent'].includes(po.status)) out.push({ id: `pofu-${po.id}`, kind: 'PO Follow-up', title: 'Purchase order follow-up', detail: `${po.poNumber} · ${po.supplierName || ''} (${po.status})`, due: po.expectedDate || null, priority: 1, customer: po.supplierName, poNumber: po.poNumber }); });
    return out;
  }, [customers, jobCards, purchaseOrders, serviceInterval]);

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

  // Universal Search review: Job No./PO No./Registration are exact-then-partial
  // identifiers via rankIndexed — previously only reachable as an incidental substring
  // of the pre-formatted `detail` string, with no isolation from customer/title/kind
  // free text and no way to rank an exact identifier hit above a coincidental match.
  const [dq] = useDeferredSearch(q);
  const reminderSearchIndex = useSearchIndex(
    all,
    (r) => r.id,
    (r) => [r.customer, r.detail, r.title, r.kind],
    (r) => [r.jobNo, r.poNumber, r.regNo],
    [done, snoozed],
  );
  const filtered = useMemo(() => {
    const needle = dq.trim();
    let list = all.filter((r) => {
      if (statusF === 'active' && r.isDone) return false;
      if (statusF === 'completed' && !r.isDone) return false;
      if (kindF !== 'All' && r.kind !== kindF) return false;
      return matchIndexed(reminderSearchIndex.get(r.id), needle);
    });
    if (needle) {
      // An active query ranks exact-identifier/text hits first; urgency (overdue,
      // priority) breaks ties, same as the no-query default ordering below.
      list = [...list].sort((a, b) => rankIndexed(reminderSearchIndex.get(b.id), needle) - rankIndexed(reminderSearchIndex.get(a.id), needle)
        || (b.overdue - a.overdue) || (b.priority - a.priority));
    } else {
      list = [...list].sort((a, b) => (b.overdue - a.overdue) || (b.priority - a.priority));
    }
    return list;
  }, [all, dq, kindF, statusF, reminderSearchIndex]);

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
  const delCustom = (r) => { if (demoMode) { notify.info('Demo Mode — This action is disabled. Demo data resets automatically after reload.'); return; } const next = custom.filter((x) => x.id !== r.id); setCustom(next); persist({ custom: next }); notify.deleted('Deleted'); };

  return (
    <PageHeader title={t('page.reminders', 'Reminders')} icon={BellRing} action={
      <button onClick={() => setShowAdd(true)} className="h-11 px-4 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] flex items-center gap-1.5 whitespace-nowrap"><Plus size={14} /> {t('reminders.addReminder', 'Add Reminder')}</button>
    }>
      <LocalCapacityBanner
        moduleKey="reminders"
        moduleLabel="Reminders"
        recordLabel="reminder"
        status={reminderCapacityStatus}
        getEntries={() => reminderCapacityEntries}
        methodTitle="Clean Up Completed Reminders"
        methodBlurb="Permanently remove reminders already marked complete. Active, overdue-but-unresolved, and future reminders are never touched, no matter how long ago they were created."
        onConfirm={pruneReminders}
        canManage={!demoMode}
        className="mb-4"
      />
      {/* COLOR SYSTEM REVIEW: "Insurance Due" was orange here but Vehicles' own
          "Insurance Expiring" KPI is amber (SEMANTIC.warn) for the identical underlying
          concept — the same word/state must be the same color everywhere (see
          VehiclesModule.jsx's own STAT_GROUPS comment). Aligned. Tomorrow/This Week were
          decorative blue/violet with no status meaning (plain date-bucket counts, now
          neutral); Payments was pink with no semantic reason — an upcoming-payment
          reminder is an attention/warning state, now amber, consistent with Billing's
          "Pending Payments". Today keeps gold (the day's actionable priority), Overdue
          stays red (danger), Completed stays green (success), Service Due stays blue
          (a genuine informational workflow category, distinct from the date buckets). */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 mb-4">
        <Stat icon={CalendarDays} label={t('reminders.kpi.today', 'Today')} value={cards.today} color={SEMANTIC.gold} onClick={() => { setStatusF('active'); setKindF('All'); }} />
        <Stat icon={CalendarDays} label={t('reminders.kpi.tomorrow', 'Tomorrow')} value={cards.tomorrow} color={SEMANTIC.muted} onClick={() => setStatusF('active')} />
        <Stat icon={CalendarDays} label={t('reminders.kpi.thisWeek', 'This Week')} value={cards.week} color={SEMANTIC.muted} onClick={() => setStatusF('active')} />
        <Stat icon={Clock} label={t('reminders.kpi.overdue', 'Overdue')} value={cards.overdue} color={SEMANTIC.danger} onClick={() => setStatusF('active')} />
        <Stat icon={Wrench} label={t('reminders.kpi.serviceDue', 'Service Due')} value={cards.service} color={SEMANTIC.info} onClick={() => setKindF('Service')} />
        <Stat icon={ShieldAlert} label={t('reminders.kpi.insuranceDue', 'Insurance Due')} value={cards.insurance} color={SEMANTIC.warn} onClick={() => setKindF('Insurance')} />
        <Stat icon={IndianRupee} label={t('reminders.kpi.payments', 'Payments')} value={cards.payment} color={SEMANTIC.warn} onClick={() => setKindF('Payment')} />
        <Stat icon={Check} label={t('common.completed', 'Completed')} value={cards.completed} color={SEMANTIC.ok} onClick={() => setStatusF('completed')} />
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/45" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('reminders.searchPlaceholder', 'Search reminders by customer, detail, type…')} className={`${inputCls} pl-9`} />
        </div>
        <select value={kindF} onChange={(e) => setKindF(e.target.value)} className={`${inputCls} sm:w-40`}>{['All', ...Object.keys(KIND)].map((kd) => <option key={kd} style={{ background: '#141414' }}>{kd === 'All' ? t('reminders.filter.allTypes', 'All Types') : kd}</option>)}</select>
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className={`${inputCls} sm:w-32`}>{[['active', t('status.active', 'Active')], ['completed', t('common.completed', 'Completed')], ['all', t('common.all', 'All')]].map(([v, l]) => <option key={v} value={v} style={{ background: '#141414' }}>{l}</option>)}</select>
      </div>

      <div className="space-y-2">
        {filtered.map((r) => {
          const K = kindMeta(r.kind);
          const titleChips = [
            { label: r.kind, color: K.color },
            r.overdue && { label: 'OVERDUE', color: '#f87171' },
            r.isDone && { label: 'DONE', color: '#34d399' },
            r.snoozedTill && !r.isDone && { label: 'SNOOZED', color: '#94a3b8' },
          ].filter(Boolean);
          return (
            <NotificationRow
              key={r.id}
              icon={K.icon}
              iconColor={K.color}
              accentColor={K.color}
              title={r.title}
              titleChips={titleChips}
              meta={`${[r.customer, r.detail].filter(Boolean).join(' · ')}${r.effectiveDue ? ` · due ${r.effectiveDue}` : ''}`}
              muted={r.isDone}
              actions={[
                r.phone && { icon: MessageCircle, title: 'WhatsApp', href: `https://wa.me/91${(r.phone || '').replace(/\D/g, '')}`, target: '_blank', rel: 'noreferrer', className: 'bg-white/5 border border-white/10 text-emerald-400/80 hover:bg-white/10' },
                r.phone && { icon: PhoneCall, title: 'Call', href: `tel:+91${(r.phone || '').replace(/\D/g, '')}` },
                !r.isDone
                  ? { icon: Check, title: 'Mark complete', onClick: () => complete(r), className: 'bg-emerald-500/12 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20' }
                  : { icon: Clock, title: 'Reopen', onClick: () => reopen(r) },
                !r.isDone && { icon: Clock, title: 'Snooze 3 days', onClick: () => snooze(r, 3) },
                r.id.startsWith('custom-') && { icon: X, title: 'Delete', onClick: () => delCustom(r), className: 'bg-white/5 border border-white/10 text-red-400/70 hover:bg-red-500/10' },
              ].filter(Boolean)}
            />
          );
        })}
        {filtered.length === 0 && (
          <div className="rounded-2xl p-12 text-center" style={cardStyle}>
            <BellRing size={26} className="mx-auto text-white/20 mb-3" />
            <p className="text-sm text-white/60">No reminders match.</p>
            <p className="text-xs text-white/45 mt-1">Reminders appear automatically from insurance/RC/PUC/warranty expiry, service intervals, outstanding balances, ready-for-pickup job cards, and pending POs. Add your own with “Add Reminder”.</p>
          </div>
        )}
      </div>

      {showAdd && <AddReminderModal customers={customers} onAdd={addCustom} onClose={() => setShowAdd(false)} />}
    </PageHeader>
  );
}

function AddReminderModal({ customers, onAdd, onClose }) {
  const [f, setF] = useState({ title: '', kind: 'Custom', detail: '', customer: '', phone: '', due: '', priority: 1 });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  // Portal to <body>: this modal renders inside <main> (`relative z-10`, its own
  // stacking context), so an inline `fixed inset-0 z-[130]` is still capped at
  // <main>'s z-10 and loses to the mobile bottom-nav (z-[80]) — on a phone the
  // sheet's Cancel / Add Reminder buttons ended up hidden behind the nav bar.
  // Same fix already used for CustomerWizard, LedgerPage and the Job Card drawer.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(3px)' }} onClick={onClose}>
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
          <h3 className="text-base font-bold text-white">Add Reminder</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10"><X size={17} /></button>
        </div>
        <div className="p-5 space-y-3">
          <input value={f.title} onChange={set('title')} placeholder="Title" className={inputCls} />
          <div className="grid grid-cols-2 gap-2">
            {/* Universal dropdown architecture review — native <select> is a browser-owned
                popup, immune to this app's theming/containment. */}
            <MiniSelect value={f.kind} options={['Custom', 'Follow-up', 'Service', 'Payment', 'Delivery', 'PO Follow-up']} emptyValue="Custom" onPick={(v) => setF((s) => ({ ...s, kind: v || 'Custom' }))} inputCls={inputCls} />
            <MiniSelect
              value={String(f.priority)}
              options={['1', '2', '3']}
              labels={{ '1': 'Low', '2': 'Medium', '3': 'High' }}
              emptyValue="1"
              onPick={(v) => setF((s) => ({ ...s, priority: Number(v || 1) }))}
              inputCls={inputCls}
            />
          </div>
          <input value={f.detail} onChange={set('detail')} placeholder="Detail / note" className={inputCls} />
          <div className="grid grid-cols-2 gap-2">
            <input value={f.customer} onChange={set('customer')} placeholder="Customer (optional)" className={inputCls} />
            <input value={f.phone} onChange={(e) => setF((s) => ({ ...s, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} placeholder="Phone (optional)" className={`${inputCls} ${f.phone && !isIndianMobile(f.phone) ? 'border-red-500/60' : ''}`} />
          </div>
          <div><label className="text-[11px] text-white/45">Due date</label><input type="date" value={f.due} onChange={set('due')} className={inputCls} style={{ colorScheme: 'dark' }} /></div>
        </div>
        <div className="flex gap-2 px-5 py-4" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.08)', background: 'var(--surface-2)', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <button onClick={onClose} className="flex-1 py-3 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80">Cancel</button>
          <button onClick={() => { if (!f.title.trim()) { toast.error('Enter a title'); return; } if (f.phone && !isIndianMobile(f.phone)) { toast.error(MOBILE_ERROR); return; } onAdd(f); }} className="flex-1 py-3 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">Add Reminder</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
