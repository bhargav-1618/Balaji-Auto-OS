/**
 * tests/resizable-panes-workspace.test.cjs
 *
 * INVENTORY → SUPPLIERS: RESIZABLE 3-COLUMN WORKSPACE.
 *
 * Verifies the new shared resizable-pane primitive (components/common/
 * ResizablePanes.jsx — the first drag-resize implementation anywhere in this app; a
 * full-codebase grep before this feature found zero onPointerDown/onMouseDown/
 * cursor-col-resize/splitter matches) and its wiring into
 * components/inventory/SupplierDirectory.jsx.
 */
const fs = require('fs'), path = require('path');
let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const R = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

console.log('\nSuppliers workspace — resizable 3-pane primitive\n');

const rp = R('components/common/ResizablePanes.jsx');
const dir = R('components/inventory/SupplierDirectory.jsx');

// --- Part 1: the primitive is genuinely shared, not a Suppliers-only implementation ---
ok('lives in components/common/ (the app\'s established home for shared primitives), not inline in Suppliers',
  fs.existsSync(path.resolve(__dirname, '../components/common/ResizablePanes.jsx')));
ok('documents itself as reusable for any future fixed-flexible-fixed workspace, not a one-off',
  /reusable[\s\S]{0,300}next master-detail-style|next.*workspace.*need.*user-adjustable/.test(rp) || /master-detail-style|another.*drag implementation/i.test(rp));

// --- Part 2: performant dragging — DOM mutation during drag, ONE commit on release ---
ok('drag updates write directly to the DOM via refs during pointermove, not React state on every move',
  /applyLive[\s\S]{0,50}\(side, leftPx, rightPx\)[\s\S]{0,200}leftRef\.current\.style\.width/.test(rp));
ok('React state (the actual commit) happens exactly once, in the pointerup handler, not per pointermove',
  /const onUp = \(\) => \{[\s\S]{0,300}commit\('left'/.test(rp) && !/onMove[\s\S]{0,100}commit\(/.test(rp));

// --- Part 3: pointer capture is set up AND torn down, defensively ---
ok('setPointerCapture is called on drag start',
  /setPointerCapture\?\.\(pointerId\)/.test(rp));
ok('releasePointerCapture is called on drag end (the missing half that broke every drag after the first — caught live)',
  /releasePointerCapture\?\.\(pointerId\)/.test(rp));
ok('both capture calls are defensively wrapped — a throw there must never block the cursor/listener cleanup that follows',
  (rp.match(/try \{ captureEl\.(set|release)PointerCapture\?\.\(pointerId\); \} catch/g) || []).length === 2);

// --- Part 4: min/max bounds exist for all three panes, and are content-derived ---
ok('SupplierDirectory declares explicit, content-derived bounds for all 3 panes (not arbitrary numbers)',
  /PANE_BOUNDS = \{[\s\S]{0,50}left: \{ min: 260, max: 440 \}[\s\S]{0,50}center: \{ min: 480, max: 1100 \}[\s\S]{0,50}right: \{ min: 260, max: 420 \}/.test(dir));
ok('the primitive actually clamps every candidate width to [min,max], never trusting raw pointer delta',
  /const clamp = \(v, min, max\)/.test(rp) && (rp.match(/clamp\(/g) || []).length >= 3);

// --- Part 5: the center (Supplier View) pane cannot become excessively wide ---
ok('the center pane has its own max-width, enforced via a CSS custom property (not a hardcoded pixel value baked into markup)',
  /--center-max[\s\S]{0,200}center\.max/.test(rp) && /max-width: var\(--center-max\)/.test(rp));
ok('when a candidate width would push the center pane past its max, the excess is redistributed to the OTHER outer pane first, not just silently capped (leaving dead space)',
  /impliedCenter > center\.max[\s\S]{0,400}giveRight|giveLeft/.test(rp));
ok('the center pane also has a floor — the resolve function pulls space back if it would starve below center.min',
  /impliedCenter < center\.min/.test(rp));

// --- Part 6: NO persistence — plain component state, resets on unmount ---
ok('pane widths are plain useState in SupplierDirectory (the component Suppliers unmounts when its tab is left)',
  /const \[dirWidth, setDirWidth\] = useState\(320\)/.test(dir) && /const \[poWidth, setPoWidth\] = useState\(300\)/.test(dir));
ok('pane widths are NOT written to sessionStorage/localStorage — the brief requires a reload or leaving Suppliers to reset them, plain component state already does that for free',
  !/dirWidth[\s\S]{0,80}sessionStorage/.test(dir) && !/poWidth[\s\S]{0,80}sessionStorage/.test(dir));
// NAVIGATION STATE + DATA FRESHNESS REVIEW moved listQ/statusF/sortBy/selId off
// sessionStorage onto a plain in-memory module-scope object (survives tab-switch, resets
// on reload — sessionStorage surviving a real reload was the actual bug). Still a
// DIFFERENT, intentionally-longer-lived mechanism than dirWidth/poWidth's plain useState
// above, which this test exists to distinguish.
ok('the existing listQ/statusF/sortBy/selId persistence (a DIFFERENT, intentionally-longer-lived state, now in-memory not sessionStorage) is untouched',
  /useEffect\(\(\) => \{ V\.q = listQ; V\.statusF = statusF; V\.sortBy = sortBy; V\.selId = selId; \}, \[listQ, statusF, sortBy, selId\]\);/.test(dir));

// --- Part 7: selection/tab changes never touch pane width state ---
ok('selecting a different supplier (selId) has no code path that resets dirWidth/poWidth',
  !/setSelId[\s\S]{0,60}setDirWidth|setSelId[\s\S]{0,60}setPoWidth/.test(dir));
ok('switching the active detail tab has no code path that resets dirWidth/poWidth',
  !/setTab\('overview'\); setPartsQ\(''\); setPartsPage\(1\); setMenuOpen\(false\);[\s\S]{0,80}(setDirWidth|setPoWidth)/.test(dir));

// --- Part 8: SupplierDirectory is wired through the primitive, both splitters present ---
ok('SupplierDirectory imports and renders ResizablePanes with all three pane configs',
  /import ResizablePanes from '\.\.\/common\/ResizablePanes'/.test(dir) &&
  /<ResizablePanes[\s\S]{0,300}left=\{\{[\s\S]{0,100}center=\{\{[\s\S]{0,100}right=\{\{/.test(dir));
ok('the Splitter sub-component is keyboard-accessible (a real ARIA separator, not a div with only a mouse handler)',
  /role="separator"/.test(rp) && /aria-label=\{label\}/.test(rp) && /tabIndex=\{0\}/.test(rp));
ok('Splitter is a single shared sub-component instantiated twice (left boundary, right boundary) — not two hand-rolled drag handles',
  (rp.match(/<Splitter onDragStart=\{beginDrag\(/g) || []).length === 2);
ok('splitter aria-labels name which boundary they move (Directory vs Purchase Order), for screen-reader/keyboard users',
  /label="Resize Supplier Directory"/.test(rp) && /label="Resize Purchase Order panel"/.test(rp));

// --- Part 9: mobile/tablet responsive strategy is preserved, not redesigned ---
ok('splitters are hidden below the xl breakpoint (existing app-wide breakpoint choice, not a new one-off)',
  /hidden xl:flex/.test(rp));
ok('the PO panel keeps its pre-existing hidden-below-xl stacked-column fallback (this brief explicitly says the existing choice here is acceptable; the class now lives on the primitive\'s own right-pane wrapper, since SupplierDirectory no longer owns pane chrome itself)',
  /pane-right hidden xl:block/.test(rp));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
