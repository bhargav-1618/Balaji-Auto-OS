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
// Generic consumables usable across all vehicles (no brand prefix).
const GENERIC_PARTS = [
  { name: 'Engine Oil 5W-30', cat: 'Lubricant', buy: 420, sell: 690, unit: 'litre' },
  { name: 'Engine Oil 5W-40', cat: 'Lubricant', buy: 460, sell: 740, unit: 'litre' },
  { name: 'Engine Oil 10W-30', cat: 'Lubricant', buy: 400, sell: 660, unit: 'litre' },
  { name: 'Coolant 1L', cat: 'Lubricant', buy: 160, sell: 280, unit: 'litre' },
  { name: 'Brake Fluid DOT4', cat: 'Lubricant', buy: 190, sell: 330, unit: 'litre' },
  { name: 'Gear Oil', cat: 'Lubricant', buy: 320, sell: 520, unit: 'litre' },
  { name: 'Transmission Oil', cat: 'Lubricant', buy: 480, sell: 780, unit: 'litre' },
  { name: 'Grease', cat: 'Lubricant', buy: 90, sell: 180, unit: 'kg' },
  { name: 'Distilled Water', cat: 'Consumable', buy: 20, sell: 50, unit: 'litre' },
];
const SUPPLIER_NAMES = ['Sri Venkateswara Auto', 'Balaji Spares', 'Anand Motors', 'Krishna Auto Parts', 'Sai Distributors', 'Lakshmi Traders', 'MG Auto World', 'Ganesh Spares', 'Apex Components', 'Vijaya Auto', 'Surya Parts', 'Teja Distributors', 'Ravi Auto Agencies', 'National Spares', 'City Auto Hub', 'Sri Sai Lubricants', 'Reliable Bearings', 'United Filters', 'Prime Battery Co', 'Speedway Spares', 'Deccan Auto Traders', 'Sri Durga Motors', 'Annapurna Spares', 'Kompally Auto Parts', 'Eastern Components', 'Sri Ram Distributors', 'Vizag Auto Hub', 'Pioneer Spares', 'Galaxy Lubricants', 'Hanuman Auto Agency', 'Bharat Brake Systems', 'Roadmaster Filters', 'Shakti Lubricants', 'Volt Electricals', 'PowerCell Batteries', 'Spectra Auto Spares', 'Trinity Bearings', 'Highway Auto Parts', 'Maruti Genuine Hub', 'Sri Lakshmi Auto', 'Venkat Spare Center', 'Gajanan Motors', 'Blue Diamond Spares', 'Royal Auto Traders', 'Sai Krupa Components', 'Metro Parts Depot', 'Apex Auto Hyderabad', 'Sri Vinayaka Spares', 'Kaveri Auto Agency', 'Sundar Lubricants', 'Precision Auto Parts', 'Sri Balaji Distributors', 'Telangana Auto Hub', 'Sri Chakra Spares', 'Nandi Motors', 'Vasavi Auto Traders',
  'Sri Sai Auto Point', 'Jai Bharat Spares', 'Maruthi Auto Agency', 'Sri Venkatesa Motors', 'Kalyan Auto Parts', 'Sneha Distributors', 'Krishna Bearings', 'Om Sai Lubricants', 'Sri Padmavathi Spares', 'Manjunatha Auto', 'Balaji Battery House', 'Sri Rama Auto Traders', 'Guru Auto Components', 'Sagar Spare Parts', 'Amruta Motors', 'Sri Devi Auto', 'Chaitanya Distributors', 'Vishnu Auto Spares', 'Sri Ganesh Tyres', 'Laxmi Narasimha Auto', 'Prasad Auto Agency', 'Sri Saibaba Spares', 'Konark Auto Parts', 'Suprabhat Motors', 'Sri Anjaneya Auto', 'Divya Auto Components', 'Sri Krishna Lubricants', 'Yadagiri Auto Parts', 'Sri Shirdi Spares', 'Mahalakshmi Motors', 'Sri Venkateswara Tyres', 'Ravindra Auto Agency', 'Sri Vijaya Distributors', 'Bhavani Auto Parts', 'Sri Kanaka Durga Spares', 'Ramky Auto Traders', 'Sri Tirumala Motors', 'Pavan Auto Components', 'Sri Bhramaramba Spares', 'Karthikeya Auto', 'Sri Malleswara Parts', 'Anand Battery Zone', 'Sri Raghavendra Auto', 'Deepthi Distributors', 'Sri Satya Sai Spares', 'Vamsi Auto Parts', 'Sri Lakshmi Ganapathi Auto', 'Charan Auto Agency', 'Sri Vasavi Motors', 'Harsha Auto Components', 'Sri Kalahasti Spares', 'Naveen Auto Traders', 'Sri Durga Bhavani Auto', 'Kishore Spare Center', 'Sri Ramalingeswara Parts', 'Vinayaka Battery House', 'Sri Peddamma Auto', 'Rajesh Auto Agency', 'Sri Ankalamma Spares', 'Teja Auto Components', 'Sri Poleramma Motors', 'Ganga Auto Parts', 'Sri Nookalamma Spares', 'Suresh Auto Traders', 'Sri Kanyaka Parameswari Auto', 'Mohan Auto Agency', 'Sri Gangamma Spares', 'Kiran Auto Point', 'Sri Mutyalamma Motors', 'Bhaskar Auto Parts', 'Sri Sunkulamma Auto', 'Ramesh Spare Center', 'Sri Bangaramma Spares', 'Naga Auto Traders', 'Sri Maremma Auto', 'Venu Auto Components', 'Sri Ellamma Motors', 'Krishna Auto Point', 'Sri Perantalamma Spares'];
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

// Real & well-known Indian auto brands + fictional local suppliers (Part 5).
const BRAND_SUPPLIERS = [
  ['MGP Auto Spares', 'Authorized OEM Dealer'], ['Bosch India Limited', 'Manufacturer'], ['Exide Battery Distributor', 'Battery Dealer'],
  ['Amaron Battery Zone', 'Battery Dealer'], ['Castrol Lubricants', 'Lubricant Distributor'], ['Mobil Oil Distributors', 'Lubricant Distributor'],
  ['Shell India Lubricants', 'Lubricant Distributor'], ['JK Tyre Dealer', 'Tyre Dealer'], ['MRF Tyres Hub', 'Tyre Dealer'],
  ['Apollo Tyres Point', 'Tyre Dealer'], ['Ceat Tyre Distributor', 'Tyre Dealer'], ['TVS Auto Parts', 'Wholesale Distributor'],
  ['Lumax Auto Electricals', 'Electrical Parts Dealer'], ['Valeo India', 'Manufacturer'], ['Subros AC Systems', 'Accessories Dealer'],
  ['Denso Auto Parts', 'Manufacturer'], ['Schaeffler Bearings', 'Manufacturer'], ['Mahle Filters India', 'Manufacturer'],
];
const SUPPLIER_CITIES = [['Hyderabad', 'Telangana', '36'], ['Vijayawada', 'Andhra Pradesh', '37'], ['Visakhapatnam', 'Andhra Pradesh', '37'], ['Guntur', 'Andhra Pradesh', '37'], ['Bangalore', 'Karnataka', '29'], ['Chennai', 'Tamil Nadu', '33'], ['Mumbai', 'Maharashtra', '27'], ['Pune', 'Maharashtra', '27'], ['Delhi', 'Delhi', '07'], ['Ahmedabad', 'Gujarat', '24']];
const SUP_TYPES_SEED = ['Authorized OEM Dealer', 'Local Spare Parts Dealer', 'Lubricant Distributor', 'Battery Dealer', 'Tyre Dealer', 'Accessories Dealer', 'Electrical Parts Dealer', 'Body Parts Dealer', 'Wholesale Distributor', 'Retail Dealer', 'Manufacturer'];

function genSuppliers() {
  const all = [...BRAND_SUPPLIERS.map(([name, type]) => ({ name, type })), ...SUPPLIER_NAMES.map((name) => ({ name, type: pick(SUP_TYPES_SEED) }))];
  return all.map(({ name, type }, i) => {
    const [city, state, code] = pick(SUPPLIER_CITIES);
    // ~15% non-GST (unregistered local suppliers) per the business rule
    const hasGst = rnd() > 0.15;
    const status = rnd() > 0.94 ? 'Blocked' : rnd() > 0.9 ? 'Inactive' : 'Active';
    return {
      id: `demo-sup-${i + 1}`,
      name,
      code: `SUP${String(i + 1).padStart(3, '0')}`,
      type,
      contactPerson: `${pick(['Ramesh', 'Suresh', 'Anil', 'Kiran', 'Mahesh', 'Naveen', 'Praveen', 'Srinivas'])} ${pick(['Reddy', 'Kumar', 'Rao', 'Sharma', 'Naidu'])}`,
      phone: `9${between(100000000, 999999999)}`,
      whatsapp: `9${between(100000000, 999999999)}`,
      email: `${name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 16)}@example.com`,
      website: rnd() > 0.6 ? `www.${name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 14)}.in` : '',
      gst: hasGst ? `${code}${String.fromCharCode(65 + between(0, 25))}${String.fromCharCode(65 + between(0, 25))}${String.fromCharCode(65 + between(0, 25))}${String.fromCharCode(65 + between(0, 25))}${between(1000, 9999)}${String.fromCharCode(65 + between(0, 25))}1Z${between(1, 9)}` : '',
      pan: hasGst ? `${String.fromCharCode(65 + between(0, 25))}${String.fromCharCode(65 + between(0, 25))}${String.fromCharCode(65 + between(0, 25))}${String.fromCharCode(65 + between(0, 25))}${String.fromCharCode(65 + between(0, 25))}${between(1000, 9999)}${String.fromCharCode(65 + between(0, 25))}` : '',
      gstin: hasGst ? `${code}ABCDE${between(1000, 9999)}F1Z5` : '', // legacy mirror
      address: `${pick(['Auto Nagar', 'Industrial Estate', 'Main Road', 'Market Yard', 'MG Road'])}, ${city}`,
      city, state, district: city, pincode: `5${between(10000, 99999)}`,
      preferred: BRAND_SUPPLIERS.some(([bn]) => bn === name) || rnd() > 0.8,
      status,
      paymentMode: pick(['Cash', 'UPI', 'Bank Transfer', 'Credit']),
      creditDays: pick(['', '7', '15', '30', '45']),
      openingBalance: pick([0, 0, between(5000, 50000)]),
      // Supplier performance (demo-only, deterministic). Absent in production until captured.
      rating: +(3.9 + rnd() * 1.1).toFixed(1), // 3.9–5.0
      ratingCount: between(38, 168),
      leadTimeDays: +(1.6 + rnd() * 3.2).toFixed(1), // ~1.6–4.8 days
      onTimePct: between(82, 98),
      orderAccuracyPct: between(88, 99),
      outstanding: pick([0, 0, 0, between(2500, 46000)]),
      creditLimit: pick([50000, 75000, 100000, 150000]),
      createdAt: ts(daysAgo(between(120, 400))),
    };
  });
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
  // Generic, vehicle-agnostic consumables (usable across every make/model). These
  // are deliberately NOT brand-prefixed — a workshop stocks one "Engine Oil 5W-30",
  // not a Maruti-specific one. Manufacturer-specific spares above keep their names.
  for (const g of GENERIC_PARTS) {
    const buy = g.buy, sell = g.sell;
    parts.push({
      id: `demo-part-${n}`,
      name: g.name,
      sku: `GEN-${String(n).padStart(3, '0')}`,
      category: g.cat,
      categories: [g.cat],
      compatibleCars: 'Universal / All vehicles',
      vehicle: 'Universal',
      unit: g.unit || '',
      locationBin: pick(BINS),
      stock: between(15, 60),
      minStock: between(5, 12),
      purchasePrice: buy,
      sellingPrice: sell,
      minSellingPrice: Math.round(buy * 1.1),
      salesCount: between(20, 200),
      suppliers: [],
      imageString: imageForPartName(g.name),
      archived: false,
      createdAt: ts(daysAgo(between(30, 380))),
      updatedAt: ts(daysAgo(between(0, 29))),
      generic: true,
    });
    n++;
  }
  return parts;
}

const GARAGE_SERVICES = [
  { name: 'General Service', cat: 'Service', lo: 900, hi: 2500 },
  { name: 'Periodic Service', cat: 'Service', lo: 1500, hi: 4500 },
  { name: 'Oil Change', cat: 'Labour', lo: 200, hi: 500 },
  { name: 'Brake Service', cat: 'Labour', lo: 400, hi: 1500 },
  { name: 'Wheel Alignment', cat: 'Service', lo: 350, hi: 700 },
  { name: 'Wheel Balancing', cat: 'Service', lo: 300, hi: 600 },
  { name: 'AC Check-up', cat: 'Service', lo: 300, hi: 800 },
  { name: 'AC Gas Refill', cat: 'Service', lo: 1800, hi: 3500 },
  { name: 'Engine Tune-up', cat: 'Labour', lo: 800, hi: 2500 },
  { name: 'Suspension Repair', cat: 'Labour', lo: 1200, hi: 4000 },
  { name: 'Clutch Work', cat: 'Labour', lo: 1500, hi: 5000 },
  { name: 'Gearbox Repair', cat: 'Labour', lo: 2500, hi: 9000 },
  { name: 'Painting', cat: 'Service', lo: 2500, hi: 15000 },
  { name: 'Denting', cat: 'Service', lo: 800, hi: 5000 },
  { name: 'Tinkering', cat: 'Labour', lo: 700, hi: 4000 },
  { name: 'Body Repair', cat: 'Service', lo: 2000, hi: 12000 },
  { name: 'Polishing', cat: 'Service', lo: 600, hi: 2500 },
  { name: 'Ceramic Coating', cat: 'Service', lo: 6000, hi: 25000 },
  { name: 'Interior Cleaning', cat: 'Service', lo: 500, hi: 2000 },
  { name: 'Exterior Washing', cat: 'Service', lo: 150, hi: 500 },
  { name: 'Pressure Wash', cat: 'Service', lo: 200, hi: 600 },
  { name: 'Electrical Repair', cat: 'Labour', lo: 400, hi: 3000 },
  { name: 'Scanner Diagnosis', cat: 'Service', lo: 300, hi: 1000 },
  { name: 'ECU Programming', cat: 'Service', lo: 1500, hi: 6000 },
  { name: 'Welding', cat: 'Labour', lo: 300, hi: 1500 },
  { name: 'Insurance Repair', cat: 'Service', lo: 3000, hi: 30000 },
  { name: 'Roadside Assistance', cat: 'Service', lo: 500, hi: 2000 },
  { name: 'Pickup & Drop', cat: 'Service', lo: 200, hi: 800 },
  { name: 'Accessories Installation', cat: 'Service', lo: 400, hi: 3000 },
];
const TECHNICIANS = ['Ramesh', 'Suresh', 'Naveen', 'Kiran', 'Bhaskar', 'Venu', 'Mohan', 'Ganesh'];

// SEEDED HISTORY IS DERIVED FROM SEEDED INVOICES — never fabricated independently.
//
// ARCHITECTURAL FIX. This used to invent ~1,700 sales/service rows out of thin air,
// tagged `source: 'invoice'` but carrying NO invoiceNo and having no parent invoice
// anywhere. That was a SECOND, disconnected ledger sitting alongside the real one:
// Billing showed invoices the ledger had never heard of, and the ledger showed
// "sales" no invoice had ever produced. Two sources of truth, guaranteed to disagree.
//
// Now we generate INVOICES (the single source of truth) and derive every historical
// sales/service row from their line items — the same way runInvoiceTransaction()
// derives them at runtime. Every row therefore traces back to a real invoice, and the
// demo behaves exactly like production.
function genInvoicedHistory(parts, customers) {
  const invoices = [];
  const sales = [];
  const invCount = between(260, 320);

  for (let i = 0; i < invCount; i++) {
    const d = daysAgo(between(0, 90));
    const invNo = `INV-${String(i + 1).padStart(4, '0')}`;
    const cust = customers && customers.length ? pick(customers) : null;
    const custName = cust ? cust.name : `${pick(['Ramesh', 'Suresh', 'Anil', 'Kiran', 'Praveen', 'Rohit', 'Sandeep'])} ${pick(['Reddy', 'Kumar', 'Rao', 'Sharma', 'Chowdary'])}`;
    const veh = cust && (cust.vehicles || [])[0];
    const vehLabel = veh ? `${veh.brand || ''} ${veh.model || ''}`.trim() : pick(BRANDS);
    const regNo = veh ? (veh.regNo || '') : '';

    const lines = [];

    // 1-4 inventory parts
    const nParts = between(1, 4);
    for (let j = 0; j < nParts; j++) {
      const p = pick(parts);
      const qty = between(1, 4);
      lines.push({
        id: `l_${i}_p${j}`, kind: 'Part', partId: p.id, desc: p.name,
        qty, rate: p.sellingPrice, listPrice: p.sellingPrice,
        purchasePrice: p.purchasePrice, sku: p.sku, gst: 18, disc: 0,
      });
    }
    // 0-3 services
    const nSvc = between(0, 3);
    for (let j = 0; j < nSvc; j++) {
      const sv = pick(GARAGE_SERVICES);
      const hourly = sv.cat === 'Labour' && Math.random() < 0.25;
      const hours = hourly ? between(1, 4) : 1;
      lines.push({
        id: `l_${i}_s${j}`, kind: 'Labour', partId: null, desc: sv.name,
        qty: hours, rate: between(sv.lo, sv.hi), gst: 0, disc: 0,
        hourly, technician: pick(TECHNICIANS),
      });
    }

    let sub = 0, gst = 0;
    lines.forEach((l) => {
      const net = (Number(l.qty) || 0) * (Number(l.rate) || 0);
      sub += net;
      gst += net * ((Number(l.gst) || 0) / 100);
    });
    const grand = Math.round(sub + gst);

    const inv = {
      id: `demo-inv-${i + 1}`,
      invNo,
      date: new Date(d).toISOString().slice(0, 10),
      customer: custName,
      customerId: cust ? cust.id : null,
      vehicle: vehLabel,
      regNo,
      status: 'Paid',
      isEstimate: false,
      lines,
      payments: [{ id: `pay_${i}`, mode: pick(['Cash', 'UPI', 'Card']), amount: grand, date: new Date(d).toISOString().slice(0, 10) }],
      paid: grand,
      grandTotal: grand,
      gstAmount: Math.round(gst),
      balance: 0,
      createdAt: ts(d),
    };
    invoices.push(inv);

    // Derive the ledger rows from the invoice's OWN lines — identical shape to what
    // recordInvoiceSalesDelta() produces at runtime.
    lines.forEach((l, li) => {
      const isPart = !!l.partId;
      const qty = Number(l.qty) || 0;
      const revenue = qty * (Number(l.rate) || 0);
      const cost = isPart ? qty * (Number(l.purchasePrice) || 0) : 0;
      sales.push({
        id: `demo-sale-${i + 1}-${li}`,
        partId: l.partId || null,
        name: l.desc, partName: l.desc,
        sku: l.sku || '',
        category: isPart ? 'Parts' : 'Labour',
        revenueType: isPart ? 'Parts' : 'Labour',
        isService: !isPart,
        qty, quantity: qty,
        unitPrice: Number(l.rate) || 0,
        listPrice: Number(l.listPrice) || 0,
        extraRevenue: 0,
        unitCost: isPart ? (Number(l.purchasePrice) || 0) : 0,
        costPrice: isPart ? (Number(l.purchasePrice) || 0) : 0,
        revenue, total: revenue, totalPrice: revenue,
        cost,
        profit: revenue - cost,
        margin: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : 0,
        technician: l.technician || '',
        invoiceNo: invNo,               // <<< every row now traces to a real invoice
        customer: custName,
        vehicle: vehLabel,
        source: 'invoice',
        soldByEmail: 'demo@balajiautoos.com',
        createdAt: ts(d),
      });
    });
  }

  sales.sort((a, b) => b.createdAt.seconds - a.createdAt.seconds);
  invoices.sort((a, b) => b.createdAt.seconds - a.createdAt.seconds);
  return { invoices, sales };
}

function genSales_UNUSED(parts) {
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
      category: 'Parts', revenueType: 'Parts', isService: false,
      partCategory: p.category, brands: [p.vehicle],
      qty, quantity: qty,                        // app reads s.qty
      unitPrice: price, unitCost, costPrice: unitCost,
      revenue, total: revenue, totalPrice: revenue, // app variously reads revenue/total/totalPrice
      cost,
      profit: revenue - cost,
      source: 'invoice',
      createdAt: ts(d),
    });
  }
  // Service & labour revenue records (no COGS → profit = full charge). These make
  // the Sales & Services module show real garage takings beyond spare parts.
  const svcCount = between(600, 750);
  for (let i = 0; i < svcCount; i++) {
    const s = pick(GARAGE_SERVICES);
    const hours = s.cat === 'Labour' ? between(1, 4) : 1;
    const rate = between(s.lo, s.hi);
    const revenue = hours * rate;
    const d = daysAgo(between(0, 90));
    sales.push({
      id: `demo-svc-${i + 1}`,
      partId: null,
      name: s.name, partName: s.name,
      sku: '',
      category: s.cat, revenueType: s.cat, isService: true,
      qty: hours, quantity: hours, hours,
      unitPrice: rate, unitCost: 0, costPrice: 0,
      revenue, total: revenue, totalPrice: revenue,
      cost: 0,
      profit: revenue,
      margin: 100,
      technician: pick(TECHNICIANS),
      source: 'invoice',
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

function genPurchaseOrders(parts, suppliers) {
  const supById = Object.fromEntries(suppliers.map((s) => [s.id, s]));
  const statuses = ['pending', 'approved', 'received', 'received', 'cancelled'];
  const out = [];
  for (let i = 0; i < 14; i++) {
    const sup = suppliers[i % suppliers.length];
    // 1–4 line items drawn from this supplier's parts (fallback to any).
    const supParts = parts.filter((p) => (p.suppliers || []).some((s) => s.id === sup.id));
    const pool = (supParts.length ? supParts : parts);
    const n = between(1, 4);
    const items = [];
    for (let j = 0; j < n; j++) {
      const p = pool[(i * 3 + j) % pool.length];
      if (!p || items.some((it) => it.partId === p.id)) continue;
      const qty = between(4, 20);
      items.push({ partId: p.id, name: p.name, sku: p.sku, qty, unitCost: p.purchasePrice || Math.round(p.sellingPrice * 0.7) });
    }
    if (!items.length) continue;
    const total = items.reduce((s, it) => s + it.qty * it.unitCost, 0);
    const status = statuses[i % statuses.length];
    const created = daysAgo(between(2, 60));
    const po = {
      id: `demo-po-${i + 1}`,
      poNumber: `PO-${10041 + i}`,
      supplierId: sup.id, supplierName: sup.name,
      items, total, notes: '', status,
      expectedDate: null,
      createdAt: ts(created),
    };
    if (status === 'approved' || status === 'received') po.approvedAt = ts(created);
    if (status === 'received') po.receivedAt = ts(daysAgo(between(0, 2)));
    if (status === 'cancelled') po.cancelledAt = ts(created);
    out.push(po);
  }
  return out.sort((a, b) => b.createdAt.seconds - a.createdAt.seconds);
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
  // Invoices are the source of truth; the sales/services ledger is DERIVED from them.
  const { invoices, sales } = genInvoicedHistory(parts, null);
  const restocks = genRestocks(parts, suppliers);
  const stockAdjustments = genAdjustments(parts);
  const reorderRequests = genReorders(parts, suppliers);
  const purchaseOrders = genPurchaseOrders(parts, suppliers);
  const salesRollups = genRollups(sales);
  const auditLog = genAuditLog();
  const categories = [...new Set(parts.map((p) => p.category))].map((c, i) => ({ id: `demo-cat-${i}`, name: c }));
  const vehicles = BRANDS.map((b, i) => ({ id: `demo-veh-${i}`, name: b }));
  _cache = { parts, suppliers, invoices, sales, restocks, stockAdjustments, reorderRequests, purchaseOrders, salesRollups, auditLog, categories, vehicles };
  return _cache;
}
