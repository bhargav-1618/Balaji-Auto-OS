/**
 * tests/supplier-aware-po-panel.test.cjs
 *
 * INVENTORY → SUPPLIERS → PURCHASE ORDER PANEL — SUPPLIER-AWARE PARTS ORGANIZATION.
 *
 * Verifies the docked PO builder (components/inventory/SupplierPOBuilder.jsx) switches
 * cleanly between a general "browse any part" mode and a supplier-aware mode once a
 * supplier is selected in the middle pane — supplied parts first, everything else still
 * fully browsable/searchable below a clear divider, cart untouched by a supplier switch.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const R = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nSupplier-aware Purchase Order panel\n');

const po = R('components/inventory/SupplierPOBuilder.jsx');
const dir = R('components/inventory/SupplierDirectory.jsx');
const inv = R('components/InventoryDashboard.js');

// --- Part 1: the selection is actually threaded through (render-prop, not lifted state) ---
ok('SupplierPOBuilder accepts a selectedSupplier prop (defaults to null — safe for its OTHER, non-Suppliers-page usage)',
  /selectedSupplier = null/.test(po));
ok('InventoryDashboard now passes poPanel as a RENDER FUNCTION, not a pre-built element — SupplierDirectory owns the selection, InventoryDashboard doesn\'t',
  /poPanel=\{\(selectedSupplier\) => <SupplierPOBuilder/.test(inv));
ok('SupplierDirectory calls poPanel(selected) — the currently selected supplier flows in at render time',
  /\{poPanel\(selected\)\}/.test(dir));
ok('the OTHER SupplierPOBuilder call site (the standalone reorder drawer) is untouched — no selectedSupplier there, so it stays in general-browse mode',
  /<SupplierPOBuilder\s*\n\s*inventory=\{inventory\}\s*\n\s*suppliers=\{suppliers\}\s*\n\s*restocks=\{restocks\}\s*\n\s*formatINR=\{formatINR\}\s*\n\s*onClose=/.test(inv));

// --- Part 2: "supplied by this supplier" matches ANY linked supplier, not just the primary one ---
ok('supplied-parts matching checks the FULL suppliers array (any match), not just suppliers[0] (which is a DIFFERENT, unrelated "primary supplier for checkout grouping" concept)',
  /suppliedIds = useMemo[\s\S]{0,300}\(p\.suppliers \|\| \[\]\)\.some\(\(x\) => \(x\?\.id \|\| x\) === selectedSupplier\.id\)/.test(po));
ok('the checkout-grouping helper (supplierOf, suppliers[0]) is untouched — a genuinely different concern (which supplier a cart line gets attributed to), not conflated with "who supplies this part"',
  /const supplierOf = \(p\) => \(Array\.isArray\(p\.suppliers\) && p\.suppliers\[0\]\) \|\| null;/.test(po));

// --- Part 3: no supplier selected -> clean general-browse mode, never "undefined" ---
ok('the header subtitle only ever reads selectedSupplier.name inside a truthy check — "Parts supplied by undefined" cannot render',
  /\{selectedSupplier \? <>Supplier: <span[\s\S]{0,120}\{selectedSupplier\.name\}<\/span><\/> : 'Search and add parts from any supplier\.'\}/.test(po));
ok('the supplier-context section (heading + divider) is only rendered when selectedSupplier is truthy — collapses back to one flat list otherwise',
  /\{selectedSupplier && \(/.test(po));

// --- Part 4: supplied parts appear FIRST, with a real count, above a labeled divider ---
ok('the supplied-parts heading shows a real, filter-aware count — Parts supplied by {name} ({count}) — not a static/misleading number',
  /Parts supplied by \{selectedSupplier\.name\} \(\{suppliedList\.length\}\)/.test(po));
ok('a labeled divider (not just spacing) separates supplied parts from the rest',
  /Other Parts<\/span>/.test(po) && /h-px flex-1/.test(po));
ok('the "Other Parts" section explicitly does NOT claim these parts can\'t be ordered from the selected supplier — only that they aren\'t currently linked',
  /Not currently linked to \{selectedSupplier\.name\} — still orderable if needed\./.test(po));

// --- Part 5: other parts are never hidden — general inventory remains fully reachable ---
ok('otherList falls back to the FULL filtered list when no supplier is selected (one code path for both states, not two)',
  /const otherList = useMemo\(\(\) => \(suppliedIds \? list\.filter\(\(p\) => !suppliedIds\.has\(p\.id\)\) : list\), \[list, suppliedIds\]\);/.test(po));
ok('the "Other Parts" list is always rendered (outside the selectedSupplier-only block), never gated behind the supplier check',
  /\{otherList\.slice\(0, otherCap\)\.map/.test(po));

// --- Part 6: search covers the FULL dataset for both groups, not a paginated slice ---
ok('supplied/other lists are partitioned from the SAME already-searched `list` (one filter pass over the full active-parts array), not two independently re-queried searches',
  /const suppliedList = useMemo\(\(\) => \(suppliedIds \? list\.filter\(\(p\) => suppliedIds\.has\(p\.id\)\) : \[\]\), \[list, suppliedIds\]\);/.test(po));
ok('an active search raises the visible cap so matches surface without repeated "Load more" clicks, for both sections',
  /const isSearching = debQ\.trim\(\)\.length >= 3;/.test(po) &&
  /const suppliedCap = isSearching \? Math\.max\(visibleSupplied, 100\) : visibleSupplied;/.test(po) &&
  /const otherCap = isSearching \? Math\.max\(visibleOther, 100\) : visibleOther;/.test(po));
ok('pagination is independent per section — paging "Other Parts" never silently reveals more supplied-parts rows or vice versa',
  /const \[visibleSupplied, setVisibleSupplied\] = useState\(30\);/.test(po) && /const \[visibleOther, setVisibleOther\] = useState\(30\);/.test(po));

// --- Part 7: selected-items cart survives a supplier switch, search, filter, and scroll ---
ok('the Selected Items cart block is rendered unconditionally on selectedParts.length, independent of supplier/search/filter state — nothing in this feature touches that gate',
  /\{selectedParts\.length > 0 && \(/.test(po));
ok('switching supplier never calls setSel/clearAll — the cart is never programmatically cleared on a context change',
  !/selectedSupplier\?\.id\][\s\S]{0,20}\{[\s\S]{0,150}setSel\(\{\}\)/.test(po));
ok('a supplier switch with a non-empty cart surfaces a clear, non-blocking notice (not a silent no-op, not a disruptive confirm — the cart is already safe by construction since checkout groups by each PART\'s own supplier, not the browsing context)',
  /Now browsing \$\{selectedSupplier\.name\}'s parts — your \$\{Object\.keys\(sel\)\.length\}/.test(po));
ok('the notice is grammatically correct for both singular and plural item counts (is/are, not always "are")',
  /\$\{Object\.keys\(sel\)\.length === 1 \? ' is' : 's are'\} still in the order/.test(po));
ok('the switch-notice only fires on an ACTUAL change between two real suppliers (not on first mount, not on clearing to null) — guards both prevId and nextId being non-null',
  /prevId !== nextId && prevId != null && nextId != null && Object\.keys\(sel\)\.length > 0/.test(po));

// --- Part 8: row-level detail is complete without duplicating the row markup per section ---
ok('a single shared row renderer (renderPartRow) is defined once and called from BOTH sections — not two copies of the same markup drifting apart',
  /const renderPartRow = \(p, \{ hideSupplier = false \} = \{\}\) => \{/.test(po) &&
  /renderPartRow\(p, \{ hideSupplier: true \}\)/.test(po) &&
  /otherList\.slice\(0, otherCap\)\.map\(\(p\) => renderPartRow\(p\)\)/.test(po));
ok('each row still shows name, SKU, stock, min stock, suggested qty, and price/qty-stepper — nothing dropped by the refactor',
  /Stock \{p\.stock \|\| 0\}/.test(po) && /min \{p\.minStock \|\| 5\}/.test(po) && /suggest \{suggested\(p\)\}/.test(po) && /p\.sku \?/.test(po));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
