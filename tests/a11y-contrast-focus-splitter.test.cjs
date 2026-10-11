/**
 * tests/a11y-contrast-focus-splitter.test.cjs
 *
 * QA report, accessibility batch 3:
 *   A11Y-004  WCAG AA text contrast (4.5:1) in the Dark / Warm / Light themes
 *   A11Y-005  keyboard focus must not land on the invisible items of a collapsed sidebar group
 *   A11Y-006  the two pane resize handles (role=separator) must expose aria-valuenow/min/max
 *   A11Y-007  the scrollable Job Card preview must be reachable with the keyboard
 *
 * Real-browser proof (axe over every module + dialog in all three themes, a Tab walk through
 * the sidebar) lives in the Playwright harness; this is the fast guard. The contrast checks
 * are NUMERIC: they parse the colours out of styles/globals.css and compute the WCAG ratio
 * against the real surface colours, so a future "tweak" that drops below 4.5 fails here.
 */
require('./setup.cjs');
const fs = require('fs'), path = require('path');
const React = require('react');
const { render, cleanup, fireEvent } = require('@testing-library/react');

let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const css = read('styles/globals.css');

// ---- WCAG 2 relative luminance / contrast ----------------------------------------------
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.replace('#', '').slice(i - 1, i + 1), 16));
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const over = (fg, a, bg) => fg.map((c, i) => c * a + bg[i] * (1 - a)); // fg at alpha a composited on bg

// Real surfaces text sits on (measured by axe on the production build).
const LIGHT_SURFACES = ['#e4f4ea', '#e7e6e2', '#eae2c6', '#ece4c9', '#efeeea', '#fbfaf6', '#fefdfa', '#f1efe8', '#e8e5db', '#f5f2ea'].map(rgbOf);
const DARK_SURFACES = ['#0a0a0a', '#121212', '#171717', '#1b1b1b', '#222222', '#12231d', '#1c130c', '#22170e', '#291e15'].map(rgbOf);
const minRatio = (fg, surfaces) => Math.min(...surfaces.map((s) => ratio(fg, s)));

console.log('\nA11Y-004 — Light theme: every remapped text colour is >= 4.5:1 on every light surface\n');
const lightRule = (needle) => {
  // the declaration colour of the rule whose selector list contains `needle`
  const re = /([^{}]*)\{\s*color:\s*(#[0-9a-fA-F]{6})\s*!important;\s*\}/g; let m;
  while ((m = re.exec(css))) if (m[1].includes(needle) && m[1].includes('data-theme="light"')) return m[2];
  return null;
};
const LIGHT_REMAPS = [
  ['grey (text-white/25..55)', '.text-white\\/55'],
  ['brand gold', '.text-\\[\\#d4af37\\]'],
  ['emerald', '.text-emerald-400'],
  ['red', '.text-red-400'],
  ['amber', '.text-amber-400'],
  ['blue', '.text-blue-400'],
  ['violet', '.text-violet-300'],
  ['sky', '.text-sky-400'],
  ['rose', '.text-rose-400'],
  ['pink', '.text-pink-400'],
  ['cyan', 'text-cyan-400/70'],
  ['inline grey (#9ca3af badges)', 'color: rgb(156, 163, 175)'],
  ['inline fg-rgb .4-.6 text', 'color: rgba(var(--fg-rgb),0.6)'],
];
for (const [name, needle] of LIGHT_REMAPS) {
  const c = lightRule(needle);
  const r = c ? minRatio(rgbOf(c), LIGHT_SURFACES) : 0;
  ok(`${name} -> ${c} is ${r.toFixed(2)}:1 at worst`, !!c && r >= 4.5, c ? `${r.toFixed(2)}:1` : `no light-theme rule matching ${needle}`);
}
// The old values this replaced were below AA — prove the check is meaningful (not vacuous).
ok('the previous light grey (#6b7280) really did fail on the light surfaces', minRatio(rgbOf('#6b7280'), LIGHT_SURFACES) < 4.5);
ok('the previous brand gold on light cards (#d4af37) really did fail', minRatio(rgbOf('#d4af37'), LIGHT_SURFACES) < 3);
ok('no light rule still uses the failing #6b7280 text grey', !/color:\s*#6b7280/.test(css));

console.log('\nA11Y-004 — Dark family (Dark / Dark+ / Balanced / Warm): secondary text is >= 4.5:1\n');
const dk = css.match(/:where\(:root:not\(\[data-theme="light"\]\)\) \.text-white\\\/40,\s*:where\(:root:not\(\[data-theme="light"\]\)\) \.text-white\\\/45 \{ color: rgba\(var\(--fg-rgb\), ([0-9.]+)\); \}/);
ok('text-white/45 (657 uses) and /40 are lifted in the dark family', !!dk);
const alpha = dk ? parseFloat(dk[1]) : 0;
const worstDark = Math.min(minRatio(over([255, 255, 255], alpha, [0, 0, 0]).map(Math.round), [[0, 0, 0]]), ...DARK_SURFACES.map((s) => ratio(over([255, 255, 255], alpha, s), s)));
ok(`white at alpha ${alpha} is ${worstDark.toFixed(2)}:1 at worst on the dark surfaces`, worstDark >= 4.5);
const warmWorst = Math.min(...DARK_SURFACES.map((s) => ratio(over([255, 248, 240], alpha, s), s)));
ok(`the Warm tint (255,248,240) at that alpha is ${warmWorst.toFixed(2)}:1 at worst`, warmWorst >= 4.5);
ok('the previous alpha (0.45) was below AA on the lighter card surfaces', Math.min(...DARK_SURFACES.map((s) => ratio(over([255, 255, 255], 0.45, s), s))) < 4.5);
ok('the lift uses :where() so hover:/group-hover: text colours (higher specificity) still win', /:where\(:root:not\(\[data-theme="light"\]\)\) \.text-white\\\/45/.test(css));
const redDim = css.match(/\.text-red-400\\\/70 \{ color: rgb\(248 113 113 \/ ([0-9.]+)\); \}/);
ok('dimmed destructive text (text-red-400/50..70) is lifted on dark surfaces', !!redDim);
const redRatio = redDim ? Math.min(...DARK_SURFACES.map((s) => ratio(over([248, 113, 113], parseFloat(redDim[1]), s), s))) : 0;
ok(`...to ${redRatio.toFixed(2)}:1 at worst`, redRatio >= 4.5);
ok('Light-theme colour rules never use [class*="text-red-400"] (it would also catch hover:text-red-400)', !/\[class\*="text-(red|emerald|amber|blue)/.test(css));
ok('the Job Card paper keeps brand gold on its black header in Light', /\.jc-paper \[style\*=" color: rgb\(212, 175, 55\)"\],\s*:root\[data-theme="light"\] \.jc-paper \[style\^="color: rgb\(212, 175, 55\)"\] \{ color: #d4af37 !important; \}/.test(css));
ok('...anchored, so WebKit\'s `border-left-color: rgb(212, 175, 55)` on section headings does NOT turn their text gold (gold on cream = 2:1)', !/\.jc-paper \[style\*="color: rgb\(212, 175, 55\)"\]/.test(css));

console.log('\nA11Y-004 — Job Card paper preview (fixed cream sheet in every theme)\n');
const jc = read('components/jobcards/JobCardModule.jsx');
const paper = jc.slice(jc.indexOf('Job card PDF preview'));
const PAPER = rgbOf('#f5f2ea');
const paperColours = [...paper.matchAll(/color: '(#[0-9a-fA-F]{3,6})'/g)].map((m) => m[1]).filter((c) => c.length === 7 || c.length === 4)
  .map((c) => (c.length === 4 ? '#' + [...c.slice(1)].map((x) => x + x).join('') : c));
const onCream = ['#5f5f5f', '#666666', '#7f5f06', '#0a7c42', '#1c1a16'];
ok('the cream-sheet text colours used by the preview are all >= 4.5:1 on #f5f2ea', onCream.every((c) => ratio(rgbOf(c), PAPER) >= 4.5), onCream.filter((c) => ratio(rgbOf(c), PAPER) < 4.5).join(','));
ok('the old preview greys (#777 #888 #999) and goldenrod (#b8860b) are gone', !/color: '#(777|888|999|b8860b)'/.test(paper.slice(0, 6000)));
ok('the preview colours in use are exactly the checked set (+ the white-on-black header text)', paperColours.every((c) => [...onCream, '#d4af37', '#ddd', '#ccc', '#aaa'].some((k) => k.toLowerCase() === c.toLowerCase()) || ['#dddddd', '#cccccc', '#aaaaaa'].includes(c.toLowerCase())), paperColours.join(','));
ok('light header text (#ddd/#ccc/#aaa/gold) sits on the near-black #161616 header and passes there', ['#dddddd', '#cccccc', '#aaaaaa', '#d4af37'].every((c) => ratio(rgbOf(c), rgbOf('#161616')) >= 4.5));

console.log('\nA11Y-004 — a hard-coded dark patch inside a themed UI\n');
const dash = read('components/InventoryDashboard.js');
const sidebar = read('components/inventory/Sidebar.jsx');       // main's refactor moved the sidebar here
const reports = read('components/inventory/views/ReportsView.jsx'); // ...and the donut chart here
ok("the donut-chart centre follows the theme (it was a fixed #141414 under text that turns dark in Light: 1.06:1)", /style=\{\{ background: 'var\(--surface-2\)' \}\}><span className="text-xs font-bold text-white\/70 tabular-nums"/.test(reports) && !/background: '#141414' \}\}><span className="text-xs font-bold text-white\/70/.test(reports));
ok('--surface-2 is still #141414 in the default Dark theme (pixel-identical there)', /--surface-2: #141414/.test(css));

// Found by the 375px axe pass (the bell/nav badge only renders in the mobile header).
ok('the header notification badge is white on red-600 (4.83:1), not red-500 (3.76:1)', ratio(rgbOf('#ffffff'), rgbOf('#dc2626')) >= 4.5 && ratio(rgbOf('#ffffff'), rgbOf('#ef4444')) < 4.5
  && /rounded-full bg-red-600 text-\[9px\] font-bold flex items-center justify-center" style=\{\{ color: '#fff' \}\}>\{it\.badge > 9/.test(dash));
ok('...and its white comes from an inline style, because Light mode force-darkens every .text-white (dark text on red would fail)', !/bg-red-500 text-white text-\[9px\]/.test(dash));

console.log('\nA11Y-005 — collapsed sidebar groups are out of the tab order\n');
const m = sidebar.match(/<div className="grid" inert=\{open \? undefined : ''\} style=\{\{ (gridTemplateRows: open[^`]*`[^`]*`) \}\}>/);
ok('a collapsed group is also `inert` (instant, engine-independent removal from tab order + a11y tree)', !!m);
ok('the collapsible wrapper sets visibility from the same `open` flag as its height', !!m && /gridTemplateRows: open \? '1fr' : '0fr'/.test(m[1]) && /visibility: open \? 'visible' : 'hidden'/.test(m[1]), m && m[1]);
ok('visibility is delayed 200ms on collapse and 0s on expand (explicit, so every engine hides AFTER the animation and shows immediately)', !!m && /transition: `grid-template-rows 200ms ease-out, visibility 0s linear \$\{open \? '0s' : '200ms'\}`/.test(m[1]), m && m[1]);
ok('the group header button still exposes aria-expanded', /<button onClick=\{\(\) => toggleGroup\(group\.key\)\} aria-expanded=\{open\}/.test(sidebar));
ok('icon-collapsed sidebar (collapsed prop) still forces every group open — nothing is hidden there', /const open = collapsed \? true : \(openGroups\[group\.key\] !== false\);/.test(sidebar));
// Runtime: reproduce the wrapper markup in jsdom — visibility:hidden elements must be unfocusable per spec,
// jsdom does not implement that, so assert the style the browser will honour on every descendant.
{
  const el = (open) => React.createElement('div', { 'data-t': 'wrap', style: { display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', visibility: open ? 'visible' : 'hidden' } },
    React.createElement('div', { style: { overflow: 'hidden' } }, React.createElement('button', null, 'Item')));
  const closed = render(el(false)).container.querySelector('[data-t="wrap"]');
  ok('closed group renders visibility:hidden (browser drops its buttons from Tab + the a11y tree)', closed.style.visibility === 'hidden' && closed.style.gridTemplateRows === '0fr');
  cleanup();
  const opened = render(el(true)).container.querySelector('[data-t="wrap"]');
  ok('open group renders visibility:visible', opened.style.visibility === 'visible' && opened.style.gridTemplateRows === '1fr');
  cleanup();
}

console.log('\nA11Y-006 — resize handles expose aria-valuenow / min / max\n');
const rp = read('components/common/ResizablePanes.jsx');
ok('Splitter takes valueNow / valueMin / valueMax and renders the three aria-value* attributes', /function Splitter\(\{[^}]*valueNow, valueMin, valueMax/.test(rp) && /aria-valuenow=/.test(rp) && /aria-valuemin=\{valueMin\}/.test(rp) && /aria-valuemax=\{valueMax\}/.test(rp));
ok('both splitters are fed from the pane they actually resize', /label="Resize Supplier Directory" valueNow=\{left\.width\} valueMin=\{left\.min\} valueMax=\{left\.max\}/.test(rp) && /label="Resize Purchase Order panel" valueNow=\{right\.width\} valueMin=\{right\.min\} valueMax=\{right\.max\}/.test(rp));
{
  const ResizablePanes = require('../components/common/ResizablePanes').default;
  const mk = (lw, rw) => React.createElement(ResizablePanes, {
    left: { min: 240, max: 420, width: lw, onWidthChange: () => {}, content: React.createElement('div', null, 'L') },
    center: { min: 400, max: 900, content: React.createElement('div', null, 'C') },
    right: { min: 280, max: 520, width: rw, onWidthChange: () => {}, content: React.createElement('div', null, 'R') },
  });
  let r = render(mk(300, 360));
  let seps = [...r.container.querySelectorAll('[role="separator"]')];
  ok('two focusable separators render', seps.length === 2 && seps.every((s) => s.getAttribute('tabindex') === '0'));
  ok('left handle: now=300 min=240 max=420', seps[0].getAttribute('aria-valuenow') === '300' && seps[0].getAttribute('aria-valuemin') === '240' && seps[0].getAttribute('aria-valuemax') === '420');
  ok('right handle: now=360 min=280 max=520', seps[1].getAttribute('aria-valuenow') === '360' && seps[1].getAttribute('aria-valuemin') === '280' && seps[1].getAttribute('aria-valuemax') === '520');
  ok('both keep their accessible names and orientation', seps[0].getAttribute('aria-label') === 'Resize Supplier Directory' && seps[1].getAttribute('aria-label') === 'Resize Purchase Order panel' && seps.every((s) => s.getAttribute('aria-orientation') === 'vertical'));
  ok('aria-valuetext reads in plain words', seps[0].getAttribute('aria-valuetext') === '300 pixels wide');
  r.rerender(mk(9999, 10));
  seps = [...r.container.querySelectorAll('[role="separator"]')];
  ok('an out-of-range width is clamped into [min,max] (valuenow can never fall outside the range)', seps[0].getAttribute('aria-valuenow') === '420' && seps[1].getAttribute('aria-valuenow') === '280');
  r.rerender(mk(300, 360));
  seps = [...r.container.querySelectorAll('[role="separator"]')];
  fireEvent.keyDown(seps[0], { key: 'ArrowRight' });
  ok('a keyboard resize does not break the handle (still a separator with values)', seps[0].getAttribute('role') === 'separator' && seps[0].hasAttribute('aria-valuenow'));
  cleanup();
  const hid = render(React.createElement(ResizablePanes, { left: { min: 240, max: 420, width: 300, onWidthChange() {}, content: 'L' }, center: { min: 400, max: 900, content: 'C' }, right: { min: 280, max: 520, width: 360, onWidthChange() {}, hidden: true, content: 'R' } }));
  ok('with the right pane hidden only ONE separator renders (no orphan handle)', hid.container.querySelectorAll('[role="separator"]').length === 1);
  cleanup();
}

console.log('\nA11Y-007 — the scrollable Job Card preview is keyboard reachable\n');
const pv = jc.slice(jc.indexOf('<div role="region" aria-label="Job card PDF preview"'), jc.indexOf('<div role="region" aria-label="Job card PDF preview"') + 520);
ok('the box that has maxHeight + overflowY:auto is a focusable named region (tabIndex 0)', /role="region"/.test(pv) && /aria-label="Job card PDF preview"/.test(pv) && /tabIndex=\{0\}/.test(pv) && /maxHeight: '82vh', overflowY: 'auto'/.test(pv));
ok('it shows a visible focus ring (focus-visible), not a silent focus', /focus-visible:ring-2/.test(pv) && /focus:outline-none/.test(pv));
ok('there is exactly one such region (no duplicate landmark name)', (jc.match(/aria-label="Job card PDF preview"/g) || []).length === 1);

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
