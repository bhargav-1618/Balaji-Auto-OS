/**
 * tests/jobcard-inspection.test.cjs — Job Card inspection workflow + AM/PM + Make.
 * Behavioural for logic, source guards for JSX wiring.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const s = fs.readFileSync(path.resolve(__dirname, '../components/jobcards/JobCardModule.jsx'), 'utf8');
// MiniSelect (Manufacturer/Model picker) was extracted to a shared component so Customers
// reuses the same fixed implementation instead of shipping a second dropdown system.
const miniSelectSrc = fs.readFileSync(path.resolve(__dirname, '../components/common/MiniSelect.jsx'), 'utf8');
// DateTimeField (Date & Time In / Promised Delivery, incl. the AM/PM group) was
// extracted to a shared component (global Date & Time consolidation pass) — it's no
// longer inline in JobCardModule.jsx.
const dtSrc = fs.readFileSync(path.resolve(__dirname, '../components/common/DateTimeField.jsx'), 'utf8');

console.log('\nJob Card — AM/PM, Make, inspection presets/select-all/custom, PDF\n');

// AM/PM round-trip (logic)
const parse = (v) => { if (!v) return { date: '', h12: '', m: '', ap: 'AM' }; const [d, t = ''] = v.split('T'); const [H = '', M = ''] = t.split(':'); const h = Number(H); const ap = h >= 12 ? 'PM' : 'AM'; const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h; return { date: d, h12: H === '' ? '' : String(h12), m: M, ap }; };
const build = ({ date, h12, m, ap }) => { if (!date) return ''; let H = Number(h12 || 0); if (ap === 'PM' && H < 12) H += 12; if (ap === 'AM' && H === 12) H = 0; return `${date}T${String(H).padStart(2, '0')}:${String(m === '' ? 0 : Number(m)).padStart(2, '0')}`; };
for (const c of ['2026-07-18T00:00', '2026-07-18T12:00', '2026-07-18T13:30', '2026-07-18T23:59']) ok(`AM/PM round-trips ${c}`, build(parse(c)) === c);
ok('AM/PM selector is a real button group (keyboard/mouse/mobile)', /role="group" aria-label="AM or PM"/.test(dtSrc));

// Make: no window.prompt (unreliable), inline add instead
ok('JobCardModule reuses the shared MiniSelect (no duplicate dropdown implementation)',
  /import MiniSelect from '\.\.\/common\/MiniSelect'/.test(s) && !/function MiniSelect\(/.test(s));
ok('Make add no longer uses window.prompt', !/window\.prompt\(addLabel\)/.test(miniSelectSrc));
ok('Make has inline "Add <query>" affordance', /Add &ldquo;\{q\.trim\(\)\}&rdquo;/.test(miniSelectSrc));
ok('shared MiniSelect owns outside-close via the portalled DropdownPanel (no local mousedown/ref.contains bug)',
  !/document\.addEventListener\('mousedown'/.test(miniSelectSrc) && /DropdownPanel anchorRef=\{ref\}/.test(miniSelectSrc));
ok('MiniSelect merges custom vehicles reactively (immediate refresh)', /catalog = useMemo/.test(s) && /\[customVehicles\]/.test(s));

// Inspection: presets, select-all, custom
ok('service presets exist (template dropdown)', /inspectionTemplate/.test(s) && /INSPECTION_TEMPLATE_NAMES\.map/.test(s));
ok('per-category Select All / None buttons', /setGroup\(true\)/.test(s) && /setGroup\(false\)/.test(s));
ok('select-all affects only that category (allKeys scoped to group)', /const allKeys = \[\.\.\.items, \.\.\.customs/.test(s));
ok('custom inspection items supported (inspectionCustom)', /inspectionCustom/.test(s));
ok('custom item add component present (no prompt)', /function CustomInspItem/.test(s) && /Add custom finding/.test(s));
ok('custom items persist in the card model', /inspection: \{\}, inspectionCustom: \{\}/.test(s));
ok('custom items can be removed', /inspectionCustom \|\| \{\}\)[\s\S]{0,80}\.filter\(\(x\) => x !== c\)/.test(s));

// PDF shows results (checked only) + customs, skips empty categories
ok('PDF renders inspection RESULTS (only checked items)', /const checkedStd = items\.filter\(\(it\) => tmplSet\.has\(it\) && card\.inspection\[it\]\)/.test(s));
ok('PDF includes custom findings', /\(custom\)/.test(s) && /inspectionCustom && card\.inspectionCustom\[title\]/.test(s));
ok('PDF skips empty categories (saves A4 space)', /\.filter\(\(\[, list\]\) => list\.length\)/.test(s));
ok('PDF has a clear empty-state when nothing inspected', /No inspection items marked/.test(s));

// ── PDF layout review: readability/spacing fixes ────────────────────────────
// Full Address previously used the same single-line boxRow as short fields:
// value.slice(0, 42) with no ellipsis — most real addresses were silently cut
// off mid-word. It now wraps with splitTextToSize into a box sized to fit.
ok('PDF: Full Address wraps instead of hard-truncating',
  /FULL ADDRESS/.test(s) && /addrLines = doc\.splitTextToSize\(String\(card\.address/.test(s));
ok('PDF: Full Address box grows to fit the wrapped lines', /boxH = Math\.max\(30, 13 \+ shown\.length \* 9\)/.test(s));

// Complaints/Diagnosis previously forced a minimum of 3 numbered rows even
// with nothing entered ("1. / 2. / 3." with nothing after them). Now shows one
// clear empty-state line when both sides are empty, and doesn't pad otherwise.
ok('PDF: Complaints/Diagnosis has an explicit empty-state (no forced blank rows)',
  /No complaints or diagnosis notes recorded/.test(s));
ok('PDF: Complaints/Diagnosis no longer forces a minimum of 3 rows',
  !/Math\.max\(comp\.length, diag\.length, 3\)/.test(s) && /Math\.max\(comp\.length, diag\.length, 1\)/.test(s));

// Signature lines previously sat right at the end of the terms/notes text with
// little air above them for an actual pen signature.
// Both signature blocks now route through the shared PDF_SPACING.signatureTopGap
// + drawSignatureBlock (lib/pdfTheme.js) instead of two independently hand-tuned
// magic numbers (34 vs 36) — same clearance, one shared source now.
ok('PDF: page 1 signature block uses the shared PDF_SPACING.signatureTopGap + drawSignatureBlock', /y \+= PDF_SPACING\.signatureTopGap;\s*\n\s*const sigY = drawSignatureBlock\(doc, y, 'AUTHORIZED CLIENT SIGNATURE'/.test(s));
// Batch 3 Defect 4/5: page 2's signature block now also passes through an
// ensureRoom() overflow guard between the gap and the draw call — a large
// Multi-Point Inspection result set or long combined notes must push the
// signature to a continuation page rather than draw it past the paper's bottom
// edge, so the old "gap immediately followed by drawSignatureBlock" adjacency
// intentionally no longer holds here. Assert the gap constant is still applied
// AND the guard now sits between it and the draw call.
ok('PDF: page 2 signature block still applies the shared PDF_SPACING.signatureTopGap',
  /y \+= PDF_SPACING\.signatureTopGap;\s*\n\s*ensureRoom\(30,/.test(s));
ok('PDF: page 2 signature now guarded so a long inspection/notes section pushes it to a new page instead of off the printable area',
  /ensureRoom\(30, 'WORKSHOP FLOOR & QUALITY CONTROL \(CONTINUED\)'\);\s*\n\s*drawSignatureBlock\(doc, y, 'TECHNICIAN SIGNATURE'/.test(s));

// Table cells previously had almost no gap between adjacent boxes (4pt).
ok('PDF: boxRow/boxRowW cells have more breathing room between them (was 4pt)',
  (s.match(/i < cols\.length - 1 \? 6 : 0/g) || []).length === 2);

// Inspection result categories previously had a tight 6pt gap between them.
// "Inspection groups require better separation" (Global PDF Framework readability
// pass): now the shared PDF_SPACING.groupGap (12pt) instead of a local literal that
// had already drifted once (6 -> 8) — one named constant, not a re-tuned copy.
ok('PDF: inspection category spacing uses the shared PDF_SPACING.groupGap', /iy \+= PDF_SPACING\.groupGap; colY\[col\] = iy;/.test(s));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
