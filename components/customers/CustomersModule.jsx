// components/customers/CustomersModule.jsx — v1
// Master–detail Customers module per reference: stats row → searchable/filterable
// table (type badges, vehicles, visits, spent, outstanding, status, actions) →
// right detail panel (profile, meta grid, vehicles w/ Add Vehicle, full history
// from Job Cards). All subcomponents hoisted (focus-safe). Local persistence v1.
import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import toast from '../../lib/toast';
import { confirmDialog } from '../common/ConfirmDialog';
import SharedBadge from '../common/Badge';
import ActionMenu from '../common/ActionMenu';
import PageHeader from '../common/PageHeader';
import notify from '../common/notify';
import MiniSelect from '../common/MiniSelect';
import { ModalBoundaryContext } from '../common/DropdownPanel';
import DetailsPanel from '../common/DetailsPanel';
import DetailHero from '../common/DetailHero';
import { appScrollTo, appScrollY } from '../../lib/appScroll';
import VehicleMakeModelSelect from '../common/VehicleMakeModelSelect';
import { num, isIndianMobile, isValidEmail, mobileInput, MOBILE_ERROR, EMAIL_ERROR } from '../../lib/format';
import { SEMANTIC } from '../../constants/ui';
import { writeSheet, stamp } from '../../lib/exportSheet';
import { exportReportPDF } from '../../lib/pdfTheme';
import { resolveSelectedRecords, countHiddenSelections } from '../../lib/selectionScope';
import { useDeferredSearch, useSearchIndex, searchAndRank, indexBy, phoneKey } from '../../lib/useSearch';
import { useEditLease } from '../../hooks/useEditLease';
import EditLeaseBanner from '../common/EditLeaseBanner';
import { variantsFor, FUELS, TRANSMISSIONS } from '../../lib/vehicleCatalog';
import { INDIAN_STATES } from '../../lib/indianStates';
import { INDIAN_DISTRICTS, CITY_MASTER_DATA } from '../../lib/indianDistricts';
import { isValidGstin, GSTIN_ERROR } from '../../lib/gst';
import { useTranslation } from '../../lib/i18n';
import {
  Users, UserCheck, Car, IndianRupee, Search, Plus, Eye, Edit3, Trash2, Lock,
  X, Phone, Mail, MapPin, ChevronLeft, ChevronRight, FileDown, History, MoreVertical, AlertCircle, MessageCircle, PhoneCall, Archive, ClipboardList, Receipt, Camera, Upload, Star, ChevronDown, Check, Copy,
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
// Batch 4A Defect 4 — live paste-artifact sanitizer for single-line text fields (Name,
// Company, Occupation, Reference By). Pasting from Excel/WhatsApp often carries a
// trailing newline or a tab from an adjacent cell; a literal newline inside what
// renders as a one-line input looks fine while typing but corrupts the value (and,
// for Name, ends up on printed job cards/invoices). Only strips control whitespace —
// never touches ordinary spaces, so normal typing is untouched.
const sanitizeSingleLine = (s) => (s || '').replace(/[\r\n\t]+/g, ' ');
// Trim + collapse any run of 2+ spaces into one — applied at SAVE time (not live, so
// it never fights an in-progress keystroke/cursor position), for the same free-text
// fields. A stray double space is invisible on screen but reads as sloppy data on a
// printed document and, more importantly, silently breaks exact-match comparisons
// (name dedup, search) that a human would consider identical.
const cleanText = (s) => (s || '').trim().replace(/\s{2,}/g, ' ');
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
// E2E workflow QA fix: this used to auto-generate "SBBMC##" — the EXACT SAME default
// prefix/format Job Cards use for their own, entirely independent auto-numbering
// (jobCardService.js's nextJobCardNumber scans only saved job cards; this scans only
// existing customers). Two uncoordinated counters sharing one format WILL collide —
// reproduced live: the first customer ever created and the first Job Card ever created
// on a fresh shop both auto-generate as "SBBMC01", so a Workshop Copy invoice PDF shows
// an identical "CUSTOMER ID" and "JOB CARD NO" for two unrelated records, which reads as
// a data-entry error rather than the coincidence it is. The Manual Entry field right
// next to this toggle already documents the intended customer-code format via its own
// placeholder ("e.g. CUST-0009") — Auto Generate now actually produces that format
// instead of silently borrowing the Job Card scheme, which also structurally rules out
// any future collision (different prefix entirely).
// Anchored to the CUST- prefix (exact match, no blanket digit-strip) — a loose
// strip-all-non-digits scan lets ANY digits anywhere in a manually-entered code (e.g.
// a code with an embedded year) corrupt the max-scan and produce absurd future codes.
// Non-matching codes are simply excluded from the scan, not coerced into it.
const nextCode = (list) => {
  const max = (list || []).reduce((m, c) => {
    const match = /^CUST-(\d+)$/.exec(c.code || '');
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
  return `CUST-${String(max + 1).padStart(4, '0')}`;
};

// Batch 4A Defect 3 — catches "same customer, spelling variation" (e.g. "Ramesh" vs
// "Rammesh") that an exact-match comparison misses entirely. Capped at short strings
// only (both names <= 40 chars) since this runs against every existing customer on
// every keystroke of a new name — a full unbounded Levenshtein over 10,000+ customers
// would be wasteful; real names are short, so this cap is never actually hit.
const levenshtein = (a, b) => {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (!la) return lb;
  if (!lb) return la;
  let prev = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i += 1) {
    const cur = [i];
    for (let j = 1; j <= lb; j += 1) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j], cur[j - 1], prev[j - 1]);
    }
    prev = cur;
  }
  return prev[lb];
};

// A job card is done-and-gone once it's actually left (Delivered) or taken off the
// books (Closed/Cancelled) — everything else means work is still in flight. Module
// scope: a plain constant, not per-render/per-component state.
const CLOSED_JC_STATUSES = ['Delivered', 'Closed', 'Cancelled'];

const emptyCustomer = () => ({
  id: `c_${Date.now()}_${Math.floor(Math.random() * 1e4)}`, code: '', name: '', phone: '', altPhone: '', extraPhones: [],
  email: '', address: '', area: '', city: '', district: '', state: '', pincode: '', country: 'India',
  gst: '', pan: '', companyName: '', type: 'Individual', status: 'Active',
  occupation: '', referenceBy: '', notes: '', totalSpent: 0, outstanding: 0,
  since: new Date().toISOString().slice(0, 10), createdAt: Date.now(), vehicles: [], history: [], documents: [], defaultVehicleId: '', noteEntries: [],
});
// Fixed, bounded document-type set (not free-form uploads) — matches what a workshop
// actually keeps on file for a customer. Each type holds at most ONE current copy
// (re-uploading replaces it, like "Set as cover" does for vehicle photos) so the tab
// stays a scannable checklist instead of an unbounded, unlabelled file dump.
const DOC_TYPES = ['RC Copy', 'Insurance Copy', 'PAN Card', 'GST Certificate', 'ID Proof', 'Other'];
const emptyVehicle = () => ({ id: `v_${Date.now()}_${Math.floor(Math.random() * 1e4)}`, regNo: '', model: '', variant: '', color: '', fuel: 'Petrol', transmission: 'Manual', year: '', kms: '', engineNo: '', vin: '', insuranceExpiry: '', rcExpiry: '', lastService: '', status: 'Active', photos: [], coverPhoto: 0 });

function Stat({ icon: Icon, label, value, sub, color }) {
  // Mobile QA fix: same gap as Billing's own Stat — no whitespace-nowrap/tabular-nums
  // on the value let a long currency figure (e.g. "₹3,60,019") wrap mid-digit at the
  // narrow 2-col phone width. Nowrap + shrink-a-step, matching Vehicles'/Billing's Stat.
  const text = String(value ?? '');
  const size = text.length > 9 ? 'text-sm' : text.length > 6 ? 'text-base' : 'text-lg';
  return (
    <div className="rounded-2xl p-3.5 flex items-center gap-3" style={cardStyle}>
      <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${color}1f`, color }}><Icon size={18} /></span>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-white/45 truncate">{label}</p>
        <p className={`${size} font-bold text-white leading-tight whitespace-nowrap tabular-nums`}>{value}</p>
        {sub && <p className="text-[10px] text-emerald-400">{sub}</p>}
      </div>
    </div>
  );
}
// Uses the shared Badge (components/common/Badge.jsx) — this module previously defined
// its own, which drifted to rounded-md/mixed-case while every other module used the
// unified pill. Removed the local copy so all badges match.
const Badge = SharedBadge;
function Avatar({ name, size = 9 }) {
  return <span className="rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: 'rgba(212,175,55,0.15)', color: '#d4af37', width: size * 4, height: size * 4 }}>{(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>;
}
function Field({ label, req, error, children, className = '' }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label className="block text-[10px] uppercase tracking-wide text-white/45 mb-1.5">{label}{req && <span className="text-red-400"> *</span>}</label>
      {children}
      {error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}
    </div>
  );
}

// Field wrapper — HOISTED to module scope. Declared inside CustomerWizard it was
// re-created on every render, so React remounted the wrapped <input> on each
// keystroke and the field lost focus after one character.
// `warn` (Batch 4A): a distinct amber, non-blocking style for advisory duplicate
// hints (similar name, shared email) — visually different from `error` (red), which
// stays reserved for things that actually block Save (format errors, phone/GST
// duplicates). Conflating the two made every duplicate hint read as "you cannot
// save this," even the ones (email, name) that are legitimately allowed to.
function F({ label, req, error, warn, children, className = '' }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label className="block text-[10px] uppercase tracking-wide text-white/45 mb-1.5">{label}{req && <span className="text-red-400"> *</span>}</label>
      {children}
      {error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}
      {!error && warn && <p className="text-[10px] mt-1" style={{ color: '#fbbf24' }}>{warn}</p>}
    </div>
  );
}

function CustomerWizard({ initial, existing, canManage, onSave, onClose, demoMode = false }) {
  const [f, setF] = useState(initial);
  const [step, setStep] = useState(0);
  // `patch` may be a plain object (unchanged, existing behaviour — most callers just
  // set a scalar field from its own input's onChange, never batched with anything
  // else) or a function `(s) => partialPatch` for callers that need the in-progress
  // state rather than the stale outer `f` closure — see the Batch 4D comment on
  // addVehicle/setVeh/delVeh/dupVehicle above for why that distinction matters.
  const set = (patch) => setF((s) => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) }));
  const [idMode, setIdMode] = useState(initial.code ? 'manual' : 'auto');
  const autoCode = nextCode(existing);
  // Batch 4A Defect 2/5 — "saving speed" / slow-internet business case: onSave
  // (saveCustomer, in the parent) is async and wasn't being awaited here at all, so
  // nothing stopped a second click — or a slow connection leaving the button looking
  // inert — from firing a second save. `saving` disables Save/Cancel/Close for the
  // duration of the actual write; `mountedRef` guards the post-await state update
  // since a SUCCESSFUL save unmounts this wizard (parent calls setEditCust(null))
  // before the await here even resolves.
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  // BUG-001 fix (live QA) — validate() already showed a toast.error() on a blocked
  // save, but the specific field(s) that were wrong stayed visually identical to
  // every valid field: no red border, no inline text, until AFTER a save was
  // actually attempted. Showing it from the first render would be worse (flagging
  // "required" on a field the user hasn't even reached yet), so this only turns on
  // once a save attempt has genuinely failed — see save() below.
  const [attemptedSave, setAttemptedSave] = useState(false);
  const nameInputRef = useRef(null);
  const phoneInputRef = useRef(null);
  const stepPaneRef = useRef(null);
  const confirmOpenRef = useRef(false);
  // Batch 4D Defect 4 / Issue 1 (Add Vehicle popup architecture review) — the
  // modal's own root. Provided via <ModalBoundaryContext.Provider> below so every
  // MiniSelect/VehicleMakeModelSelect dropdown inside this modal is automatically
  // height-clamped to THIS modal instead of the full browser viewport — no
  // per-field `boundaryRef` prop needed any more (that was this app's ORIGINAL fix
  // for this bug, before the same defect turned up unfixed in every OTHER modal;
  // see components/common/DropdownPanel.jsx). Without it, a field positioned
  // mid-modal (Fuel, Transmission, District, City…) could compute room reaching
  // past the modal's own bottom edge and render on top of its fixed Save/Next
  // footer.
  const modalRef = useRef(null);

  // H-7: draft autosave/restore + beforeunload protection — ported from the Add/Edit
  // Part pattern (InventoryDashboard.js:2369-2396) and Billing's debounced invoice
  // draft. New-customer only (an in-progress edit's fallback is the saved record
  // itself). Namespaced by environment so a Demo draft never appears in Production.
  const isNewCustomer = !initial.code;
  const DRAFT_KEY = `maruti_customer_draft_v1_${demoMode ? 'demo' : 'prod'}`;
  const initialFormRef = useRef(null);
  if (initialFormRef.current === null) initialFormRef.current = JSON.stringify(f);
  const [draftMeta, setDraftMeta] = useState(null);
  const dirty = useMemo(() => JSON.stringify(f) !== initialFormRef.current, [f]);
  const savingRef = useRef(false);
  const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch {} setDraftMeta(null); };
  const restoreDraft = () => { if (draftMeta?.form) setF(draftMeta.form); setDraftMeta(null); };
  useEffect(() => {
    if (!isNewCustomer) return;
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (d?.form && String(d.form.name || '').trim()) setDraftMeta({ ts: d.ts, form: d.form });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!isNewCustomer) return undefined;
    if (!String(f.name || '').trim()) return undefined;
    const id = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ts: Date.now(), form: f })); } catch {}
    }, 600); // debounced, same window BillingModule already uses for invoice drafts
    return () => clearTimeout(id);
  }, [f, isNewCustomer]);
  useEffect(() => {
    if (!dirty) return undefined;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
  // Clears the draft ONLY when this wizard unmounts as a result of a save that the
  // parent confirmed succeeded (saveCustomer only unmounts us via onClose/setEditCust(null)
  // after its own await resolves — see C-1). Cancel/Escape/backdrop-close never sets
  // savingRef, so the draft survives an abandoned edit for next time, same as Add Part.
  useEffect(() => () => { if (savingRef.current) clearDraft(); }, []);

  const phoneErr = f.phone && !isIndianMobile(f.phone) ? MOBILE_ERROR : null;
  const altPhoneErr = f.altPhone && !isIndianMobile(f.altPhone) ? MOBILE_ERROR : null;
  // BUG-001 fix — field-level errors for the two save-blocking required fields
  // (matches validate()'s own two earliest checks), shown only after a failed save
  // attempt (attemptedSave) so a still-empty field mid-fill isn't flagged as wrong
  // before the user has even reached it.
  const nameRequiredErr = attemptedSave && !f.name.trim() ? 'Customer name is required'
    : attemptedSave && f.name.trim().length < 3 ? 'Customer name must be at least 3 characters' : null;
  const phoneRequiredErr = attemptedSave && !f.phone ? 'Primary mobile is required' : null;
  const emailErr = f.email && !isValidEmail(f.email) ? EMAIL_ERROR : null;
  const gstErr = f.gst && !isValidGstin(f.gst) ? GSTIN_ERROR : null;
  const pinErr = f.pincode && !/^\d{6}$/.test(f.pincode) ? 'PIN must be 6 digits' : null;
  // Phone and GST are genuinely unique identifiers in this business (one mobile per
  // person; GST is a legal registration number) — duplicates there block Save. Email
  // is deliberately NOT in that category: a family or a small company commonly shares
  // one inbox across several customer records, so a matching email is only ever an
  // advisory (`warn`), never a hard stop.
  const dupPhone = f.phone && existing.some((c) => c.id !== f.id && c.phone && phoneKey(c.phone) === phoneKey(f.phone));
  const dupEmail = f.email && existing.some((c) => c.id !== f.id && (c.email || '').toLowerCase() === f.email.toLowerCase());
  const dupGst = f.gst && existing.some((c) => c.id !== f.id && (c.gst || '').toUpperCase() === f.gst.toUpperCase());
  // Exact match (different phone) is the strong signal — very likely the same person
  // re-entered. A fuzzy near-miss (edit distance <= 2, only for names long enough that
  // 2 edits is meaningful) is a softer "go check" hint, not a declared duplicate —
  // spelling collisions across a large customer base are common and often ARE
  // different people (India has a LOT of Kumars).
  const nameNorm = f.name.trim().toLowerCase().replace(/\s+/g, ' ');
  const exactNameMatch = !!nameNorm && existing.some((c) => c.id !== f.id && c.name.trim().toLowerCase().replace(/\s+/g, ' ') === nameNorm && phoneKey(c.phone) !== phoneKey(f.phone));
  const similarNameMatch = !exactNameMatch && nameNorm.length >= 5 && existing.some((c) => {
    if (c.id === f.id || phoneKey(c.phone) === phoneKey(f.phone)) return false;
    const other = c.name.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!other || Math.abs(other.length - nameNorm.length) > 2) return false;
    return levenshtein(nameNorm, other) <= 2;
  });
  const nameWarn = exactNameMatch ? 'Same name exists with a different phone' : similarNameMatch ? 'A similar name already exists — check this isn’t a duplicate' : null;

  // Defect 3 — Address cascade (Country -> State -> District -> City -> Area). No
  // exhaustive district/city/area master dataset exists for any one country (India
  // alone has 700+ districts and thousands of towns) — hand-rolling a partial one would
  // itself be "incomplete demo data" and worse than nothing for entries it doesn't
  // cover. Instead each level's suggestions are DERIVED from what other customers
  // already recorded under the same parent: real, always-accurate data that starts
  // working immediately from existing customers and organically improves as more are
  // added, with zero hardcoding and no dependency on any one country's administrative
  // structure. State stays the one exhaustive, official picker (a finite, complete
  // list actually exists for it); District/City/Area stay MiniSelects with onAdd, so a
  // genuinely new value can always be typed even with no suggestions yet.
  // Batch 4A Defect 3 — "same vehicle" duplicate detection. No check existed for a
  // registration already on file under a DIFFERENT customer. This deliberately stays a
  // WARNING, not a block: a vehicle changing hands (resale, inheritance, company
  // reassignment) is a completely normal, common event, and the new owner has every
  // right to be entered as a new customer with that same registration. Blocking would
  // make a legitimate, everyday workflow impossible; a warning lets the advisor notice
  // and double-check without being stopped by it.
  const vehicleOwnerByReg = useMemo(() => {
    const m = new Map();
    existing.forEach((c) => {
      if (c.id === f.id) return;
      (c.vehicles || []).forEach((v) => {
        const norm = (v.regNo || '').toUpperCase().replace(/\s+/g, '');
        if (norm) m.set(norm, c.name);
      });
    });
    return m;
  }, [existing, f.id]);
  // Batch 4B — same "warn, don't block" reasoning as the registration check: a VIN is
  // manufacturer-unique, so a cross-customer match is worth flagging, but ownership
  // transfer is a normal event a hard block would wrongly prevent.
  const vinOwnerByVin = useMemo(() => {
    const m = new Map();
    existing.forEach((c) => {
      if (c.id === f.id) return;
      (c.vehicles || []).forEach((v) => {
        const norm = (v.vin || '').toUpperCase().replace(/\s+/g, '');
        if (norm) m.set(norm, c.name);
      });
    });
    return m;
  }, [existing, f.id]);
  // Defect #53 (rejection round) — District used to be derived from existing customer
  // records the same way City/Area are, which meant a brand-new install (or any state
  // no customer had used yet) showed "No options." for District — reported as "select
  // Andhra Pradesh, District dropdown is empty," reproducible on ANY state with zero
  // prior customers, not just those two. District is now sourced from
  // lib/indianDistricts.js, a real static master dataset (India's ~780 districts,
  // sourced per-state from public records) — independent of customers, populated
  // immediately, identically on a fresh install. City/Area deliberately stay
  // derived-from-records below: unlike District, there is no reasonably-sized,
  // reliably maintainable master list of every Indian city/town/locality to ship, and
  // hand-authoring one would risk presenting invented data as fact. Both keep the
  // composite-key fix (state|district / state|district|city) so two states that happen
  // to share a district name (e.g. "Bilaspur" — Chhattisgarh and Himachal Pradesh both
  // have one) can never have their cities/areas cross-contaminate.
  const districtOptionsAll = INDIAN_DISTRICTS[f.state] || [];
  const citiesByDistrict = useMemo(() => {
    const m = new Map();
    existing.forEach((c) => { if (c.state && c.district && c.city) { const k = `${c.state}|${c.district}`; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(c.city); } });
    return m;
  }, [existing]);
  const areasByCity = useMemo(() => {
    const m = new Map();
    existing.forEach((c) => { if (c.state && c.district && c.city && c.area) { const k = `${c.state}|${c.district}|${c.city}`; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(c.area); } });
    return m;
  }, [existing]);
  const districtOptions = f.state ? districtOptionsAll : [];
  // Defect #56 (reopened) — try real static city data first (CITY_MASTER_DATA,
  // lib/indianDistricts.js — covers this defect's own named test states with real,
  // sourced major cities per district); fall back to the derived-from-records list
  // for every state|district CITY_MASTER_DATA doesn't cover. Neither source blocks
  // the other — onAdd on the field itself still lets a genuinely new city through
  // regardless of which list (or neither) populated it.
  const cityOptionsStatic = f.state && f.district ? (CITY_MASTER_DATA[f.state]?.[f.district] || []) : [];
  const cityOptionsDerived = f.district ? Array.from(citiesByDistrict.get(`${f.state}|${f.district}`) || []).sort() : [];
  const cityOptions = cityOptionsStatic.length ? cityOptionsStatic : cityOptionsDerived;
  const areaOptions = f.city ? Array.from(areasByCity.get(`${f.state}|${f.district}|${f.city}`) || []).sort() : [];

  // Defect 5 — step order: Vehicles moved ahead of Address/Business. A walk-in customer
  // is standing at the counter because of their vehicle; address/GST are administrative
  // detail an advisor rarely captures (or the customer even has to hand) in that first
  // minute, and are commonly filled in later or skipped entirely.
  const STEPS = [
    { key: 'basic', label: 'Basic Info', icon: Users },
    { key: 'vehicles', label: `Vehicles${f.vehicles.length ? ` (${f.vehicles.length})` : ''}`, icon: Car },
    { key: 'address', label: 'Address', icon: MapPin },
    { key: 'business', label: 'Business Info', icon: Receipt },
    { key: 'notes', label: 'Notes & More', icon: Edit3 },
  ];

  // Defect 4/4B — which vehicle card renders its full edit form vs. a compact summary.
  // Strict single-open accordion (Batch 4B): opening one card always closes any other,
  // so the UI never shows more than one full form at once no matter how many vehicles
  // a fleet customer has — a multi-open Set let several full forms pile up at once,
  // which was the exact clutter this step exists to avoid. A lone existing vehicle
  // starts open (nothing to overwhelm yet); 2+ start fully collapsed.
  const [openVeh, setOpenVeh] = useState(() => ((initial.vehicles || []).length === 1 ? initial.vehicles[0].id : null));
  const [vehQuery, setVehQuery] = useState('');
  // Defect #52 — hoisted out of JSX so both empty states below (and any future
  // consumer, e.g. a results count) can tell "zero vehicles at all" apart from
  // "zero vehicles match this filter" instead of only the .map() output existing.
  const vehQueryTrim = vehQuery.trim().toLowerCase();
  const filteredVehicles = vehQueryTrim
    ? f.vehicles.filter((v) => [v.regNo, v.make, v.model].some((x) => (x || '').toLowerCase().includes(vehQueryTrim)))
    : f.vehicles;
  const toggleVeh = (id) => setOpenVeh((prev) => (prev === id ? null : id));
  // Batch 4D — these four vehicle-array mutators used to build their patch from the
  // `f` closure (e.g. `[...f.vehicles, nv]`) even though `set` itself applies patches
  // functionally. That's fine for one call, but two calls fired in the same React
  // batch (a fast double-tap on "Add Vehicle", or Add immediately followed by
  // Duplicate before the first repaint) both read the SAME stale `f.vehicles`, so the
  // second patch silently overwrote the first instead of building on it — one vehicle
  // vanished with no error. Passing a function to `set` (added below) reads the
  // in-progress state `s` instead of the stale closure, so batched calls compose
  // correctly no matter how many fire before the next render.
  const addVehicle = () => { const nv = emptyVehicle(); set((s) => ({ vehicles: [...s.vehicles, nv] })); setOpenVeh(nv.id); };
  const setVeh = (id, patch) => set((s) => ({ vehicles: s.vehicles.map((v) => (v.id === id ? { ...v, ...patch } : v)) }));
  // Batch 4B — a card with real data entered (registration or make/model) is a genuine
  // loss if mis-clicked next to the chevron; a still-blank row someone added and
  // changed their mind about isn't. Only the former gets a confirm step, so "oops,
  // didn't mean to add a vehicle" stays a single click while actually-entered data is
  // protected — matching confirmDialog's use everywhere else destructive in this app.
  const delVeh = async (id) => {
    const v = f.vehicles.find((x) => x.id === id);
    if (v && (v.regNo || v.model)) {
      // confirmDialog owns its OWN window-level Escape listener (ConfirmHost), entirely
      // independent of this wizard's — both fire on the same keypress, so dismissing
      // the confirm with Escape was ALSO closing (and discarding) the whole Add/Edit
      // Customer form underneath it. confirmOpenRef makes this wizard's own Escape
      // handler stand down for the duration, so Escape only ever cancels the ONE thing
      // actually on top.
      confirmOpenRef.current = true;
      const ok = await confirmDialog({ title: `Remove ${v.regNo || 'this vehicle'}?`, message: 'This vehicle and its details will be removed from the customer.', danger: true, confirmText: 'Remove' });
      confirmOpenRef.current = false;
      if (!ok) return;
    }
    set((s) => ({ vehicles: s.vehicles.filter((x) => x.id !== id), defaultVehicleId: s.defaultVehicleId === id ? '' : s.defaultVehicleId }));
    if (openVeh === id) setOpenVeh(null);
  };
  // Batch 4B — clones the shared, non-unique fields into a fresh row for a fleet
  // customer adding several similar vehicles; registration/VIN/engine no. and photos
  // are per-vehicle identifiers and are never copied.
  const dupVehicle = (id) => {
    const v = f.vehicles.find((x) => x.id === id);
    if (!v) return;
    const nv = { ...emptyVehicle(), make: v.make, model: v.model, variant: v.variant, color: v.color, fuel: v.fuel, transmission: v.transmission };
    set((s) => ({ vehicles: [...s.vehicles, nv] }));
    setOpenVeh(nv.id);
  };

  // Batch 4B — a row with neither a registration nor a model is what "click Add
  // Vehicle, change your mind" leaves behind; save() drops these silently instead of
  // making the advisor delete it by hand. Any OTHER field alone (e.g. just a colour)
  // isn't enough to count as "real" — those are follow-on details, not identity.
  const vehIsBlank = (v) => !v.regNo && !v.model;
  const validate = () => {
    if (f.name.trim().length < 3) { setStep(0); return 'Customer name must be at least 3 characters'; }
    if (!f.phone || phoneErr) { setStep(0); return MOBILE_ERROR; }
    if (dupPhone) { setStep(0); return 'A customer with this mobile number already exists'; }
    if (altPhoneErr) { setStep(0); return `Alternate mobile: ${MOBILE_ERROR.toLowerCase()}`; }
    if (emailErr) { setStep(0); return emailErr; }
    // dupEmail is intentionally NOT a save-blocking condition — see the F warn note on
    // the Email field below. Format (emailErr) still is; a malformed email is a data
    // error regardless of who else has one.
    if (pinErr) { setStep(2); return pinErr; }
    if (gstErr) { setStep(3); return gstErr; }
    if (dupGst) { setStep(3); return 'A customer with this GST already exists'; }
    if (idMode === 'manual') { if (!f.code.trim()) { setStep(0); return 'Enter a customer ID or use Auto Generate'; } if (existing.some((c) => c.id !== f.id && c.code === f.code.trim())) { setStep(0); return 'This customer ID already exists'; } }
    // A row with SOME data entered (a model picked) but no registration is a real gap,
    // not an abandoned row — vehIsBlank would silently drop it, which would quietly
    // throw away whatever the advisor already typed.
    const missingReg = (f.vehicles || []).find((v) => !vehIsBlank(v) && !v.regNo);
    if (missingReg) { setStep(1); return `"${missingReg.model}" is missing a registration number`; }
    // Duplicate vehicle registration / VIN within this customer's own vehicle list.
    const regs = (f.vehicles || []).map((v) => (v.regNo || '').toUpperCase().replace(/\s+/g, '')).filter(Boolean);
    const dupReg = regs.find((r, i) => regs.indexOf(r) !== i);
    if (dupReg) { setStep(1); return `Vehicle registration "${dupReg}" is entered more than once for this customer`; }
    const vins = (f.vehicles || []).map((v) => (v.vin || '').toUpperCase().replace(/\s+/g, '')).filter(Boolean);
    const dupVin = vins.find((r, i) => vins.indexOf(r) !== i);
    if (dupVin) { setStep(1); return `VIN "${dupVin}" is entered more than once for this customer`; }
    // A manufacturing year outside a plausible range is unambiguously wrong (not a
    // judgment call the way a short registration number can be) — +1 allows a
    // next-year model sold slightly early, a genuine, common dealership practice.
    const thisYear = new Date().getFullYear();
    const badYear = (f.vehicles || []).find((v) => v.year && (Number(v.year) < 1980 || Number(v.year) > thisYear + 1));
    if (badYear) { setStep(1); return `Vehicle year "${badYear.year}" looks incorrect — enter a year between 1980 and ${thisYear + 1}`; }
    return null;
  };
  // BUG-LIVE-003: "Next" used to be a bare setStep(s + 1) with no validation, so an
  // empty Basic Info silently advanced to Vehicles. Gate the Basic-Info step: it holds
  // the only hard-required fields (name, mobile) plus the manual-ID checks — the same
  // conditions validate() checks first on Save. Later steps stay freely navigable
  // (Save still runs the full validate()); this only stops the required step being
  // skipped past.
  const validateBasic = () => {
    if (f.name.trim().length < 3) return 'Customer name must be at least 3 characters';
    if (!f.phone || phoneErr) return MOBILE_ERROR;
    if (dupPhone) return 'A customer with this mobile number already exists';
    if (altPhoneErr) return `Alternate mobile: ${MOBILE_ERROR.toLowerCase()}`;
    if (emailErr) return emailErr;
    if (idMode === 'manual') {
      if (!f.code.trim()) return 'Enter a customer ID or use Auto Generate';
      if (existing.some((c) => c.id !== f.id && c.code === f.code.trim())) return 'This customer ID already exists';
    }
    return null;
  };
  const goNext = () => {
    if (step === 0) {
      const err = validateBasic();
      if (err) {
        setAttemptedSave(true); // reveal the field-level red errors on Basic Info
        if (f.name.trim().length < 3) nameInputRef.current?.focus();
        else if (!f.phone || phoneErr || dupPhone) phoneInputRef.current?.focus();
        toast.error(err);
        return;
      }
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const save = async () => {
    if (saving) return; // already in flight — a second Enter/Ctrl+S/click is a no-op, not a second write
    const err = validate();
    if (err) {
      setAttemptedSave(true);
      // Focus the first invalid required field, matching wherever validate() itself
      // already navigated the wizard to (setStep(0) for name/phone) — so the user
      // lands directly in the field that needs fixing, not just the right step.
      if (!f.name.trim() && nameInputRef.current) nameInputRef.current.focus();
      else if ((!f.phone || phoneErr) && phoneInputRef.current) phoneInputRef.current.focus();
      return toast.error(err);
    }
    const composedAddr = f.address.trim() || [f.area, f.city, f.district, f.state, f.pincode].filter(Boolean).join(', ');
    const cleanVehicles = f.vehicles.filter((v) => !vehIsBlank(v));
    savingRef.current = true; // H-7: only a real save attempt clears the draft on unmount
    setSaving(true);
    try {
      await onSave({
        ...f,
        name: cleanText(f.name),
        companyName: cleanText(f.companyName),
        occupation: cleanText(f.occupation),
        referenceBy: cleanText(f.referenceBy),
        // area/city/district already arrive pre-trimmed (MiniSelect's onAdd trims
        // before it ever reaches state); state only needs it here for the non-India
        // free-text fallback input, which has no such guard of its own.
        state: cleanText(f.state),
        gst: f.gst.toUpperCase(),
        address: composedAddr,
        vehicles: cleanVehicles,
        defaultVehicleId: cleanVehicles.some((v) => v.id === f.defaultVehicleId) ? f.defaultVehicleId : '',
        code: idMode === 'manual' ? f.code.trim() : (f.code || ''),
      });
    } finally {
      // On success the parent has already unmounted us (setEditCust(null)) before this
      // resolves; on failure (caught internally by saveCustomer, which never rethrows)
      // we're still here and need the button re-enabled so the advisor can retry.
      if (mountedRef.current) setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { if (!saving && !confirmOpenRef.current) onClose(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Batch 4A Defect 2 — auto-focus the first real text field on EVERY step change, not
  // just step 0. An advisor doing 50 of these a day shouldn't have to click into the
  // first field of each of the 5 steps by hand. Deliberately targets input/textarea
  // only (not MiniSelect's trigger <button>, not the delete/collapse icon buttons) —
  // the first pickable dropdown is a click-to-open interaction anyway and doesn't
  // benefit from focus-and-type the way a text field does.
  useEffect(() => {
    const id = setTimeout(() => {
      // Excludes radio/checkbox: Basic Info's Customer-ID radios sit BEFORE the Name
      // field in DOM order, so an unqualified `input` query focused "Auto Generate"
      // instead of the actual first thing worth typing into.
      const el = stepPaneRef.current?.querySelector('input:not([type=radio]):not([type=checkbox]), textarea');
      el?.focus();
    }, 0);
    return () => clearTimeout(id);
  }, [step]);

  const phone91 = (val, onCh, ph, opts = {}) => (
    <div className="flex gap-2"><span className="flex items-center px-3 rounded-xl text-sm text-white/60 bg-white/5 border border-white/10 flex-shrink-0">+91</span>
      <input ref={opts.inputRef} value={val} inputMode="numeric" onChange={(e) => onCh(mobileInput(e.target.value))} placeholder={ph} className={`${inputCls} ${opts.hasError ? 'border-red-500/70' : ''}`} /></div>
  );

  // Defect #49 (reopened again) — the #49 fix below (h-[100dvh]/max-h-[calc(100dvh-2rem)])
  // correctly solved the PREVIOUS mechanism (overlay scroll pushing the header above the
  // viewport) but there was a SEPARATE bug hiding behind it, invisible on desktop and
  // only visible once this modal grows tall enough to physically reach the top/bottom of
  // the screen: this component used to render as a plain DOM descendant, nested inside
  // <main> (InventoryDashboard.js — `relative z-10`, a real stacking context). A z-index
  // only outranks elements OUTSIDE its own stacking context if the CONTEXT ITSELF
  // outranks theirs — this modal's z-[120] was being compared at the WRONG level: <main>'s
  // z-10 vs the app header/mobile bottom-nav's z-90, not 120 vs 90. <main> (z-10) loses,
  // so everything inside it — this modal included, regardless of its own z-index —
  // rendered UNDERNEATH the app's own chrome. Confirmed live via document.elementFromPoint
  // (paint-level ground truth, not just a rect check) at the exact screen coordinates the
  // "Add New Customer" title occupies: the app's demo-mode banner/header was what was
  // actually painted there, not the modal — the title wasn't destroyed or mispositioned,
  // it was rendering exactly where expected but with the app's own header drawn on top of
  // it. That overlap only exists once the modal is tall enough for its top edge to reach
  // into the header's own screen region — short modals (1-3 vehicles) never overlap it,
  // which is exactly the "works at 1-3, breaks at 4+" threshold reported. Same root cause,
  // same fix already proven twice in this codebase (DropdownPanel, and LedgerPage in
  // InventoryDashboard.js — see that file's own near-identical comment): portal straight
  // to document.body, which escapes <main>'s stacking context entirely instead of trying
  // to out-number it from inside.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} onClick={() => { if (!saving) onClose(); }}>
      {/* #49 (root-cause): the modal shell must be a fixed-height flex box that NEVER
          exceeds the viewport, so its own header/footer (flex-shrink-0) stay pinned and
          only its body scrolls. The previous attempt made the OVERLAY scroll
          (overflow-y-auto) with the modal centred by my-auto — but a scrollable flex
          container centring a child as tall as itself pushes that child's TOP above the
          scroll origin, so the header sat above the viewport and the overlay's own scroll
          revealed it only if you scrolled up. Fix: the overlay does NOT scroll (no
          overflow-y-auto, no my-auto); it just centres a modal that is height-capped to
          the viewport minus its own padding. With the shell never taller than the screen,
          the header/footer can't leave it and the body (flex-1 min-h-0 overflow-y-auto)
          is the only thing that scrolls — at 1, 3, 10, 25 or 50 vehicles alike. */}
      <div ref={modalRef} data-modal-panel="" className="w-full sm:max-w-3xl h-[100dvh] sm:h-auto max-h-[100dvh] sm:max-h-[calc(100dvh-2rem)] flex flex-col rounded-t-2xl sm:rounded-2xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
      <ModalBoundaryContext.Provider value={modalRef}>
        <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
          <h3 className="text-base font-bold text-white">{initial.code ? `Edit ${f.code}` : 'Add New Customer'}</h3>
          <button onClick={onClose} disabled={saving} aria-label="Close" className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"><X size={17} /></button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col sm:flex-row">
          <div className="sm:w-44 flex-shrink-0 flex sm:flex-col gap-1 p-3 overflow-x-auto sm:overflow-visible" style={{ borderRight: '1px solid rgba(var(--fg-rgb),0.06)' }}>
            {STEPS.map((s, i) => (
              <button key={s.key} type="button" onClick={() => setStep(i)} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition ${step === i ? 'text-[#d4af37]' : 'text-white/55 hover:text-white/90 hover:bg-white/5'}`} style={step === i ? { background: 'rgba(212,175,55,0.1)' } : undefined}>
                <s.icon size={14} /> {s.label}
              </button>
            ))}
          </div>

          {/* min-h-0 here is load-bearing, not decorative: this pane is a flex ITEM (in
              the row above), and flex items default to min-height:auto — "at least as
              tall as my content" — regardless of the parent's own min-h-0. With several
              vehicle cards stacked up, that let this pane grow to fit ALL of them instead
              of being capped to the modal's available height; the excess then got clipped
              by the outer modal's `max-h-[94vh] overflow-hidden` rather than scrolling
              cleanly inside this pane — which is what read as vehicle cards scrolling
              "underneath" the header and losing content instead of a normal contained
              scroll. min-h-0 lets this pane actually shrink to its allotted space, so
              overflow-y-auto has a real height to scroll within, below the fixed header
              and above the fixed footer, on every breakpoint. */}
          <div ref={stepPaneRef} className="flex-1 min-w-0 min-h-0 overflow-y-auto dark-scroll p-5">
            {draftMeta && isNewCustomer && (
              <div className="rounded-xl p-3 mb-3 flex items-center gap-3 flex-wrap" style={{ background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.3)' }}>
                <span className="text-xs text-white/75 flex-1 min-w-[140px]">Unsaved draft{draftMeta.ts ? ` from ${new Date(draftMeta.ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ''} found.</span>
                <button type="button" onClick={restoreDraft} className="h-8 px-3 rounded-lg text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] active:scale-95">Restore</button>
                <button type="button" onClick={clearDraft} className="h-8 px-3 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-white/70 active:scale-95">Discard</button>
              </div>
            )}
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
                  <F label="Customer Name" req error={nameRequiredErr} warn={!nameRequiredErr ? nameWarn : null}><input ref={nameInputRef} value={f.name} onChange={(e) => set({ name: sanitizeSingleLine(e.target.value).slice(0, 100) })} placeholder="Enter customer name" className={`${inputCls} ${nameRequiredErr ? 'border-red-500/70' : ''}`} /></F>
                  <F label="Customer Type" req>
                    {/* Native <select> with 17 options rendered its native OS list (a
                        full-screen picker on mobile) — MiniSelect gives a compact,
                        capped-height (420px, DropdownPanel.MAX_PANEL_H), scrollable,
                        searchable panel instead, consistent with every other picker in
                        the app. Same 17 types, no removals. */}
                    <MiniSelect value={f.type} placeholder="Select customer type" options={TYPES} onPick={(t) => set({ type: t })} />
                  </F>
                  <F label="Primary Mobile" req error={phoneRequiredErr || phoneErr || (dupPhone ? 'Already exists' : null)}>{phone91(f.phone, (v) => set({ phone: v }), 'Enter 10 digit number', { inputRef: phoneInputRef, hasError: !!(phoneRequiredErr || phoneErr || dupPhone) })}</F>
                  <F label="Alternate Mobile" error={altPhoneErr}>{phone91(f.altPhone, (v) => set({ altPhone: v }), 'Enter 10 digit number', { hasError: !!altPhoneErr })}</F>
                  <F label="Email" error={emailErr} warn={!emailErr && dupEmail ? 'Already used by another customer — allowed (e.g. shared family/company inbox), just double-check' : null}><input value={f.email} onChange={(e) => set({ email: sanitizeSingleLine(e.target.value).trim() })} placeholder="Enter email address" className={inputCls} /></F>
                  <F label="Occupation"><input value={f.occupation} onChange={(e) => set({ occupation: sanitizeSingleLine(e.target.value) })} placeholder="Enter occupation" className={inputCls} /></F>
                  <F label="Reference By"><input value={f.referenceBy} onChange={(e) => set({ referenceBy: sanitizeSingleLine(e.target.value) })} placeholder="Select or enter reference" className={inputCls} /></F>
                  {/* Universal dropdown architecture review — same fix as Customer Type
                      just above (see that field's own comment): a native <select> here is
                      a browser-owned popup this app can't theme/contain/position. */}
                  <F label="Status"><MiniSelect value={f.status} placeholder="Select status" options={['Active', 'Inactive']} emptyValue="Active" onPick={(v) => set({ status: v || 'Active' })} /></F>
                </div>
              </div>
            )}
            {step === 1 && (
              <div className="space-y-3">
                {/* Vehicle Tab Scroll Architecture — the title/Add-Vehicle row and the
                    filter box used to be plain in-flow content at the top of this SAME
                    scrolling pane (stepPaneRef) as the vehicle cards below, so scrolling
                    through a long vehicle list scrolled them away too — reading as "the
                    top section moving upward" even though the pane itself was already
                    correctly height-capped (see min-h-0 note above) and never grew past
                    the modal. `position: sticky` with `top-0` pins this block to the
                    TOP OF THIS SCROLLING PANE specifically (not the viewport, not the
                    modal) — it has no effect on any other step's content, and needs no
                    change to the pane's own height/overflow chain. The -mx-5 px-5 bleeds
                    it into the pane's own side padding so its solid background fully
                    covers cards scrolling underneath, instead of leaving the pane's
                    padding strip transparent at the edges. */}
                <div className="sticky top-0 z-10 -mx-5 px-5 pb-2 space-y-2" style={{ background: 'var(--surface-1)', borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-white/80">Vehicles ({f.vehicles.length})</p>
                    <button type="button" onClick={addVehicle} className="h-8 px-3 rounded-lg text-[11px] font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] flex items-center gap-1"><Plus size={12} /> Add Vehicle</button>
                  </div>
                  {/* Batch 4B Defect 6 — a plain filter, not a search feature: shows up only
                      once there's actually something to scan (4+), filters the existing
                      list client-side by reg/make/model. Deliberately NOT tags, sorting or
                      fleet-grouping — those need their own design; this keeps today's
                      architecture (a plain vehicles array) free to grow into that later
                      without today's implementation getting ahead of an actual need. */}
                  {f.vehicles.length >= 4 && (
                    <input value={vehQuery} onChange={(e) => setVehQuery(e.target.value)} placeholder="Filter by registration, make or model…" className={`${inputCls} py-2 text-xs`} />
                  )}
                </div>
                {/* Defect #52 — the filter used to be inlined straight into .map(), so a
                    query matching nothing rendered zero cards with NO feedback: the list
                    just vanished between the filter input and whatever came after it,
                    indistinguishable from "this customer has no vehicles at all" (which
                    has its own, different empty state below) or a rendering bug. Hoisting
                    it once lets both empty states tell the truth about which case is
                    which, and gives the zero-match case a one-tap way out instead of
                    forcing a manual backspace. */}
                {filteredVehicles.map((v) => {
                  const isOpen = openVeh === v.id;
                  const isDefault = f.vehicles.length > 1 && f.defaultVehicleId === v.id;
                  const regOwner = v.regNo ? vehicleOwnerByReg.get(v.regNo.toUpperCase().replace(/\s+/g, '')) : null;
                  const vinOwner = v.vin ? vinOwnerByVin.get(v.vin.toUpperCase().replace(/\s+/g, '')) : null;
                  return (
                  <div key={v.id} className="rounded-xl p-3" style={isDefault ? { background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.3)' } : { background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
                    {/* Defect 4/4B: compact summary; full form only when isOpen. */}
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => toggleVeh(v.id)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                        <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-white/45 overflow-hidden" style={{ background: 'rgba(var(--fg-rgb),0.05)' }}>{v.photos?.length > 0 ? <img src={v.photos[v.coverPhoto || 0]} alt="" className="w-full h-full object-cover" /> : <Car size={14} />}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1 text-[11px] font-bold text-white/70 truncate">{v.regNo || 'New vehicle'}{isDefault && <span className="px-1.5 py-0.5 rounded text-[8px] font-bold" style={{ background: 'rgba(212,175,55,0.2)', color: '#d4af37' }}>DEFAULT</span>}{(regOwner || vinOwner) && <AlertCircle size={10} style={{ color: '#fbbf24' }} />}</span>
                          <span className="block text-[10px] text-white/45 truncate">{v.model ? `${v.make || ''} ${v.model} ${v.variant || ''}`.trim() : 'Not filled in yet'}{v.fuel ? ` · ${v.fuel}` : ''}{v.year ? ` · ${v.year}` : ''}</span>
                        </span>
                      </button>
                      {f.vehicles.length > 1 && (
                        <button type="button" onClick={() => set({ defaultVehicleId: isDefault ? '' : v.id })} aria-label={isDefault ? 'Unset default vehicle' : 'Set as default vehicle'} className="flex-shrink-0 p-1"><Star size={13} fill={isDefault ? '#d4af37' : 'none'} className={isDefault ? '' : 'text-white/45'} style={isDefault ? { color: '#d4af37' } : undefined} /></button>
                      )}
                      <button type="button" onClick={() => delVeh(v.id)} aria-label="Remove vehicle" className="text-red-400/70 hover:text-red-400 flex-shrink-0 p-1"><Trash2 size={13} /></button>
                      <button type="button" onClick={() => toggleVeh(v.id)} aria-label={isOpen ? 'Collapse' : 'Expand'} className="flex-shrink-0 p-1"><ChevronDown size={15} className={`text-white/45 transition-transform ${isOpen ? 'rotate-180' : ''}`} /></button>
                    </div>
                    {isOpen && (
                    <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                    <div className="flex justify-end mb-2">
                      <button type="button" onClick={() => dupVehicle(v.id)} className="text-[10px] font-semibold text-white/45 hover:text-white/80 inline-flex items-center gap-1"><Copy size={11} /> Duplicate vehicle</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input value={v.regNo} onChange={(e) => setVeh(v.id, { regNo: e.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, '').slice(0, 13) })} placeholder="Registration *" className={`${inputCls} py-2 text-xs`} />
                      <VehicleMakeModelSelect
                        make={v.make || ''}
                        model={v.model || ''}
                        onPickMake={(m) => setVeh(v.id, { make: m, model: '', variant: '' })}
                        onPickModel={(m) => setVeh(v.id, { model: m, variant: '' })}
                        onAddMake={(name) => setVeh(v.id, { make: name, model: '', variant: '' })}
                        onAddModel={(name) => setVeh(v.id, { model: name, variant: '' })}
                        className="contents"
                        inputCls={`${inputCls} py-2 text-xs`}
                      />
                      <MiniSelect
                        value={v.variant || ''}
                        placeholder={v.model ? 'Variant' : 'Select model first'}
                        options={variantsFor(v.make)}
                        disabled={!v.model}
                        onPick={(x) => setVeh(v.id, { variant: x })}
                        onAdd={(name) => setVeh(v.id, { variant: name })}
                        inputCls={`${inputCls} py-2 text-xs`}
                      />
                      {/* E2E workflow QA fix: this VIN field only uppercased/truncated —
                          Job Card's own VIN field (JobCardModule.jsx) already strips I/O/Q
                          and symbols, since a real 17-char VIN never contains those letters
                          (reserved to avoid confusion with 1/0). Reproduced live: a vehicle
                          added here saved VIN "QAE2E3VIN0000001" (leading Q) with no error,
                          while the exact same value typed into a Job Card's VIN field is
                          rejected/stripped on input. Same field, same real-world constraint,
                          two different rules in one app. Matched to Job Card's filter. */}
                      {[['color', 'Colour', 16], ['year', 'Year', 4], ['engineNo', 'Engine No.', 25], ['vin', 'VIN', 17]].map(([k, ph, mx]) => (
                        <input key={k} value={v[k]} onChange={(e) => { const val = k === 'vin' ? e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '').slice(0, mx) : k === 'engineNo' ? e.target.value.toUpperCase().slice(0, mx) : e.target.value.slice(0, mx); setVeh(v.id, { [k]: val }); }} placeholder={ph} className={`${inputCls} py-2 text-xs`} />
                      ))}
                      {/* Odometer: digits only (via replace) — a leading "-" simply never
                          reaches state, so negative entry is structurally impossible
                          rather than merely validated against afterwards. */}
                      <input value={v.kms} inputMode="numeric" onChange={(e) => setVeh(v.id, { kms: e.target.value.replace(/\D/g, '').slice(0, 7) })} placeholder="Odometer (km)" className={`${inputCls} py-2 text-xs`} />
                      {/* Fuel/Transmission are always-set fields (emptyVehicle() defaults
                          them) — the `|| 'Petrol'`/`|| 'Manual'` fallback on onPick mirrors
                          the value binding's own fallback, so MiniSelect's clear (x)
                          button can't leave the record with a blank fuel/transmission. */}
                      <MiniSelect value={v.fuel || 'Petrol'} placeholder="Fuel" options={FUELS} onPick={(t) => setVeh(v.id, { fuel: t || 'Petrol' })} inputCls={`${inputCls} py-2 text-xs`} />
                      <MiniSelect value={v.transmission || 'Manual'} placeholder="Transmission" options={TRANSMISSIONS} onPick={(t) => setVeh(v.id, { transmission: t || 'Manual' })} inputCls={`${inputCls} py-2 text-xs`} />
                      <label className="text-[9px] text-white/45">Insurance Expiry<input type="date" value={v.insuranceExpiry} onChange={(e) => setVeh(v.id, { insuranceExpiry: e.target.value })} className={`${inputCls} py-2 text-xs mt-0.5`} style={{ colorScheme: 'dark' }} /></label>
                      <label className="text-[9px] text-white/45">RC Expiry<input type="date" value={v.rcExpiry} onChange={(e) => setVeh(v.id, { rcExpiry: e.target.value })} className={`${inputCls} py-2 text-xs mt-0.5`} style={{ colorScheme: 'dark' }} /></label>
                    </div>
                    {regOwner && <p className="text-[10px] mt-2 flex items-center gap-1" style={{ color: '#fbbf24' }}><AlertCircle size={11} className="flex-shrink-0" /> Registration already on file for {regOwner} — confirm this is an ownership transfer, not a duplicate entry.</p>}
                    {vinOwner && <p className="text-[10px] mt-2 flex items-center gap-1" style={{ color: '#fbbf24' }}><AlertCircle size={11} className="flex-shrink-0" /> VIN already on file for {vinOwner} — confirm this is an ownership transfer, not a duplicate entry.</p>}
                    {Number(v.kms) > 2000000 && <p className="text-[10px] mt-2 flex items-center gap-1" style={{ color: '#fbbf24' }}><AlertCircle size={11} className="flex-shrink-0" /> {Number(v.kms).toLocaleString('en-IN')} km looks unusually high — please double-check.</p>}
                    <div className="mt-3">
                      <p className="text-[10px] uppercase tracking-wide text-white/45 mb-1.5">Vehicle Photos <span className="normal-case text-white/45">— upload, take photo, or drag & drop</span></p>
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
                          <label className="w-16 h-16 rounded-lg flex flex-col items-center justify-center cursor-pointer text-white/45 hover:text-white/70 transition" style={{ border: '1px dashed rgba(var(--fg-rgb),0.45)' }}>
                            <Camera size={15} /><span className="text-[8px] mt-0.5">Add</span>
                            <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={async (e) => { const imgs = []; for (const file of Array.from(e.target.files).slice(0, 8)) { try { imgs.push(await compressImage(file)); } catch { toast.error('Could not read image'); } } if (imgs.length) setVeh(v.id, { photos: [...(v.photos || []), ...imgs].slice(0, 10) }); e.target.value = ''; }} />
                          </label>
                        )}
                      </div>
                    </div>
                    </div>
                    )}
                  </div>
                  );
                })}
                {f.vehicles.length === 0 && <p className="text-xs text-white/45 text-center py-6">No vehicles yet. Click Add Vehicle.</p>}
                {f.vehicles.length > 0 && filteredVehicles.length === 0 && (
                  <div className="text-center py-6">
                    <p className="text-xs text-white/45">No vehicles match &ldquo;{vehQuery.trim()}&rdquo;.</p>
                    <button type="button" onClick={() => setVehQuery('')} className="mt-2 text-[11px] font-semibold text-[#d4af37] hover:underline">Clear search</button>
                  </div>
                )}
              </div>
            )}
            {step === 2 && (
              <div className="space-y-3">
                <p className="text-sm font-bold text-white/80">Address</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <F label="Country">
                    <MiniSelect value={f.country || 'India'} placeholder="Select country" options={['India']} onPick={(c) => set({ country: c, state: '', district: '', city: '', area: '' })} onAdd={(name) => set({ country: name, state: '', district: '', city: '', area: '' })} />
                  </F>
                  <F label="State">
                    {(f.country || 'India') === 'India' ? (
                      <MiniSelect value={f.state} placeholder="Select state" options={INDIAN_STATES} onPick={(s) => set({ state: s, district: '', city: '', area: '' })} onAdd={(name) => set({ state: name, district: '', city: '', area: '' })} />
                    ) : (
                      // Future non-Indian customer: INDIAN_STATES doesn't apply to their
                      // country, so State becomes free text instead of a mismatched picker.
                      <input value={f.state} onChange={(e) => set({ state: e.target.value, district: '', city: '', area: '' })} placeholder="State / province" className={inputCls} />
                    )}
                  </F>
                  <F label="District">
                    <MiniSelect value={f.district} placeholder={f.state ? 'Select or type district' : 'Select state first'} disabled={!f.state} options={districtOptions} onPick={(d) => set({ district: d, city: '', area: '' })} onAdd={(name) => set({ district: name, city: '', area: '' })} />
                  </F>
                  <F label="City">
                    <MiniSelect value={f.city} placeholder={f.district ? 'Select or type city' : 'Select district first'} disabled={!f.district} options={cityOptions} onPick={(c) => set({ city: c, area: '' })} onAdd={(name) => set({ city: name, area: '' })} />
                  </F>
                  <F label="Area / Locality">
                    <MiniSelect value={f.area} placeholder={f.city ? 'Select or type area' : 'Select city first'} disabled={!f.city} options={areaOptions} onPick={(a) => set({ area: a })} onAdd={(name) => set({ area: name })} />
                  </F>
                  <F label="PIN Code" error={pinErr}><input value={f.pincode} inputMode="numeric" onChange={(e) => set({ pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })} className={inputCls} /></F>
                </div>
                <F label="Address Line"><textarea value={f.address} onChange={(e) => set({ address: e.target.value })} rows={2} className={`${inputCls} resize-none`} placeholder="Door no., street, landmark" /></F>
              </div>
            )}
            {step === 3 && (
              <div className="space-y-3">
                <p className="text-sm font-bold text-white/80">Business Details <span className="text-white/45 font-normal">(optional)</span></p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <F label="Company Name"><input value={f.companyName} onChange={(e) => set({ companyName: sanitizeSingleLine(e.target.value) })} className={inputCls} /></F>
                  <F label="GST Number" error={gstErr || (dupGst ? 'Already exists' : null)}><input value={f.gst} onChange={(e) => set({ gst: e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 15) })} placeholder="15-char GSTIN" className={inputCls} /></F>
                  <F label="PAN Number"><input value={f.pan} onChange={(e) => set({ pan: e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 10) })} className={inputCls} /></F>
                </div>
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
          <button onClick={onClose} disabled={saving} className="py-3 px-5 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80 disabled:opacity-40 disabled:cursor-not-allowed">Cancel</button>
          <div className="flex gap-2">
            {step > 0 && <button onClick={() => setStep((s) => s - 1)} disabled={saving} className="py-3 px-5 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80 disabled:opacity-40 disabled:cursor-not-allowed">Back</button>}
            {step < STEPS.length - 1 ? <button onClick={goNext} className="py-3 px-6 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">Next</button>
              : <button onClick={save} disabled={saving} aria-busy={saving} className="py-3 px-6 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] disabled:opacity-60 disabled:cursor-wait">{saving ? 'Saving…' : 'Save Customer'}</button>}
          </div>
        </div>
      </ModalBoundaryContext.Provider>
      </div>
    </div>,
    document.body
  );
}

function VehicleModal({ initial, onSave, onClose }) {
  const [f, setF] = useState(initial);
  const set = (patch) => setF((s) => ({ ...s, ...patch }));
  // Batch 4D Defect 4 / Issue 1 — same ModalBoundaryContext treatment as CustomerWizard's modal.
  const modalRef = useRef(null);
  const save = () => {
    if (!f.regNo.trim()) return toast.error('Registration number is required');
    if (!f.model.trim()) return toast.error('Make & model is required');
    onSave({ ...f, regNo: f.regNo.toUpperCase() });
  };
  // Defect #49 (consistency fix) — same unportaled-descendant-of-<main> stacking-context
  // trap as CustomerWizard above (see that component's comment for the full mechanism):
  // this modal also rendered inline inside <main> (z-10), so a tall enough instance
  // (e.g. many photos in a future upload feature) would paint underneath the app's own
  // header/bottom-nav despite its own z-[125]. Portaled to document.body for the same
  // reason, applied here for "keep consistency across the application."
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[125] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <div ref={modalRef} data-modal-panel="" className="w-full sm:max-w-md max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
      <ModalBoundaryContext.Provider value={modalRef}>
        <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
          <h3 className="text-base font-bold text-white">{initial.regNo ? 'Edit Vehicle' : 'Add Vehicle'}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10"><X size={17} /></button>
        </div>
        {/* Reordered into the same logical dependency chain as the Customer Wizard's
            vehicle step (was: Registration, Fuel, Make, Model, Variant — Fuel came before
            the vehicle was even identified). Manufacturer/Model/Variant now use the same
            production MiniSelect (portal dropdown) already fixed in Job Cards, instead of
            the older datalist-backed free-text inputs. Model is disabled until a
            Manufacturer is picked; Variant is disabled until a Model is picked; picking a
            new Manufacturer clears Model/Variant so a stale, incompatible combination can
            never be submitted. */}
        {/* min-h-0: same fix as the Customer Wizard's vehicle step — a flex item's
            default min-height:auto lets it grow to fit all its content instead of
            being capped to the modal's available height, so overflow-y-auto had
            nothing to actually scroll within. */}
        <div className="flex-1 min-h-0 overflow-y-auto dark-scroll p-5 grid grid-cols-2 gap-3">
          <Field label="Registration No." req><input value={f.regNo} onChange={(e) => set({ regNo: e.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, '').slice(0, 13) })} placeholder="TS09AB1234" className={inputCls} /></Field>
          <VehicleMakeModelSelect
            make={f.make || ''}
            model={f.model || ''}
            onPickMake={(m) => set({ make: m, model: '', variant: '' })}
            onPickModel={(m) => set({ model: m, variant: '' })}
            onAddMake={(name) => set({ make: name, model: '', variant: '' })}
            onAddModel={(name) => set({ model: name, variant: '' })}
            makePlaceholder="Select or add…" modelPlaceholder="Select or add…"
            makeLabel="Manufacturer" modelLabel="Model" modelReq
            className="contents"
            renderField={(label, req, children) => <Field label={label} req={req}>{children}</Field>}
          />
          <Field label="Variant">
            <MiniSelect
              value={f.variant || ''}
              placeholder={f.model ? 'e.g. VXi' : 'Select model first'}
              options={variantsFor(f.make)}
              disabled={!f.model}
              onPick={(x) => set({ variant: x })}
              onAdd={(name) => set({ variant: name })}
            />
          </Field>
          <Field label="Year"><input value={f.year} inputMode="numeric" onChange={(e) => set({ year: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="2021" className={inputCls} /></Field>
          <Field label="Fuel"><MiniSelect value={f.fuel || 'Petrol'} placeholder="Fuel" options={FUELS} onPick={(t) => set({ fuel: t || 'Petrol' })} /></Field>
          <Field label="Transmission"><MiniSelect value={f.transmission || 'Manual'} placeholder="Transmission" options={TRANSMISSIONS} onPick={(t) => set({ transmission: t || 'Manual' })} /></Field>
          <Field label="KMs Driven"><input value={f.kms} inputMode="numeric" onChange={(e) => set({ kms: e.target.value.replace(/\D/g, '').slice(0, 7) })} placeholder="45820" className={inputCls} /></Field>
          <Field label="Last Service" className="col-span-2"><input type="date" value={f.lastService} onChange={(e) => set({ lastService: e.target.value })} className={inputCls} style={{ colorScheme: 'dark' }} /></Field>
        </div>
        <div className="flex gap-3 px-5 py-3.5 flex-shrink-0" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.08)', paddingBottom: 'max(0.875rem, env(safe-area-inset-bottom))' }}>
          <button onClick={onClose} className="flex-1 py-3 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80">Cancel</button>
          <button onClick={save} className="flex-1 py-3 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">Save Vehicle</button>
        </div>
      </ModalBoundaryContext.Provider>
      </div>
    </div>,
    document.body
  );
}

// Module-scoped view state — a plain JS-module-level object, NOT sessionStorage-backed.
// Survives a tab-switch unmount (the module stays loaded, so this object keeps its values
// while the user is elsewhere) so search/filters/page/drawer/scroll are restored when they
// return — genuinely useful in-app navigation memory. It does NOT survive a real browser
// reload, because the JS module itself re-evaluates from scratch then, resetting this back
// to defaultView() — which is deliberate: a reload should show fresh data at a sane default
// view, not silently resurrect whichever customer/search/page/scroll position was left over
// from before. (Navigation State + Data Freshness review — this used to also mirror into
// sessionStorage specifically so a Browser Refresh restored it too; that was the actual bug
// the brief flagged, not a feature — removed, not just unused, so it can't quietly return.)
const defaultView = () => ({ q: '', typeF: 'All', statusF: 'All', page: 1, perPage: 10, selId: null, scrollY: 0, detailTab: 'Vehicles', drawerScrollY: 0 });
const customersViewState = defaultView();

export default function CustomersModule({ demoMode = false, demoCanDelete = false, demoCanExport = true, canManage = true, jobCards = [], invoices = [], customers, setCustomers, onSaveCustomerEdit, onCreateJobCard, onCreateInvoice, onOpenJobCard, onOpenInvoice, onAudit }) {
  const { t } = useTranslation();
  const V = customersViewState; // module-scoped cache; survives unmount on tab switch
  const [q, setQ] = useState(V.q);
  const [typeF, setTypeF] = useState(V.typeF);
  const [statusF, setStatusF] = useState(V.statusF);
  const [page, setPage] = useState(V.page);
  const [perPage, setPerPage] = useState(V.perPage);
  const [selId, setSelId] = useState(V.selId);
  const [editCust, setEditCust] = useState(null);
  // CONCURRENCY PHASE 1b — one active editor per customer. Keyed to whichever
  // customer's editor is open, else the one whose detail panel is selected (so a
  // viewer's Edit button disables live when someone else starts editing).
  const lease = useEditLease('customers', editCust && editCust.id ? editCust.id : selId);
  const openCustomerEditor = useCallback(async (c) => {
    if (!c || !c.id) { setEditCust(c); return; }          // new customer — no lease
    const r = await lease.acquire(c.id);
    if (!r.ok) { toast.error(`🔒 ${r.heldBy} is editing this customer. You can view it, but editing is unavailable right now.`, { duration: 6000 }); return; }
    setEditCust(c);
  }, [lease]);
  const closeCustomerEditor = useCallback(() => { lease.release(); setEditCust(null); }, [lease]);
  const [editVeh, setEditVeh] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [detailTab, setDetailTab] = useState(V.detailTab || 'Vehicles');
  // Row selection is transient UI state (not persisted to the view cache like q/page/etc.
  // above) — a Set of customer ids so it survives search/filter/pagination/sort by
  // identity rather than by row position.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  // Drop ids for customers that no longer exist (e.g. deleted) so the "N selected" count
  // and export never include stale, invisible selections.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const liveIds = new Set(customers.map((c) => c.id));
      const next = new Set([...prev].filter((id) => liveIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [customers]);
  // Write view state back to the in-memory cache so it restores when the module remounts
  // on tab-switch (not on reload — see the cache's own comment above).
  useEffect(() => { V.q = q; V.typeF = typeF; V.statusF = statusF; V.page = page; V.perPage = perPage; V.selId = selId; V.detailTab = detailTab; }, [q, typeF, statusF, page, perPage, selId, detailTab]);
  // Restore scroll position on mount; save it on unmount (Issue #4 scroll restoration).
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (V.scrollY) appScrollTo({ top: V.scrollY });
    return () => { V.scrollY = appScrollY() || 0; };
  }, []);
  // Deep-link: a customer opened in a new tab (e.g. from Vehicles) selects + opens here.
  // Same fix as Job Cards' identical pendingJobOpen mechanism: the token must only be
  // cleared once it's actually RESOLVED (found, or confirmed absent from a loaded list),
  // never on the initial read — otherwise a throwaway first mount (React Strict Mode
  // double-invokes effects in dev; ordinary render races can do the same in production)
  // consumes and deletes the one-shot token before `customers` has even loaded, leaving
  // the surviving mount with nothing to retry and no customer selected.
  const pendingCustOpen = useRef(null);
  const custOpenDone = useRef(false);
  if (pendingCustOpen.current === null) {
    try { pendingCustOpen.current = localStorage.getItem('maruti_customer_open') || ''; } catch { pendingCustOpen.current = ''; }
  }
  useEffect(() => {
    const key = pendingCustOpen.current;
    if (!key || custOpenDone.current) return;
    const match = customers.find((c) => String(c.code || '') === String(key) || String(c.id || '') === String(key));
    if (match) {
      custOpenDone.current = true;
      setSelId(match.id);
      setQ(key);
      try { localStorage.removeItem('maruti_customer_open'); } catch {}
    } else if (customers.length) {
      // data loaded but no match — at least filter, and stop retrying
      custOpenDone.current = true;
      setQ(key);
      try { localStorage.removeItem('maruti_customer_open'); } catch {}
    }
  }, [customers]);
  const didMountRef = useRef(false);
  const drawerScrollRef = useRef(null);
  // Details Panel top offset: the sticky toolbar (KPI cards + search + filters) sits
  // ABOVE the table+panel row, but INSIDE the table column only — it is a sibling
  // column of the panel, not an ancestor, so it occupies a completely different
  // horizontal (X) range on screen. Two scroll-listener-based "clear the toolbar"
  // mechanisms were tried and removed here in turn:
  //   1. An always-on constant offset (toolbar's full height baked into topOffset) —
  //      pushed the panel ~300px below the table's top even at rest (scroll 0), since
  //      CSS sticky's `top` is an unconditional floor.
  //   2. A scroll-listener toggling that offset between 0 and the toolbar's height once
  //      "stuck" — fixed the at-rest case, but the toolbar's own stick-threshold sits
  //      only ~24px of scroll below the page's rest position, so the offset jumped from
  //      0 to ~355px in a single scroll tick, reading as "the panel jumps/scrolls with
  //      the page" instead of a smooth, fixed-in-place transition.
  // Both were solving a problem that does not exist: verified with
  // `document.elementFromPoint()` (paint-level ground truth, not raw rect math) across
  // the FULL scroll range, at the panel's own on-screen coordinates, with zero extra
  // offset applied — the panel itself is what's actually painted there every time; the
  // toolbar (a different column, negative-margin bleed notwithstanding) never paints
  // into the panel's column. Customers' <DetailsPanel> now passes no topOffset at all,
  // using the shared default — byte-identical to Vehicles, which never needed this.
  // Restore the drawer's own scroll position once it's rendered for the selected customer.
  useEffect(() => {
    if (selId && drawerScrollRef.current && V.drawerScrollY) {
      drawerScrollRef.current.scrollTop = V.drawerScrollY;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId, detailTab]);
  useEffect(() => { if (didMountRef.current) setPage(1); else didMountRef.current = true; }, [q, typeF, statusF, perPage]);

  // ISSUE 2/3/7 — SEARCH. cardsOf()/invoicesOf() ran `.replace(/\D/g,'')` over EVERY job
  // card and EVERY invoice, for EVERY customer, on EVERY keystroke — and the search was
  // not debounced at all. Measured at real data size: 60 ms per character, i.e. ~4
  // dropped frames for each key press. Index once per data change instead.
  const custIdx = useMemo(() => ({
    jobsByPhone: indexBy(jobCards, (j) => phoneKey(j.phone)),
    invByCustomer: indexBy(invoices, (iv) => iv.customerId),
    invByPhone: indexBy(invoices, (iv) => phoneKey(iv.phone)),
  }), [jobCards, invoices]);

  const cardsOf = useCallback((c) => custIdx.jobsByPhone.get(phoneKey(c.phone)) || [], [custIdx]);
  const invoicesOf = useCallback((c) => {
    const byId = custIdx.invByCustomer.get(c.id) || [];
    const byPhone = custIdx.invByPhone.get(phoneKey(c.phone)) || [];
    // Union — an invoice may match on either, and must not be counted twice.
    return byId.length && byPhone.length ? [...new Set([...byId, ...byPhone])] : (byId.length ? byId : byPhone);
  }, [custIdx]);
  const billsOf = useCallback((c) => invoicesOf(c).length, [invoicesOf]);
  const visitsOf = useCallback((c) => cardsOf(c).length, [cardsOf]);
  const lastVisitOf = useCallback((c) => { const t = Math.max(0, ...cardsOf(c).map((j) => j.savedAt || 0)); return t ? new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'; }, [cardsOf]);
  // Defect 6 — "if a customer walks in, what should I immediately see": which advisor
  // has handled this customer most across their job-card history. Purely derived from
  // existing data (job cards already carry `advisor`), not a new field to maintain.
  const preferredAdvisorOf = useCallback((c) => {
    const counts = {};
    cardsOf(c).forEach((j) => { if (j.advisor) counts[j.advisor] = (counts[j.advisor] || 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : '—';
  }, [cardsOf]);
  // Batch 4C Defect 1/7 — "if I get a phone call, can I answer every question without
  // leaving this drawer": is the car sitting at the workshop RIGHT NOW. A job card is
  // "active" until it's actually left (Delivered) or been taken off the books (Closed/
  // Cancelled) — everything in between (Received through Wash/Ready) means work is
  // still genuinely in flight. Picks the most recently touched one if a customer
  // somehow has two vehicles in at once.
  const activeJobCardOf = useCallback((c) => {
    const active = cardsOf(c).filter((j) => !CLOSED_JC_STATUSES.includes(j.status));
    return active.length ? [...active].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0] : null;
  }, [cardsOf]);
  // Defect 3 (Default Vehicle, set in the Vehicle Management batch) surfaced here: a
  // single vehicle is implicitly "the" default (nothing to choose between); 2+ needs an
  // explicit choice, and shows nothing rather than guessing if none was ever set.
  const defaultVehicleOf = (c) => {
    const vehicles = c.vehicles || [];
    if (vehicles.length === 1) return vehicles[0];
    if (vehicles.length > 1) return vehicles.find((v) => v.id === c.defaultVehicleId) || null;
    return null;
  };
  // Batch 4C Defect 2 — the Timeline used to show ONLY customer-record edits (Created/
  // Edited/Archived/Vehicle Added/Document Uploaded). That answers "when was this
  // record touched," not "what's this customer's actual story" — a service advisor
  // wants Job Cards, Estimates/Invoices and Payments in the SAME chronological story,
  // not four separate tabs they have to mentally merge themselves. This is a read-only
  // aggregation of data the app already has (job card statusLog, invoice payments) —
  // nothing about Job Cards/Billing themselves is touched.
  const timelineEventsOf = useCallback((c) => {
    const events = (c.history || []).map((h) => ({ at: h.at, type: h.action, detail: h.detail, by: h.by, icon: 'customer' }));
    cardsOf(c).forEach((j) => {
      events.push({ at: j.savedAt, type: 'Job Card Created', detail: `${j.jobNo}${j.vehicle ? ` — ${j.vehicle}` : ''}`, by: j.advisor || '—', icon: 'jobcard' });
      (j.statusLog || []).forEach((s) => {
        if (s.status === 'Ready') events.push({ at: s.at, type: 'Service Completed', detail: j.jobNo, by: j.advisor || '—', icon: 'done' });
        if (s.status === 'Delivered') events.push({ at: s.at, type: 'Vehicle Delivered', detail: j.jobNo, by: j.advisor || '—', icon: 'delivered' });
      });
    });
    invoicesOf(c).forEach((iv) => {
      events.push({ at: iv.createdAt, type: iv.isEstimate ? 'Estimate Generated' : 'Invoice Generated', detail: iv.invNo, by: '—', icon: 'invoice' });
      (iv.payments || []).forEach((p) => events.push({ at: p.at, type: 'Payment Received', detail: `${iv.invNo} · ${inr(p.amount)}`, by: p.mode, icon: 'payment' }));
    });
    return events.filter((e) => e.at).sort((a, b) => b.at - a.at);
  }, [cardsOf, invoicesOf]);
  // Three-dot action menu. Was a plain `position:absolute` div anchored to the table
  // <td> — since the desktop table wrapper is `overflow-x-auto` (needed for horizontal
  // scroll on narrow screens), any absolutely-positioned content that overflows that
  // wrapper's box gets clipped by it. For a row anywhere but the very top, the ~10-item
  // menu (roughly 360px tall) extended well past the wrapper's bottom edge and was cut
  // off / rendered "inside the table" instead of floating above it — exactly the
  // clipping/overlap this reused portal component exists to prevent (see its own
  // docstring). Ported to the same production DropdownPanel fix already used for every
  // other dropdown/menu in Add Part and Job Cards, instead of patching the old ad-hoc
  // positioning a third time.
  const [menuFor, setMenuFor] = useState(null);
  const menuAnchorRefs = useRef(new Map()); // customer id -> stable {current: el} ref
  const menuAnchorRef = (id) => {
    if (!menuAnchorRefs.current.has(id)) menuAnchorRefs.current.set(id, { current: null });
    return menuAnchorRefs.current.get(id);
  };

  // The typed character renders IMMEDIATELY (`q` stays fully controlled); only the
  // derived filter lags. Debouncing the input value itself would make typing feel late.
  // useDeferredValue, not a debounce: the filter is now 0.19ms, so a 180ms debounce was
  // pure lag — results felt sluggish for no reason. React keeps typing urgent and the
  // list interruptible, so results appear as fast as the machine can draw them.
  const [dq] = useDeferredSearch(q);

  // GLOBAL SEARCH ACCURACY — STRICT VALIDATION. A record is only a match if the query
  // hits ONE OF THIS RECORD'S OWN configured searchable fields — never a linked-but-
  // different record's identifier. `ids` = this customer's OWN identifiers (Customer ID,
  // GST, PAN, and every OWNED vehicle's Registration/VIN/Engine No.) — every one of these
  // genuinely belongs to this customer. `hay` = free text (name, phone, email, city,
  // company, referral, vehicle make/model), partial-matched, ranked below identifiers.
  //
  // Deliberately NOT included: this customer's linked job-card/invoice numbers. An
  // earlier version of this fix folded them in as a separate, lower-ranked `refIds` band
  // — reasoning that a linked job-card number was still a "real" match, just a weaker
  // one. Reproduced live and rejected: this app numbers Job Cards "SBBMC123", the SAME
  // text shape as a Customer ID, so a customer whose OWN identifiers had nothing to do
  // with the query could still surface in results merely because ONE OF THEIR OWN JOB
  // CARDS happened to be numbered like a different customer's ID — e.g. searching the
  // real Customer ID "SBBMC122" also returned "Mangesh Deshmukh" (customer SBBMC54)
  // because HIS job card SBBMC122 collided in text. A query that does not match this
  // customer's OWN configured fields must return zero, full stop — "ranked lower" is
  // still "present," and presence for a non-match is the actual bug.
  const searchIndex = useSearchIndex(
    customers,
    (c) => c.id,
    (c) => [c.name, c.phone, c.altPhone, ...(c.extraPhones || []), c.email, c.city, c.companyName, c.referenceBy,
      ...(c.vehicles || []).flatMap((v) => [v.make, v.model])],
    (c) => [c.code, c.gst, c.pan,
      ...(c.vehicles || []).flatMap((v) => [v.regNo, v.vin, v.engineNo])],
    [custIdx],
  );

  const filtered = useMemo(() => {
    const prefiltered = customers.filter((c) => {
      const isArchived = !!c.archived;
      // Archive view shows ONLY archived; every other view EXCLUDES archived.
      if (statusF === 'Archived') { if (!isArchived) return false; }
      else if (isArchived) return false;
      if (typeF !== 'All' && c.type !== typeF) return false;
      if (statusF !== 'All' && statusF !== 'Archived' && c.status !== statusF) return false;
      return true;
    });
    // No query: keep the table's normal default order untouched (searchAndRank's own
    // empty-query path would apply the tieBreak as a full sort, which is right for
    // modules whose default IS that sort, but Customers' default is insertion order).
    if (!dq.trim()) return prefiltered;
    // searchAndRank does filter + relevance-rank + sort in one call against the SAME
    // shared index every other module uses — ties broken by name, stable otherwise.
    return searchAndRank(prefiltered, searchIndex, (c) => c.id, dq,
      (a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [customers, dq, typeF, statusF, searchIndex]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  // Clamp synchronously so a filter that shrinks the list below the current page doesn't
  // flash "No customers" for a frame before the setPage(1) effect runs.
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * perPage, safePage * perPage);
  const selected = useMemo(() => customers.find((c) => c.id === selId) || null, [customers, selId]);
  const typeFilterLabels = useMemo(() => ({ All: t('customers.filter.allTypes', 'All Customer Types'), ...Object.fromEntries(TYPES.map((ty) => [ty, t(`customerType.${ty}`, ty)])) }), [t]);

  // Select-all/clear operate on the current page only — selections on other pages are
  // untouched (and remain checked when the user pages back to them), since selectedIds
  // is keyed by customer id, not row position.
  const allPagedSelected = paged.length > 0 && paged.every((c) => selectedIds.has(c.id));
  const somePagedSelected = !allPagedSelected && paged.some((c) => selectedIds.has(c.id));
  const toggleSelectOne = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleSelectAllPaged = () => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (allPagedSelected) paged.forEach((c) => next.delete(c.id));
    else paged.forEach((c) => next.add(c.id));
    return next;
  });
  const clearSelection = () => setSelectedIds(new Set());

  const stats = useMemo(() => {
    const now = new Date();
    const live = customers.filter((c) => !c.archived);
    const thisMonth = live.filter((c) => { const d = new Date(c.since); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); }).length;
    return {
      total: live.length,
      active: live.filter((c) => c.status === 'Active').length,
      thisMonth,
      repeat: live.filter((c) => visitsOf(c) > 1 || c.type === 'Repeat Customer').length,
      outstandingCount: live.filter((c) => num(c.outstanding) > 0).length,
      outstanding: live.reduce((s, c) => s + num(c.outstanding), 0),
      vehicles: live.reduce((s, c) => s + (c.vehicles || []).length, 0),
    };
  }, [customers, jobCards]);

  const histEntry = (action, detail) => ({ at: Date.now(), action, detail, by: demoMode ? 'Demo User' : 'Admin' });
  // C-1 fix: all three used to close the modal / show success / clear selection the
  // instant setCustomers was CALLED, not after the Firestore write it triggers actually
  // finished — a rejected write looked identical to a successful one. setCustomers now
  // returns the real persistence promise (see InventoryDashboard.js), so these await it
  // and only complete on confirmed success; the shared persistence layer already shows
  // its own error toast on failure, so no local error toast is added here.
  const saveCustomer = async (c) => {
    const existingCust = customers.find((x) => x.id === c.id);
    const isNew = !existingCust;
    try {
      if (existingCust && onSaveCustomerEdit) {
        // Phase 1a — editing an existing customer (incl. its nested vehicles[])
        // goes through the revision-guarded transaction. `_rev` is captured from
        // the record the wizard opened with (it rides untouched through the form).
        const hist = [...(existingCust.history || [])];
        const oldVehIds = new Set((existingCust.vehicles || []).map((v) => v.id));
        (c.vehicles || []).forEach((v) => { if (!oldVehIds.has(v.id)) hist.push(histEntry('Vehicle Added', `${v.regNo} ${v.model || ''}`.trim())); });
        hist.push(histEntry('Customer Edited', c.name));
        await onSaveCustomerEdit({ ...c, history: hist }, Number.isInteger(c._rev) && c._rev >= 0 ? c._rev : 0);
      } else {
        await setCustomers((prev) => {
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
      }
    } catch (e) {
      // Phase 1a: on a stale/deleted rejection the parent already toasted; keep the
      // wizard open so nothing typed is lost (the polished conflict UX is Phase 1c).
      return;
    }
    lease.release();               // Phase 1b — hand the edit lease back after a real save
    setEditCust(null);
    toast.success('Customer saved');
    onAudit?.({ action: isNew ? 'Customer Created' : 'Customer Updated', entity: 'Customer', entityId: c.code || c.id, detail: `${c.code || ''} · ${c.name || ''}${c.phone ? ` · ${c.phone}` : ''}` });
  };
  const removeCustomer = async (c) => {
    if (demoMode && !demoCanDelete) { notify.permissionDenied('This action has been disabled by the administrator.'); return; }
    if (!await confirmDialog({ title: `Delete ${c.name}?`, message: `${c.code} — this cannot be undone.`, danger: true, confirmText: 'Delete' })) return;
    try { await setCustomers((prev) => prev.filter((x) => x.id !== c.id)); } catch (e) { return; }
    if (selId === c.id) setSelId(null);
    notify.deleted('Customer deleted');
    onAudit?.({ action: 'Customer Deleted', entity: 'Customer', entityId: c.code || c.id, detail: `${c.code || ''} · ${c.name || ''}` });
  };
  // Bulk equivalents of the per-row kebab actions (Archive/Reactivate, Delete) — same
  // persistence/confirm/history pattern, applied to every selected id in one write.
  // Deliberately NOT implementing bulk WhatsApp/SMS/Email/tags/campaigns here: this app
  // has no messaging-provider integration, so a "bulk WhatsApp" that just opened N
  // wa.me popups per customer would be broken (browsers block multi-popup bursts) and
  // "Copy Phone Numbers" below is the honest equivalent — get every selected number in
  // one paste-ready list for whatever channel the advisor actually uses. Tags and
  // service-campaign tooling need their own data model/vocabulary, not a bolt-on here.
  const bulkArchive = async (willArchive) => {
    const ids = new Set(Array.from(selectedIds).filter((id) => {
      const c = customers.find((x) => x.id === id);
      return c && !!c.archived !== willArchive;
    }));
    if (ids.size === 0) return;
    if (!await confirmDialog({
      title: willArchive ? `Archive ${ids.size} customer${ids.size > 1 ? 's' : ''}?` : `Reactivate ${ids.size} customer${ids.size > 1 ? 's' : ''}?`,
      message: willArchive ? 'Archived customers are hidden from the default list but kept in full, and can be reactivated anytime.' : 'These customers will return to the active list.',
    })) return;
    try {
      await setCustomers((prev) => prev.map((c) => {
        if (!ids.has(c.id)) return c;
        // E2E workflow QA fix: histEntry(action, detail) was called with only `action`,
        // leaving `detail: undefined` in the pushed history entry. Firestore's
        // WriteBatch.set() rejects ANY undefined field value anywhere in the document
        // being written (not just the changed fields) — so this single undefined
        // silently failed the ENTIRE customer write on every Archive/Reactivate,
        // bulk or single. Reproduced live: "FirebaseError: ... Unsupported field
        // value: undefined (found in document customers/...)", customer stayed
        // Active in Firestore while the UI optimistically showed it as archived.
        const hist = [...(c.history || []), histEntry(willArchive ? 'Customer Archived' : 'Customer Reactivated', '')];
        return willArchive
          ? { ...c, archived: true, archivedAt: Date.now(), archivedBy: demoMode ? 'Demo User' : 'Admin', history: hist }
          : { ...c, archived: false, archivedAt: null, archivedBy: null, history: hist };
      }));
    } catch (e) { return; }
    clearSelection();
    toast.success(willArchive ? `${ids.size} customer${ids.size > 1 ? 's' : ''} archived` : `${ids.size} customer${ids.size > 1 ? 's' : ''} reactivated`);
    ids.forEach((id) => {
      const c = customers.find((x) => x.id === id);
      onAudit?.({ action: willArchive ? 'Customer Archived' : 'Customer Restored', entity: 'Customer', entityId: c?.code || id, detail: `${c?.code || ''} · ${c?.name || ''}` });
    });
  };
  const bulkDelete = async () => {
    if (demoMode && !demoCanDelete) { notify.permissionDenied('This action has been disabled by the administrator.'); return; }
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!await confirmDialog({ title: `Delete ${ids.length} customer${ids.length > 1 ? 's' : ''}?`, message: 'This cannot be undone.', danger: true, confirmText: 'Delete' })) return;
    const deleted = ids.map((id) => customers.find((x) => x.id === id)).filter(Boolean);
    try { await setCustomers((prev) => prev.filter((x) => !selectedIds.has(x.id))); } catch (e) { return; }
    if (selId && selectedIds.has(selId)) setSelId(null);
    clearSelection();
    notify.deleted(`${ids.length} customer${ids.length > 1 ? 's' : ''} deleted`);
    deleted.forEach((c) => onAudit?.({ action: 'Customer Deleted', entity: 'Customer', entityId: c.code || c.id, detail: `${c.code || ''} · ${c.name || ''}` }));
  };
  const copySelectedPhones = async () => {
    const phones = [...new Set(Array.from(selectedIds).map((id) => customers.find((c) => c.id === id)?.phone).filter(Boolean))];
    if (phones.length === 0) { toast.error('No phone numbers in the current selection'); return; }
    try {
      await navigator.clipboard.writeText(phones.join(', '));
      toast.success(`Copied ${phones.length} phone number${phones.length > 1 ? 's' : ''}`);
    } catch (e) {
      toast.error('Could not copy — your browser blocked clipboard access');
    }
  };
  const saveVehicle = async (v) => {
    const cust = customers.find((c) => c.id === selId);
    const norm = (r) => (r || '').toUpperCase().replace(/\s+/g, '');
    if (cust && norm(v.regNo) && (cust.vehicles || []).some((x) => x.id !== v.id && norm(x.regNo) === norm(v.regNo))) {
      toast.error(`Registration ${v.regNo} already exists for this customer`);
      return;
    }
    const isNew = !(cust?.vehicles || []).some((x) => x.id === v.id);
    try {
      await setCustomers((prev) => prev.map((c) => {
        if (c.id !== selId) return c;
        const vehicles = c.vehicles.some((x) => x.id === v.id) ? c.vehicles.map((x) => (x.id === v.id ? v : x)) : [...c.vehicles, v];
        return { ...c, vehicles };
      }));
    } catch (e) { return; }
    setEditVeh(null);
    toast.success('Vehicle saved');
    onAudit?.({ action: isNew ? 'Vehicle Created' : 'Vehicle Updated', entity: 'Vehicle', entityId: v.regNo || v.id, detail: `${v.regNo || ''} ${v.model || ''} · ${cust?.name || ''}`.trim() });
  };
  // Documents tab (Defect 2): reuses the exact same compressImage pipeline already
  // proven for vehicle photos (image-only, ~900px/0.7 quality) rather than inventing a
  // separate file-storage path — this app has no backend file store, every attachment
  // it already persists (vehicle photos) is a compressed data URL inline on the
  // Firestore doc, and a bounded 6-type set stays well within that budget the way an
  // unbounded photo gallery wouldn't. Uploading again for a type REPLACES the existing
  // copy (one current copy per type, not a growing pile) — matches how a workshop
  // actually files "the" RC copy vs. "a" RC copy.
  const [docBusy, setDocBusy] = useState(false);
  const uploadDocument = async (type, file) => {
    if (!file || !selId) return;
    setDocBusy(true);
    try {
      const data = await compressImage(file, 1400, 0.75);
      await setCustomers((prev) => prev.map((c) => {
        if (c.id !== selId) return c;
        const docs = (c.documents || []).filter((d) => d.type !== type);
        const hist = [...(c.history || []), histEntry('Document Uploaded', type)];
        return { ...c, documents: [...docs, { type, data, uploadedAt: Date.now() }], history: hist };
      }));
      toast.success(`${type} uploaded`);
    } catch (e) {
      toast.error('Could not read that file — try a photo or image instead');
    } finally {
      setDocBusy(false);
    }
  };
  const removeDocument = async (type) => {
    if (!selId) return;
    if (!await confirmDialog({ title: `Remove ${type}?`, message: 'You can upload a replacement anytime.', danger: true, confirmText: 'Remove' })) return;
    await setCustomers((prev) => prev.map((c) => (c.id === selId ? { ...c, documents: (c.documents || []).filter((d) => d.type !== type) } : c)));
  };
  // Batch 4C Defect 4 — Notes was a single read-only blob, editable only by re-opening
  // the full Edit Customer wizard for a one-line update. Real advisor notes ("call back
  // Tuesday", "prefers synthetic oil", "handle with care — VIP") need to accumulate
  // over time with WHO said it and WHEN, not overwrite each other in one shared field.
  // This is deliberately a SEPARATE, additive array (not a replacement for the wizard's
  // own general-notes field, which stays exactly as it is — Customer Creation is out of
  // scope for this batch) so both coexist without any conflict.
  const [noteDraft, setNoteDraft] = useState('');
  const [noteQuery, setNoteQuery] = useState('');
  // Batch 4C Defect 6 — "large history / many job cards / many invoices" business
  // cases: these lists were unbounded, so a 100-visit customer would render a
  // 100-row wall in a drawer meant to be scanned quickly. Cap the initial render,
  // let the advisor opt into the rest — same idea as the vehicle quick-filter
  // threshold from the Vehicle Management batch, applied here to list LENGTH instead.
  const LIST_CAP = 15;
  const [tlShowAll, setTlShowAll] = useState(false);
  const [jcShowAll, setJcShowAll] = useState(false);
  const [ivShowAll, setIvShowAll] = useState(false);
  const addNote = async () => {
    const text = noteDraft.trim();
    if (!text || !selId) return;
    await setCustomers((prev) => prev.map((c) => (c.id === selId ? { ...c, noteEntries: [...(c.noteEntries || []), { id: `n_${Date.now()}`, text, by: demoMode ? 'Demo User' : 'Admin', at: Date.now() }] } : c)));
    setNoteDraft('');
  };
  const removeNote = async (id) => {
    if (!selId) return;
    if (!await confirmDialog({ title: 'Remove this note?', danger: true, confirmText: 'Remove' })) return;
    await setCustomers((prev) => prev.map((c) => (c.id === selId ? { ...c, noteEntries: (c.noteEntries || []).filter((n) => n.id !== id) } : c)));
  };
  // The CSV quoted EVERY value, so "Total Spent" and "Outstanding" reached Excel as
  // TEXT and =SUM() over them returned 0 — on the one report an owner actually totals.
  // The shared writer keeps numbers numeric and sizes the columns (lib/exportSheet.js).
  const [exporting, setExporting] = useState(false);
  // Shared by both export formats so a "Customer Report" PDF always shows exactly the
  // same customers/columns as the Excel export — one row-building path, not two.
  const buildCustomerExport = () => {
    // c.status ('Active'/'Inactive') is a separate field from c.archived and is never
    // touched by archiving — exporting it as-is left archived customers (visible only
    // via the Archived filter) showing their pre-archive status with nothing marking
    // them as archived. The Status column here reflects archived state first.
    const head = ['Code', 'Name', 'Type', 'Phone', 'Email', 'City', 'GST', 'Status', 'Archived Date', 'Archived By', 'Vehicles', 'Visits', 'Total Spent', 'Outstanding'];
    const fmtDate = (t) => (t ? new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
    // Universal selection-scope contract (see lib/selectionScope.js, reference:
    // Job Cards' savedByJobNo) — a selection must resolve against ALL customers, not
    // `filtered`. Re-intersecting with the current filter was the exact "N selected"
    // badge lied to the export" bug this fixes: pick 5, change the Type/Status filter
    // so 2 no longer show, and the report used to silently contain 3 — with no error
    // and no sign anything was dropped. The badge's "(N not shown by current filters)"
    // now accurately describes records that ARE still included, not ones missing.
    const toExport = selectedIds.size > 0 ? resolveSelectedRecords(selectedIds, customers, (c) => c.id) : filtered;
    const rows = toExport.map((c) => [c.code, c.name, c.type, c.phone, c.email, c.city, c.gst, c.archived ? 'Archived' : c.status,
      c.archived ? fmtDate(c.archivedAt) : '', c.archived ? (c.archivedBy || '') : '',
      (c.vehicles || []).length, visitsOf(c), num(c.totalSpent), num(c.outstanding)]);
    return { head, rows, count: toExport.length };
  };
  const exportCSV = async () => {
    if (demoMode && !demoCanExport) { notify.permissionDenied('This action has been disabled by the administrator.'); return; }
    if (exporting) return;
    setExporting(true);
    try {
      const { head, rows } = buildCustomerExport();
      await writeSheet({ filename: `customers-${stamp()}.xlsx`, sheetName: 'Customers', head, rows });
    } catch (e) {
      toast.error('Export failed.');
    } finally {
      setExporting(false);
    }
  };
  const exportPDF = async () => {
    if (demoMode && !demoCanExport) { notify.permissionDenied('This action has been disabled by the administrator.'); return; }
    if (exporting) return;
    setExporting(true);
    try {
      const { head, rows, count } = buildCustomerExport();
      const filters = [typeF !== 'All' && `Type: ${typeF}`, statusF !== 'All' && `Status: ${statusF}`, q.trim() && `Search: "${q.trim()}"`, selectedIds.size > 0 && `${count} selected`].filter(Boolean).join('   ·   ');
      await exportReportPDF({ title: 'Customer Report', head, rows, filters: filters || undefined, filename: `customer-report-${stamp()}.pdf`, demoMode });
      notify.exported('Exported Customer Report');
    } catch (e) {
      toast.error('PDF export failed.');
    } finally {
      setExporting(false);
    }
  };
  const custHistory = useMemo(() => (selected ? jobCards.filter((j) => (j.phone || '').replace(/\D/g, '') === (selected.phone || '').replace(/\D/g, '')).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)) : []), [selected, jobCards]);
  const selActiveJC = useMemo(() => (selected ? activeJobCardOf(selected) : null), [selected, activeJobCardOf]);
  const selDefaultVeh = useMemo(() => (selected ? defaultVehicleOf(selected) : null), [selected]);
  const selTimeline = useMemo(() => (selected ? timelineEventsOf(selected) : []), [selected, timelineEventsOf]);
  // Which bulk archive/reactivate action(s) make sense for the current selection —
  // a mixed selection (some active, some already archived) shows both.
  const selArchiveMix = useMemo(() => {
    let active = 0, archived = 0;
    selectedIds.forEach((id) => { const c = customers.find((x) => x.id === id); if (c) (c.archived ? archived += 1 : active += 1); });
    return { active, archived };
  }, [selectedIds, customers]);
  const bBtn = 'h-7 px-2.5 rounded-lg font-semibold text-white/70 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white transition inline-flex items-center gap-1 whitespace-nowrap';
  // Issue 2.4 (Select All ambiguity) — selection is deliberately kept across a filter
  // change (paging back to a previous filter should still show what you picked there),
  // same convention Job Cards' bulk selection already uses. The risk that convention
  // creates is an INVISIBLE selection: pick some customers, change the Type/Status
  // filter, and the badge just says "N selected" with no sign some of them are no
  // longer even in view. Same fix as Job Cards: name the gap instead of hiding it.
  const hiddenSelectedCount = useMemo(
    () => countHiddenSelections(selectedIds, filtered, (c) => c.id),
    [selectedIds, filtered],
  );

  return (
    <>
      <PageHeader title={t('page.customers', 'Customers')} icon={Users} />
      {/* Defect #54 (reopened) — Batch 4D Defect 1 pulled the KPI cards into their OWN
          row, entirely outside the [table | panel] row, specifically so the panel's
          sticky top would settle at the table's actual top instead of ~350px above it.
          That is NOT how the Vehicles module — the explicit reference for "correct"
          here — behaves: Vehicles keeps its own Stat cards INSIDE the table's column,
          as the first thing in it, in the SAME flex row as the Details Panel. Verified
          live: Vehicles' panel top lines up with the STAT CARDS' top, not the table's —
          because the panel is a sticky sibling of that whole column, and a column's
          natural top is wherever ITS OWN first child starts. Splitting the KPI row out
          (this batch's earlier attempt) fixed the width-reservation complaint but broke
          alignment with Vehicles' actual structural pattern — the Details Panel must
          occupy its own column "from the first row onward," i.e. cards and table in ONE
          column, panel as its sibling, exactly like Vehicles. Restoring that removes
          the split-row/spacer workaround entirely: one row, one flex-[2] column holding
          KPI cards + toolbar + table, one flex-[1] column holding the panel. */}
      <div className="xl:flex xl:gap-4 xl:items-start">
      {/* xl:min-w-[640px]: guarantees the table itself never compresses past a width
          where names/badges/actions get cramped, even if that means the row needs to
          make room for it (the detail panel shrinks first — see its own min-width).
          xl:flex-[2_1_0%]: grows twice as fast as the panel's xl:flex-[1_1_0%]
          (components/common/DetailsPanel.jsx) as the row gets extra width, instead of
          claiming ALL of it — see that file's "FIFTH bug" comment for why an unbounded
          flex-1 here, paired with the panel's old fixed clamp width, made the table
          balloon (and its KPI cards stretch) on wide screens while the panel stayed the
          same size regardless of how much room was available. */}
      <div className="xl:flex-[2_1_0%] xl:min-w-[640px]">
        {/* COLOR SYSTEM REVIEW: 6 cards, 5 unrelated colors (blue/green/lighter-blue/
            cyan/violet) with no semantic reason — Total/Added-This-Month/Repeat/Vehicles
            are plain counts, not status signals, so they're neutral now. Active stays
            green (a genuinely positive/healthy state) and With Outstanding stays red
            (danger — matches the same word's color in Billing/Vehicles). */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 mb-4">
          <Stat icon={Users} label={t('customers.kpi.total', 'Total Customers')} value={stats.total} color={SEMANTIC.muted} />
          <Stat icon={UserCheck} label={t('customers.kpi.active', 'Active')} value={stats.active} sub={stats.total ? t('dynamic.pctOfTotal', `${Math.round((stats.active / stats.total) * 100)}% of total`, { pct: Math.round((stats.active / stats.total) * 100) }) : null} color={SEMANTIC.ok} />
          <Stat icon={Plus} label={t('customers.kpi.addedThisMonth', 'Added This Month')} value={stats.thisMonth} color={SEMANTIC.info} />
          <Stat icon={History} label={t('customers.kpi.repeat', 'Repeat Customers')} value={stats.repeat} sub={stats.total ? t('dynamic.pctOfTotal', `${Math.round((stats.repeat / stats.total) * 100)}% of total`, { pct: Math.round((stats.repeat / stats.total) * 100) }) : null} color={SEMANTIC.muted} />
          <Stat icon={AlertCircle} label={t('customers.kpi.outstanding', 'With Outstanding')} value={stats.outstandingCount} sub={inr(stats.outstanding)} color={SEMANTIC.danger} />
          <Stat icon={Car} label={t('customers.kpi.vehiclesRegistered', 'Vehicles Registered')} value={stats.vehicles} color={SEMANTIC.muted} />
        </div>
        {/* Toolbar — REDESIGNED (explicitly authorized) into two rows instead of one:
            Row 1 is the search box alone, always full width. Row 2 is every filter/
            sort/action control. The old single-row layout tied the search box's width
            to whatever the filters/buttons left over — which is exactly why it needed
            a max-w cap AND flex-wrap AND a widened MiniSelect just to keep the
            placeholder readable (see the removed comments in git history). Giving
            search its own row removes that tug-of-war entirely: the search box is
            simply always full width, and Row 2's controls wrap freely at whatever
            width they need, unconstrained by how much room search left behind. Same
            pattern now used in Vehicles' toolbar below, for consistency. */}
        <div className="mb-2.5">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/45" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('customers.searchPlaceholder', 'Search by Customer Name, Phone Number, Email, Customer ID or Vehicle Registration')} className={`${inputCls} pl-9 w-full`} />
          </div>
        </div>
        {/* PARENT-DRIVEN layout — same mechanism as Vehicles' toolbar
            (components/vehicles/VehiclesModule.jsx): the outer row's filter cluster is a
            `flex-1` container so the PARENT (not the individual controls) claims the
            leftover row width; inside it, a CSS Grid with `repeat(auto-fit,minmax(...,1fr))`
            lets the grid algorithm size/fill the two filter tracks. The row terminates
            flush with the table column, matching its width exactly, instead of stopping
            early with a visible gap before the Details panel. */}
        <div className="flex flex-wrap gap-2.5">
          {/* Mobile QA fix: min-w-0 let this flex item shrink narrower than its grid's
              own minmax(13rem,...) tracks actually need, so at phone widths the grid
              overflowed its shrunk box and rendered ON TOP of the Excel/PDF/New Customer
              button group instead of the outer flex-wrap pushing that group to its own
              line. Dropping min-w-0 lets the flex item's min-width follow its content
              (the grid's real min-content size), so flex-wrap now wraps correctly
              instead of overlapping. Confirmed live at 375px. */}
          <div className="flex-1 grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))' }}>
            {/* MiniSelect's clear (x) button always fires onPick('') — but this filter's
                "nothing selected" state is the sentinel 'All', not ''. Without the `|| 'All'`
                fallback, clicking clear would set typeF to '' and the filter's
                `typeF !== 'All' && c.type !== typeF` check would then exclude every
                customer (no c.type is ever ''), silently emptying the table. */}
            <MiniSelect value={typeF} placeholder={t('customers.filter.allTypes', 'All Customer Types')} options={['All', ...TYPES]} labels={typeFilterLabels} emptyValue="All" onPick={(v) => setTypeF(v || 'All')} inputCls={inputCls} />
            <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className={inputCls}>{['All', 'Active', 'Inactive', 'Archived'].map((st) => <option key={st} value={st} style={{ background: '#141414' }}>{st === 'All' ? t('customers.filter.allStatus', 'All Status') : t(`status.${st.toLowerCase()}`, st)}</option>)}</select>
          </div>
          {/* Grouped so flex-wrap moves Export + New Customer to the next line TOGETHER
              (never splitting the pair) — same fix as Vehicles' toolbar, kept consistent
              even though this row's fewer filters rarely force it in practice. */}
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={exportCSV} disabled={exporting} aria-busy={exporting} className="h-11 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 disabled:opacity-50 disabled:cursor-wait bg-white/5 border border-white/10 text-white/75 hover:bg-white/10"><FileDown size={13} /> {t('common.excel', 'Excel')}</button>
            <button onClick={exportPDF} disabled={exporting} aria-busy={exporting} className="h-11 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 disabled:opacity-50 disabled:cursor-wait bg-white/5 border border-white/10 text-white/75 hover:bg-white/10"><FileDown size={13} /> {t('common.pdf', 'PDF')}</button>
            {canManage && <button onClick={() => setEditCust(emptyCustomer())} className="h-11 px-4 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 active:scale-95 transition"><Plus size={14} /> {t('customers.newCustomer', 'New Customer')}</button>}
          </div>
        </div>
        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 mt-2.5 px-3.5 py-2.5 rounded-xl text-xs" style={{ background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.2)' }}>
            <span className="font-semibold text-[#d4af37] whitespace-nowrap">{t('dynamic.selectedCount', `${selectedIds.size} selected`, { n: selectedIds.size })}{hiddenSelectedCount > 0 ? ` (${hiddenSelectedCount} not shown by current filters)` : ''}</span>
            <button onClick={exportCSV} disabled={exporting} className={`${bBtn} disabled:opacity-50`}><FileDown size={12} /> {t('common.excel', 'Excel')}</button>
            <button onClick={exportPDF} disabled={exporting} className={`${bBtn} disabled:opacity-50`}><FileDown size={12} /> {t('common.pdf', 'PDF')}</button>
            <button onClick={copySelectedPhones} className={bBtn}><Phone size={12} /> {t('customers.copyNumbers', 'Copy Numbers')}</button>
            {canManage && selArchiveMix.active > 0 && <button onClick={() => bulkArchive(true)} className={bBtn}><Archive size={12} /> {t('common.archive', 'Archive')}</button>}
            {canManage && selArchiveMix.archived > 0 && <button onClick={() => bulkArchive(false)} className={bBtn}><Archive size={12} /> {t('common.reactivate', 'Reactivate')}</button>}
            {canManage && <button onClick={bulkDelete} className="h-7 px-2.5 rounded-lg font-semibold text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition inline-flex items-center gap-1 whitespace-nowrap"><Trash2 size={12} /> {t('common.delete', 'Delete')}</button>}
            <button onClick={clearSelection} className="ml-auto text-white/50 hover:text-white/90 hover:underline whitespace-nowrap">{t('common.clearSelection', 'Clear selection')}</button>
          </div>
        )}

        {/* table */}
        <div className="rounded-2xl overflow-hidden mt-3" style={cardStyle}>
          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-sm min-w-[760px]">
              <thead style={{ background: 'var(--surface-1)' }}>
                <tr className="text-[10px] uppercase tracking-wide text-white/45" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
                  <th className="text-left font-semibold py-2.5 px-3 whitespace-nowrap w-8">
                    <input
                      type="checkbox"
                      checked={allPagedSelected}
                      ref={(el) => { if (el) el.indeterminate = somePagedSelected; }}
                      onChange={toggleSelectAllPaged}
                      aria-label="Select all customers on this page"
                      className="w-3.5 h-3.5 accent-[#d4af37]"
                    />
                  </th>
                  {[
                    ['#', 'table.rowNum', '#'],
                    ['Customer ID', 'customers.col.id', 'Customer ID'],
                    ['Customer Name', 'customers.col.name', 'Customer Name'],
                    ['Phone / Email', 'customers.col.contact', 'Phone / Email'],
                    ['Type', 'customers.col.type', 'Type'],
                    ['Vehicles', 'customers.col.vehicles', 'Vehicles'],
                    ['Visits', 'customers.col.visits', 'Visits'],
                    ['Total Bills', 'customers.col.totalBills', 'Total Bills'],
                    ['Total Revenue', 'customers.col.totalRevenue', 'Total Revenue'],
                    ['Outstanding', 'customers.col.outstanding', 'Outstanding'],
                    ['Status', 'common.status', 'Status'],
                    ['Last Visit', 'customers.col.lastVisit', 'Last Visit'],
                    ['Actions', 'common.actions', 'Actions'],
                  ].map(([h, key, fallback]) => <th key={h} className="text-left font-semibold py-2.5 px-3 whitespace-nowrap">{t(key, fallback)}</th>)}
                </tr>
              </thead>
              <tbody>
                {paged.map((c, i) => (
                  <tr key={c.id} className={`transition cursor-pointer ${selId === c.id ? 'bg-[#d4af37]/8' : 'hover:bg-white/[0.03]'}`} onClick={() => setSelId(c.id)} style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.05)' }}>
                    <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(c.id)}
                        onChange={() => toggleSelectOne(c.id)}
                        aria-label={`Select ${c.name}`}
                        className="w-3.5 h-3.5 accent-[#d4af37]"
                      />
                    </td>
                    <td className="py-2.5 px-3 text-white/45">{(page - 1) * perPage + i + 1}</td>
                    <td className="py-2.5 px-3"><span className="text-[11px] font-bold" style={{ color: '#d4af37' }}>{c.code}</span></td>
                    <td className="py-2.5 px-3"><div className="flex items-center gap-2.5"><Avatar name={c.name} /><p className="text-white/90 font-medium">{c.name}</p></div></td>
                    <td className="py-2.5 px-3"><p className="text-white/80">{c.phone}</p><p className="text-[10px] text-white/45 truncate max-w-[150px]">{c.email}</p></td>
                    <td className="py-2.5 px-3"><Badge color={typeColor(c.type)}>{t(`customerType.${c.type}`, c.type)}</Badge></td>
                    <td className="py-2.5 px-3 text-center text-white/70">{(c.vehicles || []).length}</td>
                    <td className="py-2.5 px-3 text-center text-white/70">{visitsOf(c)}</td>
                    <td className="py-2.5 px-3 text-center text-white/70">{billsOf(c)}</td>
                    <td className="py-2.5 px-3 text-white/85">{inr(c.totalSpent)}</td>
                    <td className="py-2.5 px-3"><span className={num(c.outstanding) > 0 ? 'text-red-400 font-semibold' : 'text-white/50'}>{inr(c.outstanding)}</span></td>
                    <td className="py-2.5 px-3"><Badge color={c.status === 'Active' ? '#34d399' : '#9ca3af'}>{t(`status.${String(c.status || '').toLowerCase()}`, c.status)}</Badge></td>
                    <td className="py-2.5 px-3 text-white/60 text-xs whitespace-nowrap">{lastVisitOf(c)}</td>
                    <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1 items-center">
                        <button onClick={() => setSelId(c.id)} title="View" className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 hover:bg-white/10"><Eye size={12} /></button>
                        {canManage && <button onClick={() => openCustomerEditor(c)} disabled={c.id === selId && lease.status === 'held'} title={c.id === selId && lease.status === 'held' ? 'Being edited by another user' : 'Edit'} className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed">{c.id === selId && lease.status === 'held' ? <Lock size={12} /> : <Edit3 size={12} />}</button>}
                        <button ref={menuAnchorRef(c.id)} onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === c.id ? null : c.id); }} aria-label="More actions" aria-haspopup="menu" aria-expanded={menuFor === c.id} className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 hover:bg-white/10"><MoreVertical size={12} /></button>
                      </div>
                      {menuFor === c.id && (
                        <ActionMenu anchorRef={menuAnchorRef(c.id)} open onClose={() => setMenuFor(null)} items={[
                          // View / Edit are primary actions with their own always-visible row
                          // buttons (above) — intentionally NOT duplicated here. This menu is
                          // secondary/workflow/communication/destructive actions only.
                          canManage && { type: 'item', label: t('customers.action.addVehicle', 'Add Vehicle'), icon: Plus, onClick: () => { setSelId(c.id); setEditVeh(emptyVehicle()); } },
                          canManage && { type: 'item', label: t('common.createJobCard', 'Create Job Card'), icon: ClipboardList, onClick: () => onCreateJobCard?.(c) },
                          canManage && { type: 'item', label: t('common.createInvoice', 'Create Invoice'), icon: Receipt, onClick: () => onCreateInvoice?.(c) },
                          { type: 'item', label: t('customers.action.viewHistory', 'View History'), icon: History, onClick: () => { setSelId(c.id); setDetailTab('Timeline'); } },
                          c.phone && { type: 'item', label: t('customers.action.sendWhatsApp', 'Send WhatsApp'), icon: MessageCircle, onClick: () => window.open(`https://wa.me/91${c.phone}`, '_blank') },
                          c.phone && { type: 'item', label: t('customers.action.callCustomer', 'Call Customer'), icon: PhoneCall, onClick: () => { window.location.href = `tel:+91${c.phone}`; } },
                          canManage && {
                            type: 'item', label: c.archived ? t('common.reactivate', 'Reactivate') : t('customers.action.archiveCustomer', 'Archive Customer'), icon: Archive, onClick: () => {
                              setCustomers((prev) => prev.map((x) => {
                                if (x.id !== c.id) return x;
                                const willArchive = !x.archived;
                                // Same missing-argument fix as bulkArchive above.
                                const hist = [...(x.history || []), histEntry(willArchive ? 'Customer Archived' : 'Customer Reactivated', '')];
                                return willArchive
                                  ? { ...x, archived: true, archivedAt: Date.now(), archivedBy: demoMode ? 'Demo User' : 'Admin', history: hist }
                                  : { ...x, archived: false, archivedAt: null, archivedBy: null, history: hist };
                              }));
                            },
                          },
                          canManage && { type: 'item', label: t('customers.action.deleteCustomer', 'Delete Customer'), icon: Trash2, danger: true, onClick: () => removeCustomer(c) },
                        ]} />
                      )}
                    </td>
                  </tr>
                ))}
                {paged.length === 0 && <tr><td colSpan={14} className="py-10 text-center text-white/45 text-xs">{t('customers.empty.noMatch', 'No customers match.')} {canManage && t('customers.empty.clickToAdd', 'Click "New Customer" to add your first.')}</td></tr>}
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
                  <Badge color={c.status === 'Active' ? '#34d399' : '#9ca3af'}>{t(`status.${String(c.status || '').toLowerCase()}`, c.status)}</Badge>
                </div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className="text-[10px] text-white/45">{(c.vehicles || []).length} {t('customers.vehicleCount', (c.vehicles || []).length === 1 ? 'vehicle' : 'vehicles')} · {billsOf(c)} {t('customers.bills', 'bills')} · {inr(c.totalSpent)}</span>
                  {num(c.outstanding) > 0 && <span className="text-[10px] text-red-400 font-semibold">{t('customers.due', 'Due')} {inr(c.outstanding)}</span>}
                  <div className="ml-auto flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {canManage && <button onClick={() => openCustomerEditor(c)} disabled={c.id === selId && lease.status === 'held'} className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 disabled:opacity-40 disabled:cursor-not-allowed">{c.id === selId && lease.status === 'held' ? <Lock size={13} /> : <Edit3 size={13} />}</button>}
                    {canManage && <button onClick={() => onCreateInvoice?.(c)} className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60"><Receipt size={13} /></button>}
                    {c.phone && <button onClick={() => window.open(`https://wa.me/91${c.phone}`, '_blank')} className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-emerald-400/70"><MessageCircle size={13} /></button>}
                  </div>
                </div>
              </div>
            ))}
            {paged.length === 0 && <div className="py-10 text-center text-white/45 text-xs">{t('customers.empty.noMatch', 'No customers match.')} {canManage && t('customers.empty.tapToAdd', 'Tap "New Customer" to add your first.')}</div>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.06)' }}>
            <span className="text-[11px] text-white/45">{t('dynamic.showingRange', `Showing ${filtered.length ? (safePage - 1) * perPage + 1 : 0} to ${Math.min(safePage * perPage, filtered.length)} of ${filtered.length} customers`, { from: filtered.length ? (safePage - 1) * perPage + 1 : 0, to: Math.min(safePage * perPage, filtered.length), total: filtered.length, entity: t('customers.entityLower', 'customers') })}</span>
            <div className="flex items-center gap-2">
              <button disabled={safePage <= 1} onClick={() => setPage((p) => Math.min(p, pageCount) - 1)} aria-label="Previous page" className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 disabled:opacity-30"><ChevronLeft size={14} /></button>
              <span className="text-xs text-white/60">{safePage} / {pageCount}</span>
              <button disabled={safePage >= pageCount} onClick={() => setPage((p) => Math.min(p, pageCount) + 1)} aria-label="Next page" className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 disabled:opacity-30"><ChevronRight size={14} /></button>
              <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))} className="h-8 px-2 rounded-lg text-xs bg-white/5 border border-white/10 text-white/70 outline-none">{[10, 25, 50, 100].map((n) => <option key={n} value={n} style={{ background: '#141414' }}>{n} {t('common.perPage', '/ page')}</option>)}</select>
            </div>
          </div>
        </div>
      </div>

      {/* -------- detail panel --------
          Shared framework (components/common/DetailsPanel.jsx) — owns the responsive
          width, header-aware sticky offset, max-height and independent-scroll body that
          used to be hand-rolled here and separately (and staler) in Vehicles' panel.
          All content below is unchanged, just supplied as `header`/children instead of
          being inlined in the layout markup. */}
      <DetailsPanel
        cardStyle={cardStyle}
        empty={!selected}
        emptyIcon={Users}
        emptyTitle={t('customers.detail.title', 'Customer Details')}
        emptyHint={t('customers.detail.selectHint', 'Select a customer to view:')}
        emptyBullets={[
          t('customers.detail.bulletProfile', 'Profile & contact info'),
          t('nav.vehicles', 'Vehicles'),
          t('nav.jobcards', 'Job Cards'),
          t('customers.detail.bulletInvoicesPayments', 'Invoices & Payments'),
          t('customers.detail.bulletTimelineNotes', 'Timeline, Notes & Documents'),
        ]}
        emptyTip={t('customers.detail.emptyTip', 'Click a row to view details · Use checkboxes for bulk actions')}
        emptyPadding="py-8"
        bodyRef={drawerScrollRef}
        onBodyScroll={(e) => { V.drawerScrollY = e.currentTarget.scrollTop; }}
        header={selected && (
          <>
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-sm font-bold text-white/85">{t('customers.detail.title', 'Customer Details')}</h3>
              <button onClick={() => setSelId(null)} aria-label="Close" className="w-7 h-7 rounded-lg flex items-center justify-center text-white/45 hover:bg-white/10"><X size={14} /></button>
            </div>
          </>
        )}
      >
        {selected && (
          <>
              {/* Same shared component Vehicles' panel renders (components/common/DetailHero).
                  Previously this was a hand-copied duplicate of Vehicles' markup; it is now
                  literally the same component, so the two heroes render identically by
                  construction and cannot drift apart again. Name/status/code/type stay
                  OUTSIDE the box, exactly where Vehicles puts reg-no/status/model/owner. */}
              <DetailHero icon={Users} />
              <p className="text-base font-bold text-white flex items-center gap-2 flex-wrap mb-1">{selected.name} <Badge color={selected.status === 'Active' ? '#34d399' : '#9ca3af'}>{t(`status.${String(selected.status || '').toLowerCase()}`, selected.status)}</Badge>{visitsOf(selected) > 1 && <Badge color="#22d3ee">{t('status.repeat', 'Repeat')}</Badge>}</p>
              <p className="text-[11px] text-white/45 mb-3">{selected.code} <Badge color={typeColor(selected.type)}>{t(`customerType.${selected.type}`, selected.type)}</Badge></p>
              <EditLeaseBanner status={lease.status} heldByEmail={lease.heldByEmail} className="mb-3" />
              {lease.status === 'mine' && <div role="status" className="flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs mb-3" style={{ background: 'rgba(212,175,55,0.10)', border: '1px solid rgba(212,175,55,0.28)' }}><Edit3 size={13} className="text-[#d4af37]" /><span className="text-[#e8c46a]">You are editing this customer.</span></div>}
              {/* Defect #46 — major-section gaps in this drawer used to alternate 16/12/16/12
                  (mb-4, mb-3, mb-4, mb-3) across contact info -> KPI strip -> secondary
                  grid -> tabs with no reason for the difference; measured live via
                  getBoundingClientRect(), confirming an actually uneven rhythm, not just
                  an impression. Standardized every major-section gap in this drawer body
                  to mb-3 (matching the KPI strip and tabs, which were already there) —
                  the tighter mb-1/mb-2 identity-block spacing above (avatar -> name ->
                  code/type line) is untouched, since that's a deliberately different,
                  tighter tier for elements in the SAME visual group, not the
                  inconsistency being reported. */}
              <div className="space-y-1.5 text-xs text-white/70 mb-3">
                <p className="flex items-center gap-2"><Phone size={12} className="text-white/45" /> {selected.phone}{selected.altPhone ? ` · ${selected.altPhone}` : ''}</p>
                {selected.email && <p className="flex items-center gap-2"><Mail size={12} className="text-white/45" /> {selected.email}</p>}
                {selected.address && <p className="flex items-start gap-2"><MapPin size={12} className="text-white/45 mt-0.5 flex-shrink-0" /> {selected.address}</p>}
              </div>
              {/* Batch 4C Defect 1/5/7 — "can I understand this customer in under 10
                  seconds, and answer a phone call without leaving this drawer": the four
                  things an advisor actually needs FIRST (is money owed, is the car here
                  right now, when did they last come in, what do they usually drive) get
                  their own prominent tiles instead of being buried alphabetically inside
                  a 12-field grid alongside GST numbers and occupation. */}
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="rounded-xl p-2.5" style={num(selected.outstanding) > 0 ? { background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)' } : { background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                  <p className="text-[9px] uppercase tracking-wide text-white/45">{t('customers.col.outstanding', 'Outstanding')}</p>
                  <p className="text-sm font-bold" style={{ color: num(selected.outstanding) > 0 ? '#f87171' : '#34d399' }}>{inr(selected.outstanding)}</p>
                </div>
                <div className="rounded-xl p-2.5" style={selActiveJC ? { background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.25)' } : { background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                  <p className="text-[9px] uppercase tracking-wide text-white/45">{t('customers.detail.activeJobCard', 'Active Job Card')}</p>
                  {selActiveJC ? <p className="text-sm font-bold truncate" style={{ color: '#d4af37' }}>{selActiveJC.status}</p> : <p className="text-xs font-medium text-white/45">{t('customers.detail.none', 'None')}</p>}
                </div>
                <div className="rounded-xl p-2.5" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                  <p className="text-[9px] uppercase tracking-wide text-white/45">{t('customers.col.lastVisit', 'Last Visit')}</p>
                  <p className="text-sm font-bold text-white/85">{lastVisitOf(selected)}</p>
                </div>
                <div className="rounded-xl p-2.5" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                  <p className="text-[9px] uppercase tracking-wide text-white/45">{t('customers.detail.defaultVehicle', 'Default Vehicle')}</p>
                  {selDefaultVeh ? <p className="text-sm font-bold text-white/85 truncate">{selDefaultVeh.regNo}</p> : <p className="text-xs font-medium text-white/45">{(selected.vehicles || []).length ? t('customers.detail.notSet', 'Not set') : '—'}</p>}
                </div>
              </div>
              {/* Secondary — administrative/reference detail, still one tap away but no
                  longer competing for the same visual weight as the strip above. */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] rounded-xl p-3 mb-3" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                {[
                  [t('customers.col.vehicles', 'Vehicles'), (selected.vehicles || []).length],
                  [t('customers.detail.totalVisits', 'Total Visits'), visitsOf(selected)],
                  [t('customers.detail.preferredAdvisor', 'Preferred Advisor'), preferredAdvisorOf(selected)],
                  [t('customers.col.totalRevenue', 'Total Revenue'), inr(selected.totalSpent)],
                  [t('customers.detail.gstNo', 'GST No.'), selected.gst || '—'],
                  [t('customers.detail.pan', 'PAN'), selected.pan || '—'],
                  [t('customers.detail.company', 'Company'), selected.companyName || '—'],
                  [t('customers.detail.customerSince', 'Customer Since'), selected.since],
                  [t('customers.detail.occupation', 'Occupation'), selected.occupation || '—'],
                  [t('customers.detail.referenceBy', 'Reference By'), selected.referenceBy || '—'],
                ].map(([k, v]) => (
                  <div key={k}><p className="text-white/45">{k}</p><p className="font-semibold text-white/85">{v}</p></div>
                ))}
              </div>

              {/* detail tabs — wrap so all are visible (no horizontal scroll / hidden Timeline) */}
              <div className="flex flex-wrap gap-1 mb-3">
                {['Vehicles', 'Job Cards', 'Invoices', 'Payments', 'Timeline', 'Notes', 'Documents'].map((tab) => (
                  <button key={tab} onClick={() => setDetailTab(tab)} className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap transition ${detailTab === tab ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]' : 'text-white/55 bg-white/5 border border-white/10 hover:bg-white/10'}`}>{t(`customers.detail.tab.${tab.replace(/\s/g, '')}`, tab)}</button>
                ))}
              </div>

              {detailTab === 'Vehicles' && (
                <>
                  {canManage && <button onClick={() => setEditVeh(emptyVehicle())} className="w-full mb-2 h-9 rounded-lg text-[11px] font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] flex items-center justify-center gap-1"><Plus size={12} /> {t('customers.action.addVehicle', 'Add Vehicle')}</button>}
                  <div className="space-y-2">
                    {(selected.vehicles || []).map((v) => (
                      <div key={v.id} className="rounded-xl p-3" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                        <div className="flex items-center gap-2 mb-1.5">
                          {(v.photos || []).length > 0 && <img src={v.photos[v.coverPhoto || 0]} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />}
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-md" style={{ background: 'rgba(212,175,55,0.12)', color: '#d4af37' }}>{v.regNo}</span>
                          {canManage && (
                            <div className="flex gap-1 ml-auto">
                              <button onClick={() => setEditVeh(v)} className="w-6 h-6 rounded-md flex items-center justify-center text-white/45 hover:bg-white/10"><Edit3 size={11} /></button>
                              <button onClick={async () => { if (demoMode) { notify.info('Demo Mode — This action is disabled. Demo data resets automatically after reload.'); return; } if (await confirmDialog({ title: `Remove ${v.regNo}?`, message: 'This vehicle will be removed from the customer.', danger: true, confirmText: 'Remove' })) setCustomers((prev) => prev.map((c) => (c.id === selected.id ? { ...c, vehicles: c.vehicles.filter((x) => x.id !== v.id) } : c))); }} className="w-6 h-6 rounded-md flex items-center justify-center text-red-400/60 hover:bg-red-500/10"><Trash2 size={11} /></button>
                            </div>
                          )}
                        </div>
                        <p className="text-sm text-white/90 font-medium">{v.model}{v.variant ? ` ${v.variant}` : ''}</p>
                        <div className="grid grid-cols-2 gap-x-3 text-[10px] text-white/45 mt-1">
                          <span>{t('vehicles.col.fuel', 'Fuel')}: <span className="text-white/70">{v.fuel}</span></span>
                          <span>{t('vehicles.col.year', 'Year')}: <span className="text-white/70">{v.year || '—'}</span></span>
                          <span>{t('vehicles.col.insurance', 'Insurance')}: <span className="text-white/70">{v.insuranceExpiry || '—'}</span></span>
                          <span>{t('vehicles.col.rc', 'RC')}: <span className="text-white/70">{v.rcExpiry || '—'}</span></span>
                        </div>
                      </div>
                    ))}
                    {(selected.vehicles || []).length === 0 && <p className="text-xs text-white/45 text-center py-3">{t('customers.detail.noVehiclesYet', 'No vehicles yet.')}</p>}
                  </div>
                </>
              )}

              {detailTab === 'Job Cards' && (
                <div className="space-y-1.5">
                  {cardsOf(selected).length ? [...cardsOf(selected)].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)).slice(0, jcShowAll ? undefined : LIST_CAP).map((j, i) => (
                    <button key={i} type="button" onClick={() => onOpenJobCard?.(j)} className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs hover:bg-white/[0.06] transition text-left" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                      <span className="text-white/80">{j.jobNo} · {j.vehicle || '—'}</span><span className="text-white/45">{j.status}</span>
                    </button>
                  )) : <p className="text-xs text-white/45 text-center py-4">No job cards yet.</p>}
                  {!jcShowAll && cardsOf(selected).length > LIST_CAP && <button onClick={() => setJcShowAll(true)} className="w-full h-8 rounded-lg text-[11px] font-semibold text-white/50 hover:text-white/80 bg-white/5 border border-white/10">Show all {cardsOf(selected).length} job cards</button>}
                  {canManage && <button onClick={() => onCreateJobCard?.(selected)} className="w-full mt-2 h-9 rounded-lg text-[11px] font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">+ Create Job Card</button>}
                </div>
              )}

              {detailTab === 'Invoices' && (
                <div className="space-y-1.5">
                  {invoicesOf(selected).length ? [...invoicesOf(selected)].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, ivShowAll ? undefined : LIST_CAP).map((iv, i) => (
                    <button key={i} type="button" onClick={() => onOpenInvoice?.(iv)} className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs hover:bg-white/[0.06] transition text-left" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                      <span className="text-white/80">{iv.invNo} · {iv.date}</span><span style={{ color: iv.status === 'Paid' ? '#34d399' : iv.status === 'Partial' ? '#fbbf24' : '#f87171' }}>{iv.status}</span>
                    </button>
                  )) : <p className="text-xs text-white/45 text-center py-4">No invoices yet.</p>}
                  {!ivShowAll && invoicesOf(selected).length > LIST_CAP && <button onClick={() => setIvShowAll(true)} className="w-full h-8 rounded-lg text-[11px] font-semibold text-white/50 hover:text-white/80 bg-white/5 border border-white/10">Show all {invoicesOf(selected).length} invoices</button>}
                  {canManage && <button onClick={() => onCreateInvoice?.(selected)} className="w-full mt-2 h-9 rounded-lg text-[11px] font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">+ Create Invoice</button>}
                </div>
              )}

              {detailTab === 'Payments' && (
                <div className="space-y-1.5">
                  {invoicesOf(selected).filter((iv) => num(iv.paid) > 0).length ? invoicesOf(selected).filter((iv) => num(iv.paid) > 0).map((iv, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 rounded-xl text-xs" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                      <span className="text-white/80">{iv.invNo}</span><span className="text-emerald-400">{inr(iv.paid)}</span>
                    </div>
                  )) : <p className="text-xs text-white/45 text-center py-4">No payments recorded.</p>}
                  <div className="flex justify-between px-3 py-2 mt-1 rounded-xl text-xs font-bold" style={{ background: 'rgba(var(--fg-rgb),0.05)' }}><span className="text-white/70">Outstanding</span><span style={{ color: num(selected.outstanding) > 0 ? '#f87171' : '#34d399' }}>{inr(selected.outstanding)}</span></div>
                </div>
              )}

              {detailTab === 'Timeline' && (
                <div className="space-y-2">
                  {/* Batch 4C Defect 2 — merged story (Job Cards/Estimates/Invoices/
                      Payments/customer-record edits), not just record edits. Icon+colour
                      per event kind so the shape of the customer's history is scannable
                      at a glance, not just its text. */}
                  {selTimeline.slice(0, tlShowAll ? undefined : LIST_CAP).map((h, i) => {
                    const Icon = { jobcard: ClipboardList, done: Check, delivered: Car, invoice: Receipt, payment: IndianRupee, customer: Users }[h.icon] || Users;
                    const color = { jobcard: '#60a5fa', done: '#34d399', delivered: '#34d399', invoice: '#a78bfa', payment: '#d4af37', customer: '#9ca3af' }[h.icon] || '#d4af37';
                    return (
                      <div key={i} className="flex gap-2.5">
                        <span className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: `${color}1f`, color }}><Icon size={11} /></span>
                        <div className="min-w-0 pt-0.5"><p className="text-xs text-white/85">{h.type} {h.detail ? <span className="text-white/50">· {h.detail}</span> : null}</p><p className="text-[10px] text-white/45">{new Date(h.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}{h.by && h.by !== '—' ? ` · ${h.by}` : ''}</p></div>
                      </div>
                    );
                  })}
                  {!tlShowAll && selTimeline.length > LIST_CAP && <button onClick={() => setTlShowAll(true)} className="w-full h-8 rounded-lg text-[11px] font-semibold text-white/50 hover:text-white/80 bg-white/5 border border-white/10">Show all {selTimeline.length} events</button>}
                  {selTimeline.length === 0 && <p className="text-xs text-white/45 text-center py-4">No activity recorded yet.</p>}
                </div>
              )}

              {detailTab === 'Notes' && (
                <div className="space-y-3">
                  {/* General Notes: the wizard's own free-text field (Customer Creation
                      is out of scope for this batch, so it stays exactly as-is) — shown
                      read-only here for context, separate from the timestamped entries
                      below rather than merged into them. */}
                  {selected.notes && (
                    <div className="rounded-xl p-3" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                      <p className="text-[10px] uppercase tracking-wide text-white/45 mb-1">General Notes</p>
                      <p className="text-xs text-white/70 whitespace-pre-wrap">{selected.notes}</p>
                    </div>
                  )}
                  {canManage && (
                    <div className="flex gap-2">
                      <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addNote(); }} placeholder="Add a note — call back Tuesday, prefers synthetic oil…" className={inputCls} />
                      <button onClick={addNote} disabled={!noteDraft.trim()} className="h-11 px-4 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] disabled:opacity-40 flex-shrink-0">Add</button>
                    </div>
                  )}
                  {(selected.noteEntries || []).length >= 5 && (
                    <input value={noteQuery} onChange={(e) => setNoteQuery(e.target.value)} placeholder="Search notes…" className={`${inputCls} py-2 text-xs`} />
                  )}
                  <div className="space-y-2">
                    {[...(selected.noteEntries || [])].reverse().filter((n) => !noteQuery.trim() || n.text.toLowerCase().includes(noteQuery.trim().toLowerCase())).map((n) => (
                      <div key={n.id} className="rounded-xl p-2.5" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs text-white/80 whitespace-pre-wrap flex-1 min-w-0">{n.text}</p>
                          {canManage && <button onClick={() => removeNote(n.id)} aria-label="Remove note" className="text-red-400/50 hover:text-red-400 flex-shrink-0"><Trash2 size={12} /></button>}
                        </div>
                        <p className="text-[10px] text-white/45 mt-1">{new Date(n.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · {n.by}</p>
                      </div>
                    ))}
                    {(selected.noteEntries || []).length === 0 && <p className="text-xs text-white/45 text-center py-3">No notes yet{canManage ? ' — add the first one above.' : '.'}</p>}
                  </div>
                </div>
              )}

              {detailTab === 'Documents' && (
                <div className="space-y-2">
                  {DOC_TYPES.map((type) => {
                    const doc = (selected.documents || []).find((d) => d.type === type);
                    return (
                      <div key={type} className="flex items-center gap-2.5 rounded-xl p-2.5" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                        {doc ? (
                          <a href={doc.data} target="_blank" rel="noopener noreferrer" className="w-11 h-11 rounded-lg overflow-hidden flex-shrink-0" style={{ border: '1px solid rgba(212,175,55,0.35)' }}>
                            <img src={doc.data} alt={type} className="w-full h-full object-cover" />
                          </a>
                        ) : (
                          <span className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 text-white/45" style={{ border: '1px dashed rgba(var(--fg-rgb),0.2)' }}><FileDown size={16} /></span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-white/85">{type}</p>
                          <p className="text-[10px] text-white/45">{doc ? `Uploaded ${new Date(doc.uploadedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : 'Not uploaded'}</p>
                        </div>
                        {canManage && (
                          <div className="flex gap-1 flex-shrink-0">
                            <label className="h-7 px-2.5 rounded-lg text-[10px] font-semibold text-white/70 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white transition inline-flex items-center gap-1 cursor-pointer">
                              <Upload size={11} /> {doc ? 'Replace' : 'Upload'}
                              <input type="file" accept="image/*" capture="environment" className="hidden" disabled={docBusy} onChange={(e) => { const file = e.target.files[0]; uploadDocument(type, file); e.target.value = ''; }} />
                            </label>
                            {doc && <button onClick={() => removeDocument(type)} className="w-7 h-7 rounded-lg flex items-center justify-center text-red-400/60 hover:bg-red-500/10 flex-shrink-0"><Trash2 size={12} /></button>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <p className="text-[10px] text-white/45 text-center pt-1">Photograph or upload each document — stored securely with this customer&rsquo;s record.</p>
                  {/* Batch 4C Defect 3: Invoice/Job Card PDFs are deliberately NOT
                      duplicated here — they're generated on demand from live data
                      (Invoices/Job Cards tabs), so a stale copy filed here would drift
                      from the real record. This tab is for documents that ARE files:
                      things a customer or the workshop physically hands over. */}
                  <p className="text-[10px] text-white/45 text-center">Invoice and Job Card copies are always up to date in their own tabs above.</p>
                </div>
              )}
          </>
        )}
      </DetailsPanel>

      {editCust && <CustomerWizard initial={editCust} existing={customers} canManage={canManage} onSave={saveCustomer} onClose={editCust.id ? closeCustomerEditor : () => setEditCust(null)} demoMode={demoMode} />}
      {editVeh && selected && <VehicleModal initial={editVeh} onSave={saveVehicle} onClose={() => setEditVeh(null)} />}
      </div>
    </>
  );
}
