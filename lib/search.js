// lib/search.js
// Pure fuzzy-search primitives for the automotive catalogue, extracted from the
// monolith. No React/state — testable in isolation. Includes English + Telugu
// vernacular synonym expansion.

// Strip punctuation, lowercase, collapse whitespace.
export const normalizeText = (str) =>
  String(str ?? '')
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

// Split into discrete keyword tokens.
export const tokenize = (str) => normalizeText(str).split(' ').filter(Boolean);

// Automotive slang / vernacular → standardized inventory keywords.
export const SLANG_MAP = {
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
  // Common Telugu (te-IN) auto-parts terms → English search keywords.
  'బ్రేక్': 'brake', 'ఆయిల్': 'oil', 'ఆయిలు': 'oil', 'బ్యాటరీ': 'battery',
  'టైర్': 'tyre', 'టైరు': 'tyre', 'క్లచ్': 'clutch', 'ఫిల్టర్': 'filter',
  'లైట్': 'light', 'బల్బ్': 'bulb', 'అద్దం': 'mirror', 'ప్లగ్': 'spark',
  'సస్పెన్షన్': 'suspension', 'హార్న్': 'horn', 'వైపర్': 'wiper', 'రేడియేటర్': 'radiator',
};

// Expand a token to itself + any slang synonym.
export const expandToken = (t) => (SLANG_MAP[t] ? [t, SLANG_MAP[t]] : [t]);
