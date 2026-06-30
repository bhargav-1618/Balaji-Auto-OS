// lib/demoData.js
import { imageForPartName } from './partImages';
// Self-contained, in-memory demo dataset for Guest Demo mode.
// Generated deterministically (seeded) so every visitor sees the same realistic
// shop. NEVER touches Firestore — this keeps demo traffic at zero database cost
// and fully isolated from production data, so any number of LinkedIn visitors
// can explore simultaneously with no load on the real system.

// --- tiny seeded RNG so the dataset is stable across reloads ---
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260623);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (lo, hi) => Math.floor(rnd() * (hi - lo + 1)) + lo;
const daysAgo = (n) => new Date(Date.now() - n * 86400000);
const ts = (d) => ({ seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0, toDate: () => d, toMillis: () => d.getTime() });

const PART_TYPES = [
  { name: 'Brake Pads', cat: 'Brake Pad', buy: 900, sell: 1450 },
  { name: 'Engine Oil 5W-30', cat: 'Lubricant', buy: 420, sell: 690 },
  { name: 'Air Filter', cat: 'Filter', buy: 180, sell: 320 },
  { name: 'Cabin Filter', cat: 'Filter', buy: 220, sell: 390 },
  { name: 'Spark Plug', cat: 'Ignition', buy: 110, sell: 210 },
  { name: 'Car Battery 35Ah', cat: 'Battery', buy: 3200, sell: 4500 },
  { name: 'Coolant 1L', cat: 'Lubricant', buy: 160, sell: 280 },
  { name: 'Wiper Blade', cat: 'Accessory', buy: 140, sell: 260 },
  { name: 'Timing Belt', cat: 'Engine', buy: 850, sell: 1350 },
  { name: 'Clutch Plate', cat: 'Transmission', buy: 1900, sell: 2900 },
  { name: 'Oil Filter', cat: 'Filter', buy: 130, sell: 240 },
  { name: 'Headlight Assembly', cat: 'Electrical', buy: 1600, sell: 2450 },
  { name: 'Fuel Pump', cat: 'Engine', buy: 2100, sell: 3200 },
  { name: 'Radiator', cat: 'Engine', buy: 2800, sell: 4100 },
  { name: 'Shock Absorber', cat: 'Suspension', buy: 1400, sell: 2200 },
  { name: 'Alternator', cat: 'Electrical', buy: 3400, sell: 4900 },
  { name: 'Brake Disc', cat: 'Brake Pad', buy: 1100, sell: 1750 },
  { name: 'Drive Belt', cat: 'Engine', buy: 320, sell: 540 },
  { name: 'Horn', cat: 'Electrical', buy: 240, sell: 420 },
  { name: 'Side Mirror', cat: 'Accessory', buy: 520, sell: 840 },
];
const BRANDS = ['Maruti', 'Hyundai', 'Tata', 'Mahindra', 'Honda', 'Toyota', 'Kia', 'Renault'];
const MODELS = { Maruti: ['Swift', 'Baleno', 'Dzire', 'WagonR', 'Brezza'], Hyundai: ['i20', 'Creta', 'Venue', 'Verna'], Tata: ['Nexon', 'Punch', 'Altroz'], Mahindra: ['XUV300', 'Scorpio', 'Thar'], Honda: ['City', 'Amaze'], Toyota: ['Innova', 'Glanza'], Kia: ['Seltos', 'Sonet'], Renault: ['Kwid', 'Triber'] };
const SUPPLIER_NAMES = ['Sri Venkateswara Auto', 'Balaji Spares', 'Anand Motors', 'Krishna Auto Parts', 'Sai Distributors', 'Lakshmi Traders', 'MG Auto World', 'Ganesh Spares', 'Apex Components', 'Vijaya Auto', 'Surya Parts', 'Teja Distributors', 'Ravi Auto Agencies', 'National Spares', 'City Auto Hub', 'Sri Sai Lubricants', 'Reliable Bearings', 'United Filters', 'Prime Battery Co', 'Speedway Spares', 'Deccan Auto Traders', 'Sri Durga Motors', 'Annapurna Spares', 'Kompally Auto Parts', 'Eastern Components', 'Sri Ram Distributors', 'Vizag Auto Hub', 'Pioneer Spares', 'Galaxy Lubricants', 'Hanuman Auto Agency', 'Bharat Brake Systems', 'Roadmaster Filters', 'Shakti Lubricants', 'Volt Electricals', 'PowerCell Batteries', 'Spectra Auto Spares', 'Trinity Bearings', 'Highway Auto Parts', 'Maruti Genuine Hub', 'Sri Lakshmi Auto', 'Venkat Spare Center', 'Gajanan Motors', 'Blue Diamond Spares', 'Royal Auto Traders', 'Sai Krupa Components', 'Metro Parts Depot', 'Apex Auto Hyderabad', 'Sri Vinayaka Spares', 'Kaveri Auto Agency', 'Sundar Lubricants', 'Precision Auto Parts', 'Sri Balaji Distributors', 'Telangana Auto Hub', 'Sri Chakra Spares', 'Nandi Motors', 'Vasavi Auto Traders'];
const BINS = ['Rack 1, Shelf A', 'Rack 1, Shelf B', 'Rack 2, Shelf A', 'Rack 2, Shelf C', 'Rack 3, Shelf B', 'Rack 4, Shelf A', 'Counter Drawer', 'Back Store 1', 'Back Store 2', ''];

// --- Category icon thumbnails (inline SVG data URIs) ---------------------------
// Every demo part gets a relevant, recognizable image with zero network calls
// and zero broken thumbnails. White glyph on a category-tinted rounded tile.
function svgIcon(glyph, bg) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='${bg}'/><g fill='none' stroke='#fff' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'>${glyph}</g></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
const CATEGORY_ICONS = {
  'Brake Pad': svgIcon("<circle cx='32' cy='32' r='15'/><circle cx='32' cy='32' r='5' fill='#fff'/><path d='M44 22 h6 v20 h-6'/>", '#b45309'),
  'Lubricant': svgIcon("<path d='M32 16 C24 30 22 37 32 46 C42 37 40 30 32 16 Z' fill='#fff' stroke='none'/>", '#0e7490'),
  'Filter': svgIcon("<rect x='22' y='16' width='20' height='32' rx='4'/><path d='M22 26 h20 M22 34 h20 M22 42 h20'/>", '#15803d'),
  'Ignition': svgIcon("<path d='M32 14 v10 M27 24 h10 v8 l-3 6 h-4 l-3 -6 z M32 44 v6'/>", '#a16207'),
  'Battery': svgIcon("<rect x='16' y='26' width='32' height='18' rx='2'/><path d='M22 26 v-4 h6 v4 M36 26 v-4 h6 v4'/><path d='M26 35 h6 M29 32 v6 M37 35 h4'/>", '#4d7c0f'),
  'Engine': svgIcon("<circle cx='32' cy='32' r='9'/><path d='M32 16 v6 M32 42 v6 M16 32 h6 M42 32 h6 M21 21 l4 4 M39 39 l4 4 M43 21 l-4 4 M25 39 l-4 4'/>", '#6d28d9'),
  'Transmission': svgIcon("<circle cx='32' cy='32' r='9'/><path d='M32 16 v6 M32 42 v6 M16 32 h6 M42 32 h6 M21 21 l4 4 M39 39 l4 4 M43 21 l-4 4 M25 39 l-4 4'/>", '#7c3aed'),
  'Electrical': svgIcon("<path d='M34 14 L22 36 h10 l-2 14 L42 28 H32 z' fill='#fff' stroke='none'/>", '#b91c1c'),
  'Suspension': svgIcon("<path d='M32 14 v6 M24 22 h16 M24 28 h16 M24 34 h16 M24 40 h16 M32 44 v6'/>", '#1d4ed8'),
  'Accessory': svgIcon("<path d='M18 44 L40 22 l4 4 L22 48 z'/><path d='M40 22 l3 -3 a3 3 0 0 1 4 4 l-3 3'/>", '#be185d'),
};
function iconFor(cat) { return CATEGORY_ICONS[cat] || svgIcon("<circle cx='32' cy='32' r='14'/>", '#475569'); }

function genSuppliers() {
  return SUPPLIER_NAMES.map((name, i) => ({
    id: `demo-sup-${i + 1}`,
    name,
    contactPerson: pick(['Ramesh', 'Suresh', 'Anil', 'Kiran', 'Mahesh', 'Naveen']),
    phone: `9${between(100000000, 999999999)}`,
    email: `${name.toLowerCase().replace(/[^a-z]/g, '')}@example.com`,
    gstin: `36ABCDE${between(1000, 9999)}F1Z5`,
    address: `${pick(['Gajuwaka', 'Madhurawada', 'Dwaraka Nagar', 'NAD Junction'])}, Visakhapatnam`,
    createdAt: ts(daysAgo(between(120, 400))),
  }));
}

function genParts(suppliers) {
  const parts = [];
  let n = 1;
  for (const type of PART_TYPES) {
    const variants = between(7, 10); // ~150-180 parts total
    for (let v = 0; v < variants; v++) {
      const brand = pick(BRANDS);
      const model = pick(MODELS[brand]);
      const buy = Math.round(type.buy * (0.9 + rnd() * 0.3));
      const sell = Math.round(type.sell * (0.92 + rnd() * 0.25));
      const stock = between(0, 40);
      const minStock = between(3, 8);
      parts.push({
        id: `demo-part-${n}`,
        name: `${brand} ${model} ${type.name}`,
        sku: `${type.cat.slice(0, 3).toUpperCase()}-${brand.slice(0, 2).toUpperCase()}-${String(n).padStart(3, '0')}`,
        category: type.cat,
        categories: [type.cat],
        compatibleCars: `${brand} ${model}`,
        vehicle: brand,
        locationBin: pick(BINS),
        stock,
        minStock,
        purchasePrice: buy,
        sellingPrice: sell,
        minSellingPrice: Math.round(buy * 1.1),
        salesCount: between(0, 120),
        suppliers: [], // assigned by assignSuppliers() with realistic distribution
        imageString: imageForPartName(`${brand} ${model} ${type.name}`),
        archived: n % 3 === 0, // ~1/3 archived → populates the Archive view (50+)
        archivedAt: n % 3 === 0 ? ts(daysAgo(between(1, 60))) : null,
        archivedBy: n % 3 === 0 ? (n % 6 === 0 ? 'demo-admin@balajiautoos.com' : 'owner@balajiautoos.com') : null,
        createdAt: ts(daysAgo(between(30, 380))),
        updatedAt: ts(daysAgo(between(0, 29))),
      });
      n++;
    }
  }
  return parts;
}

function genSales(parts) {
  const sales = [];
  const count = between(1000, 1100);
  for (let i = 0; i < count; i++) {
    const p = pick(parts);
    const qty = between(1, 4);
    const price = p.sellingPrice;
    const unitCost = p.purchasePrice;
    const revenue = qty * price;
    const cost = qty * unitCost;
    const d = daysAgo(between(0, 90));
    sales.push({
      id: `demo-sale-${i + 1}`,
      partId: p.id,
      name: p.name, partName: p.name,            // app reads s.name; partName kept as alias
      sku: p.sku,
      category: p.category, brands: [p.vehicle],
      qty, quantity: qty,                        // app reads s.qty
      unitPrice: price, unitCost, costPrice: unitCost,
      revenue, total: revenue, totalPrice: revenue, // app variously reads revenue/total/totalPrice
      cost,
      profit: revenue - cost,
      createdAt: ts(d),
    });
  }
  return sales.sort((a, b) => b.createdAt.seconds - a.createdAt.seconds);
}

function genRestocks(parts, suppliers) {
  const out = [];
  const count = between(500, 560);
  const supById = Object.fromEntries(suppliers.map((s) => [s.id, s]));
  for (let i = 0; i < count; i++) {
    const p = pick(parts);
    const qty = between(5, 30);
    const sup = supById[p.suppliers[0]?.id] || pick(suppliers);
    const unitCost = p.purchasePrice;
    out.push({
      id: `demo-rs-${i + 1}`,
      partId: p.id, name: p.name, partName: p.name, sku: p.sku,
      qty, quantity: qty,
      unitCost, total: qty * unitCost,
      supplier: sup?.name || '', supplierName: sup?.name || '', supplierId: sup?.id || null,
      byEmail: 'demo@balajiautoos.com',
      createdAt: ts(daysAgo(between(0, 120))),
    });
  }
  return out.sort((a, b) => b.createdAt.seconds - a.createdAt.seconds);
}

function genAdjustments(parts) {
  const reasons = ['Damage', 'Stock count correction', 'Personal use', 'Lost item', 'Warranty return'];
  const out = [];
  const count = between(500, 560);
  for (let i = 0; i < count; i++) {
    const p = pick(parts);
    const mag = between(1, 5);
    const reduce = rnd() > 0.4;
    const signedQty = reduce ? -mag : mag;
    out.push({
      id: `demo-adj-${i + 1}`,
      partId: p.id, name: p.name, partName: p.name, sku: p.sku,
      qty: signedQty, quantity: signedQty,
      reason: pick(reasons), notes: '',
      byEmail: 'demo@balajiautoos.com',
      createdAt: ts(daysAgo(between(0, 120))),
    });
  }
  return out.sort((a, b) => b.createdAt.seconds - a.createdAt.seconds);
}

function genReorders(parts, suppliers) {
  const low = parts.filter((p) => p.stock <= p.minStock).slice(0, 12);
  const statuses = ['Requested', 'Awaiting Delivery', 'Delivered'];
  const supById = Object.fromEntries(suppliers.map((s) => [s.id, s]));
  return low.map((p, i) => {
    const sup = supById[p.suppliers[0]?.id] || suppliers[i % suppliers.length];
    const qty = Math.max((p.minStock * 2) - p.stock, p.minStock);
    return {
      id: `demo-ro-${i + 1}`,
      partId: p.id, partName: p.name, name: p.name, sku: p.sku,
      qty, quantity: qty,
      supplierId: sup?.id || null, supplierName: sup?.name || '—', supplier: sup?.name || '—',
      status: pick(statuses),
      createdAt: ts(daysAgo(between(0, 20))),
    };
  });
}

function genRollups(sales) {
  const map = {};
  for (const s of sales) {
    const d = new Date(s.createdAt.seconds * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!map[key]) map[key] = { id: key, month: key, revenue: 0, profit: 0, count: 0 };
    map[key].revenue += s.totalPrice; map[key].profit += s.profit; map[key].count += s.quantity;
  }
  return Object.values(map).sort((a, b) => (a.month < b.month ? 1 : -1));
}

function genAuditLog() {
  const actions = ['Created part', 'Updated stock', 'Recorded sale', 'Received stock', 'Edited supplier', 'Adjusted inventory'];
  return Array.from({ length: 520 }, (_, i) => ({ id: `demo-au-${i + 1}`, action: pick(actions), detail: 'Demo activity', user: 'demo@guest', createdAt: ts(daysAgo(between(0, 30))) }));
}

let _cache = null;
// Assigns parts to suppliers with a REALISTIC distribution + category coherence:
// most suppliers carry 4–8 parts, a few are large (13–18), each specializes in a
// small set of categories (brake supplier → brake parts, etc.). Every part ends
// with 1–2 suppliers; no two suppliers have identical inventories.
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function assignSuppliers(parts, suppliers) {
  const byCat = {};
  parts.forEach((p) => { (byCat[p.category] = byCat[p.category] || []).push(p); });
  const cats = Object.keys(byCat);
  parts.forEach((p) => { p.suppliers = []; });

  const targetSize = () => {
    const r = rnd();
    if (r < 0.38) return between(2, 5);    // small — ~21 suppliers
    if (r < 0.74) return between(6, 10);   // medium — ~20 suppliers
    if (r < 0.96) return between(11, 18);  // large — ~12 suppliers
    return between(20, 30);                // major distributor — only ~2
  };
  const HARD_CAP = 30; // a major distributor may carry up to ~30 parts
  const count = new Map(); // supplierId -> current part count
  const mkRef = (sup, isPrimary) => ({ id: sup.id, name: sup.name, phone: sup.phone || '', preferredLabel: isPrimary ? 'Primary' : 'Secondary', isPreferred: isPrimary });
  const give = (sup, p) => {
    // Up to 3 suppliers per part (primary + two alternates) — realistic for a
    // popular part, and enough link capacity for ~56 suppliers over ~165 parts.
    if (p.suppliers.length >= 3 || p.suppliers.some((s) => s.id === sup.id)) return false;
    if ((count.get(sup.id) || 0) >= HARD_CAP) return false;
    p.suppliers.push(mkRef(sup, p.suppliers.length === 0));
    count.set(sup.id, (count.get(sup.id) || 0) + 1);
    return true;
  };

  suppliers.forEach((sup) => {
    sup._target = targetSize();
    const nCats = sup._target > 18 ? 4 : sup._target > 12 ? 3 : sup._target > 8 ? 2 : (rnd() > 0.5 ? 2 : 1);
    sup._cats = shuffle(cats).slice(0, nCats);
    count.set(sup.id, 0);
  });

  // Primary pass: fill each supplier from its specialty categories up to target.
  suppliers.forEach((sup) => {
    const pool = shuffle(sup._cats.flatMap((c) => byCat[c] || []));
    for (const p of pool) { if ((count.get(sup.id) || 0) >= sup._target) break; give(sup, p); }
  });

  // Minimum guarantee: no supplier should be empty — give stragglers 2–4 parts.
  // Try specialty first, then ANY part, so a saturated specialty can't leave a
  // supplier at zero.
  suppliers.forEach((sup) => {
    if ((count.get(sup.id) || 0) >= 2) return;
    const need = between(2, 4);
    const specialty = sup._cats.flatMap((c) => byCat[c] || []);
    const pool = shuffle(specialty).concat(shuffle(parts));
    for (const p of pool) { if ((count.get(sup.id) || 0) >= need) break; give(sup, p); }
  });

  // Orphan pass: every part needs ≥1 supplier; give it to the LEAST-loaded
  // category-matching supplier (load balancing, respects the hard cap).
  parts.forEach((p) => {
    if (p.suppliers.length > 0) return;
    let cand = suppliers.filter((s) => (s._cats || []).includes(p.category) && (count.get(s.id) || 0) < HARD_CAP);
    if (!cand.length) cand = suppliers.filter((s) => (count.get(s.id) || 0) < HARD_CAP);
    if (!cand.length) cand = suppliers;
    cand.sort((a, b) => (count.get(a.id) || 0) - (count.get(b.id) || 0));
    give(cand[0], p);
  });

  suppliers.forEach((s) => { delete s._target; delete s._cats; });
}

export function getDemoData() {
  if (_cache) return _cache;
  const suppliers = genSuppliers();
  const parts = genParts(suppliers);
  assignSuppliers(parts, suppliers); // realistic distribution + category coherence
  const sales = genSales(parts);
  const restocks = genRestocks(parts, suppliers);
  const stockAdjustments = genAdjustments(parts);
  const reorderRequests = genReorders(parts, suppliers);
  const salesRollups = genRollups(sales);
  const auditLog = genAuditLog();
  const categories = [...new Set(parts.map((p) => p.category))].map((c, i) => ({ id: `demo-cat-${i}`, name: c }));
  const vehicles = BRANDS.map((b, i) => ({ id: `demo-veh-${i}`, name: b }));
  _cache = { parts, suppliers, sales, restocks, stockAdjustments, reorderRequests, salesRollups, auditLog, categories, vehicles };
  return _cache;
}
