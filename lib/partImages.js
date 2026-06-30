// lib/partImages.js
import { PART_PHOTOS } from './partPhotos';
// Original, hand-drawn SVG illustrations of real auto-part TYPES — no brand,
// no logos, no copyrighted artwork. Each demo part is matched to a specific
// illustration by keyword, so a brake pad looks like a brake pad, a battery like
// a battery, etc. Inlined as data URIs => instant load, never broken.

function tile(inner, bg = '#eef2f7') {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='12' fill='${bg}'/>${inner}</svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

// ---- individual part illustrations (viewBox 64x64) ----
const ART = {
  'brake-pads': tile("<rect x='12' y='22' width='26' height='9' rx='2' fill='#94a3b8'/><rect x='12' y='20' width='26' height='3' rx='1.5' fill='#475569'/><rect x='14' y='33' width='26' height='9' rx='2' fill='#94a3b8'/><rect x='14' y='42' width='26' height='3' rx='1.5' fill='#475569'/><circle cx='44' cy='26' r='2' fill='#64748b'/><circle cx='46' cy='38' r='2' fill='#64748b'/>"),
  'brake-disc': tile("<circle cx='32' cy='32' r='18' fill='#9aa6b2'/><circle cx='32' cy='32' r='18' fill='none' stroke='#64748b' stroke-width='1.5'/><circle cx='32' cy='32' r='8' fill='#cbd5e1'/><circle cx='32' cy='32' r='3.5' fill='#475569'/><g fill='#7c8794'><circle cx='32' cy='18' r='1.4'/><circle cx='32' cy='46' r='1.4'/><circle cx='18' cy='32' r='1.4'/><circle cx='46' cy='32' r='1.4'/><circle cx='22' cy='22' r='1.4'/><circle cx='42' cy='42' r='1.4'/><circle cx='42' cy='22' r='1.4'/><circle cx='22' cy='42' r='1.4'/></g>"),
  'brake-fluid': tile("<rect x='22' y='18' width='20' height='30' rx='3' fill='#f59e0b'/><rect x='26' y='13' width='12' height='6' rx='1.5' fill='#b45309'/><rect x='25' y='30' width='14' height='10' rx='1' fill='#fff' opacity='0.85'/>"),
  'engine-oil': tile("<path d='M24 20 h12 a4 4 0 0 1 4 4 v20 a3 3 0 0 1 -3 3 h-14 a3 3 0 0 1 -3 -3 v-20 a4 4 0 0 1 4 -4 z' fill='#1f2937'/><rect x='26' y='14' width='10' height='6' rx='1.5' fill='#374151'/><rect x='23' y='30' width='16' height='12' rx='1.5' fill='#f59e0b'/><rect x='25' y='33' width='12' height='2.4' rx='1' fill='#7c2d12'/>"),
  'coolant': tile("<path d='M24 20 h12 a4 4 0 0 1 4 4 v20 a3 3 0 0 1 -3 3 h-14 a3 3 0 0 1 -3 -3 v-20 a4 4 0 0 1 4 -4 z' fill='#e2e8f0'/><rect x='26' y='14' width='10' height='6' rx='1.5' fill='#94a3b8'/><rect x='21' y='28' width='20' height='16' rx='1' fill='#22c55e'/>"),
  'air-filter': tile("<rect x='12' y='20' width='40' height='24' rx='3' fill='#1f2937'/><g fill='#fef3c7'>" + Array.from({length:9},(_,i)=>`<rect x='${15+i*4}' y='23' width='2.4' height='18'/>`).join('') + "</g>"),
  'cabin-filter': tile("<rect x='12' y='20' width='40' height='24' rx='3' fill='#0f766e'/><g fill='#ccfbf1'>" + Array.from({length:9},(_,i)=>`<rect x='${15+i*4}' y='23' width='2.4' height='18'/>`).join('') + "</g>"),
  'oil-filter': tile("<rect x='22' y='16' width='20' height='32' rx='6' fill='#1d4ed8'/><rect x='22' y='16' width='20' height='6' rx='3' fill='#1e40af'/><g stroke='#3b82f6' stroke-width='1.2'><line x1='24' y1='28' x2='40' y2='28'/><line x1='24' y1='33' x2='40' y2='33'/><line x1='24' y1='38' x2='40' y2='38'/></g>"),
  'fuel-pump': tile("<rect x='20' y='18' width='24' height='28' rx='3' fill='#334155'/><circle cx='32' cy='30' r='6' fill='#94a3b8'/><circle cx='32' cy='30' r='2.4' fill='#1f2937'/><rect x='28' y='12' width='8' height='6' rx='1.5' fill='#475569'/><rect x='24' y='44' width='16' height='4' rx='1.5' fill='#64748b'/>"),
  'spark-plug': tile("<rect x='29' y='12' width='6' height='12' rx='1' fill='#cbd5e1'/><path d='M28 24 h8 l-1 6 h-6 z' fill='#94a3b8'/><rect x='28' y='30' width='8' height='8' fill='#e5e7eb'/><rect x='29' y='38' width='6' height='8' rx='1' fill='#9ca3af'/><rect x='30.5' y='46' width='3' height='6' fill='#6b7280'/>"),
  'battery': tile("<rect x='14' y='22' width='36' height='24' rx='3' fill='#1f2937'/><rect x='14' y='22' width='36' height='8' rx='3' fill='#374151'/><rect x='20' y='17' width='7' height='5' rx='1.5' fill='#ef4444'/><rect x='37' y='17' width='7' height='5' rx='1.5' fill='#3b82f6'/><g stroke='#fbbf24' stroke-width='2'><line x1='23' y1='38' x2='29' y2='38'/><line x1='26' y1='35' x2='26' y2='41'/><line x1='38' y1='38' x2='44' y2='38'/></g>"),
  'alternator': tile("<circle cx='28' cy='32' r='14' fill='#64748b'/><circle cx='28' cy='32' r='6' fill='#cbd5e1'/><circle cx='28' cy='32' r='2.5' fill='#334155'/><circle cx='46' cy='32' r='6' fill='#475569'/><circle cx='46' cy='32' r='2.5' fill='#94a3b8'/>"),
  'radiator': tile("<rect x='14' y='16' width='36' height='32' rx='2' fill='#475569'/><rect x='14' y='16' width='36' height='5' rx='2' fill='#334155'/><rect x='14' y='43' width='36' height='5' rx='2' fill='#334155'/><g stroke='#94a3b8' stroke-width='1.4'>" + Array.from({length:8},(_,i)=>`<line x1='${18+i*4}' y1='22' x2='${18+i*4}' y2='42'/>`).join('') + "</g>"),
  'shock-absorber': tile("<rect x='28' y='12' width='8' height='10' rx='2' fill='#475569'/><g stroke='#64748b' stroke-width='3' fill='none'><path d='M24 22 h16 M24 26 h16 M24 30 h16 M24 34 h16'/></g><rect x='27' y='34' width='10' height='18' rx='3' fill='#94a3b8'/>"),
  'timing-belt': tile("<rect x='14' y='18' width='36' height='28' rx='14' fill='none' stroke='#1f2937' stroke-width='6'/><g fill='#1f2937'>" + Array.from({length:10},(_,i)=>`<rect x='${16+i*3.4}' y='40' width='2' height='5'/>`).join('') + "</g>"),
  'drive-belt': tile("<rect x='14' y='18' width='36' height='28' rx='14' fill='none' stroke='#111827' stroke-width='6'/><g stroke='#374151' stroke-width='1' fill='none'><path d='M14 24 h36 M14 40 h36'/></g>"),
  'clutch-plate': tile("<circle cx='32' cy='32' r='18' fill='#9aa6b2'/><g fill='#64748b'>" + Array.from({length:12},(_,i)=>{const a=i*30*Math.PI/180;const x=32+Math.cos(a)*15;const y=32+Math.sin(a)*15;return `<rect x='${x-2}' y='${y-2}' width='4' height='4' rx='1'/>`}).join('') + "</circle><circle cx='32' cy='32' r='7' fill='#cbd5e1'/><circle cx='32' cy='32' r='3' fill='#475569'/>"),
  'headlight': tile("<path d='M16 22 q-2 10 0 20 l20 4 q6 -14 0 -28 z' fill='#e0f2fe'/><path d='M16 22 q-2 10 0 20 l20 4 q6 -14 0 -28 z' fill='none' stroke='#7dd3fc' stroke-width='1.5'/><circle cx='28' cy='32' r='6' fill='#fde68a'/><rect x='36' y='28' width='10' height='8' rx='2' fill='#94a3b8'/>"),
  'horn': tile("<path d='M14 28 h10 l14 -8 v24 l-14 -8 h-10 z' fill='#1f2937'/><path d='M40 22 a12 12 0 0 1 0 20' fill='none' stroke='#f59e0b' stroke-width='3'/>"),
  'side-mirror': tile("<path d='M18 24 q14 -8 28 0 q4 12 -4 18 q-12 5 -22 0 q-6 -8 -2 -18 z' fill='#334155'/><path d='M24 28 q8 -4 16 0 q2 7 -2 11 q-7 3 -12 0 q-4 -5 -2 -11 z' fill='#bae6fd'/>"),
  'tyre': tile("<circle cx='32' cy='32' r='19' fill='#1f2937'/><circle cx='32' cy='32' r='19' fill='none' stroke='#000' stroke-width='1'/><circle cx='32' cy='32' r='10' fill='#cbd5e1'/><circle cx='32' cy='32' r='4' fill='#64748b'/><g stroke='#374151' stroke-width='1.5'>" + Array.from({length:16},(_,i)=>{const a=i*22.5*Math.PI/180;return `<line x1='${32+Math.cos(a)*13}' y1='${32+Math.sin(a)*13}' x2='${32+Math.cos(a)*18}' y2='${32+Math.sin(a)*18}'/>`}).join('') + "</g>"),
  'generic': tile("<circle cx='32' cy='32' r='14' fill='none' stroke='#64748b' stroke-width='3'/><circle cx='32' cy='32' r='5' fill='#94a3b8'/>"),
};

// Keyword → illustration. Order matters (more specific first).
const KEYWORD_MAP = [
  ['brake pad', 'brake-pads'], ['brake disc', 'brake-disc'], ['brake fluid', 'brake-fluid'], ['brake caliper', 'brake-disc'],
  ['cabin filter', 'cabin-filter'], ['air filter', 'air-filter'], ['oil filter', 'oil-filter'], ['fuel filter', 'oil-filter'],
  ['engine oil', 'engine-oil'], ['coolant', 'coolant'],
  ['spark plug', 'spark-plug'], ['battery', 'battery'], ['alternator', 'alternator'], ['starter', 'starter-motor'],
  ['radiator', 'radiator'], ['water pump', 'water-pump'], ['thermostat', 'coolant'], ['fuel pump', 'fuel-pump'],
  ['shock', 'shock-absorber'], ['control arm', 'shock-absorber'], ['ball joint', 'shock-absorber'], ['tie rod', 'shock-absorber'],
  ['timing belt', 'timing-belt'], ['timing chain', 'timing-belt'], ['drive belt', 'drive-belt'], ['serpentine', 'drive-belt'],
  ['clutch', 'clutch-plate'], ['flywheel', 'clutch-plate'],
  ['headlight', 'headlight'], ['head light', 'headlight'], ['tail light', 'headlight'], ['fog lamp', 'headlight'], ['bulb', 'headlight'],
  ['horn', 'horn'], ['mirror', 'side-mirror'], ['wiper', 'wiper-blade'],
  ['tyre', 'tyre'], ['tire', 'tyre'], ['wheel', 'tyre'],
];

export function imageForPartName(name = '') {
  const n = String(name).toLowerCase();
  for (const [kw, key] of KEYWORD_MAP) {
    if (n.includes(kw)) return PART_PHOTOS[key] || ART[key] || ART.generic; // real photo first, illustration fallback
  }
  return ART.generic;
}
