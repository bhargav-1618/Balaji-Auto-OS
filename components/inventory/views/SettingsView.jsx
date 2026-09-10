import { useState, useEffect, useMemo, Fragment } from 'react';
import {
  Settings, Download, Upload, Trash2, AlertTriangle, ArchiveRestore,
  Package, Users, Car, ClipboardList, Receipt, Truck, ShieldCheck, BarChart3,
} from 'lucide-react';
import { useTranslation } from '../../../lib/i18n';
import { STORAGE } from '../../../constants';
import { isValidGstin, GSTIN_ERROR } from '../../../lib/gst';
import { isIndianMobile, isValidEmail, MOBILE_ERROR, EMAIL_ERROR } from '../../../lib/format';
import toast from '../../../lib/toast';
import { confirmDialog } from '../../common/ConfirmDialog';
import PageHeader from '../../common/PageHeader';
import Toggle from '../../common/Toggle';
import { SetSeg, SetSel, SetTxt, SetCard, BrandingLogoField, SET_CARD_STYLE } from '../ui/SettingsControls';
import { DEMO_PERM_GROUPS, DEMO_PERM_KEY, loadDemoPerms } from '../../../lib/demoPerms';

// Refactor Phase 12 — SettingsView (the Settings tab) extracted verbatim from
// components/InventoryDashboard.js. Presentation + local UI state only: no Firestore,
// no persistenceStore, no transactions. Business settings persist through the SAME
// localStorage + CustomEvent path they always did (`maruti_settings` / `maruti-prefs`
// / `maruti-demo-perms`); the container listens for those events unchanged. Admin /
// staff / backup / reset actions are container callbacks passed as props. Navigation
// dirty-state ownership stays in the container — SettingsView only notifies through
// the existing `onDirtyChange` prop.
//
// SHOP_NAME / APP_VERSION are local copies of the container's module constants (same
// values; the container keeps its own — getShopName() still uses SHOP_NAME there).
const SHOP_NAME = 'SRI BABA BALAJI MARUTI CARE';
const APP_VERSION = '1.0.0';

// ---- Settings field primitives --------------------------------
// SetSeg / SetSel / SetTxt / SetCard / BrandingLogoField (and SET_CARD_STYLE) now
// live in ./inventory/ui/SettingsControls, imported at the top of this file. They
// MUST stay at module scope (a stable component identity — declaring them inside
// SettingsView's render remounted every <input> on each keystroke and lost focus).
// The thin `Seg`/`Sel`/`Card` aliases inside SettingsView still point at them.

// ---- Settings workspace width tiers (shared, not per-section magic numbers) ----
// A section's CONTENT (how many fields it holds) decides its width, not a blanket rule
// either way. Sections with several distinct field-groups (Business Profile, Billing,
// Job Cards) or naturally-paired cards (Users & Roles, Backup & Data, Demo Permissions)
// use the full content column, arranged as a responsive card grid — that's what actually
// puts the shell's wide canvas to use. Sections that are genuinely small (a handful of
// threshold fields, a toggle list, a session-timeout dropdown) stay capped at a
// comfortable reading width instead of stretching a 4-field card edge-to-edge across a
// 1800px canvas, which would just make individual inputs absurdly wide — see the brief's
// own "do not stretch every input equally." ONE constant, reused everywhere a section
// needs the capped tier, so this is a single, named decision rather than five ad hoc
// widths.
const SETTINGS_CARD_MAX = 'max-w-3xl';
const SETTINGS_WIDE_SECTIONS = new Set(['business', 'billing', 'jobcards', 'users', 'backup', 'demoperms']);
// Multiple related cards side-by-side once there's room (xl, 1024px+ of content column
// space) — falls back to a single stacked column below that, same idiom the rest of the
// app already uses for responsive grids (see OverviewView's KPI grids).
const SETTINGS_GROUP_GRID = 'grid grid-cols-1 xl:grid-cols-2 gap-4';

// ISSUE 1 — settings dirty-state.
// These defaults must mirror EXACTLY how each field is read in the JSX below. Anything
// read as `biz[k] !== false` defaults to true; anything read as `!!biz[k]` defaults to
// false. If a default here disagrees with its accessor, that field's Save button will
// stick again — so the two must be changed together.
const SETTINGS_DEFAULTS = {
  // notifications — read as `biz[k] !== false`
  remLowStock: true,
  remCritical: true,
  remService: true,
  remPayment: true,
  // billing / job cards — read as `biz.x !== false`
  discountOptional: true,
  gstOptional: true,
  inspectionChecklist: true,
  roundOff: true,
};

/** Effective settings as a stable, order-independent string. */
function normalizeSettings(obj = {}) {
  const merged = { ...SETTINGS_DEFAULTS, ...(obj || {}) };
  const out = {};
  Object.keys(merged).sort().forEach((k) => {
    const v = merged[k];
    // An absent value and an empty one mean the same thing to every consumer here,
    // so they must not read as a change.
    if (v === undefined || v === null || v === '') return;
    out[k] = v;
  });
  return JSON.stringify(out);
}

function SettingsView({ onDirtyChange, totalRecords, lastBackup, lastSync, isAdmin, userEmail, online, onBackup, onRestore, admins = [], bootstrapAdmins = [], onAddAdmin, onRemoveAdmin, staffPerms = {}, onAddStaff, onRemoveStaff, onSetStaffPerm, recoveryMeta = null, onResetAllData, onRestoreVault, demoMode = false, demoAdmin = false, sidebarCollapsed, setSidebarCollapsed }) {
  const { t, locale, locales } = useTranslation();
  const [section, setSection] = useState('business');
  const [biz, setBiz] = useState({});
  // Baseline = what's actually persisted.
  //
  // ISSUE 1. `dirty` used to be a raw `JSON.stringify(biz) !== JSON.stringify(bizSaved)`.
  // That compares TEXT, not MEANING, and every boolean here is read as
  // `biz[k] !== false` — i.e. an ABSENT key means TRUE. So a freshly-loaded settings
  // object is `{}`, and toggling "Low Stock Alerts" off and back on leaves
  // `{ remLowStock: true }`. Identical settings, different JSON → Save Changes stayed
  // lit and the "unsaved changes" banner never went away. JSON.stringify is also
  // key-ORDER sensitive, so two objects with the same content could compare unequal.
  //
  // Fix: materialise the defaults into BOTH sides and sort the keys, so the comparison
  // is over the effective settings rather than over the literal object.
  const [bizSaved, setBizSaved] = useState({});
  const dirty = useMemo(
    () => normalizeSettings(biz) !== normalizeSettings(bizSaved),
    [biz, bizSaved],
  );
  // Surface dirty state to the navigation guard (prevents silent loss on tab switch).
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const [prefs, setPrefsState] = useState(() => { try { return { theme: 'dark', fontSize: 'md', reduceMotion: false, density: 'comfortable', ...(JSON.parse(localStorage.getItem(STORAGE.PREFS) || '{}')) }; } catch { return { theme: 'dark', fontSize: 'md' }; } });
  const [demoPerms, setDemoPermsState] = useState(() => loadDemoPerms());
  const [newAdmin, setNewAdmin] = useState('');
  const [newStaff, setNewStaff] = useState('');
  const [resetStep, setResetStep] = useState(0);
  const [resetText, setResetText] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const recoveryActive = !!recoveryMeta && (recoveryMeta.expiresAt || 0) > Date.now();
  const daysRemaining = recoveryActive ? Math.max(0, Math.ceil((recoveryMeta.expiresAt - Date.now()) / 86400000)) : 0;

  const SETTINGS_KEY = demoMode ? 'maruti_settings_demo' : 'maruti_settings';
  useEffect(() => { try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); setBiz(s); setBizSaved(s); } catch {} }, [SETTINGS_KEY]);
  const bset = (patch) => setBiz((b) => ({ ...b, ...patch }));
  // Business GST is optional, but if entered it must be a real GSTIN — same canonical
  // rule as Customers/Suppliers/Billing (lib/gst.js), not a separate check.
  const bizGstErr = biz.bizGst && !isValidGstin(biz.bizGst) ? GSTIN_ERROR : null;
  // Same canonical contact rules as Customers/Suppliers/Job Cards — only checked
  // when a value is present (neither field is being newly made mandatory here).
  const bizPhoneErr = biz.bizPhone && !isIndianMobile(biz.bizPhone) ? MOBILE_ERROR : null;
  const bizEmailErr = biz.bizEmail && !isValidEmail(biz.bizEmail) ? EMAIL_ERROR : null;
  const saveBiz = () => {
    if (bizGstErr) { toast.error(bizGstErr); return; }
    if (bizPhoneErr) { toast.error(bizPhoneErr); return; }
    if (bizEmailErr) { toast.error(bizEmailErr); return; }
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(biz)); window.dispatchEvent(new CustomEvent('maruti-settings')); } catch {}
    setBizSaved(biz); // new baseline → dirty recomputes to false
    toast.success(t('toast.settingsSaved', 'Settings saved'));
  };

  // Business Logo — same base64-in-record architecture already proven for Part
  // photos (compressPartImage, above in this file): no Firebase Storage exists in
  // this app, and every OTHER Business Profile field already persists as a plain
  // field on this same `biz` object via localStorage — a logo is not exempt from
  // that, so it stages through the SAME bset()/dirty/Save-Changes flow as Workshop
  // Name or GST Number rather than a parallel save path. Kept as a single data URL
  // field (`logoDataUrl`), not an array — a business has exactly one current logo,
  // and "no duplicate logo references accumulate" (Replace requirement) falls out
  // naturally from overwriting one field rather than appending to a list.
  //
  // Always re-encoded as PNG (unlike compressPartImage's forced JPEG): a logo is
  // frequently a transparent PNG, and canvas-decoding then re-encoding any of
  // PNG/JPG/WEBP through image/png guarantees transparency is preserved regardless
  // of the source format, with predictable output for the PDF embed later.
  const LOGO_MAX_DIM = 480;
  const LOGO_MAX_BYTES = 5 * 1024 * 1024; // 5MB — a logo has no business being large
  const compressLogo = (file) => new Promise((resolve, reject) => {
    const okType = /^image\/(png|jpe?g|webp)$/i.test(file?.type || '');
    if (!file || !okType) { reject(new Error('Unsupported file type — use PNG, JPG, or WEBP.')); return; }
    if (file.size > LOGO_MAX_BYTES) { reject(new Error('Logo exceeds 5MB — choose a smaller file.')); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > LOGO_MAX_DIM || height > LOGO_MAX_DIM) {
          if (width >= height) { height = Math.round((height * LOGO_MAX_DIM) / width); width = LOGO_MAX_DIM; }
          else { width = Math.round((width * LOGO_MAX_DIM) / height); height = LOGO_MAX_DIM; }
        }
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
  const handleLogoUpload = async (e) => {
    const file = (e.target.files || [])[0];
    e.target.value = ''; // always reset so re-selecting the same file re-fires onChange
    if (!file) return;
    try {
      const dataUrl = await compressLogo(file);
      bset({ logoDataUrl: dataUrl }); // preview updates immediately; Save Changes persists
    } catch (err) {
      toast.error(err.message || 'Image error');
    }
  };
  const removeLogo = () => bset({ logoDataUrl: null });


  // appearance prefs apply instantly + persist (same engine used elsewhere)
  const updatePrefs = (patch) => setPrefsState((p) => { const next = { ...p, ...patch }; try { localStorage.setItem(STORAGE.PREFS, JSON.stringify(next)); window.dispatchEvent(new CustomEvent('maruti-prefs')); } catch {} return next; });
  useEffect(() => {
    const sizes = { sm: '15px', md: '16px', lg: '17.5px' };
    document.documentElement.style.fontSize = sizes[prefs.fontSize] || '16px';
    document.documentElement.classList.toggle('reduce-motion', !!prefs.reduceMotion);
    document.documentElement.setAttribute('data-theme', prefs.theme || 'dark');
  }, [prefs.fontSize, prefs.reduceMotion, prefs.theme]);
  const setCompact = (v) => { updatePrefs({ compactSidebar: v }); setSidebarCollapsed?.(v); };

  const saveDemoPerms = (next) => { setDemoPermsState(next); try { localStorage.setItem(DEMO_PERM_KEY, JSON.stringify(next)); window.dispatchEvent(new CustomEvent('maruti-demo-perms')); } catch {} };
  const toggleDemoPerm = (key) => saveDemoPerms({ ...demoPerms, [key]: !demoPerms[key] });

  // ---- shared UI primitives (standardized switch used everywhere) ----
  // The one switch used app-wide. Old bespoke markup removed — this delegates to
  // the shared premium gold Toggle in components/common/Toggle.jsx so every switch
  // in the app is identical in size, colour, radius, animation and behaviour.
  // NOTE: Seg / Sel / Txt / Card are HOISTED to module scope (see SetSeg, SetSel,
  // SetTxt, SetCard below this component). Defining them here re-created them on
  // every render, so React saw a new component type each keystroke, remounted the
  // <input>, and focus was lost after a single character. These thin aliases keep
  // the existing call-sites working while the real components stay stable.
  const Seg = SetSeg;
  const Sel = SetSel;
  const Card = SetCard;

  // section list — Garage & Integrations removed; each concern lives once.
  // Context-aware settings navigation. Sections only appear when they're actually
  // relevant to this user: admin-only areas are hidden from staff, and the demo
  // panel is hidden entirely for a live workshop that has no demo users — it was
  // cluttering every owner's settings with something they can't use. Grouped so
  // related settings sit together instead of one long flat list.
  const showDemoPanel = isAdmin && (demoMode || demoAdmin || typeof window !== 'undefined');
  const NAV_SECTIONS = [
    { header: 'Workshop', items: [
      ['business', 'Business Profile'],
      ['billing', 'Billing'],
      ['jobcards', 'Job Cards'],
      ['inventory', 'Inventory'],
    ] },
    { header: 'Preferences', items: [
      ['notifications', 'Notifications'],
      ['appearance', 'Appearance'],
    ] },
    { header: 'Administration', items: [
      ...(isAdmin ? [['users', 'Users & Roles']] : []),
      ['security', 'Security'],
      ...(isAdmin ? [['backup', 'Backup & Data']] : []),
      ...(showDemoPanel ? [['demoperms', 'Demo Permissions']] : []),
    ] },
    { header: null, items: [['about', 'About']] },
  ].filter((g) => g.items.length > 0);
  const NAV = NAV_SECTIONS.flatMap((g) => g.items);
  const editableSections = ['business', 'billing', 'jobcards', 'inventory', 'notifications'];
  // If the active section isn't available to this user (e.g. an admin-only panel
  // after a role change), fall back to the first one they can actually see rather
  // than rendering an empty pane.
  useEffect(() => { if (NAV.length && !NAV.some(([k]) => k === section)) setSection(NAV[0][0]); }, [NAV, section]);

  return (
    <PageHeader title={t('page.settings', 'Settings')} icon={Settings}>
      <div className="lg:flex lg:gap-5 lg:items-start">
        <div className="lg:w-56 lg:flex-shrink-0 mb-3 lg:mb-0">
          <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-x-visible dark-scroll rounded-2xl p-1.5" style={SET_CARD_STYLE}>
            {NAV_SECTIONS.map((g, gi) => (
              <Fragment key={g.header || `g${gi}`}>
                {/* ISSUE 2: these are group LABELS, not menu items. Nothing here was ever
                    disabled — but sitting in the same column at low contrast, they read
                    as greyed-out dead entries. Mark them as non-interactive so they can
                    no longer be mistaken for broken buttons: no pointer cursor, no text
                    selection, and a hairline rule that visually separates the group from
                    the items above it. Colours and spacing are unchanged. */}
                {g.header && (
                  <p
                    aria-hidden="true"
                    className="hidden lg:block px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-white/45 select-none cursor-default"
                    style={gi > 0 ? { borderTop: '1px solid rgba(var(--fg-rgb),0.06)', marginTop: 4, paddingTop: 10 } : undefined}
                  >
                    {t(`settings.group.${g.header.toLowerCase()}`, g.header)}
                  </p>
                )}
                {g.items.map(([k, l]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSection(k)}
                    aria-current={section === k ? 'page' : undefined}
                    className={`text-left px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]/60 ${section === k ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]' : 'text-white/60 hover:text-white/90 hover:bg-white/5'}`}
                  >
                    {t(`settings.nav.${k}`, l)}
                  </button>
                ))}
              </Fragment>
            ))}
          </div>
        </div>

        {/* Full-workspace Settings layout review: this column now takes the shell's
            entire wide-canvas budget (see the comment above <main> in this same file —
            Settings is no longer the one page-level exception). Individual SECTIONS
            decide their own width from SETTINGS_WIDE_SECTIONS/SETTINGS_CARD_MAX above,
            based on how much real content each one holds — the column itself stays
            unconstrained so a wide section (a multi-card grid) and a narrow one (a
            single small card) can both render correctly without the column fighting
            either shape. */}
        <div className="lg:flex-1 lg:min-w-0 space-y-4">
          {section === 'business' && (
            <div className={SETTINGS_GROUP_GRID}>
              <Card title={t('settings.businessIdentity.title', 'Business Identity')} desc={t('settings.businessIdentity.desc', 'Shown on invoices, estimates and reports. GST is optional.')}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <SetTxt biz={biz} bset={bset} label={t('settings.field.workshopName', 'Workshop Name')} k="bizName" placeholder={SHOP_NAME} />
                  <SetTxt biz={biz} bset={bset} label={t('settings.field.phone', 'Phone')} k="bizPhone" placeholder="10-digit phone" error={bizPhoneErr} />
                  <SetTxt biz={biz} bset={bset} label={t('settings.field.email', 'Email')} k="bizEmail" placeholder="info@…" optional error={bizEmailErr} />
                  <SetTxt biz={biz} bset={bset} label={t('settings.field.gstNumber', 'GST Number')} k="bizGst" placeholder="36ABCDE1234F1Z5" optional upper error={bizGstErr} />
                  <div className="sm:col-span-2"><SetTxt biz={biz} bset={bset} label={t('settings.field.address', 'Address')} k="bizAddress" placeholder="Street, city, PIN" /></div>
                </div>
              </Card>
              <div className="space-y-4">
                <Card title={t('settings.operational.title', 'Operational Settings')} desc={t('settings.operational.desc', 'Displayed on invoices and used for numbering.')}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <SetTxt biz={biz} bset={bset} label={t('settings.field.workingHours', 'Working Hours')} k="bizHours" placeholder="9:00 AM – 8:00 PM" optional />
                    <SetTxt biz={biz} bset={bset} label={t('settings.field.invoicePrefix', 'Invoice Prefix')} k="invPrefix" placeholder="INV" />
                  </div>
                </Card>
                <Card title={t('settings.regional.title', 'Regional Settings')} desc={t('settings.regional.desc', 'Currency, timezone and language used across the app.')}>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Settings QA finding: USD was offered here but every money value in the
                        app (invoices, PDFs, reports, KPIs — money()/formatINR()) is hardcoded to
                        ₹ and 'en-IN' formatting with no exchange-rate/currency-aware pipeline
                        anywhere; picking USD saved correctly but changed nothing, anywhere, ever
                        — exactly the "saves but has no effect" bug. Real multi-currency support
                        (currency-aware formatting at every money() call site, GST/tax rules that
                        are India-specific regardless of currency, exchange rates for historical
                        invoices already stored in ₹) is a genuine feature project, not a QA fix.
                        Collapsed to the one currency this app actually supports, matching the
                        Timezone field's existing same-shape "one real option" pattern right next
                        to it — no illusion of a choice this app can't honor. */}
                    <Sel label={t('settings.field.currency', 'Currency')} value={biz.currency || 'INR'} onChange={(v) => bset({ currency: v })} options={[{ value: 'INR', label: '₹ INR' }]} />
                    <Sel label={t('settings.field.timezone', 'Timezone')} value={biz.timezone || 'IST'} onChange={(v) => bset({ timezone: v })} options={[{ value: 'IST', label: 'IST (India)' }]} />
                    {/* Language is a normal staged field — bset() only, exactly like Workshop
                        Name/GST Number/every other field on this page. Selecting a language
                        marks Settings dirty and shows Save Changes; the actual app-wide
                        locale only updates once Save Changes persists the whole `biz` object
                        (LanguageProvider reacts to that same write — see lib/i18n.js). Cancel
                        (setBiz(bizSaved)) reverts the dropdown to the last-saved language with
                        no special-case handling needed, since the active locale was never
                        touched pre-save. */}
                    <Sel label={t('settings.field.language', 'Language')} value={biz.language || locale} onChange={(v) => bset({ language: v })} options={Object.keys(locales).map((code) => ({ value: code, label: locales[code] }))} />
                  </div>
                </Card>
                <Card title={t('settings.branding.title', 'Branding')}>
                  <BrandingLogoField
                    t={t}
                    logoDataUrl={biz.logoDataUrl}
                    onUpload={handleLogoUpload}
                    onRemove={removeLogo}
                  />
                </Card>
              </div>
            </div>
          )}

          {section === 'billing' && (
            <div className={SETTINGS_GROUP_GRID}>
              <Card title={t('settings.billing.invoiceDefaults.title', 'Invoice Defaults')} desc={t('settings.billing.invoiceDefaults.desc', 'Defaults applied to new invoices & estimates. GST stays optional per invoice.')}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <SetTxt biz={biz} bset={bset} label="Default Labour Rate (₹/hr)" k="labourRate" placeholder="400" />
                  <SetTxt biz={biz} bset={bset} label="Default GST %" k="defaultTax" placeholder="18" />
                  <SetTxt biz={biz} bset={bset} label="Default Discount %" k="defaultDiscount" placeholder="0" />
                  <SetTxt biz={biz} bset={bset} label={t('settings.field.invoicePrefix', 'Invoice Prefix')} k="invPrefix" placeholder="INV" />
                  <SetTxt biz={biz} bset={bset} label="Estimate Prefix" k="estPrefix" placeholder="EST" />
                </div>
              </Card>
              <div className="space-y-4">
                <Card title={t('settings.billing.invoiceBehavior.title', 'Invoice Behavior')}>
                  <Toggle on={biz.gstOptional !== false} onChange={(v) => bset({ gstOptional: v })} label="GST Optional" desc="Allow invoices without GST (unregistered customers)." />
                  <Toggle on={biz.discountOptional !== false} onChange={(v) => bset({ discountOptional: v })} label="Discount Optional" desc="Allow per-line or invoice discounts." />
                  <Toggle on={biz.roundOff !== false} onChange={(v) => bset({ roundOff: v })} label="Round Off" desc="Round grand totals to the nearest rupee." />
                </Card>
                <Card title={t('settings.billing.footerLegal.title', 'Footer & Legal')} desc={t('settings.billing.footerLegal.desc', 'Printed on every invoice and estimate.')}>
                  <div className="space-y-3">
                    <SetTxt biz={biz} bset={bset} label="Invoice Footer" k="bizFooter" placeholder="Thank you for choosing us!" optional />
                    <SetTxt biz={biz} bset={bset} label="Invoice Terms" k="terms" placeholder="Standard workshop terms…" optional />
                    <SetTxt biz={biz} bset={bset} label="Bank / UPI Details" k="bankDetails" placeholder="A/C, IFSC, UPI ID…" optional />
                  </div>
                </Card>
              </div>
            </div>
          )}

          {section === 'jobcards' && (
            <div className={SETTINGS_GROUP_GRID}>
              <Card title={t('settings.jobcards.workflowDefaults.title', 'Workflow Defaults')} desc={t('settings.jobcards.workflowDefaults.desc', 'Defaults for new job cards. All job-card options live here only.')}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <SetTxt biz={biz} bset={bset} label="Job Card Prefix" k="jcPrefix" placeholder="SBBMC" />
                  <Sel label="Default Status" value={biz.jcStatus || 'Received'} onChange={(v) => bset({ jcStatus: v })} options={[{ value: 'Received', label: 'Received' }, { value: 'Inspection', label: 'Inspection' }]} />
                  <Sel label="Inspection Template" value={biz.jcTemplate || 'General Inspection'} onChange={(v) => bset({ jcTemplate: v })} options={[{ value: 'Major Service', label: 'Major Service' }, { value: 'Small Service', label: 'Small Service' }, { value: 'General Inspection', label: 'General Inspection' }, { value: 'EV Inspection', label: 'EV Inspection' }]} />
                  <SetTxt biz={biz} bset={bset} label="Estimated Delivery (hours)" k="jcDelivery" placeholder="24" />
                  <SetTxt biz={biz} bset={bset} label="Service Reminder Days" k="serviceReminderDays" placeholder="180" />
                </div>
              </Card>
              <Card title={t('settings.jobcards.automation.title', 'Automation')}>
                <Toggle on={biz.inspectionChecklist !== false} onChange={(v) => bset({ inspectionChecklist: v })} label="Inspection Checklist" desc="Show the inspection checklist on new job cards." />
              </Card>
            </div>
          )}

          {section === 'inventory' && (
            <div className={SETTINGS_CARD_MAX}>
              <Card title={t('settings.inventory.title', 'Inventory Settings')} desc={t('settings.inventory.desc', 'Thresholds that drive Low/Dead-stock badges and the Reorder Center.')}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <SetTxt biz={biz} bset={bset} label="Default Low Stock" k="lowStock" placeholder="5" />
                  <SetTxt biz={biz} bset={bset} label="Fast Mover (units sold)" k="fastMover" placeholder="10" />
                  <SetTxt biz={biz} bset={bset} label="Dead Stock (days unsold)" k="deadDays" placeholder="90" />
                  <SetTxt biz={biz} bset={bset} label="Reorder Top-up (× min)" k="reorderMult" placeholder="2" />
                </div>
              </Card>
            </div>
          )}

          {section === 'notifications' && (
            <div className={SETTINGS_CARD_MAX}>
              <Card title={t('settings.nav.notifications', 'Notifications')} desc={t('settings.notifications.desc', 'Only channels that are actually active are shown.')}>
                <Toggle on disabled label="In-app Notifications" desc="Always on — alerts & reminders appear inside the app." />
                <div className="h-px my-2" style={{ background: 'rgba(var(--fg-rgb),0.08)' }} />
                {[['remLowStock', 'Low Stock Alerts'], ['remCritical', 'Critical Stock Alerts'], ['remService', 'Service Due Reminder'], ['remPayment', 'Outstanding Payment Reminder']].map(([k, l]) => (
                  <Toggle key={k} on={biz[k] !== false} onChange={(v) => bset({ [k]: v })} label={l} />
                ))}
                <p className="text-[11px] text-white/45 mt-2">{t('settings.notifications.footnote', 'These drive the in-app Alerts & Reminders centres. External channels (SMS / WhatsApp / email) are not enabled.')}</p>
              </Card>
            </div>
          )}

          {section === 'appearance' && (
            <div className={SETTINGS_CARD_MAX}>
              <Card title={t('settings.nav.appearance', 'Appearance')} desc={t('settings.appearance.desc', 'Interface look & feel. Applies instantly and is remembered on this device.')}>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] uppercase tracking-wide text-white/45 mb-2">{t('settings.appearance.theme', 'Theme')}</label>
                    <Seg value={prefs.theme} onChange={(v) => updatePrefs({ theme: v })} options={[{ value: 'dark', label: 'Dark' }, { value: 'warm', label: 'Warm' }, { value: 'light', label: 'Light' }]} />
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase tracking-wide text-white/45 mb-2">{t('settings.appearance.fontSize', 'Font Size')}</label>
                    <Seg value={prefs.fontSize} onChange={(v) => updatePrefs({ fontSize: v })} options={[{ value: 'sm', label: 'Small' }, { value: 'md', label: 'Medium' }, { value: 'lg', label: 'Large' }]} />
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase tracking-wide text-white/45 mb-2">{t('settings.appearance.density', 'Density')}</label>
                    <Seg value={prefs.density || 'comfortable'} onChange={(v) => updatePrefs({ density: v })} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
                  </div>
                </div>
                <div className="mt-4">
                  <Toggle on={!!prefs.reduceMotion} onChange={(v) => updatePrefs({ reduceMotion: v })} label="Reduce Motion" desc="Minimise animations and transitions." />
                  <Toggle on={!!sidebarCollapsed} onChange={setCompact} label="Compact Sidebar" desc="Collapse the sidebar to icons by default." />
                </div>
              </Card>
            </div>
          )}

          {section === 'users' && isAdmin && (
            <div className={SETTINGS_GROUP_GRID}>
              <Card title="Admins" desc="Admins see cost prices, delete records, run exports and open Settings. New admins must re-login.">
                <div className="space-y-1.5 mb-3">
                  {bootstrapAdmins.map((e) => (
                    <div key={e} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.18)' }}>
                      <span className="text-sm text-white/85 truncate">{e}</span><span className="text-[10px] font-semibold text-[#d4af37] flex-shrink-0">OWNER · Admin</span>
                    </div>
                  ))}
                  {admins.filter((e) => !bootstrapAdmins.map((b) => b.toLowerCase()).includes(e.toLowerCase())).map((e) => (
                    <div key={e} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.08)' }}>
                      <span className="text-sm text-white/85 truncate">{e}</span><button onClick={() => onRemoveAdmin(e)} className="text-[10px] font-semibold text-red-400 hover:text-red-300 flex-shrink-0 ml-2">Remove admin</button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={newAdmin} onChange={(e) => setNewAdmin(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newAdmin.trim()) onAddAdmin(newAdmin).then((ok) => ok && setNewAdmin('')); }} placeholder="staff@email.com" className="flex-1 h-11 px-3 rounded-xl text-sm bg-white/5 border border-white/10 text-white outline-none focus:border-[#d4af37]/60" />
                  <button onClick={() => { if (newAdmin.trim()) onAddAdmin(newAdmin).then((ok) => ok && setNewAdmin('')); }} className="px-4 rounded-xl text-sm font-semibold text-black bg-[#d4af37] hover:bg-[#e8c84a] flex-shrink-0">Make admin</button>
                </div>
              </Card>
              <Card title="Staff Members" desc="Staff can always view stock and record sales. Grant extra permissions per person.">
                <div className="rounded-lg p-3 mb-3 text-[11px] leading-relaxed" style={{ background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.18)' }}>
                  <p className="text-white/70 mb-1 font-semibold">Adding a staff login (one-time):</p>
                  <p className="text-white/50">Create their login in <a href="https://console.firebase.google.com/project/_/authentication/users" target="_blank" rel="noreferrer" className="text-[#d4af37] underline">Firebase → Authentication</a>, then add the same email below and choose what they can do.</p>
                </div>
                <div className="space-y-2 mb-3">
                  {Object.keys(staffPerms).length === 0 ? <p className="text-[11px] text-white/45 px-1">No staff members yet.</p> : Object.entries(staffPerms).map(([email, p]) => (
                    <div key={email} className="rounded-lg p-3" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.08)' }}>
                      <div className="flex items-center justify-between mb-2"><span className="text-sm text-white/85 truncate">{email}</span><button onClick={() => onRemoveStaff(email)} className="text-[10px] font-semibold text-red-400 hover:text-red-300 flex-shrink-0 ml-2">Remove</button></div>
                      <div className="flex flex-wrap gap-2">
                        {[['costPrices', 'See cost prices'], ['deletes', 'Delete records'], ['exports', 'Run exports']].map(([key, label]) => (
                          <button key={key} onClick={() => onSetStaffPerm(email, key, !p?.[key])} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition" style={p?.[key] ? { background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.4)', color: '#34d399' } : { background: 'rgba(var(--fg-rgb),0.04)', border: '1px solid rgba(var(--fg-rgb),0.1)', color: 'rgba(var(--fg-rgb),0.5)' }}>
                            <span className="w-3 h-3 rounded-full flex items-center justify-center text-[8px]" style={{ background: p?.[key] ? '#34d399' : 'rgba(var(--fg-rgb),0.15)' }}>{p?.[key] ? '✓' : ''}</span>{label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={newStaff} onChange={(e) => setNewStaff(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newStaff.trim()) onAddStaff(newStaff).then((ok) => ok && setNewStaff('')); }} placeholder="newstaff@email.com" className="flex-1 h-11 px-3 rounded-xl text-sm bg-white/5 border border-white/10 text-white outline-none focus:border-[#d4af37]/60" />
                  <button onClick={() => { if (newStaff.trim()) onAddStaff(newStaff).then((ok) => ok && setNewStaff('')); }} className="px-4 rounded-xl text-sm font-semibold text-black bg-[#d4af37] hover:bg-[#e8c84a] flex-shrink-0">Add staff</button>
                </div>
              </Card>
            </div>
          )}

          {section === 'demoperms' && isAdmin && (
            <Card title="Demo Permissions" desc="Control what a Demo User can do. Disabled actions still show their button, but clicking shows an “administrator disabled” message. Changes apply immediately to any active Demo User session on this device.">
              {(() => {
                const ICONS = { Package, Users, Car, ClipboardList, Receipt, Truck, ShieldCheck, BarChart3 };
                const enabledCount = DEMO_PERM_GROUPS.reduce((n, g) => n + g.items.filter((it) => !!demoPerms[it.key]).length, 0);
                const totalCount = DEMO_PERM_GROUPS.reduce((n, g) => n + g.items.length, 0);
                return (
                  <div className="space-y-5">
                    <div className="flex items-center justify-between gap-2 pb-1">
                      <span className="text-[11px] text-white/45">{enabledCount} of {totalCount} permissions enabled</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}><AlertTriangle size={10} /> High-risk</span>
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                      {DEMO_PERM_GROUPS.map((group) => {
                        const GroupIcon = ICONS[group.icon] || Package;
                        return (
                          <div key={group.module}>
                            <div className="flex items-center gap-2 mb-2 px-0.5">
                              <span className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(212,175,55,0.12)' }}><GroupIcon size={13} className="text-[#d4af37]" /></span>
                              <h4 className="text-xs font-bold uppercase tracking-wide text-white/70">{group.module}</h4>
                            </div>
                            <div className="rounded-xl overflow-hidden divide-y" style={{ background: 'rgba(var(--fg-rgb),0.02)', border: '1px solid rgba(var(--fg-rgb),0.07)', borderColor: 'rgba(var(--fg-rgb),0.07)' }}>
                              {group.items.map((it) => (
                                <div key={it.key} className="px-3.5" style={{ borderColor: 'rgba(var(--fg-rgb),0.06)', boxShadow: it.danger ? 'inset 3px 0 0 rgba(245,158,11,0.5)' : 'none' }}>
                                  <Toggle
                                    on={!!demoPerms[it.key]}
                                    onChange={() => toggleDemoPerm(it.key)}
                                    label={<span className="flex items-center gap-1.5">{it.danger && <AlertTriangle size={12} className="text-amber-400 flex-shrink-0" />}<span className="font-medium">{it.title}</span></span>}
                                    desc={it.desc}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </Card>
          )}

          {section === 'security' && (
            <div className={SETTINGS_CARD_MAX}>
              <Card title="Security" desc="Session & sign-in. Roles are managed under Users & Roles.">
                <div className="max-w-xs">
                  <Sel label="Session Timeout" value={prefs.sessionTimeout || '30'} onChange={(v) => updatePrefs({ sessionTimeout: v })} options={[{ value: '15', label: '15 minutes' }, { value: '30', label: '30 minutes' }, { value: '60', label: '1 hour' }, { value: '0', label: 'Never' }]} />
                </div>
                <div className="mt-4 space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-white/45">Signed in as</span><span className="text-white/80 truncate ml-2">{userEmail || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-white/45">Role</span><span className="text-white/80">{demoMode ? (demoAdmin ? 'Demo Admin' : 'Demo User') : (isAdmin ? 'Admin' : 'Staff')}</span></div>
                  <div className="flex justify-between"><span className="text-white/45">Firebase</span><span style={{ color: online ? '#34d399' : '#ef4444' }}>{online ? 'Connected' : 'Offline'}</span></div>
                  <div className="flex justify-between"><span className="text-white/45">Last sync</span><span className="text-white/70">{lastSync ? lastSync.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</span></div>
                </div>
                <p className="text-[11px] text-white/45 mt-3">Password changes and device sessions are managed through your Firebase authentication account.</p>
              </Card>
            </div>
          )}

          {section === 'backup' && isAdmin && (
            <div className={SETTINGS_GROUP_GRID}>
              <Card title="Backup & Data" desc="Download a full JSON copy of every record, or restore from a backup file.">
                <div className="flex flex-col sm:flex-row gap-2">
                  <button onClick={onBackup} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-[#d4af37] bg-[#d4af37]/10 border border-[#d4af37]/30 hover:bg-[#d4af37]/20 flex items-center justify-center gap-2"><Download size={15} /> Backup now</button>
                  <button onClick={onRestore} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white/70 bg-white/5 border border-white/10 hover:bg-white/10 flex items-center justify-center gap-2"><Upload size={15} /> Restore from file</button>
                </div>
                <div className="flex justify-between text-[11px] pt-3"><span className="text-white/45">Last backup</span><span className="text-white/70">{lastBackup ? new Date(lastBackup).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never'}</span></div>
              </Card>
              <div className="rounded-2xl p-5" style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <h3 className="text-sm font-bold text-red-300/80 mb-1">Data Safety & Recovery</h3>
                <p className="text-xs text-white/45 mb-3">Reset moves the whole shop into a 7-day Recovery Vault you can restore from.</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                  {[['Last Backup', lastBackup ? new Date(lastBackup).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'], ['Last Reset', recoveryMeta?.createdAt ? new Date(recoveryMeta.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'], ['Recovery', recoveryActive ? 'Yes' : 'No'], ['Days Left', recoveryActive ? `${daysRemaining}` : '—']].map(([k, v]) => (
                    <div key={k} className="rounded-lg px-3 py-2" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}><div className="text-[9px] uppercase tracking-wide text-white/45">{k}</div><div className="text-sm font-semibold text-white/85">{v}</div></div>
                  ))}
                </div>
                {recoveryActive && (
                  <div className="rounded-lg p-3 mb-3 flex items-center justify-between gap-3 flex-wrap" style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.25)' }}>
                    <div><div className="text-sm font-semibold text-emerald-300">Recovery Vault active</div><div className="text-[11px] text-white/50">{recoveryMeta.total} records · expires in {daysRemaining} day{daysRemaining === 1 ? '' : 's'}</div></div>
                    <button disabled={restoreBusy} onClick={async () => { if (!await confirmDialog({ title: 'Restore from Recovery Vault?', message: 'Brings your shop back exactly as it was before the reset.', confirmText: 'Restore' })) return; setRestoreBusy(true); await onRestoreVault(); setRestoreBusy(false); }} className="px-4 py-2 rounded-lg text-sm font-bold text-black bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 flex items-center gap-2"><ArchiveRestore size={15} /> {restoreBusy ? 'Restoring…' : 'Restore Now'}</button>
                  </div>
                )}
                <button onClick={() => { setResetStep(1); setResetText(''); }} className="px-4 py-2 rounded-lg text-sm font-semibold text-red-300 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 flex items-center gap-2"><Trash2 size={15} /> Reset All Data</button>
              </div>
            </div>
          )}

          {section === 'about' && (
            <div className={SETTINGS_CARD_MAX}>
              <Card title="About">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
                  {[['Version', `v${APP_VERSION}`], ['Product', 'Balaji Auto OS'], ['Database', demoMode ? 'Demo (local)' : 'Firebase Firestore'], ['Connection', online ? 'Connected' : 'Offline'], ['Total records', totalRecords.toLocaleString('en-IN')], ['Support', 'support@balajiautoos.com']].map(([k, v]) => (
                    <div key={k} className="flex justify-between rounded-lg px-3 py-2" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}><span className="text-white/45">{k}</span><span className="text-white/85">{v}</span></div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {editableSections.includes(section) && (
            <div className={`sticky bottom-0 flex items-center justify-between gap-3 rounded-2xl px-4 py-3 ${SETTINGS_WIDE_SECTIONS.has(section) ? '' : SETTINGS_CARD_MAX}`} style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.2)' }}>
              <span className="text-[11px] text-white/45">{dirty ? t('state.unsavedChanges', 'You have unsaved changes') : t('state.allChangesSaved', 'All changes saved')}</span>
              <div className="flex gap-2">
                <button onClick={() => setBiz(bizSaved)} disabled={!dirty} className="px-4 py-2 rounded-xl text-xs font-semibold bg-white/5 border border-white/10 text-white/70 disabled:opacity-40">{t('common.cancel', 'Cancel')}</button>
                <button onClick={saveBiz} disabled={!dirty} className="px-5 py-2 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] disabled:opacity-40">{t('common.saveChanges', 'Save Changes')}</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {resetStep > 0 && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }} onClick={(e) => { if (e.target === e.currentTarget && !resetBusy) setResetStep(0); }}>
          <div className="w-full max-w-md rounded-2xl p-5" style={{ background: 'var(--surface-2)', border: '1px solid rgba(239,68,68,0.35)' }}>
            {resetStep === 1 ? (
              <>
                <div className="flex items-center gap-2 mb-3"><AlertTriangle size={20} className="text-red-400" /><h3 className="text-base font-bold text-white">Reset entire system?</h3></div>
                <p className="text-sm text-white/65 leading-relaxed mb-4">This removes all inventory, suppliers, sales, stock movements, alerts, analytics and reports. A 7-day Recovery Vault is created first.</p>
                <div className="flex gap-2 justify-end"><button onClick={() => setResetStep(0)} className="px-4 py-2 rounded-lg text-sm font-semibold text-white/70 bg-white/5 border border-white/15 hover:bg-white/10">Cancel</button><button onClick={() => setResetStep(2)} className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-red-500/80 hover:bg-red-500">Continue</button></div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-3"><AlertTriangle size={20} className="text-red-400" /><h3 className="text-base font-bold text-white">Type RESET to confirm</h3></div>
                <p className="text-sm text-white/65 leading-relaxed mb-3">Your data goes to the Recovery Vault for 7 days. Type <span className="font-bold text-red-300">RESET</span> to proceed.</p>
                <input autoFocus value={resetText} onChange={(e) => setResetText(e.target.value)} placeholder="RESET" className="w-full h-11 px-3 rounded-lg bg-white/5 border border-white/15 text-white text-center font-bold tracking-widest mb-4 focus:outline-none focus:border-red-400" />
                <div className="flex gap-2 justify-end"><button disabled={resetBusy} onClick={() => setResetStep(0)} className="px-4 py-2 rounded-lg text-sm font-semibold text-white/70 bg-white/5 border border-white/15 hover:bg-white/10 disabled:opacity-50">Cancel</button><button disabled={resetText !== 'RESET' || resetBusy} onClick={async () => { setResetBusy(true); const ok = await onResetAllData(); setResetBusy(false); if (ok) setResetStep(0); }} className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-red-600 hover:bg-red-500 disabled:opacity-40 flex items-center gap-2"><Trash2 size={15} /> {resetBusy ? 'Resetting…' : 'Reset Everything'}</button></div>
              </>
            )}
          </div>
        </div>
      )}
    </PageHeader>
  );
}

export default SettingsView;
