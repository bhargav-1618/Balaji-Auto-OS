/**
 * tests/jobcard-workshop-section456-fix.test.cjs — Production-safe Job Card patch:
 * (1) workshop identity (real admin vs. demo) correctness across PDF + preview —
 *     every demo field (name/phone/GST/email/address/website) is a fixed, wholly
 *     fictional Job Card-only value; real admin gets the live configured shop as-is,
 * (2) Section 4 mandatory client complaint/request on save, communicated via the
 *     required asterisk + first-row placeholder only (no extra element that would
 *     misalign the Complaint/Diagnosis columns),
 * (3) Section 5 semantic relabel (warnings vs. inventory, no invented data),
 * (4) Section 6 explicit "No Body Damage" state as its own distinct Damage Status
 *     subsection (not another body-part chip), with PDF/preview consistency.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const jc = fs.readFileSync(path.resolve(__dirname, '../components/jobcards/JobCardModule.jsx'), 'utf8');

console.log('\nJob Card — workshop details + Section 4/5/6 production patch\n');

// --- A. Workshop details: real admin vs. demo ---
console.log('A. Workshop details');
ok('brandedShop (PDF) is built from the live Settings-driven shop, not a hardcoded literal',
  /const rawShop = liveShop\(demoMode\);/.test(jc));
ok('real admin (non-demo) PDF shop is the live shop, completely untouched', /: rawShop;/.test(jc));
ok('demo PDF shop is built by spreading rawShop directly — maskShop() is no longer called at all here (consolidated away, every field it set is now overridden anyway)',
  /\{ \.\.\.rawShop, name: DEMO_SHOP_NAME, phones: maskPhonePartial\(rawShop\.phones\), gst: DEMO_SHOP_GST, email: DEMO_SHOP_EMAIL, address: DEMO_SHOP_ADDRESS, website: DEMO_SHOP_WEBSITE \}/.test(jc));
ok('maskShop is no longer imported by Job Card (its only call site was removed)',
  !/import \{[^}]*maskShop[^}]*\} from '\.\.\/\.\.\/lib\/pdfTheme';/.test(jc));
ok('demo PDF shop name is masked to a sanitized identity (not the real configured name)',
  /name: DEMO_SHOP_NAME/.test(jc) && /const DEMO_SHOP_NAME = 'Demo Workshop';/.test(jc));
ok('demo PDF phone reveals only the first 2 digits (not a flat full mask) — the one field still derived from the real value, not a fixed constant',
  /phones: maskPhonePartial\(rawShop\.phones\)/.test(jc) &&
  /const maskPhonePartial = \(phone\) => \{[\s\S]{0,200}digits\.slice\(0, 2\) \+ 'x'\.repeat\(Math\.max\(digits\.length - 2, 0\)\)/.test(jc));
ok('on-screen "Job Card PDF Preview" panel uses the same demo name/phone masking as the real PDF',
  /\{demoMode \? DEMO_SHOP_NAME : previewShop\.name\}/.test(jc) &&
  /\{demoMode \? maskPhonePartial\(previewShop\.phones\) : previewShop\.phones\}/.test(jc));
ok('maskPhonePartial() is a pure derivation of the real phone (first 2 digits), not a second hardcoded shop-settings source',
  /digits\.slice\(0, 2\)/.test(jc) && !/const SHOP2|const DEMO_SETTINGS/.test(jc));

// --- A2. Demo identity realism (GST/email/address/website) — UX follow-up ---
console.log('\nA2. Demo identity realism (no unexplained flat XXXXXXXX fields)');
ok('demo GST is a fixed, wholly synthetic, already-partially-masked value',
  /const DEMO_SHOP_GST = '37A\*\*\*\*\*5ZF';/.test(jc));
ok('demo GST is never equal to the real configured GST used in this project (37AHTPK1459P1ZF)',
  !jc.includes('37AHTPK1459P1ZF'));
ok('demo email is a fixed, wholly fictional, already-partially-masked value', /const DEMO_SHOP_EMAIL = 'de\*\*@example\.com';/.test(jc));
ok('demo email is never the real configured email used in this project', !jc.includes('konabhargav2003@gmail.com'));
ok('demo address is a fixed, wholly fictional address with locality and PIN partially masked (not spelled out in full)',
  /const DEMO_SHOP_ADDRESS = '12 Demo Industrial Road, Gaj\*\*\*, Andhra Pradesh 53\*\*\*\*';/.test(jc));
// Only the constant's own value is checked (not the whole file) — the comment directly
// above it explains, by name, the real locality this replaced, which is expected,
// useful context, not a leak of the constant itself.
{
  const addressLine = (jc.match(/const DEMO_SHOP_ADDRESS = '[^']*';/) || [''])[0];
  ok('demo address value itself never spells out the real locality name in full', addressLine.length > 0 && !addressLine.includes('Gajuwaka'));
  ok('demo address value itself never contains the real street/landmark text or full real PIN', addressLine.length > 0 && !addressLine.includes('Pantulugari Meda') && !addressLine.includes('530026'));
}
ok('demo website has its own realistic sanitized value — the previously unexplained flat XXXXXXXX field',
  /const DEMO_SHOP_WEBSITE = 'demoworkshop\.example\.com';/.test(jc));
ok('PDF brandedShop applies every demo field (name/phone/GST/email/address/website) only in demo mode, real admin unaffected',
  /website: DEMO_SHOP_WEBSITE \}\s*\n\s*: rawShop;/.test(jc));
ok('preview panel applies the same demo GST/email/address/website as the real PDF',
  /\{demoMode \? DEMO_SHOP_ADDRESS : previewShop\.address\}/.test(jc) &&
  /\{demoMode \? DEMO_SHOP_GST : previewShop\.gst\}/.test(jc) &&
  /\{demoMode \? DEMO_SHOP_EMAIL : previewShop\.email\}/.test(jc) &&
  /\{demoMode \? DEMO_SHOP_WEBSITE : previewShop\.website\}/.test(jc));
ok('no field in the demo identity renders as a bare, unexplained flat mask anymore (MASK is now only the empty-phone fallback)',
  !/demoMode \? MASK : previewShop/.test(jc));

// --- B. Section 4: client complaint required on save ---
console.log('\nB. Section 4 — client complaint required');
ok('validate() blocks save when no complaint row has non-whitespace text',
  /if \(!card\.complaints\.some\(\(c\) => c\.trim\(\)\)\) return 'Add at least one client complaint or request before saving the Job Card\.';/.test(jc));
ok('validate() complaint check runs on the full save path only (after vehicle/VIN checks, same gate as every other required field)',
  /const vinErr = vinOk\(card\.vin\);[\s\S]{0,600}Add at least one client complaint or request/.test(jc));
ok('fieldErrors exposes a "complaints" key for inline, section-level display',
  /complaints: !card\.complaints\.some\(\(c\) => c\.trim\(\)\) \? 'Add at least one client complaint or request before saving the Job Card\.' : null,/.test(jc));
ok('Section 4 renders the inline error near the section (not only a toast)',
  /<Section n=\{4\} title="Client Instructions & Diagnostics">\s*\n\s*\{showErr\('complaints'\)/.test(jc));
ok('draft save is unaffected — still only requires a customer name (existing, intentional behavior)',
  /if \(asDraft\) \{\s*\n\s*if \(!card\.customer\?\.trim\(\)\) \{ toast\.error\('Customer name required — even for a draft\.'\); return; \}/.test(jc));
ok('"+ Add" / row add-remove behavior for complaints is untouched', /set\(\{ \[key\]: \[\.\.\.card\[key\], ''\] \}\)/.test(jc));
ok('"Copy previous" behavior for complaints is untouched', /const copyPrevious|copyPrevious\(key\)/.test(jc));

// --- B2. Section 4 UX follow-up: required marker WITHOUT breaking column alignment ---
console.log('\nB2. Section 4 — required-field UX, Complaint/Diagnosis columns stay aligned');
ok('the Complaint / Request label carries a red required asterisk (existing Field-style convention), diagnosis label does not',
  /\{label\}\{key === 'complaints' && <span className="text-red-400"> \*<\/span>\}/.test(jc));
ok('the red error banner (post-save-attempt case) is preserved, rendered ABOVE the 2-column grid so it never affects column-to-column alignment',
  /<Section n=\{4\} title="Client Instructions & Diagnostics">\s*\n\s*\{showErr\('complaints'\) && <p role="alert"[\s\S]{0,150}\n\s*<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">/.test(jc));
ok('no per-column helper paragraph exists between the label row and the input rows — this was the element that pushed Complaint\'s inputs down relative to Diagnosis\'s (regression, now removed)',
  !/key === 'complaints' && <p className="text-\[10px\] text-white\/45 mb-1\.5">/.test(jc));
ok('Complaint and Diagnosis columns now render an IDENTICAL structure between the label row and the input rows (label row, then straight into the space-y-1.5 input list) — this is what guarantees row-for-row alignment',
  /<\/div>\s*\n\s*<div className="space-y-1\.5">\s*\n\s*\{card\[key\]\.map/.test(jc));
ok('only the FIRST complaint row is marked aria-required (the rule is "at least one", not "every row")',
  /aria-required=\{key === 'complaints' && i === 0 \? true : undefined\}/.test(jc));
ok('the first complaint row\'s placeholder itself signals "required", the rest do not',
  /key === 'complaints' \? \(i === 0 \? 'Customer complaint \/ request \(required\)' : 'Customer complaint \/ request'\) : 'Technician diagnosis \/ note'/.test(jc));
ok('diagnosis rows are never marked required (no existing business rule requires it)', !/diagnosis.*aria-required=\{true\}/.test(jc));

// --- C. Section 5: semantic relabel, no invented data model ---
console.log('\nC. Section 5 — semantic relabel');
ok('Section 5 title reflects its real content (warnings + inventory), not a misnomer', /<Section n=\{5\} title="Vehicle Warning Indicators & Inventory Check">/.test(jc));
ok('old misleading title is gone from Section 5', !/<Section n=\{5\} title="Exterior Condition & Inventory Check">/.test(jc));
ok('sub-groups are labeled A (warnings) / B (inventory) so selections are unambiguous', /A\. Dashboard warning indicators on/.test(jc) && /B\. Inventory check — items present/.test(jc));
ok('no new data field invented for "exterior condition" — still the same warnings/invItems model', /warnings: \[\], warningsOther: '', invItems: \[\], invOther: ''/.test(jc));
ok('WARNINGS list (dashboard indicators) is unchanged', /const WARNINGS = \[/.test(jc) && /'Check Engine', 'ABS', 'Battery'/.test(jc));

// --- D. Section 6: explicit "No Body Damage" ---
console.log('\nD. Section 6 — No Body Damage');
ok('card model gains a noBodyDamage flag, defaulting to false (old saved records without it load as "unspecified", not "no damage")',
  /damages: \[\], damageOther: '', noBodyDamage: false,/.test(jc));
ok('"No Body Damage" uses the existing ChipToggle control (no new control type)',
  /<ChipToggle on=\{card\.noBodyDamage\} label="No Body Damage" onClick=\{toggleNoBodyDamage\} \/>/.test(jc));
ok('selecting "No Body Damage" clears any selected parts + custom damage text (Case A)',
  /const toggleNoBodyDamage = \(\) => \{\s*\n\s*set\(card\.noBodyDamage \? \{ noBodyDamage: false \} : \{ noBodyDamage: true, damages: \[\], damageOther: '' \}\);/.test(jc));
ok('selecting a damaged part clears "No Body Damage" (Case B), only when adding, not removing',
  /set\(\{ damages: has \? card\.damages\.filter\(\(d\) => d\.part !== part\) : \[\.\.\.card\.damages, \{ part, note: '' \}\], \.\.\.\(has \? \{\} : \{ noBodyDamage: false \}\) \}\);/.test(jc));
ok('multiple damaged parts remain selectable together (Case C) — toggle logic unchanged, additive', /card\.damages\.some\(\(d\) => d\.part === part\)/.test(jc));
ok('typing "Other damage" also clears "No Body Damage" (kept non-contradictory, Case D extended consistently)',
  /onChange=\{\(e\) => set\(\{ damageOther: e\.target\.value, \.\.\.\(e\.target\.value\.trim\(\) \? \{ noBodyDamage: false \} : \{\}\) \}\)\}/.test(jc));
ok('an empty selection is never auto-treated as "No Body Damage" (Case E) — no code path sets noBodyDamage true except the explicit toggle',
  (jc.match(/noBodyDamage: true/g) || []).length === 1);

// --- D2. Section 6 UX follow-up: "No Body Damage" as its own Damage Status subsection ---
console.log('\nD2. Section 6 — Damage Status is visually distinct from body-part chips');
ok('"No Body Damage" is rendered inside its own labeled "Damage Status" subsection, not inline with the body-part chip row',
  /<p className="text-\[10px\] uppercase tracking-wide text-white\/45 mb-1\.5">Damage Status<\/p>[\s\S]{0,200}<ChipToggle on=\{card\.noBodyDamage\}/.test(jc));
ok('the Damage Status subsection has its own bordered box (visual separation, reusing the existing damage-detail card style)',
  /<div className="rounded-xl p-2\.5 mb-3" style=\{\{ background: 'rgba\(var\(--fg-rgb\),0\.03\)', border: '1px solid rgba\(var\(--fg-rgb\),0\.06\)' \}\}>\s*\n\s*<p className="text-\[10px\] uppercase tracking-wide text-white\/45 mb-1\.5">Damage Status/.test(jc));
ok('explanatory text tells the user exactly when to use it', /Select this only when no visible body damage is present\./.test(jc));
ok('a divider separates Damage Status from the body-part chip grid below it', /<div className="h-px bg-white\/10 mb-3" \/>/.test(jc));
ok('the body-part chip grid is under its own "Damaged Body Parts" label, separate from Damage Status', /Damaged Body Parts/.test(jc));
ok('the body-part chip row itself no longer starts with the No Body Damage chip (moved out into its own subsection)',
  !/<div className="flex flex-wrap gap-1\.5 mb-3">\s*\n\s*<ChipToggle on=\{card\.noBodyDamage\}/.test(jc));

// --- E. PDF/preview data consistency for Sections 5 & 6 ---
console.log('\nE. PDF/preview consistency');
ok('PDF damages block shows "No Body Damage" explicitly when selected, distinct from an unspecified empty list',
  /y = drawChipList\(doc, M \+ 2, y, card\.noBodyDamage \? \[\] : dmg, listWidth, \{ emptyText: card\.noBodyDamage \? 'No Body Damage' : 'Not recorded' \}\);/.test(jc));
ok('compact "Job Card PDF Preview" panel mirrors the same No Body Damage / not-recorded distinction',
  /<b>Damages:<\/b> \{card\.noBodyDamage \? 'No Body Damage' : \(card\.damages\.length \|\| card\.damageOther/.test(jc));
ok('warnings/inventory PDF rendering is untouched (still reads card.warnings/invItems unchanged)',
  /const warnList = \[\.\.\.card\.warnings, \.\.\.\(card\.warningsOther \? \[card\.warningsOther\] : \[\]\)\];/.test(jc) &&
  /const invList = \[\.\.\.card\.invItems, \.\.\.\(card\.invOther \? \[card\.invOther\] : \[\]\)\];/.test(jc));

console.log(`\n${PASS} passed, ${FAIL} failed\n`);
if (FAIL) process.exit(1);
