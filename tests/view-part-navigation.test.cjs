/**
 * tests/view-part-navigation.test.cjs
 *
 * ISSUE — INVENTORY → PARTS: VIEW (EYE) ACTION MUST OPEN THE SELECTED PART DIRECTLY.
 *
 * The only "View Part" eye icon in the app lives in the Suppliers module's parts list
 * (components/inventory/SupplierDirectory.jsx), wired through onViewPart in
 * InventoryDashboard.js. Neither its same-tab fallback nor the `open=inventory:<key>`
 * deep-link it opens in a new tab ever set invSubView — both silently landed on the
 * generic Inventory Dashboard sub-view (invSubView defaults to 'dashboard') instead of
 * Parts with the part open, leaving the user to find the part again. This suite verifies
 * the fix: one shared openPartDetail() function is now the canonical way any entry point
 * opens a specific part, reusing PartModal (the same "view/edit a part" experience every
 * other entry point in this app already uses) rather than a second/duplicate one.
 *
 * Source-pattern assertions, matching this repo's established test convention.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const R = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nView Part (eye icon) navigation — lands on Parts with the exact part open\n');

const inv = R('components/InventoryDashboard.js');

// --- Part 1: openPartDetail is the ONE shared "view a part" function ---
ok('openPartDetail lands on the inventory tab, not wherever the click happened to be',
  /const openPartDetail = useCallback\(\(part\) => \{[\s\S]{0,50}setActiveTab\('inventory'\);/.test(inv));
ok('openPartDetail explicitly opens the Parts sub-view (the actual bug: this was never set anywhere)',
  /const openPartDetail = useCallback\(\(part\) => \{[\s\S]{0,100}setInvSubView\('parts'\);/.test(inv));
ok('openPartDetail widens invFilter only when the part\'s OWN archived state would otherwise hide it — never blindly forces a filter change',
  /setInvFilter\(\(prev\) => \{\s*if \(part\.archived\) return \(prev === 'archived' \|\| prev === 'all'\) \? prev : 'archived';\s*return \(prev === 'active' \|\| prev === 'all'\) \? prev : 'active';\s*\}\);/.test(inv));
ok('openPartDetail opens the SAME PartModal every other "view/edit a part" action uses (setEditPart + setShowModal) — no second/duplicate detail UI',
  /const openPartDetail = useCallback\(\(part\) => \{[\s\S]{0,400}setEditPart\(part\);\s*setShowModal\(true\);/.test(inv));
ok('openPartDetail sets highlightPartId so the row stays identifiable in the table once the modal closes',
  /const openPartDetail = useCallback\(\(part\) => \{[\s\S]{0,400}setHighlightPartId\(part\.id\);/.test(inv));
ok('openPartDetail guards against a null/undefined part (stale reference) rather than crashing',
  /const openPartDetail = useCallback\(\(part\) => \{\s*if \(!part\) return;/.test(inv));

// --- Part 2: the Suppliers module's eye icon uses openPartDetail for BOTH the
// popup-blocked fallback and the try/catch fallback — no separate inline sequence
// that could drift out of sync with the canonical one ---
ok('Suppliers\' onViewPart popup-blocked fallback calls openPartDetail, not a bespoke setActiveTab/setSearch/setHighlightPartId sequence',
  /if \(!w\) openPartDetail\(p\);/.test(inv));
ok('Suppliers\' onViewPart catch-block fallback also calls openPartDetail (same function, not a second copy)',
  /catch \{ openPartDetail\(p\); \}/.test(inv));
ok('the new-tab path is untouched — it still opens the same deep-link URL format (only the destination it resolves to changed)',
  /window\.open\(`\/\?open=inventory:\$\{encodeURIComponent\(key\)\}#inventory`, '_blank'\)/.test(inv));

// --- Part 3: the on-load URL-parse branch sets invSubView SYNCHRONOUSLY, in the same
// block as setActiveTabRaw — no frame where the Dashboard sub-view is visible first ---
ok('the `open=inventory:<key>` URL branch sets invSubView(\'parts\') synchronously on parse, not only once the async part-lookup resolves',
  /tabPart === 'inventory' && query\) \{[\s\S]{0,700}setInvSubView\('parts'\);/.test(inv));
ok('the URL branch no longer force-narrows the Parts search box to the SKU (PartModal itself is now the destination, so clobbering the user\'s own search state is unnecessary)',
  !/tabPart === 'inventory' && query\) \{[\s\S]{0,700}setSearch\(query\);/.test(inv));

// --- Part 4: the deep-link-consuming effect resolves the part via openPartDetail, and
// handles the stale/deleted-part case safely (never a blank Parts page) ---
ok('the consuming effect calls openPartDetail on a successful lookup, not a bare setHighlightPartId (which never opened anything)',
  /const hit = inventory\.find[\s\S]{0,150}if \(hit\) \{\s*openPartDetail\(hit\);/.test(inv));
ok('a stale/deleted part (or bad key) shows an explicit "Part no longer exists" message instead of a silent no-op or a blank Parts page',
  /toast\.error\('Part no longer exists\.'\);/.test(inv));
ok('the not-found branch still lands the user on Parts (not stuck on the Dashboard sub-view) even though no specific part could open',
  /toast\.error\('Part no longer exists\.'\);\s*setInvSubView\('parts'\);/.test(inv));
ok('the pending localStorage key is only consumed once inventory has actually loaded — reading AND removing it while the array is still empty would silently swallow the deep-link before it could ever resolve',
  /if \(!q \|\| !inventory\.length\) return;\s*try \{ localStorage\.removeItem\('maruti_inventory_highlight'\); \} catch \{\}/.test(inv));

// --- Part 5: same navigation-bug class, fixed at the adjacent Command Palette entry
// point found during the audit (category drill-down landed on the Dashboard too) ---
ok('Command Palette category pick also lands on the Parts sub-view, not the generic Inventory Dashboard (same root cause as the eye icon, fixed the same way)',
  /onPickCategory=\{\(c\) => \{ setActiveTab\('inventory'\); setInvSubView\('parts'\); setCategoryFilter\(c\); \}\}/.test(inv));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
