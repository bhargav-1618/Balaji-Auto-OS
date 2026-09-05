// components/vehicles/VehiclesModule.jsx — Part 2 master rebuild.
// Vehicles are the single source of truth for anything vehicle-shaped, but are
// stored nested under their owning customer (customers[].vehicles) to prevent
// orphan records. This module gives full read/write over that data: rich
// dashboard, comprehensive search/filter/sort, a 7-step Add/Edit wizard with
// cascading make→model→variant, multi-photo capture (compressed) + documents,
// a tabbed detail panel, auto service history from Job Cards, reminders, and
// CSV/print export. All subcomponents hoisted (focus-safe).
import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import DropdownPanel, { ModalBoundaryContext } from '../common/DropdownPanel';
import ActionMenu from '../common/ActionMenu';
import PageHeader from '../common/PageHeader';
import { useTranslation } from '../../lib/i18n';
import notify from '../common/notify';
import MiniSelect from '../common/MiniSelect';
import DetailsPanel from '../common/DetailsPanel';
import DetailHero from '../common/DetailHero';
import { appScrollTo, appScrollY } from '../../lib/appScroll';
import VehicleMakeModelSelect from '../common/VehicleMakeModelSelect';
import { writeSheet, asDate, stamp } from '../../lib/exportSheet';
import { exportReportPDF } from '../../lib/pdfTheme';
import { resolveSelectedRecords, countHiddenSelections } from '../../lib/selectionScope';
import { useDeferredSearch, useSearchIndex, matchIndexed, rankIndexed, regKey, normId } from '../../lib/useSearch';
import Badge from '../common/Badge';
import {
  buildVehicleIndex, jobsOf, invoicesOf, completedVisitsOf, isInService, isActive,
  isExpiring, revenueOf as vehicleRevenueOf, computeVehicleStats, DEFAULT_REMINDER_DAYS,
} from '../../lib/vehicleStats';
import toast from '../../lib/toast';
import { confirmDialog } from '../common/ConfirmDialog';
import { SEMANTIC } from '../../constants/ui';
import Toggle from '../common/Toggle';
import {
  Car, Search, FileDown, ClipboardList, AlertTriangle, User, Plus, X, Edit3, Trash2,
  Eye, ChevronDown, ChevronLeft, ChevronRight, Camera, Star, Shield, FileText, Wrench,
  Copy, Archive, MoreVertical, IndianRupee, Clock, Printer, MapPin,
} from 'lucide-react';
import { variantsFor, FUELS, TRANSMISSIONS, BODY_TYPES, DRIVE_TYPES, OWNERSHIP_TYPES } from '../../lib/vehicleCatalog';
import { num, isIndianMobile, mobileInput, MOBILE_ERROR } from '../../lib/format';

const inputCls = 'w-full px-3 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 text-white placeholder-white/25 outline-none focus:border-[#d4af37]/60 transition';
const cardStyle = { background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' };
const inr = (n) => `₹${num(n).toLocaleString('en-IN')}`;
const daysUntil = (d) => { if (!d) return null; return Math.round((new Date(d).getTime() - Date.now()) / 86400000); };
// H-10: was inline hex duplicated from the shared palette (SEMANTIC.danger/warn/ok are
// the exact same values). Not routed through statusColor()/STATUS_COLOR — the middle
// case's label is a dynamic "{n}d" countdown, not a fixed status word, so a name-based
// lookup can't resolve it; the fix here is sourcing the TOKENS, not the lookup table.
const expiryBadge = (d) => { const n = daysUntil(d); if (n === null) return null; if (n < 0) return { t: 'Expired', c: SEMANTIC.danger }; if (n <= 30) return { t: `${n}d`, c: SEMANTIC.warn }; return { t: 'Valid', c: SEMANTIC.ok }; };
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

/**
 * Compact Indian money for a narrow stat card: 71,35,25,920 -> "71.35 Cr".
 * The card is ~120px wide. A full rupee figure does not fit, and because the value had
 * no `whitespace-nowrap` it WRAPPED MID-NUMBER — the screenshot showed "₹71,35,2 / 5,92
 * / 0" stacked over three lines, which is not just ugly, it is unreadable as a number.
 * The exact value stays available in the title attribute.
 */
function compactINR(v) {
  const cleaned = String(v ?? '').replace(/[^0-9.-]/g, '');
  // Number('') === 0, so without this a placeholder ('—') or a missing stat would print
  // a confident "₹0" — a fake figure is worse than a blank one.
  if (!/\d/.test(cleaned)) return v;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return v;
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return `₹${Math.round(n)}`;
}

// Module-scoped view state — a plain JS-module-level object, NOT sessionStorage-backed.
// Restored across tab-switch unmounts (the module stays loaded, so this object keeps its
// values while the user is elsewhere) — preserves search/filters/sort/pagination/selected
// vehicle/drawer tab/scroll as useful in-app navigation memory. Deliberately does NOT
// survive a real browser reload: the JS module re-evaluates from scratch then, resetting
// this back to defaultVehView() — a reload should show fresh data at a sane default view,
// not silently resurrect whichever vehicle/search/page/scroll was left over from before.
// (Navigation State + Data Freshness review — this used to also mirror into sessionStorage
// specifically so a Browser Refresh restored it too; that was the bug the brief flagged,
// not a feature — removed, not just unused, so it can't quietly return.)
const defaultVehView = () => ({ q: '', makeF: 'All', fuelF: 'All', statusF: 'All', quickF: null, sortBy: 'latest', page: 1, perPage: 25, selId: null, detailTab: 'Overview', scrollY: 0 });
const vehiclesViewState = defaultVehView();

function Stat({ icon: Icon, label, value, color, active, onClick, title }) {
  const text = String(value ?? '');
  // Shrink a step for values that still cannot fit, rather than letting them wrap.
  const size = text.length > 12 ? 'text-sm' : text.length > 9 ? 'text-base' : 'text-lg';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title || undefined}
      aria-pressed={!!active}
      className="rounded-2xl p-3.5 flex items-center gap-3 text-left transition active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]/60"
      style={{ ...cardStyle, ...(active ? { borderColor: 'rgba(212,175,55,0.5)', background: 'rgba(212,175,55,0.06)' } : {}) }}
    >
      <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${color}1f`, color }}><Icon size={18} /></span>
      <div className="min-w-0 flex-1">
        {/* Was `truncate`, which produced "TOTAL…", "IN SER…", "REVE…" — labels the user
            cannot read. They are two or three short words; let them wrap to a second line. */}
        <p className="text-[10px] uppercase tracking-wide text-white/45 leading-tight">{label}</p>
        {/* whitespace-nowrap + tabular-nums: a number must never break across lines. */}
        <p className={`${size} font-bold text-white leading-tight whitespace-nowrap tabular-nums`}>{value}</p>
      </div>
    </button>
  );
}
// Was a LOCAL `function MiniSelect` here, shadowing the shared
// components/common/MiniSelect.jsx import for this entire file — meaning every
// Manufacturer/Model/Variant/Fuel/Transmission/Make-filter dropdown in Vehicles was
// running a separate, subtly buggy implementation, never the shared one. Its outside-
// click handler used `document.addEventListener('mousedown', ...)` checking only
// `ref.current.contains(e.target)` — but the dropdown panel is rendered through a
// PORTAL into <body> (DropdownPanel), so it is never a DOM descendant of `ref`. Every
// mousedown on an option button was therefore treated as "outside" and closed the
// panel — and because that unmounts the option button before its own click event can
// fire, the click fell through to whatever was now underneath, which (confirmed live)
// was the modal's own backdrop, silently closing the ENTIRE Add/Edit Vehicle wizard
// instead of picking a manufacturer. The shared MiniSelect fixes this correctly (its
// outside-close checks both the anchor AND the portalled panel). Deleted the local
// copy and wired Cascade to the shared one via WField (which already renders the
// same label style used everywhere else in this file).
function Cascade({ make, model, variant, onChange }) {
  const variants = variantsFor(make);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <VehicleMakeModelSelect
        make={make}
        model={model}
        onPickMake={(m) => onChange({ make: m, model: '', variant: '' })}
        onPickModel={(m) => onChange({ model: m })}
        onAddMake={(v) => onChange({ make: v, model: '', variant: '' })}
        onAddModel={(v) => onChange({ model: v })}
        makeLabel="Manufacturer" modelLabel="Model" makeReq modelReq
        makePlaceholder="Select make" modelPlaceholder="Select model" modelDisabledPlaceholder="Make first"
        className="contents"
        renderField={(label, req, children) => <WField label={label} req={req}>{children}</WField>}
      />
      <WField label="Variant"><MiniSelect value={variant} placeholder="Variant" options={variants} onPick={(v) => onChange({ variant: v })} onAdd={(v) => onChange({ variant: v })} /></WField>
    </div>
  );
}
function WField({ label, req, error, children, className = '' }) {
  return <div className={`min-w-0 ${className}`}><label className="block text-[10px] uppercase tracking-wide text-white/45 mb-1.5">{label}{req && <span className="text-red-400"> *</span>}</label>{children}{error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}</div>;
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

function VehicleWizard({ initial, customers = [], existingVehicles = [], onSave, onClose, onQuickCustomer, demoMode = false, initialStep = null }) {
  // Seed customerId from the row-derived ownerId so the owner picker reflects the
  // current owner when editing (prevents "no owner selected" + save data-loss).
  // Normalize up-front so every optional collection/object is guaranteed present.
  // This is the single source of the crash fix: the form below can use f.photos,
  // f.documents, etc. directly without defensive checks.
  const [f, setF] = useState(() => normalizeVehicle({ ...initial, customerId: initial.customerId || initial.ownerId || '' }));
  // Defect #57 (reopened) — Issue B: deep-linking into this wizard. Kept as a plain
  // key-order array (not derived from the STEPS array below, which is rebuilt every
  // render because its Photos label embeds a live count) so resolving `initialStep`
  // doesn't depend on render timing. Unknown/omitted keys fall back to index 0
  // (Vehicle/Overview) — every existing caller that doesn't pass initialStep keeps
  // today's exact behaviour.
  const STEP_KEYS = ['vehicle', 'identity', 'owner', 'insurance', 'photos', 'documents', 'notes'];
  const [step, setStep] = useState(() => { const i = STEP_KEYS.indexOf(initialStep); return i === -1 ? 0 : i; });
  const [custQ, setCustQ] = useState('');
  const [custHi, setCustHi] = useState(0);
  const [custOpen, setCustOpen] = useState(false);
  const [quickCust, setQuickCust] = useState(null); // {name, phone} inline-create form, or null
  const set = (patch) => setF((s) => ({ ...s, ...patch }));
  const custRef = useRef(null);

  // H-7: draft autosave/restore + beforeunload protection — ported from the Add/Edit
  // Part pattern (InventoryDashboard.js:2369-2396). New-vehicle only. Namespaced by
  // environment so a Demo draft never appears in Production.
  const isNewVehicle = !initial.regNo;
  const DRAFT_KEY = `maruti_vehicle_draft_v1_${demoMode ? 'demo' : 'prod'}`;
  const initialFormRef = useRef(null);
  if (initialFormRef.current === null) initialFormRef.current = JSON.stringify(f);
  const [draftMeta, setDraftMeta] = useState(null);
  const dirty = useMemo(() => JSON.stringify(f) !== initialFormRef.current, [f]);
  const savingRef = useRef(false);
  // Double-submission guard — separate from savingRef above (which only signals "a real
  // save was attempted" for the draft-clear-on-unmount effect below and must keep that
  // exact meaning). saveLockRef is checked and set SYNCHRONOUSLY, before any await, so a
  // second rapid click/Ctrl+S sees the lock immediately rather than racing a `saving`
  // state update that hasn't flushed yet. Released in every case (success or failure) so
  // a failed save can always be retried. `saving` state only drives the button's loading
  // UI; `mountedRef` guards that state update since a SUCCESSFUL save unmounts this
  // wizard (parent calls setEdit(null)) before the awaited onSave() call returns here.
  const saveLockRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch {} setDraftMeta(null); };
  const restoreDraft = () => { if (draftMeta?.form) setF(draftMeta.form); setDraftMeta(null); };
  useEffect(() => {
    if (!isNewVehicle) return;
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (d?.form && String(d.form.regNo || '').trim()) setDraftMeta({ ts: d.ts, form: d.form });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!isNewVehicle) return undefined;
    if (!String(f.regNo || '').trim()) return undefined;
    const id = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ts: Date.now(), form: f })); } catch {}
    }, 600);
    return () => clearTimeout(id);
  }, [f, isNewVehicle]);
  useEffect(() => {
    if (!dirty) return undefined;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
  // Clears the draft ONLY when this wizard unmounts as a result of a save that the
  // parent confirmed succeeded (writeVehicle only unmounts us via onClose/setEdit(null)
  // after its own await resolves — see C-1). Cancel/Escape/backdrop-close never sets
  // savingRef, so the draft survives an abandoned edit for next time.
  useEffect(() => () => { if (savingRef.current) clearDraft(); }, []);
  // Outside-click/Escape is owned by the portalled <DropdownPanel> below (its own
  // useOutsideClose, checking both the anchor AND the portalled panel). A local
  // `mousedown` + ref.contains() check here is WRONG — the panel is portalled into
  // <body>, never a DOM descendant of `custRef` — every mousedown on a customer row
  // would be treated as "outside" and close the panel before the click could
  // register, the same bug already found and fixed in this file's Cascade/MiniSelect.
  // Never re-add it here.
  const submitQuickCust = async () => {
    const name = (quickCust.name || '').trim();
    if (!name) { toast.error('Customer name is required'); return; }
    // Same Indian-mobile rule as the full Customer wizard. Phone is optional here;
    // only validate (and normalize to a clean 10-digit number) when one is entered.
    const phone = quickCust.phone ? mobileInput(quickCust.phone) : '';
    if (phone && !isIndianMobile(phone)) { toast.error(MOBILE_ERROR); return; }
    if (phone && customers.some((c) => (c.phone || '').replace(/\D/g, '') === phone)) { toast.error('A customer with this phone already exists'); return; }
    const created = await onQuickCustomer?.({ name, phone });
    if (created && created.id) { set({ customerId: created.id }); setQuickCust(null); setCustOpen(false); setCustQ(''); toast.success(`${name} added and selected`); }
  };

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
  // Universal Search review: regKey/normId (not a hand-rolled .toUpperCase()) — the
  // uppercase-only check let "TS 09 EX 1234" and "TS09EX1234" register as two DIFFERENT
  // registrations (no space-strip), a weaker normalization than both Customers' own
  // equivalent duplicate check and lib/useSearch.js's shared identifier normalizer.
  const dupReg = f.regNo && existingVehicles.some((v) => v.id !== f.id && v.regNo && regKey(v.regNo) === regKey(f.regNo));
  const dupVin = f.vin && existingVehicles.some((v) => v.id !== f.id && v.vin && normId(v.vin) === normId(f.vin));
  const dupEngine = f.engineNo && existingVehicles.some((v) => v.id !== f.id && v.engineNo && normId(v.engineNo) === normId(f.engineNo));
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
    if (f.agentPhone && !isIndianMobile(f.agentPhone)) { setStep(3); return `Insurance agent phone: ${MOBILE_ERROR.toLowerCase()}`; }
    return null;
  };
  const save = async () => {
    if (saveLockRef.current) return; // already in flight — a second Enter/Ctrl+S/click is a no-op, not a second write
    const err = validate();
    if (err) return toast.error(err);
    saveLockRef.current = true;
    savingRef.current = true; // H-7: only a real save attempt clears the draft on unmount
    setSaving(true);
    try {
      await onSave({ ...f, regNo: f.regNo.toUpperCase(), model: f.model, vehicle: combinedModel(f) });
    } finally {
      saveLockRef.current = false;
      // On success the parent has already unmounted us (setEdit(null)) before this
      // resolves; on failure we're still here and need the button re-enabled to retry.
      if (mountedRef.current) setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });

  const owner = customers.find((c) => c.id === f.customerId);
  // Universal Search review: Customer ID + every owned vehicle's reg no. are exact-
  // then-partial identifiers via rankIndexed, not folded into one flat substring-matched
  // string — this is the THIRD independent "search existing customer" implementation in
  // the app (alongside the Customers module's own list and Job Cards' CustomerSearch),
  // now sharing the same matching primitive as both of those.
  const ownerSearchIndex = useSearchIndex(customers, (c) => c.id, (c) => [c.name, c.phone], (c) => [c.code, ...(c.vehicles || []).map((v) => v.regNo)]);
  const custShown = useMemo(() => (custQ.trim() ? customers.filter((c) => matchIndexed(ownerSearchIndex.get(c.id), custQ)) : customers), [custQ, customers, ownerSearchIndex]);
  useEffect(() => { setCustHi(0); }, [custQ, custOpen]);
  const custListRef = useRef(null);
  useEffect(() => { const el = custListRef.current?.children?.[custHi]; if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }, [custHi]);

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

  // Issue 1 (Add Vehicle popup architecture review) — see ModalBoundaryContext.Provider below.
  const modalRef = useRef(null);

  // #49 (reopened again): the dvh height-cap comment below solved the overlay-scroll
  // mechanism, but a second, independent bug hid behind it — this wizard rendered as a
  // plain DOM descendant of <main> (InventoryDashboard.js, `relative z-10`, a real
  // stacking context). A z-index only outranks elements OUTSIDE its own stacking context
  // if the context itself outranks theirs — this modal's z-[120] was being compared at
  // the wrong level (<main>'s z-10 vs the app header/bottom-nav's z-90), so once the
  // wizard grew tall enough for its own header/footer to reach the app chrome's screen
  // region, the app chrome painted on top of it. Same root cause and fix already proven
  // for CustomersModule's CustomerWizard/VehicleModal and InventoryDashboard's
  // LedgerPage: portal straight to document.body, escaping <main>'s stacking context
  // entirely instead of trying to out-rank it from inside.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      {/* #49: see CustomersModule CustomerWizard — same root-cause fix. Non-scrolling
          overlay; modal is a fixed-height flex box capped to the viewport so header/footer
          (flex-shrink-0) stay pinned and only the body scrolls, at any content height. */}
      {/* Issue 1 (Add Vehicle popup architecture review) — this wizard used to have no
          ref at all, so every Fuel/Transmission/Variant/Owner dropdown inside it fell
          back to full-viewport positioning math and could render past this panel's own
          edge. modalRef + ModalBoundaryContext clamp every dropdown rendered anywhere
          in this subtree to this panel's actual rect, automatically. */}
      <div ref={modalRef} data-modal-panel="" className="w-full sm:max-w-3xl h-[100dvh] sm:h-auto max-h-[100dvh] sm:max-h-[calc(100dvh-2rem)] flex flex-col rounded-t-2xl sm:rounded-2xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
      <ModalBoundaryContext.Provider value={modalRef}>
        <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
          <h3 className="text-base font-bold text-white">{initial.regNo ? `Edit ${initial.regNo}` : 'Add Vehicle'}</h3>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10"><X size={17} /></button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col sm:flex-row">
          <div className="sm:w-44 flex-shrink-0 flex sm:flex-col gap-1 p-3 overflow-x-auto sm:overflow-visible" style={{ borderRight: '1px solid rgba(var(--fg-rgb),0.06)' }}>
            {STEPS.map((s, i) => (
              <button key={s.key} type="button" onClick={() => setStep(i)} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition ${step === i ? 'text-[#d4af37]' : 'text-white/55 hover:text-white/90 hover:bg-white/5'}`} style={step === i ? { background: 'rgba(212,175,55,0.1)' } : undefined}><s.icon size={14} /> {s.label}</button>
            ))}
          </div>
          <div className="flex-1 min-w-0 overflow-y-auto dark-scroll p-5">
            {draftMeta && isNewVehicle && (
              <div className="rounded-xl p-3 mb-3 flex items-center gap-3 flex-wrap" style={{ background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.3)' }}>
                <span className="text-xs text-white/75 flex-1 min-w-[140px]">Unsaved draft{draftMeta.ts ? ` from ${new Date(draftMeta.ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ''} found.</span>
                <button type="button" onClick={restoreDraft} className="h-8 px-3 rounded-lg text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] active:scale-95">Restore</button>
                <button type="button" onClick={clearDraft} className="h-8 px-3 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-white/70 active:scale-95">Discard</button>
              </div>
            )}
            {step === 0 && (
              <div className="space-y-3">
                <WField label="Registration Number" req error={regErr || (dupReg ? 'Already exists' : null)}><input value={f.regNo} onChange={(e) => set({ regNo: e.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, '').slice(0, 13) })} placeholder="TS09EX1234" className={inputCls} /></WField>
                <Cascade make={f.make} model={f.model} variant={f.variant} onChange={set} />
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <WField label="Fuel"><MiniSelect value={f.fuel || 'Petrol'} placeholder="Fuel" options={FUELS} onPick={(t) => { const v = t || 'Petrol'; set({ fuel: v, isEV: v === 'Electric' }); }} /></WField>
                  <WField label="Transmission"><MiniSelect value={f.transmission || 'Manual'} placeholder="Transmission" options={TRANSMISSIONS} onPick={(t) => set({ transmission: t || 'Manual' })} /></WField>
                  <WField label="Year"><input value={f.year} inputMode="numeric" onChange={(e) => set({ year: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="2021" className={inputCls} /></WField>
                  <WField label="Color"><input value={f.color} onChange={(e) => set({ color: e.target.value })} placeholder="White" className={inputCls} /></WField>
                  {/* Universal dropdown architecture review — these were native <select>
                      elements, the one field type this app can't theme, position, or
                      contain (the browser owns the popup entirely, outside any of our
                      ModalBoundaryContext/DropdownPanel logic — see MiniSelect.jsx and the
                      Supplier Type / Customer Type precedents this mirrors). Right next to
                      Fuel/Transmission, already MiniSelect, they read as a foreign popup
                      breaking out of this wizard's contained dark UI. Same catalog values. */}
                  <WField label="Body Type"><MiniSelect value={f.bodyType} placeholder="—" options={BODY_TYPES} onPick={(v) => set({ bodyType: v })} /></WField>
                  <WField label="Drive Type"><MiniSelect value={f.driveType} placeholder="—" options={DRIVE_TYPES} onPick={(v) => set({ driveType: v })} /></WField>
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
                      <span className={owner ? 'text-white' : 'text-white/45'}>{owner ? `${owner.name} · ${owner.phone}` : 'Select customer…'}</span><ChevronDown size={14} className="text-white/45" />
                    </button>
                    {custOpen && (
                      <DropdownPanel anchorRef={custRef} open onClose={() => { setCustOpen(false); setCustQ(''); }} scroll={false}
                        style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        <div className="relative p-2" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.07)', flex: '0 0 auto' }}>
                          <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/45" />
                          <input autoFocus value={custQ} onChange={(e) => setCustQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setCustHi((h) => Math.min(h + 1, custShown.length - 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setCustHi((h) => Math.max(h - 1, 0)); } else if (e.key === 'Enter') { e.preventDefault(); const c = custShown[custHi]; if (c) { set({ customerId: c.id }); setCustOpen(false); setCustQ(''); } } }} placeholder="Search name, ID, phone or reg no…" className="w-full pl-8 pr-2 py-2 rounded-lg text-sm bg-white/5 border border-white/10 text-white outline-none" />
                        </div>
                        <div ref={custListRef} className="overflow-y-auto dark-scroll" style={{ flex: '1 1 auto' }}>
                          {custShown.map((c, i) => <button key={c.id} type="button" onMouseEnter={() => setCustHi(i)} onClick={() => { set({ customerId: c.id }); setCustOpen(false); setCustQ(''); }} className={`w-full text-left px-3 py-2 ${i === custHi ? 'bg-white/10' : 'hover:bg-white/5'}`}><p className="text-sm text-white/85">{c.name}</p><p className="text-[10px] text-white/45">{c.code} · {c.phone}</p></button>)}
                          {custShown.length === 0 && <p className="px-3 py-3 text-xs text-white/45">No customers found.</p>}
                        </div>
                        {onQuickCustomer && <button type="button" onClick={() => { setQuickCust({ name: /^\d+$/.test(custQ.trim()) ? '' : custQ.trim(), phone: /^\d+$/.test(custQ.trim()) ? custQ.trim() : '' }); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-bold text-[#d4af37] hover:bg-white/5" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.07)', flex: '0 0 auto' }}><Plus size={13} /> Create New Customer</button>}
                      </DropdownPanel>
                    )}
                  </div>
                </WField>
                {quickCust && (
                  <div className="fixed inset-0 z-[130] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setQuickCust(null)}>
                    <div className="w-full max-w-sm rounded-2xl p-5" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
                      <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><User size={15} className="text-[#d4af37]" /> New Customer</h4>
                      <p className="text-[11px] text-white/45 mb-3">Your vehicle entry is preserved — this only adds the owner.</p>
                      <label className="block text-[10px] uppercase tracking-wide text-white/45 mb-1">Name *</label>
                      <input autoFocus value={quickCust.name} onChange={(e) => setQuickCust((s) => ({ ...s, name: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') submitQuickCust(); }} placeholder="Customer name" className={`${inputCls} mb-3`} />
                      <label className="block text-[10px] uppercase tracking-wide text-white/45 mb-1">Phone</label>
                      <input value={quickCust.phone} onChange={(e) => setQuickCust((s) => ({ ...s, phone: e.target.value.replace(/[^\d+\-\s]/g, '') }))} onKeyDown={(e) => { if (e.key === 'Enter') submitQuickCust(); }} placeholder="Phone number" className={`${inputCls} mb-4`} />
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => setQuickCust(null)} className="h-10 rounded-xl text-xs font-bold bg-white/5 border border-white/10 text-white/80">Cancel</button>
                        <button type="button" onClick={submitQuickCust} className="h-10 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">Add &amp; Select</button>
                      </div>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <WField label="Vehicle Nickname"><input value={f.nickname} onChange={(e) => set({ nickname: e.target.value })} placeholder="e.g. Office car" className={inputCls} /></WField>
                  <WField label="Ownership Type"><MiniSelect value={f.ownershipType} placeholder="Select ownership type" options={OWNERSHIP_TYPES} emptyValue={OWNERSHIP_TYPES[0]} onPick={(v) => set({ ownershipType: v || OWNERSHIP_TYPES[0] })} /></WField>
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
                <WField label="Agent Phone" error={f.agentPhone && !isIndianMobile(f.agentPhone) ? MOBILE_ERROR : null}><input value={f.agentPhone} inputMode="numeric" onChange={(e) => set({ agentPhone: mobileInput(e.target.value) })} className={inputCls} /></WField>
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
                    <label className="w-20 h-20 rounded-lg flex flex-col items-center justify-center cursor-pointer text-white/45 hover:text-white/70 transition" style={{ border: '1px dashed rgba(var(--fg-rgb),0.45)' }}>
                      <Camera size={16} /><span className="text-[8px] mt-0.5">Add</span>
                      <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />
                    </label>
                  )}
                </div>
                <p className="text-[10px] text-white/45 mt-2">Suggested angles: front, rear, left, right, interior, dashboard, odometer, engine bay, boot, roof, existing damages.</p>
              </div>
            )}
            {step === 5 && (
              <div>
                <p className="text-[11px] text-white/45 mb-2">Upload RC, Insurance, PUC, Invoice, Warranty, Fastag, Emission (PDF or image, max 10MB).</p>
                <div className="space-y-1.5 mb-3">
                  {f.documents.map((d, di) => (
                    <div key={di} className="flex items-center justify-between px-3 py-2 rounded-xl text-xs" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                      <span className="text-white/80 truncate flex items-center gap-2"><FileText size={13} className="text-white/45" /> {d.name}</span>
                      <div className="flex gap-2 flex-shrink-0">
                        <a href={d.data} download={d.name} className="text-white/50 hover:text-white"><FileDown size={13} /></a>
                        <button type="button" onClick={() => set({ documents: f.documents.filter((_, x) => x !== di) })} className="text-red-400/60 hover:text-red-400"><Trash2 size={13} /></button>
                      </div>
                    </div>
                  ))}
                  {f.documents.length === 0 && <p className="text-xs text-white/45 text-center py-3">No documents uploaded.</p>}
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
          <button onClick={onClose} disabled={saving} className="py-3 px-5 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80 disabled:opacity-40">Cancel</button>
          <div className="flex gap-2">
            {step > 0 && <button onClick={() => setStep((s) => s - 1)} disabled={saving} className="py-3 px-5 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80 disabled:opacity-40">Back</button>}
            {step < STEPS.length - 1 ? <button onClick={() => setStep((s) => s + 1)} className="py-3 px-6 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">Next</button>
              : <button onClick={save} disabled={saving} aria-busy={saving} className="py-3 px-6 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] disabled:opacity-40">{saving ? 'Saving…' : 'Save Vehicle'}</button>}
          </div>
        </div>
      </ModalBoundaryContext.Provider>
      </div>
    </div>,
    document.body
  );
}

export default function VehiclesModule({ reminderDays = DEFAULT_REMINDER_DAYS, demoMode = false, demoCanDelete = false, demoCanExport = true, canManage = true, isAdmin = false, customers = [], jobCards = [], invoices = [], setCustomers, onCreateJobCard, onCreateInvoice, onOpenJobCard, onOpenInvoice, onOpenCustomer, onViewJobCards, onViewInvoices, onViewDocuments, onAudit, actorEmail }) {
  const { t } = useTranslation();
  const VV = vehiclesViewState;
  const [q, setQ] = useState(VV.q);
  const [dq] = useDeferredSearch(q);
  const [makeF, setMakeF] = useState(VV.makeF);
  const [fuelF, setFuelF] = useState(VV.fuelF);
  const [statusF, setStatusF] = useState(VV.statusF);
  const [quickF, setQuickF] = useState(VV.quickF);
  const [sortBy, setSortBy] = useState(VV.sortBy);
  const [page, setPage] = useState(VV.page);
  const [perPage, setPerPage] = useState(VV.perPage);
  const [selId, setSelId] = useState(VV.selId);
  const [edit, setEdit] = useState(null);
  // Defect #57 (reopened), Issue A/B — every Details-panel action that should land on
  // a SPECIFIC part of Edit Vehicle (Upload Document -> Documents, Edit/Renew
  // Insurance -> Insurance) was calling bare setEdit(selected), which always opens
  // VehicleWizard at its default step (Overview) — the exact "everything routes to
  // the same default entry point" bug. editSection carries the target step KEY
  // alongside `edit`; openEdit() is the one place that sets both together so no call
  // site can update one without the other. Plain "Edit Vehicle" / row-level edit
  // buttons call openEdit(v) with no section (stays on Overview — unchanged).
  const [editSection, setEditSection] = useState(null);
  const openEdit = (vehicle, section = null) => { setEdit(vehicle); setEditSection(section); };
  const [detailTab, setDetailTab] = useState(VV.detailTab || 'Overview');
  const [menuFor, setMenuFor] = useState(null);
  // Issue 2/2.1 (Customers/Vehicles selection-architecture review) — Vehicles had no
  // row-selection or bulk-action capability at all; Customers already had a working,
  // shared-shape implementation (selectedIds Set + page-scoped select-all + an
  // active/archived-aware bulk bar). Rather than inventing a second, independent
  // selection model, this is a straight port of Customers' exact state shape and
  // helpers — same semantics, same page-scoping, same clear/toggle behavior — so the
  // two modules can't drift into different selection behaviors again.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  // Stable per-row anchor ref for the "More actions" menu, portalled via DropdownPanel
  // — matches the Customers module's pattern so every row-action menu in the app shares
  // one positioning implementation instead of a hand-rolled `absolute` div per module.
  const rowMenuAnchorRefs = useRef(new Map());
  const rowMenuAnchorRef = (id) => {
    if (!rowMenuAnchorRefs.current.has(id)) rowMenuAnchorRefs.current.set(id, { current: null });
    return rowMenuAnchorRefs.current.get(id);
  };
  const [addNoteFor, setAddNoteFor] = useState(null); // vehicle being annotated, or null
  const [noteText, setNoteText] = useState('');
  const [historyFor, setHistoryFor] = useState(null); // vehicle whose full history is shown, or null
  const vDidMount = useRef(false);
  useEffect(() => { VV.q = q; VV.makeF = makeF; VV.fuelF = fuelF; VV.statusF = statusF; VV.quickF = quickF; VV.sortBy = sortBy; VV.page = page; VV.perPage = perPage; VV.selId = selId; VV.detailTab = detailTab; }, [q, makeF, fuelF, statusF, quickF, sortBy, page, perPage, selId, detailTab]);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (VV.scrollY) appScrollTo({ top: VV.scrollY });
    return () => { VV.scrollY = appScrollY() || 0; };
  }, []);

  // debounce search
  // Was a 250ms setTimeout debounce. It never helped: the filter was O(n·m) and took
  // 36 SECONDS, so debouncing merely delayed the freeze. Now the filter is 0.22ms, and
  // useDeferredValue keeps typing urgent while the list renders interruptibly — with no
  // artificial delay on the results.
  useEffect(() => { if (vDidMount.current) setPage(1); else vDidMount.current = true; }, [dq, makeF, fuelF, statusF, quickF, sortBy]);
  useEffect(() => { const onDoc = () => setMenuFor(null); document.addEventListener('click', onDoc); return () => document.removeEventListener('click', onDoc); }, []);

  const rows = useMemo(() => {
    const out = [];
    customers.forEach((c) => (c.vehicles || []).forEach((v) => out.push(normalizeVehicle({ ...v, ownerId: c.id, owner: c.name, ownerCode: c.code, ownerPhone: c.phone, ownerType: c.type }))));
    return out;
  }, [customers]);

  // Deep-link: "View Vehicle" opened this tab — open the exact vehicle directly, the
  // same pendingXOpen/xOpenDone pattern already used by Customers/Job Cards/Billing.
  // The previous version only called setQ(reg), leaving the user looking at a filtered
  // LIST rather than the vehicle's own record — and relied on search ranking to even
  // surface the right row. The token must only be cleared once resolved (found, or
  // confirmed absent once `rows` has data), never on the initial read — otherwise a
  // throwaway first mount (React Strict Mode, or an ordinary render race) can consume
  // and delete the one-shot token before `customers`/`rows` has loaded.
  const pendingVehOpen = useRef(null);
  const vehOpenDone = useRef(false);
  if (pendingVehOpen.current === null) {
    try { pendingVehOpen.current = localStorage.getItem('maruti_vehicles_open') || ''; } catch { pendingVehOpen.current = ''; }
  }
  useEffect(() => {
    const key = pendingVehOpen.current;
    if (!key || vehOpenDone.current) return;
    const norm = (r) => (r || '').toUpperCase().replace(/\s+/g, '');
    const match = rows.find((r) => norm(r.regNo) === norm(key));
    if (match) {
      vehOpenDone.current = true;
      setSelId(match.id);
      setDetailTab('Overview');
      setQ(key);
      try { localStorage.removeItem('maruti_vehicles_open'); } catch {}
    } else if (rows.length) {
      // data loaded but no match — at least filter, and stop retrying
      vehOpenDone.current = true;
      setQ(key);
      try { localStorage.removeItem('maruti_vehicles_open'); } catch {}
    }
  }, [rows]);

  // PERFORMANCE: jcOf()/invOf() used to rescan the FULL job-card and invoice arrays for
  // every vehicle — inside filters and inside sort comparators, on every render. That is
  // 350 vehicles × 2,529 records, repeatedly. Index once per data change instead.
  // The reminder window is a SETTING, not a magic 30 hard-coded in four places.
  const REMINDER_DAYS = Number(reminderDays) || DEFAULT_REMINDER_DAYS;

  // The stats block collapses so the vehicle table starts near the top. Remembered, so
  // an owner who never wants to see KPIs never sees them again.
  const [statsOpen, setStatsOpen] = useState(false);
  // ADDITIONAL ISSUE (reopened) — Details Panel baseline alignment. Root cause: the
  // Details Panel is `xl:sticky`, so its rendered top is wherever ITS OWN column
  // (this whole xl:flex-[2_1_0%] block) starts — that part was already correct and
  // shared with Customers (see DetailsPanel.jsx's default `topOffset="1rem"`).
  // Customers' column has nothing before its Stat cards, so "column top" and "first
  // KPI row's top" are the same point — no offset needed, matches today's default.
  // Vehicles' column has this "Compliance · next N days" header ABOVE its Stat
  // cards, so "column top" and "first KPI row's top" are NOT the same point here —
  // the panel (aligned to column top) lands 33px above the actual cards. Rather than
  // hardcode "33px" (a number that silently goes stale the moment this label's text,
  // font-size, or the app's spacing scale changes), this measures the header's own
  // rendered height live via ResizeObserver and feeds it to DetailsPanel's existing
  // topOffset prop — the SAME mechanism Customers implicitly uses (its default,
  // unmeasured value of "0 pixels of preceding content", i.e. topOffset="1rem"
  // as-is). One shared rule — "topOffset = height of whatever precedes the KPI row
  // in this module's own column" — evaluated per-module instead of copy-pasted as a
  // fixed number. See DetailsPanel.jsx's own comment history: a previous attempt to
  // reintroduce a topOffset here failed because it baked in a FULL TOOLBAR's height
  // (~300px, wildly larger than what was actually needed) as a hardcoded constant —
  // this is deliberately the opposite: small, measured, and scoped to exactly the
  // one element actually sitting above the KPI row.
  const complianceHeaderRef = useRef(null);
  const [panelTopOffset, setPanelTopOffset] = useState('1rem');
  useEffect(() => {
    const el = complianceHeaderRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    // getBoundingClientRect().height is the header's own border box — it does NOT
    // include its own margin-bottom (the mb-2 gap before the Stat cards), so that's
    // read separately via getComputedStyle rather than hardcoded as "8px" (mb-2's
    // pixel value) — if the Tailwind class on this element ever changes, this stays
    // correct with zero edits needed here.
    const measure = () => {
      const r = el.getBoundingClientRect();
      const mb = parseFloat(getComputedStyle(el).marginBottom) || 0;
      setPanelTopOffset(`${r.height + mb}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    try { setStatsOpen(localStorage.getItem('veh.statsOpen') === '1'); } catch { /* SSR / private mode */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem('veh.statsOpen', statsOpen ? '1' : '0'); } catch { /* ignore */ }
  }, [statsOpen]);

  const vIdx = useMemo(() => buildVehicleIndex(jobCards, invoices), [jobCards, invoices]);

  const jcOf = useCallback((v) => jobsOf(vIdx, v), [vIdx]);
  const invOf = useCallback((v) => invoicesOf(vIdx, v), [vIdx]);
  // Revenue is now gated by the billing engine's own isRealized() — the same gate that
  // decides whether an invoice may move stock or hit the ledger — so the Vehicles figure
  // agrees with Billing / Sales / Reports by construction. It used to sum raw qty×rate
  // over EVERY invoice in the system (see lib/vehicleStats.js).
  const revenueOf = useCallback((v) => vehicleRevenueOf(vIdx, v), [vIdx]);
  const visitsOf = useCallback((v) => completedVisitsOf(vIdx, v), [vIdx]);

  const makes = useMemo(() => ['All', ...Array.from(new Set(rows.map((r) => r.make).filter(Boolean))).sort()], [rows]);

  // ISSUE 1/7 — SEARCH. The haystack used to be rebuilt INSIDE the filter callback:
  // an array, a join and a toLowerCase for every one of 350 vehicles, on every
  // keystroke — and `invOf`/`jcOf` rescanned the full invoice and job-card arrays while
  // doing it. Measured at real data size: 36,442 ms per keystroke. Thirty-six seconds.
  // Built once per data change now; a keystroke is a substring test (0.03 ms).
  // GLOBAL SEARCH ACCURACY — STRICT VALIDATION. A record is only a match if the query
  // hits ONE OF THIS RECORD'S OWN configured searchable fields — never a linked-but-
  // different record's identifier. `ids` = THIS VEHICLE's own identifiers (Registration
  // No., VIN, Engine No., Chassis No., RC Number) — every one of these genuinely
  // identifies this vehicle, suffix-searchable (last 4 of a registration finds it).
  // `hay` = owner name/phone, make/model/variant, fuel, transmission, insurer, tags —
  // free text, ranked below every identifier.
  //
  // Deliberately NOT included: the owner's Customer ID, or this vehicle's linked
  // job-card/invoice numbers. An earlier version of this fix folded them in as a
  // separate, lower-ranked `refIds` band — reproduced live and rejected: this app
  // numbers Job Cards "SBBMC123", the SAME text shape as a Customer ID/RC number, so a
  // vehicle whose OWN registration/VIN had nothing to do with the query could still
  // surface merely because ONE OF ITS OWN JOB CARDS happened to be numbered like a
  // different record's identifier. A query that does not match this vehicle's OWN
  // configured fields must return zero, full stop.
  const searchIndex = useSearchIndex(
    rows,
    (r) => r.id,
    (r) => [r.owner, r.ownerPhone, r.make, r.model, r.variant, r.fuel, r.transmission, r.insurer, r.tags],
    (r) => [r.regNo, r.vin, r.engineNo, r.chassisNo, r.rcNumber],
    [vIdx],
  );

  const filtered = useMemo(() => {
    const ql = dq.trim().toLowerCase();
    let list = rows.filter((r) => {
      if (makeF !== 'All' && r.make !== makeF) return false;
      if (fuelF !== 'All' && r.fuel !== fuelF) return false;
      if (statusF !== 'All' && (r.status || 'Active') !== statusF) return false;
      // These MUST be the same predicates the KPI cards counted with, or clicking a card
      // shows a different set of rows than the number it displayed. Same functions, one
      // source of truth — see lib/vehicleStats.js.
      if (quickF === 'inService' && !isInService(vIdx, r)) return false;
      if (quickF === 'insurance' && !isExpiring(r.insuranceExpiry, REMINDER_DAYS)) return false;
      if (quickF === 'puc' && !isExpiring(r.pucExpiry, REMINDER_DAYS)) return false;
      if (quickF === 'warranty' && !isExpiring(r.warrantyExpiry, REMINDER_DAYS)) return false;
      if (quickF === 'fleet' && !(r.ownershipType === 'Fleet' || r.isFleet === true)) return false;
      if (quickF === 'active' && !isActive(r)) return false;
      if (quickF === 'repeat' && visitsOf(r) < 2) return false;
      if (!ql) return true;
      return matchIndexed(searchIndex.get(r.id), dq);
    });
    // SORT: revenueOf/visitsOf inside a comparator is a hidden O(n log n × m) — the
    // comparator is called ~n·log n times, and each call rescanned the invoices. Compute
    // each row's sort key ONCE, then sort on the number.
    const keyFns = { visits: visitsOf, revenue: revenueOf };
    const sorters = {
      latest: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
      oldest: (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
      lastService: (a, b) => (b.lastService || '').localeCompare(a.lastService || ''),
      upcoming: (a, b) => (a.nextServiceDate || '9999').localeCompare(b.nextServiceDate || '9999'),
    };
    const baseSort = keyFns[sortBy]
      ? (arr) => arr.map((r) => ({ r, k: keyFns[sortBy](r) })).sort((a, b) => b.k - a.k).map((x) => x.r)
      : (arr) => [...arr].sort(sorters[sortBy] || sorters.latest);
    // When searching, relevance ranking wins; the chosen sort is the tie-breaker so exact
    // matches on unique identifiers (reg/VIN/chassis) always surface first. Ranks against
    // the SAME searchIndex the filter above just used — previously this ranked against a
    // separate, smaller field list via the older `rankMatch` (no own-vs-linked-identifier
    // priority, no suffix tier), so a row could pass the filter via one field but be
    // ranked as if it matched a completely different, weaker one.
    if (ql) {
      const ranked = baseSort(list);
      return ranked
        .map((r, i) => ({ r, rank: rankIndexed(searchIndex.get(r.id), dq), i }))
        .sort((a, b) => b.rank - a.rank || a.i - b.i)
        .map((x) => x.r);
    }
    return baseSort(list);
  }, [rows, dq, makeF, fuelF, statusF, quickF, sortBy, vIdx, searchIndex, REMINDER_DAYS]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  // Clamp synchronously: filters recompute `filtered` this render, but the setPage(1)
  // reset runs in a post-render effect — so without this clamp `paged` would slice with a
  // stale out-of-range page for one frame ("No records" flash). Never slice past the end.
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * perPage, safePage * perPage);
  const selected = useMemo(() => rows.find((r) => r.id === selId) || null, [rows, selId]);
  // Drop ids for vehicles that no longer exist (e.g. deleted, or its owning customer
  // removed) so the "N selected" count and bulk actions never reference a stale,
  // invisible row — same safeguard Customers already has for its own selection.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const liveIds = new Set(rows.map((r) => r.id));
      const next = new Set([...prev].filter((id) => liveIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  // Select-all/clear operate on the current page only — selections on other pages are
  // untouched (and remain checked when the user pages back to them), since selectedIds
  // is keyed by vehicle id, not row position. Identical semantics to Customers.
  const allPagedSelected = paged.length > 0 && paged.every((r) => selectedIds.has(r.id));
  const somePagedSelected = !allPagedSelected && paged.some((r) => selectedIds.has(r.id));
  const toggleSelectOne = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleSelectAllPaged = () => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (allPagedSelected) paged.forEach((r) => next.delete(r.id));
    else paged.forEach((r) => next.add(r.id));
    return next;
  });
  const clearSelection = () => setSelectedIds(new Set());
  // Issue 2.3 — bulk actions must be context-aware, not a fixed button set. A vehicle's
  // only lifecycle state that changes which bulk action makes sense is Archived vs not
  // (archiveVehicle's own binary toggle) — mirrors Customers' selArchiveMix exactly.
  const selArchiveMix = useMemo(() => {
    let active = 0, archived = 0;
    selectedIds.forEach((id) => { const r = rows.find((x) => x.id === id); if (r) (r.status === 'Archived' ? archived += 1 : active += 1); });
    return { active, archived };
  }, [selectedIds, rows]);
  const bBtn = 'h-7 px-2.5 rounded-lg font-semibold text-white/70 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white transition inline-flex items-center gap-1 whitespace-nowrap';
  // Issue 2.4 — same "invisible selection" gap as Customers, same fix: name it instead
  // of hiding it when a filter change leaves some selected vehicles out of view.
  const hiddenSelectedCount = useMemo(() => {
    let n = 0; selectedIds.forEach((id) => { if (!filtered.some((r) => r.id === id)) n += 1; }); return n;
  }, [selectedIds, filtered]);
  // Bulk equivalents of the per-row kebab actions (Archive/Restore, Delete) — same
  // persistence/confirm pattern as the single-row versions, applied to every selected
  // id in one pass. Deliberately NOT adding bulk Edit/Duplicate/Create Job Card/Create
  // Invoice: those are inherently single-target operations (Issue 2.2 — no hypothetical
  // or UI-filler bulk actions), and Export already exists at the page level below.
  const bulkArchiveVehicles = async (willArchive) => {
    const ids = new Set(Array.from(selectedIds).filter((id) => {
      const r = rows.find((x) => x.id === id);
      return r && (r.status === 'Archived') !== willArchive;
    }));
    if (ids.size === 0) return;
    if (!await confirmDialog({
      title: willArchive ? `Archive ${ids.size} vehicle${ids.size > 1 ? 's' : ''}?` : `Restore ${ids.size} vehicle${ids.size > 1 ? 's' : ''}?`,
      message: willArchive ? 'Archived vehicles are hidden from the default list but kept in full, and can be restored anytime.' : 'These vehicles will return to the active list.',
    })) return;
    const affected = Array.from(ids).map((id) => rows.find((x) => x.id === id)).filter(Boolean);
    try {
      await setCustomers((prev) => prev.map((c) => ({
        ...c,
        vehicles: (c.vehicles || []).map((v) => (ids.has(v.id) ? { ...v, status: willArchive ? 'Archived' : 'Active' } : v)),
      })));
    } catch (e) { return; }
    clearSelection();
    toast.success(willArchive ? `${ids.size} vehicle${ids.size > 1 ? 's' : ''} archived` : `${ids.size} vehicle${ids.size > 1 ? 's' : ''} restored`);
    affected.forEach((v) => onAudit?.({ action: willArchive ? 'Vehicle Archived' : 'Vehicle Restored', entity: 'Vehicle', entityId: v.regNo || v.id, detail: v.regNo || '' }));
  };
  const bulkDeleteVehicles = async () => {
    if (demoMode && !demoCanDelete) { notify.permissionDenied('This action has been disabled by the administrator.'); return; }
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!await confirmDialog({ title: `Delete ${ids.length} vehicle${ids.length > 1 ? 's' : ''}?`, message: 'This cannot be undone.', danger: true, confirmText: 'Delete' })) return;
    const idSet = new Set(ids);
    const affected = ids.map((id) => rows.find((x) => x.id === id)).filter(Boolean);
    try {
      await setCustomers((prev) => prev.map((c) => ({ ...c, vehicles: (c.vehicles || []).filter((v) => !idSet.has(v.id)) })));
    } catch (e) { return; }
    if (selId && idSet.has(selId)) setSelId(null);
    clearSelection();
    notify.deleted(`${ids.length} vehicle${ids.length > 1 ? 's' : ''} deleted`);
    affected.forEach((v) => onAudit?.({ action: 'Vehicle Deleted', entity: 'Vehicle', entityId: v.regNo || v.id, detail: v.regNo || '' }));
  };

  // Every KPI now comes from ONE shared, tested module. See lib/vehicleStats.js for the
  // list of formulas that were wrong and why.
  const stats = useMemo(
    () => computeVehicleStats(rows, vIdx, { reminderDays: REMINDER_DAYS }),
    [rows, vIdx],
  );

  // Universal Notification Architecture review — both used to fire success (or, for
  // quickCreateCustomer, hand back a "created" record the caller treated as
  // confirmed) the instant setCustomers was CALLED, not after the write it returns
  // actually resolved — the same premature-success bug already fixed elsewhere in
  // this file (writeVehicle/archiveVehicle/deleteVehicle all await it). setCustomers
  // rejecting on failure already triggers its own shared error toast (persistDocsDiff),
  // so the catch here just returns null/no-op rather than duplicating that message.
  const quickCreateCustomer = async (data) => {
    if (!setCustomers) { toast.error('Cannot create in read-only mode'); return null; }
    // Boundary guard — the UI already validates, but no customer is ever persisted
    // with a phone that isn't a valid Indian mobile, whatever path called us.
    if (data.phone && !isIndianMobile(data.phone)) { toast.error(MOBILE_ERROR); return null; }
    const seq = customers.reduce((m, c) => Math.max(m, Number((c.code || '').replace(/\D/g, '')) || 0), 0) + 1;
    const created = {
      id: `c_${Date.now()}_${Math.floor(Math.random() * 1e4)}`,
      code: `SBBMC${String(seq).padStart(2, '0')}`,
      name: data.name, phone: data.phone ? mobileInput(data.phone) : '',
      type: 'Individual', vehicles: [], createdAt: Date.now(),
    };
    try { await setCustomers((prev) => [created, ...prev]); } catch (e) { return null; }
    return created;
  };

  const addNote = async (vehicle, text) => {
    const body = (text || '').trim();
    if (!body) { toast.error('Note cannot be empty'); return; }
    if (!setCustomers) { toast.error('Cannot save in read-only mode'); return; }
    const entry = { at: Date.now(), text: body, by: demoMode ? 'Demo User' : (actorEmail || 'Staff') };
    try {
      await setCustomers((prev) => prev.map((c) => (c.id === vehicle.ownerId
        ? { ...c, vehicles: (c.vehicles || []).map((x) => (x.id === vehicle.id ? { ...x, notesLog: [...(x.notesLog || []), entry] } : x)) }
        : c)));
    } catch (e) { return; }
    setAddNoteFor(null); setNoteText('');
    toast.success('Note added');
  };

  // C-1 fix: all three used to show success (and, for the edit form, close) the instant
  // setCustomers was CALLED, not after the write it triggers actually finished — a
  // rejected write looked identical to a successful one. setCustomers now returns the
  // real persistence promise (see InventoryDashboard.js), so these await it and only
  // complete on confirmed success; the shared persistence layer already shows its own
  // error toast on failure, so no local error toast is added here.
  const writeVehicle = async (v) => {
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
    const wasNew = !customers.find((c) => c.id === targetId)?.vehicles?.some((x) => x.id === v.id);
    try {
      await setCustomers((prev) => prev.map((c) => {
        // remove from the previous owner if the vehicle moved to a different customer
        if (c.id !== targetId) {
          if (c.id === prevOwnerId && prevOwnerId !== targetId) {
            return { ...c, vehicles: (c.vehicles || []).filter((x) => x.id !== v.id) };
          }
          return c;
        }
        const exists = (c.vehicles || []).some((x) => x.id === v.id);
        const hist = [...(v.history || [])];
        hist.push({ at: Date.now(), action: exists ? 'Vehicle Updated' : 'Vehicle Created', detail: v.regNo, by: demoMode ? 'Demo User' : (actorEmail || 'Staff') });
        const vehicles = exists
          ? c.vehicles.map((x) => (x.id === v.id ? { ...vv, history: hist } : x))
          : [...(c.vehicles || []), { ...vv, history: hist }];
        return { ...c, vehicles };
      }));
    } catch (e) { return; }
    setEdit(null);
    setEditSection(null);
    toast.success('Vehicle saved');
    onAudit?.({ action: wasNew ? 'Vehicle Created' : 'Vehicle Updated', entity: 'Vehicle', entityId: v.regNo || v.id, detail: `${v.regNo || ''} ${v.model || ''}`.trim() });
  };
  // Mutation-safety pass — no lock existed here either: a rapid double-click on the
  // Archive/Restore menu item fired onAudit twice for one toggle. Keyed by vehicle id.
  const archiveVehicleLock = useRef(new Set());
  const archiveVehicle = async (v) => {
    if (archiveVehicleLock.current.has(v.id)) return;
    archiveVehicleLock.current.add(v.id);
    try {
      await setCustomers((prev) => prev.map((c) => (c.id === v.ownerId ? { ...c, vehicles: (c.vehicles || []).map((x) => (x.id === v.id ? { ...x, status: x.status === 'Archived' ? 'Active' : 'Archived' } : x)) } : c)));
    } catch (e) { return; } finally {
      archiveVehicleLock.current.delete(v.id);
    }
    toast.success(v.status === 'Archived' ? 'Vehicle restored' : 'Vehicle archived');
    onAudit?.({ action: v.status === 'Archived' ? 'Vehicle Restored' : 'Vehicle Archived', entity: 'Vehicle', entityId: v.regNo || v.id, detail: v.regNo || '' });
  };
  const deleteVehicle = async (v) => {
    if (demoMode && !demoCanDelete) { notify.permissionDenied('This action has been disabled by the administrator.'); return; }
    if (!await confirmDialog({ title: `Delete ${v.regNo}?`, message: 'This cannot be undone.', danger: true, confirmText: 'Delete' })) return;
    try {
      await setCustomers((prev) => prev.map((c) => (c.id === v.ownerId ? { ...c, vehicles: (c.vehicles || []).filter((x) => x.id !== v.id) } : c)));
    } catch (e) { return; }
    if (selId === v.id) setSelId(null);
    notify.deleted('Vehicle deleted');
    onAudit?.({ action: 'Vehicle Deleted', entity: 'Vehicle', entityId: v.regNo || v.id, detail: v.regNo || '' });
  };
  const duplicateVehicle = (v) => { const copy = { ...emptyVehicle(), ...v, id: `v_${Date.now()}`, regNo: '', vin: '', history: [] }; openEdit(copy); };

  // Same ######## bug as the billing export, just never reported: Insurance Expiry and
  // PUC Expiry are DATES, and a CSV can carry neither cell types nor column widths.
  // These are the two columns a workshop actually sorts by, so inert text was the worst
  // possible format for them. One shared writer — see lib/exportSheet.js.
  const [exporting, setExporting] = useState(false);
  // Shared by both export formats — one row-building path, not two. The PDF exporter
  // (lib/pdfTheme.js) formats a raw Date object (asDate's return value, needed by
  // Excel for `cellDates`) into a readable string itself, so the SAME rows — Date
  // objects included — are safe to hand to both writeSheet and exportReportPDF.
  const buildVehicleExport = () => {
    const head = ['Reg No', 'Make', 'Model', 'Variant', 'Fuel', 'Year', 'Owner', 'Phone', 'Insurance Expiry', 'PUC Expiry', 'Visits', 'Revenue'];
    // Universal selection-scope contract (see lib/selectionScope.js, reference:
    // Job Cards' savedByJobNo) — a selection must resolve against ALL vehicles
    // (`rows`), not `filtered`. Re-intersecting with the current filter (the original
    // fix for Issue A) was itself the "N selected badge lies to the export" bug: pick
    // 5, change the Fuel/Status filter so 2 no longer show, and the report used to
    // silently contain 3. The badge's "(N not shown by current filters)" now
    // accurately describes records that ARE still included, not ones missing.
    const toExport = selectedIds.size > 0 ? resolveSelectedRecords(selectedIds, rows, (r) => r.id) : filtered;
    // Named `body`, not `rows` — this function closes over the outer `rows` (the full
    // vehicle list `useMemo` above), and a same-scope `const rows = ...` here would
    // shadow it via the temporal dead zone, breaking the resolveSelectedRecords call
    // two lines up (a real bug caught before it shipped).
    const body = toExport.map((r) => [
      r.regNo, r.make, r.model, r.variant, r.fuel, r.year, r.owner, r.ownerPhone,
      asDate(r.insuranceExpiry), asDate(r.pucExpiry), visitsOf(r), revenueOf(r),
    ]);
    return { head, rows: body, count: toExport.length };
  };
  const exportCSV = async () => {
    if (demoMode && !demoCanExport) { notify.permissionDenied('This action has been disabled by the administrator.'); return; }
    if (exporting) return;
    setExporting(true);
    try {
      const { head, rows } = buildVehicleExport();
      await writeSheet({ filename: `vehicles-${stamp()}.xlsx`, sheetName: 'Vehicles', head, rows, dateCols: [8, 9] });
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
      const { head, rows, count } = buildVehicleExport();
      const filters = [makeF !== 'All' && `Make: ${makeF}`, fuelF !== 'All' && `Fuel: ${fuelF}`, statusF !== 'All' && `Status: ${statusF}`, q.trim() && `Search: "${q.trim()}"`, selectedIds.size > 0 && `${count} selected`].filter(Boolean).join('   ·   ');
      await exportReportPDF({ title: 'Vehicle Report', head, rows, filters: filters || undefined, filename: `vehicle-report-${stamp()}.pdf`, demoMode });
      notify.exported('Exported Vehicle Report');
    } catch (e) {
      toast.error('PDF export failed.');
    } finally {
      setExporting(false);
    }
  };

  // ISSUE 1 — the SAME eleven cards, grouped per the brief. None added, none removed.
  // Compliance is separated because those three are the only KPIs where a wrong or
  // unnoticed number costs the workshop money today; the rest are background context.
  // COLOR SYSTEM REVIEW: these three "Expiring" KPI cards used three DIFFERENT colors
  // (red, amber, indigo) for the exact same semantic state — while the per-vehicle
  // compliance badges just below (expiryBadge(), above) already correctly render every
  // "expiring soon" status in ONE color, SEMANTIC.warn. Same meaning, same color now —
  // the label ("Insurance"/"PUC"/"Warranty") is what distinguishes the cards, not an
  // arbitrary color assignment. Everywhere else: a plain count/total gets neutral
  // (SEMANTIC.muted), a genuinely positive state gets SEMANTIC.ok, and Revenue keeps
  // the brand gold as the page's one deliberate business-highlight (consistent with
  // Billing's own Revenue KPI — see BillingModule.jsx). No decorative cyan/violet/
  // orange left with no semantic reason to be there.
  const STAT_GROUPS = {
    compliance: [
      { k: 'insurance', icon: Shield, label: t('vehicles.kpi.insuranceExpiring', 'Insurance Expiring'), color: SEMANTIC.warn, filter: 'insurance' },
      { k: 'puc', icon: AlertTriangle, label: t('vehicles.kpi.pucExpiring', 'PUC Expiring'), color: SEMANTIC.warn, filter: 'puc' },
      // Was "Warranty" and counted every vehicle still UNDER warranty (266 of 350) —
      // a "has warranty" number wearing a compliance label. Now: expiring in-window,
      // by warrantyExpiry date, with the quick-filter it never had.
      { k: 'warranty', icon: Shield, label: t('vehicles.kpi.warrantyExpiring', 'Warranty Expiring'), color: SEMANTIC.warn, filter: 'warranty' },
    ],
    summary: [
      { k: 'total', icon: Car, label: t('vehicles.kpi.total', 'Total Vehicles'), color: SEMANTIC.muted, filter: null },
      { k: 'active', icon: Car, label: t('customers.kpi.active', 'Active'), color: SEMANTIC.ok, filter: 'active' },
      { k: 'inService', icon: Wrench, label: t('vehicles.kpi.inService', 'In Service'), color: SEMANTIC.info, filter: 'inService' },
      { k: 'repeat', icon: Clock, label: t('vehicles.kpi.repeat', 'Repeat Vehicles'), color: SEMANTIC.muted, filter: 'repeat' },
    ],
    business: [
      { k: 'deliveries', icon: ClipboardList, label: t('vehicles.kpi.todaysDeliveries', "Today's Deliveries"), color: SEMANTIC.info, filter: null },
      { k: 'fleet', icon: User, label: t('vehicles.kpi.fleet', 'Fleet Vehicles'), color: SEMANTIC.muted, filter: 'fleet' },
      { k: 'revenue', icon: IndianRupee, label: t('vehicles.kpi.revenue', 'Revenue'), color: SEMANTIC.gold, filter: null, fmt: compactINR, exact: inr },
      { k: 'avgVisits', icon: Clock, label: t('vehicles.kpi.avgVisits', 'Avg Visits'), color: SEMANTIC.muted, filter: null },
    ],
  };

  return (
    <>
    <PageHeader title={t('page.vehicles', 'Vehicles')} icon={Car} />
    <div className="xl:flex xl:gap-4 xl:items-start">
      {/* xl:flex-[2_1_0%] (was xl:flex-1, i.e. unbounded): grows twice as fast as the
          panel's xl:flex-[1_1_0%] (components/common/DetailsPanel.jsx) as the row gets
          extra width, instead of claiming ALL of it — matches Customers' table column
          (components/customers/CustomersModule.jsx), and see DetailsPanel.jsx's "FIFTH
          bug" comment for the "table balloons while panel stays flat" problem this
          fixes on wide screens. */}
      <div className="xl:flex-[2_1_0%] xl:min-w-0">
        {/* #54: the "Compliance · next N days" label + the "summary & business" TOGGLE are
            part of the KPI DASHBOARD (this left column) — the toggle expands/collapses the
            Vehicle Summary + Business KPI groups below. It lives here, as the dashboard's
            own header row, NOT above the two-column flex (which made it float over the
            Vehicle Details panel and read as if it belonged to that panel). Because both
            columns share xl:items-start, the Vehicle Details panel aligns to the top of
            this row — i.e. the top of the KPI dashboard — with no gap. */}
        <div ref={complianceHeaderRef} className="flex items-center justify-between mb-2">
          <p className="text-[10px] uppercase tracking-wider text-white/45 font-bold">Compliance · next {REMINDER_DAYS} days</p>
          <button
            type="button"
            onClick={() => setStatsOpen((o) => !o)}
            aria-expanded={statsOpen}
            className="text-[11px] font-semibold text-white/50 hover:text-white/80 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-white/5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]/60"
          >
            {statsOpen ? 'Hide' : 'Show'} summary &amp; business
            <ChevronDown size={13} className={statsOpen ? 'rotate-180 transition' : 'transition'} />
          </button>
        </div>
        {/* ISSUE 1 — HIERARCHY.
            Eleven cards of equal weight, three rows deep, pushed the vehicle table below
            the fold. (My previous change to 5 columns made that WORSE: 11/5 = 3 rows.)
            An owner opens this module to FIND A VEHICLE, not to read ten KPIs.

            Same eleven cards, same colours, same component — regrouped:
              • COMPLIANCE first and always visible: insurance / PUC / warranty expiring.
                These are the only numbers where a wrong answer costs money today.
              • SUMMARY and BUSINESS collapse into a single line by default, so the
                table starts near the top. The toggle is remembered.
            Nothing is removed; the noise is just no longer shouting. */}

        {/* COMPLIANCE — the cards that mean money is at risk. Always visible.
            Mobile QA fix: grid-cols-3 with no breakpoint left ~30px of text width per
            card at phone widths (icon + padding eating most of a 3-way-split card) —
            "Insurance Expiring" broke letter-by-letter, not at word boundaries, because
            no word fit even once. Single column below sm: gives each label its full
            row width instead of fighting an impossible 3-way split. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          {STAT_GROUPS.compliance.map((s) => (
            <Stat key={s.k} icon={s.icon} label={s.label} value={s.fmt ? s.fmt(stats[s.k]) : stats[s.k]}
              title={s.exact ? `${s.label}: ${s.exact(stats[s.k])}` : undefined} color={s.color}
              active={quickF === s.filter && s.filter !== null}
              onClick={() => setQuickF(s.filter && quickF !== s.filter ? s.filter : null)} />
          ))}
        </div>

        {statsOpen && (
          <>
            <p className="text-[10px] uppercase tracking-wider text-white/45 font-bold mb-2">Vehicle summary</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              {STAT_GROUPS.summary.map((s) => (
                <Stat key={s.k} icon={s.icon} label={s.label} value={s.fmt ? s.fmt(stats[s.k]) : stats[s.k]}
                  title={s.exact ? `${s.label}: ${s.exact(stats[s.k])}` : undefined} color={s.color}
                  active={quickF === s.filter && s.filter !== null}
                  onClick={() => setQuickF(s.filter && quickF !== s.filter ? s.filter : null)} />
              ))}
            </div>
            <p className="text-[10px] uppercase tracking-wider text-white/45 font-bold mb-2">Business</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {STAT_GROUPS.business.map((s) => (
                <Stat key={s.k} icon={s.icon} label={s.label} value={s.fmt ? s.fmt(stats[s.k]) : stats[s.k]}
                  title={s.exact ? `${s.label}: ${s.exact(stats[s.k])}` : undefined} color={s.color}
                  active={quickF === s.filter && s.filter !== null}
                  onClick={() => setQuickF(s.filter && quickF !== s.filter ? s.filter : null)} />
              ))}
            </div>
          </>
        )}
        {!statsOpen && <div className="mb-4" />}

        {/* Toolbar — REDESIGNED (explicitly authorized) into two rows instead of one:
            Row 1 is the search box alone, always full width. Row 2 is every filter/
            sort/action control. The old single-row layout tied the search box's width
            to whatever the filters/buttons left over, needing a max-w cap, flex-wrap
            AND min-width guards just to stop it dominating or overflowing the row (see
            the removed comments in git history). Giving search its own row removes
            that tug-of-war entirely — the search box is simply always full width, and
            Row 2's controls wrap freely at whatever width they need. Same pattern now
            used in Customers' toolbar above, for consistency. */}
        <div className="mb-2.5">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/45" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('vehicles.searchPlaceholder', 'Search by Registration, Vehicle, Owner, VIN, Chassis, Engine…')} className={`${inputCls} pl-9 w-full`} />
          </div>
        </div>
        {/* PARENT-DRIVEN layout: outer row is `flex` with the filter cluster set to
            `flex-1` and the action cluster `flex-shrink-0` — the PARENT decides the
            split (filters get all leftover width, actions take only what they need),
            not individual controls declaring their own growth. Inside the filter
            cluster, a CSS Grid with `repeat(auto-fit,minmax(...,1fr))` lets the grid
            algorithm — not per-control flex-grow — size and fill the available track
            width, wrapping to a second grid row only if a track can't meet its minmax
            floor. Net effect: the whole second row (filters + actions together) now
            spans edge-to-edge with the table column, terminating flush with it exactly
            like the table itself, with no unclaimed strip before the Details panel. */}
        <div className="flex flex-wrap gap-2 mb-3">
          {/* Mobile QA fix: min-w-0 let this flex item shrink narrower than its grid's
              own minmax(9rem,...) tracks actually need, so at phone widths the grid
              overflowed its shrunk box and rendered on top of the export/action button
              group instead of the outer flex-wrap pushing that group to its own line.
              Same root cause and same fix as Customers' identical toolbar pattern. */}
          <div className="flex-1 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))' }}>
            {/* onPick(t || 'All'): MiniSelect's clear (x) button always fires onPick('') —
                these filters' "nothing selected" state is the sentinel 'All', not '', so
                without this fallback clearing would set makeF/fuelF to '' and the
                `!== 'All'` filter checks below would then exclude every row. */}
            <MiniSelect value={makeF} placeholder={t('vehicles.filter.allMakes', 'All Makes')} options={makes} labels={{ All: t('vehicles.filter.allMakes', 'All Makes') }} emptyValue="All" onPick={(m) => setMakeF(m || 'All')} inputCls={inputCls} />
            <MiniSelect value={fuelF} placeholder={t('vehicles.filter.allFuels', 'All Fuels')} options={['All', ...FUELS]} labels={{ All: t('vehicles.filter.allFuels', 'All Fuels') }} emptyValue="All" onPick={(m) => setFuelF(m || 'All')} inputCls={inputCls} />
            <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className={inputCls}>{['All', 'Active', 'Inactive', 'Archived'].map((s) => <option key={s} value={s} style={{ background: '#141414' }}>{s === 'All' ? t('customers.filter.allStatus', 'All Status') : t(`status.${s.toLowerCase()}`, s)}</option>)}</select>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className={inputCls}>{[['latest', t('common.newest', 'Latest')], ['oldest', t('common.oldest', 'Oldest')], ['visits', t('vehicles.sort.mostVisits', 'Most Visits')], ['revenue', t('vehicles.sort.highestRevenue', 'Highest Revenue')], ['lastService', t('vehicles.sort.lastService', 'Last Service')], ['upcoming', t('vehicles.sort.upcomingService', 'Upcoming Service')]].map(([v, l]) => <option key={v} value={v} style={{ background: '#141414' }}>{l}</option>)}</select>
          </div>
          {/* Export + Add Vehicle grouped into one inner flex unit so flex-wrap moves them
              to the next line TOGETHER, never splitting the pair — without this, Export
              (alone, only 90px) could keep fitting on the filters' line while Add Vehicle
              (120px) didn't, leaving it isolated on a third row by itself with the rest of
              that row empty. Grouped, the pair wraps as soon as it can't BOTH fit. */}
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={exportCSV} disabled={exporting} aria-busy={exporting} className="h-11 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 bg-white/5 border border-white/10 text-white/75 hover:bg-white/10 disabled:opacity-50 disabled:cursor-wait"><FileDown size={13} /> {exporting ? 'Exporting…' : 'Excel'}</button>
            <button onClick={exportPDF} disabled={exporting} aria-busy={exporting} className="h-11 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 bg-white/5 border border-white/10 text-white/75 hover:bg-white/10 disabled:opacity-50 disabled:cursor-wait"><FileDown size={13} /> PDF</button>
            {canManage && <button onClick={() => openEdit(emptyVehicle())} className="h-11 px-4 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 active:scale-95 transition"><Plus size={14} /> {t('vehicles.addVehicle', 'Add Vehicle')}</button>}
          </div>
        </div>
        {/* Issue 2.2/2.3 — same shape as Customers' bulk bar: Export always makes sense;
            Archive/Restore only appear when the selection actually contains a vehicle
            that action applies to (an all-archived selection never shows "Archive"). */}
        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-3 px-3.5 py-2.5 rounded-xl text-xs" style={{ background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.2)' }}>
            <span className="font-semibold text-[#d4af37] whitespace-nowrap">{selectedIds.size} selected{hiddenSelectedCount > 0 ? ` (${hiddenSelectedCount} not shown by current filters)` : ''}</span>
            <button onClick={exportCSV} disabled={exporting} className={`${bBtn} disabled:opacity-50`}><FileDown size={12} /> Excel</button>
            <button onClick={exportPDF} disabled={exporting} className={`${bBtn} disabled:opacity-50`}><FileDown size={12} /> PDF</button>
            {canManage && selArchiveMix.active > 0 && <button onClick={() => bulkArchiveVehicles(true)} className={bBtn}><Archive size={12} /> Archive</button>}
            {canManage && selArchiveMix.archived > 0 && <button onClick={() => bulkArchiveVehicles(false)} className={bBtn}><Archive size={12} /> Restore</button>}
            {canManage && <button onClick={bulkDeleteVehicles} className="h-7 px-2.5 rounded-lg font-semibold text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition inline-flex items-center gap-1 whitespace-nowrap"><Trash2 size={12} /> Delete</button>}
            <button onClick={clearSelection} className="ml-auto text-white/50 hover:text-white/90 hover:underline whitespace-nowrap">Clear selection</button>
          </div>
        )}

        {/* table */}
        <div className="rounded-2xl overflow-hidden" style={cardStyle}>
          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-sm min-w-[880px]">
              <thead className="sticky top-0 z-10" style={{ background: 'var(--surface-1)' }}>
                <tr className="text-[10px] uppercase tracking-wide text-white/45" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
                  <th className="text-left font-semibold py-2.5 px-3 whitespace-nowrap w-8">
                    <input
                      type="checkbox"
                      checked={allPagedSelected}
                      ref={(el) => { if (el) el.indeterminate = somePagedSelected; }}
                      onChange={toggleSelectAllPaged}
                      aria-label="Select all vehicles on this page"
                      className="w-3.5 h-3.5 accent-[#d4af37]"
                    />
                  </th>
                  {[
                    ['Vehicle', 'vehicles.col.vehicle', 'Vehicle'],
                    ['Reg No.', 'vehicles.col.regNo', 'Reg No.'],
                    ['Owner', 'vehicles.col.owner', 'Owner'],
                    ['Fuel', 'vehicles.col.fuel', 'Fuel'],
                    ['Year', 'vehicles.col.year', 'Year'],
                    ['Insurance', 'vehicles.col.insurance', 'Insurance'],
                    ['PUC', 'vehicles.col.puc', 'PUC'],
                    ['Visits', 'customers.col.visits', 'Visits'],
                    ['Revenue', 'vehicles.kpi.revenue', 'Revenue'],
                    ['Status', 'common.status', 'Status'],
                    ['Actions', 'common.actions', 'Actions'],
                  ].map(([h, key, fallback]) => <th key={h} className="text-left font-semibold py-2.5 px-3 whitespace-nowrap">{t(key, fallback)}</th>)}
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => {
                  const ins = expiryBadge(r.insuranceExpiry); const puc = expiryBadge(r.pucExpiry);
                  return (
                    <tr key={`${r.ownerId}-${r.id}`} className={`transition cursor-pointer ${selId === r.id ? 'bg-[#d4af37]/8' : 'hover:bg-white/[0.03]'}`} onClick={() => { setSelId(r.id); setDetailTab('Overview'); }} style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.05)' }}>
                      {/* Issue 3 — checkbox click must ONLY toggle selection, never also
                          trigger the row's own onClick (which opens the detail panel).
                          stopPropagation on this cell is exactly how the actions cell
                          already prevents its own clicks from opening the panel below —
                          same mechanism, applied here for the same reason. */}
                      <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(r.id)}
                          onChange={() => toggleSelectOne(r.id)}
                          aria-label={`Select ${r.regNo}`}
                          className="w-3.5 h-3.5 accent-[#d4af37]"
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2.5">
                          {(r.photos || []).length > 0 ? <img src={r.photos[r.coverPhoto || 0]} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" /> : <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(212,175,55,0.12)' }}><Car size={15} className="text-[#d4af37]" /></span>}
                          <div className="min-w-0"><p className="text-white/90 font-medium truncate">{combinedModel(r) || '—'}</p><p className="text-[10px] text-white/45">{r.ownershipType}</p></div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3"><span className="inline-block whitespace-nowrap text-[11px] font-bold px-2 py-0.5 rounded-md" style={{ background: 'rgba(212,175,55,0.12)', color: '#d4af37' }}>{r.regNo}</span></td>
                      <td className="py-2.5 px-3"><p className="text-white/85">{r.owner}</p><p className="text-[10px] text-white/45">{r.ownerPhone}</p></td>
                      <td className="py-2.5 px-3 text-white/60">{r.fuel}</td>
                      <td className="py-2.5 px-3 text-white/60">{r.year || '—'}</td>
                      <td className="py-2.5 px-3">{ins ? <Badge label={ins.t} color={ins.c} /> : <span className="text-white/45">—</span>}</td>
                      <td className="py-2.5 px-3">{puc ? <Badge label={puc.t} color={puc.c} /> : <span className="text-white/45">—</span>}</td>
                      <td className="py-2.5 px-3 text-center text-white/70">{visitsOf(r)}</td>
                      <td className="py-2.5 px-3 text-white/85">{inr(revenueOf(r))}</td>
                      <td className="py-2.5 px-3"><span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: (r.status || 'Active') === 'Active' ? '#34d3991f' : '#9ca3af1f', color: (r.status || 'Active') === 'Active' ? '#34d399' : '#9ca3af' }}>{t(`status.${(r.status || 'Active').toLowerCase()}`, r.status || 'Active')}</span></td>
                      <td className="py-2.5 px-3 relative" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1 items-center">
                          <button onClick={() => { setSelId(r.id); setDetailTab('Overview'); }} title={t('common.view', 'View')} className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 hover:bg-white/10"><Eye size={12} /></button>
                          {canManage && <button onClick={() => openEdit(r)} title={t('common.edit', 'Edit')} className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 hover:bg-white/10"><Edit3 size={12} /></button>}
                          <button ref={rowMenuAnchorRef(r.id)} onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === r.id ? null : r.id); }} aria-label="More actions" aria-haspopup="menu" aria-expanded={menuFor === r.id} className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 hover:bg-white/10"><MoreVertical size={12} /></button>
                        </div>
                        {menuFor === r.id && (
                          <ActionMenu anchorRef={rowMenuAnchorRef(r.id)} open onClose={() => setMenuFor(null)} items={[
                            // View / Edit are primary actions with their own always-visible row
                            // buttons (above) — intentionally NOT duplicated here. This menu is
                            // secondary/workflow/destructive actions only.
                            canManage && { type: 'item', label: t('vehicles.action.duplicate', 'Duplicate'), icon: Copy, onClick: () => duplicateVehicle(r) },
                            { type: 'item', label: t('common.createJobCard', 'Create Job Card'), icon: ClipboardList, onClick: () => onCreateJobCard?.({ name: r.owner, phone: r.ownerPhone, vehicles: [r] }) },
                            { type: 'item', label: t('common.createInvoice', 'Create Invoice'), icon: IndianRupee, onClick: () => onCreateInvoice?.({ id: r.ownerId, name: r.owner, phone: r.ownerPhone, vehicles: [r] }) },
                            canManage && { type: 'item', label: r.status === 'Archived' ? t('common.restore', 'Restore') : t('common.archive', 'Archive'), icon: Archive, onClick: () => archiveVehicle(r) },
                            canManage && { type: 'item', label: t('common.delete', 'Delete'), icon: Trash2, danger: true, onClick: () => deleteVehicle(r) },
                          ]} />
                        )}
                      </td>
                    </tr>
                  );
                })}
                {paged.length === 0 && <tr><td colSpan={12} className="py-10 text-center text-white/45 text-xs">{t('vehicles.empty.noMatch', 'No vehicles match.')} {canManage && t('vehicles.empty.clickToAdd', 'Click "Add Vehicle" to register one.')}</td></tr>}
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
                    {ins && <Badge label={`${t('vehicles.col.insurance', 'Ins')}: ${ins.t}`} color={ins.c} size="sm" />}
                    {puc && <Badge label={`${t('vehicles.col.puc', 'PUC')}: ${puc.t}`} color={puc.c} size="sm" />}
                    <span className="text-[10px] text-white/45">{visitsOf(r)} {t('customers.col.visits', 'visits').toLowerCase()} · {inr(revenueOf(r))}</span>
                    <div className="ml-auto flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                      {canManage && <button onClick={() => openEdit(r)} className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60"><Edit3 size={13} /></button>}
                      <button onClick={() => onCreateInvoice?.({ id: r.ownerId, name: r.owner, phone: r.ownerPhone, vehicles: [r] })} className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60"><IndianRupee size={13} /></button>
                    </div>
                  </div>
                </div>
              );
            })}
            {paged.length === 0 && <div className="py-10 text-center text-white/45 text-xs">{t('vehicles.empty.noMatch', 'No vehicles match.')} {canManage && t('vehicles.empty.tapToAdd', 'Tap "Add Vehicle" to register one.')}</div>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.06)' }}>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-white/45">{t('dynamic.showingRange', `Showing ${filtered.length ? (safePage - 1) * perPage + 1 : 0}–${Math.min(safePage * perPage, filtered.length)} of ${filtered.length}`, { from: filtered.length ? (safePage - 1) * perPage + 1 : 0, to: Math.min(safePage * perPage, filtered.length), total: filtered.length, entity: '' })}</span>
              <select value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }} className="h-7 px-1.5 rounded-lg text-[11px] bg-white/5 border border-white/10 text-white/70 outline-none">{[10, 25, 50, 100].map((n) => <option key={n} value={n} style={{ background: '#141414' }}>{n} {t('common.perPage', '/ page')}</option>)}</select>
            </div>
            <div className="flex items-center gap-2">
              <button disabled={safePage <= 1} onClick={() => setPage((p) => Math.min(p, pageCount) - 1)} aria-label="Previous page" className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 disabled:opacity-30"><ChevronLeft size={14} /></button>
              <span className="text-xs text-white/60">{safePage} / {pageCount}</span>
              <button disabled={safePage >= pageCount} onClick={() => setPage((p) => Math.min(p, pageCount) + 1)} aria-label="Next page" className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 disabled:opacity-30"><ChevronRight size={14} /></button>
            </div>
          </div>
        </div>
      </div>

      {/* Shared framework (components/common/DetailsPanel.jsx) — this panel was
          previously an independent, stale copy of Customers' panel: a flat 370px
          width (not responsive), a plain `xl:top-4` sticky offset with no awareness of
          the app's own sticky header (so on scroll it tucked UNDER the header instead
          of below it), and no independent scroll container (long content scrolled the
          whole page). Now shares the same fixed framework Customers uses — same
          responsive clamp width, header-aware sticky offset, max-height and
          independent-scroll body. All content below is unchanged. */}
      <DetailsPanel
        cardStyle={cardStyle}
        topOffset={panelTopOffset}
        empty={!selected}
        emptyIcon={Car}
        emptyTitle={t('vehicles.detail.title', 'Vehicle Details')}
        emptyHint={t('vehicles.detail.selectHint', 'Select a vehicle to view:')}
        emptyBullets={[
          t('vehicles.detail.bulletInfo', 'Vehicle information'),
          t('vehicles.detail.bulletServiceHistory', 'Service history'),
          t('vehicles.detail.bulletInvoicesInsurance', 'Invoices & Insurance'),
          t('customers.detail.bulletTimelineNotes', 'Timeline, Notes & Documents'),
        ]}
        emptyTip={t('customers.detail.emptyTip', 'Click a row to view details · Use checkboxes for bulk actions')}
        emptyPadding="py-8"
        header={selected && (
          <div className="flex items-start justify-between mb-3">
            <h3 className="text-sm font-bold text-white/85">{t('vehicles.detail.title', 'Vehicle Details')}</h3>
            <button onClick={() => setSelId(null)} aria-label="Close details" className="w-7 h-7 rounded-lg flex items-center justify-center text-white/45 hover:bg-white/10"><X size={14} /></button>
          </div>
        )}
      >
        {selected && (
          <>
              {/* Shared with Customers via components/common/DetailHero — one
                  implementation, so the two details panels cannot drift apart. */}
              <DetailHero icon={Car} photos={selected.photos} coverPhoto={selected.coverPhoto || 0} />
              {(selected.photos || []).length > 1 && (
                <div className="flex gap-1.5 mb-3 overflow-x-auto dark-scroll">{selected.photos.map((p, pi) => <img key={pi} src={p} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" style={{ border: (selected.coverPhoto || 0) === pi ? '2px solid #d4af37' : '1px solid rgba(var(--fg-rgb),0.1)' }} />)}</div>
              )}
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-bold px-2 py-0.5 rounded-md" style={{ background: 'rgba(212,175,55,0.12)', color: '#d4af37' }}>{selected.regNo}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: (selected.status || 'Active') === 'Active' ? '#34d3991f' : '#9ca3af1f', color: (selected.status || 'Active') === 'Active' ? '#34d399' : '#9ca3af' }}>{selected.status || 'Active'}</span>
              </div>
              <p className="text-base font-bold text-white">{combinedModel(selected)}</p>
              <button type="button" onClick={() => onOpenCustomer?.({ id: selected.ownerId, name: selected.owner, phone: selected.ownerPhone, code: selected.ownerCode })} className="text-xs text-white/50 mb-3 flex items-center gap-1.5 hover:text-[#d4af37] transition"><User size={12} /> {selected.owner} · {selected.ownerPhone}</button>

              <div className="flex gap-1 mb-3 overflow-x-auto dark-scroll -mx-1 px-1">
                {['Overview', 'Service', 'Invoices', 'Documents', 'Insurance', 'Timeline', 'Notes'].map((tab) => (
                  <button key={tab} onClick={() => setDetailTab(tab)} className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap transition ${detailTab === tab ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]' : 'text-white/55 bg-white/5 border border-white/10 hover:bg-white/10'}`}>{t(`vehicles.detail.tab.${tab}`, tab)}</button>
                ))}
              </div>

              {detailTab === 'Overview' && (
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] rounded-xl p-3" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                  {[['Fuel', selected.fuel], ['Transmission', selected.transmission], ['Year', selected.year || '—'], ['Color', selected.color || '—'], ['Body', selected.bodyType || '—'], ['Engine CC', selected.engineCC || '—'], ['VIN', selected.vin || '—'], ['Engine No.', selected.engineNo || '—'], ['Odometer', selected.odometer ? `${Number(selected.odometer).toLocaleString('en-IN')} km` : '—'], ['Visits', visitsOf(selected)], ['Revenue', inr(revenueOf(selected))], ['Ownership', selected.ownershipType]].map(([k, v]) => (
                    <div key={k}><p className="text-white/45">{k}</p><p className="font-semibold text-white/85 truncate">{v}</p></div>
                  ))}
                </div>
              )}
              {detailTab === 'Service' && (
                <div className="space-y-1.5">
                  {jcOf(selected).length ? [...jcOf(selected)].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)).map((j, i) => (
                    <button key={i} type="button" onClick={() => onOpenJobCard?.(j)} className="w-full text-left px-3 py-2 rounded-xl text-xs hover:bg-white/[0.06] transition" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                      <div className="flex justify-between"><span className="text-white/80 font-medium">{j.jobNo}</span><span className="text-white/45">{j.status}</span></div>
                      <p className="text-[10px] text-white/45 mt-0.5">{(j.complaints || []).filter(Boolean)[0] || 'Service'} · {j.advisor || '—'}</p>
                    </button>
                  )) : <p className="text-xs text-white/45 text-center py-4">No service history yet.</p>}
                </div>
              )}
              {detailTab === 'Invoices' && (
                <div className="space-y-1.5">
                  {invOf(selected).length ? invOf(selected).map((iv, i) => (
                    <button key={i} type="button" onClick={() => onOpenInvoice?.(iv)} className="w-full flex justify-between px-3 py-2 rounded-xl text-xs hover:bg-white/[0.06] transition text-left" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}><span className="text-white/80">{iv.invNo} · {iv.date}</span><span style={{ color: iv.status === 'Paid' ? '#34d399' : '#f87171' }}>{iv.status}</span></button>
                  )) : <p className="text-xs text-white/45 text-center py-4">No invoices yet.</p>}
                </div>
              )}
              {detailTab === 'Documents' && (
                <div className="space-y-1.5">
                  {(selected.documents || []).length ? selected.documents.map((d, i) => (
                    <a key={i} href={d.data} download={d.name} className="flex items-center justify-between px-3 py-2 rounded-xl text-xs hover:bg-white/5" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}><span className="text-white/80 flex items-center gap-2 truncate"><FileText size={13} className="text-white/45" /> {d.name}</span><FileDown size={13} className="text-white/45" /></a>
                  )) : <p className="text-xs text-white/45 text-center py-4">No documents. Add them via Edit → Documents.</p>}
                </div>
              )}
              {detailTab === 'Insurance' && (
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] rounded-xl p-3" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}>
                  {[['Insurer', selected.insurer || '—'], ['Policy No.', selected.policyNo || '—'], ['Valid Till', selected.insuranceExpiry || selected.policyEnd || '—'], ['IDV', selected.idv ? inr(selected.idv) : '—'], ['PUC Expiry', selected.pucExpiry || '—'], ['Warranty', selected.warrantyExpiry || (selected.extWarranty ? 'Extended' : '—')], ['Agent', selected.agentName || '—'], ['Agent Ph.', selected.agentPhone || '—']].map(([k, v]) => (
                    <div key={k}><p className="text-white/45">{k}</p><p className="font-semibold text-white/85 truncate">{v}</p></div>
                  ))}
                </div>
              )}
              {detailTab === 'Timeline' && (
                <div className="space-y-2">
                  {[...(selected.history || [])].reverse().map((h, i) => (
                    <div key={i} className="flex gap-2.5"><span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: '#d4af37' }} /><div><p className="text-xs text-white/85">{h.action} {h.detail ? <span className="text-white/50">· {h.detail}</span> : null}</p><p className="text-[10px] text-white/45">{new Date(h.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {h.by}</p></div></div>
                  ))}
                  {(selected.history || []).length === 0 && <p className="text-xs text-white/45 text-center py-4">No history recorded yet.</p>}
                </div>
              )}
              {detailTab === 'Notes' && (
                <div className="space-y-2 text-xs">
                  {[['Known Issues', selected.knownIssues], ['Preferred Oil', selected.preferredOil], ['Preferred Brand', selected.preferredBrand], ['Special Instructions', selected.specialInstructions], ['Internal Notes', selected.notes], ['Tags', selected.tags]].filter(([, v]) => v).map(([k, v]) => (
                    <div key={k}><p className="text-white/45 text-[10px] uppercase">{k}</p><p className="text-white/80">{v}</p></div>
                  ))}
                  {(selected.notesLog || []).length > 0 && (
                    <div className="pt-1">
                      <p className="text-white/45 text-[10px] uppercase mb-1">Notes Log</p>
                      <div className="space-y-1.5">
                        {[...(selected.notesLog || [])].reverse().map((n, i) => (
                          <div key={i} className="px-3 py-2 rounded-xl" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}><p className="text-white/80">{n.text}</p><p className="text-[10px] text-white/45 mt-0.5">{new Date(n.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {n.by || '—'}</p></div>
                        ))}
                      </div>
                    </div>
                  )}
                  {![selected.knownIssues, selected.preferredOil, selected.preferredBrand, selected.specialInstructions, selected.notes, selected.tags].some(Boolean) && !(selected.notesLog || []).length && <p className="text-white/45 text-center py-4">No notes recorded.</p>}
                </div>
              )}

              {(() => {
                const owner = { id: selected.ownerId, name: selected.owner, phone: selected.ownerPhone, code: selected.ownerCode, vehicles: [selected] };
                const jobCardCtx = { name: selected.owner, phone: selected.ownerPhone, id: selected.ownerId, vehicles: [selected] };
                const btnP = 'h-10 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] flex items-center justify-center gap-1.5';
                const btnS = 'h-10 rounded-xl text-xs font-bold bg-white/5 border border-white/10 text-white/80 flex items-center justify-center gap-1.5';
                const actions = {
                  // Defect #57 (reopened) Issue A — each tab's actions now open the
                  // step of Edit Vehicle that actually matches what the button says,
                  // via openEdit(vehicle, stepKey) instead of the bare setEdit(selected)
                  // every one of these previously shared (which always landed on
                  // Overview regardless of which button was clicked). Create/View
                  // actions for Job Cards and Invoices were already correctly routed to
                  // their own flows (onCreateJobCard/onViewJobCards/etc, wired from
                  // InventoryDashboard.js) — untouched here.
                  Overview: [
                    canManage && <button key="e" onClick={() => openEdit(selected)} className={btnS}><Edit3 size={14} /> Edit Vehicle</button>,
                    canManage && <button key="j" onClick={() => onCreateJobCard?.(jobCardCtx)} className={btnP}><ClipboardList size={14} /> Create Job Card</button>,
                    canManage && <button key="i" onClick={() => onCreateInvoice?.(owner)} className={btnS}><IndianRupee size={14} /> Create Invoice</button>,
                  ],
                  Service: [
                    canManage && <button key="j" onClick={() => onCreateJobCard?.(jobCardCtx)} className={btnP}><ClipboardList size={14} /> Create Job Card</button>,
                    <button key="v" onClick={() => onViewJobCards?.(selected)} className={btnS}><Eye size={14} /> View All Job Cards</button>,
                  ],
                  Invoices: [
                    canManage && <button key="i" onClick={() => onCreateInvoice?.(owner)} className={btnP}><IndianRupee size={14} /> Create Invoice</button>,
                    <button key="v" onClick={() => onViewInvoices?.(selected)} className={btnS}><Eye size={14} /> View All Invoices</button>,
                  ],
                  Documents: [
                    canManage && <button key="u" onClick={() => openEdit(selected, 'documents')} className={btnP}><Plus size={14} /> Upload Document</button>,
                    <button key="v" onClick={() => (onViewDocuments ? onViewDocuments(selected) : openEdit(selected, 'documents'))} className={btnS}><Eye size={14} /> View All Documents</button>,
                  ],
                  Insurance: [
                    canManage && <button key="e" onClick={() => openEdit(selected, 'insurance')} className={btnP}><Shield size={14} /> Edit Insurance</button>,
                    canManage && <button key="r" onClick={() => openEdit(selected, 'insurance')} className={btnS}><Shield size={14} /> Renew Insurance</button>,
                  ],
                  Timeline: [
                    <button key="h" onClick={() => setHistoryFor(selected)} className={btnS}><Eye size={14} /> View Full History</button>,
                  ],
                  Notes: [
                    canManage && <button key="a" onClick={() => { setNoteText(''); setAddNoteFor(selected); }} className={btnP}><Plus size={14} /> Add Note</button>,
                    canManage && <button key="n" onClick={() => openEdit(selected, 'notes')} className={btnS}><Edit3 size={14} /> Edit Notes</button>,
                  ],
                };
                const list = (actions[detailTab] || []).filter(Boolean);
                if (!list.length) return null;
                return <div className={`grid gap-2 mt-4 ${list.length >= 3 ? 'grid-cols-3' : list.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>{list}</div>;
              })()}
          </>
        )}
      </DetailsPanel>

      {edit && <VehicleWizard initial={edit} customers={customers} existingVehicles={rows} onSave={writeVehicle} onClose={() => { setEdit(null); setEditSection(null); }} onQuickCustomer={quickCreateCustomer} demoMode={demoMode} initialStep={editSection} />}
      {addNoteFor && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setAddNoteFor(null)}>
          <div className="w-full max-w-sm rounded-2xl p-5" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
            <h4 className="text-sm font-bold text-white mb-1 flex items-center gap-2"><Plus size={15} className="text-[#d4af37]" /> Add Note</h4>
            <p className="text-[11px] text-white/45 mb-3">{addNoteFor.regNo} — adds a new note without changing existing ones.</p>
            <textarea autoFocus value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={4} placeholder="Type a note…" className={`${inputCls} resize-none mb-4`} />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setAddNoteFor(null)} className="h-10 rounded-xl text-xs font-bold bg-white/5 border border-white/10 text-white/80">Cancel</button>
              <button type="button" onClick={() => addNote(addNoteFor, noteText)} className="h-10 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">Save Note</button>
            </div>
          </div>
        </div>
      )}
      {historyFor && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setHistoryFor(null)}>
          <div className="w-full max-w-md max-h-[85vh] flex flex-col rounded-2xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
              <h4 className="text-sm font-bold text-white">Full History · {historyFor.regNo}</h4>
              <button type="button" onClick={() => setHistoryFor(null)} className="text-white/45 hover:text-white"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto dark-scroll p-5 space-y-2">
              {[...(historyFor.history || [])].reverse().map((h, i) => (
                <div key={i} className="flex gap-2.5"><span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: '#d4af37' }} /><div><p className="text-xs text-white/85">{h.action} {h.detail ? <span className="text-white/50">· {h.detail}</span> : null}</p><p className="text-[10px] text-white/45">{new Date(h.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · {h.by}</p></div></div>
              ))}
              {(historyFor.history || []).length === 0 && <p className="text-xs text-white/45 text-center py-6">No history recorded yet.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
