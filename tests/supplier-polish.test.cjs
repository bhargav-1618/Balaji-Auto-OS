/**
 * tests/supplier-polish.test.cjs — Suppliers module: verifies existing UX features are
 * present + the polish applied (stat-card clip-safety, overflow-menu Escape).
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const dir = fs.readFileSync(path.resolve(__dirname, '../components/inventory/SupplierDirectory.jsx'), 'utf8');
const po = fs.readFileSync(path.resolve(__dirname, '../components/inventory/SupplierPOBuilder.jsx'), 'utf8');

console.log('\nSuppliers — UX polish + feature presence\n');

// applied fixes
ok('overview stat values are clip-safe (truncate + tabular + title)', /text-lg font-bold mt-0\.5 tabular-nums truncate[\s\S]{0,200}title=\{String\(v\)\}/.test(dir));
ok('stat cards use min-w-0 so they can shrink', /rounded-xl p-3 min-w-0/.test(dir));
// Escape / outside-click for the overflow menu are owned by the shared
// <DropdownPanel> (components/common/DropdownPanel.jsx — one Escape listener and
// one pointerdown listener for every dropdown in the app, not a bespoke pair per
// module). UNIVERSAL ISSUE U3: the menu itself now renders through the shared
// <ActionMenu>, which composes DropdownPanel internally, so this still holds —
// assert the menu is wired through ActionMenu instead of DropdownPanel directly.
ok('overflow menu uses the shared ActionMenu (which composes DropdownPanel for Escape/outside-click)', /<ActionMenu anchorRef=\{menuRef\}/.test(dir));
ok('DropdownPanel owns Escape-to-close for every dropdown', /if \(e\.key === 'Escape'\)/.test(fs.readFileSync(path.resolve(__dirname, '../components/common/DropdownPanel.jsx'), 'utf8')));

// existing features (presence — regression guard)
// Placeholder now routes through lib/i18n.js's t('key', 'English fallback').
ok('supplier search present', /placeholder=\{t\('suppliers\.searchPlaceholder', 'Search name, code, city, GST/.test(dir));
// An 'Archived' filter was added after this assertion was written (7th entry, alongside
// an Archive/Restore Supplier action — see the overflow-menu assertion below).
ok('status filters present', /\['All', 'Active', 'Preferred', 'Inactive', 'Blocked', 'Outstanding', 'Archived'\]/.test(dir));
ok('sort options present', /\['recent', 'Recently Added'\]/.test(dir) && /\['rating', 'Rating'\]/.test(dir));
ok('list pagination present', /LIST_PER/.test(dir));
ok('selected supplier highlighted', /on \? 'bg-\[#d4af37\]\/12/.test(dir));
// Tab labels now route through lib/i18n.js's t('key', 'English fallback').
ok('detail tabs present (6)', /\['overview', t\('common\.overview', 'Overview'\)\][\s\S]{0,300}\['docs', t\('common\.documents', 'Documents'\)\]/.test(dir));
ok('parts rows expose explicit actions (View + Add to PO)', /onViewPart\?\.\(p\)/.test(dir) && /onAddToPO\(p, selected\)/.test(dir));
ok('parts tab has its own search + pagination', /Search parts in this supplier/.test(dir) && /partsPageCount > 1/.test(dir));
ok('empty states present (POs/txns/notes/docs)', /No purchase orders for this supplier yet/.test(dir) && /No notes for this supplier/.test(dir));
ok('select-a-supplier empty state', /Select a Supplier/.test(dir));

// PO builder integrity
ok('PO subtotal/gst/grand computed', /const subtotal = /.test(po) && /const gst = /.test(po) && /const grand = subtotal \+ gst/.test(po));
ok('PO WhatsApp + PDF generation intact', /wa\.me|whatsapp/i.test(po) && /doc\.text/.test(po));



// ── Phase A: layout, filter counts/summary, part actions, dedup nav ──────────
(function phaseA() {
  const po = fs.readFileSync(path.resolve(__dirname, '../components/inventory/SupplierPOBuilder.jsx'), 'utf8');
  const dash = fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8');

  // Part 1 layout — Suppliers workspace review: the 3 columns went from fixed
  // xl:w-[320px]/xl:w-[300px] to a user-resizable ResizablePanes workspace (see
  // components/common/ResizablePanes.jsx). 320/300 are now only the DEFAULT widths a
  // fresh mount starts at, not a hard rule — verify the new architecture instead of the
  // literal classes that no longer exist.
  ok('directory defaults to 320px (still adjustable, no longer a fixed rule)', /const \[dirWidth, setDirWidth\] = useState\(320\)/.test(dir));
  ok('PO panel defaults to 300px (still adjustable, no longer a fixed rule)', /const \[poWidth, setPoWidth\] = useState\(300\)/.test(dir));
  ok('the 3-column workspace is rendered through the shared ResizablePanes primitive, not bespoke flex classes', /<ResizablePanes/.test(dir));
  ok('pane min/max bounds are content-derived constants, not magic numbers scattered inline', /PANE_BOUNDS = \{/.test(dir));

  // Part 2 filter counts + summary + clear
  // Chip label now routes through lib/i18n.js's t('key', 'English fallback').
  ok('filter chips show live counts', /\(\{filterCounts\[f\] \?\? 0\}\)/.test(dir));
  ok('filterCounts respects search, independent of active chip', /const filterCounts = useMemo/.test(dir) && /STATUS_FILTERS\.forEach/.test(dir));
  ok('result summary "Showing N <Filter> Suppliers"', /Showing \{listShown\.length\} \{statusF === 'All' \? '' : `\$\{statusF\} `\}Supplier/.test(dir));
  ok('Clear Filters in summary + empty state', /No suppliers match your current filters/.test(dir) && /setStatusF\('All'\); setListQ\(''\)/.test(dir));
  ok('scroll resets on filter/sort/search change', /listScrollRef\.current\.scrollTop = 0/.test(dir));
  ok('active chip has clear styling + transition', /transition-all duration-150[\s\S]{0,120}shadow-\[#d4af37\]/.test(dir));
  // Renamed active -> browsable alongside the Archived-filter addition above: the
  // filtered list can now legitimately include archived suppliers (when that filter is
  // selected), so a variable named `active` no longer described what it held.
  ok('shared passesStatus is single source of truth', /let list = browsable\.filter\(\(s\) => passesStatus\(s, statusF\)\)/.test(dir));

  // Part 3 PO filter summary + scroll reset (counts already existed)
  ok('PO filter chips show counts', /chip\('low', 'Low Stock', counts\.low\)/.test(po));
  // Supplier-aware PO panel review — reworded from "Showing N Parts" to "N matches for
  // <filter>" (the panel can now show TWO grouped sections at once, so a single flat
  // "Showing N Parts" summary line no longer describes what's on screen).
  ok('PO result summary present', /\{list\.length\} match\{list\.length === 1/.test(po));
  ok('PO list scroll resets on filter/search', /poListRef\.current\.scrollTop = 0/.test(po));
  ok('PO empty state has Clear Filters', /No parts match your filters/.test(po));

  // Part 4 dedup nav
  ok('overflow menu has no Purchase History nav', !/label: 'Purchase History'/.test(dir));
  ok('overflow menu has no Transactions nav', !/label: 'Transactions'/.test(dir));
  // Labels now route through lib/i18n.js's t('key', 'English fallback'). The
  // archive/restore item also gained a ternary (selected?.archived ? Restore : Archive)
  // alongside the Archived-filter addition above, so "Archive Supplier" no longer
  // follows `label:` directly — it's the false branch of that ternary.
  ok('overflow menu keeps actions', /label: t\('suppliers\.action\.addNewPart', 'Add New Part'\)/.test(dir) && /label: selected\?\.archived \? t\('suppliers\.action\.restoreSupplier', 'Restore Supplier'\) : t\('suppliers\.action\.archiveSupplier', 'Archive Supplier'\)/.test(dir) && /label: t\('suppliers\.action\.deleteSupplier', 'Delete Supplier'\)/.test(dir));

  // Part 5 part workflow
  ok('parts row has View Part Details (new tab)', /onViewPart\?\.\(p\)/.test(dir) && /title="View Part Details \(new tab\)"/.test(dir));
  ok('parts row has Add to Purchase Order', /onAddToPO\(p, selected\)/.test(dir) && /title="Add to Purchase Order"/.test(dir));
  ok('row no longer whole-row jumps to inventory', !/onClick=\{\(\) => onJumpToPart\?\.\(p\.id, p\.name\)\}/.test(dir));
  ok('View Part opens inventory deep-link in new tab', /open=inventory:\$\{encodeURIComponent\(key\)\}#inventory`, '_blank'/.test(dash));
  ok('inventory deep-link highlights the part', /maruti_inventory_highlight/.test(dash));
  ok('Add to PO seeds the builder', /setPoSeed\(\{ id: p\.id, _n: Date\.now\(\) \}\)/.test(dash) && /seedPart=\{poSeed\}/.test(dash));
  // Issue 6 (Suppliers module review) — the seed path used to always add qty 1, a
  // different rule from the reorder qty (`suggested`) manual selection already used for
  // the same part. Now both use the same suggested() quantity — one qty rule, not two.
  ok('PO builder merges seeded part without clobber, using the same suggested() qty as manual selection', /s\[seedPart\.id\] \? s : \{ \.\.\.s, \[seedPart\.id\]: qty \}/.test(po) && /const qty = part \? Math\.max\(1, suggested\(part\)\) : 1;/.test(po));

  // Part 7 selection glow clip fix
  ok('list container has padding so glow is not clipped', /ref=\{listScrollRef\}[\s\S]{0,120}px-1 py-1 -mx-1/.test(dir));
})();
console.log(`\n  (phase A addendum)\n`);

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
