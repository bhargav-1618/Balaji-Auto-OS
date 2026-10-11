/**
 * tests/a11y-accessible-names.test.cjs
 *
 * QA report A11Y-001 (21 drop-downs with no accessible name), A11Y-002 (44 icon-only buttons
 * with no accessible name) and A11Y-003 (27 form fields with no label), as measured by
 * axe-core 4.10 on the local production build.
 *
 * Real-browser verification (axe over every module in all three themes) lives in the
 * Playwright harness; THIS file is the fast guard that keeps the fixes from regressing:
 *
 *  - every native <select> anywhere in the UI carries a purposeful aria-label
 *  - the specific icon-only buttons / checkboxes / read-only input axe flagged are named
 *
 * Source-assertion style, matching this repo's convention.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : /\.(js|jsx)$/.test(e.name) ? [p] : [];
});

/**
 * Opening tags `<tag ...>` with their full attribute text. A regex can't do this: JSX
 * attributes contain `=>` and `>` inside braces/strings, so scan with brace + quote depth.
 * Only matches `<tag` followed by whitespace (skips `<select>` quoted in comments).
 */
function openingTags(src, tag) {
  const out = [];
  const re = new RegExp(`<${tag}(?=\\s)`, 'g');
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length, depth = 0, q = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (q) { if (c === q && src[i - 1] !== '\\') q = null; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    out.push({ end: i + 1, text: src.slice(m.index, i + 1), line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

const files = ['components', 'pages'].flatMap((d) => walk(path.join(ROOT, d)));

console.log('\nA11Y-001 — every native <select> has an accessible name\n');
let total = 0; const unnamed = [];
files.forEach((f) => {
  openingTags(fs.readFileSync(f, 'utf8'), 'select').forEach((t) => {
    total++;
    if (!/aria-label(ledby)?=/.test(t.text)) unnamed.push(`${path.relative(ROOT, f)}:${t.line}`);
  });
});
// main's dropdown-standardisation work converted most native selects to MiniSelect (named by its own visible value);
// the ones that remain native are exactly the ones this guard covers.
ok(`found the native selects to check (${total})`, total >= 8, String(total));
ok('none is without aria-label / aria-labelledby', unnamed.length === 0, unnamed.join(', '));
// The label must say what the control DOES — a generic word is as useless as no name.
const generic = [];
files.forEach((f) => openingTags(fs.readFileSync(f, 'utf8'), 'select').forEach((t) => {
  const m = t.text.match(/aria-label="([^"]*)"/);
  if (m && /^(select|dropdown|combobox|choose|option|list)$/i.test(m[1].trim())) generic.push(`${path.relative(ROOT, f)}:${t.line} "${m[1]}"`);
}));
ok('no select is labelled with a generic word like "Dropdown"', generic.length === 0, generic.join(', '));

console.log('\nA11Y-001 — spot checks: labels name the real purpose and are distinct within a screen\n');
const bill = read('components/billing/BillingModule.jsx');
ok('Billing: the remaining native select (page size) is named; its filters are MiniSelect comboboxes', bill.includes('aria-label="Invoices per page"') && /<MiniSelect value=\{statusF\}/.test(bill) && /<MiniSelect value=\{payModeF\}/.test(bill));
const ledger = read('components/common/LedgerPage.jsx');
ok('shared LedgerPage (Sales, Services, Stock In, Stock Out) names range/type/sort/rows', ['Date range', 'Filter by type', 'Sort by', 'Rows per page'].every((s) => ledger.includes(`aria-label="${s}"`)));
const rem = read('components/reminders/RemindersModule.jsx');
ok('Reminders filters are MiniSelect comboboxes (named by their visible value; axe-verified)', /<MiniSelect value=\{kindF\}/.test(rem) && /<MiniSelect value=\{statusF\}/.test(rem));
const jc = read('components/jobcards/JobCardModule.jsx');
ok('per-damage selects name the damaged part', /aria-label=\{`Damage type for \$\{d\.part\}`\}/.test(jc) && /aria-label=\{`Damage severity for \$\{d\.part\}`\}/.test(jc));
const dash = read('components/InventoryDashboard.js');
ok('Settings SetSel (now components/inventory/ui/SettingsControls.jsx) uses its own visible label as the accessible name', /<select aria-label=\{label\} value=\{value\}/.test(read('components/inventory/ui/SettingsControls.jsx')));

console.log('\nA11Y-002 — icon-only buttons are named for their action\n');
ok('Job Card: remove complaint / diagnosis row', /aria-label=\{`Remove \$\{key === 'complaints' \? 'complaint' : 'diagnosis note'\} \$\{i \+ 1\}`\}/.test(jc));
ok('Job Card: remove labour line (names the service when there is one)', /aria-label=\{lb\.service \? `Remove labour line \$\{i \+ 1\}: \$\{lb\.service\}` : `Remove labour line \$\{i \+ 1\}`\}/.test(jc));
ok('Job Card: add custom finding names its inspection section', /function CustomInspItem\(\{ onAdd, group = '' \}\)/.test(jc) && /aria-label=\{`Add \$\{what\}`\}/.test(jc) && /group=\{group\} \/>/.test(jc));
ok('Job Card: the hover-only remove-custom-finding button is named and visible on keyboard focus', /aria-label=\{`Remove custom finding \$\{c\}`\}[^>]*focus-visible:opacity-100/.test(jc));
ok('Billing: pager buttons are named', bill.includes('aria-label="Previous page"') && bill.includes('aria-label="Next page"'));
const po = read('components/inventory/SupplierPOBuilder.jsx');
ok('Supplier PO builder: part toggle is named and exposes its state', /aria-pressed=\{on\} aria-label=\{`Add \$\{p\.name\} to purchase order`\}/.test(po));
ok('Supplier PO builder: quantity stepper (buttons + input) is named', /Decrease quantity of \$\{p\.name\}/.test(po) && /Increase quantity of \$\{p\.name\}/.test(po) && /Order quantity of \$\{p\.name\}/.test(po));
ok('decorative icons inside the newly named buttons are hidden from assistive tech', (jc.match(/aria-hidden="true"/g) || []).length >= 4 && /<Check size=\{13\} className="text-black" aria-hidden="true" \/>/.test(po));

console.log('\nA11Y-003 — the unlabeled fields axe flagged now have names\n');
ok('Billing: header select-all checkbox', bill.includes('aria-label="Select all invoices on this page"'));
ok('Billing: each row checkbox names its invoice', /aria-label=\{`Select invoice \$\{iv\.invNo \|\| iv\.customer \|\| 'draft'\}`\}/.test(bill));
// The read-only auto-generated Job Card No. input (the 1 Job Card field axe flagged) is named by
// its VISIBLE "Job Card No." caption through Field -> useLabelledControl, so the accessible name
// contains the visible text (WCAG 2.5.3 Label in Name) instead of a second, different string.
ok('Job Card: Field ties its visible label to the control (this names the read-only Job Card No. input)',
  /function Field\(\{ label, req, error, errorId, sub, children \}\) \{\s*\n\s*const \{ id, content \} = useLabelledControl\(children\);/.test(jc)
  && /<label htmlFor=\{id\} className="block text-\[10px\]/.test(jc) && /<Field label="Job Card No\."/.test(jc));
ok('every form-field helper (Billing, Job Cards, Customers x2, Vehicles) associates label -> control', [
  [bill, /function Field\(\{ label, children, className = '', error \}\) \{\s*\n\s*const \{ id, content \} = useLabelledControl\(children\);/],
  [jc, /function Field\(\{ label, req, error, errorId, sub, children \}\) \{\s*\n\s*const \{ id, content \} = useLabelledControl/],
  [read('components/customers/CustomersModule.jsx'), /function Field\(\{ label, req, error, children, className = '' \}\) \{\s*\n\s*const \{ id, content \} = useLabelledControl/],
  [read('components/customers/CustomersModule.jsx'), /function F\(\{ label, req, error, warn, children, className = '' \}\) \{\s*\n\s*const \{ id, content \} = useLabelledControl/],
  [read('components/vehicles/VehiclesModule.jsx'), /function WField\(\{ label, req, error, children, className = '' \}\) \{\s*\n\s*const \{ id, content \} = useLabelledControl/],
].every(([src, re]) => re.test(src)));
const checks = []; files.forEach((f) => openingTags(fs.readFileSync(f, 'utf8'), 'input').forEach((t) => {
  if (/type="checkbox"/.test(t.text) && /selected\.has\(|selectedIds\.has\(/.test(t.text) && !/aria-label=/.test(t.text)) checks.push(`${path.relative(ROOT, f)}:${t.line}`);
}));
ok('no row-selection checkbox in any list is unnamed', checks.length === 0, checks.join(', '));

console.log('\nA11Y-002 — no icon-only <button> is left without an accessible name (repo-wide guard)\n');
// A button whose only children are icon components (<X />, <Trash2 />, …) has no text for a
// screen reader; it needs aria-label / aria-labelledby / title.
const iconOnlyBad = []; let iconOnlyTotal = 0;
files.forEach((f) => {
  const src = fs.readFileSync(f, 'utf8');
  openingTags(src, 'button').forEach((t) => {
    if (t.text.endsWith('/>')) return;
    const close = src.indexOf('</button>', t.end); if (close < 0) return;
    const inner = src.slice(t.end, close).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').trim();
    const iconOnly = /^(?:<[A-Z][A-Za-z0-9]*\b[^<>]*?\/>\s*)+$/.test(inner) || /^\{[^{}]*&&\s*<[A-Z][A-Za-z0-9]*\b[^<>]*\/>\}$/.test(inner);
    if (!iconOnly) return;
    iconOnlyTotal++;
    if (!/aria-label=|aria-labelledby=|title=/.test(t.text)) iconOnlyBad.push(`${path.relative(ROOT, f)}:${t.line}`);
  });
});
ok(`found the icon-only buttons to check (${iconOnlyTotal})`, iconOnlyTotal >= 60, String(iconOnlyTotal));
ok('every icon-only <button> carries aria-label / aria-labelledby / title', iconOnlyBad.length === 0, iconOnlyBad.join(', '));
ok('the dialog close buttons axe flagged (New Invoice, Add Reminder, Confirm) are named', [
  ['components/billing/BillingModule.jsx', /<button aria-label="Close invoice" onClick=\{guardedClose\}/],
  ['components/reminders/RemindersModule.jsx', /<button aria-label="Close add reminder"/],
  ['components/common/ConfirmDialog.jsx', /<button aria-label="Close dialog"/],
].every(([f, re]) => re.test(read(f))));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
