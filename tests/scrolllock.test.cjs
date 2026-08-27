/**
 * tests/scrolllock.test.cjs — ISSUE 7 (scrolling randomly freezes)
 *
 * Drives the exact interleaving that strands <body> in a locked state:
 *   open Modal -> open ConfirmDialog over it -> confirm -> Modal unmounts -> dialog unmounts
 *
 * With two independent body locks, the dialog's cleanup restored overflow:'hidden'
 * AFTER the modal had already unlocked, and the app stopped scrolling until reload.
 */
require('./setup.cjs');
const { lockBody, unlockBody, assertBodyUnlockedIfNoModals } = require('../components/Modal.js');

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};

const bodyLocked = () => {
  const b = document.body;
  return b.style.overflow === 'hidden' || b.style.position === 'fixed';
};

console.log('\nISSUE 7 — body scroll lock must never strand the page\n');

// --- baseline
ok('body starts unlocked', !bodyLocked(), `overflow=${document.body.style.overflow} position=${document.body.style.position}`);

// --- the reported interleaving: modal opens, dialog opens over it,
//     MODAL UNMOUNTS FIRST, then the dialog unmounts.
const modalToken = lockBody();          // <Modal> mounts
ok('body locked while the modal is open', bodyLocked());

const dialogToken = lockBody();         // <ConfirmDialog> opens ON TOP
ok('body still locked with both open', bodyLocked());

unlockBody(modalToken);                 // user confirms -> the MODAL closes first
ok('body still locked — the dialog is still up', bodyLocked(),
  'the page must not scroll behind a dialog that is still on screen');

unlockBody(dialogToken);                // the dialog finally unmounts
ok('body UNLOCKED once everything is closed (was the freeze)',
  !bodyLocked(),
  `body is still locked: overflow=${document.body.style.overflow} position=${document.body.style.position}`);

// --- reverse order, for completeness
const a = lockBody();
const b = lockBody();
unlockBody(b);
unlockBody(a);
ok('reverse close order also unlocks', !bodyLocked());

// --- double-unlock must not drive the counter negative (which would leave the NEXT
//     modal unable to lock at all)
const c = lockBody();
unlockBody(c);
unlockBody(c);
const d = lockBody();
ok('a stray double-unlock does not break the next lock', bodyLocked(),
  'the counter went negative — the next modal would not lock the body');
unlockBody(d);
ok('…and still unlocks cleanly afterwards', !bodyLocked());

// --- the app's own invariant check
let asserted = true;
try { assertBodyUnlockedIfNoModals(); } catch (e) { asserted = false; }
ok('assertBodyUnlockedIfNoModals() passes with no modals open', asserted);

// --- THE ASSERTION THAT ACTUALLY CATCHES THE BUG.
// Everything above exercises lockBody/unlockBody, which were ALREADY correct. The
// defect was that ConfirmDialog bypassed them and hand-rolled its own body lock. So
// the real guard is structural: NOTHING may write document.body.style.overflow (or
// .position) except Modal.js, which owns the counted lock. A second writer is a race.
const fs = require('fs');
const path = require('path');
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
const OWNER = path.join(ROOT, 'components/Modal.js');
const rogue = [];
[...walk(path.join(ROOT, 'components')), ...walk(path.join(ROOT, 'lib'))].forEach((f) => {
  if (f === OWNER) return;                       // Modal.js is the sole owner
  const src = fs.readFileSync(f, 'utf8');
  src.split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!code || code.startsWith('*')) return;              // comment / JSDoc line
    // An ASSIGNMENT (`=` not `==`/`===`) — a read like `if (…position === 'fixed')` is fine.
    if (/document\.body\.style\.(overflow|position)\s*=(?!=)/.test(code)) {
      rogue.push(`${path.relative(ROOT, f)}:${i + 1}  ${code.slice(0, 70)}`);
    }
  });
});
ok('ONLY Modal.js writes document.body.style — no competing lock',
  rogue.length === 0,
  rogue.length ? `a second body lock will race the counted one:\n         ${rogue.join('\n         ')}` : '');

console.log(`\n  ${PASS} passed, ${FAIL} failed\n`);
process.exit(FAIL ? 1 : 0);
