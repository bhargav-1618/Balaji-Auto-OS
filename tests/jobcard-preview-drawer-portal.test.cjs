/**
 * tests/jobcard-preview-drawer-portal.test.cjs
 *
 * Root cause of "the Job Card detail panel's SBBMC… header + Close (X) sit below
 * the app chrome instead of at the panel's own top": the preview drawer
 * (`{previewCard && (<div className="fixed inset-0 z-[120] flex justify-end">…`)
 * rendered INLINE inside <main>. <main> is `relative z-10` — its own stacking
 * context — so the drawer's `z-[120]` was compared at <main>'s z-10, which loses
 * to the demo banner (z-[90]) and mobile bottom-nav (z-[80]) that live OUTSIDE
 * <main>. The whole overlay, header included, painted underneath them; the
 * visible top of the panel was the scrollable body, not the header.
 *
 * The drawer's internal layout was already correct — a full-height flex column
 * with a `flex-shrink-0` header and a `flex-1 overflow-y-auto` body, so the
 * header never scrolls with the content. The only bug was WHERE it mounted.
 *
 * Fix (same one already used for CustomerWizard, the Add-Vehicle modal and
 * LedgerPage): portal the drawer to document.body so it escapes <main>'s
 * stacking context and its z-[120] genuinely wins over the app chrome.
 */
const fs = require('fs');
const path = require('path');

let PASS = 0, FAIL = 0;
const ok = (n, c, d = '') => { if (c) { PASS++; console.log(`  ✓ ${n}`); } else { FAIL++; console.log(`  ✗ ${n}${d ? `\n      → ${d}` : ''}`); } };
const src = fs.readFileSync(path.resolve(__dirname, '../components/jobcards/JobCardModule.jsx'), 'utf8');

console.log('\nJob Card preview drawer — portaled to <body>, fixed header stays pinned\n');

ok('createPortal is imported from react-dom',
  /import \{ createPortal \} from 'react-dom'/.test(src));

// isolate the previewCard drawer block
const start = src.indexOf('{previewCard && ');
// widened from 4200: Phase 1c adds a RecordUpdatedNotice row inside the drawer body.
const block = src.slice(start, start + 5000);

ok('the preview drawer is portaled via createPortal (not rendered inline in <main>)',
  /\{previewCard && createPortal\(/.test(block));
ok('createPortal targets document.body',
  /\{previewCard && createPortal\(\([\s\S]{0,4800}\), document\.body\)\}/.test(block));
ok('the drawer keeps its own right-side overlay + close-on-backdrop-click (portaling only moves WHERE it mounts)',
  /<div className="fixed inset-0 z-\[120\] flex justify-end"[\s\S]{0,120}onClick=\{\(\) => setPreviewCard\(null\)\}/.test(block));

// the internal layout that keeps the header pinned while the body scrolls
ok('panel is a full-height flex column',
  /<div className="w-full max-w-md h-full flex flex-col"/.test(block));
ok('header is flex-shrink-0 (never scrolls, never collapses) and holds the job number + Close',
  /flex-shrink-0 flex items-center justify-between[\s\S]{0,400}previewCard\.jobNo[\s\S]{0,400}aria-label="Close"/.test(block));
ok('body is the only scroll region (flex-1 overflow-y-auto), starting below the header',
  /aria-label="Close"[\s\S]{0,400}<div ref=\{previewBodyRef\} className="flex-1 overflow-y-auto/.test(block));
ok('Edit + PDF actions still live in the panel body/bottom area, wired to loadCard / downloadPDF',
  /loadCard\(previewCard\); setPreviewCard\(null\);[\s\S]{0,300}Edit[\s\S]{0,400}downloadPDF\(previewCard, false\)[\s\S]{0,300}PDF/.test(block));

// z-order sanity: the drawer must out-rank the app chrome it used to hide behind
ok('drawer z-[120] out-ranks the demo banner (z-[90]) and mobile bottom-nav (z-[80])',
  /z-\[120\]/.test(block) &&
  /className="flex-none flex items-center justify-center[\s\S]{0,80}z-\[90\]"/.test(fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8')) &&
  /md:hidden fixed bottom-0 left-0 right-0 z-\[80\]/.test(fs.readFileSync(path.resolve(__dirname, '../components/InventoryDashboard.js'), 'utf8')));

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
