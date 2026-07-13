// lib/demoGarageSeed.js — deterministic demo seed for the garage-side modules
// (Customers, their Vehicles, and Job Cards). Generated once and cached in
// sessionStorage so numbers stay stable within a demo session but reset on a
// fresh demo reset. Kept intentionally lightweight (no images) to stay well
// under storage limits at ~100 customers / ~150 vehicles / ~200 job cards.

const FIRST = [
  // Telugu
  'Ravi', 'Srinivas', 'Venkat', 'Sai', 'Bhargav', 'Naveen', 'Praveen', 'Chandra', 'Ramana', 'Kishore',
  // Tamil
  'Karthik', 'Arun', 'Senthil', 'Murugan', 'Bala', 'Dinesh', 'Prabhu', 'Vignesh', 'Saravanan', 'Ganesh',
  // Kannada
  'Manjunath', 'Girish', 'Shreyas', 'Lokesh', 'Nagaraj', 'Vinay', 'Prashanth',
  // Hindi / North
  'Amit', 'Rohit', 'Deepak', 'Vikram', 'Rahul', 'Sandeep', 'Ankit', 'Manoj', 'Suresh', 'Ashok',
  // Marathi
  'Nikhil', 'Omkar', 'Sagar', 'Nilesh', 'Mangesh', 'Yogesh', 'Swapnil',
];
const LAST = [
  'Reddy', 'Naidu', 'Rao', 'Varma', 'Chowdary', 'Raju', 'Goud', // Telugu
  'Iyer', 'Nadar', 'Pillai', 'Krishnan', 'Subramanian', // Tamil
  'Gowda', 'Shetty', 'Hegde', 'Bhat', // Kannada
  'Kumar', 'Sharma', 'Singh', 'Gupta', 'Verma', 'Yadav', 'Agarwal', // Hindi
  'Patil', 'Deshmukh', 'Kulkarni', 'Joshi', 'Jadhav', // Marathi
];
const COMPANIES = ['Techno Garage', 'Sri Sai Logistics', 'ICICI Lombard', 'Bajaj Allianz', 'AP State Transport', 'Blue Dart Fleet', 'Annapurna Traders', 'Godavari Motors'];
const CITIES = [['Visakhapatnam', 'Andhra Pradesh', '530026'], ['Gajuwaka', 'Andhra Pradesh', '530026'], ['Vijayawada', 'Andhra Pradesh', '520010'], ['Hyderabad', 'Telangana', '500072'], ['Guntur', 'Andhra Pradesh', '522001'], ['Kakinada', 'Andhra Pradesh', '533001']];
const TYPES = ['Individual', 'Individual', 'Individual', 'Family', 'Repeat Customer', 'Corporate', 'Fleet Owner', 'Taxi / Cab Operator', 'Insurance Company', 'Walk-in', 'VIP', 'Dealer', 'Government', 'Cash Customer', 'Credit Customer'];
const ADVISORS = ['Ramesh Kumar', 'Suresh Babu', 'Kiran Rao', 'Naveen Reddy'];
const TECHS = ['Anil Technician', 'Gopal Mechanic', 'Harish Kumar', 'Sandeep Y'];
const VEH = {
  'Maruti Suzuki': ['Swift VXi', 'Baleno Zeta', 'Brezza ZXi', 'Ertiga VXi', 'Dzire VXi', 'WagonR LXi', 'Fronx Delta'],
  Hyundai: ['Creta SX', 'Venue S', 'i20 Asta', 'Verna SX', 'Exter S', 'Grand i10 Nios'],
  Tata: ['Nexon XZ', 'Punch Adventure', 'Harrier XT', 'Altroz XZ', 'Tiago XT'],
  Mahindra: ['Scorpio-N Z8', 'Thar LX', 'XUV700 AX7', 'Bolero B6', 'XUV 3XO'],
  Toyota: ['Innova Crysta', 'Fortuner 4x2', 'Glanza G', 'Urban Cruiser Hyryder'],
  Honda: ['City VX', 'Amaze VX', 'Elevate V'],
  Kia: ['Seltos HTX', 'Sonet HTK', 'Carens Prestige'],
};
const FUELS = ['Petrol', 'Diesel', 'CNG', 'Petrol', 'Diesel'];
const COMPLAINTS = ['Brake noise from front side.', 'AC cooling issue.', 'Oil leakage from engine.', 'General servicing.', 'Suspension noise over bumps.', 'Battery not holding charge.', 'Clutch slipping.', 'Wheel alignment required.'];
const DIAG = ['Front brake pads worn out.', 'AC gas low.', 'Engine oil gasket leaking.', 'Recommended full service.', 'Strut mount worn.', 'Battery replacement advised.', 'Clutch plate worn.', 'Alignment & balancing done.'];

// tiny seeded PRNG so the same session gives stable data
function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function buildGarageSeed() {
  const rnd = mulberry(20260705);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const makes = Object.keys(VEH);
  const stateCode = () => `AP${String(Math.floor(rnd() * 39) + 1).padStart(2, '0')}`;
  const regNo = () => `${stateCode()}${String.fromCharCode(65 + Math.floor(rnd() * 26))}${String.fromCharCode(65 + Math.floor(rnd() * 26))}${String(Math.floor(rnd() * 9000) + 1000)}`;

  const customers = [];
  const jobCards = [];
  let vehTotal = 0;
  let jcTotal = 0;

  for (let i = 1; i <= 200; i += 1) {
    const type = pick(TYPES);
    const corporate = ['Corporate', 'Fleet Owner', 'Insurance Company', 'Government', 'Dealer', 'Travel Agency', 'Educational Institution', 'Workshop Partner'].includes(type);
    const name = corporate ? `${pick(COMPANIES)}${type === 'Fleet' ? ' (Fleet)' : type === 'Insurance Company' ? ' (Insurance)' : ''}` : `${pick(FIRST)} ${pick(LAST)}`;
    const [city, state, pin] = pick(CITIES);
    const phone = `9${Math.floor(rnd() * 900000000) + 100000000}`;
    const nVeh = type === 'Fleet Owner' ? 3 + Math.floor(rnd() * 8) : type === 'Insurance Company' ? (rnd() > 0.6 ? 1 : 0) : 1 + Math.floor(rnd() * 2);
    const vehicles = [];
    for (let v = 0; v < nVeh && vehTotal < 350; v += 1) {
      const make = pick(makes); const model = pick(VEH[make]);
      const reg = regNo();
      const insMonth = rnd() > 0.75 ? -1 - Math.floor(rnd() * 3) : 1 + Math.floor(rnd() * 10); // some expired
      const insDate = new Date(); insDate.setMonth(insDate.getMonth() + insMonth);
      const pucDate = new Date(); pucDate.setMonth(pucDate.getMonth() + (rnd() > 0.7 ? -1 : 1 + Math.floor(rnd() * 6)));
      const warrDate = new Date(); warrDate.setFullYear(warrDate.getFullYear() + (rnd() > 0.6 ? -1 : 1));
      const ownType = type === 'Fleet Owner' ? 'Fleet' : type === 'Taxi / Cab Operator' ? 'Taxi' : type === 'Government' ? 'Government' : type === 'Dealer' ? 'Dealer Demo' : 'Primary Owner';
      vehicles.push({ id: `dv_${i}_${v}`, regNo: reg, make, model, vehicle: `${make} ${model}`, variant: pick(['VXi', 'ZXi', 'Sportz', 'Asta', 'Alpha', 'Delta', '']), color: pick(['White', 'Silver', 'Grey', 'Red', 'Blue', 'Black']), fuel: pick(FUELS), transmission: pick(['Manual', 'Manual', 'AMT', 'Automatic']), bodyType: pick(['Hatchback', 'Sedan', 'SUV', 'MUV']), engineCC: String(pick([1197, 1248, 1462, 1497, 1956, 998])), ownershipType: ownType, year: String(2016 + Math.floor(rnd() * 9)), kms: String((Math.floor(rnd() * 90) + 5) * 1000 + Math.floor(rnd() * 900)), odometer: String((Math.floor(rnd() * 90) + 5) * 1000), engineNo: `EN${Math.floor(rnd() * 9000000) + 1000000}`, vin: `MA${Math.floor(rnd() * 9000000000) + 1000000000}${Math.floor(rnd() * 9000) + 1000}`, insurer: pick(['ICICI Lombard', 'Bajaj Allianz', 'HDFC Ergo', 'New India', 'TATA AIG']), insuranceExpiry: insDate.toISOString().slice(0, 10), pucExpiry: pucDate.toISOString().slice(0, 10), warrantyExpiry: warrDate.toISOString().slice(0, 10), extWarranty: rnd() > 0.7, rcExpiry: `203${Math.floor(rnd() * 5)}-0${1 + Math.floor(rnd() * 8)}-${String(1 + Math.floor(rnd() * 27)).padStart(2, '0')}`, lastService: `2026-0${1 + Math.floor(rnd() * 6)}-${String(1 + Math.floor(rnd() * 27)).padStart(2, '0')}`, status: 'Active', photos: [], coverPhoto: 0, documents: [], history: [{ at: Date.now() - Math.floor(rnd() * 9e9), action: 'Vehicle Created', detail: reg, by: 'System' }] });
      vehTotal += 1;
    }
    const visits = vehicles.length ? Math.floor(rnd() * 12) : 0;
    const totalSpent = visits * (2500 + Math.floor(rnd() * 9000));
    const outstanding = rnd() > 0.7 ? Math.floor(rnd() * 12000) : 0;
    const cust = {
      id: `dc_${i}`, code: `SBBMC${String(i).padStart(2, '0')}`, name, phone,
      altPhone: rnd() > 0.6 ? `9${Math.floor(rnd() * 900000000) + 100000000}` : '',
      email: `${name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 10)}@email.com`,
      address: `D.No ${Math.floor(rnd() * 90) + 1}-${Math.floor(rnd() * 90)}-${Math.floor(rnd() * 90)}, ${city}, ${state} - ${pin}`,
      city, state, pincode: pin, gst: corporate ? `37${String.fromCharCode(65 + Math.floor(rnd() * 26))}${String.fromCharCode(65 + Math.floor(rnd() * 26))}CPS${Math.floor(rnd() * 9000) + 1000}Q1Z5` : '',
      aadhar: corporate ? '' : String(Math.floor(rnd() * 9000) + 1000) + String(Math.floor(rnd() * 9000) + 1000) + String(Math.floor(rnd() * 9000) + 1000),
      type, status: rnd() > 0.12 ? 'Active' : 'Inactive', preferredContact: pick(['Phone', 'WhatsApp', 'Email']),
      occupation: corporate ? '' : pick(['Business', 'Software Engineer', 'Teacher', 'Farmer', 'Doctor', 'Govt Employee']),
      referenceBy: rnd() > 0.7 ? pick(FIRST) : '', pan: corporate ? `AA${String.fromCharCode(65 + Math.floor(rnd() * 26))}CS${Math.floor(rnd() * 9000) + 1000}Q` : '',
      notes: rnd() > 0.75 ? 'Regular customer. Prompt payments.' : '', creditLimit: corporate ? (Math.floor(rnd() * 5) + 1) * 25000 : 0,
      loyalty: Math.floor(totalSpent / 100), totalSpent, outstanding,
      since: `202${Math.floor(rnd() * 4) + 2}-0${1 + Math.floor(rnd() * 8)}-${String(1 + Math.floor(rnd() * 27)).padStart(2, '0')}`,
      vehicles,
    };
    customers.push(cust);

    // job cards for this customer (bias toward ~200 total)
    const nJC = vehicles.length ? Math.min(visits, 3) : 0;
    for (let j = 0; j < nJC && jcTotal < 300; j += 1) {
      const veh = pick(vehicles);
      const daysAgo = Math.floor(rnd() * 180);
      const at = Date.now() - daysAgo * 86400000;
      jcTotal += 1;
      jobCards.push({
        jobNo: `SBBMC${String(jcTotal).padStart(2, '0')}`, savedAt: at,
        dateIn: new Date(at).toISOString().slice(0, 16), promised: new Date(at + 86400000).toISOString().slice(0, 16),
        advisor: pick(ADVISORS), customer: name, phone, altPhone: cust.altPhone, address: cust.address,
        vehicle: veh.model, regNo: veh.regNo, vin: '', fuel: veh.fuel, engineNo: '',
        complaints: [pick(COMPLAINTS), rnd() > 0.5 ? pick(COMPLAINTS) : '', '', ''],
        diagnosis: [pick(DIAG), rnd() > 0.5 ? pick(DIAG) : '', '', ''],
        warnings: rnd() > 0.5 ? ['Check Engine'] : [], warningsOther: '', invItems: [], invOther: '',
        damages: rnd() > 0.7 ? [{ part: 'Front Bumper', note: 'Minor scratch' }] : [], damageOther: '',
        inspection: {}, photosBefore: [], photosAfter: [], notes: '',
        status: pick(['Delivered', 'Delivered', 'Ready', 'Work In Progress', 'Received']),
        statusLog: [{ status: 'Received', at }],
      });
    }
  }
  return { customers, jobCards };
}

export function getGarageSeed() {
  try { const c = sessionStorage.getItem('maruti_garage_seed'); if (c) return JSON.parse(c); } catch {}
  const seed = buildGarageSeed();
  try { sessionStorage.setItem('maruti_garage_seed', JSON.stringify(seed)); } catch {}
  return seed;
}
