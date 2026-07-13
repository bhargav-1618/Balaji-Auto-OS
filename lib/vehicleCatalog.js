// lib/vehicleCatalog.js — single source of truth for the Indian vehicle catalog.
// Shared by the Vehicles module and Job Cards so make→model dropdowns stay
// consistent. Variants are provided generically per body-style since exact
// trim lists change yearly; the UI also lets users type a custom variant.
export const VEHICLES = {
  'Maruti Suzuki': ['Alto K10', 'S-Presso', 'Celerio', 'WagonR', 'Swift', 'Dzire', 'Baleno', 'Fronx', 'Ignis', 'Brezza', 'Grand Vitara', 'Ertiga', 'XL6', 'Ciaz', 'Jimny', 'Invicto', 'Eeco', 'Super Carry'],
  Hyundai: ['Grand i10 Nios', 'i20', 'Aura', 'Exter', 'Venue', 'Verna', 'Creta', 'Alcazar', 'Tucson', 'Ioniq 5'],
  Tata: ['Tiago', 'Tigor', 'Altroz', 'Punch', 'Nexon', 'Curvv', 'Harrier', 'Safari', 'Tiago EV', 'Nexon EV', 'Punch EV'],
  Mahindra: ['Bolero', 'Bolero Neo', 'XUV 3XO', 'Scorpio Classic', 'Scorpio-N', 'Thar', 'Thar Roxx', 'XUV700', 'BE 6', 'XEV 9e', 'Marazzo'],
  Toyota: ['Glanza', 'Taisor', 'Rumion', 'Urban Cruiser Hyryder', 'Innova Crysta', 'Innova Hycross', 'Fortuner', 'Hilux', 'Camry', 'Vellfire', 'Land Cruiser'],
  Honda: ['Amaze', 'City', 'City e:HEV', 'Elevate'],
  Kia: ['Sonet', 'Syros', 'Seltos', 'Carens', 'Carnival', 'EV6', 'EV9'],
  MG: ['Comet EV', 'Astor', 'Hector', 'Hector Plus', 'ZS EV', 'Windsor EV', 'Gloster'],
  Volkswagen: ['Virtus', 'Taigun', 'Tiguan'],
  Skoda: ['Slavia', 'Kylaq', 'Kushaq', 'Kodiaq', 'Superb'],
  Renault: ['Kwid', 'Triber', 'Kiger'],
  Nissan: ['Magnite', 'X-Trail'],
  Jeep: ['Compass', 'Meridian', 'Wrangler', 'Grand Cherokee'],
  Citroen: ['C3', 'C3 Aircross', 'Basalt', 'eC3'],
  BMW: ['2 Series GC', '3 Series', '5 Series', '7 Series', 'X1', 'X3', 'X5', 'X7', 'iX1', 'i4', 'i7'],
  'Mercedes-Benz': ['A-Class', 'C-Class', 'E-Class', 'S-Class', 'GLA', 'GLC', 'GLE', 'GLS', 'EQB', 'EQE', 'EQS'],
  Audi: ['A4', 'A6', 'Q3', 'Q5', 'Q7', 'Q8', 'e-tron GT'],
  Volvo: ['XC40 Recharge', 'XC60', 'XC90', 'C40 Recharge', 'S90'],
  Mini: ['Cooper S', 'Countryman', 'Cooper SE'],
  Lexus: ['ES', 'NX', 'RX', 'LX', 'LM'],
  BYD: ['Atto 3', 'Seal', 'eMAX 7'],
  Force: ['Gurkha', 'Urbania', 'Traveller'],
  'Ashok Leyland': ['Dost', 'Bada Dost', 'Partner'],
  Eicher: ['Pro 2049', 'Pro 2059', 'Pro 3015'],
  Isuzu: ['D-Max V-Cross', 'MU-X', 'Hi-Lander'],
  Mitsubishi: ['Pajero Sport', 'Outlander'],
  Fiat: ['Punto', 'Linea', 'Avventura'],
  Chevrolet: ['Beat', 'Cruze', 'Spark', 'Sail', 'Enjoy', 'Tavera'],
  Ford: ['Figo', 'Aspire', 'EcoSport', 'Endeavour', 'Freestyle'],
  Opel: ['Corsa', 'Astra'],
  Daewoo: ['Matiz', 'Cielo'],
  'HM Ambassador': ['Ambassador Classic', 'Ambassador Grand'],
  Others: [],
};

export const MAKES = Object.keys(VEHICLES);

// Generic variant sets — real trims vary by year/model, so we offer sensible
// defaults and always allow a free-typed value in the UI.
const VARIANT_SETS = {
  maruti: ['LXi', 'VXi', 'ZXi', 'ZXi+', 'Alpha', 'Sigma', 'Delta', 'Zeta'],
  hyundai: ['E', 'S', 'S(O)', 'SX', 'SX(O)', 'Asta', 'Magna', 'Sportz'],
  tata: ['XE', 'XM', 'XT', 'XZ', 'XZ+', 'Pure', 'Creative', 'Accomplished'],
  generic: ['Base', 'Mid', 'Top', 'LX', 'VX', 'ZX'],
  luxury: ['Sport', 'Luxury', 'M Sport', 'AMG Line', 'S Line', 'Technology', 'Signature'],
};
const LUXURY = new Set(['BMW', 'Mercedes-Benz', 'Audi', 'Volvo', 'Mini', 'Lexus', 'Jeep']);

export function variantsFor(make) {
  if (!make) return VARIANT_SETS.generic;
  if (make === 'Maruti Suzuki') return VARIANT_SETS.maruti;
  if (make === 'Hyundai') return VARIANT_SETS.hyundai;
  if (make === 'Tata') return VARIANT_SETS.tata;
  if (LUXURY.has(make)) return VARIANT_SETS.luxury;
  return VARIANT_SETS.generic;
}

export const FUELS = ['Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid', 'LPG'];
export const TRANSMISSIONS = ['Manual', 'AMT', 'Automatic', 'CVT', 'DCT', 'iMT'];
export const BODY_TYPES = ['Hatchback', 'Sedan', 'SUV', 'MUV', 'Compact SUV', 'Pickup', 'Van', 'Coupe', 'Convertible'];
export const DRIVE_TYPES = ['FWD', 'RWD', 'AWD', '4WD'];
export const OWNERSHIP_TYPES = ['Primary Owner', 'Joint Owner', 'Fleet', 'Taxi', 'Rental', 'Government', 'Dealer Demo', 'Workshop Vehicle'];
