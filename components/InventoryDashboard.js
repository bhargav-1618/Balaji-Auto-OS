// components/InventoryDashboard.js
// Sri Baba Balaji Auto OS — "Luxury Dealership" Inventory Dashboard
// Single-file, production-ready. Next.js + Tailwind + Lucide + Firestore (offline-first, Base64 images).

import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from 'react';
import Modal from './Modal';
import InventoryOverview from './inventory/InventoryOverview';
import InventoryArchive from './inventory/InventoryArchive';
import InventoryCategories from './inventory/InventoryCategories';
import InventoryStock from './inventory/InventoryStock';
import InventoryReports from './inventory/InventoryReports';
import SupplierPerformance from './inventory/SupplierPerformance';
import InventoryPurchaseOrders from './inventory/InventoryPurchaseOrders';
import SupplierPOBuilder from './inventory/SupplierPOBuilder';
import SupplierDirectory from './inventory/SupplierDirectory';
import JobCardModule from './jobcards/JobCardModule';
import CustomersModule from './customers/CustomersModule';
import VehiclesModule from './vehicles/VehiclesModule';
import RemindersModule from './reminders/RemindersModule';
import BootSplash from './common/BootSplash';
import { ConfirmHost, confirmDialog } from './common/ConfirmDialog';
import Toggle from './common/Toggle';
import { lockBody, unlockBody, assertBodyUnlockedIfNoModals } from './Modal';
import BillingModule from './billing/BillingModule';
import { getGarageSeed } from '../lib/demoGarageSeed';
import { computeRange, ratingFor, computeInventoryHealth, computeWorkshopScore, computeAlerts, computeInsights, computeAchievements } from '../services/analyticsService';
import { safeLower, formatINR, digitsOnly, tenDigits, normalizePhone, toIndianPhone, isValidIndianPhone, phoneInput, waNumber, tsToDate, isSameDay, trendPct } from '../lib/format';
import { buildPO, poCreateDoc, poAdvanceDoc, poCancelDoc } from '../services/purchaseOrderService';
import { catMatches, remapCatFields, renameCategoryDocs, deleteCategoryDocs } from '../services/inventoryService';
import { normalizeText, tokenize, SLANG_MAP, expandToken } from '../lib/search';
import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  getDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  limit,
  increment,
  writeBatch,
  runTransaction,
  getDocs,
} from 'firebase/firestore';
import { useRouter } from 'next/router';
import toast from 'react-hot-toast';
import { db, auth, signOut } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { getDemoData } from '../lib/demoData';
import { LIMITS, TAB_KEYS, COLLECTIONS } from '../constants';
import { createStore } from '../services/persistenceStore';
import { clearBusinessCaches } from '../lib/session';
import { imageForPartName } from '../lib/partImages';
import {
  Search,
  Mic,
  Plus,
  Minus,
  Edit3,
  Trash2,
  X,
  Upload,
  ImageOff,
  PackageSearch,
  AlertTriangle, Bell, Receipt,
  PackageX,
  Loader2,
  LogOut,
  User,
  MessageCircle,
  Package,
  Users,
  Download,
  Phone,
  ShieldCheck,
  FlaskConical,
  TrendingUp,
  ShoppingCart,
  BarChart3,
  MapPin,
  Zap,
  Archive,
  ArchiveRestore,
  History,
  Copy,
  Car,
  Send,
  Star,
  PackagePlus,
  Filter,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Settings,
  Wrench,
  FileText,
  LayoutDashboard,
  MoreHorizontal,
  ChevronRight,
  Calendar,
  Check,
  Sparkles,
  Trophy,
  RefreshCw,
  ClipboardList,
  Menu,
  Camera, Truck,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Firebase: uses the shared `db` instance from lib/firebase.js
// (that file already calls enableMultiTabIndexedDbPersistence once at
// app startup — initializing Firestore a second time here would throw
// "Firestore has already been started" since persistence can only be
// enabled before any other Firestore method is called.)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Requirement 1: null-safe lowercase — used everywhere for search/compare
// Issue 3: lightweight singular form so "perfume" and "perfumes" collapse to one
// category. Handles common English plurals (-ies→-y, -ses/-xes/-zes→base, -s→base).
const singularize = (val) => {
  let s = safeLower(val).trim();
  if (s.length <= 3) return s; // don't mangle short words (e.g. "abs")
  if (/ies$/.test(s)) return s.replace(/ies$/, 'y');
  if (/(s|x|z|ch|sh)es$/.test(s)) return s.replace(/es$/, '');
  if (/ss$/.test(s)) return s; // glass, brass — keep
  if (/s$/.test(s)) return s.replace(/s$/, '');
  return s;
};

// Comprehensive auto spare-part categories (Indian aftermarket)
const DEFAULT_CATEGORIES = [
  'Engine Oil & Fluids',
  'Engine Components',
  'Pistons & Rings',
  'Cylinder Head',
  'Gaskets & Seals',
  'Timing Belt & Chain',
  'Belts & Hoses',
  'Air Filters',
  'Oil Filters',
  'Fuel Filters',
  'Cabin / AC Filters',
  'Braking System',
  'Brake Pads',
  'Brake Discs & Rotors',
  'Brake Shoes',
  'Brake Cables',
  'Clutch & Transmission',
  'Clutch Plates',
  'Gearbox Parts',
  'Suspension & Steering',
  'Shock Absorbers',
  'Struts & Springs',
  'Ball Joints',
  'Tie Rods',
  'Control Arms',
  'Wheel Bearings',
  'Bushes & Mountings',
  'Electrical & Batteries',
  'Batteries',
  'Alternators',
  'Starter Motors',
  'Ignition Coils',
  'Spark Plugs',
  'Glow Plugs',
  'Wiring & Fuses',
  'Sensors',
  'Switches & Relays',
  'Lighting & Indicators',
  'Headlight Bulbs',
  'Headlamp Assembly',
  'Tail Lights',
  'Fog Lamps',
  'Indicators',
  'Wiper Blades',
  'Wiper Motor & Linkage',
  'Side Mirrors',
  'Mirrors & Glass',
  'Windshield Glass',
  'Body Parts',
  'Bonnet & Fenders',
  'Doors & Handles',
  'Bumpers & Grilles',
  'Radiator & Cooling',
  'Radiator',
  'Coolant & Hoses',
  'Water Pump',
  'Cooling Fan',
  'AC System',
  'AC Compressor',
  'AC Condenser',
  'Blower Motor',
  'Exhaust & Silencer',
  'Catalytic Converter',
  'Fuel System',
  'Fuel Pump',
  'Fuel Injectors',
  'Carburetor',
  'Horns',
  'Bearings & Bushings',
  'Nuts, Bolts & Clips',
  'Tyres & Wheels',
  'Wheel Rims',
  'Wheel Caps',
  'Seat Covers & Mats',
  'Floor Mats',
  'Interior Accessories',
  'Exterior Accessories',
  'Lubricants & Grease',
  'Car Care & Cleaning',
  'Adhesives & Sealants',
  'Tools & Equipment',
  'Consumables',
];

// Comprehensive Indian car models (legacy + current), spanning all major brands
const DEFAULT_VEHICLES = [
  'Universal / All Vehicles',
  // Maruti Suzuki
  'Maruti 800', 'Maruti Omni', 'Maruti Zen', 'Maruti Zen Estilo', 'Maruti Alto',
  'Maruti Alto 800', 'Maruti Alto K10', 'Maruti WagonR', 'Maruti Swift', 'Maruti Swift Dzire',
  'Maruti Dzire', 'Maruti Ritz', 'Maruti A-Star', 'Maruti Celerio', 'Maruti Baleno',
  'Maruti Ignis', 'Maruti Brezza', 'Maruti Vitara Brezza', 'Maruti Ertiga', 'Maruti XL6',
  'Maruti Ciaz', 'Maruti S-Cross', 'Maruti S-Presso', 'Maruti Eeco', 'Maruti Grand Vitara',
  'Maruti Fronx', 'Maruti Jimny', 'Maruti Esteem', 'Maruti Versa', 'Maruti SX4', 'Maruti Gypsy',
  // Hyundai
  'Hyundai Santro', 'Hyundai Santro Xing', 'Hyundai Eon', 'Hyundai i10', 'Hyundai Grand i10',
  'Hyundai Grand i10 Nios', 'Hyundai Getz', 'Hyundai i20', 'Hyundai Elite i20', 'Hyundai i20 Active',
  'Hyundai Accent', 'Hyundai Xcent', 'Hyundai Aura', 'Hyundai Verna', 'Hyundai Fluidic Verna',
  'Hyundai Creta', 'Hyundai Venue', 'Hyundai Exter', 'Hyundai Alcazar', 'Hyundai Tucson',
  'Hyundai Elantra', 'Hyundai Kona', 'Hyundai Santa Fe',
  // Tata
  'Tata Indica', 'Tata Indica Vista', 'Tata Indigo', 'Tata Indigo Marina', 'Tata Sumo',
  'Tata Sumo Gold', 'Tata Safari', 'Tata Safari Storme', 'Tata Aria', 'Tata Nano',
  'Tata Bolt', 'Tata Zest', 'Tata Tiago', 'Tata Tigor', 'Tata Altroz', 'Tata Nexon',
  'Tata Punch', 'Tata Harrier', 'Tata Hexa', 'Tata Curvv',
  // Mahindra
  'Mahindra Scorpio', 'Mahindra Scorpio Classic', 'Mahindra Scorpio-N', 'Mahindra Bolero',
  'Mahindra Bolero Neo', 'Mahindra XUV300', 'Mahindra XUV400', 'Mahindra XUV500', 'Mahindra XUV700',
  'Mahindra Thar', 'Mahindra Marazzo', 'Mahindra KUV100', 'Mahindra TUV300', 'Mahindra Xylo',
  'Mahindra Verito', 'Mahindra Quanto', 'Mahindra Alturas G4', 'Mahindra Logan',
  // Toyota
  'Toyota Qualis', 'Toyota Innova', 'Toyota Innova Crysta', 'Toyota Innova Hycross', 'Toyota Fortuner',
  'Toyota Etios', 'Toyota Etios Liva', 'Toyota Corolla', 'Toyota Corolla Altis', 'Toyota Camry',
  'Toyota Glanza', 'Toyota Urban Cruiser', 'Toyota Urban Cruiser Hyryder', 'Toyota Yaris', 'Toyota Land Cruiser',
  // Honda
  'Honda City', 'Honda Amaze', 'Honda Jazz', 'Honda Brio', 'Honda Mobilio', 'Honda BR-V',
  'Honda WR-V', 'Honda Civic', 'Honda CR-V', 'Honda Accord', 'Honda Elevate',
  // Kia
  'Kia Seltos', 'Kia Sonet', 'Kia Carens', 'Kia Carnival', 'Kia EV6',
  // Skoda
  'Skoda Octavia', 'Skoda Rapid', 'Skoda Superb', 'Skoda Fabia', 'Skoda Laura',
  'Skoda Slavia', 'Skoda Kushaq', 'Skoda Kodiaq',
  // Volkswagen
  'Volkswagen Polo', 'Volkswagen Vento', 'Volkswagen Virtus', 'Volkswagen Taigun',
  'Volkswagen Ameo', 'Volkswagen Tiguan', 'Volkswagen Jetta',
  // Renault
  'Renault Kwid', 'Renault Kiger', 'Renault Triber', 'Renault Duster', 'Renault Captur',
  'Renault Lodgy', 'Renault Pulse', 'Renault Scala', 'Renault Fluence',
  // Nissan / Datsun
  'Nissan Magnite', 'Nissan Micra', 'Nissan Sunny', 'Nissan Terrano', 'Nissan Kicks',
  'Datsun Go', 'Datsun Go Plus', 'Datsun Redi-Go',
  // Ford
  'Ford Figo', 'Ford Aspire', 'Ford EcoSport', 'Ford Endeavour', 'Ford Fiesta',
  'Ford Ikon', 'Ford Freestyle',
  // Chevrolet
  'Chevrolet Beat', 'Chevrolet Spark', 'Chevrolet Sail', 'Chevrolet Cruze', 'Chevrolet Tavera',
  'Chevrolet Aveo', 'Chevrolet Optra', 'Chevrolet Enjoy',
  // MG
  'MG Hector', 'MG Astor', 'MG Gloster', 'MG ZS EV', 'MG Comet',
  // Others
  'Fiat Punto', 'Fiat Linea', 'Jeep Compass', 'Jeep Meridian', 'Force Gurkha', 'Isuzu D-Max',
];


// Does the part's searchable text satisfy every spoken token (or its synonym)?
function partMatchesTokens(part, tokens) {
  if (!tokens.length) return true;
  const hay = normalizeText(
    [part.name, part.sku, part.category, categoriesStr(part), part.vehicle, compatStr(part), part.locationBin]
      .filter(Boolean)
      .join(' ')
  );
  return tokens.every((tok) => expandToken(tok).some((cand) => hay.includes(cand)));
}

// FEATURE 2 + 4: analytics + compatibility helpers
const SHOP_NAME = 'SRI BABA BALAJI MARUTI CARE';
// The owner can override the shop name / contact from Settings → Business Profile.
// ---- Body scroll lock (iOS-safe, reference-counted) ----
// Body scroll locking lives in ONE place: components/Modal.js. This file used to
// keep a SECOND, independent lock counter, and the two didn't cooperate — when a
// modal from one implementation closed, it cleared document.body's inline styles
// even though a modal from the other was still open (and vice-versa). That left
// the page either locked with nothing open (can't scroll at all) or unlocked
// behind an open modal (background scrolls / scroll gets "stuck"). Sharing a
// single reference-counted lock removes that whole class of bug.
// Hook form: lock for the lifetime of a mounted modal component.
function useBodyScrollLock(enabled = true) {
  useEffect(() => { if (!enabled) return undefined; const t = lockBody(); return () => unlockBody(t); }, [enabled]);
}

// True when the viewport is phone-sized (<768px). On phones the long forms render
// as full-screen pages with NATIVE document scrolling (no modal, no viewport math),
// which sidesteps every iOS Safari / Android modal-scroll bug. Desktop/tablet keep
// the modal. SSR-safe: starts false, resolves on mount, updates on resize.
function useIsMobile(breakpoint = 768) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const apply = () => setMobile(mq.matches);
    apply();
    mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply);
    return () => { mq.removeEventListener ? mq.removeEventListener('change', apply) : mq.removeListener(apply); };
  }, [breakpoint]);
  return mobile;
}

// Full-screen mobile page shell: normal document flow (native body scroll), a
// sticky back header, and children below. Shared by every long form so phones get
// consistent native scrolling with no modal/viewport math.
function MobileFormPage({ title, onClose, children }) {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--surface-0)' }}>
      <div
        className="sticky top-0 z-20 flex items-center gap-2 px-3 py-3"
        style={{ background: 'var(--surface-1)', borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}
      >
        <button type="button" onClick={onClose} aria-label="Back" className="w-10 h-10 -ml-1 rounded-full flex items-center justify-center text-white/75 active:bg-white/10 transition">
          <ChevronLeft size={24} />
        </button>
        <div className="text-base font-bold bg-gradient-to-r from-[#d4af37] to-[#aa801e] bg-clip-text text-transparent">{title}</div>
      </div>
      {children}
    </div>
  );
}

// These read the saved value at call time, falling back to the default constant,
// so the name actually flows into the header, exports and purchase orders.
function getShopName() { try { return (localStorage.getItem('maruti_biz_name') || '').trim() || SHOP_NAME; } catch { return SHOP_NAME; } }
function getShopContact() { try { return (localStorage.getItem('maruti_biz_contact') || '').trim(); } catch { return ''; } }
function getShopGst() { try { return (localStorage.getItem('maruti_biz_gst') || '').trim(); } catch { return ''; } }
function getShopAddress() { try { return (localStorage.getItem('maruti_biz_address') || '').trim(); } catch { return ''; } }
// One-line shop footer for purchase orders: name, address, phone, GST (when set).
function shopSignature() {
  const parts = [getShopName()];
  if (getShopAddress()) parts.push(getShopAddress());
  if (getShopContact()) parts.push(`Ph: ${getShopContact()}`);
  if (getShopGst()) parts.push(`GSTIN: ${getShopGst()}`);
  return parts.join('\n');
}
const APP_VERSION = '12.4.0-rc.1';
const FAST_MOVER_MIN = 10; // default; owner can override in Settings → Inventory Behavior
// A part qualifies as a Fast Mover only after this many units sold.
const DEAD_STOCK_DAYS = 90; // default; owner can override in Settings
const REORDER_MULTIPLIER = 2; // default reorder top-up = minStock × this − stock
// These read the owner's saved value at call time, falling back to the default.
function getFastMoverMin() { try { const v = parseInt(localStorage.getItem('maruti_fast_mover_min'), 10); return Number.isFinite(v) && v > 0 ? v : FAST_MOVER_MIN; } catch { return FAST_MOVER_MIN; } }
function getDeadStockDays() { try { const v = parseInt(localStorage.getItem('maruti_dead_stock_days'), 10); return Number.isFinite(v) && v > 0 ? v : DEAD_STOCK_DAYS; } catch { return DEAD_STOCK_DAYS; } }
function getReorderMultiplier() { try { const v = parseFloat(localStorage.getItem('maruti_reorder_mult')); return Number.isFinite(v) && v >= 1 ? v : REORDER_MULTIPLIER; } catch { return REORDER_MULTIPLIER; } }
const lockedCapital = (p) => (p.purchasePrice || 0) * (p.stock || 0);
const expectedProfit = (p) => ((p.sellingPrice || 0) - (p.purchasePrice || 0)) * (p.stock || 0);
// Issue 5: dead stock is about STALENESS, not quantity. A never-sold item that
// has been sitting (since last restock / creation) past the threshold. A fresh
// never-sold item is NOT dead stock yet.
const isDeadStock = (p) => {
  if ((p.salesCount || 0) !== 0 || (p.stock || 0) <= 0) return false;
  const age = ageDays(p);
  return age != null && age >= getDeadStockDays();
};
const deadStockReason = (p) => {
  const age = ageDays(p);
  return age != null ? `No sales recorded · unsold for ${age} days (≥ ${getDeadStockDays()}).` : 'No sales recorded.';
};
const isFastMover = (p) => (p.salesCount || 0) >= getFastMoverMin();
// Firestore Timestamp → JS Date → age in days (uses createdAt as the stock-in date).
const ageDays = (p) => { const d = tsToDate(p?.lastRestockedAt) || tsToDate(p?.createdAt); return d ? Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000)) : null; };
// Array-safe readers — compatibleCars/categories may be arrays (tree-select) or
// legacy comma strings.
const asList = (v) => (Array.isArray(v) ? v : v ? String(v).split(',').map((x) => x.trim()).filter(Boolean) : []);
// #3: compatibleCars is stored grouped as [{ brand, models:[...] }]. These read
// it back into a flat model list (also tolerating legacy flat arrays/strings).
const flattenVehicles = (v) => {
  if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
    return v.flatMap((g) => (Array.isArray(g?.models) ? g.models : []));
  }
  return asList(v);
};
const compatModels = (p) => flattenVehicles(p?.compatibleCars);
const compatStr = (p) => compatModels(p).join(' ');
const categoriesStr = (p) => asList(p.categories).join(' ');
const partIsUniversal = (p) =>
  normalizeText([p.vehicle, compatStr(p)].join(' ')).includes('universal');

// #5 + #6: built-in Indian-market taxonomies for the Tree-Selects.
const VEHICLE_TREE = [
  { label: 'Maruti Suzuki', children: ['Alto', 'S-Presso', 'Celerio', 'Wagon R', 'Swift', 'Dzire', 'Baleno', 'Ignis', 'Ciaz', 'Ertiga', 'XL6', 'Brezza', 'Fronx', 'Grand Vitara', 'Jimny', 'Eeco'] },
  { label: 'Hyundai', children: ['Grand i10 Nios', 'i20', 'Aura', 'Verna', 'Venue', 'Creta', 'Alcazar', 'Tucson', 'Exter', 'Ioniq 5'] },
  { label: 'Tata', children: ['Tiago', 'Tigor', 'Altroz', 'Punch', 'Nexon', 'Harrier', 'Safari', 'Curvv'] },
  { label: 'Mahindra', children: ['Bolero', 'Bolero Neo', 'Scorpio', 'Scorpio-N', 'Thar', 'XUV300', 'XUV400', 'XUV700', 'Marazzo'] },
  { label: 'Honda', children: ['Amaze', 'City', 'Elevate', 'WR-V'] },
  { label: 'Toyota', children: ['Glanza', 'Urban Cruiser', 'Rumion', 'Innova Crysta', 'Innova Hycross', 'Fortuner', 'Hyryder'] },
  { label: 'Kia', children: ['Sonet', 'Seltos', 'Carens', 'Syros', 'EV6'] },
  { label: 'Renault', children: ['Kwid', 'Triber', 'Kiger'] },
  { label: 'Nissan', children: ['Magnite'] },
  { label: 'Volkswagen', children: ['Polo', 'Virtus', 'Taigun'] },
  { label: 'Skoda', children: ['Slavia', 'Kushaq', 'Kylaq'] },
  { label: 'MG', children: ['Comet', 'Astor', 'Hector', 'Gloster', 'Windsor'] },
  { label: 'Ford (legacy)', children: ['Figo', 'Aspire', 'EcoSport', 'Endeavour'] },
  { label: 'Universal', children: ['Universal / All Vehicles'] },
];

// Issue 6/8: the base name without a "(copy)" / "(copy N)" suffix.
const baseName = (s) => safeLower(s).replace(/\s*\(copy(?:\s*\d+)?\)\s*$/i, '').trim();
// Copy-workflow: a name is a copy iff it ends in "(copy)"; strip it (keeping case).
const isCopyName = (s) => /\(copy(?:\s*\d+)?\)\s*$/i.test((s || '').toString());
const stripCopySuffix = (s) => (s || '').toString().replace(/\s*\(copy(?:\s*\d+)?\)\s*$/i, '').trim();
// Issue 14: normalize a brand/model to Title Case so "lexus"/"LEXUS" collapse to
// one entry (true typo-correction like "lexsus" is out of scope).
const titleCase = (s) => safeLower(s).trim().replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
// #3: turn a flat list of selected models into [{ brand, models:[...] }].
// Accepts a runtime tree so custom (user-added) vehicles map to their real brand.
function groupVehicles(models, tree = VEHICLE_TREE) {
  const byBrand = new Map();
  asList(models).forEach((m) => {
    const node = tree.find((n) => n.children.includes(m));
    const brand = node ? node.label : 'Other';
    if (!byBrand.has(brand)) byBrand.set(brand, []);
    if (!byBrand.get(brand).includes(m)) byBrand.get(brand).push(m);
  });
  return [...byBrand.entries()].map(([brand, mods]) => ({ brand, models: mods }));
}

const CATEGORY_TREE = [
  { label: 'Filters', children: ['Air Filter', 'Oil Filter', 'Cabin Filter', 'Fuel Filter'] },
  { label: 'Brake Parts', children: ['Brake Pad', 'Brake Disc', 'Brake Shoe', 'Brake Fluid'] },
  { label: 'Suspension', children: ['Shock Absorber', 'Strut', 'Control Arm', 'Ball Joint', 'Link Rod'] },
  { label: 'Engine', children: ['Spark Plug', 'Timing Belt', 'Engine Oil', 'Gasket', 'Piston', 'Drive Belt'] },
  { label: 'Electrical', children: ['Battery', 'Alternator', 'Starter Motor', 'Fuse', 'Relay', 'Wiring'] },
  { label: 'Cooling & AC', children: ['Radiator', 'AC Compressor', 'Coolant', 'Condenser', 'AC Gas'] },
  { label: 'Lighting', children: ['Headlight', 'Tail Light', 'Indicator', 'Bulb', 'Fog Lamp'] },
  { label: 'Body & Exterior', children: ['Wiper Blade', 'Side Mirror', 'Bumper', 'Door Handle', 'Grille'] },
  { label: 'Transmission', children: ['Clutch Plate', 'Gear Oil', 'Flywheel', 'Clutch Cable'] },
  { label: 'Consumables', children: ['Grease', 'Sealant', 'Cleaner', 'Polish'] },
];

// ---- Supplier contact helpers (FIX 3: labeled multi-contact cards) ----
// Returns [{ number, label }] from the new phoneNumbers schema, falling back to
// legacy phones[]/phone so old records keep working.
function getSupplierContacts(supplier) {
  if (Array.isArray(supplier?.phoneNumbers) && supplier.phoneNumbers.length) {
    return supplier.phoneNumbers
      .filter((c) => c && tenDigits(c.number))
      .map((c) => ({ number: tenDigits(c.number), label: c.label || 'Primary' }));
  }
  const legacy = [];
  if (supplier?.phone) legacy.push({ number: tenDigits(supplier.phone), label: 'Primary' });
  if (Array.isArray(supplier?.phones)) {
    supplier.phones.forEach((p, i) => {
      const n = tenDigits(p);
      if (n && !legacy.some((c) => c.number === n)) legacy.push({ number: n, label: i === 0 ? 'Primary' : 'Alternate' });
    });
  }
  return legacy.filter((c) => c.number);
}
const getSupplierPrimaryPhone = (supplier) =>
  normalizePhone(getSupplierContacts(supplier)[0]?.number || supplier?.primaryPhone || supplier?.phone || '');

// Normalise a supplier record's phone list (new schema + legacy)
function getSupplierPhones(supplier) {
  return [...new Set(getSupplierContacts(supplier).map((c) => c.number).filter(Boolean))];
}

// ---- FIX 2: corporate-grade WhatsApp purchase-order message ----
// UPDATE-10: suggested reorder qty = top the part back up to ~2× its min level.
const suggestedOrderQty = (p) => Math.max(1, Math.round((p.minStock || 5) * getReorderMultiplier()) - (p.stock || 0));

function buildPurchaseOrder(part, supplierName) {
  return `Hello ${supplierName || 'Supplier'},

This is an automated Purchase Order issued from our workshop inventory manager.

We are running low on the following item and require a restock order:
• Part Name: ${part.name || 'N/A'}
• SKU / Part No: ${part.sku || 'N/A'}
• Category: ${part.category || 'N/A'}
• Current On-Hand Stock: ${part.stock ?? 0} units
• Quantity Required: ${suggestedOrderQty(part)} units

Please reply with pricing confirmation, bulk discount structures, and an estimated delivery timeline.

Thank you.
${shopSignature()}`;
}

// ---- FEATURE 3: bulk purchase order (multiple parts in one message) ----
function buildBulkPO(supplierName, parts) {
  const lines = parts
    .map((p) => `• ${p.name} (SKU: ${p.sku || 'N/A'}) — On-hand: ${p.stock ?? 0} · Please supply: ${suggestedOrderQty(p)} units`)
    .join('\n');
  return `Hello ${supplierName || 'Supplier'},

Bulk Purchase Order from ${getShopName()}.

We are running low and require a restock of the following items:
${lines}

Please reply with pricing confirmation, bulk discount structures, and an estimated delivery timeline.

Thank you.
${shopSignature()}`;
}

// Normalise a part's supplier list, supporting both the new `suppliers[]`
// schema and the legacy single supplier/supplierPhone fields.
function getPartSuppliers(part) {
  if (Array.isArray(part?.suppliers) && part.suppliers.length) {
    return part.suppliers
      .filter((s) => s && (s.name || s.phone))
      .map((s) => ({
        id: s.id || '',
        name: s.name || '',
        phone: tenDigits(s.phone),
        preferredLabel: s.preferredLabel || 'Primary',
        isPreferred: !!s.isPreferred,
      }));
  }
  if (part?.supplier) {
    return [{ id: '', name: part.supplier, phone: tenDigits(part.supplierPhone), preferredLabel: 'Primary', isPreferred: true }];
  }
  return [];
}

// All names a supplier answers to (primary + alternates)
function getSupplierNames(supplier) {
  const alts = Array.isArray(supplier?.altNames) ? supplier.altNames : [];
  return [supplier?.name, ...alts].filter(Boolean);
}

// ---------------------------------------------------------------------------
// Image thumbnail with hover preview (Base64)
// ---------------------------------------------------------------------------
function PartImageThumb({ src, alt, onHover, onMove, onLeave }) {
  const { demoMode: demo = false } = useAuth(); // demo => mandatory matched photo; production => optional
  // Issue 1: if the image is missing OR fails to load (broken/invalid Base64),
  // fall back to the placeholder. Without this, a broken <img> collapses to a
  // thin sliver and only its gold border renders — the "thin yellow line".
  const [errored, setErrored] = useState(false);
  // Issue #5: when no external hover handler is supplied (e.g. the Overview /
  // Reorder / Low-stock widgets), the thumbnail manages its OWN enlarged preview
  // so hover works everywhere — not just the inventory table.
  const external = typeof onHover === 'function';
  const [preview, setPreview] = useState(null); // {x,y} for the self-contained preview
  useEffect(() => { setErrored(false); }, [src]); // reset when the row is reused

  // Image separation: in DEMO, every part gets a realistic catalog photo matched
  // by name (mandatory imagery). In PRODUCTION, images are optional — show the
  // real uploaded photo if present, otherwise a clean category icon (never a
  // forced/demo image). Hover preview is enabled only when an image exists.
  const realSrc = (!src || errored) ? null : src;
  const effectiveSrc = realSrc || (demo ? imageForPartName(alt || '') : null);
  const hasImage = !!effectiveSrc;

  if (!effectiveSrc) {
    return (
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: 'rgba(var(--fg-rgb),0.05)', border: '1px solid rgba(var(--fg-rgb),0.08)' }}
        title="No image"
      >
        <Package size={14} className="text-white/30" />
      </div>
    );
  }

  // Clamp the self-preview so it never overflows the viewport.
  const previewPos = preview ? (() => {
    const size = 200, pad = 16, off = 18;
    let left = preview.x + off, top = preview.y + off;
    if (typeof window !== 'undefined') {
      if (left + size + pad > window.innerWidth) left = preview.x - size - off;
      if (top + size + pad > window.innerHeight) top = window.innerHeight - size - pad;
      if (top < pad) top = pad;
      if (left < pad) left = pad;
    }
    return { left, top, size };
  })() : null;

  return (
    <>
      <img
        src={effectiveSrc}
        alt={alt}
        width={32}
        height={32}
        loading="lazy"
        decoding="async"
        onError={() => { if (src && !errored) setErrored(true); }}
        onMouseEnter={(e) => { if (external) onHover(effectiveSrc, e.clientX, e.clientY); else setPreview({ x: e.clientX, y: e.clientY }); }}
        onMouseMove={(e) => { if (external) { if (typeof onMove === 'function') onMove(e.clientX, e.clientY); } else setPreview({ x: e.clientX, y: e.clientY }); }}
        onMouseLeave={() => { if (external) { if (typeof onLeave === 'function') onLeave(); } else setPreview(null); }}
        className="rounded-full object-contain cursor-pointer transition-transform hover:scale-110 flex-shrink-0 block bg-white"
        style={{ width: 32, height: 32, minWidth: 32, border: '1.5px solid rgba(212,175,55,0.5)' }}
      />
      {previewPos && (
        <div className="pointer-events-none" style={{ position: 'fixed', left: previewPos.left, top: previewPos.top, zIndex: 200 }}>
          {/* contain, not cover — the source photos are pre-padded catalog shots, so
              the whole part must stay visible (never clipped) on a white card. */}
          <div className="rounded-xl shadow-2xl border-2 border-[#d4af37]/60 bg-white flex items-center justify-center" style={{ padding: 10 }}>
            <img
              src={effectiveSrc}
              alt={alt}
              style={{ maxWidth: previewPos.size, maxHeight: previewPos.size, width: 'auto', height: 'auto', display: 'block' }}
            />
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
function StatusBadge({ stock, minStock }) {
  if (stock === 0) {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-500/15 text-red-400 border border-red-500/30">
        Out
      </span>
    );
  }
  if (stock <= (minStock || 5)) {
    return (
      <span
        className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/30 whitespace-nowrap"
        title={`Current stock: ${stock} · Minimum stock: ${minStock || 5}`}
      >
        Low ({stock}/{minStock || 5})
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
      OK
    </span>
  );
}

// ---------------------------------------------------------------------------
// Stock stepper: [-] [input] [+] — Requirement 2
// ---------------------------------------------------------------------------
function StockStepper({ part, onCommit, onSell, big }) {
  const [value, setValue] = useState(String(part.stock ?? 0));
  const editingRef = useRef(false);
  const btn = big ? 'w-11 h-11' : 'w-7 h-7';
  const inp = big ? 'flex-1 text-base py-2.5' : 'w-14 text-sm py-1';
  const ic = big ? 16 : 13;

  useEffect(() => {
    if (!editingRef.current) setValue(String(part.stock ?? 0));
  }, [part.stock]);

  function clamp(n) {
    return Math.max(0, parseInt(n, 10) || 0);
  }

  function step(delta) {
    const next = clamp((parseInt(value, 10) || 0) + delta);
    setValue(String(next)); // optimistic, instant
    onCommit(part.id, next); // async Firestore sync in background
  }

  function commitTyped() {
    editingRef.current = false;
    const next = clamp(value);
    const current = part.stock ?? 0;
    // FIX-01: typing a LOWER number must not silently reduce stock — that bypasses
    // the sale record, the price-floor check, and every analytics report. Reducing
    // stock has to go through the Sell button (Checkout). Manual edits restock only.
    if (next < current) {
      toast.error('To reduce stock, use the red Sell button — it records the sale. Typing a lower number is disabled.');
      setValue(String(current));
      return;
    }
    setValue(String(next));
    if (next !== current) onCommit(part.id, next);
  }

  return (
    <div className="flex items-center gap-1.5">
      {/* Issue 3 + Feature 5: deduction = SALE. At 0 stock it opens the
          alternative-part suggester instead of a dead error. */}
      <button
        onClick={() => onSell(part)}
        title="Sell / deduct stock"
        className={`${btn} rounded-lg flex items-center justify-center transition active:scale-90 bg-red-500/10 border border-red-500/25 text-red-400 hover:bg-red-500/20`}
      >
        <Minus size={ic} />
      </button>

      <input
        type="number"
        min="0"
        value={value}
        onFocus={() => (editingRef.current = true)}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commitTyped}
        onKeyDown={(e) => {
          if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        className={`${inp} text-center font-semibold rounded-lg outline-none bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60 transition`}
        style={{ MozAppearance: 'textfield' }}
      />

      <button
        onClick={() => step(1)}
        title="Add stock (restock)"
        className={`${btn} rounded-lg flex items-center justify-center transition active:scale-90 bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20`}
      >
        <Plus size={ic} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MOBILE-01: inventory as a tappable card on phones (the table is desktop-only).
// ---------------------------------------------------------------------------
function MobilePartCard({ part, onEdit, onDelete, onArchive, onRestore, onReorder, onSell, onCommitStock, onReceive, onAdjust, isAdmin, canRestore, highlight, selected, onToggleSelect }) {
  const [open, setOpen] = useState(false);
  const low = (part.stock || 0) <= (part.minStock || 5);
  return (
    <div
      id={`inv-rowm-${part.id}`}
      className={`rounded-2xl overflow-hidden ${part.archived ? 'opacity-60' : ''}`}
      style={{ background: 'rgba(var(--fg-rgb),0.03)', border: highlight ? '2px solid rgba(212,175,55,0.6)' : '1px solid rgba(var(--fg-rgb),0.07)' }}
    >
      <div className="p-3">
        <div className="flex items-start gap-3">
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={!!selected}
              onChange={() => onToggleSelect(part.id)}
              className="mt-1 accent-[#d4af37] w-[18px] h-[18px] flex-shrink-0 cursor-pointer"
              aria-label={`Select ${part.name}`}
            />
          )}
          <div className="flex-shrink-0">
            <PartImageThumb src={part.imageString} alt={part.name} onHover={() => {}} onMove={() => {}} onLeave={() => {}} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-white leading-snug break-words">{part.name}</div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-[#d4af37] font-bold leading-tight whitespace-nowrap">{formatINR(part.sellingPrice)}</div>
            {part.minSellingPrice > 0 && <div className="text-[10px] text-red-400/80 whitespace-nowrap">Min {formatINR(part.minSellingPrice)}</div>}
          </div>
        </div>
        {/* Badges live on their own full-width row so any number of them wrap
            cleanly and can never compress the name or overlap the price. */}
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <StatusBadge stock={part.stock || 0} minStock={part.minStock} />
          {isFastMover(part) && (
            <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-[#d4af37]/15 text-[#d4af37] border border-[#d4af37]/30"><Zap size={9} /> Fast</span>
          )}
          {isDeadStock(part) && (
            <span title={deadStockReason(part)} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-white/8 text-white/45 border border-white/15"><Archive size={9} /> Dead</span>
          )}
          {part.archived && (
            <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-white/8 text-white/45 border border-white/15"><Archive size={9} /> Archived</span>
          )}
        </div>

        {/* Quantity gets its own full-width row; quick actions wrap on a
            separate row below so LOW/FAST badges, the stepper, Reorder and Call
            can never collide on narrow (≤420px) screens. */}
        <div className="mt-3">
          <StockStepper part={part} onCommit={onCommitStock} onSell={onSell} big />
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          {low && (
            <button onClick={() => onReorder(part)} className="h-11 px-3 rounded-lg flex items-center gap-1 text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 active:scale-95" title="WhatsApp reorder">
              <MessageCircle size={14} /> Reorder
            </button>
          )}
          {(() => {
            const ph = (getPartSuppliers(part).find((s) => s.isPreferred) || getPartSuppliers(part)[0])?.phone;
            return ph ? (
              <a href={`tel:${ph}`} className="h-11 px-3 rounded-lg flex items-center gap-1 text-xs font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/30 active:scale-95" title="Call supplier">
                <Phone size={14} /> Call
              </a>
            ) : null;
          })()}
          <button onClick={() => setOpen((o) => !o)} className="h-11 px-3 rounded-lg flex items-center gap-1 text-xs font-medium bg-white/5 border border-white/10 text-white/60 active:scale-95 ml-auto" aria-label="Details">
            <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>▶</span> Details
          </button>
        </div>
      </div>

      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.06)' }}>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] pt-2">
            {[
              ['SKU', part.sku || '—'],
              ['Shelf / Bin', part.locationBin || '—'],
              ['Category', part.category || '—'],
              ['Vehicle', part.vehicle || '—'],
              ['Supplier', (() => {
                const sups = getPartSuppliers(part);
                if (!sups.length) return 'Unassigned';
                const primary = sups.find((s) => s.isPreferred) || sups[0];
                return primary.name + (sups.length > 1 ? ` +${sups.length - 1}` : '');
              })()],
            ].map(([k, v]) => (
              <div key={k}>
                <div className="text-white/35 uppercase tracking-wide text-[9px]">{k}</div>
                <div className="text-white/75">{v}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button onClick={() => onReceive(part)} className="h-11 px-4 rounded-lg flex items-center justify-center gap-1.5 text-sm font-semibold bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 active:scale-[0.98]">
              <PackagePlus size={14} /> Receive
            </button>
            {onAdjust && (part.stock || 0) > 0 && (
              <button onClick={() => onAdjust(part)} className="h-11 px-4 rounded-lg flex items-center justify-center gap-1.5 text-sm font-semibold bg-amber-500/10 border border-amber-500/25 text-amber-400 active:scale-[0.98]" title="Adjust stock (damage / loss / correction)">
                <PackageX size={14} /> Adjust
              </button>
            )}
            <button onClick={() => onEdit(part)} className="h-11 rounded-lg flex items-center justify-center gap-1.5 text-sm font-semibold bg-[#d4af37]/10 border border-[#d4af37]/25 text-[#d4af37] active:scale-[0.98]">
              <Edit3 size={14} /> Edit
            </button>
            {canRestore && !part.archived && onArchive && (
              <button onClick={() => onArchive(part.id)} className="h-11 px-4 rounded-lg flex items-center justify-center gap-1.5 text-sm font-semibold bg-white/5 border border-white/10 text-white/70 active:scale-[0.98]">
                <Archive size={14} /> Archive
              </button>
            )}
            {canRestore && part.archived && onRestore && (
              <button onClick={() => onRestore(part.id)} className="h-11 px-4 rounded-lg flex items-center justify-center gap-1.5 text-sm font-semibold bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 active:scale-[0.98]">
                <ArchiveRestore size={14} /> Restore
              </button>
            )}
            {isAdmin && (
              <button onClick={() => onDelete(part.id)} className="h-11 px-4 rounded-lg flex items-center justify-center gap-1.5 text-sm font-semibold bg-red-500/10 border border-red-500/25 text-red-400 active:scale-[0.98]">
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ADD-02: Receive Stock (goods-received) — records a restock with batch cost,
// supplier and reference; distinct from the +1 stepper.
// ---------------------------------------------------------------------------
function RestockModal({ part, onConfirm, onClose, asPage = false }) {
  useBodyScrollLock(!asPage);
  const preferred = getPartSuppliers(part).find((s) => s.isPreferred) || getPartSuppliers(part)[0];
  const [qty, setQty] = useState('');
  const [unitCost, setUnitCost] = useState(String(part.purchasePrice ?? ''));
  const [supplierName, setSupplierName] = useState(preferred?.name || '');
  const [reference, setReference] = useState('');
  const n = Math.max(0, parseInt(qty, 10) || 0);
  const cost = Math.max(0, parseFloat(unitCost) || 0);
  const fld = 'w-full px-3 py-2.5 rounded-xl text-sm outline-none bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-[#d4af37]/60 transition';
  const lbl = 'block text-[11px] uppercase tracking-wider text-white/40 mb-1';
  const inner = (
    <>
        <p className="text-sm text-white/50 mb-4">{part.name} — current on-hand {part.stock ?? 0}</p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Quantity received *</label>
              <input type="number" min="1" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" className={fld} autoFocus />
            </div>
            <div>
              <label className={lbl}>Purchase ₹ / unit</label>
              <input type="number" min="0" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0" className={fld} />
            </div>
          </div>
          <div>
            <label className={lbl}>Supplier</label>
            <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Supplier name" className={fld} />
          </div>
          <div>
            <label className={lbl}>Invoice / reference (optional)</label>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. INV-2045" className={fld} />
          </div>
          {n > 0 && (
            <div className="rounded-xl px-3 py-2 text-sm bg-white/[0.03] border border-white/10 flex items-center justify-between">
              <span className="text-white/50">New on-hand: <span className="text-white font-semibold">{(part.stock ?? 0) + n}</span></span>
              <span className="text-[#d4af37] font-semibold">Batch cost {formatINR(n * cost)}</span>
            </div>
          )}
        </div>
        <div className="flex gap-2.5 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 transition">Cancel</button>
          <button
            onClick={() => n > 0 && onConfirm({ qty: n, unitCost: cost, supplierName: supplierName.trim(), reference: reference.trim() })}
            disabled={n <= 0}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition ${n > 0 ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] hover:brightness-110' : 'bg-white/5 text-white/30 cursor-not-allowed'}`}
          >
            Receive {n > 0 ? `${n} units` : ''}
          </button>
        </div>
    </>
  );
  if (asPage) return <MobileFormPage title="Receive Stock" onClose={onClose}><div className="p-5">{inner}</div></MobileFormPage>;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl p-5" style={{ background: 'var(--surface-3)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-1">
          <PackagePlus size={18} className="text-[#d4af37]" />
          <h3 className="text-base font-bold text-white">Receive Stock</h3>
        </div>
        {inner}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Checkout modal — sell with bargain-floor (minSellingPrice) lock
// ---------------------------------------------------------------------------
function CheckoutModal({ part, onConfirm, onClose, isAdmin = false, asPage = false }) {
  useBodyScrollLock(!asPage);
  const mrp = part.sellingPrice || 0;
  const floor = part.minSellingPrice || 0;
  const maxQty = part.stock || 0;
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState(String(mrp || ''));
  const [error, setError] = useState('');

  const blockKeys = (e) => ['e', 'E', '+', '-', '.'].includes(e.key) && e.preventDefault();

  function confirm(override = false) {
    const rawQ = parseInt(qty, 10) || 0;
    const p = parseFloat(price);
    if (rawQ < 1) {
      setError('Enter a quantity of at least 1.');
      return;
    }
    if (rawQ > maxQty) {
      setError(`Cannot sell more than available stock (${maxQty}).`);
      return;
    }
    if (!(p > 0)) {
      setError('Enter the final negotiated price.');
      return;
    }
    const q = rawQ;
    // Task 4: below-floor is NOT hard-blocked. Mechanics can't override; owners
    // confirm via "Proceed Anyway", which records the sale at the actual price.
    if (floor > 0 && p < floor && !override) {
      if (!isAdmin) {
        setError(`Below the minimum floor of ${formatINR(floor)}. Only an owner/admin can sell below floor.`);
      }
      return;
    }
    onConfirm(q, p, floor > 0 && p < floor); // 3rd arg = belowFloorOverride
  }

  const fieldLabel = 'block text-[11px] uppercase tracking-wider text-white/40 mb-1.5';
  const fieldInput =
    'w-full px-3 py-2.5 rounded-xl text-sm outline-none bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-[#d4af37]/60 transition';

  const rawQty = parseInt(qty, 10) || 0;
  const qtyInvalid = rawQty < 1 || rawQty > maxQty; // Issue 2
  const q = Math.max(1, Math.min(rawQty, maxQty || 1));
  const p = parseFloat(price) || 0;
  const belowFloor = floor > 0 && p > 0 && p < floor; // Fix 4: bargain lock

  return (
    <div
      className={asPage ? 'min-h-screen flex flex-col' : 'fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm'}
      style={{ background: asPage ? 'var(--surface-0)' : 'rgba(0,0,0,0.7)' }}
      onClick={asPage ? undefined : (e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={asPage ? 'w-full flex-1' : 'w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl overflow-hidden backdrop-blur-md'}
        style={asPage ? undefined : { background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }}
      >
        <div
          className="flex items-center gap-2 px-4 sm:px-5 py-3 sm:py-4 sticky top-0 z-10"
          style={{ background: asPage ? 'var(--surface-1)' : 'transparent', borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}
        >
          {asPage && (
            <button type="button" onClick={onClose} aria-label="Back" className="w-10 h-10 -ml-2 rounded-full flex items-center justify-center text-white/75 active:bg-white/10 transition">
              <ChevronLeft size={24} />
            </button>
          )}
          <div className="flex items-center gap-2 flex-1">
            <ShoppingCart size={18} className="text-[#d4af37]" />
            <h2 className="text-base font-bold text-white">Checkout — Sell Item</h2>
          </div>
          {!asPage && (
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/60 transition"
          >
            <X size={16} />
          </button>
          )}
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-xl p-3" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
            <p className="text-sm font-semibold text-white">{part.name}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs">
              <span className="text-white/50">MRP: <span className="text-[#d4af37] font-semibold">{formatINR(mrp)}</span></span>
              <span className="text-white/50">Floor: <span className="text-amber-400 font-semibold">{floor > 0 ? formatINR(floor) : '—'}</span></span>
              <span className="text-white/50">In stock: <span className="text-white/80 font-semibold">{maxQty}</span></span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel}>Quantity</label>
              <input
                type="number"
                min="1"
                max={maxQty}
                step="1"
                value={qty}
                onChange={(e) => { setQty(e.target.value); setError(''); }}
                onKeyDown={blockKeys}
                className={`${fieldInput} ${qtyInvalid ? 'border-red-500/70 focus:border-red-500' : ''}`}
              />
              {rawQty > maxQty && <p className="text-[11px] text-red-400 mt-1">Max {maxQty} in stock.</p>}
            </div>
            <div>
              <label className={fieldLabel}>Final Price / unit (₹)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => { setPrice(e.target.value); setError(''); }}
                onKeyDown={blockKeys}
                placeholder="Negotiated price"
                autoFocus
                className={fieldInput}
              />
            </div>
          </div>

          {belowFloor ? (
            <div className="rounded-xl px-3 py-2.5 space-y-1.5 bg-amber-500/12 border border-amber-500/30">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                <AlertTriangle size={14} /> Below minimum floor price
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-white/60">
                <span>Floor: <span className="text-amber-400 font-semibold">{formatINR(floor)}</span></span>
                <span>Selling: <span className="text-white font-semibold">{formatINR(p)}</span></span>
                <span>Expected loss: <span className="text-red-400 font-semibold">{formatINR(Math.max(0, floor - p) * q)}</span></span>
              </div>
              {!isAdmin && <p className="text-[11px] text-red-400">Only an owner/admin can sell below the floor price.</p>}
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm bg-emerald-500/10 border border-emerald-500/25">
              <span className="text-white/60">Total</span>
              <span className="font-bold text-emerald-400">{formatINR(q * p)}</span>
            </div>
          )}

          {error && (
            <p className="text-xs font-semibold text-red-400 flex items-center gap-1.5">
              <AlertTriangle size={13} /> {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 transition"
            >
              Cancel
            </button>
            {belowFloor && isAdmin ? (
              <button
                onClick={() => confirm(true)}
                disabled={!(p > 0) || qtyInvalid}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white bg-red-500/90 hover:bg-red-500 active:scale-[0.98] transition disabled:opacity-40"
              >
                Proceed Anyway
              </button>
            ) : (
              <button
                onClick={() => confirm(false)}
                disabled={belowFloor || !(p > 0) || qtyInvalid}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] hover:brightness-110 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100"
              >
                {belowFloor ? 'Below Floor — Owner only' : 'Confirm Sale'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task 8: Stock Adjustment — reduce stock for a non-sale reason (damage, loss,
// personal use, manual correction). Recorded separately so analytics can tell
// shrinkage apart from real sales.
// ---------------------------------------------------------------------------
const ADJUST_REASONS = ['Damage', 'Adjustment', 'Personal Use', 'Lost Item', 'Theft', 'Expired', 'Supplier Return', 'Branch Transfer', 'Audit Correction', 'Stock Count Difference', 'Found'];
function StockAdjustModal({ part, onConfirm, onClose, asPage = false }) {
  useBodyScrollLock(!asPage);
  const maxQty = part.stock || 0;
  const [direction, setDirection] = useState('reduce'); // 'reduce' | 'correction'
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState('Damage');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const blockKeys = (e) => ['e', 'E', '+', '-', '.'].includes(e.key) && e.preventDefault();
  const isCorrection = direction === 'correction';

  function confirm() {
    const q = parseInt(qty, 10) || 0;
    if (q <= 0) { setError('Enter a quantity of 1 or more.'); return; }
    if (!isCorrection && q > maxQty) { setError(`Only ${maxQty} in stock.`); return; }
    onConfirm({
      qty: q,
      direction,
      reason: isCorrection ? 'Correction' : reason,
      notes: notes.trim(),
    });
  }

  const fieldLabel = 'block text-[11px] uppercase tracking-wider text-white/40 mb-1.5';
  const fieldInput = 'w-full px-3 py-2.5 rounded-xl text-sm outline-none bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60 transition';
  const q = parseInt(qty, 10) || 0;
  const after = isCorrection ? maxQty + q : maxQty - q;

  const inner = (
    <>
          {/* Issue 3: direction — reduce (loss) or correction (add stock back) */}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => { setDirection('reduce'); setError(''); }} className={`py-2.5 rounded-xl text-sm font-bold border transition ${!isCorrection ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-white/5 text-white/50 border-white/10'}`}>− Reduce</button>
            <button onClick={() => { setDirection('correction'); setError(''); }} className={`py-2.5 rounded-xl text-sm font-bold border transition ${isCorrection ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-white/5 text-white/50 border-white/10'}`}>+ Correction</button>
          </div>
          <p className="text-xs text-white/50">
            {isCorrection
              ? 'Add stock back to reverse an earlier over-deduction. Recorded as a separate “Correction” entry — history is never edited.'
              : 'Reduce stock for a reason other than a sale. Recorded separately and not counted as revenue.'}
            {' '}In stock: <span className="text-white/80 font-semibold">{maxQty}</span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel}>Quantity</label>
              <input type="number" min="1" max={isCorrection ? undefined : maxQty} step="1" value={qty} onChange={(e) => { setQty(e.target.value); setError(''); }} onKeyDown={blockKeys} className={fieldInput} />
            </div>
            <div>
              <label className={fieldLabel}>Reason</label>
              {isCorrection ? (
                <div className={`${fieldInput} flex items-center text-emerald-300/90`}>Correction</div>
              ) : (
                <select value={reason} onChange={(e) => setReason(e.target.value)} className={fieldInput}>
                  {ADJUST_REASONS.map((r) => <option key={r} value={r} className="bg-[#111]">{r}</option>)}
                </select>
              )}
            </div>
          </div>
          {error && <p className="text-xs font-semibold text-red-400 flex items-center gap-1.5"><AlertTriangle size={13} /> {error}</p>}
          <div>
            <label className={fieldLabel}>Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder={isCorrection ? 'e.g. Corrected — only 1 was actually damaged' : 'e.g. Leaked during transport, missing during audit…'}
              className={`${fieldInput} resize-none`}
            />
          </div>
          {q > 0 && (isCorrection || q <= maxQty) && (
            <p className="text-[11px] text-white/45">Stock: <span className="text-white/80 font-semibold">{maxQty} → {after}</span></p>
          )}
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-3 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80">Cancel</button>
            <button onClick={confirm} className="flex-1 py-3 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] active:scale-[0.98]">{isCorrection ? 'Record correction' : 'Record adjustment'}</button>
          </div>
    </>
  );

  if (asPage) return <MobileFormPage title={`Adjust stock — ${part.name}`} onClose={onClose}><div className="p-5 space-y-4">{inner}</div></MobileFormPage>;

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>
          <div className="flex items-center gap-2"><PackageX size={18} className="text-amber-400" /><h2 className="text-base font-bold text-white">Adjust stock — {part.name}</h2></div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/60"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">{inner}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FEATURE 5: Out-of-stock → alternative-part suggester
// ---------------------------------------------------------------------------
function AlternativeModal({ part, alternatives, onPick, onClose }) {
  useBodyScrollLock();
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden backdrop-blur-md"
        style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>
          <div className="flex items-center gap-2">
            <PackageX size={18} className="text-red-400" />
            <h2 className="text-base font-bold text-white">Out of Stock</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/60 transition">
            <X size={16} />
          </button>
        </div>

        <div className="p-5">
          <p className="text-sm text-white/60 mb-3">
            <span className="font-semibold text-white">{part.name}</span> is out of stock. Suggested alternatives in <span className="text-[#d4af37]">{part.category || 'this category'}</span>:
          </p>
          {alternatives.length ? (
            <div className="space-y-2">
              {alternatives.map((alt) => (
                <button
                  key={alt.id}
                  onClick={() => onPick(alt)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl text-left transition active:scale-[0.99] bg-white/5 border border-white/10 hover:border-[#d4af37]/40 hover:bg-[#d4af37]/10"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-white truncate">{alt.name}</span>
                    <span className="block text-xs text-white/45">
                      {alt.vehicle || 'Universal'} · {formatINR(alt.sellingPrice)}
                      {alt.locationBin ? ` · ${alt.locationBin}` : ''}
                    </span>
                  </span>
                  <span className="flex items-center gap-1 text-xs font-bold text-emerald-400 flex-shrink-0">
                    {alt.stock} in stock <ShoppingCart size={14} />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-xl px-4 py-6 text-center bg-white/[0.03] border border-white/10">
              <p className="text-sm text-white/40">No in-stock alternatives in this category. Time to reorder.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// #5 + #6: reusable Tree-Select (parent → children, tri-state, searchable)
// value = array of selected leaf strings; onChange(nextArray)
// ---------------------------------------------------------------------------
function TreeSelect({ tree, value = [], onChange, placeholder = 'Select…', allowUniversalShortcut, onAddLeaf, onAddVehicle }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [newLeaf, setNewLeaf] = useState('');       // Task 1: add new category
  const [newBrand, setNewBrand] = useState('');     // Task 4: brand for new vehicle
  const boxRef = useRef(null);
  const selectedSet = useMemo(() => new Set(value), [value]);

  // resolve a typed name to an existing leaf (case-insensitive) or null.
  // For categories (onAddLeaf), also collapse singular/plural so "perfumes"
  // resolves to an existing "perfume" instead of creating a duplicate.
  const findExistingLeaf = (name) => {
    const q = safeLower((name || '').trim());
    const qs = singularize(q);
    let found = null;
    tree.forEach((n) => n.children.forEach((c) => {
      const cl = safeLower(c);
      if (cl === q || (onAddLeaf && singularize(cl) === qs)) found = c;
    }));
    return found;
  };
  // Task 4: create a category straight from the search text (one click).
  const createLeaf = (name) => {
    const nm = (name || '').trim();
    if (!nm) return;
    const existing = findExistingLeaf(nm); // dedupe: "Door Handle" == "door handle"
    const leaf = existing || nm;
    if (!selectedSet.has(leaf)) onChange([...value, leaf]);
    if (!existing && onAddLeaf) onAddLeaf(nm);
    setQuery('');
  };
  // Task 4/5: create a vehicle (model = search text, brand chosen inline).
  const createVehicle = (brand, model) => {
    const b = titleCase(brand); // Issue 14: normalize casing
    const m = titleCase(model);
    if (!b || !m) return;
    const existing = findExistingLeaf(m);
    const leaf = existing || m;
    if (!selectedSet.has(leaf)) onChange([...value, leaf]);
    if (!existing && onAddVehicle) onAddVehicle(b, m);
    setNewBrand('');
    setQuery('');
  };

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 140);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    function onDoc(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const toggleLeaf = (leaf) => {
    const next = new Set(selectedSet);
    next.has(leaf) ? next.delete(leaf) : next.add(leaf);
    onChange([...next]);
  };
  const toggleParent = (node) => {
    const next = new Set(selectedSet);
    const all = node.children.every((c) => next.has(c));
    node.children.forEach((c) => (all ? next.delete(c) : next.add(c)));
    onChange([...next]);
  };
  const removeChip = (leaf) => {
    const next = new Set(selectedSet);
    next.delete(leaf);
    onChange([...next]);
  };

  const filteredTree = useMemo(() => {
    const q = safeLower(debounced).trim();
    if (!q) return tree;
    const qs = singularize(q);
    const match = (txt) => { const t = safeLower(txt); return t.includes(q) || singularize(t).includes(qs); };
    return tree
      .map((node) => {
        const pm = match(node.label);
        const kids = pm ? node.children : node.children.filter((c) => match(c));
        return kids.length || pm ? { ...node, children: kids } : null;
      })
      .filter(Boolean);
  }, [tree, debounced]);

  const fieldBox =
    'w-full px-3 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60 transition cursor-pointer';

  return (
    <div ref={boxRef} className="relative">
      <div className={fieldBox} onClick={() => setOpen((o) => !o)}>
        {value.length === 0 ? (
          <span className="text-white/30">{placeholder}</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {value.slice(0, 8).map((leaf) => (
              <span key={leaf} className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-[11px] font-semibold bg-[#d4af37]/15 text-[#d4af37] border border-[#d4af37]/30">
                {leaf}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeChip(leaf); }}
                  className="hover:text-white"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            {value.length > 8 && <span className="text-[11px] text-white/40 self-center">+{value.length - 8} more</span>}
          </div>
        )}
      </div>

      {open && (() => {
        const panelInner = (
          <>
            <div className="p-2 border-b border-white/8">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="w-full px-2.5 py-2 rounded-lg text-sm outline-none bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-[#d4af37]/60"
              />
            </div>
            <div className="max-h-60 sm:max-h-60 overflow-y-auto py-1 flex-1">
              {filteredTree.map((node) => {
                const allSel = node.children.every((c) => selectedSet.has(c));
                const someSel = !allSel && node.children.some((c) => selectedSet.has(c));
                const isOpen = expanded[node.label] ?? !!debounced;
                return (
                  <div key={node.label}>
                    <div className="flex items-center gap-2 px-2.5 py-2 hover:bg-white/[0.04]">
                      <button type="button" onClick={() => setExpanded((e) => ({ ...e, [node.label]: !isOpen }))} className="text-white/40 hover:text-white/70 w-6 h-6 flex items-center justify-center">
                        <span className={`inline-block transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                      </button>
                      <label className="flex items-center gap-2 flex-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allSel}
                          ref={(el) => el && (el.indeterminate = someSel)}
                          onChange={() => toggleParent(node)}
                          className="w-4 h-4 accent-[#d4af37] cursor-pointer"
                        />
                        <span className="text-sm font-semibold text-white">{node.label}</span>
                        <span className="text-[10px] text-white/30">{node.children.filter((c) => selectedSet.has(c)).length || ''}</span>
                      </label>
                    </div>
                    {isOpen &&
                      node.children.map((leaf) => (
                        <label key={leaf} className="flex items-center gap-2 pl-9 pr-2.5 py-2 hover:bg-[#d4af37]/8 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedSet.has(leaf)}
                            onChange={() => toggleLeaf(leaf)}
                            className="w-4 h-4 accent-[#d4af37] cursor-pointer"
                          />
                          <span className="text-sm text-white/80">{leaf}</span>
                        </label>
                      ))}
                  </div>
                );
              })}
              {filteredTree.length === 0 && !debounced.trim() && <div className="px-3 py-3 text-xs text-white/40">No options.</div>}

              {/* Task 4: one-click create from the search text (no second field). */}
              {debounced.trim() && !findExistingLeaf(debounced) && onAddLeaf && (
                <button
                  type="button"
                  onClick={() => createLeaf(debounced)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-[#d4af37]/10 border-t border-white/8"
                >
                  <span className="w-5 h-5 rounded-md flex items-center justify-center bg-[#d4af37]/15 text-[#d4af37] text-sm font-bold flex-shrink-0">+</span>
                  <span className="text-sm text-white/85 truncate">Create “<span className="text-[#d4af37] font-semibold">{debounced.trim()}</span>”</span>
                </button>
              )}
              {debounced.trim() && !findExistingLeaf(debounced) && onAddVehicle && (
                <div className="px-3 py-2.5 border-t border-white/8 space-y-2">
                  <p className="text-xs text-white/60">Add “<span className="text-[#d4af37] font-semibold">{debounced.trim()}</span>” as a new model under:</p>
                  <div className="flex gap-2">
                    <input
                      value={newBrand}
                      onChange={(e) => setNewBrand(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createVehicle(newBrand, debounced); } }}
                      placeholder="Brand e.g. Force Motors"
                      className="flex-1 px-2.5 py-2 rounded-lg text-sm outline-none bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-[#d4af37]/60"
                    />
                    <button type="button" onClick={() => createVehicle(newBrand, debounced)} disabled={!newBrand.trim()} className={`px-3 rounded-lg text-sm font-bold flex-shrink-0 ${newBrand.trim() ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]' : 'bg-white/5 text-white/30'}`}>Create</button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between px-3 py-2 border-t border-white/8">
              <span className="text-[11px] text-white/40">{value.length} selected</span>
              <button type="button" onClick={() => onChange([])} className="text-[11px] text-white/50 hover:text-white">Clear all</button>
            </div>
          </>
        );
        return (
          <>
            {/* Desktop: absolute dropdown */}
            <div
              className="hidden sm:block absolute z-40 mt-1 w-full rounded-xl overflow-hidden shadow-2xl backdrop-blur-md"
              style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }}
            >
              {panelInner}
            </div>
            {/* CHANGE-06: Mobile bottom sheet (avoids clipping inside the modal) */}
            <div className="sm:hidden fixed inset-0 z-[110] flex items-end" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setOpen(false)}>
              <div className="w-full rounded-t-3xl overflow-hidden modal-sheet flex flex-col" style={{ background: 'var(--surface-3)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/8 flex-shrink-0">
                  <span className="text-sm font-bold text-white">{placeholder}</span>
                  <button type="button" onClick={() => setOpen(false)} className="text-[#d4af37] text-sm font-bold">Done</button>
                </div>
                {panelInner}
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// #1 + #2: SupplierPicker — searchable, debounced, id-based supplier selector
// with per-part "Preferred Contact Number" selection. Scales to 100+ suppliers
// (results capped + filtered); selection maps by supplierId, never by index.
// ---------------------------------------------------------------------------
function SupplierPicker({ suppliers, row, onChange, onRemove, onSaveSupplier }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [newPhone, setNewPhone] = useState(row.id ? '' : row.phone || '');
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null); // { name, phones:[{number,label}] }
  const [confirmDelete, setConfirmDelete] = useState(false);
  const boxRef = useRef(null);

  // Debounce the search input (handles fast typists + long lists).
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 160);
    return () => clearTimeout(t);
  }, [query]);

  // Close the dropdown when clicking outside.
  useEffect(() => {
    function onDoc(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const CAP = 50;
  const results = useMemo(() => {
    const q = safeLower(debounced).trim();
    const qDigits = q.replace(/\D/g, '');
    // Only offer LIVE suppliers as new links. An already-linked archived
    // supplier still resolves via `selected` below, so existing links display.
    let list = suppliers.filter((s) => !s.archived);
    if (q) {
      list = list.filter(
        (s) =>
          getSupplierNames(s).some((n) => safeLower(n).includes(q)) ||
          (qDigits && getSupplierPhones(s).some((p) => p.includes(qDigits)))
      );
    }
    return { items: list.slice(0, CAP), total: list.length };
  }, [suppliers, debounced]);

  const selected = row.id ? suppliers.find((s) => s.id === row.id) : null;
  // For NEW suppliers (no master record yet), the editable list lives on the row.
  const contacts = selected
    ? getSupplierContacts(selected)
    : (row.phoneNumbers || [])
        .map((c) => ({ number: tenDigits(c.number), label: c.label || 'Primary' }))
        .filter((c) => c.number);
  const exactExists = suppliers.some(
    (s) => safeLower(s.name) === safeLower(query.trim())
  );

  function choose(s) {
    const c = getSupplierContacts(s);
    onChange({
      id: s.id,
      name: s.name,
      phone: c[0]?.number || '',
      preferredLabel: c[0]?.label || 'Primary',
    });
    setQuery('');
    setOpen(false);
  }
  function createNew() {
    const name = query.trim();
    if (!name) return;
    onChange({
      id: '',
      name,
      phone: '',
      preferredLabel: 'Primary',
      isPreferred: !!row.isPreferred,
      phoneNumbers: [{ number: '', label: 'Primary' }],
    });
    setQuery('');
    setOpen(false);
  }
  function clearSelection() {
    onChange({ id: '', name: '', phone: '', preferredLabel: 'Primary' });
    setNewPhone('');
    setQuery('');
  }

  const CONTACT_LABELS = ['Primary', 'WhatsApp', 'Landline', 'Owner', 'Accounts', 'Workshop', 'Manager'];

  // ---- Edit mode (keeps data visible; commits only on Save) ----
  function enterEdit() {
    const phones = contacts.length ? contacts.map((c) => ({ ...c })) : [{ number: row.phone || '', label: 'Primary' }];
    setDraft({ name: selected?.name || row.name, phones });
    setEditing(true);
    setExpanded(true);
  }
  function cancelEdit() {
    setDraft(null);
    setEditing(false); // original values remain untouched — card never disappears
  }
  function updateDraftPhone(i, key, val) {
    setDraft((d) => {
      const phones = d.phones.map((p, idx) =>
        idx === i ? { ...p, [key]: key === 'number' ? phoneInput(val) : val } : p
      );
      return { ...d, phones };
    });
  }
  function addDraftPhone() {
    setDraft((d) => ({ ...d, phones: [...d.phones, { number: '', label: 'WhatsApp' }] }));
  }
  function removeDraftPhone(i) {
    setDraft((d) => ({ ...d, phones: d.phones.filter((_, idx) => idx !== i) }));
  }
  function saveEdit() {
    const name = (draft.name || '').trim();
    if (!name) { toast.error('Supplier name is required.'); return; }
    // Edge cases: drop empty numbers + de-dupe.
    const seen = new Set();
    const phones = draft.phones
      .map((p) => ({ number: tenDigits(p.number), label: (p.label || 'Primary').trim() || 'Primary' }))
      .filter((p) => p.number && !seen.has(p.number) && seen.add(p.number));
    // Task 3: reject invalid numbers before saving.
    const bad = phones.find((p) => !isValidIndianPhone(p.number));
    if (bad) {
      toast.error(`“${bad.number}” isn’t a valid Indian mobile (10 digits starting 6–9).`);
      return;
    }
    if (phones.length === 0) { toast.error('Add at least one valid phone number.'); return; }
    // Keep this part's preferred number if it still exists, else fall back.
    const keepPhone = phones.some((p) => p.number === row.phone) ? row.phone : phones[0]?.number || '';
    const keepLabel = phones.find((p) => p.number === keepPhone)?.label || 'Primary';
    if (row.id && onSaveSupplier) {
      onSaveSupplier(row.id, { name, phoneNumbers: phones }); // persist master record
      onChange({ ...row, name, phone: keepPhone, preferredLabel: keepLabel });
    } else {
      // New supplier — keep the full number list on the row so the supplier is
      // created with all of them when the part is saved.
      onChange({ ...row, name, phone: keepPhone, preferredLabel: keepLabel, phoneNumbers: phones });
    }
    setEditing(false);
    setDraft(null);
  }

  function requestRemove() {
    setConfirmDelete(true);
  }

  // #1: inline editor for a NEW supplier's numbers (lives on the row; persisted
  // when the part is saved). Identical capability to existing suppliers.
  function commitNewPhones(phones) {
    const stillPreferred = phones.some((p) => p.number && p.number === row.phone);
    const preferred = stillPreferred ? row.phone : phones.find((p) => p.number)?.number || '';
    onChange({
      ...row,
      phoneNumbers: phones,
      phone: preferred,
      preferredLabel: phones.find((p) => p.number === preferred)?.label || 'Primary',
    });
  }
  function newPhoneChange(i, key, val) {
    const phones = (row.phoneNumbers || []).map((p, idx) =>
      idx === i ? { ...p, [key]: key === 'number' ? phoneInput(val) : val } : p
    );
    commitNewPhones(phones);
  }
  function addNewPhone() {
    commitNewPhones([...(row.phoneNumbers || []), { number: '', label: 'WhatsApp' }]);
  }
  function removeNewPhone(i) {
    const phones = (row.phoneNumbers || []).filter((_, idx) => idx !== i);
    commitNewPhones(phones.length ? phones : [{ number: '', label: 'Primary' }]);
  }
  function pickNewPreferred(number) {
    const c = (row.phoneNumbers || []).find((p) => p.number === number);
    onChange({ ...row, phone: number, preferredLabel: c?.label || 'Primary' });
  }

  const fieldInput =
    'w-full px-3 py-2.5 rounded-xl text-sm outline-none bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-[#d4af37]/60 transition';

  // SELECTED STATE — full supplier card (#1,#3,#5,#6,#7).
  if (row.name) {
    const isNew = !row.id;
    return (
      <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: `1px solid ${row.isPreferred ? 'rgba(212,175,55,0.45)' : 'rgba(var(--fg-rgb),0.08)'}` }}>
        {/* Header row */}
        <div className="flex items-center gap-2 p-2.5">
          {/* Preferred-supplier star (one per part — parent enforces) */}
          <button
            type="button"
            onClick={() => onChange({ ...row, isPreferred: !row.isPreferred })}
            title={row.isPreferred ? 'Preferred supplier' : 'Mark as preferred supplier'}
            className={`w-7 h-7 flex-shrink-0 rounded-lg flex items-center justify-center transition ${row.isPreferred ? 'text-[#d4af37] bg-[#d4af37]/15 border border-[#d4af37]/40' : 'text-white/30 bg-white/5 border border-white/10 hover:text-white/60'}`}
          >
            <Star size={14} fill={row.isPreferred ? '#d4af37' : 'none'} />
          </button>

          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-white truncate flex items-center gap-1.5">
              {row.name}
              {row.isPreferred && <span className="text-[9px] font-bold uppercase tracking-wide text-[#d4af37]">Preferred</span>}
            </div>
            {isNew ? (
              <div className="text-[11px] text-amber-400/80">New supplier — saved on Save Changes</div>
            ) : (
              <div className="text-[11px] text-emerald-400/80 flex items-center gap-1">
                <Phone size={10} /> {row.phone || 'no number'}{row.preferredLabel ? ` · ${row.preferredLabel}` : ''}
              </div>
            )}
          </div>

          {!isNew && (
            <button type="button" onClick={() => setExpanded((e) => !e)} className="w-8 h-8 flex-shrink-0 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/50 hover:bg-white/10 transition" title={expanded ? 'Collapse' : 'Expand details'}>
              <span className={`inline-block transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
            </button>
          )}
          {!editing && !isNew && (
            <button type="button" onClick={enterEdit} className="w-8 h-8 flex-shrink-0 rounded-lg flex items-center justify-center bg-[#d4af37]/10 border border-[#d4af37]/25 text-[#d4af37] hover:bg-[#d4af37]/20 transition" title="Edit supplier">
              <Edit3 size={13} />
            </button>
          )}
          <button type="button" onClick={requestRemove} className="w-8 h-8 flex-shrink-0 rounded-lg flex items-center justify-center bg-red-500/10 border border-red-500/25 text-red-400 hover:bg-red-500/20 transition" title="Remove from this part">
            <Trash2 size={13} />
          </button>
        </div>

        {/* Confirm unlink (safe delete — never deletes the master supplier) */}
        {confirmDelete && (
          <div className="px-3 pb-3">
            <div className="rounded-lg p-2.5 bg-red-500/10 border border-red-500/25">
              <p className="text-xs text-white/80">Remove <span className="font-semibold">{row.name}</span> from this part? The supplier stays in your directory.</p>
              <div className="flex gap-2 mt-2">
                <button type="button" onClick={() => setConfirmDelete(false)} className="flex-1 py-1.5 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-white/80 hover:bg-white/10">Keep</button>
                <button type="button" onClick={() => { setConfirmDelete(false); onRemove(); }} className="flex-1 py-1.5 rounded-lg text-xs font-bold text-white bg-red-500/80 hover:bg-red-500">Remove</button>
              </div>
            </div>
          </div>
        )}

        {/* #1: New-supplier inline multi-number editor (primary + alternates) */}
        {isNew && !editing && (
          <div className="px-3 pb-3 space-y-2" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.06)' }}>
            <div className="flex items-center justify-between pt-2.5">
              <label className="text-[10px] uppercase tracking-wider text-white/40">Phone numbers</label>
              <button type="button" onClick={addNewPhone} className="flex items-center gap-1 text-[11px] font-semibold text-[#d4af37] hover:text-[#e8c84a]">
                <Plus size={11} /> Add Alternate Number
              </button>
            </div>
            {(row.phoneNumbers || [{ number: '', label: 'Primary' }]).map((p, i) => (
              <div key={i} className="flex gap-2 items-center">
                <label className="flex items-center" title="Preferred for reorders">
                  <input
                    type="radio"
                    name={`newpref-${row.name}`}
                    checked={!!p.number && row.phone === p.number}
                    onChange={() => pickNewPreferred(p.number)}
                    disabled={!p.number}
                    className="accent-[#d4af37]"
                  />
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={p.number}
                  onChange={(e) => newPhoneChange(i, 'number', e.target.value)}
                  placeholder={i === 0 ? 'Primary number' : 'Alternate number'}
                  className={`${fieldInput} flex-1`}
                />
                <select value={p.label} onChange={(e) => newPhoneChange(i, 'label', e.target.value)} className="w-24 flex-shrink-0 px-1.5 py-2.5 rounded-xl text-xs outline-none bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60">
                  {CONTACT_LABELS.map((l) => <option key={l} value={l} className="bg-[#111]">{l}</option>)}
                </select>
                <button type="button" onClick={() => removeNewPhone(i)} className="w-9 h-9 flex-shrink-0 rounded-lg flex items-center justify-center bg-red-500/10 border border-red-500/25 text-red-400 hover:bg-red-500/20"><X size={13} /></button>
              </div>
            ))}
            <p className="text-[10px] text-white/30">Select the radio to set the preferred number for reorders. Saved with the part.</p>
            {(row.phoneNumbers || []).some((p) => p.number && !isValidIndianPhone(p.number)) && (
              <p className="text-[10px] text-red-400 font-semibold">✕ Invalid number — must be 10 digits starting 6–9. The part can’t be saved until this is fixed.</p>
            )}
          </div>
        )}

        {/* EDIT MODE — name + phone numbers; commit only on Save, Cancel restores */}
        {editing && draft && (
          <div className="px-3 pb-3 space-y-2.5" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.06)' }}>
            <div className="pt-2.5">
              <label className="block text-[10px] uppercase tracking-wider text-white/40 mb-1">Supplier name</label>
              <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} className={fieldInput} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] uppercase tracking-wider text-white/40">Phone numbers</label>
                <button type="button" onClick={addDraftPhone} className="flex items-center gap-1 text-[11px] font-semibold text-[#d4af37] hover:text-[#e8c84a]"><Plus size={11} /> Add alternate</button>
              </div>
              <div className="space-y-2">
                {draft.phones.map((p, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input
                      type="tel"
                      inputMode="numeric"
                      maxLength={10}
                      value={p.number}
                      onChange={(e) => updateDraftPhone(i, 'number', e.target.value)}
                      placeholder={i === 0 ? 'Primary number' : 'Alternate number'}
                      className={`${fieldInput} flex-1`}
                    />
                    <select value={p.label} onChange={(e) => updateDraftPhone(i, 'label', e.target.value)} className="w-24 flex-shrink-0 px-1.5 py-2.5 rounded-xl text-xs outline-none bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60">
                      {CONTACT_LABELS.map((l) => <option key={l} value={l} className="bg-[#111]">{l}</option>)}
                    </select>
                    <button type="button" onClick={() => removeDraftPhone(i)} className="w-9 h-9 flex-shrink-0 rounded-lg flex items-center justify-center bg-red-500/10 border border-red-500/25 text-red-400 hover:bg-red-500/20"><X size={13} /></button>
                  </div>
                ))}
              </div>
              {(draft.phones || []).some((p) => p.number && !isValidIndianPhone(p.number)) && (
                <p className="text-[10px] text-red-400 font-semibold mt-1.5">✕ Invalid number — must be 10 digits starting 6–9. Save is blocked until fixed.</p>
              )}
            </div>
            <div className="flex gap-2 pt-0.5">
              <button type="button" onClick={cancelEdit} className="flex-1 py-2 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-white/80 hover:bg-white/10">Cancel</button>
              <button type="button" onClick={saveEdit} className="flex-1 py-2 rounded-lg text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] hover:brightness-110">Save</button>
            </div>
          </div>
        )}

        {/* EXPANDED (view) — preferred contact radios across all numbers */}
        {expanded && !editing && !isNew && (
          <div className="px-3 pb-3" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.06)' }}>
            <label className="block text-[10px] uppercase tracking-wider text-white/40 mt-2.5 mb-1.5">Preferred contact for reorders</label>
            {contacts.length ? (
              <div className="space-y-1.5">
                {contacts.map((c) => (
                  <label key={c.number} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer bg-white/[0.03] border border-white/8 hover:border-[#d4af37]/30">
                    <input
                      type="radio"
                      name={`pref-${row.id}`}
                      checked={row.phone === c.number}
                      onChange={() => onChange({ ...row, phone: c.number, preferredLabel: c.label })}
                      className="accent-[#d4af37]"
                    />
                    <span className="text-xs text-white/80 flex-1">{c.number}</span>
                    <span className="text-[10px] uppercase tracking-wide text-[#d4af37]/70">{c.label}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-white/35">No numbers on file. Use Edit to add one.</p>
            )}
          </div>
        )}
      </div>
    );
  }

  // SEARCH STATE — searchable dropdown.
  return (
    <div ref={boxRef} className="relative">
      <div className="flex gap-2 items-center">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search supplier by name or number…"
          autoComplete="off"
          className={`${fieldInput} flex-1`}
        />
        <button
          type="button"
          onClick={onRemove}
          className="w-10 h-10 flex-shrink-0 rounded-xl flex items-center justify-center bg-red-500/10 border border-red-500/25 text-red-400 hover:bg-red-500/20 transition"
          title="Remove row"
        >
          <X size={15} />
        </button>
      </div>

      {open && (
        <div
          className="absolute z-30 mt-1 w-full rounded-xl overflow-hidden shadow-2xl backdrop-blur-md"
          style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }}
        >
          <div className="max-h-56 overflow-y-auto">
            {results.items.map((s) => {
              const c = getSupplierContacts(s);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => choose(s)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[#d4af37]/10 transition"
                >
                  <span className="min-w-0">
                    <span className="block text-sm text-white truncate">{s.name}</span>
                    <span className="block text-[11px] text-white/40">{c[0]?.number || 'no number'}{c.length > 1 ? ` +${c.length - 1}` : ''}</span>
                  </span>
                </button>
              );
            })}
            {results.items.length === 0 && (
              <div className="px-3 py-3 text-xs text-white/40">No matching suppliers.</div>
            )}
            {results.total > CAP && (
              <div className="px-3 py-2 text-[11px] text-white/30 border-t border-white/5">
                Showing {CAP} of {results.total}. Keep typing to narrow.
              </div>
            )}
          </div>

          {query.trim() && !exactExists && (
            <button
              type="button"
              onClick={createNew}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left border-t border-white/8 bg-[#d4af37]/8 hover:bg-[#d4af37]/16 transition"
            >
              <Plus size={14} className="text-[#d4af37]" />
              <span className="text-sm text-[#d4af37] font-semibold truncate">Create “{query.trim()}”</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add / Edit Part Modal — Requirement 3 (learning comboboxes) + Base64 image
// ---------------------------------------------------------------------------
function PartModal({ part, inventory, suppliers = [], saving, onSave, onClose, onSaveSupplier, isAdmin = true, categoryTree = CATEGORY_TREE, vehicleTree = VEHICLE_TREE, salesHistory = [], onAddCategory, onAddVehicle, asPage = false, demoMode = false }) {
  // PRODUCTIVITY: recent sales summary for this part (purchasing aid).
  const saleStats = useMemo(() => {
    if (!part?.id) return null;
    const mine = salesHistory.filter((s) => s.partId === part.id);
    if (mine.length === 0) return { count: 0 };
    const dated = mine
      .map((s) => ({ ...s, d: s.createdAt?.toDate ? s.createdAt.toDate() : s.createdAt?.seconds ? new Date(s.createdAt.seconds * 1000) : null }))
      .filter((s) => s.d)
      .sort((a, b) => b.d - a.d);
    const now = new Date();
    const thisMonth = dated.filter((s) => s.d.getFullYear() === now.getFullYear() && s.d.getMonth() === now.getMonth())
      .reduce((sum, s) => sum + (s.qty || 0), 0);
    const last = dated[0];
    return { count: mine.length, lastDate: last?.d || null, lastPrice: last?.unitPrice ?? null, thisMonth };
  }, [part?.id, salesHistory]);
  const isEdit = !!part?.id;
  const fileRef = useRef(null);
  // CHANGE-02: on mobile the form is a 3-step bottom sheet; desktop stays long-form.
  const STEPS = [{ n: 1, label: 'Details' }, { n: 2, label: 'Stock & Pricing' }, { n: 3, label: 'Supplier' }];
  const [mobileStep, setMobileStep] = useState(1);
  const formBodyRef = useRef(null);
  // When the mobile step changes, scroll the modal's scroll body (the form's
  // parent, provided by <Modal>) back to the top so the new step starts at top.
  useEffect(() => {
    // Page mode scrolls the document; modal mode scrolls the Modal body.
    if (asPage) { try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { window.scrollTo(0, 0); } }
    else { formBodyRef.current?.parentElement?.scrollTo({ top: 0, behavior: 'smooth' }); }
  }, [mobileStep, asPage]);
  const [errors, setErrors] = useState({}); // Issue 5: per-field validation errors
  const stepCls = (n) => `${mobileStep === n ? 'block space-y-4' : 'hidden'} sm:block sm:space-y-4`;

  const [form, setForm] = useState(() => {
    const base = {
      name: '',
      sku: '',
      // Phase 1: master-database identifiers
      oemNo: '',
      partNo: '',
      internalPartNo: '',
      barcode: '',
      hsn: '',
      gst: '18',
      brand: '',
      manufacturer: '',
      countryOrigin: 'India',
      category: '',
      vehicle: '',
      locationBin: '', // Feature 1: shelf/bin location
      shelf: '',
      rack: '',
      bin: '',
      warehouse: '',
      stock: '',
      minStock: (() => { try { const v = localStorage.getItem('maruti_low_stock_default'); return v && /^\d+$/.test(v) ? v : '5'; } catch { return '5'; } })(),
      maxStock: '',
      reorderLevel: '',
      moq: '',
      unit: 'pcs',
      warranty: '',
      // Phase 2: Indian-garage pricing (floor = minSellingPrice, kept for BC)
      purchasePrice: '',
      mrp: '',
      sellingPrice: '',
      defaultSellingPrice: '',
      minSellingPrice: '', // Issue 3: bargain floor
      maxDiscount: '',
      imageString: '',
      images: [], // Phase 1: multiple images (imageString stays as cover mirror)
      notes: '',
      ...part,
    };
    // migrate a legacy single image into the images[] gallery
    if ((!base.images || base.images.length === 0) && base.imageString) base.images = [base.imageString];
    if (!base.defaultSellingPrice && base.sellingPrice) base.defaultSellingPrice = base.sellingPrice;
    // #5 + #6: tree-select arrays (migrate legacy strings / grouped vehicles).
    base.compatibleCars = flattenVehicles(part?.compatibleCars);
    base.categories = asList(part?.categories).length ? asList(part.categories) : asList(part?.category);
    // Issue 2: normalise to a suppliers[] array (supports legacy single supplier)
    base.suppliers = getPartSuppliers(part).map((s, i) => ({
      id: s.id || '',
      name: s.name || '',
      phone: s.phone || '',
      preferredLabel: s.preferredLabel || 'Primary',
      isPreferred: s.isPreferred ?? (Array.isArray(part?.suppliers) ? !!part.suppliers[i]?.isPreferred : false),
    }));
    if (base.suppliers.length === 0) base.suppliers = [{ id: '', name: '', phone: '', preferredLabel: 'Primary', isPreferred: false }];
    return base;
  });

  // Requirement 3: dynamically learned dropdown options from live inventory data
  const categoryOptions = useMemo(
    () => [...new Set([...DEFAULT_CATEGORIES, ...inventory.map((p) => p.category).filter(Boolean)])],
    [inventory]
  );
  const vehicleOptions = useMemo(
    () => [...new Set([...DEFAULT_VEHICLES, ...inventory.map((p) => p.vehicle).filter(Boolean)])],
    [inventory]
  );
  // Fix 2: rich combobox options — value is the phone (unique key for linking),
  // label is "Name - Phone" so typing a name OR a number surfaces the match.
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  // Issue 6: block 'e','E','+','-' in number fields
  const blockInvalidNumberKeys = (e) => {
    if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
  };

  // ---- #1 + #2 + #5: id-based supplier rows (no string/index matching) ----
  // A row is { id, name, phone (preferred contact), preferredLabel, isPreferred }.
  function updateSupplierRow(idx, nextRow) {
    setForm((f) => {
      let rows = [...f.suppliers];
      rows[idx] = nextRow;
      // #5: only ONE preferred supplier per part.
      if (nextRow.isPreferred) {
        rows = rows.map((r, i) => (i === idx ? r : { ...r, isPreferred: false }));
      }
      return { ...f, suppliers: rows };
    });
  }
  function addSupplierRow() {
    setForm((f) => ({
      ...f,
      suppliers: [...f.suppliers, { id: '', name: '', phone: '', preferredLabel: 'Primary', isPreferred: false }],
    }));
  }
  function removeSupplierRow(idx) {
    setForm((f) => {
      const rows = f.suppliers.filter((_, i) => i !== idx);
      return { ...f, suppliers: rows.length ? rows : [{ id: '', name: '', phone: '', preferredLabel: 'Primary', isPreferred: false }] };
    });
  }

  // Base64 image handling — no Firebase Storage. Phase 1: multiple images with
  // canvas compression so several photos stay small; images[0]/coverImage feeds
  // imageString (the cover) on save for every existing reader.
  const compressPartImage = (file, maxDim = 900, quality = 0.7) => new Promise((resolve, reject) => {
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
  async function handleImage(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const added = [];
    for (const file of files.slice(0, 8)) { try { added.push(await compressPartImage(file)); } catch (err) { toast.error(err.message || 'Image error'); } }
    if (added.length) setForm((f) => { const images = [...(f.images || []), ...added].slice(0, 8); return { ...f, images, imageString: images[f.coverImage || 0] || images[0] }; });
    e.target.value = '';
  }
  const removeImage = (idx) => setForm((f) => { const images = (f.images || []).filter((_, i) => i !== idx); const cover = Math.min(f.coverImage || 0, Math.max(0, images.length - 1)); return { ...f, images, coverImage: cover, imageString: images[cover] || '' }; });
  const setCover = (idx) => setForm((f) => ({ ...f, coverImage: idx, imageString: (f.images || [])[idx] || f.imageString }));
  const onDropImages = async (e) => { e.preventDefault(); const files = Array.from(e.dataTransfer.files || []); const added = []; for (const file of files.slice(0, 8)) { try { added.push(await compressPartImage(file)); } catch (err) { toast.error(err.message || 'Image error'); } } if (added.length) setForm((f) => { const images = [...(f.images || []), ...added].slice(0, 8); return { ...f, images, imageString: images[f.coverImage || 0] || images[0] }; }); };

  // ---- Draft autosave & restore (Add mode only) — nothing is lost on accidental exit ----
  // Namespaced by environment so a Demo draft NEVER appears in Production (and vice-versa).
  const DRAFT_KEY = `maruti_part_draft_v1_${demoMode ? 'demo' : 'prod'}`;
  const initialFormRef = useRef(null);
  if (initialFormRef.current === null) initialFormRef.current = JSON.stringify(form);
  const [draftMeta, setDraftMeta] = useState(null);
  const dirty = useMemo(() => JSON.stringify(form) !== initialFormRef.current, [form]);
  const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch {} setDraftMeta(null); };
  const restoreDraft = () => { if (draftMeta?.form) setForm(draftMeta.form); setDraftMeta(null); };
  useEffect(() => {
    if (isEdit) return;
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (d?.form && (String(d.form.name || '').trim() || String(d.form.sku || '').trim())) setDraftMeta({ ts: d.ts, form: d.form });
    } catch {}
  }, [isEdit]);
  useEffect(() => {
    if (isEdit) return;
    if (String(form.name || '').trim() || String(form.sku || '').trim()) {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ts: Date.now(), form })); } catch {}
    }
  }, [form, isEdit]);
  useEffect(() => {
    if (!dirty) return undefined;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  // Live completeness meter — reads the SAME fields the form actually writes
  // (categories[] and compatibleCars[]), with real validation rather than "exists".
  const partHealth = useMemo(() => {
    const checks = [
      { label: 'Name', ok: String(form.name || '').trim().length >= 3 && /[a-zA-Z]{3,}/.test(String(form.name || '').trim()) },
      { label: 'SKU', ok: String(form.sku || '').trim().length >= 3 },
      { label: 'Category', ok: asList(form.categories).length > 0 },
      { label: 'Vehicle', ok: asList(form.compatibleCars).length > 0 },
      { label: 'Selling price', ok: (Number(form.sellingPrice) || 0) > 0 },
      { label: 'Cost price', ok: (Number(form.purchasePrice) || 0) > 0 },
      { label: 'Image', ok: !!form.imageString },
    ];
    const done = checks.filter((c) => c.ok).length;
    return { checks, pct: Math.round((done / checks.length) * 100) };
  }, [form]);

  function handleSubmit(e) {
    e.preventDefault();
    // Issue 5: build a per-field error map, then surface inline (red border +
    // message) and scroll to the first invalid field instead of a single toast.
    const errs = {};
    const pp = parseFloat(form.purchasePrice) || 0;
    const sp = parseFloat(form.sellingPrice) || 0;
    const msp = parseFloat(form.minSellingPrice) || 0;
    if (!form.name.trim()) errs.name = 'Part name is required.';
    if (asList(form.categories).length === 0) errs.categories = 'Please select at least one category.';
    if (!isEdit && String(form.stock).trim() === '') errs.stock = 'Current stock is required.';
    if (!(sp > 0)) errs.sellingPrice = 'MRP / selling price is required.';
    if (isAdmin) {
      if (!(pp > 0)) errs.purchasePrice = 'Purchase price is required.';
      if (!(msp > 0)) errs.minSellingPrice = 'Min sell (floor) price is required.';
      if (pp > 0 && sp > 0 && sp < pp) errs.sellingPrice = 'MRP must be ≥ the purchase price.';
      if (msp > 0 && pp > 0 && msp < pp) errs.minSellingPrice = 'Floor must be ≥ the purchase price.';
      if (msp > 0 && sp > 0 && msp > sp) errs.minSellingPrice = 'Floor cannot be higher than the MRP.';
    }
    // Issue 15: supplier phone numbers are a STRICT rule, not a warning. Block
    // Add Part / Save if any attached supplier has an invalid Indian mobile.
    const badPhone = (form.suppliers || []).some((s) => {
      const nums = (s.phoneNumbers && s.phoneNumbers.length ? s.phoneNumbers.map((p) => p.number) : [s.phone]).filter(Boolean);
      return nums.some((n) => !isValidIndianPhone(n));
    });
    if (badPhone) {
      toast.error('A supplier has an invalid phone number. Use a 10-digit Indian mobile starting 6–9 before saving.');
      setMobileStep(3);
      return;
    }
    // Critical Bug #2: duplicate SKU is a STRICT block. Same record keeping its
    // own SKU is fine (p.id !== part?.id excludes self); another part using it
    // blocks the save.
    const skuKey = safeLower((form.sku || '').trim());
    if (skuKey) {
      const dup = inventory.find((p) => p.id !== part?.id && safeLower(p.sku) === skuKey);
      if (dup) {
        toast.error(`SKU already exists (used by “${dup.name}”). Please enter a unique SKU.`);
        setErrors((x) => ({ ...x, sku: 'SKU already exists.' }));
        setMobileStep(1);
        return;
      }
    }
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      // jump to the step holding the first invalid field, then scroll to it.
      const step1Fields = ['name', 'categories'];
      const firstStep1 = step1Fields.find((f) => errs[f]);
      const firstField = firstStep1 || ['stock', 'purchasePrice', 'sellingPrice', 'minSellingPrice'].find((f) => errs[f]);
      setMobileStep(firstStep1 ? 1 : 2);
      setTimeout(() => {
        const el = document.querySelector(`[data-field="${firstField}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
      return;
    }
    setErrors({});
    clearDraft();
    // Phase 1/2: keep imageString (cover) in sync with images[] so every existing
    // reader (billing, job cards, tables) keeps working; ensure selling defaults.
    const out = { ...form };
    if (out.images && out.images.length) out.imageString = out.images[out.coverImage || 0] || out.images[0];
    else if (out.imageString && (!out.images || !out.images.length)) out.images = [out.imageString];
    if (!out.defaultSellingPrice && out.sellingPrice) out.defaultSellingPrice = out.sellingPrice;
    if (!out.sellingPrice && out.defaultSellingPrice) out.sellingPrice = out.defaultSellingPrice;
    onSave(out);
  }

  // Task 1: live validity for disabling Save until required fields are valid.
  const formValid = (() => {
    if (!form.name.trim()) return false;
    if (asList(form.categories).length === 0) return false;
    if (!isEdit && String(form.stock).trim() === '') return false;
    const pp = parseFloat(form.purchasePrice) || 0;
    const sp = parseFloat(form.sellingPrice) || 0;
    const msp = parseFloat(form.minSellingPrice) || 0;
    if (!(sp > 0)) return false;
    if (isAdmin) {
      if (!(pp > 0) || !(msp > 0)) return false;
      if (sp < pp || msp < pp || msp > sp) return false;
    }
    return true;
  })();

  const fieldLabel = 'block text-[11px] uppercase tracking-wider text-white/40 mb-1.5';
  const fieldInput =
    'w-full px-3 py-2.5 rounded-xl text-sm outline-none bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-[#d4af37]/60 transition backdrop-blur-sm';
  // Issue 5: red border + inline message per field.
  const errCls = (f) => (errors[f] ? ' !border-red-500/70 focus:!border-red-500' : '');
  const errMsg = (f) => (errors[f] ? <p className="text-[11px] text-red-400 mt-1">{errors[f]}</p> : null);

  const formEl = (
        <form ref={formBodyRef} id="part-form" onSubmit={handleSubmit} className="p-5 space-y-4 safe-bottom-pad">
          {draftMeta && !isEdit && (
            <div className="rounded-xl p-3 flex items-center gap-3 flex-wrap" style={{ background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.3)' }}>
              <span className="text-xs text-white/75 flex-1 min-w-[140px]">Unsaved draft{draftMeta.ts ? ` from ${new Date(draftMeta.ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ''} found.</span>
              <button type="button" onClick={restoreDraft} className="h-8 px-3 rounded-lg text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] active:scale-95">Restore</button>
              <button type="button" onClick={clearDraft} className="h-8 px-3 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-white/70 active:scale-95">Discard</button>
            </div>
          )}
          {/* Live completeness meter — only useful while adding a new part */}
          {!isEdit && (
          <div className="rounded-xl p-3" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] uppercase tracking-wide text-white/45">Part completeness</span>
              <span className="text-sm font-bold" style={{ color: partHealth.pct >= 90 ? '#34d399' : partHealth.pct >= 60 ? '#d4af37' : '#fb923c' }}>{partHealth.pct}%{partHealth.pct === 100 ? ' · Ready to save' : ''}</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden mb-2.5" style={{ background: 'rgba(var(--fg-rgb),0.08)' }}>
              <div className="h-full rounded-full transition-all duration-500 ease-out" style={{ width: `${partHealth.pct}%`, background: partHealth.pct >= 90 ? '#34d399' : partHealth.pct >= 60 ? 'linear-gradient(90deg,#d4af37,#aa801e)' : '#fb923c' }} />
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {partHealth.checks.map((c) => (
                <span key={c.label} className="inline-flex items-center gap-1 text-[11px]" style={{ color: c.ok ? 'rgba(52,211,153,0.9)' : 'rgba(var(--fg-rgb),0.35)' }}>
                  {c.ok ? <Check size={11} /> : <span className="w-[11px] h-[11px] inline-block rounded-full border border-white/25" />} {c.label}
                </span>
              ))}
            </div>
          </div>
          )}
          <div className="sm:hidden">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-white/70">Step {mobileStep} of {STEPS.length} · {STEPS[mobileStep - 1].label}</span>
            </div>
            <div className="flex gap-1.5">
              {STEPS.map((s) => (
                <div key={s.n} className="h-1 flex-1 rounded-full" style={{ background: s.n <= mobileStep ? '#d4af37' : 'rgba(var(--fg-rgb),0.1)' }} />
              ))}
            </div>
          </div>

          {/* STEP 1 — Details */}
          <div className={stepCls(1)}>
          {isEdit && saleStats && saleStats.count > 0 && (
            <div className="rounded-xl px-3 py-2.5 mb-1 bg-[#d4af37]/8 border border-[#d4af37]/20">
              <p className="text-[10px] uppercase tracking-wider text-[#d4af37]/80 mb-1.5">Recent sales</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-[10px] text-white/40">Last sold</div>
                  <div className="text-xs font-semibold text-white">{saleStats.lastDate ? saleStats.lastDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-white/40">Last price</div>
                  <div className="text-xs font-semibold text-white">{saleStats.lastPrice != null ? formatINR(saleStats.lastPrice) : '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-white/40">This month</div>
                  <div className="text-xs font-semibold text-white">{saleStats.thisMonth} sold</div>
                </div>
              </div>
            </div>
          )}
          {/* Image upload — multiple, drag & drop, camera, cover selection */}
          <div>
            <label className={fieldLabel}>Part Photos <span className="normal-case text-white/30">(up to 8 — camera, gallery, or drag & drop; first is cover)</span></label>
            <div className="flex flex-wrap gap-2" onDragOver={(e) => e.preventDefault()} onDrop={onDropImages}>
              {(form.images || []).map((img, idx) => (
                <div key={idx} className="relative w-16 h-16 rounded-xl overflow-hidden bg-white" style={{ border: (form.coverImage || 0) === idx ? '2px solid #d4af37' : '1px solid rgba(212,175,55,0.3)' }}>
                  <img src={img} alt="" className="w-full h-full object-contain" />
                  <button type="button" onClick={() => setCover(idx)} title="Set cover" className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-black/70 flex items-center justify-center" style={{ color: (form.coverImage || 0) === idx ? '#d4af37' : '#fff' }}><Star size={9} fill={(form.coverImage || 0) === idx ? '#d4af37' : 'none'} /></button>
                  <button type="button" onClick={() => removeImage(idx)} className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center"><X size={9} /></button>
                  {(form.coverImage || 0) === idx && <span className="absolute bottom-0 inset-x-0 text-[6px] font-bold text-center text-black py-0.5" style={{ background: '#d4af37' }}>COVER</span>}
                </div>
              ))}
              {(form.images || []).length < 8 && (
                <label className="w-16 h-16 rounded-xl flex flex-col items-center justify-center cursor-pointer text-white/40 hover:text-white/70 transition bg-white/5 border border-dashed border-white/20">
                  <Camera size={16} /><span className="text-[8px] mt-0.5">Add</span>
                  <input type="file" accept="image/*" capture="environment" multiple onChange={handleImage} className="hidden" />
                </label>
              )}
            </div>
          </div>

          <div>
            <label className={fieldLabel}>Part Name *</label>
            <input
              value={form.name}
              onChange={(e) => { set('name')(e); if (errors.name) setErrors((x) => ({ ...x, name: undefined })); }}
              placeholder="e.g. Maruti Swift Brake Pads"
              data-field="name"
              className={`${fieldInput}${errCls('name')}`}
            />
            {errMsg('name')}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel}>SKU / Part No.</label>
              <input value={form.sku} onChange={set('sku')} placeholder="BP-SWF-001" className={fieldInput} />
              {(() => {
                const s = safeLower((form.sku || '').trim());
                if (!s) return null;
                const dup = inventory.find((p) => p.id !== part?.id && safeLower(p.sku) === s);
                return dup ? (
                  <p className="text-[10px] text-red-400 font-semibold mt-1">✕ SKU already exists (used by “{dup.name}”). Please enter a unique SKU — save is blocked.</p>
                ) : null;
              })()}
            </div>

            <div>
              <label className={fieldLabel}>OEM Number</label>
              <input value={form.oemNo || ''} onChange={set('oemNo')} placeholder="55810M68K00" className={fieldInput} />
            </div>
            <div>
              <label className={fieldLabel}>Manufacturer Part No.</label>
              <input value={form.partNo || ''} onChange={set('partNo')} placeholder="BP-001" className={fieldInput} />
            </div>
            <div>
              <label className={fieldLabel}>Brand</label>
              <input value={form.brand || ''} onChange={set('brand')} placeholder="Bosch / Maruti Genuine" className={fieldInput} />
            </div>
            <div>
              <label className={fieldLabel}>Barcode</label>
              <div className="flex gap-1.5">
                <input value={form.barcode || ''} onChange={set('barcode')} placeholder="Scan or enter" className={fieldInput} />
                <button type="button" onClick={() => setForm((f) => ({ ...f, barcode: `SBBMC${Date.now().toString().slice(-9)}` }))} title="Generate barcode" className="px-2.5 rounded-lg text-[11px] font-bold bg-white/5 border border-white/10 text-[#d4af37] hover:bg-white/10 flex-shrink-0">Gen</button>
              </div>
            </div>
            <div>
              <label className={fieldLabel}>HSN Code</label>
              <input value={form.hsn || ''} onChange={set('hsn')} placeholder="8708" className={fieldInput} />
            </div>
            <div>
              <label className={fieldLabel}>GST %</label>
              <select value={form.gst || '18'} onChange={set('gst')} className={fieldInput}>{['0', '5', '12', '18', '28'].map((g) => <option key={g} value={g} style={{ background: '#141414' }}>{g}%</option>)}</select>
            </div>

            {/* #6: Category Tree-Select (parent → children, multi-select) */}
            <div>
              <label className={fieldLabel}>Categories *</label>
              <div data-field="categories" className={errors.categories ? 'rounded-xl ring-1 ring-red-500/60' : ''}>
                <TreeSelect
                  tree={categoryTree}
                  value={form.categories}
                  onChange={(arr) => { setForm((f) => ({ ...f, categories: arr })); if (errors.categories) setErrors((x) => ({ ...x, categories: undefined })); }}
                  placeholder="Select categories…"
                  onAddLeaf={onAddCategory}
                />
              </div>
              {errMsg('categories')}
              <p className="text-[11px] text-white/35 mt-1">First selected is the part’s primary category.</p>
            </div>
          </div>

          {/* #2 + #5: Vehicle compatibility Tree-Select (Make → models, multi) */}
          <div>
            <label className={fieldLabel}>Compatible Vehicles</label>
            {(() => {
              const isUni = asList(form.compatibleCars).some((v) => safeLower(v).includes('universal'));
              return (
                <>
                  <label className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer mb-2" style={{ background: isUni ? 'rgba(212,175,55,0.12)' : 'rgba(var(--fg-rgb),0.04)', border: `1px solid ${isUni ? 'rgba(212,175,55,0.4)' : 'rgba(var(--fg-rgb),0.1)'}` }}>
                    <input
                      type="checkbox"
                      checked={isUni}
                      onChange={(e) => setForm((f) => ({ ...f, compatibleCars: e.target.checked ? ['Universal / All Vehicles'] : [] }))}
                      className="w-4 h-4 accent-[#d4af37]"
                    />
                    <span className="text-sm font-semibold text-white">Universal — fits all vehicles</span>
                  </label>
                  {!isUni && (
                    <>
                      <TreeSelect
                        tree={vehicleTree}
                        value={form.compatibleCars}
                        onChange={(arr) => setForm((f) => ({ ...f, compatibleCars: arr }))}
                        placeholder="Select brands & models…"
                        onAddVehicle={onAddVehicle}
                      />
                      <p className="text-[11px] text-white/35 mt-1">
                        Pick a brand to select all its models, or individual models. Or tick “Universal” above if it fits everything.
                      </p>
                    </>
                  )}
                </>
              );
            })()}
          </div>

          <div>
            <label className={fieldLabel}>Shelf / Bin Location</label>
            <div className="relative">
              <MapPin size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#d4af37]/70 pointer-events-none" />
              <input
                type="text"
                value={form.locationBin}
                onChange={set('locationBin')}
                placeholder="e.g. Rack 3, Shelf B"
                className={`${fieldInput} pl-9`}
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
              <input value={form.shelf || ''} onChange={set('shelf')} placeholder="Shelf" className={fieldInput} />
              <input value={form.rack || ''} onChange={set('rack')} placeholder="Rack" className={fieldInput} />
              <input value={form.bin || ''} onChange={set('bin')} placeholder="Bin" className={fieldInput} />
              <input value={form.warehouse || ''} onChange={set('warehouse')} placeholder="Warehouse" className={fieldInput} />
            </div>
          </div>
          </div>
          {/* STEP 2 — Stock & Pricing */}
          <div className={stepCls(2)}>

          <div className="grid grid-cols-2 gap-3">
            <div data-field="stock">
              <label className={fieldLabel}>Current Stock {isEdit ? '' : '*'}</label>
              {isEdit ? (
                <>
                  <div className={`${fieldInput} flex items-center justify-between`} style={{ opacity: 0.85 }}>
                    <span className="font-semibold">{form.stock || 0}</span>
                    <span className="text-[10px] text-white/40 uppercase tracking-wider">read-only</span>
                  </div>
                  <p className="text-[10px] text-white/35 mt-1">Change stock via <span className="text-red-400/80">Sell</span> (records a sale) or the green <span className="text-emerald-400/80">Receive</span> button (records a restock) — keeps analytics accurate.</p>
                </>
              ) : (
                <>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.stock}
                    onChange={(e) => { set('stock')(e); if (errors.stock) setErrors((x) => ({ ...x, stock: undefined })); }}
                    onKeyDown={blockInvalidNumberKeys}
                    placeholder="0"
                    className={`${fieldInput}${errCls('stock')}`}
                  />
                  {errMsg('stock')}
                </>
              )}
            </div>
            <div>
              <label className={fieldLabel}>Min Stock Alert</label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.minStock}
                onChange={set('minStock')}
                onKeyDown={blockInvalidNumberKeys}
                placeholder="5"
                className={fieldInput}
              />
            </div>
          </div>

          {/* Fix 4: pricing block — Purchase, MRP, Min Selling + live margins.
              FIX-02: cost-sensitive fields (Purchase, Min Sell, margins) are
              admin-only; mechanics see only the customer-facing MRP. */}
          <div className="rounded-xl p-3 space-y-3" style={{ background: 'rgba(212,175,55,0.04)', border: '1px solid rgba(212,175,55,0.12)' }}>
            <div className={`grid ${isAdmin ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2'} gap-2`}>
              {isAdmin && (
                <div data-field="purchasePrice">
                  <label className={fieldLabel}>Purchase (₹) *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.purchasePrice}
                    onChange={(e) => { set('purchasePrice')(e); if (errors.purchasePrice || errors.sellingPrice || errors.minSellingPrice) setErrors({}); }}
                    onKeyDown={blockInvalidNumberKeys}
                    placeholder="0"
                    className={`${fieldInput}${errCls('purchasePrice')}`}
                  />
                  {errMsg('purchasePrice')}
                </div>
              )}
              <div>
                <label className={fieldLabel}>MRP (₹)</label>
                <input type="number" min="0" step="0.01" value={form.mrp || ''} onChange={set('mrp')} onKeyDown={blockInvalidNumberKeys} placeholder="Printed max" className={fieldInput} />
              </div>
              <div data-field="sellingPrice">
                <label className={fieldLabel}>Default Sell (₹) *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.sellingPrice}
                  onChange={(e) => { set('sellingPrice')(e); setForm((f) => ({ ...f, defaultSellingPrice: e.target.value })); if (errors.sellingPrice || errors.minSellingPrice) setErrors((x) => ({ ...x, sellingPrice: undefined, minSellingPrice: undefined })); }}
                  onKeyDown={blockInvalidNumberKeys}
                  placeholder="0"
                  className={`${fieldInput}${errCls('sellingPrice')}`}
                />
                {errMsg('sellingPrice')}
              </div>
              {isAdmin && (
                <div data-field="minSellingPrice">
                  <label className={fieldLabel}>Floor (₹) *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.minSellingPrice}
                    onChange={(e) => { set('minSellingPrice')(e); if (errors.minSellingPrice) setErrors((x) => ({ ...x, minSellingPrice: undefined })); }}
                    onKeyDown={blockInvalidNumberKeys}
                    placeholder="0"
                    className={`${fieldInput}${errCls('minSellingPrice')}`}
                  />
                  {errMsg('minSellingPrice')}
                </div>
              )}
            </div>
            {/* Live margins — admin only (reveals cost) */}
            {isAdmin && (
              <>
                {(() => {
                  const pp = parseFloat(form.purchasePrice) || 0;
                  const sp = parseFloat(form.sellingPrice) || 0;
                  const fp = parseFloat(form.minSellingPrice) || 0;
                  const profit = sp - pp;
                  const margin = sp > 0 ? (profit / sp) * 100 : 0;
                  const floorProfit = fp - pp;
                  return (
                    <div className="flex items-center justify-between text-xs font-semibold pt-0.5 flex-wrap gap-1">
                      <span className="text-emerald-400">Profit: {formatINR(profit)} ({margin.toFixed(1)}%)</span>
                      <span className="w-px h-4 bg-white/10" />
                      <span className={floorProfit < 0 ? 'text-red-400' : 'text-amber-400'}>At floor: {formatINR(floorProfit)}</span>
                    </div>
                  );
                })()}
                <p className="text-[11px] text-white/35">
                  Default Sell is what Billing starts at. Floor is the bargain minimum — sales below it need manager approval.
                </p>
              </>
            )}
          </div>
          </div>
          {/* STEP 3 — Supplier */}
          <div className={stepCls(3)}>

          {/* #1 + #2: id-based searchable supplier rows with preferred contact */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={fieldLabel} style={{ marginBottom: 0 }}>Suppliers</label>
              <button
                type="button"
                onClick={addSupplierRow}
                className="flex items-center gap-1 text-[11px] font-semibold text-[#d4af37] hover:text-[#e8c84a] transition"
              >
                <Plus size={12} /> Add supplier
              </button>
            </div>
            <div className="space-y-2.5">
              {form.suppliers.map((row, idx) => (
                <SupplierPicker
                  key={idx}
                  suppliers={suppliers}
                  row={row}
                  onChange={(next) => updateSupplierRow(idx, next)}
                  onRemove={() => removeSupplierRow(idx)}
                  onSaveSupplier={onSaveSupplier}
                />
              ))}
            </div>
            <p className="text-[11px] text-white/35 mt-1.5">
              Search links an existing supplier by its unique ID. The first supplier’s preferred number is used for WhatsApp reorders; new suppliers are saved to the Suppliers tab.
            </p>
          </div>
          </div>
          {/* END STEP 3 */}

          {/* Mobile footer — Back / Next / Save (CHANGE-02) */}
          <div
            className="flex sm:hidden gap-3 pt-3 pb-1 mt-2 sticky bottom-0 -mx-5 px-5"
            style={{ background: 'var(--surface-1)', borderTop: '1px solid rgba(var(--fg-rgb),0.08)', paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
          >
            <button
              type="button"
              onClick={() => (mobileStep === 1 ? onClose() : setMobileStep((s) => s - 1))}
              className="flex-1 py-3 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80 active:scale-[0.98] transition"
            >
              {mobileStep === 1 ? 'Cancel' : 'Back'}
            </button>
            {mobileStep < STEPS.length ? (
              <button
                type="button"
                onClick={() => {
                  if (mobileStep === 1 && !form.name.trim()) {
                    setErrors((x) => ({ ...x, name: 'Part name is required.' }));
                    toast.error('Enter the part name to continue.');
                    // Scroll the field into view and focus it so it's obvious why Next was blocked.
                    const el = document.querySelector('[data-field="name"]');
                    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); }
                    return;
                  }
                  setMobileStep((s) => Math.min(STEPS.length, s + 1));
                }}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] active:scale-[0.98] transition"
              >
                Next
              </button>
            ) : (
              <button
                type="submit"
                disabled={saving || !formValid}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] active:scale-[0.98] transition disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {saving && <Loader2 size={15} className="animate-spin" />}
                {isEdit ? 'Save Changes' : 'Add Part'}
              </button>
            )}
          </div>
        </form>
  );

  // Mobile: full-screen page in normal document flow — the BODY scrolls natively,
  // so there is no fixed overlay, no height math, and none of the iOS/Android
  // modal-scroll problems can occur. The form's own sticky footer (Back/Next/Save)
  // pins to the viewport bottom via native scroll.
  if (asPage) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--surface-0)' }}>
        <div
          className="sticky top-0 z-20 flex items-center gap-2 px-3 py-3"
          style={{ background: 'var(--surface-1)', borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}
        >
          <button type="button" onClick={onClose} aria-label="Back" className="w-10 h-10 -ml-1 rounded-full flex items-center justify-center text-white/75 active:bg-white/10 transition">
            <ChevronLeft size={24} />
          </button>
          <div className="text-base font-bold bg-gradient-to-r from-[#d4af37] to-[#aa801e] bg-clip-text text-transparent">
            {isEdit ? 'Edit Part' : 'Add New Part'}
          </div>
        </div>
        {formEl}
      </div>
    );
  }

  return (
    <Modal
      onClose={onClose}
      title={isEdit ? 'Edit Part' : 'Add New Part'}
      bodyClassName=""
      footer={(
        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 transition">Cancel</button>
          <button type="submit" form="part-form" disabled={saving || !formValid} className="flex-1 py-3 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] hover:brightness-110 active:scale-[0.98] transition disabled:opacity-60 flex items-center justify-center gap-2">
            {saving && <Loader2 size={15} className="animate-spin" />}
            {isEdit ? 'Save Changes' : 'Add Part'}
          </button>
        </div>
      )}
    >
      {formEl}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Logout confirmation modal (custom, themed)
// ---------------------------------------------------------------------------
function LogoutConfirmModal({ onCancel, onConfirm }) {
  useBodyScrollLock();
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        className="w-full max-w-sm rounded-2xl overflow-hidden backdrop-blur-md p-6"
        style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }}
      >
        <div className="flex flex-col items-center text-center gap-3">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(212,175,55,0.12)', border: '1px solid rgba(212,175,55,0.3)' }}
          >
            <ShieldCheck size={26} className="text-[#d4af37]" />
          </div>
          <h2 className="text-lg font-bold text-white">Confirm Logout</h2>
          <p className="text-sm text-white/55">Are you sure you want to securely log out?</p>
        </div>
        <div className="flex gap-3 mt-6">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 transition"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] hover:brightness-110 active:scale-[0.98] transition flex items-center justify-center gap-1.5"
          >
            <LogOut size={15} /> Confirm Logout
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FIX 2: Reorder PO router — block alert OR pick-a-number micro-modal
// ---------------------------------------------------------------------------
function ReorderModal({ target, onPick, onClose }) {
  useBodyScrollLock();
  const { part, supplierName, contacts = [], block } = target;
  return (
    <div
      className="fixed inset-0 z-[115] flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-sm rounded-2xl overflow-hidden backdrop-blur-md"
        style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>
          <div className="flex items-center gap-2">
            <MessageCircle size={18} className="text-[#d4af37]" />
            <h2 className="text-base font-bold text-white">{block ? 'Operational Block' : 'Send Purchase Order'}</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/60 transition">
            <X size={16} />
          </button>
        </div>

        {block ? (
          <div className="p-5">
            <div className="flex items-start gap-3 rounded-xl p-3 bg-red-500/10 border border-red-500/25">
              <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-white/80">
                Please assign a supplier with a valid contact record to <span className="font-semibold text-white">{part.name}</span> before generating a purchase order.
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-full mt-4 py-2.5 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] hover:brightness-110 transition"
            >
              Got it
            </button>
          </div>
        ) : (
          <div className="p-5">
            <p className="text-xs text-white/50 mb-3">
              <span className="text-white/80 font-semibold">{supplierName}</span> has multiple contacts. Choose where to send the PO for <span className="text-[#d4af37]">{part.name}</span>:
            </p>
            <div className="space-y-2">
              {contacts.map((c, i) => (
                <button
                  key={`${c.number}-${i}`}
                  onClick={() => onPick(c.number)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl text-left transition active:scale-[0.99] bg-white/5 border border-white/10 hover:border-[#d4af37]/40 hover:bg-[#d4af37]/10"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Phone size={14} className="text-[#d4af37] flex-shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-white truncate">Send to {c.label || 'Contact'}</span>
                      <span className="block text-xs text-white/45">{c.number}</span>
                    </span>
                  </span>
                  <MessageCircle size={16} className="text-emerald-400 flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add / Edit Supplier Modal
// ---------------------------------------------------------------------------
// Part 5: Indian garage-specific supplier categories.
const SUPPLIER_TYPES = ['Authorized OEM Dealer', 'Local Spare Parts Dealer', 'Lubricant Distributor', 'Battery Dealer', 'Tyre Dealer', 'Accessories Dealer', 'Electrical Parts Dealer', 'Body Parts Dealer', 'Paint Supplier', 'Tools Supplier', 'Hardware Supplier', 'Used Parts Supplier', 'Scrap Vendor', 'Fleet Supplier', 'Wholesale Distributor', 'Retail Dealer', 'Importer', 'Manufacturer', 'Workshop Partner', 'Other'];
const PAYMENT_MODES = ['Cash', 'UPI', 'Bank Transfer', 'Credit', 'Cheque'];
// GST state codes → state name (for auto-detection; GST is optional).
const GST_STATE_CODES = { '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', 10: 'Bihar', 11: 'Sikkim', 12: 'Arunachal Pradesh', 13: 'Nagaland', 14: 'Manipur', 15: 'Mizoram', 16: 'Tripura', 17: 'Meghalaya', 18: 'Assam', 19: 'West Bengal', 20: 'Jharkhand', 21: 'Odisha', 22: 'Chhattisgarh', 23: 'Madhya Pradesh', 24: 'Gujarat', 27: 'Maharashtra', 29: 'Karnataka', 30: 'Goa', 32: 'Kerala', 33: 'Tamil Nadu', 34: 'Puducherry', 36: 'Telangana', 37: 'Andhra Pradesh' };

function SupplierModal({ supplier, saving, onSave, onClose, asPage = false, demoMode = false }) {  const isEdit = !!supplier?.id;
  const [form, setForm] = useState(() => {
    const contacts = getSupplierContacts(supplier);
    const altNames = Array.isArray(supplier?.altNames) ? supplier.altNames : [];
    return {
      name: supplier?.name || '',
      // FIX 3: structured labeled contact cards
      phoneNumbers: contacts.length ? contacts : [{ number: '', label: 'Primary' }],
      altNames: altNames.length ? altNames : [''],
      // Part 5: business + tax fields (GST is always OPTIONAL)
      type: supplier?.type || 'Local Spare Parts Dealer',
      contactPerson: supplier?.contactPerson || '',
      ownerName: supplier?.ownerName || '',
      email: supplier?.email || '',
      website: supplier?.website || '',
      whatsapp: supplier?.whatsapp || '',
      gst: supplier?.gst || '',
      pan: supplier?.pan || '',
      businessReg: supplier?.businessReg || '',
      address: supplier?.address || '',
      area: supplier?.area || '',
      city: supplier?.city || '',
      district: supplier?.district || '',
      state: supplier?.state || '',
      pincode: supplier?.pincode || '',
      // payment terms
      paymentMode: supplier?.paymentMode || 'Cash',
      creditDays: supplier?.creditDays ?? '',
      openingBalance: supplier?.openingBalance ?? '',
      outstanding: supplier?.outstanding ?? '',
      // bank (optional)
      bankName: supplier?.bankName || '',
      accountHolder: supplier?.accountHolder || '',
      accountNumber: supplier?.accountNumber || '',
      ifsc: supplier?.ifsc || '',
      upi: supplier?.upi || '',
      // classification
      preferred: !!supplier?.preferred,
      status: supplier?.status || 'Active',
      logo: supplier?.logo || '',
      documents: Array.isArray(supplier?.documents) ? supplier.documents : [],
      notes: supplier?.notes || '',
      id: supplier?.id,
    };
  });
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  // FIX 3: labeled multi-contact phone cards
  const updateContact = (idx, key, val) =>
    setForm((f) => {
      const phoneNumbers = f.phoneNumbers.map((c, i) =>
        i === idx ? { ...c, [key]: key === 'number' ? phoneInput(val) : val } : c
      );
      return { ...f, phoneNumbers };
    });
  const addContact = () =>
    setForm((f) => ({ ...f, phoneNumbers: [...f.phoneNumbers, { number: '', label: 'WhatsApp' }] }));
  const removeContact = (idx) =>
    setForm((f) => {
      const phoneNumbers = f.phoneNumbers.filter((_, i) => i !== idx);
      return { ...f, phoneNumbers: phoneNumbers.length ? phoneNumbers : [{ number: '', label: 'Primary' }] };
    });

  // Issue 2: alternate names
  const updateAltName = (idx, val) =>
    setForm((f) => {
      const altNames = [...f.altNames];
      altNames[idx] = val;
      return { ...f, altNames };
    });
  const addAltName = () => setForm((f) => ({ ...f, altNames: [...f.altNames, ''] }));
  const removeAltName = (idx) =>
    setForm((f) => {
      const altNames = f.altNames.filter((_, i) => i !== idx);
      return { ...f, altNames: altNames.length ? altNames : [''] };
    });

  // ---- Supplier draft autosave & restore (Add mode only) ----
  const SUP_DRAFT_KEY = `maruti_supplier_draft_v1_${demoMode ? 'demo' : 'prod'}`;
  const supInitialRef = useRef(null);
  if (supInitialRef.current === null) supInitialRef.current = JSON.stringify(form);
  const [supDraft, setSupDraft] = useState(null);
  const supDirty = useMemo(() => JSON.stringify(form) !== supInitialRef.current, [form]);
  const clearSupDraft = () => { try { localStorage.removeItem(SUP_DRAFT_KEY); } catch {} setSupDraft(null); };
  const restoreSupDraft = () => { if (supDraft?.form) setForm(supDraft.form); setSupDraft(null); };
  useEffect(() => {
    if (isEdit) return;
    try { const d = JSON.parse(localStorage.getItem(SUP_DRAFT_KEY) || 'null'); if (d?.form && String(d.form.name || '').trim()) setSupDraft({ ts: d.ts, form: d.form }); } catch {}
  }, [isEdit]);
  useEffect(() => {
    if (isEdit) return;
    if (String(form.name || '').trim()) { try { localStorage.setItem(SUP_DRAFT_KEY, JSON.stringify({ ts: Date.now(), form })); } catch {} }
  }, [form, isEdit]);
  useEffect(() => {
    if (!supDirty) return undefined;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [supDirty]);

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Supplier name is required.');
      return;
    }
    // Task 3 (Task 6): validate every entered phone number (Add/Edit + alternates).
    const entered = (form.phoneNumbers || []).filter((p) => digitsOnly(p.number).length > 0);
    const bad = entered.find((p) => !isValidIndianPhone(p.number));
    if (bad) {
      toast.error(`“${bad.number}” isn’t a valid Indian number. Use a 10-digit mobile starting 6–9 (e.g. 9876543210).`);
      return;
    }
    // Task 6: no duplicate numbers under the same supplier.
    const seenNums = new Set();
    const dupNum = entered.find((p) => { const k = normalizePhone(p.number); if (seenNums.has(k)) return true; seenNums.add(k); return false; });
    if (dupNum) {
      toast.error(`“${dupNum.number}” is listed more than once for this supplier.`);
      return;
    }
    if (entered.length === 0) {
      toast.error('Add at least one valid phone number.');
      return;
    }
    // Part 5 business rule: GST is NEVER mandatory. But if entered, validate format.
    let stateFromGst = form.state;
    if (form.gst && form.gst.trim()) {
      const g = form.gst.trim().toUpperCase();
      if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(g)) {
        toast.error('GST number format looks invalid. Leave it blank for a non-GST supplier, or enter a valid 15-character GSTIN.');
        return;
      }
      // auto-detect state from the GST state code (first 2 digits)
      const detected = GST_STATE_CODES[g.slice(0, 2)];
      if (detected && !form.state) stateFromGst = detected;
    }
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) { toast.error('Enter a valid email or leave it blank.'); return; }
    clearSupDraft();
    onSave({ ...form, gst: (form.gst || '').trim().toUpperCase(), state: stateFromGst });
  }

  const CONTACT_LABELS = ['Primary', 'WhatsApp', 'Landline', 'Owner', 'Accounts', 'Workshop', 'Manager'];
  const fieldLabel = 'block text-[11px] uppercase tracking-wider text-white/40 mb-1.5';
  const fieldInput =
    'w-full px-3 py-2.5 rounded-xl text-sm outline-none bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-[#d4af37]/60 transition backdrop-blur-sm';

  const formEl = (
        <form onSubmit={handleSubmit} className="p-5 space-y-4 safe-bottom-pad">
          {supDraft && !isEdit && (
            <div className="rounded-xl p-3 flex items-center gap-3 flex-wrap" style={{ background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.3)' }}>
              <span className="text-xs text-white/75 flex-1 min-w-[140px]">Unsaved supplier draft{supDraft.ts ? ` from ${new Date(supDraft.ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ''} found.</span>
              <button type="button" onClick={restoreSupDraft} className="h-8 px-3 rounded-lg text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] active:scale-95">Restore</button>
              <button type="button" onClick={clearSupDraft} className="h-8 px-3 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-white/70 active:scale-95">Discard</button>
            </div>
          )}
          <div>
            <label className={fieldLabel}>Supplier Name *</label>
            <input value={form.name} onChange={set('name')} placeholder="e.g. Krishna Auto Parts" required className={fieldInput} />
          </div>

          {/* Issue 2: alternate names */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={fieldLabel} style={{ marginBottom: 0 }}>Alternate Names</label>
              <button type="button" onClick={addAltName} className="flex items-center gap-1 text-[11px] font-semibold text-[#d4af37] hover:text-[#e8c84a] transition">
                <Plus size={12} /> Add name
              </button>
            </div>
            <div className="space-y-2">
              {form.altNames.map((n, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <input
                    value={n}
                    onChange={(e) => updateAltName(idx, e.target.value)}
                    placeholder="e.g. Krishna Spares / Krishna Bros"
                    className={`${fieldInput} flex-1`}
                  />
                  <button type="button" onClick={() => removeAltName(idx)} className="w-9 h-9 flex-shrink-0 rounded-lg flex items-center justify-center bg-red-500/10 border border-red-500/25 text-red-400 hover:bg-red-500/20 transition">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* FIX 3: labeled multi-contact phone cards */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={fieldLabel} style={{ marginBottom: 0 }}>Phone Numbers</label>
              <button type="button" onClick={addContact} className="flex items-center gap-1 text-[11px] font-semibold text-[#d4af37] hover:text-[#e8c84a] transition">
                <Plus size={12} /> Add Alternate Number
              </button>
            </div>
            <div className="space-y-2">
              {form.phoneNumbers.map((c, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <input
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    pattern="[0-9]{10}"
                    value={c.number}
                    onChange={(e) => updateContact(idx, 'number', e.target.value)}
                    placeholder={idx === 0 ? 'Primary 10-digit mobile' : 'Alternate 10-digit number'}
                    className={`${fieldInput} flex-1`}
                  />
                  <select
                    value={c.label}
                    onChange={(e) => updateContact(idx, 'label', e.target.value)}
                    className="w-28 flex-shrink-0 px-2 py-2.5 rounded-xl text-xs outline-none bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60 transition"
                  >
                    {CONTACT_LABELS.map((l) => (
                      <option key={l} value={l} className="bg-[#111]">{l}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => removeContact(idx)} className="w-9 h-9 flex-shrink-0 rounded-lg flex items-center justify-center bg-red-500/10 border border-red-500/25 text-red-400 hover:bg-red-500/20 transition">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-white/35 mt-1.5">First number is the primary line used for linking and quick reorders.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel}>Supplier Type</label>
              <select value={form.type} onChange={set('type')} className={fieldInput}>{SUPPLIER_TYPES.map((t) => <option key={t} style={{ background: '#141414' }}>{t}</option>)}</select>
            </div>
            <div>
              <label className={fieldLabel}>Contact Person</label>
              <input value={form.contactPerson} onChange={set('contactPerson')} placeholder="e.g. Mahesh Reddy" className={fieldInput} />
            </div>
            <div>
              <label className={fieldLabel}>Email <span className="text-white/30 normal-case">(optional)</span></label>
              <input value={form.email} onChange={set('email')} placeholder="sales@supplier.com" className={fieldInput} />
            </div>
            <div>
              <label className={fieldLabel}>WhatsApp <span className="text-white/30 normal-case">(optional)</span></label>
              <input value={form.whatsapp} onChange={(e) => setForm((f) => ({ ...f, whatsapp: phoneInput(e.target.value) }))} placeholder="10-digit" className={fieldInput} />
            </div>
          </div>

          <div className="rounded-xl p-3 space-y-3" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
            <p className="text-[11px] font-bold uppercase tracking-wide text-[#d4af37]">Tax & Business <span className="text-white/30 normal-case font-normal">— GST optional (leave blank for non-GST suppliers)</span></p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel}>GST Number <span className="text-white/30 normal-case">(optional)</span></label>
                <input value={form.gst} onChange={(e) => setForm((f) => ({ ...f, gst: e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 15) }))} placeholder="36AAACM1234C1Z5" className={fieldInput} />
                {form.gst && GST_STATE_CODES[form.gst.slice(0, 2)] && <p className="text-[10px] text-emerald-400 mt-1">State auto-detected: {GST_STATE_CODES[form.gst.slice(0, 2)]}</p>}
              </div>
              <div>
                <label className={fieldLabel}>PAN <span className="text-white/30 normal-case">(optional)</span></label>
                <input value={form.pan} onChange={(e) => setForm((f) => ({ ...f, pan: e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 10) }))} placeholder="AAACM1234C" className={fieldInput} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className={fieldLabel}>Address</label>
              <input value={form.address} onChange={set('address')} placeholder="Shop / street / landmark" className={fieldInput} />
            </div>
            <div><label className={fieldLabel}>Area</label><input value={form.area} onChange={set('area')} className={fieldInput} /></div>
            <div><label className={fieldLabel}>City</label><input value={form.city} onChange={set('city')} className={fieldInput} /></div>
            <div><label className={fieldLabel}>District</label><input value={form.district} onChange={set('district')} className={fieldInput} /></div>
            <div><label className={fieldLabel}>State</label><input value={form.state} onChange={set('state')} placeholder="Auto-fills from GST" className={fieldInput} /></div>
            <div><label className={fieldLabel}>PIN Code</label><input value={form.pincode} onChange={(e) => setForm((f) => ({ ...f, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) }))} className={fieldInput} /></div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={fieldLabel}>Payment Mode</label>
              <select value={form.paymentMode} onChange={set('paymentMode')} className={fieldInput}>{PAYMENT_MODES.map((m) => <option key={m} style={{ background: '#141414' }}>{m}</option>)}</select>
            </div>
            <div><label className={fieldLabel}>Credit Days</label><input value={form.creditDays} inputMode="numeric" onChange={(e) => setForm((f) => ({ ...f, creditDays: e.target.value.replace(/\D/g, '').slice(0, 3) }))} placeholder="0" className={fieldInput} /></div>
            <div><label className={fieldLabel}>Opening Balance ₹</label><input value={form.openingBalance} inputMode="numeric" onChange={(e) => setForm((f) => ({ ...f, openingBalance: e.target.value.replace(/[^\d.]/g, '') }))} placeholder="0" className={fieldInput} /></div>
          </div>

          <details className="rounded-xl px-3 py-2" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
            <summary className="text-[11px] font-bold uppercase tracking-wide text-white/50 cursor-pointer">Bank Details (optional)</summary>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <div><label className={fieldLabel}>Account Holder</label><input value={form.accountHolder} onChange={set('accountHolder')} className={fieldInput} /></div>
              <div><label className={fieldLabel}>Bank Name</label><input value={form.bankName} onChange={set('bankName')} className={fieldInput} /></div>
              <div><label className={fieldLabel}>Account Number</label><input value={form.accountNumber} onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value.replace(/\D/g, '').slice(0, 18) }))} className={fieldInput} /></div>
              <div><label className={fieldLabel}>IFSC</label><input value={form.ifsc} onChange={(e) => setForm((f) => ({ ...f, ifsc: e.target.value.toUpperCase().slice(0, 11) }))} className={fieldInput} /></div>
              <div className="sm:col-span-2"><label className={fieldLabel}>UPI ID</label><input value={form.upi} onChange={set('upi')} placeholder="supplier@upi" className={fieldInput} /></div>
            </div>
          </details>

          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2.5"><Toggle on={!!form.preferred} onChange={(v) => setForm((f) => ({ ...f, preferred: v }))} aria-label="Preferred Supplier" /><span className="text-xs text-white/70">Preferred Supplier</span></div>
            <label className="flex items-center gap-2 text-xs text-white/70">Status:
              <select value={form.status} onChange={set('status')} className="px-2 py-1 rounded-lg text-xs bg-white/5 border border-white/10 text-white outline-none">{['Active', 'Inactive', 'Blocked'].map((s) => <option key={s} style={{ background: '#141414' }}>{s}</option>)}</select>
            </label>
          </div>

          <div>
            <label className={fieldLabel}>Notes</label>
            <textarea
              value={form.notes}
              onChange={set('notes')}
              rows={2}
              placeholder="Delivery time, special terms…"
              className={`${fieldInput} resize-none`}
            />
          </div>

          <div
            className="flex gap-3 pt-3 pb-1 mt-2 sticky bottom-0 -mx-5 px-5"
            style={{ background: 'var(--surface-1)', borderTop: '1px solid rgba(var(--fg-rgb),0.08)' }}
          >
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-3 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] hover:brightness-110 active:scale-[0.98] transition disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {saving && <Loader2 size={15} className="animate-spin" />}
              {isEdit ? 'Save Changes' : 'Add Supplier'}
            </button>
          </div>
        </form>
  );
  const title = isEdit ? 'Edit Supplier' : 'Add New Supplier';
  if (asPage) return <MobileFormPage title={title} onClose={onClose}>{formEl}</MobileFormPage>;
  return (
    <Modal onClose={onClose} title={title} bodyClassName="">
      {formEl}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Suppliers tab view — contact directory
// ---------------------------------------------------------------------------
function SuppliersView({ suppliers, inventory, loading, onEdit, onDelete, onArchive, onRestore, onJumpToPart, isAdmin }) {
  // FEATURE 3: per-supplier part selection for bulk POs, keyed "supplierId:partId"
  const [selected, setSelected] = useState({});
  const [manageSupplierId, setManageSupplierId] = useState(null); // progressive disclosure: only this supplier is in "manage parts" mode
  const enterManage = (sid) => { setManageSupplierId(sid); setSelected((prev) => { const n = { ...prev }; Object.keys(n).forEach((k) => { if (k.startsWith(`${sid}:`)) delete n[k]; }); return n; }); };
  const exitManage = (sid) => { setManageSupplierId(null); setSelected((prev) => { const n = { ...prev }; Object.keys(n).forEach((k) => { if (k.startsWith(`${sid}:`)) delete n[k]; }); return n; }); };
  const [expandedParts, setExpandedParts] = useState({}); // supplierId -> show all parts
  const togglePartsExpand = (sid) => setExpandedParts((p) => ({ ...p, [sid]: !p[sid] }));
  const toggleSelect = (sid, pid) =>
    setSelected((prev) => {
      const key = `${sid}:${pid}`;
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
  const isSelected = (sid, pid) => !!selected[`${sid}:${pid}`];

  function sendBulkPO(supplier, parts) {
    const chosen = parts.filter((p) => isSelected(supplier.id, p.id));
    if (chosen.length === 0) return;
    const number = getSupplierPrimaryPhone(supplier);
    if (!number) {
      toast.error(`${supplier.name} has no phone number on file.`);
      return;
    }
    // #4: one item → single-part PO template; many → bulk template.
    const message =
      chosen.length === 1
        ? buildPurchaseOrder(chosen[0], supplier.name)
        : buildBulkPO(supplier.name, chosen);
    const text = encodeURIComponent(message);
    window.open(`https://wa.me/${waNumber(number)}?text=${text}`, '_blank', 'noopener,noreferrer');
    // Clear this supplier's selection after sending.
    setSelected((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((k) => k.startsWith(`${supplier.id}:`) && delete next[k]);
      return next;
    });
  }

  // FIX 4: compute each supplier's supplied parts ON-THE-FLY (no cached array).
  // Match the supplier's primary phone against the part's stored supplier phone
  // using the normalized (last-10-digit) key, with name + linked-id fallbacks.
  // UPDATE-02: index parts by supplier id / phone / name in ONE pass, instead of
  // filtering the whole inventory for every supplier row on every render.
  const partsBySupplier = useMemo(() => {
    const byId = new Map();
    const byPhone = new Map();
    const byName = new Map();
    const push = (map, key, p) => { if (!key) return; const a = map.get(key); a ? a.push(p) : map.set(key, [p]); };
    inventory.forEach((p) => {
      getPartSuppliers(p).forEach((ps) => {
        push(byId, ps.id, p);
        push(byPhone, normalizePhone(ps.phone), p);
        push(byName, safeLower(ps.name), p);
      });
    });
    return { byId, byPhone, byName };
  }, [inventory]);

  const suppliedPartsFor = useCallback(
    (supplier) => {
      const seen = new Set();
      const out = [];
      const add = (arr) => arr && arr.forEach((p) => { if (!seen.has(p.id)) { seen.add(p.id); out.push(p); } });
      add(partsBySupplier.byId.get(supplier.id));
      const primary = getSupplierPrimaryPhone(supplier);
      if (primary) add(partsBySupplier.byPhone.get(primary));
      getSupplierNames(supplier).forEach((n) => add(partsBySupplier.byName.get(safeLower(n))));
      return out;
    },
    [partsBySupplier]
  );

  const [supSearch, setSupSearch] = useState('');
  const [showArchivedSup, setShowArchivedSup] = useState(false);
  // Split the directory into live vs archived. Archive hides a supplier from the
  // working list without unlinking any parts (that distinguishes it from delete).
  const activeSuppliers = useMemo(() => suppliers.filter((s) => !s.archived), [suppliers]);
  const archivedSuppliers = useMemo(() => suppliers.filter((s) => s.archived), [suppliers]);
  const baseSuppliers = showArchivedSup ? archivedSuppliers : activeSuppliers;
  const filteredSuppliers = useMemo(() => {
    const q = safeLower(supSearch.trim());
    if (!q) return baseSuppliers;
    return baseSuppliers.filter((s) => {
      const names = [s.name, ...(Array.isArray(s.altNames) ? s.altNames : [])].map(safeLower).join(' ');
      const phones = getSupplierContacts(s).map((c) => String(c.number || '')).join(' ');
      return names.includes(q) || phones.includes(q);
    });
  }, [baseSuppliers, supSearch]);
  const supPager = useViewMore(filteredSuppliers, 25, supSearch + (showArchivedSup ? ':arch' : ''));

  if (loading) {
    return (
      <div className="rounded-2xl overflow-hidden backdrop-blur-sm" style={{ background: 'rgba(var(--fg-rgb),0.02)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
        <div className="p-4 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl p-3 animate-pulse" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.05)' }}>
              <div className="w-9 h-9 rounded-full bg-white/10 flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 rounded bg-white/10" style={{ width: `${28 + (i % 3) * 12}%` }} />
                <div className="h-2.5 rounded bg-white/5 w-1/3" />
              </div>
              <div className="h-7 w-24 rounded-lg bg-white/5 hidden sm:block" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (suppliers.length === 0) {
    return (
      <div className="rounded-2xl p-12 flex flex-col items-center gap-3 text-center" style={{ background: 'rgba(var(--fg-rgb),0.02)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
        <Users size={32} className="text-white/20" />
        <p className="text-sm text-white/40">No suppliers yet. Click "Add Supplier" to build your contact directory.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl overflow-hidden backdrop-blur-sm" style={{ background: 'rgba(var(--fg-rgb),0.02)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
      <div className="p-3 sm:p-4 flex flex-col gap-3" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
          <input
            value={supSearch}
            onChange={(e) => setSupSearch(e.target.value)}
            placeholder="Search suppliers by name, alias, or phone…"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm outline-none bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-[#d4af37]/60 transition"
          />
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[11px] text-white/35">
            {supSearch
              ? `${filteredSuppliers.length} of ${baseSuppliers.length} ${showArchivedSup ? 'archived ' : ''}supplier${baseSuppliers.length === 1 ? '' : 's'} match.`
              : showArchivedSup
                ? `${archivedSuppliers.length} archived supplier${archivedSuppliers.length === 1 ? '' : 's'}`
                : `${activeSuppliers.length} active supplier${activeSuppliers.length === 1 ? '' : 's'}`}
          </p>
          {isAdmin && (archivedSuppliers.length > 0 || showArchivedSup) && (
            <button
              onClick={() => setShowArchivedSup((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition border ${
                showArchivedSup
                  ? 'bg-[#d4af37]/20 text-[#d4af37] border-[#d4af37]/40'
                  : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10'
              }`}
              title="Show archived suppliers"
            >
              <Archive size={12} /> {showArchivedSup ? `Archived (${archivedSuppliers.length})` : `Show archived (${archivedSuppliers.length})`}
            </button>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>
              {['Supplier', 'Contacts', 'Parts Supplied', 'Notes', ''].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-white/30 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {supPager.visible.map((s) => {
              const contacts = getSupplierContacts(s);
              const altNames = (Array.isArray(s.altNames) ? s.altNames : []).filter(Boolean);
              const parts = suppliedPartsFor(s); // FIX 4: live computation
              return (
                <tr key={s.id} className="transition hover:bg-white/[0.03] align-top" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.04)' }}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-black flex-shrink-0 bg-gradient-to-br from-[#e8c84a] to-[#aa801e]">
                        {s.name ? s.name[0].toUpperCase() : '?'}
                      </div>
                      <div>
                        <div className="font-medium text-white whitespace-nowrap">
                          {s.name}
                          {parts.length > 0 && (() => {
                            const uniq = new Set(parts.map((p) => baseName(p.name))).size;
                            const archived = parts.filter((p) => p.archived).length;
                            const recordsLabel = uniq < parts.length ? `${uniq} unique · ${parts.length} records` : `${parts.length} part${parts.length > 1 ? 's' : ''}`;
                            return (
                              <span className="ml-2 text-[10px] font-semibold text-[#d4af37]/80" title={`${uniq} unique product(s) · ${parts.length} inventory record(s)${archived ? ` · ${archived} archived` : ''}`}>
                                {recordsLabel}{archived ? ` · ${archived} archived` : ''}
                              </span>
                            );
                          })()}
                        </div>
                        {altNames.length > 0 && (
                          <div className="text-[10px] text-white/35">aka {altNames.join(', ')}</div>
                        )}
                        {showArchivedSup && s.archived && (
                          <div className="text-[10px] text-white/35 mt-1 flex items-center gap-1">
                            <Archive size={9} /> Archived{s.archivedAt ? ` ${new Date((s.archivedAt.seconds || 0) * 1000).toLocaleDateString('en-IN')}` : ''}{s.archivedBy ? ` · by ${String(s.archivedBy).split('@')[0]}` : ''}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {contacts.length ? (
                      <div className="flex flex-col gap-1">
                        {contacts.map((c, i) => (
                          <div key={`${c.number}-${i}`} className="flex items-center gap-1.5">
                            <span className="text-[9px] uppercase tracking-wide text-[#d4af37]/60 w-16 flex-shrink-0">{c.label || 'Phone'}</span>
                            <a href={`tel:${c.number}`} className="text-white/60 hover:text-white/90 flex items-center gap-1">
                              <Phone size={12} /> {c.number}
                            </a>
                            <a
                              href={`https://wa.me/${waNumber(c.number)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center justify-center w-6 h-6 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition"
                              title="WhatsApp supplier"
                            >
                              <MessageCircle size={11} />
                            </a>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-white/30">—</span>
                    )}
                  </td>
                  {/* FIX 4 tags + FEATURE 3 bulk-PO selection */}
                  <td className="px-4 py-3 max-w-[300px]">
                    {parts.length ? (
                      <div className="space-y-2">
                        {(() => {
                          const cats = Array.from(new Set(parts.map((p) => p.category).filter(Boolean)));
                          const purchaseValue = parts.reduce((sum, p) => sum + (Number(p.purchasePrice) || 0) * (Number(p.stock) || 0), 0);
                          return (
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px]">
                              {cats.length > 0 && (
                                <span className="flex flex-wrap items-center gap-1">
                                  {cats.slice(0, 3).map((c) => (
                                    <span key={c} className="px-2 py-0.5 rounded-md text-[10px] font-semibold" style={{ background: 'rgba(212,175,55,0.1)', color: '#d4af37', border: '1px solid rgba(212,175,55,0.2)' }}>{c}</span>
                                  ))}
                                  {cats.length > 3 && <span className="text-white/45 font-semibold">+{cats.length - 3}</span>}
                                </span>
                              )}
                              <span className="text-white/45">Stock value: <span className="text-[#d4af37]/90 font-semibold">₹{purchaseValue.toLocaleString('en-IN')}</span></span>
                            </div>
                          );
                        })()}
                        <div className="flex flex-wrap gap-1.5">
                          {(() => {
                            const grouped = Object.values(parts.reduce((acc, p) => {
                              const key = baseName(p.name);
                              (acc[key] = acc[key] || { base: stripCopySuffix(p.name) || p.name, items: [] }).items.push(p);
                              return acc;
                            }, {}));
                            const isOpen = !!expandedParts[s.id];
                            // 0–2 distinct parts: always show. 3+: collapse behind an "All" toggle
                            // with category chips as the preview, expandable smoothly.
                            const collapsible = grouped.length >= 3;
                            const managing = manageSupplierId === s.id;
                            if (collapsible && !isOpen) {
                              const cats = Array.from(new Set(parts.map((p) => p.category).filter(Boolean)));
                              return (
                                <>
                                  <button
                                    onClick={() => togglePartsExpand(s.id)}
                                    className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-[#d4af37]/20 text-[#d4af37] border border-[#d4af37]/40 hover:bg-[#d4af37]/30 transition"
                                  >
                                    All {grouped.length} <ChevronDown size={11} />
                                  </button>
                                  {cats.map((c) => (
                                    <span key={c} className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-white/5 text-white/55 border border-white/10">{c}</span>
                                  ))}
                                </>
                              );
                            }
                            return (
                              <div className="w-full space-y-2.5">
                                <div className="flex items-center justify-between gap-3 pb-2 border-b border-white/10">
                                  {collapsible ? (
                                    <button
                                      onClick={() => togglePartsExpand(s.id)}
                                      className="flex items-center gap-1 text-[11px] font-semibold text-white/55 hover:text-white/90 transition"
                                    >
                                      <ChevronUp size={12} /> Collapse
                                    </button>
                                  ) : (
                                    <span className="text-[11px] font-semibold text-white/45">Parts supplied ({grouped.length})</span>
                                  )}
                                  {isAdmin && parts.length >= 1 && (
                                    managing ? (
                                      <div className="flex items-center gap-2">
                                        {(() => {
                                          const ids = parts.map((p) => p.id);
                                          const allSel = ids.length > 0 && ids.every((pid) => isSelected(s.id, pid));
                                          const someSel = ids.some((pid) => isSelected(s.id, pid));
                                          return (
                                            <button
                                              onClick={() => setSelected((prev) => { const next = { ...prev }; if (allSel) ids.forEach((pid) => delete next[`${s.id}:${pid}`]); else ids.forEach((pid) => { next[`${s.id}:${pid}`] = true; }); return next; })}
                                              className="flex items-center gap-1.5 text-[11px] font-bold text-white/80 hover:text-white transition"
                                            >
                                              <span className={`w-4 h-4 rounded flex items-center justify-center border transition ${allSel ? 'bg-emerald-500 border-emerald-500' : someSel ? 'bg-emerald-500/40 border-emerald-500' : 'border-white/30'}`}>{allSel && <Check size={11} className="text-black" />}{!allSel && someSel && <span className="w-2 h-0.5 bg-emerald-300 rounded" />}</span>
                                              {allSel ? 'Clear' : 'Select all'} <span className="text-white/40">({ids.length})</span>
                                            </button>
                                          );
                                        })()}
                                        <button onClick={() => exitManage(s.id)} className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-white/10 text-white/85 hover:bg-white/15 transition">Done</button>
                                      </div>
                                    ) : (
                                      <button onClick={() => enterManage(s.id)} className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 active:scale-95 transition">
                                        <Settings size={12} /> Manage parts
                                      </button>
                                    )
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                {grouped.map((grp) => {
                                  const ids = grp.items.map((it) => it.id);
                                  const sel = ids.every((pid) => isSelected(s.id, pid));
                                  const count = grp.items.length;
                                  return (
                                    <span
                                      key={grp.base}
                                      className={`flex items-center gap-1 pl-1.5 pr-2 py-0.5 rounded-md text-[11px] font-semibold border transition ${
                                        managing && sel ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 ring-1 ring-emerald-500/40' : 'bg-[#d4af37]/12 text-[#d4af37] border-[#d4af37]/30'
                                      }`}
                                      title={count > 1 ? `${count} inventory records (original + copy)` : undefined}
                                    >
                                      {managing && (
                                        <input
                                          type="checkbox"
                                          checked={sel}
                                          onChange={() => ids.forEach((pid) => { if (isSelected(s.id, pid) === sel) toggleSelect(s.id, pid); })}
                                          className="w-3 h-3 accent-emerald-500 cursor-pointer"
                                          title="Select for bulk PO"
                                        />
                                      )}
                                      <button onClick={() => (managing ? ids.forEach((pid) => { if (isSelected(s.id, pid) === sel) toggleSelect(s.id, pid); }) : onJumpToPart(grp.items[0]?.id, grp.base))} className="hover:underline" title={managing ? 'Toggle selection' : `Find ${grp.base} in inventory`}>
                                        {grp.base}{count > 1 ? ` ×${count}` : ''}
                                      </button>
                                    </span>
                                  );
                                })}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                        {(() => {
                          if (manageSupplierId !== s.id) return null;
                          const n = parts.filter((p) => isSelected(s.id, p.id)).length;
                          if (n === 0) return null;
                          return (
                            <button
                              onClick={() => sendBulkPO(s, parts)}
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold transition active:scale-95 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25"
                            >
                              <Send size={11} /> {n === 1 ? 'Generate PO' : `Generate Bulk PO (${n} items)`}
                            </button>
                          );
                        })()}
                      </div>
                    ) : (
                      <span className="text-white/30">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-white/40 max-w-[200px] truncate" title={s.notes || ''}>
                    {s.notes || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => onEdit(s)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#d4af37]/10 border border-[#d4af37]/25 text-[#d4af37] hover:bg-[#d4af37]/20 transition"
                      >
                        <Edit3 size={13} />
                      </button>
                      {isAdmin && !s.archived && onArchive && (
                        <button
                          onClick={() => onArchive(s.id)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 transition"
                          title="Archive (hide, restorable)"
                        >
                          <Archive size={13} />
                        </button>
                      )}
                      {isAdmin && s.archived && onRestore && (
                        <button
                          onClick={() => onRestore(s.id)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20 transition"
                          title="Restore from archive"
                        >
                          <ArchiveRestore size={13} />
                        </button>
                      )}
                      {isAdmin && onDelete && (
                        <button
                          onClick={() => onDelete(s.id)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center bg-red-500/10 border border-red-500/25 text-red-400 hover:bg-red-500/20 transition"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredSuppliers.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-white/35">
                {supSearch
                  ? `No ${showArchivedSup ? 'archived ' : ''}suppliers match “${supSearch}”.`
                  : showArchivedSup ? 'No archived suppliers.' : 'No active suppliers.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      {supPager.hasMore && (
        <div className="p-3 flex justify-center" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.06)' }}>
          <button onClick={supPager.showMore} className="px-4 py-2 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 transition">
            Show more ({supPager.shown} of {supPager.total})
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FEATURE 2: Executive Analytics dashboard
// ---------------------------------------------------------------------------
// Progressive "View More" pager (no artificial Top-N cap).
// UPDATE-09: resets only when `resetKey` (the search/filter) changes — not when
// the list length changes — so paging position survives data re-renders.
function useViewMore(list, step = 10, resetKey = '') {
  const [count, setCount] = useState(step);
  useEffect(() => { setCount(step); }, [resetKey, step]);
  return {
    visible: list.slice(0, count),
    hasMore: count < list.length,
    showMore: () => setCount((c) => c + step),
    shown: Math.min(count, list.length),
    total: list.length,
  };
}

function ACard({ title, icon: Icon, right, children }) {
  return (
    <div className="rounded-2xl p-4 sm:p-5 backdrop-blur-sm" style={{ background: 'rgba(var(--fg-rgb),0.02)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">{Icon && <Icon size={15} className="text-[#d4af37]" />}{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

const ASearch = ({ value, onChange, placeholder }) => (
  <div className="relative">
    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" />
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder || 'Search…'} className="w-40 sm:w-52 pl-7 pr-2 py-1.5 rounded-lg text-xs outline-none bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-[#d4af37]/60" />
  </div>
);

const ViewMoreBar = ({ pager, label }) =>
  pager.total === 0 ? null : (
    <div className="flex items-center justify-between mt-3 text-[11px] text-white/40">
      <span>Showing {pager.shown} of {pager.total} {label}</span>
      {pager.hasMore && (
        <button onClick={pager.showMore} className="px-3 py-1 rounded-lg font-semibold text-[#d4af37] bg-[#d4af37]/10 border border-[#d4af37]/30 hover:bg-[#d4af37]/20 transition">View More</button>
      )}
    </div>
  );

const SEVERITY = {
  '0–30 Days': { dot: '#34d399', label: 'Healthy' },
  '31–60 Days': { dot: '#fbbf24', label: 'Attention' },
  '61–90 Days': { dot: '#f59e0b', label: 'Aging' },
  '91–180 Days': { dot: '#fb923c', label: 'Aging' },
  '180+ Days': { dot: '#f87171', label: 'Critical' },
};
const AGING_BUCKETS = [
  { key: '0–30 Days', min: 0, max: 30 },
  { key: '31–60 Days', min: 31, max: 60 },
  { key: '61–90 Days', min: 61, max: 90 },
  { key: '91–180 Days', min: 91, max: 180 },
  { key: '180+ Days', min: 181, max: Infinity },
];

const brandsOf = (p) => {
  if (Array.isArray(p.compatibleCars) && typeof p.compatibleCars[0] === 'object') {
    return p.compatibleCars.map((g) => g.brand).filter(Boolean);
  }
  return p.vehicle ? [p.vehicle] : [];
};

// Issue 10/13: a single audit entry — collapsed summary that expands to the
// full record (reason, qty, before→after, notes, user, timestamp).
function AuditRow({ e }) {
  const [open, setOpen] = useState(false);
  const labelMap = {
    delete_part: 'Deleted part', delete_supplier: 'Deleted supplier', price_change: 'Price change',
    below_floor_sale: 'Below-floor sale', stock_adjustment: 'Stock adjustment',
    archive_part: 'Archived part', restore_part: 'Restored part',
  };
  const label = labelMap[e.action] || e.action;
  const color = e.action === 'price_change' ? '#d4af37'
    : e.action === 'below_floor_sale' ? '#fb923c'
    : e.action === 'stock_adjustment' ? '#f59e0b'
    : e.action === 'archive_part' || e.action === 'restore_part' ? '#9ca3af'
    : '#f87171';
  const d = tsToDate(e.createdAt);
  const det = e.details || {};
  const summary = e.action === 'price_change'
    ? Object.entries(det).map(([f, v]) => `${f}: ${formatINR(v.from)}→${formatINR(v.to)}`).join(', ')
    : e.action === 'below_floor_sale'
    ? `floor ${formatINR(det.floor)} → ${formatINR(det.actual)}${det.qty ? ` ×${det.qty}` : ''}`
    : e.action === 'stock_adjustment'
    ? (() => {
        const d = (det.stockAfter != null && det.stockBefore != null) ? (det.stockAfter - det.stockBefore) : (det.qty || 0);
        return `${det.reason || ''} ${d < 0 ? '−' : '+'}${Math.abs(d)}${det.stockBefore != null ? ` (${det.stockBefore}→${det.stockAfter})` : ''}`;
      })()
    : e.action === 'delete_supplier' && det.unlinkedParts != null
    ? `unlinked ${det.unlinkedParts} part(s)` : '';
  const rows = [];
  if (e.action === 'stock_adjustment') {
    const d = (det.stockAfter != null && det.stockBefore != null) ? (det.stockAfter - det.stockBefore) : (det.qty || 0);
    rows.push(['Reason', det.reason || '—'], ['Quantity', `${d < 0 ? '−' : '+'}${Math.abs(d)}`], ['Stock', det.stockBefore != null ? `${det.stockBefore} → ${det.stockAfter}` : '—'], ['Notes', det.notes || '—']);
  } else if (e.action === 'below_floor_sale') {
    rows.push(['Floor price', formatINR(det.floor)], ['Actual price', formatINR(det.actual)], ['Quantity', det.qty ?? '—'], ['Override', 'Yes']);
  } else if (e.action === 'price_change') {
    Object.entries(det).forEach(([f, v]) => rows.push([f, `${formatINR(v.from)} → ${formatINR(v.to)}`]));
  }
  rows.push(['User', e.performedByEmail || 'unknown'], ['When', d ? d.toLocaleString('en-IN') : '—']);

  return (
    <div className="rounded-lg" style={{ background: 'rgba(var(--fg-rgb),0.02)', border: '1px solid rgba(var(--fg-rgb),0.05)' }}>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-start gap-2 text-xs px-2.5 py-2 text-left">
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0" style={{ background: `${color}22`, color }}>{label}</span>
        <div className="min-w-0 flex-1">
          <div className="text-white truncate">{e.name || e.partId || e.supplierId || '—'}{summary && <span className="text-white/40"> · {summary}</span>}</div>
          <div className="text-white/35 text-[10px]">{e.performedByEmail || 'unknown'}{d ? ` · ${d.toLocaleString('en-IN')}` : ''}</div>
        </div>
        <span className={`text-white/30 transition-transform flex-shrink-0 ${open ? 'rotate-90' : ''}`}>▶</span>
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 pt-0.5 border-t border-white/5">
          <table className="w-full text-[11px]">
            <tbody>
              {rows.map(([k, v], i) => (
                <tr key={i}>
                  <td className="py-0.5 pr-3 text-white/40 align-top whitespace-nowrap">{k}</td>
                  <td className="py-0.5 text-white/80 break-words">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Issues 6/7/8: audit log with search, filter, and Load-More pagination so the
// panel stays fast as entries grow. (The live subscription caps the loaded set;
// true 10k-scale needs server-side cursors — noted in the report.)
const AUDIT_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'stock_adjustment', label: 'Stock Adjustments' },
  { key: 'Damage', label: 'Damage' },
  { key: 'Lost Item', label: 'Lost Items' },
  { key: 'Personal Use', label: 'Personal Use' },
  { key: 'Correction', label: 'Corrections' },
  { key: 'price_change', label: 'Price Changes' },
  { key: 'below_floor_sale', label: 'Below-floor Sales' },
  { key: 'delete_supplier', label: 'Supplier Changes' },
  { key: 'archive_part', label: 'Archives' },
  { key: 'restore_part', label: 'Restores' },
  { key: 'delete_part', label: 'Deletions' },
];
function AuditLogPanel({ auditLog }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const PER = 25;

  const filtered = useMemo(() => {
    const needle = safeLower(q.trim());
    return auditLog.filter((e) => {
      // filter by action, or by adjustment reason for the reason-level filters.
      if (filter !== 'all') {
        const reasonFilters = ['Damage', 'Lost Item', 'Personal Use', 'Correction'];
        if (reasonFilters.includes(filter)) {
          if (e.action !== 'stock_adjustment' || (e.details?.reason || '') !== filter) return false;
        } else if (e.action !== filter) return false;
      }
      if (!needle) return true;
      const hay = [e.name, e.performedByEmail, e.action, e.details?.reason, e.partId, e.supplierId]
        .map(safeLower).join(' ');
      return hay.includes(needle);
    });
  }, [auditLog, q, filter]);

  const shown = filtered.slice(0, page * PER);
  useEffect(() => { setPage(1); }, [q, filter]);

  const fld = 'px-3 py-2 rounded-lg text-xs outline-none bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60';
  return (
    <ACard title="Audit Log" icon={ShieldCheck}>
      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search part, user, action…" className={`${fld} flex-1`} />
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className={fld}>
          {AUDIT_FILTERS.map((f) => <option key={f.key} value={f.key} className="bg-[#111]">{f.label}</option>)}
        </select>
      </div>
      {filtered.length === 0 ? (
        <p className="text-xs text-white/35">{auditLog.length === 0 ? 'No audited actions yet. Deletes, price changes, below-floor sales, archives, restores, and stock adjustments are recorded here.' : 'No entries match your search / filter.'}</p>
      ) : (
        <>
          <p className="text-[11px] text-white/35 mb-2">Showing {shown.length} of {filtered.length}</p>
          <div className="space-y-1.5">
            {shown.map((e) => <AuditRow key={e.id} e={e} />)}
          </div>
          {shown.length < filtered.length && (
            <button onClick={() => setPage((p) => p + 1)} className="w-full mt-3 py-2 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-white/70 hover:bg-white/10">
              Load more ({filtered.length - shown.length} remaining)
            </button>
          )}
        </>
      )}
    </ACard>
  );
}

function AnalyticsView({ inventory, sales = [], rollups = [], restocks = [], auditLog = [], stockAdjustments = [], onEditPart }) {
  // ---- Global filters (apply to all part-based sections) ----
  const [fCategory, setFCategory] = useState('All');
  const [fBrand, setFBrand] = useState('All');
  const [range, setRange] = useState('6m'); // trend date range

  const categoryOpts = useMemo(() => ['All', ...new Set(inventory.flatMap((p) => [p.category, ...asList(p.categories)]).filter(Boolean))], [inventory]);
  const brandOpts = useMemo(() => ['All', ...new Set(inventory.flatMap((p) => brandsOf(p)).filter(Boolean))], [inventory]);

  const parts = useMemo(
    () =>
      inventory.filter(
        (p) =>
          (fCategory === 'All' || p.category === fCategory || asList(p.categories).includes(fCategory)) &&
          (fBrand === 'All' || brandsOf(p).includes(fBrand))
      ),
    [inventory, fCategory, fBrand]
  );

  // ---- KPI + capital health ----
  const kpi = useMemo(() => {
    const totalLocked = parts.reduce((s, p) => s + lockedCapital(p), 0);
    const totalProfit = parts.reduce((s, p) => s + expectedProfit(p), 0);
    const deadCapital = parts.filter((p) => (p.salesCount || 0) === 0).reduce((s, p) => s + lockedCapital(p), 0);
    const healthyCapital = Math.max(0, totalLocked - deadCapital);
    const deadPct = totalLocked > 0 ? Math.round((deadCapital / totalLocked) * 100) : 0;
    return { totalLocked, totalProfit, deadCapital, healthyCapital, deadPct };
  }, [parts]);

  // ---- 1. Monthly Profit Trend ----
  // FIX-07: prefer the unbounded monthly rollups; fall back to aggregating the
  // (capped) recent ledger only if no rollups exist yet.
  const trend = useMemo(() => {
    const monthsBack = { '30d': 1, '3m': 3, '6m': 6, '12m': 12 }[range]; // undefined = all
    let series;
    if (rollups.length) {
      series = rollups
        .map((r) => ({ key: r.month, revenue: r.revenue || 0, cost: r.cost || 0, profit: r.profit ?? (r.revenue || 0) - (r.cost || 0) }))
        .filter((m) => m.key)
        .sort((a, b) => a.key.localeCompare(b.key));
      if (monthsBack) series = series.slice(-monthsBack);
    } else {
      const days = { '30d': 30, '3m': 90, '6m': 180, '12m': 365 }[range];
      const cutoff = days ? Date.now() - days * 86400000 : 0;
      const months = new Map();
      sales.forEach((s) => {
        const d = tsToDate(s.createdAt);
        if (!d || d.getTime() < cutoff) return;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const e = months.get(key) || { key, revenue: 0, cost: 0, profit: 0 };
        e.revenue += s.revenue || 0;
        e.cost += s.cost || 0;
        e.profit += s.profit ?? (s.revenue || 0) - (s.cost || 0);
        months.set(key, e);
      });
      series = [...months.values()].sort((a, b) => a.key.localeCompare(b.key));
    }
    const totRev = series.reduce((s, m) => s + m.revenue, 0);
    const totCost = series.reduce((s, m) => s + m.cost, 0);
    const totProfit = totRev - totCost;
    const margin = totRev > 0 ? (totProfit / totRev) * 100 : 0;
    const best = series.reduce((b, m) => (!b || m.profit > b.profit ? m : b), null);
    const worst = series.reduce((b, m) => (!b || m.profit < b.profit ? m : b), null);
    const bestRev = series.reduce((b, m) => (!b || m.revenue > b.revenue ? m : b), null);
    const avg = series.length ? totProfit / series.length : 0;
    const last = series[series.length - 1];
    const prev = series[series.length - 2];
    const growth = last && prev && prev.profit !== 0 ? ((last.profit - prev.profit) / Math.abs(prev.profit)) * 100 : null;
    return { series, totRev, totCost, totProfit, margin, best, worst, bestRev, avg, growth };
  }, [sales, rollups, range]);

  // FIX-04: single source of truth for money figures — aggregate the sales LEDGER
  // per part (revenue/cost/profit snapshotted at the actual sale price), instead
  // of salesCount × current price. Keeps Top Parts / Fast Movers / Vehicle
  // Analytics consistent with the Monthly Profit Trend.
  const ledgerByPart = useMemo(() => {
    const m = new Map();
    sales.forEach((s) => {
      const e = m.get(s.partId) || { units: 0, revenue: 0, cost: 0, profit: 0 };
      e.units += s.qty || 0;
      e.revenue += s.revenue || 0;
      e.cost += s.cost || 0;
      e.profit += s.profit ?? (s.revenue || 0) - (s.cost || 0);
      m.set(s.partId, e);
    });
    return m;
  }, [sales]);
  const L = (p) => ledgerByPart.get(p.id) || { units: 0, revenue: 0, cost: 0, profit: 0 };
  const pUnits = (p) => L(p).units;
  const pRev = (p) => L(p).revenue;
  const pProfit = (p) => L(p).profit;
  const pMargin = (p) => { const r = L(p).revenue; return r > 0 ? (L(p).profit / r) * 100 : 0; };

  // ---- 2. Top Profitable Parts ----
  const [ppSearch, setPpSearch] = useState('');
  const [ppSort, setPpSort] = useState('profit');
  const profitable = useMemo(() => {
    const q = safeLower(ppSearch);
    return parts
      .filter((p) => pUnits(p) > 0 && (!q || safeLower(p.name).includes(q)))
      .sort((a, b) => (ppSort === 'margin' ? pMargin(b) - pMargin(a) : ppSort === 'revenue' ? pRev(b) - pRev(a) : pProfit(b) - pProfit(a)));
  }, [parts, ppSearch, ppSort, ledgerByPart]);
  const ppPager = useViewMore(profitable, 10, ppSearch + ppSort);

  // ---- 3. Vehicle Analytics ----
  const [vehMode, setVehMode] = useState('brand');
  const [vehSearch, setVehSearch] = useState('');
  const vehAgg = useMemo(() => {
    const brands = new Map();
    const models = new Map();
    parts.forEach((p) => {
      const units = pUnits(p);
      if (!units) return;
      const rev = pRev(p);
      const prof = pProfit(p);
      const grouped = Array.isArray(p.compatibleCars) && typeof p.compatibleCars[0] === 'object' ? p.compatibleCars : null;
      let bList = [];
      let mList = [];
      // Issue 5: a Universal part is bucketed once under "Universal" — never
      // duplicated across every brand (which would inflate vehicle analytics).
      if (partIsUniversal(p)) { bList = ['Universal']; mList = ['Universal']; }
      else if (grouped) grouped.forEach((g) => { if (g.brand) bList.push(g.brand); (g.models || []).forEach((m) => mList.push(m)); });
      else { mList = flattenVehicles(p.compatibleCars); if (p.vehicle) bList = [p.vehicle]; }
      if (!bList.length) bList = ['Unspecified'];
      if (!mList.length) mList = ['Unspecified'];
      bList.forEach((b) => { const e = brands.get(b) || { name: b, units: 0, rev: 0, prof: 0 }; e.units += units; e.rev += rev; e.prof += prof; brands.set(b, e); });
      mList.forEach((m) => { const e = models.get(m) || { name: m, units: 0, rev: 0, prof: 0 }; e.units += units; e.rev += rev; e.prof += prof; models.set(m, e); });
    });
    const toArr = (map) => {
      const arr = [...map.values()];
      const totRev = arr.reduce((s, x) => s + x.rev, 0) || 1;
      const totUnits = arr.reduce((s, x) => s + x.units, 0) || 1;
      arr.forEach((x) => { x.revPct = (x.rev / totRev) * 100; x.unitPct = (x.units / totUnits) * 100; });
      return arr.sort((a, b) => b.rev - a.rev);
    };
    return { brands: toArr(brands), models: toArr(models) };
  }, [parts, ledgerByPart]);
  const vehRows = useMemo(() => {
    const q = safeLower(vehSearch);
    return (vehMode === 'brand' ? vehAgg.brands : vehAgg.models).filter((r) => !q || safeLower(r.name).includes(q));
  }, [vehAgg, vehMode, vehSearch]);
  const vehPager = useViewMore(vehRows, 10, vehSearch + vehMode);

  // ADD-05: sales by staff (from the ledger's soldByEmail).
  // Revenue mix (Parts vs Labour vs Service vs Outside), top services, technician
  // productivity, most-profitable service/part — the "how does my garage earn?"
  // analytics (#9). All sourced from the sales ledger.
  const catOfSale = (s) => s.revenueType || s.category || (s.partId ? 'Parts' : 'Service');
  const revenueMix = useMemo(() => {
    const m = {};
    sales.forEach((s) => { const c = catOfSale(s); m[c] = (m[c] || 0) + (s.revenue || 0); });
    const total = Object.values(m).reduce((a, b) => a + b, 0) || 1;
    const order = ['Parts', 'Labour', 'Service', 'Outside Purchase', 'Miscellaneous'];
    return order.filter((c) => m[c]).map((c, i) => ({ label: c, value: m[c], pct: (m[c] / total) * 100, color: RPT_COLORS[i % RPT_COLORS.length] }));
  }, [sales]);
  const topServices = useMemo(() => {
    const m = new Map();
    sales.filter((s) => catOfSale(s) === 'Service' || catOfSale(s) === 'Labour').forEach((s) => {
      const e = m.get(s.name) || { name: s.name, revenue: 0, count: 0, profit: 0 };
      e.revenue += s.revenue || 0; e.profit += s.profit || 0; e.count += 1; m.set(s.name, e);
    });
    return [...m.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  }, [sales]);
  const techAgg = useMemo(() => {
    const m = new Map();
    sales.filter((s) => s.technician).forEach((s) => {
      const e = m.get(s.technician) || { name: s.technician, revenue: 0, jobs: 0, hours: 0 };
      e.revenue += s.revenue || 0; e.jobs += 1; e.hours += Number(s.hours || s.qty) || 0; m.set(s.technician, e);
    });
    return [...m.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  }, [sales]);

  const staffAgg = useMemo(() => {
    const m = new Map();
    sales.forEach((s) => {
      const key = s.soldByEmail || 'Unknown';
      const e = m.get(key) || { name: key, units: 0, revenue: 0, profit: 0, orders: 0 };
      e.units += s.qty || 0;
      e.revenue += s.revenue || 0;
      e.profit += s.profit ?? (s.revenue || 0) - (s.cost || 0);
      e.orders += 1;
      m.set(key, e);
    });
    return [...m.values()].sort((a, b) => b.revenue - a.revenue);
  }, [sales]);

  // ADD-02: restock spend — total, this month, and by supplier.
  const restockAgg = useMemo(() => {
    const now = new Date();
    const thisKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    let total = 0, month = 0, units = 0;
    const bySup = new Map();
    restocks.forEach((r) => {
      const t = r.total || (r.qty || 0) * (r.unitCost || 0);
      total += t;
      units += r.qty || 0;
      const d = tsToDate(r.createdAt);
      if (d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === thisKey) month += t;
      const key = r.supplier || 'Unknown';
      const e = bySup.get(key) || { name: key, spend: 0, units: 0, orders: 0 };
      e.spend += t; e.units += r.qty || 0; e.orders += 1;
      bySup.set(key, e);
    });
    return { total, month, units, orders: restocks.length, bySup: [...bySup.values()].sort((a, b) => b.spend - a.spend) };
  }, [restocks]);

  // Task 8: shrinkage (non-sale reductions) by reason.
  const adjustAgg = useMemo(() => {
    const byReason = new Map();
    let units = 0;
    stockAdjustments.forEach((a) => {
      const r = a.reason || 'Adjustment';
      const mag = Math.abs(a.qty || 0); // qty is signed; show magnitude per reason
      const e = byReason.get(r) || { reason: r, units: 0, events: 0 };
      e.units += mag; e.events += 1; units += mag;
      byReason.set(r, e);
    });
    return { units, events: stockAdjustments.length, byReason: [...byReason.values()].sort((a, b) => b.units - a.units) };
  }, [stockAdjustments]);

  // ---- 4. Fast Movers ----
  const [fmSearch, setFmSearch] = useState('');
  const fastMovers = useMemo(() => {
    const q = safeLower(fmSearch);
    return parts.filter((p) => pUnits(p) > 0 && (!q || safeLower(p.name).includes(q))).sort((a, b) => pUnits(b) - pUnits(a));
  }, [parts, fmSearch, ledgerByPart]);
  const fmPager = useViewMore(fastMovers, 10, fmSearch);

  // ---- 5. Inventory Aging ----
  const [openBucket, setOpenBucket] = useState(null);
  const aging = useMemo(
    () =>
      AGING_BUCKETS.map((b) => {
        const items = parts.filter((p) => { const a = ageDays(p); return a != null && a >= b.min && a <= b.max && (p.stock || 0) > 0; });
        return {
          ...b,
          items,
          count: items.length,
          value: items.reduce((s, p) => s + (p.stock || 0) * (p.sellingPrice || 0), 0),
          locked: items.reduce((s, p) => s + lockedCapital(p), 0),
        };
      }),
    [parts]
  );
  const hasAges = useMemo(() => parts.some((p) => ageDays(p) != null), [parts]);

  // ---- 6. Dead Stock ----
  const [dsSearch, setDsSearch] = useState('');
  const [dsAge, setDsAge] = useState(0); // min days
  const [dsDiscount, setDsDiscount] = useState(20);
  const deadStock = useMemo(() => {
    const q = safeLower(dsSearch);
    return parts
      .filter((p) => isDeadStock(p) && (!q || safeLower(p.name).includes(q)) && (ageDays(p) == null || ageDays(p) >= dsAge))
      .sort((a, b) => lockedCapital(b) - lockedCapital(a));
  }, [parts, dsSearch, dsAge]);
  const dsPager = useViewMore(deadStock, 10, dsSearch + dsAge);
  const deadTotals = useMemo(() => {
    const value = deadStock.reduce((s, p) => s + (p.stock || 0) * (p.sellingPrice || 0), 0);
    const locked = deadStock.reduce((s, p) => s + lockedCapital(p), 0);
    return { value, locked };
  }, [deadStock]);
  const suggestedLiq = (p) => Math.max(Math.round((p.purchasePrice || 0) * 1.05), Math.round((p.sellingPrice || 0) * 0.8));

  async function exportAnalytics() {
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(profitable.map((p) => ({ Part: p.name, Stock: p.stock || 0, Revenue: pRev(p), Profit: pProfit(p), 'Margin %': +pMargin(p).toFixed(1) }))), 'Profitable Parts');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(vehAgg.brands.map((b) => ({ Brand: b.name, Units: b.units, Revenue: b.rev, 'Revenue %': +b.revPct.toFixed(1) }))), 'Vehicle Brands');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(deadStock.map((p) => ({ Part: p.name, Stock: p.stock || 0, 'Locked Capital': lockedCapital(p), 'Days In Stock': ageDays(p) ?? '—', 'Suggested Price': suggestedLiq(p) }))), 'Dead Stock');
      // Issue 5: stock adjustments incl. reason + notes + before/after + user.
      if (stockAdjustments.length) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stockAdjustments.map((a) => ({
          Date: tsToDate(a.createdAt)?.toLocaleString('en-IN') || '',
          Part: a.name || '',
          Reason: a.reason || '',
          Qty: a.qty,
          'Stock Before': a.stockBefore ?? '',
          'Stock After': a.stockAfter ?? '',
          Notes: a.notes || '',
          User: a.byEmail || '',
        }))), 'Stock Adjustments');
      }
      XLSX.writeFile(wb, `Analytics_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success('Analytics exported');
    } catch (e) {
      console.error(e);
      toast.error('Export failed');
    }
  }

  const th = 'text-left px-3 py-2 text-[10px] uppercase tracking-wider text-white/30 font-medium';
  const td = 'px-3 py-2 text-sm';
  // Sticky first column: keeps the part name pinned while numbers scroll on a
  // phone. Background matches the panel so scrolled content slides under it.
  const thSticky = th + ' sticky left-0 z-10';
  const tdSticky = td + ' sticky left-0 z-10';
  const stickyBg = { background: 'var(--surface-0)' };
  const maxBar = Math.max(1, ...trend.series.map((m) => Math.max(m.revenue, m.profit)));

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="rounded-2xl p-3 flex flex-wrap items-center gap-2 backdrop-blur-sm" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
        <span className="text-[11px] uppercase tracking-wider text-white/40 font-semibold px-1">Filters</span>
        <select value={fCategory} onChange={(e) => setFCategory(e.target.value)} className="px-2.5 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60 outline-none max-w-[160px]">
          {categoryOpts.map((c) => <option key={c} value={c} className="bg-[#111]">{c === 'All' ? 'All Categories' : c}</option>)}
        </select>
        <select value={fBrand} onChange={(e) => setFBrand(e.target.value)} className="px-2.5 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60 outline-none max-w-[160px]">
          {brandOpts.map((b) => <option key={b} value={b} className="bg-[#111]">{b === 'All' ? 'All Brands' : b}</option>)}
        </select>
        <div className="flex-1" />
        <button onClick={exportAnalytics} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#d4af37] bg-[#d4af37]/10 border border-[#d4af37]/30 hover:bg-[#d4af37]/20 transition">
          <Download size={13} /> Export Excel
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { label: 'Total Locked Capital', value: kpi.totalLocked, hint: 'Purchase × stock on hand' },
          { label: 'Total Expected Profit', value: kpi.totalProfit, hint: '(MRP − purchase) × stock' },
          { label: 'Total Dead Capital', value: kpi.deadCapital, hint: 'Locked in never-sold items' },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl p-5 backdrop-blur-sm" style={{ background: 'linear-gradient(135deg, rgba(212,175,55,0.10), rgba(170,128,30,0.04))', border: '1px solid rgba(212,175,55,0.25)' }}>
            <p className="text-[11px] uppercase tracking-wider text-[#d4af37]/80 font-semibold">{k.label}</p>
            <p className="text-2xl font-bold text-white mt-2">{formatINR(k.value)}</p>
            <p className="text-[11px] text-white/35 mt-1">{k.hint}</p>
          </div>
        ))}
      </div>

      {/* Copy-workflow: unique products vs inventory records (copies counted once) */}
      {(() => {
        const active = inventory.filter((p) => !p.archived);
        const uniqueProducts = new Set(active.map((p) => baseName(p.name))).size;
        const records = active.length;
        return (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-white/50 -mt-2">
            <span><span className="text-white/80 font-semibold">{uniqueProducts}</span> unique product{uniqueProducts !== 1 ? 's' : ''}</span>
            <span><span className="text-white/80 font-semibold">{records}</span> inventory record{records !== 1 ? 's' : ''}</span>
            {records > uniqueProducts && <span className="text-[#d4af37]/70">({records - uniqueProducts} are copies)</span>}
          </div>
        );
      })()}

      {/* 1. MONTHLY PROFIT TREND */}
      <ACard
        title="Monthly Profit Trend"
        icon={TrendingUp}
        right={
          <select value={range} onChange={(e) => setRange(e.target.value)} className="px-2.5 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60 outline-none">
            <option value="30d" className="bg-[#111]">Last 30 Days</option>
            <option value="3m" className="bg-[#111]">Last 3 Months</option>
            <option value="6m" className="bg-[#111]">Last 6 Months</option>
            <option value="12m" className="bg-[#111]">Last 12 Months</option>
            <option value="all" className="bg-[#111]">All Time</option>
          </select>
        }
      >
        {trend.series.length === 0 ? (
          <div className="rounded-xl px-4 py-8 text-center bg-white/[0.03] border border-white/10">
            <p className="text-sm text-white/50">No sales recorded in this period yet.</p>
            <p className="text-xs text-white/30 mt-1">Each checkout sale is logged here — the trend builds up as you sell.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {[
                { l: 'Revenue', v: formatINR(trend.totRev), c: 'text-white' },
                { l: 'Cost', v: formatINR(trend.totCost), c: 'text-white/70' },
                { l: 'Profit', v: formatINR(trend.totProfit), c: 'text-emerald-400' },
                { l: 'Margin', v: `${trend.margin.toFixed(1)}%`, c: 'text-[#d4af37]' },
              ].map((m) => (
                <div key={m.l} className="rounded-xl px-3 py-2.5 bg-white/[0.03] border border-white/8">
                  <p className="text-[10px] uppercase tracking-wider text-white/40">{m.l}</p>
                  <p className={`text-lg font-bold ${m.c}`}>{m.v}</p>
                </div>
              ))}
            </div>
            {trend.growth != null && (
              <p className={`text-xs font-semibold mb-3 ${trend.growth >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {trend.growth >= 0 ? '▲' : '▼'} Profit {trend.growth >= 0 ? 'increased' : 'decreased'} {Math.abs(trend.growth).toFixed(1)}% vs previous month
              </p>
            )}
            {/* simple SVG-free bar chart: revenue (gold) + profit (emerald) per month */}
            <div className="flex items-end gap-2 h-40 overflow-x-auto pb-1">
              {trend.series.map((m) => (
                <div key={m.key} className="flex flex-col items-center gap-1 min-w-[44px]" title={`Revenue ${formatINR(m.revenue)} · Profit ${formatINR(m.profit)}`}>
                  <div className="flex items-end gap-0.5 h-32">
                    <div className="w-3 rounded-t bg-gradient-to-t from-[#aa801e] to-[#e8c84a]" style={{ height: `${(m.revenue / maxBar) * 100}%` }} />
                    <div className="w-3 rounded-t bg-gradient-to-t from-emerald-700 to-emerald-400" style={{ height: `${(Math.max(0, m.profit) / maxBar) * 100}%` }} />
                  </div>
                  <span className="text-[9px] text-white/40">{m.key.slice(2)}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[11px] text-white/45">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#d4af37]" /> Revenue</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-400" /> Profit</span>
              {trend.best && <span>Best: {trend.best.key} ({formatINR(trend.best.profit)})</span>}
              {trend.worst && <span>Worst: {trend.worst.key} ({formatINR(trend.worst.profit)})</span>}
              <span>Avg/mo: {formatINR(Math.round(trend.avg))}</span>
              {trend.bestRev && <span>Top revenue: {trend.bestRev.key}</span>}
            </div>
          </>
        )}
      </ACard>

      {/* 2. TOP PROFITABLE PARTS */}
      <ACard
        title="Top Profitable Parts"
        icon={TrendingUp}
        right={
          <div className="flex items-center gap-2">
            <ASearch value={ppSearch} onChange={setPpSearch} placeholder="Search parts…" />
            <select value={ppSort} onChange={(e) => setPpSort(e.target.value)} className="px-2 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60 outline-none">
              <option value="profit" className="bg-[#111]">Total Profit</option>
              <option value="margin" className="bg-[#111]">Profit Margin %</option>
              <option value="revenue" className="bg-[#111]">Revenue</option>
            </select>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>{['Part', 'Stock', 'Revenue', 'Profit', 'Margin'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {ppPager.visible.map((p) => (
                <tr key={p.id} className="hover:bg-white/[0.03]" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.04)' }}>
                  <td className={`${td} text-white`}>{p.name}</td>
                  <td className={`${td} text-white/60`}>{p.stock || 0}</td>
                  <td className={`${td} text-white/80`}>{formatINR(pRev(p))}</td>
                  <td className={`${td} text-emerald-400 font-semibold`}>{formatINR(pProfit(p))}</td>
                  <td className={`${td} text-[#d4af37]`}>{pMargin(p).toFixed(1)}%</td>
                </tr>
              ))}
              {profitable.length === 0 && <tr><td className={`${td} text-white/35`} colSpan={5}>No sales recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <ViewMoreBar pager={ppPager} label="parts" />
      </ACard>

      {/* 3. VEHICLE ANALYTICS */}
      <ACard
        title="Vehicle Analytics"
        icon={BarChart3}
        right={
          <div className="flex items-center gap-2">
            <ASearch value={vehSearch} onChange={setVehSearch} placeholder="Search…" />
            <div className="flex rounded-lg overflow-hidden border border-white/10">
              {['brand', 'model'].map((m) => (
                <button key={m} onClick={() => setVehMode(m)} className={`px-2.5 py-1.5 text-xs font-semibold capitalize ${vehMode === m ? 'bg-[#d4af37]/20 text-[#d4af37]' : 'text-white/50 hover:bg-white/5'}`}>{m}s</button>
              ))}
            </div>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>{[vehMode === 'brand' ? 'Brand' : 'Model', 'Units', 'Revenue', 'Profit', 'Rev %'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {vehPager.visible.map((r) => (
                <tr key={r.name} className="hover:bg-white/[0.03]" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.04)' }}>
                  <td className={`${td} text-white`}>{r.name}</td>
                  <td className={`${td} text-white/60`}>{r.units}</td>
                  <td className={`${td} text-white/80`}>{formatINR(r.rev)}</td>
                  <td className={`${td} text-emerald-400`}>{formatINR(r.prof)}</td>
                  <td className={td}>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-gradient-to-r from-[#e8c84a] to-[#aa801e]" style={{ width: `${r.revPct}%` }} /></div>
                      <span className="text-[#d4af37] text-xs">{r.revPct.toFixed(0)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
              {vehRows.length === 0 && <tr><td className={`${td} text-white/35`} colSpan={5}>No vehicle sales data yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <ViewMoreBar pager={vehPager} label={vehMode === 'brand' ? 'brands' : 'models'} />
      </ACard>

      {/* Revenue mix: Parts vs Labour vs Service vs Outside */}
      <ACard title="Revenue Mix — Parts vs Labour vs Service" icon={TrendingUp}>
        {revenueMix.length === 0 ? (
          <p className="text-xs text-white/35">No revenue recorded yet.</p>
        ) : (
          <div className="space-y-2.5">
            {revenueMix.map((r) => (
              <div key={r.label}>
                <div className="flex items-center justify-between text-xs mb-1"><span className="text-white/70">{r.label}</span><span className="text-white/90 font-semibold">{inr(r.value)} · {r.pct.toFixed(1)}%</span></div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(var(--fg-rgb),0.06)' }}><div className="h-full rounded-full" style={{ width: `${r.pct}%`, background: r.color }} /></div>
              </div>
            ))}
          </div>
        )}
      </ACard>

      {/* Top services / labour by revenue */}
      <ACard title="Top Services & Labour by Revenue" icon={Wrench}>
        {topServices.length === 0 ? (
          <p className="text-xs text-white/35">No service or labour revenue yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[420px]">
              <thead><tr className="text-[10px] uppercase text-white/40"><th className="text-left py-1.5 px-2">Service</th><th className="text-right py-1.5 px-2">Jobs</th><th className="text-right py-1.5 px-2">Revenue</th><th className="text-right py-1.5 px-2">Profit</th></tr></thead>
              <tbody>{topServices.map((s) => <tr key={s.name} style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.05)' }}><td className="py-1.5 px-2 text-white/80">{s.name}</td><td className="py-1.5 px-2 text-right text-white/60">{s.count}</td><td className="py-1.5 px-2 text-right text-white/85">{inr(s.revenue)}</td><td className="py-1.5 px-2 text-right text-emerald-400">{inr(s.profit)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </ACard>

      {/* Technician productivity */}
      {techAgg.length > 0 && (
        <ACard title="Technician Productivity" icon={Users}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[420px]">
              <thead><tr className="text-[10px] uppercase text-white/40"><th className="text-left py-1.5 px-2">Technician</th><th className="text-right py-1.5 px-2">Jobs</th><th className="text-right py-1.5 px-2">Hours</th><th className="text-right py-1.5 px-2">Revenue</th></tr></thead>
              <tbody>{techAgg.map((tv) => <tr key={tv.name} style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.05)' }}><td className="py-1.5 px-2 text-white/80">{tv.name}</td><td className="py-1.5 px-2 text-right text-white/60">{tv.jobs}</td><td className="py-1.5 px-2 text-right text-white/60">{tv.hours}</td><td className="py-1.5 px-2 text-right text-white/85">{inr(tv.revenue)}</td></tr>)}</tbody>
            </table>
          </div>
        </ACard>
      )}

      {/* Sales by Staff (ADD-05) */}
      <ACard title="Sales by Staff" icon={Users}>
        {staffAgg.length === 0 ? (
          <p className="text-xs text-white/35">No sales recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>{['Staff', 'Orders', 'Units', 'Revenue', 'Profit'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {staffAgg.map((r) => (
                  <tr key={r.name} className="hover:bg-white/[0.03]" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.04)' }}>
                    <td className={`${td} text-white`}>{r.name}</td>
                    <td className={`${td} text-white/60`}>{r.orders}</td>
                    <td className={`${td} text-white/60`}>{r.units}</td>
                    <td className={`${td} text-white/80`}>{formatINR(r.revenue)}</td>
                    <td className={`${td} text-emerald-400`}>{formatINR(r.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-white/30 mt-2">Sales recorded before staff attribution show as “Unknown”.</p>
          </div>
        )}
      </ACard>

      {/* Restock Cost (ADD-02) */}
      <ACard title="Restock Cost" icon={PackagePlus}>
        {restocks.length === 0 ? (
          <p className="text-xs text-white/35">No goods-received records yet. Use the green “Receive” button on a part to log a restock.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              {[
                ['Total spent', formatINR(restockAgg.total)],
                ['This month', formatINR(restockAgg.month)],
                ['Units received', restockAgg.units],
                ['Receipts', restockAgg.orders],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl p-3" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                  <div className="text-[10px] uppercase tracking-wider text-white/40">{k}</div>
                  <div className="text-base font-bold text-[#d4af37] mt-0.5">{v}</div>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>{['Supplier', 'Receipts', 'Units', 'Spend'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {restockAgg.bySup.slice(0, 10).map((r) => (
                    <tr key={r.name} className="hover:bg-white/[0.03]" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.04)' }}>
                      <td className={`${td} text-white`}>{r.name}</td>
                      <td className={`${td} text-white/60`}>{r.orders}</td>
                      <td className={`${td} text-white/60`}>{r.units}</td>
                      <td className={`${td} text-[#d4af37]`}>{formatINR(r.spend)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </ACard>

      {/* Task 8: Stock adjustments (non-sales) */}
      <ACard title="Stock Adjustments (non-sales)" icon={PackageX}>
        {stockAdjustments.length === 0 ? (
          <p className="text-xs text-white/35">No non-sale stock changes recorded. Use the amber “Adjust” action on a part to log damage, loss, or a correction.</p>
        ) : (
          <>
            <p className="text-xs text-white/50 mb-2">{adjustAgg.units} units across {adjustAgg.events} adjustments — kept separate from sales so revenue stays accurate.</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {adjustAgg.byReason.map((r) => (
                <div key={r.reason} className="rounded-xl p-3" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                  <div className="text-[10px] uppercase tracking-wider text-white/40">{r.reason}</div>
                  <div className="text-base font-bold text-amber-400 mt-0.5">{r.units} <span className="text-[10px] text-white/40 font-normal">units</span></div>
                  <div className="text-[10px] text-white/35">{r.events} event{r.events !== 1 ? 's' : ''}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </ACard>

      {/* 4. FAST MOVERS */}
      <ACard title="Fast Movers" icon={Zap} right={<ASearch value={fmSearch} onChange={setFmSearch} placeholder="Search parts…" />}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>{['#', 'Part', 'Units Sold', 'Revenue', 'Profit'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {fmPager.visible.map((p, i) => (
                <tr key={p.id} className="hover:bg-white/[0.03]" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.04)' }}>
                  <td className={`${td} text-[#d4af37] font-bold`}>{i + 1}</td>
                  <td className={`${td} text-white`}>{p.name}</td>
                  <td className={`${td} text-emerald-400 font-semibold`}>{pUnits(p)}</td>
                  <td className={`${td} text-white/80`}>{formatINR(pRev(p))}</td>
                  <td className={`${td} text-white/80`}>{formatINR(pProfit(p))}</td>
                </tr>
              ))}
              {fastMovers.length === 0 && <tr><td className={`${td} text-white/35`} colSpan={5}>No sales recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <ViewMoreBar pager={fmPager} label="parts" />
      </ACard>

      {/* 5. INVENTORY AGING REPORT */}
      <ACard title="Inventory Aging Report" icon={Archive}>
        {!hasAges && <p className="text-[11px] text-amber-400/70 mb-2">Aging uses each part’s stock-in date (createdAt). Parts without one aren’t bucketed.</p>}
        <div className="space-y-2">
          {aging.map((b) => {
            const sev = SEVERITY[b.key];
            const open = openBucket === b.key;
            return (
              <div key={b.key} className="rounded-xl overflow-hidden" style={{ background: 'rgba(var(--fg-rgb),0.02)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
                <button onClick={() => setOpenBucket(open ? null : b.key)} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.03] text-left">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: sev.dot }} />
                  <span className="text-sm font-semibold text-white w-28 flex-shrink-0">{b.key}</span>
                  <span className="text-[10px] uppercase tracking-wide flex-shrink-0" style={{ color: sev.dot }}>{sev.label}</span>
                  <div className="flex-1" />
                  <span className="text-xs text-white/50">{b.count} parts</span>
                  <span className="text-xs text-white/70 hidden sm:inline">Value {formatINR(b.value)}</span>
                  <span className="text-xs text-[#d4af37]">Locked {formatINR(b.locked)}</span>
                  <span className={`text-white/40 transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
                </button>
                {open && (
                  <div className="px-3 pb-2 overflow-x-auto" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                    {b.items.length ? (
                      <table className="w-full">
                        <thead><tr>{['Part', 'Qty', 'Value', 'Days in Stock'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                        <tbody>
                          {b.items.slice(0, 50).map((p) => (
                            <tr key={p.id} style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.04)' }}>
                              <td className={`${td} text-white`}>{p.name}</td>
                              <td className={`${td} text-white/60`}>{p.stock || 0}</td>
                              <td className={`${td} text-white/80`}>{formatINR((p.stock || 0) * (p.sellingPrice || 0))}</td>
                              <td className={`${td} text-white/60`}>{ageDays(p) ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : <p className="text-xs text-white/35 py-2">No parts in this range.</p>}
                    {b.items.length > 50 && <p className="text-[11px] text-white/30 py-1">Showing first 50 of {b.items.length}.</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ACard>

      {/* 6. DEAD STOCK ANALYSIS */}
      <ACard
        title="Dead Stock Analysis"
        icon={Archive}
        right={
          <div className="flex items-center gap-2 flex-wrap">
            <ASearch value={dsSearch} onChange={setDsSearch} placeholder="Search…" />
            <select value={dsAge} onChange={(e) => setDsAge(+e.target.value)} className="px-2 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60 outline-none">
              <option value={0} className="bg-[#111]">All ages</option>
              <option value={30} className="bg-[#111]">30+ days</option>
              <option value={60} className="bg-[#111]">60+ days</option>
              <option value={90} className="bg-[#111]">90+ days</option>
              <option value={180} className="bg-[#111]">180+ days</option>
            </select>
          </div>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
          <div className="rounded-xl px-3 py-2.5 bg-white/[0.03] border border-white/8"><p className="text-[10px] uppercase tracking-wider text-white/40">Dead Stock Value</p><p className="text-base font-bold text-white">{formatINR(deadTotals.value)}</p></div>
          <div className="rounded-xl px-3 py-2.5 bg-white/[0.03] border border-white/8"><p className="text-[10px] uppercase tracking-wider text-white/40">Locked Capital</p><p className="text-base font-bold text-red-400">{formatINR(deadTotals.locked)}</p></div>
          <div className="rounded-xl px-3 py-2.5 bg-white/[0.03] border border-white/8 col-span-2 sm:col-span-1">
            <p className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Recovery @ discount</p>
            <div className="flex gap-1">
              {[10, 20, 30, 40].map((d) => (
                <button key={d} onClick={() => setDsDiscount(d)} className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${dsDiscount === d ? 'bg-[#d4af37] text-black' : 'bg-white/5 text-white/50'}`}>{d}%</button>
              ))}
            </div>
            <p className="text-sm font-bold text-emerald-400 mt-1">{formatINR(Math.round(deadTotals.value * (1 - dsDiscount / 100)))}</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>{['Part', 'Stock', 'Locked', 'Days', 'Suggested ₹', ''].map((h, i) => <th key={i} className={i === 0 ? thSticky : th} style={i === 0 ? stickyBg : undefined}>{h}</th>)}</tr></thead>
            <tbody>
              {dsPager.visible.map((p) => (
                <tr key={p.id} className="hover:bg-white/[0.03]" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.04)' }}>
                  <td className={`${tdSticky} text-white`} style={stickyBg}>{p.name}</td>
                  <td className={`${td} text-white/60`}>{p.stock || 0}</td>
                  <td className={`${td} text-red-400`}>{formatINR(lockedCapital(p))}</td>
                  <td className={`${td} text-white/60`}>{ageDays(p) ?? '—'}</td>
                  <td className={`${td} text-[#d4af37] font-semibold`}>{formatINR(suggestedLiq(p))}</td>
                  <td className={td}><button onClick={() => onEditPart(p)} className="flex items-center gap-1 text-[11px] font-semibold text-[#d4af37] hover:underline"><Edit3 size={11} /> Liquidate</button></td>
                </tr>
              ))}
              {deadStock.length === 0 && <tr><td className={`${td} text-white/35`} colSpan={6}>No dead stock — everything’s moving!</td></tr>}
            </tbody>
          </table>
        </div>
        <ViewMoreBar pager={dsPager} label="items" />
      </ACard>

      {/* Audit Log (ADD-06) — admin-only; the whole Analytics tab is admin-gated */}
      <AuditLogPanel auditLog={auditLog} />

      <p className="text-[11px] text-white/25 text-center pb-2">
        Revenue, cost &amp; profit are computed from the sales ledger (actual sale prices); the Monthly Trend uses unbounded monthly rollups.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ADD-01: Bulk import from Excel/CSV — column mapping, preview, dedupe, batched
// writeBatch (max 500/commit) with progress.
// ---------------------------------------------------------------------------
const IMPORT_FIELDS = [
  { key: 'name', label: 'Part Name', required: true, syn: ['name', 'part', 'item', 'description', 'product'] },
  { key: 'sku', label: 'SKU / Part No', syn: ['sku', 'part no', 'partno', 'code', 'barcode'] },
  { key: 'category', label: 'Category', syn: ['category', 'type', 'group'] },
  { key: 'vehicle', label: 'Vehicle', syn: ['vehicle', 'car', 'model', 'compatible'] },
  { key: 'stock', label: 'Stock', syn: ['stock', 'qty', 'quantity', 'on hand', 'onhand'] },
  { key: 'minStock', label: 'Min Stock', syn: ['min stock', 'minstock', 'reorder', 'minimum'] },
  { key: 'purchasePrice', label: 'Purchase Price', syn: ['purchase', 'cost', 'buy'] },
  { key: 'sellingPrice', label: 'MRP / Selling', syn: ['mrp', 'selling', 'sell', 'price', 'rate'] },
  { key: 'minSellingPrice', label: 'Min Selling', syn: ['min sell', 'floor', 'min selling'] },
  { key: 'locationBin', label: 'Shelf / Bin', syn: ['shelf', 'bin', 'rack', 'location'] },
];

function ImportModal({ existingSkus, onClose, onImported }) {
  useBodyScrollLock();
  const [stage, setStage] = useState('upload'); // upload | map | importing | done
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [skipDup, setSkipDup] = useState(true);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState({ added: 0, skipped: 0 });

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
      if (!aoa.length) { toast.error('That file looks empty.'); return; }
      const hdr = (aoa[0] || []).map((h) => String(h ?? '').trim());
      const data = aoa.slice(1).filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
      // Auto-map headers → fields.
      const used = new Set();
      const auto = {};
      IMPORT_FIELDS.forEach((f) => {
        const idx = hdr.findIndex((h, i) => !used.has(i) && f.syn.some((s) => safeLower(h).includes(s)));
        if (idx >= 0) { auto[f.key] = idx; used.add(idx); }
        else auto[f.key] = -1;
      });
      setHeaders(hdr);
      setRows(data);
      setMapping(auto);
      setStage('map');
    } catch (err) {
      console.error(err);
      toast.error('Could not read that file. Use .xlsx or .csv.');
    }
  }

  const val = (row, key) => {
    const i = mapping[key];
    return i != null && i >= 0 ? row[i] : undefined;
  };
  const num = (v) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const validRows = rows.filter((r) => String(val(r, 'name') ?? '').trim() !== '');

  async function runImport() {
    setStage('importing');
    setProgress(0);
    let added = 0, skipped = 0;
    const seen = new Set();
    const rejected = []; // Issue 11: collect invalid rows + reasons
    const toWrite = [];
    validRows.forEach((r) => {
      const name = String(val(r, 'name')).trim();
      const sku = String(val(r, 'sku') ?? '').trim();
      const stock = Math.round(num(val(r, 'stock')));
      const pp = num(val(r, 'purchasePrice'));
      const sp = num(val(r, 'sellingPrice'));
      const msp = num(val(r, 'minSellingPrice'));
      // Issue 11: validate before writing.
      if (stock < 0) { rejected.push(`${name}: negative stock`); return; }
      if (pp < 0 || sp < 0 || msp < 0) { rejected.push(`${name}: negative price`); return; }
      if (sp > 0 && pp > 0 && sp < pp) { rejected.push(`${name}: MRP below purchase price`); return; }
      if (msp > 0 && sp > 0 && msp > sp) { rejected.push(`${name}: floor above MRP`); return; }
      if (skipDup && sku) {
        const key = safeLower(sku);
        if (existingSkus.has(key) || seen.has(key)) { skipped++; return; }
        seen.add(key);
      }
      const cat = String(val(r, 'category') ?? '').trim();
      toWrite.push({
        name,
        sku,
        category: cat,
        categories: cat ? [cat] : [],
        vehicle: String(val(r, 'vehicle') ?? '').trim(),
        compatibleCars: [],
        locationBin: String(val(r, 'locationBin') ?? '').trim(),
        stock,
        minStock: Math.round(num(val(r, 'minStock'))) || 5,
        purchasePrice: pp,
        sellingPrice: sp,
        minSellingPrice: msp,
        salesCount: 0,
        suppliers: [],
        imageString: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    try {
      const CHUNK = 450;
      for (let i = 0; i < toWrite.length; i += CHUNK) {
        const batch = writeBatch(db);
        toWrite.slice(i, i + CHUNK).forEach((p) => batch.set(doc(collection(db, 'parts')), p));
        await batch.commit();
        added += Math.min(CHUNK, toWrite.length - i);
        setProgress(Math.round(((i + CHUNK) / toWrite.length) * 100));
      }
      setResult({ added, skipped, rejected });
      setStage('done');
      if (added > 0 && typeof onImported === 'function') onImported(added);
    } catch (err) {
      console.error(err);
      toast.error('Import failed partway. Some rows may have saved.');
      setStage('done');
      setResult({ added, skipped, rejected });
    }
  }

  const fld = 'px-2 py-1.5 rounded-lg text-xs outline-none bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl p-5 modal-sheet overflow-y-auto" style={{ background: 'var(--surface-3)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-bold text-white">Import parts from Excel / CSV</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X size={18} /></button>
        </div>

        {stage === 'upload' && (
          <div className="mt-4">
            <p className="text-sm text-white/50 mb-4">Upload a .xlsx or .csv with a header row. You’ll map columns next.</p>
            <label className="flex flex-col items-center justify-center gap-2 py-10 rounded-xl border-2 border-dashed border-white/15 cursor-pointer hover:border-[#d4af37]/40 transition">
              <Download size={22} className="text-[#d4af37] rotate-180" />
              <span className="text-sm text-white/70">Tap to choose a file</span>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />
            </label>
          </div>
        )}

        {stage === 'map' && (
          <div className="mt-4">
            <p className="text-sm text-white/50 mb-3">Match your columns to fields. We guessed where we could.</p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {IMPORT_FIELDS.map((f) => (
                <div key={f.key} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-white/70">{f.label}{f.required && <span className="text-red-400"> *</span>}</span>
                  <select value={mapping[f.key]} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: +e.target.value }))} className={`${fld} w-32`}>
                    <option value={-1} className="bg-[#111]">— skip —</option>
                    {headers.map((h, i) => <option key={i} value={i} className="bg-[#111]">{h || `Col ${i + 1}`}</option>)}
                  </select>
                </div>
              ))}
            </div>

            <p className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Preview (first 5 of {validRows.length} rows)</p>
            <div className="overflow-x-auto rounded-lg border border-white/10 mb-3">
              <table className="w-full text-xs">
                <thead><tr>{['Name', 'SKU', 'Stock', 'MRP'].map((h) => <th key={h} className="text-left px-2 py-1.5 text-white/40">{h}</th>)}</tr></thead>
                <tbody>
                  {validRows.slice(0, 5).map((r, i) => (
                    <tr key={i} style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                      <td className="px-2 py-1.5 text-white">{String(val(r, 'name') ?? '')}</td>
                      <td className="px-2 py-1.5 text-white/60">{String(val(r, 'sku') ?? '—')}</td>
                      <td className="px-2 py-1.5 text-white/60">{String(val(r, 'stock') ?? '0')}</td>
                      <td className="px-2 py-1.5 text-white/60">{String(val(r, 'sellingPrice') ?? '0')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <label className="flex items-center gap-2 text-xs text-white/60 mb-4">
              <input type="checkbox" checked={skipDup} onChange={(e) => setSkipDup(e.target.checked)} className="accent-[#d4af37]" />
              Skip rows whose SKU already exists
            </label>

            <div className="flex gap-2">
              <button onClick={() => setStage('upload')} className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80">Back</button>
              <button
                onClick={runImport}
                disabled={mapping.name < 0 || validRows.length === 0}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold ${mapping.name >= 0 && validRows.length ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]' : 'bg-white/5 text-white/30 cursor-not-allowed'}`}
              >
                Import {validRows.length} parts
              </button>
            </div>
            {mapping.name < 0 && <p className="text-[11px] text-amber-400/80 mt-2">Map the Part Name column to continue.</p>}
          </div>
        )}

        {stage === 'importing' && (
          <div className="mt-6 py-8 text-center">
            <p className="text-sm text-white/70 mb-3">Importing… {progress}%</p>
            <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-[#e8c84a] to-[#aa801e] transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {stage === 'done' && (
          <div className="mt-6 py-6 text-center">
            <p className="text-lg font-bold text-emerald-400">Imported {result.added} parts</p>
            {result.skipped > 0 && <p className="text-sm text-white/50 mt-1">{result.skipped} skipped (duplicate SKU)</p>}
            {result.rejected?.length > 0 && (
              <div className="mt-3 text-left max-w-sm mx-auto">
                <p className="text-sm font-semibold text-red-400">{result.rejected.length} rejected (invalid data):</p>
                <ul className="mt-1 max-h-32 overflow-y-auto text-xs text-white/50 space-y-0.5">
                  {result.rejected.slice(0, 50).map((m, i) => <li key={i}>• {m}</li>)}
                </ul>
              </div>
            )}
            <button onClick={onClose} className="mt-5 px-6 py-2.5 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------
// Section 14: per-product movement ledger — one chronological timeline built
// from the sale, restock, and adjustment records for a single part.
function ProductLedgerModal({ part, sales, restocks, stockAdjustments, onClose }) {
  useBodyScrollLock();
  const rows = useMemo(() => {
    const out = [];
    sales.filter((s) => s.partId === part.id).forEach((s) =>
      out.push({ t: tsToDate(s.createdAt), type: s.source === 'invoice' ? 'Sale (Invoice)' : 'Sale', qty: -(s.qty || 0), note: [s.invoiceNo, s.customer].filter(Boolean).join(' · ') || (s.belowFloor ? 'below floor' : ''), by: s.soldByEmail }));
    restocks.filter((r) => r.partId === part.id).forEach((r) =>
      out.push({ t: tsToDate(r.createdAt), type: 'Purchase', qty: +(r.qty || 0), note: r.supplierName || '', by: r.byEmail }));
    stockAdjustments.filter((a) => a.partId === part.id).forEach((a) =>
      out.push({ t: tsToDate(a.createdAt), type: a.reason || 'Adjustment', qty: a.qty || 0, note: a.notes || '', by: a.byEmail }));
    return out.filter((r) => r.t).sort((a, b) => b.t - a.t);
  }, [part.id, sales, restocks, stockAdjustments]);

  const color = (q) => (q > 0 ? 'text-emerald-400' : 'text-red-400');
  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>
          <div className="flex items-center gap-2"><History size={18} className="text-[#d4af37]" /><h2 className="text-base font-bold text-white">Movement history — {part.name}</h2></div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/60"><X size={16} /></button>
        </div>
        <div className="p-5 max-h-[70vh] overflow-y-auto">
          <p className="text-xs text-white/45 mb-3">Current stock: <span className="text-white/80 font-semibold">{part.stock || 0}</span></p>
          {rows.length === 0 ? (
            <p className="text-sm text-white/40">No recorded movements yet. Sales, goods received, and stock adjustments for this part will appear here.</p>
          ) : (
            <div className="space-y-1.5">
              {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: 'rgba(var(--fg-rgb),0.02)', border: '1px solid rgba(var(--fg-rgb),0.05)' }}>
                  <span className={`text-sm font-bold w-12 text-right ${color(r.qty)}`}>{r.qty > 0 ? `+${r.qty}` : r.qty}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-white truncate">{r.type}{r.note && <span className="text-white/40"> · {r.note}</span>}</div>
                    <div className="text-[10px] text-white/35">{r.t.toLocaleString('en-IN')}{r.by ? ` · ${r.by}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Phase B — OVERVIEW dashboard. Every widget reads REAL data from props; there
// is no placeholder/sample content. Empty states show honest zeros.
// ===========================================================================
function OverviewCard({ children, className = '' }) {
  return <div className={`rounded-2xl p-4 ${className}`} style={{ background: 'rgba(var(--fg-rgb),0.02)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>{children}</div>;
}
function QuickPickModal({ mode, inventory, onPick, onClose }) {
  useBodyScrollLock();
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const needle = safeLower(q.trim());
    return inventory
      .filter((p) => !p.archived && (!needle || safeLower(`${p.name} ${p.sku || ''}`).includes(needle)))
      .sort((a, b) => (b.salesCount || 0) - (a.salesCount || 0))
      .slice(0, 60);
  }, [inventory, q]);
  const title = mode === 'sell' ? 'Record Sale' : mode === 'adjust' ? 'Adjust Stock' : 'Receive Stock';
  const hint = mode === 'sell' ? 'Pick the part you sold' : mode === 'adjust' ? 'Pick the part to adjust' : 'Pick the part that arrived';
  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center p-4 pt-[8vh]" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-white/8">
          <div className="flex items-center gap-2">
            {mode === 'sell' ? <ShoppingCart size={16} className="text-[#d4af37]" /> : <PackagePlus size={16} className="text-[#d4af37]" />}
            <div><h3 className="text-sm font-bold text-white">{title}</h3><p className="text-[11px] text-white/40">{hint}</p></div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X size={16} /></button>
        </div>
        <div className="p-3">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search part name or SKU…" className="w-full px-3 py-2.5 rounded-lg text-sm outline-none bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60 mb-2" />
          <div className="max-h-[50vh] overflow-y-auto space-y-1">
            {list.length === 0 ? <p className="text-sm text-white/40 py-6 text-center">No parts found.</p> : list.map((p) => (
              <button key={p.id} onClick={() => onPick(p)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-[#d4af37]/[0.08] border border-transparent hover:border-[#d4af37]/30 transition">
                <PartImageThumb src={p.imageString} alt={p.name} />
                <span className="min-w-0 flex-1"><span className="block text-sm text-white truncate">{p.name}</span><span className="block text-[11px] text-white/40 truncate">{p.sku || 'no SKU'} · stock {p.stock ?? 0}</span></span>
                {mode === 'sell' && (p.stock || 0) <= 0 && <span className="text-[10px] text-red-400 font-semibold">out</span>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
function DateRangeControl({ value, onChange, custom, onCustomChange, label }) {
  const [open, setOpen] = useState(false);
  const presets = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['year', 'This year'], ['custom', 'Custom range']];
  const short = presets.find((p) => p[0] === value)?.[1] || 'Today';
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 h-10 px-3.5 rounded-xl text-sm font-semibold bg-white/5 border border-white/10 text-white/85 hover:bg-white/10 active:scale-95 transition">
        <Calendar size={15} className="text-[#d4af37]" /> {value === 'custom' ? label : short} <ChevronDown size={15} className={`text-white/40 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 z-[91] w-56 rounded-xl p-1.5 shadow-2xl" style={{ background: 'var(--surface-2)', border: '1px solid rgba(var(--fg-rgb),0.1)' }}>
            {presets.map(([k, l]) => (
              <button key={k} onClick={() => { onChange(k); if (k !== 'custom') setOpen(false); }} className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${value === k ? 'bg-[#d4af37]/15 text-[#d4af37] font-semibold' : 'text-white/70 hover:bg-white/5'}`}>{l}</button>
            ))}
            {value === 'custom' && (
              <div className="p-2 space-y-2 mt-1" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.1)' }}>
                <label className="block text-[10px] uppercase tracking-wide text-white/40">From</label>
                <input type="date" value={custom?.start || ''} onChange={(e) => onCustomChange({ ...custom, start: e.target.value })} className="w-full px-2 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-white" />
                <label className="block text-[10px] uppercase tracking-wide text-white/40">To</label>
                <input type="date" value={custom?.end || ''} onChange={(e) => onCustomChange({ ...custom, end: e.target.value })} className="w-full px-2 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-white" />
                <button onClick={() => setOpen(false)} className="w-full py-1.5 rounded-lg text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">Apply</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ScoreCard({ title, icon: Icon, score, suffix = '%', factors, note }) {
  const r = ratingFor(score);
  return (
    <div className="rounded-2xl p-4 backdrop-blur-sm" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
      <h3 className="text-xs uppercase tracking-wider text-white/40 mb-2 flex items-center gap-2"><Icon size={14} className="text-[#d4af37]" /> {title}</h3>
      <div className="flex items-end gap-2">
        <span className="text-3xl font-bold leading-none" style={{ color: r.color }}>{score}<span className="text-lg">{suffix}</span></span>
        <span className="text-sm font-semibold mb-0.5" style={{ color: r.color }}>{r.label}</span>
      </div>
      <div className="h-2 rounded-full mt-2.5 overflow-hidden" style={{ background: 'rgba(var(--fg-rgb),0.08)' }}>
        <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${score}%`, background: `linear-gradient(90deg, ${r.color}, ${r.color}aa)` }} />
      </div>
      {note && <p className="text-[11px] text-white/35 mt-2">{note}</p>}
      {factors && (
        <div className="mt-3 space-y-1.5">
          {factors.map((f) => (
            <div key={f.label} className="flex items-center gap-2">
              <span className="text-[11px] text-white/50 w-24 flex-shrink-0">{f.label}</span>
              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(var(--fg-rgb),0.06)' }}>
                <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${f.pct}%`, background: f.pct >= 75 ? '#34d399' : f.pct >= 50 ? '#d4af37' : '#fb923c' }} />
              </div>
              <span className="text-[10px] text-white/40 w-8 text-right">{f.pct}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Rich, reassuring save confirmation (Priority 8 — smart notifications).
function smartSaveToast(name, { isEdit = false, hasSupplier = false } = {}) {
  toast.custom((t) => (
    <div className={`max-w-sm w-full rounded-xl p-3.5 shadow-2xl ${t.visible ? 'animate-enter' : 'animate-leave'}`} style={{ background: 'var(--surface-2)', border: '1px solid rgba(52,211,153,0.3)' }}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(52,211,153,0.15)' }}><Check size={14} className="text-emerald-400" /></span>
        <span className="text-sm font-bold text-white truncate">{name} {isEdit ? 'updated' : 'added'}</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 pl-8">
        {[hasSupplier && 'Supplier linked', 'Inventory updated', 'Search indexed', 'Ready for sale'].filter(Boolean).map((l) => (
          <span key={l} className="inline-flex items-center gap-1 text-[11px] text-emerald-400/90"><Check size={10} /> {l}</span>
        ))}
      </div>
    </div>
  ), { duration: 3000 });
}

function OverviewView({ inventory, sales, suppliers, auditLog, restocks, stockAdjustments = [], reorderRequests = [], purchaseOrders = [], lastSync, lastBackup, online, connError, onNavigate, onAddPart, onAddSupplier, onImport, onReorder, onAdvanceStatus, onClearRequest, onEditPart, isAdmin, canDestroy = true, onQuickSell, onQuickReceive }) {
  const active = useMemo(() => inventory.filter((p) => !p.archived), [inventory]);
  const now = new Date();
  const yesterday = new Date(Date.now() - 86400000);

  // --- Dashboard date range (drives all sales-based widgets) ---
  const [dateRange, setDateRange] = useState('today');
  const [customRange, setCustomRange] = useState({ start: '', end: '' });
  const range = useMemo(() => computeRange(dateRange, customRange), [dateRange, customRange]);
  const periodAgg = useMemo(() => {
    const len = Math.max(1, range.end - range.start);
    const prevStart = range.start - len - 1;
    const prevEnd = range.start - 1;
    const rev = (s) => s.revenue ?? s.total ?? 0;
    const qty = (s) => s.qty ?? s.quantity ?? 0;
    let revenue = 0, pro = 0, cnt = 0, pRev = 0, pPro = 0, pCnt = 0;
    sales.forEach((s) => {
      const d = tsToDate(s.createdAt); if (!d) return;
      const t = d.getTime();
      if (t >= range.start && t <= range.end) { revenue += rev(s); pro += s.profit || 0; cnt += 1; }
      else if (t >= prevStart && t <= prevEnd) { pRev += rev(s); pPro += s.profit || 0; pCnt += 1; }
    });
    return { rev: revenue, pro, cnt, pRev, pPro, pCnt };
  }, [sales, range]);

  // --- Today's Overview (real, from the sales ledger) ---
  const today = useMemo(() => {
    let revT = 0, proT = 0, cntT = 0, revY = 0, proY = 0, cntY = 0;
    sales.forEach((s) => {
      const d = tsToDate(s.createdAt);
      if (!d) return;
      if (isSameDay(d, now)) { revT += s.revenue || 0; proT += s.profit || 0; cntT += 1; }
      else if (isSameDay(d, yesterday)) { revY += s.revenue || 0; proY += s.profit || 0; cntY += 1; }
    });
    let movesIn = 0, movesOut = cntT;
    restocks.forEach((r) => { const d = tsToDate(r.createdAt); if (isSameDay(d, now)) movesIn += 1; });
    let adjToday = 0;
    stockAdjustments.forEach((a) => { const d = tsToDate(a.createdAt); if (isSameDay(d, now)) adjToday += 1; });
    return { revT, proT, cntT, revY, proY, cntY, movesIn, movesOut, adjToday };
  }, [sales, restocks]);

  // --- Inventory health ---
  const health = useMemo(() => {
    const total = active.length;
    const out = active.filter((p) => (p.stock || 0) === 0).length;
    const low = active.filter((p) => (p.stock || 0) > 0 && (p.stock || 0) <= (p.minStock || 5)).length;
    const healthy = total - out - low;
    return { total, out, low, healthy, pct: total ? Math.round((healthy / total) * 100) : 100 };
  }, [active]);

  // --- Reorder center (stock <= min) ---
  const reorder = useMemo(() => active
    .filter((p) => (p.stock || 0) <= (p.minStock || 5))
    .map((p) => {
      const need = Math.max((p.minStock || 5) * 2 - (p.stock || 0), (p.minStock || 5));
      const sup = (p.suppliers || []).find((s) => s.isPreferred) || (p.suppliers || [])[0];
      return { p, need, supplier: sup?.name || '—', cost: need * (p.purchasePrice || 0) };
    })
    .sort((a, b) => (a.p.stock || 0) - (b.p.stock || 0)), [active]);

  // --- Low stock (>0 and <= min) ---
  const lowStock = useMemo(() => active.filter((p) => (p.stock || 0) > 0 && (p.stock || 0) <= (p.minStock || 5)).sort((a, b) => (a.stock || 0) - (b.stock || 0)), [active]);

  // --- Recent activity (audit logs only) ---
  const ACT_LABEL = { delete_part: 'Part deleted', delete_supplier: 'Supplier deleted', price_change: 'Price changed', below_floor_sale: 'Below-floor sale', stock_adjustment: 'Stock adjusted', archive_part: 'Part archived', restore_part: 'Part restored' };
  const recent = useMemo(() => auditLog.slice(0, 6).map((e) => ({ id: e.id, label: ACT_LABEL[e.action] || e.action, name: e.name || '', when: tsToDate(e.createdAt) })), [auditLog]);

  // --- Top selling (from sales ledger within the selected range) ---
  const topSelling = useMemo(() => {
    const m = new Map();
    sales.forEach((s) => {
      if (!s.partId) return;
      const d = tsToDate(s.createdAt); if (!d) return;
      const t = d.getTime();
      if (t < range.start || t > range.end) return;
      const cur = m.get(s.partId) || { partId: s.partId, name: s.name || '', units: 0, revenue: 0 };
      cur.units += s.qty ?? s.quantity ?? 0; cur.revenue += s.revenue ?? s.total ?? 0;
      m.set(s.partId, cur);
    });
    return [...m.values()].sort((a, b) => b.units - a.units).slice(0, 5);
  }, [sales, range]);

  // --- Top suppliers (real: linked parts + purchase value of their stock) ---
  const topSuppliers = useMemo(() => suppliers.map((s) => {
    const linked = active.filter((p) => (p.suppliers || []).some((sp) => sp.id === s.id || sp.name === s.name));
    const value = linked.reduce((sum, p) => sum + (p.purchasePrice || 0) * (p.stock || 0), 0);
    return { id: s.id, name: s.name, count: linked.length, value };
  }).filter((s) => s.count > 0).sort((a, b) => b.value - a.value).slice(0, 5), [suppliers, active]);

  const totalRecords = inventory.length + suppliers.length + sales.length + restocks.length + auditLog.length;
  const fmt = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
  const ago = (d) => {
    if (!d) return '—';
    const m = Math.floor((Date.now() - d.getTime()) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} hr ago`;
    return d.toLocaleDateString('en-IN');
  };

  const Trend = ({ pct }) => (
    <span className={`text-[11px] font-semibold ${pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{pct >= 0 ? '▲' : '▼'} {Math.abs(pct)}% vs prev</span>
  );

  const invHealth = useMemo(() => computeInventoryHealth(inventory), [inventory]);
  const workshop = useMemo(() => computeWorkshopScore({ inventory, sales, suppliers, alertsCount: health.out + health.low, invHealthScore: invHealth.score }), [inventory, sales, suppliers, health, invHealth]);
  const insights = useMemo(() => computeInsights({ inventory, sales, suppliers, purchaseOrders, restocks }), [inventory, sales, suppliers, purchaseOrders, restocks]);
  const achievements = useMemo(() => computeAchievements({ inventory, sales, suppliers, purchaseOrders, restocks }), [inventory, sales, suppliers, purchaseOrders, restocks]);

  return (
    <div className="space-y-4">
      {/* Dashboard header with the date-range controller */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between pb-1">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2.5">
            <span className="flex items-center justify-center w-8 h-8 rounded-xl flex-shrink-0" style={{ background: 'rgba(212,175,55,0.12)' }}><LayoutDashboard size={17} className="text-[#d4af37]" /></span>
            Dashboard
          </h2>
          <p className="text-xs text-white/45 mt-1 ml-0.5">Viewing <span className="text-[#d4af37] font-semibold">{range.label}</span></p>
        </div>
        <DateRangeControl value={dateRange} onChange={setDateRange} custom={customRange} onCustomChange={setCustomRange} label={range.label} />
      </div>

      {/* Inventory Health + Workshop Score */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ScoreCard title="Inventory Health" icon={ShieldCheck} score={invHealth.score} factors={invHealth.factors} />
        <ScoreCard title="Workshop Score" icon={Star} score={workshop.score} suffix="/100" factors={workshop.factors} note="Weighted: inventory health 40%, sales activity 25%, supplier performance 20%, alert pressure 15%." />
      </div>

      {/* AI Insights + Achievements */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl p-4 backdrop-blur-sm" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
          <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2"><Sparkles size={14} className="text-[#d4af37]" /> Insights</h3>
          {insights.length ? (
            <div className="space-y-2">
              {insights.map((it, i) => (
                <div key={i} className="flex items-center gap-2.5 text-sm text-white/80">
                  <Check size={15} className="text-emerald-400 flex-shrink-0" /> {it.text}
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-white/35 py-4">No insights yet — add parts and record sales to see trends here.</p>}
        </div>
        <div className="rounded-2xl p-4 backdrop-blur-sm" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
          <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2"><Trophy size={14} className="text-[#d4af37]" /> Workshop Progress</h3>
          <div className="space-y-2">
            {achievements.map((a) => (
              <div key={a.label} className="flex items-center gap-2.5 text-sm" style={{ color: a.done ? 'rgba(var(--fg-rgb),0.85)' : 'rgba(var(--fg-rgb),0.35)' }}>
                {a.done ? <Check size={15} className="text-emerald-400 flex-shrink-0" /> : <span className="w-[15px] h-[15px] rounded-full border border-white/25 flex-shrink-0" />}
                {a.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Overview (date-range driven) + Inventory Health (live) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <OverviewCard className="lg:col-span-2">
          <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2"><TrendingUp size={14} className="text-[#d4af37]" /> Overview · {range.label}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <p className="text-[11px] text-white/40">Revenue</p>
              <p className="text-xl font-bold text-white">{fmt(periodAgg.rev)}</p>
              <Trend pct={trendPct(periodAgg.rev, periodAgg.pRev)} />
            </div>
            <div>
              <p className="text-[11px] text-white/40">Profit</p>
              <p className="text-xl font-bold text-emerald-400">{fmt(periodAgg.pro)}</p>
              <Trend pct={trendPct(periodAgg.pro, periodAgg.pPro)} />
            </div>
            <div>
              <p className="text-[11px] text-white/40">Sales</p>
              <p className="text-xl font-bold text-white">{periodAgg.cnt}</p>
              <Trend pct={trendPct(periodAgg.cnt, periodAgg.pCnt)} />
            </div>
            <div>
              <p className="text-[11px] text-white/40">Avg order</p>
              <p className="text-xl font-bold text-white">{fmt(periodAgg.cnt ? periodAgg.rev / periodAgg.cnt : 0)}</p>
              <p className="text-[11px] text-white/40">per sale</p>
            </div>
          </div>
          {periodAgg.cnt === 0 && <p className="text-[11px] text-white/30 mt-3">No sales in this period.</p>}
        </OverviewCard>

        <OverviewCard>
          <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2"><ShieldCheck size={14} className="text-[#d4af37]" /> Inventory Health</h3>
          <div className="flex items-center gap-4">
            <div className="relative w-20 h-20 flex-shrink-0">
              <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(var(--fg-rgb),0.08)" strokeWidth="3" />
                <circle cx="18" cy="18" r="15.9" fill="none" stroke={health.pct >= 70 ? '#34d399' : health.pct >= 40 ? '#d4af37' : '#ef4444'} strokeWidth="3" strokeDasharray={`${health.pct} ${100 - health.pct}`} strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-bold text-white">{health.pct}%</span>
              </div>
            </div>
            <div className="flex-1 space-y-1.5 text-sm">
              <div className="flex items-center justify-between"><span className="text-white/50">Low Stock</span><span className="font-bold text-[#d4af37]">{health.low}</span></div>
              <div className="flex items-center justify-between"><span className="text-white/50">Out of Stock</span><span className="font-bold text-red-400">{health.out}</span></div>
              <div className="flex items-center justify-between"><span className="text-white/50">Total Parts</span><span className="font-bold text-white">{health.total}</span></div>
            </div>
          </div>
        </OverviewCard>
      </div>

      {/* Reorder Center + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <OverviewCard className="lg:col-span-2">
          <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2"><ShoppingCart size={14} className="text-[#d4af37]" /> Reorder Center</h3>
          {reorder.length === 0 ? (
            <p className="text-sm text-white/40 py-6 text-center">Nothing needs reordering — all parts above minimum stock. 🎉</p>
          ) : (
            <div className="space-y-1">
              <div className="hidden sm:grid grid-cols-12 gap-2 px-2 pb-1 text-[10px] uppercase tracking-wider text-white/30">
                <span className="col-span-4">Part</span><span className="col-span-1 text-center">Stock</span><span className="col-span-1 text-center">Min</span><span className="col-span-1 text-center">Need</span><span className="col-span-2">Supplier</span><span className="col-span-1 text-right">Cost</span><span className="col-span-2 text-right">Action</span>
              </div>
              {reorder.slice(0, 6).map(({ p, need, supplier, cost }) => (
                <div key={p.id} className="grid grid-cols-12 gap-2 items-center px-2 py-1.5 rounded-lg hover:bg-white/[0.04]">
                  <button onClick={() => onEditPart(p)} className="col-span-12 sm:col-span-4 flex items-center gap-2 text-left min-w-0">
                    <PartImageThumb src={p.imageString} alt={p.name} />
                    <span className="min-w-0"><span className="block text-sm text-white truncate">{p.name}</span><span className="block text-[10px] text-white/35">{p.sku || '—'}</span></span>
                  </button>
                  <span className="col-span-1 text-center text-sm font-bold text-red-400">{p.stock || 0}</span>
                  <span className="hidden sm:block col-span-1 text-center text-sm text-white/50">{p.minStock || 5}</span>
                  <span className="hidden sm:block col-span-1 text-center text-sm font-bold text-[#d4af37]">{need}</span>
                  <span className="hidden sm:block col-span-2 text-xs text-white/60 truncate">{supplier}</span>
                  <span className="hidden sm:block col-span-1 text-right text-xs text-white/70">{fmt(cost)}</span>
                  <div className="col-span-12 sm:col-span-2 flex justify-end">
                    <button onClick={() => onReorder(p)} className="px-3 py-1 rounded-lg text-[11px] font-bold bg-[#d4af37]/15 text-[#d4af37] border border-[#d4af37]/30 hover:bg-[#d4af37]/25">Order</button>
                  </div>
                </div>
              ))}
              {reorder.length > 6 && (
                <button onClick={() => onNavigate('inventory', { lowStock: true })} className="w-full mt-2 py-2 text-xs font-semibold text-[#d4af37] hover:underline">View all {reorder.length} reorder items →</button>
              )}
            </div>
          )}
        </OverviewCard>

        <OverviewCard>
          <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2"><Zap size={14} className="text-[#d4af37]" /> Quick Actions</h3>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Add Part', icon: Plus, onClick: onAddPart },
              { label: 'Add Supplier', icon: Users, onClick: onAddSupplier },
              { label: 'Receive Stock', icon: PackagePlus, onClick: onQuickReceive },
              { label: 'Record Sale', icon: ShoppingCart, onClick: onQuickSell },
              { label: 'Import', icon: Upload, onClick: onImport, full: true },
            ].map((a) => (
              <button key={a.label} onClick={a.onClick} className={`${a.full ? 'col-span-2' : ''} flex flex-col items-center justify-center gap-1.5 py-4 rounded-xl bg-white/[0.03] border border-white/8 hover:border-[#d4af37]/40 hover:bg-[#d4af37]/[0.06] transition`}>
                <a.icon size={18} className="text-[#d4af37]" />
                <span className="text-[11px] font-semibold text-white/80">{a.label}</span>
              </button>
            ))}
          </div>
        </OverviewCard>
      </div>

      {/* Pending Supplier Actions — real reorder requests, status-tracked */}
      <OverviewCard>
        <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2"><Send size={14} className="text-[#d4af37]" /> Pending Supplier Actions</h3>
        {(() => {
          const pending = reorderRequests.filter((r) => r.status !== 'Delivered');
          if (pending.length === 0) return <p className="text-sm text-white/40 py-4 text-center">No pending supplier requests. Use “Order” in the Reorder Center to start one.</p>;
          const statusColor = { 'Requested': '#d4af37', 'Awaiting Delivery': '#60a5fa', 'Delivered': '#34d399' };
          return (
            <div className="space-y-1">
              <div className="hidden sm:grid grid-cols-12 gap-2 px-2 pb-1 text-[10px] uppercase tracking-wider text-white/30">
                <span className="col-span-3">Supplier</span><span className="col-span-3">Part</span><span className="col-span-1 text-center">Qty</span><span className="col-span-2">Requested</span><span className="col-span-3 text-right">Status / Action</span>
              </div>
              {pending.map((r) => {
                const d = tsToDate(r.createdAt);
                return (
                  <div key={r.id} className="grid grid-cols-12 gap-2 items-center px-2 py-1.5 rounded-lg hover:bg-white/[0.04]">
                    <span className="col-span-6 sm:col-span-3 text-sm text-white/85 truncate">{r.supplierName}</span>
                    <span className="col-span-6 sm:col-span-3 text-sm text-white/60 truncate">{r.partName}</span>
                    <span className="hidden sm:block col-span-1 text-center text-sm text-[#d4af37] font-bold">{r.qty}</span>
                    <span className="hidden sm:block col-span-2 text-[11px] text-white/40">{d ? d.toLocaleDateString('en-IN') : '—'}</span>
                    <div className="col-span-12 sm:col-span-3 flex items-center justify-end gap-1.5">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${statusColor[r.status]}22`, color: statusColor[r.status] }}>{r.status}</span>
                      {r.status !== 'Delivered' && (
                        <button onClick={() => onAdvanceStatus(r)} className="text-[10px] font-semibold px-2 py-0.5 rounded bg-white/8 text-white/70 hover:bg-white/15" title="Advance status">
                          {r.status === 'Requested' ? '→ Awaiting' : '→ Delivered'}
                        </button>
                      )}
                      {canDestroy && (<button onClick={() => onClearRequest(r)} className="text-white/30 hover:text-red-400" title="Remove request"><Trash2 size={12} /></button>)}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </OverviewCard>

      {/* Low Stock + Recent Activity + Top Selling */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <OverviewCard>
          <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2"><AlertTriangle size={14} className="text-[#d4af37]" /> Low Stock Alerts</h3>
          {lowStock.length === 0 ? (
            <p className="text-sm text-white/40 py-4 text-center">No low-stock parts.</p>
          ) : (
            <div className="space-y-1">
              {lowStock.slice(0, 5).map((p) => (
                <button key={p.id} onClick={() => onEditPart(p)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] text-left">
                  <PartImageThumb src={p.imageString} alt={p.name} />
                  <span className="min-w-0 flex-1"><span className="block text-sm text-white truncate">{p.name}</span><span className="block text-[10px] text-white/35">{p.sku || '—'}</span></span>
                  <span className="text-xs text-white/50">{p.stock}/{p.minStock || 5}</span>
                  <span className="text-[10px] font-bold text-red-400">Low</span>
                </button>
              ))}
            </div>
          )}
        </OverviewCard>

        <OverviewCard>
          <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2"><History size={14} className="text-[#d4af37]" /> Recent Activity</h3>
          {recent.length === 0 ? (
            <p className="text-sm text-white/40 py-4 text-center">No activity yet.</p>
          ) : (
            <div className="space-y-2">
              {recent.map((r) => (
                <div key={r.id} className="flex items-center gap-2 text-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#d4af37] flex-shrink-0" />
                  <span className="flex-1 min-w-0 truncate text-white/80">{r.label}{r.name ? <span className="text-white/40"> · {r.name}</span> : ''}</span>
                  <span className="text-[10px] text-white/30 flex-shrink-0">{ago(r.when)}</span>
                </div>
              ))}
            </div>
          )}
        </OverviewCard>

        <OverviewCard>
          <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2"><Star size={14} className="text-[#d4af37]" /> Top Selling · {range.label}</h3>
          {topSelling.length === 0 ? (
            <p className="text-sm text-white/40 py-4 text-center">No sales recorded yet.</p>
          ) : (
            <div className="space-y-1.5">
              {topSelling.map((t) => (
                <div key={t.partId} className="flex items-center justify-between text-sm">
                  <span className="min-w-0 truncate text-white/85">{t.name}</span>
                  <span className="flex-shrink-0 text-right"><span className="text-white font-semibold">{t.units}</span> <span className="text-white/30 text-[11px]">· {fmt(t.revenue)}</span></span>
                </div>
              ))}
            </div>
          )}
        </OverviewCard>
      </div>

      {/* Top Suppliers (System Status lives in the sidebar + Settings — not repeated here) */}
      <div className="grid grid-cols-1 gap-4">
        <OverviewCard>
          <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2"><Users size={14} className="text-[#d4af37]" /> Top Suppliers</h3>
          {topSuppliers.length === 0 ? (
            <p className="text-sm text-white/40 py-4 text-center">No suppliers linked to parts yet.</p>
          ) : (
            <div className="space-y-1">
              <div className="hidden sm:grid grid-cols-12 gap-2 px-2 pb-1 text-[10px] uppercase tracking-wider text-white/30">
                <span className="col-span-6">Supplier</span><span className="col-span-3 text-center">Parts Supplied</span><span className="col-span-3 text-right">Stock Value</span>
              </div>
              {topSuppliers.map((s) => (
                <div key={s.id} className="grid grid-cols-12 gap-2 items-center px-2 py-1.5 rounded-lg hover:bg-white/[0.04]">
                  <span className="col-span-6 text-sm text-white/85 truncate">{s.name}</span>
                  <span className="col-span-3 text-center text-sm text-white/60">{s.count}</span>
                  <span className="col-span-3 text-right text-sm font-semibold text-[#d4af37]">{fmt(s.value)}</span>
                </div>
              ))}
            </div>
          )}
        </OverviewCard>
      </div>
    </div>
  );
}

// Phase 8.4 — Global command palette (Ctrl+K). Searches parts, suppliers,
// categories & vehicles from existing data; arrow keys + Enter to navigate.
function CommandPalette({ open, onClose, inventory, suppliers, customers = [], invoices = [], jobCards = [],
  onPickPart, onPickSupplier, onPickCategory, onPickVehicle, onPickCustomer, onPickInvoice, onPickJobCard }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  useEffect(() => { if (open) { setQ(''); setSel(0); } }, [open]);

  const results = useMemo(() => {
    const needle = safeLower(q.trim());
    const out = [];
    const active = inventory.filter((p) => !p.archived);
    active.forEach((p) => {
      if (!needle || safeLower(p.name).includes(needle) || safeLower(p.sku).includes(needle)) {
        out.push({ type: 'part', id: p.id, label: p.name, sub: `Part · ${p.sku || 'no SKU'} · ${p.stock ?? 0} in stock`, data: p });
      }
    });
    suppliers.forEach((s) => {
      if (!needle || safeLower(s.name).includes(needle)) out.push({ type: 'supplier', id: s.id, label: s.name, sub: 'Supplier', data: s });
    });

    // Operational records. The palette previously searched only the CATALOGUE
    // (parts/suppliers/categories) — but the person on the phone is a customer quoting a
    // number plate or an invoice number, and the receptionist had nowhere to type it.
    // Only search these once something is typed, so the palette doesn't open showing
    // 1,000 customers.
    if (needle) {
      customers.forEach((c) => {
        const regs = (c.vehicles || []).map((v) => v.regNo || v.reg).filter(Boolean);
        const hay = safeLower([c.name, c.phone, c.code, ...regs].filter(Boolean).join(' '));
        if (hay.includes(needle)) {
          out.push({ type: 'customer', id: c.id, label: c.name,
            sub: `Customer · ${[c.phone, regs.join(', ')].filter(Boolean).join(' · ')}`, data: c });
        }
      });
      invoices.forEach((iv) => {
        const hay = safeLower([iv.invNo, iv.customer, iv.regNo, iv.vehicle].filter(Boolean).join(' '));
        if (hay.includes(needle)) {
          out.push({ type: 'invoice', id: iv.id, label: iv.invNo || 'Invoice',
            sub: `Invoice · ${[iv.customer, iv.regNo].filter(Boolean).join(' · ')}`, data: iv });
        }
      });
      jobCards.forEach((j) => {
        const hay = safeLower([j.jobNo, j.customer, j.regNo, j.vehicle, j.status].filter(Boolean).join(' '));
        if (hay.includes(needle)) {
          out.push({ type: 'jobcard', id: j.jobNo, label: j.jobNo || 'Job card',
            sub: `Job card · ${[j.regNo, j.customer, j.status].filter(Boolean).join(' · ')}`, data: j });
        }
      });
    }
    const cats = new Set();
    active.forEach((p) => asList(p.categories).concat(p.category || []).forEach((c) => { if (c) cats.add(c); }));
    [...cats].forEach((c) => { if (!needle || safeLower(c).includes(needle)) out.push({ type: 'category', id: `c-${c}`, label: c, sub: 'Category', data: c }); });
    const vehs = new Set();
    active.forEach((p) => flattenVehicles(p.compatibleCars).forEach((v) => { if (v) vehs.add(v); }));
    [...vehs].forEach((v) => { if (!needle || safeLower(v).includes(needle)) out.push({ type: 'vehicle', id: `v-${v}`, label: v, sub: 'Vehicle', data: v }); });
    return out.slice(0, 30);
  }, [q, inventory, suppliers]);

  const pick = (r) => {
    if (!r) return;
    if (r.type === 'part') onPickPart(r.data);
    else if (r.type === 'supplier') onPickSupplier(r.data);
    else if (r.type === 'category') onPickCategory(r.data);
    else if (r.type === 'vehicle') onPickVehicle(r.data);
    else if (r.type === 'customer') onPickCustomer?.(r.data);
    else if (r.type === 'invoice') onPickInvoice?.(r.data);
    else if (r.type === 'jobcard') onPickJobCard?.(r.data);
    onClose();
  };

  if (!open) return null;
  const icon = { part: Package, supplier: Users, category: Filter, vehicle: Car };
  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center pt-[12vh] px-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div className="w-full max-w-xl rounded-2xl overflow-hidden shadow-2xl" style={{ background: 'var(--surface-2)', border: '1px solid rgba(212,175,55,0.3)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8">
          <Search size={16} className="text-white/40" />
          <input
            autoFocus
            value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); pick(results[sel]); }
              else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            }}
            placeholder="Search parts, suppliers, categories, vehicles…"
            className="flex-1 bg-transparent outline-none text-sm text-white placeholder-white/30"
          />
          <kbd className="text-[10px] text-white/30 border border-white/15 rounded px-1.5 py-0.5">ESC</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 ? (
            <p className="text-sm text-white/35 text-center py-8">No matches.</p>
          ) : results.map((r, i) => {
            const Ic = icon[r.type];
            return (
              <button
                key={r.id}
                onMouseEnter={() => setSel(i)}
                onClick={() => pick(r)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left ${i === sel ? 'bg-[#d4af37]/12' : 'hover:bg-white/[0.04]'}`}
              >
                <Ic size={15} className={i === sel ? 'text-[#d4af37]' : 'text-white/40'} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-white truncate">{r.label}</span>
                  <span className="block text-[11px] text-white/35">{r.sub}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="px-4 py-2 border-t border-white/8 flex items-center gap-3 text-[10px] text-white/30">
          <span>↑↓ navigate</span><span>↵ open</span><span>esc close</span>
        </div>
      </div>

      <p className="text-center text-[11px] text-white/30 pt-1 pb-2">
        Press <kbd className="px-1.5 py-0.5 rounded bg-white/10 border border-white/15 text-white/60 font-mono">Ctrl</kbd> + <kbd className="px-1.5 py-0.5 rounded bg-white/10 border border-white/15 text-white/60 font-mono">K</kbd> to search anything
      </p>
    </div>
  );
}

// ===========================================================================
// Phase 8.5 — dedicated pages. All read REAL data; honest empty states.
// ===========================================================================
function PageShell({ title, icon: Icon, children, action }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 pb-3" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>
        <h2 className="text-lg font-bold text-white flex items-center gap-2.5">
          <span className="flex items-center justify-center w-8 h-8 rounded-xl flex-shrink-0" style={{ background: 'rgba(212,175,55,0.12)' }}><Icon size={17} className="text-[#d4af37]" /></span>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </div>
  );
}
function LedgerRow({ left, mid, right, sub }) {
  return (
    <div className="group flex items-center gap-3 px-3.5 py-3 rounded-xl transition hover:bg-white/[0.05]" style={{ background: 'rgba(var(--fg-rgb),0.025)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
      <div className="min-w-0 flex-1"><p className="text-sm text-white/90 font-medium truncate">{left}</p>{sub && <p className="text-[11px] text-white/35 mt-0.5">{sub}</p>}</div>
      {mid && <span className="text-xs text-white/50 flex-shrink-0">{mid}</span>}
      <span className="text-sm font-semibold flex-shrink-0">{right}</span>
      <ChevronRight size={15} className="text-white/15 group-hover:text-white/45 transition flex-shrink-0" />
    </div>
  );
}
const inr = (n) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
function StatStrip({ cards }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="rounded-2xl p-3.5 backdrop-blur-sm transition hover:bg-white/[0.05]" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
          <div className="flex items-center gap-2 mb-1.5">
            {c.icon && <span className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(212,175,55,0.12)' }}><c.icon size={13} className="text-[#d4af37]" /></span>}
            <span className="text-[10px] uppercase tracking-wider text-white/40 leading-tight">{c.label}</span>
          </div>
          <p className="text-xl font-bold" style={{ color: c.color || '#fff' }}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}
const dstr = (ts) => { const d = tsToDate(ts); return d ? d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; };

// Reusable ledger page: search + date range + type filter + sort + pagination
// (25/page) + CSV export of the filtered set + a detail drawer. Items are
// pre-normalized: { id, t(ms), s(searchText), ty(type), qty, amount, row, detail }.
function LedgerPage({ title, icon, cards, items, typeOptions, sortOptions, csvName, csvHeader }) {
  const [q, setQ] = useState('');
  const [range, setRange] = useState('all');
  const [type, setType] = useState('all');
  const [sort, setSort] = useState((sortOptions && sortOptions[0]) || 'Newest');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);
  const [perPage, setPerPage] = useState(25);
  const PER = perPage;
  const Icon = icon;
  useEffect(() => { setPage(1); }, [q, range, type, sort, perPage]);
  const filtered = useMemo(() => {
    const needle = safeLower(q.trim());
    const now = Date.now(), day = 86400000;
    const yStart = new Date(); yStart.setHours(0, 0, 0, 0);
    let arr = items.filter((it) => {
      if (needle && !safeLower(it.s).includes(needle)) return false;
      if (type !== 'all' && it.ty !== type) return false;
      if (range === 'today' && (now - it.t > day || it.t < yStart.getTime())) return false;
      if (range === 'yesterday' && (it.t >= yStart.getTime() || it.t < yStart.getTime() - day)) return false;
      if (range === '7d' && now - it.t > 7 * day) return false;
      if (range === '30d' && now - it.t > 30 * day) return false;
      return true;
    });
    arr = [...arr].sort((a, b) => {
      if (sort === 'Oldest') return a.t - b.t;
      if (sort === 'Largest Qty') return Math.abs(b.qty || 0) - Math.abs(a.qty || 0);
      if (sort === 'Highest Revenue' || sort === 'Highest Amount' || sort === 'Highest Profit') return (b.amount || 0) - (a.amount || 0);
      return b.t - a.t;
    });
    return arr;
  }, [items, q, range, type, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / PER));
  const shown = filtered.slice((page - 1) * PER, page * PER);
  const exportCsv = () => {
    if (filtered.length === 0) { toast.error('Nothing to export with the current filters.'); return; }
    const rows = filtered.map((it) => it.detail);
    const head = csvHeader || Object.keys(rows[0]);
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [head.join(','), ...rows.map((r) => head.map((h) => esc(r[h])).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${csvName}_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} rows.`);
  };
  const fld = 'px-2.5 py-2 rounded-lg text-xs outline-none bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60';
  return (
    <PageShell title={title} icon={icon} action={<button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#d4af37] bg-[#d4af37]/10 border border-[#d4af37]/30 hover:bg-[#d4af37]/20"><Download size={14} /> Export</button>}>
      {cards && <StatStrip cards={cards} />}
      <div className="flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className={`${fld} flex-1 min-w-[140px]`} />
        <select value={range} onChange={(e) => setRange(e.target.value)} className={fld}>
          <option value="all" className="bg-[#111]">All time</option>
          <option value="today" className="bg-[#111]">Today</option>
          <option value="yesterday" className="bg-[#111]">Yesterday</option>
          <option value="7d" className="bg-[#111]">Last 7 days</option>
          <option value="30d" className="bg-[#111]">Last 30 days</option>
        </select>
        {typeOptions && (
          <select value={type} onChange={(e) => setType(e.target.value)} className={fld}>
            <option value="all" className="bg-[#111]">All types</option>
            {typeOptions.map((t) => <option key={t} value={t} className="bg-[#111]">{t}</option>)}
          </select>
        )}
        {sortOptions && (
          <select value={sort} onChange={(e) => setSort(e.target.value)} className={fld}>
            {sortOptions.map((s) => <option key={s} value={s} className="bg-[#111]">{s}</option>)}
          </select>
        )}
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-white/40 py-8 text-center">No records match your filters.</p>
      ) : (
        <>
          <p className="text-[11px] text-white/35">Showing {shown.length} of {filtered.length}</p>
          <div className="space-y-1.5">
            {shown.map((it) => <button key={it.id} onClick={() => setDetail(it)} className="w-full text-left">{it.row}</button>)}
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-3">
            <div className="flex items-center gap-2 text-xs text-white/40">
              <span>Rows:</span>
              <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))} className="bg-white/5 border border-white/15 rounded-lg px-2 py-1 text-white/80 focus:outline-none focus:border-[#d4af37]/50">
                {[10, 25, 50, 100].map((n) => <option key={n} value={n} style={{ background: 'var(--surface-2)' }}>{n}</option>)}
              </select>
              <span className="ml-1">{filtered.length === 0 ? 0 : (page - 1) * PER + 1}–{Math.min(page * PER, filtered.length)} of {filtered.length}</span>
            </div>
            {pages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-white/70 disabled:opacity-30">Previous</button>
                <span className="text-xs text-white/50">Page {page} / {pages}</span>
                <button disabled={page === pages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-white/70 disabled:opacity-30">Next</button>
              </div>
            )}
          </div>
        </>
      )}
      {detail && (
        <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }} onClick={() => setDetail(null)}>
          <div className="w-full sm:max-w-lg max-h-[88vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 flex items-center justify-between px-6 py-4" style={{ background: 'var(--surface-1)', borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
              <h3 className="text-base font-bold text-white flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(212,175,55,0.12)' }}>{Icon ? <Icon size={16} className="text-[#d4af37]" /> : null}</span>
                {title} detail
              </h3>
              <button onClick={() => setDetail(null)} className="w-9 h-9 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10 transition"><X size={18} /></button>
            </div>
            <div className="px-6 py-4">
              {Object.entries(detail.detail).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-2.5 text-sm" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.05)' }}>
                  <span className="text-white/45 flex-shrink-0">{k}</span>
                  <span className="text-white/90 text-right font-medium break-words">{String(v ?? '—')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}

function SalesView({ sales }) {
  const catOf = (s) => s.revenueType || s.category || (s.partId ? 'Parts' : 'Service');
  // SALES = inventory parts only (spec). Labour/services live in the Services tab.
  const partSales = useMemo(() => sales.filter((s) => catOf(s) === 'Parts' || catOf(s) === 'Outside Purchase'), [sales]);
  const cards = useMemo(() => {
    const now = new Date();
    let revT = 0, proT = 0, revM = 0, proM = 0, partsM = 0, outsideM = 0, unitsM = 0;
    partSales.forEach((s) => {
      const d = tsToDate(s.createdAt); if (!d) return;
      const rev = s.revenue || 0; const cat = catOf(s);
      if (isSameDay(d, now)) { revT += rev; proT += s.profit || 0; }
      if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
        revM += rev; proM += s.profit || 0; unitsM += s.qty || 0;
        if (cat === 'Parts') partsM += rev; else outsideM += rev;
      }
    });
    const avgMargin = revM > 0 ? (proM / revM) * 100 : 0;
    return [
      { label: 'Parts Revenue (Month)', value: inr(partsM), icon: TrendingUp, color: '#60a5fa' },
      { label: 'Outside Purchase (Month)', value: inr(outsideM), color: '#fbbf24' },
      { label: 'Parts Profit (Month)', value: inr(proM), color: '#34d399' },
      { label: 'Avg Margin', value: `${avgMargin.toFixed(1)}%`, color: '#22d3ee' },
      { label: 'Units Sold (Month)', value: unitsM.toLocaleString('en-IN'), color: '#a78bfa' },
      { label: 'Revenue Today', value: inr(revT), color: '#d4af37' },
    ];
  }, [partSales]);
  const catColor = (c) => ({ Parts: '#60a5fa', 'Outside Purchase': '#fbbf24' }[c] || '#9ca3af');
  const items = useMemo(() => partSales.map((s) => {
    const d = tsToDate(s.createdAt);
    const cat = catOf(s);
    return {
      id: s.id, t: d?.getTime() || 0,
      s: `${s.name} ${s.sku || ''} ${cat} ${s.customer || ''} ${s.vehicle || ''} ${s.invoiceNo || ''} ${s.soldByEmail || ''}`,
      ty: cat, qty: s.qty, amount: s.revenue || 0,
      row: <LedgerRow left={<span className="flex items-center gap-2">{s.name}{s.sku ? <span className="text-[9px] text-white/35">{s.sku}</span> : null}<span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${catColor(cat)}1f`, color: catColor(cat) }}>{cat}</span></span>} sub={`${dstr(s.createdAt)}${s.invoiceNo ? ` \u00b7 ${s.invoiceNo}` : ''}${s.customer ? ` \u00b7 ${s.customer}` : ''}`} mid={`${s.qty} \u00d7 ${inr(s.unitPrice)}`} right={<span className="text-emerald-400">{inr(s.revenue)}</span>} />,
      detail: {
        Category: cat, Part: s.name, SKU: s.sku || '\u2014', Invoice: s.invoiceNo || '\u2014',
        Customer: s.customer || '\u2014', Vehicle: s.vehicle ? `${s.vehicle}${s.regNo ? ` (${s.regNo})` : ''}` : '\u2014',
        Quantity: s.qty,
        'Catalogue Price': s.listPrice ? inr(s.listPrice) : '\u2014',
        'Sold Price': inr(s.unitPrice),
        'Extra Charged': s.extraRevenue ? `${s.extraRevenue > 0 ? '+' : ''}${inr(s.extraRevenue)}` : '\u2014',
        'Cost Price': inr(s.unitCost || 0),
        Revenue: inr(s.revenue), Profit: inr(s.profit),
        Margin: `${(s.margin != null ? s.margin : (s.revenue > 0 ? (s.profit / s.revenue) * 100 : 0)).toFixed(1)}%`,
        GST: s.gst ? `${s.gst}%` : '\u2014', Discount: s.discount ? `${s.discount}%` : '\u2014',
        Payment: s.payModes || '\u2014', Outstanding: s.outstanding != null ? inr(s.outstanding) : '\u2014',
        Technician: s.technician || '\u2014', Date: dstr(s.createdAt),
      },
    };
  }), [partSales]);
  return <LedgerPage title="Parts Sales" icon={ShoppingCart} cards={cards} items={items}
    typeOptions={['Parts', 'Outside Purchase']}
    sortOptions={['Newest', 'Oldest', 'Highest Revenue', 'Highest Profit']}
    csvName="Parts-Sales"
    csvHeader={['Category', 'Part', 'SKU', 'Invoice', 'Customer', 'Vehicle', 'Quantity', 'Catalogue Price', 'Sold Price', 'Extra Charged', 'Cost Price', 'Revenue', 'Profit', 'Margin', 'GST', 'Discount', 'Payment', 'Outstanding', 'Technician', 'Date']} />;
}

function ServicesView({ sales }) {
  const catOf = (s) => s.revenueType || s.category || (s.partId ? 'Parts' : 'Service');
  // SERVICES = labour / service revenue only. No inventory, no COGS.
  const svc = useMemo(() => sales.filter((s) => catOf(s) === 'Service' || catOf(s) === 'Labour'), [sales]);
  const cards = useMemo(() => {
    const now = new Date();
    let revT = 0, revM = 0, labourM = 0, serviceM = 0, jobsM = 0;
    const techSet = new Set();
    svc.forEach((s) => {
      const d = tsToDate(s.createdAt); if (!d) return;
      const rev = s.revenue || 0; const cat = catOf(s);
      if (isSameDay(d, now)) { revT += rev; }
      if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
        revM += rev; jobsM += 1; if (s.technician) techSet.add(s.technician);
        if (cat === 'Labour') labourM += rev; else serviceM += rev;
      }
    });
    return [
      { label: 'Service Revenue (Month)', value: inr(serviceM), icon: Wrench, color: '#a78bfa' },
      { label: 'Labour Revenue (Month)', value: inr(labourM), color: '#f472b6' },
      { label: 'Total Service Income', value: inr(revM), color: '#d4af37' },
      { label: 'Jobs (Month)', value: jobsM.toLocaleString('en-IN'), color: '#34d399' },
      { label: 'Technicians Active', value: String(techSet.size), color: '#22d3ee' },
      { label: 'Revenue Today', value: inr(revT), color: '#60a5fa' },
    ];
  }, [svc]);
  const catColor = (c) => ({ Labour: '#f472b6', Service: '#a78bfa' }[c] || '#9ca3af');
  const items = useMemo(() => svc.map((s) => {
    const d = tsToDate(s.createdAt);
    const cat = catOf(s);
    return {
      id: s.id, t: d?.getTime() || 0,
      s: `${s.name} ${cat} ${s.technician || ''} ${s.customer || ''} ${s.vehicle || ''} ${s.invoiceNo || ''}`,
      ty: cat, qty: s.qty, amount: s.revenue || 0,
      row: <LedgerRow left={<span className="flex items-center gap-2">{s.name}<span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${catColor(cat)}1f`, color: catColor(cat) }}>{cat}</span></span>} sub={`${dstr(s.createdAt)}${s.invoiceNo ? ` \u00b7 ${s.invoiceNo}` : ''}${s.customer ? ` \u00b7 ${s.customer}` : ''}${s.technician ? ` \u00b7 ${s.technician}` : ''}`} mid={`${s.hours || s.qty || 1} \u00d7 ${inr(s.unitPrice)}`} right={<span className="text-emerald-400">{inr(s.revenue)}</span>} />,
      detail: {
        Category: cat, Service: s.name, Invoice: s.invoiceNo || '\u2014', Customer: s.customer || '\u2014',
        Vehicle: s.vehicle ? `${s.vehicle}${s.regNo ? ` (${s.regNo})` : ''}` : '\u2014', Technician: s.technician || '\u2014',
        Hours: s.hours || s.qty || 1, Rate: inr(s.unitPrice), Discount: s.discount ? `${s.discount}%` : '\u2014',
        GST: s.gst ? `${s.gst}%` : '\u2014', 'Service Revenue': inr(s.revenue), Profit: inr(s.profit),
        Payment: s.payModes || '\u2014', Status: s.outstanding > 0 ? 'Outstanding' : 'Collected', Date: dstr(s.createdAt),
      },
    };
  }), [svc]);
  return <LedgerPage title="Service & Labour Income" icon={Wrench} cards={cards} items={items}
    typeOptions={['Service', 'Labour']}
    sortOptions={['Newest', 'Oldest', 'Highest Revenue']}
    csvName="Service-Revenue"
    csvHeader={['Category', 'Service', 'Invoice', 'Customer', 'Vehicle', 'Technician', 'Hours', 'Rate', 'Discount', 'GST', 'Service Revenue', 'Profit', 'Payment', 'Status', 'Date']} />;
}

function StockInView({ restocks }) {
  const cards = useMemo(() => {
    const now = new Date();
    let receiptsT = 0, unitsT = 0, costT = 0;
    restocks.forEach((r) => { const d = tsToDate(r.createdAt); if (isSameDay(d, now)) { receiptsT += 1; unitsT += r.qty || 0; costT += (r.unitCost || 0) * (r.qty || 0); } });
    return [
      { label: 'Receipts Today', value: receiptsT, icon: PackagePlus },
      { label: 'Units Received', value: unitsT, color: '#d4af37' },
      { label: 'Purchase Cost', value: inr(costT) },
      { label: 'Total Receipts', value: restocks.length },
    ];
  }, [restocks]);
  const items = useMemo(() => restocks.map((r) => {
    const d = tsToDate(r.createdAt);
    return {
      id: r.id, t: d?.getTime() || 0, s: `${r.name || r.partName} ${r.supplierName || ''} ${r.reference || ''}`, ty: 'Receipt', qty: r.qty, amount: (r.unitCost || 0) * (r.qty || 0),
      row: <LedgerRow left={r.name || r.partName} sub={`${dstr(r.createdAt)} · ${r.supplierName || '—'}${r.reference ? ` · Ref ${r.reference}` : ''}`} mid={r.unitCost ? `@ ${inr(r.unitCost)}` : ''} right={<span className="text-[#d4af37]">+{r.qty}</span>} />,
      detail: { Part: r.name || r.partName, Supplier: r.supplierName || '—', Quantity: r.qty, 'Unit Cost': r.unitCost ? inr(r.unitCost) : '—', Reference: r.reference || '—', 'Received By': r.byEmail || '—', Date: dstr(r.createdAt) },
    };
  }), [restocks]);
  return <LedgerPage title="Stock In — Goods Received" icon={PackagePlus} cards={cards} items={items} sortOptions={['Newest', 'Oldest', 'Largest Qty']} csvName="StockIn" csvHeader={['Part', 'Supplier', 'Quantity', 'Unit Cost', 'Reference', 'Received By', 'Date']} />;
}
function StockOutView({ sales, stockAdjustments }) {
  const cards = useMemo(() => {
    const count = (reason) => stockAdjustments.filter((a) => (a.reason || '') === reason).reduce((s, a) => {
      const d = (a.stockAfter != null && a.stockBefore != null) ? (a.stockAfter - a.stockBefore) : (a.qty || 0);
      return s + (d < 0 ? Math.abs(d) : 0);
    }, 0);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();
    const todayOut = sales.filter((s) => (tsToDate(s.createdAt)?.getTime() || 0) >= todayMs).reduce((s, x) => s + (x.qty || 0), 0)
      + stockAdjustments.filter((a) => { const d = (a.stockAfter != null && a.stockBefore != null) ? (a.stockAfter - a.stockBefore) : (a.qty || 0); return d < 0 && (tsToDate(a.createdAt)?.getTime() || 0) >= todayMs; }).reduce((s, a) => { const d = (a.stockAfter - a.stockBefore) || -(a.qty || 0); return s + Math.abs(d); }, 0);
    return [
      { label: "Today's Stock Out", value: todayOut, icon: Send, color: '#d4af37' },
      { label: 'Customer Sales (units)', value: sales.filter((x) => !!x.partId && (x.revenueType || x.category || 'Parts') === 'Parts').reduce((s, x) => s + (x.qty || 0), 0), icon: ShoppingCart, color: '#34d399' },
      { label: 'Damaged', value: count('Damage'), color: '#ef4444' },
      { label: 'Lost / Theft', value: count('Lost Item') + count('Theft'), color: '#ef4444' },
      { label: 'Returns', value: count('Supplier Return') + count('Branch Transfer'), color: '#60a5fa' },
    ];
  }, [sales, stockAdjustments]);
  const reasonColor = (r) => r === 'Sale' ? '#34d399' : r === 'Damage' || r === 'Lost Item' ? '#ef4444' : '#d4af37';
  const items = useMemo(() => {
    // Stock Out reflects PHYSICAL stock leaving the shelf. Only inventory-linked
    // parts qualify — labour, services and outside purchases never touch stock, so
    // they must not appear here (they'd otherwise show as phantom reductions).
    const isStockMoving = (s) => {
      const cat = s.revenueType || s.category || (s.partId ? 'Parts' : 'Service');
      return !!s.partId && cat === 'Parts';
    };
    const arr = sales.filter(isStockMoving).map((s) => ({ id: 's' + s.id, name: s.name, when: s.createdAt, qty: -(s.qty || 0), reason: 'Sale', by: s.soldByEmail, notes: [s.invoiceNo, s.customer, s.vehicle].filter(Boolean).join(' · ') }))
      .concat(stockAdjustments.filter((a) => {
        const d = (a.stockAfter != null && a.stockBefore != null) ? (a.stockAfter - a.stockBefore) : (a.qty || 0);
        return d < 0;
      }).map((a) => {
        const d = (a.stockAfter != null && a.stockBefore != null) ? (a.stockAfter - a.stockBefore) : (a.qty || 0);
        return { id: 'a' + a.id, name: a.name, when: a.createdAt, qty: d, reason: a.reason || 'Adjustment', by: a.byEmail, notes: a.notes || '' };
      }));
    return arr.map((o) => {
      const dt = tsToDate(o.when);
      return {
        id: o.id, t: dt?.getTime() || 0, s: `${o.name} ${o.reason} ${o.by || ''}`, ty: o.reason, qty: o.qty, amount: Math.abs(o.qty),
        row: <LedgerRow left={<span className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full" style={{ background: reasonColor(o.reason) }} />{o.name}</span>} sub={`${dstr(o.when)} · ${o.reason}${o.by ? ` · ${o.by}` : ''}`} right={<span style={{ color: reasonColor(o.reason) }}>{o.qty}</span>} />,
        detail: { Part: o.name, Reason: o.reason, Quantity: o.qty, 'Recorded By': o.by || '—', Notes: o.notes || '—', Date: dstr(o.when) },
      };
    });
  }, [sales, stockAdjustments]);
  return <LedgerPage title="Stock Out — Sales & Reductions" icon={Send} cards={cards} items={items} typeOptions={['Sale', 'Job Card Usage', 'Internal Workshop Usage', 'Damage', 'Lost Item', 'Theft', 'Expired', 'Personal Use', 'Supplier Return', 'Branch Transfer', 'Adjustment', 'Correction', 'Audit Adjustment']} sortOptions={['Newest', 'Oldest', 'Largest Qty']} csvName="StockOut" csvHeader={['Part', 'Reason', 'Quantity', 'Recorded By', 'Notes', 'Date']} />;
}
// ---- Part 8: Reports & Business Intelligence Center ----
// Shares the same data source as Analytics + all modules (no duplication). Reads the
// invoice snapshot fields (grandTotal/gstAmount/profitAmount/balance) persisted by Billing.
// Module-scope numeric coercion. NOTE: there is a `num()` inside ImportModal, but it
// is scoped to that component AND it clamps negatives to 0 (fine for CSV import,
// wrong for ledger maths, where a refund is a negative delta). This one is safe for
// money: it accepts negatives and never returns NaN.
// ---------------------------------------------------------------------------
// TRANSACTION TRACER.
// Set localStorage.setItem('TXN_DEBUG','1') in the browser console, then run a
// Save & Collect. Every stage prints, with record counts before/after, so a silent
// failure becomes impossible to miss. Zero cost when the flag is off.
// ---------------------------------------------------------------------------
// DEMO SCHEMA VERSION.
//
// Demo data lives in session/localStorage and SURVIVES a code update. When the shape of
// the seed changes, that cached data becomes incompatible — and because the app quite
// correctly refuses to clobber saved data, the stale copy silently wins. That is exactly
// what happened when the fabricated `genSales()` ledger (~1,800 rows with no parent
// invoice) was replaced by invoice-derived history: users kept running on the old
// disconnected ledger and had no way to know.
//
// Bump this whenever the seeded data's shape changes. Mismatched caches are purged on
// load so the demo always matches the code that is running.
const DEMO_SCHEMA = 'v3-invoice-derived-ledger';

// Runs synchronously, at most once, BEFORE any hydration effect reads storage.
// (Doing this inside a useEffect was too late: the invoice-hydration effect is declared
// earlier in the component, so it would already have loaded the stale cache.)
let _demoSchemaChecked = false;
function purgeStaleDemoData() {
  if (_demoSchemaChecked || typeof window === 'undefined') return;
  _demoSchemaChecked = true;
  try {
    if (localStorage.getItem('maruti_demo_schema') === DEMO_SCHEMA) return;
    ['maruti_demo_inv', 'maruti_demo_sup', 'maruti_demo_sales', 'maruti_demo_rs',
     'maruti_demo_adj', 'maruti_demo_po', 'maruti_demo_audit', 'maruti_garage_seed']
      .forEach((k) => sessionStorage.removeItem(k));
    ['maruti_customers_demo', 'maruti_jobcards_demo', 'maruti_invoices_demo']
      .forEach((k) => localStorage.removeItem(k));
    localStorage.setItem('maruti_demo_schema', DEMO_SCHEMA);
    console.info('[DEMO] Seed format changed — stale demo data cleared, re-seeding.');
  } catch (e) {
    console.error('[DEMO] Could not clear stale demo data. You may be running on an old cached dataset — use Reset Demo Data.', e);
  }
}

const TXN_DEBUG = () => { try { return typeof window !== 'undefined' && localStorage.getItem('TXN_DEBUG') === '1'; } catch { return false; } };
const txn = (step, msg, data) => {
  if (!TXN_DEBUG()) return;
  const style = 'color:#d4af37;font-weight:bold';
  if (data !== undefined) console.log(`%c[TXN ${step}] ${msg}`, style, data);
  else console.log(`%c[TXN ${step}] ${msg}`, style);
};

const toNum = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

function invTotals(iv) {
  // COMPUTE FROM THE LINES. Never trust a stored total.
  //
  // ROOT CAUSE OF "invoice paid but nothing updated": this used to read the STORED
  // `iv.grandTotal` field. But collectPayment() in BillingModule builds the paid
  // invoice with `{...iv, payments:[...]}` and never refreshes grandTotal — while
  // Billing decides "Paid" from the LIVE lines. So Billing said Paid, and the engine,
  // reading a stale/zero grandTotal, computed grand = 0, so `t.grand > 0` was false,
  // invStatus returned "Pending", isRealized() was false and the ENTIRE TRANSACTION
  // ENGINE SILENTLY SKIPPED. Invoice looked paid; inventory, stock-out, sales,
  // services, reports, analytics and the dashboard never moved.
  //
  // Deriving from the lines means there is exactly ONE definition of the total, so no
  // upstream code path can ever desynchronise the engine's gate again.
  const lines = iv.lines || [];
  let sub = 0;
  let gst = 0;
  lines.forEach((l) => {
    const gross = toNum(l.qty) * toNum(l.rate);
    const disc = gross * (toNum(l.disc) / 100);
    const net = Math.max(0, gross - disc);
    sub += net;
    gst += net * (toNum(l.gst) / 100);
  });
  // Fall back to the stored value only when the invoice genuinely carries no lines
  // (legacy/imported records), so old data still reports a total.
  const computed = Math.round(sub + gst);
  const grand = lines.length ? computed : (toNum(iv.grandTotal) || 0);

  // Payment ROWS are the sole source of truth for how much was received.
  const hasPayments = Array.isArray(iv.payments) && iv.payments.length > 0;
  const legacyPaid = !hasPayments && iv.legacyPaid === true ? toNum(iv.paid) : 0;
  const paid = hasPayments ? iv.payments.reduce((s, p) => s + toNum(p.amount), 0) : legacyPaid;

  const profit = toNum(iv.profitAmount);
  const balance = Math.max(0, grand - paid);
  const parts = lines.filter((l) => l.kind === 'Part').reduce((s, l) => s + toNum(l.qty) * toNum(l.rate), 0);
  const labour = lines.filter((l) => l.kind === 'Labour').reduce((s, l) => s + toNum(l.qty) * toNum(l.rate), 0);
  return { grand, paid, gst, profit, balance, parts, labour };
}

const invStatus = (iv) => {
  if (iv.status === 'Cancelled' || iv.status === 'Refunded' || iv.status === 'Returned') return iv.status;
  if (iv.isEstimate) return 'Estimate';
  const t = invTotals(iv);
  if (t.balance <= 0 && t.grand > 0) return 'Paid';
  if (t.paid > 0) return 'Partially Paid';
  return iv.status === 'Draft' ? 'Draft' : 'Pending';
};
const RPT_COLORS = ['#d4af37', '#60a5fa', '#34d399', '#f472b6', '#a78bfa', '#fbbf24', '#22d3ee', '#fb923c'];

// Production report table (hoisted so its pagination/sort state survives parent
// re-renders). Renders one page at a time — never dumps the full dataset — so it
// scales to 10k/100k rows. Search is provided by the parent (`q`) and filters
// only THIS report's rows; export writes the full filtered+sorted set, not just
// the visible page.
function ReportTable({ head, rows, exportName, exportHead, q, csv }) {
  const ql = (q || '').trim().toLowerCase();
  const filtered = useMemo(() => (ql ? rows.filter((r) => r.join(' ').toLowerCase().includes(ql)) : rows), [rows, ql]);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(1);
  const [per, setPer] = useState(25);
  useEffect(() => { setPage(1); }, [ql, sortCol, sortDir, per, rows.length]);
  const sorted = useMemo(() => {
    if (sortCol == null) return filtered;
    const numOf = (x) => { const n = parseFloat(String(x).replace(/[₹,\s]/g, '')); return Number.isFinite(n) && /^[₹\d,.\s-]+$/.test(String(x)) ? n : null; };
    const arr = [...filtered].sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol]; const an = numOf(av), bn = numOf(bv);
      if (an !== null && bn !== null) return an - bn;
      return String(av).localeCompare(String(bv), undefined, { numeric: true });
    });
    return sortDir === 'desc' ? arr.reverse() : arr;
  }, [filtered, sortCol, sortDir]);
  const pages = Math.max(1, Math.ceil(sorted.length / per));
  const pageRows = sorted.slice((page - 1) * per, page * per);
  const toggleSort = (i) => { if (sortCol === i) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSortCol(i); setSortDir('asc'); } };
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <p className="text-[11px] text-white/40">{sorted.length.toLocaleString('en-IN')} row{sorted.length === 1 ? '' : 's'}{ql ? ' (filtered)' : ''}</p>
        <button onClick={() => csv(exportName, exportHead || head, sorted)} className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/75 hover:bg-white/10 flex items-center gap-1"><Download size={11} /> Export {ql ? 'filtered' : 'all'} ({sorted.length.toLocaleString('en-IN')})</button>
      </div>
      <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
        <table className="w-full text-xs min-w-[520px]">
          <thead className="sticky top-0 z-10">
            <tr className="text-[10px] uppercase text-white/40" style={{ background: 'var(--surface-2)' }}>
              {head.map((h, i) => (
                <th key={h} onClick={() => toggleSort(i)} className="text-left font-semibold py-2 px-3 whitespace-nowrap cursor-pointer select-none hover:text-white/70" title="Click to sort">
                  <span className="inline-flex items-center gap-1">{h}{sortCol === i && <span className="text-[#d4af37]">{sortDir === 'asc' ? '▲' : '▼'}</span>}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, i) => <tr key={(page - 1) * per + i} style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.05)' }} className="hover:bg-white/[0.02]">{r.map((c, j) => <td key={j} className="py-1.5 px-3 text-white/75 whitespace-nowrap">{c}</td>)}</tr>)}
            {sorted.length === 0 && <tr><td colSpan={head.length} className="py-8 text-center text-white/35">{ql ? 'No rows match your search.' : 'No data for this report yet.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {sorted.length > 0 && (
        <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-white/40">Showing {(page - 1) * per + 1}–{Math.min(page * per, sorted.length)} of {sorted.length.toLocaleString('en-IN')}</span>
            <select value={per} onChange={(e) => setPer(Number(e.target.value))} className="h-7 px-1.5 rounded-lg text-[11px] bg-white/5 border border-white/10 text-white/70 outline-none">{[25, 50, 100].map((n) => <option key={n} value={n} style={{ background: '#141414' }}>{n} / page</option>)}</select>
          </div>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage(1)} className="h-7 px-2 rounded-lg text-[11px] bg-white/5 border border-white/10 text-white/60 disabled:opacity-30">« First</button>
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 disabled:opacity-30"><ChevronLeft size={14} /></button>
            <span className="text-[11px] text-white/60">Page {page} / {pages}</span>
            <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 disabled:opacity-30"><ChevronRight size={14} /></button>
            <button disabled={page >= pages} onClick={() => setPage(pages)} className="h-7 px-2 rounded-lg text-[11px] bg-white/5 border border-white/10 text-white/60 disabled:opacity-30">Last »</button>
          </div>
        </div>
      )}
    </div>
  );
}

function RSpark({ data, height = 110, color = '#d4af37' }) {
  const max = Math.max(1, ...data.map((d) => d.v));
  const W = 520, H = height, pad = 4;
  if (data.length < 2) return <div className="text-xs text-white/30 py-8 text-center">Not enough data yet.</div>;
  const pts = data.map((d, i) => [pad + (i / (data.length - 1)) * (W - 2 * pad), H - pad - (d.v / max) * (H - 2 * pad)]);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${path} L${pts[pts.length - 1][0].toFixed(1)},${H - pad} L${pts[0][0].toFixed(1)},${H - pad} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <defs><linearGradient id={`rg${color.slice(1)}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.32" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={area} fill={`url(#rg${color.slice(1)})`} /><path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="1.7" fill={color} />)}
    </svg>
  );
}
function RDonut({ segments }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  let acc = 0; const R = 52, C = 60, sw = 16, circ = 2 * Math.PI * R;
  if (total <= 0) return <div className="text-xs text-white/30 py-8 text-center w-full">No data yet.</div>;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 120 120" width="116" height="116" className="flex-shrink-0">
        <circle cx={C} cy={C} r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={sw} />
        {segments.map((s, i) => { const frac = s.value / total; const dash = frac * circ; const el = <circle key={i} cx={C} cy={C} r={R} fill="none" stroke={s.color} strokeWidth={sw} strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-acc * circ} transform={`rotate(-90 ${C} ${C})`} />; acc += frac; return el; })}
      </svg>
      <div className="space-y-1 min-w-0 flex-1">{segments.map((s) => <div key={s.label} className="flex items-center justify-between gap-2 text-[11px]"><span className="flex items-center gap-1.5 min-w-0"><span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} /><span className="text-white/60 truncate">{s.label}</span></span><span className="text-white/45">{Math.round((s.value / total) * 100)}%</span></div>)}</div>
    </div>
  );
}
function RBars({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  if (!rows.length) return <div className="text-xs text-white/30 py-6 text-center">No data yet.</div>;
  return <div className="space-y-2">{rows.map((r, i) => (
    <div key={r.label}><div className="flex justify-between text-[11px] mb-1"><span className="text-white/60 truncate pr-2">{r.label}</span><span className="text-white/75">{r.display}</span></div>
    <div className="h-2 rounded-full bg-white/5 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(r.v / max) * 100}%`, background: RPT_COLORS[i % RPT_COLORS.length] }} /></div></div>
  ))}</div>;
}

function RptCard({ title, right, children, className = '' }) {
  return (
    <div className={`rounded-2xl p-4 ${className}`} style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
      <div className="flex items-center justify-between mb-3"><p className="text-xs font-bold uppercase tracking-wide text-white/55">{title}</p>{right}</div>
      {children}
    </div>
  );
}

function ReportsView(props) {
  const { isAdmin, demoMode, formatINR, invoices = [], customers = [], jobCards = [], inventory = [], suppliers = [], purchaseOrders = [], sales = [], restocks = [], stockAdjustments = [], auditLog = [],
    onExportInventory, onExportAudit, onBackup, onExportSales, onExportLowStock, onExportSupplier, onExportMovement, counts = {} } = props;
  const money = (n) => (typeof formatINR === 'function' ? formatINR(n) : `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`);
  const [tab, setTab] = useState('sales');
  const [range, setRange] = useState('30');
  const [q, setQ] = useState('');

  const now = new Date();
  const startOfRange = useMemo(() => { if (range === 'all') return new Date(0); const d = new Date(); const days = { today: 0, '7': 7, '30': 30, '90': 90, '365': 365 }[range] ?? 30; d.setDate(d.getDate() - days); d.setHours(0, 0, 0, 0); return d; }, [range]);
  const inRange = (dateStr) => { if (!dateStr) return false; if (range === 'all') return true; const d = new Date(dateStr); return d >= startOfRange; };


  // revenue/profit trend (last 14 days)

  const invoiceStatusMix = useMemo(() => { const m = {}; invoices.forEach((iv) => { const s = invStatus(iv); m[s] = (m[s] || 0) + 1; }); return Object.entries(m).map(([label, value], i) => ({ label, value, color: RPT_COLORS[i % RPT_COLORS.length] })); }, [invoices]);
  const jobStatusMix = useMemo(() => { const m = {}; jobCards.forEach((j) => { m[j.status || 'Received'] = (m[j.status || 'Received'] || 0) + 1; }); return Object.entries(m).map(([label, value], i) => ({ label, value, color: RPT_COLORS[i % RPT_COLORS.length] })); }, [jobCards]);
  const topCustomers = useMemo(() => { const m = {}; invoices.forEach((iv) => { if (invStatus(iv) === 'Cancelled') return; m[iv.customer || '—'] = (m[iv.customer || '—'] || 0) + invTotals(iv).grand; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, v]) => ({ label, v, display: money(v) })); }, [invoices]);
  const topParts = useMemo(() => { const m = {}; invoices.forEach((iv) => (iv.lines || []).filter((l) => l.kind === 'Part').forEach((l) => { m[l.desc || '—'] = (m[l.desc || '—'] || 0) + (Number(l.qty) || 0) * (Number(l.rate) || 0); })); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, v]) => ({ label, v, display: money(v) })); }, [invoices]);
  const brandMix = useMemo(() => { const m = {}; customers.forEach((c) => (c.vehicles || []).forEach((v) => { const b = (v.make || (v.vehicle || '').split(' ')[0] || 'Other'); m[b] = (m[b] || 0) + 1; })); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value], i) => ({ label, value, color: RPT_COLORS[i % RPT_COLORS.length] })); }, [customers]);
  const outstandingAgeing = useMemo(() => {
    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    invoices.forEach((iv) => { const t = invTotals(iv); if (t.balance <= 0) return; const days = Math.floor((now - new Date(iv.date)) / 864e5); if (days <= 30) buckets['0-30'] += t.balance; else if (days <= 60) buckets['31-60'] += t.balance; else if (days <= 90) buckets['61-90'] += t.balance; else buckets['90+'] += t.balance; });
    return Object.entries(buckets).map(([label, value], i) => ({ label, value, color: RPT_COLORS[i % RPT_COLORS.length] }));
  }, [invoices]);
  const technicianPerf = useMemo(() => {
    const m = {};
    jobCards.forEach((j) => { const tech = j.technician || '—'; if (!m[tech]) m[tech] = { jobs: 0, labour: 0 }; m[tech].jobs += 1; m[tech].labour += (j.labour || []).reduce((s, l) => s + (Number(l.hours) || 0) * (Number(l.rate) || 0), 0); });
    return Object.entries(m).filter(([k]) => k !== '—').sort((a, b) => b[1].labour - a[1].labour).slice(0, 8).map(([label, d]) => ({ label, jobs: d.jobs, labour: d.labour }));
  }, [jobCards]);

  const csv = (name, head, rows) => {
    if (demoMode && false) return;
    const body = [head, ...rows].map((r) => r.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' })); a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    toast.success(`Exported ${name}`);
  };

  const SECTIONS = [
    ['sales', 'Revenue (Invoices)'], ['partsales', 'Parts Sales'], ['servicesales', 'Service Sales'], ['laboursales', 'Labour Charges'], ['outsidesales', 'Outside Purchases'],
    ['billing', 'Billing'], ['inventory', 'Inventory'], ['customer', 'Customer'],
    ['vehicle', 'Vehicle'], ['jobcard', 'Job Card'], ['technician', 'Technician'], ['supplier', 'Supplier'], ['purchase', 'Purchase'], ['gst', 'GST'], ['audit', 'Audit'],
  ];

  const Card = RptCard;

  // ---- per-section report table data ----
  const salesRows = invoices.filter((iv) => !iv.isEstimate).map((iv) => { const t = invTotals(iv); return [iv.invNo, iv.date, iv.customer, iv.vehicle || '', money(t.grand), money(t.gst), money(t.profit), invStatus(iv)]; });
  // Line-level revenue reports, split by category, sourced from the sales ledger.
  const catOfSale = (s) => s.revenueType || s.category || (s.partId ? 'Parts' : 'Service');
  const saleDateStr = (s) => { const d = tsToDate(s.createdAt); return d ? d.toLocaleDateString('en-IN') : ''; };
  const salesByCat = (cats) => sales.filter((s) => cats.includes(catOfSale(s)));
  const partSaleRows = salesByCat(['Parts']).map((s) => [s.name, s.invoiceNo || '—', s.customer || '—', s.vehicle || '—', String(s.qty ?? ''), money(s.unitCost || 0), money(s.unitPrice || 0), money(s.revenue || 0), money(s.profit || 0), saleDateStr(s)]);
  const serviceSaleRows = salesByCat(['Service']).map((s) => [s.name, s.invoiceNo || '—', s.customer || '—', s.vehicle || '—', s.technician || '—', String(s.qty ?? ''), money(s.unitPrice || 0), money(s.revenue || 0), saleDateStr(s)]);
  const labourSaleRows = salesByCat(['Labour']).map((s) => [s.name, s.invoiceNo || '—', s.customer || '—', s.vehicle || '—', s.technician || '—', String(s.qty ?? ''), money(s.unitPrice || 0), money(s.revenue || 0), saleDateStr(s)]);
  const outsideSaleRows = salesByCat(['Outside Purchase']).map((s) => [s.name, s.invoiceNo || '—', s.customer || '—', s.vehicle || '—', String(s.qty ?? ''), money(s.unitPrice || 0), money(s.revenue || 0), saleDateStr(s)]);
  const billingRows = invoices.map((iv) => { const t = invTotals(iv); return [iv.invNo, iv.date, iv.customer, money(t.grand), money(t.paid), money(t.balance), invStatus(iv), (iv.payments || []).map((p) => p.mode).join('/') || '—']; });
  const inventoryRows = inventory.filter((p) => !p.archived).map((p) => [p.name, p.sku || '', p.stock || 0, money((Number(p.stock) || 0) * (Number(p.purchasePrice) || 0)), money(p.sellingPrice || p.defaultSellingPrice || 0), p.category || '', p.brand || '']);
  const customerRows = customers.map((c) => { const cInv = invoices.filter((iv) => (iv.phone || '') === (c.phone || '')); const rev = cInv.reduce((s, iv) => s + invTotals(iv).grand, 0); return [c.name, c.phone || '', c.city || '', (c.vehicles || []).length, cInv.length, money(rev), money(c.outstanding || 0)]; });
  const vehicleRows = customers.flatMap((c) => (c.vehicles || []).map((v) => [v.regNo || '', v.make || (v.vehicle || '').split(' ')[0] || '', v.model || v.vehicle || '', v.fuel || '', c.name, v.insuranceExpiry || '', v.odometer || '']));
  const jobcardRows = jobCards.map((j) => [j.jobNo, j.date || j.dateIn || '', j.customer || '', j.vehicle || '', j.technician || '', j.advisor || '', j.status || '']);
  const technicianRows = technicianPerf.map((t) => [t.label, t.jobs, money(t.labour)]);
  const supplierRows = suppliers.map((s) => [s.name, s.code || '', s.type || '', s.city || '', s.gst ? 'GST' : 'Non-GST', money(s.outstanding || 0), s.rating || '']);
  const purchaseRows = purchaseOrders.map((po) => [po.poNumber, po.supplierName || '', po.status || '', (po.items || []).length, money(po.total || 0), po.expectedDate || '', po.priority || 'Normal']);
  const gstRows = invoices.filter((iv) => !iv.isEstimate && invStatus(iv) !== 'Cancelled').map((iv) => { const t = invTotals(iv); const isIg = iv.gstMode === 'igst'; return [iv.invNo, iv.date, iv.gstNo || 'Unregistered', money(t.grand - t.gst), money(isIg ? 0 : t.gst / 2), money(isIg ? 0 : t.gst / 2), money(isIg ? t.gst : 0), money(t.gst)]; });
  const auditRows = auditLog.slice(0, 500).map((a) => [a.action || a.type || '', a.entity || a.module || '', a.by || a.user || 'System', a.at ? new Date(a.at?.toMillis ? a.at.toMillis() : a.at).toLocaleString('en-IN') : '', JSON.stringify(a.meta || a.details || {}).slice(0, 60)]);

  return (
    <PageShell title="Reports" icon={FileText} action={
      <div className="flex items-center gap-2">
        <select value={range} onChange={(e) => setRange(e.target.value)} className="px-2.5 py-2 rounded-lg text-xs bg-white/5 border border-white/10 text-white outline-none">
          {[['today', 'Today'], ['7', 'Last 7 Days'], ['30', 'This Month'], ['90', 'Quarter'], ['365', 'Year'], ['all', 'All Time']].map(([v, l]) => <option key={v} value={v} style={{ background: '#141414' }}>{l}</option>)}
        </select>
      </div>
    }>
      {/* section tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl w-max max-w-full overflow-x-auto dark-scroll" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
        {SECTIONS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${tab === k ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]' : 'text-white/60 hover:text-white/90'}`}>{l}</button>)}
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search within this report…" className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 text-white placeholder-white/30 outline-none focus:border-[#d4af37]/60" />
      </div>


      {tab === 'sales' && <Card title="Revenue by Invoice"><ReportTable q={q} csv={csv} head={['Invoice', 'Date', 'Customer', 'Vehicle', 'Total', 'GST', 'Profit', 'Status']} rows={salesRows} exportName="Revenue-by-Invoice" /></Card>}
      {tab === 'partsales' && <Card title="Parts Sales"><ReportTable q={q} csv={csv} head={['Part', 'Invoice', 'Customer', 'Vehicle', 'Qty', 'Cost', 'Sold Price', 'Revenue', 'Profit', 'Date']} rows={partSaleRows} exportName="Parts-Sales-Report" /></Card>}
      {tab === 'servicesales' && <Card title="Service Sales"><ReportTable q={q} csv={csv} head={['Service', 'Invoice', 'Customer', 'Vehicle', 'Technician', 'Qty', 'Rate', 'Revenue', 'Date']} rows={serviceSaleRows} exportName="Service-Sales-Report" /></Card>}
      {tab === 'laboursales' && <Card title="Labour Charges"><ReportTable q={q} csv={csv} head={['Labour', 'Invoice', 'Customer', 'Vehicle', 'Technician', 'Hours', 'Rate', 'Revenue', 'Date']} rows={labourSaleRows} exportName="Labour-Charges-Report" /></Card>}
      {tab === 'outsidesales' && <Card title="Outside Purchases"><ReportTable q={q} csv={csv} head={['Item', 'Invoice', 'Customer', 'Vehicle', 'Qty', 'Rate', 'Revenue', 'Date']} rows={outsideSaleRows} exportName="Outside-Purchases-Report" /></Card>}
      {tab === 'billing' && <Card title="Billing Report"><ReportTable q={q} csv={csv} head={['Invoice', 'Date', 'Customer', 'Total', 'Paid', 'Balance', 'Status', 'Modes']} rows={billingRows} exportName="Billing-Report" /></Card>}
      {tab === 'inventory' && <Card title="Inventory Report"><ReportTable q={q} csv={csv} head={['Part', 'SKU', 'Stock', 'Stock Value', 'Sell Price', 'Category', 'Brand']} rows={inventoryRows} exportName="Inventory-Report" /></Card>}
      {tab === 'customer' && <Card title="Customer Report"><ReportTable q={q} csv={csv} head={['Customer', 'Phone', 'City', 'Vehicles', 'Invoices', 'Revenue', 'Outstanding']} rows={customerRows} exportName="Customer-Report" /></Card>}
      {tab === 'vehicle' && <Card title="Vehicle Report"><ReportTable q={q} csv={csv} head={['Reg No', 'Brand', 'Model', 'Fuel', 'Owner', 'Insurance Expiry', 'Odometer']} rows={vehicleRows} exportName="Vehicle-Report" /></Card>}
      {tab === 'jobcard' && <Card title="Job Card Report"><ReportTable q={q} csv={csv} head={['Job No', 'Date', 'Customer', 'Vehicle', 'Technician', 'Advisor', 'Status']} rows={jobcardRows} exportName="JobCard-Report" /></Card>}
      {tab === 'technician' && <Card title="Technician Report"><ReportTable q={q} csv={csv} head={['Technician', 'Jobs', 'Labour Revenue']} rows={technicianRows} exportName="Technician-Report" /></Card>}
      {tab === 'supplier' && <Card title="Supplier Report"><ReportTable q={q} csv={csv} head={['Supplier', 'Code', 'Type', 'City', 'GST', 'Outstanding', 'Rating']} rows={supplierRows} exportName="Supplier-Report" /></Card>}
      {tab === 'purchase' && <Card title="Purchase Report"><ReportTable q={q} csv={csv} head={['PO', 'Supplier', 'Status', 'Items', 'Total', 'Expected', 'Priority']} rows={purchaseRows} exportName="Purchase-Report" /></Card>}
      {tab === 'gst' && <Card title="GST Report" right={<span className="text-[10px] text-white/40">GST optional — unregistered suppliers/customers included at 0%</span>}><ReportTable q={q} csv={csv} head={['Invoice', 'Date', 'GSTIN', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total GST']} rows={gstRows} exportName="GST-Report" /></Card>}
      {tab === 'audit' && <Card title="Audit Report">{isAdmin ? <ReportTable q={q} csv={csv} head={['Action', 'Module', 'User', 'Timestamp', 'Details']} rows={auditRows} exportName="Audit-Report" /> : <p className="text-sm text-white/40 py-6 text-center">Audit reports are available to administrators.</p>}</Card>}
    </PageShell>
  );
}
function AlertsView({ alerts, readIds, archivedIds, onMarkRead, onMarkAllRead, onArchive, onEditPart, inventory, canDestroy = true }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState(null);
  const [pinned, setPinned] = useState(new Set());
  const PER = 25;
  const visible = useMemo(() => alerts.filter((a) => !archivedIds.has(a.id)), [alerts, archivedIds]);
  const counts = useMemo(() => ({
    critical: visible.filter((a) => a.sev === 'Critical').length,
    warning: visible.filter((a) => a.sev === 'Warning').length,
    info: visible.filter((a) => ['Inventory', 'Supplier'].includes(a.sev)).length,
    inventory: visible.filter((a) => ['critical', 'warning', 'inventory'].includes(a.cat)).length,
    customer: visible.filter((a) => a.cat === 'customer').length,
    vehicle: visible.filter((a) => a.cat === 'vehicle').length,
    billing: visible.filter((a) => a.cat === 'billing').length,
    supplier: visible.filter((a) => a.cat === 'supplier').length,
    total: visible.length,
    unread: visible.filter((a) => !readIds.has(a.id)).length,
    acknowledged: visible.filter((a) => readIds.has(a.id)).length,
  }), [visible, readIds]);
  const filtered = useMemo(() => {
    const needle = safeLower(q.trim());
    return visible.filter((a) => {
      if (cat === 'unread' && readIds.has(a.id)) return false;
      if (cat === 'read' && !readIds.has(a.id)) return false;
      if (cat === 'inventory' && !['critical', 'warning', 'inventory'].includes(a.cat)) return false;
      if (['customer', 'vehicle', 'billing', 'supplier'].includes(cat) && a.cat !== cat) return false;
      if (cat === 'critical' && a.sev !== 'Critical') return false;
      if (needle && !safeLower(`${a.title} ${a.sub} ${a.module || ''}`).includes(needle)) return false;
      return true;
    });
  }, [visible, q, cat, readIds]);
  useEffect(() => { setPage(1); }, [q, cat]);
  const pages = Math.max(1, Math.ceil(filtered.length / PER));
  const shown = filtered.slice((page - 1) * PER, page * PER);
  const sevColor = { Critical: '#ef4444', Warning: '#d4af37', Inventory: '#fb923c', Supplier: '#60a5fa' };
  const fld = 'px-2.5 py-2 rounded-lg text-xs outline-none bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60';
  const openPart = (a) => { onMarkRead(a.id); if (a.partId) { const p = inventory.find((x) => x.id === a.partId); if (p) onEditPart(p); } setDrawer(a); };
  return (
    <PageShell title="Alert Center" icon={AlertTriangle} action={counts.unread > 0 && <button onClick={onMarkAllRead} className="text-xs font-semibold text-white/60 hover:text-white px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">Mark all read</button>}>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
        {[
          { label: 'Critical', value: counts.critical, color: '#ef4444' },
          { label: 'Warning', value: counts.warning, color: '#f59e0b' },
          { label: 'Customer', value: counts.customer, color: '#fbbf24' },
          { label: 'Billing', value: counts.billing, color: '#60a5fa' },
          { label: 'Vehicle', value: counts.vehicle, color: '#a78bfa' },
          { label: 'Supplier', value: counts.supplier, color: '#22d3ee' },
          { label: 'Unread', value: counts.unread, color: '#d4af37' },
          { label: 'Acknowledged', value: counts.acknowledged, color: '#34d399' },
          { label: 'Inventory', value: counts.inventory, color: '#fb923c' },
          { label: 'Total', value: counts.total, color: '#94a3b8' },
        ].map((c) => (
          <button key={c.label} onClick={() => setCat(c.label.toLowerCase() === 'acknowledged' ? 'read' : c.label.toLowerCase() === 'unread' ? 'unread' : c.label.toLowerCase())} className="text-left rounded-xl p-3 transition hover:bg-white/[0.05]" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
            <p className="text-[10px] uppercase tracking-wider text-white/40">{c.label}</p>
            <p className="text-xl font-bold mt-0.5" style={{ color: c.color }}>{c.value}</p>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search alerts by title, detail, module…" className={`${fld} flex-1 min-w-[140px]`} />
        <select value={cat} onChange={(e) => setCat(e.target.value)} className={fld}>
          {[['all', 'All'], ['unread', 'Unread'], ['read', 'Acknowledged'], ['critical', 'Critical'], ['inventory', 'Inventory'], ['customer', 'Customer'], ['vehicle', 'Vehicle'], ['billing', 'Billing'], ['supplier', 'Supplier']].map(([v, l]) => <option key={v} value={v} className="bg-[#111]">{l}</option>)}
        </select>
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-emerald-400/80 py-8 text-center">{visible.length === 0 ? 'All clear — no active alerts. ✓' : 'No alerts match your filter.'}</p>
      ) : (
        <>
          <p className="text-[11px] text-white/35">Showing {shown.length} of {filtered.length}</p>
          <div className="space-y-1.5">
            {shown.map((a) => {
              const isRead = readIds.has(a.id);
              return (
                <div key={a.id} className="group flex items-center gap-2.5 px-3.5 py-3 rounded-xl transition hover:bg-white/[0.05]" style={{ background: isRead ? 'rgba(var(--fg-rgb),0.015)' : 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)', borderLeft: `3px solid ${sevColor[a.sev] || '#888'}`, opacity: isRead ? 0.65 : 1 }}>
                  <button onClick={() => openPart(a)} className="min-w-0 flex-1 text-left">
                    <p className="text-sm text-white/90 truncate">{a.title}</p>
                    <p className="text-[11px] text-white/40 truncate">{a.sub}</p>
                  </button>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0" style={isRead ? { background: 'rgba(var(--fg-rgb),0.06)', color: 'rgba(var(--fg-rgb),0.4)' } : { background: 'rgba(212,175,55,0.15)', color: '#d4af37' }}>{isRead ? 'READ' : 'UNREAD'}</span>
                  <button onClick={() => onMarkRead(a.id, !isRead)} className="text-[10px] text-white/45 hover:text-white px-1.5 flex-shrink-0">{isRead ? 'Mark unread' : 'Mark read'}</button>
                  {canDestroy && (<button onClick={() => onArchive(a.id)} className="text-white/30 hover:text-red-400 flex-shrink-0" title="Archive alert"><X size={13} /></button>)}
                </div>
              );
            })}
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-white/70 disabled:opacity-30">Previous</button>
              <span className="text-xs text-white/50">Page {page} / {pages}</span>
              <button disabled={page === pages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-white/70 disabled:opacity-30">Next</button>
            </div>
          )}
        </>
      )}
      {drawer && (
        <div className="fixed inset-0 z-[120] flex justify-end" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }} onClick={() => setDrawer(null)}>
          <div className="w-full sm:max-w-md h-full overflow-y-auto dark-scroll" style={{ background: 'var(--surface-1)', borderLeft: '1px solid rgba(212,175,55,0.2)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between p-5" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
              <div className="min-w-0"><div className="flex items-center gap-2"><h3 className="text-base font-bold text-white">{drawer.title}</h3><span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${sevColor[drawer.sev] || '#888'}22`, color: sevColor[drawer.sev] || '#888' }}>{drawer.sev}</span></div><p className="text-[11px] text-white/45 mt-1">{drawer.sub}</p></div>
              <button onClick={() => setDrawer(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10 flex-shrink-0"><X size={17} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                {[['Source Module', drawer.module || '—'], ['Category', drawer.cat || '—'], ['Priority', drawer.sev], ['Status', readIds.has(drawer.id) ? 'Acknowledged' : 'Unread'], drawer.regNo && ['Vehicle', drawer.regNo], drawer.invNo && ['Invoice', drawer.invNo], drawer.jobNo && ['Job Card', drawer.jobNo]].filter(Boolean).map(([k, v]) => (
                  <div key={k} className="rounded-lg p-2" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}><p className="text-white/40">{k}</p><p className="text-white/80 mt-0.5">{v}</p></div>
                ))}
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#d4af37] mb-2">Timeline</p>
                <div className="space-y-2">
                  {[['Alert generated', 'now'], readIds.has(drawer.id) && ['Acknowledged', 'now']].filter(Boolean).map(([label], i) => (
                    <div key={i} className="flex gap-2.5 items-start"><span className="w-2 h-2 rounded-full bg-[#d4af37] mt-1" /><div><p className="text-xs text-white/80">{label}</p></div></div>
                  ))}
                </div>
              </div>
              <p className="text-[10px] text-white/30">Notification channels (in-app active; email / SMS / WhatsApp architecture-ready).</p>
            </div>
            <div className="sticky bottom-0 flex gap-2 p-4" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.08)', background: 'var(--surface-2)' }}>
              <button onClick={() => { setPinned((s) => { const n = new Set(s); n.has(drawer.id) ? n.delete(drawer.id) : n.add(drawer.id); return n; }); }} className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-white/5 border border-white/10 text-white/80">{pinned.has(drawer.id) ? 'Unpin' : 'Pin'}</button>
              <button onClick={() => { onMarkRead(drawer.id, false); toast.success('Acknowledged'); }} className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/25">Acknowledge</button>
              <button onClick={() => { onArchive(drawer.id); setDrawer(null); toast.success('Resolved'); }} className="flex-1 py-2.5 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">Resolve</button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
// clears the mobile bottom-nav, never overlaps modals (z below them).
function ScrollToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Back to top"
      className={`fixed z-[80] bottom-24 md:bottom-6 right-4 md:right-6 w-11 h-11 rounded-full flex items-center justify-center shadow-xl transition-all duration-300 ${show ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-3 pointer-events-none'}`}
      style={{ background: 'linear-gradient(135deg,#d4af37,#aa801e)', color: '#1a1a1a' }}
    >
      <ChevronUp size={20} />
    </button>
  );
}

// Path B — real, non-color preferences (font size, motion, compact sidebar,
// region/format). No theme-color faking; the working subset only.

// ---- Settings field primitives (HOISTED) --------------------------------
// These MUST live at module scope. When they were declared inside SettingsView,
// every keystroke re-created them, React treated each as a brand-new component
// type, and the input was unmounted + remounted — so the field lost focus after
// one character. At module scope their identity is stable and focus is retained.
const SET_CARD_STYLE = { background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' };
function SetSeg({ value, onChange, options }) {
  return (
    <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: 'rgba(var(--fg-rgb),0.04)' }}>
      {options.map((o) => (<button key={o.value} type="button" onClick={() => onChange(o.value)} className={`flex-1 px-3 py-1.5 rounded-lg text-sm font-semibold transition ${value === o.value ? 'bg-[#d4af37] text-black' : 'text-white/60 hover:text-white/90'}`}>{o.label}</button>))}
    </div>
  );
}
function SetSel({ label, value, onChange, options }) {
  return (
    <div><label className="block text-[11px] uppercase tracking-wide text-white/40 mb-1.5">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 text-white outline-none focus:border-[#d4af37]/60">{options.map((o) => <option key={o.value} value={o.value} style={{ background: 'var(--surface-2)' }}>{o.label}</option>)}</select>
    </div>
  );
}
function SetTxt({ label, k, placeholder, optional, biz, bset }) {
  return (
    <div><label className="block text-[11px] uppercase tracking-wide text-white/40 mb-1.5">{label}{optional && <span className="text-white/25 normal-case"> (optional)</span>}</label>
      <input value={biz[k] || ''} onChange={(e) => bset({ [k]: e.target.value })} placeholder={placeholder} className="w-full px-3 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 text-white placeholder-white/25 outline-none focus:border-[#d4af37]/60" />
    </div>
  );
}
function SetCard({ title, desc, children }) {
  return (
    <div className="rounded-2xl p-5" style={SET_CARD_STYLE}>
      <h3 className="text-sm font-bold text-white/90 mb-1">{title}</h3>{desc && <p className="text-xs text-white/45 mb-4">{desc}</p>}
      {children}
    </div>
  );
}

function SettingsView({ totalRecords, lastBackup, lastSync, isAdmin, userEmail, online, onBackup, onRestore, admins = [], bootstrapAdmins = [], onAddAdmin, onRemoveAdmin, staffPerms = {}, onAddStaff, onRemoveStaff, onSetStaffPerm, recoveryMeta = null, onResetAllData, onRestoreVault, demoMode = false, demoAdmin = false, sidebarCollapsed, setSidebarCollapsed }) {
  const [section, setSection] = useState('business');
  const [biz, setBiz] = useState({});
  // Baseline = what's actually persisted. `dirty` is derived by comparing the
  // working copy against it, so reverting a toggle to its original value correctly
  // disables Save Changes again (a manual setDirty(true) flag could never do that).
  const [bizSaved, setBizSaved] = useState({});
  const dirty = useMemo(() => JSON.stringify(biz) !== JSON.stringify(bizSaved), [biz, bizSaved]);
  const [prefs, setPrefsState] = useState(() => { try { return { theme: 'dark', fontSize: 'md', reduceMotion: false, density: 'comfortable', ...(JSON.parse(localStorage.getItem('maruti_prefs') || '{}')) }; } catch { return { theme: 'dark', fontSize: 'md' }; } });
  const [demoPerms, setDemoPermsState] = useState(() => loadDemoPerms());
  const [newAdmin, setNewAdmin] = useState('');
  const [newStaff, setNewStaff] = useState('');
  const [resetStep, setResetStep] = useState(0);
  const [resetText, setResetText] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const recoveryActive = !!recoveryMeta && (recoveryMeta.expiresAt || 0) > Date.now();
  const daysRemaining = recoveryActive ? Math.max(0, Math.ceil((recoveryMeta.expiresAt - Date.now()) / 86400000)) : 0;

  useEffect(() => { try { const s = JSON.parse(localStorage.getItem('maruti_settings') || '{}'); setBiz(s); setBizSaved(s); } catch {} }, []);
  const bset = (patch) => setBiz((b) => ({ ...b, ...patch }));
  const saveBiz = () => {
    try { localStorage.setItem('maruti_settings', JSON.stringify(biz)); window.dispatchEvent(new CustomEvent('maruti-settings')); } catch {}
    setBizSaved(biz); // new baseline → dirty recomputes to false
    toast.success('Settings saved');
  };

  // appearance prefs apply instantly + persist (same engine used elsewhere)
  const updatePrefs = (patch) => setPrefsState((p) => { const next = { ...p, ...patch }; try { localStorage.setItem('maruti_prefs', JSON.stringify(next)); window.dispatchEvent(new CustomEvent('maruti-prefs')); } catch {} return next; });
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
    <PageShell title="Settings" icon={Settings}>
      <div className="lg:flex lg:gap-5 lg:items-start">
        <div className="lg:w-56 lg:flex-shrink-0 mb-3 lg:mb-0">
          <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-x-visible dark-scroll rounded-2xl p-1.5" style={SET_CARD_STYLE}>
            {NAV_SECTIONS.map((g, gi) => (
              <Fragment key={g.header || `g${gi}`}>
                {g.header && <p className="hidden lg:block px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-white/30">{g.header}</p>}
                {g.items.map(([k, l]) => (
                  <button key={k} onClick={() => setSection(k)} className={`text-left px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition ${section === k ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]' : 'text-white/60 hover:text-white/90 hover:bg-white/5'}`}>{l}</button>
                ))}
              </Fragment>
            ))}
          </div>
        </div>

        <div className="lg:flex-1 lg:min-w-0 space-y-4">
          {section === 'business' && (
            <Card title="Business Profile" desc="Shown on invoices, estimates and reports. GST & PAN are optional.">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <SetTxt biz={biz} bset={bset} label="Workshop Name" k="bizName" placeholder={SHOP_NAME} />
                <SetTxt biz={biz} bset={bset} label="Phone" k="bizPhone" placeholder="10-digit phone" />
                <SetTxt biz={biz} bset={bset} label="GST Number" k="bizGst" placeholder="36ABCDE1234F1Z5" optional />
                <SetTxt biz={biz} bset={bset} label="Email" k="bizEmail" placeholder="info@…" optional />
                <div className="sm:col-span-2"><SetTxt biz={biz} bset={bset} label="Address" k="bizAddress" placeholder="Street, city, PIN" /></div>
                <SetTxt biz={biz} bset={bset} label="Working Hours" k="bizHours" placeholder="9:00 AM – 8:00 PM" optional />
                <SetTxt biz={biz} bset={bset} label="Invoice Prefix" k="invPrefix" placeholder="INV" />
                <Sel label="Currency" value={biz.currency || 'INR'} onChange={(v) => bset({ currency: v })} options={[{ value: 'INR', label: '₹ INR' }, { value: 'USD', label: '$ USD' }]} />
                <Sel label="Timezone" value={biz.timezone || 'IST'} onChange={(v) => bset({ timezone: v })} options={[{ value: 'IST', label: 'IST (India)' }]} />
                <Sel label="Language" value={biz.language || 'en'} onChange={(v) => bset({ language: v })} options={[{ value: 'en', label: 'English' }, { value: 'hi', label: 'Hindi' }, { value: 'te', label: 'Telugu' }]} />
              </div>
              <div className="mt-3"><label className="block text-[11px] uppercase tracking-wide text-white/40 mb-1.5">Business Logo</label>
                <p className="text-[11px] text-white/35">Logo upload appears on printed invoices. Add a logo file named <span className="text-white/55">icon-512.png</span> to your deployment’s <span className="text-white/55">/public/icons</span> folder.</p></div>
            </Card>
          )}

          {section === 'billing' && (
            <Card title="Billing Settings" desc="Defaults applied to new invoices & estimates. GST stays optional per invoice.">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <SetTxt biz={biz} bset={bset} label="Default Labour Rate (₹/hr)" k="labourRate" placeholder="400" />
                <SetTxt biz={biz} bset={bset} label="Default GST %" k="defaultTax" placeholder="18" />
                <SetTxt biz={biz} bset={bset} label="Default Discount %" k="defaultDiscount" placeholder="0" />
                <SetTxt biz={biz} bset={bset} label="Invoice Prefix" k="invPrefix" placeholder="INV" />
                <SetTxt biz={biz} bset={bset} label="Estimate Prefix" k="estPrefix" placeholder="EST" />
              </div>
              <div className="mt-2">
                <Toggle on={biz.gstOptional !== false} onChange={(v) => bset({ gstOptional: v })} label="GST Optional" desc="Allow invoices without GST (unregistered customers)." />
                <Toggle on={biz.discountOptional !== false} onChange={(v) => bset({ discountOptional: v })} label="Discount Optional" desc="Allow per-line or invoice discounts." />
                <Toggle on={biz.roundOff !== false} onChange={(v) => bset({ roundOff: v })} label="Round Off" desc="Round grand totals to the nearest rupee." />
              </div>
              <div className="mt-3 space-y-3">
                <SetTxt biz={biz} bset={bset} label="Invoice Footer" k="bizFooter" placeholder="Thank you for choosing us!" optional />
                <SetTxt biz={biz} bset={bset} label="Invoice Terms" k="terms" placeholder="Standard workshop terms…" optional />
                <SetTxt biz={biz} bset={bset} label="Bank / UPI Details" k="bankDetails" placeholder="A/C, IFSC, UPI ID…" optional />
              </div>
            </Card>
          )}

          {section === 'jobcards' && (
            <Card title="Job Card Settings" desc="Defaults for new job cards. All job-card options live here only.">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <SetTxt biz={biz} bset={bset} label="Job Card Prefix" k="jcPrefix" placeholder="SBBMC" />
                <Sel label="Default Status" value={biz.jcStatus || 'Received'} onChange={(v) => bset({ jcStatus: v })} options={[{ value: 'Received', label: 'Received' }, { value: 'Inspection', label: 'Inspection' }]} />
                <Sel label="Inspection Template" value={biz.jcTemplate || 'General Inspection'} onChange={(v) => bset({ jcTemplate: v })} options={[{ value: 'Major Service', label: 'Major Service' }, { value: 'Small Service', label: 'Small Service' }, { value: 'General Inspection', label: 'General Inspection' }, { value: 'EV Inspection', label: 'EV Inspection' }]} />
                <SetTxt biz={biz} bset={bset} label="Estimated Delivery (hours)" k="jcDelivery" placeholder="24" />
                <SetTxt biz={biz} bset={bset} label="Service Reminder Days" k="serviceReminderDays" placeholder="180" />
              </div>
              <div className="mt-2">
                <Toggle on={!!biz.autoAssignTech} onChange={(v) => bset({ autoAssignTech: v })} label="Auto Technician Assignment" desc="Assign the next available technician automatically." />
                <Toggle on={biz.inspectionChecklist !== false} onChange={(v) => bset({ inspectionChecklist: v })} label="Inspection Checklist" desc="Show the inspection checklist on new job cards." />
              </div>
            </Card>
          )}

          {section === 'inventory' && (
            <Card title="Inventory Settings" desc="Thresholds that drive Low/Dead-stock badges and the Reorder Center.">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <SetTxt biz={biz} bset={bset} label="Default Low Stock" k="lowStock" placeholder="5" />
                <SetTxt biz={biz} bset={bset} label="Fast Mover (units sold)" k="fastMover" placeholder="10" />
                <SetTxt biz={biz} bset={bset} label="Dead Stock (days unsold)" k="deadDays" placeholder="90" />
                <SetTxt biz={biz} bset={bset} label="Reorder Top-up (× min)" k="reorderMult" placeholder="2" />
              </div>
            </Card>
          )}

          {section === 'notifications' && (
            <Card title="Notifications" desc="Only channels that are actually active are shown.">
              <Toggle on disabled label="In-app Notifications" desc="Always on — alerts & reminders appear inside the app." />
              <div className="h-px my-2" style={{ background: 'rgba(var(--fg-rgb),0.08)' }} />
              {[['remLowStock', 'Low Stock Alerts'], ['remCritical', 'Critical Stock Alerts'], ['remService', 'Service Due Reminder'], ['remPayment', 'Outstanding Payment Reminder']].map(([k, l]) => (
                <Toggle key={k} on={biz[k] !== false} onChange={(v) => bset({ [k]: v })} label={l} />
              ))}
              <p className="text-[11px] text-white/35 mt-2">These drive the in-app Alerts & Reminders centres. External channels (SMS / WhatsApp / email) are not enabled.</p>
            </Card>
          )}

          {section === 'appearance' && (
            <Card title="Appearance" desc="Interface look & feel. Applies instantly and is remembered on this device.">
              <label className="block text-[11px] uppercase tracking-wide text-white/40 mb-2">Theme</label>
              <Seg value={prefs.theme} onChange={(v) => updatePrefs({ theme: v })} options={[{ value: 'dark', label: 'Dark' }, { value: 'warm', label: 'Warm' }, { value: 'light', label: 'Light' }]} />
              <label className="block text-[11px] uppercase tracking-wide text-white/40 mb-2 mt-4">Font Size</label>
              <Seg value={prefs.fontSize} onChange={(v) => updatePrefs({ fontSize: v })} options={[{ value: 'sm', label: 'Small' }, { value: 'md', label: 'Medium' }, { value: 'lg', label: 'Large' }]} />
              <label className="block text-[11px] uppercase tracking-wide text-white/40 mb-2 mt-4">Density</label>
              <Seg value={prefs.density || 'comfortable'} onChange={(v) => updatePrefs({ density: v })} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
              <div className="mt-3">
                <Toggle on={!!prefs.reduceMotion} onChange={(v) => updatePrefs({ reduceMotion: v })} label="Reduce Motion" desc="Minimise animations and transitions." />
                <Toggle on={!!prefs.compactSidebar} onChange={setCompact} label="Compact Sidebar" desc="Collapse the sidebar to icons by default." />
              </div>
            </Card>
          )}

          {section === 'users' && isAdmin && (
            <>
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
                  {Object.keys(staffPerms).length === 0 ? <p className="text-[11px] text-white/30 px-1">No staff members yet.</p> : Object.entries(staffPerms).map(([email, p]) => (
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
            </>
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
                      <span className="text-[11px] text-white/40">{enabledCount} of {totalCount} permissions enabled</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}><AlertTriangle size={10} /> High-risk</span>
                    </div>
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
                );
              })()}
            </Card>
          )}

          {section === 'security' && (
            <Card title="Security" desc="Session & sign-in. Roles are managed under Users & Roles.">
              <Sel label="Session Timeout" value={prefs.sessionTimeout || '30'} onChange={(v) => updatePrefs({ sessionTimeout: v })} options={[{ value: '15', label: '15 minutes' }, { value: '30', label: '30 minutes' }, { value: '60', label: '1 hour' }, { value: '0', label: 'Never' }]} />
              <div className="mt-4 space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-white/40">Signed in as</span><span className="text-white/80 truncate ml-2">{userEmail || '—'}</span></div>
                <div className="flex justify-between"><span className="text-white/40">Role</span><span className="text-white/80">{demoMode ? (demoAdmin ? 'Demo Admin' : 'Demo User') : (isAdmin ? 'Admin' : 'Staff')}</span></div>
                <div className="flex justify-between"><span className="text-white/40">Firebase</span><span style={{ color: online ? '#34d399' : '#ef4444' }}>{online ? 'Connected' : 'Offline'}</span></div>
                <div className="flex justify-between"><span className="text-white/40">Last sync</span><span className="text-white/70">{lastSync ? lastSync.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</span></div>
              </div>
              <p className="text-[11px] text-white/35 mt-3">Password changes and device sessions are managed through your Firebase authentication account.</p>
            </Card>
          )}

          {section === 'backup' && isAdmin && (
            <>
              <Card title="Backup & Data" desc="Download a full JSON copy of every record, or restore from a backup file.">
                <div className="flex flex-col sm:flex-row gap-2">
                  <button onClick={onBackup} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-[#d4af37] bg-[#d4af37]/10 border border-[#d4af37]/30 hover:bg-[#d4af37]/20 flex items-center justify-center gap-2"><Download size={15} /> Backup now</button>
                  <button onClick={onRestore} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white/70 bg-white/5 border border-white/10 hover:bg-white/10 flex items-center justify-center gap-2"><Upload size={15} /> Restore from file</button>
                </div>
                <div className="flex justify-between text-[11px] pt-3"><span className="text-white/40">Last backup</span><span className="text-white/70">{lastBackup ? new Date(lastBackup).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never'}</span></div>
              </Card>
              <div className="rounded-2xl p-5" style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <h3 className="text-sm font-bold text-red-300/80 mb-1">Data Safety & Recovery</h3>
                <p className="text-xs text-white/45 mb-3">Reset moves the whole shop into a 7-day Recovery Vault you can restore from.</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                  {[['Last Backup', lastBackup ? new Date(lastBackup).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'], ['Last Reset', recoveryMeta?.createdAt ? new Date(recoveryMeta.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'], ['Recovery', recoveryActive ? 'Yes' : 'No'], ['Days Left', recoveryActive ? `${daysRemaining}` : '—']].map(([k, v]) => (
                    <div key={k} className="rounded-lg px-3 py-2" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}><div className="text-[9px] uppercase tracking-wide text-white/35">{k}</div><div className="text-sm font-semibold text-white/85">{v}</div></div>
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
            </>
          )}

          {section === 'about' && (
            <Card title="About">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                {[['Version', `v${APP_VERSION}`], ['Product', 'Balaji Auto OS'], ['Database', demoMode ? 'Demo (local)' : 'Firebase Firestore'], ['Connection', online ? 'Connected' : 'Offline'], ['Total records', totalRecords.toLocaleString('en-IN')], ['Support', 'support@balajiautos.com']].map(([k, v]) => (
                  <div key={k} className="flex justify-between rounded-lg px-3 py-2" style={{ background: 'rgba(var(--fg-rgb),0.03)' }}><span className="text-white/45">{k}</span><span className="text-white/85">{v}</span></div>
                ))}
              </div>
            </Card>
          )}

          {editableSections.includes(section) && (
            <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.2)' }}>
              <span className="text-[11px] text-white/45">{dirty ? 'You have unsaved changes' : 'All changes saved'}</span>
              <div className="flex gap-2">
                <button onClick={() => setBiz(bizSaved)} disabled={!dirty} className="px-4 py-2 rounded-xl text-xs font-semibold bg-white/5 border border-white/10 text-white/70 disabled:opacity-40">Cancel</button>
                <button onClick={saveBiz} disabled={!dirty} className="px-5 py-2 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] disabled:opacity-40">Save Changes</button>
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
    </PageShell>
  );
}

// Phase 8.5 — collapsible left sidebar (desktop) / drawer (mobile).
// Sidebar grouped into collapsible workflow sections. `id`s are the SAME activeTab
// keys — routing/permissions unchanged. `badge` names a live counter; `admin` gates.
const NAV_GROUPS = [
  { key: 'dashboard', header: null, items: [
    { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
  ] },
  { key: 'operations', header: 'Operations', items: [
    { id: 'jobcards', label: 'Job Cards', icon: ClipboardList, badge: 'jobcards' },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'vehicles', label: 'Vehicles', icon: Car },
    { id: 'billing', label: 'Billing', icon: Receipt },
    { id: 'sales', label: 'Sales', icon: ShoppingCart },
    { id: 'services', label: 'Services', icon: Wrench },
  ] },
  { key: 'inventory', header: 'Inventory', items: [
    { id: 'inventory', label: 'Inventory', icon: Package, badge: 'inventory' },
    { id: 'suppliers', label: 'Suppliers', icon: Truck },
    { id: 'stockin', label: 'Stock In', icon: PackagePlus },
    { id: 'stockout', label: 'Stock Out', icon: Send },
  ] },
  { key: 'bi', header: 'Business Intelligence', items: [
    { id: 'analytics', label: 'Analytics', icon: BarChart3, admin: true },
    { id: 'reports', label: 'Reports', icon: FileText },
  ] },
  { key: 'communication', header: 'Communication', items: [
    { id: 'alerts', label: 'Alerts', icon: AlertTriangle, badge: 'alerts' },
    { id: 'reminders', label: 'Reminders', icon: Bell, badge: 'reminders' },
  ] },
  { key: 'administration', header: 'Administration', items: [
    { id: 'settings', label: 'Settings', icon: Settings },
  ] },
];
const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
// which group holds a given tab id (used to auto-expand the active section)
const GROUP_OF_TAB = NAV_GROUPS.reduce((acc, g) => { g.items.forEach((it) => { acc[it.id] = g.key; }); return acc; }, {});

// ---- Demo permissions ----------------------------------------------------
// Owner/Admin decides what a Demo USER may do. Stored locally; consulted by the
// destructive-action guards. Default: everything a demo user could mutate is OFF
// (safe), read-only actions ON. Keys map to actions checked via demoCan().
const DEMO_PERM_DEFAULTS = {
  deleteInventory: false, deleteCustomers: false, deleteVehicles: false, deleteSuppliers: false,
  deleteJobCards: false, deleteInvoices: false, deleteSales: false, resetDemo: false,
  importExcel: false, exportExcel: true, backup: false, restore: false,
  editPricing: true, changeStock: true, manageStaff: false, accessSettings: true,
  viewAnalytics: true, viewReports: true,
};
const DEMO_PERM_KEY = 'maruti_demo_perms';
// Enterprise grouping for the Demo Permissions settings page. Each entry maps a
// permission KEY (unchanged — logic still reads these via demoCan()) to a human
// title, a one-line description, and a `danger` flag for high-risk actions.
// Grouped by module the way an admin thinks about the app.
const DEMO_PERM_GROUPS = [
  { module: 'Inventory', icon: 'Package', items: [
    { key: 'deleteInventory', title: 'Delete Inventory', desc: 'Allow demo users to permanently delete inventory parts.', danger: true },
    { key: 'changeStock', title: 'Change Stock', desc: 'Allow adjusting stock levels, stock-in and stock-out.' },
    { key: 'importExcel', title: 'Import Excel', desc: 'Allow bulk-importing parts from an Excel/CSV file.' },
    { key: 'exportExcel', title: 'Export Excel', desc: 'Allow exporting inventory and other data to Excel/CSV.' },
  ] },
  { module: 'Customers', icon: 'Users', items: [
    { key: 'deleteCustomers', title: 'Delete Customers', desc: 'Allow permanently deleting customer records.', danger: true },
  ] },
  { module: 'Vehicles', icon: 'Car', items: [
    { key: 'deleteVehicles', title: 'Delete Vehicles', desc: 'Allow permanently deleting vehicle records.', danger: true },
  ] },
  { module: 'Job Cards', icon: 'ClipboardList', items: [
    { key: 'deleteJobCards', title: 'Delete Job Cards', desc: 'Allow permanently deleting job cards.', danger: true },
  ] },
  { module: 'Billing', icon: 'Receipt', items: [
    { key: 'deleteInvoices', title: 'Delete Invoices', desc: 'Allow permanently deleting invoices and estimates.', danger: true },
    { key: 'deleteSales', title: 'Delete Sales', desc: 'Allow removing entries from the sales ledger.', danger: true },
    { key: 'editPricing', title: 'Edit Pricing', desc: 'Allow changing rates, discounts and line pricing on invoices.' },
  ] },
  { module: 'Suppliers', icon: 'Truck', items: [
    { key: 'deleteSuppliers', title: 'Delete Suppliers', desc: 'Allow permanently deleting supplier records.', danger: true },
  ] },
  { module: 'Administration', icon: 'ShieldCheck', items: [
    { key: 'manageStaff', title: 'Manage Staff', desc: 'Allow adding, removing and editing staff members and their roles.', danger: true },
    { key: 'accessSettings', title: 'Access Settings', desc: 'Allow opening the Settings area and changing preferences.' },
    { key: 'backup', title: 'Backup', desc: 'Allow creating a full data backup file.', danger: true },
    { key: 'restore', title: 'Restore', desc: 'Allow restoring data from a backup, overwriting current data.', danger: true },
    { key: 'resetDemo', title: 'Reset Demo Data', desc: 'Allow wiping and re-seeding the demo dataset.', danger: true },
  ] },
  { module: 'Reports & Analytics', icon: 'BarChart3', items: [
    { key: 'viewReports', title: 'View Reports', desc: 'Allow opening the Reports page and exporting reports.' },
    { key: 'viewAnalytics', title: 'View Analytics', desc: 'Allow opening the Analytics dashboard and charts.' },
  ] },
];
function loadDemoPerms() {
  try { return { ...DEMO_PERM_DEFAULTS, ...(JSON.parse(localStorage.getItem(DEMO_PERM_KEY) || '{}')) }; } catch { return { ...DEMO_PERM_DEFAULTS }; }
}
const THEME_STOPS = [
  { key: 'dark', label: 'Dark', pos: 0 },
  { key: 'warm', label: 'Warm', pos: 50 },
  { key: 'light', label: 'Light', pos: 100 },
];
const themeFromPos = (p) => THEME_STOPS.reduce((b, s) => (Math.abs(s.pos - p) < Math.abs(b.pos - p) ? s : b), THEME_STOPS[0]).key;
const posFromTheme = (k) => (THEME_STOPS.find((s) => s.key === k) || THEME_STOPS[0]).pos;
function applyThemeGlobally(t) {
  try { const p = JSON.parse(localStorage.getItem('maruti_prefs') || '{}'); p.theme = t; localStorage.setItem('maruti_prefs', JSON.stringify(p)); window.dispatchEvent(new CustomEvent('maruti-prefs')); } catch {}
  document.documentElement.setAttribute('data-theme', t);
}

function SidebarTheme({ collapsed }) {
  const [theme, setTheme] = useState(() => { try { return JSON.parse(localStorage.getItem('maruti_prefs') || '{}').theme || 'dark'; } catch { return 'dark'; } });
  const [pos, setPos] = useState(() => { try { return posFromTheme(JSON.parse(localStorage.getItem('maruti_prefs') || '{}').theme || 'dark'); } catch { return 0; } });
  useEffect(() => {
    const sync = () => { try { const t = JSON.parse(localStorage.getItem('maruti_prefs') || '{}').theme || 'dark'; setTheme(t); setPos(posFromTheme(t)); } catch {} };
    window.addEventListener('maruti-prefs', sync);
    return () => window.removeEventListener('maruti-prefs', sync);
  }, []);
  const pickPreset = (k) => { setTheme(k); setPos(posFromTheme(k)); applyThemeGlobally(k); };
  if (collapsed) return null;
  return (
    <div className="mx-2 mb-1 p-2.5 rounded-xl" style={{ background: 'rgba(var(--fg-rgb),0.02)', border: '1px solid rgba(var(--fg-rgb),0.07)' }}>
      <span className="block text-[10px] uppercase tracking-wide text-white/35 px-0.5 mb-1.5">Theme</span>
      <div className="flex gap-0.5 p-0.5 rounded-lg" style={{ background: 'rgba(var(--fg-rgb),0.04)' }}>
        {THEME_STOPS.map((s) => (
          <button key={s.key} type="button" onClick={() => pickPreset(s.key)} title={s.label} aria-pressed={theme === s.key}
            className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition active:scale-95 ${theme === s.key ? 'bg-gradient-to-r from-[#d4af37] to-[#aa801e] text-black shadow' : 'text-white/55 hover:text-white/90'}`}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Sidebar({ activeTab, setActiveTab, collapsed, setCollapsed, mobileOpen, setMobileOpen, isAdmin, alertCount, reminderCount = 0, jobCount = 0, inventoryCount = 0, status }) {
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setMobileOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen, setMobileOpen]);
  const width = collapsed ? 72 : 280;
  const go = (id) => { setActiveTab(id); setMobileOpen(false); };
  const badgeFor = (key) => ({ alerts: alertCount, reminders: reminderCount, jobcards: jobCount, inventory: inventoryCount }[key] || 0);

  // collapsible sections — persisted, auto-expand the active section.
  const [openGroups, setOpenGroups] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem('maruti_nav_groups') || 'null'); if (saved) return saved; } catch {}
    return NAV_GROUPS.reduce((a, g) => { a[g.key] = true; return a; }, {});
  });
  useEffect(() => { try { localStorage.setItem('maruti_nav_groups', JSON.stringify(openGroups)); } catch {} }, [openGroups]);
  // Self-heal a stranded body-scroll lock. If a modal ever failed to clean up, the
  // page would be silently unscrollable with nothing on screen to explain it; this
  // releases the lock whenever we navigate and nothing is actually open.
  useEffect(() => { assertBodyUnlockedIfNoModals(); }, [activeTab]);
  useEffect(() => { const gk = GROUP_OF_TAB[activeTab]; if (gk) setOpenGroups((s) => (s[gk] ? s : { ...s, [gk]: true })); }, [activeTab]);
  const toggleGroup = (key) => setOpenGroups((s) => ({ ...s, [key]: !s[key] }));

  const Item = ({ it }) => {
    const active = activeTab === it.id;
    const badge = it.badge ? badgeFor(it.badge) : 0;
    return (
      <button onClick={() => go(it.id)} title={collapsed ? it.label : undefined} aria-current={active ? 'page' : undefined}
        className={`group relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${active ? 'text-[#d4af37] font-semibold' : 'text-white/55 hover:bg-white/[0.06] hover:text-white/90'}`}
        style={active ? { background: 'linear-gradient(90deg, rgba(212,175,55,0.16), rgba(212,175,55,0.05))', boxShadow: '0 0 0 1px rgba(212,175,55,0.18)' } : undefined}>
        {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full" style={{ background: 'linear-gradient(180deg,#e8c84a,#aa801e)' }} />}
        <it.icon size={18} className={`flex-shrink-0 transition-colors ${active ? 'text-[#d4af37]' : 'text-white/50 group-hover:text-[#d4af37]'}`} />
        {!collapsed && <span className="flex-1 text-left truncate">{it.label}</span>}
        {!collapsed && badge > 0 && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${it.badge === 'alerts' ? 'bg-red-500/20 text-red-400' : 'bg-[#d4af37]/20 text-[#d4af37]'}`}>{badge > 99 ? '99+' : badge}</span>}
        {collapsed && badge > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full" style={{ background: it.badge === 'alerts' ? '#f87171' : '#d4af37' }} />}
      </button>
    );
  };
  const inner = (
    <div className="flex flex-col h-full" style={{ width }}>
      <div className="flex items-center gap-2 px-4 py-4 border-b border-white/8">
        <span className="flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0 overflow-hidden bg-gradient-to-br from-[#e8c84a] to-[#aa801e]">
          <img src="/icons/icon-512.png" alt="Sri Baba Balaji Maruti Care" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        </span>
        {!collapsed && <span className="min-w-0"><span className="block text-xs font-bold text-[#d4af37] leading-tight truncate">SRI BABA BALAJI</span><span className="block text-[10px] text-white/40 truncate">MARUTI CARE</span></span>}
      </div>
      <nav className="flex-1 overflow-y-auto dark-scroll px-2 py-3 space-y-0.5" aria-label="Main navigation">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((it) => !it.admin || isAdmin);
          if (!items.length) return null;
          const open = collapsed ? true : (openGroups[group.key] !== false);
          const groupBadge = items.reduce((s, it) => s + (it.badge ? badgeFor(it.badge) : 0), 0);
          return (
            <div key={group.key} className="pt-1.5">
              {!collapsed && group.header && (
                <button onClick={() => toggleGroup(group.key)} aria-expanded={open}
                  className="w-full flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white/30 hover:text-white/55 transition">
                  <ChevronDown size={12} className="transition-transform duration-200" style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
                  <span className="flex-1 text-left">{group.header}</span>
                  {!open && groupBadge > 0 && <span className="w-1.5 h-1.5 rounded-full bg-[#d4af37]" />}
                </button>
              )}
              {collapsed && group.header && <div className="mx-3 my-2 h-px" style={{ background: 'rgba(var(--fg-rgb),0.07)' }} />}
              <div className="grid transition-all duration-200 ease-out" style={{ gridTemplateRows: open ? '1fr' : '0fr' }}>
                <div className="overflow-hidden"><div className="space-y-0.5 pt-0.5">{items.map((it) => <Item key={it.id} it={it} />)}</div></div>
              </div>
            </div>
          );
        })}
      </nav>
      <SidebarTheme collapsed={collapsed} />
      {!collapsed && (
        <button onClick={() => go('settings')} className="m-2 p-2.5 rounded-xl flex items-center gap-2 text-left hover:bg-white/5 transition" style={{ background: 'rgba(var(--fg-rgb),0.02)', border: '1px solid rgba(var(--fg-rgb),0.07)' }} title="Open Settings for full system info">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: status.color }} />
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-semibold leading-tight" style={{ color: status.color }}>{status.label}</span>
            <span className="block text-[10px] text-white/35 truncate">v{APP_VERSION} · {status.records} records</span>
          </span>
          <Settings size={13} className="text-white/25 flex-shrink-0" />
        </button>
      )}
      <button onClick={() => setCollapsed((v) => !v)} className="hidden md:flex items-center justify-center gap-2 m-2 py-2 rounded-lg text-xs text-white/40 hover:bg-white/5 hover:text-white/70 transition" title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        <ChevronDown size={14} className={`transition-transform ${collapsed ? '-rotate-90' : 'rotate-90'}`} /> {!collapsed && 'Collapse'}
      </button>
    </div>
  );
  return (
    <>
      {/* Desktop */}
      <aside className="hidden md:block fixed left-0 top-0 bottom-0 z-50 transition-all" style={{ width, background: 'var(--surface-0)', borderRight: '1px solid rgba(212,175,55,0.12)' }}>{inner}</aside>
      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-[60]">
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 overflow-y-auto dark-scroll" style={{ width: 280, background: 'var(--surface-0)', borderRight: '1px solid rgba(212,175,55,0.15)', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>{inner}</aside>
        </div>
      )}
    </>
  );
}

export default function InventoryDashboard() {
  const router = useRouter();
  const { user, role, perms, dbAdmins = [], staffPerms = {}, bootstrapAdmins = [], demoMode = false, demoAdmin = false, exitDemo } = useAuth(); // user + role + permissions + admin/staff lists + demo
  const isAdmin = role === 'admin'; // FIX-02: gate sensitive actions
  // Per-person staff permissions (admins implicitly have all). These let an
  // admin grant a non-admin staff member specific abilities from Settings.
  const canSeeCost = isAdmin || !!perms?.costPrices;
  const canDelete = isAdmin || !!perms?.deletes;
  // Demo Admin acts as an admin over DEMO data (full CRUD on inventory, suppliers,
  // alerts, etc.) while production-account features stay gated on real isAdmin.
  const canManageData = isAdmin || demoAdmin;
  const canExport = isAdmin || !!perms?.exports;
  // In Guest Demo mode the app is strictly read-only: any write is intercepted
  // here with a friendly message so the sample data is never modified.
  function demoGuard() {
    if (demoMode) { toast('This is a read-only demo — sign in to make changes.', { icon: '🔒' }); return true; }
    return false;
  }
  // Demo permission map (owner-configured). Live-updates when Settings saves it.
  const [demoPerms, setDemoPerms] = useState(() => loadDemoPerms());
  useEffect(() => {
    const refresh = () => setDemoPerms(loadDemoPerms());
    window.addEventListener('maruti-demo-perms', refresh);
    return () => window.removeEventListener('maruti-demo-perms', refresh);
  }, []);
  // True if the current demo USER is allowed to perform `action` (per owner config).
  // Demo Admin and production always pass. Undefined action → treat as destructive.
  const demoCan = useCallback((action) => {
    if (!demoMode || demoAdmin) return true;
    return action ? !!demoPerms[action] : false;
  }, [demoMode, demoAdmin, demoPerms]);
  // Demo Admin may modify demo data; Demo User may not perform destructive actions.
  function protectedDemoToast(adminDisabled = false) {
    toast(
      adminDisabled
        ? 'This action has been disabled by the administrator.'
        : 'Protected Demo Environment\nThis is a shared demo workspace. Delete, archive, restore, and reset actions are disabled to maintain a consistent experience for all users.',
      { icon: '🔒', duration: 5000, style: { maxWidth: 420 } }
    );
  }
  // Returns true (and shows a message) when a Demo USER is blocked from `action`.
  // If the owner has granted that action, the demo user is allowed through.
  function blockedDestructiveForDemoUser(action) {
    if (demoMode && !demoAdmin) {
      if (action && demoPerms[action]) return false; // owner enabled it
      protectedDemoToast(!!action);
      return true;
    }
    return false;
  }
  const [inventory, setInventory] = useState([]);
  const [sales, setSales] = useState([]); // recent sales ledger (per-part analytics)
  const [rollups, setRollups] = useState([]); // FIX-07: unbounded monthly aggregates
  const [restocks, setRestocks] = useState([]); // ADD-02: restock ledger
  const [auditLog, setAuditLog] = useState([]); // ADD-06: audit entries
  const [customCategories, setCustomCategories] = useState([]); // Task 1: user-added categories
  const [customVehicles, setCustomVehicles] = useState([]); // Task 1: user-added vehicles
  const [loading, setLoading] = useState(true);
  // ADD-08: connection + sync status
  const [online, setOnline] = useState(true);
  const [pendingWrites, setPendingWrites] = useState(false);
  const [lastSync, setLastSync] = useState(null); // IMPORTANT: last successful sync
  const [lastBackup, setLastBackup] = useState(null); // Phase B: last backup timestamp
  const isMobile = useIsMobile(); // phones get full-screen form pages instead of modals
  const [invSubView, setInvSubView] = useState('dashboard'); // Phase 1: Inventory module sub-pages (dashboard | parts)
  const [supSubView, setSupSubView] = useState('directory'); // Suppliers module sub-pages (directory | performance)
  const [showPOBuilder, setShowPOBuilder] = useState(false); // global PO builder drawer
  // Import/Export history (local, capped at 50) — namespaced so demo & production never share it.
  const [ioHistory, setIoHistory] = useState([]);
  const ioHistoryKey = demoMode ? 'maruti_io_history_demo' : 'maruti_io_history_prod';
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(ioHistoryKey) || '[]'); setIoHistory(Array.isArray(v) ? v : []); } catch { setIoHistory([]); } }, [ioHistoryKey]);
  const recordIO = useCallback((type, count) => {
    const entry = { type, count: Number(count) || 0, ts: Date.now() };
    setIoHistory((prev) => { const next = [entry, ...prev].slice(0, 50); try { localStorage.setItem(ioHistoryKey, JSON.stringify(next)); } catch {} return next; });
  }, [ioHistoryKey]);
  // Parts bulk selection
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
  const toggleSelect = useCallback((id) => setSelectedIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const bulkArchive = () => {
    const ids = [...selectedIds].filter((id) => { const p = inventory.find((x) => x.id === id); return p && !p.archived; });
    if (!ids.length) { toast('Selected parts are already archived.'); return; }
    ids.forEach((id) => handleArchive(id));
    clearSelection();
  };
  useEffect(() => {
    try { const v = localStorage.getItem('maruti_last_backup'); if (v) setLastBackup(Number(v)); } catch {}
  }, []);
  // Phase 8.4: global Ctrl/Cmd+K opens the command palette (Esc handled inside).
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setCmdkOpen((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [connError, setConnError] = useState(null); // Issue 1/6: DB connection problem
  const [syncNonce, setSyncNonce] = useState(0); // Issue 6: bump to re-subscribe (Retry)
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    if (typeof navigator !== 'undefined') setOnline(navigator.onLine);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState(''); // UPDATE-01
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 150);
    return () => clearTimeout(t);
  }, [search]);
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [showModal, setShowModal] = useState(false);
  const [editPart, setEditPart] = useState(null);
  const duplicateOriginRef = useRef(null); // Section 2: origin id when creating a copy
  const backupInputRef = useRef(null); // Issue 14: hidden file input for Restore
  const actionsRef = useRef(null); // Critical #3: Actions menu outside-click ref
  const [actionsOpen, setActionsOpen] = useState(false); // header Actions ▼ menu
  const [cmdkOpen, setCmdkOpen] = useState(false); // Ctrl+K command palette
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Continuous login→app transition: login sets maruti_arrival before departing;
  // we settle in from the light bloom, then clear the flag.
  const [arriving, setArriving] = useState(false);
  // Keep a branded splash on top until the first data load resolves, then fade it
  // out — this removes the blank/white content frame right after login.
  const [bootFading, setBootFading] = useState(false);
  const [bootHidden, setBootHidden] = useState(false);
  useEffect(() => {
    if (loading || bootHidden) return undefined;
    // data has arrived — fade the splash, then unmount it
    const t1 = setTimeout(() => setBootFading(true), 60);
    const t2 = setTimeout(() => setBootHidden(true), 460);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [loading, bootHidden]);
  useEffect(() => {
    try {
      if (sessionStorage.getItem('maruti_arrival') === '1') {
        sessionStorage.removeItem('maruti_arrival');
        if (!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
          setArriving(true);
          setTimeout(() => setArriving(false), 950);
        }
      }
    } catch {}
  }, []);
  // Apply saved appearance preferences on load (font size, reduce motion) so they persist across reloads and tabs.
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem('maruti_prefs') || '{}');
      const sizes = { sm: '15px', md: '16px', lg: '17.5px' };
      if (p.fontSize) document.documentElement.style.fontSize = sizes[p.fontSize] || '16px';
      document.documentElement.classList.toggle('reduce-motion', !!p.reduceMotion);
      document.documentElement.setAttribute('data-theme', p.theme || 'dark');
    } catch {}
  }, []);
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);
  // Critical #1: alert read/archive state lives here so the sidebar badge and the
  // Alert Center share one source and update together. Persisted across refresh.
  const [readAlerts, setReadAlerts] = useState(new Set());
  const [archivedAlerts, setArchivedAlerts] = useState(new Set());
  useEffect(() => {
    try {
      setReadAlerts(new Set(JSON.parse(localStorage.getItem('maruti_read_alerts') || '[]')));
      setArchivedAlerts(new Set(JSON.parse(localStorage.getItem('maruti_archived_alerts') || '[]')));
    } catch {}
  }, []);
  useEffect(() => {
    try { setSidebarCollapsed(localStorage.getItem('maruti_sidebar_collapsed') === '1'); } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('maruti_sidebar_collapsed', sidebarCollapsed ? '1' : '0'); } catch {}
  }, [sidebarCollapsed]);
  const [restoreConfirm, setRestoreConfirm] = useState(false); // typed-RESTORE modal
  const [restoreText, setRestoreText] = useState('');
  const pendingRestoreFile = useRef(null);
  const [listening, setListening] = useState(false);
  const [voiceLang, setVoiceLang] = useState('en-IN'); // CHANGE-04: en-IN | te-IN
  const [liveTranscript, setLiveTranscript] = useState(''); // Fix 1: live voice feedback
  const [saving, setSaving] = useState(false); // Fix 3: loading state for save, owned by parent
  const recognitionRef = useRef(null); // hold the recognition instance so it isn't GC'd
  // Fix 5: single root-level hover preview, tracked by mouse coordinates
  const [hoveredImage, setHoveredImage] = useState({ src: null, x: 0, y: 0 });
  // Perf hardening: throttle mouse-move updates to one state change per frame
  // (otherwise a large base64 preview re-renders the whole table on every pixel).
  const hoverRafRef = useRef(0);
  const hoverCoordsRef = useRef({ x: 0, y: 0 });
  const handleImageHover = useCallback((src, x, y) => { if (src) setHoveredImage({ src, x, y }); }, []);
  const handleImageMove = useCallback((x, y) => {
    hoverCoordsRef.current = { x, y };
    if (hoverRafRef.current) return;
    hoverRafRef.current = requestAnimationFrame(() => {
      hoverRafRef.current = 0;
      const c = hoverCoordsRef.current;
      setHoveredImage((h) => (h.src ? { ...h, x: c.x, y: c.y } : h));
    });
  }, []);
  const handleImageLeave = useCallback(() => {
    if (hoverRafRef.current) {
      cancelAnimationFrame(hoverRafRef.current);
      hoverRafRef.current = 0;
    }
    setHoveredImage({ src: null, x: 0, y: 0 });
  }, []);

  // New: tabs, suppliers, logout confirmation
  // DEEP LINKING. All 16 modules live behind a single route, with the active module
  // held in useState. That meant:
  //   - browser Back EXITED the app instead of returning to the previous module
  //   - a refresh (or the PWA being killed on a phone) dumped you back on the Dashboard
  //   - you could not bookmark or share "the Billing screen" with a colleague
  //   - a mis-tap on Back mid-invoice lost the tab
  // Syncing the tab to the URL hash fixes all of that with ZERO UI change and no
  // routing rewrite: #billing, #inventory, #reports. The hash is used rather than a
  // real route because the modules share one mounted component tree — converting them
  // to pages would remount everything and is a v2-scale change.
  const [activeTab, setActiveTabRaw] = useState('overview');

  // Restore the tab from the URL on first paint (and honour Back/Forward).
  useEffect(() => {
    const fromHash = () => {
      const h = (typeof window !== 'undefined' ? window.location.hash : '').replace(/^#/, '');
      return TAB_KEYS.includes(h) ? h : null;
    };
    const initial = fromHash();
    if (initial) setActiveTabRaw(initial);

    const onPop = () => { const t = fromHash(); if (t) setActiveTabRaw(t); };
    window.addEventListener('hashchange', onPop);
    return () => window.removeEventListener('hashchange', onPop);
  }, []);

  const setActiveTab = useCallback((tab) => {
    setActiveTabRaw(tab);
    if (typeof window === 'undefined') return;
    // replaceState for the first tab, pushState afterwards, so Back walks the modules
    // the user actually visited instead of stacking duplicates.
    if (window.location.hash.replace(/^#/, '') !== tab) {
      window.history.pushState(null, '', `#${tab}`);
    }
  }, []);
  // Job Cards — v1 stores locally per workspace (demo/prod); Firestore sync is a later step.
  const [jobCards, setJobCards] = useState([]);
  useEffect(() => {
    if (!demoMode) return; // prod driven by subscription below
    try {
      const saved = JSON.parse(localStorage.getItem('maruti_jobcards_demo') || '[]');
      if (saved.length === 0) { const s = getGarageSeed().jobCards; setJobCards(s); try { localStorage.setItem('maruti_jobcards_demo', JSON.stringify(s)); } catch {} }
      else setJobCards(saved);
    } catch { setJobCards([]); }
  }, [demoMode]);
  // THE PERSISTENCE ADAPTER. One interface, two backends (demo -> browser storage,
  // production -> Firestore). Callers no longer write `if (demoMode)`, so the two modes
  // cannot silently diverge — which was the root cause of every data bug this project
  // has had (fabricated demo ledger, re-seed race, audit lost in demo, ISO dates dropped).
  const store = useMemo(() => createStore(demoMode), [demoMode]);

  // Job cards are keyed by jobNo (their natural id). Persist with per-doc diff.
  const jobCardsRef = useRef([]);
  useEffect(() => { jobCardsRef.current = jobCards; }, [jobCards]);
  const persistJobCardsDiff = (prev, next) => {
    // Job cards key on jobNo (their natural id), NOT on `id` — hence the idField arg.
    // Getting this wrong would write every card to a doc named "undefined".
    store.syncAll(COLLECTIONS.JOB_CARDS, prev, next, 'jobNo').catch((e) => {
      console.error('[jobCards] sync failed — change is in memory but may not have saved.', e);
      toast.error('Could not save job card. Check your connection.');
    });
  };
  useEffect(() => {
    if (demoMode) return;
    const unsub = onSnapshot(
      query(collection(db, 'jobCards'), orderBy('createdAt', 'desc'), limit(LIMITS.JOB_CARDS_LIVE)),
      { includeMetadataChanges: true },
      (snap) => { if (!snap.metadata.hasPendingWrites) setJobCards(snap.docs.map((d) => ({ ...d.data(), jobNo: d.data().jobNo || d.id }))); },
      (err) => console.error('Job cards subscription error:', err)
    );
    return unsub;
  }, [demoMode, syncNonce]);
  // Customers — Firestore-backed in production, local demo dataset in demo mode.
  const [customers, setCustomersRaw] = useState([]);
  // Demo mode: seed from local demo dataset (sandbox, never hits Firestore).
  // Production: hydrated by the live onSnapshot subscription below.
  useEffect(() => {
    if (!demoMode) return; // prod is driven by the Firestore subscription
    try {
      const saved = JSON.parse(localStorage.getItem('maruti_customers_demo') || '[]');
      if (saved.length === 0) { const s = getGarageSeed().customers; setCustomersRaw(s); try { localStorage.setItem('maruti_customers_demo', JSON.stringify(s)); } catch {} }
      else setCustomersRaw(saved);
    } catch { setCustomersRaw([]); }
  }, [demoMode]);
  // Diff two arrays of {id,...} docs and write only what changed to a Firestore
  // collection: upsert changed/new docs, delete removed ones. Keeps per-document
  // granularity (no whole-array rewrites) so concurrent edits from other devices
  // aren't clobbered. Offline writes queue and replay automatically.
  const persistDocsDiff = useCallback((coll, prev, next) => {
    // Delegates to the adapter, which upserts what changed and deletes what disappeared
    // — verified op-for-op identical to the previous inline implementation (5/5), including
    // the "nothing changed -> write NOTHING" case that protects the Firestore bill.
    store.syncAll(coll, prev, next).catch((e) => {
      console.error(`[${coll}] sync failed — the change is in memory but may not have saved.`, e);
      toast.error(`Could not save ${coll}. Check your connection.`);
    });
  }, [store]);
  const setCustomers = (updater) => {
    setCustomersRaw((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      persistDocsDiff(COLLECTIONS.CUSTOMERS, prev, next);   // adapter picks the backend
      return next;
    });
  };
  // Live subscription (prod). Customer docs carry their nested vehicles[] inline.
  useEffect(() => {
    if (demoMode) return;
    const unsub = onSnapshot(
      // BOUNDED. This used to stream the whole `customers` collection. Firestore bills
      // per document read, so at 100k customers this cost 100,000 reads on EVERY mount
      // (~$30 across 500 concurrent users, repeated on every reconnect) and put 100k
      // objects into a React array — enough to exhaust a browser tab. The UI only ever
      // shows a searchable window, so we subscribe to a window and page/search the rest.
      query(collection(db, 'customers'), orderBy('createdAt', 'desc'), limit(LIMITS.CUSTOMERS_LIVE)),
      { includeMetadataChanges: true },
      (snap) => { if (!snap.metadata.hasPendingWrites) setCustomersRaw(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); },
      (err) => console.error('Customers subscription error:', err)
    );
    return unsub;
  }, [demoMode, syncNonce]);
  // Billing — invoices persisted per workspace; on save/delete we recompute the
  // owning customer's totalSpent (sum of paid) and outstanding (sum of balances)
  // so Customers / Reminders / Dashboard stay in sync (single source of truth).
  const [invoices, setInvoicesRaw] = useState([]);
  // Hydrate the demo invoice store ONCE. Two things were wrong here:
  //  1. It never seeded from the demo dataset, so Billing started empty while the
  //     Sales/Services ledger was full of history — two stores telling different
  //     stories about the same workshop.
  //  2. It re-ran on every `demoMode` identity change and called setInvoicesRaw(),
  //     which would clobber invoices the user had just created.
  // Now: seed once from getDemoData().invoices (the SAME invoices the ledger is
  // derived from), preferring anything already saved this session.
  const invoicesSeeded = useRef(false);
  useEffect(() => {
    if (!demoMode) { invoicesSeeded.current = false; return; }
    if (invoicesSeeded.current) return;
    invoicesSeeded.current = true;
    purgeStaleDemoData();   // MUST run before we read any cached demo data
    try {
      const saved = JSON.parse(localStorage.getItem('maruti_invoices_demo') || 'null');
      if (Array.isArray(saved) && saved.length) { setInvoicesRaw(saved); return; }
      const seeded = getDemoData().invoices || [];
      setInvoicesRaw(seeded);
      try { localStorage.setItem('maruti_invoices_demo', JSON.stringify(seeded)); } catch {}
    } catch { setInvoicesRaw([]); }
  }, [demoMode]);
  const invoicesRef = useRef([]);
  useEffect(() => { invoicesRef.current = invoices; }, [invoices]);
  const writeInvoices = (next) => {
    persistDocsDiff(COLLECTIONS.INVOICES, invoicesRef.current, next);   // adapter picks the backend
  };
  // Live subscription (prod) for invoices.
  useEffect(() => {
    if (demoMode) return;
    const unsub = onSnapshot(
      query(collection(db, 'invoices'), orderBy('createdAt', 'desc'), limit(LIMITS.INVOICES_LIVE)),
      { includeMetadataChanges: true },
      (snap) => { if (!snap.metadata.hasPendingWrites) setInvoicesRaw(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); },
      (err) => console.error('Invoices subscription error:', err)
    );
    return unsub;
  }, [demoMode, syncNonce]);
  const syncCustomerTotals = (custId, allInvoices) => {
    if (!custId) return;
    const mine = allInvoices.filter((iv) => iv.customerId === custId);
    const totalsOf = (iv) => { if (iv.grandTotal != null) return { grand: Number(iv.grandTotal) || 0, balance: Number(iv.balance) || 0 }; const sub = (iv.lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0); const afterDisc = Math.max(0, sub - (Number(iv.discount) || 0)); const grand = afterDisc + afterDisc * ((Number(iv.gstPct) || 0) / 100); return { grand, balance: Math.max(0, grand - (Number(iv.paid) || 0)) }; };
    const paid = mine.reduce((s, iv) => s + (Number(iv.paid) || 0), 0);
    const outstanding = mine.reduce((s, iv) => s + totalsOf(iv).balance, 0);
    setCustomers((prev) => prev.map((c) => (c.id === custId ? { ...c, totalSpent: paid, outstanding } : c)));
  };
  // Phase 3: automatic inventory sync from Billing. Each invoice remembers the
  // net part quantities it consumed (by partId). On save we apply the DELTA vs.
  // the previously-stored version so edits adjust the difference; on delete we
  // restore. Non-part/labour lines and lines without a partId are ignored.
  const invoicePartQtys = (iv) => {
    const map = {};
    (iv?.lines || []).forEach((l) => { if (l.partId && l.kind === 'Part') map[l.partId] = (map[l.partId] || 0) + (Number(l.qty) || 0); });
    return map;
  };
  // Full revenue snapshot for an invoice: EVERY billable line (parts, labour,
  // services, outside purchases, misc) keyed by a stable line key, each carrying
  // its category, quantity/hours, actual billed revenue (after per-line discount),
  // and cost. Only inventory parts carry a real cost (purchasePrice) — labour and
  // services have zero cost so their profit equals the full charge (spec #11).
  // Keyed by partId for parts (so re-adding the same part aggregates), else by the
  // stable line id, so edits diff correctly.
  const lineCategory = (l) => {
    if (l.partId && l.kind === 'Part') return 'Parts';
    if (l.kind === 'Labour') return 'Labour';
    if (l.kind === 'Service') return 'Service';
    if (l.kind === 'Other') return 'Outside Purchase';
    if (l.kind === 'Part') return 'Parts'; // manual part line (no inventory link)
    return 'Miscellaneous';
  };
  const invoiceRevenueLines = (iv) => {
    const map = {};
    (iv?.lines || []).forEach((l) => {
      if (!(l.desc || '').trim()) return;
      const qty = Number(l.qty) || 0;
      const rate = Number(l.rate) || 0;
      if (qty <= 0 && rate <= 0) return;
      const disc = Number(l.disc) || 0;
      const rev = qty * rate * (1 - disc / 100);
      const key = (l.partId && l.kind === 'Part') ? `part:${l.partId}` : `line:${l.id}`;
      const e = map[key] || { qty: 0, revenue: 0, name: l.desc || '', category: lineCategory(l), partId: (l.partId && l.kind === 'Part') ? l.partId : null, kind: l.kind || 'Part', gst: Number(l.gst) || 0, disc, technician: l.technician || l.tech || '', hsn: l.hsn || '' };
      e.qty += qty; e.revenue += rev; map[key] = e;
    });
    return map;
  };
  // Legacy alias kept for any external callers (returns part lines only).
  const invoicePartSales = (iv) => {
    const map = {};
    const all = invoiceRevenueLines(iv);
    Object.values(all).forEach((e) => { if (e.partId) map[e.partId] = { qty: e.qty, revenue: e.revenue, name: e.name }; });
    return map;
  };
  // Record the NET revenue change of an invoice to the sales ledger + monthly
  // rollup. Now covers EVERY billable category — parts, labour, services, outside
  // purchases, misc — so a garage's full takings (not just spare parts) feed
  // Sales → Reports → Analytics. Idempotent across edits (records only the delta)
  // and reversible on delete (negative delta). Skipped in demo mode (no Firestore).
  // Only inventory parts carry a cost; labour/service profit = full charge (#11).
  // THE TRANSACTION ENGINE.
  // Demo mode runs the EXACT same business logic as production — it used to bail out
  // here, which meant a demo sale reduced stock but never produced Sales / Services /
  // Stock Out / analytics rows, so demo silently behaved differently from the real
  // product. The only difference now is the DESTINATION of the writes: production
  // persists to Firestore, demo persists to local demo state (and can be reset).
  const recordInvoiceSalesDelta = (prior, next) => {
    const before = invoiceRevenueLines(prior); const after = invoiceRevenueLines(next);
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const monthAgg = {};
    const pendingDemoSales = [];
    const ctx = next || prior || {};
    const paidTotal = (ctx.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0) || Number(ctx.paid) || 0;
    const payModes = (ctx.payments || []).map((p) => p.mode).filter(Boolean).join(', ') || ctx.payMode || '';
    const src = next?.invNo || prior?.invNo || '';
    keys.forEach((key) => {
      const b = before[key] || { qty: 0, revenue: 0 };
      const a = after[key] || { qty: 0, revenue: 0, name: '', category: 'Miscellaneous', partId: null, kind: 'Part', gst: 0, disc: 0, technician: '' };
      const dQty = a.qty - b.qty;
      const dRev = a.revenue - b.revenue;
      if (dQty === 0 && Math.abs(dRev) < 0.005) return;
      const meta = after[key] || before[key];
      const isPart = !!meta.partId;
      const part = isPart ? inventory.find((p) => p.id === meta.partId) : null;
      const unitCost = isPart ? (part?.purchasePrice || 0) : 0; // services/labour have no COGS
      const dCost = dQty * unitCost;
      // Catalogue (list) price captured on the invoice line at pick-time. Lets the
      // Sales module report "catalogue Rs.690 -> sold Rs.790 -> extra Rs.100" instead
      // of silently hiding that the part was billed above/below its listed price.
      const listPrice = toNum(meta.listPrice) || (isPart ? toNum(part?.defaultSellingPrice || part?.sellingPrice) : 0);
      const soldUnit = dQty !== 0 ? dRev / dQty : 0;
      const extraRevenue = (isPart && listPrice > 0) ? (soldUnit - listPrice) * dQty : 0;
      const record = {
        partId: meta.partId || null,
        name: (part?.name) || meta.name || '',
        sku: part?.sku || '',
        category: meta.category || 'Miscellaneous',
        revenueType: meta.category || 'Miscellaneous',
        isService: !isPart,
        qty: dQty,
        unitPrice: soldUnit,
        listPrice,
        extraRevenue,
        unitCost,
        revenue: dRev,
        cost: dCost,
        profit: dRev - dCost,
        margin: dRev > 0 ? Math.round(((dRev - dCost) / dRev) * 1000) / 10 : 0,
        partCategory: part?.category || '',
        brands: part ? brandsOf(part) : [],
        gst: meta.gst || 0,
        discount: meta.disc || 0,
        technician: meta.technician || '',
        soldBy: user?.uid || null,
        soldByEmail: user?.email || null,
        source: 'invoice',
        invoiceNo: src,
        customer: ctx.customer || '',
        customerId: ctx.customerId || '',
        vehicle: ctx.vehicle || '',
        regNo: ctx.regNo || '',
        payModes,
        paidAmount: paidTotal,
        outstanding: Math.max(0, (Number(ctx.grandTotal) || 0) - paidTotal),
        createdAt: demoMode ? new Date().toISOString() : serverTimestamp(),
      };
      // Same record, different store. Demo keeps everything in local state so the
      // Sales / Services / Stock Out / Reports / Analytics screens all light up
      // exactly as they would in production — and Reset Demo Data clears it.
      txn(record.isService ? 7 : 6, record.isService ? 'Services record' : 'Sales record', { name: record.name, qty: record.qty, revenue: record.revenue, category: record.category });
      if (demoMode) pendingDemoSales.push({ id: `dsale_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, ...record });
      else addDoc(collection(db, 'sales'), record).catch((e) => console.error('Invoice-sale ledger write will retry when online:', e));
      const now = new Date();
      const mk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const m = monthAgg[mk] || { revenue: 0, cost: 0, profit: 0, units: 0, partsRev: 0, labourRev: 0, serviceRev: 0, outsideRev: 0 };
      m.revenue += dRev; m.cost += dCost; m.profit += dRev - dCost; m.units += dQty;
      const cat = meta.category;
      if (cat === 'Parts') m.partsRev += dRev;
      else if (cat === 'Labour') m.labourRev += dRev;
      else if (cat === 'Service') m.serviceRev += dRev;
      else if (cat === 'Outside Purchase') m.outsideRev += dRev;
      monthAgg[mk] = m;
    });
    // Demo: push the new ledger rows into state (newest first, so the latest
    // transaction always appears at the top of Sales/Services/Stock Out).
    if (demoMode) {
      txn(12, 'DEMO flush -> setSales()', { newRows: pendingDemoSales.length });
      if (pendingDemoSales.length) setSales((prev) => { const nx = [...pendingDemoSales.reverse(), ...prev]; txn(12, 'sales store size', { before: prev.length, after: nx.length }); return nx; });
      return; // rollups are a Firestore aggregate; demo derives its figures from `sales`
    }
    Object.entries(monthAgg).forEach(([mk, m]) => {
      setDoc(doc(db, 'salesRollups', mk), {
        month: mk,
        revenue: increment(m.revenue),
        cost: increment(m.cost),
        profit: increment(m.profit),
        units: increment(m.units),
        partsRevenue: increment(m.partsRev),
        labourRevenue: increment(m.labourRev),
        serviceRevenue: increment(m.serviceRev),
        outsideRevenue: increment(m.outsideRev),
        updatedAt: serverTimestamp(),
      }, { merge: true }).catch((e) => console.error('Invoice rollup write will retry when online:', e));
    });
  };
  const applyStockDelta = (deltaMap) => {
    const ids = Object.keys(deltaMap).filter((id) => deltaMap[id] !== 0);
    if (!ids.length) return;
    setInventory((prev) => {
      // 🔴 DO NOT CLAMP TO ZERO.
      //
      // This used to be Math.max(0, stock + delta), which silently INVENTED INVENTORY:
      //   stock 2, bill 5  -> max(0, 2-5) = 0   (the -3 deficit is destroyed)
      //   cancel, reverse  ->     0 + 5   = 5   (was 2, now 5)
      // The workshop just conjured 3 brake pads out of nothing. The deduction was
      // clamped but the reversal was not, so the diff-based engine stopped being
      // reversible the moment stock hit the floor.
      //
      // A negative stock figure is not a bug to be hidden — it is the TRUTH that the
      // shop floor issued parts it did not have on the books, and the owner must see it
      // to go and reconcile. Hiding it corrupts inventory valuation permanently.
      const next = prev.map((p) => {
        if (!ids.includes(p.id)) return p;
        const updated = (p.stock || 0) + deltaMap[p.id];
        if (updated < 0) {
          console.error(`[TXN] NEGATIVE STOCK: "${p.name}" is now ${updated}. Parts were issued that were not in stock — reconcile physically.`);
        }
        return { ...p, stock: updated, lastSaleAt: deltaMap[p.id] < 0 ? Date.now() : p.lastSaleAt };
      });
      // In demo mode persist to the demo store; in production, write each change to Firestore.
      if (demoMode) {
        // NOT a silent catch. If persistence fails (quota exceeded, storage blocked in
        // private mode), the stock change survives in memory but dies on reload — the
        // user must know, not silently lose the transaction.
        try { sessionStorage.setItem('maruti_demo_inv', JSON.stringify(next)); }
        catch (e) {
          console.error('[TXN] FAILED to persist inventory — this change will be LOST on reload.', e);
          toast.error('Could not save stock change to demo storage. It will be lost on reload.');
        }
      }
      else { ids.forEach((id) => { try { updateDoc(doc(db, 'parts', id), { stock: increment(deltaMap[id]), updatedAt: serverTimestamp() }); } catch (e) { /* offline: local state still reflects it */ } }); }
      return next;
    });
  };
  // Spec: inventory deduction and Sales/Service records happen only once an
  // invoice is realized (fully Paid). An unpaid/partially-paid invoice or estimate
  // contributes nothing yet; moving away from Paid (refund/return/cancel/edit)
  // reverses it. We express this by zeroing the "consumed" snapshot unless the
  // invoice is Paid, then reusing the existing delta machinery — so create / edit /
  // pay / refund / delete all net out correctly and idempotently.
  const isRealized = (iv) => {
    if (!iv || iv.isEstimate) return false;
    if (['Cancelled', 'Refunded', 'Returned'].includes(iv.status)) return false;
    return invStatus(iv) === 'Paid';
  };
  const realizedPartQtys = (iv) => (isRealized(iv) ? invoicePartQtys(iv) : {});
  const realizedRevenue = (iv) => (isRealized(iv) ? iv : { invNo: iv?.invNo, lines: [] });
  // Audit entry that works in BOTH modes. The existing writeAudit() only ever wrote
  // to Firestore, so demo produced no audit trail at all — and invoices never wrote
  // one in either mode. This routes to the same audit store the UI reads from.
  const pushAudit = ({ action, entity, entityId, detail }) => {
    const entry = {
      id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      action,
      entity: entity || '',
      entityId: entityId || '',
      details: detail || '',
      performedBy: user?.uid || null,
      performedByEmail: demoMode ? 'demo@balajiautoos.com' : (user?.email || null),
      createdAt: demoMode ? new Date().toISOString() : serverTimestamp(),
    };
    if (demoMode) {
      // Persist, don't just set state. setAuditLog() alone is in-memory, so the demo
      // audit trail vanished on reload — failing "updates persist after reloading".
      setAuditLog((prev) => {
        const next = [entry, ...(prev || [])].slice(0, 500); // newest first, bounded
        try { sessionStorage.setItem('maruti_demo_audit', JSON.stringify(next)); }
        catch (e) { console.error('[TXN] FAILED to persist audit log.', e); }
        return next;
      });
    } else {
      addDoc(collection(db, 'auditLog'), entry).catch((e) => console.error('Audit write skipped:', e));
    }
  };

  // VEHICLE HISTORY. Vehicles are stored nested on the customer (c.vehicles[]), so
  // "vehicle history" means stamping the serviced vehicle with its last service date,
  // the invoice that did it, and a running lifetime spend. Billing never touched this
  // before, so a vehicle's service record stayed empty no matter how much work it had.
  const touchVehicleHistory = (iv) => {
    const reg = String(iv.regNo || '').trim().toUpperCase();
    const label = String(iv.vehicle || '').trim();
    if (!reg && !label) return;
    const spend = Number(iv.grandTotal) || 0;
    setCustomers((prev) => prev.map((c) => {
      if (iv.customerId && c.id !== iv.customerId) return c;
      const vs = c.vehicles || [];
      const idx = vs.findIndex((v) => {
        const vr = String(v.regNo || v.reg || '').trim().toUpperCase();
        return (reg && vr === reg) || (!reg && `${v.brand || ''} ${v.model || ''}`.trim() === label);
      });
      if (idx === -1) return c;
      const v = vs[idx];
      const history = [
        { at: Date.now(), invoiceNo: iv.invNo || '', amount: spend, odometer: iv.odometer || null },
        ...(v.serviceHistory || []),
      ].slice(0, 50); // keep the vehicle doc bounded
      const updated = {
        ...v,
        lastServiceDate: iv.date || new Date().toISOString().slice(0, 10),
        lastInvoiceNo: iv.invNo || '',
        totalSpend: (Number(v.totalSpend) || 0) + spend,
        serviceCount: (Number(v.serviceCount) || 0) + 1,
        serviceHistory: history,
      };
      const nextVs = [...vs]; nextVs[idx] = updated;
      return { ...c, vehicles: nextVs };
    }));
  };

  // =====================================================================
  //  THE TRANSACTION ENGINE
  //  One function. Every module downstream of Billing is updated from here,
  //  from the SAME source invoice, in one pass. Nothing else in the app is
  //  allowed to mutate stock or the ledgers off the back of an invoice.
  //
  //  Two rules make it safe:
  //
  //  1. NO SIDE EFFECTS INSIDE A setState UPDATER.
  //     The previous version ran applyStockDelta() and the ledger writes inside
  //     setInvoicesRaw((prev) => ...). React may invoke an updater more than once
  //     (StrictMode double-invoke, re-render replays) — which would DOUBLE-DEDUCT
  //     stock and write the sale twice. Updaters must be pure. So we read prior
  //     state from a ref, run the effects once, then commit state.
  //
  //  2. DIFF-BASED, therefore IDEMPOTENT.
  //     We always diff prior->next on REALIZED (paid) values. Saving the same paid
  //     invoice twice produces a zero delta, so nothing moves. Un-paying, refunding,
  //     cancelling or deleting produces the exact inverse delta, so stock and the
  //     ledgers unwind cleanly. There is no "already applied?" flag to get wrong.
  // =====================================================================
  const runInvoiceTransaction = (prior, next, action) => {
    const target = next || prior;
    if (!target) return;
    const gate = { computed: invTotals(next || {}), realizedBefore: isRealized(prior), realizedNow: isRealized(next) };
    txn(4, 'runInvoiceTransaction', {
      invNo: target.invNo, action,
      statusOnObject: next?.status,
      engineComputedGrand: gate.computed.grand,
      engineComputedPaid: gate.computed.paid,
      engineBalance: gate.computed.balance,
      REALIZED: gate.realizedNow,
      willRunEngine: gate.realizedNow !== gate.realizedBefore || gate.realizedNow,
    });
    if (!gate.realizedNow && next?.status === 'Paid') {
      console.error('%c[TXN] STOP — invoice says Paid but engine says NOT realized. Nothing downstream will update.', 'color:#f87171;font-weight:bold', gate.computed);
    }

    // GUARD-RAIL. The worst failure mode this app had was the engine deciding an
    // invoice wasn't "realized" and doing nothing — silently. The invoice showed as
    // Paid while inventory, sales, services and every report stayed frozen, with no
    // error anywhere. If an invoice claims to be Paid but the engine disagrees, that
    // is a bug, and it must be visible instead of quietly losing the transaction.
    if (next && next.status === 'Paid' && !isRealized(next)) {
      const t = invTotals(next);
      console.error(
        '[TRANSACTION ENGINE] Invoice says Paid but is not realized — downstream modules ' +
        'would NOT update. This is a bug, not a no-op.',
        { invNo: next.invNo, computedGrand: t.grand, paid: t.paid, balance: t.balance, lines: (next.lines || []).length },
      );
    }

    // --- 1. INVENTORY: realized qty diff (parts leave the shelf only when paid)
    const oldQ = realizedPartQtys(prior);
    const newQ = realizedPartQtys(next);
    const delta = {};
    new Set([...Object.keys(oldQ), ...Object.keys(newQ)]).forEach((id) => {
      const d = (oldQ[id] || 0) - (newQ[id] || 0);
      if (d !== 0) delta[id] = d;
    });
    // applyStockDelta also writes the Stock Out / movement history rows.
    txn(5, 'Inventory delta', delta);
    if (Object.keys(delta).length) { applyStockDelta(delta); txn(8, 'Stock Out rows written (derived from sales+adjustments)', Object.keys(delta).length); }
    else txn(5, 'Inventory delta EMPTY — no parts to move (check line.partId && line.kind==="Part")');

    // --- 2. SALES + SERVICES ledger: realized revenue diff. One writer, which
    //        splits Parts -> Sales and Labour/Service -> Services by lineCategory.
    txn(6, 'Ledger diff -> Sales + Services', {
      priorLines: Object.keys(invoiceRevenueLines(realizedRevenue(prior))).length,
      nextLines: Object.keys(invoiceRevenueLines(realizedRevenue(next))).length,
    });
    recordInvoiceSalesDelta(realizedRevenue(prior), realizedRevenue(next));

    // --- 3. AUDIT LOG: an invoice moving money is an auditable event. This was
    //        missing entirely — payments left no trace in the audit trail.
    const becamePaid = !isRealized(prior) && isRealized(next);
    const unPaid = isRealized(prior) && !isRealized(next);
    if (becamePaid || unPaid || action === 'delete') {
      const t = { ...target };
      pushAudit({
        action: action === 'delete' ? 'Invoice Deleted'
          : becamePaid ? 'Invoice Paid'
          : `Invoice ${next?.status || 'Reversed'}`,
        entity: 'Invoice',
        entityId: t.invNo || t.id,
        detail: `${t.invNo || ''} · ${t.customer || ''}${t.vehicle ? ` · ${t.vehicle}` : ''} · ${formatINR(Number(t.grandTotal) || 0)}`,
      });
    }

    // --- 4. VEHICLE HISTORY: record the service against the vehicle so the
    //        vehicle's "last serviced / total spend" is real. Was never updated.
    if (becamePaid && (target.regNo || target.vehicle)) {
      touchVehicleHistory(target);
    }
    // Customer history + Dashboard/Reports/Analytics all derive from `invoices`
    // and `sales`, which are updated above — so they refresh with no extra work
    // and with no separate dataset to drift out of sync.
  };

  const persistInvoice = (iv) => {
    txn(3, 'persistInvoice called', { invNo: iv.invNo, status: iv.status, lines: (iv.lines || []).length, payments: (iv.payments || []).length, demoMode });
    // Read prior from a ref, NOT from inside the updater, so the effects below run
    // exactly once regardless of how many times React re-invokes the updater.
    const prior = invoicesRef.current.find((x) => x.id === iv.id) || null;
    runInvoiceTransaction(prior, iv, 'persist');
    const next = [...invoicesRef.current.filter((x) => x.id !== iv.id), iv];
    invoicesRef.current = next;          // keep the ref authoritative immediately
    setInvoicesRaw(next);                // pure commit
    writeInvoices(next);
    syncCustomerTotals(iv.customerId, next);
  };

  const deleteInvoice = (iv) => {
    const prior = invoicesRef.current.find((x) => x.id === iv.id) || iv;
    // Deleting a paid invoice must fully unwind it: stock back, ledgers reversed.
    runInvoiceTransaction(prior, null, 'delete');
    const next = invoicesRef.current.filter((x) => x.id !== iv.id);
    invoicesRef.current = next;
    setInvoicesRaw(next);
    writeInvoices(next);
    syncCustomerTotals(iv.customerId, next);
  };
  const startJobCardFor = (c) => {    const v = (c.vehicles || [])[0] || {};
    const max = jobCards.reduce((m, x) => { const n = Number(String(x.jobNo || '').replace(/\D/g, '')); return /^SBBMC/i.test(x.jobNo || '') && n > m ? n : m; }, 0);
    const draft = {
      jobNo: `SBBMC${String(max + 1).padStart(2, '0')}`,
      customer: c.name || '', phone: c.phone || '', altPhone: c.altPhone || '', address: c.address || '',
      vehicle: v.model || '', regNo: v.regNo || '', fuel: v.fuel || 'Petrol',
    };
    try { localStorage.setItem('maruti_jobcard_draft_v2', JSON.stringify(draft)); } catch {}
    setActiveTab('jobcards');
    toast.success(`Starting a job card for ${c.name}`);
  };
  // Part 4: parts reservation. A job card's `parts` array [{partId, qty}] reserves
  // inventory stock (increments each part's `reserved` bucket). Reservation is
  // released when the card is Cancelled/Closed, when parts are removed, or when the
  // card is deleted. Delta-based like invoice stock sync so re-saves never double-count.
  const cardReservedQtys = (card) => {
    const map = {};
    // Cancelled/Closed cards hold no reservation (parts either returned or billed out).
    if (!card || ['Cancelled', 'Closed', 'Delivered'].includes(card.status)) return map;
    (card.parts || []).forEach((p) => { if (p.partId) map[p.partId] = (map[p.partId] || 0) + (Number(p.qty) || 0); });
    return map;
  };
  const applyReserveDelta = (deltaMap) => {
    const ids = Object.keys(deltaMap).filter((id) => deltaMap[id] !== 0);
    if (!ids.length) return;
    setInventory((prev) => {
      const next = prev.map((p) => (ids.includes(p.id) ? { ...p, reserved: Math.max(0, (p.reserved || 0) + deltaMap[p.id]) } : p));
      if (demoMode) {
        // NOT a silent catch. If persistence fails (quota exceeded, storage blocked in
        // private mode), the stock change survives in memory but dies on reload — the
        // user must know, not silently lose the transaction.
        try { sessionStorage.setItem('maruti_demo_inv', JSON.stringify(next)); }
        catch (e) {
          console.error('[TXN] FAILED to persist inventory — this change will be LOST on reload.', e);
          toast.error('Could not save stock change to demo storage. It will be lost on reload.');
        }
      }
      else { ids.forEach((id) => { try { updateDoc(doc(db, 'parts', id), { reserved: increment(deltaMap[id]), updatedAt: serverTimestamp() }); } catch (e) { /* offline: local state still reflects it */ } }); }
      return next;
    });
  };
  const deleteJobCard = (jobNo) => {
    setJobCards((prev) => {
      const prior = prev.find((c) => c.jobNo === jobNo);
      // release any reservation this card held
      const rel = cardReservedQtys(prior);
      const delta = {}; Object.keys(rel).forEach((id) => { delta[id] = -rel[id]; });
      applyReserveDelta(delta);
      const next = prev.filter((c) => c.jobNo !== jobNo);
      persistJobCardsDiff(prev, next);
      return next;
    });
  };
  const persistJobCard = (card) => {
    setJobCards((prev) => {
      const prior = prev.find((c) => c.jobNo === card.jobNo);
      const oldR = cardReservedQtys(prior); const newR = cardReservedQtys(card);
      const delta = {};
      new Set([...Object.keys(oldR), ...Object.keys(newR)]).forEach((id) => { const d = (newR[id] || 0) - (oldR[id] || 0); if (d !== 0) delta[id] = d; });
      applyReserveDelta(delta);
      // preserve creation order for the Firestore orderBy('createdAt') subscription
      const stamped = prior ? card : { ...card, createdAt: card.createdAt || serverTimestamp(), createdAtMs: card.createdAtMs || Date.now() };
      const next = [...prev.filter((c) => c.jobNo !== card.jobNo), stamped];
      persistJobCardsDiff(prev, next);
      return next;
    });
  };
  // #6 View-More context: remember scroll position per tab so returning lands you where you left off.
  const scrollMem = useRef({});
  useEffect(() => {
    const onScroll = () => {
      if (document.body.style.position === 'fixed') return; // a modal is locking the body — don't record
      scrollMem.current[activeTab] = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [activeTab]);
  useEffect(() => {
    const y = scrollMem.current[activeTab];
    if (y != null) requestAnimationFrame(() => window.scrollTo(0, y));
  }, [activeTab]);
  const [suppliers, setSuppliers] = useState([]);
  const [suppliersLoading, setSuppliersLoading] = useState(true);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  // FIX-09: styled, on-brand confirmation modal (replaces native confirm()).
  const [confirmState, setConfirmState] = useState(null); // { title, message, confirmLabel, danger, onConfirm }
  const askConfirm = useCallback((opts) => setConfirmState(opts), []);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [editSupplier, setEditSupplier] = useState(null);
  const [supplierSaving, setSupplierSaving] = useState(false);

  // 1.3 Unified inventory state filter — Active | Low Stock | Out of Stock | Archived | All.
  // Active strictly excludes low/out-of-stock and archived; each filter shows only its set.
  const [invFilter, setInvFilter] = useState('active');
  // Back-compat derived flags used by various UI bits and the archived-metadata display.
  const lowStockOnly = invFilter === 'low';
  const outOfStockOnly = invFilter === 'out';
  const showArchived = invFilter === 'archived' || invFilter === 'all';
  // #3 supplier→inventory jump: the part id to highlight + scroll to after a jump.
  const [highlightPartId, setHighlightPartId] = useState(null);
  const [dupPrompt, setDupPrompt] = useState(null); // Task 3: {existing, proceed}
  const [adjustTarget, setAdjustTarget] = useState(null); // Task 8: stock adjust modal
  const [ledgerTarget, setLedgerTarget] = useState(null); // Section 14: movement history
  const [reorderChoice, setReorderChoice] = useState(null); // {part, suppliers} for multi-supplier reorder
  const [reorderDialog, setReorderDialog] = useState(null); // real reorder workflow dialog
  const [stockAdjustments, setStockAdjustments] = useState([]); // Task 8: ledger

  // NOTE: this effect MUST live below every store it reads. It previously sat above
  // `const [stockAdjustments, ...]` and threw "Cannot access 'stockAdjustments' before
  // initialization" — a temporal-dead-zone error. `const` declarations are hoisted but
  // not initialised, so referencing one earlier in the same scope is a runtime crash,
  // even though the name resolves fine to a static analyser.
  // Exposed for verification: run `window.__txnCounts()` in the console before and
  // after a Save & Collect. Every store the app reads from, in one place, so a claim
  // like "nothing updated" can be checked against the actual data rather than the UI.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__txnCounts = () => {
      const counts = {
        Invoices: invoices.length,
        Sales: sales.filter((r) => (r.revenueType || r.category) === 'Parts' || (r.revenueType || r.category) === 'Outside Purchase').length,
        Services: sales.filter((r) => (r.revenueType || r.category) === 'Labour' || (r.revenueType || r.category) === 'Service').length,
        SalesLedgerTotal: sales.length,
        StockOut: sales.filter((r) => !!r.partId && (r.revenueType || r.category || 'Parts') === 'Parts').length + stockAdjustments.length,
        InventoryParts: inventory.length,
        InventoryTotalUnits: inventory.reduce((a, p) => a + (Number(p.stock) || 0), 0),
        Customers: customers.length,
        Vehicles: customers.reduce((a, c) => a + (c.vehicles || []).length, 0),
        AuditLog: auditLog.length,
        Revenue: sales.reduce((a, r) => a + (Number(r.revenue) || 0), 0),
        Profit: sales.reduce((a, r) => a + (Number(r.profit) || 0), 0),
      };
      console.table(counts);
      return counts;
    };
  }, [invoices, sales, inventory, customers, auditLog, stockAdjustments]);

  const [reorderRequests, setReorderRequests] = useState([]); // PO / reorder status
  const [purchaseOrders, setPurchaseOrders] = useState([]); // Purchase Order lifecycle (pending→approved→received→cancelled)
  // Alert state + derived counts — placed AFTER reorderRequests so it isn't
  // referenced before initialization (fixes the TDZ ReferenceError).
  const allAlerts = useMemo(() => computeAlerts(inventory, reorderRequests, connError, { customers, invoices, jobCards, purchaseOrders, suppliers }), [inventory, reorderRequests, connError, customers, invoices, jobCards, purchaseOrders, suppliers]);
  const unreadAlertCount = useMemo(
    () => allAlerts.filter((a) => !readAlerts.has(a.id) && !archivedAlerts.has(a.id)).length,
    [allAlerts, readAlerts, archivedAlerts]
  );
  const persistAlerts = (key, set) => { try { localStorage.setItem(key, JSON.stringify([...set])); } catch {} };
  const markAlertRead = useCallback((id, read = true) => {
    setReadAlerts((s) => { const n = new Set(s); if (read) n.add(id); else n.delete(id); persistAlerts('maruti_read_alerts', n); return n; });
  }, []);
  const markAllAlertsRead = useCallback(() => {
    setReadAlerts(() => { const n = new Set(allAlerts.map((a) => a.id)); persistAlerts('maruti_read_alerts', n); return n; });
  }, [allAlerts]);
  const archiveAlert = useCallback((id) => {
    if (demoMode && !demoAdmin) { protectedDemoToast(); return; }
    setArchivedAlerts((s) => { const n = new Set(s); n.add(id); persistAlerts('maruti_archived_alerts', n); return n; });
  }, [demoMode, demoAdmin]);
  const [showFilterSheet, setShowFilterSheet] = useState(false); // CHANGE-05: mobile filters
  // Lock background scroll while the mobile filter sheet is open (it's inline JSX,
  // not a component, so it can't use the hook directly).
  useEffect(() => { if (!showFilterSheet) return undefined; const t = lockBody(); return () => unlockBody(t); }, [showFilterSheet]);
  const [sortConfig, setSortConfig] = useState({ key: null, dir: 'asc' });

  // Issue 3: checkout / bargain-lock
  const [checkoutPart, setCheckoutPart] = useState(null);
  const [restockTarget, setRestockTarget] = useState(null); // ADD-02
  const [quickPick, setQuickPick] = useState(null); // 'sell' | 'receive' — Quick Action part picker
  const [showImport, setShowImport] = useState(false); // ADD-01
  // Critical Fix #1: the Actions ▼ menu must close on ESC and on scroll, with
  // listeners cleaned up. (Outside-click is handled by its backdrop.)
  useEffect(() => {
    if (!actionsOpen) return;
    const close = () => setActionsOpen(false);
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const onDown = (e) => { if (actionsRef.current && !actionsRef.current.contains(e.target)) close(); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('touchstart', onDown, true);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('touchstart', onDown, true);
    };
  }, [actionsOpen]);
  // Critical Fix #1: also close it whenever the tab changes or any modal/drawer/
  // palette opens, so it can never linger over another surface.
  useEffect(() => { setActionsOpen(false); }, [activeTab, showModal, showImport, showSupplierModal, restoreConfirm, cmdkOpen, sidebarMobileOpen]);
  // FIX 2: WhatsApp purchase-order router
  const [reorderTarget, setReorderTarget] = useState(null); // { part, supplierName, contacts, block }
  // Feature 5: out-of-stock alternative suggester
  const [alternativePart, setAlternativePart] = useState(null);

  function toggleSort(key) {
    setSortConfig((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    );
  }

  // ---- Demo Mode: load the in-memory sample dataset instead of Firestore.
  // Runs once; populates every collection's state from the generated demo data
  // so all tabs, charts and reports look fully realistic — with zero database
  // reads and complete isolation from real production data. ----
  const applyDemoData = useCallback((scope = 'all', opts = {}) => {
    const { fresh = false } = opts;
    const d = getDemoData();
    // Demo changes (archive/restore/delete/stock/edits) are in-memory. Persist
    // them to sessionStorage keyed by the demo's stable ids so a refresh keeps
    // the user's work instead of regenerating the pristine seed. A "Reset demo"
    // passes { fresh:true } to deliberately wipe the snapshot.
    if (fresh) { try { ['maruti_demo_inv', 'maruti_demo_sup', 'maruti_demo_sales', 'maruti_demo_rs', 'maruti_demo_adj', 'maruti_demo_po', 'maruti_demo_audit'].forEach((k) => sessionStorage.removeItem(k)); sessionStorage.removeItem('maruti_garage_seed'); localStorage.removeItem('maruti_customers_demo'); localStorage.removeItem('maruti_jobcards_demo'); localStorage.removeItem('maruti_invoices_demo'); localStorage.removeItem('maruti_demo_schema'); } catch (e) { console.error('[DEMO] Reset could not clear stored demo data.', e); } }
    const readSaved = (key) => {
      if (fresh) return null;
      try { const s = sessionStorage.getItem(key); const a = s ? JSON.parse(s) : null; return Array.isArray(a) && a.length ? a : null; } catch { return null; }
    };
    if (scope === 'all' || scope === 'inventory') setInventory(readSaved('maruti_demo_inv') || d.parts);
    if (scope === 'all' || scope === 'suppliers') setSuppliers(readSaved('maruti_demo_sup') || d.suppliers);
    if (scope === 'all' || scope === 'sales') { setSales(readSaved('maruti_demo_sales') || d.sales); setRollups(d.salesRollups); }
    if (scope === 'all') { setRestocks(readSaved('maruti_demo_rs') || d.restocks); setStockAdjustments(readSaved('maruti_demo_adj') || d.stockAdjustments); setReorderRequests(d.reorderRequests); setPurchaseOrders(readSaved('maruti_demo_po') || d.purchaseOrders || []); setCustomCategories(d.categories); setCustomVehicles(d.vehicles); }
    if (scope === 'all' || scope === 'alerts') setReorderRequests(d.reorderRequests);
    if (scope === 'all' || scope === 'audit') setAuditLog(readSaved('maruti_demo_audit') || d.auditLog);
    setLoading(false); setSuppliersLoading(false); setLastSync(new Date()); setConnError(null);
  }, []);
  // SEED ONCE, NEVER AGAIN.
  //
  // ARCHITECTURAL BUG THIS FIXES — "invoice paid, but Sales/Services show an OLDER
  // invoice and not the new one":
  //
  // applyDemoData('all') calls setSales(readSaved(...) || seed), i.e. it REPLACES the
  // whole sales array with whatever was in sessionStorage. This effect listed
  // `applyDemoData` in its deps, so any change to that callback's identity re-ran the
  // seeding — and if that happened after the transaction engine had just pushed new
  // ledger rows via setSales(), those rows were silently overwritten by the stale
  // snapshot. The invoice stayed Paid in the invoice store (different store, unaffected),
  // so Billing showed INV-0010 while Sales/Services still showed only INV-0009.
  //
  // That is a RACE, which is why it looked intermittent: whether a transaction survived
  // depended on whether a re-seed happened to fire after it.
  //
  // The demo store is hydrated exactly ONCE per session. After that, the transaction
  // engine is the only thing allowed to mutate it — exactly as in production, where
  // Firestore is hydrated once and then mutated by writes.
  const demoSeeded = useRef(false);
  useEffect(() => {
    if (!demoMode) { demoSeeded.current = false; return; }
    if (demoSeeded.current) return;      // already hydrated — do NOT clobber live data
    demoSeeded.current = true;

    applyDemoData('all');
  }, [demoMode, applyDemoData]);

  // Auto-save demo inventory/suppliers on every change so a refresh restores them.
  // imageString is stripped before saving (it's large base64 and is re-derived
  // from the part name in demo mode), keeping the payload well under quota.
  useEffect(() => {
    if (!demoMode || loading) return;
    try { sessionStorage.setItem('maruti_demo_inv', JSON.stringify(inventory.map(({ imageString, ...rest }) => rest))); } catch {}
  }, [inventory, demoMode, loading]);
  useEffect(() => { if (!demoMode || loading) return; try { sessionStorage.setItem('maruti_demo_sales', JSON.stringify(sales)); } catch {} }, [sales, demoMode, loading]);
  useEffect(() => { if (!demoMode || loading) return; try { sessionStorage.setItem('maruti_demo_audit', JSON.stringify(auditLog)); } catch {} }, [auditLog, demoMode, loading]);
  useEffect(() => { if (!demoMode || loading) return; try { sessionStorage.setItem('maruti_demo_rs', JSON.stringify(restocks)); } catch {} }, [restocks, demoMode, loading]);
  useEffect(() => { if (!demoMode || loading) return; try { sessionStorage.setItem('maruti_demo_adj', JSON.stringify(stockAdjustments)); } catch {} }, [stockAdjustments, demoMode, loading]);
  useEffect(() => { if (!demoMode || loading) return; try { sessionStorage.setItem('maruti_demo_po', JSON.stringify(purchaseOrders)); } catch {} }, [purchaseOrders, demoMode, loading]);
  useEffect(() => {
    if (!demoMode || suppliersLoading) return;
    try { sessionStorage.setItem('maruti_demo_sup', JSON.stringify(suppliers)); } catch {}
  }, [suppliers, demoMode, suppliersLoading]);

  // Demo Management actions (Demo Admin only) — restore the pristine seeded
  // dataset or a single collection. In-memory, so this is instant and per-session.
  function resetDemoScope(scope, label) {
    applyDemoData(scope, { fresh: true });
    toast.success(`${label} reset to original demo data`);
  }

  // ---- Firestore live subscription (offline-first) ----
  useEffect(() => {
    if (demoMode) return;
    // BOUNDED — see the note on the customers listener. 10k parts x 500 users is 5M
    // reads per load cycle if left unbounded.
    const q = query(collection(db, 'parts'), orderBy('createdAt', 'desc'), limit(LIMITS.PARTS_LIVE));
    const unsub = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        setInventory(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setPendingWrites(snap.metadata.hasPendingWrites); // ADD-08
        if (!snap.metadata.hasPendingWrites && !snap.metadata.fromCache) { setLastSync(new Date()); setConnError(null); }
        setLoading(false);
      },
      (err) => {
        console.error('Firestore subscription error:', err);
        // Issue 1/6: surface a real, explained connection error instead of a
        // silent perpetual "Sync Pending".
        const msg = /has not been used|disabled/i.test(err?.message || '')
          ? 'Firestore is not enabled for this project. Enable it in the Google Cloud console, create the database, and publish the rules.'
          : err?.code === 'permission-denied'
          ? 'Access denied by security rules. Make sure you are signed in and the rules are published.'
          : 'Could not reach the database. Check your connection and try again.';
        setConnError(msg);
        setLoading(false);
      }
    );
    return unsub;
  }, [syncNonce]);

  const retrySync = useCallback(() => { setConnError(null); setSyncNonce((n) => n + 1); toast.loading('Reconnecting…', { duration: 1500 }); }, []);

  // ---- One-time migration: lift any legacy per-device localStorage data
  // (customers / job cards / invoices) into Firestore so existing single-device
  // installs don't lose data when the app moves to a shared multi-device backend.
  // Runs once per browser; guarded by a flag and skipped entirely in demo mode.
  useEffect(() => {
    if (demoMode) return;
    if (loading) return; // wait until the first parts snapshot confirms Firestore is reachable
    let done = false;
    try { done = localStorage.getItem('maruti_fs_migrated_v1') === '1'; } catch {}
    if (done) return;
    (async () => {
      try {
        const readLocal = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
        const locCustomers = readLocal('maruti_customers_prod');
        const locJobs = readLocal('maruti_jobcards_prod');
        const locInvoices = readLocal('maruti_invoices_prod');
        if (!locCustomers.length && !locJobs.length && !locInvoices.length) { localStorage.setItem('maruti_fs_migrated_v1', '1'); return; }
        // only migrate into an empty collection (never overwrite live cloud data)
        const [cSnap, jSnap, iSnap] = await Promise.all([
          getDocs(query(collection(db, 'customers'), limit(1))),
          getDocs(query(collection(db, 'jobCards'), limit(1))),
          getDocs(query(collection(db, 'invoices'), limit(1))),
        ]);
        // 🔴 THIS MIGRATION USED TO LIE.
        //
        // `setDoc(...)` is ASYNC and was never awaited, so the surrounding try/catch
        // caught nothing — a rejected write surfaced later as an unhandled rejection.
        // `migrated++` then counted ATTEMPTS, not successes, so the app cheerfully
        // toasted "Synced 300 records to the cloud" even if every single write failed.
        // Worse, `maruti_fs_migrated_v1` was set unconditionally, so the migration NEVER
        // RETRIED — a workshop's entire customer and invoice history stayed stranded on
        // one browser, with the owner believing it was safely in the cloud.
        //
        // Now: await every write, count only what actually lands, and only mark the
        // migration done if nothing failed. Anything else is a data-loss trap.
        const writes = [];
        if (cSnap.empty && locCustomers.length) {
          locCustomers.forEach((c) => writes.push(
            setDoc(doc(db, 'customers', String(c.id)), { ...c, createdAt: c.createdAt || Date.now(), updatedAt: serverTimestamp() }, { merge: true })
          ));
        }
        if (jSnap.empty && locJobs.length) {
          locJobs.forEach((j) => writes.push(
            setDoc(doc(db, 'jobCards', String(j.jobNo)), { ...j, createdAt: j.createdAt || Date.now(), updatedAt: serverTimestamp() }, { merge: true })
          ));
        }
        if (iSnap.empty && locInvoices.length) {
          locInvoices.forEach((iv) => writes.push(
            setDoc(doc(db, 'invoices', String(iv.id)), { ...iv, createdAt: iv.createdAt || Date.now(), updatedAt: serverTimestamp() }, { merge: true })
          ));
        }

        if (!writes.length) { localStorage.setItem('maruti_fs_migrated_v1', '1'); return; }

        const results = await Promise.allSettled(writes);
        const migrated = results.filter((r) => r.status === 'fulfilled').length;
        const failed = results.length - migrated;

        if (failed === 0) {
          localStorage.setItem('maruti_fs_migrated_v1', '1');   // only mark done if ALL landed
          toast.success(`Synced ${migrated} local record${migrated === 1 ? '' : 's'} to the cloud`, { duration: 4000 });
        } else {
          // Do NOT set the flag — we must retry on the next load rather than strand data.
          console.error(`[migration] ${failed} of ${results.length} records failed to sync.`,
            results.filter((r) => r.status === 'rejected').map((r) => r.reason));
          toast.error(`${failed} record${failed === 1 ? '' : 's'} could not be synced to the cloud. They are still saved on this device and will retry automatically.`, { duration: 8000 });
        }
      } catch (e) { console.error('Local→Firestore migration skipped:', e); }
    })();
  }, [demoMode, loading]);

  // ---- Sales ledger live subscription (powers the Monthly Profit Trend) ----
  // Capped to the most recent records for performance on large histories.
  useEffect(() => {
    if (demoMode) return;
    const q = query(collection(db, 'sales'), orderBy('createdAt', 'desc'), limit(LIMITS.SALES_LIVE));
    const unsub = onSnapshot(
      q,
      (snap) => setSales(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error('Sales subscription error:', err)
    );
    return unsub;
  }, []);

  // ---- FIX-07: monthly rollups subscription (one tiny doc per month) ----
  useEffect(() => {
    if (demoMode) return;
    const q = query(collection(db, 'salesRollups'), orderBy('month', 'desc'), limit(60));
    const unsub = onSnapshot(
      q,
      (snap) => setRollups(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error('Rollups subscription error:', err)
    );
    return unsub;
  }, []);

  // ---- ADD-02: restock ledger subscription (Restock Cost analytics) ----
  useEffect(() => {
    if (demoMode) return;
    const q = query(collection(db, 'restocks'), orderBy('createdAt', 'desc'), limit(LIMITS.RESTOCKS_LIVE));
    const unsub = onSnapshot(
      q,
      (snap) => setRestocks(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error('Restocks subscription error:', err)
    );
    return unsub;
  }, []);

  // ---- Task 8: stock adjustment ledger (non-sale reductions) ----
  useEffect(() => {
    if (demoMode) return;
    const q = query(collection(db, 'stockAdjustments'), orderBy('createdAt', 'desc'), limit(LIMITS.STOCK_ADJUSTMENTS_LIVE));
    const unsub = onSnapshot(
      q,
      (snap) => setStockAdjustments(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error('Stock adjustments subscription error:', err)
    );
    return unsub;
  }, []);

  // ---- Reorder requests (purchase tracking; status transitions) ----
  useEffect(() => {
    if (demoMode) return;
    const q = query(collection(db, 'reorderRequests'), orderBy('createdAt', 'desc'), limit(200));
    const unsub = onSnapshot(
      q,
      (snap) => setReorderRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error('Reorder requests subscription error:', err)
    );
    return unsub;
  }, []);

  // ---- Purchase Orders (lifecycle: pending → approved → received → cancelled) ----
  useEffect(() => {
    if (demoMode) return;
    const q = query(collection(db, 'purchaseOrders'), orderBy('createdAt', 'desc'), limit(300));
    const unsub = onSnapshot(
      q,
      (snap) => setPurchaseOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error('Purchase orders subscription error:', err)
    );
    return unsub;
  }, []);

  // ---- Recovery Vault meta (drives the status card; syncs across devices) ----
  const [recoveryMeta, setRecoveryMeta] = useState(null);
  useEffect(() => {
    if (demoMode) return;
    const unsub = onSnapshot(
      doc(db, 'recoveryMeta', 'current'),
      (snap) => {
        const data = snap.exists() ? snap.data() : null;
        setRecoveryMeta(data);
        // Client-side expiry: if the vault is past its 7 days, purge it now.
        // (Free plan has no server cron, so expiry is enforced on next open.)
        if (data && data.expiresAt && Date.now() > data.expiresAt) {
          purgeVault(data.snapshotId);
        }
      },
      (err) => console.error('Recovery meta subscription error:', err)
    );
    return unsub;
  }, []);

  // ---- Task 1: custom categories & vehicles (user-extendable option lists) ----
  useEffect(() => {
    if (demoMode) return;
    const unsub = onSnapshot(
      collection(db, 'categories'),
      (snap) => setCustomCategories(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error('Categories subscription error:', err)
    );
    return unsub;
  }, []);
  useEffect(() => {
    if (demoMode) return;
    const unsub = onSnapshot(
      collection(db, 'vehicles'),
      (snap) => setCustomVehicles(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error('Vehicles subscription error:', err)
    );
    return unsub;
  }, []);

  // ---- ADD-06: audit log subscription (admin-only viewer) ----
  useEffect(() => {
    if (demoMode) return;
    if (!isAdmin) { setAuditLog([]); return; }
    const q = query(collection(db, 'auditLog'), orderBy('createdAt', 'desc'), limit(100));
    const unsub = onSnapshot(
      q,
      (snap) => setAuditLog(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error('Audit log subscription error:', err)
    );
    return unsub;
  }, [isAdmin]);

  // ---- Suppliers live subscription (new `suppliers` collection) ----
  useEffect(() => {
    if (demoMode) return;
    // BOUNDED — see the note on the customers listener.
    const q = query(collection(db, 'suppliers'), orderBy('name', 'asc'), limit(LIMITS.SUPPLIERS_LIVE));
    const unsub = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        setSuppliers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setSuppliersLoading(false);
      },
      (err) => {
        console.error('Suppliers subscription error:', err);
        setSuppliersLoading(false);
      }
    );
    return unsub;
  }, []);
  const commitStock = useCallback(async (partId, newStock) => {
    // Hardening: never let a NaN, float, or negative reach state or Firestore.
    const safeStock = Math.max(0, Math.floor(Number(newStock) || 0));
    let prevStock = null;
    setInventory((prev) => prev.map((p) => {
      if (p.id === partId) { prevStock = p.stock; return { ...p, stock: safeStock }; }
      return p;
    }));
    if (demoMode) return; // demo: local state only, no Firestore
    try {
      await updateDoc(doc(db, 'parts', partId), {
        stock: safeStock,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('Stock sync failed:', err);
      // Issue 1: an OFFLINE write is queued by IndexedDB and will replay — keep
      // the optimistic value. Any OTHER failure (permission denied, API disabled,
      // not-found) will never succeed, so roll the UI back so it can never show a
      // value the database doesn't have.
      const offlineish = err?.code === 'unavailable' || /offline|network/i.test(err?.message || '');
      if (!offlineish && prevStock != null) {
        setInventory((prev) => prev.map((p) => (p.id === partId ? { ...p, stock: prevStock } : p)));
        toast.error('Could not update stock — the change was reverted. Check your connection / Firestore access.');
      }
    }
  }, [demoMode]);

  // ---- Logout (now routed through a confirmation modal) ----
  async function confirmLogout() {
    setShowLogoutConfirm(false);
    if (demoMode) { try { exitDemo && exitDemo(); } catch { router.push('/login'); } return; }
    try {
      await signOut(auth);
      // SECURITY: signOut() only clears the Firebase token. The offline-first caches
      // (customers, invoices, job cards) stay in localStorage — so on a shared workshop
      // counter PC the NEXT person to open the app would see the previous user's
      // customer list and invoices rendered from cache before auth resolves.
      // Clear every cached business record on the way out. Preferences (theme, sidebar)
      // are deliberately kept: they are not customer data.
      clearBusinessCaches();
      router.push('/login');
    } catch (err) {
      console.error('Logout failed:', err);
      toast.error('Could not log out. Please try again.');
    }
  }

  // ---- Persist a supplier's master details edited from inside the Part modal ----
  // (Preserves altNames/notes — only touches name + phone numbers — then cascades
  // the new name/number to every linked part, keeping each part's preferred number
  // if it still exists.)
  function persistSupplierEdit(id, { name, phoneNumbers }) {
    const cleanName = (name || '').trim();
    const seen = new Set();
    const phones = (phoneNumbers || [])
      .map((c) => ({ number: tenDigits(c.number), label: (c.label || 'Primary').trim() || 'Primary' }))
      .filter((c) => c.number && !seen.has(c.number) && seen.add(c.number));
    const primaryPhone = normalizePhone(phones[0]?.number || '');

    updateDoc(doc(db, 'suppliers', id), {
      name: cleanName,
      phoneNumbers: phones,
      primaryPhone,
      phones: phones.map((c) => c.number),
      phone: primaryPhone,
      updatedAt: serverTimestamp(),
    }).catch((e) => console.error('Supplier edit sync will retry:', e));

    const valid = phones.map((c) => c.number);
    inventory.forEach((p) => {
      const list = getPartSuppliers(p);
      let changed = false;
      const updated = list.map((ps) => {
        if (ps.id !== id) return ps;
        const keep = ps.phone && valid.includes(ps.phone) ? ps.phone : primaryPhone;
        if (ps.name !== cleanName || ps.phone !== keep) {
          changed = true;
          return { ...ps, name: cleanName, phone: keep };
        }
        return ps;
      });
      if (changed) {
        const f = updated[0] || { name: '', phone: '' };
        updateDoc(doc(db, 'parts', p.id), {
          suppliers: updated,
          supplier: f.name,
          supplierPhone: f.phone,
          updatedAt: serverTimestamp(),
        }).catch((e) => console.error('Cascade after supplier edit:', e));
      }
    });
    toast.success('Supplier updated');
  }

  // ---- Supplier save (multi-phone / alt-names) + cascade to linked parts ----
  function handleSupplierSave(formData) {
    if (!formData.name?.trim()) return;
    if (demoMode) {
      const now = new Date();
      const stamp = { seconds: Math.floor(now.getTime() / 1000), nanoseconds: 0, toDate: () => now, toMillis: () => now.getTime() };
      const built = {
        ...formData,
        id: formData.id || ('demo-sup-' + now.getTime()),
        name: formData.name.trim(),
        phone: (formData.phoneNumbers && formData.phoneNumbers[0]?.number) || formData.phone || '',
        createdAt: formData.createdAt || stamp,
      };
      setSuppliers((prev) => (formData.id ? prev.map((s) => (s.id === formData.id ? { ...s, ...built } : s)) : [built, ...prev]));
      setShowSupplierModal(false); setEditSupplier(null);
      toast.success(formData.id ? 'Supplier updated (demo)' : 'Supplier added (demo)');
      return;
    }
    setSupplierSaving(true);

    // FIX 3 (serialization guard): drop any contact cards with no number.
    const cleanContacts = (formData.phoneNumbers || [])
      .map((c) => ({ number: tenDigits(c.number), label: (c.label || 'Primary').trim() || 'Primary' }))
      .filter((c) => c.number.trim() !== '');
    // De-dupe by number, keeping first label.
    const seen = new Set();
    const phoneNumbers = cleanContacts.filter((c) => (seen.has(c.number) ? false : seen.add(c.number)));
    const cleanAltNames = [...new Set((formData.altNames || []).map((n) => (n || '').trim()).filter(Boolean))];
    const primaryName = formData.name.trim();
    const primaryPhone = normalizePhone(phoneNumbers[0]?.number || '');

    const payload = {
      name: primaryName,
      altNames: cleanAltNames,
      phoneNumbers, // FIX 3: structured labeled contacts
      primaryPhone, // FIX 4: canonical match key
      phones: phoneNumbers.map((c) => c.number), // legacy mirror
      phone: primaryPhone, // legacy mirror
      notes: formData.notes || '',
      // Part 5: business / tax / payment / bank fields (GST optional)
      type: formData.type || '', contactPerson: formData.contactPerson || '', ownerName: formData.ownerName || '',
      email: formData.email || '', website: formData.website || '', whatsapp: formData.whatsapp || '',
      gst: (formData.gst || '').trim().toUpperCase(), pan: (formData.pan || '').toUpperCase(), businessReg: formData.businessReg || '',
      address: formData.address || '', area: formData.area || '', city: formData.city || '', district: formData.district || '',
      state: formData.state || '', pincode: formData.pincode || '',
      paymentMode: formData.paymentMode || 'Cash', creditDays: formData.creditDays || '', openingBalance: formData.openingBalance || '', outstanding: formData.outstanding || '',
      bankName: formData.bankName || '', accountHolder: formData.accountHolder || '', accountNumber: formData.accountNumber || '', ifsc: formData.ifsc || '', upi: formData.upi || '',
      preferred: !!formData.preferred, status: formData.status || 'Active', logo: formData.logo || '', documents: formData.documents || [],
      updatedAt: serverTimestamp(),
      // NOTE: partsSupplied is intentionally NOT stored — it is computed live.
    };

    try {
      if (formData.id) {
        updateDoc(doc(db, 'suppliers', formData.id), payload).catch((e) =>
          console.error('Supplier sync will retry:', e)
        );

        // Issue 2 (cascade): push the new name/phone to every part linked to
        // this supplier (by id, or — for legacy parts — by any old name).
        const old = suppliers.find((s) => s.id === formData.id);
        const oldNames = old ? getSupplierNames(old).map(safeLower) : [];
        const validNumbers = phoneNumbers.map((c) => c.number);
        inventory.forEach((p) => {
          const list = getPartSuppliers(p);
          let changed = false;
          const updated = list.map((ps) => {
            const linked =
              (ps.id && ps.id === formData.id) ||
              (!ps.id && oldNames.includes(safeLower(ps.name)));
            if (!linked) return ps;
            // Keep the part's chosen preferred number if it still exists on the
            // supplier; otherwise fall back to the new primary number.
            const keepPhone = ps.phone && validNumbers.includes(ps.phone) ? ps.phone : primaryPhone;
            const label =
              phoneNumbers.find((c) => c.number === keepPhone)?.label || ps.preferredLabel || 'Primary';
            if (ps.name !== primaryName || ps.phone !== keepPhone || ps.id !== formData.id) {
              changed = true;
              return { id: formData.id, name: primaryName, phone: keepPhone, preferredLabel: label };
            }
            return ps;
          });
          if (changed) {
            const first = updated[0] || { name: '', phone: '' };
            updateDoc(doc(db, 'parts', p.id), {
              suppliers: updated,
              supplier: first.name,
              supplierPhone: first.phone,
              updatedAt: serverTimestamp(),
            }).catch((e) => console.error('Cascade update failed:', e));
          }
        });
      } else {
        addDoc(collection(db, 'suppliers'), { ...payload, createdAt: serverTimestamp() }).catch((e) =>
          console.error('Supplier sync will retry:', e)
        );
      }
      toast.success(formData.id ? 'Supplier updated — synced to linked parts' : 'Supplier added');
    } catch (err) {
      console.error('Supplier save failed:', err);
      toast.error('Could not save supplier.');
    } finally {
      setSupplierSaving(false);
      setShowSupplierModal(false);
      setEditSupplier(null);
    }
  }

  function handleSupplierDelete(id) {
    const supplier = suppliers.find((s) => s.id === id);
    const name = supplier?.name || 'this supplier';
    const linked0 = supplier; // (keep ref)
    if (demoMode) {
      if (!demoAdmin && !demoPerms.deleteSuppliers) { protectedDemoToast(true); return; }
      setSuppliers((prev) => prev.filter((s) => s.id !== id)); toast.success('Supplier deleted (demo)'); return;
    }
    // FIX-06: how many parts reference this supplier? Warn before orphaning links.
    const linked = inventory.filter((p) => getPartSuppliers(p).some((ps) => ps.id === id));
    askConfirm({
      title: 'Delete supplier?',
      message:
        linked.length > 0
          ? `${name} is linked to ${linked.length} part${linked.length > 1 ? 's' : ''}. Deleting removes it from your directory and unlinks it from those parts (their saved name & number stay). This does not delete any parts.`
          : `Delete ${name} from your directory? This cannot be undone.`,
      confirmLabel: 'Delete supplier',
      danger: true,
      onConfirm: async () => {
        try {
          // Unlink from every part first so no dangling supplierId remains.
          await Promise.all(
            linked.map((p) => {
              const remaining = getPartSuppliers(p).filter((ps) => ps.id !== id);
              const first = remaining[0] || { name: '', phone: '' };
              return updateDoc(doc(db, 'parts', p.id), {
                suppliers: remaining,
                supplier: first.name,
                supplierPhone: first.phone,
                updatedAt: serverTimestamp(),
              });
            })
          );
          await deleteDoc(doc(db, 'suppliers', id));
          writeAudit('delete_supplier', { supplierId: id, name }, { unlinkedParts: linked.length });
          toast.success(linked.length ? `Supplier deleted · unlinked from ${linked.length} part(s)` : 'Supplier deleted');
        } catch (err) {
          console.error('Supplier delete failed:', err);
          toast.error('Could not delete supplier.');
        }
      },
    });
  }

  // Archive a supplier: hides it from the directory but — unlike delete —
  // leaves every linked part untouched. Mirrors the part archive flow
  // (archivedAt / archivedBy metadata, demo-gated, audited in production).
  function handleSupplierArchive(id) {
    const supplier = suppliers.find((s) => s.id === id);
    const name = supplier?.name || 'this supplier';
    const actor = demoAdmin ? 'demo-admin@balajiautoos.com' : (user?.email || 'unknown');
    if (demoMode) {
      if (!demoAdmin) { protectedDemoToast(); return; }
      const stamp = { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 };
      setSuppliers((prev) => prev.map((s) => (s.id === id ? { ...s, archived: true, archivedAt: stamp, archivedBy: actor } : s)));
      toast.success('Supplier archived (demo)');
      return;
    }
    updateDoc(doc(db, 'suppliers', id), { archived: true, archivedAt: serverTimestamp(), archivedBy: actor, updatedAt: serverTimestamp() })
      .then(() => { writeAudit('archive_supplier', { supplierId: id, name }); toast.success('Supplier archived'); })
      .catch((err) => { console.error('Supplier archive failed:', err); toast.error('Could not archive supplier.'); });
  }

  function handleSupplierRestore(id) {
    const supplier = suppliers.find((s) => s.id === id);
    const name = supplier?.name || 'this supplier';
    if (demoMode) {
      if (!demoAdmin) { protectedDemoToast(); return; }
      setSuppliers((prev) => prev.map((s) => (s.id === id ? { ...s, archived: false } : s)));
      toast.success('Supplier restored (demo)');
      return;
    }
    updateDoc(doc(db, 'suppliers', id), { archived: false, updatedAt: serverTimestamp() })
      .then(() => { writeAudit('restore_supplier', { supplierId: id, name }); toast.success('Supplier restored'); })
      .catch((err) => { console.error('Supplier restore failed:', err); toast.error('Could not restore supplier.'); });
  }

  // ---- Export inventory to a real .xlsx workbook (SheetJS) ----
  // Issue 14: Full Backup — read EVERY document from every collection (not the
  // capped live subscriptions) and download one JSON file. This is the owner's
  // safety net against browser/device/Firebase problems. Restore = Import Backup.
  async function exportFullBackup() {
    const t = toast.loading('Building full backup…');
    try {
      const COLLECTIONS = ['parts', 'suppliers', 'categories', 'vehicles', 'customers', 'invoices', 'jobCards', 'sales', 'salesRollups', 'restocks', 'stockAdjustments', 'auditLog', 'reorderRequests'];
      const dump = { app: 'sri-baba-balaji-maruti-care', appName: getShopName(), schema: 1, exportedAt: new Date().toISOString(), exportedBy: user?.email || null, collections: {} };
      let total = 0;
      for (const name of COLLECTIONS) {
        const snap = await getDocs(collection(db, name));
        dump.collections[name] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
        total += snap.size;
      }
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `maruti-care-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      try { const ts = Date.now(); localStorage.setItem('maruti_last_backup', String(ts)); setLastBackup(ts); } catch {}
      toast.success(`Backup saved — ${total} records across ${COLLECTIONS.length} collections.`, { id: t });
    } catch (err) {
      console.error('Backup failed:', err);
      toast.error('Backup failed — check your connection / database access.', { id: t });
    }
  }

  // Issue 14: Restore from a backup JSON. Writes documents back by their original
  // IDs (merge), so re-importing is idempotent and won't duplicate. Ledger docs
  // are restored too, preserving history. Existing live docs with the same ID are
  // overwritten with the backup's version.
  async function importFullBackup(file) {
    const t = toast.loading('Restoring backup…');
    try {
      const text = await file.text();
      const dump = JSON.parse(text);
      if (!dump || !dump.collections) throw new Error('Not a valid backup file.');
      let total = 0;
      for (const [name, docs] of Object.entries(dump.collections)) {
        if (!Array.isArray(docs)) continue;
        // Batch in chunks of 450 (Firestore limit is 500 writes/batch).
        for (let i = 0; i < docs.length; i += 450) {
          const batch = writeBatch(db);
          docs.slice(i, i + 450).forEach((rec) => {
            if (rec && rec.id) batch.set(doc(db, name, rec.id), rec.data || {}, { merge: true });
          });
          await batch.commit();
        }
        total += docs.length;
      }
      toast.success(`Restored ${total} records. Your data is back.`, { id: t });
    } catch (err) {
      console.error('Restore failed:', err);
      toast.error(`Restore failed — ${err.message || 'invalid file.'}`, { id: t });
    }
  }

  // ===========================================================================
  // DATA SAFETY & RECOVERY — wipe the whole shop into a 7-day cloud vault, then
  // restore with one click. Admin-only. Snapshot lives in Firestore so it works
  // across devices and survives refresh/logout.
  // ===========================================================================
  const RECOVERY_COLLECTIONS = ['parts', 'suppliers', 'categories', 'vehicles', 'customers', 'invoices', 'jobCards', 'sales', 'salesRollups', 'restocks', 'stockAdjustments', 'auditLog', 'reorderRequests'];
  const RECOVERY_DAYS = 7;

  // Snapshot every live record into recoveryVault (one vault doc per record),
  // write the meta, THEN delete the live data. Order matters: never delete
  // before the snapshot is safely written.
  async function resetAllData() {
    if (demoMode) { protectedDemoToast(); return false; } // never touch production from demo; demo resets use Demo Management
    if (!isAdmin) { toast.error('Only an admin can reset the system.'); return false; }
    const t = toast.loading('Creating recovery snapshot…');
    try {
      const snapshotId = `snap_${Date.now()}`;
      const createdAt = Date.now();
      const expiresAt = createdAt + RECOVERY_DAYS * 86400000;
      const counts = {};
      let total = 0;

      // 1) Copy all live docs into recoveryVault (chunked, ≤450 writes/batch).
      for (const name of RECOVERY_COLLECTIONS) {
        const snap = await getDocs(collection(db, name));
        counts[name] = snap.size;
        total += snap.size;
        const docsArr = snap.docs;
        for (let i = 0; i < docsArr.length; i += 450) {
          const batch = writeBatch(db);
          docsArr.slice(i, i + 450).forEach((d) => {
            batch.set(doc(db, 'recoveryVault', `${snapshotId}__${name}__${d.id}`), {
              snapshotId, coll: name, docId: d.id, data: d.data(),
            });
          });
          await batch.commit();
        }
      }

      // 2) Write the meta record (this is what the UI watches).
      await setDoc(doc(db, 'recoveryMeta', 'current'), {
        snapshotId, createdAt, expiresAt, counts, total,
        byEmail: user?.email || null,
        bizSettings: (() => { try { return {
          name: localStorage.getItem('maruti_biz_name') || '', contact: localStorage.getItem('maruti_biz_contact') || '',
          gst: localStorage.getItem('maruti_biz_gst') || '', address: localStorage.getItem('maruti_biz_address') || '',
          lowStock: localStorage.getItem('maruti_low_stock_default') || '', fastMover: localStorage.getItem('maruti_fast_mover_min') || '',
          deadDays: localStorage.getItem('maruti_dead_stock_days') || '', reorderMult: localStorage.getItem('maruti_reorder_mult') || '',
        }; } catch { return {}; } })(),
      });

      toast.loading('Snapshot saved. Wiping live data…', { id: t });

      // 3) Now delete all live docs (snapshot is safe, so this is recoverable).
      for (const name of RECOVERY_COLLECTIONS) {
        const snap = await getDocs(collection(db, name));
        const docsArr = snap.docs;
        for (let i = 0; i < docsArr.length; i += 450) {
          const batch = writeBatch(db);
          docsArr.slice(i, i + 450).forEach((d) => batch.delete(doc(db, name, d.id)));
          await batch.commit();
        }
      }

      toast.success(`System reset. ${total} records saved to the 7-day Recovery Vault.`, { id: t, duration: 6000 });
      return true;
    } catch (err) {
      console.error('resetAllData failed:', err);
      toast.error(`Reset failed — ${err.message || 'check connection/rules'}. Nothing was deleted if the snapshot didn't finish.`, { id: t, duration: 8000 });
      return false;
    }
  }

  // Restore every record from the current vault back to its original collection
  // and id, then clear the vault.
  async function restoreFromVault() {
    if (!isAdmin) { toast.error('Only an admin can restore.'); return false; }
    const t = toast.loading('Restoring your data…');
    try {
      const metaSnap = await getDoc(doc(db, 'recoveryMeta', 'current'));
      if (!metaSnap.exists()) { toast.error('No recovery snapshot found.', { id: t }); return false; }
      const meta = metaSnap.data();
      if (Date.now() > (meta.expiresAt || 0)) { toast.error('Recovery period has expired.', { id: t }); return false; }

      const vaultSnap = await getDocs(query(collection(db, 'recoveryVault'), orderBy('coll')));
      const mine = vaultSnap.docs.filter((d) => d.data().snapshotId === meta.snapshotId);
      let total = 0;
      for (let i = 0; i < mine.length; i += 450) {
        const batch = writeBatch(db);
        mine.slice(i, i + 450).forEach((d) => {
          const v = d.data();
          if (v.coll && v.docId) { batch.set(doc(db, v.coll, v.docId), v.data || {}); total++; }
        });
        await batch.commit();
      }

      // Restore business settings to this device.
      try {
        const b = meta.bizSettings || {};
        const map = { maruti_biz_name: b.name, maruti_biz_contact: b.contact, maruti_biz_gst: b.gst, maruti_biz_address: b.address, maruti_low_stock_default: b.lowStock, maruti_fast_mover_min: b.fastMover, maruti_dead_stock_days: b.deadDays, maruti_reorder_mult: b.reorderMult };
        Object.entries(map).forEach(([k, val]) => { if (val) localStorage.setItem(k, val); });
      } catch {}

      // Clear the vault now that everything is back.
      await purgeVault(meta.snapshotId);
      toast.success(`Restored ${total} records. Your shop is back exactly as it was.`, { id: t, duration: 6000 });
      return true;
    } catch (err) {
      console.error('restoreFromVault failed:', err);
      toast.error(`Restore failed — ${err.message || 'check connection/rules'}.`, { id: t, duration: 8000 });
      return false;
    }
  }

  // Delete the vault contents + meta (used after restore, and on expiry).
  async function purgeVault(snapshotId) {
    try {
      const vaultSnap = await getDocs(collection(db, 'recoveryVault'));
      const mine = snapshotId ? vaultSnap.docs.filter((d) => d.data().snapshotId === snapshotId) : vaultSnap.docs;
      for (let i = 0; i < mine.length; i += 450) {
        const batch = writeBatch(db);
        mine.slice(i, i + 450).forEach((d) => batch.delete(doc(db, 'recoveryVault', d.id)));
        await batch.commit();
      }
      await deleteDoc(doc(db, 'recoveryMeta', 'current')).catch(() => {});
    } catch (e) { console.error('purgeVault failed:', e); }
  }

  // ---- Staff (non-admin) management with per-person permissions ----
  async function addStaffEmail(rawEmail) {
    const email = (rawEmail || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error('Enter a valid email address.'); return false; }
    if (bootstrapAdmins.map((e) => e.toLowerCase()).includes(email) || dbAdmins.includes(email)) { toast.error('That email is already an admin.'); return false; }
    if (staffPerms[email]) { toast.error('That staff member already exists.'); return false; }
    const t = toast.loading('Adding staff…');
    try {
      await setDoc(doc(db, 'appSettings', 'roles'), { staff: { ...staffPerms, [email]: { costPrices: false, deletes: false, exports: false } }, updatedAt: serverTimestamp(), updatedBy: user?.email || '' }, { merge: true });
      toast.success(`${email} added as staff. They log in with the password you set in Firebase.`, { id: t, duration: 6000 });
      return true;
    } catch (e) { console.error('addStaffEmail failed:', e); toast.error('Could not add staff. Check Firestore rules are published.', { id: t }); return false; }
  }
  async function removeStaffEmail(rawEmail) {
    const email = (rawEmail || '').trim().toLowerCase();
    const t = toast.loading('Removing staff…');
    try {
      const next = { ...staffPerms }; delete next[email];
      await setDoc(doc(db, 'appSettings', 'roles'), { staff: next, updatedAt: serverTimestamp(), updatedBy: user?.email || '' }, { merge: true });
      toast.success(`${email} removed. They can still log in but with no special access.`, { id: t });
    } catch (e) { console.error('removeStaffEmail failed:', e); toast.error('Could not remove staff. Check Firestore rules.', { id: t }); }
  }
  async function setStaffPermission(rawEmail, key, value) {
    const email = (rawEmail || '').trim().toLowerCase();
    try {
      const current = staffPerms[email] || { costPrices: false, deletes: false, exports: false };
      await setDoc(doc(db, 'appSettings', 'roles'), { staff: { ...staffPerms, [email]: { ...current, [key]: value } }, updatedAt: serverTimestamp(), updatedBy: user?.email || '' }, { merge: true });
    } catch (e) { console.error('setStaffPermission failed:', e); toast.error('Could not update permission. Check Firestore rules.'); }
  }

  // ---- Staff & Access: manage admin emails (stored in appSettings/roles) ----
  // Owner stays admin via BOOTSTRAP_ADMINS in AuthContext regardless of this list.
  async function addAdminEmail(rawEmail) {
    const email = (rawEmail || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error('Enter a valid email address.'); return false; }
    if (bootstrapAdmins.map((e) => e.toLowerCase()).includes(email) || dbAdmins.includes(email)) { toast.error('That email is already an admin.'); return false; }
    const t = toast.loading('Granting admin…');
    try {
      const next = Array.from(new Set([...dbAdmins, email]));
      await setDoc(doc(db, 'appSettings', 'roles'), { admins: next, updatedAt: serverTimestamp(), updatedBy: user?.email || '' }, { merge: true });
      toast.success(`${email} is now an admin. They must log out and back in.`, { id: t, duration: 5000 });
      return true;
    } catch (e) {
      console.error('addAdminEmail failed:', e);
      toast.error('Could not update admins. Make sure the latest Firestore rules are published.', { id: t });
      return false;
    }
  }
  async function removeAdminEmail(rawEmail) {
    const email = (rawEmail || '').trim().toLowerCase();
    if (bootstrapAdmins.map((e) => e.toLowerCase()).includes(email)) { toast.error('The owner account can’t be removed.'); return; }
    const t = toast.loading('Revoking admin…');
    try {
      const next = dbAdmins.filter((e) => e !== email);
      await setDoc(doc(db, 'appSettings', 'roles'), { admins: next, updatedAt: serverTimestamp(), updatedBy: user?.email || '' }, { merge: true });
      toast.success(`${email} is no longer an admin.`, { id: t });
    } catch (e) {
      console.error('removeAdminEmail failed:', e);
      toast.error('Could not update admins. Check Firestore rules.', { id: t });
    }
  }

  // Spec fix: Export Audit Logs is its OWN handler — audit data only, no
  // navigation, no tab switch. Pulls the FULL auditLog (not the capped view).
  async function exportAuditLogs() {
    const t = toast.loading('Exporting audit logs…');
    try {
      const XLSX = await import('xlsx');
      const snap = await getDocs(query(collection(db, 'auditLog'), orderBy('createdAt', 'desc')));
      if (snap.empty) { toast.error('No audit entries to export yet.', { id: t }); return; }
      const LABELS = {
        delete_part: 'Deleted part', delete_supplier: 'Deleted supplier', price_change: 'Price change',
        below_floor_sale: 'Below-floor sale', stock_adjustment: 'Stock adjustment',
        archive_part: 'Archived part', restore_part: 'Restored part',
      };
      const rows = snap.docs.map((d) => {
        const e = d.data();
        const det = e.details || {};
        const ts = tsToDate(e.createdAt);
        const isSupplier = e.action === 'delete_supplier' || !!e.supplierId;
        let prev = '', next = '', qty = '';
        if (e.action === 'stock_adjustment') {
          prev = det.stockBefore ?? '';
          next = det.stockAfter ?? '';
          const dlt = (det.stockAfter != null && det.stockBefore != null) ? (det.stockAfter - det.stockBefore) : (det.qty || 0);
          qty = `${dlt < 0 ? '-' : '+'}${Math.abs(dlt)}`;
        } else if (e.action === 'price_change') {
          const ch = Object.entries(det).filter(([, v]) => v && typeof v === 'object' && 'from' in v);
          prev = ch.map(([k, v]) => `${k}: ₹${v.from}`).join('; ');
          next = ch.map(([k, v]) => `${k}: ₹${v.to}`).join('; ');
        }
        return {
          'Event Type': LABELS[e.action] || e.action,
          'User': e.performedByEmail || 'unknown',
          'Timestamp': ts ? ts.toLocaleString('en-IN') : '',
          'Part Name': isSupplier ? '' : (e.name || ''),
          'Supplier Name': isSupplier ? (e.name || '') : '',
          'Previous Value': prev,
          'New Value': next,
          'Quantity': qty,
          'Notes': det.notes || '',
          'Reason': det.reason || '',
        };
      });
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [{ wch: 16 }, { wch: 26 }, { wch: 20 }, { wch: 20 }, { wch: 18 }, { wch: 22 }, { wch: 22 }, { wch: 10 }, { wch: 24 }, { wch: 16 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Audit Log');
      XLSX.writeFile(wb, `Maruti_Care_AuditLog_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success(`Exported ${rows.length} audit entries.`, { id: t });
    } catch (err) {
      console.error('Audit export failed:', err);
      toast.error('Audit export failed — check your connection / access.', { id: t });
    }
  }

  async function exportInventoryExcel(subset) {
    const items = Array.isArray(subset) && subset.length ? subset : inventory;
    if (items.length === 0) {
      toast.error('Nothing to export yet.');
      return;
    }
    try {
      // Lazy-load SheetJS only when needed so it never weighs down initial load.
      const XLSX = await import('xlsx');

      // Map state into clean, business-friendly rows for the worksheet.
      const rows = items.map((p) => {
        const sups = getPartSuppliers(p);
        return {
          'Part Name': p.name || '',
          'SKU': p.sku || '',
          'Category': p.category || '',
          'All Categories': asList(p.categories).join('; '),
          'Vehicle': p.vehicle || '',
          'Compatible Cars': flattenVehicles(p.compatibleCars).join('; '),
          'Shelf / Bin': p.locationBin || '',
          'Stock': p.stock ?? 0,
          'Min Stock': p.minStock ?? 5,
          'Units Sold': p.salesCount ?? 0,
          'Status':
            (p.stock ?? 0) === 0 ? 'Out of Stock' : (p.stock ?? 0) <= (p.minStock ?? 5) ? 'Low' : 'OK',
          'Purchase Price (₹)': p.purchasePrice ?? 0,
          'Selling Price (₹)': p.sellingPrice ?? 0,
          'Min Selling Price (₹)': p.minSellingPrice ?? 0,
          'Stock Value (₹)': (p.stock || 0) * (p.sellingPrice || 0),
          'Potential Profit (₹)': (p.stock || 0) * ((p.sellingPrice || 0) - (p.purchasePrice || 0)),
          'Suppliers': sups.map((s) => s.name).filter(Boolean).join('; '),
          'Supplier Phones': sups.map((s) => s.phone).filter(Boolean).join('; '),
          'Has Photo': p.imageString ? 'Yes' : 'No', // UPDATE-08: never export the Base64 blob
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(rows);
      // Set sensible column widths for a polished sheet.
      worksheet['!cols'] = [
        { wch: 26 }, { wch: 14 }, { wch: 20 }, { wch: 24 }, { wch: 20 }, { wch: 22 },
        { wch: 16 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 12 },
        { wch: 16 }, { wch: 15 }, { wch: 18 }, { wch: 15 }, { wch: 18 },
        { wch: 28 }, { wch: 24 }, { wch: 10 },
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventory');

      const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      XLSX.writeFile(workbook, `Maruti_Care_Inventory_${stamp}.xlsx`);
      recordIO('export', items.length);
      toast.success(`Exported ${items.length} part${items.length > 1 ? 's' : ''} to Excel`);
    } catch (err) {
      console.error('Excel export failed:', err);
      toast.error('Could not export to Excel.');
    }
  }

  // ---- Additional business reports (all Excel .xlsx) ----
  async function writeSheet(rows, sheetName, fileName, emptyMsg) {
    if (!rows || rows.length === 0) { toast.error(emptyMsg || 'Nothing to export yet.'); return; }
    try {
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      XLSX.writeFile(wb, `${fileName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success(`Exported ${rows.length} row${rows.length > 1 ? 's' : ''} to Excel`);
    } catch (e) { console.error('Report export failed:', e); toast.error('Could not export the report.'); }
  }

  async function exportSalesReport() {
    const rows = sales.map((s) => ({
      'Date': s.createdAt?.toDate ? s.createdAt.toDate().toLocaleString('en-IN') : '',
      'Part': s.partName || '', 'SKU': s.sku || '',
      'Quantity': s.quantity ?? 0, 'Unit Price (₹)': s.unitPrice ?? 0,
      'Total (₹)': s.totalPrice ?? 0, 'Profit (₹)': s.profit ?? 0,
    }));
    writeSheet(rows, 'Sales', 'Maruti_Care_Sales_Report', 'No sales to export yet.');
  }

  async function exportLowStockReport() {
    const low = inventory.filter((p) => !p.archived && (p.stock || 0) <= (p.minStock || 5));
    const rows = low.map((p) => ({
      'Part': p.name || '', 'SKU': p.sku || '', 'Category': p.category || '',
      'Current Stock': p.stock ?? 0, 'Min Stock': p.minStock ?? 5,
      'Shortfall': Math.max(0, (p.minStock ?? 5) - (p.stock ?? 0)),
      'Status': (p.stock ?? 0) === 0 ? 'Out of Stock' : 'Low',
      'Suggested Order': suggestedOrderQty(p),
      'Suppliers': getPartSuppliers(p).map((s) => s.name).filter(Boolean).join('; '),
    }));
    writeSheet(rows, 'Low Stock', 'Maruti_Care_Low_Stock_Report', 'No low-stock items — inventory is healthy.');
  }

  async function exportSupplierReport() {
    const rows = suppliers.map((s) => {
      const partsForSup = inventory.filter((p) => getPartSuppliers(p).some((x) => x.id === s.id || x.name === s.name));
      return {
        'Supplier': s.name || '',
        'Contact': s.contactPerson || '',
        'Phone': getSupplierContacts(s).map((c) => c.number).filter(Boolean).join('; '),
        'GSTIN': s.gstin || '',
        'Address': s.address || '',
        'Parts Supplied': partsForSup.length,
        'Low-Stock Parts': partsForSup.filter((p) => (p.stock || 0) <= (p.minStock || 5)).length,
      };
    });
    writeSheet(rows, 'Suppliers', 'Maruti_Care_Supplier_Report', 'No suppliers to export yet.');
  }

  async function exportStockMovementReport() {
    const inRows = restocks.map((r) => ({ 'Date': r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString('en-IN') : '', 'Type': 'Stock In', 'Part': r.partName || '', 'SKU': r.sku || '', 'Quantity': r.quantity ?? 0, 'Reason': 'Received' }));
    const adjRows = stockAdjustments.map((a) => ({ 'Date': a.createdAt?.toDate ? a.createdAt.toDate().toLocaleString('en-IN') : '', 'Type': (a.quantity || 0) < 0 ? 'Reduction' : 'Addition', 'Part': a.partName || '', 'SKU': a.sku || '', 'Quantity': a.quantity ?? 0, 'Reason': a.reason || 'Adjustment' }));
    const saleRows = sales.map((s) => ({ 'Date': s.createdAt?.toDate ? s.createdAt.toDate().toLocaleString('en-IN') : '', 'Type': 'Sale', 'Part': s.partName || '', 'SKU': s.sku || '', 'Quantity': -(s.quantity ?? 0), 'Reason': 'Sold' }));
    const rows = [...inRows, ...adjRows, ...saleRows].sort((a, b) => (a.Date < b.Date ? 1 : -1));
    writeSheet(rows, 'Stock Movement', 'Maruti_Care_Stock_Movement_Report', 'No stock movements to export yet.');
  }

  // ---- Part save: resolve multi-suppliers, bargain floor, offline-first ----
  function handleSave(formData) {
    if (!formData.name?.trim()) return;
    if (demoMode) {
      const now = new Date();
      const stamp = { seconds: Math.floor(now.getTime() / 1000), nanoseconds: 0, toDate: () => now, toMillis: () => now.getTime() };
      const sup = (formData.suppliers || []).map((r, i) => ({ id: r.id || ('demo-sup-new-' + now.getTime() + '-' + i), name: (r.name || '').trim(), phone: r.phone || '' })).filter((s) => s.name);
      const built = {
        ...formData,
        id: formData.id || ('demo-part-' + now.getTime()),
        name: formData.name.trim(),
        stock: Math.max(0, Math.floor(Number(formData.stock) || 0)),
        minStock: Math.max(0, Math.floor(Number(formData.minStock) || 5)),
        purchasePrice: Number(formData.purchasePrice) || 0,
        sellingPrice: Number(formData.sellingPrice) || 0,
        minSellingPrice: Number(formData.minSellingPrice) || 0,
        salesCount: formData.salesCount || 0,
        suppliers: sup,
        archived: !!formData.archived,
        category: (formData.categories && formData.categories[0]) || formData.category || '',
        imageString: formData.imageString || imageForPartName(formData.name || ''),
        createdAt: formData.createdAt || stamp,
        updatedAt: stamp,
      };
      // Register any brand-new suppliers into the demo directory too.
      setSuppliers((prev) => { const ids = new Set(prev.map((s) => s.id)); const add = sup.filter((s) => !ids.has(s.id) && String(s.id).startsWith('demo-sup-new')); return add.length ? [...prev, ...add.map((s) => ({ id: s.id, name: s.name, phone: s.phone }))] : prev; });
      setInventory((prev) => (formData.id ? prev.map((p) => (p.id === formData.id ? { ...p, ...built } : p)) : [built, ...prev]));
      setShowModal(false); setEditPart(null); setSaving(false);
      smartSaveToast(built.name, { isEdit: !!formData.id, hasSupplier: sup.length > 0 });
      return;
    }

    // Task 3: warn on a likely-duplicate when CREATING a part (skip on edit and
    // when the user already chose "Create Anyway"). Match on normalized name,
    // then tighten with SKU or an overlapping vehicle when available.
    if (!formData.id && !formData._dupAck) {
      const nameKey = safeLower(formData.name);
      const skuKey = safeLower((formData.sku || '').trim());
      const vehset = new Set(asList(formData.compatibleCars).map(safeLower));
      const dup = inventory.find((p) => {
        if (p.archived) return false;
        if (safeLower(p.name) !== nameKey) return false;
        if (skuKey && safeLower(p.sku) && safeLower(p.sku) !== skuKey) return false; // different SKU → not a dup
        return true;
      }) || (skuKey && inventory.find((p) => !p.archived && safeLower(p.sku) === skuKey));
      if (dup) {
        setDupPrompt({ existing: dup, form: formData });
        return; // wait for user's choice
      }
    }

    setSaving(true);

    // Issue 2 + hardening: clean & DEDUPE supplier rows (a user can accidentally
    // add the same supplier twice). Key by id, else by lowercased name.
    const seenRowKeys = new Set();
    const cleanRows = (formData.suppliers || [])
      .map((r) => ({
        id: r.id || '',
        name: (r.name || '').trim(),
        phone: tenDigits(r.phone),
        preferredLabel: r.preferredLabel || 'Primary',
        isPreferred: !!r.isPreferred,
        phoneNumbers: Array.isArray(r.phoneNumbers) ? r.phoneNumbers : [],
      }))
      .filter((r) => {
        if (!r.name) return false;
        const key = r.id || safeLower(r.name);
        if (seenRowKeys.has(key)) return false;
        seenRowKeys.add(key);
        return true;
      });

    // Resolve each row to a directory supplier — link existing (by id/name), or
    // create a new record with a locally-generated id (works offline). A cache
    // guarantees we never create two docs for the same new name in one save.
    const createdByName = new Map();
    const resolved = cleanRows.map((r) => {
      if (r.id) return { id: r.id, name: r.name, phone: r.phone, preferredLabel: r.preferredLabel };
      const match = suppliers.find((s) =>
        getSupplierNames(s).some((n) => safeLower(n) === safeLower(r.name))
      );
      if (match) {
        return {
          id: match.id,
          name: r.name,
          phone: r.phone || getSupplierPhones(match)[0] || '',
          preferredLabel: r.preferredLabel,
        };
      }
      const cachedId = createdByName.get(safeLower(r.name));
      if (cachedId) return { id: cachedId, name: r.name, phone: r.phone, preferredLabel: r.preferredLabel };

      const ref = doc(collection(db, 'suppliers'));
      // #1: build the full contact list (primary + alternates) from the row.
      const seenN = new Set();
      let contactList = (r.phoneNumbers || [])
        .map((c) => ({ number: tenDigits(c.number), label: (c.label || 'Primary').trim() || 'Primary' }))
        .filter((c) => c.number && !seenN.has(c.number) && seenN.add(c.number));
      if (contactList.length === 0 && r.phone) contactList = [{ number: r.phone, label: 'Primary' }];
      const primaryNum = r.phone && contactList.some((c) => c.number === r.phone) ? r.phone : contactList[0]?.number || '';
      setDoc(ref, {
        name: r.name,
        altNames: [],
        phoneNumbers: contactList,
        primaryPhone: normalizePhone(primaryNum),
        phones: contactList.map((c) => c.number),
        phone: normalizePhone(primaryNum),
        notes: 'Auto-added from inventory',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch((e) => console.error('Auto-add supplier failed:', e));
      createdByName.set(safeLower(r.name), ref.id);
      return { id: ref.id, name: r.name, phone: primaryNum || r.phone, preferredLabel: r.preferredLabel };
    });

    // #5: attach the per-part preferred flag and float the preferred supplier to
    // the front so it becomes the default for reorders + legacy mirrors.
    resolved.forEach((r, i) => { r.isPreferred = !!cleanRows[i]?.isPreferred; });
    resolved.sort((a, b) => (b.isPreferred ? 1 : 0) - (a.isPreferred ? 1 : 0));

    const first = resolved[0] || { name: '', phone: '' };

    // Hardening: clamp every numeric to a sane, non-negative value (guards
    // against pasted negatives, NaN, or stray exponent strings).
    const nonNegInt = (v) => Math.max(0, parseInt(v, 10) || 0);
    const nonNegNum = (v) => Math.max(0, parseFloat(v) || 0);

    const categoriesArr = asList(formData.categories);
    const vehModels = asList(formData.compatibleCars);
    const vehGrouped = groupVehicles(vehModels, mergedVehicleTree); // #3 + Task 1: custom-aware
    const vehicleDisplay =
      vehModels.length === 0
        ? ''
        : vehModels.some((m) => /universal/i.test(m))
        ? 'Universal / All Vehicles'
        : vehGrouped.map((g) => g.brand).join(', ');
    const payload = {
      name: formData.name.trim(),
      sku: (formData.sku || '').trim(),
      category: (categoriesArr[0] || formData.category || '').trim(), // #6: primary mirror
      categories: categoriesArr, // #6: full multi-select
      vehicle: vehicleDisplay, // derived headline for the table column
      locationBin: (formData.locationBin || '').trim(), // Feature 1
      compatibleCars: vehGrouped, // #3: grouped [{brand, models}]
      stock: nonNegInt(formData.stock),
      minStock: nonNegInt(formData.minStock) || 5,
      purchasePrice: nonNegNum(formData.purchasePrice),
      sellingPrice: nonNegNum(formData.sellingPrice),
      minSellingPrice: nonNegNum(formData.minSellingPrice), // Issue 3: bargain floor
      suppliers: resolved, // {id,name,phone,preferredLabel,isPreferred}
      supplier: first.name, // legacy mirror (preferred/primary)
      supplierPhone: first.phone, // legacy mirror (preferred/primary)
      imageString: formData.imageString || '',
      updatedAt: serverTimestamp(),
    };

    try {
      const copiedFrom = duplicateOriginRef.current || null; // Section 2: DB link
      const writePromise = formData.id
        ? updateDoc(doc(db, 'parts', formData.id), payload) // stock & salesCount are managed by Sell/Receive, never overwritten here; copiedFrom is preserved (omitted here)
        : addDoc(collection(db, 'parts'), { ...payload, stock: nonNegInt(formData.stock), salesCount: 0, copiedFrom, archived: !!copiedFrom, createdAt: serverTimestamp() });
      duplicateOriginRef.current = null;

      writePromise.catch((err) =>
        console.error('Background sync will retry when back online:', err)
      );

      // ADD-06: record price changes (cost/margin edits are sensitive).
      if (formData.id) {
        const prev = inventory.find((p) => p.id === formData.id) || {};
        const changes = {};
        [['purchasePrice', 'Purchase'], ['sellingPrice', 'MRP'], ['minSellingPrice', 'Min Sell']].forEach(([k, label]) => {
          if ((prev[k] || 0) !== (payload[k] || 0)) changes[label] = { from: prev[k] || 0, to: payload[k] || 0 };
        });
        if (Object.keys(changes).length) writeAudit('price_change', { partId: formData.id, name: payload.name }, changes);
      }

      if (copiedFrom) toast.success('Copy saved to Archive — restore it to activate');
      else smartSaveToast(formData.name, { isEdit: !!formData.id, hasSupplier: (formData.suppliers || []).some((r) => (r.name || '').trim()) });
    } catch (err) {
      console.error('Save failed:', err);
      toast.error('Could not save part. Please check the details and try again.');
    } finally {
      setSaving(false);
      setShowModal(false);
      setEditPart(null);
    }
  }

  // ---- FIX 2: WhatsApp purchase-order generation & smart routing ----
  function openWhatsAppPO(part, supplierName, number) {
    const text = encodeURIComponent(buildPurchaseOrder(part, supplierName));
    const url = `https://wa.me/${waNumber(number)}?text=${text}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  // ---- Reorder request lifecycle (Pending Supplier Actions) ----
  // Status flow: Requested → Awaiting Delivery → Delivered. A part needing
  // reorder with no active request is implicitly "Not Ordered" (it sits in the
  // Reorder Center). Clicking Order logs a 'Requested' entry (one active per part).
  const REORDER_FLOW = ['Requested', 'Awaiting Delivery', 'Delivered'];
  function logReorderRequest(part, chosenSupplier) {
    const existing = reorderRequests.find((r) => r.partId === part.id && r.status !== 'Delivered');
    if (existing) { toast('A reorder is already active for this part.', { icon: 'ℹ️' }); return; }
    const sup = chosenSupplier || getPartSuppliers(part)[0];
    const qty = Math.max((part.minStock || 5) * 2 - (part.stock || 0), part.minStock || 5);
    if (demoMode) {
      const now = new Date();
      const stamp = { seconds: Math.floor(now.getTime() / 1000), nanoseconds: 0, toDate: () => now, toMillis: () => now.getTime() };
      setReorderRequests((prev) => [{ id: 'demo-ro-' + now.getTime(), partId: part.id, partName: part.name || '', supplierId: sup?.id || null, supplierName: sup?.name || part.supplier || '—', qty, status: 'Requested', createdAt: stamp }, ...prev]);
      toast.success(`Reorder logged: ${part.name}${sup?.name ? ' → ' + sup.name : ''} (demo)`);
      return;
    }
    addDoc(collection(db, 'reorderRequests'), {
      partId: part.id,
      partName: part.name || '',
      supplierId: sup?.id || null,
      supplierName: sup?.name || part.supplier || '—',
      qty: Math.max((part.minStock || 5) * 2 - (part.stock || 0), part.minStock || 5),
      status: 'Requested',
      byEmail: user?.email || null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch((e) => console.error('Reorder request failed:', e));
  }
  // Reorder entry: if the part has 2+ suppliers, prompt to choose; else go direct.
  function requestReorder(part) {
    const sups = getPartSuppliers(part);
    if (sups.length >= 2) { setReorderChoice({ part, suppliers: sups }); return; }
    logReorderRequest(part, sups[0]);
  }
  // Combined action for the Overview "Order" button: log the request + open WA.
  function handleReorderAndLog(part) {
    logReorderRequest(part);
    handleReorder(part);
  }
  function advanceReorderStatus(req) {
    const idx = REORDER_FLOW.indexOf(req.status);
    const next = REORDER_FLOW[Math.min(idx + 1, REORDER_FLOW.length - 1)];
    if (demoMode) { setReorderRequests((prev) => prev.map((r) => (r.id === req.id ? { ...r, status: next } : r))); toast.success(`${req.partName}: ${next} (demo)`); return; }
    updateDoc(doc(db, 'reorderRequests', req.id), { status: next, updatedAt: serverTimestamp() })
      .then(() => toast.success(`${req.partName}: ${next}`))
      .catch((e) => { console.error(e); toast.error('Could not update status.'); });
  }
  function clearReorderRequest(req) {
    if (demoMode) {
      if (!demoAdmin) { protectedDemoToast(); return; }
      setReorderRequests((prev) => prev.filter((r) => r.id !== req.id)); toast.success('Request cleared (demo)'); return;
    }
    deleteDoc(doc(db, 'reorderRequests', req.id)).catch((e) => console.error('Clear request failed:', e));
  }

  function handleReorder(part) {
    // Resolve the part's primary supplier + their full contact registry.
    const partSup = getPartSuppliers(part)[0];
    const supName = partSup?.name || part.supplier || '';

    // #2: if the part has a saved PREFERRED contact number, use it directly —
    // the owner already chose where this part's PO should go.
    if (partSup && tenDigits(partSup.phone)) {
      openWhatsAppPO(part, supName, partSup.phone);
      return;
    }

    // Otherwise resolve the directory supplier's contacts (id → phone → name).
    const record =
      suppliers.find((s) => partSup?.id && s.id === partSup.id) ||
      suppliers.find(
        (s) =>
          getSupplierPhones(s).some((p) => normalizePhone(p) === normalizePhone(partSup?.phone)) ||
          getSupplierNames(s).some((n) => safeLower(n) === safeLower(supName))
      );

    const contacts = record ? getSupplierContacts(record) : [];

    // Strict guard clause: no usable contact → graceful operational block.
    if (!supName || contacts.length === 0) {
      setReorderTarget({ part, block: true });
      return;
    }
    // Exactly one number → fire immediately.
    if (contacts.length === 1) {
      openWhatsAppPO(part, supName, contacts[0].number);
      return;
    }
    // Multiple numbers → open the smart router modal to choose.
    setReorderTarget({ part, supplierName: supName, contacts });
  }

  // ---- Real reorder workflow (dialog with WhatsApp / Create PO / manage existing) ----
  function openReorderDialog(part) {
    const sup = getPartSuppliers(part)[0];
    const supRecord = suppliers.find((s) => sup?.id && s.id === sup.id) || null;
    const phone = tenDigits(sup?.phone) || (supRecord ? tenDigits(getSupplierPhones(supRecord)[0]) : '') || '';
    const suggestedQty = Math.max((part.minStock || 5) * 2 - (part.stock || 0), part.minStock || 5);
    const existing = reorderRequests.find((r) => r.partId === part.id && r.status !== 'Delivered') || null;
    setReorderDialog({ part, supplierName: sup?.name || part.supplier || '', supplierId: sup?.id || null, phone, suggestedQty, existing });
  }
  function reorderViaWhatsApp(d) {
    if (!d.existing) logReorderRequest(d.part, d.supplierId ? { id: d.supplierId, name: d.supplierName, phone: d.phone } : undefined);
    if (d.phone) openWhatsAppPO(d.part, d.supplierName, d.phone);
    else toast.error('No contact number on file for this supplier.');
    setReorderDialog(null);
  }
  async function reorderViaPO(d) {
    const ok = await createPO({
      supplierId: d.supplierId,
      supplierName: d.supplierName,
      items: [{ partId: d.part.id, name: d.part.name, sku: d.part.sku || '', qty: d.suggestedQty, unitCost: d.part.purchasePrice || 0 }],
      notes: 'Auto-created from reorder',
    });
    setReorderDialog(null);
    if (ok !== false) { setActiveTab('inventory'); setInvSubView('po'); }
  }

  // ---- Issue 3 + Feature 5: clicking "sell" routes by stock level ----
  function handleSellClick(part) {
    if ((part.stock || 0) <= 0) {
      setAlternativePart(part); // Feature 5: suggest alternatives instead of erroring
    } else {
      setCheckoutPart(part);
    }
  }

  // ---- Issue 3: complete a checkout sale (price already floor-validated) ----
  async function handleSell(qty, pricePerUnit, belowFloorOverride = false) {
    const part = checkoutPart;
    if (!part) return;
    if (demoMode) {
      const want = Math.max(1, Math.floor(qty || 0));
      if (want > (part.stock || 0)) { toast.error(`Cannot sell ${want} — only ${part.stock || 0} in stock.`); return; }
      const sold = want;
      const unitCost = part.purchasePrice || 0;
      const now = new Date();
      const stamp = { seconds: Math.floor(now.getTime() / 1000), nanoseconds: 0, toDate: () => now, toMillis: () => now.getTime() };
      const revenue = sold * pricePerUnit;
      const cost = sold * unitCost;
      setInventory((prev) => prev.map((p) => (p.id === part.id ? { ...p, stock: Math.max(0, (p.stock || 0) - sold), salesCount: (p.salesCount || 0) + sold } : p)));
      setSales((prev) => [{ id: 'demo-sale-' + now.getTime(), partId: part.id, name: part.name, partName: part.name, sku: part.sku, category: part.category || '', brands: [part.vehicle].filter(Boolean), qty: sold, quantity: sold, unitPrice: pricePerUnit, unitCost, costPrice: unitCost, revenue, total: revenue, totalPrice: revenue, cost, profit: revenue - cost, soldByEmail: 'demo@balajiautoos.com', createdAt: stamp }, ...prev]);
      setCheckoutPart(null);
      toast.success(`Sold ${sold} × ${part.name} (demo)`);
      return;
    }
    const want = Math.max(1, Math.floor(qty || 0));

    // Issue 6: when online, run a Firestore TRANSACTION that re-reads stock on the
    // server and refuses to let it go negative — so two simultaneous sales of the
    // last units can't both succeed. Offline (no server round-trip possible), fall
    // back to the atomic-increment path so the shop can still sell on one device.
    let sold = want;
    if (online) {
      try {
        sold = await runTransaction(db, async (tx) => {
          const ref = doc(db, 'parts', part.id);
          const snap = await tx.get(ref);
          if (!snap.exists()) throw new Error('This part no longer exists.');
          const cur = snap.data().stock || 0;
          if (want > cur) throw new Error(`Cannot sell ${want} — only ${cur} left in stock.`);
          tx.update(ref, { stock: increment(-want), salesCount: increment(want), updatedAt: serverTimestamp() });
          return want;
        });
      } catch (err) {
        // Data-integrity rule: if the write fails while we believe we're online,
        // do NOT optimistically update stock/analytics or claim a sale. Surface a
        // clear error and stop — UI and database stay consistent.
        console.error('Sale transaction failed:', err);
        const friendly = /has not been used|disabled/i.test(err?.message || '')
          ? 'Sale not saved — the database (Firestore) is not enabled for this project. Enable it, then retry.'
          : err?.code === 'permission-denied'
          ? 'Sale not saved — permission denied by security rules.'
          : err?.message || 'Sale could not be completed. Nothing was changed.';
        toast.error(friendly);
        return;
      }
    } else {
      // Genuinely offline: queue the write (IndexedDB replays on reconnect) and
      // update optimistically so the shop can keep selling on one device.
      sold = Math.max(1, Math.min(want, part.stock || 0));
      updateDoc(doc(db, 'parts', part.id), { stock: increment(-sold), salesCount: increment(sold), updatedAt: serverTimestamp() })
        .catch((e) => console.error('Sale sync will retry when online:', e));
    }

    const newStock = Math.max(0, (part.stock || 0) - sold);
    const newSalesCount = (part.salesCount || 0) + sold;
    setInventory((prev) =>
      prev.map((p) => (p.id === part.id ? { ...p, stock: newStock, salesCount: newSalesCount } : p))
    );

    // Append to the sales ledger so analytics (Monthly Profit Trend, etc.) build
    // up real history going forward. Revenue uses the actual sale price; cost uses
    // the part's purchase price snapshot.
    const unitCost = part.purchasePrice || 0;
    const revenue = sold * pricePerUnit;
    const cost = sold * unitCost;
    addDoc(collection(db, 'sales'), {
      partId: part.id,
      name: part.name || '',
      qty: sold,
      unitPrice: pricePerUnit,
      unitCost,
      revenue,
      cost,
      profit: revenue - cost,
      category: part.category || '',
      brands: brandsOf(part),
      soldBy: user?.uid || null,
      soldByEmail: user?.email || null,
      belowFloor: !!belowFloorOverride, // Task 4: flag override sales
      floorPrice: part.minSellingPrice || 0,
      createdAt: serverTimestamp(),
    }).catch((err) => console.error('Sale ledger write will retry when online:', err));

    // Task 4: audit any below-floor override sale (who, floor vs actual).
    if (belowFloorOverride) {
      writeAudit(
        'below_floor_sale',
        { partId: part.id, name: part.name || '' },
        { floor: part.minSellingPrice || 0, actual: pricePerUnit, qty: sold, override: true }
      );
    }

    // FIX-07: keep an aggregated monthly rollup so "All Time" analytics are never
    // capped by the 2,000-doc ledger window. One tiny doc per month, updated with
    // atomic increments (safe under concurrent sales).
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    setDoc(
      doc(db, 'salesRollups', monthKey),
      {
        month: monthKey,
        revenue: increment(revenue),
        cost: increment(cost),
        profit: increment(revenue - cost),
        units: increment(sold),
        orders: increment(1),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ).catch((err) => console.error('Rollup write will retry when online:', err));

    setCheckoutPart(null);
    toast.success(`Sold ${sold} × ${part.name} — ${formatINR(sold * pricePerUnit)}${belowFloorOverride ? ' (below floor)' : ''}`);
  }

  // Task 8 + Issue 3: non-sale stock change. direction 'reduce' subtracts;
  // 'correction' adds stock back (reversal). Always a new append-only record —
  // historical entries are never edited.
  function handleAdjustStock({ qty, reason, notes, direction = 'reduce' }) {
    const part = adjustTarget;
    if (!part || qty <= 0) return;
    const before = part.stock || 0;
    const isCorrection = direction === 'correction';
    const delta = isCorrection ? qty : Math.min(qty, before); // signed magnitude
    const after = isCorrection ? before + delta : Math.max(0, before - delta);
    const signedQty = isCorrection ? delta : -delta; // for the ledger/audit
    setInventory((prev) => prev.map((p) => (p.id === part.id ? { ...p, stock: after } : p)));
    if (demoMode) {
      const now = new Date();
      const stamp = { seconds: Math.floor(now.getTime() / 1000), nanoseconds: 0, toDate: () => now, toMillis: () => now.getTime() };
      setStockAdjustments((prev) => [{ id: 'demo-adj-' + now.getTime(), partId: part.id, name: part.name, partName: part.name, sku: part.sku, qty: signedQty, quantity: signedQty, reason, notes: notes || '', byEmail: 'demo@balajiautoos.com', createdAt: stamp }, ...prev]);
      setAdjustTarget(null);
      toast.success(isCorrection ? `Correction +${delta} × ${part.name} (demo)` : `Adjusted −${delta} × ${part.name} (demo)`);
      return;
    }
    updateDoc(doc(db, 'parts', part.id), { stock: increment(signedQty), updatedAt: serverTimestamp() })
      .catch((err) => console.error('Adjust sync will retry:', err));
    addDoc(collection(db, 'stockAdjustments'), {
      partId: part.id,
      name: part.name || '',
      qty: signedQty, // negative = reduction, positive = correction
      reason,
      notes: notes || '',
      stockBefore: before,
      stockAfter: after,
      by: user?.uid || null,
      byEmail: user?.email || null,
      createdAt: serverTimestamp(),
    }).catch((err) => console.error('Adjustment ledger write will retry:', err));
    writeAudit('stock_adjustment', { partId: part.id, name: part.name || '' }, { qty: signedQty, reason, stockBefore: before, stockAfter: after, notes: notes || '' });
    setAdjustTarget(null);
    toast.success(isCorrection ? `Correction +${delta} × ${part.name}` : `Adjusted −${delta} × ${part.name} (${reason})`);
  }

  // ---- Category management (rename / delete) — keeps `category` and `categories` fields in sync ----
  async function renameCategory(oldName, newName) {
    const nn = (newName || '').trim();
    if (!nn || nn === oldName) return;
    const affected = inventory.filter((p) => catMatches(p, oldName));
    if (affected.length === 0) { toast('No parts in that category.'); return; }
    if (demoMode) {
      setInventory((prev) => prev.map((p) => (catMatches(p, oldName) ? { ...p, ...remapCatFields(p, oldName, nn) } : p)));
      toast.success(`Renamed to “${nn}” (demo)`);
      return;
    }
    try {
      await renameCategoryDocs(affected, oldName, nn);
      writeAudit('category_rename', { from: oldName, to: nn }, { parts: affected.length });
      toast.success(`Renamed “${oldName}” → “${nn}” across ${affected.length} part${affected.length > 1 ? 's' : ''}`);
    } catch (e) { console.error(e); toast.error('Rename failed — nothing was changed.'); }
  }
  async function deleteCategory(name) {
    const affected = inventory.filter((p) => catMatches(p, name));
    if (demoMode) {
      setInventory((prev) => prev.map((p) => (catMatches(p, name) ? { ...p, ...remapCatFields(p, name, 'Uncategorised') } : p)));
      toast.success(`Deleted “${name}” — ${affected.length} part${affected.length === 1 ? '' : 's'} → Uncategorised (demo)`);
      return;
    }
    try {
      await deleteCategoryDocs(affected, name);
      writeAudit('category_delete', { name }, { parts: affected.length });
      toast.success(`Deleted “${name}” — ${affected.length} part${affected.length === 1 ? '' : 's'} moved to Uncategorised`);
    } catch (e) { console.error(e); toast.error('Delete failed.'); }
  }

  // ---- Purchase Order lifecycle (pending → approved → received → cancelled) ----
  const poN = (x) => Number(x) || 0;
  const demoStamp = () => { const now = new Date(); return { seconds: Math.floor(now.getTime() / 1000), nanoseconds: 0, toMillis: () => now.getTime(), toDate: () => now }; };
  async function createPO(input) {
    const built = buildPO(input, purchaseOrders);
    if (built.error) { toast.error(built.error); return false; }
    const { base, total, clean } = built;
    if (demoMode) {
      setPurchaseOrders((prev) => [{ id: 'demo-po-' + Date.now(), ...base, createdAt: demoStamp() }, ...prev]);
      toast.success(`${base.poNumber} created (demo)`); return true;
    }
    try {
      await poCreateDoc(base, user?.email);
      writeAudit('po_create', { poNumber: base.poNumber, supplier: base.supplierName }, { total, items: clean.length });
      toast.success(`${base.poNumber} created`); return true;
    } catch (e) { console.error(e); toast.error('Could not create the purchase order.'); return false; }
  }
  const poAdvancing = useRef(new Set());
  async function advancePO(po, targetStatus) {
    const auto = po.status === 'draft' ? 'pending' : po.status === 'pending' ? 'approved' : po.status === 'approved' ? 'sent' : (po.status === 'sent' || po.status === 'partial') ? 'received' : null;
    const next = targetStatus || auto;
    if (!next) return;
    // Guard: block re-entry for the same PO so a double-click can never commit the
    // stock increment twice (the key production risk on "mark received").
    if (poAdvancing.current.has(po.id)) return;
    poAdvancing.current.add(po.id);
    const tsField = next === 'approved' ? 'approvedAt' : next === 'sent' ? 'sentAt' : next === 'received' ? 'receivedAt' : `${next}At`;
    try {
      if (demoMode) {
        const stamp = demoStamp();
        setPurchaseOrders((prev) => prev.map((p) => {
          if (p.id !== po.id) return p;
          const upd = { ...p, status: next };
          upd[tsField] = stamp;
          return upd;
        }));
        if (next === 'received') {
          const items = po.items || [];
          setInventory((prev) => prev.map((pt) => {
            const line = items.find((it) => it.partId === pt.id);
            return line ? { ...pt, stock: poN(pt.stock) + poN(line.qty), purchasePrice: poN(line.unitCost) || pt.purchasePrice } : pt;
          }));
          const newRestocks = items.map((it, i) => ({ id: 'demo-rs-po-' + Date.now() + '-' + i, partId: it.partId, partName: it.name, name: it.name, sku: it.sku, qty: poN(it.qty), quantity: poN(it.qty), unitCost: poN(it.unitCost), total: poN(it.qty) * poN(it.unitCost), supplierName: po.supplierName, supplier: po.supplierName, poNumber: po.poNumber, createdAt: stamp }));
          setRestocks((prev) => newRestocks.concat(prev));
        }
        toast.success(`${po.poNumber}: ${next} (demo)`);
        return;
      }
      try {
        await poAdvanceDoc(po, next, user?.email);
        writeAudit('po_status', { poNumber: po.poNumber }, { status: next });
        toast.success(`${po.poNumber}: ${next}`);
      } catch (e) { console.error(e); toast.error('Status update failed.'); }
    } finally {
      poAdvancing.current.delete(po.id);
    }
  }
  async function cancelPO(po) {
    if (po.status === 'received') { toast.error('A received PO can’t be cancelled.'); return; }
    if (demoMode) { setPurchaseOrders((prev) => prev.map((p) => (p.id === po.id ? { ...p, status: 'cancelled', cancelledAt: demoStamp() } : p))); toast.success(`${po.poNumber} cancelled (demo)`); return; }
    try { await poCancelDoc(po.id); writeAudit('po_cancel', { poNumber: po.poNumber }, {}); toast.success(`${po.poNumber} cancelled`); }
    catch (e) { console.error(e); toast.error('Cancel failed.'); }
  }

  // ADD-02: goods received → atomic stock increase + restock ledger + batch cost.
  function handleReceiveStock({ qty, unitCost, supplierName, reference }) {
    const part = restockTarget;
    if (!part || qty <= 0) return;
    if (demoMode) {
      const now = new Date();
      const stamp = { seconds: Math.floor(now.getTime() / 1000), nanoseconds: 0, toDate: () => now, toMillis: () => now.getTime() };
      setInventory((prev) => prev.map((p) => (p.id === part.id ? { ...p, stock: (p.stock || 0) + qty, purchasePrice: unitCost || p.purchasePrice || 0 } : p)));
      setRestocks((prev) => [{ id: 'demo-rs-' + now.getTime(), partId: part.id, name: part.name, partName: part.name, sku: part.sku, qty, quantity: qty, unitCost: unitCost || part.purchasePrice || 0, total: qty * (unitCost || part.purchasePrice || 0), supplier: supplierName || '', supplierName: supplierName || '', byEmail: 'demo@balajiautoos.com', createdAt: stamp }, ...prev]);
      setRestockTarget(null);
      toast.success(`Received ${qty} × ${part.name} (demo)`);
      return;
    }
    updateDoc(doc(db, 'parts', part.id), {
      stock: increment(qty),
      purchasePrice: unitCost || part.purchasePrice || 0, // latest batch cost
      lastRestockedAt: serverTimestamp(), // UPDATE-06: drives aging
      updatedAt: serverTimestamp(),
    }).catch((err) => console.error('Restock sync will retry when online:', err));
    addDoc(collection(db, 'restocks'), {
      partId: part.id,
      name: part.name || '',
      qty,
      unitCost,
      total: qty * unitCost,
      supplier: supplierName || '',
      reference: reference || '',
      by: user?.uid || null,
      byEmail: user?.email || null,
      createdAt: serverTimestamp(),
    }).catch((err) => console.error('Restock ledger write will retry when online:', err));
    setRestockTarget(null);
    toast.success(`Received ${qty} × ${part.name}`);
  }

  // ADD-06: append an audit entry (who did what, with before/after where relevant).
  function writeAudit(action, target = {}, details = {}) {
    addDoc(collection(db, 'auditLog'), {
      action,
      ...target,
      details,
      performedBy: user?.uid || null,
      performedByEmail: user?.email || null,
      createdAt: serverTimestamp(),
    }).catch((e) => console.error('Audit write skipped:', e));
  }

  function handleDelete(id) {
    const part = inventory.find((p) => p.id === id);
    if (demoMode) {
      if (!demoAdmin && !demoPerms.deleteInventory) { protectedDemoToast(true); return; }
      askConfirm({
        title: 'Delete part? (demo)',
        message: `Remove “${part?.name || 'this part'}” from the demo? Use Demo Management to restore the original dataset.`,
        confirmLabel: 'Delete', danger: true,
        onConfirm: () => { setInventory((prev) => prev.filter((p) => p.id !== id)); toast.success('Part deleted (demo)'); },
      });
      return;
    }
    askConfirm({
      title: 'Delete part?',
      message: `Permanently delete “${part?.name || 'this part'}”? This cannot be undone. Past sales and analytics history are kept.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'parts', id));
          writeAudit('delete_part', { partId: id, name: part?.name || '' });
          // If we deleted an ORIGINAL that has a copy, promote the copy: strip
          // its "(copy)" tag AND clear the copiedFrom link (no orphan records).
          if (part && !part.copiedFrom && !isCopyName(part.name)) {
            const copy = inventory.find((p) => p.id !== id && (p.copiedFrom === id || (baseName(p.name) === baseName(part.name) && isCopyName(p.name))));
            if (copy) {
              await updateDoc(doc(db, 'parts', copy.id), { name: stripCopySuffix(copy.name), copiedFrom: null, updatedAt: serverTimestamp() });
              toast.success(`Copy promoted to “${stripCopySuffix(copy.name)}”`);
            }
          }
          toast.success('Part deleted');
        } catch (err) {
          console.error('Delete failed:', err);
          toast.error('Could not delete part.');
        }
      },
    });
  }

  // Task 2: archive (soft-hide, restorable) vs permanent delete.
  function handleDuplicate(part) {
    // One copy per product, tracked by a DB relationship (copiedFrom), not by
    // string matching. Block if this product already has an active copy, or if
    // the part itself is a copy (no copy-of-copy).
    if (part.copiedFrom || isCopyName(part.name)) {
      toast.error('This is already a copy — edit it directly.');
      return;
    }
    const existingCopy = inventory.some((p) => !p.archived && (p.copiedFrom === part.id || (baseName(p.name) === baseName(part.name) && isCopyName(p.name))));
    if (existingCopy) {
      toast.error('A copy already exists. Edit the existing copy instead.');
      return;
    }
    const displayBase = stripCopySuffix(part.name) || 'Part';
    duplicateOriginRef.current = part.id; // carried into handleSave (create branch)
    const { id, createdAt, updatedAt, salesCount, archived, copiedFrom, ...rest } = part;
    setEditPart({ ...rest, name: `${displayBase} (copy)`, sku: '', stock: 0 });
    setShowModal(true);
  }
  function handleArchive(id) {
    const part = inventory.find((p) => p.id === id);
    const actor = demoAdmin ? 'demo-admin@balajiautoos.com' : (user?.email || 'unknown');
    if (demoMode) {
      // Demo users may archive (reversible, in-memory only). Permanent delete and
      // dataset reset remain demo-admin-only.
      const actorName = demoAdmin ? 'demo-admin' : 'demo-user';
      const stamp = { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 };
      setInventory((prev) => prev.map((p) => (p.id === id ? { ...p, archived: true, archivedAt: stamp, archivedBy: actorName } : p))); toast.success('Part archived (demo)'); return;
    }
    updateDoc(doc(db, 'parts', id), { archived: true, archivedAt: serverTimestamp(), archivedBy: actor, updatedAt: serverTimestamp() })
      .then(async () => {
        writeAudit('archive_part', { partId: id, name: part?.name || '' });
        // If the archived part is an ORIGINAL with an active copy, promote the
        // copy to the base name so staff aren't left with an orphan "(copy)".
        if (part && !part.copiedFrom && !isCopyName(part.name)) {
          const copy = inventory.find((p) => p.id !== id && !p.archived && (p.copiedFrom === id || (baseName(p.name) === baseName(part.name) && isCopyName(p.name))));
          if (copy) {
            await updateDoc(doc(db, 'parts', copy.id), { name: stripCopySuffix(copy.name), copiedFrom: null, updatedAt: serverTimestamp() }).catch(() => {});
          }
        }
        toast.success('Part archived');
      })
      .catch((err) => { console.error('Archive failed:', err); toast.error('Could not archive part.'); });
  }
  function handleRestore(id) {
    const part = inventory.find((p) => p.id === id);
    if (demoMode) {
      // Demo USER may restore archived demo items — it only affects the in-memory
      // demo dataset (resets on reload / via Demo Management). Archive and delete
      // stay demo-admin-only.
      setInventory((prev) => prev.map((p) => (p.id === id ? { ...p, archived: false } : p))); toast.success('Part restored (demo)'); return;
    }
    updateDoc(doc(db, 'parts', id), { archived: false, updatedAt: serverTimestamp() })
      .then(() => { writeAudit('restore_part', { partId: id, name: part?.name || '' }); toast.success('Part restored'); })
      .catch((err) => { console.error('Restore failed:', err); toast.error('Could not restore part.'); });
  }

  // ---- Fix 8: Voice search (Web Speech API) ----
  async function startVoiceSearch() {
    const SpeechRecognition =
      typeof window !== 'undefined' &&
      (window.SpeechRecognition || window.webkitSpeechRecognition);

    if (!SpeechRecognition) {
      toast.error('Voice search needs Google Chrome or Microsoft Edge.');
      return;
    }

    // ROOT CAUSE #1: the Web Speech API only works in a *secure context*.
    // localhost is fine, but opening the dev server over a LAN IP like
    // http://192.168.x.x:3000 (common when testing on a phone) is NOT secure,
    // so recognition silently never captures. Tell the user exactly that.
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      toast.error('Voice search needs HTTPS. Open the site over https:// (or localhost), not an http LAN address.');
      return;
    }

    // Second tap stops immediately and reliably. We DETACH the handlers first so
    // no late onresult/onend can revive state, then stop() AND abort() to kill the
    // session instantly. The live transcript already sits in `search`, so the
    // query is preserved.
    if (recognitionRef.current) {
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      setListening(false);
      setLiveTranscript('');
      try {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.stop();
        rec.abort?.();
      } catch (_) {}
      return;
    }

    // ROOT CAUSE #2: permission / no warmed-up mic. Explicitly acquire the mic
    // first via getUserMedia — this triggers the permission prompt reliably and
    // confirms a working input device before we ever call recognition.start().
    // (Guard mediaDevices itself: it's undefined on some older/insecure setups.)
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop()); // release; recognition opens its own
      } catch (err) {
        console.error('Mic permission error:', err);
        if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
          toast.error('Microphone access denied. Please check browser permissions.');
        } else if (err?.name === 'NotFoundError') {
          toast.error('No microphone detected. Please connect/enable a mic.');
        } else {
          toast.error('Could not access the microphone.');
        }
        return;
      }
    }

    let recognition;
    try {
      recognition = new SpeechRecognition();
      recognition.lang = voiceLang; // CHANGE-04: EN (en-IN) or Telugu (te-IN)
      recognition.continuous = true;      // keep listening — won't auto-stop on pauses
      recognition.interimResults = true;  // stream partial words for live feedback
      recognition.maxAlternatives = 1;
    } catch (err) {
      console.error('Voice init failed:', err);
      toast.error('Could not initialise voice search on this device.');
      return;
    }

    // Accumulated transcript lives on the recognition instance so the Stop
    // handler (and onend) can read the final text.
    recognition._finalText = '';

    recognition.onstart = () => {
      setListening(true);
      setLiveTranscript('');
    };

    recognition.onresult = (e) => {
      // FIX 1: don't grab only the first frame — join EVERY result frame so we
      // never truncate "brake pads" down to "pads".
      const fullTranscript = Array.from(e.results)
        .map((r) => r[0]?.transcript || '')
        .join('')
        .trim();
      recognition._finalText = fullTranscript;
      setLiveTranscript(fullTranscript); // Fix 1: live feedback box
      if (fullTranscript) setSearch(fullTranscript); // filter the table live
    };

    recognition.onerror = (e) => {
      setListening(false);
      recognitionRef.current = null;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        toast.error('Microphone access denied. Please check browser permissions.');
      } else if (e.error === 'audio-capture') {
        toast.error('No microphone detected. Please enable a mic and try again.');
      } else if (e.error === 'network') {
        toast.error('Voice service needs internet. Check your connection.');
      } else if (e.error !== 'aborted' && e.error !== 'no-speech') {
        toast.error('Voice search failed. Please try again.');
      }
    };

    recognition.onend = () => {
      setListening(false);
      const finalText = (recognition._finalText || '').trim();
      recognitionRef.current = null;
      // Apply the captured transcript to the search query.
      if (finalText) {
        setSearch(finalText);
        toast.success(`Search: “${finalText}”`);
      }
      setLiveTranscript('');
    };

    try {
      recognitionRef.current = recognition; // retain reference (avoid GC)
      recognition.start();
    } catch (err) {
      console.error('Voice start failed:', err);
      setListening(false);
      recognitionRef.current = null;
      toast.error('Could not start voice search. Please try again.');
    }
  }

  // ---- Requirement 1: bulletproof case-insensitive, null-safe search ----
  const categoryOptionsForFilter = useMemo(
    () => ['All', ...new Set(inventory.map((p) => p.category).filter(Boolean))],
    [inventory]
  );

  // Copy-workflow: which originals already have a copy (active OR archived-draft).
  // A copy existing anywhere blocks making another, and keeps the button disabled.
  const basesWithCopy = useMemo(() => {
    const s = new Set();
    inventory.forEach((p) => { if (isCopyName(p.name)) s.add(baseName(p.name)); });
    return s;
  }, [inventory]);
  const copyOriginIds = useMemo(() => {
    const s = new Set();
    inventory.forEach((p) => { if (p.copiedFrom) s.add(p.copiedFrom); });
    return s;
  }, [inventory]);
  const partIsCopy = (p) => !!p.copiedFrom || isCopyName(p.name);
  const partHasCopy = (p) => copyOriginIds.has(p.id) || basesWithCopy.has(baseName(p.name));

  // IMPORTANT: type-ahead suggestions grouped into Parts / Categories / Vehicles.


  // ---- Task 1: merged option trees (predefined + user-added) ----
  const mergedCategoryTree = useMemo(() => {
    const existing = new Set();
    CATEGORY_TREE.forEach((n) => n.children.forEach((c) => existing.add(safeLower(c))));
    const extras = [];
    customCategories.forEach((c) => {
      const nm = (c.name || '').trim();
      if (nm && !existing.has(safeLower(nm))) { existing.add(safeLower(nm)); extras.push(nm); }
    });
    extras.sort((a, b) => a.localeCompare(b));
    return extras.length ? [...CATEGORY_TREE, { label: 'Others', children: extras }] : CATEGORY_TREE;
  }, [customCategories]);

  const mergedVehicleTree = useMemo(() => {
    const tree = VEHICLE_TREE.map((n) => ({ label: n.label, children: [...n.children] }));
    const brandIdx = new Map(tree.map((n, i) => [safeLower(n.label), i]));
    customVehicles.forEach((v) => {
      const brand = (v.brand || '').trim();
      const model = (v.model || '').trim();
      if (!brand || !model) return;
      const key = safeLower(brand);
      if (brandIdx.has(key)) {
        const node = tree[brandIdx.get(key)];
        if (!node.children.some((c) => safeLower(c) === safeLower(model))) node.children.push(model);
      } else {
        tree.push({ label: brand, children: [model] });
        brandIdx.set(key, tree.length - 1);
      }
    });
    return tree;
  }, [customVehicles]);

  const addCategoryOption = useCallback((name) => {
    const nm = (name || '').trim();
    if (!nm) return;
    const lower = safeLower(nm);
    const sing = singularize(nm);
    const inTree = CATEGORY_TREE.some((n) => n.children.some((c) => safeLower(c) === lower || singularize(c) === sing));
    const inCustom = customCategories.some((c) => safeLower(c.name) === lower || singularize(c.name) === sing);
    if (inTree || inCustom) return; // already exists (incl. singular/plural) — TreeSelect selects it
    if (demoMode) { setCustomCategories((prev) => [...prev, { id: 'demo-cat-' + Date.now(), name: nm }]); return; }
    addDoc(collection(db, 'categories'), { name: nm, nameLower: lower, createdAt: serverTimestamp() })
      .catch((e) => console.error('Add category failed:', e));
  }, [customCategories, demoMode]);

  const addVehicleOption = useCallback((brand, model) => {
    const b = (brand || '').trim();
    const m = (model || '').trim();
    if (!b || !m) return;
    const dup =
      customVehicles.some((v) => safeLower(v.brand) === safeLower(b) && safeLower(v.model) === safeLower(m)) ||
      VEHICLE_TREE.some((n) => safeLower(n.label) === safeLower(b) && n.children.some((c) => safeLower(c) === safeLower(m)));
    if (dup) return;
    if (demoMode) { setCustomVehicles((prev) => [...prev, { id: 'demo-veh-' + Date.now(), brand: b, model: m }]); return; }
    addDoc(collection(db, 'vehicles'), { brand: b, model: m, brandLower: safeLower(b), modelLower: safeLower(m), createdAt: serverTimestamp() })
      .catch((e) => console.error('Add vehicle failed:', e));
  }, [customVehicles, demoMode]);

  // Feature 4: vocabulary of car-model words seen across vehicle/compatibleCars,
  // so we can tell when the mechanic is searching by car (e.g. "Swift 2018").
  const carVocab = useMemo(() => {
    const set = new Set();
    inventory.forEach((p) => {
      tokenize(p.vehicle).forEach((t) => set.add(t));
      flattenVehicles(p.compatibleCars).forEach((m) => tokenize(m).forEach((t) => set.add(t)));
    });
    DEFAULT_VEHICLES.forEach((v) => tokenize(v).forEach((t) => set.add(t)));
    ['universal', 'all', 'vehicles', 'vehicle'].forEach((w) => set.delete(w));
    return set;
  }, [inventory]);

  // Parts that have at least one recorded sale — powers Fast Movers / Dead Stock filters.
  const soldPartIds = useMemo(() => {
    const s = new Set();
    sales.forEach((sale) => { if (sale.partId) s.add(sale.partId); });
    return s;
  }, [sales]);

  const filtered = useMemo(() => {
    // FIX 1: tokenize the query; match each token (or slang synonym) against
    // name/sku/category/vehicle/compatibleCars/location.
    const tokens = tokenize(debouncedSearch);
    // Feature 4: if any token is a known car word, also surface Universal parts.
    const isCarQuery = tokens.some((t) => carVocab.has(t));
    const result = inventory.filter((part) => {
      const matchesSearch =
        partMatchesTokens(part, tokens) || (isCarQuery && partIsUniversal(part));
      const matchesCategory = categoryFilter === 'All' || part.category === categoryFilter;
      // 1.3 strict state filter — each state shows ONLY its dataset.
      const stk = part.stock || 0;
      const minS = part.minStock || 5;
      const isArch = part.archived === true;
      let matchesState;
      switch (invFilter) {
        case 'low': matchesState = !isArch && stk > 0 && stk <= minS; break;
        case 'out': matchesState = !isArch && stk === 0; break;
        case 'dead': matchesState = !isArch && stk > 0 && !soldPartIds.has(part.id); break;
        case 'fast': matchesState = !isArch && soldPartIds.has(part.id); break;
        case 'instock': matchesState = !isArch; break;
        case 'archived': matchesState = isArch; break;
        case 'all': matchesState = true; break;
        case 'active':
        default: matchesState = !isArch && stk > minS; break;
      }
      return matchesSearch && matchesCategory && matchesState;
    });

    // Optional column sort
    if (sortConfig.key) {
      const dir = sortConfig.dir === 'asc' ? 1 : -1;
      const numeric = ['stock', 'sellingPrice'];
      result.sort((a, b) => {
        const av = a[sortConfig.key];
        const bv = b[sortConfig.key];
        if (numeric.includes(sortConfig.key)) return ((av || 0) - (bv || 0)) * dir;
        return safeLower(av).localeCompare(safeLower(bv)) * dir;
      });
    }
    return result;
  }, [inventory, debouncedSearch, categoryFilter, invFilter, sortConfig, carVocab, soldPartIds]);

  // ---- Inventory pagination (scales to thousands of parts; only the current
  // page is rendered). Rows-per-page selectable; resets to page 1 on filter. ----
  const [invPerPage, setInvPerPage] = useState(25);
  const [invPage, setInvPage] = useState(1);
  useEffect(() => { setInvPage(1); clearSelection(); }, [debouncedSearch, categoryFilter, invFilter, invPerPage, clearSelection]);

  // #3: after a supplier→inventory jump, scroll the highlighted row into view and
  // fade the highlight after a moment. Runs once the filtered rows have rendered.
  useEffect(() => {
    if (!highlightPartId) return;
    const t = setTimeout(() => {
      if (typeof document === 'undefined') return;
      // Desktop table row and mobile card carry different ids; only one is
      // visible at a given breakpoint. Scroll whichever is actually rendered.
      const el = document.getElementById(`inv-row-${highlightPartId}`) || document.getElementById(`inv-rowm-${highlightPartId}`);
      const visible = [document.getElementById(`inv-row-${highlightPartId}`), document.getElementById(`inv-rowm-${highlightPartId}`)]
        .find((n) => n && n.offsetParent !== null) || el;
      if (visible) visible.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    const clear = setTimeout(() => setHighlightPartId(null), 2600);
    return () => { clearTimeout(t); clearTimeout(clear); };
  }, [highlightPartId, debouncedSearch]);
  const invTotalPages = Math.max(1, Math.ceil(filtered.length / invPerPage));
  useEffect(() => { if (invPage > invTotalPages) setInvPage(invTotalPages); }, [invPage, invTotalPages]);
  const pagedInventory = useMemo(
    () => filtered.slice((invPage - 1) * invPerPage, invPage * invPerPage),
    [filtered, invPage, invPerPage]
  );

  const stats = useMemo(
    () => {
      // Issue 3: the summary cards reflect the CURRENTLY FILTERED dataset (the
      // active state filter + search + category), so switching Active / Low /
      // Out / Archived / All immediately updates every metric to match what's
      // visible — instead of always showing whole-collection totals.
      const set = filtered;
      return {
        total: set.length,
        lowStock: set.filter((p) => p.stock > 0 && p.stock <= (p.minStock || 5)).length,
        outOfStock: set.filter((p) => p.stock === 0).length,
        totalValue: set.reduce((s, p) => s + (p.stock || 0) * (p.sellingPrice || 0), 0),
        potentialProfit: set.reduce(
          (s, p) => s + (p.stock || 0) * ((p.sellingPrice || 0) - (p.purchasePrice || 0)),
          0
        ),
      };
    },
    [filtered]
  );

  // On phones, every long form takes over the whole screen as a normal in-flow
  // page (native document scrolling) instead of a modal — this component stays
  // mounted so all dashboard state is preserved. Desktop/tablet fall through to
  // the modals below. Only one of these can be open at a time.
  if (isMobile) {
    if (showModal) {
      return (
        <PartModal
          asPage
          demoMode={demoMode}
          part={editPart}
          inventory={inventory}
          suppliers={suppliers}
          saving={saving}
          isAdmin={canSeeCost}
          categoryTree={mergedCategoryTree}
          vehicleTree={mergedVehicleTree}
          salesHistory={sales}
          onAddCategory={addCategoryOption}
          onAddVehicle={addVehicleOption}
          onSave={handleSave}
          onSaveSupplier={persistSupplierEdit}
          onClose={() => { setShowModal(false); setEditPart(null); duplicateOriginRef.current = null; }}
        />
      );
    }
    if (showSupplierModal) {
      return (
        <SupplierModal
          asPage
          demoMode={demoMode}
          supplier={editSupplier}
          saving={supplierSaving}
          onSave={handleSupplierSave}
          onClose={() => { setShowSupplierModal(false); setEditSupplier(null); }}
        />
      );
    }
    if (checkoutPart) {
      return (
        <CheckoutModal asPage part={checkoutPart} onConfirm={handleSell} isAdmin={isAdmin || demoAdmin} onClose={() => setCheckoutPart(null)} />
      );
    }
    if (restockTarget) {
      return (
        <RestockModal asPage part={restockTarget} onConfirm={handleReceiveStock} onClose={() => setRestockTarget(null)} />
      );
    }
    if (adjustTarget) {
      return (
        <StockAdjustModal asPage part={adjustTarget} onConfirm={handleAdjustStock} onClose={() => setAdjustTarget(null)} />
      );
    }
  }

  return (
    <div className={`relative min-h-screen pb-20 md:pb-0 app-shell-bg transition-all ${sidebarCollapsed ? 'md:pl-[72px]' : 'md:pl-[280px]'} ${arriving ? 'app-arriving' : ''}`}>
      {!bootHidden && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, opacity: bootFading ? 0 : 1, transition: 'opacity 0.4s ease', pointerEvents: bootFading ? 'none' : 'auto' }}>
          <BootSplash />
        </div>
      )}
      {arriving && <div aria-hidden className="arrival-bloom fixed inset-0 z-[300] pointer-events-none" />}
      {demoMode && (
        <div className="sticky top-0 z-[90] flex items-center justify-center gap-3 px-4 py-2 text-center" style={{ background: 'linear-gradient(90deg,#d4af37,#aa801e)', color: '#1a1a1a' }}>
          <span className="text-xs sm:text-sm font-bold">{demoAdmin
            ? 'Demo Admin Mode — Managing isolated demo inventory. Production data remains fully protected.'
            : 'Demo Mode — Safe sandbox. Changes affect demo data only and automatically reset after reload.'}</span>
        </div>
      )}
      <ScrollToTop />
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
        mobileOpen={sidebarMobileOpen}
        setMobileOpen={setSidebarMobileOpen}
        isAdmin={isAdmin || demoMode}
        alertCount={unreadAlertCount}
        reminderCount={(() => { let n = 0; const d = (x) => x ? Math.round((new Date(x).getTime() - Date.now()) / 86400000) : null; customers.forEach((c) => { if (Number(c.outstanding) > 0) n += 1; (c.vehicles || []).forEach((v) => { [v.insuranceExpiry, v.rcExpiry, v.pucExpiry].forEach((x) => { const k = d(x); if (k !== null && k <= 30) n += 1; }); }); }); return n; })()}
        jobCount={jobCards.filter((j) => !['Delivered', 'Closed', 'Cancelled'].includes(j.status)).length}
        inventoryCount={inventory.filter((p) => !p.archived && (p.stock || 0) <= (p.minStock || 5)).length}
        status={{
          color: connError ? '#ef4444' : online ? '#34d399' : '#ef4444',
          label: connError ? 'Connection Error' : online ? 'Connected' : 'Offline',
          lastSync: lastSync ? lastSync.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—',
          lastBackup: lastBackup ? new Date(lastBackup).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'Never',
          records: (inventory.length + suppliers.length + sales.length + restocks.length + auditLog.length).toLocaleString('en-IN'),
        }}
      />
      <ConfirmHost />
      {/* Fix 1: subtle grid overlay adds depth over the gradient */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(var(--fg-rgb),0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(var(--fg-rgb),0.7) 1px, transparent 1px)',
          backgroundSize: '38px 38px',
        }}
      />

      {/* Fix 2: top account bar — avatar, signed-in email/ID, gold Logout */}
      <div
        className="relative z-40 px-4 sm:px-6 py-2.5 backdrop-blur-md"
        style={{ background: 'rgba(10,10,10,0.55)', borderBottom: '1px solid rgba(212,175,55,0.12)' }}
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button onClick={() => setSidebarMobileOpen(true)} className="md:hidden flex items-center justify-center w-8 h-8 rounded-lg text-white/70 hover:bg-white/10 flex-shrink-0" title="Menu">
              <Menu size={18} />
            </button>
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-black flex-shrink-0 bg-gradient-to-br from-[#e8c84a] to-[#aa801e]"
              style={{ boxShadow: '0 0 0 1px rgba(212,175,55,0.45)' }}
            >
              {user?.email ? user.email[0].toUpperCase() : <User size={14} />}
            </div>
            <div className="min-w-0">
              <p className="text-[9px] uppercase tracking-wider text-white/35 leading-none mb-0.5">
                Signed in as
              </p>
              <p className="text-xs font-medium text-white/80 truncate max-w-[170px] sm:max-w-md">
                {user?.email || user?.uid || 'admin@balajiauto.in'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowLogoutConfirm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition active:scale-95 text-[#d4af37] bg-[#d4af37]/10 border border-[#d4af37]/30 hover:bg-[#d4af37]/20"
          >
            <LogOut size={13} /> Logout
          </button>
        </div>
      </div>

      {/* Header */}
      <header
        className="sticky top-0 z-30 px-4 sm:px-6 py-4 backdrop-blur-md"
        style={{ background: 'rgba(10,10,10,0.85)', borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg sm:text-xl font-bold bg-gradient-to-r from-[#d4af37] to-[#aa801e] bg-clip-text text-transparent">
              {getShopName()}
            </h1>
            <div className="flex items-center gap-2">
              <p className="text-xs text-white/40">
                {activeTab === 'overview' ? 'Auto Parts & Service' : activeTab === 'inventory' ? 'Inventory Dashboard' : activeTab === 'suppliers' ? 'Supplier Directory' : 'Executive Analytics'}
              </p>
              {/* Issue 6: Connection Error · Offline · Syncing · Connected + last sync */}
              {(() => {
                const state = connError ? 'error' : !online ? 'offline' : pendingWrites ? 'syncing' : 'connected';
                const color = state === 'error' || state === 'offline' ? '#ef4444' : state === 'syncing' ? '#f59e0b' : '#34d399';
                const label = state === 'error' ? 'Connection Error' : state === 'offline' ? 'Offline' : state === 'syncing' ? 'Syncing…' : 'Connected';
                return (
                  <span className="flex items-center gap-1.5 text-[10px] font-medium" title={connError || (state === 'offline' ? 'Offline — changes are saved on this device and will sync when you reconnect.' : state === 'syncing' ? 'Saving your latest changes…' : lastSync ? `Cloud sync active · last synced ${lastSync.toLocaleTimeString('en-IN')}` : 'Cloud sync active.')}>
                    <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                    <span style={{ color }}>{label}</span>
                    {state === 'connected' && lastSync && (
                      <span className="text-white/30 hidden sm:inline">· last synced {lastSync.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                    )}
                    {(state === 'error' || state === 'offline') && (
                      <button onClick={retrySync} className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-white/10 hover:bg-white/20 text-white/80">Retry</button>
                    )}
                  </span>
                );
              })()}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(activeTab === 'inventory' || activeTab === 'overview') ? (
              <>
                {isAdmin && (
                  <input
                    ref={backupInputRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) { pendingRestoreFile.current = f; setRestoreText(''); setRestoreConfirm(true); } e.target.value = ''; }}
                  />
                )}
                {(isAdmin || canExport) && (
                  <div className="relative" ref={actionsRef}>
                    <button
                      onClick={() => setActionsOpen((v) => !v)}
                      className="flex items-center gap-2 px-3 sm:px-4 py-2.5 rounded-xl text-sm font-semibold transition active:scale-95 text-white/80 bg-white/5 border border-white/15 hover:bg-white/10"
                      title="Import, export, backup & more"
                    >
                      <Settings size={16} /> <span className="hidden sm:inline">Actions</span> <ChevronDown size={14} className={`transition-transform ${actionsOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {actionsOpen && (
                      <>
                        <div className="fixed inset-0 z-[55]" onClick={() => setActionsOpen(false)} />
                        <div className="absolute right-0 mt-1.5 w-60 z-[56] rounded-xl overflow-hidden shadow-2xl py-1.5" style={{ background: 'var(--surface-2)', border: '1px solid rgba(212,175,55,0.3)' }}>
                          {[
                            { section: 'Inventory', items: [
                              { label: 'Import Inventory', icon: PackagePlus, onClick: () => setShowImport(true), show: isAdmin },
                              { label: 'Export to Excel', icon: Download, onClick: exportInventoryExcel, show: isAdmin || canExport },
                            ]},
                            { section: 'Data Management', items: [
                              { label: 'Backup Data', icon: ShieldCheck, onClick: exportFullBackup, show: isAdmin },
                              { label: 'Restore Backup', icon: Upload, onClick: () => backupInputRef.current?.click(), danger: true, show: isAdmin },
                            ]},
                            { section: 'Reports', items: [
                              { label: 'Export Audit Logs', icon: FileText, onClick: exportAuditLogs, show: isAdmin || canExport },
                            ]},
                          ].map((grp) => ({ ...grp, items: grp.items.filter((i) => i.show) })).filter((grp) => grp.items.length > 0).map((grp) => (
                            <div key={grp.section}>
                              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-white/30">{grp.section}</div>
                              {grp.items.map((it) => (
                                <button
                                  key={it.label}
                                  onClick={() => { setActionsOpen(false); it.onClick(); }}
                                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-white/[0.06] ${it.danger ? 'text-red-300' : 'text-white/85'}`}
                                >
                                  <it.icon size={15} className={it.danger ? 'text-red-400' : 'text-[#d4af37]'} /> {it.label}
                                </button>
                              ))}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
                {activeTab === 'inventory' && invSubView === 'parts' && (
                  <button
                    onClick={() => {
                      setEditPart(null);
                      setShowModal(true);
                    }}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] hover:brightness-110 active:scale-95 transition shadow-lg shadow-[#d4af37]/10"
                  >
                    <Plus size={16} /> <span className="hidden sm:inline">Add Part</span>
                  </button>
                )}
              </>
            ) : activeTab === 'suppliers' ? (
              <button
                onClick={() => {
                  setEditSupplier(null);
                  setShowSupplierModal(true);
                }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] hover:brightness-110 active:scale-95 transition shadow-lg shadow-[#d4af37]/10"
              >
                <Plus size={16} /> <span className="hidden sm:inline">Add Supplier</span>
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Tabs — hidden; the left sidebar is now the primary navigation. */}
        <div className="hidden items-center gap-2 mb-6">
          {[
            { id: 'overview', label: 'Overview', icon: LayoutDashboard, count: null },
            { id: 'inventory', label: 'Inventory', icon: Package, count: inventory.length },
            { id: 'suppliers', label: 'Suppliers', icon: Users, count: suppliers.filter((s) => !s.archived).length },
            ...(isAdmin ? [{ id: 'analytics', label: 'Analytics', icon: BarChart3, count: null }] : []),
          ].map(({ id, label, icon: Icon, count }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition active:scale-95 ${
                  active
                    ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] shadow-lg shadow-[#d4af37]/10'
                    : 'text-white/60 bg-white/5 border border-white/10 hover:bg-white/10'
                }`}
              >
                <Icon size={16} />
                {label}
                {count != null && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                      active ? 'bg-black/20 text-black' : 'bg-white/10 text-white/50'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {activeTab === 'overview' && (
          <OverviewView
            inventory={inventory}
            sales={sales}
            suppliers={suppliers}
            auditLog={auditLog}
            restocks={restocks}
            stockAdjustments={stockAdjustments}
            reorderRequests={reorderRequests}
            purchaseOrders={purchaseOrders}
            lastSync={lastSync}
            lastBackup={lastBackup}
            online={online}
            connError={connError}
            isAdmin={isAdmin}
            onNavigate={(tab, opts) => { setActiveTab(tab); if (opts?.lowStock) setInvFilter('low'); }}
            onAddPart={() => { setEditPart(null); setShowModal(true); }}
            onAddSupplier={() => { setEditSupplier(null); setShowSupplierModal(true); }}
            onImport={() => { if (demoMode) { toast('Bulk import isn\'t part of the demo — use "Add Part" to try adding items.', { icon: '🧪' }); return; } setShowImport(true); }}
            onReorder={(p) => openReorderDialog(p)}
            onAdvanceStatus={(r) => advanceReorderStatus(r)}
            onClearRequest={(r) => clearReorderRequest(r)}
            canDestroy={canDelete}
            onEditPart={(p) => { setEditPart(p); setShowModal(true); }}
            onQuickSell={() => setQuickPick('sell')}
            onQuickReceive={() => setQuickPick('receive')}
          />
        )}

        {activeTab === 'inventory' && (
        <>
        {/* Phase 1: Inventory module sub-navigation */}
        <div className="flex items-center gap-1 mb-5 p-1 rounded-xl w-max max-w-full overflow-x-auto" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
          {[{ k: 'dashboard', label: 'Dashboard' }, { k: 'parts', label: 'Parts' }, { k: 'categories', label: 'Categories' }, { k: 'stock', label: 'Stock' }, { k: 'po', label: 'Purchase Orders' }, { k: 'archive', label: 'Archive' }, { k: 'io', label: 'Import / Export' }, { k: 'reports', label: 'Reports' }].map((t) => (
            <button key={t.k} onClick={() => setInvSubView(t.k)} className={`px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition ${invSubView === t.k ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]' : 'text-white/60 hover:text-white/90 hover:bg-white/5'}`}>{t.label}</button>
          ))}
        </div>
        {invSubView === 'stock' && (
          <InventoryStock
            inventory={inventory}
            sales={sales}
            restocks={restocks}
            stockAdjustments={stockAdjustments}
            formatINR={formatINR}
            onReceive={(p) => (p && p.id ? setRestockTarget(p) : setQuickPick('receive'))}
            onAdjust={() => setQuickPick('adjust')}
            onReorder={(p) => openReorderDialog(p)}
          />
        )}
        {invSubView === 'po' && (
          <InventoryPurchaseOrders
            purchaseOrders={purchaseOrders}
            suppliers={suppliers}
            inventory={inventory}
            formatINR={formatINR}
            canManage={canManageData}
            onCreate={createPO}
            onAdvance={advancePO}
            onCancel={cancelPO}
          />
        )}
        {invSubView === 'io' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-2xl p-5 backdrop-blur-sm" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                <div className="flex items-center gap-2 mb-1"><PackagePlus size={16} className="text-[#d4af37]" /><h3 className="text-sm font-bold text-white/90">Import parts</h3></div>
                <p className="text-xs text-white/50 mb-3">Bulk-add parts from an Excel/CSV file. Existing SKUs are skipped.</p>
                <button
                  onClick={() => { if (demoMode) { toast('Bulk import isn\u2019t part of the demo \u2014 use \u201cAdd Part\u201d to try adding items.', { icon: '\uD83E\uDDEA' }); return; } setShowImport(true); }}
                  className="h-10 px-4 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] active:scale-95 transition flex items-center gap-2"
                ><Upload size={15} /> Import file</button>
              </div>
              <div className="rounded-2xl p-5 backdrop-blur-sm" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                <div className="flex items-center gap-2 mb-1"><Download size={16} className="text-emerald-400" /><h3 className="text-sm font-bold text-white/90">Export inventory</h3></div>
                <p className="text-xs text-white/50 mb-3">Download all {inventory.filter((p) => !p.archived).length} active parts as an Excel sheet.</p>
                <button onClick={() => exportInventoryExcel()} className="h-10 px-4 rounded-xl text-sm font-semibold bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 active:scale-95 transition flex items-center gap-2"><Download size={15} /> Export to Excel</button>
              </div>
            </div>
            <div className="rounded-2xl overflow-hidden backdrop-blur-sm" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
              <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}><History size={15} className="text-[#d4af37]" /><h3 className="text-sm font-bold text-white/90">Import / Export history</h3></div>
              {ioHistory.length ? (
                <div className="divide-y divide-white/[0.04]">
                  {ioHistory.map((h, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                      <span className={`w-2 h-2 rounded-full ${h.type === 'import' ? 'bg-[#d4af37]' : 'bg-emerald-400'}`} />
                      <span className="flex-1 text-sm text-white/80 capitalize">{h.type} · {h.count} part{h.count === 1 ? '' : 's'}</span>
                      <span className="text-[11px] text-white/35">{new Date(h.ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-white/35 py-8 text-center">No imports or exports yet.</p>}
            </div>
          </div>
        )}
        {invSubView === 'reports' && (
          <InventoryReports inventory={inventory} sales={sales} formatINR={formatINR} />
        )}
        {invSubView === 'categories' && (
          <InventoryCategories
            inventory={inventory}
            sales={sales}
            formatINR={formatINR}
            canManage={canManageData}
            onRename={(oldN, newN) => renameCategory(oldN, newN)}
            onDelete={(name) => deleteCategory(name)}
            onOpenCategory={(cat) => { setInvSubView('parts'); setCategoryFilter(cat); setInvFilter('active'); setSearch(''); }}
          />
        )}
        {invSubView === 'archive' && (
          <InventoryArchive
            inventory={inventory}
            formatINR={formatINR}
            canRestore={canDelete || demoMode}
            canDelete={canDelete}
            onRestore={(id) => handleRestore(id)}
            onDelete={(p) => handleDelete(p.id)}
            onEditPart={(p) => { setEditPart(p); setShowModal(true); }}
          />
        )}
        {invSubView === 'dashboard' && (
          <InventoryOverview
            inventory={inventory}
            sales={sales}
            restocks={restocks}
            stockAdjustments={stockAdjustments}
            reorderRequests={reorderRequests}
            suppliers={suppliers}
            formatINR={formatINR}
            onNavigate={(tab, opts) => { if (opts?.subView) setInvSubView(opts.subView); if (opts?.invFilter) setInvFilter(opts.invFilter); setCategoryFilter('All'); setSearch(''); }}
            onAddPart={() => { setEditPart(null); setShowModal(true); }}
            onQuickReceive={(p) => (p && p.id ? setRestockTarget(p) : setQuickPick('receive'))}
            onQuickSell={() => setQuickPick('sell')}
            onAddSupplier={() => { setEditSupplier(null); setShowSupplierModal(true); }}
            onEditPart={(p) => { setEditPart(p); setShowModal(true); }}
          />
        )}
        {invSubView === 'parts' && (
        <>
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
          {[
            { label: 'Total Parts', value: stats.total, icon: PackageSearch, color: '#d4af37', onClick: () => { setInvFilter('active'); setCategoryFilter('All'); setSearch(''); } },
            { label: 'Low Stock', value: stats.lowStock, icon: AlertTriangle, color: '#f59e0b', onClick: () => { setInvFilter('low'); } },
            { label: 'Out of Stock', value: stats.outOfStock, icon: PackageX, color: '#ef4444', onClick: () => { setInvFilter('out'); } },
            { label: 'Stock Value', value: formatINR(stats.totalValue), icon: PackageSearch, color: '#4ade80' },
            { label: 'Potential Profit', value: formatINR(stats.potentialProfit), icon: TrendingUp, color: '#60a5fa' },
          ].map(({ label, value, icon: Icon, color, onClick }) => {
            const active = (label === 'Low Stock' && lowStockOnly) || (label === 'Out of Stock' && outOfStockOnly);
            const Tag = onClick ? 'button' : 'div';
            return (
              <Tag
                key={label}
                onClick={onClick}
                className={`text-left rounded-2xl p-4 backdrop-blur-sm transition ${onClick ? 'hover:bg-white/[0.06] active:scale-[0.98] cursor-pointer' : ''}`}
                style={{ background: 'rgba(var(--fg-rgb),0.03)', border: `1px solid ${active ? color + '80' : 'rgba(var(--fg-rgb),0.06)'}` }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] uppercase tracking-wider text-white/40">{label}</span>
                  <Icon size={14} style={{ color }} />
                </div>
                <div className="text-lg font-bold" style={{ color }}>
                  {value}
                </div>
              </Tag>
            );
          })}
        </div>

        {/* Search + filters — glassmorphism bar */}
        <div
          className="rounded-2xl p-3 mb-5 backdrop-blur-md"
          style={{ background: 'rgba(var(--fg-rgb),0.04)', border: '1px solid rgba(var(--fg-rgb),0.08)' }}
        >
          <div className="flex gap-2 mb-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, SKU, category, vehicle…"
                className="w-full pl-9 pr-9 py-2.5 rounded-xl text-sm outline-none bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-[#d4af37]/50 transition"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            {!listening && (
              <button
                onClick={() => setVoiceLang((l) => (l === 'en-IN' ? 'te-IN' : 'en-IN'))}
                className="flex items-center justify-center h-10 px-2.5 rounded-xl text-xs font-bold border bg-white/5 border-white/10 text-white/60 hover:bg-white/10 transition"
                title="Voice language (English / Telugu)"
              >
                {voiceLang === 'te-IN' ? 'తె' : 'EN'}
              </button>
            )}
            <button
              onClick={startVoiceSearch}
              className={`flex items-center justify-center gap-1.5 rounded-xl transition active:scale-90 border font-bold text-xs ${
                listening
                  ? 'px-3 h-10 bg-red-500/25 border-red-500/60 text-red-300 animate-pulse ring-2 ring-red-500/50'
                  : 'w-10 h-10 bg-[#d4af37]/10 border-[#d4af37]/30 text-[#d4af37] hover:bg-[#d4af37]/20'
              }`}
              title={listening ? 'Stop & search' : `Voice search (${voiceLang === 'te-IN' ? 'Telugu' : 'English'})`}
            >
              <Mic size={16} />
              {listening && <span className="whitespace-nowrap">Stop &amp; Search</span>}
            </button>
          </div>

          {/* Fix 1: live voice-feedback box — shows exactly what the mic hears */}
          {listening && (
            <div className="mb-3 rounded-xl px-4 py-3 flex items-start gap-3 bg-red-500/10 border border-red-500/30">
              <span className="relative flex h-2.5 w-2.5 mt-1 flex-shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-red-300/70 font-semibold">Listening… speak now, then tap “Stop &amp; Search”</p>
                <p className="text-sm text-white mt-0.5 break-words">
                  {liveTranscript || <span className="text-white/30 italic">Waiting for your voice…</span>}
                </p>
              </div>
            </div>
          )}

          {/* Desktop: horizontal chip strip */}
          <div className="hidden sm:flex gap-2 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'none' }}>
            <div className="flex items-center rounded-full border border-white/10 bg-white/5 p-0.5 flex-shrink-0" role="group" aria-label="Inventory state filter">
              {[
                ['active', 'Active', null],
                ['low', 'Low Stock', AlertTriangle],
                ['out', 'Out of Stock', PackageX],
                ['archived', 'Archived', Archive],
                ['all', 'All', null],
              ].map(([v, label, Icon]) => {
                // archived filter is viewable by everyone (incl. demo user); row actions stay gated
                const on = invFilter === v;
                const tone = v === 'low' ? 'text-amber-300' : v === 'out' ? 'text-red-300' : 'text-[#d4af37]';
                return (
                  <button
                    key={v}
                    onClick={() => setInvFilter(v)}
                    className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap transition ${
                      on ? `bg-white/10 ${tone}` : 'text-white/50 hover:text-white/80'
                    }`}
                  >
                    {Icon && <Icon size={11} />}{label}
                  </button>
                );
              })}
            </div>
            <span className="w-px self-stretch bg-white/10 flex-shrink-0" aria-hidden="true" />
            {categoryOptionsForFilter.length > 21 ? (
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-1.5 rounded-full text-xs font-medium bg-white/5 border border-white/10 text-white/70 outline-none focus:border-[#d4af37]/60 flex-shrink-0"
                title="Filter by category"
              >
                {categoryOptionsForFilter.map((cat) => (
                  <option key={cat} value={cat} className="bg-[#111]">{cat === 'All' ? 'All Categories' : cat}</option>
                ))}
              </select>
            ) : (
              categoryOptionsForFilter.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition flex-shrink-0 ${
                    categoryFilter === cat
                      ? 'bg-gradient-to-r from-[#d4af37] to-[#aa801e] text-black font-bold'
                      : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/10'
                  }`}
                >
                  {cat}
                </button>
              ))
            )}
          </div>

          {/* Mobile: single Filters button → bottom sheet (CHANGE-05) */}
          <button
            onClick={() => setShowFilterSheet(true)}
            className="sm:hidden w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold bg-white/5 border border-white/10 text-white/70 active:scale-[0.99]"
          >
            <Filter size={15} /> Filters
            {(() => {
              const n = (categoryFilter !== 'All' ? 1 : 0) + (invFilter !== 'active' ? 1 : 0);
              return n ? <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-[#d4af37] text-black">{n}</span> : null;
            })()}
          </button>
        </div>

        {/* Bulk actions bar */}
        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-3 p-2.5 rounded-xl" style={{ background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.3)' }}>
            <span className="text-sm font-semibold text-white/85">{selectedIds.size} selected</span>
            <div className="flex items-center gap-2 ml-auto">
              {(canDelete || demoMode) && (
                <button onClick={bulkArchive} className="h-8 px-3 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 active:scale-95 transition flex items-center gap-1.5"><Archive size={13} /> Archive</button>
              )}
              <button onClick={() => exportInventoryExcel(inventory.filter((p) => selectedIds.has(p.id)))} className="h-8 px-3 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 active:scale-95 transition flex items-center gap-1.5"><Download size={13} /> Export</button>
              <button onClick={clearSelection} className="h-8 px-3 rounded-lg text-xs font-semibold text-white/50 hover:text-white/80 transition">Clear</button>
            </div>
          </div>
        )}

        {/* Table */}
        <div
          className="rounded-2xl overflow-hidden backdrop-blur-sm"
          style={{ background: 'rgba(var(--fg-rgb),0.02)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}
        >
          {loading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl p-3 animate-pulse" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.05)' }}>
                  <div className="w-10 h-10 rounded-lg bg-white/10 flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 rounded bg-white/10" style={{ width: `${30 + (i % 3) * 12}%` }} />
                    <div className="h-2.5 rounded bg-white/5 w-1/4" />
                  </div>
                  <div className="h-7 w-20 rounded-lg bg-white/10 hidden sm:block" />
                  <div className="h-7 w-24 rounded-lg bg-white/5 hidden md:block" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 flex flex-col items-center gap-3 text-center">
              <PackageSearch size={32} className="text-white/20" />
              {inventory.length === 0 ? (
                <p className="text-sm text-white/40">No parts yet. Click &quot;Add Part&quot; to get started.</p>
              ) : search.trim() ? (
                <>
                  <p className="text-sm text-white/60">No matching part found for &ldquo;{search.trim()}&rdquo;.</p>
                  <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
                    <button
                      onClick={() => { setEditPart({ name: search.trim() }); setShowModal(true); }}
                      className="h-11 px-4 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] active:scale-[0.98] transition flex items-center gap-2"
                    >
                      <Plus size={16} /> Create New Part
                    </button>
                    <button
                      onClick={() => toast('Online catalogue isn’t connected yet. It needs a licensed parts data provider before it can search — nothing runs automatically.', { icon: '🔌', duration: 5000 })}
                      className="h-11 px-4 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/70 active:scale-[0.98] transition flex items-center gap-2"
                      title="Optional — never runs automatically"
                    >
                      <Search size={15} /> Search Online Catalogue
                    </button>
                  </div>
                  <p className="text-[11px] text-white/30 mt-1">Online search is optional and only runs when you tap it.</p>
                </>
              ) : (
                <p className="text-sm text-white/40">{invFilter === 'dead' ? 'No dead stock found.' : invFilter === 'fast' ? 'No fast movers yet — record some sales to see them here.' : invFilter === 'low' ? 'No low-stock parts.' : invFilter === 'out' ? 'Nothing is out of stock.' : 'No parts match the current filter.'}</p>
              )}
            </div>
          ) : (
            <>
              {/* Mobile: tappable cards (the table is unusable on a phone) */}
              <div className="md:hidden space-y-2.5">
                {pagedInventory.map((part) => (
                  <MobilePartCard
                    key={part.id}
                    part={part}
                    highlight={part.id === highlightPartId}
                    isAdmin={canDelete}
                    canRestore={canDelete || demoMode}
                    selected={selectedIds.has(part.id)}
                    onToggleSelect={toggleSelect}
                    onEdit={(p) => { setEditPart(p); setShowModal(true); }}
                    onDelete={handleDelete}
                    onArchive={handleArchive}
                    onRestore={handleRestore}
                    onReorder={requestReorder}
                    onSell={handleSellClick}
                    onCommitStock={commitStock}
                    onReceive={setRestockTarget}
                    onAdjust={setAdjustTarget}
                  />
                ))}
              </div>

              {/* Desktop: full table */}
              <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={pagedInventory.length > 0 && pagedInventory.every((p) => selectedIds.has(p.id))}
                        onChange={() => setSelectedIds((s) => { const n = new Set(s); const all = pagedInventory.length > 0 && pagedInventory.every((p) => n.has(p.id)); pagedInventory.forEach((p) => (all ? n.delete(p.id) : n.add(p.id))); return n; })}
                        className="accent-[#d4af37] w-4 h-4 cursor-pointer align-middle"
                        aria-label="Select all on page"
                      />
                    </th>
                    {[
                      { label: '', key: null },
                      { label: 'Part', key: 'name' },
                      { label: 'SKU', key: null },
                      { label: 'Category', key: 'category' },
                      { label: 'Vehicle', key: null },
                      { label: 'Stock', key: 'stock' },
                      { label: 'Status', key: null },
                      { label: 'MRP / Floor', key: 'sellingPrice' },
                      { label: '', key: null },
                    ].map(({ label, key }, i) => (
                      <th
                        key={label + i}
                        onClick={() => key && toggleSort(key)}
                        className={`text-left px-4 py-3 text-[10px] uppercase tracking-wider text-white/30 font-medium ${
                          key ? 'cursor-pointer hover:text-white/60 select-none' : ''
                        }`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {label}
                          {key && sortConfig.key === key && (
                            <span className="text-[#d4af37]">{sortConfig.dir === 'asc' ? '↑' : '↓'}</span>
                          )}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedInventory.map((part) => (
                    <tr
                      key={part.id}
                      id={`inv-row-${part.id}`}
                      className={`transition align-middle ${part.archived ? 'opacity-60' : ''} ${part.id === highlightPartId ? 'bg-[#d4af37]/15' : 'hover:bg-white/[0.03]'}`}
                      style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.04)', boxShadow: part.id === highlightPartId ? 'inset 0 0 0 2px rgba(212,175,55,0.55)' : 'none' }}
                    >
                      <td className="px-4 py-3 w-10">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(part.id)}
                          onChange={() => toggleSelect(part.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="accent-[#d4af37] w-4 h-4 cursor-pointer align-middle"
                          aria-label={`Select ${part.name}`}
                        />
                      </td>
                      <td className="px-4 py-3" style={{ width: 56 }}>
                        <PartImageThumb
                          src={part.imageString}
                          alt={part.name}
                          onHover={handleImageHover}
                          onMove={handleImageMove}
                          onLeave={handleImageLeave}
                        />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-white">{part.name}</span>
                          {isFastMover(part) && (
                            <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-[#d4af37]/15 text-[#d4af37] border border-[#d4af37]/30">
                              <Zap size={9} /> Fast Mover
                            </span>
                          )}
                          {isDeadStock(part) && (
                            <span title={deadStockReason(part)} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-white/8 text-white/45 border border-white/15 cursor-help">
                              <Archive size={9} /> Dead Stock
                            </span>
                          )}
                        </div>
                        {showArchived && part.archived && (
                          <div className="text-[10px] text-white/35 mt-1 flex items-center gap-1">
                            <Archive size={9} /> Archived{part.archivedAt ? ` ${new Date((part.archivedAt.seconds || 0) * 1000).toLocaleDateString('en-IN')}` : ''}{part.archivedBy ? ` · by ${String(part.archivedBy).split('@')[0]}` : ''}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-white/50">{part.sku || '—'}</div>
                        {part.locationBin && (
                          <div className="flex items-center gap-1 text-[11px] text-white/35 mt-0.5">
                            <MapPin size={10} /> {part.locationBin}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-white/50 whitespace-nowrap">{part.category || '—'}</td>
                      <td className="px-4 py-3 text-white/50 whitespace-nowrap">{part.vehicle || '—'}</td>
                      <td className="px-4 py-3">
                        <StockStepper part={part} onCommit={commitStock} onSell={handleSellClick} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <StatusBadge stock={part.stock || 0} minStock={part.minStock} />
                          {/* FIX 2: corporate PO generation + smart routing */}
                          {(part.stock || 0) <= (part.minStock || 5) && (
                            <button
                              onClick={() => handleReorder(part)}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap transition active:scale-95 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25"
                              title="Generate a WhatsApp purchase order"
                            >
                              <MessageCircle size={11} /> Reorder
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-[#d4af37] font-bold leading-tight">{formatINR(part.sellingPrice)}</div>
                        {part.minSellingPrice > 0 && (
                          <div className="text-[11px] text-red-400/80 leading-tight">Min: {formatINR(part.minSellingPrice)}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setRestockTarget(part)}
                            className="w-8 h-8 rounded-lg flex items-center justify-center bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20 transition"
                            title="Receive stock (restock)"
                          >
                            <PackagePlus size={13} />
                          </button>
                          {(part.stock || 0) > 0 && (
                            <button
                              onClick={() => setAdjustTarget(part)}
                              className="w-8 h-8 rounded-lg flex items-center justify-center bg-amber-500/10 border border-amber-500/25 text-amber-400 hover:bg-amber-500/20 transition"
                              title="Adjust stock (damage / loss / correction)"
                            >
                              <PackageX size={13} />
                            </button>
                          )}
                          <button
                            onClick={() => setLedgerTarget(part)}
                            className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 transition"
                            title="Movement history"
                          >
                            <History size={13} />
                          </button>
                          <button
                            onClick={() => {
                              setEditPart(part);
                              setShowModal(true);
                            }}
                            className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#d4af37]/10 border border-[#d4af37]/25 text-[#d4af37] hover:bg-[#d4af37]/20 transition"
                            title="Edit part"
                          >
                            <Edit3 size={13} />
                          </button>
                          {(() => {
                            const blocked = partHasCopy(part) || partIsCopy(part);
                            return (
                              <button
                                onClick={() => handleDuplicate(part)}
                                disabled={blocked}
                                className={`w-8 h-8 rounded-lg flex items-center justify-center border transition ${blocked ? 'bg-white/[0.02] border-white/5 text-white/20 cursor-not-allowed' : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'}`}
                                title={blocked ? 'A copy already exists — edit the existing copy instead.' : 'Duplicate this part (one copy allowed)'}
                              >
                                <Copy size={13} />
                              </button>
                            );
                          })()}
                          {(canDelete || demoMode) && !part.archived && (
                            <button
                              onClick={() => handleArchive(part.id)}
                              className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 transition"
                              title="Archive (hide, restorable)"
                            >
                              <Archive size={13} />
                            </button>
                          )}
                          {(canDelete || demoMode) && part.archived && (
                            <button
                              onClick={() => handleRestore(part.id)}
                              className="w-8 h-8 rounded-lg flex items-center justify-center bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20 transition"
                              title="Restore from archive"
                            >
                              <ArchiveRestore size={13} />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              onClick={() => handleDelete(part.id)}
                              className="w-8 h-8 rounded-lg flex items-center justify-center bg-red-500/10 border border-red-500/25 text-red-400 hover:bg-red-500/20 transition"
                              title="Delete permanently"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>

              {/* Pagination controls */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 mt-1" style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                <div className="flex items-center gap-2 text-xs text-white/40">
                  <span>Rows:</span>
                  <select
                    value={invPerPage}
                    onChange={(e) => setInvPerPage(Number(e.target.value))}
                    className="bg-white/5 border border-white/15 rounded-lg px-2 py-1 text-white/80 focus:outline-none focus:border-[#d4af37]/50"
                  >
                    {[10, 25, 50, 100].map((n) => <option key={n} value={n} style={{ background: 'var(--surface-2)' }}>{n}</option>)}
                  </select>
                  <span className="ml-1">
                    {(invPage - 1) * invPerPage + 1}–{Math.min(invPage * invPerPage, filtered.length)} of {filtered.length}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setInvPage((p) => Math.max(1, p - 1))} disabled={invPage <= 1} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-white/70 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/10">Prev</button>
                  {Array.from({ length: invTotalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === invTotalPages || Math.abs(p - invPage) <= 1)
                    .reduce((acc, p, idx, arr) => { if (idx > 0 && p - arr[idx - 1] > 1) acc.push('…'); acc.push(p); return acc; }, [])
                    .map((p, i) => p === '…'
                      ? <span key={`e${i}`} className="px-2 text-white/30 text-xs">…</span>
                      : <button key={p} onClick={() => setInvPage(p)} className={`min-w-[32px] px-2 py-1.5 rounded-lg text-xs font-semibold border ${invPage === p ? 'bg-[#d4af37] text-black border-[#d4af37]' : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10'}`}>{p}</button>
                    )}
                  <button onClick={() => setInvPage((p) => Math.min(invTotalPages, p + 1))} disabled={invPage >= invTotalPages} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-white/70 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/10">Next</button>
                </div>
              </div>
            </>
          )}
        </div>

        <p className="text-xs text-white/30 mt-3">
          Showing {pagedInventory.length} of {filtered.length} {invFilter === 'archived' ? 'archived ' : ''}products{search || categoryFilter !== 'All' || invFilter !== 'active' ? ' (filtered)' : ''}
        </p>
        </>
        )}
        </>
        )}

        {activeTab === 'jobcards' && (
          <JobCardModule demoMode={demoMode} demoCanDelete={demoCan('deleteJobCards')} canManage={canManageData || demoMode} isAdmin={isAdmin || demoAdmin} inventory={inventory} customers={customers} onPersist={persistJobCard} onDelete={deleteJobCard} onRegisterVehicle={(custId, veh) => setCustomers((prev) => prev.map((c) => (c.id === custId ? { ...c, vehicles: [...(c.vehicles || []), { id: `v_${Date.now()}`, status: 'Active', ...veh }] } : c)))} savedCards={jobCards} />
        )}

        {activeTab === 'customers' && (
          <CustomersModule demoMode={demoMode} demoCanDelete={demoCan('deleteCustomers')} canManage={canManageData || demoMode} jobCards={jobCards} invoices={invoices} customers={customers} setCustomers={setCustomers} onCreateJobCard={startJobCardFor} onCreateInvoice={(c) => { const v = (c.vehicles || [])[0] || {}; try { localStorage.setItem('maruti_invoice_prefill', JSON.stringify({ customerId: c.id, customer: c.name, phone: c.phone, vehicle: v.model || '' })); } catch {} setActiveTab('billing'); toast.success(`New invoice for ${c.name}`); }} />
        )}

        {activeTab === 'vehicles' && (
          <VehiclesModule demoMode={demoMode} demoCanDelete={demoCan('deleteVehicles')} canManage={canManageData || demoMode} isAdmin={isAdmin || demoAdmin} customers={customers} jobCards={jobCards} invoices={invoices} setCustomers={setCustomers} onCreateJobCard={startJobCardFor} onCreateInvoice={(c) => { const v = (c.vehicles || [])[0] || {}; try { localStorage.setItem('maruti_invoice_prefill', JSON.stringify({ customerId: c.id, customer: c.name, phone: c.phone, vehicle: v.vehicle || v.model || '' })); } catch {} setActiveTab('billing'); toast.success(`New invoice for ${c.name}`); }} onCreateCustomer={() => setActiveTab('customers')} />
        )}

        {activeTab === 'reminders' && (
          <RemindersModule customers={customers} invoices={invoices} jobCards={jobCards} purchaseOrders={purchaseOrders} suppliers={suppliers} demoMode={demoMode} />
        )}

        {activeTab === 'billing' && (
          <BillingModule demoMode={demoMode} demoCanDelete={demoCan('deleteInvoices')} canManage={canManageData || demoMode} isAdmin={isAdmin || demoAdmin} invoices={invoices} customers={customers} inventory={inventory} jobCards={jobCards} onPersist={persistInvoice} onDelete={deleteInvoice} onRestoreStock={(iv) => { const restore = invoicePartQtys(iv); if (Object.keys(restore).length) applyStockDelta(restore); }}
            onQuickCustomer={(data) => { const id = `c_${Date.now()}`; const c = { id, code: `CUST-${String(customers.length + 1).padStart(4, '0')}`, name: data.name, phone: data.phone || '', email: data.email || '', gst: data.gst || '', address: data.address || '', type: 'Individual', status: 'Active', vehicles: [], createdAt: Date.now() }; setCustomers((prev) => [...prev, c]); return c; }}
            onQuickVehicle={(customerId, veh) => { const id = `v_${Date.now()}`; const v = { id, status: 'Active', ...veh }; setCustomers((prev) => prev.map((c) => (c.id === customerId ? { ...c, vehicles: [...(c.vehicles || []), v] } : c))); return v; }}
          />
        )}

        {activeTab === 'suppliers' && (
          <>
            {/* Suppliers module sub-navigation */}
            <div className="flex items-center gap-1 mb-5 p-1 rounded-xl w-max max-w-full overflow-x-auto" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
              {[{ k: 'directory', label: 'Directory' }, { k: 'performance', label: 'Performance' }].map((t) => (
                <button key={t.k} onClick={() => setSupSubView(t.k)} className={`px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition ${supSubView === t.k ? 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]' : 'text-white/60 hover:text-white/90 hover:bg-white/5'}`}>{t.label}</button>
              ))}
            </div>
            {supSubView === 'directory' && (
              <SupplierDirectory
                suppliers={suppliers}
                inventory={inventory}
                purchaseOrders={purchaseOrders}
                restocks={restocks}
                formatINR={formatINR}
                canManage={canManageData || demoMode}
                onEdit={(s) => { setEditSupplier(s); setShowSupplierModal(true); }}
                onArchive={(canManageData || demoMode) ? (s) => handleSupplierArchive(s.id) : undefined}
                onDelete={(canManageData || demoMode) ? (s) => handleSupplierDelete(s.id) : undefined}
                onAddPart={() => { setEditPart(null); setShowModal(true); }}
                onJumpToPart={(id, name) => { setActiveTab('inventory'); setCategoryFilter('All'); setInvFilter('all'); setSearch(name || ''); setHighlightPartId(id || null); }}
                poPanel={<SupplierPOBuilder docked inventory={inventory} suppliers={suppliers} restocks={restocks} formatINR={formatINR} onCreatePO={createPO} />}
              />
            )}
            {supSubView === 'performance' && (
              <SupplierPerformance suppliers={suppliers.filter((s) => !s.archived)} inventory={inventory} formatINR={formatINR} />
            )}
          </>
        )}

        {activeTab === 'analytics' && (isAdmin || demoMode) && (
          <AnalyticsView
            inventory={inventory}
            sales={sales}
            rollups={rollups}
            restocks={restocks}
            auditLog={auditLog}
            stockAdjustments={stockAdjustments}
            onEditPart={(p) => {
              setEditPart(p);
              setShowModal(true);
            }}
          />
        )}

        {activeTab === 'sales' && <SalesView sales={sales} />}
        {activeTab === 'services' && <ServicesView sales={sales} />}
        {activeTab === 'stockin' && <StockInView restocks={restocks} />}
        {activeTab === 'stockout' && <StockOutView sales={sales} stockAdjustments={stockAdjustments} />}
        {activeTab === 'reports' && (
          <ReportsView
            isAdmin={canManageData || demoMode}
            demoMode={demoMode}
            formatINR={formatINR}
            invoices={invoices}
            customers={customers}
            jobCards={jobCards}
            inventory={inventory}
            suppliers={suppliers}
            purchaseOrders={purchaseOrders}
            sales={sales}
            restocks={restocks}
            stockAdjustments={stockAdjustments}
            auditLog={auditLog}
            onExportInventory={exportInventoryExcel}
            onExportAudit={exportAuditLogs}
            onExportAnalytics={() => { setActiveTab('analytics'); toast('Analytics export is on the Analytics page toolbar.', { icon: '📊' }); }}
            onBackup={exportFullBackup}
            onExportSales={exportSalesReport}
            onExportLowStock={exportLowStockReport}
            onExportSupplier={exportSupplierReport}
            onExportMovement={exportStockMovementReport}
            counts={{ inventory: inventory.length, sales: sales.length, suppliers: suppliers.length, audit: auditLog.length, total: inventory.length + suppliers.length + sales.length + restocks.length + auditLog.length }}
          />
        )}
        {activeTab === 'alerts' && (
          <AlertsView
            alerts={allAlerts}
            readIds={readAlerts}
            archivedIds={archivedAlerts}
            onMarkRead={markAlertRead}
            onMarkAllRead={markAllAlertsRead}
            onArchive={archiveAlert}
            canDestroy={canDelete}
            inventory={inventory}
            onEditPart={(p) => { setEditPart(p); setShowModal(true); }}
          />
        )}
        {activeTab === 'settings' && (
          <SettingsView
            totalRecords={inventory.length + suppliers.length + sales.length + restocks.length + auditLog.length}
            lastBackup={lastBackup}
            lastSync={lastSync}
            online={online}
            isAdmin={isAdmin}
            demoMode={demoMode}
            demoAdmin={demoAdmin}
            sidebarCollapsed={sidebarCollapsed}
            setSidebarCollapsed={setSidebarCollapsed}
            userEmail={user?.email}
            onBackup={exportFullBackup}
            onRestore={() => backupInputRef.current?.click()}
            admins={dbAdmins}
            bootstrapAdmins={bootstrapAdmins}
            onAddAdmin={addAdminEmail}
            onRemoveAdmin={removeAdminEmail}
            staffPerms={staffPerms}
            onAddStaff={addStaffEmail}
            onRemoveStaff={removeStaffEmail}
            onSetStaffPerm={setStaffPermission}
            recoveryMeta={recoveryMeta}
            onResetAllData={resetAllData}
            onRestoreVault={restoreFromVault}
          />
        )}
        {activeTab === 'settings' && ((isAdmin && !demoMode) || (demoMode && demoAdmin)) && (
          <div className="mt-5 rounded-2xl p-5" style={{ background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.25)' }}>
            <div className="flex items-center gap-2 mb-1">
              <FlaskConical size={18} className="text-[#d4af37]" />
              <h3 className="text-base font-bold text-white">Demo Management</h3>
            </div>
            {isAdmin && !demoMode ? (
              <>
                <p className="text-xs text-white/50 mb-4">Switch your session into Demo Admin Mode to manage the sample demo dataset. Your production data stays completely isolated and untouched. No logout required.</p>
                <button
                  onClick={() => { try { sessionStorage.setItem('maruti_demo', '1'); sessionStorage.setItem('maruti_demo_admin', '1'); } catch {}; window.location.href = '/?demo=admin'; }}
                  className="px-4 py-2.5 rounded-xl text-sm font-bold bg-[#d4af37]/15 border border-[#d4af37]/30 text-[#d4af37] hover:bg-[#d4af37]/25"
                >🛠 Enter Demo Admin Mode</button>
              </>
            ) : (
              <>
                <p className="text-xs text-white/50 mb-4">Demo Admin tools — restore the original seeded demo dataset for this session. Production data is never touched.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button onClick={() => resetDemoScope('all', 'All demo data')} className="px-3 py-2.5 rounded-xl text-sm font-semibold bg-[#d4af37]/15 border border-[#d4af37]/30 text-[#d4af37] hover:bg-[#d4af37]/25">↺ Restore Original Demo Dataset</button>
                  <button onClick={() => resetDemoScope('inventory', 'Inventory')} className="px-3 py-2.5 rounded-xl text-sm font-semibold bg-white/5 border border-white/10 text-white/80 hover:bg-white/10">Reset Demo Inventory</button>
                  <button onClick={() => resetDemoScope('sales', 'Sales')} className="px-3 py-2.5 rounded-xl text-sm font-semibold bg-white/5 border border-white/10 text-white/80 hover:bg-white/10">Reset Demo Sales</button>
                  <button onClick={() => resetDemoScope('suppliers', 'Suppliers')} className="px-3 py-2.5 rounded-xl text-sm font-semibold bg-white/5 border border-white/10 text-white/80 hover:bg-white/10">Reset Demo Suppliers</button>
                  <button onClick={() => resetDemoScope('alerts', 'Alerts')} className="px-3 py-2.5 rounded-xl text-sm font-semibold bg-white/5 border border-white/10 text-white/80 hover:bg-white/10">Reset Demo Alerts</button>
                  <button onClick={() => resetDemoScope('all', 'Demo analytics')} className="px-3 py-2.5 rounded-xl text-sm font-semibold bg-white/5 border border-white/10 text-white/80 hover:bg-white/10">Rebuild Demo Analytics</button>
                </div>
              </>
            )}
          </div>
        )}
      </main>

      {showModal && (
        <PartModal
          demoMode={demoMode}
          part={editPart}
          inventory={inventory}
          suppliers={suppliers}
          saving={saving}
          isAdmin={canSeeCost}
          categoryTree={mergedCategoryTree}
          vehicleTree={mergedVehicleTree}
          salesHistory={sales}
          onAddCategory={addCategoryOption}
          onAddVehicle={addVehicleOption}
          onSave={handleSave}
          onSaveSupplier={persistSupplierEdit}
          onClose={() => {
            setShowModal(false);
            setEditPart(null);
            duplicateOriginRef.current = null;
          }}
        />
      )}

      {showSupplierModal && (
        <SupplierModal
          demoMode={demoMode}
          supplier={editSupplier}
          saving={supplierSaving}
          onSave={handleSupplierSave}
          onClose={() => {
            setShowSupplierModal(false);
            setEditSupplier(null);
          }}
        />
      )}

      {showLogoutConfirm && (
        <LogoutConfirmModal
          onCancel={() => setShowLogoutConfirm(false)}
          onConfirm={confirmLogout}
        />
      )}

      {/* Task 3: possible-duplicate prompt */}
      {dupPrompt && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} onClick={() => setDupPrompt(null)}>
          <div className="w-full max-w-sm rounded-2xl p-5" style={{ background: 'var(--surface-3)', border: '1px solid rgba(245,158,11,0.4)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1"><AlertTriangle size={18} className="text-amber-400" /><h3 className="text-base font-bold text-white">Possible duplicate</h3></div>
            <p className="text-sm text-white/60 mt-1">A part like this already exists:</p>
            <div className="mt-2 rounded-xl px-3 py-2 bg-white/[0.04] border border-white/10">
              <p className="text-sm font-semibold text-white">{dupPrompt.existing.name}</p>
              <p className="text-[11px] text-white/45">{dupPrompt.existing.sku ? `SKU ${dupPrompt.existing.sku} · ` : ''}Stock {dupPrompt.existing.stock ?? 0}{dupPrompt.existing.vehicle ? ` · ${dupPrompt.existing.vehicle}` : ''}</p>
            </div>
            <div className="flex flex-col gap-2 mt-4">
              <button
                onClick={() => { const ex = dupPrompt.existing; setDupPrompt(null); setShowModal(false); setEditPart(ex); setTimeout(() => setShowModal(true), 0); }}
                className="w-full py-2.5 rounded-xl text-sm font-semibold bg-white/5 border border-white/10 text-white/85 hover:bg-white/10"
              >
                View existing
              </button>
              <div className="flex gap-2">
                <button onClick={() => setDupPrompt(null)} className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/70">Cancel</button>
                <button
                  onClick={() => { const f = dupPrompt.form; setDupPrompt(null); handleSave({ ...f, _dupAck: true }); }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]"
                >
                  Create anyway
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FIX-09: on-brand confirmation modal for destructive actions */}
      {confirmState && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} onClick={() => setConfirmState(null)}>
          <div className="w-full max-w-sm rounded-2xl p-5" style={{ background: 'var(--surface-3)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-white">{confirmState.title}</h3>
            <p className="text-sm text-white/60 mt-2 leading-relaxed">{confirmState.message}</p>
            <div className="flex gap-2.5 mt-5">
              <button onClick={() => setConfirmState(null)} className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 transition">Cancel</button>
              <button
                onClick={() => { const fn = confirmState.onConfirm; setConfirmState(null); fn?.(); }}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition ${confirmState.danger ? 'text-white bg-red-500/90 hover:bg-red-500' : 'text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] hover:brightness-110'}`}
              >
                {confirmState.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {checkoutPart && (
        <CheckoutModal
          part={checkoutPart}
          onConfirm={handleSell}
          isAdmin={isAdmin || demoAdmin}
          onClose={() => setCheckoutPart(null)}
        />
      )}

      {quickPick && (
        <QuickPickModal
          mode={quickPick}
          inventory={inventory}
          onClose={() => setQuickPick(null)}
          onPick={(p) => {
            const mode = quickPick;
            setQuickPick(null);
            if (mode === 'sell') handleSellClick(p);
            else if (mode === 'adjust') setAdjustTarget(p);
            else setRestockTarget(p);
          }}
        />
      )}

      {restockTarget && (
        <RestockModal
          part={restockTarget}
          onConfirm={handleReceiveStock}
          onClose={() => setRestockTarget(null)}
        />
      )}

      {adjustTarget && (
        <StockAdjustModal
          part={adjustTarget}
          onConfirm={handleAdjustStock}
          onClose={() => setAdjustTarget(null)}
        />
      )}

      {ledgerTarget && (
        <ProductLedgerModal
          part={ledgerTarget}
          sales={sales}
          restocks={restocks}
          stockAdjustments={stockAdjustments}
          onClose={() => setLedgerTarget(null)}
        />
      )}

      {showImport && (
        <ImportModal
          existingSkus={new Set(inventory.map((p) => safeLower(p.sku)).filter(Boolean))}
          onImported={(n) => recordIO('import', n)}
          onClose={() => setShowImport(false)}
        />
      )}

      <CommandPalette
        open={cmdkOpen}
        onClose={() => setCmdkOpen(false)}
        inventory={inventory}
        suppliers={suppliers}
        customers={customers}
        invoices={invoices}
        jobCards={jobCards}
        onPickCustomer={(c) => { setActiveTab('customers'); setSearch(c.name || ''); }}
        onPickInvoice={(iv) => { setActiveTab('billing'); setSearch(iv.invNo || ''); }}
        onPickJobCard={(j) => { setActiveTab('jobcards'); setSearch(j.jobNo || ''); }}
        onPickPart={(p) => { setEditPart(p); setShowModal(true); }}
        onPickSupplier={() => setActiveTab('suppliers')}
        onPickCategory={(c) => { setActiveTab('inventory'); setCategoryFilter(c); }}
        onPickVehicle={(v) => { setActiveTab('inventory'); setSearch(v); }}
      />

      {/* Restore safety: never executes immediately — user must type RESTORE. */}
      {restoreConfirm && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(6px)' }} onClick={() => { setRestoreConfirm(false); pendingRestoreFile.current = null; }}>
          <div className="w-full max-w-md rounded-2xl p-5" style={{ background: 'var(--surface-1)', border: '1px solid rgba(239,68,68,0.35)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <span className="flex items-center justify-center w-9 h-9 rounded-full bg-red-500/15"><Upload size={18} className="text-red-400" /></span>
              <h3 className="text-base font-bold text-white">Restore Backup</h3>
            </div>
            <p className="text-sm text-white/60 leading-relaxed mb-1">This may <span className="text-red-300 font-semibold">replace current data</span> with the backup’s version (records with matching IDs are overwritten). This cannot be undone.</p>
            <p className="text-xs text-white/40 mb-3">File: {pendingRestoreFile.current?.name || '—'}</p>
            <label className="block text-[11px] uppercase tracking-wider text-white/40 mb-1.5">Type <span className="text-white font-bold">RESTORE</span> to continue</label>
            <input
              autoFocus
              value={restoreText}
              onChange={(e) => setRestoreText(e.target.value)}
              placeholder="RESTORE"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none bg-white/5 border border-white/15 text-white placeholder-white/25 focus:border-red-400/60 mb-4"
            />
            <div className="flex gap-2.5">
              <button onClick={() => { setRestoreConfirm(false); pendingRestoreFile.current = null; }} className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/80 hover:bg-white/10">Cancel</button>
              <button
                disabled={restoreText !== 'RESTORE'}
                onClick={() => { const f = pendingRestoreFile.current; setRestoreConfirm(false); pendingRestoreFile.current = null; if (f && restoreText === 'RESTORE') importFullBackup(f); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold transition disabled:opacity-40 disabled:cursor-not-allowed text-white bg-red-500/80 hover:bg-red-500 border border-red-400/40"
              >
                Restore Backup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CHANGE-05: mobile filter bottom sheet */}
      {showFilterSheet && (
        <div className="fixed inset-0 z-[100] flex items-end sm:hidden" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setShowFilterSheet(false)}>
          <div className="w-full rounded-t-3xl p-4 pb-6 max-h-[80vh] overflow-y-auto" style={{ background: 'var(--surface-3)', border: '1px solid rgba(var(--fg-rgb),0.08)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-white">Filters</h3>
              <button onClick={() => { setCategoryFilter('All'); setInvFilter('active'); }} className="text-xs text-white/50 hover:text-white">Clear all</button>
            </div>
            <p className="text-[10px] uppercase tracking-wider text-white/40 mb-2">Status</p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {[
                ['active', 'Active'],
                ['low', 'Low Stock'],
                ['out', 'Out of Stock'],
                ['archived', 'Archived'],
                ['all', 'All'],
              ].map(([v, label]) => {
                // archived viewable by all roles
                const on = invFilter === v;
                const tone = v === 'low' ? 'border-amber-500/40 text-amber-300 bg-amber-500/15' : v === 'out' ? 'border-red-500/40 text-red-300 bg-red-500/15' : 'border-[#d4af37]/40 text-[#d4af37] bg-[#d4af37]/15';
                return (
                  <button
                    key={v}
                    onClick={() => setInvFilter(v)}
                    className={`py-2.5 rounded-xl text-sm font-bold border transition ${on ? tone : 'bg-white/5 text-white/60 border-white/10'}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] uppercase tracking-wider text-white/40 mb-2">Category</p>
            <div className="grid grid-cols-2 gap-2">
              {categoryOptionsForFilter.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`py-2.5 px-3 rounded-xl text-sm font-medium text-left truncate ${categoryFilter === cat ? 'bg-gradient-to-r from-[#d4af37] to-[#aa801e] text-black font-bold' : 'bg-white/5 text-white/60 border border-white/10'}`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <button onClick={() => setShowFilterSheet(false)} className="w-full mt-5 py-3 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e]">
              Show {filtered.length} results
            </button>
          </div>
        </div>
      )}

      {alternativePart && (
        <AlternativeModal
          part={alternativePart}
          alternatives={inventory.filter(
            (p) =>
              p.id !== alternativePart.id &&
              (p.stock || 0) > 0 &&
              safeLower(p.category) === safeLower(alternativePart.category) &&
              !!alternativePart.category
          )}
          onPick={(alt) => {
            setAlternativePart(null);
            setCheckoutPart(alt); // pivot: sell the alternative instead
          }}
          onClose={() => setAlternativePart(null)}
        />
      )}

      {reorderTarget && (
        <ReorderModal
          target={reorderTarget}
          onPick={(number) => {
            openWhatsAppPO(reorderTarget.part, reorderTarget.supplierName, number);
            setReorderTarget(null);
          }}
          onClose={() => setReorderTarget(null)}
        />
      )}

      {/* Fix 5: shared hover preview — sizes to the image's natural aspect ratio
          (capped), so wide/tall parts fill a product-card frame with no letterbox
          white bands. Flips away from the cursor and clamps to the viewport. */}
      {hoveredImage.src && (() => {
        const MAX = 224, FRAME = MAX + 20, GAP = 18, PAD = 12; // FRAME ≈ image + card padding
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
        const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
        let left = hoveredImage.x + GAP;
        if (left + FRAME + PAD > vw) left = hoveredImage.x - FRAME - GAP;
        if (left < PAD) left = PAD;
        let top = hoveredImage.y + GAP;
        if (top + FRAME + PAD > vh) top = hoveredImage.y - FRAME - GAP;
        if (top < PAD) top = PAD;
        return (
          <div className="pointer-events-none" style={{ position: 'fixed', top, left, zIndex: 99999 }}>
            <div className="rounded-xl shadow-2xl border-2 border-[#d4af37]/60 bg-white flex items-center justify-center" style={{ padding: 10 }}>
              <img
                src={hoveredImage.src}
                alt="preview"
                style={{ maxWidth: MAX, maxHeight: MAX, width: 'auto', height: 'auto', display: 'block' }}
              />
            </div>
          </div>
        );
      })()}

      {/* Multi-supplier reorder: choose which supplier to order from. Primary is
          pre-highlighted; works in demo, demo-admin and production. */}
      {reorderDialog && (() => {
        const d = reorderDialog;
        const p = d.part;
        return (
          <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }} onClick={() => setReorderDialog(null)}>
            <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl" style={{ background: 'var(--surface-1)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
                <h3 className="text-base font-bold text-white flex items-center gap-2"><RefreshCw size={16} className="text-[#d4af37]" /> Reorder part</h3>
                <button onClick={() => setReorderDialog(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10"><X size={18} /></button>
              </div>
              <div className="p-5 space-y-3">
                {d.existing && (
                  <div className="rounded-xl p-3 text-xs" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}>
                    <span className="text-amber-300 font-semibold">A reorder is already active</span>
                    <span className="text-white/60"> — {d.existing.status}. You can still send another message, raise a PO, or cancel the active reorder below.</span>
                  </div>
                )}
                <div className="rounded-xl divide-y divide-white/[0.06]" style={{ background: 'rgba(var(--fg-rgb),0.03)', border: '1px solid rgba(var(--fg-rgb),0.06)' }}>
                  {[
                    ['Part', p.name],
                    ['Supplier', d.supplierName || '— none linked —'],
                    ['Current stock', `${p.stock || 0}`],
                    ['Minimum stock', `${p.minStock || 5}`],
                    ['Suggested qty', `${d.suggestedQty}`],
                    ['Contact', d.phone ? d.phone : 'no number on file'],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3 px-3 py-2 text-sm"><span className="text-white/45">{k}</span><span className="text-white/85 text-right font-medium">{v}</span></div>
                  ))}
                </div>
              </div>
              <div className="px-5 pb-5 space-y-2 safe-bottom-pad">
                <button onClick={() => reorderViaWhatsApp(d)} disabled={!d.phone} className="w-full h-11 rounded-xl text-sm font-bold flex items-center justify-center gap-2 bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition"><MessageCircle size={16} /> Send WhatsApp reorder</button>
                <button onClick={() => reorderViaPO(d)} className="w-full h-11 rounded-xl text-sm font-bold flex items-center justify-center gap-2 text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] active:scale-95 transition"><ClipboardList size={16} /> Create purchase order</button>
                {d.existing && canDelete && (
                  <button onClick={() => { clearReorderRequest(d.existing); setReorderDialog(null); }} className="w-full h-10 rounded-xl text-sm font-semibold text-red-400 bg-red-500/10 border border-red-500/25 active:scale-95 transition">Cancel active reorder</button>
                )}
                <button onClick={() => setReorderDialog(null)} className="w-full h-10 rounded-xl text-sm font-semibold text-white/60 hover:text-white/90 bg-white/5 border border-white/10 transition">Close</button>
              </div>
            </div>
          </div>
        );
      })()}

      {showPOBuilder && (
        <SupplierPOBuilder
          inventory={inventory}
          suppliers={suppliers}
          restocks={restocks}
          formatINR={formatINR}
          onClose={() => setShowPOBuilder(false)}
          onCreatePO={createPO}
        />
      )}

      {reorderChoice && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setReorderChoice(null)}>
          <div className="w-full max-w-sm rounded-2xl p-5" style={{ background: 'var(--surface-3)', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-white mb-1">Choose Supplier</h3>
            <p className="text-xs text-white/50 mb-4">{reorderChoice.part.name} has multiple suppliers. Select one for this reorder.</p>
            <div className="space-y-2">
              {reorderChoice.suppliers.map((sup, i) => (
                <button
                  key={sup.id || i}
                  onClick={() => { logReorderRequest(reorderChoice.part, sup); setReorderChoice(null); }}
                  className="w-full text-left px-3 py-2.5 rounded-xl flex items-center justify-between hover:bg-white/5 transition"
                  style={{ background: 'rgba(var(--fg-rgb),0.03)', border: `1px solid ${sup.isPreferred ? 'rgba(212,175,55,0.4)' : 'rgba(var(--fg-rgb),0.1)'}` }}
                >
                  <span>
                    <span className="block text-sm font-semibold text-white">{sup.name}</span>
                    <span className="block text-[11px] text-white/40">{sup.phone || 'no number'}{sup.isPreferred ? ' · Primary' : ' · Secondary'}</span>
                  </span>
                  {sup.isPreferred && <span className="text-[10px] font-bold uppercase tracking-wide text-[#d4af37]">Primary</span>}
                </button>
              ))}
            </div>
            <button onClick={() => setReorderChoice(null)} className="mt-4 w-full py-2 rounded-xl text-xs font-semibold text-white/50 hover:text-white/80 bg-white/5 border border-white/10">Cancel</button>
          </div>
        </div>
      )}

      {/* Mobile bottom navigation (phones only) */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-[80] flex items-stretch"
        style={{ background: 'var(--surface-1)', backdropFilter: 'blur(12px)', borderTop: '1px solid rgba(var(--fg-rgb),0.08)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {[
          { id: 'overview', label: 'Overview', icon: LayoutDashboard },
          { id: 'inventory', label: 'Inventory', icon: Package },
          { id: 'sales', label: 'Sales', icon: ShoppingCart },
          { id: 'alerts', label: 'Alerts', icon: AlertTriangle, badge: unreadAlertCount },
          { id: '__more', label: 'More', icon: MoreHorizontal },
        ].map((it) => {
          const active = it.id === '__more' ? false : activeTab === it.id;
          return (
            <button
              key={it.id}
              onClick={() => { if (it.id === '__more') { setSidebarMobileOpen(true); } else { setActiveTab(it.id); } }}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 relative active:scale-95 transition"
            >
              <span className="relative">
                <it.icon size={20} style={{ color: active ? '#d4af37' : 'rgba(var(--fg-rgb),0.5)' }} />
                {it.badge > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">{it.badge > 9 ? '9+' : it.badge}</span>
                )}
              </span>
              <span className="text-[10px] font-medium" style={{ color: active ? '#d4af37' : 'rgba(var(--fg-rgb),0.45)' }}>{it.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
