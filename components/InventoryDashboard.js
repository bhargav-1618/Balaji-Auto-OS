// components/InventoryDashboard.js
// Sri Baba Balaji Auto OS — "Luxury Dealership" Inventory Dashboard
// Single-file, production-ready. Next.js + Tailwind + Lucide + Firestore (offline-first, Base64 images).

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Modal from './Modal';
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
  AlertTriangle,
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
  FileText,
  LayoutDashboard,
  Menu,
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
const safeLower = (val) => (val || '').toString().toLowerCase();
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

function formatINR(n) {
  return `₹${(n || 0).toLocaleString('en-IN')}`;
}

// Phone helpers
const digitsOnly = (s) => (s || '').toString().replace(/\D/g, '');
const tenDigits = (s) => digitsOnly(s).slice(0, 10);
// FIX 4: canonical phone key — last 10 digits (strips +91, spaces, hyphens)
const normalizePhone = (str) => String(str ?? '').replace(/\D/g, '').slice(-10);
// Task 3: extract the real Indian mobile from input that may carry +91 / 91 /
// leading 0 / spaces / hyphens. Returns the 10-digit mobile (or 11-digit landline).
const toIndianPhone = (s) => {
  let d = digitsOnly(s);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2); // +91XXXXXXXXXX
  if (d.length === 11 && d.startsWith('0')) return d;        // landline 0XXXXXXXXXX
  return d.length > 10 ? d.slice(-10) : d;
};
// Task 3: valid Indian phone — 10-digit mobile starting 6–9 (accepts +91/91
// prefixes), or an 11-digit landline starting 0. Rejects short/garbage numbers.
const isValidIndianPhone = (s) => {
  const d = toIndianPhone(s);
  if (d.length === 11) return d.startsWith('0');
  if (d.length === 10) return /^[6-9]/.test(d);
  return false;
};
// Task 3: normalize a phone field AS the user types/pastes — drops a pasted
// +91/91 country code, keeps an 11-digit landline (leading 0), else caps at 10.
const phoneInput = (val) => {
  let d = digitsOnly(val);
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2);
  if (d.startsWith('0')) return d.slice(0, 11);
  return d.slice(0, 10);
};
// wa.me needs a country code; assume +91 for 10-digit Indian mobiles
const waNumber = (s) => {
  const d = normalizePhone(s);
  return d.length === 10 ? `91${d}` : digitsOnly(s);
};

// ---- FIX 1: fuzzy automotive search engine ----
// Strip punctuation, lowercase, trim.
const normalizeText = (str) =>
  String(str ?? '')
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
// Split into discrete keyword tokens.
const tokenize = (str) => normalizeText(str).split(' ').filter(Boolean);
// Automotive slang / vernacular → standardized inventory keywords.
const SLANG_MAP = {
  shocks: 'suspension', shock: 'suspension', struts: 'suspension', strut: 'suspension',
  shocker: 'suspension', shockers: 'suspension', absorber: 'suspension', absorbers: 'suspension',
  disc: 'brake', discs: 'brake', rotor: 'brake', rotors: 'brake', leather: 'brake',
  pad: 'brake', pads: 'brake', brakes: 'brake', braking: 'brake',
  gas: 'ac', cooling: 'ac', coolant: 'ac', aircon: 'ac', airconditioner: 'ac',
  plug: 'spark', plugs: 'spark', sparkplug: 'spark', sparkplugs: 'spark',
  grease: 'consumable', lube: 'consumable', lubricant: 'consumable',
  bulb: 'light', bulbs: 'light', headlamp: 'headlight', lamp: 'light', lamps: 'light',
  wiper: 'wiper', wipers: 'wiper', blade: 'wiper', blades: 'wiper',
  mirror: 'mirror', mirrors: 'mirror', glass: 'mirror',
  battery: 'battery', batteries: 'battery', cell: 'battery',
  tyre: 'tyre', tyres: 'tyre', tire: 'tyre', tires: 'tyre', wheel: 'tyre',
  clutch: 'clutch', gear: 'transmission', gearbox: 'transmission',
  silencer: 'exhaust', muffler: 'exhaust',
  radiator: 'radiator', filter: 'filter', filters: 'filter',
  belt: 'belt', belts: 'belt', hose: 'hose', hoses: 'hose',
  oil: 'oil', engineoil: 'oil',
  // CHANGE-04: common Telugu (te-IN) auto-parts terms → English search keywords.
  'బ్రేక్': 'brake', 'ఆయిల్': 'oil', 'ఆయిలు': 'oil', 'బ్యాటరీ': 'battery',
  'టైర్': 'tyre', 'టైరు': 'tyre', 'క్లచ్': 'clutch', 'ఫిల్టర్': 'filter',
  'లైట్': 'light', 'బల్బ్': 'bulb', 'అద్దం': 'mirror', 'ప్లగ్': 'spark',
  'సస్పెన్షన్': 'suspension', 'హార్న్': 'horn', 'వైపర్': 'wiper', 'రేడియేటర్': 'radiator',
};
// Expand a token to itself + any slang synonym.
const expandToken = (t) => (SLANG_MAP[t] ? [t, SLANG_MAP[t]] : [t]);
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
// iOS Safari ignores `overflow:hidden` on <body> for touch scrolling, so we pin
// the body with position:fixed. A counter handles stacked/overlapping modals:
// lock on the first opener, restore scroll only when the last one closes.
let __scrollLockCount = 0;
let __scrollLockY = 0;
function __lockBody() {
  if (typeof document === 'undefined') return;
  if (__scrollLockCount === 0) {
    __scrollLockY = window.scrollY || window.pageYOffset || 0;
    const b = document.body;
    b.style.position = 'fixed'; b.style.top = `-${__scrollLockY}px`; b.style.left = '0'; b.style.right = '0'; b.style.width = '100%'; b.style.overflow = 'hidden';
  }
  __scrollLockCount++;
}
function __unlockBody() {
  if (typeof document === 'undefined') return;
  __scrollLockCount = Math.max(0, __scrollLockCount - 1);
  if (__scrollLockCount === 0) {
    const b = document.body;
    b.style.position = ''; b.style.top = ''; b.style.left = ''; b.style.right = ''; b.style.width = ''; b.style.overflow = '';
    window.scrollTo(0, __scrollLockY);
  }
}
// Hook form: lock for the lifetime of a mounted modal component.
function useBodyScrollLock() {
  useEffect(() => { __lockBody(); return () => __unlockBody(); }, []);
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
const APP_VERSION = '3.9.15';
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
const tsToDate = (ts) => (ts?.toDate ? ts.toDate() : ts?.seconds ? new Date(ts.seconds * 1000) : ts instanceof Date ? ts : null);
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
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
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
function MobilePartCard({ part, onEdit, onDelete, onArchive, onRestore, onReorder, onSell, onCommitStock, onReceive, onAdjust, isAdmin, canRestore, highlight }) {
  const [open, setOpen] = useState(false);
  const low = (part.stock || 0) <= (part.minStock || 5);
  return (
    <div
      id={`inv-rowm-${part.id}`}
      className={`rounded-2xl overflow-hidden ${part.archived ? 'opacity-60' : ''}`}
      style={{ background: 'rgba(255,255,255,0.03)', border: highlight ? '2px solid rgba(212,175,55,0.6)' : '1px solid rgba(255,255,255,0.07)' }}
    >
      <div className="p-3">
        <div className="flex items-start gap-3">
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
        <div className="px-3 pb-3 pt-1 space-y-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
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
            {isAdmin && !part.archived && onArchive && (
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
function RestockModal({ part, onConfirm, onClose }) {
  useBodyScrollLock();
  const preferred = getPartSuppliers(part).find((s) => s.isPreferred) || getPartSuppliers(part)[0];
  const [qty, setQty] = useState('');
  const [unitCost, setUnitCost] = useState(String(part.purchasePrice ?? ''));
  const [supplierName, setSupplierName] = useState(preferred?.name || '');
  const [reference, setReference] = useState('');
  const n = Math.max(0, parseInt(qty, 10) || 0);
  const cost = Math.max(0, parseFloat(unitCost) || 0);
  const fld = 'w-full px-3 py-2.5 rounded-xl text-sm outline-none bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-[#d4af37]/60 transition';
  const lbl = 'block text-[11px] uppercase tracking-wider text-white/40 mb-1';
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl p-5" style={{ background: '#0f0f0f', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-1">
          <PackagePlus size={18} className="text-[#d4af37]" />
          <h3 className="text-base font-bold text-white">Receive Stock</h3>
        </div>
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
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Checkout modal — sell with bargain-floor (minSellingPrice) lock
// ---------------------------------------------------------------------------
function CheckoutModal({ part, onConfirm, onClose, isAdmin = false }) {
  useBodyScrollLock();
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
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl overflow-hidden backdrop-blur-md"
        style={{ background: 'rgba(17,17,17,0.95)', border: '1px solid rgba(212,175,55,0.25)' }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="flex items-center gap-2">
            <ShoppingCart size={18} className="text-[#d4af37]" />
            <h2 className="text-base font-bold text-white">Checkout — Sell Item</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/60 transition"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
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
const ADJUST_REASONS = ['Damage', 'Adjustment', 'Personal Use', 'Lost Item'];
function StockAdjustModal({ part, onConfirm, onClose }) {
  useBodyScrollLock();
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

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl overflow-hidden" style={{ background: 'rgba(17,17,17,0.96)', border: '1px solid rgba(212,175,55,0.25)' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2"><PackageX size={18} className="text-amber-400" /><h2 className="text-base font-bold text-white">Adjust stock — {part.name}</h2></div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/60"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
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
        </div>
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
        style={{ background: 'rgba(17,17,17,0.96)', border: '1px solid rgba(212,175,55,0.25)' }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
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
              style={{ background: 'rgba(20,20,20,0.98)', border: '1px solid rgba(212,175,55,0.25)' }}
            >
              {panelInner}
            </div>
            {/* CHANGE-06: Mobile bottom sheet (avoids clipping inside the modal) */}
            <div className="sm:hidden fixed inset-0 z-[110] flex items-end" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setOpen(false)}>
              <div className="w-full rounded-t-3xl overflow-hidden modal-sheet flex flex-col" style={{ background: '#0f0f0f', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
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
      <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${row.isPreferred ? 'rgba(212,175,55,0.45)' : 'rgba(255,255,255,0.08)'}` }}>
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
          <div className="px-3 pb-3 space-y-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
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
          <div className="px-3 pb-3 space-y-2.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
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
          <div className="px-3 pb-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
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
          style={{ background: 'rgba(20,20,20,0.98)', border: '1px solid rgba(212,175,55,0.25)' }}
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
function PartModal({ part, inventory, suppliers = [], saving, onSave, onClose, onSaveSupplier, isAdmin = true, categoryTree = CATEGORY_TREE, vehicleTree = VEHICLE_TREE, salesHistory = [], onAddCategory, onAddVehicle, asPage = false }) {
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
      category: '',
      vehicle: '',
      locationBin: '', // Feature 1: shelf/bin location
      stock: '',
      minStock: (() => { try { const v = localStorage.getItem('maruti_low_stock_default'); return v && /^\d+$/.test(v) ? v : '5'; } catch { return '5'; } })(),
      purchasePrice: '',
      sellingPrice: '',
      minSellingPrice: '', // Issue 3: bargain floor
      imageString: '',
      ...part,
    };
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

  // Base64 image handling — no Firebase Storage
  function handleImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      toast.error('Please choose an image under 1MB (stored as Base64 in Firestore).');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => setForm((f) => ({ ...f, imageString: ev.target.result }));
    reader.readAsDataURL(file);
  }

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
    onSave(form);
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
        <form ref={formBodyRef} onSubmit={handleSubmit} className="p-5 space-y-4 safe-bottom-pad">
          {/* CHANGE-02: mobile step progress */}
          <div className="sm:hidden">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-white/70">Step {mobileStep} of {STEPS.length} · {STEPS[mobileStep - 1].label}</span>
            </div>
            <div className="flex gap-1.5">
              {STEPS.map((s) => (
                <div key={s.n} className="h-1 flex-1 rounded-full" style={{ background: s.n <= mobileStep ? '#d4af37' : 'rgba(255,255,255,0.1)' }} />
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
          {/* Image upload */}
          <div>
            <label className={fieldLabel}>Part Photo (optional, Base64, max 1MB)</label>
            <div className="flex items-center gap-3">
              {form.imageString ? (
                <img
                  src={form.imageString}
                  alt="preview"
                  className="w-16 h-16 rounded-xl object-contain bg-white border border-[#d4af37]/30"
                />
              ) : (
                <div className="w-16 h-16 rounded-xl flex items-center justify-center bg-white/5 border border-dashed border-white/15">
                  <ImageOff size={20} className="text-white/30" />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#d4af37]/10 border border-[#d4af37]/30 text-[#d4af37] hover:bg-[#d4af37]/20 transition"
                >
                  <Upload size={13} /> {form.imageString ? 'Change' : 'Upload'}
                </button>
                {form.imageString && (
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, imageString: '' }))}
                    className="text-xs text-white/40 hover:text-white/70 transition"
                  >
                    Remove photo
                  </button>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" onChange={handleImage} className="hidden" />
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
                  <label className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer mb-2" style={{ background: isUni ? 'rgba(212,175,55,0.12)' : 'rgba(255,255,255,0.04)', border: `1px solid ${isUni ? 'rgba(212,175,55,0.4)' : 'rgba(255,255,255,0.1)'}` }}>
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
            <div className={`grid ${isAdmin ? 'grid-cols-3' : 'grid-cols-1'} gap-2`}>
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
              <div data-field="sellingPrice">
                <label className={fieldLabel}>MRP (₹) *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.sellingPrice}
                  onChange={(e) => { set('sellingPrice')(e); if (errors.sellingPrice || errors.minSellingPrice) setErrors((x) => ({ ...x, sellingPrice: undefined, minSellingPrice: undefined })); }}
                  onKeyDown={blockInvalidNumberKeys}
                  placeholder="0"
                  className={`${fieldInput}${errCls('sellingPrice')}`}
                />
                {errMsg('sellingPrice')}
              </div>
              {isAdmin && (
                <div data-field="minSellingPrice">
                  <label className={fieldLabel}>Min Sell (₹) *</label>
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
                <div className="flex items-center justify-between text-xs font-semibold pt-0.5">
                  <span className="text-emerald-400">
                    Max Profit: {formatINR((parseFloat(form.sellingPrice) || 0) - (parseFloat(form.purchasePrice) || 0))}
                  </span>
                  <span className="w-px h-4 bg-white/10" />
                  <span className={`${((parseFloat(form.minSellingPrice) || 0) - (parseFloat(form.purchasePrice) || 0)) < 0 ? 'text-red-400' : 'text-amber-400'}`}>
                    Min Profit: {formatINR((parseFloat(form.minSellingPrice) || 0) - (parseFloat(form.purchasePrice) || 0))}
                  </span>
                </div>
                <p className="text-[11px] text-white/35">
                  Min Selling is the bargain floor — sales below it are blocked at checkout.
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

          {/* Desktop footer — Cancel / Save */}
          <div
            className="hidden sm:flex gap-3 pt-3 pb-1 mt-2 sticky bottom-0 -mx-5 px-5"
            style={{ background: 'rgba(17,17,17,0.97)', borderTop: '1px solid rgba(255,255,255,0.08)' }}
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
              disabled={saving || !formValid}
              className="flex-1 py-3 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-[#d4af37] to-[#aa801e] hover:brightness-110 active:scale-[0.98] transition disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {saving && <Loader2 size={15} className="animate-spin" />}
              {isEdit ? 'Save Changes' : 'Add Part'}
            </button>
          </div>

          {/* Mobile footer — Back / Next / Save (CHANGE-02) */}
          <div
            className="flex sm:hidden gap-3 pt-3 pb-1 mt-2 sticky bottom-0 -mx-5 px-5"
            style={{ background: 'rgba(17,17,17,0.97)', borderTop: '1px solid rgba(255,255,255,0.08)', paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
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
      <div className="min-h-screen flex flex-col" style={{ background: '#0a0a0a' }}>
        <div
          className="sticky top-0 z-20 flex items-center gap-2 px-3 py-3"
          style={{ background: 'rgba(10,10,10,0.98)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}
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
    <Modal onClose={onClose} title={isEdit ? 'Edit Part' : 'Add New Part'} bodyClassName="">
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
        style={{ background: 'rgba(17,17,17,0.95)', border: '1px solid rgba(212,175,55,0.25)' }}
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
        style={{ background: 'rgba(17,17,17,0.96)', border: '1px solid rgba(212,175,55,0.25)' }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
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
function SupplierModal({ supplier, saving, onSave, onClose }) {
  const isEdit = !!supplier?.id;
  const [form, setForm] = useState(() => {
    const contacts = getSupplierContacts(supplier);
    const altNames = Array.isArray(supplier?.altNames) ? supplier.altNames : [];
    return {
      name: supplier?.name || '',
      // FIX 3: structured labeled contact cards
      phoneNumbers: contacts.length ? contacts : [{ number: '', label: 'Primary' }],
      altNames: altNames.length ? altNames : [''],
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
    onSave(form);
  }

  const CONTACT_LABELS = ['Primary', 'WhatsApp', 'Landline', 'Owner', 'Accounts', 'Workshop', 'Manager'];
  const fieldLabel = 'block text-[11px] uppercase tracking-wider text-white/40 mb-1.5';
  const fieldInput =
    'w-full px-3 py-2.5 rounded-xl text-sm outline-none bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-[#d4af37]/60 transition backdrop-blur-sm';

  return (
    <Modal onClose={onClose} title={isEdit ? 'Edit Supplier' : 'Add New Supplier'} bodyClassName="">
        <form onSubmit={handleSubmit} className="p-5 space-y-4 safe-bottom-pad">
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

          <div>
            <label className={fieldLabel}>Notes</label>
            <textarea
              value={form.notes}
              onChange={set('notes')}
              rows={3}
              placeholder="Payment terms, delivery time, GST no…"
              className={`${fieldInput} resize-none`}
            />
          </div>

          <div
            className="flex gap-3 pt-3 pb-1 mt-2 sticky bottom-0 -mx-5 px-5"
            style={{ background: 'rgba(17,17,17,0.97)', borderTop: '1px solid rgba(255,255,255,0.08)' }}
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
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Suppliers tab view — contact directory
// ---------------------------------------------------------------------------
function SuppliersView({ suppliers, inventory, loading, onEdit, onDelete, onArchive, onRestore, onJumpToPart, isAdmin }) {
  // FEATURE 3: per-supplier part selection for bulk POs, keyed "supplierId:partId"
  const [selected, setSelected] = useState({});
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
      <div className="rounded-2xl p-10 flex flex-col items-center gap-3 text-white/40" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <Loader2 size={24} className="animate-spin" />
        <span className="text-sm">Loading suppliers…</span>
      </div>
    );
  }

  if (suppliers.length === 0) {
    return (
      <div className="rounded-2xl p-12 flex flex-col items-center gap-3 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <Users size={32} className="text-white/20" />
        <p className="text-sm text-white/40">No suppliers yet. Click "Add Supplier" to build your contact directory.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl overflow-hidden backdrop-blur-sm" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="p-3 sm:p-4 flex flex-col gap-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
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
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
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
                <tr key={s.id} className="transition hover:bg-white/[0.03] align-top" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
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
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
                              {cats.length > 0 && <span className="text-white/45">Categories: <span className="text-white/70">{cats.slice(0, 3).join(', ')}{cats.length > 3 ? ` +${cats.length - 3}` : ''}</span></span>}
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
                                  {parts.length >= 2 && (() => {
                                    // #1 elegant Select All — a single header control, not a chip in
                                    // the list. Indeterminate when only some are selected.
                                    const ids = parts.map((p) => p.id);
                                    const allSel = ids.length > 0 && ids.every((pid) => isSelected(s.id, pid));
                                    const someSel = ids.some((pid) => isSelected(s.id, pid));
                                    return (
                                      <label className="flex items-center gap-1.5 text-[11px] font-bold text-white/80 hover:text-white cursor-pointer select-none" title="Select every part for one Purchase Order">
                                        <input
                                          type="checkbox"
                                          checked={allSel}
                                          ref={(el) => { if (el) el.indeterminate = !allSel && someSel; }}
                                          onChange={() => setSelected((prev) => {
                                            const next = { ...prev };
                                            if (allSel) ids.forEach((pid) => delete next[`${s.id}:${pid}`]);
                                            else ids.forEach((pid) => { next[`${s.id}:${pid}`] = true; });
                                            return next;
                                          })}
                                          className="w-3.5 h-3.5 accent-emerald-500 cursor-pointer"
                                        />
                                        Select all <span className="text-white/40">({ids.length})</span>
                                      </label>
                                    );
                                  })()}
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
                                        sel ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-[#d4af37]/12 text-[#d4af37] border-[#d4af37]/30'
                                      }`}
                                      title={count > 1 ? `${count} inventory records (original + copy)` : undefined}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={sel}
                                        onChange={() => ids.forEach((pid) => { if (isSelected(s.id, pid) === sel) toggleSelect(s.id, pid); })}
                                        className="w-3 h-3 accent-emerald-500 cursor-pointer"
                                        title="Select for bulk PO"
                                      />
                                      <button onClick={() => onJumpToPart(grp.items[0]?.id, grp.base)} className="hover:underline" title={`Find ${grp.base} in inventory`}>
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
        <div className="p-3 flex justify-center" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
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
    <div className="rounded-2xl p-4 sm:p-5 backdrop-blur-sm" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
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
    <div className="rounded-lg" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
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
  const stickyBg = { background: '#101010' };
  const maxBar = Math.max(1, ...trend.series.map((m) => Math.max(m.revenue, m.profit)));

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="rounded-2xl p-3 flex flex-wrap items-center gap-2 backdrop-blur-sm" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
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
            <thead><tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{['Part', 'Stock', 'Revenue', 'Profit', 'Margin'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {ppPager.visible.map((p) => (
                <tr key={p.id} className="hover:bg-white/[0.03]" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
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
            <thead><tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{[vehMode === 'brand' ? 'Brand' : 'Model', 'Units', 'Revenue', 'Profit', 'Rev %'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {vehPager.visible.map((r) => (
                <tr key={r.name} className="hover:bg-white/[0.03]" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
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

      {/* Sales by Staff (ADD-05) */}
      <ACard title="Sales by Staff" icon={Users}>
        {staffAgg.length === 0 ? (
          <p className="text-xs text-white/35">No sales recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{['Staff', 'Orders', 'Units', 'Revenue', 'Profit'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {staffAgg.map((r) => (
                  <tr key={r.name} className="hover:bg-white/[0.03]" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
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
                <div key={k} className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="text-[10px] uppercase tracking-wider text-white/40">{k}</div>
                  <div className="text-base font-bold text-[#d4af37] mt-0.5">{v}</div>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{['Supplier', 'Receipts', 'Units', 'Spend'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {restockAgg.bySup.slice(0, 10).map((r) => (
                    <tr key={r.name} className="hover:bg-white/[0.03]" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
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
                <div key={r.reason} className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
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
            <thead><tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{['#', 'Part', 'Units Sold', 'Revenue', 'Profit'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {fmPager.visible.map((p, i) => (
                <tr key={p.id} className="hover:bg-white/[0.03]" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
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
              <div key={b.key} className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
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
                  <div className="px-3 pb-2 overflow-x-auto" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    {b.items.length ? (
                      <table className="w-full">
                        <thead><tr>{['Part', 'Qty', 'Value', 'Days in Stock'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                        <tbody>
                          {b.items.slice(0, 50).map((p) => (
                            <tr key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
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
            <thead><tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{['Part', 'Stock', 'Locked', 'Days', 'Suggested ₹', ''].map((h, i) => <th key={i} className={i === 0 ? thSticky : th} style={i === 0 ? stickyBg : undefined}>{h}</th>)}</tr></thead>
            <tbody>
              {dsPager.visible.map((p) => (
                <tr key={p.id} className="hover:bg-white/[0.03]" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
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

function ImportModal({ existingSkus, onClose }) {
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
      <div className="w-full max-w-2xl rounded-2xl p-5 modal-sheet overflow-y-auto" style={{ background: '#0f0f0f', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
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
                    <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
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
      out.push({ t: tsToDate(s.createdAt), type: 'Sale', qty: -(s.qty || 0), note: s.belowFloor ? 'below floor' : '', by: s.soldByEmail }));
    restocks.filter((r) => r.partId === part.id).forEach((r) =>
      out.push({ t: tsToDate(r.createdAt), type: 'Purchase', qty: +(r.qty || 0), note: r.supplierName || '', by: r.byEmail }));
    stockAdjustments.filter((a) => a.partId === part.id).forEach((a) =>
      out.push({ t: tsToDate(a.createdAt), type: a.reason || 'Adjustment', qty: a.qty || 0, note: a.notes || '', by: a.byEmail }));
    return out.filter((r) => r.t).sort((a, b) => b.t - a.t);
  }, [part.id, sales, restocks, stockAdjustments]);

  const color = (q) => (q > 0 ? 'text-emerald-400' : 'text-red-400');
  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl overflow-hidden" style={{ background: 'rgba(17,17,17,0.96)', border: '1px solid rgba(212,175,55,0.25)' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
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
                <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
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
  return <div className={`rounded-2xl p-4 ${className}`} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>{children}</div>;
}
function isSameDay(d, ref) { return d && d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate(); }
function trendPct(today, yest) {
  if (!yest) return today > 0 ? 100 : 0;
  return Math.round(((today - yest) / yest) * 100);
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
  const title = mode === 'sell' ? 'Record Sale' : 'Receive Stock';
  const hint = mode === 'sell' ? 'Pick the part you sold' : 'Pick the part that arrived';
  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center p-4 pt-[8vh]" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden" style={{ background: '#121212', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
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
function OverviewView({ inventory, sales, suppliers, auditLog, restocks, stockAdjustments = [], reorderRequests = [], lastSync, lastBackup, online, connError, onNavigate, onAddPart, onAddSupplier, onImport, onReorder, onAdvanceStatus, onClearRequest, onEditPart, isAdmin, canDestroy = true, onQuickSell, onQuickReceive }) {
  const active = useMemo(() => inventory.filter((p) => !p.archived), [inventory]);
  const now = new Date();
  const yesterday = new Date(Date.now() - 86400000);

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

  // --- Top selling (from sales ledger, aggregated by part) ---
  const topSelling = useMemo(() => {
    const m = new Map();
    sales.forEach((s) => {
      if (!s.partId) return;
      const cur = m.get(s.partId) || { partId: s.partId, name: s.name || '', units: 0, revenue: 0 };
      cur.units += s.qty || 0; cur.revenue += s.revenue || 0;
      m.set(s.partId, cur);
    });
    return [...m.values()].sort((a, b) => b.units - a.units).slice(0, 5);
  }, [sales]);

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
    <span className={`text-[11px] font-semibold ${pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{pct >= 0 ? '▲' : '▼'} {Math.abs(pct)}% vs yesterday</span>
  );

  return (
    <div className="space-y-4">
      {/* Today's Overview + Inventory Health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <OverviewCard className="lg:col-span-2">
          <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2"><TrendingUp size={14} className="text-[#d4af37]" /> Today’s Overview</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <p className="text-[11px] text-white/40">Revenue</p>
              <p className="text-xl font-bold text-white">{fmt(today.revT)}</p>
              <Trend pct={trendPct(today.revT, today.revY)} />
            </div>
            <div>
              <p className="text-[11px] text-white/40">Profit</p>
              <p className="text-xl font-bold text-emerald-400">{fmt(today.proT)}</p>
              <Trend pct={trendPct(today.proT, today.proY)} />
            </div>
            <div>
              <p className="text-[11px] text-white/40">Sales</p>
              <p className="text-xl font-bold text-white">{today.cntT}</p>
              <Trend pct={trendPct(today.cntT, today.cntY)} />
            </div>
            <div>
              <p className="text-[11px] text-white/40">Stock Movement</p>
              <p className="text-xl font-bold text-white">{today.movesIn + today.movesOut}</p>
              <p className="text-[11px] text-white/40">In {today.movesIn} · Out {today.movesOut} · Adj {today.adjToday}</p>
            </div>
          </div>
          {today.cntT === 0 && <p className="text-[11px] text-white/30 mt-3">No sales recorded today yet.</p>}
        </OverviewCard>

        <OverviewCard>
          <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2"><ShieldCheck size={14} className="text-[#d4af37]" /> Inventory Health</h3>
          <div className="flex items-center gap-4">
            <div className="relative w-20 h-20 flex-shrink-0">
              <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
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
          <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2"><Star size={14} className="text-[#d4af37]" /> Top Selling</h3>
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
function CommandPalette({ open, onClose, inventory, suppliers, onPickPart, onPickSupplier, onPickCategory, onPickVehicle }) {
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
    onClose();
  };

  if (!open) return null;
  const icon = { part: Package, supplier: Users, category: Filter, vehicle: Car };
  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center pt-[12vh] px-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div className="w-full max-w-xl rounded-2xl overflow-hidden shadow-2xl" style={{ background: '#161616', border: '1px solid rgba(212,175,55,0.3)' }} onClick={(e) => e.stopPropagation()}>
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
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white flex items-center gap-2"><Icon size={20} className="text-[#d4af37]" /> {title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}
function LedgerRow({ left, mid, right, sub }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="min-w-0 flex-1"><p className="text-sm text-white truncate">{left}</p>{sub && <p className="text-[11px] text-white/35">{sub}</p>}</div>
      {mid && <span className="text-xs text-white/50 flex-shrink-0">{mid}</span>}
      <span className="text-sm font-semibold flex-shrink-0">{right}</span>
    </div>
  );
}
const inr = (n) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
function StatStrip({ cards }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center gap-1.5 mb-1">{c.icon && <c.icon size={13} className="text-[#d4af37]" />}<span className="text-[10px] uppercase tracking-wider text-white/40">{c.label}</span></div>
          <p className="text-lg font-bold" style={{ color: c.color || '#fff' }}>{c.value}</p>
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
                {[10, 25, 50, 100].map((n) => <option key={n} value={n} style={{ background: '#1a1a1a' }}>{n}</option>)}
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
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }} onClick={() => setDetail(null)}>
          <div className="w-full max-w-sm rounded-2xl p-5" style={{ background: '#121212', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-white">Details</h3><button onClick={() => setDetail(null)} className="text-white/40 hover:text-white"><X size={16} /></button></div>
            <div className="space-y-1.5 text-sm">
              {Object.entries(detail.detail).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3"><span className="text-white/40">{k}</span><span className="text-white/85 text-right">{String(v ?? '—')}</span></div>
              ))}
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}

function SalesView({ sales }) {
  const cards = useMemo(() => {
    const now = new Date();
    let revT = 0, ordT = 0, proT = 0, revM = 0;
    sales.forEach((s) => {
      const d = tsToDate(s.createdAt); if (!d) return;
      if (isSameDay(d, now)) { revT += s.revenue || 0; proT += s.profit || 0; ordT += 1; }
      if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) revM += s.revenue || 0;
    });
    return [
      { label: 'Revenue Today', value: inr(revT), icon: TrendingUp, color: '#34d399' },
      { label: 'Orders Today', value: ordT, icon: ShoppingCart },
      { label: 'Profit Today', value: inr(proT), color: '#34d399' },
      { label: 'Avg Order', value: inr(ordT ? revT / ordT : 0) },
      { label: 'Revenue (Month)', value: inr(revM), color: '#d4af37' },
    ];
  }, [sales]);
  const items = useMemo(() => sales.map((s) => {
    const d = tsToDate(s.createdAt);
    return {
      id: s.id, t: d?.getTime() || 0, s: `${s.name} ${s.soldByEmail || ''}`, ty: 'Sale', qty: s.qty, amount: s.revenue || 0,
      row: <LedgerRow left={s.name} sub={`${dstr(s.createdAt)} · ${s.soldByEmail || ''}`} mid={`${s.qty} × ${inr(s.unitPrice)}`} right={<span className="text-emerald-400">{inr(s.revenue)}</span>} />,
      detail: { Part: s.name, Quantity: s.qty, 'Unit Price': inr(s.unitPrice), MRP: inr(s.unitPrice), Revenue: inr(s.revenue), Profit: inr(s.profit), 'Sold By': s.soldByEmail || '—', Date: dstr(s.createdAt) },
    };
  }), [sales]);
  return <LedgerPage title="Sales" icon={ShoppingCart} cards={cards} items={items} sortOptions={['Newest', 'Oldest', 'Highest Revenue', 'Highest Profit']} csvName="Sales" csvHeader={['Part', 'Quantity', 'Unit Price', 'MRP', 'Revenue', 'Profit', 'Sold By', 'Date']} />;
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
    return [
      { label: 'Sales (units)', value: sales.reduce((s, x) => s + (x.qty || 0), 0), icon: ShoppingCart },
      { label: 'Damage', value: count('Damage'), color: '#ef4444' },
      { label: 'Lost Items', value: count('Lost Item'), color: '#ef4444' },
      { label: 'Adjustments', value: count('Adjustment'), color: '#d4af37' },
      { label: 'Personal Use', value: count('Personal Use'), color: '#d4af37' },
    ];
  }, [sales, stockAdjustments]);
  const reasonColor = (r) => r === 'Sale' ? '#34d399' : r === 'Damage' || r === 'Lost Item' ? '#ef4444' : '#d4af37';
  const items = useMemo(() => {
    const arr = sales.map((s) => ({ id: 's' + s.id, name: s.name, when: s.createdAt, qty: -(s.qty || 0), reason: 'Sale', by: s.soldByEmail, notes: '' }))
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
  return <LedgerPage title="Stock Out — Sales & Reductions" icon={Send} cards={cards} items={items} typeOptions={['Sale', 'Damage', 'Lost Item', 'Personal Use', 'Adjustment', 'Correction']} sortOptions={['Newest', 'Oldest', 'Largest Qty']} csvName="StockOut" csvHeader={['Part', 'Reason', 'Quantity', 'Recorded By', 'Notes', 'Date']} />;
}
function ReportsView({ onExportInventory, onExportAudit, onExportAnalytics, onBackup, onExportSales, onExportLowStock, onExportSupplier, onExportMovement, isAdmin, counts = {} }) {
  const reports = [
    { label: 'Inventory Report', desc: `${counts.inventory ?? 0} parts · Excel (.xlsx)`, icon: Package, onClick: onExportInventory },
    { label: 'Sales Report', desc: `${counts.sales ?? 0} sales · Excel (.xlsx)`, icon: ShoppingCart, onClick: onExportSales },
    { label: 'Stock Movement Report', desc: 'Stock in / out / adjustments · Excel', icon: Send, onClick: onExportMovement },
    { label: 'Low Stock Report', desc: 'Items at or below min stock · Excel', icon: AlertTriangle, onClick: onExportLowStock },
    { label: 'Supplier Report', desc: `${counts.suppliers ?? 0} suppliers · Excel (.xlsx)`, icon: Users, onClick: onExportSupplier },
    { label: 'Audit Report', desc: `${counts.audit ?? 0} events · Excel (.xlsx)`, icon: FileText, onClick: onExportAudit },
    { label: 'Analytics Report', desc: 'Business analytics · Excel (.xlsx)', icon: BarChart3, onClick: onExportAnalytics, admin: true },
    { label: 'Full Backup', desc: `${counts.total ?? 0} records · JSON safety file`, icon: ShieldCheck, onClick: onBackup, admin: true },
  ];
  return (
    <PageShell title="Report Center" icon={FileText}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {reports.filter((r) => !r.admin || isAdmin).map((r) => (
          <button key={r.label} onClick={r.onClick} className="flex items-center gap-3 p-4 rounded-xl text-left hover:border-[#d4af37]/40 transition" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <span className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#d4af37]/12 flex-shrink-0"><r.icon size={18} className="text-[#d4af37]" /></span>
            <span className="flex-1"><span className="block text-sm font-semibold text-white">{r.label}</span><span className="block text-[11px] text-white/40">{r.desc}</span></span>
            <Download size={15} className="text-white/30" />
          </button>
        ))}
      </div>
      <p className="text-[11px] text-white/30">All reports export to Excel (.xlsx). PDF export is planned.</p>
    </PageShell>
  );
}
// Critical #1: single source of truth for alerts so the Alert Center and the
// sidebar badge always agree. Pure function — no state.
function computeAlerts(inventory, reorderRequests, connError) {
  const active = inventory.filter((p) => !p.archived);
  const list = [];
  active.filter((p) => (p.stock || 0) === 0).forEach((p) => list.push({ id: 'out-' + p.id, sev: 'Critical', cat: 'critical', title: `Out of stock: ${p.name}`, sub: p.sku || 'no SKU', partId: p.id }));
  active.filter((p) => (p.stock || 0) > 0 && (p.stock || 0) <= (p.minStock || 5)).forEach((p) => list.push({ id: 'low-' + p.id, sev: 'Warning', cat: 'warning', title: `Low stock: ${p.name}`, sub: `${p.stock}/${p.minStock || 5} · ${p.sku || 'no SKU'}`, partId: p.id }));
  active.filter((p) => (p.stock || 0) < 0).forEach((p) => list.push({ id: 'neg-' + p.id, sev: 'Critical', cat: 'inventory', title: `Negative stock: ${p.name}`, sub: `stock = ${p.stock}`, partId: p.id }));
  const bySku = {};
  active.forEach((p) => { const k = safeLower(p.sku); if (k) (bySku[k] = bySku[k] || []).push(p); });
  Object.values(bySku).filter((g) => g.length > 1).forEach((g) => list.push({ id: 'sku-' + safeLower(g[0].sku), sev: 'Inventory', cat: 'inventory', title: `SKU conflict: ${g[0].sku}`, sub: `${g.length} parts share this SKU`, partId: g[0].id }));
  active.filter((p) => !(p.suppliers || []).length && (p.stock || 0) <= (p.minStock || 5)).forEach((p) => list.push({ id: 'nosup-' + p.id, sev: 'Inventory', cat: 'inventory', title: `No supplier: ${p.name}`, sub: 'Needs reorder but has no linked supplier', partId: p.id }));
  reorderRequests.filter((r) => r.status !== 'Delivered').forEach((r) => list.push({ id: 'po-' + r.id, sev: 'Supplier', cat: 'supplier', title: `Reorder ${r.status}: ${r.partName}`, sub: `${r.supplierName} · ×${r.qty}` }));
  if (connError) list.push({ id: 'sync', sev: 'Critical', cat: 'critical', title: 'Sync issue', sub: connError });
  return list;
}
function AlertsView({ alerts, readIds, archivedIds, onMarkRead, onMarkAllRead, onArchive, onEditPart, inventory, canDestroy = true }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [page, setPage] = useState(1);
  const PER = 25;
  const visible = useMemo(() => alerts.filter((a) => !archivedIds.has(a.id)), [alerts, archivedIds]);
  const counts = useMemo(() => ({
    critical: visible.filter((a) => a.sev === 'Critical').length,
    warning: visible.filter((a) => a.sev === 'Warning').length,
    info: visible.filter((a) => a.cat === 'supplier').length,
    total: visible.length,
    unread: visible.filter((a) => !readIds.has(a.id)).length,
  }), [visible, readIds]);
  const filtered = useMemo(() => {
    const needle = safeLower(q.trim());
    return visible.filter((a) => {
      if (cat === 'unread' && readIds.has(a.id)) return false;
      if (cat === 'read' && !readIds.has(a.id)) return false;
      if (['critical', 'warning', 'inventory', 'supplier'].includes(cat) && a.cat !== cat) return false;
      if (needle && !safeLower(`${a.title} ${a.sub}`).includes(needle)) return false;
      return true;
    });
  }, [visible, q, cat, readIds]);
  useEffect(() => { setPage(1); }, [q, cat]);
  const pages = Math.max(1, Math.ceil(filtered.length / PER));
  const shown = filtered.slice((page - 1) * PER, page * PER);
  const sevColor = { Critical: '#ef4444', Warning: '#d4af37', Inventory: '#fb923c', Supplier: '#60a5fa' };
  const fld = 'px-2.5 py-2 rounded-lg text-xs outline-none bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60';
  const openPart = (a) => { onMarkRead(a.id); if (a.partId) { const p = inventory.find((x) => x.id === a.partId); if (p) onEditPart(p); } };
  return (
    <PageShell title="Alert Center" icon={AlertTriangle} action={counts.unread > 0 && <button onClick={onMarkAllRead} className="text-xs font-semibold text-white/60 hover:text-white px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">Mark all read</button>}>
      <StatStrip cards={[
        { label: 'Critical', value: counts.critical, color: '#ef4444', icon: AlertTriangle },
        { label: 'Warning', value: counts.warning, color: '#d4af37' },
        { label: 'Information', value: counts.info, color: '#60a5fa' },
        { label: 'Unread', value: counts.unread, color: '#d4af37' },
        { label: 'Total', value: counts.total },
      ]} />
      <div className="flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search alerts…" className={`${fld} flex-1 min-w-[140px]`} />
        <select value={cat} onChange={(e) => setCat(e.target.value)} className={fld}>
          <option value="all" className="bg-[#111]">All</option>
          <option value="unread" className="bg-[#111]">Unread</option>
          <option value="read" className="bg-[#111]">Read</option>
          <option value="critical" className="bg-[#111]">Critical</option>
          <option value="warning" className="bg-[#111]">Warning</option>
          <option value="inventory" className="bg-[#111]">Inventory</option>
          <option value="supplier" className="bg-[#111]">Supplier</option>
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
                <div key={a.id} className="flex items-center gap-2 px-3 py-2.5 rounded-lg" style={{ background: isRead ? 'rgba(255,255,255,0.01)' : 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', opacity: isRead ? 0.6 : 1 }}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: sevColor[a.sev] }} />
                  <button onClick={() => openPart(a)} className="min-w-0 flex-1 text-left">
                    <p className="text-sm text-white truncate">{a.title}</p>
                    <p className="text-[11px] text-white/40 truncate">{a.sub}</p>
                  </button>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0" style={isRead ? { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' } : { background: 'rgba(212,175,55,0.15)', color: '#d4af37' }}>{isRead ? 'READ' : 'UNREAD'}</span>
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
    </PageShell>
  );
}
function SettingsView({ totalRecords, lastBackup, lastSync, isAdmin, userEmail, online, onBackup, onRestore, admins = [], bootstrapAdmins = [], onAddAdmin, onRemoveAdmin, staffPerms = {}, onAddStaff, onRemoveStaff, onSetStaffPerm, recoveryMeta = null, onResetAllData, onRestoreVault }) {
  const [biz, setBiz] = useState({ name: '', contact: '', lowStock: '', gst: '', address: '', fastMover: '', deadDays: '', reorderMult: '' });
  const [saved, setSaved] = useState(false);
  const [newAdmin, setNewAdmin] = useState('');
  const [newStaff, setNewStaff] = useState('');
  const [resetStep, setResetStep] = useState(0); // 0 closed, 1 warn, 2 type RESET
  const [resetText, setResetText] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const recoveryActive = !!recoveryMeta && (recoveryMeta.expiresAt || 0) > Date.now();
  const daysRemaining = recoveryActive ? Math.max(0, Math.ceil((recoveryMeta.expiresAt - Date.now()) / 86400000)) : 0;
  useEffect(() => {
    try {
      setBiz({
        name: localStorage.getItem('maruti_biz_name') || '',
        contact: localStorage.getItem('maruti_biz_contact') || '',
        lowStock: localStorage.getItem('maruti_low_stock_default') || '',
        gst: localStorage.getItem('maruti_biz_gst') || '',
        address: localStorage.getItem('maruti_biz_address') || '',
        fastMover: localStorage.getItem('maruti_fast_mover_min') || '',
        deadDays: localStorage.getItem('maruti_dead_stock_days') || '',
        reorderMult: localStorage.getItem('maruti_reorder_mult') || '',
      });
    } catch {}
  }, []);
  const save = () => {
    try {
      const setOrClear = (key, val, validate) => {
        const v = (val ?? '').toString().trim();
        if (v === '') { localStorage.removeItem(key); return; }
        if (validate && !validate(v)) return;
        localStorage.setItem(key, v);
      };
      setOrClear('maruti_biz_name', biz.name);
      setOrClear('maruti_biz_contact', biz.contact);
      setOrClear('maruti_biz_gst', biz.gst);
      setOrClear('maruti_biz_address', biz.address);
      setOrClear('maruti_low_stock_default', biz.lowStock, (v) => /^\d+$/.test(v));
      setOrClear('maruti_fast_mover_min', biz.fastMover, (v) => /^\d+$/.test(v) && +v > 0);
      setOrClear('maruti_dead_stock_days', biz.deadDays, (v) => /^\d+$/.test(v) && +v > 0);
      setOrClear('maruti_reorder_mult', biz.reorderMult, (v) => parseFloat(v) >= 1);
      setSaved(true);
      toast.success('Settings saved.');
      setTimeout(() => setSaved(false), 2000);
    } catch { toast.error('Could not save settings on this device.'); }
  };
  const fld = 'w-full h-11 px-3 rounded-lg text-sm outline-none bg-white/5 border border-white/10 text-white focus:border-[#d4af37]/60';
  const Card = ({ title, icon: Icon, children }) => (
    <div className="p-4 rounded-xl" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2"><Icon size={14} className="text-[#d4af37]" /> {title}</h3>
      {children}
    </div>
  );
  return (
    <PageShell title="Settings" icon={Settings}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 max-w-3xl">
        <Card title="Business Profile" icon={Car}>
          <div className="space-y-2.5">
            <div><label className="block text-[11px] text-white/40 mb-1">Shop name (header, reports &amp; exports)</label><input value={biz.name} onChange={(e) => setBiz({ ...biz, name: e.target.value })} placeholder={SHOP_NAME} className={fld} /></div>
            <div><label className="block text-[11px] text-white/40 mb-1">Contact number (on purchase orders)</label><input inputMode="tel" value={biz.contact} onChange={(e) => setBiz({ ...biz, contact: e.target.value })} placeholder="10-digit phone" className={fld} /></div>
            <div><label className="block text-[11px] text-white/40 mb-1">GSTIN (on exports &amp; POs)</label><input value={biz.gst} onChange={(e) => setBiz({ ...biz, gst: e.target.value.toUpperCase() })} placeholder="22AAAAA0000A1Z5" className={fld} /></div>
            <div><label className="block text-[11px] text-white/40 mb-1">Shop address</label><input value={biz.address} onChange={(e) => setBiz({ ...biz, address: e.target.value })} placeholder="Street, city, PIN" className={fld} /></div>
            <button onClick={save} className="w-full h-11 rounded-lg text-sm font-semibold text-black bg-[#d4af37] hover:bg-[#e8c84a] transition">{saved ? '✓ Saved' : 'Save changes'}</button>
          </div>
        </Card>

        <Card title="Inventory Behavior" icon={Package}>
          <div className="space-y-2.5">
            <div><label className="block text-[11px] text-white/40 mb-1">Default low-stock level (new parts)</label><input inputMode="numeric" value={biz.lowStock} onChange={(e) => setBiz({ ...biz, lowStock: e.target.value.replace(/[^0-9]/g, '') })} placeholder="5" className={fld} /></div>
            <div><label className="block text-[11px] text-white/40 mb-1">“Fast mover” after this many sold</label><input inputMode="numeric" value={biz.fastMover} onChange={(e) => setBiz({ ...biz, fastMover: e.target.value.replace(/[^0-9]/g, '') })} placeholder="10" className={fld} /></div>
            <div><label className="block text-[11px] text-white/40 mb-1">“Dead stock” after this many days unsold</label><input inputMode="numeric" value={biz.deadDays} onChange={(e) => setBiz({ ...biz, deadDays: e.target.value.replace(/[^0-9]/g, '') })} placeholder="90" className={fld} /></div>
            <div><label className="block text-[11px] text-white/40 mb-1">Reorder top-up (× minimum stock)</label><input inputMode="decimal" value={biz.reorderMult} onChange={(e) => setBiz({ ...biz, reorderMult: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="2" className={fld} /></div>
            <button onClick={save} className="w-full h-11 rounded-lg text-sm font-semibold text-black bg-[#d4af37] hover:bg-[#e8c84a] transition">{saved ? '✓ Saved' : 'Save changes'}</button>
            <p className="text-[10px] text-white/30">Affects Fast Mover / Dead Stock badges, the Reorder Center quantities, and the default minimum on new parts.</p>
          </div>
        </Card>

        <Card title="Backup &amp; Data" icon={ShieldCheck}>
          <div className="space-y-2.5">
            <p className="text-[11px] text-white/40">Download a full JSON copy of every record, or restore from a previous backup file.</p>
            <button onClick={onBackup} disabled={!isAdmin} className="w-full py-2 rounded-lg text-sm font-semibold text-[#d4af37] bg-[#d4af37]/10 border border-[#d4af37]/30 hover:bg-[#d4af37]/20 transition disabled:opacity-40 flex items-center justify-center gap-2"><Download size={15} /> Backup now</button>
            <button onClick={onRestore} disabled={!isAdmin} className="w-full py-2 rounded-lg text-sm font-semibold text-white/70 bg-white/5 border border-white/10 hover:bg-white/10 transition disabled:opacity-40 flex items-center justify-center gap-2"><Upload size={15} /> Restore from file</button>
            <div className="flex justify-between text-[11px] pt-1"><span className="text-white/40">Last backup</span><span className="text-white/70">{lastBackup ? new Date(lastBackup).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never'}</span></div>
            {!isAdmin && <p className="text-[10px] text-white/30">Backup &amp; restore require an admin account.</p>}
          </div>
        </Card>

        <Card title="System Information" icon={Settings}>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-white/40">Connection</span><span style={{ color: online ? '#34d399' : '#ef4444' }}>{online ? 'Connected' : 'Offline'}</span></div>
            <div className="flex justify-between"><span className="text-white/40">Last sync</span><span className="text-white/70">{lastSync ? lastSync.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</span></div>
            <div className="flex justify-between"><span className="text-white/40">App version</span><span className="text-white/70">v{APP_VERSION}</span></div>
            <div className="flex justify-between"><span className="text-white/40">Total records</span><span className="text-white/70">{totalRecords.toLocaleString('en-IN')}</span></div>
            <div className="flex justify-between"><span className="text-white/40">Storage mode</span><span className="text-white/70">Cloud + offline cache</span></div>
          </div>
        </Card>

        <Card title="Account" icon={Users}>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-white/40">Signed in as</span><span className="text-white/80 truncate ml-2">{userEmail || '—'}</span></div>
            <div className="flex justify-between"><span className="text-white/40">Role</span><span className="text-white/80">{isAdmin ? 'Admin' : 'Staff'}</span></div>
          </div>
          <p className="text-[10px] text-white/30 mt-2">Admin-only features (cost fields, delete, exports) require an admin account and a re-login after access changes.</p>
        </Card>

        {isAdmin && (
          <div className="lg:col-span-2 p-4 rounded-xl" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2"><Users size={14} className="text-[#d4af37]" /> Staff &amp; Access</h3>
            <p className="text-[11px] text-white/40 mb-3">Admins can see cost prices, delete records, run exports, and open Settings. Everyone else is staff. Newly added admins must log out and back in for it to take effect.</p>
            <div className="space-y-1.5 mb-3">
              {bootstrapAdmins.map((e) => (
                <div key={e} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.18)' }}>
                  <span className="text-sm text-white/85 truncate">{e}</span>
                  <span className="text-[10px] font-semibold text-[#d4af37] flex-shrink-0">OWNER · Admin</span>
                </div>
              ))}
              {admins.filter((e) => !bootstrapAdmins.map((b) => b.toLowerCase()).includes(e.toLowerCase())).map((e) => (
                <div key={e} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <span className="text-sm text-white/85 truncate">{e}</span>
                  <button onClick={() => onRemoveAdmin(e)} className="text-[10px] font-semibold text-red-400 hover:text-red-300 flex-shrink-0 ml-2">Remove admin</button>
                </div>
              ))}
              {admins.filter((e) => !bootstrapAdmins.map((b) => b.toLowerCase()).includes(e.toLowerCase())).length === 0 && (
                <p className="text-[11px] text-white/30 px-1">No additional admins yet. Everyone else who logs in is staff.</p>
              )}
            </div>
            <div className="flex gap-2">
              <input value={newAdmin} onChange={(e) => setNewAdmin(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newAdmin.trim()) { onAddAdmin(newAdmin).then((ok) => { if (ok) setNewAdmin(''); }); } }} placeholder="staff@email.com" className={fld} />
              <button onClick={() => { if (newAdmin.trim()) onAddAdmin(newAdmin).then((ok) => { if (ok) setNewAdmin(''); }); }} className="px-4 py-2 rounded-lg text-sm font-semibold text-black bg-[#d4af37] hover:bg-[#e8c84a] flex-shrink-0">Make admin</button>
            </div>
          </div>
        )}

        {isAdmin && (
          <div className="lg:col-span-2 p-4 rounded-xl" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <h3 className="text-xs uppercase tracking-wider text-white/40 mb-2 flex items-center gap-2"><Users size={14} className="text-[#d4af37]" /> Staff Members (non-admin)</h3>
            <div className="rounded-lg p-3 mb-3 text-[11px] leading-relaxed" style={{ background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.18)' }}>
              <p className="text-white/70 mb-1.5 font-semibold">How to add a staff login (one-time):</p>
              <p className="text-white/50">1. Create their login: open <a href="https://console.firebase.google.com/project/_/authentication/users" target="_blank" rel="noreferrer" className="text-[#d4af37] underline">Firebase → Authentication → Users → Add user</a>, enter their email + a password, and give them those details.</p>
              <p className="text-white/50">2. Add the same email below and choose what they can do. Staff can always view stock and record sales; everything else is off unless you switch it on.</p>
            </div>
            <div className="space-y-2 mb-3">
              {Object.keys(staffPerms).length === 0 ? (
                <p className="text-[11px] text-white/30 px-1">No staff members yet.</p>
              ) : Object.entries(staffPerms).map(([email, p]) => (
                <div key={email} className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-white/85 truncate">{email}</span>
                    <button onClick={() => onRemoveStaff(email)} className="text-[10px] font-semibold text-red-400 hover:text-red-300 flex-shrink-0 ml-2">Remove</button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[['costPrices', 'See cost prices'], ['deletes', 'Delete records'], ['exports', 'Run exports']].map(([key, label]) => (
                      <button key={key} onClick={() => onSetStaffPerm(email, key, !p?.[key])} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition" style={p?.[key] ? { background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.4)', color: '#34d399' } : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)' }}>
                        <span className="w-3 h-3 rounded-full flex items-center justify-center" style={{ background: p?.[key] ? '#34d399' : 'rgba(255,255,255,0.15)' }}>{p?.[key] ? '✓' : ''}</span>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newStaff} onChange={(e) => setNewStaff(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newStaff.trim()) { onAddStaff(newStaff).then((ok) => { if (ok) setNewStaff(''); }); } }} placeholder="newstaff@email.com" className={fld} />
              <button onClick={() => { if (newStaff.trim()) onAddStaff(newStaff).then((ok) => { if (ok) setNewStaff(''); }); }} className="px-4 py-2 rounded-lg text-sm font-semibold text-black bg-[#d4af37] hover:bg-[#e8c84a] flex-shrink-0">Add staff</button>
            </div>
          </div>
        )}

        {isAdmin && (
          <div className="lg:col-span-2 p-4 rounded-xl" style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <h3 className="text-xs uppercase tracking-wider text-red-300/70 mb-2 flex items-center gap-2"><ShieldCheck size={14} className="text-red-400" /> Data Safety &amp; Recovery</h3>

            {/* Recovery status card */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              {[
                ['Last Backup', lastBackup ? new Date(lastBackup).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'],
                ['Last Reset', recoveryMeta?.createdAt ? new Date(recoveryMeta.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'],
                ['Recovery Available', recoveryActive ? 'Yes' : 'No'],
                ['Days Remaining', recoveryActive ? `${daysRemaining}` : '—'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <div className="text-[9px] uppercase tracking-wide text-white/35">{k}</div>
                  <div className="text-sm font-semibold text-white/85">{v}</div>
                </div>
              ))}
            </div>

            {/* Recovery Vault — restore */}
            {recoveryActive ? (
              <div className="rounded-lg p-3 mb-3" style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.25)' }}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-sm font-semibold text-emerald-300">Recovery Vault active</div>
                    <div className="text-[11px] text-white/50">{recoveryMeta.total} records saved · expires in {daysRemaining} day{daysRemaining === 1 ? '' : 's'}</div>
                  </div>
                  <button disabled={restoreBusy} onClick={async () => { if (!confirm('Restore all data from the Recovery Vault? This brings your shop back exactly as it was before the reset.')) return; setRestoreBusy(true); await onRestoreVault(); setRestoreBusy(false); }} className="px-4 py-2 rounded-lg text-sm font-bold text-black bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 flex items-center gap-2">
                    <ArchiveRestore size={15} /> {restoreBusy ? 'Restoring…' : 'Restore Now'}
                  </button>
                </div>
              </div>
            ) : recoveryMeta && !recoveryActive ? (
              <div className="rounded-lg p-3 mb-3 text-[11px] text-white/40" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>Recovery period expired.</div>
            ) : null}

            {/* Reset trigger */}
            <button onClick={() => { setResetStep(1); setResetText(''); }} className="px-4 py-2 rounded-lg text-sm font-semibold text-red-300 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 flex items-center gap-2">
              <Trash2 size={15} /> Reset All Data
            </button>
            <p className="text-[10px] text-white/30 mt-2">Wipes the whole shop into a {7}-day Recovery Vault you can restore from. Backups and resets work across all your devices.</p>
          </div>
        )}
      </div>

      {/* Two-step reset confirmation modal */}
      {resetStep > 0 && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }} onClick={(e) => { if (e.target === e.currentTarget && !resetBusy) setResetStep(0); }}>
          <div className="w-full max-w-md rounded-2xl p-5" style={{ background: '#141414', border: '1px solid rgba(239,68,68,0.35)' }}>
            {resetStep === 1 ? (
              <>
                <div className="flex items-center gap-2 mb-3"><AlertTriangle size={20} className="text-red-400" /><h3 className="text-base font-bold text-white">Reset entire system?</h3></div>
                <p className="text-sm text-white/65 leading-relaxed mb-4">This will remove all inventory, suppliers, sales, stock movements, alerts, analytics and reports. A 7-day Recovery Vault is created first, so you can restore everything within 7 days.</p>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setResetStep(0)} className="px-4 py-2 rounded-lg text-sm font-semibold text-white/70 bg-white/5 border border-white/15 hover:bg-white/10">Cancel</button>
                  <button onClick={() => setResetStep(2)} className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-red-500/80 hover:bg-red-500">Continue</button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-3"><AlertTriangle size={20} className="text-red-400" /><h3 className="text-base font-bold text-white">Type RESET to confirm</h3></div>
                <p className="text-sm text-white/65 leading-relaxed mb-3">Your data goes to the Recovery Vault and can be restored for 7 days. After 7 days it cannot be undone. Type <span className="font-bold text-red-300">RESET</span> below to proceed.</p>
                <input autoFocus value={resetText} onChange={(e) => setResetText(e.target.value)} placeholder="RESET" className="w-full h-11 px-3 rounded-lg bg-white/5 border border-white/15 text-white text-center font-bold tracking-widest mb-4 focus:outline-none focus:border-red-400" />
                <div className="flex gap-2 justify-end">
                  <button disabled={resetBusy} onClick={() => setResetStep(0)} className="px-4 py-2 rounded-lg text-sm font-semibold text-white/70 bg-white/5 border border-white/15 hover:bg-white/10 disabled:opacity-50">Cancel</button>
                  <button disabled={resetText !== 'RESET' || resetBusy} onClick={async () => { setResetBusy(true); const ok = await onResetAllData(); setResetBusy(false); if (ok) setResetStep(0); }} className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2">
                    <Trash2 size={15} /> {resetBusy ? 'Resetting…' : 'Reset Everything'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}

// Phase 8.5 — collapsible left sidebar (desktop) / drawer (mobile).
const NAV_ITEMS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'suppliers', label: 'Suppliers', icon: Users },
  { id: 'sales', label: 'Sales', icon: ShoppingCart },
  { id: 'stockin', label: 'Stock In', icon: PackagePlus },
  { id: 'stockout', label: 'Stock Out', icon: Send },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, admin: true },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'alerts', label: 'Alerts', icon: AlertTriangle },
  { id: 'settings', label: 'Settings', icon: Settings },
];
function Sidebar({ activeTab, setActiveTab, collapsed, setCollapsed, mobileOpen, setMobileOpen, isAdmin, alertCount, status }) {
  const width = collapsed ? 72 : 280;
  const go = (id) => { setActiveTab(id); setMobileOpen(false); };
  const Item = ({ it }) => {
    const active = activeTab === it.id;
    return (
      <button onClick={() => go(it.id)} title={collapsed ? it.label : undefined}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition ${active ? 'bg-[#d4af37]/15 text-[#d4af37] font-semibold' : 'text-white/60 hover:bg-white/5 hover:text-white/90'}`}>
        <it.icon size={18} className="flex-shrink-0" />
        {!collapsed && <span className="flex-1 text-left truncate">{it.label}</span>}
        {!collapsed && it.id === 'alerts' && alertCount > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400">{alertCount}</span>}
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
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
        {NAV_ITEMS.filter((it) => !it.admin || isAdmin).map((it) => <Item key={it.id} it={it} />)}
      </nav>
      {!collapsed && (
        <button onClick={() => go('settings')} className="m-2 p-2.5 rounded-xl flex items-center gap-2 text-left hover:bg-white/5 transition" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }} title="Open Settings for full system info">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: status.color }} />
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-semibold leading-tight" style={{ color: status.color }}>{status.label}</span>
            <span className="block text-[10px] text-white/35 truncate">v{APP_VERSION} · {status.records} records</span>
          </span>
          <Settings size={13} className="text-white/25 flex-shrink-0" />
        </button>
      )}
      <button onClick={() => setCollapsed((v) => !v)} className="hidden md:flex items-center justify-center gap-2 m-2 py-2 rounded-lg text-xs text-white/40 hover:bg-white/5 hover:text-white/70">
        <ChevronDown size={14} className={collapsed ? '-rotate-90' : 'rotate-90'} /> {!collapsed && 'Collapse'}
      </button>
    </div>
  );
  return (
    <>
      {/* Desktop */}
      <aside className="hidden md:block fixed left-0 top-0 bottom-0 z-50 transition-all" style={{ width, background: '#0d0d0d', borderRight: '1px solid rgba(212,175,55,0.12)' }}>{inner}</aside>
      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-[60]">
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0" style={{ width: 280, background: '#0d0d0d', borderRight: '1px solid rgba(212,175,55,0.15)' }}>{inner}</aside>
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
  // Demo Admin may modify demo data; Demo User may not perform destructive actions.
  function protectedDemoToast() {
    toast(
      'Protected Demo Environment\nThis is a shared demo workspace. Delete, archive, restore, and reset actions are disabled to maintain a consistent experience for all users.',
      { icon: '🔒', duration: 5500, style: { maxWidth: 420 } }
    );
  }
  // Returns true (and shows the protected message) when the current actor is a
  // Demo USER attempting a destructive action. Demo Admin and production pass.
  function blockedDestructiveForDemoUser() {
    if (demoMode && !demoAdmin) { protectedDemoToast(); return true; }
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
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'inventory' | 'suppliers' | 'analytics'
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
  const [stockAdjustments, setStockAdjustments] = useState([]); // Task 8: ledger
  const [reorderRequests, setReorderRequests] = useState([]); // PO / reorder status
  // Alert state + derived counts — placed AFTER reorderRequests so it isn't
  // referenced before initialization (fixes the TDZ ReferenceError).
  const allAlerts = useMemo(() => computeAlerts(inventory, reorderRequests, connError), [inventory, reorderRequests, connError]);
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
  useEffect(() => { if (!showFilterSheet) return; __lockBody(); return () => __unlockBody(); }, [showFilterSheet]);
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
    if (fresh) { try { sessionStorage.removeItem('maruti_demo_inv'); sessionStorage.removeItem('maruti_demo_sup'); } catch {} }
    const readSaved = (key) => {
      if (fresh) return null;
      try { const s = sessionStorage.getItem(key); const a = s ? JSON.parse(s) : null; return Array.isArray(a) && a.length ? a : null; } catch { return null; }
    };
    if (scope === 'all' || scope === 'inventory') setInventory(readSaved('maruti_demo_inv') || d.parts);
    if (scope === 'all' || scope === 'suppliers') setSuppliers(readSaved('maruti_demo_sup') || d.suppliers);
    if (scope === 'all' || scope === 'sales') { setSales(d.sales); setRollups(d.salesRollups); }
    if (scope === 'all') { setRestocks(d.restocks); setStockAdjustments(d.stockAdjustments); setReorderRequests(d.reorderRequests); setCustomCategories(d.categories); setCustomVehicles(d.vehicles); }
    if (scope === 'all' || scope === 'alerts') setReorderRequests(d.reorderRequests);
    if (scope === 'all' || scope === 'audit') setAuditLog(d.auditLog);
    setLoading(false); setSuppliersLoading(false); setLastSync(new Date()); setConnError(null);
  }, []);
  useEffect(() => {
    if (!demoMode) return;
    applyDemoData('all');
  }, [demoMode, applyDemoData]);

  // Auto-save demo inventory/suppliers on every change so a refresh restores them.
  // imageString is stripped before saving (it's large base64 and is re-derived
  // from the part name in demo mode), keeping the payload well under quota.
  useEffect(() => {
    if (!demoMode || loading) return;
    try { sessionStorage.setItem('maruti_demo_inv', JSON.stringify(inventory.map(({ imageString, ...rest }) => rest))); } catch {}
  }, [inventory, demoMode, loading]);
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
    const q = query(collection(db, 'parts'), orderBy('createdAt', 'desc'));
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

  // ---- Sales ledger live subscription (powers the Monthly Profit Trend) ----
  // Capped to the most recent records for performance on large histories.
  useEffect(() => {
    if (demoMode) return;
    const q = query(collection(db, 'sales'), orderBy('createdAt', 'desc'), limit(2000));
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
    const q = query(collection(db, 'restocks'), orderBy('createdAt', 'desc'), limit(500));
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
    const q = query(collection(db, 'stockAdjustments'), orderBy('createdAt', 'desc'), limit(500));
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
    const q = query(collection(db, 'suppliers'), orderBy('name', 'asc'));
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
    try {
      await signOut(auth);
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
    if (demoMode) {
      if (!demoAdmin) { protectedDemoToast(); return; }
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
      const COLLECTIONS = ['parts', 'suppliers', 'categories', 'vehicles', 'sales', 'salesRollups', 'restocks', 'stockAdjustments', 'auditLog', 'reorderRequests'];
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
  const RECOVERY_COLLECTIONS = ['parts', 'suppliers', 'categories', 'vehicles', 'sales', 'salesRollups', 'restocks', 'stockAdjustments', 'auditLog', 'reorderRequests'];
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

  async function exportInventoryExcel() {
    if (inventory.length === 0) {
      toast.error('Nothing to export yet.');
      return;
    }
    try {
      // Lazy-load SheetJS only when needed so it never weighs down initial load.
      const XLSX = await import('xlsx');

      // Map state into clean, business-friendly rows for the worksheet.
      const rows = inventory.map((p) => {
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
      toast.success(`Exported ${inventory.length} part${inventory.length > 1 ? 's' : ''} to Excel`);
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
      toast.success(formData.id ? 'Part updated (demo)' : 'Part added (demo)');
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

      toast.success(formData.id ? 'Part updated' : copiedFrom ? 'Copy saved to Archive — restore it to activate' : 'Part added');
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
      if (!demoAdmin) { protectedDemoToast(); return; }
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
      if (!demoAdmin) { protectedDemoToast(); return; }
      const stamp = { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 };
      setInventory((prev) => prev.map((p) => (p.id === id ? { ...p, archived: true, archivedAt: stamp, archivedBy: actor } : p))); toast.success('Part archived (demo)'); return;
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
  }, [inventory, debouncedSearch, categoryFilter, invFilter, sortConfig, carVocab]);

  // ---- Inventory pagination (scales to thousands of parts; only the current
  // page is rendered). Rows-per-page selectable; resets to page 1 on filter. ----
  const [invPerPage, setInvPerPage] = useState(25);
  const [invPage, setInvPage] = useState(1);
  useEffect(() => { setInvPage(1); }, [debouncedSearch, categoryFilter, invFilter, invPerPage]);

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

  // On phones, the Add/Edit Part flow takes over the whole screen as a normal
  // in-flow page (native document scrolling) instead of a modal. This is rendered
  // INSTEAD of the dashboard while open; all dashboard state is preserved because
  // this component stays mounted. Desktop/tablet fall through to the modal below.
  if (showModal && isMobile) {
    return (
      <PartModal
        asPage
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
    );
  }

  return (
    <div className={`relative min-h-screen bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-gray-800 via-[#0a0a0a] to-black transition-all ${sidebarCollapsed ? 'md:pl-[72px]' : 'md:pl-[280px]'}`}>
      {demoMode && (
        <div className="sticky top-0 z-[90] flex items-center justify-center gap-3 px-4 py-2 text-center" style={{ background: 'linear-gradient(90deg,#d4af37,#aa801e)', color: '#1a1a1a' }}>
          <span className="text-xs sm:text-sm font-bold">{demoAdmin ? '🛠 DEMO ADMIN MODE — Managing Demo Dataset Only. Production inventory is completely isolated.' : '🧪 DEMO MODE — interactive sandbox. Add & edit freely; delete/reset are off. Resets on reload.'}</span>
          <button onClick={() => exitDemo && exitDemo()} className="text-[11px] sm:text-xs font-bold px-3 py-1 rounded-lg" style={{ background: 'rgba(0,0,0,0.25)', color: '#fff' }}>{demoAdmin ? 'Exit Demo Admin' : 'Exit Demo'}</button>
        </div>
      )}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
        mobileOpen={sidebarMobileOpen}
        setMobileOpen={setSidebarMobileOpen}
        isAdmin={isAdmin || demoMode}
        alertCount={unreadAlertCount}
        status={{
          color: connError ? '#ef4444' : online ? '#34d399' : '#ef4444',
          label: connError ? 'Connection Error' : online ? 'Connected' : 'Offline',
          lastSync: lastSync ? lastSync.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—',
          lastBackup: lastBackup ? new Date(lastBackup).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'Never',
          records: (inventory.length + suppliers.length + sales.length + restocks.length + auditLog.length).toLocaleString('en-IN'),
        }}
      />
      {/* Fix 1: subtle grid overlay adds depth over the gradient */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.7) 1px, transparent 1px)',
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
        style={{ background: 'rgba(10,10,10,0.85)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
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
                        <div className="absolute right-0 mt-1.5 w-60 z-[56] rounded-xl overflow-hidden shadow-2xl py-1.5" style={{ background: '#161616', border: '1px solid rgba(212,175,55,0.3)' }}>
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
                {activeTab !== 'overview' && (
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
            lastSync={lastSync}
            lastBackup={lastBackup}
            online={online}
            connError={connError}
            isAdmin={isAdmin}
            onNavigate={(tab, opts) => { setActiveTab(tab); if (opts?.lowStock) setInvFilter('low'); }}
            onAddPart={() => { setEditPart(null); setShowModal(true); }}
            onAddSupplier={() => { setEditSupplier(null); setShowSupplierModal(true); }}
            onImport={() => { if (demoMode) { toast('Bulk import isn\'t part of the demo — use "Add Part" to try adding items.', { icon: '🧪' }); return; } setShowImport(true); }}
            onReorder={(p) => requestReorder(p)}
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
                style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${active ? color + '80' : 'rgba(255,255,255,0.06)'}` }}
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
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
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

        {/* Table */}
        <div
          className="rounded-2xl overflow-hidden backdrop-blur-sm"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          {loading ? (
            <div className="p-10 flex flex-col items-center gap-3 text-white/40">
              <Loader2 size={24} className="animate-spin" />
              <span className="text-sm">Loading inventory…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 flex flex-col items-center gap-3 text-center">
              <PackageSearch size={32} className="text-white/20" />
              <p className="text-sm text-white/40">
                {inventory.length === 0 ? 'No parts yet. Click "Add Part" to get started.' : 'No parts match your search.'}
              </p>
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
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
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
                      style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', boxShadow: part.id === highlightPartId ? 'inset 0 0 0 2px rgba(212,175,55,0.55)' : 'none' }}
                    >
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
                          {canDelete && !part.archived && (
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
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 mt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center gap-2 text-xs text-white/40">
                  <span>Rows:</span>
                  <select
                    value={invPerPage}
                    onChange={(e) => setInvPerPage(Number(e.target.value))}
                    className="bg-white/5 border border-white/15 rounded-lg px-2 py-1 text-white/80 focus:outline-none focus:border-[#d4af37]/50"
                  >
                    {[10, 25, 50, 100].map((n) => <option key={n} value={n} style={{ background: '#1a1a1a' }}>{n}</option>)}
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

        {activeTab === 'suppliers' && (
          <>
            <SuppliersView
              suppliers={suppliers}
              inventory={inventory}
              loading={suppliersLoading}
              isAdmin={canManageData}
              onEdit={(s) => {
                setEditSupplier(s);
                setShowSupplierModal(true);
              }}
              onDelete={canManageData ? handleSupplierDelete : undefined}
              onArchive={canManageData ? handleSupplierArchive : undefined}
              onRestore={canManageData ? handleSupplierRestore : undefined}
              onJumpToPart={(id, name) => {
                // #1/#3: open inventory and GUARANTEE the referenced record shows —
                // even if it's archived. Clear every other filter and use the 'all'
                // archive view so active OR archived supplier parts are both found,
                // then search by exact name and highlight + scroll to the row by id.
                setActiveTab('inventory');
                setCategoryFilter('All');
                setInvFilter('all');
                setSearch(name || '');
                setHighlightPartId(id || null);
              }}
            />
            <p className="text-xs text-white/30 mt-3">
              {(() => {
                const arch = suppliers.filter((s) => s.archived).length;
                const act = suppliers.length - arch;
                return `${act} active supplier${act === 1 ? '' : 's'}${arch ? ` · ${arch} archived` : ''} on record`;
              })()}
            </p>
          </>
        )}

        {activeTab === 'analytics' && isAdmin && (
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
        {activeTab === 'stockin' && <StockInView restocks={restocks} />}
        {activeTab === 'stockout' && <StockOutView sales={sales} stockAdjustments={stockAdjustments} />}
        {activeTab === 'reports' && (
          <ReportsView
            isAdmin={canManageData || demoMode}
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
                <button onClick={() => exitDemo && exitDemo()} className="mt-3 px-4 py-2 rounded-xl text-xs font-bold bg-white/5 border border-white/15 text-white/70 hover:bg-white/10">Exit Demo Admin</button>
              </>
            )}
          </div>
        )}
      </main>

      {showModal && (
        <PartModal
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
          <div className="w-full max-w-sm rounded-2xl p-5" style={{ background: '#0f0f0f', border: '1px solid rgba(245,158,11,0.4)' }} onClick={(e) => e.stopPropagation()}>
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
          <div className="w-full max-w-sm rounded-2xl p-5" style={{ background: '#0f0f0f', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
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
          onClose={() => setShowImport(false)}
        />
      )}

      <CommandPalette
        open={cmdkOpen}
        onClose={() => setCmdkOpen(false)}
        inventory={inventory}
        suppliers={suppliers}
        onPickPart={(p) => { setEditPart(p); setShowModal(true); }}
        onPickSupplier={() => setActiveTab('suppliers')}
        onPickCategory={(c) => { setActiveTab('inventory'); setCategoryFilter(c); }}
        onPickVehicle={(v) => { setActiveTab('inventory'); setSearch(v); }}
      />

      {/* Restore safety: never executes immediately — user must type RESTORE. */}
      {restoreConfirm && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(6px)' }} onClick={() => { setRestoreConfirm(false); pendingRestoreFile.current = null; }}>
          <div className="w-full max-w-md rounded-2xl p-5" style={{ background: '#121212', border: '1px solid rgba(239,68,68,0.35)' }} onClick={(e) => e.stopPropagation()}>
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
          <div className="w-full rounded-t-3xl p-4 pb-6 max-h-[80vh] overflow-y-auto" style={{ background: '#0f0f0f', border: '1px solid rgba(255,255,255,0.08)' }} onClick={(e) => e.stopPropagation()}>
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
      {reorderChoice && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setReorderChoice(null)}>
          <div className="w-full max-w-sm rounded-2xl p-5" style={{ background: '#0f0f0f', border: '1px solid rgba(212,175,55,0.25)' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-white mb-1">Choose Supplier</h3>
            <p className="text-xs text-white/50 mb-4">{reorderChoice.part.name} has multiple suppliers. Select one for this reorder.</p>
            <div className="space-y-2">
              {reorderChoice.suppliers.map((sup, i) => (
                <button
                  key={sup.id || i}
                  onClick={() => { logReorderRequest(reorderChoice.part, sup); setReorderChoice(null); }}
                  className="w-full text-left px-3 py-2.5 rounded-xl flex items-center justify-between hover:bg-white/5 transition"
                  style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${sup.isPreferred ? 'rgba(212,175,55,0.4)' : 'rgba(255,255,255,0.1)'}` }}
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
    </div>
  );
}
