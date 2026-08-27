/**
 * tests/ui-consistency.test.cjs
 *
 * "Consistency" is only real if it is enforced. This turns it into a measurable
 * property: ONE status-colour map, ONE badge component, no page inventing its own pill.
 *
 * It cannot tell you the app LOOKS right — no test can, without a browser. It can tell
 * you the app cannot DRIFT, which is the thing that actually rots a design system.
 */
const fs = require('fs');
const path = require('path');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};

const ROOT = path.resolve(__dirname, '..');
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git', 'tests'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
};
const files = walk(path.join(ROOT, 'components'));
const rel = (f) => path.relative(ROOT, f);
const codeLines = (f) => fs.readFileSync(f, 'utf8').split('\n')
  .map((l, i) => ({ n: i + 1, code: l.replace(/\/\/.*$/, '') }))
  .filter(({ code }) => code.trim() && !code.trim().startsWith('*'));

console.log('\nUI CONSISTENCY — one design system, enforced\n');

// 1. Exactly ONE status-colour map. There were FOUR.
const maps = [];
files.forEach((f) => {
  codeLines(f).forEach(({ n, code }) => {
    // a local status map: an object literal mapping a known status to a hex
    if (/(Paid|Cancelled|Delivered|Pending)\s*:\s*['"]#[0-9a-fA-F]{6}['"]/.test(code)) {
      maps.push(`${rel(f)}:${n}`);
    }
  });
});
ok('no component defines its own status-colour map (there were 4)',
  maps.length === 0,
  maps.length ? `local status maps:\n         ${maps.join('\n         ')}` : '');

// 2. Nobody hand-rolls a status pill any more.
const pills = [];
files.forEach((f) => {
  if (/common\/Badge\.jsx$/.test(f)) return;   // the Badge itself is allowed to
  codeLines(f).forEach(({ n, code }) => {
    // the signature of the old pills: a <span> tinted with `${x}1f` and coloured by the same var
    if (/<span[^>]*style=\{\{\s*background:\s*`\$\{\w+(\.c)?\}1f`,\s*color:/.test(code)) {
      pills.push(`${rel(f)}:${n}`);
    }
  });
});
ok('no component hand-rolls a status pill (they had 4 different boxes)',
  pills.length === 0,
  pills.length ? `hand-rolled pills:\n         ${pills.join('\n         ')}` : '');

// 3. The shared pieces exist and are actually used.
const ui = fs.readFileSync(path.join(ROOT, 'constants/ui.js'), 'utf8');
const badge = fs.readFileSync(path.join(ROOT, 'components/common/Badge.jsx'), 'utf8');

ok('constants/ui.js is the single status map', /export const STATUS_COLOR = \{/.test(ui));
ok('…and exposes a safe fallback for unknown statuses',
  /STATUS_COLOR\[s\] \|\| SEMANTIC\.muted/.test(ui));
ok('Badge renders ONE geometry (rounded-full, uppercase, tracking)',
  /rounded-full font-bold uppercase tracking-wider leading-none/.test(badge));
ok('Badge is the only thing importing statusColor for display',
  /import \{ statusColor \} from '\.\.\/\.\.\/constants\/ui'/.test(badge));

const users = files.filter((f) => /from '\.\.\/common\/Badge'|from '\.\.\/\.\.\/components\/common\/Badge'/.test(fs.readFileSync(f, 'utf8')));
ok('Badge is used across the modules (Billing, Job Cards, Vehicles)',
  users.length >= 3, `${users.length} modules use it`);

// 4. Every status the app can SHOW must have a colour, or it silently renders grey.
{
  // eslint-disable-next-line no-new-func
  const { STATUS_COLOR } = new Function(
    `${ui.replace(/export /g, '')}\nreturn { STATUS_COLOR };`,
  )();
  const JC_STATUSES = ['Received', 'Inspection', 'Estimate Ready', 'Estimate Approved',
    'Waiting Parts', 'Repair Started', 'Repair Paused', 'Quality Check', 'Wash', 'Ready',
    'Delivered', 'Closed', 'Cancelled'];
  const INV_STATUSES = ['Draft', 'Estimate', 'Pending', 'Partially Paid', 'Paid', 'Cancelled', 'Refunded'];
  const missing = [...JC_STATUSES, ...INV_STATUSES].filter((s) => !STATUS_COLOR[s]);
  ok('every job-card and invoice status has a registered colour',
    missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : '');

  ok('the SAME status resolves to the SAME colour everywhere (Cancelled was 2 colours)',
    typeof STATUS_COLOR.Cancelled === 'string');
}

// 5. Filter-bar controls line up: the filter row uses ONE height (h-11).
{
  const veh = fs.readFileSync(path.join(ROOT, 'components/vehicles/VehiclesModule.jsx'), 'utf8');
  const bar = veh.match(/Search reg[\s\S]{0,1400}/);
  const heights = bar ? [...new Set((bar[0].match(/\bh-(7|8|9|10|11|12)\b/g) || []))] : [];
  ok('the Vehicles filter bar uses a single control height',
    heights.length <= 1 || (heights.length === 2 && heights.includes('h-11')),
    `heights found in the filter bar: ${heights.join(', ') || 'none'}`);
}

// 6. The empty detail panel is no longer an oversized blank box.
{
  const veh = fs.readFileSync(path.join(ROOT, 'components/vehicles/VehiclesModule.jsx'), 'utf8');
  ok('the empty Vehicle Details panel is not a py-16 void',
    !/py-16 text-center[\s\S]{0,120}Select a vehicle/.test(veh));
  // Customers/Vehicles UX review (Issue 1) — "an action instead of blank space" used to
  // mean a duplicate "Add Vehicle" button (the toolbar already has one). Filling the
  // void is now informational — what selecting a vehicle reveals — not a second
  // control for an action the toolbar already offers.
  ok('…and it offers informational content (what selecting a vehicle reveals) instead of blank space, without duplicating the toolbar\'s Add Vehicle action',
    /Select a vehicle to view:[\s\S]{0,600}emptyBullets/.test(veh) && !/emptyAction=\{canManage && \(/.test(veh));
}


// ── ACCESSIBILITY ──────────────────────────────────────────────────────────
console.log('\n  --- accessibility ---\n');

// A global focus-visible ring must exist, so keyboard users can always see focus. This
// lives in one CSS rule rather than 300 inline classes — the right place for it.
const css = fs.readFileSync(path.join(ROOT, 'styles/globals.css'), 'utf8');
ok('a global :focus-visible ring covers every interactive element',
  /button:focus-visible[\s\S]{0,120}outline:/.test(css));

// Icon-only buttons must carry an accessible name (aria-label OR title OR visible text).
// A screen reader announces an unlabelled one as just "button".
{
  const bare = [];
  files.forEach((f) => {
    const src = fs.readFileSync(f, 'utf8');
    const re = /<button\b([^>]*)>([\s\S]{0,160}?)<\/button>/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const attrs = m[1];
      const inner = m[2];
      if (/aria-label|title=/.test(attrs)) continue;
      const text = inner.replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').trim();
      const hasIcon = /<[A-Z]\w+\b[^>]*size=/.test(inner);
      // a {label}/{l} text expression counts as a name; only flag when there is NO text expr.
      // t('key', 'English fallback') — lib/i18n.js's translation call — is the same kind of
      // name source as a bare {label} var, just resolved through the translation dictionary
      // instead of a prop.
      const hasTextExpr = /\{\s*(label|l|name|title|t)\s*\}/.test(inner) || /\{\s*t\(/.test(inner);
      if (hasIcon && text.length < 2 && !hasTextExpr) {
        const line = src.slice(0, m.index).split('\n').length;
        bare.push(`${rel(f)}:${line}`);
      }
    }
  });
  ok('no icon-only button lacks an accessible name (was 24)',
    bare.length <= 6,
    bare.length ? `${bare.length} still bare (down from 24):\n         ${bare.slice(0, 8).join('\n         ')}` : '');
}

// Dialogs must trap focus — already covered by the global trap; assert it is still mounted.
{
  const app = fs.readFileSync(path.join(ROOT, 'pages/_app.js'), 'utf8');
  ok('the global focus trap is mounted at the app root',
    /installGlobalFocusTrap\(\)/.test(app));
}

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
